const state = {
  scoreDate: localDateKey(new Date()),
  fixtureDate: localDateKey(new Date()),
  matches: [],
  fixtures: [],
  news: [],
  detailsTimer: null,
  activeMatchId: null
};

const $ = selector => document.querySelector(selector);
const scoreDateTabs = $("#scoreDateTabs");
const fixtureDateTabs = $("#fixtureDateTabs");
const competitionFilter = $("#competitionFilter");
const matchGrid = $("#matchGrid");
const fixtureList = $("#fixtureList");
const newsGrid = $("#newsGrid");
const scoreStatus = $("#scoreStatus");
const fixtureStatus = $("#fixtureStatus");
const providerStrip = $("#providerStrip");
const lastUpdated = $("#lastUpdated");
const modal = $("#matchModal");
const modalContent = $("#modalContent");
const modalTitle = $("#modalTitle");

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "TBC";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "TBC"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return seconds < 0 ? "just now" : "in under a minute";
  const minutes = Math.round(absolute / 60);
  if (minutes < 60) return seconds < 0 ? `${minutes}m ago` : `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return seconds < 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return seconds < 0 ? `${days}d ago` : `in ${days}d`;
}

function countdown(value) {
  const milliseconds = new Date(value).getTime() - Date.now();
  if (milliseconds <= 0) return "Starting soon";
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function dateLabel(date, offset) {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", day: "numeric" });
}

function buildDateTabs(container, selected, onSelect, start, count) {
  container.innerHTML = "";
  for (let offset = start; offset < start + count; offset += 1) {
    const date = addDays(new Date(), offset);
    const key = localDateKey(date);
    const button = document.createElement("button");
    button.className = `date-tab ${key === selected ? "active" : ""}`;
    button.textContent = dateLabel(date, offset);
    button.addEventListener("click", () => onSelect(key));
    container.appendChild(button);
  }
}

async function jsonFetch(url) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function matchStatus(match) {
  const status = String(match.status || "").toUpperCase();
  if (["1H", "2H", "HT", "ET", "P", "LIVE", "IN_PLAY"].includes(status)) {
    return match.minute ? `${match.minute}'` : status === "HT" ? "HT" : "LIVE";
  }
  if (["FT", "AET", "PEN", "FINISHED"].includes(status)) return "FT";
  if (["PST", "POSTPONED"].includes(status)) return "Postponed";
  if (["CANC", "CANCELLED"].includes(status)) return "Cancelled";
  return formatTime(match.utcDate);
}

function populateCompetitionFilter(matches) {
  const previous = competitionFilter.value;
  const competitions = [...new Set(matches.map(match => match.competition?.name).filter(Boolean))].sort();
  competitionFilter.innerHTML = `<option value="all">All competitions</option>` +
    competitions.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if ([...competitionFilter.options].some(option => option.value === previous)) {
    competitionFilter.value = previous;
  }
}

function renderProviders(providers = []) {
  providerStrip.innerHTML = providers.map(provider => `
    <span class="provider-pill ${escapeHtml(provider.state)}">
      ${escapeHtml(provider.name)} · ${escapeHtml(provider.state)}
      ${Number.isFinite(provider.count) ? ` · ${provider.count}` : ""}
    </span>
  `).join("");
}

