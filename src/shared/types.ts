export type OptionType = 'status' | 'scenario_status' | 'severity' | 'issue_platform' | 'entry_type';
export type CaptureStatus = 'Draft' | 'Reported' | 'Discarded';
export type SyncStatus = 'Local Only' | 'Sync Pending' | 'Synced' | 'Sync Failed';
export type AttachmentSourceType = 'snip' | 'screenshot' | 'clipboard' | 'uploaded_image' | 'camera_photo' | 'annotation' | 'other';
export type ShortcutAction = 'quick_capture' | 'main_panel' | 'global_screenshot';
export type ReferenceTable = 'environment' | 'device' | 'browser' | 'user_role';
export type SyncQueueEntityType = 'bug' | 'attachment' | 'reference';
export type SyncQueueOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE';

export interface Application {
  id: number;
  name: string;
  context_description: string | null;
  is_active: number;
  is_synced: number;
  created_at: string;
  updated_at: string;
}

export interface Module {
  id: number;
  application_id: number | null;
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
  id: number;
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
  application_id: number | null;
  module_id: number | null;
  environment_id: number | null;
  device_id: number | null;
  browser_id: number | null;
  user_role_id: number | null;
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
  application_id: number | null;
  module_id: number | null;
  environment_id: number | null;
  entry_type_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CapturePresetInput {
  name: string;
  application_id: number | null;
  module_id: number | null;
  environment_id: number | null;
  entry_type_id: number | null;
}

export interface QuickBugInput {
  entry_type: string;
  application_id: number | null;
  module_id: number | null;
  environment_id: number | null;
  user_role_id: number | null;
  note: string;
  attachment_ids: number[];
}

export interface BugUpdateInput {
  entry_type: string;
  application_id: number | null;
  module_id: number | null;
  environment_id: number | null;
  device_id: number | null;
  browser_id: number | null;
  user_role_id: number | null;
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
  environments: ReferenceOption[];
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
  presets: CapturePreset[];
}

export interface BugFilters {
  search?: string;
  entryType?: string | 'all';
  applicationId?: number | 'all';
  moduleId?: number | 'all';
  environmentId?: number | 'all';
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
  entity_id: number;
  operation: SyncQueueOperation;
  payload: string;
  created_at: string;
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
  user_role?: string;
  entry_type?: string;
  severity?: string;
  status?: string;
  steps_to_reproduce?: string;
  expected_result?: string;
  actual_result?: string;
  other_details?: string;
  image_file_path?: string;
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
