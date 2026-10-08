-- One-off: post the Skunked card for skunked weeks that were already settled before settle-week
-- started announcing them (settle-week only looks at the week that just finished, so it never goes
-- back). Safe to run more than once: each team-week is claimed in notification_dedup first (the same
-- key settle-week uses), so nothing posts twice, and settle-week will not post these again later.
--
-- A skunked week matches src/engine/skunkedWeek.ts: the week is decided, every slot is filled,
-- nothing is pending, there is no win or push, and at least three picks lost (voids are ignored).
-- Only leagues whose commissioner turned "Announce skunked weeks" on are touched.
--
-- Each card is dated to its own week (7 days apart, counting back from the league's latest week), so
-- the feed reads in order. Leagues with non-numeric week labels fall back to "now". Run it in the
-- SQL Editor.
--
-- To redo cards an earlier run posted with the wrong timestamps, clear them first, then run again:
--   delete from public.activity_items where message like '%::sk::%';
--   delete from public.notification_dedup where key like 'skunked:%';
do $$
declare
  r record;
  v_week_text text;
  v_name text;
  v_pl text;
  v_claimed text;
begin
  for r in
    select
      l.id as league_id,
      ro.team_id,
      ro.week,
      t.team_name,
      count(*) filter (where w.status = 'lost') as losses,
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
    where l.settings ->> 'skunkedAnnouncements' = 'true'
      and l.season_start_week is not null
      and (ro.week !~ '^[0-9]+$' or l.season_start_week !~ '^[0-9]+$' or ro.week::int >= l.season_start_week::int)
    group by l.id, l.settings, ro.team_id, ro.week, t.team_name
    having count(*) = coalesce(
             (select sum(value::int) from jsonb_each_text(l.settings -> 'lineupSlots')),
             8)
       and count(*) filter (where w.status in ('pending', 'won', 'push')) = 0
       and count(*) filter (where w.status = 'lost') >= 3
    order by l.id, ro.week
  loop
    insert into public.notification_dedup (key)
    values ('skunked:' || r.league_id || ':' || r.week || ':' || r.team_id)
    on conflict do nothing
    returning key into v_claimed;
    if v_claimed is null then
      continue; -- already announced
    end if;

    v_week_text := case when r.week ~ '^[0-9]+$' then 'Week ' || r.week else r.week end;
    v_name := regexp_replace(r.team_name, '[*|]|::(sk|pw)::', '', 'g');
    v_pl := (case when r.pl < 0 then '-' else '+' end) || '$' || to_char(abs(round(r.pl, 2)), 'FM999990.00');
    insert into public.activity_items (league_id, type, message, pinned, ts)
    values (
      r.league_id, 'announcement',
      '🦨 **' || v_name || '** got skunked in **' || v_week_text || '**. 0-' || r.losses || ', ' || v_pl
        || '::sk::' || v_week_text || '|' || v_name || '|0-' || r.losses || '|' || v_pl || '|' || r.team_id,
      false,
      case when r.week ~ '^[0-9]+$' and r.latest_week is not null
        then now() - ((r.latest_week - r.week::int) * interval '7 days')
        else now() end
    );
    raise notice 'Posted skunked week: % %', r.team_name, v_week_text;
  end loop;
end
$$;
