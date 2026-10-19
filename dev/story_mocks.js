/* Dev harness mocks for the progression module: a small fake world (POIs, ground, water, white cloud disc), the
   SYSTEMS contract (L.save, L.clock, L.surv, L.farm, L.isSheltered, L.nearFire), the game hooks (L.storyBuilds,
   L.lightFireNear, L.castleObj, L.castleRestore, L.giveTame, L.mistVisual, L.addCol/L.delCol, L.P, L.cam).
   Works in the browser (dev/story.html) and in Node (dev/story_test.js). Every call is recorded in MOCK.log.
   A reload is simulated in Node by loading the scripts again in a fresh context with G.MOCK_INIT = MOCK.snapshot(). */
'use strict';
(function (G) {
  const L = G.L = G.L || {};
  const INIT = G.MOCK_INIT ? JSON.parse(JSON.stringify(G.MOCK_INIT)) : null;
  const MOCK = G.MOCK = { log: [], cols: [], fires: [], builds: [], sheltered: false, fireNear: false, restore: 0, dissolve: 0, mistOpen: 0, tames: [], boosts: 0, waters: 0, lit: 0 };
  const rec = (k, d) => { MOCK.log.push([k, d]); if (MOCK.log.length > 500) MOCK.log.shift(); };
  // ---- POIs: a compact world around the origin (metres). ry = facing of the POI front.
  const P = {
    spawn: [6, 14], cottage: [0, 0, 0], vila_ventura: [60, -40], bakery: [80, -60, 3.1], well_vila: [64, -30], village_house_a: [40, -70, .4], village_house_b: [96, -32, -.6],
    tower_house: [110, -70], hermit_tower_vale: [-40, -60, .8], totem_sorriso: [-20, 30], totem_jardim: [30, 40], windmill_broken: [180, 30, 0], windmills: [230, 60],
    stream_mills: [150, 70], haystack_hills: [200, 100], hill_top: [240, 0], lighthouse: [-260, 200, 0], bay_chest: [-330, 240], beach_bottle: [-240, 250], fisher_hut: [-220, 160, 1.2],
    turtle_shrine: [320, 220, 3.14], lake_bench: [340, 180], lake_house: [370, 230, 2], falls_three: [-200, -100], totem_choro: [-100, -180], totems_ring: [-130, -150], totems_path: [-80, -140],
    royal_forge: [250, -200, 3.14], high_plaza: [280, -170], high_school: [300, -210, 1.5], high_tower: [230, -240], hunter_cabin: [380, -100, 1], mushroom_ring: [400, -60],
    islet_low: [-380, -300], islet_mid: [-420, -340], griffin_queen: [-450, -360], griffin_nest: [-470, -400], feather_1: [-390, -320], feather_2: [-410, -360], feather_3: [-440, -330],
    hermit_tower_canyon: [-150, -300], rope_bridge: [-120, -330], lunar_garden: [120, -320], lunar_grove: [150, -350], lunar_glade: [180, -380], deer_meadow: [140, -300],
    hot_spring: [420, -300], dragon_nest: [450, -340], summit_camp: [-350, -560, 0], summit_view: [-330, -590], yak_trail: [-300, -520],
    steppe_post: [-50, -520], steppe_stones: [-20, -540], totem_ancestral: [120, -560], windy_stones: [150, -540],
    mist_center: [600, -700], mist_sign: [420, -520], castle: [600, -700, 3.14], castle_gate: [600, -640, 3.14], throne: [600, -760, 0],
  };
  const FLY = { islet_low: 40, islet_mid: 55, griffin_queen: 70, griffin_nest: 90, feather_1: 45, feather_2: 60, feather_3: 75 };
  function ground(x, z) {
    if (Math.hypot(x + 330, z - 240) < 70) return -4 + Math.hypot(x + 330, z - 240) / 70 * 4; // the bay
    return 2 + Math.sin(x / 47) * Math.cos(z / 61) * 1.5 + Math.sin((x + z) / 130) * 2;
  }
  L.ground = (x, z) => ground(x, z);
  L.rawH = L.ground;
  L.waterAt = (x, z) => (Math.hypot(x + 330, z - 240) < 70 ? 0 : -Infinity);
  L.POIS = Object.keys(P).map(id => { const a = P[id]; return { id, kind: 'poi', region: 0, x: a[0], z: a[1], y: FLY[id] != null ? FLY[id] : ground(a[0], a[1]), ry: a[2] || 0, r: 10, flat: true }; });
  const BY = {}; L.POIS.forEach(p => BY[p.id] = p);
  L.poi = id => BY[id] || null;
  L.MIST = { x: 600, z: -700, r: 240 };
  L.inMist = (x, z) => Math.max(0, Math.min(1, (L.MIST.r - Math.hypot(x - L.MIST.x, z - L.MIST.z)) / L.MIST.r));
  // ---- player & camera
  L.P = INIT && INIT.P ? INIT.P : { x: 6, y: ground(6, 14), z: 14, ry: Math.PI, vx: 0, vy: 0, vz: 0 };
  L.cam = { yaw: Math.PI, pitch: .2, dist: 7 };
  L.storyTeleport = (x, y, z) => { L.P.x = x; L.P.y = y; L.P.z = z; rec('teleport', [x, y, z]); };
  // ---- SYSTEMS contract
  const W5 = new Map(INIT ? INIT.w5 : []), listeners = {};
  L.save = {
    player: INIT ? INIT.player : { name: 'Ana', inv: {}, st: { mana: 100, fome: 80, en: 100 } }, dirties: 0, flushes: 0, status: 'local',
    dirty() { this.dirties++; }, flush() { this.flushes++; }, all(c) { return c === 'w5' ? W5 : new Map(); },
    set(c, id, d, origin) { if (c === 'w5') W5.set(id, d); rec('save.set', [c, id]); (listeners[c] || []).forEach(fn => fn(id, d, null, origin || 'local')); },
    del(c, id) { if (c === 'w5') W5.delete(id); }, on(c, fn) { (listeners[c] = listeners[c] || []).push(fn); },
  };
  const clock = L.clock = { h: INIT ? INIT.clock.h : 8, d: INIT ? INIT.clock.d : 100, DAY_LEN: 1440, hours() { return this.h; }, dayPhase() { return this.h / 24; }, now() { return (this.d + this.h / 24) * 1440000; }, day() { return this.d; }, isNight() { return this.h >= 18 || this.h < 6; }, skipToDawn() { if (this.h >= 6) this.d++; this.h = 6.05; rec('skipToDawn'); }, moonPhase() { return 0; } };
  MOCK.setHour = (h, nextDay) => { if (nextDay) clock.d++; clock.h = h; };
  // what a reload keeps: the player record and the world rows (both travel as JSON), the clock, where she stands
  MOCK.snapshot = () => JSON.parse(JSON.stringify({ player: L.save.player, w5: [...W5], clock: { h: clock.h, d: clock.d }, P: L.P }));
  // a row written by the partner (arrives through the room, origin 'remote')
  MOCK.partner = (id, d, by) => L.save.set('w5', id, Object.assign({ by: by || 'Bia', t: clock.now() }, d || {}), 'remote');
  L.surv = { sleeping: false, warm(s) { rec('warm', s); } };
  L.isSheltered = () => MOCK.sheltered;
  L.nearFire = () => MOCK.fireNear;
  L.farm = { boost(x, z, r) { MOCK.boosts++; rec('farm.boost', [x, z, r]); }, water(o) { MOCK.waters++; rec('farm.water', o); } };
  // ---- game hooks
  L.storyBuilds = () => MOCK.builds;
  L.lightFireNear = (x, z, r) => { MOCK.lit++; rec('lightFireNear', [x, z, r]); return true; };
  L.castleRestore = p => { MOCK.restore = p; };
  L.giveTame = sp => { MOCK.tames.push(sp); rec('giveTame', sp); };
  L.mistVisual = { open(a, pts) { MOCK.mistOpen = a; MOCK.mistPts = pts ? pts.length : 0; }, dissolve(t) { MOCK.dissolve = t; } };
  L.storyWorldEvent = (n, d) => rec('worldEvent', n);
  L.onSpell = id => rec('onSpell', id);
  L.onStoryLook = l => rec('look', l);
  if (!L.addCol) {
    L.addCol = c => { MOCK.cols.push(c); rec('addCol', [c.x, c.z]); return c; };
    L.delCol = c => { const i = MOCK.cols.indexOf(c); if (i >= 0) MOCK.cols.splice(i, 1); rec('delCol', 1); };
  }
  L.LIGHTS = [];
})(typeof window !== 'undefined' ? window : globalThis);
