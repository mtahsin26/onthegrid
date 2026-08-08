// DOM wiring, rendering, and interaction. All pure logic lives in
// puzzle.js. To swap generation or save/load to a backend later,
// change only the functions marked with `backend:` below.

"use strict";

import {
  MIN_SIZE, MAX_SIZE, EMPTY, MARK_X, QUEEN,
  grid2d, fmtTime,
  generatePuzzle, pickColors,
  computeConflicts, computeCoverage, displayState,
  puzzleToJSON, clonePuzzle, validateImport
} from "./puzzle.js";

// One SVG per borough. viewBox 0 0 24 24 so they all sit in the same
// cell slot without extra scaling logic.
const ICONS = {
  brooklyn: {
    borough: "Brooklyn",
    nickname: "Kings County",
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#d99a2b" stroke="#1c2434" stroke-width="1.2" stroke-linejoin="round" d="M3 8l4 4 5-7 5 7 4-4-1.5 10h-15z"/></svg>'
  },
  queens: {
    borough: "Queens",
    nickname: "The World's Borough",
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#1c2434" stroke-width="1.1" stroke-linecap="round" fill="none"><circle cx="12" cy="11" r="6.5" fill="#a3c9f9"/><ellipse cx="12" cy="11" rx="6.5" ry="2.5"/><ellipse cx="12" cy="11" rx="2.5" ry="6.5"/><line x1="5.5" y1="11" x2="18.5" y2="11"/><path d="M12 18v3M9 21h6"/></g></svg>'
  },
  manhattan: {
    borough: "Manhattan",
    nickname: "Empire State of Mind",
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#c7b9a8" stroke="#1c2434" stroke-width="0.9" stroke-linejoin="round"><path d="M11.7 2h0.6v3h-0.6z"/><path d="M10.5 5h3v3h-3z"/><path d="M9 8h6v4H9z"/><path d="M7 12h10v10H7z"/><path d="M9 14h1v2H9zM11 14h1v2h-1zM13 14h1v2h-1zM14 14h1v2h-1z" fill="#1c2434" stroke="none"/></g></svg>'
  },
  bronx: {
    borough: "Bronx",
    nickname: "The Boogie Down",
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#1c2434" stroke-width="1" stroke-linejoin="round"><path fill="none" d="M8 6.5c0-1 1-2 2-2h4c1 0 2 1 2 2"/><rect x="3.5" y="6.5" width="17" height="13" rx="1.5" fill="#8892a6"/><circle cx="8" cy="13" r="2.8" fill="#1c2434"/><circle cx="16" cy="13" r="2.8" fill="#1c2434"/><rect x="10.5" y="8" width="3" height="1.5" fill="#e6e6e0"/></g></svg>'
  },
  statenisland: {
    borough: "Staten Island",
    nickname: "The Shaolin",
    svg: '<img src="wutangicon.png" alt="" draggable="false">'
  }
};

const iconLabel = key => ICONS[key].borough + " - " + ICONS[key].nickname;

let currentIcon = "brooklyn"; // default matches original crown

/* ============================================================
   State
   ============================================================ */

let puzzle = null;        // { size, regions, solution, colors, name }
let marks = [];           // 2D array of EMPTY | MARK_X | QUEEN
let undoStack = [];
let savedPuzzles = [];    // in-memory list for this session
let saveCounter = 0;
let solved = false;
let awaitingStart = false; // board built but hidden, timer not running

let timerId = null, elapsed = 0;
let pointer = null; // { startR, startC, axis, moved, snapshot }

/* ============================================================
   DOM refs
   ============================================================ */

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");

/* ============================================================
   Board rendering
   ============================================================ */

function buildBoard() {
  const n = puzzle.size;
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = "repeat(" + n + ", minmax(0, 1fr))";
  boardEl.style.gridTemplateRows = "repeat(" + n + ", minmax(0, 1fr))";
  const thin = "1px solid rgba(28,36,52,0.22)";
  const thick = "2px solid #1c2434";

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.style.background = puzzle.colors[puzzle.regions[r][c]];
      // Draw only top and left edges per cell, the frame covers the rest
      cell.style.borderTop = r === 0 ? "0"
        : (puzzle.regions[r][c] !== puzzle.regions[r - 1][c] ? thick : thin);
      cell.style.borderLeft = c === 0 ? "0"
        : (puzzle.regions[r][c] !== puzzle.regions[r][c - 1] ? thick : thin);
      boardEl.appendChild(cell);
    }
  }
  renderMarks();
}

function cellEl(r, c) {
  return boardEl.children[r * puzzle.size + c];
}

