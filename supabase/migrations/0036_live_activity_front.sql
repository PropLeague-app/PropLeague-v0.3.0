-- Live Activities: which league's matchup the person chose to keep in the Dynamic Island.
--
-- iOS shows one Live Activity per app in the Dynamic Island, picked by each activity's relevance
-- score. The server sets a default score (more live picks and a closer matchup rank higher), and
-- the island's switch button lets the person pick another league. That choice is remembered here so
-- the server keeps sending the chosen league the highest score on every later push.
--
-- set_live_activity_front_by_start_token is called by the app's own switch button, which can run
-- with no signed-in session (a Live Activity button runs in the background), so like
-- register_live_activity_by_start_token it identifies the profile by the device's start token.
-- Granted to anon on purpose; useless without a valid start token.

alter table public.live_activities add column if not exists is_front boolean not null default false;

create or replace function public.set_live_activity_front_by_start_token(p_start_token text, p_activity_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile uuid;
begin
  select profile_id into v_profile from public.live_activity_start_tokens where token = p_start_token;
  if v_profile is null then
    return;
  end if;
  update public.live_activities
     set is_front = (activity_id = p_activity_id)
   where profile_id = v_profile and ended_at is null;
end;
$function$;

grant execute on function public.set_live_activity_front_by_start_token(text, text) to anon, authenticated;
