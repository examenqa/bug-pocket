# Bug Pocket Agent Handoff

This document describes the current Bug Pocket build so another engineer, agent, or ChatGPT thread can plan future changes without relying on chat history.

## Product Summary

Bug Pocket is a Windows-first Electron desktop app for fast QA capture. The core problem is that testers often notice unrelated bugs, scenarios, observations, or questions while testing but do not want to break their current flow to write a full bug report. Bug Pocket lets them capture a short note and screenshot quickly, then return later to clean up details and generate structured reports.

The app is intentionally local-first. Captures and attachments save immediately to SQLite and the local filesystem. Cloud sync is now in an early push-only implementation phase: credentials, auth/session capture, workspace routing, and a background `sync_queue` worker exist, but remote pull/conflict resolution is still future work. Support telemetry is routed through a Supabase Edge Function. BYOK AI Processing is now implemented through a universal OpenAI-compatible REST engine with encrypted local API-key storage; ads and web/mobile versions remain future work.

## Current Tech Stack

- Electron desktop app
- React renderer
- TypeScript
- `electron-vite`
- SQLite via `better-sqlite3`
- Local filesystem attachment storage using content-addressed files
- Supabase Phase 3 push-sync scaffold: credentials, auth/session capture, workspace routing, RLS schema draft, background `sync_queue` drain, and Supabase Storage attachment upload
- Windows-first behavior with system tray and global shortcuts

Core commands:

```powershell
npm install
npm run dev
npm run build
npm run start
npm run dist
npm run dist:publish
```

`npm install` runs `electron-rebuild` so `better-sqlite3` matches Electron.
`npm run dist` runs `electron-vite build && node scripts/fix-preload.js && electron-builder` and creates the Windows NSIS installer under `release-build`.
`npm run dist:publish` runs the same build plus `electron-builder --publish always`; CI uses it for S3 updater releases.

## Main Architecture

Bug Pocket currently has two persistent Electron windows plus a transient snipping overlay window:

- Quick Capture window: `#/capture`
- Main App window: `#/dashboard`, `#/bugs/:id`, and `#/settings`
- Snipping overlay window: `#/snip`, created only while taking a screenshot and closed after capture/cancel

Important files:

**Main process**
- `src/main/index.ts`: Electron windows, tray, global shortcuts, screenshot IPC, attachment download IPC, backup IPC, clipboard IPC, external URL launch IPC.
- `src/main/ai/byokIssueProcessor.ts`: active BYOK AI Processing and triage engine using native `fetch` against OpenAI-compatible `/chat/completions` endpoints. It stores API keys through Electron `safeStorage`, supports multimodal screenshot payloads, and surfaces upstream provider errors.
- `src/main/ai/ollamaTriage.ts`: legacy/local Ollama triage implementation kept in the tree for reference; it is not the primary AI path.
- `src/main/database.ts`: SQLite schema, migrations, defaults, CRUD, content-addressed attachments, sync queue, report templates. Also owns the `app_settings` key-value table.
- `src/main/sync/syncService.ts`: Supabase `SyncEngine`. It reads local credentials, initializes the client with Node WebSocket support, handles sign in/sign up/sign out, captures `current_workspace_id`, runs a push-only background worker that drains `sync_queue` sequentially, and sends support feedback through the Supabase Edge Function proxy.

**Release / web API**
- `api/download.js`: Vercel serverless download proxy. It fetches `windows/latest.yml` from the public S3 updater bucket, parses it with `js-yaml`, and returns a temporary redirect to the current NSIS installer.
- `.github/workflows/publish-desktop-update.yml`: tag/manual workflow that runs `npm run dist:publish` and verifies the public `latest.yml` plus installer object after upload.

**Preload & shared**
- `src/preload/index.ts`: safe `window.bugPocket` bridge, including `startScreenshotCapture()`, BYOK AI config/triage methods, support feedback, toast variants, sync auth, backup/restore, and settings IPC.
- `src/shared/types.ts`: shared model and IPC types.

**Renderer — entry**
- `src/renderer/src/main.tsx`: tiny `createRoot` entry only. All UI logic lives in the files below.
- `src/renderer/src/App.tsx`: `App`, `CaptureRoute`, `MainShell` — the root router and shell.

**Renderer — pages**
- `src/renderer/src/pages/DashboardPage.tsx`: bug table, filters, attachment spotlight.
- `src/renderer/src/pages/BugDetailPage.tsx`: `BugDetailsHost` + `BugDetailsView`, details autosave, AI triage mapping, attachment/version spotlight, and report actions.
- `src/renderer/src/pages/SettingsPage.tsx`: settings shell with a left sidebar tab layout.
- `src/renderer/src/pages/SnipOverlay.tsx`: full-screen screenshot snip UI.

**Renderer — shared components**
- `src/renderer/src/components/shared/Select.tsx`: compact select wrapper.
- `src/renderer/src/components/shared/Badge.tsx`: `Badge` and `SyncBadge`.
- `src/renderer/src/components/shared/PillDropdown.tsx`: portal-based inline pill dropdown.
- `src/renderer/src/components/shared/OptionSelect.tsx`: `OptionSelect` and `ReferenceSelect`.
- `src/renderer/src/components/QuickCaptureForm.tsx`: Quick Capture UI and keyboard behavior.
- `src/renderer/src/components/ScreenshotAnnotator.tsx`: native canvas screenshot annotation tools.
- `src/renderer/src/components/shared/SupportModal.tsx`: Help & Support portal modal for bug/feature feedback with optional PNG/JPEG upload.
- `src/renderer/src/components/shared/ToastBanner.tsx`: global toast component with success/info/error variants, hover-to-pause timers, and longer error visibility.

