/* Lumiar: data-driven progression. Notes and letters, dreams, thoughts, tasks, guardians, spells, trials, the
   white cloud region, the gate and the finale. All text comes from the encoded data (L.T / L.TL); this file holds
   only logic, placement and procedural fallback visuals. Contract: TECH §6 (see dev/story_test.js for a full run). */
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
  const FORGE_TASK = L.TX ? L.TX('vSewND2aHA==') : 'k_forge';
  const IT = { star: 'estrela', frag: 'fragmento', feather: 'pena_dourada', moonSeed: 'sem_lua', moonFlower: 'flor_lua', soup: 'sopa_quente', lotusSeed: 'sem_lotus', lotus: 'lotus', gold: 'ouro', crystal: 'cristal', wood: 'madeira', rope: 'corda' };
  S.IT = IT;
  // display data for story items (names live in the encoded data)
  const ITEM_INFO = { fragmento: ['ui.frag_name', '✦'], estrela: ['ui.key_name', '✧'], pena_dourada: ['ui.feather_name', '🪶'], sem_lua: ['ui.moonseed_name', '🌱'], flor_lua: ['ui.moonflower_name', '🌸'] };
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
    dawn: [6, 7.5], sunrise: [5, 9], night: [18, 6], dusk: [17, 20.5],
    interactR: 2.4,
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
    F = P.flags; changed();
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
  const hasStar = () => inv.count(IT.star) > 0 || !!W('forge_key') || !!W('gate');
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
      case 'has_key': return hasStar(); case 'awake': return !!W('awake');
      case 'full_moon': return Math.abs(moon() - .5) < .095; case 'new_moon': return Math.min(moon(), 1 - moon()) < .095;
    }
    return !!F[c] || !!W(c);
  }
  const all = a => !a || a.every(has);
  S.has = c => (P ? has(c) : false);

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
    k_moinho: { poi: 'windmill_broken', on: () => met('windmill') || P.notes.n05, prog: () => [mill(), 4], guard: 'windmill', spell: 'brisa', done: () => mill() >= 4 },
    k_cervo: { poi: 'deer_meadow', on: () => met('cervo_lunar'), prog: () => [Math.min(CFG.deerNights, (F.deer || []).length), CFG.deerNights], guard: 'auto', spell: 'luz' },
    k_lago: { poi: 'turtle_shrine', on: () => met('tartaruga'), prog: () => { const s = shrine(); return [Math.min(CFG.reeds, s[0]) + Math.min(CFG.lotus, s[1]), CFG.reeds + CFG.lotus]; }, guard: 'tartaruga', spell: 'mare' },
    k_penas: { poi: 'griffin_queen', on: () => met('rainha_grifo') || feathers() > 0, prog: () => [Math.min(CFG.feathers, feathers()), CFG.feathers], guard: 'rainha_grifo', spell: 'ponte' },
    f1: { poi: 'totem_choro', on: () => met('totem_choro') || P.notes.s07 || P.notes.n07, prog: () => [W('altar_1') ? 2 : inv.count(IT.moonFlower) > 0 ? 1 : 0, 2], done: () => !!W('altar_1') },
    f2: { poi: 'lunar_glade', on: () => taskState('k_cervo') === 'done', prog: () => [W('altar_2') ? 2 : F.glade ? 1 : 0, 2], done: () => !!W('altar_2') },
    f3: { poi: 'lighthouse', on: () => P.notes.s03 || F.seen_lighthouse, prog: () => [W('altar_3') ? 4 : (lh.tall || W('lighthouse') ? 1 : 0) + (lh.lamp || W('lighthouse') ? 1 : 0) + (W('lighthouse') ? 1 : 0), 4], done: () => !!W('altar_3') },
    f4: { poi: 'summit_camp', on: () => P.notes.n06 || met('espirito_iaque') || P.notes.s20, prog: () => [W('altar_4') ? 2 : F.vigil && F.vigil.done ? 1 : 0, 2], done: () => !!W('altar_4') },
    f5: { poi: 'griffin_nest', on: () => P.notes.s14 || P.notes.s28 || met('rainha_grifo'), prog: () => [W('altar_5') ? 1 : 0, 1], done: () => !!W('altar_5') },
    k_ver: { poi: 'totem_ancestral', on: () => hasStar(), prog: () => [learned('revelar') ? 1 : 0, 1], guard: 'totem_ancestral', spell: 'revelar' },
    k_fim: { poi: 'mist_sign', on: () => learned('revelar'), prog: () => [(F.castle_seen ? 1 : 0) + (W('gate') ? 1 : 0) + (P.notes.n11 ? 1 : 0) + (W('awake') ? 1 : 0), 4], done: () => !!W('awake') },
  };
  TK[FORGE_TASK] = { poi: 'royal_forge', on: () => P.notes.n08, prog: () => { const d = W('forge') || {}; if (W('forge_key')) return [10, 10]; return [Math.min(5, d.f || 0) + Math.min(3, d.o || 0) + Math.min(2, d.c || 0), 10]; }, done: () => !!W('forge_key') };
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
      return { id: t.id, title: T('tasks.' + t.id + '.title'), text: T('tasks.' + t.id + '.text'), n: s === 'done' ? of : Math.min(n, of), of, state: s, frag: /^f\d$/.test(t.id), spell: k.spell ? T('spells.' + k.spell + '.name') : '', t: (P.tasks[t.id] || {}).t || 0 };
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
  // [poi to guide towards, done?, lore path echoed by the softer dream hint (else: the latest note read)]
  const CLUES = [
    ['cottage', () => P.notes.n01], ['cottage', () => F.fire_cottage, 'notes.n01.text'], ['totem_sorriso', () => P.notes.n03, 'notes.n02.text'],
    ['bakery', () => P.notes.n04], ['hermit_tower_vale', () => P.notes.n12], ['stream_mills', () => P.notes.n05],
    ['windmill_broken', () => learned('brisa'), 'tasks.k_moinho.text'], ['totem_jardim', () => learned('brotar'), 'tasks.k_horta.text'], ['lunar_garden', () => P.notes.n07],
    ['deer_meadow', () => learned('luz'), 'tasks.k_cervo.text'], ['totem_choro', () => W('altar_1'), 'tasks.f1.text'], ['lunar_glade', () => W('altar_2'), 'tasks.f2.text'],
    ['turtle_shrine', () => learned('mare'), 'tasks.k_lago.text'], ['lighthouse', () => W('altar_3'), 'tasks.f3.text'], ['summit_camp', () => W('altar_4'), 'tasks.f4.text'],
    ['griffin_queen', () => learned('ponte'), 'tasks.k_penas.text'], ['griffin_nest', () => W('altar_5'), 'tasks.f5.text'], ['royal_forge', () => P.notes.n08],
    ['royal_forge', () => hasStar(), 'tasks.' + FORGE_TASK + '.text'], ['totem_ancestral', () => learned('revelar'), 'tasks.k_ver.text'], ['mist_sign', () => F.castle_seen, 'notes.n10.text'],
    ['castle_gate', () => W('gate'), 'notes.n03.text'], ['throne', () => P.notes.n11], ['throne', () => W('awake'), 'notes.n11.text'],
  ];
  function clueEntry() { for (const c of CLUES) if (!c[1]() && poi(c[0])) return c; return null; }
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
  function resolve(o) {
    if (o.pos && !o.dynamic) return o.pos;
    if (o.where) { const w = o.where(); if (w) { o.pos = w; return w; } }
    let a = L.storyAnchor && L.storyAnchor(o.id);
    if (a) { o.pos = { x: a.x, y: a.y != null ? a.y : groundY(a.x, a.z), z: a.z, ry: a.ry || 0 }; return o.pos; }
    const p = poi(o.poi); if (!p) return null;
    const ry = p.ry || 0; let off = (p.story && p.story[o.id]) || o.off || [0, 0];
    let dx = off[0], dz = off[1];
    if (o.spread) { const a2 = o.spread * 2.1 + .6; dx += Math.cos(a2) * 2.4; dz += Math.sin(a2) * 2.4; }
    const c = Math.cos(ry), s = Math.sin(ry);
    const x = p.x + dx * c + dz * s, z = p.z - dx * s + dz * c;
    const base = p.y != null ? p.y : groundY(x, z);
    let y = L.groundAt ? L.groundAt(x, z, base + 1.5, 3).y : groundY(x, z, base);
    if (o.fly || (p.y != null && base - y > 4)) y = base; // floating islets: trust the POI height
    if (o.under && L.waterAt) { const w = L.waterAt(x, z); if (w > y) y = Math.max(y, w - 1.1); }
    y += (off[2] || 0) + o.dy;
    o.pos = { x, y, z, ry: ry + (o.ry || 0) };
    return o.pos;
  }

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
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform float uA,uT; varying vec2 vU; void main(){ float along = vU.y; float edge = sin(vU.x*3.14159); float a = uA * (1.-along) * (.35+.65*edge*edge) * (.85+.15*sin(uT*1.7+along*9.)); gl_FragColor = vec4(1.,.92,.68,a*.55); }',
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
  function glowSprite(color, size, op) {
    if (L.glowSprite) return L.glowSprite(color, size, op);
    if (!TEX.glow) TEX.glow = canvas(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color, transparent: true, opacity: op == null ? 1 : op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); s.scale.set(size, size, 1); return s;
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
    mushrooms() {
      const parts = []; for (let i = 0; i < 11; i++) { const a = i / 11 * TAU, r = 3 + Math.sin(i * 2.7) * .3; parts.push(part(G.cyl(.05, .07, .22, 6), '#e8e2d0', Math.cos(a) * r, .11, Math.sin(a) * r)); parts.push(part(G.sph(.14, 1), '#7fd8ff', Math.cos(a) * r, .24, Math.sin(a) * r, 0, 0, 0, 1, .5, 1, { flat: true })); }
      const m = merge(parts, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.2, 1.4, 1.8) })); m.castShadow = false; return grp(m, g => { g.userData.caps = m; });
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
  const MODEL_FOR = { table: ['items5', 'note_scroll', 'paper'], bottle: ['items5', 'bottle_note', 'body'], lectern: ['items5', 'lectern', 'body'], letter: ['items5', 'note_letter', 'body'], rune: ['items5', 'rune_stone', 'body'], feather: ['items5', 'feather_gold', 'body'], star: ['items5', 'fragment_star', 'body'] };
  function makeVisual(kind) {
    const g = PROPS[kind] ? PROPS[kind]() : new THREE.Group();
    const mf = MODEL_FOR[kind];
    if (mf) modelPart(mf[0], mf[1]).then(m => {
      if (!m) return; const old = g.userData[mf[2]]; if (!old) return;
      m.position.copy(old.position); if (mf[2] === 'paper') { m.position.y -= .01; m.rotation.y = .3; } old.visible = false; g.add(m);
    });
    return g;
  }

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
      if (n.poi === 'throne') o.where = () => castleWorld('lectern', 1.0);
      if (kind === 'rune') { o.can = () => revealed(); o.rune = true; }
      if (n.need) { const need = n.need; o.exists = () => all(need); }
      if (kind === 'bottle') o.float = true;
      o.act = () => { readNote(n.id); if (n.id === 'n12') meet('hermit_book'); };
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
    addObj({ id: 'altar_2', poi: 'lunar_glade', kind: 'pick', vis: 'star', dy: 1.3, noSpread: true, exists: () => !W('altar_2') && F.glade && isNight(), label: 'Pegar a luz', icon: '✨', act: () => grantFragment(2) });
    addObj({ id: 'glade_ring', poi: 'lunar_glade', kind: 'decor', vis: 'mushrooms', noSpread: true, exists: () => isNight() });
    addObj({ id: 'altar_5', poi: 'griffin_nest', kind: 'pick', vis: 'star', dy: 1.1, noSpread: true, exists: () => !W('altar_5'), label: 'Pegar a luz', icon: '✨', act: () => grantFragment(5) });
    addObj({ id: 'bay_chest', poi: 'bay_chest', kind: 'pick', vis: 'chest', noSpread: true, r: 3.2, under: true, exists: () => !W('altar_3') && !!W('lighthouse'), label: 'Abrir', icon: '🧰', act: openChest });
    // lighthouse lamp (position comes from the build records)
    addObj({ id: 'lamp', kind: 'spot', dynamic: true, where: () => lh.lamp ? { x: lh.lamp.x, y: lh.lamp.y, z: lh.lamp.z, ry: 0 } : null, r: 3, exists: () => !!lh.lamp && lh.tall && !W('lighthouse') && !lh.lamp.lit, label: 'Acender o farol', icon: '🔥', act: lightLamp });
    // gate lock, throne
    addObj({ id: 'lock', poi: 'castle_gate', kind: 'spot', vis: 'lockDisc', off: OFF.lock, noSpread: true, r: 4, where: () => castleWorld('star_lock', 0), keepVis: true, exists: () => true, can: () => !W('gate') && hasStar(), label: 'Destrancar', icon: '✧', act: openGate });
    addObj({ id: 'throne', poi: 'throne', kind: 'spot', vis: 'throneSet', noSpread: true, r: 3.2, where: () => castleWorld('throne', 0), keepVis: true, exists: () => true,
      can: () => learned('despertar') || !!W('awake'), label: () => W('awake') ? 'Lembrar' : T('spells.despertar.name', '…'), icon: '✦', act: actThrone });
  }
  function castleWorld(name, dy) {
    if (!L.castleObj) return null; const o = L.castleObj(name); if (!o || !o.getWorldPosition) return null;
    o.updateMatrixWorld(true); const v = o.getWorldPosition(new THREE.Vector3()); const q = o.getWorldQuaternion(new THREE.Quaternion()); const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
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
      const d = hyp(x, z, p.x, p.z); if (d > Math.max(r || 0, o.r)) continue;
      out.push({ id: o.id, x: p.x, y: py, z: p.z, label: typeof o.label === 'function' ? o.label() : o.label, icon: o.icon, d, kind: o.kind });
    }
    for (const b of BIRDS) if (b.letter && b.state === 'wait') { const d = hyp(x, z, b.lx, b.lz); if (d <= Math.max(r || 0, 2.6)) out.push({ id: 'mail_' + b.note, x: b.lx, y: b.ly, z: b.lz, label: LABEL.letter, icon: ICON.letter, d, kind: 'note' }); }
    return out.sort((a, b) => a.d - b.d);
  };
  S.interact = function (id) {
    if (!P || S.busy) return false;
    if (/^mail_/.test(id)) { const b = BIRDS.find(q => 'mail_' + q.note === id); if (b) { pickLetter(b); return true; } return false; }
    const o = OBJ_BY[id]; if (!o || !canUse(o)) return false; o.act && o.act(); needEval = true; return true;
  };

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
      finishTask(FORGE_TASK); say(T('ui.key_name'), '✧');
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
  function actThrone() {
    if (W('awake')) { if (!S.endingOn) S.playEnding({ replay: true }); return; }
    tryAwaken();
  }
  function tryAwaken() {
    const o = OBJ_BY.throne, p = resolve(o); if (!p || hyp(PL.x, PL.z, p.x, p.z) > 7) { say(T('spells.despertar.desc'), '✦'); return false; }
    if (!learned('despertar') || !hasStar()) return false;
    if (!isDawn()) { emit('dialog', { gid: 'throne', name: '', lines: [T('ui.need_dawn')] }); return false; }
    S.playEnding(); return true;
  }

  // ------------------------------------------------------------------ world flags from anyone (L.save.on('w5'))
  function onWorld(id, d, local) {
    needEval = true;
    if (id === 'gate' && d) doorT = doorT == null ? (local ? 0 : (S.near('castle_gate', 200) ? 0 : 5)) : doorT;
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
  // 'slept' arrives when the night is over (SYSTEMS sends it at dawn): sleeping the night through at the camp, under a
  // roof and by a burning fire, counts as the whole night
  function sleepVigil() {
    if (W('altar_4') || !taskState('f4') || (F.vigil && F.vigil.done)) return;
    if (vigilGood()) { F.vigil = { night: nightId(), ok: 999, bad: 0, slept: true, done: true }; changed(); emit('vigil', { done: true }); }
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
    mana.use(sp.mana || 0); CD[id] = tNow + (sp.cd || 0);
    if (L.onSpell) L.onSpell(id); emit('cast', { id }); emit('sfx', 'spell_' + id);
    return { ok: true };
  };
  const SPELL_FX = {
    faisca(c) { let lit = false; if (L.lightFireNear) lit = !!L.lightFireNear(c.x, c.z, 6); FX.warm = tNow + 60; if (L.surv && L.surv.warm) L.surv.warm(60); sparks(c, 0xffa040, 26); if (lit) S.event('fire_lit', { x: c.x, z: c.z }); return true; },
    brotar(c) { if (L.farm && L.farm.boost) L.farm.boost(c.x, c.z, 4); if (L.refillBushes) L.refillBushes(c.x, c.z, 4); sparks(c, 0x9fe070, 30); return true; },
    luz() { FX.luz = tNow + 90; return true; },
    mare(c) { FX.mare = tNow + 20; if (L.farm) { if (L.farm.waterArea) L.farm.waterArea(c.x, c.z, 8); else if (L.farm.water) L.farm.water({ x: c.x, z: c.z, r: 8 }); } sparks(c, 0x7fd0ff, 30); return true; },
    ponte(c) { return makeBridge(c); },
    revelar() { FX.rev = tNow + 60; if (inMist(PL.x, PL.z) > 0 || distMistEdge() < 400) openPath(); return true; },
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
    const m = M(); if (!m || W('awake')) { if (MS.white > 0) { MS.white = Math.max(0, MS.white - dt); emit('white', { a: MS.white, text: null }); } closePath(dt); return; }
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
      emit('white', { a: MS.white, text: MS.white > .3 ? MS.line : null });
      if (blocked && MS.white >= .999) { MS.phase = 1; MS.t = 0; }
    } else if (MS.phase === 1) {
      MS.t += dt; emit('white', { a: 1, text: MS.line });
      if (MS.t > .9) { const s = safePoint(); teleport(s[0], s[1], s[2]); MS.phase = 2; MS.t = 0; }
    } else if (MS.phase === 2) {
      MS.t += dt; MS.white = Math.max(0, 1 - MS.t / 1.8); emit('white', { a: MS.white, text: MS.t < 1 ? MS.line : null });
      if (MS.t > 1.8) { MS.phase = 0; MS.line = null; }
    }
    // the path of lights while the word of seeing is active
    if (revOn && (depth > 0 || distMistEdge() < 400)) openPath(); else if (!pass) closePath(dt);
    if (MS.open > 0) MS.open = Math.min(1, MS.open + dt * .5);
    if (pass && depth > .1 && !F.castle_seen && !S.endingOn && !shot) revealShot();
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
  function pickLetter(b) { b.state = 'away'; b.t = 0; b.letter = false; if (b.lmesh) { L.scene.remove(b.lmesh); b.lmesh = null; } readNote(b.note); emit('sfx', 'pick'); }
  function birdSteer(b, tx, ty, tz, sp, dt, k) {
    const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z, d = Math.hypot(dx, dy, dz) || 1;
    const want = Math.min(sp, d * 1.5 + .2);
    b.vx = lerp(b.vx, dx / d * want, clamp(dt * (k || 2.2), 0, 1)); b.vy = lerp(b.vy, dy / d * want, clamp(dt * (k || 2.2), 0, 1)); b.vz = lerp(b.vz, dz / d * want, clamp(dt * (k || 2.2), 0, 1));
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; return d;
  }
  function birdTick(b, dt) {
    b.t += dt; let flapHz = 9;
    if (b.state === 'in') { const d = birdSteer(b, PL.x, PL.y + 5, PL.z, 11, dt); if (d < 7) { b.state = 'circle'; b.t = 0; b.ca = Math.atan2(b.x - PL.x, b.z - PL.z); } }
    else if (b.state === 'circle') {
      b.ca += dt * 1.25; const r = 4.5; const d = birdSteer(b, PL.x + Math.sin(b.ca) * r, PL.y + 3.4 + Math.sin(b.t * 2) * .4, PL.z + Math.cos(b.ca) * r, 7, dt, 4); flapHz = 6;
      if ((b.t > 5.5 && d < 3) || b.t > 9) {
        b.state = 'land'; b.t = 0; const a = PL.ry || 0; b.lx = PL.x + Math.sin(a) * 2.2 + Math.cos(a) * .6; b.lz = PL.z + Math.cos(a) * 2.2 - Math.sin(a) * .6;
        b.ly = L.groundAt ? L.groundAt(b.lx, b.lz, PL.y + 1, 2).y : groundY(b.lx, b.lz, PL.y);
      }
    } else if (b.state === 'land') {
      const d = birdSteer(b, b.lx, b.ly + .05, b.lz, 4, dt, 3); flapHz = 5;
      if (d < .12) { b.state = 'wait'; b.t = 0; b.x = b.lx; b.y = b.ly + .05; b.z = b.lz; b.vx = b.vy = b.vz = 0; if (b.letter && has3D()) { b.lmesh = makeVisual('letter'); b.lmesh.position.set(b.lx + .35, b.ly, b.lz + .1); b.lmesh.rotation.y = Math.random(); L.scene.add(b.lmesh); } emit('mail', { note: b.note }); }
    } else if (b.state === 'wait') {
      flapHz = 0; b.flap = Math.sin(b.t * 1.3) > .96 ? Math.sin(b.t * 30) * .6 : lerp(b.flap, -.15, dt * 4);
      if (hyp(PL.x, PL.z, b.lx, b.lz) > 70) { b.state = 'away'; b.t = 0; if (b.lmesh) { L.scene.remove(b.lmesh); b.lmesh = null; } b.letter = false; birdCD = 30; }
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
  function makeBird() {
    const root = new THREE.Group(); root.scale.setScalar(1.7);
    const body = merge([part(new THREE.ConeGeometry(.045, .3, 4), '#f4f1ea', 0, 0, .02, Math.PI / 2, 0, 0, 1, 1, 1, { lo: .86 }), part(new THREE.ConeGeometry(.03, .1, 3), '#e9e4d8', 0, .05, .2, -.6, 0, 0)], mats().bird);
    root.add(body);
    const wing = s => { const g = new THREE.BufferGeometry(); const v = new Float32Array([0, 0, .1, 0, 0, -.1, s * .27, .02, -.03]); g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(part(g, '#f7f4ee', 0, 0, 0, 0, 0, 0, 1, 1, 1, { flat: true }), mats().bird); m.position.y = .02; return m; };
    const wl = wing(1), wr = wing(-1); root.add(wl); root.add(wr); root.userData.wl = wl; root.userData.wr = wr;
    modelFile('paperbird').then(sc => { if (!sc) return; const c = sc.clone(true); let l = null, r = null; c.traverse(o => { if (o.isMesh) { o.material = mats().v; o.castShadow = true; } if (/paperbird_wing_l$/i.test(o.name)) l = o; if (/paperbird_wing_r$/i.test(o.name)) r = o; }); root.remove(body); root.remove(wl); root.remove(wr); root.scale.setScalar(1); root.add(c); if (l && r) Object.assign(root.userData, { wl: l, wr: r, axis: 'y', l0: l.rotation.y, r0: r.rotation.y }); });
    return root;
  }
  // a guide (stuck helper bird, or the lunar deer) leads to a target and waits when the player stops
  function guideTick(b, dt) {
    const tx = b.tx, tz = b.tz, dp = hyp(PL.x, PL.z, b.x, b.z), dt2 = hyp(b.x, b.z, tx, tz), pt = hyp(PL.x, PL.z, tx, tz);
    let flap = 7;
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
    if (deer && hyp(PL.x, PL.z, deer.x, deer.z) > 90) { if (deer.root) L.scene.remove(deer.root); deer = null; return; } // she travelled away: appear again near her
    if (!deer) return;
    deer.t += dt; const dg = hyp(deer.x, deer.z, g.x, g.z), dp = hyp(PL.x, PL.z, deer.x, deer.z);
    let sp = 0;
    if (dg > 2.5) { if (hyp(PL.x, PL.z, g.x, g.z) < 22) sp = 2.6; else if (dp < 16 && PL.v > .3) sp = Math.min(PL.v + .8, 5); else if (dp < 9) sp = .9; }
    else if (hyp(PL.x, PL.z, g.x, g.z) < 16 && !F.glade) { F.glade = 1; changed(); emit('sfx', 'star'); }
    if (sp > 0) { const a = Math.atan2(g.x - deer.x, g.z - deer.z); deer.ry = a; deer.x += Math.sin(a) * sp * dt; deer.z += Math.cos(a) * sp * dt; deer.y = groundY(deer.x, deer.z, deer.y); }
    else if (dp < 30) deer.ry = lerp(deer.ry, Math.atan2(PL.x - deer.x, PL.z - deer.z), dt * 1.5);
    deer.v = lerp(deer.v, sp, dt * 4);
    if (deer.root) { deer.root.position.set(deer.x, deer.y, deer.z); deer.root.rotation.y = deer.ry; if (deer.I && L.quadAnim) { const s = deer.st; s.speed = deer.v; s.turn = 0; s.t = deer.t; s.dt = dt; s.look = [0, 0]; s.graze = sp ? 0 : .2; s.sit = 0; L.quadAnim(deer.I.rig, s); } }
    if (!isNight() || W('altar_2')) { if (deer.root) L.scene.remove(deer.root); deer = null; }
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
      else { const u = clamp((f.t - 1.8) / .9, 0, 1), e = u * u; m.position.set(lerp(f.x0, PL.x, e), lerp(f.y0 + 1.6, PL.y + 1.2, e) + Math.sin(u * Math.PI) * .8, lerp(f.z0, PL.z, e)); m.scale.setScalar(1.2 * (1 - e) + .1); m.rotation.y += dt * 9; if (u >= 1) { sparks({ x: PL.x, y: PL.y, z: PL.z }, 0xffe6a8, 30); L.scene.remove(m); FLY.splice(i, 1); } }
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
    const left = FX.luz - tNow, fade = clamp(left / 3, 0, 1) * clamp((90 - left) / .8, 0, 1);
    const a = (PL.ry || 0) + 2.4, tx = PL.x + Math.sin(a) * .9, tz = PL.z + Math.cos(a) * .9, ty = PL.y + 2.3 + Math.sin(tNow * 1.8) * .18;
    orb.position.x = lerp(orb.position.x, tx, clamp(dt * 3, 0, 1)); orb.position.y = lerp(orb.position.y, ty, clamp(dt * 3, 0, 1)); orb.position.z = lerp(orb.position.z, tz, clamp(dt * 3, 0, 1));
    orb.userData.halo.material.opacity = .55 * fade; orb.children[0].material.opacity = fade; orb.userData.halo.scale.setScalar(3.2 + Math.sin(tNow * 3) * .2);
    if (orbLight && !orbLight.isLight) { orbLight.x = orb.position.x; orbLight.y = orb.position.y; orbLight.z = orb.position.z; orbLight.i = 2.2 * fade; } else if (orbLight) orbLight.intensity = 1.6 * fade;
    if (!on) { L.scene.remove(orb); orb = null; if (orbLight && !orbLight.isLight && L.LIGHTS) { const i = L.LIGHTS.indexOf(orbLight); if (i >= 0) L.LIGHTS.splice(i, 1); } orbLight = null; }
  }
  let bridge = null;
  function makeBridge(c) {
    if (bridge) removeBridge();
    const dirx = Math.sin(c.yaw), dirz = Math.cos(c.yaw); const slope = clamp(-(c.pitch || 0) * .35, -.18, .3);
    const y0 = (c.y || 0) - .02; let len = 0;
    for (let i = 1; i <= 40; i++) { const x = c.x + dirx * i, z = c.z + dirz * i, top = y0 + slope * i; len = i; if (groundY(x, z, -1e9) > top + .25 && i > 2) break; }
    if (len < 3) return false;
    const y1 = y0 + slope * len;
    const col = L.addCol ? L.addCol({ x: c.x + dirx * len / 2, z: c.z + dirz * len / 2, rot: c.yaw, hx: 1.05, hz: len / 2 + .3, y0: Math.min(y0, y1) - .6, y1: y0, y2: y1, bridge: 1 }) : null;
    bridge = { x: c.x, y: y0, z: c.z, dx: dirx, dz: dirz, slope, len, col, t0: tNow, end: tNow + 25, puffs: [] };
    if (has3D()) {
      const n = Math.round(len * 2.6), geo = new THREE.IcosahedronGeometry(1, 1), mat = mats().cloud.clone(); mat.transparent = true;
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
  function removeBridge() { if (!bridge) return; if (bridge.col && L.delCol) L.delCol(bridge.col); if (bridge.mesh) { L.scene.remove(bridge.mesh); bridge.mesh.geometry.dispose(); bridge.mesh.material.dispose(); } bridge = null; }
  S.bridgeState = () => bridge ? { len: bridge.len, left: bridge.end - tNow, col: !!bridge.col } : null;
  let beam = null;
  function beamTick() {
    const L3 = W('lighthouse'), chest = poi('bay_chest'); const want = !!L3 && isNight() && !!chest && has3D();
    if (want && !beam) {
      const len = 1, g = new THREE.CylinderGeometry(9, .45, len, 24, 1, true); g.translate(0, -len / 2, 0); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mats().beam); m.frustumCulled = false; m.renderOrder = 4; beam = new THREE.Group(); beam.add(m); beam.userData.m = m;
      const gl = glowSprite(0xffefc0, 6, .9); beam.add(gl); L.scene.add(beam);
    }
    if (!beam) return;
    if (!want) { L.scene.remove(beam); beam = null; return; }
    const src = lh.lamp || L3; beam.position.set(src.x, src.y + 1.2, src.z);
    const tx = chest.x, tz = chest.z, ty = Math.max(-1, (L.waterAt ? L.waterAt(tx, tz) : 0)); const d = Math.hypot(tx - src.x, ty - src.y, tz - src.z);
    beam.lookAt(tx, ty, tz); beam.userData.m.scale.set(1, 1, d * 1.0); mats().beam.uniforms.uA.value = 1; mats().beam.uniforms.uT.value = tNow;
  }

  // ------------------------------------------------------------------ sleeper on the throne + the finale
  let sleeper = null, doorT = null, restoreT = null;
  function sleeperTick(dt) {
    const th = OBJ_BY.throne, p = th && resolve(th); if (!p || !has3D()) return;
    const near = hyp(PL.x, PL.z, p.x, p.z) < 160;
    if (near && !sleeper) {
      sleeper = { root: new THREE.Group(), t: 0, pose: { sit: 1, slump: 1, lift: 0, stand: 0, breathe: 1 }, I: null };
      sleeper.root.position.set(p.x, p.y, p.z); sleeper.root.rotation.y = p.ry; L.scene.add(sleeper.root);
      if (!castleWorld('throne')) { const t = PROPS.throne(); sleeper.root.add(t); sleeper.throne = t; }
      const ivy = PROPS.ivy(); ivy.position.z = .1; sleeper.root.add(ivy); sleeper.ivy = ivy;
      const halo = glowSprite(0xffe6a8, 3, 0); halo.position.set(0, 1.5, .1); sleeper.root.add(halo); sleeper.halo = halo;
      loadSleeper();
    }
    if (!sleeper) return;
    sleeper.t += dt; const s = sleeper, po = s.pose;
    if (W('awake') && !S.endingOn) { po.sit = 0; po.slump = 0; po.lift = 1; po.stand = 1; if (s.ivy) s.ivy.visible = false; }
    if (s.I) poseSleeper(s, dt);
    else if (s.fallback) { s.fallback.position.y = .62 + po.stand * .35; s.fallback.rotation.x = .25 * po.slump; }
    if (s.ivy) s.ivy.scale.setScalar(Math.max(.001, 1 - (po.ivyGone || 0)));
  }
  function loadSleeper() {
    const tryList = ['king', 'hero_m', 'mage_m'];
    const next = i => { if (i >= tryList.length || !L.loadModel) return fallbackSleeper(); modelFile(tryList[i]).then(src => { if (!src || !L.instRigged) return next(i + 1); attachSleeper(src, tryList[i]); }); };
    next(0);
  }
  function attachSleeper(src, name) {
    if (!sleeper) return; const I = L.instRigged(src, {}); sleeper.I = I; sleeper.model = name; sleeper.root.add(I.root);
    if (name !== 'king') { // a stand-in until the dedicated model exists: deep-blue tint, a thin gold circlet, a white beard
      const mat = (I.meshes[0] && I.meshes[0].material && I.meshes[0].material.clone()) || null; if (mat) { mat.color = new THREE.Color(.55, .62, 1.15); I.meshes.forEach(m => m.material = mat); }
      const head = I.rig.e('head'); if (head) { const h = head.o; const crown = merge([part(new THREE.TorusGeometry(.11, .012, 6, 18), '#e2b84f', 0, .22, 0, Math.PI / 2), ...[0, 1, 2, 3, 4].map(i => part(G.cone(.018, .06, 4), '#e2b84f', Math.sin(i / 5 * TAU) * .11, .26, Math.cos(i / 5 * TAU) * .11))]); h.add(crown); const beard = merge([part(G.cone(.09, .32, 7), '#f2efe8', 0, -.04, .09, Math.PI, 0, 0, 1, 1, .6)]); h.add(beard); sleeper.crown = crown; } }
    else I.root.traverse(o => { if (/crown_glow/.test(o.name)) { o.visible = false; sleeper.crownGlow = o; } });
  }
  function fallbackSleeper() {
    if (!sleeper) return; const g = new THREE.Group(); g.add(merge([part(G.cyl(.32, .45, 1.2, 10), '#2f4b8f', 0, .6, 0), part(G.sph(.17, 1), '#e9cfb4', 0, 1.35, .02), part(G.cone(.12, .4, 7), '#f2efe8', 0, 1.15, .14, Math.PI, 0, 0), part(new THREE.TorusGeometry(.15, .02, 6, 16), '#e2b84f', 0, 1.5, 0, Math.PI / 2)]));
    g.position.y = .62; sleeper.root.add(g); sleeper.fallback = g;
  }
  function poseSleeper(s, dt) {
    const I = s.I, rig = I.rig, po = s.pose; rig.reset();
    const H = rig.hipH || .95, seat = .62, sit = po.sit * (1 - po.stand), slump = po.slump * (1 - po.lift), br = Math.sin(s.t * 1.1) * .03 * (po.breathe || 0);
    for (const sd of ['L', 'R']) { const sg = sd === 'L' ? 1 : -1; rig.r('thigh.' + sd, -1.5 * sit, 0, sg * .08 * sit); rig.r('shin.' + sd, 1.5 * sit); rig.r('foot.' + sd, -.1 * sit); rig.r('upperarm.' + sd, -.55 * sit, 0, sg * -.45 * (1 - .4 * sit)); rig.r('forearm.' + sd, -.75 * sit); }
    rig.p('hips', 0, -(H - seat - .1) * sit, -.12 * sit);
    rig.r('spine', .28 * slump + br); rig.r('chest', .12 * slump - br * .5); rig.r('neck', .25 * slump); rig.r('head', .55 * slump - .1 * po.lift * (1 - po.stand));
    rig.apply();
    I.root.position.set(0, 0, .08 * sit);
    if (s.crownGlow) s.crownGlow.visible = (po.glow || 0) > .3;
    if (s.halo) s.halo.material.opacity = (po.glow || 0) * .7;
  }
  // timeline (seconds) of the finale; text and camera come from here, overlay drawing from storyui
  const END = { start: 0, star: 2.6, ivy: 7, lift: 14, out: 18, restore: [19, 33], mist: [31, 41], birds: 33, back: 42, stand: [43, 47], lines: [47.5, 53, 58.5, 64], title: 70, personal: 77, end: 88 };
  let EN = null;
  S.endingOn = false;
  S.playEnding = function (opt) {
    if (S.endingOn) return; const th = OBJ_BY.throne, p = resolve(th); if (!p) return;
    const c = poi('castle') || p;
    EN = { t: 0, p, c, replay: !!(opt && opt.replay), skippable: !!F.seenEnd || !!(opt && opt.replay), lineI: -1, flags: {}, personal: !!T('ending.personal_text', '') };
    S.endingOn = true; F.endStarted = 1;
    if (!W('awake')) { setW('awake', stamp()); worldEvent('awake', {}); }
    emit('ending', { phase: 'start', skippable: EN.skippable }); emit('sfx', 'ending');
  };
  S.skipEnding = function () { if (!EN || !EN.skippable) return false; EN.t = Math.max(EN.t, END.end - .1); return true; };
  function endTick(dt) {
    if (!EN) return; const e = EN; e.t += dt; const t = e.t, p = e.p, c = e.c;
    const fx = Math.sin(p.ry), fz = Math.cos(p.ry), sx = Math.cos(p.ry), sz = -Math.sin(p.ry);
    const po = sleeper ? sleeper.pose : {};
    const once = (k, fn) => { if (!e.flags[k]) { e.flags[k] = 1; fn(); } };
    // camera
    if (t < END.out) { const u = sstep(0, END.out, t); const d = lerp(7.5, 3.2, u), up = lerp(2.6, 1.75, u), side = Math.sin(u * 2.2) * 1.2; setCam(p.x + fx * d + sx * side, p.y + up, p.z + fz * d + sz * side, p.x, p.y + lerp(1.3, 1.55, u), p.z, 45); }
    else if (t < END.back) { const u = sstep(END.out, END.back, t); const a = Math.atan2(p.x - c.x, p.z - c.z) + Math.PI + lerp(-.5, .35, u); const R = lerp(150, 230, u), H = lerp(55, 120, u); setCam(c.x + Math.sin(a) * R, (c.y || p.y) + H, c.z + Math.cos(a) * R, c.x, (c.y || p.y) + lerp(30, 45, u), c.z, 50); }
    else { const u = (t - END.back) / (END.end - END.back); const a = Math.sin(u * 2.4) * .55; const d = lerp(5.5, 7.5, u); setCam(p.x + (fx * Math.cos(a) + sx * Math.sin(a)) * d, p.y + lerp(1.7, 2.6, u), p.z + (fz * Math.cos(a) + sz * Math.sin(a)) * d, p.x, p.y + lerp(1.7, 1.95, u * u), p.z, 45); }
    if (Math.abs(t - END.out) < dt || Math.abs(t - END.back) < dt) emit('ending', { phase: 'blink' });
    // the star travels to the throne
    once('star', () => { if (has3D()) { const m = makeVisual('star'); m.position.set(PL.x, PL.y + 1.2, PL.z); L.scene.add(m); e.star = m; } });
    if (e.star) { const u = sstep(0, END.star, t); e.star.position.set(lerp(PL.x, p.x + fx * .3, u), lerp(PL.y + 1.2, p.y + .95, u) + Math.sin(u * Math.PI) * .6, lerp(PL.z, p.z + fz * .3, u)); e.star.rotation.y += dt * 4; e.star.scale.setScalar(t > END.lift ? Math.max(.01, 1 - (t - END.lift) / 2) : 1 + Math.sin(t * 3) * .05); if (t > END.lift + 2) { L.scene.remove(e.star); e.star = null; } }
    po.glow = sstep(END.star, END.star + 2, t); po.ivyGone = sstep(END.ivy, END.ivy + 5, t); po.breathe = 1;
    po.lift = sstep(END.lift - 2, END.lift + 2.5, t); po.slump = 1; po.sit = 1; po.stand = sstep(END.stand[0], END.stand[1], t);
    // the place heals, the white clears, the birds fly out
    const rp = sstep(END.restore[0], END.restore[1], t); if (L.castleRestore) L.castleRestore(rp); emit('restore', rp);
    const mp = sstep(END.mist[0], END.mist[1], t); if (L.mistVisual && L.mistVisual.dissolve) L.mistVisual.dissolve(mp);
    if (t >= END.birds) once('birds', () => burstBirds(c)); if (t >= END.birds + 2.5) once('birds2', () => burstBirds(c));
    // words
    for (let i = END.lines.length - 1; i >= 0; i--) if (t >= END.lines[i]) { if (e.lineI < i) { e.lineI = i; emit('ending', { phase: 'line', i, text: T('ending.lines.' + i) }); } break; }
    if (t >= END.title) once('title', () => emit('ending', { phase: 'title', text: T('ui.title_end') }));
    if (t >= END.personal && e.personal) once('pers', () => emit('ending', { phase: 'personal', title: T('ending.personal_title', ''), text: T('ending.personal_text', '') }));
    const endAt = e.personal ? END.end : END.personal + 2;
    if (t >= endAt) finishEnding();
  }
  function burstBirds(c) { for (let i = 0; i < 14; i++) { const a = Math.random() * TAU; const b = launchBird({ state: 'burst', letter: false }); b.x = c.x + Math.sin(a) * 8; b.y = (c.y || 0) + 25 + Math.random() * 20; b.z = c.z + Math.cos(a) * 8; b.vx = Math.sin(a) * (6 + Math.random() * 5); b.vz = Math.cos(a) * (6 + Math.random() * 5); b.vy = 2 + Math.random() * 3; b.t = Math.random(); } }
  function finishEnding() {
    const e = EN; EN = null; S.endingOn = false; clearCam();
    if (L.castleRestore) L.castleRestore(1); if (L.mistVisual && L.mistVisual.dissolve) L.mistVisual.dissolve(1);
    if (!e.replay) {
      F.seenEnd = 1; F.crown = 1; changed(); setW('home_keep', stamp()); setW('lit_village', stamp());
      if (L.giveTame) { try { L.giveTame('dragao_bebe'); } catch (er) { console.warn(er); } }
      if (L.onStoryLook) L.onStoryLook(S.look()); emit('look', S.look());
      const c = e.c, gt = poi('castle_gate') || c; const x = lerp(c.x, gt.x, .2), z = lerp(c.z, gt.z, .2); teleport(x, groundY(x, z, e.p.y) + .1, z);
    }
    emit('ending', { phase: 'end' }); progressMade(); needEval = true;
  }
  function doorTick(dt) {
    if (doorT == null) return; doorT += dt; const u = sstep(0, 5, doorT);
    if (L.castleObj) { const l = L.castleObj('gate_door_l'), r = L.castleObj('gate_door_r'); if (l) { l.userData.ry0 = l.userData.ry0 != null ? l.userData.ry0 : l.rotation.y; l.rotation.y = l.userData.ry0 - 1.7 * u; } if (r) { r.userData.ry0 = r.userData.ry0 != null ? r.userData.ry0 : r.rotation.y; r.rotation.y = r.userData.ry0 + 1.7 * u; } const g = L.castleObj('star_lock_glow'); if (g) g.visible = true; }
    const lk = OBJ_BY.lock; if (lk && lk.mesh && lk.mesh.userData.star) { lk.mesh.userData.star.material.color.setRGB(lerp(.25, 1.6, u), lerp(.22, 1.3, u), lerp(.18, .7, u)); }
    if (doorT > 5.2) doorT = 5.2;
  }
  function restoreTick(dt) { if (restoreT == null || S.endingOn) return; restoreT += dt; const u = sstep(0, 15, restoreT); if (L.castleRestore) L.castleRestore(u); if (L.mistVisual && L.mistVisual.dissolve) L.mistVisual.dissolve(u); if (u >= 1) restoreT = null; }

  // ------------------------------------------------------------------ visuals of placed objects (lazy, near the player)
  const VIS_R = 140; let visT = 0;
  function visTick(dt) {
    visT -= dt; if (visT <= 0) {
      visT = .4;
      for (const o of OBJ) {
        const p = resolve(o); if (!p || !o.vis) continue;
        const d = hyp(PL.x, PL.z, p.x, p.z), show = d < VIS_R && (o.keepVis || exists(o));
        if (show && !o.mesh && has3D() && o.vis !== 'throneSet') {
          if (o.vis === 'spirit') o.mesh = makeSpirit(); else if (o.vis === 'lockDisc' && L.castleObj && L.castleObj('star_lock')) o.mesh = new THREE.Group(); else o.mesh = makeVisual(o.vis);
          o.mesh.position.set(p.x, p.y, p.z); o.mesh.rotation.y = p.ry || 0; o.base = p.y; L.scene.add(o.mesh); o.fade = 0;
        }
        if (o.mesh) { o.mesh.visible = show || (o.fade > .02 && o.rune); o.near = show && d < 60; if (!show && !o.rune && d > VIS_R + 60) { L.scene.remove(o.mesh); o.mesh = null; } }
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
  function makeSpirit() {
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
  S.tick = function (dt) {
    bindPlayer();
    dt = Math.min(dt || 0, .1); tNow += dt; readPlayer(dt);
    if (!S.busy && !S.uiOpen) F.playT = (F.playT || 0) + dt;
    if (birdCD > 0) birdCD -= dt;
    if (!MEM_SAVE() && MEM.mana < 100) MEM.mana = Math.min(100, MEM.mana + dt * 1.5);
    mistTick(dt); shotTick(dt); endTick(dt); doorTick(dt); restoreTick(dt);
    for (let i = BIRDS.length - 1; i >= 0; i--) { const b = BIRDS[i]; if (b.onArrive === 'guide' && b.state === 'circle') { b.state = 'guide'; b.onArrive = null; } birdTick(b, dt); if (b.dead) { if (b.mesh) L.scene.remove(b.mesh); if (b.lmesh) L.scene.remove(b.lmesh); BIRDS.splice(i, 1); } }
    if (wokeWait > 0) { wokeWait -= dt; if (wokeWait <= 0 && (pendingDream || F.hintDream) && !(L.surv && L.surv.sleeping)) wakeUp(); }
    bridgeTick(); if (has3D()) { visTick(dt); flyTick(dt); orbTick(dt); beamTick(); sleeperTick(dt); if (PART && PART.update) PART.update(dt); }
    deerTick(dt);
    if (thoughtCD > 0) thoughtCD -= dt; else if (thoughtQ.length && !S.busy && !S.uiOpen) { const id = thoughtQ.shift(); emit('thought', { id, text: T('thoughts.' + id + '.text') }); thoughtCD = 8; }
    midT -= dt; if (midT <= 0) { midT = 1; vigilTick(1); lhCheckT -= 1; if (lhCheckT <= 0) { lhCheckT = 3; lhCheck(); } }
    seenT -= dt; if (seenT <= 0) { seenT = 2; for (const [id, r, f] of SEEN) if (!F[f] && S.near(id, r)) setF(f); }
    mailT -= dt; if (mailT <= 0) { mailT = 2; mailTick(); }
    stuckT -= dt; if (stuckT <= 0) { stuckT = 5; stuckTick(); }
    slowT -= dt; if (needEval || slowT <= 0) { slowT = 2; evalAll(); }
    if (L.storyUI && L.storyUI.tick) L.storyUI.tick(dt);
  };
  const MEM_SAVE = () => !!(L.surv || (L.save && L.save.player && L.save.player.st && typeof L.save.player.st.mana === 'number'));

  // ------------------------------------------------------------------ init
  S.init = function () {
    loadLore(); bindPlayer(); buildObjects();
    if (L.save && L.save.on && !S._listening) { S._listening = true; try { L.save.on('w5', (id, d, old, origin) => onWorld(id, d, origin === 'local')); } catch (e) { } }
    if (L.save && L.save.player) { /* nothing else: state lives in the record */ }
    if (F.progT == null) { F.progT = F.playT || 0; F.mainN = mainProgress(); }
    if (W('gate')) doorT = 5; if (W('awake')) { if (L.castleRestore) L.castleRestore(1); if (L.mistVisual && L.mistVisual.dissolve) L.mistVisual.dissolve(1); }
    S.ready = true; needEval = true; emit('init', null);
    if (L.storyUI && L.storyUI.init) L.storyUI.init();
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
    learn: id => learn(id),
    world: (id, d) => setW(id, d === undefined ? stamp() : d),
    eval: () => evalAll(),
    forgeTask: () => FORGE_TASK,
    tasks: () => S.taskView(),
    tick: (sec, step) => { step = step || .1; for (let t = 0; t < sec; t += step) S.tick(step); },
    lh: () => Object.assign({}, lh),
    birds: () => BIRDS.map(b => ({ state: b.state, note: b.note || null, guide: !!b.tx && !b.letter, x: b.x, y: b.y, z: b.z, tx: b.tx, tz: b.tz })),
    skipShot: () => { if (shot) { shot.t = shot.dur; shotTick(0); } },
    // dev harness helpers: a fresh visual of a placed-object kind, the sleeper's state, a letter bird on demand
    visual: kind => (kind === 'spirit' ? makeSpirit() : kind === 'bird' ? makeBird() : makeVisual(kind)),
    sleeper: () => (sleeper ? { model: sleeper.model || (sleeper.fallback ? 'fallback' : null), pose: Object.assign({}, sleeper.pose) } : null),
    bird: note => { const b = launchBird({ note: note || null }); if (!note) b.letter = false; return BIRDS.length; },
  };
})(window.L);