function renderMarks() {
  const n = puzzle.size;
  const conflicts = computeConflicts(puzzle, marks);
  const cov = computeCoverage(puzzle, marks);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const el = cellEl(r, c);
      const d = displayState(marks, r, c, cov);
      el.innerHTML = d === MARK_X
        ? '<span class="mark-x' + (marks[r][c] === MARK_X ? '' : ' auto') + '">&times;</span>'
        : d === QUEEN ? ICONS[currentIcon].svg : "";
      el.classList.toggle("conflict", conflicts.has(r + "," + c));
      el.setAttribute("aria-label",
        "Row " + (r + 1) + " column " + (c + 1) + ", " +
        (d === QUEEN ? "queen" : d === MARK_X ? "marked" : "empty"));
    }
  }
  updateButtons();
}

/* ============================================================
   Solved check
   ============================================================ */

function checkSolved() {
  const n = puzzle.size;
  let queenCount = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (marks[r][c] === QUEEN) queenCount++;
  if (queenCount !== n) return;
  if (computeConflicts(puzzle, marks).size > 0) return;
  onWin();
}

function onWin() {
  solved = true;
  stopTimer();
  document.getElementById("winTime").textContent =
    "Finished in " + fmtTime(elapsed);
  document.getElementById("winBanner").classList.add("show");
  updateButtons();
  document.getElementById("winCloseBtn").focus();
}

/* Dismiss the win card so the finished board is visible.
   The time stays on screen in the status line and the timer
   stays stopped, so nothing is lost by closing. */
function dismissWin() {
  document.getElementById("winBanner").classList.remove("show");
  setStatus("Solved in " + fmtTime(elapsed) + ". Pick a size and press New puzzle when you are ready.");
  statusEl.classList.add("solved-note");
}

document.getElementById("winCloseBtn").addEventListener("click", dismissWin);
document.getElementById("winReviewBtn").addEventListener("click", dismissWin);

document.getElementById("winBanner").addEventListener("pointerdown", e => {
  if (e.target.id === "winBanner") dismissWin();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" &&
      document.getElementById("winBanner").classList.contains("show")) {
    dismissWin();
  }
});

/* ============================================================
   Interaction: a tap cycles empty, X, queen, back to empty.
   Press and drag along a row or a column paints Xs on empty
   cells. The axis locks to the first direction of movement.
   ============================================================ */

boardEl.addEventListener("pointerdown", e => {
  if (solved || awaitingStart || !puzzle) return;
  const cell = e.target.closest(".cell");
  if (!cell) return;
  e.preventDefault();
  pointer = {
    startR: +cell.dataset.r,
    startC: +cell.dataset.c,
    axis: null,
    moved: false,
    snapshot: marks.map(row => row.slice())
  };
});

boardEl.addEventListener("pointermove", e => {
  if (!pointer || solved) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el && el.closest ? el.closest(".cell") : null;
  if (!cell || !boardEl.contains(cell)) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  if (r === pointer.startR && c === pointer.startC && !pointer.moved) return;

  // Coverage is stable during a drag, no queens change mid-drag
  const cov = computeCoverage(puzzle, marks);

  if (!pointer.axis) {
    if (r === pointer.startR && c !== pointer.startC) pointer.axis = "h";
    else if (c === pointer.startC && r !== pointer.startR) pointer.axis = "v";
    else return;
    pointer.moved = true;
    paintX(pointer.startR, pointer.startC, cov);
  }

  if (pointer.axis === "h" && r === pointer.startR) {
    const lo = Math.min(pointer.startC, c), hi = Math.max(pointer.startC, c);
    for (let cc = lo; cc <= hi; cc++) paintX(pointer.startR, cc, cov);
  } else if (pointer.axis === "v" && c === pointer.startC) {
    const lo = Math.min(pointer.startR, r), hi = Math.max(pointer.startR, r);
    for (let rr = lo; rr <= hi; rr++) paintX(rr, pointer.startC, cov);
  }
  renderMarks();
});

function endPointer(e) {
  if (!pointer || !puzzle) return;
  const p = pointer;
  pointer = null;
  if (solved) return;

  if (!p.moved && e.type === "pointerup") {
    // Plain tap: cycle the cell state
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest ? el.closest(".cell") : null;
    if (cell && +cell.dataset.r === p.startR && +cell.dataset.c === p.startC) {
      undoStack.push(p.snapshot);
      trimUndo();
      cycleCell(p.startR, p.startC);
      return;
    }
  }
  if (p.moved) {
    undoStack.push(p.snapshot);
    trimUndo();
    updateButtons();
    checkSolved();
  }
}
boardEl.addEventListener("pointerup", endPointer);
boardEl.addEventListener("pointercancel", endPointer);

