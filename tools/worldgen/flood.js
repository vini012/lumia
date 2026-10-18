// Walkability flood fill for the generator's checks (dev-only). Usage: node flood.js <job.json>
// job = {n, cell, hFile (f32), blockFile (u8: 1 = blocked), maxGrade, starts: [idx...], outFile (u8 reach)}
'use strict';
const fs = require('fs');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const n = job.n, cell = job.cell;
const H = new Float32Array(fs.readFileSync(job.hFile).buffer.slice(0));
const B = new Uint8Array(fs.readFileSync(job.blockFile));
const out = new Uint8Array(n * n);
const q = new Int32Array(n * n);
let qh = 0, qt = 0;
for (const s of job.starts) if (!B[s]) { out[s] = 1; q[qt++] = s; }
const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
const mg = job.maxGrade;
while (qh < qt) {
  const k = q[qh++], j = (k / n) | 0, i = k % n, h = H[k];
  for (const [dj, di, l] of D) {
    const jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj >= n || ii >= n) continue;
    const m = jj * n + ii; if (out[m] || B[m]) continue;
    if (Math.abs(H[m] - h) > mg * l * cell) continue;
    out[m] = 1; q[qt++] = m;
  }
}
fs.writeFileSync(job.outFile, out);
process.stdout.write(String(qt));
