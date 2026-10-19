/* Lumiar building (v4 system on the v5 kits madeira / enxaimel / pedra / real; B-actors owns it): structural pieces in 4 material tiers snapped on a 3 m grid (foundations, floors,
   walls, doorways, windows, roofs, stairs, pillars, fences, doors, gates), stations (fire, workbench, forge, anvil,
   cauldron, chest), furniture and farm pieces. Instanced rendering, colliders for every piece. */
'use strict';
(function (L) {
  const { clamp, lerp } = L;
  const TAU = Math.PI * 2, S3 = 3, H = 1.5;
  const wrapA = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  const TIERS = {
    madeira: { nome: 'Madeira', ic: '🪵', per: { madeira: 3 }, file: 'build_madeira' },
    enxaimel: { nome: 'Enxaimel', ic: '🏡', per: { madeira: 2, pedra: 1, fibra: 1 }, file: 'build_enxaimel' },
    pedra: { nome: 'Pedra', ic: '🪨', per: { pedra: 3, madeira: 1 }, file: 'build_pedra' },
    real: { nome: 'Real', ic: '👑', per: { pedra: 2, ferro: 1 }, file: 'build_real' },
  };
  const PIECES = {
    foundation: { nome: 'Fundação', u: 3, cls: 'cell', desc: 'base no chão, encaixa em grade' },
    floor: { nome: 'Piso / Teto', u: 2, cls: 'cell', desc: 'andar de cima ou teto' },
    wall: { nome: 'Parede', u: 2, cls: 'edge' },
    doorway: { nome: 'Parede com porta', u: 2, cls: 'edge' },
    window: { nome: 'Parede com janela', u: 2, cls: 'edge' },
    wall_half: { nome: 'Meia parede', u: 1, cls: 'edge', h: 1.5 },
    gable: { nome: 'Oitão', u: 1, cls: 'edge', h: 1.5, desc: 'triângulo sob o telhado' },
    roof: { nome: 'Telhado', u: 2, cls: 'cell', desc: 'gire para virar a água' },
    stairs: { nome: 'Escada', u: 2, cls: 'cell' },
    pillar: { nome: 'Pilar', u: 1, cls: 'corner' },
    fence: { nome: 'Cerca', u: 1, cls: 'fence', desc: 'encaixa ponta com ponta' },
    door: { nome: 'Porta', u: 1, cls: 'door', desc: 'vai na parede com porta' },
    gate: { nome: 'Portão', u: 2, cls: 'gate', desc: 'vai numa cerca' },
  };
  // stations, furniture, farm: { obj: object name in furniture.json, r: footprint radius, cost }
  const ITEMS = {
    fogueira: { nome: 'Fogueira', cat: 'est', cost: { madeira: 3, pedra: 2 }, r: .9, fire: true, desc: 'luz e calor; acenda com lenha' },
    bancada: { nome: 'Bancada', cat: 'est', cost: { madeira: 8, pedra: 2 }, r: 1.1, desc: 'faz ferramentas' },
    forja: { nome: 'Forja', cat: 'est', cost: { pedra: 12, madeira: 4 }, r: 1.2, fire: true, desc: 'derrete minério em ferro' },
    bigorna: { nome: 'Bigorna', cat: 'est', cost: { ferro: 3, pedra: 4 }, r: .7, desc: 'ferramentas de ferro' },
    caldeirao: { nome: 'Caldeirão', cat: 'est', cost: { ferro: 2, pedra: 4, madeira: 2 }, r: .8, fire: true, desc: 'prepara poções' },
    bau: { nome: 'Baú', cat: 'est', cost: { madeira: 6 }, r: .7, desc: 'guarda itens para os dois' },
    cama: { nome: 'Cama', cat: 'casa', cost: { madeira: 6, fibra: 6 }, r: 1.2, desc: 'você renasce aqui' },
    mesa: { nome: 'Mesa', cat: 'casa', cost: { madeira: 4 }, r: .9 },
    cadeira: { nome: 'Cadeira', cat: 'casa', cost: { madeira: 2 }, r: .45 },
    banco: { nome: 'Banco', cat: 'casa', cost: { madeira: 3 }, r: .8 },
    estante: { nome: 'Estante', cat: 'casa', cost: { madeira: 5 }, r: .8 },
    tapete: { nome: 'Tapete', cat: 'casa', cost: { fibra: 6 }, r: 1.2, flat: true },
    lanterna: { nome: 'Lanterna', cat: 'casa', cost: { ferro: 1, cristal: 1 }, r: .4, light: 0xffc46a, desc: 'acende sozinha à noite' },
    vaso: { nome: 'Vaso de flores', cat: 'casa', cost: { pedra: 2, sementes: 1 }, r: .35 },
    estatua: { nome: 'Estátua', cat: 'casa', cost: { pedra: 14, cristal: 1 }, r: .8, desc: 'enfeite de pedra para o jardim' },
    canteiro: { nome: 'Canteiro', cat: 'faz', cost: { madeira: 2 }, r: 1.1, plant: true, desc: 'plante sementes, colha abóboras' },
    poco: { nome: 'Poço', cat: 'faz', cost: { pedra: 10, madeira: 2 }, r: 1.2 },
    espantalho: { nome: 'Espantalho', cat: 'faz', cost: { madeira: 2, fibra: 4 }, r: .5 },
    moinho: { nome: 'Moinho', cat: 'faz', cost: { madeira: 12, pedra: 6, fibra: 6 }, r: 2.4 },
    caixote: { nome: 'Caixote', cat: 'faz', cost: { madeira: 3 }, r: .5 },
    placa: { nome: 'Placa', cat: 'faz', cost: { madeira: 2 }, r: .4 },
    barril: { nome: 'Barril', cat: 'faz', cost: { madeira: 3 }, r: .45 },
  };
  L.BUILD = { TIERS, PIECES, ITEMS };

  // ------------------------------------------------------------------ assets
  const KIT = {}; const FURN = {}; let furnReady = false;
  const boxOf = o => new THREE.Box3().setFromObject(o);
  function collect(sc) { const out = {}; if (!sc) return out; sc.traverse(o => { if (o.parent === sc && o.name) { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrixWorld(true); out[o.name] = o; } }); return out; }
  L.buildLoad = async function () {
    await Promise.all(Object.keys(TIERS).map(async k => { const sc = await L.loadModel(TIERS[k].file); if (sc) KIT[k] = collect(sc); }));
    const f = await L.loadModel('furniture'); if (f) Object.assign(FURN, collect(f)); furnReady = true;
    for (const k in ITEMS) { const I = ITEMS[k]; I.ok = !!findFurn(k); }
    return { tiers: Object.keys(KIT), items: Object.keys(FURN) };
  };
  function findFurn(k) { const I = ITEMS[k]; const names = [I.obj || k, k + '_0', k.replace('cao', 'cão')]; for (const n of names) if (FURN[n]) return FURN[n]; return null; }
  L.buildTierOK = k => !!KIT[k];
  L.buildItemOK = k => !!findFurn(k);
  // parts of a source object: [{ geo, mat (glow?), m (matrix relative to the piece) }]
  const partsCache = new Map();
  function partsOf(src) {
    let p = partsCache.get(src); if (p) return p; p = []; src.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
    src.traverse(o => { if (!o.isMesh) return; const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); p.push({ geo: o.geometry, glow: /_glow/.test(o.name), m }); });
    partsCache.set(src, p); return p;
  }

  // ------------------------------------------------------------------ instanced batches for structural pieces
  const BATCH = new Map(); // tier:piece -> { parts: [InstancedMesh], cap, n }
  function batch(tier, piece) {
    const key = tier + ':' + piece; let b = BATCH.get(key); if (b) return b; const src = KIT[tier] && KIT[tier][piece]; if (!src) return null;
    b = { src, parts: partsOf(src), meshes: [], cap: 0, n: 0 }; BATCH.set(key, b); return b;
  }
  function ensureCap(b, n) {
    if (n <= b.cap) return; const cap = Math.max(16, 1 << Math.ceil(Math.log2(n)));
    for (const m of b.meshes) { L.scene.remove(m); m.dispose && m.dispose(); }
    b.meshes = b.parts.map(pt => { const im = new THREE.InstancedMesh(pt.geo, pt.glow ? L.MAT.glow : L.MAT.v4, cap); im.castShadow = !pt.glow; im.receiveShadow = true; im.count = 0; im.frustumCulled = false; L.scene.add(im); return im; });
    b.cap = cap;
  }
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0);
  function pieceMatrix(rec, out, extraRot) { _p.set(rec.x, rec.y, rec.z); _q.setFromAxisAngle(_Y, (rec.r || 0) + (extraRot || 0)); return out.compose(_p, _q, _s); }

  // ------------------------------------------------------------------ colliders per piece (local boxes)
  function lbox(x0, x1, y0, y1, z0, z1, extra) { return Object.assign({ x0, x1, y0, y1, z0, z1 }, extra || {}); }
  function localCols(rec) {
    const t = rec.t; const P = PIECES[t];
    if (t === 'foundation') return [lbox(-1.5, 1.5, -1.2, 0, -1.5, 1.5)];
    if (t === 'floor') return [lbox(-1.5, 1.5, -.2, 0, -1.5, 1.5)];
    if (t === 'wall' || t === 'window') return [lbox(-1.5, 1.5, 0, 3, -.15, .15)];
    if (t === 'wall_half') return [lbox(-1.5, 1.5, 0, 1.5, -.15, .15)];
    if (t === 'gable') return [lbox(-1.5, 1.5, 0, 1.5, -.15, .15, { nowalk: true })];
    if (t === 'doorway') return [lbox(-1.5, -.64, 0, 3, -.15, .15), lbox(.64, 1.5, 0, 3, -.15, .15), lbox(-.64, .64, 2.28, 3, -.15, .15)];
    if (t === 'pillar') return [lbox(-.22, .22, 0, 3, -.22, .22)];
    if (t === 'fence') return [lbox(-1.5, 1.5, 0, 1.2, -.1, .1, { nocam: true })];
    if (t === 'stairs') return [lbox(-.75, .75, 0, 0, -1.5, 1.5, { ramp: 3.0, nocam: true })];
    if (t === 'roof') return [lbox(-1.5, 1.5, -.5, -.2, -1.8, 1.5, { ramp: 1.99, nocam: true })];
    if (t === 'door') return [lbox(0, 1.24, 0, 2.26, -.07, .07, { door: true })];
    if (t === 'gate') return [lbox(0, 2.9, 0, 1.2, -.06, .06, { door: true, nocam: true })];
    if (P) return []; // unknown piece
    const I = ITEMS[t]; if (!I) return []; if (I.flat) return [];
    const r = I.r * .8; const h = rec.h || 1; return [{ cyl: true, r, y0: 0, y1: h }];
  }
  const COLS = new Map(); // build id -> [colliders]
  function addCols(id, rec) {
    delCols(id); const out = []; const cs = Math.cos(rec.r || 0), sn = Math.sin(rec.r || 0);
    for (const b of localCols(rec)) {
      if (b.cyl) { out.push(L.addCol({ kind: 'cyl', x: rec.x, z: rec.z, r: b.r, y0: rec.y + b.y0, y1: rec.y + b.y1, bid: id })); continue; }
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2; // local centre -> world (rotation about Y by r: x' = x cos + z sin, z' = -x sin + z cos)
      const wx = rec.x + cx * cs + cz * sn, wz = rec.z - cx * sn + cz * cs;
      const c = { x: wx, z: wz, rot: rec.r || 0, hx: (b.x1 - b.x0) / 2, hz: (b.z1 - b.z0) / 2, y0: rec.y + b.y0, y1: rec.y + b.y1, bid: id, nocam: b.nocam, nowalk: b.nowalk };
      if (b.ramp) { c.y1 = rec.y + b.y1; c.y2 = rec.y + b.y1 + b.ramp; c.y0 = rec.y + b.y0 - (b.ramp ? 0 : 0); } // top rises toward local +Z
      if (b.door) { c.door = true; c.off = !!rec.o; }
      out.push(L.addCol(c));
    }
    out.x = rec.x; out.z = rec.z; COLS.set(id, out); if (L.grassInvalidate) L.grassInvalidate(rec.x, rec.z, 2.4);
  }
  function delCols(id) { const l = COLS.get(id); if (l) { for (const c of l) L.delCol(c); COLS.delete(id); if (L.grassInvalidate) L.grassInvalidate(l.x, l.z, 2.4); } }

  // ------------------------------------------------------------------ sync from the shared store
  const ITEMOBJ = new Map(); // id -> Object3D (stations/furniture, doors & gates animate separately)
  let REC = {}; const OCC = new Map(); // occupancy: frame:a:b:lv:cls -> id
  const occKey = (f, a, b, lv) => f + ':' + a + ':' + b + ':' + lv;
  L.buildRecs = () => REC;
  L.buildSync = function (builds) {
    REC = builds || {}; OCC.clear();
    for (const b of BATCH.values()) b.n = 0;
    const counts = new Map();
    for (const id in REC) { const r = REC[id]; if (PIECES[r.t] && r.t !== 'door' && r.t !== 'gate') { const k = r.tr + ':' + r.t; counts.set(k, (counts.get(k) || 0) + 1); } }
    for (const [k, n] of counts) { const [tr, pc] = k.split(':'); const b = batch(tr, pc); if (b) ensureCap(b, n); }
    // structural pieces
    for (const id in REC) {
      const r = REC[id]; const P = PIECES[r.t];
      if (P && r.f != null && r.ga != null && r.t !== 'door' && r.t !== 'gate') OCC.set(occKey(r.f, r.ga, r.gb, r.lv | 0) + ':' + (P.cls === 'fence' ? 'edge' : P.cls), id);
      if (!P || r.t === 'door' || r.t === 'gate') continue; const b = batch(r.tr, r.t); if (!b) continue;
      pieceMatrix(r, _m); b.parts.forEach((pt, i) => { _m2.multiplyMatrices(_m, pt.m); b.meshes[i].setMatrixAt(b.n, _m2); }); b.n++;
    }
    for (const b of BATCH.values()) for (const m of b.meshes) { m.count = b.n; m.instanceMatrix.needsUpdate = true; }
    // doors, gates, stations, furniture: individual objects
    for (const [id, o] of ITEMOBJ) if (!REC[id] || REC[id].t !== o.userData.t || REC[id].tr !== o.userData.tr) { L.scene.remove(o); ITEMOBJ.delete(id); }
    for (const id in REC) {
      const r = REC[id]; const P = PIECES[r.t]; if (P && r.t !== 'door' && r.t !== 'gate') { if (!COLS.has(id) || COLS.get(id).sig !== sig(r)) { addCols(id, r); COLS.get(id).sig = sig(r); } continue; }
      let o = ITEMOBJ.get(id);
      if (!o) { const src = P ? KIT[r.tr] && KIT[r.tr][r.t] : findFurn(r.t); if (!src) continue; o = src.clone(true); o.traverse(m => { if (m.isMesh) { const gl = /_glow/.test(m.name); m.material = gl ? L.MAT.glow : L.MAT.v4; m.castShadow = !gl; m.receiveShadow = true; if (gl) o.userData.glow = m; } }); o.userData.t = r.t; o.userData.tr = r.tr; o.userData.born = performance.now(); L.scene.add(o); ITEMOBJ.set(id, o); if (!P) { const bb = boxOf(o); r.h = bb.max.y - bb.min.y; } }
      o.position.set(r.x, r.y, r.z); if (!(r.t === 'door' || r.t === 'gate')) o.rotation.set(0, r.r || 0, 0); o.userData.rec = r;
      if (!COLS.has(id) || COLS.get(id).sig !== sig(r)) { addCols(id, r); COLS.get(id).sig = sig(r); }
    }
    for (const id of [...COLS.keys()]) if (!REC[id]) delCols(id);
    L.buildDirty = true;
  };
  const sig = r => r.t + r.tr + r.x.toFixed(2) + r.z.toFixed(2) + r.y.toFixed(2) + (r.r || 0).toFixed(2) + (r.o ? 1 : 0);
  // per-frame: doors swing, mills turn, items pop in
  L.buildTick = function (dt, t) {
    for (const [id, o] of ITEMOBJ) {
      const r = o.userData.rec; if (!r) continue;
      if (r.t === 'door' || r.t === 'gate') { const tgt = r.o ? (r.t === 'door' ? -1.6 : 1.6) : 0; o.userData.ang = lerp(o.userData.ang || 0, tgt, Math.min(1, dt * 6)); o.rotation.set(0, (r.r || 0) + o.userData.ang, 0); }
      const age = (performance.now() - o.userData.born) / 1000; if (age < .45) { const s = .6 + .4 * Math.sin(Math.min(1, age / .45) * Math.PI / 2); o.scale.set(1, s, 1); } else if (o.scale.y !== 1) o.scale.set(1, 1, 1);
      if (r.t === 'bau') { if (o.userData.lid === undefined) { o.userData.lid = null; o.traverse(m => { if (m.name === 'bau_lid') o.userData.lid = m; }); } const ld = o.userData.lid; if (ld) { const tg = L.chestOpenId === id ? -1.75 : 0; ld.rotation.x += (tg - ld.rotation.x) * Math.min(1, dt * 7); } }
      if (r.t === 'moinho') { if (!o.userData.blades) o.traverse(m => { if (/blade|pas|helice/i.test(m.name)) o.userData.blades = m; }); if (o.userData.blades) o.userData.blades.rotation.z = t * .6; }
    }
  };
  L.buildObj = id => ITEMOBJ.get(id);

  // ------------------------------------------------------------------ placement: snapping on frames
  // frames: every structural record carries f (frame id = id of its first foundation), fx, fz, fy, fr
  function frameNear(x, z, y, maxD) {
    let best = null, bd = maxD * maxD;
    for (const id in REC) { const r = REC[id]; if (r.f == null || !PIECES[r.t]) continue; const d = (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z) + ((r.y - y) * .3) * ((r.y - y) * .3); if (d < bd) { bd = d; best = r; } }
    return best ? { f: best.f, fx: best.fx, fz: best.fz, fy: best.fy, fr: best.fr } : null;
  }
  const toLocal = (F, x, z) => { const dx = x - F.fx, dz = z - F.fz, c = Math.cos(F.fr), s = Math.sin(F.fr); return [dx * c - dz * s, dx * s + dz * c]; };
  const toWorld = (F, lx, lz) => { const c = Math.cos(F.fr), s = Math.sin(F.fr); return [F.fx + lx * c + lz * s, F.fz - lx * s + lz * c]; };
  const occ = (F, a, b, lv, cls) => OCC.get(occKey(F.f, a, b, lv) + ':' + cls);
  function snapClass(cls, lx, lz) { // nearest half-cell grid point of the class
    const h = H; let a, b;
    if (cls === 'cell') { a = 2 * Math.round(lx / S3); b = 2 * Math.round(lz / S3); }
    else if (cls === 'corner') { a = 2 * Math.floor(lx / S3) + 1; b = 2 * Math.floor(lz / S3) + 1; }
    else { // edge: pick the nearer of the two edge families
      const a1 = 2 * Math.floor(lx / S3) + 1, b1 = 2 * Math.round(lz / S3); const a2 = 2 * Math.round(lx / S3), b2 = 2 * Math.floor(lz / S3) + 1;
      const d1 = Math.hypot(lx - a1 * h, lz - b1 * h), d2 = Math.hypot(lx - a2 * h, lz - b2 * h); if (d1 < d2) { a = a1; b = b1; } else { a = a2; b = b2; }
    }
    return [a, b];
  }
  function hasNeighbour(F, a, b, lv) { // any structural piece of the frame close to this slot (support)
    for (const id in REC) { const r = REC[id]; if (r.f !== F.f || r.ga == null) continue; const da = Math.abs(r.ga - a), db = Math.abs(r.gb - b), dl = (lv | 0) - (r.lv | 0); if (da <= 2 && db <= 2 && dl >= 0 && dl <= 1) return true; }
    return false;
  }
  // terrain under a foundation (3x3 samples): valid if the 1.2 m skirt reaches the ground everywhere
  function footOK(cx, cz, rot, y) {
    let mn = 1e9, mx = -1e9; const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const lx = i * 1.4, lz = j * 1.4; const h = L.ground(cx + lx * c + lz * s, cz - lx * s + lz * c); mn = Math.min(mn, h); mx = Math.max(mx, h); }
    return { ok: mn > .25 && mn >= y - 1.15 && mx <= y + .45, mn, mx };
  }
  // candidate record for piece t of tier tr aimed at (ax, ay, az) by a player at (px, pz); rot = user rotation steps, lvOff = level offset
  L.buildCandidate = function (t, tr, ax, ay, az, px, pz, rot, lvOff) {
    rot = rot | 0; lvOff = lvOff | 0; const P = PIECES[t];
    if (!P) { // furniture / station: free placement on the walkable surface under the aim point
      const I = ITEMS[t]; if (!I) return { ok: false }; const G = L.groundAt(ax, az, ay - .7, 1.2); const y = G.y; const r = Math.round(Math.atan2(px - ax, pz - az) / (Math.PI / 4)) * (Math.PI / 4) + rot * Math.PI / 4;
      const rec = { t, x: ax, y, z: az, r }; let ok = y > -.3 || !!G.col; let why = ok ? '' : 'Precisa de chão firme';
      if (ok) for (const id in REC) { const q = REC[id]; const Q = ITEMS[q.t]; if (!Q) continue; if (Math.abs(q.y - y) < 2 && Math.hypot(q.x - ax, q.z - az) < (Q.r + I.r) * .85) { ok = false; why = 'Muito perto de outro objeto'; break; } }
      if (ok) { _p.set(ax, y, az); const ox = ax, oz = az; L.collideXZ(_p, I.r * .7, 1.2, .3); if (Math.hypot(_p.x - ox, _p.z - oz) > .05) { ok = false; why = 'Bate numa parede'; } }
      return { ok, rec, why };
    }
    if (t === 'door' || t === 'gate') { // into a doorway / fence
      const host = t === 'door' ? 'doorway' : 'fence'; let best = null, bd = 9;
      for (const id in REC) { const q = REC[id]; if (q.t !== host) continue; const d = (q.x - ax) * (q.x - ax) + (q.z - az) * (q.z - az) + (q.y + 1 - ay) * (q.y + 1 - ay) * .3; if (d < bd) { bd = d; best = [id, q]; } }
      if (!best) return { ok: false, why: t === 'door' ? 'Mire numa parede com porta' : 'Mire numa cerca' };
      const [hid, q] = best; for (const id in REC) if (REC[id].host === hid) return { ok: false, why: 'Já tem ' + (t === 'door' ? 'porta' : 'portão') + ' aqui' };
      const off = t === 'door' ? -.62 : -1.45; const c = Math.cos(q.r || 0), s = Math.sin(q.r || 0); const flip = rot % 2 ? Math.PI : 0;
      const ox = flip ? -off : off; const rec = { t, tr: q.tr, x: q.x + ox * c, y: q.y, z: q.z - ox * s, r: (q.r || 0) + flip, host: hid, f: q.f, fx: q.fx, fz: q.fz, fy: q.fy, fr: q.fr };
      return { ok: true, rec };
    }
    // fences outside any frame chain end to end along the terrain
    let F = frameNear(ax, az, ay, P.cls === 'fence' ? 4.5 : 7.5);
    if (P.cls === 'fence' && !F) {
      let end = null, bd = 2.6 * 2.6;
      for (const id in REC) { const q = REC[id]; if (q.t !== 'fence' || q.f != null) continue; const c = Math.cos(q.r || 0), s = Math.sin(q.r || 0); for (const sg of [-1, 1]) { const ex = q.x + sg * 1.5 * c, ez = q.z - sg * 1.5 * s; const d = (ex - ax) * (ex - ax) + (ez - az) * (ez - az); if (d < bd) { bd = d; end = [ex, ez, q.r || 0, sg]; } } }
      let x = ax, z = az, r;
      if (end) { const base = end[2]; let ang = Math.atan2(ax - end[0], az - end[1]); const rel = wrapA(ang - (base + Math.PI / 2 * end[3])); const q15 = Math.round(rel / (Math.PI / 12)) * (Math.PI / 12); const dirA = base + Math.PI / 2 * end[3] + clamp(q15, -Math.PI / 3, Math.PI / 3) + rot * Math.PI / 12; x = end[0] + Math.sin(dirA) * 1.5; z = end[1] + Math.cos(dirA) * 1.5; r = dirA - Math.PI / 2; }
      else r = Math.atan2(px - ax, pz - az) + Math.PI / 2 + rot * Math.PI / 12;
      const y = L.ground(x, z) - .05; const rec = { t, tr, x, y, z, r }; const ok = y > .1 && L.slope(x, z) < .9;
      return { ok, rec, why: ok ? '' : 'Terreno ruim', chain: !!end };
    }
    if (!F) { // new structure: only foundations (and pillars / stairs on the ground) start a frame
      if (t !== 'foundation' && t !== 'pillar' && t !== 'stairs') return { ok: false, why: 'Comece com uma fundação' };
      const fr = Math.round(Math.atan2(ax - px, az - pz) / (Math.PI / 12)) * (Math.PI / 12) + rot * Math.PI / 12;
      let y = -1e9; const c = Math.cos(fr), s = Math.sin(fr); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) y = Math.max(y, L.ground(ax + i * 1.4 * c + j * 1.4 * s, az - i * 1.4 * s + j * 1.4 * c)); y += .08;
      if (t !== 'foundation') y = L.ground(ax, az) - .02;
      const rec = { t, tr, x: ax, y, z: az, r: fr, ga: 0, gb: 0, lv: 0, fx: ax, fz: az, fy: y, fr, f: 'new' };
      const fo = t === 'foundation' ? footOK(ax, az, fr, y) : { ok: y > .2 }; return { ok: fo.ok, rec, why: fo.ok ? '' : (fo.mn <= .25 ? 'Não dá na água' : 'Chão muito inclinado') };
    }
    // snapped piece in frame F
    const [lx, lz] = toLocal(F, ax, az); const cls = P.cls === 'fence' ? 'edge' : P.cls; const [a, b] = snapClass(cls, lx, lz);
    const [wx, wz] = toWorld(F, a * H, b * H);
    // level: lowest free slot from the aim height, plus the user's offset
    let lv0 = Math.max(0, Math.round((ay - 1.2 - F.fy) / S3)); if (t === 'foundation') lv0 = 0;
    if (t === 'roof' || t === 'floor') lv0 = Math.max(1, lv0);
    let lv = lv0; const clsKey = cls;
    if (t !== 'foundation') { for (let k = 0; k < 8; k++) { if (!occ(F, a, b, lv, clsKey)) break; lv++; } }
    lv = Math.max(t === 'roof' || t === 'floor' ? 1 : 0, lv + lvOff); if (t === 'foundation') lv = 0;
    let y = F.fy + lv * S3;
    let r = F.fr;
    if (cls === 'edge') { // wall long axis along the edge, its +Z face toward the player (flip with rotate)
      const [plx, plz] = toLocal(F, px, pz); const side = (a & 1) ? plx - a * H : plz - b * H;
      r = F.fr + ((a & 1) ? Math.PI / 2 : 0) + (side >= 0 ? 0 : Math.PI) + (rot % 2) * Math.PI;
    }
    else if (cls === 'cell' && (t === 'roof' || t === 'stairs')) { // climbs / rises away from the player
      const [plx, plz] = toLocal(F, px, pz); const d = Math.atan2(a * H - plx, b * H - plz); const q = Math.round(d / (Math.PI / 2)) * (Math.PI / 2); r = F.fr + q + (rot % 4) * Math.PI / 2;
    }
    else if (cls === 'cell') r = F.fr + (rot % 4) * Math.PI / 2;
    if (P.cls === 'fence') y = Math.max(L.ground(wx, wz) - .05, F.fy + lv * S3);
    const rec = { t, tr, x: wx, y, z: wz, r, ga: a, gb: b, lv, f: F.f, fx: F.fx, fz: F.fz, fy: F.fy, fr: F.fr };
    if (occ(F, a, b, lv, clsKey)) return { ok: false, rec, why: 'Já tem uma peça aqui' };
    if (t === 'foundation') { const fo = footOK(wx, wz, F.fr, y); if (!fo.ok) return { ok: false, rec, why: fo.mn <= .25 ? 'Não dá na água' : 'Chão muito longe da fundação' }; return { ok: true, rec }; }
    if (!hasNeighbour(F, a, b, lv)) return { ok: false, rec, why: 'Precisa de apoio de outra peça' };
    return { ok: true, rec };
  };
  L.buildCost = function (t, tr, discount) {
    const P = PIECES[t]; let c = {}; if (P) { const per = TIERS[tr].per; for (const k in per) c[k] = per[k] * P.u; } else if (ITEMS[t]) c = Object.assign({}, ITEMS[t].cost);
    if (discount) for (const k in c) c[k] = Math.max(1, Math.round(c[k] * (1 - discount))); return c;
  };
  // ghost preview
  const GHOST = { o: null, key: '', matOk: null, matBad: null };
  L.buildGhost = function (cand, t, tr) {
    const key = t + ':' + (tr || ''); if (!GHOST.matOk) { GHOST.matOk = new THREE.MeshBasicMaterial({ color: 0x7dffc8, transparent: true, opacity: .45, depthWrite: false }); GHOST.matBad = new THREE.MeshBasicMaterial({ color: 0xff6a6a, transparent: true, opacity: .45, depthWrite: false }); }
    if (!cand) { if (GHOST.o) GHOST.o.visible = false; return; }
    if (GHOST.key !== key) { if (GHOST.o) L.scene.remove(GHOST.o); const src = PIECES[t] ? KIT[tr] && KIT[tr][t] : findFurn(t); GHOST.o = src ? src.clone(true) : null; GHOST.key = key; if (GHOST.o) { GHOST.o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.renderOrder = 8; } }); L.scene.add(GHOST.o); } }
    const o = GHOST.o; if (!o || !cand.rec) return; o.visible = true; o.position.set(cand.rec.x, cand.rec.y, cand.rec.z); o.rotation.set(0, cand.rec.r || 0, 0);
    const mat = cand.ok ? GHOST.matOk : GHOST.matBad; o.traverse(m => { if (m.isMesh) m.material = mat; });
  };
  L.buildGhostOff = function () { if (GHOST.o) { L.scene.remove(GHOST.o); GHOST.o = null; GHOST.key = ''; } };
  // nearest built thing to a point (for using stations, opening doors, demolishing)
  L.buildNearest = function (x, y, z, r, filter) {
    let best = null, bd = r * r;
    for (const id in REC) { const q = REC[id]; if (filter && !filter(q)) continue; let cx = q.x, cz = q.z; const P = PIECES[q.t];
      if (q.t === 'door' || q.t === 'gate') { const w = q.t === 'door' ? .62 : 1.45; cx += Math.cos(q.r || 0) * w; cz -= Math.sin(q.r || 0) * w; }
      const dy = (y - (q.y + (P && q.t !== 'foundation' && q.t !== 'floor' ? 1.2 : .2))) * .7; const d = (cx - x) * (cx - x) + (cz - z) * (cz - z) + dy * dy; if (d < bd) { bd = d; best = { id, rec: q, d: Math.sqrt(d) }; } }
    return best;
  };
  // frame id assignment for a new foundation that starts a structure
  L.buildFinalize = function (id, rec) { if (rec.f === 'new') { rec.f = id; } return rec; };
})(window.L);
