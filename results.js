const state = {
  results: [],
  selectedDate: dateKey(new Date()),
  competition: "all",
  highlights: []
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
  if (Number.isNaN(date.getTime())) return "Full time";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function buildDateTabs() {
  const container = $("#resultDateTabs");
  container.innerHTML = "";

  for (let offset = -6; offset <= 0; offset += 1) {
    const date = addDays(new Date(), offset);
    const key = dateKey(date);

    let label = date.toLocaleDateString([], {
      weekday: "short",
      day: "numeric"
    });

    if (offset === 0) label = "Today";
    if (offset === -1) label = "Yesterday";

    const button = document.createElement("button");
    button.className = `date-tab ${state.selectedDate === key ? "active" : ""}`;
    button.textContent = label;

    button.addEventListener("click", () => {
      state.selectedDate = key;
      buildDateTabs();
      renderResults();
    });

    container.appendChild(button);
  }
}

function fillCompetitionFilter() {
  const select = $("#competitionFilter");
  const competitions = [...new Set(
    state.results.map(match => match.competition).filter(Boolean)
  )].sort();

  select.innerHTML =
    `<option value="all">All competitions</option>` +
    competitions.map(name =>
      `<option value="${safe(name)}">${safe(name)}</option>`
    ).join("");

  select.value = state.competition;
}

function winner(match, side) {
  const home = Number(match.homeScore);
  const away = Number(match.awayScore);

  if (!Number.isFinite(home) || !Number.isFinite(away) || home === away) {
    return false;
  }

  return side === "home" ? home > away : away > home;
}

function resultCard(match) {
  return `
    <article class="result-card">
      <div class="result-card-top">
        <span>${safe(match.competition || "Football")}</span>
        <span class="full-time-pill">${safe(match.status || "FT")}</span>
      </div>

      <div class="result-scoreboard">
        <div class="result-teams">
          <div class="result-team">
            <span
              class="team-crest result-crest"
              data-result-asset
              data-team="${safe(match.homeTeam)}"
              data-country="${safe(match.country || "")}">
              ${safe(initials(match.homeTeam))}
            </span>
            ${winner(match, "home") ? `<i class="winner-dot"></i>` : ""}
            <span>${safe(match.homeTeam)}</span>
          </div>
          <div class="result-team">
            <span
              class="team-crest result-crest"
              data-result-asset
              data-team="${safe(match.awayTeam)}"
              data-country="${safe(match.country || "")}">
              ${safe(initials(match.awayTeam))}
            </span>
            ${winner(match, "away") ? `<i class="winner-dot"></i>` : ""}
            <span>${safe(match.awayTeam)}</span>
          </div>
        </div>

        <div class="result-scores">
          <span>${safe(match.homeScore ?? "–")}</span>
          <span>${safe(match.awayScore ?? "–")}</span>
        </div>
      </div>

      <div class="result-card-bottom">
        <span>${safe(match.country || "International football")}</span>
        <span>${safe(formatTime(match.utcDate))}</span>
      </div>
    </article>
  `;
}

function renderResults() {
  const filtered = state.results.filter(match => {
    const sameDate = dateKey(new Date(match.utcDate)) === state.selectedDate;
    const sameCompetition =
      state.competition === "all" ||
      match.competition === state.competition;

    return sameDate && sameCompetition;
  });

  $("#resultsGrid").innerHTML = filtered.length
    ? filtered.map(resultCard).join("")
    : `<div class="empty">No finished matches were returned for this date and filter.</div>`;

  $("#resultCount").textContent = filtered.length;

  const goals = filtered.reduce((total, match) => {
    return total +
      (Number(match.homeScore) || 0) +
      (Number(match.awayScore) || 0);
  }, 0);

  $("#goalCount").textContent = goals;
  hydrateResultAssets();
}

async function loadResults() {
  const status = $("#resultsStatus");
  status.className = "status-box";
  status.textContent = "Loading finished matches…";

  try {
    const from = dateKey(addDays(new Date(), -6));
    const to = dateKey(new Date());
    const data = await getJson(`/api/results?dateFrom=${from}&dateTo=${to}`);

    state.results = data.results || [];
    fillCompetitionFilter();
    renderResults();

    status.className = "status-box success";
    status.textContent =
      `${state.results.length} finished match${state.results.length === 1 ? "" : "es"} loaded.`;
  } catch (error) {
    status.className = "status-box error";
    status.textContent = error.message;
    $("#resultsGrid").innerHTML =
      `<div class="empty">Results could not be loaded.</div>`;
  }
}

function playable(item) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(String(item.videoId || ""));
}

