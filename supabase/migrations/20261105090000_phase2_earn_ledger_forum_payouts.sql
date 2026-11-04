-- LacrosseTube Web3, Phase 2: automatic daily earnings with a ceiling, a points ledger (send to a
-- teammate, tips, paid services, donations to a team pool, session payouts), the forum, and the
-- team's state and school website on the coach application. Everything here is site balance
-- (points in this database). Nothing moves on the chain in Phase 2; the chain columns on
-- point_transfers are filled only by the redeem Edge Function once the chain is switched on.
--
-- The rules (points per film minute, per game, daily limits, payout amounts) live in one place,
-- public.earn_rules(), and match POINTS in supabase/functions/_shared/chain.js (a test compares them).

-- Rules --------------------------------------------------------------------------------------------

create function public.earn_rules() returns jsonb language sql immutable as $$
  select '{"perMinute": 500, "maxMinutes": 30, "perGame": 1000, "maxGames": 7, "dailyCap": 25000,
           "dayZone": "America/New_York",
           "payout": {"open": 100, "finish": 500, "watchPerMinute": 100, "maxWatchMinutes": 30, "present": 500}}'::jsonb
$$;
-- The earning day, so "a day" means the same thing for everyone.
create function public.earn_day() returns date language sql stable as $$
  select (now() at time zone (public.earn_rules() ->> 'dayZone'))::date
$$;
grant execute on function public.earn_rules(), public.earn_day() to authenticated, service_role;

-- Teams: state and school website (stored only; no state boards in Phase 2) ---------------------

create function public.us_states() returns text[] language sql immutable as $$
  select array['New York', 'California', 'Pennsylvania', 'Maryland', 'New Jersey', 'Massachusetts', 'Florida', 'Texas',
    'Virginia', 'Connecticut', 'Ohio', 'Michigan', 'North Carolina', 'Colorado', 'Illinois', 'Georgia', 'Minnesota',
    'Washington', 'Arizona', 'Utah', 'Oregon', 'Rhode Island', 'New Hampshire', 'Delaware', 'Wisconsin']
