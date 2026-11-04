-- The login key is also the person's DogeOS wallet. Each key records its 0x address (checked by
-- the key-login function against the key itself). Points live here, and redeeming them sends
-- testnet DOGE from the treasury to the person's current address, with a receipt row.

alter table public.keys add column evm_address text check (evm_address ~ '^0x[0-9a-fA-F]{40}$');
grant select (evm_address) on public.keys to authenticated;

-- A receipt for every redemption. 'reserved' holds the points while the transfer is sent.
create table public.point_redemptions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  points integer not null check (points > 0),
  amount_wei numeric not null check (amount_wei > 0),
  to_address text not null check (to_address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id bigint not null,
  status text not null default 'reserved' check (status in ('reserved', 'sent', 'failed')),
  tx_hash text check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index point_redemptions_person_idx on public.point_redemptions (person_id, created_at desc);
alter table public.point_redemptions enable row level security;
revoke all on public.point_redemptions from anon, authenticated;
grant select on public.point_redemptions to authenticated;
create policy point_redemptions_select_self on public.point_redemptions for select to authenticated using (person_id = public.current_person_id());

-- Points earned (results written by the server) minus points held or spent on redemptions.
create function public.points_balance(p_person uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(xp) from public.results where person_id = p_person), 0)
        - coalesce((select sum(points) from public.point_redemptions where person_id = p_person and status in ('reserved', 'sent')), 0))::integer
$$;

-- The person's wallet: the address of their newest active key.
create function public.wallet_address(p_person uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select evm_address from public.keys where person_id = p_person and status = 'active' and evm_address is not null
  order by created_at desc limit 1
$$;

-- Reserve points for a redemption, atomically against the balance. Service role only.
create function public.redeem_reserve(p_person uuid, p_points integer, p_amount_wei numeric, p_to text, p_chain bigint)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  perform 1 from public.people where people.id = p_person for update;
  if public.points_balance(p_person) < p_points then raise exception 'Not enough points.' using errcode = 'P0001'; end if;
  insert into public.point_redemptions (person_id, points, amount_wei, to_address, chain_id)
    values (p_person, p_points, p_amount_wei, p_to, p_chain) returning point_redemptions.id into id;
  return id;
end
$$;

-- Record how the transfer went. A failed transfer gives the points back.
create function public.redeem_finish(p_id uuid, p_tx_hash text, p_error text) returns void
  language sql security definer set search_path = '' as $$
  update public.point_redemptions set
    status = case when p_tx_hash is not null then 'sent' else 'failed' end,
    tx_hash = p_tx_hash, error = left(p_error, 300), sent_at = case when p_tx_hash is not null then now() end
  where id = p_id and status = 'reserved'
$$;

revoke all on function public.points_balance(uuid), public.wallet_address(uuid), public.redeem_reserve(uuid, integer, numeric, text, bigint),
  public.redeem_finish(uuid, text, text) from public, anon, authenticated;
grant execute on function public.redeem_reserve(uuid, integer, numeric, text, bigint), public.redeem_finish(uuid, text, text),
  public.points_balance(uuid), public.wallet_address(uuid) to service_role;

-- team_home gains the wallet: address, points, and the latest receipts.
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
