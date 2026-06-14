const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const KEYS = {
  footballData: process.env.FOOTBALL_DATA_TOKEN || "",
  sportsDb: process.env.THESPORTSDB_KEY || "",
  apiFootball: process.env.API_FOOTBALL_KEY || "",
  sportmonks: process.env.SPORTMONKS_TOKEN || ""
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function get(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; FootballPulse/4.0)",
            Accept: "application/json,application/rss+xml,text/xml,*/*",
            ...headers
          }
        },
        response => {
          if (
            [301, 302, 303, 307, 308].includes(response.statusCode) &&
            response.headers.location &&
            redirects < 5
          ) {
            response.resume();
            const next = new URL(response.headers.location, url).toString();
            return resolve(get(next, headers, redirects + 1));
          }

          let data = "";

          response.on("data", chunk => {
            data += chunk;
          });

          response.on("end", () => {
            resolve({
              status: response.statusCode,
              data,
              headers: response.headers
            });
          });
        }
      )
      .on("error", reject);
  });
}

function parseRss(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8);

  const clean = value =>
    (value || "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

  const tag = (block, name) => {
    const match = block.match(
      new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")
    );

    return match ? clean(match[1]) : "";
  };

  return items.map(match => ({
    title: tag(match[1], "title"),
    link: tag(match[1], "link"),
    description: tag(match[1], "description"),
    pubDate: tag(match[1], "pubDate")
  }));
}

const isoDay = (offset = 0) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const statusMap = status => {
  const value = String(status || "").toUpperCase();

  if (
    ["LIVE", "IN PLAY", "IN_PLAY", "1H", "2H", "HT", "ET", "BT", "P"].includes(
      value
    )
  ) {
    return value === "HT" ? "PAUSED" : "IN_PLAY";
  }

  if (["FT", "AET", "PEN", "FINISHED", "MATCH FINISHED"].includes(value)) {
    return "FINISHED";
  }

  if (["PST", "POSTPONED"].includes(value)) {
    return "POSTPONED";
  }

  if (["CANC", "CANCELLED"].includes(value)) {
    return "CANCELLED";
  }

  return "TIMED";
};

const compCode = name => {
  const value = String(name || "").toLowerCase();

  if (value.includes("world cup")) return "WC";
  if (value.includes("champions league")) return "CL";
  if (value.includes("europa league")) return "EL";
  if (value.includes("premier league")) return "PL";
  if (value.includes("la liga") || value.includes("primera division")) {
    return "PD";
  }
  if (value.includes("serie a")) return "SA";
  if (value.includes("bundesliga")) return "BL1";
  if (value.includes("ligue 1")) return "FL1";
  if (value.includes("major league soccer") || value === "mls") return "MLS";

  return (
    String(name || "Football")
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 4)
      .toUpperCase() || "INT"
  );
};

const cleanName = name =>
  String(name || "TBC")
    .replace(/\s+(FC|CF|AFC)$/i, "")
    .trim();

const makeMatch = ({
  id,
  competition,
  date,
  status,
  minute,
  home,
  away,
  hs,
  as,
  source,
  sourceUrl
}) => ({
  id: String(id),
  competition: {
    code: compCode(competition),
    name: competition || "Football"
  },
  utcDate: date,
  status: statusMap(status),
  minute: minute || null,
  homeTeam: {
    name: cleanName(home)
  },
  awayTeam: {
    name: cleanName(away)
  },
  score: {
    fullTime: {
      home: hs ?? null,
      away: as ?? null
    }
  },
  sources: [
    {
      name: source,
      url: sourceUrl
    }
  ]
});

