// Phase 2 in the database, against a throwaway local Postgres with every migration applied
// (tests/db/pg.mjs). Skips when this machine has no Postgres server binaries.
// Covers: film minutes and games accrue under their caps (a 31st minute and an 8th game pay
// nothing), the daily ceiling, forum posts and tips (only posts take tips), paid services with a
// receipt, sending to a teammate, team pool donations, session payouts A-D, the coach
// application's state and school website, and the chain reserve/finish steps used in Phase 3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { available, startDb } from './db/pg.mjs';
import { POINTS } from '../supabase/functions/_shared/chain.js';
import { US_STATES, validWebsite } from '../supabase/functions/_shared/states.js';

const skip = available ? false : 'no local Postgres server binaries (initdb) on this machine';
let db;
before(async () => { if (!skip) db = await startDb(); });
after(async () => { await db?.stop(); });

const E = POINTS.earn;
const rewind = (p, seconds = 61) => db.sql(`update public.watch_clock set last_at = now() - make_interval(secs => $2) where person_id = $1`, [p.id, seconds]);
const beat = (p, film, seconds = 60) => db.call(p, 'watch_beat', { p_film: film, p_seconds: seconds });
const balance = async p => (await db.call(p, 'wallet_home')).points;
const give = (p, points, level = 5) => db.sql(`insert into public.warrior_progress (person_id, level, best_score, attempts, passed_at, points) values ($1, $2, 5, 1, now(), $3)`, [p.id, level, points]);
const err = re => e => { assert.match(e.message, re); return true; };

test('the database and chain.js agree on the rules', { skip }, async () => {
  const [{ r }] = await db.sql('select public.earn_rules() as r');
  assert.deepEqual(r.payout, POINTS.payout);
  for (const k of Object.keys(E)) assert.equal(r[k], E[k], k);
  assert.ok(E.perMinute * E.maxMinutes + E.perGame * E.maxGames <= E.dailyCap);
  assert.equal(E.perMinute * E.maxMinutes, 15000);
  assert.equal(E.perGame * E.maxGames, 7000);
});

test('a film minute pays 500 points; the 31st minute pays nothing; beats never outrun the clock on the wall', { skip }, async () => {
  const t = await db.team(), p = await db.player(t);
  let r = await beat(p, 'yt-bw8KCj1uzNA', 30);
  assert.equal(r.points_added, 0, 'half a minute is not a minute yet');
  await rewind(p, 31);
  r = await beat(p, 'yt-bw8KCj1uzNA', 30);
  assert.equal(r.points_added, E.perMinute);
  assert.equal(await balance(p), 500);

  const fast = await beat(p, 'yt-bw8KCj1uzNA', 60);
  assert.ok(fast.credited <= 1, 'a beat right after another is credited only the real seconds between them');
  await assert.rejects(beat(p, 'yt-bw8KCj1uzNA', 61), err(/1 to 60 seconds/));
  await assert.rejects(beat(p, 'bad film id!', 10), err(/Unknown film/));

  for (let m = 2; m <= 30; m++) { await rewind(p); await beat(p, 'yt-bw8KCj1uzNA', 60); }
  const day = (await db.call(p, 'wallet_home')).today;
  assert.equal(day.minutes_paid, 30);
  assert.equal(day.watch_points, 15000);
  await rewind(p);
  const extra = await beat(p, 'yt-bw8KCj1uzNA', 60);
  assert.equal(extra.credited, 60, 'the 31st minute is still counted as watched');
  assert.equal(extra.points_added, 0, 'but it pays nothing');
  assert.equal(await balance(p), 15000);
  const [{ seconds }] = await db.sql(`select sum(seconds)::int as seconds from public.film_watch where person_id = $1`, [p.id]);
  assert.ok(seconds >= 31 * 60, 'film seconds keep counting for a coach\'s "watched the film" payout');
});

test('a finished game pays 1,000 points once; the 8th game of the day pays nothing and is not used up', { skip }, async () => {
  const t = await db.team(), p = await db.player(t);
  const play = key => db.call(p, 'game_complete', { p_key: key, p_concept: 'slide', p_grade: 'good' });
  for (let i = 1; i <= 7; i++) assert.equal((await play(`idea-${i}`)).points_added, E.perGame);
  assert.equal((await play('idea-1')).reason, 'again', 'the first finish pays; replaying it does not');
  const eighth = await play('idea-8');
  assert.equal(eighth.points_added, 0);
  assert.equal(eighth.reason, 'cap');
  assert.equal(await balance(p), 7000);
  await db.sql(`update public.earn_days set day = day - 1 where person_id = $1`, [p.id]);
  assert.equal((await play('idea-8')).points_added, E.perGame, 'the 8th game pays when finished another day');
  await assert.rejects(play('bad key with spaces'), err(/Unknown game/));
});

