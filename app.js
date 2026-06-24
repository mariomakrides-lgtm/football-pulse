const state = {
  fixtures: [],
  selectedDate: dateKey(new Date()),
  activeMatchId: null,
  detailTimer: null
};

const $ = selector => document.querySelector(selector);

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBC";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return seconds < 0 ? "just now" : "soon";
  const minutes = Math.round(absolute / 60);
  if (minutes < 60) return seconds < 0 ? `${minutes}m ago` : `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return seconds < 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return seconds < 0 ? `${days}d ago` : `in ${days}d`;
}

function countdown(value) {
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return "Starting soon";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

const assetCache = new Map();

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(word => word[0])
    .join("")
    .toUpperCase();
}

async function hydrateTeamAssets() {
  const elements = [...document.querySelectorAll("[data-team-asset]")];

  await Promise.all(elements.map(async element => {
    const team = element.dataset.team || "";
    const country = element.dataset.country || "";
    const providerLogo = element.dataset.logo || "";
    const key = `${team}|${country}`;

    let asset = assetCache.get(key);

    if (!asset) {
      asset = {
        badge: providerLogo,
        flag: ""
      };

      if (!providerLogo) {
        try {
          asset = await getJson(
            `/api/team-assets?team=${encodeURIComponent(team)}&country=${encodeURIComponent(country)}`
          );
        } catch {
          asset = {
            badge: "",
            flag: ""
          };
        }
      }

      assetCache.set(key, asset);
    }

    const imageUrl = providerLogo || asset.badge || asset.flag;

    if (imageUrl) {
      element.innerHTML = `
        <img
          src="${safe(imageUrl)}"
          alt="${safe(team || country)}"
          loading="lazy"
          referrerpolicy="no-referrer">
      `;
      element.classList.add("has-image");
    }
  }));
}


function providerPills(providers) {
  $("#providerStrip").innerHTML = (providers || []).map(provider => `
    <span class="provider-pill ${safe(provider.state)}">
      ${safe(provider.name)} · ${safe(provider.state)}
      ${Number.isFinite(provider.count) ? ` · ${provider.count}` : ""}
    </span>
  `).join("");
}

function isLive(status) {
  return ["IN PLAY", "IN_PLAY", "LIVE", "HALF TIME BREAK", "HT", "1H", "2H"].includes(String(status || "").toUpperCase());
}

function scoreValue(value) {
  return value === null || value === undefined || value === "" ? "–" : value;
}

const competitionPriority = [
  "FIFA World Cup", "World Cup", "UEFA Champions League", "Champions League",
  "Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1",
  "Europa League", "Conference League", "Championship", "League One"
];

function competitionRank(name) {
  const text = String(name || "").toLowerCase();
  const index = competitionPriority.findIndex(item => text.includes(item.toLowerCase()));
  return index === -1 ? 999 : index;
}

function isWorldCupMatch(match) {
  const competition = String(match.competition || "").toLowerCase();
  return competition.includes("world cup") || competition.includes("fifa");
}

function sortImportantMatches(matches) {
  return [...matches].sort((a, b) => {
    const priorityDifference = competitionRank(a.competition) - competitionRank(b.competition);
    if (priorityDifference !== 0) return priorityDifference;
    const aLive = isLive(a.status) ? 0 : 1;
    const bLive = isLive(b.status) ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return String(a.homeTeam).localeCompare(String(b.homeTeam));
  });
}

const knownTeamColours = {
  "argentina": ["#74acdf", "#ffffff"],
  "algeria": ["#006633", "#ffffff"],
  "england": ["#ffffff", "#cf081f"],
  "france": ["#002395", "#ed2939"],
  "senegal": ["#00853f", "#fdef42"],
  "brazil": ["#ffdf00", "#009c3b"],
  "germany": ["#111111", "#dd0000"],
  "spain": ["#aa151b", "#f1bf00"],
  "portugal": ["#046a38", "#da291c"],
  "netherlands": ["#f36c21", "#1a2b57"],
  "scotland": ["#005eb8", "#ffffff"],
  "croatia": ["#ff0000", "#ffffff"],
  "mexico": ["#006847", "#ce1126"],
  "united states": ["#002868", "#bf0a30"],
  "canada": ["#d80621", "#ffffff"],
  "australia": ["#ffcd00", "#00843d"],
  "japan": ["#ffffff", "#bc002d"],
  "belgium": ["#111111", "#ef3340"],
  "uruguay": ["#5bc0eb", "#ffffff"],
  "italy": ["#0066b2", "#ffffff"],
  "tottenham hotspur": ["#ffffff", "#132257"],
  "arsenal": ["#ef0107", "#ffffff"],
  "chelsea": ["#034694", "#ffffff"],
  "liverpool": ["#c8102e", "#00b2a9"],
  "manchester city": ["#6cabdd", "#ffffff"],
  "manchester united": ["#da291c", "#fbe122"],
  "newcastle united": ["#111111", "#ffffff"]
};

function hashColour(text, offset = 0) {
  let hash = offset;

  for (const character of String(text || "Football")) {
    hash = character.charCodeAt(0) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 72% 46%)`;
}

