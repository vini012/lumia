/* Dev harness (not shipped): a small three.js scene around the progression module, so it can be played, tested and
   photographed without the rest of the game. Sky with the time of day, a meadow that follows the mock ground, a few
   trees, the bay, simple stand-ins for the hidden place (with the castleObj / castleRestore hooks the game provides),
   the white cloud visual (open/dissolve), lighthouse pieces from the build records, a player figure and a third-person
   camera. API for tests: window.STORYDEV = {ready, chain(), scene(name), settled(), render(), mid()}. */
'use strict';
(function () {
  const L = window.L, M = window.MOCK, S = L.story, U = L.storyUI;
  const QS = new URLSearchParams(location.search), SHOTS = QS.has('shots');
  const DEV = window.STORYDEV = { ready: false, busy: false };
  const TAU = Math.PI * 2, clamp = (x, a, b) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
  const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lin = h => new THREE.Color(h).convertSRGBToLinear();
  if (SHOTS) document.body.classList.add('shots');

  // ------------------------------------------------------------------ renderer, scene, camera
  const cv = document.getElementById('cv');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(SHOTS ? 1 : Math.min(2, devicePixelRatio || 1));
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = L.scene = new THREE.Scene();
  const camera = L.camera = new THREE.PerspectiveCamera(55, 1, .1, 4000);
  function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();

  // materials for rig.js / story.js (the game's LOOK module provides the real ones)
  L.MAT = {
    v4: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 }),
    v4skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, skinning: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.6, 1.6, 1.6) }),
    glowSkin: new THREE.MeshBasicMaterial({ vertexColors: true, skinning: true, color: new THREE.Color(1.6, 1.6, 1.6) }),
  };
  // models from m/ (v4 files today; the v5 files appear there later). Missing files resolve to null.
  const gltf = new THREE.GLTFLoader(), MODELS = {}; let pending = 0;
  L.loadModel = name => MODELS[name] || (MODELS[name] = new Promise(res => {
    pending++; const done = v => { pending--; res(v); };
    fetch('../m/' + name + '.json', { method: 'HEAD' }).then(r => {
      if (!r.ok) return done(null);
      gltf.load('../m/' + name + '.json', g => { g.scene.userData.anims = g.animations; done(g.scene); }, undefined, () => done(null));
    }).catch(() => done(null));
  }));
  // soft glow texture + particles (same contract as the engine's)
  L.GLOW = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  L.glowSprite = (color, size, op) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: L.GLOW, color, transparent: true, opacity: op == null ? 1 : op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); s.scale.set(size, size, 1); return s; };
  L.makeParticles = function (max, map, additive) {
    const g = new THREE.BufferGeometry(), P = new Float32Array(max * 3), C = new Float32Array(max * 4), Z = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(C, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(Z, 1));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uTex: { value: map }, uScale: { value: 420 } },
      vertexShader: 'attribute vec4 aColor;attribute float aSize;uniform float uScale;varying vec4 vC;void main(){vC=aColor;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uScale/-mv.z;gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'uniform sampler2D uTex;varying vec4 vC;void main(){gl_FragColor=texture2D(uTex,gl_PointCoord)*vC;if(gl_FragColor.a<.01)discard;}' });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts); const list = [];
    return {
      emit(o) { if (list.length >= max) list.shift(); list.push(Object.assign({ vx: 0, vy: 0, vz: 0, g: 0, life: 1, age: 0, s0: .5, s1: .1, c: [1, 1, 1], a: 1, drag: 0 }, o)); },
      update(dt) {
        let n = 0; for (let i = list.length - 1; i >= 0; i--) { const p = list[i]; p.age += dt; if (p.age >= p.life) list.splice(i, 1); }
        for (const p of list) { p.vy -= p.g * dt; const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; p.vz *= d; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; const t = p.age / p.life; P[n * 3] = p.x; P[n * 3 + 1] = p.y; P[n * 3 + 2] = p.z; C[n * 4] = p.c[0]; C[n * 4 + 1] = p.c[1]; C[n * 4 + 2] = p.c[2]; C[n * 4 + 3] = p.a * Math.min(1, t * 6) * (1 - t); Z[n] = lerp(p.s0, p.s1, t); n++; }
        g.setDrawRange(0, n); g.attributes.position.needsUpdate = g.attributes.aColor.needsUpdate = g.attributes.aSize.needsUpdate = true;
      },
    };
  };

  // ------------------------------------------------------------------ sky, light, fog by the hour
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uLow: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunC: { value: new THREE.Color() }, uStar: { value: 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uTop,uMid,uHor,uLow,uSunC; uniform vec3 uSun; uniform float uStar; varying vec3 vD;
      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 c = mix(uHor, uMid, smoothstep(.0,.22,h)); c = mix(c, uTop, smoothstep(.18,.85,h)); c = mix(c, uLow, smoothstep(.0,-.12,h));
        float s = max(dot(d, normalize(uSun)), 0.); c += uSunC * (pow(s, 900.) * 3. + pow(s, 24.) * .22 + pow(s, 4.) * .08);
        if (uStar > 0.) { vec2 g = vec2(atan(d.z,d.x)*180., d.y*240.); vec2 i = floor(g); float r = h21(i); float st = step(.9965, r) * smoothstep(.02,.25,h) * (.6 + .4*sin(r*80.)); c += vec3(st) * uStar; }
        gl_FragColor = linearToOutputTexel(vec4(c, 1.)); }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
  scene.fog = new THREE.Fog(0xbcd6ec, 160, 1400);
  const hemi = new THREE.HemisphereLight(0xbfd9f5, 0x7d7a3e, .8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d8, 1.7); sun.castShadow = true; sun.shadow.mapSize.set(SHOTS ? 2048 : 1024, SHOTS ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 }); sun.shadow.bias = -.0006; sun.shadow.normalBias = .03; scene.add(sun); scene.add(sun.target);
  const PAL = {
    day: { top: '#3f95e2', mid: '#5aa8ea', hor: '#cfe2f1', low: '#e6ecf3', fog: '#c3dbef', hs: '#b9d3f0', hg: '#7c7a44', hi: .62, sc: '#fff1d8', si: 1.2, mist: '#f4f7fb' },
    dusk: { top: '#4a5f9e', mid: '#c98f88', hor: '#f7c495', low: '#f0c9a4', fog: '#e3b997', hs: '#e9bfa2', hg: '#5e4e40', hi: .45, sc: '#ffb070', si: .9, mist: '#f3d9c6' },
    night: { top: '#0b1736', mid: '#18295a', hor: '#33507f', low: '#3a5682', fog: '#2a436e', hs: '#5671b4', hg: '#1c2438', hi: .5, sc: '#a9c0ff', si: .42, mist: '#7d8fb8' },
  };
  let hourNow = 9;
  function setHour(h) {
    hourNow = h; M.setHour(h);
    const a = (h / 24 - .25) * TAU, se = Math.sin(a); const dW = sst(-.05, .35, se), nW = sst(.05, -.25, se), kW = Math.max(0, 1 - dW - nW), tot = dW + nW + kW;
    const mix = k => { const c = new THREE.Color(0, 0, 0); for (const [w, p] of [[dW, PAL.day], [kW, PAL.dusk], [nW, PAL.night]]) c.add(lin(p[k]).multiplyScalar(w / tot)); return c; };
    const num = k => (dW * PAL.day[k] + kW * PAL.dusk[k] + nW * PAL.night[k]) / tot;
    const u = sky.material.uniforms; u.uTop.value.copy(mix('top')); u.uMid.value.copy(mix('mid')); u.uHor.value.copy(mix('hor')); u.uLow.value.copy(mix('low')); u.uStar.value = nW * .9;
    scene.fog.color.copy(mix('fog')); hemi.color.copy(mix('hs')); hemi.groundColor.copy(mix('hg')); hemi.intensity = num('hi');
    sun.color.copy(mix('sc')); sun.intensity = num('si'); mistCol.copy(mix('mist')); if (puffs.length) paintMist();
    const day = se > -.08; const sd = day ? new THREE.Vector3(Math.cos(a), Math.max(.12, se), .35) : new THREE.Vector3(-Math.cos(a) * .6, .55, -.4); sd.normalize();
    sun.userData.dir = sd; u.uSun.value.copy(day ? sd : new THREE.Vector3(-sd.x, sd.y, -sd.z)); u.uSunC.value.copy(day ? lin('#fff0cf').multiplyScalar(.9 * (1 - nW)) : lin('#dfe8ff').multiplyScalar(.25));
    const hv = document.getElementById('hour'); if (hv) { hv.value = h; document.getElementById('hourv').textContent = h.toFixed(2); }
  }

  // ------------------------------------------------------------------ ground that follows the focus
  const GN = 120, GS = 300; let gCenter = null;
  const gGeo = new THREE.PlaneGeometry(GS, GS, GN, GN); gGeo.rotateX(-Math.PI / 2); gGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((GN + 1) * (GN + 1) * 3), 3));
  const ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 })); ground.receiveShadow = true; scene.add(ground);
  const noise = (x, z) => Math.sin(x * .071 + Math.sin(z * .053) * 1.7) * .5 + Math.sin(z * .047 - x * .031) * .35 + Math.sin((x + z) * .19) * .15;
  const GC = ['#b9b54a', '#c2bc5f', '#aeab45', '#93b326', '#8fac44', '#a9a63a'].map(lin), SHADE = lin('#7b7f26'), SAND = lin('#d9c98f'), PATH = lin('#ebda8d');
  function groundAt(cx, cz) {
    cx = Math.round(cx / 10) * 10; cz = Math.round(cz / 10) * 10; if (gCenter && gCenter[0] === cx && gCenter[1] === cz) return; gCenter = [cx, cz];
    const p = gGeo.attributes.position, c = gGeo.attributes.color, tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = gGeo.userData.bx ? gGeo.userData.bx[i] + cx : p.getX(i) + cx, z = gGeo.userData.bz ? gGeo.userData.bz[i] + cz : p.getZ(i) + cz;
      if (!gGeo.userData.bx) { /* first pass keeps base offsets */ }
      const y = L.ground(x, z); p.setXYZ(i, x, y, z);
      const n = noise(x, z), k = (n + 1) / 2; tmp.copy(GC[Math.floor(k * 5.99)]).lerp(GC[(Math.floor(k * 5.99) + 2) % 6], (n * 3.1) % 1 * .35 + .2);
      tmp.lerp(SHADE, clamp(-noise(x * .4 + 9, z * .4) * .35, 0, .3));
      const db = Math.hypot(x + 330, z - 240); if (db < 86) tmp.lerp(SAND, sst(86, 72, db));
      c.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    p.needsUpdate = true; c.needsUpdate = true; gGeo.computeVertexNormals(); gGeo.computeBoundingSphere(); gGeo.computeBoundingBox();
    trees(cx, cz);
  }
  { const p = gGeo.attributes.position, bx = new Float32Array(p.count), bz = new Float32Array(p.count); for (let i = 0; i < p.count; i++) { bx[i] = p.getX(i); bz[i] = p.getZ(i); } gGeo.userData.bx = bx; gGeo.userData.bz = bz; }
  // the bay
  const bay = new THREE.Mesh(new THREE.CircleGeometry(78, 48), new THREE.MeshStandardMaterial({ color: lin('#4fa9cf'), roughness: .15, metalness: .1, transparent: true, opacity: .9 }));
  bay.rotation.x = -Math.PI / 2; bay.position.set(-330, 0, 240); scene.add(bay);

  // ------------------------------------------------------------------ trees (instanced, deterministic per area)
  function hash(x, z) { let h = (x * 374761393 + z * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const TN = 90;
  const canopyGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const k = .72 + .36 * (p.getY(i) + 1) / 2; c[i * 3] = k; c[i * 3 + 1] = k; c[i * 3 + 2] = k * (1.05 - .1 * k); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; })();
  const pineGeo = (() => { const parts = [0, 1, 2].map(i => { const g = new THREE.ConeGeometry(1 - i * .24, 1.3, 7); g.translate(0, .5 + i * .78, 0); return g.toNonIndexed(); }); const g = THREE.BufferGeometryUtils.mergeBufferGeometries(parts); const p = g.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const k = .7 + .3 * p.getY(i) / 2.9; c[i * 3] = k; c[i * 3 + 1] = k; c[i * 3 + 2] = k; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; })();
  const trunkGeo = new THREE.CylinderGeometry(.12, .2, 1, 6); trunkGeo.translate(0, .5, 0);
  const IM = {
    canopy: new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, flatShading: true }), TN),
    pine: new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, flatShading: true }), TN),
    trunk: new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: lin('#7a5a3e'), roughness: .9 }), TN * 2),
  };
  for (const k in IM) { IM[k].castShadow = true; IM[k].receiveShadow = true; IM[k].frustumCulled = false; scene.add(IM[k]); }
  const CAN = ['#7d9d34', '#6f9230', '#8aa83c', '#93ad45'].map(lin), PIN = ['#36552f', '#4a6b3a', '#3e5f35'].map(lin);
  function trees(cx, cz) {
    const o = new THREE.Object3D(); let nc = 0, np = 0, nt = 0;
    for (let i = 0; i < 400 && (nc < TN || np < TN); i++) {
      const x = cx + (hash(i, cx * 7 + cz) - .5) * GS * .95, z = cz + (hash(cz + i * 3, cx) - .5) * GS * .95; const y = L.ground(x, z);
      if (y < 1 || L.inMist(x, z) > 0 || (L.POIS || []).some(p => Math.hypot(p.x - x, p.z - z) < 14) || Math.hypot(x - L.P.x, z - L.P.z) < 10) continue;
      const pine = hash(i, 77) < .38, s = .8 + hash(i, 5) * .7;
      if (pine && np < TN) { const h = 4.5 * s; o.position.set(x, y + 1.0 * s, z); o.scale.set(1.5 * s, h / 2.9, 1.5 * s); o.rotation.set(0, hash(i, 9) * TAU, 0); o.updateMatrix(); IM.pine.setMatrixAt(np, o.matrix); IM.pine.setColorAt(np, PIN[i % PIN.length]); np++; o.position.set(x, y, z); o.scale.set(s, 1.3 * s, s); o.updateMatrix(); IM.trunk.setMatrixAt(nt++, o.matrix); }
      else if (!pine && nc < TN) { o.position.set(x, y + 3.1 * s, z); o.scale.set(2.3 * s, 1.9 * s, 2.3 * s); o.rotation.set(0, hash(i, 9) * TAU, 0); o.updateMatrix(); IM.canopy.setMatrixAt(nc, o.matrix); IM.canopy.setColorAt(nc, CAN[i % CAN.length]); nc++; o.position.set(x, y, z); o.scale.set(s, 2.6 * s, s); o.updateMatrix(); IM.trunk.setMatrixAt(nt++, o.matrix); }
    }
    IM.canopy.count = nc; IM.pine.count = np; IM.trunk.count = nt;
    for (const k in IM) { IM[k].instanceMatrix.needsUpdate = true; if (IM[k].instanceColor) IM[k].instanceColor.needsUpdate = true; }
  }

  // ------------------------------------------------------------------ stand-ins for the hidden place (hooks the game provides)
  const KEEP = new THREE.Group(); scene.add(KEEP); const KO = {}; const RUIN = [];
  function stone(w, h, d, col) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: lin(col || '#e3d6b8'), roughness: .9 })); m.castShadow = m.receiveShadow = true; return m; }
  function tower(r, h, roof) {
    const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, h, 16), new THREE.MeshStandardMaterial({ color: lin('#e6d9bc'), roughness: .9 })); b.position.y = h / 2; b.castShadow = b.receiveShadow = true; g.add(b);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, 1.2, 16), new THREE.MeshStandardMaterial({ color: lin('#c9573f'), roughness: .8 })); band.position.y = h * .62; g.add(band);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, r * 2.2, 16), new THREE.MeshStandardMaterial({ color: lin('#bc5a43'), roughness: .8 })); cone.position.y = h + r * 1.1; cone.castShadow = true; g.add(cone);
    g.userData.cone = cone; g.userData.h = h; if (roof === 'broken') RUIN.push(cone); return g;
  }
  function buildKeep() {
    const c = L.poi('castle'), gt = L.poi('castle_gate'), th = L.poi('throne'); if (!c) return;
    const gy = L.ground(c.x, c.z); KEEP.position.set(c.x, 0, c.z);
    const W = 96, D = 140, z0 = gt.z - c.z, z1 = z0 - D; // gate side (+z) to the far side
    const wall = (x, z, w, d) => { const m = stone(w, 12, d); m.position.set(x, L.ground(c.x + x, c.z + z) + 6, z); KEEP.add(m); };
    wall(-W / 2, (z0 + z1) / 2, 3, D); wall(W / 2, (z0 + z1) / 2, 3, D); wall(0, z1, W, 3); wall(-W / 4 - 4, z0, W / 2 - 8, 3); wall(W / 4 + 4, z0, W / 2 - 8, 3);
    for (const [x, z] of [[-W / 2, z0], [W / 2, z0], [-W / 2, z1], [W / 2, z1]]) { const t = tower(7, 28, 'broken'); t.position.set(x, L.ground(c.x + x, c.z + z), z); KEEP.add(t); }
    const big = tower(9, 62, 'broken'); big.position.set(-24, L.ground(c.x - 24, c.z + z1 + 26), z1 + 26); KEEP.add(big);
    const gh = stone(18, 16, 6, '#d9cba9'); gh.position.set(0, L.ground(c.x, c.z + z0) + 8 + 4, z0); KEEP.add(gh);
    // doors on hinges + the round lock (names as in the authored file)
    for (const s of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(s * 3, L.ground(c.x, c.z + z0), z0 + 1.6); const d = new THREE.Mesh(new THREE.BoxGeometry(3, 7.6, .4), new THREE.MeshStandardMaterial({ color: lin('#6b4630'), roughness: .9 })); d.position.set(-s * 1.5, 3.8, 0); d.castShadow = true; piv.add(d); KEEP.add(piv); KO[s < 0 ? 'gate_door_l' : 'gate_door_r'] = piv; }
    const lock = new THREE.Group(); lock.position.set(0, L.ground(c.x, c.z + z0) + 3.6, z0 + 2.05); KEEP.add(lock); KO.star_lock = lock;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .22, 32), new THREE.MeshStandardMaterial({ color: lin('#cbbfa8'), roughness: .8 })); disc.rotation.x = Math.PI / 2; lock.add(disc);
    const glow = L.glowSprite(0xffe2a0, 4, .9); glow.visible = false; lock.add(glow); KO.star_lock_glow = glow;
    // the far end: dais, throne, lectern, pillars
    const ty = L.ground(th.x, th.z); const dais = stone(10, .5, 7, '#cfc2a6'); dais.position.set(th.x - c.x, ty + .25, th.z - c.z); KEEP.add(dais);
    const throne = new THREE.Group(); throne.position.set(th.x - c.x, ty + .5, th.z - c.z); throne.rotation.y = th.ry || 0; KEEP.add(throne); KO.throne = throne;
    const seat = stone(1.5, .62, 1.1, '#a59f92'); seat.position.y = .31; throne.add(seat); const back = stone(1.5, 2.8, .3, '#a59f92'); back.position.set(0, 1.4, -.5); throne.add(back);
    for (const s of [-1, 1]) { const arm = stone(.22, .5, 1.0, '#9d968a'); arm.position.set(s * .72, .85, 0); throne.add(arm); }
    const lect = new THREE.Group(); lect.position.set(th.x - c.x + 2.6, ty + .5, th.z - c.z + 1.6); lect.rotation.y = -.5; KEEP.add(lect); KO.lectern = lect;
    const lp = stone(.4, 1.0, .4, '#b8b0a0'); lp.position.y = .5; lect.add(lp); const lt = stone(.7, .08, .5, '#b8b0a0'); lt.position.y = 1.05; lt.rotation.x = -.4; lect.add(lt);
    for (const s of [-1, 1]) for (const k of [0, 1]) { const pl = stone(1, 9, 1, '#e3d6b8'); pl.position.set(th.x - c.x + s * 7, ty + 4.5, th.z - c.z + 4 + k * 9); KEEP.add(pl); }
    KEEP.updateMatrixWorld(true);
  }
  L.castleObj = name => KO[name] || null;
  L.castleRestore = p => { M.restore = p; for (const c of RUIN) { c.scale.setScalar(.55 + .45 * p); c.material.color.copy(lin('#9f4a38')).lerp(lin('#d8664a'), p); } };

  // ------------------------------------------------------------------ the white cloud mass (open path, dissolve)
  const MIST = new THREE.Group(); scene.add(MIST); const puffs = [], lights = []; const mistCol = new THREE.Color(1, 1, 1), GOLD = new THREE.Color(0xffd98a); let mistA = 0, mistDis = 0;
  const cloudTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); for (let i = 0; i < 9; i++) { const x = 64 + Math.cos(i * 2.4) * 22 * (i % 3) / 2, y = 64 + Math.sin(i * 2.4) * 16 * (i % 3) / 2, r = 40 - (i % 3) * 6; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); } return new THREE.CanvasTexture(c); })();
  function buildMist() {
    const m = L.MIST, r0 = Math.min(m.r * .8, (S.CFG.clearR || 0) + 12); for (let i = 0; i < 420; i++) { // even over the ring between the clear area and the edge, plus a high layer
      const low = i < 340, a = hash(i, 3) * TAU, u = hash(i, 4), r = low ? Math.sqrt(lerp(r0 * r0, (m.r * 1.03) ** 2, u)) : m.r * Math.sqrt(u) * .9, x = m.x + Math.cos(a) * r, z = m.z + Math.sin(a) * r;
      const sz = low ? 26 + hash(i, 5) * 34 : 60 + hash(i, 5) * 70, y = L.ground(x, z) + (low ? 5 + hash(i, 6) * 42 : 58 + hash(i, 6) * 50);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: .85, depthWrite: false, fog: false })); sp.scale.set(sz * 1.5, sz, 1); sp.position.set(x, y, z); sp.userData = { o: low ? .92 : .7, k: 0 }; MIST.add(sp); puffs.push(sp);
    }
    paintMist();
  }
  function paintMist() {
    for (const p of puffs) { p.material.opacity = p.userData.o * (1 - mistDis) * (1 - mistA * (.18 + .82 * p.userData.k)); p.material.color.copy(mistCol).lerp(GOLD, Math.min(1, mistDis * 1.6)); }
    MIST.visible = mistDis < .999;
  }
  function corridor(pts) { // how much each puff sits on the path of lights (1 on it, 0 far)
    for (const p of puffs) { let d = 1e9; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], ex = b.x - a.x, ez = b.z - a.z, l = ex * ex + ez * ez || 1, t = clamp(((p.position.x - a.x) * ex + (p.position.z - a.z) * ez) / l, 0, 1); d = Math.min(d, Math.hypot(a.x + ex * t - p.position.x, a.z + ez * t - p.position.z)); } p.userData.k = 1 - sst(16, 52, d); }
  }
  DEV.mistProj = () => { camera.updateMatrixWorld(); const out = []; for (const p of puffs) { const d = p.position.distanceTo(camera.position); if (d > 140) continue; const v = p.position.clone().project(camera); out.push([Math.round(d), +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(3), Math.round(p.scale.y), Math.round(p.position.y)]); } return out; };
  DEV.mistInfo = () => { const cp = camera.position; let near = 0, vis = 0; for (const p of puffs) { if (p.material.opacity > .2) vis++; if (p.position.distanceTo(cp) < 120 && p.material.opacity > .2) near++; } return { visible: MIST.visible, n: puffs.length, vis, near, mistA, mistDis, cam: cp.toArray().map(Math.round), col: mistCol.getHexString() }; };
  L.mistVisual = {
    open(a, pts) {
      M.mistOpen = a; M.mistPts = pts ? pts.length : 0;
      if (pts && lights.length !== pts.length) { lights.forEach(l => MIST.remove(l)); lights.length = 0; pts.forEach(p => { const g = L.glowSprite(0xfff0c0, 2.2, 0); g.position.copy(p); MIST.add(g); lights.push(g); }); corridor(pts); }
      lights.forEach((l, i) => { l.material.opacity = clamp(a * 1.4 - i * .015, 0, 1) * .95; }); mistA = a; paintMist();
    },
    dissolve(t) { M.dissolve = t; mistDis = t; paintMist(); },
  };

  // ------------------------------------------------------------------ lighthouse pieces from the build records
  const BUILT = new THREE.Group(); scene.add(BUILT); let builtN = -1;
  function syncBuilds() {
    if (M.builds.length === builtN) return; builtN = M.builds.length; while (BUILT.children.length) BUILT.remove(BUILT.children[0]);
    for (const r of M.builds) {
      if (/lamp|lanterna/.test(r.t)) { const g = new THREE.Group(); g.position.set(r.x, r.y, r.z); const base = stone(2.2, .4, 2.2, '#8b5a3c'); base.position.y = .2; g.add(base); const glass = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, 1.4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.3, .8), transparent: true, opacity: .8 })); glass.position.y = 1.1; g.add(glass); const cap = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1, 8), new THREE.MeshStandardMaterial({ color: lin('#c9573f') })); cap.position.y = 2.3; g.add(cap); BUILT.add(g); continue; }
      const m = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, r.h || 3, 14), new THREE.MeshStandardMaterial({ color: lin(Math.round(r.y / 3) % 2 ? '#efe3c8' : '#c9573f'), roughness: .9 })); m.position.set(r.x, r.y + (r.h || 3) / 2, r.z); m.castShadow = m.receiveShadow = true; BUILT.add(m);
    }
  }

  // ------------------------------------------------------------------ the player figure
  const PLY = { root: new THREE.Group(), I: null, st: {} }; scene.add(PLY.root);
  { const b = new THREE.Mesh(THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(.3, 1, 4, 8) : new THREE.CylinderGeometry(.3, .3, 1.6, 10), new THREE.MeshStandardMaterial({ color: lin('#e8eef4') })); b.position.y = .85; b.castShadow = true; PLY.root.add(b); PLY.stub = b; }
  L.loadModel('mage_f').then(src => { if (!src || !L.instRigged) return; const I = L.instRigged(src); PLY.I = I; PLY.root.remove(PLY.stub); PLY.root.add(I.root); });
  function poseHero(dt, t) { PLY.root.position.set(L.P.x, L.P.y, L.P.z); PLY.root.rotation.y = L.P.ry; if (PLY.I && L.humanAnim) { const s = PLY.st; s.speed = L.P.speed || 0; s.t = t; s.dt = dt || .016; s.air = 0; s.swim = 0; s.ride = 0; s.now = t * 1000; s.turn = 0; L.humanAnim(PLY.I.rig, s); } }

  // ------------------------------------------------------------------ camera
  const camS = { yaw: L.cam.yaw, pitch: .28, dist: 7.5 };
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  function placeCamera() {
    const c = S.camera;
    if (c) { camera.position.copy(v3(c.p)); camera.lookAt(v3(c.t)); if (c.fov && camera.fov !== c.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); } }
    else {
      if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
      if (DEV.view) { camera.position.copy(v3(DEV.view.p)); camera.lookAt(v3(DEV.view.t)); }
      else { const t = new THREE.Vector3(L.P.x, L.P.y + 1.4, L.P.z), cp = Math.cos(camS.pitch); camera.position.set(t.x - Math.sin(camS.yaw) * cp * camS.dist, t.y + Math.sin(camS.pitch) * camS.dist, t.z - Math.cos(camS.yaw) * cp * camS.dist); camera.lookAt(t); }
    }
    L.cam.yaw = camS.yaw; L.cam.pitch = camS.pitch;
    // the meadow and the sun follow what the camera looks at
    const look = new THREE.Vector3(); camera.getWorldDirection(look); const f = camera.position.clone().addScaledVector(look, 30);
    groundAt(f.x, f.z); const sd = sun.userData.dir || new THREE.Vector3(0, 1, 0); sun.position.set(f.x + sd.x * 150, f.y + sd.y * 150, f.z + sd.z * 150); sun.target.position.copy(f); sky.position.copy(camera.position);
  }
  DEV.render = () => { syncBuilds(); placeCamera(); renderer.render(scene, camera); DEV.frames = (DEV.frames || 0) + 1; return DEV.frames; };

  // ------------------------------------------------------------------ interactive loop (not in shot mode)
  const keys = {}; let tPrev = performance.now(), tAll = 0;
  addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyE') useNearest(); if (e.code === 'KeyJ') U.openJournal(); if (e.code === 'KeyM') U.toggleSpells(); });
  addEventListener('keyup', e => { keys[e.code] = false; });
  let drag = null; cv.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; }); addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', e => { if (!drag) return; camS.yaw -= (e.clientX - drag[0]) * .0065; camS.pitch = clamp(camS.pitch + (e.clientY - drag[1]) * .0045, -.3, 1.3); drag = [e.clientX, e.clientY]; });
  cv.addEventListener('wheel', e => { camS.dist = clamp(camS.dist * (1 + Math.sign(e.deltaY) * .1), 2.5, 60); }, { passive: true });
  function nearest() { const l = S.interactables(L.P.x, L.P.z, 3, L.P.y); return l[0] || null; }
  function useNearest() { const n = nearest(); if (n) S.interact(n.id); }
  const prompt = document.getElementById('prompt');
  function loop(now) {
    const dt = Math.min(.05, (now - tPrev) / 1000); tPrev = now; tAll += dt;
    if (!S.busy && !S.uiOpen) {
      const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      const sp = keys.ShiftLeft ? 9 : 4.5; L.P.speed = (f || r) ? sp : 0;
      if (f || r) { const a = camS.yaw + Math.atan2(-r, f); L.P.x += Math.sin(a) * sp * dt; L.P.z += Math.cos(a) * sp * dt; L.P.ry = a; const g = L.ground(L.P.x, L.P.z); L.P.y = Math.max(g, S.mods().waterWalk ? .02 : g); }
    }
    S.tick(dt); poseHero(dt, tAll); DEV.render();
    const n = nearest(); prompt.style.display = n && !S.uiOpen && !S.busy ? 'block' : 'none'; if (n) prompt.textContent = (n.label || '') + ' (E)';
    if (!SHOTS) requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ dev panel
  const logBox = document.getElementById('log');
  const log = s => { logBox.textContent = s; };
  document.getElementById('hour').addEventListener('input', e => setHour(+e.target.value));
  document.getElementById('dev').addEventListener('click', e => {
    const a = e.target.dataset && e.target.dataset.a, sc = e.target.dataset && e.target.dataset.s; if (!a && !sc) return; e.stopPropagation();
    if (sc) return DEV.scene(sc);
    if (a === 'chain') { const r = DEV.chain(); log(r.ok + ' ok, ' + r.bad + ' falhas\n' + r.steps.filter(s => /^FAIL/.test(s)).join('\n')); }
    if (a === 'mid') { DEV.mid(); log('meio do jogo'); }
    if (a === 'journal') U.openJournal(); if (a === 'spells') U.toggleSpells(); if (a === 'use') useNearest();
    if (a === 'sleep') { S.event('slept', { x: L.P.x, z: L.P.z }); L.clock.skipToDawn(); setHour(6.05); S.event('woke', {}); }
  });

  // ------------------------------------------------------------------ state helpers for the scenes
  const D = S.debug, P = () => L.save.player;
  const T = (p, f) => L.T(p, f);
  function quiet(fn) { const o = U.opts.sound; U.opts.sound = false; try { fn(); } finally { U.opts.sound = o; } U.closeAll(); }
  function tick(sec, step) { step = step || .1; for (let t = 0; t < sec; t += step) { S.tick(step); poseHero(step, (tAll += step)); } }
  DEV.mid = function () {
    quiet(() => {
      setHour(10);
      for (const id of ['n01', 'n02', 'n03', 'n04', 'n12', 's24', 's01', 'n05', 's02', 's25', 'r1', 'n07', 's07', 's08', 's10']) { if (!P().notes[id]) D.read(id); U.closeAll(); }
      const t0 = Date.now() - 86400000 * 6; let k = 0; for (const id in P().notes) P().notes[id] = t0 + (k++) * 3600000 * 5;
      S.event('fire_lit', { x: 0, z: 0, poi: 'cottage' }); S.event('cooked', { item: 'pao' });
      P().dreams.d1 = t0 + 7200000; P().dreams.d2 = t0 + 86400000;
      tick(3); D.complete('k_fogo'); U.closeAll();
      D.give('madeira', 10); D.give('corda', 4); D.teleport('windmill_broken'); tick(.5); S.interact('g_windmill'); U.closeAll(); tick(.5);
      for (let i = 0; i < 2; i++) { D.goObj('mill_' + i); tick(.4); S.interact('mill_' + i); U.closeAll(); }
      D.teleport('totem_jardim'); tick(.5); S.interact('g_totem_jardim'); U.closeAll(); for (let i = 0; i < 3; i++) S.event('harvest', { crop: 'cenoura', own: true }); tick(3); S.interact('g_totem_jardim'); U.closeAll();
      setHour(21); D.teleport('deer_meadow'); tick(.5); S.event('fed', { species: 'cervo_lunar', id: 'c1' }); D.day(1); setHour(22); S.event('fed', { species: 'cervo_lunar', id: 'c1' }); tick(2); U.closeAll();
      setHour(10); D.teleport('turtle_shrine'); tick(.5); S.interact('g_tartaruga'); U.closeAll();
      D.give('flor_lua', 1); D.teleport('totem_choro'); tick(.5); S.interact('g_totem_choro'); U.closeAll(); tick(5);
      P().dreams.d3 = Date.now() - 3600000;
      tick(30); U.closeAll(); setHour(10);
    });
  };
  function at(id, dx, dz, h) { const p = L.poi(id); L.P.x = p.x + (dx || 0); L.P.z = p.z + (dz || 0); L.P.y = Math.max(L.ground(L.P.x, L.P.z), p.y != null && p.y - L.ground(L.P.x, L.P.z) > 4 ? p.y : -1e9); if (h != null) setHour(h); }
  function view(p, t) { DEV.view = { p, t }; }
  function face(tx, tz) { L.P.ry = Math.atan2(tx - L.P.x, tz - L.P.z); }
  async function models() { for (let i = 0; i < 200 && pending > 0; i++) await new Promise(r => setTimeout(r, 50)); }
  const pumpUI = n => { for (let i = 0; i < (n || 200); i++) U.tick(.05); };

  // ------------------------------------------------------------------ scenes for the screenshots
  const NOTE_SCENES = { note: 'n01', note_letter: 'n02', note_stone: 'n03', note_diary: 'n04', note_rune: 'r1', note_wood: 's05', note_drawing: 's10', note_last: 'n11' };
  const SCENES = {
    async journal(tab) { if (!DEV.midDone) { DEV.mid(); DEV.midDone = true; } at('cottage', 4, 6, 10); view([L.P.x - 4, L.P.y + 2.4, L.P.z + 7], [L.P.x, L.P.y + 1.2, L.P.z]); U.closeAll(); U.openJournal(tab); },
    async note(id) { if (!DEV.midDone) { DEV.mid(); DEV.midDone = true; } at(L.TL('notes.' + id).poi || 'cottage', 3, 5, id === 'r1' ? 21 : 10); view([L.P.x - 3, L.P.y + 2.2, L.P.z + 6], [L.P.x, L.P.y + 1.1, L.P.z]); delete P().notes[id]; quiet(() => { }); D.read(id); },
    async dialog() {
      at('turtle_shrine', 2, -7, 10); U.closeAll(); const tx = L.P.x - .8, tz = L.P.z + 3.8;
      if (!DEV.turtle) { const src = await L.loadModel('turtle'); if (src) { let I = null; try { I = L.instRigged(src); } catch (e) { } const r = I ? I.root : src.clone(true); r.updateMatrixWorld(true); const sz = new THREE.Box3().setFromObject(r).getSize(new THREE.Vector3()); r.scale.setScalar(3.4 / Math.max(.1, sz.x, sz.z)); r.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(r); DEV.turtle = r; } }
      if (DEV.turtle) { DEV.turtle.position.set(tx, L.ground(tx, tz), tz); DEV.turtle.rotation.y = Math.atan2(L.P.x - tx, L.P.z - tz); }
      face(tx, tz); view([L.P.x + 3.6, L.P.y + 2.6, L.P.z - 4.4], [(L.P.x + tx) / 2, L.P.y + .1, (L.P.z + tz) / 2]);
      tick(.5); S.interact('g_tartaruga'); pumpUI(400);
    },
    async learn() { at('deer_meadow', 0, 0, 20.5); view([L.P.x - 4, L.P.y + 2, L.P.z + 6], [L.P.x, L.P.y + 1.4, L.P.z]); U.closeAll(); S.emit('learn', { id: 'luz', name: T('spells.luz.name') }); },
    async spells() {
      at('hill_top', 0, 0, 16); camS.yaw = 2.3; camS.pitch = .3; camS.dist = 7; U.closeAll();
      for (const id of ['faisca', 'brotar', 'brisa', 'luz', 'mare', 'ponte', 'revelar']) D.learn(id); U.closeAll();
      L.save.player.st.mana = 100; S.castSpell('luz'); S.castSpell('faisca'); tick(1.2); L.save.player.st.mana = 32; U.closeAll(); tick(.3); U.toggleSpells(); pumpUI(20);
    },
    async star() { if (!DEV.midDone) { DEV.mid(); DEV.midDone = true; } at('lunar_glade', 0, 3, 21.5); view([L.P.x - 4, L.P.y + 2.2, L.P.z + 7], [L.P.x, L.P.y + 1.6, L.P.z]); U.closeAll(); pumpUI(20); S.emit('fragment', { k: 2, n: 2, text: T('ui.frag_got') }); },
    async dream() { at('cottage', 2, 2, 6.1); U.closeAll(); S.emit('dream', { id: 'd3', text: T('dreams.d3.text') }); },
    async mist() {
      at('mist_sign', 0, 0, 11); U.closeAll(); DEV.view = null; const m = L.MIST; const a = Math.atan2(L.P.x - m.x, L.P.z - m.z);
      L.P.x = m.x + Math.sin(a) * (m.r - 40); L.P.z = m.z + Math.cos(a) * (m.r - 40); L.P.y = L.ground(L.P.x, L.P.z); face(m.x, m.z); camS.yaw = L.P.ry; camS.pitch = .2; camS.dist = 7;
      for (let i = 0; i < 60 && !(S.mistState().white > .82); i++) tick(.1); pumpUI(30);
    },
    async reveal() {
      U.closeAll(); D.learn('revelar'); U.closeAll(); delete P().flags.castle_seen; delete P().flags.pathSeen;
      const m = L.MIST, g = L.poi('castle_gate'); const a = Math.atan2(L.poi('mist_sign').x - m.x, L.poi('mist_sign').z - m.z); L.P.x = m.x + Math.sin(a) * (m.r + 8); L.P.z = m.z + Math.cos(a) * (m.r + 8); L.P.y = L.ground(L.P.x, L.P.z); setHour(16.5); DEV.view = null;
      L.save.player.st.mana = 100; S.castSpell('revelar'); U.closeAll();
      for (let i = 0; i < 900 && !(S.busy && S.camera); i++) { const dx = g.x - L.P.x, dz = g.z - L.P.z, d = Math.hypot(dx, dz); L.P.x += dx / d * .7; L.P.z += dz / d * .7; L.P.y = L.ground(L.P.x, L.P.z); L.P.ry = Math.atan2(dx, dz); tick(.1); }
      tick(4.2); pumpUI(30);
    },
    async ending(phase) {
      U.closeAll(); D.learn('despertar'); U.closeAll(); D.world('gate'); D.give('estrela', 1);
      if (!DEV.endT) { const th = L.poi('throne'); at('throne', 0, 3, 6.4); face(th.x, th.z); tick(1); await models(); S.playEnding(); DEV.endT = 0; }
      const want = { line: 49.8, title: 72.5, personal: 78 }[phase]; tick(want - DEV.endT, .1); DEV.endT = want;
      if (phase === 'personal') S.emit('ending', { phase: 'personal', title: 'Para você', text: '(texto de exemplo: a mensagem pessoal é configurada fora do repositório e aparece aqui, num cartão)' });
      pumpUI(30);
    },
    async world_props() {
      at('hill_top', 0, 0, 9.5); U.closeAll(); const p = { x: L.P.x, z: L.P.z }, row = ['table', 'lectern', 'diary', 'drawing', 'sign', 'stone', 'bottle', 'rune', 'star', 'feather', 'chest', 'letter'];
      if (!DEV.props) { DEV.props = new THREE.Group(); scene.add(DEV.props); row.forEach((k, i) => { const v = D.visual(k); const x = p.x + (i % 6 - 2.5) * 1.6, z = p.z - 2 - Math.floor(i / 6) * 2.4; v.position.set(x, L.ground(x, z), z); DEV.props.add(v); if (k === 'rune' && v.userData.rune) { v.userData.rune.opacity = 1; v.userData.glow.material.opacity = .6; } }); }
      L.P.x += 30; view([p.x, L.ground(p.x, p.z) + 2.6, p.z + 2.8], [p.x, L.ground(p.x, p.z) + .6, p.z - 3.6]); await models();
    },
    async world_bird() {
      at('hill_top', 6, 6, 9); U.closeAll(); D.endFx(); tick(.2); // the light from the spell scene goes out first
      D.bird('s29'); const circling = () => D.birds().filter(x => x.state === 'circle').sort((a, c) => Math.hypot(a.x - L.P.x, a.z - L.P.z) - Math.hypot(c.x - L.P.x, c.z - L.P.z))[0];
      let b = null; for (let i = 0; i < 400; i++) { tick(.1); b = circling(); if (b && b.t > 2) break; }
      await models(); b = circling();
      if (b) { const ax = b.x - L.P.x, az = b.z - L.P.z, al = Math.hypot(ax, az) || 1, mx = L.P.x + ax * .45, mz = L.P.z + az * .45; face(b.x, b.z); view([mx + az / al * 6.5 - ax / al * 2, L.P.y + 1.7, mz - ax / al * 6.5 - az / al * 2], [mx, L.P.y + 2, mz]); }
    },
    async world_bridge() { // from the bluff over the bay, towards the open water
      const bc = { x: -330, z: 240 }, a0 = .9, sx = bc.x + Math.sin(a0) * 74, sz = bc.z + Math.cos(a0) * 74; L.P.x = sx; L.P.z = sz; L.P.y = L.ground(sx, sz); setHour(16.6);
      U.closeAll(); D.learn('ponte'); U.closeAll(); const yaw = Math.atan2(bc.x - sx, bc.z - sz), dx = Math.sin(yaw), dz = Math.cos(yaw); L.P.ry = camS.yaw = yaw; tick(.2);
      L.save.player.st.mana = 100; S.castSpell('ponte', { yaw, pitch: 0 }); tick(2.4);
      const y0 = L.P.y; L.P.x += dx * 8; L.P.z += dz * 8; L.P.y = y0; L.P.speed = 3; poseHero(.3, tAll += .3); L.P.speed = 0;
      view([sx - dx * 4 + dz * 13, y0 + 5.5, sz - dz * 4 - dx * 13], [sx + dx * 13, y0 - .6, sz + dz * 13]);
    },
    async world_beam() {
      const lh = L.poi('lighthouse'), gy = L.ground(lh.x, lh.z);
      if (!M.builds.length) { for (let k = 0; k < 5; k++) M.builds.push({ id: 'b' + k, t: 'wall', x: lh.x + 1, y: gy + k * 3, z: lh.z, h: 3 }); M.builds.push({ id: 'lamp1', t: 'lighthouse_lamp', x: lh.x + 1, y: gy + 15, z: lh.z, h: 2 }); }
      setHour(21.5); D.world('lighthouse', { x: lh.x + 1, y: gy + 15, z: lh.z }); at('lighthouse', 30, -26); U.closeAll(); tick(4);
      const c = L.poi('bay_chest'), mx = (lh.x + c.x) / 2, mz = (lh.z + c.z) / 2, dx = c.x - lh.x, dz = c.z - lh.z, dl = Math.hypot(dx, dz); // from the side of the beam
      view([mx + dz / dl * 72 + dx / dl * 10, gy + 26, mz - dx / dl * 72 + dz / dl * 10], [mx - dx / dl * 6, 5, mz - dz / dl * 6]);
    },
    async world_throne() {
      const th = L.poi('throne'); at('throne', 1.5, 5.5, 6.2); U.closeAll(); face(th.x, th.z); tick(1.5); await models(); tick(.5);
      view([th.x - 3.4, L.ground(th.x, th.z) + 2.9, th.z + 8], [th.x + .5, L.ground(th.x, th.z) + 1.3, th.z]);
    },
  };
  // order matters a little: the state builds up (middle of the game, then the hidden place, then the finale)
  DEV.scenes = ['note', 'note_letter', 'note_stone', 'note_diary', 'note_rune', 'note_wood', 'note_drawing', 'journal_cartas', 'journal_sonhos', 'journal_pensamentos', 'journal_tarefas', 'dialog', 'learn', 'spells', 'star', 'dream', 'world_props', 'world_bird', 'world_bridge', 'world_beam', 'world_throne', 'note_last', 'mist', 'reveal', 'ending_line', 'ending_title', 'ending_personal'];
  DEV.scene = async function (name) {
    DEV.busy = true; DEV.view = null;
    try {
      if (NOTE_SCENES[name]) await SCENES.note(NOTE_SCENES[name]);
      else if (/^journal_/.test(name)) await SCENES.journal(name.slice(8));
      else if (/^ending_/.test(name)) await SCENES.ending(name.slice(7));
      else await SCENES[name]();
      U.flush(); await models(); tick(.05); poseHero(.016, tAll); DEV.render();
    } catch (e) { console.error('scene ' + name, e); }
    DEV.busy = false; return { name, open: U.open, busy: S.busy, frames: DEV.frames };
  };
  DEV.settled = () => !DEV.busy && pending === 0;
  DEV.chain = function () { const r = window.CHAIN.run({ verbose: false }); DEV.render(); return { ok: r.ok, bad: r.bad, steps: r.steps.filter(s => /^FAIL/.test(s)) }; };

  // ------------------------------------------------------------------ boot
  const list = document.getElementById('scenes'); for (const s of DEV.scenes) { const b = document.createElement('button'); b.dataset.s = s; b.textContent = s; list.appendChild(b); }
  S.CFG.clearR = 70; // the mock world is compact (cloud disc of 240 m); the real one keeps the default
  setHour(9); buildKeep(); buildMist();
  S.init(); U.init({ onPause: () => { } });
  L.P.x = 6; L.P.z = 14; L.P.y = L.ground(6, 14);
  DEV.ready = true;
  if (!SHOTS) requestAnimationFrame(loop); else DEV.render();
})();
