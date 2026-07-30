export type OptionType = 'status' | 'scenario_status' | 'severity' | 'issue_platform' | 'entry_type';
export type CaptureStatus = 'Draft' | 'Reported' | 'Discarded';
export interface BugStatusCounts {
  total: number;
  draft: number;
  reported: number;
  discarded: number;
}

export type SyncStatus = 'Local Only' | 'Sync Pending' | 'Synced' | 'Sync Failed';
export type AttachmentSourceType = 'snip' | 'screenshot' | 'clipboard' | 'uploaded_image' | 'camera_photo' | 'annotation' | 'other';
export type ShortcutAction = 'quick_capture' | 'main_panel' | 'global_screenshot';
export type ReferenceTable = 'environment' | 'device' | 'browser' | 'user_role';
export type SyncQueueEntityType = 'application' | 'module' | 'environment' | 'bug' | 'attachment' | 'reference';
export type SyncQueueOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE';
export type TaxonomyId = string | number;

export interface RemoteSyncCursor {
  updated_at: string;
  id: string;
}

export interface Application {
  id: TaxonomyId;
  name: string;
  context_description: string | null;
  is_active: number;
  is_synced: number;
  created_at: string;
  updated_at: string;
}

export interface Module {
  id: TaxonomyId;
  application_id: TaxonomyId | null;
  name: string;
  context_description: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ConfigOption {
  id: number;
  type: OptionType;
  value: string;
  sort_order: number;
  is_active: number;
}

export interface ReferenceOption {
  id: TaxonomyId;
  name: string;
  value: string;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: number;
  bug_id: number | null;
  parent_id: number | null;
  content_hash: string | null;
  file_extension: string;
  file_name?: string;
  mime_type: string;
  source_type: AttachmentSourceType;
  sync_status: SyncStatus;
  last_sync_at: string;
  created_at: string;
}

export interface AttachmentLineage {
  active_id: number;
  versions: Attachment[];
}

export interface Bug {
  id: number;
  application_id: TaxonomyId | null;
  module_id: TaxonomyId | null;
  environment_id: TaxonomyId | null;
  device_id: TaxonomyId | null;
  browser_id: TaxonomyId | null;
  user_role_id: TaxonomyId | null;
  application_name?: string | null;
  module_name?: string | null;
  entry_type: string;
  environment: string;
  device: string;
  browser: string;
  user_role: string;
  title: string;
  note: string;
  other_details: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  status: CaptureStatus;
  severity: string;
  reported: number;
  issue_platform: string;
  issue_id: string;
  issue_url: string;
  tags: string;
  sync_status: SyncStatus;
  last_sync_at: string;
  created_at: string;
  updated_at: string;
  attachment_count?: number;
}

export interface BugDetails extends Bug {
  attachments: Attachment[];
}

export interface ReportTemplate {
  id: number;
  name: string;
  template_text: string;
  created_at: string;
  updated_at: string;
}

export interface ShortcutSetting {
  id: number;
  action: ShortcutAction;
  label: string;
  accelerator: string;
  is_enabled: number;
  sort_order: number;
  updated_at: string;
  registration_error?: string;
}

export interface CapturePreset {
  id: number;
  name: string;
  application_id: TaxonomyId | null;
  module_id: TaxonomyId | null;
  environment_id: TaxonomyId | null;
  user_role_id: TaxonomyId | null;
  entry_type_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CapturePresetInput {
  name: string;
  application_id: TaxonomyId | null;
  module_id: TaxonomyId | null;
  environment_id: TaxonomyId | null;
  user_role_id: TaxonomyId | null;
  entry_type_id: number | null;
}

export interface QuickBugInput {
  entry_type: string;
  application_id: TaxonomyId | null;
  module_id: TaxonomyId | null;
  environment_id: TaxonomyId | null;
  device_id?: TaxonomyId | null;
  browser_id?: TaxonomyId | null;
  user_role_id: TaxonomyId | null;
  workspace_id?: TaxonomyId | null;
  created_by?: TaxonomyId | null;
  note: string;
  attachment_ids: number[];
}

export interface BugUpdateInput {
  entry_type: string;
  application_id: TaxonomyId | null;
  module_id: TaxonomyId | null;
  environment_id: TaxonomyId | null;
  device_id: TaxonomyId | null;
  browser_id: TaxonomyId | null;
  user_role_id: TaxonomyId | null;
  title: string;
  note: string;
  other_details: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  status: CaptureStatus;
  severity: string;
  reported: boolean;
  issue_platform: string;
  issue_id: string;
  issue_url: string;
  tags: string;
}

export interface SettingsData {
  applications: Application[];
  modules: Module[];
  statuses: ConfigOption[];
  scenarioStatuses: ConfigOption[];
  severities: ConfigOption[];
  issuePlatforms: ConfigOption[];
  entryTypes: ConfigOption[];
  environments: Environment[];
  devices: ReferenceOption[];
  browsers: ReferenceOption[];
  userRoles: ReferenceOption[];
  reportTemplates: ReportTemplate[];
  shortcuts: ShortcutSetting[];
  jiraWorkspaceUrl: string | null;
  autoBackupDirectoryPath: string | null;
  quickCaptureAnnotateScreenshots: boolean;
  runOnSystemStartup: boolean;
  aiTriageEnabled: boolean;
  ollamaModelName: string;
  supabaseProjectUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseInviteEmail: string | null;
  currentWorkspaceId: string | null;
  currentWorkspaceRole: WorkspaceRole;
  currentWorkspaceCanRead: boolean;
  currentWorkspaceCanWrite: boolean;
  cloudSyncActive: boolean;
  presets: CapturePreset[];
}

export interface BugFilters {
  search?: string;
  entryType?: string | 'all';
  applicationId?: TaxonomyId | 'all';
  moduleId?: TaxonomyId | 'all';
  environmentId?: TaxonomyId | 'all';
  status?: string | 'all';
  severity?: string | 'all';
  syncStatus?: SyncStatus | 'all';
  reported?: 'all' | 'reported' | 'unreported';
}

export interface ScreenshotResult {
  id: number;
  fileName: string;
  contentHash: string;
}

export interface SyncQueueEvent {
  id: number;
  local_seq: number;
  op_id: string;
  entity_type: SyncQueueEntityType;
  entity_id: number | string;
  operation: SyncQueueOperation;
  payload: string;
  created_at: string;
  retry_count: number;
  last_error: string | null;
}

export interface AttachmentDownloadQueueItem {
  attachment_id: number;
  content_hash: string;
  file_extension: string;
  retry_count: number;
  last_error: string | null;
}
export interface SyncDiagnosticsRow {
  id: number;
  local_seq: number;
  op_id: string;
  entity_type: SyncQueueEntityType;
  entity_id: number | string;
  operation: SyncQueueOperation | 'DOWNLOAD';
  created_at: string;
  retry_count: number;
  last_error: string | null;
  label: string;
  queue_type: 'upload' | 'download';
  missing_binary: boolean;
}

export interface BackupExportResult {
  success: boolean;
  canceled?: boolean;
  filePath?: string;
  bytesWritten?: number;
  error?: string;
}

export interface BackupImportResult {
  success: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

export interface AttachmentDownloadResult {
  success: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

export interface SyncConnectionResult {
  success: boolean;
  configured: boolean;
  message: string;
  error?: string;
}

export interface SyncRuntimeStatus {
  status: 'error';
  code: 'PROJECT_PAUSED';
  message: 'Supabase project is paused';
}

export interface SyncSessionStatus {
  authenticated: boolean;
  email?: string;
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
  workspaceCanRead?: boolean;
  workspaceCanWrite?: boolean;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'developer' | (string & {});

export type SyncAccountMode = 'single' | 'team';

export interface SyncRolePermission {
  role: string;
  canRead: boolean;
  canWrite: boolean;
}

export interface SyncAccountSetup {
  accountMode: SyncAccountMode;
  rolePermissions: SyncRolePermission[];
}

export interface TeamInvitePayload {
  version: 2;
  url: string;
  anonKey: string;
  teamId: string;
  targetEmail: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SyncWorkspaceOption {
  workspaceId: string;
  name?: string;
}

export interface SyncAuthResult extends SyncSessionStatus {
  success: boolean;
  message: string;
  error?: string;
}



export type AiProvider = 'OpenAI' | 'Grok' | 'OpenRouter' | 'Gemini' | 'Custom/Local';

export interface AiProviderTarget {
  provider: AiProvider;
  baseUrl?: string;
  modelId: string;
}

export interface AiConfigSaveInput {
  provider: AiProvider;
  baseUrl: string;
  modelId: string;
  apiKeyOperation?:
    | { action: 'replace'; value: string }
    | { action: 'clear' };
  customSystemPrompt: string;
  providerQueue?: AiProviderTarget[];
}

export interface Environment extends ReferenceOption {}

export interface AiByokConfig {
  provider: AiProvider;
  baseUrl: string;
  modelId: string;
  hasApiKey: boolean;
  configuredProviders: Record<AiProvider, boolean>;
  customSystemPrompt: string;
  providerQueue?: AiProviderTarget[];
}

export interface AiIssueProcessPayload {
  rawInput: string;
  taxonomy: {
    application?: string;
    module?: string;
    environment?: string;
    user_role?: string;
    device?: string;
    browser?: string;
    os?: string;
    entry_type?: string;
    severity?: string;
  };
}

export interface AiIssueProcessResult {
  success: boolean;
  output?: string;
  provider?: AiProvider;
  error?: string;
}
export interface FeedbackPayload {
  type: 'Bug' | 'Feature';
  message: string;
  user_email?: string;
  image_base64?: string;
  image_mime_type?: 'image/png' | 'image/jpeg';
}
export interface AiTriageBugPayload {
  id?: number;
  title?: string;
  note: string;
  application?: string;
  application_context?: string;
  module?: string;
  module_context?: string;
  environment?: string;
  device?: string;
  browser?: string;
  os?: string;
  user_role?: string;
  entry_type?: string;
  severity?: string;
  status?: string;
  steps_to_reproduce?: string;
  expected_result?: string;
  actual_result?: string;
  other_details?: string;
  attachment_id?: string;
  refinement_note?: string;
}

export interface AiTriageResult {
  visual_analysis: string;
  bug_title: string;
  refined_summary: string;
  severity_level: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
}

export interface AiTriageResponse {
  success: boolean;
  result: AiTriageResult;
  model: string;
  error?: string;
}