test('the daily ceiling is room, not a payout, and Warrior points sit outside it', { skip }, async () => {
  const t = await db.team(), p = await db.player(t);
  await give(p, 50000);
  await db.sql(`insert into public.earn_days (person_id, day, games, game_points) values ($1, public.earn_day(), 0, $2)`, [p.id, E.dailyCap - 200]);
  await rewind(p);
  const r = await beat(p, 'yt-W4ka4tBYWoI', 60);
  assert.equal(r.points_added, 200, 'a minute pays only what is left under the ceiling');
  assert.equal(r.points_today, E.dailyCap);
  assert.equal(await balance(p), 50000 + E.dailyCap);
  await db.sql(`delete from public.earn_days where person_id = $1`, [p.id]);
  await rewind(p);
  assert.equal((await beat(p, 'yt-W4ka4tBYWoI', 60)).points_added, E.perMinute, 'a Warrior payout does not use up the daily ceiling');
});

test('forum: text, photo or clip; no YouTube link; tips move site balance to the author; only posts take tips', { skip }, async () => {
  const a = await db.team(), b = await db.team();
  const author = await db.player(a, 'Riley'), fan = await db.player(b, 'Morgan');
  await give(fan, 1000);
  const id = await db.call(author, 'forum_post', { p_body: 'Wall ball, 300 reps a day. Week 3.' });
  for (const body of ['watch https://www.youtube.com/watch?v=bw8KCj1uzNA', 'https://youtu.be/bw8KCj1uzNA', 'YOUTUBE.COM/@x']) {
    await assert.rejects(db.call(author, 'forum_post', { p_body: body }), err(/film library/));
  }
  const photo = `${author.id}/${crypto.randomUUID()}.jpg`;
  await assert.rejects(db.call(author, 'forum_post', { p_body: '', p_media_path: photo, p_media_kind: 'photo' }), err(/upload did not finish/));
  await db.as(author, q => q(`insert into storage.objects (bucket_id, name) values ('forum', $1)`, [photo]));
  await assert.rejects(db.as(author, q => q(`insert into storage.objects (bucket_id, name) values ('forum', $1)`, [`${fan.id}/${crypto.randomUUID()}.jpg`])), /row-level security/);
  await db.call(author, 'forum_post', { p_body: '', p_media_path: photo, p_media_kind: 'photo' });
  const clip = `${author.id}/${crypto.randomUUID()}.mp4`;
  await db.sql(`insert into storage.objects (bucket_id, name) values ('forum', $1)`, [clip]);
  await assert.rejects(db.call(author, 'forum_post', { p_body: 'clip', p_media_path: clip, p_media_kind: 'photo' }), /media_kind_matches/);
  await db.call(author, 'forum_post', { p_body: 'My shot, slowed down.', p_media_path: clip, p_media_kind: 'clip' });

  const feed = await db.call(fan, 'forum_feed', {});
  assert.equal(feed.length >= 3, true);
  assert.equal(feed.find(f => f.id === id).author.display_name, 'Riley Q.', 'members who are not teammates still see the author\'s name');

  const tip = await db.call(fan, 'post_tip', { p_post: id, p_points: 250 });
  assert.equal(tip.kind, 'tip'); assert.equal(tip.settle, 'site');
  assert.equal(await balance(fan), 750);
  assert.equal(await balance(author), 250);
  assert.equal((await db.call(fan, 'forum_feed', {})).find(f => f.id === id).tips, 250);
  await assert.rejects(db.call(author, 'post_tip', { p_post: id, p_points: 10 }), err(/own post/));
  await assert.rejects(db.call(fan, 'post_tip', { p_post: id, p_points: 5000 }), err(/You have 750 points/));
  // A YouTube card is a catalog id, not a forum post: nothing to tip.
  await assert.rejects(db.as(fan, q => q(`select public.post_tip('yt-bw8KCj1uzNA', 10)`)), /uuid/);
  await assert.rejects(db.call(fan, 'post_tip', { p_post: crypto.randomUUID(), p_points: 10 }), err(/forum posts only/));
  await assert.rejects(db.as(fan, q => q(`select * from public.forum_posts`)), /permission denied/);
  await assert.rejects(db.as(fan, q => q(`insert into public.point_transfers (kind, from_person, to_person, points) values ('send', $1, $2, 5)`, [fan.id, author.id])), /permission denied/);
});

