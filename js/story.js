/* Lumiar: data-driven progression. Notes and letters, dreams, thoughts, tasks, guardians, spells, trials, the
   white cloud region, the old gate and the long morning. All text comes from the encoded data (L.T / L.TL); this
   file holds only logic, placement and procedural fallback visuals. Contract: TECH §6 (dev/story_test.js runs it). */
'use strict';
window.L = window.L || {};
(function (L) {
  const S = L.story = L.story || {};
  const T = (p, f) => (L.T ? L.T(p, f) : (f || ''));
  const TL = p => (L.TL ? L.TL(p) : undefined);
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const wall = () => Date.now();
  const has3D = () => typeof THREE !== 'undefined' && !!L.scene;

  // ------------------------------------------------------------------ ids and tuning
  const TX = (b, f) => (L.TX && L.TX(b)) || f;
  const FORGE_TASK = TX('vSewND2aHA==', 'k_forge');
  // a few lore path segments and authored-model names are kept masked in the sources (see tools/lore/encode.py --word)
  const LP = { end: TX('sxa3NTKL', 'e'), starName: 'ui.' + TX('vR2qAzKNFG8=', 'x') };
  const MODEL = { figure: TX('sBG0KS6JTA==', ''), bow: TX('pQyyLgOOFn0=', ''), vines: TX('oBG9OS+zDWJnhAJy', '') };
  const IT = { star: 'estrela', frag: 'fragmento', feather: 'pena_dourada', moonSeed: 'sem_lua', moonFlower: 'flor_lua', soup: 'sopa_quente', lotusSeed: 'sem_lotus', lotus: 'lotus', gold: 'ouro', crystal: 'cristal', wood: 'madeira', rope: 'corda' };
  S.IT = IT;
  // display data for story items (names live in the encoded data)
  const ITEM_INFO = { fragmento: ['ui.frag_name', '✦'], estrela: [LP.starName, '✧'], pena_dourada: ['ui.feather_name', '🪶'], sem_lua: ['ui.moonseed_name', '🌱'], flor_lua: ['ui.moonflower_name', '🌸'] };
  S.itemInfo = id => { const i = ITEM_INFO[id]; return i ? { n: T(i[0], id), ic: i[1] } : null; };
  const CFG = S.CFG = {
    stuckAfter: 7200,          // s of play without main progress before a paper bird guides
    stuckAgain: 3600,          // s before another guide after a guided trip
    birdEvery: 75,             // min s between two delivered letters
    mistRamp: 45,              // m walked into the white before being returned
    clearR: 300,               // m around the hidden place where the white never blocks
    forge: { fragmento: 5, ouro: 3, cristal: 2 },
    millCost: [[3, 1], [3, 1], [2, 1], [2, 1]], // [madeira, corda] per repair spot
    reeds: 6, lotus: 3, feathers: 3, deerNights: 3, harvestOwn: 3,
    towerH: 12,                // m above the ground at the 'lighthouse' POI
    lampTypes: ['lighthouse_lamp', 'lanterna_farol', 'farol_lanterna'],
    summitR: 32, vigilGrace: 45,
    bridgePitch0: .3,          // camera pitch (v4 convention, + = looking down) that casts a level cloud bridge
    dawn: [6, 7.5], sunrise: [5, 9], night: [18, 6], dusk: [17, 20.5],
    interactR: 2.4,
    reach: 1.5,                // m of slack on top of an object's radius before S.interact refuses it
    guideLeave: 120,           // m: a guiding bird gives up when she is farther than this
    guideStall: 240,           // s without getting closer to the clue before the guide gives up
    yNear: 80,                 // m: placed objects re-read the ground/colliders height once she is this close
    visBudget: 3,              // ms per frame for building new placed-object visuals
  };

  // ------------------------------------------------------------------ lore indexes
  let NOTES = [], NOTE = {}, DREAMS = [], DREAM = {}, THOUGHTS = [], TASKS = [], TASK = {}, SPELLS = [], SPELL = {};
  function loadLore() {
    NOTES = TL('notes') || []; NOTE = {}; NOTES.forEach(n => NOTE[n.id] = n);
    DREAMS = TL('dreams') || []; DREAM = {}; DREAMS.forEach(d => DREAM[d.id] = d);
    THOUGHTS = TL('thoughts') || [];
    TASKS = TL('tasks') || []; TASK = {}; TASKS.forEach(k => TASK[k.id] = k);
    SPELLS = TL('spells') || []; SPELL = {}; SPELLS.forEach(s => SPELL[s.id] = s);
  }

  // ------------------------------------------------------------------ event bus (storyui listens)
  const BUS = {};
  S.on = (ev, fn) => { (BUS[ev] = BUS[ev] || []).push(fn); };
  function emit(ev, d) { for (const fn of BUS[ev] || []) { try { fn(d); } catch (e) { console.warn('story ui', ev, e); } } }
  S.emit = emit;
  const say = (text, ic) => { if (text) emit('toast', { text, ic }); };

  // ------------------------------------------------------------------ persistence
  const MEM = { player: { inv: {} }, world: new Map(), mana: 100 };
  let P = null, F = null;
  function bindPlayer() {
    const src = (L.save && L.save.player) || MEM.player;
    if (src === P) return;
    P = src; for (const k of ['notes', 'dreams', 'th', 'tasks', 'sp', 'flags']) if (!P[k] || typeof P[k] !== 'object') P[k] = {};
    F = P.flags; restoreTimers(); changed();
  }
  function dirty() { if (L.save && L.save.dirty) L.save.dirty(); }
  function worldMap() { if (L.save && L.save.all) { try { return L.save.all('w5'); } catch (e) { } } return MEM.world; }
  function W(id) { const m = worldMap(); if (!m) return null; const v = m.get ? m.get(id) : m[id]; return v == null ? null : v; }
  function setW(id, d) { if (L.save && L.save.set) L.save.set('w5', id, d); else MEM.world.set(id, d); onWorld(id, d, true); }
  const me = () => (P && P.name) || (L.save && L.save.player && L.save.player.name) || 'eu';
  const stamp = extra => Object.assign({ by: me(), t: wall() }, extra || {});
  let needEval = true;
  function changed() { needEval = true; dirty(); }
  function setF(k, v) { if (v === undefined) v = 1; if (F[k] === v) return; F[k] = v; changed(); }
  function inc(k, n) { F[k] = (F[k] || 0) + (n || 1); changed(); }

  // ------------------------------------------------------------------ inventory (game: L.inv = {count, give, take})
  const inv = {
    obj() { return (L.save && L.save.player) ? (L.save.player.inv = L.save.player.inv || {}) : MEM.player.inv; },
    count(id) { if (L.inv && L.inv.count) return L.inv.count(id) || 0; return this.obj()[id] || 0; },
    give(id, n) {
      n = n || 1; if (/^receita_/.test(id)) { F.rec = F.rec || {}; F.rec[id] = 1; if (L.inv && L.inv.recipe) L.inv.recipe(id); changed(); return; }
      if (L.inv && L.inv.give) L.inv.give(id, n); else { const o = this.obj(); o[id] = (o[id] || 0) + n; }
      changed(); emit('item', { id, n });
    },
    take(id, n) { n = n || 1; if (this.count(id) < n) return false; if (L.inv && L.inv.take) L.inv.take(id, n); else { const o = this.obj(); o[id] -= n; if (!o[id]) delete o[id]; } changed(); return true; },
  };
  S.inv = inv;
  S.recipes = () => Object.keys((F && F.rec) || {});

  // ------------------------------------------------------------------ time (L.clock from SYSTEMS)
  const DAY_LEN = 1440;
  let dbgHour = null;
  function hours() {
    if (dbgHour != null) return dbgHour;
    const c = L.clock; if (c) { if (c.hours) return c.hours(); if (c.dayPhase) return c.dayPhase() * 24; }
    return 12;
  }
  const inH = (h, a, b) => a <= b ? h >= a && h < b : h >= a || h < b;
  const isNight = () => (dbgHour == null && L.clock && L.clock.isNight) ? !!L.clock.isNight() : inH(hours(), CFG.night[0], CFG.night[1]);
  const moon = () => { try { return L.clock && L.clock.moonPhase ? L.clock.moonPhase() : .5; } catch (e) { return .5; } }; // 0 new .. .5 full
  const isDawn = () => inH(hours(), CFG.dawn[0], CFG.dawn[1]);
  const isSunrise = () => inH(hours(), CFG.sunrise[0], CFG.sunrise[1]);
  const isDusk = () => inH(hours(), CFG.dusk[0], CFG.dusk[1]);
  function dayIndex() {
    if (L.clock && L.clock.day) return L.clock.day();
    const ms = L.clock && L.clock.now ? L.clock.now() : wall();
    return Math.round(ms / 1000 / ((L.clock && L.clock.DAY_LEN) || DAY_LEN) - hours() / 24) + (dbgDay || 0);
  }
  let dbgDay = 0;
  const nightId = () => hours() >= 12 ? dayIndex() : dayIndex() - 1;
  S.time = { hours, isNight, isDawn, nightId };

  // ------------------------------------------------------------------ player / camera access
  const PL = { x: 0, y: 0, z: 0, ry: 0, v: 0 };
  let lastPos = null;
  function readPlayer(dt) {
    const p = L.P || MEM.pos || (MEM.pos = { x: 0, y: 0, z: 0, ry: 0 });
    if (lastPos && dt > 0) { const v = Math.hypot(p.x - lastPos[0], p.z - lastPos[1]) / dt; PL.v = v > 60 ? 0 : lerp(PL.v, v, clamp(dt * 6, 0, 1)); }
    lastPos = [p.x, p.z]; PL.x = p.x; PL.y = p.y; PL.z = p.z; PL.ry = p.ry || 0;
  }
  function camYawPitch() { const c = L.cam; return c ? [c.yaw, c.pitch] : [PL.ry, 0]; }
  function teleport(x, y, z) {
    if (L.storyTeleport) return L.storyTeleport(x, y, z);
    const p = L.P || MEM.pos; if (!p) return; p.x = x; p.y = y; p.z = z; if ('vx' in p) { p.vx = p.vy = p.vz = 0; } lastPos = null;
  }
  const groundY = (x, z, fb) => { try { if (L.ground) { const g = L.ground(x, z); if (g === g) return g; } } catch (e) { } return fb || 0; };
  const poi = id => (L.poi ? L.poi(id) : null) || null;

  // ------------------------------------------------------------------ conditions
  function fragCount() { let n = 0; for (let k = 1; k <= 5; k++) if (W('altar_' + k)) n++; return n; }
  // the forged star: in her bag (needed at the lock), already in the lock (GDD §5.6), or made by anyone in this world
  // (opens the next steps for both players)
  const starInBag = () => inv.count(IT.star) > 0;
  const starUsable = () => starInBag() || !!W('gate');
  const hasStar = () => starUsable() || !!W('forge_key');
  const COND_STAR = TX('vhmgAzeJAA==', '-');
  const learned = id => !!(P && P.sp[id]);
  function has(c) {
    if (!c) return true;
    if (c[0] === '!') return !has(c.slice(1));
    if (NOTE[c]) return !!P.notes[c];
    if (DREAM[c]) return !!P.dreams[c];
    let m;
    if ((m = /^frag_(\d+)$/.exec(c))) return fragCount() >= +m[1];
    if ((m = /^(tames|harvest|slept|cooked|built)_(\d+)$/.exec(c))) return (F[m[1]] || 0) >= +m[2];
    if ((m = /^sp_(\w+)$/.exec(c))) return learned(m[1]);
    if ((m = /^task_(\w+)$/.exec(c))) return taskState(m[1]) === 'done';
    if ((m = /^item_([a-z_]+?)_(\d+)$/.exec(c))) return inv.count(m[1]) >= +m[2];
    if ((m = /^w_(\w+)$/.exec(c))) return !!W(m[1]);
    switch (c) {
      case 'night': return isNight(); case 'day': return !isNight(); case 'dawn': return isDawn();
      case COND_STAR: return hasStar(); case 'awake': return !!W('awake');
      case 'full_moon': return Math.abs(moon() - .5) < .095; case 'new_moon': return Math.min(moon(), 1 - moon()) < .095;
    }
    return !!F[c] || !!W(c);
  }
  const all = a => !a || a.every(has);
  S.has = c => (P ? has(c) : false);
  S.hasStar = () => !!P && hasStar();

  // ------------------------------------------------------------------ tasks
  // poi: where the task lives (stuck helper / map hint), on(): becomes visible, prog(): [n, of], guard: guardian
  // that must be visited to finish ('auto' = finishes by itself), done(): world-level completion (shared tasks)
  const mill = () => { const w = W('windmill'); return w ? (w.p || []).filter(Boolean).length : 0; };
  const shrine = () => { const w = W('shrine') || {}; return [bits(w.reeds), bits(w.lotus)]; };
  const bits = v => { let n = 0; v = v | 0; while (v) { n += v & 1; v >>= 1; } return n; };
  const feathers = () => Object.keys(F.feath || {}).length;
  const lh = { tall: false, lamp: null, h: 0 };
  const TK = {
    k_fogo: { poi: 'hermit_tower_vale', on: () => P.notes.n12, prog: () => [(F.fire_cottage ? 1 : 0) + ((F.cooked || 0) > 0 ? 1 : 0), 2], guard: 'auto', spell: 'faisca' },
    k_horta: { poi: 'totem_jardim', on: () => met('totem_jardim'), prog: () => [Math.min(CFG.harvestOwn, F.harvest_own || 0), CFG.harvestOwn], guard: 'totem_jardim', spell: 'brotar' },
    k_moinho: { poi: 'windmill_broken', on: () => met('windmill') || P.notes.n05, prog: () => [mill(), 4], guard: 'windmill', spell: 'brisa', done: () => mill() >= 4, wf: 'windmill' },
    k_cervo: { poi: 'deer_meadow', on: () => met('cervo_lunar'), prog: () => [Math.min(CFG.deerNights, (F.deer || []).length), CFG.deerNights], guard: 'auto', spell: 'luz' },
    k_lago: { poi: 'turtle_shrine', on: () => met('tartaruga'), prog: () => { const s = shrine(); return [Math.min(CFG.reeds, s[0]) + Math.min(CFG.lotus, s[1]), CFG.reeds + CFG.lotus]; }, guard: 'tartaruga', spell: 'mare' },
    k_penas: { poi: 'griffin_queen', on: () => met('rainha_grifo') || feathers() > 0, prog: () => [Math.min(CFG.feathers, feathers()), CFG.feathers], guard: 'rainha_grifo', spell: 'ponte' },
    f1: { poi: 'totem_choro', on: () => met('totem_choro') || P.notes.s07 || P.notes.n07, prog: () => [W('altar_1') ? 2 : inv.count(IT.moonFlower) > 0 ? 1 : 0, 2], done: () => !!W('altar_1'), wf: 'altar_1' },
    f2: { poi: 'lunar_glade', on: () => taskState('k_cervo') === 'done', prog: () => [W('altar_2') ? 2 : F.glade ? 1 : 0, 2], done: () => !!W('altar_2'), wf: 'altar_2' },
    f3: { poi: 'lighthouse', on: () => P.notes.s03 || F.seen_lighthouse, prog: () => [W('altar_3') ? 4 : (lh.tall || W('lighthouse') ? 1 : 0) + (lh.lamp || W('lighthouse') ? 1 : 0) + (W('lighthouse') ? 1 : 0), 4], done: () => !!W('altar_3'), wf: 'altar_3' },
    f4: { poi: 'summit_camp', on: () => P.notes.n06 || met('espirito_iaque') || P.notes.s20, prog: () => [W('altar_4') ? 2 : F.vigil && F.vigil.done ? 1 : 0, 2], done: () => !!W('altar_4'), wf: 'altar_4' },
    f5: { poi: 'griffin_nest', on: () => P.notes.s14 || P.notes.s28 || met('rainha_grifo'), prog: () => [W('altar_5') ? 1 : 0, 1], done: () => !!W('altar_5'), wf: 'altar_5' },
    k_ver: { poi: 'totem_ancestral', on: () => hasStar(), prog: () => [learned('revelar') ? 1 : 0, 1], guard: 'totem_ancestral', spell: 'revelar' },
    k_fim: { poi: 'mist_sign', on: () => learned('revelar'), prog: () => [(F.castle_seen ? 1 : 0) + (W('gate') ? 1 : 0) + (P.notes.n11 ? 1 : 0) + (W('awake') ? 1 : 0), 4], done: () => !!W('awake'), wf: 'awake' },
  };
  TK[FORGE_TASK] = { poi: 'royal_forge', on: () => P.notes.n08, prog: () => { const d = W('forge') || {}; if (W('forge_key')) return [10, 10]; return [Math.min(5, d.f || 0) + Math.min(3, d.o || 0) + Math.min(2, d.c || 0), 10]; }, done: () => !!W('forge_key'), wf: 'forge_key' };
  const met = g => !!(F.met && F.met[g]);
  function meet(g) { F.met = F.met || {}; if (!F.met[g]) { F.met[g] = 1; changed(); } }
  function taskState(id) { const r = P && P.tasks[id]; return r ? r.s : null; }
  function setTask(id, s) {
    const r = P.tasks[id] || (P.tasks[id] = {}); if (r.s === s) return; const prev = r.s; r.s = s; r.t = wall(); changed();
    emit('task', { id, state: s, prev, title: T('tasks.' + id + '.title') });
  }
  function learn(id, quiet) {
    if (!id || learned(id)) return; P.sp[id] = wall(); changed();
    emit('learn', { id, name: T('spells.' + id + '.name'), quiet });
    checkLook();
  }
  function finishTask(id) {
    const k = TK[id]; setTask(id, 'done'); if (k && k.spell) learn(k.spell);
    progressMade();
  }
  function updateTasks() {
    for (const t of TASKS) {
      const k = TK[t.id]; if (!k) continue; const st = taskState(t.id);
      if (st === 'done') continue;
      const worldDone = k.done && k.done();
      if (!st && (k.on() || worldDone)) setTask(t.id, 'on');
      if (!taskState(t.id)) continue;
      const [n, of] = k.prog();
      if (worldDone && (!k.guard || k.guard === 'auto')) { finishTask(t.id); continue; }
      if (k.guard === 'auto' && n >= of) { finishTask(t.id); if (t.id === 'k_cervo') talk('cervo_lunar', ['done']); continue; }
      if (k.guard && k.guard !== 'auto' && n >= of && st !== 'ready') setTask(t.id, 'ready');
    }
  }
  S.taskView = function () {
    if (!P) return [];
    return TASKS.filter(t => TK[t.id] && taskState(t.id)).map(t => {
      const k = TK[t.id], [n, of] = k.prog(); const s = taskState(t.id);
      const wf = k.wf && W(k.wf), by = s === 'done' && wf && wf.by && wf.by !== me() ? String(wf.by) : ''; // finished by the partner
      return { id: t.id, title: T('tasks.' + t.id + '.title'), text: T('tasks.' + t.id + '.text'), n: s === 'done' ? of : Math.min(n, of), of, state: s, frag: /^f\d$/.test(t.id), spell: k.spell ? T('spells.' + k.spell + '.name') : '', by, t: (P.tasks[t.id] || {}).t || 0 };
    });
  };

  // ------------------------------------------------------------------ appearance progression
  function checkLook() {
    const n = Object.keys(P.sp).length; let ch = false;
    if (n >= 1 && !F.cape) { F.cape = 1; ch = true; }
    if (n >= 4 && !F.hat) { F.hat = 1; ch = true; }
    if (ch) { changed(); if (L.onStoryLook) L.onStoryLook(S.look()); emit('look', S.look()); }
  }
  S.look = () => ({ cape: !!(F && F.cape), hat: !!(F && F.hat), crown: !!(F && F.crown) });

  // ------------------------------------------------------------------ dialog helpers
  function gname(g) { return T('guardians.' + g + '.name'); }
  function talk(g, keys, actions) {
    const lines = keys.map(k => T('guardians.' + g + '.' + k)).filter(Boolean);
    if (lines.length) emit('dialog', { gid: g, name: gname(g), lines, actions: actions || null });
  }

  // ------------------------------------------------------------------ notes, thoughts, dreams
  function readNote(id, opt) {
    const n = NOTE[id]; if (!n) return;
    const first = !P.notes[id];
    if (first) {
      P.notes[id] = wall(); changed();
      if (n.give) for (const k in n.give) inv.give(k, n.give[k]);
      if (n.main) progressMade();
    }
    emit('note', { id, first, then: opt && opt.then });
    if (id === 'n11') { learn('despertar'); }
    needEval = true;
  }
  S.readNote = readNote;
  S.noteView = id => { const n = NOTE[id]; if (!n) return null; return { id, title: T('notes.' + id + '.title'), text: T('notes.' + id + '.text'), sig: n.sig ? T('sig.' + n.sig) : '', how: n.how, main: !!n.main }; };
  S.notesRead = () => P ? NOTES.filter(n => P.notes[n.id]).map(n => Object.assign(S.noteView(n.id), { t: P.notes[n.id] })).sort((a, b) => a.t - b.t) : [];
  S.dreamsSeen = () => P ? DREAMS.filter(d => P.dreams[d.id]).map(d => ({ id: d.id, text: T('dreams.' + d.id + '.text'), t: P.dreams[d.id] })) : [];
  S.thoughtsSeen = () => P ? THOUGHTS.filter(h => P.th[h.id]).map(h => ({ id: h.id, text: T('thoughts.' + h.id + '.text'), t: P.th[h.id] })).sort((a, b) => b.t - a.t) : [];
  const thoughtQ = []; let thoughtCD = 0;
  function checkThoughts() {
    for (const h of THOUGHTS) if (!P.th[h.id] && has(h.on)) { P.th[h.id] = wall(); changed(); thoughtQ.push(h.id); }
  }
  function nextDream() {
    for (const d of DREAMS) if (!P.dreams[d.id] && all(d.need)) return d.id;
    return null;
  }
  function showDream(id) { P.dreams[id] = wall(); changed(); emit('dream', { id, text: T('dreams.' + id + '.text') }); needEval = true; }

  // ------------------------------------------------------------------ stuck helper: ordered main-chain clues
  // [poi to guide towards, done?, lore path echoed by the softer dream hint (else: the latest note read),
  //  wait? (true while the step cannot be done yet, e.g. a plant still growing: the helper skips to the next one)]
  const CLUES = [
    ['cottage', () => P.notes.n01], ['cottage', () => F.fire_cottage, 'notes.n01.text'], ['totem_sorriso', () => P.notes.n03, 'notes.n02.text'],
    ['bakery', () => P.notes.n04], ['hermit_tower_vale', () => P.notes.n12], ['stream_mills', () => P.notes.n05],
    ['windmill_broken', () => learned('brisa'), 'tasks.k_moinho.text'], ['totem_jardim', () => learned('brotar'), 'tasks.k_horta.text'], ['lunar_garden', () => P.notes.n07],
    ['deer_meadow', () => learned('luz'), 'tasks.k_cervo.text'], ['totem_choro', () => W('altar_1'), 'tasks.f1.text', () => !!F.moon_planted && !inv.count(IT.moonFlower)], ['lunar_glade', () => W('altar_2'), 'tasks.f2.text'],
    ['turtle_shrine', () => learned('mare'), 'tasks.k_lago.text'], ['lighthouse', () => W('altar_3'), 'tasks.f3.text'], ['summit_camp', () => W('altar_4'), 'tasks.f4.text'],
    ['griffin_queen', () => learned('ponte'), 'tasks.k_penas.text'], ['griffin_nest', () => W('altar_5'), 'tasks.f5.text'], ['royal_forge', () => P.notes.n08],
    ['royal_forge', () => hasStar(), 'tasks.' + FORGE_TASK + '.text'], ['totem_ancestral', () => learned('revelar'), 'tasks.k_ver.text'], ['mist_sign', () => F.castle_seen, 'notes.n10.text'],
    ['castle_gate', () => W('gate'), 'notes.n03.text'], ['throne', () => P.notes.n11], ['throne', () => W('awake'), 'notes.n11.text'],
  ];
  function clueEntry() { for (const c of CLUES) if (!c[1]() && poi(c[0]) && !(c[3] && c[3]())) return c; return null; }
  function hintText() {
    const c = clueEntry(); let t = c && c[2] ? T(c[2]) : '';
    if (!t) { let best = null, bt = -1; for (const id in P.notes) if (P.notes[id] > bt) { bt = P.notes[id]; best = id; } if (best) t = T('notes.' + best + '.text'); }
    return t;
  }
  function mainProgress() { let n = 0; for (const c of CLUES) if (c[1]()) n++; return n; }
  function nextClue() { const c = clueEntry(); return c ? c[0] : null; }
  S.nextClue = () => (P ? nextClue() : null);
  function progressMade() { F.progT = F.playT || 0; F.mainN = mainProgress(); changed(); }

  // ------------------------------------------------------------------ placement of story objects
  // Offsets are local to the POI: [x right, z = POI front (sin ry, cos ry), y up] in metres. Override per object
  // with L.storyAnchor(objId) -> {x,y,z,ry} (wave-2 dressing) or a POI field `story: {objId: [dx,dz,dy]}`.
  const BUILDING = new Set(['bakery', 'village_house_a', 'village_house_b', 'fisher_hut', 'lake_house', 'hunter_cabin', 'high_school', 'high_tower', 'hermit_tower_vale', 'hermit_tower_canyon', 'tower_house']);
  const OFF = {
    'note:cottage': [-1.2, 0.6], 'note:summit_camp': [2.2, 2.6], 'note:royal_forge': [-2.4, 1.2], 'note:throne': [2.6, 1.6],
    'note:totem_sorriso': [0.9, 1.1], 'note:stream_mills': [0, 0], 'note:mist_sign': [1.8, 0.6],
    'g:bigorna': [0.6, 1.4], 'g:espirito_iaque': [6, 2], 'altar:1': [0, 1.7], 'altar:2': [0, 0], 'altar:5': [0, 0],
    'lock': [0, 0.6, 3.1],
  };
  function offFor(key, p, how) {
    if (OFF[key]) return OFF[key];
    if (BUILDING.has(p)) return [1.6, 4.6];
    if (/^totem|stones|ring/.test(p) || how === 'stone') return [1.0, 1.2];
    if (how === 'sign') return [2.0, 1.4];
    return [0, 0];
  }
  const OBJ = []; const OBJ_BY = {};
  const POI_COUNT = {};
  function addObj(o) {
    o.r = o.r || CFG.interactR; o.dy = o.dy || 0; OBJ.push(o); OBJ_BY[o.id] = o;
    if (o.poi && !o.noSpread) { const k = POI_COUNT[o.poi] = (POI_COUNT[o.poi] || 0) + 1; o.spread = k - 1; }
    return o;
  }
  // Positions are cached, with two refinements because models and colliders stream in after boot:
  //  * an object with where() (a named piece of the authored keep) that is not loaded yet gets a provisional spot from
  //    its POI and asks where() again every second until it answers;
  //  * the height of a POI-placed object is read again (ground + colliders) when she comes within CFG.yNear, and every
  //    3 s while she stays there (a floor or collider that streamed in later lifts it).
  // S.invalidate() (or the events 'castle_ready' / 'colliders') drops every cached position.
  let posGen = 0;
  function setPos(o, p, fixedY) { o.pos = p; o.pv = (o.pv || 0) + 1; if (fixedY) o.yOk = true; return p; }
  function resolve(o) {
    if (o.pos && !o.dynamic && o.gen === posGen) {
      if (o.prov) { if (tNow >= o.retry) { o.retry = tNow + 1; const w = o.where(); if (w) { o.prov = false; o.fromWhere = true; setPos(o, w, true); } } }
      else if (o.ySrc && (!o.yOk || tNow >= o.yT) && hyp(PL.x, PL.z, o.pos.x, o.pos.z) < CFG.yNear) { o.yT = tNow + 3; o.yOk = true; const y = o.ySrc(); if (y === y && y != null && Math.abs(y - o.pos.y) > .01) setPos(o, { x: o.pos.x, y, z: o.pos.z, ry: o.pos.ry }); }
      return o.pos;
    }
    o.gen = posGen; o.prov = false; o.fromWhere = false; o.yOk = false; o.ySrc = null;
    if (o.where) {
      const w = o.where(); if (w) { o.fromWhere = true; return setPos(o, w, true); }
      if (o.dynamic) { o.pos = null; return null; }
      o.prov = true; o.retry = tNow + 1;
    }
    const a = L.storyAnchor && L.storyAnchor(o.id);
    if (a) return setPos(o, { x: a.x, y: a.y != null ? a.y : groundY(a.x, a.z), z: a.z, ry: a.ry || 0 }, a.y != null);
    const p = poi(o.poi); if (!p) { o.pos = null; return null; }
    const ry = p.ry || 0; const off = (p.story && p.story[o.id]) || o.off || [0, 0];
    let dx = off[0], dz = off[1];
    if (o.spread) { const a2 = o.spread * 2.1 + .6; dx += Math.cos(a2) * 2.4; dz += Math.sin(a2) * 2.4; }
    const c = Math.cos(ry), s = Math.sin(ry);
    const x = p.x + dx * c + dz * s, z = p.z - dx * s + dz * c;
    const yAt = () => {
      const base = p.y != null ? p.y : groundY(x, z);
      let y = base; try { y = L.groundAt ? L.groundAt(x, z, base + 1.5, 3).y : groundY(x, z, base); } catch (e) { }
      if (!(y === y) || o.fly || (p.y != null && base - y > 4)) y = base; // floating islets: trust the POI height
      if (o.under && L.waterAt) { const w = L.waterAt(x, z); if (w > y) y = Math.max(y, w - 1.1); }
      return y + (off[2] || 0) + o.dy;
    };
    o.ySrc = yAt; o.yOk = hyp(PL.x, PL.z, x, z) < CFG.yNear; o.yT = tNow + 3;
    return setPos(o, { x, y: yAt(), z, ry: ry + (o.ry || 0) });
  }
  S.invalidate = () => { posGen++; needEval = true; doorDone = false; doorChk = 0; };

  // ------------------------------------------------------------------ 3D: materials, procedural props, models
  const MAT = {}; const TEX = {};
  function mats() {
    if (MAT.v) return MAT;
    const sty = m => (L.stylize ? (L.stylize(m) || m) : m);
    MAT.v = (L.MAT && (L.MAT.v5 || L.MAT.v4)) || sty(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 }));
    MAT.vd = sty(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide }));
    MAT.glow = (L.MAT && L.MAT.glow) || new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2, 2, 2), fog: false });
    MAT.star = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, .95, .42), fog: false });
    MAT.paper = sty(new THREE.MeshStandardMaterial({ map: tex('paper'), roughness: .95, side: THREE.DoubleSide }));
    MAT.drawing = sty(new THREE.MeshStandardMaterial({ map: tex('drawing'), roughness: .95 }));
    MAT.rune = new THREE.MeshBasicMaterial({ map: tex('rune'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false });
    MAT.ghost = new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: .32, depthWrite: false });
    MAT.cloud = sty(new THREE.MeshStandardMaterial({ color: 0xf6f8fb, roughness: 1, transparent: true, opacity: 1, emissive: 0x9fb4d0, emissiveIntensity: .18 }));
    MAT.bird = sty(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide, flatShading: true }));
    MAT.spirit = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false });
    MAT.beam = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uA: { value: 0 }, uT: { value: 0 } },
      vertexShader: 'varying vec2 vU; varying float vF; void main(){ vU = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uA,uT; varying vec2 vU; varying float vF; void main(){ float along = vU.y; float a = uA * pow(vF, 1.2) * (1.-.45*along) * (1.-smoothstep(.7,1.,along)) * (.88+.12*sin(uT*1.7-along*9.)); gl_FragColor = vec4(1.,.9,.64,a*.7); }',
    });
    return MAT;
  }
  const lin = h => new THREE.Color(h).convertSRGBToLinear();
  function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; }
  function rnd(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function tex(name) {
    if (TEX[name]) return TEX[name];
    if (name === 'paper') TEX.paper = canvas(256, 192, (g, w, h) => {
      g.fillStyle = '#f3e4c4'; g.fillRect(0, 0, w, h); const r = rnd(7);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(150,110,70,${r() * .05})`; g.fillRect(r() * w, r() * h, 2, 2); }
      const gr = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 150); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(120,80,40,.28)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(90,60,40,.55)'; g.lineWidth = 2; g.lineCap = 'round';
      for (let l = 0; l < 7; l++) { const y = 34 + l * 19; let x = 26; g.beginPath(); g.moveTo(x, y); while (x < w - 30 - (l === 6 ? 90 : 0)) { x += 6 + r() * 7; g.lineTo(x, y + (r() - .5) * 5); if (r() < .12) { x += 8; g.moveTo(x, y); } } g.stroke(); }
      g.fillStyle = 'rgba(200,150,50,.9)'; g.font = '28px serif'; g.fillText('\u2726', w - 46, h - 20);
    });
    if (name === 'drawing') TEX.drawing = canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#fbf7ee'; g.fillRect(0, 0, w, h); g.lineCap = 'round'; g.lineJoin = 'round';
      const cr = (c, lw) => { g.strokeStyle = c; g.lineWidth = lw; };
      cr('#f2b632', 7); g.beginPath(); g.arc(205, 50, 24, 0, TAU); g.stroke(); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; g.beginPath(); g.moveTo(205 + Math.cos(a) * 32, 50 + Math.sin(a) * 32); g.lineTo(205 + Math.cos(a) * 44, 50 + Math.sin(a) * 44); g.stroke(); }
      cr('#9fb7d6', 8); g.beginPath(); g.moveTo(30, 200); g.bezierCurveTo(40, 160, 90, 165, 100, 185); g.bezierCurveTo(120, 150, 180, 160, 175, 200); g.closePath(); g.stroke();
      cr('#3c5ea8', 6); g.beginPath(); g.arc(105, 105, 18, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(105, 123); g.lineTo(105, 168); g.moveTo(80, 140); g.lineTo(130, 140); g.moveTo(105, 168); g.lineTo(90, 190); g.moveTo(105, 168); g.lineTo(120, 190); g.stroke();
      cr('#e8e6e0', 9); g.beginPath(); g.moveTo(96, 116); g.lineTo(105, 150); g.lineTo(114, 116); g.stroke();
      cr('#e0b23a', 5); g.beginPath(); g.moveTo(88, 86); g.lineTo(92, 72); g.lineTo(100, 82); g.lineTo(106, 68); g.lineTo(112, 82); g.lineTo(120, 72); g.lineTo(122, 86); g.stroke();
      cr('#e46b6b', 5); g.beginPath(); g.moveTo(40, 40); g.lineTo(60, 60); g.moveTo(60, 40); g.lineTo(40, 60); g.stroke();
    });
    if (name === 'rune') TEX.rune = canvas(256, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h); const r = rnd(31); g.lineCap = 'round'; g.shadowColor = '#9fe8ff'; g.shadowBlur = 12;
      for (let k = 0; k < 6; k++) { const cx = 28 + k * 40, cy = 64; g.strokeStyle = 'rgba(190,245,255,.95)'; g.lineWidth = 4; g.beginPath(); let x = cx + (r() - .5) * 10, y = cy - 30; g.moveTo(x, y); for (let s = 0; s < 4; s++) { x = cx + (r() - .5) * 26; y += 10 + r() * 10; g.lineTo(x, y); } g.stroke(); if (r() < .6) { g.beginPath(); g.arc(cx, cy + (r() - .5) * 20, 5, 0, TAU); g.stroke(); } }
    });
    if (name === 'letter') TEX.letter = canvas(128, 96, (g, w, h) => {
      g.fillStyle = '#f7efdc'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(122,91,69,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(w / 2, h * .55); g.lineTo(w, 0); g.stroke();
      g.fillStyle = '#b8483a'; g.beginPath(); g.arc(w / 2, h * .55, 11, 0, TAU); g.fill(); g.fillStyle = '#ffe2a8'; g.font = '16px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('\u2726', w / 2, h * .56);
    });
    return TEX[name];
  }
  // geometry parts with a soft vertical colour gradient (lit top, darker cooler base), merged into one mesh
  function part(geo, hex, x, y, z, rx, ry, rz, sx, sy, sz, opt) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone(); if (g.attributes.uv) g.deleteAttribute('uv'); if (g.attributes.uv2) g.deleteAttribute('uv2');
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox(); const b = g.boundingBox, hgt = (b.max.y - b.min.y) || 1, pos = g.attributes.position, n = pos.count;
    const c = lin(hex), col = new Float32Array(n * 3), flat = opt && opt.flat, lo = (opt && opt.lo != null) ? opt.lo : .78;
    for (let i = 0; i < n; i++) { const k = flat ? 1 : lo + (1.08 - lo) * (pos.getY(i) - b.min.y) / hgt; col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k * (flat ? 1 : 1 + (1 - k) * .25); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x || 0, y || 0, z || 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
    g.applyMatrix4(m); return g;
  }
  function merge(parts, mat) {
    const U = THREE.BufferGeometryUtils; let mesh;
    if (U && U.mergeBufferGeometries) { const g = U.mergeBufferGeometries(parts, false); mesh = new THREE.Mesh(g, mat || mats().v); }
    else { mesh = new THREE.Group(); for (const p of parts) mesh.add(new THREE.Mesh(p, mat || mats().v)); }
    mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
  }
  const G = {
    box: (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl: (r0, r1, h, n) => new THREE.CylinderGeometry(r0, r1, h, n || 10),
    sph: (r, d) => new THREE.IcosahedronGeometry(r, d == null ? 1 : d), dod: r => new THREE.DodecahedronGeometry(r, 0), cone: (r, h, n) => new THREE.ConeGeometry(r, h, n || 8),
  };
  function starShape(R, r) { const s = new THREE.Shape(); for (let i = 0; i <= 10; i++) { const a = i / 10 * TAU + Math.PI / 2, q = i % 2 ? r : R; if (i) s.lineTo(Math.cos(a) * q, Math.sin(a) * q); else s.moveTo(Math.cos(a) * q, Math.sin(a) * q); } return s; }
  function starGeo(R, r, d) { const g = new THREE.ExtrudeGeometry(starShape(R, r), { depth: d, bevelEnabled: true, bevelThickness: d * .4, bevelSize: R * .1, bevelSegments: 2, steps: 1 }); g.center(); return g; }
  function glowTex() {
    if (L.GLOW) return L.GLOW;
    if (!TEX.glow) TEX.glow = canvas(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    return TEX.glow;
  }
  function glowSprite(color, size, op) {
    if (L.glowSprite) { const s = L.glowSprite(color, size, op); if (s && s.material && !s.userData.ownMat) { s.material = s.material.clone(); s.userData.ownMat = 1; } return s; }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity: op == null ? 1 : op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); s.scale.set(size, size, 1); return s;
  }
  const WOOD = '#a8845d', WOOD2 = '#8b5a3c', STONE = '#a59f92', PAPER = '#f3e6c8';
  function paperQuad(w, h, mat) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat || mats().paper); m.receiveShadow = true; return m; }
  // each prop: a group; userData.body = the part replaced by an authored model when one exists
  const grp = (body, extra) => { const g = new THREE.Group(); g.add(body); g.userData.body = body; if (extra) extra(g); return g; };
  const PROPS = {
    table() {
      return grp(merge([part(G.box(.95, .07, .62), WOOD, 0, .74, 0), ...[[-.4, -.25], [.4, -.25], [-.4, .25], [.4, .25]].map(([x, z]) => part(G.cyl(.035, .03, .72, 6), WOOD2, x, .36, z)), part(G.dod(.06), STONE, .26, .8, -.12, 0, 0, 0, 1, .6, 1)]),
        g => { const p = paperQuad(.36, .27); p.rotation.set(-Math.PI / 2, 0, .18); p.position.set(-.06, .785, .02); g.add(p); g.userData.paper = p; });
    },
    lectern() {
      return grp(merge([part(G.box(.5, .08, .4), WOOD2, 0, .04, 0), part(G.cyl(.07, .09, 1.0, 8), WOOD, 0, .55, 0), part(G.box(.62, .05, .46), WOOD2, 0, 1.08, .02, -.42), part(G.box(.27, .03, .37), PAPER, -.14, 1.118, .035, -.42, 0, .05, 1, 1, 1, { flat: true }), part(G.box(.27, .03, .37), PAPER, .14, 1.118, .035, -.42, 0, -.05, 1, 1, 1, { flat: true }), part(G.box(.02, .012, .32), '#c9573f', 0, 1.135, .045, -.42)]));
    },
    stone() {
      return grp(merge([part(G.dod(.42), STONE, 0, .3, 0, .2, .4, .1, 1, 1.45, .55), part(G.dod(.18), '#8c877c', .34, .07, .2, 0, 0, 0, 1, .55, 1), part(G.sph(.16, 0), '#7a9440', -.27, .05, .12, 0, 0, 0, 1.3, .35, 1.1)]),
        g => { const p = new THREE.Mesh(new THREE.PlaneGeometry(.46, .3), new THREE.MeshBasicMaterial({ map: tex('rune'), transparent: true, opacity: .5, color: 0x3d2e22, depthWrite: false })); p.position.set(0, .4, .235); p.rotation.x = -.1; g.add(p); });
    },
    bottle() {
      const pts = [[0, 0], [.07, 0], [.08, .02], [.08, .17], [.05, .21], [.028, .24], [.028, .3], [0, .3]].map(([x, y]) => new THREE.Vector2(x, y));
      const b = merge([part(new THREE.LatheGeometry(pts, 10), '#7fc4b6', 0, 0, 0, 0, 0, 0, 1, 1, 1, { lo: .9 }), part(G.cyl(.03, .026, .05, 6), '#8b5a3c', 0, .315, 0), part(G.cyl(.035, .035, .14, 8), PAPER, 0, .1, 0, 0, 0, 0, 1, 1, 1, { flat: true })]);
      const holder = new THREE.Group(); b.rotation.z = Math.PI / 2 - .12; b.position.set(.15, .08, 0); holder.add(b); return grp(holder);
    },
    sign() {
      return grp(merge([part(G.cyl(.06, .07, 1.6, 7), WOOD2, 0, .8, 0, 0, 0, .03), part(G.box(.86, .46, .07), WOOD, 0, 1.38, .06, 0, 0, -.04), part(G.box(.9, .05, .09), WOOD2, 0, 1.6, .06, 0, 0, -.04)]),
        g => { const p = new THREE.Mesh(new THREE.PlaneGeometry(.7, .32), new THREE.MeshBasicMaterial({ map: tex('rune'), transparent: true, opacity: .6, color: 0x3d2a1e, depthWrite: false })); p.position.set(0, 1.38, .1); p.rotation.z = -.04; g.add(p); });
    },
    drawing() {
      return grp(merge([part(G.cyl(.025, .025, 1.3, 5), WOOD2, -.3, .62, -.1, .12, 0, .1), part(G.cyl(.025, .025, 1.3, 5), WOOD2, .3, .62, -.1, .12, 0, -.1), part(G.cyl(.025, .025, 1.2, 5), WOOD2, 0, .58, -.32, -.32), part(G.box(.72, .04, .06), WOOD2, 0, .66, .02)]),
        g => { const p = new THREE.Mesh(new THREE.PlaneGeometry(.6, .6), mats().drawing); p.position.set(0, 1.0, 0); p.rotation.x = -.12; g.add(p); });
    },
    diary() {
      return grp(merge([part(G.box(.62, .5, .5), WOOD, 0, .25, 0), part(G.box(.64, .04, .52), WOOD2, 0, .5, 0), part(G.box(.34, .07, .25), '#7a3328', .05, .55, .02, 0, .3, 0), part(G.box(.3, .055, .23), PAPER, .062, .556, .02, 0, .3, 0, 1, 1, 1, { flat: true }), part(G.cyl(.04, .05, .16, 8), '#c9a77c', -.2, .58, -.12)]));
    },
    letter() {
      const g = new THREE.Group(); g.add(merge([part(G.box(.26, .014, .18), '#f7efdc', 0, .007, 0, 0, 0, 0, 1, 1, 1, { flat: true })]));
      const top = new THREE.Mesh(new THREE.PlaneGeometry(.26, .18), new THREE.MeshStandardMaterial({ map: tex('letter'), roughness: .9 })); top.rotation.x = -Math.PI / 2; top.position.y = .0145; g.add(top);
      g.position.y = .01; return grp(g);
    },
    rune() {
      return grp(merge([part(G.dod(.45), '#8f8a80', 0, .4, 0, .1, .3, 0, 1, 1.6, .5)]), g => {
        const m = mats().rune.clone(); const p = new THREE.Mesh(new THREE.PlaneGeometry(.9, .45), m); p.position.set(0, .55, .27); g.add(p); g.userData.rune = m;
        const gl = glowSprite(0x9fe8ff, 2.2, 0); gl.position.set(0, .6, .3); g.add(gl); g.userData.glow = gl;
      });
    },
    star(size) {
      size = size || 1; return grp(new THREE.Mesh(starGeo(.3 * size, .13 * size, .07 * size), mats().star), g => {
        const gl = glowSprite(0xffc96a, 1.9 * size, .5); g.add(gl); g.userData.glow = gl; g.add(glowSprite(0xfff1cf, .55 * size, .7));
      });
    },
    feather() {
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(.09, .1, .1, .32, 0, .46); sh.bezierCurveTo(-.1, .32, -.09, .1, 0, 0);
      const f = merge([part(new THREE.ShapeGeometry(sh, 8), '#e6b94a', 0, 0, 0, 0, 0, 0, 1, 1, 1, { lo: .85 }), part(G.cyl(.008, .008, .5, 4), '#fff1c2', 0, .22, .005)], mats().vd); f.rotation.z = .5;
      return grp(f, g => { const gl = glowSprite(0xffd77a, 1.1, .8); gl.position.y = .22; g.add(gl); g.userData.glow = gl; });
    },
    chest() {
      const g = grp(merge([part(G.box(.8, .42, .5), '#6b4630', 0, .21, 0), part(G.box(.84, .05, .54), '#d7a84a', 0, .1, 0), part(G.box(.84, .05, .54), '#d7a84a', 0, .34, 0), part(G.box(.1, .12, .04), '#e3c06a', 0, .3, .27)]));
      const lid = merge([part(G.cyl(.25, .25, .8, 10), '#7a5338', 0, 0, 0, 0, 0, Math.PI / 2, 1, 1, .8), part(G.box(.06, .5, .5), '#d7a84a', -.3, 0, 0), part(G.box(.06, .5, .5), '#d7a84a', .3, 0, 0)]);
      const piv = new THREE.Group(); piv.position.set(0, .42, -.25); lid.position.set(0, 0, .25); lid.scale.set(1, .55, 1); piv.add(lid); g.add(piv); g.userData.lid = piv;
      const gl = glowSprite(0xffe2a0, 2.2, .35); gl.position.y = .5; g.add(gl); g.userData.glow = gl; return g;
    },
    reeds() {
      const r = rnd(5), parts = [];
      for (let i = 0; i < 9; i++) parts.push(part(G.cone(.03, 1 + r() * .6, 4), i % 2 ? '#9a8a6a' : '#7d6f55', (r() - .5) * .6, .55, (r() - .5) * .6, (r() - .5) * .5, 0, (r() - .5) * .7));
      return grp(merge(parts));
    },
    pad() {
      const pad = new THREE.CylinderGeometry(.45, .45, .03, 14, 1, false, .3, TAU - .6);
      return grp(merge([part(pad, '#5f8f3a', 0, .02, 0, 0, 0, 0, 1, 1, 1, { flat: true }), part(pad, '#6e9e45', .5, .02, .35, 0, 1.4, 0, .6, 1, .6, { flat: true })]), g => {
        const pp = []; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; pp.push(part(G.sph(.1, 0), i % 2 ? '#f3a7c0' : '#f7c4d4', Math.cos(a) * .1, .1, Math.sin(a) * .1, 0, -a, .9, .6, 1.4, .5)); } pp.push(part(G.sph(.06, 0), '#f2d35a', 0, .12, 0));
        const fl = merge(pp); fl.visible = false; g.add(fl); g.userData.flower = fl;
      });
    },
    millPart() {
      const w = merge([part(G.box(.16, .16, 2.6), WOOD, 0, .4, 0), part(G.box(.16, .16, 2.6), WOOD, .5, .4, 0), part(G.box(.7, .1, .12), WOOD2, .25, .5, -.8), part(G.box(.7, .1, .12), WOOD2, .25, .5, .8), part(G.cyl(.12, .12, .3, 8), '#c9b48a', -.4, .15, .6, Math.PI / 2)]);
      const gh = new THREE.Mesh(w.geometry, mats().ghost.clone()); gh.castShadow = false;
      return grp(w, g => { g.add(gh); w.visible = false; g.userData.solid = w; g.userData.ghost = gh; });
    },
    mushrooms() { // one stem + cap built once, then copied around the ring (cheap to build)
      const one = merge([part(G.cyl(.05, .07, .22, 6), '#e8e2d0', 0, .11, 0), part(G.sph(.14, 1), '#7fd8ff', 0, .24, 0, 0, 0, 0, 1, .5, 1, { flat: true })]).geometry;
      const parts = []; for (let i = 0; i < 11; i++) { const a = i / 11 * TAU, r = 3 + Math.sin(i * 2.7) * .3; const g = one.clone(); g.applyMatrix4(new THREE.Matrix4().makeRotationY(a * 1.7).setPosition(Math.cos(a) * r, 0, Math.sin(a) * r)); parts.push(g); }
      const m = merge(parts, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.2, 1.4, 1.8) })); m.castShadow = false; one.dispose(); return grp(m, g => { g.userData.caps = m; });
    },
    altar() { // small round stone pedestal under a floating light
      const pts = [[0, 0], [.34, 0], [.36, .06], [.3, .14], [.21, .2], [.19, .58], [.27, .66], [.33, .74], [.31, .8], [0, .8]].map(([x, y]) => new THREE.Vector2(x, y));
      return grp(merge([part(new THREE.LatheGeometry(pts, 14), '#d9d2c2', 0, 0, 0, 0, 0, 0, 1, 1, 1, { lo: .74 }), part(starGeo(.17, .075, .01), '#b9ae98', 0, .805, 0, -Math.PI / 2, 0, 0, 1, 1, 1, { flat: true })]));
    },
    bow() { // the forged star on its stem; the authored model replaces it when present
      return grp(merge([part(starGeo(.17, .08, .04), '#e8bf55', 0, .44, 0, 0, 0, 0, 1, 1, 1, { lo: .9 }), part(G.cyl(.022, .022, .34, 8), '#d9ac43', 0, .2, 0), part(G.sph(.04, 1), '#e8bf55', 0, .27, 0), part(G.box(.07, .05, .022), '#d9ac43', .045, .05, 0), part(G.box(.05, .03, .022), '#d9ac43', .04, .11, 0)]), g => {
        const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(.045, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.5, 1.7) })); gem.position.set(0, .44, .03); g.add(gem);
        const gl = glowSprite(0xffd98a, 1.4, .55); gl.position.y = .4; g.add(gl); g.userData.glow = gl;
      });
    },
    sheet() { // a written page lying on the authored reading stand
      const p = paperQuad(.36, .27); p.rotation.order = 'YXZ'; p.rotation.set(-(Math.PI / 2 - .4), -.38, 0); p.position.y = .012; return grp(p);
    },
    lockDisc() {
      return grp(merge([part(G.cyl(1, 1, .25, 28), '#cbbfa8', 0, 0, 0, Math.PI / 2), part(G.cyl(.82, .82, .27, 28), '#b2a58c', 0, 0, .01, Math.PI / 2)]), g => {
        const s = new THREE.Mesh(starGeo(.55, .23, .06), new THREE.MeshBasicMaterial({ color: new THREE.Color(.25, .22, .18) })); s.position.z = .16; g.add(s); g.userData.star = s;
      });
    },
    throne() {
      return grp(merge([part(G.box(1.5, .5, 1.1), STONE, 0, .25, 0), part(G.box(1.4, .14, 1.0), '#b8b0a0', 0, .56, .02), part(G.box(1.5, 2.6, .3), STONE, 0, 1.55, -.45), part(G.box(.22, .5, 1.0), '#9d968a', -.72, .8, 0), part(G.box(.22, .5, 1.0), '#9d968a', .72, .8, 0), part(G.box(2.2, .3, 1.8), '#8f897e', 0, -.1, .15)]), g => {
        const s = new THREE.Mesh(starGeo(.34, .15, .05), new THREE.MeshBasicMaterial({ color: 0xd9b45a })); s.position.set(0, 2.45, -.28); g.add(s);
      });
    },
    ivy() {
      const r = rnd(11), parts = []; for (let i = 0; i < 34; i++) { const a = r() * TAU, rr = .35 + r() * .55; parts.push(part(G.sph(.1 + r() * .08, 0), r() < .8 ? '#5f8a3a' : (r() < .5 ? '#f2f0e6' : '#e9c45a'), Math.cos(a) * rr, r() * 1.7, Math.sin(a) * rr * .7 - .1, 0, 0, 0, 1, .7, 1, { flat: true })); }
      return grp(merge(parts));
    },
  };
  // optional authored models (AW-story files): replace the procedural body when present
  const FILES = {};
  function modelFile(f) { if (!L.loadModel) return Promise.resolve(null); return FILES[f] || (FILES[f] = Promise.resolve(L.loadModel(f)).catch(() => null)); }
  function modelPart(f, name) {
    return modelFile(f).then(sc => {
      if (!sc) return null; let src = null; sc.traverse(o => { if (!src && o.name === name) src = o; }); if (!src) return null;
      const c = src.clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1);
      c.traverse(o => { if (o.isMesh) { const gl = /_glow/.test(o.name); o.material = gl ? mats().glow : mats().v; o.castShadow = !gl; o.receiveShadow = !gl; } });
      return c;
    });
  }
  // kind -> [file, object, what to hide: 'body' | 'paper']
  const MODEL_FOR = { table: ['items5', 'note_scroll', 'paper'], bottle: ['items5', 'bottle_note', 'body'], lectern: ['items5', 'lectern', 'body'], letter: ['items5', 'note_letter', 'body'], rune: ['items5', 'rune_stone', 'body'], feather: ['items5', 'feather_gold', 'body'], star: ['items5', 'fragment_star', 'body'], altar: ['items5', 'altar_stone', 'body'] };
  if (MODEL.bow) MODEL_FOR.bow = ['items5', MODEL.bow, 'body'];
  // Visual templates: each kind is built once (geometry + materials) and every placed object gets a clone that shares
  // them. userData references are re-pointed into the clone; the few materials animated per object (fading runes,
  // ghosts, glows, the lock star, the glade caps) are cloned for it and disposed with it (userData._own).
  const TPL = {}; const PER_INSTANCE = ['rune', 'glow', 'ghost', 'star', 'caps'];
  let builtMs = 0; // ms spent building templates (exposed for the perf check)
  function template(kind, build) {
    if (TPL[kind]) return TPL[kind];
    const t0 = now(); const g = build ? build() : (PROPS[kind] ? PROPS[kind]() : new THREE.Group()); builtMs += now() - t0; return (TPL[kind] = g);
  }
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  function cloneVis(tpl) {
    const keep = tpl.userData; tpl.userData = {}; let c;
    try { c = tpl.clone(true); } finally { tpl.userData = keep; }
    const a = [], b = []; tpl.traverse(o => a.push(o)); c.traverse(o => b.push(o));
    const ud = {}; for (const k in keep) { const v = keep[k]; const i = v && v.isObject3D ? a.indexOf(v) : -1; ud[k] = i >= 0 ? b[i] : v; }
    const own = []; ud._own = own;
    for (const k of PER_INSTANCE) {
      const v = ud[k]; if (!v) continue;
      if (v.isMaterial) { const m = v.clone(); own.push(m); b.forEach(o => { if (o.material === v) o.material = m; }); ud[k] = m; }
      else if (v.material && !Array.isArray(v.material)) { v.material = v.material.clone(); own.push(v.material); }
    }
    c.userData = ud; return c;
  }
  function disposeVis(m) { if (!m) return; if (m.parent) m.parent.remove(m); const own = m.userData && m.userData._own; if (own) { own.forEach(x => x.dispose && x.dispose()); m.userData._own = []; } if (m.children) m.children.slice().forEach(ch => { if (ch.userData && ch.userData._own) disposeVis(ch); }); }
  S.disposeVisual = g => { if (g && g.children) g.children.slice().forEach(disposeVis); };
  function makeVisual(kind) {
    const g = cloneVis(template(kind));
    const mf = MODEL_FOR[kind];
    if (mf) modelPart(mf[0], mf[1]).then(m => {
      if (!m) return; const old = g.userData[mf[2]]; if (!old) return;
      m.position.copy(old.position); if (mf[2] === 'paper') { m.position.y -= .01; m.rotation.y = .3; } old.visible = false; g.add(m);
    });
    return g;
  }
  // build every template now (init calls it; the game may call it again during its loading screen). With withCopies
  // it returns a group holding one copy of each, e.g. for renderer.compile (dispose it with S.disposeVisual).
  S.prewarm = function (withCopies) {
    if (!has3D()) return null;
    for (const k of Object.keys(PROPS)) if (k !== 'throne' && k !== 'ivy') template(k);
    template('spirit', spiritBody); template('bird', birdBody);
    if (!withCopies) return null;
    const grpAll = new THREE.Group(); for (const k in TPL) grpAll.add(cloneVis(TPL[k]));
    return grpAll;
  };

  // ------------------------------------------------------------------ objects registry built from the data
  const revealed = () => tNow < FX.luz || tNow < FX.rev;
  let tNow = 0;
  const LABEL = { table: 'Ler', lectern: 'Ler', diary: 'Ler', drawing: 'Olhar', sign: 'Ler', stone: 'Olhar', bottle: 'Abrir a garrafa', rune: 'Ler as runas', totem: 'Tocar', letter: 'Pegar a carta' };
  const ICON = { table: '📜', lectern: '📖', diary: '📔', drawing: '🖍️', sign: '🪧', stone: '🪨', bottle: '🍾', rune: '✨', totem: '🗿', letter: '✉️' };
  function buildObjects() {
    OBJ.length = 0; for (const k in OBJ_BY) delete OBJ_BY[k]; for (const k in POI_COUNT) delete POI_COUNT[k];
    for (const n of NOTES) {
      if (!n.poi || n.how === 'bird' || n.how === 'totem') continue;
      const kind = n.how;
      const o = addObj({ id: 'note_' + n.id, note: n.id, poi: n.poi, kind: 'note', vis: kind, off: offFor('note:' + n.poi, n.poi, kind), label: LABEL[kind] || 'Ler', icon: ICON[kind] || '📜' });
      if (n.poi === 'throne') { o.where = () => castleWorld('lectern', 1.0, 'top'); o.visCastle = 'sheet'; } // on the authored stand: only the page
      if (kind === 'rune') { o.can = () => revealed(); o.rune = true; }
      if (n.need) { const need = n.need; o.exists = () => all(need); }
      if (kind === 'bottle') o.float = true;
      // the old book greets her once before she reads its page (the dialog shows first, the note waits in the queue)
      o.act = () => { if (n.id === 'n12' && !met('hermit_book')) { meet('hermit_book'); talk('hermit_book', ['greet']); } readNote(n.id); };
    }
    // guardians
    const gd = (g, p, opt) => addObj(Object.assign({ id: 'g_' + g, guard: g, poi: p, kind: 'guard', off: offFor('g:' + g, p), r: 3.4, noSpread: true, label: 'Tocar', icon: '🗿' }, opt));
    gd('totem_jardim', 'totem_jardim', { act: actGarden, label: () => taskState('k_horta') === 'ready' ? 'Mostrar a colheita' : 'Tocar' });
    gd('windmill', 'windmill_broken', { r: 6, label: 'Examinar', icon: '🌬️', act: actMill });
    gd('tartaruga', 'turtle_shrine', { r: 5, label: 'Falar', icon: '🐢', act: actTurtle });
    gd('rainha_grifo', 'griffin_queen', { r: 6, label: 'Falar', icon: '🪶', act: actQueen, fly: true });
    gd('totem_choro', 'totem_choro', { label: () => inv.count(IT.moonFlower) && !W('altar_1') ? 'Oferecer a flor' : 'Tocar', act: actCry });
    gd('totem_ancestral', 'totem_ancestral', { r: 5, act: actAncestral });
    gd('bigorna', 'royal_forge', { r: 2.8, label: () => P.notes.n08 && !W('forge_key') ? 'Forjar' : 'Examinar', icon: '⚒️', act: actForge });
    gd('espirito_iaque', 'summit_camp', { r: 4.5, label: () => inv.count(IT.soup) && F.vigil && F.vigil.done ? 'Oferecer a sopa' : 'Falar', icon: '🐂', vis: 'spirit', exists: () => !W('altar_4') && (isDusk() || (F.vigil && F.vigil.done && isSunrise())), act: actYak });
    // windmill repair spots
    const MILL = [[-2.4, 4.2], [2.4, 4.2], [-3.6, 2.2], [3.6, 2.2]];
    MILL.forEach((o2, i) => addObj({ id: 'mill_' + i, poi: 'windmill_broken', off: o2, noSpread: true, kind: 'spot', vis: 'millPart', ry: i < 2 ? 0 : Math.PI / 2, r: 2.2,
      exists: () => met('windmill') || !!W('windmill'), can: () => !millDone(i), label: 'Consertar', icon: '🔨', act: () => millFix(i) }));
    // reeds and lotus at the shrine
    for (let i = 0; i < CFG.reeds; i++) { const a = -1.2 + i * .48; addObj({ id: 'reed_' + i, poi: 'turtle_shrine', off: [Math.sin(a) * 7, Math.cos(a) * 7], noSpread: true, kind: 'spot', vis: 'reeds', r: 2,
      exists: () => met('tartaruga') && !(((W('shrine') || {}).reeds | 0) & (1 << i)), label: 'Cortar', icon: '🌾', act: () => shrineSet('reeds', i) }); }
    for (let i = 0; i < CFG.lotus; i++) { const a = -.5 + i * .5; addObj({ id: 'lotus_' + i, poi: 'turtle_shrine', off: [Math.sin(a) * 4.2, Math.cos(a) * 4.2], noSpread: true, kind: 'spot', vis: 'pad', r: 2, float: true,
      exists: () => met('tartaruga'), can: () => !(((W('shrine') || {}).lotus | 0) & (1 << i)), label: 'Plantar lótus', icon: '🪷', act: () => plantLotus(i) }); }
    // golden feathers (per player)
    for (let i = 1; i <= 3; i++) addObj({ id: 'feather_' + i, poi: 'feather_' + i, kind: 'pick', vis: 'feather', dy: .9, fly: false, noSpread: true, exists: () => !(F.feath && F.feath[i]), label: 'Pegar', icon: '🪶', act: () => pickFeather(i) });
    // lights that float in place (2 = glade, 5 = nest); 1, 3, 4 are granted by their guardian / chest
    addObj({ id: 'stand_2', poi: 'lunar_glade', kind: 'decor', vis: 'altar', noSpread: true });
    addObj({ id: 'stand_5', poi: 'griffin_nest', kind: 'decor', vis: 'altar', noSpread: true });
    addObj({ id: 'altar_2', poi: 'lunar_glade', kind: 'pick', vis: 'star', dy: 1.3, noSpread: true, exists: () => !W('altar_2') && F.glade && isNight(), label: 'Pegar a luz', icon: '✨', act: () => grantFragment(2) });
    addObj({ id: 'glade_ring', poi: 'lunar_glade', kind: 'decor', vis: 'mushrooms', noSpread: true, exists: () => isNight() });
    addObj({ id: 'altar_5', poi: 'griffin_nest', kind: 'pick', vis: 'star', dy: 1.1, noSpread: true, exists: () => !W('altar_5'), label: 'Pegar a luz', icon: '✨', act: () => grantFragment(5) });
    addObj({ id: 'bay_chest', poi: 'bay_chest', kind: 'pick', vis: 'chest', noSpread: true, r: 3.2, under: true, exists: () => !W('altar_3') && !!W('lighthouse'), label: 'Abrir', icon: '🧰', act: openChest });
    // lighthouse lamp (position comes from the build records)
    addObj({ id: 'lamp', kind: 'spot', dynamic: true, where: () => lh.lamp ? { x: lh.lamp.x, y: lh.lamp.y, z: lh.lamp.z, ry: 0 } : null, r: 3, exists: () => !!lh.lamp && lh.tall && !W('lighthouse') && !lh.lamp.lit, label: 'Acender o farol', icon: '🔥', act: lightLamp });
    // gate lock and the seat in the keep
    addObj({ id: 'lock', poi: 'castle_gate', kind: 'spot', vis: 'lockDisc', off: OFF.lock, noSpread: true, r: 4, where: () => castleWorld('star_lock', 0), visCastle: null, keepVis: true, exists: () => true, can: () => !W('gate') && starInBag(), label: 'Destrancar', icon: '✧', act: openGate });
    addObj({ id: 'throne', poi: 'throne', kind: 'spot', vis: 'throneSet', noSpread: true, r: 3.2, where: () => castleWorld('throne', 0), keepVis: true, exists: () => true,
      can: () => learned('despertar') || !!W('awake') || !!F.seenEnd, label: () => F.seenEnd ? 'Lembrar' : learned('despertar') ? T('spells.despertar.name', '…') : 'Olhar', icon: '✦', act: actThrone });
  }
  // world spot of a named piece of the authored keep (hook L.castleObj from the game). Pieces exported with their pivot
  // at the model origin (geometry baked in place) are located by their bounds instead: centre, and the bottom (or the
  // top with mode 'top', e.g. the reading surface).
  function castleWorld(name, dy, mode) {
    if (!L.castleObj || typeof THREE === 'undefined') return null; let o = null; try { o = L.castleObj(name); } catch (e) { } if (!o || !o.getWorldPosition) return null;
    o.updateMatrixWorld(true); const v = o.getWorldPosition(new THREE.Vector3()); const q = o.getWorldQuaternion(new THREE.Quaternion()); const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const b = new THREE.Box3().setFromObject(o);
    if (!b.isEmpty()) { const c = b.getCenter(new THREE.Vector3()); if (Math.hypot(c.x - v.x, c.z - v.z) > 3) return { x: c.x, y: mode === 'top' ? b.max.y : b.min.y, z: c.z, ry: e.y, obj: o, baked: true }; }
    return { x: v.x, y: v.y + (dy || 0), z: v.z, ry: e.y, obj: o };
  }
  const exists = o => (!o.exists || o.exists());
  const canUse = o => exists(o) && (!o.can || o.can());

  // ------------------------------------------------------------------ interaction API (TECH §6)
  S.interactables = function (x, z, r, y) {
    const out = []; if (!P) return out;
    for (const o of OBJ) {
      if (!o.act || !canUse(o)) continue; const p = resolve(o); if (!p) continue;
      const py = o.mesh && o.float ? o.mesh.position.y : p.y;
      if (y != null && Math.abs(py - y) > (o.id === 'bay_chest' ? 8 : 4.5)) continue;
      const d = hyp(x, z, p.x, p.z); if (d > Math.min(Math.max(r || 0, o.r), o.r + CFG.reach)) continue; // never farther than S.interact accepts
      out.push({ id: o.id, x: p.x, y: py, z: p.z, label: typeof o.label === 'function' ? o.label() : o.label, icon: o.icon, d, kind: o.kind });
    }
    for (const b of BIRDS) if (b.letter && b.state === 'wait') { const d = hyp(x, z, b.lx, b.lz); if (d <= Math.min(Math.max(r || 0, 2.6), 2.6 + CFG.reach)) out.push({ id: 'mail_' + b.note, x: b.lx, y: b.ly, z: b.lz, label: LABEL.letter, icon: ICON.letter, d, kind: 'note' }); }
    return out.sort((a, b) => a.d - b.d);
  };
  // she must be within the object's radius (+ CFG.reach) and roughly at its height; tests use S.debug.force(id)
  function interactAt(id, force) {
    if (!P || S.busy) return false;
    const me = L.P || MEM.pos || PL; const mx = me.x, mz = me.z, my = me.y;
    if (/^mail_/.test(id)) {
      const b = BIRDS.find(q => 'mail_' + q.note === id && q.letter && q.state === 'wait'); if (!b) return false;
      if (!force && !(hyp(mx, mz, b.lx, b.lz) <= 2.6 + CFG.reach)) return false; pickLetter(b); return true;
    }
    const o = OBJ_BY[id]; if (!o || !canUse(o)) return false;
    if (!force) {
      const p = resolve(o); if (!p) return false; const py = o.mesh && o.float ? o.mesh.position.y : p.y;
      if (!(hyp(mx, mz, p.x, p.z) <= o.r + CFG.reach)) return false;
      if (my != null && my === my && Math.abs(py - my) > (o.id === 'bay_chest' ? 9 : 6)) return false;
    }
    o.act && o.act(); needEval = true; return true;
  }
  S.interact = id => interactAt(id, false);

  // ------------------------------------------------------------------ guardians and trials
  function actGarden() {
    const st = taskState('k_horta'); meet('totem_jardim'); updateTasks();
    if (st === 'done') return talk('totem_jardim', ['greet']);
    if (taskState('k_horta') === 'ready') { talk('totem_jardim', ['done']); finishTask('k_horta'); return; }
    talk('totem_jardim', ['greet', 'task']);
  }
  const millDone = i => !!((W('windmill') || {}).p || [])[i];
  function actMill() {
    meet('windmill'); updateTasks();
    if (mill() >= 4) { if (taskState('k_moinho') !== 'done') { talk('windmill', ['done']); finishTask('k_moinho'); } else talk('windmill', ['greet']); return; }
    talk('windmill', ['greet']);
  }
  function millFix(i) {
    const [w, r] = CFG.millCost[i];
    if (inv.count(IT.wood) < w || inv.count(IT.rope) < r) { emit('need', { items: [[IT.wood, w], [IT.rope, r]] }); return; }
    inv.take(IT.wood, w); inv.take(IT.rope, r);
    const cur = W('windmill') || { p: [0, 0, 0, 0] }; const p = (cur.p || [0, 0, 0, 0]).slice(); p[i] = 1; setW('windmill', stamp({ p }));
    emit('sfx', 'build'); fxBurst(OBJ_BY['mill_' + i], 0xfff1c8, 14);
    if (p.filter(Boolean).length >= 4) { worldEvent('windmill_fixed', {}); talk('windmill', ['done']); finishTask('k_moinho'); }
    needEval = true;
  }
  function shrineSet(kind, i) { const cur = Object.assign({}, W('shrine') || {}); cur[kind] = (cur[kind] | 0) | (1 << i); setW('shrine', stamp(cur)); emit('sfx', 'cut'); needEval = true; }
  function plantLotus(i) {
    const seed = inv.count(IT.lotusSeed) ? IT.lotusSeed : inv.count(IT.lotus) ? IT.lotus : null;
    if (!seed) { emit('need', { items: [[IT.lotusSeed, 1]] }); return; }
    inv.take(seed, 1); shrineSet('lotus', i);
  }
  function actTurtle() {
    const first = !met('tartaruga'); meet('tartaruga'); updateTasks();
    const st = taskState('k_lago');
    if (st === 'done') return talk('tartaruga', ['greet']);
    if (st === 'ready') { talk('tartaruga', ['done']); finishTask('k_lago'); return; }
    talk('tartaruga', ['greet', 'task']);
    if (first && !F.lotusGift) { F.lotusGift = 1; inv.give(IT.lotusSeed, CFG.lotus); }
  }
  function pickFeather(i) { F.feath = F.feath || {}; F.feath[i] = 1; inv.give(IT.feather, 1); changed(); fxBurst(OBJ_BY['feather_' + i], 0xffd77a, 18); emit('sfx', 'pick'); say(T('ui.feather_name'), '🪶'); }
  function actQueen() {
    meet('rainha_grifo'); updateTasks(); const st = taskState('k_penas');
    if (st === 'done') return talk('rainha_grifo', ['greet']);
    if (inv.count(IT.feather) >= CFG.feathers) { inv.take(IT.feather, CFG.feathers); talk('rainha_grifo', ['done']); finishTask('k_penas'); return; }
    talk('rainha_grifo', ['greet', 'task']);
  }
  function actCry() {
    meet('totem_choro'); updateTasks();
    if (W('altar_1')) return talk('totem_choro', ['greet']);
    if (inv.take(IT.moonFlower, 1)) { talk('totem_choro', ['done']); const o = OBJ_BY.g_totem_choro, p = resolve(o); const off = OFF['altar:1']; grantFragment(1, p && { x: p.x + Math.sin(p.ry) * off[1], y: p.y + .2, z: p.z + Math.cos(p.ry) * off[1] }); return; }
    talk('totem_choro', ['greet']);
  }
  function actYak() {
    meet('espirito_iaque'); updateTasks();
    if (W('altar_4')) return talk('espirito_iaque', ['greet']);
    if (F.vigil && F.vigil.done && isSunrise() && inv.take(IT.soup, 1)) { talk('espirito_iaque', ['done']); const p = resolve(OBJ_BY.g_espirito_iaque); grantFragment(4, p && { x: p.x, y: p.y + 2.2, z: p.z }); return; }
    talk('espirito_iaque', ['greet', 'task']);
  }
  function actAncestral() {
    meet('totem_ancestral'); updateTasks();
    if (learned('revelar')) return talk('totem_ancestral', ['greet']);
    if (!hasStar()) return talk('totem_ancestral', ['greet', 'wait']);
    readNote('n10', { then: () => { talk('totem_ancestral', ['done']); } });
    finishTask('k_ver');
  }
  function actForge() {
    meet('bigorna'); updateTasks();
    if (W('forge_key')) return talk('bigorna', ['greet']);
    if (!P.notes.n08) return talk('bigorna', ['greet', 'wait']);
    const d = Object.assign({ f: 0, o: 0, c: 0 }, W('forge') || {}); const need = CFG.forge; let put = 0;
    const dep = (id, k, max) => { const n = Math.min(inv.count(id), max - d[k]); if (n > 0 && inv.take(id, n)) { d[k] += n; put += n; } };
    dep(IT.frag, 'f', need.fragmento); dep(IT.gold, 'o', need.ouro); dep(IT.crystal, 'c', need.cristal);
    if (put) setW('forge', stamp(d));
    if (d.f >= need.fragmento && d.o >= need.ouro && d.c >= need.cristal) {
      talk('bigorna', ['done']); setW('forge_key', stamp()); inv.give(IT.star, 1); fxBurst(OBJ_BY.g_bigorna, 0xffc46a, 40); emit('sfx', 'forge');
      finishTask(FORGE_TASK); say(T(LP.starName), '✧');
    } else { talk('bigorna', ['wait']); emit('forge', { f: d.f, o: d.o, c: d.c, need }); }
    needEval = true;
  }
  function grantFragment(k, from) {
    if (W('altar_' + k)) return;
    setW('altar_' + k, stamp()); inv.give(IT.frag, 1); progressMade();
    const o = OBJ_BY['altar_' + k]; const p = from || (o && resolve(o)) || PL;
    flyStar(p, k); emit('fragment', { k, n: fragCount(), text: T('ui.frag_got') }); emit('sfx', 'star'); needEval = true;
    worldEvent('altar', { k });
  }
  function openChest() {
    const o = OBJ_BY.bay_chest; if (o.mesh && o.mesh.userData.lid) o.lidT = 0;
    const p = resolve(o); grantFragment(3, p && { x: p.x, y: (o.mesh ? o.mesh.position.y : p.y) + .5, z: p.z });
  }
  function openGate() {
    if (W('gate')) return; if (inv.count(IT.star)) inv.take(IT.star, 1);
    setW('gate', stamp()); emit('sfx', 'gate'); progressMade(); worldEvent('gate_open', {});
  }
  // per player: her first time is her own (rewards), even when the partner woke him first; then it is a memory
  function actThrone() {
    if (S.endingOn) return false;
    if (F.seenEnd) return S.playEnding({ replay: true });
    if (W('awake')) return S.playEnding(learned('despertar') ? null : { replay: true });
    return tryAwaken();
  }
  function tryAwaken() {
    const o = OBJ_BY.throne, p = resolve(o); if (!p || hyp(PL.x, PL.z, p.x, p.z) > 7) { say(T('spells.despertar.desc'), '✦'); return false; }
    if (F.seenEnd || W('awake')) return actThrone();
    if (!learned('despertar') || !starUsable()) return false;
    if (!isDawn()) { emit('dialog', { gid: 'throne', name: '', lines: [T('ui.need_dawn')] }); return false; }
    return S.playEnding();
  }

  // ------------------------------------------------------------------ world flags from anyone (L.save.on('w5'))
  function onWorld(id, d, local) {
    needEval = true;
    if (id === 'gate' && d) doorT = doorT == null ? (local ? 0 : (S.near('castle_gate', 200) ? 0 : 8)) : doorT;
    if (id === 'awake' && d && !local && !S.endingOn) restoreT = 0;
    if (/^altar_/.test(id) && d && !local) { const o = OBJ_BY[id]; if (o && o.mesh) o.mesh.visible = false; }
  }
  function worldEvent(name, d) { if (L.storyWorldEvent) { try { L.storyWorldEvent(name, d); } catch (e) { console.warn(e); } } emit('world', { name, d }); }
  S.near = (poiId, r) => { const p = poi(poiId); return !!p && hyp(PL.x, PL.z, p.x, p.z) < r; };

  // ------------------------------------------------------------------ game events (TECH §6)
  S.event = function (name, d) {
    d = d || {}; if (!P) bindPlayer();
    switch (name) {
      case 'fire_lit': if (d.poi === 'cottage' || nearPoi('cottage', d, 10)) setF('fire_cottage'); if (lh.lamp && (d.poi === 'lighthouse' || hyp(d.x, d.z, lh.lamp.x, lh.lamp.z) < 4)) lightLamp(); break;
      case 'slept': inc('slept'); setF('slept_once'); pendingDream = nextDream(); sleepVigil(); wokeWait = 4; break;
      case 'woke': wakeUp(); break;
      case 'built': { inc('built'); const pc = String(d.piece || d.t || ''); if (/roof|telhado|cottage_roof/.test(pc)) inc('roofs'); if (/wall|parede|window|doorway|janela/.test(pc)) inc('walls');
        if ((F.walls || 0) >= 4 && (F.roofs || 0) >= 1 || /cottage_roof/.test(pc) || (F.built || 0) >= 12) setF('home_built'); lhCheckT = 0; break; }
      case 'harvest': if (d.crop) { inc('harvest'); if (d.own !== false) inc('harvest_own'); } break;
      case 'cooked': inc('cooked'); break;
      case 'ate': inc('ate'); break;
      case 'tamed': inc('tames'); if (d.species === 'cervo_lunar') deerFed(true); break;
      case 'fed': if (d.species === 'cervo_lunar') deerFed(false); break;
      case 'planted': if (/l[oó]tus/.test(d.crop || '') && nearPoi('turtle_shrine', d, 40)) { const w = W('shrine') || {}; const free = [0, 1, 2].find(i => !((w.lotus | 0) & (1 << i))); if (free != null) shrineSet('lotus', free); } if (d.crop === 'flor_lua' || d.crop === 'lua') setF('moon_planted'); break;
      case 'cut': if (nearPoi('turtle_shrine', d, 30) && /reed|junco/.test(d.res || '')) { const w = W('shrine') || {}; const free = [0, 1, 2, 3, 4, 5].find(i => !((w.reeds | 0) & (1 << i))); if (free != null) shrineSet('reeds', free); } break;
      case 'interact': if (d.poiId) { F.seen = F.seen || {}; F.seen[d.poiId] = 1; changed(); } break;
      case 'enter_region': F.reg = F.reg || {}; if (!F.reg[d.region]) { F.reg[d.region] = 1; changed(); } break;
      case 'item': break;
      case 'castle_ready': case 'colliders': S.invalidate(); break;
      case 'spell': break;
    }
    needEval = true;
  };
  function nearPoi(id, d, r) { const p = poi(id); return !!p && d && d.x != null && hyp(d.x, d.z, p.x, p.z) < r; }
  function deerFed(tamed) {
    if (!isNight() && !tamed) return;
    const first = !met('cervo_lunar'); meet('cervo_lunar'); if (first) talk('cervo_lunar', ['greet']);
    const nid = nightId(); F.deer = F.deer || []; if (F.deer.indexOf(nid) < 0) { F.deer.push(nid); changed(); }
    if (tamed) while (F.deer.length < CFG.deerNights) F.deer.push('t' + F.deer.length);
    updateTasks();
  }

  // ------------------------------------------------------------------ sleep, dreams, vigil
  let pendingDream = null, wokeWait = 0;
  function wakeUp() {
    wokeWait = 0;
    if (F.vigil && F.vigil.slept && !F.vigil.done) { F.vigil.done = true; changed(); }
    if (pendingDream) { const id = pendingDream; pendingDream = null; showDream(id); }
    else if (F.hintDream) { F.hintDream = 0; changed(); const txt = hintText(); if (txt) emit('dream', { id: 'hint', text: txt, soft: true }); }
  }
  // 'slept' arrives when the night is over (SYSTEMS sends it at dawn). Sleeping through at the camp, under a roof and by
  // a burning fire, counts as the whole night only if this night's vigil began at nightfall there (vigilTick opens it
  // between 18:00 and 22:30 and drops it when she leaves): lying down at 05:00 does not count.
  function sleepVigil() {
    if (W('altar_4') || !taskState('f4') || (F.vigil && F.vigil.done)) return;
    const V = F.vigil;
    if (V && V.night === nightId() && vigilGood()) { V.slept = true; V.done = true; changed(); emit('vigil', { done: true }); }
  }
  function vigilGood() {
    const p = poi('summit_camp'); if (!p) return false; if (hyp(PL.x, PL.z, p.x, p.z) > CFG.summitR) return false;
    const sh = L.isSheltered ? L.isSheltered(PL.x, PL.y, PL.z) : false, fire = L.nearFire ? L.nearFire(PL.x, PL.y, PL.z) : false;
    return !!sh && !!fire;
  }
  function vigilTick(dt) {
    if (W('altar_4') || !taskState('f4')) return;
    let V = F.vigil;
    if (V && V.done) return;
    const good = vigilGood(), h = hours();
    if (isNight()) {
      if (!V || V.night !== nightId()) { if (good && (h >= CFG.night[0] && h < 22.5)) { F.vigil = { night: nightId(), ok: 0, bad: 0 }; changed(); } return; }
      if (good) { V.ok += dt; V.bad = 0; } else { V.bad += dt; if (V.bad > CFG.vigilGrace) { F.vigil = null; changed(); emit('vigil', { broken: true }); } }
    } else if (V && h >= CFG.night[1] && h < CFG.sunrise[1] && V.ok > 30) { V.done = true; changed(); emit('vigil', { done: true }); }
    else if (V && !isNight() && !V.done) { F.vigil = null; changed(); }
  }

  // ------------------------------------------------------------------ lighthouse (f3): build records near the POI
  let lhCheckT = 0;
  const PIECE_H = { foundation: 1, floor: .3, wall: 3, doorway: 3, window: 3, wall_half: 1.5, gable: 2, roof: 2, stairs: 3, pillar: 3, tower: 3, tower_roof: 3, chimney: 3, fence: 1.2, deck: .3 };
  function lhCheck() {
    const p = poi('lighthouse'); lh.tall = false; lh.lamp = null; lh.h = 0; if (!p || !L.storyBuilds) return;
    let recs; try { recs = L.storyBuilds() || []; } catch (e) { recs = []; }
    const gy = groundY(p.x, p.z, p.y || 0); let top = gy;
    for (const r of recs) {
      if (!r || hyp(r.x, r.z, p.x, p.z) > 9) continue;
      const h = r.h != null ? r.h : (PIECE_H[r.t] != null ? PIECE_H[r.t] : 1.5); top = Math.max(top, r.y + h);
      if (CFG.lampTypes.indexOf(r.t) >= 0 && r.y - gy >= CFG.towerH - 1.2 && (!lh.lamp || r.y > lh.lamp.y)) lh.lamp = { x: r.x, y: r.y, z: r.z, id: r.id, lit: !!r.lit };
    }
    lh.h = top - gy; lh.tall = lh.h >= CFG.towerH;
    if (lh.lamp && lh.lamp.lit && lh.tall && isNight() && !W('lighthouse')) lightLamp();
    needEval = true;
  }
  function lightLamp() {
    if (W('lighthouse') || !lh.lamp || !lh.tall) return;
    if (!isNight()) { emit('hint', 'night'); return; }
    setW('lighthouse', stamp({ x: lh.lamp.x, y: lh.lamp.y, z: lh.lamp.z })); emit('sfx', 'lamp'); worldEvent('lighthouse_lit', {}); needEval = true;
  }

  // ------------------------------------------------------------------ spells
  const FX = { luz: 0, rev: 0, mare: 0, warm: 0 };
  const CD = {};
  // cooldowns and effect timers also live in the player record as wall-clock end times (F.cdw / F.fxw), so a reload
  // neither resets a cooldown nor drops an active effect (e.g. Revelar while inside the white)
  function setFx(k, sec) { FX[k] = tNow + sec; if (F) { (F.fxw = F.fxw || {})[k] = wall() + sec * 1000; changed(); } }
  function setCd(id, sec) { CD[id] = tNow + sec; if (F && sec > 0) { (F.cdw = F.cdw || {})[id] = wall() + sec * 1000; changed(); } }
  function restoreTimers() {
    const w = wall();
    for (const [src, dst] of [[F.fxw, FX], [F.cdw, CD]]) {
      if (!src || typeof src !== 'object') continue;
      for (const k in src) { const left = (src[k] - w) / 1000; if (left > 0 && left < 3600) dst[k] = tNow + left; else { delete src[k]; if (dst === FX) dst[k] = 0; } }
    }
  }
  const mana = {
    st() { return L.save && L.save.player && L.save.player.st; },
    get() { const sv = L.surv; if (sv && typeof sv.mana === 'number') return sv.mana; if (sv && typeof sv.mana === 'function') return sv.mana(); const st = this.st(); if (st && typeof st.mana === 'number') return st.mana; return MEM.mana; },
    use(n) { if (!n) return; if (L.surv && L.surv.useMana) return L.surv.useMana(n); const st = this.st(); if (st && typeof st.mana === 'number') { st.mana = Math.max(0, st.mana - n); dirty(); } else MEM.mana = Math.max(0, MEM.mana - n); },
  };
  S.mana = () => mana.get();
  S.spellView = function () {
    if (!P) return [];
    return SPELLS.filter(s => learned(s.id)).map(s => ({ id: s.id, name: T('spells.' + s.id + '.name'), desc: T('spells.' + s.id + '.desc'), mana: s.mana || 0, cd: s.cd || 0, passive: !!s.passive,
      left: Math.max(0, (CD[s.id] || 0) - tNow), active: Math.max(0, s.id === 'luz' ? FX.luz - tNow : s.id === 'revelar' ? FX.rev - tNow : s.id === 'mare' ? FX.mare - tNow : s.id === 'ponte' && bridge ? bridge.end - tNow : 0), ok: mana.get() >= (s.mana || 0) }));
  };
  Object.defineProperty(S, 'spells', { get: () => (P ? SPELLS.filter(s => learned(s.id)).map(s => s.id) : []) });
  S.castSpell = function (id, ctx) {
    if (!P || S.busy) return { ok: false, why: 'busy' };
    const sp = SPELL[id]; if (!sp || !learned(id)) return { ok: false, why: 'unknown' };
    if (sp.passive) return { ok: false, why: 'passive' };
    if ((CD[id] || 0) > tNow) return { ok: false, why: 'cd', left: CD[id] - tNow };
    if (mana.get() < (sp.mana || 0)) { emit('nomana', id); return { ok: false, why: 'mana' }; }
    const c = Object.assign({ x: PL.x, y: PL.y, z: PL.z }, ctx || {}); const [yaw, pitch] = camYawPitch(); if (c.yaw == null) c.yaw = yaw; if (c.pitch == null) c.pitch = pitch;
    const r = SPELL_FX[id] ? SPELL_FX[id](c) : true; if (r === false) return { ok: false, why: 'place' };
    mana.use(sp.mana || 0); setCd(id, sp.cd || 0);
    if (L.onSpell) L.onSpell(id); emit('cast', { id }); emit('sfx', 'spell_' + id);
    return { ok: true };
  };
  const SPELL_FX = {
    faisca(c) { let lit = false; if (L.lightFireNear) lit = !!L.lightFireNear(c.x, c.z, 6); setFx('warm', 60); if (L.surv && L.surv.warm) L.surv.warm(60); sparks(c, 0xffa040, 26); if (lit) S.event('fire_lit', { x: c.x, z: c.z }); return true; },
    brotar(c) { if (L.farm && L.farm.boost) L.farm.boost(c.x, c.z, 4); sparks(c, 0x9fe070, 30); return true; },
    luz() { setFx('luz', 90); return true; },
    mare(c) { setFx('mare', 20); if (L.farm) { if (L.farm.waterArea) L.farm.waterArea(c.x, c.z, 8); else if (L.farm.water) L.farm.water({ x: c.x, z: c.z, r: 8 }); } sparks(c, 0x7fd0ff, 30); return true; },
    ponte(c) { return makeBridge(c); },
    revelar() { setFx('rev', 60); if (inMist(PL.x, PL.z) > 0 || distMistEdge() < 400) openPath(); return true; },
    despertar() { return tryAwaken(); },
  };
  S.mods = function () {
    const b = !!(P && learned('brisa'));
    return { doubleJump: b, glide: b, waterWalk: tNow < FX.mare, warm: tNow < FX.warm, light: tNow < FX.luz, reveal: tNow < FX.rev };
  };

  // ------------------------------------------------------------------ the white cloud region
  const M = () => L.MIST || null;
  function inMist(x, z) { if (L.inMist) return L.inMist(x, z) || 0; const m = M(); if (!m) return 0; return clamp((m.r - hyp(x, z, m.x, m.z)) / m.r, 0, 1); }
  function distMistEdge() { const m = M(); return m ? Math.max(0, hyp(PL.x, PL.z, m.x, m.z) - m.r) : Infinity; }
  function clearZone(x, z) { const c = poi('castle'); return !!c && hyp(x, z, c.x, c.z) < CFG.clearR; }
  let pass = false;
  S.mistBlock = function (x, z) { if (W('awake')) return false; if (inMist(x, z) <= 0) return false; if (clearZone(x, z)) return false; if (pass || tNow < FX.rev) return false; return true; };
  const MS = { white: 0, phase: 0, t: 0, line: null, safe: null, entry: null, open: 0, pts: null, sprites: [] };
  function mistTick(dt) {
    const m = M(); if (!m || W('awake')) { if (MS.white > 0) { MS.white = Math.max(0, MS.white - dt); whiteOut(MS.white, null); } closePath(dt); return; }
    const x = PL.x, z = PL.z, depth = inMist(x, z), revOn = tNow < FX.rev;
    if (depth <= 0) { pass = false; MS.safe = [x, PL.y, z]; MS.entry = null; }
    else if (clearZone(x, z)) MS.safe = [x, PL.y, z];
    if (depth > 0 && revOn) { pass = true; if (!MS.entry) MS.entry = MS.safe ? MS.safe.slice() : [x, PL.y, z]; }
    if (MS.phase === 0) {
      const blocked = S.mistBlock(x, z);
      const into = blocked ? (m.r - hyp(x, z, m.x, m.z)) : 0;
      const want = blocked ? clamp(into / CFG.mistRamp, 0, 1) : 0;
      MS.white = want > MS.white ? Math.min(want, MS.white + dt * 1.5) : Math.max(want, MS.white - dt * .8);
      if (blocked && MS.white > .3 && !MS.line) { const ls = TL('mist') || []; MS.line = ls.length ? ls[(F.mistN = ((F.mistN || 0) + 1)) % ls.length] : ''; emit('sfx', 'whisper'); }
      if (!blocked && MS.white < .05) MS.line = null;
      whiteOut(MS.white, MS.white > .3 ? MS.line : null);
      if (blocked && MS.white >= .999) { MS.phase = 1; MS.t = 0; }
    } else if (MS.phase === 1) {
      MS.t += dt; whiteOut(1, MS.line);
      if (MS.t > .9) { const s = safePoint(); teleport(s[0], s[1], s[2]); MS.phase = 2; MS.t = 0; }
    } else if (MS.phase === 2) {
      MS.t += dt; MS.white = Math.max(0, 1 - MS.t / 1.8); whiteOut(MS.white, MS.t < 1 ? MS.line : null);
      if (MS.t > 1.8) { MS.phase = 0; MS.line = null; }
    }
    // the path of lights while the word of seeing is active
    if (revOn && (depth > 0 || distMistEdge() < 400)) openPath(); else if (!pass) closePath(dt);
    if (MS.open > 0) MS.open = Math.min(1, MS.open + dt * .5);
    if (pass && depth > .1 && !F.castle_seen && !S.endingOn && !shot) revealShot();
  }
  // the white veil goes to the UI only when it changes (not every frame)
  let whiteA = 0, whiteTx = null;
  function whiteOut(a, text) {
    text = text || null; if (Math.abs(a - whiteA) < .01 && (a > 0) === (whiteA > 0) && (a >= 1) === (whiteA >= 1) && text === whiteTx) return;
    whiteA = a; whiteTx = text; emit('white', { a, text });
  }
  function safePoint() {
    const m = M(); let s = MS.safe;
    if (!s || inMist(s[0], s[2]) > 0) { // returned from inside: put her just outside, on her way out
      const a = Math.atan2(PL.x - m.x, PL.z - m.z), r = m.r + 12, x = m.x + Math.sin(a) * r, z = m.z + Math.cos(a) * r; s = [x, groundY(x, z, PL.y) + .2, z];
    }
    return s;
  }
  function openPath() {
    const m = M(), g = poi('castle_gate') || poi('castle'); if (!m || !g) return;
    if (!MS.pts) {
      const a = Math.atan2(PL.x - m.x, PL.z - m.z); const sx = m.x + Math.sin(a) * (m.r + 20), sz = m.z + Math.cos(a) * (m.r + 20);
      const n = Math.max(8, Math.round(hyp(sx, sz, g.x, g.z) / 18)); const pts = [];
      const px = -(g.z - sz), pz = g.x - sx, pl = Math.hypot(px, pz) || 1;
      for (let i = 0; i <= n; i++) { const t = i / n, bend = Math.sin(t * Math.PI) * 60 * Math.sin(a * 3); const x = lerp(sx, g.x, t) + px / pl * bend, z = lerp(sz, g.z, t) + pz / pl * bend, y = groundY(x, z) + 1.6; pts.push(typeof THREE !== 'undefined' ? new THREE.Vector3(x, y, z) : { x, y, z }); }
      MS.pts = pts; if (!F.pathSeen) { F.pathSeen = 1; changed(); emit('caption', { text: T('ui.reveal') }); }
    }
    if (MS.open === 0) MS.open = .01;
    if (L.mistVisual && L.mistVisual.open) L.mistVisual.open(MS.open, MS.pts);
  }
  function closePath(dt) {
    if (MS.open <= 0) return; MS.open = Math.max(0, MS.open - dt * .35);
    if (L.mistVisual && L.mistVisual.open) L.mistVisual.open(MS.open, MS.pts);
    if (MS.open <= 0) MS.pts = null;
  }
  S.mistState = () => ({ white: MS.white, pass, open: MS.open, pts: MS.pts ? MS.pts.length : 0, phase: MS.phase });

  // ------------------------------------------------------------------ camera shots (game applies S.camera when set)
  let shot = null;
  S.camera = null;
  Object.defineProperty(S, 'busy', { get: () => MS.phase > 0 || !!shot || !!EN });
  function setCam(px, py, pz, tx, ty, tz, fov) {
    S.camera = { p: [px, py, pz], t: [tx, ty, tz], fov: fov || null };
    if (L.DBG) L.DBG.cam = { p: [px, py, pz], t: [tx, ty, tz] };
  }
  function clearCam() { S.camera = null; if (L.DBG && L.DBG.cam) L.DBG.cam = null; }
  function revealShot() {
    const c = poi('castle'); if (!c) { setF('castle_seen'); return; }
    const a = Math.atan2(c.x - PL.x, c.z - PL.z); const dist = hyp(PL.x, PL.z, c.x, c.z);
    shot = { t: 0, dur: 7.5, a, x0: PL.x, y0: PL.y, z0: PL.z, c, dist };
    emit('reveal', { on: true }); emit('sfx', 'reveal');
  }
  function shotTick(dt) {
    if (!shot) return; shot.t += dt; const s = shot, u = s.t / s.dur, e = sstep(0, 1, u);
    const back = lerp(6, 14, e), up = lerp(3, 18, e);
    const px = s.x0 - Math.sin(s.a) * back, pz = s.z0 - Math.cos(s.a) * back;
    setCam(px, s.y0 + up, pz, s.c.x, (s.c.y || groundY(s.c.x, s.c.z)) + lerp(20, 45, e), s.c.z, 50);
    if (s.t >= s.dur) { shot = null; clearCam(); setF('castle_seen'); emit('reveal', { on: false }); progressMade(); }
  }

  // ------------------------------------------------------------------ paper birds: letters and the stuck helper
  const BIRDS = []; let birdCD = 12;
  function mailTick() {
    if (S.busy || S.uiOpen || BIRDS.some(b => b.letter)) return;
    if (birdCD > 0) return;
    for (const n of NOTES) {
      if (n.how !== 'bird' || P.notes[n.id] || !all(n.need)) continue;
      launchBird({ note: n.id }); birdCD = CFG.birdEvery; return;
    }
  }
  function launchBird(o) {
    const a = Math.random() * TAU; const b = Object.assign({ x: PL.x + Math.sin(a) * 70, y: PL.y + 45, z: PL.z + Math.cos(a) * 70, vx: 0, vy: 0, vz: 0, state: 'in', t: 0, flap: 0, letter: !!o.note, ry: 0 }, o);
    b.mesh = has3D() ? makeBird() : null; if (b.mesh) { b.mesh.position.set(b.x, b.y, b.z); L.scene.add(b.mesh); }
    BIRDS.push(b); emit('sfx', 'bird'); return b;
  }
  function pickLetter(b) { b.state = 'away'; b.t = 0; b.letter = false; if (b.lmesh) { disposeVis(b.lmesh); b.lmesh = null; } readNote(b.note); emit('sfx', 'pick'); }
  function birdSteer(b, tx, ty, tz, sp, dt, k) {
    const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z, d = Math.hypot(dx, dy, dz) || 1;
    const want = Math.min(sp, d * 1.5 + .2);
    b.vx = lerp(b.vx, dx / d * want, clamp(dt * (k || 2.2), 0, 1)); b.vy = lerp(b.vy, dy / d * want, clamp(dt * (k || 2.2), 0, 1)); b.vz = lerp(b.vz, dz / d * want, clamp(dt * (k || 2.2), 0, 1));
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; return d;
  }
  function birdTick(b, dt) {
    b.t += dt; let flapHz = 9;
    if ((b.state === 'in' || b.state === 'circle' || b.state === 'land') && hyp(PL.x, PL.z, b.x, b.z) > 300) { // she travelled far away: try again later
      if (b.onArrive === 'guide') guideLeave(b); else { b.state = 'away'; b.t = 0; } if (b.letter) { b.letter = false; birdCD = 30; }
    }
    if (b.state === 'in') { const d = birdSteer(b, PL.x, PL.y + 5, PL.z, 11, dt); if (d < 7) { b.state = 'circle'; b.t = 0; b.ca = Math.atan2(b.x - PL.x, b.z - PL.z); } }
    else if (b.state === 'circle') {
      b.ca += dt * 1.25; const r = 4.5; const d = birdSteer(b, PL.x + Math.sin(b.ca) * r, PL.y + 3.4 + Math.sin(b.t * 2) * .4, PL.z + Math.cos(b.ca) * r, 7, dt, 4); flapHz = 6;
      if ((b.t > 5.5 && d < 3) || b.t > 9) {
        b.state = 'land'; b.t = 0; const a = PL.ry || 0; b.lx = PL.x + Math.sin(a) * 2.2 + Math.cos(a) * .6; b.lz = PL.z + Math.cos(a) * 2.2 - Math.sin(a) * .6;
        let gy = groundY(b.lx, b.lz, PL.y); try { if (L.groundAt) gy = L.groundAt(b.lx, b.lz, PL.y + 1, 2).y; } catch (e) { }
        const wy = L.waterAt ? L.waterAt(b.lx, b.lz) : -Infinity; b.water = wy > gy; b.ly = b.water ? wy : gy; // over water: the letter floats
      }
    } else if (b.state === 'land') {
      const d = birdSteer(b, b.lx, b.ly + .05, b.lz, 4, dt, 3); flapHz = 5;
      if (d < .12) { b.state = 'wait'; b.t = 0; b.x = b.lx; b.y = b.ly + .05; b.z = b.lz; b.vx = b.vy = b.vz = 0; if (b.letter && has3D()) { b.lmesh = makeVisual('letter'); b.lmesh.position.set(b.lx + .35, b.ly, b.lz + .1); b.lmesh.rotation.y = Math.random(); L.scene.add(b.lmesh); } emit('mail', { note: b.note }); }
    } else if (b.state === 'wait') {
      flapHz = 0; b.flap = Math.sin(b.t * 1.3) > .96 ? Math.sin(b.t * 30) * .6 : lerp(b.flap, -.15, dt * 4);
      if (hyp(PL.x, PL.z, b.lx, b.lz) > 70) { b.state = 'away'; b.t = 0; if (b.lmesh) { disposeVis(b.lmesh); b.lmesh = null; } b.letter = false; birdCD = 30; }
    } else if (b.state === 'guide') { flapHz = guideTick(b, dt); }
    else if (b.state === 'away') { b.vy = lerp(b.vy, 6, dt); const a = b.away || (b.away = Math.random() * TAU); b.vx = lerp(b.vx, Math.sin(a) * 10, dt); b.vz = lerp(b.vz, Math.cos(a) * 10, dt); b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; if (b.t > 12) b.dead = true; }
    else if (b.state === 'burst') { b.vy += dt * 1.2; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; flapHz = 11; if (b.t > 14) b.dead = true; }
    if (flapHz) b.flap = Math.sin(b.t * flapHz * TAU * .5) * .75;
    if (b.mesh) {
      b.mesh.position.set(b.x, b.y, b.z);
      const sp = Math.hypot(b.vx, b.vz); if (sp > .2) b.ry = Math.atan2(b.vx, b.vz); b.mesh.rotation.y = b.ry; b.mesh.rotation.x = clamp(-b.vy * .06, -.5, .5);
      const w = b.mesh.userData; if (w.wl) { const ax = w.axis || 'z'; w.wl.rotation[ax] = (w.l0 || 0) + b.flap; w.wr.rotation[ax] = (w.r0 || 0) - b.flap; }
    }
  }
  // the paper bird: procedural folded paper until m/paperbird.json is there; then the template itself becomes the model
  let birdModel = false;
  function birdBody() {
    const root = new THREE.Group(); root.scale.setScalar(1.7);
    const body = merge([part(new THREE.ConeGeometry(.045, .3, 4), '#f4f1ea', 0, 0, .02, Math.PI / 2, 0, 0, 1, 1, 1, { lo: .86 }), part(new THREE.ConeGeometry(.03, .1, 3), '#e9e4d8', 0, .05, .2, -.6, 0, 0)], mats().bird);
    root.add(body);
    const wing = s => { const g = new THREE.BufferGeometry(); const v = new Float32Array([0, 0, .1, 0, 0, -.1, s * .27, .02, -.03]); g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(part(g, '#f7f4ee', 0, 0, 0, 0, 0, 0, 1, 1, 1, { flat: true }), mats().bird); m.position.y = .02; return m; };
    const wl = wing(1), wr = wing(-1); root.add(wl); root.add(wr); root.userData.wl = wl; root.userData.wr = wr;
    return root;
  }
  function birdFromModel(sc) {
    const root = new THREE.Group(), c = sc.clone(true); let l = null, r = null;
    c.traverse(o => { if (o.isMesh) { o.material = mats().v; o.castShadow = true; } if (/paperbird_wing_l$/i.test(o.name)) l = o; if (/paperbird_wing_r$/i.test(o.name)) r = o; });
    root.add(c); if (l && r) Object.assign(root.userData, { wl: l, wr: r, axis: 'y', l0: l.rotation.y, r0: r.rotation.y }); return root;
  }
  function makeBird() {
    if (!birdModel) { birdModel = true; modelFile('paperbird').then(sc => { if (sc) TPL.bird = birdFromModel(sc); }); }
    return cloneVis(template('bird', birdBody));
  }
  // a guide (stuck helper bird, or the lunar deer) leads to a target and waits when the player stops
  // she went far away, stopped following for a long while, or the clue got done: the bird leaves, and the helper may
  // come back after CFG.stuckAgain
  function guideLeave(b) { b.state = 'away'; b.t = 0; b.onArrive = null; F.progT = (F.playT || 0) - CFG.stuckAfter + CFG.stuckAgain; changed(); }
  function guideTick(b, dt) {
    const tx = b.tx, tz = b.tz, dp = hyp(PL.x, PL.z, b.x, b.z), dt2 = hyp(b.x, b.z, tx, tz), pt = hyp(PL.x, PL.z, tx, tz);
    let flap = 7;
    b.gT = (b.gT || 0) + dt; if (b.best == null || pt < b.best - 2) { b.best = pt; b.bestT = b.gT; }
    if (dp > CFG.guideLeave || b.gT - b.bestT > CFG.guideStall || (b.guideTo && nextClue() !== b.guideTo)) { guideLeave(b); return 5; }
    if (dt2 < 8 && pt < 28) { b.loops = (b.loops || 0) + dt; b.ca = (b.ca || 0) + dt * 1.2; birdSteer(b, tx + Math.sin(b.ca) * 6, groundY(tx, tz) + 5, tz + Math.cos(b.ca) * 6, 6, dt, 3); if (b.loops > 9) { b.state = 'away'; b.t = 0; F.progT = (F.playT || 0) - CFG.stuckAfter + CFG.stuckAgain; F.hintDream = 1; changed(); } return 6; }
    const moving = PL.v > .35, far = dp > 16;
    if (!moving || far) { b.ha = (b.ha || 0) + dt * 1.6; birdSteer(b, b.hx != null ? b.hx + Math.sin(b.ha) * 2.5 : b.x, (b.hy != null ? b.hy : b.y), b.hz != null ? b.hz + Math.cos(b.ha) * 2.5 : b.z, 2.5, dt, 2); if (b.hx == null) { b.hx = b.x; b.hy = b.y; b.hz = b.z; } flap = 5; }
    else { b.hx = null; const d = Math.hypot(tx - PL.x, tz - PL.z) || 1; const ax = PL.x + (tx - PL.x) / d * Math.min(11, d), az = PL.z + (tz - PL.z) / d * Math.min(11, d); birdSteer(b, ax, Math.max(groundY(ax, az), PL.y) + 4, az, Math.max(2, PL.v + 1.5), dt, 2.5); }
    return flap;
  }
  function stuckTick() {
    const m = mainProgress(); if (m > (F.mainN || 0)) { F.mainN = m; F.progT = F.playT || 0; changed(); }
    if (S.busy || BIRDS.some(b => b.state === 'guide')) return;
    if ((F.playT || 0) - (F.progT || 0) < CFG.stuckAfter) return;
    const id = nextClue(); const p = id && poi(id); if (!p) return;
    const b = launchBird({ state: 'in', guideTo: id }); b.letter = false; b.state = 'in'; b.onArrive = 'guide'; b.tx = p.x; b.tz = p.z;
    F.progT = F.playT; changed();
  }

  // the lunar deer leads to the glade at night once befriended (f2)
  let deer = null;
  function deerTick(dt) {
    const g = poi('lunar_glade'); if (!g) return;
    const want = isNight() && taskState('k_cervo') === 'done' && !W('altar_2') && !F.glade && hyp(PL.x, PL.z, g.x, g.z) < 600;
    if (want && !deer && !S.busy) {
      const a = Math.atan2(g.x - PL.x, g.z - PL.z) + .9; deer = { x: PL.x + Math.sin(a) * 14, z: PL.z + Math.cos(a) * 14, ry: 0, v: 0, t: 0, st: {} };
      deer.y = groundY(deer.x, deer.z, PL.y);
      if (has3D()) { deer.root = new THREE.Group(); const gl = glowSprite(0xc9b8ff, 2.6, .8); gl.position.y = 1.1; deer.root.add(gl); deer.glow = gl; L.scene.add(deer.root);
        modelFile('deer_lunar').then(src => { if (!src || !deer || !L.instRigged) return; const I = L.instRigged(src); deer.I = I; deer.root.add(I.root); }); }
    }
    if (deer && hyp(PL.x, PL.z, deer.x, deer.z) > 90) { dropDeer(); return; } // she travelled away: appear again near her
    if (!deer) return;
    deer.t += dt; const dg = hyp(deer.x, deer.z, g.x, g.z), dp = hyp(PL.x, PL.z, deer.x, deer.z);
    let sp = 0;
    if (dg > 2.5) { if (hyp(PL.x, PL.z, g.x, g.z) < 22) sp = 2.6; else if (dp < 16 && PL.v > .3) sp = Math.min(PL.v + .8, 5); else if (dp < 9) sp = .9; }
    else if (hyp(PL.x, PL.z, g.x, g.z) < 16 && !F.glade) { F.glade = 1; changed(); emit('sfx', 'star'); }
    if (sp > 0) { const a = Math.atan2(g.x - deer.x, g.z - deer.z); deer.ry = a; deer.x += Math.sin(a) * sp * dt; deer.z += Math.cos(a) * sp * dt; deer.y = groundY(deer.x, deer.z, deer.y); }
    else if (dp < 30) deer.ry = lerp(deer.ry, Math.atan2(PL.x - deer.x, PL.z - deer.z), dt * 1.5);
    deer.v = lerp(deer.v, sp, dt * 4);
    if (deer.root) { deer.root.position.set(deer.x, deer.y, deer.z); deer.root.rotation.y = deer.ry; if (deer.I && L.quadAnim) { const s = deer.st; s.speed = deer.v; s.turn = 0; s.t = deer.t; s.dt = dt; s.look = [0, 0]; s.graze = sp ? 0 : .2; s.sit = 0; L.quadAnim(deer.I.rig, s); } }
    if (!isNight() || W('altar_2')) dropDeer();
  }
  function dropDeer() {
    if (deer && deer.root) { L.scene.remove(deer.root); if (deer.glow && deer.glow.material) deer.glow.material.dispose(); } deer = null;
  }

  // ------------------------------------------------------------------ star flight, sparkles
  const FLY = []; let PART = null;
  function sparks(p, color, n) {
    if (!has3D()) return; if (!PART && L.makeParticles && L.GLOW) PART = L.makeParticles(400, L.GLOW, true);
    if (!PART) return; const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, u = Math.random(); PART.emit({ x: p.x + Math.cos(a) * .4, y: (p.y || 0) + 1 + u, z: p.z + Math.sin(a) * .4, vx: Math.cos(a) * (1 + u), vy: 1.5 + u * 2, vz: Math.sin(a) * (1 + u), g: 1.5, drag: 1.2, life: .8 + u, s0: .35, s1: .05, c: [c.r, c.g, c.b], a: 1 }); }
  }
  function fxBurst(o, color, n) { const p = o && resolve(o); if (p) sparks(p, color, n); }
  function flyStar(from, k) {
    if (!has3D()) return; const m = makeVisual('star'); m.position.set(from.x, from.y || PL.y, from.z); L.scene.add(m);
    FLY.push({ m, t: 0, x0: from.x, y0: from.y || PL.y, z0: from.z, k });
  }
  function flyTick(dt) {
    for (let i = FLY.length - 1; i >= 0; i--) {
      const f = FLY[i]; f.t += dt; const m = f.m;
      if (f.t < 1.8) { const u = sstep(0, 1, f.t / 1.8); m.position.set(f.x0, f.y0 + u * 1.6, f.z0); m.rotation.y += dt * (2 + u * 6); m.scale.setScalar(.6 + u * .6); }
      else { const u = clamp((f.t - 1.8) / .9, 0, 1), e = u * u; m.position.set(lerp(f.x0, PL.x, e), lerp(f.y0 + 1.6, PL.y + 1.2, e) + Math.sin(u * Math.PI) * .8, lerp(f.z0, PL.z, e)); m.scale.setScalar(1.2 * (1 - e) + .1); m.rotation.y += dt * 9; if (u >= 1) { sparks({ x: PL.x, y: PL.y, z: PL.z }, 0xffe6a8, 30); disposeVis(m); FLY.splice(i, 1); } }
    }
  }

  // ------------------------------------------------------------------ the light orb, the cloud bridge, the beam
  let orb = null, orbLight = null;
  function orbTick(dt) {
    const on = tNow < FX.luz;
    if (on && !orb && has3D()) {
      orb = new THREE.Group(); const core = glowSprite(0xfff4d0, .7, 1); const halo = glowSprite(0xffe2a0, 3.2, .55); orb.add(core); orb.add(halo); orb.userData.halo = halo; orb.position.set(PL.x, PL.y + 2.4, PL.z); L.scene.add(orb);
      if (L.LIGHTS) { orbLight = { x: PL.x, y: PL.y + 2.4, z: PL.z, c: 0xffe6b0, i: 2.2, d: 18, story: 1 }; L.LIGHTS.push(orbLight); }
      else { orbLight = new THREE.PointLight(0xffe6b0, 1.6, 18, 1.6); orb.add(orbLight); }
    }
    if (!orb) return;
    orb.visible = !EN; // the long morning frames her up close: the little light steps aside
    const left = FX.luz - tNow, fade = clamp(left / 3, 0, 1) * clamp((90 - left) / .8, 0, 1);
    const a = (PL.ry || 0) + 2.4, tx = PL.x + Math.sin(a) * .9, tz = PL.z + Math.cos(a) * .9, ty = PL.y + 2.3 + Math.sin(tNow * 1.8) * .18;
    orb.position.x = lerp(orb.position.x, tx, clamp(dt * 3, 0, 1)); orb.position.y = lerp(orb.position.y, ty, clamp(dt * 3, 0, 1)); orb.position.z = lerp(orb.position.z, tz, clamp(dt * 3, 0, 1));
    orb.userData.halo.material.opacity = .55 * fade; orb.children[0].material.opacity = fade; orb.userData.halo.scale.setScalar(3.2 + Math.sin(tNow * 3) * .2);
    if (orbLight && !orbLight.isLight) { orbLight.x = orb.position.x; orbLight.y = orb.position.y; orbLight.z = orb.position.z; orbLight.i = 2.2 * fade; } else if (orbLight) orbLight.intensity = 1.6 * fade;
    if (!on) { L.scene.remove(orb); orb.traverse(o => { if (o.material) o.material.dispose(); }); orb = null; if (orbLight && !orbLight.isLight && L.LIGHTS) { const i = L.LIGHTS.indexOf(orbLight); if (i >= 0) L.LIGHTS.splice(i, 1); } orbLight = null; }
  }
  let bridge = null;
  function makeBridge(c) {
    if (bridge) removeBridge();
    const dirx = Math.sin(c.yaw), dirz = Math.cos(c.yaw); const slope = clamp(-((c.pitch || 0) - CFG.bridgePitch0) * .35, -.18, .3); // camera pitch: + looks down; the usual view gives a level bridge
    const y0 = (c.y || 0) - .02; let len = 0;
    for (let i = 1; i <= 40; i++) { const x = c.x + dirx * i, z = c.z + dirz * i, top = y0 + slope * i; len = i; if (i > 2 && groundY(x, z, -1e9) > top + (i <= 5 ? 1 : .3)) break; } // small bumps at the start do not stop it
    if (len < 3) return false;
    const y1 = y0 + slope * len;
    const col = L.addCol ? L.addCol({ x: c.x + dirx * len / 2, z: c.z + dirz * len / 2, rot: c.yaw, hx: 1.05, hz: len / 2 + .3, y0: Math.min(y0, y1) - .6, y1: y0, y2: y1, bridge: 1 }) : null;
    bridge = { x: c.x, y: y0, z: c.z, dx: dirx, dz: dirz, slope, len, col, t0: tNow, end: tNow + 25, puffs: [] };
    if (has3D()) {
      // the shared, stylized cloud material (a clone would lose the stylize patch); only one bridge exists at a time
      const n = Math.round(len * 2.6), geo = new THREE.IcosahedronGeometry(1, 1), mat = mats().cloud; mat.transparent = true;
      const im = new THREE.InstancedMesh(geo, mat, n); im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false; const r = rnd(9);
      for (let i = 0; i < n; i++) { const t = (i + r()) / n * len, side = (r() - .5) * 1.9; bridge.puffs.push({ t, side, s: .45 + r() * .5, up: -.25 - r() * .35, ph: r() * TAU }); }
      bridge.mesh = im; L.scene.add(im);
    }
    return true;
  }
  const _o = typeof THREE !== 'undefined' ? new THREE.Object3D() : null;
  function bridgeTick() {
    if (!bridge) return; const b = bridge, age = tNow - b.t0; let left = b.end - tNow;
    const onIt = hyp(PL.x, PL.z, b.x + b.dx * b.len / 2, b.z + b.dz * b.len / 2) < b.len / 2 + 1 && Math.abs(PL.y - (b.y + b.slope * b.len / 2)) < b.len * .3 + 3;
    if (left < 0 && onIt && tNow < b.t0 + 33) { b.end = tNow + .5; left = .5; } // never vanish under her feet (up to 8 s more)
    if (b.mesh) {
      const fadeOut = clamp(left / 3, 0, 1);
      for (let i = 0; i < b.puffs.length; i++) {
        const p = b.puffs[i]; const grow = clamp((age - p.t / 40 * 1.2) / .45, 0, 1); const s = p.s * sstep(0, 1, grow) * (.4 + .6 * fadeOut);
        _o.position.set(b.x + b.dx * p.t + b.dz * p.side, b.y + b.slope * p.t + p.up + Math.sin(tNow * 1.3 + p.ph) * .05 - (1 - fadeOut) * .4, b.z + b.dz * p.t - b.dx * p.side);
        _o.scale.set(s * 1.3, s * .7, s * 1.3); _o.rotation.set(0, p.ph, 0); _o.updateMatrix(); b.mesh.setMatrixAt(i, _o.matrix);
      }
      b.mesh.instanceMatrix.needsUpdate = true; b.mesh.material.opacity = .35 + .65 * fadeOut;
    }
    if (left <= 0) removeBridge();
  }
  function removeBridge() { if (!bridge) return; if (bridge.col && L.delCol) L.delCol(bridge.col); if (bridge.mesh) { L.scene.remove(bridge.mesh); bridge.mesh.geometry.dispose(); if (bridge.mesh.dispose) bridge.mesh.dispose(); } bridge = null; }
  S.bridgeState = () => bridge ? { len: bridge.len, left: bridge.end - tNow, col: !!bridge.col } : null;
  let beam = null;
  function beamTick() {
    const L3 = W('lighthouse'), chest = poi('bay_chest'); const want = !!L3 && isNight() && !!chest && has3D();
    if (want && !beam) {
      const g = new THREE.CylinderGeometry(6.5, .55, 1, 28, 1, true); g.translate(0, .5, 0); g.rotateX(Math.PI / 2); // narrow at the lamp, wide on the water
      const m = new THREE.Mesh(g, mats().beam); m.frustumCulled = false; m.renderOrder = 4; beam = new THREE.Group(); beam.add(m); beam.userData.m = m;
      const gl = glowSprite(0xffefc0, 6, .9); beam.add(gl); const pool = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffd98a, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); pool.rotation.x = -Math.PI / 2; beam.userData.pool = pool; L.scene.add(beam); L.scene.add(pool);
    }
    if (!beam) return;
    if (!want) { L.scene.remove(beam); L.scene.remove(beam.userData.pool); for (const o of [beam.userData.m, beam.userData.pool, beam.children[1]]) { if (!o) continue; if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== mats().beam) o.material.dispose(); } beam = null; return; }
    const src = lh.lamp || L3; beam.position.set(src.x, src.y + 1.2, src.z);
    const tx = chest.x, tz = chest.z, ty = Math.max(-1, (L.waterAt ? L.waterAt(tx, tz) : 0)); const d = Math.hypot(tx - src.x, ty - src.y, tz - src.z);
    beam.lookAt(tx, ty, tz); beam.userData.m.scale.set(1, 1, d); beam.userData.pool.position.set(tx, ty + .06, tz); mats().beam.uniforms.uA.value = 1; mats().beam.uniforms.uT.value = tNow;
  }

  // ------------------------------------------------------------------ the seated figure and the long morning (GDD §5.6)
  let fig = null, doorT = null, restoreT = null;
  function figTick(dt) {
    const th = OBJ_BY.throne, p = th && resolve(th); if (!p || !has3D()) return;
    const near = hyp(PL.x, PL.z, p.x, p.z) < 160;
    if (near && !fig) {
      fig = { root: new THREE.Group(), t: 0, pose: { sit: 1, slump: 1, lift: 0, stand: 0, breathe: 1 }, I: null, pv: th.pv };
      fig.root.position.set(p.x, p.y, p.z); fig.root.rotation.y = p.ry; L.scene.add(fig.root);
      if (!castleWorld('throne')) { const t = PROPS.throne(); fig.root.add(t); fig.seat = t; }
      const ivy = PROPS.ivy(); ivy.position.z = .1; fig.root.add(ivy); fig.ivy = ivy;
      const halo = glowSprite(0xffe6a8, 3, 0); halo.position.set(0, 1.5, .1); fig.root.add(halo); fig.halo = halo;
      loadFigure();
    }
    if (!fig) return;
    const s = fig, po = s.pose; s.t += dt;
    if (s.pv !== th.pv) { // the authored keep arrived after the figure: move onto its seat, drop the stand-in seat
      s.pv = th.pv; s.root.position.set(p.x, p.y, p.z); s.root.rotation.y = p.ry;
      if (s.seat && castleWorld('throne')) { s.root.remove(s.seat); s.seat = null; }
    }
    // the authored keep has its own ivy on the seat: use it instead of the procedural one
    if (!s.vineObj && MODEL.vines && L.castleObj) { let v = null; try { v = L.castleObj(MODEL.vines); } catch (e) { } if (v) { s.vineObj = v; if (s.ivy) { s.root.remove(s.ivy); s.ivy = null; } } }
    if (W('awake') && !S.endingOn) { po.sit = 0; po.slump = 0; po.lift = 1; po.stand = 1; po.ivyGone = 1; po.glow = lerp(po.glow || 0, .2, clamp(dt * .5, 0, 1)); }
    if (s.I) poseFigure(s, dt);
    else if (s.fallback) { s.fallback.position.y = .62 + po.stand * .35; s.fallback.rotation.x = .25 * po.slump; }
    if (s.ivy) { s.ivy.scale.setScalar(Math.max(.001, 1 - (po.ivyGone || 0))); s.ivy.visible = (po.ivyGone || 0) < .999; }
    if (s.vineObj) s.vineObj.visible = (po.ivyGone || 0) < .6;
  }
  function loadFigure() {
    const tryList = [MODEL.figure, 'hero_m', 'mage_m'].filter(Boolean);
    const next = i => { if (i >= tryList.length || !L.loadModel) return fallbackFigure(); modelFile(tryList[i]).then(src => { if (!src || !L.instRigged) return next(i + 1); attachFigure(src, tryList[i]); }); };
    next(0);
  }
  function attachFigure(src, name) {
    if (!fig) return; const I = L.instRigged(src, {}); fig.I = I; fig.model = name === MODEL.figure ? 'own' : name; fig.root.add(I.root);
    if (name !== MODEL.figure) { // a stand-in until the dedicated model exists: deep-blue tint, a thin gold circlet, a white beard
      const mat = (I.meshes[0] && I.meshes[0].material && I.meshes[0].material.clone()) || null; if (mat) { mat.color = new THREE.Color(.55, .62, 1.15); I.meshes.forEach(m => m.material = mat); }
      const head = I.rig.e('head'); if (head) { const h = head.o; const circlet = merge([part(new THREE.TorusGeometry(.11, .012, 6, 18), '#e2b84f', 0, .22, 0, Math.PI / 2), ...[0, 1, 2, 3, 4].map(i => part(G.cone(.018, .06, 4), '#e2b84f', Math.sin(i / 5 * TAU) * .11, .26, Math.cos(i / 5 * TAU) * .11))]); h.add(circlet); const beard = merge([part(G.cone(.09, .32, 7), '#f2efe8', 0, -.04, .09, Math.PI, 0, 0, 1, 1, .6)]); h.add(beard); }
    }
    else I.root.traverse(o => { if (/_glow$/.test(o.name) && /^c/.test(o.name)) { o.visible = false; fig.circletGlow = o; } });
  }
  function fallbackFigure() {
    if (!fig) return; const g = new THREE.Group(); g.add(merge([part(G.cyl(.32, .45, 1.2, 10), '#2f4b8f', 0, .6, 0), part(G.sph(.17, 1), '#e9cfb4', 0, 1.35, .02), part(G.cone(.12, .4, 7), '#f2efe8', 0, 1.15, .14, Math.PI, 0, 0), part(new THREE.TorusGeometry(.15, .02, 6, 16), '#e2b84f', 0, 1.5, 0, Math.PI / 2)]));
    g.position.y = .62; fig.root.add(g); fig.fallback = g;
  }
  function poseFigure(s, dt) {
    const I = s.I, rig = I.rig, po = s.pose; rig.reset();
    const H = rig.hipH || .95, seat = .62, sit = po.sit * (1 - po.stand), slump = po.slump * (1 - po.lift), br = Math.sin(s.t * 1.1) * .03 * (po.breathe || 0);
    for (const sd of ['L', 'R']) { const sg = sd === 'L' ? 1 : -1; rig.r('thigh.' + sd, -1.5 * sit, 0, sg * .08 * sit); rig.r('shin.' + sd, 1.5 * sit); rig.r('foot.' + sd, -.1 * sit); rig.r('upperarm.' + sd, -.55 * sit, 0, sg * -.45 * (1 - .4 * sit)); rig.r('forearm.' + sd, -.75 * sit); }
    rig.p('hips', 0, -(H - seat - .1) * sit, -.12 * sit);
    rig.r('spine', .28 * slump + br); rig.r('chest', .12 * slump - br * .5); rig.r('neck', .25 * slump); rig.r('head', .55 * slump - .1 * po.lift * (1 - po.stand));
    rig.apply();
    I.root.position.set(0, 0, .08 * sit);
    if (s.circletGlow) s.circletGlow.visible = (po.glow || 0) > .3;
    if (s.halo) s.halo.material.opacity = (po.glow || 0) * .7;
  }
  // timeline (seconds); text and camera come from here, overlay drawing from storyui (event 'morning')
  const END = { start: 0, star: 2.6, ivy: 7, lift: 14, out: 18, restore: [19, 33], mist: [31, 41], birds: 33, back: 42, stand: [43, 47], lines: [47.5, 53, 58.5, 64], title: 70, personal: 77, end: 88 };
  let EN = null;
  S.endingOn = false;
  // Who sees what. Her first time plays everything and grants her rewards at the end (not skippable). When the shared
  // world flag is already set (her partner was first, or a reload cut her own sequence) the first part is skipped and
  // the keep stays healed, but her lines, title and rewards still play in full. After that it is a skippable memory without rewards.
  // opt.replay: a look without rewards (someone who has not learned the word yet).
  S.playEnding = function (opt) {
    opt = opt || {};
    if (S.endingOn) return false; const th = OBJ_BY.throne, p = th && resolve(th); if (!p) return false;
    const c = poi('castle') || p, awake = !!W('awake'), own = !F.seenEnd && !opt.replay;
    EN = { t: awake ? END.out : 0, p, c, own, worldDone: awake, skippable: !own, lineI: -1, flags: {}, personal: !!T(LP.end + '.personal_text', '') };
    S.endingOn = true;
    if (own) { F.endStarted = wall(); changed(); }
    if (!awake) { setW('awake', stamp()); worldEvent('awake', {}); }
    if (L.save && L.save.flush) { try { L.save.flush(); } catch (e) { } }
    emit('morning', { phase: 'start', skippable: EN.skippable }); emit('sfx', 'morning');
    return true;
  };
  S.skipEnding = function () { if (!EN || !EN.skippable) return false; EN.t = Math.max(EN.t, END.end - .1); return true; };
  function endTick(dt) {
    if (!EN) return; const e = EN; e.t += dt; const t = e.t, p = e.p, c = e.c;
    const fx = Math.sin(p.ry), fz = Math.cos(p.ry), sx = Math.cos(p.ry), sz = -Math.sin(p.ry);
    const po = fig ? fig.pose : {};
    const once = (k, fn) => { if (!e.flags[k]) { e.flags[k] = 1; fn(); } };
    // camera
    if (t < END.out) { const u = sstep(0, END.out, t); const d = lerp(7.5, 3.2, u), up = lerp(2.6, 1.75, u), side = Math.sin(u * 2.2) * 1.2; setCam(p.x + fx * d + sx * side, p.y + up, p.z + fz * d + sz * side, p.x, p.y + lerp(1.3, 1.55, u), p.z, 45); }
    else if (t < END.back) { const u = sstep(END.out, END.back, t); const a = Math.atan2(p.x - c.x, p.z - c.z) + Math.PI + lerp(-.5, .35, u); const R = lerp(150, 230, u), H = lerp(55, 120, u); setCam(c.x + Math.sin(a) * R, (c.y || p.y) + H, c.z + Math.cos(a) * R, c.x, (c.y || p.y) + lerp(30, 45, u), c.z, 50); }
    else { const u = (t - END.back) / (END.end - END.back); const a = Math.sin(u * 2.4) * .55; const d = lerp(5.5, 7.5, u); setCam(p.x + (fx * Math.cos(a) + sx * Math.sin(a)) * d, p.y + lerp(1.7, 2.6, u), p.z + (fz * Math.cos(a) + sz * Math.sin(a)) * d, p.x, p.y + lerp(1.7, 1.95, u * u), p.z, 45); }
    if (Math.abs(t - END.out) < dt || Math.abs(t - END.back) < dt) emit('morning', { phase: 'blink' });
    // the forged star travels to the seat
    if (!e.worldDone) once('star', () => { if (has3D()) { const m = makeVisual('bow'); m.position.set(PL.x, PL.y + 1.2, PL.z); L.scene.add(m); e.star = m; } });
    if (e.star) { const u = sstep(0, END.star, t); e.star.position.set(lerp(PL.x, p.x + fx * .3, u), lerp(PL.y + 1.2, p.y + .95, u) + Math.sin(u * Math.PI) * .6, lerp(PL.z, p.z + fz * .3, u)); e.star.rotation.y += dt * 4; e.star.scale.setScalar(t > END.lift ? Math.max(.01, 1 - (t - END.lift) / 2) : 1 + Math.sin(t * 3) * .05); if (t > END.lift + 2) { disposeVis(e.star); e.star = null; } }
    if (e.worldDone) Object.assign(po, { glow: 1, ivyGone: 1, breathe: 1, lift: 1, slump: 1, sit: 1, stand: 1 });
    else {
      po.glow = sstep(END.star, END.star + 2, t); po.ivyGone = sstep(END.ivy, END.ivy + 5, t); po.breathe = 1;
      po.lift = sstep(END.lift - 2, END.lift + 2.5, t); po.slump = 1; po.sit = 1; po.stand = sstep(END.stand[0], END.stand[1], t);
      // the place heals, the white clears (shared world: only the first time in this world)
      const rp = sstep(END.restore[0], END.restore[1], t); heal(rp); emit('restore', rp);
      clearWhite(sstep(END.mist[0], END.mist[1], t));
    }
    if (t >= END.birds) once('birds', () => burstBirds(c)); if (t >= END.birds + 2.5) once('birds2', () => burstBirds(c));
    // words
    for (let i = END.lines.length - 1; i >= 0; i--) if (t >= END.lines[i]) { if (e.lineI < i) { e.lineI = i; emit('morning', { phase: 'line', i, text: T(LP.end + '.lines.' + i) }); } break; }
    if (t >= END.title) once('title', () => emit('morning', { phase: 'title', text: T('ui.title_end') }));
    if (t >= END.personal && e.personal) once('pers', () => emit('morning', { phase: 'personal', title: T(LP.end + '.personal_title', ''), text: T(LP.end + '.personal_text', '') }));
    const endAt = e.personal ? END.end : END.personal + 2;
    if (t >= endAt) finishEnding();
  }
  function burstBirds(c) { for (let i = 0; i < 14; i++) { const a = Math.random() * TAU; const b = launchBird({ state: 'burst', letter: false }); b.x = c.x + Math.sin(a) * 8; b.y = (c.y || 0) + 25 + Math.random() * 20; b.z = c.z + Math.cos(a) * 8; b.vx = Math.sin(a) * (6 + Math.random() * 5); b.vz = Math.cos(a) * (6 + Math.random() * 5); b.vy = 2 + Math.random() * 3; b.t = Math.random(); } }
  // always hands control back (camera, input), even when a hook throws on the way out
  function finishEnding() {
    const e = EN; EN = null; S.endingOn = false; clearCam();
    try {
      if (e && e.star) { disposeVis(e.star); e.star = null; }
      heal(1); clearWhite(1);
      if (e && e.own) grantEnd(e);
    } catch (er) { console.warn('[story] morning end', er); }
    finally { emit('morning', { phase: 'end' }); progressMade(); needEval = true; }
  }
  // her rewards, once per player: seen flag, the star circlet, the young dragon; the shared ones only when missing
  function grantEnd(e) {
    if (F.seenEnd) return false;
    F.seenEnd = wall(); F.crown = 1; delete F.endStarted; changed();
    if (!W('home_keep')) setW('home_keep', stamp()); if (!W('lit_village')) setW('lit_village', stamp());
    hook('giveTame', L.giveTame, 'dragao_bebe');
    hook('onStoryLook', L.onStoryLook, S.look()); emit('look', S.look());
    if (e && e.c) { const c = e.c, gt = poi('castle_gate') || c; const x = lerp(c.x, gt.x, .2), z = lerp(c.z, gt.z, .2); teleport(x, groundY(x, z, e.p.y) + .1, z); }
    if (L.save && L.save.flush) { try { L.save.flush(); } catch (er) { } }
    return true;
  }
  // a sequence of hers was cut (reload, app closed): near the seat it resumes (first part skipped), elsewhere the
  // rewards are given quietly with a short note
  let resumeT = -1;
  function resumeTick(dt) {
    if (resumeT < 0) return; resumeT -= dt; if (resumeT > 0 || S.busy || S.uiOpen) return; resumeT = -1;
    if (F.seenEnd || !W('awake')) return;
    const th = OBJ_BY.throne, p = th && resolve(th);
    if (p && hyp(PL.x, PL.z, p.x, p.z) < 60 && S.playEnding()) return;
    grantEnd(null); say(T('ui.title_end'), '✦');
  }
  // the lock takes the star and sinks, then the doors swing inwards (castle5 manifest: left +90°, right -90° about the
  // vertical axis); the procedural stand-in disc lights up
  // Once open (doorT = 8) the final pose is applied again whenever the keep pieces (re)appear: every second until the
  // doors are found, and after S.invalidate() / 'castle_ready'.
  let doorDone = false, doorChk = 0;
  function doorTick(dt) {
    if (doorT == null) return;
    if (doorT >= 8) { if (doorDone) return; doorChk -= dt; if (doorChk > 0) return; doorChk = 1; doorT = 8; } else doorT = Math.min(8, doorT + dt);
    const u = sstep(2.5, 7.5, doorT);
    if (L.castleObj) {
      const l = L.castleObj('gate_door_l'), r = L.castleObj('gate_door_r'); if (doorT >= 8 && (l || r)) doorDone = true;
      if (l) { const d = l.userData; if (d.ry0 == null) d.ry0 = l.rotation.y; l.rotation.y = d.ry0 + Math.PI / 2 * u; }
      if (r) { const d = r.userData; if (d.ry0 == null) d.ry0 = r.rotation.y; r.rotation.y = d.ry0 - Math.PI / 2 * u; }
      const s = L.castleObj('star_lock'); if (s) { const d = s.userData; if (d.y0 == null) d.y0 = s.position.y; s.position.y = d.y0 - 2.5 * sstep(1, 3, doorT); }
      const g = L.castleObj('star_lock_glow'); if (g) g.visible = doorT < 3.2;
    }
    const lk = OBJ_BY.lock; if (lk && lk.mesh && lk.mesh.userData.star) { const k = sstep(0, 1.5, doorT); lk.mesh.userData.star.material.color.setRGB(lerp(.25, 1.6, k), lerp(.22, 1.3, k), lerp(.18, .7, k)); }
  }
  function restoreTick(dt) { if (restoreT == null || S.endingOn) return; restoreT += dt; const u = sstep(0, 15, restoreT); heal(u); clearWhite(u); if (u >= 1) restoreT = null; }
  // the game's hooks for the keep and the white: a failing hook is reported once and never stops the sequence
  const HOOKERR = {};
  function hook(name, fn, a) { if (typeof fn !== 'function') return; try { fn(a); } catch (er) { if (!HOOKERR[name]) { HOOKERR[name] = 1; console.warn('[story] hook ' + name + ' failed:', er); } } }
  function heal(u) { hook('castleRestore', L.castleRestore, u); }
  function clearWhite(u) { if (L.mistVisual) hook('mistVisual.dissolve', L.mistVisual.dissolve && (v => L.mistVisual.dissolve(v)), u); }

  // ------------------------------------------------------------------ visuals of placed objects (lazy, near the player)
  const VIS_R = 140; let visT = 0;
  const visKind = o => (o.fromWhere && o.visCastle !== undefined ? o.visCastle : o.vis);
  function dropMesh(o) { disposeVis(o.mesh); o.mesh = null; o.mkind = null; }
  // every 0.4 s: build the visuals that came into range (within CFG.visBudget ms per frame, the rest next frame), move
  // the ones whose position got refined, drop the far ones (their per-object materials are disposed)
  function visTick(dt) {
    visT -= dt; if (visT <= 0) {
      visT = .4; const t0 = now(); let built = 0;
      for (const o of OBJ) {
        const p = resolve(o), kind = visKind(o);
        if (!p || !kind || kind === 'throneSet') { if (o.mesh) dropMesh(o); continue; }
        if (o.mesh && o.mkind !== kind) dropMesh(o); // e.g. the page moved onto the authored reading stand
        const d = hyp(PL.x, PL.z, p.x, p.z), show = d < VIS_R && (o.keepVis || exists(o));
        if (show && !o.mesh) {
          if (built && now() - t0 > CFG.visBudget) { visT = 0; continue; }
          o.mesh = kind === 'spirit' ? makeSpirit() : makeVisual(kind); o.mkind = kind; built++;
          o.mesh.position.set(p.x, p.y, p.z); o.mesh.rotation.y = p.ry || 0; o.base = p.y; o.mpv = o.pv; L.scene.add(o.mesh); o.fade = 0;
        }
        if (o.mesh) {
          if (o.mpv !== o.pv) { o.mesh.position.set(p.x, p.y, p.z); o.mesh.rotation.y = p.ry || 0; o.base = p.y; o.mpv = o.pv; }
          o.mesh.visible = show || (o.fade > .02 && o.rune); o.near = show && d < 60; if (!show && !o.rune && d > VIS_R + 60) dropMesh(o);
        }
      }
    }
    for (const o of OBJ) {
      if (!o.mesh || !o.mesh.visible) continue; const u = o.mesh.userData;
      if (o.vis === 'star') { o.mesh.rotation.y += dt * 1.2; o.mesh.position.y = o.base + Math.sin(tNow * 1.6) * .12; if (u.glow) u.glow.material.opacity = (isNight() ? .75 : .42) + Math.sin(tNow * 2.3) * .12; }
      else if (o.vis === 'feather') { o.mesh.rotation.y += dt * .8; o.mesh.position.y = o.base + Math.sin(tNow * 2 + 1) * .1; }
      else if (o.float) { const wy = L.waterAt ? L.waterAt(o.pos.x, o.pos.z) : -Infinity; if (wy > o.base - 2 && wy > -1e8) o.mesh.position.y = wy - .03 + Math.sin(tNow * 1.4 + o.pos.x) * .03; o.mesh.rotation.z = Math.sin(tNow * 1.1) * .06; }
      else if (o.vis === 'chest') { if (u.glow) u.glow.material.opacity = .25 + .2 * Math.sin(tNow * 2); }
      else if (o.rune) { const want = revealed() ? 1 : 0; o.fade = lerp(o.fade || 0, want, clamp(dt * 2, 0, 1)); if (u.rune) u.rune.opacity = o.fade; if (u.glow) u.glow.material.opacity = o.fade * .6; }
      else if (o.vis === 'millPart') { const done = millDone(+o.id.slice(5)); if (u.solid) { u.solid.visible = done; u.ghost.visible = !done; u.ghost.material.opacity = .22 + Math.sin(tNow * 2) * .08; } }
      else if (o.vis === 'pad') { const i = +o.id.slice(6); if (u.flower) u.flower.visible = !!(((W('shrine') || {}).lotus | 0) & (1 << i)); }
      else if (o.vis === 'mushrooms') { if (u.caps) { const k = F.glade ? 1 : .45; u.caps.material.color.setRGB(1.1 * k + Math.sin(tNow * 2) * .1, 1.4 * k, 1.8 * k); } }
      else if (o.vis === 'spirit') { o.mesh.position.y = o.base + Math.sin(tNow * .9) * .08; if (u.glow) u.glow.material.opacity = .5 + .15 * Math.sin(tNow * 1.3); }
      if (o.lidT != null && u.lid) { o.lidT += dt; u.lid.rotation.x = -sstep(0, 1.2, o.lidT) * 1.6; }
    }
  }
  function makeSpirit() { return cloneVis(template('spirit', spiritBody)); }
  function spiritBody() {
    const g = new THREE.Group(); const parts = [part(G.sph(1, 1), '#e9f2ff', 0, 1.35, 0, 0, 0, 0, .95, .75, 1.45), part(G.sph(.5, 1), '#f4f8ff', 0, 1.35, 1.35, 0, 0, 0, .8, .8, 1), part(G.sph(.3, 1), '#cfdcf2', 0, 1.0, 1.75), part(G.cone(.09, .55, 6), '#fff6dc', .42, 1.9, 1.3, 0, 0, -1.0), part(G.cone(.09, .55, 6), '#fff6dc', -.42, 1.9, 1.3, 0, 0, 1.0)];
    for (const [x, z] of [[-.45, .7], [.45, .7], [-.45, -.7], [.45, -.7]]) parts.push(part(G.cyl(.16, .13, 1.0, 7), '#dde8fb', x, .5, z));
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; parts.push(part(G.cone(.18, .6, 5), '#eef4ff', Math.cos(a) * .85, .75, Math.sin(a) * 1.2, Math.PI, 0, 0)); }
    const body = merge(parts, mats().spirit); body.castShadow = false; g.add(body);
    const gl = glowSprite(0xcfe2ff, 6, .5); gl.position.y = 1.4; g.add(gl); g.userData.glow = gl; return g;
  }

  // ------------------------------------------------------------------ periodic logic
  let slowT = 0, midT = 0, mailT = 0, stuckT = 0, seenT = 0;
  const SEEN = [['lighthouse', 60, 'seen_lighthouse'], ['summit_camp', 40, 'seen_summit'], ['griffin_nest', 15, 'seen_nest'], ['royal_forge', 30, 'seen_forge']];
  function evalAll() {
    needEval = false; updateTasks(); checkThoughts(); checkLook(); emit('refresh', null);
  }
  // Each subsystem runs guarded: an exception (e.g. from a game hook) is logged once, the subsystem pauses 2 s and,
  // after 3 failures in a row, stays off for the session; the others keep running. A failing long morning still hands
  // the camera and input back (finishEnding).
  const ERR = {};
  const CLEANUP = { morning: () => { if (EN) finishEnding(); }, shot: () => { if (shot) { shot = null; clearCam(); F.castle_seen = 1; changed(); emit('reveal', { on: false }); } }, mist: () => { MS.phase = 0; whiteOut(0, null); } };
  function sub(name, fn, dt) {
    const r = ERR[name]; if (r && (r.off || tNow < r.until)) return;
    try { fn(dt); if (r) r.n = 0; }
    catch (er) {
      const q = ERR[name] || (ERR[name] = { n: 0, all: 0, until: 0, off: false }); q.n++; q.all++; q.until = tNow + 2;
      if (q.all === 1) console.warn('[story] ' + name + ' failed:', er);
      if (q.n >= 3 && !q.off) { q.off = true; console.warn('[story] ' + name + ' paused for this session'); }
      if (CLEANUP[name]) { try { CLEANUP[name](); } catch (e2) { } }
    }
  }
  function birdsTick(dt) {
    for (let i = BIRDS.length - 1; i >= 0; i--) {
      const b = BIRDS[i]; if (b.onArrive === 'guide' && b.state === 'circle') { b.state = 'guide'; b.onArrive = null; }
      birdTick(b, dt); if (b.dead) { disposeVis(b.mesh); disposeVis(b.lmesh); BIRDS.splice(i, 1); }
    }
  }
  function sleepTick(dt) { if (wokeWait > 0) { wokeWait -= dt; if (wokeWait <= 0 && (pendingDream || F.hintDream) && !(L.surv && L.surv.sleeping)) wakeUp(); } }
  function thoughtTick(dt) { if (thoughtCD > 0) thoughtCD -= dt; else if (thoughtQ.length && !S.busy && !S.uiOpen) { const id = thoughtQ.shift(); emit('thought', { id, text: T('thoughts.' + id + '.text') }); thoughtCD = 8; } }
  function midTick() { vigilTick(1); lhCheckT -= 1; if (lhCheckT <= 0) { lhCheckT = 3; lhCheck(); } }
  function seenTick() { for (const [id, r, f] of SEEN) if (!F[f] && S.near(id, r)) setF(f); }
  S.tick = function (dt) {
    bindPlayer();
    dt = +dt; if (!(dt > 0)) dt = 0; dt = Math.min(dt, .1); tNow += dt; readPlayer(dt);
    if (!S.busy && !S.uiOpen) F.playT = (F.playT || 0) + dt;
    if (birdCD > 0) birdCD -= dt;
    if (!MEM_SAVE() && MEM.mana < 100) MEM.mana = Math.min(100, MEM.mana + dt * 1.5);
    sub('mist', mistTick, dt); sub('shot', shotTick, dt); sub('morning', endTick, dt); sub('doors', doorTick, dt); sub('restore', restoreTick, dt); sub('resume', resumeTick, dt);
    sub('birds', birdsTick, dt); sub('sleep', sleepTick, dt); sub('bridge', bridgeTick, dt);
    if (has3D()) { sub('visuals', visTick, dt); sub('fly', flyTick, dt); sub('orb', orbTick, dt); sub('beam', beamTick, dt); sub('figure', figTick, dt); if (PART && PART.update) sub('particles', d => PART.update(d), dt); }
    sub('deer', deerTick, dt); sub('thoughts', thoughtTick, dt);
    midT -= dt; if (midT <= 0) { midT = 1; sub('vigil', midTick, 1); }
    seenT -= dt; if (seenT <= 0) { seenT = 2; sub('seen', seenTick, 0); }
    mailT -= dt; if (mailT <= 0) { mailT = 2; sub('mail', mailTick, 0); }
    stuckT -= dt; if (stuckT <= 0) { stuckT = 5; sub('stuck', stuckTick, 0); }
    slowT -= dt; if (needEval || slowT <= 0) { slowT = 2; sub('eval', evalAll, 0); }
    if (L.storyUI && L.storyUI.tick) sub('ui', L.storyUI.tick, dt);
  };
  const MEM_SAVE = () => !!(L.surv || (L.save && L.save.player && L.save.player.st && typeof L.save.player.st.mana === 'number'));

  // ------------------------------------------------------------------ init
  S.init = function () {
    loadLore(); bindPlayer(); buildObjects();
    if (L.save && L.save.on && !S._listening) { S._listening = true; try { L.save.on('w5', (id, d, old, origin) => onWorld(id, d, origin === 'local')); } catch (e) { } }
    if (L.save && L.save.player) { /* nothing else: state lives in the record */ }
    if (F.progT == null) { F.progT = F.playT || 0; F.mainN = mainProgress(); }
    if (W('gate')) doorT = 8;
    if (W('awake')) { heal(1); clearWhite(1); }
    if (W('awake') && F.endStarted && !F.seenEnd) resumeT = 2; // her sequence was cut: resume it or grant its rewards
    if (has3D()) { try { S.prewarm(); } catch (e) { console.warn('[story] prewarm', e); } }
    S.ready = true; needEval = true; emit('init', null);
    // the game can open the UI itself (L.storyUIOpts.defer) or pass its options here
    const uo = L.storyUIOpts || {}; if (L.storyUI && L.storyUI.init && !uo.defer) L.storyUI.init(uo);
    return S;
  };
  Object.defineProperty(S, 'flags', { get: () => { const o = Object.assign({}, F || {}); const m = worldMap(); if (m && m.forEach) m.forEach((v, k) => { if (v != null) o['w:' + k] = v; }); return o; } });
  S.fragCount = () => fragCount();
  S.objects = () => OBJ.map(o => { const p = resolve(o); return { id: o.id, kind: o.kind, poi: o.poi, pos: p && { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }, exists: exists(o), can: canUse(o) }; });

  // ------------------------------------------------------------------ debug API (tests)
  S.debug = {
    state: () => ({ notes: Object.keys(P.notes), dreams: Object.keys(P.dreams), th: Object.keys(P.th), tasks: S.taskView().map(t => t.id + ':' + t.state + ':' + t.n + '/' + t.of), spells: S.spells, frags: fragCount(), star: hasStar(), next: nextClue(), main: mainProgress(), flags: S.flags, inv: Object.assign({}, inv.obj()), busy: !!S.busy, ending: !!S.endingOn, mist: S.mistState(), birds: BIRDS.map(b => b.state + (b.note ? ':' + b.note : '')), deer: deer ? [+deer.x.toFixed(1), +deer.z.toFixed(1)] : null }),
    set: (k, v) => { if (/^w:/.test(k)) setW(k.slice(2), v === undefined ? stamp() : v); else setF(k, v === undefined ? 1 : v); needEval = true; },
    give: (id, n) => inv.give(id, n || 1),
    complete: id => { const k = TK[id]; if (!k) return false; if (!taskState(id)) setTask(id, 'on'); if (/^f(\d)$/.test(id)) grantFragment(+id[1]); else if (id === FORGE_TASK) { if (!W('forge_key')) { setW('forge_key', stamp()); inv.give(IT.star, 1); } } else if (id === 'k_fim') { setW('awake', stamp()); } finishTask(id); return true; },
    teleport: id => {
      const p = Array.isArray(id) ? { x: id[0], z: id[1], y: id[2] } : poi(id); if (!p) return false; let y = groundY(p.x, p.z, p.y || 0); if (p.y != null && p.y - y > 4) y = p.y;
      teleport(p.x, y, p.z); readPlayer(0); return [p.x, y, p.z];
    },
    goObj: (id, d) => { const o = OBJ_BY[id]; const p = o && resolve(o); if (!p) return false; d = d == null ? 1.2 : d; const x = p.x + d, z = p.z + d * .3; let y = groundY(x, z, p.y); if (p.y - y > 4) y = p.y; teleport(x, y, z); readPlayer(0); return true; },
    hour: h => { dbgHour = h == null ? null : h; },
    day: n => { dbgDay += n || 1; },
    read: id => readNote(id),
    force: id => interactAt(id, true),
    learn: id => learn(id),
    world: (id, d) => setW(id, d === undefined ? stamp() : d),
    eval: () => evalAll(),
    forgeTask: () => FORGE_TASK,
    tasks: () => S.taskView(),
    tick: (sec, step) => { step = step || .1; for (let t = 0; t < sec; t += step) S.tick(step); },
    lh: () => Object.assign({}, lh),
    birds: () => BIRDS.map(b => ({ state: b.state, t: b.t, note: b.note || null, guide: !!b.guideTo, x: b.x, y: b.y, z: b.z, tx: b.tx, tz: b.tz })),
    skipShot: () => { if (shot) { shot.t = shot.dur; shotTick(0); } },
    endFx: () => { for (const k in FX) FX[k] = 0; if (F.fxw) { F.fxw = {}; changed(); } },
    // dev harness helpers: a fresh visual of a placed-object kind, the seated figure's state, a letter bird on demand
    visual: kind => (kind === 'spirit' ? makeSpirit() : kind === 'bird' ? makeBird() : makeVisual(kind)),
    figure: () => (fig ? { model: fig.model || (fig.fallback ? 'fallback' : null), pose: Object.assign({}, fig.pose), seat: !!fig.seat, vines: !!fig.vineObj } : null),
    errors: () => JSON.parse(JSON.stringify(ERR)),
    perf: () => ({ builtMs: +builtMs.toFixed(1), templates: Object.keys(TPL).length, visuals: OBJ.filter(o => o.mesh).length, birds: BIRDS.length }),
    vigil: () => (F.vigil ? Object.assign({}, F.vigil) : null),
    timers: () => ({ fx: Object.assign({}, FX), cd: Object.assign({}, CD), now: tNow }),
    doors: () => ({ t: doorT, done: doorDone }),
    bird: note => { const b = launchBird({ note: note || null }); if (!note) b.letter = false; return BIRDS.length; },
  };
})(window.L);
