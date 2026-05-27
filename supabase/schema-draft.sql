-- Bug Pocket Supabase schema draft.
-- This is preparation only; the MVP runs entirely on local SQLite.

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists modules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  application_id uuid null references applications(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists environments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists browsers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bugs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  application_id uuid null references applications(id) on delete set null,
  module_id uuid null references modules(id) on delete set null,
  environment_id uuid null references environments(id) on delete set null,
  device_id uuid null references devices(id) on delete set null,
  browser_id uuid null references browsers(id) on delete set null,
  entry_type text not null default 'Bug',
  title text not null default '',
  note text not null default '',
  other_details text not null default '',
  steps_to_reproduce text not null default '',
  expected_result text not null default '',
  actual_result text not null default '',
  status text not null default 'New',
  severity text not null default 'Medium',
  reported boolean not null default false,
  issue_platform text not null default '',
  issue_id text not null default '',
  issue_url text not null default '',
  tags text not null default '',
  sync_status text not null default 'Sync Pending',
  last_sync_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  bug_id uuid not null references bugs(id) on delete cascade,
  content_hash text not null,
  file_extension text not null default '.png',
  mime_type text not null,
  source_type text not null default 'other',
  sync_status text not null default 'Sync Pending',
  last_sync_at timestamptz null,
  storage_bucket text null,
  storage_key text null,
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

create table if not exists sync_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- TODO: Add Supabase Auth user linkage and workspace membership table.
-- TODO: Enable row-level security on every workspace-scoped table.
-- TODO: Add policies so users can only access workspaces they belong to.
-- TODO: Upload screenshot files to Supabase Storage and store storage_key here.
-- TODO: Treat attachments generically across desktop and mobile: snip, screenshot,
-- clipboard, uploaded_image, camera_photo, and other.
-- TODO: Mobile clients should create quick notes/scenarios and upload camera photos
-- or existing images without implementing desktop snipping behavior.
-- TODO: Resolve conflicts using updated_at plus a deterministic local change log.
