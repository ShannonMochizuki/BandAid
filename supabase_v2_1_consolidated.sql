-- BandAid v2.1 — Consolidated account, library and admin migration
-- Intended upgrade path: current v1.9.2 backend -> first account-based beta.
-- Do NOT run the separate v2.0 / v2.0.1 migrations if you use this file.
--
-- BEFORE RUNNING: replace CHANGE_THIS_BETA_CODE with your private beta invite code.

-- ============================================================
-- 1) PRIVATE BETA SETTINGS
-- ============================================================
create schema if not exists private;

create table if not exists private.bandaid_settings (
  singleton boolean primary key default true check (singleton = true),
  beta_invite_code text not null,
  signup_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into private.bandaid_settings(singleton, beta_invite_code, signup_enabled)
values (true, 'CHANGE_THIS_BETA_CODE', true)
on conflict (singleton) do update
set beta_invite_code = excluded.beta_invite_code,
    signup_enabled = excluded.signup_enabled,
    updated_at = now();

do $$
begin
  if exists (
    select 1 from private.bandaid_settings
    where singleton = true and beta_invite_code = 'CHANGE_THIS_BETA_CODE'
  ) then
    raise exception 'Replace CHANGE_THIS_BETA_CODE with your private beta access code, then run again.';
  end if;
end $$;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- ============================================================
-- 2) USER PROFILES
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_username text not null,
  is_admin boolean not null default false,
  pin_reset_required boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists pin_reset_required boolean not null default false;

create or replace function public.handle_bandaid_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uname text;
  supplied_code text;
  expected_code text;
  signup_open boolean;
begin
  uname := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  -- Ignore legacy anonymous accounts created by older BandAid builds.
  if uname = '' then
    return new;
  end if;

  if uname !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Invalid BandAid username';
  end if;

  select beta_invite_code, signup_enabled
  into expected_code, signup_open
  from private.bandaid_settings
  where singleton = true;

  if coalesce(signup_open, false) is not true then
    raise exception 'BandAid account creation is currently closed';
  end if;

  supplied_code := trim(coalesce(new.raw_user_meta_data ->> 'beta_invite_code', ''));
  if supplied_code = '' or supplied_code <> expected_code then
    raise exception 'Invalid BandAid beta access code';
  end if;

  insert into public.profiles(id, username, display_username)
  values (
    new.id,
    uname,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_username'), ''), uname)
  );

  return new;
end;
$$;

drop trigger if exists on_bandaid_auth_user_created on auth.users;
create trigger on_bandaid_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_bandaid_user_created();

alter table public.profiles enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
on public.profiles for select to authenticated
using (id = auth.uid());

grant select on table public.profiles to authenticated;

-- Allows a user to clear ONLY their own forced-reset flag after changing PIN.
create or replace function public.clear_pin_reset_required()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles set pin_reset_required = false where id = auth.uid();
end;
$$;
revoke all on function public.clear_pin_reset_required() from public;
grant execute on function public.clear_pin_reset_required() to authenticated;

-- ============================================================
-- 3) SHARED MASTER LIBRARY + PRIVATE PERSONAL COPIES
-- ============================================================
create table if not exists public.master_songs (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  title text not null,
  artist text not null default '',
  role text not null check (role in ('Worship Leader','Singers','Electric Guitar','Acoustic Guitar','Bass Guitar','Drum')),
  song_key text not null default '',
  capo text not null default '',
  bpm text not null default '',
  chords text not null default '',
  tabs text not null default '',
  notes text not null default '',
  shapes jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_song_copies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null references public.master_songs(id) on delete cascade,
  song_key text not null default '',
  capo text not null default '',
  bpm text not null default '',
  chords text not null default '',
  tabs text not null default '',
  notes text not null default '',
  shapes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, song_id)
);

alter table public.master_songs enable row level security;
alter table public.user_song_copies enable row level security;

drop policy if exists "Authenticated users read master songs" on public.master_songs;
create policy "Authenticated users read master songs"
on public.master_songs for select to authenticated using (true);

drop policy if exists "Admin creates master songs" on public.master_songs;
create policy "Admin creates master songs"
on public.master_songs for insert to authenticated
with check (
  created_by = auth.uid() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  )
);

drop policy if exists "Admin updates master songs" on public.master_songs;
create policy "Admin updates master songs"
on public.master_songs for update to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "Admin deletes master songs" on public.master_songs;
create policy "Admin deletes master songs"
on public.master_songs for delete to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "Users read own song copies" on public.user_song_copies;
create policy "Users read own song copies"
on public.user_song_copies for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users create own song copies" on public.user_song_copies;
create policy "Users create own song copies"
on public.user_song_copies for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Users update own song copies" on public.user_song_copies;
create policy "Users update own song copies"
on public.user_song_copies for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users delete own song copies" on public.user_song_copies;
create policy "Users delete own song copies"
on public.user_song_copies for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on table public.master_songs to authenticated;
grant select, insert, update, delete on table public.user_song_copies to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists touch_master_songs_updated_at on public.master_songs;
create trigger touch_master_songs_updated_at before update on public.master_songs
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_user_song_copies_updated_at on public.user_song_copies;
create trigger touch_user_song_copies_updated_at before update on public.user_song_copies
for each row execute procedure public.touch_updated_at();

-- ============================================================
-- 4) LIVE SESSION HEARTBEAT / STALE DETECTION
-- Existing v1.9.1 tables/functions are retained and upgraded.
-- ============================================================
-- Ensure session membership cannot be self-created directly; joining must use the secured RPC.
drop policy if exists "Users can join sessions" on public.session_members;

