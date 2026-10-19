// Integration test of the real game page (index.html) for phase B: boot, controls, contracts, budget, reload.
// Headless Chromium + SwiftShader, in-page fake Supabase (dev/sbfake.js + dev/sbshim.js); every request that is not
// this local server is refused and counted (the real Supabase is never reached).
// usage: node dev/integ_test.js            (≈ 4-6 min; prints PASS / FAIL / INFO lines, exit code = failures)
//   SHOTS=<dir> also saves screenshots (spawn, village); Q=alto|medio|baixo (default medio)
'use strict';
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const THREE_PKG = '/home/claude/v5tools/three';
const SHOTS = process.env.SHOTS || '', Q = process.env.Q || 'medio';
// budget of TECH §0 on medio and the per-owner allowances of INTEG §0 (triangles incl. the owner's shadow casters)
const BUDGET = { calls: 250, tris: 450000 };
const ALLOW = { terrain: 225000, grass: 65000, scatter: 50000, sky: 25000, dressing: 30000, actors: 35000, builds: 10000, farm: 10000, other: 5000 };   // builds + farm share one 10k pool; other = story objects, particles, ghost
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

let fails = 0;
const ok = (name, cond, info) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };
const note = (name, info) => console.log('INFO ' + name + '  ' + (typeof info === 'string' ? info : JSON.stringify(info)));

const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(ROOT, u); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d); });
});

srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port, origin = 'http://127.0.0.1:' + port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 960, height: 540 } });
  const p = await ctx.newPage();
  const errs = [], foreign = [];
  p.on('pageerror', e => { errs.push(e.message); console.log('PAGEERR ' + e.message); });
  p.on('console', m => { if (m.type() === 'error') { errs.push(m.text()); console.log('CONERR ' + m.text().slice(0, 300)); } });
  await p.addInitScript(q => { try { localStorage.setItem('lumiar:q', JSON.stringify(q)); } catch (e) { } }, Q);
  await p.addInitScript({ content: fs.readFileSync(path.join(ROOT, 'dev/sbfake.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'dev/sbshim.js'), 'utf8') });
  await p.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(origin)) return r.continue();
    if (u.startsWith('https://unpkg.com/three@0.128.0/')) return r.fulfill({ path: THREE_PKG + new URL(u).pathname.replace('/three@0.128.0', ''), contentType: 'application/javascript' });
    if (/^data:|^blob:/.test(u)) return r.continue();
    if (!/fonts\.(googleapis|gstatic)\.com/.test(u)) foreign.push(u);   // fonts are allowed to fail (fallback fonts)
    return r.abort();
  });
  const ev = (fn, arg) => p.evaluate(fn, arg);
  const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
  try {
    // ---------------------------------------------------------------- boot → title → enter
    const t0 = Date.now();
    await p.goto(origin + '/index.html');
    await p.waitForFunction(() => window.L && L.game && L.game.phase === 'title', null, { timeout: 180000 });
    note('boot', await ev(() => L.game.times));
    ok('title reached', true, (Date.now() - t0) + ' ms wall');
    await ev(() => { document.querySelector('#nm').value = 'Teste'; document.querySelector('#wc').value = 'integ-test-' + Date.now().toString(36); document.querySelector('#enter').click(); });
    await p.waitForFunction(() => L.game.phase === 'play' && L.worldReady, null, { timeout: 120000 });
    const sp = await ev(() => { const s = L.poi('spawn'); return { d: Math.hypot(L.P.x - s.x, L.P.z - s.z), ry: L.P.ry }; });
    ok('spawn at poi spawn', sp.d < 3, sp);

    // ---------------------------------------------------------------- contracts present (INTEG §3.3, §4, §5)
    const api = await ev(() => {
      const f = n => typeof n === 'function';
      return {
        hero: f(L.makeHero) && f(L.animHero) && !L.makeMage4 && !L.animMage4, ticks: f(L.worldTick) && f(L.actorsTick) && f(L.buildsTick) && f(L.uiTick),
        story: f(L.castleObj) && f(L.castleRestore) && f(L.storyBuilds) && f(L.lightFireNear) && f(L.giveTame) && f(L.onStoryLook) && f(L.storyTeleport),
        game: f(L.craft) && f(L.recipesFor) && f(L.chest.open) && f(L.chest.put) && f(L.chest.take) && f(L.travel.list) && f(L.travel.go),
        build: ['tiers', 'pieces', 'begin', 'active', 'rotate', 'confirm', 'cancel'].every(k => f(L.build[k])),
        ui: f(L.ui.refresh) && f(L.ui.open) && f(L.ui.mapSeen), heroHandle: !!(L.game.M && L.game.M.root && f(L.game.M.part) && f(L.game.M.setTool)),
      };
    });
    ok('contract functions', Object.values(api).every(Boolean), api);

    // ---------------------------------------------------------------- controls
    const sp0 = await ev(() => { const s = L.poi('spawn'); return [s.x, s.z]; });
    const ctl = await ev(([x, z]) => {
      const go = () => __lumiar.goto(x, z, 2.85), dist = () => Math.hypot(L.P.x - x, L.P.z - z), o = {};
      go(); __lumiar.sim(5, ['KeyW'], 0); o.walk = +(dist() / 5).toFixed(2);
      go(); __lumiar.sim(5, ['KeyW', 'ShiftLeft'], 0); o.run = +(dist() / 5).toFixed(2);
      for (const k of [['KeyW', 'KeyD'], ['KeyW', 'KeyA'], ['KeyD'], ['KeyS']]) { go(); __lumiar.sim(10, k, 0); o[k.join('+')] = +dist().toFixed(1); }
      go(); __lumiar.sim(.5, [], 0); const y0 = L.P.y; L.input.jumpQ = true; let m = 0; for (let i = 0; i < 30; i++) { __lumiar.sim(1 / 30, [], 0); m = Math.max(m, L.P.y - y0); } o.jump = +m.toFixed(2);
      const p0 = L.cam.tpitch; L.input.camDY -= 80; __lumiar.sim(.2, [], 0); o.dragUpLooksUp = L.cam.tpitch < p0;
      return o;
    }, sp0);
    ok('walk speed ≈ 5 m/s', ctl.walk > 4.3 && ctl.walk < 5.3, ctl.walk);
    ok('run (Shift) faster than walk', ctl.run > ctl.walk + 1.5, ctl.run);
    for (const k of ['KeyW+KeyD', 'KeyW+KeyA', 'KeyD', 'KeyS']) ok('straight line ' + k + ' (net ≥ 0.8 × v × 10 s)', ctl[k] >= .8 * ctl.walk * 10, ctl[k]);
    ok('jump ≥ 1.2 m', ctl.jump >= 1.2, ctl.jump);
    ok('drag up looks up', ctl.dragUpLooksUp);

    // ---------------------------------------------------------------- lighthouse trial (INTEG §4: lanterna_farol)
    const lh = await ev(() => {
      const p = L.poi('lighthouse'); if (!p) return { err: 'no poi' };
      const gy = L.ground(p.x, p.z), x = p.x + 2, z = p.z + 1;
      for (let k = 0; k < 4; k++) L.save.set('b5', 'tst_p' + k, { t: 'pillar', tr: 'madeira', x, y: gy + k * 3, z, r: 0 });
      L.save.set('b5', 'tst_lamp', { t: 'lanterna_farol', x, y: gy + 12, z, r: 0 });
      __lumiar.hours(22.5); __lumiar.goto(x + 3, z);
      const lit = L.lightFireNear(x, z, 3); __lumiar.sim(4, [], 0);
      const rec = L.storyBuilds().find(r => r.id === 'tst_lamp');
      return { lit, rec: rec && { t: rec.t, h: rec.h, lit: rec.lit }, done: !!L.save.get('w5', 'lighthouse') };
    });
    ok('lighthouse lamp lit by lightFireNear', lh.lit && lh.rec && lh.rec.lit === 1, lh);
    ok('lighthouse trial completes (w5 lighthouse)', lh.done, lh);
    await ev(() => { for (const id of ['tst_p0', 'tst_p1', 'tst_p2', 'tst_p3', 'tst_lamp']) L.save.del('b5', id); __lumiar.hours(10); });

    // ---------------------------------------------------------------- action API stubs (INTEG §5.6, §5.8)
    const act = await ev(() => {
      const o = {}; const inv = L.inv;
      o.craftNo = L.craft('corda'); inv.give('fibra', 3, true); o.craftYes = L.craft('corda'); o.corda = inv.count('corda');
      inv.give('madeira', 5, true); o.put = L.chest.put('tst_chest', 'madeira', 2); o.inChest = L.chest.open('tst_chest').items.madeira; o.take = L.chest.take('tst_chest', 'madeira', 1);
      o.pieces = L.build.pieces('madeira').length; o.items = L.build.pieces(null).length; o.begin = L.build.begin('madeira', 'foundation'); __lumiar.sim(.2, [], 0); o.active = L.build.active(); L.build.cancel(); o.after = L.build.active();
      o.travel = L.travel.list().length; o.mapPanel = (L.ui.open('mapa'), L.ui.isOpen()); L.ui.refresh('mapa'); L.ui.closePanels();
      return o;
    });
    ok('craft / chest / build / travel stubs', !act.craftNo.ok && act.craftYes.ok && act.corda === 1 && act.put && act.inChest === 2 && act.take && act.pieces > 5 && act.items > 5 && act.begin && act.active && act.after === null && act.travel > 0 && act.mapPanel === 'mapa', act);

    // ---------------------------------------------------------------- budget: default first minute (one real frame every 2 s)
    const route = await ev(() => { __lumiar.goto('spawn', null, (L.SPAWN_VIEW && L.SPAWN_VIEW.ry != null) ? L.SPAWN_VIEW.ry : L.SPAWN5.ry); __lumiar.settle(30000); __lumiar.sim(.5, [], 0); L.game.resetPeaks(); const at0 = __lumiar.budget(); const r = __lumiar.sim(60, ['KeyW'], 0, 2); return { at0, peak: r.peak, timing: __lumiar.timing() }; });
    await shot('it_spawn');
    ok('first minute ≤ ' + BUDGET.tris / 1000 + 'k tris', route.peak.tris <= BUDGET.tris, route.peak);
    ok('first minute ≤ ' + BUDGET.calls + ' draw calls', route.peak.calls <= BUDGET.calls, route.peak.calls);
    note('spawn budget', route.at0);
    const pk = await ev(a => { __lumiar.goto(a[0], a[1], a[2]); __lumiar.settle(30000); __lumiar.sim(.1, [], 0); return __lumiar.budget(); }, route.peak.at);
    note('route peak budget (same spot and yaw)', pk);
    note('stage timing [avg, max, peak ms] (SwiftShader: render is not a phone number)', route.timing);
    const vil = await ev(() => { const t = L.poi('tower_house'); __lumiar.goto(-978, 5200, Math.atan2(t.x + 978, t.z - 5200)); __lumiar.settle(30000); __lumiar.sim(.2, [], 0); return __lumiar.budget(); });
    await shot('it_village');
    ok('village view ≤ ' + BUDGET.tris / 1000 + 'k tris', vil.all.tris <= BUDGET.tris, vil.all);
    note('village budget', vil);
    for (const k in ALLOW) { const a = Math.max(...[route.at0, pk, vil].map(b => (b.owners[k] || {}).tris || 0)); if (a > ALLOW[k]) note('owner over allowance: ' + k, a + ' > ' + ALLOW[k]); }

    // ---------------------------------------------------------------- reload restores the position (page hide writes it)
    const before = await ev(() => { __lumiar.goto('spawn', null, 2.85); __lumiar.sim(3, ['KeyW'], 0); return [L.P.x, L.P.y, L.P.z]; });
    await p.reload();
    await p.waitForFunction(() => window.L && L.game && L.game.phase === 'title', null, { timeout: 180000 });
    await ev(() => document.querySelector('#enter').click());
    await p.waitForFunction(() => L.game.phase === 'play', null, { timeout: 120000 });
    const after = await ev(() => [L.P.x, L.P.y, L.P.z]);
    const dd = Math.hypot(after[0] - before[0], after[2] - before[2]);
    ok('reload restores the position (< 1 m)', dd < 1, { before, after, d: +dd.toFixed(2) });

    ok('no page errors', errs.length === 0, errs.slice(0, 3));
    ok('no request left the local server', foreign.length === 0, foreign.slice(0, 5));
    const gerr = await ev(() => L.game.err); ok('no stage threw', Object.keys(gerr).length === 0, gerr);
  } catch (e) { fails++; console.log('FAIL exception ' + e.message.slice(0, 500)); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await b.close(); srv.close(); process.exit(fails);
});
