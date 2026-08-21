-- BandAid v1.9.1 — Worship Leader exit ends the session for everyone
-- Run once in Supabase SQL Editor after the v1.9 setup/fixes.

-- 1) Track whether a session is still active.
alter table public.band_sessions
add column if not exists is_active boolean not null default true;

alter table public.band_sessions
add column if not exists ended_at timestamptz;

-- 2) Members may read ONLY sessions they belong to.
-- This is needed so their clients can receive the session-ended Realtime update.
drop policy if exists "Members can view joined sessions" on public.band_sessions;
create policy "Members can view joined sessions"
on public.band_sessions
for select
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.session_members sm
    where sm.session_id = band_sessions.id
      and sm.user_id = auth.uid()
  )
);

grant select on table public.band_sessions to authenticated;

-- 3) Nobody may join a session after the Worship Leader has ended it.
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
  where upper(code) = upper(trim(join_code))
    and is_active = true;

  if target_session is null then
    raise exception 'Session not found or has ended';
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

-- 4) One leave function for every role.
-- If the caller created the session, ending it marks the session inactive.
-- Every connected client receives that Realtime update and is immediately booted.
-- Ordinary members simply remove their own membership.
create or replace function public.leave_band_session(target_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_creator uuid;
  session_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select created_by, is_active
  into session_creator, session_active
  from public.band_sessions
  where id = target_session;

  if session_creator is null then
    return 'already-ended';
  end if;

  if session_creator = auth.uid() then
    update public.band_sessions
    set is_active = false,
        ended_at = now()
    where id = target_session
      and is_active = true;

    return 'ended';
  end if;

  delete from public.session_members
  where session_id = target_session
    and user_id = auth.uid();

  return 'left';
end;
$$;

revoke all on function public.leave_band_session(uuid) from public;
grant execute on function public.leave_band_session(uuid) to authenticated;

-- 5) Publish session state changes through Realtime.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'band_sessions'
  ) then
    alter publication supabase_realtime add table public.band_sessions;
  end if;
end $$;
