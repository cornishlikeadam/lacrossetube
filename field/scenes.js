// One animated proof per concept. Each scene is a pure function of time t, so it can be
// scrubbed, stepped like a manual, or recorded frame by frame into a video.
import {
  V, add, sub, mul, len, dist, norm, lerp, clamp, ease, ph, deg, GOAL, closestOnSeg, segDist, angBetween, mouthAngle, kf, rng,
  C, line, circle, spray, arrowHead, txt, hatch, crown, drawO, drawX, drawBall, wedge,
} from './ink.js';
import { adapt, fill } from './sports.js';

const RUN = 7;
const A = (sp, x, y) => adapt(sp, V(x, y));
const goalSide = (p, k = 1.6) => add(p, mul(norm(sub(V(0, .8), p)), k));
const tag = (v, s, p, col, a = 1, size = 0) => txt(v.ctx, s, v.X(p.x), v.Y(p.y), { size: size || v.fs + 6, font: 'pop', col, align: 'center', alpha: a, stroke: C.paper });
const dashTo = (v, a, b, col, al = 1, head = true) => { line(v.ctx, ...v.P(a), ...v.P(b), { col, w: 2, dash: [5, 6], passes: 1, j: 0, alpha: al }); if (head) arrowHead(v.ctx, ...v.P(a), ...v.P(b), col, 10, al); };
const sprayTo = (v, a, b, col, al = 1, w = 6, seed = 3) => { spray(v.ctx, [v.P(a), v.P(b)], col, w, seed, al); arrowHead(v.ctx, ...v.P(a), ...v.P(b), col, 13, al, 3.4); };
const SET = [[-7, 17], [7, 17], [-13, 6], [13, 6], [-6, -5], [6, -5]];

