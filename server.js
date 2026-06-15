```js
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;

/*
  Add these privately in Render → Environment.
  Never paste the real values into GitHub.
*/
const LIVE_SCORE_API_KEY =
  process.env.LIVE_SCORE_API_KEY || "";

const LIVE_SCORE_API_SECRET =
  process.env.LIVE_SCORE_API_SECRET || "";

const API_FOOTBALL_KEY =
  process.env.API_FOOTBALL_KEY || "";

const FOOTBALL_DATA_TOKEN =
  process.env.FOOTBALL_DATA_TOKEN || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function send(
  response,
  statusCode,
  body,
  contentType = "application/json; charset=utf-8"
) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  response.end(body);
}

function sendJson(response, statusCode, value) {
  send(
    response,
    statusCode,
    JSON.stringify(value),
    "application/json; charset=utf-8"
  );
}

/*
  Makes secure requests to football providers and RSS feeds.
*/
function request(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const requestObject = https.get(
      url,
      {
        headers: {
          "User-Agent": "FootballPulse/3.0",
          Accept:
            "application/json, application/rss+xml, text/xml, */*",
          ...headers
        }
      },
      providerResponse => {
        const redirectCodes = [
          301,
          302,
          303,
          307,
          308
        ];

        if (
          redirectCodes.includes(
            providerResponse.statusCode
          ) &&
          providerResponse.headers.location &&
          redirects < 4
        ) {
          providerResponse.resume();

          const nextUrl = new URL(
            providerResponse.headers.location,
            url
          ).toString();

          resolve(
            request(
              nextUrl,
              headers,
              redirects + 1
            )
          );

          return;
        }

        let body = "";

        providerResponse.setEncoding("utf8");

        providerResponse.on("data", chunk => {
          body += chunk;
        });

        providerResponse.on("end", () => {
          resolve({
            status:
              providerResponse.statusCode,
            headers:
              providerResponse.headers,
            body
          });
        });
      }
    );

    requestObject.setTimeout(15000, () => {
      requestObject.destroy(
        new Error(
          "The data provider took too long to respond."
        )
      );
    });

    requestObject.on("error", reject);
  });
}

function parseProviderJson(
  providerResponse,
  providerName
) {
  if (providerResponse.status !== 200) {
    throw new Error(
      `${providerName} returned HTTP ${providerResponse.status}`
    );
  }

  try {
    return JSON.parse(providerResponse.body);
  } catch {
   throw new Error(
  `${providerName} returned HTTP ${providerResponse.status}`
);
    );
  }
}

function isoDate(offset = 0) {
  const date = new Date();

  date.setUTCDate(
    date.getUTCDate() + offset
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function normaliseStatus(status) {
  const value = String(
    status || ""
  ).toUpperCase();

  if (
    [
      "LIVE",
      "IN PLAY",
      "IN_PLAY",
      "1H",
      "2H",
      "HT",
      "ET",
      "P"
    ].includes(value)
  ) {
    return value === "LIVE"
      ? "IN_PLAY"
      : value;
  }

  if (
    [
      "FT",
      "FINISHED",
      "AET",
      "PEN"
    ].includes(value)
  ) {
    return "FINISHED";
  }

  if (
    [
      "PST",
      "POSTPONED"
    ].includes(value)
  ) {
    return "POSTPONED";
  }

  if (
    [
      "CANC",
      "CANCELLED"
    ].includes(value)
  ) {
    return "CANCELLED";
  }

  return "TIMED";
}

function scoreNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

/*
  LIVE-SCORE API
  This supplies matches currently being played.
*/
async function liveScoreMatches() {
  if (
    !LIVE_SCORE_API_KEY ||
    !LIVE_SCORE_API_SECRET
  ) {
    return {
      name: "Live-Score API",
      state: "not configured",
      matches: []
    };
  }

  const endpoint =
    "https://livescore-api.com/api-client/matches/live.json" +
    `?key=${encodeURIComponent(
      LIVE_SCORE_API_KEY
    )}` +
    `&secret=${encodeURIComponent(
      LIVE_SCORE_API_SECRET
    )}`;

  const providerResponse =
    await request(endpoint);

  const payload = parseProviderJson(
    providerResponse,
    "Live-Score API"
  );

  if (payload.success === false) {
    throw new Error(
      payload.error ||
      payload.message ||
      "Live-Score API rejected the request."
    );
  }

  const games =
    payload?.data?.match ||
    payload?.data?.matches ||
    [];

  const matches = games.map(game => {
    const scoreText =
      String(game.score || "");

    const scoreParts =
      scoreText.split(/\s*-\s*/);

    const homeScore =
      scoreNumber(
        game.home_score ??
        game.score_home ??
        scoreParts[0]
      );

    const awayScore =
      scoreNumber(
        game.away_score ??
        game.score_away ??
        scoreParts[1]
      );

    return {
      id: `lsa-${game.id}`,
      provider: "Live-Score API",

      competition: {
        id:
          game.competition_id ||
          game.league_id ||
          null,

        name:
          game.competition_name ||
          game.league_name ||
          game.competition?.name ||
          "Football",

        country:
          game.country_name ||
          game.country ||
          ""
      },

      utcDate:
        game.scheduled ||
        game.start_time ||
        game.date ||
        new Date().toISOString(),

      status:
        normaliseStatus(
          game.status ||
          game.status_name ||
          "IN_PLAY"
        ),

      minute:
        Number.parseInt(
          game.minute ||
          game.time ||
          "",
          10
        ) || null,

      homeTeam:
        game.home_name ||
        game.home_team?.name ||
        game.home?.name ||
        "Home",

      awayTeam:
        game.away_name ||
        game.away_team?.name ||
        game.away?.name ||
        "Away",

      homeLogo:
        game.home_logo ||
        game.home_team?.logo ||
        "",

      awayLogo:
        game.away_logo ||
        game.away_team?.logo ||
        "",

      homeScore,
      awayScore,

      venue:
        game.location ||
        game.stadium ||
        "",

      referee: ""
    };
  });

  return {
    name: "Live-Score API",
    state: "online",
    matches
  };
}

/*
  API-FOOTBALL
  Used for fixtures, scores and detailed match statistics.
*/
function mapApiFootballMatch(item) {
  return {
    id: `af-${item.fixture?.id}`,
    provider: "API-Football",

    competition: {
      id: item.league?.id,
      name:
        item.league?.name ||
        "Football",
      country:
        item.league?.country ||
        ""
    },

    utcDate:
      item.fixture?.date,

    status:
      normaliseStatus(
        item.fixture?.status?.short
      ),

    minute:
      item.fixture?.status?.elapsed ||
      null,

    homeTeam:
      item.teams?.home?.name ||
      "Home",

    awayTeam:
      item.teams?.away?.name ||
      "Away",

    homeLogo:
      item.teams?.home?.logo ||
      "",

    awayLogo:
      item.teams?.away?.logo ||
      "",

    homeScore:
      item.goals?.home ??
      null,

    awayScore:
      item.goals?.away ??
      null,

    venue:
      item.fixture?.venue?.name ||
      "",

    referee:
      item.fixture?.referee ||
      ""
  };
}

async function apiFootballMatchesForDate(
  date
) {
  if (!API_FOOTBALL_KEY) {
    return {
      name: "API-Football",
      state: "not configured",
      matches: []
    };
  }

  const endpoint =
    "https://v3.football.api-sports.io/fixtures" +
    `?date=${encodeURIComponent(date)}`;

  const providerResponse =
    await request(
      endpoint,
      {
        "x-apisports-key":
          API_FOOTBALL_KEY
      }
    );

  const payload = parseProviderJson(
    providerResponse,
    "API-Football"
  );

  return {
    name: "API-Football",
    state: "online",

    matches:
      (payload.response || []).map(
        mapApiFootballMatch
      )
  };
}

/*
  FOOTBALL-DATA.ORG
  Optional backup for fixtures and results.
*/
async function footballDataMatches(
  dateFrom,
  dateTo
) {
  if (!FOOTBALL_DATA_TOKEN) {
    return {
      name: "football-data.org",
      state: "not configured",
      matches: []
    };
  }

  const endpoint =
    "https://api.football-data.org/v4/matches" +
    `?dateFrom=${encodeURIComponent(
      dateFrom
    )}` +
    `&dateTo=${encodeURIComponent(
      dateTo
    )}`;

  const providerResponse =
    await request(
      endpoint,
      {
        "X-Auth-Token":
          FOOTBALL_DATA_TOKEN
      }
    );

  const payload = parseProviderJson(
    providerResponse,
    "football-data.org"
  );

  const matches =
    (payload.matches || []).map(item => ({
      id: `fd-${item.id}`,
      provider: "football-data.org",

      competition: {
        id:
          item.competition?.id,
        name:
          item.competition?.name ||
          "Football",
        country:
          item.area?.name ||
          ""
      },

      utcDate:
        item.utcDate,

      status:
        normaliseStatus(
          item.status
        ),

      minute:
        item.minute ||
        null,

      homeTeam:
        item.homeTeam?.name ||
        "Home",

      awayTeam:
        item.awayTeam?.name ||
        "Away",

      homeLogo:
        item.homeTeam?.crest ||
        "",

      awayLogo:
        item.awayTeam?.crest ||
        "",

      homeScore:
        item.score?.fullTime?.home ??
        null,

      awayScore:
        item.score?.fullTime?.away ??
        null,

      venue: "",

      referee:
        item.referees?.[0]?.name ||
        ""
    }));

  return {
    name: "football-data.org",
    state: "online",
    matches
  };
}

function matchKey(match) {
  let minute = "";

  try {
    minute = new Date(
      match.utcDate
    )
      .toISOString()
      .slice(0, 16);
  } catch {
    minute = String(
      match.utcDate || ""
    );
  }

  return [
    minute,
    String(
      match.homeTeam || ""
    ).toLowerCase(),
    String(
      match.awayTeam || ""
    ).toLowerCase()
  ].join("|");
}

function isLive(match) {
  return [
    "IN_PLAY",
    "LIVE",
    "1H",
    "2H",
    "HT",
    "ET",
    "P"
  ].includes(
    String(
      match.status || ""
    ).toUpperCase()
  );
}

function mergeMatches(providerResults) {
  const merged = new Map();

  for (
    const provider of providerResults
  ) {
    for (
      const match of provider.matches || []
    ) {
      const key =
        matchKey(match);

      const existing =
        merged.get(key);

      if (!existing) {
        merged.set(key, match);
        continue;
      }

      const existingLive =
        isLive(existing);

      const newLive =
        isLive(match);

      /*
        Live-Score API takes priority
        for currently live matches.
      */
      if (
        newLive &&
        match.provider ===
          "Live-Score API"
      ) {
        merged.set(key, match);
        continue;
      }

      /*
        API-Football is preferred
        for match IDs that support
        detailed statistics.
      */
      if (
        !existingLive &&
        match.provider ===
          "API-Football"
      ) {
        merged.set(key, match);
      }
    }
  }

  return [...merged.values()].sort(
    (first, second) =>
      new Date(first.utcDate) -
      new Date(second.utcDate)
  );
}

async function loadMatches(
  dateFrom,
  dateTo
) {
  const dates = [];

  const cursor =
    new Date(
      `${dateFrom}T12:00:00Z`
    );

  const end =
    new Date(
      `${dateTo}T12:00:00Z`
    );

  while (cursor <= end) {
    dates.push(
      cursor
        .toISOString()
        .slice(0, 10)
    );

    cursor.setUTCDate(
      cursor.getUTCDate() + 1
    );
  }

  const jobs = [
    liveScoreMatches(),

    Promise.allSettled(
      dates.map(
        apiFootballMatchesForDate
      )
    ).then(results => {
      const successful =
        results
          .filter(
            result =>
              result.status ===
              "fulfilled"
          )
          .map(
            result =>
              result.value
          );

      return {
        name: "API-Football",

        state:
          successful.some(
            item =>
              item.state ===
              "online"
          )
            ? "online"
            : "not configured",

        matches:
          successful.flatMap(
            item =>
              item.matches || []
          )
      };
    }),

    footballDataMatches(
      dateFrom,
      dateTo
    )
  ];

  const settled =
    await Promise.allSettled(jobs);

  const names = [
    "Live-Score API",
    "API-Football",
    "football-data.org"
  ];

  const providers =
    settled.map(
      (result, index) => {
        if (
          result.status ===
          "fulfilled"
        ) {
          return result.value;
        }

        return {
          name: names[index],
          state: "error",
          error:
            result.reason?.message ||
            "Provider request failed.",
          matches: []
        };
      }
    );

  return {
    matches:
      mergeMatches(providers),

    providers:
      providers.map(provider => ({
        name: provider.name,
        state: provider.state,
        error: provider.error,
        count:
          provider.matches?.length ||
          0
      }))
  };
}

async function loadFixtures(
  dateFrom,
  dateTo
) {
  const data =
    await loadMatches(
      dateFrom,
      dateTo
    );

  const fixtures =
    data.matches.filter(match => {
      const status =
        String(
          match.status || ""
        ).toUpperCase();

      return (
        [
          "TIMED",
          "NS",
          "TBD",
          "SCHEDULED"
        ].includes(status) ||
        new Date(match.utcDate) >
          new Date()
      );
    });

  return {
    fixtures,
    providers: data.providers
  };
}

/*
  Detailed API-Football statistics.
*/
async function loadMatchDetails(
  rawId
) {
  if (!API_FOOTBALL_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY has not been added in Render."
    );
  }

  const fixtureId =
    String(rawId || "")
      .replace(/^af-/, "");

  if (!/^\d+$/.test(fixtureId)) {
    throw new Error(
      "Detailed statistics are only available for API-Football matches."
    );
  }

  const headers = {
    "x-apisports-key":
      API_FOOTBALL_KEY
  };

  const [
    fixtureResult,
    statisticsResult,
    eventsResult,
    lineupsResult
  ] = await Promise.all([
    request(
      `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
      headers
    ),

    request(
      `https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`,
      headers
    ),

    request(
      `https://v3.football.api-sports.io/fixtures/events?fixture=${fixtureId}`,
      headers
    ),

    request(
      `https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`,
      headers
    )
  ]);

  const fixturePayload =
    parseProviderJson(
      fixtureResult,
      "API-Football fixture"
    );

  const statisticsPayload =
    parseProviderJson(
      statisticsResult,
      "API-Football statistics"
    );

  const eventsPayload =
    parseProviderJson(
      eventsResult,
      "API-Football events"
    );

  const lineupsPayload =
    parseProviderJson(
      lineupsResult,
      "API-Football line-ups"
    );

  const fixture =
    fixturePayload.response?.[0];

  if (!fixture) {
    throw new Error(
      "The provider has not returned this match."
    );
  }

  function statisticsMap(
    teamData
  ) {
    const map = {};

    for (
      const item of
      teamData?.statistics || []
    ) {
      map[item.type] =
        item.value;
    }

    return map;
  }

  const statisticsTeams =
    statisticsPayload.response || [];

  const homeStatistics =
    statisticsMap(
      statisticsTeams[0]
    );

  const awayStatistics =
    statisticsMap(
      statisticsTeams[1]
    );

  const importantStatistics = [
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
      status:
        fixture.fixture?.status?.short ||
        "",

      minute:
        fixture.fixture?.status?.elapsed ||
        null,

      home:
        fixture.teams?.home?.name ||
        "Home",

      away:
        fixture.teams?.away?.name ||
        "Away",

      homeLogo:
        fixture.teams?.home?.logo ||
        "",

      awayLogo:
        fixture.teams?.away?.logo ||
        "",

      homeScore:
        fixture.goals?.home ??
        0,

      awayScore:
        fixture.goals?.away ??
        0,

      venue:
        fixture.fixture?.venue?.name ||
        "",

      referee:
        fixture.fixture?.referee ||
        ""
    },

    statistics:
      importantStatistics.map(
        name => ({
          name,
          home:
            homeStatistics[name] ??
            0,
          away:
            awayStatistics[name] ??
            0
        })
      ),

    events:
      (eventsPayload.response || [])
        .map(event => ({
          minute:
            event.time?.elapsed ??
            null,

          extraMinute:
            event.time?.extra ??
            null,

          team:
            event.team?.name ||
            "",

          player:
            event.player?.name ||
            "",

          assist:
            event.assist?.name ||
            "",

          type:
            event.type ||
            "",

          detail:
            event.detail ||
            "",

          comments:
            event.comments ||
            ""
        })),

    lineups:
      (lineupsPayload.response || [])
        .map(lineup => ({
          team:
            lineup.team?.name ||
            "",

          formation:
            lineup.formation ||
            "",

          startingXI:
            lineup.startXI ||
            [],

          substitutes:
            lineup.substitutes ||
            []
        })),

    updatedAt:
      new Date().toISOString(),

    source:
      "API-Football"
  };
}