const demoMatches = [
  makeMatch({
    id: "demo-1",
    competition: "FIFA World Cup",
    date: new Date(Date.now() - 25 * 60000).toISOString(),
    status: "IN_PLAY",
    minute: 67,
    home: "Germany",
    away: "Curaçao",
    hs: 2,
    as: 0,
    source: "Demo feed",
    sourceUrl: "#"
  }),
  makeMatch({
    id: "demo-2",
    competition: "FIFA World Cup",
    date: new Date(Date.now() + 75 * 60000).toISOString(),
    status: "TIMED",
    home: "Netherlands",
    away: "Japan",
    source: "Demo feed",
    sourceUrl: "#"
  }),
  makeMatch({
    id: "demo-3",
    competition: "UEFA Champions League",
    date: new Date(Date.now() - 3 * 3600000).toISOString(),
    status: "FINISHED",
    home: "Paris Saint-Germain",
    away: "Arsenal",
    hs: 2,
    as: 1,
    source: "Demo feed",
    sourceUrl: "#"
  })
];

async function footballData(dateFrom, dateTo) {
  if (!KEYS.footballData) {
    return {
      name: "football-data.org",
      state: "not configured",
      matches: []
    };
  }

  const response = await get(
    `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
    {
      "X-Auth-Token": KEYS.footballData
    }
  );

  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = JSON.parse(response.data);

  return {
    name: "football-data.org",
    state: "online",
    matches: (data.matches || []).map(match =>
      makeMatch({
        id: `fd-${match.id}`,
        competition: match.competition?.name,
        date: match.utcDate,
        status: match.status,
        minute: match.minute,
        home: match.homeTeam?.name,
        away: match.awayTeam?.name,
        hs: match.score?.fullTime?.home,
        as: match.score?.fullTime?.away,
        source: "football-data.org",
        sourceUrl: "https://www.football-data.org/"
      })
    )
  };
}

async function sportsDb(dateFrom, dateTo) {
  if (!KEYS.sportsDb) {
    return {
      name: "TheSportsDB",
      state: "not configured",
      matches: []
    };
  }

  const days = [];

  for (
    let date = new Date(`${dateFrom}T12:00:00Z`);
    date <= new Date(`${dateTo}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    days.push(date.toISOString().slice(0, 10));
  }

  const responses = await Promise.all(
    days.map(day =>
      get(
        `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(
          KEYS.sportsDb
        )}/eventsday.php?d=${day}&s=Soccer`
      )
    )
  );

  const events = responses.flatMap(response => {
    if (response.status !== 200) return [];

    try {
      return JSON.parse(response.data).events || [];
    } catch {
      return [];
    }
  });

  return {
    name: "TheSportsDB",
    state: "online",
    matches: events.map(event =>
      makeMatch({
        id: `tsdb-${event.idEvent}`,
        competition: event.strLeague,
        date:
          event.strTimestamp ||
          `${event.dateEvent}T${event.strTime || "00:00:00"}Z`,
        status: event.strStatus || event.strProgress,
        minute: parseInt(event.strProgress) || null,
        home: event.strHomeTeam,
        away: event.strAwayTeam,
        hs: event.intHomeScore === "" ? null : Number(event.intHomeScore),
        as: event.intAwayScore === "" ? null : Number(event.intAwayScore),
        source: "TheSportsDB",
        sourceUrl: "https://www.thesportsdb.com/"
      })
    )
  };
}

async function apiFootball(dateFrom, dateTo) {
  if (!KEYS.apiFootball) {
    return {
      name: "API-Football",
      state: "not configured",
      matches: []
    };
  }

  const days = [];

  for (
    let date = new Date(`${dateFrom}T12:00:00Z`);
    date <= new Date(`${dateTo}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    days.push(date.toISOString().slice(0, 10));
  }

  const responses = await Promise.all(
    days.map(day =>
      get(`https://v3.football.api-sports.io/fixtures?date=${day}`, {
        "x-apisports-key": KEYS.apiFootball
      })
    )
  );

  const fixtures = responses.flatMap(response => {
    if (response.status !== 200) return [];

    try {
      return JSON.parse(response.data).response || [];
    } catch {
      return [];
    }
  });

  return {
    name: "API-Football",
    state: "online",
    matches: fixtures.map(fixture =>
      makeMatch({
        id: `af-${fixture.fixture?.id}`,
        competition: fixture.league?.name,
        date: fixture.fixture?.date,
        status: fixture.fixture?.status?.short,
        minute: fixture.fixture?.status?.elapsed,
        home: fixture.teams?.home?.name,
        away: fixture.teams?.away?.name,
        hs: fixture.goals?.home,
        as: fixture.goals?.away,
        source: "API-Football",
        sourceUrl: "https://api-sports.io/"
      })
    )
  };
}

