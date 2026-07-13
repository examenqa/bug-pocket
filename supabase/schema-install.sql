-- Bug Pocket Supabase installation schema.
-- This idempotent BYOC installer provisions the identity layer, workspace-scoped
-- data layer, storage buckets, and RLS policies. Re-run it safely after upgrades;
-- use explicit migrations when an existing object's definition must change.

create extension if not exists pgcrypto;

-- 1. Identity & Workspace Layer
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  constraint workspace_members_role_check check (role in ('member', 'developer', 'admin', 'owner'))
);

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('member', 'developer', 'admin', 'owner'));

-- 2. Core Data Layer (SQLite mirrors, injected with workspace_id)
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  context_description text null,
  is_active boolean not null default true,
  is_synced boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists modules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  application_id uuid null references applications(id) on delete set null,
  name text not null,
  context_description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists environments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  context_description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists reference_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null check (type in ('device', 'browser', 'user_role')),
  name text not null,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, type, value)
);

create table if not exists bugs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  application_id uuid null references applications(id) on delete set null,
  module_id uuid null references modules(id) on delete set null,
  environment_id uuid null references environments(id) on delete set null,
  device_id uuid null references reference_options(id) on delete set null,
  browser_id uuid null references reference_options(id) on delete set null,
  user_role_id uuid null references reference_options(id) on delete set null,
  entry_type text not null default 'Bug',
  title text not null default '',
  note text not null default '',
  other_details text not null default '',
  steps_to_reproduce text not null default '',
  expected_result text not null default '',
  actual_result text not null default '',
  status text not null default 'Draft' check (status in ('Draft', 'Reported', 'Discarded')),
  severity text not null default 'Medium',
  reported boolean not null default false,
  issue_platform text not null default '',
  issue_id text not null default '',
  issue_url text not null default '',
  tags text not null default '',
  sync_status text not null default 'Sync Pending',
  last_sync_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  bug_id uuid null references bugs(id) on delete cascade,
  parent_id uuid null references attachments(id) on delete set null,
  content_hash text null,
  file_extension text not null default '.png',
  mime_type text not null,
  source_type text not null default 'other',
  sync_status text not null default 'Sync Pending',
  last_sync_at timestamptz null,
  storage_bucket text null,
  storage_key text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table bugs add column if not exists deleted_at timestamptz null;
alter table attachments add column if not exists updated_at timestamptz not null default now();
alter table attachments add column if not exists deleted_at timestamptz null;

create table if not exists config_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists report_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  template_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sync_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid null,
  local_seq bigint null,
  op_id uuid null,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null,
  payload jsonb not null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_members_workspace_user on workspace_members(workspace_id, user_id);
create index if not exists idx_workspace_members_user on workspace_members(user_id);
create index if not exists idx_applications_workspace on applications(workspace_id);
create index if not exists idx_modules_workspace_app on modules(workspace_id, application_id);
create index if not exists idx_environments_workspace on environments(workspace_id);
create index if not exists idx_reference_options_workspace_type on reference_options(workspace_id, type);
create index if not exists idx_bugs_workspace_updated on bugs(workspace_id, updated_at desc) where deleted_at is null;
create index if not exists idx_attachments_workspace_bug on attachments(workspace_id, bug_id) where deleted_at is null;
create index if not exists idx_sync_events_workspace_seq on sync_events(workspace_id, local_seq);

-- 3. Security Hardening
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table applications enable row level security;
alter table modules enable row level security;
alter table environments enable row level security;
alter table reference_options enable row level security;
alter table bugs enable row level security;
alter table attachments enable row level security;
alter table config_options enable row level security;
alter table report_templates enable row level security;
alter table sync_events enable row level security;

-- 4. Performance-Optimized RLS Helper Function
-- SECURITY DEFINER avoids recursive RLS checks on workspace_members.
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
  );
$$ language sql security definer set search_path = public;

create or replace function public.is_workspace_admin(ws_id uuid)
returns boolean as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and role in ('admin', 'owner')
  );
$$ language sql security definer set search_path = public;

create or replace function public.is_workspace_writer(ws_id uuid)
returns boolean as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  );
$$ language sql security definer set search_path = public;