test('a service post (a stick-doctor pattern) can be paid; the seller gets the points and a receipt is stored', { skip }, async () => {
  const patterns = readFileSync(new URL('../data/stick-patterns.js', import.meta.url), 'utf8');
  assert.match(patterns, /id: 'mesh-basics'/);
  const t = await db.team(), seller = await db.player(t, 'Jamie'), buyer = await db.player(t, 'Alex');
  await give(buyer, 1000);
  await assert.rejects(db.call(seller, 'forum_post', { p_body: 'String job', p_price: 300 }), /service_has_title/);
  const post = await db.call(seller, 'forum_post', { p_body: 'I string your head with this pattern, 3 days.', p_title: 'Mesh foundations stringing', p_price: 300, p_pattern: 'mesh-basics' });
  const receipt = await db.call(buyer, 'service_pay', { p_post: post });
  assert.equal(receipt.kind, 'service'); assert.equal(receipt.points, 300); assert.equal(receipt.post_id, post);
  assert.match(receipt.note, /Mesh foundations stringing · pattern mesh-basics/);
  assert.equal(await balance(buyer), 700);
  assert.equal(await balance(seller), 300);
  const f = (await db.call(buyer, 'forum_feed', {})).find(x => x.id === post);
  assert.equal(f.bought, true); assert.equal(f.sales, 1);
  const plain = await db.call(seller, 'forum_post', { p_body: 'just a post' });
  await assert.rejects(db.call(buyer, 'service_pay', { p_post: plain }), err(/not a service/));
  await assert.rejects(db.call(seller, 'service_pay', { p_post: post }), err(/own service/));
});

test('send site balance to a teammate, not to anyone else', { skip }, async () => {
  const t = await db.team(), other = await db.team();
  const a = await db.player(t, 'Riley'), b = await db.player(t, 'Morgan'), stranger = await db.player(other, 'Sky');
  await give(a, 1000);
  const r = await db.call(a, 'points_send', { p_to: b.id, p_points: 400, p_note: 'gas money' });
  assert.equal(r.kind, 'send'); assert.equal(r.status, 'done');
  assert.equal(await balance(a), 600); assert.equal(await balance(b), 400);
  await assert.rejects(db.call(a, 'points_send', { p_to: stranger.id, p_points: 1 }), err(/only to a teammate/));
  await assert.rejects(db.call(a, 'points_send', { p_to: a.id, p_points: 1 }), err(/not yourself/));
  await assert.rejects(db.call(a, 'points_send', { p_to: b.id, p_points: 601 }), err(/You have 600 points/));
  await assert.rejects(db.call(a, 'points_send', { p_to: b.id, p_points: 0 }), err(/whole number/));
  const w = await db.call(b, 'wallet_home');
  assert.equal(w.activity[0].direction, 'in'); assert.equal(w.activity[0].other, 'Riley Q.');
  assert.ok(w.teammates.some(x => x.id === a.id));
});

