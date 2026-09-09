-- Step: fix "edits revert after logout" (see chat) -- team name/abbrev/logo and
-- league logo were only ever written to local device state, never to Supabase,
-- so every sign-out (which wipes local state) silently reverted them to whatever
-- was set at team-creation time. teamName/abbrev/logoColor already had columns;
-- this migration adds the two that didn't: logo_mode and logo_emoji, on both
-- `teams` and `leagues` (leagues also gets logo_color as a safety net in case it
-- wasn't already present from the original hand-created schema -- this repo's
-- core tables were set up directly in the SQL editor before migrations started,
-- so `if not exists` guards against re-declaring a column that's already there).
--
-- Both nullable: existing rows keep null until next edited/saved, and the client
-- already falls back to the same defaults it always used ('initials' mode, the
-- default trophy/team emoji) when these are null.
alter table public.teams add column if not exists logo_mode text;
alter table public.teams add column if not exists logo_emoji text;

alter table public.leagues add column if not exists logo_mode text;
alter table public.leagues add column if not exists logo_emoji text;
alter table public.leagues add column if not exists logo_color text;
