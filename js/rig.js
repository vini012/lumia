/* Lumiar v4 procedural rigging: bones of the Blender models are rotated about MODEL axes (derived from the rest pose),
   so gaits work whatever the bone rolls are. Quadruped walk/trot/gallop/bound, birds & winged flight, humanoid locomotion,
   tool swings, secondary motion for tails, ears, capes, hats. */
'use strict';
(function (L) {
  const { clamp, lerp } = L;
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  const TAU = Math.PI * 2;
  const ss = t => t * t * (3 - 2 * t);

  class Rig {
    constructor(model) {
      this.model = model; this.b = {}; this.list = [];
      model.updateMatrixWorld(true);
      const rootInv = model.getWorldQuaternion(new THREE.Quaternion()).invert(); const rootPosInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
      model.traverse(o => {
        if (!o.isBone || this.b[o.name]) return;
        const qm = rootInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())); const inv = qm.clone().invert();
        const e = { o, q0: o.quaternion.clone(), p0: o.position.clone(), ax: X.clone().applyQuaternion(inv), ay: Y.clone().applyQuaternion(inv), az: Z.clone().applyQuaternion(inv), rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0,
          head: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(rootPosInv), len: 0,
          qpInv: o.parent ? rootInv.clone().multiply(o.parent.getWorldQuaternion(new THREE.Quaternion())).invert() : new THREE.Quaternion() };
        this.b[o.name] = e; this.list.push(e);
      });
      for (const e of this.list) { const c = e.o.children.find(ch => ch.isBone); e.len = c ? c.position.length() : (e.o.parent && e.o.parent.isBone ? .05 : 0); }
      this.cache = {}; const g = n => this.e(n);
      this.hipH = g('hips') ? g('hips').head.y : 1;
      const chain = (names) => names.reduce((s, n) => s + (g(n) ? g(n).len : 0), 0);
      this.hindLen = chain(['thigh.L', 'shin.L', 'foot.L']) || this.hipH;
      this.foreLen = chain(['upperarm.L', 'forearm.L', 'hand.L']) || this.hipH;
      this.legLen = chain(['thigh.L', 'shin.L']) || this.hipH; // humanoid leg (hip -> ankle)
      this.has = n => !!this.e(n);
      this.tail = []; for (let i = 1; i < 9; i++) if (g('tail.' + i)) this.tail.push('tail.' + i);
      this.neck = ['neck.1', 'neck.2', 'neck', 'neck.3'].filter(n => g(n));
      this.spring = {}; // secondary motion state
    }
    // three's GLTFLoader strips '.' from node names ('hand.L' -> 'handL'): accept both spellings
    e(n) { let e = this.cache[n]; if (e === undefined) { e = this.b[n] || this.b[n.replace(/[.\s]/g, '')] || null; this.cache[n] = e; } return e; }
    reset() { for (const e of this.list) { e.rx = e.ry = e.rz = 0; e.px = e.py = e.pz = 0; } }
    r(n, x, y, z) { const e = this.e(n); if (!e) return; e.rx += x || 0; e.ry += y || 0; e.rz += z || 0; }
    p(n, x, y, z) { const e = this.e(n); if (!e) return; e.px += x || 0; e.py += y || 0; e.pz += z || 0; }
    apply() {
      for (const e of this.list) {
        const o = e.o; o.quaternion.copy(e.q0);
        if (e.rx) { _q.setFromAxisAngle(e.ax, e.rx); o.quaternion.multiply(_q); }
        if (e.ry) { _q.setFromAxisAngle(e.ay, e.ry); o.quaternion.multiply(_q); }
        if (e.rz) { _q.setFromAxisAngle(e.az, e.rz); o.quaternion.multiply(_q); }
        if (e.px || e.py || e.pz) { _v.set(e.px, e.py, e.pz).applyQuaternion(e.qpInv); o.position.copy(e.p0).add(_v); } // model-space offset -> parent frame (rest)
        else o.position.copy(e.p0);
      }
    }
    // damped spring per key, returns smoothed value
    sp(key, target, k, dt) { const s = this.spring[key] || (this.spring[key] = { v: target, d: 0 }); const a = (target - s.v) * k * k - s.d * 2 * k; s.d += a * dt; s.v += s.d * dt; return s.v; }
  }
  L.Rig = Rig;

  // ------------------------------------------------------------------ quadrupeds
  // state: { speed (m/s), turn (rad/s), t, dt, gaitBias, look:[yaw,pitch], graze 0..1, sit 0..1, hop (bounding gait), fly 0..1, roar 0..1, alert 0..1 }
  const OFF = { walk: [0, .25, .5, .75], trot: [0, .5, .5, 1], gallop: [0, .57, .12, .45], bound: [0, .55, 0, .55] }; // LH LF RH RF
  L.quadAnim = function (rig, st) {
    const H = rig.hipH, dt = st.dt; rig.reset();
    const v = Math.max(0, st.speed); const fr = v / Math.sqrt(9.8 * H); // Froude-like number decides the gait
    const bound = !!st.hop;
    let g = bound ? 0 : clamp(fr < .55 ? 0 : fr < 1.6 ? (fr - .55) / .5 : 1 + clamp((fr - 1.6) / .5, 0, 1), 0, 2);
    g = rig.sp('gait', g, 6, dt);
    const stride = bound ? H * 3.0 : H * (g < 1 ? lerp(1.45, 2.3, g) : lerp(2.3, 3.6, g - 1));
    const duty = bound ? .38 : g < 1 ? lerp(.62, .46, g) : lerp(.46, .32, g - 1);
    st.ph = ((st.ph || 0) + v * dt / stride) % 1; const ph = st.ph;
    const moving = rig.sp('mov', v > .05 ? 1 : 0, 8, dt);
    const off = bound ? OFF.bound : g < 1 ? OFF.walk.map((o, i) => lerp(o, OFF.trot[i], g)) : OFF.trot.map((o, i) => lerp(o, OFF.gallop[i], g - 1));
    const amp = .5 * moving * (bound ? 1.25 : 1), lift = lerp(.55, 1.05, clamp(g / 2, 0, 1)) * moving;
    const legs = [['L', 0, 'hind'], ['L', 1, 'fore'], ['R', 2, 'hind'], ['R', 3, 'fore']];
    for (const [s, i, kind] of legs) {
      const p = (ph + off[i]) % 1; let th, flex;
      if (p < duty) { const u = p / duty; th = lerp(-amp, amp, u); flex = 0; }
      else { const u = (p - duty) / (1 - duty); th = lerp(amp, -amp, ss(u)); flex = Math.sin(u * Math.PI) * lift; }
      if (kind === 'hind') { rig.r('thigh.' + s, th - flex * .25); rig.r('shin.' + s, flex * .9); rig.r('foot.' + s, -flex * 1.0); rig.r('toe.' + s, flex * .4); }
      else { rig.r('upperarm.' + s, th * .85 - flex * .15); rig.r('forearm.' + s, flex * .55); rig.r('hand.' + s, flex * 1.35); rig.r('finger.' + s, flex * .3); }
    }
    // body: bob, pitch (gallop), lean into turns
    const bobF = bound ? 1 : g < 1 ? 2 : 2 - (g - 1); const bobA = H * (bound ? .09 : g < 1 ? lerp(.012, .035, g) : lerp(.035, .06, g - 1)) * moving;
    rig.p('hips', 0, -bobA * (.5 + .5 * Math.cos(ph * TAU * bobF)), 0);
    const flexS = (bound ? .22 : clamp(g - 1, 0, 1) * .16) * moving * Math.sin(ph * TAU);
    rig.r('spine', flexS * .6); rig.r('chest', flexS * .5); rig.r('hips', -flexS * .3);
    const lean = rig.sp('lean', clamp(-(st.turn || 0) * v * .02, -.25, .25), 5, dt); rig.r('hips', 0, 0, lean); rig.r('chest', 0, 0, -lean * .3);
    // breathing & idle sway
    const br = Math.sin(st.t * (1.6 + v)) * .02; rig.r('chest', br); rig.r('spine', -br * .5);
    // neck / head: counter-bob, look target, grazing, alert
    const graze = rig.sp('graze', st.graze || 0, 3, dt), alert = rig.sp('alert', st.alert || 0, 5, dt);
    const look = st.look || [0, 0]; const ly = rig.sp('ly', clamp(look[0], -1.1, 1.1) * (1 - graze), 4, dt), lp = rig.sp('lp', clamp(look[1], -.6, .6), 4, dt);
    const nk = rig.neck.length || 1; const headBob = Math.sin(ph * TAU * bobF) * .05 * moving;
    for (const n of rig.neck) rig.r(n, (graze * 1.05 - alert * .25 + lp * .5) / nk - headBob / nk, ly * .5 / nk);
    rig.r('head', graze * .35 - alert * .15 + lp * .5 + headBob, ly * .5);
    if (rig.has('jaw')) rig.r('jaw', (st.roar || 0) * .55 + graze * Math.max(0, Math.sin(st.t * 7)) * .12);
    // ears: perk when alert, flick sometimes, flop back when running fast
    const flick = (Math.sin(st.t * 1.3 + (st.seed || 0)) > .97 ? Math.sin(st.t * 40) * .3 : 0);
    rig.r('ear.L', -alert * .2 + clamp(g - 1, 0, 1) * .5 * moving + flick, 0, 0); rig.r('ear.R', -alert * .2 + clamp(g - 1, 0, 1) * .5 * moving - flick * .6, 0, 0);
    // tail: sway + lag behind body motion, lifts at speed
    const tn = rig.tail.length;
    if (tn) {
      const sway = Math.sin(st.t * (2 + v * .8) + (st.seed || 0)) * (.18 + (st.wag || 0) * .5) + rig.sp('tturn', -(st.turn || 0) * .25, 3, dt);
      const up = -.15 * moving * (1 + g * .3) + (st.tailUp || 0);
      rig.tail.forEach((n, i) => { const k = (i + 1) / tn; rig.r(n, (up + Math.sin(ph * TAU * bobF - i * .7) * .08 * moving) / tn * 1.6, sway * k * .9, 0); });
    }
    // sitting: fold hind legs, lower hips, front legs straight
    const sit = rig.sp('sit', st.sit || 0, 4, dt);
    if (sit > .01) {
      rig.p('hips', 0, -H * .38 * sit, -H * .05 * sit); rig.r('hips', -.62 * sit); rig.r('spine', .12 * sit); rig.r('chest', .18 * sit);
      for (const s of ['L', 'R']) { rig.r('thigh.' + s, -1.0 * sit); rig.r('shin.' + s, 1.6 * sit); rig.r('foot.' + s, -.9 * sit); rig.r('upperarm.' + s, .45 * sit); rig.r('forearm.' + s, -.1 * sit); }
      rig.tail.forEach((n, i) => rig.r(n, .25 * sit * (i === 0 ? 1 : .3)));
    }
    // flying (winged quadrupeds: dragon, griffin): legs tucked, wings flap
    const fly = rig.sp('fly', st.fly || 0, 3, dt);
    if (rig.has('wing.1.L')) {
      const fl = st.flap != null ? st.flap : 1; const wp = st.t * lerp(1.6, 2.4, fl) * TAU * .5;
      const flap = Math.sin(wp) * .75 * fly * fl, flap2 = Math.sin(wp - .9) * .5 * fly * fl; const glide = fly * (1 - fl) * .15;
      const fold = (1 - fly) * (st.wingsOpen ? 0 : .9);
      for (const [s, sg] of [['L', 1], ['R', -1]]) {
        rig.r('wing.1.' + s, 0, -sg * fold * .5, sg * (flap + glide - fold * .3)); rig.r('wing.2.' + s, 0, sg * fold * .9, sg * flap2 * .8); rig.r('wing.3.' + s, 0, sg * fold * .7, sg * flap2 * .6);
      }
      if (fly > .01) { for (const s of ['L', 'R']) { rig.r('thigh.' + s, -.9 * fly); rig.r('shin.' + s, 1.0 * fly); rig.r('upperarm.' + s, 1.0 * fly); rig.r('forearm.' + s, .6 * fly); rig.r('hand.' + s, 1.0 * fly); } rig.p('hips', 0, Math.sin(wp + 1.6) * H * .06 * fly * fl, 0); rig.tail.forEach((n, i) => rig.r(n, -.08 * fly, Math.sin(st.t * 1.4 - i * .6) * .12 * fly)); }
    }
    rig.apply();
  };

  // ------------------------------------------------------------------ birds (owl, small bird): perched hop/idle, flight flaps
  L.birdAnim = function (rig, st) {
    rig.reset(); const dt = st.dt; const fly = rig.sp('fly', st.fly || 0, 6, dt); const t = st.t;
    const wp = t * (st.flapHz || 7) * TAU; const fl = st.flap != null ? st.flap : 1;
    for (const [s, sg] of [['L', 1], ['R', -1]]) {
      const flap = Math.sin(wp) * .9 * fly * fl, fold = 1 - fly;
      rig.r('wing.1.' + s, 0, -sg * fold * .6, sg * (flap - fold * .4)); rig.r('wing.2.' + s, 0, sg * fold * 1.0, sg * Math.sin(wp - .8) * .5 * fly * fl); rig.r('wing.3.' + s, 0, sg * fold * .8, 0);
      rig.r('thigh.' + s, -.6 * fly); rig.r('shin.' + s, .8 * fly);
    }
    const look = st.look || [0, 0]; rig.r('head', rig.sp('lp', look[1], 6, dt), rig.sp('ly', look[0], 6, dt));
    rig.r('chest', (st.hopT || 0) * .2 - fly * .2); rig.tail.forEach(n => rig.r(n, Math.sin(t * 3) * .05 + fly * .1));
    rig.apply();
  };

  // ------------------------------------------------------------------ humanoid (hero): walk/run/sprint, jump, swim, ride, tool actions
  // st: { speed, t, dt, air 0..1, swim 0..1, ride 0..1, act:{kind, t0}, now, turn, wave }
  L.humanAnim = function (rig, st) {
    rig.reset(); const dt = st.dt, t = st.t, v = Math.max(0, st.speed), Lg = rig.legLen || .9;
    const run = clamp((v - 2.2) / 3.5, 0, 1), sprint = clamp((v - 7) / 3, 0, 1);
    const stride = Lg * lerp(1.55, 2.5, run) * (1 + sprint * .25);
    st.ph = ((st.ph || 0) + v * dt / stride) % 1; const ph = st.ph * TAU;
    const mv = rig.sp('mov', v > .1 ? 1 : 0, 9, dt); const air = rig.sp('air', st.air || 0, 10, dt), swim = rig.sp('swim', st.swim || 0, 4, dt), ride = rig.sp('ride', st.ride || 0, 6, dt);
    const ground = (1 - air) * (1 - swim) * (1 - ride);
    const A = lerp(.42, .72, run) * mv * ground;
    // legs
    for (const [s, sg] of [['L', 1], ['R', -1]]) {
      const c = Math.sin(ph + (sg > 0 ? 0 : Math.PI)); // +1 forward
      const sw = Math.max(0, Math.cos(ph + (sg > 0 ? 0 : Math.PI) + .3));
      rig.r('thigh.' + s, -c * A);
      rig.r('shin.' + s, (sw * lerp(.75, 1.5, run) + .08) * mv * ground);
      rig.r('foot.' + s, (-c * .2 - sw * .35) * mv * ground);
      // arms swing opposite to the leg on the same side; elbows bend more when running
      rig.r('upperarm.' + s, c * lerp(.45, .75, run) * mv * ground, 0, 0);
      rig.r('forearm.' + s, -(lerp(.18, 1.25, run) * mv + .12) * ground);
    }
    // bring A-pose arms down along the body (rest pose is ~40° below horizontal)
    const down = st.armDown != null ? st.armDown : .55; rig.r('upperarm.L', 0, 0, -down * (1 - swim)); rig.r('upperarm.R', 0, 0, down * (1 - swim));
    // torso
    const bob = Math.abs(Math.sin(ph)) * Lg * lerp(.03, .07, run) * mv * ground;
    rig.p('hips', 0, -bob - Lg * .02 * run * mv, 0);
    rig.r('spine', lerp(.04, .2, run) * mv * ground + sprint * .08, Math.sin(ph) * .12 * mv * ground);
    rig.r('chest', 0, -Math.sin(ph) * .18 * mv * ground); rig.r('hips', 0, Math.sin(ph) * .1 * mv * ground, 0);
    rig.r('head', -lerp(.04, .16, run) * mv * ground, -Math.sin(ph) * .05 * mv);
    const br = Math.sin(t * 1.7) * .025 * (1 - mv); rig.r('chest', br); rig.r('head', -br);
    // turn lean
    const lean = rig.sp('lean', clamp(-(st.turn || 0) * v * .025, -.3, .3), 6, dt); rig.r('hips', 0, 0, lean);
    // jump / fall: tuck legs, arms up
    if (air > .01) { for (const [s, sg] of [['L', 1], ['R', -1]]) { rig.r('thigh.' + s, -.7 * air * (sg > 0 ? 1 : .5)); rig.r('shin.' + s, 1.1 * air * (sg > 0 ? 1 : .6)); rig.r('upperarm.' + s, -.3 * air, 0, sg * .5 * air); rig.r('forearm.' + s, -.5 * air); } }
    // swimming: body horizontal, breaststroke
    if (swim > .01) {
      const sp = t * 3.2; rig.r('hips', 1.2 * swim); rig.r('head', -1.0 * swim);
      for (const [s, sg] of [['L', 1], ['R', -1]]) { const k = Math.sin(sp); rig.r('upperarm.' + s, (-1.6 - k * .7) * swim, 0, sg * (.9 + Math.cos(sp) * .5) * swim); rig.r('forearm.' + s, -.6 * swim); rig.r('thigh.' + s, (Math.sin(sp + (sg > 0 ? 0 : 1.5)) * .35) * swim); rig.r('shin.' + s, (.4 + Math.max(0, Math.sin(sp)) * .5) * swim); }
    }
    // riding: seated with knees bent, hands forward on the reins
    if (ride > .01) { for (const [s, sg] of [['L', 1], ['R', -1]]) { rig.r('thigh.' + s, -1.35 * ride, 0, sg * .35 * ride); rig.r('shin.' + s, 1.45 * ride); rig.r('foot.' + s, -.3 * ride); rig.r('upperarm.' + s, -.65 * ride, 0, -sg * .1 * ride); rig.r('forearm.' + s, -.9 * ride); } rig.r('spine', .1 * ride + Math.sin(t * (st.rideHz || 6)) * .05 * ride * clamp(v / 6, 0, 1)); }
    // tool / gesture actions (overrides the right arm)
    const a = st.act; if (a && st.now - a.t0 < a.dur) {
      const u = (st.now - a.t0) / a.dur; let raise = 0, strike = 0;
      if (u < .45) raise = ss(u / .45); else if (u < .62) { raise = 1 - ss((u - .45) / .17); strike = ss((u - .45) / .17); } else strike = 1 - ss((u - .62) / .38);
      const k = a.kind;
      if (k === 'chop' || k === 'mine' || k === 'build' || k === 'hoe') {
        const big = k === 'build' ? .6 : 1;
        rig.r('upperarm.R', (-2.5 * raise * big + .4 * strike) * (1 - swim), 0, -.35 * raise); rig.r('forearm.R', -.9 * raise + -.15 * strike); rig.r('hand.R', -.4 * raise + .5 * strike);
        rig.r('upperarm.L', (-1.6 * raise * big + .2 * strike) * .6, 0, .2 * raise); rig.r('forearm.L', -.7 * raise);
        rig.r('spine', .12 * strike - .12 * raise, (k === 'chop' ? -.35 : -.1) * raise + .25 * strike); rig.r('chest', .08 * strike); rig.r('head', -.1 * raise + .15 * strike);
        if (k !== 'build') for (const s of ['L', 'R']) { rig.r('thigh.' + s, -.12 * strike); rig.r('shin.' + s, .25 * strike); }
      } else if (k === 'cast') { rig.r('upperarm.R', -1.5 * Math.sin(u * Math.PI), 0, -.2); rig.r('forearm.R', -.4 * Math.sin(u * Math.PI)); rig.r('spine', -.05 * Math.sin(u * Math.PI)); }
      else if (k === 'pick') { const w = Math.sin(u * Math.PI); rig.r('spine', .55 * w); rig.r('chest', .25 * w); rig.r('upperarm.R', -.7 * w); rig.r('upperarm.L', -.5 * w); for (const s of ['L', 'R']) { rig.r('thigh.' + s, -.5 * w); rig.r('shin.' + s, .9 * w); rig.r('foot.' + s, -.4 * w); } rig.p('hips', 0, -Lg * .18 * w, 0); }
      else if (k === 'feed') { const w = Math.sin(u * Math.PI); rig.r('upperarm.R', -1.1 * w, 0, -.2 * w); rig.r('forearm.R', -.3 * w); rig.r('spine', .25 * w); }
      else if (k === 'drink') { const w = Math.sin(u * Math.PI); rig.r('upperarm.R', -1.6 * w, 0, .25 * w); rig.r('forearm.R', -1.7 * w); rig.r('head', -.4 * w); }
    }
    if (st.wave) { const w = st.wave; rig.r('upperarm.R', -.6 * w, 0, -2.3 * w); rig.r('forearm.R', -.6 * w + Math.sin(t * 12) * .35 * w); rig.r('head', 0, -.2 * w); }
    if (st.hold) { rig.r('forearm.R', -.35 * (1 - mv * .6)); rig.r('upperarm.R', 0, 0, -.1); } // staff / torch held a little forward
    // secondary motion: cape, coat, hat tip, hair
    const acc = rig.sp('vel', v, 4, dt);
    const flow = clamp(acc / 7, 0, 1.3) * (1 - swim);
    ['cape.1', 'cape.2', 'cape.3'].forEach((n, i) => rig.r(n, (flow * (i ? .25 : .45) + Math.sin(t * 7 - i * 1.1) * .05 * flow + air * .3), Math.sin(t * 2.3 - i) * .05));
    for (const n of ['coat.L', 'coat.R', 'coat.B']) rig.r(n, (n === 'coat.B' ? 1 : .6) * (flow * .35 + Math.sin(ph * 2) * .06 * mv));
    rig.r('hat.1', rig.sp('hat1', flow * .25 + air * .3, 5, dt) + Math.sin(t * 2) * .03); rig.r('hat.2', rig.sp('hat2', flow * .45 + Math.sin(ph * 2) * .1 * mv, 3.5, dt) + Math.sin(t * 2.6) * .05);
    rig.r('hair.1', flow * .3 + Math.sin(ph * 2) * .06 * mv); rig.r('hair.2', flow * .25 + Math.sin(ph * 2 - .6) * .1 * mv);
    // hands: relaxed curl, closed fist when holding a tool
    const fR = st.fistR != null ? st.fistR : .25, fL = st.fistL != null ? st.fistL : .25, FC = st.fistAxis || [0, 0, 1];
    rig.r('fingers.R', FC[0] * 1.5 * fR, FC[1] * 1.5 * fR, FC[2] * 1.5 * fR); rig.r('thumb.R', FC[0] * .6 * fR, FC[1] * .6 * fR, FC[2] * .6 * fR);
    rig.r('fingers.L', FC[0] * 1.5 * fL, -FC[1] * 1.5 * fL, -FC[2] * 1.5 * fL); rig.r('thumb.L', FC[0] * .6 * fL, -FC[1] * .6 * fL, -FC[2] * .6 * fL);
    rig.apply();
  };

  // clone a rigged model with shared materials; returns { root, rig, meshes, glows, grip }
  L.instRigged = function (src, opts) {
    opts = opts || {};
    const root = THREE.SkeletonUtils.clone(src); const meshes = [], glows = [];
    root.traverse(o => {
      if (!o.isMesh) return; const glow = /_glow/.test(o.name);
      o.material = glow ? (o.isSkinnedMesh ? L.MAT.glowSkin : L.MAT.glow) : (o.isSkinnedMesh ? (opts.mat || L.MAT.v4skin) : (opts.matStatic || L.MAT.v4));
      o.castShadow = !glow && opts.shadow !== false; o.receiveShadow = !glow; o.frustumCulled = false; (glow ? glows : meshes).push(o);
    });
    const rig = new Rig(root); let grip = null; root.traverse(o => { if (o.isBone && (o.name === 'grip.R' || o.name === 'gripR')) grip = o; });
    return { root, rig, meshes, glows, grip };
  };
})(window.L);