**Renderer — settings components**
- `src/renderer/src/components/settings/settingsUtils.ts`: `hasSettingsMutationBridge`, `getSettingsPreviewItems`.
- `src/renderer/src/components/settings/GeneralSettings.tsx`: General & Hotkeys tab content, including shortcuts, capture preferences, workspace field lists, report destinations, Jira, and templates.
- `src/renderer/src/components/settings/PresetSettings.tsx`: Capture Presets tab wrapper around preset CRUD.
- `src/renderer/src/components/settings/AiSettings.tsx`: AI Processing tab with BYOK provider presets, Base URL, Model ID, encrypted API key save/clear, and custom system prompt.
- `src/renderer/src/components/settings/StorageSettings.tsx`: Storage & Backups tab wrapper.
- `src/renderer/src/components/settings/SyncSettings.tsx`: Cloud Sync credentials, connection test, login/create-account UI, connected profile state, workspace ID display, and logout action.
- `src/renderer/src/components/settings/ShortcutSettingsPanel.tsx`: shortcut recording UI.
- `src/renderer/src/components/settings/CapturePreferencesPanel.tsx`: screenshot review and startup toggles.
- `src/renderer/src/components/settings/JiraWorkspacePanel.tsx`: Jira workspace URL field.
- `src/renderer/src/components/settings/AiOptionsPanel.tsx`: legacy Ollama/guided vision-model config component retained in code but not the active AI settings surface.
- `src/renderer/src/components/settings/DataManagementPanel.tsx`: backup export/import/auto-backup UI.
- `src/renderer/src/components/settings/PresetManager.tsx`: Quick Capture preset CRUD (max 3).
- `src/renderer/src/components/settings/ModuleManager.tsx`: module management grouped by application.
- `src/renderer/src/components/settings/OptionManager.tsx`: generic collapsible option CRUD + merge.
- `src/renderer/src/components/settings/TemplateManager.tsx`: report template editor.

**Renderer — hooks**
- `src/renderer/src/hooks/useHashRoute.ts`: hash-based navigation hook.
- `src/renderer/src/hooks/useDebounce.ts`: generic debounce hook.
- `src/renderer/src/hooks/useSettings.ts`: settings loader.

**Renderer — utils**
- `src/renderer/src/utils/display.ts`: pure display/format/classification helpers (`getEntryDisplay`, `syncClass`, `severityClass`, `formatTableDate`, etc.).
- `src/renderer/src/utils/filters.ts`: `getActiveFilterChips`, `getModulesForApplication`.
- `src/renderer/src/utils/shortcuts.ts`: keyboard accelerator helpers (`eventToAccelerator`, `isModifierOnlyKey`).
- `src/renderer/src/utils/bugUpdate.ts`: `buildBugUpdateInput`, `serializeBugUpdateInput`, and related types.
- `src/renderer/src/utils/spotlight.ts`: `SpotlightState` interface and `loadAttachmentLineage` helper.
- `src/renderer/src/utils/settingsKeys.ts`: shared sessionStorage key constants for the backup restore handoff.

**Renderer — services & styles**
- `src/renderer/src/services/reports.ts`: template-based report generation and Linear/Jira deep-link construction.
- `src/renderer/src/styles.css`: full app styling.

**Build & resources**
- `build/icon.ico`: multi-layer Windows icon used by electron-builder and runtime tray/window/notification icon loading.
- `resources/bug-pocket-icon.png` and `resources/bug-pocket-title.png`: renderer/runtime brand artwork and packaged extra resources.
- `supabase/schema-draft.sql`: future cloud schema draft.

## Current UX

### Quick Capture Panel

The Quick Capture panel is a separate small Electron window with a denim pocket visual style inspired by the Bug Pocket logo.

Visible fields:

- Application
- Module
- Environment
- User Role
- Bug Note
- Screenshot button
- Save button

Important behavior:

- Quick Capture stays minimal. Do not add Device, Browser, issue fields, status, severity, or other details here unless explicitly requested.
- It supports creating missing Application, Module, Environment, and User Role values inline.
- Modules are scoped to the selected Application; new modules created from Quick Capture attach to that application.
- It can attach one or more screenshots before saving.
- By default, screenshots taken from Quick Capture expand the same Quick Capture window into an inline Review Screenshot mode before being attached.
- Review Screenshot supports Arrow, Freehand, Text, Mask, Undo, and `Ctrl+Z`.
- In Review Screenshot, `Attach` saves the annotated or unedited screenshot as a local unattached attachment and returns the Quick Capture window to compact size.
- `Discard` clears the pending screenshot without saving and returns the Quick Capture window to compact size.
- Settings can disable the review step and restore the older instant-attach flow.
- It saves locally first and then closes/minimizes after save.
- It uses the same record creation path as the Main App and hardcodes `entry_type: 'Bug'` so the panel stays fast.

Quick panel shortcuts:

- `Alt+A`: Application
- `Alt+M`: Module
- `Alt+E`: Environment
- `Alt+R`: User Role
- `Alt+N`: Bug Note
- `Alt+S`: Screenshot
- `Ctrl+Enter`: Save
- `Esc`: Cancel
- `Tab` and `Shift+Tab`: normal field traversal
- `Alt+1`, `Alt+2`, `Alt+3`: apply the first three Quick Capture presets if configured

Preset behavior:

- Quick Capture uses a permanent 3-slot preset button array, not a preset dropdown.
- Filled preset slots apply their saved Application, Module, Environment, and User Role. Preset saves hardcode `entry_type: 'Bug'` to match the current Quick Capture schema.
- Empty preset slots route the user to Settings > Capture Presets.

