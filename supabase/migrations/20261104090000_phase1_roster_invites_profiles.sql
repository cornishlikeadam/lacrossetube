-- LacrosseTube Web3, Phase 1: team verification, the roster as the team ledger, invites, profiles,
-- parent consent and the placement round. No new tables: everything fits the plan's data model.
-- Money tables stay schema-only (no browser access, no pay flow); fundraisers and events gain a
-- signature column to match the others.

-- People: roster identity, presets, socials rules, placement ------------------------------------

alter table public.people
  add column first_name text check (first_name ~ '^[^\s<>"]{1,24}( [^\s<>"]{1,24})?$'),
  add column last_initial text check (last_initial ~ '^[A-Za-z]$'),
  add column contact_email text check (contact_email ~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$' and char_length(contact_email) <= 120),
  add column skin text not null default 'default' check (skin in ('default', 'night', 'neon', 'gold', 'legend')),
  add column socials_public_self boolean not null default false,
  add column socials_public_parent boolean not null default false,
  add column placed_at timestamptz,
  add column seed_rating numeric;

-- Only adults carry a contact email (coaches, parents, treasurers). No photos exist anywhere:
-- avatar is one of a fixed set of presets.
alter table public.people
  add constraint contact_email_adults check (contact_email is null or age_band = '18_plus'),
  add constraint avatar_preset check (avatar is null or avatar in ('stick', 'goal', 'ball', 'crown', 'flower', 'bolt', 'shield', 'target'));

-- Socials are links only, on five sites, and never for under-13s (u13_no_socials from Phase 0).
create function public.valid_socials(s jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(s) = 'object' and not exists (
    select 1 from jsonb_each_text(s) e
    where not (
      (e.key = 'instagram' and e.value ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._]{1,30}/?$') or
      (e.key = 'tiktok' and e.value ~ '^https://(www\.)?tiktok\.com/@[A-Za-z0-9._]{1,30}/?$') or
      (e.key = 'youtube' and e.value ~ '^https://(www\.)?youtube\.com/(@[A-Za-z0-9._-]{1,40}|channel/[A-Za-z0-9_-]{10,40})/?$') or
      (e.key = 'x' and e.value ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}/?$') or
      (e.key = 'hudl' and e.value ~ '^https://(www\.)?hudl\.com/profile/[0-9]{1,12}(/[A-Za-z0-9-]{1,60})?/?$')
    )
  )
$$;
alter table public.people add constraint socials_valid check (public.valid_socials(socials));

-- Who may see socials beyond the team: adults by their own choice; 13-17 only when both the
-- player and a parent say so. Under-13s have none.
create function public.socials_are_public(p public.people) returns boolean language sql stable as $$
  select case p.age_band
    when '18_plus' then p.socials_public_self
    when '13_17' then p.socials_public_self and p.socials_public_parent
    else false end
$$;

-- The browser may edit only its own presentation fields. Names, age band, consent and ratings
-- come from the roster and the server.
revoke update on public.people from authenticated;
grant update (avatar, skin, socials, socials_public_self) on public.people to authenticated;
-- Every column except contact_email, which only the server and the owner MCP read.
revoke select on public.people from authenticated;
grant select (id, auth_user_id, handle, display_name, first_name, last_initial, age_band, avatar, skin, socials,
              socials_public_self, socials_public_parent, global_board_consent, placed_at, seed_rating, created_at)
  on public.people to authenticated;

-- Money tables: a signature column on the two that lacked one. Still no browser access.
alter table public.fundraisers add column sig text;
alter table public.events add column sig text;

-- Invites: one live invite per person per org.
create index invites_person_idx on public.invites (org_id, person_id) where used_at is null;

-- Visibility -----------------------------------------------------------------------------------

create function public.shares_org(other uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
    where a.person_id = public.current_person_id() and b.person_id = other
      and a.status = 'active' and b.status = 'active'
  )
$$;
create function public.is_guardian_of(child uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.guardians g where g.parent_id = public.current_person_id() and g.child_id = child)
$$;
create function public.is_org_staff(org uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.orgs o on o.id = m.org_id
    where m.org_id = org and m.person_id = public.current_person_id() and m.status = 'active'
      and m.role in ('admin', 'coach') and o.verified_at is not null
  )
$$;
revoke all on function public.shares_org(uuid), public.is_guardian_of(uuid), public.is_org_staff(uuid) from public;
grant execute on function public.shares_org(uuid), public.is_guardian_of(uuid), public.is_org_staff(uuid) to authenticated;

-- Teammates (and a player's parents) see each other's rows; nobody else does. There is no
-- global list in Phase 1, so under-13s appear nowhere outside their team.
drop policy people_select_self on public.people;
create policy people_select on public.people for select to authenticated
  using (id = public.current_person_id() or public.shares_org(id) or public.is_guardian_of(id));

-- Ratings and results stay private to the person (and their parents) for now.
drop policy ratings_select_self on public.ratings;
create policy ratings_select on public.ratings for select to authenticated
  using (person_id = public.current_person_id() or public.is_guardian_of(person_id));

-- Owner board: a card for every team application ----------------------------------------------

create function public.card_for_new_org() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.board_cards (kind, col, ref_table, ref_id, title, notes)
  values ('org_application', 'inbox', 'orgs', new.id::text,
          format('%s application: %s%s', initcap(new.kind), new.name, coalesce(' (' || new.city || ')', '')),
          'Verify with the owner key: node scripts/owner.mjs verify ' || new.id);
  return new;
end
$$;
create trigger orgs_card after insert on public.orgs for each row execute function public.card_for_new_org();

-- Roster (coach only, verified teams only) -----------------------------------------------------

create function public.roster_add(p_org uuid, p_first_name text, p_last_initial text, p_number text,
                                  p_position text, p_age_band text, p_role text default 'player', p_parent_email text default null)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare
  child uuid; parent uuid; m uuid;
begin
  if not public.is_org_staff(p_org) then raise exception 'Only a coach of a verified team can add to the roster.' using errcode = '42501'; end if;
  if p_role not in ('player', 'coach', 'treasurer') then raise exception 'Roster rows are players, coaches or treasurers.'; end if;
  if p_role <> 'player' and p_age_band <> '18_plus' then raise exception 'Coaches and treasurers must be 18 or older.'; end if;
  if p_age_band = 'u13' and coalesce(trim(p_parent_email), '') = '' then raise exception 'A U13 player needs a parent email.'; end if;
  if p_age_band = '18_plus' and p_parent_email is not null then raise exception 'Adults do not need a parent email.'; end if;
  insert into public.people (first_name, last_initial, display_name, age_band)
    values (trim(p_first_name), upper(p_last_initial), trim(p_first_name) || ' ' || upper(p_last_initial) || '.', p_age_band)
    returning id into child;
  insert into public.memberships (org_id, person_id, role, number, position)
    values (p_org, child, p_role, nullif(trim(p_number), ''), case when p_role = 'player' then p_position end)
    returning id into m;
  if coalesce(trim(p_parent_email), '') <> '' then
    insert into public.people (first_name, display_name, age_band, contact_email)
      values ('Parent', 'Parent of ' || trim(p_first_name) || ' ' || upper(p_last_initial) || '.', '18_plus', lower(trim(p_parent_email)))
      returning id into parent;
    insert into public.memberships (org_id, person_id, role) values (p_org, parent, 'parent');
    insert into public.guardians (parent_id, child_id) values (parent, child);
  end if;
  return m;
end
$$;

-- Everything the coach desk needs about the roster, in one call.
create function public.roster_for_coach(p_org uuid)
  returns table (person_id uuid, membership_id uuid, display_name text, role text, number text, "position" text,
                 age_band text, active_keys integer, invite_expires_at timestamptz, placed boolean,
                 guardian_of uuid, consent_at timestamptz, has_parent boolean)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_org_staff(p_org) then raise exception 'Only a coach of a verified team can see the roster.' using errcode = '42501'; end if;
  return query
    select p.id, m.id, p.display_name, m.role, m.number, m.position, p.age_band,
      (select count(*)::integer from public.keys k where k.person_id = p.id and k.status = 'active'),
      (select max(i.expires_at) from public.invites i where i.person_id = p.id and i.org_id = p_org and i.used_at is null and i.expires_at > now()),
      p.placed_at is not null,
      (select g.child_id from public.guardians g where g.parent_id = p.id limit 1),
      coalesce((select g.consent_at from public.guardians g where g.parent_id = p.id limit 1),
               (select max(g.consent_at) from public.guardians g where g.child_id = p.id)),
      exists (select 1 from public.guardians g where g.child_id = p.id)
    from public.memberships m join public.people p on p.id = m.person_id
    where m.org_id = p_org and m.status = 'active'
    order by (m.role = 'parent'), m.role, nullif(regexp_replace(coalesce(m.number, ''), '\D', '', 'g'), '')::integer nulls last, p.display_name;
end
$$;

-- A fresh one-time invite for one roster row. Only the hash is stored; the code is returned once.
-- Older unused invites for the same person are expired.
create function public.invite_create(p_org uuid, p_person uuid)
  returns table (person_id uuid, code text, expires_at timestamptz)
  language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  c text; r text; exp timestamptz := now() + interval '7 days';
begin
  if not public.is_org_staff(p_org) then raise exception 'Only a coach of a verified team can make invites.' using errcode = '42501'; end if;
  select m.role into r from public.memberships m where m.org_id = p_org and m.person_id = p_person and m.status = 'active' order by (m.role = 'parent') limit 1;
  if r is null then raise exception 'That person is not on this roster.'; end if;
  update public.invites i set expires_at = now() where i.org_id = p_org and i.person_id = p_person and i.used_at is null and i.expires_at > now();
  c := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into public.invites (code_hash, org_id, person_id, role, expires_at, created_by)
    values (encode(extensions.digest(c, 'sha256'), 'hex'), p_org, p_person, r, exp, public.current_person_id());
  return query select p_person, c, exp;
end
$$;

-- Who is logged in, now also checking that the request's session still exists, so ending a
-- session (a turned-off key) cuts off a lost device at once instead of when its token expires.
create or replace function public.current_person_id() returns uuid
  language sql stable security definer set search_path = '' as $$
  select p.id from public.people p
  where p.auth_user_id = auth.uid()
    and exists (select 1 from auth.sessions s where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and s.user_id = auth.uid())
$$;

-- Lost key: the coach turns off every key for that person and ends their open sessions, so the
-- lost device is signed out. The person, XP and rating stay.
create function public.keys_revoke(p_org uuid, p_person uuid) returns integer
  language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.is_org_staff(p_org) then raise exception 'Only a coach of a verified team can turn off keys.' using errcode = '42501'; end if;
  if not exists (select 1 from public.memberships m where m.org_id = p_org and m.person_id = p_person and m.status = 'active') then
    raise exception 'That person is not on this roster.';
  end if;
  update public.keys set status = 'revoked', revoked_at = now() where person_id = p_person and status = 'active';
  get diagnostics n = row_count;
  delete from auth.sessions where user_id = (select auth_user_id from public.people where id = p_person);
  return n;
end
$$;

-- Parents ----------------------------------------------------------------------------------------

-- A parent's choices for their child: global boards (U13 opt-in) and public socials (13-17).
create function public.guardian_set(p_child uuid, p_global_board boolean default null, p_public_socials boolean default null)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.guardians g where g.parent_id = public.current_person_id() and g.child_id = p_child and g.consent_at is not null) then
    raise exception 'Only a parent who has given consent can change this.' using errcode = '42501';
  end if;
  update public.people set
    global_board_consent = coalesce(p_global_board, global_board_consent),
    socials_public_parent = case when age_band = '13_17' then coalesce(p_public_socials, socials_public_parent) else false end
  where id = p_child;
end
$$;

-- Placement round ----------------------------------------------------------------------------

-- Five graded challenges, once per person. Grading happened on the device with the existing
-- rules; this writes the ranked seed. Each concept starts at 500.
create function public.placement_submit(p_results jsonb) returns numeric
  language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.current_person_id(); r jsonb; seed numeric;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if (select placed_at from public.people where id = me) is not null then raise exception 'Placement is already done.'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) <> 5 then raise exception 'Placement is exactly five challenges.'; end if;
  if (select count(distinct x->>'concept') from jsonb_array_elements(p_results) x) <> 5 then raise exception 'Placement uses five different concepts.'; end if;
  for r in select * from jsonb_array_elements(p_results) loop
    insert into public.results (person_id, idea_id, concept, grade, xp, ranked)
      values (me, left(r->>'idea_id', 80), r->>'concept', r->>'grade',
              case r->>'grade' when 'perfect' then 150 when 'good' then 80 else 0 end, true);
    insert into public.ratings (person_id, concept, rating, attempts)
      values (me, r->>'concept', 500 + case r->>'grade' when 'perfect' then 40 when 'good' then 15 else -25 end, 1)
      on conflict (person_id, concept) do update set
        rating = public.ratings.rating + excluded.rating - 500, attempts = public.ratings.attempts + 1, updated_at = now();
  end loop;
  select round(avg(rating), 1) into seed from public.ratings where person_id = me;
  update public.people set placed_at = now(), seed_rating = seed where id = me;
  return seed;
end
$$;

-- Team home: everything the team page shows for the signed-in person, as one JSON document.
-- Under-13 teammates are never named in the rank; only counts and the person's own place.
create function public.team_home() returns jsonb
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
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
                 'org_id', o.id, 'name', o.name, 'city', o.city, 'verified', o.verified_at is not null,
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

revoke all on function public.roster_add(uuid, text, text, text, text, text, text, text), public.roster_for_coach(uuid),
  public.invite_create(uuid, uuid), public.keys_revoke(uuid, uuid), public.guardian_set(uuid, boolean, boolean),
  public.placement_submit(jsonb), public.team_home(), public.card_for_new_org() from public, anon;
grant execute on function public.roster_add(uuid, text, text, text, text, text, text, text), public.roster_for_coach(uuid),
  public.invite_create(uuid, uuid), public.keys_revoke(uuid, uuid), public.guardian_set(uuid, boolean, boolean),
  public.placement_submit(jsonb), public.team_home() to authenticated;

-- Server-only steps the key-login function calls after it has checked the key's signature.
-- Each runs in one transaction. Only the service role may call them.

-- A coach applies: a new adult person, their first key, an unverified team, and the coach
-- membership. The orgs trigger puts the application on the owner's board.
create function public.apply_team(p_pubkey text, p_login_at timestamptz, p_verifier_hash text, p_pepper text,
                                  p_first_name text, p_last_initial text, p_email text, p_team text, p_city text)
  returns table (person_id uuid, org_id uuid)
  language plpgsql security definer set search_path = '' as $$
declare me uuid; org uuid;
begin
  insert into public.people (first_name, last_initial, display_name, age_band, contact_email)
    values (trim(p_first_name), upper(p_last_initial), trim(p_first_name) || ' ' || upper(p_last_initial) || '.', '18_plus', nullif(lower(trim(p_email)), ''))
    returning id into me;
  insert into public.keys (pubkey, person_id, last_login_at, pin_verifier_hash, pin_pepper)
    values (p_pubkey, me, p_login_at, p_verifier_hash, p_pepper);
  insert into public.orgs (kind, name, city, created_by) values ('team', trim(p_team), nullif(trim(p_city), ''), me) returning id into org;
  insert into public.memberships (org_id, person_id, role) values (org, me, 'coach');
  return query select me, org;
end
$$;

-- What an invite is for, before anyone makes a key. Returns null for a bad, used or expired code.
create function public.invite_info(p_code_hash text) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'team', o.name, 'city', o.city, 'verified', o.verified_at is not null, 'role', i.role, 'expires_at', i.expires_at,
    'display_name', p.display_name, 'first_name', p.first_name, 'age_band', p.age_band,
    'number', m.number, 'position', m.position,
    'child', (select c.display_name from public.guardians g join public.people c on c.id = g.child_id where g.parent_id = p.id limit 1),
    'child_age_band', (select c.age_band from public.guardians g join public.people c on c.id = g.child_id where g.parent_id = p.id limit 1),
    'needs_parent', p.age_band = 'u13' and not exists (select 1 from public.guardians g where g.child_id = p.id and g.consent_at is not null))
  from public.invites i
  join public.orgs o on o.id = i.org_id
  join public.people p on p.id = i.person_id
  left join public.memberships m on m.org_id = i.org_id and m.person_id = i.person_id and m.role = i.role and m.status = 'active'
  where i.code_hash = p_code_hash and i.used_at is null and i.expires_at > now()
