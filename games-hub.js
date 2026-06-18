const STORE = {
  table: "fp-pl-table-2627",
  predictions: "fp-score-predictions",
  tournaments: "fp-tournament-picks",
  h2h: "fp-h2h-season",
  lineup: "fp-dream-lineup"
};

const $ = selector => document.querySelector(selector);

const defaultTeams = [
  "Arsenal",
  "Aston Villa",
  "Bournemouth",
  "Brentford",
  "Brighton & Hove Albion",
  "Burnley",
  "Chelsea",
  "Crystal Palace",
  "Everton",
  "Fulham",
  "Leeds United",
  "Liverpool",
  "Manchester City",
  "Manchester United",
  "Newcastle United",
  "Nottingham Forest",
  "Sunderland",
  "Tottenham Hotspur",
  "West Ham United",
  "Wolverhampton Wanderers"
];

let tableRows = [];
let predictionRows = [];
let tournamentRows = [];
let h2h = {
  playerOne: "Player 1",
  playerTwo: "Player 2",
  rounds: []
};

let lineup = {
  name: "My Dream XI",
  formation: "4-3-3",
  players: {}
};

let selectedPosition = "GK";

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadStore(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function blankTable() {
  return defaultTeams.map((team, index) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${index}`,
    team,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0
  }));
}

function calculatedRow(row) {
  const w = Math.max(0, Number(row.w) || 0);
  const d = Math.max(0, Number(row.d) || 0);
  const l = Math.max(0, Number(row.l) || 0);
  const gf = Math.max(0, Number(row.gf) || 0);
  const ga = Math.max(0, Number(row.ga) || 0);

  return {
    ...row,
    w, d, l, gf, ga,
    p: w + d + l,
    gd: gf - ga,
    pts: w * 3 + d
  };
}

function sortedTable() {
  return tableRows
    .map(calculatedRow)
    .sort((a, b) =>
      b.pts - a.pts ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.team.localeCompare(b.team)
    );
}

function zoneClass(position) {
  if (position <= 4) return "zone-ucl";
  if (position <= 6) return "zone-europa";
  if (position === 7) return "zone-conference";
  if (position >= 18) return "zone-drop";
  return "";
}

function renderTable() {
  const sorted = sortedTable();

  $("#calculatorBody").innerHTML = sorted.map((row, index) => `
    <tr class="calculator-row ${zoneClass(index + 1)}" data-row-id="${safe(row.id)}">
      <td>${index + 1}</td>
      <td class="club-cell">
        <div class="club-edit">
          <input class="team-input" value="${safe(row.team)}" aria-label="Club name">
        </div>
      </td>
      <td>${row.p}</td>
      <td><input class="stat-field" data-field="w" type="number" min="0" max="38" value="${row.w}"></td>
      <td><input class="stat-field" data-field="d" type="number" min="0" max="38" value="${row.d}"></td>
      <td><input class="stat-field" data-field="l" type="number" min="0" max="38" value="${row.l}"></td>
      <td><input class="stat-field" data-field="gf" type="number" min="0" value="${row.gf}"></td>
      <td><input class="stat-field" data-field="ga" type="number" min="0" value="${row.ga}"></td>
      <td>${row.gd}</td>
      <td class="points-output">${row.pts}</td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-row-id]").forEach(tr => {
    const id = tr.dataset.rowId;
    const row = tableRows.find(item => item.id === id);

    tr.querySelector(".team-input").addEventListener("change", event => {
      row.team = event.target.value.trim() || "Unnamed Club";
      renderTable();
    });

    tr.querySelectorAll("[data-field]").forEach(input => {
      input.addEventListener("change", event => {
        row[event.target.dataset.field] =
          Math.max(0, Number(event.target.value) || 0);
        renderTable();
      });
    });
  });

  $("#championSummary").textContent = sorted[0]?.team || "Not decided";
  $("#topFourSummary").textContent = `${sorted[3]?.pts || 0} pts`;
  $("#safetySummary").textContent = `${sorted[16]?.pts || 0} pts`;
  $("#relegatedSummary").textContent =
    sorted.slice(17).map(row => row.team).join(", ") || "Not decided";
}

