/* Lumiar v5 game (B-game owns this file after phase A): boot + loading, start screen, save/session, player spawn,
   the main loop (fixed system order, per-system timing), action button, presence, debug hooks.
   The v4 game (harvesting, crafting, building UI, taming, chests, audio) is in git history for B-game to port.
   Contract: v5docs/INTEG.md. Main loop order (INTEG §3.2): input → player → camera → clock → time of day → look →
   streaming → scatter/grass → creatures → build → story → survival → farm → presence/explored → UI → render. */
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
  const TM = {}; SYS.forEach(k => TM[k] = { avg: 0, max: 0, win: 0 });
  function run(k, fn) {
    const t0 = now();
    try { fn(); } catch (e) { if (!G.err[k]) { G.err[k] = 1; console.error('[game] ' + k, e); } }
    const d = now() - t0, s = TM[k]; s.avg = s.avg * .95 + d * .05; if (d > s.win) s.win = d;
  }
  G.timing = () => { const o = {}; for (const k of SYS) o[k] = [+TM[k].avg.toFixed(2), +TM[k].max.toFixed(2)]; return o; };

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
    Promise.resolve(L.worldInit ? L.worldInit() : null).then(() => { G.times.dress = Math.round(now() - t0); }, e => console.warn('worldInit', e));
    if (L.buildLoad) L.buildLoad().then(() => { G.buildReady = true; syncBuilds(); }, e => console.warn('buildLoad', e));
    if (L.crPreload) L.crPreload(['raposa', 'cervo', 'coelho']);
  }

  // ================================================================ hero
  async function makeHero(lk) {
    const fl = L.story && L.story.look ? L.story.look() : {};
    const M = await L.makeMage4({ gender: lk.g, pal: lk.pal, cape: !!fl.cape, hat: !!fl.hat });
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
    const s = L.poi && L.poi('spawn'), s5 = L.SPAWN5 || { x: L.SPAWN[0], z: L.SPAWN[1], ry: 0 };
    return { x: s ? s.x : s5.x, z: s ? s.z : s5.z, y: null, ry: s5.ry != null ? s5.ry : (s && s.ry) || 0 };
  }
  function placePlayer(sp) {
    P.x = sp.x; P.z = sp.z; const g = L.groundAt ? L.groundAt(sp.x, sp.z, (sp.y != null ? sp.y : 1e4) + .5, 1e4).y : L.ground(sp.x, sp.z);
    P.y = sp.y != null && sp.y > g - .5 ? Math.max(sp.y, g) : g; P.vx = P.vy = P.vz = 0; P.ry = sp.ry || 0; P.onGround = true;
    cam.tyaw = cam.yaw = P.ry; cam.tpitch = cam.pitch = .26; cam.tdist = cam.dist = 7;
  }
  L.storyTeleport = function (x, y, z) { P.x = x; P.y = y; P.z = z; P.vx = P.vy = P.vz = 0; cameraSnap(); };
  function camTarget() { return { x: P.x, y: P.y, z: P.z, ry: P.ry, moving: P.speed > .5, fast: P.speed > 5.5, h: P.swim > .5 ? .5 : 1.55 }; }
  function cameraSnap() { for (let i = 0; i < 30; i++) L.cameraStep(.1, 0, camTarget()); L.camera.updateMatrixWorld(); }

  // ================================================================ enter the world (start screen → session)
  async function enter(choice) {
    const t0 = now(); G.phase = 'joining'; G.look = choice.look; G.name = choice.name; G.world = choice.world;
    L.ui.loading(.3, 'Entrando no mundo…');
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
    // shared world: builds, other players
    if (L.save.on) L.save.on('b5', () => { buildsDirty = true; });
    syncBuilds();
    L.save.room.onPeers(peers => syncPeers(peers));
    L.ui.loadingDone(); L.ui.showHUD(true);
    G.started = true; G.phase = 'play'; G.times.enter = Math.round(now() - t0);
    L.grassUpdate(P.x, P.z, true);
    const st = L.save.status;
    L.ui.toast(st === 'local' ? `Bem-vindo, ${choice.name}! Jogando neste aparelho.` : `Bem-vindo a Lumiar, ${choice.name}! Mundo: ${choice.world}`, 3500);
  }

  // ================================================================ shared world bits used in phase A
  let buildsDirty = true;
  function syncBuilds() {
    if (!G.buildReady || !L.buildSync || !L.save.ready) return; buildsDirty = false;
    const m = L.save.all('b5'); const o = {}; if (m && m.forEach) m.forEach((v, k) => { if (v) o[k] = v; }); L.buildSync(o);
    if (L.fires && L.fires.syncBuilds) try { L.fires.syncBuilds(o); } catch (e) { }
  }
  function syncPeers(peers) {
    const key = L.save.key; const list = (peers || []).filter(p => p.presence && p.presence.k !== key && typeof p.presence.x === 'number');
    L.remoteSync(list, r => { if (G.started) L.ui.toast(`${r.nm} chegou ao mundo`); }, r => { if (G.started) L.ui.toast(`${r.nm} saiu do mundo`); });
  }
  let presT = 0, presLast = '';
  function presence(dt) {
    presT -= dt; if (presT > 0 || !L.save.room.online) return; presT = .125;
    const v = { x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), ry: +P.ry.toFixed(2), v: +P.speed.toFixed(1), sw: P.swim > .5 ? 1 : 0, g: G.look.g, c: G.look.pal };
    const s = JSON.stringify(v); if (s === presLast && presT > -2) return; presLast = s; L.save.room.presence(v).catch(() => { });
  }

  // ================================================================ phase-B hooks (stubs; owners replace them, INTEG §4)
  // each stub is installed only when nothing defined the hook first (B-* files load before game.js)
  const hook = (name, fn) => { if (typeof L[name] !== 'function') L[name] = fn; };
  // B-world: named pieces of the authored keep (story animates doors, lock, vines), restoration, story anchors
  hook('castleObj', name => null);
  hook('castleRestore', amount => { });
  hook('storyAnchor', objId => null);
  hook('storyWorldEvent', (name, d) => { });
  // B-actors: tamed companion from the story, build records for the story's checks, outfit pieces
  hook('giveTame', species => { console.info('[game] giveTame (B-actors)', species); return false; });
  hook('storyBuilds', () => { const m = L.save.ready ? L.save.all('b5') : null; const out = []; if (m && m.forEach) m.forEach((v, id) => { if (v) out.push(Object.assign({ id }, v)); }); return out; });
  hook('onStoryLook', look => { const M = G.M; if (M && M.part) { M.part('cape', !!look.cape); M.part('hat', !!look.hat); } });
  // B-game: light the nearest unlit fire build within r (spell Faísca), spell side effects (sound, particles)
  hook('lightFireNear', (x, z, r) => {
    let best = null, bd = r * r; const m = L.save.ready ? L.save.all('b5') : null;
    if (m && m.forEach) m.forEach((v, id) => { if (!v || v.lit || !(v.t === 'fogueira' || v.t === 'lareira' || v.t === 'forno')) return; const d = (v.x - x) * (v.x - x) + (v.z - z) * (v.z - z); if (d < bd) { bd = d; best = [id, v]; } });
    if (!best) return false; L.save.set('b5', best[0], Object.assign({}, best[1], { lit: 1, litAt: Date.now() })); return true;
  });
  hook('onSpell', id => { });

  // ================================================================ action button (phase A: story objects only)
  let target = null, targetT = 0;
  function findTarget() {
    const near = L.story && L.story.interactables ? L.story.interactables(P.x, P.z, 3, P.y) : [];
    return near.length ? { kind: 'story', id: near[0].id, lb: near[0].label, ic: near[0].icon } : null;
    // B-game: harvestables (L.scatterNear / h5), stations, chests, crops (L.farm.action), creatures, build pieces
  }
  function doAction() {
    if (!target) return false;
    if (target.kind === 'story') { const ok = L.story.interact(target.id); if (ok && L.story.event) L.story.event('interact', { objId: target.id }); return ok; }
    return false;
  }
  L.ui.on('act', () => { if (G.started) doAction(); });

  // ================================================================ main loop
  let last = now(), dbgT = 0, trimT = 0, exT = 0, wasPaused = false;
  const inp = { mx: 0, mz: 0, run: false, jump: false, jumpHeld: false, up: false, down: false };
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
      if (I.camDX || I.camDY) { cam.tyaw -= I.camDX * .0065; cam.tpitch = clamp(cam.tpitch + I.camDY * .0045, -.6, 1.3); cam.lastDrag = t; I.camDX = I.camDY = 0; }
      if (I.zoom) { cam.tdist = clamp(cam.tdist + I.zoom, cam.min, 18); I.zoom = 0; }
      const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
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
      const M = G.M; if (M) { M.root.position.set(P.x, P.y, P.z); M.root.rotation.set(0, P.ry, 0); L.animMage4(M, dt, t, { speed: P.speed, air: P.air, swim: P.swim, now: t, turn: P.turn }); }
      L.uPlayer.value.set(P.x, P.y, P.z);
    });
    // ---- camera (story shots override it below)
    run('camera', () => { L.cameraStep(dt, t, camTarget()); L.camera.updateMatrixWorld(); });
    // ---- shared clock → time of day → look
    let sky = null;
    run('clock', () => { sky = L.clock.sky(); });
    run('look', () => {
      L.setTimeOfDay(sky); L.lookTick(dt, t, L.camera);
      if (L.waterU && L.waterU.uTime) L.waterU.uTime.value = t;
      if (L.flowMat && L.flowMat.uniforms && L.flowMat.uniforms.uTime) L.flowMat.uniforms.uTime.value = t;
    });
    // ---- world streaming (budget TECH §0: ≤ 6 ms per frame in all)
    run('stream', () => {
      L.terrainUpdate(L.camera.position, playing ? 3 : 4);
      if (L.worldUpdate) L.worldUpdate(dt, t);
      trimT -= dt; if (trimT < 0) { trimT = .5; L.trimTiles(L.camera.position.x, L.camera.position.z); }
    });
    run('scatter', () => { L.scatterUpdate(L.camera, playing ? 2 : 3); L.grassUpdate(P.x, P.z); });
    // ---- creatures
    run('creatures', () => {
      if (!L.crUpdate) return;
      const owners = {}; if (L.save.ready) owners[L.save.key] = { x: P.x, y: P.y, z: P.z, ry: P.ry, v: P.speed };
      L.remoteStep(dt, t, t);
      L.crUpdate(dt, t, { px: P.x, py: P.y, pz: P.z, pv: P.speed, night: L.clock.nightness() > .5, food: false, sombra: false, owners, camera: L.camera, shadowR: L.quality === 'baixo' ? 20 : 40, t });
    });
    // ---- building (B-actors: ghost, placement)
    run('build', () => { if (buildsDirty) syncBuilds(); if (L.buildTick) L.buildTick(dt, t); });
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
      SV.tick(dt, { x: P.x, y: P.y, z: P.z, ry: P.ry, moving, sprinting: inp.run && moving, swimming: P.swim > .5, gliding: !!P.glide, night: L.clock.nightness(), altitude: P.y, grounded: !!P.onGround, mounted: !!P.mount, coldImmune: !!sm.warm });
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
      targetT -= dt; if (targetT < 0) { targetT = .15; target = paused ? null : findTarget(); L.ui.setAction(target ? { lb: target.lb } : null); }
      L.ui.tick(dt, { x: P.x, z: P.z, ry: P.ry });
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
    L.animMage4(M, dt, t, { speed: 0, air: 0, swim: 0, now: t, turn: 0 }); L.uPlayer.value.set(P.x, P.y, P.z);
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
    sim(sec, keys, every) {
      G.simBusy = true; const k = keys || []; k.forEach(c => { L.input.keys[c] = true; }); const n = Math.round(sec * 30), path = [];
      try { for (let i = 0; i < n; i++) { step(1 / 30, false); if (every && i % Math.round(every * 30) === 0) path.push([+P.x.toFixed(1), +P.y.toFixed(1), +P.z.toFixed(1)]); } }
      finally { k.forEach(c => { L.input.keys[c] = false; }); G.simBusy = false; }
      return { pos: [+P.x.toFixed(1), +P.y.toFixed(1), +P.z.toFixed(1)], path };
    },
    walk(sec, dir) { return new Promise(res => { const k = dir || 'KeyW'; L.input.keys[k] = true; setTimeout(() => { L.input.keys[k] = false; res([P.x, P.y, P.z]); }, sec * 1000); }); },
  };

  boot().catch(e => { console.error('[game] boot', e); L.ui.loading(null, 'Não consegui carregar o mundo. Recarregue a página.'); });
})(window.L);