test('session payouts A, B, C and D leave the team pool only when the condition is true and the player confirms', { skip }, async () => {
  const t = await db.team(), p = await db.player(t, 'Riley'), q = await db.player(t, 'Morgan'), donor = await db.player(await db.team(), 'Fan');
  await give(donor, 10000);
  await db.call(donor, 'team_donate', { p_org: t.org, p_points: 1500, p_note: 'go team' });
  assert.equal(await balance(donor), 8500);
  const pool = async () => (await db.call(t.coach, 'payouts_for_coach', { p_org: t.org })).pool;
  assert.equal(await pool(), 1500);

  const link = 'https://lacrossetube-git-web3-platform.vercel.app/play#t=zABCdef_-123';
  const make = (condition, extra = {}) => db.call(t.coach, 'payout_create', { p_org: t.org, p_link: link, p_wcs_id: 'k3j9x2ab', p_label: 'Tuesday film', p_condition: condition, ...extra });
  await assert.rejects(db.call(p, 'payout_create', { p_org: t.org, p_link: link, p_wcs_id: 'k3j9x2ab', p_label: '', p_condition: 'open' }), err(/Only a coach/));
  await assert.rejects(make('open', { p_link: 'https://www.youtube.com/watch?v=x' }), err(/session link/));
  await assert.rejects(make('watch'), err(/film and 1 to 30 minutes/));
  const A = await make('open'), B = await make('finish'), C = await make('watch', { p_film: 'yt-2Xy7Tl06S3Y', p_film_title: 'Ride drill', p_minutes: 2 }), D = await make('present');
  const amounts = Object.fromEntries((await db.call(t.coach, 'payouts_for_coach', { p_org: t.org })).payouts.map(x => [x.condition, x.points]));
  assert.deepEqual(amounts, { open: POINTS.payout.open, finish: POINTS.payout.finish, watch: 2 * POINTS.payout.watchPerMinute, present: POINTS.payout.present });

  const claim = id => db.call(p, 'payout_claim', { p_payout: id });
  await assert.rejects(claim(A), err(/Open the session first/));
  await db.call(p, 'wcs_event', { p_session: 'k3j9x2ab', p_kind: 'open' });
  assert.equal((await claim(A)).points, 100);
  await assert.rejects(claim(A), err(/already confirmed/));

  await assert.rejects(claim(B), err(/Finish the session/));
  await db.call(p, 'wcs_event', { p_session: 'k3j9x2ab', p_kind: 'finish' });
  assert.equal((await claim(B)).points, 500);

  await assert.rejects(claim(C), err(/Watch the film for 2 minutes/));
  await rewind(p); await beat(p, 'yt-2Xy7Tl06S3Y', 60);
  await rewind(p); await beat(p, 'yt-bw8KCj1uzNA', 60);
  await assert.rejects(claim(C), err(/Watch the film/), 'another film does not count');
  await rewind(p); await beat(p, 'yt-2Xy7Tl06S3Y', 60);
  assert.equal((await claim(C)).points, 200);

  await assert.rejects(claim(D), err(/not marked you present/));
  await assert.rejects(db.call(p, 'payout_mark', { p_payout: D, p_person: p.id, p_present: true }), err(/Only the team's coach/));
  await db.call(t.coach, 'payout_mark', { p_payout: D, p_person: p.id, p_present: true });
  assert.equal((await claim(D)).points, 500);
  await assert.rejects(db.call(t.coach, 'payout_mark', { p_payout: D, p_person: p.id, p_present: false }), err(/already confirmed/));

  assert.equal(await pool(), 1500 - 100 - 500 - 200 - 500);
  assert.equal(await balance(p), 1300 + 3 * E.perMinute, 'the four payouts plus the three film minutes watched on the way');
  const mine = await db.call(p, 'payouts_for_me');
  assert.equal(mine.length, 4); assert.ok(mine.every(x => x.claim?.status === 'done'));

  // The pool runs short: the claim is refused and nothing moves.
  await db.call(t.coach, 'payout_mark', { p_payout: D, p_person: q.id, p_present: true });
  await db.call(q, 'wcs_event', { p_session: 'k3j9x2ab', p_kind: 'open' });
  assert.equal((await db.call(q, 'payout_claim', { p_payout: A })).points, 100);
  await assert.rejects(db.call(q, 'payout_claim', { p_payout: D }), err(/team pool has 100 points/));
  assert.equal(await balance(q), 100);
  await assert.rejects(db.call(t.coach, 'payout_claim', { p_payout: A }), err(/Only players/));
  await db.call(t.coach, 'payout_close', { p_payout: D });
  await assert.rejects(db.call(q, 'payout_claim', { p_payout: D }), err(/closed/));
  const coachView = await db.call(t.coach, 'payouts_for_coach', { p_org: t.org });
  const rowD = coachView.payouts.find(x => x.id === D);
  assert.equal(rowD.players.find(x => x.person_id === p.id).claim.status, 'done');
  assert.equal(coachView.donations[0].from, 'Fan Q.');
});

test('the coach application stores the state and an optional school website', { skip }, async () => {
  const a = await db.team({ state: 'New York', website: 'https://www.cornell.edu/athletics' });
  const b = await db.team({ state: 'Wisconsin' });
  const rows = await db.sql(`select id, state, website from public.orgs where id in ($1, $2)`, [a.org, b.org]);
  assert.deepEqual(rows.find(r => r.id === a.org), { id: a.org, state: 'New York', website: 'https://www.cornell.edu/athletics' });
  assert.deepEqual(rows.find(r => r.id === b.org), { id: b.org, state: 'Wisconsin', website: null });
  await assert.rejects(db.team({ state: 'Alaska' }), err(/Pick your team's state/));
  await assert.rejects(db.team({ state: null }), err(/Pick your team's state/));
  await assert.rejects(db.team({ website: 'javascript:alert(1)' }), /orgs_website_check/);
  await assert.rejects(db.team({ website: 'http://plain.edu' }), /orgs_website_check/);
  const [{ s }] = await db.sql(`select public.us_states() as s`);
  assert.deepEqual(s, US_STATES, 'the key-login function and the database accept the same 25 states');
  assert.equal(US_STATES.length, 25);
  assert.ok(validWebsite('https://www.cornell.edu/athletics') && !validWebsite('http://plain.edu') && !validWebsite('javascript:alert(1)'));
  const home = await db.call(a.coach, 'team_home');
  assert.equal(home.teams[0].state, 'New York');
});

test('chain steps (Phase 3): a reserved transfer holds the points, a failed one gives them back, a sent one keeps its tx hash', { skip }, async () => {
  const t = await db.team(), a = await db.player(t, 'Riley'), b = await db.player(t, 'Morgan');
  await give(a, 1000);
  const addr = '0x' + '11'.repeat(20), treasury = '0x' + '22'.repeat(20), hash = '0x' + 'ab'.repeat(32);
  await assert.rejects(db.as(a, q => q(`select public.transfer_reserve_chain('send', $1, $2, null, null, 10, null, 1, $3, $3, 6281971)`, [a.id, b.id, addr])), /permission denied/);
  const reserve = async points => (await db.sql(`select public.transfer_reserve_chain('send', $1, $2, null, null, $3, 'chain', $4, $5, $6, 6281971) as id`,
    [a.id, b.id, points, String(BigInt(points) * 10n ** 15n), treasury, addr]))[0].id;
  const r1 = await reserve(300);
  assert.equal(await balance(a), 700, 'reserved points are held');
  await db.sql(`select public.transfer_finish($1, null, 'insufficient funds')`, [r1]);
  assert.equal(await balance(a), 1000, 'a failed transfer gives the points back');
  const r2 = await reserve(300);
  await db.sql(`select public.transfer_finish($1, $2, null)`, [r2, hash]);
  assert.equal(await balance(a), 700);
  assert.equal(await balance(b), 0, 'a chain send lands as testnet DOGE at the address, not as site points');
  const act = (await db.call(a, 'wallet_home')).activity.find(x => x.id === r2);
  assert.equal(act.tx_hash, hash); assert.equal(act.status, 'sent'); assert.equal(act.settle, 'chain');

  // A chain payout claim checks the condition, and a failed one can be confirmed again.
  const P = await db.call(t.coach, 'payout_create', { p_org: t.org, p_link: 'https://x.vercel.app/play#t=zz', p_wcs_id: 'abc', p_label: '', p_condition: 'present' });
  const claimChain = () => db.sql(`select public.transfer_reserve_chain('payout', null, $1, null, $2, 0, null, 1, $3, $4, 6281971) as id`, [b.id, P, treasury, addr]);
  await assert.rejects(claimChain(), err(/not marked you present/));
  await db.call(t.coach, 'payout_mark', { p_payout: P, p_person: b.id, p_present: true });
  const [{ id: c1 }] = await claimChain();
  await assert.rejects(claimChain(), err(/already confirmed/));
  await db.sql(`select public.transfer_finish($1, null, 'boom')`, [c1]);
  const [{ id: c2 }] = await claimChain();
  await db.sql(`select public.transfer_finish($1, $2, null)`, [c2, '0x' + 'cd'.repeat(32)]);
  assert.equal((await db.call(t.coach, 'payouts_for_coach', { p_org: t.org })).pool, 0, 'a chain payout leaves the team address, not the points pool');
  await db.sql(`select public.org_set_address($1, $2)`, [t.org, addr]);
  await assert.rejects(db.sql(`select public.org_set_address($1, $2)`, [t.org, treasury]), err(/different address/));
});