$$;
alter table public.orgs
  add column state text check (state = any (public.us_states())),
  add column website text check (char_length(website) <= 200 and website ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?(/[^\s<>"'']*)?$'),
  -- The team address (Phase 3): set by the redeem function from a key only the server holds.
  add column evm_address text check (evm_address ~ '^0x[0-9a-fA-F]{40}$');

-- apply_team gains the state (required) and an optional school website.
drop function public.apply_team(text, timestamptz, text, text, text, text, text, text, text);
create function public.apply_team(p_pubkey text, p_login_at timestamptz, p_verifier_hash text, p_pepper text,
                                  p_first_name text, p_last_initial text, p_email text, p_team text, p_city text,
                                  p_state text default null, p_website text default null)
  returns table (person_id uuid, org_id uuid)
  language plpgsql security definer set search_path = '' as $$
declare me uuid; org uuid;
begin
  if p_state is null or not (p_state = any (public.us_states())) then raise exception 'Pick your team''s state.' using errcode = 'P0001'; end if;
  insert into public.people (first_name, last_initial, display_name, age_band, contact_email)
    values (trim(p_first_name), upper(p_last_initial), trim(p_first_name) || ' ' || upper(p_last_initial) || '.', '18_plus', nullif(lower(trim(p_email)), ''))
    returning id into me;
  insert into public.keys (pubkey, person_id, last_login_at, pin_verifier_hash, pin_pepper)
    values (p_pubkey, me, p_login_at, p_verifier_hash, p_pepper);
  insert into public.orgs (kind, name, city, state, website, created_by)
    values ('team', trim(p_team), nullif(trim(p_city), ''), p_state, nullif(trim(coalesce(p_website, '')), ''), me) returning id into org;
  insert into public.memberships (org_id, person_id, role) values (org, me, 'coach');
  return query select me, org;
end
$$;
revoke all on function public.apply_team(text, timestamptz, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_team(text, timestamptz, text, text, text, text, text, text, text, text, text) to service_role;

-- Two people share an active team (shares_org works only for the signed-in person).
create function public.share_team(a uuid, b uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships x join public.memberships y on x.org_id = y.org_id
                 where x.person_id = a and y.person_id = b and x.status = 'active' and y.status = 'active')
$$;
create function public.is_active_player(p_org uuid, p_person uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where org_id = p_org and person_id = p_person and role = 'player' and status = 'active')
$$;
revoke all on function public.share_team(uuid, uuid), public.is_active_player(uuid, uuid) from public, anon, authenticated;
grant execute on function public.share_team(uuid, uuid), public.is_active_player(uuid, uuid) to service_role;

-- Automatic earnings --------------------------------------------------------------------------------
-- Only these two pay automatically, and together they stop at the daily ceiling (25,000 points):
--   500 points per minute the film clock is actually advancing, at most 30 minutes a day;
--   1,000 points for the first completion of a given What Coach Said game, at most 7 games a day.
-- 30 x 500 + 7 x 1,000 = 22,000. The ceiling is room, not a third payout. Warrior Tests, tips,
-- services, donations and session payouts never count toward it.

create table public.earn_days (
  person_id uuid not null references public.people (id) on delete cascade,
  day date not null,
  watch_seconds integer not null default 0 check (watch_seconds >= 0),   -- film seconds credited this day (all films)
  watch_points integer not null default 0 check (watch_points >= 0),
  games integer not null default 0 check (games >= 0),
  game_points integer not null default 0 check (game_points >= 0),
  primary key (person_id, day)
);
-- Seconds per film per day, so a coach's "watched the assigned film" payout can be checked.
create table public.film_watch (
  person_id uuid not null references public.people (id) on delete cascade,
  film_id text not null check (film_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  day date not null,
  seconds integer not null default 0 check (seconds >= 0),
  primary key (person_id, film_id, day)
);
-- When this person's last film beat was counted. Beats can never add up to more than real time.
create table public.watch_clock (
  person_id uuid primary key references public.people (id) on delete cascade,
  last_at timestamptz not null
);
-- A game pays the first time it is finished, once ever per person.
create table public.game_completions (
  person_id uuid not null references public.people (id) on delete cascade,
  game_key text not null check (game_key ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  concept text not null check (concept in ('help', 'talk', 'loose', 'danger', 'slide', 'pick', 'angle', 'double', 'disguise', 'hold', 'hustle')),
  grade text not null check (grade in ('perfect', 'good', 'miss')),
  points integer not null check (points >= 0),
  completed_at timestamptz not null default now(),
  primary key (person_id, game_key)
);
-- What Coach Said sessions (a coach's team link, /play#t=...): who opened one, who finished it.
create table public.session_events (
  person_id uuid not null references public.people (id) on delete cascade,
  wcs_id text not null check (wcs_id ~ '^[A-Za-z0-9_-]{1,16}$'),
  kind text not null check (kind in ('open', 'finish')),
  at timestamptz not null default now(),
  primary key (person_id, wcs_id, kind)
);

alter table public.earn_days enable row level security;
alter table public.film_watch enable row level security;
alter table public.watch_clock enable row level security;
alter table public.game_completions enable row level security;
alter table public.session_events enable row level security;
revoke all on public.earn_days, public.film_watch, public.watch_clock, public.game_completions, public.session_events from anon, authenticated;
grant select on public.earn_days, public.film_watch, public.game_completions, public.session_events to authenticated;
create policy earn_days_self on public.earn_days for select to authenticated using (person_id = public.current_person_id());
create policy film_watch_self on public.film_watch for select to authenticated using (person_id = public.current_person_id());
create policy game_completions_self on public.game_completions for select to authenticated using (person_id = public.current_person_id());
create policy session_events_self on public.session_events for select to authenticated using (person_id = public.current_person_id());

-- Today's row, locked, so a person's earnings are counted one call at a time.
create function public.earn_today(p_person uuid) returns public.earn_days
  language plpgsql security definer set search_path = '' as $$
declare d date := public.earn_day(); e public.earn_days%rowtype;
begin
  insert into public.earn_days (person_id, day) values (p_person, d) on conflict do nothing;
  select * into e from public.earn_days where person_id = p_person and day = d for update;
  return e;
end
$$;

-- One film beat: the device counted p_seconds (1-60) during which the film clock was advancing in
-- a visible tab. The server credits no more than the real time since this person's last beat, so
-- two tabs or a fast script cannot add up to more than the clock on the wall.
create function public.watch_beat(p_film text, p_seconds integer) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.current_person_id(); r jsonb := public.earn_rules(); e public.earn_days%rowtype;
  last timestamptz; credit integer; minutes integer; target integer; added integer;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_film is null or p_film !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'Unknown film.' using errcode = 'P0001'; end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > 60 then raise exception 'A film beat is 1 to 60 seconds.' using errcode = 'P0001'; end if;
  e := public.earn_today(me);
  insert into public.watch_clock (person_id, last_at) values (me, now() - interval '60 seconds') on conflict do nothing;
  select last_at into last from public.watch_clock where person_id = me for update;
  credit := least(p_seconds, 60, greatest(floor(extract(epoch from now() - last))::integer, 0));
  update public.watch_clock set last_at = greatest(last, now()) where person_id = me;
  if credit > 0 then
    insert into public.film_watch (person_id, film_id, day, seconds) values (me, p_film, e.day, credit)
      on conflict (person_id, film_id, day) do update set seconds = public.film_watch.seconds + excluded.seconds;
    minutes := least((e.watch_seconds + credit) / 60, (r ->> 'maxMinutes')::integer);
    target := least(minutes * (r ->> 'perMinute')::integer, greatest((r ->> 'dailyCap')::integer - e.game_points, 0));
    added := greatest(target - e.watch_points, 0);
    update public.earn_days set watch_seconds = watch_seconds + credit, watch_points = watch_points + added
      where person_id = me and day = e.day returning * into e;
  else
    added := 0;
  end if;
  return jsonb_build_object('credited', credit, 'points_added', added, 'watch_seconds', e.watch_seconds,
    'minutes_paid', e.watch_points / (r ->> 'perMinute')::integer, 'max_minutes', (r ->> 'maxMinutes')::integer,
    'points_today', e.watch_points + e.game_points);
end
$$;

-- A What Coach Said game finished on the device. The first finish of each game pays, up to seven
-- games a day. A game finished after the seventh is not used up: it pays when finished another day.
create function public.game_complete(p_key text, p_concept text, p_grade text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); r jsonb := public.earn_rules(); e public.earn_days%rowtype; pts integer;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{1,80}$' then raise exception 'Unknown game.' using errcode = 'P0001'; end if;
  if p_grade not in ('perfect', 'good', 'miss') then raise exception 'Unknown grade.' using errcode = 'P0001'; end if;
  e := public.earn_today(me);
  if exists (select 1 from public.game_completions where person_id = me and game_key = p_key) then
    return jsonb_build_object('points_added', 0, 'reason', 'again', 'games', e.games, 'max_games', (r ->> 'maxGames')::integer, 'points_today', e.watch_points + e.game_points);
  end if;
  if e.games >= (r ->> 'maxGames')::integer then
    return jsonb_build_object('points_added', 0, 'reason', 'cap', 'games', e.games, 'max_games', (r ->> 'maxGames')::integer, 'points_today', e.watch_points + e.game_points);
  end if;
  pts := least((r ->> 'perGame')::integer, greatest((r ->> 'dailyCap')::integer - e.watch_points - e.game_points, 0));
  insert into public.game_completions (person_id, game_key, concept, grade, points) values (me, p_key, p_concept, p_grade, pts);
  update public.earn_days set games = games + 1, game_points = game_points + pts where person_id = me and day = e.day returning * into e;
  return jsonb_build_object('points_added', pts, 'reason', 'paid', 'games', e.games, 'max_games', (r ->> 'maxGames')::integer, 'points_today', e.watch_points + e.game_points);
end
$$;

-- A coach's What Coach Said session was opened, or all of its frames were played.
create function public.wcs_event(p_session text, p_kind text) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id();
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_session is null or p_session !~ '^[A-Za-z0-9_-]{1,16}$' or p_kind not in ('open', 'finish') then raise exception 'Unknown session.' using errcode = 'P0001'; end if;
  insert into public.session_events (person_id, wcs_id, kind) values (me, p_session, p_kind) on conflict do nothing;
  return true;
end
$$;

-- Forum ------------------------------------------------------------------------------------------
-- Any signed-in member posts text, a photo or an uploaded clip. YouTube films are the library,
-- not posts: a YouTube link is refused. A post can be a service with a price (a stick-doctor
-- pattern from data/stick-patterns.js, or anything else); paying it moves points to the seller.

create function public.no_youtube(t text) returns boolean language sql immutable as $$
  select coalesce(t, '') !~* '(youtube(-nocookie)?\.com|youtu\.be)'
$$;

create table public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.people (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  title text check (char_length(title) between 1 and 80),
  media_path text check (media_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm|mov)$'),
  media_kind text check (media_kind in ('photo', 'clip')),
  price_points integer check (price_points between 1 and 1000000),
  pattern_id text check (pattern_id ~ '^[a-z0-9-]{1,60}$'),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint media_pair check ((media_path is null) = (media_kind is null)),
  constraint media_kind_matches check (media_kind is null
    or (media_kind = 'photo' and media_path ~ '\.(jpg|png|webp)$') or (media_kind = 'clip' and media_path ~ '\.(mp4|webm|mov)$')),
  constraint has_content check (char_length(trim(body)) > 0 or media_path is not null),
  constraint no_youtube_link check (public.no_youtube(body) and public.no_youtube(title)),
  constraint service_has_title check (price_points is null or title is not null),
  constraint pattern_is_service check (pattern_id is null or price_points is not null)
);
create index forum_posts_feed_idx on public.forum_posts (created_at desc) where removed_at is null;
alter table public.forum_posts enable row level security;
revoke all on public.forum_posts from anon, authenticated;
-- Read through forum_feed(), which adds the author's name for members who are not teammates.

-- Photos and clips: a private bucket. Members upload into their own folder; signed-in members read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('forum', 'forum', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
  on conflict (id) do nothing;
create policy forum_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'forum' and (storage.foldername(name))[1] = public.current_person_id()::text);
create policy forum_media_read on storage.objects for select to authenticated
  using (bucket_id = 'forum' and public.current_person_id() is not null);
create policy forum_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'forum' and (storage.foldername(name))[1] = public.current_person_id()::text);

create function public.forum_post(p_body text, p_media_path text default null, p_media_kind text default null,
                                  p_title text default null, p_price integer default null, p_pattern text default null)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); id uuid;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not (public.no_youtube(p_body) and public.no_youtube(p_title)) then
    raise exception 'YouTube films live in the film library, not the forum. Post text, a photo or your own clip.' using errcode = 'P0001';
  end if;
  if p_media_path is not null then
    if split_part(p_media_path, '/', 1) <> me::text then raise exception 'Upload the file from this account first.' using errcode = '42501'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'forum' and o.name = p_media_path) then
      raise exception 'The upload did not finish. Try again.' using errcode = 'P0001';
    end if;
  end if;
  if not public.rate_limit_hit('person:' || me || ':forum', 20, 3600) then raise exception 'Too many posts this hour.' using errcode = 'P0001'; end if;
  insert into public.forum_posts (author_id, body, title, media_path, media_kind, price_points, pattern_id)
    values (me, coalesce(trim(p_body), ''), nullif(trim(coalesce(p_title, '')), ''), p_media_path, p_media_kind, p_price, nullif(p_pattern, ''))
    returning forum_posts.id into id;
  return id;
end
$$;

create function public.forum_remove(p_post uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  update public.forum_posts set removed_at = now() where id = p_post and author_id = public.current_person_id() and removed_at is null;
  if not found then raise exception 'Only the author can remove a post.' using errcode = '42501'; end if;
end
$$;

-- Ledger -----------------------------------------------------------------------------------------
-- Every point that moves between people or into and out of a team pool is one row here. A site
-- row is done at once. A chain row (Phase 3) is reserved while the transfer is sent and records
-- the tx hash; a failed one gives the points back because failed rows never count.

create table public.team_payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  created_by uuid references public.people (id) on delete set null,
  session_link text not null check (char_length(session_link) <= 12000 and session_link ~ '^https?://[^\s<>"'']+/play#t=[A-Za-z0-9_-]+$'),
  wcs_id text not null check (wcs_id ~ '^[A-Za-z0-9_-]{1,16}$'),
  session_label text check (char_length(session_label) <= 80),
  condition text not null check (condition in ('open', 'finish', 'watch', 'present')),
  film_id text check (film_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  film_title text check (char_length(film_title) <= 160),
  minutes integer check (minutes between 1 and 30),
  points integer not null check (points > 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint watch_needs_film check ((condition = 'watch') = (film_id is not null and minutes is not null))
);
create index team_payouts_org_idx on public.team_payouts (org_id, created_at desc);
create table public.payout_marks (
  payout_id uuid not null references public.team_payouts (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  marked_by uuid references public.people (id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (payout_id, person_id)
);

create table public.point_transfers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('send', 'tip', 'service', 'donation', 'payout')),
  from_person uuid references public.people (id),
  from_org uuid references public.orgs (id),
  to_person uuid references public.people (id),
  to_org uuid references public.orgs (id),
  points integer not null check (points > 0),
  note text check (char_length(note) <= 140),
  post_id uuid references public.forum_posts (id),
  payout_id uuid references public.team_payouts (id),
  settle text not null default 'site' check (settle in ('site', 'chain')),
  status text not null default 'done' check (status in ('done', 'reserved', 'sent', 'failed')),
  amount_wei numeric check (amount_wei > 0),
  from_address text check (from_address ~ '^0x[0-9a-fA-F]{40}$'),
  to_address text check (to_address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id bigint,
  tx_hash text check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint one_source check (num_nonnulls(from_person, from_org) = 1),
  constraint one_destination check (num_nonnulls(to_person, to_org) = 1),
  constraint not_to_self check (coalesce(from_person <> to_person, true) and coalesce(from_org <> to_org, true)),
  constraint site_is_done check (settle = 'chain' or status = 'done'),
  constraint chain_has_fields check (settle = 'site' or (amount_wei is not null and to_address is not null and from_address is not null and chain_id is not null)),
  constraint kind_shape check (case kind
    when 'send' then from_person is not null and to_person is not null
    when 'tip' then from_person is not null and to_person is not null and post_id is not null
    when 'service' then from_person is not null and to_person is not null and post_id is not null
    when 'donation' then from_person is not null and to_org is not null
    when 'payout' then from_org is not null and to_person is not null and payout_id is not null end)
);
create index point_transfers_from_person_idx on public.point_transfers (from_person, created_at desc);
create index point_transfers_to_person_idx on public.point_transfers (to_person, created_at desc);
create index point_transfers_from_org_idx on public.point_transfers (from_org);
create index point_transfers_to_org_idx on public.point_transfers (to_org);
create index point_transfers_post_idx on public.point_transfers (post_id);
-- One live claim per player per payout. A failed chain claim does not count, so it can be retried.
create unique index point_transfers_one_claim on public.point_transfers (payout_id, to_person) where kind = 'payout' and status <> 'failed';

alter table public.team_payouts enable row level security;
alter table public.payout_marks enable row level security;
alter table public.point_transfers enable row level security;
revoke all on public.team_payouts, public.payout_marks, public.point_transfers from anon, authenticated;
grant select on public.team_payouts to authenticated;
create policy team_payouts_members on public.team_payouts for select to authenticated using (public.is_org_member(org_id));
grant select on public.point_transfers to authenticated;
create policy point_transfers_own on public.point_transfers for select to authenticated
  using (from_person = public.current_person_id() or to_person = public.current_person_id());

-- Site balance: Warrior Test tiers, automatic earnings and points received, minus points sent,
-- tipped, paid, donated or held for a transfer, and points redeemed.
create or replace function public.points_balance(p_person uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(points) from public.warrior_progress where person_id = p_person), 0)
        + coalesce((select sum(watch_points + game_points) from public.earn_days where person_id = p_person), 0)
        + coalesce((select sum(points) from public.point_transfers where to_person = p_person and settle = 'site' and status = 'done'), 0)
        - coalesce((select sum(points) from public.point_transfers where from_person = p_person and status <> 'failed'), 0)
        - coalesce((select sum(points) from public.point_redemptions where person_id = p_person and status in ('reserved', 'sent')), 0))::integer
$$;
-- A team pool in points: site donations in, site payouts out. Chain donations land on the team
-- address and chain payouts leave from it, so neither touches this number.
create function public.team_pool(p_org uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(points) from public.point_transfers where to_org = p_org and settle = 'site' and status = 'done'), 0)
        - coalesce((select sum(points) from public.point_transfers where from_org = p_org and settle = 'site' and status <> 'failed'), 0))::integer
$$;

-- Locks the person and checks they can spend p_points.
create function public.spend_check(p_person uuid, p_points integer) returns void
  language plpgsql security definer set search_path = '' as $$
declare have integer;
begin
  if p_points is null or p_points < 1 or p_points > 1000000 then raise exception 'Give a whole number of points from 1 to 1,000,000.' using errcode = 'P0001'; end if;
  perform 1 from public.people where id = p_person for update;
  have := public.points_balance(p_person);
  if have < p_points then raise exception 'You have % points.', have using errcode = 'P0001'; end if;
end
$$;
create function public.transfer_row(t public.point_transfers) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'kind', t.kind, 'points', t.points, 'note', t.note, 'settle', t.settle, 'status', t.status,
    'to_person', t.to_person, 'to_org', t.to_org, 'from_person', t.from_person, 'from_org', t.from_org, 'post_id', t.post_id, 'payout_id', t.payout_id,
    'amount_wei', t.amount_wei::text, 'to_address', t.to_address, 'tx_hash', t.tx_hash, 'error', t.error, 'created_at', t.created_at)
$$;

-- Send site balance to a teammate.
create function public.points_send(p_to uuid, p_points integer, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); t public.point_transfers%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_to = me then raise exception 'Pick a teammate, not yourself.' using errcode = 'P0001'; end if;
  if not public.share_team(me, p_to) then raise exception 'You can send points only to a teammate.' using errcode = '42501'; end if;
  if not public.rate_limit_hit('person:' || me || ':send', 30, 3600) then raise exception 'Too many sends this hour.' using errcode = 'P0001'; end if;
  perform public.spend_check(me, p_points);
  insert into public.point_transfers (kind, from_person, to_person, points, note)
    values ('send', me, p_to, p_points, nullif(left(trim(coalesce(p_note, '')), 140), '')) returning * into t;
  return public.transfer_row(t);
end
$$;

-- Donate site balance to a team's pool. Anyone signed in can give to any approved team.
create function public.team_donate(p_org uuid, p_points integer, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); t public.point_transfers%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.orgs where id = p_org and kind = 'team' and verified_at is not null) then raise exception 'That team is not approved.' using errcode = 'P0001'; end if;
  if not public.rate_limit_hit('person:' || me || ':donate', 30, 3600) then raise exception 'Too many donations this hour.' using errcode = 'P0001'; end if;
  perform public.spend_check(me, p_points);
  insert into public.point_transfers (kind, from_person, to_org, points, note)
    values ('donation', me, p_org, p_points, nullif(left(trim(coalesce(p_note, '')), 140), '')) returning * into t;
  return public.transfer_row(t);
end
$$;

-- Tip a forum post's author. Only forum posts take tips: YouTube films are a library, and their
-- channel owners are not members.
create function public.post_tip(p_post uuid, p_points integer) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); author uuid; t public.point_transfers%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select author_id into author from public.forum_posts where id = p_post and removed_at is null;
  if author is null then raise exception 'Tips go to forum posts only.' using errcode = 'P0001'; end if;
  if author = me then raise exception 'You cannot tip your own post.' using errcode = 'P0001'; end if;
  if p_points > 100000 then raise exception 'A tip is at most 100,000 points.' using errcode = 'P0001'; end if;
  if not public.rate_limit_hit('person:' || me || ':tip', 60, 3600) then raise exception 'Too many tips this hour.' using errcode = 'P0001'; end if;
  perform public.spend_check(me, p_points);
  insert into public.point_transfers (kind, from_person, to_person, points, post_id) values ('tip', me, author, p_points, p_post) returning * into t;
  return public.transfer_row(t);
