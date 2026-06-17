const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 10000;
const ROOT = path.resolve(__dirname);

const LIVE_SCORE_API_KEY = process.env.LIVE_SCORE_API_KEY || "";
const LIVE_SCORE_API_SECRET = process.env.LIVE_SCORE_API_SECRET || "";

const cache = new Map();

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

function apiCredentials() {
  if (!LIVE_SCORE_API_KEY || !LIVE_SCORE_API_SECRET) {
    throw new Error("Live-Score API credentials are not configured in Render.");
  }

  return `key=${encodeURIComponent(LIVE_SCORE_API_KEY)}&secret=${encodeURIComponent(LIVE_SCORE_API_SECRET)}`;
}

function fetchText(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "FootballPulse/3.0",
        Accept: "application/json, application/rss+xml, text/xml, */*",
        ...headers
      }
    }, response => {
      if (
        [301, 302, 303, 307, 308].includes(response.statusCode) &&
        response.headers.location &&
        redirects < 5
      ) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        return resolve(fetchText(next, headers, redirects + 1));
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body
        });
      });
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error("Provider request timed out."));
    });

    request.on("error", reject);
  });
}

async function fetchJson(url, providerName) {
  const response = await fetchText(url);

  if (response.status !== 200) {
    throw new Error(`${providerName} returned HTTP ${response.status}.`);
  }

  let payload;

  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error(`${providerName} returned invalid JSON.`);
  }

  if (payload.success === false) {
    const message =
      payload.error ||
      payload.message ||
      payload.errors?.[0]?.message ||
      `${providerName} rejected the request.`;

    throw new Error(String(message));
  }

  return payload;
}

async function cached(key, durationMs, loader) {
  const existing = cache.get(key);

  if (existing && Date.now() - existing.createdAt < durationMs) {
    return existing.value;
  }

  const value = await loader();
  cache.set(key, { value, createdAt: Date.now() });
  return value;
}

function dataArray(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.match)) return payload.data.match;
  if (Array.isArray(payload?.data?.matches)) return payload.data.matches;
  if (Array.isArray(payload?.data?.fixtures)) return payload.data.fixtures;
  return [];
}

function scoreParts(match) {
  const text = String(match.score || match.score_string || "");
  const parts = text.split(/\s*-\s*/);

  const home =
    match.home_score ??
    match.score_home ??
    match.scores?.score ??
    match.scores?.home ??
    (parts.length === 2 ? Number(parts[0]) : null);

  const away =
    match.away_score ??
    match.score_away ??
    match.scores?.score_away ??
    match.scores?.away ??
    (parts.length === 2 ? Number(parts[1]) : null);

  return {
    home: Number.isFinite(Number(home)) ? Number(home) : null,
    away: Number.isFinite(Number(away)) ? Number(away) : null
  };
}

function mapLiveMatch(match) {
  const scores = scoreParts(match);

  return {
    id: String(match.id ?? match.match_id ?? ""),
    fixtureId: match.fixture_id ?? null,
    competition:
      match.competition_name ||
      match.competition?.name ||
      match.league_name ||
      match.league?.name ||
      "Football",
    country:
      match.country_name ||
      match.country?.name ||
      match.country ||
      "",
    utcDate:
      match.scheduled ||
      match.start_time ||
      match.date ||
      new Date().toISOString(),
    status:
      match.status ||
      match.status_name ||
      "IN PLAY",
    minute:
      Number.parseInt(match.minute || match.time || "", 10) || null,
    homeTeam:
      match.home_name ||
      match.home_team?.name ||
      match.home?.name ||
      "Home",
    awayTeam:
      match.away_name ||
      match.away_team?.name ||
      match.away?.name ||
      "Away",
    homeScore: scores.home,
    awayScore: scores.away,
    urls: match.urls || {}
  };
}

function mapFixture(fixture) {
  return {
    id: String(fixture.id ?? fixture.fixture_id ?? ""),
    competition:
      fixture.competition_name ||
      fixture.competition?.name ||
      fixture.league_name ||
      fixture.league?.name ||
      "Football",
    country:
      fixture.country_name ||
      fixture.country?.name ||
      fixture.country ||
      "",
    utcDate:
      fixture.date ||
      fixture.scheduled ||
      fixture.start_time ||
      fixture.time ||
      "",
    homeTeam:
      fixture.home_name ||
      fixture.home_team?.name ||
      fixture.home?.name ||
      "Home",
    awayTeam:
      fixture.away_name ||
      fixture.away_team?.name ||
      fixture.away?.name ||
      "Away"
  };
}

