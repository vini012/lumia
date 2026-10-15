/* Lumiar v4 scatter: deterministic per-tile vegetation, rocks and resources across the giant island.
   Near: global instanced buckets refilled every frame (frustum culled, 2 LODs). Far: tree impostor super-tiles. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep, C } = L;
  const TS = L.TS, hash3 = L.hash3;
  const KIND = []; const KI = {}; L.KIND = KIND; L.KI = KI;
  const R_NEAR = 210, R_IMP = 1500, SUPER = 256;
  const tiles = new Map(); L.stiles = tiles; let near = []; let nearKey = '';
  const tkey = (i, j) => (i + 1024) * 4096 + (j + 1024);

  // ------------------------------------------------------------ kinds
  function addKind(name, def) { def.name = name; def.idx = KIND.length; KIND.push(def); KI[name] = def.idx; def.dHi2 = def.dHi * def.dHi; def.dMax2 = def.dMax * def.dMax; return def; }
  function bucket(geo, mat, cap, shadow) {
    const m = new THREE.InstancedMesh(geo, mat, cap); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.castShadow = !!shadow; m.receiveShadow = true; m.count = 0; L.scene.add(m);
    if (mat.userData && mat.userData.depth) m.customDepthMaterial = mat.userData.depth;
    return { m, n: 0, cap, A: m.instanceMatrix.array, CA: m.instanceColor.array };
  }
  const WHITE = [1, 1, 1];
  // shiny metal nuggets stuck on a rock's upper surface (ore nodes read clearly from afar, ARK style)
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
  L.scatterInit = function () {
    const MAT = L.MAT;
    const partOf = n => n === 'canopy' ? 'canopy' : n === 'berries' ? 'berries' : 'bark';
    const FOL = L.FOL = { def: L.makeFoliageMat({ wind: 1 }), big: L.makeFoliageMat({ wind: .5 }), bush: L.makeFoliageMat({ wind: .35 }), low: L.makeFoliageMat({ wind: .8 }) };
    const ATL = {
      oak: { n: 96, size: [1.5, 2.3], quads: [0, 1] }, pine: { n: 70, size: [1.05, 1.55], quads: [2], inset: .2 },
      willow: { n: 96, size: [1.5, 2.1], quads: [0, 1], hang: { below: .42, quad: 3, aspect: 1.9, p: .55 } }, ancient: { n: 90, size: [2.6, 3.7], quads: [0, 1] },
    };
    L.treeGeo = {}; const stumpAlt = L.flatten('stump', () => 'bark').bark; // a cut tree leaves its stump
    for (const k in ATL) {
      const hi = L.flatten('tree_' + k, partOf), lo = L.flatten('tree_' + k + '_lo', partOf); const A = ATL[k];
      const parts = { canopy: L.canopyCards(hi.canopy, Object.assign({ seed: 17 + k.length * 7 }, A)), bark: hi.bark };
      const lop = { canopy: L.canopyCards((lo.canopy || hi.canopy), Object.assign({}, A, { seed: 91, n: Math.ceil(A.n * .34), size: [A.size[0] * 1.5, A.size[1] * 1.6], inset: .12 })), bark: lo.bark || hi.bark };
      L.treeGeo[k] = parts;
      hi.canopy.computeBoundingBox(); const bb = hi.canopy.boundingBox;
      const mats = { canopy: k === 'ancient' ? FOL.big : FOL.def, bark: MAT.bark };
      addKind(k, { parts, lo: lop, alt: k === 'ancient' ? null : { bark: stumpAlt }, mats, cap: k === 'ancient' ? [40, 120] : [520, 2600], dHi: k === 'ancient' ? 120 : 62, dMax: R_NEAR, shadow: true, h: bb.max.y, rad: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * .6 + 1, res: k === 'ancient' ? null : 'tree', tree: true, imp: ['oak', 'pine', 'willow', 'ancient'].indexOf(k), crown: [bb.min.y + (bb.max.y - bb.min.y) * .55, (bb.max.x - bb.min.x) * .45] });
    }
    // bushes in the tree style
    const bushBlobs = s => { const r = L.mulberry32(s); const out = [[0, .55, 0, .75, .55, .75]]; const n = 2 + Math.floor(r() * 3); for (let i = 0; i < n; i++) { const a = r() * 6.28, d = .35 + r() * .35; out.push([Math.cos(a) * d, .45 + r() * .3, Math.sin(a) * d, .45 + r() * .3, .38 + r() * .2, .45 + r() * .3]); } return out; };
    const bl1 = bushBlobs(3), bl2 = bushBlobs(8);
    const bushG = L.blobCards(bl1, { n: 60, size: [.62, .95], quads: [0, 1], extra: { quad: 7, p: .3, top: .25 }, seed: 5, inset: .3 });
    const bushPlain = L.blobCards(bl1, { n: 60, size: [.62, .95], quads: [0, 1], seed: 5, inset: .3 });
    addKind('bush', { parts: { canopy: bushG }, alt: { canopy: bushPlain }, mats: { canopy: FOL.bush }, cap: [700, 0], dHi: 160, dMax: 160, shadow: true, h: 1.3, rad: 1.4, res: 'bush' });
    const shrubG = L.blobCards(bl2, { n: 64, size: [.6, .9], quads: [1, 0], extra: { quad: 5, p: .34, top: .35 }, seed: 9, inset: .3 });
    addKind('shrub', { parts: { canopy: shrubG }, mats: { canopy: FOL.bush }, cap: [600, 0], dHi: 150, dMax: 150, shadow: true, h: 1.3, rad: 1.4, res: 'fibra' });
    const fernG = L.frondGeo({ n: 10, len: [.75, 1.25], tilt: [.45, 1.05], quads: [4], aspect: .42, droop: .45, seed: 4 });
    addKind('fern', { parts: { canopy: fernG }, mats: { canopy: FOL.low }, cap: [900, 0], dHi: 95, dMax: 95, shadow: false, h: .9, rad: 1.2, res: 'fibra1' });
    const reedG = L.frondGeo({ n: 9, len: [1.2, 1.9], tilt: [1.2, 1.5], quads: [6], aspect: .55, droop: .12, spread: .5, seed: 6 });
    addKind('reeds', { parts: { canopy: reedG }, mats: { canopy: FOL.low }, cap: [700, 0], dHi: 110, dMax: 110, shadow: false, h: 1.7, rad: 1.2, res: 'fibra' });
    // rocks, ore, crystals, mushrooms, stumps, lilies
    const r1 = L.flatten('rock1', () => 'rock').rock, r2 = L.flatten('rock2', () => 'rock').rock, r1lo = L.flatten('rock1_lo', () => 'rock').rock, r2lo = L.flatten('rock2_lo', () => 'rock').rock;
    addKind('rock', { parts: { rock: r1 }, lo: { rock: r1lo }, mats: { rock: MAT.rock }, cap: [300, 900], dHi: 70, dMax: 240, shadow: true, h: 1.6, rad: 1.8, res: 'rock' });
    addKind('rock2', { parts: { rock: r2 }, lo: { rock: r2lo }, mats: { rock: MAT.rock }, cap: [300, 900], dHi: 70, dMax: 240, shadow: true, h: 1.6, rad: 1.8, res: 'rock' });
    const nug = nuggets(r2, 16, 11);
    addKind('ore', { parts: { rock: r2, nug }, lo: { rock: r2lo, nug }, mats: { rock: MAT.rock, nug: MAT.ore }, cap: [120, 300], dHi: 70, dMax: 200, shadow: true, h: 1.6, rad: 1.8, res: 'ore' });
    const cry = L.flatten('crystal', () => 'crystal').crystal;
    addKind('crystal', { parts: { crystal: cry }, mats: { crystal: MAT.crystal }, cap: [160, 0], dHi: 160, dMax: 160, shadow: true, h: 1.6, rad: 1.2, res: 'crystal' });
    const mush = L.flatten('mushroom', n => n === 'cap' ? 'cap' : 'stem');
    addKind('mushroom', { parts: { cap: mush.cap, stem: mush.stem }, mats: { cap: MAT.mushCap, stem: MAT.plain }, cap: [300, 0], dHi: 90, dMax: 90, shadow: false, h: .6, rad: .6, res: 'mush' });
    const st = L.flatten('stump', () => 'bark').bark;
    addKind('stump', { parts: { bark: st }, mats: { bark: MAT.bark }, cap: [200, 0], dHi: 100, dMax: 100, shadow: true, h: .8, rad: .8 });
    const lily = L.flatten('lily', n => n === 'flower' ? 'flower' : 'pad');
    addKind('lily', { parts: { pad: lily.pad }, mats: { pad: MAT.plain }, cap: [500, 0], dHi: 120, dMax: 120, shadow: false, h: .2, rad: 1 });
    addKind('lilyf', { parts: { pad: lily.pad, flower: lily.flower }, mats: { pad: MAT.plain, flower: MAT.plain }, cap: [200, 0], dHi: 120, dMax: 120, shadow: false, h: .3, rad: 1 });
    // buckets
    for (const K of KIND) {
      K.hiB = {}; K.loB = {}; K.altB = {};
      for (const p in K.parts) K.hiB[p] = bucket(K.parts[p], K.mats[p], K.cap[0], K.shadow);
      if (K.lo) for (const p in K.lo) K.loB[p] = bucket(K.lo[p], K.mats[p], K.cap[1], false);
      if (K.alt) for (const p in K.alt) K.altB[p] = bucket(K.alt[p], K.mats[p], Math.ceil(K.cap[0] * .5), K.shadow);
    }
    buildImpostorAtlas();
  };

  // ------------------------------------------------------------ deterministic placement
  const GREENS = [0x4f9e3d, 0x5fae3e, 0x6cbc46, 0x3f8f3a, 0x7fc24a, 0x58a845].map(C);
  const PINES = [0x2f7a4c, 0x3a8a55, 0x2b6f45, 0x346f4f].map(C);
  const GOLD = C(0xc9b450), PINK = C(0xf6b3cf), ORANGE = C(0xf0a24a), WILLOW = C(0x8fcc5a), LIGHT = C(0x9ccc4e), ANC = [C(0x3f8f3a), C(0x6ab84a)];
  const BUSHG = [0x4f9e3d, 0x5fae3e, 0x6cbc46, 0x3f8f3a, 0x58a845].map(C);
  const _B = {}; const _col = new THREE.Color(); const pm = (a, n) => ((a % n) + n) % n;
  function sl(x, z, h) { return Math.hypot(L.rawH(x + 1.5, z) - h, L.rawH(x, z + 1.5) - h) / 1.5; }
  // tree candidates for tile (i,j): cb(kind, x, y, z, s, ry, col, n)
  function treeScan(i, j, cb) {
    const x0 = i * TS, z0 = j * TS, G = 9, step = TS / G; let n = 0;
    for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
      const u = (i * G + a) | 0, v = (j * G + b) | 0; const r0 = hash3(u, v, 1);
      if (r0 > .9) continue; // global sparsity cap
      const x = x0 + (a + .15 + hash3(u, v, 2) * .7) * step, z = z0 + (b + .15 + hash3(u, v, 3) * .7) * step;
      const h = L.rawH(x, z); if (h < .7 || h > 235) continue;
      const B = L.biome(x, z, _B); const fd = L.forestDensity(x, z, B);
      let p = sstep(.28, .78, fd) * .95 + .015; p *= 1 - B.planicie * .82 - B.canion * .7 - B.costa * .3; if (h > 170) p *= sstep(235, 170, h);
      if (r0 > p * .9) continue;
      const s0 = sl(x, z, h); if (s0 > .72) continue;
      if (L.distRiver(x, z) < 3) continue;
      const nearW = h < 3 || L.distRiver(x, z) < 18;
      const wOak = B.vale + B.lago * .6 + B.antiga * .85 + B.penhas * .9 + B.costa * .7 + B.planicie * .8 + B.canion * .6 + B.pantano * .25 + B.pinho * .12 + B.montes * .05;
      const wPine = B.pinho + B.montes * 1.2 + B.dragao * .8 + B.vale * .06 + (h > 80 ? 1.5 : 0) + B.penhas * .08;
      const wWil = (B.pantano * 1.4 + B.lago * .7 + B.vale * .1) * (nearW ? 1 : .05);
      const wAnc = fd > .62 ? B.antiga * .06 : 0;
      let pick = hash3(u, v, 4) * (wOak + wPine + wWil + wAnc); let kind;
      if ((pick -= wAnc) < 0) kind = 'ancient'; else if ((pick -= wWil) < 0) kind = 'willow'; else if ((pick -= wPine) < 0) kind = 'pine'; else kind = 'oak';
      const rs = hash3(u, v, 5), rc = hash3(u, v, 6); let s, col;
      if (kind === 'oak') { s = .72 + rs * .72; if (rc < .035 && B.planicie < .3 && B.canion < .3) col = PINK; else if (rc < .06 && B.pinho < .3) col = ORANGE; else { col = _col.copy(GREENS[pm(u * 7 + v * 3, GREENS.length)]).lerp(LIGHT, rc * .35); if (B.planicie + B.canion > .2) col.lerp(GOLD, clamp((B.planicie + B.canion) * .9, 0, .8)); col = col.clone(); } }
      else if (kind === 'pine') { s = .8 + rs * .65; col = PINES[pm(u + v, PINES.length)]; }
      else if (kind === 'willow') { s = .8 + rs * .45; col = WILLOW; }
      else { s = .9 + rs * .45; col = ANC[0].clone().lerp(ANC[1], rc); }
      if (L.poiClear && L.poiClear(x, z)) continue; // clearings around landmarks
      cb(kind, x, h - .12, z, s, hash3(u, v, 7) * 6.283, col, n++);
    }
  }
  L.treeScan = treeScan;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _y = new THREE.Vector3(0, 1, 0);
  function makeItem(kind, x, y, z, s, ry, col, id, extra) {
    const K = KIND[KI[kind]]; _p.set(x, y, z); _q.setFromAxisAngle(_y, ry); _s.set(s, s, s); if (extra && extra.sy) _s.y *= extra.sy; _m.compose(_p, _q, _s);
    const it = { k: K.idx, kind, x, y, z, s, ry, col: col ? [col.r, col.g, col.b] : WHITE, id, m: new Float32Array(_m.elements), res: K.res || null, gone: false };
    if (K.tree) { it.r = kind === 'ancient' ? 2.4 * s : .55 * s; it.kindRes = kind === 'ancient' ? 'none' : 'tree'; }
    else if (K.res === 'rock' || K.res === 'ore') { it.r = .95 * s; it.kindRes = K.res; }
    else if (K.res === 'crystal') { it.r = .5 * s; it.kindRes = 'crystal'; }
    else if (K.res) it.kindRes = K.res;
    if (kind === 'stump') it.r = .5 * s;
    if (extra) Object.assign(it, extra);
    return it;
  }
  function genTile(i, j) {
    const items = []; const x0 = i * TS, z0 = j * TS; const tk = i + '_' + j;
    treeScan(i, j, (kind, x, y, z, s, ry, col, n) => items.push(makeItem(kind, x, y, z, s, ry, col, 't' + tk + '_' + n)));
    // undergrowth: 5.33 m grid
    const G = 12, step = TS / G; let n = 0;
    for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
      const u = i * G + a, v = j * G + b; const r0 = hash3(u, v, 11); if (r0 > .34) continue;
      const x = x0 + (a + hash3(u, v, 12)) * step, z = z0 + (b + hash3(u, v, 13)) * step; const h = L.rawH(x, z);
      if (h > 225) continue;
      const B = L.biome(x, z, _B); let kind = null, s = 1, col = null, y = h;
      if (h < -.4) { // water plants
        if (h > -3.4 && (B.lago + B.pantano > .25 || L.distRiver(x, z) > 30) && r0 < .2 && L.distRiver(x, z) > 6) { kind = hash3(u, v, 14) < .25 ? 'lilyf' : 'lily'; y = .04; s = .7 + hash3(u, v, 15) * .8; }
      } else if (h < 1.3) {
        if (r0 < .26 && (B.lago + B.pantano + B.vale * .5 > .2 || L.distRiver(x, z) < 25)) { kind = 'reeds'; s = .8 + hash3(u, v, 15) * .5; }
      } else {
        const fd = L.forestDensity(x, z, B); const sp = sl(x, z, h); if (sp > .8) continue;
        const pB = .03 + B.vale * .05 + B.antiga * .04 + B.penhas * .05 + B.lago * .04 + B.costa * .05 + sstep(.3, .55, fd) * sstep(.85, .55, fd) * .05;
        const pS = B.vale * .045 + B.penhas * .05 + B.lago * .04 + B.costa * .04 + B.planicie * .015;
        const pF = (B.antiga * .2 + B.pinho * .09 + B.penhas * .1 + B.pantano * .08 + B.vale * .02) * sstep(.25, .7, fd);
        const pM = (B.antiga * .03 + B.pantano * .025) * sstep(.4, .8, fd);
        const pSt = sstep(.5, .8, fd) * .012;
        let q = r0;
        if ((q -= pB) < 0) { kind = 'bush'; s = .75 + hash3(u, v, 15) * .55; col = BUSHG[pm(u + v * 3, BUSHG.length)].clone().lerp(LIGHT, hash3(u, v, 16) * .3); if (B.planicie > .4) col.lerp(GOLD, .4); }
        else if ((q -= pS) < 0) { kind = 'shrub'; s = .75 + hash3(u, v, 15) * .5; col = BUSHG[pm(u * 3 + v, BUSHG.length)].clone().lerp(LIGHT, .2); }
        else if ((q -= pF) < 0) { kind = 'fern'; s = .8 + hash3(u, v, 15) * .6; col = C(0x5aa63f).lerp(C(0x8fcc4f), hash3(u, v, 16) * .5); }
        else if ((q -= pM) < 0) { kind = 'mushroom'; s = .6 + hash3(u, v, 15) * .9; }
        else if ((q -= pSt) < 0) { kind = 'stump'; s = .8 + hash3(u, v, 15) * .5; }
      }
      if (kind) items.push(makeItem(kind, x, y, z, s, hash3(u, v, 17) * 6.283, col, 'u' + tk + '_' + (n++)));
    }
    // rocks, ore, crystals: 8 m grid
    const G2 = 8, st2 = TS / G2; n = 0;
    for (let b = 0; b < G2; b++) for (let a = 0; a < G2; a++) {
      const u = i * G2 + a, v = j * G2 + b; const r0 = hash3(u, v, 21); if (r0 > .3) continue;
      const x = x0 + (a + hash3(u, v, 22)) * st2, z = z0 + (b + hash3(u, v, 23)) * st2; const h = L.rawH(x, z); if (h < .2) continue;
      const B = L.biome(x, z, _B); const sp = sl(x, z, h);
      const pR = .008 + sstep(.45, 1.1, sp) * .12 + B.montes * .04 + B.canion * .07 + B.dragao * .07 + B.costa * .02 + B.penhas * .03 + sstep(150, 260, h) * .05;
      const pO = (B.montes * .018 + B.canion * .03 + B.dragao * .03) * sstep(20, 60, h) + B.canion * .01;
      let pC = h > 140 ? B.montes * .004 : 0; const gd = Math.hypot(x - 420, z + 760); if (gd < 70) pC += .25;
      let q = r0, kind = null, s = 1, col = null;
      if ((q -= pC) < 0) { kind = 'crystal'; s = .8 + hash3(u, v, 25) * 1.1; }
      else if ((q -= pO) < 0) { kind = 'ore'; s = .7 + hash3(u, v, 25) * .6; }
      else if ((q -= pR) < 0) { kind = hash3(u, v, 24) < .5 ? 'rock' : 'rock2'; s = .5 + hash3(u, v, 25) * (1.2 + B.montes + B.canion * .8); col = B.canion > .4 ? C(0xd89a74) : B.dragao > .4 ? C(0x9a948f) : null; }
      if (kind) { const it = makeItem(kind, x, h - s * .15, z, s, hash3(u, v, 26) * 6.283, col, 'r' + tk + '_' + (n++), kind === 'crystal' ? null : { sy: .85 }); items.push(it); }
    }
    const cx = x0 + TS / 2, cz = z0 + TS / 2; const t = { i, j, items, sphere: new THREE.Sphere(new THREE.Vector3(cx, L.rawH(cx, cz) + 10, cz), TS * .75 + 30) };
    // fixed items registered by POIs
    if (L.extraItems) { const ex = L.extraItems(i, j); if (ex) for (const e of ex) items.push(makeItem(e.kind, e.x, e.y, e.z, e.s, e.ry || 0, e.col || null, e.id, e.extra)); }
    if (L.applyCut) for (const it of items) if (it.kindRes) L.applyCut(it);
    return t;
  }
  function getTile(i, j) { const k = tkey(i, j); let t = tiles.get(k); if (!t) { t = genTile(i, j); tiles.set(k, t); } return t; }
  L.stile = (x, z) => tiles.get(tkey(Math.floor(x / TS), Math.floor(z / TS)));
  // iterate items near (x,z) within r in loaded tiles
  L.nearby = function (x, z, r, fn) {
    const i0 = Math.floor((x - r) / TS), i1 = Math.floor((x + r) / TS), j0 = Math.floor((z - r) / TS), j1 = Math.floor((z + r) / TS);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const t = tiles.get(tkey(i, j)); if (!t) continue; for (const it of t.items) fn(it); if (t.dyn) for (const it of t.dyn) fn(it); }
  };
  L.forEachLoaded = function (fn) { for (const t of tiles.values()) for (const it of t.items) fn(it); };
  L.itemMatrix = function (it, sc, shake) { // rebuild matrix (scale/shake) after state changes
    const s = it.s * Math.max(sc, 1e-4); _p.set(it.x, it.y, it.z); _e.set(shake ? Math.sin(shake * 40) * .04 * (1 - shake) : 0, it.ry, shake ? Math.cos(shake * 37) * .04 * (1 - shake) : 0); _q.setFromEuler(_e); _s.set(s, s * (it.sy || 1), s); _m.compose(_p, _q, _s); it.m.set(_m.elements);
  };

  // ------------------------------------------------------------ per-frame fill
  const FR = new THREE.Frustum(), PV = new THREE.Matrix4(), SPH = new THREE.Sphere();
  let genBudgetHit = false;
  L.scatterUpdate = function (camera, budgetMs) {
    const cx = camera.position.x, cz = camera.position.z; const ti = Math.floor(cx / TS), tj = Math.floor(cz / TS); const key = ti + ',' + tj;
    if (key !== nearKey) { nearKey = key; near = []; const R = Math.ceil(R_NEAR / TS) + 1; for (let j = tj - R; j <= tj + R; j++) for (let i = ti - R; i <= ti + R; i++) { const d = Math.hypot((i + .5) * TS - cx, (j + .5) * TS - cz); if (d < R_NEAR + TS) near.push({ i, j, d, k: tkey(i, j) }); } near.sort((a, b) => a.d - b.d); }
    const t0 = performance.now(); genBudgetHit = false;
    for (const n of near) { if (tiles.has(n.k)) continue; if (performance.now() - t0 > budgetMs) { genBudgetHit = true; break; } getTile(n.i, n.j); }
    PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); FR.setFromProjectionMatrix(PV);
    for (const K of KIND) { for (const p in K.hiB) K.hiB[p].n = 0; for (const p in K.loB) K.loB[p].n = 0; for (const p in K.altB) K.altB[p].n = 0; }
    for (const n of near) {
      const t = tiles.get(n.k); if (!t) continue; if (!FR.intersectsSphere(t.sphere)) continue;
      const list = t.dyn ? t.items.concat(t.dyn) : t.items;
      for (const it of list) {
        const K = KIND[it.k]; if (it.gone && !K.alt && !it.shrunk) continue;
        const dx = it.x - cx, dz = it.z - cz, d2 = dx * dx + dz * dz; if (d2 > K.dMax2) continue;
        SPH.center.set(it.x, it.y + K.h * it.s * .5, it.z); SPH.radius = K.rad * it.s + 1; if (!FR.intersectsSphere(SPH)) continue;
        const lo = d2 > K.dHi2 && K.lo; const B = (it.gone && K.alt) ? K.altB : lo ? K.loB : K.hiB;
        for (const p in B) { const bk = B[p]; if (bk.n >= bk.cap) continue; bk.A.set(it.m, bk.n * 16); const c = (p === 'canopy' || p === 'rock') ? it.col : WHITE; bk.CA[bk.n * 3] = c[0]; bk.CA[bk.n * 3 + 1] = c[1]; bk.CA[bk.n * 3 + 2] = c[2]; bk.n++; }
      }
    }
    for (const K of KIND) for (const set of [K.hiB, K.loB, K.altB]) for (const p in set) { const bk = set[p]; bk.m.count = bk.n; if (bk.n) { bk.m.instanceMatrix.updateRange.count = bk.n * 16; bk.m.instanceMatrix.needsUpdate = true; bk.m.instanceColor.updateRange.count = bk.n * 3; bk.m.instanceColor.needsUpdate = true; } }
    // evict far tiles
    if (tiles.size > 260) for (const [k, t] of tiles) { if (Math.hypot((t.i + .5) * TS - cx, (t.j + .5) * TS - cz) > R_NEAR * 2.6 && !t.dyn) tiles.delete(k); }
    updateImpostors(camera, budgetMs * .6);
    return !genBudgetHit;
  };
  L.nearReady = () => near.every(n => tiles.has(n.k));

  // ------------------------------------------------------------ far trees: impostor atlas + super-tile meshes
  let IMPT = null, IMPMAT = null; const supers = new Map(); const impGroup = new THREE.Group(); L.impGroup = impGroup;
  const IMP_INFO = []; // per species: [w, h] in metres at scale 1 and the base offset
  function buildImpostorAtlas() {
    const species = ['oak', 'pine', 'willow', 'ancient']; const CELL = 256;
    const rt = new THREE.WebGLRenderTarget(CELL * 4, CELL, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, format: THREE.RGBAFormat, encoding: THREE.sRGBEncoding });
    const scn = new THREE.Scene(); scn.add(new THREE.HemisphereLight(0xdfefff, 0x50603a, .9)); const dl = new THREE.DirectionalLight(0xfff2dd, 1.25); dl.position.set(-.4, 1, .8); scn.add(dl);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100); const r = L.renderer; const old = r.getRenderTarget(); const oldClear = r.getClearColor(new THREE.Color()); const oldA = r.getClearAlpha();
    const pl = L.uPlayer.value.clone(); L.uPlayer.value.set(0, -999, 0);
    r.setRenderTarget(rt); r.setClearColor(0x3c6a2e, 0); r.clear(true, true, true);
    species.forEach((k, idx) => {
      const g = L.treeGeo[k]; const grp = new THREE.Group(); const can = L.applyFoliage(new THREE.Mesh(g.canopy), k === 'ancient' ? L.FOL.big : L.FOL.def); grp.add(can); if (g.bark) grp.add(new THREE.Mesh(g.bark, L.MAT.bark));
      const bb = new THREE.Box3().setFromObject(grp); const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.04, h = (bb.max.y - Math.min(bb.min.y, 0)) * 1.03; const S = Math.max(w, h);
      IMP_INFO[idx] = { w: S, h: S, y0: Math.min(bb.min.y, 0) };
      cam.left = -S / 2; cam.right = S / 2; cam.bottom = IMP_INFO[idx].y0; cam.top = IMP_INFO[idx].y0 + S; cam.position.set(0, 0, 40); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      scn.add(grp); r.setViewport(idx * CELL, 0, CELL, CELL); r.setScissor(idx * CELL, 0, CELL, CELL); r.setScissorTest(true); r.render(scn, cam); scn.remove(grp);
    });
    r.setScissorTest(false); r.setRenderTarget(old); r.setClearColor(oldClear, oldA); const sz = r.getSize(new THREE.Vector2()); r.setViewport(0, 0, sz.x, sz.y);
    L.uPlayer.value.copy(pl);
    IMPT = rt.texture; L.impTex = rt;
    IMPMAT = new THREE.ShaderMaterial({
      fog: true, transparent: false, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tImp: { value: null }, uNear: { value: R_NEAR - 22 }, uLight: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: `attribute vec3 aC; attribute vec4 aSz; varying vec2 vUv; varying vec3 vCol; varying float vFade;
        #include <fog_pars_vertex>
        void main(){ vec3 toC = aC - cameraPosition; vec3 dir = normalize(vec3(toC.x, 0., toC.z)); vec3 right = vec3(dir.z, 0., -dir.x);
          vec3 wp = aC + right * position.x * aSz.x + vec3(0., position.y * aSz.y + aSz.z, 0.);
          float d = length(toC.xz); vFade = smoothstep(uNear, uNear + 24., d);
          vUv = vec2((aSz.w + position.x + .5) * .25, position.y); vCol = color;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`.replace('varying vec2 vUv;', 'uniform float uNear; varying vec2 vUv;'),
      fragmentShader: `uniform sampler2D tImp; uniform vec3 uLight; varying vec2 vUv; varying vec3 vCol; varying float vFade;
        #include <fog_pars_fragment>
        void main(){ vec4 t = texture2D(tImp, vUv); float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453); if (t.a < .5 || dn > vFade) discard;
          vec3 c = t.rgb * vCol * uLight; gl_FragColor = vec4(c, 1.);
          #include <fog_fragment>
        }`,
      vertexColors: true
    });
    IMPMAT.uniforms.tImp.value = IMPT; L.impMat = IMPMAT; L.scene.add(impGroup);
  }
  function buildSuper(si, sj) {
    const pos = [], aC = [], aSz = [], col = [], idx = []; const n4 = SUPER / TS;
    for (let b = 0; b < n4; b++) for (let a = 0; a < n4; a++) {
      const i = si * n4 + a, j = sj * n4 + b;
      treeScan(i, j, (kind, x, y, z, s, ry, c) => {
        const sp = ['oak', 'pine', 'willow', 'ancient'].indexOf(kind); const I = IMP_INFO[sp]; const base = pos.length / 3; const w = I.w * s, h = I.h * s;
        for (const [px, py] of [[-.5, 0], [.5, 0], [.5, 1], [-.5, 1]]) { pos.push(px, py, 0); aC.push(x, y, z); aSz.push(w, h, I.y0 * s, sp); col.push(c.r, c.g, c.b); }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
    }
    if (!idx.length) return { mesh: null };
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aC', new THREE.Float32BufferAttribute(aC, 3)); g.setAttribute('aSz', new THREE.Float32BufferAttribute(aSz, 4)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const x0 = si * SUPER, z0 = sj * SUPER; const hc = L.rawH(x0 + SUPER / 2, z0 + SUPER / 2);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + SUPER / 2, hc + 20, z0 + SUPER / 2), SUPER * .75 + 60);
    const m = new THREE.Mesh(g, IMPMAT); m.matrixAutoUpdate = false; impGroup.add(m); return { mesh: m };
  }
  let superList = [], superKey = '';
  function updateImpostors(camera, budgetMs) {
    if (!IMPMAT) return; const cx = camera.position.x, cz = camera.position.z; const si = Math.floor(cx / SUPER), sj = Math.floor(cz / SUPER); const key = si + ',' + sj;
    if (key !== superKey) { superKey = key; superList = []; const R = Math.ceil(R_IMP / SUPER) + 1; for (let j = sj - R; j <= sj + R; j++) for (let i = si - R; i <= si + R; i++) { if (Math.abs(i * SUPER) > 1800 || Math.abs(j * SUPER) > 1800) continue; const d = Math.hypot((i + .5) * SUPER - cx, (j + .5) * SUPER - cz); if (d < R_IMP + SUPER) superList.push({ i, j, d, k: i * 1000 + j }); } superList.sort((a, b) => a.d - b.d); const want = new Set(superList.map(s => s.k)); for (const [k, s] of supers) if (!want.has(k)) { if (s.mesh) { impGroup.remove(s.mesh); s.mesh.geometry.dispose(); } supers.delete(k); } }
    const t0 = performance.now();
    for (const s of superList) { if (supers.has(s.k)) continue; if (performance.now() - t0 > budgetMs) break; supers.set(s.k, buildSuper(s.i, s.j)); }
  }
  L.impostorsReady = () => superList.every(s => supers.has(s.k));
})(window.L);