end
$$;

-- Pay for a service post at its price. The transfer row is the receipt; it names the post, and the
-- note keeps the title and pattern as they were when paid.
create function public.service_pay(p_post uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); p public.forum_posts%rowtype; t public.point_transfers%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into p from public.forum_posts where id = p_post and removed_at is null;
  if not found or p.price_points is null then raise exception 'That post is not a service with a price.' using errcode = 'P0001'; end if;
  if p.author_id = me then raise exception 'This is your own service.' using errcode = 'P0001'; end if;
  if not public.rate_limit_hit('person:' || me || ':service', 30, 3600) then raise exception 'Too many purchases this hour.' using errcode = 'P0001'; end if;
  perform public.spend_check(me, p.price_points);
  insert into public.point_transfers (kind, from_person, to_person, points, post_id, note)
    values ('service', me, p.author_id, p.price_points, p.id, left(p.title || coalesce(' · pattern ' || p.pattern_id, ''), 140)) returning * into t;
  return public.transfer_row(t);
end
$$;

-- Session payouts -----------------------------------------------------------------------------------
-- The coach attaches one What Coach Said session link and picks only the condition:
--   open    (A) the player opened the session
--   finish  (B) the player finished the What Coach Said game for that session
--   watch   (C) the player watched the assigned film for the minutes the coach set
--   present (D) the coach marks the player present
-- The amount is fixed by the rules, never typed. It leaves the team pool only when the condition
-- is true and the player confirms, and it lands in the player's site balance.

