/* Lumiar v5 engine: renderer, quality tiers, stylized lighting (L.stylize), aerial perspective, grade,
   shared materials, model loader, particles, sprites, time of day. */
'use strict';
window.L = window.L || {};
(function (L) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const C = h => new THREE.Color(h).convertSRGBToLinear();
  L.clamp = clamp; L.lerp = lerp; L.sstep = sstep; L.C = C;
  L.uTime = L.uTime || { value: 0 };
  L.uPlayer = L.uPlayer || { value: new THREE.Vector3(0, -999, 0) };

  // ================================================================ quality tiers (fixed objects)
  L.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1400);
  L.quality = L.isMobile ? 'medio' : 'alto';
  try { let q = localStorage.getItem('lumiar:q'); if (q) { try { q = JSON.parse(q); } catch (e) { } if (['alto', 'medio', 'baixo'].includes(q)) L.quality = q; } } catch (e) { }
  // grass*: grass ring; *Mul: distance multipliers for other modules (scatter, terrain LOD, impostors)
  const TIERS = {
    alto: { name: 'alto', dpr: 2, shadow: 2048, shadowDist: 60, shadowTaps: 5, post: true, bloom: .6, fxaa: true, far: 12000,
      grassR: 52, grassSp: .5, grassFull: 18, grassBlades: 12, grassMaxTris: 260000, flowerMul: 1, grassMul: 1.3, scatterMul: 1.3, lodMul: 1.25, impostorMul: 1.25,
      cloudPuffs: 1, seaSteps: 5, mistPuffs: 1, rainDrops: 6000, pointLights: 6, lod: 130, grass: 3200 },
    medio: { name: 'medio', dpr: 1.5, shadow: 1536, shadowDist: 45, shadowTaps: 4, post: true, bloom: .4, fxaa: true, far: 12000,
      grassR: 36, grassSp: .58, grassFull: 13, grassBlades: 10, grassMaxTris: 120000, flowerMul: .8, grassMul: 1, scatterMul: 1, lodMul: 1, impostorMul: 1,
      cloudPuffs: .7, seaSteps: 4, mistPuffs: .7, rainDrops: 3500, pointLights: 4, lod: 95, grass: 1800 },
    baixo: { name: 'baixo', dpr: 1, shadow: 1024, shadowDist: 32, shadowTaps: 1, post: false, bloom: 0, fxaa: false, far: 10000,
      grassR: 22, grassSp: .7, grassFull: 8, grassBlades: 7, grassMaxTris: 45000, flowerMul: .5, grassMul: .6, scatterMul: .65, lodMul: .75, impostorMul: .75,
      cloudPuffs: .45, seaSteps: 0, mistPuffs: .45, rainDrops: 1500, pointLights: 2, lod: 70, grass: 800 },
  };
  for (const k in TIERS) Object.freeze(TIERS[k]);
  L.TIERS = TIERS;
  L.Q = () => TIERS[L.quality] || TIERS.medio;
  const Q0 = L.Q();

  // ================================================================ renderer
  const wrap = document.getElementById('game') || document.body;
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: !Q0.post, depth: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q0.dpr));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // filtering is our own 1..5 taps (v5Shadow), not three's 17
  renderer.autoClear = true;
  wrap.appendChild(renderer.domElement);
  L.renderer = renderer;
  // half-float colour buffer test (some phones cannot render to RGBA16F): without it we render direct (no post)
  function halfFloatOK() {
    try {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
      const old = renderer.getRenderTarget(); renderer.setRenderTarget(rt);
      const gl = renderer.getContext(); const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      renderer.setRenderTarget(old); rt.dispose(); return ok;
    } catch (e) { return false; }
  }
  const POST = Q0.post && halfFloatOK();
  L.postOn = POST;

  // ================================================================ shared "look" uniforms
  // Typed arrays survive THREE.UniformsUtils.clone by reference, so every program that receives these uniform
  // objects (built-in materials via ShaderLib, ShaderMaterials via UniformsLib.fog) reads the same live values.
  const v4 = () => new Float32Array(4);
  const HZ = { A: v4(), B: v4(), C: v4(), D: v4(), E: v4(), M: v4(), N: v4(), P: v4() }; L.HZ = HZ;
  // A: veil dark rgb, veil strength | B: veil light rgb, far-haze ratio | C: sun-side haze rgb, sun power
  // D: sun dir xyz, height scale (m) | E: base altitude, floor density, far fade start, far fade end
  // M: mist centre x, z, radius (0 = off), top | N: mist colour rgb, visibility length (m)
  // P: camera world position (three r128 only uploads cameraPosition to Standard/Phong/Toon/Shader materials)
  HZ.A.set([.025, .115, .31, .8]); HZ.B.set([.25, .6, .84, .38]); HZ.C.set([.78, .85, .9, 6]); HZ.D.set([0, 1, 0, 520]);
  HZ.E.set([60, .16, 9000, 11800]); HZ.M.set([0, 0, 0, 900]); HZ.N.set([.92, .94, .97, 60]);
  const hzUniforms = () => ({ hzA: { value: HZ.A }, hzB: { value: HZ.B }, hzC: { value: HZ.C }, hzD: { value: HZ.D }, hzE: { value: HZ.E }, hzM: { value: HZ.M }, hzN: { value: HZ.N }, hzP: { value: HZ.P } });
  L.hazeUniforms = hzUniforms;
  Object.assign(THREE.UniformsLib.fog, hzUniforms());
  for (const k in THREE.ShaderLib) { const S = THREE.ShaderLib[k]; if (S.uniforms && S.uniforms.fogColor) Object.assign(S.uniforms, hzUniforms()); }

  // ================================================================ aerial perspective (global fog chunk)
  // Two stages, both distance x height weighted: (1) a blue veil that keeps the value structure (shadowed cliffs
  // -> deep blue, lit ground -> light blue, like the paintings); (2) fade to the horizon colour, warmer toward the
  // sun. fogDensity keeps v4 units (.0006 = ~40% veil at 1 km). Plus the Névoa: the path length through the mist
  // cylinder whitens everything behind or inside it.
  const outSRGB = !POST; // direct-to-screen: the fog chunk runs after sRGB encoding, so convert around it
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogW;\n#endif\n';
  THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogW = vec3(dot(viewMatrix[0].xyz, mvPosition.xyz), dot(viewMatrix[1].xyz, mvPosition.xyz), dot(viewMatrix[2].xyz, mvPosition.xyz));\n#endif\n';
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
 uniform vec3 fogColor; varying vec3 vFogW;
 uniform vec4 hzA, hzB, hzC, hzD, hzE, hzM, hzN, hzP;
 #ifdef FOG_EXP2
  uniform float fogDensity;
 #else
  uniform float fogNear; uniform float fogFar;
 #endif
 float v5MistPath(vec3 ro, vec3 rd, float len) {
   if (hzM.z <= 0.) return 0.;
   vec2 o = ro.xz - hzM.xy; vec2 d = rd.xz * len;
   float a = max(dot(d, d), 1e-4), b = dot(o, d), c = dot(o, o) - hzM.z * hzM.z;
   float disc = b * b - a * c; if (disc <= 0.) return 0.;
   float s = sqrt(disc); float t0 = clamp((-b - s) / a, 0., 1.), t1 = clamp((-b + s) / a, 0., 1.);
   float dy = rd.y * len;
   if (abs(dy) > 1e-3) { float ty = (hzM.w - ro.y) / dy; if (dy > 0.) t1 = min(t1, ty); else t0 = max(t0, ty); }
   else if (ro.y > hzM.w) return 0.;
   return max(t1 - t0, 0.) * len;
 }
