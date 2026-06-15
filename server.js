const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function request(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const requestObject = https.get(url, {
      headers: {
        "User-Agent": "FootballPulse/2.0",
        Accept: "application/json, application/rss+xml, text/xml, */*",
        ...headers
      }
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects < 4) {
        response.resume();
        return resolve(request(new URL(response.headers.location, url).toString(), headers, redirects + 1));
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => body += chunk);
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body
      }));
    });

    requestObject.setTimeout(12000, () => requestObject.destroy(new Error("Provider request timed out")));
    requestObject.on("error", reject);
  });
}

function dateKey(offset = 0) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

function parseJsonResponse(response, providerName) {
  if (response.status !== 200) {
    throw new Error(`${providerName} returned HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`${providerName} returned invalid data`);
  }
}

function mapApiFootballFixture(item) {
  return {
    id: `af-${item.fixture?.id}`,
    provider: "API-Football",
    competition: {
      id: item.league?.id,
      name: item.league?.name || "Football",
      country: item.league?.country || ""
    },
    utcDate: item.fixture?.date,
    status: item.fixture?.status?.short || "NS",
    minute: item.fixture?.status?.elapsed || null,
    homeTeam: item.teams?.home?.name || "Home",
    awayTeam: item.teams?.away?.name || "Away",
    homeLogo: item.teams?.home?.logo || "",
    awayLogo: item.teams?.away?.logo || "",
    homeScore: item.goals?.home ?? null,
    awayScore: item.goals?.away ?? null,
    venue: item.fixture?.venue?.name || "",
    referee: item.fixture?.referee || ""
  };
}

async function apiFootballFixtures(date) {
  if (!API_FOOTBALL_KEY) {
    return { name: "API-Football", state: "not configured", matches: [] };
  }

  const response = await request(`https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(date)}`, {
    "x-apisports-key": API_FOOTBALL_KEY
  });
  const payload = parseJsonResponse(response, "API-Football");
  return {
    name: "API-Football",
    state: "online",
    matches: (payload.response || []).map(mapApiFootballFixture)
  };
}

async function footballDataFixtures(dateFrom, dateTo) {
  if (!FOOTBALL_DATA_TOKEN) {
    return { name: "football-data.org", state: "not configured", matches: [] };
  }

  const response = await request(
    `https://api.football-data.org/v4/matches?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
    { "X-Auth-Token": FOOTBALL_DATA_TOKEN }
  );
  const payload = parseJsonResponse(response, "football-data.org");

  return {
    name: "football-data.org",
    state: "online",
    matches: (payload.matches || []).map(item => ({
      id: `fd-${item.id}`,
      provider: "football-data.org",
      competition: {
        id: item.competition?.id,
        name: item.competition?.name || "Football",
        country: item.area?.name || ""
      },
      utcDate: item.utcDate,
      status: item.status || "SCHEDULED",
      minute: item.minute || null,
      homeTeam: item.homeTeam?.name || "Home",
      awayTeam: item.awayTeam?.name || "Away",
      homeLogo: item.homeTeam?.crest || "",
      awayLogo: item.awayTeam?.crest || "",
      homeScore: item.score?.fullTime?.home ?? null,
      awayScore: item.score?.fullTime?.away ?? null,
      venue: "",
      referee: item.referees?.[0]?.name || ""
    }))
  };
}

function mergeMatches(providers) {
  const merged = new Map();

  for (const provider of providers) {
    for (const match of provider.matches || []) {
      const minute = new Date(match.utcDate).toISOString().slice(0, 16);
      const key = `${minute}|${String(match.homeTeam).toLowerCase()}|${String(match.awayTeam).toLowerCase()}`;
      const existing = merged.get(key);

      if (!existing || match.provider === "API-Football") {
        merged.set(key, match);
      }
    }
  }

  return [...merged.values()].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
}

