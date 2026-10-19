/* Lumiar v5 survival HUD (L.survUI): four small round gauges (Fome, Energia, Mana, Frio) on a parchment strip, the
   save cloud (salvo / salvando / sem internet), active food buffs, soft handwritten hints ("Você está com fome."),
   the frost vignette, and the full-screen fades for sleeping (night -> dawn) and for the soft respawn (white).
   Everything is injected by JS (no markup in index.html). It reads L.surv / L.save and listens to their events;
   without them it shows calm defaults. Style: GDD 8 (cream parchment, brown ink, hand-drawn borders, washi tape,
   Grandstander for labels, Caveat for handwriting). The root sits below the story overlay (z 50 < 60). */
'use strict';
(function (L) {
  if (typeof document === 'undefined') return;
  const SCRIPT = document.currentScript;
  const BASE = (() => { try { const s = SCRIPT && SCRIPT.src; if (s && /js\/survui\.js/.test(s)) return s.replace(/js\/survui\.js(\?.*)?$/, ''); } catch (e) { } return ''; })();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ================================================================ icons (24x24, stroke = currentColor)
  const ICON = {
    fome: '<path d="M12 7.6c-1.7-1.3-4.7-1.3-6.1.9-1.6 2.5-.8 6.7 1.3 9.3 1.3 1.6 2.8 2.2 4.8 1.4 2 .8 3.5.2 4.8-1.4 2.1-2.6 2.9-6.8 1.3-9.3-1.4-2.2-4.4-2.2-6.1-.9z"/><path d="M12 7.6c-.1-1.9.5-3.3 1.7-4.3"/><path class="sv-f" d="M13.1 5.6c1.2-1.6 3.2-2 4.6-1.5-.3 1.7-2.2 2.8-4.6 1.5z"/><path d="M8.3 11.2c-.5.9-.6 2.1-.2 3.2" opacity=".55"/>',
    en: '<path class="sv-f" d="M13.6 2.6 6.2 13.1h5.1l-1.4 8.3 7.9-11h-5.2z"/>',
    mana: '<path d="M12 3.2c2.9 3.9 5.9 7.1 5.9 10.4a5.9 5.9 0 0 1-11.8 0c0-3.3 3-6.5 5.9-10.4z"/><path d="M9.2 14.4c.1 1.5 1.2 2.6 2.7 2.8" opacity=".6"/><path class="sv-f" d="M17.6 3.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" stroke-width="1"/>',
    frio: '<path d="M12 2.8v18.4M4 7.4l16 9.2M4 16.6l16-9.2"/><path d="M9.6 4.2 12 6.3l2.4-2.1M9.6 19.8 12 17.7l2.4 2.1M4.6 10.5l3.1-.6-1-3M19.4 13.5l-3.1.6 1 3M4.6 13.5l3.1.6-1 3M19.4 10.5l-3.1-.6 1-3"/>',
    quente: '<path class="sv-f" d="M12 21.2c-3.5 0-5.9-2.4-5.9-5.5 0-3.4 2.6-5 3.3-8.6 1.6 1.2 2.4 2.9 2.4 4.4 1.1-.9 1.7-2.4 1.6-4.1 2.7 1.9 4.6 4.8 4.6 8.3 0 3.1-2.4 5.5-6 5.5z"/><path d="M12 21.2c-1.5 0-2.6-1-2.6-2.5 0-1.6 1.3-2.4 1.7-4 1.9 1.2 3.5 2.4 3.5 4 0 1.5-1.1 2.5-2.6 2.5z" opacity=".7"/>',
    gota: '<path class="sv-f" d="M12 3.5c2.6 3.6 5.2 6.4 5.2 9.6a5.2 5.2 0 0 1-10.4 0c0-3.2 2.6-6 5.2-9.6z"/>',
    nuvem: '<path d="M6.8 18.6h10.6a3.9 3.9 0 0 0 .5-7.8 5.6 5.6 0 0 0-10.8-1.3 4.6 4.6 0 0 0-.3 9.1z"/>',
    ok: '<path d="M9.4 14.3l1.9 1.9 3.6-3.8"/>',
    up: '<path d="M12 16.6v-5.2M9.7 13.6 12 11.3l2.3 2.3"/>',
    off: '<path d="M4.6 4.4 19.4 20"/>',
    wait: '<path d="M9.2 14.9h.01M12 14.9h.01M14.8 14.9h.01" stroke-width="2.3"/>',
    casa: '<path d="M3.8 11.6 12 4.8l8.2 6.8"/><path d="M6.3 9.8v9h11.4v-9"/><path d="M10.4 18.8v-4.3h3.2v4.3"/>',
    lua: '<path class="sv-f" d="M15.4 3.6a8.6 8.6 0 1 0 5 13.9A7.1 7.1 0 0 1 15.4 3.6z"/>',
    sol: '<circle class="sv-f" cx="12" cy="12" r="4.4"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M5.4 18.6l1.8-1.8M16.8 7.2l1.8-1.8"/>',
  };
  const svg = (k, cls) => '<svg class="sv-i ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>';

  // ================================================================ style
  const TAPE = 'polygon(2% 8%,98% 0,100% 20%,97% 38%,100% 56%,97% 74%,100% 92%,96% 100%,3% 95%,0 78%,3% 60%,0 42%,3% 24%,0 10%)';
  const CSS = `
@font-face{font-family:'Caveat';src:url('${BASE}assets/fonts/caveat.woff2') format('woff2');font-weight:400 700;font-display:swap}
@font-face{font-family:'Grandstander';src:url('${BASE}assets/fonts/grandstander.woff2') format('woff2');font-weight:100 900;font-display:swap}
#sv{position:fixed;inset:0;z-index:50;pointer-events:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;
 --sat:env(safe-area-inset-top,0px);--sal:env(safe-area-inset-left,0px);
 --paper:#f6ead0;--paper2:#ecd8b0;--ink:#7a5b45;--ink2:#5a3f2c;--soft:#a3876b;--text:#4c3727;--track:rgba(122,91,69,.17);
 --hand:'Caveat','Kalam','Segoe Print','Bradley Hand','Comic Sans MS',cursive;--title:'Grandstander','Itim','Fredoka','Baloo 2',system-ui,sans-serif;
 --gs:clamp(36px,min(6.4vh,4.6vw),52px);font-family:var(--title);color:var(--ink)}
#sv[hidden]{display:none}
#sv *{box-sizing:border-box}
#sv .sv-i{display:block;width:100%;height:100%}
#sv .sv-i .sv-f{fill:currentColor;fill-opacity:.22}
.sv-hud{position:absolute;top:calc(var(--sat) + 10px);left:calc(var(--sal) + 12px);display:flex;align-items:flex-start;gap:clamp(5px,.9vw,9px);
 padding:7px 10px 6px 9px;pointer-events:auto;transform:rotate(-.6deg);transform-origin:0 0;transition:opacity .6s,transform .6s;
 background:radial-gradient(120% 140% at 30% 20%,#fbf3e1 0,var(--paper) 55%,var(--paper2) 100%);
 border:2px solid var(--ink);border-radius:20px 14px 22px 13px/14px 22px 13px 20px;box-shadow:0 3px 0 rgba(122,91,69,.42),0 7px 16px rgba(30,20,10,.2)}
.sv-hud::before{content:'';position:absolute;left:62%;top:-9px;width:44px;height:16px;transform:rotate(5deg);opacity:.88;clip-path:${TAPE};
 background:repeating-linear-gradient(-45deg,rgba(255,255,255,.25) 0 4px,rgba(255,255,255,0) 4px 9px),#86bcae}
#sv.sv-fade .sv-hud{opacity:0;transform:rotate(-.6deg) translateY(-12px)}
.sv-g{position:relative;width:var(--gs);display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer}
.sv-dial{position:relative;width:var(--gs);height:var(--gs);border-radius:52% 48% 50% 50%/50% 53% 47% 50%;transition:transform .25s}
.sv-g:nth-child(2) .sv-dial{border-radius:48% 52% 47% 53%/53% 48% 52% 47%}
.sv-g:nth-child(3) .sv-dial{border-radius:50% 50% 53% 47%/47% 50% 50% 53%}
.sv-g:nth-child(4) .sv-dial{border-radius:53% 47% 50% 50%/50% 47% 53% 50%}
.sv-ring{position:absolute;inset:0;border-radius:inherit;
 background:conic-gradient(from -2deg,var(--c) 0 calc(var(--v,1) * 360deg),var(--track) 0 calc(var(--cap,1) * 360deg),rgba(90,63,44,.42) 0);
 -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 5.5px),#000 calc(100% - 5px));mask:radial-gradient(farthest-side,transparent calc(100% - 5.5px),#000 calc(100% - 5px));transition:filter .4s}
.sv-disc{position:absolute;inset:5px;border-radius:inherit;display:flex;align-items:center;justify-content:center;padding:12%;color:var(--ink2);
 background:radial-gradient(circle at 36% 28%,#fffbf1 0,#fbf1db 55%,#efdfbd 100%);border:1.6px solid var(--ink);transition:background .5s,color .5s}
.sv-dial::after{content:'';position:absolute;inset:-1px;border-radius:inherit;border:2px solid var(--ink);pointer-events:none}
.sv-g b{font:700 clamp(10px,calc(var(--gs) * .235),12px)/1 var(--title);letter-spacing:.02em;color:var(--ink2);white-space:nowrap;transition:opacity .8s,max-height .8s;max-height:14px;overflow:hidden}
#sv.sv-nolabels .sv-g b{opacity:0;max-height:0}
.sv-fome{--c:#e3874a}.sv-en{--c:#9cba3a}.sv-mana{--c:#4d9be0}.sv-frio{--c:#7cc4ea}
.sv-fome.sv-low{--c:#d0583f}.sv-fome.sv-low .sv-disc{color:#a8432d}
.sv-fome.sv-low .sv-dial{animation:sv-wob 3.2s ease-in-out infinite}
.sv-fome.sv-zero .sv-disc{background:radial-gradient(circle at 36% 28%,#fff3e8 0,#f6dccb 60%,#eac2ac 100%)}
.sv-en.sv-tired .sv-ring{animation:sv-blink 1s ease-in-out infinite}
.sv-en.sv-tired .sv-disc{color:#9b8a72}
.sv-frio.sv-cold .sv-disc{color:#2f74a8;background:radial-gradient(circle at 36% 28%,#ffffff 0,#e8f4fb 55%,#cfe6f3 100%)}
.sv-frio.sv-cold .sv-i{animation:sv-spin 9s linear infinite}
.sv-frio.sv-warm{--c:#f2a24e}.sv-frio.sv-warm .sv-disc{color:#c8602a;background:radial-gradient(circle at 36% 28%,#fffaf0 0,#fde9cf 55%,#f7d2a6 100%)}
.sv-frio.sv-warm .sv-i{animation:sv-flick 1.6s ease-in-out infinite}
.sv-wet{position:absolute;right:-5px;bottom:-3px;width:17px;height:17px;padding:2px;border-radius:50%;background:#fbf3e1;border:1.5px solid var(--ink);color:#3f86bd;opacity:0;transform:scale(.6);transition:opacity .4s,transform .4s}
.sv-frio.sv-iswet .sv-wet{opacity:1;transform:none}
.sv-bump .sv-dial{animation:sv-bump .55s cubic-bezier(.2,.9,.3,1.4)}
.sv-cloud{position:relative;align-self:center;width:calc(var(--gs) * .62);height:calc(var(--gs) * .62);margin:0 0 calc(var(--gs) * .2) 2px;color:var(--ink);cursor:pointer;transition:opacity 1.2s,color .4s}
.sv-cloud .sv-i{position:absolute;inset:0}
.sv-cloud[data-s="ok"].sv-quiet{opacity:.42}
.sv-cloud[data-s="saving"] .sv-k{animation:sv-up 1.1s ease-in-out infinite}
.sv-cloud[data-s="off"]{color:#b4553e}
.sv-cloud[data-s="off"] .sv-i:first-child{stroke-dasharray:3 2.2}
.sv-cloud[data-s="err"]{color:#a0773f}
.sv-buffs{position:absolute;top:calc(var(--sat) + 14px + var(--gs) + 26px);left:calc(var(--sal) + 16px);display:flex;gap:6px;flex-wrap:wrap;max-width:60vw;transition:top .8s}
#sv.sv-nolabels .sv-buffs{top:calc(var(--sat) + 14px + var(--gs) + 13px)}
.sv-buff{display:flex;align-items:center;gap:4px;padding:2px 8px 2px 4px;border-radius:11px 8px 12px 9px;background:rgba(251,243,225,.95);border:1.5px solid rgba(122,91,69,.6);
 font:700 11px/1.3 var(--title);color:var(--ink2);box-shadow:0 2px 0 rgba(122,91,69,.25);animation:sv-in .35s ease both}
#sv .sv-buff .sv-i{width:15px;height:15px}
.sv-buff.sv-b-quente{color:#b4552a}.sv-buff.sv-b-resistente{color:#3c7aa6}.sv-buff.sv-b-energia{color:#6c8a1f}
.sv-bubble{position:absolute;top:calc(var(--sat) + 14px + var(--gs) + 30px);left:calc(var(--sal) + 14px);max-width:min(72vw,360px);padding:6px 16px 7px 14px;
 background:rgba(255,253,247,.96);border:1.5px solid rgba(122,91,69,.55);border-radius:22px 26px 20px 28px/20px 18px 24px 22px;box-shadow:0 4px 12px rgba(36,22,10,.18);
 font:600 clamp(19px,min(2.6vw,5vh),23px)/1.15 var(--hand);color:var(--text);opacity:0;transform:translateY(-6px) scale(.97);transform-origin:var(--tx,24px) 0;transition:opacity .45s,transform .45s}
.sv-bubble::before{content:'';position:absolute;left:var(--tx,24px);top:-8px;width:13px;height:13px;margin-left:-7px;background:inherit;border-left:1.5px solid rgba(122,91,69,.55);border-top:1.5px solid rgba(122,91,69,.55);transform:rotate(45deg);border-radius:3px 0 0 0}
.sv-bubble.sv-on{opacity:1;transform:none}
#sv.sv-hasbuffs .sv-bubble{top:calc(var(--sat) + 14px + var(--gs) + 56px)}
.sv-float{position:absolute;font:800 14px/1 var(--title);color:#55801a;padding:3px 7px 2px;border-radius:10px 8px 11px 7px;background:var(--paper);border:1.5px solid var(--ink);box-shadow:0 2px 0 rgba(122,91,69,.35);animation:sv-float 1.5s ease-out both;pointer-events:none;white-space:nowrap}
.sv-frost{position:absolute;inset:0;opacity:0;transition:opacity 1.2s;
 background:radial-gradient(ellipse 72% 68% at 50% 50%,rgba(225,242,255,0) 58%,rgba(214,236,252,.42) 80%,rgba(240,250,255,.82) 100%);
 box-shadow:inset 0 0 70px 18px rgba(232,246,255,.55)}
.sv-frost::after{content:'';position:absolute;inset:0;opacity:.55;
 background:radial-gradient(circle at 4% 10%,rgba(255,255,255,.8) 0 1.5px,transparent 2.5px) 0 0/37px 41px,radial-gradient(circle at 60% 40%,rgba(255,255,255,.7) 0 1px,transparent 2px) 0 0/23px 29px;
 -webkit-mask:radial-gradient(ellipse 70% 66% at 50% 50%,transparent 62%,#000 92%);mask:radial-gradient(ellipse 70% 66% at 50% 50%,transparent 62%,#000 92%)}
.sv-cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0;visibility:hidden;transition:opacity 1.1s,visibility 0s 1.1s;text-align:center;padding:24px}
.sv-cover.sv-on{opacity:1;visibility:visible;transition:opacity 1.1s,visibility 0s;pointer-events:auto}
.sv-sleep{background:radial-gradient(120% 90% at 50% 18%,#33508f 0,#22376e 45%,#141f45 100%)}
.sv-stars{position:absolute;inset:0;width:100%;height:100%;animation:sv-tw 4s ease-in-out infinite alternate}
.sv-sleep::after{content:'';position:absolute;inset:0;opacity:0;transition:opacity 1s;background:linear-gradient(180deg,#9ec6ee 0,#ffd9a6 44%,#ffeccb 62%,#fbf3e3 100%)}
.sv-sleep.sv-dawn::after{opacity:1}
.sv-sleep>*:not(.sv-stars){position:relative;z-index:1}
.sv-sleep.sv-dawn .sv-stars{opacity:0;transition:opacity 1s}
.sv-orb{width:clamp(48px,10vh,80px);height:clamp(48px,10vh,80px)}
.sv-moon,.sv-sun{position:absolute;inset:0}
.sv-moon{color:#ffeab0;filter:drop-shadow(0 0 14px rgba(255,236,170,.7));transition:opacity 1.2s,transform 1.6s}
.sv-moon .sv-f{fill-opacity:.95}
.sv-sun{color:#f0a63a;opacity:0;transform:translateY(34px) scale(.8);transition:opacity 1.4s,transform 2.2s cubic-bezier(.2,.8,.3,1);filter:drop-shadow(0 0 18px rgba(255,190,90,.9))}
.sv-sun .sv-f{fill-opacity:.85}
.sv-sleep.sv-dawn .sv-sun{opacity:1;transform:scale(1.15)}.sv-sleep.sv-dawn .sv-moon{opacity:0;transform:translateY(-30px)}
.sv-big{font:700 clamp(34px,min(6vw,10vh),58px)/1.05 var(--hand);color:#fbf3e1;text-shadow:0 2px 12px rgba(10,16,40,.5);transition:color 1.2s}
.sv-small{min-height:1.3em;font:600 clamp(19px,min(2.8vw,5vh),26px)/1.2 var(--hand);color:#d6def4;transition:color 1.2s}
.sv-sleep.sv-dawn .sv-big{color:var(--ink2);text-shadow:0 1px 0 rgba(255,255,255,.6)}.sv-sleep.sv-dawn .sv-small{color:var(--ink)}
.sv-zz{font:700 clamp(18px,3vh,24px)/1 var(--hand);color:#cfdcff;letter-spacing:.15em;animation:sv-zz 2.6s ease-in-out infinite}
.sv-sleep.sv-dawn .sv-zz{opacity:0;animation:none;transition:opacity .4s}
.sv-btn{margin-top:8px;min-height:44px;padding:8px 22px 9px;border:2px solid var(--ink);border-radius:16px 10px 18px 11px/11px 18px 10px 16px;background:#fbf2dd;color:var(--ink2);
 font:700 16px/1 var(--title);box-shadow:0 3px 0 rgba(122,91,69,.45);cursor:pointer;opacity:0;transform:translateY(6px);transition:opacity .5s,transform .5s;pointer-events:none}
.sv-btn.sv-on{opacity:1;transform:none;pointer-events:auto}
.sv-btn:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(122,91,69,.45)}
.sv-resp{background:radial-gradient(circle at 30% 35%,#ffffff 0,rgba(255,255,255,0) 38%),radial-gradient(circle at 72% 62%,#ffffff 0,rgba(255,255,255,0) 42%),radial-gradient(120% 120% at 50% 50%,#fbfcfd 0,#eef2f7 70%,#e3e9f1 100%);transition:opacity .75s,visibility 0s .75s}
.sv-resp.sv-on{transition:opacity .75s,visibility 0s}
.sv-puffs{position:absolute;left:-8%;top:-4%;width:116%;height:108%;opacity:.9;animation:sv-drift 9s ease-in-out infinite alternate}
.sv-resp>*:not(.sv-puffs){position:relative;z-index:1}
.sv-resp .sv-big{color:var(--ink2);text-shadow:0 1px 0 #fff;font-size:clamp(28px,min(4.6vw,8vh),44px);opacity:0;transform:translateY(8px);transition:opacity .9s .35s,transform .9s .35s}
.sv-resp.sv-on .sv-big{opacity:1;transform:none}
.sv-tip{position:absolute;max-width:min(76vw,330px);padding:8px 13px 9px;border-radius:14px 18px 13px 19px/16px 13px 18px 14px;background:rgba(251,243,225,.98);border:1.5px solid var(--ink);
 box-shadow:0 5px 14px rgba(36,22,10,.25);font:600 13px/1.3 var(--title);color:var(--ink2);opacity:0;transform:translateY(-4px);transition:opacity .3s,transform .3s;pointer-events:none}
.sv-tip.sv-on{opacity:1;transform:none}
.sv-tip b{display:block;font:800 14px/1.2 var(--title);color:var(--ink)}
.sv-tip em{display:block;margin-top:2px;font:600 18px/1.1 var(--hand);font-style:normal;color:var(--text)}
@keyframes sv-wob{0%,82%,100%{transform:none}86%{transform:rotate(-7deg)}90%{transform:rotate(6deg)}94%{transform:rotate(-3deg)}}
@keyframes sv-blink{0%,100%{filter:none}50%{filter:brightness(1.35) saturate(.4)}}
@keyframes sv-spin{to{transform:rotate(360deg)}}
@keyframes sv-flick{0%,100%{transform:scale(1)}40%{transform:scale(1.07,.95)}70%{transform:scale(.96,1.05)}}
@keyframes sv-bump{0%{transform:scale(1)}35%{transform:scale(1.18)}100%{transform:scale(1)}}
@keyframes sv-up{0%{transform:translateY(1.5px);opacity:.5}50%{transform:translateY(-1.5px);opacity:1}100%{transform:translateY(1.5px);opacity:.5}}
@keyframes sv-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@keyframes sv-float{0%{opacity:0;transform:translateY(6px) scale(.8)}14%{opacity:1;transform:translateY(0) scale(1.05)}70%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}
@keyframes sv-drift{from{transform:translateX(-1.5%)}to{transform:translateX(1.5%)}}
@keyframes sv-tw{from{opacity:.65}to{opacity:1}}
@keyframes sv-zz{0%,100%{opacity:.35;transform:translateY(2px)}50%{opacity:.9;transform:translateY(-3px)}}
@media (max-height:430px){#sv{--gs:clamp(34px,9.4vh,40px)}.sv-hud{padding:5px 8px 4px 7px}.sv-g b{font-size:10px}}
@media (prefers-reduced-motion:reduce){#sv *{animation:none!important}}
`;

  // night sky and soft cloud puffs for the sleep / respawn covers (random once, drawn as one SVG each)
  function starsSVG() {
    let r = 7, c = ''; const R = () => (r = (r * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) { const x = R() * 1000, y = R() * 560, s = R(), rad = s > .93 ? 2.2 : s > .7 ? 1.5 : .9, op = .45 + R() * .5, col = R() > .8 ? '#fff3c8' : '#e8efff';
      c += s > .97 ? '<path d="M' + x.toFixed(1) + ' ' + (y - 6).toFixed(1) + 'l1.3 4.7 4.7 1.3-4.7 1.3-1.3 4.7-1.3-4.7-4.7-1.3 4.7-1.3z" fill="' + col + '" opacity="' + op.toFixed(2) + '"/>' : '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + rad + '" fill="' + col + '" opacity="' + op.toFixed(2) + '"/>'; }
    return '<svg class="sv-stars" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + c + '</svg>';
  }
  function puffsSVG() {
    const puff = (x, y, s, o) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" opacity="' + o + '"><ellipse cx="0" cy="0" rx="120" ry="46" fill="#fff"/><circle cx="-50" cy="-22" r="48" fill="#fff"/><circle cx="18" cy="-42" r="60" fill="#fff"/><circle cx="78" cy="-14" r="40" fill="#fff"/><ellipse cx="0" cy="30" rx="118" ry="16" fill="#dfe6ef" opacity=".55"/></g>';
    return '<svg class="sv-puffs" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + puff(140, 120, 1.1, .9) + puff(820, 90, .9, .85) + puff(900, 470, 1.3, .9) + puff(90, 470, 1, .8) + puff(520, 520, 1.4, .7) + '</svg>';
  }

  // ================================================================ DOM
  const GA = [['fome', 'Fome'], ['en', 'Energia'], ['mana', 'Mana'], ['frio', 'Frio']];
  const TIPS = {
    fome: v => ['Fome', Math.round(v.fome) + ' de 100', v.fome < 25 ? 'Coma algo gostoso: frutinhas, pão, sopa…' : 'Comer enche a barriga e dá energia.'],
    en: v => ['Energia', Math.round(v.en) + ' de ' + Math.round(v.enMax), v.enMax < 99 ? 'Com fome, a energia não enche toda.' : 'Correr, nadar e planar gastam energia.'],
    mana: v => ['Mana', Math.round(v.mana) + ' de ' + Math.round(v.manaMax || 100), 'Volta mais rápido perto do fogo e com a barriga cheia.'],
    frio: v => v.warm ? ['Quentinho', 'protegido do frio', 'Comida quente e fogo espantam o frio.'] : ['Frio', v.frio < .05 ? 'tudo bem' : Math.round(v.frio * 100) + '%', 'De noite, no alto e molhado esfria. Abrigo e fogo esquentam.'],
  };
  const CLOUD_TXT = {
    ok: ['Tudo salvo', 'Seu mundo está guardado.'],
    saving: ['Salvando…', 'Guardando o que mudou.'],
    off: ['Sem internet', 'Tudo fica guardado aqui e segue quando a conexão voltar.'],
    err: ['Não deu para salvar agora', 'Tentamos de novo daqui a pouco. Nada se perde.'],
    local: ['Salvo neste aparelho', 'Este mundo fica guardado aqui.'],
  };
  const U = { el: null, g: {}, ready: false, shown: false, last: {}, cloud: 'ok', okSince: 0, hintT: 0, tipT: 0, labelsT: 0, sleepPhase: '', buffsKey: null, iv: 0, warmMax: 60 };
  const $ = (cls, parent, tag, html) => { const e = document.createElement(tag || 'div'); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

  function build(opt) {
    if (!document.getElementById('sv-css')) { const st = document.createElement('style'); st.id = 'sv-css'; st.textContent = CSS; document.head.appendChild(st); }
    const root = $('', null); root.id = 'sv'; root.hidden = true; U.el = root;
    U.frost = $('sv-frost', root);
    const hud = U.hud = $('sv-hud', root); hud.setAttribute('aria-label', 'Como você está');
    for (const [k, n] of GA) {
      const g = $('sv-g sv-' + k, hud); const d = $('sv-dial', g); $('sv-ring', d); const disc = $('sv-disc', d, 'div', svg(k));
      if (k === 'frio') $('sv-wet', d, 'div', svg('gota'));
      const lb = $('', g, 'b'); lb.textContent = n; g.dataset.k = k; U.g[k] = { g, disc, ic: k, lb, name: n };
      g.addEventListener('pointerdown', e => { e.stopPropagation(); tip(k); });
    }
    const cl = U.cloudEl = $('sv-cloud', hud, 'div', svg('nuvem') + '<span class="sv-k" style="position:absolute;inset:0">' + svg('ok') + '</span>'); cl.dataset.s = 'ok';
    cl.addEventListener('pointerdown', e => { e.stopPropagation(); tip('cloud'); if ((U.cloud === 'off' || U.cloud === 'err') && L.save && L.save.retry) L.save.retry(); });
    U.buffs = $('sv-buffs', root);
    U.bubble = $('sv-bubble', root); U.bubble.setAttribute('role', 'status'); U.bubble.setAttribute('aria-live', 'polite');
    U.tip = $('sv-tip', root);
    // sleep cover
    const sl = U.sleep = $('sv-cover sv-sleep', root); sl.innerHTML = starsSVG();
    const orb = $('sv-orb', sl); U.sun = $('sv-sun', orb, 'div', svg('sol')); U.moon = $('sv-moon', orb, 'div', svg('lua'));
    U.sBig = $('sv-big', sl); U.sSmall = $('sv-small', sl); U.zz = $('sv-zz', sl); U.zz.textContent = 'z z z';
    U.sBtn = $('sv-btn', sl, 'button'); U.sBtn.type = 'button'; U.sBtn.textContent = 'Levantar';
    U.sBtn.addEventListener('click', e => { e.stopPropagation(); if (L.surv && L.surv.wake) L.surv.wake('user'); });
    // respawn cover
    const rs = U.resp = $('sv-cover sv-resp', root); rs.innerHTML = puffsSVG(); U.rBig = $('sv-big', rs);
    (opt.parent || document.body).appendChild(root);
    document.addEventListener('pointerdown', () => { if (U.tip.classList.contains('sv-on')) U.tip.classList.remove('sv-on'); }, { passive: true });
  }

  // ================================================================ gauges
  function setG(k, v, cap, cls) {
    const G = U.g[k]; if (!G) return; const key = v.toFixed(3) + '|' + (cap == null ? 1 : cap).toFixed(3) + '|' + cls;
    if (U.last[k] === key) return; U.last[k] = key;
    G.g.style.setProperty('--v', clamp(v, 0, 1).toFixed(4)); G.g.style.setProperty('--cap', clamp(cap == null ? 1 : cap, 0, 1).toFixed(4));
    G.g.className = 'sv-g sv-' + k + (cls ? ' ' + cls : '') + (G.g.classList.contains('sv-bump') ? ' sv-bump' : '');
  }
  function setIcon(k, ic, label) { const G = U.g[k]; if (!G || G.ic === ic) return; G.ic = ic; G.disc.innerHTML = svg(ic); G.lb.textContent = label || G.name; }
  function readSurv() {
    const S = L.surv;
    if (S && S.status) return S.status();
    const st = (L.save && L.save.player && L.save.player.st) || {};
    return { fome: st.fome != null ? st.fome : 80, en: st.en != null ? st.en : 100, enMax: 100, mana: st.mana != null ? st.mana : 100, manaMax: 100, frio: st.frio || 0, wet: st.wet || 0, buffs: [] };
  }
  function update() {
    if (!U.el || !U.shown) return;
    const v = readSurv();
    setG('fome', v.fome / 100, 1, v.fome <= 0 ? 'sv-low sv-zero' : v.fome < 25 ? 'sv-low' : '');
    setG('en', v.en / 100, (v.enMax || 100) / 100, v.exhausted ? 'sv-tired' : '');
    setG('mana', v.mana / (v.manaMax || 100), 1, '');
    const warmLeft = L.surv && L.surv.buff ? L.surv.buff('quente') : 0;
    if (warmLeft > 0) { U.warmMax = Math.max(U.warmMax, warmLeft); setIcon('frio', 'quente', 'Quente'); setG('frio', warmLeft / U.warmMax, 1, 'sv-warm' + (v.wet > .2 ? ' sv-iswet' : '')); }
    else { U.warmMax = 60; setIcon('frio', 'frio'); setG('frio', v.frio, 1, (v.frio >= .45 ? 'sv-cold' : '') + (v.wet > .2 ? ' sv-iswet' : '')); }
    const fr = warmLeft > 0 ? 0 : sst(.3, 1, v.frio); if (Math.abs((U.last.frost || 0) - fr) > .01) { U.last.frost = fr; U.frost.style.opacity = fr.toFixed(3); }
    // buffs
    const bs = (v.buffs || []).filter(b => b.left > 0); const key = bs.map(b => b.id + ':' + Math.ceil(b.left)).join(',');
    if (key !== U.buffsKey) {
      U.buffsKey = key; U.el.classList.toggle('sv-hasbuffs', bs.length > 0);
      const have = new Map([...U.buffs.children].map(c => [c.dataset.id, c]));
      for (const b of bs) {
        let c = have.get(b.id); if (!c) { c = $('sv-buff sv-b-' + b.id, U.buffs, 'div', svg(b.id === 'quente' ? 'quente' : b.id === 'resistente' ? 'frio' : 'en') + '<span></span>'); c.dataset.id = b.id; c.title = b.n || ''; }
        have.delete(b.id); const s = Math.ceil(b.left); c.lastChild.textContent = (b.chip || b.n || '') + ' ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      }
      for (const c of have.values()) c.remove();
    }
    // cloud
    cloudTick();
    if (U.labelsT && Date.now() > U.labelsT) { U.labelsT = 0; U.el.classList.add('sv-nolabels'); }
  }
  function cloudState() {
    const S = L.save; if (!S || !S.ready) return 'ok';
    const st = S.status; if (st === 'offline') return 'off'; if (st === 'refused') return 'err'; if (st === 'local') return 'local';
    return S.saving ? 'saving' : 'ok';
  }
  function cloudTick() {
    const s = cloudState(); const el = U.cloudEl;
    if (s !== U.cloud) {
      U.cloud = s; el.dataset.s = s; el.classList.remove('sv-quiet'); U.okSince = Date.now();
      el.innerHTML = s === 'local' ? svg('casa') : svg('nuvem') + '<span class="sv-k" style="position:absolute;inset:0">' + svg(s === 'off' ? 'off' : s === 'err' ? 'wait' : s === 'saving' ? 'up' : 'ok') + '</span>';
      el.setAttribute('aria-label', CLOUD_TXT[s][0]);
    } else if (s === 'ok' && !el.classList.contains('sv-quiet') && Date.now() - U.okSince > 2500) el.classList.add('sv-quiet');
  }

  // ================================================================ tips, hints, floaters
  function anchorX(k) { const G = k === 'cloud' ? U.cloudEl : U.g[k] && U.g[k].g; if (!G) return 24; const r = G.getBoundingClientRect(); return r.left + r.width / 2; }
  function tip(k) {
    let t; if (k === 'cloud') t = CLOUD_TXT[U.cloud]; else { const a = TIPS[k](readSurv()); t = [a[0] + ' · ' + a[1], a[2]]; }
    U.tip.innerHTML = ''; $('', U.tip, 'b').textContent = t[0]; $('', U.tip, 'em').textContent = t[1];
    U.tip.style.top = (belowHud() + 8) + 'px'; U.tip.style.left = Math.max(8, anchorX(k) - 30) + 'px';
    U.tip.classList.add('sv-on'); clearTimeout(U.tipT); U.tipT = setTimeout(() => U.tip.classList.remove('sv-on'), 3600);
  }
  function belowHud() {
    let y = U.hud.getBoundingClientRect().bottom;
    if (U.buffs.childElementCount) y = Math.max(y, U.buffs.getBoundingClientRect().bottom);
    if (U.bubble.classList.contains('sv-on')) y = Math.max(y, U.bubble.getBoundingClientRect().bottom);
    return y;
  }
  const HINT_AT = { fome: 'fome', fraco: 'fome', cansaco: 'en', frio: 'frio', calor: 'frio', soneca: 'en' };
  function hint(text, kind, ms) {
    if (!U.el || !text) return; const b = U.bubble; b.textContent = text;
    const k = HINT_AT[kind] || kind; const x = (U.g[k] || k === 'cloud') ? anchorX(k) - b.getBoundingClientRect().left : 24;
    b.style.setProperty('--tx', clamp(x, 16, Math.max(16, b.offsetWidth - 16)) + 'px'); b.classList.add('sv-on');
    clearTimeout(U.hintT); U.hintT = setTimeout(() => b.classList.remove('sv-on'), ms || 4200);
  }
  function floater(k, text) {
    const G = U.g[k]; if (!G || !U.shown) return; const r = G.g.getBoundingClientRect(); const f = $('sv-float', U.el); f.textContent = text;
    f.style.left = (r.left + r.width * .55) + 'px'; f.style.top = (r.bottom - 6) + 'px'; setTimeout(() => f.remove(), 1600);
    G.g.classList.remove('sv-bump'); void G.g.offsetWidth; G.g.classList.add('sv-bump'); setTimeout(() => G.g.classList.remove('sv-bump'), 600);
  }

  // ================================================================ sleep / respawn covers
  function sleepEv(e) {
    const p = e && e.phase; if (!p) return; U.sleepPhase = p;
    if (p === 'start') {
      U.sleep.classList.remove('sv-dawn'); U.sBig.textContent = 'Boa noite…'; U.sSmall.textContent = ''; U.sBtn.classList.remove('sv-on');
      U.sleep.classList.add('sv-on'); U.el.classList.add('sv-fade');
    } else if (p === 'wait') {
      const w = (e.waiting || []).filter(Boolean);
      U.sSmall.textContent = w.length ? 'Esperando ' + listNames(w) + ' dormir também…' : '';
      U.sBtn.classList.toggle('sv-on', w.length > 0);
    } else if (p === 'dawn') {
      U.sleep.classList.add('sv-dawn'); U.sBig.textContent = 'Bom dia!'; U.sSmall.textContent = 'Uma noite bem dormida.'; U.sBtn.classList.remove('sv-on');
    } else if (p === 'end') {
      U.sBtn.classList.remove('sv-on');
      setTimeout(() => { U.sleep.classList.remove('sv-on'); U.el.classList.remove('sv-fade'); }, e.skipped ? 600 : 0);
    }
  }
  const listNames = a => a.length === 1 ? a[0] : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1];
  function respEv(e) {
    const p = e && e.phase;
    if (p === 'start') { U.rBig.textContent = e.text || 'As nuvens te trouxeram de volta…'; U.resp.classList.add('sv-on'); U.el.classList.add('sv-fade'); }
    else if (p === 'end') { U.resp.classList.remove('sv-on'); U.el.classList.remove('sv-fade'); }
  }

  // ================================================================ wiring
  function wire() {
    const S = L.surv;
    if (S && S.on) {
      S.on('hint', h => hint(h.text, h.kind));
      S.on('sleep', sleepEv); S.on('respawn', respEv);
      S.on('ate', r => { if (r && r.gained > 0) floater('fome', '+' + Math.round(r.gained)); if (r && r.warm) floater('frio', '♨'); update(); });
      S.on('buff', () => { U.buffsKey = null; update(); });
    }
    if (L.save && L.save.on) {
      L.save.on('status', () => cloudTick());
      L.save.on('dup', () => hint('Você também está jogando em outro aparelho. Use um de cada vez para não se perder nada.', 'cloud', 6500));
    }
  }
  const survUI = {
    init(opt) {
      opt = opt || {}; if (U.ready) { if (opt.show) survUI.show(true); return survUI; }
      build(opt); wire(); U.ready = true; L.survUI.el = U.el;
      if (opt.show !== false) survUI.show(true);
      U.iv = setInterval(update, opt.every || 200);
      return survUI;
    },
    show(v) {
      if (!U.el) return; v = v !== false; U.el.hidden = !v; U.shown = v;
      if (v && !U.labelsT && !U.el.classList.contains('sv-nolabels')) U.labelsT = Date.now() + 60000;
      if (v) { U.last = {}; update(); }
    },
    hide() { survUI.show(false); },
    update, hint, tip,
    labels(v) { if (U.el) { U.el.classList.toggle('sv-nolabels', v === false); U.labelsT = 0; } },
    get shown() { return U.shown; },
    el: null,
    _U: U,
  };
  L.survUI = survUI;
})(typeof window !== 'undefined' ? (window.L = window.L || {}) : (globalThis.L = globalThis.L || {}));
