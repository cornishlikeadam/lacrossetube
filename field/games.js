// One mobile-sized challenge per idea. Each game draws itself on the frame's canvas and ends
// with a grade: perfect (150 XP), good (80 XP) or miss (0 XP). Four kinds of play:
// SPOT (tap where to stand), PICK (tap the right player), TIME (react on the cue), CHOOSE (two buttons).
import { V, add, sub, mul, len, dist, norm, lerp, clamp, ease, deg, GOAL, closestOnSeg, mouthAngle, kf, C, FONT, circle, line, spray, arrowHead, txt, drawO, drawX, drawBall, wedge, wrapText } from './ink.js';
import { adapt } from './sports.js';
import { SCENES } from './scenes.js';
import { XP } from './progress.js';
export { XP };

const A = (sp, x, y) => adapt(sp, V(x, y));
const goalSide = (p, k = 1.6) => add(p, mul(norm(sub(V(0, .8), p)), k));
const SET = [[-7, 17], [7, 17], [-13, 6], [13, 6], [-6, -5], [6, -5]];

// Text that must fit a phone-width canvas: break it into at most `max` lines at this size.
function fit(ctx, s, maxW, size, font, max = 2) {
  ctx.save(); ctx.font = `${font === 'body' ? '700 ' : ''}${size}px ${FONT[font]}`; const lines = wrapText(ctx, s, maxW); ctx.restore();
  return lines.length > max ? [...lines.slice(0, max - 1), lines.slice(max - 1).join(' ')] : lines;
}
function banner(ctx, w, h, g, msg, xp) {
  const pass = g !== 'miss', size = Math.max(12, Math.min(20, w / 26)), lines = fit(ctx, msg, w - 28, size, 'body', 3);
  const bh = Math.min(h * .62, 64 + lines.length * size * 1.3 + (xp ? 34 : 10)), top = (h - bh) / 2;
  ctx.save(); ctx.globalAlpha = .9; ctx.fillStyle = '#05070f'; ctx.fillRect(0, top, w, bh); ctx.restore();
  txt(ctx, pass ? (g === 'perfect' ? 'MISSION PASSED' : 'PASSED') : 'BUSTED', w / 2, top + 34, { size: Math.min(56, w / 9), font: 'pop', col: pass ? C.green : C.stop, align: 'center', stroke: '#05070f' });
  lines.forEach((l, i) => txt(ctx, l, w / 2, top + 70 + i * size * 1.3, { size, font: 'body', col: '#fff', align: 'center' }));
  if (xp) txt(ctx, `+${xp} XP`, w / 2, top + bh - 18, { size: Math.min(24, w / 20), font: 'hand', col: C.gold, align: 'center' });
}
function prompt(ctx, w, s, col = C.gold) {
  const size = Math.max(12, Math.min(19, w / 27)), lines = fit(ctx, s, w - 20, size, 'hand', 2), bh = 14 + lines.length * size * 1.25;
  ctx.save(); ctx.fillStyle = '#05070f'; ctx.globalAlpha = .82; ctx.fillRect(0, 0, w, bh); ctx.restore();
  lines.forEach((l, i) => txt(ctx, l, w / 2, 8 + size * .6 + i * size * 1.25, { size, font: 'hand', col, align: 'center' }));
}
function buttons(ctx, w, h, labels) {
  const bw = Math.min(200, w * .4), bh = 54, gap = 16, x0 = w / 2 - bw - gap / 2, y = h - bh - 16;
  return labels.map((label, i) => {
    const x = x0 + i * (bw + gap);
    ctx.save(); ctx.fillStyle = i ? C.cont : C.start; ctx.strokeStyle = '#05070f'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw - 10, y + bh); ctx.lineTo(x, y + bh); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    txt(ctx, label, x + bw / 2, y + bh / 2 + 1, { size: 24, font: 'pop', col: '#05070f', align: 'center' });
    return { label, x, y, w: bw, h: bh };
  });
}
const hitBtn = (btns, sx, sy) => btns.find(b => sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h);

