import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { POSITIONS, readPlayer } from '../field/positions.js';
import { SPORTS } from '../field/sports.js';
import { useLibrary, ideasFor } from '../field/ideas.js';
import { parseTranscript } from '../field/parse.js';
import { extractOffline } from '../field/extract.js';

assert.deepEqual(Object.keys(SPORTS), ['lacrosse']);
assert.deepEqual(Object.keys(POSITIONS), ['lacrosse']);
assert.equal(readPlayer('I play lax, I am a pole').position, 'defense');
assert.equal(readPlayer('goalie').position, 'goalie');

const lib = JSON.parse(await readFile(new URL('../data/ideas.lacrosse.json', import.meta.url), 'utf8'));
useLibrary(lib);
assert.equal(Object.keys(lib.sports).join(','), 'lacrosse');
assert.ok(ideasFor('lacrosse', 'defense').length >= 5);

const raw = await readFile(new URL('../samples/lacrosse.txt', import.meta.url), 'utf8');
const parsed = parseTranscript(raw);
const update = extractOffline(parsed.lines, 'lacrosse', 'defense');
assert.ok(update.items.length >= 3 && update.items.length <= 7);
const concepts = new Set(update.items.map(item => item.concept));
assert.equal(concepts.size, update.items.length);

const links = JSON.parse(await readFile(new URL('../data/links.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const ids = new Set(catalog.map(item => item.id));
for (const concept of ['help', 'slide', 'talk', 'angle', 'pick', 'danger', 'double', 'loose', 'hold', 'disguise', 'hustle']) {
  assert.ok(ids.has(links[concept]), `${concept} -> ${links[concept]}`);
}
const videos = catalog.filter(item => item.type === 'video');
assert.ok(videos.length >= 500, `expected 500 videos, got ${videos.length}`);
for (const item of videos) {
  assert.match(item.youtubeId, /^[A-Za-z0-9_-]{11}$/);
  assert.equal(item.badge, '50% Still Frame');
  assert.ok(!/human vouch/i.test(item.curatorNote || ''));
}
const shelf = catalog.filter(item => item.type !== 'video');
for (const item of shelf) {
  assert.ok(item.badge === 'Archive scan' || item.badge === 'Source page');
  assert.ok(!/printable pdf/i.test(item.duration || ''));
}
console.log(`field ok · ${videos.length} videos · ${shelf.length} source cards · ${update.items.length} defense frames`);
