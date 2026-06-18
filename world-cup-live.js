const $ = selector => document.querySelector(selector);

let groups = {};
let currentData = {
  results: [],
  fixtures: [],
  live: []
};

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function teamGroup(team) {
  for (const [group, teams] of Object.entries(groups)) {
    if (teams.includes(team)) return group;
  }

  return "";
}

function allWorldCupMatches() {
  const matches = [
    ...(currentData.results || []),
    ...(currentData.fixtures || []),
    ...(currentData.live || [])
  ];

  const seen = new Set();

  return matches.filter(match => {
    const homeGroup = teamGroup(match.homeTeam);
    const awayGroup = teamGroup(match.awayTeam);
    const competition = String(match.competition || "").toLowerCase();

    if (!homeGroup && !awayGroup && !competition.includes("world cup")) {
      return false;
    }

    const key =
      `${match.id}|${match.utcDate}|${match.homeTeam}|${match.awayTeam}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function initialStandings() {
  const standings = {};

  for (const [group, teams] of Object.entries(groups)) {
    standings[group] = teams.map(team => ({
      team,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0
    }));
  }

  return standings;
}

function isGroupMatch(match) {
  const homeGroup = teamGroup(match.homeTeam);
  const awayGroup = teamGroup(match.awayTeam);

  return homeGroup && homeGroup === awayGroup;
}

function buildStandings(matches) {
  const standings = initialStandings();

  for (const match of matches.filter(isGroupMatch)) {
    if (match.homeScore === null || match.homeScore === undefined) continue;
    if (match.awayScore === null || match.awayScore === undefined) continue;

    const group = teamGroup(match.homeTeam);
    const home = standings[group].find(row => row.team === match.homeTeam);
    const away = standings[group].find(row => row.team === match.awayTeam);

    if (!home || !away) continue;

    const homeScore = Number(match.homeScore);
    const awayScore = Number(match.awayScore);

    home.played += 1;
    away.played += 1;
    home.gf += homeScore;
    home.ga += awayScore;
    away.gf += awayScore;
    away.ga += homeScore;

    if (homeScore > awayScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (awayScore > homeScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }

    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;
  }

  for (const rows of Object.values(standings)) {
    rows.sort((a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.team.localeCompare(b.team)
    );
  }

  return standings;
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0])
    .join("")
    .toUpperCase();
}

async function hydrateFlags() {
  const elements = [...document.querySelectorAll("[data-flag-team]")];

  await Promise.all(elements.map(async element => {
    const team = element.dataset.flagTeam;

    try {
      const asset = await getJson(
        `/api/team-assets?team=${encodeURIComponent(team)}&country=${encodeURIComponent(team)}`
      );

      if (asset.flag) {
        element.innerHTML =
          `<img src="${safe(asset.flag)}" alt="${safe(team)} flag">`;
      }
    } catch {
      // Keep initials fallback.
    }
  }));
}

function renderGroups(standings) {
  $("#groupsGrid").innerHTML = Object.entries(standings).map(([group, rows]) => `
    <article class="live-group-card">
      <h3>Group ${safe(group)}</h3>
      <table class="live-group-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr class="${index < 2 ? "auto-qualified" : index === 2 ? "third-place-row" : ""}">
              <td>${index + 1}</td>
              <td>
                <div class="group-team">
                  <span class="group-flag" data-flag-team="${safe(row.team)}">
                    ${safe(initials(row.team))}
                  </span>
                  <strong>${safe(row.team)}</strong>
                </div>
              </td>
              <td>${row.played}</td>
              <td>${row.won}</td>
              <td>${row.drawn}</td>
              <td>${row.lost}</td>
              <td>${row.gd}</td>
              <td class="group-points">${row.points}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `).join("");

  hydrateFlags();
}

function knockoutStage(match) {
  const text = `${match.stage || ""} ${match.round || ""} ${match.competition || ""}`.toLowerCase();

  if (text.includes("round of 32")) return "Round of 32";
  if (text.includes("round of 16")) return "Round of 16";
  if (text.includes("quarter")) return "Quarter-finals";
  if (text.includes("semi")) return "Semi-finals";
  if (text.includes("third")) return "Third-place";
  if (text.includes("final")) return "Final";

  return "";
}

function buildBracket(matches) {
  const stages = {
    "Round of 32": [],
    "Round of 16": [],
    "Quarter-finals": [],
    "Semi-finals": [],
    "Third-place": [],
    "Final": []
  };

  for (const match of matches) {
    if (isGroupMatch(match)) continue;

    const stage = knockoutStage(match);
    if (stage) stages[stage].push(match);
  }

  return stages;
}

function stageColumn(stage, matches) {
  const expected = {
    "Round of 32": 16,
    "Round of 16": 8,
    "Quarter-finals": 4,
    "Semi-finals": 2,
    "Third-place": 1,
    "Final": 1
  };

  const total = Math.max(matches.length, expected[stage] || 1);
  const slots = Array.from({ length: total }, (_, index) => matches[index] || null);

  return `
    <section class="bracket-round">
      <h3>${safe(stage)}</h3>
      ${slots.map(match => {
        if (!match) {
          return `
            <div class="bracket-match">
              <div class="bracket-team"><span>To be decided</span><strong>–</strong></div>
              <div class="bracket-team"><span>To be decided</span><strong>–</strong></div>
            </div>
          `;
        }

        const homeScore = match.homeScore;
        const awayScore = match.awayScore;
        const homeWinner =
          homeScore !== null &&
          awayScore !== null &&
          Number(homeScore) > Number(awayScore);
        const awayWinner =
          homeScore !== null &&
          awayScore !== null &&
          Number(awayScore) > Number(homeScore);

        return `
          <div class="bracket-match">
            <div class="bracket-team ${homeWinner ? "winner" : ""}">
              <span>${safe(match.homeTeam)}</span>
              <strong>${safe(homeScore ?? "–")}</strong>
            </div>
            <div class="bracket-team ${awayWinner ? "winner" : ""}">
              <span>${safe(match.awayTeam)}</span>
              <strong>${safe(awayScore ?? "–")}</strong>
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function renderBracket(bracket) {
  const order = [
    "Round of 32",
    "Round of 16",
    "Quarter-finals",
    "Semi-finals",
    "Third-place",
    "Final"
  ];

  $("#worldBracket").innerHTML = order
    .map(stage => stageColumn(stage, bracket[stage] || []))
    .join("");
}

async function loadWorldCup() {
  const status = $("#worldCupStatus");
  status.className = "status-box";
  status.textContent = "Loading live World Cup tables and bracket…";

  try {
    groups = await getJson("/world-cup-groups.json");

    const [resultsData, liveData, fixturesData] = await Promise.all([
      getJson("/api/results?dateFrom=2026-06-11&dateTo=2026-07-19"),
      getJson("/api/live"),
      getJson("/api/fixtures?dateFrom=2026-06-11&dateTo=2026-07-19")
    ]);

    currentData.results = resultsData.results || [];
    currentData.live = liveData.matches || [];
    currentData.fixtures = fixturesData.fixtures || [];

    const matches = allWorldCupMatches();
    const standings = buildStandings(matches);
    const bracket = buildBracket(matches);

    renderGroups(standings);
    renderBracket(bracket);

    const now = new Date();
    $("#lastUpdated").textContent =
      `Updated ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    status.className = "status-box success";
    status.textContent =
      `${matches.length} World Cup fixture${matches.length === 1 ? "" : "s"} loaded.`;
  } catch (error) {
    status.className = "status-box error";
    status.textContent = error.message;
  }
}

document.querySelectorAll(".wc-view-button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".wc-view-button").forEach(item =>
      item.classList.remove("active")
    );

    button.classList.add("active");

    document.querySelectorAll(".wc-view").forEach(view => {
      view.hidden = view.id !== button.dataset.view;
    });
  });
});

$("#refreshWorldCup").addEventListener("click", loadWorldCup);

$("#menuButton").addEventListener("click", () => {
  const menu = $("#mobileMenu");
  menu.hidden = !menu.hidden;
});

document.querySelectorAll("#mobileMenu a").forEach(link => {
  link.addEventListener("click", () => {
    $("#mobileMenu").hidden = true;
  });
});

loadWorldCup();
setInterval(loadWorldCup, 60000);
