// Node test environment for the SYS modules: fake time + timers shared by several simulated devices (each one a vm
// context with its own window/localStorage/navigator), and an in-memory fake Supabase (table lumiar_mundo with an
// optional newer-wins trigger and collection check, realtime postgres_changes, broadcast channels, rpc, keepalive
// fetch). Dev only (excluded from deploys by .vercelignore).
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- time
const T = { now: Date.UTC(2026, 9, 18, 12, 0, 0), q: [], seq: 0 };
function addTimer(fn, ms, rep) { const id = ++T.seq; T.q.push({ id, due: T.now + Math.max(0, +ms || 0), fn, rep: rep ? Math.max(1, +ms || 1) : 0 }); return id; }
function delTimer(id) { const i = T.q.findIndex(t => t.id === id); if (i >= 0) T.q.splice(i, 1); }
const micro = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
async function advance(ms) {
  const end = T.now + ms;
  for (let guard = 0; guard < 200000; guard++) {
    await micro();
    let nx = null; for (const t of T.q) if (t.due <= end && (!nx || t.due < nx.due || (t.due === nx.due && t.id < nx.id))) nx = t;
    if (!nx) break;
    T.now = Math.max(T.now, nx.due);
    if (nx.rep) nx.due += nx.rep; else delTimer(nx.id);
    try { nx.fn(); } catch (e) { console.log('timer error', e); }
  }
  T.now = end; await micro();
}
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(T.now); } static now() { return T.now; } }

