// Road router for the world generator (dev-only). Usage: node astar.js <job.json>
// job = {n, cell, ws, hFile (float32 LE n*n), penFile (float32 LE n*n: extra cost multiplier, <0 = blocked),
//        maxGrade, gradeW, share, routes: [[x0,z0,x1,z1], ...]}  ->  stdout JSON [[ [x,z], ... ], ...]
'use strict';
const fs = require('fs');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const n = job.n, cell = job.cell, ws = job.ws;
const H = new Float32Array(fs.readFileSync(job.hFile).buffer.slice(0));
const P = new Float32Array(fs.readFileSync(job.penFile).buffer.slice(0));
const maxG = job.maxGrade || 0.5, gW = job.gradeW || 14, share = job.share || 0.55;
const N = n * n;
const ROAD = new Uint8Array(N);
const g = new Float64Array(N), from = new Int32Array(N), stamp = new Int32Array(N), closed = new Int32Array(N);
// 16-neighbourhood (8 + knight moves) for smoother angles
const NB = [];
for (const [dj, di] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
  [-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]) NB.push([dj, di, Math.hypot(dj, di) * cell]);
// binary heap on (f, idx)
let hf = new Float64Array(1 << 16), hi = new Int32Array(1 << 16), hn = 0;
function push(f, i) {
  if (hn >= hf.length) { const f2 = new Float64Array(hf.length * 2); f2.set(hf); hf = f2; const i2 = new Int32Array(hi.length * 2); i2.set(hi); hi = i2; }
  let k = hn++;
  while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; hf[k] = hf[p]; hi[k] = hi[p]; k = p; }
  hf[k] = f; hi[k] = i;
}
function pop() {
  const r = hi[0]; const lf = hf[--hn], li = hi[hn]; let k = 0;
  for (;;) { let c = 2 * k + 1; if (c >= hn) break; if (c + 1 < hn && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hf[k] = hf[c]; hi[k] = hi[c]; k = c; }
  hf[k] = lf; hi[k] = li; return r;
}
const toIdx = (x, z) => { const i = Math.max(0, Math.min(n - 1, Math.round((x + ws) / cell))); const j = Math.max(0, Math.min(n - 1, Math.round((z + ws) / cell))); return j * n + i; };
function nearestOpen(k) {
  if (P[k] >= 0) return k;
  const j0 = (k / n) | 0, i0 = k % n;
  for (let r = 1; r < 40; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const j = j0 + dj, i = i0 + di; if (j < 0 || i < 0 || j >= n || i >= n) continue; const q = j * n + i; if (P[q] >= 0) return q;
  }
  return k;
}
let run = 0;
const out = [];
for (const [x0, z0, x1, z1] of job.routes) {
  run++;
  const s = nearestOpen(toIdx(x0, z0)), t = nearestOpen(toIdx(x1, z1));
  const tj = (t / n) | 0, ti = t % n;
  hn = 0; stamp[s] = run; g[s] = 0; from[s] = -1; push(0, s);
  let found = false, it = 0;
  while (hn > 0) {
    const k = pop(); if (closed[k] === run) continue; closed[k] = run; it++;
    if (k === t) { found = true; break; }
    const j = (k / n) | 0, i = k % n, hk = H[k];
    for (const [dj, di, len] of NB) {
      const jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj >= n || ii >= n) continue;
      const q = jj * n + ii; if (closed[q] === run) continue;
      const pen = P[q]; if (pen < 0) continue;
      const gr = Math.abs(H[q] - hk) / len; if (gr > maxG) continue;
      // knight/diagonal moves must not jump over a blocked or steep middle cell
      if (Math.abs(dj) + Math.abs(di) > 1) { const mj = j + Math.round(dj / 2), mi = i + Math.round(di / 2); const m = mj * n + mi; if (P[m] < 0 || Math.abs(H[m] - hk) / (len / 2) > maxG * 1.3) continue; }
      const c = len * (ROAD[q] ? share : 1 + pen) * (1 + gW * gr * gr);
      const ng = g[k] + c;
      if (stamp[q] !== run || ng < g[q]) {
        stamp[q] = run; g[q] = ng; from[q] = k;
        const h = Math.hypot(jj - tj, ii - ti) * cell * share;
        push(ng + h, q);
      }
    }
  }
  if (!found) { out.push(null); process.stderr.write(`route ${run}: no path (${x0},${z0})->(${x1},${z1}) after ${it}\n`); continue; }
  const path = []; let k = t;
  while (k >= 0) { path.push([-ws + (k % n) * cell, -ws + ((k / n) | 0) * cell]); const kj = (k / n) | 0, ki = k % n; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const jj = kj + a, ii = ki + b; if (jj >= 0 && ii >= 0 && jj < n && ii < n) ROAD[jj * n + ii] = 1; } k = from[k]; }
  path.reverse(); out.push(path);
  process.stderr.write(`route ${run}: ${path.length} cells, ${it} expanded\n`);
}
process.stdout.write(JSON.stringify(out));
