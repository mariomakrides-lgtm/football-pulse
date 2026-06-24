const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 10000;
const ROOT = path.resolve(__dirname);
const COUNTRY_CODES = JSON.parse(
  fs.readFileSync(path.join(ROOT, "country-codes.json"), "utf8")
);

const LIVE_SCORE_API_KEY = process.env.LIVE_SCORE_API_KEY || "";
const LIVE_SCORE_API_SECRET = process.env.LIVE_SCORE_API_SECRET || "";

const cache = new Map();
const teamAssetCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
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

function parseScorePair(value) {
  if (value === null || value === undefined) {
    return { home: null, away: null };
  }

  if (Array.isArray(value) && value.length >= 2) {
    const home = Number.parseInt(value[0], 10);
    const away = Number.parseInt(value[1], 10);

    return {
      home: Number.isFinite(home) ? home : null,
      away: Number.isFinite(away) ? away : null
    };
  }

  if (typeof value === "object") {
    const home =
      value.home ??
      value.home_score ??
      value.score_home ??
      value.localteam_score ??
      value.local ??
      value.team1 ??
      value.first;

    const away =
      value.away ??
      value.away_score ??
      value.score_away ??
      value.visitorteam_score ??
      value.visitor ??
      value.team2 ??
      value.second;

    if (home !== undefined || away !== undefined) {
      return {
        home: Number.isFinite(Number(home)) ? Number(home) : null,
        away: Number.isFinite(Number(away)) ? Number(away) : null
      };
    }

    for (const nestedValue of Object.values(value)) {
      const parsed = parseScorePair(nestedValue);

      if (parsed.home !== null || parsed.away !== null) {
        return parsed;
      }
    }

    return { home: null, away: null };
  }

  const text = String(value)
    .replace(/[–—:]/g, "-")
    .replace(/\([^)]*\)/g, "")
    .trim();

  const match = text.match(/(-?\d+)\s*-\s*(-?\d+)/);

  if (!match) {
    return { home: null, away: null };
  }

  return {
    home: Number.parseInt(match[1], 10),
    away: Number.parseInt(match[2], 10)
  };
}

function scoreParts(match) {
  const directHome =
    match.home_score ??
    match.score_home ??
    match.localteam_score ??
    match.homeTeamScore ??
    match.home?.score ??
    match.home_team?.score;

  const directAway =
    match.away_score ??
    match.score_away ??
    match.visitorteam_score ??
    match.awayTeamScore ??
    match.away?.score ??
    match.away_team?.score;

  if (directHome !== undefined || directAway !== undefined) {
    return {
      home: Number.isFinite(Number(directHome)) ? Number(directHome) : null,
      away: Number.isFinite(Number(directAway)) ? Number(directAway) : null
    };
  }

  const candidates = [
    match.scores?.score,
    match.scores?.current,
    match.scores?.fulltime,
    match.scores?.full_time,
    match.scores,
    match.score,
    match.score_string,
    match.result,
    match.ft_score,
    match.full_time_score
  ];

  for (const candidate of candidates) {
    const parsed = parseScorePair(candidate);

    if (parsed.home !== null || parsed.away !== null) {
      return parsed;
    }
  }

  return { home: null, away: null };
}

function collectArrays(value, wantedKeys, output = []) {
  if (!value || typeof value !== "object") {
    return output;
  }

  if (Array.isArray(value)) {
    output.push(value);

    for (const item of value) {
      collectArrays(item, wantedKeys, output);
    }

    return output;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (wantedKeys.has(String(key).toLowerCase()) && Array.isArray(nested)) {
      output.push(nested);
    }

    collectArrays(nested, wantedKeys, output);
  }

  return output;
}

function firstUsefulArray(payload, keys) {
  const arrays = collectArrays(
    payload,
    new Set(keys.map(key => key.toLowerCase()))
  );

  return arrays.find(items => items.length > 0) || [];
}

