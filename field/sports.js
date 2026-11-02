// Lacrosse field only. Diagrams are drawn in one shared space: the cage can have play behind it.
import { V, C, line, circle, txt } from './ink.js';

const gle = (v, label) => {
  line(v.ctx, v.X(-22), v.Y(0), v.X(22), v.Y(0), { col: C.soft, w: 1.2, dash: [6, 6], passes: 1, j: 0, alpha: .8 });
  if (label) txt(v.ctx, label, v.X(-19.3), v.Y(0) - 10, { size: v.fs - 2, col: C.soft, font: 'body' });
};
const net = (v, w, back) => {
  const ctx = v.ctx, [lx, ly] = v.P(V(-w, 0)), [rx, ry] = v.P(V(w, 0)), [bx, by] = v.P(V(0, -back));
  ctx.save(); ctx.globalAlpha = .18; ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(bx, by); ctx.lineTo(rx, ry); ctx.closePath(); ctx.fill(); ctx.restore();
  line(ctx, lx, ly, bx, by, { col: C.ink, w: 1.2, passes: 1, j: .3 }); line(ctx, rx, ry, bx, by, { col: C.ink, w: 1.2, passes: 1, j: .3 });
  line(ctx, lx, ly, rx, ry, { col: C.ink, w: 4, passes: 1, j: 0 });
};

export const SPORTS = {
  lacrosse: {
    name: 'Lacrosse', goal: 'cage', ball: 'ball', loose: 'ground ball', zone: 'crease', pass: 'skip pass', weak: 'short stick',
    mouth: 1, behind: true, side: -20,
    detect: ['crease', 'ground ball', 'short stick', 'long pole', 'cage', 'slide', 'gle', 'clear', 'pole', 'dodge', 'lacrosse', 'stick'],
    draw(v) {
      gle(v, 'G.L.E.'); circle(v.ctx, v.X(0), v.Y(0), 3 * v.s, { col: C.ink, w: 1.6, seed: 31, alpha: .85 }); net(v, 1, 2);
      line(v.ctx, v.X(-20), v.Y(20), v.X(20), v.Y(20), { col: C.soft, w: 1.2, alpha: .55, passes: 1 });
      line(v.ctx, v.X(-20), v.Y(-6), v.X(-20), v.Y(24), { col: C.ink, w: 3, passes: 1, j: .6 }); line(v.ctx, v.X(20), v.Y(-6), v.X(20), v.Y(24), { col: C.ink, w: 3, passes: 1, j: .6 });
    }
  },
};

export function detectSport() { return 'lacrosse'; }

// Scenes are written for a field where play can happen behind the cage.
export function adapt(sp, p) { return sp.behind ? p : V(p.x, 1.2 + (p.y + 6) * (22.8 / 30)); }
export function sideOf(sp) { return sp.side; }
export const fill = (s, sp) => s.replace(/\{(\w+)\}/g, (_, k) => sp[k] ?? k);
