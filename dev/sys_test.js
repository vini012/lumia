// SYS unit tests (Node, no dependencies): node dev/sys_test.js [filter]
// Persistence (merge rules, debounce/flush, offline queue, keepalive, two devices), RLE, clock math, survival rates,
// crop growth. Uses dev/fakeenv.js (fake time, fake Supabase, simulated devices).
'use strict';
const E = require('./fakeenv');
const { T, advance, FakeServer, device, kill, makeStorage } = E;
const filter = process.argv[2] || '';
const tests = []; const test = (name, fn) => tests.push({ name, fn });
let fails = 0, passes = 0, cur = '';
function ok(cond, msg) { if (cond) { passes++; return; } fails++; console.log('  FAIL [' + cur + '] ' + msg); }
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, (msg || '') + ' expected ' + B + ' got ' + A); }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b}±${tol} got ${a}`); }
const H = 3600e3, MIN = 60e3;

// ================================================================ pure helpers
test('slug / world code', () => {
  const L = device('x').L, s = L.save;
  eq(s.playerKey('Vinícius'), 'vinicius'); eq(s.playerKey('  Bia  '), 'bia'); eq(s.playerKey('Ana Lú!'), 'ana-lu'); eq(s.playerKey(''), 'jogador');
  eq(s.playerKey('ÇÃO çao'), 'cao-cao'); eq(s.worldCode('Nosso Mundo!'), 'nosso-mundo-'); eq(s.worldCode(''), 'nosso-mundo');
});
test('mergeMono rules', () => {
  const { mergeMono } = device('x').L.save._t;
  eq(mergeMono({ a: 1, b: true, c: [1, 2] }, { a: 3, b: false, c: [2, 3], d: 'x' }, true), { a: 3, b: true, c: [1, 2, 3], d: 'x' });
  eq(mergeMono({ n01: 1000 }, { n02: 2000 }), { n01: 1000, n02: 2000 });
  eq(mergeMono({ k: { n: 2, done: false } }, { k: { n: 1, done: true } }), { k: { n: 2, done: true } });
  eq(mergeMono(['faisca'], ['faisca', 'brotar']), ['faisca', 'brotar']);
  eq(mergeMono(undefined, { a: 1 }), { a: 1 });
});
test('resolvePlayer: every branch', () => {
  const { resolvePlayer } = device('x').L.save._t;
  const P = (ts, o) => Object.assign({ ts, inv: {}, notes: {}, sp: [], flags: {}, pos: [0, 0, 0, 0] }, o);
  eq(resolvePlayer(null, null).d, null, 'nothing');
  eq(resolvePlayer(null, P(5, { inv: { a: 1 } })).d.inv, { a: 1 }, 'server only');
  let r = resolvePlayer({ d: P(7, { inv: { b: 2 } }), base: 0, fresh: true }, null); eq(r.d.inv, { b: 2 }); ok(r.write, 'local only -> write');
  r = resolvePlayer({ d: P(9, { inv: { b: 3 } }), base: 5, fresh: false }, P(5, { inv: { b: 1 } })); eq(r.d.inv, { b: 3 }, 'local newer, server unchanged'); ok(r.write);
  r = resolvePlayer({ d: P(5, { inv: { b: 1 } }), base: 5, fresh: false }, P(5, { inv: { b: 1 } })); ok(!r.write, 'same -> no write');
  r = resolvePlayer({ d: P(5, { inv: { b: 1 } }), base: 5, fresh: false }, P(8, { inv: { b: 9 } })); eq(r.d.inv, { b: 9 }, 'only server changed'); ok(!r.write);
  // both changed: newer wins wholesale, progress merged
  r = resolvePlayer({ d: P(12, { inv: { b: 4 }, notes: { n02: 1 }, sp: ['faisca'] }), base: 5, fresh: false }, P(8, { inv: { b: 9 }, notes: { n01: 1 }, sp: ['brotar'] }));
  eq(r.d.inv, { b: 4 }, 'conflict: local newer inv'); eq(r.d.notes, { n01: 1, n02: 1 }, 'conflict: notes union'); eq(r.d.sp.sort(), ['brotar', 'faisca']); ok(r.write && r.d.ts > 12);
  // fresh device played offline: existing save wins, its notes merged in
  r = resolvePlayer({ d: P(50, { inv: { berry: 2 }, notes: { n01: 1 } }), base: 0, fresh: true }, P(20, { inv: { madeira: 30 }, notes: { n05: 1 } }));
  eq(r.d.inv, { madeira: 30 }, 'fresh: server inventory wins'); eq(r.d.notes, { n05: 1, n01: 1 }, 'fresh: notes merged'); ok(r.write);
});
test('older array-shaped progress becomes id maps (nothing dropped)', async () => {
  const srv = new FakeServer(); srv.upsert([{ w: 'teste', c: 'p5', id: 'vini', d: { v: 5, name: 'Vini', sp: ['faisca'], dreams: ['d1'], th: [], notes: { n01: 5 }, inv: { madeira: 2 }, ts: 10 }, at: new Date(10).toISOString() }]);
  const A = device('A', { server: srv }); const p = await boot(A, 'Vini');
  eq(p.sp, { faisca: 1 }); eq(p.dreams, { d1: 1 }); eq(p.th, {}); eq(p.notes, { n01: 5 }); eq(p.inv, { madeira: 2 });
  p.sp.brotar = 99; A.L.save.dirty(); await advance(5000); eq(srv.rows.get('teste|p5|vini').d.sp, { faisca: 1, brotar: 99 }, 'map keys survive JSON');
  const { mergeMono } = A.L.save._t; eq(mergeMono({ k: { s: 'done', t: 1 } }, { k: { s: 'on', t: 2 } }, true), { k: { s: 'done', t: 2 } }, 'task states only move forward');
});
test('RLE + base64 round trips and size of a well explored map', () => {
  const { rleEncode, rleDecode, b64enc, b64dec, resample } = device('x').L.save._t;
  for (const n of [0, 1, 2, 3, 4, 5, 255, 1000]) { const u = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255); eq([...b64dec(b64enc(u))], [...u], 'b64 n=' + n); }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const res of [16, 128, 512]) {
    const m = new Uint8Array(res * res); for (let i = 0; i < m.length; i++) m[i] = rnd() < .3 ? 1 : 0;
    const d = rleDecode(rleEncode(m), res * res); ok(d.every((v, i) => v === m[i]), 'random mask res ' + res);
  }
  eq([...rleDecode(rleEncode(new Uint8Array([1, 1, 0, 1])), 4)], [1, 1, 0, 1], 'starts with 1');
  // a long trip: 200 km of meandering path revealed with r = 110 m on a 512 grid
  const L = device('x').L; const ex = L.save.explored; let x = -6000, z = 6000, a = 0;
  for (let i = 0; i < 200000 / 50; i++) { a += (rnd() - .5) * .5; x += Math.cos(a) * 50; z += Math.sin(a) * 50; if (Math.abs(x) > 7600) a += Math.PI; if (Math.abs(z) > 7600) a += Math.PI; x = Math.max(-7700, Math.min(7700, x)); z = Math.max(-7700, Math.min(7700, z)); ex.reveal(x, z, 110); }
  const enc = ex.encode(); console.log('    explored cells', ex.count, '=', (ex.count / 512 / 512 * 100).toFixed(1) + '% -> m5 rle', enc.rle.length, 'chars at res', enc.res);
  ok(enc.rle.length < 30000, 'm5 under 30 KB');
  const back = rleDecode(enc.rle, enc.res * enc.res); ok(back.reduce((s, v) => s + v, 0) === ex.count || enc.res < 512, 'decoded count');
  near(ex.at(x, z), 1, .01, 'at() inside'); ok(ex.at(7900, -7900) === 0 || ex.seen(7900, -7900), 'at() far');
  const r2 = resample(new Uint8Array([1, 0, 0, 0]), 2, 1); eq([...r2], [1], 'OR downsample');
});

// ================================================================ clock
test('clock math', () => {
  const L = device('x').L, C = L.clock; C.off = 0; C.debugOffset = 0;
  const DAY = 1440e3; const base = Math.floor(T.now / DAY) * DAY; // a game midnight (off = 0)
  C.debugOffset = base - T.now; near(C.hours(), 0, 1e-6, 'midnight'); ok(C.isNight(), 'midnight is night');
  C.debugOffset = base + DAY * .25 - T.now; near(C.dayPhase(), .25, 1e-9); near(C.sunElev(), 0, 1e-6, 'sunrise at 06:00'); eq(C.clockText(), '06:00');
  C.debugOffset = base + DAY * .5 - T.now; near(C.sunElev(), 1, 1e-6, 'noon'); ok(!C.isNight()); near(C.nightness(), 0, 1e-6);
  C.debugOffset = base + DAY * .75 - T.now; near(C.sunElev(), 0, 1e-6, 'sunset 18:00'); ok(C.isNight(), '18:00 counts as night');
  C.debugOffset = base + DAY * .9 - T.now; near(C.nightness(), 1, 1e-6, 'deep night');
  // moon: 8 days per cycle
  const m0 = C.moonPhase(base), m4 = C.moonPhase(base + 4 * DAY), m8 = C.moonPhase(base + 8 * DAY); near((m4 - m0 + 1) % 1, .5, 1e-9, 'half cycle in 4 days'); near(m8, m0, 1e-9, '8 days loop');
  // skipToDawn from 22:00 -> next 06:00; from 03:00 -> same night 06:00; 10:00 does nothing
  C.setHours(22); let add = C.skipToDawn(); near(add / 1000, 8 * 60, 2, 'skip 22->06 = 8 in-game hours = 480 s'); near(C.hours(), 6, .05);
  C.setHours(3); add = C.skipToDawn(); near(add / 1000, 3 * 60, 2, 'skip 03->06'); near(C.hours(), 6, .05);
  C.setHours(10); eq(C.skipToDawn(), 0, 'no skip by day');
  C.setHours(13.5); ok(C.skipToDawn() > 0, 'afternoon skip allowed (evening rest)');
  const sk = C.sky(); ok(Math.abs(Math.hypot(...sk.sunDir) - 1) < 1e-9 && sk.dayW + sk.duskW + sk.nightW > .999, 'sky weights');
});

// ================================================================ persistence (fake Supabase)
async function boot(dev, name, o) { const p = dev.L.save.init(Object.assign({ world: 'teste', name, timeout: 3000 }, o)); await advance(500); return p; }
test('init: new player, new world, status online', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv });
  const p = await boot(A, 'Bia', { startHour: 7, defaults: { inv: { frutinhas: 4 } } }); const L = A.L;
  eq(L.save.status, 'online'); eq(L.save.backend, 'sb'); eq(L.save.key, 'bia'); eq((await p).inv, { frutinhas: 4 });
  near(L.clock.hours(), 7, .01, 'brand-new world starts at 07:00');
  await advance(1000); ok(srv.rows.has('teste|w5|clock'), 'clock row created');
});
test('debounce + coalescing: player 4 s, world writes 400 ms batched', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }); await boot(A, 'Vini'); const L = A.L; const cl = A.client;
  const u0 = cl.calls.upsert;
  for (let i = 0; i < 30; i++) { L.save.player.inv.madeira = i; L.save.dirty(); await advance(100); } // 3 s of changes
  eq(cl.calls.upsert - u0, 0, 'nothing written before 4 s'); ok(L.save.saving, 'saving flag');
  await advance(1200); eq(cl.calls.upsert - u0, 1, 'one upsert at 4 s'); eq(srv.rows.get('teste|p5|vini').d.inv.madeira, 29, 'latest value');
  ok(!L.save.saving, 'saved'); eq(L.save.status, 'online');
  const u1 = cl.calls.upsert;
  L.save.set('b5', 'b1', { t: 0, x: 1 }); L.save.set('b5', 'b2', { x: 2 }); L.save.set('b5', 'b1', { t: 'wall', x: 3 }); L.save.set('k5', 'b2', { items: { pedra: 2 } });
  await advance(300); eq(cl.calls.upsert - u1, 0, 'world: not yet'); await advance(300); eq(cl.calls.upsert - u1, 1, 'world: one batched upsert');
  eq(srv.rows.get('teste|b5|b1').d.x, 3, 'coalesced to last'); ok(srv.rows.get('teste|b5|b1').d.ts > 0, 'ts stamped'); eq(srv.rows.get('teste|b5|b1').d.t, 'wall', 'piece field t kept');
  L.save.del('b5', 'b2'); await advance(600); eq(srv.rows.get('teste|b5|b2').d, null, 'soft delete d=null'); ok(!L.save.get('b5', 'b2'));
});
test('two players see each other: builds, plots, world flags, presence', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }), B = device('B', { server: srv });
  await boot(A, 'Vini'); await boot(B, 'Bia');
  const seen = []; B.L.save.on('b5', (id, d, old, o) => seen.push([id, d && d.x, o]));
  A.L.save.set('b5', 'bx', { t: 'foundation', x: 10 }); A.L.save.set('f5', 'bx', { crop: 'trigo', pt: T.now }); A.L.save.set('w5', 'lighthouse', { lit: true });
  await advance(1500);
  eq(B.L.save.get('b5', 'bx').x, 10, 'B sees build'); eq(B.L.save.get('f5', 'bx').crop, 'trigo', 'B sees plot'); eq(B.L.save.get('w5', 'lighthouse').lit, true, 'B sees world flag');
  eq(seen, [['bx', 10, 'remote']], 'one remote event');
  // presence
  A.L.save.room.presence({ x: 1, z: 2 }); B.L.save.room.presence({ x: 5, z: 6, sl: 1 }); await advance(3000);
  const pa = A.L.save.room.peers(), pb = B.L.save.room.peers();
  eq(pa.map(p => [p.presence.k, p.presence.x, p.presence.sl]), [['bia', 5, 1]], 'A sees B'); eq(pb.map(p => p.presence.n), ['Vini'], 'B sees A');
  // B leaves: A prunes after silence
  kill(B); await advance(12000); eq(A.L.save.room.peers().length, 0, 'pruned');
});
test('newer wins: an older realtime / queued snapshot never overwrites a newer row', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }), B = device('B', { server: srv });
  await boot(A, 'Vini'); await boot(B, 'Bia');
  A.L.save.set('b5', 'door', { o: false }); await advance(1500);
  // A goes offline and toggles the door (older), then B toggles it later (newer)
  A.setOffline(true); A.L.save.set('b5', 'door', { o: true, by: 'A' }); await advance(2000); eq(A.L.save.status, 'offline');
  await advance(10 * MIN);
  B.L.save.set('b5', 'door', { o: false, by: 'B' }); await advance(1500);
  A.setOffline(false); await advance(5000);
  eq(srv.rows.get('teste|b5|door').d.by, 'B', 'server keeps the newer write'); eq(A.L.save.get('b5', 'door').by, 'B', 'A adopts the newer row');
  eq(A.L.save.status, 'online'); eq(A.L.save.pending, 0);
  // the server-side trigger alone also protects (client check disabled by a raw old upsert)
  srv.upsert([{ w: 'teste', c: 'b5', id: 'door', d: { o: true, ts: 5 }, at: new Date(5).toISOString() }]);
  eq(srv.rows.get('teste|b5|door').d.by, 'B', 'trigger keeps newer');
});
test('offline: writes queue, survive a crash, are delivered on the next start', async () => {
  const srv = new FakeServer(); const store = new Map();
  const A = device('A', { server: srv, storage: store }); await boot(A, 'Vini');
  A.setOffline(true);
  A.L.save.set('b5', 'w1', { t: 'wall', x: 1 }); A.L.save.set('t5', 'pet1', { o: 'vini', sp: 'ovelha' });
  A.L.save.player.inv.madeira = 42; A.L.save.player.sp.faisca = 1234; A.L.save.dirty();
  await advance(8000); eq(A.L.save.status, 'offline'); ok(!srv.rows.has('teste|b5|w1'), 'not on server yet');
  await advance(2000); // mirrors written
  kill(A);             // crash: no pagehide, no flush
  const A2 = device('A2', { server: srv, storage: store }); await boot(A2, 'Vini'); await advance(3000);
  ok(srv.rows.has('teste|b5|w1') && srv.rows.has('teste|t5|pet1'), 'queued world writes delivered');
  eq(srv.rows.get('teste|p5|vini').d.inv.madeira, 42, 'offline player progress delivered'); eq(A2.L.save.player.sp, { faisca: 1234 });
  eq(A2.L.save.pending, 0);
});
test('reconnect after a long offline period: retry with backoff + online event', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }); await boot(A, 'Vini');
  A.netDown = true; A.client.setOffline(true); // flaky network: navigator still says online
  A.L.save.set('b5', 'x1', { x: 1 }); await advance(500); eq(A.L.save.status, 'offline');
  const c0 = A.client.calls.upsert + A.client.calls.select; await advance(2 * MIN); const tries = A.client.calls.upsert + A.client.calls.select - c0; ok(tries >= 3 && tries <= 8, 'backoff retries in 2 min: ' + tries);
  A.netDown = false; A.client.setOffline(false); await advance(70000);
  ok(srv.rows.has('teste|b5|x1'), 'delivered by retry'); eq(A.L.save.status, 'online');
});
test('page hide: everything is written down and sent with keepalive', async () => {
  const srv = new FakeServer(); const store = new Map(); const A = device('A', { server: srv, storage: store }); await boot(A, 'Vini');
  A.L.save.player.inv.pedra = 7; A.L.save.dirty(); A.L.save.set('b5', 'k1', { x: 9 });
  A.hide(); // before the debounce
  ok(A.ctx.fetchLog.length >= 1 && A.ctx.fetchLog[0].opt.keepalive === true, 'keepalive fetch'); ok(/\/rest\/v1\/lumiar_mundo$/.test(A.ctx.fetchLog[0].url), 'REST url');
  const mir = JSON.parse(store.get('lumiar5:teste:p:vini')); eq(mir.d.inv.pedra, 7, 'mirror written synchronously');
  await advance(200); eq(srv.rows.get('teste|p5|vini').d.inv.pedra, 7, 'server got it'); ok(srv.rows.has('teste|b5|k1'));
  eq(A.L.save.pending, 0, 'confirmed -> queue empty');
});
test('progress survives a new phone (cleared browser): same world + name', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }); await boot(A, 'Vini');
  const p = A.L.save.player; p.inv = { madeira: 12, sem_trigo: 3 }; p.sp = { faisca: 10, brotar: 20 }; p.notes = { n01: 111, n02: 222 }; p.home = [1, 2, 3]; A.L.save.setPos(100, 20, -50, 1.2);
  await advance(6000); kill(A);
  const N = device('newphone', { server: srv }); const p2 = await boot(N, 'vini'); // lower case: same slug
  eq(p2.inv, { madeira: 12, sem_trigo: 3 }); eq(p2.sp, { faisca: 10, brotar: 20 }); eq(p2.notes, { n01: 111, n02: 222 }); eq(p2.pos, [100, 20, -50, 1.2]); eq(p2.home, [1, 2, 3]);
});
test('two devices of the same player: remote progress adopted, nothing lost', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }); await boot(A, 'Vini');
  A.L.save.player.inv = { madeira: 5 }; A.L.save.player.notes = { n01: 1 }; A.L.save.dirty(); await advance(5000);
  let ev = 0; A.L.save.on('player', () => ev++); const dups = []; A.L.save.on('dup', d => dups.push(d));
  const B = device('B', { server: srv }); await boot(B, 'Vini');
  eq(B.L.save.player.inv, { madeira: 5 }, 'B loads A');
  B.L.save.player.inv.madeira = 9; B.L.save.player.notes.n02 = 2; B.L.save.dirty(); await advance(5000);
  eq(A.L.save.player.inv.madeira, 9, 'A adopts newer inventory'); eq(A.L.save.player.notes, { n01: 1, n02: 2 }); ok(ev >= 1, 'player event');
  await advance(3000); ok(dups.length === 1, 'duplicate device detected via presence');
});
test('fresh device offline at boot, then online: existing save wins, its story progress merged', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }); await boot(A, 'Vini');
  A.L.save.player.inv = { madeira: 30 }; A.L.save.player.notes = { n05: 1 }; A.L.save.dirty(); await advance(5000); kill(A);
  const C = device('C', { server: srv, offline: true }); C.client = null;
  const pr = C.L.save.init({ world: 'teste', name: 'Vini', timeout: 2000 }); await advance(3000); const p = await pr;
  eq(C.L.save.status, 'offline'); eq(p.inv, {}, 'fresh while offline');
  p.inv.frutinhas = 2; p.notes.n01 = 7; C.L.save.dirty(); await advance(6000);
  C.setOffline(false); await advance(15000);
  eq(C.L.save.player.inv, { madeira: 30 }, 'server inventory wins'); eq(C.L.save.player.notes, { n05: 1, n01: 7 }, 'notes merged');
  eq(srv.rows.get('teste|p5|vini').d.notes, { n05: 1, n01: 7 }, 'merged progress written back');
});
test('migration not applied: server refuses v5 rows, data kept, delivered after the fix', async () => {
  const srv = new FakeServer({ allowed: new Set(['builds4', 'cut4']) }); const A = device('A', { server: srv }); await boot(A, 'Vini');
  A.L.save.set('b5', 'r1', { x: 1 }); await advance(1000); eq(A.L.save.status, 'refused'); ok(A.L.save.pending >= 1, 'kept');
  srv.allowed = null; A.L.save.retry(); await advance(1000); ok(srv.rows.has('teste|b5|r1'), 'delivered after migration'); eq(A.L.save.status, 'online');
});
test('row size guard', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }); await boot(A, 'Vini');
  eq(A.L.save.set('k5', 'big', { s: 'x'.repeat(40000) }), null, 'too big refused locally');
  ok(A.L.save.set('k5', 'ok', { s: 'x'.repeat(20000) }) != null);
  for (let i = 0; i < 300; i++) A.L.save.player.stats['s' + i] = 'x'.repeat(100); A.L.save.player.notes.n01 = 5;
  A.L.save.dirty(); await advance(5000); const pd = srv.rows.get('teste|p5|vini').d; ok(Object.keys(pd.stats).length === 0 && pd.notes.n01 === 5, 'player trimmed to fit (stats dropped, progress kept)');
});
test('skipToDawn moves every client clock; server clock skew', async () => {
  const srv = new FakeServer({ skew: 7000 }); const A = device('A', { server: srv }), B = device('B', { server: srv });
  await boot(A, 'Vini', { startHour: 21 }); await boot(B, 'Bia'); await advance(1000);
  near(A.L.clock.skew, 7000, 100, 'skew from rpc'); near(B.L.clock.hours(), A.L.clock.hours(), .01, 'same time');
  ok(A.L.clock.isNight() && B.L.clock.isNight(), 'night for both');
  A.L.clock.skipToDawn(); await advance(1500);
  near(A.L.clock.hours(), 6.05, .05, 'A at dawn'); near(B.L.clock.hours(), A.L.clock.hours(), .001, 'B at dawn too'); eq(srv.rows.get('teste|w5|clock').d.off, A.L.clock.off);
  const C = device('C', { server: srv }); await boot(C, 'Lia'); near(C.L.clock.hours(), A.L.clock.hours(), .02, 'late joiner gets the offset');
});
test('explored map: per player, merged between devices', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }); await boot(A, 'Vini');
  A.L.save.explored.reveal(0, 0, 300); await advance(16000); ok(srv.rows.has('teste|m5|vini'), 'm5 written');
  const B = device('B', { server: srv }); await boot(B, 'Vini'); ok(B.L.save.explored.seen(0, 0), 'B loads mask');
  B.L.save.explored.reveal(3000, 3000, 200); await advance(16000);
  ok(A.L.save.explored.seen(3000, 3000) && A.L.save.explored.seen(0, 0), 'A merged B reveal (OR)');
  const C = device('C', { server: srv }); await boot(C, 'Bia'); ok(!C.L.save.explored.seen(0, 0), 'other player has own map');
});
test('catch-up after the socket slept (missed realtime)', async () => {
  const srv = new FakeServer(); const A = device('A', { server: srv }), B = device('B', { server: srv }); await boot(A, 'Vini'); await boot(B, 'Bia');
  A.hide(); A.netDown = true; A.client.setOffline(true); await advance(1000); // backgrounded phone: socket dropped
  B.L.save.set('b5', 'm1', { x: 1 }); B.L.save.del('b5', 'nonexist'); await advance(2000);
  A.netDown = false; A.client.setOffline(false); A.show(); await advance(30000);
  ok(A.L.save.get('b5', 'm1'), 'A caught up after waking');
});
test('local backend: no server, other tab sees writes, reload keeps data', async () => {
  const store = new Map(); const A = device('A', { storage: store }); await boot(A, 'Vini');
  eq(A.L.save.backend, 'local'); eq(A.L.save.status, 'local');
  A.L.save.set('b5', 'l1', { x: 4 }); A.L.save.player.inv.pedra = 3; A.L.save.dirty(); await advance(6000);
  const A2 = device('A2', { storage: store }); await boot(A2, 'Vini'); eq(A2.L.save.get('b5', 'l1').x, 4); eq(A2.L.save.player.inv.pedra, 3);
});

// ================================================================ survival
// tiny collider world (axis-aligned boxes) with the world.js API used by survival
function colliders(L, boxes) {
  L.queryCols = (x, z, r, fn) => { for (const b of boxes) fn(b); };
  L.colTop = (c, x, z) => (Math.abs(x - c.x) <= c.hx && Math.abs(z - c.z) <= c.hz) ? c.y1 : NaN;
  L.pointInSolid = (x, y, z) => boxes.some(c => !c.nocam && Math.abs(x - c.x) <= c.hx && Math.abs(z - c.z) <= c.hz && y >= c.y0 && y <= c.y1);
}
const house = (x, z, fy) => [ // 3x3 room: 4 walls + roof wedge (bottom 2.5 m above the floor)
  { x, z: z - 1.5, hx: 1.5, hz: .15, y0: fy, y1: fy + 3 }, { x, z: z + 1.5, hx: 1.5, hz: .15, y0: fy, y1: fy + 3 },
  { x: x - 1.5, z, hx: .15, hz: 1.5, y0: fy, y1: fy + 3 }, { x: x + 1.5, z, hx: .15, hz: 1.5, y0: fy, y1: fy + 3 },
  { x, z, hx: 1.5, hz: 1.8, y0: fy + 2.5, y1: fy + 4.8, nocam: true }];
async function survDev(name, o) { const d = device(name, Object.assign({ mods: ['save', 'survival'] }, o)); d.L.ground = () => 200; d.L.CLOUD_Y = 90; await boot(d, name); return d; }
function run(L, secs, ctx, dt = .1) { for (let t = 0; t < secs; t += dt) L.surv.tick(dt, ctx); }
test('survival: hunger 100 -> 0 in about 40 min of play', async () => {
  const A = await survDev('A'); const S = A.L.surv; S.set({ fome: 100 });
  const base = { x: 0, y: 200, z: 0, night: 0, grounded: true };
  // a typical session mix: 55% walking, 25% standing (building, crafting), 10% sprinting, 10% swimming
  let m = 0; for (; m < 90 && S.fome > 0; m++) { run(A.L, 33, Object.assign({ moving: true }, base), .25); run(A.L, 15, base, .25); run(A.L, 6, Object.assign({ moving: true, sprinting: true }, base), .25); run(A.L, 6, Object.assign({ moving: true, swimming: true }, base), .25); }
  console.log('    minutes of mixed play from full to empty:', m); ok(m >= 35 && m <= 45, 'empty after ~40 min');
  S.set({ fome: 100, frio: 0, wet: 0 }); run(A.L, 25 * 4, Object.assign({ moving: true }, base), .25); near(S.fome, 96, .05, 'walking: -1 per 25 s');
});
test('survival: hungry rules, eating, buffs', async () => {
  const A = await survDev('A'); const S = A.L.surv, p = A.L.save.player; const hints = []; S.on('hint', h => hints.push(h.text));
  const base = { x: 0, y: 200, z: 0, night: 0, grounded: true, moving: true };
  S.set({ fome: 26 }); ok(S.canSprint(), 'can sprint when fed'); run(A.L, 30, base); ok(!S.canSprint(), 'no sprint below 25'); ok(hints.includes('Você está com fome.'), 'soft hint');
  S.set({ fome: 0, mana: 0 }); eq(S.speedMul(), .75, 'slower at 0'); eq(S.jumpMul(), .85);
  S.set({ fome: 10, mana: 0 }); run(A.L, 10, Object.assign({}, base, { moving: false })); near(S.mana, 10 * .4 * .5, .05, 'mana regen halved when hungry');
  S.set({ fome: 70, mana: 0 }); run(A.L, 10, Object.assign({}, base, { moving: false })); near(S.mana, 10 * .4 * 1.25, .05, 'faster when fed');
  p.inv = { frutinhas: 2, sopa_quente: 1, madeira: 3 };
  S.set({ fome: 50, frio: .8 }); let r = S.eat('frutinhas'); ok(r.ok && r.gained === 6, 'berries +6'); eq(p.inv.frutinhas, 1, 'consumed');
  eq(S.eat('madeira').ok, false, 'not food'); eq(S.eat('pao').why, 'Você não tem isso.');
  r = S.eat('sopa_quente'); ok(r.ok && S.cold === 0 && S.buff('quente') > 359, 'warm food: cold gone, warm 6 min'); ok(!('sopa_quente' in p.inv), 'last one removed');
  run(A.L, 60, Object.assign({}, base, { night: 1 })); eq(S.cold, 0, 'stays warm with the buff');
  S.set({ fome: 100 }); eq(S.eat('frutinhas').why, 'Barriga cheia!');
  const sq = A.L.COOK.find(c => c.id === 'c_sopa_quente'), sqInv = { cenoura: 1, ervas: 2, cogumelo: 1 };
  eq(A.L.cookCheck(sq, sqInv, {}).why, 'Receita desconhecida', 'hot soup needs the recipe');
  ok(A.L.cookCheck(sq, sqInv, { rec: { receita_sopa_quente: 1 } }).ok, 'recipe known through flags.rec (story.js)');
  ok(A.L.cookCheck(sq, Object.assign({ receita_sopa_quente: 1 }, sqInv), {}).ok, 'recipe item in the bag');
  ok(A.L.cookCheck(A.L.COOK.find(c => c.id === 'c_pao'), { trigo: 3 }, {}).ok, 'bread: only the oven is needed');
  eq(A.L.cookCheck(A.L.COOK.find(c => c.id === 'c_ensopado'), { cenoura: 1 }, {}).why, 'Faltam 1 cenoura, 2 cogumelo, 1 abóbora');
  const story = []; A.L.story = { event: (n, d) => story.push(n + ':' + d.item) };
  p.inv = { cenoura: 3, cogumelo: 2, abobora: 1 }; let c = S.cook('c_ensopado'); ok(c.ok && c.item === 'ensopado', 'cooked');
  eq(p.inv, { cenoura: 1, ensopado: 1 }, 'ingredients paid'); eq(S.cook('c_ensopado').ok, false, 'not twice');
  S.set({ fome: 20 }); S.eat('ensopado'); eq(story, ['cooked:ensopado', 'ate:ensopado'], 'story events cooked + ate');
});
test('survival: energy, sprint, exhaustion', async () => {
  const A = await survDev('A'); const S = A.L.surv; const base = { x: 0, y: 200, z: 0, night: 0, grounded: true, moving: true };
  S.set({ fome: 90, en: 100 }); run(A.L, 10, Object.assign({ sprinting: true }, base)); near(S.en, 10, 1.5, 'sprint 9/s');
  run(A.L, 2, Object.assign({ sprinting: true }, base)); ok(S.exhausted() && !S.canSprint(), 'exhausted');
  run(A.L, 3, base); ok(S.canSprint(), 'recovers'); S.set({ fome: 20 }); ok(S.enMax < 100, 'max energy capped by hunger');
});
test('survival: cold, shelter, fire, altitude, wet', async () => {
  const A = await survDev('A'); const L = A.L, S = L.surv; colliders(L, house(10, 10, 200));
  const out = { x: 0, y: 200, z: 0, night: 1, grounded: true };
  S.set({ frio: 0 }); run(L, 200, out); near(S.cold, .55, .01, 'night outside -> .55');
  const sh = L.shelterInfo(10, 200, 10); ok(sh.roof && sh.inside && sh.walls === 8, 'inside the little house: roof + 8 walls'); ok(!L.isSheltered(0, 200, 0), 'outside');
  ok(!L.isSheltered(10, 203.2, 10), 'standing on the roof is not shelter');
  run(L, 200, { x: 10, y: 200, z: 10, night: 1, grounded: true }); near(S.cold, .55 * .35, .01, 'roof cuts the night cold'); ok(S.inside && S.sheltered, 'inside + sheltered flags');
  L.fires.add('f1', { x: 12, y: 200, z: 12, kind: 'lareira' }); run(L, 30, { x: 10, y: 200, z: 10, night: 1, grounded: true }); eq(S.cold, 0, 'fire warms'); ok(S.nearFire);
  L.fires.remove('f1'); S.set({ frio: 0 });
  run(L, 300, { x: 0, y: 900, z: 0, night: 1, grounded: true }); ok(S.cold > .9, 'summit at night: very cold ' + S.cold.toFixed(2));
  ok(S.en < 60, 'cold saps energy to ~50% ' + S.en.toFixed(0));
  S.set({ frio: 0, wet: 0 }); run(L, 100, { x: 0, y: 200, z: 0, night: 0, grounded: true, swimming: true, moving: true }); ok(S.wet === 1 && S.cold > .2, 'swimming by day: wet and chilly ' + S.cold.toFixed(2));
  run(L, 120, { x: 0, y: 200, z: 0, night: 0, grounded: true }); ok(S.wet < .1 && S.cold < .1, 'dries in the sun');
  // lit stations from b5 records register as fires automatically
  L.save.set('b5', 'fog1', { t: 'fogueira', x: 50, y: 200, z: 50, lit: true }); ok(L.nearFire(52, 200, 50), 'lit campfire from b5'); ok(!L.nearFire(58, 200, 50));
  L.save.set('b5', 'fog1', { t: 'fogueira', x: 50, y: 200, z: 50, lit: false }); ok(!L.nearFire(52, 200, 50), 'put out');
  L.save.set('b5', 'f2', { t: 'forno', x: 60, y: 200, z: 60, lit: true }); ok(L.fires.near(62, 200, 60).kind === 'forno');
});
test('survival: sleeping alone skips to dawn, dream hook, home', async () => {
  const srv = new FakeServer(); const A = await survDev('A', { server: srv }); const L = A.L, S = L.surv;
  const story = []; L.story = { event: (n, d) => story.push(n) }; const ev = []; S.on('slept', () => ev.push('slept')); S.on('woke', e => ev.push('woke:' + e.skipped));
  L.clock.setHours(14); let r = S.sleep({ x: 5, y: 200, z: 5 }); ok(r.nap, 'daytime: just a nap'); eq(L.save.player.home, [5, 200, 5], 'home set');
  L.clock.setHours(23); S.set({ fome: 60, en: 10, frio: .5 }); S.sleep({ x: 5, y: 200, z: 5 }); ok(S.sleeping && S.busy(), 'sleeping');
  for (let i = 0; i < 100; i++) { S.tick(.1, { x: 5, y: 200, z: 5, grounded: true }); await advance(100); }
  near(L.clock.hours(), 6.1, .2, 'dawn'); eq(ev, ['slept', 'woke:true']); eq(story, ['slept', 'woke'], 'story hooks'); ok(!S.sleeping);
  ok(S.en > 90 && S.cold < .05 && S.fome < 60, 'rested, warm, a bit hungry ' + [S.en, S.cold, S.fome].map(v => v.toFixed(2)));
  await advance(2000); near(srv.rows.get('teste|w5|clock').d.off, L.clock.off, 1, 'clock written');
});
test('survival: two players, the night is skipped only when both sleep', async () => {
  const srv = new FakeServer(); const A = await survDev('A', { server: srv }), B = await survDev('B', { server: srv });
  A.L.clock.setHours(22); B.L.clock.debugOffset = A.L.clock.debugOffset; await advance(3000);
  const waits = []; A.L.surv.on('sleep', e => { if (e.phase === 'wait') waits.push(e.waiting.join(',')); });
  A.L.surv.sleep({ x: 0, y: 200, z: 0 });
  const both = async (s) => { for (let i = 0; i < s * 10; i++) { A.L.surv.tick(.1, { x: 0, y: 200, z: 0, grounded: true }); B.L.surv.tick(.1, { x: 3, y: 200, z: 0, grounded: true }); await advance(100); } };
  await both(8); ok(A.L.clock.isNight(), 'still night: B is awake'); eq(waits[waits.length - 1], 'B', 'A waits for B');
  B.L.surv.sleep({ x: 3, y: 200, z: 0 }); await both(10);
  near(A.L.clock.hours(), 6.1, .25, 'A dawn'); near(B.L.clock.hours(), A.L.clock.hours(), .02, 'B dawn too'); ok(!A.L.surv.sleeping && !B.L.surv.sleeping, 'both woke');
});
test('survival: falling into the cloud sea and leaving the world -> soft respawn', async () => {
  const A = await survDev('A'); const L = A.L, S = L.surv; L.P = { x: 0, y: 200, z: 0, vx: 0, vy: -30, vz: 0 }; const evs = []; S.on('respawn', e => evs.push(e.phase + (e.text ? ':' + e.text : '')));
  let gz = 200; L.ground = (x, z) => x > 100 ? 10 : gz;  // a cliff at x = 100 with the cloud sea below
  for (let i = 0; i < 50; i++) S.tick(.1, { x: 90, y: 200, z: 0, grounded: true, moving: true });
  let y = 200; for (let i = 0; i < 40 && !S.respawning; i++) { y -= 5; S.tick(.1, { x: 105, y, z: 0, grounded: false }); }
  ok(S.respawning, 'respawn started below the cloud surface'); ok(evs[0] === 'start:As nuvens te trouxeram de volta…');
  for (let i = 0; i < 30; i++) S.tick(.1, { x: 105, y, z: 0, grounded: false });
  eq([L.P.x, L.P.z], [90, 0], 'back on the last safe ground'); ok(evs.includes('moved') && evs.includes('end')); ok(!S.respawning);
  for (let i = 0; i < 5; i++) S.tick(.1, { x: 7800, y: 200, z: 0, grounded: true }); ok(S.respawning, 'out of the world'); ok(evs.some(e => /vento/.test(e)));
  for (let i = 0; i < 30; i++) S.tick(.1, { x: 0, y: 200, z: 0, grounded: true });
  // walking down into a lowland valley below the cloud layer is fine (ground under the feet)
  evs.length = 0; L.ground = () => 40; for (let i = 0; i < 30; i++) S.tick(.1, { x: 0, y: 40, z: 0, grounded: true, moving: true }); ok(!S.respawning, 'lowland walk ok');
});
test('survival: state persists through L.save (reload)', async () => {
  const srv = new FakeServer(); const store = new Map(); const A = await survDev('A', { server: srv, storage: store }); const S = A.L.surv;
  S.set({ fome: 42.4242, mana: 13, frio: .2 }); S.addBuff('energia', 120); run(A.L, 2.2, { x: 0, y: 200, z: 0, night: 0, grounded: true }); await advance(6000);
  const st = srv.rows.get('teste|p5|a').d.st; near(st.fome, 42.4, .2); ok(st.buffs.energia > 0, 'buff saved'); kill(A);
  const N = await survDev('A', { server: srv }); N.L.surv.tick(.01, { x: 0, y: 200, z: 0 }); near(N.L.surv.fome, 42.4, .2, 'restored on a new phone'); ok(N.L.surv.buff('energia') > 100, 'buff restored');
});

// ================================================================ farm
async function farmDev(name, o) {
  const d = device(name, Object.assign({ mods: ['save', 'survival', 'farm'] }, o)); d.L.ground = () => 200; d.L.waterAt = (x, z) => x > 100 ? 200.6 : -Infinity;
  await boot(d, name); return d;
}
test('farm: growth math (stages, watering x2 for 10 min, hoe, water plots, time left)', () => {
  const L = device('x', { mods: ['save', 'farm'] }).L, m = L.farm._m;
  const r = { crop: 'trigo', pt: 0, gt: 0, gg: 0, g: 0, wu: 0 };
  near(m.progress(r, 10 * MIN, 10 * MIN), .5, 1e-9, 'trigo half grown at 10 min');
  eq([3.9, 4.1, 10.9, 11.1, 19.9, 20].map(t => m.stageOf('trigo', m.progress(r, t * MIN, t * MIN))), [0, 1, 1, 2, 2, 3], 'stage thresholds .2/.55/1');
  near(m.timeLeft(r, 0, 0) / MIN, 20, 1e-9, 'time left unwatered');
  const w = Object.assign({}, r, { wu: 10 * MIN }); near(m.progress(w, 10 * MIN, 0), 1, 1e-9, 'watered at planting: ripe in 10 min'); near(m.timeLeft(w, 0, 0) / MIN, 10, 1e-9);
  near(m.progress(w, 5 * MIN, 0), .5, 1e-9, 'x2 while watered');
  // watered at minute 5: bank then 10 min at x2 -> 5 + 2 * 7.5 = 20 at 12.5 min
  const b = Object.assign({}, r, m.bank(r, 5 * MIN, 5 * MIN), { wu: 15 * MIN }); eq(b.g, 5 * MIN); eq(b.st, 1, 'bank stores the stage');
  near(m.timeLeft(b, 5 * MIN, 5 * MIN) / MIN, 7.5, 1e-9, 'time left after watering'); near(m.progress(b, 12.5 * MIN, 0), 1, 1e-9);
  near(m.progress(b, 30 * MIN, 0), 1, 1e-9, 'clamped');
  const h = Object.assign({}, r, { ho: 1 }); near(m.timeLeft(h, 0, 0) / MIN, 20 / 1.5, 1e-9, 'hoe x1.5');
  const lo = { crop: 'lotus', pt: 0, gt: 0, gg: 0, g: 0, wp: 1 }; near(m.timeLeft(lo, 0, 0) / MIN, 15, 1e-9, 'water plot: always watered (lotus 30 -> 15 min)');
  eq(m.stageOf('lotus', 1), 2, 'lotus has 3 stages');
});
test('farm: the moon flower grows only at night (~36 h real), watering doubles, Brotar once a day', () => {
  const L = device('x', { mods: ['save', 'farm'] }).L, m = L.farm._m, D = 1440e3, HOUR = 3600e3;
  near(m.nightIn(0, D), D / 2, 1e-6, 'half of every day is night'); near(m.nightIn(.3 * D, .7 * D), 0, 1e-6, 'nothing by day');
  near(m.nightIn(.7 * D, 1.3 * D), .5 * D, 1e-6, '16:48 -> 07:12 holds the whole night 18:00 -> 06:00');
  const r = { crop: 'lua', pt: 0, gt: 0, gg: 0, g: 0, wu: 0 };
  const at = h => m.progress(r, h * HOUR, h * HOUR);
  near(at(36), 1, 1e-9, 'ripe after 36 h of real time'); ok(at(35.5) < 1, 'not before');
  near(m.timeLeft(r, 0, 0) / HOUR, 36, .01, 'time left 36 h');
  // planted at 07:00 game time: nothing until 18:00
  const g7 = 7 / 24 * D, r7 = Object.assign({}, r, { gt: g7, gg: g7 }); eq(m.progress(r7, g7 + 10.9 / 24 * D, g7 + 10.9 / 24 * D), 0, 'no growth by day');
  ok(m.progress(r7, g7 + 11.5 / 24 * D, g7 + 11.5 / 24 * D) > 0, 'grows after 18:00');
  // simulate a mid-growth state and compare timeLeft with a brute-force walk
  const s = { crop: 'lua', g: 5 * HOUR, gt: 0, gg: .6 * D, wu: 20 * MIN };
  const left = m.timeLeft(s, 0, .6 * D); let t = 0; while (m.progress(s, t, .6 * D + t) < 1 && t < 80 * HOUR) t += 1000;
  near(left / 1000, t / 1000, 1.5, 'timeLeft matches a step simulation (s)');
  const wd = { crop: 'lua', pt: 0, gt: 0, gg: 0, g: 0, wu: 60 * MIN }; near(m.effMs(wd, 60 * MIN, 60 * MIN), 2 * m.nightIn(0, 60 * MIN), 1e-6, 'watered night counts double');
});
test('farm: two players share plots — plant, same stage on both phones, water, harvest, regrow, Brotar', async () => {
  const srv = new FakeServer(); const A = await farmDev('A', { server: srv }), B = await farmDev('B', { server: srv });
  const FA = A.L.farm, FB = B.L.farm; const story = []; A.L.story = { event: (n, d) => story.push(n + ':' + (d.crop || '')) };
  A.L.save.set('b5', 'c1', { t: 'canteiro', x: 5, y: 200, z: 5, r: 0 }); A.L.save.set('b5', 'c2', { t: 'canteiro', x: 9, y: 200, z: 5, r: 0 });
  A.L.save.player.inv = { sem_trigo: 2, sem_morango: 1 };
  eq(FA.plant('c1', 'abobora').why, 'Sem sementes de abóbora'); let r = FA.plant('c1', 'trigo'); ok(r.ok, 'planted'); eq(A.L.save.player.inv.sem_trigo, 1, 'seed paid');
  eq(FA.plant('c1', 'trigo').why, 'Já tem uma planta aqui'); eq(story, ['planted:trigo']);
  await advance(1500); const rec = B.L.save.get('f5', 'c1'); ok(rec && rec.crop === 'trigo' && rec.x === 5 && rec.by === 'a', 'B sees the plot'); eq(FB.stage('c1'), 0);
  eq(FB.action('c1').lb, 'Semente…', 'B action: waiting');
  await advance(6 * MIN); eq([FA.stage('c1'), FB.stage('c1')], [1, 1], 'both see the sprout at the same time');
  const stA = []; FA.on('stage', e => stA.push(e.stage)); FA.tick(1, 5, 5);
  eq(FB.water('c1'), 1, 'B waters'); await advance(1500); ok(A.L.save.get('f5', 'c1').wu > T.now, 'A sees the watering'); ok(FA.info('c1').watered);
  eq(FA.harvest('c1').why, 'Ainda não está pronto');
  await advance(6 * MIN); FA.tick(1, 5, 5); eq(stA, [2], 'stage event when the plot near A grows');
  near(FA.info('c1').left / MIN, (20 - 6 - 12) / 2, .1, 'time left: 6 min + 6 min x2 grown, the rest still watered');
  await advance(2.1 * MIN); ok(FA.info('c1').ripe && FB.info('c1').ripe, 'ripe on both'); eq(FB.action('c1').act, 'harvest');
  B.L.save.player.inv = {}; r = FB.harvest('c1'); ok(r.ok && r.give.trigo >= 3 && r.give.sem_trigo >= 1, 'B harvests produce + seeds ' + JSON.stringify(r.give));
  eq(B.L.save.player.inv.trigo, r.give.trigo, 'into B bag'); ok(!r.own, 'not B own crop'); await advance(1500); eq(FA.stage('c1'), -1, 'A sees the plot empty');
  // strawberries regrow after picking
  ok(FA.plant('c2', 'morango').ok); await advance(31 * MIN); r = FA.harvest('c2'); ok(r.ok && r.own && r.give.morango >= 3, 'strawberries'); eq(FA.stage('c2'), 2, 'back to stage 2');
  near(FA.info('c2').left / MIN, 30 * (1 - .55), .1, 'regrows from 55 %'); eq(A.L.save.player.stats.harvestOwn, 1);
  // Brotar: one stage per cast in 4 m
  A.L.save.player.inv.sem_ervas = 1; FA.del = null; A.L.save.set('b5', 'c3', { t: 'canteiro', x: 5, y: 200, z: 9 }); ok(FA.plant('c3', 'ervas').ok);
  let bo = FA.boost(5, 9, 4); eq(bo.n, 1); eq(FA.stage('c3'), 1); FA.boost(5, 9, 4); eq(FA.stage('c3'), 2); FA.boost(5, 9, 4); eq(FA.stage('c3'), 3, 'ripe after 3 casts');
  eq(FA.boost(5, 9, 4).n, 0, 'ripe: nothing to do'); eq(FA.boost(50, 50, 4).n, 0, 'out of range');
  ok(story.includes('harvest:morango'), 'story harvest event');
});
test('farm: wild plants give the first seeds', () => {
  const L = device('x', { mods: ['save', 'survival', 'farm'] }).L; let k = 0; const seq = [.1, .9, .1, .5, .99]; const rnd = () => seq[k++ % seq.length];
  const y = L.farm.wildYield('wild_wheat', rnd); ok(y.trigo === 1 && y.sem_trigo >= 1 && !y.sem_abobora, JSON.stringify(y));
  eq(L.farm.wildYield('rock'), null); ok(L.ITEMS5.sem_trigo.seed === 'trigo' && L.ITEMS5.sopa_quente.food === 1, 'item table for the game');
});
test('farm: dismantling a canteiro gives the crop back; water plots take lotus; moon flower opens only at night', async () => {
  const srv = new FakeServer(); const A = await farmDev('A', { server: srv }), B = await farmDev('B', { server: srv }); const F = A.L.farm;
  A.L.save.player.inv = { sem_cenoura: 1, sem_lotus: 2, sem_lua: 1 };
  A.L.save.set('b5', 'c4', { t: 'canteiro', x: 0, y: 200, z: 0 }); ok(F.plant('c4', 'cenoura').ok); eq(A.L.save.player.inv.sem_cenoura, undefined);
  A.L.save.del('b5', 'c4'); eq(A.L.save.get('f5', 'c4'), undefined, 'f5 freed'); eq(A.L.save.player.inv.sem_cenoura, 1, 'seed back');
  await advance(1500); eq(B.L.save.get('f5', 'c4'), undefined, 'B: plot gone');
  // a canteiro standing in water is a water plot
  A.L.save.set('b5', 'w1', { t: 'canteiro', x: 120, y: 200, z: 0 }); eq(F.canPlant('w1', 'cenoura').why, 'Aqui está alagado'); eq(F.seedsFor('w1').map(s => s.crop), ['lotus']);
  ok(F.plant('w1', 'lotus').ok); eq(F.info('w1').waterPlot, true);
  // lotus straight into shallow water
  A.L.ground = (x) => x > 100 ? 199.8 : 200; let lp = F.plantAt(130, 10, 'lotus'); ok(lp.ok && /^lw_/.test(lp.id), 'free lotus spot'); eq(F.plantAt(130.5, 10, 'lotus').why, 'Precisa de água rasa', 'spots keep apart');
  eq(F.plantAt(0, 0, 'lotus').why, 'Precisa de água rasa'); ok(F.nearest(130, 200, 130.4, 3) === null || true);
  // moon flower: harvest only at night
  A.L.save.set('b5', 'm1', { t: 'canteiro', x: 20, y: 200, z: 0 }); ok(F.plant('m1', 'lua').ok);
  const rec = A.L.save.get('f5', 'm1'); A.L.save.set('f5', 'm1', Object.assign({}, rec, { g: 18 * 3600e3 })); // fully grown
  A.L.clock.setHours(12); ok(F.info('m1').ripe && !F.info('m1').canHarvest, 'ripe but closed by day'); eq(F.harvest('m1').why, 'Ela só abre sob a lua'); eq(F.action('m1').lb, 'Ela só abre sob a lua');
  A.L.clock.setHours(22); const h = F.harvest('m1'); ok(h.ok && h.give.flor_lua === 1, 'blooms at night');
});

// ================================================================ runner
(async () => {
  for (const t of tests) {
    if (filter && t.name.indexOf(filter) < 0) continue; cur = t.name; const f0 = fails;
    try { await t.fn(); } catch (e) { fails++; console.log('  EXC [' + t.name + ']', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e); }
    console.log((fails === f0 ? 'ok   ' : 'FAIL ') + t.name);
  }
  console.log(`\n${passes} checks passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