function teamColours(teamName) {
  const known = knownTeamColours[String(teamName || "").toLowerCase()];

  if (known) return known;

  return [
    hashColour(teamName, 19),
    hashColour(teamName, 173)
  ];
}

function scorerText(match, teamName) {
  const scorers = (match.scorers || [])
    .filter(event => {
      if (!event.team) return true;
      return String(event.team).toLowerCase().includes(
        String(teamName).toLowerCase()
      );
    })
    .map(event => {
      const minute = event.minute ? ` ${event.minute}'` : "";
      return `${event.player || "Goal"}${minute}`;
    });

  return scorers.join(", ");
}

function liveLabel(match) {
  if (isLive(match.status)) return match.minute ? `${match.minute}'` : "LIVE";
  return match.status || formatTime(match.utcDate);
}

async function loadScores() {
  const status = $("#scoreStatus");
  status.className = "status-box";
  status.textContent = "Connecting to Live-Score API…";

  try {
    const data = await getJson("/api/live");
    providerPills(data.providers);

    const matches = data.matches || [];
    if (!matches.length) {
      $("#matches").innerHTML = `<div class="empty">There are no matches live right now.</div>`;
      status.className = "status-box success";
      status.textContent = "Live-Score API is connected. No matches are currently in play.";
      return;
    }

    $("#matches").innerHTML = matches.map(match => {
      const homeColours = teamColours(match.homeTeam);
      const awayColours = teamColours(match.awayTeam);
      const homeScorers = scorerText(match, match.homeTeam);
      const awayScorers = scorerText(match, match.awayTeam);

      return `
        <article
          class="match-card team-colour-card ${isWorldCupMatch(match) ? "world-cup-match-card" : ""}"
          data-match-id="${safe(match.id)}"
          tabindex="0"
          role="button"
          style="
            --home-colour:${safe(homeColours[0])};
            --home-accent:${safe(homeColours[1])};
            --away-colour:${safe(awayColours[0])};
            --away-accent:${safe(awayColours[1])};
          ">
          ${isWorldCupMatch(match) ? `
            <div class="world-cup-card-brand">
              <img src="/world-cup-logo.svg" alt="World Cup 2026">
              <span>USA · CANADA · MEXICO</span>
            </div>
          ` : ""}
          <div class="team-colour-wash team-colour-wash-home"></div>
          <div class="team-colour-wash team-colour-wash-away"></div>
          <div class="card-ball" aria-hidden="true">⚽</div>

          <div class="match-top">
            <span>${safe(match.competition)}</span>
            <span class="${isLive(match.status) ? "live-text" : ""}">
              ${safe(liveLabel(match))}
            </span>
          </div>

          <div class="teams">
            <div class="team-row enhanced-team-row">
              <span class="team-name">
                <span
                  class="team-crest"
                  data-team-asset
                  data-team="${safe(match.homeTeam)}"
                  data-country="${safe(match.country || "")}"
                  data-logo="${safe(match.homeLogo || "")}">
                  ${safe(initials(match.homeTeam))}
                </span>
                ${safe(match.homeTeam)}
              </span>
              <strong>${safe(scoreValue(match.homeScore))}</strong>
              ${homeScorers ? `<small class="card-scorers">${safe(homeScorers)}</small>` : ""}
            </div>

            <div class="team-row enhanced-team-row">
              <span class="team-name">
                <span
                  class="team-crest"
                  data-team-asset
                  data-team="${safe(match.awayTeam)}"
                  data-country="${safe(match.country || "")}"
                  data-logo="${safe(match.awayLogo || "")}">
                  ${safe(initials(match.awayTeam))}
                </span>
                ${safe(match.awayTeam)}
              </span>
              <strong>${safe(scoreValue(match.awayScore))}</strong>
              ${awayScorers ? `<small class="card-scorers">${safe(awayScorers)}</small>` : ""}
            </div>
          </div>

          <div class="match-bottom">
            <span class="country-label">
              <span
                class="country-flag"
                data-team-asset
                data-team=""
                data-country="${safe(match.country || "")}">
                🌍
              </span>
              ${safe(match.country || "Live football")}
            </span>
            <span class="open-stats">Goals & timeline →</span>
          </div>
        </article>
      `;
    }).join("");

    hydrateTeamAssets();

    document.querySelectorAll("[data-match-id]").forEach(card => {
      const open = () => openMatch(card.dataset.matchId);
      card.addEventListener("click", open);
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") open();
      });
    });

    status.className = "status-box success";
    status.textContent = `${matches.length} live match${matches.length === 1 ? "" : "es"} loaded.`;
    $("#lastUpdated").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    status.className = "status-box error";
    status.textContent = error.message;
    $("#matches").innerHTML = `<div class="empty">Live scores could not be loaded.</div>`;
  }
}

