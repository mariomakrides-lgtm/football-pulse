const STORAGE_KEY = "footballPulseWorldCupPredictionV1";

const state = {
  groups: {},
  rankings: {},
  thirdPlaceSelected: [],
  knockout: {
    r32: [],
    r16: [],
    qf: [],
    sf: [],
    thirdPlace: [],
    final: []
  }
};

const $ = selector => document.querySelector(selector);

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const flagCache = new Map();

async function flagUrlForCountry(country) {
  if (flagCache.has(country)) return flagCache.get(country);

  try {
    const asset = await fetch(
      `/api/team-assets?team=${encodeURIComponent(country)}&country=${encodeURIComponent(country)}`
    ).then(response => response.json());

    const value = asset.flag || asset.badge || "";
    flagCache.set(country, value);
    return value;
  } catch {
    return "";
  }
}

async function hydratePredictionFlags() {
  const items = [...document.querySelectorAll("[data-country-flag]")];

  await Promise.all(items.map(async element => {
    const country = element.dataset.countryFlag;
    const url = await flagUrlForCountry(country);

    if (url) {
      element.innerHTML = `<img src="${safe(url)}" alt="${safe(country)} flag">`;
    }
  }));
}

async function loadGroups() {
  const response = await fetch("/world-cup-groups.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load World Cup groups.");
  state.groups = await response.json();
}

function defaultRankings() {
  const rankings = {};
  for (const [group, teams] of Object.entries(state.groups)) {
    rankings[group] = [...teams];
  }
  return rankings;
}