create function public.payout_points(p_condition text, p_minutes integer) returns integer
  language sql immutable as $$
  select case p_condition
    when 'open' then (public.earn_rules() #>> '{payout,open}')::integer
    when 'finish' then (public.earn_rules() #>> '{payout,finish}')::integer
    when 'watch' then (public.earn_rules() #>> '{payout,watchPerMinute}')::integer * p_minutes
    when 'present' then (public.earn_rules() #>> '{payout,present}')::integer end
$$;

-- Seconds of the payout's film watched since the day the payout was made.
create function public.payout_watched(p_payout uuid, p_person uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select coalesce(sum(w.seconds), 0)::integer from public.film_watch w join public.team_payouts t on t.id = p_payout
  where w.person_id = p_person and w.film_id = t.film_id and w.day >= (t.created_at at time zone (public.earn_rules() ->> 'dayZone'))::date
$$;

create function public.payout_met(p_payout uuid, p_person uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select case t.condition
      when 'open' then exists (select 1 from public.session_events e where e.person_id = p_person and e.wcs_id = t.wcs_id and e.kind = 'open')
      when 'finish' then exists (select 1 from public.session_events e where e.person_id = p_person and e.wcs_id = t.wcs_id and e.kind = 'finish')
      when 'watch' then public.payout_watched(t.id, p_person) >= t.minutes * 60
      when 'present' then exists (select 1 from public.payout_marks m where m.payout_id = t.id and m.person_id = p_person) end
    from public.team_payouts t where t.id = p_payout), false)
$$;

create function public.payout_create(p_org uuid, p_link text, p_wcs_id text, p_label text, p_condition text,
                                     p_film text default null, p_film_title text default null, p_minutes integer default null)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  if not public.is_org_staff(p_org) then raise exception 'Only a coach of a verified team can make a payout.' using errcode = '42501'; end if;
  if p_condition not in ('open', 'finish', 'watch', 'present') then raise exception 'Pick A, B, C or D.' using errcode = 'P0001'; end if;
  if p_condition = 'watch' and (p_film is null or p_minutes is null or p_minutes not between 1 and (public.earn_rules() #>> '{payout,maxWatchMinutes}')::integer) then
    raise exception 'Pick the film and 1 to 30 minutes.' using errcode = 'P0001';
  end if;
  if p_link is null or p_link !~ '^https?://[^\s<>"'']+/play#t=[A-Za-z0-9_-]+$' then raise exception 'Attach a What Coach Said session link (…/play#t=…).' using errcode = 'P0001'; end if;
  insert into public.team_payouts (org_id, created_by, session_link, wcs_id, session_label, condition, film_id, film_title, minutes, points)
    values (p_org, public.current_person_id(), p_link, p_wcs_id, nullif(left(trim(coalesce(p_label, '')), 80), ''), p_condition,
            case when p_condition = 'watch' then p_film end, case when p_condition = 'watch' then left(p_film_title, 160) end,
            case when p_condition = 'watch' then p_minutes end, public.payout_points(p_condition, p_minutes))
    returning team_payouts.id into id;
  return id;
end
$$;

create function public.payout_close(p_payout uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_org_staff((select org_id from public.team_payouts where id = p_payout)) then raise exception 'Only the team''s coach can close it.' using errcode = '42501'; end if;
  update public.team_payouts set status = 'closed', closed_at = now() where id = p_payout and status = 'open';
end
$$;

-- D: the coach marks a player present (or takes the mark back, until the player has confirmed).
create function public.payout_mark(p_payout uuid, p_person uuid, p_present boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare t public.team_payouts%rowtype;
begin
  select * into t from public.team_payouts where id = p_payout;
  if not found or not public.is_org_staff(t.org_id) then raise exception 'Only the team''s coach can mark players.' using errcode = '42501'; end if;
  if t.condition <> 'present' then raise exception 'Only a "marked present" payout takes marks.' using errcode = 'P0001'; end if;
  if not public.is_active_player(t.org_id, p_person) then raise exception 'That person is not a player on this team.' using errcode = 'P0001'; end if;
  if p_present then
    insert into public.payout_marks (payout_id, person_id, marked_by) values (p_payout, p_person, public.current_person_id()) on conflict do nothing;
  else
    if exists (select 1 from public.point_transfers where payout_id = p_payout and to_person = p_person and status <> 'failed') then
      raise exception 'That player already confirmed this payout.' using errcode = 'P0001';
    end if;
    delete from public.payout_marks where payout_id = p_payout and person_id = p_person;
  end if;
end
$$;

-- The checks every claim makes, site or chain. Locks the payout so two claims cannot race.
create function public.payout_claim_check(p_payout uuid, p_person uuid) returns public.team_payouts
  language plpgsql security definer set search_path = '' as $$
declare t public.team_payouts%rowtype;
begin
  select * into t from public.team_payouts where id = p_payout for update;
  if not found then raise exception 'No such payout.' using errcode = 'P0002'; end if;
  if t.status <> 'open' then raise exception 'Your coach closed this payout.' using errcode = 'P0001'; end if;
  if not public.is_active_player(t.org_id, p_person) then raise exception 'Only players on this team can confirm it.' using errcode = '42501'; end if;
  if exists (select 1 from public.point_transfers where payout_id = p_payout and to_person = p_person and status <> 'failed') then
    raise exception 'You already confirmed this payout.' using errcode = 'P0001';
  end if;
  if not public.payout_met(p_payout, p_person) then
    raise exception '%', case t.condition when 'open' then 'Open the session first.' when 'finish' then 'Finish the session''s game first.'
      when 'watch' then format('Watch the film for %s minutes first.', t.minutes) else 'Your coach has not marked you present yet.' end using errcode = 'P0001';
  end if;
  return t;
end
$$;

-- The player confirms a payout in site balance, from the team pool.
create function public.payout_claim(p_payout uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); p public.team_payouts%rowtype; pool integer; t public.point_transfers%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  p := public.payout_claim_check(p_payout, me);
  perform 1 from public.orgs where id = p.org_id for update;
  pool := public.team_pool(p.org_id);
  if pool < p.points then raise exception 'The team pool has % points and this payout is %. Ask your coach to fill the pool.', pool, p.points using errcode = 'P0001'; end if;
  insert into public.point_transfers (kind, from_org, to_person, points, payout_id) values ('payout', p.org_id, me, p.points, p.id) returning * into t;
  return public.transfer_row(t);
end
$$;

-- The coach's view: the pool, and every payout with each player's state.
create function public.payouts_for_coach(p_org uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_org_staff(p_org) then raise exception 'Only a coach of a verified team can see payouts.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pool', public.team_pool(p_org),
    'address', (select evm_address from public.orgs where id = p_org),
    'donations', coalesce((select jsonb_agg(jsonb_build_object('points', d.points, 'from', p.display_name, 'settle', d.settle, 'status', d.status,
                     'tx_hash', d.tx_hash, 'note', d.note, 'created_at', d.created_at) order by d.created_at desc)
                   from (select * from public.point_transfers where to_org = p_org order by created_at desc limit 10) d
                   left join public.people p on p.id = d.from_person), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'condition', t.condition, 'session_label', t.session_label, 'session_link', t.session_link, 'wcs_id', t.wcs_id,
        'film_id', t.film_id, 'film_title', t.film_title, 'minutes', t.minutes, 'points', t.points, 'status', t.status, 'created_at', t.created_at,
        'players', coalesce((select jsonb_agg(jsonb_build_object(
            'person_id', p.id, 'display_name', p.display_name, 'number', m.number,
            'met', public.payout_met(t.id, p.id),
            'present', exists (select 1 from public.payout_marks k where k.payout_id = t.id and k.person_id = p.id),
            'watched', case when t.condition = 'watch' then public.payout_watched(t.id, p.id) end,
            'claim', (select jsonb_build_object('status', c.status, 'settle', c.settle, 'tx_hash', c.tx_hash) from public.point_transfers c
                      where c.payout_id = t.id and c.to_person = p.id and c.status <> 'failed' limit 1))
            order by nullif(regexp_replace(coalesce(m.number, ''), '\D', '', 'g'), '')::integer nulls last, p.display_name)
          from public.memberships m join public.people p on p.id = m.person_id
          where m.org_id = t.org_id and m.role = 'player' and m.status = 'active'), '[]'::jsonb))
      order by t.created_at desc)
      from public.team_payouts t where t.org_id = p_org), '[]'::jsonb));
end
$$;

-- The player's view: open payouts on their teams, what each needs, and whether they confirmed it.
create function public.payouts_for_me() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.current_person_id();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'team', o.name, 'org_id', t.org_id, 'condition', t.condition, 'session_label', t.session_label, 'session_link', t.session_link,
      'film_id', t.film_id, 'film_title', t.film_title, 'minutes', t.minutes, 'points', t.points, 'status', t.status, 'created_at', t.created_at,
      'met', public.payout_met(t.id, me),
      'watched', case when t.condition = 'watch' then public.payout_watched(t.id, me) end,
      'pool', public.team_pool(t.org_id), 'team_address', o.evm_address,
      'claim', (select jsonb_build_object('status', c.status, 'settle', c.settle, 'tx_hash', c.tx_hash, 'created_at', c.created_at) from public.point_transfers c
                where c.payout_id = t.id and c.to_person = me and c.status <> 'failed' limit 1))
    order by t.created_at desc)
    from public.team_payouts t join public.orgs o on o.id = t.org_id
    where public.is_active_player(t.org_id, me)
      and (t.status = 'open' or exists (select 1 from public.point_transfers c where c.payout_id = t.id and c.to_person = me and c.status <> 'failed'))), '[]'::jsonb);
end
$$;

-- Wallet -------------------------------------------------------------------------------------------

-- Everything the Wallet section shows, for the signed-in person (player or coach: same account).
create function public.wallet_home() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); e public.earn_days%rowtype; r jsonb := public.earn_rules();
begin
  if me is null then return null; end if;
  select * into e from public.earn_days where person_id = me and day = public.earn_day();
  return jsonb_build_object(
    'points', public.points_balance(me),
    'address', public.wallet_address(me),
    'rules', r,
    'today', jsonb_build_object('day', public.earn_day(), 'watch_seconds', coalesce(e.watch_seconds, 0),
               'minutes_paid', coalesce(e.watch_points, 0) / (r ->> 'perMinute')::integer, 'watch_points', coalesce(e.watch_points, 0),
               'games', coalesce(e.games, 0), 'game_points', coalesce(e.game_points, 0)),
    'teammates', coalesce((select jsonb_agg(x order by x ->> 'display_name') from (
        select distinct on (p.id) jsonb_build_object('id', p.id, 'display_name', p.display_name, 'team', o.name, 'role', m2.role) x
        from public.memberships m1 join public.memberships m2 on m2.org_id = m1.org_id and m2.person_id <> me and m2.status = 'active' and m2.role <> 'parent'
        join public.people p on p.id = m2.person_id join public.orgs o on o.id = m1.org_id
        where m1.person_id = me and m1.status = 'active' order by p.id, o.name) s), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('org_id', o.id, 'name', o.name, 'state', o.state, 'role', m.role,
                 'pool', public.team_pool(o.id), 'address', o.evm_address) order by o.name)
               from public.memberships m join public.orgs o on o.id = m.org_id
               where m.person_id = me and m.status = 'active' and o.verified_at is not null), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(public.transfer_row(x.t) || jsonb_build_object(
                 'direction', case when (x.t).from_person = me then 'out' else 'in' end,
                 'other', coalesce(case when (x.t).from_person = me then coalesce(tp.display_name, tor.name) else coalesce(fp.display_name, fo.name) end, ''))
                 order by (x.t).created_at desc)
               from (select t from public.point_transfers t where t.from_person = me or t.to_person = me order by t.created_at desc limit 20) x
               left join public.people tp on tp.id = (x.t).to_person left join public.people fp on fp.id = (x.t).from_person
               left join public.orgs tor on tor.id = (x.t).to_org left join public.orgs fo on fo.id = (x.t).from_org), '[]'::jsonb));
