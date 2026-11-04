// What counts as watching: seconds in which the film's own clock moved forward at about the speed
// of the wall clock, in a visible tab. Paused, buffering, rewound, skipped ahead, or a hidden tab
// counts nothing, and nothing counts across a gap in the player's reports. Pure, so it is tested
// on its own (tests/phase2-ui.test.mjs); core/film-earn.js feeds it the YouTube player's reports.
export function filmCounter() {
  let film = null, lastT = null, lastWall = 0;
  return {
    // id: the film; t: the film's time (seconds); now: wall time (ms); visible: the tab is in front.
    // Returns the seconds to count for this report.
    sample(id, t, now, visible) {
      if (id !== film) { film = id; lastT = null; }
      if (!visible || lastT == null) { lastT = visible ? t : null; lastWall = now; return 0; }
      const dWall = (now - lastWall) / 1000, dClock = t - lastT;
      lastT = t; lastWall = now;
      if (dWall <= 0 || dWall > 5) return 0;
      if (dClock <= 0 || dClock > dWall * 2.5 + 0.5) return 0;
      return Math.min(dClock, dWall);
    },
    reset() { lastT = null; lastWall = 0; },
    get film() { return film; },
  };
}
