/* Lumiar v5 flora: painterly foliage atlas (clumpy canopies), foliage card material (world-space wind,
   soft translucency, lighter tops, see-through hole), card generators kept from v4 (canopyCards, blobCards, frondGeo). */
'use strict';
(function (L) {
  const { clamp, lerp } = L;
  const TAU = Math.PI * 2;
  L.uTime = L.uTime || { value: 0 };
  L.uPlayer = L.uPlayer || { value: new THREE.Vector3(0, -999, 0) };

  // ---------- foliage atlas (4x2 cells of 512 px) ----------
  // cells: 0 broadleaf clump A, 1 broadleaf clump B (finer), 2 pine bough, 3 willow strands, 4 fern frond,
  //        5 flowers on leaves, 6 reeds, 7 berries on leaves. Leaves are drawn grey-green and take the tint.
  function rnd(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  L.rnd = L.rnd || rnd;
  function shadeCol(s, warm, a) { const r = Math.round(255 * clamp(s * (.92 + warm * .1), 0, 1)), g = Math.round(255 * clamp(s, 0, 1)), b = Math.round(255 * clamp(s * (.78 - warm * .08), 0, 1)); return a == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`; }
  function leafShape(g, x, y, len, wid, ang, fill, rib) {
    g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(0, -len / 2); g.bezierCurveTo(wid, -len * .25, wid * .8, len * .3, 0, len / 2); g.bezierCurveTo(-wid * .8, len * .3, -wid, -len * .25, 0, -len / 2);
    g.fillStyle = fill; g.fill(); if (rib) { g.strokeStyle = 'rgba(30,40,20,.14)'; g.lineWidth = Math.max(1, wid * .1); g.beginPath(); g.moveTo(0, -len * .42); g.lineTo(0, len * .42); g.stroke(); } g.restore();
  }
  // a chunky clump: overlapping lobes, each a soft-shaded ball with a scalloped leafy rim (stylized, not noisy)
  function drawClump(g, ox, oy, S, seed, fine) {
    const r = rnd(seed), cx = ox + S / 2, cy = oy + S / 2;
    const lobes = []; const nl = fine ? 11 : 7;
    for (let i = 0; i < nl; i++) { const a = r() * TAU, d = (i === 0 ? 0 : .12 + r() * .17) * S; const rad = S * (fine ? .1 + r() * .07 : .14 + r() * .08) * (i === 0 ? 1.25 : 1); lobes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * .85, r: rad }); }
    lobes.sort((p, q) => (q.y - p.y)); // lower lobes first, upper lobes drawn on top
    for (const l of lobes) {
      // scalloped rim: small leaf tips around the lobe
      const nt = fine ? 16 : 13;
      for (let k = 0; k < nt; k++) { const a = k / nt * TAU + r() * .3; const ex = l.x + Math.cos(a) * l.r * .92, ey = l.y + Math.sin(a) * l.r * .92; const up = clamp(-Math.sin(a) * .5 + .5, 0, 1); leafShape(g, ex, ey, l.r * (fine ? .5 : .55), l.r * (fine ? .26 : .3), a + Math.PI / 2 + (r() - .5) * .5, shadeCol(.55 + up * .3 + (r() - .5) * .06, .5), false); }
      const gr = g.createRadialGradient(l.x - l.r * .3, l.y - l.r * .42, l.r * .08, l.x, l.y, l.r * 1.02);
      gr.addColorStop(0, shadeCol(1.0, .7)); gr.addColorStop(.45, shadeCol(.86, .5)); gr.addColorStop(.85, shadeCol(.66, .3)); gr.addColorStop(1, shadeCol(.58, .2));
      g.fillStyle = gr; g.beginPath(); g.arc(l.x, l.y, l.r, 0, TAU); g.fill();
      // a few painted leaf strokes on the lit side
      for (let k = 0; k < (fine ? 5 : 7); k++) { const a = -Math.PI * (.15 + r() * .7), d = l.r * (.25 + r() * .5); leafShape(g, l.x + Math.cos(a) * d, l.y + Math.sin(a) * d, l.r * .34, l.r * .16, a + Math.PI / 2 + (r() - .5), shadeCol(.95 + r() * .08, .8, .55), false); }
      // soft contact shadow under the lobe
      const sg = g.createRadialGradient(l.x, l.y + l.r * .95, l.r * .1, l.x, l.y + l.r * .95, l.r * .8); sg.addColorStop(0, 'rgba(40,52,30,.18)'); sg.addColorStop(1, 'rgba(40,52,30,0)');
      g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = sg; g.fillRect(l.x - l.r, l.y, l.r * 2, l.r * 1.8); g.restore();
    }
  }
  // One whorl of a conifer seen from the side: a drooping umbrella with a serrated hem, painted as needle tufts that are
  // lit along the top and darken toward the hem. Several of these stacked on a cone read as a layered pine.
  function drawBough(g, ox, oy, S, seed) {
    const r = rnd(seed), cx = ox + S / 2, top = oy + S * .1, hem = oy + S * .8;
    const edge = u => top + (hem - top) * (Math.pow(Math.abs(u), .8) * .82 + .1);      // the upper outline, u = -1..1
    g.lineCap = 'round';
    // body: umbrella silhouette with a toothed lower edge (teeth = drooping branch tips)
    g.beginPath(); g.moveTo(cx - S * .47, edge(-1) + S * .05);
    for (let k = -20; k <= 20; k++) { const u = k / 20; g.lineTo(cx + u * S * .45, edge(u) - S * .02); }
    const teeth = 9; for (let k = teeth; k >= 0; k--) { const u = k / teeth * 2 - 1, x = cx + u * S * .46, yb = hem - (1 - Math.abs(u)) * S * .06; g.lineTo(x, yb + S * (.05 + r() * .04)); if (k) g.lineTo(x - S * .046, yb - S * (.06 + r() * .04)); }
    g.closePath(); g.fillStyle = shadeCol(.5, .2); g.fill();
    // needle tufts: strokes fanning out and down from the axis, lighter near the top of the whorl
    for (let layer = 0; layer < 4; layer++) {
      for (let k = 0; k < 120; k++) {
        const u = (r() * 2 - 1) * (1 - layer * .12), bx = cx + u * S * .42, by0 = edge(u) + S * (.02 + layer * .07 + r() * .06);
        if (by0 > hem - S * .05) continue;
        const len = S * (.06 + r() * .08), ang = Math.PI / 2 + Math.sign(u || 1) * (.55 + r() * .5) * Math.min(1, Math.abs(u) * 3 + .3);
        const ex = bx + Math.cos(ang) * len, ey = by0 + Math.sin(ang) * len;
        const yN = clamp((by0 - top) / (hem - top), 0, 1);
        g.strokeStyle = shadeCol(clamp(1.02 - yN * .52 - layer * .03 + (r() - .5) * .1, .32, 1.05), .45); g.lineWidth = S * (.012 + r() * .01);
        g.beginPath(); g.moveTo(bx, by0); g.lineTo(ex, ey); g.stroke();
      }
    }
    // bright rim along the top of the whorl
    for (let k = 0; k < 70; k++) { const u = r() * 2 - 1, bx = cx + u * S * .43, by = edge(u) + S * r() * .03, a = Math.PI / 2 + Math.sign(u || 1) * (.9 + r() * .4); g.strokeStyle = shadeCol(1.05 + r() * .06, .7, .9); g.lineWidth = S * .011; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a) * S * .05, by + Math.sin(a) * S * .035); g.stroke(); }
  }
  function drawStrands(g, ox, oy, S, seed) {
    const r = rnd(seed);
    for (let k = 0; k < 15; k++) {
      const x = ox + S * (.1 + r() * .8); const y0 = oy + S * r() * .1, y1 = oy + S * (.75 + r() * .25); const sway = (r() - .5) * S * .08; const s0 = .6 + r() * .35;
      g.strokeStyle = shadeCol(s0 * .6, 0); g.lineWidth = S * .005; g.beginPath(); g.moveTo(x, y0); g.quadraticCurveTo(x + sway, (y0 + y1) / 2, x + sway * .4, y1); g.stroke();
      const n = 22; for (let i = 0; i < n; i++) { const t = i / (n - 1), y = lerp(y0, y1, t), xx = x + sway * Math.sin(t * Math.PI) * .9; const len = S * .055 * (1 - t * .45), wid = len * .3; leafShape(g, xx + (i % 2 ? 1 : -1) * len * .25, y, len, wid, (i % 2 ? .5 : -.5) + (r() - .5) * .3, shadeCol(clamp(s0 + (r() - .5) * .15 - t * .1, .4, 1), r()), false); }
    }
  }
  function drawFern(g, ox, oy, S, seed) {
    const r = rnd(seed); const x0 = ox + S * .5, y0 = oy + S * .99, x1 = ox + S * .56, y1 = oy + S * .03, cxp = ox + S * .38, cyp = oy + S * .45;
    const bez = t => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cxp + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cyp + t * t * y1];
    g.strokeStyle = shadeCol(.42, 0); g.lineWidth = S * .012; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cxp, cyp, x1, y1); g.stroke();
    const n = 34;
    for (let i = 2; i < n; i++) {
      const t = i / n; const [px, py] = bez(t); const [qx, qy] = bez(Math.min(1, t + .02)); const ang = Math.atan2(qy - py, qx - px);
      const len = S * .3 * Math.sin(Math.PI * (t * .92 + .06)) * (1 - t * .25);
      for (const side of [-1, 1]) { const a = ang + side * (1.05 - t * .25); const mx = px + Math.cos(a) * len * .5, my = py + Math.sin(a) * len * .5; leafShape(g, mx, my, len, len * .2, a + Math.PI / 2, shadeCol(clamp(.55 + t * .3 + (r() - .5) * .12, .4, 1), r() * .6), true); }
    }
  }
  function drawFlowers(g, ox, oy, S, seed) {
    drawClump(g, ox, oy, S, seed + 3, true);
    const r = rnd(seed); const cx = ox + S / 2, cy = oy + S / 2, R = S * .36;
    const pals = [['#fff8f0', '#ffd34a'], ['#ffe27a', '#f0a02c'], ['#ffd0e4', '#ff7fb2'], ['#fdfdff', '#ffcf5a'], ['#ff9f8a', '#ffd34a']];
    for (let i = 0; i < 40; i++) {
      const a = r() * TAU, d = Math.pow(r(), .7) * R; const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * .9 - S * .03; const rad = S * (.024 + r() * .016);
      const [pc, cc] = pals[Math.floor(r() * pals.length)];
      g.fillStyle = pc; for (let k = 0; k < 5; k++) { const b = k / 5 * TAU + r() * .4; g.beginPath(); g.ellipse(x + Math.cos(b) * rad * .62, y + Math.sin(b) * rad * .62, rad * .58, rad * .42, b, 0, TAU); g.fill(); }
      g.fillStyle = cc; g.beginPath(); g.arc(x, y, rad * .34, 0, TAU); g.fill();
    }
  }
  function drawBerries(g, ox, oy, S, seed) {
    drawClump(g, ox, oy, S, seed + 5, true);
    const r = rnd(seed); const cx = ox + S / 2, cy = oy + S / 2, R = S * .34;
    for (let c = 0; c < 9; c++) {
      const a = r() * TAU, d = Math.pow(r(), .6) * R; const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d;
      const blue = r() < .3; const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const x = bx + (r() - .5) * S * .07, y = by + (r() - .5) * S * .07, rad = S * (.02 + r() * .008);
        const gr = g.createRadialGradient(x - rad * .35, y - rad * .35, rad * .1, x, y, rad);
        if (blue) { gr.addColorStop(0, '#9fb8ff'); gr.addColorStop(.35, '#3b4fbf'); gr.addColorStop(1, '#1d2366'); } else { gr.addColorStop(0, '#ffb0a0'); gr.addColorStop(.35, '#e8283a'); gr.addColorStop(1, '#7a0f1c'); }
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
      }
    }
  }
  function drawReeds(g, ox, oy, S, seed) {
    const r = rnd(seed);
    for (let i = 0; i < 26; i++) { const x = ox + S * (.12 + r() * .76), h = S * (.55 + r() * .42), bend = (r() - .5) * S * .12; const w = S * (.012 + r() * .012); g.fillStyle = shadeCol(.5 + r() * .35, r() * .5); g.beginPath(); g.moveTo(x - w, oy + S); g.quadraticCurveTo(x + bend * .4, oy + S - h * .6, x + bend, oy + S - h); g.quadraticCurveTo(x + bend * .4 + w * .4, oy + S - h * .55, x + w, oy + S); g.fill(); }
    for (let i = 0; i < 6; i++) { const x = ox + S * (.2 + r() * .6), top = oy + S * (.06 + r() * .25), y1 = top + S * (.1 + r() * .05); g.strokeStyle = '#6f8a3a'; g.lineWidth = S * .008; g.beginPath(); g.moveTo(x, oy + S); g.lineTo(x, top - S * .04); g.stroke(); g.fillStyle = '#7a4a24'; g.beginPath(); g.ellipse(x, (top + y1) / 2, S * .022, (y1 - top) / 2, 0, 0, TAU); g.fill(); }
  }
  L.foliageAtlas = function () {
    if (L._fatlas) return L._fatlas;
    const S = 512, c = document.createElement('canvas'); c.width = S * 4; c.height = S * 2; const g = c.getContext('2d');
    drawClump(g, 0, 0, S, 11, false); drawClump(g, S, 0, S, 27, true); drawBough(g, 0, S, S, 5); drawStrands(g, S, S, S, 9);
    drawFern(g, 2 * S, 0, S, 41); drawFlowers(g, 3 * S, 0, S, 43); drawReeds(g, 2 * S, S, S, 47); drawBerries(g, 3 * S, S, S, 53);
    const t = L.bleedTexture(c, 4, 2); t.anisotropy = 4; L._fatlas = t; L._fatlasCanvas = c; return t;
  };
  // Canvas -> DataTexture whose fully transparent pixels carry the average colour of their atlas cell, so mipmaps
  // fade cards to leaf colour instead of black (canvas 2D cannot store colour under alpha 0).
  L.bleedTexture = function (c, nx, ny) {
    const W = c.width, H = c.height, src = c.getContext('2d').getImageData(0, 0, W, H).data; const out = new Uint8Array(W * H * 4);
    const cw = W / (nx || 1), ch = H / (ny || 1);
    for (let cy = 0; cy < (ny || 1); cy++) for (let cx = 0; cx < (nx || 1); cx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = cy * ch; y < (cy + 1) * ch; y += 2) for (let x = cx * cw; x < (cx + 1) * cw; x += 2) { const i = (y * W + x) * 4; if (src[i + 3] > 200) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; } }
      if (n) { r /= n; g /= n; b /= n; }
      for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) {
        const i = (y * W + x) * 4, o = ((H - 1 - y) * W + x) * 4, a = src[i + 3]; // rows flipped: DataTexture rows run bottom-up
        if (a === 0) { out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 0; }
        else { const k = a / 255; out[o] = src[i] * k + r * (1 - k); out[o + 1] = src[i + 1] * k + g * (1 - k); out[o + 2] = src[i + 2] * k + b * (1 - k); out[o + 3] = a; }
      }
    }
    const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat); t.encoding = THREE.sRGBEncoding; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
  };
  const QUAD_UV = [[0, .5], [.25, .5], [0, 0], [.25, 0], [.5, .5], [.75, .5], [.5, 0], [.75, 0]]; L.QUAD_UV = QUAD_UV;

  // ---------- foliage material: camera-facing cards, wind in WORLD space (v4 bug: local space), stylized light ----------
  // Works on plain meshes, InstancedMesh (instanceMatrix + instanceColor) and in impostor bakes.
  const FOL_VERT = `
    vec4 wpos = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wpos = instanceMatrix * wpos; vec3 ip = instanceMatrix[3].xyz; float isc = length(instanceMatrix[0].xyz);
    #else
      vec3 ip = vec3(0.); float isc = 1.;
    #endif
    wpos = modelMatrix * wpos;
    vec3 wroot = (modelMatrix * vec4(ip, 1.)).xyz;
    float hgt = max(wpos.y - wroot.y, 0.);
    float ph = wroot.x * .21 + wroot.z * .17;
    float gust = sin(uTime * .45 + wroot.x * .012 - wroot.z * .009) * .5 + .5;
    float sw = (sin(uTime * 1.25 + ph) * .55 + sin(uTime * 2.6 + ph * 1.7 + position.x) * .2 + gust * .5) * uWind * hgt * .02;
    wpos.xz += vec2(.86, .5) * sw;
    vec4 mvPosition = viewMatrix * wpos;
    vec2 o = aOff * isc * length(modelMatrix[0].xyz);
    o += vec2(sin(uTime * 2.3 + ph + position.y * 2.1), cos(uTime * 1.9 + ph + position.x * 1.7)) * .03 * uWind * isc;
    mvPosition.xy += o; vViewZ = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;`;
  function foliageVert(sh, wind) {
    sh.uniforms.uTime = L.uTime; sh.uniforms.uWind = wind;
    sh.vertexShader = 'attribute vec2 aOff; uniform float uTime, uWind; varying float vViewZ;\n' + sh.vertexShader.replace('#include <project_vertex>', FOL_VERT);
  }
  // opts: {wind, color, transl, top}
  L.makeFoliageMat = function (opts) {
    opts = opts || {}; const map = L.foliageAtlas();
    const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: .42, side: THREE.DoubleSide, roughness: 1, metalness: 0, color: opts.color != null ? opts.color : 0xffffff });
    const wind = { value: opts.wind == null ? 1 : opts.wind };
    mat.onBeforeCompile = sh => {
      foliageVert(sh, wind);
      sh.uniforms.uPlayer = L.uPlayer;
      sh.vertexShader = 'varying float vTopF;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vTopF = clamp(normal.y * .5 + .5, 0., 1.);');
      sh.fragmentShader = 'varying float vViewZ; varying float vTopF; uniform vec3 uPlayer;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `vec4 texelColor = texture2D( map, vUv ); texelColor = mapTexelToLinear( texelColor ); diffuseColor *= texelColor;
          float tg = max(texelColor.g, .02); float fsat = max(smoothstep(1.1, 1.35, texelColor.r / tg), smoothstep(.74, .92, texelColor.b / tg));`)
        .replace('#include <color_fragment>', `#ifdef USE_COLOR
            diffuseColor.rgb *= mix(vColor, vec3(clamp(dot(vColor, vec3(.33)) * 1.5, .55, 1.05)), fsat);
          #endif
          diffuseColor.rgb *= mix(.92, 1.12, vTopF);   // lighter tops`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (vViewZ < 3.2 && dn > (vViewZ - .6) / 2.6) discard;
          vec3 pv = (viewMatrix * vec4(uPlayer + vec3(0., 1.1, 0.), 1.)).xyz;
          if (-pv.z > .5 && vViewZ < -pv.z - .6) { vec2 dxy = (-vViewPosition.xy) / vViewZ - pv.xy / -pv.z; float cut = 1. - smoothstep(.07, .2, length(dxy * vec2(1., 1.25))); if (dn < cut * .92) discard; }`);
    };
    mat.customProgramCacheKey = () => 'foliage-v5';
    L.stylize(mat, { wrap: .55, rim: .45, transl: opts.transl != null ? opts.transl : .45 });
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: .42 });
    dm.onBeforeCompile = sh => { foliageVert(sh, wind); sh.vertexShader = sh.vertexShader.replace('varying float vViewZ;', 'float vViewZ;'); };
    dm.customProgramCacheKey = () => 'foliage-depth-v5';
    mat.userData.depth = dm; mat.userData.wind = wind;
    return mat;
  };
  L.applyFoliage = function (mesh, mat) { mesh.material = mat; mesh.customDepthMaterial = mat.userData.depth; return mesh; };

  // ---------- canopy cards sampled on a Blender canopy surface ----------
  // opts: { n, size:[a,b], quads:[..], inset, hang:{below, quad, aspect, p}, seed }
  L.canopyCards = function (geo, opts) {
    const r = rnd(opts.seed || 1); const P = geo.attributes.position; const NM = geo.attributes.normal; const idx = geo.index ? geo.index.array : null;
    const triCount = idx ? idx.length / 3 : P.count / 3; const areas = new Float32Array(triCount); let tot = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const vi = (t, k) => idx ? idx[t * 3 + k] : t * 3 + k;
    for (let t = 0; t < triCount; t++) { a.fromBufferAttribute(P, vi(t, 0)); b.fromBufferAttribute(P, vi(t, 1)); c.fromBufferAttribute(P, vi(t, 2)); e1.subVectors(b, a); e2.subVectors(c, a); tot += e1.cross(e2).length() * .5; areas[t] = tot; }
    geo.computeBoundingBox(); const bb = geo.boundingBox; const cen = bb.getCenter(new THREE.Vector3()); const H = Math.max(bb.max.y - bb.min.y, .01);
    const pos = [], off = [], uv = [], nor = [], col = [], ind = [];
    const p = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
    for (let i = 0; i < opts.n; i++) {
      const pick = r() * tot; let lo = 0, hi = triCount - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (areas[m] < pick) lo = m + 1; else hi = m; }
      a.fromBufferAttribute(P, vi(lo, 0)); b.fromBufferAttribute(P, vi(lo, 1)); c.fromBufferAttribute(P, vi(lo, 2));
      let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
      p.copy(a).addScaledVector(e1.subVectors(b, a), u).addScaledVector(e2.subVectors(c, a), v);
      if (NM) { na.fromBufferAttribute(NM, vi(lo, 0)); nb.fromBufferAttribute(NM, vi(lo, 1)); nc.fromBufferAttribute(NM, vi(lo, 2)); n.copy(na).multiplyScalar(1 - u - v).addScaledVector(nb, u).addScaledVector(nc, v).normalize(); } else n.copy(e1).cross(e2).normalize();
      d.subVectors(p, cen); d.y *= 1.3; d.normalize();
      n.multiplyScalar(.45).addScaledVector(d, .55).addScaledVector(up, .18).normalize();
      const size = lerp(opts.size[0], opts.size[1], r());
      const inset = r() * (opts.inset == null ? .35 : opts.inset); p.addScaledVector(n, -inset * size);
      const hN = clamp((p.y - bb.min.y) / H, 0, 1);
      let shade = .56 + .3 * hN + .2 * Math.max(n.y, 0) - inset * .3 + (r() - .5) * .08; shade = clamp(shade, .42, 1.12);
      let q = opts.quads[Math.floor(r() * opts.quads.length)], w = size, h = size, rot = r() * TAU;
      if (opts.hang && hN < opts.hang.below && r() < (opts.hang.p || .85)) { q = opts.hang.quad; w = size * .7; h = size * opts.hang.aspect; rot = (r() - .5) * .25; p.y -= h * .25; }
      if (opts.upright) rot = (r() - .5) * .35; // pine boughs keep their droop direction
      const [u0, v0] = QUAD_UV[q]; const cs = Math.cos(rot), sn = Math.sin(rot); const base = pos.length / 3;
      for (const [cx, cy] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) {
        pos.push(p.x, p.y, p.z); const ox = cx * w, oy = cy * h; off.push(ox * cs - oy * sn, ox * sn + oy * cs);
        uv.push(u0 + .002 + (cx + .5) * .246, v0 + .004 + (cy + .5) * .492); nor.push(n.x, n.y, n.z); col.push(shade, shade, shade);
      }
      ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ind);
    g.computeBoundingSphere(); g.boundingSphere.radius += opts.size[1];
    return g;
  };

  // ---------- procedural conifer: whorls of bough cards on a cone (stand-in until v5 tree models; also a good far LOD) ----------
  // opts: {h: height m (10), r: base radius (h*.27), tiers, seed, lo: fewer cards}. Returns {canopy, bark, h}:
  // canopy uses the foliage material (atlas cell 2), bark is an open trunk cylinder for L.MAT.bark.
  L.pineCards = function (opts) {
    opts = opts || {}; const r = rnd(opts.seed || 5), H = opts.h || 10, R = opts.r || H * .27, lo = !!opts.lo;
    const nt = opts.tiers || (lo ? 5 : Math.round(lerp(7, 9, r())));
    const pos = [], off = [], uv = [], nor = [], col = [], ind = [];
    const [u0, v0] = QUAD_UV[2];
    const card = (x, y, z, w, h, nx, ny, nz, shade, rot) => {
      const nl = Math.hypot(nx, ny, nz) || 1, cs = Math.cos(rot), sn = Math.sin(rot), base = pos.length / 3;
      for (const [cx, cy] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) {
        pos.push(x, y, z); const ox = cx * w, oy = cy * h; off.push(ox * cs - oy * sn, ox * sn + oy * cs);
        uv.push(u0 + .002 + (cx + .5) * .246, v0 + .004 + (cy + .5) * .492); nor.push(nx / nl, ny / nl, nz / nl); col.push(shade, shade, shade);
      }
      ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const yb = H * (.17 + r() * .05), yt = H * .86;
    for (let i = 0; i < nt; i++) {
      const t = i / (nt - 1), y = lerp(yb, yt, Math.pow(t, .92)), rr = R * Math.pow(1 - t * .9, 1.1) + H * .02;
      const m = lo ? Math.max(2, Math.round(1.5 + rr / R * 2.5)) : Math.max(3, Math.round(3 + rr / R * 5));
      const a0 = r() * TAU;
      for (let k = 0; k < m; k++) {
        const a = a0 + (k + (r() - .5) * .5) / m * TAU, ca = Math.cos(a), sa = Math.sin(a), d = rr * (.42 + r() * .22);
        const w = rr * (lo ? 1.5 : 1.25) + H * .06, h = w * .78;
        card(ca * d, y - h * .22, sa * d, w, h, ca, .5, sa, clamp(.66 + .34 * t + (r() - .5) * .1, .5, 1.05), (r() - .5) * .22);
      }
      if (!lo || i % 2 === 0) card(0, y - rr * .25, 0, rr * 1.7 + H * .04, rr * 1.25 + H * .03, 0, .3, 0, .42 + .2 * t, (r() - .5) * .2);   // dark core
    }
    card(0, H * .92, 0, R * .42 + H * .03, H * .17, 0, 1, 0, 1, 0);   // leader
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    cg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); cg.setIndex(ind);
    cg.computeBoundingSphere(); cg.boundingSphere.radius += R * 1.3;
    const bark = new THREE.CylinderGeometry(H * .014, H * .032, H * .62, lo ? 5 : 7, 1, true); bark.translate(0, H * .29, 0);
    bark.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(bark.attributes.position.count * 3).fill(.8), 3));
    return { canopy: cg, bark, h: H };
  };

  // ---------- legacy grass patch + material (kept for callers outside grass.js; grass.js v5 has its own) ----------
  L.grassPatchGeo = function (blades, radius, seed) {
    const r = rnd(seed || 3); const pos = [], nor = [], col = [], at = [], ind = [];
    for (let i = 0; i < blades; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * radius, bx = Math.cos(a) * d, bz = Math.sin(a) * d;
      const h = .32 + r() * .5, w = .055 + r() * .05, rot = r() * TAU, lean = (.15 + r() * .3) * h; const ca = Math.cos(rot), sa = Math.sin(rot);
      const shade = .85 + r() * .3; const base = pos.length / 3;
      for (const [px, t, lt] of [[-w / 2, 0, 0], [w / 2, 0, 0], [-w * .36, .55, .3], [w * .36, .55, .3], [0, 1, 1]]) {
        const lz = lean * lt * lt; const x = bx + px * ca - lz * sa, z = bz + px * sa + lz * ca;
        pos.push(x, t * h, z); nor.push(0, 1, 0); at.push(t); const k = lerp(.52, 1.2, t) * shade; col.push(k * (1 + t * .1), k * (1 + t * .03), k * (1 - t * .16));
      }
      ind.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1)); g.setIndex(ind);
    return g;
  };

  // ---------- bushes: leaf cards on a union of ellipsoids ----------
  // blobs: [[x,y,z,rx,ry,rz],...]; opts: {n, size:[a,b], quads:[..], extra:{quad, p, top}, inset, seed}
  L.blobCards = function (blobs, opts) {
    const r = rnd(opts.seed || 7); const pos = [], off = [], uv = [], nor = [], col = [], ind = [];
    let ymin = 1e9, ymax = -1e9, cx = 0, cy = 0, cz = 0, wsum = 0; const areas = [];
    for (const b of blobs) { ymin = Math.min(ymin, b[1] - b[4]); ymax = Math.max(ymax, b[1] + b[4]); const a = b[3] * b[4] + b[4] * b[5] + b[3] * b[5]; areas.push(a); wsum += a; cx += b[0] * a; cy += b[1] * a; cz += b[2] * a; }
    cx /= wsum; cy /= wsum; cz /= wsum; const H = Math.max(ymax - ymin, .01);
    const inside = (x, y, z, skip) => { for (let k = 0; k < blobs.length; k++) { if (k === skip) continue; const b = blobs[k]; const dx = (x - b[0]) / b[3], dy = (y - b[1]) / b[4], dz = (z - b[2]) / b[5]; if (dx * dx + dy * dy + dz * dz < .9) return true; } return false; };
    let made = 0, tries = 0;
    while (made < opts.n && tries++ < opts.n * 40) {
      let pick = r() * wsum, k = 0; while (pick > areas[k] && k < blobs.length - 1) { pick -= areas[k]; k++; }
      const b = blobs[k]; const u = r() * 2 - 1, a = r() * TAU, sq = Math.sqrt(1 - u * u); const dx = sq * Math.cos(a), dy = u, dz = sq * Math.sin(a);
      if (dy < -.55 && r() < .8) continue;
      const px = b[0] + dx * b[3], py = b[1] + dy * b[4], pz = b[2] + dz * b[5];
      if (inside(px, py, pz, k) || py < 0.02) continue;
      let nx = dx / b[3], ny = dy / b[4], nz = dz / b[5]; let nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const ddx = px - cx, ddy = (py - cy) * 1.3, ddz = pz - cz; const dl = Math.hypot(ddx, ddy, ddz) || 1; nx = nx * .5 + ddx / dl * .5; ny = ny * .5 + ddy / dl * .5 + .15; nz = nz * .5 + ddz / dl * .5; nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const size = lerp(opts.size[0], opts.size[1], r()); const inset = r() * (opts.inset == null ? .3 : opts.inset);
      const qx = px - nx * inset * size, qy = Math.max(py - ny * inset * size, size * .25), qz = pz - nz * inset * size;
      const hN = clamp((qy - ymin) / H, 0, 1);
      let shade = clamp(.52 + .32 * hN + .2 * Math.max(ny, 0) - inset * .3 + (r() - .5) * .08, .4, 1.1);
      let q = opts.quads[Math.floor(r() * opts.quads.length)];
      if (opts.extra && hN > (opts.extra.top || 0) && r() < opts.extra.p) { q = opts.extra.quad; shade = Math.max(shade, .85); }
      const rot = r() * TAU, cs = Math.cos(rot), sn = Math.sin(rot); const [u0, v0] = QUAD_UV[q]; const base = pos.length / 3;
      for (const [ex, ey] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) { pos.push(qx, qy, qz); const ox = ex * size, oy = ey * size; off.push(ox * cs - oy * sn, ox * sn + oy * cs); uv.push(u0 + .002 + (ex + .5) * .246, v0 + .004 + (ey + .5) * .492); nor.push(nx, ny, nz); col.push(shade, shade, shade); }
      ind.push(base, base + 1, base + 2, base, base + 2, base + 3); made++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ind);
    g.computeBoundingSphere(); g.boundingSphere.radius += opts.size[1]; return g;
  };
  // fixed (non-billboard) fronds/blades radiating from a base: ferns, reeds, tall grass tufts
  L.frondGeo = function (opts) {
    const r = rnd(opts.seed || 3); const pos = [], off = [], uv = [], nor = [], col = [], ind = [];
    for (let i = 0; i < opts.n; i++) {
      const a = (i / opts.n) * TAU + (r() - .5) * .6; const len = lerp(opts.len[0], opts.len[1], r()), wid = len * (opts.aspect || .45);
      const tilt = lerp(opts.tilt[0], opts.tilt[1], r()); const ca = Math.cos(a), sa = Math.sin(a); const ct = Math.cos(tilt), st = Math.sin(tilt);
      const q = opts.quads[Math.floor(r() * opts.quads.length)]; const [u0, v0] = QUAD_UV[q]; const base = pos.length / 3; const sh = .75 + r() * .3;
      const bx = (r() - .5) * (opts.spread || .2), bz = (r() - .5) * (opts.spread || .2);
      for (const [t, vv] of [[0, 0], [.5, .55], [1, 1]]) {
        const droop = t * t * (opts.droop || .35); const along = t * len * ct, upv = t * len * st - droop * len;
        const px = bx + ca * along, pz = bz + sa * along, py = upv + .02;
        for (const ex of [-.5, .5]) { const wx = -sa * ex * wid * (1 - t * .35), wz = ca * ex * wid * (1 - t * .35); pos.push(px + wx, py, pz + wz); off.push(0, 0); uv.push(u0 + .002 + (ex + .5) * .246, v0 + .004 + vv * .492); nor.push(ca * .3, .95, sa * .3); const k = sh * lerp(.62, 1.05, t); col.push(k, k, k); }
      }
      for (let s2 = 0; s2 < 2; s2++) { const a0 = base + s2 * 2; ind.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ind);
    g.computeBoundingSphere(); return g;
  };
  // cumulus: provided by sky.js (L.buildClouds / L.tickClouds / L.clouds)
})(window.L);
