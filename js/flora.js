/* Lumiar flora: painterly foliage cards, dense grass blades, cumulus clouds. */
'use strict';
(function (L) {
  const { clamp, lerp, sstep } = L;
  const TAU = Math.PI * 2;
  L.uTime = { value: 0 };
  L.uPlayer = { value: new THREE.Vector3(0, -99, 0) };

  // ---------- foliage atlas (2x2): broadleaf A, broadleaf B, needles, willow strands ----------
  function rnd(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shadeCol(s, warm) { const r = Math.round(255 * clamp(s * (.9 + warm * .1), 0, 1)), g = Math.round(255 * clamp(s, 0, 1)), b = Math.round(255 * clamp(s * (.8 - warm * .1), 0, 1)); return `rgb(${r},${g},${b})`; }
  function leafShape(g, x, y, len, wid, ang, fill, rib) {
    g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(0, -len / 2); g.bezierCurveTo(wid, -len * .25, wid * .8, len * .3, 0, len / 2); g.bezierCurveTo(-wid * .8, len * .3, -wid, -len * .25, 0, -len / 2);
    g.fillStyle = fill; g.fill(); if (rib) { g.strokeStyle = 'rgba(30,40,20,.18)'; g.lineWidth = Math.max(1, wid * .12); g.beginPath(); g.moveTo(0, -len * .42); g.lineTo(0, len * .42); g.stroke(); } g.restore();
  }
  function drawBroad(g, ox, oy, S, seed, small) {
    const r = rnd(seed), cx = ox + S / 2, cy = oy + S / 2, R = S * .44;
    const lobes = []; for (let k = 0; k < 7; k++) lobes.push(.78 + r() * .28);
    const edge = a => { const f = (a / TAU + 1) % 1 * 7, i = Math.floor(f), u = f - i; const s = u * u * (3 - 2 * u); return R * lerp(lobes[i % 7], lobes[(i + 1) % 7], s); };
    const n = small ? 120 : 90; const leaves = [];
    for (let i = 0; i < n; i++) { const a = r() * TAU, d = Math.pow(r(), .55); const er = edge(a); const x = cx + Math.cos(a) * d * er, y = cy + Math.sin(a) * d * er; leaves.push({ x, y, d, a }); }
    leaves.sort((p, q) => p.d - q.d);
    for (const l of leaves) {
      const len = S * (small ? .085 : .11) * (.75 + r() * .5), wid = len * (.42 + r() * .12);
      const light = .5 + .5 * clamp(-(l.y - cy) / R * .55 - (l.x - cx) / R * .25 + .3, 0, 1);
      const s = clamp(.58 + l.d * .3 + light * .22 + (r() - .5) * .1, .45, 1);
      leafShape(g, l.x, l.y, len, wid, l.a + Math.PI / 2 + (r() - .5) * 1.4, shadeCol(s, r()), true);
    }
  }
  function drawNeedles(g, ox, oy, S, seed) {
    const r = rnd(seed), cx = ox + S / 2, cy = oy + S / 2;
    g.lineCap = 'round';
    for (let b = 0; b < 16; b++) {
      const a = r() * TAU, d = Math.pow(r(), .6) * S * .26; const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d * .8;
      const ang = a + (r() - .5) * .8, len = S * (.2 + r() * .14); const dx = Math.cos(ang), dy = Math.sin(ang);
      const s0 = .55 + r() * .3;
      g.strokeStyle = shadeCol(s0 * .7, 0); g.lineWidth = S * .012; g.beginPath(); g.moveTo(bx - dx * len * .5, by - dy * len * .5); g.lineTo(bx + dx * len * .5, by + dy * len * .5); g.stroke();
      for (let k = 0; k < 26; k++) {
        const t = k / 25 - .5, px = bx + dx * len * t, py = by + dy * len * t, side = k % 2 ? 1 : -1, nl = S * (.05 + r() * .03) * (1 - Math.abs(t) * .8);
        const na = ang + side * (1.0 + r() * .3) - .35; g.strokeStyle = shadeCol(clamp(s0 + (r() - .3) * .25, .4, 1), r()); g.lineWidth = S * .008;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); g.stroke();
      }
    }
  }
  function drawStrands(g, ox, oy, S, seed) {
    const r = rnd(seed);
    for (let k = 0; k < 15; k++) {
      let x = ox + S * (.1 + r() * .8); const y0 = oy + S * r() * .1, y1 = oy + S * (.75 + r() * .25); const sway = (r() - .5) * S * .08; const s0 = .6 + r() * .35;
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
      for (const side of [-1, 1]) {
        const a = ang + side * (1.05 - t * .25); const mx = px + Math.cos(a) * len * .5, my = py + Math.sin(a) * len * .5;
        const s0 = clamp(.55 + t * .3 + (r() - .5) * .12, .4, 1);
        leafShape(g, mx, my, len, len * .2, a + Math.PI / 2, shadeCol(s0, r() * .6), true);
      }
    }
  }
  function drawFlowers(g, ox, oy, S, seed) {
    drawBroad(g, ox, oy, S, seed + 3, true);
    const r = rnd(seed); const cx = ox + S / 2, cy = oy + S / 2, R = S * .4;
    const pals = [['#ffd0e4', '#ff7fb2'], ['#fff8f0', '#ffd34a'], ['#ffe27a', '#f0a02c'], ['#d9c2ff', '#9b6cff'], ['#ff9f8a', '#ffd34a'], ['#fdfdff', '#ff8fbd']];
    for (let i = 0; i < 46; i++) {
      const a = r() * TAU, d = Math.pow(r(), .7) * R; const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * .9 - S * .02; const rad = S * (.028 + r() * .02);
      const [pc, cc] = pals[Math.floor(r() * pals.length)];
      g.fillStyle = pc; for (let k = 0; k < 5; k++) { const b = k / 5 * TAU + r() * .4; g.beginPath(); g.ellipse(x + Math.cos(b) * rad * .62, y + Math.sin(b) * rad * .62, rad * .58, rad * .42, b, 0, TAU); g.fill(); }
      g.fillStyle = cc; g.beginPath(); g.arc(x, y, rad * .34, 0, TAU); g.fill();
    }
  }
  function drawBerries(g, ox, oy, S, seed) {
    drawBroad(g, ox, oy, S, seed + 5, true);
    const r = rnd(seed); const cx = ox + S / 2, cy = oy + S / 2, R = S * .38;
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
    for (let i = 0; i < 26; i++) {
      const x = ox + S * (.12 + r() * .76), h = S * (.55 + r() * .42), bend = (r() - .5) * S * .12; const w = S * (.012 + r() * .012);
      g.fillStyle = shadeCol(.5 + r() * .35, r() * .5); g.beginPath(); g.moveTo(x - w, oy + S); g.quadraticCurveTo(x + bend * .4, oy + S - h * .6, x + bend, oy + S - h); g.quadraticCurveTo(x + bend * .4 + w * .4, oy + S - h * .55, x + w, oy + S); g.fill();
    }
    for (let i = 0; i < 6; i++) {
      const x = ox + S * (.2 + r() * .6), top = oy + S * (.06 + r() * .25), y1 = top + S * (.1 + r() * .05);
      g.strokeStyle = '#6f8a3a'; g.lineWidth = S * .008; g.beginPath(); g.moveTo(x, oy + S); g.lineTo(x, top - S * .04); g.stroke();
      g.fillStyle = '#7a4a24'; g.beginPath(); g.ellipse(x, (top + y1) / 2, S * .022, (y1 - top) / 2, 0, 0, TAU); g.fill();
    }
  }
  L.foliageAtlas = function () {
    if (L._fatlas) return L._fatlas;
    const S = 512, c = document.createElement('canvas'); c.width = S * 4; c.height = S * 2; const g = c.getContext('2d');
    drawBroad(g, 0, 0, S, 11, false); drawBroad(g, S, 0, S, 27, true); drawNeedles(g, 0, S, S, 5); drawStrands(g, S, S, S, 9);
    drawFern(g, 2 * S, 0, S, 41); drawFlowers(g, 3 * S, 0, S, 43); drawReeds(g, 2 * S, S, S, 47); drawBerries(g, 3 * S, S, S, 53);
    const t = L.bleedTexture(c, 4, 2); t.anisotropy = 4; L._fatlas = t; return t;
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
  // cells: 0 broadleaf A, 1 broadleaf B, 2 needles, 3 willow strands, 4 fern frond, 5 flowers, 6 reeds, 7 berries on leaves
  const QUAD_UV = [[0, .5], [.25, .5], [0, 0], [.25, 0], [.5, .5], [.75, .5], [.5, 0], [.75, 0]]; L.QUAD_UV = QUAD_UV;

  // ---------- foliage material: camera-facing leaf cards with wind & soft back-light ----------
  const foliageVert = (sh) => {
    sh.uniforms.uTime = L.uTime; sh.uniforms.uWind = sh.uniforms.uWind || { value: 1 };
    sh.vertexShader = 'attribute vec2 aOff; uniform float uTime, uWind; varying float vViewZ;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz; float isc = length(instanceMatrix[0].xyz);
        #else
          vec3 ip = vec3(0.); float isc = 1.;
        #endif
        vec3 wpp = (modelMatrix * vec4(ip, 1.)).xyz; float ph = wpp.x * .21 + wpp.z * .17;
        float hgt = max(position.y, 0.);
        float sw = (sin(uTime * 1.25 + ph) * .65 + sin(uTime * 2.6 + ph * 1.7 + position.x) * .22) * uWind * hgt * .022;
        transformed.x += sw; transformed.z += sw * .6;`)
      .replace('#include <project_vertex>', `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        vec2 o = aOff * isc * length(modelMatrix[0].xyz);
        o += vec2(sin(uTime * 2.3 + ph + position.y * 2.1), cos(uTime * 1.9 + ph + position.x * 1.7)) * .035 * uWind * isc;
        mvPosition.xy += o; vViewZ = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  L.makeFoliageMat = function (opts) {
    opts = opts || {}; const map = L.foliageAtlas();
    const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: .42, side: THREE.DoubleSide, roughness: 1, metalness: 0, color: opts.color != null ? opts.color : 0xffffff });
    const wind = { value: opts.wind == null ? 1 : opts.wind };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uWind = wind; foliageVert(sh);
      sh.uniforms.uPlayer = L.uPlayer;
      sh.fragmentShader = 'varying float vViewZ; uniform vec3 uPlayer;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `vec4 texelColor = texture2D( map, vUv ); texelColor = mapTexelToLinear( texelColor ); diffuseColor *= texelColor;
          float tg = max(texelColor.g, .02); float fsat = max(smoothstep(1.1, 1.35, texelColor.r / tg), smoothstep(.74, .92, texelColor.b / tg)); // petals & berries keep their colour, grey-green leaves take the tint`)
        .replace('#include <color_fragment>', `#ifdef USE_COLOR
            diffuseColor.rgb *= mix(vColor, vec3(clamp(dot(vColor, vec3(.33)) * 1.5, .55, 1.05)), fsat);
          #endif`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (vViewZ < 3.2 && dn > (vViewZ - .6) / 2.6) discard;
          vec3 pv = (viewMatrix * vec4(uPlayer + vec3(0., 1.1, 0.), 1.)).xyz;
          if (-pv.z > .5 && vViewZ < -pv.z - .6) { vec2 dxy = (-vViewPosition.xy) / vViewZ - pv.xy / -pv.z; float cut = 1. - smoothstep(.07, .2, length(dxy * vec2(1., 1.25))); if (dn < cut * .92) discard; }`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          #if NUM_DIR_LIGHTS > 0
            float bl = pow(max(dot(normalize(-vViewPosition), directionalLights[0].direction), 0.), 4.);
            reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * bl * .45;
          #endif
          reflectedLight.indirectDiffuse += diffuseColor.rgb * .05;`);
    };
    mat.customProgramCacheKey = () => 'foliage-v3';
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: .42 });
    dm.onBeforeCompile = sh => { sh.uniforms.uWind = wind; foliageVert(sh); sh.vertexShader = sh.vertexShader.replace('varying float vViewZ;', 'float vViewZ;'); };
    dm.customProgramCacheKey = () => 'foliage-depth-v1';
    mat.userData.depth = dm; mat.userData.wind = wind;
    return mat;
  };
  L.applyFoliage = function (mesh, mat) { mesh.material = mat; mesh.customDepthMaterial = mat.userData.depth; return mesh; };

  // ---------- canopy cards sampled on a Blender canopy surface ----------
  // opts: { n, size:[a,b], quads:[..], inset, hang:{below, quad, aspect} , seed }
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
      let shade = .52 + .32 * hN + .22 * Math.max(n.y, 0) - inset * .35 + (r() - .5) * .1; shade = clamp(shade, .38, 1.12);
      let q = opts.quads[Math.floor(r() * opts.quads.length)], w = size, h = size, rot = r() * TAU;
      if (opts.hang && hN < opts.hang.below && r() < (opts.hang.p || .85)) { q = opts.hang.quad; w = size * .7; h = size * opts.hang.aspect; rot = (r() - .5) * .25; p.y -= h * .25; }
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

  // ---------- grass: patch of tapered blades, normals up so it blends with the ground ----------
  L.grassPatchGeo = function (blades, radius, seed) {
    const r = rnd(seed || 3); const pos = [], nor = [], col = [], at = [], ind = [];
    for (let i = 0; i < blades; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * radius, bx = Math.cos(a) * d, bz = Math.sin(a) * d;
      const h = .32 + r() * .5, w = .055 + r() * .05, rot = r() * TAU, lean = (.15 + r() * .3) * h; const ca = Math.cos(rot), sa = Math.sin(rot);
      const shade = .85 + r() * .3; const base = pos.length / 3;
      const pts = [[-w / 2, 0, 0], [w / 2, 0, 0], [-w * .36, .55, .3], [w * .36, .55, .3], [0, 1, 1]];
      for (const [px, t, lt] of pts) {
        const lx = px, lz = lean * lt * lt; const x = bx + lx * ca - lz * sa, z = bz + lx * sa + lz * ca;
        pos.push(x, t * h, z); nor.push(0, 1, 0); at.push(t);
        const k = lerp(.52, 1.2, t) * shade; col.push(k * (1 + t * .1), k * (1 + t * .03), k * (1 - t * .16));
      }
      ind.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1)); g.setIndex(ind);
    return g;
  };
  L.makeGrassMat = function () {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = L.uTime; sh.uniforms.uPlayer = L.uPlayer;
      sh.vertexShader = 'attribute float aT; uniform float uTime; uniform vec3 uPlayer;\n' + sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz; float isc = length(instanceMatrix[0].xyz);
        #else
          vec3 ip = vec3(0.); float isc = 1.;
        #endif
        vec3 wp = ip + position * isc; float t2 = aT * aT;
        float g1 = sin(uTime * 1.7 + wp.x * .23 + wp.z * .17) * .5 + .5;
        float gust = sin(uTime * .55 + wp.x * .045 - wp.z * .035) * .5 + .5;
        vec2 bend = vec2(.8, .5) * (g1 * .45 + gust * gust * .9) * t2 * .32;
        vec2 dp = wp.xz - uPlayer.xz; float dd = length(dp) + .0001; bend += dp / dd * smoothstep(1.4, .1, dd) * t2 * .6;
        transformed.xz += bend / isc; transformed.y -= dot(bend, bend) * .8 / isc;`);
      sh.fragmentShader = sh.fragmentShader.replace(/gl_FrontFacing/g, 'true');
    };
    mat.customProgramCacheKey = () => 'grass-v1';
    return mat;
  };

  // ---------- meadow flower clump (heads + a few leaves, no tall stems) ----------
  L.flowerTex = function () {
    const r = rnd(31), W = 256, H = 184, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    for (let i = 0; i < 14; i++) leafShape(g, 30 + r() * 196, H - 10 - r() * 40, 44 + r() * 30, 9 + r() * 5, (r() - .5) * .9, shadeCol(.4 + r() * .25, 0), false);
    const pals = [['#fffaf0', '#ffd34a'], ['#ffe066', '#e89a2c'], ['#ff9ec4', '#ffd84a'], ['#c7a6ff', '#ffe27a'], ['#9fd2ff', '#fff2a8'], ['#ff8a6b', '#ffd34a']];
    for (let i = 0; i < 9; i++) {
      const [pc, cc] = pals[Math.floor(r() * pals.length)]; const x = 28 + r() * 200, y = 40 + r() * 80, rad = 9 + r() * 7;
      g.strokeStyle = '#4f8a35'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 10, H - 6); g.stroke();
      g.fillStyle = pc; for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + r() * .3; g.beginPath(); g.ellipse(x + Math.cos(a) * rad * .62, y + Math.sin(a) * rad * .62, rad * .55, rad * .4, a, 0, TAU); g.fill(); }
      g.fillStyle = cc; g.beginPath(); g.arc(x, y, rad * .32, 0, TAU); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  };

  // ---------- bushes: leaf cards on a union of ellipsoids (same painterly look as the trees) ----------
  // blobs: [[x,y,z,rx,ry,rz],...]; opts: {n, size:[a,b], quads:[..], extra:{quad, p, top}} (extra = flower/berry cells mixed in)
  L.blobCards = function (blobs, opts) {
    const r = rnd(opts.seed || 7); const pos = [], off = [], uv = [], nor = [], col = [], ind = [];
    let ymin = 1e9, ymax = -1e9, cx = 0, cy = 0, cz = 0, wsum = 0; const areas = [];
    for (const b of blobs) { ymin = Math.min(ymin, b[1] - b[4]); ymax = Math.max(ymax, b[1] + b[4]); const a = b[3] * b[4] + b[4] * b[5] + b[3] * b[5]; areas.push(a); wsum += a; cx += b[0] * a; cy += b[1] * a; cz += b[2] * a; }
    cx /= wsum; cy /= wsum; cz /= wsum; const H = Math.max(ymax - ymin, .01);
    const inside = (x, y, z, skip) => { for (let k = 0; k < blobs.length; k++) { if (k === skip) continue; const b = blobs[k]; const dx = (x - b[0]) / b[3], dy = (y - b[1]) / b[4], dz = (z - b[2]) / b[5]; if (dx * dx + dy * dy + dz * dz < .9) return true; } return false; };
    let made = 0, tries = 0;
    while (made < opts.n && tries++ < opts.n * 40) {
      let pick = r() * wsum, k = 0; while (pick > areas[k] && k < blobs.length - 1) { pick -= areas[k]; k++; }
      const b = blobs[k]; const u = r() * 2 - 1, a = r() * TAU, sq = Math.sqrt(1 - u * u); let dx = sq * Math.cos(a), dy = u, dz = sq * Math.sin(a);
      if (dy < -.55 && r() < .8) continue; // few cards underneath
      const px = b[0] + dx * b[3], py = b[1] + dy * b[4], pz = b[2] + dz * b[5];
      if (inside(px, py, pz, k) || py < 0.02) continue;
      let nx = dx / b[3], ny = dy / b[4], nz = dz / b[5]; let nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      let ddx = px - cx, ddy = (py - cy) * 1.3, ddz = pz - cz; const dl = Math.hypot(ddx, ddy, ddz) || 1; nx = nx * .5 + ddx / dl * .5; ny = ny * .5 + ddy / dl * .5 + .15; nz = nz * .5 + ddz / dl * .5; nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const size = lerp(opts.size[0], opts.size[1], r()); const inset = r() * (opts.inset == null ? .3 : opts.inset);
      const qx = px - nx * inset * size, qy = Math.max(py - ny * inset * size, size * .25), qz = pz - nz * inset * size;
      const hN = clamp((qy - ymin) / H, 0, 1);
      let shade = clamp(.5 + .34 * hN + .2 * Math.max(ny, 0) - inset * .35 + (r() - .5) * .1, .36, 1.1);
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
      // a quad bent in two segments (base, mid, tip) for a natural arch
      const segs = [[0, 0], [.5, .55], [1, 1]];
      for (const [t, vv] of segs) {
        const droop = t * t * (opts.droop || .35); const along = t * len * ct, up = t * len * st - droop * len;
        const px = bx + ca * along, pz = bz + sa * along, py = up + .02;
        for (const ex of [-.5, .5]) { const wx = -sa * ex * wid * (1 - t * .35), wz = ca * ex * wid * (1 - t * .35); pos.push(px + wx, py, pz + wz); off.push(0, 0); uv.push(u0 + .002 + (ex + .5) * .246, v0 + .004 + vv * .492); nor.push(ca * .3, .95, sa * .3); const k = sh * lerp(.62, 1.05, t); col.push(k, k, k); }
      }
      for (let s2 = 0; s2 < 2; s2++) { const a0 = base + s2 * 2; ind.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ind);
    g.computeBoundingSphere(); return g;
  };

  // ---------- cumulus cloud textures ----------
  L.cloudTex = function (seed) {
    const r = rnd(seed), W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const base = H * .82; const puffs = [];
    const n = 9 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) { const t = (i + .5) / n; const x = W * (.12 + t * .76) + (r() - .5) * 30; const mid = 1 - Math.abs(t - .5) * 1.7; const rad = (34 + r() * 40) * (.55 + mid * .75); puffs.push([x, base - rad * (.35 + r() * .45) - mid * 40, rad]); }
    for (let i = 0; i < 6; i++) { const x = W * (.3 + r() * .4); const rad = 40 + r() * 35; puffs.push([x, base - 70 - r() * 70, rad]); }
    g.save(); g.beginPath(); g.rect(0, 0, W, base + 2); g.clip();
    for (const [x, y, rad] of puffs) { const gr = g.createRadialGradient(x - rad * .3, y - rad * .35, rad * .1, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.55, 'rgba(250,251,255,1)'); gr.addColorStop(.86, 'rgba(226,232,246,1)'); gr.addColorStop(1, 'rgba(214,222,240,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill(); }
    g.restore();
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, base - 110, 0, base); sh.addColorStop(0, 'rgba(160,172,210,0)'); sh.addColorStop(1, 'rgba(150,160,205,.55)'); g.fillStyle = sh; g.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  };
  L.buildClouds = function () {
    // cumulus ring that travels with the camera (the island is 3 km wide: clouds always sit on the horizon)
    const r = rnd(77); const texs = [1, 2, 3, 4].map(s => L.cloudTex(s * 13)); L.cloudMats = [];
    const grp = new THREE.Group(); grp.name = 'clouds'; L.scene.add(grp); L.cloudGroup = grp;
    const add = (x, y, z, w, op) => { const m = new THREE.SpriteMaterial({ map: texs[Math.floor(r() * texs.length)], transparent: true, depthWrite: false, fog: false, opacity: op || .96 }); const s = new THREE.Sprite(m); s.position.set(x, y, z); s.scale.set(w, w * .5, 1); s.renderOrder = -1; grp.add(s); L.cloudMats.push(m); return s; };
    for (let i = 0; i < 26; i++) { const a = i / 26 * TAU + r() * .2, d = 2300 + r() * 700, w = 700 + r() * 650; add(Math.cos(a) * d, 160 + r() * 260 + w * .12, Math.sin(a) * d, w); }
    for (let i = 0; i < 9; i++) { const a = r() * TAU, d = 900 + r() * 900, w = 260 + r() * 220; add(Math.cos(a) * d, 700 + r() * 300, Math.sin(a) * d, w, .82); }
  };
  L.tickClouds = function (cam, t) { const g = L.cloudGroup; if (!g) return; g.position.set(cam.position.x, 0, cam.position.z); g.rotation.y = t * .0025; };
})(window.L);
