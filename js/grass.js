/* Lumiar v5 grass and meadow flowers.
   World tiles of instanced clumps are generated a few rows per frame (time budget, LRU cache, no full flush),
   then packed nearest-first into ONE grass draw and ONE flower draw with a rank-based density LOD (far clumps
   thin out smoothly and widen to keep the carpet). Wind waves and the player push are applied in world space
   after the instance transform. Colour = L.terrainSample().c through the same palette patches as the terrain. */
'use strict';
(function (L) {
  const { clamp, sstep } = L;
  const TAU = Math.PI * 2;
  const hsh = (i, j, k) => { let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k + 1, 83492791)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const TS = 16, SG = 2, LN = TS / SG + 1;            // tile size (m), lattice step (m), lattice points per side

  // per region (R1..R16): [tall fields, dry/golden, flowers, height]
  const REG = [
    [.45, .05, 1.0, 1.0], [.4, .45, .7, 1.0], [.1, .15, .5, .7], [.5, .0, .6, 1.1], [.3, .05, .6, 1.0], [.2, .1, .5, .9],
    [.25, .1, .6, .9], [.1, .0, .2, .8], [.3, .05, .8, .9], [.25, .1, .4, .9], [.3, .0, .6, .9], [.05, .55, .1, .7],
    [.05, .15, .3, .6], [.9, .7, .3, 1.15], [.2, .2, .8, .75], [.3, .1, .5, .9]];
  L.GRASS_REG = REG;
  const GOLD = [.62, .5, .2];                           // linear golden-dry tint

  // ---------------------------------------------------------------- uniforms (shared by grass + flowers)
  const GU = L.grassU = {
    uTime: L.uTime, uPlayer: L.uPlayer,
    uWind: { value: new THREE.Vector4(.8, .6, .55, 1.25) },   // dir xz, strength, wave speed
    uLod: { value: new THREE.Vector4(13, 36, 1.3, 0) },        // full-density distance, radius, flower radius mul, -
  };
  L.grassWind = function (dx, dz, strength) { const l = Math.hypot(dx, dz) || 1; GU.uWind.value.x = dx / l; GU.uWind.value.y = dz / l; if (strength != null) GU.uWind.value.z = strength; };

  const COMMON = `
attribute vec4 iP;
uniform float uTime; uniform vec3 uPlayer; uniform vec4 uWind; uniform vec4 uLod; uniform vec4 hzP;
float v5gLod(vec3 p, float rk, float R, out float cmp, out float camd) {
  camd = distance(p, hzP.xyz);
  float f = clamp(uLod.x * uLod.x / max(camd * camd, 1.), 0., 1.) * smoothstep(R, R * .72, camd);
  cmp = clamp(inversesqrt(max(f, .02)), 1., 2.8);
  return clamp((f * 1.1 - rk) / .1, 0., 1.) * smoothstep(.3, 1.2, camd);
}
vec2 v5gWind(vec2 xz, float rnd, out float wave) {
  vec2 wd = uWind.xy;
  float big = sin(dot(xz, wd) * .11 - uTime * uWind.w) * .5 + .5;
  float g2 = sin(dot(xz, vec2(.037, -.021)) - uTime * .53) * sin(dot(xz, vec2(.018, .041)) + uTime * .31);
  wave = clamp(big * (.62 + .38 * g2), 0., 1.);
  float fl = sin(uTime * 3.7 + rnd * 6.28 + xz.x * .7 + xz.y * .3) * .07;
  return wd * (uWind.z * (.15 + .7 * wave) + fl) + vec2(-wd.y, wd.x) * fl * .6;
}
vec2 v5gPush(vec2 xz, float y) {
  vec2 dp = xz - uPlayer.xz; float pd = length(dp);
  return dp / max(pd, .05) * smoothstep(1.3, .25, pd) * step(abs(uPlayer.y - y), 2.5) * 1.15;
}
`;
  const GRASS_VERT = `
  float cmp, camd; float vis = v5gLod(iP.xyz, iP.w, uLod.y, cmp, camd);
  float rot = iN.z * 6.2832; float cr = cos(rot), sr = sin(rot);
  vec2 root = vec2(cr * position.x - sr * position.z, sr * position.x + cr * position.z) * mix(1., cmp, .6);
  float H = iC.w * 1.25 * aB.z * vis;
  float t = position.y;
  float a = aB.y + rot; vec2 wdir = vec2(cos(a), sin(a)); vec2 ldir = vec2(-wdir.y, wdir.x);
  float lean = (aB.w - .5) * .8;
  float wid = .024 * mix(1., cmp, .9) * pow(max(1. - t, 0.), .75) * aB.x * step(.001, vis) * (1. + .3 * (1. - smoothstep(8., 14., camd)));   // fuller carpet up close
  vec3 gP = vec3(iP.x + root.x, iP.y, iP.z + root.y);
  float wave; vec2 bend = v5gWind(gP.xz, aB.w, wave) + v5gPush(gP.xz, gP.y);
  float bl = min(length(bend), 1.2);
  vec2 off = wdir * wid + (ldir * lean + bend) * H * t * t;
  gP += vec3(off.x, H * t * (1. - .3 * bl * bl * t - .12 * lean * lean), off.y);
  vec3 gN = vec3(iN.x * 2. - 1., 0., iN.y * 2. - 1.); gN.y = sqrt(max(1. - dot(gN.xz, gN.xz), .04));
  vec3 objectNormal = normalize(gN + vec3(bend.x, 0., bend.y) * .5 + vec3(ldir.x, 0., ldir.y) * lean * .25);
  // close up (edge-on views): a deep, saturated green carpet (GDD #2c440b roots, #3a5311 bodies) with warm, lighter
  // tips in the ground tint; further out the blades fade to the ground tint so the ring edge never shows
  vec3 bc = iC.rgb * iC.rgb;
  float nearK = (1. - smoothstep(5., uLod.x * 1.8, camd)) * (1. - smoothstep(.65, 1.4, (hzP.y - iP.y) / max(camd, .1)));   // not in steep top-down views
  float jit = .88 + .24 * aB.w;
  vec3 bg = bc * vec3(.6, 1., .5);                                                // the ground tint pushed toward green
  vec3 gRoot = mix(bg * .3, vec3(.022, .05, .004), .78) * jit;
  vec3 gMid = mix(bg * .32, vec3(.042, .087, .006), .72) * jit;
  vec3 gTip = mix(bg * 1.05, vec3(.17, .3, .035), .4) * jit;                     // lighter, warmer tips, still green
  vec3 nearC = mix(mix(gRoot, gMid, smoothstep(0., .55, t)), gTip, pow(smoothstep(.55, 1., t), 1.6));
  vec3 farC = mix(bc * .84, bc * (.9 + .2 * aB.w), smoothstep(.02, 1., t));
  vColor = mix(farC, nearC, nearK) * (1. + .16 * wave * t);
  vGFar = camd;
`;
  const FLOWER_VERT = `
  float cmp, camd; float vis = v5gLod(iP.xyz, iP.w, uLod.y * uLod.z, cmp, camd);
  float k = floor(iF.x * 255. + .5);
  float kH = k < .5 ? .62 : k < 1.5 ? .86 : k < 2.5 ? .44 : .46;
  float S = kH * (.75 + iF.y * .6) * vis * mix(1., cmp, .55);
  float rot = iF.z * 6.2832; float cr = cos(rot), sr = sin(rot);
  vec2 lp = vec2(cr * position.x - sr * position.z, sr * position.x + cr * position.z) * S * .5;
  float t = position.y;
  vec3 gP = vec3(iP.x + lp.x, iP.y + t * S, iP.z + lp.y);
  float wave; vec2 bend = v5gWind(iP.xz, iF.w, wave) + v5gPush(iP.xz, iP.y);
  gP.xz += bend * S * t * t * .8;
  gP.y -= dot(bend, bend) * S * t * .18;
  vec3 objectNormal = vec3(0., 1., 0.);
  vUv = vec2((k + uv.x) * .25, uv.y);
  vColor = vec3(.92 + iF.w * .16);
  vTint = iT.rgb * 2.;
  vGFar = camd;
`;

  function patchVS(sh, attrs, body) {
    for (const k in GU) sh.uniforms[k] = GU[k];
    sh.vertexShader = attrs + COMMON + 'varying float vGFar;\n' + sh.vertexShader
      .replace('#include <color_vertex>', '')
      .replace('#include <beginnormal_vertex>', body)
      .replace('#include <begin_vertex>', 'vec3 transformed = gP;');
  }
  function frontOnly(mat, key) {
    // blades and cards shade the same on both faces (normals follow the ground)
    const so = mat.onBeforeCompile; const k = mat.customProgramCacheKey();
    mat.onBeforeCompile = function (sh, r) { so.call(this, sh, r); sh.fragmentShader = sh.fragmentShader.replace(/gl_FrontFacing/g, 'true'); };
    mat.customProgramCacheKey = () => k + '|' + key;
    return mat;
  }
  function makeGrassMat() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      patchVS(sh, 'attribute vec4 aB; attribute vec4 iC; attribute vec4 iN;\n', GRASS_VERT);
      sh.fragmentShader = 'varying float vGFar;\n' + sh.fragmentShader;
    };
    mat.customProgramCacheKey = () => 'grass-v5';
    L.stylize(mat, { wrap: .55, rim: .22, transl: .35, fill: .78 });   // less sky fill: the carpet stays saturated
    return frontOnly(mat, 'ff');
  }
  function makeFlowerMat(map) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map, alphaTest: .5, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      patchVS(sh, 'attribute vec4 iF; attribute vec4 iT; varying vec3 vTint;\n', FLOWER_VERT);
      // far cards: mip-mapped alpha fades below the test, so boost it with distance; petals (not the green stems and
      // leaves) take the per-flower tint of the region palette
      sh.fragmentShader = 'varying float vGFar; varying vec3 vTint;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>',
        'diffuseColor.a = clamp(diffuseColor.a * (1. + clamp((vGFar - 5.) / 14., 0., 2.2)), 0., 1.);\n#include <alphatest_fragment>')
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= mix(vTint, vec3(1.), smoothstep(.01, .08, diffuseColor.g - max(diffuseColor.r, diffuseColor.b)));');
    };
    mat.customProgramCacheKey = () => 'flowers-v5';
    L.stylize(mat, { wrap: .6, rim: .15, transl: .3 });
    return frontOnly(mat, 'ff');
  }

  // ---------------------------------------------------------------- flower atlas: poppy, lupine, daisy, buttercup
  function flowerAtlas() {
    const W = 1024, H = 512, CW = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const r = L.rnd(733);
    const stem = (x0, y0, x1, y1, w, col) => { g.strokeStyle = col || '#3f7a2c'; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 + (x1 - x0) * .2 + (r() - .5) * 18, (y0 + y1) / 2, x1, y1); g.stroke(); };
    const leaf = (x, y, l, w, a, col) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(w, -l * .5, 0, -l); g.quadraticCurveTo(-w, -l * .5, 0, 0); g.fill(); g.restore(); };
    const baseLeaves = (ox, n) => { for (let i = 0; i < n; i++) { const x = ox + 60 + r() * 136, a = (r() - .5) * 1.5; leaf(x, H - 2, 50 + r() * 60, 9 + r() * 6, a, `hsl(${92 + r() * 22},${42 + r() * 14}%,${30 + r() * 12}%)`); } };
    // 0 poppies: red cups with dark centres on thin hairy stems
    {
      const ox = 0; baseLeaves(ox, 7);
      const heads = [[ox + 92, 110, 46], [ox + 170, 190, 40], [ox + 118, 262, 34]];
      for (const [x, y, s] of heads) stem(x + (r() - .5) * 30, H, x, y + s * .3, 5, '#4b7f30');
      for (const [x, y, s] of heads) {
        for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + .4; g.fillStyle = k % 2 ? '#c8261a' : '#de3a22'; g.beginPath(); g.ellipse(x + Math.cos(a) * s * .38, y + Math.sin(a) * s * .3, s * .55, s * .45, a, 0, TAU); g.fill(); }
        const gr = g.createRadialGradient(x - s * .2, y - s * .25, s * .05, x, y, s * .8); gr.addColorStop(0, 'rgba(255,140,90,.55)'); gr.addColorStop(1, 'rgba(255,120,80,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, s * .8, 0, TAU); g.fill();
        g.fillStyle = '#26170f'; g.beginPath(); g.arc(x, y, s * .2, 0, TAU); g.fill();
        g.fillStyle = '#5c4a22'; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; g.beginPath(); g.arc(x + Math.cos(a) * s * .24, y + Math.sin(a) * s * .24, 2.6, 0, TAU); g.fill(); }
      }
    }
    // 1 lupine: a tapering spike of blue-violet florets over palmate leaves
    {
      const ox = CW; baseLeaves(ox, 4);
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * .42; leaf(ox + 128, H - 70, 70, 11, a + Math.PI / 2, i % 2 ? '#3f7a34' : '#4c8a3c'); }
      stem(ox + 128, H, ox + 128, 70, 7, '#457a34');
      const top = 40, bot = 330;
      for (let y = bot; y > top; y -= 7) {
        const f = (y - top) / (bot - top); const w = 18 + f * 34; const n = 3 + Math.floor(f * 3);
        for (let k = 0; k < n; k++) {
          const x = ox + 128 + (k / (n - 1 || 1) - .5) * w * 2 + (r() - .5) * 6; const lt = 1 - f;
          const col = r() < .25 ? '#e8e6ff' : `hsl(${232 + r() * 16},${58 + r() * 14}%,${40 + lt * 26 + r() * 8}%)`;
          g.fillStyle = col; g.beginPath(); g.ellipse(x, y + (r() - .5) * 4, 9 + f * 5, 7 + f * 3, (r() - .5) * .6, 0, TAU); g.fill();
        }
      }
    }
    // 2 daisies: white rays, yellow centres
    {
      const ox = CW * 2; baseLeaves(ox, 8);
      const heads = [[ox + 76, 250, 30], [ox + 150, 180, 34], [ox + 196, 300, 26], [ox + 112, 340, 24]];
      for (const [x, y] of heads) stem(x + (r() - .5) * 26, H, x, y + 6, 4, '#4f8a35');
      for (const [x, y, s] of heads) {
        const n = 13; for (let k = 0; k < n; k++) { const a = k / n * TAU + r() * .2; g.fillStyle = k % 3 ? '#fbfaf2' : '#eceadf'; g.beginPath(); g.ellipse(x + Math.cos(a) * s * .55, y + Math.sin(a) * s * .42, s * .48, s * .14, a, 0, TAU); g.fill(); }
        g.fillStyle = '#f2b81c'; g.beginPath(); g.arc(x, y, s * .26, 0, TAU); g.fill(); g.fillStyle = '#ffd94a'; g.beginPath(); g.arc(x - s * .06, y - s * .07, s * .14, 0, TAU); g.fill();
      }
    }
    // 3 buttercups: small glossy yellow cups
    {
      const ox = CW * 3; baseLeaves(ox, 8);
      const heads = []; for (let i = 0; i < 6; i++) heads.push([ox + 50 + r() * 156, 160 + r() * 210, 18 + r() * 8]);
      for (const [x, y] of heads) stem(x + (r() - .5) * 30, H, x, y + 4, 3.5, '#4f8a35');
      for (const [x, y, s] of heads) {
        for (let k = 0; k < 5; k++) { const a = k / 5 * TAU - Math.PI / 2; g.fillStyle = k % 2 ? '#f6c919' : '#ffd92e'; g.beginPath(); g.ellipse(x + Math.cos(a) * s * .45, y + Math.sin(a) * s * .38, s * .46, s * .36, a, 0, TAU); g.fill(); }
        g.fillStyle = 'rgba(255,255,220,.8)'; g.beginPath(); g.arc(x - s * .2, y - s * .2, s * .14, 0, TAU); g.fill();
        g.fillStyle = '#c98d12'; g.beginPath(); g.arc(x, y, s * .16, 0, TAU); g.fill();
      }
    }
    const t = L.bleedTexture(c, 4, 1); t.anisotropy = 2; L._flowerCanvas = c; return t;
  }

  // ---------------------------------------------------------------- geometry
  function bladeGeo(blades, spread) {
    const r = L.rnd(97), P = [], B = [], I = [];
    for (let b = 0; b < blades; b++) {
      const a = r() * TAU, d = Math.sqrt(r()) * spread, bx = Math.cos(a) * d, bz = Math.sin(a) * d;
      const face = r() * TAU, hf = .62 + r() * .55, rn = r(); const v0 = P.length / 3;
      // base L/R, mid L/R, tip
      for (const [side, t] of [[-1, 0], [1, 0], [-1, .5], [1, .5], [0, 1]]) { P.push(bx, t, bz); B.push(side, face, hf, rn); }
      I.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 4));
    g.setIndex(I); return g;
  }
  function cardGeo() {
    const P = [], U = [], I = [];
    for (let q = 0; q < 2; q++) {
      const v0 = P.length / 3; const cx = q ? 0 : 1, cz = q ? 1 : 0;
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { P.push((u - .5) * cx, v, (u - .5) * cz); U.push(u, v); }
      I.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); return g;
  }
  function instAttr(geo, name, arr, size, norm) { const a = new THREE.InstancedBufferAttribute(arr, size, !!norm); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; }

  // ---------------------------------------------------------------- state
  let G = null;
  const tiles = new Map();            // tile id -> tile {i, j, n, P, C, N, nf, FP, FA, FT, y0, y1, used}
  const tid = (i, j) => (i + 32768) * 65536 + (j + 32768);
  const TSAMP = {};
  L.grassStats = { tiles: 0, built: 0, clumps: 0, flowers: 0, tris: 0, packMs: 0, buildMs: 0 };

  function sampleT(x, z) {
    const P = L.terrainSample(x, z, TSAMP);
    if (P.meadow === undefined) { // v4 terrain: weights w = [grass+mud, forest, rock, sand, snow], biome blend B
      const w = P.w || [1, 0, 0, 0, 0]; P.meadow = w[0]; P.forest = w[1]; P.rock = w[2]; P.sand = w[3]; P.snow = w[4]; P.path = P.path || 0; P.wet = 0;
      const B = P.B; P._tall = B ? clamp((B.planicie || 0) * 1.4 + (B.canion || 0) * .6 + (B.pantano || 0) * .5, 0, 1) : 0; P._dry = B ? clamp((B.planicie || 0) * .4, 0, 1) : 0; P._fl = B ? 1 - (B.pinho || 0) * .6 - (B.montes || 0) * .3 : 1; P._hm = 1;
    } else { const R = REG[P.region | 0] || REG[0]; P._tall = R[0]; P._dry = R[1]; P._fl = R[2]; P._hm = R[3]; }
    return P;
  }
  // same palette patches as the terrain shader (terramat v5Meadow), so blades match the ground under them
  const pal = [0, 0, 0], pA = [0, 0, 0], pB = [0, 0, 0];
  const mixP = (o, P, i, t) => { const v = P[i]; o[0] += (v.x - o[0]) * t; o[1] += (v.y - o[1]) * t; o[2] += (v.z - o[2]) * t; };
  const setP = (o, P, i) => { const v = P[i]; o[0] = v.x; o[1] = v.y; o[2] = v.z; };
  function meadowColor(x, z, r, g, b) {
    const TU = L.terrainU; const A = TU ? TU.uAlbedo.value : .74; r *= A; g *= A; b *= A;
    if (TU && L.noise2) {
      const n1r = L.noise2(x / 900, z / 900, 0), n1g = L.noise2(x / 900, z / 900, 1);
      const u2 = x / 140 + .5, v2 = z / 140 + .5, n2r = L.noise2(u2, v2, 0), n2g = L.noise2(u2, v2, 1), n2a = L.noise2(u2, v2, 3);
      const Pl = TU.uPal.value, M = TU.uPalMean.value, k = TU.uPatch.value;
      setP(pA, Pl, 2); mixP(pA, Pl, 0, sstep(.2, .62, n1g)); mixP(pA, Pl, 1, sstep(.5, .85, n2r));
      setP(pB, Pl, 6); mixP(pB, Pl, 3, sstep(.25, .7, n1g)); mixP(pB, Pl, 4, sstep(.45, .8, n2r)); mixP(pB, Pl, 5, sstep(.62, .9, n2g) * .6);
      const t = sstep(.36, .64, n1r); pal[0] = pA[0] + (pB[0] - pA[0]) * t; pal[1] = pA[1] + (pB[1] - pA[1]) * t; pal[2] = pA[2] + (pB[2] - pA[2]) * t;
      const d = 1 + (n2a - .5) * .12;
      const lb = .2126 * r + .7152 * g + .0722 * b, lp = Math.max(.2126 * pal[0] + .7152 * pal[1] + .0722 * pal[2], 1e-3), sc = lb / lp;   // = terramat v5Meadow
      r = (r + (pal[0] * sc - r) * k) * d; g = (g + (pal[1] * sc - g) * k) * d; b = (b + (pal[2] * sc - b) * k) * d;
    }
    pal[0] = r; pal[1] = g; pal[2] = b; return pal;
  }

  // ---------------------------------------------------------------- tile generation (resumable, row by row)
  const LAT = new Float32Array(LN * LN * 12);   // per lattice point: keep, tall, flw, r, g, b, nx, nz, hmul, height
  let cur = null;                               // tile in progress
  const tmpG = { P: null, C: null, N: null, R: null }, tmpF = { P: null, A: null, T: null, R: null };
  function scratch() {
    const m = Math.ceil(TS / G.sp) + 2, mf = Math.ceil(TS / G.fsp) + 2;
    tmpG.P = new Float32Array(m * m * 4); tmpG.C = new Uint8Array(m * m * 4); tmpG.N = new Uint8Array(m * m * 4); tmpG.R = new Float32Array(m * m);
    tmpF.P = new Float32Array(mf * mf * 4); tmpF.A = new Uint8Array(mf * mf * 4); tmpF.T = new Uint8Array(mf * mf * 4); tmpF.R = new Float32Array(mf * mf);
  }
  function startTile(i, j) { cur = { i, j, phase: 0, row: 0, col: 0, n: 0, nf: 0, y0: 1e9, y1: -1e9 }; }
  function latticeRow(T, b, a0, a1) {
    const x0 = T.i * TS, z0 = T.j * TS, z = z0 + b * SG;
    for (let a = a0; a < a1; a++) {
      const x = x0 + a * SG, o = (b * LN + a) * 12; const P = sampleT(x, z);
      const sl = P.sl || 0;
      const keep = clamp(P.meadow * 1.05 + P.forest * .3 - P.rock * 1.1 - P.sand * 1.0 - P.snow * 1.1 - (P.path || 0) * 1.3, 0, 1) * sstep(1.05, .8, sl);
      const tallN = sstep(.48, .74, L.noise2 ? L.noise2(x / 330 + .21, z / 330 + .67, 1) : .5);
      const tall = clamp(P._tall * .6 + tallN * (.3 + P._tall * .7), 0, 1);
      const c = meadowColor(x, z, P.c[0], P.c[1], P.c[2]);
      let r = c[0], g = c[1], bb = c[2];
      const dry = clamp(P._dry * (.5 + tall * .6), 0, .8); r += (GOLD[0] * .74 - r) * dry * .45; g += (GOLD[1] * .74 - g) * dry * .45; bb += (GOLD[2] * .74 - bb) * dry * .45;
      // ground normal from the height field
      const e = 1, hx = L.ground(x + e, z) - L.ground(x - e, z), hz = L.ground(x, z + e) - L.ground(x, z - e), il = 1 / Math.sqrt(hx * hx + hz * hz + 4 * e * e);
      LAT[o] = keep; LAT[o + 1] = tall; LAT[o + 2] = clamp(P.meadow * (1 - (P.path || 0)) * (1 - P.forest * .85) * sstep(.75, .4, sl), 0, 1) * P._fl;
      LAT[o + 3] = r; LAT[o + 4] = g; LAT[o + 5] = bb; LAT[o + 6] = -hx * il; LAT[o + 7] = -hz * il; LAT[o + 8] = P._hm * (1 + sstep(.2, .6, P.wet || 0) * .15); LAT[o + 9] = P.h != null ? P.h : L.ground(x, z);
    }
  }
  const LI = new Float32Array(12);
  function lat(x, z, T) {   // bilinear lattice lookup into LI
    const fx = clamp((x - T.i * TS) / SG, 0, LN - 1.001), fz = clamp((z - T.j * TS) / SG, 0, LN - 1.001);
    const a = Math.floor(fx), b = Math.floor(fz), u = fx - a, v = fz - b;
    const o00 = (b * LN + a) * 12, o10 = o00 + 12, o01 = o00 + LN * 12, o11 = o01 + 12;
    for (let k = 0; k < 10; k++) { const p = LAT[o00 + k], q = LAT[o10 + k], s = LAT[o01 + k], w = LAT[o11 + k]; LI[k] = p + (q - p) * u + (s - p) * v + (p - q - s + w) * u * v; }
    return LI;
  }
  const u8 = v => clamp(Math.round(v * 255), 0, 255);
  function waterHere(x, z, h) {
    if (L.waterAt) return L.waterAt(x, z) > h - .12;
    return h < .35 || (L.distRiver && L.distRiver(x, z) < 1.6);
  }
  function clumpRow(T, cj, c0, c1) {
    const sp = G.sp, x0 = T.i * TS, z0 = T.j * TS;
    const gi0 = Math.floor(x0 / sp), gj = Math.floor(z0 / sp) + cj;
    for (let gi = gi0 + c0; gi < gi0 + c1; gi++) {
      const x = (gi + hsh(gi, gj, 0)) * sp, z = (gj + hsh(gi, gj, 1)) * sp;
      if (x < x0 || x >= x0 + TS || z < z0 || z >= z0 + TS) continue;
      const Lr = lat(x, z, T); if (hsh(gi, gj, 2) >= Lr[0]) continue;
      const h = L.ground(x, z);
      if (waterHere(x, z, h) || (L.noGrass && L.noGrass(x, z)) || (L.pointInSolid && L.pointInSolid(x, h + .05, z))) continue;
      // near-camera ground detail of the terrain shader, so the blades carry the same mottling
      let det = 1; if (L.noise2) { const nda = L.noise2(x / 7, z / 7, 3), ndg = L.noise2(x / 7, z / 7, 1); det = 1 + ((nda - .5) * .9 + (ndg - .5) * .5) * .22; }
      const tall = Lr[1]; const hgt = (.24 + .5 * tall * tall + .12 * tall) * Lr[8] * (.78 + hsh(gi, gj, 3) * .44);
      const n = T.n, o = n * 4;
      tmpG.P[o] = x; tmpG.P[o + 1] = h - .03; tmpG.P[o + 2] = z; tmpG.P[o + 3] = hsh(gi, gj, 4); tmpG.R[n] = tmpG.P[o + 3];
      const jit = .94 + hsh(gi, gj, 5) * .12;
      tmpG.C[o] = u8(Math.sqrt(clamp(Lr[3] * det * jit, 0, 1))); tmpG.C[o + 1] = u8(Math.sqrt(clamp(Lr[4] * det * jit, 0, 1))); tmpG.C[o + 2] = u8(Math.sqrt(clamp(Lr[5] * det, 0, 1))); tmpG.C[o + 3] = u8(hgt / 1.25);
      tmpG.N[o] = u8(Lr[6] * .5 + .5); tmpG.N[o + 1] = u8(Lr[7] * .5 + .5); tmpG.N[o + 2] = u8(hsh(gi, gj, 6)); tmpG.N[o + 3] = 0;
      T.n++; if (h < T.y0) T.y0 = h; if (h + hgt * 1.3 > T.y1) T.y1 = h + hgt * 1.3;
    }
  }
  // Region flower palettes (L.flowerHint(x, z, out) -> {d, pal:[0xRRGGBB...]}): each colour maps to the atlas kind
  // whose shape fits it (red/orange -> poppy, blue/violet -> lupine, yellow -> buttercup, white/pink/pale -> daisy) plus
  // a petal tint (target / atlas colour, linear). Cached per palette array.
  const KREF = [[.73, .042, .016], [.11, .15, .67], [.96, .955, .89], [1, .69, .027]];   // atlas petal colours, linear
  const lin = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
  const PALK = new WeakMap();
  function palKinds(pal) {
    let o = PALK.get(pal); if (o) return o; o = [];
    for (const hex of pal) {
      const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
      let hue = 0; if (mx > mn) { hue = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; hue *= 60; }
      const kind = sat < .2 ? 2 : (hue >= 345 || hue < 35) && sat > .45 ? 0 : hue >= 35 && hue < 80 ? 3 : hue >= 170 && hue < 290 ? 1 : 2;
      const K = KREF[kind], t = [lin(r) / K[0], lin(g) / K[1], lin(b) / K[2]].map(v => clamp(v, 0, 2));
      o.push({ kind, t: t.map(v => u8(v * .5)) });
    }
    PALK.set(pal, o); return o;
  }
  const FH = { d: 1, pal: null }, PW = new Float32Array(8), DEF_T = [128, 128, 128];
  function flowerRow(T, cj, c0, c1) {
    const sp = G.fsp, x0 = T.i * TS, z0 = T.j * TS;
    const gi0 = Math.floor(x0 / sp), gj = Math.floor(z0 / sp) + cj;
    const N2 = L.noise2 || (() => .5);
    for (let gi = gi0 + c0; gi < gi0 + c1; gi++) {
      const x = (gi + hsh(gi, gj, 10)) * sp, z = (gj + hsh(gi, gj, 11)) * sp;
      if (x < x0 || x >= x0 + TS || z < z0 || z >= z0 + TS) continue;
      const Lr = lat(x, z, T); let suit = Lr[2] * G.flowerMul; if (suit <= .02) continue;
      let pal = null;
      if (L.flowerHint) {   // WORLD: {d, pal}; a plain number is accepted too
        FH.d = 1; FH.pal = null; const fh = L.flowerHint(x, z, FH);
        const fd = typeof fh === 'number' ? fh : fh && fh.d; suit *= isFinite(fd) ? clamp(fd, 0, 4) : 1;
        if (fh && typeof fh === 'object' && Array.isArray(fh.pal) && fh.pal.length) pal = palKinds(fh.pal);
        if (suit <= .02) continue;
      }
      // patches: each colour (palette entry, or the default four kinds) owns its own large noise field
      const nk = pal ? Math.min(pal.length, 8) : 4; let tot = 0;
      for (let k = 0; k < nk; k++) {
        const w = !pal && k === 3 ? .07 : sstep(.56, .74, N2(x / (230 - 20 * k) + .37 * k, z / (230 - 20 * k) + .11 + .21 * k, 1)) + (pal ? .07 / nk : 0);
        PW[k] = w; tot += w;
      }
      const p = Math.min(.7, tot * .62 * (pal ? 3 / Math.max(nk, 2) : 1)) * suit;   // a palette of any length keeps the default density
      if (hsh(gi, gj, 12) >= p) continue;
      let pick = hsh(gi, gj, 13) * tot, sel = nk - 1; for (let k = 0; k < nk; k++) if ((pick -= PW[k]) < 0) { sel = k; break; }
      const kind = pal ? pal[sel].kind : sel, tint = pal ? pal[sel].t : DEF_T;
      const h = Lr[9];   // lattice height (bilinear, 2 m): no second terrain query per flower
      if (waterHere(x, z, h) || (L.noGrass && L.noGrass(x, z)) || (L.pointInSolid && L.pointInSolid(x, h + .05, z))) continue;
      const n = T.nf, o = n * 4;
      tmpF.P[o] = x; tmpF.P[o + 1] = h - .04; tmpF.P[o + 2] = z; tmpF.P[o + 3] = hsh(gi, gj, 14); tmpF.R[n] = tmpF.P[o + 3];
      tmpF.A[o] = kind; tmpF.A[o + 1] = u8(hsh(gi, gj, 15)); tmpF.A[o + 2] = u8(hsh(gi, gj, 16)); tmpF.A[o + 3] = u8(hsh(gi, gj, 17));
      tmpF.T[o] = tint[0]; tmpF.T[o + 1] = tint[1]; tmpF.T[o + 2] = tint[2]; tmpF.T[o + 3] = 0;
      T.nf++; if (h + 1 > T.y1) T.y1 = h + 1; if (h < T.y0) T.y0 = h;
    }
  }
  // Tile buffers come from a pool of power-of-two typed arrays and go back to it when a tile is evicted or invalidated,
  // so walking around does not feed the garbage collector.
  const POOL = new Map();
  function take(Ctor, len) { const cap = Math.max(64, 1 << Math.ceil(Math.log2(Math.max(len, 1)))), k = Ctor.name + cap, l = POOL.get(k); return l && l.length ? l.pop() : new Ctor(cap); }
  function give(a) { if (!a) return; const k = a.constructor.name + a.length; let l = POOL.get(k); if (!l) POOL.set(k, l = []); if (l.length < 48) l.push(a); }
  function freeTile(t) { give(t.P); give(t.C); give(t.N); give(t.FP); give(t.FA); give(t.FT); }
  const ORD = [];
  const byR = (a, b) => ORD.R[a] - ORD.R[b];
  function sortInto(n, R, src, dst, sz) { for (let k = 0; k < n; k++) { const f = ORD[k] * sz, t = k * sz; for (let c = 0; c < sz; c++) dst[t + c] = src[f + c]; } return dst; }
  function order(n, R) { ORD.length = n; for (let k = 0; k < n; k++) ORD[k] = k; ORD.R = R; ORD.sort(byR); }
  function finishTile(T) {
    const n = T.n, nf = T.nf;
    order(n, tmpG.R);
    const P = sortInto(n, null, tmpG.P, take(Float32Array, n * 4), 4), Cc = sortInto(n, null, tmpG.C, take(Uint8Array, n * 4), 4), N = sortInto(n, null, tmpG.N, take(Uint8Array, n * 4), 4);
    order(nf, tmpF.R);
    const FP = sortInto(nf, null, tmpF.P, take(Float32Array, nf * 4), 4), FA = sortInto(nf, null, tmpF.A, take(Uint8Array, nf * 4), 4), FT = sortInto(nf, null, tmpF.T, take(Uint8Array, nf * 4), 4);
    const old = tiles.get(tid(T.i, T.j)); if (old) freeTile(old);
    const tile = { i: T.i, j: T.j, n, P, C: Cc, N, nf, FP, FA, FT, y0: T.y0 === 1e9 ? 0 : T.y0, y1: T.y1 === -1e9 ? 1 : T.y1, used: G.frame };
    tiles.set(tid(T.i, T.j), tile); L.grassStats.built++; G.dirty = true;
  }
  // One small unit of work on the tile in progress (at most CH lattice points or candidates); returns true when the tile
  // is done. The caller checks its time budget after every unit, so a slow terrain query cannot blow the frame.
  const CH = 8;
  function stepTile() {
    const T = cur;
    if (T.phase === 0) { const a1 = Math.min(T.col + CH, LN); latticeRow(T, T.row, T.col, a1); T.col = a1; if (T.col >= LN) { T.col = 0; if (++T.row >= LN) { T.phase = 1; T.row = 0; } } return false; }
    if (T.phase === 1) { const W = Math.floor((T.i * TS + TS) / G.sp) - Math.floor(T.i * TS / G.sp) + 1, c1 = Math.min(T.col + CH * 2, W); clumpRow(T, T.row, T.col, c1); T.col = c1; if (T.col >= W) { T.col = 0; if (++T.row > Math.ceil(TS / G.sp)) { T.phase = 2; T.row = 0; } } return false; }
    if (T.phase === 2) { const W = Math.floor((T.i * TS + TS) / G.fsp) - Math.floor(T.i * TS / G.fsp) + 1, c1 = Math.min(T.col + CH * 2, W); flowerRow(T, T.row, T.col, c1); T.col = c1; if (T.col >= W) { T.col = 0; if (++T.row > Math.ceil(TS / G.fsp)) T.phase = 3; } return false; }
    finishTile(T); cur = null; return true;
  }

  // ---------------------------------------------------------------- init
  L.grassInit = function () {
    const Q = L.Q();
    const R = Q.grassR, sp = Q.grassSp, full = Q.grassFull || R * .36;
    G = { R, sp, fsp: .62 / Math.sqrt(Math.max(.2, Q.flowerMul)), flowerMul: 1, full, frame: 0, dirty: true, budget: Q.name === 'alto' ? 2.5 : Q.name === 'baixo' ? 1.0 : 1.5,
      cx: 1e9, cz: 1e9, cy: 0, fx: 0, fz: 0, fy: 0, fov: 0 };
    GU.uLod.value.set(full, R, 1.3, 0);
    if (L.terrainU && L.terrainU.uGrass) L.terrainU.uGrass.value.set(full, R, .8, 1);   // the terrain darkens the soil under the carpet
    scratch();
    const blades = Q.grassBlades;
    G.trisPer = blades * 3;
    G.capG = Math.max(500, Math.floor((Q.grassMaxTris - 8) / (G.trisPer + 1.2)));   // grass + flower cards (capF = .3 capG, 4 tris) stay in budget
    G.capF = Math.ceil(G.capG * .3);
    const gg = bladeGeo(blades, sp * .44);
    G.gP = instAttr(gg, 'iP', new Float32Array(G.capG * 4), 4); G.gC = instAttr(gg, 'iC', new Uint8Array(G.capG * 4), 4, true); G.gN = instAttr(gg, 'iN', new Uint8Array(G.capG * 4), 4, true);
    gg.instanceCount = 0; gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const gm = new THREE.Mesh(gg, makeGrassMat()); gm.frustumCulled = false; gm.receiveShadow = true; gm.castShadow = false; gm.visible = false; gm.name = 'grass';
    const fg = cardGeo();
    G.fP = instAttr(fg, 'iP', new Float32Array(G.capF * 4), 4); G.fA = instAttr(fg, 'iF', new Uint8Array(G.capF * 4), 4, true); G.fT = instAttr(fg, 'iT', new Uint8Array(G.capF * 4).fill(128), 4, true);
    fg.instanceCount = 0; fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const fm = new THREE.Mesh(fg, makeFlowerMat(flowerAtlas())); fm.frustumCulled = false; fm.receiveShadow = true; fm.castShadow = false; fm.visible = false; fm.name = 'flowers';
    L.scene.add(gm); L.scene.add(fm); L.grassIM = gm; L.flowerIM = fm; G.gm = gm; G.fm = fm;
    // tiles in range, nearest first (precomputed offsets)
    const rt = Math.ceil((R * GU.uLod.value.z) / TS) + 1; const offs = [];
    for (let j = -rt; j <= rt; j++) for (let i = -rt; i <= rt; i++) offs.push([i, j, Math.hypot(i, j)]);
    offs.sort((a, b) => a[2] - b[2]); G.offs = offs; G.maxTiles = Math.ceil(offs.length * 2.2);
    G.list = new Array(offs.length); G.listD = new Float64Array(offs.length);
    G.fcam = new THREE.PerspectiveCamera(); G.frus = new THREE.Frustum(); G.pm = new THREE.Matrix4(); G.box = new THREE.Box3();
    L.grassCenter = [1e9, 1e9];
    if (L.onTimeOfDay) L.onTimeOfDay(T => { GU.uWind.value.z = .55 + (T.rain || 0) * .45; GU.uWind.value.w = 1.25 + (T.rain || 0) * .6; });
  };

  // ---------------------------------------------------------------- update: build tiles in budget, pack when needed
  function distBox(t, x, y, z) {
    const x0 = t.i * TS, z0 = t.j * TS;
    const dx = Math.max(x0 - x, 0, x - x0 - TS), dz = Math.max(z0 - z, 0, z - z0 - TS), dy = Math.max(t.y0 - y, 0, y - t.y1);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const _f = new THREE.Vector3();
  const cp = (dst, o, src, n) => { for (let k = 0; k < n; k++) dst[o + k] = src[k]; };   // no subarray views per pack
  function pack(cam) {
    const t0 = performance.now(), x = cam.position.x, y = cam.position.y, z = cam.position.z;
    // widened frustum so small turns between packs stay covered
    const fc = G.fcam; fc.fov = Math.min(cam.fov + 26, 150); fc.aspect = cam.aspect * 1.2; fc.near = .1; fc.far = G.R * 2; fc.updateProjectionMatrix();
    fc.position.copy(cam.position); fc.quaternion.copy(cam.quaternion); fc.updateMatrixWorld(); fc.matrixWorldInverse.copy(fc.matrixWorld).invert();
    G.pm.multiplyMatrices(fc.projectionMatrix, fc.matrixWorldInverse); G.frus.setFromProjectionMatrix(G.pm);
    const ci = Math.floor(x / TS), cj = Math.floor(z / TS), RF = G.R * GU.uLod.value.z;
    let nl = 0;
    for (const o of G.offs) {
      const t = tiles.get(tid(ci + o[0], cj + o[1])); if (!t || (t.n === 0 && t.nf === 0)) continue;
      const d = distBox(t, x, y, z); if (d > RF) continue;
      if (d > 4) { G.box.min.set(t.i * TS, t.y0 - .5, t.j * TS); G.box.max.set(t.i * TS + TS, t.y1 + 1, t.j * TS + TS); if (!G.frus.intersectsBox(G.box)) continue; }
      t.used = G.frame; G.list[nl] = t; G.listD[nl] = d; nl++;
    }
    // insertion sort by distance (already nearly sorted by ring order)
    for (let a = 1; a < nl; a++) { const t = G.list[a], d = G.listD[a]; let b = a - 1; while (b >= 0 && G.listD[b] > d) { G.list[b + 1] = G.list[b]; G.listD[b + 1] = G.listD[b]; b--; } G.list[b + 1] = t; G.listD[b + 1] = d; }
    const full = G.full, R = G.R, RFl = R * GU.uLod.value.z; let ng = 0, nf = 0;
    const AP = G.gP.array, AC = G.gC.array, AN = G.gN.array, FP = G.fP.array, FA = G.fA.array, FT = G.fT.array;
    for (let a = 0; a < nl; a++) {
      const t = G.list[a], d = Math.max(G.listD[a], 1), base = Math.min(1, full * full / (d * d)) * 1.1;
      const fr = base * sstep(R, R * .72, d);
      if (fr > 0 && t.n) {
        const c = Math.min(t.n, Math.ceil(t.n * fr) + 1, G.capG - ng);
        if (c > 0) { cp(AP, ng * 4, t.P, c * 4); cp(AC, ng * 4, t.C, c * 4); cp(AN, ng * 4, t.N, c * 4); ng += c; }
      }
      const ff = base * sstep(RFl, RFl * .72, d);
      if (ff > 0 && t.nf) {
        const c = Math.min(t.nf, Math.ceil(t.nf * ff) + 1, G.capF - nf);
        if (c > 0) { cp(FP, nf * 4, t.FP, c * 4); cp(FA, nf * 4, t.FA, c * 4); cp(FT, nf * 4, t.FT, c * 4); nf += c; }
      }
    }
    const up = (at, n) => { at.updateRange.offset = 0; at.updateRange.count = n * 4; at.needsUpdate = true; };
    if (ng) { up(G.gP, ng); up(G.gC, ng); up(G.gN, ng); }
    if (nf) { up(G.fP, nf); up(G.fA, nf); up(G.fT, nf); }
    G.gm.geometry.instanceCount = ng; G.gm.visible = ng > 0; G.fm.geometry.instanceCount = nf; G.fm.visible = nf > 0;
    const S = L.grassStats; S.clumps = ng; S.flowers = nf; S.tris = ng * G.trisPer + nf * 4; S.tiles = tiles.size; S.packMs = performance.now() - t0;
    G.cx = x; G.cy = y; G.cz = z; cam.getWorldDirection(_f); G.fx = _f.x; G.fy = _f.y; G.fz = _f.z; G.fov = cam.fov; G.dirty = false;
  }
  function evict(ci, cj) {
    if (tiles.size <= G.maxTiles) return;
    const lim = Math.ceil(G.R * GU.uLod.value.z / TS) + 2; let oldest = null, ot = Infinity;
    for (const t of tiles.values()) { if (Math.abs(t.i - ci) <= lim && Math.abs(t.j - cj) <= lim) continue; if (t.used < ot) { ot = t.used; oldest = t; } }
    if (oldest) { tiles.delete(tid(oldest.i, oldest.j)); freeTile(oldest); }
  }
  // px,pz: player (or focus) position; the ring follows the camera unless it is far from the focus (teleports)
  L.grassUpdate = function (px, pz, force) {
    if (!G || !L.terrainSample || !L.ground) return;
    const cam = L.camera; G.frame++;
    let x = cam.position.x, z = cam.position.z;
    if (px != null && Math.hypot(px - x, pz - z) > G.R * .8) { x = px; z = pz; }
    const ci = Math.floor(x / TS), cj = Math.floor(z / TS), RF = G.R * GU.uLod.value.z;
    const t0 = performance.now(); const budget = force ? 60 : G.budget;
    // build missing tiles nearest-first (do one row, then check the budget)
    for (;;) {
      if (!cur) {
        let found = false;
        for (const o of G.offs) {
          if (o[2] * TS - TS * .75 > RF) break;
          const i = ci + o[0], j = cj + o[1]; if (tiles.has(tid(i, j))) continue;
          startTile(i, j); found = true; break;
        }
        if (!found) break;
      }
      while (!stepTile()) { if (performance.now() - t0 > budget) break; }
      if (cur && Math.max(Math.abs(cur.i - ci), Math.abs(cur.j - cj)) > Math.ceil(RF / TS) + 1) cur = null; // walked away
      if (performance.now() - t0 > budget) break;
    }
    L.grassStats.buildMs = performance.now() - t0;
    evict(ci, cj);
    // repack when moved, turned, or new tiles are ready
    cam.getWorldDirection(_f);
    const dx = cam.position.x - G.cx, dy = cam.position.y - G.cy, dz = cam.position.z - G.cz;
    const moved = dx * dx + dy * dy + dz * dz > 1.44;
    const turned = _f.x * G.fx + _f.y * G.fy + _f.z * G.fz < .993 || cam.fov !== G.fov;
    if (force || G.dirty || moved || turned) pack(cam);
    L.grassCenter[0] = x; L.grassCenter[1] = z;
  };
  // drop tiles touching a square (colliders / buildings changed); they are rebuilt over the next frames
  L.grassInvalidate = function (x, z, r) {
    if (!G) return;
    for (let i = Math.floor((x - r) / TS); i <= Math.floor((x + r) / TS); i++) for (let j = Math.floor((z - r) / TS); j <= Math.floor((z + r) / TS); j++) { const t = tiles.get(tid(i, j)); if (t) { tiles.delete(tid(i, j)); freeTile(t); } if (cur && cur.i === i && cur.j === j) cur = null; }
    G.dirty = true;
  };
  L.grassClear = function () { for (const t of tiles.values()) freeTile(t); tiles.clear(); cur = null; if (G) G.dirty = true; };
})(window.L);
