-- Warrior Tests: five tiers of five questions (25 in all). Tier 1 is the placement round (field
-- games); tier 3 is more field games; tiers 2, 4 and 5 are quizzes with multiple-choice and written
-- answers, graded here so the answers never reach the browser. Passing a tier unlocks the next and
-- pays its points once. Points now come only from passed tiers: 1 + 4 + 15 + 30 + 50 = 100 DOGE.

create table public.warrior_tiers (
  level integer primary key check (level between 1 and 5),
  name text not null,
  kind text not null check (kind in ('games', 'quiz')),
  reward_points integer not null check (reward_points > 0),
  pass_score integer not null default 3 check (pass_score between 1 and 5),
  blurb text
);
insert into public.warrior_tiers (level, name, kind, reward_points, pass_score, blurb) values
  (1, 'Field Reads', 'games', 1000, 1, 'The placement round: five field challenges for your position.'),
  (2, 'Rules & Field IQ', 'quiz', 4000, 3, 'Multiple choice and one written answer on the rules of the field game.'),
  (3, 'Game Day', 'games', 15000, 3, 'Five more field challenges, on reads you have not played yet.'),
  (4, 'History of the Game', 'quiz', 30000, 3, 'Where lacrosse comes from and how it reached the Olympics.'),
  (5, 'Business of Lacrosse', 'quiz', 50000, 3, 'Leagues, sponsors and getting paid to play.');

create table public.warrior_questions (
  level integer not null references public.warrior_tiers (level),
  ord integer not null check (ord between 1 and 5),
  kind text not null check (kind in ('choice', 'written')),
  prompt text not null,
  options jsonb,
  answer jsonb not null,   -- choice: {"index": n}; written: {"any": [...]} or {"all": [...]} whole words
  explain text not null,
  primary key (level, ord)
);
insert into public.warrior_questions (level, ord, kind, prompt, options, answer, explain) values
  (2, 1, 'choice', 'How many players does each team have on the field in men''s field lacrosse?', '["6", "10", "11", "12"]', '{"index": 1}', 'Ten: three attack, three midfield, three defense and a goalie.'),
  (2, 2, 'choice', 'In men''s field lacrosse, what restarts play at the start of each quarter and after a goal?', '["A free clear", "A faceoff", "A goalie throw", "A draw"]', '{"index": 1}', 'A faceoff at the center X. The women''s game uses a draw instead.'),
  (2, 3, 'choice', 'The circle around the goal that attackers may not step into is called the…', '["Crease", "Box", "Alley", "Hole"]', '{"index": 0}', 'The crease. Attackers can reach in with the stick, but their feet stay out.'),
  (2, 4, 'choice', 'To stay onside in men''s field lacrosse, how many players must a team keep on its defensive half, counting the goalie?', '["3", "4", "5", "6"]', '{"index": 1}', 'Four back, including the goalie, and three on the offensive half.'),
  (2, 5, 'written', 'How many long poles may one team have on the field at once in men''s field lacrosse? Answer with a number.', null, '{"any": ["4", "four"]}', 'Four: usually three close defenders and one long-stick middie.'),
  (4, 1, 'choice', 'Who first played the game we now call lacrosse?', '["French settlers in Quebec", "Indigenous peoples of North America", "British soldiers in the 1800s", "College students in Baltimore"]', '{"index": 1}', 'Indigenous nations across North America played it long before Europeans arrived.'),
  (4, 2, 'choice', 'The name "lacrosse" comes from which language?', '["French", "Spanish", "Mohawk", "Latin"]', '{"index": 0}', 'French. A Jesuit missionary in the 1630s compared the stick to a bishop''s crosier, la crosse.'),
  (4, 3, 'choice', 'Which country won the men''s lacrosse gold medal at the 1904 and 1908 Olympics?', '["United States", "Great Britain", "Canada", "Australia"]', '{"index": 2}', 'Canada won both times.'),
  (4, 4, 'choice', 'Lacrosse returns to the Olympics at Los Angeles 2028 in which format?', '["Field (10 a side)", "Box", "Sixes", "Intercrosse"]', '{"index": 2}', 'Sixes: six a side on a smaller field, with a faster game.'),
  (4, 5, 'written', 'The Haudenosaunee call lacrosse a gift. Fill in the blank: "The ___''s Game."', null, '{"any": ["creator", "creators", "creator s"]}', 'The Creator''s Game. For the Haudenosaunee it is a medicine game as well as a sport.'),
  (5, 1, 'choice', 'Which pro league did brothers Paul and Mike Rabil found?', '["National Lacrosse League", "Premier Lacrosse League", "Major League Lacrosse", "Athletes Unlimited"]', '{"index": 1}', 'The Premier Lacrosse League (PLL), founded in 2018.'),
  (5, 2, 'choice', 'In 2020 the PLL merged with which older outdoor league?', '["National Lacrosse League", "Major League Lacrosse", "Canadian Lacrosse League", "Western Lacrosse Association"]', '{"index": 1}', 'Major League Lacrosse (MLL) merged into the PLL at the end of 2020.'),
  (5, 3, 'choice', 'What does a jersey sponsor pay a team for?', '["A share of ticket sales", "Showing its brand to the team''s fans", "Playing time for its players", "The right to pick the coach"]', '{"index": 1}', 'Sponsors pay to put their brand in front of the team''s fans.'),
  (5, 4, 'written', 'College athletes can now be paid for their NIL. What does NIL stand for?', null, '{"all": ["name", "image", "likeness"]}', 'Name, image and likeness. NCAA athletes have been able to earn from it since July 2021.'),
  (5, 5, 'written', 'The National Lacrosse League (NLL) plays which kind of lacrosse?', null, '{"any": ["box", "indoor"]}', 'Box lacrosse, indoors on a hockey-sized floor.');

