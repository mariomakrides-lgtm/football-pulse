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
  if (value === null || value === undefined || value === "") {
    return "–";
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : value;
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

    $("#matches").innerHTML = matches.map(match => `
      <article class="match-card" data-match-id="${safe(match.id)}" tabindex="0" role="button">
        <div class="match-top">
          <span>${safe(match.competition)}</span>
          <span class="${isLive(match.status) ? "live-text" : ""}">${safe(liveLabel(match))}</span>
        </div>

        <div class="teams">
          <div class="team-row">
            <span>${safe(match.homeTeam)}</span>
            <strong>${safe(scoreValue(match.homeScore))}</strong>
          </div>
          <div class="team-row">
            <span>${safe(match.awayTeam)}</span>
            <strong>${safe(scoreValue(match.awayScore))}</strong>
          </div>
        </div>

        <div class="match-bottom">
          <span>${safe(match.country || "Live football")}</span>
          <span class="open-stats">Open match centre →</span>
        </div>
      </article>
    `).join("");

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
  $("#modalTitle").textContent = `${match.homeTeam} v ${match.awayTeam}`;

  const stats = (data.statistics || []).map(stat => `
    <div class="stat-row">
      <div class="stat-values">
        <strong>${safe(stat.home ?? 0)}</strong>
        <span>${safe(stat.label || stat.type)}</span>
        <strong>${safe(stat.away ?? 0)}</strong>
      </div>
      <div class="stat-bar"><span style="width:${statWidth(stat.home, stat.away)}%"></span></div>
    </div>
  `).join("");

  const events = (data.events || []).slice().reverse().map(event => `
    <div class="event">
      <time>${safe(event.minute ? `${event.minute}'` : "")}</time>
      <span>${eventIcon(event)}</span>
      <div>
        <strong>${safe(event.player || event.team || "")}</strong>
        <p>${safe(event.detail || event.type || "")}</p>
      </div>
    </div>
  `).join("");

  $("#modalContent").innerHTML = `
    <div class="scoreboard">
      <div class="modal-team">${safe(match.homeTeam)}</div>
      <div class="modal-score">
        <span>${safe(match.minute ? `${match.minute}'` : match.status)}</span>
        <strong>${safe(scoreValue(match.homeScore))} – ${safe(scoreValue(match.awayScore))}</strong>
      </div>
      <div class="modal-team">${safe(match.awayTeam)}</div>
    </div>

    <div class="modal-columns">
      <section class="modal-box">
        <h3>Live statistics</h3>
        ${stats || `<div class="empty">Statistics are not available yet.</div>`}
      </section>

      <section class="modal-box">
        <h3>Match events</h3>
        ${events || `<div class="empty">No events have been reported yet.</div>`}
      </section>
    </div>
  `;
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
