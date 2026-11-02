// Drawing kit: vectors, seeded wobble, marker ink, spray paint, pop-art players.
export const V = (x, y) => ({ x, y });
export const add = (a, b) => V(a.x + b.x, a.y + b.y);
export const sub = (a, b) => V(a.x - b.x, a.y - b.y);
export const mul = (a, k) => V(a.x * k, a.y * k);
export const len = a => Math.hypot(a.x, a.y);
export const dist = (a, b) => len(sub(a, b));
export const norm = a => { const l = len(a) || 1; return V(a.x / l, a.y / l); };
export const lerp = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const ease = t => { t = clamp(t, 0, 1); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const ph = (t, a, b) => ease((t - a) / ((b - a) || 1));
export const deg = r => r * 180 / Math.PI;
export const GOAL = V(0, 0);

export function closestOnSeg(p, a, b) {
  const ab = sub(b, a), L2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2, 0, 1);
  return add(a, mul(ab, t));
}
export const segDist = (p, a, b) => dist(p, closestOnSeg(p, a, b));
export function angBetween(a, b) {
  let d = Math.abs(Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  return d > Math.PI ? 2 * Math.PI - d : d;
}
export function mouthAngle(p, w) {
  if (p.y <= 0.05) return 0;
  const a = Math.atan2(-p.y, -w - p.x), b = Math.atan2(-p.y, w - p.x);
  let d = Math.abs(a - b); return d > Math.PI ? 2 * Math.PI - d : d;
}
export function kf(frames, t) {
  if (typeof frames === 'function') return frames(t);
  if (t <= frames[0][0]) return V(frames[0][1], frames[0][2]);
  for (let i = 1; i < frames.length; i++) {
    const f1 = frames[i];
    if (t <= f1[0]) { const f0 = frames[i - 1]; const u = ease((t - f0[0]) / ((f1[0] - f0[0]) || 1)); return V(f0[1] + (f1[1] - f0[1]) * u, f0[2] + (f1[2] - f0[2]) * u); }
  }
  const l = frames[frames.length - 1]; return V(l[1], l[2]);
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export const FONT = {
  hand: '"Russo One", "Arial Black", sans-serif',
  pop: '"Anton", Impact, "Arial Narrow", sans-serif',
  body: '"Atkinson Hyperlegible", "Trebuchet MS", sans-serif',
};
export let C = {};
export function readColors() {
  const s = getComputedStyle(document.documentElement), g = n => s.getPropertyValue(n).trim();
  C = { ink: g('--ink'), soft: g('--ink-soft'), faint: g('--ink-faint'), paper: g('--paper'), field: g('--field'),
        start: g('--start'), stop: g('--stop'), cont: g('--cont'), pink: g('--pink'), gold: g('--gold'), green: g('--green') };
}

export function line(ctx, ax, ay, bx, by, o = {}) {
  const { w = 1.6, col = C.ink, j = 1.1, passes = 2, seed = 1, alpha = 1, dash = null } = o;
  if (alpha <= 0) return;
  const r = rng(seed);
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = col; ctx.lineCap = 'round'; if (dash) ctx.setLineDash(dash);
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  for (let p = 0; p < passes; p++) {
    ctx.lineWidth = w * (p ? .55 : 1);
    const o1 = (r() - .5) * j, o2 = (r() - .5) * j, mo = (r() - .5) * j * 1.6;
    ctx.beginPath(); ctx.moveTo(ax + nx * o1, ay + ny * o1);
    ctx.quadraticCurveTo((ax + bx) / 2 + nx * mo, (ay + by) / 2 + ny * mo, bx + nx * o2, by + ny * o2); ctx.stroke();
  }
  ctx.restore();
}
export function circle(ctx, cx, cy, R, o = {}) {
  const { w = 1.4, col = C.ink, j = 1, passes = 2, seed = 3, frac = 1, alpha = 1, fill = null, fillAlpha = 1, dash = null, a0: start = null } = o;
  if (alpha <= 0) return;
  const r = rng(seed);
  ctx.save(); ctx.globalAlpha *= alpha;
  if (fill) { ctx.save(); ctx.globalAlpha *= fillAlpha; ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, Math.max(0, R), 0, 7); ctx.fill(); ctx.restore(); }
  ctx.strokeStyle = col; ctx.lineCap = 'round'; if (dash) ctx.setLineDash(dash);
  for (let p = 0; p < passes; p++) {
    ctx.lineWidth = w * (p ? .55 : 1);
    const a0 = start != null ? start : r() * 6.283, dr = (r() - .5) * j, n = 56, sweep = 6.283 * frac * (p ? 1.03 : 1);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const a = a0 + sweep * i / n, rr = Math.max(0, R + dr * Math.sin(a * 2 + p)); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
  ctx.restore();
}
export function spray(ctx, pts, col, w = 6, seed = 7, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha * .9; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = col; ctx.shadowBlur = w * 1.2;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = col;
  const r = rng(seed);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; const n = Math.min(70, Math.hypot(bx - ax, by - ay) / 2.5 | 0);
    for (let k = 0; k < n; k++) { const t = r(), an = r() * 6.283, d = w * (.7 + r() * 1.5); ctx.globalAlpha = alpha * .5 * r(); ctx.fillRect(ax + (bx - ax) * t + Math.cos(an) * d, ay + (by - ay) * t + Math.sin(an) * d, 1.4, 1.4); }
  }
  ctx.restore();
}
export function arrowHead(ctx, ax, ay, bx, by, col, size = 10, alpha = 1, w = 2.6) {
  if (alpha <= 0) return;
  const a = Math.atan2(by - ay, bx - ax);
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(bx - Math.cos(a - .45) * size, by - Math.sin(a - .45) * size); ctx.lineTo(bx, by); ctx.lineTo(bx - Math.cos(a + .45) * size, by - Math.sin(a + .45) * size); ctx.stroke(); ctx.restore();
}
export function txt(ctx, s, x, y, o = {}) {
  const { size = 13, col = C.ink, font = 'hand', align = 'left', base = 'middle', alpha = 1, rot = 0, stroke = null } = o;
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = col;
  ctx.font = `${font === 'body' ? '700 ' : ''}${size}px ${FONT[font] || FONT.hand}`;
  ctx.textAlign = align; ctx.textBaseline = base; ctx.translate(x, y); ctx.rotate(rot);
  if (stroke) { ctx.lineWidth = Math.max(3, size / 5); ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(s, 0, 0); }
  ctx.fillText(s, 0, 0); ctx.restore();
}
export function hatch(ctx, x, y, w, h, col, gap = 5, alpha = .8) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.strokeStyle = col; ctx.globalAlpha *= alpha; ctx.lineWidth = 1.2;
  ctx.beginPath(); for (let k = -h; k < w; k += gap) { ctx.moveTo(x + k, y); ctx.lineTo(x + k + h, y + h); } ctx.stroke(); ctx.restore();
}
export function crown(ctx, x, y, s, col, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, s / 8); ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x - s, y + s * .5); ctx.lineTo(x - s, y - s * .3); ctx.lineTo(x - s * .5, y + s * .05); ctx.lineTo(x, y - s * .6);
  ctx.lineTo(x + s * .5, y + s * .05); ctx.lineTo(x + s, y - s * .3); ctx.lineTo(x + s, y + s * .5); ctx.closePath(); ctx.stroke(); ctx.restore();
}

