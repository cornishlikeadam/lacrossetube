// One What Coach Said game at a time on one canvas, like the player app's frames in game mode.
// Used by the placement round (tier 1) and the Game Day tier (tier 3).
import { C, View, VIEW, clamp } from '../field/ink.js';
import { SPORTS } from '../field/sports.js';
import { gameFor, banner, XP } from '../field/games.js';

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const ASPECT = (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0);
const sp = SPORTS.lacrosse;

export class Round {
  constructor(cv, item, onResult) {
    Object.assign(this, { cv, ctx: cv.getContext('2d'), item, onResult, w: 0, gt: 0, last: 0, raf: 0, game: gameFor(item, sp), doneAt: null });
    new ResizeObserver(() => this.resize()).observe(cv);
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointerup', () => this.game.up?.(this.gt));
    cv.addEventListener('pointercancel', () => this.game.up?.(this.gt));
    this.last = performance.now(); this.raf = requestAnimationFrame(n => this.tick(n));
  }
  resize() { const w = this.cv.clientWidth; if (!w || w === this.w) return; this.w = w; this.h = Math.round(w * ASPECT); this.cv.style.height = this.h + 'px'; this.cv.width = Math.round(w * DPR); this.cv.height = Math.round(this.h * DPR); }
  field(e) { const r = this.cv.getBoundingClientRect(), s = r.width / (VIEW.x1 - VIEW.x0); return { p: { x: (e.clientX - r.left) / s + VIEW.x0, y: (e.clientY - r.top) / s + VIEW.y0 }, sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  tick(now) {
    this.gt += clamp((now - this.last) / 1000, 0, .1); this.last = now;
    if (this.w) {
      const ctx = this.ctx; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = C.field; ctx.fillRect(0, 0, this.w, this.h);
      const v = new View(ctx, this.w); sp.draw(v); this.game.draw(ctx, v, this.w, this.h, this.gt);
      if (this.game.result) {
        if (this.doneAt == null) { this.doneAt = this.gt; this.onResult(this.game.result.g); }
        if (this.gt - this.doneAt > .5) banner(ctx, this.w, this.h, this.game.result.g, this.game.result.msg, XP[this.game.result.g]);
      }
    }
    if (this.doneAt == null || this.gt - this.doneAt < 1.5) this.raf = requestAnimationFrame(n => this.tick(n));
  }
  down(e) {
    if (this.game.result) return;
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* not all pointers capture */ }
    const f = this.field(e); this.game.down(f.p, f.sx, f.sy, this.gt);
  }
  stop() { cancelAnimationFrame(this.raf); }
}