end
$$;

-- The forum, newest first, with the author's name and what this person has tipped or bought.
create function public.forum_feed(p_before timestamptz default null, p_limit integer default 30) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.current_person_id();
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'body', f.body, 'title', f.title, 'media_path', f.media_path, 'media_kind', f.media_kind,
      'price_points', f.price_points, 'pattern_id', f.pattern_id, 'created_at', f.created_at,
      'author', jsonb_build_object('id', a.id, 'display_name', a.display_name, 'avatar', a.avatar,
                 'team', (select o.name from public.memberships m join public.orgs o on o.id = m.org_id
                          where m.person_id = a.id and m.status = 'active' and o.verified_at is not null order by m.created_at limit 1)),
      'mine', f.author_id = me,
      'tips', coalesce((select sum(points) from public.point_transfers x where x.post_id = f.id and x.kind = 'tip'), 0),
      'sales', (select count(*) from public.point_transfers x where x.post_id = f.id and x.kind = 'service'),
      'bought', exists (select 1 from public.point_transfers x where x.post_id = f.id and x.kind = 'service' and x.from_person = me))
    order by f.created_at desc)
    from (select * from public.forum_posts where removed_at is null and (p_before is null or created_at < p_before)
          order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 50)) f
    join public.people a on a.id = f.author_id), '[]'::jsonb);
