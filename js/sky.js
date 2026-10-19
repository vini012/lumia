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
    night: { value: 0 }, dusk: { value: 0 }, rain: { value: 0 }, moonPh: { value: .5 }, uTime: L.uTime, tClouds: { value: null }, tNoise: { value: L.noiseTex },
    cloudCol: { value: C(0xf4f6f8) }, cloudShade: { value: C(0xa9bbd0) },
  };
  const DOME_R = Q.far * .9;
  L.makeSky = function () {
    if (L.sky) return;
    const H = L.hazeUniforms(); for (const k of ['hzM', 'hzN', 'hzP', 'hzQ']) skyU[k] = H[k];
    const sky = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, uniforms: skyU,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 top, mid, hor, low, sunDir, moonDir, sunCol, cloudCol, cloudShade; uniform float night, dusk, rain, moonPh, uTime; uniform sampler2D tNoise; varying vec3 vD;
      uniform vec4 hzM, hzN, hzP, hzQ;
      ${L.MIST_GLSL}
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
        // moon with its phase (moonPh 0 new .. .5 full .. 1 new): a lit sphere cap, the dark side faintly visible
        vec3 md = normalize(moonDir); float m = max(dot(d, md), 0.);
        if (m > .999) {
          vec3 mr = normalize(cross(md, vec3(0., 1., 0.)) + vec3(1e-4, 0., 0.)), mu = cross(mr, md);
          vec2 mq = vec2(dot(d, mr), dot(d, mu)) / .0285; float q2 = dot(mq, mq);
          float ph = moonPh * 6.2832; vec3 mn = vec3(mq, sqrt(max(1. - q2, 0.)));
          float lit = smoothstep(-.06, .06, dot(mn, vec3(sin(ph), 0., -cos(ph))));
          c += vec3(.9, .93, 1.) * (1. - smoothstep(.82, 1., q2)) * (.035 + 1.36 * lit) * night;
        }
        c += vec3(.9, .93, 1.) * pow(m, 60.) * .12 * (.25 + .75 * (.5 - .5 * cos(moonPh * 6.2832))) * night;
        // inside the Névoa the sky is the mist (only from inside: seen from outside the puffs draw its shape)
        float mi = v5MistIn(); if (mi > 0.) c = mix(c, hzN.rgb, (1. - v5MistT(hzP.xyz, d, 30000.)) * mi);
        gl_FragColor = vec4(c, 1.);
        #include <encodings_fragment>
      }`
    }));
    sky.renderOrder = L.RO.sky; sky.frustumCulled = false; L.scene.add(sky); L.sky = sky;
    // stars
    const n = 1600, p = new Float32Array(n * 3), sz = new Float32Array(n); const r = rnd(5);
    const R = DOME_R * .95;
    for (let i = 0; i < n; i++) { const u = r(), a = r() * TAU, y = .03 + Math.pow(u, .8) * .97, s = Math.sqrt(1 - y * y); p[i * 3] = Math.cos(a) * s * R; p[i * 3 + 1] = y * R; p[i * 3 + 2] = Math.sin(a) * s * R; sz[i] = .8 + Math.pow(r(), 3) * 2.6; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(sz, 1));
    const stars = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 }, uT: L.uTime, uPx: { value: 1 } },
      vertexShader: `attribute float aS; uniform float uT, uPx; varying float vA; void main(){ vA = .55 + .45 * sin(uT * (1.5 + aS) + position.x * .01 + position.z * .013); gl_PointSize = aS * 1.7 * uPx; vec4 q = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = q.xyww; }`,
      fragmentShader: `uniform float uA; varying float vA; void main(){ vec2 d = gl_PointCoord - .5; float a = smoothstep(.5, .05, length(d)); gl_FragColor = vec4(vec3(.85, .9, 1.) * a * uA * vA, 1.);
#include <encodings_fragment>
}`
    }));
    stars.frustumCulled = false; stars.renderOrder = L.RO.stars; L.scene.add(stars); L.stars = stars;
    stars.material.uniforms.uPx.value = L.renderer.getPixelRatio();
  };

  // ================================================================ puff atlas (2x2 cauliflower puffs: union of spheres seen from the front)
  // RG = view-space normal xy (encoded), B = thickness, A = coverage. Bumps sit mostly on the upper rim.
  function makePuffAtlas() {
    const S = 256, W = S * 2, data = new Uint8Array(W * W * 4);
    for (let v = 0; v < 4; v++) {
      const r = rnd(101 + v * 17); const discs = [[0, -.04, .4]];
      const nRing = 9 + Math.floor(r() * 4);
      for (let i = 0; i < nRing; i++) { const a = i / nRing * TAU + (r() - .5) * .5; const up = Math.sin(a) * .5 + .5; const d = .22 + r() * .1 + up * .06; const rr = .12 + r() * .08 + up * .05; discs.push([Math.cos(a) * d, Math.sin(a) * d * .9 - .03, rr]); }
      for (let i = 0; i < 11; i++) { const a = Math.PI * (.08 + r() * .84), d = .36 + r() * .08; discs.push([Math.cos(a) * d, Math.sin(a) * d * .92, .05 + r() * .06]); }
      const hgt = new Float32Array(S * S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const px = (x + .5) / S * 2 - 1, py = 1 - (y + .5) / S * 2; let h = 0; // py: +1 = top of the cell
        for (const [cx, cy, rr] of discs) { const dx = px - cx, dy = py - cy, q = rr * rr - dx * dx - dy * dy; if (q > 0) h = Math.max(h, Math.sqrt(q)); }
        hgt[y * S + x] = h;
      }
      const tmp = new Float32Array(S * S);   // light blur: soft crevices, no aliasing in the normals
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let s = 0; for (let d = -1; d <= 1; d++) s += hgt[y * S + clamp(x + d, 0, S - 1)]; tmp[y * S + x] = s / 3; }
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let s = 0; for (let d = -1; d <= 1; d++) s += tmp[clamp(y + d, 0, S - 1) * S + x]; hgt[y * S + x] = s / 3; }
      let hmax = 0; for (let i = 0; i < S * S; i++) hmax = Math.max(hmax, hgt[i]);
      const ox = (v % 2) * S, oy = Math.floor(v / 2) * S, k = S / 4; // gradient scale: field units -> pixels
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const h = hgt[y * S + x];
        const gx = (hgt[y * S + Math.min(x + 1, S - 1)] - hgt[y * S + Math.max(x - 1, 0)]) * k;
        const gy = (hgt[Math.max(y - 1, 0) * S + x] - hgt[Math.min(y + 1, S - 1) * S + x]) * k; // +y up
        let nx = -gx, ny = -gy, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl;
        const o = ((oy + (S - 1 - y)) * W + ox + x) * 4; // DataTexture rows run bottom-up
        data[o] = (nx * .5 + .5) * 255; data[o + 1] = (ny * .5 + .5) * 255; data[o + 2] = clamp(h / hmax, 0, 1) * 255;
        data[o + 3] = sstep(.0, .055, h) * 255;
      }
    }
    const t = new THREE.DataTexture(data, W, W, THREE.RGBAFormat); t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  }

  // ================================================================ puff field: one draw call of sorted, lit billboards
  // flags: 0 static, 1 drift + wrap around the camera (sky cumulus), 2 churn (mist), 3 sea clump (gentle bob)
  const cloudU = {
    tPuff: { value: null }, uSunV: { value: new THREE.Vector3() }, uUpV: { value: new THREE.Vector3(0, 1, 0) }, uSunW: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
    uLit: { value: C(0xf4f6f8) }, uBody: { value: C(0xd9dde2) }, uShade: { value: C(0xb6c3d3) }, uDeep: { value: C(0x9cb0c9) }, uTime: L.uTime,
    uDrift: { value: new THREE.Vector2(1.2, .5) }, uWrap: { value: 24000 }, uNight: { value: 0 }, uSeaDrift: { value: new THREE.Vector2() },
  };
  // the cloud sea (far layer AND its islands) sways slowly back and forth instead of drifting away, so the islands keep
  // matching the coverage field they were placed on and never wander over land; the same offset in JS and GLSL
  const seaDrift = cloudU.uSeaDrift.value;
  const seaDriftAt = (t, out) => out.set(Math.sin(t * .0045) * 60, Math.sin(t * .0031 + 1) * 35);
  L.cloudU = cloudU;
  // aP: half size (m), horizontal stretch, sun occlusion, seed | aQ: cluster centre xyz, flag | aB: base y, top y, base softness (m),
  // sprite tilt range | aL: offset from the puff to its lobe centre xyz, lobe radius | aS: style (0 cumulus, 1 flat sea
  // island, 2 Névoa mist wall, 3 thin see-through mist: banks, waterfall spray), lobe y-stretch.
  // Shading: the normal is the analytic normal of the LOBE sphere at this pixel (every puff of a lobe agrees, so a lobe
  // reads as one big smooth cauliflower head like in the paintings); the sprite's own bump normal adds a little relief.
  // Sea islands get the painted two-tone (lit top band over blue-grey sides).
  const PUFF_VS = `
    attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aQ; attribute vec4 aB; attribute vec4 aL; attribute vec2 aS; attribute float aFade;
    uniform vec2 uDrift, uSeaDrift; uniform float uWrap, uTime;
    varying vec2 vUv; varying vec3 vCn; varying vec4 vP; varying float vFade; varying vec2 vRot; varying vec3 vW; varying vec4 vB;
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
      } else if (fl > 2.5) { float b = sin(uTime * .12 + aP.w * 30.) * aP.x * .03; p.y += b; p.xz += uSeaDrift; cc.xz += uSeaDrift; }
      float s = aP.x; float rot = (fract(aP.w * 13.) - .5) * aB.w; float cr = cos(rot), sr = sin(rot);
      vec2 cn = vec2(cr * aCorner.x - sr * aCorner.y, sr * aCorner.x + cr * aCorner.y);
      float asp = max(aP.y, 1.);  // horizontal stretch (flat sea islands)
      vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 off = (camR * aCorner.x * asp + camU * aCorner.y) * s; vec3 wc = p + off;   // this corner in world space
      vec4 mvPosition = viewMatrix * vec4(p, 1.);
      float dz = -mvPosition.z; float nf = smoothstep(s * .35, s * 1.1, dz);   // puffs we are inside of fade out
      mvPosition.xy += aCorner * s * vec2(asp, 1.); mvPosition.z += s * .3;
      gl_Position = projectionMatrix * mvPosition;
      // this corner seen on the lobe: screen-plane offset from the lobe centre (at the lobe's depth) / lobe radius
      vec3 lc = (viewMatrix * vec4(p + aL.xyz, 1.)).xyz;
      vec2 fq = mvPosition.xy * (lc.z / min(mvPosition.z, -1.)) - lc.xy;
      vCn = vec3(fq.x, fq.y * aS.y, 0.) / max(aL.w, 1.);
      float vi = floor(fract(aP.w * 3.7) * 4.); vec2 cell = vec2(mod(vi, 2.), floor(vi / 2.)) * .5;
      vUv = cell + (cn * .5 + .5) * .5; vRot = vec2(cr, sr);
      vP = aP; vFade = aFade * nf; vW = wc; vB = vec4(aB.xyz, aS.x);
      #include <fog_vertex>
    }`;
  const PUFF_FS = `
    uniform sampler2D tPuff; uniform vec3 uSunV, uUpV, uSunW, uSunCol, uLit, uBody, uShade, uDeep; uniform float uNight;
    varying vec2 vUv; varying vec3 vCn; varying vec4 vP; varying float vFade; varying vec2 vRot; varying vec3 vW; varying vec4 vB;
    #include <fog_pars_fragment>
    vec3 cloudRamp(float l) {   // deep blue-grey -> shade -> body -> lit (GDD cloud palette)
      vec3 c = mix(uDeep, uShade, smoothstep(.0, .32, l)); c = mix(c, uBody, smoothstep(.28, .62, l)); return mix(c, uLit, smoothstep(.58, .92, l));
    }
    void main(){
      vec4 tx = texture2D(tPuff, vUv);
      float style = vB.w;
      float hp = clamp((vW.y - vB.x) / max(vB.y - vB.x, 1.), 0., 1.);
      float a = tx.a * vFade * smoothstep(vB.x - vB.z * .25, vB.x + vB.z, vW.y);   // flat, soft bases
      if (style > 2.5) a *= .38 * smoothstep(.0, .5, tx.a);                       // thin mist (banks, waterfall spray): see-through
      if (a < .004) discard;
      vec2 nxy = tx.rg * 2. - 1.; nxy = vec2(vRot.x * nxy.x - vRot.y * nxy.y, vRot.y * nxy.x + vRot.x * nxy.y);
      vec3 nS = vec3(nxy, sqrt(max(0., 1. - dot(nxy, nxy))));
      float dl = dot(vCn.xy, vCn.xy);
      vec3 nL = dl < 1. ? vec3(vCn.xy, sqrt(1. - dl)) : vec3(vCn.xy * inversesqrt(dl), 0.);   // lobe sphere normal (view space)
      vec3 N = normalize(nL + nS * (style > .5 && style < 1.5 ? .22 : .3));
      float ndl = dot(N, uSunV), nup = dot(N, uUpV);
      float occ = vP.z;
      float sun = smoothstep(-.45, .85, ndl) * (1. - occ * .75);
      float sky = clamp(.5 + .5 * nup, 0., 1.);
      float l;
      if (style > .5 && style < 1.5) {
        // flat island: a lit top band over blue-grey sides (painted two-tone), crevices from the sprite relief
        float band = smoothstep(.56, .86, hp * 1.1 + nL.y * .12 + (tx.b - .5) * .3);
        l = mix(.08 + sun * .14 + sky * .06, .72 + sun * .28, band);
      } else {
        sun *= smoothstep(-.25, .3, hp + ndl * .3);                                  // undersides stay in shade
        l = sun * .58 + sky * .3 + .12 + hp * .06;
        if (style > 1.5) l = mix(style > 2.5 ? .8 : .55, l, style > 2.5 ? .4 : .6);   // the mist: soft, low contrast
      }
      vec3 col = cloudRamp(l);
      vec3 V = normalize(vW - cameraPosition);
      float fwd = pow(max(dot(V, uSunW), 0.), 6.) * (1. - uNight);
      col += uSunCol * fwd * (1. - tx.b) * smoothstep(.55, 1.05, dl) * .8;           // silver lining on the lobe rims
      col = min(col, vec3(1.)) * .94;                // keep the lit tops under the bloom threshold: they model instead of clipping
      gl_FragColor = vec4(col, a);
      #ifdef USE_FOG
        // any cloud that is not the Névoa itself fades out inside / behind the Névoa (the Névoa field draws first)
        { vec3 mv = vW - hzP.xyz; float ml = length(mv), mt = v5MistT(hzP.xyz, mv / max(ml, 1e-3), ml);
          if (style < 1.5 || style > 2.5) gl_FragColor.a *= mt;
          else gl_FragColor.rgb = mix(gl_FragColor.rgb, hzN.rgb, (1. - mt) * v5MistIn()); }   // seen from inside, the Névoa's own puffs melt into its colour
        float fogDist = length(vFogW);
        float hH = hzD.w; float fe = vFogW.y / hH; float fInt = abs(fe) > 1e-3 ? (1. - exp(-fe)) / fe : 1. - fe * .5;
        // clouds keep their whites: a third of the ground haze, faded into the horizon only at the far ring
        float tA = fogDensity * .2 * fogDist * (exp(-max(hzP.y - hzE.x, -40.) / hH) * fInt + hzE.y * .5);
        vec3 fHor = mix(fogColor, hzC.rgb, pow(max(dot(vFogW / max(fogDist, 1.), hzD.xyz), 0.), hzC.w));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fHor, max(1. - exp(-tA * hzB.w * .8), smoothstep(hzE.z, hzE.w * 1.1, fogDist)));
      #endif
      #include <encodings_fragment>
    }`;
  let puffTex = null;
  function PuffField(cap, renderOrder, name) {
    this.cap = cap; this.n = 0; this.req = 0; this.clusters = []; this.dirty = true; this.sortT = 0; this.rx = 1e9; this.rz = 1e9; this.lo = 1e9; this.hi = -1; this.flo = 1e9; this.fhi = -1;
    const g = new THREE.BufferGeometry(); const V = cap * 4;
    this.pos = new Float32Array(V * 3); this.ap = new Float32Array(V * 4); this.aq = new Float32Array(V * 4); this.ab = new Float32Array(V * 4); this.al = new Float32Array(V * 4); this.as = new Float32Array(V * 2); this.fade = new Float32Array(V);
    const corner = new Float32Array(V * 2); for (let i = 0; i < cap; i++) { corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8); }
    this.idx = V < 65536 ? new Uint16Array(cap * 6) : new Uint32Array(cap * 6);
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPP = new THREE.BufferAttribute(this.ap, 4); this.aQQ = new THREE.BufferAttribute(this.aq, 4); this.aBB = new THREE.BufferAttribute(this.ab, 4); this.aLL = new THREE.BufferAttribute(this.al, 4); this.aSS = new THREE.BufferAttribute(this.as, 2); this.aF = new THREE.BufferAttribute(this.fade, 1);
    g.setAttribute('position', this.aPos); g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2)); g.setAttribute('aP', this.aPP); g.setAttribute('aQ', this.aQQ); g.setAttribute('aB', this.aBB); g.setAttribute('aL', this.aLL); g.setAttribute('aS', this.aSS); g.setAttribute('aFade', this.aF);
    this.aIdx = new THREE.BufferAttribute(this.idx, 1); this.aIdx.setUsage(THREE.DynamicDrawUsage); g.setIndex(this.aIdx); g.setDrawRange(0, 0);
    this.geo = g; this.skeys = new Float64Array(cap); this.ord = [];
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false, fog: true });
    for (const k in cloudU) mat.uniforms[k] = cloudU[k];
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.name = name;
    L.scene.add(this.mesh);
  }
  // cluster: {puffs:[[x,y,z,size,stretch,occ,seed,fade,lobeX,lobeY,lobeZ]...], cx,cy,cz, flag, style, base, top, soft, tilt, fade, lobes}
  PuffField.prototype.add = function (cl) {
    cl.fade = cl.fade == null ? 1 : cl.fade; cl._o = -1; cl._n = 0; this.clusters.push(cl); this.dirty = true; return cl;
  };
  PuffField.prototype.remove = function (cl) { const i = this.clusters.indexOf(cl); if (i >= 0) { this.clusters.splice(i, 1); cl._o = -1; this.dirty = true; } };
  // distance used to rank clusters when the field is over its cap (sky clusters measured on the drifting torus)
  function clusterDist(cl, cx, cz) {
    let px = cl.cx, pz = cl.cz;
    if (cl.flag === 1) { const W = cloudU.uWrap.value, t = L.uTime.value; px += cloudU.uDrift.value.x * t; pz += cloudU.uDrift.value.y * t; px = cx + (((px - cx + W * .5) % W + W) % W - W * .5); pz = cz + (((pz - cz + W * .5) % W + W) % W - W * .5); }
    else if (cl.flag === 3) { px += seaDrift.x; pz += seaDrift.y; }
    return Math.max(0, Math.hypot(px - cx, pz - cz) - (cl.R || (cl.top - cl.base)));
  }
  const byD = (a, b) => a._d - b._d;
  // Fill the buffers. Under the cap, clusters go in insertion order; over it, nearest first so the far tail is what
  // gets dropped (the field is re-ranked when the camera has moved far enough, see tick).
  PuffField.prototype.rebuild = function (cam) {
    let req = 0; for (const cl of this.clusters) req += cl.puffs.length; this.req = req;
    let list = this.clusters;
    if (req > this.cap) {
      const cx = cam ? cam.position.x : 0, cz = cam ? cam.position.z : 0; this.rx = cx; this.rz = cz;
      const o = this.ord; o.length = 0; for (const cl of this.clusters) { cl._d = clusterDist(cl, cx, cz); o.push(cl); } o.sort(byD); list = o;
      if (!this.warned) { this.warned = true; console.warn('[look] cloud field "' + this.mesh.name + '" over its cap: ' + req + ' puffs requested, ' + this.cap + ' drawn (nearest first)'); }
    }
    let n = 0;
    for (const cl of list) {
      cl._o = n < this.cap ? n : -1; cl._n = 0;
      for (const p of cl.puffs) {
        if (n >= this.cap) break;
        for (let k = 0; k < 4; k++) {
          const v = n * 4 + k;
          this.pos[v * 3] = p[0]; this.pos[v * 3 + 1] = p[1]; this.pos[v * 3 + 2] = p[2];
          this.ap[v * 4] = p[3]; this.ap[v * 4 + 1] = p[4]; this.ap[v * 4 + 2] = p[5]; this.ap[v * 4 + 3] = p[6];
          this.aq[v * 4] = cl.cx; this.aq[v * 4 + 1] = cl.cy; this.aq[v * 4 + 2] = cl.cz; this.aq[v * 4 + 3] = cl.flag;
          this.ab[v * 4] = cl.base; this.ab[v * 4 + 1] = cl.top; this.ab[v * 4 + 2] = cl.soft; this.ab[v * 4 + 3] = cl.tilt;
          const lb = cl.lobes && p[11] != null ? cl.lobes[p[11]] : null;
          if (lb) { this.al[v * 4] = lb[0] - p[0]; this.al[v * 4 + 1] = lb[1] - p[1]; this.al[v * 4 + 2] = lb[2] - p[2]; this.al[v * 4 + 3] = lb[3]; this.as[v * 2 + 1] = lb[5] || 1; }
          else { this.al[v * 4] = cl.cx - p[0]; this.al[v * 4 + 1] = cl.cy - p[1]; this.al[v * 4 + 2] = cl.cz - p[2]; this.al[v * 4 + 3] = cl.R || (cl.top - cl.base); this.as[v * 2 + 1] = 1; }
          this.as[v * 2] = cl.style || 0;
          this.fade[v] = cl.fade * (p[7] == null ? 1 : p[7]);
        }
        n++; cl._n++;
      }
    }
    this.n = n;
    for (const a of [this.aPos, this.aPP, this.aQQ, this.aBB, this.aLL, this.aSS, this.aF]) { a.updateRange.offset = 0; a.updateRange.count = -1; a.needsUpdate = true; }
    this.dirty = false; this.sortT = 0; this.lo = this.flo = 1e9; this.hi = this.fhi = -1;
  };
  // partial updates: write one cluster's sun occlusion (aP.z) or fade into the buffers and widen the upload range
  PuffField.prototype.writeOcc = function (cl) {
    if (this.dirty || cl._o < 0) return;
    for (let k = 0; k < cl._n; k++) { const p = cl.puffs[k], b = (cl._o + k) * 16 + 2; this.ap[b] = this.ap[b + 4] = this.ap[b + 8] = this.ap[b + 12] = p[5]; }
    this.lo = Math.min(this.lo, cl._o); this.hi = Math.max(this.hi, cl._o + cl._n);
  };
  PuffField.prototype.writeFade = function (cl) {
    if (this.dirty || cl._o < 0) return;
    for (let k = 0; k < cl._n; k++) { const p = cl.puffs[k], f = cl.fade * (p[7] == null ? 1 : p[7]), b = (cl._o + k) * 4; this.fade[b] = this.fade[b + 1] = this.fade[b + 2] = this.fade[b + 3] = f; }
    this.flo = Math.min(this.flo, cl._o); this.fhi = Math.max(this.fhi, cl._o + cl._n);
  };
  PuffField.prototype.flush = function () {
    if (this.hi > this.lo) { const a = this.aPP; a.updateRange.offset = this.lo * 16; a.updateRange.count = (this.hi - this.lo) * 16; a.needsUpdate = true; }
    if (this.fhi > this.flo) { const a = this.aF; a.updateRange.offset = this.flo * 4; a.updateRange.count = (this.fhi - this.flo) * 4; a.needsUpdate = true; }
    this.lo = this.flo = 1e9; this.hi = this.fhi = -1;
  };
  // back-to-front sort by view depth (replicates the shader's drift/wrap so the order matches)
  PuffField.prototype.sort = function (cam, t) {
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z; const e = cam.matrixWorld.elements; const fx = -e[8], fy = -e[9], fz = -e[10];
    const W = cloudU.uWrap.value, dx0 = cloudU.uDrift.value.x * t, dz0 = cloudU.uDrift.value.y * t;
    const keys = this.skeys; const n = this.n;
    for (let i = 0; i < n; i++) {
      const v = i * 4; let px = this.pos[v * 3], py = this.pos[v * 3 + 1], pz = this.pos[v * 3 + 2]; const fl = this.aq[v * 4 + 3];
      if (fl === 1) { const ccx = this.aq[v * 4] + dx0, ccz = this.aq[v * 4 + 2] + dz0; px += dx0; pz += dz0; const rx = ((ccx - cx + W * .5) % W + W) % W - W * .5, rz = ((ccz - cz + W * .5) % W + W) % W - W * .5; px += cx + rx - ccx; pz += cz + rz - ccz; }
      else if (fl === 3) { px += seaDrift.x; pz += seaDrift.y; }
      const d = (px - cx) * fx + (py - cy) * fy + (pz - cz) * fz - this.ap[v * 4] * .3;
      keys[i] = Math.floor(clamp(1e5 - d, 0, 4e6) * 8) * 65536 + i; // larger depth first
    }
    const sub = keys.subarray(0, n); sub.sort();
    const idx = this.idx;
    for (let k = 0; k < n; k++) { const i = sub[k] % 65536; const b = i * 4, o = k * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
    this.aIdx.updateRange.count = n * 6; this.aIdx.needsUpdate = true; this.geo.setDrawRange(0, n * 6);
  };
  // sun occlusion per puff (cheap self-shadowing; recomputed when the sun moves). Clusters built from lobes test the
  // ray toward the sun against the OTHER lobes (smooth, coherent shadows); others fall back to puff-vs-puff.
  function shadeCluster(cl, sx, sy, sz) {
    const P = cl.puffs, Lb = cl.lobes;
    const lobeOcc = (x, y, z, self) => {
      let occ = 0;
      for (let k = 0; k < Lb.length; k++) {
        const q = Lb[k]; if (self === k) continue;
        const dx = q[0] - x, dy = (q[1] - y) * (q[5] || 1), dz = q[2] - z; const along = dx * sx + dy * sy + dz * sz; if (along <= 0) continue;
        const lx = dx - sx * along, ly = dy - sy * along, lz = dz - sz * along; const lat = Math.sqrt(lx * lx + ly * ly + lz * lz); const rr = q[3] * 1.05;
        if (lat < rr) occ += (1 - lat / rr) * Math.min(1, along / (rr * .8)) * .7;
      }
      return occ;
    };
    if (Lb) for (let k = 0; k < Lb.length; k++) Lb[k].occ = lobeOcc(Lb[k][0], Lb[k][1], Lb[k][2], k);
    for (const p of P) {
      let occ = 0;
      if (Lb) {
        // mostly the lobe's own value (one smooth head), a little per puff
        const lo = p[11] != null ? Lb[p[11]].occ : 0; occ = lo + (lobeOcc(p[0], p[1], p[2], p[11]) - lo) * .3;
      } else {
        for (const q of P) {
          if (q === p) continue; const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2]; const along = dx * sx + dy * sy + dz * sz; if (along <= 0) continue;
          const lx = dx - sx * along, ly = dy - sy * along, lz = dz - sz * along; const lat = Math.sqrt(lx * lx + ly * ly + lz * lz); const rr = q[3] * .95;
          if (lat < rr) occ += (1 - lat / rr) * Math.min(1, q[3] / Math.max(p[3], 1)) * Math.min(1, along / (p[3] * 1.5)) * .5;
        }
      }
      p[5] = clamp(occ, 0, 1);
    }
  }

  // ---------------------------------------------------------------- cluster shapes
  // Puff sprites show a blob of radius ~.58 x their half size, so a lobe of radius R is covered by a puff of size R / .58.
  const VIS = .58;
  // cumulus: a row of base lobes (flat bottom) and 1-3 towers of shrinking lobes; puffs sit on each lobe's upper and outer
  // surface (the cauliflower outline) plus one big filler per lobe (no holes). Every puff remembers its lobe for shading.
  function cumulusLobes(r, w, h, D) {
    const lobes = []; const nb = 3 + Math.floor(r() * 3), baseR = w / (nb * 1.2 + 1.1);
    for (let i = 0; i < nb; i++) {
      const t = i / (nb - 1) - .5; const rad = baseR * (.85 + r() * .35) * (1 - Math.abs(t) * .4);
      lobes.push([t * (w - rad * 2.1) + (r() - .5) * rad * .25, rad * .4, (r() - .5) * D * .45, rad]);
    }
    const nt = 1 + Math.floor(r() * 2.7);
    for (let k = 0; k < nt; k++) {
      let x = (r() - .5) * w * (k ? .6 : .22), z = (r() - .5) * D * .35; const top = h * (k ? .5 + r() * .35 : .92 + r() * .08);
      const rad0 = Math.min(w * (k ? .13 + r() * .05 : .16 + r() * .05), top * .45); let y = baseR * .42, rad = rad0;
      for (let g = 0; g < 8 && y + rad * .95 < top; g++) { y = Math.min(y + rad * .85, top - rad * .95); rad = Math.max(rad0 * .62, rad * .9); lobes.push([x, y, z, rad]); x += (r() - .5) * rad * .35; }
    }
    return lobes;
  }
  function puffsOnLobes(r, lobes, nMul, sizeK) {
    const P = []; const inside = (x, y, z, skip) => { for (let k = 0; k < lobes.length; k++) { if (k === skip) continue; const q = lobes[k], dx = x - q[0], dy = (y - q[1]) * (q[5] || 1), dz = z - q[2]; if (dx * dx + dy * dy + dz * dz < q[3] * q[3] * .7) return true; } return false; };
    for (let k = 0; k < lobes.length; k++) {
      const q = lobes[k], R = q[3];
      P.push([q[0], q[1], q[2], R * 1.02 / VIS, 0, 0, r(), 1, q[0], q[1], q[2], k]);               // filler
      const n = Math.max(3, Math.round((5 + R / 34) * (nMul || 1)));
      for (let i = 0, tries = 0; i < n && tries < n * 12; tries++) {
        const u = r() * 2 - 1, a = r() * TAU, sq = Math.sqrt(1 - u * u); let dx = sq * Math.cos(a), dy = u, dz = sq * Math.sin(a);
        if (dy < -.3) continue;                                                              // bottoms are flat anyway
        const x = q[0] + dx * R * .8, y = q[1] + dy * R * .8, z = q[2] + dz * R * .8;
        if (inside(x, y, z, k)) continue;
        P.push([x, y, z, R * (.48 + r() * .22) * (sizeK || 1) / VIS, 0, 0, r(), 1, q[0], q[1], q[2], k]); i++;
      }
    }
    return P;
  }
  function cumulusPuffs(r, w, h, depthK, nMul) {
    const lobes = cumulusLobes(r, w, h, w * (depthK || .38));
    return { P: puffsOnLobes(r, lobes, nMul), lobes };
  }
  // flat sea island ("pancake"): a chain of flattened ellipsoids; wide stretched puffs; lit top band, blue-grey sides
  function islandPuffs(r, w, h, nMul) {
    const lobes = []; const n = clamp(Math.round(w / 70) + 1, 2, 7); let x = -w * .3, z = (r() - .5) * w * .1; const dir = (r() - .5) * .8;
    for (let i = 0; i < n; i++) {
      const rx = w * (.16 + r() * .1), ry = h * (.42 + r() * .16);
      lobes.push([x, ry * .55, z, rx, ry, rx / ry]);   // [x, y, z, radius(horizontal), ry, y-stretch for distances]
      x += w * .6 / (n - 1 || 1) * (.7 + r() * .6); z += (dir + (r() - .5) * .6) * rx * .5;
    }
    let cx = 0, cz = 0; for (const q of lobes) { cx += q[0]; cz += q[2]; } cx /= n; cz /= n; for (const q of lobes) { q[0] -= cx; q[2] -= cz; }
    const P = [];
    for (let k = 0; k < n; k++) {
      const q = lobes[k], rx = q[3], ry = q[4], asp = clamp(rx / ry * .55, 1.4, 3.2);
      P.push([q[0], q[1], q[2], ry * 1.05 / VIS, asp, 0, r(), 1, q[0], q[1], q[2], k]);
      const m = Math.max(2, Math.round((3 + rx / 40) * (nMul || 1)));
      for (let i = 0; i < m; i++) {
        const a = r() * TAU, d = Math.sqrt(r()) * .75; const s = ry * (.55 + r() * .35) / VIS;
        P.push([q[0] + Math.cos(a) * d * rx, q[1] + ry * (.1 + r() * .35), q[2] + Math.sin(a) * d * rx * .8, s, clamp(asp * (.7 + r() * .4), 1.2, 3.2), 0, r(), 1, q[0], q[1], q[2], k]);
      }
    }
    return { P, lobes };
  }
  function placeCluster(S, x, y, z, w, h, flag, tilt, style) {
    for (const p of S.P) { p[0] += x; p[1] += y; p[2] += z; if (p[8] != null) { p[8] += x; p[9] += y; p[10] += z; } }
    if (S.lobes) for (const q of S.lobes) { q[0] += x; q[1] += y; q[2] += z; }
    return { puffs: S.P, lobes: S.lobes, cx: x, cy: y + h * .35, cz: z, flag, style: style || 0, base: y, top: y + h, soft: Math.max(4, h * .08), tilt: tilt == null ? .6 : tilt };
  }

  // ================================================================ cumulus (sky)
  // FA: sky cumulus, FB: low clouds (sea islands, fall spray, lab clusters), FM: the Névoa. Created on first use, so
  // L.clouds / L.addFallMist / L.mistVisual work before L.skyInit (the fields are shared afterwards).
  let FA = null, FB = null, FM = null;
  const FIELDS = [];
  function ensureFields() {
    if (FA) return;
    puffTex = puffTex || makePuffAtlas(); cloudU.tPuff.value = puffTex;
    FA = new PuffField(Math.round(5200 * Math.max(.45, Q.cloudPuffs)), L.RO.cumulus, 'cumulus');
    FB = new PuffField(Q.lowCap || Math.round(5200 * Math.max(.5, Q.cloudPuffs)), L.RO.low, 'lowclouds');
    FM = new PuffField(Math.ceil(520 * Q.mistPuffs) + 32, L.RO.mist, 'mist');
    FIELDS.push(FA, FB, FM);
    L.cloudGroup = FA.mesh;
  }
  L.clouds = {
    // add one cumulus with its flat base at world (x, y, z); w = width, h = height; opts.wrap: follow the camera torus, opts.low: low field
    addCumulus(x, y, z, w, h, seed, opts) {
      ensureFields();
      const r = rnd(seed || 1); const cl = placeCluster(cumulusPuffs(r, w, h, 0, opts && opts.nMul), x, y, z, w, h, opts && opts.wrap ? 1 : 0, .6, 0);
      shadeCluster(cl, L.TOD.lightDir.x, L.TOD.lightDir.y, L.TOD.lightDir.z);
      return (opts && opts.low ? FB : FA).add(cl);
    },
    // low, wide cloud (cloud sea clump, mist bank, waterfall spray): base at y; style 1 = flat island (default), 3 = thin mist
    addClump(x, y, z, w, h, seed, flag, nMul, style) {
      ensureFields();
      const r = rnd(seed || 1); const cl = placeCluster(islandPuffs(r, w, h, nMul || 1), x, y, z, w, h, flag == null ? 3 : flag, .5, style || 1);
      shadeCluster(cl, L.TOD.lightDir.x, L.TOD.lightDir.y, L.TOD.lightDir.z); return FB.add(cl);
    },
    remove(cl) { if (!FA) return; for (const F of FIELDS) if (F.clusters.includes(cl)) { F.remove(cl); return; } },
    get fieldSky() { ensureFields(); return FA; }, get fieldLow() { ensureFields(); return FB; }, get fieldMist() { ensureFields(); return FM; },
  };
  // a random field of cumulus wrapping around the camera (24 km torus), altitude band [y0, y1]
  let cumulusBuilt = false;
  L.buildClouds = function (opts) {
    ensureFields();
    if (cumulusBuilt) return; cumulusBuilt = true;
    opts = opts || {};
    const r = rnd(opts.seed || 77); const n = Math.round((opts.count || 30) * Q.cloudPuffs); const W = cloudU.uWrap.value;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = 1800 + Math.sqrt(r()) * (W * .5 - 1800); const w = 500 + r() * 1000;
      L.clouds.addCumulus(Math.cos(a) * d, (opts.y0 || 950) + r() * ((opts.y1 || 1500) - (opts.y0 || 950)), Math.sin(a) * d, w, w * (.4 + r() * .4), 1000 + i, { wrap: true, nMul: .7 });
    }
    L.cloudMats = [];
  };

  // ================================================================ cloud sea: far relief layer (puffy domes) + near islands
  // A slab [base, top] around L.CLOUD_Y. Each pixel of a camera-following disc searches the view ray through the slab
  // against a dome heightfield (density map x big fbm x cell bumps), then shades the hit like the cumulus puffs:
  // lit tops, blue-grey sides and undersides, translucent thin edges over the ocean holes. Iterations per tier (Q.seaSteps).
  const seaU = {
    uTime: L.uTime, tNoise: { value: L.noiseTex }, tDens: { value: null }, uDensXf: { value: new THREE.Vector4(0, 0, 1e-9, 0) }, // x0, z0, 1/size, enabled
    uSunW: cloudU.uSunW, uLit: cloudU.uLit, uBody: cloudU.uBody, uShade: cloudU.uShade, uDeep: cloudU.uDeep, uSunCol: cloudU.uSunCol, uNight: cloudU.uNight,
    uSeaDrift: cloudU.uSeaDrift, uCov: { value: .5 }, uSeaY: { value: L.CLOUD_Y }, uSlab: { value: new THREE.Vector2(50, 42) }, uFar: { value: new THREE.Vector2(1100, 2600) },   // depth below / height above CLOUD_Y
  };
  L.seaU = seaU;
  // tileable dome heightfield: R = big cumulus heads, G = small cauliflower bumps (union of sphere caps)
  function makeDomeTex() {
    const N = 256, d = new Uint8Array(N * N * 4), hR = new Float32Array(N * N), hG = new Float32Array(N * N); const r = rnd(4242);
    const splat = (H, cx, cy, rad) => { const R = Math.ceil(rad); for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { const q = rad * rad - x * x - y * y; if (q <= 0) continue; const i = ((Math.round(cy) + y) % N + N) % N, j = ((Math.round(cx) + x) % N + N) % N; const v = Math.sqrt(q) / 40; if (v > H[i * N + j]) H[i * N + j] = v; } };
    for (let k = 0; k < 70; k++) splat(hR, r() * N, r() * N, 16 + r() * 26);
    for (let k = 0; k < 420; k++) splat(hG, r() * N, r() * N, 5 + r() * 9);
    let mR = 0, mG = 0; for (let i = 0; i < N * N; i++) { mR = Math.max(mR, hR[i]); mG = Math.max(mG, hG[i]); }
    for (let i = 0; i < N * N; i++) { d[i * 4] = hR[i] / mR * 255; d[i * 4 + 1] = hG[i] / mG * 255; d[i * 4 + 2] = 0; d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
  }
  seaU.tDome = { value: makeDomeTex() };
  const SEA_STEPS = Math.max(0, Q.seaSteps | 0);
  const SEA_VS = `
    uniform float uSeaY; uniform vec2 uSlab; varying vec3 vW;
    #include <fog_pars_vertex>
    void main(){ vec3 p = position; p.xz += cameraPosition.xz;
      p.y = cameraPosition.y > uSeaY - uSlab.x * .2 ? uSeaY + uSlab.y : uSeaY - uSlab.x;
      vW = p; vec4 mvPosition = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const SEA_FS = `
    #define STEPS ${SEA_STEPS}
    uniform mat4 projectionMatrix;
    uniform sampler2D tNoise, tDens, tDome; uniform vec4 uDensXf; uniform vec3 uSunW, uLit, uBody, uShade, uDeep, uSunCol; uniform float uTime, uCov, uSeaY, uNight; uniform vec2 uSlab, uFar, uSeaDrift;
    varying vec3 vW;
    #include <fog_pars_fragment>
    vec3 cloudRamp(float l) {   // deep blue-grey -> shade -> body -> lit (GDD cloud palette)
      vec3 c = mix(uDeep, uShade, smoothstep(.0, .32, l)); c = mix(c, uBody, smoothstep(.28, .6, l)); return mix(c, uLit, smoothstep(.56, .9, l));
    }
    vec2 gChurn;
    // fraction (0..1) of the slab filled by cloud at p; det = 0..1 detail level (0 far: softer edges, no small bumps,
    // which keeps the far horizon from breaking into shimmering bands)
    float seaH(vec2 p, float det) {
      float d = uDensXf.w > 0. ? texture2D(tDens, (p - uDensXf.xy) * uDensXf.z).r : .5;
      vec4 n = texture2D(tNoise, (p - uSeaDrift) / 3000.);              // coverage moves with the islands (CPU twin: coverageAt)
      float c = d * 1.3 - .65 + (n.r - .5) * .8 + (n.a - .5) * .45 + (uCov - .5);
      float fe = 1. - det;
      float cov = smoothstep(-.02 - fe * .1, .12 + fe * .16, c);         // cloud islands with steep, soft sides
      float m = texture2D(tDome, (p - uSeaDrift + gChurn) / 1500.).r;   // lumpy tops: 100-250 m heads, slowly churning
      float dome = cov * (.3 + .45 * m + .25 * smoothstep(.1, .5, c));
      if (det > 0.) { float k = texture2D(tDome, (p - uSeaDrift - gChurn * .7) / 520. + .37).g; dome += (k - .55) * .14 * det * smoothstep(.0, .2, dome); }
      return dome;
    }
    void main(){
      gChurn = vec2(uTime * .35, uTime * .14);
      float base = uSeaY - uSlab.x, T = uSlab.x + uSlab.y;
      vec3 ro = cameraPosition, rd = normalize(vW - ro);
      float dist0 = length(vW - ro);
      float det = 1. - smoothstep(2500., 6000., dist0);
      vec3 hp = vW; float hf = 0.; float hit = 0.;
      bool above = ro.y > uSeaY - uSlab.x * .2;
    #if STEPS > 0
      if (above && rd.y < -.002) {
        // relief search without noise: damped fixed-point iterations of "ray height = dome height" from the slab top
        // (no jitter, so no speckle at grazing angles), then one secant refinement
        float t = dist0, tMax = (base - ro.y) / rd.y;
        for (int i = 0; i < STEPS; i++) {
          vec3 s = ro + rd * t; float h = seaH(s.xz, det);
          float tn = (base + T * h - ro.y) / rd.y; t = clamp(mix(t, tn, .6), dist0, tMax);
        }
        hp = ro + rd * t; hf = seaH(hp.xz, det);
        hit = smoothstep(.0, .2, hf);
      } else
    #endif
      { hf = seaH(vW.xz, det * .5); hit = smoothstep(.04, .3, hf); }
      if (hit < .01) discard;
      // normal from the heightfield (scale grows with distance so far domes stay smooth)
      float e = mix(7., 40., 1. - det);
      float hx = seaH(hp.xz + vec2(e, 0.), det), hz = seaH(hp.xz + vec2(0., e), det);
      vec3 N = normalize(vec3(-(hx - hf) * T / e, 1., -(hz - hf) * T / e));
      float occ = smoothstep(.0, .25, seaH(hp.xz + normalize(uSunW.xz + 1e-4) * 70., det * .5) - hf - .05);
      float hgt = clamp((hp.y - base) / T, 0., 1.);
      float sunv = clamp(dot(N, uSunW) * 1.2, 0., 1.) * (1. - occ * .7);
      float top = smoothstep(.45, .95, N.y);
      vec3 col = cloudRamp(top * .45 + sunv * .4 + hgt * .2);
      if (!above) col = cloudRamp(.25);                       // seen from below: flat grey-blue underside
      vec3 V = rd;
      col += uSunCol * pow(max(dot(V, uSunW), 0.), 8.) * (1. - smoothstep(.0, .3, hf)) * .8 * (1. - uNight);
      float a = hit * smoothstep(.0, .12, hf + hgt * .3) * smoothstep(uFar.x, uFar.y, length(hp - ro));
      if (above) a *= smoothstep(.006, .03, -rd.y);           // edge-on from just above the slab it would be a hard line: leave the horizon to the islands
      col = min(col, vec3(1.)) * .95;
      gl_FragColor = vec4(col, a);
      // depth of the relief hit, not of the slab plane: land between the plane and a far hit stays in front
      { vec4 cp = projectionMatrix * viewMatrix * vec4(hp, 1.); gl_FragDepthEXT = clamp(cp.z / cp.w * .5 + .5, 0., 1.); }
      #ifdef USE_FOG
        vec3 fw = hp - ro; float fogDist = length(fw);
        float hH = hzD.w; float fe = fw.y / hH; float fInt = abs(fe) > 1e-3 ? (1. - exp(-fe)) / fe : 1. - fe * .5;
        float tA = fogDensity * .55 * fogDist * (exp(-max(hzP.y - hzE.x, -40.) / hH) * fInt + hzE.y);
        vec3 fHor = mix(fogColor, hzC.rgb, pow(max(dot(fw / max(fogDist, 1.), hzD.xyz), 0.), hzC.w));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(hzA.rgb, hzB.rgb, .9), (1. - exp(-tA)) * .25);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fHor, max(1. - exp(-tA * hzB.w), smoothstep(hzE.z, hzE.w, fogDist)));
        gl_FragColor.a *= v5MistT(ro, fw / max(fogDist, 1e-3), fogDist);
      #endif
      #include <encodings_fragment>
    }`;
  let seaMesh = null;
  function buildSea() {
    const R = Q.far * .85;
    // polar disc, rings denser near the centre
    const rings = 64, segs = 96, pos = [0, 0, 0], idx = [];
    for (let i = 1; i <= rings; i++) { const rr = R * Math.pow(i / rings, 2.2); for (let j = 0; j < segs; j++) { const a = j / segs * TAU; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); } }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + (j + 1) % segs, 1 + j);
    for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) { const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + (j + 1) % segs, c = 1 + i * segs + j, d = 1 + i * segs + (j + 1) % segs; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), vertexShader: SEA_VS, fragmentShader: SEA_FS, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, extensions: { fragDepth: true } });
    for (const k in seaU) mat.uniforms[k] = seaU[k];
    seaMesh = new THREE.Mesh(g, mat); seaMesh.frustumCulled = false; seaMesh.renderOrder = L.RO.sea; seaMesh.name = 'cloudsea'; L.scene.add(seaMesh);
  }
  // density map: 0..1 texture over a square; 1 = thick cloud (cliff bases), 0 = clear (open ocean holes)
  const seaClumps = new Map(); let densFn = null, clumpR = 3200;
  L.cloudSea = {
    get mesh() { return seaMesh; },
    setY(y) { L.CLOUD_Y = y; seaU.uSeaY.value = y; },
    setCoverage(c) { seaU.uCov.value = c; },
    // tex: R channel 0..255 over the square [x0, x0+size] x [z0, z0+size] (rows = +z). A DataTexture also drives the
    // near cloud islands (CPU lookup of the same data), so WORLD's baked mask is enough on its own.
    setDensityMap(tex, x0, z0, size) {
      seaU.tDens.value = tex; seaU.uDensXf.value.set(x0, z0, 1 / size, tex ? 1 : 0);
      const im = tex && tex.image;
      if (im && im.data && im.width) {
        const data = im.data, W = im.width, H = im.height || W, st = data.length / (W * H) | 0;
        densFn = (x, z) => { const i = clamp(Math.floor((x - x0) / size * W), 0, W - 1), j = clamp(Math.floor((z - z0) / size * H), 0, H - 1); return data[(j * W + i) * st] / 255; };
        for (const [k, cl] of seaClumps) if (FB) for (const c of cl) FB.remove(c); seaClumps.clear(); lastCI = lastCJ = 1e9;
      }
    },
    // bake a density texture from a height function: thick where land meets the cloud layer, holes far from land
    densityFromHeight(hfn, x0, z0, size, res, mod) {   // mod(x, z, v) -> v: optional art-directed override
      res = res || 256; const N = res, cy = L.CLOUD_Y; const land = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = x0 + (i + .5) / N * size, z = z0 + (j + .5) / N * size; const h = hfn(x, z); land[j * N + i] = h > cy - 30 ? 1 : 0; }
      // distance to land (two-pass chamfer), in cells
      const D = new Float32Array(N * N); for (let k = 0; k < N * N; k++) D[k] = land[k] ? 0 : 1e9;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; if (i > 0) D[k] = Math.min(D[k], D[k - 1] + 1); if (j > 0) D[k] = Math.min(D[k], D[k - N] + 1); if (i > 0 && j > 0) D[k] = Math.min(D[k], D[k - N - 1] + 1.414); if (i < N - 1 && j > 0) D[k] = Math.min(D[k], D[k - N + 1] + 1.414); }
      for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) { const k = j * N + i; if (i < N - 1) D[k] = Math.min(D[k], D[k + 1] + 1); if (j < N - 1) D[k] = Math.min(D[k], D[k + N] + 1); if (i < N - 1 && j < N - 1) D[k] = Math.min(D[k], D[k + N + 1] + 1.414); if (i > 0 && j < N - 1) D[k] = Math.min(D[k], D[k + N - 1] + 1.414); }
      const cell = size / N; const data = new Uint8Array(N * N * 4);
      for (let k = 0; k < N * N; k++) { const dm = D[k] * cell; let v = land[k] ? .85 : clamp(.95 - sstep(60, 1500, dm) * .75, 0, 1); if (mod) v = clamp(mod(x0 + ((k % N) + .5) / N * size, z0 + (Math.floor(k / N) + .5) / N * size, v, dm), 0, 1); data[k * 4] = v * 255; data[k * 4 + 1] = data[k * 4 + 2] = 0; data[k * 4 + 3] = 255; }
      const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      this.setDensityMap(t, x0, z0, size); this._dens = { data, N, x0, z0, size, hfn };
      densFn = (x, z) => { const u = (x - x0) / size * N - .5, v = (z - z0) / size * N - .5; const i = clamp(Math.round(u), 0, N - 1), j = clamp(Math.round(v), 0, N - 1); return data[(j * N + i) * 4] / 255; };
      for (const [k, cl] of seaClumps) if (FB) for (const c of cl) FB.remove(c); seaClumps.clear(); lastCI = lastCJ = 1e9;
      return t;
    },
    // custom density function for clump placement (if no map was baked)
    setClumpDensity(fn) { densFn = fn; },
    clumpRadius(r) { clumpR = r; },
  };
  // Cloud-sea islands: flattened puff clusters ("pancakes") in 500 m tiles around the camera, placed where the same
  // coverage field as the far raymarched layer says there is cloud. Deterministic per tile; fewer, bigger islands far.
  const CT = 500; let lastCI = 1e9, lastCJ = 1e9;
  // CPU twin of seaH()'s coverage term. now = true: the field as drawn this frame (it sways with seaDrift); false: in the
  // islands' own frame (an island placed at X is drawn at X + seaDrift, over the same coverage)
  function islandCov(x, z, now) {
    const d = densFn ? densFn(x, z) : .5, u = (now ? x - seaDrift.x : x) / 3000, v = (now ? z - seaDrift.y : z) / 3000;
    return d * 1.3 - .65 + (L.noise2(u, v, 0) - .5) * .8 + (L.noise2(u, v, 3) - .5) * .45 + (seaU.uCov.value - .5);
  }
  L.cloudSea.coverageAt = (x, z) => islandCov(x, z, true);   // > 0 where the cloud sea has cloud
  function updateClumps(cam) {
    if (!densFn) return;
    const px = cam.position.x, pz = cam.position.z;
    const ci = Math.floor(px / CT), cj = Math.floor(pz / CT); if (ci === lastCI && cj === lastCJ) return; lastCI = ci; lastCJ = cj;
    const R = Math.ceil(clumpR / CT); const want = new Set(); const dd = L.cloudSea._dens; const hfn = dd && dd.hfn || L.ground;
    const base0 = L.CLOUD_Y - seaU.uSlab.value.x * .55;
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      const cx = (i + .5) * CT, cz = (j + .5) * CT, D = Math.hypot(cx - px, cz - pz); if (D > clumpR + CT * .7) continue;
      const lod = D < 1500 ? 0 : 1, tk = i + ',' + j + ',' + lod; want.add(tk); if (seaClumps.has(tk)) continue;
      const list = []; const g = lod ? 2 : 4, cs = CT / g;
      for (let b = 0; b < g; b++) for (let a = 0; a < g; a++) {
        const k = b * g + a, x = i * CT + (a + .15 + h2(i, j, k * 5 + lod) * .7) * cs, z = j * CT + (b + .15 + h2(i, j, k * 5 + 1 + lod) * .7) * cs;
        const c = islandCov(x, z, false); if (c < .0 || h2(i, j, k * 5 + 2) > sstep(.0, .14, c) * .9) continue;
        let w = (lod ? 300 + h2(i, j, k + 50) * 260 : 120 + h2(i, j, k + 50) * 170) * (.75 + .5 * sstep(0, .3, c)); const hh = w * (.11 + h2(i, j, k + 60) * .08);
        const by = base0 + h2(i, j, k + 70) * 12;
        if (hfn && hfn(x, z) > by + hh * .4) continue;   // not inside land
        list.push(L.clouds.addClump(x, by, z, w, hh, i * 7919 + j * 104729 + k, 3, lod ? .22 : .38));
      }
      seaClumps.set(tk, list);
    }
    for (const [k, list] of seaClumps) if (!want.has(k)) { for (const cl of list) FB.remove(cl); seaClumps.delete(k); }
  }

  // ================================================================ the Névoa (mist) visual
  // Heights are ABOVE THE LOCAL GROUND: the mass rises from the lowest ground around the disc (base) to base + height,
  // and every puff starts on the ground under it. Call setDisc after the world heights (L.ground) are available.
  let mist = null;
  L.mistVisual = {
    // opts: {height = 900 (m above the ground at the centre), base (absolute y; default: lowest of L.ground at the centre
    //        and on a ring at .9 r), top (absolute y, honoured only when >= base + 200), seed, ground (height fn, default L.ground)}
    setDisc(x, z, r, opts) {
      opts = opts || {}; ensureFields();
      const gh = opts.ground || L.ground;
      const gAt = (px, pz) => { const h = gh ? +gh(px, pz) : NaN; return isFinite(h) ? h : null; };
      let base = opts.base;
      if (base == null || !isFinite(base)) {
        base = gAt(x, z); for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, h = gAt(x + Math.cos(a) * r * .9, z + Math.sin(a) * r * .9); if (h != null) base = base == null ? h : Math.min(base, h); }
        if (base == null) base = 0;
      }
      const height = opts.height || 900, gc = gAt(x, z);
      const top = opts.top != null && isFinite(opts.top) && opts.top >= base + 200 ? opts.top : Math.max(gc != null ? gc : base, base) + Math.max(height, 200);
      if (mist) { for (const cl of mist.cls) FM.remove(cl); }
      mist = { x, z, r, top, base, amount: 0, path: null, cls: [] };
      L.HZ.M[0] = x; L.HZ.M[1] = z; L.HZ.M[2] = r; L.HZ.M[3] = top; L.HZ.Q[0] = base - 150;
      const rr = rnd(opts.seed || 9); const nP = Math.round(520 * Q.mistPuffs), H = top - base;
      // several clusters around the ring so the churn reads as slow, separate motions
      const nC = 10; for (let c = 0; c < nC; c++) {
        const a0 = c / nC * TAU; const P = [];
        // most puffs on the outer wall, stratified in angle and height (no see-through holes), the rest inside / on top
        const per = Math.round(nP / nC), nOut = Math.round(per * .62);
        for (let i = 0; i < per; i++) {
          const outer = i < nOut;
          const a = outer ? a0 + ((i + rr()) / nOut - .5) * TAU / nC * 1.1 : a0 + (rr() - .5) * TAU / nC * 1.2;
          const rad = r * (outer ? (.82 + rr() * .3) : Math.sqrt(rr()) * .9);
          const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
          const hdome = base + H * (1 - Math.pow(rad / (r * 1.12), 2.6) * .45);
          const g0 = Math.min(gAt(px, pz) != null ? gAt(px, pz) : base, hdome - 120);
          const hu = outer ? (i * .618034 + c * .37 + rr() * .18) % 1 : rr();
          const y = g0 + Math.pow(hu, .75) * (hdome - g0);
          const s = (160 + rr() * 220 + (y > base + H * .8 ? 60 : 0)) * clamp(Math.sqrt(r / 1250), .7, 1.2);   // the puff wall keeps its coverage on smaller or larger discs (the map has r 1250)
          P.push([px, y, pz, s, 0, 0, rr()]);
        }
        const cl = { puffs: P, cx: x, cy: base + H * .5, cz: z, flag: 2, style: 2, R: r * 1.1, base: base - 160, top, soft: 40, tilt: TAU };
        shadeCluster(cl, L.TOD.lightDir.x, L.TOD.lightDir.y, L.TOD.lightDir.z);
        mist.cls.push(FM.add(cl));
      }
      if (!lights) makeCorridorLights();
      this.open(0, null);
    },
    // open a lit corridor: amount 0..1, pathPts [[x,z],...] from the edge to the centre (fades only the puffs' alpha)
    open(amount, pathPts) {
      if (!mist) return; mist.amount = clamp(amount || 0, 0, 1);
      if (pathPts && pathPts !== mist.path) { mist.path = pathPts; fillCorridorLights(); }
      const W = 50 + mist.amount * 120;
      for (const cl of mist.cls) { for (const p of cl.puffs) {
        let f = 1;
        if (mist.path && mist.amount > 0) { const d = distPath(p[0], p[2], mist.path); f = 1 - mist.amount * (1 - sstep(W * .6, W + p[3], d)); if (mist.amount >= 1) f *= .15; }
        p[7] = f;
      } FM.writeFade(cl); }
      if (lights) { lights.visible = mist.amount > 0 && !!mist.path; lights.material.opacity = mist.amount * .9; }
    },
    get state() { return mist; },
  };
  function distPath(x, z, P) {
    let best = 1e9;
    for (let i = 0; i < P.length - 1; i++) { const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1]; const dx = bx - ax, dz = bz - az; const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); }
    return best;
  }
  // golden motes along the corridor (one Points draw; the material exists from setDisc on, so it can be precompiled)
  let lights = null;
  function makeCorridorLights() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1e4, 0], 3));
    const m = L.mistFade(new THREE.PointsMaterial({ map: L.GLOW, size: 1.6, color: 0xffd98a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    lights = new THREE.Points(g, m); lights.renderOrder = L.RO.sprites; lights.frustumCulled = false; lights.visible = false; L.scene.add(lights);
  }
  function fillCorridorLights() {
    if (!lights || !mist.path) return;
    const P = mist.path; const pts = []; const r = rnd(3);
    for (let i = 0; i < P.length - 1; i++) { const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1]; const L2 = Math.hypot(bx - ax, bz - az); for (let s = 0; s < L2; s += 6) { const t = s / L2; const x = lerp(ax, bx, t) + (r() - .5) * 30, z = lerp(az, bz, t) + (r() - .5) * 30; const gy = L.ground ? L.ground(x, z) : 0; pts.push(x, gy + 1 + r() * 9, z); } }
    lights.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); lights.geometry = g;
  }

  // ================================================================ rain (light drizzle streaks in a box around the camera)
  let rain = null;
  function buildRain() {
    const n = Q.rainDrops; const pos = new Float32Array(n * 4 * 3), cor = new Float32Array(n * 4 * 2), idx = new (n * 4 < 65536 ? Uint16Array : Uint32Array)(n * 6); const r = rnd(12);
    for (let i = 0; i < n; i++) { const x = r() * 40 - 20, y = r() * 24, z = r() * 40 - 20; for (let k = 0; k < 4; k++) { pos.set([x, y, z], (i * 4 + k) * 3); } cor.set([-1, 0, 1, 0, 1, 1, -1, 1], i * 8); idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aC', new THREE.BufferAttribute(cor, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uT: L.uTime, uA: { value: 0 }, uCol: { value: new THREE.Color(.8, .85, .95) } },
      vertexShader: `attribute vec2 aC; uniform float uT; varying float vA; varying float vX;
        void main(){ vec3 p = position; p.y = mod(p.y - uT * 9. , 24.) - 8.; p.x = mod(p.x + uT * 1.2 - cameraPosition.x + 20., 40.) - 20.; p.z = mod(p.z - cameraPosition.z + 20., 40.) - 20.;
          vec3 w = cameraPosition + p; vec3 dir = normalize(vec3(.12, -1., 0.)); vec4 a = viewMatrix * vec4(w, 1.);
          vec4 b = viewMatrix * vec4(w + dir * mix(.22, .75, smoothstep(1.5, 6., length(p))), 1.);   // short streaks close to the camera
          vec2 sd = normalize(b.xy - a.xy + 1e-5); vec2 nn = vec2(-sd.y, sd.x); vec4 mv = mix(a, b, aC.y); mv.xy += nn * aC.x * .014;
          gl_Position = projectionMatrix * mv; vA = smoothstep(1., 4., -mv.z) * (1. - smoothstep(18., 22., length(p.xz))); vX = aC.x; }`,
      fragmentShader: `uniform float uA; uniform vec3 uCol; varying float vA; varying float vX; void main(){ gl_FragColor = vec4(uCol, uA * vA * (1. - abs(vX)) * .32);
#include <encodings_fragment>
}` });
    rain = new THREE.Mesh(g, m); rain.frustumCulled = false; rain.renderOrder = L.RO.rain; rain.visible = false; L.scene.add(rain);
  }

  // ================================================================ init + time of day + tick
  L.skyInit = function (opts) {
    L.makeSky(); L.buildClouds(opts && opts.clouds); if (!seaMesh) buildSea(); if (!rain) buildRain();
  };
  // compile the programs that are hidden at boot (rain, corridor motes, cloud fields) so their first use does not hitch
  L.lookPrecompile = function (cam) {
    const hidden = []; L.scene.traverse(o => { if (!o.visible && (o === rain || o === lights || (o.isPoints || o.isMesh) && o.material && o.material.transparent)) { hidden.push(o); o.visible = true; } });
    try { L.renderer.compile(L.scene, cam || L.camera); } finally { for (const o of hidden) o.visible = false; }
  };
  const _v = new THREE.Vector3();
  L.onTimeOfDay(T => {
    skyU.top.value.copy(T.zen); skyU.mid.value.copy(T.mid); skyU.hor.value.copy(T.hor); skyU.low.value.copy(T.low);
    skyU.sunDir.value.copy(T.sunDir); skyU.moonDir.value.copy(T.moonDir); skyU.night.value = T.night; skyU.dusk.value = T.dusk; skyU.rain.value = T.rain; skyU.moonPh.value = T.moonPhase;
    skyU.sunCol.value.copy(T.sunCol).multiplyScalar(1 - T.night);
    skyU.cloudCol.value.copy(T.cLit); skyU.cloudShade.value.copy(T.cShade);
    cloudU.uLit.value.copy(T.cLit); cloudU.uBody.value.copy(T.cBody); cloudU.uShade.value.copy(T.cShade); cloudU.uDeep.value.copy(T.cDeep);
    cloudU.uSunCol.value.copy(T.sunCol).multiplyScalar((1 - T.night) * (1 - T.rain * .8));
    cloudU.uSunW.value.copy(T.lightDir); cloudU.uNight.value = T.night;
    if (L.stars) L.stars.material.uniforms.uA.value = T.night * (1 - T.rain) * .95;
    if (rain) { rain.visible = T.rain > .02; rain.material.uniforms.uA.value = T.rain; rain.material.uniforms.uCol.value.copy(T.hor).lerp(_c.setRGB(1, 1, 1), .65); }
    seaU.uCov.value = .5 + T.rain * .12;
    // re-shade clusters when the light moved enough (spread over the next frames, see the tick)
    const ld = T.lightDir; if (!lastShade) lastShade = new THREE.Vector3(9, 9, 9);
    if (lastShade.distanceTo(ld) > .08) { lastShade.copy(ld); queueReshade(); }
  });
  const _c = new THREE.Color(); let lastShade = null;
  // Amortised re-shading: the sun-occlusion of every cluster is recomputed a few clusters per frame (about 1 ms) and
  // only that cluster's slice of the occlusion attribute is uploaded. A light change costs no single-frame spike.
  const RQ = []; let rqi = 0;
  function queueReshade() { if (!FA) return; RQ.length = 0; rqi = 0; for (const F of FIELDS) for (const cl of F.clusters) RQ.push(F, cl); }
  function runReshade(budgetMs) {
    if (rqi >= RQ.length) return;
    const t0 = performance.now(), s = cloudU.uSunW.value;
    while (rqi < RQ.length) { const F = RQ[rqi], cl = RQ[rqi + 1]; rqi += 2; if (cl._o !== undefined) { shadeCluster(cl, s.x, s.y, s.z); F.writeOcc(cl); } if (performance.now() - t0 > budgetMs) break; }
    if (rqi >= RQ.length) { RQ.length = 0; rqi = 0; }
  }
  L.cloudStats = () => ({ sky: [FA ? FA.n : 0, FA ? FA.req : 0, FA ? FA.cap : 0], low: [FB ? FB.n : 0, FB ? FB.req : 0, FB ? FB.cap : 0], mist: [FM ? FM.n : 0, FM ? FM.req : 0, FM ? FM.cap : 0], reshadeLeft: (RQ.length - rqi) / 2 });
  let sortFrame = 0;
  L.onLookTick((dt, t, cam) => {
    if (L.sky) { L.sky.position.copy(cam.position); L.stars.position.copy(cam.position); }
    if (!L.TOD.set && L.skyU) { // v4 day cycle drives skyU.top/hor: derive the rest
      skyU.mid.value.copy(skyU.hor.value).lerp(skyU.top.value, .45); skyU.low.value.copy(skyU.hor.value).lerp(_c.setRGB(1, 1, 1), .35 * (1 - skyU.night.value));
      cloudU.uSunW.value.copy(skyU.sunDir.value); if (cloudU.uSunW.value.y < .05) cloudU.uSunW.value.y = .05; cloudU.uSunW.value.normalize();
    }
    seaDriftAt(t, seaDrift);
    if (!FA) return;
    cam.updateMatrixWorld(); _v.copy(cloudU.uSunW.value).transformDirection(cam.matrixWorldInverse); cloudU.uSunV.value.copy(_v);
    _v.set(0, 1, 0).transformDirection(cam.matrixWorldInverse); cloudU.uUpV.value.copy(_v);
    updateClumps(cam);
    const cx = cam.position.x, cz = cam.position.z;
    for (let i = 0; i < FIELDS.length; i++) {
      const F = FIELDS[i];
      if (!F.dirty && F.req > F.cap && Math.abs(cx - F.rx) + Math.abs(cz - F.rz) > 400) F.dirty = true;   // re-rank an over-full field
      if (F.dirty) F.rebuild(cam);
    }
    runReshade(1.0);
    for (let i = 0; i < FIELDS.length; i++) FIELDS[i].flush();
    // corridor visibility: inside an opened corridor the mist thins
    if (mist) { const inside = Math.hypot(cx - mist.x, cz - mist.z) < mist.r; let vis = 55; if (mist.path && mist.amount > 0) { const d = distPath(cx, cz, mist.path); vis = lerp(55, 260 + 900 * mist.amount * mist.amount, mist.amount * (1 - sstep(40, 160, d))); } if (mist.amount >= 1) vis = 1e5; L.HZ.N[3] = inside ? vis : Math.max(vis, 70); }
    if ((sortFrame++ % 6) === 0) { for (let i = 0; i < FIELDS.length; i++) FIELDS[i].sort(cam, t); }
  });
  // v4 compatibility: the v4 game calls L.tickClouds(cam, t) once per frame and never L.lookTick
  let lastTick = -1;
  L.tickClouds = function (cam, t) { if (L._lookFrame === L.renderer.info.render.frame) return; L.lookTick(lastTick < 0 ? .016 : Math.min(.1, t - lastTick), t, cam); lastTick = t; };
})(window.L);
