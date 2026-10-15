/* Lumiar v4 terrain: a 3 km island with regions, rivers, waterfalls; cached height tiles, LOD quadtree meshes, water. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep, C } = L;
  const SEED = 20261015;
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash2(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + SEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function hash3(i, j, k) { let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k + 7, 83492791) ^ SEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vnoise(x, y) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
  function fbm(x, y, o) { let s = 0, a = .5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * vnoise(x * f + k * 17.3, y * f + k * 9.1); n += a; a *= .5; f *= 2.03; } return s / n; }
  function ridged(x, y, o) { let s = 0, a = .5, f = 1, n = 0, w = 1; for (let k = 0; k < o; k++) { let v = 1 - Math.abs(vnoise(x * f + k * 31.7, y * f - k * 12.9) * 2 - 1); v *= v * w; w = clamp(v * 1.6, 0, 1); s += a * v; n += a; a *= .5; f *= 2.07; } return s / n; }
  L.fbm = fbm; L.vnoise = vnoise; L.mulberry32 = mulberry32; L.hash2 = hash2; L.hash3 = hash3;

  // ---------------------------------------------------------------- world layout
  const WS = 1536; L.WS = WS; // playable half-size (the island sits inside, ocean beyond)
  const REG = L.REG = {
    vale: { nome: 'Vale do Amanhecer', x: 40, z: 60, r: 430 },
    lago: { nome: 'Lago Espelhado', x: 300, z: 380, r: 190 },
    antiga: { nome: 'Floresta Antiga', x: 860, z: 40, r: 440 },
    pinho: { nome: 'Pinheiral do Norte', x: -60, z: -560, r: 400 },
    montes: { nome: 'Montanhas Celestes', x: 100, z: -1060, r: 560 },
    dragao: { nome: 'Pico do Dragão', x: 800, z: -930, r: 330 },
    penhas: { nome: 'Penhascos das Cachoeiras', x: -800, z: -640, r: 520 },
    canion: { nome: 'Cânion Rubro', x: -1060, z: 120, r: 390 },
    planicie: { nome: 'Planícies Douradas', x: -760, z: 860, r: 470 },
    pantano: { nome: 'Pântano das Brumas', x: 90, z: 1010, r: 390 },
    costa: { nome: 'Costa Turquesa', x: 900, z: 880, r: 430 },
  };
  const RKEYS = Object.keys(REG); L.RKEYS = RKEYS;
  const LAKE = { x: 300, z: 380, r: 175 }; L.LAKE = LAKE;
  const PONDS = [{ x: -210, z: 210, r: 38 }, { x: 470, z: -150, r: 30 }, { x: -470, z: -330, r: 34 }, { x: 640, z: 330, r: 30 }, { x: -1000, z: -560, r: 46 }, { x: -720, z: -880, r: 38 }];
  // rivers: polylines from the source (a waterfall at the foot of a cliff) to the sea
  const RIVERS = L.RIVERS = [
    { id: 'a', pts: [[-60, -720], [-20, -560], [50, -420], [70, -280], [130, -150], [165, 0], [190, 160], [250, 270], [300, 380], [320, 560], [260, 700], [180, 830], [120, 960], [70, 1120], [30, 1300], [10, 1560]] },
    { id: 'b', pts: [[-640, -520], [-700, -380], [-780, -240], [-880, -120], [-980, 20], [-1080, 120], [-1200, 170], [-1350, 230], [-1580, 270]] },
    { id: 'c', pts: [[640, -700], [700, -520], [780, -360], [830, -180], [900, 0], [960, 200], [1000, 420], [1060, 640], [1200, 800], [1580, 960]] },
    { id: 'd', pts: [[-1010, -860], [-1000, -760], [-1040, -660]], pond: true },
    { id: 'e', pts: [[-760, -930], [-720, -860], [-700, -790]], pond: true },
  ];
  // precompute segment data
  for (const rv of RIVERS) {
    rv.seg = []; let acc = 0; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < rv.pts.length - 1; i++) { const [ax, az] = rv.pts[i], [bx, bz] = rv.pts[i + 1]; const len = Math.hypot(bx - ax, bz - az); rv.seg.push({ ax, az, bx, bz, len, acc }); acc += len; x0 = Math.min(x0, ax, bx); z0 = Math.min(z0, az, bz); x1 = Math.max(x1, ax, bx); z1 = Math.max(z1, az, bz); }
    rv.len = acc; rv.bb = [x0 - 160, z0 - 160, x1 + 160, z1 + 160];
    if (rv.pond) rv.end = rv.pts[rv.pts.length - 1];
  }
  const _rv = { d: 1e9, t: 0, along: 0, w: 0, rv: null };
  function riverQuery(x0, z0) {
    _rv.d = 1e9; _rv.rv = null;
    const x = x0 + (fbm(x0 * .006 + 13, z0 * .006, 3) - .5) * 150, z = z0 + (fbm(x0 * .006, z0 * .006 - 21, 3) - .5) * 150;
    for (const rv of RIVERS) {
      const bb = rv.bb; if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      for (const s of rv.seg) {
        const dx = s.bx - s.ax, dz = s.bz - s.az; let t = ((x - s.ax) * dx + (z - s.az) * dz) / (s.len * s.len); t = clamp(t, 0, 1);
        const px = s.ax + dx * t, pz = s.az + dz * t; const d = Math.hypot(x - px, z - pz);
        if (d < _rv.d) { _rv.d = d; _rv.along = s.acc + t * s.len; _rv.rv = rv; }
      }
    }
    if (_rv.rv) { _rv.t = _rv.along / _rv.rv.len; _rv.w = 5 + Math.min(_rv.along, 1400) * .006 + sstep(0, 1, _rv.t) * 3; }
    return _rv;
  }
  L.riverQuery = riverQuery;
  L.distRiver = (x, z) => { const q = riverQuery(x, z); return q.rv ? Math.max(0, q.d - q.w) : 999; };

  // points of interest (map icons, discovery, special spawns)
  const POI = L.POI = [
    { id: 'spawn', clear: 16, nome: 'Acampamento', ic: '🏕️', x: 60, z: 120, always: true },
    { id: 'castelo', nome: 'Ilha do Castelo Celeste', ic: '🏰', x: -260, z: -330, fly: 200, always: true },
    { id: 'ruinas', clear: 42, nome: 'Ruínas Antigas', ic: '🏛️', x: 480, z: -380 },
    { id: 'clareira', clear: 30, nome: 'Clareira Lunar', ic: '🌙', x: -420, z: -620 },
    { id: 'gruta', clear: 16, nome: 'Gruta de Cristal', ic: '💎', x: 420, z: -760 },
    { id: 'toca', clear: 14, nome: 'Toca da Pantera', ic: '🐾', x: 1080, z: -200 },
    { id: 'santuario', clear: 20, nome: 'Santuário do Musgo', ic: '🌿', x: -160, z: 1110 },
    { id: 'ninho', clear: 22, nome: 'Ninho do Dragão', ic: '🐉', x: 800, z: -930 },
    { id: 'picolobo', nome: 'Pico do Lobo Branco', ic: '🐺', x: -40, z: -1080 },
    { id: 'arco', nome: 'Arco de Pedra', ic: '🌉', x: -1180, z: -260 },
    { id: 'grifo', nome: 'Agulha do Grifo', ic: '🦅', x: -860, z: -620 },
    { id: 'coluna', clear: 28, nome: 'Colunata Dourada', ic: '🏛️', x: -700, z: 760 },
    { id: 'farol', nome: 'Enseada das Tartarugas', ic: '🐢', x: 900, z: 900 },
  ];
  L.poiClear = (x, z) => { for (const p of POI) if (p.clear && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < p.clear * p.clear) return true; return false; };
  const FLAT = [ // flattened pads for POIs (x, z, radius, height or null = keep local)
    { x: 480, z: -380, r: 46, h: null }, { x: -420, z: -620, r: 34, h: null }, { x: -160, z: 1110, r: 22, h: 1.8 }, { x: -700, z: 760, r: 30, h: null }, { x: 60, z: 120, r: 30, h: 4.5 },
  ];

  // ---------------------------------------------------------------- height
  const _w = [0, 0];
  function warp(x, z) { _w[0] = x + (fbm(x * .0011 + 3.1, z * .0011 - 1.7, 3) - .5) * 380; _w[1] = z + (fbm(x * .0011 - 7.3, z * .0011 + 5.2, 3) - .5) * 380; return _w; }
  const rmask = (wx, wz, R, a, b) => sstep(a, b, Math.hypot(wx - R.x, wz - R.z) / R.r);
  const terr = (h, step, sharp) => { const t = h / step, fl = Math.floor(t), fr = t - fl; return (fl + sstep(sharp, 1, fr)) * step + fr * step * .1; };
  function rawH0(x, z, noFlat) {
    const w = warp(x, z), wx = w[0], wz = w[1];
    let h = 7 + (fbm(x * .0019 + 11, z * .0019 - 4, 4) - .5) * 36 + (fbm(x * .0075, z * .0075, 3) - .5) * 9;
    // valley around the spawn: gentle
    const mV = rmask(wx, wz, REG.vale, 1, .55); if (mV > 0) h = lerp(h, 8.5 + (h - 7) * .5, mV * .75);
    // north mountains
    const mN = sstep(-430, -820, wz) * (1 - sstep(-560, -900, wx) * .92);
    if (mN > 0) { const rr = ridged(x * .0015 + 5, z * .0015 - 9, 5); h += mN * (50 + Math.pow(rr, 1.1) * 380 * (.5 + .5 * fbm(x * .0009 + 2, z * .0009, 2))); }
    // dragon peak with a lair plateau on top
    { const d = Math.hypot(x - 800, z + 930); if (d < 700) { const pk = 260 * Math.exp(-(d / 280) * (d / 280)) * (.8 + .2 * ridged(x * .004, z * .004, 3)); h += pk; if (d < 110) h = lerp(h, Math.max(300, h * .9), sstep(110, 62, d)); } }
    // white wolf peak: a broad summit
    { const d = Math.hypot(x + 40, z + 1080); if (d < 600) h += 130 * Math.exp(-(d / 170) * (d / 170)); if (d < 70) h = lerp(h, 300, sstep(70, 35, d) * .8); }
    // cliffs & mesas (Vindsjäl): terraced plateaus with vertical walls
    const mC = rmask(wx, wz, REG.penhas, 1.05, .62);
    if (mC > 0) { const v = fbm(x * .0031 + 21, z * .0031 - 13, 4); let hm = (v - .27) * 330; hm = Math.max(terr(hm, 27, .62), 0); h = lerp(h, 5 + hm + (fbm(x * .02, z * .02, 2) - .5) * 3, mC); }
    // red canyon: plateau cut by terraced canyons
    const mK = rmask(wx, wz, REG.canion, 1.0, .6);
    if (mK > 0) { const c = fbm(x * .0042 + 40, z * .0042 + 40, 3); const ch = sstep(.085, .02, Math.abs(c - .5)); let hc = lerp(50 + (fbm(x * .01, z * .01, 2) - .5) * 8, 5, ch); hc = terr(hc, 9, .55); h = lerp(h, hc, mK); }
    // golden plains: flat
    const mP = rmask(wx, wz, REG.planicie, 1, .55); if (mP > 0) h = lerp(h, 4.5 + (fbm(x * .004, z * .004, 2) - .5) * 9, mP * .88);
    // swamp: near water level with many ponds
    const mS = rmask(wx, wz, REG.pantano, 1, .55); if (mS > 0) h = lerp(h, .6 + (fbm(x * .016 + 3, z * .016 + 9, 3) - .5) * 6, mS * .95);
    // ancient forest: rolling hills
    const mA = rmask(wx, wz, REG.antiga, 1, .55); if (mA > 0) h = lerp(h, 10 + (fbm(x * .004 + 8, z * .004, 3) - .5) * 40, mA * .6);
    // coast south-east: low
    const mCo = rmask(wx, wz, REG.costa, 1, .5); if (mCo > 0) h = lerp(h, 3 + (fbm(x * .006, z * .006, 2) - .5) * 10, mCo * .7);
    // POI pads
    if (!noFlat) for (const f of FLAT) { const d = Math.hypot(x - f.x, z - f.z); if (d < f.r * 1.8) h = lerp(h, f.h, sstep(f.r * 1.8, f.r, d)); }
    // big lake
    { const lx = x + (fbm(x * .006 + 3, z * .006, 3) - .5) * 150, lz = z + (fbm(x * .006, z * .006 + 7, 3) - .5) * 150;
      const dl = Math.hypot(lx - LAKE.x, lz - LAKE.z) / LAKE.r;
      if (dl < 1.7) { h = lerp(h, Math.min(h, 3.2), sstep(1.7, 1.1, dl)); h = lerp(h, -8, sstep(1.08, .55, dl)); const di = Math.hypot(x - 340, z - 420); if (di < 34) h = lerp(h, 3.5, sstep(34, 16, di)); } }
    for (const p of PONDS) { if (Math.abs(x - p.x) > p.r * 2.5 || Math.abs(z - p.z) > p.r * 2.5) continue; const px = x + (fbm(x * .02 + p.x, z * .02, 2) - .5) * p.r * 1.2, pz = z + (fbm(x * .02, z * .02 + p.z, 2) - .5) * p.r * 1.2; const d = Math.hypot(px - p.x, pz - p.z) / p.r; if (d < 1.6) { h = lerp(h, Math.min(h, 3), sstep(1.6, 1.05, d)); h = lerp(h, -3, sstep(1.04, .5, d)); } }
    // rivers: channel + valley; steep cirque behind each source (waterfall wall)
    const q = riverQuery(x, z);
    if (q.rv) {
      const rv = q.rv; const bed = -2.7; let k = lerp(2.9, .42, sstep(0, 70, q.along));
      if (rv.pond && q.along > rv.len - 10) k = .6;
      const tgt = bed + Math.max(0, q.d - q.w) * k;
      if (tgt < h) h = tgt;
      if (rv.pond) { const e = rv.end; const dp = Math.hypot(x - e[0], z - e[1]); if (dp < 70) h = Math.min(h, lerp(-3, h, sstep(30, 70, dp))); }
    }
    // island coastline
    const rr = Math.hypot(x * .97, z * (z < 0 ? .86 : 1.02)) + (fbm(x * .0011 + 77, z * .0011 - 33, 3) - .5) * 700 + (fbm(x * .004, z * .004, 2) - .5) * 120;
    const land = sstep(1520, 1200, rr); if (land < 1) h = lerp(-32, h, land);
    return h;
  }
  for (const f of FLAT) if (f.h == null) { let s = 0; for (let k = 0; k < 9; k++) s += rawH0(f.x + Math.cos(k * .7) * f.r * .6 * (k > 0), f.z + Math.sin(k * .7) * f.r * .6 * (k > 0), true); f.h = Math.max(1.5, s / 9); }
  // waterfalls at river sources: find the top of the cirque wall behind each source
  const FALLS = L.FALLS = [];
  function findFalls() {
    for (const rv of RIVERS) {
      const [sx, sz] = rv.pts[0], [nx, nz] = rv.pts[1]; let dx = nx - sx, dz = nz - sz; const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
      const prof = []; let top = null, base = null;
      for (let k = 0; k <= 220; k += 2) { const x = sx - dx * k, z = sz - dz * k, h = rawH0(x, z); prof.push([x, z, h, k]); }
      for (let i = 0; i < prof.length; i++) { if (base == null && prof[i][2] > .5) base = i; }
      if (base == null) continue;
      for (let i = base + 1; i < prof.length - 3; i++) { const rise = prof[i + 3][2] - prof[i][2]; if (prof[i][2] > 12 && rise < 2.2) { top = i; break; } }
      if (top == null) top = Math.min(prof.length - 1, base + 30);
      const pts = prof.slice(Math.max(0, base - 3), top + 1).reverse(); // from top down to the pool
      FALLS.push({ rv: rv.id, x: prof[top][0], z: prof[top][1], h: prof[top][2], bx: prof[base][0], bz: prof[base][1], dx, dz, pts, w: 9 + Math.min(14, prof[top][2] * .05) });
    }
  }
  findFalls();
  const rawH = rawH0; L.rawH = rawH;
  // spawn point
  const SPAWN = L.SPAWN = [60, 120];

  // ---------------------------------------------------------------- cached height tiles (2 m grid, 64 m tiles) — exact match with the finest mesh
  const TS = 64, TN = 32, TC = TS / TN, TW = TN + 1; L.TS = TS;
  const tiles = new Map(); let tileFrame = 0; L.tiles = tiles;
  const tkey = (i, j) => (i + 1024) * 4096 + (j + 1024);
  function getTile(i, j) {
    const k = tkey(i, j); let t = tiles.get(k);
    if (!t) { t = new Float32Array(TW * TW); const x0 = i * TS, z0 = j * TS; for (let b = 0; b < TW; b++) for (let a = 0; a < TW; a++) t[b * TW + a] = rawH(x0 + a * TC, z0 + b * TC); tiles.set(k, t); L.tilesBuilt = (L.tilesBuilt || 0) + 1; }
    t.used = tileFrame; return t;
  }
  L.getTile = getTile;
  function ground(x, z) {
    const i = Math.floor(x / TS), j = Math.floor(z / TS); const t = getTile(i, j);
    const u = (x - i * TS) / TC, v = (z - j * TS) / TC; const a0 = Math.min(Math.floor(u), TN - 1), b0 = Math.min(Math.floor(v), TN - 1); const fu = u - a0, fv = v - b0;
    const A = t[b0 * TW + a0], B = t[b0 * TW + a0 + 1], Cc = t[(b0 + 1) * TW + a0], D = t[(b0 + 1) * TW + a0 + 1];
    return fu + fv <= 1 ? A + (B - A) * fu + (Cc - A) * fv : D + (Cc - D) * (1 - fu) + (B - D) * (1 - fv);
  }
  function slope(x, z) { const e = 1.2; return Math.hypot(ground(x + e, z) - ground(x - e, z), ground(x, z + e) - ground(x, z - e)) / (2 * e); }
  L.ground = ground; L.slope = slope;
  L.groundN = function (x, z, out) { const e = 1.0; const hx = ground(x + e, z) - ground(x - e, z), hz = ground(x, z + e) - ground(x, z - e); out = out || new THREE.Vector3(); out.set(-hx, 2 * e, -hz).normalize(); return out; };
  L.trimTiles = function (px, pz) { tileFrame++; if (tiles.size < 700) return; const keep = 420; for (const [k, t] of tiles) { const i = Math.floor(k / 4096) - 1024, j = k % 4096 - 1024; if (Math.hypot((i + .5) * TS - px, (j + .5) * TS - pz) > keep) tiles.delete(k); } };
  L.findLand = function (x, z, minH, maxH, maxSlope) {
    minH = minH == null ? .8 : minH; maxH = maxH == null ? 60 : maxH; maxSlope = maxSlope || .5;
    for (let r = 0; r < 120; r += 2) for (let a = 0; a < 6.28; a += .5) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, h = rawH(px, pz); if (h > minH && h < maxH && L.distRiver(px, pz) > 4) { const sl = Math.hypot(rawH(px + 1.5, pz) - h, rawH(px, pz + 1.5) - h) / 1.5; if (sl < maxSlope) return [px, pz]; } }
    return [x, z];
  };

  // ---------------------------------------------------------------- biomes & painterly ground colours
  const PAL = {
    vale: { a: C(0x7cc24a), b: C(0x4f9e35), dry: C(0xa8bb52) },
    lago: { a: C(0x6fbd48), b: C(0x45963a), dry: C(0x9cba5a) },
    antiga: { a: C(0x4f9a34), b: C(0x2f6e2a), dry: C(0x6f9a3a) },
    pinho: { a: C(0x5e9c3f), b: C(0x3a7436), dry: C(0x7f9a4a) },
    montes: { a: C(0x7aa64e), b: C(0x557f3e), dry: C(0x9aa060) },
    dragao: { a: C(0x7d8f4a), b: C(0x5f6f3e), dry: C(0x9a8a5a) },
    penhas: { a: C(0x74c447), b: C(0x48a03a), dry: C(0x9cc456) },
    canion: { a: C(0xb3a254), b: C(0x8a8a46), dry: C(0xcfa565) },
    planicie: { a: C(0xd6bd63), b: C(0xa9b04e), dry: C(0xe2c879) },
    pantano: { a: C(0x5d8c3a), b: C(0x3f6a30), dry: C(0x7a8a48) },
    costa: { a: C(0x86c450), b: C(0x5fa840), dry: C(0xb8c068) },
  };
  const ROCK = { def: [C(0x5c5751), C(0x7b746b)], canion: [C(0x93502f), C(0xbd7444)], penhas: [C(0x5d5a54), C(0x827d74)], montes: [C(0x545457), C(0x737174)], dragao: [C(0x46413e), C(0x655d57)] };
  const SAND = C(0xe8d6a0), WETSAND = C(0xb6a17a), SNOW = C(0xcfd8e4), FOREST = C(0x34592a), MOSS = C(0x4c7a2f), MUD = C(0x5f5a3c);
  const _bw = {}; for (const k of RKEYS) _bw[k] = 0;
  // soft region weights on warped coordinates
  function biome(x, z, out) {
    const w = warp(x, z), wx = w[0], wz = w[1]; let tot = 0, best = null, bv = -1;
    out = out || {};
    for (const k of RKEYS) { const R = REG[k]; let d = Math.hypot(wx - R.x, wz - R.z) / R.r; if (k === 'montes') d = Math.min(d, Math.max(0, (wz + 900) / 300) + Math.abs(wx - 100) / 1600); const v = Math.exp(-d * 7); out[k] = v; tot += v; if (v > bv) { bv = v; best = k; } }
    for (const k of RKEYS) out[k] /= tot; out.main = best; return out;
  }
  L.biome = biome;
  // tree density (0..1) used by both ground paint and scattering
  function forestDensity(x, z, B) {
    const n = fbm(x * .006 + 50, z * .006 + 50, 3), n2 = fbm(x * .02 - 9, z * .02 + 4, 2);
    const base = { vale: .26, lago: .28, antiga: .78, pinho: .74, montes: .34, dragao: .12, penhas: .48, canion: .08, planicie: .06, pantano: .44, costa: .2 };
    let d = 0; for (const k of RKEYS) d += B[k] * base[k];
    return clamp(d + (n - .5) * 1.1 + (n2 - .5) * .25, 0, 1);
  }
  L.forestDensity = forestDensity;
  const _c = new THREE.Color(), _c2 = new THREE.Color(), _B = {};
  function paint(x, z, h, ny, out) {
    const B = biome(x, z, _B); const fd = forestDensity(x, z, B);
    const n1 = fbm(x * .009 + 5, z * .009 - 3, 3), n2 = fbm(x * .04 + 1, z * .04 + 7, 2);
    // grass colour: blend of region palettes
    let r = 0, g = 0, b = 0;
    for (const k of RKEYS) { const w = B[k]; if (w < .01) continue; const P = PAL[k]; _c.copy(P.b).lerp(P.a, sstep(.3, .72, n1)).lerp(P.dry, sstep(.62, .85, n2) * .5); r += _c.r * w; g += _c.g * w; b += _c.b * w; }
    _c.setRGB(r, g, b);
    // altitude: alpine tint
    _c.lerp(PAL.montes.dry, sstep(130, 240, h) * .3);
    const rockKey = B.canion > .4 ? 'canion' : B.dragao > .4 ? 'dragao' : B.penhas > .4 ? 'penhas' : B.montes > .4 ? 'montes' : 'def';
    const RK = ROCK[rockKey];
    const sandW = sstep(1.7, .35, h) * sstep(.72, .92, ny) * (1 - B.pantano * .8);
    const steep = sstep(.83, .58, ny);
    const rockW = clamp(steep + sstep(230, 310, h) * sstep(.93, .72, ny) * .55 + B.canion * sstep(.95, .75, ny) * .8, 0, 1);
    const forestW = sstep(.42, .66, fd) * sstep(.4, 6, h) * sstep(.82, .95, ny) * (1 - rockW) * (1 - sstep(180, 250, h));
    const snowW = sstep(300, 345, h + (n2 - .5) * 50) * sstep(.74, .92, ny);
    const mudW = B.pantano * sstep(1.6, .2, h) * (1 - sandW);
    const grassW = Math.max(0, 1 - sandW - rockW - forestW - snowW - mudW);
    let R = _c.r * grassW, G = _c.g * grassW, Bb = _c.b * grassW;
    _c2.copy(FOREST).lerp(MOSS, n2); R += _c2.r * forestW; G += _c2.g * forestW; Bb += _c2.b * forestW;
    _c2.copy(RK[0]).lerp(RK[1], sstep(.3, .75, n2)); R += _c2.r * rockW; G += _c2.g * rockW; Bb += _c2.b * rockW;
    _c2.copy(WETSAND).lerp(SAND, sstep(-.5, 1.4, h)); R += _c2.r * sandW; G += _c2.g * sandW; Bb += _c2.b * sandW;
    R += SNOW.r * snowW; G += SNOW.g * snowW; Bb += SNOW.b * snowW;
    R += MUD.r * mudW; G += MUD.g * mudW; Bb += MUD.b * mudW;
    const tw = grassW + forestW + rockW + sandW + snowW + mudW + 1e-5;
    out.c = out.c || [0, 0, 0]; out.c[0] = R / tw; out.c[1] = G / tw; out.c[2] = Bb / tw;
    out.w = out.w || [0, 0, 0, 0, 0]; out.w[0] = grassW + mudW; out.w[1] = forestW; out.w[2] = rockW; out.w[3] = sandW; out.w[4] = snowW;
    out.fd = fd; out.B = B; out.canyon = B.canion; return out;
  }
  L.paint = paint;
  L.terrainSample = function (x, z, out) { const h = ground(x, z), sl = slope(x, z); out = out || {}; out.h = h; out.sl = sl; return paint(x, z, h, 1 / Math.sqrt(1 + sl * sl), out); };

  // ---------------------------------------------------------------- materials
  function terrainMaterial() {
    const T = L.T;
    const mat = new THREE.MeshStandardMaterial({ roughness: .96, metalness: 0, vertexColors: true });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { tGrass: { value: T.grass }, tGrassN: { value: T.grass_n }, tForest: { value: T.forest }, tForestN: { value: T.forest_n }, tRock: { value: T.rock }, tRockN: { value: T.rock_n }, tSand: { value: T.sand }, tSandN: { value: T.sand_n }, tSnow: { value: T.snow }, tSnowN: { value: T.snow_n } });
      sh.vertexShader = `attribute vec4 aSplat; attribute vec2 aExtra; varying vec4 vSplat; varying vec2 vExtra; varying vec3 vWp; varying vec3 vWn;\n` + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n vSplat=aSplat; vExtra=aExtra; vWp=(modelMatrix*vec4(position,1.)).xyz; vWn=normalize(mat3(modelMatrix)*normal);`);
      sh.fragmentShader = `uniform sampler2D tGrass,tGrassN,tForest,tForestN,tRock,tRockN,tSand,tSandN,tSnow,tSnowN; varying vec4 vSplat; varying vec2 vExtra; varying vec3 vWp; varying vec3 vWn;
        vec3 tri(sampler2D t, vec3 p, vec3 n, float s){vec3 b=abs(n);b=b*b*b;b/=b.x+b.y+b.z;return texture2D(t,p.yz*s).rgb*b.x+texture2D(t,p.xz*s).rgb*b.y+texture2D(t,p.xy*s).rgb*b.z;}\n` + sh.fragmentShader
        .replace('#include <map_fragment>', `
          float camd = length(vWp - cameraPosition);
          vec2 uvp=vWp.xz*0.12; vec2 uvp2=vWp.xz*0.027; const vec3 LW=vec3(.299,.587,.114);
          vec4 w=vSplat; float ws=vExtra.x; float tot=w.x+w.y+w.z+w.w+ws+1e-4; w/=tot; ws/=tot;
          float far = smoothstep(60., 260., camd);
          float dg=mix(dot(mix(texture2D(tGrass,uvp).rgb,texture2D(tGrass,uvp2*1.7+.3).rgb,.5),LW)/.483, dot(texture2D(tGrass,uvp2).rgb,LW)/.483, far);
          float df=dot(mix(texture2D(tForest,uvp*1.3).rgb,texture2D(tForest,uvp2*1.4).rgb,.4),LW)/.332;
          float dr=dot(mix(tri(tRock,vWp,vWn,0.06), tri(tRock,vWp,vWn,0.013), .45+far*.3),LW)/.468;
          float ds=dot(texture2D(tSand,uvp*1.2).rgb,LW)/.773; float dsn=dot(texture2D(tSnow,uvp*.6).rgb,LW)/.898;
          // sedimentary strata on rock faces (warmer/cooler bands)
          float strata = sin(vWp.y*.42 + sin(vWp.x*.013+vWp.z*.011)*3. + sin(vWp.x*.051-vWp.z*.043)*1.4) * .5 + .5; strata = smoothstep(.25,.75,strata);
          float strata2 = sin(vWp.y*1.7 + vWp.x*.03 + sin(vWp.z*.07)*2.) * .5 + .5;
          float det=mix(1.,dg,.32*(1.-far*.5))*w.x+mix(1.,df,.42)*w.y+mix(1.,dr,.6)*(mix(.92,1.06,strata)*mix(.96,1.03,strata2))*w.z+mix(1.,ds,.12)*w.w+mix(1.,dsn,.18)*ws;
          diffuseColor.rgb*=det;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.08,.95,.86), w.z*strata*vExtra.y*.6);
          // rock realism: broad warm/cool patches, vertical rain streaks, moss on the gentler ledges
          float rockN = texture2D(tRock, vWp.xz*.0021 + vec2(.3,.7)).g;
          float streak = texture2D(tRock, vec2((vWp.x + vWp.z)*.028, vWp.y*.0042)).r;
          vec3 rockTint = mix(vec3(1.08,.98,.86), vec3(.9,.95,1.03), smoothstep(.36,.62,rockN)) * mix(.72, 1.1, smoothstep(.28,.72,streak));
          diffuseColor.rgb *= mix(vec3(1.), rockTint, w.z);
          float mossW = w.z * smoothstep(.52, .8, vWn.y) * (1. - vExtra.y) * .7;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.15,.26,.08)*mix(.8,1.25,rockN), mossW);
          // distant greens slightly cooler and less saturated (aerial perspective, painterly)
          float lum = dot(diffuseColor.rgb, LW); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum)*vec3(.9,1.,1.08), smoothstep(250., 1400., camd)*.25);`)
        .replace('#include <normal_fragment_maps>', `
          vec3 nmix=texture2D(tGrassN,uvp).xyz*w.x+texture2D(tForestN,uvp*1.3).xyz*w.y+texture2D(tRockN,(abs(vWn.x)>abs(vWn.z)?vWp.zy:vWp.xy)*0.06).xyz*w.z+texture2D(tSandN,uvp*1.2).xyz*w.w+texture2D(tSnowN,uvp).xyz*ws;
          nmix=nmix*2.-1.; float nstr=(0.28+w.y*0.25+w.z*0.8)*(1.-far*.7);
          vec3 pn=normalize(vWn + vec3(nmix.x, 0., nmix.y)*nstr);
          normal=normalize((viewMatrix*vec4(pn,0.)).xyz);`);
      mat.userData.shader = sh;
    };
    mat.customProgramCacheKey = () => 'terrain-v4';
    return mat;
  }
  const fogU = THREE.UniformsLib.fog;
  L.waterU = { uTime: { value: 0 }, uShallow: { value: C(0x4fd8cf) }, uDeep: { value: C(0x14558f) }, uSky: { value: C(0xbfe3ff) }, uSun: { value: C(0xfff4d6) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 }, tN: { value: null } };
  function waterMaterial() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false, uniforms: THREE.UniformsUtils.merge([fogU, L.waterU]),
      vertexShader: `uniform float uTime;attribute float aDepth;varying float vD;varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){vec3 p=position;float d=clamp(aDepth,0.,1.);vec4 wp=modelMatrix*vec4(p,1.);
          wp.y+=(sin(wp.x*.3+uTime*1.1)*.05+sin(wp.z*.45+uTime*1.5)*.04+sin((wp.x+wp.z)*.2-uTime*.8)*.04)*d;vD=aDepth;vW=wp.xyz;vec4 mvPosition=viewMatrix*wp;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime,uDay;uniform vec3 uShallow,uDeep,uSky,uSun,uSunDir;uniform sampler2D tN;varying float vD;varying vec3 vW;
        #include <fog_pars_fragment>
        void main(){float d=clamp(vD/7.,0.,1.);
          vec3 n1=texture2D(tN,vW.xz*.045+vec2(uTime*.018,uTime*.011)).xyz*2.-1.;
          vec3 n2=texture2D(tN,vW.xz*.11-vec2(uTime*.013,-uTime*.02)).xyz*2.-1.;
          float camd=length(cameraPosition-vW); float calm=smoothstep(80.,600.,camd);
          vec3 n=normalize(vec3((n1.x+n2.x)*.35*(1.-calm*.7),1.,(n1.y+n2.y)*.35*(1.-calm*.7)));
          vec3 V=normalize(cameraPosition-vW);
          float fr=pow(1.-max(dot(n,V),0.),3.5);
          vec3 col=mix(uShallow,uDeep,d)*mix(.22,1.,uDay);
          col=mix(col,uSky*mix(.5,1.,uDay),fr*.7);
          vec3 Hh=normalize(V+normalize(uSunDir));float spec=pow(max(dot(n,Hh),0.),180.)*2.2+pow(max(dot(n,Hh),0.),24.)*.25;
          col+=uSun*spec*(.3+uDay*.7);
          float sp=smoothstep(.62,.75,(n1.z*.5+n2.z*.5)*.5+.5)*.3*uDay*(1.-calm);col+=uSun*sp*.6;
          float foam=smoothstep(.45,0.,vD)*.95+smoothstep(1.2,.1,vD)*smoothstep(.6,.72,texture2D(tN,vW.xz*.2+uTime*.03).z)*.6;
          col=mix(col,vec3(.95,.98,1.)*mix(.25,1.,uDay),clamp(foam,0.,1.)*.8);
          gl_FragColor=vec4(col,clamp(mix(.62,.95,d)+foam*.3+fr*.2,0.,1.));
        #include <fog_fragment>
        #include <encodings_fragment>
        }`
    });
    mat.uniforms.tN.value = L.T.water_n; L.waterU = mat.uniforms; return mat;
  }
  function flowMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false, side: THREE.DoubleSide, uniforms: THREE.UniformsUtils.merge([fogU, { uTime: { value: 0 }, uDay: { value: 1 }, tN: { value: L.T.water_n }, uSky: { value: C(0xbfe3ff) } }]),
      vertexShader: `attribute float aSteep;varying vec2 vUv;varying float vS;varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){vUv=uv;vS=aSteep;vec4 wp=modelMatrix*vec4(position,1.);vW=wp.xyz;vec4 mvPosition=viewMatrix*wp;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime,uDay;uniform sampler2D tN;uniform vec3 uSky;varying vec2 vUv;varying float vS;varying vec3 vW;
        #include <fog_pars_fragment>
        void main(){float sp=mix(.35,2.4,vS);
          vec3 n1=texture2D(tN,vec2(vUv.x*1.4,vUv.y*.25-uTime*sp*.08)).xyz*2.-1.;
          vec3 n2=texture2D(tN,vec2(vUv.x*3.1+.3,vUv.y*.6-uTime*sp*.16)).xyz*2.-1.;
          float f=smoothstep(.15,.75,(n1.z+n2.z)*.5*.5+.5);
          vec3 V=normalize(cameraPosition-vW);vec3 n=normalize(vec3((n1.x+n2.x)*.3,1.,(n1.y+n2.y)*.3));
          float fr=pow(1.-max(dot(n,V),0.),3.);
          vec3 c=mix(vec3(.22,.62,.72),uSky,fr*.6);
          vec3 white=vec3(.93,.97,1.);
          float streak=smoothstep(.3,.9,texture2D(tN,vec2(vUv.x*2.2,vUv.y*.08-uTime*.9)).z);
          c=mix(c,white,clamp(vS*(.75+streak*.5)+f*(.35+vS*.6),0.,1.));
          float edge=smoothstep(0.,.18,vUv.x)*smoothstep(1.,.82,vUv.x);c*=mix(.25,1.,uDay);
          gl_FragColor=vec4(c,(.74+vS*.26)*edge);
        #include <fog_fragment>
        #include <encodings_fragment>
        }`
    });
  }

  // ---------------------------------------------------------------- quadtree LOD terrain
  const ROOT = 4096, MAXLVL = 6, NSEG = 32; // level 6 = 64 m nodes with 2 m cells
  const nodes = new Map(); let visible = new Set(); const queue = []; let TMAT = null, WMAT = null;
  const group = new THREE.Group(); group.name = 'terrain'; L.terrainGroup = group;
  const nkey = (l, i, j) => l * 1e8 + (i + 4096) * 9000 + (j + 4096);
  const PS = {};
  function buildNode(l, i, j) {
    const size = ROOT / (1 << l), x0 = -ROOT / 2 + i * size, z0 = -ROOT / 2 + j * size, cs = size / NSEG, W = NSEG + 1, E = NSEG + 3;
    // extended height grid (one cell border) for normals
    const H = new Float32Array(E * E);
    const tile = l === MAXLVL ? getTile(Math.round(x0 / TS), Math.round(z0 / TS)) : null;
    for (let b = 0; b < E; b++) for (let a = 0; a < E; a++) {
      const ga = a - 1, gb = b - 1;
      H[b * E + a] = (tile && ga >= 0 && gb >= 0 && ga <= NSEG && gb <= NSEG) ? tile[gb * TW + ga] : rawH(x0 + ga * cs, z0 + gb * cs);
    }
    const nv = W * W + 4 * W; const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), spl = new Float32Array(nv * 4), ext = new Float32Array(nv * 2);
    let minH = 1e9, maxH = -1e9; const rnd = mulberry32(i * 31 + j * 17 + l);
    for (let b = 0; b < W; b++) for (let a = 0; a < W; a++) {
      const v = b * W + a, h = H[(b + 1) * E + a + 1], x = x0 + a * cs, z = z0 + b * cs;
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z; minH = Math.min(minH, h); maxH = Math.max(maxH, h);
      const hl = H[(b + 1) * E + a], hr = H[(b + 1) * E + a + 2], hd = H[b * E + a + 1], hu = H[(b + 2) * E + a + 1];
      let nx = (hl - hr) / (2 * cs), nz = (hd - hu) / (2 * cs); const nl = Math.hypot(nx, 1, nz); nx /= nl; nz /= nl; const ny = 1 / nl;
      nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
      // painting uses the finest-scale slope where we can afford it
      const P = paint(x, z, h, ny, PS); const vv = .97 + rnd() * .06;
      col[v * 3] = P.c[0] * vv; col[v * 3 + 1] = P.c[1] * vv; col[v * 3 + 2] = P.c[2] * vv;
      spl[v * 4] = P.w[0]; spl[v * 4 + 1] = P.w[1]; spl[v * 4 + 2] = P.w[2]; spl[v * 4 + 3] = P.w[3]; ext[v * 2] = P.w[4]; ext[v * 2 + 1] = P.canyon;
    }
    // skirts: duplicate border vertices pushed down
    const skirt = cs * 1.5 + 2; const border = []; for (let a = 0; a < W; a++) border.push(a); for (let b = 1; b < W; b++) border.push(b * W + NSEG); for (let a = NSEG - 1; a >= 0; a--) border.push(NSEG * W + a); for (let b = NSEG - 1; b >= 1; b--) border.push(b * W);
    // edges as 4 separate strips (avoid sharing corners)
    const idx = [];
    for (let b = 0; b < NSEG; b++) for (let a = 0; a < NSEG; a++) { const p = b * W + a, q = p + 1, r = p + W, s = r + 1; idx.push(p, r, q, q, r, s); }
    let sv = W * W;
    const edges = [[...Array(W).keys()].map(a => a), [...Array(W).keys()].map(b => b * W + NSEG), [...Array(W).keys()].map(a => NSEG * W + (NSEG - a)), [...Array(W).keys()].map(b => (NSEG - b) * W)];
    for (const e of edges) {
      const s0 = sv;
      for (const v of e) { pos[sv * 3] = pos[v * 3]; pos[sv * 3 + 1] = pos[v * 3 + 1] - skirt; pos[sv * 3 + 2] = pos[v * 3 + 2]; for (let k = 0; k < 3; k++) { nor[sv * 3 + k] = nor[v * 3 + k]; col[sv * 3 + k] = col[v * 3 + k]; } for (let k = 0; k < 4; k++) spl[sv * 4 + k] = spl[v * 4 + k]; ext[sv * 2] = ext[v * 2]; ext[sv * 2 + 1] = ext[v * 2 + 1]; sv++; }
      for (let k = 0; k < W - 1; k++) { const a = e[k], b = e[k + 1], c = s0 + k, d = s0 + k + 1; idx.push(a, b, c, b, d, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4)); g.setAttribute('aExtra', new THREE.BufferAttribute(ext, 2)); g.setIndex(idx);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, minH - skirt, z0), new THREE.Vector3(x0 + size, maxH, z0 + size)); g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(g, TMAT); m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.userData.lvl = l;
    const node = { mesh: m, water: null, l, i, j, x0, z0, size, minH, maxH };
    if (minH < .35) {
      const WN = l >= MAXLVL - 1 ? NSEG : NSEG / 2, ww = WN + 1, wcs = size / WN; const wp = new Float32Array(ww * ww * 3), wd = new Float32Array(ww * ww), wi = [];
      for (let b = 0; b < ww; b++) for (let a = 0; a < ww; a++) { const v = b * ww + a, x = x0 + a * wcs, z = z0 + b * wcs; wp[v * 3] = x; wp[v * 3 + 1] = 0; wp[v * 3 + 2] = z; const hh = (WN === NSEG) ? H[(b + 1) * E + a + 1] : H[(b * 2 + 1) * E + a * 2 + 1]; wd[v] = -hh; }
      for (let b = 0; b < WN; b++) for (let a = 0; a < WN; a++) { const p = b * ww + a, q = p + 1, r = p + ww, s = r + 1; if (wd[p] < -1.5 && wd[q] < -1.5 && wd[r] < -1.5 && wd[s] < -1.5) continue; wi.push(p, r, q, q, r, s); }
      if (wi.length) {
        const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wp, 3)); wg.setAttribute('aDepth', new THREE.BufferAttribute(wd, 1)); wg.setIndex(wi);
        wg.boundingBox = new THREE.Box3(new THREE.Vector3(x0, -1, z0), new THREE.Vector3(x0 + size, 1, z0 + size)); wg.boundingSphere = wg.boundingBox.getBoundingSphere(new THREE.Sphere());
        const wm = new THREE.Mesh(wg, WMAT); wm.renderOrder = 2; wm.matrixAutoUpdate = false; node.water = wm;
      }
    }
    return node;
  }
  function desired(cx, cy, cz) {
    const out = [];
    const hc = Math.max(0, cy - 40);
    const rec = (l, i, j) => {
      const size = ROOT / (1 << l), x0 = -ROOT / 2 + i * size, z0 = -ROOT / 2 + j * size;
      const dx = Math.max(x0 - cx, 0, cx - (x0 + size)), dz = Math.max(z0 - cz, 0, cz - (z0 + size)); const d = Math.hypot(dx, dz, hc * .7);
      if (l < MAXLVL && d < size * 1.3) { rec(l + 1, i * 2, j * 2); rec(l + 1, i * 2 + 1, j * 2); rec(l + 1, i * 2, j * 2 + 1); rec(l + 1, i * 2 + 1, j * 2 + 1); }
      else out.push({ k: nkey(l, i, j), l, i, j, d });
    };
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) rec(1, i, j);
    return out;
  }
  let lastWant = null, lastCam = [1e9, 1e9, 1e9];
  L.terrainInit = function () {
    TMAT = terrainMaterial(); WMAT = waterMaterial(); L.waterMat = WMAT; L.flowMat = flowMaterial();
    L.scene.add(group);
    // far ocean beyond the quadtree root
    const og = new THREE.RingGeometry(ROOT * .5 * 1.38, 30000, 64, 1); og.rotateX(-Math.PI / 2); og.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(og.attributes.position.count).fill(30), 1));
    const ocean = new THREE.Mesh(og, WMAT); ocean.renderOrder = 1; ocean.frustumCulled = false; L.scene.add(ocean);
    // square frame between the root square and the ring
    const fr = new THREE.PlaneGeometry(ROOT * 1.5, ROOT * 1.5, 1, 1); fr.rotateX(-Math.PI / 2); fr.translate(0, -.02, 0); fr.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(4).fill(30), 1));
    const ocean2 = new THREE.Mesh(fr, WMAT); ocean2.renderOrder = 0; ocean2.frustumCulled = false; ocean2.position.y = -1.2; L.scene.add(ocean2);
    buildFalls();
  };
  // returns true when the visible set matches the wanted set
  L.terrainUpdate = function (cam, budgetMs) {
    const cx = cam.x, cy = cam.y, cz = cam.z;
    if (Math.hypot(cx - lastCam[0], cz - lastCam[2]) > 6 || Math.abs(cy - lastCam[1]) > 15 || !lastWant) { lastWant = desired(cx, cy, cz); lastCam = [cx, cy, cz]; lastWant.sort((a, b) => a.d - b.d); }
    const t0 = performance.now(); let missing = 0;
    for (const w of lastWant) { if (nodes.has(w.k)) continue; if (performance.now() - t0 > budgetMs) { missing++; continue; } nodes.set(w.k, buildNode(w.l, w.i, w.j)); }
    for (const w of lastWant) if (!nodes.has(w.k)) missing++;
    if (missing) return false;
    // swap visible set
    const want = new Set(lastWant.map(w => w.k));
    for (const k of visible) if (!want.has(k)) { const n = nodes.get(k); if (n) { group.remove(n.mesh); if (n.water) group.remove(n.water); } }
    for (const k of want) if (!visible.has(k)) { const n = nodes.get(k); group.add(n.mesh); if (n.water) group.add(n.water); }
    visible = want; L.terrainMeshes = [...want].map(k => nodes.get(k).mesh);
    // evict far cached nodes
    if (nodes.size > 420) { for (const [k, n] of nodes) { if (want.has(k)) continue; const d = Math.hypot(n.x0 + n.size / 2 - cx, n.z0 + n.size / 2 - cz); if (d > n.size * 3 + 300) { n.mesh.geometry.dispose(); if (n.water) n.water.geometry.dispose(); nodes.delete(k); } } }
    return true;
  };
  L.terrainNodes = nodes;

  // ---------------------------------------------------------------- waterfalls (ribbons down the cirque walls) + river surface is the y=0 water
  function buildFalls() {
    L.fallMeshes = [];
    for (const f of FALLS) {
      const pts = f.pts; const pos = [], uv = [], st = [], idx = []; let acc = 0; const W = f.w; const px = -f.dz, pz = f.dx; // perpendicular
      for (let i = 0; i < pts.length; i++) {
        const [x, z, h] = pts[i]; const off = 1.2; const xx = x + f.dx * off, zz = z + f.dz * off; const y = Math.max(h, 0) + .4;
        if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], h - pts[i - 1][2]);
        const steep = i > 0 ? clamp(Math.abs(h - pts[i - 1][2]) / 2 / 1.2, 0, 1) : 0; const ww = W * (1 + i / pts.length * .5);
        pos.push(xx - px * ww / 2, y, zz - pz * ww / 2, xx + px * ww / 2, y, zz + pz * ww / 2); uv.push(0, acc * .1, 1, acc * .1); st.push(steep, steep);
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      // fix first steepness
      if (st.length > 2) { st[0] = st[2]; st[1] = st[3]; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aSteep', new THREE.Float32BufferAttribute(st, 1)); g.setIndex(idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, L.flowMat); m.renderOrder = 3; L.scene.add(m); L.fallMeshes.push(m);
    }
  }

  // ---------------------------------------------------------------- world map (progressive) — 384² canvas, 8 m / pixel
  L.MAPRES = 384;
  L.mapCanvas = document.createElement('canvas'); L.mapCanvas.width = L.mapCanvas.height = L.MAPRES;
  let mapRow = 0; const mapCtx = L.mapCanvas.getContext('2d'); const mapImg = mapCtx.createImageData(L.MAPRES, 1); const mapH = new Float32Array(L.MAPRES * L.MAPRES);
  const toS = v => Math.round(255 * clamp(v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - .055, 0, 1));
  L.mapStep = function (budgetMs) {
    const R = L.MAPRES; if (mapRow >= R) return true; const t0 = performance.now(); const span = WS * 2 / R; const P = {};
    while (mapRow < R && performance.now() - t0 < budgetMs) {
      const z = -WS + (mapRow + .5) * span;
      for (let a = 0; a < R; a++) { const x = -WS + (a + .5) * span; mapH[mapRow * R + a] = rawH(x, z); }
      for (let a = 0; a < R; a++) {
        const x = -WS + (a + .5) * span, z0 = -WS + (mapRow + .5) * span, h = mapH[mapRow * R + a];
        const hu = mapRow > 0 ? mapH[(mapRow - 1) * R + a] : h, hl = a > 0 ? mapH[mapRow * R + a - 1] : h;
        const sl = Math.hypot(h - hu, h - hl) / span; const ny = 1 / Math.sqrt(1 + sl * sl);
        let r, g, b;
        if (h < 0) { const d = clamp(-h / 12, 0, 1); r = lerp(.33, .08, d); g = lerp(.78, .32, d); b = lerp(.82, .62, d); }
        else { paint(x, z0, h, ny, P); r = P.c[0]; g = P.c[1]; b = P.c[2]; const fd = P.w[1]; r *= 1 - fd * .25; g *= 1 - fd * .15; b *= 1 - fd * .25; }
        const shade = clamp(1 + ((hl - h) + (hu - h)) / span * 1.6, .45, 1.45); const alt = h > 0 ? 1 + clamp(h / 400, 0, .25) : 1;
        mapImg.data[a * 4] = toS(r * shade * alt); mapImg.data[a * 4 + 1] = toS(g * shade * alt); mapImg.data[a * 4 + 2] = toS(b * shade * alt); mapImg.data[a * 4 + 3] = 255;
      }
      mapCtx.putImageData(mapImg, 0, mapRow); mapRow++;
    }
    return mapRow >= R;
  };
  L.mapDone = () => mapRow >= L.MAPRES;
})(window.L);
