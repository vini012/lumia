/* Lumiar v5 terrain look: L.makeTerrainMaterial (WORLD attribute contract: color, aT, aU), L.makeWaterMaterial,
   L.makeFlowMaterial (waterfalls), rock and bark materials. All stylized (L.stylize) and hazed (global fog chunk). */
'use strict';
(function (L) {
  const { clamp, C } = L;
  const TAU = Math.PI * 2;
  const v3 = h => { const c = C(h); return new THREE.Vector3(c.r, c.g, c.b); };

  // ================================================================ shared terrain look parameters
  // Colours are sRGB from the GDD palette; WORLD paints `color` as the *lit* ground colour it wants to see,
  // uAlbedo scales it into albedo so a sunlit flat meadow lands on that colour after lighting + tone curve.
  const TU = L.terrainU = {
    tNoise: { value: L.noiseTex },
    uAlbedo: { value: .74 },
    uPatch: { value: .85 },                         // strength of the palette patches (landscape slide)
    uPal: { value: [v3(0xa9b950), v3(0xbcc361), v3(0x59784a), v3(0xd8cf55), v3(0xbdb544), v3(0x9a9132), v3(0x8b9551)] },
    uPalMean: { value: v3(0xaab052) },
    uRockA: { value: v3(0x95928b) }, uRockB: { value: v3(0xa59f92) }, uRockC: { value: v3(0x6f6a62) },
    uPathA: { value: v3(0xebda8d) }, uPathB: { value: v3(0xc4b559) }, uPathC: { value: v3(0xa88f5a) },
    uSand: { value: v3(0xead9a3) }, uSandWet: { value: v3(0xb9a77c) }, uSnow: { value: v3(0xf2f5fa) },
    uForest: { value: v3(0x4a6b3a) }, uMoss: { value: v3(0x5f7d35) },
    uStrata: { value: new THREE.Vector4(46, .55, 13, .35) },  // band height (m), band contrast, fine band height, fine contrast
    uDetail: { value: new THREE.Vector3(1, 45, .22) },          // enabled, near-detail fade distance (m), strength
  };

  // GLSL: palette + layers. Expects vWp (world pos), vWn (world normal), vT (aT), vU (aU), vCol (ground tint).
  const TERRAIN_FN = `
uniform sampler2D tNoise; uniform float uAlbedo, uPatch; uniform vec3 uPal[7]; uniform vec3 uPalMean;
uniform vec3 uRockA, uRockB, uRockC, uPathA, uPathB, uPathC, uSand, uSandWet, uSnow, uForest, uMoss; uniform vec4 uStrata; uniform vec3 uDetail;
vec3 v5Meadow(vec3 base, vec4 n1, vec4 n2) {
  vec3 palA = mix(uPal[2], uPal[0], smoothstep(.2, .62, n1.g)); palA = mix(palA, uPal[1], smoothstep(.5, .85, n2.r));
  vec3 palB = mix(uPal[6], uPal[3], smoothstep(.25, .7, n1.g)); palB = mix(palB, uPal[4], smoothstep(.45, .8, n2.r)); palB = mix(palB, uPal[5], smoothstep(.62, .9, n2.g) * .6);
  vec3 pal = mix(palA, palB, smoothstep(.36, .64, n1.r));
  return mix(base, base * pal / uPalMean, uPatch);
}
vec3 v5Rock(vec3 wp, vec3 wn, vec4 n1, out float crack) {
  vec3 an = abs(wn); float wx = an.x / (an.x + an.z + 1e-4);
  vec4 rx = texture2D(tNoise, vec2(wp.z, wp.y * .45) / 95.), rz = texture2D(tNoise, vec2(wp.x, wp.y * .45) / 95.);
  vec4 rn = mix(rz, rx, wx);
  crack = smoothstep(.16, .02, rn.b) * (.6 + .4 * rn.g);
  float warp = n1.r * 1.3 + rn.r * .35;
  float band = texture2D(tNoise, vec2(wp.y / uStrata.x + warp, .37)).g;
  float fine = texture2D(tNoise, vec2(wp.y / uStrata.z + warp * 2.1, .71)).a;
  vec3 r = mix(uRockA, uRockB, smoothstep(.3, .7, band));
  r = mix(r, uRockC, smoothstep(.55, .9, band) * uStrata.y * .6);
  r *= 1. + (fine - .5) * uStrata.w;
  r *= .88 + rn.r * .26;
  r *= 1. - crack * .45;
  float ledge = smoothstep(.75, 1., wn.y) * .12; r += ledge;   // ledges catch light
  return r;
}
`;

  // ================================================================ terrain material
  // opts: {albedo, patch, flatShading:false}
  L.makeTerrainMaterial = function (opts) {
    opts = opts || {};
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true });
    mat.onBeforeCompile = sh => {
      for (const k in TU) sh.uniforms[k] = TU[k];
      sh.vertexShader = 'attribute vec4 aT; attribute vec2 aU; varying vec4 vT; varying vec2 vU; varying vec3 vWp; varying vec3 vWn;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vT = aT; vU = aU; vWp = (modelMatrix * vec4(position, 1.)).xyz; vWn = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = 'varying vec4 vT; varying vec2 vU; varying vec3 vWp; varying vec3 vWn;\n' + TERRAIN_FN + sh.fragmentShader
        .replace('#include <color_fragment>', `
          vec3 vCol = vColor * uAlbedo;
          float camd = length(vWp - cameraPosition);
          vec3 wn = normalize(vWn);
          vec4 n1 = texture2D(tNoise, vWp.xz / 900.);
          vec4 n2 = texture2D(tNoise, vWp.xz / 140. + .5);
          // meadow with palette patches + soft grass detail near the camera
          vec3 g = v5Meadow(vCol, n1, n2);
          float near = (1. - smoothstep(uDetail.y * .4, uDetail.y, camd)) * uDetail.x;
          if (near > 0.) { vec4 nd = texture2D(tNoise, vWp.xz / 7.); g *= 1. + ((nd.a - .5) * .9 + (nd.g - .5) * .5) * uDetail.z * near; }
          g *= 1. + (n2.a - .5) * .12;
          // forest floor + wet/moss
          g = mix(g, g * uForest / max(uPalMean, vec3(.05)) * .8, clamp(vU.x, 0., 1.) * .8);
          g = mix(g, mix(g * .72, uMoss * uAlbedo, .35), clamp(vU.y, 0., 1.) * .7);
          // dirt path (noisy edges, lighter middle)
          float pth = smoothstep(.32, .62, vT.y + (n2.a - .5) * .3 + (n2.g - .5) * .12);
          vec3 pc = mix(uPathC, uPathB, smoothstep(.3, .6, n2.g)); pc = mix(pc, uPathA, smoothstep(.55, .95, vT.y) * (.55 + .45 * n2.a));
          g = mix(g, pc * uAlbedo, pth);
          // sand / beach
          float snd = smoothstep(.3, .6, vT.z + (n2.a - .5) * .2);
          g = mix(g, mix(uSandWet, uSand, smoothstep(.4, .9, vT.z)) * uAlbedo * (.92 + n2.r * .16), snd);
          // stratified rock
          float crack;
          float rk = smoothstep(.28, .62, vT.x + (n2.r - .5) * .22);
          if (rk > .001) { vec3 rc = v5Rock(vWp, wn, n1, crack) * uAlbedo; g = mix(g, rc * mix(vec3(1.), vCol / max(dot(vCol, vec3(.333)), .05) * .33 + .67, .25), rk); }
          // modest snow caps (white on top only; the blue comes from the light)
          float sn = smoothstep(.4, .7, vT.w + (n1.g - .5) * .3) * smoothstep(.35, .75, wn.y + .2);
          g = mix(g, uSnow * uAlbedo * 1.12, sn);
          diffuseColor.rgb = g;`);
      mat.userData.shader = sh;
    };
    mat.customProgramCacheKey = () => 'terrain-v5';
    L.stylize(mat, { wrap: opts.wrap != null ? opts.wrap : .3, rim: opts.rim != null ? opts.rim : .12 });
    return mat;
  };

  // ================================================================ rock + bark (props, scatter)
  L.makeRockMaterial = function (opts) {
    opts = opts || {};
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true, color: opts.color != null ? opts.color : 0xffffff });
    mat.onBeforeCompile = sh => {
      for (const k in TU) sh.uniforms[k] = TU[k];
      sh.vertexShader = 'varying vec3 vWp; varying vec3 vWn;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWp = (modelMatrix * instanceMatrix * vec4(position, 1.)).xyz; vWn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vWp = (modelMatrix * vec4(position, 1.)).xyz; vWn = normalize(mat3(modelMatrix) * normal);
        #endif`);
      sh.fragmentShader = 'varying vec3 vWp; varying vec3 vWn;\n' + TERRAIN_FN + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        { float crack; vec4 n1 = texture2D(tNoise, vWp.xz / 900.); vec3 rc = v5Rock(vWp * 3., normalize(vWn), n1, crack);
          float lum = dot(diffuseColor.rgb, vec3(.333)); diffuseColor.rgb = mix(diffuseColor.rgb, rc * uAlbedo * clamp(lum * 1.6, .55, 1.25), .75);
          diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * uAlbedo * .8, smoothstep(.7, .95, normalize(vWn).y) * .45); }`);
    };
    mat.customProgramCacheKey = () => 'rock-v5';
    return L.stylize(mat, { wrap: .3, rim: .2 });
  };
  L.makeBarkMaterial = function () {
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true });
    mat.onBeforeCompile = sh => {
      sh.uniforms.tNoise = TU.tNoise;
      sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWp = (instanceMatrix * vec4(position, 1.)).xyz - instanceMatrix[3].xyz;
        #else
          vWp = position;
        #endif`);
      sh.fragmentShader = 'uniform sampler2D tNoise; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        { float a = atan(vWp.z, vWp.x); vec4 n = texture2D(tNoise, vec2(a * .32, vWp.y * .09));
          vec3 bark = mix(vec3(.23, .14, .085), vec3(.42, .29, .19), smoothstep(.25, .75, n.g));
          bark *= 1. - smoothstep(.12, .02, n.b) * .35;
          diffuseColor.rgb = mix(bark, diffuseColor.rgb * bark * 2.2, .25); }`);
    };
    mat.customProgramCacheKey = () => 'bark-v5';
    return L.stylize(mat, { wrap: .4, rim: .25 });
  };

  // ================================================================ water
  // Procedural tileable normal map (sum of integer-frequency waves): RG normal xy, B height.
  L.waterNormTex = (function () {
    const N = 128, d = new Uint8Array(N * N * 4); const W = [];
    let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 14; i++) { const kx = Math.round((r() - .5) * 12), ky = Math.round((r() - .5) * 12) || 1; const amp = 1 / Math.hypot(kx, ky); W.push([kx, ky, amp * (.6 + r() * .4), r() * TAU]); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let h = 0, dx = 0, dy = 0; const u = x / N * TAU, v = y / N * TAU;
      for (const [kx, ky, a, p] of W) { const ph = kx * u + ky * v + p; h += a * Math.sin(ph); dx += a * kx * Math.cos(ph); dy += a * ky * Math.cos(ph); }
      const o = (y * N + x) * 4; const nl = Math.hypot(dx * .08, dy * .08, 1);
      d[o] = clamp((-dx * .08 / nl) * .5 + .5, 0, 1) * 255; d[o + 1] = clamp((-dy * .08 / nl) * .5 + .5, 0, 1) * 255; d[o + 2] = clamp(h * .18 + .5, 0, 1) * 255; d[o + 3] = 255;
    }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
  })();
  const WU = L.waterU5 = {
    uTime: L.uTime, tN: { value: L.waterNormTex }, tNoise: { value: L.noiseTex },
    uShallow: { value: C(0x63b2d4) }, uDeep: { value: C(0x2a7fc4) }, uSky: { value: C(0x9cc6ec) }, uSkyTop: { value: C(0x4b9fe6) },
    uSun: { value: C(0xfff1d8) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 }, uFoam: { value: C(0xf4f8fa) },
  };
  // opts: {depthAttr: true (geometry has aDepth = water depth in metres), depth: constant depth when no attribute,
  //        ocean: true (big open water: bigger waves, deeper colour)}
  L.makeWaterMaterial = function (opts) {
    opts = opts || {};
    const defines = {}; if (opts.depthAttr !== false) defines.USE_ADEPTH = ''; if (opts.ocean) defines.OCEAN = '';
    const mat = new THREE.ShaderMaterial({
      defines, transparent: true, fog: true, depthWrite: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uConstDepth: { value: opts.depth != null ? opts.depth : 6 } }]),
      vertexShader: `uniform float uTime, uConstDepth; varying float vD; varying vec3 vW;
        #ifdef USE_ADEPTH
          attribute float aDepth;
        #endif
        #include <fog_pars_vertex>
        void main(){
          #ifdef USE_ADEPTH
            float dep = aDepth;
          #else
            float dep = uConstDepth;
          #endif
          vec4 wp = modelMatrix * vec4(position, 1.); float k = clamp(dep, 0., 1.);
          wp.y += (sin(wp.x * .3 + uTime * 1.1) * .05 + sin(wp.z * .45 + uTime * 1.5) * .04) * k;
          vD = dep; vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime, uDay; uniform vec3 uShallow, uDeep, uSky, uSkyTop, uSun, uSunDir, uFoam; uniform sampler2D tN, tNoise; varying float vD; varying vec3 vW;
        #include <fog_pars_fragment>
        void main(){
          float camd = length(cameraPosition - vW); float calm = smoothstep(60., 900., camd);
          #ifdef OCEAN
            float sc = .012;
          #else
            float sc = .05;
          #endif
          vec4 a = texture2D(tN, vW.xz * sc + vec2(uTime * .011, uTime * .007));
          vec4 b = texture2D(tN, vW.xz * sc * 2.7 - vec2(uTime * .013, -uTime * .017));
          vec2 nxy = (a.xy + b.xy - 1.) * mix(1.2, .25, calm);
          vec3 n = normalize(vec3(nxy.x, 1., nxy.y));
          vec3 V = normalize(cameraPosition - vW);
          float fr = pow(1. - max(dot(n, V), 0.), 4.);
          float dep = clamp(vD / 9., 0., 1.);
          vec3 col = mix(uShallow, uDeep, smoothstep(0., 1., dep));
          col *= .85 + (a.z + b.z - 1.) * .18;
          vec3 R = reflect(-V, n); vec3 sky = mix(uSky, uSkyTop, clamp(R.y * 1.6, 0., 1.));
          col = mix(col, sky, fr * .55);
          vec3 Hh = normalize(V + normalize(uSunDir));
          float nh = max(dot(n, Hh), 0.);
          col += uSun * (pow(nh, 260.) * 3. + pow(nh, 30.) * .12) * uDay;
          // sparkles: tiny bright glints that ride the wave crests (bloom picks them up)
          float sp = smoothstep(.86, .97, a.z * b.z * 1.9) * smoothstep(.3, 1., dot(n, Hh) * 2. - 1.) * (1. - calm * .6) * uDay;
          col += uSun * sp * 1.6;
          // shore foam: depth-based band broken by noise, plus a soft white line at the very edge
          float fn = texture2D(tNoise, vW.xz * .06 + vec2(uTime * .02, 0.)).a;
          float foam = smoothstep(.45, .0, vD) * .9 + smoothstep(1.4, .2, vD) * smoothstep(.55, .7, fn + sin(vD * 6. - uTime * 1.6) * .1) * .6;
          col = mix(col, uFoam * mix(.35, 1., uDay), clamp(foam, 0., 1.));
          float alpha = clamp(mix(.55, .97, smoothstep(0., .6, dep)) + foam * .3 + fr * .2, 0., 1.);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
          #include <fog_fragment>
        }`
    });
    for (const k in WU) mat.uniforms[k] = WU[k];
    return mat;
  };

  // ================================================================ waterfalls (ribbons: uv.x across, uv.y along in metres; aSteep 0..1)
  const FU = L.flowU5 = { uTime: L.uTime, tNoise: { value: L.noiseTex }, uSky: WU.uSky, uDay: WU.uDay, uLit: { value: C(0xf2f8ff) }, uBlue: { value: C(0x9fd0ef) }, uDeepB: { value: C(0x5aa6d8) }, uSunDir: WU.uSunDir };
  L.makeFlowMaterial = function () {
    const mat = new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false, side: THREE.DoubleSide, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: `attribute float aSteep; varying vec2 vUv; varying float vS; varying vec3 vW; varying vec3 vN;
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vS = aSteep; vec4 wp = modelMatrix * vec4(position, 1.); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime, uDay; uniform sampler2D tNoise; uniform vec3 uSky, uLit, uBlue, uDeepB, uSunDir; varying vec2 vUv; varying float vS; varying vec3 vW; varying vec3 vN;
        #include <fog_pars_fragment>
        void main(){
          float sp = mix(.25, 1.6, vS);
          float s1 = texture2D(tNoise, vec2(vUv.x * 1.3, vUv.y * .018 - uTime * sp * .09)).g;
          float s2 = texture2D(tNoise, vec2(vUv.x * 3.1 + .3, vUv.y * .045 - uTime * sp * .2)).a;
          float streak = smoothstep(.35, .8, s1 * .6 + s2 * .55);
          float edge = smoothstep(0., .22, vUv.x) * smoothstep(1., .78, vUv.x);
          vec3 c = mix(uDeepB, uBlue, smoothstep(.0, .5, s1));
          c = mix(c, uLit, clamp(streak * (.6 + vS * .5) + vS * .35, 0., 1.));
          float lit = clamp(dot(normalize(vN), normalize(uSunDir)) * .35 + .75, .55, 1.1);
          c *= lit * mix(.25, 1., uDay);
          float a = edge * mix(.55, .92, max(streak, vS * .7)) * (.75 + s2 * .35);
          gl_FragColor = vec4(c, clamp(a, 0., 1.));
          #include <fog_fragment>
        }`
    });
    for (const k in FU) mat.uniforms[k] = FU[k];
    return mat;
  };
  // white mist where a waterfall hits the ground or the cloud sea (a few low cloud puffs)
  L.addFallMist = function (x, y, z, w) { if (!L.clouds) return null; return L.clouds.addClump(x, y - w * .15, z, w * 1.6, w * .7, Math.floor(x * 13 + z * 7), 3); };

  // ================================================================ time of day hook
  L.onTimeOfDay(T => {
    WU.uSky.value.copy(T.hor).lerp(T.low, .3); WU.uSkyTop.value.copy(T.mid);
    WU.uSun.value.copy(T.sunCol).multiplyScalar(T.day + T.dusk * .8 + T.night * .25); WU.uSunDir.value.copy(T.lightDir);
    WU.uDay.value = (.14 + T.day * .86 + T.dusk * .55) * (1 - T.rain * .35);
    WU.uShallow.value.copy(C(0x63b2d4)).multiplyScalar(.2 + .8 * (T.day + T.dusk * .7)).lerp(C(0x1a3a6a), T.night * .5);
    WU.uDeep.value.copy(C(0x2a7fc4)).multiplyScalar(.2 + .8 * (T.day + T.dusk * .7)).lerp(C(0x0b1d44), T.night * .6);
    WU.uFoam.value.copy(T.cLit);
  });
})(window.L);