async function sportmonks(dateFrom, dateTo) {
  if (!KEYS.sportmonks) {
    return {
      name: "Sportmonks",
      state: "not configured",
      matches: []
    };
  }

  const response = await get(
    `https://api.sportmonks.com/v3/football/fixtures/between/${dateFrom}/${dateTo}?api_token=${encodeURIComponent(
      KEYS.sportmonks
    )}&include=participants;league;scores;state`
  );

  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = JSON.parse(response.data);

  const matches = (data.data || []).map(fixture => {
    const participants = fixture.participants || [];
    const home =
      participants.find(player => player.meta?.location === "home") ||
      participants[0];
    const away =
      participants.find(player => player.meta?.location === "away") ||
      participants[1];

    const current =
      (fixture.scores || []).find(score => score.description === "CURRENT") ||
      (fixture.scores || []).at(-1);

    const score = current?.score?.goals;

    return makeMatch({
      id: `sm-${fixture.id}`,
      competition: fixture.league?.name,
      date: fixture.starting_at,
      status: fixture.state?.state || fixture.state?.short_name,
      minute: fixture.state?.minute,
      home: home?.name,
      away: away?.name,
      hs: score?.home,
      as: score?.away,
      source: "Sportmonks",
      sourceUrl: "https://www.sportmonks.com/"
    });
  });

  return {
    name: "Sportmonks",
    state: "online",
    matches
  };
}

function keyFor(match) {
  return `${new Date(match.utcDate)
    .toISOString()
    .slice(0, 16)}|${cleanName(match.homeTeam.name).toLowerCase()}|${cleanName(
    match.awayTeam.name
  ).toLowerCase()}`;
}

function mergeMatches(providerResults) {
  const map = new Map();

  providerResults
    .flatMap(provider => provider.matches)
    .forEach(match => {
      const key = keyFor(match);
      const existing = map.get(key);

      if (!existing) {
        map.set(key, match);
        return;
      }

      existing.sources = [
        ...existing.sources,
        ...match.sources.filter(
          source =>
            !existing.sources.some(existingSource => existingSource.name === source.name)
        )
      ];

      const existingLive = ["IN_PLAY", "PAUSED"].includes(existing.status);
      const newLive = ["IN_PLAY", "PAUSED"].includes(match.status);

      if (newLive || (!existingLive && match.status === "FINISHED")) {
        existing.status = match.status;
        existing.minute = match.minute;
        existing.score = match.score;
      }
    });

  return [...map.values()].sort(
    (first, second) => new Date(first.utcDate) - new Date(second.utcDate)
  );
}