function scoreOutcome(home, away) {
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

function predictionPoints(row) {
  const ph = Number(row.predHome);
  const pa = Number(row.predAway);
  const ah = Number(row.actualHome);
  const aa = Number(row.actualAway);
  const predicted = row.predHome !== "" && row.predAway !== "";
  const completed = row.actualHome !== "" && row.actualAway !== "";

  if (!completed) return 0;

  if (!predicted) {
    const actualWinner =
      ah > aa ? "home" : aa > ah ? "away" : "draw";
    const unexpected =
      row.favourite &&
      row.favourite !== "draw" &&
      actualWinner !== "draw" &&
      actualWinner !== row.favourite;

    return unexpected ? 1 : 0;
  }

  if (ph === ah && pa === aa) return 5;
  if (scoreOutcome(ph, pa) === scoreOutcome(ah, aa)) return 3;
  if (ph === ah || pa === aa) return 2;
  return 0;
}

function addPredictionRow() {
  predictionRows.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    home: "Home Team",
    away: "Away Team",
    predHome: "",
    predAway: "",
    actualHome: "",
    actualAway: "",
    favourite: "home"
  });

  renderPredictions();
}

function renderPredictions() {
  $("#predictionMatches").innerHTML = predictionRows.length
    ? predictionRows.map(row => `
        <article class="prediction-card" data-pred-id="${safe(row.id)}">
          <div class="prediction-grid">
            <label>
              <span>Home team</span>
              <input data-field="home" value="${safe(row.home)}">
            </label>
            <label>
              <span>Pick H</span>
              <input data-field="predHome" type="number" min="0" value="${safe(row.predHome)}">
            </label>
            <label>
              <span>Pick A</span>
              <input data-field="predAway" type="number" min="0" value="${safe(row.predAway)}">
            </label>
            <label>
              <span>Away team</span>
              <input data-field="away" value="${safe(row.away)}">
            </label>
            <label>
              <span>Favourite</span>
              <select data-field="favourite">
                <option value="home" ${row.favourite === "home" ? "selected" : ""}>Home</option>
                <option value="away" ${row.favourite === "away" ? "selected" : ""}>Away</option>
                <option value="draw" ${row.favourite === "draw" ? "selected" : ""}>Even odds</option>
              </select>
            </label>
            <label>
              <span>Actual H</span>
              <input data-field="actualHome" type="number" min="0" value="${safe(row.actualHome)}">
            </label>
            <label>
              <span>Actual A</span>
              <input data-field="actualAway" type="number" min="0" value="${safe(row.actualAway)}">
            </label>
            <button class="button button-ghost remove-prediction">Remove</button>
          </div>
          <div class="prediction-points">${predictionPoints(row)} points</div>
        </article>
      `).join("")
    : `<div class="empty">Add a match to begin predicting.</div>`;

  document.querySelectorAll("[data-pred-id]").forEach(card => {
    const row = predictionRows.find(item => item.id === card.dataset.predId);

    card.querySelectorAll("[data-field]").forEach(input => {
      input.addEventListener("change", event => {
        row[event.target.dataset.field] = event.target.value;
        saveStore(STORE.predictions, predictionRows);
        renderPredictions();
      });
    });

    card.querySelector(".remove-prediction").addEventListener("click", () => {
      predictionRows = predictionRows.filter(item => item.id !== row.id);
      saveStore(STORE.predictions, predictionRows);
      renderPredictions();
    });
  });
}

function addTournamentRow() {
  tournamentRows.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    tournament: "Tournament",
    predictedWinner: "",
    actualWinner: ""
  });
  renderTournaments();
}

function tournamentPoints(row) {
  const predicted = row.predictedWinner.trim().toLowerCase();
  const actual = row.actualWinner.trim().toLowerCase();

  return predicted && actual && predicted === actual ? 15 : 0;
}