create table public.warrior_progress (
  person_id uuid not null references public.people (id) on delete cascade,
  level integer not null references public.warrior_tiers (level),
  best_score integer not null default 0,
  attempts integer not null default 0,
  passed_at timestamptz,
  points integer not null default 0,
  last_at timestamptz not null default now(),
  primary key (person_id, level)
);

alter table public.warrior_tiers enable row level security;
alter table public.warrior_questions enable row level security;
alter table public.warrior_progress enable row level security;
revoke all on public.warrior_tiers, public.warrior_questions, public.warrior_progress from anon, authenticated;
grant select on public.warrior_tiers to authenticated;
create policy warrior_tiers_read on public.warrior_tiers for select to authenticated using (true);
grant select on public.warrior_progress to authenticated;
create policy warrior_progress_self on public.warrior_progress for select to authenticated using (person_id = public.current_person_id());
-- warrior_questions: no browser access at all; the answers live only here.

-- Players placed before tiers existed get tier 1 for it.
insert into public.warrior_progress (person_id, level, best_score, attempts, passed_at, points)
  select id, 1, 5, 1, placed_at, 1000 from public.people where placed_at is not null
  on conflict do nothing;

create function public.warrior_unlocked(p_person uuid, p_level integer) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_level = 1 or exists (select 1 from public.warrior_progress where person_id = p_person and level = p_level - 1 and passed_at is not null)
$$;

-- Records one attempt; pays the tier's points the first time it is passed.
create function public.warrior_record(p_person uuid, p_level integer, p_score integer) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare t public.warrior_tiers%rowtype; prev public.warrior_progress%rowtype; passed boolean; paid integer := 0;
begin
  select * into t from public.warrior_tiers where level = p_level;
  select * into prev from public.warrior_progress where person_id = p_person and level = p_level for update;
  passed := p_score >= t.pass_score;
  if passed and prev.passed_at is null then paid := t.reward_points; end if;
  insert into public.warrior_progress (person_id, level, best_score, attempts, passed_at, points, last_at)
    values (p_person, p_level, p_score, 1, case when passed then now() end, paid, now())
    on conflict (person_id, level) do update set
      best_score = greatest(public.warrior_progress.best_score, p_score),
      attempts = public.warrior_progress.attempts + 1,
      passed_at = coalesce(public.warrior_progress.passed_at, case when passed then now() end),
      points = public.warrior_progress.points + paid,
      last_at = now();
  return jsonb_build_object('level', p_level, 'score', p_score, 'pass_score', t.pass_score, 'passed', passed,
    'newly_passed', paid > 0, 'points_awarded', paid, 'next_unlocked', passed and p_level < 5);
end
$$;

-- The questions for a quiz tier, without answers. Only once the tier is unlocked.
create function public.warrior_questions_for(p_level integer) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.current_person_id();
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not public.warrior_unlocked(me, p_level) then raise exception 'Pass the tier before this one first.' using errcode = '42501'; end if;
  return (select jsonb_agg(jsonb_build_object('ord', q.ord, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options) order by q.ord)
          from public.warrior_questions q join public.warrior_tiers t on t.level = q.level where q.level = p_level and t.kind = 'quiz');
end
$$;