alter table public.band_sessions add column if not exists is_active boolean not null default true;
alter table public.band_sessions add column if not exists ended_at timestamptz;
alter table public.band_sessions add column if not exists leader_last_seen timestamptz not null default now();
alter table public.band_sessions add column if not exists ended_by text;

grant select on table public.band_sessions to authenticated;
grant select on table public.session_members to authenticated;
grant select, insert on table public.worship_cues to authenticated;
grant usage, select on sequence public.worship_cues_id_seq to authenticated;

create or replace function public.create_band_session(session_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_session_id uuid;
  clean_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  clean_code := upper(trim(session_code));
  if clean_code !~ '^[A-Z0-9]{6}$' then raise exception 'Invalid session code'; end if;

  insert into public.band_sessions(code, created_by, is_active, leader_last_seen)
  values (clean_code, auth.uid(), true, now())
  returning id into new_session_id;

  insert into public.session_members(session_id, user_id, role)
  values (new_session_id, auth.uid(), 'worship-leader')
  on conflict (session_id, user_id) do update set role = excluded.role;

  return new_session_id;
end;
$$;
revoke all on function public.create_band_session(text) from public;
grant execute on function public.create_band_session(text) to authenticated;

create or replace function public.join_band_session(join_code text, selected_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_session uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_role not in ('singer','electric-guitar','acoustic-guitar','bass-guitar','drum') then
    raise exception 'Invalid BandAid role';
  end if;

  select id into target_session
  from public.band_sessions
  where upper(code) = upper(trim(join_code)) and is_active = true;

  if target_session is null then raise exception 'Session not found or has ended'; end if;

  insert into public.session_members(session_id, user_id, role)
  values (target_session, auth.uid(), selected_role)
  on conflict (session_id, user_id) do update set role = excluded.role;

  return target_session;
end;
$$;
revoke all on function public.join_band_session(text, text) from public;
grant execute on function public.join_band_session(text, text) to authenticated;

create or replace function public.leave_band_session(target_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare session_creator uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select created_by into session_creator from public.band_sessions where id = target_session;
  if session_creator is null then return 'already-ended'; end if;

  if session_creator = auth.uid() then
    update public.band_sessions
    set is_active = false, ended_at = now(), ended_by = 'leader'
    where id = target_session and is_active = true;
    return 'ended';
  end if;

  delete from public.session_members where session_id = target_session and user_id = auth.uid();
  return 'left';
end;
$$;
revoke all on function public.leave_band_session(uuid) from public;
grant execute on function public.leave_band_session(uuid) to authenticated;

create or replace function public.heartbeat_band_session(target_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.band_sessions
  set leader_last_seen = now()
  where id = target_session and created_by = auth.uid() and is_active = true;
end;
$$;
revoke all on function public.heartbeat_band_session(uuid) from public;
grant execute on function public.heartbeat_band_session(uuid) to authenticated;

-- Ensure session state changes are available through Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'band_sessions'
  ) then
    alter publication supabase_realtime add table public.band_sessions;
  end if;
end $$;

-- ============================================================
-- 5) ADMIN-ONLY RPCs (RLS is not bypassable from the browser)
-- ============================================================
create or replace function public.is_bandaid_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_admin = true);
$$;
revoke all on function public.is_bandaid_admin() from public;
grant execute on function public.is_bandaid_admin() to authenticated;

create or replace function public.admin_list_users()
returns table(id uuid, username text, is_admin boolean, pin_reset_required boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_bandaid_admin() then raise exception 'Admin required'; end if;
  return query
  select p.id, p.username, p.is_admin, p.pin_reset_required, p.created_at
  from public.profiles p
  order by lower(p.username);
end;
$$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_list_live_sessions()
returns table(
  session_id uuid,
  code text,
  created_at timestamptz,
  leader_last_seen timestamptz,
  leader_username text,
  member_count bigint,
  is_stale boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_bandaid_admin() then raise exception 'Admin required'; end if;
  return query
  select
    s.id,
    s.code,
    s.created_at,
    s.leader_last_seen,
    coalesce(p.username, 'legacy-user')::text,
    (select count(*) from public.session_members sm where sm.session_id = s.id),
    (s.leader_last_seen < now() - interval '3 minutes')
  from public.band_sessions s
  left join public.profiles p on p.id = s.created_by
  where s.is_active = true
  order by s.created_at desc;
end;
$$;
revoke all on function public.admin_list_live_sessions() from public;
grant execute on function public.admin_list_live_sessions() to authenticated;

create or replace function public.admin_end_band_session(target_session uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed int;
begin
  if not public.is_bandaid_admin() then raise exception 'Admin required'; end if;
  update public.band_sessions
  set is_active = false, ended_at = now(), ended_by = 'admin'
  where id = target_session and is_active = true;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;
revoke all on function public.admin_end_band_session(uuid) from public;
grant execute on function public.admin_end_band_session(uuid) to authenticated;

-- ============================================================
-- 6) AFTER DEPLOYMENT
-- ============================================================
-- Create YOUR account first, then promote only your username:
-- update public.profiles set is_admin = true where username = 'YOUR_USERNAME';
-- Verify exactly one admin:
-- select username, is_admin from public.profiles where is_admin = true;
--
-- Change beta invite code later:
-- update private.bandaid_settings
-- set beta_invite_code = 'NEW_PRIVATE_CODE', updated_at = now()
-- where singleton = true;
--
-- Close/re-open new registration:
-- update private.bandaid_settings set signup_enabled = false where singleton = true;
-- update private.bandaid_settings set signup_enabled = true where singleton = true;
