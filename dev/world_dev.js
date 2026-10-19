/* World Lab (dev only): boots the engine + world modules with a free-fly camera.
   URL params:
     cam=x,y,z        camera position (y omitted or "g" -> ground + agl)        agl=2   eye height above ground
     look=x,y,z       look-at target (y omitted -> ground there)                 yaw=deg&pitch=deg  (instead of look; yaw 0 = north)
     poi=<id>         start next to a POI (pos/look then relative to it)         fov=55
     t=day|golden|dawn|night   time of day      far=6000  terrain far distance (L.TERRAIN_FAR)
     top=1            top-down overview of the whole world (orthographic)       q=alto|medio|baixo
     scatter=0|1      trees/rocks (default 1)   still=1   no animation loop (for screenshots: call DEV.render())
     hud=0            hide the HUD
   window.DEV: settle() builds everything the camera wants, render() draws one frame, go(x,y,z,tx,ty,tz), info(). */
'use strict';
(function (L) {
  const QS = new URLSearchParams(location.search);
  const num = (k, d) => { const v = QS.get(k); return v == null || v === '' ? d : Number(v); };
  const vec = k => { const v = QS.get(k); return v ? v.split(',').map(s => (s === 'g' || s === '') ? null : Number(s)) : null; };
  const D2R = Math.PI / 180;
  if (QS.get('hud') === '0') document.body.classList.add('nohud');
  const hud = document.getElementById('hud');
  const cam = L.camera; cam.rotation.order = 'YXZ';
  const DEV = window.DEV = { ready: false, t0: performance.now(), frames: 0 };
  let yaw = 0, pitch = 0, speed = 40;

  function setLook(x, y, z) {
    const dx = x - cam.position.x, dy = y - cam.position.y, dz = z - cam.position.z;
    yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz)); applyRot();
  }
  function applyRot() { cam.rotation.set(pitch, yaw, 0); cam.updateMatrixWorld(); }
  DEV.go = function (x, y, z, tx, ty, tz) {
    if (y == null || isNaN(y)) y = L.rawH(x, z) + num('agl', 2);
    cam.position.set(x, y, z);
    if (tx != null) { if (ty == null || isNaN(ty)) ty = L.rawH(tx, tz); setLook(tx, ty, tz); } else applyRot();
    cam.updateMatrixWorld();
  };

  // ---------------------------------------------------------------- interim cloud sea (LOOK's L.cloudSea replaces it)
  function interimCloudSea() {
    const tex = L.cloudMaskTexture();
    const U = { tMask: { value: tex }, uTime: { value: 0 }, uWS: { value: L.WS } };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, U]),
      vertexShader: `varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D tMask; uniform float uTime, uWS; varying vec3 vW;
        #include <fog_pars_fragment>
        float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){float s=0.,a=.5;for(int k=0;k<5;k++){s+=a*vn(p);p=p*2.03+vec2(17.1,-9.7);a*=.5;}return s;}
        void main(){
          vec2 uv = (vW.xz + uWS) / (2. * uWS);
          float m = (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? .55 : texture2D(tMask, uv).r;
          vec2 p = vW.xz / 900. + vec2(uTime * .004, uTime * .002);
          float n = fbm(p), n2 = fbm(vW.xz / 160. - vec2(uTime * .01, 0.));
          float cov = m * 1.25 - .35 + (n - .5) * .9 + (n2 - .5) * .35;
          float a = smoothstep(.0, .35, cov);
          vec3 lit = vec3(.97, .98, 1.), sh = vec3(.70, .78, .90);
          vec3 c = mix(sh, lit, smoothstep(.25, .75, n2 * .6 + n * .5));
          gl_FragColor = vec4(c, a * .96);
        #include <fog_fragment>
        #include <encodings_fragment>
        }`
    });
    const g = new THREE.PlaneGeometry(60000, 60000, 1, 1); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat); m.position.y = L.CLOUD_Y; m.renderOrder = 4; m.frustumCulled = false; m.name = 'interim_cloudsea'; L.scene.add(m);
    DEV.seaU = mat.uniforms;
  }

  // ---------------------------------------------------------------- sky / light setup for either engine
  const TODN = QS.get('t') || 'day';
  function sunVec(name) { const el = { day: .78, golden: .09, dawn: .04, night: -.5 }[name] ?? .78, az = num('sunaz', -.9); return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)); }
  function setupLook() {
    if (L.skyInit && L.setTimeOfDay) {                     // v5 LOOK engine
      if (L.makeMaterials) try { L.makeMaterials(); } catch (e) { console.warn('makeMaterials', e.message); }
      L.skyInit();
      L.setTimeOfDay(L.todPreset ? L.todPreset(TODN, num('sunaz', -.9)) : { sunDir: sunVec(TODN) });
      if (L.cloudSea) { L.cloudSea.setY(L.CLOUD_Y); L.cloudSea.setDensityMap(L.cloudMaskTexture(), -L.WS, -L.WS, 2 * L.WS); }
      if (L.mistVisual && L.mistVisual.setDisc) try { L.mistVisual.setDisc(L.MIST.x, L.MIST.z, L.MIST.r); } catch (e) { }
      DEV.engine = 'v5';
    } else {                                                  // v4 engine: its sky dome + lights, interim cloud sea
      if (L.makeSky) L.makeSky();
      const s = sunVec(TODN); if (L.skyU) { L.skyU.sunDir.value.copy(s); L.skyU.night.value = TODN === 'night' ? 1 : 0; L.skyU.dusk.value = TODN === 'golden' || TODN === 'dawn' ? .7 : 0; }
      if (L.sun) { L.sun.position.copy(s).multiplyScalar(400); L.sun.target.position.set(0, 0, 0); L.sun.castShadow = false; if (TODN === 'golden') { L.sun.color.setHex(0xffc890); L.sun.intensity = 1.2; } }
      if (L.hemi) L.hemi.intensity = .6;
      L.scene.fog.density = num('fog', .00016);
      interimCloudSea();
      DEV.engine = 'v4';
    }
    cam.far = Math.max(cam.far, num('camfar', 16000)); cam.fov = num('fov', 55); cam.near = .5; cam.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- free-fly controls
  const keys = {};
  addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyH') document.body.classList.toggle('nohud'); if (e.code === 'KeyP') console.log('cam=' + [cam.position.x, cam.position.y, cam.position.z].map(v => v.toFixed(0)).join(',') + '&yaw=' + (-yaw / D2R).toFixed(1) + '&pitch=' + (pitch / D2R).toFixed(1)); });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('wheel', e => { speed = Math.max(2, Math.min(3000, speed * (e.deltaY > 0 ? .8 : 1.25))); });
  let drag = null;
  addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', e => { if (!drag) return; yaw -= (e.clientX - drag[0]) * .004; pitch = Math.max(-1.5, Math.min(1.5, pitch - (e.clientY - drag[1]) * .004)); drag = [e.clientX, e.clientY]; applyRot(); });
  const _f = new THREE.Vector3(), _r = new THREE.Vector3();
  function move(dt) {
    const sp = speed * (keys.ShiftLeft || keys.ShiftRight ? 5 : 1) * dt;
    cam.getWorldDirection(_f); _r.crossVectors(_f, cam.up).normalize();
    if (keys.KeyW || keys.ArrowUp) cam.position.addScaledVector(_f, sp);
    if (keys.KeyS || keys.ArrowDown) cam.position.addScaledVector(_f, -sp);
    if (keys.KeyD || keys.ArrowRight) cam.position.addScaledVector(_r, sp);
    if (keys.KeyA || keys.ArrowLeft) cam.position.addScaledVector(_r, -sp);
    if (keys.KeyE || keys.Space) cam.position.y += sp;
    if (keys.KeyQ) cam.position.y -= sp;
    const g = L.ground(cam.position.x, cam.position.z) + 1; if (cam.position.y < g) cam.position.y = g;
  }

  // ---------------------------------------------------------------- frame
  let T = 0, last = performance.now();
  function tick(dt) {
    T += dt;
    if (L.lookTick) L.lookTick(dt, 10 + T, cam);
    if (DEV.seaU) DEV.seaU.uTime.value = T;
    if (L.waterU && L.waterU.uTime) L.waterU.uTime.value = T;
    if (L.flowMat && L.flowMat.uniforms && L.flowMat.uniforms.uTime) L.flowMat.uniforms.uTime.value = T;
    if (L.sky && !L.skyInit) L.sky.position.copy(cam.position);
    if (L.stars && !L.skyInit) L.stars.position.copy(cam.position);
    L.terrainUpdate(cam.position, 6);
    if (DEV.scatter && L.scatterUpdate) L.scatterUpdate(cam, 4);
    if (L.worldUpdate && L.worldReady && L.POIGROUPS) L.worldUpdate(dt, T);
    L.trimTiles(cam.position.x, cam.position.z);
  }
  DEV.render = function () {
    cam.updateMatrixWorld(); tick(1 / 30);
    const inf = L.renderer.info; inf.autoReset = false; inf.reset(); L.render(); inf.autoReset = true; DEV.frames++;
    const S = L.terrainStats, ri = inf.render;
    return { calls: ri.calls, tris: ri.triangles, nodes: S.visible, built: S.built, pending: S.pending };
  };
  DEV.settle = function (maxMs) {   // build everything the camera wants (no budget): for screenshots/tests
    const t0 = performance.now(); maxMs = maxMs || 60000; cam.updateMatrixWorld();
    while (!L.terrainUpdate(cam.position, 1e9) && performance.now() - t0 < maxMs) { }
    if (L.scatterSettle) L.scatterSettle(cam.position.x, cam.position.z, cam);
    return { ms: Math.round(performance.now() - t0), built: L.terrainStats.built, visible: L.terrainStats.visible, tris: L.terrainStats.tris, nodes: L.terrainStats.nodes };
  };
  DEV.info = function () {
    const p = cam.position; return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), yaw: +(-yaw / D2R).toFixed(1), pitch: +(pitch / D2R).toFixed(1), ground: +L.ground(p.x, p.z).toFixed(1), region: L.region(p.x, p.z), stats: L.terrainStats };
  };
  function loop() {
    const n = performance.now(), dt = Math.min(.1, (n - last) / 1000); last = n;
    move(dt); tick(dt); L.render(); DEV.frames++;
    if (DEV.frames % 10 === 0 && !document.body.classList.contains('nohud')) {
      const p = cam.position, S = L.terrainStats, ri = L.renderer.info.render; const r = L.REGIONS[L.region(p.x, p.z)];
      hud.textContent = `x ${p.x.toFixed(0)}  y ${p.y.toFixed(0)}  z ${p.z.toFixed(0)}   chão ${L.ground(p.x, p.z).toFixed(1)}   ${r ? r.id + ' ' + r.nome : ''}\n` +
        `yaw ${(-yaw / D2R).toFixed(0)}  pitch ${(pitch / D2R).toFixed(0)}  vel ${speed.toFixed(0)}\n` +
        `nós ${S.visible}/${S.nodes}  tris ${(ri.triangles / 1000).toFixed(0)}k  draws ${ri.calls}  pend ${S.pending}  build ${S.last.toFixed(1)} ms`;
    }
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    const t0 = performance.now();
    const wantScatter = QS.get('scatter') !== '0' && !!L.scatterInit;
    const loads = [L.worldLoad()];
    if (wantScatter && L.loadAll) loads.push(L.loadAll());
    await Promise.all(loads);
    DEV.tLoad = Math.round(performance.now() - t0);
    setupLook();
    L.TERRAIN_FAR = num('far', L.TERRAIN_FAR);
    L.terrainInit();
    if (wantScatter) { if (L.makeMaterials && !L.MAT) L.makeMaterials(); try { L.scatterInit(); DEV.scatter = true; } catch (e) { console.warn('scatter', e.message); } }
    if (wantScatter && L.worldInit) try { await L.worldInit(); } catch (e) { console.warn('world', e.message); }
    // camera
    if (QS.get('top')) {
      const s = L.WS * 1.02; const oc = new THREE.OrthographicCamera(-s, s, s, -s, 10, 30000); oc.position.set(0, 12000, 0); oc.up.set(0, 0, -1); oc.lookAt(0, 0, 0); oc.updateMatrixWorld();
      L.TERRAIN_FAR = 20000; DEV.top = oc;
      // the overview renders with the ortho camera; LOD uses a high viewpoint
      const r0 = L.render; L.render = () => { if (L.composer) { L.composer.passes[0].camera = oc; } r0(); };
      cam.position.set(0, 12000, 0); cam.rotation.set(-Math.PI / 2, 0, 0); cam.updateMatrixWorld();
      if (!L.composer) { L.render = () => L.renderer.render(L.scene, oc); }
      L.scene.fog && (L.scene.fog.density = 0);
    } else {
      let P = vec('cam'), T = vec('look'); const poi = QS.get('poi') && L.poi(QS.get('poi'));
      const sp = L.SPAWN5 || { x: 0, z: 0, ry: 0 };
      let ox = 0, oz = 0;
      if (poi) { ox = poi.x; oz = poi.z; if (!P) P = [poi.x - 30, null, poi.z + 30]; else { P[0] += ox; P[2] += oz; } if (T) { T[0] += ox; T[2] += oz; } }
      if (!P) P = [sp.x, null, sp.z];
      if (P.length === 2) P = [P[0], null, P[1]];
      if (T && T.length === 2) T = [T[0], null, T[1]];
      if (T) DEV.go(P[0], P[1], P[2], T[0], T[1], T[2]);
      else { yaw = -num('yaw', poi ? 0 : (sp.ry || 0) / D2R) * D2R; pitch = num('pitch', -4) * D2R; DEV.go(P[0], P[1], P[2]); }
    }
    DEV.tInit = Math.round(performance.now() - t0);
    if (QS.get('still')) { DEV.ready = true; return; }
    DEV.ready = true; requestAnimationFrame(loop);
  }
  boot().catch(e => { console.error('boot', e); hud.textContent = 'erro: ' + e.message; DEV.error = e.message; });
})(window.L);