function renderTournaments() {
  $("#tournamentPicks").innerHTML = tournamentRows.length
    ? tournamentRows.map(row => `
        <article class="tournament-card" data-tournament-id="${safe(row.id)}">
          <div class="tournament-grid">
            <label>
              <span>Tournament</span>
              <input data-field="tournament" value="${safe(row.tournament)}">
            </label>
            <label>
              <span>Your winner</span>
              <input data-field="predictedWinner" value="${safe(row.predictedWinner)}">
            </label>
            <label>
              <span>Actual winner</span>
              <input data-field="actualWinner" value="${safe(row.actualWinner)}">
            </label>
            <div class="prediction-points">${tournamentPoints(row)} points</div>
            <button class="button button-ghost remove-tournament">Remove</button>
          </div>
        </article>
      `).join("")
    : `<div class="empty">Add a tournament winner prediction.</div>`;

  document.querySelectorAll("[data-tournament-id]").forEach(card => {
    const row = tournamentRows.find(item => item.id === card.dataset.tournamentId);

    card.querySelectorAll("[data-field]").forEach(input => {
      input.addEventListener("change", event => {
        row[event.target.dataset.field] = event.target.value;
        saveStore(STORE.tournaments, tournamentRows);
        renderTournaments();
      });
    });

    card.querySelector(".remove-tournament").addEventListener("click", () => {
      tournamentRows = tournamentRows.filter(item => item.id !== row.id);
      saveStore(STORE.tournaments, tournamentRows);
      renderTournaments();
    });
  });
}

function renderH2H() {
  const p1 = h2h.playerOne || "Player 1";
  const p2 = h2h.playerTwo || "Player 2";
  const p1Total = h2h.rounds.reduce((sum, round) => sum + Number(round.p1 || 0), 0);
  const p2Total = h2h.rounds.reduce((sum, round) => sum + Number(round.p2 || 0), 0);

  $("#playerOneName").value = p1;
  $("#playerTwoName").value = p2;
  $("#playerOneLabel").textContent = p1;
  $("#playerTwoLabel").textContent = p2;
  $("#h2hP1Head").textContent = p1;
  $("#h2hP2Head").textContent = p2;
  $("#playerOnePoints").textContent = p1Total;
  $("#playerTwoPoints").textContent = p2Total;

  $("#h2hRounds").innerHTML = h2h.rounds.length
    ? h2h.rounds.map(round => {
        const winner =
          Number(round.p1) > Number(round.p2)
            ? p1
            : Number(round.p2) > Number(round.p1)
              ? p2
              : "Draw";

        return `
          <tr>
            <td>${safe(round.name)}</td>
            <td>${safe(round.p1)}</td>
            <td>${safe(round.p2)}</td>
            <td>${safe(winner)}</td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="4"><div class="empty">No rounds added yet.</div></td></tr>`;
}

const formationPositions = {
  "4-3-3": [
    ["GK",50,90],
    ["LB",15,72],["LCB",38,75],["RCB",62,75],["RB",85,72],
    ["LCM",30,52],["CM",50,47],["RCM",70,52],
    ["LW",18,24],["ST",50,17],["RW",82,24]
  ],
  "4-2-3-1": [
    ["GK",50,90],
    ["LB",15,72],["LCB",38,75],["RCB",62,75],["RB",85,72],
    ["LDM",38,58],["RDM",62,58],
    ["LAM",24,37],["CAM",50,33],["RAM",76,37],
    ["ST",50,16]
  ],
  "4-4-2": [
    ["GK",50,90],
    ["LB",15,72],["LCB",38,75],["RCB",62,75],["RB",85,72],
    ["LM",15,48],["LCM",38,52],["RCM",62,52],["RM",85,48],
    ["LST",38,18],["RST",62,18]
  ],
  "3-5-2": [
    ["GK",50,90],
    ["LCB",25,72],["CB",50,76],["RCB",75,72],
    ["LWB",10,49],["LCM",33,52],["CM",50,45],["RCM",67,52],["RWB",90,49],
    ["LST",38,18],["RST",62,18]
  ],
  "3-4-3": [
    ["GK",50,90],
    ["LCB",25,72],["CB",50,76],["RCB",75,72],
    ["LM",15,50],["LCM",40,51],["RCM",60,51],["RM",85,50],
    ["LW",18,23],["ST",50,17],["RW",82,23]
  ]
};

function renderLineup() {
  $("#lineupName").value = lineup.name;
  $("#formationSelect").value = lineup.formation;
  $("#selectedPosition").value = selectedPosition;

  const positions = formationPositions[lineup.formation];

  $("#pitchPlayers").innerHTML = positions.map(([position, x, y]) => {
    const player = lineup.players[position] || {};

    return `
      <button
        class="pitch-player ${selectedPosition === position ? "active" : ""}"
        data-position="${safe(position)}"
        style="left:${x}%;top:${y}%">
        <span>${safe(position)}</span>
        <strong>${safe(player.name || "Add player")}</strong>
        <small>${safe(player.team || "")}</small>
      </button>
    `;
  }).join("");

  document.querySelectorAll("[data-position]").forEach(button => {
    button.addEventListener("click", () => {
      selectedPosition = button.dataset.position;
      const player = lineup.players[selectedPosition] || {};
      $("#selectedPosition").value = selectedPosition;
      $("#playerNameInput").value = player.name || "";
      $("#playerTeamInput").value = player.team || "";
      renderLineup();
    });
  });
}

document.querySelectorAll(".hub-tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".hub-tab").forEach(item =>
      item.classList.remove("active")
    );
    button.classList.add("active");

    document.querySelectorAll(".hub-panel").forEach(panel => {
      panel.hidden = panel.id !== button.dataset.panel;
    });
  });
});

