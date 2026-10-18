// SYS end-to-end test: two (or more) phones = separate browser contexts (own localStorage, own network switch) on
// dev/sys.html, sharing ONE mocked Supabase that lives in this Node process (table rows with the v5 newer-wins rule,
// realtime postgres_changes filtered by world, broadcast presence channels, lumiar_now rpc, keepalive REST upserts).
// Never talks to a real Supabase (supabase.co is blocked).
// usage: node dev/e2e_sys.js [test|shots] (default test). Screenshots -> /home/claude/v5tools/shots/sys/
//   BG=<jpg> sets a backdrop image for the HUD shots (served as /__bg.jpg).
'use strict';
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const THREE_PKG = '/home/claude/v5tools/three';
const OUT = process.env.OUT || '/home/claude/v5tools/shots/sys';
const BG = process.env.BG || '';
const MODE = process.argv[2] || 'test';
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.css': 'text/css', '.svg': 'image/svg+xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ================================================================ mocked Supabase (shared by every phone)
class Server {
  constructor() { this.rows = new Map(); this.subs = new Map(); this.latency = 25; this.log = []; this.upserts = 0; }
  rowT(r) { return r && r.d && typeof r.d.ts === 'number' ? r.d.ts : (r && r.at ? Date.parse(r.at) : 0); }
  async handle(ph, m) {
    await sleep(this.latency);
    if (ph.offline) return { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } };
    if (m.op === 'select') {
      let out = [...this.rows.values()].filter(r => m.f.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'notnull' ? r[k] !== null : op === 'gt' ? (k === 'at' ? Date.parse(r.at) > Date.parse(v) : r[k] > v) : true));
      out.sort((a, b) => { for (const [k, asc] of m.ord) { if (a[k] < b[k]) return asc ? -1 : 1; if (a[k] > b[k]) return asc ? 1 : -1; } return 0; });
      out = out.slice(m.from || 0, m.lim == null ? undefined : (m.from || 0) + m.lim);
      return { data: JSON.parse(JSON.stringify(out)), error: null };
    }
    if (m.op === 'upsert') { this.upserts++; return this.upsert(m.rows, ph.name); }
    if (m.op === 'rpc') return m.name === 'lumiar_now' ? { data: new Date().toISOString(), error: null } : { data: null, error: { code: 'PGRST202', message: 'not found' } };
    if (m.op === 'sub') {
      this.subs.set(ph.name + '#' + m.sub, { ph, id: m.sub, name: m.name, pg: m.pg });
      setTimeout(() => this.push(ph, { sub: m.sub, kind: 'state', payload: 'SUBSCRIBED' }), this.latency); return { data: 'ok', error: null };
    }
    if (m.op === 'unsub') { this.subs.delete(ph.name + '#' + m.sub); return { data: 'ok', error: null }; }
    if (m.op === 'bc') {
      for (const s of this.subs.values()) if (s.name === m.name && s.ph !== ph && !s.ph.offline) this.push(s.ph, { sub: s.id, kind: 'bc', payload: { event: m.event, payload: m.payload } });
      return { data: 'ok', error: null };
    }
    return { data: null, error: { code: 'x', message: 'bad op' } };
  }
  upsert(rows, who) {
    for (const r of rows) if (r.d != null && Buffer.byteLength(JSON.stringify(r.d)) > 32000) return { data: null, error: { code: '23514', message: 'violates check constraint "lumiar_mundo_d_size"' } };
    for (const r of rows) {
      const k = r.w + '|' + r.c + '|' + r.id, old = this.rows.get(k);
      if (old && this.rowT(r) < this.rowT(old)) { this.log.push('skip ' + k + ' by ' + who); continue; } // v5.sql trigger
      const row = { w: r.w, c: r.c, id: r.id, d: r.d == null ? null : JSON.parse(JSON.stringify(r.d)), at: r.at || new Date().toISOString() };
      this.rows.set(k, row); this.log.push('put ' + k + ' by ' + who);
      const ev = { schema: 'public', table: 'lumiar_mundo', eventType: old ? 'UPDATE' : 'INSERT', new: row, old: {}, commit_timestamp: new Date().toISOString() };
      for (const s of this.subs.values()) if (!s.ph.offline && s.pg.some(f => f === 'w=eq.' + row.w)) this.push(s.ph, { sub: s.id, kind: 'pg', payload: ev });
    }
    return { data: null, error: null };
  }
  push(ph, ev) { setTimeout(() => { ph.page.evaluate(e => window.__sbPush && window.__sbPush(e), ev).catch(() => { }); }, this.latency); }
  dropPhone(ph) { for (const [k, s] of this.subs) if (s.ph === ph) this.subs.delete(k); }
  get(w, c, id) { const r = this.rows.get(w + '|' + c + '|' + id); return r ? r.d : undefined; }
}