#endif
`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  float fogDist = length(vFogW);
  vec3 fogRd = vFogW / max(fogDist, 1e-3);
  vec3 fc = gl_FragColor.rgb;
  ${outSRGB ? 'fc = pow(max(fc, vec3(0.)), vec3(2.2));' : ''}
  #ifdef FOG_EXP2
    float hH = hzD.w; float fe = vFogW.y / hH;
    float fInt = abs(fe) > 1e-3 ? (1. - exp(-fe)) / fe : 1. - fe * .5;
    float fPath = fogDist * (exp(-max(hzP.y - hzE.x, -40.) / hH) * fInt + hzE.y);
    float tA = fogDensity * .55 * fPath;
    float fA = (1. - exp(-tA)) * hzA.w;
    float fogFactor = max(1. - exp(-tA * hzB.w), smoothstep(hzE.z, hzE.w, fogDist));
    float fLum = dot(fc, vec3(.2126, .7152, .0722));
    float fS = smoothstep(.0, .4, fLum);
    float fAd = (1. - exp(-tA * 2.5)) * hzA.w;
    fc = mix(fc, mix(hzA.rgb, hzB.rgb, fS), mix(fAd, fA * .5, fS));   // shade turns deep blue early; sunlit faces keep their colour longer
    vec3 fHor = mix(fogColor, hzC.rgb, pow(max(dot(fogRd, hzD.xyz), 0.), hzC.w));
    fc = mix(fc, fHor, fogFactor);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, fogDist);
    fc = mix(fc, fogColor, fogFactor);
  #endif
  float fMist = v5MistPath(hzP.xyz, fogRd, fogDist);
  fc = mix(fc, hzN.rgb, 1. - exp(-fMist / max(hzN.w, 1.)));
  ${outSRGB ? 'fc = pow(fc, vec3(1. / 2.2));' : ''}
  gl_FragColor.rgb = fc;
#endif
`;

  // ================================================================ tone curve + grade (per material, before haze)
  // Hue-preserving soft shoulder (no ACES desaturation), saturation boost, cool darks, warm highlights.
  const GRADE = L.GRADE = { knee: .62, mixPerChannel: .3, sat: 1.08, cool: [.9, .97, 1.1], warm: [1.04, 1.0, .95] };
  const f3 = a => `vec3(${a.map(v => v.toFixed(3)).join(',')})`;
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    `float v5Sh(float x) { const float K = ${GRADE.knee.toFixed(3)}; return x < K ? x : K + (1. - K) * (1. - exp(-(x - K) / (1. - K))); }
    vec3 CustomToneMapping( vec3 color ) {
      vec3 c = max(color * toneMappingExposure, vec3(0.));
      float m = max(max(c.r, c.g), c.b);
      vec3 hp = c * (v5Sh(m) / max(m, 1e-5));
      vec3 pc = vec3(v5Sh(c.r), v5Sh(c.g), v5Sh(c.b));
      c = mix(hp, pc, ${GRADE.mixPerChannel.toFixed(3)});
      float l = dot(c, vec3(.2126, .7152, .0722));
      c = max(mix(vec3(l), c, ${GRADE.sat.toFixed(3)}), vec3(0.));
      c *= mix(${f3(GRADE.cool)}, vec3(1.), smoothstep(.0, .22, l));
      c *= mix(vec3(1.), ${f3(GRADE.warm)}, smoothstep(.35, .95, l));
      return min(c, vec3(1.));
    }`);
  // the same curve for custom shaders (sky, clouds) that want it
  L.TONE_GLSL = THREE.ShaderChunk.tonemapping_pars_fragment.slice(THREE.ShaderChunk.tonemapping_pars_fragment.indexOf('float v5Sh'));

  // ================================================================ scene, camera, lights
  const scene = new THREE.Scene(); L.scene = scene;
  // keep the shared camera uniform in sync with whatever camera renders this scene (main view, bakes, probes)
  scene.onBeforeRender = function (r, s, cam) { const e = cam.matrixWorld.elements; HZ.P[0] = e[12]; HZ.P[1] = e[13]; HZ.P[2] = e[14]; };
  scene.fog = new THREE.FogExp2(0x9cc6ec, 0.0006);
  scene.background = C(0x9cc6ec);
  const camera = new THREE.PerspectiveCamera(50, 1, .4, Q0.far); L.camera = camera;
  const hemi = new THREE.HemisphereLight(0x9cc8f2, 0xbcb66a, .55); scene.add(hemi); L.hemi = hemi;
  const sun = new THREE.DirectionalLight(0xfff1d8, 1.3); sun.castShadow = true; L.sun = sun;
  sun.shadow.mapSize.set(Q0.shadow, Q0.shadow);
  const sc = sun.shadow.camera; const sd = Q0.shadowDist; sc.left = -sd; sc.right = sd; sc.top = sd; sc.bottom = -sd; sc.near = 1; sc.far = 900;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = .05; sun.shadow.radius = 1.6;
  scene.add(sun); scene.add(sun.target);
  L.amb = new THREE.AmbientLight(0x334466, 0); // kept for compatibility, not in the scene

  // ================================================================ v5 lighting model (L.stylize)
  // Global look uniforms (shared objects) + one per-material vec4.
  const LOOK = L.LOOK = {
    shadowTint: { value: new THREE.Color(.6, .73, 1.0) }, // multiplies the fill where the sun does not reach
    rimCol: { value: new THREE.Color(1, .95, .85) },
    par: { value: new THREE.Vector4(.55, .45, 1, .12) }, // terminator softness, ramp amount, fill scale, (spare)
    fillLift: { value: new THREE.Color(0, 0, 0) },      // tiny ambient floor (night never black)
  };
  const SHTAPS = Q0.shadowTaps;
  const LIGHT_PARS = `
uniform vec4 uV5m; // per material: wrap, rim, translucency, specular
uniform vec3 uV5ShadowTint, uV5Rim, uV5Lift; uniform vec4 uV5P;
float v5Shadow() {
  float sh = 1.;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  if (receiveShadow) {
    vec4 sc = vDirectionalShadowCoord[0]; sc.xyz /= sc.w; sc.z += directionalLightShadows[0].shadowBias;
    vec2 e = abs(sc.xy - .5) * 2.;
    if (max(e.x, e.y) < 1. && sc.z <= 1.) {
      vec2 ts = directionalLightShadows[0].shadowRadius / directionalLightShadows[0].shadowMapSize;
      #if ${SHTAPS} >= 4
      sh = texture2DCompare(directionalShadowMap[0], sc.xy + vec2(-.6, -.25) * ts, sc.z) + texture2DCompare(directionalShadowMap[0], sc.xy + vec2(.25, -.6) * ts, sc.z)
         + texture2DCompare(directionalShadowMap[0], sc.xy + vec2(.6, .25) * ts, sc.z) + texture2DCompare(directionalShadowMap[0], sc.xy + vec2(-.25, .6) * ts, sc.z);
      #if ${SHTAPS} >= 5
      sh = (sh + texture2DCompare(directionalShadowMap[0], sc.xy, sc.z)) * .2;
      #else
      sh *= .25;
      #endif
      #else
      sh = texture2DCompare(directionalShadowMap[0], sc.xy, sc.z);
      #endif
      sh = mix(sh, 1., smoothstep(.75, 1., max(e.x, e.y)));
    }
  }
  #endif
  return sh;
}
// albedo, view-space normal + view dir, sun dir + colour, up, sky/ground fill, shadow
void v5Light(vec3 alb, vec3 N, vec3 V, vec3 Ld, vec3 Lc, vec3 up, vec3 skyC, vec3 gndC, float sh, inout ReflectedLight rl) {
  float ndl = dot(N, Ld);
  float w = uV5m.x;
  float lam = clamp((ndl + w) / (1. + w), 0., 1.);
  float soft = smoothstep(0., uV5P.x, lam);
  float d = mix(lam, soft * (.55 + .45 * lam), uV5P.y);
  float lit = d * sh;
  float back = (pow(max(-ndl, 0.), 2.) + .15 * (1. - lam)) * uV5m.z;
  rl.directDiffuse += alb * Lc * (lit + back * sh * clamp(dot(V, -Ld) * .5 + .5, .2, 1.));
  float hw = dot(N, up) * .5 + .5, litK = clamp(lit * 1.25, 0., 1.);
  hw = mix(hw, 1., .6 * (1. - litK));                 // shade is lit by the sky dome more than by the ground bounce: blue
  vec3 fill = mix(gndC, skyC, hw) * uV5P.z;
  fill *= mix(uV5ShadowTint, vec3(1.), litK);
  rl.indirectDiffuse += alb * (fill + uV5Lift);
  float fr = pow(1. - clamp(dot(N, V), 0., 1.), 3.);
  rl.indirectDiffuse += alb * uV5Rim * Lc * fr * uV5m.y * (.25 + .75 * sh);
  if (uV5m.w > 0.) { vec3 H = normalize(Ld + V); rl.directSpecular += Lc * pow(max(dot(N, H), 0.), 8. + uV5m.w * 90.) * uV5m.w * lit * .6; }
}
`;
  L.LIGHT_PARS = LIGHT_PARS;
  // lighting block for MeshStandard/Physical (replaces lights_fragment_begin/maps/end)
  const STD_LIGHT = `
  GeometricContext geometry; geometry.position = - vViewPosition; geometry.normal = normal;
  geometry.viewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
  IncidentLight directLight;
  vec3 v5Ld = vec3(0., 1., 0.), v5Lc = vec3(0.);
  #if NUM_DIR_LIGHTS > 0
    v5Ld = directionalLights[0].direction; v5Lc = directionalLights[0].color;
  #endif
  #if NUM_HEMI_LIGHTS > 0
    vec3 v5Up = hemisphereLights[0].direction, v5Sky = hemisphereLights[0].skyColor, v5Gnd = hemisphereLights[0].groundColor;
  #else
    vec3 v5Up = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz), v5Sky = ambientLightColor, v5Gnd = ambientLightColor * .6;
  #endif
  v5Light(material.diffuseColor, normal, geometry.viewDir, v5Ld, v5Lc, v5Up, v5Sky, v5Gnd, v5Shadow(), reflectedLight);
  #if NUM_POINT_LIGHTS > 0
    PointLight pointLight;
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
      pointLight = pointLights[ i ];
      getPointDirectLightIrradiance( pointLight, geometry, directLight );
      reflectedLight.directDiffuse += material.diffuseColor * directLight.color * clamp(dot(normal, directLight.direction) * .6 + .4, 0., 1.);
    }
    #pragma unroll_loop_end
  #endif
`;
  // Lambert: point lights stay per vertex; sun + fill per fragment from an interpolated view-space normal
  const LAMB_VERT = `
  vLightFront = vec3( 0.0 ); vIndirectFront = vec3( 0.0 );
  #ifdef DOUBLE_SIDED
    vLightBack = vec3( 0.0 ); vIndirectBack = vec3( 0.0 );
  #endif
  #if NUM_POINT_LIGHTS > 0
  {
    GeometricContext geometry; geometry.position = mvPosition.xyz; geometry.normal = normalize( transformedNormal ); geometry.viewDir = normalize( -mvPosition.xyz );
    IncidentLight directLight;
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
      { // braces: the unrolled copies must not redeclare pdl
      getPointDirectLightIrradiance( pointLights[ i ], geometry, directLight );
      float pdl = dot( geometry.normal, directLight.direction );
      vLightFront += clamp( pdl * .6 + .4, 0., 1. ) * directLight.color;
      #ifdef DOUBLE_SIDED
        vLightBack += clamp( -pdl * .6 + .4, 0., 1. ) * directLight.color;
      #endif
      }
    }
    #pragma unroll_loop_end
  }
  #endif
  vV5N = transformedNormal; vV5P = -mvPosition.xyz;
`;
  const LAMB_FRAG = `
  {
    vec3 N = normalize( vV5N );
    #ifdef DOUBLE_SIDED
      N *= gl_FrontFacing ? 1. : -1.;
    #endif
    vec3 V = normalize( vV5P );
    #ifdef DOUBLE_SIDED
      reflectedLight.directDiffuse = ( gl_FrontFacing ? vLightFront : vLightBack ) * diffuseColor.rgb;
    #else
      reflectedLight.directDiffuse = vLightFront * diffuseColor.rgb;
    #endif
    vec3 v5Ld = vec3(0., 1., 0.), v5Lc = vec3(0.);
    #if NUM_DIR_LIGHTS > 0
      v5Ld = directionalLights[0].direction; v5Lc = directionalLights[0].color;
    #endif
    #if NUM_HEMI_LIGHTS > 0
      vec3 v5Up = hemisphereLights[0].direction, v5Sky = hemisphereLights[0].skyColor, v5Gnd = hemisphereLights[0].groundColor;
    #else
      vec3 v5Up = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz), v5Sky = ambientLightColor, v5Gnd = ambientLightColor * .6;
    #endif
    v5Light(diffuseColor.rgb, N, V, v5Ld, v5Lc, v5Up, v5Sky, v5Gnd, v5Shadow(), reflectedLight);
  }
`;
  function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  L.strHash = strHash;
  const baseOBC = THREE.Material.prototype.onBeforeCompile;
  const baseKey = THREE.Material.prototype.customProgramCacheKey;
  L.isBaseOBC = f => !f || f === baseOBC;
  // opts: {wrap (0..1, soft terminator), rim (0..1.5), transl (0..1 back-light), spec (0..1)}
  L.stylize = function (mat, opts) {
    if (!mat) return mat;
    if (Array.isArray(mat)) { mat.forEach(m => L.stylize(m, opts)); return mat; }
    opts = opts || {};
    const P = mat.userData.v5 || (mat.userData.v5 = { value: new THREE.Vector4() });
    P.value.set(opts.wrap != null ? opts.wrap : .35, opts.rim != null ? opts.rim : .3, opts.transl || 0, opts.spec || 0);
    if (mat.userData.v5done) return mat;
    const kind = mat.isMeshStandardMaterial ? 'std' : mat.isMeshLambertMaterial ? 'lam' : null;
    if (!kind) { mat.userData.v5done = true; return mat; } // basic/sprite/shader: haze only (global chunk)
    const prev = mat.onBeforeCompile !== baseOBC ? mat.onBeforeCompile : null;
    const prevKey = mat.customProgramCacheKey !== baseKey ? mat.customProgramCacheKey : null;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uV5m = P; sh.uniforms.uV5ShadowTint = LOOK.shadowTint; sh.uniforms.uV5Rim = LOOK.rimCol; sh.uniforms.uV5P = LOOK.par; sh.uniforms.uV5Lift = LOOK.fillLift;
      let f = sh.fragmentShader;
      if (kind === 'std') {
        f = f.replace('#include <lights_fragment_begin>', STD_LIGHT).replace('#include <lights_fragment_maps>', '').replace('#include <lights_fragment_end>', '');
        f = f.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + LIGHT_PARS);
      } else {
        sh.vertexShader = 'varying vec3 vV5N; varying vec3 vV5P;\n' + sh.vertexShader.replace('#include <lights_lambert_vertex>', LAMB_VERT);
        const a = f.indexOf('#ifdef DOUBLE_SIDED\n\t\treflectedLight.indirectDiffuse'), b = f.indexOf('#include <aomap_fragment>');
        if (a > 0 && b > a) f = f.slice(0, a) + LAMB_FRAG + f.slice(b);
        f = 'varying vec3 vV5N; varying vec3 vV5P;\n' + f.replace('#include <shadowmask_pars_fragment>', '#include <shadowmask_pars_fragment>\n' + LIGHT_PARS);
      }
      sh.fragmentShader = f;
    };
    const k = 'v5|' + kind + '|' + (prev ? strHash(prev.toString()) : '-') + '|' + (prevKey ? prevKey.call(mat) : '-');
    mat.customProgramCacheKey = () => k;
    mat.userData.v5done = true; mat.needsUpdate = true;
    return mat;
  };

  // ================================================================ post: bloom (fixed size) + grade/FXAA
  let composer = null, bloom = null, grade = null, renderPass = null;
  L.renderStats = { calls: 0, triangles: 0, points: 0, lines: 0 };
  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, uVig: { value: .3 }, uNight: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uSat: { value: 1 }, uWarm: { value: 0 } },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D tDiffuse;uniform float uVig,uNight,uSat,uWarm;uniform vec2 uRes;varying vec2 vUv;
      vec3 toSRGB(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
      float lu(vec3 c){return sqrt(dot(c,vec3(.299,.587,.114)));}
      void main(){
        vec3 c=texture2D(tDiffuse,vUv).rgb;
        #ifdef FXAA
        { vec2 px=1./uRes; vec3 nw=texture2D(tDiffuse,vUv+vec2(-1.,-1.)*px).rgb, ne=texture2D(tDiffuse,vUv+vec2(1.,-1.)*px).rgb,
            sw=texture2D(tDiffuse,vUv+vec2(-1.,1.)*px).rgb, se=texture2D(tDiffuse,vUv+vec2(1.,1.)*px).rgb;
          float lNW=lu(nw),lNE=lu(ne),lSW=lu(sw),lSE=lu(se),lM=lu(c);
          float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE))),lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
          if(lMax-lMin>max(.04,lMax*.125)){
            vec2 dir=vec2(-((lNW+lNE)-(lSW+lSE)),((lNW+lSW)-(lNE+lSE)));
            float red=max((lNW+lNE+lSW+lSE)*.03125,1./128.); float rcp=1./(min(abs(dir.x),abs(dir.y))+red);
            dir=clamp(dir*rcp,vec2(-8.),vec2(8.))*px;
            vec3 a=.5*(texture2D(tDiffuse,vUv+dir*(1./3.-.5)).rgb+texture2D(tDiffuse,vUv+dir*(2./3.-.5)).rgb);
            vec3 b=a*.5+.25*(texture2D(tDiffuse,vUv-dir*.5).rgb+texture2D(tDiffuse,vUv+dir*.5).rgb);
            float lB=lu(b); c=(lB<lMin||lB>lMax)?a:b; } }
        #endif
        float l=dot(c,vec3(.2126,.7152,.0722)); c=max(mix(vec3(l),c,uSat),0.);
        c*=mix(vec3(1.),vec3(.8,.88,1.1),uNight*.35);
        vec2 d=vUv-.5; c*=1.-uVig*dot(d,d)*1.4;
        gl_FragColor=vec4(toSRGB(clamp(c,0.,1.)),1.);}`
  };
  function setupPost(w, h) {
    const q = L.Q();
    // stencilBuffer:true -> DEPTH24_STENCIL8 (a depth-only target can be 16-bit: z-fighting over 12 km)
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, encoding: THREE.LinearEncoding, depthBuffer: true, stencilBuffer: true });
    composer = new THREE.EffectComposer(renderer, rt);
    renderPass = new THREE.RenderPass(scene, camera);
    const rr = renderPass.render.bind(renderPass);
    renderPass.render = function () { rr.apply(null, arguments); const I = renderer.info.render; L.renderStats.calls = I.calls; L.renderStats.triangles = I.triangles; L.renderStats.points = I.points; L.renderStats.lines = I.lines; };
    composer.addPass(renderPass);
    if (q.bloom > 0) {
      bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w * q.bloom, h * q.bloom), .3, .5, .86);
      // v4 bug: addPass() -> setSize(full) overrode the reduced resolution; keep the tier factor on every resize
      const ss = bloom.setSize.bind(bloom); bloom.setSize = (W, H) => ss(Math.max(4, Math.round(W * q.bloom)), Math.max(4, Math.round(H * q.bloom)));
      composer.addPass(bloom);
    }
    grade = new THREE.ShaderPass(GradeShader); if (q.fxaa) grade.material.defines.FXAA = ''; grade.renderToScreen = true; composer.addPass(grade);
    L.composer = composer; L.bloom = bloom; L.grade = grade;
  }
  function resize() {
    const w = wrap.clientWidth || innerWidth, h = wrap.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio(); const W = Math.floor(w * pr), H = Math.floor(h * pr);
    if (POST) { if (!composer) setupPost(W, H); else composer.setSize(W, H); grade.uniforms.uRes.value.set(W, H); }
    if (L.onResize) L.onResize(w, h);
  }
  addEventListener('resize', resize); L.resize = resize;

  // ================================================================ procedural noise texture (shared, CPU-readable)
  // 256² tileable RGBA: R large fbm, G medium fbm, B cell edges (cracks), A fine fbm.
  (function makeNoise() {
    const N = 256, data = new Uint8Array(N * N * 4);
    function hash(i, j, s) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
    function vn(x, y, p, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const m = k => ((k % p) + p) % p; const a = hash(m(i), m(j), s), b = hash(m(i + 1), m(j), s), c = hash(m(i), m(j + 1), s), d = hash(m(i + 1), m(j + 1), s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
    function fbm(x, y, p, s, o) { let t = 0, a = .5, n = 0; for (let k = 0; k < o; k++) { t += a * vn(x, y, p, s + k * 7); n += a; a *= .5; x *= 2; y *= 2; p *= 2; } return t / n; }
    const cells = 12, pts = []; for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + .15 + hash(i, j, 99) * .7) / cells, (j + .15 + hash(i, j, 98) * .7) / cells]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, o = (y * N + x) * 4;
      data[o] = clamp(fbm(u * 4, v * 4, 4, 1, 5) * 1.6 - .3, 0, 1) * 255;
      data[o + 1] = clamp(fbm(u * 16, v * 16, 16, 3, 4) * 1.6 - .3, 0, 1) * 255;
      let d1 = 9, d2 = 9; const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells; const p = pts[jj * cells + ii]; const px = p[0] + (ci + di - ii) / cells, py = p[1] + (cj + dj - jj) / cells; const d = Math.hypot(u - px, v - py); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      data[o + 2] = clamp((d2 - d1) * cells * 1.6, 0, 1) * 255;
      data[o + 3] = clamp(fbm(u * 32, v * 32, 32, 5, 3) * 1.6 - .3, 0, 1) * 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    L.noiseTex = t; L.noiseData = data; L.NOISE_N = N;
    // CPU sample with the GPU's wrap + bilinear filtering: u,v in texture units (1 = one tile), ch 0..3
    L.noise2 = function (u, v, ch) {
      const x = u * N - .5, y = v * N - .5, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      const i0 = ((i % N) + N) % N, j0 = ((j % N) + N) % N, i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
      const a = data[(j0 * N + i0) * 4 + ch], b = data[(j0 * N + i1) * 4 + ch], c = data[(j1 * N + i0) * 4 + ch], d = data[(j1 * N + i1) * 4 + ch];
      return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) / 255;
    };
  })();

  // ================================================================ textures & loader
  const texLoader = new THREE.TextureLoader();
  const T = {}; L.T = T;
  L.loaded = 0; L.total = 0;
  const texWait = [];
  function tex(name, srgb) {
    let done; texWait.push(new Promise(r => { done = r; }));
    const t = texLoader.load('assets/' + name, () => { L.loaded++; done(); }, undefined, () => { console.warn('tex', name); L.loaded++; done(); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); return t;
  }
  // v4 terrain still samples grass/forest/rock/sand/snow; planks/leaves/thatch were never used
  const TEXLIST = ['grass', 'forest', 'rock', 'sand', 'snow', 'stone', 'bark'];
  let texStarted = false;
  L.loadTextures = function () {
    if (texStarted) return Promise.all(texWait); texStarted = true;
    for (const n of TEXLIST) { T[n] = tex('t_' + n + '.jpg', true); T[n + '_n'] = tex('t_' + n + '_n.jpg', false); L.total += 2; }
    T.water_n = tex('t_water_n.jpg', false); T.clouds = tex('t_clouds.png', false); T.rockd = tex('t_rockd.jpg', true); L.total += 3;
    return Promise.all(texWait);
  };
  const gltf = new THREE.GLTFLoader();
  const M = {}; L.M = M;
  const MODELS = ['tree_oak', 'tree_pine', 'tree_willow', 'tree_ancient', 'rock1', 'rock2', 'mushroom', 'crystal', 'stump', 'lily', 'tree_oak_lo', 'tree_pine_lo', 'tree_willow_lo', 'tree_ancient_lo', 'rock1_lo', 'rock2_lo'];
  L.loadLegacy = function (names) {
    return Promise.all((names || MODELS).map(n => M[n] ? Promise.resolve() : new Promise((res) => {
      L.total++;
      gltf.load('assets/' + n + '.json', g => { M[n] = g.scene; L.loaded++; res(); }, undefined, e => { console.warn('model', n, e); L.loaded++; res(); });
    })));
  };
  const M4 = {}; L.M4 = M4;
  L.loadModel = function (name) {
    if (!M4[name]) M4[name] = new Promise(res => gltf.load('m/' + name + '.json', g => { g.scene.userData.anims = g.animations; res(g.scene); }, undefined, e => { console.warn('model4', name, e); res(null); }));
    return M4[name];
  };
  L.loadAll = async function (extra) { const tw = L.loadTextures(); const ex = (extra || []).map(n => { L.total++; return L.loadModel(n).then(() => { L.loaded++; }); }); await Promise.all([tw, L.loadLegacy(), ...ex]); };

  // ================================================================ wind for plain materials (world space, shared clock)
  // amount = sway strength, freq = sway speed; per-material uniforms, shared shader text.
  function addWind(mat, amount, freq) {
    const W = { value: new THREE.Vector2(amount, freq) };
    const prev = mat.onBeforeCompile !== baseOBC ? mat.onBeforeCompile : null;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uTime = L.uTime; sh.uniforms.uWindP = W;
      sh.vertexShader = 'uniform float uTime; uniform vec2 uWindP; varying float vViewZ;\n' + sh.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition; vec3 wp0 = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.)).xyz;
        #else
          vec3 wp0 = (modelMatrix * vec4(0., 0., 0., 1.)).xyz;
        #endif
        vec4 wpos = modelMatrix * mvPosition;
        float hy = clamp(wpos.y - wp0.y, 0., 20.);
        float sway = sin(uTime * uWindP.y + wp0.x * .35 + wp0.z * .27) * uWindP.x * hy * .06;
        wpos.xz += vec2(sway, sway * .6);
        mvPosition = viewMatrix * wpos; gl_Position = projectionMatrix * mvPosition; vViewZ = -mvPosition.z;`);
      sh.fragmentShader = 'varying float vViewZ;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if(vViewZ<2.8){float dn=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);if(dn>vViewZ/2.8)discard;}');
      mat.userData.shader = sh;
    };
    mat.userData.wind = W;
    return mat;
  }
  L.addWind = addWind;
  L.tickWind = t => { L.uTime.value = t; };

  // ================================================================ shared materials
  const MAT = {}; L.MAT = MAT;
  L.makeMaterials = function () {
    const std = (o, s) => L.stylize(new THREE.MeshStandardMaterial(Object.assign({ roughness: .9, metalness: 0 }, o)), s);
    MAT.v5 = std({ vertexColors: true, roughness: .85 }, { wrap: .35, rim: .3 });
    MAT.v5skin = std({ vertexColors: true, roughness: .8, skinning: true }, { wrap: .45, rim: .55 });
    MAT.v4 = MAT.v5; MAT.v4skin = MAT.v5skin;
    MAT.bark = L.makeBarkMaterial ? L.makeBarkMaterial() : std({ vertexColors: true, color: 0x9a7458 }, { wrap: .3, rim: .2 });
    MAT.rock = L.makeRockMaterial ? L.makeRockMaterial() : std({ vertexColors: true, color: 0xb8b2a6 }, { wrap: .3, rim: .2 });
    MAT.stone = MAT.rock;
    MAT.plain = std({ vertexColors: true }, { wrap: .35, rim: .25 });
    MAT.mushCap = std({ vertexColors: true, emissive: 0x3fd0ff, emissiveIntensity: .2 }, { wrap: .4, rim: .3 });
    MAT.crystal = std({ vertexColors: true, emissive: 0x9a7cff, emissiveIntensity: .6, roughness: .3 }, { wrap: .3, rim: .6, spec: .6 });
    MAT.ore = std({ color: 0xe0a060, emissive: 0x6a3a10, emissiveIntensity: .35, metalness: .45, roughness: .32, flatShading: true }, { wrap: .2, rim: .3, spec: .7 });
    MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2), fog: false });
    MAT.glowSkin = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2), skinning: true, fog: false });
    if (L.makeFoliageMat) MAT.foliage = L.makeFoliageMat({ wind: 1 });
  };

  // assign materials to a loaded legacy model by node name; returns clone
  L.inst = function (name, matFor) {
    const src = M[name]; if (!src) return new THREE.Group();
    const g = src.clone(true);
    g.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; o.material = (matFor && matFor(o.name, o)) || MAT.plain; });
    return g;
  };
  // Merge a legacy model's meshes into world-baked geometry grouped by material key (srcObj: any Object3D instead)
  L.flatten = function (name, matFor, srcObj) {
    const src = srcObj || M[name]; const groups = {};
    src.updateMatrixWorld(true);
    src.traverse(o => {
      if (!o.isMesh) return;
      const key = (matFor && matFor(o.name)) || 'plain';
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.color) { const n = g.attributes.position.count; g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
      if (!g.attributes.uv) { const n = g.attributes.position.count; g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2)); }
      if (g.attributes.color.itemSize === 4 || g.attributes.color.normalized) { const a = g.attributes.color, b = new Float32Array(a.count * 3); const s = a.normalized ? (a.array instanceof Uint8Array ? 1 / 255 : a.array instanceof Uint16Array ? 1 / 65535 : 1) : 1; for (let i = 0; i < a.count; i++) { b[i * 3] = a.getX(i) * s; b[i * 3 + 1] = a.getY(i) * s; b[i * 3 + 2] = a.getZ(i) * s; } g.setAttribute('color', new THREE.BufferAttribute(b, 3)); }
      (groups[key] = groups[key] || []).push(g);
    });
    const out = {};
    for (const k in groups) {
      const gs = groups[k].map(g => { const n = g.index ? g.toNonIndexed() : g; const c = new THREE.BufferGeometry(); for (const a of ['position', 'normal', 'uv', 'color']) if (n.attributes[a]) c.setAttribute(a, n.attributes[a]); return c; });
      out[k] = THREE.BufferGeometryUtils.mergeBufferGeometries(gs, false);
    }
    return out;
  };

  // ================================================================ time of day
  // Palettes (sRGB hex in, linear out). L.TOD holds the blended state that sky/terramat/grass read.
  const PAL = {
    day: { zen: 0x2f7fdc, mid: 0x3f8fe2, hor: 0x80b9e8, low: 0xdfe6ee, sun: 0xfff1d8, sunI: 1.32, sky: 0x9ac8f6, skyI: .6, gnd: 0xc4bf7a, gndI: .36,
      veilD: 0x2c5f98, veilL: 0x7cc2e6, hazeA: 0x8ec2ea, hazeS: 0xe4ecf0, cLit: 0xf4f6f8, cBody: 0xd9dde2, cShade: 0xb6c3d3, cDeep: 0x95a9c4, tint: [.42, .6, 1.04], exp: 1 },
    dusk: { zen: 0x2f5aa8, mid: 0x6d86c4, hor: 0xf0b48a, low: 0xffd4a0, sun: 0xffa45c, sunI: 1.25, sky: 0x8c95cc, skyI: .5, gnd: 0xa4805a, gndI: .28,
      veilD: 0x3b4e8c, veilL: 0xc9a2a0, hazeA: 0xb9a5c4, hazeS: 0xffc58e, cLit: 0xffd8b0, cBody: 0xe9b9a6, cShade: 0x8f8db5, cDeep: 0x6c6996, tint: [.66, .62, 1.0], exp: 1 },
    night: { zen: 0x0a1838, mid: 0x112552, hor: 0x24406f, low: 0x2e4b7c, sun: 0xa8c0ff, sunI: .3, sky: 0x4a66aa, skyI: .5, gnd: 0x22304e, gndI: .22,
      veilD: 0x0e2148, veilL: 0x2c4a7c, hazeA: 0x24406f, hazeS: 0x2f4d80, cLit: 0x6577a4, cBody: 0x4a5a86, cShade: 0x2c3a62, cDeep: 0x1c2846, tint: [.75, .85, 1.1], exp: 1.12 },
  };
  const P3 = {}; for (const k in PAL) { P3[k] = {}; for (const f in PAL[k]) { const v = PAL[k][f]; P3[k][f] = typeof v === 'number' && v > 2 ? C(v) : Array.isArray(v) ? new THREE.Color(v[0], v[1], v[2]) : v; } }
  L.PAL5 = P3;
  const TOD = L.TOD = { sunDir: new THREE.Vector3(.45, .6, -.66).normalize(), moonDir: new THREE.Vector3(-.4, .5, .5).normalize(), lightDir: new THREE.Vector3(0, 1, 0), day: 1, dusk: 0, night: 0, rain: 0, set: false,
    zen: new THREE.Color(), mid: new THREE.Color(), hor: new THREE.Color(), low: new THREE.Color(), cLit: new THREE.Color(), cBody: new THREE.Color(), cShade: new THREE.Color(), cDeep: new THREE.Color(), sunCol: new THREE.Color(), hazeS: new THREE.Color(), hazeA: new THREE.Color() };
  const _c = new THREE.Color(), _c2 = new THREE.Color();
  function mix3(f, out) { const a = P3.day[f], b = P3.dusk[f], n = P3.night[f]; out.setRGB(a.r * TOD.day + b.r * TOD.dusk + n.r * TOD.night, a.g * TOD.day + b.g * TOD.dusk + n.g * TOD.night, a.b * TOD.day + b.b * TOD.dusk + n.b * TOD.night); return out; }
  function mixN(f) { return P3.day[f] * TOD.day + P3.dusk[f] * TOD.dusk + P3.night[f] * TOD.night; }
  const GREY = C(0x9aa4ae);
  // o: {sunDir, moonDir, dayW, duskW, nightW, rain, haze}. Missing weights are derived from the sun height; haze scales
  // the aerial perspective (1 = default, kept until changed: a region or a preset can ask for a hazier valley).
  L.setTimeOfDay = function (o) {
    o = o || {};
    if (o.sunDir) TOD.sunDir.copy(o.sunDir).normalize();
    if (o.moonDir) TOD.moonDir.copy(o.moonDir).normalize(); else TOD.moonDir.set(-TOD.sunDir.x, Math.max(.3, -TOD.sunDir.y), -TOD.sunDir.z).normalize();
    let d = o.dayW, k = o.duskW, n = o.nightW;
    if (d == null || k == null || n == null) { const sh = TOD.sunDir.y; d = sstep(.0, .3, sh); n = sstep(.0, -.2, sh); k = Math.max(0, 1 - d - n); }
    const tot = d + k + n || 1; TOD.day = d / tot; TOD.dusk = k / tot; TOD.night = n / tot; TOD.rain = clamp(o.rain || 0, 0, 1); TOD.set = true;
    const R = TOD.rain;
    mix3('zen', TOD.zen); mix3('mid', TOD.mid); mix3('hor', TOD.hor); mix3('low', TOD.low); mix3('cLit', TOD.cLit); mix3('cBody', TOD.cBody); mix3('cShade', TOD.cShade); mix3('cDeep', TOD.cDeep);
    if (R > 0) {
      _c.copy(GREY).multiplyScalar(.75 - TOD.night * .5); TOD.zen.lerp(_c, R * .7); TOD.mid.lerp(_c, R * .7);
      _c.copy(GREY).multiplyScalar(1 - TOD.night * .7); TOD.hor.lerp(_c, R * .7); TOD.low.lerp(_c, R * .7);
      TOD.cLit.lerp(_c.copy(GREY).multiplyScalar(1.05 - TOD.night * .65), R * .75); TOD.cBody.lerp(_c.copy(GREY).multiplyScalar(.8 - TOD.night * .5), R * .75); TOD.cShade.lerp(_c.copy(GREY).multiplyScalar(.55 - TOD.night * .35), R * .75); TOD.cDeep.lerp(_c.copy(GREY).multiplyScalar(.42 - TOD.night * .3), R * .75);
    }
    // main light: the sun while it is up, then the moon
    const useSun = TOD.sunDir.y > -.06; TOD.lightDir.copy(useSun ? TOD.sunDir : TOD.moonDir);
    if (TOD.lightDir.y < .08) { TOD.lightDir.y = .08; TOD.lightDir.normalize(); }
    mix3('sun', TOD.sunCol); sun.color.copy(TOD.sunCol);
    const fade = useSun ? sstep(-.06, .06, TOD.sunDir.y) : clamp((TOD.night - .3) / .7, 0, 1);
    sun.intensity = mixN('sunI') * (1 - R * .65) * fade;
    mix3('sky', hemi.color); mix3('gnd', hemi.groundColor); hemi.intensity = 1;
    hemi.color.multiplyScalar(mixN('skyI') * (1 + R * .25)); hemi.groundColor.multiplyScalar(mixN('gndI') * (1 - R * .3));
    if (R > 0) hemi.color.lerp(_c.copy(GREY).multiplyScalar(.62 - TOD.night * .4), R * .6);
    mix3('tint', _c);
    LOOK.shadowTint.value.copy(_c).lerp(_c2.setRGB(.85, .88, .95), R * .7);
    LOOK.rimCol.value.copy(TOD.sunCol).lerp(_c.setRGB(1, 1, 1), .4);
    LOOK.fillLift.value.setRGB(.012, .018, .035).multiplyScalar(TOD.night);
    // haze
    mix3('hazeA', TOD.hazeA); mix3('hazeS', TOD.hazeS);
    if (R > 0) { TOD.hazeA.lerp(_c.copy(GREY).multiplyScalar(1 - TOD.night * .7), R * .8); TOD.hazeS.lerp(TOD.hazeA, R * .8); }
    scene.fog.color.copy(TOD.hazeA); scene.background.copy(TOD.hor);
    TOD.haze = o.haze != null ? o.haze : (TOD.haze || 1);
    scene.fog.density = .0006 * TOD.haze * (1 + R * 2.2 + TOD.dusk * .15);
    HZ.B[3] = .38 / Math.sqrt(TOD.haze);   // extra haze mostly thickens the blue veil, the fade to the horizon colour grows slower
    mix3('veilD', _c); HZ.A[0] = _c.r; HZ.A[1] = _c.g; HZ.A[2] = _c.b;
    mix3('veilL', _c); if (R > 0) _c.lerp(_c2.copy(GREY).multiplyScalar(1 - TOD.night * .7), R * .7); HZ.B[0] = _c.r; HZ.B[1] = _c.g; HZ.B[2] = _c.b;
    HZ.C[0] = TOD.hazeS.r; HZ.C[1] = TOD.hazeS.g; HZ.C[2] = TOD.hazeS.b; HZ.C[3] = 6 - TOD.dusk * 3;
    HZ.D[0] = TOD.sunDir.x; HZ.D[1] = TOD.sunDir.y; HZ.D[2] = TOD.sunDir.z;
    _c.copy(TOD.cLit).lerp(_c2.setRGB(1, 1, 1), .1); HZ.N[0] = _c.r * .96; HZ.N[1] = _c.g * .97; HZ.N[2] = _c.b;
    renderer.toneMappingExposure = mixN('exp') * (1 - R * .08);
    if (grade) grade.uniforms.uNight.value = TOD.night;
    if (bloom) bloom.strength = .26 + TOD.night * .25 + TOD.dusk * .1;
    if (MAT.mushCap) MAT.mushCap.emissiveIntensity = .15 + TOD.night * 1.6;
    if (MAT.crystal) MAT.crystal.emissiveIntensity = .5 + TOD.night * 1.4;
    if (MAT.ore) MAT.ore.emissiveIntensity = .3 + TOD.night * .6;
    if (MAT.glow) { MAT.glow.color.setScalar(1.6 + TOD.night * 1.2); MAT.glowSkin.color.setScalar(1.6 + TOD.night * 1.2); }
    for (const f of todHooks) f(TOD);
  };
  const todHooks = [];
  L.onTimeOfDay = f => { todHooks.push(f); if (TOD.set) f(TOD); };
  // convenience: named presets used by the lab and tools ('day', 'golden', 'night', 'rain')
  L.todPreset = function (name, az) {
    az = az == null ? -.9 : az; const el = { day: .78, golden: .07, night: -.5, rain: .7, dawn: .03 }[name] ?? .78;
    const s = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    return { sunDir: s, rain: name === 'rain' ? 1 : 0 };
  };

  // ================================================================ per-frame look tick (shadows, uniforms, sky)
  const _f = new THREE.Vector3(), _ls = new THREE.Vector3(), _lu = new THREE.Vector3(), _lr = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  L.lookFocus = null; // optional Vector3 the shadows centre on (default: player, else ahead of the camera)
  let lastT = -1;
  L.lookTick = function (dt, t, cam, focus) {
    cam = cam || camera; if (t == null) t = (lastT < 0 ? 0 : lastT) + (dt || 0); lastT = t; L._lookFrame = renderer.info.render.frame;
    L.uTime.value = t;
    if (!TOD.set) { // the v4 game drives sky uniforms / lights itself: follow them
      if (L.skyU) { TOD.sunDir.copy(L.skyU.sunDir.value); TOD.night = L.skyU.night.value; TOD.dusk = L.skyU.dusk.value; TOD.day = Math.max(0, 1 - TOD.night - TOD.dusk); }
      HZ.D[0] = TOD.sunDir.x; HZ.D[1] = TOD.sunDir.y; HZ.D[2] = TOD.sunDir.z;
      TOD.lightDir.copy(sun.position).sub(sun.target.position).normalize();
    } else {
      // shadow camera centred on the focus, snapped to whole shadow texels in light space (no shimmering)
      if (focus) _f.copy(focus); else if (L.lookFocus) _f.copy(L.lookFocus); else if (L.uPlayer.value.y > -900) _f.copy(L.uPlayer.value); else cam.getWorldDirection(_f).multiplyScalar(sd * .6).add(cam.position);
      const ld = TOD.lightDir; _lr.crossVectors(_up, ld); if (_lr.lengthSq() < 1e-6) _lr.set(1, 0, 0); _lr.normalize(); _lu.crossVectors(ld, _lr).normalize();
      const tx = 2 * sd / Q0.shadow; const a = Math.round(_f.dot(_lr) / tx) * tx, b = Math.round(_f.dot(_lu) / tx) * tx, c = _f.dot(ld);
      _ls.copy(_lr).multiplyScalar(a).addScaledVector(_lu, b).addScaledVector(ld, c);
      sun.target.position.copy(_ls); sun.position.copy(_ls).addScaledVector(ld, 450);
      sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    }
    for (const f of tickHooks) f(dt || 0, t, cam);
  };
  const tickHooks = [];
  L.onLookTick = f => tickHooks.push(f);

  // ================================================================ glow sprites & particles
  function glowTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); }
  function heartTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#ff5f8f'; g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(4, 34, 10, 8, 32, 22); g.bezierCurveTo(54, 8, 60, 34, 32, 54); g.fill(); g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(22, 24, 5, 0, 7); g.fill(); return new THREE.CanvasTexture(c); }
  function leafTex() { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(16, 16, 6, 13, .6, 0, 7); g.fill(); return new THREE.CanvasTexture(c); }
  L.GLOW = glowTex(); L.HEART = heartTex(); L.LEAF = leafTex();
  L.glowSprite = function (color, size, op) { const m = new THREE.SpriteMaterial({ map: L.GLOW, color, transparent: true, opacity: op == null ? 1 : op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); const s = new THREE.Sprite(m); s.scale.set(size, size, 1); return s; };

  // CPU particle pool: structure-of-arrays, swap-remove, no allocation per frame; v4 API ({mat, list, emit, update}).
  L.makeParticles = function (max, map, additive) {
    const g = new THREE.BufferGeometry(); const P = new Float32Array(max * 3), Col = new Float32Array(max * 4), Sz = new Float32Array(max), Rot = new Float32Array(max);
    const aP = new THREE.BufferAttribute(P, 3), aC = new THREE.BufferAttribute(Col, 4), aS = new THREE.BufferAttribute(Sz, 1), aR = new THREE.BufferAttribute(Rot, 1);
    for (const a of [aP, aC, aS, aR]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', aP); g.setAttribute('aColor', aC); g.setAttribute('aSize', aS); g.setAttribute('aRot', aR); g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uTex: { value: map }, uScale: { value: 400 } },
      vertexShader: `attribute vec4 aColor;attribute float aSize,aRot;uniform float uScale;varying vec4 vC;varying float vR;void main(){vC=aColor;vR=aRot;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uScale/-mv.z;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D uTex;varying vec4 vC;varying float vR;void main(){vec2 p=gl_PointCoord-.5;float c=cos(vR),s=sin(vR);p=vec2(c*p.x-s*p.y,s*p.x+c*p.y)+.5;vec4 t=texture2D(uTex,p);gl_FragColor=t*vC;if(gl_FragColor.a<.01)discard;}` });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
    const F = 18, S = new Float32Array(max * F); // x y z vx vy vz g life age s0 s1 r g b a drag rot rv
    let n = 0; const lst = { length: 0 };
    return {
      mat, points: pts,
      get list() { lst.length = n; return lst; },
      emit(o) {
        const i = n < max ? n++ : Math.floor(Math.random() * max); const b = i * F; const c = o.c || [1, 1, 1];
        S[b] = o.x || 0; S[b + 1] = o.y || 0; S[b + 2] = o.z || 0; S[b + 3] = o.vx || 0; S[b + 4] = o.vy || 0; S[b + 5] = o.vz || 0; S[b + 6] = o.g || 0;
        S[b + 7] = o.life || 1; S[b + 8] = o.age || 0; S[b + 9] = o.s0 != null ? o.s0 : .5; S[b + 10] = o.s1 != null ? o.s1 : .1; S[b + 11] = c[0]; S[b + 12] = c[1]; S[b + 13] = c[2];
        S[b + 14] = o.a != null ? o.a : 1; S[b + 15] = o.drag || 0; S[b + 16] = o.rot || 0; S[b + 17] = o.rv || 0;
      },
      update(dt) {
        let i = 0;
        while (i < n) {
          const b = i * F; S[b + 8] += dt;
          if (S[b + 8] >= S[b + 7]) { n--; if (i < n) S.copyWithin(b, n * F, n * F + F); continue; }
          S[b + 4] -= S[b + 6] * dt; const d = Math.exp(-S[b + 15] * dt); S[b + 3] *= d; S[b + 4] *= d; S[b + 5] *= d;
          S[b] += S[b + 3] * dt; S[b + 1] += S[b + 4] * dt; S[b + 2] += S[b + 5] * dt; S[b + 16] += S[b + 17] * dt; const t = S[b + 8] / S[b + 7];
          P[i * 3] = S[b]; P[i * 3 + 1] = S[b + 1]; P[i * 3 + 2] = S[b + 2]; Col[i * 4] = S[b + 11]; Col[i * 4 + 1] = S[b + 12]; Col[i * 4 + 2] = S[b + 13];
          Col[i * 4 + 3] = S[b + 14] * Math.min(1, t * 6) * (1 - t); Sz[i] = lerp(S[b + 9], S[b + 10], t); Rot[i] = S[b + 16]; i++;
        }
        g.setDrawRange(0, n);
        if (n) { aP.updateRange.count = n * 3; aC.updateRange.count = n * 4; aS.updateRange.count = n; aR.updateRange.count = n; aP.needsUpdate = aC.needsUpdate = aS.needsUpdate = aR.needsUpdate = true; }
      }
    };
  };

  L.textSprite = function (txt, size, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); g.font = '600 32px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 7; g.strokeStyle = 'rgba(10,12,30,.75)'; g.strokeText(txt, 128, 32); g.fillStyle = color || '#fff7e6'; g.fillText(txt, 128, 32);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false })); s.scale.set(size * 4, size, 1); s.renderOrder = 6; return s;
  };

  L.render = function () {
    if (L.cullCells) { camera.updateMatrixWorld(); L.cullCells(camera); }
    if (composer) composer.render();
    else { renderer.render(scene, camera); const I = renderer.info.render; L.renderStats.calls = I.calls; L.renderStats.triangles = I.triangles; L.renderStats.points = I.points; L.renderStats.lines = I.lines; }
  };
  resize();
})(window.L);