Dropdown behavior:

- Typing filters options.
- Arrow keys move through options.
- Enter selects the highlighted option.
- Esc closes an open dropdown first. If no dropdown is open, Esc closes the panel.

### Main App Panel

The Main App is the full desktop dashboard. It is required, not optional.

It includes:

- Dashboard
- Global Screenshot Button: A dedicated button in the header that triggers the `Ctrl+Alt+S` snipping flow directly from the dashboard.
- Bug/entry list
- Search
- Collapsible filters
- Screenshot spotlight preview from the table attachment icon
- Full details view
- Settings/configuration
- Template report preview and copy actions
- Linear/Jira launch actions for pre-filled issue creation URLs

The Main Panel is not fully denim like the Quick Capture panel. It uses subtle Bug Pocket palette hints: light blue surfaces, denim-blue action buttons, green hover accents, stitched inner lines on important action buttons, and a cleaner work-focused layout.

### Dashboard

The dashboard table was reduced to 5 high-signal columns:

- Entry: derived title, note preview when useful, and entry type badge.
- Context: application, module, environment.
- State: status badge, severity icon, sync icon.
- Created: short date with styled tooltip for full date/time.
- Attachments: camera icon/count that opens a spotlight preview.

Filters currently include:

- Entry Type
- Application
- Module
- Environment
- Status
- Severity
- Sync
- Reported

Filters are in a collapsible panel to avoid visual clutter. Keep filters available; do not remove them unless explicitly requested.

The Environment filter uses `environment_id` internally and displays the joined Environment name. The Captured Entries table expands vertically to use available dashboard space.

### Bug Details Page

The full details page supports:

- Title
- Entry Type
- Application
- Module
- Environment
- User Role
- Device
- Browser
- Bug Note
- Steps to Reproduce
- Expected Result
- Actual Result
- Other Details
- Status
- Severity
- Issue Platform
- Issue ID
- Issue URL
- Tags
- Status-driven workflow strip with pill-style Status and Severity dropdowns
- Screenshot attachments
- Generated report preview
- Copy Quick Report
- Copy Full Bug Report
- Copy Linear Format
- Copy Jira Format
- Open Linear
- Open Jira
- Open Ticket, shown in the header as a secondary Issue pill/button and opened through the external URL IPC when `issue_url` exists
- AI Triage implementation code is present but locked in this build; Bug Details does not mount the triage/refine controls until the feature gate is re-enabled.
- Delete Report
- Save Details

The top seven taxonomy/context controls are arranged in a responsive 2-column grid:

- Entry Type
- Application
- Module
- Environment
- User Role
- Device
- Browser

The Save Details button uses the same stitched blue treatment as New Capture. Delete Report uses a softer dusty red denim-style stitched treatment with white icon/text.

Bug Details also has debounced auto-save:

- Form edits mark the details view dirty immediately.
- After roughly 1500ms of inactivity, the current details payload saves through the same update path as Save Details.
- A subtle field-level Saving/Saved indicator appears near the edited field.
- Back navigation flushes pending edits before returning to the dashboard.
- Manual Save Details remains available as an explicit user action and fallback.

The workflow strip and header Status dropdown use the local capture lifecycle only:

- Draft
- Reported
- Discarded

Legacy project-management statuses such as Needs Review, Duplicate, Ignored, Fixed, Verified, In Progress, and Done are intentionally not active statuses. Startup migration maps legacy values into Draft, Reported, or Discarded.

Bug Details renders as a sibling view next to the preserved Dashboard state. When details opens, the Dashboard container is hidden rather than unmounted so filters and scroll position survive returning to the list. Screenshot thumbnails in Bug Details are clickable and open the same spotlight annotation editor used by the dashboard attachment column. Each Bug Details attachment also has a download button that opens a Windows Save As dialog and copies the content-addressed PNG out of app storage.

### Settings Page

Settings currently manages:

- Entry Types
- Applications
- Modules
- Environments
- Devices
- Browsers
- User Roles
- Severity Values
- Report Destinations / Issue Platforms
- Report Templates
- Global Shortcuts
- Capture Preferences
- Quick Capture Presets
- Data Management and backups
- Jira Workspace URL
- AI Processing / BYOK triage configuration

Settings uses a two-column layout with a persistent left sidebar and a right content panel. Current sidebar tabs are:

- General & Hotkeys: Global Shortcuts, Capture Preferences, workspace field lists, report destinations, Jira Workspace, and Report Templates.
- Capture Presets: Quick Capture presets, capped at 3.
- AI Processing: BYOK provider preset, Base URL, Model ID, encrypted API key, and custom system prompt.
- Storage & Backups: manual backup, restore, automated backup directory.
- Cloud Sync: Supabase Project URL / anon key credential UI, Test Connection action, Log In / Create Account flow, connected profile state, active Workspace ID display, and Log Out. Background push sync starts after an authenticated session and workspace membership are captured.

Settings groups are shown as bordered sections with compact collapsible cards where appropriate. Closed cards show a count and preview chips. Open cards show add/edit/delete controls. Only one Settings card should be open at a time inside the active Settings tab. Opening a new Settings card collapses the previous one.

Capture Preferences currently includes:

- Review screenshots before attaching in Quick Capture
- Run on System Startup

These preferences are stored in the `app_settings` key-value table (see Data Model). `quick_capture_annotate_screenshots` defaults to enabled and controls whether Quick Panel screenshots go through inline Review Screenshot mode before being saved. `run_on_system_startup` defaults to disabled.

Data Management currently includes:

- Manual export to a `.bugpocket` backup archive.
- Manual import/restore from a `.bugpocket` backup archive.
- Automated rolling backups to a user-selected directory, retaining the newest backups.

AI Processing settings behavior in this build:

- Settings > AI Processing exposes a BYOK configuration card.
- Provider presets currently include OpenAI, Grok, OpenRouter, Gemini, and Custom/Local.
- Selecting OpenRouter defaults to `https://openrouter.ai/api/v1` and `google/gemma-4-31b-it:free` so the default model path is free-tier and vision-capable.
- Selecting Gemini uses Google's OpenAI-compatible endpoint: `https://generativelanguage.googleapis.com/v1beta/openai`.
- Base URL and Model ID remain editable and are trimmed before saving to avoid invisible typo failures.
- API keys are encrypted with Electron `safeStorage` and stored in `app_settings` as `byok_ai_api_key_encrypted`; never store raw provider keys in SQLite.
- The custom system prompt defaults to a strict JSON triage prompt with keys `title`, `bugNote`, `stepsToReproduce`, `expectedResult`, and `actualResult`.
- Bug Details exposes AI triage through the universal BYOK engine. The returned JSON is parsed and mapped into the individual fields; malformed JSON falls back to the Bug Note field rather than crashing.
- Triage should not auto-save the record; users review the generated fields and rely on normal auto-save/manual save behavior.

## Support And Notifications

Support feedback is available from the bottom of the global sidebar through Help & Support.

Support flow:

- `SupportModal.tsx` renders as a React portal above normal app content.
- The user can submit a Bug or Feature message, optional email, and optional PNG/JPEG image chosen through a normal file input.
- The renderer sends `FeedbackPayload` through `window.bugPocket.sendFeedback(payload)` / `support:sendFeedback`.
- The Electron main process does not call Slack directly. It routes feedback through `SyncEngine.sendFeedback()`.
- If an image is attached, the main process uploads it to the Supabase Storage bucket `telemetry-assets`, retrieves the public URL, and sends `image_url` to the Edge Function. The Edge Function should not decode large Base64 images.
- The Supabase Edge Function is `supabase/functions/submit-feedback/index.ts` and expects `{ type, message, user_email, image_url }`.
- The Edge Function reads `SLACK_WEBHOOK_URL` from Supabase secrets and posts the formatted message to Slack. Do not hardcode real Slack webhook URLs in the Electron app or repository.
- `telemetry-assets` must be public-read or Slack cannot unfurl/open the attached image URL.

Notification behavior:

- `ToastBanner.tsx` supports `success`, `info`, and `error` variants.
- Error toasts use red/destructive styling, `role="alert"`, and `aria-live="assertive"`.
- Error toasts stay visible for 4000ms by default; success/info toasts use 2400ms unless overridden.
- Hovering a toast pauses its dismissal timer; leaving restarts the countdown.
- App-level toast IPC supports an optional variant, so error paths should call the error variant instead of reusing success styling.

## Data Model

SQLite tables include:

- `bugs`
- `applications`
- `modules`
- `environments`
- `devices`
- `browsers`
- `user_roles`
- `attachments`
- `app_settings` — key-value store for scalar app preferences (see below)
- `config_options` — taxonomy lists only (entry types, fixed capture statuses, severities, issue platforms)
- `report_templates`
- `shortcut_settings`
- `presets`
- `sync_queue`

### app_settings table

`app_settings` is a key-value table used exclusively for singleton scalar preferences that do not belong in a taxonomy list. Schema:

```sql
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY NOT NULL,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
```

Current keys:

| key | type | default |
|---|---|---|
| `jira_workspace_url` | string | `""` |
| `auto_backup_directory_path` | string | `""` |
| `quick_capture_annotate_screenshots` | boolean (`"true"`/`"false"`) | `"true"` |
| `run_on_system_startup` | boolean (`"true"`/`"false"`) | `"false"` |
| `ai_triage_enabled` | legacy boolean (`"true"`/`"false"`) | `"false"` |
| `ollama_model_name` | legacy string | `"qwen3-vl:8b"` |
| `byok_ai_provider` | string | `"OpenRouter"` |
| `byok_ai_base_url` | string | `"https://openrouter.ai/api/v1"` |
| `byok_ai_model_id` | string | `"google/gemma-4-31b-it:free"` |
| `byok_ai_api_key_encrypted` | encrypted string | `""` |
| `byok_ai_custom_system_prompt` | string | `""` |
| `supabase_project_url` | string | `""` |
| `supabase_anon_key` | string | `""` |
| `current_workspace_id` | string | `""` |

Do NOT store scalar preferences in `config_options`. The `config_options` table is only for multi-row taxonomy lists (entry types, fixed capture statuses, severities, issue platforms, etc.).

The `database.ts` class exposes typed private helpers `getSetting(key)` and `setSetting(key, value)` that wrap all access to `app_settings`. Add new scalar preferences through those helpers only.

On first startup, `migrateToAppSettings()` runs inside a transaction: it reads any legacy `config_options` rows with matching keys, writes them into `app_settings`, and deletes those rows. This migration is idempotent.

The `bugs` table currently includes:

- `id`
- `application_id`
- `module_id`
- `environment_id`
- `user_role_id`
- `device_id`
- `browser_id`
- `entry_type`
- `title`
- `note`
- `other_details`
- `steps_to_reproduce`
- `expected_result`
- `actual_result`
- `status`
- `severity`
- `reported`
- `issue_platform`
- `issue_id`
- `issue_url`
- `tags`
- `sync_status`
- `last_sync_at`
- `created_at`
- `updated_at`

The `applications` table includes:

- `id`
- `name`
- `context_description`
- `is_active`
- `is_synced`
- `created_at`
- `updated_at`