// ---------------------------------------------------------------- fake Supabase server
class FakeServer {
  constructor(o = {}) {
    this.rows = new Map(); this.newerWins = o.newerWins !== false; this.allowed = o.allowed || null; this.maxD = o.maxD || 32000;
    this.latency = o.latency == null ? 30 : o.latency; this.skew = o.skew || 0; this.clients = new Set(); this.log = []; this.hasRpc = o.hasRpc !== false;
  }
  key(r) { return r.w + '|' + r.c + '|' + r.id; }
  rowT(r) { return r && r.d && typeof r.d.ts === 'number' ? r.d.ts : (r && r.at ? Date.parse(r.at) : 0); }
  upsert(rows, who) {
    for (const r of rows) {
      if (this.allowed && !this.allowed.has(r.c)) return { error: { code: '23514', message: 'new row for relation "lumiar_mundo" violates check constraint "lumiar_mundo_c_check"' } };
      if (r.d != null && Buffer.byteLength(JSON.stringify(r.d)) > this.maxD) return { error: { code: '23514', message: 'violates check constraint "lumiar_mundo_d_check"' } };
    }
    const seen = new Set(); for (const r of rows) { const k = this.key(r); if (seen.has(k)) return { error: { code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' } }; seen.add(k); }
    for (const r of rows) {
      const k = this.key(r), old = this.rows.get(k);
      if (old && this.newerWins && this.rowT(r) < this.rowT(old)) { this.log.push({ skip: k }); continue; }
      const row = { w: r.w, c: r.c, id: r.id, d: r.d == null ? null : JSON.parse(JSON.stringify(r.d)), at: r.at || new Date(T.now).toISOString() };
      this.rows.set(k, row); this.log.push({ put: k, who });
      const ev = { schema: 'public', table: 'lumiar_mundo', eventType: old ? 'UPDATE' : 'INSERT', new: JSON.parse(JSON.stringify(row)), old: {}, commit_timestamp: new Date(T.now + this.skew).toISOString() };
      for (const cl of this.clients) cl._pg(ev);
    }
    return { error: null };
  }
  select(f) {
    let out = [...this.rows.values()].filter(r => f.every(fn => fn(r)));
    return out;
  }
  client(dev) { const c = new FakeClient(this, dev); this.clients.add(c); return c; }
}
const NET = { error: { code: '', message: 'TypeError: Failed to fetch' }, data: null };
class FakeClient {
  constructor(srv, dev) { this.srv = srv; this.dev = dev; this.chans = new Set(); this.calls = { select: 0, upsert: 0, rpc: 0 }; }
  get off() { return this.dev.offline || this.dev.netDown; } // netDown: requests fail while navigator.onLine stays true
  later(fn) { return new Promise(res => addTimer(() => res(fn()), this.srv.latency)); }
  from(t) {
    const cl = this, srv = this.srv;
    return {
      select() {
        const f = [], ord = []; let lim = Infinity, from = 0;
        const q = {
          eq(k, v) { f.push(r => r[k] === v); return q; }, in(k, v) { f.push(r => v.includes(r[k])); return q; },
          not(k, op, v) { if (op === 'is' && v === null) f.push(r => r[k] !== null); return q; },
          gt(k, v) { f.push(r => k === 'at' ? Date.parse(r.at) > Date.parse(v) : r[k] > v); return q; },
          order(k, o) { ord.push([k, !o || o.ascending !== false]); return q; }, limit(n) { lim = n; return q; }, range(a, b) { from = a; lim = b - a + 1; return q; },
          then(res, rej) {
            cl.calls.select++;
            return cl.later(() => {
              if (cl.off) return NET;
              let rows = srv.select(f);
              rows.sort((a, b) => { for (const [k, asc] of ord) { const x = a[k], y = b[k]; if (x < y) return asc ? -1 : 1; if (x > y) return asc ? 1 : -1; } return 0; });
              rows = rows.slice(from, from + lim).map(r => JSON.parse(JSON.stringify(r)));
              return { data: rows, error: null };
            }).then(res, rej);
          },
        };
        return q;
      },
      upsert(rows) {
        rows = Array.isArray(rows) ? rows : [rows]; cl.calls.upsert++;
        return { then(res, rej) { return cl.later(() => cl.off ? NET : srv.upsert(rows, cl.dev.name)).then(res, rej); } };
      },
    };
  }
  rpc(name) { this.calls.rpc++; return this.later(() => this.off ? NET : (this.srv.hasRpc && name === 'lumiar_now' ? { data: new Date(T.now + this.srv.skew).toISOString(), error: null } : { data: null, error: { code: 'PGRST202', message: 'function not found' } })); }
  channel(name) {
    const cl = this; const hs = []; let stateCb = null;
    const ch = {
      name, hs,
      on(type, filt, cb) { hs.push({ type, filt, cb }); return ch; },
      subscribe(cb) { stateCb = cb || null; cl.chans.add(ch); addTimer(() => { ch.state = cl.off ? 'CHANNEL_ERROR' : 'SUBSCRIBED'; stateCb && stateCb(ch.state); }, cl.srv.latency); return ch; },
      send(m) { if (cl.off) return Promise.resolve('error'); for (const other of cl.srv.clients) if (other !== cl && !other.off) for (const oc of other.chans) if (oc.name === name) for (const h of oc.hs) if (h.type === 'broadcast' && h.filt.event === m.event) { const p = JSON.parse(JSON.stringify(m.payload)); addTimer(() => h.cb({ payload: p }), cl.srv.latency); } return Promise.resolve('ok'); },
      _state(s) { if (ch.state === s) return; ch.state = s; stateCb && stateCb(s); },
    };
    return ch;
  }
  removeChannel(ch) { this.chans.delete(ch); }
  _pg(ev) {
    if (this.off) return;
    for (const ch of this.chans) for (const h of ch.hs) if (h.type === 'postgres_changes') { const w = /w=eq\.(.*)$/.exec(h.filt.filter || ''); if (w && ev.new.w !== w[1]) continue; const e = JSON.parse(JSON.stringify(ev)); addTimer(() => { if (!this.off) h.cb(e); }, this.srv.latency); }
  }
  setOffline(v) { for (const ch of this.chans) if (ch.hs.some(h => h.type === 'postgres_changes')) ch._state(v ? 'CHANNEL_ERROR' : 'SUBSCRIBED'); }
}

// ---------------------------------------------------------------- devices
function makeStorage(store) {
  store = store || new Map();
  return { _m: store, getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); }, key: i => [...store.keys()][i] || null, get length() { return store.size; }, clear: () => store.clear() };
}
const MODS = { save: 'js/save.js', survival: 'js/survival.js', farm: 'js/farm.js' };
function device(name, o = {}) {
  const dev = { name, offline: !!o.offline, srv: o.server || null };
  const listeners = {}; const docL = {};
  const ctx = {
    console, Math, JSON, Promise, Map, Set, WeakMap, Array, Object, String, Number, Boolean, Error, TypeError, RegExp, Uint8Array, Int16Array, Float32Array, Int32Array, Uint16Array, Symbol, isFinite, isNaN, parseFloat, parseInt, Infinity, NaN, encodeURIComponent, decodeURIComponent,
    Date: FakeDate, setTimeout: (f, ms) => addTimer(() => { if (!dev.dead) f(); }, ms), clearTimeout: id => delTimer(id), setInterval: (f, ms) => addTimer(() => { if (!dev.dead) f(); }, ms, true), clearInterval: id => delTimer(id),
    localStorage: makeStorage(o.storage), navigator: { get onLine() { return !dev.offline; } },
    document: { visibilityState: 'visible', addEventListener(t, f) { (docL[t] || (docL[t] = [])).push(f); } },
    addEventListener(t, f) { (listeners[t] || (listeners[t] = [])).push(f); }, removeEventListener(t, f) { const l = listeners[t]; if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } },
    fetchLog: [],
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.fetch = (url, opt) => { ctx.fetchLog.push({ url, opt }); return new Promise(res => addTimer(() => {
    if (dev.offline || !dev.srv) return res({ ok: false, status: 0 });
    const body = JSON.parse(opt.body); const r = dev.srv.upsert(body, name + '(keepalive)'); res({ ok: !r.error, status: r.error ? 400 : 201 });
  }, 20)); };
  if (dev.srv && o.sb !== false) { ctx.LUMIAR_SB = { url: 'https://fake.supabase.test', key: 'sb_publishable_fake' }; ctx.supabase = { createClient: () => (dev.client = dev.srv.client(dev)) }; }
  vm.createContext(ctx);
  for (const m of o.mods || ['save']) vm.runInContext(fs.readFileSync(path.join(ROOT, MODS[m] || m), 'utf8'), ctx, { filename: MODS[m] || m });
  dev.ctx = ctx; dev.L = ctx.L; dev.storage = ctx.localStorage._m;
  dev.fire = (t, e) => { for (const f of (listeners[t] || []).slice()) f(e || {}); };
  dev.hide = () => { ctx.document.visibilityState = 'hidden'; for (const f of (docL.visibilitychange || [])) f({}); dev.fire('pagehide'); };
  dev.show = () => { ctx.document.visibilityState = 'visible'; for (const f of (docL.visibilitychange || [])) f({}); };
  dev.setOffline = v => { dev.offline = v; if (dev.client) dev.client.setOffline(v); dev.fire(v ? 'offline' : 'online'); };
  return dev;
}
// "kill" a device without any page-hide event (crash / battery): stop its timers by detaching its storage copy
function kill(dev) { dev.dead = true; const s = dev.srv; if (dev.client && s) s.clients.delete(dev.client); }

module.exports = { T, advance, micro, FakeServer, device, kill, makeStorage, FakeDate };