// Shared shape: a game is an object with draw(ctx, v, w, h, t), down(p, sx, sy, t), up(t), and result once finished.
function spotGame(sp, { ask, target, tol, scene, lesson }) {
  return {
    ask, tap: null, result: null,
    draw(ctx, v, w, h, t) {
      scene(v);
      if (this.tap) {
        circle(ctx, ...v.P(target), tol * v.s, { col: C.green, w: 3, passes: 2, j: 1.2, fill: C.green, fillAlpha: .12 });
        line(ctx, ...v.P(this.tap), ...v.P(target), { col: C.gold, w: 2, dash: [4, 6], passes: 1, j: 0 });
        drawX(v, this.tap, C.start, { label: 'YOU' });
        txt(ctx, `${dist(this.tap, target).toFixed(1)} yd off`, ...v.P(add(target, V(0, tol + 1.6))), { size: v.fs, col: C.gold, align: 'center', font: 'hand', stroke: '#05070f' });
      } else prompt(ctx, w, this.ask);
    },
    down(p) { if (this.tap) return; this.tap = p; const d = dist(p, target); const g = d <= tol ? 'perfect' : d <= tol * 2 ? 'good' : 'miss'; this.result = { g, msg: g === 'miss' ? lesson : g === 'perfect' ? 'Right on the spot.' : 'Close. The green ring is the spot.' }; },
  };
}
function chooseGame({ ask, labels, correct, scene, right, wrong }) {
  return {
    ask, btns: [], result: null, picked: null,
    draw(ctx, v, w, h, t) { scene(v, t, this.picked); if (!this.picked) { prompt(ctx, w, this.ask); this.btns = buttons(ctx, w, h, labels); } },
    down(p, sx, sy) { if (this.picked) return; const b = hitBtn(this.btns, sx, sy); if (!b) return; this.picked = b.label; const ok = b.label === correct; this.result = { g: ok ? 'perfect' : 'miss', msg: ok ? right : wrong }; },
  };
}