The `modules` table includes:

- `id`
- `application_id`
- `name`
- `context_description`
- `is_active`
- `created_at`
- `updated_at`

Application and Module `context_description` fields are optional AI context fields. Settings > General & Hotkeys > Workspace Field Lists exposes them as `Context / Business Logic` textareas. Use the dedicated context IPC methods for explicit context saves:

- `window.bugPocket.updateApplicationContext(id, contextDescription)`
- `window.bugPocket.updateModuleContext(id, contextDescription)`

The normal rename/update methods also accept context for combined saves, but context-only buttons should use the dedicated context methods so the save path is unambiguous.

Environment, User Role, Device, and Browser are relational reference tables, not simple copied text fields. Renderer display models still expose joined `environment`, `user_role`, `device`, and `browser` names for tables, details headers, AI payloads, and report templates.

The `environments`, `devices`, `browsers`, and `user_roles` tables include:

- `id`
- `name`
- `value`
- `sort_order`
- `is_active`
- `created_at`
- `updated_at`

The `attachments` table supports generic attachment sources:

- `snip`
- `screenshot`
- `clipboard`
- `uploaded_image`
- `camera_photo`
- `annotation`
- `other`

Attachments are content-addressed. Attachment files are stored under Electron `app.getPath("userData")`:

- `bug-pocket.sqlite`
- `attachments/<sha256>.png`

The `attachments` table stores:

- `id`
- `bug_id`
- `parent_id`
- `content_hash`
- `file_extension`
- `mime_type`
- `source_type`
- `sync_status`
- `last_sync_at`
- `created_at`

Do not store or rely on absolute attachment paths in SQLite. Resolve the absolute file path at runtime from `app.getPath("userData")`, the content hash, and the extension.

Annotated screenshots are non-destructive:

- Existing saved attachments are not overwritten.
- Editing an existing saved screenshot creates a new attachment with `source_type = 'annotation'`.
- The new annotated attachment stores `parent_id` pointing to the original attachment.
- Quick Capture review screenshots do not need `parent_id` because the raw snip is not persisted unless the user clicks Attach Screenshot.

The `sync_queue` table is append-only sync preparation. It includes:

- `id`
- `local_seq`
- `op_id`
- `entity_type` — `bug`, `attachment`, or `reference`
- `entity_id`
- `operation` — `INSERT`, `UPDATE`, `DELETE`, or `MERGE`
- `payload`
- `created_at`

Bug and attachment mutations should write to `sync_queue` in the same SQLite transaction as the primary table change. Reference table merge operations enqueue a `reference` / `MERGE` event.

## Entry Types And Statuses

Default Entry Types:

- Bug
- Scenario
- Question
- Observation
- Improvement

Default capture statuses:

- Draft
- Reported
- Discarded

Default severities:

- Low
- Medium
- High
- Critical

Default issue platforms:

- Linear
- Jira
- GitHub
- Trello
- Google Sheet
- Other

Default environments:

- Production
- Staging
- QA
- UAT
- Development
- Local

Default devices:

- Desktop
- Laptop
- Tablet
- Mobile
- Other

Default browsers:

- Chrome
- Edge
- Firefox
- Safari
- Other

Default user roles:

- Admin
- Standard User
- Guest
- Read-Only

## Report Generation

Report generation is template-based. The copy buttons do not invoke AI; they only render saved fields through stored templates. Local AI, when enabled, can help populate or refine the saved fields before the template is copied.

Current placeholders include:

- `{{title}}`
- `{{entry_type}}`
- `{{note}}`
- `{{application}}`
- `{{module}}`
- `{{environment}}`
- `{{user_role}}`
- `{{device}}`
- `{{browser}}`
- `{{steps}}`
- `{{expected}}`
- `{{actual}}`
- `{{status}}`
- `{{severity}}`
- `{{reported}}`
- `{{issue_id}}`
- `{{attachments}}`

Do not over-interpret user notes in non-AI reports. Just format the saved fields cleanly.

Default report template notes:

- `Quick Report` is the consolidated short summary template:

```markdown
🚨 *[{{severity}}] {{title}}*
*Context:* {{application}} > {{module}} | {{environment}} | {{user_role}}

*Note:* {{note}}
```

- `Slack Summary` has been removed from the default seed and startup cleanup deletes existing `Slack Summary` templates.

Frictionless triage helpers:

- `Copy Quick Report` copies the consolidated Markdown summary template output.
- `Copy Full Bug Report` copies the full bug report template output.
- `Copy Linear Format` copies the Linear template output.
- `Copy Jira Format` copies the Jira template output.
- `Open Linear` builds a pre-filled `https://linear.new?...` URL.
- `Open Jira` builds a pre-filled Jira create-issue URL. If the entry has an Issue URL with a Jira/Atlassian origin, that origin is used; otherwise the configured Jira Workspace URL from Settings is used. If neither exists, the UI prompts the user to configure Jira.
- External URLs are opened through the main-process `shell.openExternal` IPC bridge. Keep protocol validation to `http` and `https`.

## Smart Titles

The Quick Panel does not ask for a title and does not generate one during capture.

The Main Panel derives display titles deterministically:

- Normalize whitespace.
- Prefer useful text before a colon.
- Else prefer first sentence.
- Else use the first 8 words, capped around 70 characters.
- Fallback to `Untitled entry`.

Manual title edits in Details should win over derived titles.

## Screenshot / Snip

Screenshots use a snipping flow:

