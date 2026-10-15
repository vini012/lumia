/* Lumiar engine: renderer, post-processing, sky, asset loading, shared materials, particles. */
'use strict';
window.L = window.L || {};
(function (L) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const C = h => new THREE.Color(h).convertSRGBToLinear();
  L.clamp = clamp; L.lerp = lerp; L.sstep = sstep; L.C = C;

  L.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1400);
  L.quality = L.isMobile ? 'medio' : 'alto';
  try { let q = localStorage.getItem('lumiar:q'); if (q) { try { q = JSON.parse(q); } catch (e) { } if (['alto', 'medio', 'baixo'].includes(q)) L.quality = q; } } catch (e) { }
  const Q = () => ({ alto: { dpr: 2, shadow: 2048, bloom: 1, grass: 3200, shadowDist: 55, lod: 130 }, medio: { dpr: 1.5, shadow: 1536, bloom: .5, grass: 1800, shadowDist: 42, lod: 95 }, baixo: { dpr: 1, shadow: 1024, bloom: 0, grass: 800, shadowDist: 30, post: false, lod: 70 } })[L.quality];
  L.Q = Q;

  // ---------- renderer ----------
  const wrap = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q().dpr));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = true;
  wrap.appendChild(renderer.domElement);
  L.renderer = renderer;
  // exponential height fog for every material: thick in the low valleys, thin on the peaks (aerial perspective).
  // vFogW = world-space vector from the camera to the fragment (R^T * view-space position).
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogW;\n#endif\n';
  THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogW = vec3(dot(viewMatrix[0].xyz, mvPosition.xyz), dot(viewMatrix[1].xyz, mvPosition.xyz), dot(viewMatrix[2].xyz, mvPosition.xyz));\n#endif\n';
  THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor; varying vec3 vFogW;\n #ifdef FOG_EXP2\n  uniform float fogDensity;\n #else\n  uniform float fogNear; uniform float fogFar;\n #endif\n#endif\n';
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
    float fogDist = length(vFogW);
    #ifdef FOG_EXP2
      const float FB = 1. / 150.;
      float fe = FB * vFogW.y; float fInt = abs(fe) > 1e-3 ? (1. - exp(-fe)) / fe : 1. - fe * .5;
      float fogFactor = 1. - exp(-fogDensity * fogDist * (exp(-FB * max(cameraPosition.y, -30.)) * fInt + .2));
    #else
      float fogFactor = smoothstep(fogNear, fogFar, fogDist);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif`;
  const scene = new THREE.Scene(); L.scene = scene;
  scene.fog = new THREE.FogExp2(0xbfe3ff, 0.0006);
  const camera = new THREE.PerspectiveCamera(50, 1, .35, 6000); L.camera = camera;

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4a6a33, .55); scene.add(hemi); L.hemi = hemi;
  const sun = new THREE.DirectionalLight(0xfff4d6, 1.4); sun.castShadow = true; L.sun = sun;
  sun.shadow.mapSize.set(Q().shadow, Q().shadow);
  const sc = sun.shadow.camera; const sd = Q().shadowDist; sc.left = -sd; sc.right = sd; sc.top = sd; sc.bottom = -sd; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = .06; sun.shadow.radius = 2;
  scene.add(sun); scene.add(sun.target);
  const amb = new THREE.AmbientLight(0x334466, .0); scene.add(amb); L.amb = amb;

  // ---------- post-processing ----------
  let composer = null, bloom = null, grade = null;
  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, uVig: { value: .42 }, uSat: { value: 1.03 }, uWarm: { value: 0.0 }, uNight: { value: 0 } },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D tDiffuse;uniform float uVig,uSat,uWarm,uNight;varying vec2 vUv;
      vec3 toSRGB(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
      void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;
        float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,uSat);
        // subtle teal shadows / warm highlights
        c=mix(c,c*vec3(.92,1.0,1.08),(1.-smoothstep(0.,.35,l))*.35);
        c=mix(c,c*vec3(1.06,1.0,.92),smoothstep(.45,1.,l)*.25);
        c=mix(c,c*vec3(.62,.72,1.12)*.72,uNight*.85);
        vec2 d=vUv-.5;c*=1.-uVig*dot(d,d)*1.6;
        gl_FragColor=vec4(toSRGB(clamp(c,0.,1.)),1.);}`
  };
  function setupPost(w, h) {
    const q = Q();
    // stencilBuffer:true makes three allocate DEPTH24_STENCIL8 (a depth-only target would be 16-bit: z-fighting across a 3 km world)
    const rt = new THREE.WebGLRenderTarget(w, h, { type: renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType, encoding: THREE.LinearEncoding, depthBuffer: true, stencilBuffer: true });
    composer = new THREE.EffectComposer(renderer, rt);
    composer.addPass(new THREE.RenderPass(scene, camera));
    if (q.bloom > 0) {
      bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w * q.bloom, h * q.bloom), .42, .55, .82);
      composer.addPass(bloom);
    }
    grade = new THREE.ShaderPass(GradeShader); grade.renderToScreen = true; composer.addPass(grade);
    L.composer = composer; L.bloom = bloom; L.grade = grade;
  }
  function resize() {
    const w = wrap.clientWidth || innerWidth, h = wrap.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    if (Q().post === false) { /* direct rendering on low quality */ } else if (!composer) setupPost(Math.floor(w * pr), Math.floor(h * pr)); else composer.setSize(Math.floor(w * pr), Math.floor(h * pr));
    if (L.onResize) L.onResize(w, h);
  }
  addEventListener('resize', resize); L.resize = resize;

  // ---------- textures & loader ----------
  const texLoader = new THREE.TextureLoader();
  const T = {}; L.T = T;
  function tex(name, srgb, rep) {
    const t = texLoader.load('assets/' + name, () => { L.loaded++; });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); if (rep) t.repeat.set(rep, rep); return t;
  }
  L.loaded = 0; L.total = 0;
  const TEXLIST = ['grass', 'forest', 'rock', 'sand', 'snow', 'planks', 'stone', 'bark', 'leaves', 'thatch'];
  function loadTextures() {
    for (const n of TEXLIST) { T[n] = tex('t_' + n + '.jpg', true); T[n + '_n'] = tex('t_' + n + '_n.jpg', false); L.total += 2; }
    T.water_n = tex('t_water_n.jpg', false); T.clouds = tex('t_clouds.png', false); T.rockd = tex('t_rockd.jpg', true); L.total += 3;
  }
  const gltf = new THREE.GLTFLoader();
  const M = {}; L.M = M;
  const MODELS = ['tree_oak', 'tree_pine', 'tree_willow', 'tree_ancient', 'rock1', 'rock2', 'mushroom', 'crystal', 'stump', 'lily', 'tree_oak_lo', 'tree_pine_lo', 'tree_willow_lo', 'tree_ancient_lo', 'rock1_lo', 'rock2_lo'];
  function loadModels() {
    return Promise.all(MODELS.map(n => new Promise((res) => {
      L.total++;
      gltf.load('assets/' + n + '.json', g => { M[n] = g.scene; L.loaded++; res(); }, undefined, e => { console.warn('model', n, e); L.loaded++; res(); });
    })));
  }
  // v4 Blender assets (rigged creatures, characters, building kit, world props) live in m/ and load on demand
  const M4 = {}; L.M4 = M4;
  L.loadModel = function (name) {
    if (!M4[name]) M4[name] = new Promise(res => gltf.load('m/' + name + '.json', g => { g.scene.userData.anims = g.animations; res(g.scene); }, undefined, e => { console.warn('model4', name, e); res(null); }));
    return M4[name];
  };
  L.loadAll = async function (extra) { loadTextures(); const ex = (extra || []).map(n => { L.total++; return L.loadModel(n).then(() => { L.loaded++; }); }); await Promise.all([loadModels(), ...ex]); };

  // ---------- materials ----------
  const MAT = {}; L.MAT = MAT;
  const windMats = [];
  function addWind(mat, amount, freq) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = { value: 0 }; sh.uniforms.uWind = { value: amount };
      sh.vertexShader = 'uniform float uTime,uWind; varying float vViewZ;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vViewZ=-mvPosition.z;').replace('#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wp0=(instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
        #else
          vec3 wp0=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
        #endif
        float wph=wp0.x*.35+wp0.z*.27;
        float sway=sin(uTime*${freq.toFixed(2)}+wph)*uWind*clamp(position.y,0.,20.)*.06;
        transformed.x+=sway; transformed.z+=sway*.6;`);
      sh.fragmentShader = 'varying float vViewZ;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if(vViewZ<2.8){float dn=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);if(dn>vViewZ/2.8)discard;}');
      mat.userData.shader = sh; windMats.push(mat);
    };
    return mat;
  }
  L.addWind = addWind;
  L.tickWind = t => { for (const m of windMats) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t; };

  L.makeMaterials = function () {
    const std = o => new THREE.MeshStandardMaterial(Object.assign({ roughness: .9, metalness: 0 }, o));
    MAT.creature = std({ vertexColors: true, roughness: .75 });
    MAT.mage = std({ vertexColors: true, roughness: .8 });
    MAT.bark = std({ vertexColors: true, map: T.bark, normalMap: T.bark_n, normalScale: new THREE.Vector2(.7, .7) });
    MAT.canopy = addWind(std({ vertexColors: true, map: T.leaves, normalMap: T.leaves_n, normalScale: new THREE.Vector2(.5, .5), roughness: .95 }), 1.0, 1.1);
    MAT.canopyBig = addWind(std({ vertexColors: true, map: T.leaves, normalMap: T.leaves_n, normalScale: new THREE.Vector2(.5, .5), roughness: .95 }), .5, .7);
    MAT.stone = std({ vertexColors: true, map: T.stone, normalMap: T.stone_n, normalScale: new THREE.Vector2(.6, .6) });
    MAT.rock = std({ vertexColors: true, map: T.rockd, normalMap: T.rock_n, normalScale: new THREE.Vector2(.8, .8) });
    MAT.wood = std({ vertexColors: true, map: T.planks, normalMap: T.planks_n, normalScale: new THREE.Vector2(.6, .6), roughness: .85 });
    MAT.plain = std({ vertexColors: true });
    MAT.window = std({ vertexColors: true, emissive: 0xffb347, emissiveIntensity: 0 });
    MAT.lamp = std({ vertexColors: true, emissive: 0xffc46a, emissiveIntensity: .4 });
    MAT.mushCap = std({ vertexColors: true, emissive: 0x3fd0ff, emissiveIntensity: .2 });
    MAT.crystal = std({ vertexColors: true, emissive: 0x9a7cff, emissiveIntensity: .6, roughness: .3 });
    MAT.ore = std({ color: 0xe0a060, emissive: 0x6a3a10, emissiveIntensity: .35, metalness: .45, roughness: .32, flatShading: true });
    // v4 models: vertex-coloured, skinned variants for rigged meshes, emissive vertex colours for *_glow parts
    MAT.v4 = std({ vertexColors: true, roughness: .82 });
    MAT.v4skin = std({ vertexColors: true, roughness: .78, skinning: true });
    MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2), fog: false });
    MAT.glowSkin = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2), skinning: true, fog: false });
    MAT.pumpkin = std({ color: 0xff9a3a, emissive: 0xff7a1a, emissiveIntensity: .25, roughness: .6 });
    MAT.sprout = std({ color: 0x8fdc5a });
    MAT.leaf = std({ color: 0x5fbf45 });
  };

  // assign materials to a loaded model by node name; returns clone
  L.inst = function (name, matFor) {
    const src = M[name]; if (!src) return new THREE.Group();
    const g = src.clone(true);
    g.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true;
      o.material = (matFor && matFor(o.name, o)) || MAT.plain;
    });
    return g;
  };
  // Merge a model's meshes into one geometry (for instancing); returns {geo, mat}
  L.flatten = function (name, matFor) {
    const src = M[name]; const groups = {};
    src.updateMatrixWorld(true);
    src.traverse(o => {
      if (!o.isMesh) return;
      const key = (matFor && matFor(o.name)) || 'plain';
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      // y-up already; ensure color attr exists
      if (!g.attributes.color) { const n = g.attributes.position.count; g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
      if (!g.attributes.uv) { const n = g.attributes.position.count; g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2)); }
      if (g.attributes.color.itemSize === 4 || g.attributes.color.normalized) { const a = g.attributes.color, b = new Float32Array(a.count * 3); const sc = a.normalized ? (a.array instanceof Uint8Array ? 1 / 255 : a.array instanceof Uint16Array ? 1 / 65535 : 1) : 1; for (let i = 0; i < a.count; i++) { b[i * 3] = a.getX(i) * sc; b[i * 3 + 1] = a.getY(i) * sc; b[i * 3 + 2] = a.getZ(i) * sc; } g.setAttribute('color', new THREE.BufferAttribute(b, 3)); }
      (groups[key] = groups[key] || []).push(g);
    });
    const out = {};
    for (const k in groups) {
      const gs = groups[k].map(g => { const n = g.index ? g.toNonIndexed() : g; const keep = {}; for (const a of ['position', 'normal', 'uv', 'color']) if (n.attributes[a]) keep[a] = n.attributes[a]; const c = new THREE.BufferGeometry(); for (const a in keep) c.setAttribute(a, keep[a]); return c; });
      out[k] = THREE.BufferGeometryUtils.mergeBufferGeometries(gs, false);
    }
    return out;
  };

  // ---------- sky ----------
  const skyU = { top: { value: C(0x3d8bff) }, hor: { value: C(0xbfe3ff) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, moonDir: { value: new THREE.Vector3(0, -1, 0) }, night: { value: 0 }, uTime: { value: 0 }, tClouds: { value: null }, cloudCol: { value: C(0xffffff) }, cloudShade: { value: C(0x8899bb) }, dusk: { value: 0 } };
  L.skyU = skyU;
  L.makeSky = function () {
    skyU.tClouds.value = T.clouds;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: `varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform vec3 top,hor,sunDir,moonDir,cloudCol,cloudShade;uniform float night,uTime,dusk;uniform sampler2D tClouds;varying vec3 vD;
      void main(){float h=max(vD.y,0.);vec3 c=mix(hor,top,pow(h,.5));if(vD.y<0.)c=hor;
        vec3 sdir=normalize(sunDir);float s=max(dot(vD,sdir),0.);
        c+=vec3(1.,.9,.7)*(pow(s,1400.)*1.6+pow(s,28.)*.22)*(1.-night*.85);
        c+=vec3(1.,.55,.3)*pow(s,4.)*dusk*.5;
        vec3 mdir=normalize(moonDir);float m=max(dot(vD,mdir),0.);
        c+=vec3(.9,.93,1.)*(smoothstep(.9994,.9996,m)*1.5+pow(m,40.)*.2)*night;
        // clouds: two layers of scrolling texture projected on the dome
        if(vD.y>.02){vec2 p=vD.xz/(vD.y+.15);
          float c1=texture2D(tClouds,p*.09+vec2(uTime*.004,uTime*.002)).r;
          float c2=texture2D(tClouds,p*.21-vec2(uTime*.006,uTime*.003)).r;
          float cv=c1*.6+c2*.4;
          float cl=smoothstep(.775,.86,cv)*.85;
          float sh=smoothstep(.75,.84,cv);
          float fade=smoothstep(.02,.22,vD.y);
          vec3 cc=mix(cloudShade,cloudCol,sh);
          cc+=vec3(1.,.8,.6)*pow(s,8.)*.4*(1.-night);
          c=mix(c,cc,cl*fade*.95);}
        gl_FragColor=vec4(c,1.);
        #include <encodings_fragment>
        }`
    }));
    sky.renderOrder = -2; sky.frustumCulled = false; scene.add(sky); L.sky = sky;
    // stars
    const n = 1400, p = new Float32Array(n * 3), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, y = Math.abs(u) * .96 + .04, s = Math.sqrt(1 - y * y); p[i * 3] = Math.cos(a) * s * 1400; p[i * 3 + 1] = y * 1400; p[i * 3 + 2] = Math.sin(a) * s * 1400; sz[i] = 1 + Math.random() * 2; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(sz, 1));
    const stars = new THREE.Points(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms: { uA: { value: 0 }, uT: { value: 0 } },
      vertexShader: `attribute float aS;uniform float uT;varying float vA;void main(){vA=.6+.4*sin(uT*2.+position.x*.1+position.z*.13);gl_PointSize=aS*1.6;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform float uA;varying float vA;void main(){vec2 d=gl_PointCoord-.5;float a=smoothstep(.5,.1,length(d));gl_FragColor=vec4(.9,.95,1.,a*uA*vA);}` }));
    stars.frustumCulled = false; stars.renderOrder = -1; scene.add(stars); L.stars = stars;
  };

  // ---------- glow sprites & particles ----------
  function glowTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); }
  function heartTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#ff5f8f'; g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(4, 34, 10, 8, 32, 22); g.bezierCurveTo(54, 8, 60, 34, 32, 54); g.fill(); g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(22, 24, 5, 0, 7); g.fill(); return new THREE.CanvasTexture(c); }
  function leafTex() { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(16, 16, 6, 13, .6, 0, 7); g.fill(); return new THREE.CanvasTexture(c); }
  L.GLOW = glowTex(); L.HEART = heartTex(); L.LEAF = leafTex();
  L.glowSprite = function (color, size, op) { const m = new THREE.SpriteMaterial({ map: L.GLOW, color, transparent: true, opacity: op == null ? 1 : op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); const s = new THREE.Sprite(m); s.scale.set(size, size, 1); return s; };

  L.makeParticles = function (max, map, additive, soft) {
    const g = new THREE.BufferGeometry(); const P = new Float32Array(max * 3), Col = new Float32Array(max * 4), Sz = new Float32Array(max), Rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(Col, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(Sz, 1)); g.setAttribute('aRot', new THREE.BufferAttribute(Rot, 1));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uTex: { value: map }, uScale: { value: 400 } },
      vertexShader: `attribute vec4 aColor;attribute float aSize,aRot;uniform float uScale;varying vec4 vC;varying float vR;void main(){vC=aColor;vR=aRot;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uScale/-mv.z;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D uTex;varying vec4 vC;varying float vR;void main(){vec2 p=gl_PointCoord-.5;float c=cos(vR),s=sin(vR);p=vec2(c*p.x-s*p.y,s*p.x+c*p.y)+.5;vec4 t=texture2D(uTex,p);gl_FragColor=t*vC;if(gl_FragColor.a<.01)discard;}` });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
    const list = [];
    return {
      mat, list,
      emit(o) { if (list.length >= max) list.shift(); list.push(Object.assign({ vx: 0, vy: 0, vz: 0, g: 0, life: 1, age: 0, s0: .5, s1: .1, c: [1, 1, 1], a: 1, drag: 0, rot: 0, rv: 0 }, o)); },
      update(dt) {
        let n = 0;
        for (let i = list.length - 1; i >= 0; i--) { const p = list[i]; p.age += dt; if (p.age >= p.life) list.splice(i, 1); }
        for (const p of list) {
          p.vy -= p.g * dt; const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; p.vz *= d; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.rv * dt; const t = p.age / p.life;
          P[n * 3] = p.x; P[n * 3 + 1] = p.y; P[n * 3 + 2] = p.z; Col[n * 4] = p.c[0]; Col[n * 4 + 1] = p.c[1]; Col[n * 4 + 2] = p.c[2]; Col[n * 4 + 3] = p.a * Math.min(1, t * 6) * (1 - t); Sz[n] = lerp(p.s0, p.s1, t); Rot[n] = p.rot; n++;
        }
        g.setDrawRange(0, n); g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aRot.needsUpdate = true;
      }
    };
  };

  // text sprite
  L.textSprite = function (txt, size, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); g.font = '600 32px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 7; g.strokeStyle = 'rgba(10,12,30,.75)'; g.strokeText(txt, 128, 32); g.fillStyle = color || '#fff7e6'; g.fillText(txt, 128, 32);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false })); s.scale.set(size * 4, size, 1); s.renderOrder = 6; return s;
  };

  L.render = function () { if (L.cullCells) { camera.updateMatrixWorld(); L.cullCells(camera); } if (composer) composer.render(); else renderer.render(scene, camera); };
  resize();
})(window.L);
