/* Lumiar v4 creatures: dozens of species spread over the island by region and landmark, real gaits from rig.js,
   herds, flee / curious behaviour, taming by feeding, followers, ground and flying mounts, powers. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep } = L;
  const TAU = Math.PI * 2;
  const wrapA = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const d2 = (a, b, c, d) => (a - c) * (a - c) + (b - d) * (b - d);

  // ------------------------------------------------------------------ species
  // m: model, s: scale, walk/run: m/s, turn: rad/s, R: body radius, food & cost: taming, anim: quad|hop|bird|float|biped
  // reg: spawn weight per region, grp: herd size, time: any|day|night, temper: shy|calm|curious, mount: {speed, fly, seat}
  const SP = {
    raposa: { nome: 'Raposa', ic: '🦊', m: 'fox', s: 1, walk: .85, run: 8.5, turn: 4.5, R: .3, food: 'frutinhas', cost: 3, reg: { vale: 3, antiga: 2, pinho: 2, lago: 2, costa: 1.2 }, grp: [1, 2], temper: 'curious', sits: true, pow: { id: 'faro', nome: 'Faro', desc: 'mostra minérios e cristais no mapa' } },
    raposa_fogo: { nome: 'Raposa de Fogo', ic: '🔥', m: 'fox_fire', s: 1.05, walk: .9, run: 9, turn: 4.5, R: .3, food: 'cogumelo', cost: 4, reg: { canion: 4, dragao: 2.2 }, grp: [1, 1], temper: 'curious', sits: true, embers: true, pow: { id: 'chama', nome: 'Chama', desc: 'acende fogueiras e forjas sem lenha' } },
    lobo: { nome: 'Lobo', ic: '🐺', m: 'wolf', s: 1, walk: 1.2, run: 10, turn: 3.6, R: .45, food: 'frutinhas', cost: 5, reg: { pinho: 4, montes: 2.6, penhas: 1.2 }, grp: [3, 5], temper: 'calm', sits: true, howl: true, pow: { id: 'uivo', nome: 'Uivo', desc: '+25% de velocidade à noite' } },
    lobo_esp: { nome: 'Lobo Espiritual', ic: '🌕', m: 'wolf_spirit', s: 1.1, walk: 1.2, run: 10, turn: 3.6, R: .45, food: 'cristal', cost: 6, time: 'night', grp: [1, 1], temper: 'calm', sits: true, howl: true, glowLight: 0x9fd8ff, pow: { id: 'lua', nome: 'Uivo da Lua', desc: 'mostra criaturas raras no mapa' } },
    cervo: { nome: 'Cervo', ic: '🦌', m: 'deer', s: 1, walk: 1.15, run: 11, turn: 3.2, R: .5, food: 'frutinhas', cost: 4, reg: { vale: 3, antiga: 3, lago: 2.2, pinho: 1.6 }, grp: [3, 6], temper: 'shy', grazer: true, does: 'deer_antlers', pow: { id: 'vento', nome: 'Passo do Vento', desc: '+35% de velocidade' } },
    cavalo: { nome: 'Cavalo', ic: '🐎', m: 'horse', s: 1, walk: 1.5, run: 12, turn: 2.8, R: .6, food: 'abobora', cost: 4, reg: { planicie: 5, vale: .8, costa: .8 }, grp: [3, 6], temper: 'shy', grazer: true, saddle: 'horse_saddle', tints: [1, .62, .82, .45, 1.12], mount: { speed: 15, seat: ['spine', .3, .05] }, pow: { id: 'montaria', nome: 'Montaria', desc: 'monte e galope pelo mapa' } },
    cabra: { nome: 'Cabra Montesa', ic: '🐐', m: 'goat', s: 1, walk: .9, run: 7, turn: 4, R: .4, food: 'fibra', cost: 3, reg: { montes: 4, penhas: 4, dragao: 2, canion: 1 }, grp: [2, 4], temper: 'shy', grazer: true, climber: true, pow: { id: 'escalada', nome: 'Escalada', desc: 'sobe encostas íngremes' } },
    javali: { nome: 'Javali', ic: '🐗', m: 'boar', s: 1, walk: .9, run: 7.5, turn: 3.5, R: .45, food: 'cogumelo', cost: 4, reg: { antiga: 3, pantano: 2, pinho: 1.2 }, grp: [2, 4], temper: 'calm', grazer: true, pow: { id: 'fucador', nome: 'Fuçador', desc: 'acha cogumelos e sementes extras' } },
    urso: { nome: 'Urso', ic: '🐻', m: 'bear', s: 1, walk: 1.1, run: 8, turn: 2.6, R: .7, food: 'frutinhas', cost: 6, reg: { pinho: 2, antiga: 1.2, montes: 1 }, grp: [1, 1], temper: 'calm', sits: true, mount: { speed: 9, seat: ['spine', .38, 0] }, pow: { id: 'forca', nome: 'Força', desc: 'dobro de madeira e pedra' } },
    coelho: { nome: 'Coelho', ic: '🐰', m: 'rabbit', s: 1, walk: 1.1, run: 7, turn: 6, R: .2, food: 'sementes', cost: 3, reg: { vale: 5, planicie: 3, lago: 3, costa: 2 }, grp: [2, 4], temper: 'shy', anim: 'hop', grazer: true, pow: { id: 'sorte', nome: 'Sorte', desc: 'chance de colheita dobrada' } },
    esquilo: { nome: 'Esquilo', ic: '🐿️', m: 'squirrel', s: 1, walk: 1, run: 5.5, turn: 7, R: .15, food: 'sementes', cost: 3, reg: { antiga: 4, pinho: 3, vale: 2 }, grp: [1, 3], temper: 'curious', anim: 'hop', sits: true, pow: { id: 'coleta', nome: 'Coleta', desc: 'frutinhas e sementes extras' } },
    pantera: { nome: 'Pantera Negra', ic: '🐆', m: 'panther', s: 1, walk: 1.1, run: 11, turn: 3.8, R: .45, food: 'cogumelo', cost: 6, reg: { antiga: .35 }, grp: [1, 1], temper: 'calm', sits: true, pow: { id: 'sombra', nome: 'Sombra', desc: 'as criaturas não fogem de você' } },
    lumi: { nome: 'Lumi', ic: '✨', m: 'lumi', s: 1, walk: .8, run: 4, turn: 5, R: .2, food: 'cristal', cost: 3, reg: { pantano: .8, antiga: .3 }, time: 'night', grp: [2, 4], temper: 'curious', anim: 'float', glowLight: 0xb6f7ff, pow: { id: 'brilho', nome: 'Brilho', desc: 'uma luz acompanha você à noite' } },
    cervo_lunar: { nome: 'Cervo Lunar', ic: '🌙', m: 'deer_lunar', s: 1.08, walk: 1.1, run: 12, turn: 3.2, R: .5, food: 'cristal', cost: 6, time: 'night', grp: [1, 2], temper: 'shy', grazer: true, glowLight: 0xc9b8ff, mount: { speed: 13, jump: 2.2, seat: ['spine', .3, .05] }, pow: { id: 'salto', nome: 'Salto Lunar', desc: 'pulo muito mais alto' } },
    coruja: { nome: 'Coruja', ic: '🦉', m: 'owl', s: 1, walk: .3, run: 6, turn: 4, R: .2, food: 'sementes', cost: 3, reg: { pinho: 2, antiga: 2.2 }, time: 'night', grp: [1, 1], temper: 'calm', anim: 'bird', perch: true, pow: { id: 'olhos', nome: 'Olhos da Noite', desc: 'enxerga melhor no escuro' } },
    sapo: { nome: 'Sapo', ic: '🐸', m: 'frog', s: 1, walk: .6, run: 2.6, turn: 6, R: .12, food: 'cogumelo', cost: 3, reg: { pantano: 6, lago: 1.6 }, grp: [2, 4], temper: 'curious', anim: 'hop', pow: { id: 'lirio', nome: 'Pés de Lírio', desc: 'anda sobre a água' } },
    tartaruga: { nome: 'Tartaruga', ic: '🐢', m: 'turtle', s: 1, walk: .32, run: .7, turn: 1.5, R: .4, food: 'fibra', cost: 4, reg: { costa: 1.6 }, grp: [2, 4], temper: 'calm', beach: true, pow: { id: 'casco', nome: 'Casco', desc: 'nada muito mais rápido' } },
    grifo: { nome: 'Grifo', ic: '🦅', m: 'griffin', s: 1.15, walk: 1.5, run: 8, turn: 3, R: .7, food: 'abobora', cost: 8, grp: [1, 1], temper: 'calm', flyer: { speed: 15, alt: [35, 80] }, mount: { speed: 9, fly: 20, seat: ['chest', .34, -.1] }, pow: { id: 'grifo', nome: 'Voo do Grifo', desc: 'monte e voe pelo céu' } },
    dragao: { nome: 'Dragão', ic: '🐉', m: 'dragon', s: 1.7, walk: 2, run: 7, turn: 1.6, R: 2.2, food: 'cristal', cost: 10, grp: [1, 1], temper: 'calm', roar: true, flyer: { speed: 18, alt: [55, 110] }, mount: { speed: 9, fly: 26, seat: ['chest', .42, .2] }, pow: { id: 'asas', nome: 'Asas do Dragão', desc: 'monte, voe e acenda tudo' } },
    dragaozinho: { nome: 'Dragãozinho', ic: '🐲', m: 'dragon_baby', s: 1, walk: 1, run: 4.5, turn: 4, R: .35, food: 'frutinhas', cost: 5, reg: { dragao: 1.6, canion: .5 }, grp: [1, 2], temper: 'curious', sits: true, pow: { id: 'planar', nome: 'Planar', desc: 'plana ao cair de lugares altos' } },
    golem: { nome: 'Golem de Musgo', ic: '🗿', m: 'golem', s: 1, walk: .9, run: 2.2, turn: 1.8, R: .8, food: 'pedra', cost: 8, grp: [1, 1], temper: 'calm', anim: 'biped', pow: { id: 'construtor', nome: 'Mestre Construtor', desc: 'construções custam 30% menos' } },
  };
  for (const k in SP) { SP[k].k = k; SP[k].anim = SP[k].anim || 'quad'; SP[k].time = SP[k].time || 'any'; }
  L.SPECIES = SP;
  // landmark spawns (always there when the player is near)
  const SPECIALS = [
    { sp: 'dragao', poi: 'ninho', n: 1, HR: 26 },
    { sp: 'dragaozinho', poi: 'ninho', n: 2, off: 34, HR: 30 },
    { sp: 'grifo', perch: 'grifo', n: 1, HR: 30 },
    { sp: 'golem', poi: 'gruta', n: 1, off: 18, HR: 14 },
    { sp: 'pantera', poi: 'toca', n: 1, off: 8, HR: 26 },
    { sp: 'lobo_esp', poi: 'picolobo', n: 3, off: 20, HR: 45 },
    { sp: 'cervo_lunar', poi: 'clareira', n: 2, off: 10, HR: 26 },
    { sp: 'lumi', poi: 'clareira', n: 3, off: 6, HR: 18 },
    { sp: 'lumi', poi: 'santuario', n: 4, off: 6, HR: 20 },
    { sp: 'tartaruga', poi: 'farol', n: 4, off: 20, HR: 30 },
    { sp: 'cavalo', poi: 'coluna', n: 5, off: 60, HR: 90 },
    { sp: 'coelho', poi: 'spawn', n: 3, off: 26, HR: 22 },
    { sp: 'raposa', poi: 'spawn', n: 1, off: 40, HR: 30 },
  ];
  const NAMES = ['Pipoca', 'Bolota', 'Faísca', 'Luna', 'Trovão', 'Mel', 'Brisa', 'Cometa', 'Pingo', 'Aurora', 'Canela', 'Fubá', 'Nuvem', 'Orvalho', 'Pérola', 'Sálvia', 'Tico', 'Juju', 'Boris', 'Amora', 'Estrela', 'Fofura', 'Sombra', 'Rubi', 'Caju', 'Lótus', 'Kiwi', 'Neblina', 'Pudim', 'Zéfiro'];
  L.petName = seed => NAMES[Math.abs(seed | 0) % NAMES.length];

  // ------------------------------------------------------------------ models (loaded on demand)
  const MODEL = {}; // model name -> scene | null (missing) | undefined (not requested) | 'loading'
  function need(m) {
    const v = MODEL[m]; if (v === undefined) { MODEL[m] = 'loading'; L.loadModel(m).then(s => { MODEL[m] = s || null; }); return null; }
    return v === 'loading' ? null : v;
  }
  const ok = sp => MODEL[SP[sp].m] !== null; // false only when known missing
  L.crPreload = list => list.forEach(sp => SP[sp] && need(SP[sp].m));

  // ------------------------------------------------------------------ creature
  const CRS = []; L.CRS = CRS; const BYID = new Map(); L.CRBYID = BYID;
  let uid = 0;
  class Cr {
    constructor(sp, x, z, o) {
      o = o || {}; const S = SP[sp]; this.sp = sp; this.S = S; this.id = o.id || ('c' + (++uid)); this.x = x; this.z = z; this.y = L.ground(x, z); this.ry = o.ry != null ? o.ry : Math.random() * TAU;
      this.v = 0; this.vy = 0; this.turnRate = 0; this.home = [x, z]; this.HR = o.HR || 40; this.grp = o.grp || null; this.state = 'idle'; this.timer = 1 + Math.random() * 4; this.tx = x; this.tz = z; this.speedT = 0;
      this.scale = S.s * (o.scale || 1) * (1 + (L.hash2(x * 3.1, z * 1.7) - .5) * .14); this.aff = 0; this.owner = null; this.pet = null; this.I = null; this.fade = 0; this.wild = !o.pet; this.cell = o.cell || null; this.special = o.special || null;
      this.st = { t: Math.random() * 20, dt: 0, speed: 0, turn: 0, seed: Math.random() * 10, look: [0, 0] }; this.graze = 0; this.sit = 0; this.alert = 0; this.fly = 0; this.alt = 0; this.anT = 0; this.seed = L.hash2(x, z);
      this.doe = S.does && this.seed < .55; this.tint = S.tints ? S.tints[Math.floor(this.seed * 7919) % S.tints.length] : 1;
      this.perch = o.perch || null; if (this.perch) { this.x = this.perch.x; this.z = this.perch.z; this.y = this.perch.y; }
      CRS.push(this); BYID.set(this.id, this);
    }
    ensureMesh() {
      if (this.I) return true; const src = need(this.S.m); if (!src) return false;
      const S = this.S; let mat = null; if (this.tint !== 1) { mat = L.MAT.v4skin.clone(); mat.color.setScalar(this.tint); mat.userData.own = true; }
      const I = L.instRigged(src, { mat }); this.I = I; I.root.scale.setScalar(this.scale * .01); L.scene.add(I.root);
      I.root.traverse(o => { if (!o.isMesh) return; if (S.does && o.name.indexOf(S.does.replace('.', '')) === 0 && this.doe) o.visible = false; if (S.saddle && o.name.indexOf(S.saddle) === 0) { this.saddle = o; o.visible = !!this.pet; } });
      if (S.glowLight) { const g = L.glowSprite(S.glowLight, 2.2 / this.scale, .55); g.position.y = I.rig.hipH * 1.2; I.root.add(g); this.glow = g; }
      this.rad = Math.max(I.rig.hipH * 2.2, S.R * 2.5) * this.scale; this.fade = 0; return true;
    }
    dispose() {
      if (this.I) { L.scene.remove(this.I.root); this.I.root.traverse(o => { if (o.isSkinnedMesh && o.skeleton && o.skeleton.boneTexture) o.skeleton.dispose(); if (o.material && o.material !== L.MAT.v4skin && o.material.isMaterial && o.material.userData.own) o.material.dispose(); }); this.I = null; }
      const i = CRS.indexOf(this); if (i >= 0) CRS.splice(i, 1); BYID.delete(this.id);
    }
    hipH() { return this.I ? this.I.rig.hipH * this.scale : .5; }
  }
  L.Cr = Cr;

  // ------------------------------------------------------------------ spawning by 160 m cells
  const CELL = 160, ACT_R = 270, DROP_R = 400; const cells = new Map(); let night = false;
  const _B = {};
  function cellKey(i, j) { return (i + 64) * 256 + (j + 64); }
  function landOK(S, x, z) {
    const h = L.ground(x, z); if (S.beach) return h > .3 && h < 3.2; if (h < .5) return false;
    if (!S.climber && L.slope(x, z) > .75) return false; if (L.distRiver(x, z) < 2) return false; return true;
  }
  function spawnCell(i, j) {
    const R = L.mulberry32((Math.imul(i + 97, 73856093) ^ Math.imul(j + 31, 19349663)) >>> 0); const cx = (i + .5) * CELL, cz = (j + .5) * CELL; const list = [];
    const ng = R() < .8 ? (R() < .45 ? 2 : 1) : 0;
    for (let g = 0; g < ng; g++) {
      const px = cx + (R() - .5) * CELL * .8, pz = cz + (R() - .5) * CELL * .8, r1 = R(), r2 = R(), r3 = R();
      if (L.rawH(px, pz) < .6) continue; L.biome(px, pz, _B);
      let tot = 0; const cand = [];
      for (const k in SP) { const S = SP[k]; if (!S.reg || !ok(k)) continue; if (S.time === 'night' && !night) continue; let w = 0; for (const r in S.reg) w += S.reg[r] * (_B[r] || 0); if (w > .03) { cand.push([k, w]); tot += w; } }
      if (!tot) continue; let pick = r1 * tot, sp = cand[0][0]; for (const [k, w] of cand) { pick -= w; if (pick <= 0) { sp = k; break; } }
      const S = SP[sp]; const n = S.grp[0] + Math.floor(r2 * (S.grp[1] - S.grp[0] + 1)); const grp = n > 1 ? { lead: null, alarm: 0, tx: px, tz: pz } : null;
      for (let k = 0; k < n; k++) {
        const id = sp + '_' + i + '_' + j + '_' + g + '_' + k; if (L.crTamed && L.crTamed(id)) continue; if (BYID.has(id)) continue;
        let x = px + Math.cos(k * 2.4 + r3 * 6) * (1.5 + k * 1.6), z = pz + Math.sin(k * 2.4 + r3 * 6) * (1.5 + k * 1.6);
        if (!landOK(S, x, z)) { const p = L.findLand(x, z, S.beach ? .3 : .6, S.beach ? 3 : 4000, S.climber ? 1.2 : .6); x = p[0]; z = p[1]; if (!landOK(S, x, z)) continue; }
        const c = new Cr(sp, x, z, { id, grp, HR: S.beach ? 30 : 55, cell: cellKey(i, j) }); if (grp && !grp.lead) grp.lead = c; list.push(c);
      }
    }
    return list;
  }
  const specialOn = new Map(); // special index -> [creatures]
  function spawnSpecial(si, X) {
    const S = SP[X.sp]; const out = []; let px, pz, perch = null;
    if (X.perch) { const P = L.SPECIAL.find(s => s.kind === 'perch' && s.id === X.perch); if (!P) return out; px = P.x; pz = P.z; perch = { x: P.x, z: P.z, y: P.y }; }
    else { const p = L.POI.find(q => q.id === X.poi); if (!p) return out; px = p.x; pz = p.z; }
    for (let k = 0; k < X.n; k++) {
      const id = 's' + si + '_' + X.sp + '_' + k; if (L.crTamed && L.crTamed(id)) continue; if (BYID.has(id)) { out.push(BYID.get(id)); continue; }
      const a = k * 2.3 + si, r = (X.off || 0) + k * 3; let x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (!perch && !landOK(S, x, z)) { const p = L.findLand(x, z, S.beach ? .3 : .6, S.beach ? 3 : 4000, 1); x = p[0]; z = p[1]; }
      const c = new Cr(X.sp, x, z, { id, HR: X.HR, special: si, perch: k === 0 ? perch : null }); c.home = perch ? [px, pz] : [x, z]; out.push(c);
    }
    return out;
  }
  function spawner(px, pz) {
    const ci = Math.floor(px / CELL), cj = Math.floor(pz / CELL), rr = Math.ceil(ACT_R / CELL);
    for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) {
      const k = cellKey(i, j); if (cells.has(k)) continue; if (Math.hypot((i + .5) * CELL - px, (j + .5) * CELL - pz) > ACT_R) continue;
      if (Math.abs((i + .5) * CELL) > L.WS || Math.abs((j + .5) * CELL) > L.WS) continue;
      cells.set(k, { i, j, list: spawnCell(i, j), night });
    }
    for (const [k, c] of cells) {
      const far = Math.hypot((c.i + .5) * CELL - px, (c.j + .5) * CELL - pz) > DROP_R;
      if (far || c.night !== night) { // night cells re-roll at dawn and dusk (once out of sight)
        let busy = false; if (!far) for (const cr of c.list) if (cr.I && cr.fade > 0 && cr.wild && cr.visibleNow) busy = true;
        if (busy) continue; for (const cr of c.list) if (cr.wild && !cr.mounted) cr.dispose(); cells.delete(k);
      }
    }
    SPECIALS.forEach((X, si) => {
      const S = SP[X.sp]; if (!ok(X.sp)) return; let p = X.perch ? L.SPECIAL.find(s => s.kind === 'perch' && s.id === X.perch) : L.POI.find(q => q.id === X.poi); if (!p) return;
      const d = Math.hypot(p.x - px, p.z - pz); const want = d < 380 && (S.time !== 'night' || night) && (S.time !== 'day' || !night);
      const cur = specialOn.get(si);
      if (want && !cur) specialOn.set(si, spawnSpecial(si, X));
      else if (!want && cur && d > 300) { for (const c of cur) if (c.wild && !c.mounted && !(c.I && c.visibleNow && c.fade > 0)) c.dispose(); specialOn.delete(si); }
    });
  }

  // ------------------------------------------------------------------ behaviour
  const FR = new THREE.Frustum(), PV = new THREE.Matrix4(), SPH = new THREE.Sphere(); const _v = new THREE.Vector3();
  function pickWander(c) {
    const S = c.S; for (let k = 0; k < 8; k++) {
      let ax = c.home[0], az = c.home[1]; if (c.grp && c.grp.lead && c.grp.lead !== c && c.grp.lead.wild) { ax = c.grp.tx; az = c.grp.tz; }
      const a = Math.random() * TAU, r = (c.grp && c.grp.lead !== c ? 2 + Math.random() * 6 : Math.random() * c.HR);
      const x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r; if (landOK(S, x, z)) { c.tx = x; c.tz = z; if (c.grp && c.grp.lead === c) { c.grp.tx = x; c.grp.tz = z; } return true; }
    }
    return false;
  }
  function setState(c, s, t) { c.state = s; c.timer = t; }
  // ctx: { px, pz, py, pv (player speed), food (has this creature's food), sombra (no fleeing), owners: id -> {x,z,y,ry,v}, dt, t }
  function think(c, ctx, dt) {
    const S = c.S; c.timer -= dt; const dpx = ctx.px - c.x, dpz = ctx.pz - c.z, dp = Math.hypot(dpx, dpz);
    let want = 0, head = c.ry; c.lookAt = null; c.graze = 0; let sitT = 0;
    // ---- tamed creatures
    if (c.pet) {
      const P = c.pet, O = ctx.owners[c.owner];
      if (c.mounted) return; // driven by the rider
      if (P.f && O) {
        const slot = c.slot || 0; const back = 2.4 + S.R * 2 + slot * 1.3, side = (slot % 2 ? 1 : -1) * (1 + slot * .5);
        const fx = Math.sin(O.ry), fz = Math.cos(O.ry); const gx = O.x - fx * back + fz * side, gz = O.z - fz * back - fx * side;
        const dg = Math.hypot(gx - c.x, gz - c.z), dO = Math.hypot(O.x - c.x, O.z - c.z);
        if (dO > 90 && !c.visibleNow) { c.x = gx; c.z = gz; c.y = L.ground(gx, gz); c.v = 0; c.fly = 0; return; } // catch up out of sight
        if (dg > 1.2) { head = Math.atan2(gx - c.x, gz - c.z); want = dg > 14 ? S.run : dg > 5 ? Math.min(S.run, Math.max(S.walk * 2.4, (O.v || 0) * 1.1)) : Math.min(S.walk * 1.8, dg * .8); c.idleT = 0; }
        else { c.idleT = (c.idleT || 0) + dt; head = c.ry; if (c.idleT > 3 && S.sits) sitT = 1; c.lookAt = [O.x, (O.y || 0) + 1.5, O.z]; }
        if (S.flyer && dO > 60) { c.fly = 1; }
        c.wantV = want; c.wantH = head; c.sitT = sitT; return;
      }
      // staying: sit near the saved spot, look at people that come close
      const dh = Math.hypot(c.home[0] - c.x, c.home[1] - c.z); if (dh > 2) { head = Math.atan2(c.home[0] - c.x, c.home[1] - c.z); want = S.walk; }
      else { if (S.sits) sitT = 1; if (S.grazer && Math.sin(ctx.t * .3 + c.seed * 9) > .3) c.graze = 1; if (dp < 9) c.lookAt = [ctx.px, ctx.py + 1.5, ctx.pz]; }
      c.wantV = want; c.wantH = head; c.sitT = sitT; return;
    }
    // ---- wild creatures
    const shy = S.temper === 'shy', calmPlayer = ctx.pv < 3.6 || ctx.sombra;
    const scareR = ctx.sombra ? 0 : shy ? (calmPlayer ? 3 : 16) : S.temper === 'calm' ? (calmPlayer ? 0 : 7) : (calmPlayer ? 0 : 4);
    if (c.grp && c.grp.alarm > ctx.t && c.state !== 'flee') setState(c, 'flee', 4 + Math.random() * 2);
    if (dp < scareR && c.state !== 'flee' && !c.fed) { setState(c, 'flee', 4 + Math.random() * 3); if (c.grp) c.grp.alarm = ctx.t + 1.2; if (S.howl && Math.random() < .3) L.crSound && L.crSound('howl', c); }
    if (c.fed && ctx.t - c.fed > 25) c.fed = 0;
    switch (c.state) {
      case 'flee': {
        if (c.timer < 0 && dp > 30) { setState(c, 'idle', 2 + Math.random() * 3); break; }
        const ax = -dpx / (dp || 1), az = -dpz / (dp || 1); head = Math.atan2(ax, az) + Math.sin(ctx.t * .7 + c.seed * 20) * .4; want = S.run;
        const fx = c.x + Math.sin(head) * 6, fz = c.z + Math.cos(head) * 6; if (!landOK(S, fx, fz)) head += 1.3; break;
      }
      case 'walk': {
        const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz); head = Math.atan2(dx, dz); want = c.speedT;
        if (d < Math.max(.6, c.v * .6) || c.timer < 0) { setState(c, 'idle', 3 + Math.random() * 9); c.idleKind = S.grazer && Math.random() < .7 ? 'graze' : S.sits && Math.random() < .35 ? 'sit' : 'look'; }
        else if (d < 2.5) want = Math.min(want, S.walk); break;
      }
      case 'curious': {
        if (!ctx.food || dp > 16 || c.timer < 0) { setState(c, 'idle', 2); break; }
        if (dp > 2.6) { head = Math.atan2(dpx, dpz); want = dp > 6 ? S.walk * 1.6 : S.walk * .9; } else { head = Math.atan2(dpx, dpz); if (S.sits) sitT = 1; }
        c.lookAt = [ctx.px, ctx.py + 1.5, ctx.pz]; break;
      }
      default: { // idle
        if (c.idleKind === 'graze') c.graze = 1; else if (c.idleKind === 'sit') sitT = 1; else c.alert = Math.sin(ctx.t * .9 + c.seed * 30) > .6 ? 1 : 0;
        if (dp < 14 && !c.graze) c.lookAt = [ctx.px, ctx.py + 1.5, ctx.pz];
        if (dp < 10 && c.graze && Math.sin(ctx.t * .5 + c.seed * 11) > .5) { c.graze = 0; c.lookAt = [ctx.px, ctx.py + 1.5, ctx.pz]; }
        if (ctx.food && dp < 12 && calmPlayer && (S.temper === 'curious' || c.fed)) { setState(c, 'curious', 12); break; }
        if (c.timer < 0) {
          const lead = c.grp && c.grp.lead && c.grp.lead !== c && BYID.has(c.grp.lead.id) ? c.grp.lead : null;
          if (lead && lead.state !== 'walk' && Math.random() < .6) { setState(c, 'idle', 1 + Math.random() * 3); break; }
          if (pickWander(c)) { c.speedT = Math.random() < .18 ? S.walk * 2.6 : S.walk * (.85 + Math.random() * .3); setState(c, 'walk', 30); }
          else setState(c, 'idle', 3);
        }
      }
    }
    c.wantV = want; c.wantH = head; c.sitT = sitT;
  }

  // ------------------------------------------------------------------ physics & animation
  const _fx = [0, 0];
  function move(c, dt) {
    const S = c.S; let want = c.wantV || 0; const da = wrapA((c.wantH != null ? c.wantH : c.ry) - c.ry);
    if (want > 0) {
      const big = S.R > .45; if (Math.abs(da) > (big ? .9 : 1.4)) want *= big ? .25 : .5; // slow down to turn
      const maxT = S.turn * dt * (c.v > S.run * .6 ? .65 : 1); const tr = clamp(da, -maxT, maxT); c.ry = wrapA(c.ry + tr); c.turnRate = lerp(c.turnRate, tr / dt, Math.min(1, dt * 6));
    } else c.turnRate = lerp(c.turnRate, 0, Math.min(1, dt * 4));
    const acc = want > c.v ? (c.state === 'flee' ? 9 : 2.6) * (S.R > .6 ? .7 : 1) : 4.5; c.v += clamp(want - c.v, -acc * dt, acc * dt); if (c.v < .01) c.v = 0;
    if (c.v > 0) {
      const fx = Math.sin(c.ry), fz = Math.cos(c.ry); const nx = c.x + fx * c.v * dt, nz = c.z + fz * c.v * dt; const h1 = L.ground(nx, nz);
      const wet = S.beach ? h1 < -.6 : h1 < .15; const steep = !S.climber && !c.pet && L.slope(nx, nz) > .85;
      if ((wet && !c.pet) || steep || (c.pet && h1 < -1.2)) { c.v *= .4; c.wantH = c.ry + 1.6; if (c.state === 'walk') { setState(c, 'idle', 1); } }
      else { c.x = nx; c.z = nz; }
      if (c.near) { _v.set(c.x, c.y, c.z); _v.y = c.y; if (L.collideXZ(_v, S.R * c.scale / S.s, 1.5, .5)) { c.x = _v.x; c.z = _v.z; } }
    }
    // ground follow with body pitch from the terrain under the front and back legs
    const gy = L.ground(c.x, c.z); c.y = lerp(c.y, gy, Math.min(1, dt * 12)); if (Math.abs(c.y - gy) > 2) c.y = gy;
    const len = c.hipH() * 1.4; const fx = Math.sin(c.ry), fz = Math.cos(c.ry);
    const hF = L.ground(c.x + fx * len, c.z + fz * len), hB = L.ground(c.x - fx * len, c.z - fz * len); c.pitch = lerp(c.pitch || 0, clamp(Math.atan2(hB - hF, len * 2), -.5, .5), Math.min(1, dt * 6));
  }
  // flying: wild flyers circle their home, mounts are steered by the rider
  function flyMove(c, dt, t) {
    const S = c.S, F = S.flyer; c.fly = 1; const gy = L.ground(c.x, c.z);
    if (!c.ftx || Math.hypot(c.ftx - c.x, c.ftz - c.z) < 12 || c.timer < 0 && !c.landing) {
      const a = Math.random() * TAU, r = 50 + Math.random() * 70; c.ftx = c.home[0] + Math.cos(a) * r; c.ftz = c.home[1] + Math.sin(a) * r; c.fty = Math.max(L.ground(c.ftx, c.ftz), 0) + F.alt[0] + Math.random() * (F.alt[1] - F.alt[0]);
      if (c.flyT < 0) { c.landing = true; c.ftx = c.perch ? c.perch.x : c.home[0]; c.ftz = c.perch ? c.perch.z : c.home[1]; c.fty = c.perch ? c.perch.y : L.ground(c.ftx, c.ftz); }
      c.timer = 20;
    }
    c.flyT -= dt;
    const dx = c.ftx - c.x, dz = c.ftz - c.z, dh = Math.hypot(dx, dz); const head = Math.atan2(dx, dz); const da = wrapA(head - c.ry); const tr = clamp(da, -S.turn * .6 * dt, S.turn * .6 * dt); c.ry = wrapA(c.ry + tr); c.turnRate = lerp(c.turnRate, tr / dt, Math.min(1, dt * 3));
    const sp = c.landing ? clamp(dh * .5, 3, F.speed) : F.speed; c.v = lerp(c.v, sp, Math.min(1, dt * 1.5));
    c.x += Math.sin(c.ry) * c.v * dt; c.z += Math.cos(c.ry) * c.v * dt;
    const ty = c.landing && dh > 25 ? Math.max(c.fty + 18, gy + 12) : c.fty; c.vy = lerp(c.vy, clamp((ty - c.y) * .6, -7, 6), Math.min(1, dt * 2)); c.y += c.vy * dt; c.y = Math.max(c.y, gy + 1.5 * (c.landing ? 0 : 1));
    c.pitch = lerp(c.pitch || 0, clamp(-c.vy * .05, -.4, .4), Math.min(1, dt * 3));
    c.flap = clamp(.35 + c.vy * .25 + (c.landing ? .5 : 0), 0, 1);
    if (c.landing && dh < 2.5 && Math.abs(c.y - c.fty) < 1.5) { c.landing = false; c.fly = 0; c.v = 0; c.vy = 0; c.y = c.fty; c.state = 'idle'; c.timer = 25 + Math.random() * 40; c.ftx = null; }
  }
  // rider input: { mx, mz (desired direction, world, length 0..1), run, up, down, jump }
  L.crRide = function (c, inp, dt, t) {
    const S = c.S, M = S.mount; const gy = L.ground(c.x, c.z);
    if (M.fly && inp.up && !c.fly) { c.fly = 1; c.vy = 6; c.y += .3; }
    if (c.fly) {
      const ml = Math.hypot(inp.mx, inp.mz); const sp = M.fly * ml; if (ml > .05) { const head = Math.atan2(inp.mx, inp.mz); const da = wrapA(head - c.ry); const tr = clamp(da, -1.8 * dt, 1.8 * dt); c.ry = wrapA(c.ry + tr); c.turnRate = lerp(c.turnRate, tr / dt, Math.min(1, dt * 4)); } else c.turnRate = lerp(c.turnRate, 0, dt * 3);
      c.v = lerp(c.v, sp, Math.min(1, dt * 1.2)); const vyT = inp.up ? 9 : inp.down ? -10 : 0; c.vy = lerp(c.vy, vyT, Math.min(1, dt * 2.5));
      c.x += Math.sin(c.ry) * c.v * dt; c.z += Math.cos(c.ry) * c.v * dt; c.y += c.vy * dt; const floor = Math.max(gy, 0) + .2;
      if (c.y > 900) c.y = 900; c.x = clamp(c.x, -L.WS * 1.3, L.WS * 1.3); c.z = clamp(c.z, -L.WS * 1.3, L.WS * 1.3);
      if (c.y <= floor) { c.y = floor; if (inp.down || c.v < 1) { c.fly = 0; c.vy = 0; } }
      c.pitch = lerp(c.pitch || 0, clamp(-c.vy * .05, -.45, .45), Math.min(1, dt * 3)); c.flap = clamp(.3 + c.vy * .12 + (c.v < 4 ? .6 : 0), 0, 1);
      return;
    }
    const ml = Math.hypot(inp.mx, inp.mz); let want = 0, head = c.ry;
    if (ml > .05) { head = Math.atan2(inp.mx, inp.mz); want = (ml > .85 || inp.run ? M.speed : lerp(S.walk * 1.3, M.speed * .55, clamp((ml - .1) / .75, 0, 1))) * (ml > .1 ? 1 : 0); }
    c.wantV = want; c.wantH = head; c.state = 'ride';
    // ridden ground mounts may cross shallow water and climb a bit more
    const da = wrapA(head - c.ry); const maxT = S.turn * 1.2 * dt; const tr = want > 0 ? clamp(da, -maxT, maxT) : 0; c.ry = wrapA(c.ry + tr); c.turnRate = lerp(c.turnRate, tr / dt, Math.min(1, dt * 6));
    const acc = want > c.v ? 6 : 9; c.v += clamp(want * (Math.abs(da) > 1.4 ? .35 : 1) - c.v, -acc * dt, acc * dt); if (c.v < .02) c.v = 0;
    if (c.v > 0) { const nx = c.x + Math.sin(c.ry) * c.v * dt, nz = c.z + Math.cos(c.ry) * c.v * dt; const h1 = L.ground(nx, nz); if (h1 > -1.3 && L.slope(nx, nz) < 1.6) { _v.set(nx, c.y, nz); L.collideXZ(_v, S.R * c.scale / S.s, 1.8, .6); c.x = _v.x; c.z = _v.z; } else c.v *= .3; }
    if (inp.jump && c.onGround !== false && M.jump) { c.vy = 4 + M.jump * 2.5; c.onGround = false; }
    c.vy -= 22 * dt; c.y += c.vy * dt; const g2 = L.groundAt(c.x, c.z, c.y, .7).y; if (c.y <= g2) { c.y = g2; c.vy = 0; c.onGround = true; }
    const len = c.hipH() * 1.4, fx = Math.sin(c.ry), fz = Math.cos(c.ry); const hF = L.ground(c.x + fx * len, c.z + fz * len), hB = L.ground(c.x - fx * len, c.z - fz * len); c.pitch = lerp(c.pitch || 0, clamp(Math.atan2(hB - hF, len * 2), -.5, .5), Math.min(1, dt * 6));
  };
  // world position of the saddle (rider's hips)
  const _sv = new THREE.Vector3();
  L.crSeat = function (c, out) {
    out = out || new THREE.Vector3(); if (!c.I) return out.set(c.x, c.y + 1, c.z); const M = c.S.mount; const b = c.I.rig.e(M.seat[0]);
    if (b) { b.o.getWorldPosition(out); _sv.set(0, M.seat[1] * c.scale, M.seat[2] * c.scale).applyQuaternion(c.I.root.quaternion); out.add(_sv); } else out.set(c.x, c.y + c.hipH() * 1.3, c.z);
    return out;
  };

  function animate(c, dt, t, ctx) {
    const I = c.I, S = c.S, st = c.st; st.t += dt; st.dt = dt; st.speed = c.v / c.scale * S.s; st.turn = c.turnRate; st.seed = c.seed * 10;
    st.graze = c.graze; st.sit = c.sitT || 0; st.alert = c.alert || 0; st.fly = c.fly; st.flap = c.flap != null ? c.flap : 1; st.wag = c.pet && c.lookAt ? 1 : 0; st.hop = S.anim === 'hop';
    if (c.lookAt) { const dx = c.lookAt[0] - c.x, dz = c.lookAt[2] - c.z, dy = c.lookAt[1] - (c.y + c.hipH() * 1.6); const yaw = wrapA(Math.atan2(dx, dz) - c.ry); st.look = [clamp(yaw, -1.1, 1.1), clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -.6, .6)]; if (Math.abs(yaw) > 1.6) st.look[0] = 0; }
    else st.look = [Math.sin(st.t * .37 + st.seed) * .35 * (c.v < .2 ? 1 : .2), 0];
    st.roar = c.roarT && t - c.roarT < 2.2 ? Math.sin((t - c.roarT) / 2.2 * Math.PI) : 0;
    if (S.anim === 'bird') { st.flapHz = 6; L.birdAnim(I.rig, st); }
    else if (S.anim === 'biped') { const h = c.hst || (c.hst = { t: 0, armDown: .3 }); h.speed = st.speed; h.t = st.t; h.dt = dt; L.humanAnim(I.rig, h); }
    else L.quadAnim(I.rig, st);
  }

  // ------------------------------------------------------------------ main update
  let spawnT = 0, frame = 0;
  // ctx: { px, py, pz, pv, night, foodOf(sp)->bool, sombra, owners, camera, shadowR }
  L.crUpdate = function (dt, t, ctx) {
    frame++; night = !!ctx.night;
    spawnT -= dt; if (spawnT < 0) { spawnT = .8; spawner(ctx.px, ctx.pz); }
    const cam = ctx.camera; PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); FR.setFromProjectionMatrix(PV); const cx = cam.position.x, cz = cam.position.z;
    let nAnim = 0;
    for (let i = CRS.length - 1; i >= 0; i--) {
      const c = CRS[i]; const S = c.S; const dP = Math.hypot(c.x - ctx.px, c.z - ctx.pz);
      // tamed creatures far from everybody stay as data only
      if (c.pet && !c.mounted && dP > DROP_R && !(c.pet.f && ctx.owners[c.owner] && Math.hypot(ctx.owners[c.owner].x - ctx.px, ctx.owners[c.owner].z - ctx.pz) < DROP_R)) { if (c.I) { L.scene.remove(c.I.root); c.I = null; } continue; }
      if (!c.ensureMesh()) continue;
      c.near = dP < 70;
      if (!c.mounted) {
        if (S.flyer && !c.pet && c.state !== 'flyhome') { // wild flyers alternate resting and circling
          if (c.fly || (c.state === 'idle' && c.timer < -0 && Math.random() < .004 && dP > 30)) { if (!c.fly) { c.flyT = 40 + Math.random() * 40; c.vy = 5; c.landing = false; c.ftx = null; c.timer = 0; } flyMove(c, dt, t); }
          else { think(c, ctx, dt); move(c, dt); if (c.perch) c.y = c.perch.y; }
          if (c.perch && !c.fly) { c.x = lerp(c.x, c.perch.x, Math.min(1, dt * 2)); c.z = lerp(c.z, c.perch.z, Math.min(1, dt * 2)); c.y = c.perch.y; }
        } else if (c.pet && S.flyer && c.fly && !c.mounted) { // a pet flyer catching up with its owner, landing near them
          const O = ctx.owners[c.owner]; if (O) { c.ftx = O.x - Math.sin(O.ry) * 6; c.ftz = O.z - Math.cos(O.ry) * 6; c.fty = L.ground(c.ftx, c.ftz); c.landing = Math.hypot(c.ftx - c.x, c.ftz - c.z) < 40; c.flyT = 1; c.timer = 1; flyMove(c, dt, t); } else c.fly = 0;
        } else { think(c, ctx, dt); move(c, dt); }
      }
      // visibility: frustum + distance fade
      const r = c.rad || 1; SPH.center.set(c.x, c.y + r * .4, c.z); SPH.radius = r; const dC = Math.hypot(c.x - cx, c.z - cz);
      c.visibleNow = dC < 240 && FR.intersectsSphere(SPH);
      c.fade = Math.min(1, c.fade + dt * 1.5); const sc = c.scale * (c.fade < 1 ? sstep(0, 1, c.fade) : 1);
      const R = c.I.root; R.visible = c.visibleNow; if (!R.visible && !c.mounted) continue;
      R.position.set(c.x, c.y, c.z); R.rotation.set(c.pitch || 0, c.ry, 0, 'YXZ'); R.scale.setScalar(Math.max(.001, sc));
      // animation LOD
      const every = c.mounted || dC < 45 ? 1 : dC < 100 ? 2 : dC < 170 ? 4 : 8; c.anT += dt;
      if ((frame + (c.seed * 97 | 0)) % every === 0) { animate(c, c.anT, t, ctx); c.anT = 0; nAnim++; }
      const sh = dC < (ctx.shadowR || 40); if (c.shadow !== sh) { c.shadow = sh; for (const m of c.I.meshes) m.castShadow = sh; }
      if (c.glow) c.glow.material.opacity = (.35 + .25 * Math.sin(t * 2 + c.seed * 9)) * (.4 + (ctx.night ? .6 : 0));
      // occasional voices
      if (S.roar && dC < 160 && Math.random() < dt * .02) { c.roarT = t; L.crSound && L.crSound('roar', c); }
      if (S.howl && ctx.night && dC < 220 && Math.random() < dt * .008) L.crSound && L.crSound('howl', c);
      if (S.anim === 'bird' && ctx.night && dC < 60 && Math.random() < dt * .05) L.crSound && L.crSound('hoot', c);
      if (S.k === 'sapo' && dC < 40 && Math.random() < dt * .06) L.crSound && L.crSound('croak', c);
    }
    L.crStats = { n: CRS.length, anim: nAnim, cells: cells.size };
  };

  // nearest creature for interaction
  L.crNearest = function (x, z, r, filter) { let best = null, bd = r * r; for (const c of CRS) { if (!c.I || c.mounted) continue; if (filter && !filter(c)) continue; const d = d2(c.x, c.z, x, z) - (c.S.R * c.scale) * (c.S.R * c.scale); if (d < bd) { bd = d; best = c; } } return best; };
  // feeding: returns 'tamed' | 'fed' | 'fled'
  L.crFeed = function (c, t) { c.aff = (c.aff || 0) + 1; c.fed = t; c.state = 'idle'; c.timer = 3; c.idleKind = c.S.sits ? 'sit' : 'look'; return c.aff >= c.S.cost ? 'tamed' : 'fed'; };
  // tamed state from the shared store: { o, ty, nm, f, x, z }
  L.crSyncTames = function (tames, myPid) {
    for (const id in tames) {
      const T = tames[id]; if (!SP[T.ty]) continue; let c = BYID.get(id);
      if (!c) c = new Cr(T.ty, T.x != null ? T.x : 0, T.z != null ? T.z : 0, { id, pet: true });
      if (!c.pet) { c.wild = false; c.grp = null; c.state = 'idle'; c.timer = 1; if (c.saddle) c.saddle.visible = true; }
      c.pet = T; c.owner = T.o; c.name = T.nm; if (!T.f && T.x != null) c.home = [T.x, T.z];
    }
    for (const c of CRS.slice()) if (c.pet && !tames[c.id]) { if (c.mounted) continue; c.dispose(); }
    // slots for followers per owner
    const per = {}; for (const c of CRS) if (c.pet && c.pet.f) { per[c.owner] = per[c.owner] || 0; c.slot = per[c.owner]++; }
    const P = new Set(); for (const c of CRS) if (c.pet && c.owner === myPid) P.add(c.S.pow.id); L.POW = P; return P;
  };
  L.POW = new Set(); L.hasPow = id => L.POW.has(id);
  L.crTamedSet = null; L.crTamed = id => !!(L.crTamedSet && L.crTamedSet[id]);
  // rare creatures for the map (Uivo da Lua)
  L.crRare = () => CRS.filter(c => c.wild && c.I && (c.special != null || ['pantera', 'lumi', 'cervo_lunar', 'lobo_esp', 'dragao', 'grifo', 'golem'].includes(c.sp)));
})(window.L);
