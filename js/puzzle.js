// Pure game logic: no DOM, no globals. Safe to lift to a Node/edge
// backend later for server-generated puzzles, shared daily puzzles,
// or server-side solution validation.

"use strict";

export const MIN_SIZE = 4;
export const MAX_SIZE = 11;
export const EMPTY = 0, MARK_X = 1, QUEEN = 2;
export const MIN_REGION = 2;
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// NYC-themed pastels: tinted so a dark icon on top stays readable.
// Team/borough references in comments are the inspiration, not the exact hex.
const PALETTE = [
  "#F7B731", // taxi yellow
  "#B9D6E8", // MetroCard / Yankees sky
  "#F5B8A5", // Knicks / Mets orange
  "#B8E4D8", // Liberty seafoam
  "#F0B6BC", // Rangers / Giants red
  "#A9C8B0", // Jets green
  "#C7B9A8", // brownstone
  "#D6C3E0", // Empire violet
  "#FFEEA0", // MTA yellow line
  "#B4C1DB", // Mets / Yankees navy
  "#F8C98F", // sunset orange
  "#8FCB9B"  // parks green
];

/* ============================================================
   Utilities
   ============================================================ */

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function grid2d(n, fill) {
  return Array.from({ length: n }, () => Array(n).fill(fill));
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

/* ============================================================
   Puzzle generation

   1. Place n queens: one per row and column, no two touching,
      not even diagonally. With one queen per row, only
      consecutive rows can touch, so the placement is a
      permutation p where abs(p[r] - p[r-1]) >= 2.
   2. Grow color regions outward from each queen. Every region
      gets a target size (never below MIN_REGION, so no lone
      single cells) and a growth style: snaky regions extend
      tendrils, blobby ones stay compact. This is what makes
      the shapes intricate and varied.
   3. Count solutions with a fast row-by-row solver.
   4. If extra solutions exist, repair: reassign one cell used
      by an alternate solution to a neighboring region. That
      kills the alternate while the intended solution survives,
      because the alternate now uses the neighbor region twice.
      Repairs respect connectivity and the size floor.
   ============================================================ */

function genPlacement(n) {
  const cols = [...Array(n).keys()];
  const p = [];
  const used = new Set();
  function bt(r) {
    if (r === n) return true;
    const cand = shuffle(cols.filter(c =>
      !used.has(c) && (r === 0 || Math.abs(c - p[r - 1]) >= 2)));
    for (const c of cand) {
      p.push(c); used.add(c);
      if (bt(r + 1)) return true;
      p.pop(); used.delete(c);
    }
    return false;
  }
  return bt(0) ? p : null;
}

function genRegions(n, placement) {
  const region = grid2d(n, -1);
  const cells = [];
  for (let r = 0; r < n; r++) {
    region[r][placement[r]] = r;
    cells.push([[r, placement[r]]]);
  }

  // Target sizes: a floor of MIN_REGION each, the rest spread
  // with skewed weights so some regions run large and some small
  const targets = new Array(n).fill(MIN_REGION);
  let extra = n * n - n * MIN_REGION;
  const w = Array.from({ length: n }, () => Math.pow(Math.random(), 1.6) + 0.05);
  const wSum = w.reduce((a, b) => a + b, 0);
  let given = 0;
  for (let i = 0; i < n; i++) {
    const add = Math.floor(extra * w[i] / wSum);
    targets[i] += add;
    given += add;
  }
  while (given < extra) { targets[Math.floor(Math.random() * n)]++; given++; }

  // Growth style per region: snaky extends tendrils, blobby stays compact
  const snaky = Array.from({ length: n }, () => Math.random() < 0.6);

  function sameNbrs(r, c, id) {
    let s = 0;
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && region[rr][cc] === id) s++;
    }
    return s;
  }

  function growOne(id) {
    const frontier = [];
    for (const [r, c] of cells[id]) {
      for (const [dr, dc] of DIRS) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && region[rr][cc] === -1)
          frontier.push([rr, cc]);
      }
    }
    if (!frontier.length) return false;
    shuffle(frontier);
    let pick = frontier[0];
    if (frontier.length > 1) {
      // snaky picks the cell touching the region least, blobby the most
      let best = frontier[0], bestS = sameNbrs(frontier[0][0], frontier[0][1], id);
      for (let i = 1; i < frontier.length; i++) {
        const s = sameNbrs(frontier[i][0], frontier[i][1], id);
        if (snaky[id] ? s < bestS : s > bestS) { best = frontier[i]; bestS = s; }
      }
      pick = best;
    }
    region[pick[0]][pick[1]] = id;
    cells[id].push(pick);
    return true;
  }

  let unassigned = n * n - n;
  while (unassigned > 0) {
    // regions below the size floor grow first so nothing gets
    // walled off at one cell, then regions still under target
    let under = [];
    for (let id = 0; id < n; id++)
      if (cells[id].length < MIN_REGION) under.push(id);
    if (!under.length)
      for (let id = 0; id < n; id++)
        if (cells[id].length < targets[id]) under.push(id);

    let grown = false;
    if (under.length) {
      const pool = under.slice();
      while (pool.length && !grown) {
        // weighted by remaining need so big targets keep pace
        let total = 0;
        for (const id of pool) total += targets[id] - cells[id].length;
        let pick = Math.random() * total, chosen = pool[0];
        for (const id of pool) {
          pick -= targets[id] - cells[id].length;
          if (pick <= 0) { chosen = id; break; }
        }
        if (growOne(chosen)) grown = true;
        else pool.splice(pool.indexOf(chosen), 1);
      }
    }
    if (!grown) {
      // overflow: walled-off cells go to whichever neighbor can take them
      for (const id of shuffle([...Array(n).keys()])) {
        if (growOne(id)) { grown = true; break; }
      }
    }
    if (!grown) return null;
    unassigned--;
  }

  // reject any layout that still ended up with a region under the floor
  const sizes = new Array(n).fill(0);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) sizes[region[r][c]]++;
  if (Math.min(...sizes) < MIN_REGION) return null;
  return region;
}