async function fotmobFixtures(dateFrom, dateTo) {
  const dates = [];
  const cursor = new Date(`${dateFrom}T12:00:00Z`);
  const end = new Date(`${dateTo}T12:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10).replaceAll("-", ""));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const settled = await Promise.allSettled(
    dates.map(date => request(
      `https://www.fotmob.com/api/matches?date=${date}&timezone=Europe%2FLondon&ccode3=GBR`,
      {
        "User-Agent": "Mozilla/5.0 (compatible; FootballPulse/2.0)",
        Referer: "https://www.fotmob.com/",
        Origin: "https://www.fotmob.com"
      }
    ))
  );

  const matches = [];

  for (const result of settled) {
    if (result.status !== "fulfilled" || result.value.status !== 200) continue;

    let payload;
    try {
      payload = JSON.parse(result.value.body);
    } catch {
      continue;
    }

    for (const league of payload.leagues || []) {
      for (const item of league.matches || []) {
        const status = item.status || {};
        const utcDate = status.utcTime || item.time || item.matchTimeUTC || item.utcTime;
        if (!utcDate) continue;

        matches.push({
          id: `fm-${item.id || `${league.id}-${item.home?.name}-${item.away?.name}-${utcDate}`}`,
          provider: "FotMob",
          competition: {
            id: league.id,
            name: league.name || league.parentLeagueName || "Football",
            country: league.ccode || league.country || ""
          },
          utcDate,
          status: status.finished ? "FINISHED" : status.started ? "IN_PLAY" : "TIMED",
          minute: Number.parseInt(status.liveTime?.short || status.reason?.short, 10) || null,
          homeTeam: item.home?.name || item.homeTeam?.name || "Home",
          awayTeam: item.away?.name || item.awayTeam?.name || "Away",
          homeLogo: "",
          awayLogo: "",
          homeScore: item.home?.score ?? item.homeTeam?.score ?? null,
          awayScore: item.away?.score ?? item.awayTeam?.score ?? null,
          venue: "",
          referee: ""
        });
      }
    }
  }

  return {
    name: "FotMob",
    state: matches.length ? "online" : "error",
    matches
  };
}

