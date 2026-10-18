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
  const P = (t, o) => Object.assign({ t, inv: {}, notes: {}, sp: [], flags: {}, pos: [0, 0, 0, 0] }, o);
  eq(resolvePlayer(null, null).d, null, 'nothing');
  eq(resolvePlayer(null, P(5, { inv: { a: 1 } })).d.inv, { a: 1 }, 'server only');
  let r = resolvePlayer({ d: P(7, { inv: { b: 2 } }), base: 0, fresh: true }, null); eq(r.d.inv, { b: 2 }); ok(r.write, 'local only -> write');
  r = resolvePlayer({ d: P(9, { inv: { b: 3 } }), base: 5, fresh: false }, P(5, { inv: { b: 1 } })); eq(r.d.inv, { b: 3 }, 'local newer, server unchanged'); ok(r.write);
  r = resolvePlayer({ d: P(5, { inv: { b: 1 } }), base: 5, fresh: false }, P(5, { inv: { b: 1 } })); ok(!r.write, 'same -> no write');
  r = resolvePlayer({ d: P(5, { inv: { b: 1 } }), base: 5, fresh: false }, P(8, { inv: { b: 9 } })); eq(r.d.inv, { b: 9 }, 'only server changed'); ok(!r.write);
  // both changed: newer wins wholesale, progress merged
  r = resolvePlayer({ d: P(12, { inv: { b: 4 }, notes: { n02: 1 }, sp: ['faisca'] }), base: 5, fresh: false }, P(8, { inv: { b: 9 }, notes: { n01: 1 }, sp: ['brotar'] }));
  eq(r.d.inv, { b: 4 }, 'conflict: local newer inv'); eq(r.d.notes, { n01: 1, n02: 1 }, 'conflict: notes union'); eq(r.d.sp.sort(), ['brotar', 'faisca']); ok(r.write && r.d.t > 12);
  // fresh device played offline: existing save wins, its notes merged in
  r = resolvePlayer({ d: P(50, { inv: { berry: 2 }, notes: { n01: 1 } }), base: 0, fresh: true }, P(20, { inv: { madeira: 30 }, notes: { n05: 1 } }));
  eq(r.d.inv, { madeira: 30 }, 'fresh: server inventory wins'); eq(r.d.notes, { n05: 1, n01: 1 }, 'fresh: notes merged'); ok(r.write);
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
  L.save.set('b5', 'b1', { t: 0, x: 1 }); L.save.set('b5', 'b2', { x: 2 }); L.save.set('b5', 'b1', { x: 3 }); L.save.set('k5', 'b2', { items: { pedra: 2 } });
  await advance(300); eq(cl.calls.upsert - u1, 0, 'world: not yet'); await advance(300); eq(cl.calls.upsert - u1, 1, 'world: one batched upsert');
  eq(srv.rows.get('teste|b5|b1').d.x, 3, 'coalesced to last'); ok(srv.rows.get('teste|b5|b1').d.t > 0, 't stamped');
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
  srv.upsert([{ w: 'teste', c: 'b5', id: 'door', d: { o: true, t: 5 }, at: new Date(5).toISOString() }]);
  eq(srv.rows.get('teste|b5|door').d.by, 'B', 'trigger keeps newer');
});
test('offline: writes queue, survive a crash, are delivered on the next start', async () => {
  const srv = new FakeServer(); const store = new Map();
  const A = device('A', { server: srv, storage: store }); await boot(A, 'Vini');
  A.setOffline(true);
  A.L.save.set('b5', 'w1', { t: 'wall', x: 1 }); A.L.save.set('t5', 'pet1', { o: 'vini', sp: 'ovelha' });
  A.L.save.player.inv.madeira = 42; A.L.save.player.sp.push('faisca'); A.L.save.dirty();
  await advance(8000); eq(A.L.save.status, 'offline'); ok(!srv.rows.has('teste|b5|w1'), 'not on server yet');
  await advance(2000); // mirrors written
  kill(A);             // crash: no pagehide, no flush
  const A2 = device('A2', { server: srv, storage: store }); await boot(A2, 'Vini'); await advance(3000);
  ok(srv.rows.has('teste|b5|w1') && srv.rows.has('teste|t5|pet1'), 'queued world writes delivered');
  eq(srv.rows.get('teste|p5|vini').d.inv.madeira, 42, 'offline player progress delivered'); eq(A2.L.save.player.sp, ['faisca']);
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
  const p = A.L.save.player; p.inv = { madeira: 12, sem_trigo: 3 }; p.sp = ['faisca', 'brotar']; p.notes = { n01: 111, n02: 222 }; p.home = [1, 2, 3]; A.L.save.setPos(100, 20, -50, 1.2);
  await advance(6000); kill(A);
  const N = device('newphone', { server: srv }); const p2 = await boot(N, 'vini'); // lower case: same slug
  eq(p2.inv, { madeira: 12, sem_trigo: 3 }); eq(p2.sp, ['faisca', 'brotar']); eq(p2.notes, { n01: 111, n02: 222 }); eq(p2.pos, [100, 20, -50, 1.2]); eq(p2.home, [1, 2, 3]);
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
  for (let i = 0; i < 300; i++) A.L.save.player.th.push('pensamento ' + 'x'.repeat(100) + i);
  A.L.save.dirty(); await advance(5000); ok(srv.rows.get('teste|p5|vini').d.th.length <= 50, 'player trimmed to fit');
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

// ================================================================ runner
(async () => {
  for (const t of tests) {
    if (filter && t.name.indexOf(filter) < 0) continue; cur = t.name; const f0 = fails;
    try { await t.fn(); } catch (e) { fails++; console.log('  EXC [' + t.name + ']', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e); }
    console.log((fails === f0 ? 'ok   ' : 'FAIL ') + t.name);
  }
  console.log(`\n${passes} checks passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