-- Grades a quiz tier. A written answer counts when it holds an accepted word ("any") or all the
-- required words ("all"), as whole words, ignoring case and punctuation.
create function public.warrior_submit_quiz(p_level integer, p_answers jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); q record; given text; ok boolean; score integer := 0; out jsonb := '[]'::jsonb; rec jsonb;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if (select kind from public.warrior_tiers where level = p_level) is distinct from 'quiz' then raise exception 'That tier is not a quiz.'; end if;
  if not public.warrior_unlocked(me, p_level) then raise exception 'Pass the tier before this one first.' using errcode = '42501'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'Answers go by question number.'; end if;
  for q in select * from public.warrior_questions where level = p_level order by ord loop
    given := left(coalesce(p_answers ->> q.ord::text, ''), 200);
    if q.kind = 'choice' then
      ok := given ~ '^\d$' and given::integer = (q.answer ->> 'index')::integer;
    else
      given := ' ' || trim(regexp_replace(lower(given), '[^a-z0-9]+', ' ', 'g')) || ' ';
      ok := case when q.answer ? 'all'
        then not exists (select 1 from jsonb_array_elements_text(q.answer -> 'all') w where position(' ' || w || ' ' in given) = 0)
        else exists (select 1 from jsonb_array_elements_text(q.answer -> 'any') w where position(' ' || w || ' ' in given) > 0) end;
    end if;
    if ok then score := score + 1; end if;
    out := out || jsonb_build_object('ord', q.ord, 'correct', ok, 'explain', q.explain);
  end loop;
  rec := public.warrior_record(me, p_level, score);
  return rec || jsonb_build_object('results', out);
end
$$;

-- A games tier after placement (tier 3): five challenges graded on the device with the existing
-- rules, on five different concepts. A pass is a good or perfect.
create function public.warrior_submit_games(p_level integer, p_results jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); r jsonb; score integer := 0;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_level = 1 then raise exception 'Tier 1 is the placement round.'; end if;
  if (select kind from public.warrior_tiers where level = p_level) is distinct from 'games' then raise exception 'That tier is not a games tier.'; end if;
  if not public.warrior_unlocked(me, p_level) then raise exception 'Pass the tier before this one first.' using errcode = '42501'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) <> 5 then raise exception 'A games tier is exactly five challenges.'; end if;
  if (select count(distinct x->>'concept') from jsonb_array_elements(p_results) x) <> 5 then raise exception 'Use five different concepts.'; end if;
  for r in select * from jsonb_array_elements(p_results) loop
    insert into public.results (person_id, idea_id, concept, grade, xp, ranked)
      values (me, left(r->>'idea_id', 80), r->>'concept', r->>'grade', case r->>'grade' when 'perfect' then 150 when 'good' then 80 else 0 end, false);
    if r->>'grade' <> 'miss' then score := score + 1; end if;
  end loop;
  return public.warrior_record(me, p_level, score);
end
$$;

-- Placement is tier 1: finishing it passes the tier.
create or replace function public.placement_submit(p_results jsonb) returns numeric
  language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.current_person_id(); r jsonb; seed numeric; passed integer := 0;
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
    if r->>'grade' <> 'miss' then passed := passed + 1; end if;
  end loop;
  select round(avg(rating), 1) into seed from public.ratings where person_id = me;
  update public.people set placed_at = now(), seed_rating = seed where id = me;
  perform public.warrior_record(me, 1, greatest(passed, 1));
  return seed;
end
$$;

-- Points: what passed tiers paid, minus points held or spent on redemptions.
create or replace function public.points_balance(p_person uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(points) from public.warrior_progress where person_id = p_person), 0)
        - coalesce((select sum(points) from public.point_redemptions where person_id = p_person and status in ('reserved', 'sent')), 0))::integer
$$;

-- The tiers as the team page shows them.
create function public.warrior_board() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('level', t.level, 'name', t.name, 'kind', t.kind, 'reward_points', t.reward_points,
      'pass_score', t.pass_score, 'blurb', t.blurb, 'unlocked', public.warrior_unlocked(public.current_person_id(), t.level),
      'passed', p.passed_at is not null, 'best_score', coalesce(p.best_score, 0), 'attempts', coalesce(p.attempts, 0)) order by t.level), '[]'::jsonb)
  from public.warrior_tiers t
  left join public.warrior_progress p on p.level = t.level and p.person_id = public.current_person_id()
$$;

revoke all on function public.warrior_unlocked(uuid, integer), public.warrior_record(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.warrior_questions_for(integer), public.warrior_submit_quiz(integer, jsonb),
  public.warrior_submit_games(integer, jsonb), public.warrior_board() from public, anon;
grant execute on function public.warrior_questions_for(integer), public.warrior_submit_quiz(integer, jsonb),
  public.warrior_submit_games(integer, jsonb), public.warrior_board() to authenticated;
