/* Lumiar v5 persistence (L.save) and shared world clock (L.clock).
   One server table (public.lumiar_mundo: w, c, id, d jsonb, at) holds the whole world; every client keeps a local
   mirror and a persistent write queue in localStorage, so nothing is lost when the phone is offline, the tab is
   closed or the browser data of one device is cleared (progress lives on the server under world + player name).
   Backends, picked at init: Supabase (Vercel build: window.LUMIAR_SB + window.supabase), the artifact runtime
   (window.claude.use('db' | 'room')), or this device only (localStorage, other tabs see changes).
   Rules: optimistic local apply, writes coalesced per (c,id) and debounced, newer-wins by the record time `t`
   (ms, server-corrected) so an older snapshot never overwrites a newer row, monotonic merge of progress fields when
   the same player played on two devices, flush on page hide with fetch keepalive, retry with backoff when offline.
   Server side: tools/sql/v5.sql (collections list, 32 KB rows, newer-wins trigger, lumiar_now()). */
'use strict';
(function (L) {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const LS = (() => { try { return G.localStorage || null; } catch (e) { return null; } })();
  const lsGet = (k, d) => { try { const v = LS && LS.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { if (LS) LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const lsDel = k => { try { if (LS) LS.removeItem(k); } catch (e) { } };
  const rid = n => { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); };
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const warn = (...a) => { try { console.warn('[save]', ...a); } catch (e) { } };

  // ================================================================ constants
  const TABLE = 'lumiar_mundo';
  const COLS = ['p5', 'm5', 'b5', 'h5', 't5', 'f5', 'k5', 'w5', 'd5'];
  const WORLD_COLS = ['b5', 'h5', 't5', 'f5', 'k5', 'w5', 'd5'];
  const COLSET = new Set(COLS);
  const EVENTS = new Set(['status', 'player', 'ready', 'dup', 'clock', 'peers', 'explored']);
  // progress fields that only ever grow: merged (union / max / or) when two devices of the same player diverged
  const MONO = ['sp', 'notes', 'dreams', 'th', 'tasks', 'flags', 'stats', 'tools'];
  const CFG = {
    debounce: { p5: 4000, m5: 15000, _: 400 },  // ms from the first change to the write (max-wait, coalesced)
    window: { h5: 3 * 3600e3 },                 // only load rows newer than this (harvest records expire)
    maxRow: 30000,                              // bytes of JSON per row (server check is 32000 after v5.sql)
    page: 1000, loadTimeout: 8000, batch: 200,
    mirrorEvery: 5000, playerMirrorEvery: 1500,
  };

  // ================================================================ small pure helpers (also used by tests)
  function slug(name) {
    let s = String(name || '').normalize ? String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '') : String(name || '');
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
    return s || 'jogador';
  }
  function worldCode(w) { return (String(w || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 24)) || 'nosso-mundo'; }
  function bytes(o) {
    const s = typeof o === 'string' ? o : JSON.stringify(o); if (s == null) return 0;
    let n = s.length; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c > 0x7f) n += c > 0x7ff ? 2 : 1; } return n;
  }
  function rowTime(r) { // ms: the record's own t, else the row's at
    if (!r) return 0; const d = r.d; if (d && typeof d.t === 'number') return d.t;
    const a = r.at ? Date.parse(r.at) : NaN; return a === a ? a : 0;
  }
  function sameJSON(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); }

  // deep monotonic merge: numbers -> max, booleans -> or, arrays -> union (a's order first), objects -> per key;
  // strings and mixed types -> `pref` side (the newer record)
  function mergeMono(a, b, prefB) {
    if (a === undefined || a === null) return clone(b);
    if (b === undefined || b === null) return clone(a);
    if (Array.isArray(a) && Array.isArray(b)) {
      const out = a.map(clone), seen = new Set(a.map(x => JSON.stringify(x)));
      for (const x of b) { const k = JSON.stringify(x); if (!seen.has(k)) { seen.add(k); out.push(clone(x)); } }
      return out;
    }
    const ta = typeof a, tb = typeof b;
    if (ta === 'number' && tb === 'number') return Math.max(a, b);
    if (ta === 'boolean' && tb === 'boolean') return a || b;
    if (ta === 'object' && tb === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out = {}; for (const k in a) out[k] = k in b ? mergeMono(a[k], b[k], prefB) : clone(a[k]);
      for (const k in b) if (!(k in a)) out[k] = clone(b[k]); return out;
    }
    if (ta === 'number' && tb === 'boolean') return a || b; if (ta === 'boolean' && tb === 'number') return a || b;
    return clone(prefB ? b : a);
  }
  // merge two versions of the same player: the newer one (by t) wins for everything except MONO fields, which are
  // merged so story progress / spells / notes / tools reached on either device are never lost.
  function mergePlayer(a, b) {
    const newer = (b.t || 0) >= (a.t || 0) ? b : a, older = newer === a ? b : a;
    const out = clone(newer);
    for (const k of MONO) if (k in a || k in b) out[k] = mergeMono(older[k], newer[k], true);
    out.t = Math.max(a.t || 0, b.t || 0);
    return out;
  }
  // decide the player record at load: `loc` = {d, base, fresh} from this device's mirror, `srv` = server record or null.
  // base = the server t this local copy was derived from; fresh = created here from defaults, never seen the server.
  // returns {d, write} (write = the result must be sent to the server)
  function resolvePlayer(loc, srv) {
    const ld = loc && loc.d, lt = ld ? (ld.t || 0) : 0, base = loc ? (loc.base || 0) : 0, st = srv ? (srv.t || 0) : 0;
    if (!ld && !srv) return { d: null, write: false, how: 'none' };
    if (!ld) return { d: clone(srv), write: false, how: 'server' };
    if (!srv) return { d: clone(ld), write: lt > 0, how: 'local' };
    if (st <= base) return { d: clone(ld), write: lt > st, how: lt > st ? 'local-newer' : 'same' };
    // the server changed since this device last synced
    if (loc.fresh) { // a brand-new device that played offline: the existing save wins, progress is merged in
      const d = clone(srv); for (const k of MONO) if (k in ld || k in srv) d[k] = mergeMono(srv[k], ld[k], false);
      const changed = !sameJSON(d, srv); if (changed) d.t = st + 1; return { d, write: changed, how: 'fresh-merge' };
    }
    if (lt <= base) return { d: clone(srv), write: false, how: 'server-newer' };
    const d = mergePlayer(ld, srv); const write = !sameJSON(d, srv); if (write) d.t = Math.max(d.t, st) + 1;
    return { d, write, how: 'conflict-merge' };
  }

  // portable base64 (no btoa/Buffer differences between browsers and Node)
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64I = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();
  function b64enc(u8) {
    const parts = []; let s = '';
    for (let i = 0; i < u8.length; i += 3) {
      const a = u8[i], b = i + 1 < u8.length ? u8[i + 1] : 0, c = i + 2 < u8.length ? u8[i + 2] : 0, n = (a << 16) | (b << 8) | c;
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
      if (s.length > 4096) { parts.push(s); s = ''; }
    }
    parts.push(s); return parts.join('');
  }
  function b64dec(s) {
    s = String(s || '').replace(/[^A-Za-z0-9+/]/g, ''); const n = Math.floor(s.length * 3 / 4), out = new Uint8Array(n); let o = 0;
    for (let i = 0; i < s.length; i += 4) {
      const a = B64I[s.charCodeAt(i)], b = B64I[s.charCodeAt(i + 1)], c = i + 2 < s.length ? B64I[s.charCodeAt(i + 2)] : 0, d = i + 3 < s.length ? B64I[s.charCodeAt(i + 3)] : 0;
      const v = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
      if (o < n) out[o++] = (v >> 16) & 255; if (o < n && i + 2 < s.length) out[o++] = (v >> 8) & 255; if (o < n && i + 3 < s.length) out[o++] = v & 255;
    }
    return out.subarray(0, o);
  }
  // bit mask (one byte 0/1 per cell) -> alternating run lengths as LEB128 varints (first run counts zeros) -> base64
  function rleEncode(mask) {
    const out = []; const pushV = v => { while (v > 127) { out.push((v & 127) | 128); v = Math.floor(v / 128); } out.push(v); };
    let cur = 0, run = 0;
    for (let i = 0; i < mask.length; i++) { const b = mask[i] ? 1 : 0; if (b === cur) run++; else { pushV(run); cur = b; run = 1; } }
    pushV(run); return b64enc(Uint8Array.from(out));
  }
  function rleDecode(str, n) {
    const by = b64dec(str), m = new Uint8Array(n); let i = 0, p = 0, v = 0;
    while (p < by.length && i < n) {
      let run = 0, mul = 1, b; do { b = by[p++]; run += (b & 127) * mul; mul *= 128; } while ((b & 128) && p < by.length);
      if (v) m.fill(1, i, Math.min(n, i + run)); i += run; v ^= 1;
    }
    return m;
  }
  // resample a square mask res->res2 (OR when shrinking, nearest when growing)
  function resample(m, res, res2) {
    if (res === res2) return m; const o = new Uint8Array(res2 * res2);
    if (res2 < res) { const k = res / res2; for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) if (m[j * res + i]) o[Math.floor(j / k) * res2 + Math.floor(i / k)] = 1; }
    else { const k = res2 / res; for (let j = 0; j < res2; j++) for (let i = 0; i < res2; i++) o[j * res2 + i] = m[Math.floor(j / k) * res + Math.floor(i / k)]; }
    return o;
  }

  // ================================================================ shared world clock
  const DAY_LEN = 1440; // seconds of real time per in-game day
  const DAY_MS = DAY_LEN * 1000;
  const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const clock = {
    DAY_LEN,
    skew: 0,        // server time - device time (ms), estimated from the server
    off: 0,         // world offset (ms) added to game time; skipToDawn moves it (w5/clock) for everyone
    debugOffset: 0, // tests: pretend this many ms have passed (moves real and game time)
    now() { return Date.now() + this.skew + this.debugOffset; },
    gameMs() { return this.now() + this.off; },
    dayPhase(ms) { const d = (ms == null ? this.gameMs() : ms) / DAY_MS; return d - Math.floor(d); }, // 0 = 00:00, .25 = 06:00, .75 = 18:00
    day(ms) { return Math.floor((ms == null ? this.gameMs() : ms) / DAY_MS); },
    hours(ms) { return this.dayPhase(ms) * 24; },
    clockText(ms) { const h = this.hours(ms), hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10; return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); },
    isNight(ms) { const h = this.hours(ms); return h >= 18 || h < 6; },
    sunElev(ms) { return Math.sin((this.dayPhase(ms) - .25) * Math.PI * 2); },
    // 0 by day .. 1 at night, smooth through dusk/dawn (same weights as the sky uses)
    nightness(ms) { const sh = this.sunElev(ms); const wd = sst(-.05, .35, sh), wn = sst(.05, -.25, sh), wk = Math.max(0, 1 - wd - wn); return wn / (wd + wn + wk); },
    moonPhase(ms) { const d = (ms == null ? this.gameMs() : ms) / DAY_MS / 8; return d - Math.floor(d); }, // 0 new, .5 full
    moonIndex(ms) { return Math.floor(this.moonPhase(ms) * 8 + .5) % 8; },
    // sun/moon directions and day/dusk/night weights for the sky (sunrise 06:00 in the east +X, noon high)
    sky(ms, out) {
      out = out || {}; const a = (this.dayPhase(ms) - .25) * Math.PI * 2, sh = Math.sin(a);
      const sx = Math.cos(a), sy = sh, sz = .35, l = Math.hypot(sx, sy, sz); out.sunDir = [sx / l, sy / l, sz / l];
      const mp = this.moonPhase(ms) * Math.PI * 2, ma = a + Math.PI + mp * .08; const mx = Math.cos(ma), my = Math.sin(ma), ml = Math.hypot(mx, my, .3); out.moonDir = [mx / ml, my / ml, -.3 / ml];
      const wd = sst(-.05, .35, sh), wn = sst(.05, -.25, sh), wk = Math.max(0, 1 - wd - wn), tot = wd + wn + wk;
      out.dayW = wd / tot; out.nightW = wn / tot; out.duskW = wk / tot; out.hours = this.hours(ms); out.moon = this.moonPhase(ms); return out;
    },
    // in-game ms of the next `hour` o'clock (today if still ahead)
    nextGameAt(hour, ms) { const g = ms == null ? this.gameMs() : ms; const d0 = Math.floor(g / DAY_MS) * DAY_MS; let t = d0 + hour / 24 * DAY_MS; if (t <= g) t += DAY_MS; return t; },
    // jump the shared clock forward to dawn (06:00); everyone's clock follows through w5/clock. Only from the evening
    // or the night (12:00 .. 06:00) unless force. Returns the ms skipped (0 = nothing done).
    skipToDawn(opt) {
      opt = opt || {}; const h = this.hours();
      if (!opt.force && h >= 6 && h < 12) return 0;
      const g = this.gameMs(), add = Math.round(this.nextGameAt(6, g) - g + (opt.extra == null ? 1500 : opt.extra)); // land just after 06:00
      if (add <= 0) return 0;
      this.setOffset(this.off + add, true); return add;
    },
    setOffset(off, write) {
      off = Math.round(off); const d = off - this.off; this.off = off;
      if (write && L.save && L.save.ready) L.save.set('w5', 'clock', { off, by: L.save.key || '' });
      if (d) emit('clock', { off, delta: d });
    },
    // tests / dev: make hours() read h locally (does not touch the shared offset)
    setHours(h) { const g = this.gameMs(); const target = Math.floor(g / DAY_MS) * DAY_MS + h / 24 * DAY_MS; this.debugOffset += target - g; },
  };
  L.clock = clock;
  L.DAY_LEN = DAY_LEN;

  // ================================================================ events
  const H = {};
  function on(name, fn) { if (!COLSET.has(name) && !EVENTS.has(name)) warn('on: unknown name', name); (H[name] || (H[name] = [])).push(fn); return () => { const l = H[name]; const i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); }; }
  function emit(name, ...a) { const l = H[name]; if (!l) return; for (const fn of l.slice()) { try { fn(...a); } catch (e) { warn('handler', name, e); } } }

  // ================================================================ state
  const S = {
    world: null, key: null, name: null, dev: null, backend: null, B: null,
    status: 'local', ready: false, loaded: false, lastOk: 0, refused: '',
    data: {}, tomb: new Map(), player: null, pbase: 0, pfresh: true, playerDirty: false, mirrorDirty: new Set(),
  };
  COLS.forEach(c => { S.data[c] = new Map(); });
  const PFX = () => 'lumiar5:' + S.world + ':';
  const pend = new Map();            // 'c|id' -> {c, id, d, t, chk, bad}
  const pk = (c, id) => c + '|' + id;
  let flushTimer = null, flushDue = Infinity, flushing = null, retryTimer = null, backoff = 0, refusedUntil = 0;
  let mirrorTimer = null, pmirrorTimer = null, queueTimer = null;

  function newPlayer(name, look, defaults) {
    const p = {
      v: 5, name, look: look || {}, inv: {}, tools: {}, sp: [], notes: {}, dreams: [], th: [], tasks: {}, flags: {},
      st: { fome: 80, en: 100, mana: 100, frio: 0, wet: 0, buffs: {} }, pos: null, home: null, stats: {}, set: {}, t: 0, dev: S.dev,
    };
    if (defaults) for (const k in defaults) p[k] = clone(defaults[k]);
    return p;
  }
  function fixPlayer(p) { // tolerate partial / older records
    const d = newPlayer(p.name || S.name);
    for (const k in d) if (p[k] === undefined) p[k] = d[k];
    if (!p.st || typeof p.st !== 'object') p.st = d.st; for (const k in d.st) if (p.st[k] === undefined) p.st[k] = d.st[k];
    return p;
  }

  // ================================================================ status
  function setStatus(s, why) {
    const prev = S.status; S.status = s; if (why !== undefined) S.refused = why || '';
    const info = statusInfo(); if (prev !== s || info.saving !== lastSavingFlag) { lastSavingFlag = info.saving; emit('status', info); }
  }
  let lastSavingFlag = false;
  function statusInfo() { return { status: S.status, saving: pend.size > 0 || !!flushing || S.playerDirty, pending: pend.size, lastOk: S.lastOk, backend: S.backend }; }
  function bumpSaving() { const s = pend.size > 0 || !!flushing || S.playerDirty; if (s !== lastSavingFlag) { lastSavingFlag = s; emit('status', statusInfo()); } }

  // ================================================================ local apply
  function getRec(c, id) { return S.data[c].get(id); }
  function curT(c, id) { const r = S.data[c].get(id); return r ? (r.t || 0) : (S.tomb.get(pk(c, id)) || 0); }
  function applyLocal(c, id, d, origin) { // returns true when something changed
    const m = S.data[c], old = m.get(id);
    if (d == null) { if (!old) return false; m.delete(id); } else m.set(id, d);
    if (d == null) S.tomb.set(pk(c, id), Math.max(S.tomb.get(pk(c, id)) || 0, (old && old.t) || 0)); else S.tomb.delete(pk(c, id));
    if (!(S.backend === 'local' && origin === 'remote')) { S.mirrorDirty.add(c); scheduleMirror(); } // local mode: the mirror is the store
    if (S.ready) emit(c, id, d, old, origin);
    return true;
  }
  // a row coming from the server (load, realtime, catch-up, check): newer-wins
  function incoming(c, id, d, t, origin) {
    if (!COLSET.has(c)) return false;
    if (c === 'm5') { if (id === S.key && d) mergeExplored(d); return false; }
    if (c === 'p5' && id === S.key) return ownPlayerRemote(d, t);
    const p = pend.get(pk(c, id)); if (p && p.t >= t) return false;        // our pending write is newer
    const ct = curT(c, id);
    if (t < ct) return false;
    if (d == null) { if (t === ct && !S.data[c].has(id)) return false; S.tomb.set(pk(c, id), t); return applyLocal(c, id, null, origin); }
    if (t === ct && sameJSON(S.data[c].get(id), d)) return false;
    return applyLocal(c, id, d, origin);
  }

  // ================================================================ public write API
  function set(c, id, d) {
    if (!COLSET.has(c)) throw new Error('save.set: unknown collection ' + c);
    if (c === 'p5' && id === S.key) { Object.assign(S.player, d); dirty(); return S.player; }
    id = String(id); const now = clock.now();
    const prevT = curT(c, id), t = Math.max(now, prevT + 1);
    const rec = d == null ? null : Object.assign({}, d, { t });
    if (rec && bytes(rec) > CFG.maxRow) { warn('row too big, not saved', c, id, bytes(rec)); emit('status', Object.assign(statusInfo(), { tooBig: c + '/' + id })); return null; }
    applyLocal(c, id, rec, 'local');
    if (rec == null) S.tomb.set(pk(c, id), t);
    queue(c, id, rec, t);
    return rec;
  }
  function del(c, id) { return set(c, id, null); }
  function queue(c, id, d, t) {
    pend.set(pk(c, id), { c, id: String(id), d, t, chk: false, bad: 0 });
    persistQueueSoon(); schedule(c); bumpSaving();
  }
  function dirty() {
    if (!S.player) return; const now = clock.now();
    S.player.t = Math.max(now, (S.player.t || 0) + 1); S.player.dev = S.dev;
    if (!S.playerDirty) { S.playerDirty = true; bumpSaving(); }
    schedule('p5'); mirrorPlayerSoon();
  }
  function schedule(c) {
    if (!S.world) return;
    const ms = CFG.debounce[c] != null ? CFG.debounce[c] : CFG.debounce._; const due = Date.now() + ms;
    if (flushTimer && flushDue <= due) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushDue = due; flushTimer = setTimeout(() => { flushTimer = null; flushDue = Infinity; flush(); }, ms);
  }

  // ================================================================ mirror + persistent queue (localStorage)
  function persistQueue() {
    if (!S.world) return; clearTimeout(queueTimer); queueTimer = null;
    const items = []; for (const it of pend.values()) if (it.c !== 'p5' && it.c !== 'm5') items.push({ c: it.c, id: it.id, d: it.d, t: it.t });
    if (items.length) lsSet(PFX() + 'q', items); else lsDel(PFX() + 'q');
  }
  function persistQueueSoon() { if (!queueTimer) queueTimer = setTimeout(persistQueue, 300); }
  function mirrorPlayer() {
    clearTimeout(pmirrorTimer); pmirrorTimer = null; if (!S.player || !S.world) return;
    lsSet(PFX() + 'p:' + S.key, { d: S.player, base: S.pbase, fresh: S.pfresh });
  }
  function mirrorPlayerSoon() { if (!pmirrorTimer) pmirrorTimer = setTimeout(mirrorPlayer, CFG.playerMirrorEvery); }
  function writeMirror() {
    clearTimeout(mirrorTimer); mirrorTimer = null; if (!S.world) return;
    for (const c of S.mirrorDirty) {
      if (c === 'm5') continue; const o = {};
      for (const [id, d] of S.data[c]) if (d) o[id] = d;
      if (!lsSet(PFX() + 'c:' + c, o)) warn('mirror full for', c);
    }
    S.mirrorDirty.clear();
  }
  function scheduleMirror() {
    if (!S.world || !S.ready) return;
    if (S.backend === 'local') { writeMirror(); return; }     // the mirror is the store
    if (!mirrorTimer) mirrorTimer = setTimeout(writeMirror, CFG.mirrorEvery);
  }
  function readMirror() {
    for (const c of COLS) {
      if (c === 'm5') continue; const o = lsGet(PFX() + 'c:' + c, null); if (!o) continue;
      for (const id in o) if (o[id] && !(c === 'p5' && id === S.key)) S.data[c].set(id, o[id]);
    }
  }

  // ================================================================ flush
  function materialize() {
    if (S.player && S.playerDirty) {
      S.playerDirty = false; const d = clone(S.player);
      let b = bytes(d);
      if (b > CFG.maxRow) { // keep the essentials: trim the fields that grow without bound
        for (const k of ['stats', 'th']) { if (b <= CFG.maxRow) break; if (Array.isArray(d[k])) d[k] = d[k].slice(-50); else if (k === 'stats') d[k] = {}; b = bytes(d); }
        if (b > CFG.maxRow) warn('player record is', b, 'bytes');
      }
      pend.set(pk('p5', S.key), { c: 'p5', id: S.key, d, t: d.t, chk: false, bad: 0, own: true });
      mirrorPlayer();
    }
    if (EX.dirty && S.world) {
      EX.dirty = false; const d = exploredEncode(); d.t = clock.now();
      pend.set(pk('m5', S.key), { c: 'm5', id: S.key, d, t: d.t, chk: false, bad: 0, own: true });
      lsSet(PFX() + 'x:' + S.key, d);
    }
  }
  function flush(opt) {
    if (!S.world) return Promise.resolve(true);
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; flushDue = Infinity; }
    if (flushing) return flushing.then(() => (pend.size || S.playerDirty || EX.dirty) && !retryTimer ? flush(opt) : !pend.size);
    flushing = doFlush(opt).catch(e => { warn('flush', e); return false; }).then(r => { flushing = null; bumpSaving(); if ((pend.size || S.playerDirty) && !retryTimer && S.status === 'online') schedule('_'); return r; });
    bumpSaving();
    return flushing;
  }
  async function doFlush() {
    materialize();
    if (!pend.size) return true;
    if (!S.B) return false;
    if (Date.now() < refusedUntil) return false;
    if (S.B.offline && S.B.offline()) { setStatus('offline'); scheduleRetry(); markChk(); return false; }
    // until this session has compared with the server, my own records (player, map) stay here: a fresh offline start
    // must never overwrite the saved progress; they are resolved (merged) when the server load arrives
    const items = [...pend.values()].filter(i => S.loaded || !i.own).sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0)).slice(0, CFG.batch);
    if (!items.length) return false;
    try {
      const chk = items.filter(i => i.chk);
      if (chk.length && S.B.fetchIds) await checkServer(chk);
      const send = items.filter(i => pend.get(pk(i.c, i.id)) === i);
      if (send.length) await S.B.put(send);
      for (const it of send) {
        if (pend.get(pk(it.c, it.id)) === it) pend.delete(pk(it.c, it.id));
        if (it.c === 'p5' && it.id === S.key) { S.pbase = Math.max(S.pbase, it.t); S.pfresh = false; mirrorPlayer(); }
        if (S.B.sent) S.B.sent(it);
      }
      backoff = 0; clearTimeout(retryTimer); retryTimer = null; S.lastOk = Date.now();
      setStatus(S.backend === 'local' ? 'local' : 'online', '');
      persistQueue();
      if (pend.size) schedule('_');
      return true;
    } catch (e) {
      persistQueue();
      if (isNetErr(e)) { setStatus('offline'); markChk(); scheduleRetry(); return false; }
      await refused(items, e); return false;
    }
  }
  function markChk() { for (const it of pend.values()) if (!it.own) it.chk = true; }
  function isNetErr(e) {
    if (!e) return true; const code = String(e.code || ''), msg = String(e.message || e);
    if (/^[0-9A-Z]{5}$/.test(code) && !/^08/.test(code)) return false;     // SQLSTATE (not connection class 08)
    if (/^PGRST/.test(code)) return false;
    if (['invalid_argument', 'quota_exceeded', 'revoked', 'capability_disabled', 'capability_removed'].includes(code)) return false;
    return true; // fetch failures, timeouts, 5xx from the gateway, 'unavailable': transient, retry later
  }
  // the server refused a batch: find the rows it refuses one by one, keep everything else flowing
  async function refused(items, e) {
    const code = String(e.code || ''), msg = String(e.message || '');
    const collectionNotAllowed = /c_check|lumiar_mundo_c/i.test(msg) || code === '42501' || code === 'revoked' || code === 'capability_disabled';
    if (collectionNotAllowed) {
      warn('server refuses v5 writes (apply tools/sql/v5.sql?)', code, msg);
      refusedUntil = Date.now() + 5 * 60e3; setStatus(S.backend === 'local' ? 'local' : 'refused', msg); scheduleRetry(5 * 60e3); return;
    }
    if (items.length > 1) {
      for (const it of items) {
        if (pend.get(pk(it.c, it.id)) !== it) continue;
        try { await S.B.put([it]); pend.delete(pk(it.c, it.id)); if (S.B.sent) S.B.sent(it); }
        catch (e2) { if (isNetErr(e2)) { setStatus('offline'); markChk(); scheduleRetry(); persistQueue(); return; } badRow(it, e2); }
      }
      persistQueue(); return;
    }
    badRow(items[0], e); persistQueue();
  }
  function badRow(it, e) {
    it.bad = (it.bad || 0) + 1; warn('row refused', it.c, it.id, e && (e.code || ''), e && e.message);
    if (it.bad >= 3 && pend.get(pk(it.c, it.id)) === it) { // park it (never silently thrown away)
      const dead = lsGet(PFX() + 'dead', []); dead.push({ c: it.c, id: it.id, d: it.d, t: it.t, e: String(e && (e.message || e)).slice(0, 200) }); lsSet(PFX() + 'dead', dead.slice(-50));
      pend.delete(pk(it.c, it.id));
    } else scheduleRetry(15000);
  }
  function scheduleRetry(ms) {
    if (retryTimer) return;
    const d = ms || Math.min(60000, 2000 * Math.pow(2, backoff++)) * (.8 + Math.random() * .4);
    retryTimer = setTimeout(() => { retryTimer = null; flush(); }, d);
  }
  function retryNow() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } refusedUntil = 0; backoff = 0; return flush(); }
  // items written while offline / restored from a previous session: never let them overwrite newer server rows
  async function checkServer(items) {
    const by = {}; for (const it of items) (by[it.c] || (by[it.c] = [])).push(it);
    for (const c in by) {
      const ids = by[c].map(i => i.id); const rows = await S.B.fetchIds(c, ids); const got = new Map(rows.map(r => [r.id, r]));
      for (const it of by[c]) {
        it.chk = false; const r = got.get(it.id); if (!r) continue; const st = rowTime(r);
        if (st > it.t && pend.get(pk(c, it.id)) === it) { pend.delete(pk(c, it.id)); incoming(c, it.id, r.d, st, 'remote'); }
      }
    }
  }

  // ================================================================ own player record from another device
  function ownPlayerRemote(d, t) {
    if (!d || !S.player) return false;
    if (d.dev === S.dev && (d.t || 0) <= (S.player.t || 0)) { S.pbase = Math.max(S.pbase, d.t || 0); return false; } // echo
    if ((d.t || 0) <= (S.player.t || 0) && (d.t || 0) <= S.pbase) return false;
    const before = JSON.stringify(S.player);
    let res;
    if ((d.t || 0) > (S.player.t || 0)) res = mergePlayer(S.player, d); else res = mergePlayer(d, S.player);
    if (activeRecently() && S.player.pos) res.pos = S.player.pos; // two devices at once: keep this device's position
    S.pbase = Math.max(S.pbase, d.t || 0);
    replacePlayer(res);
    if (JSON.stringify(S.player) === before) return false;
    if (!sameJSON(res, d)) dirty(); // we hold progress the other device does not have yet
    emit('player', S.player, 'remote'); return true;
  }
  let lastActive = 0; const activeRecently = () => Date.now() - lastActive < 60000;
  function replacePlayer(d) { const p = S.player; for (const k of Object.keys(p)) if (!(k in d)) delete p[k]; Object.assign(p, d); fixPlayer(p); }

  // ================================================================ explored map (m5, per player)
  const EX = { res: 512, mask: new Uint8Array(512 * 512), ver: 0, dirty: false, n: 0 };
  const WSZ = () => (L.WS || 8000);
  function exploredEncode() {
    let res = EX.res, m = EX.mask, rle = rleEncode(m);
    while (rle.length > CFG.maxRow - 200 && res > 64) { const r2 = res >> 1; m = resample(m, res, r2); res = r2; rle = rleEncode(m); }
    return { res, rle, n: EX.n };
  }
  function exploredLoad(d) { // replaces
    EX.mask = new Uint8Array(EX.res * EX.res); EX.n = 0; if (d && d.rle) mergeExplored(d, true);
  }
  function mergeExplored(d, quiet) {
    if (!d || !d.rle || !d.res) return; let m;
    try { m = resample(rleDecode(d.rle, d.res * d.res), d.res, EX.res); } catch (e) { warn('bad m5', e); return; }
    let ch = 0; const M = EX.mask; for (let i = 0; i < M.length; i++) if (m[i] && !M[i]) { M[i] = 1; ch++; }
    if (ch) { EX.n += ch; EX.ver++; if (!quiet) emit('explored', EX); }
  }
  const explored = {
    get res() { return EX.res; }, get mask() { return EX.mask; }, get ver() { return EX.ver; }, get count() { return EX.n; },
    get cell() { return 2 * WSZ() / EX.res; },
    // mark everything within r metres of (x,z) as seen; returns true when new cells were revealed
    reveal(x, z, r) {
      const ws = WSZ(), cs = 2 * ws / EX.res, res = EX.res; let ch = 0;
      const i0 = Math.max(0, Math.floor((x - r + ws) / cs)), i1 = Math.min(res - 1, Math.floor((x + r + ws) / cs));
      const j0 = Math.max(0, Math.floor((z - r + ws) / cs)), j1 = Math.min(res - 1, Math.floor((z + r + ws) / cs));
      const r2 = (r + cs * .5) * (r + cs * .5);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = -ws + (i + .5) * cs, cz = -ws + (j + .5) * cs; if ((cx - x) * (cx - x) + (cz - z) * (cz - z) > r2) continue;
        const k = j * res + i; if (!EX.mask[k]) { EX.mask[k] = 1; ch++; }
      }
      if (ch) { EX.n += ch; EX.ver++; if (!EX.dirty) { EX.dirty = true; schedule('m5'); } emit('explored', EX); }
      return ch > 0;
    },
    // 0..1, bilinear over cell centres (soft edges for the map)
    at(x, z) {
      const ws = WSZ(), res = EX.res, u = (x + ws) / (2 * ws) * res - .5, v = (z + ws) / (2 * ws) * res - .5;
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, M = EX.mask;
      const g = (a, b) => (a < 0 || b < 0 || a >= res || b >= res) ? 0 : M[b * res + a];
      return (g(i, j) * (1 - fu) + g(i + 1, j) * fu) * (1 - fv) + (g(i, j + 1) * (1 - fu) + g(i + 1, j + 1) * fu) * fv;
    },
    seen(x, z) { const ws = WSZ(), res = EX.res, i = Math.floor((x + ws) / (2 * ws) * res), j = Math.floor((z + ws) / (2 * ws) * res); return i >= 0 && j >= 0 && i < res && j < res && !!EX.mask[j * res + i]; },
    encode: exploredEncode,
    clear() { EX.mask.fill(0); EX.n = 0; EX.ver++; EX.dirty = true; schedule('m5'); },
  };

  // ================================================================ presence room (transport agnostic, v4 sbRoom port)
  function makeRoom(tr) {
    const meId = 'pr' + rid(8), map = new Map(), hs = []; let snap = [], last = 0, timer = null, closed = false;
    const me = {};
    const emitPeers = () => {
      snap = []; for (const [peer, v] of map) if (v.p && v.p.w === S.world) snap.push({ peer, presence: v.p, sameTab: false });
      for (const h of hs.slice()) { try { h({ peers: snap }); } catch (e) { warn('peers', e); } }
    };
    const send = () => { if (closed) return Promise.resolve(); last = Date.now(); clearTimeout(timer); timer = null; return tr.send('p', { id: meId, p: me }); };
    tr.on('p', q => { if (!q || !q.id || q.id === meId || !q.p) return; const was = map.has(q.id); map.set(q.id, { p: q.p, t: Date.now() }); if (!was && Object.keys(me).length) send(); emitPeers(); });
    tr.on('bye', q => { if (q && map.delete(q.id)) emitPeers(); });
    const iv = setInterval(() => {
      if (closed) return; const n = Date.now(); let ch = false;
      for (const [k, v] of map) if (n - v.t > 9000) { map.delete(k); ch = true; }
      if (ch) emitPeers(); if (Object.keys(me).length && n - last > 2000) send();
    }, 1000);
    return {
      id: meId, me,
      presence(patch) {
        if (patch) for (const k in patch) { if (patch[k] === null) delete me[k]; else me[k] = patch[k]; }
        const n = Date.now(); if (n - last >= 120) return send();
        if (!timer) timer = setTimeout(send, 120 - (n - last)); return Promise.resolve();
      },
      peers: () => snap,
      onPeers(h) { hs.push(h); return () => { const i = hs.indexOf(h); if (i >= 0) hs.splice(i, 1); }; },
      bye() { try { tr.send('bye', { id: meId }); } catch (e) { } },
      close() { closed = true; clearInterval(iv); clearTimeout(timer); try { tr.send('bye', { id: meId }); } catch (e) { } if (tr.close) tr.close(); },
    };
  }
  function artifactRoom(R) {
    const hs = []; let last = 0, timer = null; const me = {};
    const list = () => { try { return R.peers().filter(p => !p.isMe && !p.sameTab && p.presence && p.presence.w === S.world).map(p => ({ peer: p.peer, presence: p.presence, sameTab: false })); } catch (e) { return []; } };
    try { R.onPeers(() => { const pe = list(); for (const h of hs.slice()) { try { h({ peers: pe }); } catch (e) { } } }, () => { }); } catch (e) { }
    const send = () => { last = Date.now(); clearTimeout(timer); timer = null; return Promise.resolve(R.presence(Object.assign({}, me))).catch(() => { }); };
    return {
      id: 'art', me,
      presence(patch) { if (patch) for (const k in patch) { if (patch[k] === null) delete me[k]; else me[k] = patch[k]; } const n = Date.now(); if (n - last >= 150) return send(); if (!timer) timer = setTimeout(send, 150 - (n - last)); return Promise.resolve(); },
      peers: list, onPeers(h) { hs.push(h); return () => { const i = hs.indexOf(h); if (i >= 0) hs.splice(i, 1); }; },
      bye() { }, close() { try { R.leave && R.leave(); } catch (e) { } },
    };
  }
  function bcTransport(name) {
    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null; const hs = {};
    if (bc) bc.onmessage = e => { const m = e.data; if (m && hs[m.ev]) hs[m.ev](m.p); };
    return { send(ev, p) { try { bc && bc.postMessage({ ev, p }); } catch (e) { } return Promise.resolve(); }, on(ev, fn) { hs[ev] = fn; }, close() { try { bc && bc.close(); } catch (e) { } } };
  }
  // the public room wrapper: base fields (world, player, device) always present, duplicate-device detection
  let RM = null; const roomHs = []; const dupSeen = new Set();
  const room = {
    presence(patch) { return RM ? RM.presence(patch) : Promise.resolve(); },
    peers() { return RM ? RM.peers() : []; },
    onPeers(fn) { roomHs.push(fn); return () => { const i = roomHs.indexOf(fn); if (i >= 0) roomHs.splice(i, 1); }; },
    get me() { return RM ? RM.me : {}; },
    get online() { return !!RM; },
  };
  function attachRoom(rm) {
    RM = rm; RM.presence({ w: S.world, k: S.key, pid: S.key, n: S.name, dev: S.dev });
    RM.onPeers(ev => {
      const peers = (ev && ev.peers) || RM.peers();
      for (const p of peers) { const q = p.presence || {}; if (q.k === S.key && q.dev && q.dev !== S.dev && !dupSeen.has(q.dev)) { dupSeen.add(q.dev); emit('dup', { dev: q.dev, peer: p.peer }); } }
      for (const fn of roomHs.slice()) { try { fn(peers); } catch (e) { warn('room', e); } }
      emit('peers', peers);
    });
  }

  // ================================================================ backend: Supabase
  function sbBackend(SB, cfg) {
    const T = () => SB.from(TABLE); const B = { kind: 'sb', client: SB };
    let netDown = false; const sentAt = new Map(); const skewS = [];
    B.offline = () => (typeof navigator !== 'undefined' && navigator.onLine === false);
    B.loadCol = async (c, o) => {
      o = o || {}; const out = []; let last = null;
      for (let page = 0; page < 500; page++) {
        let q = T().select('c,id,d,at').eq('w', S.world).eq('c', c);
        if (o.id != null) q = q.eq('id', o.id);
        if (o.since) q = q.gt('at', new Date(o.since).toISOString());
        if (!o.tomb) q = q.not('d', 'is', null);
        if (last != null) q = q.gt('id', last);
        const { data, error } = await q.order('id', { ascending: true }).limit(CFG.page);
        if (error) throw error;
        for (const r of data) out.push(r);
        if (data.length < CFG.page) break; last = data[data.length - 1].id;
      }
      return out;
    };
    B.since = async (ms) => { // every row changed after ms (catch-up after the socket slept), tombstones included
      const out = []; for (let p = 0; p < 20; p++) {
        const { data, error } = await T().select('c,id,d,at').eq('w', S.world).gt('at', new Date(ms).toISOString()).order('at', { ascending: true }).order('c').order('id').range(p * CFG.page, p * CFG.page + CFG.page - 1);
        if (error) throw error; for (const r of data) out.push(r); if (data.length < CFG.page) break;
      }
      return out;
    };
    B.fetchIds = async (c, ids) => {
      const out = []; for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await T().select('c,id,d,at').eq('w', S.world).eq('c', c).in('id', ids.slice(i, i + 100));
        if (error) throw error; for (const r of data) out.push(r);
      }
      return out;
    };
    const toRow = it => ({ w: S.world, c: it.c, id: it.id, d: it.d, at: new Date(it.t).toISOString() });
    B.put = async items => {
      const t0 = Date.now(); const { error } = await T().upsert(items.map(toRow));
      if (error) throw error; const t1 = Date.now(); for (const it of items) sentAt.set(pk(it.c, it.id) + '@' + it.t, (t0 + t1) / 2);
    };
    // page hide: a plain keepalive POST (survives the page being closed); the queue stays until confirmed
    B.keepalive = items => {
      if (typeof fetch !== 'function' || !cfg || !cfg.url) return null;
      const url = cfg.url.replace(/\/$/, '') + '/rest/v1/' + TABLE; const ps = []; let chunk = [], size = 0;
      const go = () => { if (!chunk.length) return; const body = JSON.stringify(chunk.map(toRow)); chunk = []; size = 0;
        try { ps.push(fetch(url, { method: 'POST', keepalive: true, headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body }).then(r => { if (!r.ok) throw new Error('http ' + r.status); })); } catch (e) { } };
      for (const it of items) { const b = bytes(it.d) + 200; if (size + b > 60000) go(); chunk.push(it); size += b; } go();
      return Promise.all(ps);
    };
    B.subscribe = (onRow, onState) => {
      const ch = SB.channel('lm-db5-' + S.world).on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: 'w=eq.' + S.world }, p => {
        const r = p && p.new; if (!r || !r.c) return;
        if (p.commit_timestamp && r.d && typeof r.d.t === 'number') { // our own echo -> server clock sample
          const k = pk(r.c, r.id) + '@' + r.d.t, ts = sentAt.get(k);
          if (ts) { sentAt.delete(k); const sv = Date.parse(p.commit_timestamp); if (sv === sv) { skewS.push(sv - ts); if (skewS.length > 7) skewS.shift(); B.skewSample(); } }
        }
        onRow(r);
      });
      ch.subscribe((st, err) => onState(st, err));
      B.ch = ch; return () => { try { SB.removeChannel(ch); } catch (e) { } };
    };
    B.skewSample = () => { if (skewS.length < 3 || B.rpcSkew) return; const s = skewS.slice().sort((a, b) => a - b)[skewS.length >> 1]; if (Math.abs(s) > 1500) clock.skew = Math.round(s); };
    B.serverNow = async () => {
      try { const t0 = Date.now(); const { data, error } = await SB.rpc('lumiar_now'); const t1 = Date.now(); if (error || !data) return; const sv = Date.parse(data); if (sv === sv) { const sk = sv - (t0 + t1) / 2; B.rpcSkew = true; clock.skew = Math.abs(sk) > 400 ? Math.round(sk) : 0; } } catch (e) { }
    };
    B.room = () => {
      const ch = SB.channel('lm-w5-' + S.world, { config: { broadcast: { self: false } } }); const hs = {};
      ch.on('broadcast', { event: 'p' }, m => hs.p && hs.p(m.payload)).on('broadcast', { event: 'bye' }, m => hs.bye && hs.bye(m.payload)).subscribe();
      return makeRoom({ send(ev, payload) { try { return Promise.resolve(ch.send({ type: 'broadcast', event: ev, payload })).catch(() => { }); } catch (e) { return Promise.resolve(); } }, on(ev, fn) { hs[ev] = fn; }, close() { try { SB.removeChannel(ch); } catch (e) { } } });
    };
    return B;
  }

  // ================================================================ backend: artifact runtime (db + room)
  function dbBackend(db, roomNs) {
    const B = { kind: 'db' }; const path = c => 'worlds5/' + S.world + '/' + c;
    const asRow = (c, s) => { const d = s.data(); if (!d) return null; if (d._del) return { c, id: s.id, d: null, at: new Date(d.t || 0).toISOString() }; return { c, id: s.id, d, at: new Date(d.t || 0).toISOString() }; };
    B.loadCol = async (c, o) => {
      o = o || {}; if (o.id != null) { const s = await db.doc(path(c) + '/' + o.id).get(); const r = s.exists ? asRow(c, s) : null; return r && r.d ? [r] : []; }
      let q = db.collection(path(c)); if (o.since) q = q.where('t', '>', o.since);
      const snap = await q.get(); return snap.docs.map(s => asRow(c, s)).filter(r => r && (r.d || o.tomb));
    };
    B.fetchIds = async (c, ids) => { const out = []; for (const id of ids) { try { const s = await db.doc(path(c) + '/' + id).get(); if (s.exists) { const r = asRow(c, s); if (r) out.push(r); } } catch (e) { throw e; } } return out; };
    B.put = async items => {
      for (const it of items) { await db.doc(path(it.c) + '/' + it.id).set(it.d ? it.d : { t: it.t, _del: 1 }); }
    };
    B.subscribe = (onRow, onState) => {
      const uns = []; let first = {};
      for (const c of COLS) {
        if (c === 'm5') { uns.push(db.doc(path('m5') + '/' + S.key).onSnapshot(s => { if (s.exists) { const r = asRow('m5', s); if (r) onRow(r); } }, e => onState('CHANNEL_ERROR', e))); continue; }
        uns.push(db.collection(path(c)).onSnapshot(snap => {
          if (!first[c]) { first[c] = true; return; } // the initial snapshot equals what loadCol returned
          for (const ch of snap.docChanges()) { if (ch.type === 'removed') { onRow({ c, id: ch.doc.id, d: null, at: new Date(clock.now()).toISOString() }); continue; } const r = asRow(c, ch.doc); if (r) onRow(r); }
        }, e => onState('CHANNEL_ERROR', e)));
      }
      onState('SUBSCRIBED'); return () => uns.forEach(u => { try { u(); } catch (e) { } });
    };
    B.room = async () => { if (!roomNs) return null; try { const R = roomNs.join ? await roomNs.join('w5-' + S.world) : roomNs; return artifactRoom(R); } catch (e) { return null; } };
    return B;
  }

  // ================================================================ backend: this device only
  function localBackend() {
    const B = { kind: 'local' };
    B.loadCol = async c => { const o = lsGet(PFX() + 'c:' + c, {}); return Object.keys(o).filter(id => o[id]).map(id => ({ c, id, d: o[id], at: new Date(o[id].t || 0).toISOString() })); };
    B.fetchIds = async (c, ids) => { const o = lsGet(PFX() + 'c:' + c, {}); return ids.filter(id => o[id]).map(id => ({ c, id, d: o[id], at: '' })); };
    B.put = async items => {
      const by = {}; for (const it of items) (by[it.c] || (by[it.c] = [])).push(it);
      for (const c in by) {
        if (c === 'm5') continue; const k = PFX() + 'c:' + c, o = lsGet(k, {});
        for (const it of by[c]) { if (it.d == null) delete o[it.id]; else o[it.id] = it.d; }
        if (!lsSet(k, o)) throw Object.assign(new Error('localStorage full'), { code: 'quota_exceeded' });
      }
    };
    B.subscribe = (onRow, onState) => { // other tabs of this browser
      const fn = e => {
        if (!e.key || e.key.indexOf(PFX() + 'c:') !== 0) return; const c = e.key.slice((PFX() + 'c:').length); if (!COLSET.has(c)) return;
        let o = {}; try { o = JSON.parse(e.newValue || '{}') || {}; } catch (er) { return; }
        for (const id in o) if (o[id]) onRow({ c, id, d: o[id], at: '' });
        for (const [id, d] of S.data[c]) if (!o[id] && !(c === 'p5' && id === S.key) && !pend.has(pk(c, id))) onRow({ c, id, d: null, at: new Date((d && d.t || 0) + 1).toISOString() });
      };
      if (G.addEventListener) G.addEventListener('storage', fn); onState('SUBSCRIBED');
      return () => { if (G.removeEventListener) G.removeEventListener('storage', fn); };
    };
    B.room = () => makeRoom(bcTransport('lumiar5-room-' + S.world));
    return B;
  }

  // ================================================================ connection + initial load
  let unsub = null, buffer = null, hiddenAt = 0, wired = false, lastRowAt = 0;
  async function pickBackend(want) {
    if (want === 'local') return localBackend();
    const c = G.claude;
    if ((want === 'auto' || want === 'db') && c && typeof c.use === 'function') {
      try {
        const [db, rm] = await Promise.all([c.use('db'), c.use('room').catch(() => null)]);
        if (db) return dbBackend(db, rm);
      } catch (e) { warn('artifact runtime', e); }
    }
    const cfg = G.LUMIAR_SB;
    if ((want === 'auto' || want === 'sb') && cfg && cfg.url && G.supabase && G.supabase.createClient) {
      try {
        const SB = L.sb || G.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { params: { eventsPerSecond: 20 } } });
        L.sb = SB; return sbBackend(SB, cfg);
      } catch (e) { warn('supabase', e); }
    }
    return localBackend();
  }
  function onRow(r) {
    lastRowAt = Date.now();
    if (buffer) { buffer.push(r); return; }
    incoming(r.c, r.id, r.d, rowTime(r), 'remote');
  }
  let subOk = false, everSub = false;
  function onSubState(st) {
    if (st === 'SUBSCRIBED') {
      const again = everSub && !subOk; subOk = true; everSub = true;
      if (S.backend !== 'local') setStatus('online');
      if (again) catchUp(hiddenAt || (Date.now() - 120e3));
      if (pend.size && S.ready) flush();
    } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
      if (subOk) hiddenAt = hiddenAt || Date.now(); subOk = false;
    }
  }
  async function catchUp(since) {
    if (!S.B || !S.B.since || !S.loaded) return;
    try { const rows = await S.B.since(since - 5 * 60e3); for (const r of rows) incoming(r.c, r.id, r.d, rowTime(r), 'remote'); hiddenAt = 0; if (S.backend !== 'local') setStatus('online'); }
    catch (e) { if (isNetErr(e)) setStatus('offline'); }
  }
  // full server load: world collections, every player's p5 (small), my m5; returns rows
  async function serverLoad() {
    const B = S.B, rows = [];
    const jobs = WORLD_COLS.map(c => B.loadCol(c, CFG.window[c] ? { since: clock.now() - CFG.window[c] } : null).then(rs => { for (const r of rs) rows.push(r); }));
    jobs.push(B.loadCol('p5').then(rs => { for (const r of rs) rows.push(r); }));
    jobs.push(B.loadCol('m5', { id: S.key }).then(rs => { for (const r of rs) rows.push(r); }));
    await Promise.all(jobs); return rows;
  }
  // apply a completed server load. World collections become exactly the server set (+ our pending writes);
  // the player is resolved against the local mirror; my explored map is OR-merged.
  function ingestLoad(rows) {
    const by = {}; for (const c of COLS) by[c] = new Map();
    let srvP = null, srvM = null;
    for (const r of rows) { if (!COLSET.has(r.c) || r.d == null) continue; if (r.c === 'm5') { if (r.id === S.key) { srvM = r.d; mergeExplored(r.d, !S.ready); } continue; } if (r.c === 'p5' && r.id === S.key) { srvP = r.d; continue; } by[r.c].set(r.id, r.d); }
    for (const c of COLS) {
      if (c === 'm5') continue; const cur = S.data[c], nxt = by[c];
      if (CFG.window[c]) for (const [id, d] of cur) if (!nxt.has(id) && (d.t || 0) < clock.now() - CFG.window[c]) nxt.set(id, d); // outside the window: keep
      for (const it of pend.values()) if (it.c === c) { const sd = nxt.get(it.id); if (!sd || (sd.t || 0) <= it.t) { if (it.d == null) nxt.delete(it.id); else nxt.set(it.id, it.d); } }
      if (c === 'p5' && S.player) nxt.set(S.key, S.player);
      // swap with change events (only after ready: before that the game reads all() itself)
      const old = new Map(cur); cur.clear(); for (const [id, d] of nxt) cur.set(id, d);
      if (S.ready) { for (const [id, d] of nxt) { const o = old.get(id); if (!o || !sameJSON(o, d)) emit(c, id, d, o, 'remote'); } for (const [id, o] of old) if (!nxt.has(id)) emit(c, id, null, o, 'remote'); }
      S.mirrorDirty.add(c);
    }
    // the player
    const loc = S.player ? { d: S.player, base: S.pbase, fresh: S.pfresh } : lsGet(PFX() + 'p:' + S.key, null);
    const res = resolvePlayer(loc, srvP);
    S.pfresh = false;
    if (res.d) {
      if (!S.player) S.player = fixPlayer(res.d); else if (!sameJSON(S.player, res.d)) { replacePlayer(res.d); if (S.ready) emit('player', S.player, 'load'); }
      S.pbase = Math.max(S.pbase, srvP ? (srvP.t || 0) : 0);
      if (res.write) { S.playerDirty = true; schedule('p5'); }
    }
    if (S.player) S.data.p5.set(S.key, S.player);
    if (EX.n > (srvM ? (srvM.n || 0) : 0)) { EX.dirty = true; schedule('m5'); } // this device saw places the server has not
    S.loaded = true;
  }

  async function init(opt) {
    opt = opt || {};
    if (S.world) await close();
    S.world = worldCode(opt.world); S.name = String(opt.name || 'Jogador').trim().slice(0, 24) || 'Jogador'; S.key = slug(opt.key || S.name);
    S.dev = lsGet('lumiar5:dev', null); if (!S.dev) { S.dev = 'd' + rid(10); lsSet('lumiar5:dev', S.dev); }
    S.ready = false; S.loaded = false; S.player = null; S.pbase = 0; S.pfresh = true; S.tomb.clear(); pend.clear(); dupSeen.clear();
    for (const c of COLS) S.data[c].clear();
    // 1) what this device knows: mirror, explored map, queued writes from a previous session
    readMirror();
    const pm = lsGet(PFX() + 'p:' + S.key, null);
    if (pm && pm.d) { S.player = fixPlayer(pm.d); S.pbase = pm.base || 0; S.pfresh = !!pm.fresh; }
    exploredLoad(lsGet(PFX() + 'x:' + S.key, null));
    for (const it of lsGet(PFX() + 'q', [])) { if (!it || !COLSET.has(it.c) || it.c === 'p5' || it.c === 'm5') continue; pend.set(pk(it.c, it.id), { c: it.c, id: it.id, d: it.d, t: it.t, chk: true, bad: 0 }); if (it.d == null) S.data[it.c].delete(it.id); else S.data[it.c].set(it.id, it.d); }
    // 2) backend
    S.B = await pickBackend(opt.backend || 'auto'); S.backend = S.B.kind;
    setStatus(S.backend === 'local' ? 'local' : 'offline');
    buffer = []; subOk = false; everSub = false;
    try { unsub = S.B.subscribe(onRow, onSubState); } catch (e) { warn('subscribe', e); }
    if (S.B.serverNow) S.B.serverNow();
    let loadErr = null, loaded = false;
    const loadP = serverLoad().then(rows => { loaded = true; const buf = buffer || []; buffer = null; ingestLoad(rows); for (const r of buf) incoming(r.c, r.id, r.d, rowTime(r), 'remote'); return true; }, e => { loadErr = e; return false; });
    const timeout = opt.timeout != null ? opt.timeout : CFG.loadTimeout;
    await Promise.race([loadP, sleep(timeout)]);
    if (!loaded) { // offline at boot: play from the mirror, merge when the server answers
      const buf = buffer || []; buffer = null; for (const r of buf) incoming(r.c, r.id, r.d, rowTime(r), 'remote');
      if (loadErr) warn('load failed, playing from this device', loadErr && (loadErr.message || loadErr));
      setStatus(S.backend === 'local' ? 'local' : 'offline');
      if (!loadErr) loadP.then(ok => { if (ok) { setStatus('online'); flush(); } });
      else retryLoadLater();
      markChk();
    } else if (S.backend !== 'local') setStatus('online');
    if (!S.player) { S.player = newPlayer(S.name, opt.look, opt.defaults); S.pfresh = !loaded; } // fresh = never compared with the server
    if (opt.look && Object.keys(opt.look).length) S.player.look = Object.assign({}, S.player.look, opt.look);
    if (S.player.name !== S.name) S.player.name = S.name;
    S.data.p5.set(S.key, S.player);
    // shared clock offset
    const ck = S.data.w5.get('clock'); if (ck && typeof ck.off === 'number') clock.off = ck.off;
    wire();
    S.ready = true;
    if (!ck && opt.startHour != null && loaded) { // a brand-new world starts in the morning (an old t: any real clock row wins)
      const g = clock.gameMs(); const target = Math.floor(g / DAY_MS) * DAY_MS + opt.startHour / 24 * DAY_MS; clock.off += Math.round(target - g);
      const rec = { off: clock.off, by: S.key, t: 1 }; S.data.w5.set('clock', rec); pend.set(pk('w5', 'clock'), { c: 'w5', id: 'clock', d: rec, t: 1, chk: true, bad: 0 }); schedule('w5');
    }
    // 3) presence
    try { const rm = await S.B.room(); if (rm) attachRoom(rm); } catch (e) { warn('room', e); }
    S.mirrorDirty = new Set(COLS); writeMirror(); mirrorPlayer();
    if (pend.size || S.playerDirty) schedule('_');
    emit('ready', S.player); emit('status', statusInfo());
    return S.player;
  }
  function retryLoadLater() {
    const tryLoad = async () => {
      if (!S.world || S.loaded) return;
      try { const rows = await serverLoad(); ingestLoad(rows); setStatus('online'); flush(); }
      catch (e) { setTimeout(tryLoad, Math.min(60000, 5000 * (1 + Math.random()))); }
    };
    setTimeout(tryLoad, 4000);
  }
  // page lifecycle: write everything down synchronously, then best-effort send (keepalive) before the page sleeps
  function onHide() {
    if (!S.world || !S.ready) return; hiddenAt = Date.now();
    materialize(); persistQueue(); writeMirror(); mirrorPlayer();
    if (S.B && S.B.keepalive && pend.size && !(S.B.offline && S.B.offline())) {
      const items = [...pend.values()].sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0));
      const p = S.B.keepalive(items);
      if (p) p.then(() => { for (const it of items) if (pend.get(pk(it.c, it.id)) === it) { pend.delete(pk(it.c, it.id)); if (it.c === 'p5' && it.id === S.key) { S.pbase = Math.max(S.pbase, it.t); S.pfresh = false; mirrorPlayer(); } } persistQueue(); S.lastOk = Date.now(); bumpSaving(); }, () => { });
    } else if (S.B && S.B.kind !== 'sb' && pend.size) flush();
    if (RM && RM.bye) RM.bye();
  }
  function onShow() {
    if (!S.world || !S.ready) return; lastActive = Date.now();
    if (hiddenAt && Date.now() - hiddenAt > 15000) catchUp(hiddenAt);
    retryNow();
  }
  function wire() {
    if (wired || !G.addEventListener) return; wired = true;
    G.addEventListener('pagehide', onHide);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); else onShow(); });
    G.addEventListener('online', () => { if (S.ready) retryNow(); });
    G.addEventListener('offline', () => { if (S.ready && S.backend !== 'local') setStatus('offline'); });
    const act = () => { lastActive = Date.now(); }; G.addEventListener('pointerdown', act, { passive: true }); G.addEventListener('keydown', act);
    // w5/clock from anyone moves our clock
    on('w5', (id, d) => { if (id === 'clock' && d && typeof d.off === 'number' && d.off !== clock.off) clock.setOffset(d.off, false); });
  }
  async function close() {
    if (!S.world) return; try { await flush(); } catch (e) { }
    onHide(); if (unsub) { try { unsub(); } catch (e) { } unsub = null; } if (RM) { RM.close(); RM = null; }
    clearTimeout(flushTimer); clearTimeout(retryTimer); clearTimeout(mirrorTimer); clearTimeout(pmirrorTimer); clearTimeout(queueTimer);
    flushTimer = retryTimer = mirrorTimer = pmirrorTimer = queueTimer = null; flushDue = Infinity;
    S.ready = false; S.world = null;
  }

  // ================================================================ public API
  const save = {
    init, close, flush, dirty, set, del, on,
    get: (c, id) => getRec(c, String(id)),
    all: c => S.data[c],
    get player() { return S.player; },
    get status() { return S.status; },
    get saving() { return pend.size > 0 || !!flushing || S.playerDirty; },
    get pending() { return pend.size; },
    get ready() { return S.ready; },
    get world() { return S.world; },
    get key() { return S.key; },
    get name() { return S.name; },
    get dev() { return S.dev; },
    get backend() { return S.backend; },
    info: statusInfo,
    retry: retryNow,
    // position helper: rounded, marks dirty only when it moved (survival keeps it on safe ground)
    setPos(x, y, z, ry) {
      const p = S.player; if (!p) return; const o = p.pos;
      if (o && Math.abs(o[0] - x) + Math.abs(o[1] - y) + Math.abs(o[2] - z) < .5 && Math.abs((o[3] || 0) - (ry || 0)) < .3) return;
      p.pos = [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +(ry || 0).toFixed(2)]; dirty();
    },
    room, explored,
    playerKey: slug, worldCode,
    CFG, COLS,
    // internals for tests
    _t: { mergeMono, mergePlayer, resolvePlayer, rleEncode, rleDecode, b64enc, b64dec, resample, slug, rowTime, bytes, pend, S, EX, incoming, onHide, onShow, catchUp, isNetErr },
  };
  L.save = save;
})(typeof window !== 'undefined' ? (window.L = window.L || {}) : (globalThis.L = globalThis.L || {}));
