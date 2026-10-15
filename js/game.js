/* Lumiar v4 game: shared world state (db + presence), inventory & tools, harvesting, taming & mounts, ARK-style
   building and crafting stations, map & discovery, day/night, audio, particles, HUD, main loop. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep, C } = L;
  const $ = s => document.querySelector(s);
  const now = () => Date.now();
  const sget = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const sset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const dist2 = (a, b, c, d) => (a - c) * (a - c) + (b - d) * (b - d);
  const TAU = Math.PI * 2;
  const wrapA = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ================================================================ items, tools, recipes
  const ITEM = {
    madeira: { n: 'Madeira', ic: '🪵' }, pedra: { n: 'Pedra', ic: '🪨' }, fibra: { n: 'Fibra', ic: '🌾' }, frutinhas: { n: 'Frutinhas', ic: '🫐' },
    sementes: { n: 'Sementes', ic: '🌱' }, abobora: { n: 'Abóbora', ic: '🎃' }, cogumelo: { n: 'Cogumelo', ic: '🍄' }, minerio: { n: 'Minério', ic: '🟠' },
    ferro: { n: 'Ferro', ic: '🔩' }, cristal: { n: 'Cristal', ic: '💎' },
    pocao_vento: { n: 'Poção do Vento', ic: '🧪', pot: { dur: 90, desc: 'corre 40% mais rápido' } },
    pocao_luz: { n: 'Poção de Luz', ic: '🔮', pot: { dur: 150, desc: 'brilha e atrai criaturas' } },
    pocao_salto: { n: 'Poção de Salto', ic: '⚗️', pot: { dur: 90, desc: 'pula muito alto' } },
  };
  const BASE_ITEMS = ['madeira', 'pedra', 'fibra', 'frutinhas', 'sementes', 'abobora', 'cogumelo', 'minerio', 'ferro', 'cristal'];
  const TOOL = { axe: { n: 'Machado', ic: '🪓' }, pickaxe: { n: 'Picareta', ic: '⛏️' }, hoe: { n: 'Enxada', ic: '🌱' }, hammer: { n: 'Martelo', ic: '🔨' }, torch: { n: 'Tocha', ic: '🔥' } };
  // where: mao (anywhere), bancada, forja, bigorna, caldeirao
  const RECIPES = [
    { id: 'axe1', w: 'mao', n: 'Machado de pedra', ic: '🪓', cost: { madeira: 3, pedra: 2 }, tool: ['axe', 1], desc: 'corta árvores mais rápido' },
    { id: 'pick1', w: 'mao', n: 'Picareta de pedra', ic: '⛏️', cost: { madeira: 3, pedra: 3 }, tool: ['pickaxe', 1], desc: 'minera pedra, minério e cristal' },
    { id: 'torch', w: 'mao', n: 'Tocha', ic: '🔥', cost: { madeira: 1, fibra: 2 }, tool: ['torch', 1], desc: 'luz na mão à noite' },
    { id: 'hoe1', w: 'bancada', n: 'Enxada', ic: '🌱', cost: { madeira: 2, pedra: 1 }, tool: ['hoe', 1], desc: 'canteiros crescem 2× mais rápido' },
    { id: 'ham1', w: 'bancada', n: 'Martelo', ic: '🔨', cost: { madeira: 2, pedra: 2 }, tool: ['hammer', 1], desc: 'construções 20% mais baratas' },
    { id: 'ferro', w: 'forja', n: 'Barra de ferro', ic: '🔩', cost: { minerio: 2, madeira: 1 }, give: { ferro: 1 }, lit: true, desc: 'derrete minério' },
    { id: 'ferro5', w: 'forja', n: '5 barras de ferro', ic: '🔩', cost: { minerio: 10, madeira: 4 }, give: { ferro: 5 }, lit: true, desc: 'lote econômico' },
    { id: 'axe2', w: 'bigorna', n: 'Machado de ferro', ic: '🪓', cost: { ferro: 2, madeira: 2 }, tool: ['axe', 2], desc: 'corta em 2 golpes, mais madeira' },
    { id: 'pick2', w: 'bigorna', n: 'Picareta de ferro', ic: '⛏️', cost: { ferro: 3, madeira: 2 }, tool: ['pickaxe', 2], desc: 'minera rápido, mais minério' },
    { id: 'pv', w: 'caldeirao', n: 'Poção do Vento', ic: '🧪', cost: { cogumelo: 1, frutinhas: 2 }, give: { pocao_vento: 1 }, lit: true, desc: '40% mais rápido por 90 s' },
    { id: 'pl', w: 'caldeirao', n: 'Poção de Luz', ic: '🔮', cost: { cristal: 1, frutinhas: 1 }, give: { pocao_luz: 1 }, lit: true, desc: 'brilho e criaturas curiosas' },
    { id: 'ps', w: 'caldeirao', n: 'Poção de Salto', ic: '⚗️', cost: { abobora: 1, cogumelo: 1 }, give: { pocao_salto: 1 }, lit: true, desc: 'pulos enormes por 90 s' },
  ];
  const STATION_NAME = { mao: 'Mãos', bancada: 'Bancada', forja: 'Forja', bigorna: 'Bigorna', caldeirao: 'Caldeirão' };
  const REGROW = { tree: 300, rock: 420, ore: 600, crystal: 600, bush: 150, fibra: 120, fibra1: 90, mush: 220 };
  const PLANT_T = [70, 150]; // canteiro: sprout, growing, ripe (seconds; halved with a hoe)

  // ================================================================ shared state & sync
  let WORLD = 'nosso-mundo', PID = sget('lumiar:pid', null); if (!PID) { PID = 'p' + Math.random().toString(36).slice(2, 10); sset('lumiar:pid', PID); }
  const COLS = ['builds4', 'cut4', 'tames4', 'disc4', 'chest4'];
  const STATE = {}; COLS.forEach(c => STATE[c] = {}); L.STATE = STATE;
  let DB = null, ROOM = null, RROOM = null, warnedWrite = false;
  const Local = { key: c => 'lumiar:w:' + WORLD + ':' + c, listen(c, cb) { cb(sget(this.key(c), {})); }, set(c, id, d) { const all = sget(this.key(c), {}); all[id] = d; sset(this.key(c), all); }, del(c, id) { const all = sget(this.key(c), {}); delete all[id]; sset(this.key(c), all); } };
  // Vercel build: shared world in one Supabase table (lumiar_mundo: w, c, id, d; d = null means removed) + realtime
  let SB = null; const SBT = 'lumiar_mundo';
  const SBX = {
    async start() {
      let from = 0; const got = {}; COLS.forEach(c => got[c] = {});
      for (let k = 0; k < 60; k++) { const { data, error } = await SB.from(SBT).select('c,id,d').eq('w', WORLD).range(from, from + 999); if (error) { console.warn('sb', error); break; } for (const r of data) if (r.d != null && got[r.c]) got[r.c][r.id] = r.d; if (data.length < 1000) break; from += 1000; }
      COLS.forEach(c => { STATE[c] = Object.assign(got[c], STATE[c]); onState(c); });
      SB.channel('lm-db-' + WORLD).on('postgres_changes', { event: '*', schema: 'public', table: SBT, filter: 'w=eq.' + WORLD }, p => { const r = p.new; if (!r || !r.c || !STATE[r.c]) return; const o = Object.assign({}, STATE[r.c]); if (r.d == null) delete o[r.id]; else o[r.id] = r.d; STATE[r.c] = o; onState(r.c); }).subscribe();
    },
    put(c, id, d) { SB.from(SBT).upsert({ w: WORLD, c, id, d, at: new Date().toISOString() }).then(({ error }) => { if (error) writeFail(error); }); },
  };
  // presence over a realtime broadcast channel, shaped like the artifact room (peers / onPeers / presence)
  function sbRoom(name) {
    const meId = 'pr' + Math.random().toString(36).slice(2, 10), map = new Map(), hs = []; let snap = [];
    const ch = SB.channel(name, { config: { broadcast: { self: false } } });
    const emit = () => { snap = [...map.entries()].map(([peer, v]) => ({ peer, presence: v.p, sameTab: false })); hs.forEach(h => h({ peers: snap })); };
    ch.on('broadcast', { event: 'p' }, m => { const q = m.payload; if (!q || !q.id || q.id === meId || !q.p) return; map.set(q.id, { p: q.p, t: Date.now() }); emit(); })
      .on('broadcast', { event: 'bye' }, m => { if (m.payload && map.delete(m.payload.id)) emit(); }).subscribe();
    setInterval(() => { const n = Date.now(); let ch2 = false; for (const [k, v] of map) if (n - v.t > 9000) { map.delete(k); ch2 = true; } if (ch2) emit(); }, 3000);
    addEventListener('pagehide', () => { try { ch.send({ type: 'broadcast', event: 'bye', payload: { id: meId } }); } catch (e) { } });
    return { presence: p => Promise.resolve(ch.send({ type: 'broadcast', event: 'p', payload: { id: meId, p } })), peers: () => snap, onPeers(h) { hs.push(h); return () => { }; } };
  }
  const Store = {
    listen(c) { if (SB) return; if (DB) DB.collection('worlds/' + WORLD + '/' + c).onSnapshot(s => { const o = {}; s.docs.forEach(d => { o[d.id] = d.data(); }); STATE[c] = o; onState(c); }, e => console.warn('db', e)); else Local.listen(c, o => { STATE[c] = o; onState(c); }); },
    set(c, id, d) { STATE[c] = Object.assign({}, STATE[c], { [id]: d }); onState(c); if (SB) SBX.put(c, id, d); else if (DB) DB.doc('worlds/' + WORLD + '/' + c + '/' + id).set(d).catch(writeFail); else Local.set(c, id, d); },
    del(c, id) { const o = Object.assign({}, STATE[c]); delete o[id]; STATE[c] = o; onState(c); if (SB) SBX.put(c, id, null); else if (DB) DB.doc('worlds/' + WORLD + '/' + c + '/' + id).delete().catch(writeFail); else Local.del(c, id); }
  };
  function writeFail(e) { console.warn(e); if (!warnedWrite) { warnedWrite = true; toast(SB ? 'Não consegui salvar no servidor. Confira a internet.' : 'Você não tem permissão para mudar este mundo. Peça ao dono do link acesso de Editor.', 6000); } }
  function onState(c) {
    if (c === 'builds4') L.buildSync(STATE.builds4);
    if (c === 'cut4') cutDirty = true;
    if (c === 'tames4') { L.crTamedSet = STATE.tames4; L.crSyncTames(STATE.tames4, PID); renderPowers(); }
    if (c === 'disc4') { if (mapOpen) drawMap(); }
    if (c === 'chest4' && chestOpen) renderChest();
  }
  let cutDirty = true;
  const isGone = it => { const c = STATE.cut4[it.id]; return !!c && (now() - c.at) / 1000 < (REGROW[it.kindRes] || 300); };
  L.applyCut = it => { it.gone = isGone(it); };
  function syncCut(px, pz) { L.nearby(px, pz, 260, it => { if (!it.kindRes || it.kindRes === 'none') return; const g = isGone(it); if (g !== it.gone) { const was = it.gone; it.gone = g; if (was && !g && started && dist2(it.x, it.z, P.x, P.z) < 1600) burst(it.x, it.y + 1, it.z, 10, [.7, 1, .6], 2); } }); }

  // ================================================================ player state, inventory
  const P = L.P; const me = { name: 'Mago', ci: 0, g: 'm', actStamp: 0, actKind: '', emo: 0, pot: {}, spawn: null };
  let M = null, started = false; L.me = me;
  let INV = {}; let TOOLS = {};
  const saveInv = () => { sset('lumiar:inv4:' + WORLD, INV); sset('lumiar:tools4:' + WORLD, TOOLS); };
  const has = (k, n) => (INV[k] || 0) >= (n || 1);
  function give(k, n, quiet) { INV[k] = (INV[k] || 0) + n; saveInv(); renderInv(k); if (!quiet) floatText(`+${n} ${ITEM[k] ? ITEM[k].ic : ''}`); }
  function canPay(cost) { for (const k in cost) if ((INV[k] || 0) < cost[k]) return false; return true; }
  function pay(cost) { if (!canPay(cost)) return false; for (const k in cost) INV[k] -= cost[k]; saveInv(); renderInv(); return true; }
  const costTxt = c => Object.keys(c).map(k => `${c[k]}${ITEM[k] ? ITEM[k].ic : k}`).join(' ') || 'grátis';
  const missTxt = c => Object.keys(c).filter(k => (INV[k] || 0) < c[k]).map(k => `${c[k] - (INV[k] || 0)}${ITEM[k].ic}`).join(' ');
  const pow = id => L.POW.has(id);
  const potOn = k => me.pot[k] && me.pot[k] > now();
  function renderInv(bump) {
    const el = $('#inv'); const keys = BASE_ITEMS.filter(k => INV[k] > 0 || ['madeira', 'pedra', 'fibra', 'frutinhas'].includes(k));
    el.innerHTML = keys.map(k => `<span class="chip${bump === k ? ' bump' : ''}" title="${ITEM[k].n}">${ITEM[k].ic}<b>${INV[k] || 0}</b></span>`).join('');
    if (bagOpen) renderBag();
  }
  function renderPowers() {
    const el = $('#powers'); if (!el) return; const list = [];
    for (const k in L.SPECIES) { const S = L.SPECIES[k]; if (pow(S.pow.id)) list.push(`<span class="chip pw" title="${esc(S.pow.desc)}">${S.ic} ${esc(S.pow.nome)}</span>`); }
    for (const k in ITEM) if (ITEM[k].pot && potOn(k)) list.push(`<span class="chip pw pot">${ITEM[k].ic} ${Math.ceil((me.pot[k] - now()) / 1000)}s</span>`);
    el.innerHTML = list.join('');
  }
  function mods() {
    const night = L.NIGHT > .5; let sp = 1; if (pow('vento')) sp *= 1.35; if (pow('uivo') && night) sp *= 1.25; if (potOn('pocao_vento')) sp *= 1.4;
    return { speedMul: sp, jumpMul: (pow('salto') ? 1.45 : 1) * (potOn('pocao_salto') ? 1.6 : 1), climb: pow('escalada'), waterWalk: pow('lirio'), swimMul: pow('casco') ? 2.2 : 1, glide: pow('planar') };
  }

  // ================================================================ multiplayer presence
  let lastPres = 0, presDirty = true, lastPresPos = [0, 0, 0];
  function pushPresence(t) {
    if (!RROOM || t - lastPres < .12) return; const moved = Math.abs(P.x - lastPresPos[0]) + Math.abs(P.z - lastPresPos[2]) + Math.abs(P.y - lastPresPos[1]) > .05;
    if (!presDirty && !moved && t - lastPres < 2) return; lastPres = t; presDirty = false; lastPresPos = [P.x, P.y, P.z];
    const mc = P.mount;
    RROOM.presence({ w: WORLD, pid: PID, n: me.name, c: me.ci, g: me.g, x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), ry: +(mc ? mc.ry : P.ry).toFixed(2), v: +(mc ? mc.v : P.speed).toFixed(1), a: me.actStamp || 0, ak: me.actKind || '', e: me.emo || 0, sw: P.swim > .5 ? 1 : 0, rd: mc ? mc.id : '', tl: M ? M.toolName : '', fl: mc && mc.fly ? 1 : 0, lt: lightOn() ? 1 : 0 }).catch(() => { });
  }
  function ownersMap() {
    const o = { [PID]: { x: P.x, y: P.y, z: P.z, ry: P.mount ? P.mount.ry : P.ry, v: P.mount ? P.mount.v : P.speed } };
    for (const r of L.REMOTE.values()) if (r.pid) o[r.pid] = { x: r.x, y: r.y, z: r.z, ry: r.ry, v: r.v };
    return o;
  }
  async function connect() {
    const c = window.claude; if (c && c.use) { try { const [db, room] = await Promise.all([c.use('db'), c.use('room')]); DB = db || null; ROOM = room || null; } catch (e) { } }
    const cfg = window.LUMIAR_SB; if (!DB && cfg && cfg.url && window.supabase && window.supabase.createClient) { try { SB = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 20 } } }); } catch (e) { console.warn('sb', e); SB = null; } }
  }
  async function joinWorld() {
    COLS.forEach(c => Store.listen(c));
    if (SB) { SBX.start(); RROOM = sbRoom('lm-w4-' + WORLD); RROOM.onPeers(() => syncPeers()); return; }
    if (ROOM) { try { RROOM = await ROOM.join('w4-' + WORLD); } catch (e) { RROOM = ROOM; } RROOM.onPeers(() => syncPeers(), () => { }); }
  }
  function syncPeers() {
    if (!RROOM) return; const peers = RROOM.peers().filter(p => !p.sameTab && p.presence && p.presence.w === WORLD);
    L.remoteSync(peers, r => { if (started) { toast(`${r.nm} chegou ao mundo ✨`); sfx('magic'); } }, r => { if (started) toast(`${r.nm} saiu do mundo`); });
    $('#pc').textContent = 1 + L.REMOTE.size;
  }

  // ================================================================ UI helpers
  function toast(msg, ms) { const t = document.createElement('div'); t.className = 'toast glass'; t.textContent = msg; const box = $('#toast'); box.appendChild(t); while (box.children.length > 3) box.removeChild(box.firstChild); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 600); }, ms || 2800); }
  L.toast = toast;
  const floaters = [];
  function floatText(txt, x, y, z) { const s = L.textSprite(txt, .55, '#fff3c4'); s.material.depthTest = false; s.position.set(x != null ? x : P.x, (y != null ? y : P.y) + 2.5, z != null ? z : P.z); s.renderOrder = 9; L.scene.add(s); floaters.push({ s, t: 0 }); }
  function hint(msg) { const h = $('#hint'); if (!msg) { h.hidden = true; return; } h.hidden = false; h.textContent = msg; }

  // ================================================================ particles
  let FX, SMOKE, HEARTS, LEAVES, FLIES;
  function burst(x, y, z, n, c, sp, opts) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, u = Math.random(); FX.emit(Object.assign({ x, y, z, vx: Math.cos(a) * sp * u, vy: sp * (.5 + Math.random()), vz: Math.sin(a) * sp * u, g: sp * 1.5, life: .6 + Math.random() * .6, s0: .5, s1: .05, c }, opts || {})); } }
  function chips(x, y, z, col) { for (let i = 0; i < 10; i++) { const a = Math.random() * TAU; LEAVES.emit({ x, y, z, vx: Math.cos(a) * 2.5, vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * 2.5, g: 7, life: .9, s0: .22, s1: .18, c: col, a: 1, rot: Math.random() * 6, rv: 4 }); } }
  function leafBurst(x, y, z, col) { for (let i = 0; i < 16; i++) { const a = Math.random() * TAU; LEAVES.emit({ x: x + (Math.random() - .5) * 2.5, y: y + (Math.random() - .5) * 1.5, z: z + (Math.random() - .5) * 2.5, vx: Math.cos(a) * 1.5, vy: -.2 + Math.random() * .8, vz: Math.sin(a) * 1.5, g: 1.2, life: 2, s0: .3, s1: .28, c: col, a: 1, drag: 1.2, rot: Math.random() * 6, rv: 3 }); } }
  function hearts(x, y, z) { for (let i = 0; i < 6; i++) HEARTS.emit({ x: x + (Math.random() - .5), y: y + Math.random() * .4, z: z + (Math.random() - .5), vy: 1.2 + Math.random(), vx: (Math.random() - .5) * .6, vz: (Math.random() - .5) * .6, life: 1.6, s0: .7, s1: .9, a: 1 }); }
  function splash(x, z, n) { for (let i = 0; i < n; i++) SMOKE.emit({ x, y: .1, z, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 2, vz: (Math.random() - .5) * 3, g: 7, life: .8, s0: .3, s1: .15, c: [.9, .97, 1], a: .9 }); }
  function makeFireflies() {
    const n = 220, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), ph = new Float32Array(n); for (let i = 0; i < n; i++) { p[i * 3] = Math.random() * 80 - 40; p[i * 3 + 1] = .4 + Math.random() * 3.5; p[i * 3 + 2] = Math.random() * 80 - 40; ph[i] = Math.random() * 100; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uA: { value: 0 }, uC: { value: new THREE.Vector3() }, uScale: { value: 300 }, uTex: { value: L.GLOW } },
      vertexShader: `attribute float aPh;uniform float uT,uScale;uniform vec3 uC;varying float vA;void main(){vec3 p=position;p.x=mod(p.x-uC.x+40.,80.)-40.+uC.x;p.z=mod(p.z-uC.z+40.,80.)-40.+uC.z;p.y+=uC.y+sin(uT*.7+aPh)*.6;p.x+=sin(uT*.5+aPh*1.3)*1.2;p.z+=cos(uT*.4+aPh)*1.2;vA=.5+.5*sin(uT*2.3+aPh*3.);vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=.35*uScale/-mv.z;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform float uA;uniform sampler2D uTex;varying float vA;void main(){vec4 t=texture2D(uTex,gl_PointCoord);gl_FragColor=vec4(vec3(.85,1.,.45)*t.rgb,t.a*uA*vA);}` });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 6; L.scene.add(pts); return m;
  }

  // ================================================================ input
  const keys = {}; let jumpQ = false;
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return; if (keys[e.code]) return; keys[e.code] = true; if (!started) return;
    if (e.code === 'Space') { e.preventDefault(); jumpQ = true; }
    if (e.code === 'KeyE') doAction(); if (e.code === 'KeyF') doAlt(); if (e.code === 'KeyB') toggleBuild(); if (e.code === 'KeyM') toggleMap(); if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); toggleBag(); } if (e.code === 'KeyH') emote();
    if (placing) { if (e.code === 'KeyR') placeRot(1); if (e.code === 'KeyT') placeLevel(1); if (e.code === 'KeyG') placeLevel(-1); if (e.code === 'Enter') confirmPlace(); if (e.code === 'Escape') cancelPlace(); }
    else if (e.code === 'Escape') closePanels();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  const joy = { id: null, ox: 0, oy: 0, vx: 0, vy: 0 };
  const jz = $('#joy'), jb = $('#joyBase'), jk = $('#joyKnob');
  jz.addEventListener('pointerdown', e => { e.preventDefault(); joy.id = e.pointerId; jz.setPointerCapture(e.pointerId); const r = jz.getBoundingClientRect(); joy.ox = e.clientX - r.left; joy.oy = e.clientY - r.top; jb.style.left = joy.ox + 'px'; jb.style.top = joy.oy + 'px'; jb.style.display = 'block'; $('#joyHint').hidden = true; joy.vx = joy.vy = 0; jk.style.transform = ''; pinAim = null; });
  jz.addEventListener('pointermove', e => { if (e.pointerId !== joy.id) return; const r = jz.getBoundingClientRect(); let dx = e.clientX - r.left - joy.ox, dy = e.clientY - r.top - joy.oy; const l = Math.hypot(dx, dy), mx = 58; if (l > mx) { dx *= mx / l; dy *= mx / l; } const dz = 7; const ll = Math.max(0, Math.min(l, mx) - dz) / (mx - dz); joy.vx = l > 0 ? dx / l * ll : 0; joy.vy = l > 0 ? dy / l * ll : 0; jk.style.transform = `translate(${dx}px,${dy}px)`; });
  const jend = e => { if (e.pointerId !== joy.id) return; joy.id = null; joy.vx = joy.vy = 0; jb.style.display = 'none'; }; jz.addEventListener('pointerup', jend); jz.addEventListener('pointercancel', jend);
  const cv = L.renderer.domElement; const ptrs = new Map(); let pinch0 = 0; const cam = L.cam;
  cv.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() }); try { cv.setPointerCapture(e.pointerId); } catch (er) { } if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } });
  cv.addEventListener('pointermove', e => { const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; if (ptrs.size === 1) { cam.tyaw -= dx * .0065; cam.tpitch = clamp(cam.tpitch + dy * .0045, -.6, 1.3); /* drag up looks up (sky), drag down looks down */ cam.lastDrag = clockT; } else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) cam.tdist = clamp(cam.tdist * pinch0 / d, cam.min, cam.max); pinch0 = d; } });
  const pend = e => { const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); pinch0 = 0; if (p && started && performance.now() - p.t < 260 && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 9) tapWorld(e.clientX, e.clientY); }; cv.addEventListener('pointerup', pend); cv.addEventListener('pointercancel', pend);
  cv.addEventListener('wheel', e => { cam.tdist = clamp(cam.tdist * (1 + e.deltaY * .001), cam.min, cam.max); }, { passive: true });
  const ray = new THREE.Raycaster(); let walkTo = null, pinAim = null;
  function tapWorld(cx, cy) {
    const r = cv.getBoundingClientRect(); const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(v, L.camera);
    const objs = L.terrainMeshes ? L.terrainMeshes() : (L.terrainGroup ? L.terrainGroup.children : []); const hits = ray.intersectObjects(objs, true); if (!hits.length) return; const p = hits[0].point;
    if (placing) { pinAim = [p.x, p.z]; return; }
    if (P.mount) return; if (L.ground(p.x, p.z) > -.6 || pow('lirio')) { walkTo = [p.x, p.z]; burst(p.x, p.y + .2, p.z, 6, [.8, 1, .9], 1, { life: .5 }); }
  }
  // hold buttons
  function holdBtn(el, fn, every) { let h = null; el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); clearInterval(h); if (every) h = setInterval(fn, every); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, () => clearInterval(h))); }
  const flyBtn = { up: false, down: false };
  function pressBtn(el, key) { el.addEventListener('pointerdown', e => { e.preventDefault(); flyBtn[key] = true; if (key === 'jump') jumpQ = true; }); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, () => { flyBtn[key] = false; })); }

  // ================================================================ camera wrapper
  function camTarget() {
    if (P.mount) { const c = P.mount; const big = c.S.k === 'dragao' ? 9 : c.S.k === 'grifo' ? 5 : 2; return { x: c.x, y: c.y + c.hipH() * 1.2, z: c.z, ry: c.ry, moving: c.v > .5, fast: c.v > 6, far: big + (c.fly ? 6 : 0), h: 1.2 }; }
    return { x: P.x, y: P.y, z: P.z, ry: P.ry, moving: P.speed > .5, fast: P.speed > 5.5, h: P.swim > .5 ? .5 : 1.55 };
  }

  // ================================================================ day / night
  const DAY_LEN = 960; const DBG = { toff: 0 }; L.DBG = DBG;
  const K = { night: { top: C(0x0b1437), hor: C(0x222f66), hs: C(0x4d62a8), hg: C(0x161b30), sun: C(0x9db2ff), fog: C(0x1b2550) }, dusk: { top: C(0x3a3f8c), hor: C(0xff9a6b), hs: C(0xffb38a), hg: C(0x4a3a3a), sun: C(0xffa060), fog: C(0xe9a584) }, day: { top: C(0x2468d2), hor: C(0x93c8ea), hs: C(0xcfe4ff), hg: C(0x5d7c3a), sun: C(0xfff1d8), fog: C(0x93c8ea) } };
  function mix3(a, b, c, wa, wb, wc, out) { out.setRGB(a.r * wa + b.r * wb + c.r * wc, a.g * wa + b.g * wb + c.g * wc, a.b * wa + b.b * wb + c.b * wc); return out; }
  L.NIGHT = 0; const _sd = new THREE.Vector3(), _md = new THREE.Vector3(); let clockTxt = '';
  function dayCycle() {
    const ph = (((now() + DBG.toff) / 1000 / DAY_LEN) + .3) % 1; const a = (ph - .25) * TAU; const sh = Math.sin(a);
    _sd.set(Math.cos(a), sh, .4).normalize(); _md.copy(_sd).multiplyScalar(-1); _md.z = .4; _md.normalize();
    const wd = sstep(-.05, .35, sh), wn = sstep(.05, -.25, sh), wk = Math.max(0, 1 - wd - wn); const tot = wd + wn + wk;
    const night = wn / tot, day = wd / tot, dusk = wk / tot; L.NIGHT = night;
    const owl = pow('olhos') ? .55 : 1;
    const U = L.skyU; mix3(K.night.top, K.dusk.top, K.day.top, night, dusk, day, U.top.value); mix3(K.night.hor, K.dusk.hor, K.day.hor, night, dusk, day, U.hor.value);
    U.sunDir.value.copy(_sd); U.moonDir.value.copy(_md); U.night.value = night; U.dusk.value = dusk; U.cloudCol.value.setRGB(1, 1, 1).lerp(C(0xffd0b0), dusk).lerp(C(0x7f8fb8), night); U.cloudShade.value.copy(U.hor.value).lerp(C(0x6a7aa8), .4);
    L.scene.fog.color.copy(U.hor.value).lerp(K.night.fog, night * .5); L.scene.fog.density = .0006 + night * .0006 + dusk * .0002;
    if (L.cloudMats) for (const m of L.cloudMats) { if (m.color) m.color.copy(U.cloudCol.value); if (m.opacity != null) m.opacity = .97 - night * .45; }
    const hemi = L.hemi, sun = L.sun; mix3(K.night.hs, K.dusk.hs, K.day.hs, night, dusk, day, hemi.color); mix3(K.night.hg, K.dusk.hg, K.day.hg, night, dusk, day, hemi.groundColor); hemi.intensity = (.2 + day * .38 + dusk * .22) * (night > .5 ? (1 + (1 - owl) * 1.4) : 1);
    mix3(K.night.sun, K.dusk.sun, K.day.sun, night, dusk, day, sun.color); sun.intensity = day * 1.3 + dusk * .85 + night * (.22 * (2 - owl));
    const ld = sh > -.08 ? _sd : _md; const cx = started ? P.x : L.camera.position.x, cy = started ? P.y : 0, cz = started ? P.z : L.camera.position.z;
    sun.position.set(cx + ld.x * 150, cy + Math.max(ld.y, .2) * 150, cz + ld.z * 150); sun.target.position.set(cx, cy, cz); sun.target.updateMatrixWorld();
    L.stars.material.uniforms.uA.value = night * .95;
    const W = L.waterU; if (W) { W.uDay.value = .12 + day * .88 + dusk * .5; W.uSky.value.copy(U.hor.value); W.uSun.value.copy(sun.color).multiplyScalar(day + dusk * .8 + night * .35); W.uSunDir.value.copy(ld); }
    if (L.flowMat && L.flowMat.uniforms) { if (L.flowMat.uniforms.uDay) L.flowMat.uniforms.uDay.value = .35 + day * .65 + dusk * .4; if (L.flowMat.uniforms.uSky) L.flowMat.uniforms.uSky.value.copy(U.hor.value); }
    const MAT = L.MAT; if (MAT.mushCap) MAT.mushCap.emissiveIntensity = .15 + night * 1.6; if (MAT.crystal) MAT.crystal.emissiveIntensity = .5 + night * 1.4; if (MAT.ore) MAT.ore.emissiveIntensity = .3 + night * .6;
    MAT.glow.color.setScalar(1.6 + night * 1.2); MAT.glowSkin.color.setScalar(1.6 + night * 1.2);
    if (L.grade) L.grade.uniforms.uNight.value = night; if (L.bloom) L.bloom.strength = .32 + night * .3;
    L.renderer.toneMappingExposure = 1.0 - night * .18;
    const hr = ph * 24, hh = Math.floor(hr), mm = Math.floor((hr - hh) * 6) * 10; const txt = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    if (txt !== clockTxt) { clockTxt = txt; $('#ct').textContent = txt; $('#ci').textContent = night > .5 ? '🌙' : dusk > .5 ? '🌅' : '☀️'; }
  }

  // ================================================================ interaction: targets & actions
  let target = null, altTarget = null; const hits = {};
  const RES_INFO = {
    tree: { ic: '🪓', lb: 'Cortar', tool: 'axe' }, rock: { ic: '⛏️', lb: 'Quebrar', tool: 'pickaxe' }, ore: { ic: '⛏️', lb: 'Minerar', tool: 'pickaxe', need: true }, crystal: { ic: '💎', lb: 'Extrair', tool: 'pickaxe', need: true },
    bush: { ic: '🫐', lb: 'Colher' }, fibra: { ic: '🌾', lb: 'Colher fibra' }, fibra1: { ic: '🌾', lb: 'Colher fibra' }, mush: { ic: '🍄', lb: 'Colher' },
  };
  function hitsNeeded(it) { const k = it.kindRes; const tl = RES_INFO[k] && RES_INFO[k].tool; const tier = tl ? (TOOLS[tl] || 0) : 0; if (k === 'tree') return tier > 1 ? 2 : tier ? 3 : 5; if (k === 'rock') return tier > 1 ? 2 : tier ? 3 : 5; if (k === 'ore' || k === 'crystal') return tier > 1 ? 3 : 4; return 1; }
  function findTarget() {
    let best = null, bd = 3.2 * 3.2; const fx = Math.sin(P.ry), fz = Math.cos(P.ry);
    const consider = (o, x, z, r, y) => { if (y != null && Math.abs(y - P.y) > 3) return; const d = dist2(x, z, P.x, P.z) - (r || 0); const ahead = ((x - P.x) * fx + (z - P.z) * fz) > -.6; const dd = ahead ? d : d * 1.8; if (dd < bd) { bd = dd; best = o; } };
    L.nearby(P.x, P.z, 6, it => { if (!it.kindRes || it.kindRes === 'none') return; if (it.gone && it.kindRes !== 'bush') return; const r = it.r || .6; consider({ kind: 'res', it }, it.x, it.z, r * r * .6, it.y); });
    const c = L.crNearest(P.x, P.z, 4.2, q => !q.mounted && (q.wild || q.owner === PID)); if (c) consider({ kind: 'cr', c }, c.x, c.z, 1.2 + c.S.R * c.S.R * 4);
    const b = L.buildNearest(P.x, P.y + 1, P.z, 3.4, q => !!L.BUILD.ITEMS[q.t] || q.t === 'door' || q.t === 'gate'); if (b && actionable(b.rec)) consider({ kind: 'b', id: b.id, rec: b.rec }, b.rec.x, b.rec.z, 1.4);
    for (const p of L.PORTALS || []) if (Math.hypot(p.x - P.x, p.z - P.z) < 4 && Math.abs(p.y - P.y) < 4) consider({ kind: 'portal', p }, p.x, p.z, 4);
    altTarget = null; if (!placing) { const d = L.buildNearest(P.x, P.y + 1, P.z, 3.6); if (d) altTarget = d; }
    return best;
  }
  const actionable = r => ['fogueira', 'bancada', 'forja', 'bigorna', 'caldeirao', 'bau', 'cama', 'canteiro', 'door', 'gate', 'lanterna'].includes(r.t);
  function plantStage(p) { if (!p) return -1; const k = p.hoe ? .5 : 1; const e = (now() - p.at) / 1000; return e < PLANT_T[0] * k ? 0 : e < PLANT_T[1] * k ? 1 : 2; }
  function actionInfo(t) {
    if (P.mount) return { ic: '⬇️', lb: 'Descer' };
    if (!t) return null;
    if (t.kind === 'res') {
      const it = t.it, R = RES_INFO[it.kindRes]; if (!R) return null; if (it.kindRes === 'bush' && it.gone) return { ic: '🫐', lb: 'Brotando…', wait: true };
      if (R.need && !TOOLS[R.tool]) return { ic: R.ic, lb: R.lb, sub: 'precisa de picareta', wait: true };
      return { ic: R.ic, lb: R.lb, p: (hits[it.id] || 0) / hitsNeeded(it), sub: R.tool && !TOOLS[R.tool] ? 'sem ferramenta' : '' };
    }
    if (t.kind === 'cr') {
      const c = t.c, S = c.S;
      if (c.owner === PID) return S.mount ? { ic: '🐾', lb: 'Montar ' + (c.name || S.nome), sub: '' } : { ic: '💛', lb: 'Carinho', sub: c.name || S.nome };
      const F = ITEM[S.food]; return { ic: S.ic, lb: `Alimentar ${c.aff || 0}/${S.cost}`, sub: `${F.ic} ${S.nome}`, p: (c.aff || 0) / S.cost, need: S.food };
    }
    if (t.kind === 'portal') return { ic: '🌀', lb: t.p.nome.length > 14 ? 'Viajar' : t.p.nome, sub: t.p.nome };
    if (t.kind === 'b') {
      const r = t.rec;
      if (r.t === 'door' || r.t === 'gate') return { ic: '🚪', lb: r.o ? 'Fechar' : 'Abrir' };
      if (r.t === 'fogueira') return r.lit ? { ic: '💨', lb: 'Apagar' } : { ic: '🔥', lb: 'Acender', sub: pow('chama') ? 'Chama' : '1🪵' };
      if (r.t === 'forja' || r.t === 'caldeirao') return r.lit ? { ic: r.t === 'forja' ? '🔩' : '🧪', lb: r.t === 'forja' ? 'Forjar' : 'Poções' } : { ic: '🔥', lb: 'Acender', sub: pow('chama') ? 'Chama' : '2🪵' };
      if (r.t === 'bancada' || r.t === 'bigorna') return { ic: '🛠️', lb: 'Criar', sub: L.BUILD.ITEMS[r.t].nome };
      if (r.t === 'bau') return { ic: '📦', lb: 'Abrir baú' };
      if (r.t === 'cama') return { ic: '🛏️', lb: 'Descansar', sub: 'renascer aqui' };
      if (r.t === 'lanterna') return { ic: '🏮', lb: r.off ? 'Ligar' : 'Desligar' };
      if (r.t === 'canteiro') { const st = plantStage(r.plant); if (st < 0) return { ic: '🌱', lb: 'Plantar', sub: '1🌱' }; if (st < 2) return { ic: '⏳', lb: st === 0 ? 'Brotando…' : 'Crescendo…', wait: true }; return { ic: '🎃', lb: 'Colher' }; }
    }
    return null;
  }
  let actCool = 0;
  function doAction() {
    if (!started || placing || performance.now() < actCool) return;
    if (P.mount) { dismount(); return; }
    const t = target; const info = actionInfo(t); if (!info || info.wait) return; actCool = performance.now() + 330;
    const tx = t.kind === 'res' ? t.it.x : t.kind === 'cr' ? t.c.x : t.kind === 'b' ? t.rec.x : t.p.x, tz = t.kind === 'res' ? t.it.z : t.kind === 'cr' ? t.c.z : t.kind === 'b' ? t.rec.z : t.p.z;
    P.ry = Math.atan2(tx - P.x, tz - P.z); walkTo = null;
    const luck = () => (pow('sorte') && Math.random() < .35 ? 2 : 1);
    const act = (kind, dur) => { me.actStamp = now(); me.actKind = kind; presDirty = true; actT = { kind, t0: clockT, dur: dur || .6 }; const tl = L.TOOL_FOR[kind]; if (M) M.setTool(tl && TOOLS[tl] ? tl : (kind === 'cast' ? 'staff' : heldTool())); toolHold = clockT + 2.5; };
    if (t.kind === 'res') {
      const it = t.it, k = it.kindRes, R = RES_INFO[k];
      if (k === 'tree' || k === 'rock' || k === 'ore' || k === 'crystal') {
        act(k === 'tree' ? 'chop' : 'mine'); hits[it.id] = (hits[it.id] || 0) + 1; const need = hitsNeeded(it);
        if (k === 'tree') { sfx('chop'); it.shake = clockT; leafBurst(it.x, it.y + 3.5 * it.s, it.z, it.col || [.4, .7, .3]); chips(it.x, it.y + 1, it.z, [.75, .5, .25]); cam.shake = .06; }
        else if (k === 'crystal') { sfx('crystal'); burst(it.x, it.y + .8, it.z, 14, [.75, .6, 1], 3); }
        else { sfx('mine'); burst(it.x, it.y + .7, it.z, 10, [.9, .9, 1], 3); chips(it.x, it.y + .6, it.z, k === 'ore' ? [.85, .55, .25] : [.6, .6, .68]); cam.shake = .08; }
        if (hits[it.id] >= need) {
          hits[it.id] = 0; Store.set('cut4', it.id, { at: now(), by: PID }); const tier = TOOLS[R.tool] || 0; const strong = pow('forca') ? 2 : 1;
          if (k === 'tree') { fallTree(it); give('madeira', (tier > 1 ? 4 : tier ? 3 : 1) * strong * luck()); if (Math.random() < .3) setTimeout(() => give('fibra', 1), 300); }
          if (k === 'rock') give('pedra', (tier > 1 ? 3 : tier ? 2 : 1) * strong * luck());
          if (k === 'ore') { give('minerio', (tier > 1 ? 3 : 2) * luck()); setTimeout(() => give('pedra', 1), 300); }
          if (k === 'crystal') { give('cristal', (tier > 1 ? 2 : 1) * luck()); burst(it.x, it.y + .8, it.z, 30, [.8, .7, 1], 4); }
        }
      } else {
        act('pick', .7); sfx('pick'); Store.set('cut4', it.id, { at: now(), by: PID });
        if (k === 'bush') { give('frutinhas', (2 + (pow('coleta') ? 1 : 0)) * luck()); if (Math.random() < .45 || pow('coleta')) setTimeout(() => give('sementes', 1), 350); }
        if (k === 'fibra') give('fibra', 3 * luck()); if (k === 'fibra1') give('fibra', 1 * luck());
        if (k === 'mush') { give('cogumelo', (1 + (pow('fucador') ? 1 : 0)) * luck()); }
        if (pow('fucador') && Math.random() < .25) setTimeout(() => give(Math.random() < .5 ? 'cogumelo' : 'sementes', 1), 500);
        leafBurst(it.x, it.y + .6, it.z, [.4, .75, .3]);
      }
      return;
    }
    if (t.kind === 'cr') {
      const c = t.c, S = c.S;
      if (c.owner === PID) { if (S.mount) { mount(c); return; } hearts(c.x, c.y + c.hipH() * 2, c.z); sfx('love'); act('feed'); return; }
      if (!has(S.food)) { toast(`${S.nome} come ${ITEM[S.food].ic} ${ITEM[S.food].n.toLowerCase()}. Você não tem.`); return; }
      INV[S.food]--; saveInv(); renderInv(); act('feed', .8); hearts(c.x, c.y + c.hipH() * 2.2, c.z); sfx('love');
      const res = L.crFeed(c, clockT);
      if (res === 'tamed') {
        const nm = L.petName(Math.floor(Math.random() * 1000)); Store.set('tames4', c.id, { o: PID, n: me.name, ty: c.sp, nm, f: 1, x: +c.x.toFixed(1), z: +c.z.toFixed(1), at: now() });
        sfx('tame'); burst(c.x, c.y + 1, c.z, 60, [1, .85, .4], 4); toast(`Você domou ${S.nome}! Nome: ${nm}. Poder: ${S.pow.nome} (${S.pow.desc}).`, 6000);
        if (S.mount) setTimeout(() => toast(`Toque em ${nm} para montar 🐾`, 4000), 1500);
      } else toast(`${S.nome} gostou! Faltam ${S.cost - c.aff} ${ITEM[S.food].ic}`);
      return;
    }
    if (t.kind === 'portal') { travel(t.p.to[0], t.p.to[1], t.p.to[2], t.p.nome); return; }
    if (t.kind === 'b') {
      const r = Object.assign({}, t.rec), id = t.id;
      if (r.t === 'door' || r.t === 'gate') { r.o = !r.o; Store.set('builds4', id, r); sfx('door'); return; }
      if (r.t === 'fogueira' || r.t === 'forja' || r.t === 'caldeirao') {
        if (r.lit && r.t !== 'fogueira') { openBag(r.t, id); return; }
        if (!r.lit && !pow('chama')) { const n = r.t === 'fogueira' ? 1 : 2; if (!has('madeira', n)) { toast(`Precisa de ${n} 🪵 para acender.`); return; } INV.madeira -= n; saveInv(); renderInv(); }
        r.lit = !r.lit; Store.set('builds4', id, r); sfx(r.lit ? 'fire' : 'pick'); act('cast', .5); return;
      }
      if (r.t === 'bancada' || r.t === 'bigorna') { openBag(r.t, id); return; }
      if (r.t === 'bau') { openChest(id); return; }
      if (r.t === 'lanterna') { r.off = !r.off; Store.set('builds4', id, r); sfx('pick'); return; }
      if (r.t === 'cama') { me.spawn = [r.x, r.y + .6, r.z]; sset('lumiar:spawn4:' + WORLD, me.spawn); toast('Você vai renascer nesta cama 🛏️'); sfx('magic'); return; }
      if (r.t === 'canteiro') {
        const st = plantStage(r.plant);
        if (st < 0) { if (!has('sementes')) { toast('Sem sementes 🌱. Colha frutinhas para achar sementes.'); return; } INV.sementes--; saveInv(); renderInv(); r.plant = { at: now(), by: PID, hoe: !!TOOLS.hoe }; Store.set('builds4', id, r); act('hoe'); sfx('pick'); burst(r.x, r.y + .5, r.z, 12, [.6, 1, .5], 1.5); }
        else if (st === 2) { r.plant = null; Store.set('builds4', id, r); give('abobora', luck()); setTimeout(() => give('sementes', 1 + (Math.random() < .5 ? 1 : 0)), 350); act('pick'); sfx('tame'); }
        return;
      }
    }
  }
  function doAlt() {
    if (!started) return;
    if (P.mount) { dismount(); return; }
    const t = target;
    if (t && t.kind === 'cr' && t.c.owner === PID) { const T = STATE.tames4[t.c.id]; if (!T) return; const f = T.f ? 0 : 1; Store.set('tames4', t.c.id, Object.assign({}, T, { f, x: +t.c.x.toFixed(1), z: +t.c.z.toFixed(1) })); toast(f ? `${T.nm} vai seguir você` : `${T.nm} vai ficar aqui`); sfx('pick'); return; }
    if (altTarget) dismantle(altTarget.id);
  }
  let demolishArm = null;
  function dismantle(id) {
    const b = STATE.builds4[id]; if (!b) return;
    if (!demolishArm || demolishArm.id !== id || performance.now() - demolishArm.t > 2500) { demolishArm = { id, t: performance.now() }; toast('Toque de novo para desmontar 🧹'); return; }
    demolishArm = null; const cost = L.buildCost(b.t, b.tr); Store.del('builds4', id); for (const k in STATE.builds4) if (STATE.builds4[k].host === id) Store.del('builds4', k);
    for (const k in cost) { const n = Math.ceil(cost[k] / 2); if (n) give(k, n, true); } floatText('♻️ ' + costTxt(Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Math.ceil(v / 2)]))));
    sfx('build'); burst(b.x, b.y + 1, b.z, 16, [1, .9, .6], 2.5);
  }
  // falling tree animation (a 1-instance copy of the scatter tree)
  const falling = [];
  function fallTree(it) {
    const parts = L.treeGeo[it.kind]; if (!parts) return; const g = new THREE.Group();
    for (const p of ['bark', 'canopy']) { if (!parts[p]) continue; const mat = p === 'canopy' ? (L.FOL && L.FOL.def) : L.MAT.bark; if (!mat) continue; const m = new THREE.InstancedMesh(parts[p], mat, 1); m.setMatrixAt(0, new THREE.Matrix4()); if (p === 'canopy') { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(it.col || [1, 1, 1]), 3); } m.castShadow = true; g.add(m); }
    g.position.set(it.x, it.y, it.z); g.scale.setScalar(it.s); g.rotation.order = 'YXZ'; g.rotation.y = Math.atan2(it.x - P.x, it.z - P.z); L.scene.add(g); falling.push({ g, t: 0, s: it.s });
  }
  // ---- mounts
  function mount(c) {
    if (!c.S.mount || !c.I) return; P.mount = c; c.mounted = true; c.state = 'ride'; c.v = 0; presDirty = true; sfx('tame');
    $('#flyUp').hidden = $('#flyDn').hidden = !c.S.mount.fly; toast(c.S.mount.fly ? `Montado em ${c.name || c.S.nome}! ⬆ para voar, ⬇ para descer.` : `Montado em ${c.name || c.S.nome}! Joystick todo para galopar.`, 3500);
    cam.tdist = Math.max(cam.tdist, 7);
  }
  function dismount() {
    const c = P.mount; if (!c) return; if (c.fly) { toast('Pouse primeiro (⬇)'); return; }
    P.mount = null; c.mounted = false; c.state = 'idle'; c.timer = 2; c.v = 0;
    const sx = c.x + Math.cos(c.ry) * 1.6, sz = c.z - Math.sin(c.ry) * 1.6; P.x = sx; P.z = sz; P.y = L.groundAt(sx, sz, c.y + 2, 3).y; P.vx = P.vz = P.vy = 0; P.ry = c.ry;
    $('#flyUp').hidden = $('#flyDn').hidden = true; presDirty = true;
    const T = STATE.tames4[c.id]; if (T) Store.set('tames4', c.id, Object.assign({}, T, { x: +c.x.toFixed(1), z: +c.z.toFixed(1) }));
  }
  // ---- travel (portals, map)
  function travel(x, y, z, nome) {
    if (P.mount) dismount(); if (P.mount) return; burst(P.x, P.y + 1, P.z, 50, [.7, .85, 1], 4); sfx('travel');
    P.x = x; P.z = z; P.y = y != null ? y : L.ground(x, z) + .5; P.vx = P.vy = P.vz = 0; walkTo = null; L.grassUpdate(P.x, P.z, true);
    setTimeout(() => burst(P.x, P.y + 1, P.z, 50, [.7, .85, 1], 4), 60); if (nome) toast('✨ ' + nome); cam.yaw = cam.tyaw; presDirty = true;
    // follow-mode pets come along
    for (const c of L.CRS) if (c.pet && c.owner === PID && c.pet.f) { const a = Math.random() * TAU; c.x = x + Math.cos(a) * 3; c.z = z + Math.sin(a) * 3; c.y = L.ground(c.x, c.z); c.fly = 0; }
  }

  // ================================================================ build mode
  let placing = null; let buildTab = 'est', buildTier = sget('lumiar:tier4', 'madeira');
  const BUILD_TABS = [['est', 'Estrutura'], ['sta', 'Estações'], ['casa', 'Casa'], ['faz', 'Fazenda']];
  function toggleBuild() { if (placing) { cancelPlace(); return; } const m = $('#bmenu'); const open = m.hidden; closePanels(); m.hidden = !open; if (open) renderBuild(); }
  function discount() { return (pow('construtor') ? .3 : 0) + (TOOLS.hammer ? .2 : 0); }
  function renderBuild() {
    $('#bTabs').innerHTML = BUILD_TABS.map(([k, n]) => `<button class="tab${buildTab === k ? ' on' : ''}" data-k="${k}">${n}</button>`).join('');
    $('#bTabs').querySelectorAll('button').forEach(b => b.onclick = () => { buildTab = b.dataset.k; renderBuild(); });
    const tiers = $('#bTiers'); tiers.hidden = buildTab !== 'est';
    tiers.innerHTML = Object.entries(L.BUILD.TIERS).map(([k, T]) => `<button class="tier${buildTier === k ? ' on' : ''}" data-k="${k}" ${L.buildTierOK(k) ? '' : 'disabled'}>${T.ic} ${T.nome}</button>`).join('');
    tiers.querySelectorAll('button').forEach(b => b.onclick = () => { buildTier = b.dataset.k; sset('lumiar:tier4', buildTier); renderBuild(); });
    let list = [];
    if (buildTab === 'est') list = Object.entries(L.BUILD.PIECES).map(([k, Pc]) => ({ k, n: Pc.nome, d: Pc.desc || '', cost: L.buildCost(k, buildTier, discount()), ok: L.buildTierOK(buildTier) }));
    else { const cat = { sta: 'est', casa: 'casa', faz: 'faz' }[buildTab]; list = Object.entries(L.BUILD.ITEMS).filter(([k, I]) => I.cat === cat).map(([k, I]) => ({ k, n: I.nome, d: I.desc || '', cost: L.buildCost(k, null, discount()), ok: L.buildItemOK(k) })); }
    $('#bGrid').innerHTML = list.map(o => `<button class="bitem${canPay(o.cost) ? '' : ' poor'}" data-k="${o.k}" ${o.ok ? '' : 'disabled'}><span class="bn">${esc(o.n)}</span><span class="bd">${esc(o.d)}</span><span class="bc">${costTxt(o.cost)}</span></button>`).join('');
    $('#bGrid').querySelectorAll('button').forEach(b => b.onclick = () => startPlace(b.dataset.k, buildTab === 'est' ? buildTier : null));
  }
  function startPlace(t, tr) { $('#bmenu').hidden = true; placing = { t, tr, rot: 0, lv: 0, dist: 4.2, cand: null }; pinAim = null; $('#place').hidden = false; document.body.classList.add('placing'); updatePlaceBar(); const Pc = L.BUILD.PIECES[t]; hint(Pc ? (t === 'foundation' ? 'Ande ou toque no chão para posicionar. Fundações encaixam umas nas outras.' : 'Mire perto da estrutura: a peça encaixa sozinha.') : 'Ande ou toque no chão para posicionar.'); if (M) M.setTool(TOOLS.hammer ? 'hammer' : heldTool()); }
  function updatePlaceBar() { if (!placing) return; const c = L.buildCost(placing.t, placing.tr, discount()); const Pc = L.BUILD.PIECES[placing.t]; $('#pName').textContent = (Pc ? Pc.nome + ' · ' + L.BUILD.TIERS[placing.tr].nome : L.BUILD.ITEMS[placing.t].nome) + ' · ' + costTxt(c); $('#pUp').hidden = $('#pDn').hidden = !Pc || placing.t === 'foundation' || Pc.cls === 'fence' || Pc.cls === 'door' || Pc.cls === 'gate'; }
  function cancelPlace() { L.buildGhostOff(); placing = null; pinAim = null; $('#place').hidden = true; document.body.classList.remove('placing'); hint(''); }
  function placeRot(d) { if (placing) placing.rot = (placing.rot + d + 24) % 24; }
  function placeLevel(d) { if (placing) placing.lv = clamp(placing.lv + d, -3, 6); }
  function placeAim() {
    if (pinAim) return [pinAim[0], pinAim[1]];
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw); const d = placing.dist; return [P.x + fx * d, P.z + fz * d];
  }
  function updatePlacing() {
    const [ax, az] = placeAim(); const cand = L.buildCandidate(placing.t, placing.tr, ax, P.y + 1.2, az, P.x, P.z, placing.rot, placing.lv); placing.cand = cand;
    const cost = L.buildCost(placing.t, placing.tr, discount()); const pay_ok = canPay(cost);
    L.buildGhost(cand.rec ? { ok: cand.ok && pay_ok, rec: cand.rec } : null, placing.t, placing.tr);
    $('#pOk').disabled = !(cand.ok && pay_ok); hint(cand.ok ? (pay_ok ? (cand.chain ? 'Encaixado na cerca ✓' : 'Toque ✔ para construir') : 'Faltam ' + missTxt(cost)) : (cand.why || 'Posição inválida'));
  }
  function confirmPlace() {
    if (!placing || !placing.cand || !placing.cand.ok) return; const cost = L.buildCost(placing.t, placing.tr, discount()); if (!pay(cost)) { toast('Faltam ' + missTxt(cost)); return; }
    const id = 'b' + now().toString(36) + Math.random().toString(36).slice(2, 5); const rec = L.buildFinalize(id, Object.assign({}, placing.cand.rec)); rec.by = PID; rec.at = now();
    for (const k of ['x', 'y', 'z', 'r', 'fx', 'fz', 'fy', 'fr']) if (typeof rec[k] === 'number') rec[k] = +rec[k].toFixed(3);
    Store.set('builds4', id, rec); sfx('build'); burst(rec.x, rec.y + 1, rec.z, 18, [1, .85, .5], 2.5); actT = { kind: 'build', t0: clockT, dur: .6 }; me.actStamp = now(); me.actKind = 'build'; presDirty = true;
    L.grassInvalidate(rec.x, rec.z, 3); updatePlaceBar();
  }

  // ================================================================ bag / crafting / chest panels
  let bagOpen = false, bagStation = 'mao', bagStationId = null, chestOpen = null, mapOpen = false;
  function closePanels() { L.chestOpenId = null; $('#bag').hidden = true; bagOpen = false; $('#chest').hidden = true; chestOpen = null; $('#bmenu').hidden = true; $('#map').hidden = true; mapOpen = false; }
  function toggleBag() { if (bagOpen) { closePanels(); return; } openBag('mao'); }
  function openBag(st, id) { closePanels(); bagOpen = true; bagStation = st || 'mao'; bagStationId = id || null; $('#bag').hidden = false; renderBag(); }
  function renderBag() {
    const inv = BASE_ITEMS.map(k => `<div class="slot${INV[k] ? '' : ' empty'}" title="${ITEM[k].n}"><span class="si">${ITEM[k].ic}</span><b>${INV[k] || 0}</b><small>${ITEM[k].n}</small></div>`).join('');
    const pots = Object.keys(ITEM).filter(k => ITEM[k].pot).map(k => `<button class="slot pot${INV[k] ? '' : ' empty'}" data-p="${k}" ${INV[k] ? '' : 'disabled'} title="${esc(ITEM[k].pot.desc)}"><span class="si">${ITEM[k].ic}</span><b>${INV[k] || 0}</b><small>${ITEM[k].n}</small></button>`).join('');
    const tools = Object.keys(TOOL).map(k => `<div class="slot tool${TOOLS[k] ? '' : ' empty'}"><span class="si">${TOOL[k].ic}</span><b>${TOOLS[k] ? (TOOLS[k] > 1 ? 'ferro' : 'pedra') : '—'}</b><small>${TOOL[k].n}</small></div>`).join('');
    $('#bagInv').innerHTML = inv; $('#bagPots').innerHTML = pots; $('#bagTools').innerHTML = tools;
    $('#bagPots').querySelectorAll('button').forEach(b => b.onclick = () => drink(b.dataset.p));
    const st = bagStation; $('#craftTitle').textContent = 'Criar · ' + STATION_NAME[st];
    const rec = STATE.builds4[bagStationId]; const lit = !rec || rec.lit || pow('chama');
    const list = RECIPES.filter(r => r.w === st || (st !== 'mao' && r.w === 'mao'));
    $('#craft').innerHTML = list.map(r => { const owned = r.tool && (TOOLS[r.tool[0]] || 0) >= r.tool[1]; const ok = canPay(r.cost) && !owned && (!r.lit || lit); return `<button class="bitem${ok ? '' : ' poor'}" data-r="${r.id}" ${ok ? '' : 'disabled'}><span class="bn">${r.ic} ${esc(r.n)}</span><span class="bd">${esc(owned ? 'você já tem' : r.desc || '')}</span><span class="bc">${costTxt(r.cost)}</span></button>`; }).join('') + (st === 'mao' ? '<div class="note">Bancada, forja, bigorna e caldeirão (🔨 Estações) liberam mais receitas.</div>' : '');
    $('#craft').querySelectorAll('button').forEach(b => b.onclick = () => craft(b.dataset.r));
  }
  function craft(id) {
    const r = RECIPES.find(q => q.id === id); if (!r || !pay(r.cost)) return;
    if (r.tool) { TOOLS[r.tool[0]] = Math.max(TOOLS[r.tool[0]] || 0, r.tool[1]); saveInv(); toast(`${r.ic} ${r.n} pronto!`); if (M) M.setTool(r.tool[0]); toolHold = clockT + 3; }
    if (r.give) for (const k in r.give) give(k, r.give[k], true);
    sfx(r.w === 'forja' ? 'smelt' : r.w === 'caldeirao' ? 'magic' : 'craft'); actT = { kind: r.w === 'caldeirao' ? 'cast' : 'build', t0: clockT, dur: .6 }; const st = STATE.builds4[bagStationId];
    if (st) burst(st.x, st.y + 1, st.z, 20, r.w === 'caldeirao' ? [.7, .5, 1] : [1, .7, .3], 2); renderBag(); renderInv();
  }
  function drink(k) {
    if (!has(k)) return; INV[k]--; saveInv(); renderInv(); const I = ITEM[k]; me.pot[k] = now() + I.pot.dur * 1000; presDirty = true; renderPowers(); burst(P.x, P.y + 1, P.z, 50, [.7, .6, 1], 4); sfx('magic'); toast(`${I.ic} ${I.n}: ${I.pot.desc}!`); if (bagOpen) renderBag();
  }
  function openChest(id) { closePanels(); chestOpen = id; L.chestOpenId = id; $('#chest').hidden = false; renderChest(); }
  function chestItems() { const c = STATE.chest4[chestOpen]; return Object.assign({}, c && c.items); }
  function renderChest() {
    const ci = chestItems();
    $('#chestIn').innerHTML = BASE_ITEMS.concat(Object.keys(ITEM).filter(k => ITEM[k].pot)).filter(k => ci[k]).map(k => `<button class="slot" data-k="${k}"><span class="si">${ITEM[k].ic}</span><b>${ci[k]}</b><small>${ITEM[k].n}</small></button>`).join('') || '<div class="note">Vazio. Toque nos seus itens para guardar.</div>';
    $('#chestMine').innerHTML = BASE_ITEMS.concat(Object.keys(ITEM).filter(k => ITEM[k].pot)).filter(k => INV[k]).map(k => `<button class="slot" data-k="${k}"><span class="si">${ITEM[k].ic}</span><b>${INV[k]}</b><small>${ITEM[k].n}</small></button>`).join('') || '<div class="note">Sua bolsa está vazia.</div>';
    $('#chestIn').querySelectorAll('button').forEach(b => b.onclick = () => moveChest(b.dataset.k, -1));
    $('#chestMine').querySelectorAll('button').forEach(b => b.onclick = () => moveChest(b.dataset.k, 1));
  }
  function moveChest(k, dir) {
    const ci = chestItems(); const n = dir > 0 ? Math.min(INV[k] || 0, 10) : Math.min(ci[k] || 0, 10); if (!n) return;
    if (dir > 0) { INV[k] -= n; ci[k] = (ci[k] || 0) + n; } else { ci[k] -= n; if (!ci[k]) delete ci[k]; INV[k] = (INV[k] || 0) + n; }
    saveInv(); Store.set('chest4', chestOpen, { items: ci, at: now() }); renderChest(); renderInv(); sfx('pick');
  }

  // ================================================================ map & discovery
  let mapView = { cx: 0, cz: 0, zoom: .25 }, way = sget('lumiar:way4', null), lastFogSave = 0;
  function poisList() { return L.POI.map(p => ({ id: p.id, x: p.x, z: p.z, ic: p.ic, nome: p.nome, known: !!STATE.disc4[p.id] || p.always })); }
  function mapData() {
    const others = []; for (const r of L.REMOTE.values()) others.push({ x: r.x, z: r.z, c: '#' + L.MAGE_COLORS[r.ci].robe.toString(16).padStart(6, '0'), label: r.nm });
    const pets = L.CRS.filter(c => c.pet && c.owner === PID).map(c => ({ x: c.x, z: c.z }));
    const dots = [];
    if (pow('faro')) L.nearby(P.x, P.z, 160, it => { if ((it.kindRes === 'ore' || it.kindRes === 'crystal') && !it.gone) dots.push({ x: it.x, z: it.z, c: it.kindRes === 'ore' ? '#ffb347' : '#c9a6ff' }); });
    if (pow('lua')) for (const c of L.crRare()) dots.push({ x: c.x, z: c.z, c: '#9fe8ff', r: 3.5 });
    return { x: P.x, z: P.z, ry: P.mount ? P.mount.ry : P.ry, others, pets, pois: poisList(), way, dots };
  }
  function toggleMap() { if (mapOpen) { closePanels(); return; } closePanels(); mapOpen = true; $('#map').hidden = false; const c = $('#mapCv'); const r = c.getBoundingClientRect(); c.width = Math.round(r.width * Math.min(2, devicePixelRatio || 1)); c.height = Math.round(r.height * Math.min(2, devicePixelRatio || 1)); mapView = { cx: P.x, cz: P.z, zoom: c.width / 1400 }; drawMap(); renderTravel(); }
  let mapXf = null;
  function drawMap() { if (!mapOpen) return; mapXf = L.drawWorldMap($('#mapCv'), mapData(), mapView); }
  function renderTravel() {
    const list = poisList().filter(p => p.known); const el = $('#travel');
    el.innerHTML = '<div class="tt">Viajar para</div>' + list.map(p => `<button class="trv" data-id="${p.id}">${p.ic} ${esc(p.nome)}</button>`).join('') + [...L.REMOTE.values()].map(r => `<button class="trv" data-peer="${esc(r.peer)}">🧙 ${esc(r.nm)}</button>`).join('') + (me.spawn ? '<button class="trv" data-bed="1">🛏️ Minha cama</button>' : '') + (way ? '<button class="trv" data-clear="1">✖ Tirar marcador</button>' : '');
    el.querySelectorAll('button').forEach(b => b.onclick = () => {
      if (b.dataset.clear) { way = null; sset('lumiar:way4', null); drawMap(); renderTravel(); return; }
      let x, z, y = null, nome; if (b.dataset.id) { const p = L.POI.find(q => q.id === b.dataset.id); const s = p.id === 'castelo' ? (L.PORTALS.find(q => q.id === 'castelo_up') || p) : p; [x, z] = L.findLand(s.x + 6, s.z + 6, .8, 400, .9); nome = p.nome; }
      else if (b.dataset.peer) { const r = L.REMOTE.get(b.dataset.peer); if (!r) return; x = r.x + 2; z = r.z + 2; y = r.y + .5; nome = 'Junto de ' + r.nm; }
      else if (b.dataset.bed) { [x, y, z] = me.spawn; nome = 'Sua cama'; }
      closePanels(); travel(x, y, z, nome);
    });
  }
  { // map gestures: drag to pan, pinch / wheel to zoom, tap to place a waypoint
    const mc = $('#mapCv'); const mp = new Map(); let mpinch = 0;
    mc.addEventListener('pointerdown', e => { mp.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() }); mc.setPointerCapture(e.pointerId); if (mp.size === 2) { const [a, b] = [...mp.values()]; mpinch = Math.hypot(a.x - b.x, a.y - b.y); } });
    mc.addEventListener('pointermove', e => { const p = mp.get(e.pointerId); if (!p) return; const k = mc.width / mc.getBoundingClientRect().width; if (mp.size === 1) { mapView.cx -= (e.clientX - p.x) * k / mapView.zoom; mapView.cz -= (e.clientY - p.y) * k / mapView.zoom; } else if (mp.size === 2) { const [a, b] = [...mp.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (mpinch) mapView.zoom = clamp(mapView.zoom * d / mpinch, .08, 2); mpinch = d; } p.x = e.clientX; p.y = e.clientY; drawMap(); });
    const up = e => { const p = mp.get(e.pointerId); mp.delete(e.pointerId); mpinch = 0; if (p && performance.now() - p.t < 260 && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 8 && mapXf) { const r = mc.getBoundingClientRect(), k = mc.width / r.width; const wx = mapXf.wx0 + (e.clientX - r.left) * k / mapXf.z, wz = mapXf.wz0 + (e.clientY - r.top) * k / mapXf.z; way = [Math.round(wx), Math.round(wz)]; sset('lumiar:way4', way); drawMap(); renderTravel(); sfx('pick'); } };
    mc.addEventListener('pointerup', up); mc.addEventListener('pointercancel', up);
    mc.addEventListener('wheel', e => { mapView.zoom = clamp(mapView.zoom * (1 - e.deltaY * .001), .08, 2); drawMap(); }, { passive: true });
  }
  function discover() {
    for (const p of L.POI) { if (STATE.disc4[p.id]) continue; const d = Math.hypot(p.x - P.x, p.z - P.z); if (d < 70 && (p.fly == null || Math.abs(P.y - (L.ground(p.x, p.z) + p.fly)) < 60 || d < 30)) { Store.set('disc4', p.id, { by: PID, n: me.name, at: now() }); toast(`${p.ic} Descoberto: ${p.nome}!`, 4500); sfx('discover'); burst(P.x, P.y + 2, P.z, 40, [1, .9, .5], 3); } }
  }
  // waypoint beacon in the world
  let beacon = null;
  function updateBeacon(t) {
    if (!way) { if (beacon) beacon.visible = false; return; }
    if (!beacon) { beacon = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 140, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7ab8, transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); m.position.y = 70; beacon.add(m); const gl = L.glowSprite(0xff9ac8, 9, .8); gl.position.y = 2; beacon.add(gl); L.scene.add(beacon); }
    beacon.visible = true; beacon.position.set(way[0], L.ground(way[0], way[1]), way[1]); beacon.children[0].material.opacity = .25 + Math.sin(t * 3) * .08;
    if (Math.hypot(way[0] - P.x, way[1] - P.z) < 8) { way = null; sset('lumiar:way4', null); toast('Você chegou ao marcador 📍'); sfx('pick'); }
  }

  // ================================================================ audio
  let AC = null, MASTER = null, muted = sget('lumiar:mute', false), amb = {};
  function initAudio() {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)(); MASTER = AC.createGain(); MASTER.gain.value = muted ? 0 : .8; MASTER.connect(AC.destination);
      const len = AC.sampleRate * 3, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0); let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
      const mk = (f, type, q) => { const s = AC.createBufferSource(); s.buffer = buf; s.loop = true; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q || .7; const g = AC.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(MASTER); s.start(); return g; };
      amb.wind = mk(400, 'lowpass'); amb.water = mk(1400, 'bandpass', .5); amb.fire = mk(900, 'highpass'); amb.sea = mk(600, 'lowpass', .4);
      const wn = AC.createBuffer(1, AC.sampleRate * .4, AC.sampleRate), wd = wn.getChannelData(0); for (let i = 0; i < wd.length; i++) wd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / wd.length, 2); amb.noise = wn;
    } catch (e) { AC = null; }
    $('#snd').textContent = muted ? '🔇' : '🔊';
  }
  $('#snd').onclick = () => { muted = !muted; sset('lumiar:mute', muted); if (MASTER) MASTER.gain.value = muted ? 0 : .8; $('#snd').textContent = muted ? '🔇' : '🔊'; };
  function tone(f, dur, type, vol, f2, delay) { if (!AC || muted) return; const t = AC.currentTime + (delay || 0); const o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || .15, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g); g.connect(MASTER); o.start(t); o.stop(t + dur + .05); }
  function noiseHit(dur, f, vol) { if (!AC || muted) return; const s = AC.createBufferSource(); s.buffer = amb.noise; const fl = AC.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; const g = AC.createGain(); g.gain.value = vol; s.connect(fl); fl.connect(g); g.connect(MASTER); s.start(); s.stop(AC.currentTime + dur); }
  function sfx(k, x, z) {
    if (!AC) return; if (AC.state === 'suspended') AC.resume();
    let v = 1; if (x != null) { const d = Math.hypot(x - P.x, z - P.z); v = clamp(1 - d / 160, 0, 1); if (v <= 0) return; }
    if (k === 'chop') { tone(150, .12, 'triangle', .25, 70); noiseHit(.12, 900, .5); }
    if (k === 'mine') { tone(900, .08, 'square', .06, 600); noiseHit(.1, 3000, .4); }
    if (k === 'crystal') { tone(1200, .3, 'sine', .08, 1800); tone(1600, .35, 'sine', .05, 2400, .08); }
    if (k === 'pick') { tone(660, .1, 'sine', .12); tone(990, .14, 'sine', .1, null, .07); }
    if (k === 'love') { tone(784, .15, 'sine', .1); tone(1046, .25, 'sine', .1, null, .1); }
    if (k === 'tame') { [523, 659, 784, 1046].forEach((f, i) => tone(f, .3, 'triangle', .12, null, i * .09)); }
    if (k === 'build') { tone(220, .1, 'triangle', .25, 140); tone(260, .1, 'triangle', .2, 160, .12); noiseHit(.08, 700, .3); }
    if (k === 'craft') { tone(520, .08, 'square', .05, 400); tone(700, .12, 'triangle', .12, null, .1); }
    if (k === 'smelt') { noiseHit(.5, 500, .5); tone(300, .4, 'sawtooth', .04, 180); tone(1400, .2, 'triangle', .08, null, .3); }
    if (k === 'door') { tone(180, .18, 'triangle', .14, 120); noiseHit(.12, 400, .25); }
    if (k === 'magic') { [880, 1175, 1568, 1760].forEach((f, i) => tone(f, .4, 'sine', .07, null, i * .06)); }
    if (k === 'discover') { [523, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, .5, 'sine', .07, null, i * .1)); }
    if (k === 'travel') { tone(300, .7, 'sine', .1, 1200); tone(450, .7, 'sine', .07, 1800, .1); }
    if (k === 'fire') { noiseHit(.4, 600, .5); }
    if (k === 'jump') { tone(330, .12, 'sine', .05, 520); }
    if (k === 'land') { noiseHit(.12, 300, .35); }
    if (k === 'splash') { noiseHit(.25, 1200, .4); }
    if (k === 'roar') { tone(110 * (.9 + Math.random() * .2), 1.8, 'sawtooth', .07 * v, 55); tone(80, 1.4, 'sawtooth', .05 * v, 45, .3); noiseHit(1.2, 300, .3 * v); }
    if (k === 'howl') { const b = 380 + Math.random() * 60; tone(b, 1.6, 'sine', .06 * v, b * 1.5); tone(b * 1.5, 1.2, 'sine', .04 * v, b * 1.1, 1.4); }
    if (k === 'hoot') { tone(420, .18, 'sine', .07 * v, 380); tone(400, .22, 'sine', .07 * v, 340, .25); }
    if (k === 'croak') { tone(140, .14, 'square', .03 * v, 110); tone(150, .12, 'square', .03 * v, 120, .18); }
  }
  L.sfx = sfx;
  L.crSound = (k, c) => sfx(k, c.x, c.z);
  let birdT = 0, crickT = 0;
  function ambience(dt, night, nearWater, nearFire, nearSea, wind) {
    if (!AC || muted) return; const t = AC.currentTime; amb.wind.gain.setTargetAtTime((.04 + .03 * Math.sin(t * .3)) * (1 + wind * 2.5), t, .5); amb.water.gain.setTargetAtTime(nearWater * .09, t, .4); amb.fire.gain.setTargetAtTime(nearFire * .05, t, .3); amb.sea.gain.setTargetAtTime(nearSea * (.06 + .04 * Math.sin(t * .5)), t, .6);
    if (nearFire > .1 && Math.random() < dt * nearFire * 6) noiseHit(.03, 2500 + Math.random() * 2000, .35 * nearFire);
    birdT -= dt; if (birdT < 0) { birdT = 2 + Math.random() * 5; if (night < .5 && wind < .5) { const b = 2000 + Math.random() * 1500; tone(b, .09, 'sine', .04, b * 1.4); tone(b * 1.2, .1, 'sine', .035, b * .9, .12); if (Math.random() < .5) tone(b, .08, 'sine', .03, b * 1.5, .26); } }
    crickT -= dt; if (crickT < 0) { crickT = .6 + Math.random() * 1.2; if (night > .5) for (let i = 0; i < 3; i++) tone(4300, .04, 'sine', .012 * night, null, i * .07); }
  }

  // ================================================================ light pool
  const POOL = []; for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xff9a40, 0, 14, 1.6); L.scene.add(l); POOL.push(l); }
  const lightOn = () => (L.NIGHT > .25 || P.y < L.ground(P.x, P.z) - 1) && ((M && M.toolName === 'torch') || pow('brilho') || potOn('pocao_luz'));

  // ================================================================ misc
  function emote() { me.emo = now(); presDirty = true; hearts(P.x, P.y + 2.4, P.z); sfx('love'); waveT = clockT; }
  let waveT = -9, actT = null, toolHold = 0;
  function heldTool() { if (L.NIGHT > .5 && TOOLS.torch) return 'torch'; return 'staff'; }
  $('#emo').onclick = emote;
  $('#bld').onclick = toggleBuild; $('#bClose').onclick = () => { $('#bmenu').hidden = true; };
  $('#bagBtn').onclick = toggleBag; $('#bagClose').onclick = closePanels; $('#chestClose').onclick = closePanels; $('#mapClose').onclick = closePanels;
  $('#chestAll').onclick = () => { const ci = chestItems(); for (const k of BASE_ITEMS) if (INV[k]) { ci[k] = (ci[k] || 0) + INV[k]; INV[k] = 0; } saveInv(); Store.set('chest4', chestOpen, { items: ci, at: now() }); renderChest(); renderInv(); sfx('pick'); };
  $('#mini').onclick = toggleMap;
  holdBtn($('#act'), doAction, 340); $('#alt').onclick = doAlt;
  pressBtn($('#jump'), 'jump'); pressBtn($('#flyUp'), 'up'); pressBtn($('#flyDn'), 'down');
  $('#pRotL').onclick = () => placeRot(-1); $('#pRotR').onclick = () => placeRot(1); $('#pUp').onclick = () => placeLevel(1); $('#pDn').onclick = () => placeLevel(-1); $('#pNo').onclick = cancelPlace; $('#pOk').onclick = confirmPlace;
  $('#hlp').onclick = () => { $('#help').hidden = false; }; $('#hClose').onclick = () => { $('#help').hidden = true; };
  $('#qual').onclick = () => { const q = ['alto', 'medio', 'baixo']; const i = (q.indexOf(L.quality) + 1) % 3; L.quality = q[i]; sset('lumiar:q', L.quality); toast('Qualidade: ' + L.quality + ' (recarregando…)'); setTimeout(() => location.reload(), 600); };

  // ================================================================ main loop
  let clockT = 0, last = performance.now(), uiT = 0, cutT = 0, miniT = 0, petSaveT = 0, terrT = 0;
  const _seat = new THREE.Vector3();
  function frame() {
    requestAnimationFrame(frame); const tn = performance.now(); const dt = Math.min(.05, (tn - last) / 1000); last = tn; clockT += dt; const t = clockT;
    dayCycle();
    if (started) {
      // ---- input (camera-relative)
      let ix = joy.vx, iy = joy.vy; if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1; if (keys.KeyW || keys.ArrowUp) iy -= 1; if (keys.KeyS || keys.ArrowDown) iy += 1;
      let il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; il = 1; }
      const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
      let mx = fx * (-iy) - rx * ix, mz = fz * (-iy) - rz * ix; let ml = Math.hypot(mx, mz);
      if (ml < .05 && walkTo && !P.mount) { const dx = walkTo[0] - P.x, dz = walkTo[1] - P.z, d = Math.hypot(dx, dz); if (d < .6) walkTo = null; else { const s = Math.min(.8, d / 3); mx = dx / d * s; mz = dz / d * s; ml = s; } } else if (ml >= .05) walkTo = null;
      const run = keys.ShiftLeft || keys.ShiftRight;
      const inp = { mx, mz, run, jump: jumpQ, jumpHeld: keys.Space || flyBtn.jump, up: flyBtn.up || (P.mount && keys.Space), down: flyBtn.down || (P.mount && (keys.KeyC || keys.ControlLeft)) }; jumpQ = false;
      // ---- move
      if (P.mount) {
        const c = P.mount; if (!c.I || !L.CRBYID.has(c.id)) { P.mount = null; } else {
          L.crRide(c, inp, dt, t); P.x = c.x; P.z = c.z; P.y = c.y; P.speed = c.v; P.ry = c.ry; P.swim = 0; P.air = 0;
        }
      } else {
        const m = mods(); L.playerStep(dt, t, inp, m);
        if (P.swim > .5 && P.speed > .5 && Math.random() < dt * 12) SMOKE.emit({ x: P.x + (Math.random() - .5) * .8, y: .08, z: P.z + (Math.random() - .5) * .8, vx: (Math.random() - .5), vz: (Math.random() - .5), life: 1, s0: .5, s1: 1.4, c: [.9, .97, 1], a: .55 });
        if (P.waterWalk && P.speed > .5 && Math.random() < dt * 8) SMOKE.emit({ x: P.x, y: .08, z: P.z, vx: (Math.random() - .5), vz: (Math.random() - .5), life: .8, s0: .4, s1: 1.2, c: [.9, .97, 1], a: .6 });
        if (!P.wasSwim && P.swim > .5) { sfx('splash'); splash(P.x, P.z, 14); } P.wasSwim = P.swim > .5;
        if (P.glide && Math.random() < dt * 20) FX.emit({ x: P.x + (Math.random() - .5), y: P.y + 1, z: P.z + (Math.random() - .5), vy: .3, life: .6, s0: .3, s1: 0, c: [.8, .9, 1] });
      }
      // ---- player model
      if (M) {
        const R = M.root;
        if (P.mount && P.mount.I) { L.crSeat(P.mount, _seat); R.position.copy(_seat); R.position.y -= M.rig.hipH * .92; R.rotation.set(0, P.mount.ry, 0); }
        else { R.position.set(P.x, P.y - (P.swim > .5 ? .0 : 0), P.z); R.rotation.set(0, P.ry, 0); }
        if (toolHold && t > toolHold && !placing) { toolHold = 0; M.setTool(heldTool()); }
        const act = actT && t - actT.t0 < actT.dur ? actT : null;
        L.animMage4(M, dt, t, { speed: P.mount ? 0 : P.speed, air: P.air, swim: P.swim, ride: P.mount ? 1 : 0, act, now: t, turn: P.turn, wave: t - waveT < 1.6 ? Math.sin((t - waveT) / 1.6 * Math.PI) : 0, rideHz: P.mount ? 2 + P.mount.v * .45 : 6 });
      }
      const pt = potOn('pocao_luz'); if (pt && Math.random() < dt * 16) FX.emit({ x: P.x + (Math.random() - .5), y: P.y + .3 + Math.random() * 1.8, z: P.z + (Math.random() - .5), vy: .8, life: .9, s0: .35, s1: 0, c: [.8, .7, 1] });
      if (DBG.cam) { const C = DBG.cam; const tg = C.follow ? [C.follow.x, C.follow.y + (C.dy || 1), C.follow.z] : C.t; const pp = C.follow ? [tg[0] + C.p[0], tg[1] + C.p[1], tg[2] + C.p[2]] : C.p; L.camera.position.set(pp[0], pp[1], pp[2]); L.camera.lookAt(tg[0], tg[1], tg[2]); } else L.cameraStep(dt, t, camTarget());
      pushPresence(t);
      if (placing) updatePlacing();
      L.grassUpdate(P.x, P.z);
    } else {
      const a = t * .025; const tx = L.SPAWN[0], tz = L.SPAWN[1]; L.camera.position.set(tx + Math.sin(a) * 110, L.ground(tx, tz) + 46, tz + Math.cos(a) * 110); L.camera.lookAt(tx, L.ground(tx, tz) + 6, tz); L.grassUpdate(tx, tz);
    }
    L.camera.updateMatrixWorld();
    // ---- remote players & creatures
    L.remoteStep(dt, t, t);
    L.crUpdate(dt, t, { px: started ? P.x : L.SPAWN[0], py: started ? P.y : 4, pz: started ? P.z : L.SPAWN[1], pv: started ? P.speed : 0, night: L.NIGHT > .5, food: started && target && target.kind === 'cr' ? has(target.c.S.food) : false, sombra: pow('sombra'), owners: ownersMap(), camera: L.camera, shadowR: L.quality === 'baixo' ? 20 : 40, t });
    // ---- world streaming
    terrT += dt; L.terrainUpdate(L.camera.position, started ? 3 : 6); L.scatterUpdate(L.camera, started ? 3 : 6);
    if (!L.mapDone()) L.mapStep(2);
    L.worldUpdate(dt, t); L.worldFx(dt, t, L.camera.position, (x, y, z, k) => SMOKE.emit({ x, y, z, vx: (Math.random() - .5) * 2, vy: -1 - Math.random() * 2, vz: (Math.random() - .5) * 2, life: 3, s0: 4, s1: 10, c: [.92, .97, 1], a: .25 }));
    L.buildTick(dt, t);
    // ---- fires, lights
    const lights = []; let nearFire = 0; const night = L.NIGHT;
    for (const id in STATE.builds4) {
      const b = STATE.builds4[id]; const I = L.BUILD.ITEMS[b.t]; if (!I) continue; const o = L.buildObj(id); if (o && o.userData.glow) o.userData.glow.visible = (I.fire ? !!b.lit : I.light ? !b.off && night > .2 : true);
      if (I.fire && b.lit) {
        const d2c = dist2(b.x, b.z, L.camera.position.x, L.camera.position.z); if (d2c > 160 * 160) continue; const fy = b.y + (b.t === 'forja' ? .9 : b.t === 'caldeirao' ? .25 : .3);
        if (Math.random() < dt * (b.t === 'fogueira' ? 44 : 26)) FX.emit({ x: b.x + (Math.random() - .5) * .5, y: fy, z: b.z + (Math.random() - .5) * .5, vx: (Math.random() - .5) * .3, vy: 1.4 + Math.random(), vz: (Math.random() - .5) * .3, life: .55 + Math.random() * .4, s0: b.t === 'fogueira' ? 1 : .7, s1: .1, c: [1, .55 + Math.random() * .3, .12] });
        if (Math.random() < dt * 6) SMOKE.emit({ x: b.x, y: fy + (b.t === 'forja' ? 1.6 : 1.1), z: b.z, vx: (Math.random() - .5) * .3, vy: 1, vz: (Math.random() - .5) * .3, life: 2.8, s0: .6, s1: 2.4, c: [.3, .3, .35], a: .22 });
        if (b.t === 'caldeirao' && Math.random() < dt * 8) FX.emit({ x: b.x + (Math.random() - .5) * .5, y: b.y + .85, z: b.z + (Math.random() - .5) * .5, vy: .6, life: 1, s0: .4, s1: .1, c: [.6, .4, 1] });
        lights.push({ x: b.x, y: fy + .8, z: b.z, i: 2.2 + Math.sin(t * 17 + b.z) * .3 + Math.sin(t * 7) * .2, c: 0xff8a3a, d: 18 }); nearFire = Math.max(nearFire, 1 - sstep(2, 12, Math.sqrt(dist2(b.x, b.z, P.x, P.z))));
      }
      if (I.light && !b.off && night > .2) lights.push({ x: b.x, y: b.y + 1.4, z: b.z, i: night * 1.6, c: I.light, d: 14 });
    }
    for (const s of L.LIGHTS || []) lights.push({ x: s.x, y: s.y, z: s.z, i: s.i * (s.night ? (1 - s.night) + s.night * night : 1), c: s.c, d: s.d });
    if (started && lightOn()) lights.push({ x: P.x, y: P.y + 2.2, z: P.z, i: 1.6, c: potOn('pocao_luz') ? 0xc9a6ff : pow('brilho') ? 0xb6f7ff : 0xffb060, d: 16, me: true });
    for (const r of L.REMOTE.values()) if (r.pr && r.pr.lt) lights.push({ x: r.x, y: r.y + 2.2, z: r.z, i: 1.4, c: 0xffb060, d: 14 });
    for (const c of L.CRS) if (c.S.glowLight && c.I && c.visibleNow && night > .3) lights.push({ x: c.x, y: c.y + 1, z: c.z, i: .9 * night, c: c.S.glowLight, d: 9 });
    const ox = started ? P.x : L.camera.position.x, oz = started ? P.z : L.camera.position.z;
    lights.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0) || dist2(a.x, a.z, ox, oz) - dist2(b.x, b.z, ox, oz));
    POOL.forEach((l, i) => { const s = lights[i]; if (s && dist2(s.x, s.z, ox, oz) < 140 * 140) { l.position.set(s.x, s.y, s.z); l.intensity = s.i; l.color.set(s.c); l.distance = s.d; } else l.intensity = 0; });
    // ---- tree shake & falling trees, floaters
    L.nearby(P.x, P.z, 8, it => { if (it.shake != null) { const e = t - it.shake; if (e < .6) L.itemMatrix(it, 1, e / .6); else { L.itemMatrix(it, 1); it.shake = null; } } });
    for (let i = falling.length - 1; i >= 0; i--) { const f = falling[i]; f.t += dt; f.g.rotation.x = Math.min(Math.PI / 2, f.t * f.t * 1.8); if (f.t > 1.3 && f.t - dt <= 1.3) { cam.shake = .25; sfx('build'); burst(f.g.position.x, f.g.position.y + .3, f.g.position.z, 12, [.6, .5, .3], 2); } if (f.t > 1.6) { f.g.scale.setScalar(f.s * Math.max(.001, 1 - (f.t - 1.6) * 1.2)); if (f.t > 2.4) { L.scene.remove(f.g); f.g.traverse(m => m.dispose && m.isInstancedMesh && m.dispose()); falling.splice(i, 1); } } }
    for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.t += dt; f.s.position.y += dt * 1.2; f.s.material.opacity = 1 - f.t / 1.3; if (f.t > 1.3) { L.scene.remove(f.s); f.s.material.map.dispose(); f.s.material.dispose(); floaters.splice(i, 1); } }
    // creature particles: fire fox embers, happy hearts
    for (const c of L.CRS) { if (!c.I || !c.visibleNow) continue; if (c.S.embers && Math.random() < dt * 6) FX.emit({ x: c.x + (Math.random() - .5) * .3, y: c.y + c.hipH() * 1.3, z: c.z + (Math.random() - .5) * .3, vy: .7, vx: (Math.random() - .5) * .4, vz: (Math.random() - .5) * .4, life: .7, s0: .25, s1: 0, c: [1, .6, .2] }); if (c.fed && t - c.fed < .1 && Math.random() < .5) HEARTS.emit({ x: c.x, y: c.y + c.hipH() * 2.2, z: c.z, vy: .8, life: 1.4, s0: .35, s1: .45, a: .9 }); }
    // ---- shaders & particles
    FX.update(dt); SMOKE.update(dt); HEARTS.update(dt); LEAVES.update(dt);
    const sc = L.renderer.domElement.height * .5; FX.mat.uniforms.uScale.value = sc; SMOKE.mat.uniforms.uScale.value = sc; HEARTS.mat.uniforms.uScale.value = sc; LEAVES.mat.uniforms.uScale.value = sc;
    FLIES.uniforms.uScale.value = sc; FLIES.uniforms.uT.value = t; FLIES.uniforms.uA.value = night * (L.REG && started ? 1 : .6); FLIES.uniforms.uC.value.set(ox, started ? P.y : 4, oz);
    L.uTime.value = t; L.uPlayer.value.set(started ? P.x : 0, started ? P.y : -999, started ? P.z : 0); if (L.waterU) L.waterU.uTime.value = t; if (L.waterMat && L.waterMat.uniforms && L.waterMat.uniforms.uTime) L.waterMat.uniforms.uTime.value = t; if (L.flowMat && L.flowMat.uniforms && L.flowMat.uniforms.uTime) L.flowMat.uniforms.uTime.value = t; L.skyU.uTime.value = t; L.stars.material.uniforms.uT.value = t; L.tickWind(t);
    L.sky.position.copy(L.camera.position); L.stars.position.copy(L.camera.position); L.tickClouds(L.camera, t);
    // ---- periodic
    cutT -= dt; if (cutT < 0 || cutDirty) { cutT = 1; cutDirty = false; syncCut(ox, oz); }
    uiT -= dt;
    if (started && uiT < 0) {
      uiT = .12; target = findTarget(); const info = actionInfo(target); const ab = $('#act');
      ab.disabled = !info || !!info.wait; $('#aic').textContent = info ? info.ic : '✋'; $('#alb').textContent = info ? info.lb : 'Nada perto'; $('#asb').textContent = info && info.sub ? info.sub : ''; ab.style.setProperty('--p', info && info.p ? (info.p * 100) + '%' : '0%');
      const own = target && target.kind === 'cr' && target.c.owner === PID; const T = own ? STATE.tames4[target.c.id] : null;
      const altBtn = $('#alt'); if (P.mount) { altBtn.hidden = true; } else if (own && T) { altBtn.hidden = false; altBtn.textContent = T.f ? '✋' : '🐾'; altBtn.title = T.f ? 'Ficar aqui' : 'Seguir'; } else if (altTarget && !placing) { altBtn.hidden = false; altBtn.textContent = '🧹'; altBtn.title = 'Desmontar'; } else altBtn.hidden = true;
      for (const k in me.pot) if (me.pot[k] && me.pot[k] < now()) { delete me.pot[k]; presDirty = true; }
      if ((t * 8 | 0) % 8 === 0) renderPowers();
      discover(); if (L.fogReveal(P.x, P.z, 110) && t - lastFogSave > 8) { lastFogSave = t; sset('lumiar:fog4:' + WORLD, L.fogSave()); }
      const rq = L.riverQuery(P.x, P.z); const dWater = rq.rv ? clamp((rq.d - rq.w) / 40, 0, 1) : 1; let fallNear = 1; for (const f of L.FALLS) fallNear = Math.min(fallNear, Math.hypot(P.x - f.x, P.z - f.z) / 120); const seaD = clamp((L.ground(P.x, P.z) - 1) / 8, 0, 1) * clamp(1 - (Math.hypot(P.x, P.z) - 1100) / 300, 0, 1);
      ambience(.12, night, Math.max(1 - dWater, 1 - fallNear), nearFire, 1 - seaD, clamp((P.y - 120) / 200, 0, 1));
      updateBeacon(t);
      petSaveT -= .12; if (petSaveT < 0) { petSaveT = 20; for (const c of L.CRS) if (c.pet && c.owner === PID && c.pet.f) { const T2 = STATE.tames4[c.id]; if (T2 && Math.hypot((T2.x || 0) - c.x, (T2.z || 0) - c.z) > 12) Store.set('tames4', c.id, Object.assign({}, T2, { x: +c.x.toFixed(1), z: +c.z.toFixed(1) })); } }
    }
    miniT -= dt; if (started && miniT < 0) { miniT = .25; L.drawMinimap($('#miniCv'), mapData()); if (mapOpen) drawMap(); }
    if (started && (t * 2 | 0) !== ((t - dt) * 2 | 0)) { L.trimTiles(P.x, P.z); }
    if (!DBG.norender) L.render();
  }

  // ================================================================ boot
  const sws = $('#sws'); let pickC = sget('lumiar:c', 0) % L.MAGE_COLORS.length, pickG = sget('lumiar:g', 'm');
  L.MAGE_COLORS.forEach((c, i) => { const b = document.createElement('button'); b.className = 'sw'; b.style.background = `linear-gradient(135deg,#${c.robe.toString(16).padStart(6, '0')} 55%,#${c.hat.toString(16).padStart(6, '0')} 55%)`; b.setAttribute('aria-label', c.n); b.setAttribute('aria-pressed', i === pickC); b.onclick = () => { pickC = i; [...sws.children].forEach((x, j) => x.setAttribute('aria-pressed', j === i)); }; sws.appendChild(b); });
  document.querySelectorAll('#gsel button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.g === pickG); b.onclick = () => { pickG = b.dataset.g; document.querySelectorAll('#gsel button').forEach(x => x.setAttribute('aria-pressed', x.dataset.g === pickG)); }; });
  $('#nm').value = sget('lumiar:n', ''); $('#wc').value = sget('lumiar:w', 'nosso-mundo');
  const capsReady = connect();
  async function boot() {
    const bar = $('#lbar'), ltxt = $('#ltxt'); const setP = p => { bar.style.width = (p * 100).toFixed(0) + '%'; };
    const tick = setInterval(() => { const p = L.total ? L.loaded / L.total : 0; setP(p * .55); }, 120);
    ltxt.textContent = 'Carregando o mundo…';
    await L.loadAll(['mage_m', 'mage_f', 'tools', 'cliffs', 'rocks', 'ruins', 'castle', 'islands', 'nature', 'build_madeira', 'build_pedra', 'build_palha', 'build_real', 'furniture', 'fox', 'deer', 'rabbit']);
    clearInterval(tick); setP(.6);
    ltxt.textContent = 'Erguendo montanhas…'; await new Promise(r => setTimeout(r, 20));
    L.makeMaterials(); L.makeSky(); L.buildClouds(); L.terrainInit(); L.scatterInit(); L.grassInit();
    FX = L.makeParticles(1600, L.GLOW, true); SMOKE = L.makeParticles(800, L.GLOW, false); HEARTS = L.makeParticles(100, L.HEART, false); LEAVES = L.makeParticles(300, L.LEAF, false); FLIES = makeFireflies();
    ltxt.textContent = 'Construindo ruínas e o castelo celeste…'; setP(.68); await new Promise(r => setTimeout(r, 20));
    await L.worldInit(); await L.buildLoad(); setP(.75);
    ltxt.textContent = 'Plantando a floresta…';
    const cpos = new THREE.Vector3(L.SPAWN[0], L.ground(L.SPAWN[0], L.SPAWN[1]) + 40, L.SPAWN[1] + 100); L.camera.position.copy(cpos); L.camera.lookAt(L.SPAWN[0], 6, L.SPAWN[1]); L.camera.updateMatrixWorld();
    for (let i = 0; i < 60; i++) { const a = L.terrainUpdate(L.camera.position, 30), b = L.scatterUpdate(L.camera, 30); setP(.75 + i / 60 * .2); if (a && b && L.nearReady()) break; await new Promise(r => setTimeout(r, 0)); }
    ltxt.textContent = 'Desenhando o mapa da ilha…'; while (!L.mapDone()) { L.mapStep(40); await new Promise(r => setTimeout(r, 0)); }
    L.crPreload(['raposa', 'cervo', 'coelho', 'cavalo']);
    L.grassUpdate(L.SPAWN[0], L.SPAWN[1], true); setP(1);
    $('#loading').hidden = true; $('#start').hidden = false; $('#qual').textContent = { alto: '✨', medio: '⚡', baixo: '🔋' }[L.quality];
    L.resize(); frame();
  }
  $('#enter').onclick = async () => {
    me.name = ($('#nm').value.trim() || 'Mago').slice(0, 14); me.ci = pickC; me.g = pickG;
    WORLD = ($('#wc').value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 24)) || 'nosso-mundo';
    sset('lumiar:n', me.name); sset('lumiar:c', me.ci); sset('lumiar:g', me.g); sset('lumiar:w', WORLD);
    INV = Object.assign({ madeira: 0, pedra: 0, fibra: 0, frutinhas: 4, sementes: 2 }, sget('lumiar:inv4:' + WORLD, {})); TOOLS = sget('lumiar:tools4:' + WORLD, {});
    me.spawn = sget('lumiar:spawn4:' + WORLD, null); L.fogLoad(sget('lumiar:fog4:' + WORLD, ''));
    try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { }); screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch (e) { }
    initAudio(); $('#enter').disabled = true;
    M = await L.makeMage4({ gender: me.g, ci: me.ci }); if (M) { L.scene.add(M.root); M.setTool('staff'); }
    const sp = me.spawn || [L.SPAWN[0], null, L.SPAWN[1]]; P.x = sp[0]; P.z = sp[2]; P.y = sp[1] != null ? sp[1] : L.ground(P.x, P.z); P.ry = Math.PI * .85; cam.tyaw = cam.yaw = P.ry; cam.tpitch = cam.pitch = .32; cam.tdist = cam.dist = 7;
    $('#start').hidden = true; $('#hud').hidden = false; started = true;
    renderInv(); renderPowers(); L.resize(); L.grassUpdate(P.x, P.z, true);
    await capsReady; await joinWorld();
    toast(DB || SB ? `Bem-vindo a Lumiar, ${me.name}! Mundo: ${WORLD}` : `Bem-vindo, ${me.name}! Jogando sozinho neste aparelho.`, 3500);
    if (!sget('lumiar:seenHelp4', false)) { sset('lumiar:seenHelp4', true); $('#help').hidden = false; }
  };
  window.__lumiar = { L, P, me, STATE, give, get inv() { return INV; }, get tools() { return TOOLS; }, set tools(v) { TOOLS = v; }, get target() { return target; }, setT() { target = findTarget(); return target; }, doAction, doAlt, DBG, cam, startPlace, confirmPlace, cancelPlace, placeRot, placeLevel, get placing() { return placing; }, set pinAim(v) { pinAim = v; }, travel, mount, dismount, toggleMap, toggleBag, toggleBuild, openBag, craft, drink, closePanels, get M() { return M; }, Store };
  boot();
})(window.L);
