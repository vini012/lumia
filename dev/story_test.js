#!/usr/bin/env node
/* Progression test runner.
   node dev/story_test.js            logic run of the whole chain in Node (no DOM, no WebGL), exit 1 on any failure
   node dev/story_test.js --shots    the same chain in headless Chromium (dev/story.html) + the UI screenshots
                                      (uses /home/claude/v5tools/run.js; PNGs in /home/claude/v5tools/shots/story/)
   Options: --quiet (only the summary), --only=<substring> (shots whose name contains it). */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = a => args.indexOf(a) >= 0;
const opt = k => { const a = args.find(x => x.indexOf('--' + k + '=') === 0); return a ? a.slice(k.length + 3) : null; };

function logicRun() {
  const ctx = { console, atob, btoa, TextDecoder, TextEncoder, setTimeout, clearTimeout, Date, Math, JSON, performance: { now: () => Date.now() } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['js/lore.js', 'dev/story_mocks.js', 'js/story.js', 'dev/story_chain.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const t0 = Date.now();
  ctx.L.story.init();
  const r = ctx.CHAIN.run({ verbose: false });
  const fails = r.steps.filter(s => /^FAIL/.test(s));
  if (!has('--quiet')) console.log(r.steps.join('\n'));
  console.log(`\nchain (node): ${r.ok} ok, ${r.bad} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (fails.length) console.log(fails.join('\n'));
  // persistence: the player record and world rows must survive a JSON round trip (they go to the server as JSON)
  const pj = JSON.stringify(ctx.L.save.player), wj = JSON.stringify([...ctx.L.save.all('w5')]);
  const back = JSON.parse(pj); const okP = back.notes && back.tasks && back.sp && back.flags && Object.keys(back.notes).length > 40;
  console.log('persist: player ' + pj.length + ' B, world ' + wj.length + ' B ' + (okP ? 'ok' : 'FAIL'));
  return r.bad === 0 && okP;
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
    const out = run({ root: ROOT, page: 'dev/story.html?shots=1', w: W, h: H, steps: [{ ready: 'window.STORYDEV && STORYDEV.ready', timeout: 120000 }, { n: 'chain', ev: 'STORYDEV.chain()', max: 4000 }, { shot: 'story/chain_end' }] });
    const m = /chain: (\{.*\})/.exec(out); let r = null; try { r = m && JSON.parse(m[1]); } catch (e) { }
    console.log('chain (browser): ' + (r ? r.ok + ' ok, ' + r.bad + ' failed' : 'no result'));
    good = good && !!r && r.bad === 0 && /errors 0/.test(out);
  }
  // 2. one screenshot per scene; each scene is set up by STORYDEV.scene(name) inside dev/story.html (fresh page)
  const scenes = ['note', 'note_letter', 'note_stone', 'note_diary', 'note_rune', 'note_wood', 'note_drawing', 'journal_cartas', 'journal_sonhos', 'journal_pensamentos', 'journal_tarefas', 'dialog', 'learn', 'spells', 'star', 'dream', 'world_props', 'world_bird', 'world_bridge', 'world_beam', 'world_throne', 'note_last', 'mist', 'reveal', 'ending_line', 'ending_title', 'ending_personal'];
  const steps = [{ ready: 'window.STORYDEV && STORYDEV.ready', timeout: 120000 }];
  for (const s of scenes) {
    if (only && !only.split(',').some(o => s.indexOf(o) >= 0)) continue;
    steps.push({ n: s, ev: `STORYDEV.scene(${JSON.stringify(s)})` }, { wait: s === 'dream' ? 3600 : 1700 }, { ready: 'STORYDEV.settled()', timeout: 60000 }, { shot: 'story/' + s + (W !== 960 ? '_' + W : '') });
  }
  const out = run({ root: ROOT, page: 'dev/story.html?shots=1', w: W, h: H, steps, touch: true });
  return good && !/PAGEERR|STEPERR|FATAL/.test(out) && /errors 0/.test(out);
}

let good = true;
if (!has('--shots-only')) good = logicRun() && good;
if (has('--shots') || has('--shots-only')) good = shotRun() && good;
process.exit(good ? 0 : 1);