function mapResult(match) {
  const scores = scoreParts(match);

  return {
    id: String(match.id ?? match.match_id ?? match.fixture_id ?? ""),
    competition:
      match.competition_name ||
      match.competition?.name ||
      match.league_name ||
      match.league?.name ||
      "Football",
    country:
      match.country_name ||
      match.country?.name ||
      match.country ||
      "",
    utcDate:
      match.date ||
      match.scheduled ||
      match.start_time ||
      match.time ||
      "",
    status:
      match.status ||
      match.status_name ||
      "FT",
    homeTeam:
      match.home_name ||
      match.home_team?.name ||
      match.home?.name ||
      "Home",
    awayTeam:
      match.away_name ||
      match.away_team?.name ||
      match.away?.name ||
      "Away",
    homeScore: scores.home,
    awayScore: scores.away
  };
}

function resultIsFinished(match) {
  const status = String(
    match.status ||
    match.status_name ||
    match.state ||
    ""
  ).toUpperCase();

  const scores = scoreParts(match);

  return (
    status.includes("FINISH") ||
    status === "FT" ||
    status === "AET" ||
    status === "PEN" ||
    (
      scores.home !== null &&
      scores.away !== null &&
      !status.includes("LIVE") &&
      !status.includes("IN PLAY")
    )
  );
}

async function loadResults(dateFrom, dateTo) {
  const key = `results:${dateFrom}:${dateTo}`;

  return cached(key, 5 * 60 * 1000, async () => {
    const results = [];
    const cursor = new Date(`${dateFrom}T12:00:00Z`);
    const end = new Date(`${dateTo}T12:00:00Z`);

    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);

      const urls = [
        `https://livescore-api.com/api-client/scores/history.json?${apiCredentials()}&date=${encodeURIComponent(date)}`,
        `https://livescore-api.com/api-client/fixtures/matches.json?${apiCredentials()}&date=${encodeURIComponent(date)}`
      ];

      let loadedForDate = false;

      for (const url of urls) {
        try {
          const payload = await fetchJson(url, "Live-Score API results");
          const matches = dataArray(payload);

          if (matches.length) {
            results.push(
              ...matches
                .filter(resultIsFinished)
                .map(mapResult)
            );

            loadedForDate = true;
            break;
          }
        } catch (error) {
          console.error(`Results request failed for ${date}:`, error.message);
        }
      }

      if (!loadedForDate) {
        console.log(`No finished results returned for ${date}.`);
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const seen = new Set();

    return results
      .filter(result => result.utcDate)
      .filter(result => {
        const resultKey =
          `${result.id}|${result.utcDate}|${result.homeTeam}|${result.awayTeam}`;

        if (seen.has(resultKey)) return false;
        seen.add(resultKey);
        return true;
      })
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
  });
}

async function loadLiveMatches() {
  return cached("live", 20000, async () => {
    const url =
      `https://livescore-api.com/api-client/matches/live.json?${apiCredentials()}`;

    const payload = await fetchJson(url, "Live-Score API");
    return dataArray(payload).map(mapLiveMatch).filter(match => match.id);
  });
}

async function loadFixtures(dateFrom, dateTo) {
  const key = `fixtures:${dateFrom}:${dateTo}`;

  return cached(key, 5 * 60 * 1000, async () => {
    const fixtures = [];
    const cursor = new Date(`${dateFrom}T12:00:00Z`);
    const end = new Date(`${dateTo}T12:00:00Z`);

    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);

      const url =
        `https://livescore-api.com/api-client/fixtures/matches.json?` +
        `${apiCredentials()}&date=${encodeURIComponent(date)}`;

      try {
        const payload = await fetchJson(url, "Live-Score API fixtures");
        fixtures.push(...dataArray(payload).map(mapFixture));
      } catch (error) {
        console.error(`Fixture request failed for ${date}:`, error.message);
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const seen = new Set();

    return fixtures
      .filter(fixture => fixture.utcDate)
      .filter(fixture => {
        const keyValue =
          `${fixture.id}|${fixture.utcDate}|${fixture.homeTeam}|${fixture.awayTeam}`;

        if (seen.has(keyValue)) return false;
        seen.add(keyValue);
        return true;
      })
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  });
}

function addCredentialsToProviderUrl(urlValue) {
  if (!urlValue) return "";

  const url = new URL(urlValue, "https://livescore-api.com");
  url.searchParams.set("key", LIVE_SCORE_API_KEY);
  url.searchParams.set("secret", LIVE_SCORE_API_SECRET);
  return url.toString();
}

function normalizeStatistics(payload) {
  const list = dataArray(payload);

  return list.map(item => ({
    type: item.type || item.label || "Statistic",
    label: item.label || item.type || "Statistic",
    home: item.home ?? item.home_value ?? 0,
    away: item.away ?? item.away_value ?? 0
  }));
}