export const SCENES = {
  help: {
    dur: 6.2,
    steps: () => [[0.3, 'The {ball} is far away. Don\'t stand next to your player. Step in toward the {goal}.'], [1.9, 'Someone drives at the {goal}. You\'re already there to help.'], [3.6, 'They pass to your player. The {ball} is in the air long enough for you to get back.']],
    draw(v, t, sp) {
      const B0 = A(sp, -8, 11), M = A(sp, 10, 7), E = mul(norm(B0), 3.2), D0 = goalSide(M);
      const H = lerp(M, closestOnSeg(M, B0, E), .6), Bend = lerp(B0, E, .55), Hh = lerp(H, closestOnSeg(H, B0, Bend), .55);
      const Bp = lerp(B0, Bend, ph(t, 1.9, 3.2));
      let D = lerp(D0, H, ph(t, .4, 1.7));
      if (t > 1.9) D = lerp(H, Hh, ph(t, 1.9, 3.1));
      if (t > 3.6) D = lerp(Hh, goalSide(M), ph(t, 3.7, 5.1));
      const ball = t > 3.6 ? lerp(Bp, M, ph(t, 3.7, 4.6)) : Bp;
      if (t > .3 && t < 1.9) dashTo(v, D0, H, C.start, ph(t, .3, .6));
      if (t > 1.9 && t < 3.7) { sprayTo(v, B0, Bend, C.stop, ph(t, 1.9, 2.2)); circle(v.ctx, ...v.P(D), 3 * v.s, { col: C.start, w: 2, dash: [5, 5], passes: 1, j: 0 }); }
      if (t > 2.9 && t < 3.7) tag(v, 'HELP!', add(Hh, V(0, -4.2)), C.start);
      if (t > 3.6) {
        line(v.ctx, ...v.P(Bp), ...v.P(M), { col: C.gold, w: 2.4, dash: [3, 7], passes: 1, j: 0 });
        circle(v.ctx, ...v.P(M), (dist(Hh, M) + .6) * v.s, { col: C.cont, w: 1.6, dash: [6, 6], passes: 1, j: 0, fill: C.cont, fillAlpha: .07 });
      }
      if (t > 5.1) tag(v, 'BACK IN TIME', add(M, V(-2, 5)), C.start);
      drawO(v, Bp, { label: t < 3.6 ? 'driver' : '' }); drawO(v, M, { label: 'your player', col: C.cont, lcol: C.cont, seed: 8 });
      drawX(v, D, C.start, { label: 'YOU', left: dist(D, M) < 4 }); drawBall(v, ball, 1, t <= 3.6 || t > 4.6);
    }
  },

  talk: {
    dur: 6.2,
    steps: () => [[0, 'Whistle. Everybody is scattered and has to find someone.'], [0.5, 'Nobody talks, so each defender runs to the closest player. Two pick the same one.'], [3.6, 'Talk! "I got this one!" Each call claims one player, and nobody is left open.']],
    layout(sp) {
      if (sp._talk) return sp._talk;
      for (let s = 1; s < 500; s++) {
        const r = rng(s * 7919), At = [], Dt = [];
        while (At.length < 6) { const p = V(-15 + r() * 30, -3 + r() * 21); if (At.every(q => dist(p, q) > 5.5) && len(p) > 5) At.push(p); }
        while (Dt.length < 6) { const p = V(-16 + r() * 32, 3 + r() * 18); if (Dt.every(q => dist(p, q) > 4)) Dt.push(p); }
        const Aa = At.map(p => adapt(sp, p)), Da = Dt.map(p => adapt(sp, p)), T = Aa.map(a => goalSide(a, 1.3));
        const silent = Da.map(d => { let b = 0; Aa.forEach((a, i) => { if (dist(d, a) < dist(d, Aa[b])) b = i; }); return b; });
        const covered = new Set(silent).size; if (covered !== 5) continue;
        let best = null, bs = 1e9;
        const perm = (arr, l) => { if (l === arr.length) { const sm = arr.reduce((acc, ai, di) => acc + dist(Da[di], T[ai]), 0); if (sm < bs) { bs = sm; best = arr.slice(); } return; } for (let i = l; i < arr.length; i++) { [arr[l], arr[i]] = [arr[i], arr[l]]; perm(arr, l + 1); [arr[l], arr[i]] = [arr[i], arr[l]]; } };
        perm([0, 1, 2, 3, 4, 5], 0);
        return (sp._talk = { Aa, Da, T, silent, talk: best });
      }
    },
    draw(v, t, sp) {
      const L = this.layout(sp), talking = t > 3.6;
      const pos = L.Da.map((d, i) => {
        const sT = L.T[L.silent[i]], tT = L.T[L.talk[i]];
        return talking ? lerp(sT, tT, ph(t, 3.7, 5.4)) : lerp(d, sT, ph(t, .5, 2.4));
      });
      if (t > .5) L.Da.forEach((d, i) => line(v.ctx, ...v.P(pos[i]), ...v.P(talking ? L.T[L.talk[i]] : L.T[L.silent[i]]), { col: talking ? C.start : C.soft, w: 1.4, dash: [3, 5], passes: 1, j: 0, alpha: .8 }));
      const cov = new Set(L.silent);
      L.Aa.forEach((a, i) => {
        drawO(v, a, { seed: 40 + i });
        if (!cov.has(i)) { const al = t < 2.4 ? 0 : talking ? 1 - ph(t, 3.7, 4.6) : ph(t, 2.4, 2.8); circle(v.ctx, ...v.P(a), 1.8 * v.s, { col: C.stop, w: 4, passes: 2, j: 1.5, alpha: al, seed: 60 + i }); tag(v, 'OPEN', add(a, V(0, -3)), C.stop, al); }
      });
      pos.forEach((p, i) => drawX(v, p, talking ? C.start : C.ink, { w: 3.2 }));
      if (t > 4.5) pos.forEach((p, i) => { if (i % 2 === 0) txt(v.ctx, i ? 'MINE!' : 'I GOT HIM!', v.X(p.x), v.Y(p.y) - 22, { size: v.fs, col: C.start, align: 'center', alpha: ph(t, 4.5, 4.9), stroke: C.paper }); });
    }
  },

  loose: {
    dur: 6,
    steps: () => [[0, 'Each try, they might score. That\'s the red stripes.'], [0.9, 'Lose the {loose} and they get another try... and another.'], [3.4, 'Win the {loose} and the tries stop. Same team, fewer goals.']],
    draw(v, t, sp, w, h) {
      const ctx = v.ctx, p = .3, g = t < 3.4 ? .5 : .5 + .4 * ph(t, 3.4, 4.6), r = (1 - p) * (1 - g), P = p / (1 - r);
      const N = 9, rects = [{ x: 0, y: 0, s: 1 }]; let bb = { x0: 0, y0: 0, x1: 1, y1: 1 };
      const dirs = ['R', 'D', 'L', 'U'];
      for (let k = 1; k < N; k++) {
        const s = Math.pow(r, k / 2); if (s < .02) break; let x, y;
        switch (dirs[(k - 1) % 4]) { case 'R': x = bb.x1; y = bb.y0; break; case 'D': x = bb.x1 - s; y = bb.y1; break; case 'L': x = bb.x0 - s; y = bb.y1 - s; break; default: x = bb.x0; y = bb.y0 - s; }
        rects.push({ x, y, s }); bb = { x0: Math.min(bb.x0, x), y0: Math.min(bb.y0, y), x1: Math.max(bb.x1, x + s), y1: Math.max(bb.y1, y + s) };
      }
      const shown = t < 3.4 ? Math.min(rects.length, 1 + Math.floor(t / .42)) : rects.length;
      const top = h * .2, avail = h * .62, sc = Math.min((w - 40) / (bb.x1 - bb.x0), avail / (bb.y1 - bb.y0));
      const ox = (w - (bb.x1 - bb.x0) * sc) / 2 - bb.x0 * sc, oy = top + (avail - (bb.y1 - bb.y0) * sc) / 2 - bb.y0 * sc;
      txt(ctx, `${sp.goal.toUpperCase()} TRIES`, w / 2, h * .09, { size: v.fs + 6, font: 'pop', col: C.ink, align: 'center' });
      rects.slice(0, shown).forEach((q, k) => {
        const x = ox + q.x * sc, y = oy + q.y * sc, s = q.s * sc;
        ctx.save(); ctx.fillStyle = [C.pink, C.gold, C.cont, C.start][k % 4]; ctx.globalAlpha = .28; ctx.fillRect(x, y, s, s); ctx.restore();
        ctx.save(); ctx.globalAlpha = .25; ctx.fillStyle = C.stop; ctx.fillRect(x, y, s * p, s); ctx.restore();
        hatch(ctx, x, y, s * p, s, C.stop, Math.max(3, s / 18), .95);
        ctx.save(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.4; ctx.strokeRect(x, y, s, s); ctx.restore();
        if (s > 50) txt(ctx, `try ${k + 1}`, x + s - 8, y + 16, { size: Math.min(v.fs + 2, s / 5), col: C.ink, align: 'right', font: 'hand' });
      });
      txt(ctx, `They score on ${(P * 100).toFixed(0)}% of trips`, w / 2, h * .9, { size: v.fs + 4, font: 'pop', col: g > .6 ? C.start : C.stop, align: 'center', stroke: C.paper });
      txt(ctx, `we win the ${sp.loose} ${(g * 100).toFixed(0)}% of the time`, w / 2, h * .96, { size: v.fs, font: 'body', col: C.soft, align: 'center' });
    }
  },

  danger: {
    dur: 5.4,
    steps: sp => [[0.3, 'Far away, the {goal} looks tiny.'], [1.6, 'Get closer and it gets bigger and bigger. Closer means more dangerous.'], [3.6, sp.behind ? 'Behind the {goal} it disappears: 0°. Guard the player in front first!' : 'So guard the player closest to the {goal} first!']],
    draw(v, t, sp) {
      const w = sp.mouth, F = A(sp, 14, 21), Cl = A(sp, 2.5, 5.5), S = lerp(F, Cl, ph(t, .3, 3.3));
      if (w <= 4) {
        v.ctx.save(); v.ctx.beginPath(); v.ctx.rect(0, v.Y(0), v.X(20), v.Y(24)); v.ctx.clip();
        [8, 16, 30].forEach((d0, i) => { const th = d0 * Math.PI / 180, R = w / Math.sin(th), cy = w / Math.tan(th); circle(v.ctx, v.X(0), v.Y(cy), R * v.s, { col: C.gold, w: 1.8, passes: 1, j: 0, alpha: ph(t, 1.6, 2.2) * .9, a0: -Math.PI / 2, seed: 50 + i }); });
        v.ctx.restore();
      }
      wedge(v, F, w, C.cont, .18); wedge(v, S, w, C.stop, .3);
      tag(v, `${deg(mouthAngle(F, w)).toFixed(0)}°`, add(F, V(0, 2.8)), C.cont, 1, v.fs + 2);
      tag(v, `${deg(mouthAngle(S, w)).toFixed(0)}°`, add(S, V(3.4, 1.8)), C.stop, 1, v.fs + 8);
      drawO(v, F, { col: C.cont, label: 'far', lcol: C.cont, alpha: .6 }); drawO(v, S, { col: C.stop, lcol: C.stop, label: t > 3 ? 'DANGER' : '' }); drawBall(v, S);
      if (sp.behind && t > 3.6) { const Bh = A(sp, 6, -4); drawO(v, Bh, { seed: 9, alpha: ph(t, 3.6, 4) }); tag(v, '0°', add(Bh, V(3, 0)), C.ink, ph(t, 3.6, 4)); }
    }
  },

  slide: {
    dur: 6,
    steps: () => [[0, 'A teammate gets beat. The clock starts.'], [0.9, 'Wait too long and the shooter is already close to the {goal}.'], [3.1, 'Go right away and you meet them far out. See it, turn your hips, go!']],
    meet(B0, S0, hes) {
      const dir = norm(sub(GOAL, B0)), L = len(B0) - 3;
      for (let t = 0; t < 4; t += .01) { const P = add(B0, mul(dir, Math.min(L, RUN * t))); if (dist(S0, P) <= Math.max(0, t - hes) * RUN + 1.5) return { t, P, d: len(P) }; }
      return { t: 4, P: add(B0, mul(dir, L)), d: 3 };
    },
    draw(v, t, sp) {
      const late = t < 3.1, hes = late ? .8 : .1, tau = late ? t : t - 3.1;
      const B0 = A(sp, -7, 17), S0 = goalSide(A(sp, -13, 6)), m = this.meet(B0, S0, hes), ok = m.d >= 8;
      const dir = norm(sub(GOAL, B0)), Bp = add(B0, mul(dir, Math.min(len(B0) - m.d, RUN * tau)));
      const Sp = tau < hes ? S0 : lerp(S0, m.P, clamp((tau - hes) / Math.max(.01, m.t - hes), 0, 1));
      v.ctx.save(); v.ctx.beginPath(); v.ctx.rect(0, v.Y(0), v.X(20), v.Y(24)); v.ctx.clip();
      circle(v.ctx, v.X(0), v.Y(0), 8 * v.s, { col: C.stop, w: 2, dash: [4, 7], passes: 1, j: 0, alpha: .8 }); v.ctx.restore();
      txt(v.ctx, 'shooting range', v.X(6.2), v.Y(6.6), { size: v.fs - 1, col: C.stop, font: 'body' });
      sprayTo(v, B0, Bp, C.stop, .9, 5, 12);
      if (tau > hes) sprayTo(v, S0, Sp, C.start, .9, 5, 13);
      tag(v, late ? 'WAIT...' : 'GO NOW', A(sp, -12, 21), late ? C.stop : C.start, 1, v.fs + 4);
      if (tau >= m.t) tag(v, ok ? 'ON TIME' : 'TOO LATE', add(m.P, V(6, 1)), ok ? C.start : C.stop);
      SET.slice(1).forEach((p, i) => { const a = A(sp, ...p); drawO(v, a, { seed: 70 + i, alpha: .55 }); if (i !== 1) drawX(v, goalSide(a), C.ink, { alpha: .55, w: 2.6 }); });
      drawO(v, Bp); drawBall(v, Bp); drawX(v, add(B0, V(-1.5, 2)), C.soft, { w: 2.6 });
      drawX(v, Sp, C.start, { label: 'YOU' });
    }
  },

  pick: {
    dur: 6,
    steps: () => [[0, 'A teammate stands still to block your path. That\'s a pick (or screen).'], [0.4, 'It doesn\'t touch you, so fight over the top and stay with your player.'], [3, 'Switch for no reason and two of you change jobs at once. Someone is left open.']],
    A1: [[0, -11, 14], [2.6, 7, 12.6]], A2: [[0, -3, 13.4], [1.25, -3, 13.4], [2.6, -1.4, 5.4]],
    over: { D1: t => { const a = kf(SCENES.pick.A1, t), b = Math.exp(-Math.pow((a.x + 3) / 1.6, 2)); return V(a.x - .3, a.y - 1.5 + 3.2 * b); }, D2: [[0, -3, 11.9], [1.25, -3, 11.9], [2.6, -1.2, 4]] },
    sw: { D1: [[0, -11, 12.3], [.8, -5.6, 12.4], [1.05, -4.5, 12.4], [1.65, -4.5, 12.4], [2.6, -2.6, 7]], D2: [[0, -3, 11.9], [1.05, -3, 11.9], [1.65, -2.4, 12.3], [2.6, 4.6, 12]] },
    draw(v, t, sp) {
      const S = this, sw = t >= 3, tau = Math.min(2.6, sw ? t - 3 : t), M = sw ? S.sw : S.over, P = (fr, u) => adapt(sp, kf(fr, u));
      for (const [fr, col] of [[S.A1, C.soft], [S.A2, C.soft], [M.D1, sw ? C.ink : C.start], [M.D2, sw ? C.ink : C.start]]) {
        let prev = null; for (let u = 0; u <= tau; u += .05) { const q = P(fr, u); if (prev) line(v.ctx, ...v.P(prev), ...v.P(q), { col, w: 2.4, passes: 1, j: 0, alpha: .7 }); prev = q; }
      }
      const a1 = P(S.A1, tau), a2 = P(S.A2, tau), d1 = P(M.D1, tau), d2 = P(M.D2, tau);
      if (!sw && tau < .5) tag(v, 'PICK', add(a2, V(0, 3.2)), C.gold, 1, v.fs + 2);
      drawO(v, a1); drawBall(v, a1); drawO(v, a2, { seed: 8 });
      drawX(v, d1, sw ? C.ink : C.start, { label: 'YOU' }); drawX(v, d2, sw ? C.ink : C.start);
      if (sw) [a1, a2].forEach(a => { if (Math.min(dist(a, d1), dist(a, d2)) > 3) { circle(v.ctx, ...v.P(a), 1.8 * v.s, { col: C.stop, w: 4, passes: 2, j: 1.4 }); tag(v, 'OPEN', add(a, V(0, 3.4)), C.stop); } });
      tag(v, sw ? 'SWITCH?!' : 'OVER, OVER, OVER', A(sp, 0, 22), sw ? C.stop : C.start, ph(sw ? t - 3 : t, .4, .8), v.fs + 6);
    }
  },

  angle: {
    dur: 5,
    steps: () => [[0, 'Their road to the {goal} is a straight line.'], [0.8, 'Chase the pass and you step off the road. It\'s wide open!'], [2.6, 'Get back on the road, between them and the {goal}. Road closed.']],
    draw(v, t, sp) {
      const A0 = A(sp, -10, 12), O2 = A(sp, 3.5, 19), lane = lerp(A0, O2, .45), on = add(A0, mul(norm(sub(GOAL, A0)), 2.4));
      let D = lerp(A(sp, -1, 22), add(lane, V(.4, -.6)), ph(t, .6, 1.8)); if (t > 2.6) D = lerp(add(lane, V(.4, -.6)), on, ph(t, 2.6, 4));
      const AD = sub(D, A0), AG = sub(GOAL, A0), al = Math.asin(clamp(1.6 / Math.max(len(AD), 1.6), 0, 1)), covered = angBetween(AD, AG) < al;
      line(v.ctx, ...v.P(A0), ...v.P(O2), { col: C.gold, w: 2, dash: [3, 7], passes: 1, j: 0 });
      const [ax, ay] = v.P(A0), base = Math.atan2(AD.y, AD.x), L = (len(AG) + 2) * v.s;
      v.ctx.save(); v.ctx.globalAlpha = .22; v.ctx.fillStyle = C.start; v.ctx.beginPath(); v.ctx.moveTo(ax, ay); v.ctx.arc(ax, ay, L, base - al, base + al); v.ctx.closePath(); v.ctx.fill(); v.ctx.restore();
      line(v.ctx, ...v.P(A0), ...v.P(GOAL), { col: C.ink, w: 2, passes: 2, j: .8 });
      if (!covered && t > .8) { sprayTo(v, A0, mul(norm(A0), 3.4), C.stop, ph(t, .8, 1.2), 7); tag(v, 'ROAD OPEN', A(sp, 3, 6), C.stop); }
      if (covered) tag(v, 'ROAD CLOSED', A(sp, 4, 6), C.start);
      drawO(v, A0); drawBall(v, A0); drawO(v, O2, { seed: 12 }); drawX(v, D, C.start, { label: 'YOU' });
    }
  },

  double: {
    dur: 5,
    steps: () => [[0, 'Out in the open they can go anywhere: 360°.'], [1, 'The sideline takes away a big slice.'], [2.6, 'Add a second teammate (a double) and there\'s almost nowhere to go. Now grab the {loose}!']],
    draw(v, t, sp) {
      const side = sp.side, Ab = adapt(sp, V(side + 2, 6)), D1 = add(Ab, V(1.8, -1.4)), D2 = lerp(adapt(sp, V(side + 11, 14)), add(Ab, V(1.9, 2.6)), ph(t, 2.6, 3.6));
      line(v.ctx, v.X(side), v.Y(-6), v.X(side), v.Y(24), { col: C.ink, w: 5, passes: 1, j: .4, alpha: ph(t, .9, 1.2) });
      const ds = []; if (t > 1.8) ds.push(D1); if (t > 2.6) ds.push(D2);
      let free = 0; const R = 3.6 * v.s, [ax, ay] = v.P(Ab);
      for (let i = 0; i < 180; i++) {
        const th = i * Math.PI / 90, d = V(Math.cos(th), Math.sin(th));
        let b = t > 1 && Ab.x + 4 * d.x < side;
        if (!b) for (const D of ds) { const rel = sub(D, Ab), L = len(rel); if (L < 6.5 && angBetween(d, rel) < Math.asin(clamp(1.8 / Math.max(L, 1.8), 0, 1))) b = true; }
        if (!b) free += 2;
        v.ctx.save(); v.ctx.strokeStyle = b ? C.soft : C.cont; v.ctx.globalAlpha = b ? .35 : 1; v.ctx.lineWidth = b ? 2 : 9;
        v.ctx.beginPath(); v.ctx.arc(ax, ay, R, th, th + Math.PI / 90 + .005); v.ctx.stroke(); v.ctx.restore();
      }
      if (t > 1.8) drawX(v, D1, C.ink, { label: 'on ball' });
      drawX(v, D2, C.cont, { label: 'double', alpha: t > 2.4 ? 1 : .35 });
      drawO(v, Ab); drawBall(v, Ab);
      tag(v, `${free}° LEFT`, add(Ab, V(10, -2)), free < 120 ? C.start : C.ink, 1, v.fs + 8);
      if (t > 3.8) crown(v.ctx, ...v.P(add(Ab, V(0, -4))), 16, C.gold, ph(t, 3.8, 4.2));
    }
  },

  disguise: {
    dur: 5,
    steps: () => [[0, 'They hunt for our weakest matchup, the {weak}.'], [0.6, 'If they can spot it, they attack it every time.'], [3, 'If we all look the same, they have to guess: 1 chance in 6.']],
    draw(v, t, sp) {
      const spots = SET.map(p => goalSide(A(sp, ...p), 1.8)), perm = [3, 0, 5, 1, 4, 2], u = ph(t, 2.2, 3);
      const pos = spots.map((s, i) => lerp(s, spots[perm[i]], u)), ball = A(sp, ...SET[0]), hidden = t > 3;
      SET.forEach((p, i) => drawO(v, A(sp, ...p), { seed: 90 + i })); drawBall(v, ball);
      if (!hidden && t > .6) { sprayTo(v, ball, lerp(ball, pos[0], .85), C.stop, ph(t, .6, 1), 6); tag(v, 'FOUND YOU', add(pos[0], V(0, 3.4)), C.stop, ph(t, .9, 1.2)); }
      if (hidden) pos.forEach((p, i) => { if (dist(p, ball) > 3) { line(v.ctx, ...v.P(ball), ...v.P(lerp(ball, p, .86)), { col: C.cont, w: 1.8, dash: [3, 6], passes: 1, j: 0, alpha: ph(t, 3, 3.4) }); txt(v.ctx, '1/6', ...v.P(lerp(ball, p, .6)), { size: v.fs + 1, font: 'pop', col: C.cont, align: 'center', alpha: ph(t, 3, 3.4), stroke: C.paper }); } });
      pos.forEach((p, i) => drawX(v, p, hidden ? C.cont : i === 0 ? C.stop : C.ink, { small: !hidden && i === 0, label: !hidden && i === 0 ? sp.weak : '' }));
      if (hidden) tag(v, '?', add(ball, V(-2.6, -2.6)), C.cont, 1, v.fs + 18);
    }
  },

  hold: {
    dur: 6.2,
    steps: () => [[0, 'Four of them, three of us, and help is running back.'], [0.3, 'Run at the {ball} too early and two passes later someone is open.'], [3, 'Hold the triangle. Stay between them and the {goal}. Wait for help.']],
    atk: [[-6, 14], [6, 14], [-6, 4], [6, 4]],
    ball: { c: [[0, -5.4, 13.4], [.7, -5.4, 13.4], [1.1, 6.6, 13.4], [1.55, 6.6, 13.4], [1.9, 6.6, 3.4], [2.05, 6.6, 3.4], [2.3, .4, .3]], h: [[0, -5.4, 13.4], [.7, -5.4, 13.4], [1.1, 6.6, 13.4], [1.55, 6.6, 13.4], [1.9, 6.6, 3.4]] },
    def: {
      c: { T: [[0, 0, 10.5], [.3, 0, 10.5], [.75, -5.1, 12.7]], L: [[0, -3.5, 5.6], [2.6, -4.6, 5]], R: [[0, 3.5, 5.6], [1.1, 3.5, 5.6], [1.65, 5.3, 12.3]], Tr: [[0, -1, 23.5], [2.7, 4.6, 6.2]] },
      h: { T: [[0, 0, 10.5], [.6, -2, 10.4], [1.1, -2, 10.4], [1.5, 2.2, 10.4], [1.95, 2.2, 10.4], [2.5, 4.8, 12.3]], L: [[0, -3.5, 5.6], [1.2, -3.2, 5.6], [2, -4.7, 5.1]], R: [[0, 3.5, 5.6], [1.1, 3.5, 5.6], [1.5, 4.1, 6.4], [1.95, 5.3, 5.3]], Tr: [[0, -1, 23.5], [2.6, -4.9, 12.6]] },
    },
    draw(v, t, sp) {
      const hold = t >= 3, tau = Math.min(2.9, hold ? t - 3 : t), D = this.def[hold ? 'h' : 'c'], P = (fr) => adapt(sp, kf(fr, tau));
      const tri = ['T', 'L', 'R'].map(k => P(D[k]));
      if (hold) { v.ctx.save(); v.ctx.globalAlpha = .16; v.ctx.fillStyle = C.cont; v.ctx.beginPath(); tri.forEach((p, i) => i ? v.ctx.lineTo(...v.P(p)) : v.ctx.moveTo(...v.P(p))); v.ctx.closePath(); v.ctx.fill(); v.ctx.restore(); }
      dashTo(v, adapt(sp, V(-1, 23.5)), P(D.Tr), C.cont, .7, false);
      this.atk.forEach((a, i) => drawO(v, A(sp, ...a), { seed: 100 + i }));
      drawBall(v, adapt(sp, kf(this.ball[hold ? 'h' : 'c'], tau)), 1, false);
      tri.forEach(p => drawX(v, p, hold ? C.cont : C.ink));
      drawX(v, P(D.Tr), C.cont, { label: 'help' });
      if (!hold && tau > 2) { const O = A(sp, 6, 4); circle(v.ctx, ...v.P(O), 1.8 * v.s, { col: C.stop, w: 4, passes: 2, j: 1.4 }); tag(v, 'OPEN SHOT', A(sp, -8, 20), C.stop, ph(tau, 2, 2.3)); }
      if (hold && tau > 2.5) tag(v, 'EVEN AGAIN', A(sp, -8, 20), C.cont, ph(tau, 2.5, 2.8));
      tag(v, hold ? 'HOLD' : 'JUMP EARLY', A(sp, 11, 21), hold ? C.start : C.stop, 1, v.fs + 2);
    }
  },

  hustle: {
    dur: 5.2,
    steps: () => [[0, 'The {ball} is loose. The play is NOT over.'], [1.2, 'Stop early and the other team gets there first.'], [3.2, 'Keep going until you hear the whistle. The {ball} is yours.']],
    draw(v, t, sp, w, h) {
      const b0 = A(sp, 0, 9), b1 = A(sp, 11, 17), bu = 1 - Math.pow(1 - clamp(t / 3.4, 0, 1), 2), bounce = Math.abs(Math.sin(t * 6)) * (1 - clamp(t / 3.4, 0, 1)) * 1.2;
      const ball = add(lerp(b0, b1, bu), V(0, -bounce));
      const Q = lerp(A(sp, 3, 7), A(sp, 5, 10), ph(t, 0, 1.2)), O = lerp(A(sp, 17, 23), add(b1, V(1.6, 1.2)), ph(t, .2, 3.6)), Hh = lerp(A(sp, -5, 9), add(b1, V(-1.2, -.6)), ph(t, 0, 3.2));
      drawO(v, O, { label: 'them' }); drawX(v, Q, C.soft, { label: t > 1.2 ? '"it\'s over..."' : '' }); drawX(v, Hh, C.start, { label: 'YOU' });
      drawBall(v, ball, 1, false);
      if (t > 3.3) tag(v, 'OURS!', add(b1, V(-2, -3.6)), C.start, ph(t, 3.3, 3.6), v.fs + 10);
      const y = h - 18, x0 = 24, x1 = w - 24, wx = x0 + (x1 - x0) * (4.4 / 5.2);
      line(v.ctx, x0, y, x1, y, { col: C.ink, w: 3, passes: 1, j: 0 });
      line(v.ctx, x0, y, x0 + (x1 - x0) * clamp(t / 5.2, 0, 1), y, { col: C.start, w: 7, passes: 1, j: 0 });
      txt(v.ctx, 'WHISTLE', wx, y - 14, { size: v.fs - 1, font: 'pop', col: C.stop, align: 'center' });
      line(v.ctx, wx, y - 7, wx, y + 7, { col: C.stop, w: 3, passes: 1, j: 0 });
      if (t > 4.4) tag(v, 'TWEET!', A(sp, -10, 18), C.stop, ph(t, 4.4, 4.6));
    }
  },
};

export function drawScene(id, ctx, w, h, t, sp, view) {
  const S = SCENES[id];
  const v = view; v.fs = clamp(w / 40, 11, 18);
  ctx.save(); ctx.fillStyle = C.field; ctx.fillRect(0, 0, w, h); ctx.restore();
  if (id !== 'loose') sp.draw(v);
  S.draw(v, t, sp, w, h);
}
export const stepsFor = (id, sp) => SCENES[id].steps(sp).map(([t, s]) => [t, fill(s, sp)]);
