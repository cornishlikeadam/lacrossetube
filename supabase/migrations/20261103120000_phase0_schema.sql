-- LacrosseTube Web3, Phase 0 schema: the 18 tables in the build plan's data model, nothing else.
-- Row-level security is on for every table. Policies are keyed to the logged-in person
-- (public.current_person_id()). Anything with no policy is closed to the browser and reachable
-- only with the service key (Edge Functions, the owner MCP on the operator's machine).
-- Phase 0 builds no team, profile, leaderboard or money features; these tables wait for them.

create extension if not exists pgcrypto;

-- People and their keys ------------------------------------------------------------------

create table public.people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  handle text unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text check (char_length(display_name) <= 40),
  age_band text check (age_band in ('u13', '13_17', '18_plus')),
  avatar text check (char_length(avatar) <= 40),
  socials jsonb not null default '{}'::jsonb,
  -- U13 boards are team-only until a parent opts in (locked decision).
  global_board_consent boolean not null default false,
  created_at timestamptz not null default now(),
  constraint u13_no_socials check (age_band is distinct from 'u13' or socials = '{}'::jsonb)
);

create table public.keys (
  pubkey text primary key check (pubkey ~ '^[0-9a-f]{64}$'),
  person_id uuid not null references public.people (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- Each challenge is accepted once: a login must carry a newer challenge time than the last.
  last_login_at timestamptz
);
create index keys_person_idx on public.keys (person_id);

-- Teams, leagues, partners ----------------------------------------------------------------

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('team', 'league', 'partner')),
  name text not null check (char_length(name) <= 80),
  city text check (char_length(city) <= 60),
  verified_at timestamptz,
  verified_sig text,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  role text not null check (role in ('admin', 'coach', 'treasurer', 'parent', 'player')),
  number text check (char_length(number) <= 4),
  position text check (position in ('attack', 'midfield', 'lsm', 'defense', 'goalie')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  unique (org_id, person_id, role)
);
create index memberships_person_idx on public.memberships (person_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  org_id uuid not null references public.orgs (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  role text not null check (role in ('admin', 'coach', 'treasurer', 'parent', 'player')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.guardians (
  parent_id uuid not null references public.people (id) on delete cascade,
  child_id uuid not null references public.people (id) on delete cascade,
  consent_at timestamptz,
  consent_method text,
  primary key (parent_id, child_id),
  check (parent_id <> child_id)
);

-- What Coach Said and the leaderboard ------------------------------------------------------

create table public.team_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  coach_id uuid references public.people (id) on delete set null,
  meeting_date date not null,
  groups jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.results (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  session_id uuid references public.team_sessions (id) on delete set null,
  idea_id text,
  concept text not null check (concept in ('help', 'talk', 'loose', 'danger', 'slide', 'pick', 'angle', 'double', 'disguise', 'hold', 'hustle')),
  grade text not null check (grade in ('perfect', 'good', 'miss')),
  xp integer not null default 0 check (xp >= 0),
  ranked boolean not null default false,
  sig text,
  played_at timestamptz not null default now()
);
create index results_person_idx on public.results (person_id, played_at desc);

create table public.ratings (
  person_id uuid not null references public.people (id) on delete cascade,
  concept text not null check (concept in ('help', 'talk', 'loose', 'danger', 'slide', 'pick', 'angle', 'double', 'disguise', 'hold', 'hustle')),
  rating numeric not null default 500,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (person_id, concept)
);

-- Shelf --------------------------------------------------------------------------------------

-- Mirrors data/catalog.json. The static catalog stays the source of truth; writes here are additive.
create table public.catalog_items (
  id text primary key,
  type text,
  category text,
  title text,
  author text,
  url text,
  youtube_id text,
  data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table public.vouches (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  voucher_person_id uuid references public.people (id) on delete set null,
  voucher_name text check (char_length(voucher_name) <= 60),
  quote text not null check (char_length(quote) <= 280),
  content_hash text,
  ots_proof bytea,
  created_at timestamptz not null default now()
);
create index vouches_item_idx on public.vouches (item_id);

create table public.locker (
  person_id uuid not null references public.people (id) on delete cascade,
  item_id text not null,
  note text check (char_length(note) <= 160),
  saved_at timestamptz not null default now(),
  primary key (person_id, item_id)
);

-- Money (later phases; no client access, nothing writes here in Phase 0) ---------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tip', 'fundraiser', 'fee', 'order')),
  amount_sats bigint not null check (amount_sats > 0),
  payer_person_id uuid references public.people (id) on delete set null,
  payee_person_id uuid references public.people (id) on delete set null,
  payee_org_id uuid references public.orgs (id) on delete set null,
  proof text,
  sig text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'failed')),
  created_at timestamptz not null default now()
);

create table public.fundraisers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  goal_usd_cents integer not null check (goal_usd_cents > 0),
  deadline date,
  note text check (char_length(note) <= 280),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (char_length(name) <= 80),
  starts_at timestamptz,
  fee_sats bigint check (fee_sats >= 0),
  capacity integer check (capacity > 0),
  status text not null default 'open' check (status in ('open', 'canceled', 'closed')),
  refund_status text check (refund_status in ('none', 'proposed', 'approved', 'sent')),
  created_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_org_id uuid not null references public.orgs (id) on delete cascade,
  title text not null check (char_length(title) <= 80),
  description text check (char_length(description) <= 2000),
  price_sats bigint not null check (price_sats > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'closed')),
  approved_sig text,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete restrict,
  buyer_person_id uuid references public.people (id) on delete set null,
  escrow_address text,
  state text not null default 'created' check (state in ('created', 'funded', 'released', 'refunded', 'disputed', 'ruled')),
  deadline timestamptz,
  dispute_note text check (char_length(dispute_note) <= 2000),
  ruling_sig text,
  created_at timestamptz not null default now()
);

