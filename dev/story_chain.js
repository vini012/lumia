/* Scripted run through the whole main chain (and every side note) with assertions on each step's state.
   Runs in Node (dev/story_test.js) and in the browser harness (dev/story.html: CHAIN.run()). Uses the mocks of
   dev/story_mocks.js and only the public/debug API of L.story. No narrative text here: lines are read via L.T. */
'use strict';
(function (G) {
  const L = G.L, M = G.MOCK;
  const CHAIN = G.CHAIN = { steps: [], ok: 0, bad: 0 };
  function run(opt) {
    opt = opt || {};
    const S = L.story, D = S.debug, out = CHAIN.steps = []; CHAIN.ok = CHAIN.bad = 0;
    const ui = () => { if (L.storyUI && L.storyUI.closeAll) L.storyUI.closeAll(); };
    const tick = (s, st) => D.tick(s, st || .1);
    const st = () => D.state();
    const ok = (cond, what) => { out.push((cond ? 'ok   ' : 'FAIL ') + what); if (cond) CHAIN.ok++; else CHAIN.bad++; return cond; };
    const hour = h => { M.setHour(h); tick(.3); };
    const nextNight = h => { M.setHour(h == null ? 21 : h, true); tick(.3); };
    const go = id => { const r = D.teleport(id); tick(.4); ui(); return r; };
    const near = () => S.interactables(L.P.x, L.P.z, 6, L.P.y).map(i => i.id);
    function use(id, label) { const l = near(); const has = l.indexOf(id) >= 0; ok(has, (label || 'use ' + id) + (has ? '' : ' (near: ' + l.join(',') + ')')); if (has) { S.interact(id); tick(.3); ui(); } return has; }
    const noteRead = id => st().notes.indexOf(id) >= 0;
    const task = id => S.taskView().find(t => t.id === id) || { state: null };
    const learned = id => S.spells.indexOf(id) >= 0;
    const inv = id => (L.save.player.inv[id] || 0);
    const W = id => L.save.all('w5').get(id);
    const sleep = () => { S.event('slept', { x: L.P.x, z: L.P.z }); L.clock.skipToDawn(); S.event('woke', {}); tick(.5); ui(); };
    function useObj(id, label) { D.goObj(id); tick(.3); return use(id, label); }
    const fill = () => { L.save.player.st.mana = 100; };
    function readAt(note) { const n = L.TL('notes.' + note); go(n.poi); D.goObj('note_' + note); tick(.3); use('note_' + note, 'read ' + note + ' at ' + n.poi); ok(noteRead(note), note + ' read'); }
    function walk(tx, tz, speed, maxT, stopIf) { const dt = .1; for (let t = 0; t < (maxT || 120); t += dt) { const dx = tx - L.P.x, dz = tz - L.P.z, d = Math.hypot(dx, dz); if (d < .5 || (stopIf && stopIf())) return true; const s = Math.min(d, speed * dt); L.P.x += dx / d * s; L.P.z += dz / d * s; L.P.y = L.ground(L.P.x, L.P.z); L.P.ry = Math.atan2(dx, dz); S.tick(dt); } return false; }

    S.CFG.clearR = 70; S.CFG.birdEvery = 5; hour(7);
    ok(S.ready && L.T('notes.n01.title').length > 3, 'boot: lore decoded, story ready');
    // ---------- Act I
    readAt('n01');
    ok(inv('sem_trigo') === 6 && inv('sem_cenoura') === 4, 'n01 gives the seeds');
    tick(9); ok(st().th.indexOf('t01') >= 0, 'thought t01 after the first note');
    S.event('fire_lit', { x: 0.5, z: 0.5, poi: 'cottage' }); ok(S.flags.fire_cottage, 'cottage fire lit flag');
    hour(21); sleep(); ok(st().dreams.indexOf('d1') >= 0, 'first night: dream d1');
    let b = []; for (let i = 0; i < 40 && !b.some(x => /n02/.test(x)); i++) { tick(1); b = st().birds; } ok(b.some(x => /n02/.test(x)), 'a paper bird brings n02 (' + b.join(',') + ')');
    for (let i = 0; i < 40 && !st().birds.some(x => x === 'wait:n02'); i++) tick(1); ok(st().birds.some(x => x === 'wait:n02'), 'bird landed near her with the letter');
    use('mail_n02', 'pick up the letter'); ok(noteRead('n02'), 'n02 read'); tick(10); ok(st().th.indexOf('t02') >= 0, 'thought t02');
    // ---------- stuck helper: two hours without progress -> a paper bird guides, holds when she stops, then a dream
    const dreams = []; S.on('dream', d => dreams.push(d));
    const F = L.save.player.flags; F.progT = (F.playT || 0) - S.CFG.stuckAfter - 1; tick(6);
    const gb = () => D.birds().find(x => x.guide);
    for (let i = 0; i < 30 && !(gb() && gb().state === 'guide'); i++) tick(1);
    const g0 = gb(), clue = S.nextClue(), cp = L.poi(clue);
    ok(g0 && g0.state === 'guide' && Math.hypot(g0.tx - cp.x, g0.tz - cp.z) < 1, 'stuck: a paper bird comes to guide towards ' + clue);
    tick(6); const h0 = gb(); tick(6); const h1 = gb(); ok(h0 && h1 && Math.hypot(h1.x - h0.x, h1.z - h0.z) < 6, 'the bird holds while she stands still');
    const dc0 = Math.hypot(h1.x - cp.x, h1.z - cp.z);
    walk(cp.x, cp.z, 3, 8); const h2 = gb(); ok(h2 && Math.hypot(h2.x - cp.x, h2.z - cp.z) < dc0 - 8, 'it flies on, ahead of her, when she walks');
    walk(cp.x + 2, cp.z + 2, 3, 120, () => !gb() || gb().state === 'away'); tick(12);
    ok(!gb() || gb().state === 'away', 'at the clue it circles and leaves');
    hour(22); sleep(); ok(dreams.some(d => d.id === 'hint' && d.text.length > 20), 'a softer hint in a dream afterwards');
    ok(!D.birds().some(x => x.guide && x.state === 'guide'), 'no second guide right away');
    readAt('n03'); hour(22); sleep(); ok(st().dreams.indexOf('d2') >= 0, 'dream d2 after n03');
    readAt('n04'); ok(S.recipes().indexOf('receita_forno') >= 0, 'n04 gives the oven recipe');
    // ---------- spells I: Faisca, Brisa, Brotar
    readAt('n12'); ok(task('k_fogo').state === 'on', 'k_fogo started by the book page');
    S.event('cooked', { item: 'pao' }); tick(2.5); ok(task('k_fogo').state === 'done' && learned('faisca'), 'k_fogo done: faisca learned');
    ok(S.look().cape, 'cape after the first spell');
    fill(); const m0 = S.mana(); ok(S.castSpell('faisca').ok && S.mana() < m0 && M.lit > 0, 'cast faisca: mana spent, fire hook called');
    ok(S.castSpell('faisca').why === 'cd', 'faisca cooldown');
    readAt('n05'); ok(task('k_moinho').state === 'on', 'k_moinho started by the bottle');
    go('windmill_broken'); use('g_windmill', 'look at the old windmill');
    D.give('madeira', 10); D.give('corda', 4);
    for (let i = 0; i < 4; i++) { useObj('mill_' + i, 'repair spot ' + i); }
    ok(W('windmill') && learned('brisa') && task('k_moinho').state === 'done', 'windmill fixed: brisa learned');
    ok(S.mods().doubleJump && S.mods().glide, 'brisa mods: double jump + glide');
    go('totem_jardim'); use('g_totem_jardim', 'meet the garden totem'); ok(task('k_horta').state === 'on', 'k_horta on');
    for (let i = 0; i < 3; i++) S.event('harvest', { crop: 'cenoura', own: true }); tick(2.5);
    ok(task('k_horta').state === 'ready', 'k_horta ready after 3 own harvests'); use('g_totem_jardim', 'show the harvest'); ok(learned('brotar'), 'brotar learned');
    fill(); ok(S.castSpell('brotar').ok && M.boosts > 0, 'cast brotar -> farm.boost');
    // ---------- Act II/III: moon flower, deer, runes
    readAt('n07'); ok(inv('sem_lua') === 1, 'n07 gives the moon seed');
    S.event('planted', { crop: 'flor_lua', x: 2, z: 2 });
    go('deer_meadow'); nextNight(21); S.event('fed', { species: 'cervo_lunar', id: 'c1' }); tick(.5); ui();
    ok(task('k_cervo').state === 'on', 'cervo met at night: task on');
    nextNight(22); S.event('fed', { species: 'cervo_lunar', id: 'c1' }); S.event('fed', { species: 'cervo_lunar', id: 'c1' });
    nextNight(23); S.event('fed', { species: 'cervo_lunar', id: 'c1' }); tick(2.5); ui();
    ok(task('k_cervo').state === 'done' && learned('luz'), 'three different nights: luz learned');
    go('well_vila'); ok(near().indexOf('note_r1') < 0, 'rune hidden without light');
    fill(); ok(S.castSpell('luz').ok, 'cast luz'); tick(.5); use('note_r1', 'read the glowing runes'); ok(noteRead('r1'), 'r1 read');
    // light 1: the moon flower for the crying totem
    hour(10); D.give('flor_lua', 1); go('totem_choro'); use('g_totem_choro', 'offer the moon flower');
    ok(W('altar_1') && inv('fragmento') === 1 && S.fragCount() === 1, 'fragment 1');
    hour(21); sleep(); ok(st().dreams.indexOf('d3') >= 0, 'dream d3 after the first star');
    // light 2: the deer leads to the glade
    nextNight(21); const gl = L.poi('lunar_glade'); D.teleport([gl.x - 60, gl.z + 40]); tick(1);
    ok(walk(gl.x, gl.z, 3.2, 120, () => S.flags.glade), 'followed the lunar deer to the glade'); walk(gl.x + 1, gl.z, 3); tick(1);
    use('altar_2', 'take the star in the glade'); ok(W('altar_2') && S.fragCount() === 2, 'fragment 2');
    // ---------- Mare
    hour(10); go('turtle_shrine'); use('g_tartaruga', 'talk to the old turtle'); ok(task('k_lago').state === 'on' && inv('sem_lotus') === 3, 'k_lago on, lotus seeds given');
    for (let i = 0; i < 6; i++) useObj('reed_' + i, 'cut dead reeds ' + i);
    for (let i = 0; i < 3; i++) useObj('lotus_' + i, 'plant lotus ' + i);
    go('turtle_shrine');
    tick(2.5); ok(task('k_lago').state === 'ready', 'shrine clean'); use('g_tartaruga', 'return to the turtle'); ok(learned('mare'), 'mare learned');
    fill(); ok(S.castSpell('mare').ok && S.mods().waterWalk && M.waters > 0, 'cast mare: water walk + watering');
    // ---------- light 3: the lighthouse
    readAt('s03'); go('lighthouse'); tick(2.5); ok(task('f3').state === 'on', 'f3 on');
    const lh = L.poi('lighthouse'), gy = L.ground(lh.x, lh.z);
    for (let k = 0; k < 5; k++) M.builds.push({ id: 'b' + k, t: 'wall', x: lh.x + 1, y: gy + k * 3, z: lh.z, h: 3 });
    M.builds.push({ id: 'lamp1', t: 'lighthouse_lamp', x: lh.x + 1, y: gy + 12.5, z: lh.z, h: 2 }); tick(4);
    ok(D.lh().tall && D.lh().lamp, 'tower >= 12 m with the lamp on top');
    hour(21); tick(3.5); L.P.y = gy + 12.5; L.P.x = lh.x + 1.5; L.P.z = lh.z; tick(.5); use('lamp', 'light the lighthouse'); ok(W('lighthouse'), 'lighthouse lit at night');
    go('bay_chest'); L.P.y = 0; tick(.3); use('bay_chest', 'open the sunken chest (walking on water)'); ok(W('altar_3') && S.fragCount() === 3, 'fragment 3');
    hour(22); sleep(); ok(st().dreams.indexOf('d4') >= 0, 'dream d4 after three stars');
    // ---------- light 4: a night at the summit
    readAt('n06'); readAt('s23'); ok(S.recipes().indexOf('receita_sopa_quente') >= 0, 'soup recipe');
    go('summit_camp'); hour(18); tick(1.5); useObj('g_espirito_iaque', 'meet the yak spirit at dusk'); ok(task('f4').state === 'on', 'f4 on');
    // night A: up by the fire, then she wanders off for too long -> the vigil breaks (soft, no penalty)
    M.sheltered = true; M.fireNear = true; hour(20); tick(3); ok(S.flags.vigil && !S.flags.vigil.done, 'vigil starts at nightfall under a roof by the fire');
    M.fireNear = false; tick(S.CFG.vigilGrace + 10); ok(!S.flags.vigil, 'away from the fire for a while: the vigil breaks');
    // night B: in bed at the camp, roof and fire, from nightfall: the night counts when she gets up at dawn
    M.fireNear = true; nextNight(19); tick(2); sleep(); ok(S.flags.vigil && S.flags.vigil.done && S.flags.vigil.slept, 'slept the night through at the camp: counts');
    L.save.player.flags.vigil = null; // (test only) forget it to check the sleepless path too
    // night C: up the whole night
    nextNight(19.5); tick(3);
    for (let h = 20; h < 30; h += .5) { M.setHour(h % 24, h >= 24 && h < 24.5); tick(4); }
    M.setHour(6.2); tick(2); ok(S.flags.vigil && S.flags.vigil.done, 'whole night up with roof and fire');
    D.give('sopa_quente', 1); M.setHour(6.5); tick(1); useObj('g_espirito_iaque', 'give the hot soup at sunrise'); ok(W('altar_4') && S.fragCount() === 4, 'fragment 4');
    M.sheltered = false; M.fireNear = false;
    // ---------- Ponte de Vento and light 5
    hour(11); go('griffin_queen'); use('g_rainha_grifo', 'meet the griffin guardian'); ok(task('k_penas').state === 'on', 'k_penas on');
    for (let i = 1; i <= 3; i++) useObj('feather_' + i, 'golden feather ' + i);
    go('griffin_queen'); tick(2.5); use('g_rainha_grifo', 'bring the feathers'); ok(learned('ponte') && inv('pena_dourada') === 0, 'ponte learned');
    fill(); L.cam.yaw = 0; L.cam.pitch = 0; ok(S.castSpell('ponte').ok && S.bridgeState() && M.cols.length > 0, 'cloud bridge with collider'); tick(26); ok(S.bridgeState() && M.cols.length === 1, 'the bridge waits while she still stands on it'); tick(9); ok(!S.bridgeState() && M.cols.length === 0, 'bridge dissolves, collider removed');
    fill(); const r2 = S.castSpell('ponte'), b2 = !!S.bridgeState(); L.P.x += 30; tick(26); ok(r2.ok && b2 && !S.bridgeState() && M.cols.length === 0, 'second bridge: off it, it fades after 25 s' + (r2.ok ? '' : ' (' + r2.why + ')')); L.P.x -= 30; fill();
    readAt('n09'); go('griffin_nest'); use('altar_5', 'the star in the nest'); ok(W('altar_5') && S.fragCount() === 5 && inv('fragmento') === 5, 'fragment 5');
    // ---------- the forge
    go('royal_forge'); use('g_bigorna', 'the old anvil before the note'); ok(!W('forge_key'), 'anvil waits for the note');
    readAt('n08'); ok(task(D.forgeTask()).state === 'on', 'forge task on');
    go('royal_forge'); use('g_bigorna', 'deposit stars'); ok((W('forge') || {}).f === 5 && !W('forge_key'), 'stars deposited, gold/crystal missing');
    D.give('ouro', 3); D.give('cristal', 2); use('g_bigorna', 'forge'); ok(W('forge_key') && inv('estrela') === 1 && S.hasStar(), 'forged');
    hour(22); sleep(); ok(st().dreams.indexOf('d5') >= 0, 'dream d5 with the forged star');
    // ---------- Revelar
    go('totem_ancestral'); use('g_totem_ancestral', 'the ancestral totem'); ok(noteRead('n10') && learned('revelar') && task('k_ver').state === 'done', 'revelar learned');
    // ---------- the white cloud
    hour(10); go('mist_sign'); ok(near().indexOf('note_s26') >= 0, 'the old sign at the edge');
    const mc = L.MIST; const a = Math.atan2(L.P.x - mc.x, L.P.z - mc.z); const ex = mc.x + Math.sin(a) * (mc.r + 20), ez = mc.z + Math.cos(a) * (mc.r + 20);
    D.teleport([ex, ez]); tick(.5); ok(!S.mistBlock(L.P.x, L.P.z), 'outside: not blocked');
    let back = false; walk(mc.x, mc.z, 5, 60, () => { const s = S.mistState(); if (s.phase === 2) back = true; return back; }); tick(2.5);
    ok(back && L.inMist(L.P.x, L.P.z) === 0, 'walked in without seeing: returned outside softly');
    fill(); ok(S.castSpell('revelar').ok && M.mistOpen > 0 && M.mistPts > 4, 'revelar opens a path of lights');
    const gate = L.poi('castle_gate');
    let seen = false; walk(gate.x, gate.z, 7, 120, () => { if (S.busy && S.camera) seen = true; return seen; });
    ok(seen, 'reveal shot frames the hidden place'); tick(9); ok(S.flags.castle_seen && !S.busy, 'reveal done');
    walk(gate.x, gate.z + 4, 7, 120); ok(L.inMist(L.P.x, L.P.z) > 0 && !S.mistBlock(L.P.x, L.P.z), 'inside with the path open');
    use('lock', 'unlock the gate'); ok(W('gate') && inv('estrela') === 0, 'gate open, star in the lock');
    // ---------- the last letter and the long morning
    go('throne'); tick(1); use('note_n11', 'the last letter'); ok(learned('despertar'), 'despertar learned');
    hour(13); tick(.5); go('throne'); use('throne', 'try at noon'); ok(!S.endingOn && !W('awake'), 'not at noon');
    hour(6.5); go('throne'); use('throne', 'at dawn');
    ok(S.endingOn && S.busy && W('awake'), 'the long morning started');
    const e0 = M.restore; tick(40); ok(M.restore > e0 && M.restore > .5 && M.dissolve > .5, 'the place heals, the white dissolves');
    tick(60); ok(!S.endingOn && !S.busy && S.camera === null, 'sequence over, control back');
    ok(M.tames.indexOf('dragao_bebe') >= 0 && S.look().crown && W('home_keep') && W('lit_village'), 'rewards granted');
    ok(task('k_fim').state === 'done', 'k_fim done');
    // ---------- every side note and the bird letters
    hour(10);
    for (const n of L.TL('notes')) { if (n.how === 'bird' || n.how === 'totem' || noteRead(n.id)) continue; if (n.how === 'rune') { fill(); S.castSpell('luz'); } readAt(n.id); }
    for (let i = 0; i < 4; i++) S.event('built', { piece: 'wall' }); S.event('built', { piece: 'roof' });
    for (let i = 0; i < 3; i++) S.event('tamed', { species: 'ovelha', id: 's' + i });
    for (let i = 0; i < 10; i++) S.event('harvest', { crop: 'trigo', own: true });
    for (let k = 0; k < 3; k++) { tick(7); let got = false; for (let t = 0; t < 40 && !got; t++) { tick(1); const w = st().birds.find(x => /^wait:/.test(x)); if (w) { use('mail_' + w.slice(5), 'bird letter ' + w.slice(5)); got = true; } } }
    const all = L.TL('notes').filter(n => !noteRead(n.id)).map(n => n.id); ok(all.length === 0, 'every note read' + (all.length ? ' (missing ' + all.join(',') + ')' : ''));
    const allD = L.TL('dreams').every(d => st().dreams.indexOf(d.id) >= 0); ok(allD, 'every dream seen');
    tick(20); const allT = L.TL('thoughts').filter(t => st().th.indexOf(t.id) < 0).map(t => t.id); ok(!allT.length, 'every thought' + (allT.length ? ' (missing ' + allT.join(',') + ')' : ''));
    const notDone = S.taskView().filter(t => t.state !== 'done').map(t => t.id); ok(S.taskView().length === L.TL('tasks').length && !notDone.length, 'every task done' + (notDone.length ? ' (' + notDone.join(',') + ')' : ''));
    ok(S.spells.length === L.TL('spells').length, 'every spell learned (' + S.spells.join(',') + ')');
    ok(!S.mistBlock(mc.x + 100, mc.z), 'afterwards the white no longer blocks');
    tick(5); ok(!S.nextClue() && !D.birds().some(x => x.guide), 'afterwards nothing left to guide to');
    if (opt.verbose !== false) console.log(out.join('\n'));
    return { ok: CHAIN.ok, bad: CHAIN.bad, steps: out };
  }
  CHAIN.run = run;
})(typeof window !== 'undefined' ? window : globalThis);
