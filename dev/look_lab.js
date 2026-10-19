/* Look Lab (dev only): synthetic scenes that reproduce the concept references with the v5 look modules.
   ?p=a|b|c   a = terraço da vila + paredão com 3 cachoeiras (d959254a)
              b = vale + cidade alta no planalto + mar (57faf138)
              c = terceira pessoa no prado junto à cerca acima do mar de nuvens (be82a764)
              n = a Névoa vista do prado (?mist=in dentro dela, ?mist=open com o corredor aberto); k = bancada de nuvens
   ?t=day|golden|night|rain|dawn   ?q=alto|medio|baixo   ?hud=1
   window.step(n) renders n frames and returns render stats; window.ready is set once the first frame is drawn. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep, C } = L;
  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  const QS = new URLSearchParams(location.search);
  const PRESET = (QS.get('p') || 'a').toLowerCase(), TODN = QS.get('t') || 'day';
  const AREA = PRESET === 'n' ? 'c' : PRESET;                 // n = the Névoa test view, dressed like area c
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
  const OC = [7000, 0];                  // origin of area C (meadow on a sea cliff, village across a cloud gap)
  const rel = (P, o) => P.map(p => [p[0] + o[0], p[1] + o[1]]);
  // ---- area A, laid out from the reference frame itself: camera at (0, A_EYE, 0) looking -z, level, vfov 40
  //      (f = 821 px for the 598 px frame); scr(sx, sy, D) puts a reference pixel at forward distance D.
  const A_G = 150, A_EYE = A_G + 1.35, AF = 299 / Math.tan(20 * D2R);
  const scr = (sx, sy, D) => [(sx - 700) / AF * D, A_EYE + (299 - sy) / AF * D, -D];
  // front edge of the tilted plateau (x, h, z), left to right; the top rises away from the edge so its meadow shows
  const A_EDGE = [[-2700, 172, -1500], [-1700, 188, -1400]].concat([[60, 262, 1250], [180, 258, 1180], [300, 255, 1100], [450, 240, 1050], [600, 215, 1000], [750, 170, 1000], [900, 70, 980], [1050, -70, 950], [1075, -110, 950]].map(p => scr(p[0], p[1], p[2])));
  const PA = A_EDGE.map(p => [p[0], p[2]]).concat([[A_EDGE[A_EDGE.length - 1][0] - 60, -1250], [260, -2600], [120, -4200], [-2700, -4200]]);
  function aEdge(x) { const E = A_EDGE; if (x <= E[0][0]) return E[0]; for (let k = 1; k < E.length; k++) if (x <= E[k][0]) { const t = (x - E[k - 1][0]) / (E[k][0] - E[k - 1][0]); return [x, lerp(E[k - 1][1], E[k][1], t), lerp(E[k - 1][2], E[k][2], t)]; } return E[E.length - 1]; }
  // village terrace (the camera hill rises on its east rim), lower terrace with the second tower house
  const T_A = [[-900, 420], [-900, -270], [-260, -235], [-120, -172], [-62, -130], [-26, -102], [-4, -76], [9, -57], [19, -43], [27, -25], [32, 0], [34, 34], [30, 150], [-200, 420]];
  const T2 = [[8, -198], [70, -192], [118, -212], [136, -250], [120, -300], [62, -326], [14, -316], [-4, -262]];
  const FALLS_A = [[672, 1000, 6], [852, 980, 11], [902, 975, 15]];   // reference pixel x, distance, width
  // ---- area C (relative to OC), laid out from the reference frame (crop 1310 x 569, vfov 50): camera eye C_G + 3 at OC
  //      looking -z, pitched -19 deg. Fence points come from the post sizes in the frame; the meadow falls ~9 m toward
  //      them, its seaward rim runs 4 m outside the fence; village terrace (48 m) ~350 m out, a lower ledge (20 m) on its
  //      sea side, a forest slope on the left and the big grey plateau behind.
  const C_G = 70;
  const C_FENCE = [[6.6, 10], [6, -4.6], [8.4, -11.2], [8.7, -18], [7.9, -32], [-7.7, -54.5], [-50, -86.6], [-110, -110], [-190, -122]];
  const C_RIM = C_FENCE.map((p, k) => { const a = C_FENCE[Math.max(k - 1, 0)], b = C_FENCE[Math.min(k + 1, C_FENCE.length - 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [p[0] - dz / l * 4.5, p[1] + dx / l * 4.5]; });
  const C_M = rel([[40, 400], [12, 40]].concat(C_RIM, [[-250, -112], [-330, -40], [-340, 400]]), OC);
  const C_V = rel([[-50, -235], [20, -228], [62, -236], [92, -262], [96, -320], [60, -360], [-24, -366], [-80, -330], [-88, -270]], OC);
  const C_L = rel([[14, -186], [58, -172], [104, -186], [118, -222], [104, -256], [60, -262], [18, -240]], OC);
  const C_L2 = rel([[70, -168], [112, -160], [140, -184], [140, -226], [118, -244], [92, -230], [74, -200]], OC);
  const C_W = rel([[-120, -138], [-70, -150], [-62, -230], [-110, -330], [-150, -560], [-520, -560], [-560, -160]], OC);
  const C_P = rel([[-760, -520], [-330, -560], [-80, -600], [110, -640], [210, -760], [200, -1500], [-900, -1500], [-1000, -900]], OC);
  const FALLS_C = [[-105, -600, 8], [62, -630, 6], [78, -636, 5]];
  // ---- area B (relative to OB), laid out from the reference frame (1400 x 650, vfov 34): camera on a hill path (300 m)
  //      looking -z, pitched -3 deg. The painting compresses depth, so everything sits closer than it looks: the valley
  //      farmhouse ~150 m, the high town (290 m) ~480 m with its sheer cliff down to a fjord lake (205 m), an upper
  //      plateau (390-600 m) from ~1 km with a waterfall, a cliff mesa right of the lake, blue mountains far away.
  const B_L = rel([[-3200, 1500], [-3200, -3400], [-400, -3400], [-60, -1900], [380, -1250], [520, -980], [250, -760], [120, -340], [60, -250], [140, 600], [80, 1500]], OB);
  const B_T = rel([[-30, -400], [80, -380], [175, -420], [200, -500], [170, -600], [60, -640], [-40, -580], [-70, -480]], OB);
  const B_R = rel([[260, -640], [520, -560], [900, -600], [1100, -900], [900, -1300], [560, -1200], [400, -980]], OB);
  const B_U = rel([[-200, -1000], [0, -950], [200, -920], [460, -980], [560, -1300], [500, -2600], [-500, -2600], [-420, -1500]], OB);
  const B_LAKE = { y: 205, poly: rel([[60, -250], [180, -260], [320, -380], [520, -520], [600, -900], [420, -1100], [260, -900], [140, -640], [100, -420]], OB) };
  const B_E = rel([[220, -60], [560, -120], [720, -400], [660, -660], [520, -560], [330, -430], [200, -230]], OB);
  const B_TOWN = [70, -500];
  // distant mesas (circles): [cx, cz, r, top, cliff width, warp, seed]
  const FAR = [[2900, -4700, 1100, 190, 30, 160, 3], [1900, -5600, 600, 150, 30, 90, 4], [4200, -6400, 900, 240, 40, 140, 5], [-2400, -4300, 1000, 580, 16, 150, 7],
    [OC[0] + 2600, OC[1] - 3600, 700, 160, 40, 120, 15],
    [OB[0] + 1900, OB[1] - 3300, 1100, 420, 500, 260, 8], [OB[0] + 3300, OB[1] - 2300, 900, 380, 420, 220, 9], [OB[0] - 1600, OB[1] - 3900, 1300, 600, 1500, 300, 10],
    [OB[0] - 3000, OB[1] - 2900, 1000, 460, 1400, 260, 16], [OB[0] + 900, OB[1] - 5600, 1600, 900, 700, 300, 17]];

  const M = [];
  function mesa(o) { o.bb = o.poly ? bounds(o.poly) : [o.cx - o.r, o.cz - o.r, o.cx + o.r, o.cz + o.r]; o.foot = o.foot || 160; M.push(o); return o; }
  function warp(x, z, amp, s) { return [x + amp * (fbm(x * .0031 + s, z * .0031, 3, s) - .5) * 2 + amp * .35 * (vn(x * .019, z * .019, s + 5) - .5) * 2, z + amp * (fbm(x * .0031 - s, z * .0031 + 7, 3, s + 9) - .5) * 2 + amp * .35 * (vn(x * .019 + 3, z * .019, s + 6) - .5) * 2]; }
  // stepped cliff profile: k ledges whose flats catch light and grass (u = 0 foot .. 1 rim)
  const ledges = (k, a) => u => { u = clamp(u, 0, 1); return u - a * Math.sin(TAU * k * u) / (TAU * k); };
  // A: village terrace with the camera hill (rising to the left of the view) and a gentle rise to the west
  mesa({ poly: T_A, warp: 5, seed: 11, w: 7, top(x, z) {
    let h = 140 + .035 * Math.max(0, -x - 70) + .02 * Math.max(0, -z - 120) + (fbm(x * .006, z * .006, 3, 2) - .5) * 5 + (fbm(x * .05, z * .05, 2, 3) - .5) * .9;
    h += 15 * Math.exp(-((x + 20) ** 2 + (z - 8) ** 2) / (2 * 22 * 22));                  // the camera hill
    h -= 1.0 * Math.exp(-((x + 12) ** 2 + (z + 66) ** 2) / (2 * 26 * 26));                // village floor
    return h;
  } });
  mesa({ poly: T2, warp: 8, seed: 12, w: 12, prof: ledges(2, .7), top(x, z) { return 108 + .26 * Math.max(0, x - 20) + (fbm(x * .01, z * .01, 2, 4) - .5) * 4; } });
  // the tilted plateau: front edge from A_EDGE, top rising away from it (a broad green slab), stepped grey cliff
  mesa({ poly: PA, warp: 22, seed: 13, w: 230, wf: (t, x) => lerp(230, 70, sstep(220, 380, x)), foot: 380, rimIn: true, prof: ledges(3, .92), top(x, z) {
    // the prow (right end) stays level behind its rim: a sheer wall ending in a vertical edge
    const e = aEdge(x), t = clamp(e[2] - z, 0, 2700), s = lerp(.2, .35, sstep(-420, 60, x)) * (1 - sstep(60, 300, x));
    return e[1] + s * t * (1 - t / 9000) + (fbm(x * .003, z * .003, 3, 6) - .5) * 30 * sstep(0, 300, t) + (fbm(x * .02, z * .02, 2, 7) - .5) * 4;
  } });
  // C: meadow sloping gently away to the north-west, village terrace across the cloud gap, forest slope, big plateau
  mesa({ poly: C_M, warp: 1.5, seed: 31, w: 7, prof: ledges(2, .5), top(x, z, d) {
    const rx = x - OC[0], rz = z - OC[1], u = Math.max(0, -rz * .9 - rx * .15);
    return (rz > 0 ? C_G + rz * .03 : 61 + 9 * Math.exp(-Math.max(0, u - 4.5) / 19)) - 1.6 * sstep(9, 0, d) + (fbm(x * .03, z * .03, 2, 32) - .5) * 1.0 + (fbm(x * .006, z * .006, 2, 33) - .5) * 2.5;
  } });
  mesa({ poly: C_V, warp: 8, seed: 34, w: 9, prof: ledges(2, .7), top(x, z) { return 54 + (fbm(x * .02, z * .02, 2, 35) - .5) * 3 + .05 * Math.max(0, OC[1] - 310 - z); } });
  mesa({ poly: C_L, warp: 6, seed: 35, w: 7, prof: ledges(2, .6), top(x, z) { return 35 + (fbm(x * .03, z * .03, 2, 36) - .5) * 2.4 + .06 * Math.max(0, OC[1] - 230 - z); } });
  mesa({ poly: C_L2, warp: 6, seed: 37, w: 6, prof: ledges(2, .6), top(x, z) { return 15 + (fbm(x * .03, z * .03, 2, 38) - .5) * 2; } });
  mesa({ cx: OC[0] + 132, cz: OC[1] - 250, r: 6, warp: 2, seed: 39, w: 3, foot: 20, top() { return 7; } });       // sea stack with a foam ring
  mesa({ poly: C_W, warp: 30, seed: 36, w: 30, prof: ledges(2, .5), top(x, z) { const rz = z - OC[1]; return 32 + .22 * Math.max(0, -rz - 220) + (fbm(x * .01, z * .01, 3, 37) - .5) * 10; } });
  mesa({ poly: C_P, warp: 40, seed: 38, w: 50, foot: 260, prof: ledges(3, .75), top(x, z) { const rx = x - OC[0], rz = z - OC[1]; return 250 + .1 * Math.max(0, -rz - 640) - 70 * sstep(-20, 200, rx) + (fbm(x * .003, z * .003, 3, 39) - .5) * 40; } });
  // B
  mesa({ poly: B_L, warp: 40, seed: 21, w: 30, prof: ledges(2, .5), top(x, z) {
    const rx = x - OB[0], rz = z - OB[1];
    let h = 252 + (fbm(x * .004, z * .004, 4, 8) - .5) * 20;
    h += 48 * sstep(-200, 10, rz) * Math.exp(-rx * rx / (2 * 300 * 300));                          // the camera hill falls toward the valley
    h += 110 * sstep(-200, -1100, rx) * (.5 + .5 * fbm(x * .002, z * .002, 3, 9));                 // forested hills (left)
    h += 60 * sstep(-500, -1100, rz) * (.6 + .4 * fbm(x * .003, z * .003, 3, 10));                  // the valley head rising toward the upper plateau
    h += 36 * Math.exp(-((rx + 60) ** 2 + (rz + 470) ** 2) / (2 * 90 * 90));                       // the ramp up to the town
    h += (fbm(x * .02, z * .02, 2, 11) - .5) * 3;
    return h;
  } });
  mesa({ poly: B_T, warp: 10, seed: 22, w: 12, foot: 140, top(x, z) { return 290 + (fbm(x * .01, z * .01, 3, 12) - .5) * 6 + .05 * Math.max(0, OB[1] - 560 - z); } });
  mesa({ poly: B_LAKE.poly, warp: 20, seed: 25, w: 40, foot: 120, top() { return 188; } });                     // the lake basin (water at 205)
  mesa({ poly: B_E, warp: 30, seed: 26, w: 30, foot: 160, prof: ledges(2, .6), top(x, z) { return 258 + (fbm(x * .006, z * .006, 3, 27) - .5) * 24; } });
  mesa({ poly: B_R, warp: 30, seed: 24, w: 26, foot: 200, top(x, z) { return 300 + (fbm(x * .004, z * .004, 3, 14) - .5) * 40 + .2 * Math.max(0, x - OB[0] - 600); } });
  mesa({ poly: B_U, warp: 40, seed: 23, w: 50, wf: (t, x) => lerp(320, 40, sstep(-40, 260, x - OB[0])), foot: 420, prof: ledges(2, .45), top(x, z) { const rx = x - OB[0], rz = z - OB[1]; return 390 + .2 * Math.max(0, -rz - 980) + 60 * sstep(100, 500, rx) + (fbm(x * .003, z * .003, 3, 13) - .5) * 30; } });
  for (const f of FAR) mesa({ cx: f[0], cz: f[1], r: f[2], warp: f[5], seed: f[6], w: f[4], foot: Math.max(200, f[4] * 1.2), top(x, z, d) { return f[3] + (fbm(x * .002, z * .002, 3, f[6]) - .5) * f[3] * .25 + (f[4] > 100 ? -f[3] * .25 * (1 - sstep(0, f[2] * .6, d)) : 0); } });

  function mesaH(o, x, z) {
    const b = o.bb, F = o.foot + o.warp * 1.4;
    if (x < b[0] - F || x > b[2] + F || z < b[1] - F || z > b[3] + F) return -1e9;
    const [wx, wz] = warp(x, z, o.warp, o.seed);
    const d = o.poly ? sdPoly(wx, wz, o.poly) : o.r - Math.hypot(wx - o.cx, wz - o.cz);
    if (d < -o.foot) return -1e9;
    const top = o.top(x, z, d);
    const w = o.wf ? o.wf(top, x, z) : o.w;
    const dn = d + (vn(x * .05, z * .05, o.seed + 40) - .5) * Math.min(w, 8) * .8 + (o.prof ? (fbm(x * .012, z * .012, 2, o.seed + 41) - .5) * Math.min(w, 120) * .5 : 0);
    const p = o.prof ? o.prof(dn / w + (o.rimIn ? 1 : .5)) : sstep(-w * .5, w * .5, dn);   // rimIn: the rim sits on the outline, the steps reach outwards
    let h = SEA + (top - SEA) * p;
    if (dn < 0) h += (top - SEA) * .1 * Math.exp(dn / (24 + w));          // talus at the foot
    return h;
  }
  // paths (polylines) per area
  const PATHS = [
    [[3, 14], [1, -12], [-3, -32], [-9, -48], [-12, -55]],
    [[-3, -32], [6, -40], [14, -44]],
    [[-36, -82], [-60, -96], [-90, -130], [-140, -170], [-230, -210]],
    rel([[0, 40], [0, -20], [-10, -70], [-26, -130], [-52, -200], [-70, -280], [-100, -350], [-120, -420], [-100, -470], [-60, -490], [0, -500], [40, -505]], OB),
    rel([[-70, -280], [-200, -310], [-330, -290], [-480, -360]], OB),
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
  const COL = { meadow: C(0xc6c254), plateau: C(0xb4c051), valley: C(0x9cc453), dry: C(0xc4c060), grey: C(0x95928b), sand: C(0xdcc79a) };
  const inC = x => x > OC[0] - 2500 && x < OC[0] + 3000;
  // rock tint WORLD would paint into `color` where aT.x is high: cream sandstone terraces, grey plateau walls
  function rockTint(x, z, h) {
    if (inC(x)) { const rx = x - OC[0], rz = z - OC[1]; return rz < -120 && rz > -460 && rx > -140 && rx < 160 ? COL.sand : COL.grey; }
    if (!inB(x) && z > -700 && h < 175) return COL.sand;
    return COL.grey;
  }
  const _pc = new THREE.Color();
  function paint(x, z, h, ny, out) {
    out = out || {};
    const rock = sstep(.84, .62, ny + (vn(x * .08, z * .08, 91) - .5) * .08);
    const path = pathW(x, z) * (1 - rock);
    const sand = (1 - rock) * sstep(5.5, 2.5, h) * sstep(-4, -1, h);
    const snow = sstep(1500, 1700, h) * sstep(.55, .8, ny);
    let forest = 0;
    if (inB(x)) forest = sstep(.56, .66, forestN(x, z)) * sstep(420, 300, h) * (1 - rock);
    _pc.copy(inB(x) ? COL.valley : h > 200 ? COL.plateau : COL.meadow);
    if (inB(x)) _pc.lerp(COL.dry, sstep(.55, .75, fbm(x * .003, z * .003, 2, 19)) * .35);
    _pc.multiplyScalar(.94 + .12 * vn(x * .01, z * .01, 33));
    if (rock > .01) _pc.lerp(rockTint(x, z, h), rock);
    out.c = out.c || [0, 0, 0]; out.c[0] = _pc.r; out.c[1] = _pc.g; out.c[2] = _pc.b;
    out.rock = rock; out.path = path; out.sand = sand; out.snow = snow; out.forest = forest; out.wet = 0;
    out.meadow = clamp(1 - rock - path - sand - snow, 0, 1); out.region = inB(x) ? (h > 300 ? 6 : 0) : inC(x) ? 1 : 3;
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
    a: { pos: [0, 0], eye: 1.35, yaw: 0, pitch: 0, fov: 40, sunAz: .35, focus: [-6, -46], size: [1400, 598], ref: 'd959254a' },
    b: { pos: [OB[0], OB[1]], eye: 1.8, yaw: 0, pitch: -3, fov: 34, sunAz: -2.55, sunEl: .62, haze: 2.6, focus: [OB[0] - 4, OB[1] - 40], size: [1400, 650], ref: '57faf138' },
    c: { pos: [OC[0], OC[1]], eye: 3.0, yaw: 0, pitch: -19, fov: 50, sunAz: .75, sunEl: .6, focus: [OC[0], OC[1] - 14], size: [1310, 569], ref: 'be82a764', hero: [OC[0], OC[1] - 4.3], cloudY: 32 },
    k: { pos: [9000, 9000], eye: 260, yaw: 0, pitch: 4, fov: 50, sunAz: 2.2, focus: null, size: [1400, 600], ref: null, test: 'clouds' },   // dev: cloud test bench
    // dev: the Névoa seen from the meadow of area c (?mist=in puts the camera inside it, ?mist=open opens the lit corridor)
    n: { pos: [OC[0] - 60, OC[1] + 60], eye: 3, yaw: -18, pitch: 4, fov: 50, sunAz: .9, focus: null, size: [1400, 600], ref: null, cloudY: 32, mist: [OC[0] - 420, OC[1] - 1050, 650] },
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
    opts = opts || {}; const y = labH(x, z) - .6; const r = rnd(Math.floor(x * 7 + z * 13)); SOLIDS.push([x, z, Math.max(w, d) * .62]);
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
    const ogive = []; for (let k = 0; k <= 13; k++) { const t = k / 13; ogive.push([(r + .5) * Math.pow(Math.max(0, 1 - Math.pow(t, 2.1)), .58) * (1 + .05 * Math.sin(t * Math.PI)), -.35 + t * (roofH + .35)]); }
    const cap = opts.ogive ? ogive : [[r + .6, 0], [r * .82, roofH * .45], [r * .45, roofH * .8], [.12, roofH], [0, roofH + .02]];
    houses.lathe(x, y + h, z, cap, seg, k => k % 2 ? K.roof2 : K.roof);
    houses.lathe(x, y + h + roofH - .1, z, [[.16, 0], [.12, 2.2], [0, 2.3]], 6, () => K.wood);
    if (opts.ogive) houses.lathe(x, y + h + roofH + 1.2, z, [[0, -.45], [.42, -.3], [.48, 0], [.42, .3], [0, .45]], 8, () => K.frame);
    const nw = Math.max(2, Math.floor(h / 5)); for (let k = 0; k < nw; k++) { const a = (k * 1.7 + (opts.face || 0)); houses.win(x + Math.sin(a) * r, y + 3 + k * (h - 4) / nw, z + Math.cos(a) * r, .8, 1.2, a, 0); }
  }
  L.flowerHint = (x, z) => inC(x) ? .18 : 1;
  const SOLIDS = [];   // [x, z, r] footprints kept free of grass
  L.noGrass = (x, z) => { for (let k = 0; k < SOLIDS.length; k++) { const o = SOLIDS[k], dx = x - o[0], dz = z - o[1]; if (dx * dx + dz * dz < o[2] * o[2]) return true; } return false; };
  function towerHouse(x, z, s) {   // the concept-art composition: hall + wing + round tower with a red skirt roof and an ogive cap
    s = s || 1;
    house(x, z, 0, 16 * s, 10 * s, 7.5 * s, 6.5 * s, { door: true });
    house(x - 11 * s, z + 3 * s, Math.PI / 2, 8 * s, 9 * s, 5.5 * s, 4.5 * s, {});
    house(x + 2 * s, z + 7.5 * s, 0, 7 * s, 5 * s, 4 * s, 3.5 * s, { chimney: false });
    tower(x + 7.5 * s, z - 1 * s, 3.4 * s, 15.5 * s, 9.8 * s, { skirt: true, ogive: true, face: .2 });
    const y = labH(x, z); houses.box(x - 4 * s, y + 6 * s, z - 2 * s, 1.5 * s, 9.5 * s, 1.5 * s, K.brick); houses.box(x - 3.4 * s, y + 6 * s, z - 2.6 * s, 1.1 * s, 10.5 * s, 1.1 * s, K.brick);
    SOLIDS.push([x - 2 * s, z + 1 * s, 14 * s]);
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
    // conifers: procedural whorls of bough cards (L.pineCards); round trees: forked boughs with leaf masses (L.broadleafCards)
    const ph = L.pineCards({ h: 10, seed: 23 }), pl = L.pineCards({ h: 10, seed: 29, lo: true });
    treeGeo.pine = { hi: { canopy: ph.canopy, bark: ph.bark }, lo: { canopy: pl.canopy, bark: pl.bark }, h: 10 };
    const oh = L.broadleafCards({ h: 9, seed: 31 }), ol = L.broadleafCards({ h: 9, seed: 37, lo: true });
    treeGeo.oak = { hi: { canopy: oh.canopy, bark: oh.bark }, lo: { canopy: ol.canopy, bark: ol.bark }, h: 9 };
    const ow = L.broadleafCards({ h: 9, seed: 43, low: true }); treeGeo.oakLow = { hi: { canopy: ow.canopy, bark: ow.bark }, lo: { canopy: ow.canopy, bark: ow.bark }, h: 9 };
    for (const k in TREE_KINDS) {
      if (k === 'pine' || k === 'oak') continue;
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
  const TINT = { pine: [C(0x5d7638), C(0x4d6534), C(0x667f3e)], oak: [C(0x64a63c), C(0x579737), C(0x72b044)] }; TINT.oakLow = TINT.oak;
  function addTree(k, x, z, h, r, rot) { if (labH(x, z) < 1) return; const T = TINT[k]; TREES.push({ k, x, z, h, rot, tint: T[Math.floor(r() * T.length)] }); }
  function scatterTrees() {
    const r = rnd(5);
    if (PRESET === 'a') {
      // A: tall pine stand left of the village, a few round trees, pines on the lower terrace, the west rise and the plateau
      for (let i = 0; i < 90; i++) { const a = r() * TAU, d = Math.sqrt(r()) * 34, x = -64 + Math.cos(a) * d * 1.3, z = -112 + Math.sin(a) * d; if (pathW(x, z) > .1 || labH(x, z) < 130) continue; addTree('pine', x, z, lerp(15, 24, r()), r); }
      for (let i = 0; i < 160; i++) { const x = -700 + r() * 560, z = -250 + r() * 200; if (L.slope(x, z) > .4 || labH(x, z) < 130 || fbm(x * .01, z * .01, 2, 6) < .46) continue; addTree(r() < .8 ? 'pine' : 'oak', x, z, lerp(12, 20, r()), r); }
      for (const [x, z, h] of [[-36, -48, 7], [8, -88, 8], [-44, -70, 9], [-28, -96, 7]]) addTree('oak', x, z, h, r);
      for (let i = 0; i < 60; i++) { const x = r() * 130, z = -330 + r() * 135; if (labH(x, z) < 100 || L.slope(x, z) > .35 || Math.hypot(x - 50, z + 272) < 22) continue; if (fbm(x * .03, z * .03, 2, 8) < .45) continue; addTree(r() < .85 ? 'pine' : 'oak', x, z, lerp(7, 12, r()), r); }
      // plateau: sparse pines on the top near the rim, a few on the cliff ledges
      for (let i = 0; i < 700; i++) {
        const x = -1400 + r() * 1850, e = aEdge(x), z = e[2] - 40 - r() * 900; const h = labH(x, z); if (h < 200 || L.slope(x, z) > .45) continue;
        if (fbm(x * .006, z * .006, 2, 4) < .56) continue; addTree('pine', x, z, lerp(14, 22, r()), r);
      }
      for (let i = 0; i < 900; i++) { const x = -900 + r() * 1300, e = aEdge(x), z = e[2] + r() * 70; const h = labH(x, z); if (h < 110 || h > e[1] - 15 || L.slope(x, z) > .3) continue; addTree('pine', x, z, lerp(10, 16, r()), r); }
    }
    if (AREA === 'c') {
      const X = x => OC[0] + x, Z = z => OC[1] + z;
      // forest slope on the left (dense pines), its edge trees showing over the meadow's far rim
      for (let gx = -560; gx < -50; gx += 8) for (let gz = -560; gz < -120; gz += 8) { const x = X(gx + (r() - .5) * 7), z = Z(gz + (r() - .5) * 7); const h = labH(x, z); if (h < 22 || h > 100 || L.slope(x, z) > .6 || r() > .6 || fbm(x * .01, z * .01, 2, 40) < .4) continue; addTree(r() < .7 ? 'pine' : 'oak', x, z, lerp(10, 19, r()), r); }
      for (let i = 0; i < 70; i++) { const x = X(-340 + r() * 140), z = Z(-160 + r() * 130); const h = labH(x, z); if (h < 50 || L.slope(x, z) > .4) continue; addTree(r() < .75 ? 'pine' : 'oak', x, z, lerp(10, 17, r()), r); }
      // village terrace and the lower ledge: scattered pines and round trees around the houses
      for (let i = 0; i < 60; i++) { const x = X(-90 + r() * 200), z = Z(-370 + r() * 145); const h = labH(x, z); if (h < 50 || L.slope(x, z) > .3 || Math.hypot(x - X(18), z - Z(-284)) < 36) continue; addTree(r() < .65 ? 'pine' : 'oak', x, z, lerp(7, 12, r()), r); }
      for (let i = 0; i < 40; i++) { const x = X(10 + r() * 130), z = Z(-265 + r() * 105); const h = labH(x, z); if (h < 12 || L.slope(x, z) > .3 || Math.hypot(x - X(70), z - Z(-210)) < 9) continue; addTree(r() < .8 ? 'pine' : 'oak', x, z, lerp(6, 10, r()), r); }
      // plateau: pines along the top and on the ledges
      for (let i = 0; i < 500; i++) { const x = X(-900 + r() * 1100), z = Z(-600 - r() * 700); const h = labH(x, z); if (h < 170 || L.slope(x, z) > .45 || fbm(x * .006, z * .006, 2, 41) < .5) continue; addTree('pine', x, z, lerp(14, 22, r()), r); }
    }
    // B: pine bands on the valley sides and the left hills, round trees in the meadows, trees on the town plateau and
    //    along the upper plateau's top; two big round trees framing the foreground
    if (PRESET === 'b') {
      const X = x => OB[0] + x, Z = z => OB[1] + z;
      for (let gx = -1600; gx < 120; gx += 10) for (let gz = -1300; gz < -90; gz += 10) {
        const x = X(gx + (r() - .5) * 9), z = Z(gz + (r() - .5) * 9); const f = forestN(x, z); if (f < .54 || r() > .8) continue; const h = labH(x, z); if (h < 230 || h > 520 || L.slope(x, z) > .55 || pathW(x, z) > .05) continue;
        addTree('pine', x, z, lerp(10, 18, r()), r);
      }
      for (let i = 0; i < 360; i++) { const x = X(-700 + r() * 780), z = Z(-90 - r() * 700); if (forestN(x, z) > .5 || L.slope(x, z) > .4 || pathW(x, z) > .05 || labH(x, z) < 230) continue; if (r() < .6) addTree('oak', x, z, lerp(6, 11, r()), r); }
      for (let i = 0; i < 70; i++) { const x = X(-80 + r() * 290), z = Z(-370 - r() * 280); const h = labH(x, z); if (h < 284 || L.slope(x, z) > .35 || Math.hypot(x - X(B_TOWN[0]), z - Z(B_TOWN[1])) < 75) continue; addTree(r() < .5 ? 'pine' : 'oak', x, z, lerp(7, 11, r()), r); }
      for (let i = 0; i < 300; i++) { const x = X(-600 + r() * 1700), z = Z(-560 - r() * 900); const h = labH(x, z); if (h < 300 || L.slope(x, z) > .45 || fbm(x * .006, z * .006, 2, 8) < .48) continue; addTree('pine', x, z, lerp(12, 20, r()), r); }
      for (let i = 0; i < 500; i++) { const x = X(-900 + r() * 1450), z = Z(-950 - r() * 1600); const h = labH(x, z); if (h < 380 || L.slope(x, z) > .45 || fbm(x * .005, z * .005, 2, 8) < .5) continue; addTree('pine', x, z, lerp(14, 22, r()), r); }
      addTree('oakLow', X(-10.6), Z(-8.5), 10, r, 3.14);   // framing tree, turned so its low boughs reach into the top-left corner
      addTree('oak', X(14), Z(-26), 12, r); addTree('oak', X(-2), Z(-160), 8, r);
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
      list.forEach((t, i) => { const sc = t.h / treeGeo[k].h; p.set(t.x, labH(t.x, t.z) - .3, t.z); q.setFromAxisAngle(Y, t.rot != null ? t.rot : (t.x * 7.31 + t.z * 3.17) % TAU); s.set(sc, sc, sc); m4.compose(p, q, s); can.setMatrixAt(i, m4); can.setColorAt(i, t.tint); if (bark) bark.setMatrixAt(i, m4); });
      for (const m of [can, bark]) { if (!m) continue; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; L.scene.add(m); }
    }
  }

  // ================================================================ waterfalls
  // ribbon from the lip down to `bot`, pushed out just enough to clear the (stepped) cliff below it
  function fallRibbon(x, z, nx, nz, top, bot, w) {
    const P = [], U = [], S = [], Nn = [], I = []; const n = 40; const tx = -nz, tz = nx;
    const O = []; let o = 0;
    for (let k = 0; k <= n; k++) {
      const y = lerp(top, bot, k / n);
      while (o < 420 && labH(x + nx * o, z + nz * o) > y - 2.5) o += 1.5;
      O.push(o + 2 + 2.5 * Math.sqrt(k / n));
    }
    for (let k = 1; k <= n; k++) O[k] = Math.max(O[k], O[k - 1]);
    for (let k = 0; k <= n; k++) {
      const t = k / n, y = lerp(top, bot, t), oo = k === 0 ? 0 : O[k]; const ww = w * (1 + t * .6);
      const st = k === 0 ? .3 : clamp((O[k] - O[k - 1]) / ((top - bot) / n) * -1 + 1, .25, 1);
      for (const e of [-.5, .5]) { P.push(x + nx * oo + tx * e * ww, y, z + nz * oo + tz * e * ww); U.push(e + .5, top - y); S.push(st); Nn.push(nx, .2, nz); }
      if (k < n) { const a = k * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('aSteep', new THREE.Float32BufferAttribute(S, 1)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setIndex(I);
    return g;
  }
  const flowMat = () => L._labFlow || (L._labFlow = L.makeFlowMaterial());
  // a fall at (x, z) on a plateau whose cliff faces direction (nx, nz): walk out to the lip, then hang the ribbon
  function addFallAt(x, z, nx, nz, w, bot) {
    let lx = x - nx * 120, lz = z - nz * 120, top = labH(lx, lz);
    for (let k = 0; k < 200; k++) { const h = labH(lx + nx * 2, lz + nz * 2); if (h < top - 4) break; lx += nx * 2; lz += nz * 2; top = Math.max(top, h); }
    const m = new THREE.Mesh(fallRibbon(lx, lz, nx, nz, top + .4, bot, w), flowMat()); m.renderOrder = 5; m.frustumCulled = false; L.scene.add(m);
    L.addFallMist(lx + nx * 40, bot + 8, lz + nz * 40, w * 2.4);
    return { x: lx, z: lz, top };
  }
  function addFall(ax, az, bx, bz, s, w, bot) {
    const ex = bx - ax, ez = bz - az, el = Math.hypot(ex, ez); let nx = ez / el, nz = -ex / el;
    const x = ax + ex * s, z = az + ez * s;
    if (labH(x + nx * 60, z + nz * 60) > labH(x - nx * 60, z - nz * 60)) { nx = -nx; nz = -nz; }
    return addFallAt(x, z, nx, nz, w, bot);
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
  function clumpAt(x, y, z, w, h, seed, style) { L.clouds.addClump(x, y, z, w, h, seed, 0, 1, style); }
  function frameClouds(cam) {
    if (PRESET === 'a') {
      // sky: the huge cumulus over the plateau (left), the one behind the prow (right), small far ones
      cumulusAt(cam, -16, 8.4, 4600, 3300, 1350, 11); cumulusAt(cam, -36, 6.5, 5200, 1700, 600, 12); cumulusAt(cam, 27, .6, 5000, 2300, 1300, 13);
      cumulusAt(cam, 37, 2.2, 6600, 900, 380, 14); cumulusAt(cam, 4, 13, 7000, 900, 300, 15);
      // cloud sea dressing: at the cliff foot, around the falls, below the village terrace on the right
      const S = [[-40, 92, -760, 170, 26], [70, 95, -830, 200, 30], [190, 92, -880, 200, 30], [-150, 92, -700, 140, 22], [320, 90, -720, 200, 28], [-330, 100, -930, 240, 34], [-520, 100, -1000, 260, 36],
        [110, 84, -150, 140, 18], [190, 84, -260, 170, 22], [240, 84, -60, 180, 22], [150, 82, 40, 160, 20]];
      S.forEach((c, k) => clumpAt(c[0], c[1], c[2], c[3], c[4], 21 + k));
    } else if (PRESET === 'b') {
      // the big cumulus over the upper plateau, the tall one right, small ones left; low puffy clouds in the valley
      cumulusAt(cam, 4, 8.5, 3400, 1900, 650, 31); cumulusAt(cam, 19, 3, 2600, 1100, 900, 32); cumulusAt(cam, -11, 9, 3400, 700, 260, 33); cumulusAt(cam, -18, 7, 3000, 500, 200, 34); cumulusAt(cam, -24, 11, 4200, 600, 220, 35); cumulusAt(cam, 26, 13, 4400, 500, 200, 36);
      const low = (x, y, z, w, h, seed) => L.clouds.addCumulus(OB[0] + x, y, OB[1] + z, w, h, seed, { low: true });
      low(20, 240, -380, 110, 46, 41); low(-300, 290, -620, 110, 40, 42); low(160, 212, -450, 60, 20, 43); low(-170, 300, -650, 70, 28, 44); low(90, 330, -900, 90, 34, 45);
    } else {
      // low flat cumulus over the sea toward the horizon (right), a few in the sky, small ones at the plateau foot
      cumulusAt(cam, 28, 1.2, 1500, 300, 90, 51); cumulusAt(cam, 40, .6, 1100, 240, 70, 52); cumulusAt(cam, 52, 2.5, 1800, 420, 140, 53); cumulusAt(cam, 33, 3.5, 2600, 520, 200, 54);
      cumulusAt(cam, 46, 9, 3000, 900, 400, 55); cumulusAt(cam, -8, 14, 3600, 1300, 600, 56); cumulusAt(cam, 20, 6, 4200, 900, 300, 57);
      // the bank filling the gap between the meadow and the village, and clumps at the plateau foot
      const S = [[-40, 30, -160, 150, 30, 3], [10, 32, -190, 120, 26, 3], [-20, 40, -230, 170, 34, 3], [-90, 40, -200, 120, 26, 3], [40, 34, -170, 80, 18, 3],
        [-150, 78, -480, 90, 16, 1], [-60, 92, -520, 80, 14, 1], [20, 72, -450, 90, 16, 1], [-250, 70, -430, 120, 20, 1]];
      S.forEach((c, k) => clumpAt(OC[0] + c[0], c[1], OC[1] + c[2], c[3], c[4], 61 + k, c[5]));
    }
  }

  // ================================================================ boot
  const hud = document.getElementById('hud');
  let T = 0;
  function sunFor(name) {
    const tp = L.todPreset(name, QS.get('sun') ? Number(QS.get('sun')) : P.sunAz);   // dev: ?sun=azimuth (rad)
    if (P.sunEl && name === 'day') { const az = Math.atan2(tp.sunDir.z, tp.sunDir.x); tp.sunDir.set(Math.cos(az) * Math.cos(P.sunEl), Math.sin(P.sunEl), Math.sin(az) * Math.cos(P.sunEl)); }
    tp.haze = P.haze || 1;
    return tp;
  }
  async function bootCloudTest() {
    L.makeMaterials(); L.skyInit();
    L.setTimeOfDay(sunFor(TODN));
    const cam = L.camera; cam.fov = P.fov; cam.position.set(P.pos[0], P.eye, P.pos[1]);
    cam.rotation.order = 'YXZ'; cam.rotation.set(P.pitch * D2R, -P.yaw * D2R, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const o = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000, 8, 8).rotateX(-Math.PI / 2), L.makeWaterMaterial({ depthAttr: false, depth: 40, ocean: true })); o.position.set(P.pos[0], 0, P.pos[1]); o.renderOrder = 2; L.scene.add(o);
    L.cloudSea.setClumpDensity(() => .55);
    const c = cam.position; const sd = Number(QS.get('seed') || 0);
    cumulusAt(c, -24, 9, 2600, 1300, 800, 11 + sd); cumulusAt(c, 6, 5, 3600, 1600, 900, 12 + sd); cumulusAt(c, 30, 7, 2400, 900, 500, 13 + sd); cumulusAt(c, -48, 3, 4200, 1000, 450, 14 + sd);
    step(3); window.ready = true;
  }
  async function boot() {
    if (P.test === 'clouds') return bootCloudTest();
    const t0 = performance.now();
    await L.loadAll(['mage_f']);
    await L.loadLegacy(['tree_pine', 'tree_pine_lo', 'tree_oak', 'tree_oak_lo']);
    L.makeMaterials();
    L.skyInit();
    if (P.cloudY) L.cloudSea.setY(P.cloudY);
    L.setTimeOfDay(sunFor(TODN));
    const cx = P.pos[0], cz = P.pos[1]; const cy = labH(cx, cz) + P.eye;
    const cam = L.camera; cam.fov = P.fov; cam.position.set(cx, cy, cz);
    cam.rotation.order = 'YXZ'; cam.rotation.set(P.pitch * D2R, -P.yaw * D2R, 0);
    const dc = (QS.get('cam') || '').split(',').map(Number);   // dev: ?cam=x,y,z,yaw,pitch[,fov] looks around the preset's world
    if (dc.length >= 5 && dc.every(isFinite)) { cam.position.set(dc[0], dc[1], dc[2]); cam.rotation.set(dc[4] * D2R, -dc[3] * D2R, 0); if (dc[5]) cam.fov = dc[5]; }
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    L.lookFocus = P.focus ? new THREE.Vector3(P.focus[0], labH(P.focus[0], P.focus[1]), P.focus[1]) : null;
    const t1 = performance.now();
    buildTerrain(cx, cz); buildOcean(cx, cz);
    const t2 = performance.now();
    // buildings, fences
    if (PRESET === 'a') {
      towerHouse(-15.5, -62, .9); house(-46, -96, .25, 9, 7, 5, 4.5);
      tower(42, -265, 2.6, 12, 6.5, { ogive: true, skirt: true, face: 2 }); house(56, -270, .4, 11, 7, 4.5, 4); house(28, -280, -.2, 7, 6, 4, 3.5); house(74, -290, .1, 7, 6, 4, 3.5);
    }
    if (AREA === 'c') {
      const X = x => OC[0] + x, Z = z => OC[1] + z;
      tower(X(18), Z(-292), 3.2, 22, 7.5, { face: 1.2 }); house(X(34), Z(-280), .3, 12, 8, 5, 4.5); house(X(52), Z(-298), -.4, 9, 7, 4.5, 4); house(X(-2), Z(-276), .1, 10, 7, 4.5, 4);
      house(X(66), Z(-270), .6, 8, 6, 4, 3.5); house(X(-16), Z(-306), -.2, 8, 7, 4.5, 4); house(X(44), Z(-256), .9, 7, 6, 4, 3.5); house(X(-34), Z(-282), .4, 8, 6, 4, 3.5);
      house(X(70), Z(-210), .2, 8, 6, 4, 3.5);
    }
    if (PRESET === 'b') {
      const r = rnd(8); const tx = OB[0] + B_TOWN[0], tz = OB[1] + B_TOWN[1];
      tower(tx, tz, 5, 34, 11, { face: 1, skirt: true });                                       // the big mill tower
      tower(tx - 70, tz + 60, 2.6, 13, 6, {}); tower(tx + 80, tz + 40, 2.8, 14, 6.5, {}); tower(tx - 40, tz - 70, 2.4, 12, 6, {});
      for (let i = 0; i < 60; i++) { const x = tx + (r() - .5) * 240, z = tz + (r() - .5) * 190; if (labH(x, z) < 284 || L.slope(x, z) > .3 || Math.hypot(x - tx, z - tz) < 11) continue; house(x, z, Math.round(r() * 4) * Math.PI / 2 + (r() - .5) * .3, 8 + r() * 6, 6 + r() * 4, 4.5 + r() * 2.5, 4.5 + r() * 2); }
      house(OB[0] - 11, OB[1] - 150, .5, 10, 7, 4.5, 4.5);                                       // the farmhouse in the valley
      house(OB[0] + 8, OB[1] - 200, -.2, 6, 5, 3.5, 3.5); house(OB[0] - 150, OB[1] - 330, -.3, 8, 6, 4, 4); house(OB[0] - 260, OB[1] - 480, .8, 9, 7, 4.5, 4);
      house(OB[0] - 30, OB[1] - 62, .35, 15, 9, 5.5, 5.5, { roof: K.roof2 }); tower(OB[0] - 21, OB[1] - 57, 1.6, 9, 3.5, { face: 2 });   // the round-door house (left)
    }
    const hm = new THREE.Mesh(houses.geo(), L.MAT.v5); hm.castShadow = true; hm.receiveShadow = true; L.scene.add(hm);
    if (PRESET === 'a') fence([[-9, -50], [-1, -47.5], [8, -45.5]], 2.4);
    if (AREA === 'c') fence(rel(C_FENCE, OC), 2.6);
    if (PRESET === 'b') { fence(rel([[-6.5, 2], [-5.5, -6], [-7, -14], [-11, -22]], OB), 2.6); fence(rel([[3.2, -6], [4.2, -12], [6.5, -20]], OB), 2.6); }
    if (fences.P.length) { const fm = new THREE.Mesh(fences.geo(), L.MAT.v5); fm.castShadow = true; fm.receiveShadow = true; L.scene.add(fm); }
    // trees
    prepTrees(); scatterTrees(); buildTrees([cx, cz]);
    // waterfalls
    if (PRESET === 'a') for (const [sx, D, w] of FALLS_A) { const x = (sx - 700) / AF * D; addFallAt(x, aEdge(x)[2], 0, 1, w, 86); }
    if (AREA === 'c') for (const [x, z, w] of FALLS_C) addFallAt(OC[0] + x, OC[1] + z, 0, 1, w, 40);
    if (PRESET === 'b') {   // the fjord lake: an inland water surface at 205 m (same material as rivers and the sea)
      const LX = 240, LZ = -560, lg = new THREE.PlaneGeometry(520, 800, 52, 80).rotateX(-Math.PI / 2); const lp = lg.attributes.position, dep = new Float32Array(lp.count);
      for (let i = 0; i < lp.count; i++) { const x = OB[0] + LX + lp.getX(i), z = OB[1] + LZ + lp.getZ(i); dep[i] = clamp(B_LAKE.y - labH(x, z), -5, 40); }
      lg.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
      const lm = new THREE.Mesh(lg, L.makeWaterMaterial({ depthAttr: true })); lm.position.set(OB[0] + LX, B_LAKE.y, OB[1] + LZ); lm.renderOrder = 2; L.scene.add(lm);
    }
    if (PRESET === 'b') { addFallAt(OB[0] + 70, OB[1] - 520, 0, 1, 6, 205); addFallAt(OB[0] + 85, OB[1] - 1050, 0, 1, 9, 300); }
    // cloud sea: thick at cliff bases, open ocean south-east of the village terrace (preset c) and none in area B
    L.cloudSea.densityFromHeight(labH, -12000, -12000, 24000, 512, (x, z, v, dm) => {
      if (x < -3000) return 0;
      if (inC(x)) {
        const rx = x - OC[0], rz = z - OC[1];
        if (rx > 20) v *= .15 + .5 * sstep(-900, -2600, rz);                                        // open turquoise sea east of the meadow
        if (rx > -260 && rx < -20 && rz < -420 && rz > -900) v = Math.max(v, .8);                  // the plateau foot
        if (rz > -110) v *= .2;                                                                     // nothing under the meadow
        return v;
      }
      if (z < -650 && x < 700) v = Math.max(v, .78);                                               // a band of islands at the plateau foot
      if (x > 120 && z > -650) v *= .4;                                                            // open sea with a few islands right of the village
      return v;
    });
    frameClouds(cam.position);
    if (P.mist) {
      const [mx, mz, mr] = P.mist, mode = QS.get('mist') || '';
      L.mistVisual.setDisc(mx, mz, mr, { top: 900 });
      if (mode === 'open') L.mistVisual.open(.7, [[OC[0] - 60, OC[1] + 20], [OC[0] - 150, OC[1] - 420], [mx + 60, mz + 260], [mx, mz]]);
      if (mode === 'in') { const ix = mx + 60, iz = mz + 380; cam.position.set(ix, labH(ix, iz) + 14, iz); cam.rotation.set(-4 * D2R, 12 * D2R, 0); cam.updateMatrixWorld(); }
    }
    // grass + character
    L.grassInit();
    if (P.hero) await addHero(P.hero[0], P.hero[1], Math.PI - 10 * D2R, 4.6, 1.3);
    for (let i = 0; i < 400; i++) { L.grassUpdate(cx, cz, true); if (L.grassStats.buildMs < 55) break; }   // the lab shows a finished ring
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
