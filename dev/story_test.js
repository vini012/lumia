#!/usr/bin/env node
/* Progression test runner.
   node dev/story_test.js            logic run of the whole chain in Node (no DOM, no WebGL), exit 1 on any failure
   node dev/story_test.js --shots    the same chain in headless Chromium (dev/story.html) + the UI screenshots
                                      (uses /home/claude/v5tools/run.js; PNGs in /home/claude/v5tools/shots/story/)
   node dev/story_test.js --small    small landscape phones (568x320, 667x375, 740x360, 844x390): screenshots of the UI
                                      scenes plus a layout check (story controls on screen, off the game's controls)
   Options: --quiet (only the summary), --only=<substring> (shots whose name contains it), --w= --h= (size). */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = a => args.indexOf(a) >= 0;
const opt = k => { const a = args.find(x => x.indexOf('--' + k + '=') === 0); return a ? a.slice(k.length + 3) : null; };

const SRC = {}; const src = f => SRC[f] || (SRC[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'));
// a fresh page: the scripts loaded in a new context (init = MOCK.snapshot() of an earlier one simulates a reload)
function fresh(init, extra) {
  const con = Object.assign(Object.create(console), { warn: (...a) => { if (!has('--quiet')) console.warn(...a); } });
  const ctx = { console: con, atob, btoa, TextDecoder, TextEncoder, setTimeout, clearTimeout, Date, Math, JSON, performance: { now: () => Date.now() } };
  ctx.window = ctx; ctx.globalThis = ctx; if (init) ctx.MOCK_INIT = init;
  vm.createContext(ctx);
  for (const f of ['js/lore.js', 'dev/story_mocks.js', 'js/story.js'].concat(extra || [])) vm.runInContext(src(f), ctx, { filename: f });
  ctx.L.story.init();
  return ctx;
}

function logicRun() {
  const t0 = Date.now();
  const ctx = fresh(null, ['dev/story_chain.js']);
  const r = ctx.CHAIN.run({ verbose: false });
  const fails = r.steps.filter(s => /^FAIL/.test(s));
  if (!has('--quiet')) console.log(r.steps.join('\n'));
  console.log(`\nchain (node): ${r.ok} ok, ${r.bad} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (fails.length) console.log(fails.join('\n'));
  // persistence: the player record and world rows must survive a JSON round trip (they go to the server as JSON)
  const pj = JSON.stringify(ctx.L.save.player), wj = JSON.stringify([...ctx.L.save.all('w5')]);
  const back = JSON.parse(pj); const okP = back.notes && back.tasks && back.sp && back.flags && Object.keys(back.notes).length > 40;
  console.log('persist: player ' + pj.length + ' B, world ' + wj.length + ' B ' + (okP ? 'ok' : 'FAIL'));
  // scenario cases: reloads, co-op, broken hooks, odd frame times, guide, heights...
  const t1 = Date.now(); const c = require('./story_cases.js')(fresh);
  if (!has('--quiet')) console.log(c.steps.join('\n'));
  console.log(`cases (node): ${c.ok} ok, ${c.bad} failed, ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  if (c.bad) console.log(c.steps.filter(s => /^FAIL/.test(s)).join('\n'));
  // the leak check (sentences, sensitive words, English words in comments) is part of the test
  const lk = cp.spawnSync('python3', [path.join(ROOT, 'tools/lore/check.py')], { encoding: 'utf8' });
  const okL = lk.status === 0; console.log('leak check: ' + ((lk.stdout || '').split('\n')[0] || lk.stderr) + (okL ? '' : '\n' + lk.stdout));
  return r.bad === 0 && okP && c.bad === 0 && okL;
}

function shotRun() {
  const RUN = '/home/claude/v5tools/run.js', OUT = '/home/claude/v5tools/shots/story';
  const only = opt('only');
  const W = +(opt('w') || 960), H = +(opt('h') || 540);
  fs.mkdirSync(OUT, { recursive: true });
  const run = cfg => {
    const r = cp.spawnSync('node', [RUN], { env: Object.assign({}, process.env, { CFG: JSON.stringify(cfg) }), encoding: 'utf8', maxBuffer: 64 << 20, timeout: 1800000 });
    const out = (r.stdout || '') + (r.stderr || ''); process.stdout.write(out); return out;
  };
  let good = true;
  // 1. the whole chain inside the browser, with three.js and the journal UI alive (fresh page)
  if (!only) {
    const out = run({ root: ROOT, page: 'dev/story.html?shots=1', w: W, h: H, steps: [{ ready: 'window.STORYDEV && STORYDEV.ready', timeout: 120000 }, { n: 'chain', ev: 'STORYDEV.chain()', max: 4000 }, { shot: 'story/chain_end' },
      { n: 'journalscroll', ev: 'STORYDEV.journalScroll()' }, { n: 'skipcheck', ev: 'STORYDEV.skipCheck()' }, { ev: 'STORYDEV.render()' }, { shot: 'story/after_skip' }, { n: 'perf', ev: 'L.story.debug.perf()' }] });
    const m = /chain: (\{.*\})/.exec(out); let r = null; try { r = m && JSON.parse(m[1]); } catch (e) { }
    console.log('chain (browser): ' + (r ? r.ok + ' ok, ' + r.bad + ' failed' : 'no result'));
    const js = /journalscroll: (\{.*\})/.exec(out), sk = /skipcheck: (\{.*\})/.exec(out); let jr = null, sr = null; try { jr = JSON.parse(js[1]); sr = JSON.parse(sk[1]); } catch (e) { }
    const okJ = !!jr && jr.before > 0 && jr.after === jr.before && jr.same, okS = !!sr && sr.skipped && !sr.on && !sr.cinema && !sr.line && !sr.left.length;
    console.log('journal keeps its scroll: ' + (okJ ? 'ok' : 'FAIL ' + JSON.stringify(jr)) + '\nskip leaves nothing on screen: ' + (okS ? 'ok' : 'FAIL ' + JSON.stringify(sr)));
    good = good && !!r && r.bad === 0 && okJ && okS && /errors 0/.test(out);
  }
  // 2. one screenshot per scene; each scene is set up by STORYDEV.scene(name) inside dev/story.html (fresh page)
  const scenes = ['note', 'note_letter', 'note_stone', 'note_diary', 'note_rune', 'note_wood', 'note_drawing', 'journal_cartas', 'journal_sonhos', 'journal_pensamentos', 'journal_tarefas', 'dialog', 'learn', 'spells', 'star', 'dream', 'world_props', 'world_bird', 'world_bridge', 'world_beam', 'world_throne', 'note_last', 'mist', 'reveal', 'morning_line', 'morning_title', 'morning_personal'];
  const steps = [{ ready: 'window.STORYDEV && STORYDEV.ready', timeout: 120000 }];
  for (const s of scenes) {
    if (only && !only.split(',').some(o => s.indexOf(o) >= 0)) continue;
    steps.push({ n: s, ev: `STORYDEV.scene(${JSON.stringify(s)})` }, { wait: s === 'dream' ? 3600 : 1700 }, { ready: 'STORYDEV.settled()', timeout: 60000 }, { shot: 'story/' + s + (W !== 960 ? '_' + W : '') });
  }
  const out = run({ root: ROOT, page: 'dev/story.html?shots=1', w: W, h: H, steps, touch: true });
  return good && !/PAGEERR|STEPERR|FATAL/.test(out) && /errors 0/.test(out);
}

function smallRun() {
  const RUN = '/home/claude/v5tools/run.js', SIZES = [[568, 320], [667, 375], [740, 360], [844, 390]];
  const scenes = ['note', 'journal_cartas', 'journal_tarefas', 'dialog', 'learn', 'spells', 'star', 'mist', 'morning_title'];
  let good = true;
  for (const [w, h] of SIZES) {
    const steps = [{ ready: 'window.STORYDEV && STORYDEV.ready', timeout: 120000 }];
    for (const s of scenes) steps.push({ n: s, ev: `STORYDEV.scene(${JSON.stringify(s)})` }, { wait: 1700 }, { ready: 'STORYDEV.settled()', timeout: 60000 }, { shot: `story/small/${s}_${w}x${h}` }, { n: 'layout_' + s, ev: 'STORYDEV.layout()' });
    const r = cp.spawnSync('node', [RUN], { env: Object.assign({}, process.env, { CFG: JSON.stringify({ root: ROOT, page: 'dev/story.html?shots=1', w, h, steps, touch: true }) }), encoding: 'utf8', maxBuffer: 64 << 20, timeout: 1800000 });
    const out = (r.stdout || '') + (r.stderr || ''); if (!has('--quiet')) process.stdout.write(out);
    const bad = out.split('\n').filter(l => /^layout_/.test(l) && !/: \[\]$/.test(l));
    const ok = !bad.length && !/PAGEERR|STEPERR|FATAL/.test(out) && /errors 0/.test(out);
    console.log(`small ${w}x${h}: ` + (ok ? 'layout ok' : 'FAIL\n  ' + bad.join('\n  ') + (/errors 0/.test(out) ? '' : '\n  page errors')));
    good = good && ok;
  }
  return good;
}

let good = true;
if (!has('--shots-only') && !has('--small-only')) good = logicRun() && good;
if (has('--shots') || has('--shots-only')) good = shotRun() && good;
if (has('--small') || has('--small-only')) good = smallRun() && good;
process.exit(good ? 0 : 1);
