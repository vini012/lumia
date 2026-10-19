/* Lumiar v5 terrain: the 16 km world baked by tools/worldgen (m/world5.*). Height (macro raster + fine roads,
   rivers, pads, detail), regions, POIs, water bodies, waterfalls, cached physics tiles, quadtree LOD meshes, map. */
'use strict';
(function (L) {
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const hasTHREE = typeof THREE !== 'undefined';
  const lin = h => { const c = parseInt(String(h).replace('#', ''), 16); const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return [f(c >> 16 & 255), f(c >> 8 & 255), f(c & 255)]; };

  // ---------------------------------------------------------------- noise toolkit (kept from v4, new seed)
  const SEED = 20261105;
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash2(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + SEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function hash3(i, j, k) { let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k + 7, 83492791) ^ SEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vnoise(x, y) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
  function fbm(x, y, o) { let s = 0, a = .5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * vnoise(x * f + k * 17.3, y * f + k * 9.1); n += a; a *= .5; f *= 2.03; } return s / n; }
  L.fbm = fbm; L.vnoise = vnoise; L.mulberry32 = mulberry32; L.hash2 = hash2; L.hash3 = hash3;

  // ---------------------------------------------------------------- constants of the contract
  const WS = 8000; L.WS = WS; L.OOB = 7700;
  L.CLOUD_Y = 90;
  L.TERRAIN_FAR = L.TERRAIN_FAR || 6000;
  L.TS = 64;
  const W = L.world = { ready: false };            // raw parsed data (debug / tools)
  let N = 0, N2 = 0, CELL = 1, CELL2 = 1, HM = null, RG = null, LK = null, FO = null, ME = null, WE = null, CL = null;
  let PAL = [], LAKES = [], RIVERS = [], ROADS = [], PADS = [];
  L.REGIONS = []; L.POIS = []; L.LAKES = LAKES; L.RIVERS5 = RIVERS; L.ROADS = ROADS; L.FALLS5 = [];
  L.MIST = { x: 6000, z: -6000, r: 1250 };
  // provisional spawn until world5.json is parsed (v4 modules read L.SPAWN at script load); the arrays/objects are
  // updated in place on parse so early references stay valid
  L.SPAWN = [-1097, 5092]; L.SPAWN5 = { x: -1097, z: 5092, y: 227, ry: 2.6 };
  const POIMAP = new Map();
  const NOREY = { bridge: 1, rope_bridge: 1, chest_underwater: 1 };
  L.poi = id => POIMAP.get(id) || null;

  // ---------------------------------------------------------------- data loading
  function b64ToBuf(s) {
    if (typeof atob === 'function') { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
    const b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  }
  let loadP = null;
  L.worldLoad = function (base) {
    if (loadP) return loadP;
    base = base || (L.WORLD_BASE || 'm/');
    const getJ = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
    const getBin = () => fetch(base + 'world5.bin').then(r => { if (!r.ok) throw new Error('bin ' + r.status); return r.arrayBuffer(); })
      .then(b => { if (b.byteLength < 16 || new Uint8Array(b, 0, 4)[0] !== 76) throw new Error('bad bin'); return b; })
      .catch(() => getJ(base + 'world5.b64.json').then(j => b64ToBuf(j.b64)));
    loadP = Promise.all([getJ(base + 'world5.json'), getBin()]).then(([meta, buf]) => { L.worldParse(meta, buf); mapBase = base; if (!L.MAP_LAZY) loadMap(base); return W; });
    return loadP;
  };

  L.worldParse = function (meta, buf) {
    const t0 = now();
    const R = meta.raster; N = R.n; N2 = R.n2; CELL = R.cell; CELL2 = R.cell2;
    const sec = {}; for (const s of R.sections) sec[s.name] = s;
    const hs = sec.height; const u16 = new Uint16Array(buf, hs.offset, N * N);
    HM = new Float32Array(N * N); for (let k = 0; k < N * N; k++) HM[k] = u16[k] * R.hScale + R.hOff;
    const u8 = name => sec[name] ? new Uint8Array(buf, sec[name].offset, N2 * N2) : new Uint8Array(N2 * N2);
    RG = u8('region'); LK = u8('lake'); FO = u8('forest'); ME = u8('meadow'); WE = u8('wet'); CL = u8('cloud');
    W.meta = meta; W.HM = HM; W.N = N; W.N2 = N2;
    L.CLOUD_Y = meta.cloudY || 90; if (L.cloudSea && L.cloudSea.setY) L.cloudSea.setY(L.CLOUD_Y);
    if (meta.mist) Object.assign(L.MIST, meta.mist);
    L.REGIONS.length = 0; for (const r of meta.regions) L.REGIONS.push({ id: r.id, nome: r.nome, x: r.x, z: r.z, hidden: !!r.hidden });
    PAL = meta.palette.map(p => ({ grass: lin(p.grass), alt: lin(p.alt), forest: lin(p.forest), rock: lin(p.rock) }));
    W.sand = lin(meta.sand || '#e6d9a6'); W.dirt = lin(meta.dirt || '#d9c27a'); W.snow = lin(meta.snow || '#f2f4f7');
    LAKES.length = 0; for (const l of meta.lakes) LAKES.push(l);
    L.POIS.length = 0; POIMAP.clear();
    for (const p of meta.pois) { L.POIS.push(p); POIMAP.set(p.id, p); }
    L.MAPLABELS = (meta.labels || []).slice();
    const sp = meta.spawn || { x: 0, z: 0, y: 100, ry: 0 }; Object.assign(L.SPAWN5, sp); L.SPAWN[0] = sp.x; L.SPAWN[1] = sp.z;
    buildFeatures(meta);
    buildGate();
    buildMinMax();
    // POI heights from the final ground (after rivers, roads, pads): what the game stands on. Decks and the
    // underwater chest keep their own height.
    for (const p of L.POIS) if (!NOREY[p.kind]) p.y = Math.round(rawH(p.x, p.z) * 100) / 100;
    { const s5 = POIMAP.get('spawn'); if (s5) L.SPAWN5.y = s5.y; }
    W.ready = true; L.worldReady = true;
    W.parseMs = now() - t0;
    shims();
    return W;
  };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ---------------------------------------------------------------- fine features: roads, rivers, pads (grid index)
  // segments are stored pre-digested for a fast point-segment distance: stride 10 =
  // [ax, az, dx, dz, 1/len², ya, yb-ya, wa, wb-wa, len]   (roads: y = road surface, w = width; rivers: y = water surface)
  // pads: [x, z, r, y, (r+fade)², fade]
  // slots: narrow clefts cut through the ground (rope-bridge gap): [x, z, ux, uz, half length, half width, bottom y, 0]
  const IC = 64, IN = Math.ceil(2 * WS / IC);     // index cell size and count per side
  const SS = 10;
  let RS = null, RVS = null, PD = null, SLT = null, nRS = 0, nRV = 0, nPD = 0, nSL = 0;
  let IDX0 = null, IDX = null;                     // CSR: IDX0[cell]..IDX0[cell+1] items; item = type<<24 | index
  function pushSeg(arr, ax, az, bx, bz, ya, yb, wa, wb) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    arr.push(ax, az, dx, dz, l2 > 1e-6 ? 1 / l2 : 0, ya, yb - ya, wa, wb - wa, Math.sqrt(l2));
  }
  function buildFeatures(meta) {
    const rs = [], rv = [], pd = [], rvInfo = [];
    ROADS.length = 0;
    for (const rd of meta.roads || []) {
      const P = rd.pts; ROADS.push(rd);
      for (let k = 0; k < P.length - 1; k++) pushSeg(rs, P[k][0], P[k][1], P[k + 1][0], P[k + 1][1], P[k][2], P[k + 1][2], rd.w, rd.w);
    }
    RIVERS.length = 0;
    for (const r of meta.rivers || []) {
      const ri = RIVERS.length; let along = 0;
      RIVERS.push({ id: r.id, reaches: r.reaches, falls: r.falls, cloud: r.cloud });
      for (const P of r.reaches) for (let k = 0; k < P.length - 1; k++) {
        pushSeg(rv, P[k][0], P[k][1], P[k + 1][0], P[k + 1][1], P[k][2], P[k + 1][2], P[k][3], P[k + 1][3]);
        rvInfo.push(ri, along); along += Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]);
      }
    }
    for (const p of meta.pois) if (p.flat > 0) { const fade = Math.max(8, p.flat * .6); pd.push(p.x, p.z, p.flat, p.y, (p.flat + fade) * (p.flat + fade), fade); }
    for (const q of meta.pads || []) { const fade = Math.max(3, q[2] * .8); pd.push(q[0], q[1], q[2], q[3], (q[2] + fade) * (q[2] + fade), fade); }
    const sl = []; for (const q of meta.slots || []) sl.push(q.x, q.z, q.ux, q.uz, q.hl, q.hw, q.y, 0);
    RS = new Float64Array(rs); RVS = new Float64Array(rv); PD = new Float64Array(pd); SLT = new Float64Array(sl); W.rvInfo = new Float32Array(rvInfo);
    nRS = rs.length / SS; nRV = rv.length / SS; nPD = pd.length / 6; nSL = sl.length / 8;
    // bucket into cells
    const cnt = new Int32Array(IN * IN + 1); const lists = [];
    const add = (x0, z0, x1, z1, item) => {
      const i0 = clamp(Math.floor((x0 + WS) / IC), 0, IN - 1), i1 = clamp(Math.floor((x1 + WS) / IC), 0, IN - 1);
      const j0 = clamp(Math.floor((z0 + WS) / IC), 0, IN - 1), j1 = clamp(Math.floor((z1 + WS) / IC), 0, IN - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = j * IN + i; cnt[c]++; lists.push(c, item); }
    };
    const addSeg = (A, k, m, type) => { const o = k * SS, ax = A[o], az = A[o + 1], bx = ax + A[o + 2], bz = az + A[o + 3]; add(Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m, (type << 24) | k); };
    for (let k = 0; k < nRS; k++) addSeg(RS, k, RS[k * SS + 7] / 2 + 11, 1);
    for (let k = 0; k < nRV; k++) { const o = k * SS; addSeg(RVS, k, Math.max(RVS[o + 7], RVS[o + 7] + RVS[o + 8]) / 2 + 15, 2); }
    for (let k = 0; k < nPD; k++) { const o = k * 6, m = PD[o + 2] + PD[o + 5] + 1; add(PD[o] - m, PD[o + 1] - m, PD[o] + m, PD[o + 1] + m, (3 << 24) | k); }
    for (let k = 0; k < nSL; k++) { const o = k * 8, m = Math.hypot(SLT[o + 4], SLT[o + 5]) + 2; add(SLT[o] - m, SLT[o + 1] - m, SLT[o] + m, SLT[o + 1] + m, (4 << 24) | k); }
    IDX0 = new Int32Array(IN * IN + 1); let acc = 0; for (let c = 0; c < IN * IN; c++) { IDX0[c] = acc; acc += cnt[c]; } IDX0[IN * IN] = acc;
    IDX = new Int32Array(acc); const fill = IDX0.slice(0, IN * IN);
    for (let k = 0; k < lists.length; k += 2) IDX[fill[lists[k]]++] = lists[k + 1];
    W.nRoadSeg = nRS; W.nRiverSeg = nRV; W.nPads = nPD; W.nSlots = nSL; W.idxItems = acc;
    L.CROSSINGS = (meta.crossings || []).slice(); L.SLOTS = (meta.slots || []).slice();
  }

  // ---------------------------------------------------------------- macro height (bicubic, clamped at cliffs)
  // GATE: per-node weight of the small procedural detail (1 on gentle ground, 0 on slopes/cliffs), bilinear
  // NYM: the macro grid's normal.y (0..255); terrain paint uses it so cliffs read as rock at every LOD
  let GATE = null, NYM = null, _gate = 0;
  function buildGate() {
    GATE = new Float32Array(N * N); NYM = new Uint8Array(N * N).fill(255);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const o = j * N + i, gx = HM[o + 1] - HM[o - 1], gz = HM[o + N] - HM[o - N];
      const s = Math.sqrt(gx * gx + gz * gz) / (2 * CELL); GATE[o] = 1 - sstep(.12, .45, s);
      // steepest of the centred and the two one-sided differences, so a one-cell wall is not halved
      const sx = Math.max(Math.abs(HM[o + 1] - HM[o]), Math.abs(HM[o] - HM[o - 1])), sz = Math.max(Math.abs(HM[o + N] - HM[o]), Math.abs(HM[o] - HM[o - N]));
      const s2 = Math.max(s, Math.sqrt(sx * sx + sz * sz) / CELL);
      NYM[o] = Math.round(255 / Math.sqrt(1 + s2 * s2));
    }
  }
  function nyMacro(x, z) {
    let u = (x + WS) / CELL, v = (z + WS) / CELL; u = clamp(u, 0, N - 1.001); v = clamp(v, 0, N - 1.001);
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = j * N + i;
    return ((NYM[o] * (1 - fu) + NYM[o + 1] * fu) * (1 - fv) + (NYM[o + N] * (1 - fu) + NYM[o + N + 1] * fu) * fv) / 255;
  }
  function macro(x, z) {
    let u = (x + WS) / CELL, v = (z + WS) / CELL;
    if (u < 1) u = 1; else if (u > N - 2.001) u = N - 2.001;
    if (v < 1) v = 1; else if (v > N - 2.001) v = N - 2.001;
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j;
    const o = j * N + i;
    // Catmull-Rom weights
    const fu2 = fu * fu, fu3 = fu2 * fu, fv2 = fv * fv, fv3 = fv2 * fv;
    const a0 = -.5 * fu3 + fu2 - .5 * fu, a1 = 1.5 * fu3 - 2.5 * fu2 + 1, a2 = -1.5 * fu3 + 2 * fu2 + .5 * fu, a3 = .5 * fu3 - .5 * fu2;
    const b0 = -.5 * fv3 + fv2 - .5 * fv, b1 = 1.5 * fv3 - 2.5 * fv2 + 1, b2 = -1.5 * fv3 + 2 * fv2 + .5 * fv, b3 = .5 * fv3 - .5 * fv2;
    const r0 = o - N - 1, r1 = o - 1, r2 = o + N - 1, r3 = o + 2 * N - 1;
    const h11 = HM[r1 + 1], h21 = HM[r1 + 2], h12 = HM[r2 + 1], h22 = HM[r2 + 2];
    const c0 = a0 * HM[r0] + a1 * HM[r0 + 1] + a2 * HM[r0 + 2] + a3 * HM[r0 + 3];
    const c1 = a0 * HM[r1] + a1 * h11 + a2 * h21 + a3 * HM[r1 + 3];
    const c2 = a0 * HM[r2] + a1 * h12 + a2 * h22 + a3 * HM[r2 + 3];
    const c3 = a0 * HM[r3] + a1 * HM[r3 + 1] + a2 * HM[r3 + 2] + a3 * HM[r3 + 3];
    let h = b0 * c0 + b1 * c1 + b2 * c2 + b3 * c3;
    _gate = (GATE[o] * (1 - fu) + GATE[o + 1] * fu) * (1 - fv) + (GATE[o + N] * (1 - fu) + GATE[o + N + 1] * fu) * fv;
    // no overshoot: stay inside the 4 central samples (keeps cliff tops crisp, no lips or moats)
    let mn = h11, mx = h11;
    if (h21 < mn) mn = h21; else if (h21 > mx) mx = h21;
    if (h12 < mn) mn = h12; else if (h12 > mx) mx = h12;
    if (h22 < mn) mn = h22; else if (h22 > mx) mx = h22;
    return h < mn ? mn : h > mx ? mx : h;
  }
  function macroLin(x, z) {
    let u = (x + WS) / CELL, v = (z + WS) / CELL;
    u = clamp(u, 0, N - 1.001); v = clamp(v, 0, N - 1.001);
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = j * N + i;
    return (HM[o] * (1 - fu) + HM[o + 1] * fu) * (1 - fv) + (HM[o + N] * (1 - fu) + HM[o + N + 1] * fu) * fv;
  }

  // ---------------------------------------------------------------- full height
  // info (optional): receives path weight, river distance etc. for painting
  const NOINFO = {}; const PH = new Int32Array(4);
  function hgt(x, z, info) {
    let h = macro(x, z);
    const fl = _gate;
    // small rolling detail where the macro ground is gentle
    if (fl > .001) h += ((vnoise(x * .055 + 17.1, z * .055 - 3.3) - .5) * 1.5 + (vnoise(x * .17 - 5.2, z * .17 + 9.4) - .5) * .45) * fl;
    let path = 0, rd = 1e9, rw = 0, rs = -Infinity, pad = 0, bd2 = 1e18, bw = 0;
    if (x > -WS && x < WS && z > -WS && z < WS) {
      const c = ((((z + WS) / IC) | 0) * IN + (((x + WS) / IC) | 0));
      const e = IDX0[c + 1];
      let by = 0, rd2 = 1e18, rk = -1, rt = 0, np = 0, slo = -1;
      for (let k = IDX0[c]; k < e; k++) {
        const it = IDX[k], ty = it >>> 24, q = it & 0xffffff;
        if (ty === 1) {        // road: nearest wins
          const o = q * SS, ex = x - RS[o], ez = z - RS[o + 1], dx = RS[o + 2], dz = RS[o + 3];
          let t = (ex * dx + ez * dz) * RS[o + 4]; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ex - dx * t, pz = ez - dz * t, d2 = px * px + pz * pz;
          if (d2 < bd2) { bd2 = d2; by = RS[o + 5] + RS[o + 6] * t; bw = RS[o + 7]; }
        } else if (ty === 2) { // river: nearest segment
          const o = q * SS, ex = x - RVS[o], ez = z - RVS[o + 1], dx = RVS[o + 2], dz = RVS[o + 3];
          let t = (ex * dx + ez * dz) * RVS[o + 4]; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ex - dx * t, pz = ez - dz * t, d2 = px * px + pz * pz;
          if (d2 < rd2) { rd2 = d2; rk = o; rt = t; }
        } else if (ty === 3) {   // pad
          if (np < 4) { const o = q * 6, dx = x - PD[o], dz = z - PD[o + 1]; if (dx * dx + dz * dz < PD[o + 4]) PH[np++] = o; }
        } else slo = q * 8;       // slot
      }
      if (bd2 < 1e17) {
        const hw = bw * .5, lim = hw + 10;
        if (bd2 < lim * lim) {
          const bd = Math.sqrt(bd2); const w = 1 - sstep(hw + 1, lim, bd);
          h += (by - h) * w; path = 1 - sstep(hw * .55, hw + .9, bd);
        }
      }
      // pads after roads (pads win), rivers last (water always cuts)
      for (let q = 0; q < np; q++) {
        const o = PH[q], dx = x - PD[o], dz = z - PD[o + 1], r = PD[o + 2], d = Math.sqrt(dx * dx + dz * dz);
        const w = 1 - sstep(r, r + PD[o + 5], d); h += (PD[o + 3] - h) * w; if (w > pad) pad = w;
      }
      if (rk >= 0) {
        rd = Math.sqrt(rd2); rs = RVS[rk + 5] + RVS[rk + 6] * rt; rw = RVS[rk + 7] + RVS[rk + 8] * rt;
        const hw = rw * .5;
        if (rd < hw) { const q = rd / hw; const bed = rs - (.45 + rw * .055) * (1 - q * q) - .25; if (h > bed) h = bed; }
        else if (rd < hw + 14) { const bank = rs - .25 + (rd - hw) * .55; if (h > bank) h = bank; }   // banks slope up out of the water
        // low levee so the water never spills: a smooth rise over 6 m, none across roads (fords and bridges)
        if (rd >= hw && rd < hw + 6 && h < rs + .12) h += (rs + .12 - h) * (1 - sstep(hw, hw + 6, rd)) * (1 - path);
        // ford: where a road runs below the water surface its bed stays at the road level (0.35 m deep)
        if (path > 0 && rd < hw + 2 && by < rs && h < by) h += (by - h) * path;
      }
      if (slo >= 0) {          // slot: sheer-walled cleft, ~1 m wall transition (one cell of the finest mesh)
        const dx = x - SLT[slo], dz = z - SLT[slo + 1], u = Math.abs(dx * SLT[slo + 2] + dz * SLT[slo + 3]), v = Math.abs(dz * SLT[slo + 2] - dx * SLT[slo + 3]);
        const hl = SLT[slo + 4], hw = SLT[slo + 5];
        if (u < hl && v < hw) { const w = (1 - sstep(hw - 1.1, hw, v)) * (1 - sstep(hl - 4, hl, u)); if (SLT[slo + 6] < h) h += (SLT[slo + 6] - h) * w; }
      }
    } else {                   // beyond the baked raster: open ocean
      const ex = Math.max(Math.abs(x), Math.abs(z)) - WS; if (h > -4 - ex * .3) h = -4 - ex * .3;
    }
    if (info !== NOINFO && info) { info.path = path; info.rd = rd; info.rw = rw; info.rs = rs; info.pad = pad; info.gate = fl; info.pd = bd2 < 1e17 ? Math.sqrt(bd2) - bw * .5 : 1e9; }
    return h;
  }
  const rawH = (x, z) => hgt(x, z, NOINFO);
  L.rawH = rawH; L.macroH = macro; L.macroLin = macroLin;
  L.heightInfo = (x, z, out) => { out = out || {}; out.h = hgt(x, z, out); return out; };

  // ---------------------------------------------------------------- min/max pyramid of the macro grid (LOD metric)
  // level q holds blocks of 2^q macro cells (q = 0..10); used to bound terrain nodes before they are built
  let MM = null;
  function buildMinMax() {
    MM = []; let n = N - 1; // cells per side (1024)
    let mn = new Float32Array(n * n), mx = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const o = j * N + i; const a = HM[o], b = HM[o + 1], c = HM[o + N], d = HM[o + N + 1];
      mn[j * n + i] = Math.min(a, b, c, d); mx[j * n + i] = Math.max(a, b, c, d);
    }
    MM.push({ n, mn, mx });
    while (n > 1) {
      const m = n >> 1; const mn2 = new Float32Array(m * m), mx2 = new Float32Array(m * m);
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        const o = 2 * j * n + 2 * i;
        mn2[j * m + i] = Math.min(mn[o], mn[o + 1], mn[o + n], mn[o + n + 1]); mx2[j * m + i] = Math.max(mx[o], mx[o + 1], mx[o + n], mx[o + n + 1]);
      }
      MM.push({ n: m, mn: mn2, mx: mx2 }); mn = mn2; mx = mx2; n = m;
    }
  }
  // height range [min, max] over a world-space square (approximate, conservative)
  function rangeOf(x0, z0, size, out) {
    const cells = size / CELL; let q = Math.max(0, Math.floor(Math.log2(Math.max(1, cells))) - 1); if (q >= MM.length) q = MM.length - 1;
    const P = MM[q], bs = CELL * (1 << q);
    const i0 = clamp(Math.floor((x0 + WS) / bs), 0, P.n - 1), i1 = clamp(Math.floor((x0 + size + WS) / bs), 0, P.n - 1);
    const j0 = clamp(Math.floor((z0 + WS) / bs), 0, P.n - 1), j1 = clamp(Math.floor((z0 + size + WS) / bs), 0, P.n - 1);
    let mn = 1e9, mx = -1e9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * P.n + i; if (P.mn[k] < mn) mn = P.mn[k]; if (P.mx[k] > mx) mx = P.mx[k]; }
    if (x0 + size < -WS || x0 > WS || z0 + size < -WS || z0 > WS) { mn = -40; mx = 0; }
    out[0] = mn - 3; out[1] = mx + 3; return out;
  }

  // ---------------------------------------------------------------- coarse rasters
  function c2(A, x, z) { // bilinear 0..1 of a u8 raster (n2)
    let u = (x + WS) / CELL2, v = (z + WS) / CELL2; u = clamp(u, 0, N2 - 1.001); v = clamp(v, 0, N2 - 1.001);
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = j * N2 + i;
    return ((A[o] * (1 - fu) + A[o + 1] * fu) * (1 - fv) + (A[o + N2] * (1 - fu) + A[o + N2 + 1] * fu) * fv) / 255;
  }
  function cn(A, x, z) { const i = clamp(Math.round((x + WS) / CELL2), 0, N2 - 1), j = clamp(Math.round((z + WS) / CELL2), 0, N2 - 1); return A[j * N2 + i]; }
  L.region = (x, z) => HM ? cn(RG, x, z) : 0;
  // inside the cloud sea: a cloud-covered spot whose ground lies below the deck (fall-in / fog checks)
  L.cloudSeaAt = (x, z) => HM ? (c2(CL, x, z) > .35 && rawH(x, z) < L.CLOUD_Y) : false;
  L.cloudCover = (x, z) => HM ? c2(CL, x, z) : 1;
  L.forestAt = (x, z) => HM ? c2(FO, x, z) : 0;
  L.meadowAt = (x, z) => HM ? c2(ME, x, z) : 0;
  L.wetAt = (x, z) => HM ? c2(WE, x, z) : 0;
  function lakeAt(x, z) { const id = cn(LK, x, z); return id ? LAKES[id - 1] : null; }
  L.lakeAt = lakeAt;

  // ---------------------------------------------------------------- water queries
  const _wi = {};
  L.waterAt = function (x, z) {
    if (!HM) return -Infinity;
    const h = hgt(x, z, _wi);
    if (_wi.rs > -Infinity && _wi.rd < _wi.rw * .5 + .6 && h < _wi.rs) return _wi.rs;
    const lk = lakeAt(x, z); if (lk && h < lk.level) return lk.level;
    if (h < 0) return 0;
    return -Infinity;
  };
  L.riverAt = function (x, z, out) { hgt(x, z, _wi); out = out || {}; out.d = _wi.rd; out.w = _wi.rw; out.s = _wi.rs; return out; };

  // ---------------------------------------------------------------- painting (ground tint + layer weights)
  const PSI = {};
  const _pc = [0, 0, 0];
  function regionTint(x, z, out) {   // blend of the 4 nearest region palettes; returns dominant region
    let u = (x + WS) / CELL2, v = (z + WS) / CELL2; u = clamp(u, 0, N2 - 1.001); v = clamp(v, 0, N2 - 1.001);
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = j * N2 + i;
    const ids = [RG[o], RG[o + 1], RG[o + N2], RG[o + N2 + 1]], ws = [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv];
    const n1 = fbm(x * .0026 + 3.7, z * .0026 - 8.1, 2), alt = sstep(.42, .66, n1);
    let r = 0, g = 0, b = 0, fr = 0, fg = 0, fb = 0, kr = 0, kg = 0, kb = 0, best = ids[0], bw = -1;
    for (let k = 0; k < 4; k++) {
      const P = PAL[ids[k]] || PAL[0], w = ws[k]; if (w > bw) { bw = w; best = ids[k]; }
      r += (P.grass[0] + (P.alt[0] - P.grass[0]) * alt) * w; g += (P.grass[1] + (P.alt[1] - P.grass[1]) * alt) * w; b += (P.grass[2] + (P.alt[2] - P.grass[2]) * alt) * w;
      fr += P.forest[0] * w; fg += P.forest[1] * w; fb += P.forest[2] * w; kr += P.rock[0] * w; kg += P.rock[1] * w; kb += P.rock[2] * w;
    }
    out.gr = r; out.gg = g; out.gb = b; out.fr = fr; out.fg = fg; out.fb = fb; out.kr = kr; out.kg = kg; out.kb = kb; return best;
  }
  const _rt = {};
  // out: {c:[r,g,b], rock, path, sand, snow, forest, wet, meadow, region}
  function paint(x, z, h, ny, info, out) {
    const reg = regionTint(x, z, _rt);
    const n2 = vnoise(x * .021 + 4.4, z * .021 - 1.9);
    const forest0 = c2(FO, x, z), meadow = c2(ME, x, z), wet0 = c2(WE, x, z);
    // layers
    // rock only on sheer faces (> ~65 deg), with a noisy edge; ramps and steep meadows stay grass
    const rock = clamp(sstep(.48, .36, ny + (n2 - .5) * .1) + sstep(860, 990, h) * sstep(.95, .75, ny) * .6, 0, 1);
    const lk = lakeAt(x, z);
    let sand = sstep(4.2, 1.2, h + (n2 - .5) * 1.5) * (h > -6 ? 1 : 0) * sstep(.7, .9, ny);
    if (lk && !lk.hot) sand = Math.max(sand, sstep(1.4, .3, Math.abs(h - lk.level - .4)) * .55 * sstep(.75, .92, ny));
    if (reg === 2) sand = Math.max(sand, sstep(14, 4, h) * sstep(.8, .95, ny));     // R3 has wide beaches
    const snow = reg === 12 ? sstep(880, 960, h + (n2 - .5) * 60) * sstep(.55, .85, ny) : 0;
    const path = info.path * (1 - rock * .6);
    const riverWet = info.rd < info.rw * .5 + 10 ? sstep(info.rw * .5 + 10, info.rw * .5, info.rd) : 0;
    const forest = forest0 * (1 - rock) * (1 - path) * (1 - sand);
    const wet = clamp(wet0 * .7 + riverWet * .6, 0, 1) * (1 - rock * .7);
    // tint: meadow by region, darker/greener under forest, rock tone on cliffs, warm dirt on roads
    let r = _rt.gr, g = _rt.gg, b = _rt.gb;
    const fw = forest * .55; r += (_rt.fr - r) * fw; g += (_rt.fg - g) * fw; b += (_rt.fb - b) * fw;
    const mw = meadow * .12; r *= 1 + mw * .6; g *= 1 + mw; b *= 1 - mw * .2;
    const wv = wet * .25; r *= 1 - wv; g *= 1 - wv * .6; b *= 1 - wv * .5;
    r += (_rt.kr - r) * rock; g += (_rt.kg - g) * rock; b += (_rt.kb - b) * rock;
    const sd = W.sand; r += (sd[0] - r) * sand; g += (sd[1] - g) * sand; b += (sd[2] - b) * sand;
    const sn = W.snow; r += (sn[0] - r) * snow; g += (sn[1] - g) * snow; b += (sn[2] - b) * snow;
    const vv = .96 + n2 * .08; r *= vv; g *= vv; b *= vv;
    const c = out.c || (out.c = [0, 0, 0]); c[0] = r; c[1] = g; c[2] = b;
    out.rock = rock; out.path = path; out.sand = sand; out.snow = snow; out.forest = forest; out.wet = wet; out.meadow = meadow * (1 - forest) * (1 - rock); out.region = reg;
    return out;
  }
  L.paint5 = paint;

  // ---------------------------------------------------------------- physics height tiles (2 m grid, 64 m tiles; = finest mesh)
  const TS = 64, TN = 32, TC = TS / TN, TW = TN + 1;
  const tiles = new Map(); let tileFrame = 0; L.tiles = tiles; L.tilesBuilt = 0;
  const tkey = (i, j) => (i + 512) * 2048 + (j + 512);
  function getTile(i, j) {
    const k = tkey(i, j); let t = tiles.get(k);
    if (!t) {
      t = new Float32Array(TW * TW); const x0 = i * TS, z0 = j * TS;
      for (let b = 0; b < TW; b++) for (let a = 0; a < TW; a++) t[b * TW + a] = rawH(x0 + a * TC, z0 + b * TC);
      tiles.set(k, t); L.tilesBuilt++;
    } else if (tiles.size > 64) { tiles.delete(k); tiles.set(k, t); }   // LRU: re-insert as most recent
    t.used = tileFrame; return t;
  }
  L.getTile = getTile;
  function ground(x, z) {
    if (!HM) return 0;
    const i = Math.floor(x / TS), j = Math.floor(z / TS); const t = getTile(i, j);
    const u = (x - i * TS) / TC, v = (z - j * TS) / TC; const a0 = Math.min(Math.floor(u), TN - 1), b0 = Math.min(Math.floor(v), TN - 1); const fu = u - a0, fv = v - b0;
    const A = t[b0 * TW + a0], B = t[b0 * TW + a0 + 1], Cc = t[(b0 + 1) * TW + a0], D = t[(b0 + 1) * TW + a0 + 1];
    return fu + fv <= 1 ? A + (B - A) * fu + (Cc - A) * fv : D + (Cc - D) * (1 - fu) + (B - D) * (1 - fv);
  }
  function slope(x, z) { const e = 1.2; return Math.hypot(ground(x + e, z) - ground(x - e, z), ground(x, z + e) - ground(x, z - e)) / (2 * e); }
  L.ground = ground; L.slope = slope;
  L.groundN = function (x, z, out) { const e = 1.0; const hx = ground(x + e, z) - ground(x - e, z), hz = ground(x, z + e) - ground(x, z - e); out = out || (hasTHREE ? new THREE.Vector3() : { set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, normalize() { const l = Math.hypot(this.x, this.y, this.z); this.x /= l; this.y /= l; this.z /= l; return this; } }); out.set(-hx, 2 * e, -hz).normalize(); return out; };
  L.TILE_CAP = 900;
  L.trimTiles = function (px, pz) {   // LRU: Map keeps insertion order; oldest first
    tileFrame++; const cap = L.TILE_CAP; if (tiles.size <= cap) return;
    let drop = tiles.size - Math.floor(cap * .8);
    for (const [k] of tiles) { if (drop-- <= 0) break; tiles.delete(k); }
  };
  L.terrainSample = function (x, z, out) {
    out = out || {};
    const h = ground(x, z), sl = slope(x, z); hgt(x, z, PSI);
    paint(x, z, h, 1 / Math.sqrt(1 + sl * sl), PSI, out);
    out.h = h; out.sl = sl;
    // v4 shape for older callers (grass.js): w = [grass, forest, rock, sand, snow], B = biome weights
    const w = out.w || (out.w = [0, 0, 0, 0, 0]); w[1] = out.forest; w[2] = out.rock; w[3] = out.sand; w[4] = out.snow; w[0] = Math.max(0, 1 - w[1] - w[2] - w[3] - w[4] - out.path);
    out.B = biome(x, z, out.B || {}); out.fd = out.forest;
    return out;
  };
  L.findLand = function (x, z, minH, maxH, maxSlope) {
    minH = minH == null ? L.CLOUD_Y + 4 : minH; maxH = maxH == null ? 2000 : maxH; maxSlope = maxSlope || .5;
    for (let r = 0; r < 240; r += 3) for (let a = 0; a < 6.28; a += r < 20 ? .9 : .45) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (Math.abs(px) > L.OOB || Math.abs(pz) > L.OOB) continue;
      const h = rawH(px, pz); if (h <= minH || h >= maxH) continue;
      if (L.waterAt(px, pz) > h) continue;
      const sl = Math.hypot(rawH(px + 1.5, pz) - h, rawH(px, pz + 1.5) - h) / 1.5; if (sl < maxSlope) return [px, pz];
    }
    return [x, z];
  };
  L.inMist = (x, z) => { const M = L.MIST; const d = Math.hypot(x - M.x, z - M.z); return sstep(0, 260, M.r - d); };
  L.oobPush = (x, z) => { const o = L.OOB; return [Math.abs(x) > o ? Math.sign(x) * (Math.abs(x) - o) : 0, Math.abs(z) > o ? Math.sign(z) * (Math.abs(z) - o) : 0]; };

  // ---------------------------------------------------------------- v4 compatibility shims
  const V4KEYS = ['vale', 'lago', 'antiga', 'pinho', 'montes', 'dragao', 'penhas', 'canion', 'planicie', 'pantano', 'costa'];
  const MAP4 = [ // region index -> v4 biome weights (creature tables etc.)
    { vale: 1 }, { planicie: .6, vale: .4 }, { costa: 1 }, { lago: .7, pantano: .3 }, { penhas: 1 }, { antiga: 1 }, { vale: .6, montes: .4 },
    { pinho: 1 }, { penhas: .6, montes: .4 }, { penhas: .5, montes: .5 }, { antiga: .7, pinho: .3 }, { canion: .7, dragao: .3 },
    { montes: 1 }, { planicie: 1 }, { montes: .5, vale: .5 }, { antiga: 1 }];
  function biome(x, z, out) {
    out = out || {}; for (const k of V4KEYS) out[k] = 0;
    const r = HM ? cn(RG, x, z) : 0; const m = MAP4[r] || MAP4[0]; let best = 'vale', bv = -1;
    for (const k in m) { out[k] = m[k]; if (m[k] > bv) { bv = m[k]; best = k; } }
    out.main = best; out.region = r; return out;
  }
  L.biome = biome;
  L.forestDensity = (x, z) => HM ? c2(FO, x, z) : 0;
  const _rq = { d: 1e9, t: 0, along: 0, w: 0, rv: null };
  L.riverQuery = function (x, z) {
    _rq.d = 1e9; _rq.rv = null; if (!HM) return _rq;
    hgt(x, z, _wi);
    if (_wi.rd < 1e8 && _wi.rs > -Infinity) { _rq.d = _wi.rd; _rq.w = _wi.rw * .5; _rq.rv = true; _rq.t = 0; _rq.along = 0; }
    return _rq;
  };
  L.distRiver = (x, z) => { const q = L.riverQuery(x, z); return q.rv ? Math.max(0, q.d - q.w) : 999; };
  L.poiClear = function (x, z) {
    if (!HM || x <= -WS || x >= WS || z <= -WS || z >= WS) return false;
    const c = ((((z + WS) / IC) | 0) * IN + (((x + WS) / IC) | 0));
    for (let k = IDX0[c]; k < IDX0[c + 1]; k++) { const it = IDX[k]; if ((it >>> 24) !== 3) continue; const o = (it & 0xffffff) * 6; const dx = x - PD[o], dz = z - PD[o + 1], r = PD[o + 2] + 4; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  };
  // POIs shown by the v4 map/discovery code (no hidden-region entries)
  const V4POI = { vila_ventura: ['Vila Ventura', '🏘️'], cottage: ['Casinha em ruínas', '🏚️'], windmills: ['Moinhos', '🌾'], windmill_broken: ['Moinho velho', '🌾'], lighthouse: ['Farol em ruínas', '🗼'],
    turtle_shrine: ['Santuário do lago', '🐢'], falls_three: ['Cachoeira dos três degraus', '💧'], totems_ring: ['Círculo de totens', '🗿'], high_plaza: ['Cidade Alta', '🏰'], hunter_cabin: ['Cabana do caçador', '🛖'],
    griffin_nest: ['Ninho no alto', '🪺'], hermit_tower_canyon: ['Torre do eremita', '🗼'], lunar_garden: ['Jardim em ruínas', '🌙'], hot_spring: ['Fontes termais', '♨️'], summit_camp: ['Acampamento do cume', '⛺'],
    steppe_post: ['Posto da estepe', '🐎'], totem_ancestral: ['Totem antigo', '🗿'] };
  function shims() {
    L.REG = {}; L.RKEYS = [];
    L.REGIONS.forEach((r, i) => { if (r.hidden) return; L.REG[r.id] = { nome: r.nome, x: r.x, z: r.z, r: 1600, i }; L.RKEYS.push(r.id); });
    L.POI = [{ id: 'spawn', nome: 'Acampamento', ic: '🏕️', x: L.SPAWN[0], z: L.SPAWN[1], clear: 10, always: true }];
    for (const p of L.POIS) {
      if (V4POI[p.id]) L.POI.push({ id: p.id, nome: V4POI[p.id][0], ic: V4POI[p.id][1], x: p.x, z: p.z, clear: p.flat || 0 });
      else if (p.kind === 'travel_totem') L.POI.push({ id: p.id, nome: 'Totem de viagem', ic: '🪵', x: p.x, z: p.z, clear: p.flat || 0 });
    }
    // v4 falls: base point (bx,bz) where the water lands
    const F = L.FALLS5; F.length = 0;
    for (const f of (W.meta.falls || [])) {
      const g = fallGeom(f); F.push(Object.assign({}, f, g));
    }
    L.FALLS = F.map(f => ({ rv: f.river, x: f.x, z: f.z, h: f.top, bx: f.bx, bz: f.bz, dx: f.dx, dz: f.dz, w: f.w, top: f.top, bottom: f.bottom }));
  }

  // ---------------------------------------------------------------- waterfalls: trajectory clear of the cliff face
  function fallGeom(f) {
    // march outward from the lip: the face position at each height; the sheet stays a little in front of it
    const pts = []; const H0 = f.top, cloudEnd = f.bottom < L.CLOUD_Y; const H1 = cloudEnd ? Math.min(f.bottom, L.CLOUD_Y - 30) : f.bottom;
    const drop = Math.max(1, H0 - H1); const nS = clamp(Math.round(drop / 6), 6, 48);
    const prof = []; for (let s = 0; s <= 400; s += 2) prof.push(macroLin(f.x + f.dx * s, f.z + f.dz * s));
    const faceAt = y => { for (let k = 0; k < prof.length; k++) if (prof[k] < y) return k * 2; return 400; };
    const v0 = clamp(f.w * .25, 1.5, 4);
    let bx = f.x, bz = f.z;
    for (let k = 0; k <= nS; k++) {
      const t = k / nS, y = H0 - drop * t;
      const ballistic = v0 * Math.sqrt(2 * (H0 - y) / 9.8);
      const s = Math.max(ballistic, faceAt(y - 2) + 1.5) + 1;
      const x = f.x + f.dx * s, z = f.z + f.dz * s; pts.push([x, y, z]); bx = x; bz = z;
    }
    return { pts, bx, bz, cloudEnd };
  }

  // ================================================================ rendering (browser only)
  if (!hasTHREE) { L.terrainInit = () => { }; L.terrainUpdate = () => true; L.terrainMeshes = () => []; return; }

  // ---------------------------------------------------------------- interim materials (LOOK's L.makeTerrainMaterial etc. win)
  function interimTerrainMat() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute vec4 aT; attribute vec2 aU; varying vec4 vT; varying vec2 vU; varying vec3 vWp; varying vec3 vWn;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vT = aT; vU = aU; vWp = (modelMatrix * vec4(position, 1.)).xyz; vWn = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = 'varying vec4 vT; varying vec2 vU; varying vec3 vWp; varying vec3 vWn;\nfloat hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y);}\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 g = diffuseColor.rgb;
          float n1 = vn(vWp.xz / 9.), n2 = vn(vWp.xz / 2.3), n3 = vn(vWp.xz / 60.);
          g *= .9 + n1 * .14 + n2 * .06 + (n3 - .5) * .1;
          g = mix(g, g * vec3(.55, .68, .5), clamp(vU.x, 0., 1.) * .55);
          float pth = smoothstep(.3, .6, vT.y + (n1 - .5) * .35);
          g = mix(g, mix(vec3(.62, .48, .24), vec3(.78, .66, .36), n2), pth);
          float rk = smoothstep(.25, .6, vT.x + (n1 - .5) * .25);
          vec3 wn = normalize(vWn);
          float band = sin(vWp.y * .16 + vn(vec2(vWp.x + vWp.z, vWp.y) / 40.) * 3.) * .5 + .5;
          float fine = vn(vec2((vWp.x + vWp.z) * .25, vWp.y * 1.3));
          vec3 rc = diffuseColor.rgb * (.82 + band * .3) * (.9 + fine * .2);
          rc = mix(rc, rc * vec3(.86, .9, 1.05), smoothstep(.6, 1., band));
          rc += smoothstep(.7, .95, wn.y) * .05;
          g = mix(g, rc, rk);
          g = mix(g, vec3(.86, .8, .6), smoothstep(.35, .7, vT.z) * .3);
          g = mix(g, vec3(.95, .97, 1.), smoothstep(.4, .7, vT.w));
          diffuseColor.rgb = g;`);
    };
    mat.customProgramCacheKey = () => 'terrain-v5-interim';
    return mat;
  }
  function interimWaterMat() {
    const U = { uTime: { value: 0 }, uShallow: { value: new THREE.Color(0x63b2d4).convertSRGBToLinear() }, uDeep: { value: new THREE.Color(0x2a7fc4).convertSRGBToLinear() }, uSky: { value: new THREE.Color(0x9cc6ec).convertSRGBToLinear() }, uSun: { value: new THREE.Color(0xfff1d8).convertSRGBToLinear() }, uSunDir: { value: new THREE.Vector3(.4, .8, .3).normalize() }, uDay: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, U]),
      vertexShader: `uniform float uTime; attribute float aDepth; varying float vD; varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vD = aDepth; vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime, uDay; uniform vec3 uShallow, uDeep, uSky, uSun, uSunDir; varying float vD; varying vec3 vW;
        #include <fog_pars_fragment>
        void main(){
          float t = uTime; vec2 p = vW.xz;
          vec3 n = normalize(vec3(sin(p.x * .21 + t * 1.1) * .06 + sin(p.y * .13 - t * .7) * .05 + sin((p.x + p.y) * .51 + t * 1.7) * .03, 1., cos(p.y * .19 + t * .9) * .06 + cos((p.x - p.y) * .37 - t * 1.3) * .04));
          vec3 V = normalize(cameraPosition - vW); float fr = pow(1. - max(dot(n, V), 0.), 4.);
          float d = clamp(vD / 9., 0., 1.);
          vec3 col = mix(uShallow, uDeep, smoothstep(0., 1., d)) * mix(.25, 1., uDay);
          col = mix(col, uSky * mix(.4, 1., uDay), fr * .55);
          vec3 H = normalize(V + normalize(uSunDir)); col += uSun * pow(max(dot(n, H), 0.), 220.) * 2.5 * uDay;
          float foam = smoothstep(.5, 0., vD); col = mix(col, vec3(.95, .98, 1.) * mix(.3, 1., uDay), foam * .8);
          gl_FragColor = vec4(col, clamp(mix(.6, .96, smoothstep(0., .6, d)) + foam * .3, 0., 1.));
        #include <fog_fragment>
        #include <encodings_fragment>
        }`
    });
    return mat;
  }
  function interimFlowMat() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false, side: THREE.DoubleSide, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDay: { value: 1 }, uSky: { value: new THREE.Color(0x9cc6ec) } }]),
      vertexShader: `attribute float aSteep; varying vec2 vUv; varying float vS;
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vS = aSteep; vec4 wp = modelMatrix * vec4(position, 1.); vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime, uDay; varying vec2 vUv; varying float vS;
        #include <fog_pars_fragment>
        float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y);}
        void main(){
          float s1 = vn(vec2(vUv.x * 9., vUv.y * .08 - uTime * (.6 + vS * 1.6)));
          float s2 = vn(vec2(vUv.x * 23. + 3., vUv.y * .2 - uTime * (1. + vS * 2.4)));
          float streak = smoothstep(.35, .8, s1 * .6 + s2 * .5);
          vec3 c = mix(vec3(.45, .72, .88), vec3(.95, .98, 1.), clamp(streak * .8 + vS * .45, 0., 1.)) * mix(.3, 1., uDay);
          float edge = smoothstep(0., .2, vUv.x) * smoothstep(1., .8, vUv.x);
          gl_FragColor = vec4(c, edge * mix(.6, .95, max(streak, vS * .6)));
        #include <fog_fragment>
        #include <encodings_fragment>
        }`
    });
    return mat;
  }

  // ---------------------------------------------------------------- quadtree LOD
  // few, big nodes (draw calls matter more than triangles on phones): 64x64 cells per node
  const ROOT = 16384, R0 = -ROOT / 2, MAXLVL = 7, NSEG = 64;   // level 7 = 128 m nodes with 2 m cells (2x2 physics tiles)
  const MACRO_LVL = 4;                                          // levels <= 4 (>= 16 m cells) sample the macro grid only
  const FALLBACK_LVL = 2;                                       // 4096 m nodes kept as cover while finer ones stream
  // split when distance < size * K * (relief factor); relief factor runs FLAT (flat ground) .. CLIFF (walls).
  // Per quality tier; setting L.LOD_K / L.LOD_FLAT / L.LOD_CLIFF explicitly overrides the tier.
  L.LOD_TIERS = { alto: [.42, .7, 1.25], medio: [.26, .6, 1.1], baixo: [.22, .55, 1.0] };   // medio: ~330-400k terrain tris in view range (TECH: 450k on screen in all)
  L.LOD_K = null; L.LOD_FLAT = null; L.LOD_CLIFF = null;
  const _lod = [1, 1, 1];
  function lodParams() {
    const t = L.LOD_TIERS[L.quality] || L.LOD_TIERS.medio;
    _lod[0] = L.LOD_K != null ? L.LOD_K : t[0]; _lod[1] = L.LOD_FLAT != null ? L.LOD_FLAT : t[1]; _lod[2] = L.LOD_CLIFF != null ? L.LOD_CLIFF : t[2];
    return _lod;
  }
  const FAR_LVL = 3;                                            // nodes of 2048 m and up: NSEG/2 unless they hold real relief
  L.LOD_FLATSEG = .1;                                           // below this relief/size a node (above the finest level) uses NSEG/2
  L.FAR_RELIEF = 250;                                           // far nodes with more height range than this keep full NSEG (crisp cliffs far away)
  const nsOf = (l, rel, range) => l <= FAR_LVL ? (range > L.FAR_RELIEF ? NSEG : NSEG >> 1) : (l < MAXLVL && rel < L.LOD_FLATSEG) ? NSEG >> 1 : NSEG;
  const nodes = new Map(); let TMAT = null, WMAT = null, FMAT = null;
  const group = new THREE.Group(); group.name = 'terrain'; L.terrainGroup = group;
  const waterGroup = new THREE.Group(); waterGroup.name = 'water';
  const nkey = (l, i, j) => l * 1e8 + i * 1e4 + j;
  const PS = {}; const INF = {};
  const _rng = [0, 0];
  L.terrainStats = { built: 0, buildMs: 0, last: 0, visible: 0, tris: 0, water: 0 };

  // A node is built by a resumable job, one grid row at a time, so a frame never waits for a whole node:
  //   stage 0: heights (+ the road/river info paint needs, computed once per vertex) for the (NS+3)^2 grid,
  //   stage 1: vertices (packed attributes) row by row, stage 2: skirts, shared index, water, mesh.
  // Vertex layout (27 B): position f32x3 (kept on the CPU for raycasts), normal i8x3, color u16x3, aT u8x4, aU u8x2
  // (all normalized); every array but position is dropped from the CPU once uploaded.
  const IDXC = new Map();
  function sharedIndex(NS) {
    let a = IDXC.get(NS); if (a) return a;
    const Wd = NS + 1, idx = [];
    for (let b = 0; b < NS; b++) for (let q = 0; q < NS; q++) { const p = b * Wd + q, r = p + Wd; idx.push(p, r, p + 1, p + 1, r, r + 1); }
    let sv = Wd * Wd;
    const edges = [[], [], [], []];
    for (let q = 0; q < Wd; q++) { edges[0].push(q); edges[1].push(q * Wd + NS); edges[2].push(NS * Wd + (NS - q)); edges[3].push((NS - q) * Wd); }
    for (const e of edges) { const s0 = sv; for (let k = 0; k < e.length - 1; k++) { const c = s0 + k; idx.push(e[k], e[k + 1], c, e[k + 1], c + 1, c); } sv += e.length; }
    a = new THREE.BufferAttribute(new Uint16Array(idx), 1); a.ntri = idx.length / 3; IDXC.set(NS, a); return a;
  }
  const freeArr = function () { this.array = null; };
  function newJob(w) {
    const l = w.l, size = ROOT / (1 << l), x0 = R0 + w.i * size, z0 = R0 + w.j * size;
    rangeOf(x0, z0, size, _rng);
    const range = _rng[1] - _rng[0] - 6, NS = nsOf(l, range / size, range), Wd = NS + 1, E = NS + 3, nv = Wd * Wd + 4 * Wd;
    return { w, k: w.k, l, i: w.i, j: w.j, size, x0, z0, NS, cs: size / NS, Wd, E, fine: l > MACRO_LVL, st: 0, row: 0, t: 0,
      Hx: new Float32Array(E * E), ip: l > MACRO_LVL ? new Float32Array(Wd * Wd * 3) : null,
      pos: new Float32Array(nv * 3), nor: new Int8Array(nv * 3), col: new Uint16Array(nv * 3), aT: new Uint8Array(nv * 4), aU: new Uint8Array(nv * 2), minH: 1e9, maxH: -1e9 };
  }
  // run the job until the deadline (checked after every row); returns the finished node or null
  function stepJob(J, deadline) {
    const t0 = now();
    const { x0, z0, cs, NS, Wd, E, Hx, ip } = J;
    if (J.st === 0) {
      while (J.row < E) {
        const b = J.row++, gb = b - 1, z = z0 + gb * cs, inZ = gb >= 0 && gb <= NS;
        for (let a = 0; a < E; a++) {
          const ga = a - 1, x = x0 + ga * cs;
          if (!J.fine) Hx[b * E + a] = macro(x, z);
          else if (inZ && ga >= 0 && ga <= NS) { Hx[b * E + a] = hgt(x, z, INF); const o = (gb * Wd + ga) * 3; ip[o] = INF.path; ip[o + 1] = INF.rd; ip[o + 2] = INF.rw; }
          else Hx[b * E + a] = rawH(x, z);
        }
        if (now() > deadline) { J.t += now() - t0; return null; }
      }
      // finest level: the same grid is the physics grid; hand it to the tile cache (L.ground == this mesh)
      if (J.l === MAXLVL) {
        const TT = J.size / TS, ti0 = Math.round(x0 / TS), tj0 = Math.round(z0 / TS);
        for (let tj = 0; tj < TT; tj++) for (let ti = 0; ti < TT; ti++) {
          const key = tkey(ti0 + ti, tj0 + tj); if (tiles.has(key)) continue;
          const t = new Float32Array(TW * TW);
          for (let b = 0; b < TW; b++) for (let a = 0; a < TW; a++) t[b * TW + a] = Hx[(tj * TN + b + 1) * E + ti * TN + a + 1];
          t.used = tileFrame; tiles.set(key, t); L.tilesBuilt++;
        }
      }
      J.st = 1; J.row = 0;
    }
    if (J.st === 1) {
      const { pos, nor, col, aT, aU } = J; const fineN = J.l >= MAXLVL - 1;
      while (J.row < Wd) {
        const b = J.row++, z = z0 + b * cs;
        for (let a = 0; a < Wd; a++) {
          const v = b * Wd + a, h = Hx[(b + 1) * E + a + 1], x = x0 + a * cs;
          pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z; if (h < J.minH) J.minH = h; if (h > J.maxH) J.maxH = h;
          const hl = Hx[(b + 1) * E + a], hr = Hx[(b + 1) * E + a + 2], hd = Hx[b * E + a + 1], hu = Hx[(b + 2) * E + a + 1];
          let nx = (hl - hr) / (2 * cs), nz = (hd - hu) / (2 * cs); const nl = Math.sqrt(nx * nx + 1 + nz * nz); nx /= nl; nz /= nl; const ny = 1 / nl;
          nor[v * 3] = Math.round(nx * 127); nor[v * 3 + 1] = Math.round(ny * 127); nor[v * 3 + 2] = Math.round(nz * 127);
          if (J.fine) { const o = v * 3; INF.path = ip[o]; INF.rd = ip[o + 1]; INF.rw = ip[o + 2]; } else { INF.path = 0; INF.rd = 1e9; INF.rw = 0; }
          // slope for the paint: the mesh normal on the finest levels, else the macro grid's (same rock at every LOD)
          const nyM = nyMacro(x, z), nyE = fineN ? Math.min(ny, nyM + .12) : Math.min(ny, nyM);
          const P = paint(x, z, h, nyE, INF, PS);
          col[v * 3] = clamp(P.c[0], 0, 1) * 65535; col[v * 3 + 1] = clamp(P.c[1], 0, 1) * 65535; col[v * 3 + 2] = clamp(P.c[2], 0, 1) * 65535;
          aT[v * 4] = P.rock * 255; aT[v * 4 + 1] = P.path * 255; aT[v * 4 + 2] = P.sand * 255; aT[v * 4 + 3] = P.snow * 255; aU[v * 2] = P.forest * 255; aU[v * 2 + 1] = P.wet * 255;
        }
        if (now() > deadline) { J.t += now() - t0; return null; }
      }
      J.st = 2;
      if (now() > deadline) { J.t += now() - t0; return null; }
    }
    if (J.st === 3) return stepWater(J, deadline, t0);
    // stage 2: skirts (depth follows the local relief so LOD cracks at cliffs stay covered), geometry, water
    const { pos, nor, col, aT, aU } = J;
    let sv = Wd * Wd;
    const edge = (e, k) => e === 0 ? k : e === 1 ? k * Wd + NS : e === 2 ? NS * Wd + (NS - k) : (NS - k) * Wd;
    for (let e = 0; e < 4; e++) for (let k = 0; k < Wd; k++) {
      const v = edge(e, k), h = pos[v * 3 + 1];
      let rel = 0; for (let q = -2; q <= 2; q++) { const w = edge(e, clamp(k + q, 0, NS)); rel = Math.max(rel, Math.abs(pos[w * 3 + 1] - h)); }
      const drop = 3 + cs * 2 + rel * 1.2;
      pos[sv * 3] = pos[v * 3]; pos[sv * 3 + 1] = h - drop; pos[sv * 3 + 2] = pos[v * 3 + 2];
      for (let c = 0; c < 3; c++) { nor[sv * 3 + c] = nor[v * 3 + c]; col[sv * 3 + c] = col[v * 3 + c]; }
      for (let c = 0; c < 4; c++) aT[sv * 4 + c] = aT[v * 4 + c]; aU[sv * 2] = aU[v * 2]; aU[sv * 2 + 1] = aU[v * 2 + 1]; sv++;
    }
    const g = new THREE.BufferGeometry();
    const att = (arr, n, norm) => { const A = new THREE.BufferAttribute(arr, n, norm); return A; };
    g.setAttribute('position', att(pos, 3, false));
    for (const [name, arr, n] of [['normal', nor, 3], ['color', col, 3], ['aT', aT, 4], ['aU', aU, 2]]) { const A = att(arr, n, true); A.onUploadCallback = freeArr; g.setAttribute(name, A); }
    const IX = sharedIndex(NS); g.setIndex(IX);
    const { x0: X0, z0: Z0, size, minH, maxH } = J;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(X0, minH - 40, Z0), new THREE.Vector3(X0 + size, maxH, Z0 + size)); g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(g, TMAT); m.receiveShadow = true; m.castShadow = J.l >= MAXLVL; m.matrixAutoUpdate = false; m.userData.lvl = J.l; m.name = 'tn' + J.l;
    const node = { mesh: m, water: null, l: J.l, i: J.i, j: J.j, x0: X0, z0: Z0, size, minH, maxH, k: J.k, tris: IX.ntri, used: frameNo,
      bytes: pos.length / 3 * (12 + 3 + 6 + 4 + 2) + pos.length * 4 };
    J.node = node; J.st = 3; waterInit(J);
    if (now() > deadline) { J.t += now() - t0; return null; }
    return stepWater(J, deadline, t0);
  }
  function finishJob(J, t0) {
    const node = J.node, dt = J.t + now() - t0; const S = L.terrainStats; S.built++; S.buildMs += dt; S.last = dt;
    J.Hx = J.ip = null; return node;
  }
  function disposeNode(n) {
    const g = n.mesh.geometry; g.setIndex(null); g.dispose();   // the index is shared between nodes
    if (n.water) n.water.geometry.dispose();
    nodeBytes -= n.bytes;
  }
  let frameNo = 0, nodeBytes = 0;

  // per-node water: ocean (y = 0) and lakes (their own level), one geometry with aDepth; built in row slices (stage 3)
  function waterInit(J) {
    const node = J.node, { x0, z0, size, minH } = node;
    const bodies = [];
    if (minH < .4) bodies.push({ y: 0, lid: 0 });
    for (const lk of LAKES) { const b = lk.bbox; if (b[2] < x0 - 30 || b[0] > x0 + size + 30 || b[3] < z0 - 30 || b[1] > z0 + size + 30) continue; if (minH > lk.level) continue; bodies.push({ y: lk.level, lid: LAKES.indexOf(lk) + 1 }); }
    const WN = node.l >= MAXLVL - 1 ? J.NS : J.NS / 2;
    J.W = bodies.length ? { bodies, bi: 0, row: -1, base: 0, WN, step: J.NS / WN, ww: WN + 1, wcs: size / WN, pos: [], dep: [], idx: [] } : null;
  }
  function stepWater(J, deadline, t0) {
    const Wt = J.W, node = J.node, { x0, z0, size } = node, { Hx, E } = J;
    while (Wt && Wt.bi < Wt.bodies.length) {
      const B = Wt.bodies[Wt.bi], { WN, step, ww, wcs, pos, dep, idx } = Wt, lid = B.lid;
      if (Wt.row < 0) {   // vertices of this body
        Wt.base = pos.length / 3;
        for (let b = 0; b < ww; b++) for (let a = 0; a < ww; a++) { pos.push(x0 + a * wcs, B.y, z0 + b * wcs); dep.push(B.y - Hx[(b * step + 1) * E + a * step + 1]); }
        Wt.row = 0;
      }
      while (Wt.row < WN) {
        const b = Wt.row++, base = Wt.base;
        for (let a = 0; a < WN; a++) {
          const p = base + b * ww + a, q = p + 1, r = p + ww, s = r + 1;
          if (dep[p] < -1.5 && dep[q] < -1.5 && dep[r] < -1.5 && dep[s] < -1.5) continue;
          if (lid) { const cx = x0 + (a + .5) * wcs, cz = z0 + (b + .5) * wcs; const id = cn(LK, cx, cz); if (id !== lid) { const ok = cn(LK, cx - wcs * .5, cz) === lid || cn(LK, cx + wcs * .5, cz) === lid || cn(LK, cx, cz - wcs * .5) === lid || cn(LK, cx, cz + wcs * .5) === lid; if (!ok) continue; } }
          idx.push(p, r, q, q, r, s);
        }
        if (now() > deadline) { J.t += now() - t0; return null; }
      }
      Wt.bi++; Wt.row = -1;
    }
    if (Wt && Wt.idx.length) {
      const { pos, dep, idx, bodies } = Wt;
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1)); wg.setIndex(idx);
      let y0 = 1e9, y1 = -1e9; for (const B of bodies) { y0 = Math.min(y0, B.y); y1 = Math.max(y1, B.y); }
      wg.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0 - 1, z0), new THREE.Vector3(x0 + size, y1 + 1, z0 + size)); wg.boundingSphere = wg.boundingBox.getBoundingSphere(new THREE.Sphere());
      const wm = new THREE.Mesh(wg, WMAT); wm.renderOrder = 2; wm.matrixAutoUpdate = false; wm.name = 'water';
      node.water = wm; node.bytes += pos.length / 3 * 16 + idx.length * 4;
    }
    J.W = null;
    return finishJob(J, t0);
  }

  // river ribbons (global, chunked ~600 m) at their own surface heights
  const riverMeshes = [];
  function buildRivers() {
    for (const r of RIVERS) for (const P of r.reaches) {
      for (let s = 0; s < P.length - 1; s += 30) {
        const e = Math.min(P.length - 1, s + 31); const pos = [], dep = [], uv = [], idx = [];
        for (let k = s; k <= e; k++) {
          const [x, z, y, w] = P[k]; const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
          let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const hw = w * .5 + 1.6; const nx = -dz, nz = dx;
          for (let c = -2; c <= 2; c++) { const f = c / 2; pos.push(x + nx * hw * f, y, z + nz * hw * f); dep.push((1 - f * f) * (.6 + w * .06) + .05); uv.push(f * .5 + .5, k * 20); }
          if (k > s) { const o = (k - s - 1) * 5; for (let c = 0; c < 4; c++) idx.push(o + c, o + c + 5, o + c + 1, o + c + 1, o + c + 5, o + c + 6); }
        }
        bucket(rb, pos[0], pos[2], { position: [pos, 3], aDepth: [dep, 1], uv: [uv, 2] }, idx);
      }
    }
    for (const g of flush(rb)) { const m = new THREE.Mesh(g, WMAT); m.renderOrder = 2; m.matrixAutoUpdate = false; m.name = 'river'; riverMeshes.push(m); waterGroup.add(m); }
  }
  // merge small ribbons into one geometry per 2 km cell (one draw call each, still frustum-culled)
  const rb = new Map(), fb = new Map();
  function bucket(B, x, z, attrs, idx) {
    const k = Math.floor((x + WS) / 2000) * 100 + Math.floor((z + WS) / 2000);
    let e = B.get(k); if (!e) { e = { a: {}, idx: [], n: 0 }; B.set(k, e); }
    let n = 0; for (const name in attrs) { const [arr, sz] = attrs[name]; (e.a[name] = e.a[name] || [sz, []])[1].push(...arr); n = arr.length / sz; }
    for (const v of idx) e.idx.push(v + e.n); e.n += n;
  }
  function flush(B) {
    const out = [];
    for (const e of B.values()) {
      const g = new THREE.BufferGeometry();
      for (const name in e.a) g.setAttribute(name, new THREE.Float32BufferAttribute(e.a[name][1], e.a[name][0]));
      g.setIndex(e.idx); g.computeBoundingSphere(); g.computeBoundingBox(); out.push(g);
    }
    B.clear(); return out;
  }

  // waterfall ribbons (uv.x across, uv.y along in metres, aSteep 0..1)
  L.fallMeshes = [];
  function buildFalls() {
    for (const f of L.FALLS5) {
      const pts = f.pts; const pos = [], uv = [], st = [], nor = [], idx = []; let acc = 0; const px = -f.dz, pz = f.dx;
      const n = pts.length; const XS = 4;
      for (let k = 0; k < n; k++) {
        const [x, y, z] = pts[k]; if (k) acc += Math.hypot(x - pts[k - 1][0], y - pts[k - 1][1], z - pts[k - 1][2]);
        const t = k / (n - 1); const ww = f.w * (1 + t * .55) * (k === 0 ? .9 : 1);
        const steep = k ? clamp(Math.abs(y - pts[k - 1][1]) / Math.max(.01, Math.hypot(x - pts[k - 1][0], z - pts[k - 1][2], y - pts[k - 1][1])), 0, 1) : .4;
        for (let c = 0; c <= XS; c++) {
          const fc = c / XS - .5; const bulge = Math.cos(fc * Math.PI) * Math.min(.8, ww * .05);
          pos.push(x + px * ww * fc + f.dx * bulge, y, z + pz * ww * fc + f.dz * bulge); uv.push(c / XS, acc); st.push(steep); nor.push(f.dx, .15, f.dz);
        }
        if (k) { const o = (k - 1) * (XS + 1); for (let c = 0; c < XS; c++) idx.push(o + c, o + c + 1, o + c + XS + 1, o + c + 1, o + c + XS + 2, o + c + XS + 1); }
      }
      bucket(fb, f.bx, f.bz, { position: [pos, 3], normal: [nor, 3], uv: [uv, 2], aSteep: [st, 1] }, idx);
      if (L.addFallMist) { try { L.addFallMist(f.bx, f.cloudEnd ? L.CLOUD_Y : f.bottom, f.bz, f.w); } catch (e) { } }
    }
    for (const g of flush(fb)) { const m = new THREE.Mesh(g, FMAT); m.renderOrder = 3; m.matrixAutoUpdate = false; m.name = 'fall'; waterGroup.add(m); L.fallMeshes.push(m); }
  }

  // far ocean beyond the quadtree root
  function buildOcean() {
    // a square annulus whose inner edge is exactly the root square (per-node water covers the inside), out to 60 km;
    // four trapezoids, each subdivided so per-vertex terms stay smooth
    const A = ROOT * .5, B = 60000, NA = 8, NR = 6; const pos = [], nor = [], uv = [], idx = [];
    const OUT = [[-B, -B], [B, -B], [B, B], [-B, B]], INN = [[-A, -A], [A, -A], [A, A], [-A, A]];
    for (let e = 0; e < 4; e++) {
      const o0 = OUT[e], o1 = OUT[(e + 1) % 4], i0 = INN[e], i1 = INN[(e + 1) % 4], base = pos.length / 3;
      for (let r = 0; r <= NR; r++) {
        const f = Math.pow(r / NR, 2.2);   // denser near the coast
        for (let a = 0; a <= NA; a++) {
          const t = a / NA; const ix = i0[0] + (i1[0] - i0[0]) * t, iz = i0[1] + (i1[1] - i0[1]) * t, ox = o0[0] + (o1[0] - o0[0]) * t, oz = o0[1] + (o1[1] - o0[1]) * t;
          const x = ix + (ox - ix) * f, z = iz + (oz - iz) * f; pos.push(x, 0, z); nor.push(0, 1, 0); uv.push(x / 100, z / 100);
        }
      }
      for (let r = 0; r < NR; r++) for (let a = 0; a < NA; a++) {
        const p0 = base + r * (NA + 1) + a, p1 = p0 + 1, q0 = p0 + NA + 1, q1 = q0 + 1;   // r = 0: inner edge
        idx.push(q0, p0, q1, q1, p0, p1);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(pos.length / 3).fill(40), 1));
    const m = new THREE.Mesh(g, WMAT); m.renderOrder = 1; m.frustumCulled = false; m.name = 'ocean'; waterGroup.add(m);
    // under the root square: deep floor plate so the canyon floors never show the void
    const p = new THREE.PlaneGeometry(ROOT * 1.42, ROOT * 1.42, 1, 1); p.rotateX(-Math.PI / 2);
    p.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(4).fill(40), 1));
    const m2 = new THREE.Mesh(p, WMAT); m2.position.y = -.6; m2.updateMatrix(); m2.matrixAutoUpdate = false; m2.renderOrder = 0; m2.frustumCulled = false; m2.name = 'ocean_plate'; m2.visible = false; waterGroup.add(m2);
  }

  L.terrainInit = function () {
    if (!W.ready) throw new Error('L.worldLoad() must resolve before L.terrainInit()');
    TMAT = L.makeTerrainMaterial ? L.makeTerrainMaterial() : interimTerrainMat();
    WMAT = L.makeWaterMaterial ? L.makeWaterMaterial({ depthAttr: true }) : interimWaterMat();
    FMAT = L.makeFlowMaterial ? L.makeFlowMaterial() : interimFlowMat();
    L.terrainMat = TMAT; L.waterMat = WMAT; L.flowMat = FMAT; L.waterU = WMAT.uniforms;
    L.scene.add(group); L.scene.add(waterGroup);
    buildOcean(); buildRivers(); buildFalls();
  };

  // ---------------------------------------------------------------- LOD selection
  // camera distance to the node AABB (height range from the macro min/max pyramid) decides splitting
  // relief-adaptive: nodes holding cliffs split farther out (crisp edges), flat nodes earlier (fewer triangles)
  const _nd = [0, 0, 0];
  function nodeDist(l, i, j, cx, cy, cz) {
    const size = ROOT / (1 << l), x0 = R0 + i * size, z0 = R0 + j * size;
    rangeOf(x0, z0, size, _rng);
    const dx = Math.max(x0 - cx, 0, cx - (x0 + size)), dz = Math.max(z0 - cz, 0, cz - (z0 + size)), dy = Math.max(_rng[0] - cy, 0, cy - _rng[1]);
    _nd[0] = Math.sqrt(dx * dx + dz * dz + dy * dy); _nd[1] = Math.sqrt(dx * dx + dz * dz);
    const rel = (_rng[1] - _rng[0]) / size;          // relief relative to the node size
    _nd[2] = _lod[1] + (_lod[2] - _lod[1]) * sstep(.05, .28, rel);
    return _nd;
  }
  let want = [], wantSet = new Set(), lastCam = [1e9, 1e9, 1e9], visible = new Set();
  function computeWant(cx, cy, cz) {
    const out = []; const far = L.TERRAIN_FAR, K = lodParams()[0];
    const rec = (l, i, j) => {
      const nd = nodeDist(l, i, j, cx, cy, cz), d = nd[0], dh = nd[1]; if (dh > far) return;
      const size = ROOT / (1 << l);
      const split = l < MAXLVL && d < size * K * nd[2];
      out.push({ k: nkey(l, i, j), l, i, j, d, split });
      if (split) { rec(l + 1, i * 2, j * 2); rec(l + 1, i * 2 + 1, j * 2); rec(l + 1, i * 2, j * 2 + 1); rec(l + 1, i * 2 + 1, j * 2 + 1); }
    };
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) rec(1, i, j);
    return out;
  }
  // build priority: cover first (fallback level), then leaves by screen importance
  function buildList() {
    const L2 = [];
    for (const w of want) { if (nodes.has(w.k)) continue; if (w.l === FALLBACK_LVL || (!w.split && w.l <= FALLBACK_LVL) || !w.split) L2.push(w); }
    L2.sort((a, b) => { const fa = a.l <= FALLBACK_LVL ? -1e9 : 0, fb = b.l <= FALLBACK_LVL ? -1e9 : 0; return (fa + a.d / (ROOT >> a.l)) - (fb + b.d / (ROOT >> b.l)); });
    return L2;
  }
  let pending = [], job = null, lastKey = '';
  const lodKey = () => [L.LOD_K, L.LOD_FLAT, L.LOD_CLIFF, L.quality, L.TERRAIN_FAR, L.LOD_FLATSEG, L.FAR_RELIEF].join('|');
  // force a fresh LOD selection (and with rebuild = true, drop every built node: paint/quality changes)
  L.terrainInvalidate = function (rebuild) {
    lastCam = [1e9, 1e9, 1e9];
    if (rebuild) { for (const [k, n] of nodes) { if (visible.has(k)) { group.remove(n.mesh); if (n.water) waterGroup.remove(n.water); } disposeNode(n); } nodes.clear(); visible = new Set(); job = null; }
  };
  // budgetMs is a hard limit: work stops at the first row that ends past it (rows take ~0.05-0.2 ms)
  L.terrainUpdate = function (cam, budgetMs) {
    if (!TMAT) return false;
    frameNo++; const t00 = now();
    const cx = cam.x, cy = cam.y, cz = cam.z, key = lodKey();
    if (key !== lastKey || Math.hypot(cx - lastCam[0], cz - lastCam[2]) > 8 || Math.abs(cy - lastCam[1]) > 10 || !want.length) {
      want = computeWant(cx, cy, cz); wantSet = new Set(want.map(w => w.k)); lastCam = [cx, cy, cz]; lastKey = key; pending = buildList();
      if (job && !wantSet.has(job.k)) job = null;
    }
    const tA = now(), deadline = tA + (budgetMs == null ? 4 : budgetMs);
    while (now() < deadline) {
      if (!job) {
        let w = null; while (pending.length && !w) { const c = pending.shift(); if (!nodes.has(c.k)) w = c; }
        if (!w) break;
        job = newJob(w);
      }
      const n = stepJob(job, deadline);
      if (n) { nodes.set(n.k, n); nodeBytes += n.bytes; job = null; }
    }
    const tB = now(); select(); const tC = now(); evict(cx, cz);
    const P = L.terrainStats.ph || (L.terrainStats.ph = [0, 0, 0, 0]); P[0] = tA - t00; P[1] = tB - tA; P[2] = tC - tB; P[3] = now() - tC;   // last frame: want, build, select, evict (ms)
    return pending.length === 0 && !job;
  };
  // visible set: wanted leaves that exist; where a subtree is incomplete, its nearest built ancestor covers it
  const byKey = new Map();
  function select() {
    byKey.clear(); for (const w of want) byKey.set(w.k, w);
    const show = new Set();
    const avail = (w) => { // can this wanted node be drawn completely by itself or its wanted descendants?
      if (!w.split) return nodes.has(w.k);
      for (let q = 0; q < 4; q++) { const c = byKey.get(nkey(w.l + 1, w.i * 2 + (q & 1), w.j * 2 + (q >> 1))); if (c && !avail(c)) return false; }
      return true;
    };
    const draw = (w) => {
      if (!w.split) { if (nodes.has(w.k)) show.add(w.k); return; }
      if (w.l >= FALLBACK_LVL && nodes.has(w.k) && !avail(w)) { show.add(w.k); return; }
      for (let q = 0; q < 4; q++) { const c = byKey.get(nkey(w.l + 1, w.i * 2 + (q & 1), w.j * 2 + (q >> 1))); if (c) draw(c); }
    };
    for (const w of want) if (w.l === 1) draw(w);
    let tris = 0, wat = 0;
    for (const k of visible) if (!show.has(k)) { const n = nodes.get(k); if (n) { group.remove(n.mesh); if (n.water) waterGroup.remove(n.water); } }
    for (const k of show) { const n = nodes.get(k); if (!visible.has(k)) { group.add(n.mesh); if (n.water) waterGroup.add(n.water); } tris += n.tris; if (n.water) wat++; n.used = frameNo; }
    visible = show; const S = L.terrainStats; S.visible = show.size; S.tris = tris; S.water = wat; S.nodes = nodes.size; S.pending = pending.length + (job ? 1 : 0); S.bytes = nodeBytes;
    // rivers: distance cull
    for (const m of riverMeshes) { const s = m.geometry.boundingSphere; m.visible = Math.hypot(s.center.x - lastCam[0], s.center.z - lastCam[2]) < L.TERRAIN_FAR * .6 + s.radius; }
  }
  // memory cap per quality tier (node count and bytes, GPU + CPU): evict the farthest nodes first, then the least
  // recently shown; nodes on screen or wanted by the current LOD selection are never evicted
  L.NODE_CAPS = { alto: 320, medio: 200, baixo: 120 };
  L.NODE_BYTES = { alto: 72e6, medio: 48e6, baixo: 28e6 };
  L.NODE_CAP = null;   // explicit override of the tier's node count
  function evict(cx, cz) {
    const tier = L.quality in L.NODE_CAPS ? L.quality : 'medio';
    const cap = L.NODE_CAP || L.NODE_CAPS[tier], bcap = L.NODE_BYTES[tier];
    if (nodes.size <= cap && nodeBytes <= bcap) return;
    const list = [];
    for (const [k, n] of nodes) {
      if (visible.has(k) || wantSet.has(k)) continue;
      const dx = Math.max(n.x0 - cx, 0, cx - (n.x0 + n.size)), dz = Math.max(n.z0 - cz, 0, cz - (n.z0 + n.size));
      list.push({ k, n, d: Math.floor(Math.hypot(dx, dz) / 256), u: n.used });
    }
    list.sort((a, b) => (b.d - a.d) || (a.u - b.u));
    for (const e of list) {
      if (nodes.size <= cap * .9 && nodeBytes <= bcap * .9) break;
      disposeNode(e.n); nodes.delete(e.k);
    }
  }
  L.terrainMeshes = () => { const out = []; for (const k of visible) { const n = nodes.get(k); if (n) out.push(n.mesh); } return out; };
  L.terrainNodes = nodes;
  L.terrainReady = () => pending.length === 0 && want.length > 0;

  // ---------------------------------------------------------------- world map (baked PNG)
  L.MAPRES = 2048; L.mapImage = null; L.mapCanvas = null; let mapOK = false, mapBase = null, mapAsked = false;
  // L.MAP_LAZY = true before L.worldLoad(): the 2 MB map image waits for L.mapLoad() (the game asks after entering)
  L.mapLoad = () => { if (mapBase) loadMap(mapBase); return L.mapDone(); };
  function loadMap(base) {
    if (typeof Image === 'undefined' || mapAsked) return; mapAsked = true;
    const img = new Image(); img.decoding = 'async';
    img.onload = () => { L.MAPRES = img.naturalWidth || 2048; mapOK = true; };
    img.onerror = () => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#9cc6ec'; g.fillRect(0, 0, 64, 64); L.mapCanvas = c; L.MAPRES = 64; mapOK = true; };
    img.src = base + 'map5.png'; L.mapImage = img; L.mapCanvas = img;
  }
  L.toMap = (x, z) => [(x + WS) / (2 * WS), (z + WS) / (2 * WS)];
  L.mapStep = () => mapOK; L.mapDone = () => mapOK;

  // cloud-sea density texture from the baked cloud mask (for LOOK's L.cloudSea.setDensityMap(tex, -WS, -WS, 2*WS))
  L.cloudMaskTexture = function () {
    const d = new Uint8Array(N2 * N2 * 4); for (let k = 0; k < N2 * N2; k++) { d[k * 4] = CL[k]; d[k * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, N2, N2, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  };

  // v4 boot compatibility: the old game awaits L.loadAll before terrainInit, so the world data loads with it
  if (L.loadAll && !L.loadAll._w5) { const la = L.loadAll; L.loadAll = function () { const a = la.apply(L, arguments); return Promise.all([a, L.worldLoad()]).then(r => r[0]); }; L.loadAll._w5 = true; }
})(window.L = window.L || {});
