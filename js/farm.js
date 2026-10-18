/* Lumiar v5 farming (L.farm): crops planted in plots (the build item `canteiro`, or free spots in shallow water for
   lotus), real-time growth that keeps going while nobody plays, watering (x2 for 10 min), the Brotar spell, harvest
   (produce + seeds), and the crop meshes on the plots near the player (m/crops5.json objects <model>_<stage>, or
   procedural meshes while that file does not exist).

   Records: one f5 row per planted plot, id = the canteiro build id (b5), so a crop survives edits of the build
   record; free water spots use ids "lw_<x>_<z>". Fields (all times in server ms from L.clock.now()):
     crop  key of L.CROPS          pt  planted at            by  planter (player key)
     x,y,z,r  plot position/rotation (copied from the build at planting)   wp  1 = water plot   free 1 = no build
     g     growth banked (effective ms) at gt (server ms) / gg (game ms, for the night-only flower)
     wu    watered until (server ms)   ho  1 = planted with a hoe (x1.5)   st  stage at the time of the last write
     bd    in-game day of the last Brotar on the moon flower
   Effective growth since the bank: normal crops (now - gt) * rate, plus the same again for the part of it that is
   watered; the moon flower counts only in-game night time (18:00-06:00) of the game interval [gg, game now] (a night
   skipped by sleeping counts as a night that passed).
   Stage changes are never written: every client computes the same stage from the shared record and the shared
   server clock, so both players see the crop grow at the same moment, offline time included.
   A canteiro dismantled on this device (b5 deleted locally) hands its crop back automatically (removePlot). */