function eventMinute(item) {
  const raw =
    item.minute ??
    item.time ??
    item.match_time ??
    item.elapsed ??
    item.period_time ??
    "";

  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventPlayer(item) {
  return (
    item.player_name ||
    item.player?.name ||
    item.player ||
    item.scorer_name ||
    item.scorer?.name ||
    item.scorer ||
    item.name ||
    ""
  );
}

function eventTeam(item) {
  return (
    item.team_name ||
    item.team?.name ||
    item.team ||
    item.side_name ||
    item.side ||
    ""
  );
}

function normalizeSingleEvent(item) {
  const type =
    item.type ||
    item.event ||
    item.event_type ||
    item.action ||
    item.kind ||
    "";

  const detail =
    item.detail ||
    item.event_name ||
    item.description ||
    item.note ||
    type;

  return {
    minute: eventMinute(item),
    team: String(eventTeam(item) || ""),
    player: String(eventPlayer(item) || ""),
    assist: String(
      item.assist_name ||
      item.assist?.name ||
      item.assist ||
      ""
    ),
    type: String(type || ""),
    detail: String(detail || "")
  };
}

function isGoalEvent(item) {
  const text = `${item.type} ${item.detail}`.toLowerCase();

  return (
    text.includes("goal") &&
    !text.includes("disallowed") &&
    !text.includes("cancelled")
  );
}

function inlineEventsFromMatch(match) {
  const arrays = [
    ...collectArrays(match.events, new Set(["events", "event", "data"])),
    ...collectArrays(match.goals, new Set(["goals", "goal", "data"])),
    ...collectArrays(match.scorers, new Set(["scorers", "scorer", "data"]))
  ];

  if (Array.isArray(match.events)) arrays.unshift(match.events);
  if (Array.isArray(match.goals)) arrays.unshift(match.goals);
  if (Array.isArray(match.scorers)) arrays.unshift(match.scorers);

  const flat = arrays.flat().filter(item => item && typeof item === "object");

  const seen = new Set();

  return flat
    .map(normalizeSingleEvent)
    .filter(item => item.type || item.detail || item.player)
    .filter(item => {
      const key = `${item.minute}|${item.team}|${item.player}|${item.type}|${item.detail}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));
}


function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function providerTeamLogo(team, side) {
  const teamObject =
    side === "home"
      ? team.home_team || team.home || team.localteam || {}
      : team.away_team || team.away || team.visitorteam || {};

  return firstString(
    teamObject.logo,
    teamObject.badge,
    teamObject.image,
    teamObject.crest,
    teamObject.strTeamBadge,
    side === "home" ? team.home_logo : team.away_logo,
    side === "home" ? team.home_badge : team.away_badge,
    side === "home" ? team.home_image : team.away_image,
    side === "home" ? team.home_crest : team.away_crest
  );
}

function providerTeamId(team, side) {
  const teamObject =
    side === "home"
      ? team.home_team || team.home || team.localteam || {}
      : team.away_team || team.away || team.visitorteam || {};

  return String(
    teamObject.id ||
    teamObject.team_id ||
    (side === "home" ? team.home_id : team.away_id) ||
    (side === "home" ? team.home_team_id : team.away_team_id) ||
    ""
  );
}

function normaliseCountryName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function countryCodeForName(name) {
  const key = normaliseCountryName(name).toLowerCase();
  return COUNTRY_CODES[key] || "";
}

function flagUrlForCode(code) {
  if (!code) return "";

  if (code.startsWith("gb-")) {
    return `https://flagcdn.com/w80/${code}.png`;
  }

  return `https://flagcdn.com/w80/${code.toLowerCase()}.png`;
}

async function resolveTeamAsset(teamName, countryName = "") {
  const cleanTeam = String(teamName || "").trim();
  const cleanCountry = normaliseCountryName(countryName);
  const cacheKey = `${cleanTeam.toLowerCase()}|${cleanCountry.toLowerCase()}`;

  const existing = teamAssetCache.get(cacheKey);

  if (existing && Date.now() - existing.createdAt < 24 * 60 * 60 * 1000) {
    return existing.value;
  }

  const countryCode = countryCodeForName(cleanCountry || cleanTeam);
  const nationalFlag = flagUrlForCode(countryCode);

  let badge = "";
  let source = "";

  if (cleanTeam) {
    try {
      const searchUrl =
        "https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=" +
        encodeURIComponent(cleanTeam);

      const response = await fetchText(searchUrl);

      if (response.status === 200) {
        const payload = JSON.parse(response.body);
        const teams = Array.isArray(payload.teams) ? payload.teams : [];

        const footballTeams = teams.filter(team =>
          String(team.strSport || "").toLowerCase() === "soccer"
        );

        const exact = footballTeams.find(team =>
          String(team.strTeam || "").toLowerCase() === cleanTeam.toLowerCase()
        );

        const chosen = exact || footballTeams[0] || teams[0];

        badge = firstString(
          chosen?.strBadge,
          chosen?.strTeamBadge,
          chosen?.strLogo
        );

        if (badge) source = "TheSportsDB";
      }
    } catch (error) {
      console.error(`Badge lookup failed for ${cleanTeam}:`, error.message);
    }
  }

  const value = {
    team: cleanTeam,
    badge,
    flag: nationalFlag,
    countryCode,
    source
  };

  teamAssetCache.set(cacheKey, {
    value,
    createdAt: Date.now()
  });

  return value;
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
    homeTeamId: providerTeamId(match, "home"),
    awayTeamId: providerTeamId(match, "away"),
    homeLogo: providerTeamLogo(match, "home"),
    awayLogo: providerTeamLogo(match, "away"),
    countryCode:
      String(
        match.country_code ||
        match.country?.code ||
        match.country?.iso2 ||
        ""
      ).toLowerCase(),
    homeScore: scores.home,
    awayScore: scores.away,
    events: inlineEventsFromMatch(match),
    scorers: inlineEventsFromMatch(match).filter(isGoalEvent),
    urls: match.urls || {},
    rawLinks: {
      statistics:
        match.statistics_url ||
        match.stats_url ||
        match.urls?.statistics ||
        match.urls?.stats ||
        "",
      events:
        match.events_url ||
        match.incidents_url ||
        match.urls?.events ||
        match.urls?.incidents ||
        ""
    }
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

function cleanStatValue(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "object") {
    return (
      value.value ??
      value.total ??
      value.count ??
      value.number ??
      0
    );
  }

  return value;
}

function normalizeStatistics(payload) {
  const list = firstUsefulArray(payload, [
    "statistics",
    "stats",
    "match_statistics",
    "team_statistics",
    "data"
  ]);

  const normalized = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;

    if (
      item.home !== undefined ||
      item.away !== undefined ||
      item.home_value !== undefined ||
      item.away_value !== undefined
    ) {
      normalized.push({
        type: String(item.type || item.label || item.name || "Statistic"),
        label: String(item.label || item.type || item.name || "Statistic"),
        home: cleanStatValue(
          item.home ??
          item.home_value ??
          item.local ??
          item.team1
        ),
        away: cleanStatValue(
          item.away ??
          item.away_value ??
          item.visitor ??
          item.team2
        )
      });

      continue;
    }

    const homeStats =
      item.home_team ||
      item.homeTeam ||
      item.localteam ||
      item.local ||
      null;

    const awayStats =
      item.away_team ||
      item.awayTeam ||
      item.visitorteam ||
      item.visitor ||
      null;

    if (
      homeStats &&
      awayStats &&
      typeof homeStats === "object" &&
      typeof awayStats === "object"
    ) {
      const keys = new Set([
        ...Object.keys(homeStats),
        ...Object.keys(awayStats)
      ]);

      for (const key of keys) {
        normalized.push({
          type: key,
          label: key
            .replaceAll("_", " ")
            .replace(/\b\w/g, letter => letter.toUpperCase()),
          home: cleanStatValue(homeStats[key]),
          away: cleanStatValue(awayStats[key])
        });
      }
    }
  }

  const seen = new Set();

  return normalized.filter(stat => {
    const key = stat.label.toLowerCase();

    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeEvents(payload) {
  const list = firstUsefulArray(payload, [
    "events",
    "event",
    "incidents",
    "timeline",
    "goals",
    "scorers",
    "data"
  ]);

  const seen = new Set();

  return list
    .filter(item => item && typeof item === "object")
    .map(normalizeSingleEvent)
    .filter(item => item.type || item.detail || item.player)
    .filter(item => {
      const key =
        `${item.minute}|${item.team}|${item.player}|${item.type}|${item.detail}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));
}

function matchDetailCandidateUrls(match, type) {
  const id = encodeURIComponent(match.id);
  const urls = [];

  const providerUrl =
    type === "statistics"
      ? match.rawLinks?.statistics || match.urls?.statistics || match.urls?.stats
      : match.rawLinks?.events || match.urls?.events || match.urls?.incidents;

  if (providerUrl) {
    urls.push(addCredentialsToProviderUrl(providerUrl));
  }

  if (type === "statistics") {
    urls.push(
      `https://livescore-api.com/api-client/matches/statistics.json?${apiCredentials()}&match_id=${id}`,
      `https://livescore-api.com/api-client/matches/stats.json?${apiCredentials()}&match_id=${id}`
    );
  } else {
    urls.push(
      `https://livescore-api.com/api-client/matches/events.json?${apiCredentials()}&match_id=${id}`,
      `https://livescore-api.com/api-client/matches/incidents.json?${apiCredentials()}&match_id=${id}`
    );
  }

  return [...new Set(urls.filter(Boolean))];
}

async function firstSuccessfulPayload(urls, providerName) {
  const errors = [];

  for (const url of urls) {
    try {
      return {
        payload: await fetchJson(url, providerName),
        source: new URL(url).pathname
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    payload: { data: [] },
    source: "",
    error: errors[0] || `${providerName} data is unavailable.`
  };
}

async function loadMatchDetails(matchId) {
  const matches = await loadLiveMatches();
  const match = matches.find(item => String(item.id) === String(matchId));

  if (!match) {
    throw new Error("This live match is no longer available.");
  }

  const [statisticsResult, eventsResult] = await Promise.all([
    firstSuccessfulPayload(
      matchDetailCandidateUrls(match, "statistics"),
      "Live-Score API statistics"
    ),
    firstSuccessfulPayload(
      matchDetailCandidateUrls(match, "events"),
      "Live-Score API events"
    )
  ]);

  const fetchedEvents = normalizeEvents(eventsResult.payload);
  const combinedEvents = [...(match.events || []), ...fetchedEvents];
  const seenEvents = new Set();

  const events = combinedEvents
    .filter(item => {
      const key =
        `${item.minute}|${item.team}|${item.player}|${item.type}|${item.detail}`;

      if (seenEvents.has(key)) return false;
      seenEvents.add(key);
      return true;
    })
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));

  return {
    match: {
      ...match,
      scorers: events.filter(isGoalEvent)
    },
    statistics: normalizeStatistics(statisticsResult.payload),
    events,
    availability: {
      statistics: statisticsResult.source
        ? "available"
        : "not supplied by this match or subscription",
      events: eventsResult.source || match.events?.length
        ? "available"
        : "not supplied by this match or subscription"
    },
    diagnostics: {
      statisticsSource: statisticsResult.source,
      eventsSource: eventsResult.source,
      statisticsError: statisticsResult.error || "",
      eventsError: eventsResult.error || ""
    },
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

    if (url.pathname === "/api/team-assets") {
      const team = url.searchParams.get("team") || "";
      const country = url.searchParams.get("country") || "";

      if (!team && !country) {
        return sendJson(res, 400, {
          error: "A team or country name is required."
        });
      }

      return sendJson(
        res,
        200,
        await resolveTeamAsset(team, country)
      );
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