- User clicks Screenshot or presses the shortcut.
- The app hides/minimizes the capture window.
- A full-screen overlay appears.
- User drag-selects a region.
- `Alt+C` captures the full current screen from the overlay without dragging.
- The selected region is saved as a PNG in user app data.
- The PNG bytes are SHA-256 hashed.
- The file is stored as `attachments/<hash>.png`.
- SQLite stores only `content_hash` and `file_extension`, not an absolute path.
- Esc cancels screenshot mode.

Quick Panel screenshot behavior:

- When `quick_capture_annotate_screenshots` is enabled, the snipped PNG is held in memory as a pending screenshot and not saved yet.
- If a user triggers `Ctrl+Alt+S` or the Main Panel screenshot button while a Quick Capture draft is already in progress, the new screenshot appends to the existing draft without overwriting the user's text.
- The Quick Capture window expands into an inline Review Screenshot mode with the native canvas annotator.
- `Attach` persists the final image as a content-addressed local attachment, emits `screenshot:captured` back to Quick Capture, and restores compact size.
- `Discard` clears the pending image and saves nothing.
- When the preference is disabled, Quick Panel screenshots save immediately and return to the Quick Panel.

Main Panel screenshot behavior:

- Bug Details `Add Screenshot` still saves and attaches immediately.
- The Dashboard attachment icon opens a spotlight preview instead of navigating directly to details.
- Bug Details screenshot thumbnails also open a spotlight preview.
- Bug Details attachment captions include a download button that exports the PNG through a Save As dialog.
- Spotlight previews include the same annotation editor and save edited screenshots as child attachments.

Annotation tools:

- Arrow with live preview.
- Freehand drawing.
- Direct canvas text entry with I-beam cursor, canvas caret, `Backspace`, `Enter` commit, and `Esc` cancel.
- Mask selection. Internally this is still implemented as a blur/redaction-style canvas operation; the user-facing label is `Mask`.
- Undo button and `Ctrl+Z`.
- Annotation color is red.

## Desktop Behavior

Tray and shortcuts:

- Tray icon opens Quick Capture or Dashboard.
- The tray, window, notification, and packaged installer icon should use the custom Bug Pocket icon, not Electron defaults.
- `Ctrl+Alt+P`: opens Quick Capture by default.
- `Ctrl+Alt+S`: starts a global screenshot snip directly by default. After the snip, it uses the existing Quick Capture review/attach flow so the screenshot still lands in the current Quick Panel draft.
- `Ctrl+Alt+M`: opens Main App Dashboard by default.
- Global shortcuts are configurable from Settings using recorder controls.
- If Electron cannot register a shortcut because another app/system owns it, Settings shows a warning.
- Settings > General & Hotkeys includes `Run on System Startup`. This is stored in `app_settings` as `run_on_system_startup` and enforced on app boot through `app.setLoginItemSettings({ openAtLogin, openAsHidden: true, args: ["--background-start"] })` when enabled.
- When launched by Windows startup, Bug Pocket passes `--background-start` and starts hidden in the tray/background instead of opening the Main Panel.
- Bug Pocket uses `app.requestSingleInstanceLock()`. If a second instance is launched, it should not open another SQLite/IPC process; it should bring the existing Main App dashboard to the foreground.

In development, a second app launch opens the dashboard rather than only quick capture.

Development data isolation:

- When `app.isPackaged` is false, the main process appends `-dev` to Electron `userData` before database initialization.
- Dev builds and packaged builds should therefore use separate SQLite/attachment folders.
- All database and attachment paths must continue to resolve from `app.getPath("userData")`; do not hardcode the app data folder.

## Sync Status

The app is offline-first. Local capture must never wait for cloud availability.

Current sync statuses:

- Local Only
- Sync Pending
- Synced
- Sync Failed

Cloud sync is in an early Phase 3 push-only implementation:

- Settings > Cloud Sync stores `supabase_project_url`, `supabase_anon_key`, and the captured `current_workspace_id` in `app_settings`.
- Settings > Cloud Sync supports Test Connection, Log In, Create Account, connected profile display, active Workspace ID display, and Log Out.
- `src/main/sync/syncService.ts` initializes `@supabase/supabase-js` with `ws` as the Node realtime transport. Keep `ws` externalized in `electron.vite.config.ts` so optional native helpers like `bufferutil` do not crash the Electron main bundle.
- After sign in/sign up, `SyncEngine` queries remote `workspace_members`, captures the first `workspace_id`, and stores it locally as `current_workspace_id`.
- When an authenticated session and workspace ID exist, `SyncEngine` starts a safe interval-based background worker.
- The worker reads `sync_queue` rows ordered by `local_seq`, preserving local mutation order.
- Bug events are upserted/deleted against the cloud `bugs` table with `workspace_id` injected.
- Attachment events upload content-addressed files to Supabase Storage bucket `attachments` using `<workspace_id>/<content_hash>.<extension>`, then upsert/delete rows in the cloud `attachments` table.
- Reference merge events are written to cloud `sync_events` for future server-side reconciliation.
- Successful events update local `bugs` / `attachments` to `Synced`, stamp `last_sync_at`, and remove the processed queue row.
- Failed events use basic exponential backoff and mark the local primary record `Sync Failed` after repeated failures.
- `supabase/schema-draft.sql` contains the current workspace-scoped PostgreSQL schema draft plus RLS helper/policies.

Current sync limitations:

- Remote pull into SQLite is not implemented yet.
- Conflict handling is not implemented yet beyond preserving deterministic `local_seq` / `op_id` ordering locally.
- Cloud taxonomy/reference-table mapping is minimal. Bug payloads currently preserve local labels/fields and set cloud taxonomy foreign keys to null until a fuller cloud taxonomy sync exists.
- The Supabase Storage bucket `attachments` and RLS policies must exist in the target project before attachment sync can succeed.
- Local data remains the source of truth for capture; cloud sync must remain best-effort and non-blocking.

