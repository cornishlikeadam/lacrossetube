-- Hardening before Phase 1.
-- 1. A PIN-protected key is also encrypted with a random pepper that only the server holds. The
--    server releases it for the right PIN verifier, and locks the key after repeated misses, so a
--    copy of the device's storage cannot be brute-forced offline.
-- 2. Per-IP and per-key rate limits for the key-login function.
-- This adds one table beyond the build plan's 18 (rate_limits): rate limiting needs shared state.

alter table public.keys
  add column pin_verifier_hash text check (pin_verifier_hash ~ '^[0-9a-f]{64}$'),
  add column pin_pepper text check (pin_pepper ~ '^[0-9a-f]{64}$'),
  add column pin_fails integer not null default 0,
  add column pin_locked_until timestamptz;

-- The browser may read its own keys, but never the PIN columns.
revoke select on public.keys from authenticated;
grant select (pubkey, person_id, status, created_at, revoked_at, last_login_at) on public.keys to authenticated;

-- Checks a PIN verifier for a key, atomically. Five misses lock the key for one minute, and each
-- further miss doubles the lock, up to a day. A coach re-issues the key if it stays stuck.
create function public.key_pin_check(p_pubkey text, p_verifier_hash text)
  returns table (ok boolean, pepper text, retry_after integer, attempts_left integer)
  language plpgsql security definer set search_path = '' as $$
declare
  k public.keys%rowtype;
  fails integer;
begin
  select * into k from public.keys where pubkey = p_pubkey and status = 'active' for update;
  if not found or k.pin_verifier_hash is null then
    return query select false, null::text, 0, 0;
    return;
  end if;
  if k.pin_locked_until is not null and k.pin_locked_until > now() then
    return query select false, null::text, ceil(extract(epoch from k.pin_locked_until - now()))::integer, 0;
    return;
  end if;
  if k.pin_verifier_hash = p_verifier_hash then
    update public.keys set pin_fails = 0, pin_locked_until = null where pubkey = p_pubkey;
    return query select true, k.pin_pepper, 0, 5;
    return;
  end if;
  fails := k.pin_fails + 1;
  update public.keys set pin_fails = fails,
    pin_locked_until = case when fails >= 5 then now() + least(interval '1 minute' * power(2, fails - 5), interval '1 day') end
  where pubkey = p_pubkey;
  return query select false, null::text,
    case when fails >= 5 then extract(epoch from least(interval '1 minute' * power(2, fails - 5), interval '1 day'))::integer else 0 end,
    greatest(5 - fails, 0);
end
$$;

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Counts one hit in a fixed window and says whether it is still under the limit.
create function public.rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer)
  returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits (bucket, window_start, hits) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
    returning hits into n;
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  return n <= p_max;
end
$$;

revoke all on function public.key_pin_check(text, text) from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.key_pin_check(text, text) to service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
