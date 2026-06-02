-- Bug Pocket Supabase schema draft.
-- Preparation only: the desktop MVP remains local-first and uses SQLite.
-- This draft provisions the identity layer, workspace-scoped data layer,
-- and optimized RLS helper policies for future cloud sync.

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
  unique (workspace_id, user_id)
);

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

create table if not exists reference_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null check (type in ('environment', 'device', 'browser', 'user_role')),
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
  environment_id uuid null references reference_options(id) on delete set null,
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
  updated_at timestamptz not null default now()
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
  created_at timestamptz not null default now()
);

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
create index if not exists idx_reference_options_workspace_type on reference_options(workspace_id, type);
create index if not exists idx_bugs_workspace_updated on bugs(workspace_id, updated_at desc);
create index if not exists idx_attachments_workspace_bug on attachments(workspace_id, bug_id);
create index if not exists idx_sync_events_workspace_seq on sync_events(workspace_id, local_seq);

-- 3. Security Hardening
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table applications enable row level security;
alter table modules enable row level security;
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

-- 5. RLS Policies
-- Re-create policies so the draft can be re-applied during early schema iteration.
drop policy if exists "workspace members can select their workspaces" on workspaces;
drop policy if exists "users can select their workspace memberships" on workspace_members;
drop policy if exists "users can insert memberships for owned bootstrap workspaces" on workspace_members;
drop policy if exists "workspace members can select applications" on applications;
drop policy if exists "workspace members can insert applications" on applications;
drop policy if exists "workspace members can manage applications" on applications;
drop policy if exists "workspace members can select modules" on modules;
drop policy if exists "workspace members can insert modules" on modules;
drop policy if exists "workspace members can manage modules" on modules;
drop policy if exists "workspace members can select reference options" on reference_options;
drop policy if exists "workspace members can insert reference options" on reference_options;
drop policy if exists "workspace members can manage reference options" on reference_options;
drop policy if exists "workspace members can select bugs" on bugs;
drop policy if exists "workspace members can insert bugs" on bugs;
drop policy if exists "workspace members can fully manage bugs in their workspace" on bugs;
drop policy if exists "workspace members can select attachments" on attachments;
drop policy if exists "workspace members can insert attachments" on attachments;
drop policy if exists "workspace members can manage attachments" on attachments;
drop policy if exists "workspace members can select config options" on config_options;
drop policy if exists "workspace members can insert config options" on config_options;
drop policy if exists "workspace members can manage config options" on config_options;
drop policy if exists "workspace members can select report templates" on report_templates;
drop policy if exists "workspace members can insert report templates" on report_templates;
drop policy if exists "workspace members can manage report templates" on report_templates;
drop policy if exists "workspace members can select sync events" on sync_events;
drop policy if exists "workspace members can insert sync events" on sync_events;
drop policy if exists "workspace members can manage sync events" on sync_events;

create policy "workspace members can select their workspaces"
  on workspaces for select
  using (public.is_workspace_member(id));

create policy "users can select their workspace memberships"
  on workspace_members for select
  using (user_id = auth.uid());

create policy "users can insert memberships for owned bootstrap workspaces"
  on workspace_members for insert
  with check (user_id = auth.uid());

create policy "workspace members can manage applications"
  on applications for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "workspace members can manage modules"
  on modules for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "workspace members can manage reference options"
  on reference_options for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "workspace members can fully manage bugs in their workspace"
  on bugs for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "workspace members can manage attachments"
  on attachments for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "workspace members can manage config options"
  on config_options for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "workspace members can manage report templates"
  on report_templates for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "workspace members can manage sync events"
  on sync_events for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- TODO: Add role-aware restrictions once workspace roles are finalized.

-- 6. Telemetry Support Storage
-- Public read access allows Slack unfurls for screenshots sent through submit-feedback.
insert into storage.buckets (id, name, public)
values ('telemetry-assets', 'telemetry-assets', true)
on conflict (id) do update set public = excluded.public;
-- TODO: Add Supabase Storage buckets and policies for content-addressed attachments.
-- TODO: Add auth onboarding to create personal workspaces and workspace_members rows.
-- TODO: Drain local SQLite sync_queue into sync_events after login.
-- TODO: Resolve conflicts using updated_at plus deterministic client_id/local_seq/op_id.
