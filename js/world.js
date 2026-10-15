/* Lumiar v4 world: colliders & walkable surfaces, points of interest dressed with the Blender props (floating castle,
   ruins, crystal grove, dragon nest...), portals, ambient effects. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep, C } = L;
  const TAU = Math.PI * 2;

  // ================================================================ colliders
  // box: {x,z,rot,hx,hz,y0,y1[,y2 = top at local +hz (ramps)]}  cyl: {kind:'cyl',x,z,r,y0,y1}  hf: {kind:'hf',x0,z0,size,n,h (NaN = no surface),y0}
  const CELL = 8; const grid = new Map(); const ck = (i, j) => (i + 4096) * 8192 + (j + 4096);
  function bounds(c) {
    if (c.kind === 'hf') return [c.x0, c.z0, c.x0 + c.size, c.z0 + c.size];
    const r = c.kind === 'cyl' ? c.r : Math.hypot(c.hx, c.hz); return [c.x - r, c.z - r, c.x + r, c.z + r];
  }
  L.addCol = function (c) {
    if (!c.kind) c.kind = 'box'; if (c.kind === 'box') { c.cs = Math.cos(c.rot || 0); c.sn = Math.sin(c.rot || 0); if (c.y2 == null) c.y2 = c.y1; }
    const b = bounds(c); c.cells = [];
    for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) { const k = ck(i, j); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(c); c.cells.push(k); }
    return c;
  };
  L.delCol = function (c) { if (!c || !c.cells) return; for (const k of c.cells) { const l = grid.get(k); if (!l) continue; const i = l.indexOf(c); if (i >= 0) l.splice(i, 1); if (!l.length) grid.delete(k); } c.cells = null; };
  let qid = 0;
  L.queryCols = function (x, z, r, fn) {
    qid++;
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
      const l = grid.get(ck(i, j)); if (!l) continue; for (const c of l) { if (c.q === qid) continue; c.q = qid; if (c.off) continue; fn(c); }
    }
  };
  function local(c, x, z, out) { const dx = x - c.x, dz = z - c.z; out[0] = dx * c.cs - dz * c.sn; out[1] = dx * c.sn + dz * c.cs; return out; }
  const _l = [0, 0];
  function topAt(c, x, z) { // top surface height at (x,z), NaN if outside
    if (c.kind === 'box') { local(c, x, z, _l); if (Math.abs(_l[0]) > c.hx || Math.abs(_l[1]) > c.hz) return NaN; return c.y1 + (c.y2 - c.y1) * (_l[1] + c.hz) / (2 * c.hz); }
    if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) <= c.r ? c.y1 : NaN;
    if (c.kind === 'hf') {
      const u = (x - c.x0) / c.size * (c.n - 1), v = (z - c.z0) / c.size * (c.n - 1); if (u < 0 || v < 0 || u > c.n - 1 || v > c.n - 1) return NaN;
      const i = Math.min(Math.floor(u), c.n - 2), j = Math.min(Math.floor(v), c.n - 2), fu = u - i, fv = v - j;
      const a = c.h[j * c.n + i], b = c.h[j * c.n + i + 1], d = c.h[(j + 1) * c.n + i], e = c.h[(j + 1) * c.n + i + 1];
      if (a === a && b === b && d === d && e === e) return lerp(lerp(a, b, fu), lerp(d, e, fu), fv);
      return fu < .5 ? (fv < .5 ? a : d) : (fv < .5 ? b : e);
    }
    return NaN;
  }
  L.colTop = topAt;
  // walkable height under the feet: highest surface not above yFeet + step (terrain included)
  const G = { y: 0, col: null };
  L.groundAt = function (x, z, yFeet, step) {
    step = step == null ? .55 : step; let best = L.ground(x, z), col = null;
    L.queryCols(x, z, .1, c => { if (c.nowalk) return; const t = topAt(c, x, z); if (t === t && t <= yFeet + step && t > best) { best = t; col = c; } });
    G.y = best; G.col = col; return G;
  };
  // push a vertical capsule (radius r, from yFeet+step up to yFeet+h) out of solid colliders
  L.collideXZ = function (p, r, h, step) {
    step = step == null ? .55 : step; let hit = false;
    L.queryCols(p.x, p.z, r + 1, c => {
      if (c.kind === 'hf' || c.ghost) return; const ctop = Math.max(c.y1, c.y2 == null ? c.y1 : c.y2); if (c.y0 > p.y + h || ctop < p.y + step) return;
      if (c.kind === 'cyl') { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), R = c.r + r; if (d < R && d > 1e-5) { p.x = c.x + dx / d * R; p.z = c.z + dz / d * R; hit = true; } return; }
      local(c, p.x, p.z, _l); const lx = _l[0], lz = _l[1];
      const top = c.y1 + (c.y2 - c.y1) * clamp((lz + c.hz) / (2 * c.hz), 0, 1); if (top <= p.y + step) return; // low enough to step onto
      const ox = c.hx + r - Math.abs(lx), oz = c.hz + r - Math.abs(lz); if (ox <= 0 || oz <= 0) return;
      const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz); const ddx = lx - qx, ddz = lz - qz, dd = Math.hypot(ddx, ddz);
      let nx = lx, nz = lz;
      if (Math.abs(lx) > c.hx && Math.abs(lz) > c.hz) { if (dd >= r) return; nx = qx + ddx / dd * r; nz = qz + ddz / dd * r; } // rounded corner
      else if (ox < oz) nx = Math.sign(lx || 1) * (c.hx + r); else nz = Math.sign(lz || 1) * (c.hz + r);
      p.x = c.x + nx * c.cs + nz * c.sn; p.z = c.z - nx * c.sn + nz * c.cs; hit = true;
    });
    return hit;
  };
  // inside a solid collider? (camera occlusion)
  L.pointInSolid = function (x, y, z) {
    let inside = false;
    L.queryCols(x, z, .1, c => {
      if (inside || c.kind === 'hf' || c.nocam || y < c.y0) return;
      if (c.kind === 'cyl') { if (y < c.y1 && Math.hypot(x - c.x, z - c.z) < c.r) inside = true; return; }
      local(c, x, z, _l); if (Math.abs(_l[0]) > c.hx || Math.abs(_l[1]) > c.hz) return; const top = c.y1 + (c.y2 - c.y1) * (_l[1] + c.hz) / (2 * c.hz); if (y < top) inside = true;
    });
    return inside;
  };

  // ================================================================ props
  const PROPS = {}; L.PROPS = PROPS;
  function propMat(o) { return /_glow/.test(o.name) ? L.MAT.glow : L.MAT.v4; }
  function place(name, x, y, z, ry, s, opts) {
    const src = PROPS[name]; if (!src) return null; opts = opts || {};
    const g = src.clone(true); const gl = PROPS[name + '_glow']; if (gl && gl.parent !== src) g.add(gl.clone(true)); // glow exported as a sibling object
    g.position.set(x, y, z); g.rotation.set(0, ry || 0, 0); if (typeof s === 'number') g.scale.setScalar(s); else if (s) g.scale.set(s[0], s[1], s[2]);
    g.traverse(o => { if (o.isMesh) { o.material = propMat(o); o.castShadow = opts.shadow !== false && !/_glow/.test(o.name); o.receiveShadow = true; } });
    (opts.parent || L.scene).add(g); g.updateMatrixWorld(true); return g;
  }
  L.placeProp = place;
  function box3(o) { return new THREE.Box3().setFromObject(o); }
  function colCyl(o, k, extra) { const b = box3(o); const r = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * .5 * (k || .8); return L.addCol(Object.assign({ kind: 'cyl', x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, r, y0: b.min.y, y1: b.max.y }, extra || {})); }
  function colBox(o, k, extra) { const b = box3(o); return L.addCol(Object.assign({ x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, rot: 0, hx: (b.max.x - b.min.x) / 2 * (k || .9), hz: (b.max.z - b.min.z) / 2 * (k || .9), y0: b.min.y, y1: b.max.y }, extra || {})); }
  // upper-surface heightfield by ray casting (walkable floating islands)
  function heightfield(objs, n, pad) {
    const b = new THREE.Box3(); objs.forEach(o => b.expandByObject(o)); const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) + pad * 2; const x0 = (b.min.x + b.max.x) / 2 - size / 2, z0 = (b.min.z + b.max.z) / 2 - size / 2;
    const h = new Float32Array(n * n).fill(NaN); const ray = new THREE.Raycaster(); const dn = new THREE.Vector3(0, -1, 0); const o = new THREE.Vector3();
    const meshes = []; objs.forEach(ob => ob.traverse(m => { if (m.isMesh && !/_glow/.test(m.name)) meshes.push(m); }));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { o.set(x0 + i / (n - 1) * size, b.max.y + 5, z0 + j / (n - 1) * size); ray.set(o, dn); const hit = ray.intersectObjects(meshes, false)[0]; if (hit) h[j * n + i] = hit.point.y; }
    return { kind: 'hf', x0, z0, size, n, h, y0: b.min.y, y1: b.max.y };
  }

  // ================================================================ points of interest
  const poi = id => L.POI.find(p => p.id === id);
  L.ISLANDS = []; L.PORTALS = []; L.SPECIAL = []; L.LIGHTS = [];
  const gy = (x, z) => L.ground(x, z);
  function ringOf(n, R, fn) { for (let i = 0; i < n; i++) { const a = i / n * TAU; fn(Math.cos(a) * R, Math.sin(a) * R, a, i); } }
  function portalMesh(x, y, z, col) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, .12, 8, 48), new THREE.MeshBasicMaterial({ color: col || 0x9fe8ff })); ring.rotation.x = Math.PI / 2; ring.position.y = .08; g.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.1, 40), new THREE.MeshBasicMaterial({ color: col || 0x9fe8ff, transparent: true, opacity: .25, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.y = .06; g.add(disc);
    const gl = L.glowSprite(col || 0x9fe8ff, 7, .5); gl.position.y = 1.2; g.add(gl);
    for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(.18, .26, 1.4 + (i % 2) * .5, 6), L.MAT.stone); const a = i / 6 * TAU; st.position.set(Math.cos(a) * 2.9, .6, Math.sin(a) * 2.9); st.castShadow = true; g.add(st); }
    L.scene.add(g); return g;
  }
  L.worldInit = async function () {
    const files = ['cliffs', 'rocks', 'ruins', 'castle', 'islands', 'nature'];
    const scenes = await Promise.all(files.map(f => L.loadModel(f)));
    // each file is either a flat list of props or one root empty ('<file>' / '*_root') holding them
    scenes.forEach((sc, fi) => { if (!sc) return; const tops = []; sc.children.forEach(o => { if (!o.isMesh && o.children.length && (o.name === files[fi] || /_root$/.test(o.name))) tops.push(...o.children); else tops.push(o); }); for (const o of tops) if (o.name && !PROPS[o.name]) PROPS[o.name] = o; });
    for (const k in PROPS) { const o = PROPS[k]; o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); }
    const R = L.mulberry32(99);
    // --- floating castle island (Vindsjäl): big island + castle, mist from its waterfalls, satellites
    { const p = poi('castelo'); const y = gy(p.x, p.z) + p.fly; const isl = place('island_a', p.x, y, p.z, .4, 3.2);
      if (isl) {
        const b = box3(isl); const hf0 = heightfield([isl], 41, 2); const cas = place('castle', p.x + 2, 0, p.z - 4, Math.PI * .9, 1.0);
        if (cas) { const t = topAt(hf0, p.x + 2, p.z - 4); cas.position.y = (t === t ? t : b.max.y) - .3; cas.updateMatrixWorld(true); colCyl(cas, .72); }
        L.addCol(hf0);
        L.ISLANDS.push({ g: isl, extra: cas ? [cas] : [], y0: y, ph: 0, fixed: true });
        const ux = p.x - 14, uz = p.z + 12; let ut = topAt(hf0, ux, uz); if (ut !== ut) ut = b.max.y;
        const bx = p.x, bz = p.z + 34, by = gy(bx, bz);
        L.PORTALS.push({ id: 'castelo_up', x: bx, z: bz, y: by, to: [ux + 3, ut, uz], nome: 'Subir ao Castelo Celeste', mesh: portalMesh(bx, by, bz) });
        L.PORTALS.push({ id: 'castelo_down', x: ux, z: uz, y: ut, to: [bx + 3, by, bz], nome: 'Descer à terra', mesh: portalMesh(ux, ut, uz, 0xffd27a) });
        L.SPECIAL.push({ kind: 'islandFalls', x: p.x, z: p.z, y: b.min.y + (b.max.y - b.min.y) * .6, r: (b.max.x - b.min.x) * .4 });
      }
      const sat = [[-130, -50, 60, 'island_b', 1.6, 'ruin_tower'], [100, 70, -30, 'island_b', 1.2, null], [40, -120, 90, 'island_a', 1.1, 'shrine'], [-70, 130, -60, 'island_b', 1.0, null]];
      for (const [dx, dz, dy, nm, s, top] of sat) { const g = place(nm, p.x + dx, y + dy, p.z + dz, R() * 6, s); if (!g) continue; const ex = []; if (top && PROPS[top]) { const b = box3(g); const t = place(top, p.x + dx, b.max.y - .6, p.z + dz, R() * 6, top === 'ruin_tower' ? 1.3 : 1); if (t) ex.push(t); } L.ISLANDS.push({ g, extra: ex, y0: y + dy, ph: R() * 6 }); }
    }
    // --- ancient ruins
    { const p = poi('ruinas');
      const t = place('ruin_tower', p.x - 10, gy(p.x - 10, p.z - 6) - .3, p.z - 6, .3, 1.3); if (t) colCyl(t, .7);
      const pieces = [['ruin_wall', 8, -12, .2], ['ruin_wall', 14, 4, 1.7], ['ruin_wall', -16, 10, 2.9], ['ruin_columns', 4, 14, .6], ['ruin_stairs', -2, -2, 0], ['rock_moss', 18, -14, 1], ['rock_moss', -20, -12, 2.2], ['shrine', 0, 7, Math.PI]];
      for (const [nm, dx, dz, ry] of pieces) { const g = place(nm, p.x + dx, gy(p.x + dx, p.z + dz) - .2, p.z + dz, ry, 1.1); if (!g) continue; if (nm === 'ruin_stairs') { const b = box3(g); L.addCol({ x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, rot: 0, hx: (b.max.x - b.min.x) / 2, hz: (b.max.z - b.min.z) / 2, y0: b.min.y, y1: b.min.y + .5 }); } else colBox(g, .8); }
    }
    // --- moon clearing: ring of standing stones around a shrine
    { const p = poi('clareira'); ringOf(9, 14, (dx, dz, a, i) => { const x = p.x + dx, z = p.z + dz; const g = place(i % 3 ? 'rock_flat' : 'ruin_columns', x, gy(x, z) - .4, z, -a, i % 3 ? [1.1, 3.2, 1.1] : .8); if (g) colCyl(g, .6); }); const s = place('shrine', p.x, gy(p.x, p.z) - .2, p.z, 0, 1.2); if (s) colCyl(s, .6); L.SPECIAL.push({ kind: 'moon', x: p.x, z: p.z }); }
    // --- crystal grove
    { const p = poi('gruta'); for (let i = 0; i < 16; i++) { const a = R() * TAU, d = 6 + R() * 26; const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; const g = place(R() < .6 ? 'crystal_cluster' : 'stalagmite', x, gy(x, z) - .3, z, R() * 6, .8 + R() * 1.4); if (g) colCyl(g, .5); }
      ringOf(7, 40, (dx, dz, a, i) => { if (i === 2) return; const x = p.x + dx, z = p.z + dz; const g = place('cliff_' + 'abc'[i % 3], x, gy(x, z) - 2, z, -a + Math.PI / 2, 1.2 + R() * .5); if (g) colBox(g, .75); });
      L.LIGHTS.push({ x: p.x, y: gy(p.x, p.z) + 3, z: p.z, c: 0xa58cff, i: 2.2, d: 40, night: .6 }); }
    // --- panther den
    { const p = poi('toca'); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + .3, d = 9 + R() * 6; const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; const g = place(i % 2 ? 'rock_big' : 'cliff_b', x, gy(x, z) - 1, z, R() * 6, .9 + R() * .6); if (g) colCyl(g, .7); } }
    // --- moss sanctuary
    { const p = poi('santuario'); const g = place('shrine', p.x, gy(p.x, p.z) - .1, p.z, 0, 1.6); if (g) colCyl(g, .6);
      for (let i = 0; i < 9; i++) { const a = R() * TAU, d = 9 + R() * 18; const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; if (gy(x, z) < .3) continue; const m = place('mushroom_giant', x, gy(x, z) - .1, z, R() * 6, .8 + R() * 1.2); if (m) colCyl(m, .25); }
      for (let i = 0; i < 14; i++) { const a = R() * TAU, d = 20 + R() * 40; const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; const h = gy(x, z); if (h < -.2 && h > -2.5) place('lotus', x, .02, z, R() * 6, .8 + R() * .6, { shadow: false }); }
      L.LIGHTS.push({ x: p.x, y: gy(p.x, p.z) + 3, z: p.z, c: 0x7dffc8, i: 1.6, d: 26, night: 1 }); }
    // --- dragon nest
    { const p = poi('ninho'); const sk = place('dragon_skull', p.x + 12, gy(p.x + 12, p.z - 6) - .3, p.z - 6, 2.2, 2.2); if (sk) colCyl(sk, .6);
      ringOf(10, 9, (dx, dz, a) => { const x = p.x + dx, z = p.z + dz; place('log', x, gy(x, z) + .1, z, -a, 1.4); });
      for (let i = 0; i < 8; i++) { const a = R() * TAU, d = 18 + R() * 30; const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; const g = place(R() < .5 ? 'rock_big' : 'spire', x, gy(x, z) - 1, z, R() * 6, .7 + R() * .8); if (g) colCyl(g, .6); } }
    // --- white wolf peak: standing stones
    { const p = poi('picolobo'); ringOf(6, 10, (dx, dz, a) => { const x = p.x + dx, z = p.z + dz; const g = place('rock_flat', x, gy(x, z) - .5, z, -a, [1, 3, 1]); if (g) colCyl(g, .6); }); }
    // --- stone arch
    { const p = poi('arco'); const g = place('arch', p.x, gy(p.x, p.z) - 2, p.z, .8, 2.2); if (g) { const b = box3(g); const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z); const ca = Math.cos(.8), sa = Math.sin(.8); for (const s of [-1, 1]) L.addCol({ kind: 'cyl', x: p.x + ca * s * w * .36, z: p.z - sa * s * w * .36, r: w * .1, y0: b.min.y, y1: b.max.y * .8 }); } }
    // --- griffin needle: tall spire with a nest
    { const p = poi('grifo'); const g = place('spire', p.x, gy(p.x, p.z) - 2, p.z, 0, [2.6, 3.6, 2.6]); if (g) { const b = box3(g); colCyl(g, .6); L.SPECIAL.push({ kind: 'perch', id: 'grifo', x: p.x, z: p.z, y: b.max.y - .4 }); ringOf(7, 2.4, (dx, dz, a) => place('log', p.x + dx, b.max.y - .5, p.z + dz, -a, .8)); } }
    // --- golden colonnade
    { const p = poi('coluna'); ringOf(8, 16, (dx, dz, a, i) => { if (i === 5) return; const x = p.x + dx, z = p.z + dz; const g = place('ruin_columns', x, gy(x, z) - .3, z, -a, 1.1); if (g) colCyl(g, .5); }); place('ruin_stairs', p.x, gy(p.x, p.z) - .2, p.z, 0, 1.3); }
    // --- turtle cove
    { const p = poi('farol'); for (let i = 0; i < 10; i++) { const a = R() * TAU, d = 8 + R() * 30; const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; const h = gy(x, z); if (h > -1.5) { const g = place(R() < .5 ? 'rock_flat' : 'rock_moss', x, h - .4, z, R() * 6, .8 + R() * .8); if (g) colCyl(g, .6); } else if (h > -3) place('lotus', x, .02, z, R() * 6, 1, { shadow: false }); } }
    // --- spawn camp: logs to sit around the first fire
    { const p = poi('spawn'); ringOf(3, 4.2, (dx, dz, a) => place('log', p.x + 6 + dx, gy(p.x + 6 + dx, p.z + dz) + .05, p.z + dz, -a + Math.PI / 2, .9)); }
    // --- Vindsjäl cliffs on the steep terraces of the waterfall region
    { const reg = L.REG.penhas; let n = 0; const RR = L.mulberry32(7);
      for (let k = 0; k < 1400 && n < 80; k++) { const a = RR() * TAU, d = Math.sqrt(RR()) * reg.r * 1.05; const x = reg.x + Math.cos(a) * d, z = reg.z + Math.sin(a) * d; const h = L.rawH(x, z); if (h < 4) continue;
        const nx = L.rawH(x + 2, z) - L.rawH(x - 2, z), nz = L.rawH(x, z + 2) - L.rawH(x, z - 2); if (Math.hypot(nx, nz) / 4 < 1.1) continue;
        const ry = Math.atan2(-nx, -nz); const g = place('cliff_' + 'abc'[n % 3], x, h - 7, z, ry, 1.3 + RR() * 1.1); if (g) { n++; colBox(g, .7); } }
    }
    L.worldReady = true;
  };

  // ================================================================ per-frame
  L.worldUpdate = function (dt, t) {
    for (const I of L.ISLANDS) { if (I.fixed) continue; const y = I.y0 + Math.sin(t * .2 + I.ph) * 1.6; const dy = y - I.g.position.y; I.g.position.y = y; for (const e of I.extra) e.position.y += dy; }
    for (const P of L.PORTALS) if (P.mesh) { P.mesh.children[0].rotation.z = t * .6; P.mesh.children[1].material.opacity = .22 + Math.sin(t * 2.4) * .1; }
  };
  // mist at waterfalls and under the floating island
  L.worldFx = function (dt, t, cp, mist) {
    for (const f of L.FALLS) { const d = Math.hypot(f.bx - cp.x, f.bz - cp.z); if (d < 220 && Math.random() < dt * 24) mist(f.bx + (Math.random() - .5) * f.w, Math.max(L.ground(f.bx, f.bz), 0) + .3, f.bz + (Math.random() - .5) * f.w * .5, 1); }
    for (const s of L.SPECIAL) if (s.kind === 'islandFalls') { const d = Math.hypot(s.x - cp.x, s.z - cp.z); if (d < 900 && Math.random() < dt * 30) { const a = Math.random() * TAU; mist(s.x + Math.cos(a) * s.r, s.y - Math.random() * 30, s.z + Math.sin(a) * s.r, 2); } }
  };
})(window.L);