$("#saveTable").addEventListener("click", () => saveStore(STORE.table, tableRows));
$("#resetTable").addEventListener("click", () => {
  tableRows = blankTable();
  saveStore(STORE.table, tableRows);
  renderTable();
});

$("#addPredictionMatch").addEventListener("click", addPredictionRow);
$("#addTournamentPick").addEventListener("click", addTournamentRow);

$("#playerOneName").addEventListener("change", event => {
  h2h.playerOne = event.target.value.trim() || "Player 1";
  saveStore(STORE.h2h, h2h);
  renderH2H();
});

$("#playerTwoName").addEventListener("change", event => {
  h2h.playerTwo = event.target.value.trim() || "Player 2";
  saveStore(STORE.h2h, h2h);
  renderH2H();
});

$("#addH2HRound").addEventListener("click", () => {
  h2h.rounds.push({
    name: $("#roundName").value.trim() || `Round ${h2h.rounds.length + 1}`,
    p1: Number($("#roundP1").value) || 0,
    p2: Number($("#roundP2").value) || 0
  });
  saveStore(STORE.h2h, h2h);
  renderH2H();
});

$("#resetH2H").addEventListener("click", () => {
  h2h = { playerOne: "Player 1", playerTwo: "Player 2", rounds: [] };
  saveStore(STORE.h2h, h2h);
  renderH2H();
});

$("#formationSelect").addEventListener("change", event => {
  lineup.formation = event.target.value;
  selectedPosition = "GK";
  renderLineup();
});

$("#lineupName").addEventListener("change", event => {
  lineup.name = event.target.value.trim() || "My Dream XI";
});

$("#applyPlayer").addEventListener("click", () => {
  lineup.players[selectedPosition] = {
    name: $("#playerNameInput").value.trim() || "Unnamed Player",
    team: $("#playerTeamInput").value.trim()
  };
  renderLineup();
});

$("#saveLineup").addEventListener("click", () => {
  lineup.name = $("#lineupName").value.trim() || "My Dream XI";
  saveStore(STORE.lineup, lineup);
});

$("#resetLineup").addEventListener("click", () => {
  lineup = { name: "My Dream XI", formation: "4-3-3", players: {} };
  selectedPosition = "GK";
  saveStore(STORE.lineup, lineup);
  renderLineup();
});

$("#menuButton").addEventListener("click", () => {
  const menu = $("#mobileMenu");
  menu.hidden = !menu.hidden;
});

tableRows = loadStore(STORE.table, blankTable());
predictionRows = loadStore(STORE.predictions, []);
tournamentRows = loadStore(STORE.tournaments, []);
h2h = loadStore(STORE.h2h, h2h);
lineup = loadStore(STORE.lineup, lineup);

renderTable();
renderPredictions();
renderTournaments();
renderH2H();
renderLineup();
