-- BandAid v2.1.1 — Consolidated account, library, admin and secure beta-access migration
-- Intended upgrade path: current v1.9.2 backend -> first account-based beta.
-- Do NOT run the unreleased v2.0 / v2.0.1 / v2.1 migrations if you use this file.
--
-- SECURITY CHANGE IN v2.1.1:
--   * No beta invite code is stored in this file.
--   * Supabase stores only a salted bcrypt hash of the invite code.
--   * Signup starts CLOSED until you set the code manually in SQL Editor.
--   * The supplied beta code is removed from auth user metadata before the user row is stored.

create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- 1) PRIVATE BETA SETTINGS
-- ============================================================
create schema if not exists private;

create table if not exists private.bandaid_settings (
  singleton boolean primary key default true check (singleton = true),
  beta_invite_code_hash text,
  signup_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Safely migrate an earlier plaintext beta-code column if it exists.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='private' and table_name='bandaid_settings' and column_name='beta_invite_code'
  ) then
    execute 'alter table private.bandaid_settings add column if not exists beta_invite_code_hash text';
    execute $q$
      update private.bandaid_settings
      set beta_invite_code_hash = case
        when coalesce(beta_invite_code, '') <> '' and beta_invite_code <> 'CHANGE_THIS_BETA_CODE'
          then extensions.crypt(beta_invite_code, extensions.gen_salt('bf', 10))
        else beta_invite_code_hash
      end,
      updated_at = now()
      where singleton = true
    $q$;
    execute 'alter table private.bandaid_settings drop column beta_invite_code';
  end if;
end $$;

insert into private.bandaid_settings(singleton, beta_invite_code_hash, signup_enabled)
values (true, null, false)
on conflict (singleton) do nothing;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- Validate beta code BEFORE auth.users is inserted, then remove it from metadata
-- so the shared invite code is not retained on each user's account.
create or replace function public.validate_bandaid_beta_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uname text;
  supplied_code text;
  supplied_hash text;
  expected_hash text;
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

  select beta_invite_code_hash, signup_enabled
  into expected_hash, signup_open
  from private.bandaid_settings
  where singleton = true;

  if coalesce(signup_open, false) is not true then
    raise exception 'BandAid account creation is currently closed';
  end if;

  supplied_code := trim(coalesce(new.raw_user_meta_data ->> 'beta_invite_code', ''));
  if supplied_code = '' or expected_hash is null then
    raise exception 'Invalid BandAid beta access code';
  end if;

  supplied_hash := extensions.crypt(supplied_code, expected_hash);
  if supplied_hash <> expected_hash then
    raise exception 'Invalid BandAid beta access code';
  end if;

  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'beta_invite_code';
  return new;
end;
$$;

drop trigger if exists before_bandaid_auth_user_created on auth.users;
create trigger before_bandaid_auth_user_created
before insert on auth.users
for each row execute procedure public.validate_bandaid_beta_signup();

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
begin
  uname := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  if uname = '' then return new; end if;

  insert into public.profiles(id, username, display_username)
  values (
    new.id,
    uname,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_username'), ''), uname)
  )
  on conflict (id) do nothing;

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

-- Admin-only list of registered users for the PIN reset UI.
create or replace function public.admin_list_users()
returns table(id uuid, username text, display_username text, pin_reset_required boolean, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_username, p.pin_reset_required, p.created_at
  from public.profiles p
  where exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.is_admin = true
  )
  order by p.username;
$$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- ============================================================
-- 3) MASTER SONG LIBRARY + PRIVATE USER COPIES
-- ============================================================
create table if not exists public.master_songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null default '',
  song_key text not null default '',
  bpm integer,
  capo integer not null default 0,
  chord_lyrics text not null default '',
  tabs text not null default '',
  notes text not null default '',
  shapes jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_song_copies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  master_song_id uuid not null references public.master_songs(id) on delete cascade,
  title text not null,
  artist text not null default '',
  song_key text not null default '',
  bpm integer,
  capo integer not null default 0,
  chord_lyrics text not null default '',
  tabs text not null default '',
  personal_notes text not null default '',
  shapes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, master_song_id)
);

alter table public.master_songs enable row level security;
alter table public.user_song_copies enable row level security;

drop policy if exists "Authenticated users read master songs" on public.master_songs;
create policy "Authenticated users read master songs"
on public.master_songs for select to authenticated using (true);

drop policy if exists "Admin inserts master songs" on public.master_songs;
create policy "Admin inserts master songs"
on public.master_songs for insert to authenticated
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));

drop policy if exists "Admin updates master songs" on public.master_songs;
create policy "Admin updates master songs"
on public.master_songs for update to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));

drop policy if exists "Admin deletes master songs" on public.master_songs;
create policy "Admin deletes master songs"
on public.master_songs for delete to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));

drop policy if exists "Users read own copies" on public.user_song_copies;
create policy "Users read own copies" on public.user_song_copies
for select to authenticated using (user_id=auth.uid());

drop policy if exists "Users create own copies" on public.user_song_copies;
create policy "Users create own copies" on public.user_song_copies
for insert to authenticated with check (user_id=auth.uid());

drop policy if exists "Users update own copies" on public.user_song_copies;
create policy "Users update own copies" on public.user_song_copies
for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists "Users delete own copies" on public.user_song_copies;
create policy "Users delete own copies" on public.user_song_copies
for delete to authenticated using (user_id=auth.uid());

grant select, insert, update, delete on table public.master_songs to authenticated;
grant select, insert, update, delete on table public.user_song_copies to authenticated;