function buildFixtureTabs() {
  const container = $("#fixtureTabs");
  container.innerHTML = "";

  for (let offset = 0; offset < 8; offset += 1) {
    const date = addDays(new Date(), offset);
    const key = dateKey(date);
    const label = offset === 0
      ? "Today"
      : offset === 1
        ? "Tomorrow"
        : date.toLocaleDateString([], { weekday: "short", day: "numeric" });

    const button = document.createElement("button");
    button.className = `date-tab ${state.selectedDate === key ? "active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      state.selectedDate = key;
      buildFixtureTabs();
      renderFixtures();
    });
    container.appendChild(button);
  }
}

function renderFixtures() {
  const list = state.fixtures.filter(item => dateKey(new Date(item.utcDate)) === state.selectedDate);

  if (!list.length) {
    $("#fixturesList").innerHTML = `<div class="empty">No scheduled fixtures were returned for this date.</div>`;
    return;
  }

  const grouped = new Map();
  for (const fixture of list) {
    const competition = fixture.competition || "Football";
    if (!grouped.has(competition)) grouped.set(competition, []);
    grouped.get(competition).push(fixture);
  }

  $("#fixturesList").innerHTML = [...grouped.entries()].map(([competition, fixtures]) => `
    <section class="fixture-group">
      <h3>${safe(competition)}</h3>
      ${fixtures.map(fixture => `
        <div class="fixture-row">
          <time class="fixture-time">${formatTime(fixture.utcDate)}</time>
          <div class="fixture-teams">
            <strong>${safe(fixture.homeTeam)}</strong>
            <span>${safe(fixture.awayTeam)}</span>
          </div>
          <span class="countdown">${countdown(fixture.utcDate)}</span>
        </div>
      `).join("")}
    </section>
  `).join("");
}

async function loadFixtures() {
  const status = $("#fixtureStatus");
  status.className = "status-box";
  status.textContent = "Loading fixtures…";

  try {
    const from = dateKey(new Date());
    const to = dateKey(addDays(new Date(), 7));
    const data = await getJson(`/api/fixtures?dateFrom=${from}&dateTo=${to}`);

    state.fixtures = data.fixtures || [];
    renderFixtures();

    status.className = "status-box success";
    status.textContent = `${state.fixtures.length} upcoming fixtures loaded.`;
  } catch (error) {
    status.className = "status-box error";
    status.textContent = error.message;
    $("#fixturesList").innerHTML = `<div class="empty">Fixtures could not be loaded.</div>`;
  }
}

function newsCard(item, index) {
  return `
    <a class="news-card" href="${safe(item.link)}" target="_blank" rel="noopener noreferrer">
      <div>
        <span class="news-source">${safe(item.source)}</span>
        <h3>${safe(item.title)}</h3>
        ${index === 0 ? `<p>${safe(item.description || "")}</p>` : ""}
      </div>
      <div class="news-meta">
        <span>${relativeTime(item.pubDate)}</span>
        <span>READ →</span>
      </div>
    </a>
  `;
}

async function loadNews() {
  $("#newsGrid").innerHTML = `<div class="empty">Loading football news…</div>`;

  try {
    const data = await getJson("/api/news");
    const items = data.items || [];

    $("#newsGrid").innerHTML = items.length
      ? items.map(newsCard).join("")
      : `<div class="empty">No news stories were returned.</div>`;
  } catch {
    $("#newsGrid").innerHTML = `<div class="empty">Football news could not be loaded.</div>`;
  }
}

function statWidth(home, away) {
  const h = Number.parseFloat(String(home ?? 0).replace("%", "")) || 0;
  const a = Number.parseFloat(String(away ?? 0).replace("%", "")) || 0;
  return h + a ? Math.round((h / (h + a)) * 100) : 50;
}

function eventIcon(event) {
  const text = `${event.type} ${event.detail}`.toLowerCase();
  if (text.includes("goal")) return "⚽";
  if (text.includes("yellow")) return "🟨";
  if (text.includes("red")) return "🟥";
  if (text.includes("subst")) return "🔄";
  return "•";
}

function renderMatchDetails(data) {
  const match = data.match;
  const worldCup = isWorldCupMatch(match);
  const homeColours = teamColours(match.homeTeam);
  const awayColours = teamColours(match.awayTeam);
  $("#modalTitle").textContent = `${match.homeTeam} v ${match.awayTeam}`;

  const goalEvents = (data.events || []).filter(event => {
    const text = `${event.type} ${event.detail}`.toLowerCase();
    return text.includes("goal") && !text.includes("disallowed") && !text.includes("cancelled");
  });

  const scorers = goalEvents.map(event => `
    <div class="scorer-row">
      <span class="scorer-minute">${safe(event.minute ? `${event.minute}'` : "GOAL")}</span>
      <span class="scorer-ball">⚽</span>
      <div>
        <strong>${safe(event.player || "Goalscorer")}</strong>
        <p>${safe(event.team || "")}${event.assist ? ` · Assist: ${safe(event.assist)}` : ""}</p>
      </div>
    </div>
  `).join("");

  const events = (data.events || []).slice().reverse().map(event => `
    <div class="event">
      <time>${safe(event.minute ? `${event.minute}'` : "")}</time>
      <span>${eventIcon(event)}</span>
      <div>
        <strong>${safe(event.player || event.team || "Match event")}</strong>
        <p>${safe(event.detail || event.type || "")}</p>
      </div>
    </div>
  `).join("");

  $("#modalContent").innerHTML = `
    <div class="scoreboard animated-scoreboard ${worldCup ? "world-cup-scoreboard" : ""}" style="--modal-home:${safe(homeColours[0])};--modal-home-accent:${safe(homeColours[1])};--modal-away:${safe(awayColours[0])};--modal-away-accent:${safe(awayColours[1])};">
      ${worldCup ? `<div class="world-cup-modal-brand"><img src="/world-cup-logo.svg" alt="World Cup 2026"><span>UNITED 2026</span></div>` : ""}
      <div class="modal-team modal-team-home">
        <span class="modal-crest" data-team-asset data-team="${safe(match.homeTeam)}" data-country="${safe(match.country || "")}" data-logo="${safe(match.homeLogo || "")}">${safe(initials(match.homeTeam))}</span>
        ${safe(match.homeTeam)}
      </div>
      <div class="modal-score"><span>${safe(match.minute ? `${match.minute}'` : match.status)}</span><strong>${safe(scoreValue(match.homeScore))}<b>–</b>${safe(scoreValue(match.awayScore))}</strong></div>
      <div class="modal-team modal-team-away">
        <span class="modal-crest" data-team-asset data-team="${safe(match.awayTeam)}" data-country="${safe(match.country || "")}" data-logo="${safe(match.awayLogo || "")}">${safe(initials(match.awayTeam))}</span>
        ${safe(match.awayTeam)}
      </div>
    </div>

    <section class="scorers-box ${worldCup ? "world-cup-detail-box" : ""}">
      <div class="modal-section-title"><h3>Goalscorers</h3><span>${goalEvents.length} goal event${goalEvents.length === 1 ? "" : "s"}</span></div>
      ${scorers || `<div class="empty">No goalscorer data has been supplied yet.</div>`}
    </section>

    <section class="modal-box timeline-only ${worldCup ? "world-cup-detail-box" : ""}">
      <div class="modal-section-title"><h3>Match timeline</h3><span>${safe(data.availability?.events || "")}</span></div>
      ${events || `<div class="empty">No match events have been supplied yet.</div>`}
    </section>
  `;
  hydrateTeamAssets();
}

async function loadDetails(id) {
  try {
    const data = await getJson(`/api/match-details?id=${encodeURIComponent(id)}`);
    renderMatchDetails(data);
  } catch (error) {
    $("#modalContent").innerHTML = `<div class="empty">${safe(error.message)}</div>`;
  }
}

function openMatch(id) {
  state.activeMatchId = id;
  $("#matchModal").hidden = false;
  document.body.classList.add("modal-open");
  $("#modalContent").innerHTML = `<div class="empty">Loading live statistics…</div>`;

  loadDetails(id);
  clearInterval(state.detailTimer);
  state.detailTimer = setInterval(() => loadDetails(id), 30000);
}

function closeMatch() {
  state.activeMatchId = null;
  clearInterval(state.detailTimer);
  state.detailTimer = null;
  $("#matchModal").hidden = true;
  document.body.classList.remove("modal-open");
}

$("#menuButton").addEventListener("click", () => {
  const menu = $("#mobileMenu");
  menu.hidden = !menu.hidden;
  $("#menuButton").setAttribute("aria-expanded", String(!menu.hidden));
});

document.querySelectorAll("#mobileMenu a").forEach(link => {
  link.addEventListener("click", () => $("#mobileMenu").hidden = true);
});

$("#refreshButton").addEventListener("click", () => Promise.all([loadScores(), loadFixtures(), loadNews()]));
$("#scoresRefreshButton").addEventListener("click", loadScores);
$("#newsRefreshButton").addEventListener("click", loadNews);
$("#modalClose").addEventListener("click", closeMatch);
$("#modalBackdrop").addEventListener("click", closeMatch);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#matchModal").hidden) closeMatch();
});

buildFixtureTabs();
loadScores();
loadFixtures();
loadNews();

setInterval(loadScores, 30000);
setInterval(loadFixtures, 5 * 60 * 1000);
setInterval(loadNews, 3 * 60 * 1000);
setInterval(renderFixtures, 60 * 1000);
