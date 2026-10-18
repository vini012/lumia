/* Lumiar: journal (Diário), letters, dreams, dialog bubbles, spell bar and full-screen moments for L.story.
   Builds its own DOM and CSS (prefix lu-), listens to L.story events and reads only its public API; every
   narrative line comes from L.story / L.T. Mobile first: big touch targets, safe areas, landscape. HUD bits are
   batched: at most one DOM job per frame (U.tick). Game integration: L.storyUI.init(opts) after L.story.init(). */
'use strict';
window.L = window.L || {};
(function (L) {
  const U = L.storyUI = L.storyUI || {};
  const SS = () => L.story || {};
  const T = (p, f) => (L.T ? L.T(p, f) : (f || ''));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const SCRIPT = document.currentScript;
  const BASE = (() => { try { const s = SCRIPT && SCRIPT.src; if (s && /js\/storyui\.js/.test(s)) return s.replace(/js\/storyui\.js(\?.*)?$/, ''); } catch (e) { } return ''; })();

  // ------------------------------------------------------------------ icons (hand-drawn style, 24x24, stroke = ink)
  const P = {
    book: '<path d="M3.5 5.5c3-1.2 6-1 8.5 1v13c-2.4-1.8-5.4-2-8.5-1z"/><path d="M20.5 5.5c-3-1.2-6-1-8.5 1v13c2.4-1.8 5.4-2 8.5-1z"/><path d="M6 9.2c1.6-.4 2.9-.2 4 .5M6 12.4c1.6-.4 2.9-.2 4 .5"/>',
    magic: '<path d="M4.5 19.5l10-10"/><path d="M13.2 8.2l2.6 2.6"/><path d="M17.5 2.8l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/><path d="M9 3.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5zM19.5 12.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>',
    close: '<path d="M6.5 6.2c3.6 3.9 7.4 7.6 11 11.4M17.6 6.4c-3.8 3.6-7.5 7.4-11.2 11"/>',
    next: '<path d="M9 5.5c2.6 2.2 4.8 4.4 6.6 6.6-1.8 2.2-4 4.3-6.6 6.4"/>',
    back: '<path d="M15 5.5c-2.6 2.2-4.8 4.4-6.6 6.6 1.8 2.2 4 4.3 6.6 6.4"/>',
    star: '<path d="M12 2.6l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.1l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.8z"/>',
    letter: '<path d="M3.3 6.8l17.4-.3.2 11.2-17.6.3z"/><path d="M3.6 7.2l8.5 6.6 8.5-6.9"/>',
    stone: '<path d="M4.8 15.6c-1.3-4.4 2.2-8.6 7.4-8.6 5.6 0 8.6 3.4 7.4 7.6-.9 3.2-4.6 4.6-8.6 4.5-3.2-.1-5.5-1.1-6.2-3.5z"/><path d="M9 12.2c1.4-.8 3.6-.9 5.6 0"/>',
    rune: '<path d="M5 17.5c-1-4.6 1.6-10 7-10.5 5.4.4 7.8 5.6 7 10.5z"/><path d="M12 9.5v6M9.6 11.2l2.4 1.6 2.4-1.6"/>',
    sign: '<path d="M4 5.2l16.2.4-.3 7.6-15.8-.3z"/><path d="M12 13v7.6M10 20.6h4"/><path d="M7 8.4h7M7 10.4h9"/>',
    bottle: '<path d="M10.2 3h3.6v3.6l2.4 3.4v10H7.8V10l2.4-3.4z"/><path d="M9.5 13.5h5v3h-5z"/>',
    diary: '<path d="M6 3.5h12.5v17H6a1.8 1.8 0 0 1-1.8-1.8V5.3A1.8 1.8 0 0 1 6 3.5z"/><path d="M8.5 3.7v16.6M11 8h5M11 11h4"/>',
    lectern: '<path d="M4 9.5c2.6-1.2 5.4-1 8 .6 2.6-1.6 5.4-1.8 8-.6"/><path d="M4 9.5l1.2 3.4h13.6L20 9.5"/><path d="M12 13v7M8.5 20.5h7"/>',
    drawing: '<path d="M4.5 19.5l1-4.2L15.8 5l3.2 3.2L8.7 18.5z"/><path d="M13.9 6.9l3.2 3.2"/>',
    totem: '<path d="M8 3.3h8.2l-.3 17.4H8.2z"/><path d="M10.1 8h1M13.1 8h1M10.4 11.6c1.1.8 2.4.8 3.4 0M8 15h8.2"/>',
    scroll: '<path d="M6.5 4.5h10a2 2 0 0 1 2 2v11.5a2 2 0 0 0 2 2H8.5a2 2 0 0 1-2-2z"/><path d="M6.5 4.5a2 2 0 0 0-2 2v1.5h2M9.5 9h6M9.5 12h6M9.5 15h4"/>',
    moon: '<path d="M15.5 3.6a8.4 8.4 0 1 0 5 13.6A7 7 0 0 1 15.5 3.6z"/>',
    cloud: '<path d="M6.5 18.2a3.8 3.8 0 0 1-.2-7.6 5.6 5.6 0 0 1 10.6-1.4 4.4 4.4 0 0 1 1 8.8z"/>',
    task: '<path d="M5 4.5h14v16H5z"/><path d="M8 9.2l1.4 1.4 2.6-2.8M8 14.6l1.4 1.4 2.6-2.8M14 9.6h3M14 15h3"/>',
    bird: '<path d="M2.8 11.6l18.4-6.2-6.6 14-3.2-5.6z"/><path d="M11.4 13.8l9.8-8.4"/>',
    drop: '<path d="M12 3.4c3 4 5.6 7.2 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-3.2 2.6-6.4 5.6-10.4z"/>',
  };
  const SPELL_ICON = {
    faisca: '<path d="M12 3.2c.9 3 4.6 5 4.6 9.6a4.6 4.6 0 0 1-9.2 0c0-2.4 1.2-3.6 2.4-4.6.1 2 .9 3.2 2 3.4-.9-3.2.2-6 .2-8.4z"/><path d="M18.6 4.4l-1.2 1.6M20.4 8.6l-1.8.4M5.4 4.4l1.2 1.6"/>',
    brotar: '<path d="M12 21v-8.6"/><path d="M12 13.2c-.3-4-3-6.2-7.4-6.2.2 4 3 6.2 7.4 6.2z"/><path d="M12 11c.3-4 3.2-6.4 7.6-6.4-.2 4.2-3.2 6.4-7.6 6.4z"/><path d="M8.6 21h6.8"/>',
    brisa: '<path d="M3 8.8h11.4a3 3 0 1 0-3-3"/><path d="M3 13.4h15.2a3 3 0 1 1-3 3"/><path d="M3 18h6.6"/>',
    luz: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7"/>',
    mare: '<path d="M2.6 13.4c2.2-2 4.2-2 6.4 0s4.2 2 6.4 0 4.2-2 6.2 0"/><path d="M2.6 18c2.2-2 4.2-2 6.4 0s4.2 2 6.4 0 4.2-2 6.2 0"/><path d="M12 3.2c1.6 2.2 3 3.8 3 5.4a3 3 0 0 1-6 0c0-1.6 1.4-3.2 3-5.4z"/>',
    ponte: '<path d="M2.8 17.4c3-6.4 15.4-6.4 18.4 0"/><path d="M4.6 17.8a2.2 2.2 0 0 1 .6-4.2M19.4 17.8a2.2 2.2 0 0 0-.6-4.2M9.2 12.2a2.6 2.6 0 0 1 5.6 0"/>',
    revelar: '<path d="M2.4 12s3.8-6.6 9.6-6.6 9.6 6.6 9.6 6.6-3.8 6.6-9.6 6.6S2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.8"/>',
    despertar: '<path d="M6.6 16.4a5.4 5.4 0 0 1 10.8 0"/><path d="M2.6 16.6h18.8M4.6 20h14.8M12 4.6v3M5.4 7.6l1.9 1.9M18.6 7.6l-1.9 1.9"/>',
  };
  const SPELL_COL = { faisca: '#f0995a', brotar: '#9cc35a', brisa: '#9fd0ec', luz: '#f5d36c', mare: '#5eb0d6', ponte: '#d6e4f4', revelar: '#b49be2', despertar: '#f0ad87' };
  const svg = (inner, cls) => '<svg class="' + (cls || 'lu-i') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  const KIND = { table: ['paper', 'scroll'], lectern: ['paper', 'lectern'], bird: ['letter', 'letter'], bottle: ['scroll', 'bottle'], diary: ['diary', 'diary'], drawing: ['drawing', 'drawing'], stone: ['stone', 'stone'], rune: ['rune', 'rune'], sign: ['wood', 'sign'], totem: ['totem', 'totem'] };

  // ------------------------------------------------------------------ CSS
  const NOISE = enc('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .42 0 0 0 0 .3 0 0 0 0 .18 0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#n)" opacity=".42"/></svg>');
  const FIBRE = enc('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="f"><feTurbulence type="fractalNoise" baseFrequency=".012 .09" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .36 0 0 0 0 .2 0 0 0 .35 -.05"/></filter><rect width="100%" height="100%" filter="url(#f)"/></svg>');
  const GRAIN = enc('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".004 .16" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 .3 0 0 0 0 .17 0 0 0 0 .08 0 0 0 .7 -.12"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>');
  function enc(s) { return 'url("data:image/svg+xml,' + encodeURIComponent(s) + '")'; }
  const TAPE = 'polygon(2% 6%,98% 0,100% 18%,97% 34%,100% 52%,97% 70%,100% 88%,97% 100%,3% 96%,0 80%,3% 62%,0 46%,3% 28%,0 12%)';
  const CSS = `
@font-face{font-family:'Caveat';src:url('${BASE}assets/fonts/caveat.woff2') format('woff2');font-weight:400 700;font-display:swap}
@font-face{font-family:'Grandstander';src:url('${BASE}assets/fonts/grandstander.woff2') format('woff2');font-weight:100 900;font-display:swap}
#lu{position:fixed;inset:0;z-index:60;pointer-events:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;
 --sat:env(safe-area-inset-top,0px);--sab:env(safe-area-inset-bottom,0px);--sal:env(safe-area-inset-left,0px);--sar:env(safe-area-inset-right,0px);
 --paper:#f6ead0;--paper2:#ecd8b0;--ink:#7a5b45;--ink2:#5a3f2c;--soft:#a3876b;--text:#4c3727;
 --hand:'Caveat','Kalam','Segoe Print','Bradley Hand','Comic Sans MS',cursive;--title:'Grandstander','Itim','Fredoka','Baloo 2',system-ui,sans-serif;
 --t1:#86bcae;--t2:#e9a88e;--t3:#ecca72;--t4:#a9bce3;--gold:#f2c14e;font-family:var(--title);color:var(--ink)}
#lu *{box-sizing:border-box}
#lu button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none}
#lu .lu-i{width:24px;height:24px;display:block;flex:none}
.lu-paper{position:relative;background-color:var(--paper);color:var(--text);
 background-image:radial-gradient(120% 90% at 30% 20%,rgba(255,251,238,.75),rgba(255,251,238,0) 55%),radial-gradient(150% 130% at 50% 50%,rgba(0,0,0,0) 58%,rgba(150,105,50,.22)),${FIBRE},${NOISE};
 border:2px solid rgba(122,91,69,.78);border-radius:22px 9px 26px 11px/11px 26px 9px 22px;box-shadow:0 2px 0 rgba(122,91,69,.22),0 16px 38px rgba(36,22,10,.38)}
.lu-paper::before{content:'';position:absolute;inset:6px;border:1.5px solid rgba(122,91,69,.32);border-radius:15px 24px 12px 28px/26px 12px 28px 14px;pointer-events:none}
.lu-tape{position:absolute;width:92px;height:25px;background:repeating-linear-gradient(-45deg,rgba(255,255,255,.22) 0 5px,rgba(255,255,255,0) 5px 11px),var(--c,var(--t1));clip-path:${TAPE};opacity:.88;pointer-events:none;z-index:2}
.lu-tape.a{top:-11px;left:-16px;transform:rotate(-12deg)}.lu-tape.b{top:-9px;right:-14px;transform:rotate(9deg);--c:var(--t2)}
.lu-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;
 padding:calc(10px + var(--sat)) calc(12px + var(--sar)) calc(10px + var(--sab)) calc(12px + var(--sal));background:radial-gradient(ellipse at center,rgba(38,24,12,.28),rgba(18,10,4,.6));animation:lu-fade .35s ease both}
.lu-modal.lu-bye{animation:lu-fadeout .28s ease both}
@keyframes lu-fade{from{opacity:0}to{opacity:1}}@keyframes lu-fadeout{from{opacity:1}to{opacity:0}}
@keyframes lu-cardin{0%{opacity:0;transform:translateY(54px) rotate(-6deg) scale(.88)}55%{opacity:1}100%{opacity:1;transform:translateY(0) rotate(-.7deg) scale(1)}}
@keyframes lu-word{from{opacity:0;filter:blur(2.5px)}to{opacity:1;filter:blur(0)}}
@keyframes lu-pop{from{opacity:0;transform:translateY(10px) scale(.92)}to{opacity:1;transform:none}}
@keyframes lu-drop{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:none}}
@keyframes lu-shake{0%,100%{transform:none}20%{transform:translateX(-5px) rotate(-3deg)}50%{transform:translateX(5px) rotate(3deg)}80%{transform:translateX(-3px)}}
@keyframes lu-spin{to{transform:rotate(360deg)}}
@keyframes lu-twinkle{0%,100%{opacity:.25;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}
@keyframes lu-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes lu-glow{0%,100%{box-shadow:0 0 0 2px rgba(255,214,120,.0),0 0 14px rgba(255,214,120,.55)}50%{box-shadow:0 0 0 2px rgba(255,214,120,.5),0 0 22px rgba(255,214,120,.9)}}
/* ---------- note card */
.lu-card{width:min(92vw,560px);max-height:calc(100vh - 28px - var(--sat) - var(--sab));overflow:auto;padding:clamp(20px,5vh,32px) clamp(22px,4vw,36px) clamp(14px,3vh,20px);transform:rotate(-.7deg);scrollbar-width:thin}
.lu-card.lu-anim{animation:lu-cardin .75s cubic-bezier(.2,.9,.25,1.12) both}
.lu-card h2{margin:0 0 .45em;font:700 clamp(18px,min(3vw,5.4vh),25px)/1.15 var(--title);color:var(--ink);letter-spacing:.01em;padding-right:8px}
.lu-txt{font:500 clamp(20px,min(3.6vw,6vh),28px)/1.26 var(--hand);white-space:pre-line;color:var(--text)}
.lu-w{display:inline-block;animation:lu-word .5s ease both}
.lu-sig{margin-top:.5em;text-align:right;font:700 clamp(20px,min(3.4vw,5.6vh),27px)/1 var(--hand);color:var(--ink)}
.lu-sig:empty{display:none}
.lu-gifts{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.lu-gift{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1.5px dashed rgba(122,91,69,.55);border-radius:12px 8px 13px 9px;font:600 13px/1.2 var(--title);color:var(--ink2);background:rgba(255,250,236,.55)}
.lu-row{display:flex;justify-content:flex-end;margin-top:12px}
.lu-btn{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:8px 18px 8px 16px;border:2px solid var(--ink);border-radius:16px 10px 18px 11px/11px 18px 10px 16px;background:#fbf2dd;color:var(--ink2);font:700 15px/1 var(--title);box-shadow:0 3px 0 rgba(122,91,69,.45)}
.lu-btn:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(122,91,69,.45)}
.lu-btn .lu-i{width:18px;height:18px}
.lu-k-diary .lu-txt{background-image:repeating-linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(1.26em - 1.5px),rgba(86,132,186,.30) calc(1.26em - 1.5px),rgba(86,132,186,.30) 1.26em);background-position:0 .05em;padding-left:14px}
.lu-k-diary::after{content:'';position:absolute;top:8px;bottom:8px;left:clamp(26px,4.4vw,38px);width:1.5px;background:rgba(210,104,96,.45)}
.lu-k-letter{background-image:linear-gradient(90deg,rgba(0,0,0,0) 49.7%,rgba(122,91,69,.10) 50%,rgba(255,255,255,.35) 50.3%,rgba(0,0,0,0) 50.6%),linear-gradient(180deg,rgba(0,0,0,0) 49.6%,rgba(122,91,69,.08) 50%,rgba(0,0,0,0) 50.4%),radial-gradient(120% 90% at 30% 20%,rgba(255,251,238,.75),rgba(255,251,238,0) 55%),radial-gradient(150% 130% at 50% 50%,rgba(0,0,0,0) 58%,rgba(150,105,50,.22)),${FIBRE},${NOISE}}
.lu-stamp{position:absolute;top:14px;right:16px;width:46px;height:46px;color:rgba(122,91,69,.55);transform:rotate(8deg);border:1.5px dashed rgba(122,91,69,.45);border-radius:6px;padding:7px}
.lu-stamp .lu-i{width:100%;height:100%}
.lu-k-letter h2{padding-right:56px}
.lu-k-scroll{border-radius:8px;box-shadow:0 2px 0 rgba(122,91,69,.22),0 16px 38px rgba(36,22,10,.38),inset 0 14px 10px -10px rgba(120,80,40,.35),inset 0 -14px 10px -10px rgba(120,80,40,.35)}
.lu-k-scroll::after{content:'';position:absolute;left:-8px;right:-8px;top:-7px;height:14px;border-radius:7px;background:linear-gradient(180deg,#f2e2bf,#d9c095);border:1.5px solid rgba(122,91,69,.6)}
.lu-k-drawing .lu-doodle{position:absolute;right:14px;top:12px;width:64px;height:48px;color:rgba(122,91,69,.6)}
.lu-k-drawing h2{padding-right:72px}
.lu-k-stone,.lu-k-rune{color:#463f38;border-color:#6c655b;border-radius:46px 34px 52px 30px/34px 50px 30px 44px;background-color:#c8c2b5;
 background-image:radial-gradient(120% 100% at 30% 20%,rgba(255,255,255,.35),rgba(255,255,255,0) 55%),radial-gradient(150% 130% at 50% 50%,rgba(0,0,0,0) 55%,rgba(40,35,30,.28)),${NOISE},${NOISE}}
.lu-k-stone::before,.lu-k-rune::before{border-color:rgba(70,62,54,.22);border-style:dashed}
.lu-k-stone h2,.lu-k-rune h2{color:#5a534b}
.lu-k-stone .lu-txt{color:#4a433c;text-shadow:0 1px 0 rgba(255,255,255,.5),0 -1px 0 rgba(0,0,0,.28);font-weight:700;letter-spacing:.01em}
.lu-k-rune{background-color:#8f8b88;color:#e7f7ff}
.lu-k-rune h2{color:#e2f4ff;text-shadow:0 0 8px rgba(120,200,255,.7)}
.lu-k-rune .lu-txt{color:#dff5ff;font-weight:700;text-shadow:0 0 6px rgba(110,196,255,.95),0 0 18px rgba(110,196,255,.6)}
.lu-k-rune .lu-sig{color:#dff5ff;text-shadow:0 0 6px rgba(110,196,255,.9)}
.lu-k-wood,.lu-k-totem{color:#3c2617;border-color:#5f3c25;border-radius:10px 7px 12px 6px;
 background-color:#c79f6f;background-image:linear-gradient(180deg,rgba(255,235,200,.28),rgba(80,45,15,.12)),${GRAIN},${GRAIN},${NOISE}}
.lu-k-wood::before,.lu-k-totem::before{inset:auto;left:9px;top:9px;width:9px;height:9px;border:0;border-radius:50%;background:radial-gradient(circle at 35% 35%,#d9d4cc,#6f6a62);box-shadow:calc(100% * 0) 0 0 0}
.lu-k-wood::after,.lu-k-totem::after{content:'';position:absolute;right:9px;top:9px;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#d9d4cc,#6f6a62)}
.lu-k-wood h2,.lu-k-totem h2{color:#4a2c18}
.lu-k-wood .lu-txt,.lu-k-totem .lu-txt{color:#3a2414;font-weight:700;text-shadow:0 1px 0 rgba(255,230,190,.45)}
.lu-k-totem{background-image:linear-gradient(90deg,rgba(74,163,200,.0) 0,rgba(74,163,200,.0) 14px,rgba(74,163,200,.55) 14px,rgba(74,163,200,.45) 26px,rgba(74,163,200,0) 26px),linear-gradient(180deg,rgba(255,235,200,.28),rgba(80,45,15,.12)),${GRAIN},${NOISE};padding-left:44px}
/* ---------- journal */
.lu-book{display:flex;flex-direction:column;width:min(96vw,940px);height:min(calc(100vh - 20px - var(--sat) - var(--sab)),640px);padding:10px clamp(10px,2vw,18px) 12px;animation:lu-pop .35s cubic-bezier(.2,.9,.3,1.1) both}
.lu-head{display:flex;align-items:flex-end;gap:10px;min-height:48px;position:relative;z-index:1}
.lu-head h1{margin:0 6px 4px 6px;font:800 clamp(20px,min(3.4vw,6vh),30px)/1 var(--title);color:var(--ink);white-space:nowrap}
.lu-tabs{display:flex;gap:4px;align-items:flex-end;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;padding:6px 2px 0}
.lu-tabs::-webkit-scrollbar{display:none}
.lu-tab{position:relative;flex:none;min-height:42px;padding:9px clamp(10px,1.8vw,18px) 7px;font:700 clamp(13px,min(1.9vw,3.8vh),17px)/1 var(--title)!important;color:var(--ink2)!important;
 background:repeating-linear-gradient(-45deg,rgba(255,255,255,.22) 0 5px,rgba(255,255,255,0) 5px 11px),var(--c)!important;clip-path:${TAPE};opacity:.62;transform:rotate(var(--r)) translateY(3px);transition:transform .18s,opacity .18s}
.lu-tab.lu-sel{opacity:1;transform:rotate(var(--r)) translateY(-1px) scale(1.06)}
.lu-tab .lu-dot{display:inline-block;width:8px;height:8px;margin-left:5px;border-radius:50%;background:#d0583f;vertical-align:2px}
.lu-x{flex:none;width:44px;height:44px;margin-left:auto;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid var(--ink)!important;background:#fbf2dd!important;box-shadow:0 2px 0 rgba(122,91,69,.45)}
.lu-jstars{display:flex;gap:3px;margin:0 4px 8px;flex:none}
.lu-jstars .lu-i{width:20px;height:20px}
.lu-pg{flex:1;min-height:0;margin-top:8px;position:relative;border-top:1.5px dashed rgba(122,91,69,.4);padding-top:10px}
.lu-scroll{height:100%;overflow:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:rgba(122,91,69,.45) transparent;padding:2px 6px 8px}
.lu-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--soft);font:500 clamp(20px,3vw,26px)/1.2 var(--hand);text-align:center}
.lu-empty .lu-i{width:42px;height:42px;opacity:.6}
.lu-split{display:grid;grid-template-columns:minmax(190px,34%) 1fr;gap:12px;height:100%}
.lu-list{overflow:auto;padding:2px 8px 6px 2px;border-right:1.5px dashed rgba(122,91,69,.35);scrollbar-width:thin}
.lu-li{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:6px 8px;text-align:left;border-radius:14px 8px 16px 9px/9px 16px 8px 14px;color:var(--ink2)!important}
.lu-li.lu-sel{background:rgba(122,91,69,.13)!important}
.lu-li .lu-i{width:28px;height:28px;color:var(--ink)}
.lu-li b{display:block;font:700 clamp(13px,1.7vw,15px)/1.15 var(--title)}
.lu-li small{display:block;margin-top:2px;font:500 clamp(15px,1.9vw,18px)/1 var(--hand);color:var(--soft)}
.lu-li.lu-new b::after{content:'';display:inline-block;width:7px;height:7px;margin-left:6px;border-radius:50%;background:#d0583f;vertical-align:2px}
.lu-read{overflow:auto;padding:4px 10px 10px 4px;scrollbar-width:thin}
.lu-read .lu-card{width:auto;max-height:none;overflow:visible;margin:10px 6px 12px;transform:rotate(.35deg)}
.lu-backb{display:none}
.lu-dreams{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:14px;padding:4px}
.lu-dr{position:relative;padding:18px 20px 16px;border-radius:20px 12px 24px 14px/14px 24px 12px 20px;color:#f3eeff;overflow:hidden;
 background:radial-gradient(90% 120% at 80% 0%,rgba(255,255,255,.18),rgba(255,255,255,0) 60%),linear-gradient(160deg,#3a4482,#5d4f8f 60%,#7e6aa3);box-shadow:0 8px 20px rgba(40,30,80,.35);border:2px solid rgba(255,255,255,.25)}
.lu-dr .lu-i{position:absolute;right:12px;top:10px;width:30px;height:30px;color:#ffe9a8;opacity:.9}
.lu-dr b{display:block;font:700 13px/1 var(--title);letter-spacing:.08em;text-transform:uppercase;color:#d9cff7;margin-bottom:8px}
.lu-dr p{margin:0;font:500 clamp(20px,2.6vw,24px)/1.25 var(--hand)}
.lu-dr i{position:absolute;width:3px;height:3px;border-radius:50%;background:#fff;opacity:.7}
.lu-ths{display:flex;flex-direction:column;gap:12px;padding:6px 10px 6px 30px}
.lu-tb{position:relative;align-self:flex-start;max-width:min(100%,560px);padding:12px 20px;background:rgba(255,253,247,.88);border:1.5px solid rgba(122,91,69,.45);border-radius:30px 34px 28px 36px/28px 26px 32px 30px;font:500 clamp(20px,2.6vw,25px)/1.22 var(--hand);color:var(--text);box-shadow:0 3px 0 rgba(122,91,69,.12)}
.lu-tb:nth-child(even){align-self:flex-end;transform:rotate(.6deg)}.lu-tb:nth-child(odd){transform:rotate(-.5deg)}
.lu-tb::before{content:'';position:absolute;left:-16px;bottom:4px;width:13px;height:13px;border-radius:50%;background:inherit;border:inherit}
.lu-tb::after{content:'';position:absolute;left:-26px;bottom:-6px;width:7px;height:7px;border-radius:50%;background:rgba(255,253,247,.88);border:1.5px solid rgba(122,91,69,.45)}
.lu-tasks{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:12px;padding:4px}
.lu-tk{position:relative;padding:14px 16px 12px;border:2px solid rgba(122,91,69,.6);border-radius:16px 10px 18px 11px/11px 18px 10px 16px;background:rgba(255,251,240,.6)}
.lu-tk h3{margin:0 0 4px;font:700 clamp(15px,1.9vw,17px)/1.2 var(--title);color:var(--ink2);padding-right:76px}
.lu-tk p{margin:0;font:500 clamp(19px,2.3vw,22px)/1.2 var(--hand);color:var(--text)}
.lu-tk .lu-st{position:absolute;right:10px;top:10px;padding:3px 9px;border-radius:10px;font:700 11px/1.3 var(--title);letter-spacing:.03em;text-transform:lowercase}
.lu-tk.lu-on .lu-st{background:#f3d98f;color:#6b4d10}
.lu-tk.lu-ready{border-color:#5d9c8c;box-shadow:0 0 0 3px rgba(93,156,140,.18)}
.lu-tk.lu-ready .lu-st{background:#bfe1d6;color:#24584b}
.lu-tk.lu-done{opacity:.66}
.lu-tk.lu-done .lu-st{background:#d8e6c4;color:#3f5a22}
.lu-tk.lu-done h3{text-decoration:line-through;text-decoration-color:rgba(122,91,69,.5);text-decoration-thickness:1.5px}
.lu-prog{display:flex;align-items:center;gap:5px;margin-top:8px;flex-wrap:wrap}
.lu-prog i{width:13px;height:13px;border-radius:50%;border:2px solid var(--ink);background:transparent}
.lu-prog i.lu-f{background:var(--ink)}
.lu-prog .lu-pbar{flex:1;max-width:180px;height:9px;border:2px solid var(--ink);border-radius:6px;overflow:hidden}
.lu-prog .lu-pbar b{display:block;height:100%;background:var(--ink)}
.lu-prog small{font:700 12px/1 var(--title);color:var(--soft);margin-left:4px}
.lu-chip{display:inline-flex;align-items:center;gap:4px;margin-top:8px;padding:3px 9px;border-radius:10px;background:rgba(122,91,69,.12);font:700 12px/1.3 var(--title);color:var(--ink2)}
.lu-chip .lu-i{width:15px;height:15px}
.lu-sect{margin:14px 4px 6px;font:800 12px/1 var(--title);letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
@media (max-width:640px){.lu-split{grid-template-columns:1fr}.lu-split.lu-reading .lu-list{display:none}.lu-split:not(.lu-reading) .lu-read{display:none}.lu-list{border-right:0}.lu-backb{display:inline-flex}.lu-head h1{display:none}}
@media (max-height:430px){.lu-head{min-height:44px}.lu-pg{margin-top:4px;padding-top:6px}}
/* ---------- HUD: star slots, round buttons, spell bar */
.lu-hstars{position:absolute;top:calc(8px + var(--sat));left:50%;transform:translateX(-50%);display:flex;gap:5px;padding:4px 9px;border-radius:14px;background:rgba(30,22,16,.22);opacity:0;transition:opacity 1.4s;pointer-events:none}
.lu-hstars.lu-show{opacity:.92}
.lu-hstars .lu-i,.lu-jstars .lu-i{width:17px;height:17px;color:rgba(255,247,230,.72);stroke-width:1.6}
.lu-jstars .lu-i{color:rgba(122,91,69,.55);width:20px;height:20px}
.lu-hstars .lu-full,.lu-jstars .lu-full{color:#c98a12;fill:#ffd35c;filter:drop-shadow(0 0 4px rgba(255,205,90,.95))}
.lu-hstars.lu-one{gap:0}.lu-hstars.lu-one .lu-i{width:22px;height:22px}
.lu-rb{position:absolute;width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;pointer-events:auto;color:var(--ink)!important;
 background:radial-gradient(circle at 38% 30%,#fffaf0,var(--paper) 60%,var(--paper2))!important;border:2px solid var(--ink)!important;box-shadow:0 3px 0 rgba(122,91,69,.5),0 8px 18px rgba(0,0,0,.28);transition:transform .12s,opacity .5s}
.lu-rb:active{transform:scale(.93)}
.lu-rb .lu-i{width:27px;height:27px}
.lu-rb.lu-hide{opacity:0;pointer-events:none}
.lu-rb .lu-badge{position:absolute;right:-3px;top:-3px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#d0583f;color:#fff;font:800 11px/18px var(--title);border:2px solid #fff;display:none}
.lu-rb.lu-has .lu-badge{display:block}
.lu-rb.lu-act{animation:lu-glow 1.6s ease-in-out infinite}
.lu-jb{right:calc(var(--sar) + 322px);bottom:calc(var(--sab) + 18px)}
.lu-mb{right:calc(var(--sar) + 260px);bottom:calc(var(--sab) + 18px)}
.lu-bar{position:absolute;right:calc(var(--sar) + 248px);bottom:calc(var(--sab) + 84px);display:flex;gap:clamp(6px,1vw,10px);padding:10px 12px 7px;pointer-events:auto;transform-origin:85% 100%;animation:lu-pop .25s cubic-bezier(.2,.9,.3,1.2) both;border-radius:24px 16px 26px 18px/18px 26px 16px 24px}
.lu-bar.lu-bye{animation:lu-fadeout .2s both}
.lu-sp{position:relative;width:60px;display:flex;flex-direction:column;align-items:center;gap:4px}
.lu-disc{position:relative;width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--ink2);
 background:radial-gradient(circle at 36% 28%,#fffaf0 0,var(--c) 62%,color-mix(in srgb,var(--c) 75%,#5a3f2c));border:2px solid var(--ink);box-shadow:0 3px 0 rgba(122,91,69,.45)}
.lu-disc .lu-i{width:30px;height:30px;stroke-width:2.1;position:relative;z-index:1}
.lu-cd{position:absolute;inset:0;border-radius:50%;background:conic-gradient(rgba(58,38,24,.58) calc(var(--p,0) * 1%),rgba(0,0,0,0) 0);pointer-events:none;z-index:2}
.lu-ring{position:absolute;inset:-7px;border-radius:50%;background:conic-gradient(#ffd35c calc(var(--a,0) * 1%),rgba(255,211,92,.15) 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3.5px));mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3.5px));opacity:0;transition:opacity .4s}
.lu-sp.lu-onfx .lu-ring{opacity:1}
.lu-mana{position:absolute;right:-6px;top:38px;min-width:24px;height:19px;padding:0 5px;border-radius:10px;background:#3f86bd;color:#fff;font:800 11px/16px var(--title);border:1.5px solid #fff;text-align:center;z-index:3}
.lu-sp>span{font:700 11px/1 var(--title);color:var(--ink2);white-space:nowrap}
.lu-sp.lu-pass .lu-disc{border-style:dashed;opacity:.85}
.lu-sp.lu-pass .lu-mana{display:none}
.lu-sp.lu-low .lu-disc{filter:saturate(.25) brightness(.92)}
.lu-sp.lu-low .lu-mana{background:#a35d4c}
.lu-sp.lu-shake .lu-disc{animation:lu-shake .42s}
.lu-sp.lu-fire .lu-disc{animation:lu-pop .4s}
@media (max-width:700px){.lu-jb{right:calc(var(--sar) + 16px);bottom:calc(var(--sab) + 300px)}.lu-mb{right:calc(var(--sar) + 16px);bottom:calc(var(--sab) + 240px)}.lu-bar{right:calc(var(--sar) + 80px);bottom:calc(var(--sab) + 232px);flex-wrap:wrap;max-width:calc(100vw - 100px);justify-content:flex-end}}
/* ---------- toasts, thought, dialog */
.lu-toasts{position:absolute;top:calc(var(--sat) + 40px);left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;width:min(84vw,520px);pointer-events:none}
.lu-toast{display:flex;align-items:center;gap:8px;max-width:100%;padding:7px 15px 7px 10px;font:700 14px/1.2 var(--title);color:var(--ink2);background:rgba(248,238,214,.97);border:1.5px solid rgba(122,91,69,.62);border-radius:16px 20px 14px 22px/18px 14px 20px 16px;box-shadow:0 5px 16px rgba(36,22,10,.28);animation:lu-drop .35s ease both}
.lu-toast .lu-ic{flex:none;font-size:18px;line-height:1;width:22px;text-align:center}
.lu-toast .lu-ic .lu-i{width:20px;height:20px;color:var(--ink)}
.lu-toast small{display:block;font:600 12px/1.2 var(--title);color:var(--soft);letter-spacing:.03em}
.lu-toast em{font:600 18px/1 var(--hand);font-style:normal;color:var(--text)}
.lu-toast.lu-bye{animation:lu-fadeout .45s ease both}
.lu-th{position:absolute;left:calc(var(--sal) + 18px);top:calc(var(--sat) + 74px);max-width:min(58vw,400px);padding:12px 20px 13px;pointer-events:auto;
 background:rgba(255,253,247,.95);border:1.5px solid rgba(122,91,69,.5);border-radius:30px 34px 28px 36px/28px 26px 32px 30px;font:500 clamp(19px,min(2.6vw,5vh),24px)/1.2 var(--hand);color:var(--text);box-shadow:0 6px 18px rgba(36,22,10,.22);animation:lu-pop .5s ease both}
.lu-th::before{content:'';position:absolute;left:22px;bottom:-15px;width:14px;height:14px;border-radius:50%;background:rgba(255,253,247,.95);border:1.5px solid rgba(122,91,69,.5)}
.lu-th::after{content:'';position:absolute;left:12px;bottom:-26px;width:8px;height:8px;border-radius:50%;background:rgba(255,253,247,.95);border:1.5px solid rgba(122,91,69,.5)}
.lu-th.lu-bye{animation:lu-fadeout .6s ease both}
.lu-say{position:absolute;left:50%;bottom:calc(var(--sab) + clamp(96px,24vh,140px));width:min(88vw,600px);min-height:94px;padding:24px 26px 16px;pointer-events:auto;transform:translateX(-50%);animation:lu-drop .3s ease both;border-radius:24px 14px 28px 16px/16px 28px 14px 24px}
.lu-say .lu-tail{position:absolute;left:46px;bottom:-14px;width:26px;height:26px;background:var(--paper);border-right:2px solid rgba(122,91,69,.78);border-bottom:2px solid rgba(122,91,69,.78);transform:rotate(40deg) skew(8deg,8deg);border-radius:0 0 6px 0}
.lu-say .lu-nm{position:absolute;top:-15px;left:20px;padding:6px 16px 5px;font:800 14px/1 var(--title);color:var(--ink2);background:repeating-linear-gradient(-45deg,rgba(255,255,255,.22) 0 5px,rgba(255,255,255,0) 5px 11px),var(--t1);clip-path:${TAPE};transform:rotate(-2deg);z-index:2}
.lu-say .lu-nm:empty{display:none}
.lu-say .lu-txt{min-height:1.3em;padding-right:34px;font-size:clamp(21px,min(3.2vw,5.8vh),27px)}
.lu-say .lu-nx{position:absolute;right:10px;bottom:8px;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--ink);animation:lu-float 1.4s ease-in-out infinite}
.lu-dots{position:absolute;left:24px;bottom:7px;display:flex;gap:4px}
.lu-dots i{width:6px;height:6px;border-radius:50%;background:rgba(122,91,69,.3)}.lu-dots i.lu-f{background:var(--ink)}
.lu-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
/* ---------- spell learnt, star moment */
.lu-learn{display:flex;flex-direction:column;align-items:center;text-align:center;width:min(86vw,440px);padding:26px 26px 18px;transform:rotate(-.5deg)}
.lu-learn.lu-anim{animation:lu-cardin .7s cubic-bezier(.2,.9,.25,1.12) both}
.lu-learn .lu-big{position:relative;width:96px;height:96px;margin:2px 0 10px}
.lu-learn .lu-big .lu-disc{width:96px;height:96px;border-width:2.5px}
.lu-learn .lu-big .lu-disc .lu-i{width:52px;height:52px}
.lu-learn .lu-rays{position:absolute;inset:-26px;border-radius:50%;background:repeating-conic-gradient(rgba(242,193,78,.55) 0 7deg,rgba(242,193,78,0) 7deg 22deg);-webkit-mask:radial-gradient(circle,transparent 46%,#000 50%,transparent 72%);mask:radial-gradient(circle,transparent 46%,#000 50%,transparent 72%);animation:lu-spin 14s linear infinite}
.lu-learn small{font:800 12px/1 var(--title);letter-spacing:.16em;text-transform:uppercase;color:var(--soft)}
.lu-learn h2{margin:4px 0 6px;font:800 clamp(26px,min(4.4vw,8vh),36px)/1.05 var(--title);color:var(--ink)}
.lu-learn p{margin:0 0 6px;font:500 clamp(20px,min(3vw,5.4vh),25px)/1.22 var(--hand);color:var(--text)}
.lu-starfx{position:absolute;left:50%;top:42%;width:150px;height:150px;margin:-75px 0 0 -75px;pointer-events:none;transition:transform 1.1s cubic-bezier(.65,0,.35,1),opacity 1.1s}
.lu-starfx .lu-sbig{position:absolute;inset:22px;color:#c98a12;fill:#ffd35c;stroke-width:1.3;filter:drop-shadow(0 0 10px rgba(255,214,110,1)) drop-shadow(0 0 26px rgba(255,190,80,.8));animation:lu-cardin .9s cubic-bezier(.2,1.3,.3,1) both}
.lu-starfx .lu-srays{position:absolute;inset:-30px;border-radius:50%;background:repeating-conic-gradient(rgba(255,226,140,.6) 0 5deg,rgba(255,226,140,0) 5deg 18deg);-webkit-mask:radial-gradient(circle,#000 18%,transparent 68%);mask:radial-gradient(circle,#000 18%,transparent 68%);animation:lu-spin 9s linear infinite,lu-fade 1s both}
.lu-starfx .lu-scap{position:absolute;left:50%;top:100%;width:min(80vw,520px);transform:translateX(-50%);margin-top:4px;text-align:center;font:600 clamp(22px,min(3.4vw,6vh),30px)/1.2 var(--hand);color:#fff8e6;text-shadow:0 2px 10px rgba(0,0,0,.6);animation:lu-fade 1.2s .4s both}
/* ---------- dream */
.lu-dream{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:auto;
 background:radial-gradient(ellipse 80% 60% at 50% 110%,rgba(255,206,236,.35),rgba(0,0,0,0) 60%),radial-gradient(ellipse at 50% 55%,#5e5a9c 0%,#3a417d 40%,#1d2552 76%,#10163a 100%);animation:lu-fade 1.8s ease both}
.lu-dream.lu-bye{animation:lu-fadeout 1.1s ease both}
.lu-dream .lu-ds{position:absolute;width:3px;height:3px;border-radius:50%;background:#fff;box-shadow:0 0 6px #fff;animation:lu-twinkle 3s ease-in-out infinite}
.lu-dream .lu-dm{position:absolute;right:12%;top:13%;width:64px;height:64px;border-radius:50%;box-shadow:-14px 8px 0 0 #fff4cf;transform:rotate(-20deg);filter:drop-shadow(0 0 16px rgba(255,240,190,.7));opacity:.92}
.lu-dream .lu-dcl{position:absolute;bottom:-60px;width:60vw;height:160px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(220,214,255,.32),rgba(220,214,255,0) 70%);filter:blur(6px);animation:lu-float 9s ease-in-out infinite}
.lu-dtxt{position:relative;max-width:min(82vw,660px);text-align:center;font:500 clamp(24px,min(4.2vw,7.4vh),38px)/1.3 var(--hand);color:#f5f0ff;text-shadow:0 0 18px rgba(190,170,255,.6),0 2px 4px rgba(10,10,40,.5)}
.lu-dtxt .lu-w{animation-duration:1.1s}
.lu-dhint{position:absolute;bottom:calc(18px + var(--sab));left:50%;transform:translateX(-50%);font:600 13px/1 var(--title);letter-spacing:.08em;color:rgba(235,228,255,.6);animation:lu-fade 1s 3s both}
.lu-dream.lu-soft{background:radial-gradient(ellipse at 50% 55%,#8b88b8 0%,#5e6699 45%,#3a4372 100%)}
.lu-dream.lu-soft .lu-dtxt{font-size:clamp(22px,min(3.6vw,6.4vh),32px);color:#f1eeff;opacity:.92}
/* ---------- white, caption, cinema */
.lu-white{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;background:radial-gradient(ellipse at center,#fff 0%,#f6f8fb 55%,#e6ecf4 100%)}
.lu-whisper{max-width:min(80vw,640px);text-align:center;font:500 clamp(24px,min(4vw,7vh),36px)/1.3 var(--hand);color:#6f819b;letter-spacing:.015em;opacity:0;transition:opacity 1.4s ease;text-shadow:0 0 14px rgba(255,255,255,.95)}
.lu-whisper.lu-show{opacity:1}
.lu-cine{position:absolute;inset:0;pointer-events:none}
.lu-lb{position:absolute;left:0;right:0;height:11vh;background:#120d09;transform:scaleY(0);transition:transform 1.3s cubic-bezier(.5,0,.2,1)}
.lu-lb.t{top:0;transform-origin:top}.lu-lb.b{bottom:0;transform-origin:bottom}
.lu-cine.lu-in .lu-lb{transform:scaleY(1)}
.lu-cine.lu-thin .lu-lb{height:7vh}
.lu-blink{position:absolute;inset:0;background:#0d0906;opacity:0;transition:opacity .45s}
.lu-blink.lu-on{opacity:1}
.lu-line{position:absolute;left:50%;bottom:calc(11vh + 16px);width:min(88vw,780px);transform:translateX(-50%);text-align:center;font:600 clamp(23px,min(3.4vw,6.4vh),34px)/1.28 var(--hand);color:#fff8ea;text-shadow:0 2px 14px rgba(0,0,0,.7),0 0 3px rgba(0,0,0,.6);opacity:0;transition:opacity 1.4s ease}
.lu-line.lu-show{opacity:1}
.lu-cap{position:absolute;left:50%;bottom:calc(var(--sab) + 13vh);width:min(86vw,720px);transform:translateX(-50%);text-align:center;font:600 clamp(23px,min(3.4vw,6.4vh),32px)/1.28 var(--hand);color:#fffaf0;text-shadow:0 2px 14px rgba(0,0,0,.65),0 0 3px rgba(0,0,0,.5);opacity:0;transition:opacity 1.2s}
.lu-cap.lu-show{opacity:1}
.lu-ttl{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:6px;opacity:0;transition:opacity 1.8s ease;text-align:center;width:92vw}
.lu-ttl.lu-show{opacity:1}
.lu-ttl .lu-i{width:46px;height:46px;color:#d9a21e;fill:#ffe08a;filter:drop-shadow(0 0 12px rgba(255,214,110,1));animation:lu-float 3s ease-in-out infinite}
.lu-ttl h1{margin:0;font:800 clamp(34px,min(7vw,13vh),74px)/1.02 var(--title);color:#ffe3a0;letter-spacing:.02em;text-shadow:0 0 22px rgba(255,200,90,.75),0 3px 0 #8a5a1a,0 8px 26px rgba(0,0,0,.55)}
.lu-ttl svg.lu-sw{width:min(70vw,460px);height:30px;overflow:visible}
.lu-ttl svg.lu-sw path{stroke:#ffe3a0;stroke-width:3;fill:none;stroke-linecap:round;stroke-dasharray:600;stroke-dashoffset:600;transition:stroke-dashoffset 2.4s .6s ease;filter:drop-shadow(0 0 6px rgba(255,210,110,.9))}
.lu-ttl.lu-show svg.lu-sw path{stroke-dashoffset:0}
.lu-per{position:absolute;left:50%;top:48%;width:min(86vw,520px);transform:translate(-50%,-50%) rotate(-.8deg);padding:26px 30px 20px;opacity:0;transition:opacity 1.4s}
.lu-per.lu-show{opacity:1}
.lu-skip{position:absolute;right:calc(var(--sar) + 16px);bottom:calc(var(--sab) + 2.2vh);display:none;align-items:center;gap:4px;min-height:40px;padding:6px 12px 6px 16px;border-radius:20px;pointer-events:auto;color:rgba(255,245,225,.85)!important;font:700 14px/1 var(--title)!important;border:1.5px solid rgba(255,245,225,.45)!important}
.lu-skip.lu-show{display:inline-flex}
.lu-skip .lu-i{width:18px;height:18px}
body.lu-cinema #hud{opacity:0;pointer-events:none;transition:opacity .8s}
#lu.lu-cinema .lu-rb,#lu.lu-cinema .lu-bar,#lu.lu-cinema .lu-hstars,#lu.lu-cinema .lu-th,#lu.lu-cinema .lu-toasts{opacity:0!important;pointer-events:none!important}
`;

  // ------------------------------------------------------------------ DOM helpers
  function el(tag, cls, html, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
  function txt(e, s) { e.textContent = s == null ? '' : String(s); return e; }
  function fadeRemove(e, ms) { if (!e) return; e.classList.add('lu-bye'); setTimeout(() => { if (e.parentNode) e.parentNode.removeChild(e); }, ms || 320); }
  // words appear one after the other, as if written (CSS only; one DOM build)
  function writeWords(box, s, step, delay0) {
    box.textContent = ''; const parts = String(s || '').split(/(\s+)/); let i = 0;
    for (const p of parts) {
      if (!p) continue;
      if (/^\s+$/.test(p)) { box.appendChild(document.createTextNode(p)); continue; }
      const w = el('span', 'lu-w', null, box); w.textContent = p; w.style.animationDelay = ((delay0 || 0) + i * (step || 40)) + 'ms'; i++;
    }
    return i * (step || 40) + (delay0 || 0);
  }
  function itemInfo(id) {
    const S = SS(); const si = S.itemInfo && S.itemInfo(id); if (si) return si;
    if (typeof L.itemInfo === 'function') { const r = L.itemInfo(id); if (r) return r; }
    const F = L.FOOD && L.FOOD[id]; if (F) return { n: F.n, ic: F.ic };
    const I = L.ITEMS && L.ITEMS[id]; if (I) return { n: I.n || I.name || id, ic: I.ic || '•' };
    let n = String(id), ic = '•';
    if (/^sem_/.test(n)) { n = 'Sementes de ' + n.slice(4).replace(/_/g, ' '); ic = '🌱'; }
    else if (/^receita_/.test(n)) { n = 'Receita: ' + n.slice(8).replace(/_/g, ' '); ic = '📜'; }
    else { n = n.replace(/_/g, ' '); n = n.charAt(0).toUpperCase() + n.slice(1); ic = GUESS[id] || '•'; }
    return { n, ic };
  }
  const GUESS = { madeira: '🪵', corda: '🧶', ouro: '🪙', cristal: '💎', pedra: '🪨', lotus: '🪷', sopa_quente: '🥣', pao: '🍞', trigo: '🌾', cenoura: '🥕' };

  // ------------------------------------------------------------------ sound (WebAudio, soft; routed to L.storySfx when the game provides it)
  let AC = null, OUT = null; const unlock = () => { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); OUT = AC.createGain(); OUT.gain.value = .55; OUT.connect(AC.destination); } catch (e) { AC = null; } } else if (AC.state === 'suspended') AC.resume(); };
  function muted() { if (U.opts.sound === false) return true; try { return JSON.parse(localStorage.getItem('lumiar:mute') || 'false') === true; } catch (e) { return false; } }
  function bell(f, t0, dur, vol) { const t = AC.currentTime + t0; [[1, 1], [2.76, .35], [5.4, .12]].forEach(([m, a]) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f * m; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + dur / m ** .4); o.connect(g); g.connect(OUT); o.start(t); o.stop(t + dur + .1); }); }
  function pad(fs, t0, dur, vol) { const t = AC.currentTime + t0; fs.forEach((f, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (i - 1) * 6; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * .35); g.gain.linearRampToValueAtTime(0, t + dur); o.connect(g); g.connect(OUT); o.start(t); o.stop(t + dur + .05); }); }
  function noise(t0, dur, f, q, vol, sweep) { const n = Math.floor(AC.sampleRate * dur), b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; const s = AC.createBufferSource(); s.buffer = b; const fl = AC.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = q; const t = AC.currentTime + t0; fl.frequency.setValueAtTime(f, t); if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur); const g = AC.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * .3); g.gain.linearRampToValueAtTime(0, t + dur); s.connect(fl); fl.connect(g); g.connect(OUT); s.start(t); s.stop(t + dur + .05); }
  const SFX = {
    chime() { bell(1046.5, 0, 1.8, .09); bell(1318.5, .13, 1.6, .07); bell(1568, .27, 2.2, .06); },
    star() { [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => bell(f, i * .085, 1.4, .06)); pad([523.25, 659.25, 784], .1, 2.6, .03); },
    learn() { pad([392, 493.9, 587.3], 0, 2.4, .035); [784, 987.8, 1174.7, 1568].forEach((f, i) => bell(f, .15 + i * .1, 1.5, .05)); },
    dream() { pad([220, 277.2, 329.6, 440], 0, 4.5, .03); bell(1760, .8, 2.5, .025); bell(2217.5, 1.6, 2.5, .02); },
    bird() { for (let i = 0; i < 7; i++) noise(i * .07, .06, 2600 + Math.random() * 1500, 2.5, .05); },
    pick() { bell(1568, 0, .5, .05); noise(0, .08, 3200, 3, .04); },
    whisper() { noise(0, 1.8, 900, .8, .05, 400); noise(.3, 1.6, 1400, 1.2, .03, 700); },
    gate() { noise(0, 2.2, 160, .7, .14, 80); bell(523.25, .9, 2.6, .05); bell(784, 1.1, 2.6, .04); },
    forge() { [1300, 2450, 3900].forEach((f, i) => bell(f / 2.76, 0, 1.6 - i * .3, .06)); noise(0, .12, 3000, 1.5, .1); },
    reveal() { pad([392, 523.25, 659.25, 880], 0, 3.4, .03); for (let i = 0; i < 8; i++) bell(1200 + i * 160, .2 + i * .12, 1, .02); },
    ending() { pad([261.6, 329.6, 392, 523.25], 0, 6, .035); },
    lamp() { noise(0, .6, 600, .8, .08, 1800); bell(880, .3, 1.6, .05); },
    cut() { noise(0, .12, 1800, 1.4, .07); },
    build() { noise(0, .1, 500, 1.2, .08); },
    spell(id) { const base = { faisca: 880, brotar: 523.25, luz: 1046.5, mare: 659.25, ponte: 784, revelar: 987.8, despertar: 587.3 }[id] || 880; [1, 1.25, 1.5].forEach((m, i) => bell(base * m, i * .06, 1, .045)); if (id === 'ponte' || id === 'mare') noise(0, .9, 900, .7, .05, 2400); if (id === 'faisca') noise(0, .3, 2400, 1, .05); },
  };
  function sfx(name) {
    if (typeof L.storySfx === 'function') { try { if (L.storySfx(name) !== false) return; } catch (e) { } }
    if (muted()) return; unlock(); if (!AC || AC.state !== 'running') return;
    try { if (/^spell_/.test(name)) SFX.spell(name.slice(6)); else if (SFX[name]) SFX[name](); } catch (e) { }
  }
  U.sfx = sfx;

  // ------------------------------------------------------------------ state
  U.opts = { buttons: true, sound: true };
  let root = null, hud = {}, cine = {}, white = {}, toastBox = null;
  let cur = null; const Q = [];            // open modal + waiting ones
  let say = null;                          // dialog typewriter state
  const jobs = new Set();                  // HUD DOM jobs (one per frame)
  let spellT = 0, lastBar = '', badge = 0, journalTab = 'cartas', journalNote = null, seenNotes = new Set();
  let whiteA = 0, whiteText = null, whiteShown = '';
  const PRIO = { cine: 0, dream: 1, learn: 2, note: 3, dialog: 4, journal: 5 };

  // ------------------------------------------------------------------ init
  U.init = function (opts) {
    Object.assign(U.opts, opts || {});
    if (root) return U;
    const st = el('style'); st.id = 'lu-css'; st.textContent = CSS; document.head.appendChild(st);
    root = el('div', null, null, document.body); root.id = 'lu';
    // HUD
    hud.stars = el('div', 'lu-hstars', null, root);
    toastBox = el('div', 'lu-toasts', null, root);
    if (U.opts.buttons) {
      hud.jb = el('button', 'lu-rb lu-jb lu-hide', svg(P.book) + '<span class="lu-badge"></span>', root); hud.jb.title = 'Diário'; hud.jb.setAttribute('aria-label', 'Diário');
      hud.mb = el('button', 'lu-rb lu-mb lu-hide', svg(P.magic), root); hud.mb.title = 'Magias'; hud.mb.setAttribute('aria-label', 'Magias');
      hud.jb.addEventListener('click', e => { e.stopPropagation(); U.openJournal(); });
      hud.mb.addEventListener('click', e => { e.stopPropagation(); U.toggleSpells(); });
    }
    // cinema layer, white layer
    white.box = el('div', 'lu-white', null, root); white.txt = el('div', 'lu-whisper', null, white.box);
    cine.box = el('div', 'lu-cine', null, root);
    cine.t = el('div', 'lu-lb t', null, cine.box); cine.b = el('div', 'lu-lb b', null, cine.box);
    cine.line = el('div', 'lu-line', null, cine.box); cine.cap = el('div', 'lu-cap', null, cine.box);
    cine.ttl = el('div', 'lu-ttl', svg(P.star) + '<h1></h1><svg class="lu-sw" viewBox="0 0 460 30"><path d="M8 18c60-14 120-16 180-6s130 10 200-4c20-4 38-6 64 2"/></svg>', cine.box);
    cine.per = el('div', 'lu-per lu-paper', null, cine.box); cine.per.style.display = 'none';
    cine.blink = el('div', 'lu-blink', null, cine.box);
    cine.skip = el('button', 'lu-skip', 'Pular' + svg(P.next), cine.box);
    cine.skip.addEventListener('click', e => { e.stopPropagation(); const S = SS(); if (S.skipEnding) S.skipEnding(); });
    // sound unlock + keys
    const un = () => { if (!muted()) unlock(); };
    window.addEventListener('pointerdown', un, { passive: true }); window.addEventListener('keydown', un);
    window.addEventListener('keydown', onKey, true);
    bind();
    refreshAll();
    return U;
  };
  function onKey(e) {
    if (!cur) return;
    if (e.key === 'Escape' || ((e.key === 'Enter' || e.key === ' ') && cur.kind !== 'journal')) { e.preventDefault(); e.stopPropagation(); if (cur.kind === 'dialog') advanceSay(); else closeCur(); }
  }

  // ------------------------------------------------------------------ modal queue
  function open(kind, data) {
    const S = SS(); const it = { kind, data };
    if (cur && kind !== 'journal') { if (cur.kind === 'journal') closeCur(true); else { Q.push(it); Q.sort((a, b) => PRIO[a.kind] - PRIO[b.kind]); return; } }
    if (cur && kind === 'journal') return;
    if (cineOn && kind !== 'dream') { Q.push(it); return; }
    show(it);
  }
  function show(it) {
    cur = it; setOpen(true); closeSpells();
    if (it.kind === 'note') showNote(it); else if (it.kind === 'dream') showDream(it); else if (it.kind === 'learn') showLearn(it);
    else if (it.kind === 'dialog') showSay(it); else if (it.kind === 'journal') showJournal(it);
  }
  function closeCur(silent) {
    if (!cur) return; const it = cur; cur = null;
    if (it.node) fadeRemove(it.node, it.kind === 'dream' ? 1100 : 300);
    if (it.kind === 'dialog') say = null;
    if (it.then) { try { it.then(); } catch (e) { console.warn(e); } }
    setOpen(false);
    if (!silent) setTimeout(next, it.kind === 'dream' ? 500 : 140);
  }
  function next() { if (cur || !Q.length || cineOn) return; show(Q.shift()); }
  function setOpen(v) { const S = SS(); S.uiOpen = !!v || !!cur; if (U.opts.onPause) try { U.opts.onPause(S.uiOpen); } catch (e) { } }
  U.closeAll = function () { Q.length = 0; while (cur) closeCur(true); [...root.querySelectorAll('.lu-modal,.lu-dream,.lu-th,.lu-toast')].forEach(n => n.remove()); closeSpells(); setOpen(false); };
  Object.defineProperty(U, 'open', { get: () => (cur ? cur.kind : null) });
  U.queue = () => Q.map(q => q.kind);

  // ------------------------------------------------------------------ note card
  function noteCard(v, anim) {
    const k = KIND[v.how] || KIND.table;
    const c = el('div', 'lu-card lu-paper lu-k-' + k[0] + (anim ? ' lu-anim' : ''));
    if (k[0] === 'paper' || k[0] === 'letter' || k[0] === 'drawing' || k[0] === 'diary' || k[0] === 'scroll') { el('i', 'lu-tape a', null, c); if (k[0] !== 'scroll') el('i', 'lu-tape b', null, c); }
    if (k[0] === 'letter') el('div', 'lu-stamp', svg(P.bird), c);
    if (k[0] === 'drawing') el('div', 'lu-doodle', '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lu-i" style="width:64px;height:48px"><circle cx="50" cy="12" r="6"/><path d="M50 2v2M60 12h-2M57 5l-1.5 1.5M43 5l1.5 1.5"/><path d="M4 40c6-8 14-12 22-8 6-6 16-6 22 2 4-2 9-1 12 4"/><path d="M14 40v-9l7-6 7 6v9z"/></svg>', c);
    const h = el('h2', null, null, c); txt(h, v.title);
    const t = el('div', 'lu-txt', null, c);
    let d = 0; if (anim) d = writeWords(t, v.text, 32, 380); else txt(t, v.text);
    const s = el('div', 'lu-sig', null, c); txt(s, v.sig ? '— ' + v.sig : '');
    if (anim && v.sig) { s.style.animation = 'lu-word .8s ease both'; s.style.animationDelay = (d + 250) + 'ms'; }
    return c;
  }
  function showNote(it) {
    const S = SS(); const d = it.data; const v = S.noteView ? S.noteView(d.id) : null; if (!v) { closeCur(); return; }
    const m = el('div', 'lu-modal', null, root); it.node = m; it.then = d.then || null;
    const c = noteCard(v, true); m.appendChild(c);
    const give = d.first && L.TL ? L.TL('notes.' + d.id + '.give') : null;
    if (give && typeof give === 'object') { const g = el('div', 'lu-gifts', null, c); for (const k in give) { const info = itemInfo(k); const ch = el('span', 'lu-gift', null, g); ch.textContent = (info.ic ? info.ic + ' ' : '') + (give[k] > 1 ? give[k] + ' × ' : '') + info.n; } }
    const row = el('div', 'lu-row', null, c); const b = el('button', 'lu-btn', null, row); b.innerHTML = svg(P.book) + '<span></span>'; txt(b.lastChild, d.first ? 'Guardar no diário' : 'Fechar');
    const t0 = performance.now();
    b.addEventListener('click', e => { e.stopPropagation(); closeCur(); });
    m.addEventListener('click', e => { if (e.target === m && performance.now() - t0 > 900) closeCur(); });
    seenNotes.add(d.id); if (d.first) bump(); sfx('chime');
  }

  // ------------------------------------------------------------------ dream
  function showDream(it) {
    const d = it.data; const m = el('div', 'lu-dream' + (d.soft ? ' lu-soft' : ''), null, root); it.node = m;
    for (let i = 0; i < 46; i++) { const s = el('i', 'lu-ds', null, m); s.style.left = (Math.random() * 100) + '%'; s.style.top = (Math.random() * 78) + '%'; s.style.animationDelay = (-Math.random() * 3) + 's'; const z = .5 + Math.random() * 1.6; s.style.width = s.style.height = z * 2 + 'px'; }
    if (!d.soft) el('div', 'lu-dm', null, m);
    for (let i = 0; i < 3; i++) { const c = el('div', 'lu-dcl', null, m); c.style.left = (i * 34 - 12) + '%'; c.style.animationDelay = (-i * 3) + 's'; }
    const t = el('div', 'lu-dtxt', null, m); writeWords(t, d.text, 110, 900);
    const h = el('div', 'lu-dhint', null, m); txt(h, 'toque para acordar');
    const t0 = performance.now();
    m.addEventListener('click', () => { if (performance.now() - t0 > 1800) closeCur(); });
    if (d.id !== 'hint') bump(); sfx('dream');
  }

  // ------------------------------------------------------------------ spell learnt
  function spellDisc(id) { return '<div class="lu-disc" style="--c:' + (SPELL_COL[id] || '#e8d7b0') + '">' + svg(SPELL_ICON[id] || P.magic) + '</div>'; }
  function showLearn(it) {
    const d = it.data; const m = el('div', 'lu-modal', null, root); it.node = m;
    const c = el('div', 'lu-learn lu-paper lu-anim', null, m); el('i', 'lu-tape a', null, c); el('i', 'lu-tape b', null, c);
    el('div', 'lu-big', '<div class="lu-rays"></div>' + spellDisc(d.id), c);
    txt(el('small', null, null, c), 'Nova magia'); txt(el('h2', null, null, c), d.name || T('spells.' + d.id + '.name'));
    const p = el('p', null, null, c); txt(p, T('spells.' + d.id + '.desc'));
    const row = el('div', 'lu-row', null, c); row.style.justifyContent = 'center'; const b = el('button', 'lu-btn', null, row); txt(b, 'Que bom');
    const t0 = performance.now();
    b.addEventListener('click', e => { e.stopPropagation(); closeCur(); });
    m.addEventListener('click', e => { if (e.target === m && performance.now() - t0 > 900) closeCur(); });
    bump(); sfx('learn'); jobs.add('bar'); jobs.add('buttons');
  }

  // ------------------------------------------------------------------ dialog bubble (typewriter: one text update per frame)
  function showSay(it) {
    const d = it.data; const b = el('div', 'lu-say lu-paper', null, root); it.node = b;
    el('i', 'lu-tail', null, b); const nm = el('div', 'lu-nm', null, b); txt(nm, d.name || '');
    const t = el('div', 'lu-txt', null, b); const dots = el('div', 'lu-dots', null, b);
    const nx = el('button', 'lu-nx', svg(P.next), b); nx.setAttribute('aria-label', 'continuar');
    say = { it, lines: (d.lines || []).filter(Boolean), i: 0, n: 0, t, dots, nx, b, done: false };
    if (d.lines && d.lines.length > 1) for (let i = 0; i < d.lines.length; i++) el('i', null, null, dots);
    b.addEventListener('click', e => { e.stopPropagation(); advanceSay(); });
    setSayLine(0); sfx('pick');
  }
  function setSayLine(i) { say.i = i; say.n = 0; say.done = false; say.t.textContent = ''; [...say.dots.children].forEach((d, k) => d.classList.toggle('lu-f', k <= i)); jobs.add('say'); }
  function advanceSay() {
    if (!say) return; const line = say.lines[say.i] || '';
    if (say.n < line.length) { say.n = line.length; say.t.textContent = line; return; }
    if (say.i + 1 < say.lines.length) { setSayLine(say.i + 1); return; }
    const acts = say.it.data.actions;
    if (acts && acts.length && !say.acted) {
      say.acted = true; say.nx.style.display = 'none'; const row = el('div', 'lu-acts', null, say.b);
      for (const a of acts) { const bt = el('button', 'lu-btn', null, row); txt(bt, a.label || a.l || '…'); bt.addEventListener('click', e => { e.stopPropagation(); const fn = a.fn || a.act; closeCur(); if (fn) try { fn(); } catch (er) { console.warn(er); } }); }
      return;
    }
    if (!acts || !acts.length) closeCur();
  }
  function sayJob(dt) {
    if (!say) return false; const line = say.lines[say.i] || ''; if (say.n >= line.length) return false;
    say.n = Math.min(line.length, say.n + Math.max(1, dt * 48)); say.t.textContent = line.slice(0, Math.floor(say.n)); return say.n < line.length;
  }

  // ------------------------------------------------------------------ thoughts and toasts
  let thNode = null, thTimer = 0;
  function showThought(d) {
    if (thNode) thNode.remove(); const n = el('div', 'lu-th', null, root); txt(n, d.text); thNode = n;
    thTimer = 4.2 + String(d.text || '').length * .05; n.addEventListener('click', () => { thTimer = 0; });
    bump();
  }
  const toastQ = []; let lastItem = null;
  function toast(html, small, ic, ms) {
    if (!toastBox) return null;
    const n = el('div', 'lu-toast', null, toastBox);
    const i = el('span', 'lu-ic', null, n); if (ic && ic.indexOf('<svg') === 0) i.innerHTML = ic; else txt(i, ic || '✦');
    const b = el('div', null, null, n); const m = el('div', null, null, b); txt(m, html); if (small) txt(el('small', null, null, b), small);
    while (toastBox.children.length > 3) toastBox.removeChild(toastBox.firstChild);
    setTimeout(() => fadeRemove(n, 450), ms || 3400); return n;
  }
  U.toast = (text, ic, small) => toast(text, small, ic);
  function itemToast(id, n) {
    const info = itemInfo(id); const now = performance.now();
    if (lastItem && lastItem.id === id && now - lastItem.t < 1500 && lastItem.node.parentNode) { lastItem.n += n; lastItem.t = now; lastItem.node.querySelector('div>div').textContent = '+' + lastItem.n + ' ' + info.n; return; }
    const node = toast('+' + n + ' ' + info.n, null, info.ic, 2800); lastItem = { id, n, t: now, node };
  }

  // ------------------------------------------------------------------ star slots and the star moment
  function starState() { const S = SS(); const n = S.fragCount ? S.fragCount() : 0; const joined = !!(S.has && S.has('has_key')); const world = S.flags || {}; return { n, joined, used: !!world['w:gate'] }; }
  function starsHTML(st, big) { if (st.joined) return svg(P.star, 'lu-i lu-full'); let h = ''; for (let i = 0; i < 5; i++) h += svg(P.star, 'lu-i' + (i < st.n ? ' lu-full' : '')); return h; }
  function starsJob() {
    const st = starState(); const show = st.n > 0 && !st.used && !cineOn;
    hud.stars.classList.toggle('lu-show', show); hud.stars.classList.toggle('lu-one', st.joined);
    const key = st.n + ':' + st.joined; if (hud.stars.dataset.k !== key) { hud.stars.innerHTML = starsHTML(st); hud.stars.dataset.k = key; }
  }
  function starMoment(d) {
    const fx = el('div', 'lu-starfx', '<div class="lu-srays"></div>' + svg(P.star, 'lu-i lu-sbig') + '<div class="lu-scap"></div>', root);
    txt(fx.querySelector('.lu-scap'), d.text || '');
    sfx('star');
    setTimeout(() => {
      const r = hud.stars.getBoundingClientRect(), f = fx.getBoundingClientRect(); const slot = hud.stars.children[Math.max(0, (d.n || 1) - 1)];
      const sr = slot ? slot.getBoundingClientRect() : r; const dx = (sr.left + sr.width / 2) - (f.left + f.width / 2), dy = (sr.top + sr.height / 2) - (f.top + f.height / 2);
      fx.querySelector('.lu-scap').style.opacity = '0'; fx.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.14)'; fx.style.opacity = '.2';
      setTimeout(() => { fx.remove(); jobs.add('stars'); }, 1150);
    }, 3200);
    hud.stars.classList.add('lu-show');
  }

  // ------------------------------------------------------------------ round buttons, spell bar
  let barNode = null;
  function buttonsJob() {
    const S = SS(); if (!hud.jb) return;
    const notes = S.notesRead ? S.notesRead().length : 0; hud.jb.classList.toggle('lu-hide', !notes);
    const sp = S.spellView ? S.spellView() : []; hud.mb.classList.toggle('lu-hide', !sp.some(s => !s.passive));
    hud.mb.classList.toggle('lu-act', sp.some(s => s.active > 0));
    const bd = hud.jb.querySelector('.lu-badge'); hud.jb.classList.toggle('lu-has', badge > 0); bd.textContent = badge > 9 ? '9+' : String(badge);
  }
  function bump() { badge++; jobs.add('buttons'); }
  U.toggleSpells = function () { if (barNode) closeSpells(); else openSpells(); };
  function openSpells() {
    const S = SS(); if (cur || cineOn || (S.busy)) return; const sp = S.spellView ? S.spellView() : []; if (!sp.length) return;
    barNode = el('div', 'lu-bar lu-paper', null, root); lastBar = '';
    for (const s of sp) {
      const b = el('button', 'lu-sp' + (s.passive ? ' lu-pass' : ''), spellDisc(s.id) + '<span></span>', barNode); b.dataset.id = s.id;
      b.querySelector('.lu-disc').insertAdjacentHTML('beforeend', '<i class="lu-cd"></i><i class="lu-ring"></i><b class="lu-mana"></b>');
      txt(b.querySelector('span'), s.name); b.querySelector('.lu-mana').textContent = s.mana; b.title = s.desc || s.name;
      b.addEventListener('click', e => { e.stopPropagation(); castFromBar(s.id, b); });
    }
    jobs.add('bar'); barJob();
  }
  function closeSpells() { if (!barNode) return; const n = barNode; barNode = null; fadeRemove(n, 220); }
  function castFromBar(id, b) {
    const S = SS(); if (!S.castSpell) return;
    const v = (S.spellView() || []).find(s => s.id === id); if (v && v.passive) { toast(v.name, v.desc, svg(SPELL_ICON[id] || P.magic), 3200); return; }
    const r = S.castSpell(id);
    if (r && r.ok) { b.classList.remove('lu-fire'); void b.offsetWidth; b.classList.add('lu-fire'); setTimeout(closeSpells, 380); }
    else { b.classList.remove('lu-shake'); void b.offsetWidth; b.classList.add('lu-shake'); if (r && r.why === 'place' && id === 'ponte') toast('Não há para onde estender a ponte', null, svg(SPELL_ICON.ponte), 2200); }
    jobs.add('bar');
  }
  U.cast = id => { const S = SS(); return S.castSpell ? S.castSpell(id) : { ok: false }; };
  function barJob() {
    if (!barNode) return; const S = SS(); const sp = S.spellView ? S.spellView() : [];
    let key = ''; for (const s of sp) key += s.id + (s.left > 0 ? Math.ceil(s.left * 10) : 0) + (s.active > 0 ? Math.ceil(s.active) : 0) + (s.ok ? 1 : 0) + '|';
    if (key === lastBar) return; lastBar = key;
    for (const s of sp) {
      const b = barNode.querySelector('[data-id="' + s.id + '"]'); if (!b) continue;
      const p = s.cd > 0 ? clamp(s.left / s.cd * 100, 0, 100) : 0; b.style.setProperty('--p', p.toFixed(1));
      const full = { luz: 90, mare: 20, revelar: 60, ponte: 25 }[s.id] || 1; b.style.setProperty('--a', clamp(s.active / full * 100, 0, 100).toFixed(1));
      b.classList.toggle('lu-onfx', s.active > 0); b.classList.toggle('lu-low', !s.passive && !s.ok);
    }
  }

  // ------------------------------------------------------------------ journal
  U.openJournal = function (tab) { if (tab) journalTab = tab; if (cur && cur.kind === 'journal') return; open('journal', {}); };
  U.closeJournal = () => { if (cur && cur.kind === 'journal') closeCur(); };
  const TABS = [['cartas', 'Cartas', '--t1', '-2deg'], ['sonhos', 'Sonhos', '--t4', '1.5deg'], ['pensamentos', 'Pensamentos', '--t3', '-1deg'], ['tarefas', 'Tarefas', '--t2', '2deg']];
  function showJournal(it) {
    const m = el('div', 'lu-modal', null, root); it.node = m;
    const bk = el('div', 'lu-book lu-paper', null, m); it.book = bk;
    const hd = el('div', 'lu-head', null, bk); txt(el('h1', null, null, hd), 'Diário');
    const tabs = el('div', 'lu-tabs', null, hd); it.tabs = tabs;
    for (const [id, name, c, r] of TABS) { const b = el('button', 'lu-tab', null, tabs); b.dataset.tab = id; b.style.setProperty('--c', 'var(' + c + ')'); b.style.setProperty('--r', r); txt(b, name); b.addEventListener('click', e => { e.stopPropagation(); journalTab = id; journalNote = null; renderJournal(); }); }
    it.stars = el('div', 'lu-jstars', null, hd);
    const x = el('button', 'lu-x', svg(P.close), hd); x.setAttribute('aria-label', 'Fechar'); x.addEventListener('click', e => { e.stopPropagation(); closeCur(); });
    it.pg = el('div', 'lu-pg', null, bk);
    m.addEventListener('click', e => { if (e.target === m) closeCur(); });
    badge = 0; jobs.add('buttons'); renderJournal(); sfx('pick');
  }
  function renderJournal() {
    if (!cur || cur.kind !== 'journal') return; const it = cur, S = SS();
    for (const b of it.tabs.children) b.classList.toggle('lu-sel', b.dataset.tab === journalTab);
    const st = starState(); it.stars.innerHTML = st.n > 0 ? starsHTML(st) : '';
    const pg = it.pg; const keep = pg.querySelector('.lu-list'); const scrollList = keep ? keep.scrollTop : 0; pg.innerHTML = '';
    if (journalTab === 'cartas') {
      const notes = (S.notesRead ? S.notesRead() : []).slice().reverse();
      if (!notes.length) return empty(pg, P.letter, 'Nenhuma carta ainda.');
      if (!journalNote || !notes.some(n => n.id === journalNote)) journalNote = innerWidth > 640 ? notes[0].id : null;
      const sp = el('div', 'lu-split' + (journalNote && innerWidth <= 640 ? ' lu-reading' : ''), null, pg);
      const list = el('div', 'lu-list', null, sp);
      for (const n of notes) {
        const k = KIND[n.how] || KIND.table; const b = el('button', 'lu-li' + (n.id === journalNote ? ' lu-sel' : ''), svg(P[k[1]] || P.scroll) + '<div><b></b><small></small></div>', list);
        txt(b.querySelector('b'), n.title); txt(b.querySelector('small'), dateLabel(n.t, n.sig));
        b.addEventListener('click', e => { e.stopPropagation(); journalNote = n.id; renderJournal(); });
      }
      list.scrollTop = scrollList;
      const rd = el('div', 'lu-read', null, sp);
      const v = journalNote && S.noteView(journalNote);
      if (v) { const bb = el('button', 'lu-btn lu-backb', svg(P.back) + '<span>Cartas</span>', rd); bb.addEventListener('click', e => { e.stopPropagation(); journalNote = null; renderJournal(); }); rd.appendChild(noteCard(v, false)); }
    } else if (journalTab === 'sonhos') {
      const ds = S.dreamsSeen ? S.dreamsSeen() : []; if (!ds.length) return empty(pg, P.moon, 'Nenhum sonho ainda.');
      const sc = el('div', 'lu-scroll', null, pg); const g = el('div', 'lu-dreams', null, sc);
      ds.forEach((d, i) => { const c = el('div', 'lu-dr', svg(P.moon) + '<b></b><p></p>', g); txt(c.querySelector('b'), 'Sonho ' + (i + 1)); txt(c.querySelector('p'), d.text); for (let k = 0; k < 9; k++) { const s = el('i', null, null, c); s.style.left = ((k * 37 + i * 13) % 96) + '%'; s.style.top = ((k * 23 + i * 7) % 90) + '%'; s.style.opacity = (.25 + (k % 3) * .2).toFixed(2); } });
    } else if (journalTab === 'pensamentos') {
      const th = S.thoughtsSeen ? S.thoughtsSeen() : []; if (!th.length) return empty(pg, P.cloud, 'Nenhum pensamento ainda.');
      const sc = el('div', 'lu-scroll', null, pg); const g = el('div', 'lu-ths', null, sc);
      for (const t of th) txt(el('div', 'lu-tb', null, g), t.text);
    } else {
      const tk = S.taskView ? S.taskView() : []; if (!tk.length) return empty(pg, P.task, 'Nenhuma tarefa ainda.');
      const order = { ready: 0, on: 1, done: 2 }; tk.sort((a, b) => (order[a.state] - order[b.state]) || (b.t - a.t));
      const sc = el('div', 'lu-scroll', null, pg); let last = null, g = null;
      for (const t of tk) {
        const grp = t.state === 'done' ? 'done' : 'open';
        if (grp !== last) { if (last) txt(el('div', 'lu-sect', null, sc), grp === 'done' ? 'Concluídas' : 'Em andamento'); g = el('div', 'lu-tasks', null, sc); last = grp; }
        const c = el('div', 'lu-tk lu-' + t.state, '<h3></h3><span class="lu-st"></span><p></p>', g);
        txt(c.querySelector('h3'), t.title); txt(c.querySelector('p'), t.text); txt(c.querySelector('.lu-st'), { on: 'em andamento', ready: 'pronta', done: 'concluída' }[t.state] || '');
        if (t.of > 1 && t.state !== 'done') { const pr = el('div', 'lu-prog', null, c); if (t.of <= 10) { for (let i = 0; i < t.of; i++) el('i', i < t.n ? 'lu-f' : null, null, pr); } else { el('div', 'lu-pbar', '<b style="width:' + Math.round(t.n / t.of * 100) + '%"></b>', pr); } txt(el('small', null, null, pr), t.n + '/' + t.of); }
        if (t.state === 'done' && t.spell) { const ch = el('span', 'lu-chip', svg(P.magic) + '<span></span>', c); txt(ch.lastChild, t.spell); }
        if (t.frag && t.state === 'done') el('span', 'lu-chip', svg(P.star, 'lu-i lu-full'), c).style.marginLeft = '6px';
      }
    }
  }
  function empty(pg, icon, s) { const e = el('div', 'lu-empty', svg(icon) + '<span></span>', pg); txt(e.lastChild, s); }
  function dateLabel(t, sig) { if (!t) return sig || ''; const d = new Date(t); const dd = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); return sig ? dd + '  ·  ' + sig : dd; }

  // ------------------------------------------------------------------ white veil of the cloud region
  function whiteJob() {
    const a = whiteA; white.box.style.opacity = a.toFixed(3);
    const want = whiteText && a > .25 ? whiteText : '';
    if (want !== whiteShown) { if (want) { txt(white.txt, want); white.txt.classList.add('lu-show'); } else white.txt.classList.remove('lu-show'); whiteShown = want; }
  }

  // ------------------------------------------------------------------ cinema (reveal shot and the long morning)
  let cineOn = false, lineTimer = null, capTimer = null;
  function cineStart(thin) { cineOn = true; cine.box.classList.add('lu-in'); cine.box.classList.toggle('lu-thin', !!thin); root.classList.add('lu-cinema'); document.body.classList.add('lu-cinema'); closeSpells(); if (thNode) { thNode.remove(); thNode = null; } }
  function cineEnd() {
    cineOn = false; cine.box.classList.remove('lu-in', 'lu-thin'); root.classList.remove('lu-cinema'); document.body.classList.remove('lu-cinema');
    cine.line.classList.remove('lu-show'); cine.ttl.classList.remove('lu-show'); cine.per.classList.remove('lu-show'); cine.skip.classList.remove('lu-show'); cine.blink.classList.remove('lu-on');
    setTimeout(() => { cine.per.style.display = 'none'; }, 1400); jobs.add('stars'); jobs.add('buttons'); setTimeout(next, 600);
  }
  function caption(text, ms) { if (!text) return; txt(cine.cap, text); cine.cap.classList.add('lu-show'); clearTimeout(capTimer); capTimer = setTimeout(() => cine.cap.classList.remove('lu-show'), ms || 5200); }
  function onEnding(d) {
    if (!d) return;
    if (d.phase === 'start') { U.closeAll(); cineStart(false); cine.skip.classList.toggle('lu-show', !!d.skippable); sfx('ending'); }
    else if (d.phase === 'blink') { cine.blink.classList.add('lu-on'); setTimeout(() => cine.blink.classList.remove('lu-on'), 700); }
    else if (d.phase === 'line') { cine.line.classList.remove('lu-show'); clearTimeout(lineTimer); lineTimer = setTimeout(() => { txt(cine.line, d.text); cine.line.classList.add('lu-show'); }, cine.line.textContent ? 900 : 0); }
    else if (d.phase === 'title') { cine.line.classList.remove('lu-show'); txt(cine.ttl.querySelector('h1'), d.text); cine.ttl.classList.add('lu-show'); sfx('star'); }
    else if (d.phase === 'personal') {
      cine.ttl.classList.remove('lu-show'); if (!d.text) return;
      cine.per.innerHTML = '<i class="lu-tape a"></i><i class="lu-tape b"></i><h2></h2><div class="lu-txt"></div>'; cine.per.style.display = 'block'; txt(cine.per.querySelector('h2'), d.title || ''); writeWords(cine.per.querySelector('.lu-txt'), d.text, 60, 300);
      requestAnimationFrame(() => cine.per.classList.add('lu-show'));
    }
    else if (d.phase === 'end') cineEnd();
  }

  // ------------------------------------------------------------------ events from L.story
  let bound = false;
  function bind() {
    const S = SS(); if (bound || !S.on) return; bound = true;
    S.on('note', d => open('note', d));
    S.on('dream', d => open('dream', d));
    S.on('learn', d => { if (d.quiet) { bump(); jobs.add('buttons'); return; } open('learn', d); });
    S.on('dialog', d => open('dialog', d));
    S.on('thought', d => showThought(d));
    S.on('toast', d => toast(d.text, null, d.ic));
    S.on('item', d => itemToast(d.id, d.n || 1));
    S.on('task', d => {
      if (d.state === 'on' && d.prev !== 'on') toast(d.title, 'nova tarefa', svg(P.task));
      else if (d.state === 'ready') toast(d.title, 'pronta', svg(P.task));
      else if (d.state === 'done') toast(d.title, 'concluída', '✔');
      bump();
    });
    S.on('need', d => { const parts = (d.items || []).map(([id, n]) => n + ' ' + itemInfo(id).n.toLowerCase()); toast(parts.join(', '), 'falta', '🎒', 2800); });
    S.on('nomana', id => { const b = barNode && barNode.querySelector('[data-id="' + id + '"]'); if (b) { b.classList.remove('lu-shake'); void b.offsetWidth; b.classList.add('lu-shake'); } toast('Mana insuficiente', null, svg(P.drop), 2200); });
    S.on('fragment', d => { starMoment(d); jobs.add('stars'); });
    S.on('forge', d => { const n = d.need || {}; toast('✦ ' + d.f + '/' + (n.fragmento || 5) + '   ' + itemInfo('ouro').n + ' ' + d.o + '/' + (n.ouro || 3) + '   ' + itemInfo('cristal').n + ' ' + d.c + '/' + (n.cristal || 2), null, '⚒', 4200); });
    S.on('mail', () => toast('Chegou uma carta', 'bem perto de você', svg(P.letter), 3000));
    S.on('hint', h => { if (h === 'night') toast('Melhor esperar a noite', null, svg(P.moon), 2600); });
    S.on('vigil', d => { if (d && d.done) toast('Amanheceu', 'você passou a noite inteira', svg(P.moon), 3600); else if (d && d.broken) toast('O fogo ficou longe', 'a noite recomeça na próxima', '🔥', 3200); });
    S.on('white', d => { whiteA = d ? clamp(d.a || 0, 0, 1) : 0; whiteText = d && d.text ? d.text : (whiteA < .2 ? null : whiteText); jobs.add('white'); });
    S.on('caption', d => caption(d && d.text));
    S.on('reveal', d => { if (d && d.on) cineStart(true); else if (cineOn && !SS().endingOn) cineEnd(); });
    S.on('ending', onEnding);
    S.on('cast', () => jobs.add('bar'));
    S.on('sfx', n => sfx(n));
    S.on('refresh', () => { jobs.add('buttons'); jobs.add('stars'); jobs.add('bar'); if (cur && cur.kind === 'journal') jobs.add('journal'); });
    S.on('init', () => refreshAll());
  }
  function refreshAll() { jobs.add('buttons'); jobs.add('stars'); jobs.add('bar'); }

  // ------------------------------------------------------------------ per-frame: at most one DOM job
  const ORDER = ['say', 'white', 'bar', 'stars', 'buttons', 'journal'];
  let rr = 0;
  U.tick = function (dt) {
    if (!root) return; dt = dt || 0;
    if (thNode) { thTimer -= dt; if (thTimer <= 0) { const n = thNode; thNode = null; fadeRemove(n, 600); } }
    spellT -= dt; if (spellT <= 0 && barNode) { spellT = .1; jobs.add('bar'); }
    if (!bound) bind();
    if (!jobs.size) return;
    for (let k = 0; k < ORDER.length; k++) {
      const j = ORDER[(rr + k) % ORDER.length]; if (!jobs.has(j)) continue;
      rr = (rr + k + 1) % ORDER.length; jobs.delete(j);
      if (j === 'say') { if (sayJob(dt)) jobs.add('say'); } else if (j === 'white') whiteJob(); else if (j === 'bar') barJob(); else if (j === 'stars') starsJob(); else if (j === 'buttons') buttonsJob(); else if (j === 'journal') renderJournal();
      break;
    }
  };
  U.flush = function () { let n = 0; while (jobs.size && n++ < 50) U.tick(0); };
})(window.L);
