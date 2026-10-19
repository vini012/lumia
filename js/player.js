/* Lumiar player: rigged hero (hero_f / hero_m, v5 tint zones), controller on terrain + building colliders
   (jump, swim in lakes/rivers/sea, slopes, gliding), riding mounts, third-person camera, remote players.
   Integration A adapters: hero models + palettes (L.HERO_PALETTES), water surface from L.waterAt. B-actors owns this file. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep } = L;
  const TAU = Math.PI * 2;
  const wrapA = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  // v4 colour pairs (kept for old presence records; v5 uses L.HERO_PALETTES)
  L.MAGE_COLORS = [
    { n: 'Safira', robe: 0x3f63c9, hat: 0x2c3f8f, orb: 0x9fd0ff },
    { n: 'Rubi', robe: 0xb8384a, hat: 0x7a1f30, orb: 0xffa0a8 },
    { n: 'Esmeralda', robe: 0x2f9a62, hat: 0x1f5e3e, orb: 0x9fffd0 },
    { n: 'Ametista', robe: 0x7a4ac0, hat: 0x4b2a80, orb: 0xd8b8ff },
    { n: 'Âmbar', robe: 0xd08a2c, hat: 0x8a5418, orb: 0xffd890 },
    { n: 'Rosa', robe: 0xe07aa8, hat: 0xa8467a, orb: 0xffc8e0 },
    { n: 'Neve', robe: 0xe8e8ee, hat: 0x9aa4b8, orb: 0xffffff },
    { n: 'Noite', robe: 0x30344a, hat: 0x1c1f2c, orb: 0xa8b8ff },
  ];
  // v5 hero outfits: 3 palettes per look (sRGB). Zones per the chars manifest: top A/B, bottom A, cape A, hat A.
  L.HERO_PALETTES = {
    f: [
      { n: 'Céu', top: ['#f8f5ef', '#b2dafc'], bottom: '#fbf8f2', cape: '#34508e', hat: '#3a4f86' },
      { n: 'Campo', top: ['#fbf3df', '#e7a6a0'], bottom: '#6f8f5a', cape: '#a8463f', hat: '#7a4a35' },
      { n: 'Lavanda', top: ['#f6f1fa', '#b9a3e3'], bottom: '#4f5d8c', cape: '#5b4a8f', hat: '#3f3566' },
    ],
    m: [
      { n: 'Terra', top: ['#f8f4ec', '#93603a'], bottom: '#5f4c3e', cape: '#34508e', hat: '#3a4f86' },
      { n: 'Musgo', top: ['#f3efe2', '#5f7f4a'], bottom: '#4a4038', cape: '#8f5a2e', hat: '#5a4a32' },
      { n: 'Mar', top: ['#eef3f6', '#3f6f9a'], bottom: '#3d4656', cape: '#a8463f', hat: '#2f3c5c' },
    ],
  };
  // three r128 tint-zone shader hook from the chars manifest (COLOR_0.a = zone id)
  function tintZones(mat, tintA, tintB) {
    mat.vertexColors = true;
    const u = { tintA: { value: tintA.clone() }, tintB: { value: tintB.clone() } };
    mat.userData.tint = u;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (s, r) {
      if (prev) prev.call(this, s, r);
      s.uniforms.tintA = u.tintA; s.uniforms.tintB = u.tintB;
      s.fragmentShader = 'uniform vec3 tintA;\nuniform vec3 tintB;\n' + s.fragmentShader.replace('#include <color_fragment>',
        '#if defined( USE_COLOR_ALPHA )\n  float lzone = floor(vColor.a * 3.0 + 0.5);\n  vec3 ltint = abs(lzone - 2.0) < 0.5 ? tintA : (abs(lzone - 1.0) < 0.5 ? tintB : vec3(1.0));\n  diffuseColor.rgb *= vColor.rgb * ltint;\n#elif defined( USE_COLOR )\n  diffuseColor.rgb *= vColor;\n#endif');
    };
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
    mat.customProgramCacheKey = () => key() + '|lumiarTint';
    mat.needsUpdate = true; return mat;
  }
  const lin = h => new THREE.Color(h).convertSRGBToLinear(), WHITE = new THREE.Color(1, 1, 1);
  L.heroTint = tintZones;

  // tools (objects of tools.json): which tool the hand shows for each action
  const TOOL_FOR = { chop: 'axe', mine: 'pickaxe', build: 'hammer', hoe: 'hoe', cast: 'staff' };
  L.TOOL_FOR = TOOL_FOR;
  let TOOLS = null; const toolsP = () => L.loadModel('tools').then(sc => { if (!sc) return null; if (!TOOLS) { TOOLS = {}; sc.traverse(o => { if (o.parent === sc && o.name) TOOLS[o.name] = o; }); } return TOOLS; });

  // ------------------------------------------------------------------ mage model
  // o: { gender 'f'|'m', pal 0..2 (v5) | ci (v4 colour index, mapped onto a palette) }
  L.makeMage4 = async function (o) {
    o = o || {}; const g = o.gender === 'f' ? 'f' : 'm';
    const src = await L.loadModel('hero_' + g); if (!src) return null;
    const I = L.instRigged(src); const PAL = L.HERO_PALETTES[g]; const pi = ((o.pal != null ? o.pal : o.ci) | 0) % PAL.length; const C = PAL[pi];
    const zone = { top: [C.top[0], C.top[1]], bottom: [C.bottom, '#ffffff'], cape: [C.cape, '#ffffff'], hat: [C.hat, '#ffffff'] };
    const mats = [];
    I.root.traverse(m => {
      if (!m.isMesh) return; const z = /_(top|bottom|cape|hat)$/.exec(m.name); if (!z) return;
      const mt = tintZones(L.cloneMat ? L.cloneMat(m.material) : m.material.clone(), lin(zone[z[1]][0]), lin(zone[z[1]][1])); m.material = mt; mats.push(mt);
      if (z[1] === 'cape' || z[1] === 'hat') m.visible = !!o[z[1]];   // cape / hat: hidden unless asked for
    });
    C.orb = C.orb || 0x9fd0ff;
    const M = { I, root: I.root, rig: I.rig, grip: I.grip, C, g, pal: pi, st: { t: 0, dt: 0, speed: 0 }, tool: null, toolName: '', mats };
    M.part = (name, on) => I.root.traverse(m => { if (m.isMesh && m.name === 'hero_' + g + '_' + name) m.visible = !!on; });
    // tools are attached to grip.R with identity transform: handle along bone +Y, blade along bone +Z
    M.setTool = function (name) {
      if (name === M.toolName) return; M.toolName = name; if (M.tool) { M.tool.parent && M.tool.parent.remove(M.tool); M.tool = null; }
      if (!name || !M.grip) return; toolsP().then(T => {
        if (!T || M.toolName !== name || !T[name]) return; const t = T[name].clone(true); t.position.set(0, 0, 0); t.rotation.set(0, 0, 0); t.scale.setScalar(1);
        t.traverse(m => { if (m.isMesh) { const gl = /_glow/.test(m.name); m.material = gl ? L.MAT.glow : L.MAT.v4; m.castShadow = !gl; } });
        const gl = T[name + '_glow']; if (gl) { const gc = gl.clone(true); gc.position.sub(T[name].position); gc.traverse(m => { if (m.isMesh) m.material = L.MAT.glow; }); t.add(gc); }
        // the bone may be scaled with the skeleton: undo parent world scale
        M.grip.add(t); M.tool = t;
      });
    };
    M.dispose = function () { L.scene.remove(M.root); M.root.traverse(m => { if (m.isSkinnedMesh && m.skeleton) m.skeleton.dispose(); }); mats.forEach(m => m.dispose()); };
    return M;
  };
  // TECH §4 names: L.makeHero(g, look {pal, cape, hat}) / L.animHero(M, dt, t, s)
  L.makeHero = (g, look) => L.makeMage4(Object.assign({ gender: g }, look || {}));
  // animate a mage: s = { speed, air, swim, ride, act, now, turn, wave, hold, fist }
  L.animMage4 = function (M, dt, t, s) {
    const st = M.st; st.dt = dt; st.t = t; st.speed = s.speed; st.air = s.air || 0; st.swim = s.swim || 0; st.ride = s.ride || 0; st.act = s.act || null; st.now = s.now || t; st.turn = s.turn || 0; st.wave = s.wave || 0; st.hold = !!M.toolName; st.fistR = M.toolName ? 1 : .25; st.rideHz = s.rideHz || 6;
    L.humanAnim(M.rig, st);
  };

  L.animHero = (M, dt, t, s) => L.animMage4(M, dt, t, s);

  // ------------------------------------------------------------------ local player
  const P = {
    x: L.SPAWN[0], y: 5, z: L.SPAWN[1], vx: 0, vy: 0, vz: 0, ry: Math.PI, onGround: true, swim: 0, wade: 0, air: 0, speed: 0, turn: 0, fallY: 0, glide: false, lastGround: 0, mount: null, onCol: null, waterWalk: false, jumpQ: 0
  };
  L.P = P;
  const _p = new THREE.Vector3();
  // inp: { mx, mz (world dir, 0..1), run, jump (edge), jumpHeld, up, down }, mods: { speedMul, jumpMul, climb, waterWalk, swimMul, glide }
  L.playerStep = function (dt, t, inp, mods) {
    if (P.mount) return; // riding: the mount moves, the player sits
    const ml = Math.min(1, Math.hypot(inp.mx, inp.mz)); const run = inp.run || ml > .86;
    let top = ml < .08 ? 0 : (run ? 7.8 : lerp(2.2, 5.2, clamp((ml - .08) / .78, 0, 1))) * (mods.speedMul || 1);
    const gy0 = L.ground(P.x, P.z); const ws = L.waterAt ? L.waterAt(P.x, P.z) : 0; const surf = ws > -1e9 ? ws : -1e9; const water = surf - gy0; // water depth (lakes, rivers, sea)
    P.surf = surf; P.waterWalk = !!mods.waterWalk && water > .25 && P.y > surf - .4;
    const swimming = !P.waterWalk && water > 1.15 && P.y < surf + .2; P.swim = lerp(P.swim, swimming ? 1 : 0, Math.min(1, dt * 6)); P.wade = clamp(water / 1.15, 0, 1) * (P.waterWalk ? 0 : 1);
    if (swimming) top *= .55 * (mods.swimMul || 1); else if (P.wade > .2 && P.onGround) top *= 1 - P.wade * .35;
    // horizontal velocity: accelerate toward the stick direction
    const dx = ml > .02 ? inp.mx / Math.max(ml, 1e-3) : 0, dz = ml > .02 ? inp.mz / Math.max(ml, 1e-3) : 0;
    const tvx = dx * top, tvz = dz * top; const acc = P.onGround || swimming ? (top > P.speed ? 16 : 22) : 5;
    const ax = tvx - P.vx, az = tvz - P.vz, al = Math.hypot(ax, az), mx = acc * dt; if (al > mx) { P.vx += ax / al * mx; P.vz += az / al * mx; } else { P.vx = tvx; P.vz = tvz; }
    P.speed = Math.hypot(P.vx, P.vz);
    if (ml > .05) { const ta = Math.atan2(dx, dz); const da = wrapA(ta - P.ry); const tr = clamp(da, -13 * dt, 13 * dt); P.ry = wrapA(P.ry + tr); P.turn = lerp(P.turn, tr / dt, Math.min(1, dt * 8)); } else P.turn = lerp(P.turn, 0, Math.min(1, dt * 6));
    // try the move; steep terrain stops uphill movement unless climbing
    const nx = P.x + P.vx * dt, nz = P.z + P.vz * dt; const maxRise = mods.climb ? 3.5 : 1.15;
    const rise = (x, z) => { const g = L.groundAt(x, z, P.y + .3, .55).y; return g - Math.max(L.groundAt(P.x, P.z, P.y + .3, .55).y, P.y - .05); };
    const okMove = (x, z) => { if (Math.abs(x) > L.WS * 1.22 || Math.abs(z) > L.WS * 1.22) return false; const d = Math.hypot(x - P.x, z - P.z); if (d < 1e-5) return true; const r = rise(x, z); return !(r > .55 && r / d > maxRise && P.onGround); };
    if (okMove(nx, nz)) { P.x = nx; P.z = nz; } else if (okMove(nx, P.z)) { P.x = nx; P.vz *= .3; } else if (okMove(P.x, nz)) { P.z = nz; P.vx *= .3; } else { P.vx *= .2; P.vz *= .2; }
    _p.set(P.x, P.y, P.z); if (L.collideXZ(_p, .34, 1.7, .55)) { P.x = _p.x; P.z = _p.z; }
    // vertical
    const G = L.groundAt(P.x, P.z, P.y, P.onGround ? .6 : .25); let gy = G.y; P.onCol = G.col;
    if (P.waterWalk) gy = Math.max(gy, surf + .02);
    const floatY = surf - 1.18; // hips under the surface when swimming
    if (swimming) { P.vy = lerp(P.vy, (floatY + Math.sin(t * 2.2) * .05 - P.y) * 4, Math.min(1, dt * 5)); if (inp.jump && P.y > floatY - .3) P.vy = 4.2; }
    else { P.vy -= 22 * dt; if (mods.glide && P.vy < -3.2 && inp.jumpHeld) { P.vy = -3.2; P.glide = true; } else P.glide = false; }
    if (inp.jump && (P.onGround || t - P.lastGround < .14) && !swimming) { P.vy = 7.6 * (mods.jumpMul || 1); P.onGround = false; P.jumped = t; L.sfx && L.sfx('jump'); }
    P.y += P.vy * dt;
    if (P.y <= gy) { if (!P.onGround && P.vy < -12) { L.sfx && L.sfx('land'); if (L.cam) L.cam.shake = Math.min(.25, -P.vy * .012); } P.y = gy; P.vy = Math.max(0, P.vy); P.onGround = true; P.lastGround = t; }
    else if (P.y - gy > .3 || P.vy > 0) P.onGround = false; else { P.y = gy; P.onGround = true; P.lastGround = t; } // stick to slopes and stairs
    if (swimming) P.onGround = false;
    P.air = lerp(P.air, !P.onGround && !swimming && (P.y - gy > .5 || P.vy > 1) ? 1 : 0, Math.min(1, dt * 10));
    if (P.y < -40) { const s = L.findLand(P.x, P.z, 1, 80, .6); P.x = s[0]; P.z = s[1]; P.y = L.ground(P.x, P.z) + 1; P.vy = 0; }
  };

  // ------------------------------------------------------------------ camera
  const cam = { yaw: Math.PI, pitch: .3, dist: 7, tyaw: Math.PI, tpitch: .3, tdist: 7, lastDrag: -99, shake: 0, min: 2.2, max: 40 }; L.cam = cam;
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), aim = new THREE.Vector3();
  // target: { x, y, z, ry, moving, h (look height), far (extra distance) }
  L.cameraStep = function (dt, t, T) {
    if (T.moving && t - cam.lastDrag > 2.0) { const d = wrapA(T.ry - cam.tyaw); cam.tyaw += d * Math.min(1, dt * (T.fast ? 1.6 : .8)); }
    cam.yaw += wrapA(cam.tyaw - cam.yaw) * Math.min(1, dt * 10); cam.pitch += (cam.tpitch - cam.pitch) * Math.min(1, dt * 10);
    const want = clamp(cam.tdist + (T.far || 0), cam.min, cam.max + (T.far || 0)); cam.dist += (want - cam.dist) * Math.min(1, dt * 5);
    look.set(T.x, T.y + (T.h || 1.55), T.z);
    const low = sstep(.05, -.55, cam.pitch), pp = Math.max(cam.pitch, .05), cd = cam.dist * (1 - low * .3); const cp = Math.cos(pp);
    camPos.set(look.x - Math.sin(cam.yaw) * cp * cd, look.y + Math.sin(pp) * cd, look.z - Math.cos(cam.yaw) * cp * cd);
    if (low > 0) camPos.y = lerp(camPos.y, Math.max(L.ground(camPos.x, camPos.z), -.3) + .6, low);
    // occlusion: terrain and solid colliders between the head and the camera pull the camera in
    const N = 14; let hitK = 1;
    for (let k = 1; k <= N; k++) { const f = k / N; const px = lerp(look.x, camPos.x, f), py = lerp(look.y, camPos.y, f), pz = lerp(look.z, camPos.z, f); const gy = Math.max(L.ground(px, pz), -.4) + .35; if (py < gy || L.pointInSolid(px, py, pz)) { hitK = Math.max(.08, (k - 1) / N); break; } }
    if (hitK < 1) camPos.set(lerp(look.x, camPos.x, hitK), lerp(look.y, camPos.y, hitK), lerp(look.z, camPos.z, hitK));
    const gy = Math.max(L.ground(camPos.x, camPos.z), -.4) + .4; if (camPos.y < gy) camPos.y = gy;
    if (cam.shake > 0) { camPos.x += (Math.random() - .5) * cam.shake; camPos.y += (Math.random() - .5) * cam.shake; cam.shake *= Math.exp(-dt * 9); if (cam.shake < .002) cam.shake = 0; }
    const k = hitK < 1 ? 1 : Math.min(1, dt * 14); L.camera.position.lerp(camPos, k); aim.copy(look); aim.y += low * cd * .42; L.camera.lookAt(aim);
  };

  // ------------------------------------------------------------------ remote players
  const REM = new Map(); L.REMOTE = REM;
  // pr: presence { pid, n, c, g, x, y, z, ry, v, a (act stamp), ak (act kind), e (emote stamp), sw, rd (mount id), tl (tool), fl (flying) }
  L.remoteSync = function (peers, onJoin, onLeave) {
    const seen = new Set();
    for (const p of peers) {
      const pr = p.presence || {}; if (typeof pr.x !== 'number') continue; seen.add(p.peer); let r = REM.get(p.peer);
      const nm = String(pr.n || 'Viajante').slice(0, 16), ci = (pr.c | 0) % 3, g = pr.g === 'f' ? 'f' : 'm';
      if (!r || r.nm !== nm || r.ci !== ci || r.g !== g) {
        if (r && r.M) r.M.dispose(); if (r && r.tag) L.scene.remove(r.tag);
        r = { peer: p.peer, nm, ci, g, x: pr.x, y: pr.y || L.ground(pr.x, pr.z), z: pr.z, ry: pr.ry || 0, M: null, emo: pr.e || 0, act: pr.a || 0, v: 0 }; REM.set(p.peer, r);
        L.makeMage4({ gender: g, pal: ci }).then(M => { if (REM.get(p.peer) !== r || !M) { M && M.dispose(); return; } r.M = M; L.scene.add(M.root); });
        r.tag = L.textSprite(nm, .5, '#fff3c4'); r.tag.material.depthTest = false; L.scene.add(r.tag); if (onJoin) onJoin(r);
      }
      r.pr = pr; r.pid = pr.pid; r.tx = pr.x; r.ty = pr.y; r.tz = pr.z; r.try = pr.ry || 0; r.tv = pr.v || 0; r.sw = pr.sw || 0; r.rd = pr.rd || null; r.fl = pr.fl || 0;
      if (pr.e && pr.e !== r.emo) { r.emo = pr.e; r.emoT = performance.now() / 1000; }
      if (pr.a && pr.a !== r.act) { r.act = pr.a; r.actK = pr.ak || 'chop'; r.actT = performance.now() / 1000; }
      if (r.M) r.M.setTool(pr.tl || '');
    }
    for (const [k, r] of REM) if (!seen.has(k)) { if (r.M) r.M.dispose(); if (r.tag) L.scene.remove(r.tag); if (r.mountC) r.mountC.mounted = false; REM.delete(k); if (onLeave) onLeave(r); }
  };
  L.remoteStep = function (dt, t, now) {
    for (const r of REM.values()) {
      if (r.tx == null) continue; const k = Math.min(1, dt * 8); const ox = r.x, oz = r.z;
      r.x = lerp(r.x, r.tx, k); r.z = lerp(r.z, r.tz, k); r.y = lerp(r.y, r.ty != null ? r.ty : L.ground(r.x, r.z), k); const da = wrapA(r.try - r.ry); r.ry += da * k;
      if (Math.hypot(r.tx - r.x, r.tz - r.z) > 40) { r.x = r.tx; r.z = r.tz; r.y = r.ty; }
      r.v = lerp(r.v, r.tv != null ? r.tv : Math.hypot(r.x - ox, r.z - oz) / Math.max(dt, 1e-3), Math.min(1, dt * 6));
      // mounted: the mount follows the remote rider's presence
      let c = r.rd ? L.CRBYID && L.CRBYID.get(r.rd) : null; if (r.mountC && r.mountC !== c) { r.mountC.mounted = false; r.mountC = null; }
      if (c && c.I) { r.mountC = c; c.mounted = 'remote'; c.x = r.x; c.z = r.z; c.y = r.y; c.ry = r.ry; c.v = r.v; c.fly = r.fl ? 1 : 0; c.turnRate = da * 4; }
      if (!r.M) continue; const R = r.M.root;
      if (c && c.I) { const s = L.crSeat(c); R.position.copy(s); R.position.y -= r.M.rig.hipH * .92; R.rotation.set(0, c.ry, 0); }
      else { R.position.set(r.x, r.y, r.z); R.rotation.set(0, r.ry, 0); }
      const act = r.actT && now - r.actT < .6 ? { kind: r.actK, t0: r.actT, dur: .6 } : null;
      L.animMage4(r.M, dt, t, { speed: c ? 0 : r.v, swim: r.sw ? 1 : 0, ride: c ? 1 : 0, air: 0, act, now, turn: da * 3, wave: r.emoT && now - r.emoT < 1.6 ? Math.sin((now - r.emoT) / 1.6 * Math.PI) : 0, rideHz: c ? 2 + (c.v || 0) * .45 : 6 });
      r.tag.position.set(R.position.x, R.position.y + 2.45, R.position.z);
    }
  };
})(window.L);