/*
  Breaking football news.
*/
function decodeXml(value = "") {
  return value
    .replace(
      /<!\[CDATA\[|\]\]>/g,
      ""
    )
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .trim();
}

function parseRss(xml, source) {
  const items = [
    ...xml.matchAll(
      /<item>([\s\S]*?)<\/item>/gi
    )
  ];

  return items
    .slice(0, 10)
    .map(match => {
      const block = match[1];

      function tag(name) {
        const result =
          block.match(
            new RegExp(
              `<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,
              "i"
            )
          );

        return result
          ? decodeXml(result[1])
          : "";
      }

      return {
        source,
        title: tag("title"),
        link: tag("link"),
        description:
          tag("description"),
        pubDate:
          tag("pubDate")
      };
    });
}

async function loadNews() {
  const feeds = [
    {
      name: "BBC Sport",
      url:
        "https://feeds.bbci.co.uk/sport/football/rss.xml"
    },
    {
      name: "The Guardian",
      url:
        "https://www.theguardian.com/football/rss"
    },
    {
      name: "ESPN",
      url:
        "https://www.espn.com/espn/rss/soccer/news"
    }
  ];

  const settled =
    await Promise.allSettled(
      feeds.map(async feed => {
        const providerResponse =
          await request(feed.url);

        if (
          providerResponse.status !== 200
        ) {
          throw new Error(
            `HTTP ${providerResponse.status}`
          );
        }

        return parseRss(
          providerResponse.body,
          feed.name
        );
      })
    );

  const items =
    settled.flatMap(result =>
      result.status === "fulfilled"
        ? result.value
        : []
    );

  const seen = new Set();

  return items
    .filter(item => {
      const key =
        String(
          item.link ||
          item.title ||
          ""
        ).toLowerCase();

      if (
        !key ||
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort(
      (first, second) =>
        new Date(second.pubDate) -
        new Date(first.pubDate)
    )
    .slice(0, 18);
}

/*
  Website API routes.
*/
async function handleApi(
  requestObject,
  response
) {
  const url = new URL(
    requestObject.url,
    "http://localhost"
  );

  try {
    if (
      url.pathname ===
      "/api/matches"
    ) {
      const dateFrom =
        url.searchParams.get(
          "dateFrom"
        ) || isoDate(-1);

      const dateTo =
        url.searchParams.get(
          "dateTo"
        ) || isoDate(1);

      const data =
        await loadMatches(
          dateFrom,
          dateTo
        );

      return sendJson(
        response,
        200,
        data
      );
    }

    if (
      url.pathname ===
      "/api/fixtures"
    ) {
      const dateFrom =
        url.searchParams.get(
          "dateFrom"
        ) || isoDate(0);

      const dateTo =
        url.searchParams.get(
          "dateTo"
        ) || isoDate(7);

      const data =
        await loadFixtures(
          dateFrom,
          dateTo
        );

      return sendJson(
        response,
        200,
        data
      );
    }

    if (
      url.pathname ===
      "/api/match-details"
    ) {
      const id =
        url.searchParams.get("id");

      const data =
        await loadMatchDetails(id);

      return sendJson(
        response,
        200,
        data
      );
    }

    if (
      url.pathname ===
      "/api/news"
    ) {
      const items =
        await loadNews();

      return sendJson(
        response,
        200,
        { items }
      );
    }

    return sendJson(
      response,
      404,
      {
        error:
          "API route not found."
      }
    );
  } catch (error) {
    console.error(error);

    return sendJson(
      response,
      502,
      {
        error:
          error.message ||
          "The data provider could not be reached."
      }
    );
  }
}

/*
  Serves index.html, styles.css, app.js,
  logo.svg and other website files.
*/
function serveFile(
  requestObject,
  response
) {
  const requestPath =
    decodeURIComponent(
      requestObject.url.split("?")[0]
    );

  const relativePath =
    requestPath === "/"
      ? "index.html"
      : requestPath.replace(
          /^\/+/,
          ""
        );

  const rootPath =
    path.resolve(ROOT);

  const filePath =
    path.resolve(
      ROOT,
      relativePath
    );

  if (
    !filePath.startsWith(rootPath)
  ) {
    return send(
      response,
      403,
      "Forbidden",
      "text/plain; charset=utf-8"
    );
  }

  fs.readFile(
    filePath,
    (error, content) => {
      if (error) {
        return send(
          response,
          404,
          "Not found",
          "text/plain; charset=utf-8"
        );
      }

      const extension =
        path
          .extname(filePath)
          .toLowerCase();

      const contentType =
        mimeTypes[extension] ||
        "application/octet-stream";

      send(
        response,
        200,
        content,
        contentType
      );
    }
  );
}

const server =
  http.createServer(
    (
      requestObject,
      response
    ) => {
      if (
        requestObject.url.startsWith(
          "/api/"
        )
      ) {
        handleApi(
          requestObject,
          response
        );

        return;
      }

      serveFile(
        requestObject,
        response
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Football Pulse is running on port ${PORT}`
    );
  }
);
```