function renderMatches() {
  const selectedCompetition = competitionFilter.value;
  const matches = state.matches.filter(match => {
    const dayMatches = localDateKey(new Date(match.utcDate)) === state.scoreDate;
    const competitionMatches = selectedCompetition === "all" || match.competition?.name === selectedCompetition;
    return dayMatches && competitionMatches;
  });

  if (!matches.length) {
    matchGrid.innerHTML = `<div class="empty-state">No real matches were returned for this date.</div>`;
    return;
  }

  matchGrid.innerHTML = matches.map(match => {
    const isLive = ["1H","2H","HT","ET","P","LIVE","IN_PLAY"].includes(String(match.status || "").toUpperCase());
    const homeScore = match.homeScore ?? "–";
    const awayScore = match.awayScore ?? "–";
    return `
      <article class="match-card" data-match-id="${escapeHtml(match.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(match.homeTeam)} versus ${escapeHtml(match.awayTeam)}">
        <div class="match-card__top">
          <span>${escapeHtml(match.competition?.name || "Football")}</span>
          <span class="${isLive ? "live-label" : ""}">${escapeHtml(matchStatus(match))}</span>
        </div>

        <div class="match-card__teams">
          <div class="team-row"><span>${escapeHtml(match.homeTeam)}</span><strong>${escapeHtml(homeScore)}</strong></div>
          <div class="team-row"><span>${escapeHtml(match.awayTeam)}</span><strong>${escapeHtml(awayScore)}</strong></div>
        </div>

        <div class="match-card__bottom">
          <span>${escapeHtml(match.venue || "Match centre")}</span>
          <span class="stats-chip">${match.provider === "API-Football" ? "Tap for live stats →" : escapeHtml(match.provider || "Live data")}</span>
        </div>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-match-id]").forEach(card => {
    const open = () => openMatch(card.dataset.matchId);
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") open();
    });
  });
}

async function loadMatches() {
  scoreStatus.className = "status-banner";
  scoreStatus.textContent = "Loading real scores…";
  try {
    const from = localDateKey(addDays(new Date(state.scoreDate), -1));
    const to = localDateKey(addDays(new Date(state.scoreDate), 1));
    const data = await jsonFetch(`/api/matches?dateFrom=${from}&dateTo=${to}`);
    state.matches = data.matches || [];
    populateCompetitionFilter(state.matches);
    renderProviders(data.providers || []);
    renderMatches();
    scoreStatus.className = "status-banner success";
    scoreStatus.textContent = state.matches.length
      ? `Real match data loaded. Live games refresh every 15 seconds.`
      : `No live provider returned matches. Check your API key and plan.`;
    lastUpdated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    scoreStatus.className = "status-banner error";
    scoreStatus.textContent = error.message;
    matchGrid.innerHTML = `<div class="empty-state">Scores could not be loaded.</div>`;
  }
}

function renderFixtures() {
  const fixtures = state.fixtures.filter(fixture => localDateKey(new Date(fixture.utcDate)) === state.fixtureDate);
  if (!fixtures.length) {
    fixtureList.innerHTML = `<div class="empty-state">No upcoming fixtures were returned for this date.</div>`;
    return;
  }

  const groups = new Map();
  fixtures.forEach(fixture => {
    const name = fixture.competition?.name || "Football";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(fixture);
  });

  fixtureList.innerHTML = [...groups.entries()].map(([competition, items]) => `
    <section class="fixture-group">
      <h3>${escapeHtml(competition)}</h3>
      ${items.map(item => `
        <div class="fixture-row">
          <time class="fixture-time">${formatTime(item.utcDate)}</time>
          <div class="fixture-teams">
            <strong>${escapeHtml(item.homeTeam)}</strong>
            <span>${escapeHtml(item.awayTeam)}</span>
          </div>
          <span class="fixture-countdown">${countdown(item.utcDate)}</span>
        </div>
      `).join("")}
    </section>
  `).join("");
}

async function loadFixtures() {
  fixtureStatus.className = "status-banner";
  fixtureStatus.textContent = "Loading upcoming fixtures…";
  try {
    const from = localDateKey(new Date());
    const to = localDateKey(addDays(new Date(), 7));
    const data = await jsonFetch(`/api/fixtures?dateFrom=${from}&dateTo=${to}`);
    state.fixtures = data.fixtures || [];
    renderFixtures();
    fixtureStatus.className = "status-banner success";
    fixtureStatus.textContent = `${state.fixtures.length} upcoming fixtures loaded.`;
  } catch (error) {
    fixtureStatus.className = "status-banner error";
    fixtureStatus.textContent = error.message;
    fixtureList.innerHTML = `<div class="empty-state">Fixtures could not be loaded.</div>`;
  }
}

function renderNews() {
  if (!state.news.length) {
    newsGrid.innerHTML = `<div class="empty-state">Football news could not be loaded.</div>`;
    return;
  }

  newsGrid.innerHTML = state.news.map((item, index) => {
    const recent = Date.now() - new Date(item.pubDate).getTime() < 60 * 60 * 1000;
    return `
      <a class="news-card" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
        <div>
          <span class="news-source">${escapeHtml(item.source)}</span>
          <h3>${escapeHtml(item.title)}</h3>
          ${index === 0 ? `<p>${escapeHtml(item.description || "")}</p>` : ""}
        </div>
        <div class="news-meta">
          <span>${relativeTime(item.pubDate)}</span>
          <span class="${recent ? "breaking" : ""}">${recent ? "BREAKING" : "READ →"}</span>
        </div>
      </a>
    `;
  }).join("");
}

async function loadNews() {
  newsGrid.innerHTML = `<div class="loading-card">Loading breaking football news…</div>`;
  try {
    const data = await jsonFetch("/api/news");
    state.news = data.items || [];
    renderNews();
  } catch {
    newsGrid.innerHTML = `<div class="empty-state">Football news could not be loaded.</div>`;
  }
}

function numericValue(value) {
  const number = Number.parseFloat(String(value ?? 0).replace("%", ""));
  return Number.isFinite(number) ? number : 0;
}

function statShare(home, away) {
  const left = numericValue(home);
  const right = numericValue(away);
  const total = left + right;
  return total ? Math.round((left / total) * 100) : 50;
}

function eventIcon(event) {
  const text = `${event.type} ${event.detail}`.toLowerCase();
  if (text.includes("goal")) return "⚽";
  if (text.includes("yellow")) return "🟨";
  if (text.includes("red")) return "🟥";
  if (text.includes("subst")) return "🔄";
  if (text.includes("var")) return "📺";
  return "•";
}

function renderMatchDetails(data) {
  const fixture = data.fixture;
  modalTitle.textContent = fixture ? `${fixture.home} v ${fixture.away}` : "Match details";

  const stats = (data.statistics || []).map(stat => `
    <div class="stat-row">
      <div class="stat-values">
        <strong>${escapeHtml(stat.home ?? 0)}</strong>
        <span>${escapeHtml(stat.name)}</span>
        <strong>${escapeHtml(stat.away ?? 0)}</strong>
      </div>
      <div class="stat-bar"><span style="width:${statShare(stat.home, stat.away)}%"></span></div>
    </div>
  `).join("");

  const events = (data.events || []).slice().reverse().map(event => `
    <div class="timeline-event">
      <time>${escapeHtml(event.minute ? `${event.minute}${event.extraMinute ? `+${event.extraMinute}` : ""}'` : "")}</time>
      <span>${eventIcon(event)}</span>
      <div>
        <strong>${escapeHtml(event.player || event.team)}</strong>
        <p>${escapeHtml(event.detail || event.type)}${event.assist ? ` · Assist: ${escapeHtml(event.assist)}` : ""}</p>
      </div>
    </div>
  `).join("");

  modalContent.innerHTML = `
    <div class="modal-scoreboard">
      <div class="modal-team">
        ${fixture.homeLogo ? `<img src="${escapeHtml(fixture.homeLogo)}" alt="">` : ""}
        <span>${escapeHtml(fixture.home)}</span>
      </div>
      <div class="modal-score">
        <span>${escapeHtml(fixture.minute ? `${fixture.minute}'` : fixture.status)}</span>
        <strong>${escapeHtml(fixture.homeScore ?? 0)} – ${escapeHtml(fixture.awayScore ?? 0)}</strong>
      </div>
      <div class="modal-team">
        ${fixture.awayLogo ? `<img src="${escapeHtml(fixture.awayLogo)}" alt="">` : ""}
        <span>${escapeHtml(fixture.away)}</span>
      </div>
    </div>

    <div class="modal-meta">
      ${fixture.venue ? `<span>📍 ${escapeHtml(fixture.venue)}</span>` : ""}
      ${fixture.referee ? `<span>Referee: ${escapeHtml(fixture.referee)}</span>` : ""}
      <span>Updated ${new Date(data.updatedAt).toLocaleTimeString()}</span>
    </div>

    <div class="modal-columns">
      <section class="modal-box">
        <h3>Live statistics</h3>
        ${stats || `<p class="empty-state">Statistics have not been released yet.</p>`}
      </section>

      <section class="modal-box">
        <h3>Match events</h3>
        ${events || `<p class="empty-state">No events have been reported yet.</p>`}
      </section>
    </div>
  `;
}

async function loadMatchDetails(id) {
  try {
    const data = await jsonFetch(`/api/match-details?id=${encodeURIComponent(id)}`);
    renderMatchDetails(data);
  } catch (error) {
    modalContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function openMatch(id) {
  const match = state.matches.find(item => String(item.id) === String(id));
  if (!match) return;

  modal.hidden = false;
  document.body.classList.add("modal-open");
  modalTitle.textContent = `${match.homeTeam} v ${match.awayTeam}`;

  if (match.provider !== "API-Football") {
    modalContent.innerHTML = `
      <div class="empty-state">
        Detailed real-time statistics are available for matches returned by API-Football.
        This match came from ${escapeHtml(match.provider || "another provider")}.
      </div>
    `;
    return;
  }

  modalContent.innerHTML = `<div class="loading-card">Loading real-time match statistics…</div>`;
  state.activeMatchId = id;
  loadMatchDetails(id);
  clearInterval(state.detailsTimer);
  state.detailsTimer = setInterval(() => loadMatchDetails(id), 15000);
}

function closeModal() {
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  state.activeMatchId = null;
  clearInterval(state.detailsTimer);
  state.detailsTimer = null;
}

function initialiseTabs() {
  buildDateTabs(scoreDateTabs, state.scoreDate, key => {
    state.scoreDate = key;
    initialiseTabs();
    loadMatches();
  }, -1, 5);

  buildDateTabs(fixtureDateTabs, state.fixtureDate, key => {
    state.fixtureDate = key;
    initialiseTabs();
    renderFixtures();
  }, 0, 8);
}

$("#menuButton").addEventListener("click", () => {
  const menu = $("#mobileMenu");
  menu.hidden = !menu.hidden;
  $("#menuButton").setAttribute("aria-expanded", String(!menu.hidden));
});
document.querySelectorAll("#mobileMenu a").forEach(link => link.addEventListener("click", () => $("#mobileMenu").hidden = true));
competitionFilter.addEventListener("change", renderMatches);
$("#refreshAllButton").addEventListener("click", () => Promise.all([loadMatches(), loadFixtures(), loadNews()]));
$("#refreshNewsButton").addEventListener("click", loadNews);
$("#modalClose").addEventListener("click", closeModal);
$("#modalBackdrop").addEventListener("click", closeModal);
document.addEventListener("keydown", event => { if (event.key === "Escape" && !modal.hidden) closeModal(); });

initialiseTabs();
loadMatches();
loadFixtures();
loadNews();

setInterval(loadMatches, 15000);
setInterval(loadFixtures, 5 * 60 * 1000);
setInterval(loadNews, 3 * 60 * 1000);
setInterval(renderFixtures, 60 * 1000);