function paintX(r, c, cov) {
  // Only paint truly empty cells, auto Xs stay owned by their queen
  if (marks[r][c] === EMPTY && !cov[r][c]) marks[r][c] = MARK_X;
}

/* Cycle by what the cell shows: empty to X, any X to queen,
   queen back to empty. Removing the queen drops its auto Xs. */
function cycleCell(r, c) {
  const d = displayState(marks, r, c, computeCoverage(puzzle, marks));
  if (d === EMPTY) marks[r][c] = MARK_X;
  else if (d === MARK_X) marks[r][c] = QUEEN;
  else marks[r][c] = EMPTY;
  renderMarks();
  checkSolved();
}

boardEl.addEventListener("keydown", e => {
  if (solved || awaitingStart) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  const cell = e.target.closest(".cell");
  if (!cell) return;
  e.preventDefault();
  undoStack.push(marks.map(row => row.slice()));
  trimUndo();
  cycleCell(+cell.dataset.r, +cell.dataset.c);
});

function trimUndo() {
  if (undoStack.length > 300) undoStack.shift();
}

/* ============================================================
   Controls
   ============================================================ */

function setStatus(msg, isError) {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", !!isError);
  statusEl.classList.remove("solved-note");
}

document.getElementById("undoBtn").addEventListener("click", () => {
  if (!undoStack.length || solved || awaitingStart) return;
  marks = undoStack.pop();
  renderMarks();
});

document.getElementById("clearBtn").addEventListener("click", () => {
  if (!puzzle || solved || awaitingStart) return;
  undoStack.push(marks.map(row => row.slice()));
  trimUndo();
  marks = grid2d(puzzle.size, EMPTY);
  renderMarks();
  setStatus("");
});

document.getElementById("hintBtn").addEventListener("click", () => {
  if (!puzzle || solved || awaitingStart) return;
  const n = puzzle.size;
  for (let r = 0; r < n; r++) {
    const c = puzzle.solution[r];
    if (marks[r][c] !== QUEEN) {
      undoStack.push(marks.map(row => row.slice()));
      trimUndo();
      // Clear any queen already in this row, then reveal the right one
      for (let cc = 0; cc < n; cc++)
        if (marks[r][cc] === QUEEN) marks[r][cc] = EMPTY;
      marks[r][c] = QUEEN;
      renderMarks();
      checkSolved();
      return;
    }
  }
});

function updateButtons() {
  const idle = !puzzle || solved || awaitingStart;
  document.getElementById("undoBtn").disabled = !undoStack.length || idle;
  document.getElementById("hintBtn").disabled = idle;
  document.getElementById("clearBtn").disabled = idle;
}

/* ============================================================
   Timer
   ============================================================ */

function startTimer() {
  stopTimer();
  elapsed = 0;
  document.getElementById("timer").textContent = "0:00";
  timerId = setInterval(() => {
    elapsed++;
    document.getElementById("timer").textContent = fmtTime(elapsed);
  }, 1000);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

/* ============================================================
   New puzzle
   ============================================================ */

function startPuzzle(p) {
  puzzle = p;
  marks = grid2d(p.size, EMPTY);
  undoStack = [];
  solved = false;
  document.getElementById("winBanner").classList.remove("show");
  buildBoard();
  armGate();
  setStatus("");
  document.getElementById("saveName").value = p.name || "";
}

/* Hide the board and hold the timer at zero until Start is pressed */
function armGate() {
  awaitingStart = true;
  stopTimer();
  elapsed = 0;
  document.getElementById("timer").textContent = "0:00";
  document.getElementById("gateSize").textContent =
    puzzle.size + " x " + puzzle.size + " ready";
  document.getElementById("boardWrap").classList.add("armed");
  updateButtons();
  document.getElementById("startBtn").focus();
}

function beginPlay() {
  if (!puzzle || !awaitingStart) return;
  awaitingStart = false;
  document.getElementById("boardWrap").classList.remove("armed");
  startTimer();
  updateButtons();
}

document.getElementById("startBtn").addEventListener("click", beginPlay);

// backend: replace generatePuzzle with `fetch('/api/puzzle?size=' + n)`
// when a server is ready to serve/share puzzles.
function newPuzzle() {
  const n = +document.getElementById("sizeSel").value;
  setStatus("Generating...");
  // Let the status paint before the synchronous search runs
  setTimeout(() => {
    const p = generatePuzzle(n);
    if (!p) { setStatus("Could not generate a puzzle, try again.", true); return; }
    startPuzzle(p);
  }, 20);
}

document.getElementById("genBtn").addEventListener("click", newPuzzle);
document.getElementById("winNewBtn").addEventListener("click", newPuzzle);

/* ============================================================
   Save, export, import
   backend: swap savedPuzzles / downloadJSON for POSTs to
   `/api/puzzles` when a server is ready to persist across
   sessions and devices.
   ============================================================ */

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)],
    { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("saveBtn").addEventListener("click", () => {
  if (!puzzle) return;
  saveCounter++;
  const name = document.getElementById("saveName").value.trim()
    || puzzle.size + "x" + puzzle.size + " #" + saveCounter;
  puzzle.name = name;
  const copy = clonePuzzle(puzzle);
  savedPuzzles.push(copy);
  renderSavedList();
  downloadJSON(puzzleToJSON(copy), name.replace(/[^\w\-]+/g, "_") + ".json");
  setStatus('Saved "' + name + '" and downloaded its JSON file.');
});

document.getElementById("exportAllBtn").addEventListener("click", () => {
  if (!savedPuzzles.length) { setStatus("No saved puzzles to export.", true); return; }
  downloadJSON(savedPuzzles.map(puzzleToJSON), "queens_puzzles.json");
});

document.getElementById("importFile").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const items = Array.isArray(data) ? data : [data];
      let loaded = 0, last = null;
      for (const item of items) {
        const p = validateImport(item);
        if (p) { savedPuzzles.push(p); last = p; loaded++; }
      }
      renderSavedList();
      if (!loaded) { setStatus("No valid puzzles found in that file.", true); return; }
      setStatus("Imported " + loaded + " puzzle" + (loaded > 1 ? "s" : "") + ".");
      if (last) startPuzzle(clonePuzzle(last));
    } catch (err) {
      setStatus("Could not read that file as JSON.", true);
    }
  };
  reader.readAsText(file);
});

