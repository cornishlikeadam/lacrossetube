const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function app() {
  const memory = new Map();
  const storage = { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
  const context = vm.createContext({ window: { localStorage: storage }, TextEncoder, TextDecoder, Uint8Array, Blob, Response, CompressionStream, DecompressionStream, btoa, atob, URL });
  for (const file of ['assessment', 'marks', 'player-clock']) vm.runInContext(fs.readFileSync(`js/${file}.js`, 'utf8'), context);
  return { ...context, memory, storage };
}
test('timestamped notes round-trip without changing the ID-only Locker', () => {
  const { LT, memory } = app();
  memory.set('lacrossetube_vault', '["yt-film"]');
  LT.setMarks('yt-film', [{ t: 83.25, text: '  Recover inside  ', skill: 'slide', by: 'Alex' }]);
  assert.equal(LT.marksFor('yt-film')[0].t, 83.3);
  assert.equal(LT.marksFor('yt-film')[0].by, 'Alex');
  assert.equal(memory.get('lacrossetube_vault'), '["yt-film"]');
  assert.equal(LT.cleanMark({ t: -1, text: 'bad' }), null);
  assert.equal(LT.cleanMark({ t: 28801, text: 'bad' }), null);
  assert.equal(LT.cleanMark({ t: 20, text: ' ' }), null);
});
test('shared notes merge and deduplicate; existing notes survive', () => {
  const { LT } = app();
  const first = { t: 1, text: 'Existing', skill: 'slide', by: 'A' };
  LT.setMarks('yt-film', [first]);
  LT.mergeMarks('yt-film', [first, { t: 2, text: 'Shared' }]);
  assert.equal(LT.marksFor('yt-film').length, 2);
  assert.equal(LT.marksFor('yt-film')[0].text, 'Existing');
});
test('malformed storage, prototype IDs, unsupported tags and large imports are handled', () => {
  const { LT, memory } = app();
  memory.set('lacrossetube_marks', '{bad');
  assert.equal(LT.allMarksCount(), 0);
  assert.equal(LT.cleanSharedMarks({ v: 1, itemId: '__proto__', marks: [] }), null);
  assert.equal(LT.cleanMark({ t: 1, text: 'Test', skill: '<script>' }).skill, '');
  LT.setMarks('film', Array.from({ length: 40 }, (_, n) => ({ t: n, text: 'Note ' + n })));
  assert.throws(() => LT.mergeMarks('film', [{ t: 41, text: 'extra' }]), /40-mark/);
  assert.equal(LT.marksFor('film').length, 40);
});
test('quota failures are reported instead of claiming a save', () => {
  const { LT, storage } = app();
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => LT.setMarks('film', [{ t: 1, text: 'note' }]), /could not save/);
});
test('marks and practices survive compressed hash sharing, including Unicode', async () => {
  const { LT } = app();
  const payload = { v: 1, itemId: 'yt-film', marks: [{ t: 83, text: 'Keep space — après 🥍', by: 'Coach' }] };
  const token = await LT.pack(payload);
  const shared = await LT.readHash('#m=' + token);
  assert.equal(shared.data.marks[0].text, payload.marks[0].text);
  const practice = { v: 1, title: 'Warmup', steps: [{ itemId: 'yt-film', t: 83, why: 'Recover' }] };
  assert.equal((await LT.readHash('#p=' + await LT.pack(practice))).data.steps[0].t, 83);
  assert.equal(await LT.readHash('#m=' + token + '!'), null);
  assert.equal(await LT.readHash('#m=jnot-json'), null);
});
test('decompression stops before accepting an oversized expanded payload', async () => {
  const { LT } = app();
  const encoded = new TextEncoder().encode(JSON.stringify({ text: 'x'.repeat(120000) }));
  const bytes = new Uint8Array(await new Response(new Blob([encoded]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const token = 'z' + Buffer.from(bytes).toString('base64url');
  await assert.rejects(() => LT.unpack(token), /too large/);
});
test('only the current YouTube iframe can supply the film clock', () => {
  const { LT_CLOCK } = app();
  const player = {};
  const frame = { src: 'https://www.youtube-nocookie.com/embed/abcdefghijk', contentWindow: player };
  const event = { origin: 'https://www.youtube-nocookie.com', source: player, data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 83.3 } }) };
  assert.equal(LT_CLOCK.readMessage(event, frame).time, 83.3);
  assert.equal(LT_CLOCK.readMessage({ ...event, source: {} }, frame), null);
  assert.equal(LT_CLOCK.readMessage({ ...event, origin: 'https://evil.example' }, frame), null);
  assert.equal(LT_CLOCK.readMessage({ ...event, data: '{bad' }, frame), null);
  assert.equal(LT_CLOCK.readMessage({ ...event, data: { event: 'infoDelivery', info: { currentTime: -5 } } }, frame).time, null);
});
test('optional checks bias review topics; correct or skipped answers do not invent weaknesses', () => {
  const { LT_ASSESSMENT: A, LT } = app();
  assert.equal(A.evaluate({}).answered, 0);
  assert.equal(A.evaluate({ recovery: 0 }).priorities[0], 'slides');
  assert.equal(A.evaluate({ recovery: 1 }).priorities.length, 0);
  const defender = { title: 'Adjacent slide recovery', category: 'defense' };
  const stick = { title: 'Sidewall knots', category: 'pockets' };
  const profile = { focus: 'all', format: 'both', answers: { recovery: 0 } };
  assert.ok(A.score(defender, profile) > A.score(stick, profile));
  LT.saveProfile({ ...profile, position: 'goalie' });
  assert.equal(LT.loadProfile().answers.recovery, 0);
  LT.saveProfile(null);
  assert.equal(LT.loadProfile(), null);
});