export function countSolutions(regions, n, limit) {
  let count = 0;
  const usedCol = new Array(n).fill(false);
  const usedReg = new Array(n).fill(false);
  const colAt = new Array(n).fill(-1);
  const solutions = [];

  function bt(r) {
    if (count >= limit) return;
    if (r === n) {
      count++;
      solutions.push(colAt.slice());
      return;
    }
    for (let c = 0; c < n; c++) {
      if (usedCol[c]) continue;
      const id = regions[r][c];
      if (usedReg[id]) continue;
      // Only the previous row can produce a diagonal or side touch
      if (r > 0 && Math.abs(colAt[r - 1] - c) <= 1) continue;
      usedCol[c] = true; usedReg[id] = true; colAt[r] = c;
      bt(r + 1);
      usedCol[c] = false; usedReg[id] = false; colAt[r] = -1;
    }
  }
  bt(0);
  return { count, firstSolution: solutions[0] || null, solutions };
}

export function pickColors(n) {
  const colors = shuffle(PALETTE.slice());
  while (colors.length < n) {
    const h = Math.floor(Math.random() * 360);
    colors.push("hsl(" + h + ", 65%, 82%)");
  }
  return colors.slice(0, n);
}

function stillConnected(region, n, g) {
  let start = null, count = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (region[r][c] === g) { count++; if (!start) start = [r, c]; }
  if (!count) return false;
  const seen = new Set([start[0] + "," + start[1]]);
  const stack = [start];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc, k = rr + "," + cc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n &&
          region[rr][cc] === g && !seen.has(k)) {
        seen.add(k);
        stack.push([rr, cc]);
      }
    }
  }
  return seen.size === count;
}

