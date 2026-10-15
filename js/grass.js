/* Lumiar v4 grass & meadow flowers: instanced clumps on a jittered grid around the player, coloured by the ground paint. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep, C } = L;
  const TAU = Math.PI * 2;
  let GQ = null, gm = null, fm = null; const cache = new Map(); const TS = {}; const col = new THREE.Color(); const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), P4 = new THREE.Vector3(), S4 = new THREE.Vector3(), Y4 = new THREE.Vector3(0, 1, 0);
  const hsh = (i, j, k) => { let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k + 1, 83492791)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const GOLDEN = C(0xd9c26a), DRY = C(0xb9b45a);

  // bright meadow flowers drawn on a card (daisies, buttercups, pink clover, bellflowers)
  function flowerTex() {
    const r = L.mulberry32(41), W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    // base leaves
    for (let i = 0; i < 16; i++) { const x = 16 + r() * 224, y = H - 4 - r() * 26, l = 26 + r() * 22, a = -Math.PI / 2 + (r() - .5) * 1.6; g.fillStyle = `hsl(${95 + r() * 25},${45 + r() * 15}%,${30 + r() * 14}%)`; g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(l / 2, 0, l / 2, 4 + r() * 3, 0, 0, TAU); g.fill(); g.restore(); }
    const kinds = [
      { p: '#fffdf6', c: '#ffcf33', n: 9, pr: .62 }, // daisy
      { p: '#ffe14a', c: '#f2a81d', n: 5, pr: .6 }, // buttercup
      { p: '#ff9cc8', c: '#ffe27a', n: 6, pr: .55 }, // pink
      { p: '#b89bff', c: '#fff0a0', n: 5, pr: .58 }, // violet
      { p: '#8fd0ff', c: '#ffffff', n: 5, pr: .55 }, // forget-me-not
      { p: '#ff8a5c', c: '#ffd04a', n: 6, pr: .55 }, // poppy-ish
    ];
    for (let i = 0; i < 11; i++) {
      const K = kinds[Math.floor(r() * kinds.length)]; const x = 20 + r() * 216, y = 18 + r() * 70, rad = 8 + r() * 6;
      g.strokeStyle = '#3f7d2c'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (r() - .5) * 14, (y + H) / 2, x + (r() - .5) * 8, H - 2); g.stroke();
      for (let k = 0; k < K.n; k++) { const a = k / K.n * TAU + r() * .2; g.fillStyle = K.p; g.beginPath(); g.ellipse(x + Math.cos(a) * rad * K.pr, y + Math.sin(a) * rad * K.pr * .8, rad * .5, rad * .3, a, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.arc(x + 1, y + 1.5, rad * .3, 0, TAU); g.fill();
      g.fillStyle = K.c; g.beginPath(); g.arc(x, y, rad * .28, 0, TAU); g.fill();
    }
    const t = L.bleedTexture(c, 1, 1); t.anisotropy = 2; return t;
  }

  L.grassInit = function () {
    GQ = { alto: { sp: .78, R: 46, blades: 20 }, medio: { sp: .92, R: 36, blades: 16 }, baixo: { sp: 1.2, R: 24, blades: 12 } }[L.quality] || { sp: .92, R: 36, blades: 16 };
    const maxN = Math.ceil(Math.PI * GQ.R * GQ.R / (GQ.sp * GQ.sp) * 1.1);
    const geo = L.grassPatchGeo(GQ.blades, GQ.sp * .66, 5);
    gm = new THREE.InstancedMesh(geo, L.makeGrassMat(), maxN); gm.count = 0;
    gm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 3).fill(1), 3); gm.instanceColor.setUsage(THREE.DynamicDrawUsage);
    gm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); gm.receiveShadow = true; gm.castShadow = false; gm.frustumCulled = false; L.scene.add(gm); L.grassIM = gm;
    // flowers: two crossed cards with normals pointing up (lit like the ground, never dark)
    const f1 = new THREE.PlaneGeometry(.9, .45, 1, 1); f1.translate(0, .225, 0); const f2 = f1.clone(); f2.rotateY(Math.PI / 2);
    const fg = THREE.BufferGeometryUtils.mergeBufferGeometries([f1, f2]); const fn = fg.attributes.normal; for (let i = 0; i < fn.count; i++) fn.setXYZ(i, 0, 1, 0);
    const fmat = L.addWind(new THREE.MeshLambertMaterial({ map: flowerTex(), alphaTest: .5, side: THREE.DoubleSide }), .5, 2.0);
    const wob = fmat.onBeforeCompile; fmat.onBeforeCompile = sh => { wob(sh); sh.fragmentShader = sh.fragmentShader.replace(/gl_FrontFacing/g, 'true'); }; fmat.customProgramCacheKey = () => 'flowers-v4'; // back faces lit like front faces
    const nf = Math.ceil(maxN * .16); fm = new THREE.InstancedMesh(fg, fmat, nf); fm.count = 0;
    fm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fm.receiveShadow = true; fm.frustumCulled = false; L.scene.add(fm); L.flowerIM = fm;
    L.grassCenter = [1e9, 1e9];
  };
  // one cell of the jittered grid: null (no grass) or {x,y,z,ry,s,sy,c,fl}
  function cell(i, j) {
    const key = (i + 32768) * 65536 + (j + 32768); let c = cache.get(key); if (c !== undefined) return c;
    c = null; const SP = GQ.sp; const x = (i + hsh(i, j, 0)) * SP, z = (j + hsh(i, j, 1)) * SP;
    const h = L.ground(x, z);
    if (h > .35 && h < 215) {
      const P = L.terrainSample(x, z, TS);
      const B = P.B; const keep = P.w[0] * 1.05 + P.w[1] * .35 - P.w[3] * .8 - P.w[2] * .9 - P.w[4];
      if (P.sl < .85 && hsh(i, j, 2) < keep && L.distRiver(x, z) > 1.6 && !(L.noGrass && L.noGrass(x, z)) && !(L.pointInSolid && L.pointInSolid(x, h + .05, z))) {
        const lush = sstep(.3, .72, L.fbm(x * .02 - 8, z * .02 + 4, 2));
        const tall = clamp(B.planicie * 1.4 + B.canion * .6 + B.pantano * .5, 0, 1);
        const s = (.78 + hsh(i, j, 3) * .45) * (.85 + lush * .3) * (1 - P.w[1] * .2);
        const sy = (.47 + hsh(i, j, 5) * .32 + lush * .22) * (1 + tall * 1.05) * (1 - sstep(120, 200, h) * .4);
        col.setRGB(P.c[0], P.c[1], P.c[2]); if (tall > .05) col.lerp(B.planicie > .3 ? GOLDEN : DRY, tall * .45);
        const fl = P.w[0] > .65 && L.fbm(x * .05 + 30, z * .05 - 12, 2) > .54 + B.pinho * .2 + B.montes * .1 && hsh(i, j, 6) < .55;
        c = { x, y: h - .04, z, ry: hsh(i, j, 4) * TAU, s, sy, r: col.r, g: col.g, b: col.b, fl };
      }
    }
    cache.set(key, c); return c;
  }
  L.grassUpdate = function (px, pz, force) {
    if (!gm) return;
    if (!force && Math.hypot(px - L.grassCenter[0], pz - L.grassCenter[1]) < 4) return; L.grassCenter = [px, pz];
    const SP = GQ.sp, R = GQ.R; let gi = 0, fi = 0; const GA = gm.instanceMatrix.array, GC = gm.instanceColor.array, FA = fm.instanceMatrix.array;
    const i0 = Math.floor((px - R) / SP), i1 = Math.ceil((px + R) / SP), j0 = Math.floor((pz - R) / SP), j1 = Math.ceil((pz + R) / SP);
    const capG = gm.instanceMatrix.count, capF = fm.instanceMatrix.count;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = cell(i, j); if (!c) continue; const d = Math.hypot(c.x - px, c.z - pz); if (d > R) continue;
      const f = sstep(R, R - 8, d); const s = c.s * f;
      if (gi < capG) { P4.set(c.x, c.y, c.z); Q4.setFromAxisAngle(Y4, c.ry); S4.set(s, s * c.sy, s); M4.compose(P4, Q4, S4); M4.toArray(GA, gi * 16); GC[gi * 3] = c.r; GC[gi * 3 + 1] = c.g; GC[gi * 3 + 2] = c.b; gi++; }
      if (c.fl && fi < capF) { P4.set(c.x + .2, c.y + .02, c.z - .15); Q4.setFromAxisAngle(Y4, c.ry * 1.7); const fs = s * (.85 + c.sy * .15); S4.set(fs, fs, fs); M4.compose(P4, Q4, S4); M4.toArray(FA, fi * 16); fi++; }
    }
    gm.count = gi; fm.count = fi;
    gm.instanceMatrix.needsUpdate = true; gm.instanceColor.needsUpdate = true; fm.instanceMatrix.needsUpdate = true;
    if (cache.size > 90000) cache.clear();
  };
  L.grassInvalidate = function (x, z, r) { const SP = GQ ? GQ.sp : 1; for (let i = Math.floor((x - r) / SP); i <= Math.ceil((x + r) / SP); i++) for (let j = Math.floor((z - r) / SP); j <= Math.ceil((z + r) / SP); j++) cache.delete((i + 32768) * 65536 + (j + 32768)); L.grassCenter = [1e9, 1e9]; };
})(window.L);
