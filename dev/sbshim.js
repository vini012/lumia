// Dev only: a stand-in for supabase-js inside a test page. Every call goes to the Node test runner through the
// Playwright binding window.__sb (one shared in-memory table for all pages = all phones), realtime events come back
// through window.__sbPush. When the browser context is offline (navigator.onLine false) requests fail like fetch does.
(function () {
  window.SB_MOCK = { url: 'https://mock.supabase.test', key: 'sb_publishable_mock' }; // config for save.js (?sb=mock)
  const subs = new Map(); let nextId = 1;
  const netErr = () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } });
  const call = async (msg) => {
    if (navigator.onLine === false) { await new Promise(r => setTimeout(r, 40)); return netErr(); }
    try { return await window.__sb(msg); } catch (e) { return netErr(); }
  };
  window.__sbPush = function (ev) { // {sub, kind:'pg'|'bc'|'state', payload}
    const s = subs.get(ev.sub); if (!s) return;
    if (ev.kind === 'state') { s.state = ev.payload; if (s.cb) s.cb(ev.payload); return; }
    for (const h of s.hs) {
      if (ev.kind === 'pg' && h.type === 'postgres_changes') h.cb(ev.payload);
      if (ev.kind === 'bc' && h.type === 'broadcast' && h.filt.event === ev.payload.event) h.cb({ payload: ev.payload.payload });
    }
  };
  // the socket drops when the phone goes offline and joins again (every channel) when it comes back, like supabase-js
  // a failed join is retried with a growing delay (supabase-js rejoins the same way)
  const join = s => call({ op: 'sub', sub: s.id, name: s.name, pg: s.hs.filter(h => h.type === 'postgres_changes').map(h => h.filt.filter || '') })
    .then(r => {
      if (!(r && r.error)) { s.tries = 0; return; }
      if (s.state !== 'CHANNEL_ERROR') { s.state = 'CHANNEL_ERROR'; s.cb && s.cb('CHANNEL_ERROR'); }
      if (s.joined && subs.has(s.id) && navigator.onLine !== false) { clearTimeout(s.rt); s.rt = setTimeout(() => join(s), Math.min(10000, 1000 * Math.pow(2, s.tries = (s.tries || 0) + 1) / 2)); }
    });
  addEventListener('offline', () => { for (const s of subs.values()) if (s.joined && s.state !== 'CHANNEL_ERROR') { s.state = 'CHANNEL_ERROR'; s.cb && s.cb('CHANNEL_ERROR'); } });
  addEventListener('online', () => { for (const s of subs.values()) if (s.joined) setTimeout(() => join(s), 150 + Math.random() * 200); });
  window.supabase = {
    createClient(url, key) {
      const client = {
        url, key,
        from(table) {
          return {
            select(cols) {
              const q = { op: 'select', table, f: [], ord: [], lim: null, from: 0 };
              const b = {
                eq(k, v) { q.f.push(['eq', k, v]); return b; }, in(k, v) { q.f.push(['in', k, v]); return b; },
                not(k, op, v) { q.f.push(['notnull', k]); return b; }, gt(k, v) { q.f.push(['gt', k, v]); return b; },
                order(k, o) { q.ord.push([k, !o || o.ascending !== false]); return b; }, limit(n) { q.lim = n; return b; },
                range(a, z) { q.from = a; q.lim = z - a + 1; return b; },
                then(res, rej) { return call(q).then(res, rej); },
              };
              return b;
            },
            upsert(rows) { rows = Array.isArray(rows) ? rows : [rows]; return { then(res, rej) { return call({ op: 'upsert', table, rows }).then(res, rej); } }; },
          };
        },
        rpc(name) { return call({ op: 'rpc', name }); },
        channel(name) {
          const id = nextId++; const s = { id, name, hs: [], cb: null, state: 'joining' }; subs.set(id, s);
          const ch = {
            _id: id,
            on(type, filt, cb) { s.hs.push({ type, filt, cb }); return ch; },
            subscribe(cb) {
              s.cb = cb || null; s.joined = true; join(s);
              return ch;
            },
            send(m) { return call({ op: 'bc', sub: id, name, event: m.event, payload: m.payload }).then(r => (r && r.error ? 'error' : 'ok')); },
          };
          return ch;
        },
        removeChannel(ch) { const s = ch && subs.get(ch._id); if (s) { clearTimeout(s.rt); subs.delete(ch._id); call({ op: 'unsub', sub: ch._id }); } },
      };
      return client;
    },
  };
})();
