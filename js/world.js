/* Lumiar v5 world: colliders & walkable surfaces (API kept from v4), light placeholder dressing for the v5 POIs
   (L.POIS from world5.json) and ambient effects. Dressing uses v5 asset files (village5, props5, totems5) when they are
   present in m/, else the v4 props (ruins, rocks, cliffs, nature) or simple procedural stand-ins; wave 2 replaces it. */
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

  // ================================================================ procedural stand-ins (when neither v5 nor v4 props fit)
  function tint(geo, hex) { const c = new THREE.Color(hex); const n = geo.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; }
  function mesh(geo, hex, x, y, z, ry) { const m = new THREE.Mesh(tint(geo, hex), L.MAT.v4 || L.MAT.plain); m.position.set(x || 0, y || 0, z || 0); if (ry) m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; return m; }
  const WALL = 0xefe3c8, ROOF = 0xc9573f, TIMBER = 0x8b5a3c, STONE = 0xa59f92, GOLDH = 0xd8c060;
  const STAND = {
    house(w, d, h) { const g = new THREE.Group(); w = w || 7; d = d || 6; h = h || 5; g.add(mesh(new THREE.BoxGeometry(w, h, d), WALL, 0, h / 2, 0)); const r = mesh(new THREE.ConeGeometry(Math.hypot(w, d) * .56, h * .7, 4, 1), ROOF, 0, h + h * .35, 0, Math.PI / 4); r.scale.set(1, 1, d / w); g.add(r); g.add(mesh(new THREE.BoxGeometry(1.2, 2.2, .2), 0x6fa79a, 0, 1.1, d / 2 + .05)); return g; },
    tower(r, h) { const g = new THREE.Group(); r = r || 3; h = h || 14; g.add(mesh(new THREE.CylinderGeometry(r * .92, r, h, 12), WALL, 0, h / 2, 0)); g.add(mesh(new THREE.ConeGeometry(r * 1.25, r * 2.2, 12), ROOF, 0, h + r * 1.1, 0)); return g; },
    windmill() { const g = STAND.tower(3, 11); const hub = new THREE.Group(); hub.position.set(0, 10, 3.4); for (let i = 0; i < 4; i++) { const b = mesh(new THREE.BoxGeometry(.5, 7.5, .12), 0xe9dcc0, 0, 3.75, 0); const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(b); hub.add(arm); } g.add(hub); g.userData.spin = hub; return g; },
    well() { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(1.3, 1.4, 1, 14, 1, true), STONE, 0, .5, 0)); for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(.2, 2.4, .2), TIMBER, s * 1.1, 1.2, 0)); const r = mesh(new THREE.ConeGeometry(1.9, 1, 4), ROOF, 0, 2.8, 0, Math.PI / 4); g.add(r); return g; },
    post(board) { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(.12, .14, 2.4, 6), TIMBER, 0, 1.2, 0)); if (board) g.add(mesh(new THREE.BoxGeometry(1.4, .6, .1), 0xc9a77c, 0, 1.9, .12)); return g; },
    totem(h) { const g = new THREE.Group(); h = h || 3; g.add(mesh(new THREE.CylinderGeometry(.42, .5, h, 8), 0xc9a77c, 0, h / 2, 0)); g.add(mesh(new THREE.CylinderGeometry(.52, .52, .32, 8), 0x4aa3c8, 0, h * .7, 0)); g.add(mesh(new THREE.BoxGeometry(1.6, .25, .3), 0xa8845d, 0, h * .82, 0)); return g; },
    haystack() { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(1.3, 1.5, 1.6, 10), GOLDH, 0, .8, 0)); g.add(mesh(new THREE.ConeGeometry(1.35, 1.2, 10), GOLDH, 0, 2.2, 0)); return g; },
    planks(len, w) { const g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(w || 2.4, .2, len || 10), TIMBER, 0, .1, 0)); return g; },
  };

  // ================================================================ POI dressing (placeholder; wave 2 does the final dressing)
  // DRESS[kind](p, ctx) places props around POI p; ids override kinds in DRESS_ID. Each POI's objects live in one group,
  // shown within its view distance (landmarks farther).
  L.ISLANDS = []; L.PORTALS = []; L.SPECIAL = []; L.LIGHTS = []; L.POIGROUPS = [];
  const gy = (x, z) => L.ground(x, z);
  function ringOf(n, R, fn) { for (let i = 0; i < n; i++) { const a = i / n * TAU; fn(Math.cos(a) * R, Math.sin(a) * R, a, i); } }
  const has = n => !!PROPS[n];
  let CUR = null, RR = Math.random;
  function put(name, x, z, ry, s, opts) {      // a prop from the registry, standing on the ground
    opts = opts || {}; const y = (opts.y != null ? opts.y : gy(x, z)) + (opts.dy || 0);
    const g = place(name, x, y, z, ry, s, { parent: CUR, shadow: opts.shadow });
    if (g && opts.col !== false) (opts.col === 'box' ? colBox : colCyl)(g, opts.k || .7);
    if (g && CUR.userData.lod) lodBox(g);
    return g;
  }
  function stand(obj, x, z, ry, s, opts) {      // a procedural stand-in
    opts = opts || {}; obj.position.set(x, (opts.y != null ? opts.y : gy(x, z)) + (opts.dy || 0), z); obj.rotation.y = ry || 0; if (s) obj.scale.setScalar(s);
    CUR.add(obj); obj.updateMatrixWorld(true); if (opts.col !== false) (opts.col === 'cyl' ? colCyl : colBox)(obj, opts.k || .9);
    if (CUR.userData.lod) lodBox(obj);
    return obj;
  }
  // far silhouette of a landmark: every placed building becomes a box + hip roof (~20 triangles), all merged into one
  // mesh shown between LOD_NEAR and the landmark's view distance (the detailed props cost ~6k triangles each)
  const LOD_NEAR = 700, _lb = new THREE.Box3();
  function lodBox(o) {
    const ry = o.rotation.y; o.rotation.y = 0; o.updateMatrixWorld(true); _lb.setFromObject(o); o.rotation.y = ry; o.updateMatrixWorld(true);
    const w = _lb.max.x - _lb.min.x, d = _lb.max.z - _lb.min.z, h = _lb.max.y - _lb.min.y;
    if (h > 2.5 && w > 1.5 && d > 1.5) CUR.userData.lod.push({ x: (_lb.min.x + _lb.max.x) / 2, z: (_lb.min.z + _lb.max.z) / 2, y: _lb.min.y, w, d, h, ry, ox: o.position.x, oz: o.position.z });
  }
  const ni = g => g.index ? g.toNonIndexed() : g;
  function lodMesh(boxes) {
    const parts = [];
    for (const b of boxes) {
      const tall = b.h > Math.max(b.w, b.d) * 1.6, wallH = b.h * (tall ? .78 : .5), roofH = b.h - wallH;
      const wall0 = tint(tall ? new THREE.CylinderGeometry(Math.min(b.w, b.d) * .46, Math.min(b.w, b.d) * .5, wallH, 8) : new THREE.BoxGeometry(b.w * .92, wallH, b.d * .92), WALL); const wall = ni(wall0);
      wall.translate(0, wallH / 2, 0);
      const roof = ni(tint(new THREE.ConeGeometry(tall ? Math.min(b.w, b.d) * .62 : Math.hypot(b.w, b.d) * .6, roofH, tall ? 8 : 4), 0xb8432e)); // CylinderGeometry / ConeGeometry may come non-indexed already
      if (!tall) { roof.rotateY(Math.PI / 4); roof.scale(1, 1, b.d / b.w); }
      roof.translate(0, wallH + roofH / 2, 0);
      for (const g of [wall, roof]) {
        // the box centre sits where the object's own (unrotated) bbox put it, around the object's origin
        g.translate(b.x - b.ox, 0, b.z - b.oz); g.rotateY(b.ry); g.translate(b.ox, b.y, b.oz);
        if (g.attributes.uv) g.deleteAttribute('uv');
        parts.push(g);
      }
    }
    const geo = THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, L.MAT.v4 || L.MAT.plain); m.name = 'lod'; m.matrixAutoUpdate = false; m.receiveShadow = true; return m;
  }
  const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  // walkable deck along local z (-half..half) of a span facing ry: sloped box colliders following yOf(z) + side rails
  function deck(x, z, y, ry, half, hw, yOf, n) {
    const sn = Math.sin(ry), cs = Math.cos(ry), seg = 2 * half / n;
    for (let k = 0; k < n; k++) {
      const a = -half + k * seg, b = a + seg, c = (a + b) / 2, ya = y + yOf(clamp(a, -half, half)), yb = y + yOf(clamp(b, -half, half));
      L.addCol({ x: x + sn * c, z: z + cs * c, rot: ry, hx: hw, hz: seg / 2, y0: Math.min(ya, yb) - .4, y1: ya, y2: yb, nocam: true });
      for (const sd of [-1, 1]) L.addCol({ x: x + sn * c + cs * sd * (hw + .1), z: z + cs * c - sn * sd * (hw + .1), rot: ry, hx: .08, hz: seg / 2, y0: Math.min(ya, yb) + .05, y1: Math.max(ya, yb) + 1.05, nocam: true, nowalk: true });
    }
  }
  function first(...names) { for (const n of names) if (has(n)) return n; return null; }
  function building(p, v5name, w, d, h) {      // a v5 building if loaded, else a box house
    const ry = p.ry || faceTo(p.x, p.z, L.SPAWN5.x, L.SPAWN5.z);
    if (v5name && has(v5name)) return put(v5name, p.x, p.z, ry, 1, { col: 'box', k: .85 });
    return stand(STAND.house(w, d, h), p.x, p.z, ry);
  }
  function ruinBits(p, n, R, s) { const names = ['ruin_wall', 'ruin_columns', 'ruin_wall', 'rock_moss'].filter(has); if (!names.length) return; for (let i = 0; i < n; i++) { const a = RR() * TAU, d = R * (.3 + RR() * .7); put(names[i % names.length], p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, RR() * TAU, s || 1, { dy: -.2 }); } }
  function stones(p, n, R, tall) { ringOf(n, R, (dx, dz, a, i) => { const x = p.x + dx, z = p.z + dz; if (has('rock_flat')) put('rock_flat', x, z, -a, [1, tall || 3, 1], { dy: -.4, k: .6 }); else stand(STAND.totem(tall || 3), x, z, -a, 1, { col: 'cyl', k: .6 }); }); }
  function logs(p, n, R, dx0) { if (!has('log')) return; ringOf(n, R, (dx, dz, a) => put('log', p.x + (dx0 || 0) + dx, p.z + dz, -a + Math.PI / 2, .9, { dy: .05, col: false })); }
  const DRESS_ID = {
    spawn: p => { const ry = (L.SPAWN5 && L.SPAWN5.ry) || 0; const q = { x: p.x - Math.sin(ry) * 9, z: p.z - Math.cos(ry) * 9 }; logs(q, 3, 3.6); },
    vila_ventura: p => { if (has('stall')) put('stall', p.x + 8, p.z - 4, faceTo(p.x + 8, p.z - 4, p.x, p.z), 1, { col: 'box' }); if (has('cart')) put('cart', p.x - 9, p.z + 5, .8, 1, { col: 'box' }); },
    tower_house: p => { const ry = faceTo(p.x, p.z, L.SPAWN5.x, L.SPAWN5.z) + .55; if (has('tower_house')) put('tower_house', p.x, p.z, ry, 1, { col: 'box', k: .8 }); else { stand(STAND.house(8, 7, 6), p.x, p.z, ry); stand(STAND.tower(2.6, 15), p.x + 4.5, p.z - 3, 0, 1, { col: 'cyl' }); } },
    bakery: p => building(p, 'bakery', 8, 7, 5),
    village_house_a: p => building(p, 'house_a', 7, 6, 5.5), village_house_b: p => building(p, 'house_b', 7.5, 6, 5),
    lake_house: p => building(p, 'house_c', 7, 6, 5), high_school: p => building(p, 'house_b', 10, 8, 7),
    well_vila: p => { if (has('well')) put('well', p.x, p.z, 0, 1); else stand(STAND.well(), p.x, p.z, 0, 1, { col: 'cyl' }); },
    cottage: p => { if (has('cottage_ruin')) put('cottage_ruin', p.x, p.z, faceTo(p.x, p.z, -1130, 5185), 1, { col: 'box' }); else { stand(STAND.house(7, 6, 3.2), p.x, p.z, .4); ruinBits(p, 3, 9, .8); } },
    windmill_broken: p => { if (has('windmill')) put('windmill', p.x, p.z, faceTo(p.x, p.z, 2300, 5300), 1); else stand(STAND.windmill(), p.x, p.z, faceTo(p.x, p.z, 2300, 5300), 1, { col: 'cyl' }); },
    windmills: p => ringOf(3, 26, (dx, dz) => { const x = p.x + dx, z = p.z + dz; if (has('windmill')) put('windmill', x, z, -.6, 1); else stand(STAND.windmill(), x, z, -.6, 1, { col: 'cyl' }); }),
    stream_mills: p => building(p, 'house_c', 7, 6, 5),
    royal_forge: p => { if (has('royal_forge')) put('royal_forge', p.x, p.z, p.ry || 0, 1, { col: 'box' }); else stand(STAND.house(11, 8, 6), p.x, p.z, 0); if (has('anvil_ancient')) put('anvil_ancient', p.x + 7, p.z + 5, .3, 1); },
    high_plaza: p => {
      if (has('fountain')) put('fountain', p.x, p.z, 0, 1); else if (has('shrine')) put('shrine', p.x, p.z, 0, 1.4);
      // the town around the plaza: two rings of houses facing it, so the high town reads as a town from the valley
      const hs = ['house_a', 'house_b', 'house_c', 'bakery'].filter(has);
      const keep = [[L.poi('royal_forge'), 30], [L.poi('high_tower'), 22], [L.poi('high_school'), 24]];   // their own dressing
      for (const [n, R, a0] of [[7, 46, .2], [9, 78, .5]]) ringOf(n, R, (dx, dz, a, i) => {
        const x = p.x + dx + (RR() - .5) * 8, z = p.z + dz + (RR() - .5) * 8; if (keep.some(([q, r]) => q && Math.hypot(x - q.x, z - q.z) < r)) return;
        const ry = faceTo(x, z, p.x, p.z);
        if (hs.length) put(hs[(i + n) % hs.length], x, z, ry, .95 + RR() * .15, { col: 'box', k: .85, dy: -.3 }); else stand(STAND.house(7, 6, 5), x, z, ry);
      });
    },
    lighthouse: p => { if (has('lighthouse_ruin')) put('lighthouse_ruin', p.x, p.z, 0, 1); else if (has('ruin_tower')) put('ruin_tower', p.x, p.z, 0, 2.2, { dy: -.3 }); else stand(STAND.tower(3.5, 20), p.x, p.z, 0, 1, { col: 'cyl' }); },
    hermit_tower_vale: p => { if (has('hermit_tower')) put('hermit_tower', p.x, p.z, 0, 1); else stand(STAND.tower(3, 13), p.x, p.z, 0, 1, { col: 'cyl' }); },
    hermit_tower_canyon: p => { if (has('hermit_tower')) put('hermit_tower', p.x, p.z, 1.2, 1); else stand(STAND.tower(3, 13), p.x, p.z, 0, 1, { col: 'cyl' }); },
    high_tower: p => { if (has('town_tower')) put('town_tower', p.x, p.z, 0, 1); else stand(STAND.tower(4, 22), p.x, p.z, 0, 1, { col: 'cyl' }); },
    griffin_nest: p => { logs(p, 8, 4); const b = gy(p.x, p.z); L.SPECIAL.push({ kind: 'perch', id: 'grifo', x: p.x, z: p.z, y: b + .6 }); },
    dragon_nest: p => { logs(p, 10, 9); if (has('dragon_skull')) put('dragon_skull', p.x + 12, p.z - 6, 2.2, 2.2, { dy: -.3 }); },
    mushroom_ring: p => { if (has('mushroom_giant')) ringOf(9, 8, (dx, dz) => put('mushroom_giant', p.x + dx, p.z + dz, RR() * TAU, .8 + RR() * .8, { k: .25 })); L.LIGHTS.push({ x: p.x, y: gy(p.x, p.z) + 2, z: p.z, c: 0x7dffc8, i: 1.4, d: 22, night: 1 }); },
    lunar_garden: p => { ruinBits(p, 8, 20, 1.1); if (has('shrine')) put('shrine', p.x, p.z, 0, 1.3); L.LIGHTS.push({ x: p.x, y: gy(p.x, p.z) + 3, z: p.z, c: 0xa8c8ff, i: 1.6, d: 30, night: 1 }); },
    hot_spring: p => { if (has('rock_big')) ringOf(7, 9, (dx, dz) => put('rock_big', p.x + dx, p.z + dz, RR() * TAU, .7 + RR() * .5, { dy: -.6 })); L.SPECIAL.push({ kind: 'steam', x: p.x, z: p.z, y: gy(p.x, p.z) }); },
    // the hidden-plateau POIs (fixed ids) get no placeholder dressing: wave 2 dresses them
    mist_sign: p => { if (has('sign_post')) put('sign_post', p.x, p.z, faceTo(p.x, p.z, 3800, -5600), 1); else stand(STAND.post(true), p.x, p.z, faceTo(p.x, p.z, 3800, -5600), 1, { col: 'cyl', k: .3 }); },
    totems_ring: p => ringOf(8, 12, (dx, dz, a) => { const x = p.x + dx, z = p.z + dz; if (has('totem_small')) put('totem_small', x, z, -a - Math.PI / 2, 1); else stand(STAND.totem(3.2), x, z, -a - Math.PI / 2, 1, { col: 'cyl', k: .6 }); }),
    totems_path: p => { for (let i = -2; i <= 2; i++) { const x = p.x + i * 7, z = p.z + (i % 2) * 3; if (has('totem_small')) put('totem_small', x, z, 0, 1); else stand(STAND.totem(2.6), x, z, 0, 1, { col: 'cyl', k: .6 }); } },
  };
  const TOTEM5 = { totem_sorriso: 'totem_smile', totem_jardim: 'totem_garden', totem_choro: 'totem_cry', totem_ancestral: 'totem_ancestral' };
  const DRESS = {
    house: p => building(p, 'house_a', 7, 6, 5), cottage: p => building(p, 'cottage_ruin', 7, 6, 3.4),
    totem: p => { const n = TOTEM5[p.id]; if (n && has(n)) put(n, p.x, p.z, faceTo(p.x, p.z, L.SPAWN5.x, L.SPAWN5.z), 1); else stand(STAND.totem(p.id === 'totem_ancestral' ? 6 : 3.4), p.x, p.z, 0, 1, { col: 'cyl', k: .6 }); },
    travel_totem: p => { if (has('totem_travel')) put('totem_travel', p.x, p.z, 0, 1); else stand(STAND.totem(4), p.x, p.z, 0, 1, { col: 'cyl', k: .6 }); },
    tower: p => stand(STAND.tower(3, 13), p.x, p.z, 0, 1, { col: 'cyl' }),
    haystacks: p => { for (let i = 0; i < 6; i++) { const a = RR() * TAU, d = 3 + RR() * 12; const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; if (has('haystack')) put('haystack', x, z, RR() * TAU, 1); else stand(STAND.haystack(), x, z, RR() * TAU, .9 + RR() * .3, { col: 'cyl' }); } },
    viewpoint: p => { if (has('bench')) put('bench', p.x, p.z, p.ry || 0, 1, { col: 'box' }); else logs(p, 1, 1.5); },
    bench: p => { if (has('bench')) put('bench', p.x, p.z, p.ry || 0, 1, { col: 'box' }); else logs(p, 1, 1.5); },
    hut: p => { if (has('cabin_fisher')) put('cabin_fisher', p.x, p.z, p.ry || 0, 1, { col: 'box' }); else stand(STAND.house(6, 5, 3.6), p.x, p.z, p.ry || 0); },
    cabin: p => { if (has('cabin')) put('cabin', p.x, p.z, p.ry || 0, 1, { col: 'box' }); else stand(STAND.house(6.5, 5.5, 4), p.x, p.z, p.ry || 0); },
    shrine: p => { if (has('shrine')) put('shrine', p.x, p.z, p.ry || 0, 1.2); else stand(STAND.totem(2.4), p.x, p.z, 0, 1, { col: 'cyl' }); },
    camp: p => { if (has('campfire_ring')) put('campfire_ring', p.x, p.z, 0, 1, { col: false }); logs(p, 3, 3.2); },
    standing_stones: p => stones(p, 7, 9),
    ruin: p => ruinBits(p, 4, 9, 1), house_ruin: p => { stand(STAND.house(6, 5, 2.4), p.x, p.z, RR() * TAU); ruinBits(p, 2, 6, .8); },
    well: p => { if (has('well')) put('well', p.x, p.z, 0, 1); else stand(STAND.well(), p.x, p.z, 0, 1, { col: 'cyl' }); },
    picnic: p => { if (has('picnic')) put('picnic', p.x, p.z, RR() * TAU, 1, { col: false }); else logs(p, 2, 1.6); },
    beehive: p => { if (has('beehive')) put('beehive', p.x, p.z, RR() * TAU, 1); },
    cart: p => { if (has('cart')) put('cart', p.x, p.z, RR() * TAU, 1, { col: 'box' }); else logs(p, 1, 1); },
    cave: p => { if (has('arch')) put('arch', p.x, p.z, p.ry || RR() * TAU, 1.4, { dy: -1.5, col: false }); else if (has('rock_big')) ringOf(4, 5, (dx, dz) => put('rock_big', p.x + dx, p.z + dz, RR() * TAU, 1.2)); },
    pier: p => { if (has('dock')) put('dock', p.x, p.z, p.ry || 0, 1, { col: false }); else stand(STAND.planks(10, 2.4), p.x, p.z, p.ry || 0, 1, { col: false }); },
    post: p => { stand(STAND.house(7, 6, 4), p.x, p.z, p.ry || 0); stand(STAND.post(true), p.x + 6, p.z + 4, 0, 1, { col: 'cyl', k: .3 }); },
    // props5 rope_bridge: 20 m span along local z, ends at +-10 m at the origin's height, 1.1 m sag at mid
    rope_bridge: p => {
      const half = (p.span || 20) / 2, ry = p.ry || 0;
      if (has('rope_bridge')) put('rope_bridge', p.x, p.z, ry, [1, 1, half / 10], { col: false, y: p.y });
      else stand(STAND.planks(half * 2, 1), p.x, p.z, ry, 1, { col: false, y: p.y - .1 });
      deck(p.x, p.z, p.y, ry, half + .6, .5, zl => -1.1 * (1 - (zl / half) * (zl / half)), 10);
    },
    // plank footbridge over a river (props5 bridge_plank: 10 m along local z, +0.32 m arch, 0.8 m half width)
    bridge: p => {
      const len = Math.max(6, p.len || p.span || 10), half = len / 2, ry = p.ry || 0;
      if (has('bridge_plank')) put('bridge_plank', p.x, p.z, ry, [1, 1, len / 10], { col: false, y: p.y });
      else stand(STAND.planks(len, 2), p.x, p.z, ry, 1, { col: false, y: p.y });
      deck(p.x, p.z, p.y, ry, half + .4, .85, zl => .32 * (1 - (zl / half) * (zl / half)), 6);
    },
    garden: p => ruinBits(p, 5, 14, 1), nest: p => logs(p, 7, 4),
  };
  // static batching: one mesh per material for a POI's dressing (props from Blender files hold many small meshes)
  function batchGroup(grp) {
    grp.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(grp.matrixWorld).invert(); const mm = new THREE.Matrix4();
    const byMat = new Map(), keep = [];
    grp.traverse(o => { if (o.userData.spin) { keep.push(o); return; } });
    const inKeep = o => { for (let q = o; q && q !== grp; q = q.parent) if (q.userData.spin) return true; return false; };
    grp.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || inKeep(o)) return;
      const g0 = o.geometry; mm.multiplyMatrices(inv, o.matrixWorld);
      const g = new THREE.BufferGeometry(); const src = g0.index ? g0.toNonIndexed() : g0; const n = src.attributes.position.count;
      g.setAttribute('position', src.attributes.position.clone()); g.setAttribute('normal', src.attributes.normal ? src.attributes.normal.clone() : new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      let c = src.attributes.color; if (!c) c = new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
      else if (c.itemSize !== 3 || c.normalized) {
        // r128 getX() returns raw integers for normalized attributes: scale them back to 0..1
        const A = c.array, sc = !c.normalized ? 1 : A instanceof Uint8Array ? 1 / 255 : A instanceof Uint16Array ? 1 / 65535 : A instanceof Int8Array ? 1 / 127 : A instanceof Int16Array ? 1 / 32767 : 1;
        const b2 = new Float32Array(n * 3); for (let i = 0; i < n; i++) { b2[i * 3] = c.getX(i) * sc; b2[i * 3 + 1] = c.getY(i) * sc; b2[i * 3 + 2] = c.getZ(i) * sc; } c = new THREE.BufferAttribute(b2, 3);
      }
      else c = c.clone();
      g.setAttribute('color', c); g.applyMatrix4(mm);
      const k = o.material; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push({ g, shadow: o.castShadow });
    });
    if (!byMat.size) return;
    for (const c of grp.children.slice()) if (!c.userData.spin && !keep.includes(c)) grp.remove(c);
    for (const [mat, list] of byMat) {
      const merged = list.length === 1 ? list[0].g : THREE.BufferGeometryUtils.mergeBufferGeometries(list.map(e => e.g), false); if (!merged) continue;
      merged.computeBoundingSphere(); const m = new THREE.Mesh(merged, mat); m.castShadow = list.some(e => e.shadow); m.receiveShadow = true; m.matrixAutoUpdate = false; grp.add(m);
    }
  }
  // view distance per kind (m): landmarks stay visible from far
  const FAR = { village: 1600, house: 1400, tower: 2600, windmill: 2400, windmill_group: 2400, lighthouse: 3000, plaza: 2000, forge: 1500, watermill: 1200, cottage: 1000, bridge: 900, rope_bridge: 1500 };
  // landmarks seen across the valleys (the high town from the Annecy viewpoint is 3.1-3.8 km away)
  const FAR_ID = { high_plaza: 4800, royal_forge: 4800, high_school: 4800, high_tower: 5200, tower_house: 2600 };
  let DRESSED = false;
  L.worldInit = async function () {
    if (DRESSED) return; DRESSED = true;
    const v4files = ['cliffs', 'rocks', 'ruins', 'nature'], v5files = ['village5', 'props5', 'totems5'];
    const v5ok = await Promise.all(v5files.map(f => typeof fetch === 'undefined' ? false : fetch('m/' + f + '.json', { method: 'HEAD' }).then(r => r.ok).catch(() => false)));
    const files = v4files.concat(v5files.filter((f, i) => v5ok[i]));
    const scenes = await Promise.all(files.map(f => L.loadModel(f)));
    // each file is either a flat list of props or one root empty ('<file>' / '*_root') holding them; v5 names win
    scenes.forEach((sc, fi) => { if (!sc) return; const tops = []; sc.children.forEach(o => { if (!o.isMesh && o.children.length && (o.name === files[fi] || /_root$/.test(o.name))) tops.push(...o.children); else tops.push(o); }); for (const o of tops) if (o.name && (!PROPS[o.name] || fi >= v4files.length)) PROPS[o.name] = o; });
    for (const k in PROPS) { const o = PROPS[k]; o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); }
    L.WORLD_DRESS_FILES = files;
    for (const p of L.POIS || []) {
      const fn = DRESS_ID[p.id] || DRESS[p.kind]; if (!fn) continue;
      RR = L.mulberry32(((p.x * 73856093) ^ (p.z * 19349663)) | 0);
      CUR = new THREE.Group(); CUR.name = 'poi_' + p.id; CUR.userData.poi = p; CUR.userData.far = FAR_ID[p.id] || FAR[p.kind] || 900;
      if (CUR.userData.far > LOD_NEAR + 200) CUR.userData.lod = [];
      try { fn(p); } catch (e) { console.warn('dress', p.id, e.message); }
      if (CUR.children.length) {
        L.scene.add(CUR); try { batchGroup(CUR); } catch (e) { console.warn('batch', p.id, e.message); } L.POIGROUPS.push(CUR);
        if (CUR.userData.lod && CUR.userData.lod.length) try {
          const lo = new THREE.Group(); lo.name = 'poilo_' + p.id; lo.add(lodMesh(CUR.userData.lod)); lo.userData.poi = p; lo.userData.near = LOD_NEAR; lo.userData.far = CUR.userData.far;
          CUR.userData.far = LOD_NEAR; L.scene.add(lo); L.POIGROUPS.push(lo);
        } catch (e) { console.warn('lod', p.id, e.message); }
        CUR.userData.lod = null;
      }
    }
    // plank bridges where roads cross rivers wider than 6 m (fords need no dressing)
    let nb = 0;
    for (const c of L.CROSSINGS || []) {
      if (c.kind !== 'bridge') continue;
      const p = Object.assign({ id: 'xb_' + nb++ }, c);
      CUR = new THREE.Group(); CUR.name = 'bridge_' + p.id; CUR.userData.poi = p; CUR.userData.far = FAR.bridge;
      try { DRESS.bridge(p); } catch (e) { console.warn('dress bridge', e.message); }
      if (CUR.children.length) { L.scene.add(CUR); try { batchGroup(CUR); } catch (e) { } L.POIGROUPS.push(CUR); }
    }
    CUR = null; L.worldReady = true;
  };

  // ================================================================ per-frame
  let spinT = 0;
  L.worldUpdate = function (dt, t) {
    const cp = L.camera && L.camera.position; if (!cp) return;
    spinT += dt;
    for (const g of L.POIGROUPS) {
      const p = g.userData.poi; const d = Math.hypot(p.x - cp.x, p.z - cp.z); g.visible = d < g.userData.far && !(d < g.userData.near);
      if (g.visible && d < 600) for (const o of g.children) if (o.userData.spin) o.userData.spin.rotation.z = spinT * .4;
    }
  };
  // mist at waterfalls (when LOOK's fall mist is absent) and steam over hot springs
  L.worldFx = function (dt, t, cp, mist) {
    if (!L.addFallMist) for (const f of L.FALLS) { const d = Math.hypot(f.bx - cp.x, f.bz - cp.z); if (d < 220 && Math.random() < dt * 24) mist(f.bx + (Math.random() - .5) * f.w, Math.max(L.ground(f.bx, f.bz), 0) + .3, f.bz + (Math.random() - .5) * f.w * .5, 1); }
    for (const s of L.SPECIAL) if (s.kind === 'steam') { const d = Math.hypot(s.x - cp.x, s.z - cp.z); if (d < 300 && Math.random() < dt * 10) mist(s.x + (Math.random() - .5) * 14, s.y + .5, s.z + (Math.random() - .5) * 14, 1); }
  };
})(window.L);