function highlightCard(item, featured = false) {
  const disabled = !playable(item);

  if (featured) {
    return `
      <article class="feature-card">
        <div class="feature-card-content">
          <small>${safe(item.competition)}</small>
          <h3>${safe(item.title)}</h3>
          <p>${safe(item.description)}</p>
          <button
            class="button button-primary watch-button"
            data-video-id="${safe(item.videoId)}"
            data-video-title="${safe(item.title)}"
            ${disabled ? "disabled" : ""}>
            ${disabled ? "Add an official video ID" : "Watch highlights"}
          </button>
        </div>
      </article>
    `;
  }

  return `
    <article
      class="highlight-card"
      data-video-id="${safe(item.videoId)}"
      data-video-title="${safe(item.title)}"
      tabindex="${disabled ? "-1" : "0"}"
      aria-disabled="${disabled}">
      <small>${safe(item.competition)}</small>
      <h3>${safe(item.title)}</h3>
      <p>${safe(item.description)}</p>
    </article>
  `;
}

function bindHighlightButtons() {
  document.querySelectorAll("[data-video-id]").forEach(element => {
    const id = element.dataset.videoId;

    if (!playable({ videoId: id })) return;

    const open = () =>
      openVideo(id, element.dataset.videoTitle || "Match highlights");

    element.addEventListener("click", open);
    element.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") open();
    });
  });
}

async function loadHighlights() {
  try {
    const items = await getJson("/highlights.json");
    state.highlights = Array.isArray(items) ? items : [];

    $("#highlightCount").textContent =
      state.highlights.filter(playable).length;

    const [featured, ...rest] = state.highlights;

    $("#featuredHighlight").innerHTML = featured
      ? highlightCard(featured, true)
      : `<div class="empty">No featured highlight has been added.</div>`;

    $("#highlightsGrid").innerHTML = rest.length
      ? rest.map(item => highlightCard(item)).join("")
      : `<div class="empty">No extra highlights have been added.</div>`;

    bindHighlightButtons();
  } catch {
    $("#featuredHighlight").innerHTML =
      `<div class="empty">Highlights could not be loaded.</div>`;
  }
}

function openVideo(videoId, title) {
  $("#videoTitle").textContent = title;
  $("#highlightPlayer").src =
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;

  $("#videoModal").hidden = false;
  document.body.classList.add("modal-open");
}

function closeVideo() {
  $("#highlightPlayer").src = "";
  $("#videoModal").hidden = true;
  document.body.classList.remove("modal-open");
}

$("#competitionFilter").addEventListener("change", event => {
  state.competition = event.target.value;
  renderResults();
});

$("#refreshResults").addEventListener("click", loadResults);
$("#closeVideo").addEventListener("click", closeVideo);
$("#videoBackdrop").addEventListener("click", closeVideo);

$("#menuButton").addEventListener("click", () => {
  const menu = $("#mobileMenu");
  menu.hidden = !menu.hidden;
  $("#menuButton").setAttribute("aria-expanded", String(!menu.hidden));
});

document.querySelectorAll("#mobileMenu a").forEach(link => {
  link.addEventListener("click", () => {
    $("#mobileMenu").hidden = true;
  });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#videoModal").hidden) {
    closeVideo();
  }
});

buildDateTabs();
loadResults();
loadHighlights();
