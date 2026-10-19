/* Lumiar v5 scatter: data-driven trees, bushes, rocks, resources and wild crops per region (SPEC table below),
   stable ids from cell coordinates (t_<u>_<v>_<layer>), near instanced buckets (hi/lo/alt) refilled only when the
   view or an item changes, and far tree impostors built in time slices.
   Models: m/trees5 + m/rocks5 (AW-nature) when present, else the v4 models and the card generators of flora.js.
   Layers: 0 trees (8 m cells), 1 undergrowth, wild crops, water plants (5.33 m cells), 2 rocks and deposits (8 m cells). */
'use strict';
(function (L) {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const TAU = Math.PI * 2;
  const now = () => performance.now();
  const TS = L.TS || 64, hash3 = L.hash3;
  const KIND = []; const KI = {}; L.KIND = KIND; L.KI = KI;
  const tiles = new Map(); L.stiles = tiles;
  const tkey = (i, j) => (i + 2048) * 8192 + (j + 2048);

  // ------------------------------------------------------------ quality: only distances and caps change (never which items exist)
  const QT = {
    alto: { near: 230, hi: 75, imp: 1900, cap: 1.25, under: 1.15 },
    medio: { near: 185, hi: 58, imp: 1450, cap: 1, under: 1 },
    baixo: { near: 135, hi: 40, imp: 950, cap: .7, under: .75 }
  };
  let Q = QT.medio;

  // ------------------------------------------------------------ species -> models (AW-nature files) and v4 fallbacks
  // model: object names in m/trees5.json or m/rocks5.json (tree LOD = <name>_lo, canopy child = <name>_leaves)
  const SPECIES = L.SPECIES = {
    pine: { file: 'trees5', model: ['pine_a', 'pine_b', 'pine_c'], lo: true, imp: true, v4: 'tree_pine' },
    round: { file: 'trees5', model: ['round_a', 'round_b', 'round_c'], lo: true, imp: true, v4: 'tree_oak' },
    lunar: { file: 'trees5', model: ['lunar_a', 'lunar_b'], lo: true, imp: true, v4: 'tree_willow' },
    bent: { file: 'trees5', model: ['bent_a'], lo: true, imp: true, v4: 'tree_pine' },
    dead: { file: 'trees5', model: ['dead_a'], lo: true, imp: true, v4: 'tree_oak' },
    bush: { file: 'trees5', model: ['bush_a', 'bush_b'], v4: 'cards' },
    bush_berry: { file: 'trees5', model: ['bush_berry'], v4: 'cards' },
    berry_bush: { file: 'trees5', model: ['bush_berry'], v4: 'cards' },
    fern: { model: [], v4: 'cards' }, reeds: { model: [], v4: 'cards' },
    wild_wheat: { model: [], v4: 'cards' }, wild_carrot: { model: [], v4: 'cards' },
    mushroom: { file: 'trees5', model: ['mush_a'], v4: 'mushroom' },
    boulder: { file: 'rocks5', model: ['boulder_a', 'boulder_b', 'boulder_c', 'boulder_d'], v4: 'rock1' },
    standing_stone: { file: 'rocks5', model: ['stone_a', 'stone_b', 'stone_c'], v4: 'rock2' },
    ore: { file: 'rocks5', model: ['ore_rock'], v4: 'rock2' },
    crystal: { file: 'rocks5', model: ['crystal_rock'], v4: 'crystal' },
    clay: { file: 'rocks5', model: ['clay_mound'], v4: 'rock1' },
    stump: { file: 'rocks5', model: ['stump'], v4: 'stump' },
    lily: { model: [], v4: 'lily' }
  };

  // ------------------------------------------------------------ per-region placement table (index = region 0..15 = r1..r16)
  // t: forest species weights, lt: lone-tree species, lone: lone-tree chance per 8 m cell on open ground,
  // dens: forest density multiplier, u: undergrowth chances per 5.33 m cell, rk: rock/deposit chances per 8 m cell,
  // pine/round: canopy palettes, gold: golden tint of broadleaf canopies, maxH: tree line, fl: flower hint (density, colours)
  const P_PINE = [0x36552f, 0x41613a, 0x4a6b3a, 0x3c5c36], P_BLUEPINE = [0x2f5550, 0x35605a, 0x3a6660, 0x2c4f4c];
  const P_ROUND = [0x6f9a34, 0x7fa83c, 0x86ad45, 0x5f8a30, 0x94b54a], P_GOLD = [0xa8a640, 0xb3aa48, 0x9c9a3c];
  const P_LUNAR = [0xcfe4e6, 0xbcdbe2, 0xe2eef0], P_BENT = [0x4d6e3a, 0x587a40, 0x46653a], P_EMBER = [0xc0763a, 0xb5652e, 0xa95a2a];
  const P_DEAD = [0x9a958c, 0x8c867c];
  const FL_MEADOW = [0xd8443a, 0x6c86d8, 0xf4f0e2, 0xf2d34a];
  const SPEC = L.SCATTER_SPEC = [
    { t: { pine: .55, round: .45 }, lt: { round: .85, pine: .15 }, lone: .006, u: { bush: .03, berry: .012, fern: .02, mush: .006, wheat: .006, carrot: .008, stump: .002 }, rk: { boulder: .012, stone: .002, clay: .002 }, fl: [.9, FL_MEADOW] },
    { t: { round: .75, pine: .25 }, lt: { round: 1 }, lone: .005, gold: .35, u: { bush: .022, berry: .01, wheat: .05, carrot: .012 }, rk: { boulder: .006 }, fl: [.7, [0xd8443a, 0xf2d34a, 0xf4f0e2]] },
    { t: { round: .4, bent: .35, pine: .25 }, lt: { bent: .6, round: .4 }, lone: .003, u: { bush: .028, reeds: .04, berry: .004 }, rk: { boulder: .03, clay: .012 }, fl: [.35, [0xf4f0e2, 0xf2d34a, 0xe7a2c4]] },
    { t: { round: .55, pine: .45 }, lt: { round: .7, pine: .3 }, lone: .004, u: { bush: .03, fern: .03, reeds: .09, mush: .01, berry: .01, carrot: .004 }, rk: { boulder: .01, clay: .02 }, fl: [.6, [0x6c86d8, 0xf4f0e2, 0xe7a2c4]] },
    { t: { pine: .8, round: .2 }, lt: { pine: 1 }, lone: .002, dens: 1.05, u: { fern: .06, bush: .025, mush: .012, berry: .006 }, rk: { boulder: .04, ore: .012, stone: .002 }, fl: [.4, FL_MEADOW] },
    { t: { round: .85, pine: .15 }, lt: { round: 1 }, lone: .012, u: { fern: .04, bush: .03, mush: .015, berry: .012, stump: .006 }, rk: { boulder: .012, stone: .012 }, fl: [.55, [0x6c86d8, 0xf4f0e2, 0xf2d34a]] },
    { t: { round: .6, pine: .4 }, lt: { round: .8, pine: .2 }, lone: .004, u: { bush: .03, berry: .008, carrot: .012, wheat: .01 }, rk: { boulder: .012 }, fl: [.6, FL_MEADOW] },
    { t: { pine: .92, dead: .03, round: .05 }, lt: { pine: 1 }, lone: .003, dens: 1.1, pine: P_BLUEPINE, u: { fern: .08, mush: .035, bush: .015, berry: .006, stump: .008 }, rk: { boulder: .015, ore: .003 }, fl: [.2, [0x6c86d8, 0xf4f0e2]] },
    { t: { pine: .6, round: .4 }, lt: { round: .6, pine: .4 }, lone: .004, u: { bush: .03, fern: .03, berry: .01 }, rk: { boulder: .015, crystal: .006 }, fl: [.5, FL_MEADOW] },
    { t: { pine: .7, bent: .2, round: .1 }, lt: { pine: .6, bent: .4 }, lone: .003, u: { bush: .02, fern: .02 }, rk: { boulder: .04, ore: .02 }, fl: [.3, [0xf2d34a, 0xf4f0e2]] },
    { t: { lunar: .85, round: .1, pine: .05 }, lt: { lunar: 1 }, lone: .005, u: { fern: .05, mush: .04, bush: .015 }, rk: { boulder: .01, crystal: .012 }, fl: [.45, [0xbfe0ff, 0xf4f0e2, 0x9fb4ff]] },
    { t: { dead: .45, bent: .25, round: .3 }, lt: { dead: .6, round: .4 }, lone: .003, round: P_EMBER, u: { bush: .01 }, rk: { boulder: .05, ore: .03, crystal: .006 }, fl: [.15, [0xf08a3a, 0xf2d34a]] },
    { t: { bent: .55, pine: .45 }, lt: { bent: 1 }, lone: .003, maxH: 820, u: { bush: .01 }, rk: { boulder: .05, ore: .015, crystal: .01, stone: .003 }, fl: [.25, [0xf4f0e2, 0x9fb4ff]] },
    { t: { round: .9, dead: .1 }, lt: { round: .9, dead: .1 }, lone: .005, gold: .55, round: P_GOLD, u: { bush: .015, wheat: .03 }, rk: { boulder: .012 }, fl: [.5, [0xf2d34a, 0xf08a3a, 0xf4f0e2]] },
    { t: { bent: .7, pine: .3 }, lt: { bent: 1 }, lone: .006, u: { bush: .02, berry: .005 }, rk: { boulder: .02, stone: .01 }, fl: [.8, [0x6c86d8, 0xf4f0e2, 0xf2d34a, 0xd8443a]] },
    { t: { pine: .5, round: .3, dead: .2 }, lt: { pine: .5, dead: .5 }, lone: .003, u: { fern: .03, mush: .02, bush: .015 }, rk: { boulder: .02, stone: .006 }, fl: [.3, [0xf4f0e2, 0x9fb4ff]] },
  ];
  const _cc = new THREE.Color();
  const pm = (a, arr) => arr[((a % arr.length) + arr.length) % arr.length];   // palette pick (cell indices can be negative)
  const pal = arr => arr.map(h => new THREE.Color(h));
  for (const S of SPEC) { S.dens = S.dens || 1; S.maxH = S.maxH || 960; S.palPine = pal(S.pine || P_PINE); S.palRound = pal(S.round || P_ROUND); }
  const PAL = { lunar: pal(P_LUNAR), bent: pal(P_BENT), dead: pal(P_DEAD), gold: new THREE.Color(0xc9b450), light: new THREE.Color(0xa6c95a) };
  const BUSHG = pal([0x5c8a32, 0x6a9a38, 0x4f7f2e, 0x76a33e]);

  // flower hint for the grass/flower modules: density 0..1 and the region's flower colours (hex)
  L.flowerHint = function (x, z, out) {
    out = out || {}; const S = SPEC[L.region(x, z)] || SPEC[0];
    out.d = clamp(L.meadowAt(x, z) * S.fl[0] * 1.4, 0, 1); out.pal = S.fl[1]; return out;
  };

  // ------------------------------------------------------------ exclusion discs (villages, POI flats, landmarks)
  // radius per POI kind for trees; undergrowth uses 70 %, rocks 85 %
  const EXR = { village: 120, plaza: 160, keep: 260, gate: 45, seat: 30, house: 24, cottage: 26, windmill_group: 70, windmill: 26, watermill: 28, lighthouse: 40, forge: 40,
    tower: 26, camp: 16, travel_totem: 12, spawn: 18, well: 10, hut: 18, cabin: 18, picnic: 12, bench: 8, viewpoint: 12, shrine: 10, totem: 10, totem_ring: 22, totem_row: 18,
    standing_stones: 16, flowerfield: 34, hot_spring: 22, pier: 14, haystacks: 24, mushroom_ring: 10, garden: 26, nest: 14, house_ruin: 16, ruin: 14, cart: 8, beehive: 6,
    sign: 8, mist: 0, creature: 6, grove: 0, glade: 30, meadow: 40, trail: 0, post: 16, cave: 10, item: 4, chest_underwater: 0, waterfall: 10, bridge: 12, rope_bridge: 12, islet: 0 };
  const EXC = 128; let EXN = 0, EXG = new Map();
  function buildExclusion() {
    EXG = new Map(); const WS = L.WS; EXN = Math.ceil(2 * WS / EXC);
    for (const p of L.POIS || []) {
      const r = Math.max(EXR[p.kind] != null ? EXR[p.kind] : 10, (p.flat || 0) * 1.1); if (r <= 0) continue;
      const i0 = Math.floor((p.x - r + WS) / EXC), i1 = Math.floor((p.x + r + WS) / EXC), j0 = Math.floor((p.z - r + WS) / EXC), j1 = Math.floor((p.z + r + WS) / EXC);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * EXN + i; let a = EXG.get(k); if (!a) EXG.set(k, a = []); a.push(p.x, p.z, r); }
    }
  }
  function excluded(x, z, f) {
    const a = EXG.get(Math.floor((z + L.WS) / EXC) * EXN + Math.floor((x + L.WS) / EXC)); if (!a) return false;
    for (let q = 0; q < a.length; q += 3) { const dx = x - a[q], dz = z - a[q + 1], r = a[q + 2] * f; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  }

  // ------------------------------------------------------------ deterministic placement
  const INF = {};
  const OOB = () => L.OOB || L.WS * .96;
  function slopeAt(x, z, h) { return Math.hypot(L.rawH(x + 1.5, z) - h, L.rawH(x, z + 1.5) - h) / 1.5; }
  function pickW(w, r) { let tot = 0; for (const k in w) tot += w[k]; let q = r * tot; for (const k in w) { q -= w[k]; if (q < 0) return k; } return null; }
  const VARS = { pine: 3, round: 3, lunar: 2, bent: 1, dead: 1, bush: 2, boulder: 2, standing_stone: 2 };
  const _tw = {};
  const TG = 8, TCELL = TS / TG;   // tree cells
  // tree candidates of tile (i,j): cb(species, variant, x, y, z, s, ry, colour, id). Shared by near items and impostors.
  function treeScan(i, j, cb) {
    const oob = OOB();
    for (let b = 0; b < TG; b++) for (let a = 0; a < TG; a++) {
      const u = i * TG + a, v = j * TG + b; const r0 = hash3(u, v, 1);
      if (r0 > .9) continue;
      const x = (u + .15 + hash3(u, v, 2) * .7) * TCELL, z = (v + .15 + hash3(u, v, 3) * .7) * TCELL;
      if (x < -oob || x > oob || z < -oob || z > oob) continue;
      const f = L.forestAt(x, z); const S = SPEC[L.region(x, z)] || SPEC[0];
      const pf = sstep(.12, .62, f) * .82 * S.dens, pl = S.lone * (1 - sstep(.08, .35, f));
      if (r0 >= pf + pl) continue;
      const lone = r0 >= pf;
      if (excluded(x, z, 1)) continue;
      const h = L.heightInfo(x, z, INF).h;
      if (h < 1.2 || INF.pad > .02 || INF.pd < 2.6 || INF.rd < INF.rw * .5 + 2.5) continue;
      const lk = L.lakeAt(x, z); if (lk && h < lk.level + .4) continue;
      if (h > S.maxH - 60 * hash3(u, v, 8)) continue;
      const sl = slopeAt(x, z, h); if (sl > .95) continue;
      // species: pines like slopes and height, broadleaf trees like flat ground
      const W = lone ? S.lt : S.t; for (const k in _tw) delete _tw[k];
      for (const k in W) { let w = W[k]; if (k === 'pine' || k === 'bent') w *= 1 + sl * 1.6 + sstep(350, 700, h) * .8; else if (k === 'round' || k === 'lunar') w *= Math.max(.05, 1 - sl * .9); _tw[k] = w; }
      const sp = pickW(_tw, hash3(u, v, 4)); if (!sp) continue;
      if ((sp === 'round' || sp === 'lunar') && sl > .7) continue;
      const nv = VARS[sp] || 1; const vr = Math.min(nv - 1, Math.floor(hash3(u, v, 9) * nv));
      const rs = hash3(u, v, 5), rc = hash3(u, v, 6); let s = .82 + rs * .36, col;
      if (sp === 'pine') { col = _cc.copy(pm(u * 7 + v * 3, S.palPine)).lerp(PAL.light, rc * .12); if (lone) s *= 1.08; }
      else if (sp === 'round') { col = _cc.copy(pm(u * 5 + v * 11, S.palRound)).lerp(PAL.light, rc * .25); if (S.gold) col.lerp(PAL.gold, S.gold * (.6 + rc * .4)); if (lone) s *= 1.12; }
      else if (sp === 'lunar') col = _cc.copy(pm(u + v, PAL.lunar));
      else if (sp === 'bent') { col = _cc.copy(pm(u * 3 + v, PAL.bent)); s *= .9; }
      else col = _cc.copy(pm(u + v, PAL.dead));
      cb(sp, vr, x, h - .15, z, s, hash3(u, v, 7) * TAU, col, 't_' + u + '_' + v + '_0');
    }
  }
  L.treeScan = treeScan;

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _y = new THREE.Vector3(0, 1, 0);
  const WHITE = [1, 1, 1];
  function makeItem(kind, vr, x, y, z, s, ry, col, id, extra) {
    const K = KIND[KI[kind]]; if (!K) return null;
    _p.set(x, y, z); _q.setFromAxisAngle(_y, ry); _s.set(s, s * (extra && extra.sy || 1), s); _m.compose(_p, _q, _s);
    const it = { k: K.idx, v: (vr | 0) % K.vars.length, kind, x, y, z, s, ry, col: col ? [col.r, col.g, col.b] : WHITE, id, m: new Float32Array(_m.elements), res: K.res || null, kindRes: K.res || null, gone: false };
    if (K.r) it.r = K.r * s;
    if (extra) Object.assign(it, extra);
    return it;
  }
  function genTile(i, j) {
    const items = []; const x0 = i * TS, z0 = j * TS, oob = OOB();
    const push = it => { if (it) items.push(it); };
    treeScan(i, j, (sp, vr, x, y, z, s, ry, col, id) => push(makeItem(sp, vr, x, y, z, s, ry, col, id)));
    // ---- undergrowth, wild crops, water plants (5.33 m cells)
    const G = 12, st = TS / G;
    for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
      const u = i * G + a, v = j * G + b; const r0 = hash3(u, v, 11); if (r0 > .5) continue;
      const x = x0 + (a + hash3(u, v, 12)) * st, z = z0 + (b + hash3(u, v, 13)) * st;
      if (x < -oob || x > oob || z < -oob || z > oob) continue;
      if (excluded(x, z, .7)) continue;
      const S = SPEC[L.region(x, z)] || SPEC[0], U = S.u;
      const h = L.heightInfo(x, z, INF).h; if (INF.pad > .05 || INF.pd < .8) continue;
      let kind = null, s = .8 + hash3(u, v, 15) * .5, col = null, y = h, vr = 0;
      const lk = L.lakeAt(x, z); const bankR = INF.rd - INF.rw * .5;
      if (lk && h < lk.level - .25) {                                            // lake: lilies in the shallows
        const dep = lk.level - h; if (dep > .3 && dep < 2.4 && r0 < (U.reeds ? .07 : .02)) { kind = 'lily'; y = lk.level + .03; s = .7 + hash3(u, v, 15) * .8; vr = hash3(u, v, 14) < .3 ? 1 : 0; }
      } else if (h < .6 || bankR < .6) continue;                                 // sea, beach line, river bed
      else if ((lk && h < lk.level + .9) || bankR < 4.5 || (h < 3 && L.wetAt(x, z) > .3)) {   // shores: reeds
        if (r0 < (U.reeds || .015) * 2.5 + L.wetAt(x, z) * .12) { kind = 'reeds'; s = .8 + hash3(u, v, 15) * .5; }
      } else {
        const sl = slopeAt(x, z, h); if (sl > .75) continue;
        const f = L.forestAt(x, z), me = L.meadowAt(x, z), edge = sstep(.08, .35, f) * (1 - sstep(.55, .85, f));
        const pB = (U.bush || 0) * (.45 + edge * 1.6), pBe = (U.berry || 0) * (.4 + edge * 1.8), pF = (U.fern || 0) * sstep(.2, .65, f) * 2.2;
        const pM = (U.mush || 0) * sstep(.3, .8, f) * 2.2, pSt = (U.stump || 0) * sstep(.3, .7, f) * 2;
        const pW = (U.wheat || 0) * sstep(.5, .64, L.vnoise(x * .016 + 7.3, z * .016 - 3.1)) * 6 * (1 - f) * (.4 + me);
        const pC = (U.carrot || 0) * sstep(.56, .68, L.vnoise(x * .021 - 11.7, z * .021 + 5.2)) * 6 * (1 - f) * (.4 + me);
        let q = r0;
        if ((q -= pB) < 0) { kind = 'bush'; vr = hash3(u, v, 14) < .5 ? 0 : 1; s = .75 + hash3(u, v, 15) * .6; col = _cc.copy(pm(u + v * 3, BUSHG)).lerp(PAL.light, hash3(u, v, 16) * .3); if (S.gold) col.lerp(PAL.gold, S.gold * .6); }
        else if ((q -= pBe) < 0) { kind = 'berry_bush'; s = .8 + hash3(u, v, 15) * .4; col = _cc.copy(pm(u * 3 + v, BUSHG)); }
        else if ((q -= pF) < 0) { kind = 'fern'; s = .8 + hash3(u, v, 15) * .6; col = _cc.set(0x5a8f36).lerp(PAL.light, hash3(u, v, 16) * .5); }
        else if ((q -= pM) < 0) { kind = 'mushroom'; s = .6 + hash3(u, v, 15) * .9; }
        else if ((q -= pSt) < 0) { kind = 'stump'; s = .8 + hash3(u, v, 15) * .5; }
        else if ((q -= pW) < 0) { kind = 'wild_wheat'; s = .85 + hash3(u, v, 15) * .35; col = _cc.set(0xd9c45e).lerp(PAL.gold, hash3(u, v, 16) * .4); }
        else if ((q -= pC) < 0) { kind = 'wild_carrot'; s = .85 + hash3(u, v, 15) * .4; col = _cc.set(0x6f9e3a); }
      }
      if (kind) push(makeItem(kind, vr, x, y, z, s, hash3(u, v, 17) * TAU, col, 't_' + u + '_' + v + '_1'));
    }
    // ---- rocks, standing stones, ore, crystals, clay (8 m cells)
    const G2 = 8, st2 = TS / G2;
    for (let b = 0; b < G2; b++) for (let a = 0; a < G2; a++) {
      const u = i * G2 + a, v = j * G2 + b; const r0 = hash3(u, v, 21); if (r0 > .3) continue;
      const x = x0 + (a + hash3(u, v, 22)) * st2, z = z0 + (b + hash3(u, v, 23)) * st2;
      if (x < -oob || x > oob || z < -oob || z > oob) continue;
      if (excluded(x, z, .85)) continue;
      const S = SPEC[L.region(x, z)] || SPEC[0], R = S.rk;
      const h = L.heightInfo(x, z, INF).h; if (h < .3 || INF.pad > .05 || INF.pd < 1.5 || INF.rd < INF.rw * .5 + 1.5) continue;
      const lk = L.lakeAt(x, z); if (lk && h < lk.level + .2) continue;
      const sl = slopeAt(x, z, h); if (sl > 1.6) continue;
      const cliff = sstep(.45, 1.2, sl), wet = L.wetAt(x, z);
      const pBo = (R.boulder || 0) * (.6 + cliff * 5), pSt = (R.stone || 0) * (1 - cliff), pO = (R.ore || 0) * (.35 + cliff * 2.5);
      const pCr = (R.crystal || 0) * (.6 + sstep(400, 800, h)), pCl = (R.clay || 0) * (.3 + wet * 2.5) * (1 - cliff);
      let q = r0, kind = null, s = 1, col = null, vr = 0, extra = null;
      if ((q -= pCr) < 0) { kind = 'crystal'; s = .8 + hash3(u, v, 25) * 1.1; }
      else if ((q -= pO) < 0) { kind = 'ore'; s = .7 + hash3(u, v, 25) * .6; extra = { sy: .85 }; }
      else if ((q -= pCl) < 0) { kind = 'clay'; s = .9 + hash3(u, v, 25) * .5; }
      else if ((q -= pSt) < 0) { kind = 'standing_stone'; vr = Math.floor(hash3(u, v, 24) * 4); s = .8 + hash3(u, v, 25) * .5; }
      else if ((q -= pBo) < 0) { kind = 'boulder'; vr = Math.floor(hash3(u, v, 24) * 4); s = .5 + hash3(u, v, 25) * (1.1 + cliff * 1.4); col = S === SPEC[11] ? _cc.set(0xd89a74) : null; extra = { sy: .85 }; }
      if (kind) push(makeItem(kind, vr, x, h - s * .15, z, s, hash3(u, v, 26) * TAU, col, 't_' + u + '_' + v + '_2', extra));
    }
    const cx = x0 + TS / 2, cz = z0 + TS / 2; let ymn = 1e9, ymx = -1e9;
    for (const it of items) { if (it.y < ymn) ymn = it.y; if (it.y > ymx) ymx = it.y; }
    if (!items.length) { ymn = ymx = L.rawH(cx, cz); }
    const t = { i, j, items, sphere: new THREE.Sphere(new THREE.Vector3(cx, (ymn + ymx) / 2 + 8, cz), Math.hypot(TS * .72, (ymx - ymn) / 2 + 14) + 6) };
    if (L.extraItems) { const ex = L.extraItems(i, j); if (ex) for (const e of ex) push(makeItem(e.kind, e.v || 0, e.x, e.y, e.z, e.s, e.ry || 0, e.col || null, e.id, e.extra)); }
    for (const it of items) { if (it.kindRes && L.applyCut) L.applyCut(it); it._g = it.gone; }
    return t;
  }
  function getTile(i, j) { const k = tkey(i, j); let t = tiles.get(k); if (!t) { t = genTile(i, j); tiles.set(k, t); } return t; }
  L.stile = (x, z) => tiles.get(tkey(Math.floor(x / TS), Math.floor(z / TS)));
  L.scatterTile = getTile;
  L.nearby = function (x, z, r, fn) {
    const i0 = Math.floor((x - r) / TS), i1 = Math.floor((x + r) / TS), j0 = Math.floor((z - r) / TS), j1 = Math.floor((z + r) / TS);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const t = tiles.get(tkey(i, j)); if (!t) continue; for (const it of t.items) fn(it); if (t.dyn) for (const it of t.dyn) fn(it); }
  };
  L.forEachLoaded = function (fn) { for (const t of tiles.values()) for (const it of t.items) fn(it); };
  L.itemMatrix = function (it, sc, shake) { // rebuild matrix (scale/shake) after state changes
    const s = it.s * Math.max(sc, 1e-4); _p.set(it.x, it.y, it.z); _e.set(shake ? Math.sin(shake * 40) * .04 * (1 - shake) : 0, it.ry, shake ? Math.cos(shake * 37) * .04 * (1 - shake) : 0); _q.setFromEuler(_e); _s.set(s, s * (it.sy || 1), s); _m.compose(_p, _q, _s); it.m.set(_m.elements);
    dirty = true;
  };
  L.scatterDirty = () => { dirty = true; };

  // ------------------------------------------------------------ geometry: AW-nature models when loaded, else v4 models + cards
  const SRC = {};           // loaded AW-nature scenes: { trees5, rocks5 }
  const nodeOf = (file, name) => { const s = SRC[file]; if (!s) return null; let o = null; s.traverse(c => { if (!o && c.name === name) o = c; }); return o; };
  // merge an object's meshes (baked relative to the object) into geometries grouped by key(meshName)
  function flat(obj, keyOf, skip) {
    const groups = {}; obj.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(); const mm = new THREE.Matrix4();
    obj.traverse(o => {
      if (!o.isMesh || (skip && skip(o.name))) return;
      const key = keyOf(o.name); const g = o.geometry.clone(); mm.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(mm);
      const n = g.index ? g.toNonIndexed() : g; const c = new THREE.BufferGeometry(); c.setAttribute('position', n.attributes.position);
      if (n.attributes.normal) c.setAttribute('normal', n.attributes.normal); else c.computeVertexNormals();
      const cnt = n.attributes.position.count; let col = n.attributes.color;
      if (!col) col = new THREE.Float32BufferAttribute(new Float32Array(cnt * 3).fill(1), 3);
      else if (col.itemSize === 4 || col.normalized) { const b = new Float32Array(cnt * 3); const sc = col.normalized ? (col.array instanceof Uint8Array ? 1 / 255 : col.array instanceof Uint16Array ? 1 / 65535 : 1) : 1; for (let q = 0; q < cnt; q++) { b[q * 3] = col.getX(q) * sc; b[q * 3 + 1] = col.getY(q) * sc; b[q * 3 + 2] = col.getZ(q) * sc; } col = new THREE.BufferAttribute(b, 3); }
      c.setAttribute('color', col); c.setAttribute('uv', n.attributes.uv || new THREE.Float32BufferAttribute(new Float32Array(cnt * 2), 2));
      (groups[key] = groups[key] || []).push(c);
    });
    const out = {}; for (const k in groups) out[k] = groups[k].length === 1 ? groups[k][0] : THREE.BufferGeometryUtils.mergeBufferGeometries(groups[k], false);
    return out;
  }
  const v4has = n => !!(L.M && L.M[n]);
  const v4flat = (n, keyOf) => flat(L.M[n], keyOf);
  const treeKey = n => /leaves|canopy/.test(n) ? 'leaves' : /glow/.test(n) ? 'glow' : /fruit|berr/.test(n) ? 'fruit' : 'bark';
  const v4part = n => n === 'canopy' ? 'canopy' : n === 'berries' ? 'berries' : 'bark';
  const xform = (g, m) => { if (g) g.applyMatrix4(m); return g; };
  const shear = (k, sy) => new THREE.Matrix4().set(1, k, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const scaleM = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z == null ? x : z);
  function cylBark(H, r0, r1, seg) { const g = new THREE.CylinderGeometry(r1, r0, H, seg || 6, 1, true).toNonIndexed(); g.translate(0, H / 2, 0); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(.8), 3)); return g; }
  const ATL = { round: { n: 96, size: [1.5, 2.3], quads: [0, 1] }, pine: { n: 70, size: [1.05, 1.55], quads: [2], inset: .2 }, lunar: { n: 96, size: [1.5, 2.1], quads: [0, 1], hang: { below: .42, quad: 3, aspect: 1.9, p: .55 } } };
  function cardTree(name, A, seed, m) {   // v4 Blender tree -> bark + canopy cards (hi) and sparser cards (lo)
    const hi = v4flat(name, v4part), lo = v4has(name + '_lo') ? v4flat(name + '_lo', v4part) : hi;
    if (m) { for (const k in hi) xform(hi[k], m); if (lo !== hi) for (const k in lo) xform(lo[k], m); }
    const canopy = hi.canopy ? L.canopyCards(hi.canopy, Object.assign({ seed }, A)) : null;
    const canLo = (lo.canopy || hi.canopy) ? L.canopyCards(lo.canopy || hi.canopy, Object.assign({}, A, { seed: seed + 74, n: Math.ceil(A.n * .34), size: [A.size[0] * 1.5, A.size[1] * 1.6], inset: .12 })) : null;
    return { parts: { canopy, bark: hi.bark }, lo: { canopy: canLo, bark: lo.bark || hi.bark } };
  }
  function nature5Tree(name) {   // AW-nature tree: trunk <name> + child <name>_leaves (+ <name>_glow), LOD <name>_lo
    const o = nodeOf('trees5', name); if (!o) return null;
    const hi = flat(o, treeKey, n => n.startsWith(name + '_lo')); const ol = nodeOf('trees5', name + '_lo'); const lo = ol ? flat(ol, treeKey) : null;
    const v = { parts: Object.assign({}, hi), lo: lo ? Object.assign({}, lo) : null };
    if (hi.leaves && L.canopyCards) v.parts.canopy = L.canopyCards(hi.leaves, { seed: name.length * 13, n: 48, size: [1.1, 1.8], quads: /^(pine|bent)/.test(name) ? [2] : [0, 1], inset: .3 });
    return v;
  }
  function stdTreeVar(sp, vi) {
    const f = SPECIES[sp]; const n5 = SRC.trees5 && f.model[vi % f.model.length]; const v5 = n5 ? nature5Tree(n5) : null; if (v5) return v5;
    if (sp === 'pine' || sp === 'bent') {
      const H = sp === 'bent' ? 9 : [12, 16.5, 8][vi], m = sp === 'bent' ? shear(.34, .8) : null, seed = 5 + vi * 7 + (sp === 'bent' ? 40 : 0);
      if (L.pineCards) { const a = L.pineCards({ h: H, seed }), b = L.pineCards({ h: H, seed, lo: true }); if (m) { xform(a.canopy, m); xform(a.bark, m); xform(b.canopy, m); xform(b.bark, m); } return { parts: { canopy: a.canopy, bark: a.bark }, lo: { canopy: b.canopy, bark: b.bark } }; }
      if (v4has('tree_pine')) { const sc = [1, 1.35, .72][vi] || 1; return cardTree('tree_pine', ATL.pine, 17 + vi * 11, m ? m.clone().multiply(scaleM(sc, sc)) : scaleM(sc, sc)); }
    }
    if (sp === 'round' && v4has('tree_oak')) { const sc = [1.05, 1.35, .75][vi]; return cardTree('tree_oak', ATL.round, 17 + vi * 12, scaleM(sc, sc)); }
    if (sp === 'lunar' && v4has('tree_willow')) { const sc = [1, 1.25][vi]; return cardTree('tree_willow', ATL.lunar, 23 + vi * 9, scaleM(sc, sc)); }
    if (sp === 'dead' && v4has('tree_oak')) { const b = v4flat('tree_oak', v4part).bark; xform(b, scaleM(1.15, 1.1)); return { parts: { bark: b }, lo: null }; }
    return { parts: { bark: cylBark(sp === 'pine' ? 7 : 4, .25, .12) }, lo: null };   // last resort
  }
  function bushVar(vi, berries) {
    const name = berries ? 'bush_berry' : ['bush_a', 'bush_b'][vi];
    const o = nodeOf('trees5', name); if (o) { const p = flat(o, treeKey); return { parts: p, alt: berries ? { leaves: p.leaves, bark: p.bark } : null }; }
    const r = L.mulberry32(berries ? 3 : 3 + vi * 5); const blobs = [[0, .55, 0, .75, .55, .75]]; const n = 2 + Math.floor(r() * 3);
    for (let q = 0; q < n; q++) { const a = r() * TAU, d = .35 + r() * .35; blobs.push([Math.cos(a) * d, .45 + r() * .3, Math.sin(a) * d, .45 + r() * .3, .38 + r() * .2, .45 + r() * .3]); }
    const plain = L.blobCards(blobs, { n: 60, size: [.62, .95], quads: [0, 1], seed: 5 + vi, inset: .3 });
    if (!berries) return { parts: { canopy: plain } };
    const fruit = L.blobCards(blobs, { n: 60, size: [.62, .95], quads: [0, 1], extra: { quad: 7, p: .34, top: .25 }, seed: 5, inset: .3 });
    return { parts: { canopy: fruit }, alt: { canopy: plain } };
  }
  function rockVar(sp, vi) {
    const f = SPECIES[sp]; const n5 = SRC.rocks5 && f.model[vi % f.model.length]; const o = n5 ? nodeOf('rocks5', n5) : null;
    if (o) { const p = flat(o, n => /glow/.test(n) ? 'glow' : sp === 'crystal' ? 'crystal' : 'rock'); return { parts: p, lo: null }; }
    const base = (sp === 'boulder' && vi === 1) || sp === 'standing_stone' || sp === 'ore' ? 'rock2' : 'rock1';
    if (!v4has(base)) { const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(); g.translate(0, .6, 0); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(.85), 3)); return { parts: { rock: g }, lo: null }; }
    const hi = v4flat(base, () => 'rock').rock, lo = v4has(base + '_lo') ? v4flat(base + '_lo', () => 'rock').rock : null;
    let m = null;
    if (sp === 'standing_stone') m = new THREE.Matrix4().makeRotationZ(vi ? .08 : -.05).multiply(scaleM(.55, vi ? 2.6 : 2.1, .5));
    if (sp === 'clay') m = scaleM(1.35, .3, 1.15);
    if (m) { xform(hi, m); if (lo) xform(lo, m); }
    const v = { parts: { rock: hi }, lo: lo ? { rock: lo } : null };
    if (sp === 'ore') { const nug = nuggets(hi, 16, 11); v.parts.nug = nug; if (lo) v.lo.nug = nug; }
    return v;
  }
  // shiny metal nuggets stuck on a rock's upper surface (ore nodes read clearly from afar)
  function nuggets(geo, n, seed) {
    const r = L.mulberry32(seed); const P = geo.attributes.position, N = geo.attributes.normal; const cnt = P.count; const out = []; const v = new THREE.Vector3(), nn = new THREE.Vector3();
    let tries = 0;
    while (out.length < n && tries++ < 4000) {
      const i = Math.floor(r() * cnt); nn.fromBufferAttribute(N, i); if (nn.y < -.1) continue; v.fromBufferAttribute(P, i); if (v.y < .15) continue;
      const g = new THREE.IcosahedronGeometry(.1 + r() * .14, 0); g.scale(1, .7 + r() * .5, 1); g.rotateY(r() * 6.28); g.rotateX((r() - .5) * .8);
      g.translate(v.x - nn.x * .03, v.y - nn.y * .03, v.z - nn.z * .03); out.push(g.index ? g.toNonIndexed() : g);
    }
    const m = THREE.BufferGeometryUtils.mergeBufferGeometries(out.map(g => { const c = new THREE.BufferGeometry(); c.setAttribute('position', g.attributes.position); c.setAttribute('normal', g.attributes.normal); return c; }));
    m.computeVertexNormals(); return m;
  }

  // ------------------------------------------------------------ kinds
  // def: { vars: [{parts, lo, alt}], fol (canopy material), tint: {part: 1}, dHi, dMax, shadow, h, rad, res, r, tree, imp, cap: [hi, lo] }
  let FOL = null, MATS = null, STUMP = null;
  function makeMats() {
    const M = L.MAT || {};
    const fol = o => L.makeFoliageMat ? L.makeFoliageMat(o) : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    FOL = L.FOL = L.FOL || { def: fol({ wind: 1 }), big: fol({ wind: .5 }), bush: fol({ wind: .35 }), low: fol({ wind: .8 }) };
    if (!FOL.lunar) { FOL.lunar = fol({ wind: .7 }); if (FOL.lunar.emissive) { FOL.lunar.emissive.setHex(0x7fd8ff); FOL.lunar.emissiveIntensity = 0; } }
    if (!FOL.wheat) FOL.wheat = fol({ wind: 1.3 });
    if (!MATS) {
      const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
      if (L.stylize) L.stylize(solid, { wrap: .5, rim: .35, transl: .3 }); if (L.addWind) L.addWind(solid, .5, 1.3);
      const plain = M.plain || new THREE.MeshLambertMaterial({ vertexColors: true });
      const glow = M.glow || new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2, 2, 2) });
      MATS = { leaves: solid, bark: M.bark || plain, rock: M.rock || plain, nug: M.ore || plain, crystal: M.crystal || plain, cap: M.mushCap || plain, stem: plain, pad: plain, flower: plain, fruit: plain, berries: plain, glow };
    }
  }
  function addKind(name, def) {
    def.name = name; def.idx = KIND.length; KIND.push(def); KI[name] = def.idx;
    def.dHi0 = def.dHi; def.dMax0 = def.dMax; return def;
  }
  function matFor(K, p) { if (p === 'canopy') return K.fol || FOL.def; return MATS[p] || MATS.bark; }
  function buildKinds() {
    const tree = (sp, fol, cap) => addKind(sp, { tree: true, imp: true, res: 'tree', r: .55, fol, vars: [...Array(VARS[sp] || 1)].map((_, i) => stdTreeVar(sp, i)), tint: { canopy: 1, leaves: 1, bark: sp === 'dead' ? 1 : 0 }, dHi: 1, dMax: 1, shadow: true, h: 14, rad: 5, cap });
    tree('pine', FOL.def, [260, 1200]); tree('round', FOL.def, [240, 1000]); tree('lunar', FOL.lunar, [220, 900]); tree('bent', FOL.def, [120, 500]); tree('dead', FOL.def, [80, 300]);
    const fr = (o) => L.frondGeo(o);
    addKind('bush', { res: 'fibra', r: .7, fol: FOL.bush, vars: [bushVar(0), bushVar(1)], tint: { canopy: 1, leaves: 1 }, dHi: 1e9, dMax: 140, shadow: true, h: 1.4, rad: 1.4, cap: [500, 0] });
    addKind('berry_bush', { res: 'bush', r: .7, fol: FOL.bush, vars: [bushVar(0, true)], tint: { canopy: 1, leaves: 1 }, dHi: 1e9, dMax: 130, shadow: true, h: 1.4, rad: 1.4, cap: [260, 0] });
    addKind('fern', { res: 'fibra1', r: .5, fol: FOL.low, vars: [{ parts: { canopy: fr({ n: 10, len: [.75, 1.25], tilt: [.45, 1.05], quads: [4], aspect: .42, droop: .45, seed: 4 }) } }], tint: { canopy: 1 }, dHi: 1e9, dMax: 85, shadow: false, h: .9, rad: 1.2, cap: [700, 0] });
    addKind('reeds', { res: 'fibra', r: .5, fol: FOL.low, vars: [{ parts: { canopy: fr({ n: 9, len: [1.2, 1.9], tilt: [1.2, 1.5], quads: [6], aspect: .55, droop: .12, spread: .5, seed: 6 }) } }], tint: {}, dHi: 1e9, dMax: 105, shadow: false, h: 1.7, rad: 1.2, cap: [600, 0] });
    const wheat = fr({ n: 16, len: [.8, 1.15], tilt: [1.3, 1.52], quads: [6], aspect: .5, droop: .18, spread: .45, seed: 31 }), stub = fr({ n: 10, len: [.16, .26], tilt: [1.2, 1.5], quads: [6], aspect: .5, droop: .05, spread: .4, seed: 32 });
    addKind('wild_wheat', { res: 'fibra1', r: .5, fol: FOL.wheat, vars: [{ parts: { canopy: wheat }, alt: { canopy: stub } }], tint: { canopy: 1 }, dHi: 1e9, dMax: 95, shadow: false, h: 1.1, rad: 1, cap: [700, 0] });
    const carrot = fr({ n: 8, len: [.32, .55], tilt: [.6, 1.15], quads: [4], aspect: .45, droop: .4, seed: 33 }), carrotLo = fr({ n: 4, len: [.15, .25], tilt: [.6, 1.1], quads: [4], aspect: .45, droop: .3, seed: 34 });
    addKind('wild_carrot', { res: 'fibra1', r: .45, fol: FOL.low, vars: [{ parts: { canopy: carrot }, alt: { canopy: carrotLo } }], tint: { canopy: 1 }, dHi: 1e9, dMax: 75, shadow: false, h: .6, rad: .8, cap: [300, 0] });
    const mo = nodeOf('trees5', 'mush_a'); const mush = mo ? flat(mo, n => /glow/.test(n) ? 'glow' : /cap/.test(n) ? 'cap' : 'stem') : v4has('mushroom') ? v4flat('mushroom', n => n === 'cap' ? 'cap' : 'stem') : null;
    if (mush) addKind('mushroom', { res: 'mush', r: .4, vars: [{ parts: mush }], tint: {}, dHi: 1e9, dMax: 80, shadow: false, h: .6, rad: .6, cap: [260, 0] });
    const so = nodeOf('rocks5', 'stump'); STUMP = so ? flat(so, () => 'bark').bark : v4has('stump') ? v4flat('stump', () => 'bark').bark : cylBark(.6, .3, .26, 7);
    addKind('stump', { res: null, r: .5, vars: [{ parts: { bark: STUMP } }], tint: {}, dHi: 1e9, dMax: 95, shadow: true, h: .8, rad: .8, cap: [160, 0] });
    addKind('boulder', { res: 'rock', r: .95, vars: [rockVar('boulder', 0), rockVar('boulder', 1)], tint: { rock: 1 }, dHi: 70, dMax: 260, shadow: true, h: 1.6, rad: 1.9, cap: [220, 600] });
    addKind('standing_stone', { res: 'rock', r: .7, vars: [rockVar('standing_stone', 0), rockVar('standing_stone', 1)], tint: { rock: 1 }, dHi: 80, dMax: 300, shadow: true, h: 3, rad: 1.8, cap: [60, 160] });
    addKind('ore', { res: 'ore', r: .95, vars: [rockVar('ore', 0)], tint: { rock: 1 }, dHi: 70, dMax: 220, shadow: true, h: 1.6, rad: 1.9, cap: [100, 260] });
    const cry = nodeOf('rocks5', 'crystal_rock') ? rockVar('crystal', 0) : v4has('crystal') ? { parts: { crystal: v4flat('crystal', () => 'crystal').crystal } } : rockVar('crystal', 0);
    addKind('crystal', { res: 'crystal', r: .5, vars: [cry], tint: {}, dHi: 1e9, dMax: 170, shadow: true, h: 1.6, rad: 1.2, cap: [120, 0] });
    addKind('clay', { res: 'clay', r: .9, vars: [rockVar('clay', 0)], tint: { rock: 1 }, dHi: 1e9, dMax: 120, shadow: false, h: .6, rad: 1.6, cap: [100, 0], col: [.78, .5, .36] });
    if (v4has('lily')) { const ly = v4flat('lily', n => n === 'flower' ? 'flower' : 'pad'); addKind('lily', { res: null, vars: [{ parts: { pad: ly.pad } }, { parts: { pad: ly.pad, flower: ly.flower } }], tint: {}, dHi: 1e9, dMax: 120, shadow: false, h: .3, rad: 1, cap: [400, 0] }); }
    else addKind('lily', { res: null, vars: [{ parts: { pad: cylBark(.05, .6, .6, 8) } }], tint: {}, dHi: 1e9, dMax: 100, shadow: false, h: .3, rad: 1, cap: [200, 0] });
    // a cut tree leaves its stump
    for (const K of KIND) if (K.tree) for (const v of K.vars) v.alt = { bark: STUMP };
    L.treeGeo = {}; for (const K of KIND) if (K.tree) L.treeGeo[K.name] = { canopy: K.vars[0].parts.canopy || K.vars[0].parts.leaves, bark: K.vars[0].parts.bark };
  }
  const group = new THREE.Group(); group.name = 'scatter'; L.scatterGroup = group;
  function bucket(geo, mat, cap, shadow) {
    cap = Math.max(1, cap);
    const m = new THREE.InstancedMesh(geo, mat, cap); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.castShadow = !!shadow; m.receiveShadow = true; m.count = 0; m.visible = false;
    if (mat.userData && mat.userData.depth) m.customDepthMaterial = mat.userData.depth;
    group.add(m);
    return { m, n: 0, cap, A: m.instanceMatrix.array, CA: m.instanceColor.array };
  }
  function makeBuckets() {
    for (const K of KIND) {
      K.B = K.vars.map(v => {
        const o = { hi: {}, lo: {}, alt: {}, hasLo: false, hasAlt: false };
        const ch = Math.ceil(K.cap[0] * Q.cap / K.vars.length) + 8, cl = Math.ceil(K.cap[1] * Q.cap / K.vars.length) + 8;
        for (const p in v.parts) if (v.parts[p]) o.hi[p] = bucket(v.parts[p], matFor(K, p), ch, K.shadow);
        if (v.lo && K.cap[1]) for (const p in v.lo) if (v.lo[p]) { o.lo[p] = bucket(v.lo[p], matFor(K, p), cl, false); o.hasLo = true; }
        if (v.alt) for (const p in v.alt) if (v.alt[p]) { o.alt[p] = bucket(v.alt[p], matFor(K, p), Math.ceil(ch * .5), K.shadow); o.hasAlt = true; }
        return o;
      });
    }
  }
  function disposeBuckets() { for (const K of KIND) if (K.B) for (const o of K.B) for (const set of [o.hi, o.lo, o.alt]) for (const p in set) { group.remove(set[p].m); if (set[p].m.dispose) set[p].m.dispose(); } }
  function applyQuality() {
    Q = QT[L.quality] || QT.medio;
    for (const K of KIND) {
      if (K.tree) { K.dHi = Q.hi; K.dMax = Q.near; }
      else { K.dHi = K.dHi0 >= 1e8 ? 1e9 : K.dHi0 * Q.under; K.dMax = K.dMax0 * Q.under; }
      K.dHi2 = K.dHi * K.dHi; K.dMax2 = K.dMax * K.dMax;
    }
  }

  L.scatterInit = function () {
    if (!L.MAT && L.makeMaterials) L.makeMaterials();
    makeMats(); buildExclusion();
    disposeBuckets(); KIND.length = 0; for (const k in KI) delete KI[k];
    buildKinds(); applyQuality(); makeBuckets();
    if (!group.parent) L.scene.add(group);
    buildImpostorAtlas();
    // AW-nature models: when m/trees5 / m/rocks5 exist they replace the fallbacks (hot swap, ids and positions unchanged)
    if (L.loadModel && !initAsked) {
      initAsked = true;
      for (const f of ['trees5', 'rocks5']) probe(f).then(ok => ok ? L.loadModel(f) : null).then(s => { if (s) L.scatterUseModels({ [f]: s }); }).catch(e => console.warn('scatter models', f, e && e.message));
    }
  };
  let initAsked = false;
  function probe(f) {   // HEAD first, so a file that does not exist yet costs one request and no loader error
    if (typeof fetch === 'undefined') return Promise.resolve(false);
    return fetch('m/' + f + '.json', { method: 'HEAD' }).then(r => r.ok).catch(() => false);
  }
  // swap in AW-nature models ({trees5: Object3D, rocks5: Object3D}); items keep their ids and positions
  L.scatterUseModels = function (srcs) {
    Object.assign(SRC, srcs || {});
    disposeBuckets(); KIND.length = 0; for (const k in KI) delete KI[k];
    buildKinds(); applyQuality(); makeBuckets();
    for (const t of tiles.values()) for (const it of t.items) { const K = KIND[KI[it.kind]]; if (K) { it.k = K.idx; if (it.v >= K.vars.length) it.v = K.vars.length - 1; } }
    buildImpostorAtlas(); for (const s of supers.values()) s.dirty = true; dirty = true;
  };

  // ------------------------------------------------------------ near tiles + bucket fill (only when the view or state changes)
  let near = [], nearKey = '', dirty = true, lastFill = 0;
  const lastPos = new THREE.Vector3(1e9, 0, 0), lastDir = new THREE.Vector3(), _dir = new THREE.Vector3();
  const FR = new THREE.Frustum(), PV = new THREE.Matrix4(), SPH = new THREE.Sphere();
  const ST = L.scatterStats = { tiles: 0, inst: 0, meshes: 0, fills: 0, supers: 0, impQuads: 0, tileMs: 0 };
  let estTile = .5;
  function nearList(cx, cz) {
    const ti = Math.floor(cx / TS), tj = Math.floor(cz / TS); const key = ti + ',' + tj + ',' + Q.near;
    if (key === nearKey) return; nearKey = key; near = []; const R = Math.ceil(Q.near / TS) + 1;
    for (let j = tj - R; j <= tj + R; j++) for (let i = ti - R; i <= ti + R; i++) { const d = Math.hypot((i + .5) * TS - cx, (j + .5) * TS - cz); if (d < Q.near + TS) near.push({ i, j, d, k: tkey(i, j) }); }
    near.sort((a, b) => a.d - b.d);
  }
  function genNear(budgetMs) {
    const t0 = now(); let missing = false;
    for (const n of near) {
      if (tiles.has(n.k)) continue;
      if (now() - t0 + estTile > budgetMs) { missing = true; break; }   // never start a unit that would overrun the budget
      const tb = now(); getTile(n.i, n.j); const dt = now() - tb; estTile = estTile * .8 + dt * .2; ST.tileMs = estTile; dirty = true;
    }
    return !missing;
  }
  function fill(camera) {
    const cx = camera.position.x, cz = camera.position.z;
    PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); FR.setFromProjectionMatrix(PV);
    for (const K of KIND) for (const o of K.B) { for (const p in o.hi) o.hi[p].n = 0; for (const p in o.lo) o.lo[p].n = 0; for (const p in o.alt) o.alt[p].n = 0; }
    for (const n of near) {
      const t = tiles.get(n.k); if (!t) continue; if (!FR.intersectsSphere(t.sphere)) continue;
      const list = t.dyn ? t.items.concat(t.dyn) : t.items;
      for (const it of list) {
        const K = KIND[it.k]; if (!K) continue;
        if (it.gone !== it._g) { it._g = it.gone; if (K.tree) markSuper(it.x, it.z); }
        const vb = K.B[it.v] || K.B[0];
        if (it.gone && !vb.hasAlt) continue;
        const dx = it.x - cx, dz = it.z - cz, d2 = dx * dx + dz * dz; if (d2 > K.dMax2) continue;
        SPH.center.set(it.x, it.y + K.h * it.s * .5, it.z); SPH.radius = K.rad * it.s + 1; if (!FR.intersectsSphere(SPH)) continue;
        const B = it.gone ? vb.alt : (d2 > K.dHi2 && vb.hasLo) ? vb.lo : vb.hi;
        const c = it.col;
        for (const p in B) {
          const bk = B[p]; if (bk.n >= bk.cap) continue; bk.A.set(it.m, bk.n * 16);
          const cc = K.tint[p] ? (K.col && c === WHITE ? K.col : c) : WHITE;
          bk.CA[bk.n * 3] = cc[0]; bk.CA[bk.n * 3 + 1] = cc[1]; bk.CA[bk.n * 3 + 2] = cc[2]; bk.n++;
        }
      }
    }
    let inst = 0, meshes = 0;
    for (const K of KIND) for (const o of K.B) for (const set of [o.hi, o.lo, o.alt]) for (const p in set) {
      const bk = set[p]; bk.m.count = bk.n; bk.m.visible = bk.n > 0; inst += bk.n; if (bk.n) meshes++;
      if (bk.n) { bk.m.instanceMatrix.updateRange.count = bk.n * 16; bk.m.instanceMatrix.needsUpdate = true; bk.m.instanceColor.updateRange.count = bk.n * 3; bk.m.instanceColor.needsUpdate = true; }
    }
    ST.inst = inst; ST.meshes = meshes; ST.fills++;
  }
  L.scatterUpdate = function (camera, budgetMs) {
    if (!KIND.length) return true;
    if ((QT[L.quality] || QT.medio) !== Q) { disposeBuckets(); applyQuality(); makeBuckets(); nearKey = ''; superKey = ''; dirty = true; }
    const t0 = now(); const cx = camera.position.x, cz = camera.position.z;
    nearList(cx, cz);
    const allNear = genNear(budgetMs * .6);
    camera.getWorldDirection(_dir);
    const moved = lastPos.distanceToSquared(camera.position) > 2.25 || _dir.dot(lastDir) < .9994;
    if (dirty || moved || now() - lastFill > 400) { fill(camera); lastPos.copy(camera.position); lastDir.copy(_dir); dirty = false; lastFill = now(); }
    if (tiles.size > 420) for (const [k, t] of tiles) { if (!t.dyn && Math.hypot((t.i + .5) * TS - cx, (t.j + .5) * TS - cz) > Q.near * 2.4) tiles.delete(k); }
    ST.tiles = tiles.size;
    updateLight();
    updateImpostors(camera, Math.max(0, budgetMs - (now() - t0)));
    return allNear;
  };
  L.nearReady = () => near.length > 0 && near.every(n => tiles.has(n.k));
  // build everything the camera wants now (tests, screenshots, teleports behind a loading screen)
  L.scatterSettle = function (x, z, camera) {
    if (!KIND.length) return;
    nearList(x, z); for (const n of near) getTile(n.i, n.j);
    if (camera) {
      camera.updateMatrixWorld(); updateLight(); superWant(camera.position.x, camera.position.z); if (IMPMAT) IMPMAT.uniforms.uNear.value = Q.near - 24;
      while (stepSupers(1e9)) { }
      fill(camera); camera.getWorldDirection(lastDir); lastPos.copy(camera.position); dirty = false; lastFill = now();
    }
  };

  // ------------------------------------------------------------ night light for impostors and the glowing lunar canopies
  const _lc = new THREE.Color(), NIGHTC = new THREE.Color(.3, .36, .55), DUSKC = new THREE.Color(1.05, .84, .7);
  function updateLight() {
    let night = 0, dusk = 0;
    if (L.TOD && L.TOD.set) { night = L.TOD.night || 0; dusk = L.TOD.dusk || 0; }
    else if (L.NIGHT != null) night = L.NIGHT;
    _lc.setRGB(1, 1, 1).lerp(DUSKC, dusk * .45).lerp(NIGHTC, night);
    if (IMPMAT) { IMPMAT.uniforms.uLight.value.copy(_lc); IMPMAT.uniforms.uGlow.value = night; }
    if (FOL && FOL.lunar && FOL.lunar.emissive) FOL.lunar.emissiveIntensity = night * .85;
  }

  // ------------------------------------------------------------ far trees: impostor atlas + super-tile meshes (sliced)
  let IMPT = null, IMPMAT = null, RT = null; const supers = new Map(); const impGroup = new THREE.Group(); impGroup.name = 'impostors'; L.impGroup = impGroup;
  const IMP = []; const IMPCELL = {}; const ACOLS = 4, AROWS = 4, CELL = 256;
  function buildImpostorAtlas() {
    const r = L.renderer; if (!r) return;
    const list = []; for (const K of KIND) if (K.imp) K.vars.forEach((v, vi) => list.push([K, vi, v]));
    if (!RT) RT = new THREE.WebGLRenderTarget(CELL * ACOLS, CELL * AROWS, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, format: THREE.RGBAFormat, encoding: THREE.sRGBEncoding });
    const scn = new THREE.Scene(); scn.add(new THREE.HemisphereLight(0xdfefff, 0x50603a, .95)); const dl = new THREE.DirectionalLight(0xfff2dd, 1.2); dl.position.set(-.4, 1, .8); scn.add(dl);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200); const old = r.getRenderTarget(); const oldClear = r.getClearColor(new THREE.Color()); const oldA = r.getClearAlpha();
    const up = L.uPlayer && L.uPlayer.value; const pl = up && up.clone(); if (up) up.set(0, -999, 0);
    r.setRenderTarget(RT); r.setClearColor(0x4a6a32, 0); r.clear(true, true, true);
    IMP.length = 0; for (const k in IMPCELL) delete IMPCELL[k];
    list.forEach(([K, vi, v], idx) => {
      if (idx >= ACOLS * AROWS) return;
      const grp = new THREE.Group();
      for (const p in v.parts) { const g = v.parts[p]; if (!g || p === 'glow') continue; grp.add(new THREE.Mesh(g, matFor(K, p))); }
      const bb = new THREE.Box3().setFromObject(grp); const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.04, h = (bb.max.y - Math.min(bb.min.y, 0)) * 1.03; const SZ = Math.max(w, h, .5);
      const y0 = Math.min(bb.min.y, 0); IMP[idx] = { w: SZ, h: SZ, y0, glow: K.name === 'lunar' ? 1 : 0 }; IMPCELL[K.name + vi] = idx;
      cam.left = -SZ / 2; cam.right = SZ / 2; cam.bottom = y0; cam.top = y0 + SZ; cam.position.set(0, 0, 60); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      const cx = idx % ACOLS, cy = Math.floor(idx / ACOLS);
      scn.add(grp); r.setViewport(cx * CELL, cy * CELL, CELL, CELL); r.setScissor(cx * CELL, cy * CELL, CELL, CELL); r.setScissorTest(true); r.render(scn, cam); scn.remove(grp);
    });
    r.setScissorTest(false); r.setRenderTarget(old); r.setClearColor(oldClear, oldA); const sz = r.getSize(new THREE.Vector2()); r.setViewport(0, 0, sz.x, sz.y);
    if (up) up.copy(pl);
    IMPT = RT.texture; L.impTex = RT;
    if (!IMPMAT) {
      IMPMAT = new THREE.ShaderMaterial({
        fog: true, transparent: false, side: THREE.DoubleSide,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tImp: { value: null }, uNear: { value: 160 }, uLight: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: 0 } }]),
        vertexShader: `attribute vec3 aC; attribute vec4 aSz; attribute float aG; uniform float uNear; varying vec2 vUv; varying vec3 vCol; varying float vFade, vG;
          #include <fog_pars_vertex>
          void main(){ vec3 toC = aC - cameraPosition; vec3 dir = normalize(vec3(toC.x, 0., toC.z)); vec3 right = vec3(dir.z, 0., -dir.x);
            vec3 wp = aC + right * position.x * aSz.x + vec3(0., position.y * aSz.y + aSz.z, 0.);
            float d = length(toC.xz); vFade = smoothstep(uNear, uNear + 24., d); vG = aG;
            float cell = aSz.w; float cx = mod(cell, ${ACOLS}.), cy = floor(cell / ${ACOLS}. + .01);
            vUv = vec2((cx + position.x + .5) / ${ACOLS}., (cy + position.y) / ${AROWS}.); vCol = color;
            vec4 mvPosition = viewMatrix * vec4(wp, 1.); gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `uniform sampler2D tImp; uniform vec3 uLight; uniform float uGlow; varying vec2 vUv; varying vec3 vCol; varying float vFade, vG;
          #include <fog_pars_fragment>
          void main(){ vec4 t = texture2D(tImp, vUv); float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453); if (t.a < .5 || dn > vFade) discard;
            vec3 c = t.rgb * vCol * uLight + vG * uGlow * vec3(.25, .55, .7) * t.rgb;
            gl_FragColor = vec4(c, 1.);
            #include <fog_fragment>
          }`,
        vertexColors: true
      });
      L.impMat = IMPMAT;
    }
    IMPMAT.uniforms.tImp.value = IMPT;
    if (!impGroup.parent) L.scene.add(impGroup);
  }
  const SUPER = 512, NT = SUPER / TS;
  let superList = [], superKey = '', job = null;
  const _cut = { id: '', kindRes: 'tree', gone: false };
  function superWant(cx, cz) {
    const si = Math.floor(cx / SUPER), sj = Math.floor(cz / SUPER); const key = si + ',' + sj + ',' + Q.imp;
    if (key === superKey) return; superKey = key; superList = [];
    const R = Math.ceil(Q.imp / SUPER) + 1, lim = OOB() + SUPER;   // world bounds from L.WS / L.OOB
    for (let j = sj - R; j <= sj + R; j++) for (let i = si - R; i <= si + R; i++) {
      if (Math.abs((i + .5) * SUPER) > lim || Math.abs((j + .5) * SUPER) > lim) continue;
      const d = Math.hypot(clamp(cx, i * SUPER, (i + 1) * SUPER) - cx, clamp(cz, j * SUPER, (j + 1) * SUPER) - cz); if (d < Q.imp) superList.push({ i, j, d, k: i * 10000 + j });
    }
    superList.sort((a, b) => a.d - b.d);
    const want = new Set(superList.map(s => s.k));
    for (const [k, s] of supers) if (!want.has(k)) { if (s.mesh) { impGroup.remove(s.mesh); s.mesh.geometry.dispose(); } supers.delete(k); }
    if (job && !want.has(job.k)) job = null;
  }
  function markSuper(x, z) { const s = supers.get(Math.floor(x / SUPER) * 10000 + Math.floor(z / SUPER)); if (s) s.dirty = true; }
  // one unit of work = the trees of one 64 m tile of one super-tile; returns true while work remains
  let estSuper = .3;
  function stepSupers(budgetMs) {
    const t0 = now();
    for (; ;) {
      if (!job) {
        const s = superList.find(s => !supers.has(s.k) || supers.get(s.k).dirty); if (!s) return false;
        job = { k: s.k, i: s.i, j: s.j, q: 0, pos: [], aC: [], aSz: [], col: [], aG: [], idx: [] };
      }
      if (now() - t0 + estSuper > budgetMs) return true;
      const tb = now(); const J = job; const a = J.q % NT, b = (J.q / NT) | 0;
      treeScan(J.i * NT + a, J.j * NT + b, (sp, vr, x, y, z, s, ry, c, id) => {
        if (L.applyCut) { _cut.id = id; _cut.gone = false; L.applyCut(_cut); if (_cut.gone) return; }   // felled trees stay gone far away too
        const cell = IMPCELL[sp + vr]; if (cell == null) return; const I = IMP[cell]; const base = J.pos.length / 3; const w = I.w * s, h = I.h * s;
        for (let q = 0; q < 4; q++) { J.pos.push(q === 0 || q === 3 ? -.5 : .5, q < 2 ? 0 : 1, 0); J.aC.push(x, y, z); J.aSz.push(w, h, I.y0 * s, cell); J.col.push(c.r, c.g, c.b); J.aG.push(I.glow); }
        J.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      J.q++; estSuper = estSuper * .85 + (now() - tb) * .15;
      if (J.q >= NT * NT) { finishSuper(J); job = null; }
    }
  }
  function finishSuper(J) {
    const old = supers.get(J.k); if (old && old.mesh) { impGroup.remove(old.mesh); old.mesh.geometry.dispose(); }
    if (!J.idx.length) { supers.set(J.k, { mesh: null, dirty: false, n: 0 }); return; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(J.pos, 3)); g.setAttribute('aC', new THREE.Float32BufferAttribute(J.aC, 3)); g.setAttribute('aSz', new THREE.Float32BufferAttribute(J.aSz, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(J.col, 3)); g.setAttribute('aG', new THREE.Float32BufferAttribute(J.aG, 1)); g.setIndex(J.idx);
    let y0 = 1e9, y1 = -1e9; for (let q = 1; q < J.aC.length; q += 12) { const y = J.aC[q]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const x0 = J.i * SUPER, z0 = J.j * SUPER;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + SUPER / 2, (y0 + y1) / 2 + 8, z0 + SUPER / 2), Math.hypot(SUPER * .71, (y1 - y0) / 2 + 20) + 10);
    const m = new THREE.Mesh(g, IMPMAT); m.matrixAutoUpdate = false; m.name = 'imp'; impGroup.add(m); supers.set(J.k, { mesh: m, dirty: false, n: J.idx.length / 6 });
    ST.supers = supers.size; ST.impQuads = 0; for (const s of supers.values()) ST.impQuads += s.n || 0;
  }
  function updateImpostors(camera, budgetMs) {
    if (!IMPMAT) return; superWant(camera.position.x, camera.position.z);
    IMPMAT.uniforms.uNear.value = Q.near - 24;
    stepSupers(budgetMs);
  }
  L.impostorsReady = () => !job && superList.every(s => supers.has(s.k) && !supers.get(s.k).dirty);
})(window.L);