end
$$;

-- team_home: the team's state and website too.
create or replace function public.team_home() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.current_person_id(); out jsonb;
begin
  if me is null then return null; end if;
  select jsonb_build_object(
    'person', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'first_name', p.first_name, 'age_band', p.age_band,
                 'avatar', p.avatar, 'skin', p.skin, 'socials', p.socials, 'socials_public_self', p.socials_public_self,
                 'socials_public_parent', p.socials_public_parent, 'global_board_consent', p.global_board_consent,
                 'placed', p.placed_at is not null, 'seed_rating', p.seed_rating,
                 'xp', (select coalesce(sum(x.xp), 0) from public.results x where x.person_id = p.id))
               from public.people p where p.id = me),
    'wallet', jsonb_build_object('address', public.wallet_address(me), 'points', public.points_balance(me),
               'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'points', r.points, 'amount_wei', r.amount_wei::text,
                   'to_address', r.to_address, 'status', r.status, 'tx_hash', r.tx_hash, 'created_at', r.created_at) order by r.created_at desc)
                 from (select * from public.point_redemptions where person_id = me order by created_at desc limit 5) r), '[]'::jsonb)),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
                 'org_id', o.id, 'name', o.name, 'city', o.city, 'state', o.state, 'website', o.website, 'verified', o.verified_at is not null,
                 'role', m.role, 'number', m.number, 'position', m.position,
                 'has_session', exists (select 1 from public.team_sessions s where s.org_id = o.id),
                 'placed_count', (select count(*) from public.memberships m2 join public.people p2 on p2.id = m2.person_id
                                  where m2.org_id = o.id and m2.role = 'player' and m2.status = 'active' and p2.placed_at is not null),
                 'seed_rank', (select 1 + count(*) from public.memberships m2 join public.people p2 on p2.id = m2.person_id
                               where m2.org_id = o.id and m2.role = 'player' and m2.status = 'active' and p2.placed_at is not null
                                 and p2.seed_rating > (select seed_rating from public.people where id = me)))
               order by o.name)
             from public.memberships m join public.orgs o on o.id = m.org_id
             where m.person_id = me and m.status = 'active'), '[]'::jsonb),
    'children', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'display_name', c.display_name, 'age_band', c.age_band, 'consent_at', g.consent_at,
                 'global_board_consent', c.global_board_consent, 'socials_public_parent', c.socials_public_parent,
                 'placed', c.placed_at is not null, 'seed_rating', c.seed_rating))
             from public.guardians g join public.people c on c.id = g.child_id where g.parent_id = me), '[]'::jsonb)
  ) into out;
  return out;