-- Owner board ---------------------------------------------------------------------------------

create table public.board_cards (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  col text not null default 'inbox' check (col in ('inbox', 'reviewing', 'needs_signature', 'live', 'done')),
  ref_table text,
  ref_id text,
  title text not null,
  notes text,
  acted_by text,
  sig text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Who is logged in --------------------------------------------------------------------------

create function public.current_person_id() returns uuid
  language sql stable security definer set search_path = '' as $$
  select id from public.people where auth_user_id = auth.uid()
$$;

create function public.is_org_member(org uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = org and m.person_id = public.current_person_id() and m.status = 'active'
  )
$$;

revoke all on function public.current_person_id() from public;
revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.current_person_id() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;

-- Row-level security --------------------------------------------------------------------------

alter table public.people enable row level security;
alter table public.keys enable row level security;
alter table public.orgs enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.guardians enable row level security;
alter table public.team_sessions enable row level security;
alter table public.results enable row level security;
alter table public.ratings enable row level security;
alter table public.catalog_items enable row level security;
alter table public.vouches enable row level security;
alter table public.locker enable row level security;
alter table public.payments enable row level security;
alter table public.fundraisers enable row level security;
alter table public.events enable row level security;
alter table public.listings enable row level security;
alter table public.orders enable row level security;
alter table public.board_cards enable row level security;

-- Browser roles get no table rights except what is granted below; RLS then picks the rows.
revoke all on all tables in schema public from anon, authenticated;

-- people: you read and edit your own display fields. Age band and consent are set server-side.
grant select on public.people to authenticated;
grant update (handle, display_name, avatar, socials) on public.people to authenticated;
create policy people_select_self on public.people for select to authenticated using (id = public.current_person_id());
create policy people_update_self on public.people for update to authenticated using (id = public.current_person_id()) with check (id = public.current_person_id());

-- keys: you see your own keys. Only key login (service key) adds or revokes them.
grant select on public.keys to authenticated;
create policy keys_select_self on public.keys for select to authenticated using (person_id = public.current_person_id());

-- orgs: verified orgs are visible to signed-in people; members also see their unverified org.
grant select on public.orgs to authenticated;
create policy orgs_select on public.orgs for select to authenticated using (verified_at is not null or public.is_org_member(id));

-- memberships: your own, and the rosters of orgs you belong to.
grant select on public.memberships to authenticated;
create policy memberships_select on public.memberships for select to authenticated using (person_id = public.current_person_id() or public.is_org_member(org_id));

-- guardians: either side of the link.
grant select on public.guardians to authenticated;
create policy guardians_select on public.guardians for select to authenticated using (parent_id = public.current_person_id() or child_id = public.current_person_id());

-- team_sessions: members of the team.
grant select on public.team_sessions to authenticated;
create policy team_sessions_select on public.team_sessions for select to authenticated using (public.is_org_member(org_id));

-- results and ratings: your own. Ranked results are written by the grading function only.
grant select on public.results to authenticated;
grant select on public.ratings to authenticated;
create policy results_select_self on public.results for select to authenticated using (person_id = public.current_person_id());
create policy ratings_select_self on public.ratings for select to authenticated using (person_id = public.current_person_id());

-- catalog_items and vouches: public shelf data, read-only from the browser.
grant select on public.catalog_items to anon, authenticated;
grant select on public.vouches to anon, authenticated;
create policy catalog_read on public.catalog_items for select to anon, authenticated using (true);
create policy vouches_read on public.vouches for select to anon, authenticated using (true);

-- locker: yours to read and change.
grant select, insert, update, delete on public.locker to authenticated;
create policy locker_select_self on public.locker for select to authenticated using (person_id = public.current_person_id());
create policy locker_insert_self on public.locker for insert to authenticated with check (person_id = public.current_person_id());
create policy locker_update_self on public.locker for update to authenticated using (person_id = public.current_person_id()) with check (person_id = public.current_person_id());
create policy locker_delete_self on public.locker for delete to authenticated using (person_id = public.current_person_id());

-- invites, payments, fundraisers, events, listings, orders, board_cards: no browser access in
-- Phase 0. RLS is on with no policies, so only the service key reaches them.