function makeUnique(region, n, placement, maxIters) {
  const sizeOf = id => {
    let s = 0;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (region[r][c] === id) s++;
    return s;
  };
  for (let it = 0; it < maxIters; it++) {
    const res = countSolutions(region, n, 2);
    if (res.count === 1) return true;
    if (res.count === 0) return false;
    const alt = res.solutions.find(s => !s.every((c, r) => c === placement[r]));
    if (!alt) return false;
    const rows = shuffle([...Array(n).keys()].filter(r => alt[r] !== placement[r]));
    let done = false;
    for (const r of rows) {
      const c = alt[r], g = region[r][c];
      if (sizeOf(g) <= MIN_REGION) continue; // never shrink below the floor
      const neigh = new Set();
      for (const [dr, dc] of DIRS) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && region[rr][cc] !== g)
          neigh.add(region[rr][cc]);
      }
      for (const g2 of shuffle([...neigh])) {
        region[r][c] = g2;
        if (stillConnected(region, n, g)) { done = true; break; }
        region[r][c] = g;
      }
      if (done) break;
    }
    if (!done) return false;
  }
  return countSolutions(region, n, 2).count === 1;
}

export function generatePuzzle(n) {
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    const placement = genPlacement(n);
    if (!placement) continue;
    for (let t = 0; t < 8 && Date.now() - t0 < 9000; t++) {
      const regions = genRegions(n, placement);
      if (!regions) continue;
      if (makeUnique(regions, n, placement, n * 8)) {
        return {
          size: n,
          regions,
          solution: placement,
          colors: pickColors(n),
          name: ""
        };
      }
    }
  }
  return null;
}

/* ============================================================
   Rule checking (pure — takes puzzle + marks, returns result)
   ============================================================ */

export function computeConflicts(puzzle, marks) {
  const n = puzzle.size;
  const bad = new Set();
  const queens = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (marks[r][c] === QUEEN) queens.push([r, c]);

  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      const r1 = queens[i][0], c1 = queens[i][1];
      const r2 = queens[j][0], c2 = queens[j][1];
      const sameRegion = puzzle.regions[r1][c1] === puzzle.regions[r2][c2];
      const touching = Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
      if (r1 === r2 || c1 === c2 || sameRegion || touching) {
        bad.add(r1 + "," + c1);
        bad.add(r2 + "," + c2);
      }
    }
  }
  return bad;
}

/* Auto X layer: every queen covers its row, its column, and the
   ring of cells around it. Coverage is recomputed from the queens
   on every render, so removing a queen removes exactly its Xs
   while Xs still justified by another queen stay put. */
export function computeCoverage(puzzle, marks) {
  const n = puzzle.size;
  const cov = grid2d(n, false);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (marks[r][c] !== QUEEN) continue;
      for (let i = 0; i < n; i++) { cov[r][i] = true; cov[i][c] = true; }
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n) cov[rr][cc] = true;
        }
    }
  }
  return cov;
}

/* What a cell shows: manual queen, then manual X, then auto X. */
export function displayState(marks, r, c, cov) {
  if (marks[r][c] === QUEEN) return QUEEN;
  if (marks[r][c] === MARK_X) return MARK_X;
  return cov[r][c] ? MARK_X : EMPTY;
}

/* ============================================================
   Serialization
   ============================================================ */

export function puzzleToJSON(p) {
  return {
    format: "queens-puzzle",
    version: 1,
    name: p.name,
    size: p.size,
    regions: p.regions,
    solution: p.solution
  };
}

export function clonePuzzle(p) {
  return {
    size: p.size,
    regions: p.regions.map(r => r.slice()),
    solution: p.solution.slice(),
    colors: p.colors.slice(),
    name: p.name
  };
}

export function validateImport(item) {
  if (!item || typeof item !== "object") return null;
  const n = item.size;
  if (!Number.isInteger(n) || n < MIN_SIZE || n > 14) return null;
  const reg = item.regions;
  if (!Array.isArray(reg) || reg.length !== n) return null;
  for (const row of reg) {
    if (!Array.isArray(row) || row.length !== n) return null;
    for (const v of row)
      if (!Number.isInteger(v) || v < 0 || v >= n) return null;
  }
  const regions = reg.map(r => r.slice());
  // Recompute the solution from the regions so hand-made files work too
  const res = countSolutions(regions, n, 2);
  if (res.count === 0) return null;
  return {
    size: n,
    regions,
    solution: res.firstSolution,
    colors: pickColors(n),
    name: typeof item.name === "string" && item.name ? item.name : n + "x" + n + " imported"
  };
}