function renderSavedList() {
  const list = document.getElementById("savedList");
  document.getElementById("savedEmpty").style.display =
    savedPuzzles.length ? "none" : "block";
  list.innerHTML = "";
  savedPuzzles.forEach((p, i) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "pname";
    name.textContent = p.name;
    const size = document.createElement("span");
    size.className = "psize";
    size.textContent = p.size + "x" + p.size;
    const loadBtn = document.createElement("button");
    loadBtn.className = "btn";
    loadBtn.textContent = "Play";
    loadBtn.addEventListener("click", () => startPuzzle(clonePuzzle(p)));
    const dlBtn = document.createElement("button");
    dlBtn.className = "btn";
    dlBtn.textContent = "JSON";
    dlBtn.addEventListener("click", () =>
      downloadJSON(puzzleToJSON(p), p.name.replace(/[^\w\-]+/g, "_") + ".json"));
    const rmBtn = document.createElement("button");
    rmBtn.className = "btn";
    rmBtn.textContent = "Remove";
    rmBtn.addEventListener("click", () => {
      savedPuzzles.splice(i, 1);
      renderSavedList();
    });
    li.append(name, size, loadBtn, dlBtn, rmBtn);
    list.appendChild(li);
  });
}

/* ============================================================
   Init
   ============================================================ */

/* ============================================================
   Icon picker: pick which borough marker to place on the board.
   Board icon, win banner icon, and gate preview all follow.
   ============================================================ */

function applyIcon() {
  document.getElementById("winIcon").innerHTML = ICONS[currentIcon].svg;
  document.getElementById("gateIcon").innerHTML = ICONS[currentIcon].svg;
  document.getElementById("iconSelected").textContent = iconLabel(currentIcon);
  document.querySelectorAll(".icon-btn").forEach(b => {
    const sel = b.dataset.icon === currentIcon;
    b.classList.toggle("selected", sel);
    b.setAttribute("aria-pressed", sel ? "true" : "false");
  });
  if (puzzle) renderMarks();
}

function buildIconPicker() {
  const host = document.getElementById("iconChoices");
  for (const [key, icon] of Object.entries(ICONS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn";
    btn.dataset.icon = key;
    btn.title = iconLabel(key);
    btn.setAttribute("aria-label", iconLabel(key));
    btn.innerHTML = icon.svg;
    btn.addEventListener("click", () => { currentIcon = key; applyIcon(); });
    host.appendChild(btn);
  }
}

(function init() {
  const sel = document.getElementById("sizeSel");
  for (let n = MIN_SIZE; n <= MAX_SIZE; n++) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n + " x " + n;
    if (n === 7) opt.selected = true;
    sel.appendChild(opt);
  }
  buildIconPicker();
  applyIcon();
  renderSavedList();
  newPuzzle();
})();
