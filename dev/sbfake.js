// Dev only: in-page fake Supabase for headless runs of the real game page (index.html). Never reaches a server.
// usage (run.js): cat dev/sbfake.js dev/sbshim.js > /tmp/x/init.js, then CFG {"initFile":"/tmp/x/init.js", ...}
//   * window.__sb: the table of dev/e2e_sys.js (select / upsert / rpc / sub / bc) kept in localStorage
//     ('lumiar5dev:table'), so a reload sees what the last session saved, like the real server;
//   * window.LUMIAR_SB is pinned to a fake address (config.js cannot replace it);
//   * window.supabase keeps the first value assigned (dev/sbshim.js, loaded right after this file): lib/supabase.js
//     cannot replace it, so no websocket ever opens.
(function () {
  const KEY = 'lumiar5dev:table';
  const load = () => { try { return new Map(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { return new Map(); } };
  const rows = load(); const subs = new Map();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify([...rows])); } catch (e) { } };
  const rowT = r => r && r.d && typeof r.d.ts === 'number' ? r.d.ts : (r && r.at ? Date.parse(r.at) : 0);
  const push = ev => setTimeout(() => { if (window.__sbPush) window.__sbPush(ev); }, 15);
  window.__sbStats = { upserts: 0, selects: 0, rows: () => rows.size };
  window.__sb = async function (m) {
    await new Promise(r => setTimeout(r, 10));
    if (m.op === 'select') {
      window.__sbStats.selects++;
      let out = [...rows.values()].filter(r => m.f.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'notnull' ? r[k] !== null : op === 'gt' ? (k === 'at' || k === 'sat' ? Date.parse(r[k]) > Date.parse(v) : r[k] > v) : true));
      out.sort((a, b) => { for (const [k, asc] of m.ord) { if (a[k] < b[k]) return asc ? -1 : 1; if (a[k] > b[k]) return asc ? 1 : -1; } return 0; });
      out = out.slice(m.from || 0, m.lim == null ? undefined : (m.from || 0) + m.lim);
      return { data: JSON.parse(JSON.stringify(out)), error: null };
    }
    if (m.op === 'upsert') {
      window.__sbStats.upserts++;
      for (const r of m.rows) {
        const k = r.w + '|' + r.c + '|' + r.id, old = rows.get(k);
        if (old && rowT(r) < rowT(old)) continue;
        const row = { w: r.w, c: r.c, id: r.id, d: r.d == null ? null : JSON.parse(JSON.stringify(r.d)), at: r.at || new Date().toISOString(), sat: new Date().toISOString() };
        rows.set(k, row);
        const ev = { schema: 'public', table: 'lumiar_mundo', eventType: old ? 'UPDATE' : 'INSERT', new: row, old: {}, commit_timestamp: new Date().toISOString() };
        for (const s of subs.values()) if (s.pg.some(f => f === 'w=eq.' + row.w)) push({ sub: s.id, kind: 'pg', payload: ev });
      }
      persist(); return { data: null, error: null };
    }
    if (m.op === 'rpc') return m.name === 'lumiar_now' ? { data: new Date().toISOString(), error: null } : { data: null, error: { code: 'PGRST202', message: 'not found' } };
    if (m.op === 'sub') { subs.set(m.sub, { id: m.sub, name: m.name, pg: m.pg }); push({ sub: m.sub, kind: 'state', payload: 'SUBSCRIBED' }); return { data: 'ok', error: null }; }
    if (m.op === 'unsub') { subs.delete(m.sub); return { data: 'ok', error: null }; }
    if (m.op === 'bc') return { data: 'ok', error: null };   // one page: nobody else to hear presence
    return { data: null, error: { code: 'x', message: 'bad op' } };
  };
  const FAKE = Object.freeze({ url: 'https://mock.supabase.test', key: 'sb_publishable_mock' });
  Object.defineProperty(window, 'LUMIAR_SB', { configurable: false, get: () => FAKE, set: () => { } });
  let shim = null;
  Object.defineProperty(window, 'supabase', { configurable: false, get: () => shim, set: v => { if (!shim) shim = v; } });
})();
