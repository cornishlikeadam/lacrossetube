// Lacrosse positions. `w` weights each idea so the update leads with what that player needs.
const P = (id, label, you, say, w) => ({ id, label, you, say, w });

export const POSITIONS = {
  lacrosse: [
    P('defense', 'Defense', 'defender', ['defense', 'defender', 'd', 'close d', 'pole', 'long pole', 'defenseman'], { help: 3, slide: 3, talk: 3, angle: 3, pick: 2, danger: 2, double: 2, loose: 2, hold: 2, disguise: 1, hustle: 1 }),
    P('lsm', 'Long-stick middie', 'LSM', ['lsm', 'long stick middie', 'long-stick midfielder', 'long stick'], { loose: 3, double: 3, slide: 2, angle: 2, help: 2, hustle: 2, talk: 2, hold: 2, pick: 1, danger: 1, disguise: 1 }),
    P('midfield', 'Midfield', 'middie', ['midfield', 'middie', 'midfielder', 'mid', 'ssdm', 'short stick'], { hustle: 3, loose: 3, disguise: 3, slide: 2, talk: 2, help: 2, pick: 2, angle: 2, hold: 2, double: 1, danger: 1 }),
    P('attack', 'Attack', 'attackman', ['attack', 'attackman', 'attacker', 'a'], { hustle: 3, loose: 3, talk: 2, danger: 2, double: 2, angle: 1, pick: 1, help: 1, slide: 1, hold: 1, disguise: 1 }),
    P('goalie', 'Goalie', 'goalie', ['goalie', 'goalkeeper', 'keeper', 'g'], { talk: 3, danger: 3, hold: 2, slide: 2, help: 2, loose: 2, pick: 1, angle: 1, double: 1, disguise: 1, hustle: 1 }),
  ],
};

// "I'm a pole" -> lacrosse defense. The film room is lacrosse-only, so other sports never match.
export function readPlayer(text) {
  const t = ' ' + text.toLowerCase().replace(/[^a-z0-9\- ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let hit = null;
  for (const p of POSITIONS.lacrosse) for (const w of p.say) {
    if (t.includes(' ' + w + ' ') && (!hit || w.length > hit.len)) hit = { sport: 'lacrosse', position: p.id, len: w.length };
  }
  return { sport: 'lacrosse', position: hit?.position || null };
}
export const positionOf = (sport, id) => POSITIONS.lacrosse.find(p => p.id === id) || POSITIONS.lacrosse[0];