-- 5. RLS Policies
-- PostgreSQL has no CREATE POLICY IF NOT EXISTS. Install missing policies from a
-- declarative matrix and preserve existing policies during subsequent runs.
-- Remove only obsolete permissive policies from pre-installation-schema drafts.
drop policy if exists "users can insert memberships for owned bootstrap workspaces" on workspace_members;
drop policy if exists "workspace members can insert applications" on applications;
drop policy if exists "workspace members can manage applications" on applications;
drop policy if exists "workspace members can insert modules" on modules;
drop policy if exists "workspace members can manage modules" on modules;
drop policy if exists "workspace members can insert reference options" on reference_options;
drop policy if exists "workspace members can manage reference options" on reference_options;
drop policy if exists "workspace members can insert bugs" on bugs;
drop policy if exists "workspace members can fully manage bugs in their workspace" on bugs;
drop policy if exists "workspace members can insert attachments" on attachments;
drop policy if exists "workspace members can manage attachments" on attachments;
drop policy if exists "workspace members can insert config options" on config_options;
drop policy if exists "workspace members can manage config options" on config_options;
drop policy if exists "workspace members can insert report templates" on report_templates;
drop policy if exists "workspace members can manage report templates" on report_templates;
drop policy if exists "workspace members can insert sync events" on sync_events;
drop policy if exists "workspace members can manage sync events" on sync_events;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select * from (values
      ('public', 'workspaces', 'workspace members can select their workspaces', 'for select using (public.is_workspace_member(id))'),
      ('public', 'workspaces', 'workspace admins can update their workspaces', 'for update using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id))'),
      ('public', 'workspace_members', 'users can select their workspace memberships', 'for select using (user_id = auth.uid())'),
      ('public', 'applications', 'workspace members can select applications', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'applications', 'workspace writers can insert applications', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'applications', 'workspace writers can update applications', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'applications', 'workspace writers can delete applications', 'for delete using (public.is_workspace_writer(workspace_id))'),
      ('public', 'modules', 'workspace members can select modules', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'modules', 'workspace writers can insert modules', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'modules', 'workspace writers can update modules', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'modules', 'workspace writers can delete modules', 'for delete using (public.is_workspace_writer(workspace_id))'),
      ('public', 'environments', 'workspace members can select environments', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'environments', 'workspace writers can insert environments', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'environments', 'workspace writers can update environments', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'environments', 'workspace writers can delete environments', 'for delete using (public.is_workspace_writer(workspace_id))'),
      ('public', 'reference_options', 'workspace members can select reference options', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'reference_options', 'workspace writers can insert reference options', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'reference_options', 'workspace writers can update reference options', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'reference_options', 'workspace writers can delete reference options', 'for delete using (public.is_workspace_writer(workspace_id))'),
      ('public', 'bugs', 'workspace members can select bugs', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'bugs', 'workspace writers can insert bugs', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'bugs', 'workspace writers can update bugs', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'bugs', 'workspace writers can delete bugs', 'for delete using (public.is_workspace_writer(workspace_id))'),
      ('public', 'attachments', 'workspace members can select attachments', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'attachments', 'workspace writers can insert attachments', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'attachments', 'workspace writers can update attachments', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'attachments', 'workspace writers can delete attachments', 'for delete using (public.is_workspace_writer(workspace_id))'),
      ('public', 'config_options', 'workspace members can select config options', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'config_options', 'workspace writers can insert config options', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'config_options', 'workspace writers can update config options', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'config_options', 'workspace writers can delete config options', 'for delete using (public.is_workspace_writer(workspace_id))'),
      ('public', 'report_templates', 'workspace members can select report templates', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'report_templates', 'workspace writers can insert report templates', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'report_templates', 'workspace writers can update report templates', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'report_templates', 'workspace writers can delete report templates', 'for delete using (public.is_workspace_writer(workspace_id))'),
      ('public', 'sync_events', 'workspace members can select sync events', 'for select using (public.is_workspace_member(workspace_id))'),
      ('public', 'sync_events', 'workspace writers can insert sync events', 'for insert with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'sync_events', 'workspace writers can update sync events', 'for update using (public.is_workspace_writer(workspace_id)) with check (public.is_workspace_writer(workspace_id))'),
      ('public', 'sync_events', 'workspace writers can delete sync events', 'for delete using (public.is_workspace_writer(workspace_id))')
    ) as policies(schema_name, table_name, policy_name, policy_clause)
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = policy_row.schema_name
        and tablename = policy_row.table_name
        and policyname = policy_row.policy_name
    ) then
      execute format(
        'create policy %I on %I.%I %s',
        policy_row.policy_name,
        policy_row.schema_name,
        policy_row.table_name,
        policy_row.policy_clause
      );
    end if;
  end loop;
