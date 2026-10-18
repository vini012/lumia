/* Lumiar v5 cozy survival (L.surv): hunger (fome), energy (energia), mana, cold (frio) with shelter and fire warmth,
   food (L.FOOD) and cooking recipes (L.COOK), sleep in a bed (everyone online asleep -> the shared clock skips to
   dawn), soft respawn when falling into the cloud sea or leaving the world. No death, no damage: the worst that
   happens is walking a bit slower until you eat.
   State lives in L.save.player.st (persisted); without L.save it stays in memory. */
'use strict';
(function (L) {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const C = () => L.clock || { now: () => Date.now(), nightness: () => 0, hours: () => 12, isNight: () => false, skipToDawn: () => 0 };

  // ================================================================ tunables (GDD §6.1)
  const K = L.SURV = {
    fomeRate: 1 / 25,                 // hunger points per second at walking pace: 100 -> 0 in ~42 min of play
    act: { idle: .75, walk: 1, sprint: 1.6, swim: 1.35, sleep: .25 },
    hungry: 25,                       // below: no sprint, mana regen halved, soft hint
    enMax: 100, enRegen: 14, enDelay: .7, sprintCost: 9, glideCost: 2, swimCost: 2.5, enBack: 20,
    manaMax: 100, manaRegen: .4,      // 250 s from empty to full; faster near fire / home / when fed
    coldRise: 1 / 100, coldFall: 1 / 35, coldFallFire: 1 / 10, coldNight: .55, alt0: 500, alt1: 800, altCold: .8,
    wetDry: 1 / 90, shelterFactor: .35,
    fireR: 5, roofMax: 6, roofMin: 1.2, wallR: 6,   // walls are .3 m thick: probe every .25 m
    cloudMargin: 6, worldEdge: 7750,
    hintEvery: { fome: 240, fraco: 180, frio: 180, cansaco: 60, calor: 240 },
  };

  // ================================================================ food & cooking (data for game.js crafting)
  // fome: hunger restored; en/mana: instant; warm: seconds of warmth (removes cold); buff: [id, seconds]
  L.FOOD = {
    frutinhas: { n: 'Frutinhas', ic: '🫐', fome: 6, raw: 1 },
    maca: { n: 'Maçã', ic: '🍎', fome: 10, raw: 1 },
    cenoura: { n: 'Cenoura', ic: '🥕', fome: 8, raw: 1 },
    cogumelo: { n: 'Cogumelo', ic: '🍄', fome: 5, raw: 1 },
    mel: { n: 'Mel', ic: '🍯', fome: 12, en: 15, raw: 1 },
    morango: { n: 'Morango', ic: '🍓', fome: 7, raw: 1 },
    cogumelo_assado: { n: 'Cogumelo assado', ic: '🍢', fome: 14, warm: 30 },
    cenoura_assada: { n: 'Cenoura assada', ic: '🥕', fome: 18, warm: 30 },
    maca_assada: { n: 'Maçã assada', ic: '🍎', fome: 18, warm: 30 },
    pao: { n: 'Pão', ic: '🍞', fome: 30 },
    torta_frutas: { n: 'Torta de frutas', ic: '🥧', fome: 45, en: 30, buff: ['energia', 300] },
    sopa_abobora: { n: 'Sopa de abóbora', ic: '🍲', fome: 40, warm: 180 },
    ensopado: { n: 'Ensopado', ic: '🥘', fome: 55, warm: 240 },
    cha_ervas: { n: 'Chá de ervas', ic: '🍵', fome: 15, mana: 15, buff: ['resistente', 300] },
    sopa_quente: { n: 'Sopa Quente', ic: '🥣', fome: 50, warm: 360 },
  };
  L.BUFFS = {
    quente: { n: 'Calor', ic: '🔥', desc: 'sem frio' },
    resistente: { n: 'Proteção do frio', ic: '🧣', desc: 'o frio chega devagar' },
    energia: { n: 'Energia extra', ic: '⚡', desc: 'correr cansa menos' },
  };
  // same shape as game.js RECIPES: {id, w: station, n, ic, cost, give, lit, desc} (+ rq: a recipe item that must be
  // known first, e.g. from a note: the player has it in inv or flags)
  const R = (id, w, out, cost, rq) => { const F = L.FOOD[out]; const bits = ['+' + F.fome + ' fome']; if (F.warm) bits.push('aquece'); if (F.buff) bits.push(L.BUFFS[F.buff[0]].n.toLowerCase()); if (F.en) bits.push('+energia'); return Object.assign({ id, w, n: F.n, ic: F.ic, cost, give: { [out]: 1 }, lit: true, desc: bits.join(', ') }, rq ? { rq } : {}); };
  L.COOK = [
    R('c_cogumelo', 'fogueira', 'cogumelo_assado', { cogumelo: 2 }),
    R('c_cenoura', 'fogueira', 'cenoura_assada', { cenoura: 2 }),
    R('c_maca', 'fogueira', 'maca_assada', { maca: 2 }),
    R('c_cha', 'fogueira', 'cha_ervas', { ervas: 2 }),
    R('c_sopa_quente_f', 'fogueira', 'sopa_quente', { cenoura: 1, ervas: 2, cogumelo: 2 }, 'receita_sopa_quente'),
    R('c_pao', 'forno', 'pao', { trigo: 3 }),
    R('c_torta', 'forno', 'torta_frutas', { trigo: 2, frutinhas: 4 }),
    R('c_torta_m', 'forno', 'torta_frutas', { trigo: 2, morango: 3 }),
    R('c_sopa_abobora', 'caldeirao', 'sopa_abobora', { abobora: 1, ervas: 1 }),
    R('c_ensopado', 'caldeirao', 'ensopado', { cenoura: 2, cogumelo: 2, abobora: 1 }),
    R('c_cha_c', 'caldeirao', 'cha_ervas', { ervas: 2 }),
    R('c_sopa_quente', 'caldeirao', 'sopa_quente', { cenoura: 1, ervas: 2, cogumelo: 1 }, 'receita_sopa_quente'),
  ];
  // display names/icons of every item this module and farm.js introduce (game.js merges into its ITEM table)
  L.ITEMS5 = L.ITEMS5 || {};
  for (const k in L.FOOD) L.ITEMS5[k] = { n: L.FOOD[k].n, ic: L.FOOD[k].ic, food: 1 };
  const ING = { trigo: ['Trigo', '🌾'], abobora: ['Abóbora', '🎃'], ervas: ['Ervas', '🌿'], lotus: ['Lótus', '🪷'], flor_lua: ['Flor da lua', '🌙'] };
  for (const k in ING) if (!L.ITEMS5[k]) L.ITEMS5[k] = { n: ING[k][0], ic: ING[k][1] };
  Object.assign(L.ITEMS5, { receita_sopa_quente: { n: 'Receita de sopa quente', ic: '📜' }, receita_forno: { n: 'Receita do forno', ic: '📜' } });
  // a recipe is known when it is in the bag or in flags (flags[id] or flags.rec[id]: how story.js keeps recipes)
  L.knowsRecipe = function (id, inv, flags) {
    const p = L.save && L.save.player; inv = inv || (p && p.inv) || {}; flags = flags || (p && p.flags) || {};
    return (inv[id] || 0) > 0 || !!flags[id] || !!(flags.rec && flags.rec[id]);
  };
  // a recipe can be made now? (ingredients in inv, recipe known)
  L.cookCheck = function (r, inv, flags) {
    inv = inv || (L.save && L.save.player ? L.save.player.inv : {}) || {}; flags = flags || (L.save && L.save.player ? L.save.player.flags : {}) || {};
    if (r.rq && !L.knowsRecipe(r.rq, inv, flags)) return { ok: false, why: 'Receita desconhecida' };
    const miss = []; for (const k in r.cost) if ((inv[k] || 0) < r.cost[k]) miss.push((r.cost[k] - (inv[k] || 0)) + ' ' + ((L.ITEMS5[k] && L.ITEMS5[k].n) || k).toLowerCase());
    return miss.length ? { ok: false, why: 'Faltam ' + miss.join(', ') } : { ok: true };
  };

  // ================================================================ events
  const H = {};
  const on = (n, fn) => { (H[n] || (H[n] = [])).push(fn); return () => { const l = H[n], i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); }; };
  const emit = (n, a) => { const l = H[n]; if (l) for (const fn of l.slice()) { try { fn(a); } catch (e) { console.warn('[surv]', n, e); } } };
  const story = (n, d) => { try { if (L.story && L.story.event) L.story.event(n, d); } catch (e) { console.warn('[surv] story', e); } };

  // ================================================================ fires registry (L.fires)
  // Lit build stations (b5 records with lit:true and a type below) are registered automatically from L.save; the game
  // registers other fires (POI fireplaces, story fires) with add/remove.
  const FIRES = new Map(), FCELL = 32, FGRID = new Map();
  const fkey = (x, z) => Math.floor(x / FCELL) * 100003 + Math.floor(z / FCELL);
  const fires = {
    TYPES: { fogueira: { r: 5 }, lareira: { r: 6 }, forno: { r: 4 }, caldeirao: { r: 4 }, forja: { r: 5 }, tocha: { r: 2.5 }, campfire_ring: { r: 5 } },
    add(id, f) {
      fires.remove(id); const e = { id, x: +f.x || 0, y: f.y == null ? NaN : +f.y, z: +f.z || 0, r: f.r || (fires.TYPES[f.kind] && fires.TYPES[f.kind].r) || K.fireR, kind: f.kind || 'fogo', src: f.src || 'game' };
      e.k = fkey(e.x, e.z); FIRES.set(id, e); let l = FGRID.get(e.k); if (!l) FGRID.set(e.k, l = []); l.push(e); return e;
    },
    remove(id) { const e = FIRES.get(id); if (!e) return false; FIRES.delete(id); const l = FGRID.get(e.k); if (l) { const i = l.indexOf(e); if (i >= 0) l.splice(i, 1); if (!l.length) FGRID.delete(e.k); } return true; },
    clear(src) { for (const [id, e] of [...FIRES]) if (!src || e.src === src) fires.remove(id); },
    // nearest fire whose warmth reaches (x,y,z) (its own radius, or r if given), or null
    near(x, y, z, r) {
      let best = null, bd = Infinity; const cx = Math.floor(x / FCELL), cz = Math.floor(z / FCELL);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
        const l = FGRID.get(i * 100003 + j); if (!l) continue;
        for (const e of l) { const R2 = r || e.r, d = Math.hypot(e.x - x, e.z - z); if (d > R2 || d >= bd) continue; if (y != null && e.y === e.y && Math.abs(e.y - y) > 4) continue; best = e; bd = d; }
      }
      return best;
    },
    list() { return [...FIRES.values()]; },
    get size() { return FIRES.size; },
    // (re)build the build-station part of the registry from b5 records
    syncBuilds(recs) {
      recs = recs || (L.save && L.save.all ? L.save.all('b5') : null); fires.clear('b5'); if (!recs) return;
      const it = recs instanceof Map ? recs.entries() : Object.entries(recs);
      for (const [id, d] of it) fires.fromBuild(id, d);
    },
    fromBuild(id, d) {
      const fid = 'b:' + id; if (!d || !d.lit || !fires.TYPES[d.t]) { fires.remove(fid); return; }
      fires.add(fid, { x: d.x, y: d.y, z: d.z, kind: d.t, src: 'b5' });
    },
  };
  L.fires = fires;
  L.nearFire = (x, y, z, r) => !!fires.near(x, y, z, r);
  if (L.save && L.save.on) { L.save.on('b5', (id, d) => fires.fromBuild(id, d)); L.save.on('ready', () => fires.syncBuilds()); }

  // ================================================================ shelter (colliders above the head + walls around)
  const DIRS = [...Array(8)].map((_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
  function shelterInfo(x, y, z) {
    const out = { roof: false, roofH: 0, walls: 0, inside: false };
    if (L.queryCols && L.colTop) {
      let best = Infinity;
      L.queryCols(x, z, .35, c => {
        if (c.ghost) return; const top = L.colTop(c, x, z); if (top !== top) return;
        const bot = c.kind === 'hf' ? top - .3 : (c.y0 != null ? c.y0 : top - .3);
        const above = bot - y; // the underside of whatever is overhead (roof wedge bottom, floor slab, POI roof)
        if (above >= K.roofMin && above <= K.roofMax && above < best) best = above;
      });
      if (best < Infinity) { out.roof = true; out.roofH = best; }
    }
    if (!out.roof && typeof L.shelterExtra === 'function') { try { if (L.shelterExtra(x, y, z)) { out.roof = true; out.roofH = 3; } } catch (e) { } }
    if (out.roof && L.pointInSolid) {
      const hy = y + 1.3;
      for (const [dx, dz] of DIRS) { for (let s = .25; s <= K.wallR; s += .25) if (L.pointInSolid(x + dx * s, hy, z + dz * s)) { out.walls++; break; } }
      out.inside = out.walls >= 6;
    }
    return out;
  }
  L.shelterInfo = shelterInfo;
  L.isSheltered = (x, y, z) => shelterInfo(x, y, z).roof;

  // ================================================================ state
  const V = { fome: 80, en: 100, mana: 100, frio: 0, wet: 0, buffs: {} }; // live values (precise); p.st gets rounded copies
  let bound = null, saveT = 0, envT = 0, restT = 0, exhausted = false, lastSaved = '';
  const ENV = { roof: false, inside: false, walls: 0, fire: null, sx: NaN, sz: NaN };
  const SL = { on: false, t: 0, bed: null, skipped: false, wakeAt: 0, waiting: [], skipAsked: 0 };
  const RS = { on: false, t: 0, pos: null, why: '', moved: false };
  const FALL = { air: false, t0: 0, y0: 0 };
  const SAFE = []; let safeT = 0, posT = 0, RT = 0; // RT: seconds of play (monotonic, independent of clock skips)
  const HINT = {};
  function player() { return L.save && L.save.player ? L.save.player : null; }
  function bind() {
    const p = player(); bound = p;
    if (p) { if (!p.st || typeof p.st !== 'object') p.st = {}; const s = p.st; for (const k of ['fome', 'en', 'mana', 'frio', 'wet']) if (typeof s[k] === 'number') V[k] = s[k]; V.buffs = Object.assign({}, s.buffs || {}); writeSt(); }
  }
  function writeSt() {
    const p = player(); if (!p) return false; const r = v => Math.round(v * 100) / 100;
    const st = { fome: r(V.fome), en: r(V.en), mana: r(V.mana), frio: r(V.frio), wet: r(V.wet), buffs: Object.assign({}, V.buffs) };
    const j = JSON.stringify(st); if (j === lastSaved) return false; lastSaved = j; p.st = Object.assign(p.st || {}, st); return true;
  }
  function dirty() { if (writeSt() && L.save && L.save.dirty) L.save.dirty(); }
  if (L.save && L.save.on) { L.save.on('ready', bind); L.save.on('player', bind); }
  const now = () => C().now();
  const buffLeft = id => { const u = V.buffs[id]; return u ? Math.max(0, (u - now()) / 1000) : 0; };
  function addBuff(id, sec) { V.buffs[id] = Math.max(V.buffs[id] || 0, now()) + sec * 1000; emit('buff', { id, sec }); dirty(); }
  const enMax = () => V.fome >= 50 ? K.enMax : K.enMax * (.5 + V.fome / 100);
  const canSprint = () => V.fome >= K.hungry && !exhausted && V.en > 1;
  function hint(kind, text, force) {
    const t = now() / 1000, every = K.hintEvery[kind] || 120;
    if (!force && HINT[kind] && t - HINT[kind] < every) return false; HINT[kind] = t; emit('hint', { kind, text }); return true;
  }

  // ================================================================ environment sampling (2 Hz)
  function sampleEnv(x, y, z) {
    const sh = shelterInfo(x, y, z); ENV.roof = sh.roof; ENV.inside = sh.inside; ENV.walls = sh.walls;
    ENV.fire = fires.near(x, y, z); ENV.sx = x; ENV.sz = z;
  }

  // ================================================================ tick
  function tick(dt, ctx) {
    ctx = ctx || {}; dt = clamp(+dt || 0, 0, .5);
    if (player() !== bound) bind();
    const x = +ctx.x || 0, y = +ctx.y || 0, z = +ctx.z || 0, t = now(); RT += dt;
    envT -= dt; if (envT <= 0 || Math.abs(x - ENV.sx) + Math.abs(z - ENV.sz) > 3) { envT = .5; sampleEnv(x, y, z); }
    const sheltered = ctx.sheltered != null ? !!ctx.sheltered : ENV.roof;
    const fire = ctx.nearFire != null ? !!ctx.nearFire : !!ENV.fire;
    const night = ctx.night != null ? clamp(+ctx.night, 0, 1) : C().nightness();
    const alt = ctx.altitude != null ? +ctx.altitude : y;
    const rain = clamp(+ctx.raining || 0, 0, 1);
    const swimming = !!ctx.swimming, moving = !!ctx.moving, gliding = !!ctx.gliding;
    const sprinting = !!ctx.sprinting && moving && canSprint();
    for (const id in V.buffs) if (V.buffs[id] <= t) { delete V.buffs[id]; emit('buff', { id, sec: 0 }); }
    const warmBuff = buffLeft('quente') > 0, resist = buffLeft('resistente') > 0;

    // hunger
    const act = SL.on ? K.act.sleep : swimming && moving ? K.act.swim : sprinting ? K.act.sprint : moving ? K.act.walk : K.act.idle;
    const fome0 = V.fome; V.fome = Math.max(0, V.fome - dt * K.fomeRate * act * (1 + .4 * V.frio));
    if (fome0 >= K.hungry && V.fome < K.hungry) hint('fome', 'Você está com fome.', true);
    else if (V.fome < K.hungry && V.fome > 0) hint('fome', 'Você está com fome.');
    if (fome0 > 0 && V.fome <= 0) hint('fraco', 'Sem forças… coma alguma coisa.', true); else if (V.fome <= 0) hint('fraco', 'Sem forças… coma alguma coisa.');

    // energy
    const eMax = enMax(); let drain = 0;
    if (sprinting) drain += K.sprintCost * (buffLeft('energia') > 0 ? .6 : 1);
    if (gliding) drain += K.glideCost;
    if (swimming && moving) drain += K.swimCost;
    if (drain > 0) { V.en -= drain * dt; restT = 0; } else restT += dt;
    const cap = SL.on ? eMax : eMax * (1 - .5 * clamp((V.frio - .25) / .75, 0, 1)); // the cold slowly saps energy (to 50%)
    if (SL.on) V.en = eMax;
    else if (V.en > cap) V.en = Math.max(cap, V.en - 2 * dt);
    else if (restT > K.enDelay) {
      let rm = 1; if (fire || ENV.inside) rm *= 1.3; if (V.fome < K.hungry) rm *= .6; rm *= 1 - .6 * V.frio; if (buffLeft('energia') > 0) rm *= 1.4;
      V.en = Math.min(cap, V.en + K.enRegen * rm * dt);
    }
    V.en = clamp(V.en, 0, eMax);
    if (!exhausted && (V.en <= .5 || (ctx.sprinting && moving && V.en <= 1.5 && V.fome >= K.hungry))) { exhausted = true; if (ctx.sprinting) hint('cansaco', 'Sem fôlego… descanse um pouquinho.'); }
    if (exhausted && V.en >= K.enBack) exhausted = false;

    // mana
    let mm = 1; if (fire) mm *= 2; else if (ENV.inside || sheltered) mm *= 1.5; if (V.fome >= 60) mm *= 1.25; if (V.fome < K.hungry) mm *= .5; if (SL.on) mm *= 2;
    if (night > .5 && L.clock && L.clock.moonPhase && Math.abs(L.clock.moonPhase() - .5) < .07) mm *= 1.25; // full moon
    V.mana = Math.min(K.manaMax, V.mana + K.manaRegen * mm * dt);

    // wet
    if (swimming) V.wet = 1;
    else { let dry = K.wetDry; if (fire) dry *= 5; else if (sheltered) dry *= 1.5; V.wet = Math.max(0, V.wet - dry * dt); if (rain > 0 && !sheltered) V.wet = Math.min(.7, V.wet + rain * dt / 120); }

    // cold
    const nightK = K.coldNight * night, altK = clamp((alt - K.alt0) / (K.alt1 - K.alt0), 0, 1) * K.altCold;
    let e = 1 - (1 - nightK) * (1 - altK);
    e += V.wet * .4 * (.6 + .4 * night) + (rain > 0 && !sheltered ? .15 * rain : 0);
    e = clamp(e, 0, 1);
    if (sheltered) e *= K.shelterFactor;
    if (ctx.coldImmune) e *= .3;
    if (resist) e *= .5;
    if (SL.on && sheltered) e *= .3;
    if (fire || warmBuff) e = 0;
    const frio0 = V.frio;
    if (V.frio < e) V.frio = Math.min(e, V.frio + K.coldRise * dt * (resist ? .5 : 1));
    else V.frio = Math.max(e, V.frio - (fire ? K.coldFallFire : K.coldFall) * dt);
    if (frio0 < .45 && V.frio >= .45) hint('frio', sheltered ? 'Está frio… uma fogueira ajudaria.' : 'Está esfriando… procure abrigo ou uma fogueira.');
    if (fire && frio0 > .3 && !SL.on) hint('calor', 'Que calorzinho bom.');

    // falling into the cloud sea / leaving the world -> soft respawn
    if (!RS.on && !SL.on) {
      const gy = L.ground ? L.ground(x, z) : -Infinity;
      const grounded = ctx.grounded != null ? !!ctx.grounded : (y - gy < .35);
      const CY = L.CLOUD_Y != null ? L.CLOUD_Y : 90;
      if (!grounded && !swimming && !ctx.mounted) { if (!FALL.air) { FALL.air = true; FALL.t0 = RT; FALL.y0 = y; } FALL.y0 = Math.max(FALL.y0, y); } else FALL.air = false;
      if (FALL.air && FALL.y0 > CY - 2 && y < CY - K.cloudMargin && gy < y - 12) respawn('nuvens');
      else if (y < -40) respawn('nuvens');
      else if (Math.abs(x) > K.worldEdge || Math.abs(z) > K.worldEdge) respawn('limite');
      // remember safe ground (for respawn) and keep the saved position on solid ground
      safeT -= dt; posT -= dt;
      if (grounded && !swimming && y > CY + 3) {
        if (safeT <= 0) { safeT = 1; SAFE.push({ x, y, z, t: RT }); if (SAFE.length > 16) SAFE.shift(); }
        if (posT <= 0 && L.save && L.save.setPos) { posT = 3; L.save.setPos(x, y, z, ctx.ry || 0); }
      }
    }
    if (RS.on) tickRespawn(dt);
    if (SL.on) tickSleep(dt);

    // persist (rounded) every 2 s
    saveT -= dt; if (saveT <= 0) { saveT = 2; dirty(); }
  }

  // ================================================================ respawn
  function respawnPoint(before) { // last safe spot recorded before `before` (RT seconds)
    const lim = before == null ? Infinity : before;
    for (let i = SAFE.length - 1; i >= 0; i--) if (SAFE[i].t <= lim) return [SAFE[i].x, SAFE[i].y + .3, SAFE[i].z];
    const p = player(); if (p && p.home) return [p.home[0], p.home[1] + .3, p.home[2]];
    const sp = L.poi && L.poi('spawn'); if (sp) return [sp.x, (sp.y != null ? sp.y : (L.ground ? L.ground(sp.x, sp.z) : 0)) + .3, sp.z];
    if (L.SPAWN) { const g = L.ground ? L.ground(L.SPAWN[0], L.SPAWN[1]) : 0; return [L.SPAWN[0], g + .3, L.SPAWN[1]]; }
    return [0, 200, 0];
  }
  function respawn(why) {
    if (RS.on) return false; RS.on = true; RS.t = 0; RS.moved = false; RS.why = why || 'nuvens';
    RS.pos = respawnPoint(FALL.air ? FALL.t0 - 1.5 : null); FALL.air = false;
    emit('respawn', { phase: 'start', why: RS.why, text: RS.why === 'limite' ? 'O vento te trouxe de volta…' : 'As nuvens te trouxeram de volta…', pos: RS.pos });
    return true;
  }
  function tickRespawn(dt) {
    RS.t += dt;
    if (!RS.moved && RS.t >= .8) {
      RS.moved = true; const [x, y, z] = RS.pos; surv.teleport(x, y, z);
      V.wet = 0; SAFE.length = 0; FALL.air = false; if (L.save && L.save.setPos) L.save.setPos(x, y - .3, z, 0);
      emit('respawn', { phase: 'moved', pos: RS.pos });
    }
    if (RS.t >= 2.6) { RS.on = false; emit('respawn', { phase: 'end' }); }
  }

  // ================================================================ sleep
  function canSleepNow() { const h = C().hours(); return h >= 17.5 || h < 5.75; }
  function sleep(bed) {
    bed = bed || {}; const p = player();
    if (bed.x != null) { const h = [+(+bed.x).toFixed(2), +(+bed.y || 0).toFixed(2), +(+bed.z).toFixed(2)]; if (p) p.home = h; homeLocal = h; dirty(); if (L.save && L.save.dirty) L.save.dirty(); }
    if (!canSleepNow()) { V.en = enMax(); dirty(); emit('nap', {}); hint('soneca', 'Você descansou um pouco. Só dá para dormir de noite.', true); return { ok: true, nap: true }; }
    SL.on = true; SL.t = 0; SL.skipped = false; SL.wakeAt = 0; SL.bed = bed; SL.waiting = []; SL.skipAsked = 0;
    presence({ sl: 1 });
    emit('sleep', { phase: 'start', bed });
    return { ok: true };
  }
  function wake(why) {
    if (!SL.on) return false; const skipped = SL.skipped; SL.on = false; presence({ sl: 0 });
    if (skipped) { V.fome = Math.max(0, V.fome - 8); V.en = enMax(); V.mana = Math.min(K.manaMax, V.mana + 40); V.frio = 0; V.wet = 0; dirty(); }
    const bed = SL.bed || {}; emit('woke', { skipped, why: why || '' }); emit('sleep', { phase: 'end', skipped });
    if (skipped) story('woke', { x: bed.x, z: bed.z });
    return true;
  }
  function presence(p) { try { if (L.save && L.save.room) L.save.room.presence(p); } catch (e) { } }
  function tickSleep(dt) {
    SL.t += dt; const h = C().hours();
    if (!SL.skipped) {
      if (h >= 6 && h < 12 && SL.t > .5) { // dawn arrived (someone skipped, or the night really ended)
        SL.skipped = true; SL.wakeAt = SL.t + 2.8; const bed = SL.bed || {};
        emit('slept', { x: bed.x, z: bed.z }); story('slept', { x: bed.x, z: bed.z }); emit('sleep', { phase: 'dawn' });
        return;
      }
      if (SL.t > 2.5) {
        const peers = L.save && L.save.room ? L.save.room.peers() : [];
        const awake = peers.filter(p => !(p.presence && p.presence.sl));
        const names = awake.map(p => String((p.presence && p.presence.n) || 'alguém'));
        if (names.join('|') !== SL.waiting.join('|')) { SL.waiting = names; emit('sleep', { phase: 'wait', waiting: names }); }
        if (!awake.length && SL.t - SL.skipAsked > 4) {
          // everyone asleep: the one with the smallest name skips first; the others follow if nothing happened
          const me = (L.save && L.save.key) || '', keys = peers.map(p => String((p.presence && p.presence.k) || '')).concat(me).sort();
          if (keys[0] === me || SL.t > 7) { SL.skipAsked = SL.t; C().skipToDawn(); }
        }
      }
    } else if (SL.t >= SL.wakeAt) wake('dawn');
  }

  // ================================================================ eat & spells support
  function eat(item, opt) {
    opt = opt || {}; const F = L.FOOD[item]; if (!F) return { ok: false, why: 'Isso não dá para comer.' };
    const p = player(), inv = p && p.inv; const pay = opt.pay !== false && !!inv;
    if (pay && !(inv[item] > 0)) return { ok: false, why: 'Você não tem isso.' };
    if (V.fome >= 99.5 && !F.warm && !F.buff && !F.en && !F.mana) return { ok: false, why: 'Barriga cheia!' };
    if (pay) { inv[item]--; if (inv[item] <= 0) delete inv[item]; }
    const f0 = V.fome; V.fome = Math.min(100, V.fome + F.fome);
    if (F.en) V.en = Math.min(enMax(), V.en + F.en);
    if (F.mana) V.mana = Math.min(K.manaMax, V.mana + F.mana);
    if (F.warm) { V.buffs.quente = Math.max(V.buffs.quente || 0, now()) + F.warm * 1000; V.frio = 0; }
    if (F.buff) V.buffs[F.buff[0]] = Math.max(V.buffs[F.buff[0]] || 0, now()) + F.buff[1] * 1000;
    dirty(); if (L.save && L.save.dirty) L.save.dirty();
    const res = { ok: true, item, gained: Math.round((V.fome - f0) * 10) / 10, warm: F.warm || 0, buff: F.buff ? F.buff[0] : null };
    emit('ate', res); story('ate', { item });
    return res;
  }
  // cook one recipe of L.COOK (object or id) from the player's inventory; the game checks the station is lit and near
  function cook(r, opt) {
    opt = opt || {}; if (typeof r === 'string') r = L.COOK.find(c => c.id === r); if (!r) return { ok: false, why: 'Receita desconhecida' };
    const p = player(), inv = opt.inv || (p && p.inv); if (!inv) return { ok: false, why: 'Sem bolsa' };
    const chk = L.cookCheck(r, inv, opt.flags); if (!chk.ok) return chk;
    for (const k in r.cost) { inv[k] -= r.cost[k]; if (inv[k] <= 0) delete inv[k]; }
    for (const k in r.give) inv[k] = (inv[k] || 0) + r.give[k];
    if (L.save && L.save.dirty) L.save.dirty();
    const item = Object.keys(r.give)[0]; emit('cooked', { item, recipe: r.id }); story('cooked', { item });
    return { ok: true, item };
  }
  let homeLocal = null;
  const surv = {
    tick, eat, cook, sleep, wake, respawn, on, hint,
    get fome() { return V.fome; }, get en() { return V.en; }, get mana() { return V.mana; }, get cold() { return V.frio; }, get wet() { return V.wet; },
    get enMax() { return enMax(); }, get sleeping() { return SL.on; }, get respawning() { return RS.on; },
    get sheltered() { return ENV.roof; }, get inside() { return ENV.inside; }, get nearFire() { return !!ENV.fire; },
    busy: () => SL.on || RS.on,
    canSprint,
    canGlide: () => V.en > 0,
    exhausted: () => exhausted,
    speedMul: () => (V.fome <= 0 ? .75 : 1) * (V.frio > .6 ? .92 : 1),
    jumpMul: () => V.fome <= 0 ? .85 : 1,
    swimMul: () => exhausted ? .75 : 1,
    hasMana: n => V.mana >= n,
    useMana(n) { n = +n || 0; if (V.mana < n) return false; V.mana -= n; dirty(); return true; },
    addMana(n) { V.mana = clamp(V.mana + n, 0, K.manaMax); dirty(); },
    warm(sec) { V.buffs.quente = Math.max(V.buffs.quente || 0, now()) + (sec || 60) * 1000; V.frio = 0; emit('buff', { id: 'quente', sec }); dirty(); },
    buff: buffLeft, addBuff,
    buffs() { const out = []; for (const id in V.buffs) { const s = buffLeft(id); if (s > 0) out.push(Object.assign({ id, left: s }, L.BUFFS[id] || { n: id, ic: '✨' })); } return out; },
    canSleep: canSleepNow,
    setHome(x, y, z) { const p = player(), h = [x, y, z]; homeLocal = h; if (p) { p.home = h; if (L.save && L.save.dirty) L.save.dirty(); } },
    get home() { const p = player(); return (p && p.home) || homeLocal; },
    respawnPoint: () => respawnPoint(null),
    // game may replace: move the player (default: L.P from player.js)
    teleport(x, y, z) { const P = L.P; if (!P) return; P.x = x; P.y = y; P.z = z; if ('vx' in P) { P.vx = 0; P.vy = 0; P.vz = 0; } if ('fallY' in P) P.fallY = y; },
    sleepInfo: () => ({ on: SL.on, t: SL.t, skipped: SL.skipped, waiting: SL.waiting.slice() }),
    status() {
      return { fome: V.fome, en: V.en, enMax: enMax(), mana: V.mana, manaMax: K.manaMax, frio: V.frio, wet: V.wet, hungry: V.fome < K.hungry, starving: V.fome <= 0,
        exhausted, sheltered: ENV.roof, inside: ENV.inside, nearFire: !!ENV.fire, warm: buffLeft('quente') > 0, sleeping: SL.on, respawning: RS.on, buffs: surv.buffs() };
    },
    // tests / dev
    _V: V, _SL: SL, _RS: RS, _SAFE: SAFE, _ENV: ENV, set(v) { Object.assign(V, v); dirty(); }, reset() { Object.assign(V, { fome: 80, en: 100, mana: 100, frio: 0, wet: 0, buffs: {} }); SL.on = false; RS.on = false; SAFE.length = 0; FALL.air = false; exhausted = false; for (const k in HINT) delete HINT[k]; },
  };
  L.surv = surv;
})(typeof window !== 'undefined' ? (window.L = window.L || {}) : (globalThis.L = globalThis.L || {}));