async function loadMatches(dateFrom, dateTo) {
  const dates = [];
  const cursor = new Date(`${dateFrom}T12:00:00Z`);
  const end = new Date(`${dateTo}T12:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const apiFootballJob = Promise.allSettled(dates.map(apiFootballFixtures)).then(results => {
    const successful = results
      .filter(result => result.status === "fulfilled")
      .map(result => result.value);

    return {
      name: "API-Football",
      state: successful.some(item => item.state === "online")
        ? "online"
        : API_FOOTBALL_KEY
          ? "error"
          : "not configured",
      matches: successful.flatMap(item => item.matches || [])
    };
  });

  const jobs = [
    apiFootballJob,
    footballDataFixtures(dateFrom, dateTo),
    fotmobFixtures(dateFrom, dateTo)
  ];

  const settled = await Promise.allSettled(jobs);
  const names = ["API-Football", "football-data.org", "FotMob"];

  const providers = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      name: names[index],
      state: "error",
      error: result.reason?.message || "Provider request failed",
      matches: []
    };
  });

  return {
    matches: mergeMatches(providers),
    providers: providers.map(provider => ({
      name: provider.name,
      state: provider.state,
      error: provider.error,
      count: provider.matches.length
    }))
  };
}

async function loadFixtures(dateFrom, dateTo) {
  const data = await loadMatches(dateFrom, dateTo);
  const fixtures = data.matches.filter(match => {
    const status = String(match.status || "").toUpperCase();
    return ["NS", "TBD", "SCHEDULED", "TIMED"].includes(status) || new Date(match.utcDate) > new Date();
  });
  return { fixtures, providers: data.providers };
}

async function loadMatchDetails(rawId) {
  if (!API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY has not been added in Render.");
  }

  const fixtureId = String(rawId || "").replace(/^af-/, "");
  if (!/^\d+$/.test(fixtureId)) {
    throw new Error("Detailed live statistics are only available for API-Football matches.");
  }

  const headers = { "x-apisports-key": API_FOOTBALL_KEY };
  const [fixtureResponse, statisticsResponse, eventsResponse, lineupsResponse] = await Promise.all([
    request(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, headers),
    request(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`, headers),
    request(`https://v3.football.api-sports.io/fixtures/events?fixture=${fixtureId}`, headers),
    request(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`, headers)
  ]);

  const fixturePayload = parseJsonResponse(fixtureResponse, "API-Football fixture");
  const statisticsPayload = parseJsonResponse(statisticsResponse, "API-Football statistics");
  const eventsPayload = parseJsonResponse(eventsResponse, "API-Football events");
  const lineupsPayload = parseJsonResponse(lineupsResponse, "API-Football lineups");

  const item = fixturePayload.response?.[0];
  if (!item) throw new Error("The provider has not returned this match.");

  const statisticsByTeam = (statisticsPayload.response || []).map(team => {
    const map = {};
    for (const statistic of team.statistics || []) {
      map[statistic.type] = statistic.value;
    }
    return map;
  });

  const names = [
    "Ball Possession",
    "Total Shots",
    "Shots on Goal",
    "Shots off Goal",
    "Blocked Shots",
    "Corner Kicks",
    "Offsides",
    "Fouls",
    "Yellow Cards",
    "Red Cards",
    "Goalkeeper Saves",
    "Total passes",
    "Passes accurate",
    "Passes %"
  ];

  return {
    fixtureId,
    fixture: {
      status: item.fixture?.status?.short || "",
      minute: item.fixture?.status?.elapsed || null,
      home: item.teams?.home?.name || "Home",
      away: item.teams?.away?.name || "Away",
      homeLogo: item.teams?.home?.logo || "",
      awayLogo: item.teams?.away?.logo || "",
      homeScore: item.goals?.home ?? 0,
      awayScore: item.goals?.away ?? 0,
      venue: item.fixture?.venue?.name || "",
      referee: item.fixture?.referee || ""
    },
    statistics: names.map(name => ({
      name,
      home: statisticsByTeam[0]?.[name] ?? 0,
      away: statisticsByTeam[1]?.[name] ?? 0
    })),
    events: (eventsPayload.response || []).map(event => ({
      minute: event.time?.elapsed ?? null,
      extraMinute: event.time?.extra ?? null,
      team: event.team?.name || "",
      player: event.player?.name || "",
      assist: event.assist?.name || "",
      type: event.type || "",
      detail: event.detail || "",
      comments: event.comments || ""
    })),
    lineups: (lineupsPayload.response || []).map(lineup => ({
      team: lineup.team?.name || "",
      formation: lineup.formation || "",
      startingXI: lineup.startXI || [],
      substitutes: lineup.substitutes || []
    })),
    updatedAt: new Date().toISOString(),
    source: "API-Football"
  };
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .trim();
}

function parseRss(xml, source) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 10).map(match => {
    const block = match[1];
    const tag = name => {
      const result = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
      return result ? decodeXml(result[1]) : "";
    };
    return {
      source,
      title: tag("title"),
      link: tag("link"),
      description: tag("description"),
      pubDate: tag("pubDate")
    };
  });
}

async function loadNews() {
  const feeds = [
    { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
    { name: "The Guardian", url: "https://www.theguardian.com/football/rss" },
    { name: "ESPN", url: "https://www.espn.com/espn/rss/soccer/news" }
  ];

  const settled = await Promise.allSettled(feeds.map(async feed => {
    const response = await request(feed.url);
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    return parseRss(response.body, feed.name);
  }));

  const items = settled.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const seen = new Set();

  return items
    .filter(item => {
      const key = (item.link || item.title).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, 18);
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/api/matches") {
      const dateFrom = url.searchParams.get("dateFrom") || dateKey(-1);
      const dateTo = url.searchParams.get("dateTo") || dateKey(1);
      return sendJson(res, 200, await loadMatches(dateFrom, dateTo));
    }

    if (url.pathname === "/api/fixtures") {
      const dateFrom = url.searchParams.get("dateFrom") || dateKey(0);
      const dateTo = url.searchParams.get("dateTo") || dateKey(7);
      return sendJson(res, 200, await loadFixtures(dateFrom, dateTo));
    }

    if (url.pathname === "/api/match-details") {
      return sendJson(res, 200, await loadMatchDetails(url.searchParams.get("id")));
    }

    if (url.pathname === "/api/news") {
      return sendJson(res, 200, { items: await loadNews() });
    }

    return sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || "The live-data provider could not be reached." });
  }
}

function serveFile(req, res) {
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);

  if (!filePath.startsWith(path.resolve(ROOT))) {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    send(res, 200, content, mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else {
    serveFile(req, res);
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Football Pulse is running on port ${PORT}`);
});