function normalizeEvents(payload) {
  const list = dataArray(payload);

  return list.map(item => ({
    minute:
      Number.parseInt(item.minute || item.time || "", 10) || null,
    team:
      item.team_name ||
      item.team?.name ||
      "",
    player:
      item.player_name ||
      item.player?.name ||
      item.scorer ||
      "",
    type:
      item.type ||
      item.event ||
      "",
    detail:
      item.detail ||
      item.event_name ||
      item.type ||
      ""
  }));
}

async function loadMatchDetails(matchId) {
  const matches = await loadLiveMatches();
  const match = matches.find(item => String(item.id) === String(matchId));

  if (!match) {
    throw new Error("This live match is no longer available.");
  }

  const statisticsUrl = addCredentialsToProviderUrl(match.urls?.statistics);
  const eventsUrl = addCredentialsToProviderUrl(match.urls?.events);

  const [statisticsResult, eventsResult] = await Promise.allSettled([
    statisticsUrl
      ? fetchJson(statisticsUrl, "Live-Score API statistics")
      : Promise.resolve({ data: [] }),

    eventsUrl
      ? fetchJson(eventsUrl, "Live-Score API events")
      : Promise.resolve({ data: [] })
  ]);

  return {
    match,
    statistics:
      statisticsResult.status === "fulfilled"
        ? normalizeStatistics(statisticsResult.value)
        : [],
    events:
      eventsResult.status === "fulfilled"
        ? normalizeEvents(eventsResult.value)
        : [],
    updatedAt: new Date().toISOString()
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
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, 10)
    .map(match => {
      const block = match[1];

      const tag = name => {
        const result = block.match(
          new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")
        );

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
  return cached("news", 3 * 60 * 1000, async () => {
    const feeds = [
      {
        name: "BBC Sport",
        url: "https://feeds.bbci.co.uk/sport/football/rss.xml"
      },
      {
        name: "The Guardian",
        url: "https://www.theguardian.com/football/rss"
      },
      {
        name: "ESPN",
        url: "https://www.espn.com/espn/rss/soccer/news"
      }
    ];

    const settled = await Promise.allSettled(
      feeds.map(async feed => {
        const response = await fetchText(feed.url);

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}`);
        }

        return parseRss(response.body, feed.name);
      })
    );

    const items = settled.flatMap(result =>
      result.status === "fulfilled" ? result.value : []
    );

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
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/api/live") {
      const matches = await loadLiveMatches();

      return sendJson(res, 200, {
        matches,
        providers: [
          {
            name: "Live-Score API",
            state: "online",
            count: matches.length
          }
        ]
      });
    }

    if (url.pathname === "/api/fixtures") {
      const dateFrom =
        url.searchParams.get("dateFrom") ||
        new Date().toISOString().slice(0, 10);

      const dateTo =
        url.searchParams.get("dateTo") ||
        new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      return sendJson(res, 200, {
        fixtures: await loadFixtures(dateFrom, dateTo)
      });
    }

    if (url.pathname === "/api/results") {
      const dateFrom =
        url.searchParams.get("dateFrom") ||
        new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

      const dateTo =
        url.searchParams.get("dateTo") ||
        new Date().toISOString().slice(0, 10);

      return sendJson(res, 200, {
        results: await loadResults(dateFrom, dateTo)
      });
    }

    if (url.pathname === "/api/match-details") {
      const id = url.searchParams.get("id");

      if (!id) {
        return sendJson(res, 400, {
          error: "A match ID is required."
        });
      }

      return sendJson(res, 200, await loadMatchDetails(id));
    }

    if (url.pathname === "/api/news") {
      return sendJson(res, 200, {
        items: await loadNews()
      });
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        credentialsConfigured:
          Boolean(LIVE_SCORE_API_KEY && LIVE_SCORE_API_SECRET)
      });
    }

    return sendJson(res, 404, {
      error: "API route not found."
    });
  } catch (error) {
    console.error(error);

    return sendJson(res, 502, {
      error: error.message || "The live-data provider could not be reached."
    });
  }
}

function serveFile(req, res) {
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  const relativePath =
    requestPath === "/"
      ? "index.html"
      : requestPath.replace(/^\/+/, "");

  const filePath = path.resolve(ROOT, relativePath);

  if (!filePath.startsWith(ROOT)) {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      return send(res, 404, "Not found", "text/plain; charset=utf-8");
    }

    const type =
      mimeTypes[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream";

    send(res, 200, content, type);
  });
}

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      handleApi(req, res);
    } else {
      serveFile(req, res);
    }
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`Football Pulse is running on port ${PORT}`);
  });
