/* Lumiar v5 game (B-game owns this file after phase A): boot + loading, start screen, save/session, player spawn,
   the main loop (fixed system order, per-system timing), action button, presence, debug hooks.
   The v4 game (harvesting, crafting, building UI, taming, chests, audio) is in git history for B-game to port.
   Contract: v5docs/INTEG.md. Main loop order (INTEG §3.2): input → player → camera → clock → time of day → look →
   streaming → scatter/grass → creatures → build → story → survival → farm → presence/explored → UI → render.
   Other owners never edit this file: each frame it calls their entry points once with one shared ctx (INTEG §3.3):
   L.worldTick (B-world), L.actorsTick + L.buildsTick (B-actors), L.uiTick (B-ui). The stubs below run until the
   owner defines the real function in their own file (loaded earlier). */
'use strict';
(function (L) {
  const QS = new URLSearchParams(location.search);
  const now = () => performance.now();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const TAU = Math.PI * 2;
  const wrapA = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  const yieldUI = () => new Promise(r => setTimeout(r, 0));

  const G = L.game = { phase: 'boot', started: false, times: {}, look: { g: 'f', pal: 0 }, M: null, err: {}, t: 0 };
  const DBG = L.DBG = L.DBG || {};
  const P = L.P, cam = L.cam;

  // ================================================================ per-system timing (?dbg=1 shows it)
  const SYS = ['input', 'player', 'camera', 'clock', 'look', 'stream', 'scatter', 'creatures', 'build', 'story', 'surv', 'farm', 'net', 'ui', 'render'];
  const TM = {}; SYS.forEach(k => TM[k] = { avg: 0, max: 0, win: 0, peak: 0 });
  function run(k, fn) {
    const t0 = now();
    try { fn(); } catch (e) { if (!G.err[k]) { G.err[k] = 1; console.error('[game] ' + k, e); } }
    const d = now() - t0, s = TM[k]; s.avg = s.avg * .95 + d * .05; if (d > s.win) s.win = d; if (d > s.peak) s.peak = d;
  }
  // { stage: [avg ms, max ms of the last 0.5 s, peak ms since entering / the last resetPeaks()] }
  G.timing = () => { const o = {}; for (const k of SYS) o[k] = [+TM[k].avg.toFixed(2), +TM[k].max.toFixed(2), +TM[k].peak.toFixed(1)]; return o; };
  G.resetPeaks = () => { for (const k of SYS) TM[k].peak = 0; };

  // ================================================================ boot (loading screen)
  const wantLook = (() => { try { const l = JSON.parse(localStorage.getItem('lumiar5:last') || 'null'); if (l && l.g) return { g: l.g === 'm' ? 'm' : 'f', pal: (l.pal | 0) % 3 }; } catch (e) { } return { g: 'f', pal: 0 }; })();
  G.look = wantLook;
  async function boot() {
    const t0 = now(); G.times.t0 = Math.round(t0);
    L.ui.loading(.02, 'Preparando o mundo…');
    // what the first view needs: world data, textures, the hero, trees + rocks near the spawn.
    // Later (after the start screen shows): POI dressing (village, props, totems), creatures, build kits, map image.
    L.MAP_LAZY = true;
    const nat = {}; const jobs = [L.worldLoad(), L.loadTextures(), L.loadModel('hero_' + wantLook.g), L.loadModel('trees5').then(s => nat.trees5 = s), L.loadModel('rocks5').then(s => nat.rocks5 = s)];
    let done = 0; jobs.forEach(p => Promise.resolve(p).then(() => { done++; L.ui.loading(.05 + .5 * done / jobs.length); }, () => { done++; }));
    await Promise.all(jobs);
    G.times.data = Math.round(now() - t0);
    L.ui.loading(.58, 'Erguendo as montanhas…'); await yieldUI();
    L.makeMaterials(); L.skyInit();
    L.setTimeOfDay(L.clock.sky());
    if (L.cloudSea) { L.cloudSea.setY(L.CLOUD_Y); L.cloudSea.setDensityMap(L.cloudMaskTexture(), -L.WS, -L.WS, 2 * L.WS); }
    if (L.mistVisual && L.MIST) L.mistVisual.setDisc(L.MIST.x, L.MIST.z, L.MIST.r);
    L.terrainInit(); L.scatterInit(nat); L.grassInit();
    G.times.init = Math.round(now() - t0);
    // title view: the spawn, seen from behind the hero
    const sp = spawnPoint(null); placePlayer(sp);
    G.M = await makeHero(wantLook);
    cameraSnap();
    L.ui.loading(.62, 'Plantando a floresta…');
    const tS = now();
    for (let i = 0; i < 400; i++) {
      L.camera.updateMatrixWorld();
      const a = L.terrainUpdate(L.camera.position, 40), b = L.scatterUpdate(L.camera, 25);
      L.ui.loading(.62 + .33 * Math.min(1, i / 40));
      if (a && b) break; if (now() - tS > 20000) break;
      await yieldUI();
    }
    L.scatterSettle && L.scatterSettle(P.x, P.z, L.camera);
    L.grassUpdate(P.x, P.z, true);
    G.times.settle = Math.round(now() - tS);
    L.ui.loading(.97, 'Quase lá…'); await yieldUI();
    try { L.lookPrecompile(L.camera); } catch (e) { console.warn('precompile', e); }
    G.times.title = Math.round(now() - t0);
    G.phase = 'title'; L.ui.loading(1);
    L.resize(); requestAnimationFrame(frame);
    // background: dressing, creatures, building kits (the start screen is up meanwhile)
    later();
    L.ui.on('look', lk => { if (G.phase === 'title' && (lk.g !== G.look.g || lk.pal !== G.look.pal)) { G.look = lk; swapHero(lk); } });
    const choice = await L.ui.start();
    await enter(choice);
  }
  function later() {
    const t0 = now();
    const w = Promise.resolve(L.worldInit ? L.worldInit() : null).then(() => { G.times.dress = Math.round(now() - t0); }, e => console.warn('worldInit', e));
    const b = L.buildLoad ? L.buildLoad().then(() => { G.buildReady = true; }, e => console.warn('buildLoad', e)) : null;
    const c = L.crPreload ? Promise.resolve(L.crPreload(['raposa', 'cervo', 'coelho'])).catch(() => { }) : null;
    // compile the dressing / kit / creature shaders while the start card is up (no first-sight hitch after entering)
    Promise.all([w, b, c]).then(() => { if (G.phase !== 'title') return; try { L.lookPrecompile(L.camera); } catch (e) { } G.times.later = Math.round(now() - t0); });
  }

  // ================================================================ hero
  // the local hero handle is L.game.M (INTEG §4: B-actors may read it and swap it, disposing the old one)
  async function makeHero(lk) {
    const fl = L.story && L.story.look ? L.story.look() : {};
    const M = await L.makeHero(lk.g, { pal: lk.pal, cape: !!fl.cape, hat: !!fl.hat });
    if (M) { L.scene.add(M.root); M.root.position.set(P.x, P.y, P.z); M.root.rotation.y = P.ry; }
    return M;
  }
  let swapping = 0;
  async function swapHero(lk) {
    const my = ++swapping; const M = await makeHero(lk); if (my !== swapping) { if (M) M.dispose(); return; }
    if (G.M) G.M.dispose(); G.M = M;
  }

  // ================================================================ spawn / placement
  function spawnPoint(pl) {
    if (pl && Array.isArray(pl.pos) && pl.pos.every(Number.isFinite)) return { x: pl.pos[0], y: pl.pos[1], z: pl.pos[2], ry: pl.pos[3] || 0, saved: true };
    // first view: L.SPAWN_VIEW {ry, pitch, dist} (B-world, world.js) frames the arrival; else the world data's yaw
    const s = L.poi && L.poi('spawn'), s5 = L.SPAWN5 || { x: L.SPAWN[0], z: L.SPAWN[1], ry: 0 }, V = L.SPAWN_VIEW || {};
    const ry = V.ry != null ? V.ry : s5.ry != null ? s5.ry : (s && s.ry) || 0;
    return { x: s ? s.x : s5.x, z: s ? s.z : s5.z, y: null, ry, pitch: V.pitch, dist: V.dist };
  }
  function placePlayer(sp) {
    P.x = sp.x; P.z = sp.z; const g = L.groundAt ? L.groundAt(sp.x, sp.z, (sp.y != null ? sp.y : 1e4) + .5, 1e4).y : L.ground(sp.x, sp.z);
    P.y = sp.y != null && sp.y > g - .5 ? Math.max(sp.y, g) : g; P.vx = P.vy = P.vz = 0; P.ry = sp.ry || 0; P.onGround = true;
    cam.tyaw = cam.yaw = P.ry; cam.tpitch = cam.pitch = sp.pitch != null ? sp.pitch : .26; cam.tdist = cam.dist = sp.dist != null ? sp.dist : 7;
  }
  L.storyTeleport = function (x, y, z) { P.x = x; P.y = y; P.z = z; P.vx = P.vy = P.vz = 0; cameraSnap(); };
  function camTarget() { return { x: P.x, y: P.y, z: P.z, ry: P.ry, moving: P.speed > .5, fast: P.speed > 5.5, h: P.swim > .5 ? .5 : 1.55 }; }
  function cameraSnap() { for (let i = 0; i < 30; i++) L.cameraStep(.1, 0, camTarget()); L.camera.updateMatrixWorld(); }

  // ================================================================ enter the world (start screen → session)
  async function enter(choice) {
    const t0 = now(); G.phase = 'joining'; G.look = choice.look; G.name = choice.name; G.world = choice.world;
    L.ui.loading(.3, 'Entrando no mundo…');
    // the latest position goes down before save.js writes on page hide (registered first, so it runs first)
    addEventListener('pagehide', savePos); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePos(); });
    const pl = await L.save.init({ world: choice.world, name: choice.name, look: { g: choice.look.g, pal: choice.look.pal }, defaults: { inv: { frutinhas: 4 } }, startHour: 7 });
    G.times.save = Math.round(now() - t0);
    // story (its own UI at z 60, our HUD draws the diário / magia buttons), survival HUD (z 50)
    L.storyUIOpts = { buttons: false, sound: true, onPause: v => { G.storyPause = v; } };
    try { L.story.init(); } catch (e) { console.error('[game] story init', e); }
    try { L.survUI.init({ show: true }); } catch (e) { console.error('[game] survUI init', e); }
    if (L.surv && L.surv.on) L.surv.on('respawn', d => { if (d && d.phase === 'moved') cameraSnap(); });
    const sp = spawnPoint(pl); placePlayer(sp); await yieldUI();
    const lk = pl.look && pl.look.g ? { g: pl.look.g === 'm' ? 'm' : 'f', pal: (pl.look.pal | 0) % 3 } : choice.look;
    if (!G.M || lk.g !== G.M.g || lk.pal !== G.M.pal) { const M = await makeHero(lk); if (G.M) G.M.dispose(); G.M = M; }
    G.look = lk; cameraSnap();
    // the world map image (2 MB) and the explored mask after entering
    if (L.mapLoad) L.mapLoad();
    // other players (builds: L.buildsTick, owner B-actors)
    L.save.room.onPeers(peers => syncPeers(peers));
    L.ui.loadingDone(); L.ui.showHUD(true);
    G.started = true; G.phase = 'play'; G.times.enter = Math.round(now() - t0);
    L.grassUpdate(P.x, P.z, true);
    const st = L.save.status;
    L.ui.toast(st === 'local' ? `Bem-vindo, ${choice.name}! Jogando neste aparelho.` : `Bem-vindo a Lumiar, ${choice.name}! Mundo: ${choice.world}`, 3500);
  }

  // ================================================================ other players, presence, saved position
  function syncPeers(peers) {
    const key = L.save.key; const list = (peers || []).filter(p => p.presence && p.presence.k !== key && typeof p.presence.x === 'number');
    L.remoteSync(list, r => { if (G.started) L.ui.toast(`${r.nm} chegou ao mundo`); }, r => { if (G.started) L.ui.toast(`${r.nm} saiu do mundo`); });
  }
  // presence (INTEG §5.7): the base fields here, B-game's action fields from G.pres {a, ak, e, tl}, B-actors' from
  // L.presenceExtra() {rd, fl}; save.js adds pid / n / k / w and re-sends the last value every 2 s (heartbeat)
  G.pres = {};
  let presT = 0, presLast = '';
  function presence(dt) {
    presT -= dt; if (presT > 0) return; presT = .125;
    if (Math.hypot(P.x - posLast[0], P.z - posLast[1]) > 2) savePos();
    if (!L.save.room.online) return;
    const v = { x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), ry: +P.ry.toFixed(2), v: +P.speed.toFixed(1), sw: P.swim > .5 ? 1 : 0, g: G.look.g, c: G.look.pal };
    Object.assign(v, G.pres); if (typeof L.presenceExtra === 'function') try { Object.assign(v, L.presenceExtra()); } catch (e) { }
    const s = JSON.stringify(v); if (s === presLast) return; presLast = s; L.save.room.presence(v).catch(() => { });
  }
  // position writes: survival keeps the last safe spot every 3 s (respawn); this keeps the latest safe one (moved
  // > 2 m, and on page hide) so a reload does not lose the last seconds of walking
  const posLast = [1e9, 1e9];
  function savePos() {
    if (!G.started || !L.save.ready || !P.onGround || P.swim > .5 || P.y < (L.CLOUD_Y || -1e9) + 3) return;
    if (L.surv && (L.surv.respawning || L.surv.sleeping)) return;
    posLast[0] = P.x; posLast[1] = P.z; L.save.setPos(P.x, P.y, P.z, P.ry);
  }

  // ================================================================ phase-B hooks and action APIs (stubs; owners replace them, INTEG §4)
  // each stub is installed only when nothing defined it first (B-* files load before game.js). Every stub works, so
  // each agent can test alone; the real versions keep the exact signatures.
  const hook = (name, fn) => { if (typeof L[name] !== 'function') L[name] = fn; };
  const hookObj = (name, o) => { if (!L[name] || typeof L[name] !== 'object') L[name] = o; else for (const k in o) if (typeof L[name][k] !== 'function') L[name][k] = o[k]; };
  const b5list = () => { const m = L.save.ready ? L.save.all('b5') : null, out = []; if (m && m.forEach) m.forEach((v, id) => { if (v) out.push(Object.assign({ id }, v)); }); return out; };
  const near = (q, x, z) => (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z);

  // ---- per-frame entry points (INTEG §3.3): game.js calls each once per frame with the shared ctx
  // B-world: dressing streaming, POI LOD, world effects
  hook('worldTick', (dt, t, ctx) => { if (L.worldUpdate) L.worldUpdate(dt, t); });
  // B-actors: remote players + creatures
  hook('actorsTick', (dt, t, ctx) => {
    L.remoteStep(dt, t, t);
    if (L.crUpdate) L.crUpdate(dt, t, { px: ctx.P.x, py: ctx.P.y, pz: ctx.P.z, pv: ctx.P.speed, night: ctx.night > .5, food: !!ctx.food, sombra: !!ctx.sombra, owners: ctx.owners, camera: ctx.camera, shadowR: L.quality === 'baixo' ? 20 : 40, t });
  });
  // B-actors: b5 → build meshes / colliders (+ survival's fires), the placement ghost
  let bDirty = true, bWired = false;
  function syncBuilds() {
    if (!G.buildReady || !L.buildSync || !L.save.ready) return; bDirty = false;
    const o = {}; for (const r of b5list()) { const id = r.id; delete r.id; o[id] = r; } L.buildSync(o);
    if (L.fires && L.fires.syncBuilds) try { L.fires.syncBuilds(o); } catch (e) { }
  }
  hook('buildsTick', (dt, t, ctx) => {
    if (!bWired && L.save.ready && L.save.on) { bWired = true; L.save.on('b5', () => { bDirty = true; }); }
    if (bDirty) syncBuilds(); if (L.buildTick) L.buildTick(dt, t);
    if (PL.on) placeTick(ctx);
  });
  // B-ui: minimap, clock, HUD refresh
  hook('uiTick', (dt, ctx) => { L.ui.tick(dt, { x: ctx.P.x, z: ctx.P.z, ry: ctx.P.ry }); });

  // ---- story hooks
  // B-world: named pieces of the authored keep (story animates doors, lock, vines), restoration, story anchors
  hook('castleObj', name => null);
  hook('castleRestore', amount => { });
  hook('storyAnchor', objId => null);
  hook('storyWorldEvent', (name, d) => { });
  // B-actors: tamed companion from the story, build records for the story's checks, outfit pieces
  hook('giveTame', species => { console.info('[game] giveTame (B-actors)', species); return false; });
  // {id, t (piece / item id), tr (tier), x, y, z, r, h (height above y), lit}; the lighthouse lamp is t 'lanterna_farol'
  const PIECE_H = { foundation: 1, floor: .3, wall: 3, doorway: 3, window: 3, wall_half: 1.5, gable: 1.5, roof: 2, stairs: 3, pillar: 3, fence: 1.2, door: 2.3, gate: 1.2 };
  hook('storyBuilds', () => { const R = L.buildRecs ? L.buildRecs() : {}; return b5list().map(r => Object.assign(r, { h: R[r.id] && R[r.id].h != null ? R[r.id].h : PIECE_H[r.t] != null ? PIECE_H[r.t] : 1 })); });
  hook('onStoryLook', look => { const M = G.M; if (M && M.part) { M.part('cape', !!look.cape); M.part('hat', !!look.hat); } });
  // light the nearest unlit fire build within r (spell Faísca, B-game's own fire lighting); the caller emits fire_lit
  const LIGHTABLE = ['fogueira', 'lareira', 'forno', 'forja', 'caldeirao', 'lanterna', 'lanterna_farol'];
  hook('lightFireNear', (x, z, r) => {
    let best = null, bd = r * r;
    for (const v of b5list()) { if (v.lit || LIGHTABLE.indexOf(v.t) < 0) continue; const d = near(v, x, z); if (d < bd) { bd = d; best = v; } }
    if (!best) return false; const id = best.id; delete best.id; L.save.set('b5', id, Object.assign(best, { lit: 1, litAt: Date.now() })); return true;
  });
  hook('onSpell', id => { });

  // ---- B-game action APIs (INTEG §5.8): crafting, chests, travel totems
  const stationNear = w => w === 'mao' || !!(L.buildNearest && L.buildNearest(P.x, P.y, P.z, 4, q => q.t === w));
  const recipe = id => (L.RECIPES || []).find(r => r.id === id);
  // recipes of a station ('mao' = by hand; null = all): each with can (materials + station) and missing
  hook('recipesFor', st => (L.RECIPES || []).filter(r => st == null || r.w === st).map(r => Object.assign({}, r, { here: stationNear(r.w), can: stationNear(r.w) && L.inv.canPay(r.cost), missing: L.inv.missing(r.cost) })));
  hook('craft', id => {
    const r = recipe(id); if (!r) return { ok: false, why: 'Receita desconhecida' };
    if (!stationNear(r.w)) return { ok: false, why: 'Precisa estar perto: ' + ((L.BUILD && L.BUILD.ITEMS[r.w] && L.BUILD.ITEMS[r.w].nome) || r.w) };
    if (!L.inv.pay(r.cost)) return { ok: false, why: 'Faltam materiais', missing: L.inv.missing(r.cost) };
    if (r.tool) L.inv.giveTool(r.tool[0], r.tool[1]); if (r.give) for (const k in r.give) L.inv.give(k, r.give[k]);
    try { L.story.event('crafted', { item: id }); } catch (e) { } return { ok: true };
  });
  // chests: k5[id] = {items: {item: n}}; id = the build id of a 'bau' piece (or a fixed chest id)
  const chestGet = id => { const c = L.save.ready && L.save.get('k5', id); return { items: Object.assign({}, c && c.items) }; };
  hookObj('chest', {
    near(x, z, r) { const b = L.buildNearest ? L.buildNearest(x, P.y, z, r || 3, q => q.t === 'bau') : null; return b ? b.id : null; },
    open(id) { return Object.assign({ id }, chestGet(id)); },
    put(id, item, n) { n = n || 1; if (!L.inv.take(item, n)) return false; const c = chestGet(id); c.items[item] = (c.items[item] || 0) + n; L.save.set('k5', id, c); return true; },
    take(id, item, n) { n = n || 1; const c = chestGet(id); if ((c.items[item] || 0) < n) return false; c.items[item] -= n; if (!c.items[item]) delete c.items[item]; L.save.set('k5', id, c); L.inv.give(item, n, true); return true; },
  });
  // travel totems: POIs 'tt_*'; d5[id] = {by, at} once someone found it
  hookObj('travel', {
    list() { return (L.POIS || []).filter(p => /^tt_/.test(p.id)).map(p => ({ id: p.id, x: p.x, z: p.z, known: !!(L.save.ready && L.save.get('d5', p.id)) })); },
    discover(id) { if (L.save.ready && !L.save.get('d5', id)) { L.save.set('d5', id, { by: L.save.key, at: Date.now() }); return true; } return false; },
    go(id) { const p = L.poi(id); if (!p || !(L.save.ready && L.save.get('d5', id))) return { ok: false, why: 'Totem ainda não encontrado' }; placePlayer({ x: p.x + 2.5, z: p.z + 2.5, y: null, ry: P.ry }); cameraSnap(); return { ok: true }; },
  });

  // ---- B-actors building API (INTEG §5.6): Construir lists pieces, begin() starts placement (ghost in front of the
  // hero), the action button confirms, cancel() leaves. The stub places with L.buildCandidate / L.buildGhost.
  const PL = { on: false, t: '', tr: '', rot: 0, cand: null };
  function placeTick(ctx) {
    const d = 3.2, ax = P.x + Math.sin(P.ry) * d, az = P.z + Math.cos(P.ry) * d;
    PL.cand = L.buildCandidate ? L.buildCandidate(PL.t, PL.tr, ax, P.y + 1, az, P.x, P.z, PL.rot, 0) : null;
    if (L.buildGhost) L.buildGhost(PL.cand, PL.t, PL.tr);
  }
  hookObj('build', {
    tiers() { return L.BUILD ? Object.keys(L.BUILD.TIERS).map(k => Object.assign({ id: k, ok: !L.buildTierOK || L.buildTierOK(k) }, L.BUILD.TIERS[k])) : []; },
    // tier pieces (tier given) or stations / furniture / farm items (tier null): {id, nome, cat, cost, can, desc}
    pieces(tier) {
      if (!L.BUILD) return []; const src = tier ? L.BUILD.PIECES : L.BUILD.ITEMS;
      return Object.keys(src).map(k => { const cost = L.buildCost(k, tier); return { id: k, nome: src[k].nome, cat: src[k].cat || 'peca', desc: src[k].desc || '', cost, can: L.inv.canPay(cost) }; });
    },
    begin(tier, piece) { if (!L.BUILD || !(L.BUILD.PIECES[piece] || L.BUILD.ITEMS[piece])) return false; Object.assign(PL, { on: true, t: piece, tr: tier || null, rot: 0, cand: null }); L.ui.closePanels(true); return true; },
    active() { return PL.on ? { tier: PL.tr, piece: PL.t, ok: !!(PL.cand && PL.cand.ok), why: (PL.cand && PL.cand.why) || '' } : null; },
    rotate() { PL.rot++; },
    confirm() {
      if (!PL.on) return { ok: false, why: '' }; const c = PL.cand; if (!c || !c.ok || !c.rec) return { ok: false, why: (c && c.why) || 'Lugar ruim' };
      const cost = L.buildCost(PL.t, PL.tr); if (!L.inv.pay(cost)) return { ok: false, why: 'Faltam materiais', missing: L.inv.missing(cost) };
      const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), rec = L.buildFinalize(id, Object.assign({}, c.rec, { by: L.save.key }));
      L.save.set('b5', id, rec); bDirty = true;
      try { L.story.event('built', { piece: PL.t, tier: PL.tr, x: rec.x, y: rec.y, z: rec.z }); } catch (e) { } return { ok: true, id };
    },
    cancel() { PL.on = false; PL.cand = null; if (L.buildGhostOff) L.buildGhostOff(); },
  });

  // ================================================================ action button (phase A: placement, story objects)
  let target = null, targetT = 0;
  function findTarget() {
    const B = L.build.active(); if (B) return { kind: 'place', lb: B.ok ? 'colocar' : 'mover', off: !B.ok };
    const near = L.story && L.story.interactables ? L.story.interactables(P.x, P.z, 3, P.y) : [];
    return near.length ? { kind: 'story', id: near[0].id, lb: near[0].label, ic: near[0].icon } : null;
    // B-game: harvestables (L.scatterNear / h5), stations, chests, crops (L.farm.action), creatures, build pieces
  }
  function doAction() {
    if (!target) return false;
    if (target.kind === 'place') { const r = L.build.confirm(); if (!r.ok && r.why) L.ui.toast(r.why); return r.ok; }
    if (target.kind === 'story') { const ok = L.story.interact(target.id); if (ok && L.story.event) L.story.event('interact', { objId: target.id }); return ok; }
    return false;
  }
  L.ui.on('act', () => { if (G.started) doAction(); });

  // ================================================================ main loop
  let last = now(), dbgT = 0, trimT = 0, exT = 0, wasPaused = false;
  const inp = { mx: 0, mz: 0, run: false, jump: false, jumpHeld: false, up: false, down: false };
  // movement basis: the stick is read in the camera's frame at the moment it is pushed and stays in that frame while
  // held (the camera's auto-follow must not keep turning the walk: diagonal input walked in circles). A camera drag
  // turns the basis with the camera; a new push, or a stick turn of more than MOVE_RELATCH, re-reads the camera.
  const SPRINT_V = 6.2;   // m/s: survival counts sprinting only once the run speed is reached (walk tops at 5)
  const MV = { on: false, base: 0, a0: 0 }, MOVE_RELATCH = 25 * Math.PI / 180;
  // shared per-frame context for the owners' entry points (INTEG §3.3); B-game may add fields, never remove them
  const ctx = G.ctx = { dt: 0, t: 0, P, cam, camera: L.camera, playing: false, paused: false, sky: null, night: 0, owners: {}, key: null, food: false, sombra: false, quality: L.quality };
  const _cp = new THREE.Vector3();
  function frame() {
    requestAnimationFrame(frame);
    const tn = now(); const dt = Math.min(.05, (tn - last) / 1000); last = tn;
    if (!G.simBusy) step(dt, true);
  }
  // one simulation step in the fixed order; draw = render this step (tests run steps without drawing)
  function step(dt, draw) {
    G.t += dt; const t = G.t;
    const playing = G.started;
    const S = L.story, SV = L.surv;
    const paused = playing && (!!(S && (S.busy || S.uiOpen)) || !!G.storyPause || !!(SV && (SV.sleeping || SV.respawning)));
    // ---- input
    run('input', () => {
      L.input.enabled = playing && !paused && !L.ui.isOpen(); const I = L.ui.readInput();
      if (paused !== wasPaused) { wasPaused = paused; }
      // camera drag (drag up = look up), pinch / wheel zoom
      if (I.camDX || I.camDY) { const dy = -I.camDX * .0065; cam.tyaw += dy; MV.base += dy; cam.tpitch = clamp(cam.tpitch + I.camDY * .0045, -.6, 1.3); cam.lastDrag = t; I.camDX = I.camDY = 0; }
      if (I.zoom) { cam.tdist = clamp(cam.tdist + I.zoom, cam.min, 18); I.zoom = 0; }
      if (Math.hypot(I.mx, I.my) < .08) MV.on = false;
      else { const a = Math.atan2(I.mx, -I.my); if (!MV.on || Math.abs(wrapA(a - MV.a0)) > MOVE_RELATCH) { MV.on = true; MV.base = cam.yaw; MV.a0 = a; } }
      const yw = MV.on ? MV.base : cam.yaw, fx = Math.sin(yw), fz = Math.cos(yw), rx = Math.cos(yw), rz = -Math.sin(yw);
      inp.mx = fx * (-I.my) - rx * I.mx; inp.mz = fz * (-I.my) - rz * I.mx;
      inp.run = I.run && (!SV || SV.canSprint()); inp.jump = I.jumpQ; inp.jumpHeld = I.jumpHeld; I.jumpQ = false;
      if (I.actQ) { I.actQ = false; }
    });
    // ---- player / controller
    run('player', () => {
      if (!playing) { idleHero(dt, t); return; }
      const sm = S && S.mods ? S.mods() : {};
      const mods = { speedMul: SV ? SV.speedMul() : 1, jumpMul: SV ? SV.jumpMul() : 1, swimMul: SV ? SV.swimMul() : 1, glide: !!sm.glide && (!SV || SV.canGlide()), waterWalk: !!sm.waterWalk, doubleJump: !!sm.doubleJump, climb: false };
      L.playerStep(dt, t, inp, mods);
      // animHero s (INTEG §5.6): motion from L.P; act / wave from B-game's G.act / G.wave; ride from the mount (B-actors)
      const M = G.M; if (M) { M.root.position.set(P.x, P.y, P.z); M.root.rotation.set(0, P.ry, 0); }
      if (M) L.animHero(M, dt, t, { speed: P.speed, air: P.air, swim: P.swim, turn: P.turn, now: t, ride: P.mount ? 1 : 0, act: G.act || null, wave: G.wave || 0 });
      L.uPlayer.value.set(P.x, P.y, P.z);
    });
    // ---- camera (story shots override it below)
    run('camera', () => { L.cameraStep(dt, t, camTarget()); L.camera.updateMatrixWorld(); });
    // ---- shared clock → time of day → look
    let sky = null;
    run('clock', () => { sky = L.clock.sky(); ctx.sky = sky; ctx.night = L.clock.nightness(); });
    ctx.dt = dt; ctx.t = t; ctx.playing = playing; ctx.paused = paused; ctx.camera = L.camera; ctx.quality = L.quality;
    if (playing && L.save.ready && ctx.key !== L.save.key) { ctx.owners = {}; ctx.key = L.save.key; }
    if (ctx.key) { const o = ctx.owners[ctx.key] || (ctx.owners[ctx.key] = {}); o.x = P.x; o.y = P.y; o.z = P.z; o.ry = P.ry; o.v = P.speed; }
    run('look', () => {
      L.setTimeOfDay(sky); L.lookTick(dt, t, L.camera);
      if (L.waterU && L.waterU.uTime) L.waterU.uTime.value = t;
      if (L.flowMat && L.flowMat.uniforms && L.flowMat.uniforms.uTime) L.flowMat.uniforms.uTime.value = t;
    });
    // ---- world streaming (budget TECH §0: ≤ 6 ms per frame in all)
    run('stream', () => {
      L.terrainUpdate(L.camera.position, playing ? 3 : 4);
      L.worldTick(dt, t, ctx);
      trimT -= dt; if (trimT < 0) { trimT = .5; L.trimTiles(L.camera.position.x, L.camera.position.z); }
    });
    run('scatter', () => { L.scatterUpdate(L.camera, playing ? 2 : 3); L.grassUpdate(P.x, P.z); });
    // ---- creatures
    run('creatures', () => { L.actorsTick(dt, t, ctx); });
    // ---- building (B-actors: b5 sync, ghost, placement)
    run('build', () => { L.buildsTick(dt, t, ctx); });
    // ---- story (mist block and its white fade/teleport live inside story.tick), story camera, input pause
    run('story', () => {
      if (!playing || !S) return;
      S.tick(dt);
      const C = S.camera || DBG.cam;
      if (C && C.p && C.t) {
        L.camera.position.set(C.p[0], C.p[1], C.p[2]); L.camera.lookAt(C.t[0], C.t[1], C.t[2]);
        if (C.fov && L.camera.fov !== C.fov) { G.fov0 = G.fov0 || L.camera.fov; L.camera.fov = C.fov; L.camera.updateProjectionMatrix(); }
        L.camera.updateMatrixWorld();
      } else if (G.fov0) { L.camera.fov = G.fov0; G.fov0 = 0; L.camera.updateProjectionMatrix(); }
    });
    // ---- survival
    run('surv', () => {
      if (!playing || !SV) return;
      const moving = P.speed > .6, sm = S && S.mods ? S.mods() : {};
      SV.tick(dt, { x: P.x, y: P.y, z: P.z, ry: P.ry, moving, sprinting: inp.run && P.speed > SPRINT_V, swimming: P.swim > .5, gliding: !!P.glide, night: L.clock.nightness(), altitude: P.y, grounded: !!P.onGround, mounted: !!P.mount, coldImmune: !!sm.warm });
    });
    // ---- farm
    run('farm', () => { if (playing && L.farm) L.farm.tick(dt, P.x, P.z); });
    // ---- presence / explored
    run('net', () => {
      if (!playing) return; presence(dt);
      exT -= dt; if (exT < 0) { exT = 1; L.save.explored.reveal(P.x, P.z, 110); }
    });
    // ---- UI
    run('ui', () => {
      if (!playing) return;
      targetT -= dt; if (targetT < 0) { targetT = .15; target = paused ? null : findTarget(); L.ui.setAction(target ? { lb: target.lb, off: !!target.off } : null); }
      L.uiTick(dt, ctx);
    });
    // ---- render
    run('render', () => {
      if (!draw || DBG.norender) return;
      const inf = L.renderer.info; inf.autoReset = false; inf.reset(); L.render(); inf.autoReset = true;
      G.calls = inf.render.calls; G.tris = inf.render.triangles;
    });
    // ---- debug overlay (every 0.5 s: avg / max ms per system)
    dbgT -= dt; if (dbgT < 0) {
      dbgT = .5; for (const k of SYS) { TM[k].max = TM[k].win; TM[k].win = 0; }
      G.fps = Math.round(1 / Math.max(dt, 1e-3));
      if (DBG.on) dbgText();
    }
  }
  // title screen: the hero breathes at the spawn while the start card is up
  function idleHero(dt, t) {
    const M = G.M; if (!M) return; M.root.position.set(P.x, P.y, P.z); M.root.rotation.set(0, P.ry, 0);
    L.animHero(M, dt, t, { speed: 0, air: 0, swim: 0, now: t, turn: 0 }); L.uPlayer.value.set(P.x, P.y, P.z);
    cam.tyaw = P.ry + Math.sin(t * .05) * .25 + .35;
  }
  function dbgText() {
    const ts = L.terrainStats || {}, ss = L.scatterStats || {};
    const lines = [`${G.fps} fps  ${G.calls} draws  ${(G.tris / 1000 | 0)}k tris  q ${L.quality}`,
      `x ${P.x.toFixed(0)} y ${P.y.toFixed(1)} z ${P.z.toFixed(0)}  região ${L.region ? L.region(P.x, P.z) : '-'}  ${L.clock.clockText()}`,
      `terreno ${ts.visible || 0}/${ts.nodes || 0} pend ${ts.pending || 0}  árvores ${ss.inst || 0}  criaturas ${(L.crStats && L.crStats.n) || 0}`];
    for (const k of SYS) lines.push(k.padEnd(10) + TM[k].avg.toFixed(2).padStart(6) + ' ' + TM[k].max.toFixed(1).padStart(6));
    L.ui.dbg(lines.join('\n'));
  }
  DBG.on = QS.get('dbg') === '1';

  // ================================================================ dev / test hooks (window.__lumiar)
  window.__lumiar = {
    L, P, G, cam,
    get target() { return target; }, doAction,
    timing: G.timing,
    // teleport to a POI id or x,z (y = ground there), camera snapped behind the hero
    goto(a, b, ry) { const p = typeof a === 'string' ? L.poi(a) : { x: a, z: b }; if (!p) return null; placePlayer({ x: p.x, z: p.z, y: null, ry: ry != null ? ry : P.ry }); if (ry != null) { cam.tyaw = cam.yaw = ry; } cameraSnap(); return [P.x, P.y, P.z]; },
    hours: h => { L.clock.setHours(h); return L.clock.clockText(); },
    // build everything the camera wants now (screenshots / tests)
    settle(ms) { const t0 = now(); L.camera.updateMatrixWorld(); while (!L.terrainUpdate(L.camera.position, 1e9) && now() - t0 < (ms || 30000)) { } if (L.scatterSettle) L.scatterSettle(P.x, P.z, L.camera); L.grassUpdate(P.x, P.z, true); return Math.round(now() - t0); },
    info() { const r = L.renderer.info; return { calls: G.calls, tris: G.tris, geo: r.memory.geometries, tex: r.memory.textures, programs: r.programs ? r.programs.length : 0, terrain: L.terrainStats, scatter: L.scatterStats, cr: L.crStats, times: G.times, phase: G.phase }; },
    // advance the game by sec seconds of game time in fixed 1/30 s steps (no drawing): keys = codes held meanwhile.
    // SwiftShader draws ~2 frames/s, so tests walk with this and render only the screenshots.
    // renderEvery (s): also draw one real frame that often and report the worst draw calls / triangles on the way
    // (G.calls / G.tris are only measured by drawn frames)
    sim(sec, keys, every, renderEvery) {
      G.simBusy = true; const k = keys || []; k.forEach(c => { L.input.keys[c] = true; }); const n = Math.round(sec * 30), path = [], peak = { calls: 0, tris: 0, at: null, frames: 0 };
      const re = renderEvery ? Math.max(1, Math.round(renderEvery * 30)) : 0;
      try {
        for (let i = 0; i < n; i++) {
          const draw = re > 0 && (i + 1) % re === 0; step(1 / 30, draw);
          if (draw) { peak.frames++; if (G.tris > peak.tris) { peak.tris = G.tris; peak.calls = Math.max(peak.calls, G.calls); peak.at = [P.x | 0, P.z | 0, +cam.yaw.toFixed(2)]; } else peak.calls = Math.max(peak.calls, G.calls); }
          if (every && i % Math.round(every * 30) === 0) path.push([+P.x.toFixed(1), +P.y.toFixed(1), +P.z.toFixed(1)]);
        }
      }
      finally { k.forEach(c => { L.input.keys[c] = false; }); G.simBusy = false; }
      return { pos: [+P.x.toFixed(1), +P.y.toFixed(1), +P.z.toFixed(1)], path, peak: re ? peak : undefined };
    },
    // per-owner draw calls / triangles of the current view (INTEG §0 allowance table): one real frame in all, one
    // without the shadow pass, then one with each owner's objects hidden (the difference is that owner's share)
    budget() {
      const R = L.renderer, sm = R.shadowMap, inf = R.info;
      const draw = () => { inf.autoReset = false; inf.reset(); L.render(); inf.autoReset = true; return { calls: inf.render.calls, tris: inf.render.triangles }; };
      L.camera.updateMatrixWorld(); const all = draw();
      sm.autoUpdate = false; const main = draw(); sm.autoUpdate = true; sm.needsUpdate = true;
      const own = o => {
        const n = o.name || '';
        if (n === 'terrain' || n === 'water') return 'terrain'; if (n === 'scatter' || n === 'impostors') return 'scatter'; if (n === 'grass' || n === 'flowers') return 'grass';
        if (/^(poi|dress|bridge_)/.test(n)) return 'dressing'; if (n === 'farm') return 'farm';
        if (/cumulus|lowclouds|mist|cloudsea|sky|stars|rain/.test(n) || o === L.sky || o === L.stars) return 'sky';
        if (G.M && o === G.M.root) return 'actors'; if (o.userData && o.userData.t) return 'builds'; if (o.isInstancedMesh) return 'builds';
        if (n === 'Scene' || o.isSkinnedMesh) return 'actors';
        return 'other';
      };
      const groups = {}; for (const o of L.scene.children) { if (!o.visible || o.isLight) continue; const k = own(o); (groups[k] = groups[k] || []).push(o); }
      const out = { all, main, shadow: { calls: all.calls - main.calls, tris: all.tris - main.tris }, owners: {} };
      for (const k in groups) { groups[k].forEach(o => o.visible = false); const r = draw(); groups[k].forEach(o => o.visible = true); out.owners[k] = { calls: all.calls - r.calls, tris: all.tris - r.tris, n: groups[k].length }; }
      draw(); return out;
    },
    walk(sec, dir) { return new Promise(res => { const k = dir || 'KeyW'; L.input.keys[k] = true; setTimeout(() => { L.input.keys[k] = false; res([P.x, P.y, P.z]); }, sec * 1000); }); },
  };

  boot().catch(e => { console.error('[game] boot', e); L.ui.loading(null, 'Não consegui carregar o mundo. Recarregue a página.'); });
})(window.L);
