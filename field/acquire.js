// Acquisition rules. A coaching meeting is mostly noise: screen sharing, "right?", rewinds,
// guessing who is on screen, caption repeats. Keep a sentence only when it carries one of:
//   PLAY     - an action on the field (a concept keyword or a sport play word)
//   MEASURE  - a number you can see on the field: yards, seconds, passes, "4-on-3"
//   CALL     - a call players say out loud ("over", "help", "I got ball", "talk")
// Everything else is NOISE and never reaches the board.
import { CONCEPTS } from './concepts.js';
import { SPORTS } from './sports.js';
import { sentences } from './parse.js';

const NUM = '(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty)';
const MEASURES = [
  new RegExp(`\\b${NUM}[- ]on[- ]${NUM}\\b`, 'gi'),
  new RegExp(`\\b\\d+\\s?(?:v|x|vs)\\s?\\d+\\b`, 'gi'),
  new RegExp(`\\b${NUM}(?:\\s*,\\s*${NUM})*\\s*(?:yards?|yds?|feet|foot|ft|meters?|metres?|seconds?|secs?|passes|steps|strides|shots)\\b(?!\\s*chance)`, 'gi'),
];
const CALLS = /("|“)?\b(over,? over|help!?|switch!?|i got (ball|him|her|it|this one)|i'?m leaving|ball!|check!|hot!|fill!|screen (left|right)|mine!|bump|talk(ing)?|call (it|out)|yell(ing)?|communicat\w*|let us know)\b/i;
const NOISE = [
  /\b(can (everyone|you all|you) see|share my screen|next clip|rewind|pause (it|this|that)|go back|hold on a sec|play it again|let me (find|pull)|is this playing|you'?re on mute|unmute)\b/i,
  /\b(i (don'?t )?(know|think) (who|that'?s)|sorry if it'?s not|i think this is|i think that'?s)\b/i,
  /^(right|okay|ok|yeah|yes|um+|uh+|so|alright|all right|good|fine)[?.!]*$/i,
];
const PLAY_WORDS = /\b(slide|rotate|rotation|dodge|dodger|drive|cut|cutter|pick|screen|switch|double|trap|press|clear|save|shot|shoot|pass|skip|feed|crease|cage|goal|net|rim|paint|slot|box|backside|topside|top side|on ball|off ball|ground ball|rebound|loose|tackle|pursuit|block|mark|cover|man|matchup|match up|help|recover|close ?out|approach|angle|hips|feet|stick|hands|check|gap|lane|line|wall|hold|engage|break down|sprint|whistle|stop)\b/i;

export function measurementsIn(text) {
  const out = new Set();
  for (const re of MEASURES) for (const m of text.matchAll(re)) out.add(m[0].replace(/\s+/g, ' ').trim());
  return [...out];
}

export function acquire(lines, sportId) {
  const sp = SPORTS[sportId], sportWords = new RegExp(`\\b(${sp.detect.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  const all = sentences(lines), kept = [], stats = { heard: lines.length, unique: all.length, play: 0, measure: 0, call: 0, noise: 0 };
  for (const s of all) {
    const t = s.text, words = t.split(/\s+/).length;
    const measures = measurementsIn(t);
    const call = CALLS.test(t);
    const play = PLAY_WORDS.test(t) || sportWords.test(t) || Object.values(CONCEPTS).some(c => c.keys.some(k => t.toLowerCase().includes(k.replace('~', ''))));
    const noise = NOISE.some(re => re.test(t)) || (words < 3 && !call && !PLAY_WORDS.test(t));
    if (noise || !(play || measures.length || call)) { stats.noise++; continue; }
    const kinds = []; if (play) kinds.push('play'); if (measures.length) kinds.push('measure'); if (call) kinds.push('call');
    kinds.forEach(k => stats[k]++);
    kept.push({ ...s, kinds, measures });
  }
  stats.kept = kept.length;
  return { kept, stats };
}