'use strict';
(function (L) {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const MIN = 60e3, HOUR = 3600e3;
  const C = () => L.clock || { now: () => Date.now(), gameMs: () => Date.now(), isNight: () => false, day: () => 0, DAY_LEN: 1440 };

  // ================================================================ crops (GDD 6.2)
  // grow: effective ms from seed to ripe; th: progress thresholds of each stage; give/seeds: [min, max] at harvest
  const CROPS = L.CROPS = {
    trigo: { n: 'Trigo', ic: '🌾', model: 'wheat', seed: 'sem_trigo', grow: 20 * MIN, th: [0, .2, .55, 1], give: ['trigo', 3, 4], seeds: [1, 2] },
    cenoura: { n: 'Cenoura', ic: '🥕', model: 'carrot', seed: 'sem_cenoura', grow: 25 * MIN, th: [0, .2, .55, 1], give: ['cenoura', 2, 3], seeds: [1, 2] },
    abobora: { n: 'Abóbora', ic: '🎃', model: 'pumpkin', seed: 'sem_abobora', alt: ['sementes'], grow: 40 * MIN, th: [0, .2, .55, 1], give: ['abobora', 1, 2], seeds: [1, 2] },
    morango: { n: 'Morango', ic: '🍓', model: 'strawberry', seed: 'sem_morango', grow: 30 * MIN, th: [0, .2, .55, 1], give: ['morango', 3, 5], seeds: [0, 1], regrow: 2 },
    ervas: { n: 'Ervas', ic: '🌿', model: 'herbs', seed: 'sem_ervas', grow: 12 * MIN, th: [0, .2, .55, 1], give: ['ervas', 2, 3], seeds: [1, 1] },
    lotus: { n: 'Lótus', ic: '🪷', model: 'lotus', seed: 'sem_lotus', grow: 30 * MIN, th: [0, .45, 1], give: ['lotus', 1, 2], seeds: [1, 1], water: true },
    // ~36 h of real time: 18 h of in-game night (half of every day), x2 while watered; opens only at night
    lua: { n: 'Flor da Lua', ic: '🌙', model: 'moonflower', seed: 'sem_lua', grow: 18 * HOUR, th: [0, .2, .55, 1], give: ['flor_lua', 1, 1], seeds: [1, 1], night: true },
  };
  const STAGE_N = ['Semente', 'Broto', 'Crescendo', 'Maduro'];
  const stageName = (crop, s) => { const K = CROPS[crop]; if (!K) return ''; return s >= K.th.length - 1 ? STAGE_N[3] : STAGE_N[Math.min(s, 2)]; };
  const CFG = {
    waterMs: 10 * MIN,       // one watering doubles growth for 10 min
    hoeRate: 1.5,            // planted with a hoe (enxada): normal crops grow 1.5x
    moonBoost: HOUR,         // Brotar on the moon flower: +1 h of night growth, once per in-game day
    visR: 60, visOut: 72,    // crop meshes for plots within visR m of the player
    soilY: .3,               // soil surface above the canteiro record's y (raised bed)
    plotTypes: ['canteiro'], // build items that are plots
    spotMin: 1.6,            // free water spots: minimum distance between two
  };
  // names/icons for game.js's item table (merged with what survival.js put there)
  L.ITEMS5 = L.ITEMS5 || {};
  Object.assign(L.ITEMS5, {
    sem_trigo: { n: 'Sementes de trigo', ic: '🌱', seed: 'trigo' }, sem_cenoura: { n: 'Sementes de cenoura', ic: '🌱', seed: 'cenoura' },
    sem_abobora: { n: 'Sementes de abóbora', ic: '🌱', seed: 'abobora' }, sem_morango: { n: 'Mudas de morango', ic: '🌱', seed: 'morango' },
    sem_ervas: { n: 'Sementes de ervas', ic: '🌱', seed: 'ervas' }, sem_lotus: { n: 'Muda de lótus', ic: '🌱', seed: 'lotus' },
    sem_lua: { n: 'Semente da Flor da Lua', ic: '✨', seed: 'lua' },
    trigo: { n: 'Trigo', ic: '🌾' }, abobora: { n: 'Abóbora', ic: '🎃' }, ervas: { n: 'Ervas', ic: '🌿' }, lotus: { n: 'Lótus', ic: '🪷' },
    flor_lua: { n: 'Flor da Lua', ic: '🌙' },
  });
  for (const k of ['cenoura', 'morango']) if (!L.ITEMS5[k]) L.ITEMS5[k] = { n: CROPS[k].n, ic: CROPS[k].ic };
  // wild plants (scatter kinds) that give the first seeds when picked: item -> [min, max, chance]
  const WILD = {
    wild_wheat: { trigo: [1, 1, 1], sem_trigo: [1, 2, 1], sem_abobora: [1, 1, .15] },
    wild_carrot: { cenoura: [1, 1, 1], sem_cenoura: [1, 2, 1], sem_ervas: [1, 1, .25] },
    berry_bush: { frutinhas: [2, 4, 1], sem_morango: [1, 1, .2] },
  };
  function wildYield(kind, rand) {
    const W = WILD[kind]; if (!W) return null; rand = rand || Math.random; const out = {};
    for (const k in W) { const [a, b, ch] = W[k]; if (rand() <= ch) out[k] = a + Math.floor(rand() * (b - a + 1)); }
    return out;
  }

  // ================================================================ growth math (pure; same on every client)
  const DAY_MS = () => (C().DAY_LEN || 1440) * 1000;
  // in-game night ms (18:00-06:00) in [0, g] of game time
  function nightCum(g) {
    const D = DAY_MS(), d = Math.floor(g / D), u = g - d * D;
    return d * D * .5 + Math.min(u, D * .25) + Math.max(0, u - D * .75);
  }
  const nightIn = (a, b) => b > a ? nightCum(b) - nightCum(a) : 0;
  // effective growth ms of record r at server time now / game time gnow
  function effMs(r, now, gnow) {
    const K = CROPS[r.crop]; if (!K) return 0;
    const t0 = r.gt != null ? r.gt : r.pt != null ? r.pt : now, g = +r.g || 0;
    const dt = Math.max(0, now - t0);
    const wdt = r.wp ? dt : Math.max(0, Math.min(now, +r.wu || 0) - t0);
    if (K.night) {
      const g0 = r.gg != null ? r.gg : gnow - dt, g1 = Math.max(g0, gnow);
      return g + nightIn(g0, g1) + nightIn(g0, Math.min(g1, g0 + wdt));
    }
    const rate = r.ho ? CFG.hoeRate : 1;
    return g + (dt + wdt) * rate;
  }
  const progress = (r, now, gnow) => { const K = CROPS[r.crop]; return K ? clamp(effMs(r, now, gnow) / K.grow, 0, 1) : 0; };
  function stageOf(crop, p) { const th = CROPS[crop].th; let s = 0; for (let i = 1; i < th.length; i++) if (p >= th[i] - 1e-9) s = i; return s; }
  const lastStage = crop => CROPS[crop].th.length - 1;
  // bank the growth so far (before changing wu / g)
  const bank = (r, now, gnow) => { const g = Math.round(effMs(r, now, gnow)); return { g, gt: now, gg: gnow, st: CROPS[r.crop] ? stageOf(r.crop, clamp(g / CROPS[r.crop].grow, 0, 1)) : 0 }; };
  // estimated real ms until ripe (current watering counted; no future watering)
  function timeLeft(r, now, gnow) {
    const K = CROPS[r.crop]; if (!K) return 0; let need = K.grow - effMs(r, now, gnow); if (need <= 0) return 0;
    const wRem = r.wp ? Infinity : Math.max(0, (+r.wu || 0) - now);
    if (!K.night) {
      const rate = r.ho ? CFG.hoeRate : 1, fast = 2 * rate;
      return need <= wRem * fast ? need / fast : wRem + (need - wRem * fast) / rate;
    }
    // walk forward through days and nights (a night runs 18:00 -> 06:00)
    const D = DAY_MS(); let t = 0, g = gnow;
    for (let guard = 0; guard < 5000 && need > 0; guard++) {
      const u = ((g % D) + D) % D; let night, step;
      if (u < D * .25) { night = true; step = D * .25 - u; } else if (u < D * .75) { night = false; step = D * .75 - u; } else { night = true; step = D - u + D * .25; }
      if (!night) { t += step; g += step; continue; }
      const w = t < wRem ? 2 : 1; if (w === 2) step = Math.min(step, wRem - t);
      if (need <= step * w) { t += need / w; need = 0; break; }
      need -= step * w; t += step; g += step;
    }
    return t;
  }

  // ================================================================ events
  const H = {};
  const on = (n, fn) => { (H[n] || (H[n] = [])).push(fn); return () => { const l = H[n], i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); }; };
  const emit = (n, a) => { const l = H[n]; if (l) for (const fn of l.slice()) { try { fn(a); } catch (e) { console.warn('[farm]', n, e); } } };
  const story = (n, d) => { try { if (L.story && L.story.event) L.story.event(n, d); } catch (e) { console.warn('[farm] story', e); } };

  // ================================================================ store (L.save, or memory without it)
  const MEM = new Map();
  const hasSave = () => !!(L.save && L.save.set && L.save.ready);
  const DB = {
    get: id => hasSave() ? L.save.get('f5', id) : MEM.get(id) || null,
    all: () => hasSave() ? L.save.all('f5') : MEM,
    set(id, d) { if (hasSave()) L.save.set('f5', id, d); else MEM.set(id, Object.assign({}, d, { ts: C().now() })); index(id, d); },
    del(id) { if (hasSave()) L.save.del('f5', id); else MEM.delete(id); index(id, null); },
  };
  const me = () => (L.save && L.save.key) || 'eu';
  const player = () => (L.save && L.save.player) || null;
  const buildRec = id => { try { return L.save && L.save.get ? L.save.get('b5', id) : null; } catch (e) { return null; } };
  const isPlotRec = b => !!(b && CFG.plotTypes.indexOf(b.t) >= 0);

  // ---------------------------------------------------------------- spatial index of planted plots (32 m cells)
  const CELL = 32, GRID = new Map(), WHERE = new Map();
  const ck = (x, z) => Math.floor(x / CELL) * 65537 + Math.floor(z / CELL);
  function index(id, d) {
    const old = WHERE.get(id); if (old != null) { const s = GRID.get(old); if (s) { s.delete(id); if (!s.size) GRID.delete(old); } WHERE.delete(id); }
    if (d && d.crop && isFinite(d.x) && isFinite(d.z)) { const k = ck(d.x, d.z); let s = GRID.get(k); if (!s) GRID.set(k, s = new Set()); s.add(id); WHERE.set(id, k); }
  }
  function reindex() { GRID.clear(); WHERE.clear(); for (const [id, d] of DB.all()) index(id, d); }
  function near(x, z, r, fn) {
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) { const s = GRID.get(i * 65537 + j); if (!s) continue; for (const id of s) { const d = DB.get(id); if (d && d.crop && Math.hypot(d.x - x, d.z - z) <= r) fn(id, d); } }
  }

  // ================================================================ plots
  const soilY = b => (L.farm && typeof L.farm.soilOf === 'function' ? L.farm.soilOf(b) : CFG.soilY);
  function waterAt(x, z) { try { return L.waterAt ? L.waterAt(x, z) : -Infinity; } catch (e) { return -Infinity; } }
  const isWaterPlot = (x, y, z) => waterAt(x, z) > y - .05;
  // where a plot is: {id, x, y (soil surface), z, r, wp, free, rec (f5 or null), b (build rec or null)}
  function plotInfo(id, opt) {
    opt = opt || {}; const rec = DB.get(id), b = buildRec(id);
    if (isPlotRec(b)) { const y = b.y + soilY(b); return { id, x: b.x, y, z: b.z, r: b.r || 0, wp: (b.water || isWaterPlot(b.x, y, b.z)) ? 1 : 0, free: 0, rec, b }; }
    if (rec && rec.crop) return { id, x: rec.x, y: rec.y, z: rec.z, r: rec.r || 0, wp: rec.wp ? 1 : 0, free: rec.free ? 1 : 0, rec, b: null };
    if (opt.x != null) { const y = opt.y != null ? +opt.y : (L.ground ? L.ground(opt.x, opt.z) : 0); return { id, x: +opt.x, y, z: +opt.z, r: +opt.r || 0, wp: (opt.water || isWaterPlot(opt.x, y, opt.z)) ? 1 : 0, free: opt.free ? 1 : 0, rec: null, b: null }; }
    return null;
  }
  const nowT = () => C().now(), gameT = () => C().gameMs ? C().gameMs() : nowT();
  function stage(idOrRec) {
    const r = typeof idOrRec === 'string' ? DB.get(idOrRec) : idOrRec; if (!r || !CROPS[r.crop]) return -1;
    return stageOf(r.crop, progress(r, nowT(), gameT()));
  }
  function info(id) {
    const r = DB.get(id); if (!r || !CROPS[r.crop]) return { id, empty: true, crop: null, stage: -1 };
    const K = CROPS[r.crop], now = nowT(), g = gameT(), p = progress(r, now, g), s = stageOf(r.crop, p), last = lastStage(r.crop);
    const ripe = s === last, night = C().isNight ? C().isNight() : false, wLeft = r.wp ? Infinity : Math.max(0, (+r.wu || 0) - now);
    return { id, empty: false, crop: r.crop, n: K.n, ic: K.ic, stage: s, stages: last + 1, stageName: stageName(r.crop, s), progress: p, ripe,
      open: ripe && (!K.night || night), canHarvest: ripe && (!K.night || night), watered: wLeft > 0, waterLeft: wLeft, waterPlot: !!r.wp,
      left: ripe ? 0 : timeLeft(r, now, g), by: r.by, mine: r.by === me(), night: !!K.night };
  }
  function fmtLeft(ms) { const m = Math.ceil(ms / MIN); if (m < 60) return '~' + m + ' min'; const h = Math.round(ms / HOUR); return '~' + h + ' h'; }
  // seeds the player has for this plot (water plots take lotus only, dry plots everything else)
  function seedsFor(id, inv, opt) {
    inv = inv || ((player() && player().inv) || {}); const pl = typeof id === 'object' ? id : plotInfo(id, opt); const out = [];
    for (const k in CROPS) {
      const K = CROPS[k]; if (pl && !!K.water !== !!pl.wp) continue;
      const have = [K.seed].concat(K.alt || []).find(s => (inv[s] || 0) > 0); if (have) out.push({ crop: k, seed: have, n: inv[have], ic: K.ic, name: K.n });
    }
    return out;
  }
  function canPlant(id, crop, opt) {
    opt = opt || {}; const K = CROPS[crop]; if (!K) return { ok: false, why: 'Semente desconhecida' };
    const pl = plotInfo(id, opt); if (!pl) return { ok: false, why: 'Aqui não dá para plantar' };
    if (pl.rec && pl.rec.crop) return { ok: false, why: 'Já tem uma planta aqui' };
    if (K.water && !pl.wp) return { ok: false, why: 'Essa planta precisa de água' };
    if (!K.water && pl.wp) return { ok: false, why: 'Aqui está alagado' };
    if (opt.pay !== false) { const inv = (player() && player().inv) || opt.inv; const have = inv && [K.seed].concat(K.alt || []).find(s => (inv[s] || 0) > 0); if (!have) return { ok: false, why: 'Sem sementes de ' + K.n.toLowerCase() }; }
    return { ok: true, plot: pl };
  }
  // plant crop in plot id (a canteiro build id, or any id with opt {x,y,z,r,water,free})
  function plant(id, crop, opt) {
    opt = opt || {}; const chk = canPlant(id, crop, opt); if (!chk.ok) return chk; const pl = chk.plot, K = CROPS[crop];
    if (opt.pay !== false) { const inv = (player() && player().inv) || opt.inv; const s = [K.seed].concat(K.alt || []).find(x => (inv[x] || 0) > 0); inv[s]--; if (inv[s] <= 0) delete inv[s]; if (L.save && L.save.dirty) L.save.dirty(); }
    const now = nowT(), g = gameT();
    const rec = { crop, pt: now, by: me(), x: +(+pl.x).toFixed(2), y: +(+pl.y).toFixed(2), z: +(+pl.z).toFixed(2), r: +(+pl.r || 0).toFixed(3), wp: pl.wp, g: 0, gt: now, gg: g, wu: 0, st: 0 };
    if (pl.free) rec.free = 1; if (opt.hoe && !K.night) rec.ho = 1;
    DB.set(id, rec); SEEN.delete(id); refreshVis(id);
    emit('planted', { id, crop, by: rec.by, x: rec.x, z: rec.z }); story('planted', { crop, id, x: rec.x, z: rec.z });
    return { ok: true, id, crop };
  }
  // a lotus straight into shallow water (no canteiro): id derived from the spot
  function waterSpot(x, z) {
    const w = waterAt(x, z), gy = L.ground ? L.ground(x, z) : w - 1; const depth = w - gy;
    if (!(w > -Infinity) || depth < .15 || depth > 2.6) return null;
    let clash = false; near(x, z, CFG.spotMin, () => { clash = true; }); if (clash) return null;
    return { x, y: w, z, id: 'lw_' + Math.round(x * 2) + '_' + Math.round(z * 2) };
  }
  function plantAt(x, z, crop, opt) {
    crop = crop || 'lotus'; const sp = waterSpot(x, z); if (!sp) return { ok: false, why: 'Precisa de água rasa' };
    return plant(sp.id, crop, Object.assign({}, opt, { x: sp.x, y: sp.y, z: sp.z, water: true, free: true }));
  }
  function ids(target) {
    if (typeof target === 'string') return DB.get(target) ? [target] : [];
    if (Array.isArray(target)) return target.filter(id => DB.get(id));
    const out = []; if (target && target.x != null) near(+target.x, +target.z, target.r || 4, id => out.push(id)); return out;
  }
  // water one plot (id) or every plot within {x, z, r} (bucket, Maré, rain)
  function water(target, opt) {
    opt = opt || {}; const now = nowT(), g = gameT(), done = [];
    for (const id of ids(target)) {
      const r = DB.get(id); if (!r || !CROPS[r.crop] || r.wp) continue;
      if (stageOf(r.crop, progress(r, now, g)) === lastStage(r.crop)) continue; // ripe: nothing to grow
      DB.set(id, Object.assign({}, r, bank(r, now, g), { wu: now + (opt.ms || CFG.waterMs) })); refreshVis(id); done.push(id);
    }
    if (done.length) emit('watered', { ids: done });
    return done.length;
  }
  // Brotar: every crop within r m grows one stage (the moon flower: +1 h of night growth, once per in-game day);
  // berry bushes refill through the game's hook L.refillNear(x, z, r)
  function boost(x, z, r, opt) {
    r = r || 4; const now = nowT(), g = gameT(), day = C().day ? C().day() : 0, done = [];
    for (const id of ids({ x, z, r })) {
      const rec = DB.get(id), K = CROPS[rec.crop]; if (!K) continue;
      const s = stageOf(rec.crop, progress(rec, now, g)); if (s >= lastStage(rec.crop)) continue;
      const b = bank(rec, now, g);
      if (K.night) { if (rec.bd === day) continue; b.g = Math.min(K.grow, b.g + CFG.moonBoost); b.bd = day; }
      else b.g = Math.max(b.g, Math.ceil(K.th[s + 1] * K.grow) + 1);
      b.st = stageOf(rec.crop, clamp(b.g / K.grow, 0, 1));
      DB.set(id, Object.assign({}, rec, b)); refreshVis(id); done.push(id);
    }
    let bushes = 0; try { if (L.refillNear) bushes = L.refillNear(x, z, r) || 0; } catch (e) { console.warn('[farm] refillNear', e); }
    if (done.length) emit('boost', { ids: done, x, z });
    return { n: done.length, ids: done, bushes };
  }
  const rnd = (a, b, rand) => a + Math.floor((rand || Math.random)() * (b - a + 1));
  function giveAll(give) {
    const p = player(); if (!p) return; p.inv = p.inv || {};
    for (const k in give) if (give[k] > 0) p.inv[k] = (p.inv[k] || 0) + give[k];
    if (L.save && L.save.dirty) L.save.dirty();
  }
  function harvest(id, opt) {
    opt = opt || {}; const r = DB.get(id); if (!r || !CROPS[r.crop]) return { ok: false, why: 'Nada para colher' };
    const K = CROPS[r.crop], now = nowT(), g = gameT();
    if (stageOf(r.crop, progress(r, now, g)) < lastStage(r.crop)) return { ok: false, why: 'Ainda não está pronto' };
    if (K.night && !(C().isNight && C().isNight())) return { ok: false, why: 'Ela só abre sob a lua' };
    const give = {}; give[K.give[0]] = rnd(K.give[1], K.give[2], opt.rand); const ns = rnd(K.seeds[0], K.seeds[1], opt.rand); if (ns > 0) give[K.seed] = (give[K.seed] || 0) + ns;
    if (K.regrow != null) DB.set(id, Object.assign({}, r, { g: Math.ceil(K.th[K.regrow] * K.grow), gt: now, gg: g, wu: 0, st: K.regrow }));
    else DB.del(id);
    SEEN.delete(id);
    refreshVis(id);
    if (opt.give !== false) giveAll(give);
    const own = r.by === me(), p = player();
    if (p) { p.stats = p.stats || {}; p.stats.harvest = (p.stats.harvest || 0) + 1; if (own) p.stats.harvestOwn = (p.stats.harvestOwn || 0) + 1; p.stats['h_' + r.crop] = (p.stats['h_' + r.crop] || 0) + 1; if (L.save && L.save.dirty) L.save.dirty(); }
    emit('harvest', { id, crop: r.crop, give, own }); story('harvest', { crop: r.crop, n: give[K.give[0]], own, id });
    return { ok: true, crop: r.crop, give, own };
  }
  // the canteiro is being dismantled: ripe crop -> harvest, otherwise the seed comes back
  function removePlot(id, opt) {
    opt = opt || {}; const r = DB.get(id); if (!r || !CROPS[r.crop]) { refreshVis(id); return { ok: true, give: {} }; }
    const K = CROPS[r.crop]; if (stageOf(r.crop, progress(r, nowT(), gameT())) === lastStage(r.crop) && (!K.night || (C().isNight && C().isNight()))) { const h = harvest(id, opt); if (r.crop && K.regrow != null) DB.del(id); refreshVis(id); return h; }
    DB.del(id); refreshVis(id); const give = { [K.seed]: 1 }; if (opt.give !== false) giveAll(give); return { ok: true, give };
  }
  // what the action button shows for this plot: {ic, lb, sub, wait, act: 'plant'|'water'|'harvest'|null}
  function action(id, opt) {
    opt = opt || {}; const pl = plotInfo(id, opt); if (!pl) return null; const i = info(id);
    if (i.empty) { const s = seedsFor(pl, opt.inv); if (!s.length) return { ic: '🌱', lb: 'Plantar', sub: pl.wp ? 'precisa de muda de lótus' : 'sem sementes', wait: true, act: null }; return { ic: s[0].ic, lb: 'Plantar ' + s[0].name.toLowerCase(), sub: s[0].n + '', act: 'plant', crop: s[0].crop, seeds: s }; }
    if (i.canHarvest) return { ic: i.ic, lb: 'Colher ' + i.n.toLowerCase(), act: 'harvest' };
    if (i.ripe) return { ic: '🌙', lb: 'Ela só abre sob a lua', wait: true, act: null };
    if (!i.watered && opt.canWater) return { ic: '💧', lb: 'Regar', sub: i.stageName, act: 'water' };
    return { ic: '⏳', lb: i.stageName + '…', sub: fmtLeft(i.left) + (i.watered && !i.waterPlot ? ' 💧' : ''), wait: true, act: null };
  }
  // default action (game's action button): plant the first seed / harvest / water
  function use(id, opt) {
    opt = opt || {}; const a = action(id, opt); if (!a || !a.act) return { ok: false, why: a ? a.lb : 'Aqui não dá para plantar' };
    if (a.act === 'plant') return plant(id, opt.crop || a.crop, opt);
    if (a.act === 'harvest') return harvest(id, opt);
    if (a.act === 'water') return { ok: water(id) > 0, watered: true };
    return { ok: false };
  }
  // nearest planted plot within r (for targeting free water spots, which have no build record)
  function nearest(x, y, z, r) { let best = null, bd = Infinity; near(x, z, r || 3, (id, d) => { const dd = Math.hypot(d.x - x, d.z - z) + (y != null ? Math.abs(d.y - y) * .5 : 0); if (dd < bd) { bd = dd; best = { id, rec: d, d: dd }; } }); return best; }
  function plots() { const out = []; for (const [id, d] of DB.all()) if (d && d.crop) out.push(Object.assign({ id }, info(id))); return out; }

  // ================================================================ visuals
  const VIS = new Map(); // id -> {grp, key, crop}
  let root = null, MATS = null, crops5 = undefined, crops5Loading = false, visT = 0, stT = 0, px = NaN, pz = NaN;
  const T3 = () => (typeof THREE !== 'undefined' ? THREE : null);
  function mats() {
    if (MATS) return MATS; const TH = T3(); const M = L.MAT || {};
    const crop = new TH.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0, side: TH.DoubleSide });
    if (L.stylize) L.stylize(crop, { wrap: .45, rim: .3, transl: .35 }); if (L.addWind) L.addWind(crop, .22, 1.3);
    const glow = M.glow || new TH.MeshBasicMaterial({ vertexColors: true, color: new TH.Color(2.2, 2.2, 2.2), fog: false });
    const wet = new TH.MeshBasicMaterial({ color: 0x24170e, transparent: true, opacity: .32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return (MATS = { crop, glow, wet });
  }
  function ensureRoot() { const TH = T3(); if (!TH || !L.scene) return null; if (!root) { root = new TH.Group(); root.name = 'farm'; L.scene.add(root); } else if (!root.parent) L.scene.add(root); return root; }
  function loadCrops5() {
    if (crops5 !== undefined || crops5Loading || !L.loadModel) { if (!L.loadModel && crops5 === undefined) crops5 = null; return; }
    crops5Loading = true;
    Promise.resolve(L.loadModel('crops5')).then(sc => { crops5 = sc || null; crops5Loading = false; TPL.clear(); for (const v of VIS.values()) v.key = ''; }, () => { crops5 = null; crops5Loading = false; });
  }
  // template object for <model>_<stage> (asset if present, else procedural)
  const TPL = new Map();
  function template(crop, s, open) {
    const K = CROPS[crop], key = K.model + '_' + s + (open ? 'o' : ''); let t = TPL.get(key); if (t) return t;
    const TH = T3(), M = mats(); t = new TH.Group();
    const src = crops5 && (crops5.getObjectByName(K.model + '_' + s));
    if (src) {
      src.updateMatrixWorld(true); const inv = new TH.Matrix4().copy(src.matrixWorld).invert();
      const glowObj = crops5.getObjectByName(K.model + '_' + s + '_glow');
      const addMeshes = (o, glowOnly) => o.traverse(m => {
        if (!m.isMesh) return; const isGlow = glowOnly || /_glow/.test(m.name) || (m.parent && /_glow/.test(m.parent.name)); if (isGlow && !open) return;
        const c = new TH.Mesh(m.geometry, isGlow ? M.glow : M.crop); c.matrixAutoUpdate = false; c.matrix.multiplyMatrices(inv, m.matrixWorld); c.castShadow = !isGlow; c.receiveShadow = !isGlow; c.userData.glow = isGlow; t.add(c);
      });
      addMeshes(src, false); if (glowObj && !src.getObjectByName(glowObj.name)) addMeshes(glowObj, true);
    } else {
      const P = PROC(crop, s, open);
      const mk = (B, mat, glow) => { if (!B || !B.i.length) return; const g = new TH.BufferGeometry(); g.setAttribute('position', new TH.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new TH.Float32BufferAttribute(B.n, 3)); g.setAttribute('color', new TH.Float32BufferAttribute(B.c, 3)); g.setIndex(B.i); g.computeBoundingSphere(); const m = new TH.Mesh(g, mat); m.castShadow = !glow; m.receiveShadow = !glow; m.userData.glow = glow; t.add(m); };
      mk(P.main, M.crop, false); mk(P.glow, M.glow, true);
    }
    TPL.set(key, t); return t;
  }
  function visKey(id, r) {
    const K = CROPS[r.crop]; const s = stageOf(r.crop, progress(r, nowT(), gameT())); const night = C().isNight ? C().isNight() : false;
    const open = s === lastStage(r.crop) && K.night && night; const wet = !r.wp && (+r.wu || 0) > nowT();
    return { s, open, wet, key: r.crop + s + (open ? 'o' : '') + (wet ? 'w' : '') };
  }
  function buildVis(id, r, vk) {
    const TH = T3(), M = mats(), rt = ensureRoot(); if (!rt) return null;
    const pl = plotInfo(id) || r; const grp = new TH.Group(); grp.name = 'crop_' + id;
    let y = pl.y; if (CROPS[r.crop].water) y = Math.max(y, waterAt(pl.x, pl.z) + .02);
    grp.position.set(pl.x, y, pl.z); grp.rotation.y = pl.r || 0;
    grp.add(template(r.crop, vk.s, vk.open).clone());
    if (vk.wet && !CROPS[r.crop].water) { const w = new TH.Mesh(WETGEO(), M.wet); w.position.y = .012; w.rotation.x = -Math.PI / 2; w.renderOrder = 1; grp.add(w); }
    rt.add(grp); return grp;
  }
  let wetGeo = null; const WETGEO = () => wetGeo || (wetGeo = new (T3().PlaneGeometry)(2.1, 2.1));
  function dropVis(id) { const v = VIS.get(id); if (!v) return; if (v.grp && v.grp.parent) v.grp.parent.remove(v.grp); VIS.delete(id); }
  // show the plot if it should be visible (planted, near, and its canteiro still exists unless it is a free spot)
  function refreshVis(id) {
    const v = VIS.get(id); const r = DB.get(id);
    if (!r || !r.crop || !CROPS[r.crop]) { dropVis(id); return; }
    if (!T3() || !L.scene || !(px === px)) return;
    if (!r.free && L.save && L.save.get && L.save.ready && !isPlotRec(buildRec(id))) { dropVis(id); return; }
    const pl = plotInfo(id) || r; if (Math.hypot(pl.x - px, pl.z - pz) > (v ? CFG.visOut : CFG.visR)) { dropVis(id); return; }
    const vk = visKey(id, r); if (v && v.key === vk.key && v.x === pl.x && v.z === pl.z) return;
    dropVis(id); const grp = buildVis(id, r, vk); if (grp) VIS.set(id, { grp, key: vk.key, crop: r.crop, x: pl.x, z: pl.z });
  }
  // Stage changes need no writes: every client computes the same stage from the shared record and the shared
  // server clock (a write here could race with a harvest on the other phone and bring the crop back). The game hears
  // 'stage' when a plot near the player grows (not on first sight).
  const SEEN = new Map();
  function checkStage(id, r) {
    const s = stage(r); if (s < 0) return; const prev = SEEN.get(id); SEEN.set(id, s);
    if (prev != null && s > prev) emit('stage', { id, crop: r.crop, stage: s, ripe: s === lastStage(r.crop), mine: r.by === me() });
  }
  // per frame (cheap): visuals for plots within ~60 m, stage checks once a second
  function tick(dt, x, z) {
    if (x != null) { px = +x; pz = +z; } else if (L.P) { px = L.P.x; pz = L.P.z; }
    visT -= dt || 0; stT -= dt || 0;
    if (visT <= 0) {
      visT = .5; if (T3() && L.scene) loadCrops5();
      const seen = new Set(); near(px, pz, CFG.visR, id => { seen.add(id); refreshVis(id); });
      for (const id of [...VIS.keys()]) if (!seen.has(id)) refreshVis(id);
    }
    if (stT <= 0) {
      stT = 1; near(px, pz, CFG.visR, (id, r) => checkStage(id, r));
    }
  }
  if (L.save && L.save.on) {
    L.save.on('ready', () => { reindex(); for (const id of [...VIS.keys()]) refreshVis(id); });
    L.save.on('f5', (id, d, old, origin) => { index(id, d); if (!d || !d.crop || (old && old.crop !== d.crop) || (old && d.pt !== old.pt)) SEEN.delete(id); refreshVis(id); emit('change', { id, d, origin }); });
    L.save.on('b5', (id, d, old, origin) => {
      // dismantled here: give the crop (or its seed) back and free the f5 row; elsewhere: the other device does it
      if (!d && origin === 'local' && isPlotRec(old)) { const r = DB.get(id); if (r && r.crop && !r.free) removePlot(id); }
      if (WHERE.has(id) || VIS.has(id)) { const v = VIS.get(id); if (v) v.key = ''; refreshVis(id); }
    });
  }

  // ================================================================ procedural crops (fallback while m/crops5.json is missing)
  // Small vertex-coloured meshes, origin at soil level, a cluster filling the 2.4 m bed (a few hundred triangles).
  const lin = hex => { const f = c => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }; return [f(hex >> 16 & 255), f(hex >> 8 & 255), f(hex & 255)]; };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const hashS = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function NB() { return { p: [], n: [], c: [], i: [] }; }
  // transform: scale, lean (rotate about local X by tilt), yaw, translate
  function xf(T) {
    const s = T.s || 1, cy = Math.cos(T.yaw || 0), sy = Math.sin(T.yaw || 0), ct = Math.cos(T.tilt || 0), st = Math.sin(T.tilt || 0);
    return (x, y, z) => { x *= s; y *= s; z *= s; const y1 = y * ct - z * st, z1 = y * st + z * ct; return [(T.x || 0) + x * cy + z1 * sy, (T.y || 0) + y1, (T.z || 0) - x * sy + z1 * cy]; };
  }
  // append a primitive {p:[[x,y,z]..], c:[[r,g,b]..], i:[a,b,c,..]} computing smooth normals
  function put(B, P) {
    const o = B.p.length / 3, n = P.p.map(() => [0, 0, 0]);
    for (let k = 0; k < P.i.length; k += 3) {
      const a = P.p[P.i[k]], b = P.p[P.i[k + 1]], c = P.p[P.i[k + 2]];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const j of [P.i[k], P.i[k + 1], P.i[k + 2]]) { n[j][0] += nx; n[j][1] += ny; n[j][2] += nz; }
    }
    for (let j = 0; j < P.p.length; j++) {
      const q = P.p[j], m = n[j], l = Math.hypot(m[0], m[1], m[2]) || 1; let nx = m[0] / l, ny = m[1] / l, nz = m[2] / l;
      if (P.up) { nx *= .5; ny = ny * .5 + .5 * Math.sign(ny || 1); nz *= .5; const l2 = Math.hypot(nx, ny, nz) || 1; nx /= l2; ny /= l2; nz /= l2; } // foliage: soft upward normals
      B.p.push(q[0], q[1], q[2]); B.n.push(nx, ny, nz); const c = P.c[j]; B.c.push(c[0], c[1], c[2]);
    }
    for (const k of P.i) B.i.push(o + k);
  }
  // ellipsoid (optionally the top half only, optionally lobed like a pumpkin)
  function ellip(B, T, rx, ry, rz, cTop, cBot, o) {
    o = o || {}; const seg = o.seg || 7, rings = o.rings || 5, M = xf(T), P = { p: [], c: [], i: [] }, half = !!o.half;
    for (let a = 0; a <= rings; a++) {
      const v = half ? a / rings * .5 : a / rings, phi = v * Math.PI, sy = Math.cos(phi), sr = Math.sin(phi);
      for (let b = 0; b < seg; b++) {
        const th = b / seg * Math.PI * 2; let k = 1; if (o.lobes) k = 1 - o.lobeAmp * (1 - Math.abs(Math.cos(o.lobes * th / 2)));
        let y = sy * ry; if (o.dimple && sr < .5) y -= Math.sign(sy) * o.dimple * (1 - sr * 2) * ry;
        P.p.push(M(Math.cos(th) * rx * sr * k, y, Math.sin(th) * rz * sr * k)); P.c.push(mixc(cBot, cTop, (sy + 1) / 2));
      }
    }
    for (let a = 0; a < rings; a++) for (let b = 0; b < seg; b++) { const i0 = a * seg + b, i1 = a * seg + (b + 1) % seg, j0 = i0 + seg, j1 = i1 + seg; P.i.push(i0, i1, j0, i1, j1, j0); }
    put(B, P);
  }
  // tube along a polyline (stems, roots); radius 0 at the end closes it
  function tube(B, T, pts, rads, cols, sides) {
    sides = sides || 4; const M = xf(T), P = { p: [], c: [], i: [] };
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let rx = 1, ry = 0, rz = 0; if (Math.abs(tx) > .9) { rx = 0; rz = 1; }
      // u = r x t, w = t x u
      let ux = ry * tz - rz * ty, uy = rz * tx - rx * tz, uz = rx * ty - ry * tx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
      for (let s = 0; s < sides; s++) { const an = s / sides * Math.PI * 2, ca = Math.cos(an) * rads[k], sa = Math.sin(an) * rads[k]; P.p.push(M(pts[k][0] + ux * ca + wx * sa, pts[k][1] + uy * ca + wy * sa, pts[k][2] + uz * ca + wz * sa)); P.c.push(cols[Math.min(k, cols.length - 1)]); }
    }
    for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < sides; s++) { const i0 = k * sides + s, i1 = k * sides + (s + 1) % sides; P.i.push(i0, i0 + sides, i1, i1, i0 + sides, i1 + sides); }
    put(B, P);
  }
  // leaf/blade along +z rising at angle `rise`, drooping by `droop`, width profile w(u); fold raises the midrib
  function leaf(B, T, len, wid, o) {
    o = o || {}; const n = o.n || 3, M = xf(T), P = { p: [], c: [], i: [], up: o.up !== false }, rise = o.rise == null ? .6 : o.rise, droop = o.droop == null ? .35 : o.droop, fold = o.fold == null ? .25 : o.fold;
    const c0 = o.c0, c1 = o.c1 || o.c0, prof = o.prof || (u => Math.pow(Math.sin(Math.PI * Math.min(1, u * .92 + .08)), .8));
    for (let k = 0; k <= n; k++) {
      const u = k / n, zz = Math.cos(rise) * len * u, yy = Math.sin(rise) * len * u - droop * len * u * u, w = wid * prof(u) * .5;
      const col = mixc(c0, c1, u);
      if (o.flat) { P.p.push(M(-w, yy, zz), M(w, yy, zz)); P.c.push(shade(col, .92), col); }
      else { P.p.push(M(-w, yy, zz), M(0, yy + w * fold, zz), M(w, yy, zz)); P.c.push(shade(col, .9), col, shade(col, .9)); }
    }
    if (o.flat) for (let k = 0; k < n; k++) { const a = k * 2; P.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    else for (let k = 0; k < n; k++) { const a = k * 3; P.i.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    put(B, P);
  }
  // thin grass-like blade (wheat, carrot tops); tapers to a point
  const blade = (B, T, h, w, bend, c0, c1) => leaf(B, T, h, w, { n: 3, flat: true, rise: Math.PI / 2 - .05, droop: -bend, c0, c1, prof: u => 1 - u * .95 });
  // double cone (ears of wheat, buds, berries)
  function bipyr(B, T, r, h0, h1, sides, cTop, cMid, cBot) {
    const M = xf(T), P = { p: [M(0, h1, 0)], c: [cTop], i: [] };
    for (let s = 0; s < sides; s++) { const a = s / sides * Math.PI * 2; P.p.push(M(Math.cos(a) * r, 0, Math.sin(a) * r)); P.c.push(cMid); }
    P.p.push(M(0, -h0, 0)); P.c.push(cBot || cMid); const bot = sides + 1;
    for (let s = 0; s < sides; s++) { const a = 1 + s, b = 1 + (s + 1) % sides; P.i.push(0, b, a, bot, a, b); }
    put(B, P);
  }
  // flat round pad with a notch (lotus)
  function pad(B, T, r, sides, c0, c1) {
    const M = xf(T), P = { p: [M(0, .01, 0)], c: [c1], i: [], up: true }; const notch = .5;
    for (let s = 0; s <= sides; s++) { const a = notch / 2 + s / sides * (Math.PI * 2 - notch); P.p.push(M(Math.cos(a) * r, 0, Math.sin(a) * r)); P.c.push(c0); }
    for (let s = 0; s < sides; s++) P.i.push(0, s + 2, s + 1);
    put(B, P);
  }
  const COL = {
    soil: lin(0x6b4a33), soilD: lin(0x4a3122), soilL: lin(0x8a6446),
    g0: lin(0x4d7a2a), g1: lin(0x7fae3a), g2: lin(0x9dc24a), gD: lin(0x3a5a22), gY: lin(0xa9b950),
    wheat0: lin(0xc7a94a), wheat1: lin(0xe9cf6e), wheatS: lin(0xb89a46),
    carrot: lin(0xe8782a), carrotD: lin(0xc0561c), pump: lin(0xf0913a), pumpD: lin(0xc9632a), pumpG: lin(0x8fb04a), stem: lin(0x6e7a32),
    berry: lin(0xe0343c), berryD: lin(0xa81f2c), white: lin(0xfaf6ea), yellow: lin(0xf2cf4a),
    herb: lin(0x5f8a46), herbD: lin(0x3f6a34), lilac: lin(0xb59ad8), lilacD: lin(0x8a6fc0),
    lotusPad: lin(0x5f9a4a), lotusPadL: lin(0x8fc06a), pink: lin(0xf2a6c2), pinkD: lin(0xd8708f),
    moonLeaf: lin(0x9fb8c8), moonLeafD: lin(0x6f8ea8), moon0: lin(0xeef4ff), moon1: lin(0xb8ccff), moonGlow: lin(0xcfe0ff), moonCore: lin(0xfff2c0),
  };
  // planting spots on the bed (rows), jittered
  function spots(nx, nz, span, R) { const out = []; for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push([((i + .5) / nx - .5) * span + (R() - .5) * .12, ((j + .5) / nz - .5) * span + (R() - .5) * .12]); return out; }
  // tidy soil mounds where the seeds are (stage 0 of every soil crop)
  function mounds(B, pts, R, sz) { for (const [x, z] of pts) ellip(B, { x, y: 0, z, yaw: R() * 6 }, sz * (1 + R() * .2), sz * .45, sz * .8, COL.soilL, COL.soilD, { seg: 6, rings: 2, half: true }); }
  function specks(B, pts, R, h) { for (const [x, z] of pts) for (let k = 0; k < 2; k++) leaf(B, { x: x + (R() - .5) * .05, y: h, z: z + (R() - .5) * .05, yaw: R() * 6.3 }, .06, .035, { n: 1, rise: .7, droop: .1, c0: COL.g1 }); }
  const PROCS = {
    wheat(B, s, R) {
      const pts = spots(4, 4, 1.85, R);
      if (s === 0) { mounds(B, pts, R, .13); specks(B, pts.filter((_, i) => i % 2 === 0), R, .045); return; }
      for (const [x, z] of pts) {
        const n = 3;
        for (let k = 0; k < n; k++) {
          const yaw = R() * 6.3, tilt = (R() - .5) * .35, h = s === 1 ? .16 + R() * .1 : s === 2 ? .5 + R() * .2 : .78 + R() * .22;
          const T = { x: x + (R() - .5) * .1, y: 0, z: z + (R() - .5) * .1, yaw, tilt };
          if (s === 3) {
            blade(B, T, h, .045, .06, COL.wheatS, COL.wheat1);
            const tip = xf(T)(0, h * .98, .06 * .98); bipyr(B, { x: tip[0], y: tip[1], z: tip[2], yaw, tilt: tilt + .25 }, .028, .02, .13, 4, COL.wheat1, COL.wheat0, COL.wheatS);
          } else blade(B, T, h, s === 1 ? .05 : .06, .05, COL.g0, s === 2 ? COL.g2 : COL.g1);
        }
        if (s >= 2) leaf(B, { x, y: .02, z, yaw: R() * 6.3 }, .25, .05, { n: 3, flat: true, rise: .5, droop: .5, c0: s === 3 ? COL.gY : COL.g0, c1: s === 3 ? COL.wheat0 : COL.g1 });
      }
    },
    carrot(B, s, R) {
      const pts = spots(3, 4, 1.8, R);
      if (s === 0) { mounds(B, pts, R, .15); return; }
      for (const [x, z] of pts) {
        const n = s === 1 ? 3 : s === 2 ? 5 : 6, h = s === 1 ? .14 : s === 2 ? .28 : .38;
        for (let k = 0; k < n; k++) leaf(B, { x, y: 0, z, yaw: k / n * 6.3 + R() * .5 }, h * (.8 + R() * .4), .08, { n: 3, flat: true, rise: 1.15 - R() * .3, droop: .5, c0: COL.g0, c1: s === 3 ? COL.g2 : COL.g1, prof: u => .35 + .65 * Math.sin(Math.PI * u) });
        if (s === 3) ellip(B, { x, y: -.02, z }, .06, .07, .06, COL.carrot, COL.carrotD, { seg: 6, rings: 2, half: true });
        else if (s === 2) ellip(B, { x, y: -.015, z }, .035, .03, .035, COL.carrot, COL.carrotD, { seg: 5, rings: 2, half: true });
      }
    },
    pumpkin(B, s, R) {
      if (s === 0) { mounds(B, spots(2, 2, 1.3, R), R, .2); return; }
      const roots = spots(2, 2, 1.2, R);
      for (const [x, z] of roots) {
        const nl = s === 1 ? 2 : s === 2 ? 5 : 6, L0 = s === 1 ? .16 : .32;
        for (let k = 0; k < nl; k++) leaf(B, { x, y: .01, z, yaw: k / nl * 6.3 + R() }, L0 * (.8 + R() * .4), L0 * .9, { n: 3, rise: .55, droop: .45, fold: .3, c0: COL.gD, c1: COL.g1, prof: u => Math.pow(Math.sin(Math.PI * Math.min(1, u * .8 + .2)), .6) });
        if (s >= 2) tube(B, { x, y: 0, z, yaw: R() * 6.3 }, [[0, .02, 0], [.2, .06, .1], [.45, .04, .15]], [.025, .02, .012], [COL.stem], 4);
      }
      if (s >= 2) {
        const P = s === 2 ? [[-.4, .3], [.45, -.35]] : [[-.45, .35], [.5, -.3], [.1, .5]];
        for (const [x, z] of P) {
          const big = s === 3 ? .27 + R() * .06 : .1, col = s === 3 ? COL.pump : COL.pumpG, colD = s === 3 ? COL.pumpD : COL.gD;
          ellip(B, { x, y: big * .78, z, yaw: R() * 6 }, big, big * .78, big, col, colD, { seg: 12, rings: 6, lobes: 8, lobeAmp: .12, dimple: .25 });
          tube(B, { x, y: big * 1.45, z, yaw: R() * 6 }, [[0, 0, 0], [0, .08, .02], [.02, .12, .05]], [.03, .022, .015], [COL.stem], 4);
        }
      }
    },
    strawberry(B, s, R) {
      const pts = spots(3, 3, 1.7, R);
      if (s === 0) { mounds(B, pts, R, .16); return; }
      for (const [x, z] of pts) {
        const nl = s === 1 ? 3 : 7, L0 = s === 1 ? .12 : .2;
        for (let k = 0; k < nl; k++) leaf(B, { x, y: .01, z, yaw: k / nl * 6.3 + R() * .4 }, L0 * (.8 + R() * .3), L0 * .75, { n: 2, rise: .8, droop: .7, fold: .35, c0: COL.gD, c1: COL.g0 });
        if (s === 2) for (let k = 0; k < 2; k++) { const a = R() * 6.3; ellip(B, { x: x + Math.cos(a) * .1, y: .14, z: z + Math.sin(a) * .1 }, .03, .012, .03, COL.white, COL.white, { seg: 5, rings: 2 }); }
        if (s === 3) for (let k = 0; k < 4; k++) { const a = k / 4 * 6.3 + R(), d = .1 + R() * .06; bipyr(B, { x: x + Math.cos(a) * d, y: .06 + R() * .04, z: z + Math.sin(a) * d, yaw: R() * 6 }, .032, .055, .015, 5, COL.g0, COL.berry, COL.berryD); }
      }
    },
    herbs(B, s, R) {
      const pts = spots(3, 3, 1.75, R);
      if (s === 0) { mounds(B, pts, R, .14); specks(B, pts, R, .05); return; }
      for (const [x, z] of pts) {
        const nl = s === 1 ? 5 : s === 2 ? 9 : 11, L0 = s === 1 ? .1 : s === 2 ? .2 : .26;
        for (let k = 0; k < nl; k++) leaf(B, { x: x + (R() - .5) * .08, y: 0, z: z + (R() - .5) * .08, yaw: k * 2.4 + R() * .3 }, L0 * (.7 + R() * .5), .07, { n: 2, flat: true, rise: 1.2 - R() * .4, droop: .4, c0: COL.herbD, c1: COL.herb });
        if (s === 3) for (let k = 0; k < 2; k++) { const yaw = R() * 6.3, T = { x: x + (R() - .5) * .1, y: 0, z: z + (R() - .5) * .1, yaw, tilt: (R() - .5) * .3 }; const h = .3 + R() * .08; tube(B, T, [[0, 0, 0], [0, h, 0]], [.008, .006], [COL.herbD], 3); const tip = xf(T)(0, h, 0); bipyr(B, { x: tip[0], y: tip[1], z: tip[2], yaw }, .028, .01, .1, 5, COL.lilac, COL.lilacD, COL.lilacD); }
      }
    },
    lotus(B, s, R) {
      const n = s === 0 ? 2 : s === 1 ? 4 : 5;
      for (let k = 0; k < n; k++) { const a = k / n * 6.3 + R() * .6, d = k === 0 ? 0 : .35 + R() * .3, r = (s === 0 ? .12 : .22) + R() * .08; pad(B, { x: Math.cos(a) * d, y: R() * .01, z: Math.sin(a) * d, yaw: R() * 6.3 }, r, 10, COL.lotusPad, COL.lotusPadL); }
      if (s === 1) bipyr(B, { x: .12, y: .06, z: .05 }, .045, .02, .14, 5, COL.pink, COL.pinkD, COL.lotusPad);
      if (s === 2) {
        const T = { x: .1, y: .05, z: .08 };
        for (let k = 0; k < 8; k++) leaf(B, Object.assign({ yaw: k / 8 * 6.3 }, T), .16, .09, { n: 2, rise: .75, droop: -.2, fold: .5, c0: COL.pinkD, c1: COL.white, up: false });
        for (let k = 0; k < 6; k++) leaf(B, Object.assign({ yaw: k / 6 * 6.3 + .3 }, T), .12, .07, { n: 2, rise: 1.1, droop: -.2, fold: .5, c0: COL.pink, c1: COL.white, up: false });
        ellip(B, { x: T.x, y: T.y + .04, z: T.z }, .035, .02, .035, COL.yellow, COL.yellow, { seg: 6, rings: 3 });
      }
    },
    moonflower(B, s, R, open, G) {
      if (s === 0) { mounds(B, [[0, 0]], R, .22); ellip(G, { x: 0, y: .1, z: 0 }, .025, .025, .025, COL.moonGlow, COL.moonGlow, { seg: 5, rings: 3 }); return; }
      const h = s === 1 ? .12 : s === 2 ? .45 : .62;
      const nl = s === 1 ? 2 : 6; for (let k = 0; k < nl; k++) leaf(B, { x: 0, y: .01, z: 0, yaw: k / nl * 6.3 + .4 }, s === 1 ? .12 : .26, .1, { n: 3, rise: .7, droop: .55, fold: .4, c0: COL.moonLeafD, c1: COL.moonLeaf });
      if (s === 1) return;
      tube(B, { x: 0, y: 0, z: 0 }, [[0, 0, 0], [.02, h * .5, .01], [0, h, 0]], [.018, .014, .012], [COL.moonLeafD, COL.moonLeaf], 4);
      for (let k = 0; k < 2; k++) leaf(B, { x: 0, y: h * .45, z: 0, yaw: k * 3.1 + .8 }, .15, .07, { n: 2, rise: .4, droop: .4, c0: COL.moonLeafD, c1: COL.moonLeaf });
      if (s === 2 || !open) { const bud = s === 2 ? .05 : .075; bipyr(B, { x: 0, y: h, z: 0 }, bud, .03, bud * 2.6, 6, COL.moon0, COL.moon1, COL.moonLeaf); if (s === 3) ellip(G, { x: 0, y: h + bud, z: 0 }, .02, .03, .02, COL.moonGlow, COL.moonGlow, { seg: 5, rings: 3 }); return; }
      for (let k = 0; k < 7; k++) leaf(B, { x: 0, y: h, z: 0, yaw: k / 7 * 6.3 }, .2, .12, { n: 3, rise: .5, droop: -.15, fold: .45, c0: COL.moon1, c1: COL.moon0, up: false });
      for (let k = 0; k < 5; k++) leaf(G, { x: 0, y: h + .01, z: 0, yaw: k / 5 * 6.3 + .4 }, .11, .07, { n: 2, rise: .9, droop: -.1, fold: .5, c0: COL.moonGlow, c1: COL.moon0, up: false });
      ellip(G, { x: 0, y: h + .03, z: 0 }, .035, .03, .035, COL.moonCore, COL.moonGlow, { seg: 6, rings: 3 });
    },
  };
  function PROC(crop, s, open) {
    const K = CROPS[crop], B = NB(), G = NB(), R = rng(hashS(K.model + s));
    const fn = PROCS[K.model]; if (fn) fn(B, s, R, !!open, G);
    return { main: B, glow: G.i.length ? G : null, tris: (B.i.length + G.i.length) / 3 };
  }

  L.farm = {
    CFG, CROPS, WILD, wildYield, on, plant, plantAt, waterSpot, water, boost, harvest, removePlot, stage, info, action, use, seedsFor, canPlant, nearest, plots, tick,
    plot: plotInfo, isWaterPlot, stageName, fmtLeft,
    // pure math (tests, UI)
    _m: { effMs, progress, stageOf, timeLeft, nightIn, nightCum, bank },
    _proc: PROC, _template: (c, s, o) => template(c, s, o), _vis: VIS, _tpl: TPL, _reindex: reindex, _mem: MEM,
    get root() { return root; },
    // replace to give the exact soil height of the canteiro model: soilOf(buildRec) -> metres above rec.y
    soilOf: null,
  };
})(typeof window !== 'undefined' ? (window.L = window.L || {}) : (globalThis.L = globalThis.L || {}));