end $$;

-- Direct client membership mutations are intentionally unsupported. Memberships
-- are provisioned only by trusted SECURITY DEFINER workflows below.

-- 6. Storage
-- Workspace attachments are private. Telemetry assets remain public so Slack can
-- unfurl screenshots submitted through the support Edge Function.
insert into storage.buckets (id, name, public)
values
  ('attachments', 'attachments', false),
  ('telemetry-assets', 'telemetry-assets', true)
on conflict (id) do nothing;

-- Extract the first path segment without risking an invalid UUID cast. Every
-- attachment object must use: <workspace_id>/<sha256>.<extension>.
create or replace function public.storage_object_workspace_id(object_name text)
returns uuid as $$
  select case
    when coalesce((storage.foldername(object_name))[1], '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[1])::uuid
    else null
  end;
$$ language sql stable set search_path = public, storage;

drop policy if exists "workspace members can insert attachment objects" on storage.objects;
drop policy if exists "workspace members can update attachment objects" on storage.objects;
drop policy if exists "workspace members can delete attachment objects" on storage.objects;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select * from (values
      ('workspace members can select attachment objects', 'for select to authenticated using (bucket_id = ''attachments'' and public.is_workspace_member(public.storage_object_workspace_id(name)))'),
      ('workspace writers can insert attachment objects', 'for insert to authenticated with check (bucket_id = ''attachments'' and public.is_workspace_writer(public.storage_object_workspace_id(name)))'),
      ('workspace writers can update attachment objects', 'for update to authenticated using (bucket_id = ''attachments'' and public.is_workspace_writer(public.storage_object_workspace_id(name))) with check (bucket_id = ''attachments'' and public.is_workspace_writer(public.storage_object_workspace_id(name)))'),
      ('workspace writers can delete attachment objects', 'for delete to authenticated using (bucket_id = ''attachments'' and public.is_workspace_writer(public.storage_object_workspace_id(name)))')
    ) as policies(policy_name, policy_clause)
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = policy_row.policy_name
    ) then
      execute format(
        'create policy %I on storage.objects %s',
        policy_row.policy_name,
        policy_row.policy_clause
      );
    end if;
  end loop;
end $$;

-- TODO: Add auth onboarding to create personal workspaces and workspace_members rows.
-- TODO: Drain local SQLite sync_queue into sync_events after login.
-- TODO: Resolve conflicts using updated_at plus deterministic client_id/local_seq/op_id.

-- 7. Base Role Privileges
-- Ensures PostgREST can access the public schema before RLS is evaluated.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;

-- Defense in depth: workspace membership is an authorization boundary. Do not
-- rely on a missing RLS policy alone; deny PostgREST roles table mutations so a
-- future permissive policy cannot accidentally restore self-enrollment.
revoke insert, update, delete on table public.workspace_members from anon, authenticated;

-- 8. Auth Onboarding Workflow
-- Automatically provisions a default workspace for new signups.
create or replace function public.handle_new_user_onboarding()
returns trigger as $$
declare
  new_workspace_id uuid;
begin
  insert into public.workspaces (name, created_by)
  values ('My Workspace', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- This trigger function deliberately remains SECURITY INVOKER. It rejects any
-- direct PostgREST mutation while allowing the trusted onboarding function,
-- which executes as its owner, to provision the initial owner membership.
create or replace function public.guard_workspace_membership_direct_writes()
returns trigger as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Direct workspace membership writes are disabled. Use an authorized invitation workflow.'
      using errcode = '42501';
  end if;

  if new.role not in ('member', 'developer', 'admin', 'owner') then
    raise exception 'Invalid workspace membership role.'
      using errcode = '23514';
  end if;

  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists guard_workspace_membership_direct_writes on public.workspace_members;
create trigger guard_workspace_membership_direct_writes
  before insert or update on public.workspace_members
  for each row execute function public.guard_workspace_membership_direct_writes();

revoke execute on function public.handle_new_user_onboarding() from anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user_onboarding();