// Canonical diagram space: x in [-20, 20], y in [-6, 24], the target ("goal") at the origin, up-field is down the screen.
export const VIEW = { x0: -20, x1: 20, y0: -6, y1: 24 };
export class View {
  constructor(ctx, w, vw = VIEW) { this.ctx = ctx; this.w = w; this.vw = vw; this.s = w / (vw.x1 - vw.x0); this.fs = clamp(w / 40, 11, 18); }
  X(x) { return (x - this.vw.x0) * this.s; } Y(y) { return (y - this.vw.y0) * this.s; }
  P(p) { return [this.X(p.x), this.Y(p.y)]; }
}
const rad = v => Math.max(7, .7 * v.s);
// A marker's label sits on its right. If that would run off the canvas (small phone frames), it
// sits centered under the marker instead, kept inside the canvas.
function side(v, label, x, gap) {
  v.ctx.save(); v.ctx.font = `${v.fs}px ${FONT.hand}`; const w = v.ctx.measureText(label).width; v.ctx.restore();
  return x + gap + w <= v.w - 2 ? { x: x + gap, align: 'left', under: false } : { x: Math.min(x, v.w - 2 - w / 2), align: 'center', under: true };
}
export function drawO(v, p, o = {}) {
  const [x, y] = v.P(p), r = rad(v);
  circle(v.ctx, x, y, r, { col: o.col || C.ink, w: o.w || 2.2, seed: o.seed || 5, fill: o.fill || C.paper, j: .8, alpha: o.alpha ?? 1 });
  if (o.label) { const l = side(v, o.label, x, r + 4); txt(v.ctx, o.label, l.x, l.under ? y + r + 9 : y - r * .9, { size: v.fs, col: o.lcol || o.col || C.ink, alpha: o.alpha ?? 1, stroke: C.paper, align: l.align }); }
}
export function drawX(v, p, col, o = {}) {
  const [x, y] = v.P(p), r = rad(v) * .85 * (o.small ? .7 : 1), ctx = v.ctx;
  ctx.save(); ctx.globalAlpha *= (o.alpha ?? 1); ctx.lineCap = 'round';
  ctx.strokeStyle = C.paper; ctx.lineWidth = (o.w || 3.6) + 3;
  ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = o.w || 3.6;
  ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); ctx.restore();
  // o.left puts the label above and to the left, for when an O's label already sits to the right.
  if (!o.label) return;
  const l = o.left ? { x: x - r - 5, align: 'right' } : side(v, o.label, x, r + 5);
  txt(ctx, o.label, l.x, o.left ? y - r - 7 : l.under ? y + r + 9 : y + r + 7, { size: v.fs, col, alpha: o.alpha ?? 1, stroke: C.paper, align: l.align });
}
export function drawBall(v, p, alpha = 1, off = true) {
  const q = off ? add(p, V(.6, -.6)) : p, [x, y] = v.P(q), ctx = v.ctx;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = C.gold; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, Math.max(4, .32 * v.s), 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
}
export function wedge(v, p, w, col, alpha = .25) {
  if (p.y <= .05 || alpha <= 0) return;
  const ctx = v.ctx, [x, y] = v.P(p), [lx, ly] = v.P(V(-w, 0)), [rx, ry] = v.P(V(w, 0));
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(lx, ly); ctx.lineTo(rx, ry); ctx.closePath(); ctx.fill(); ctx.restore();
  line(ctx, x, y, lx, ly, { col, w: 1.6, passes: 1, j: .3, alpha: Math.min(1, alpha * 4) });
  line(ctx, x, y, rx, ry, { col, w: 1.6, passes: 1, j: .3, alpha: Math.min(1, alpha * 4) });
}
export function wrapText(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