$$;

-- Opening an invite: attach the new key to that roster row's person and use up the invite.
-- A U13 player's invite waits for a parent's consent. A parent's invite records that consent.
create function public.accept_invite(p_code_hash text, p_pubkey text, p_login_at timestamptz, p_verifier_hash text,
                                     p_pepper text, p_consent boolean)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invites%rowtype; band text;
begin
  select * into inv from public.invites where code_hash = p_code_hash for update;
  if not found or inv.used_at is not null or inv.expires_at <= now() then
    raise exception 'This invite was already used or has expired. Ask your coach for a new one.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.orgs where id = inv.org_id and verified_at is not null) then
    raise exception 'This team is not verified yet.' using errcode = '42501';
  end if;
  select age_band into band from public.people where id = inv.person_id;
  if inv.role = 'player' and band = 'u13'
     and not exists (select 1 from public.guardians where child_id = inv.person_id and consent_at is not null) then
    raise exception 'A parent needs to open their invite first.' using errcode = '42501';
  end if;
  if inv.role = 'parent' then
    if p_consent is not true then raise exception 'A parent invite needs your consent.' using errcode = '42501'; end if;
    update public.guardians set consent_at = now(), consent_method = 'parent_invite' where parent_id = inv.person_id and consent_at is null;
  end if;
  insert into public.keys (pubkey, person_id, last_login_at, pin_verifier_hash, pin_pepper)
    values (p_pubkey, inv.person_id, p_login_at, p_verifier_hash, p_pepper);
  update public.invites set used_at = now() where id = inv.id;
  return inv.person_id;
end
$$;

revoke all on function public.apply_team(text, timestamptz, text, text, text, text, text, text, text),
  public.invite_info(text), public.accept_invite(text, text, timestamptz, text, text, boolean) from public, anon, authenticated;
grant execute on function public.apply_team(text, timestamptz, text, text, text, text, text, text, text),
  public.invite_info(text), public.accept_invite(text, text, timestamptz, text, text, boolean) to service_role;

-- The owner's signed verification, applied by the owner-verify function.
create function public.verify_org(p_org uuid, p_sig text) returns text
  language plpgsql security definer set search_path = '' as $$
declare n text;
begin
  update public.orgs set verified_at = now(), verified_sig = p_sig where id = p_org and verified_at is null returning name into n;
  if n is null then raise exception 'No unverified team with that id.' using errcode = 'P0002'; end if;
  update public.board_cards set col = 'done', acted_by = 'owner', sig = p_sig, updated_at = now()
    where ref_table = 'orgs' and ref_id = p_org::text and kind = 'org_application';
  return n;
end
$$;
revoke all on function public.verify_org(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_org(uuid, text) to service_role;