export const GAMES = {
  help: sp => {
    const B = A(sp, -8, 11), M = A(sp, 10, 7), E = mul(norm(B), 3.2), H = lerp(M, closestOnSeg(M, B, E), .6);
    return spotGame(sp, { ask: 'The ball is far away. Tap where YOU stand.', target: H, tol: 2.6, lesson: 'Step in from your player toward the goal.',
      scene: v => { drawO(v, B, { label: 'ball' }); drawBall(v, B); drawO(v, M, { col: C.cont, label: 'your player', lcol: C.cont }); } });
  },
  angle: sp => {
    const A0 = A(sp, -10, 12), O2 = A(sp, 3.5, 19), T = add(A0, mul(norm(sub(GOAL, A0)), 2.4));
    return spotGame(sp, { ask: 'Tap where you stop his road to the goal.', target: T, tol: 2, lesson: 'Stand on the line from him to the goal.',
      scene: v => { line(v.ctx, ...v.P(A0), ...v.P(O2), { col: C.gold, w: 2, dash: [3, 7], passes: 1, j: 0 }); drawO(v, A0); drawBall(v, A0); drawO(v, O2, { label: 'pass', seed: 12 }); } });
  },
  double: sp => {
    const Ab = adapt(sp, V(sp.side + 2, 6)), D1 = add(Ab, V(1.8, -1.4)), T = add(Ab, V(1.9, 2.6));
    return spotGame(sp, { ask: 'Trap him on the line. Tap where the double goes.', target: T, tol: 2.2, lesson: 'Close the side the on-ball defender leaves open.',
      scene: v => { line(v.ctx, v.X(sp.side), v.Y(-6), v.X(sp.side), v.Y(24), { col: C.ink, w: 5, passes: 1, j: .4 }); drawO(v, Ab); drawBall(v, Ab); drawX(v, D1, C.ink, { label: 'on ball' }); } });
  },
  danger: sp => {
    const opts = [A(sp, 14, 21), A(sp, -9, 13), A(sp, 2.5, 5.5)]; if (sp.behind) opts.push(A(sp, 6, -4));
    const best = opts.reduce((b, p, i) => mouthAngle(p, sp.mouth) > mouthAngle(opts[b], sp.mouth) ? i : b, 0);
    return {
      ask: 'Tap the most dangerous player.', result: null, pick: null,
      draw(ctx, v, w) {
        opts.forEach((p, i) => { if (this.pick != null) { wedge(v, p, sp.mouth, i === best ? C.stop : C.cont, .2); txt(ctx, `${deg(mouthAngle(p, sp.mouth)).toFixed(0)}°`, ...v.P(add(p, V(2.6, 1.6))), { size: v.fs + 4, font: 'pop', col: i === best ? C.stop : C.ink, stroke: '#05070f' }); } drawO(v, p, { seed: 20 + i, col: this.pick === i ? C.start : C.ink }); });
        drawBall(v, A(sp, -9, 13));
        if (this.pick == null) prompt(ctx, w, this.ask);
      },
      down(p) { if (this.pick != null) return; let k = 0; opts.forEach((o, i) => { if (dist(o, p) < dist(opts[k], p)) k = i; }); if (dist(opts[k], p) > 4) return; this.pick = k; this.result = k === best ? { g: 'perfect', msg: 'Closest to the goal means the biggest window.' } : { g: 'miss', msg: 'Pick the player who sees the most goal.' }; },
    };
  },
  talk: sp => {
    const S = SCENES.talk, L = S.layout(sp), open = L.Aa.findIndex((a, i) => !L.silent.includes(i));
    return {
      ask: 'Nobody talked. Two chase one. Tap the OPEN player.', result: null, pick: null,
      draw(ctx, v, w, h, t) {
        S.draw(v, Math.min(t, 2.35), sp);
        if (this.pick != null) { const o = L.Aa[open]; circle(ctx, ...v.P(o), 1.9 * v.s, { col: C.green, w: 4, passes: 2, j: 1.3 }); }
        else if (t > 2.35) prompt(ctx, w, this.ask); else prompt(ctx, w, 'Watch. No one is talking...', C.ink);
      },
      down(p, sx, sy, t) { if (this.pick != null || t < 2.35) return; let k = 0; L.Aa.forEach((a, i) => { if (dist(a, p) < dist(L.Aa[k], p)) k = i; }); if (dist(L.Aa[k], p) > 4) return; this.pick = k; this.result = k === open ? { g: 'perfect', msg: 'Found him. A call would have covered him.' } : { g: 'miss', msg: 'The open player is the one nobody picked.' }; },
    };
  },
  loose: sp => {
    const pop = 1 + Math.random() * 1.4, B = A(sp, 1, 11);
    return {
      ask: 'Wait for LOOSE. Then tap fast.', result: null, at: null,
      draw(ctx, v, w, h, t) {
        const live = t >= pop && this.at == null;
        drawO(v, A(sp, -5, 14), { label: 'them' }); drawX(v, A(sp, -3, 7), C.start, { label: 'YOU' });
        const b = add(B, V(Math.sin(t * 9) * (live ? .5 : .15), 0)); drawBall(v, b, 1, false);
        if (live) { circle(ctx, ...v.P(b), 2.6 * v.s, { col: C.gold, w: 4, passes: 2, j: 1.4 }); txt(ctx, 'LOOSE!', w / 2, h * .2, { size: Math.min(70, w / 7), font: 'pop', col: C.gold, align: 'center', stroke: '#05070f' }); }
        if (this.at == null) prompt(ctx, w, this.ask);
      },
      down(p, sx, sy, t) {
        if (this.at != null) return; this.at = t;
        if (t < pop) { this.result = { g: 'miss', msg: 'Too early. Wait until it is loose.' }; return; }
        const r = t - pop; this.result = { g: r < .45 ? 'perfect' : r < .8 ? 'good' : 'miss', msg: `${(r * 1000).toFixed(0)} ms. ${r < .8 ? 'First to the ball.' : 'They got there first.'}` };
      },
    };
  },
  slide: sp => {
    const S = SCENES.slide, B0 = A(sp, -7, 17), S0 = goalSide(A(sp, -13, 6)), beat = .7 + Math.random() * .6, dir = norm(sub(GOAL, B0));
    return {
      ask: 'Your teammate gets BEAT. Tap GO the moment you see it.', result: null, go: null,
      draw(ctx, v, w, h, t) {
        const hes = this.go == null ? 9 : this.go - beat, m = S.meet(B0, S0, Math.max(0, hes));
        const run = Math.max(0, t - beat), Bp = add(B0, mul(dir, Math.min(len(B0) - (this.go == null ? 3 : m.d), 7 * run)));
        const Sp = this.go == null ? S0 : lerp(S0, m.P, clamp((run - hes) / Math.max(.01, m.t - hes), 0, 1));
        circle(ctx, v.X(0), v.Y(0), 8 * v.s, { col: C.stop, w: 2, dash: [4, 7], passes: 1, j: 0, alpha: .7 });
        spray(ctx, [v.P(B0), v.P(Bp)], C.stop, 5, 12, .9);
        drawO(v, Bp); drawBall(v, Bp); drawX(v, t < beat ? goalSide(B0, 1.4) : add(B0, V(-1.5, 2)), C.soft);
        drawX(v, Sp, C.start, { label: 'YOU' });
        if (t >= beat && this.go == null) txt(ctx, 'BEAT!', ...v.P(add(B0, V(0, -3))), { size: v.fs + 16, font: 'pop', col: C.stop, align: 'center', stroke: '#05070f' });
        if (this.go == null) { prompt(ctx, w, this.ask); buttons(ctx, w, h, ['GO']); if (t > beat + 1.6) this.down(null, 0, 0, t); }
      },
      down(p, sx, sy, t) {
        if (this.go != null) return; this.go = t;
        if (t < beat) { this.result = { g: 'miss', msg: 'Too early. He was not beat yet.' }; this.go = beat; return; }
        const d = t - beat, m = S.meet(B0, S0, d);
        this.result = { g: d < .35 && m.d >= 8 ? 'perfect' : m.d >= 8 ? 'good' : 'miss', msg: `You went in ${(d * 1000).toFixed(0)} ms. You met him ${m.d.toFixed(0)} yd out.` };
      },
    };
  },
  pick: sp => {
    const S = SCENES.pick, contact = Math.random() < .5, P = (fr, u) => adapt(sp, kf(fr, u));
    return chooseGame({
      ask: contact ? 'BUMP! The pick hit you. Call it.' : 'The pick missed you. Call it.', labels: ['OVER', 'SWITCH'], correct: contact ? 'SWITCH' : 'OVER',
      right: contact ? 'Contact means switch. Say it loud.' : 'No contact. Fight over and stay with him.', wrong: contact ? 'You got hit. Switch and say it.' : 'No bump, no switch. Go over.',
      scene: (v, t) => {
        const u = Math.min(1.1, t), a1 = P(S.A1, u), a2 = P(S.A2, u), d1 = contact ? lerp(P(S.sw.D1, u), a2, 0) : P(S.over.D1, u);
        drawO(v, a1); drawBall(v, a1); drawO(v, a2, { seed: 8, label: 'pick' }); drawX(v, d1, C.start, { label: 'YOU' }); drawX(v, P(S.over.D2, u), C.ink);
        if (contact && t > .9) txt(v.ctx, 'BUMP!', ...v.P(add(d1, V(0, -3))), { size: v.fs + 12, font: 'pop', col: C.stop, align: 'center', stroke: '#05070f' });
      },
    });
  },
  hold: sp => {
    const atk = [[-6, 14], [6, 14], [-6, 4], [6, 4]].map(p => A(sp, ...p)), tri = [[0, 10.5], [-3.5, 5.6], [3.5, 5.6]].map(p => A(sp, ...p));
    return chooseGame({
      ask: 'Four of them. Three of you. Help is running back.', labels: ['JUMP', 'HOLD'], correct: 'HOLD',
      right: 'Hold the triangle. Help arrives. It is even again.', wrong: 'Jump now and two passes later they shoot.',
      scene: (v, t, picked) => {
        v.ctx.save(); v.ctx.globalAlpha = .16; v.ctx.fillStyle = C.cont; v.ctx.beginPath(); tri.forEach((p, i) => i ? v.ctx.lineTo(...v.P(p)) : v.ctx.moveTo(...v.P(p))); v.ctx.closePath(); v.ctx.fill(); v.ctx.restore();
        atk.forEach((p, i) => drawO(v, p, { seed: 100 + i })); drawBall(v, atk[0]); tri.forEach(p => drawX(v, p, C.cont));
        const tr = lerp(A(sp, -1, 23.5), A(sp, -4.9, 12.6), clamp(t / 6, 0, 1)); drawX(v, tr, C.start, { label: 'help' });
      },
    });
  },
  disguise: sp => {
    const spots = SET.map(p => goalSide(A(sp, ...p), 1.8)), swaps = [[0, 3], [1, 4], [2, 5], [0, 5]];
    const order = [0, 1, 2, 3, 4, 5]; const timeline = swaps.map((s, i) => ({ s, t0: 1.4 + i * .45 }));
    const posAt = t => { const o = order.slice(); let pos = o.map(i => spots[i]); for (const { s: [a, b], t0 } of timeline) { if (t < t0) break; const u = ease((t - t0) / .4); const pa = spots[o[a]], pb = spots[o[b]]; if (u >= 1) { [o[a], o[b]] = [o[b], o[a]]; pos = o.map(i => spots[i]); } else { pos = o.map(i => spots[i]); pos[a] = lerp(pa, pb, u); pos[b] = lerp(pb, pa, u); break; } } return pos; };
    const end = 1.4 + swaps.length * .45 + .1;
    return {
      ask: 'You are the offense. Tap the short stick.', result: null, pick: null,
      draw(ctx, v, w, h, t) {
        const pos = posAt(t); SET.forEach((p, i) => drawO(v, A(sp, ...p), { seed: 90 + i, alpha: .6 }));
        pos.forEach((p, i) => drawX(v, p, t < 1.2 || this.pick != null ? (i === 0 ? C.stop : C.cont) : C.cont, { label: (t < 1.2 || this.pick != null) && i === 0 ? sp.weak : '' }));
        if (this.pick == null) prompt(ctx, w, t < 1.2 ? 'Remember the red one...' : t < end ? 'Scramble!' : this.ask, t < end ? C.ink : C.gold);
      },
      down(p, sx, sy, t) { if (this.pick != null || t < end) return; const pos = posAt(t); let k = 0; pos.forEach((q, i) => { if (dist(q, p) < dist(pos[k], p)) k = i; }); if (dist(pos[k], p) > 4) return; this.pick = k; this.result = { g: 'good', msg: k === 0 ? 'Lucky guess. 1 in 6. Make them guess.' : 'Hard, right? That is why we hide it.' }; },
    };
  },
  hustle: sp => {
    const b0 = A(sp, 0, 9), b1 = A(sp, 11, 17);
    return {
      ask: 'Press and HOLD to run. Let go only at the whistle.', result: null, held: 0, holding: false, whistle: null, start: null, last: null,
      draw(ctx, v, w, h, t) {
        const dt = this.last == null ? 0 : t - this.last; this.last = t;
        if (this.holding && !this.result) this.held += dt;
        if (this.start == null && t > 3.5 && !this.result) this.result = { g: 'miss', msg: 'Press and hold to chase the ball.' };
        const bu = clamp(t / 3.4, 0, 1), ball = lerp(b0, b1, 1 - Math.pow(1 - bu, 2));
        const you = lerp(A(sp, -5, 9), add(b1, V(-1.2, -.6)), clamp(this.held / 2.4, 0, 1)), them = lerp(A(sp, 17, 23), add(b1, V(1.6, 1.2)), clamp(t / 4.4, 0, 1));
        drawO(v, them, { label: 'them' }); drawX(v, you, C.start, { label: 'YOU' }); drawBall(v, ball, 1, false);
        if (this.whistle != null && t >= this.whistle) txt(ctx, 'TWEET!', w / 2, h * .22, { size: Math.min(60, w / 8), font: 'pop', col: C.stop, align: 'center', stroke: '#05070f' });
        if (!this.result && this.whistle != null && t >= this.whistle) this.result = this.holding ? { g: this.held > 2 ? 'perfect' : 'good', msg: 'You played to the whistle. The ball is yours.' } : { g: 'miss', msg: 'You stopped before the whistle.' };
        if (!this.result) prompt(ctx, w, this.holding ? 'Keep holding...' : this.ask);
      },
      down(p, sx, sy, t) { if (this.result) return; this.holding = true; if (this.start == null) { this.start = t; this.whistle = t + 2.6 + Math.random() * 1.4; } },
      up(t) { if (this.result || !this.holding) return; this.holding = false; if (this.whistle != null && t < this.whistle) this.result = { g: 'miss', msg: 'You quit early. The play was still on.' }; },
    };
  },
};