Future sync should add:

- Remote pull into the local SQLite cache
- Conflict handling with `updated_at`, `client_id`, `local_seq`, and `op_id`
- Workspace/team management UI
- Role-aware RLS beyond basic workspace membership
- Cloud taxonomy/reference synchronization
- Better sync diagnostics and manual retry controls
## Future Web And Mobile Direction

The route structure intentionally maps to future web routes:

- `/capture`
- `/dashboard`
- `/bugs/:id`
- `/settings`

Future web app:

- Should reuse or recreate the Main Panel functionality.
- Should support viewing, editing, filtering, sharing, and team review.
- Does not need desktop snipping.

Future mobile app:

- Should focus on quick notes, thoughts, scenarios, review, and attachments.
- Should support existing image upload and camera photos.
- Does not need snipping-tool behavior.

## AI Processing And Triage

The active AI path is BYOK AI Processing through a universal OpenAI-compatible REST engine, not the older Ollama-only transport.

Active BYOK AI plumbing:

- `src/main/ai/byokIssueProcessor.ts` owns provider config, encrypted API-key handling, AI issue processing, and Bug Details triage.
- `src/renderer/src/components/settings/AiSettings.tsx` exposes the AI Processing tab.
- Shared types include `AiByokConfig`, `AiIssueProcessPayload`, `AiIssueProcessResult`, and `AiTriageBugPayload`.
- Preload exposes `getAiConfig`, `saveAiConfig`, `processIssueWithAi`, and `triageBug` through `window.bugPocket`.
- API keys are encrypted with Electron `safeStorage`; only encrypted key material is stored in `app_settings`.
- Provider presets: OpenAI, Grok, OpenRouter, Gemini, and Custom/Local.
- OpenRouter defaults to `google/gemma-4-31b-it:free` and `https://openrouter.ai/api/v1`.
- Gemini uses the OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai`.
- Custom/Local defaults to `http://localhost:11434/v1`, so OpenAI-compatible local servers can be used without changing the fetcher.
- The universal transport calls `${baseUrl}/chat/completions` with the standard OpenAI `messages` schema and native `fetch`; do not add provider SDKs unless there is a strong reason.
- OpenRouter requests include `HTTP-Referer: https://bugpocket.app` and `X-Title: Bug Pocket`.
- Base URL and Model ID are trimmed before saving.
- If the provider returns a non-2xx response, parse and surface the upstream `error.message`, `message`, or `detail` before falling back to `HTTP <status>`; do not swallow provider errors as generic network failures.
- If the provider returns an empty `choices` array or blank content, throw a clear empty-success error.

Current triage behavior:

- Bug Details sends the current bug fields to `window.bugPocket.triageBug(...)`.
- The default system prompt requires strict JSON with exactly `title`, `bugNote`, `stepsToReproduce`, `expectedResult`, and `actualResult`.
- The main process extracts the first JSON object from the model response before returning it to the renderer.
- `BugDetailPage.tsx` parses the returned JSON and maps the keys into the matching state setters. It does not auto-save immediately after mapping; normal auto-save/manual save is responsible for persistence.
- If JSON parsing fails, the raw returned text is placed into Bug Note as a fallback.
- Steps to Reproduce should remain numbered/plain-text friendly for Linear and Jira copy formats.

Vision payload rules:

- Do not pass local filenames or paths to the AI provider.
- If a bug has an image path, the main process loads it with Electron `nativeImage`.
- Screenshots are resized to a maximum width of 1024px when needed, compressed to JPEG at 80% quality with `toJPEG(80)`, and sent as `data:image/jpeg;base64,...` in an OpenAI-compatible `image_url` content part.
- This keeps desktop screenshots under provider/free-tier payload limits while preserving enough UI detail for triage.

Legacy Ollama notes:

- `src/main/ai/ollamaTriage.ts`, `AiOptionsPanel.tsx`, `ai_triage_enabled`, and `ollama_model_name` still exist from the earlier local-Ollama path.
- Do not treat the Ollama-specific `/api/chat` path as the current primary AI architecture.
- If reusing Ollama directly in the future, keep it opt-in and do not send screenshots without an explicit user action.

Important AI constraints:

- No AI generation should run automatically during Quick Capture.
- Do not send screenshots to AI unless the user explicitly chooses an AI action and the payload path clearly includes image use.
- Never bundle a shared remote AI API key into Electron. BYOK keys belong to the user and must stay encrypted locally.
- Future shared/public AI should still run through a backend and credit system, not direct bundled app credentials.

## Future AI And Monetization Direction

Ads are intentionally not part of the current MVP. BYOK AI Processing is available for explicit user-triggered triage/formatting, while shared cloud AI, pooled credits, and monetization remain future work.

Preferred future model:

- Finish desktop local-first MVP first.
- Finish cloud sync pull/conflict handling and accounts/team foundations before cloud AI.
- Run AI calls through a backend, never from a bundled Electron API key.
- Use shared cloud credits across web and desktop.
- Web can later use rewarded ads to earn AI credits.
- Desktop should consume credits but not show ads initially.
- Do not tie normal display/banner ads to credits.
- Cache AI-generated reports and only spend credits on explicit generation actions.

## Design Notes

Bug Pocket visual direction:

- Friendly QA capture tool.
- Clean and modern.
- Fast capture first.
- Not a Jira replacement.
- Quick Capture can be playful and denim/pocket-shaped.
- Main Panel should stay work-focused with subtle palette hints.

Palette cues:

