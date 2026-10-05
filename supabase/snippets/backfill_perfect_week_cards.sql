-- One-off: post the Perfect Week card for perfect weeks that were already settled before
-- settle-week started announcing them. Safe to run more than once: each team-week is claimed in
-- notification_dedup first (the same key settle-week uses), so nothing posts twice, and settle-week
-- will not post these again later.
--
-- A perfect week matches src/engine/perfectWeek.ts: the week is decided, every slot is filled, all
-- the weekly credits are placed, there are enough different games, at least one win, no losses and
-- nothing pending (voids and pushes are fine). Leagues that turned announcements off are skipped.
-- (If a league uses the invalid roster penalty, check its perfect weeks by eye afterwards.)
--
-- Each card is dated to its own week (7 days apart, counting back from the league's latest week), so
-- the feed reads in order and older perfect weeks sit further down instead of all landing on top.
-- Leagues with non-numeric week labels fall back to "now". Run it in the SQL Editor.
--
-- To redo cards an earlier run posted with "now" timestamps, clear them first, then run this again:
--   delete from public.activity_items where message like '%::pw::%';
--   delete from public.notification_dedup where key like 'perfect:%';
do $$
declare
  r record;
  v_week_text text;
  v_claimed text;
begin
  for r in
    select
      l.id as league_id,
      ro.team_id,
      ro.week,
      t.team_name,
      count(*) filter (where w.status = 'won') as wins,
      count(*) filter (where w.status in ('push', 'voided')) as pushes,
      coalesce(sum(w.settled_profit), 0) as pl,
      (select max(r2.week::int) from public.weekly_rosters r2 join public.teams t2 on t2.id = r2.team_id
         where t2.league_id = l.id and r2.week ~ '^[0-9]+$') as latest_week
    from public.leagues l
    join public.teams t on t.league_id = l.id
    join public.weekly_rosters ro on ro.team_id = t.id
    join public.wagers w on w.roster_id = ro.id
    join public.matchups m
      on m.league_id = l.id and m.week = ro.week
     and (m.team_a_id = t.id or m.team_b_id = t.id)
     and (m.winner_id is not null or m.is_tie)
    where coalesce(l.settings ->> 'perfectWeekAnnouncements', 'true') <> 'false'
      and l.season_start_week is not null
      and (ro.week !~ '^[0-9]+$' or l.season_start_week !~ '^[0-9]+$' or ro.week::int >= l.season_start_week::int)
    group by l.id, l.settings, ro.team_id, ro.week, t.team_name
    having count(*) = coalesce(
             (select sum(value::int) from jsonb_each_text(l.settings -> 'lineupSlots')),
             8)
       and count(*) filter (where w.status in ('pending', 'lost')) = 0
       and count(*) filter (where w.status = 'won') > 0
       and abs(sum(w.stake) - coalesce((l.settings ->> 'weeklyCredits')::numeric, 100)) <= 0.01
       and count(distinct w.game_id) >= coalesce((l.settings ->> 'minGamesPerRoster')::int, 2)
    order by l.id, ro.week
  loop
    insert into public.notification_dedup (key)
    values ('perfect:' || r.league_id || ':' || r.week || ':' || r.team_id)
    on conflict do nothing
    returning key into v_claimed;
    if v_claimed is null then
      continue; -- already announced
    end if;

    v_week_text := case when r.week ~ '^[0-9]+$' then 'Week ' || r.week else r.week end;
    insert into public.activity_items (league_id, type, message, pinned, ts)
    values (
      r.league_id, 'announcement',
      '🔥 **' || regexp_replace(r.team_name, '[*|]', '', 'g') || '** had a perfect week in **' || v_week_text || '**. '
        || r.wins || '-0-' || r.pushes || ', ' || (case when r.pl < 0 then '-' else '+' end) || '$' || to_char(abs(round(r.pl, 2)), 'FM999990.00')
        || '::pw::' || v_week_text || '|' || regexp_replace(r.team_name, '[*|]', '', 'g') || '|' || r.wins || '-0-' || r.pushes
        || '|' || (case when r.pl < 0 then '-' else '+' end) || '$' || to_char(abs(round(r.pl, 2)), 'FM999990.00') || '|' || r.team_id,
      false,
      case when r.week ~ '^[0-9]+$' and r.latest_week is not null
        then now() - ((r.latest_week - r.week::int) * interval '7 days')
        else now() end
    );
    raise notice 'Posted perfect week: % %', r.team_name, v_week_text;
  end loop;
end
$$;