function renderGroups() {
  $("#groupsGrid").innerHTML = Object.entries(state.groups).map(([group, teams]) => {
    const ranking = state.rankings[group] || teams;

    return `
      <article class="group-card">
        <h3>Group ${safe(group)}</h3>
        <div class="group-flags">
          ${teams.map(team => `
            <span data-country-flag="${safe(team)}">${safe(team.slice(0,2).toUpperCase())}</span>
          `).join("")}
        </div>
        ${[0,1,2,3].map(position => `
          <label class="group-row">
            <span class="position-badge">${position + 1}</span>
            <select data-group="${safe(group)}" data-position="${position}">
              ${teams.map(team => `
                <option value="${safe(team)}" ${ranking[position] === team ? "selected" : ""}>
                  ${safe(team)}
                </option>
              `).join("")}
            </select>
          </label>
        `).join("")}
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-group]").forEach(select => {
    select.addEventListener("change", handleGroupChange);
  });

  hydratePredictionFlags();
}

function handleGroupChange(event) {
  const group = event.target.dataset.group;
  const position = Number(event.target.dataset.position);
  const newTeam = event.target.value;
  const ranking = [...state.rankings[group]];
  const oldTeam = ranking[position];
  const existingIndex = ranking.indexOf(newTeam);

  if (existingIndex !== -1 && existingIndex !== position) {
    ranking[existingIndex] = oldTeam;
  }

  ranking[position] = newTeam;
  state.rankings[group] = ranking;

  renderGroups();
  renderThirdPlace();
  resetKnockout();
  updateBracket();
}

function thirdPlaceTeams() {
  return Object.entries(state.rankings).map(([group, ranking]) => ({
    group,
    team: ranking[2]
  }));
}

function renderThirdPlace() {
  const teams = thirdPlaceTeams();

  state.thirdPlaceSelected = state.thirdPlaceSelected.filter(team =>
    teams.some(item => item.team === team)
  );

  $("#thirdPlaceGrid").innerHTML = teams.map(item => {
    const checked = state.thirdPlaceSelected.includes(item.team);

    return `
      <div class="third-team">
        <input
          type="checkbox"
          id="third-${safe(item.group)}"
          value="${safe(item.team)}"
          ${checked ? "checked" : ""}>
        <label for="third-${safe(item.group)}">
          <span>${safe(item.team)}</span>
          <strong>Group ${safe(item.group)}</strong>
        </label>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".third-team input").forEach(input => {
    input.addEventListener("change", event => {
      const team = event.target.value;

      if (event.target.checked) {
        if (state.thirdPlaceSelected.length >= 8) {
          event.target.checked = false;
          return;
        }
        state.thirdPlaceSelected.push(team);
      } else {
        state.thirdPlaceSelected =
          state.thirdPlaceSelected.filter(item => item !== team);
      }

      $("#thirdPlaceCount").textContent = state.thirdPlaceSelected.length;
      resetKnockout();
      updateBracket();
    });
  });

  $("#thirdPlaceCount").textContent = state.thirdPlaceSelected.length;
}

function qualifiers() {
  const automatic = [];

  for (const group of Object.keys(state.groups)) {
    automatic.push(state.rankings[group][0]);
    automatic.push(state.rankings[group][1]);
  }

  return [...automatic, ...state.thirdPlaceSelected];
}

function resetKnockout() {
  state.knockout = {
    r32: [],
    r16: [],
    qf: [],
    sf: [],
    thirdPlace: [],
    final: []
  };
}

function pairTeams(teams) {
  const pairs = [];

  for (let i = 0; i < teams.length; i += 2) {
    pairs.push([teams[i] || "", teams[i + 1] || ""]);
  }

  return pairs;
}

function seededRoundOf32(qualified) {
  const first = [];
  const second = [];
  const third = [];

  for (const group of Object.keys(state.groups)) {
    first.push(state.rankings[group][0]);
    second.push(state.rankings[group][1]);
  }

  third.push(...state.thirdPlaceSelected);

  const ordered = [];
  for (let i = 0; i < 8; i += 1) {
    ordered.push(first[i], third[i]);
  }
  for (let i = 8; i < 12; i += 1) {
    ordered.push(first[i], second[i - 8]);
  }
  for (let i = 4; i < 12; i += 1) {
    ordered.push(second[i], second[(i + 4) % 12]);
  }

  const unique = [];
  for (const team of ordered) {
    if (team && !unique.includes(team)) unique.push(team);
  }
  for (const team of qualified) {
    if (!unique.includes(team)) unique.push(team);
  }

  return pairTeams(unique.slice(0, 32));
}

function winnerSelect(round, index, teams, currentWinner) {
  return `
    <div class="match-pick">
      <span>Match ${index + 1}: ${safe(teams[0])} v ${safe(teams[1])}</span>
      <select data-round="${round}" data-index="${index}">
        <option value="">Choose winner</option>
        ${teams.filter(Boolean).map(team => `
          <option value="${safe(team)}" ${currentWinner === team ? "selected" : ""}>
            ${safe(team)}
          </option>
        `).join("")}
      </select>
    </div>
  `;
}

function previousWinners(round) {
  return state.knockout[round].filter(Boolean);
}

function renderRound(title, key, matches) {
  return `
    <section class="round-column">
      <h3>${title}</h3>
      ${matches.map((teams, index) =>
        winnerSelect(key, index, teams, state.knockout[key][index])
      ).join("")}
    </section>
  `;
}

function updateBracket() {
  const qualified = qualifiers();
  const ready = qualified.length === 32 && state.thirdPlaceSelected.length === 8;

  if (!ready) {
    $("#bracketStatus").className = "status-box";
    $("#bracketStatus").textContent =
      "Complete the groups and choose exactly eight third-place teams to unlock the bracket.";
    $("#knockoutBracket").innerHTML = "";
    updateChampion();
    return;
  }

  $("#bracketStatus").className = "status-box success";
  $("#bracketStatus").textContent =
    "Bracket unlocked. Choose the winner of every match.";

  const r32Matches = seededRoundOf32(qualified);
  const r16Matches = pairTeams(previousWinners("r32"));
  const qfMatches = pairTeams(previousWinners("r16"));
  const sfMatches = pairTeams(previousWinners("qf"));

  const sfWinners = previousWinners("sf");
  const sfLosers = [];

  sfMatches.forEach((teams, index) => {
    const winner = state.knockout.sf[index];
    if (winner) {
      sfLosers.push(teams.find(team => team && team !== winner) || "");
    }
  });

  const thirdPlaceMatches =
    sfLosers.length === 2 ? [sfLosers] : [["", ""]];
  const finalMatches =
    sfWinners.length === 2 ? [sfWinners] : [["", ""]];

  $("#knockoutBracket").innerHTML =
    renderRound("Round of 32", "r32", r32Matches) +
    renderRound("Round of 16", "r16", r16Matches) +
    renderRound("Quarter-finals", "qf", qfMatches) +
    renderRound("Semi-finals", "sf", sfMatches) +
    `
      <section class="round-column">
        <h3>Final weekend</h3>
        ${winnerSelect(
          "thirdPlace",
          0,
          thirdPlaceMatches[0],
          state.knockout.thirdPlace[0]
        )}
        ${winnerSelect(
          "final",
          0,
          finalMatches[0],
          state.knockout.final[0]
        )}
      </section>
    `;

  document.querySelectorAll("[data-round]").forEach(select => {
    select.addEventListener("change", event => {
      const round = event.target.dataset.round;
      const index = Number(event.target.dataset.index);
      state.knockout[round][index] = event.target.value;

      clearLaterRounds(round);
      updateBracket();
      updateChampion();
    });
  });

  updateChampion();
}

function clearLaterRounds(changedRound) {
  const order = ["r32", "r16", "qf", "sf", "thirdPlace", "final"];
  const changedIndex = order.indexOf(changedRound);

  if (changedIndex === -1) return;

  for (let i = changedIndex + 1; i < order.length; i += 1) {
    state.knockout[order[i]] = [];
  }
}

function updateChampion() {
  const champion = state.knockout.final[0] || "";
  const runnerUp = champion
    ? (previousWinners("sf").find(team => team !== champion) || "")
    : "";

  $("#championName").textContent = champion || "Not decided yet";
  $("#finalSummary").textContent = champion
    ? `${champion} defeat ${runnerUp || "their final opponent"} to become world champions.`
    : "Complete the bracket to crown your winner.";
}

function savePrediction() {
  const payload = {
    rankings: state.rankings,
    thirdPlaceSelected: state.thirdPlaceSelected,
    knockout: state.knockout
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  $("#saveMessage").textContent = "Prediction saved on this device ✓";

  setTimeout(() => {
    $("#saveMessage").textContent = "";
  }, 3000);
}

function loadPrediction() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return false;

    state.rankings = saved.rankings || defaultRankings();
    state.thirdPlaceSelected = saved.thirdPlaceSelected || [];
    state.knockout = saved.knockout || state.knockout;
    return true;
  } catch {
    return false;
  }
}

function resetPrediction() {
  state.rankings = defaultRankings();
  state.thirdPlaceSelected = [];
  resetKnockout();
  localStorage.removeItem(STORAGE_KEY);

  renderGroups();
  renderThirdPlace();
  updateBracket();
  $("#saveMessage").textContent = "Tournament reset.";
}

$("#savePrediction").addEventListener("click", savePrediction);
$("#resetPrediction").addEventListener("click", resetPrediction);

$("#menuButton").addEventListener("click", () => {
  const menu = $("#mobileMenu");
  menu.hidden = !menu.hidden;
});

document.querySelectorAll("#mobileMenu a").forEach(link => {
  link.addEventListener("click", () => {
    $("#mobileMenu").hidden = true;
  });
});

(async function start() {
  try {
    await loadGroups();
    state.rankings = defaultRankings();
    loadPrediction();

    renderGroups();
    renderThirdPlace();
    updateBracket();
  } catch (error) {
    document.querySelector("main").innerHTML =
      `<div class="empty">${safe(error.message)}</div>`;
  }
})();