// ================================================================ static server + browser
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = u === '/__bg.jpg' && BG ? BG : path.join(ROOT, u);
      if (!(u === '/__bg.jpg' && BG) && !f.startsWith(ROOT)) { rsp.writeHead(403); return rsp.end(); }
      fs.readFile(f, (e, d) => { if (e) { rsp.writeHead(404); return rsp.end('nf'); } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); rsp.end(d); });
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}
let browser, http0, base, server;
const phones = [];
async function phone(name, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.w || 900, height: o.h || 420 }, deviceScaleFactor: o.dsf || 1, hasTouch: !!o.touch });
  const ph = { name, ctx, offline: false, errs: [] };
  await ctx.exposeBinding('__sb', (src, m) => server.handle(ph, m));
  await ctx.route('https://unpkg.com/three@0.128.0/**', r => { const u = new URL(r.request().url()); r.fulfill({ path: THREE_PKG + u.pathname.replace('/three@0.128.0', ''), contentType: 'application/javascript' }); });
  await ctx.route(/supabase\.co/, r => r.abort());
  await ctx.route('**fonts.g**', r => r.abort());
  await ctx.route('https://mock.supabase.test/**', async r => { // keepalive REST upsert on page hide
    if (ph.offline) return r.abort();
    let rows = []; try { rows = JSON.parse(r.request().postData() || '[]'); } catch (e) { }
    const res = server.upsert(rows, name + '(keepalive)'); server.log.push('keepalive ' + rows.length + ' rows by ' + name);
    r.fulfill({ status: res.error ? 400 : 201, body: '' });
  });
  const page = ph.page = await ctx.newPage();
  page.on('pageerror', e => { ph.errs.push(e.message); console.log('PAGEERR[' + name + '] ' + e.message); });
  page.on('console', m => { if (m.type() === 'error' || (process.env.LOGS && m.type() !== 'debug')) console.log('CON[' + name + '] ' + m.text().slice(0, 300)); });
  page.on('framenavigated', f => { if (f === page.mainFrame()) server.dropPhone(ph); });
  ph.url = base + '/dev/sys.html?sb=mock&world=' + (o.world || 'e2e') + '&name=' + encodeURIComponent(o.player || name) + (o.q || '');
  ph.open = async () => { await page.goto(ph.url); await page.waitForFunction('window.READY === true', null, { timeout: 30000 }); };
  ph.reload = async () => { await page.reload(); await page.waitForFunction('window.READY === true', null, { timeout: 30000 }); };
  ph.ev = (fn, arg) => page.evaluate(fn, arg);
  ph.st = () => page.evaluate(() => H.state());
  ph.setOffline = async v => { ph.offline = v; await ctx.setOffline(v); };
  ph.shot = async n => { const f = path.join(OUT, n + '.png'); await page.screenshot({ path: f }); console.log('shot ' + f); };
  phones.push(ph); return ph;
}
async function until(fn, ms = 15000, step = 100) { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(step); } }

// ================================================================ checks
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } }
const J = JSON.stringify;