end
$$;

-- Chain settlement (Phase 3, service role only) --------------------------------------------------
-- The redeem Edge Function reserves a chain row, sends the transfer, then finishes the row with
-- the tx hash or the error. A failed row never counts, so the points (or the claim) come back.

create function public.transfer_reserve_chain(p_kind text, p_from_person uuid, p_to_person uuid, p_to_org uuid, p_payout uuid,
                                              p_points integer, p_note text, p_amount_wei numeric, p_from_address text,
                                              p_to_address text, p_chain bigint)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare id uuid; p public.team_payouts%rowtype;
begin
  if p_kind = 'send' then
    if p_from_person is null or p_to_person is null or p_from_person = p_to_person or not public.share_team(p_from_person, p_to_person) then
      raise exception 'You can send points only to a teammate.' using errcode = '42501';
    end if;
    perform public.spend_check(p_from_person, p_points);
    insert into public.point_transfers (kind, from_person, to_person, points, note, settle, status, amount_wei, from_address, to_address, chain_id)
      values ('send', p_from_person, p_to_person, p_points, nullif(left(trim(coalesce(p_note, '')), 140), ''), 'chain', 'reserved', p_amount_wei, p_from_address, p_to_address, p_chain)
      returning point_transfers.id into id;
  elsif p_kind = 'donation' then
    if not exists (select 1 from public.orgs where orgs.id = p_to_org and kind = 'team' and verified_at is not null) then raise exception 'That team is not approved.' using errcode = 'P0001'; end if;
    perform public.spend_check(p_from_person, p_points);
    insert into public.point_transfers (kind, from_person, to_org, points, note, settle, status, amount_wei, from_address, to_address, chain_id)
      values ('donation', p_from_person, p_to_org, p_points, nullif(left(trim(coalesce(p_note, '')), 140), ''), 'chain', 'reserved', p_amount_wei, p_from_address, p_to_address, p_chain)
      returning point_transfers.id into id;
  elsif p_kind = 'payout' then
    p := public.payout_claim_check(p_payout, p_to_person);
    insert into public.point_transfers (kind, from_org, to_person, points, payout_id, settle, status, amount_wei, from_address, to_address, chain_id)
      values ('payout', p.org_id, p_to_person, p.points, p.id, 'chain', 'reserved', p_amount_wei, p_from_address, p_to_address, p_chain)
      returning point_transfers.id into id;
  else
    raise exception 'Unknown transfer kind.' using errcode = 'P0001';
  end if;
  return id;