async function fotmobScores(dateFrom, dateTo) {
  const days = [];

  for (
    let date = new Date(`${dateFrom}T12:00:00Z`);
    date <= new Date(`${dateTo}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    days.push(date.toISOString().slice(0, 10).replaceAll("-", ""));
  }

  const responses = await Promise.all(
    days.map(day =>
      get(
        `https://www.fotmob.com/api/matches?date=${day}&timezone=Europe%2FLondon&ccode3=GBR`,
        {
          "User-Agent": "Mozilla/5.0 (compatible; FootballPulse/4.0)",
          Referer: "https://www.fotmob.com/",
          Origin: "https://www.fotmob.com"
        }
      )
    )
  );

  const matches = [];

  for (const response of responses) {
    if (response.status !== 200) continue;

    try {
      const data = JSON.parse(response.data);

      for (const league of data.leagues || []) {
        for (const match of league.matches || []) {
          const matchStatus = match.status || {};

          const date =
            matchStatus.utcTime ||
            match.time ||
            match.matchTimeUTC ||
            match.utcTime;

          const rawStatus = matchStatus.finished
            ? "FINISHED"
            : matchStatus.started
            ? matchStatus.reason?.short ||
              matchStatus.reason?.long ||
              matchStatus.liveTime?.short ||
              "IN_PLAY"
            : "TIMED";

          const minute =
            parseInt(
              matchStatus.liveTime?.short ||
                matchStatus.liveTime?.long ||
                matchStatus.reason?.short
            ) || null;

          const homeScore =
            match.home?.score ??
            match.homeTeam?.score ??
            match.score?.home ??
            null;

          const awayScore =
            match.away?.score ??
            match.awayTeam?.score ??
            match.score?.away ??
            null;

          matches.push(
            makeMatch({
              id: `fm-${
                match.id ||
                `${league.id}-${match.home?.name}-${match.away?.name}-${date}`
              }`,
              competition:
                league.name || league.parentLeagueName || "Football",
              date,
              status: rawStatus,
              minute,
              home: match.home?.name || match.homeTeam?.name,
              away: match.away?.name || match.awayTeam?.name,
              hs: homeScore,
              as: awayScore,
              source: "FotMob",
              sourceUrl: match.id
                ? `https://www.fotmob.com/matches/${match.id}`
                : "https://www.fotmob.com/"
            })
          );
        }
      }
    } catch {}
  }

  if (!matches.length) {
    throw new Error("No FotMob match data returned");
  }

  return {
    name: "FotMob",
    state: "online",
    matches
  };
}

async function breakingNews() {
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
      const response = await get(feed.url);

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      return parseRss(response.data).map(item => ({
        ...item,
        source: feed.name
      }));
    })
  );

  const sourceStates = settled.map((result, index) => ({
    name: feeds[index].name,
    state: result.status === "fulfilled" ? "online" : "error"
  }));

  const items = settled.flatMap(result =>
    result.status === "fulfilled" ? result.value : []
  );

  const seen = new Set();

  const unique = items.filter(item => {
    const key = (item.link || item.title).toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  unique.sort(
    (first, second) =>
      (new Date(second.pubDate) || 0) - (new Date(first.pubDate) || 0)
  );

  return {
    items: unique.slice(0, 18),
    sources: sourceStates
  };
}

async function fotmobFixtures(dateFrom, dateTo) {
  const days = [];

  for (
    let date = new Date(`${dateFrom}T12:00:00Z`);
    date <= new Date(`${dateTo}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    days.push(date.toISOString().slice(0, 10).replaceAll("-", ""));
  }

  const responses = await Promise.all(
    days.map(day =>
      get(
        `https://www.fotmob.com/api/matches?date=${day}&timezone=Europe%2FLondon&ccode3=GBR`,
        {
          "User-Agent": "Mozilla/5.0 (compatible; FootballPulse/3.0)",
          Referer: "https://www.fotmob.com/",
          Origin: "https://www.fotmob.com"
        }
      )
    )
  );

  const fixtures = [];

  for (const response of responses) {
    if (response.status !== 200) continue;

    try {
      const data = JSON.parse(response.data);

      for (const league of data.leagues || []) {
        for (const match of league.matches || []) {
          const matchStatus = match.status || {};

          if (matchStatus.finished || matchStatus.started) continue;

          const date =
            match.status?.utcTime ||
            match.time ||
            match.matchTimeUTC ||
            match.utcTime;

          fixtures.push({
            id: String(
              match.id ||
                `${league.id}-${match.home?.name}-${match.away?.name}-${date}`
            ),
            competition:
              league.name || league.parentLeagueName || "Football",
            country: league.ccode || league.country || "",
            utcDate: date,
            homeTeam: {
              name: cleanName(match.home?.name || match.homeTeam?.name)
            },
            awayTeam: {
              name: cleanName(match.away?.name || match.awayTeam?.name)
            },
            round: match.round || match.roundName || "",
            source: {
              name: "FotMob",
              url: match.id
                ? `https://www.fotmob.com/matches/${match.id}`
                : "https://www.fotmob.com/"
            }
          });
        }
      }
    } catch {}
  }

  const seen = new Set();

  return fixtures
    .filter(fixture => {
      const key = `${fixture.id}|${fixture.utcDate}`;

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    })
    .sort(
      (first, second) =>
        new Date(first.utcDate) - new Date(second.utcDate)
    );
}

