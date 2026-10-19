/* Lumiar v5 items (B-game owns this file): item table, tools, recipes, inventory over the saved player record.
   Phase A: working inventory (L.inv) and display data (L.itemInfo) so story, survival and the HUD can run;
   B-game adds harvesting tables, stations, chests and the full recipe list here. Contract: v5docs/INTEG.md §5.1. */
'use strict';
(function (L) {
  // ------------------------------------------------------------------ item table (+ L.ITEMS5 from survival / farm)
  const BASE = {
    madeira: { n: 'Madeira', ic: '🪵' }, pedra: { n: 'Pedra', ic: '🪨' }, fibra: { n: 'Fibra', ic: '🌾' },
    sementes: { n: 'Sementes', ic: '🌱' }, minerio: { n: 'Minério', ic: '🟠' }, ferro: { n: 'Ferro', ic: '🔩' },
    cristal: { n: 'Cristal', ic: '💎' }, ouro: { n: 'Ouro', ic: '🪙' }, corda: { n: 'Corda', ic: '🪢' },
    la: { n: 'Lã', ic: '🧶' }, argila: { n: 'Argila', ic: '🟤' }, lenha: { n: 'Lenha', ic: '🔥' },
  };
  const ITEMS = L.ITEMS = Object.assign({}, BASE);
  // survival.js / farm.js run before this file: their foods, ingredients and seeds join the table
  Object.assign(ITEMS, L.ITEMS5 || {});
  // the order of the bag (B-ui may regroup): materials first, then food, then the rest
  L.ITEM_ORDER = Object.keys(BASE);
  const TOOLS = L.TOOLS = { axe: { n: 'Machado', ic: '🪓' }, pickaxe: { n: 'Picareta', ic: '⛏️' }, hoe: { n: 'Enxada', ic: '🌱' }, hammer: { n: 'Martelo', ic: '🔨' }, torch: { n: 'Tocha', ic: '🔥' } };
  // recipes: { id, w: station ('mao' | build item id), n, ic, cost, give | tool, lit, desc } (+ L.COOK from survival)
  L.RECIPES = [
    { id: 'axe1', w: 'mao', n: 'Machado de pedra', ic: '🪓', cost: { madeira: 3, pedra: 2 }, tool: ['axe', 1], desc: 'corta árvores mais rápido' },
    { id: 'pick1', w: 'mao', n: 'Picareta de pedra', ic: '⛏️', cost: { madeira: 3, pedra: 3 }, tool: ['pickaxe', 1], desc: 'quebra pedra, minério e cristal' },
    { id: 'torch', w: 'mao', n: 'Tocha', ic: '🔥', cost: { madeira: 1, fibra: 2 }, tool: ['torch', 1], desc: 'luz na mão à noite' },
    { id: 'corda', w: 'mao', n: 'Corda', ic: '🪢', cost: { fibra: 3 }, give: { corda: 1 }, desc: 'para pontes e construções' },
    { id: 'hoe1', w: 'bancada', n: 'Enxada', ic: '🌱', cost: { madeira: 2, pedra: 1 }, tool: ['hoe', 1], desc: 'prepara a terra para plantar' },
    { id: 'ham1', w: 'bancada', n: 'Martelo', ic: '🔨', cost: { madeira: 2, pedra: 2 }, tool: ['hammer', 1], desc: 'construções mais baratas' },
    { id: 'ferro', w: 'forja', n: 'Barra de ferro', ic: '🔩', cost: { minerio: 2, madeira: 1 }, give: { ferro: 1 }, lit: true, desc: 'derrete minério' },
  ];

  // ------------------------------------------------------------------ display data
  // story items come from L.story.itemInfo (their names live in the encoded text); everything else from ITEMS
  L.itemInfo = function (id) {
    const s = L.story && L.story.itemInfo && L.story.itemInfo(id); if (s) return s;
    const I = ITEMS[id] || (L.ITEMS5 && L.ITEMS5[id]); if (I) return { n: I.n, ic: I.ic };
    const T = TOOLS[id]; if (T) return { n: T.n, ic: T.ic };
    return { n: id, ic: '•' };
  };

  // ------------------------------------------------------------------ inventory (the saved player's inv map)
  const hs = [];
  const invObj = () => { const p = L.save && L.save.player; if (!p) return MEM; return p.inv || (p.inv = {}); };
  const MEM = {};   // before L.save.init (title screen, tests)
  function changed(id, n) { if (L.save && L.save.ready) L.save.dirty(); for (const h of hs) try { h(id, n); } catch (e) { console.warn('inv', e); } }
  L.inv = {
    count: id => invObj()[id] || 0,
    has: (id, n) => (invObj()[id] || 0) >= (n || 1),
    all: () => invObj(),
    // give/take fire L.inv.on handlers (HUD chips, story counters); quiet: no toast
    give(id, n, quiet) { n = n || 1; const o = invObj(); o[id] = (o[id] || 0) + n; changed(id, n); if (!quiet && L.ui && L.ui.gain) L.ui.gain(id, n); return o[id]; },
    take(id, n) { n = n || 1; const o = invObj(); if ((o[id] || 0) < n) return false; o[id] -= n; if (!o[id]) delete o[id]; changed(id, -n); return true; },
    canPay(cost) { const o = invObj(); for (const k in cost) if ((o[k] || 0) < cost[k]) return false; return true; },
    pay(cost) { if (!this.canPay(cost)) return false; const o = invObj(); for (const k in cost) { o[k] -= cost[k]; if (!o[k]) delete o[k]; } changed(null, 0); return true; },
    missing(cost) { const o = invObj(), out = {}; for (const k in cost) if ((o[k] || 0) < cost[k]) out[k] = cost[k] - (o[k] || 0); return out; },
    on(fn) { hs.push(fn); return () => { const i = hs.indexOf(fn); if (i >= 0) hs.splice(i, 1); }; },
    // tools: player.tools = { axe: level, ... }
    // a recipe item learnt from a note (story calls it; the known list lives in L.story.recipes())
    recipe(id) { changed('recipe:' + id, 1); },
    tool: k => ((L.save && L.save.player && L.save.player.tools) || {})[k] || 0,
    giveTool(k, lv) { const p = L.save && L.save.player; if (!p) return; p.tools = p.tools || {}; if ((p.tools[k] || 0) < lv) { p.tools[k] = lv; changed('tool:' + k, lv); } },
  };
  L.costText = cost => Object.keys(cost || {}).map(k => cost[k] + ' ' + L.itemInfo(k).ic).join(' ') || 'grátis';
})(window.L);
