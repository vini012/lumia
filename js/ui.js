/* Lumiar v5 interface (B-ui owns this file): loading screen, start screen, touch / keyboard input (L.input),
   HUD buttons, toasts, hint, minimap + clock, panels (Bolsa, Construir, Mapa, Baú, Ajuda, Config).
   Phase A: everything the boot and the walk need, plus placeholder panels. Contract: v5docs/INTEG.md §6.
   Layers: #game 0 · #hud 10 · #panels 12 · #start 25 · #loading 30 · #rotate 40 · survui #sv 50 · storyui #lu 60.
   The v4 map UI (explored mask, full map with landmarks and waypoint) is in git history (v4 js/ui.js) for B-ui. */
'use strict';
(function (L) {
  const $ = s => document.querySelector(s);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------------ events: L.ui.on('act' | 'panel' | 'look' | ..., fn)
  const hs = {};
  const emit = (ev, d) => { for (const f of hs[ev] || []) try { f(d); } catch (e) { console.warn('ui', ev, e); } };
  const ui = L.ui = { on(ev, fn) { (hs[ev] = hs[ev] || []).push(fn); return () => { hs[ev] = hs[ev].filter(f => f !== fn); }; }, emit };

  // ------------------------------------------------------------------ loading screen (neutral tips only)
  const TIPS = [
    'Arraste a tela para olhar em volta.',
    'Frutinhas matam a fome no começo da aventura.',
    'Uma fogueira aquece nas noites frias das montanhas.',
    'Construam uma casa juntos: o mundo guarda tudo.',
    'O mapa se revela conforme vocês exploram.',
    'Plante sementes e regue sempre.',
    'Algumas criaturas ficam amigas se receberem comida.',
    'Dormir numa cama faz a noite passar mais rápido.',
    'O mar de nuvens é lindo, mas não dá para andar nele.',
    'Usem o mesmo código de mundo para jogar em dupla.',
    'Lá do alto dá para ver longe: suba nos mirantes.',
  ];
  let tipI = Math.floor(Math.random() * TIPS.length), tipTimer = 0;
  ui.loading = function (p, text) {
    const el = $('#loading'); if (!el) return; el.hidden = false;
    if (p != null) $('#lbar').style.width = (clamp(p, 0, 1) * 100).toFixed(0) + '%';
    if (text) $('#ltxt').textContent = text;
    if (!tipTimer) { const show = () => { $('#ltip').textContent = TIPS[tipI++ % TIPS.length]; }; show(); tipTimer = setInterval(show, 5200); }
  };
  ui.loadingDone = function () { const el = $('#loading'); if (el) el.hidden = true; clearInterval(tipTimer); tipTimer = 0; };
  ui.TIPS = TIPS;

  // ------------------------------------------------------------------ start screen
  // resolves { name, world, look: { g, pal } }; prefill: the last v5 choice, else the v4 keys (a v4 code opens a
  // separate v5 world: v5 keeps its own collections p5/b5/... in the same table)
  ui.start = function (opt) {
    opt = opt || {};
    const last = lsGet('lumiar5:last', null) || {};
    let g = last.g || (lsGet('lumiar:g', 'f') === 'm' ? 'm' : 'f'), pal = (last.pal | 0) % 3;
    $('#nm').value = last.name || lsGet('lumiar:n', '') || '';
    $('#wc').value = last.world || lsGet('lumiar:w', '') || 'nosso-mundo';
    const sws = $('#sws');
    const drawSw = () => {
      const P = (L.HERO_PALETTES || {})[g] || [];
      sws.innerHTML = P.map((c, i) => `<button type="button" class="${i === pal ? 'on' : ''}" data-i="${i}" aria-label="${esc(c.n)}" title="${esc(c.n)}" style="--a:${c.top[1]};--b:${c.bottom};--c:${c.cape}"><span></span></button>`).join('');
      [...sws.children].forEach(b => b.onclick = () => { pal = +b.dataset.i; drawSw(); emit('look', { g, pal }); });
      document.querySelectorAll('#who button').forEach(b => { b.classList.toggle('on', b.dataset.g === g); b.setAttribute('aria-pressed', b.dataset.g === g); });
    };
    document.querySelectorAll('#who button').forEach(b => b.onclick = () => { g = b.dataset.g; drawSw(); emit('look', { g, pal }); });
    drawSw(); emit('look', { g, pal });
    ui.loadingDone(); $('#start').hidden = false;
    return new Promise(res => {
      const go = () => {
        const name = ($('#nm').value || '').trim().replace(/\s+/g, ' ').slice(0, 16) || 'Viajante';
        const raw = $('#wc').value;
        const world = L.save && L.save.worldCode ? L.save.worldCode(raw) : ((raw || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24) || 'nosso-mundo');
        lsSet('lumiar5:last', { name, world, g, pal });
        $('#enter').disabled = true;
        try { const de = document.documentElement; if (opt.fullscreen !== false && de.requestFullscreen) de.requestFullscreen().catch(() => { }); if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => { }); } catch (e) { }
        $('#start').hidden = true; res({ name, world, look: { g, pal } });
      };
      $('#enter').disabled = false; $('#enter').onclick = go;
      $('#nm').onkeydown = $('#wc').onkeydown = e => { if (e.key === 'Enter') go(); };
    });
  };

  // ------------------------------------------------------------------ input (read by game.js every frame)
  // mx, my: stick (-1..1, screen space: my < 0 = forward); run; jumpHeld; edges jumpQ, actQ (the game clears them);
  // camDX / camDY: drag pixels since the last frame, zoom: wheel / pinch steps (the game applies and zeroes them)
  const I = L.input = { mx: 0, my: 0, run: false, jumpQ: false, jumpHeld: false, actQ: false, camDX: 0, camDY: 0, zoom: 0, enabled: true, keys: {}, touch: false };
  const joy = { id: null, ox: 0, oy: 0, vx: 0, vy: 0 };
  const joyEls = () => ({ base: $('#joyBase'), knob: $('#joyKnob') });
  function joyStart(e) {
    if (joy.id != null) return; joy.id = e.pointerId; I.touch = e.pointerType === 'touch';
    const { base } = joyEls(); const r = base.getBoundingClientRect(); joy.ox = r.left + r.width / 2; joy.oy = r.top + r.height / 2;
    // the stick re-centres under the thumb when it lands outside the ring
    if (Math.hypot(e.clientX - joy.ox, e.clientY - joy.oy) > r.width * .6) { const z = $('#joy').getBoundingClientRect(); base.style.left = (e.clientX - z.left - r.width / 2) + 'px'; base.style.bottom = (z.bottom - e.clientY - r.height / 2) + 'px'; joy.ox = e.clientX; joy.oy = e.clientY; }
    joyMove(e); e.preventDefault();
  }
  function joyMove(e) {
    if (e.pointerId !== joy.id) return; const { base, knob } = joyEls(); const R = base.offsetWidth * .45;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
    joy.vx = dx / R; joy.vy = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
  }
  function joyEnd(e) { if (e.pointerId !== joy.id) return; joy.id = null; joy.vx = joy.vy = 0; const { base, knob } = joyEls(); knob.style.transform = ''; base.style.left = ''; base.style.bottom = ''; }
  // camera drag: any pointer on the 3D view that is not the stick, a button or a panel
  const drags = new Map(); let pinch0 = 0;
  function camDown(e) { if (e.target.closest && e.target.closest('button,#joy,.panel,input')) return; drags.set(e.pointerId, [e.clientX, e.clientY]); if (drags.size === 2) { const [a, b] = [...drags.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } }
  function camMove(e) {
    const p = drags.get(e.pointerId); if (!p) return;
    if (drags.size === 2) { p[0] = e.clientX; p[1] = e.clientY; const [a, b] = [...drags.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) I.zoom += (pinch0 - d) * .03; pinch0 = d; return; }
    I.camDX += e.clientX - p[0]; I.camDY += e.clientY - p[1]; p[0] = e.clientX; p[1] = e.clientY;
  }
  function camUp(e) { drags.delete(e.pointerId); if (drags.size < 2) pinch0 = 0; }
  const KEYMAP = { KeyE: 'act', KeyF: 'act', KeyB: 'bolsa', KeyI: 'bolsa', KeyC: 'construir', KeyM: 'mapa', KeyJ: 'diario', KeyQ: 'magia', Escape: 'fechar', KeyH: 'ajuda' };
  let jumpDown = false;
  function onKey(e, down) {
    if (e.target && e.target.tagName === 'INPUT') return;
    I.keys[e.code] = down;
    if (!ui._hudOn) return;
    if (down && e.code === 'Space' && !e.repeat) I.jumpQ = true;
    if (down && !e.repeat && KEYMAP[e.code]) press(KEYMAP[e.code]);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }
  // per frame: stick + keys combined (the game calls it once per frame, then reads L.input)
  ui.readInput = function () {
    const k = I.keys; let x = joy.vx, y = joy.vy;
    if (k.KeyA || k.ArrowLeft) x -= 1; if (k.KeyD || k.ArrowRight) x += 1; if (k.KeyW || k.ArrowUp) y -= 1; if (k.KeyS || k.ArrowDown) y += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    const on = I.enabled; I.mx = on ? x : 0; I.my = on ? y : 0; I.run = on && !!(k.ShiftLeft || k.ShiftRight); I.jumpHeld = on && !!(k.Space || jumpDown);
    if (!on) { I.jumpQ = false; I.actQ = false; I.camDX = I.camDY = 0; }
    return I;
  };
  // named HUD actions (buttons and keys): act, magia, diario, bolsa, construir, mapa, ajuda, config, fechar
  function press(what) {
    if (what === 'act') { if (!I.enabled) return; I.actQ = true; emit('act'); return; }
    if (what === 'magia') { if (L.storyUI && L.storyUI.toggleSpells) L.storyUI.toggleSpells(); emit('magia'); return; }
    if (what === 'diario') { if (L.storyUI && L.storyUI.openJournal) L.storyUI.openJournal(); emit('diario'); return; }
    if (what === 'fechar') { ui.closePanels(); return; }
    ui.toggle(what);
  }
  ui.press = press;

  // ------------------------------------------------------------------ HUD
  ui.showHUD = function (v) {
    $('#hud').hidden = v === false; ui._hudOn = v !== false;
    if (ui._wired) return; ui._wired = true;
    $('#joy').addEventListener('pointerdown', joyStart);
    addEventListener('pointermove', e => { joyMove(e); camMove(e); }, { passive: true });
    addEventListener('pointerup', e => { joyEnd(e); camUp(e); }); addEventListener('pointercancel', e => { joyEnd(e); camUp(e); });
    $('#game').addEventListener('pointerdown', camDown); $('#hud').addEventListener('pointerdown', e => { if (e.target === $('#hud')) camDown(e); });
    addEventListener('wheel', e => { if (!e.target.closest || !e.target.closest('.panel')) I.zoom += Math.sign(e.deltaY) * 1.2; }, { passive: true });
    addEventListener('blur', () => { I.keys = {}; jumpDown = false; });
    const hold = (el, on, off) => { el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('down'); on(); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, () => { el.classList.remove('down'); if (off) off(); })); };
    hold($('#bJump'), () => { I.jumpQ = true; jumpDown = true; }, () => { jumpDown = false; });
    hold($('#bAct'), () => press('act'));
    $('#bMagic').onclick = () => press('magia'); $('#bBag').onclick = () => press('bolsa'); $('#bBuild').onclick = () => press('construir');
    $('#bJournal').onclick = () => press('diario'); $('#bMap').onclick = () => press('mapa'); $('#mini').onclick = () => press('mapa');
  };
  addEventListener('keydown', e => onKey(e, true)); addEventListener('keyup', e => onKey(e, false));
  // action button: { lb: short label, off: nothing to do }
  ui.setAction = function (a) { const lb = $('#actLb'); if (!lb) return; const t = a && a.lb ? a.lb : 'ação'; if (lb.textContent !== t) lb.textContent = t; $('#bAct').classList.toggle('dim', !a || !!a.off); };
  ui.toast = function (msg, ms) {
    const box = $('#toasts'); if (!box) return; const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { t.style.transition = 'opacity .5s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 520); }, ms || 2800);
  };
  L.toast = ui.toast;
  ui.hint = function (msg) { const h = $('#hint'); if (!h) return; if (!msg) { h.hidden = true; return; } h.hidden = false; if (h.textContent !== msg) h.textContent = msg; };
  ui.gain = function (id, n) { const it = L.itemInfo ? L.itemInfo(id) : { n: id, ic: '' }; ui.toast((n > 0 ? '+' : '') + n + ' ' + it.ic + ' ' + it.n, 1800); };

  // ------------------------------------------------------------------ minimap + clock (4 Hz)
  let miniT = 0;
  ui.tick = function (dt, s) {   // s: { x, z, ry }
    miniT -= dt; if (miniT > 0 || $('#hud').hidden) return; miniT = .25;
    if (L.clock && L.clock.hours) { const h = L.clock.hours(); const t = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0'); const c = $('#clock'); if (c.textContent !== t) c.textContent = t; }
    const cv = $('#miniCv'); if (!cv || !s) return; const g = cv.getContext('2d'), W = cv.width;
    const img = L.mapDone && L.mapDone() ? L.mapCanvas : null, R = 260; // metres from the centre to the edge
    g.fillStyle = '#efdfbd'; g.fillRect(0, 0, W, W);
    if (img && L.MAPRES) { const k = L.MAPRES / (2 * L.WS); const sx = (s.x + L.WS) * k, sz = (s.z + L.WS) * k, sr = R * k; try { g.drawImage(img, sx - sr, sz - sr, sr * 2, sr * 2, 0, 0, W, W); } catch (e) { } }
    if (L.REMOTE) for (const r of L.REMOTE.values()) { const px = W / 2 + (r.x - s.x) / R * W / 2, pz = W / 2 + (r.z - s.z) / R * W / 2; if (px < 0 || pz < 0 || px > W || pz > W) continue; g.fillStyle = '#e2b84f'; g.beginPath(); g.arc(px, pz, 7, 0, 7); g.fill(); g.strokeStyle = '#5a3f2e'; g.lineWidth = 2; g.stroke(); }
    // player arrow: forward is (sin ry, cos ry) in world x/z; the map has +x right and +z down
    g.save(); g.translate(W / 2, W / 2); g.rotate(Math.atan2(Math.cos(s.ry || 0), Math.sin(s.ry || 0)) + Math.PI / 2); g.fillStyle = '#c9573f'; g.strokeStyle = '#5a3f2e'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 10); g.lineTo(0, 5); g.lineTo(-10, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
  };

  // ------------------------------------------------------------------ panels (placeholders; B-ui / B-game fill them)
  const PANELS = { bolsa: 'Bolsa', construir: 'Construir', mapa: 'Mapa', bau: 'Baú', ajuda: 'Ajuda', config: 'Configurações' };
  let open = null;
  ui.panels = {};   // ui.panels[name] = body => fill (called on every open)
  ui.isOpen = () => open;
  ui.toggle = function (name) { if (open === name) ui.closePanels(); else ui.open(name); };
  ui.open = function (name) {
    if (!PANELS[name]) return; ui.closePanels(true);
    const el = document.createElement('div'); el.className = 'panel paper'; el.dataset.p = name;
    el.innerHTML = `<div class="tape"></div><button class="btn x" type="button" aria-label="Fechar">✕</button><h2>${PANELS[name]}</h2><div class="body"></div>`;
    el.querySelector('.x').onclick = () => ui.closePanels();
    $('#panels').appendChild(el); open = name;
    const body = el.querySelector('.body');
    if (ui.panels[name]) ui.panels[name](body); else if (name === 'bolsa') bagPanel(body); else if (name === 'mapa') mapPanel(body); else body.innerHTML = '<div class="soon">Em breve.</div>';
    emit('panel', { name, open: true });
  };
  ui.closePanels = function (quiet) { const box = $('#panels'); if (box) box.innerHTML = ''; const was = open; open = null; if (was && !quiet) emit('panel', { name: was, open: false }); };
  function bagPanel(body) {
    const inv = L.inv ? L.inv.all() : {}; const ks = Object.keys(inv).filter(k => inv[k] > 0);
    body.innerHTML = ks.length ? '<div style="display:flex;flex-wrap:wrap;gap:8px">' + ks.map(k => { const i = L.itemInfo(k); return `<span class="btn" title="${esc(i.n)}">${i.ic} ${esc(i.n)} <b>${inv[k]}</b></span>`; }).join('') + '</div>' : '<div class="soon">A bolsa está vazia.</div>';
  }
  function mapPanel(body) {
    if (L.mapLoad) L.mapLoad();
    const cv = document.createElement('canvas'); cv.width = cv.height = 640; cv.style.cssText = 'width:min(68vh,100%);aspect-ratio:1;display:block;margin:0 auto;border-radius:12px';
    body.appendChild(cv); const g = cv.getContext('2d');
    const draw = () => {
      g.fillStyle = '#efdfbd'; g.fillRect(0, 0, 640, 640); if (L.mapDone && L.mapDone()) try { g.drawImage(L.mapCanvas, 0, 0, 640, 640); } catch (e) { }
      const P = L.P; if (P) { const px = (P.x + L.WS) / (2 * L.WS) * 640, pz = (P.z + L.WS) / (2 * L.WS) * 640; g.fillStyle = '#c9573f'; g.strokeStyle = '#5a3f2e'; g.lineWidth = 3; g.beginPath(); g.arc(px, pz, 8, 0, 7); g.fill(); g.stroke(); }
    };
    draw(); if (!(L.mapDone && L.mapDone())) { const iv = setInterval(() => { if (!cv.isConnected) return clearInterval(iv); if (L.mapDone()) { draw(); clearInterval(iv); } }, 300); }
  }

  // ------------------------------------------------------------------ debug overlay (?dbg=1): the game sets the text
  ui.dbg = function (text) { let el = $('#dbg'); if (!el) { el = document.createElement('div'); el.id = 'dbg'; document.body.appendChild(el); } el.textContent = text; };
})(window.L);