async function api(req, res) {
  if (req.url.startsWith("/api/fotmob-fixtures")) {
    const url = new URL(req.url, "http://localhost");
    const dateFrom = url.searchParams.get("dateFrom") || isoDay(0);
    const dateTo = url.searchParams.get("dateTo") || isoDay(7);

    try {
      const fixtures = await fotmobFixtures(dateFrom, dateTo);

      return send(
        res,
        200,
        JSON.stringify({
          source: "FotMob",
          unofficial: true,
          fixtures,
          message: "Upcoming fixture data loaded from FotMob web endpoints."
        })
      );
    } catch (error) {
      return send(
        res,
        200,
        JSON.stringify({
          source: "FotMob",
          unofficial: true,
          fixtures: [],
          error: error.message || "FotMob unavailable"
        })
      );
    }
  }

  if (req.url.startsWith("/api/news")) {
    try {
      return send(res, 200, JSON.stringify(await breakingNews()));
    } catch (error) {
      return send(
        res,
        200,
        JSON.stringify({
          items: [],
          sources: [],
          error: error.message || "News unavailable"
        })
      );
    }
  }

  if (req.url.startsWith("/api/matches")) {
    const url = new URL(req.url, "http://localhost");
    const dateFrom = url.searchParams.get("dateFrom") || isoDay(-1);
    const dateTo = url.searchParams.get("dateTo") || isoDay(2);

    const jobs = [
      fotmobScores(dateFrom, dateTo),
      footballData(dateFrom, dateTo),
      sportsDb(dateFrom, dateTo),
      apiFootball(dateFrom, dateTo),
      sportmonks(dateFrom, dateTo)
    ];

    const settled = await Promise.allSettled(jobs);

    const providerNames = [
      "FotMob",
      "football-data.org",
      "TheSportsDB",
      "API-Football",
      "Sportmonks"
    ];

    const providers = settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            name: providerNames[index],
            state: "error",
            matches: [],
            error: result.reason?.message || "Request failed"
          }
    );

    const merged = mergeMatches(providers);
    const liveSources = providers.some(provider => provider.state === "online");

    return send(
      res,
      200,
      JSON.stringify({
        demo: !liveSources || !merged.length,
        matches: merged.length ? merged : demoMatches,
        providers: providers.map(
          ({ name, state, error, matches }) => ({
            name,
            state,
            error,
            count: matches.length
          })
        ),
        message: liveSources
          ? "Real scores loaded and merged from available providers."
          : "Live providers are temporarily unavailable."
      })
    );
  }

  send(res, 404, JSON.stringify({ error: "Not found" }));
}

http
  .createServer(async (req, res) => {
    if (req.url.startsWith("/api/")) {
      return api(req, res);
    }

    const requestPath = decodeURIComponent(req.url.split("?")[0]);

    const file = path.join(
      ROOT,
      requestPath === "/" ? "index.html" : requestPath
    );

    if (!file.startsWith(ROOT)) {
      return send(res, 403, "Forbidden", "text/plain");
    }

    fs.readFile(file, (error, data) => {
      if (error) {
        return send(res, 404, "Not found", "text/plain");
      }

      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(file)] || "application/octet-stream"
      });

      res.end(data);
    });
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`Football Pulse running on port ${PORT}`);
  });
