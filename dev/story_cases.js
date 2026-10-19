/* Scenario checks for the progression module, in Node (run by dev/story_test.js after the chain).
   Each case loads the scripts in a fresh context (dev/story_test.js: fresh(init)); a reload is a fresh context fed
   with MOCK.snapshot() of the previous one. No narrative text here. */
'use strict';
module.exports = function runCases(fresh) {
  const out = []; let okN = 0, badN = 0;
  const ok = (c, what) => { out.push((c ? 'ok   ' : 'FAIL ') + what); if (c) okN++; else badN++; return c; };
  const box = c => {
    const L = c.L, S = L.story, D = S.debug, M = c.MOCK;
    return { c, L, S, D, M, F: () => L.save.player.flags, W: id => L.save.all('w5').get(id), tick: (s, st) => D.tick(s, st || .1), ev: (name, arr) => S.on(name, d => arr.push(d)) };
  };
  const startOwn = (b, hour) => { b.D.learn('despertar'); b.D.world('gate'); b.M.setHour(hour == null ? 6.5 : hour); b.D.teleport('throne'); b.tick(.5); return b.D.force('throne'); };

  // ---- 1. reload in the middle of her sequence, near the seat: it resumes and she gets her rewards
  {
    let b = box(fresh()); const r = startOwn(b);
    ok(r && b.S.endingOn && b.S.skipEnding() === false, 'reload A: her first sequence starts and cannot be skipped');
    b.tick(20); ok(b.W('awake') && b.F().endStarted && !b.F().seenEnd, 'reload A: 20 s in: world flag set, her rewards still pending');
    ok(b.L.save.flushes > 0, 'reload A: the record was flushed when it started');
    const snap = b.M.snapshot(); b = box(fresh(snap)); const mor = []; b.ev('morning', mor);
    ok(!b.S.endingOn, 'reload A: after the reload nothing runs yet'); b.tick(3);
    ok(b.S.endingOn && b.S.skipEnding() === false, 'reload A: near the seat her sequence resumes (not skippable)');
    b.tick(90);
    ok(!b.S.endingOn && b.S.camera === null && !b.S.busy, 'reload A: over, camera and input back');
    ok(b.F().seenEnd && b.F().crown && !b.F().endStarted && b.M.tames.join() === 'dragao_bebe' && b.W('home_keep') && b.W('lit_village'), 'reload A: rewards granted once');
    ok(mor.filter(d => d.phase === 'line').length === 4 && mor.some(d => d.phase === 'title'), 'reload A: her lines and title were shown');
    ok(!mor.some(d => d.phase === 'start' && d.skippable), 'reload A: never offered as a skippable replay');
  }
  // ---- 2. reload mid-sequence, far from the seat: the rewards are given quietly
  {
    let b = box(fresh()); startOwn(b); b.tick(12);
    const snap = b.M.snapshot(); snap.P.x += 500; b = box(fresh(snap)); const toasts = []; b.ev('toast', toasts);
    b.tick(4);
    ok(!b.S.endingOn && b.F().seenEnd && b.F().crown && b.M.tames.join() === 'dragao_bebe' && toasts.length === 1, 'reload B: far away: rewards and a short note, no sequence');
    b.D.teleport('throne'); b.tick(.5); const r = b.D.force('throne');
    ok(r && b.S.endingOn && b.S.skipEnding() === true, 'reload B: at the seat later it is a skippable memory');
    b.tick(3); ok(!b.S.endingOn && b.M.tames.length === 1, 'reload B: the memory gives nothing twice');
  }
  // ---- 3. co-op: the partner was first; she still gets her own sequence and rewards
  {
    const b = box(fresh()); const mor = []; b.ev('morning', mor);
    for (const id of ['gate', 'forge_key', 'awake', 'home_keep', 'lit_village']) b.M.partner(id);
    b.tick(1); b.D.teleport('throne'); b.tick(.5);
    const th = b.S.interactables(b.L.P.x, b.L.P.z, 6, b.L.P.y).find(i => i.id === 'throne');
    ok(!!th, 'co-op: the seat answers her even before she learned the word');
    ok(b.D.force('throne') && b.S.endingOn && b.S.skipEnding(), 'co-op: without the word: a skippable look');
    b.tick(2); ok(!b.S.endingOn && !b.F().seenEnd && !b.M.tames.length, 'co-op: the look gives no rewards');
    b.D.learn('despertar'); b.M.setHour(14); b.tick(.5); mor.length = 0;
    ok(b.D.force('throne') && b.S.endingOn && !b.S.skipEnding(), 'co-op: with the word: her own sequence, at any hour, not skippable');
    const r0 = b.M.restore, seen = []; const cr = b.L.castleRestore; b.L.castleRestore = p => { seen.push(p); cr(p); }; b.tick(80);
    ok(b.F().seenEnd && b.F().crown && b.M.tames.join() === 'dragao_bebe', 'co-op: her rewards');
    ok(b.W('home_keep').by === 'Bia' && b.W('awake').by === 'Bia', 'co-op: the shared rows are not rewritten');
    ok(mor.filter(d => d.phase === 'line').length === 4 && seen.every(p => p >= r0) && b.M.restore === 1, 'co-op: lines shown; the keep is not torn down and healed again');
    b.D.force('throne'); ok(b.S.endingOn && b.S.skipEnding(), 'co-op: afterwards a skippable memory'); b.tick(2);
    ok(b.M.tames.length === 1, 'co-op: no second reward');
  }
  // ---- 4. the lock wants the star in her own bag
  {
    const b = box(fresh()); b.M.partner('forge_key'); b.tick(1); b.D.teleport('castle_gate'); b.tick(.5);
    const lock = () => b.S.objects().find(o => o.id === 'lock');
    ok(!lock().can, 'lock: the partner forged the star: not usable by her');
    b.D.give('estrela', 1); b.tick(.2); ok(lock().can, 'lock: with the star in her bag it is');
  }
  // ---- 5. interaction distance
  {
    const b = box(fresh()); b.D.teleport('cottage'); b.L.P.x += 30; b.tick(.3);
    ok(b.S.interact('note_n01') === false && !(b.L.save.player.notes || {}).n01, 'reach: from 30 m nothing happens');
    b.D.goObj('note_n01'); b.tick(.3); b.S.interact('note_n01');
    ok(b.L.save.player.notes && b.L.save.player.notes.n01, 'reach: next to it the note is read');
  }
  // ---- 6. a letter bird finds her on the water
  {
    const b = box(fresh()); b.D.teleport('bay_chest'); b.L.P.y = 0; b.tick(.3);
    b.D.bird('n02'); let w = null; for (let i = 0; i < 300 && !w; i++) { b.tick(.1); w = b.D.birds().find(x => x.state === 'wait'); }
    ok(w && Math.abs(w.y - 0.05) < .2, 'water: the letter lands on the surface (y ' + (w ? w.y.toFixed(2) : '-') + ', ground ' + b.L.ground(b.L.P.x, b.L.P.z).toFixed(1) + ')');
  }
  // ---- 7. lying down at the camp at 05:00 does not count as the night
  {
    const b = box(fresh()); b.D.read('n06'); b.tick(2.5); ok(b.S.taskView().some(t => t.id === 'f4' && t.state === 'on'), 'vigil: f4 on');
    b.D.teleport('summit_camp'); b.M.sheltered = true; b.M.fireNear = true; b.M.setHour(5, true); b.tick(3);
    b.S.event('slept', { x: b.L.P.x, z: b.L.P.z }); b.L.clock.skipToDawn(); b.S.event('woke', {}); b.tick(2);
    ok(!(b.F().vigil && b.F().vigil.done), 'vigil: sleeping from 05:00 is not the whole night');
    b.M.setHour(19.5, true); b.tick(3); ok(b.F().vigil && !b.F().vigil.done, 'vigil: from nightfall it opens');
    b.S.event('slept', { x: b.L.P.x, z: b.L.P.z }); b.L.clock.skipToDawn(); b.S.event('woke', {}); b.tick(1);
    ok(b.F().vigil && b.F().vigil.done, 'vigil: and sleeping through then counts');
  }
  // ---- 8. cooldowns and running effects survive a reload
  {
    let b = box(fresh()); b.D.learn('faisca'); b.D.learn('luz'); b.L.save.player.st.mana = 100; b.tick(.2);
    ok(b.S.castSpell('faisca').ok && b.S.castSpell('luz').ok, 'timers: cast two spells');
    b = box(fresh(b.M.snapshot())); b.tick(.2);
    ok(b.S.castSpell('faisca').why === 'cd', 'timers: the cooldown is still there after a reload');
    const tm = b.D.timers(); ok(tm.fx.luz > tm.now + 30, 'timers: the light is still on after a reload');
  }
  // ---- 9. broken game hooks: the sequence ends anyway, rewards granted, control back; other parts keep running
  {
    const b = box(fresh()); let warns = 0; b.c.console.warn = () => { warns++; };
    b.L.castleRestore = () => { throw new Error('t1'); }; b.L.mistVisual.dissolve = () => { throw new Error('t2'); }; b.L.giveTame = () => { throw new Error('t3'); };
    startOwn(b); let threw = false; try { b.tick(100); } catch (e) { threw = true; }
    ok(!threw && !b.S.endingOn && b.S.camera === null && b.F().seenEnd && b.F().crown, 'hooks: throwing hooks: no exception, sequence over, rewards set');
    ok(warns > 0 && warns < 10, 'hooks: each failure reported once (' + warns + ' warnings)');
    b.L.castleObj = () => { throw new Error('t4'); }; b.L.storyBuilds = () => { throw new Error('t5'); };
    try { b.tick(10); } catch (e) { threw = true; }
    b.D.read('n03'); b.tick(12); ok(!threw && b.D.state().th.length > 0, 'hooks: a failing subsystem does not stop the others');
  }
  // ---- 10. odd frame times
  {
    const b = box(fresh()); let threw = false; const t0 = b.D.timers().now; let back = false, last = t0;
    for (const v of [NaN, -5, Infinity, undefined, null, 1e9, '0.1', -Infinity]) { try { b.S.tick(v); } catch (e) { threw = true; } const n = b.D.timers().now; if (!(n >= last) || !isFinite(n)) back = true; last = n; }
    ok(!threw && !back && last - t0 <= .45, 'dt: NaN, negative, infinite and huge frame times are safe (advanced ' + (last - t0).toFixed(2) + ' s)');
  }
  // ---- 11. the white veil reports changes, not every frame
  {
    const b = box(fresh()); const wh = []; b.ev('white', wh); const mc = b.L.MIST;
    b.S.CFG.clearR = 70; b.D.teleport([mc.x + mc.r - 50, mc.z]); let frames = 0; for (let t = 0; t < 12; t += 1 / 60) { b.S.tick(1 / 60); frames++; }
    const n1 = wh.length; for (let t = 0; t < 4; t += 1 / 60) b.S.tick(1 / 60);
    ok(n1 > 0 && n1 < frames / 3, 'white: ' + n1 + ' updates in ' + frames + ' frames');
    ok(wh.length - n1 <= 2, 'white: steady veil: no updates (' + (wh.length - n1) + ')');
  }
  // ---- 12. the guide gives up when she goes elsewhere, and comes back after the next stuck period
  {
    const b = box(fresh()); b.M.setHour(10); b.S.CFG.birdEvery = 1e9;
    const stuck = () => { b.F().progT = (b.F().playT || 0) - b.S.CFG.stuckAfter - 1; };
    const gb = () => b.D.birds().find(x => x.guide && x.state === 'guide');
    stuck(); for (let i = 0; i < 60 && !gb(); i++) b.tick(1);
    ok(!!gb(), 'guide: comes when she is stuck');
    b.L.P.x += 450; b.tick(4); ok(!gb(), 'guide: she went far the other way: it leaves');
    b.tick(30); ok(!gb(), 'guide: not straight back');
    b.tick(b.S.CFG.stuckAgain + 20); let back = false; for (let i = 0; i < 60 && !back; i++) { b.tick(1); back = !!gb(); }
    ok(back, 'guide: after the next stuck period a new one comes');
    b.tick(b.S.CFG.guideStall + 20); ok(!gb(), 'guide: she stands still for minutes: it gives up');
  }
  // ---- 13. a clue that is waiting for something (a plant growing) is skipped by the helper
  {
    const b = box(fresh());
    for (const n of ['n01', 'n03', 'n04', 'n12', 'n05', 'n07']) b.D.read(n);
    b.D.set('fire_cottage'); for (const s of ['brisa', 'brotar', 'luz']) b.D.learn(s); b.tick(2.5);
    const c0 = b.S.nextClue(); b.D.set('moon_planted'); const c1 = b.S.nextClue(); b.D.give('flor_lua', 1); const c2 = b.S.nextClue();
    ok(c0 === 'totem_choro' && c1 !== 'totem_choro' && c2 === 'totem_choro', 'clues: growing flower skipped (' + [c0, c1, c2].join(' > ') + ')');
  }
  // ---- 14. heights: an object placed while she was far is lifted onto a floor that streamed in later
  {
    const b = box(fresh()); b.L.P.x = 2000; b.L.P.z = 2000; b.tick(.3);
    const y0 = b.S.objects().find(o => o.id === 'note_n04').pos.y;
    b.L.groundAt = (x, z) => ({ y: b.L.ground(x, z) + 3 }); b.tick(.3);
    ok(b.S.objects().find(o => o.id === 'note_n04').pos.y === y0, 'heights: far away the cached height stays');
    b.D.teleport('bakery'); b.tick(.5); const y1 = b.S.objects().find(o => o.id === 'note_n04').pos.y;
    ok(Math.abs(y1 - y0 - 3) < .05, 'heights: coming near reads the new floor (+' + (y1 - y0).toFixed(2) + ')');
    b.L.groundAt = (x, z) => ({ y: b.L.ground(x, z) + 2 }); b.tick(3.5); const y3 = b.S.objects().find(o => o.id === 'note_n04').pos.y;
    ok(Math.abs(y3 - y0 - 2) < .05, 'heights: while she stays near, a floor that appears later is picked up (+' + (y3 - y0).toFixed(2) + ')');
    b.L.P.x += 3000; b.tick(.3); b.L.groundAt = (x, z) => ({ y: b.L.ground(x, z) + 1 }); b.S.event('colliders', {}); b.tick(.3);
    const y2 = b.S.objects().find(o => o.id === 'note_n04').pos.y; ok(Math.abs(y2 - y0 - 1) < .05, "heights: the 'colliders' event re-reads everything");
  }
  return { ok: okN, bad: badN, steps: out };
};
