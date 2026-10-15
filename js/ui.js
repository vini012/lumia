/* Lumiar v4 map UI: explored-area mask, minimap and the full-screen world map with landmarks, players, pets, waypoint. */
'use strict';
(function (L) {
  const { clamp } = L;
  const MR = 128; // fog-of-war resolution (24 m per cell)
  let fog = new Uint8Array(MR * MR); let fogDirty = true;
  const fogC = document.createElement('canvas'); fogC.width = fogC.height = MR; const fogX = fogC.getContext('2d'); const fogImg = fogX.createImageData(MR, MR);
  const W2 = () => L.WS * 2;
  const toU = (x) => (x + L.WS) / W2(); // world -> 0..1
  L.fogLoad = function (b64) { fog = new Uint8Array(MR * MR); if (!b64) return; try { const s = atob(b64); for (let i = 0; i < s.length && i < fog.length; i++) fog[i] = s.charCodeAt(i); } catch (e) { } fogDirty = true; };
  L.fogSave = function () { let s = ''; for (let i = 0; i < fog.length; i += 4096) s += String.fromCharCode.apply(null, fog.subarray(i, i + 4096)); return btoa(s); };
  L.fogReveal = function (x, z, r) {
    const cx = toU(x) * MR, cz = toU(z) * MR, cr = r / W2() * MR; let ch = false;
    for (let j = Math.floor(cz - cr); j <= Math.ceil(cz + cr); j++) for (let i = Math.floor(cx - cr); i <= Math.ceil(cx + cr); i++) {
      if (i < 0 || j < 0 || i >= MR || j >= MR) continue; const d = Math.hypot(i + .5 - cx, j + .5 - cz) / cr; if (d > 1) continue; const v = Math.round(255 * clamp((1 - d) * 2.2, 0, 1)); const k = j * MR + i; if (v > fog[k]) { fog[k] = v; ch = true; }
    }
    if (ch) fogDirty = true; return ch;
  };
  L.fogAt = (x, z) => { const i = Math.floor(toU(x) * MR), j = Math.floor(toU(z) * MR); return i < 0 || j < 0 || i >= MR || j >= MR ? 0 : fog[j * MR + i] / 255; };
  function fogCanvas() {
    if (!fogDirty) return fogC; const d = fogImg.data;
    for (let i = 0; i < fog.length; i++) { const a = 255 - fog[i]; d[i * 4] = 18; d[i * 4 + 1] = 24; d[i * 4 + 2] = 44; d[i * 4 + 3] = Math.min(255, a * .84); }
    fogX.putImageData(fogImg, 0, 0); fogDirty = false; return fogC;
  }

  // ------------------------------------------------------------------ minimap (north up)
  // o: { x, z, ry, camYaw, others:[{x,z,c,label}], pets:[{x,z}], pois:[{x,z,ic,known}], way:[x,z]|null, dots:[{x,z,c}] }
  L.drawMinimap = function (cv, o) {
    const g = cv.getContext('2d'), S = cv.width, span = 300; const sc = S / span; const R = L.mapCanvas, MRp = L.MAPRES;
    g.save(); g.clearRect(0, 0, S, S); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1d4f6e'; g.fillRect(0, 0, S, S);
    const px = toU(o.x) * MRp, pz = toU(o.z) * MRp, spanP = span / W2() * MRp; g.imageSmoothingEnabled = true;
    g.drawImage(R, px - spanP / 2, pz - spanP / 2, spanP, spanP, 0, 0, S, S);
    const F = fogCanvas(); const fx = toU(o.x) * MR, fz = toU(o.z) * MR, fs = span / W2() * MR; g.drawImage(F, fx - fs / 2, fz - fs / 2, fs, fs, 0, 0, S, S);
    const P = (x, z) => [S / 2 + (x - o.x) * sc, S / 2 + (z - o.z) * sc];
    g.font = '13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const d of o.dots || []) { const [x, y] = P(d.x, d.z); if (x < -4 || y < -4 || x > S + 4 || y > S + 4) continue; g.fillStyle = d.c; g.beginPath(); g.arc(x, y, d.r || 2.4, 0, 7); g.fill(); }
    for (const p of o.pois || []) { const [x, y] = P(p.x, p.z); if (x < 0 || y < 0 || x > S || y > S) continue; g.globalAlpha = p.known ? 1 : .55; g.fillText(p.known ? p.ic : '❔', x, y); g.globalAlpha = 1; }
    for (const p of o.pets || []) { const [x, y] = P(p.x, p.z); g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    if (o.way) { let [x, y] = P(o.way[0], o.way[1]); const dx = x - S / 2, dy = y - S / 2, d = Math.hypot(dx, dy), m = S / 2 - 9; if (d > m) { x = S / 2 + dx / d * m; y = S / 2 + dy / d * m; } g.fillStyle = '#ff5fa2'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.stroke(); }
    for (const p of o.others || []) { let [x, y] = P(p.x, p.z); const dx = x - S / 2, dy = y - S / 2, d = Math.hypot(dx, dy), m = S / 2 - 7; if (d > m) { x = S / 2 + dx / d * m; y = S / 2 + dy / d * m; } g.fillStyle = p.c || '#ff8fb0'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.stroke(); }
    // player arrow (heading: +z is "down" on the map)
    g.translate(S / 2, S / 2); g.rotate(-o.ry + Math.PI); g.fillStyle = '#fff7e6'; g.strokeStyle = '#3a2606'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // view cone hint and north
    g.save(); g.strokeStyle = 'rgba(255,230,180,.55)'; g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#fff7e6'; g.font = '600 11px system-ui'; g.textAlign = 'center'; g.fillText('N', S / 2, 9); g.restore();
  };

  // ------------------------------------------------------------------ full map
  // view: { cx, cz (centre), zoom (px per metre) }
  L.drawWorldMap = function (cv, o, view) {
    const g = cv.getContext('2d'), Wd = cv.width, Ht = cv.height; const z = view.zoom; const R = L.mapCanvas, MRp = L.MAPRES;
    g.fillStyle = '#163d58'; g.fillRect(0, 0, Wd, Ht);
    const wx0 = view.cx - Wd / 2 / z, wz0 = view.cz - Ht / 2 / z; const P = (x, zz) => [(x - wx0) * z, (zz - wz0) * z];
    const [ix, iz] = P(-L.WS, -L.WS); const sz = W2() * z; g.imageSmoothingEnabled = true; g.drawImage(R, 0, 0, MRp, MRp, ix, iz, sz, sz);
    g.drawImage(fogCanvas(), 0, 0, MR, MR, ix, iz, sz, sz);
    // region names where explored
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const k in L.REG) { const r = L.REG[k]; if (L.fogAt(r.x, r.z) < .3) continue; const [x, y] = P(r.x, r.z); g.font = `600 ${Math.round(clamp(z * 34, 11, 22))}px Cinzel, serif`; g.lineWidth = 4; g.strokeStyle = 'rgba(10,14,30,.55)'; g.strokeText(r.nome, x, y); g.fillStyle = 'rgba(255,247,230,.9)'; g.fillText(r.nome, x, y); }
    g.font = `${Math.round(clamp(z * 40, 16, 26))}px system-ui`;
    for (const p of o.pois || []) { const [x, y] = P(p.x, p.z); if (!p.known && L.fogAt(p.x, p.z) < .2) continue; g.globalAlpha = p.known ? 1 : .5; g.fillText(p.known ? p.ic : '❔', x, y); g.globalAlpha = 1; if (p.known && z > .18) { g.font = '600 12px system-ui'; g.lineWidth = 3; g.strokeStyle = 'rgba(10,14,30,.6)'; g.strokeText(p.nome, x, y + 18); g.fillStyle = '#fff3c4'; g.fillText(p.nome, x, y + 18); g.font = `${Math.round(clamp(z * 40, 16, 26))}px system-ui`; } }
    for (const d of o.dots || []) { const [x, y] = P(d.x, d.z); g.fillStyle = d.c; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
    for (const p of o.pets || []) { const [x, y] = P(p.x, p.z); g.fillStyle = '#ffd27a'; g.strokeStyle = '#3a2606'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.stroke(); }
    if (o.way) { const [x, y] = P(o.way[0], o.way[1]); g.strokeStyle = '#fff'; g.fillStyle = '#ff5fa2'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 8, y - 18); g.arc(x, y - 20, 8, Math.PI * .8, Math.PI * .2, false); g.closePath(); g.fill(); g.stroke(); }
    for (const p of o.others || []) { const [x, y] = P(p.x, p.z); g.fillStyle = p.c || '#ff8fb0'; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.stroke(); g.font = '600 12px system-ui'; g.fillStyle = '#fff'; g.fillText(p.label || '', x, y - 15); }
    { const [x, y] = P(o.x, o.z); g.save(); g.translate(x, y); g.rotate(-o.ry + Math.PI); g.fillStyle = '#fff7e6'; g.strokeStyle = '#3a2606'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -12); g.lineTo(9, 9); g.lineTo(0, 4); g.lineTo(-9, 9); g.closePath(); g.fill(); g.stroke(); g.restore(); }
    return { wx0, wz0, z };
  };
})(window.L);
