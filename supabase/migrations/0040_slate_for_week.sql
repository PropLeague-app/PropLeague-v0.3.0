-- 0040_slate_for_week.sql (1.2.11)
--
-- The NFL Slate list only ever draws moneyline, spread and total. It was being served by
-- `select * from real_games`, which hands over the whole bookmakers blob: every US book, every
-- market, every player prop for every game that week. Measured on week 5 that is 1105 kB for 15
-- games, downloaded and re-mapped on the main thread every time the tab is opened, which is what
-- made the tab visibly lag (see chat, Oct 2026).
--
-- slate_for_week returns the same rows with bookmakers filtered to the three game-level markets.
-- Same week 5: 54 kB, about a twentieth. Props are untouched and still come through the normal
-- `real_games` read that Game Details, the prop picker and the matchup screen already use.
--
-- security invoker on purpose: real_games has RLS with a read policy for authenticated users, and
-- this must stay subject to it rather than quietly reading as the definer.

create or replace function public.slate_for_week(p_week text)
returns table (
  id text,
  sport_key text,
  week text,
  day_slot text,
  kickoff timestamptz,
  home_team text,
  away_team text,
  status text,
  home_score numeric,
  away_score numeric,
  bookmakers jsonb,
  updated_at timestamptz,
  props_updated_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    g.id,
    g.sport_key,
    g.week,
    g.day_slot,
    g.kickoff,
    g.home_team,
    g.away_team,
    g.status,
    g.home_score,
    g.away_score,
    -- Each book keeps its key and title, and only the markets the slate draws. A book left with no
    -- game-level markets at all is dropped rather than returned empty.
    coalesce((
      select jsonb_agg(jsonb_build_object('key', bk->>'key', 'title', bk->>'title', 'markets', mk.markets))
      from jsonb_array_elements(g.bookmakers) bk
      cross join lateral (
        select coalesce(jsonb_agg(m), '[]'::jsonb) as markets
        from jsonb_array_elements(bk->'markets') m
        where m->>'key' in ('h2h', 'spreads', 'totals')
      ) mk
      where jsonb_array_length(mk.markets) > 0
    ), '[]'::jsonb) as bookmakers,
    g.updated_at,
    g.props_updated_at
  from public.real_games g
  where g.week = p_week;
$$;

grant execute on function public.slate_for_week(text) to authenticated;