// Library ideas can define their own decision (choose) or reaction (time) game. Both play over
// the idea's template, frozen near its start, so the field and players match the frame.
function backdrop(template, v, sp, w, h) {
  if (template === 'loose' || template === 'hustle' || !SCENES[template]) {
    drawO(v, A(sp, -5, 14), { label: 'them' }); drawO(v, A(sp, 6, 12), { seed: 7 }); drawX(v, A(sp, -3, 7), C.start, { label: 'YOU' }); drawBall(v, A(sp, 1, 10), 1, false);
  } else SCENES[template].draw(v, .6, sp, w, h);
}
function cueText(ctx, w, h, cue) {
  const size = Math.min(70, w / 7, (w * .9) / Math.max(1, cue.length * .5));
  txt(ctx, cue, w / 2, h * .5, { size, font: 'pop', col: C.gold, align: 'center', stroke: '#05070f' });
}
function genericChoose(spec, template, sp) {
  return {
    ask: spec.ask, btns: [], result: null, picked: null,
    draw(ctx, v, w, h) { backdrop(template, v, sp, w, h); if (!this.picked) { prompt(ctx, w, this.ask); this.btns = buttons(ctx, w, h, spec.options); } },
    down(p, sx, sy) { if (this.picked) return; const b = hitBtn(this.btns, sx, sy); if (!b) return; this.picked = b.label; const ok = b.label === spec.correct; this.result = { g: ok ? 'perfect' : 'miss', msg: ok ? spec.right : spec.wrong }; },
  };
}
function genericTime(spec, template, sp) {
  const at = 1.1 + Math.random() * 1.5;
  return {
    ask: spec.ask, result: null, tapped: null,
    draw(ctx, v, w, h, t) {
      backdrop(template, v, sp, w, h);
      if (t >= at && this.tapped == null) { circle(ctx, w / 2, h * .5, Math.min(w, h) * .3, { col: C.gold, w: 5, passes: 2, j: 2 }); cueText(ctx, w, h, spec.cue); }
      if (this.tapped == null) { prompt(ctx, w, t < at ? this.ask : 'NOW! Tap!', t < at ? C.gold : C.stop); if (t > at + 1.6) this.down(null, 0, 0, t); }
    },
    down(p, sx, sy, t) {
      if (this.tapped != null) return; this.tapped = t;
      if (t < at) { this.result = { g: 'miss', msg: `Too early. Wait for "${spec.cue}"` }; return; }
      const r = t - at;
      this.result = { g: r < .45 ? 'perfect' : r < .8 ? 'good' : 'miss', msg: `${Math.round(r * 1000)} ms. ${r < .8 ? spec.right : spec.wrong}` };
    },
  };
}

// The game for one frame: the idea's own game if it has one, else its template's game with the
// idea's prompt. Unknown templates still get a real tap-to-play game, never a free pass.
export function gameFor(item, sp) {
  const spec = item.game, t = item.concept;
  if (spec?.type === 'choose') return genericChoose(spec, t, sp);
  if (spec?.type === 'time') return genericTime(spec, t, sp);
  if (!GAMES[t]) return genericTime({ ask: 'Tap the moment you see GO.', cue: 'GO!', right: 'Quick reaction.', wrong: 'Too slow.' }, t, sp);
  const g = GAMES[t](sp);
  if (spec?.ask) g.ask = spec.ask;
  return g;
}
export { banner };
