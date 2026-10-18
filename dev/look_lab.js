/* Look Lab (dev only): synthetic scenes that reproduce the concept references with the v5 look modules.
   ?p=a|b|c   a = terraço da vila + paredão com 3 cachoeiras (d959254a)
              b = vale + cidade alta no planalto + mar (57faf138)
              c = terceira pessoa no prado junto à cerca acima do mar de nuvens (be82a764)
   ?t=day|golden|night|rain|dawn   ?q=alto|medio|baixo   ?hud=1
   window.step(n) renders n frames and returns render stats; window.ready is set once the first frame is drawn. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep, C } = L;
  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  const QS = new URLSearchParams(location.search);
  const PRESET = (QS.get('p') || 'a').toLowerCase(), TODN = QS.get('t') || 'day';
  if (QS.get('hud')) document.body.classList.add('hud');

  // ================================================================ noise
  function h2(i, j, s) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vn(x, z, s) { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); const a = h2(i, j, s), b = h2(i + 1, j, s), c = h2(i, j + 1, s), d = h2(i + 1, j + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
  function fbm(x, z, o, s) { let t = 0, a = .5, n = 0; for (let k = 0; k < o; k++) { t += a * vn(x, z, (s | 0) + k * 31); n += a; a *= .5; x = x * 2.03 + 17.1; z = z * 2.03 - 9.7; } return t / n; }
  function rnd(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ================================================================ shapes
  function sdPoly(x, z, P) {
    let d = Infinity, inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ax = P[j][0], az = P[j][1], bx = P[i][0], bz = P[i][1], ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
      const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1), dx = wx - ex * t, dz = wz - ez * t; d = Math.min(d, dx * dx + dz * dz);
      if ((az > z) !== (bz > z) && x < ax + (z - az) * ex / ez) inside = !inside;
    }
    return inside ? Math.sqrt(d) : -Math.sqrt(d);
  }
  function bounds(P) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return [x0, z0, x1, z1]; }
  function distSeg(x, z, ax, az, bx, bz) { const ex = bx - ax, ez = bz - az, t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1); return Math.hypot(x - ax - ex * t, z - az - ez * t); }
  function distLine(x, z, P) { let d = Infinity; for (let i = 0; i < P.length - 1; i++) d = Math.min(d, distSeg(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1])); return d; }

  // ================================================================ the synthetic world
  const SEA = -28;
  const OB = [-6500, 0];                 // origin of area B (valley + high town)
  const rel = (P, o) => P.map(p => [p[0] + o[0], p[1] + o[1]]);
  // area A: village terrace (140 m), lower terrace (128 m), tilted plateau with a 250-450 m cliff
  const T_A = [[-2600, 1300], [-2600, -1700], [120, -1700], [150, -620], [176, -430], [150, -250], [182, -120], [168, 40], [182, 220], [160, 420], [120, 700], [40, 1300]];
  const T2 = [[100, -235], [205, -228], [300, -300], [338, -400], [292, -488], [190, -530], [96, -470]];
  const PA = [[-980, -620], [-640, -760], [-260, -850], [120, -760], [361, -657], [470, -920], [430, -1500], [-200, -1900], [-1150, -1500]];
  const PA_W = [-980, -640], PA_R = [361, -657];
  const FALLS_A = [.66, .73, .78];       // along the cliff edge (-260,-850) -> (361,-657)
  // area B (relative to OB)
  const B_L = rel([[-3300, 1700], [-3300, -5400], [400, -5400], [700, -4400], [560, -1500], [470, -700], [430, 400], [300, 1700]], OB);
  const B_S = rel([[620, -1560], [1180, -1330], [1650, -1720], [1720, -2320], [1250, -2700], [700, -2480], [560, -2000]], OB);
  const B_U = rel([[1150, -1650], [2100, -1250], [2900, -1350], [3500, -3300], [2200, -4300], [1100, -3500], [1350, -2700], [1700, -2300], [1650, -1750]], OB);
  // distant mesas (circles): [cx, cz, r, top, cliff width, warp, seed]
  const FAR = [[2700, -2500, 620, 270, 10, 90, 3], [3900, -800, 420, 210, 10, 70, 4], [2100, -4300, 900, 520, 14, 140, 5], [4700, -3900, 700, 340, 12, 110, 6], [-2400, -4300, 1000, 580, 16, 150, 7],
    [OB[0] + 5200, OB[1] - 3600, 1700, 760, 420, 300, 8], [OB[0] - 1200, OB[1] - 6200, 1900, 640, 600, 300, 9], [OB[0] + 2600, OB[1] - 7200, 1500, 820, 500, 260, 10]];

  const M = [];
  function mesa(o) { o.bb = o.poly ? bounds(o.poly) : [o.cx - o.r, o.cz - o.r, o.cx + o.r, o.cz + o.r]; o.foot = o.foot || 160; M.push(o); return o; }
  function warp(x, z, amp, s) { return [x + amp * (fbm(x * .0031 + s, z * .0031, 3, s) - .5) * 2 + amp * .35 * (vn(x * .019, z * .019, s + 5) - .5) * 2, z + amp * (fbm(x * .0031 - s, z * .0031 + 7, 3, s + 9) - .5) * 2 + amp * .35 * (vn(x * .019 + 3, z * .019, s + 6) - .5) * 2]; }
  // A terrace
  mesa({ poly: T_A, warp: 28, seed: 11, w: 8, top(x, z) {
    let h = 140 + .1 * Math.max(0, z + 60) + .07 * Math.max(0, -x - 80) + (fbm(x * .006, z * .006, 3, 2) - .5) * 9 + (fbm(x * .03, z * .03, 2, 3) - .5) * 1.6;
    h += 4.5 * Math.exp(-((x + 22) ** 2 + (z - 6) ** 2) / (2 * 11 * 11));                 // mound left of the camera (ref foreground)
    h -= 1.2 * Math.exp(-((x + 4) ** 2 + (z + 82) ** 2) / (2 * 40 * 40));                 // village floor
    return h;
  } });
  mesa({ poly: T2, warp: 18, seed: 12, w: 7, top(x, z) { return 128 + (fbm(x * .01, z * .01, 2, 4) - .5) * 5; } });
  mesa({ poly: PA, warp: 46, seed: 13, w: 0, foot: 260, top(x, z, d) {
    const s = clamp(((x - PA_W[0]) * (PA_R[0] - PA_W[0]) + (z - PA_W[1]) * (PA_R[1] - PA_W[1])) / ((PA_R[0] - PA_W[0]) ** 2 + (PA_R[1] - PA_W[1]) ** 2), 0, 1.1);
    return 150 + 300 * Math.pow(s, 1.15) + Math.min(Math.max(d, 0) * .12, 70) + (fbm(x * .004, z * .004, 3, 6) - .5) * 26;
  }, wf(top) { return lerp(150, 7, sstep(25, 120, top - 140)); } });
  // B
  mesa({ poly: B_L, warp: 60, seed: 21, w: 26, top(x, z) {
    const rx = x - OB[0], rz = z - OB[1];
    let h = 150 + 200 * sstep(-760, 260, rz) + (fbm(x * .004, z * .004, 4, 8) - .5) * 60 * sstep(-200, -900, rz);
    h += 260 * sstep(-500, -2700, rx) * (.55 + .45 * fbm(x * .002, z * .002, 3, 9));
    h += 340 * sstep(-3000, -5000, rz) * fbm(x * .0018, z * .0018, 4, 10);
    h -= 135 * sstep(-100, 430, rx) * sstep(-300, -900, rz);
    h += (fbm(x * .02, z * .02, 2, 11) - .5) * 4;
    return h;
  } });
  mesa({ poly: B_S, warp: 30, seed: 22, w: 8, top(x, z) { return 330 + (fbm(x * .006, z * .006, 3, 12) - .5) * 10; } });
  mesa({ poly: B_U, warp: 60, seed: 23, w: 9, foot: 300, top(x, z, d) { return 640 + Math.min(Math.max(d, 0) * .05, 50) + (fbm(x * .003, z * .003, 3, 13) - .5) * 40; } });
  for (const f of FAR) mesa({ cx: f[0], cz: f[1], r: f[2], warp: f[5], seed: f[6], w: f[4], foot: Math.max(200, f[4] * 1.2), top(x, z, d) { return f[3] + (fbm(x * .002, z * .002, 3, f[6]) - .5) * f[3] * .25 + (f[4] > 100 ? -f[3] * .25 * (1 - sstep(0, f[2] * .6, d)) : 0); } });

  function mesaH(o, x, z) {
    const b = o.bb, F = o.foot + o.warp * 1.4;
    if (x < b[0] - F || x > b[2] + F || z < b[1] - F || z > b[3] + F) return -1e9;
    const [wx, wz] = warp(x, z, o.warp, o.seed);
    const d = o.poly ? sdPoly(wx, wz, o.poly) : o.r - Math.hypot(wx - o.cx, wz - o.cz);
    if (d < -o.foot) return -1e9;
    const top = o.top(x, z, d);
    const w = o.wf ? o.wf(top) : o.w;
    const dn = d + (vn(x * .05, z * .05, o.seed + 40) - .5) * Math.min(w, 8) * .8;
    const p = sstep(-w * .5, w * .5, dn);
    let h = SEA + (top - SEA) * p;
    if (dn < 0) h += (top - SEA) * .1 * Math.exp(dn / (24 + w));          // talus at the foot
    return h;
  }
  // paths (polylines) per area
  const PATHS = [
    [[6, 30], [2, -8], [-6, -40], [-6, -62], [-30, -120], [-90, -190], [-180, -260], [-300, -330], [-420, -380], [-560, -470]],
    [[-6, -62], [30, -70], [80, -60], [130, -40]],
    rel([[10, 340], [6, 250], [-20, 120], [-60, 0], [-40, -160], [30, -320], [-60, -520], [-160, -700], [-90, -900], [60, -1100], [-20, -1400]], OB),
    rel([[-60, 0], [-260, -60], [-480, -40], [-760, -140]], OB),
  ];
  const PATH_BB = PATHS.map(bounds);
  function pathW(x, z) {
    let d = Infinity; for (let k = 0; k < PATHS.length; k++) { const b = PATH_BB[k]; if (x < b[0] - 20 || x > b[2] + 20 || z < b[1] - 20 || z > b[3] + 20) continue; d = Math.min(d, distLine(x, z, PATHS[k])); }
    return d === Infinity ? 0 : sstep(2.6, .9, d + (vn(x * .4, z * .4, 77) - .5) * 1.2);
  }
  function labH(x, z) {
    let h = SEA + (fbm(x * .001, z * .001, 2, 1) - .5) * 16;
    for (const o of M) { const v = mesaH(o, x, z); if (v > h) h = v; }
    const pw = pathW(x, z); if (pw > 0) h -= pw * .12;
    return h;
  }
  L.labH = labH;
  // forest density (pine patches) used by the tree placement and the ground paint
  function forestN(x, z) { return fbm(x * .006 + 40, z * .006 - 13, 3, 55); }
  function inB(x) { return x < -3300; }

  // ground tint (linear, the lit colour WORLD would paint) + layer weights
  const COL = { meadow: C(0xc6c254), plateau: C(0xb4c051), valley: C(0xb9cc5c), dry: C(0xcdbf63), rockTint: C(0xa49c8c) };
  const _pc = new THREE.Color();
  function paint(x, z, h, ny, out) {
    out = out || {};
    const rock = sstep(.84, .62, ny + (vn(x * .08, z * .08, 91) - .5) * .08);
    const path = pathW(x, z) * (1 - rock);
    const sand = (1 - rock) * sstep(5.5, 2.5, h) * sstep(-4, -1, h);
    const snow = sstep(880, 1000, h) * sstep(.55, .8, ny);
    let forest = 0;
    if (inB(x)) forest = sstep(.56, .66, forestN(x, z)) * sstep(420, 300, h) * (1 - rock);
    _pc.copy(inB(x) ? COL.valley : h > 200 ? COL.plateau : COL.meadow);
    if (inB(x)) _pc.lerp(COL.dry, sstep(.55, .75, fbm(x * .003, z * .003, 2, 19)) * .5);
    _pc.multiplyScalar(.94 + .12 * vn(x * .01, z * .01, 33));
    out.c = out.c || [0, 0, 0]; out.c[0] = _pc.r; out.c[1] = _pc.g; out.c[2] = _pc.b;
    out.rock = rock; out.path = path; out.sand = sand; out.snow = snow; out.forest = forest; out.wet = 0;
    out.meadow = clamp(1 - rock - path - sand - snow, 0, 1); out.region = inB(x) ? (h > 300 ? 6 : 0) : 0;
    return out;
  }
  // WORLD contract stand-ins for grass and the lab
  const E = 1.0;
  L.ground = labH;
  L.slope = (x, z) => { const hx = labH(x + E, z) - labH(x - E, z), hz = labH(x, z + E) - labH(x, z - E); return Math.hypot(hx, hz) / (2 * E); };
  L.waterAt = (x, z) => labH(x, z) < 0 ? 0 : -Infinity;
  L.terrainSample = function (x, z, out) {
    const h = labH(x, z), hx = labH(x + E, z) - labH(x - E, z), hz = labH(x, z + E) - labH(x, z - E), sl = Math.hypot(hx, hz) / (2 * E);
    out = paint(x, z, h, 1 / Math.sqrt(1 + sl * sl), out || {}); out.h = h; out.sl = sl; return out;
  };

  // ================================================================ presets
  const PRE = {
    a: { pos: [0, 0], eye: 1.35, yaw: 7, pitch: 5.4, fov: 35, sunAz: 2.41, focus: [0, -55], size: [1400, 598], ref: 'd959254a' },
    b: { pos: [OB[0], OB[1] + 300], eye: 1.7, yaw: 5, pitch: -6.2, fov: 40, sunAz: -2.55, focus: null, size: [1400, 650], ref: '57faf138' },
    c: { pos: [156.9, 239], eye: 2.5, yaw: -8, pitch: -9, fov: 50, sunAz: .88, focus: [156, 228], size: [1357, 781], ref: 'be82a764', hero: [156, 232] },
  };
  const P = PRE[PRESET] || PRE.a;
  L.LAB = { preset: PRESET, P, PRE };

  // ================================================================ terrain mesh: warped grid centred on the camera
  function axis(N, S, k) { const a = new Float64Array(N + 1), ek = Math.exp(k) - 1; for (let i = 0; i <= N; i++) { const u = i / N * 2 - 1; a[i] = Math.sign(u) * S * (Math.exp(k * Math.abs(u)) - 1) / ek; } return a; }
  function buildTerrain(cx, cz) {
    const N = L.quality === 'baixo' ? 420 : 560, S = 14000, k = 5.0;
    const ax = axis(N, S, k), n1 = N + 1, nv = n1 * n1;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), aT = new Float32Array(nv * 4), aU = new Float32Array(nv * 2);
    for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) { const o = (j * n1 + i) * 3, x = cx + ax[i], z = cz + ax[j]; pos[o] = x; pos[o + 1] = labH(x, z); pos[o + 2] = z; }
    const Y = (i, j) => pos[(clamp(j, 0, N) * n1 + clamp(i, 0, N)) * 3 + 1];
    const tmp = {};
    for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
      const o = (j * n1 + i), x = pos[o * 3], z = pos[o * 3 + 2];
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, N), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, N);
      const dx = ax[i1] - ax[i0], dz = ax[j1] - ax[j0];
      const gx = (Y(i1, j) - Y(i0, j)) / dx, gz = (Y(i, j1) - Y(i, j0)) / dz; const il = 1 / Math.sqrt(gx * gx + gz * gz + 1);
      nor[o * 3] = -gx * il; nor[o * 3 + 1] = il; nor[o * 3 + 2] = -gz * il;
      const pt = paint(x, z, pos[o * 3 + 1], il, tmp);
      col[o * 3] = pt.c[0]; col[o * 3 + 1] = pt.c[1]; col[o * 3 + 2] = pt.c[2];
      aT[o * 4] = pt.rock; aT[o * 4 + 1] = pt.path; aT[o * 4 + 2] = pt.sand; aT[o * 4 + 3] = pt.snow; aU[o * 2] = pt.forest; aU[o * 2 + 1] = pt.wet;
    }
    const idx = new Uint32Array(N * N * 6); let q = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      if (Math.abs(pos[a * 3 + 1] - pos[d * 3 + 1]) < Math.abs(pos[b * 3 + 1] - pos[c * 3 + 1])) { idx[q++] = a; idx[q++] = c; idx[q++] = d; idx[q++] = a; idx[q++] = d; idx[q++] = b; }
      else { idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(aT, 4)); g.setAttribute('aU', new THREE.BufferAttribute(aU, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, L.makeTerrainMaterial()); m.receiveShadow = true; m.castShadow = true; m.name = 'terrain'; m.frustumCulled = false;
    L.scene.add(m); return m;
  }
  function buildOcean(cx, cz) {
    const N = 200, S = 15000, ax = axis(N, S, 4.2), n1 = N + 1; const pos = new Float32Array(n1 * n1 * 3), dep = new Float32Array(n1 * n1);
    for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) { const o = j * n1 + i, x = cx + ax[i], z = cz + ax[j]; pos[o * 3] = x; pos[o * 3 + 1] = 0; pos[o * 3 + 2] = z; dep[o] = clamp(-labH(x, z), -5, 60); }
    const idx = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * n1 + i; idx.push(a, a + n1, a + 1, a + 1, a + n1, a + n1 + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1)); g.setIndex(idx);
    const m = new THREE.Mesh(g, L.makeWaterMaterial({ ocean: true })); m.renderOrder = 2; m.frustumCulled = false; m.name = 'ocean'; L.scene.add(m); return m;
  }

  // ================================================================ procedural buildings (vertex coloured, MAT.v5)
  const K = { wall: C(0xf1e5cb), wall2: C(0xe9d9b8), roof: C(0xcf5839), roof2: C(0xb9472f), roofD: C(0x8e3524), wood: C(0x8a5c3c), win: C(0x34404e), frame: C(0xf7f2e6), brick: C(0xd59a80), stone: C(0xc9bba2), door: C(0x3f8f8c), fence: C(0x8b6440), fence2: C(0x6f4e32) };
  class GB {
    constructor() { this.P = []; this.N = []; this.Cc = []; }
    tri(a, b, c, col, na, nb, nc) {
      this.P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      if (!na) { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; na = nb = nc = [nx / l, ny / l, nz / l]; }
      this.N.push(...na, ...nb, ...nc); for (let k = 0; k < 3; k++) this.Cc.push(col.r, col.g, col.b);
    }
    quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
    // axis-aligned box rotated by ry about (x,z); y = bottom
    box(x, y, z, w, h, d, col, ry, colTop) {
      const cs = Math.cos(ry || 0), sn = Math.sin(ry || 0); const p = (u, v, t) => [x + u * cs + t * sn, y + v, z - u * sn + t * cs];
      const hw = w / 2, hd = d / 2;
      const v = [p(-hw, 0, -hd), p(hw, 0, -hd), p(hw, 0, hd), p(-hw, 0, hd), p(-hw, h, -hd), p(hw, h, -hd), p(hw, h, hd), p(-hw, h, hd)];
      this.quad(v[3], v[2], v[6], v[7], col); this.quad(v[1], v[0], v[4], v[5], col); this.quad(v[2], v[1], v[5], v[6], col); this.quad(v[0], v[3], v[7], v[4], col); this.quad(v[7], v[6], v[5], v[4], colTop || col);
    }
    lathe(x, y, z, prof, seg, colFn) {
      for (let k = 0; k < prof.length - 1; k++) {
        const [r0, y0] = prof[k], [r1, y1] = prof[k + 1]; const col = colFn(k, prof.length - 1); const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1; const ny = -dr / l, nr = dy / l;
        for (let s = 0; s < seg; s++) {
          const a0 = s / seg * TAU, a1 = (s + 1) / seg * TAU; const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
          const A = [x + c0 * r0, y + y0, z + s0 * r0], B = [x + c1 * r0, y + y0, z + s1 * r0], Cq = [x + c1 * r1, y + y1, z + s1 * r1], D = [x + c0 * r1, y + y1, z + s0 * r1];
          const n0 = [c0 * nr, ny, s0 * nr], n1 = [c1 * nr, ny, s1 * nr];
          this.tri(A, Cq, B, col, n0, n1, n1); this.tri(A, D, Cq, col, n0, n0, n1);
        }
      }
    }
    // gable roof, ridge along local x; y = eave height; curved (slightly concave) tiled slopes
    roof(x, y, z, w, d, rise, ry, o, cA, cB) {
      const cs = Math.cos(ry || 0), sn = Math.sin(ry || 0); const p = (u, v, t) => [x + u * cs + t * sn, y + v, z - u * sn + t * cs];
      o = o == null ? .7 : o; const hw = w / 2 + o * .6, hd = d / 2 + o, S = 6;
      const yAt = t => rise * (1 - hd * (1 - t) / (d / 2)) - Math.sin(Math.PI * t) * rise * .06;
      for (const side of [-1, 1]) {
        for (let k = 0; k < S; k++) {
          const t0 = k / S, t1 = (k + 1) / S, z0 = side * hd * (1 - t0), z1 = side * hd * (1 - t1), y0 = yAt(t0), y1 = yAt(t1);
          const col = k === 0 ? cB : (k % 2 ? cA : cB);
          const a = p(-hw, y0, z0), b = p(hw, y0, z0), c = p(hw, y1, z1), dd = p(-hw, y1, z1);
          if (side > 0) this.quad(a, b, c, dd, col); else this.quad(b, a, dd, c, col);
        }
        const e0 = yAt(0), f0 = p(-hw, e0, side * hd), f1 = p(hw, e0, side * hd), f2 = p(hw, e0 - .3, side * hd), f3 = p(-hw, e0 - .3, side * hd);
        if (side > 0) this.quad(f3, f2, f1, f0, K.roofD); else this.quad(f2, f3, f0, f1, K.roofD);
      }
      for (const e of [-1, 1]) { const u = e * w / 2; const a = p(u, 0, -d / 2), b = p(u, 0, d / 2), c = p(u, rise, 0); if (e > 0) this.tri(a, c, b, K.wall2); else this.tri(b, c, a, K.wall2); }
      // verge boards along the gable ends
      for (const e of [-1, 1]) { const u = e * hw; for (const side of [-1, 1]) { const a = p(u, yAt(0), side * hd), b = p(u, yAt(1), 0), c = p(u, yAt(1) - .3, 0), dd = p(u, yAt(0) - .3, side * hd); if (e * side > 0) this.quad(a, dd, c, b, K.roofD); else this.quad(a, b, c, dd, K.roofD); } }
    }
    win(x, y, z, w, h, ry, out) { // window on a wall facing direction ry (normal = (sin ry, 0, cos ry)), out = offset from wall
      const cs = Math.cos(ry), sn = Math.sin(ry); const nx = sn, nz = cs; const tx = cs, tz = -sn;
      const P = (u, v, e) => [x + tx * u + nx * (out + e), y + v, z + tz * u + nz * (out + e)];
      this.quad(P(-w / 2 - .18, -.18, 0), P(w / 2 + .18, -.18, 0), P(w / 2 + .18, h + .18, 0), P(-w / 2 - .18, h + .18, 0), K.frame);
      this.quad(P(-w / 2, 0, .03), P(w / 2, 0, .03), P(w / 2, h, .03), P(-w / 2, h, .03), K.win);
    }
    geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.Cc, 3)); g.computeBoundingSphere(); return g; }
  }
  const houses = new GB();
  function house(x, z, ry, w, d, h, rise, opts) {
    opts = opts || {}; const y = labH(x, z) - .6; const r = rnd(Math.floor(x * 7 + z * 13));
    houses.box(x, y - 2, z, w, h + 2, d, opts.wall || K.wall, ry);
    const roofA = opts.roof || (r() < .5 ? K.roof : K.roof2);
    houses.roof(x, y + h, z, w, d, rise, ry, .7, roofA, roofA === K.roof ? K.roof2 : K.roof);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    if (opts.chimney !== false) { const u = (r() - .5) * w * .5, t = -d * .2; houses.box(x + u * cs + t * sn, y + h, z - u * sn + t * cs, 1.2, rise + 1.8, 1.2, K.brick, ry); }
    // windows on the two long faces + a door
    for (const side of [1, -1]) {
      const fx = x + side * (d / 2) * sn, fz = z + side * (d / 2) * cs; const n = Math.max(1, Math.floor(w / 3.2));
      for (let k = 0; k < n; k++) { const u = (k - (n - 1) / 2) * 3.0; if (side > 0 && k === Math.floor(n / 2) && opts.door !== false) { houses.win(fx + u * cs, y + .6, fz - u * sn, 1.2, 2.2, ry + (side > 0 ? 0 : Math.PI), .02); continue; } houses.win(fx + u * cs, y + h * .45, fz - u * sn, .9, 1.2, ry + (side > 0 ? 0 : Math.PI), .02); }
    }
  }
  function tower(x, z, r, h, roofH, opts) {
    opts = opts || {}; const y = labH(x, z) - .8; const seg = 22;
    houses.lathe(x, y - 2, z, [[r * 1.04, 0], [r, h * .3 + 2], [r * .97, h + 2]], seg, () => opts.wall || K.wall);
    if (opts.skirt) { houses.lathe(x, y + h * .55, z, [[r + 1.3, 0], [r * .9, 2.2]], seg, () => K.roof); }
    houses.lathe(x, y + h, z, [[r + .6, 0], [r * .82, roofH * .45], [r * .45, roofH * .8], [.12, roofH], [0, roofH + .02]], seg, k => k % 2 ? K.roof2 : K.roof);
    houses.lathe(x, y + h + roofH, z, [[.16, 0], [.12, 2.2], [0, 2.3]], 6, () => K.wood);
    const nw = Math.max(2, Math.floor(h / 5)); for (let k = 0; k < nw; k++) { const a = (k * 1.7 + (opts.face || 0)); houses.win(x + Math.sin(a) * r, y + 3 + k * (h - 4) / nw, z + Math.cos(a) * r, .8, 1.2, a, 0); }
  }
  function towerHouse(x, z) {   // the concept-art composition: hall + wing + round tower with a red skirt roof
    house(x, z, 0, 16, 10, 8, 6.5, { door: true });
    house(x - 11, z + 3, Math.PI / 2, 8, 9, 6, 4.5, {});
    house(x + 2, z + 8, 0, 7, 5, 4.5, 3.5, { chimney: false });
    tower(x + 7.5, z - 1, 4.6, 18, 8.5, { skirt: true, face: .2 });
    const y = labH(x, z); houses.box(x - 4, y + 6, z - 2, 1.5, 9, 1.5, K.brick); houses.box(x - 3.4, y + 6, z - 2.6, 1.1, 10, 1.1, K.brick);
  }
  const fences = new GB();
  function fence(pts, step) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1]; const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step)); const ry = Math.atan2(bx - ax, bz - az);
      for (let s = 0; s <= n; s++) { if (k > 0 && s === 0) continue; const t = s / n, x = lerp(ax, bx, t), z = lerp(az, bz, t), y = labH(x, z) - .2; fences.box(x, y, z, .2, 1.35, .2, K.fence, ry); }
      for (let s = 0; s < n; s++) {
        const t0 = s / n, t1 = (s + 1) / n, x0 = lerp(ax, bx, t0), z0 = lerp(az, bz, t0), x1 = lerp(ax, bx, t1), z1 = lerp(az, bz, t1);
        for (const hh of [.55, 1.05]) { const y0 = labH(x0, z0) - .2 + hh, y1 = labH(x1, z1) - .2 + hh; const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, l = Math.hypot(x1 - x0, z1 - z0); fences.box(cx, (y0 + y1) / 2 - .07, cz, .1, .16, l + .1, hh > 1 ? K.fence : K.fence2, ry); }
      }
    }
  }

  // ================================================================ trees (v4 models + v5 foliage cards)
  const TREE_KINDS = { pine: { n: 70, size: [1.05, 1.55], quads: [2], inset: .2, upright: true, H: [10, 17] }, oak: { n: 96, size: [1.5, 2.3], quads: [0, 1], H: [7, 11] } };
  const treeGeo = {};
  function prepTrees() {
    const partOf = n => n === 'canopy' ? 'canopy' : 'bark';
    for (const k in TREE_KINDS) {
      const A = TREE_KINDS[k]; const hi = L.flatten('tree_' + k, partOf), lo = L.flatten('tree_' + k + '_lo', partOf);
      hi.canopy.computeBoundingBox(); const bb = hi.canopy.boundingBox;
      treeGeo[k] = {
        hi: { canopy: L.canopyCards(hi.canopy, Object.assign({ seed: 17 + k.length * 7 }, A)), bark: hi.bark },
        lo: { canopy: L.canopyCards(lo.canopy || hi.canopy, Object.assign({}, A, { seed: 91, n: Math.ceil(A.n * .34), size: [A.size[0] * 1.5, A.size[1] * 1.6], inset: .12 })), bark: lo.bark || hi.bark },
        h: bb.max.y,
      };
    }
  }
  const TREES = [];   // {k, x, z, h, tint}
  const TINT = { pine: [C(0x4c7a4c), C(0x3f6a45), C(0x5a8653)], oak: [C(0x7aa64c), C(0x6c9a45), C(0x8db456)] };
  function addTree(k, x, z, h, r) { if (labH(x, z) < 1) return; const T = TINT[k]; TREES.push({ k, x, z, h, tint: T[Math.floor(r() * T.length)] }); }
  function scatterTrees() {
    const r = rnd(5);
    // A: pines left of the village, round trees around it, pines on the plateau rim and the lower terrace
    for (let i = 0; i < 70; i++) { const x = -150 + r() * 110, z = -190 + r() * 150; if (Math.hypot(x + 4, z + 80) < 26 || pathW(x, z) > .1) continue; if (fbm(x * .02, z * .02, 2, 3) < .42) continue; addTree('pine', x, z, lerp(11, 18, r()), r); }
    for (let i = 0; i < 26; i++) { const x = -70 + r() * 130, z = -140 + r() * 90; if (Math.hypot(x + 4, z + 80) < 22 || Math.hypot(x + 15, z + 77) < 12 || pathW(x, z) > .1 || x > 50) continue; addTree('oak', x, z, lerp(6, 10, r()), r); }
    for (let i = 0; i < 260; i++) { const t = r(), x = lerp(-640, 361, t) + (r() - .5) * 60, z = lerp(-760, -657, t) - 30 - r() * 200; const h = labH(x, z); if (h < 220 || L.slope(x, z) > .5) continue; if (fbm(x * .01, z * .01, 2, 4) < .5) continue; addTree('pine', x, z, lerp(12, 20, r()), r); }
    for (let i = 0; i < 40; i++) { const x = 110 + r() * 200, z = -480 + r() * 230; if (labH(x, z) < 120 || L.slope(x, z) > .4 || Math.hypot(x - 205, z + 330) < 14) continue; addTree(r() < .7 ? 'pine' : 'oak', x, z, lerp(8, 15, r()), r); }
    for (let i = 0; i < 260; i++) { const x = -900 + r() * 700, z = -560 + r() * 420; if (L.slope(x, z) > .45 || pathW(x, z) > .1 || fbm(x * .008, z * .008, 2, 6) < .5) continue; addTree(r() < .75 ? 'pine' : 'oak', x, z, lerp(10, 17, r()), r); }
    // B: pine forests in the valley, round trees in the meadows, trees on the high town plateau
    if (PRESET === 'b') {
      for (let gx = -2200; gx < 400; gx += 15) for (let gz = -3000; gz < 200; gz += 15) {
        const x = OB[0] + gx + (r() - .5) * 12, z = OB[1] + gz + (r() - .5) * 12; const f = forestN(x, z); if (f < .58 || r() > .85) continue; const h = labH(x, z); if (h < 6 || h > 420 || L.slope(x, z) > .55 || pathW(x, z) > .05) continue;
        addTree('pine', x, z, lerp(10, 18, r()), r);
      }
      for (let i = 0; i < 260; i++) { const x = OB[0] - 1600 + r() * 2000, z = OB[1] - 2600 + r() * 2700; if (forestN(x, z) > .5 || L.slope(x, z) > .4 || pathW(x, z) > .05 || labH(x, z) < 5) continue; addTree('oak', x, z, lerp(6, 11, r()), r); }
      for (let i = 0; i < 300; i++) { const x = OB[0] + 600 + r() * 2600, z = OB[1] - 1400 - r() * 2600; const h = labH(x, z); if (h < 300 || L.slope(x, z) > .4) continue; if (h < 360 && Math.hypot(x - OB[0] - 860, z - OB[1] + 1950) < 160) continue; if (fbm(x * .006, z * .006, 2, 8) < .5) continue; addTree('pine', x, z, lerp(10, 18, r()), r); }
      addTree('oak', OB[0] - 15, OB[1] + 286, 12, r); addTree('oak', OB[0] + 17, OB[1] + 281, 9, r);
    }
  }
  function buildTrees(cam) {
    const groups = {};
    for (const t of TREES) { const lod = Math.hypot(t.x - cam[0], t.z - cam[1]) < 260 ? 'hi' : 'lo'; (groups[t.k + '|' + lod] = groups[t.k + '|' + lod] || []).push(t); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const key in groups) {
      const [k, lod] = key.split('|'), list = groups[key], G = treeGeo[k][lod];
      const can = new THREE.InstancedMesh(G.canopy, L.MAT.foliage, list.length); L.applyFoliage(can, L.MAT.foliage);
      const bark = G.bark ? new THREE.InstancedMesh(G.bark, L.MAT.bark, list.length) : null;
      list.forEach((t, i) => { const sc = t.h / treeGeo[k].h; p.set(t.x, labH(t.x, t.z) - .3, t.z); q.setFromAxisAngle(Y, (t.x * 7.31 + t.z * 3.17) % TAU); s.set(sc, sc, sc); m4.compose(p, q, s); can.setMatrixAt(i, m4); can.setColorAt(i, t.tint); if (bark) bark.setMatrixAt(i, m4); });
      for (const m of [can, bark]) { if (!m) continue; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; L.scene.add(m); }
    }
  }

  // ================================================================ waterfalls
  function fallRibbon(x, z, nx, nz, top, bot, w, out) {
    const P = [], U = [], S = [], Nn = [], I = []; const n = 34; const tx = -nz, tz = nx;
    for (let k = 0; k <= n; k++) {
      const t = k / n, y = lerp(top, bot, t); const o = out + 3 * Math.sqrt(t) + (k === 0 ? -out * .8 : 0); const ww = w * (1 + t * .5);
      for (const e of [-.5, .5]) { P.push(x + nx * o + tx * e * ww, y, z + nz * o + tz * e * ww); U.push(e + .5, (top - y) + 0); S.push(k < 2 ? .4 : 1); Nn.push(nx, .2, nz); }
      if (k < n) { const a = k * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    // lip: a short flat run on top of the cliff
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('aSteep', new THREE.Float32BufferAttribute(S, 1)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setIndex(I);
    return g;
  }
  const flowMat = () => L._labFlow || (L._labFlow = L.makeFlowMaterial());
  function addFall(ax, az, bx, bz, s, w, bot) {
    // point on the edge segment, move inward until on the plateau top, then hang outwards
    const ex = bx - ax, ez = bz - az, el = Math.hypot(ex, ez); let nx = ez / el, nz = -ex / el;   // right-hand normal of a->b
    let x = ax + ex * s, z = az + ez * s;
    // find the lip: walk along the normal from inside to outside and stop where height drops
    if (labH(x + nx * 60, z + nz * 60) > labH(x - nx * 60, z - nz * 60)) { nx = -nx; nz = -nz; }   // normal points to the low side
    let lx = x - nx * 80, lz = z - nz * 80, top = labH(lx, lz);
    for (let k = 0; k < 120; k++) { const h = labH(lx + nx * 2, lz + nz * 2); if (h < top - 6) break; lx += nx * 2; lz += nz * 2; top = Math.max(top, h); }
    const m = new THREE.Mesh(fallRibbon(lx, lz, nx, nz, top + .5, bot, w, 10), flowMat()); m.renderOrder = 5; m.frustumCulled = false; L.scene.add(m);
    L.addFallMist(lx + nx * 12, bot + 6, lz + nz * 12, w * 2.2);
    return { x: lx, z: lz, top };
  }

  // ================================================================ character
  async function addHero(x, z, ry, speed, t) {
    const src = await L.loadModel('mage_f'); if (!src) return null;
    const robe = L.MAT.v5skin.clone(); robe.color.set(0xe8eef6).convertSRGBToLinear(); const hat = L.MAT.v5skin.clone(); hat.color.set(0x8fb0d8).convertSRGBToLinear();
    const I = L.instRigged(src, { mat: L.MAT.v5skin });
    I.root.traverse(m => { if (!m.isMesh) return; if (/_robe/.test(m.name)) m.material = robe; else if (/_hat/.test(m.name)) m.material = hat; });
    I.root.position.set(x, labH(x, z), z); I.root.rotation.y = ry; L.scene.add(I.root);
    const st = { t, dt: 1 / 30, speed, air: 0, swim: 0, ride: 0, act: null, now: t, turn: 0, wave: 0, hold: false, fistR: .25, rideHz: 6 };
    for (let k = 0; k < 8; k++) { st.t = t + k / 30; st.now = st.t; L.humanAnim(I.rig, st); }
    L.uPlayer.value.set(x, labH(x, z), z);
    return I;
  }

  // ================================================================ clouds framing each preset
  // place a cumulus by its direction from the camera: az/el in degrees relative to the view centre
  function cumulusAt(cam, az, el, dist, w, h, seed) {
    const a = (P.yaw + az) * D2R, x = cam.x + Math.sin(a) * dist, z = cam.z - Math.cos(a) * dist; const y = cam.y + Math.tan(el * D2R) * dist;
    L.clouds.addCumulus(x, y, z, w, h, seed);
  }
  function clumpAt(x, y, z, w, h, seed) { L.clouds.addClump(x, y, z, w, h, seed, 0); }
  function frameClouds(cam) {
    if (PRESET === 'a') {
      cumulusAt(cam, -16, 17, 3400, 1500, 900, 11); cumulusAt(cam, -32, 22, 3800, 1100, 700, 12); cumulusAt(cam, 26, 7, 2600, 1300, 900, 13); cumulusAt(cam, 40, 4, 3200, 1000, 500, 14); cumulusAt(cam, -46, 9, 3000, 900, 420, 15);
      clumpAt(-40, 225, -760, 120, 30, 21); clumpAt(40, 250, -735, 90, 22, 22); clumpAt(170, 205, -640, 120, 30, 23); clumpAt(250, 160, -600, 160, 40, 24); clumpAt(-120, 190, -700, 90, 24, 25);
    } else if (PRESET === 'b') {
      cumulusAt(cam, 0, 14, 4200, 2000, 900, 31); cumulusAt(cam, 26, 9, 3600, 1600, 1100, 32); cumulusAt(cam, -20, 12, 4600, 1100, 500, 33); cumulusAt(cam, -36, 16, 3600, 600, 300, 34); cumulusAt(cam, 36, 2, 5200, 1200, 600, 35);
      clumpAt(OB[0] + 120, 230, OB[1] - 700, 90, 30, 41); clumpAt(OB[0] - 90, 260, OB[1] - 1300, 120, 36, 42); clumpAt(OB[0] + 640, 260, OB[1] - 1250, 120, 40, 43); clumpAt(OB[0] + 980, 330, OB[1] - 1500, 90, 26, 44);
    } else {
      cumulusAt(cam, 30, 5, 2600, 900, 380, 51); cumulusAt(cam, 44, 3, 2000, 700, 260, 52); cumulusAt(cam, -10, 14, 3800, 1400, 700, 53); cumulusAt(cam, 52, 9, 2600, 600, 240, 54);
      clumpAt(170, 120, -300, 160, 40, 61); clumpAt(330, 110, -380, 200, 40, 62); clumpAt(260, 105, -150, 140, 30, 63);
    }
  }

  // ================================================================ boot
  const hud = document.getElementById('hud');
  let T = 0;
  function sunFor(name) {
    const tp = L.todPreset(name, P.sunAz);
    return tp;
  }
  async function boot() {
    const t0 = performance.now();
    await L.loadAll(['mage_f']);
    await L.loadLegacy(['tree_pine', 'tree_pine_lo', 'tree_oak', 'tree_oak_lo']);
    L.makeMaterials();
    L.skyInit();
    L.setTimeOfDay(sunFor(TODN));
    const cx = P.pos[0], cz = P.pos[1]; const cy = labH(cx, cz) + P.eye;
    const cam = L.camera; cam.fov = P.fov; cam.position.set(cx, cy, cz);
    cam.rotation.order = 'YXZ'; cam.rotation.set(P.pitch * D2R, -P.yaw * D2R, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    L.lookFocus = P.focus ? new THREE.Vector3(P.focus[0], labH(P.focus[0], P.focus[1]), P.focus[1]) : null;
    const t1 = performance.now();
    buildTerrain(cx, cz); buildOcean(cx, cz);
    const t2 = performance.now();
    // buildings, fences
    towerHouse(-4, -80); house(-40, -96, .25, 9, 7, 5.5, 4.5); house(32, -112, -.3, 8, 6.5, 5, 4); house(-22, -128, .1, 7, 6, 4.5, 3.8);
    tower(206, -332, 3.2, 14, 6.5, { face: 2 }); house(222, -350, .5, 9, 7, 5, 4); house(190, -352, -.2, 7, 6, 4.5, 3.5);
    if (PRESET === 'b') {
      const r = rnd(8); const tx = OB[0] + 860, tz = OB[1] - 1960;
      tower(tx - 30, tz + 60, 4.5, 26, 9, { face: 1 });
      for (let i = 0; i < 22; i++) { const x = tx + (r() - .3) * 220, z = tz + (r() - .5) * 200; if (labH(x, z) < 320) continue; house(x, z, r() * TAU, 8 + r() * 6, 6 + r() * 4, 5 + r() * 3, 4 + r() * 2); }
      tower(tx + 60, tz - 40, 3.5, 16, 7, {}); tower(tx - 150, tz - 220, 3, 14, 6, {});
      house(OB[0] - 60, OB[1] - 380, .3, 9, 7, 4.5, 4.5); house(OB[0] + 40, OB[1] - 1100, 1.2, 8, 6, 4.5, 4);
    }
    const hm = new THREE.Mesh(houses.geo(), L.MAT.v5); hm.castShadow = true; hm.receiveShadow = true; L.scene.add(hm);
    if (PRESET === 'c' || PRESET === 'a') fence([[163, 330], [160, 260], [158, 200], [162, 140], [160, 80]], 2.6);
    if (PRESET === 'b') { fence([[OB[0] - 9, OB[1] + 330], [OB[0] - 8, OB[1] + 290], [OB[0] - 12, OB[1] + 250]], 2.4); fence([[OB[0] + 9, OB[1] + 300], [OB[0] + 11, OB[1] + 270], [OB[0] + 16, OB[1] + 240]], 2.4); }
    if (fences.P.length) { const fm = new THREE.Mesh(fences.geo(), L.MAT.v5); fm.castShadow = true; fm.receiveShadow = true; L.scene.add(fm); }
    // trees
    prepTrees(); scatterTrees(); buildTrees([cx, cz]);
    // waterfalls
    for (const s of FALLS_A) addFall(-260, -850, 361, -657, s, s > .75 ? 13 : 9, 112);
    if (PRESET === 'b') addFall(OB[0] + 1180, OB[1] - 1330, OB[0] + 1650, OB[1] - 1720, .3, 10, 4);
    // cloud sea: thick at cliff bases, open ocean south-east of the village terrace (preset c) and none in area B
    L.cloudSea.densityFromHeight(labH, -12000, -12000, 24000, 512, (x, z, v, dm) => {
      if (x < -3000) v *= sstep(-2600, -3000, x) * 0;
      if (z > -260 && x > 200) v *= .2 + .8 * sstep(-160, -260, z);
      if (x > 200 && z < -260 && z > -560 && x < 900) v = Math.max(v, .8);
      return v;
    });
    frameClouds(cam.position);
    // grass + character
    L.grassInit();
    if (P.hero) await addHero(P.hero[0], P.hero[1], Math.PI + 8 * D2R, 4.6, 1.3);
    L.grassUpdate(cx, cz, true);
    const t3 = performance.now();
    L.LAB.times = { load: Math.round(t1 - t0), terrain: Math.round(t2 - t1), dress: Math.round(t3 - t2) };
    step(3);
    window.ready = true;
  }
  function step(n) {
    for (let i = 0; i < (n || 1); i++) { T += 1 / 30; L.lookTick(1 / 30, 10 + T, L.camera); L.grassUpdate(L.camera.position.x, L.camera.position.z, false); }
    L.render();
    const S = L.renderStats, G = L.grassStats;
    if (hud) hud.textContent = `${PRESET} ${TODN} ${L.quality}  calls ${S.calls}  tris ${S.triangles}  grass ${G.tris}`;
    return { calls: S.calls, triangles: S.triangles, grassTris: G.tris, clumps: G.clumps, flowers: G.flowers, tiles: G.tiles };
  }
  window.step = step;
  window.labStats = () => Object.assign({ quality: L.quality, post: L.postOn, dpr: L.renderer.getPixelRatio() }, L.renderStats, { grass: L.grassStats, times: L.LAB.times });
  boot().catch(e => { console.error('lab boot', e && e.stack || e); window.ready = true; });
})(window.L);