-- ============================================================
-- 4) LIVE SESSIONS + WORSHIP CUES + HEARTBEAT
-- ============================================================
-- Keep/extend the tables from v1.9.2.
alter table public.band_sessions add column if not exists is_active boolean not null default true;
alter table public.band_sessions add column if not exists ended_at timestamptz;
alter table public.band_sessions add column if not exists leader_last_seen timestamptz;
alter table public.band_sessions add column if not exists ended_by text;

-- Session creator / WL updates their heartbeat only for their own active session.
create or replace function public.heartbeat_band_session(target_session uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.band_sessions
  set leader_last_seen = now()
  where id=target_session and created_by=auth.uid() and is_active=true;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;
revoke all on function public.heartbeat_band_session(uuid) from public;
grant execute on function public.heartbeat_band_session(uuid) to authenticated;

-- Secure create: creator becomes Worship Leader server-side.
create or replace function public.create_band_session(session_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_session_id uuid; clean_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  clean_code := upper(trim(session_code));
  if clean_code !~ '^[A-Z0-9]{6}$' then raise exception 'Invalid session code'; end if;

  insert into public.band_sessions(code, created_by, is_active, leader_last_seen)
  values(clean_code, auth.uid(), true, now())
  returning id into new_session_id;

  insert into public.session_members(session_id,user_id,role)
  values(new_session_id,auth.uid(),'worship-leader')
  on conflict(session_id,user_id) do update set role='worship-leader';
  return new_session_id;
end;
$$;
revoke all on function public.create_band_session(text) from public;
grant execute on function public.create_band_session(text) to authenticated;

-- Joining devices cannot grant themselves Worship Leader.
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
  select id into target_session from public.band_sessions
  where upper(code)=upper(trim(join_code)) and is_active=true;
  if target_session is null then raise exception 'Session not found or has ended'; end if;
  insert into public.session_members(session_id,user_id,role)
  values(target_session,auth.uid(),selected_role)
  on conflict(session_id,user_id) do update set role=excluded.role;
  return target_session;
end;
$$;
revoke all on function public.join_band_session(text,text) from public;
grant execute on function public.join_band_session(text,text) to authenticated;

create or replace function public.leave_band_session(target_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare session_creator uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select created_by into session_creator from public.band_sessions where id=target_session;
  if session_creator is null then return 'already-ended'; end if;
  if session_creator=auth.uid() then
    update public.band_sessions set is_active=false, ended_at=now(), ended_by='leader'
    where id=target_session and is_active=true;
    return 'ended';
  end if;
  delete from public.session_members where session_id=target_session and user_id=auth.uid();
  return 'left';
end;
$$;
revoke all on function public.leave_band_session(uuid) from public;
grant execute on function public.leave_band_session(uuid) to authenticated;

-- Members may read only sessions they created or joined.
drop policy if exists "Members can view joined sessions" on public.band_sessions;
create policy "Members can view joined sessions"
on public.band_sessions for select to authenticated
using (
  created_by=auth.uid() or exists (
    select 1 from public.session_members sm
    where sm.session_id=band_sessions.id and sm.user_id=auth.uid()
  )
);
grant select on table public.band_sessions to authenticated;
grant select on table public.session_members to authenticated;
grant select, insert on table public.worship_cues to authenticated;
grant usage, select on sequence public.worship_cues_id_seq to authenticated;

-- Ensure relevant tables are published for Realtime.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='band_sessions') then
    alter publication supabase_realtime add table public.band_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='worship_cues') then
    alter publication supabase_realtime add table public.worship_cues;
  end if;
end $$;

-- ============================================================
-- 5) ADMIN LIVE-SESSION CONTROL
-- ============================================================
create or replace function public.admin_live_sessions()
returns table(
  id uuid, code text, created_by uuid, leader_username text,
  is_active boolean, created_at timestamptz, leader_last_seen timestamptz,
  member_count bigint, is_stale boolean
)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.code, s.created_by, coalesce(p.display_username,p.username,'Unknown'),
         s.is_active, s.created_at, s.leader_last_seen,
         (select count(*) from public.session_members sm where sm.session_id=s.id),
         (s.is_active and (s.leader_last_seen is null or s.leader_last_seen < now()-interval '3 minutes'))
  from public.band_sessions s
  left join public.profiles p on p.id=s.created_by
  where s.is_active=true
    and exists(select 1 from public.profiles me where me.id=auth.uid() and me.is_admin=true)
  order by s.created_at desc;
$$;
revoke all on function public.admin_live_sessions() from public;
grant execute on function public.admin_live_sessions() to authenticated;

create or replace function public.admin_end_band_session(target_session uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then
    raise exception 'Admin access required';
  end if;
  update public.band_sessions
  set is_active=false, ended_at=now(), ended_by='admin'
  where id=target_session and is_active=true;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;
revoke all on function public.admin_end_band_session(uuid) from public;
grant execute on function public.admin_end_band_session(uuid) to authenticated;

-- ============================================================
-- 6) AFTER THIS MIGRATION
-- ============================================================
-- IMPORTANT: signup is intentionally CLOSED until you set a beta code manually.
-- In Supabase SQL Editor, run the following manually with YOUR chosen code.
-- Do not save the real code in GitHub or an app file:
--
-- update private.bandaid_settings
-- set beta_invite_code_hash = extensions.crypt('YOUR_PRIVATE_BETA_CODE', extensions.gen_salt('bf', 10)),
--     signup_enabled = true,
--     updated_at = now()
-- where singleton = true;
--
-- To rotate the beta code later, run the same UPDATE with a new code.
-- To close registration:
-- update private.bandaid_settings set signup_enabled=false, updated_at=now() where singleton=true;
--
-- Create YOUR account first, then promote only your username:
-- update public.profiles set is_admin=true where username='YOUR_USERNAME';
-- Verify exactly one admin:
-- select username,is_admin from public.profiles where is_admin=true;
