/* Lumiar v5 sky: stylized dome (sun, moon, stars), lit billboard cumulus, the cloud sea (shell layers + puffy
   clumps), the Névoa visual (L.mistVisual) and rain. Everything follows L.TOD (L.setTimeOfDay). */
'use strict';
(function (L) {
  const { clamp, lerp, sstep, C } = L;
  const TAU = Math.PI * 2;
  const Q = L.Q();
  L.CLOUD_Y = L.CLOUD_Y || 90;
  function rnd(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function h2(i, j, s) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s | 0, 1013904223)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

  // ================================================================ sky dome
  // skyU keeps the v4 field names (top, hor, sunDir, moonDir, night, dusk, uTime, cloudCol, cloudShade, tClouds)
  const skyU = L.skyU = {
    top: { value: C(0x4b9fe6) }, mid: { value: C(0x5aa8ea) }, hor: { value: C(0x9cc6ec) }, low: { value: C(0xdfe6ee) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, moonDir: { value: new THREE.Vector3(0, -1, 0) }, sunCol: { value: C(0xfff1d8) },
    night: { value: 0 }, dusk: { value: 0 }, rain: { value: 0 }, uTime: L.uTime, tClouds: { value: null }, tNoise: { value: L.noiseTex },
    cloudCol: { value: C(0xf4f6f8) }, cloudShade: { value: C(0xa9bbd0) },
  };
  const DOME_R = Q.far * .9;
  L.makeSky = function () {
    if (L.sky) return;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, uniforms: skyU,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 top, mid, hor, low, sunDir, moonDir, sunCol, cloudCol, cloudShade; uniform float night, dusk, rain, uTime; uniform sampler2D tNoise; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD); float y = d.y;
        // stylized gradient: low band (pale, near the cloud-sea tops) -> horizon -> mid -> zenith
        float h = max(y, 0.);
        vec3 c = mix(hor, mid, smoothstep(.02, .3, h));
        c = mix(c, top, smoothstep(.25, .85, h));
        c = mix(c, low, (1. - smoothstep(-.02, .07, y)) * (1. - night * .5));
        if (y < 0.) c = mix(c, hor * .9 + low * .1, smoothstep(0., -.3, y));
        vec3 sd = normalize(sunDir); float s = max(dot(d, sd), 0.);
        float up = smoothstep(-.12, .05, sd.y);
        // sun: small hot disc + soft glow + wide warm haze around it (wider at golden hour)
        c += sunCol * (smoothstep(.99965, .99985, s) * 6. + pow(s, 220.) * .55 + pow(s, 14.) * .16 * (1. - night)) * up * (1. - rain * .8);
        c += sunCol * pow(s, 3.) * dusk * .35 * (1. - smoothstep(.0, .5, y));
        // high thin streaks (cirrus), very subtle, they give the sky a painted feel
        if (y > .03) { vec2 p = d.xz / (y + .2); float n = texture2D(tNoise, p * .07 + vec2(uTime * .0008, 0.)).r * .6 + texture2D(tNoise, vec2(p.x * .05, p.y * .22) + .3).g * .4;
          float ci = smoothstep(.55, .85, n) * smoothstep(.03, .35, y) * .28 * (1. - rain); c = mix(c, mix(cloudShade, cloudCol, .7 + .3 * s), ci); }
        // moon
        vec3 md = normalize(moonDir); float m = max(dot(d, md), 0.);
        c += vec3(.9, .93, 1.) * (smoothstep(.99955, .9997, m) * 1.4 + pow(m, 60.) * .12) * night;
        gl_FragColor = vec4(c, 1.);
        #include <encodings_fragment>
      }`
    }));
    sky.renderOrder = -10; sky.frustumCulled = false; L.scene.add(sky); L.sky = sky;
    // stars
    const n = 1600, p = new Float32Array(n * 3), sz = new Float32Array(n); const r = rnd(5);
    const R = DOME_R * .95;
    for (let i = 0; i < n; i++) { const u = r(), a = r() * TAU, y = .03 + Math.pow(u, .8) * .97, s = Math.sqrt(1 - y * y); p[i * 3] = Math.cos(a) * s * R; p[i * 3 + 1] = y * R; p[i * 3 + 2] = Math.sin(a) * s * R; sz[i] = .8 + Math.pow(r(), 3) * 2.6; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(sz, 1));
    const stars = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 }, uT: L.uTime, uPx: { value: 1 } },
      vertexShader: `attribute float aS; uniform float uT, uPx; varying float vA; void main(){ vA = .55 + .45 * sin(uT * (1.5 + aS) + position.x * .01 + position.z * .013); gl_PointSize = aS * 1.7 * uPx; vec4 q = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = q.xyww; }`,
      fragmentShader: `uniform float uA; varying float vA; void main(){ vec2 d = gl_PointCoord - .5; float a = smoothstep(.5, .05, length(d)); gl_FragColor = vec4(vec3(.85, .9, 1.) * a * uA * vA, 1.); }`
    }));
    stars.frustumCulled = false; stars.renderOrder = -9; L.scene.add(stars); L.stars = stars;
    stars.material.uniforms.uPx.value = L.renderer.getPixelRatio();
  };

  // ================================================================ puff atlas (2x2 cauliflower puffs with normals)
  // RG = view-space normal xy (encoded), B = thickness, A = coverage
  function makePuffAtlas() {
    const S = 128, W = S * 2, data = new Uint8Array(W * W * 4);
    for (let v = 0; v < 4; v++) {
      const r = rnd(101 + v * 17); const discs = [];
      const n = 7 + Math.floor(r() * 5);
      discs.push([0, -.05, .5]);
      for (let i = 0; i < n; i++) { const a = r() * TAU, d = .18 + r() * .2; const rr = .16 + r() * .16; discs.push([Math.cos(a) * d, Math.sin(a) * d * .85 - .02, rr]); }
      for (let i = 0; i < 9; i++) { const a = -Math.PI * (.1 + r() * .8), d = .3 + r() * .12; discs.push([Math.cos(a) * d, Math.sin(a) * d, .08 + r() * .07]); } // small bumps on the upper rim
      const hgt = new Float32Array(S * S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const px = (x + .5) / S * 2 - 1, py = (y + .5) / S * 2 - 1; let h = 0;
        for (const [cx, cy, rr] of discs) { const dx = px - cx, dy = py - cy, q = rr * rr - dx * dx - dy * dy; if (q > 0) h = Math.max(h, Math.sqrt(q) + (.5 - rr) * .15 * 0); }
        hgt[y * S + x] = h;
      }
      // blur the height field a little so cap seams do not show in the normals
      const tmp = new Float32Array(S * S);
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let s = 0, k = 0; for (let d = -2; d <= 2; d++) { const xx = clamp(x + d, 0, S - 1); s += hgt[y * S + xx]; k++; } tmp[y * S + x] = s / k; }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let s = 0, k = 0; for (let d = -2; d <= 2; d++) { const yy = clamp(y + d, 0, S - 1); s += tmp[yy * S + x]; k++; } hgt[y * S + x] = s / k; }
      }
      let hmax = 0; for (let i = 0; i < S * S; i++) hmax = Math.max(hmax, hgt[i]);
      const ox = (v % 2) * S, oy = Math.floor(v / 2) * S;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const h = hgt[y * S + x] / hmax;
        const hx = (hgt[y * S + Math.min(x + 1, S - 1)] - hgt[y * S + Math.max(x - 1, 0)]) / hmax * S * .25;
        const hy = (hgt[Math.min(y + 1, S - 1) * S + x] - hgt[Math.max(y - 1, 0) * S + x]) / hmax * S * .25;
        let nx = -hx, ny = hy, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl;
        const o = ((oy + (S - 1 - y)) * W + ox + x) * 4; // rows flipped (DataTexture is bottom-up), so +y is up
        data[o] = (nx * .5 + .5) * 255; data[o + 1] = (-ny * .5 + .5) * 255; data[o + 2] = clamp(h, 0, 1) * 255;
        data[o + 3] = clamp(sstep(.0, .22, h) * 255, 0, 255);
      }
    }
    const t = new THREE.DataTexture(data, W, W, THREE.RGBAFormat); t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  }

  // ================================================================ puff field: one draw call of sorted, lit billboards
  // flags: 0 static, 1 drift + wrap around the camera (sky cumulus), 2 churn (mist), 3 sea clump (gentle bob)
  const cloudU = {
    tPuff: { value: null }, uSunV: { value: new THREE.Vector3() }, uSunW: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
    uLit: { value: C(0xf4f6f8) }, uBody: { value: C(0xd9dde2) }, uShade: { value: C(0xa9bbd0) }, uTime: L.uTime,
    uDrift: { value: new THREE.Vector2(1.2, .5) }, uWrap: { value: 24000 }, uNight: { value: 0 },
  };
  L.cloudU = cloudU;
  const PUFF_VS = `
    attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aQ; attribute float aFade;
    uniform vec2 uDrift; uniform float uWrap, uTime;
    varying vec2 vUv; varying vec3 vBias; varying vec4 vP; varying float vFade; varying vec2 vRot; varying vec3 vW;
    #include <fog_pars_vertex>
    void main(){
      vec3 cc = aQ.xyz; vec3 p = position; float fl = aQ.w;
      if (fl > .5 && fl < 1.5) {
        vec2 off = uDrift * uTime; cc.xz += off; p.xz += off;
        vec2 rel = mod(cc.xz - cameraPosition.xz + uWrap * .5, uWrap) - uWrap * .5;
        vec2 sh = cameraPosition.xz + rel - cc.xz; cc.xz += sh; p.xz += sh;
      } else if (fl > 1.5 && fl < 2.5) {
        float a = uTime * (.004 + aP.w * .003) * (fract(aP.w * 7.) > .5 ? 1. : -1.); vec2 r = p.xz - cc.xz; float ca = cos(a), sa = sin(a);
        p.xz = cc.xz + vec2(ca * r.x - sa * r.y, sa * r.x + ca * r.y); p.y += sin(uTime * .05 + aP.w * 40.) * aP.x * .08;
      } else if (fl > 2.5) { p.y += sin(uTime * .12 + aP.w * 30.) * aP.x * .05; p.xz += uDrift * uTime * .15; cc.xz += uDrift * uTime * .15; }
      vec4 mvPosition = viewMatrix * vec4(p, 1.);
      float s = aP.x; float rot = fract(aP.w * 13.) * 6.283; float cr = cos(rot), sr = sin(rot);
      vec2 cn = vec2(cr * aCorner.x - sr * aCorner.y, sr * aCorner.x + cr * aCorner.y);
      // near fade: puffs we are inside of disappear (the haze chunk whitens instead)
      float dz = -mvPosition.z; float nf = smoothstep(s * .35, s * 1.1, dz);
      mvPosition.xy += cn * s; mvPosition.z += s * .25;
      gl_Position = projectionMatrix * mvPosition;
      float vi = floor(aP.w * 4.); vec2 cell = vec2(mod(vi, 2.), floor(vi / 2.)) * .5;
      vUv = cell + (aCorner * .5 + .5) * .5; vRot = vec2(cr, sr);
      vBias = mat3(viewMatrix) * normalize(p - cc + vec3(0., -s * .2, 0.));
      vP = aP; vFade = aFade * nf; vW = p;
      #include <fog_vertex>
    }`;
  const PUFF_FS = `
    uniform sampler2D tPuff; uniform vec3 uSunV, uSunW, uSunCol, uLit, uBody, uShade; uniform float uNight;
    varying vec2 vUv; varying vec3 vBias; varying vec4 vP; varying float vFade; varying vec2 vRot; varying vec3 vW;
    #include <fog_pars_fragment>
    void main(){
      vec4 tx = texture2D(tPuff, vUv); float a = tx.a * vFade; if (a < .004) discard;
      vec2 nxy = tx.rg * 2. - 1.; nxy = vec2(vRot.x * nxy.x - vRot.y * nxy.y, vRot.y * nxy.x + vRot.x * nxy.y);
      vec3 nV = normalize(vec3(nxy, sqrt(max(0., 1. - dot(nxy, nxy)))) * .8 + vBias * .75);
      float ndl = dot(nV, uSunV);
      float hf = vP.y, ao = vP.z;
      float lit = smoothstep(-.45, .75, ndl) * (1. - ao * .7) * mix(.45, 1., smoothstep(.0, .7, hf));
      lit = clamp(lit + tx.b * .12 * hf, 0., 1.);
      vec3 col = mix(uShade, uBody, smoothstep(.05, .5, lit)); col = mix(col, uLit, smoothstep(.5, .95, lit));
      vec3 V = normalize(vW - cameraPosition);
      float fwd = pow(max(dot(V, uSunW), 0.), 8.) * (1. - uNight);
      col += uSunCol * fwd * (1. - tx.a) * .9;           // silver lining on thin edges toward the sun
      col *= mix(1., .92, (1. - hf) * (1. - lit));        // flat cool bottoms
      gl_FragColor = vec4(col, a);
      #ifdef USE_FOG
        float fogDist = length(vFogW);
        float hH = hzD.w; float fe = vFogW.y / hH; float fInt = abs(fe) > 1e-3 ? (1. - exp(-fe)) / fe : 1. - fe * .5;
        float tA = fogDensity * .55 * fogDist * (exp(-max(cameraPosition.y - hzE.x, -40.) / hH) * fInt + hzE.y);
        vec3 fHor = mix(fogColor, hzC.rgb, pow(max(dot(vFogW / max(fogDist, 1.), hzD.xyz), 0.), hzC.w));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(hzA.rgb, hzB.rgb, .85), (1. - exp(-tA)) * .22);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fHor, max(1. - exp(-tA * hzB.w * .8), smoothstep(hzE.z, hzE.w, fogDist)));
      #endif
    }`;
  let puffTex = null;
  function PuffField(cap, renderOrder, name) {
    this.cap = cap; this.n = 0; this.clusters = []; this.dirty = true; this.sortT = 0;
    const g = new THREE.BufferGeometry(); const V = cap * 4;
    this.pos = new Float32Array(V * 3); this.ap = new Float32Array(V * 4); this.aq = new Float32Array(V * 4); this.fade = new Float32Array(V);
    const corner = new Float32Array(V * 2); for (let i = 0; i < cap; i++) { corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8); }
    this.idx = V < 65536 ? new Uint16Array(cap * 6) : new Uint32Array(cap * 6);
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPP = new THREE.BufferAttribute(this.ap, 4); this.aQQ = new THREE.BufferAttribute(this.aq, 4); this.aF = new THREE.BufferAttribute(this.fade, 1);
    g.setAttribute('position', this.aPos); g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2)); g.setAttribute('aP', this.aPP); g.setAttribute('aQ', this.aQQ); g.setAttribute('aFade', this.aF);
    this.aIdx = new THREE.BufferAttribute(this.idx, 1); this.aIdx.setUsage(THREE.DynamicDrawUsage); g.setIndex(this.aIdx); g.setDrawRange(0, 0);
    this.geo = g; this.keys = new Float64Array(cap);
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false, fog: true });
    for (const k in cloudU) mat.uniforms[k] = cloudU[k];
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.name = name;
    L.scene.add(this.mesh);
  }
  // cluster: {puffs:[[x,y,z,size,hf,ao,seed]...], cx,cy,cz, flag, fade}
  PuffField.prototype.add = function (cl) { cl.fade = cl.fade == null ? 1 : cl.fade; this.clusters.push(cl); this.dirty = true; return cl; };
  PuffField.prototype.remove = function (cl) { const i = this.clusters.indexOf(cl); if (i >= 0) { this.clusters.splice(i, 1); this.dirty = true; } };
  PuffField.prototype.rebuild = function () {
    let n = 0;
    for (const cl of this.clusters) {
      for (const p of cl.puffs) {
        if (n >= this.cap) break;
        for (let k = 0; k < 4; k++) {
          const v = n * 4 + k;
          this.pos[v * 3] = p[0]; this.pos[v * 3 + 1] = p[1]; this.pos[v * 3 + 2] = p[2];
          this.ap[v * 4] = p[3]; this.ap[v * 4 + 1] = p[4]; this.ap[v * 4 + 2] = p[5]; this.ap[v * 4 + 3] = p[6];
          this.aq[v * 4] = cl.cx; this.aq[v * 4 + 1] = cl.cy; this.aq[v * 4 + 2] = cl.cz; this.aq[v * 4 + 3] = cl.flag;
          this.fade[v] = cl.fade * (p[7] == null ? 1 : p[7]);
        }
        n++;
      }
    }
    this.n = n; this.aPos.needsUpdate = this.aPP.needsUpdate = this.aQQ.needsUpdate = this.aF.needsUpdate = true; this.dirty = false; this.sortT = 0;
  };
  // back-to-front sort by view depth (replicates the shader's drift/wrap so the order matches)
  PuffField.prototype.sort = function (cam, t) {
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z; const e = cam.matrixWorld.elements; const fx = -e[8], fy = -e[9], fz = -e[10];
    const W = cloudU.uWrap.value, dx0 = cloudU.uDrift.value.x * t, dz0 = cloudU.uDrift.value.y * t;
    const keys = this.keys; const n = this.n;
    for (let i = 0; i < n; i++) {
      const v = i * 4; let px = this.pos[v * 3], py = this.pos[v * 3 + 1], pz = this.pos[v * 3 + 2]; const fl = this.aq[v * 4 + 3];
      if (fl === 1) { const ccx = this.aq[v * 4] + dx0, ccz = this.aq[v * 4 + 2] + dz0; px += dx0; pz += dz0; const rx = ((ccx - cx + W * .5) % W + W) % W - W * .5, rz = ((ccz - cz + W * .5) % W + W) % W - W * .5; px += cx + rx - ccx; pz += cz + rz - ccz; }
      const d = (px - cx) * fx + (py - cy) * fy + (pz - cz) * fz;
      keys[i] = Math.floor(clamp(1e5 - d, 0, 4e6) * 8) * 65536 + i; // larger depth first
    }
    const sub = keys.subarray(0, n); sub.sort();
    const idx = this.idx;
    for (let k = 0; k < n; k++) { const i = sub[k] % 65536; const b = i * 4, o = k * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
    this.aIdx.updateRange.count = n * 6; this.aIdx.needsUpdate = true; this.geo.setDrawRange(0, n * 6);
  };
  // per-puff sun occlusion inside its cluster (cheap AO toward the sun; recomputed when the sun moves)
  function shadeCluster(cl, sx, sy, sz) {
    const P = cl.puffs;
    let ymin = 1e9, ymax = -1e9; for (const p of P) { ymin = Math.min(ymin, p[1] - p[3] * .5); ymax = Math.max(ymax, p[1] + p[3] * .5); }
    const H = Math.max(ymax - ymin, 1);
    for (const p of P) {
      let occ = 0;
      for (const q of P) {
        if (q === p) continue; const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2]; const along = dx * sx + dy * sy + dz * sz; if (along <= 0) continue;
        const lx = dx - sx * along, ly = dy - sy * along, lz = dz - sz * along; const lat = Math.sqrt(lx * lx + ly * ly + lz * lz); const rr = q[3] * .9;
        if (lat < rr) occ += (1 - lat / rr) * Math.min(1, q[3] / Math.max(p[3], 1)) * .55;
      }
      p[5] = clamp(occ, 0, 1) * .85; if (cl.flag !== 2) p[4] = clamp((p[1] - ymin) / H, 0, 1);
    }
  }

  // ---------------------------------------------------------------- cluster shapes
  // cumulus: flat base, towers of shrinking puffs, cauliflower top
  function cumulusPuffs(r, w, h, base) {
    const P = []; const towers = 2 + Math.floor(r() * 4); const s0 = w * .2;
    for (let i = 0; i < Math.round(9 + w / 90); i++) { const a = r() * TAU, d = Math.sqrt(r()) * w * .42; const s = s0 * (.8 + r() * .5); P.push([Math.cos(a) * d, base + s * .3, Math.sin(a) * d * .6, s]); }
    for (let t = 0; t < towers; t++) {
      const a = r() * TAU, d = r() * w * .26; let x = Math.cos(a) * d, z = Math.sin(a) * d * .5; const th = h * (.45 + r() * .55); let y = base + s0 * .5; let s = s0 * (1.05 + r() * .3);
      for (let it = 0; it < 7 && y < base + th; it++) { const k = 2 + Math.floor(r() * 2); for (let j = 0; j < k; j++) P.push([x + (r() - .5) * s * .8, y, z + (r() - .5) * s * .6, s * (.75 + r() * .3)]); y += Math.max(s * (.42 + r() * .12), th / 7); s *= .88; x += (r() - .5) * s * .3; }
      P.push([x, y, z, s * 1.1]);
    }
    return P.map(p => [p[0], p[1], p[2], p[3], 0, 0, r()]);
  }
  // sea clump: wide, low, a few bumps on top
  function clumpPuffs(r, w, h) {
    const P = []; const n = Math.round(5 + w / 18);
    for (let i = 0; i < n; i++) { const a = r() * TAU, d = Math.sqrt(r()) * w * .45; const s = w * (.18 + r() * .14); P.push([Math.cos(a) * d, s * .15 + r() * h * .35, Math.sin(a) * d * .8, s]); }
    for (let i = 0; i < Math.round(n * .45); i++) { const a = r() * TAU, d = Math.sqrt(r()) * w * .3; const s = w * (.12 + r() * .1); P.push([Math.cos(a) * d, h * (.45 + r() * .4), Math.sin(a) * d * .7, s]); }
    return P.map(p => [p[0], p[1], p[2], p[3], 0, 0, r()]);
  }

  // ================================================================ cumulus (sky)
  let FA = null, FB = null; // FA: sky cumulus (drawn first), FB: low clouds (sea clumps, mist, lab clusters)
  L.clouds = {
    // add one cumulus at world position (x, base y, z); w = width, h = tower height; opts.wrap: follow the camera torus
    addCumulus(x, y, z, w, h, seed, opts) {
      const r = rnd(seed || 1); const P = cumulusPuffs(r, w, h, 0);
      for (const p of P) { p[0] += x; p[1] += y; p[2] += z; }
      const cl = { puffs: P, cx: x, cy: y + h * .4, cz: z, flag: opts && opts.wrap ? 1 : 0 };
      shadeCluster(cl, L.TOD.sunDir.x, L.TOD.sunDir.y, L.TOD.sunDir.z);
      return (opts && opts.low ? FB : FA).add(cl);
    },
    addClump(x, y, z, w, h, seed, flag) {
      const r = rnd(seed || 1); const P = clumpPuffs(r, w, h);
      for (const p of P) { p[0] += x; p[1] += y; p[2] += z; }
      const cl = { puffs: P, cx: x, cy: y + h * .3, cz: z, flag: flag == null ? 3 : flag };
      shadeCluster(cl, L.TOD.sunDir.x, L.TOD.sunDir.y, L.TOD.sunDir.z); return FB.add(cl);
    },
    remove(cl) { (FA.clusters.includes(cl) ? FA : FB).remove(cl); },
    get fieldSky() { return FA; }, get fieldLow() { return FB; },
  };
  // a random field of cumulus wrapping around the camera (24 km torus), altitude band [y0, y1]
  L.buildClouds = function (opts) {
    if (FA) return;
    opts = opts || {};
    puffTex = puffTex || makePuffAtlas(); cloudU.tPuff.value = puffTex;
    FA = new PuffField(Math.round(2600 * Math.max(.5, Q.cloudPuffs)), 1, 'cumulus');
    FB = new PuffField(Math.round(4200 * Math.max(.5, Q.cloudPuffs)), 4, 'lowclouds');
    const r = rnd(opts.seed || 77); const n = Math.round((opts.count || 34) * Q.cloudPuffs); const W = cloudU.uWrap.value;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = 1800 + Math.sqrt(r()) * (W * .5 - 1800); const w = 420 + r() * 900;
      L.clouds.addCumulus(Math.cos(a) * d, (opts.y0 || 950) + r() * ((opts.y1 || 1700) - (opts.y0 || 950)), Math.sin(a) * d, w, w * (.35 + r() * .5), 1000 + i, { wrap: true });
    }
    L.cloudMats = []; L.cloudGroup = FA.mesh;
  };

  // ================================================================ cloud sea (shell layers) + clumps
  const seaU = {
    uTime: L.uTime, tNoise: { value: L.noiseTex }, tDens: { value: null }, uDensXf: { value: new THREE.Vector4(0, 0, 1e-9, 0) }, // x0, z0, 1/size, enabled
    uSunW: cloudU.uSunW, uLit: cloudU.uLit, uBody: cloudU.uBody, uShade: cloudU.uShade, uSunCol: cloudU.uSunCol,
    uCov: { value: .5 }, uSeaY: { value: L.CLOUD_Y }, uThick: { value: 26 },
  };
  L.seaU = seaU;
  const SEA_VS = `
    attribute float aLayer; uniform float uSeaY, uThick; varying vec3 vW; varying float vL;
    #include <fog_pars_vertex>
    void main(){ vec3 p = position; p.xz += cameraPosition.xz; p.y = uSeaY + (aLayer - .5) * uThick; vW = p; vL = aLayer;
      vec4 mvPosition = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const SEA_FS = `
    uniform sampler2D tNoise, tDens; uniform vec4 uDensXf; uniform vec3 uSunW, uLit, uBody, uShade, uSunCol; uniform float uTime, uCov, uSeaY;
    varying vec3 vW; varying float vL;
    #include <fog_pars_fragment>
    float cov(vec2 p, float dens) {
      vec2 w = vec2(uTime * .9, uTime * .35);
      float a = texture2D(tNoise, (p + w) / 2600.).r;
      float b = texture2D(tNoise, (p - w * .6) / 760. + .37).g;
      float c = texture2D(tNoise, (p + w * 1.4) / 230. + .71).a;
      return a * .55 + b * .3 + c * .15 + (dens - .5) * .55;
    }
    void main(){
      float dens = .5;
      if (uDensXf.w > 0.) dens = texture2D(tDens, (vW.xz - uDensXf.xy) * uDensXf.z).r;
      float cv = cov(vW.xz, dens) + uCov - .5;
      vec2 sd = normalize(uSunW.xz + 1e-4) * 60.;
      float cs = cov(vW.xz + sd, dens) + uCov - .5;
      float th = mix(.42, .7, vL);                         // upper shells need thicker cloud
      float a = smoothstep(th - .04, th + .07, cv);
      if (a < .01) discard;
      float slope = (cv - cs) * 4.;                        // facing the sun -> lit
      float top = smoothstep(th, th + .25, cv);
      float lit = clamp(.35 + slope * 1.4 + top * .35 + vL * .25, 0., 1.) * mix(.55, 1., clamp(uSunW.y * 3., 0., 1.));
      vec3 col = mix(uShade, uBody, smoothstep(.05, .55, lit)); col = mix(col, uLit, smoothstep(.55, 1., lit));
      col = mix(col * vec3(.9, .94, 1.), col, vL);         // lower shells slightly cooler
      if (cameraPosition.y < uSeaY) col *= .75;             // seen from below
      vec3 V = normalize(vW - cameraPosition);
      col += uSunCol * pow(max(dot(V, uSunW), 0.), 10.) * (1. - a) * .5;
      gl_FragColor = vec4(col, a * mix(.75, .95, vL));
      #ifdef USE_FOG
        float fogDist = length(vFogW);
        float hH = hzD.w; float fe = vFogW.y / hH; float fInt = abs(fe) > 1e-3 ? (1. - exp(-fe)) / fe : 1. - fe * .5;
        float tA = fogDensity * .55 * fogDist * (exp(-max(cameraPosition.y - hzE.x, -40.) / hH) * fInt + hzE.y);
        vec3 fHor = mix(fogColor, hzC.rgb, pow(max(dot(vFogW / max(fogDist, 1.), hzD.xyz), 0.), hzC.w));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(hzA.rgb, hzB.rgb, .9), (1. - exp(-tA)) * .3);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fHor, max(1. - exp(-tA * hzB.w), smoothstep(hzE.z, hzE.w, fogDist)));
        gl_FragColor.a *= 1. - smoothstep(hzE.z * .9, hzE.w, fogDist) * .4;
      #endif
    }`;
  let seaMesh = null;
  function buildSea() {
    const nl = Math.max(1, Q.seaShells); const R = Q.far * .85;
    // polar disc, rings denser near the centre; one layer attribute per vertex
    const rings = 56, segs = 96, pos = [], lay = [], idx = [];
    for (let l = 0; l < nl; l++) {
      const base = pos.length / 3; const lv = nl === 1 ? .5 : l / (nl - 1);
      pos.push(0, 0, 0); lay.push(lv);
      for (let i = 1; i <= rings; i++) { const rr = R * Math.pow(i / rings, 2.2); for (let j = 0; j < segs; j++) { const a = j / segs * TAU; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); lay.push(lv); } }
      for (let j = 0; j < segs; j++) idx.push(base, base + 1 + (j + 1) % segs, base + 1 + j);
      for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) { const a = base + 1 + (i - 1) * segs + j, b = base + 1 + (i - 1) * segs + (j + 1) % segs, c = base + 1 + i * segs + j, d = base + 1 + i * segs + (j + 1) % segs; idx.push(a, b, c, b, d, c); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aLayer', new THREE.Float32BufferAttribute(lay, 1)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), vertexShader: SEA_VS, fragmentShader: SEA_FS, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
    for (const k in seaU) mat.uniforms[k] = seaU[k];
    seaMesh = new THREE.Mesh(g, mat); seaMesh.frustumCulled = false; seaMesh.renderOrder = 3; seaMesh.name = 'cloudsea'; L.scene.add(seaMesh);
  }
  // density map: 0..1 texture over a square; 1 = thick cloud (cliff bases), 0 = clear (open ocean holes)
  const seaClumps = new Map(); let densFn = null, clumpR = 4200;
  L.cloudSea = {
    get mesh() { return seaMesh; },
    setY(y) { L.CLOUD_Y = y; seaU.uSeaY.value = y; },
    setCoverage(c) { seaU.uCov.value = c; },
    setDensityMap(tex, x0, z0, size) { seaU.tDens.value = tex; seaU.uDensXf.value.set(x0, z0, 1 / size, tex ? 1 : 0); },
    // bake a density texture from a height function: thick where land meets the cloud layer, holes far from land
    densityFromHeight(hfn, x0, z0, size, res) {
      res = res || 256; const N = res, cy = L.CLOUD_Y; const land = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = x0 + (i + .5) / N * size, z = z0 + (j + .5) / N * size; const h = hfn(x, z); land[j * N + i] = h > cy - 30 ? 1 : 0; }
      // distance to land (two-pass chamfer), in cells
      const D = new Float32Array(N * N); for (let k = 0; k < N * N; k++) D[k] = land[k] ? 0 : 1e9;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; if (i > 0) D[k] = Math.min(D[k], D[k - 1] + 1); if (j > 0) D[k] = Math.min(D[k], D[k - N] + 1); if (i > 0 && j > 0) D[k] = Math.min(D[k], D[k - N - 1] + 1.414); if (i < N - 1 && j > 0) D[k] = Math.min(D[k], D[k - N + 1] + 1.414); }
      for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) { const k = j * N + i; if (i < N - 1) D[k] = Math.min(D[k], D[k + 1] + 1); if (j < N - 1) D[k] = Math.min(D[k], D[k + N] + 1); if (i < N - 1 && j < N - 1) D[k] = Math.min(D[k], D[k + N + 1] + 1.414); if (i > 0 && j < N - 1) D[k] = Math.min(D[k], D[k + N - 1] + 1.414); }
      const cell = size / N; const data = new Uint8Array(N * N * 4);
      for (let k = 0; k < N * N; k++) { const dm = D[k] * cell; const v = land[k] ? .85 : clamp(.95 - sstep(60, 1500, dm) * .75, 0, 1); data[k * 4] = v * 255; data[k * 4 + 1] = data[k * 4 + 2] = 0; data[k * 4 + 3] = 255; }
      const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      this.setDensityMap(t, x0, z0, size); this._dens = { data, N, x0, z0, size, hfn };
      densFn = (x, z) => { const u = (x - x0) / size * N - .5, v = (z - z0) / size * N - .5; const i = clamp(Math.round(u), 0, N - 1), j = clamp(Math.round(v), 0, N - 1); return data[(j * N + i) * 4] / 255; };
      for (const [k, cl] of seaClumps) FB.remove(cl); seaClumps.clear();
      return t;
    },
    // custom density function for clump placement (if no map was baked)
    setClumpDensity(fn) { densFn = fn; },
    clumpRadius(r) { clumpR = r; },
  };
  // sea clumps live in 600 m tiles around the camera; deterministic per tile
  const CT = 600; let lastCI = 1e9, lastCJ = 1e9;
  function updateClumps(cam) {
    if (!densFn) return;
    const ci = Math.floor(cam.position.x / CT), cj = Math.floor(cam.position.z / CT); if (ci === lastCI && cj === lastCJ) return; lastCI = ci; lastCJ = cj;
    const R = Math.ceil(clumpR / CT); const want = new Set(); const cy = L.CLOUD_Y; const dd = L.cloudSea._dens;
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      const cx = (i + .5) * CT, cz = (j + .5) * CT; if (Math.hypot(cx - cam.position.x, cz - cam.position.z) > clumpR + CT) continue;
      const key = i + ',' + j; want.add(key); if (seaClumps.has(key)) continue;
      const list = [];
      const nTry = Math.round(5 * Q.cloudPuffs + 1);
      for (let k = 0; k < nTry; k++) {
        const x = (i + h2(i, j, k * 3)) * CT, z = (j + h2(i, j, k * 3 + 1)) * CT; const d = densFn(x, z);
        if (h2(i, j, k * 3 + 2) > d * d * 1.1) continue;
        if (dd && dd.hfn && dd.hfn(x, z) > cy + 25) continue; // not inside land
        const w = 70 + h2(i, j, k + 50) * 160 * (.6 + d * .6); const hh = w * (.32 + h2(i, j, k + 60) * .3);
        list.push(L.clouds.addClump(x, cy - 10 + h2(i, j, k + 70) * 18, z, w, hh, i * 7919 + j * 104729 + k, 3));
      }
      seaClumps.set(key, list);
    }
    for (const [k, list] of seaClumps) if (!want.has(k)) { for (const cl of list) FB.remove(cl); seaClumps.delete(k); }
  }

  // ================================================================ the Névoa (mist) visual
  let mist = null;
  L.mistVisual = {
    // a gigantic, slowly churning, permanent cloud mass from the ground up to `top`
    setDisc(x, z, r, opts) {
      opts = opts || {}; const top = opts.top || 900, base = opts.base != null ? opts.base : 0;
      if (mist) { for (const cl of mist.cls) FB.remove(cl); }
      mist = { x, z, r, top, base, amount: 0, path: null, cls: [] };
      L.HZ.M[0] = x; L.HZ.M[1] = z; L.HZ.M[2] = r; L.HZ.M[3] = top;
      const rr = rnd(opts.seed || 9); const nP = Math.round(520 * Q.mistPuffs);
      // several clusters around the ring so the churn reads as slow, separate motions
      const nC = 10; for (let c = 0; c < nC; c++) {
        const a0 = c / nC * TAU; const P = [];
        for (let i = 0; i < nP / nC; i++) {
          const a = a0 + (rr() - .5) * TAU / nC * 1.2; const u = rr();
          const rad = r * (u < .62 ? (.82 + rr() * .3) : Math.sqrt(rr()) * .9); // most puffs on the outer wall, some inside/top
          const hdome = top * (1 - Math.pow(rad / (r * 1.12), 2.6) * .45);
          const y = base + Math.pow(rr(), .75) * (hdome - base);
          const s = 160 + rr() * 220 + (y > top * .8 ? 60 : 0);
          P.push([x + Math.cos(a) * rad, y, z + Math.sin(a) * rad, s, 0, 0, rr()]);
        }
        const cl = { puffs: P, cx: x, cy: base + top * .5, cz: z, flag: 2 };
        shadeCluster(cl, L.TOD.sunDir.x, L.TOD.sunDir.y, L.TOD.sunDir.z);
        for (const p of cl.puffs) p[4] = clamp((p[1] - base) / (top - base), 0, 1);
        mist.cls.push(FB.add(cl));
      }
      this.open(0, null);
    },
    // open a lit corridor: amount 0..1, pathPts [[x,z],...] from the edge to the centre
    open(amount, pathPts) {
      if (!mist) return; mist.amount = clamp(amount || 0, 0, 1); if (pathPts) mist.path = pathPts;
      const W = 50 + mist.amount * 120;
      for (const cl of mist.cls) for (const p of cl.puffs) {
        let f = 1;
        if (mist.path && mist.amount > 0) { const d = distPath(p[0], p[2], mist.path); f = 1 - mist.amount * (1 - sstep(W * .6, W + p[3], d)); if (mist.amount >= 1) f *= .15; }
        p[7] = f;
      }
      FB.dirty = true;
      if (!lights && mist.path && mist.amount > 0) makeCorridorLights();
      if (lights) { lights.visible = mist.amount > 0; lights.material.opacity = mist.amount * .9; }
    },
    get state() { return mist; },
  };
  function distPath(x, z, P) {
    let best = 1e9;
    for (let i = 0; i < P.length - 1; i++) { const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1]; const dx = bx - ax, dz = bz - az; const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); }
    return best;
  }
  // golden motes along the corridor (one Points draw)
  let lights = null;
  function makeCorridorLights() {
    const P = mist.path; const pts = []; const r = rnd(3);
    for (let i = 0; i < P.length - 1; i++) { const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1]; const L2 = Math.hypot(bx - ax, bz - az); for (let s = 0; s < L2; s += 6) { const t = s / L2; const x = lerp(ax, bx, t) + (r() - .5) * 30, z = lerp(az, bz, t) + (r() - .5) * 30; const gy = L.ground ? L.ground(x, z) : 0; pts.push(x, gy + 1 + r() * 9, z); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.PointsMaterial({ map: L.GLOW, size: 1.6, color: 0xffd98a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    lights = new THREE.Points(g, m); lights.renderOrder = 6; L.scene.add(lights);
  }

  // ================================================================ rain (light drizzle streaks in a box around the camera)
  let rain = null;
  function buildRain() {
    const n = Q.rainDrops; const pos = new Float32Array(n * 4 * 3), cor = new Float32Array(n * 4 * 2), idx = new (n * 4 < 65536 ? Uint16Array : Uint32Array)(n * 6); const r = rnd(12);
    for (let i = 0; i < n; i++) { const x = r() * 40 - 20, y = r() * 24, z = r() * 40 - 20; for (let k = 0; k < 4; k++) { pos.set([x, y, z], (i * 4 + k) * 3); } cor.set([-1, 0, 1, 0, 1, 1, -1, 1], i * 8); idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aC', new THREE.BufferAttribute(cor, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: L.uTime, uA: { value: 0 }, uCol: { value: new THREE.Color(.8, .85, .95) } },
      vertexShader: `attribute vec2 aC; uniform float uT; varying float vA; varying float vX;
        void main(){ vec3 p = position; p.y = mod(p.y - uT * 9. , 24.) - 8.; p.x = mod(p.x + uT * 1.2 - cameraPosition.x + 20., 40.) - 20.; p.z = mod(p.z - cameraPosition.z + 20., 40.) - 20.;
          vec3 w = cameraPosition + p; vec3 dir = normalize(vec3(.12, -1., 0.)); vec4 a = viewMatrix * vec4(w, 1.); vec4 b = viewMatrix * vec4(w + dir * .7, 1.);
          vec2 sd = normalize(b.xy - a.xy + 1e-5); vec2 nn = vec2(-sd.y, sd.x); vec4 mv = mix(a, b, aC.y); mv.xy += nn * aC.x * .012;
          gl_Position = projectionMatrix * mv; vA = smoothstep(1., 4., -mv.z) * (1. - smoothstep(18., 22., length(p.xz))); vX = aC.x; }`,
      fragmentShader: `uniform float uA; uniform vec3 uCol; varying float vA; varying float vX; void main(){ gl_FragColor = vec4(uCol, uA * vA * (1. - abs(vX)) * .35); }` });
    rain = new THREE.Mesh(g, m); rain.frustumCulled = false; rain.renderOrder = 7; rain.visible = false; L.scene.add(rain);
  }

  // ================================================================ init + time of day + tick
  L.skyInit = function (opts) {
    L.makeSky(); L.buildClouds(opts && opts.clouds); buildSea(); buildRain();
  };
  const _v = new THREE.Vector3();
  L.onTimeOfDay(T => {
    skyU.top.value.copy(T.zen); skyU.mid.value.copy(T.mid); skyU.hor.value.copy(T.hor); skyU.low.value.copy(T.low);
    skyU.sunDir.value.copy(T.sunDir); skyU.moonDir.value.copy(T.moonDir); skyU.night.value = T.night; skyU.dusk.value = T.dusk; skyU.rain.value = T.rain;
    skyU.sunCol.value.copy(T.sunCol).multiplyScalar(1 - T.night);
    skyU.cloudCol.value.copy(T.cLit); skyU.cloudShade.value.copy(T.cShade);
    cloudU.uLit.value.copy(T.cLit); cloudU.uBody.value.copy(T.cBody); cloudU.uShade.value.copy(T.cShade);
    cloudU.uSunCol.value.copy(T.sunCol).multiplyScalar((1 - T.night) * (1 - T.rain * .8));
    cloudU.uSunW.value.copy(T.lightDir); cloudU.uNight.value = T.night;
    if (L.stars) L.stars.material.uniforms.uA.value = T.night * (1 - T.rain) * .95;
    if (rain) { rain.visible = T.rain > .02; rain.material.uniforms.uA.value = T.rain; rain.material.uniforms.uCol.value.copy(T.hor).lerp(_c.setRGB(1, 1, 1), .4); }
    seaU.uCov.value = .5 + T.rain * .12;
    // re-shade clusters when the light moved enough
    const ld = T.lightDir; if (!lastShade || lastShade.distanceTo(ld) > .08) { lastShade = (lastShade || new THREE.Vector3()).copy(ld); reshade = true; }
  });
  const _c = new THREE.Color(); let lastShade = null, reshade = false;
  let sortFrame = 0;
  L.onLookTick((dt, t, cam) => {
    if (L.sky) { L.sky.position.copy(cam.position); L.stars.position.copy(cam.position); }
    if (!L.TOD.set && L.skyU) { // v4 day cycle drives skyU.top/hor: derive the rest
      skyU.mid.value.copy(skyU.hor.value).lerp(skyU.top.value, .45); skyU.low.value.copy(skyU.hor.value).lerp(_c.setRGB(1, 1, 1), .35 * (1 - skyU.night.value));
      cloudU.uSunW.value.copy(skyU.sunDir.value); if (cloudU.uSunW.value.y < .05) cloudU.uSunW.value.y = .05; cloudU.uSunW.value.normalize();
    }
    if (!FA) return;
    _v.copy(cloudU.uSunW.value).transformDirection(cam.matrixWorldInverse); cloudU.uSunV.value.copy(_v);
    if (reshade) { reshade = false; const s = cloudU.uSunW.value; for (const F of [FA, FB]) { for (const cl of F.clusters) { const hf = cl.flag === 2 ? cl.puffs.map(p => p[4]) : null; shadeCluster(cl, s.x, s.y, s.z); if (hf) cl.puffs.forEach((p, i) => { p[4] = hf[i]; }); } F.dirty = true; } }
    updateClumps(cam);
    for (const F of [FA, FB]) if (F.dirty) F.rebuild();
    // corridor visibility: inside an opened corridor the mist thins
    if (mist) { const inside = Math.hypot(cam.position.x - mist.x, cam.position.z - mist.z) < mist.r; let vis = 55; if (mist.path && mist.amount > 0) { const d = distPath(cam.position.x, cam.position.z, mist.path); vis = lerp(55, 260 + 900 * mist.amount * mist.amount, mist.amount * (1 - sstep(40, 160, d))); } if (mist.amount >= 1) vis = 1e5; L.HZ.N[3] = inside ? vis : Math.max(vis, 70); }
    if ((sortFrame++ % 6) === 0) { FA.sort(cam, t); FB.sort(cam, t); }
  });
  // v4 compatibility: the v4 game calls L.tickClouds(cam, t) once per frame and never L.lookTick
  let lastTick = -1;
  L.tickClouds = function (cam, t) { if (L._lookFrame === L.renderer.info.render.frame) return; L.lookTick(lastTick < 0 ? .016 : Math.min(.1, t - lastTick), t, cam); lastTick = t; };
})(window.L);