end
$$;

create function public.transfer_finish(p_id uuid, p_tx_hash text, p_error text) returns void
  language sql security definer set search_path = '' as $$
  update public.point_transfers set
    status = case when p_tx_hash is not null then 'sent' else 'failed' end,
    tx_hash = p_tx_hash, error = left(p_error, 300), sent_at = case when p_tx_hash is not null then now() end
  where id = p_id and settle = 'chain' and status = 'reserved'
$$;

-- The team address, derived by the server. Set once; a different address is refused.
create function public.org_set_address(p_org uuid, p_address text) returns text
  language plpgsql security definer set search_path = '' as $$
declare a text;
begin
  update public.orgs set evm_address = p_address where id = p_org and evm_address is null;
  select evm_address into a from public.orgs where id = p_org;
  if a is null then raise exception 'No such team.' using errcode = 'P0002'; end if;
  if lower(a) <> lower(p_address) then raise exception 'This team already has a different address.' using errcode = 'P0001'; end if;
  return a;
end
$$;

-- Grants ---------------------------------------------------------------------------------------------

revoke all on function public.earn_today(uuid), public.spend_check(uuid, integer), public.transfer_row(public.point_transfers),
  public.payout_watched(uuid, uuid), public.payout_met(uuid, uuid), public.payout_claim_check(uuid, uuid), public.team_pool(uuid),
  public.transfer_reserve_chain(text, uuid, uuid, uuid, uuid, integer, text, numeric, text, text, bigint),
  public.transfer_finish(uuid, text, text), public.org_set_address(uuid, text), public.us_states(), public.no_youtube(text),
  public.payout_points(text, integer) from public, anon, authenticated;
grant execute on function public.us_states(), public.no_youtube(text), public.payout_points(text, integer) to authenticated, service_role;
grant execute on function public.team_pool(uuid), public.payout_met(uuid, uuid), public.payout_watched(uuid, uuid),
  public.transfer_reserve_chain(text, uuid, uuid, uuid, uuid, integer, text, numeric, text, text, bigint),
  public.transfer_finish(uuid, text, text), public.org_set_address(uuid, text), public.points_balance(uuid) to service_role;

revoke all on function public.watch_beat(text, integer), public.game_complete(text, text, text), public.wcs_event(text, text),
  public.forum_post(text, text, text, text, integer, text), public.forum_remove(uuid), public.forum_feed(timestamptz, integer),
  public.points_send(uuid, integer, text), public.team_donate(uuid, integer, text), public.post_tip(uuid, integer), public.service_pay(uuid),
  public.payout_create(uuid, text, text, text, text, text, text, integer), public.payout_close(uuid), public.payout_mark(uuid, uuid, boolean),
  public.payout_claim(uuid), public.payouts_for_coach(uuid), public.payouts_for_me(), public.wallet_home(), public.team_home() from public, anon;
grant execute on function public.watch_beat(text, integer), public.game_complete(text, text, text), public.wcs_event(text, text),
  public.forum_post(text, text, text, text, integer, text), public.forum_remove(uuid), public.forum_feed(timestamptz, integer),
  public.points_send(uuid, integer, text), public.team_donate(uuid, integer, text), public.post_tip(uuid, integer), public.service_pay(uuid),
  public.payout_create(uuid, text, text, text, text, text, text, integer), public.payout_close(uuid), public.payout_mark(uuid, uuid, boolean),
  public.payout_claim(uuid), public.payouts_for_coach(uuid), public.payouts_for_me(), public.wallet_home(), public.team_home() to authenticated;