- Pocket blue
- Dark navy
- Bug green
- Soft sky blue
- Soft yellow only when intentional
- Dusty red only for destructive actions

Avoid:

- Heavy enterprise project-management visuals.
- Too many columns in the dashboard table.
- Ads in the current desktop app.
- AI in the current report generator.
- Adding fields to Quick Capture unless they are truly capture-critical.

## Current Verification Habit

After implementation changes, run:

```powershell
npm run build
```

This runs TypeScript checks and builds Electron main, preload, and renderer bundles.

## Known Follow-Up Opportunities

High-priority product work:

- Finish and polish installer/distribution flow.
- Verify tray and shortcuts after packaged install.
- Finish cloud sync pull/conflict handling and diagnostics.
- Expand account/workspace/team management beyond the current auth/session capture.
- Improve Settings search if option lists grow large.
- Add verification around backup/restore behavior after packaging.

Potential UX work:

- Add keyboard shortcuts to Main Panel actions.
- Add dashboard saved views or favorite filters.
- Add attachment upload beyond screenshots.
- Add Device/Browser filters if they become important.
- Add better empty states.

Potential technical work:

- Add focused tests for report generation and title derivation.
- Add migration tests for SQLite schema changes.
- Harden the current sync queue drain/retry worker with diagnostics, manual retry, and remote pull coverage.
- Add verification around content-addressed attachment backup/restore.
- Consider extracting the spotlight/annotator logic into a dedicated hook (`useSpotlight`) shared by DashboardPage and BugDetailPage.

## Phase 2 Architectural Constraints (DO NOT OVERWRITE)

### 1. UI Physics & Rendering

* **No Modal Stacking:** Do not stack React portals. The Bug Details view is a root-level swap (hiding the Dashboard via `display: none` to preserve scroll state), rendering as a 100vw/100vh Side Drawer. The Screenshot Annotator is the *only* centered modal overlay.
* **Strict Z-Index:** Dashboard = 10, Details Drawer = 40, Annotator = 60.
* **Dropdowns:** All custom select dropdowns must use React Portals attached to `document.body` to prevent DOM reflow and layout shifting.
* **Presets:** Quick Capture uses a 3-slot permanent button array mapped to local `Alt+1`, `Alt+2`, `Alt+3` listeners. Do not use a dropdown for presets. Do not register these as global OS shortcuts.

### 2. File System & Storage

* **Content-Addressed Storage:** Attachments are saved via SHA-256 hashes of the file buffer (e.g., `<hash>.png`). Never save absolute file paths to the database.
* **Non-Destructive Annotation:** Edits made in the native HTML5 `<canvas>` annotator generate a *new* file hash and are saved with a `parent_id` pointing to the original unedited screenshot.
* **Storage Pruning:** A background worker deletes physical files (via `fs.unlink`) and nullifies the `content_hash` in the database for Discarded captures that are older than 60 days. Because attachments are content-addressed, prune a physical file only when that hash is not referenced by any non-discarded entry, newer entry, or child/lineage attachment that should remain viewable.

### 3. Failsafe Backup Protocol

* **Mechanism:** Backups must use asynchronous Node.js streams (via `archiver`) to prevent the Electron main process from freezing. Never buffer the entire database or image folder into RAM.
* **Safe Locking:** Always `fs.copyFileSync` the active SQLite database to a temporary file before zipping to avoid `EBUSY` OS lock crashes.
* **Restore:** Before replacing local data, validate that the `.bugpocket` archive has the expected structure (`bug-pocket.sqlite` plus optional `attachments/`). When importing, the active `db.close()` must be called before extraction to release file locks. The `BrowserWindow` must execute `reload()` immediately after extraction.
* **Auto-Backups:** Automated backups write to a user-defined directory stored in `app_settings` under `auto_backup_directory_path`. Enforce a strict rolling limit (delete oldest after 3 backups).

### 4. Packaging Constraints

* **Native Modules:** The build pipeline MUST use `electron-builder` and explicitly rebuild the `better-sqlite3` native C++ module against the exact bundled V8 Electron version.
* **ASAR Unpacking:** `better-sqlite3` must be added to the `asarUnpack` configuration so the OS can execute the native `.node` binaries outside the read-only archive.
* **Custom Icon:** `build/icon.ico` is the Windows application icon. Keep `package.json > build.directories.buildResources` pointed at `build`, and keep `win.icon` pointed at `build/icon.ico`.
* **Packaging Gotcha:** `npm run dist` cannot overwrite `release-build/win-unpacked/resources/app.asar` while an unpacked or installed Bug Pocket process is using it. Close running Bug Pocket instances before packaging.
* **Preload Path Split:** `npm run dev` uses `out/preload/index.js`, while `npm run start`/packaged builds use `out/preload/index.mjs` after `scripts/fix-preload.js`. Keep `preloadPath()` environment-aware; do not hardcode only `.mjs` or dev can white-screen.
* **S3 Updater Storage Contract:** `npm run dist:publish` must keep uploading the NSIS `.exe` and `latest.yml` to the `windows/` prefix of the public `bug-pocket-updates-v1` bucket on every release. Do not rename `latest.yml`; the Vercel website `/api/download` proxy depends on that exact manifest path to route users to the current installer.
* **S3 ACLs Disabled:** The updater bucket uses Bucket Owner Enforced permissions, so `package.json > build.publish[0].acl` must stay `null`. Do not restore `public-read` ACL publishing; public access should be handled by bucket policy.
* **Release Verification:** `.github/workflows/publish-desktop-update.yml` intentionally checks the public `windows/latest.yml` and resolved `.exe` after publishing. Keep this guard in place so broken update/download releases fail visibly.
