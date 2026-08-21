-- BandAid v1.9 security migration
-- Run this once in Supabase SQL Editor before using live sessions.

-- Remove the broad direct-insert policy. Session membership should be created
-- only through the two SECURITY DEFINER functions below.
drop policy if exists "Users can join sessions" on public.session_members;

-- Create a session and atomically make its creator the Worship Leader.
create or replace function public.create_band_session(session_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_session uuid;
  clean_code text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  clean_code := upper(trim(session_code));
  if clean_code !~ '^[A-Z2-9]{6,8}$' then
    raise exception 'Invalid session code';
  end if;

  insert into public.band_sessions (code, created_by)
  values (clean_code, auth.uid())
  returning id into new_session;

  insert into public.session_members (session_id, user_id, role)
  values (new_session, auth.uid(), 'worship-leader');

  return new_session;
end;
$$;

revoke all on function public.create_band_session(text) from public;
grant execute on function public.create_band_session(text) to authenticated;

-- Join an existing session. A joining device may NOT self-assign Worship Leader.
create or replace function public.join_band_session(
  join_code text,
  selected_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if selected_role not in (
    'singer',
    'electric-guitar',
    'acoustic-guitar',
    'bass-guitar',
    'drum'
  ) then
    raise exception 'Invalid BandAid role';
  end if;

  select id
  into target_session
  from public.band_sessions
  where upper(code) = upper(trim(join_code));

  if target_session is null then
    raise exception 'Session not found';
  end if;

  insert into public.session_members (session_id, user_id, role)
  values (target_session, auth.uid(), selected_role)
  on conflict (session_id, user_id)
  do update set role = excluded.role;

  return target_session;
end;
$$;

revoke all on function public.join_band_session(text, text) from public;
grant execute on function public.join_band_session(text, text) to authenticated;

-- Ensure Realtime publication exists for worship cues. Safe to run if already added.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'worship_cues'
  ) then
    alter publication supabase_realtime add table public.worship_cues;
  end if;
end $$;

-- The project was created with "Automatically expose new tables" disabled,
-- so explicitly grant only the table operations the browser genuinely needs.
grant select, insert on table public.worship_cues to authenticated;
grant usage, select on sequence public.worship_cues_id_seq to authenticated;