async function testMode() {
  const A = await phone('Vini'), B = await phone('Bia');
  await A.open(); await B.open();
  console.log('== 1. two players, one world: B sees what A builds, plants and unlocks');
  await A.ev(() => {
    L.save.set('b5', 'e2e_c1', { t: 'canteiro', x: 3, y: 200, z: 2, r: 0 });
    L.save.player.inv.sem_trigo = 2; L.save.dirty();
    window.__planted = L.farm.plant('e2e_c1', 'trigo');
    L.save.set('w5', 'lighthouse', { lit: true, by: L.save.key });
  });
  ok((await A.ev(() => window.__planted.ok)), 'A planted wheat in the canteiro');
  const seen = await until(() => B.ev(() => !!(L.save.get('b5', 'e2e_c1') && L.save.get('f5', 'e2e_c1') && L.save.get('w5', 'lighthouse'))), 8000);
  ok(seen, 'B sees the build (b5), the plot (f5) and the world flag (w5) through realtime');
  ok((await B.ev(() => [L.farm.stage('e2e_c1'), L.save.get('f5', 'e2e_c1').crop].join())) === '0,trigo', 'B computes the same crop stage');
  const peers = await until(async () => (await A.st()).peers.includes('Bia') && (await B.st()).peers.includes('Vini'), 8000);
  ok(peers, 'presence: each sees the other online');
  await B.ev(() => L.farm.water('e2e_c1'));
  ok(await until(() => A.ev(() => L.farm.info('e2e_c1').watered), 8000), 'B waters, A sees the plot watered');

  console.log('== 2. reload restores inventory, spells, notes, home and position; a new phone gets it from the server');
  await A.ev(() => {
    const p = L.save.player; p.inv.madeira = 17; p.inv.sopa_quente = 1; p.sp.faisca = Date.now(); p.notes.n01 = Date.now(); p.tasks.k_fogo = { s: 'on', t: 1 };
    L.surv.setHome(11, 200, 12); H.pos(42.5, 200, -17.25); L.save.setPos(42.5, 200, -17.25, 1.5); L.save.dirty();
  });
  ok(await until(() => A.ev(() => !L.save.saving), 10000), 'A saved (debounced write done)');
  const sv = server.get('e2e', 'p5', 'vini'); ok(sv && sv.inv.madeira === 17 && sv.sp.faisca > 0 && sv.notes.n01 > 0 && sv.pos[0] === 42.5, 'server row p5/vini holds the progress');
  await A.reload();
  const sa = await A.st();
  ok(sa.inv.madeira === 17 && sa.inv.sopa_quente === 1, 'reload: inventory ' + J(sa.inv));
  ok(sa.sp.faisca > 0 && sa.notes.n01 > 0, 'reload: spells and notes');
  ok(J(sa.pos.slice(0, 3)) === J([42.5, 200, -17.25]) && J(sa.home) === J([11, 200, 12]), 'reload: position and home ' + J(sa.pos));
  ok((await A.ev(() => [L.P.x, L.P.z].join())) === '42.5,-17.25', 'player placed at the saved position');
  const N = await phone('Vini-novo-celular', { player: 'Vini' }); await N.open(); const sn = await N.st();
  ok(sn.inv.madeira === 17 && sn.sp.faisca > 0 && sn.notes.n01 > 0 && sn.pos[0] === 42.5, 'new phone (empty browser), same world + name: progress restored');
  await N.ctx.close(); phones.splice(phones.indexOf(N), 1);

  console.log('== 3. offline writes are kept and delivered after reconnecting');
  await B.setOffline(true);
  await B.ev(() => { L.save.set('b5', 'e2e_off1', { t: 'wall', tr: 'madeira', x: 8, y: 200, z: 8, r: 0 }); L.save.player.inv.pedra = 33; L.save.dirty(); });
  ok(await until(() => B.ev(() => L.save.status === 'offline'), 8000), 'B status: offline');
  await sleep(6000); await B.ev(() => L.survUI.update());
  ok(server.get('e2e', 'b5', 'e2e_off1') === undefined, 'nothing reached the server while offline');
  ok((await B.ev(() => document.querySelector('.sv-cloud').dataset.s)) === 'off', 'HUD cloud shows "sem internet"');
  await B.shot('e2e_b_offline');
  const q = await B.ev(() => JSON.parse(localStorage.getItem('lumiar5:e2e:q') || '[]').map(i => i.id)); ok(q.includes('e2e_off1'), 'queued write persisted in localStorage');
  // the game is restarted while the server still cannot be reached (bad signal: the page loads, Supabase does not answer)
  await B.ctx.setOffline(false); await B.reload();
  ok((await B.ev(() => !!L.save.get('b5', 'e2e_off1') && L.save.player.inv.pedra === 33 && L.save.status === 'offline')), 'restart without server: the queued build and the bag are still there');
  ok(server.get('e2e', 'b5', 'e2e_off1') === undefined, 'still nothing on the server');
  B.offline = false; // the server answers again
  ok(await until(() => server.get('e2e', 'b5', 'e2e_off1') && (server.get('e2e', 'p5', 'bia') || {}).inv && server.get('e2e', 'p5', 'bia').inv.pedra === 33, 20000), 'after reconnect: build and bag delivered to the server');
  ok(await until(() => A.ev(() => !!L.save.get('b5', 'e2e_off1')), 8000), 'A sees the build B made offline');
  ok(await until(() => B.ev(() => L.save.status === 'online' && L.save.pending === 0), 8000), 'B back online, queue empty');

  console.log('== 4. the shared clock: skipToDawn moves both clocks; sleeping waits for the partner');
  await A.ev(() => { const g = L.clock.gameMs(), D = L.clock.DAY_LEN * 1000; const target = Math.floor(g / D) * D + 22.5 / 24 * D; L.clock.setOffset(L.clock.off + (target - g), true); });
  ok(await until(async () => Math.abs((await B.st()).hours - 22.5) < .05, 8000), 'A sets 22:30 for the world; B follows');
  await A.ev(() => L.clock.skipToDawn());
  ok(await until(async () => { const a = await A.st(), b = await B.st(); return Math.abs(a.hours - 6) < .1 && Math.abs(b.hours - 6) < .1; }, 8000), 'skipToDawn: both clocks at 06:00');
  await A.ev(() => { const g = L.clock.gameMs(), D = L.clock.DAY_LEN * 1000; const target = Math.floor(g / D) * D + D + 23 / 24 * D; L.clock.setOffset(L.clock.off + (target - g), true); });
  await until(async () => Math.abs((await B.st()).hours - 23) < .05, 8000);
  await A.ev(() => L.surv.sleep({ x: 11, y: 200, z: 12 }));
  ok(await until(() => A.ev(() => /Bia/.test(document.querySelector('.sv-sleep .sv-small').textContent)), 9000), 'A asleep: "Esperando Bia dormir também…"');
  ok((await A.st()).hours > 22.9, 'still night while B is awake');
  await A.shot('e2e_a_waiting');
  await B.ev(() => L.surv.sleep({ x: 9, y: 200, z: 9 }));
  ok(await until(async () => { const a = await A.st(), b = await B.st(); return a.hours > 5.9 && a.hours < 7 && b.hours > 5.9 && b.hours < 7; }, 20000), 'both asleep: the night is skipped for both');
  await sleep(700); await A.shot('e2e_a_dawn');
  ok(await until(() => A.ev(() => !L.surv.sleeping) && B.ev(() => !L.surv.sleeping), 9000), 'both woke up');
  const logA = await A.ev(() => H.log.join(' ')); ok(/slept/.test(logA) && /woke/.test(logA), 'slept/woke events: ' + logA.slice(-80));

  console.log('== 5. page hide sends with keepalive');
  await A.ev(() => { L.save.player.inv.madeira = 99; L.save.dirty(); document.dispatchEvent(new Event('visibilitychange')); });
  await A.ev(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  ok(await until(() => (server.get('e2e', 'p5', 'vini') || {}).inv && server.get('e2e', 'p5', 'vini').inv.madeira === 99, 5000), 'hidden page: progress sent at once (keepalive) ' + server.log.filter(l => /keepalive/.test(l)).slice(-1));
  for (const p of phones) ok(!p.errs.length, 'no page errors on ' + p.name);
  console.log('\n' + pass + ' passed, ' + fail + ' failed; server rows ' + server.rows.size + ', upserts ' + server.upserts);
}

// ================================================================ HUD screenshots
async function shotsMode() {
  const W = +(process.env.W || 844), Hh = +(process.env.H || 390);
  const P = await phone('Vini', { w: W, h: Hh, dsf: +(process.env.DSF || 2), touch: !process.env.DESK, world: 'hud', q: (BG ? '&bg=/__bg.jpg' : '') + (process.env.Q || '') });
  await P.open(); const pre = process.env.PRE || 'hud';
  await P.ev(() => { L.surv.set({ fome: 72, en: 88, mana: 64, frio: 0 }); L.survUI.update(); }); await sleep(900);
  await P.shot(pre + '_1_normal');
  await P.ev(() => { L.surv.set({ fome: 18, en: 34, mana: 40, frio: .62, wet: .8 }); H.ctx.night = 1; L.surv.addBuff('resistente', 125); L.survUI.update(); L.survUI.hint('Você está com fome.', 'fome'); });
  await sleep(900); await P.shot(pre + '_2_hungry_cold');
  await P.ev(() => { H.ctx.night = 0; L.surv.set({ fome: 55, frio: 0, wet: 0 }); L.surv.warm(180); L.survUI.update(); L.survUI.tip('mana'); });
  await sleep(700); await P.shot(pre + '_3_warm_tip');
  await P.setOffline(true); await sleep(2500); await P.ev(() => { L.save.set('b5', 'x', { x: 1 }); L.survUI.update(); L.survUI.tip('cloud'); }); await sleep(800);
  await P.shot(pre + '_4_offline'); await P.setOffline(false); await sleep(1500);
  await P.ev(() => { L.clock.setHours(23); L.surv.sleep({ x: 0, y: 200, z: 0 }); }); await sleep(1600);
  await P.ev(() => { document.querySelector('.sv-sleep .sv-small').textContent = 'Esperando Bia dormir também…'; document.querySelector('.sv-sleep .sv-btn').classList.add('sv-on'); });
  await sleep(600); await P.shot(pre + '_5_sleep');
  // (screenshots are slow here: the game loop is paused for the dawn shot so the veil does not fade first)
  await until(() => P.ev(() => document.querySelector('.sv-sleep').classList.contains('sv-dawn') && (H.paused = true)), 15000, 50); await sleep(1300); await P.shot(pre + '_6_dawn');
  await P.ev(() => { H.paused = false; });
  await until(() => P.ev(() => !L.surv.sleeping), 10000); await sleep(1500);
  await P.ev(() => { L.P.vy = -30; L.surv.respawn('nuvens'); }); await sleep(1300); await P.shot(pre + '_7_respawn');
  await sleep(2500);
  await P.ev(() => { L.surv.set({ fome: 40, en: 100, mana: 100, frio: 0 }); L.save.player.inv.pao = 1; L.surv.eat('pao'); }); await sleep(250); await P.shot(pre + '_8_eat');
  for (const p of phones) ok(!p.errs.length, 'no page errors on ' + p.name);
}

(async () => {
  http0 = await serve(); base = 'http://127.0.0.1:' + http0.address().port; server = new Server();
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try { if (MODE === 'shots') await shotsMode(); else await testMode(); }
  catch (e) { fail++; console.log('FATAL', e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e); }
  await browser.close(); http0.close(); process.exit(fail ? 1 : 0);
})();
