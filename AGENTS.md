# Bug Pocket Agent Handoff

This document describes the current Bug Pocket build so another engineer, agent, or ChatGPT thread can plan future changes without relying on chat history.

## Product Summary

Bug Pocket is a Windows-first Electron desktop app for fast QA capture. The core problem is that testers often notice unrelated bugs, scenarios, observations, or questions while testing but do not want to break their current flow to write a full bug report. Bug Pocket lets them capture a short note and screenshot quickly, then return later to clean up details and generate structured reports.

The app is intentionally local-first. Captures and attachments save immediately to SQLite and the local filesystem. Cloud sync, ads, and web/mobile versions are planned but not active in the MVP. Local Ollama AI triage is available as an opt-in experimental desktop feature, but it is not part of the fast Quick Capture flow.

## Current Tech Stack

- Electron desktop app
- React renderer
- TypeScript
- `electron-vite`
- SQLite via `better-sqlite3`
- Local filesystem attachment storage using content-addressed files
- Supabase-ready schema draft and sync service placeholder
- Windows-first behavior with system tray and global shortcuts

Core commands:

```powershell
npm install
npm run dev
npm run build
npm run start
npm run dist
```

`npm install` runs `electron-rebuild` so `better-sqlite3` matches Electron.
`npm run dist` runs `electron-vite build && node scripts/fix-preload.js && electron-builder` and creates the Windows NSIS installer under `release-build`.

## Main Architecture

Bug Pocket currently has two persistent Electron windows plus a transient snipping overlay window:

- Quick Capture window: `#/capture`
- Main App window: `#/dashboard`, `#/bugs/:id`, and `#/settings`
- Snipping overlay window: `#/snip`, created only while taking a screenshot and closed after capture/cancel

Important files:

**Main process**
- `src/main/index.ts`: Electron windows, tray, global shortcuts, screenshot IPC, attachment download IPC, backup IPC, clipboard IPC, external URL launch IPC.
- `src/main/ai/ollamaTriage.ts`: optional local Ollama triage service for report/title/summary/severity assistance.
- `src/main/database.ts`: SQLite schema, migrations, defaults, CRUD, content-addressed attachments, sync queue, report templates. Also owns the `app_settings` key-value table.
- `src/main/sync/syncService.ts`: placeholder for future Supabase sync.

**Preload & shared**
- `src/preload/index.ts`: safe `window.bugPocket` bridge.
- `src/shared/types.ts`: shared model and IPC types.

**Renderer — entry**
- `src/renderer/src/main.tsx`: tiny `createRoot` entry only. All UI logic lives in the files below.
- `src/renderer/src/App.tsx`: `App`, `CaptureRoute`, `MainShell` — the root router and shell.

**Renderer — pages**
- `src/renderer/src/pages/DashboardPage.tsx`: bug table, filters, attachment spotlight.
- `src/renderer/src/pages/BugDetailPage.tsx`: `BugDetailsHost` + `BugDetailsView`, details autosave, AI triage mapping, attachment/version spotlight, and report actions.
- `src/renderer/src/pages/SettingsPage.tsx`: tabbed settings shell.
- `src/renderer/src/pages/SnipOverlay.tsx`: full-screen screenshot snip UI.

**Renderer — shared components**
- `src/renderer/src/components/shared/Select.tsx`: compact select wrapper.
- `src/renderer/src/components/shared/Badge.tsx`: `Badge` and `SyncBadge`.
- `src/renderer/src/components/shared/PillDropdown.tsx`: portal-based inline pill dropdown.
- `src/renderer/src/components/shared/OptionSelect.tsx`: `OptionSelect` and `ReferenceSelect`.
- `src/renderer/src/components/QuickCaptureForm.tsx`: Quick Capture UI and keyboard behavior.
- `src/renderer/src/components/ScreenshotAnnotator.tsx`: native canvas screenshot annotation tools.

**Renderer — settings components**
- `src/renderer/src/components/settings/settingsUtils.ts`: `hasSettingsMutationBridge`, `getSettingsPreviewItems`.
- `src/renderer/src/components/settings/ShortcutSettingsPanel.tsx`: shortcut recording UI.
- `src/renderer/src/components/settings/CapturePreferencesPanel.tsx`: screenshot review and startup toggles.
- `src/renderer/src/components/settings/JiraWorkspacePanel.tsx`: Jira workspace URL field.
- `src/renderer/src/components/settings/AiOptionsPanel.tsx`: Ollama enable/model config.
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

- Entry Type
- Application
- Module
- Environment
- Bug Note
- Screenshot button
- Save button

Important behavior:

- Quick Capture stays minimal. Do not add Device, Browser, issue fields, status, severity, or other details here unless explicitly requested.
- It supports creating missing Entry Type, Application, Module, and Environment values inline.
- Modules are scoped to the selected Application; new modules created from Quick Capture attach to that application.
- It can attach one or more screenshots before saving.
- By default, screenshots taken from Quick Capture expand the same Quick Capture window into an inline Review Screenshot mode before being attached.
- Review Screenshot supports Arrow, Freehand, Text, Mask, Undo, and `Ctrl+Z`.
- In Review Screenshot, `Attach` saves the annotated or unedited screenshot as a local unattached attachment and returns the Quick Capture window to compact size.
- `Discard` clears the pending screenshot without saving and returns the Quick Capture window to compact size.
- Settings can disable the review step and restore the older instant-attach flow.
- It saves locally first and then closes/minimizes after save.
- It uses the same record creation path as the Main App.

Quick panel shortcuts:

- `Alt+T`: Entry Type
- `Alt+A`: Application
- `Alt+M`: Module
- `Alt+E`: Environment
- `Alt+N`: Bug Note
- `Alt+S`: Screenshot
- `Ctrl+Enter`: Save
- `Esc`: Cancel
- `Tab` and `Shift+Tab`: normal field traversal
- `Alt+1`, `Alt+2`, `Alt+3`: apply the first three Quick Capture presets if configured

Dropdown behavior:

- Typing filters options.
- Arrow keys move through options.
- Enter selects the highlighted option.
- Esc closes an open dropdown first. If no dropdown is open, Esc closes the panel.

### Main App Panel

The Main App is the full desktop dashboard. It is required, not optional.

It includes:

- Dashboard
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
- Optional `Triage with Local AI` / `Refine AI Draft` controls when local AI is enabled
- Delete Report
- Save Details

The top six dropdown fields are arranged as 2 rows x 3 columns:

- Entry Type
- Application
- Module
- Environment
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
- Severity Values
- Issue Platforms
- Report Templates
- Global Shortcuts
- Capture Preferences
- Quick Capture Presets
- Data Management and backups
- Jira Workspace URL
- Local AI Triage options

Settings uses segmented secondary navigation:

- Preferences: Global Shortcuts, Capture Preferences, Quick Capture Presets.
- Taxonomy: Applications, Modules, Environments, Devices, Browsers, Entry Types, Severity Values.
- Outbound: issue destination/platform settings, Jira Workspace, Local AI Triage, Report Templates, Data Management.

Settings groups are compact collapsible cards. Closed cards show a count and preview chips. Open cards show add/edit/delete controls. Only one Settings card should be open at a time within a segment. Opening a new Settings card collapses the previous one.

Capture Preferences currently includes:

- Review screenshots before attaching in Quick Capture
- Run on System Startup

These preferences are stored in the `app_settings` key-value table (see Data Model). `quick_capture_annotate_screenshots` defaults to enabled and controls whether Quick Capture screenshots go through inline Review Screenshot mode before being saved. `run_on_system_startup` defaults to disabled.

Data Management currently includes:

- Manual export to a `.bugpocket` backup archive.
- Manual import/restore from a `.bugpocket` backup archive.
- Automated rolling backups to a user-selected directory, retaining the newest backups.

Local AI Triage settings currently include:

- `Enable Triage with Local AI`, stored in `app_settings` as `ai_triage_enabled`, default `false`.
- `Ollama model name`, stored in `app_settings` as `ollama_model_name`, default `qwen3-vl:8b`.
- Model names are validated before request dispatch and may contain only letters, numbers, hyphens, colons, underscores, and periods.
- The Bug Details `Triage with Local AI` button is not mounted unless `ai_triage_enabled` is true.

## Data Model

SQLite tables include:

- `bugs`
- `applications`
- `modules`
- `environments`
- `devices`
- `browsers`
- `attachments`
- `app_settings` — key-value store for scalar app preferences (see below)
- `config_options` — taxonomy lists only (entry types, severities, issue platforms)
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
| `ai_triage_enabled` | boolean (`"true"`/`"false"`) | `"false"` |
| `ollama_model_name` | string | `"qwen3-vl:8b"` |

Do NOT store these in `config_options`. The `config_options` table is only for multi-row taxonomy lists (entry types, severities, issue platforms, etc.).

The `database.ts` class exposes typed private helpers `getSetting(key)` and `setSetting(key, value)` that wrap all access to `app_settings`. Add new scalar preferences through those helpers only.

On first startup, `migrateToAppSettings()` runs inside a transaction: it reads any legacy `config_options` rows with matching keys, writes them into `app_settings`, and deletes those rows. This migration is idempotent.

The `bugs` table currently includes:

- `id`
- `application_id`
- `module_id`
- `environment_id`
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

Application and Module `context_description` fields are optional AI context fields. Settings > Taxonomy exposes them as `Context / Business Logic` textareas. Use the dedicated context IPC methods for explicit context saves:

- `window.bugPocket.updateApplicationContext(id, contextDescription)`
- `window.bugPocket.updateModuleContext(id, contextDescription)`

The normal rename/update methods also accept context for combined saves, but context-only buttons should use the dedicated context methods so the save path is unambiguous.

Environment, Device, and Browser are relational reference tables, not simple copied text fields. Renderer display models still expose joined `environment`, `device`, and `browser` names for tables, details headers, and report templates.

The `environments`, `devices`, and `browsers` tables include:

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
- `entity_type`
- `entity_id`
- `operation`
- `payload`
- `created_at`

Bug and attachment mutations should write to `sync_queue` in the same SQLite transaction as the primary table change.

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

## Report Generation

Report generation is template-based. The copy buttons do not invoke AI; they only render saved fields through stored templates. Local AI, when enabled, can help populate or refine the saved fields before the template is copied.

Current placeholders include:

- `{{title}}`
- `{{entry_type}}`
- `{{note}}`
- `{{application}}`
- `{{module}}`
- `{{environment}}`
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
*Context:* {{application}} > {{module}} | {{environment}}

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

## Screenshot Capture

Screenshot capture works like a snipping flow:

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

Quick Capture screenshot behavior:

- When `quick_capture_annotate_screenshots` is enabled, the snipped PNG is held in memory as a pending screenshot and not saved yet.
- The Quick Capture window expands into an inline Review Screenshot mode with the native canvas annotator.
- `Attach` persists the final image as a content-addressed local attachment, emits `screenshot:captured` back to Quick Capture, and restores compact size.
- `Discard` clears the pending image and saves nothing.
- When the preference is disabled, Quick Capture screenshots save immediately and return to the Quick Panel.

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
- `Ctrl+Alt+M`: opens Main App Dashboard by default.
- Global shortcuts are configurable from Settings using recorder controls.
- If Electron cannot register a shortcut because another app/system owns it, Settings shows a warning.
- Settings > Preferences includes `Run on System Startup`. This is stored in `app_settings` as `run_on_system_startup` and enforced on app boot through `app.setLoginItemSettings({ openAtLogin, openAsHidden: true, args: ["--background-start"] })` when enabled.
- When launched by Windows startup, Bug Pocket passes `--background-start` and starts hidden in the tray/background instead of opening the Main Panel.
- Bug Pocket uses `app.requestSingleInstanceLock()`. If a second instance is launched, it should not open another SQLite/IPC process; it should bring the existing Main App dashboard to the foreground.

In development, a second app launch opens the dashboard rather than only quick capture.

Development data isolation:

- When `app.isPackaged` is false, the main process appends `-dev` to Electron `userData` before database initialization.
- Dev builds and packaged builds should therefore use separate SQLite/attachment folders.
- All database and attachment paths must continue to resolve from `app.getPath("userData")`; do not hardcode the app data folder.

## Sync Status

The app is offline-first.

Current sync statuses:

- Local Only
- Sync Pending
- Synced
- Sync Failed

Sync is not implemented yet. The placeholder exists in:

- `src/main/sync/syncService.ts`
- `.env.example`
- `supabase/schema-draft.sql`

Local event logging is implemented, but no remote sync worker consumes it yet. Current bug and attachment INSERT/UPDATE/DELETE operations append JSON payloads to `sync_queue` inside the same transaction as the primary mutation.

Future sync should add:

- Supabase Auth
- Workspaces/teams
- RLS policies
- Supabase Storage for screenshots/attachments
- Local SQLite cache
- Sync worker that drains/retries `sync_queue`
- Conflict handling with `updated_at`
- Attachment upload state

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

## Local AI Triage

The app has an optional, local-only Ollama triage feature gated behind Settings > Outbound > Local AI Triage.

Current local AI plumbing:

- `src/main/ai/ollamaTriage.ts` exports `triageBugWithOllama(payload, configuredModelName)`.
- Preload exposes it as `window.bugPocket.triageWithOllama(payload)`.
- The main process IPC channel is `ai:triageWithOllama`.
- The service calls `http://localhost:11434/api/chat` for better compatibility with vision-language models such as Qwen-VL.
- Before calling Ollama, the main process checks `db.getAiTriageEnabled()`. If disabled, the IPC throws and no inference runs.
- The model name is loaded dynamically from SQLite via `db.getOllamaModelName()` and validated with `/^[a-zA-Z0-9\-:._]+$/` before any network request is sent.
- If `image_file_path` is provided, it reads the image and base64-encodes it into the Ollama `images` array.
- Image data passed to Ollama must be raw base64 only; strip any `data:image/png;base64,` style prefix before appending to `images`.
- The Ollama request uses a `messages` array with a system message and a user message. The user message contains the app/module/tester context and includes `images: [rawBase64]` when a screenshot is supplied.
- The Ollama request sets `stream: false` and `options.num_ctx = 8192`.
- The fetch request intentionally has no local AbortController timeout so slower local vision models can finish.
- Do not use Ollama API `format: "json"` for this flow; the prompt asks for raw JSON inside a fenced markdown code block, and the backend parser extracts the JSON before returning structured data.
- The expected JSON keys are `visual_analysis`, `bug_title`, `refined_summary`, `severity_level`, `steps_to_reproduce`, `expected_result`, and `actual_result`.
- Offline/resource/parser failures return a deterministic fallback response instead of crashing the app.
- The system prompt is hardened: the model is instructed to act as an Expert QA Tester, actively inspect screenshots and user annotations, avoid merely repeating tester notes, and output strictly JSON.
- `visual_analysis` is a scratchpad-style first key returned by the local AI service and must not be mapped into Bug Details UI fields.
- `refined_summary` is mapped into the Bug Note field when non-empty, replacing the rough tester note with a polished 1-2 sentence summary.
- The prompt includes clear sections: App Context, Module Context, Tester Note, Existing Manual Fields, and Task.
- Bug Details hydrates the payload with the selected Application and Module `context_description` values.
- After a successful first AI pass, Bug Details replaces `Triage with Local AI` with `Refine AI Draft`. Refinements send the current edited form state plus `refinement_note`; the backend prepends that correction to the Task section.
- The transport logs sanitized request structure, the first 50 characters of the raw image base64, raw Ollama response content, and full error stacks for debugging.

Important local AI constraints:

- This local Ollama path is opt-in and experimental.
- Engine Coupling: The local triage transport layer is currently tightly coupled to Ollama's specific REST API schema (`http://localhost:11434/api/chat` and its required JSON message array). While the model string is dynamic in the database, users cannot currently plug in OpenAI-compatible local engines like LM Studio or vLLM. Future engine-agnostic support will require refactoring the network request and adding an `API Base URL` parameter to the `config_options` schema.
- No AI generation should run automatically during Quick Capture.
- Do not send screenshots to AI unless the user explicitly chooses an AI action and allows image use.
- Future public/cloud AI still needs backend mediation; do not bundle remote AI API keys into Electron.

## Future AI And Monetization Direction

Cloud AI and ads are intentionally not part of the current MVP. Local Ollama triage exists as an opt-in experimental desktop-only feature; cloud AI, shared credits, and monetization remain future work.

Preferred future model:

- Finish desktop local-first MVP first.
- Add cloud sync and accounts before AI.
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
- Add real cloud sync.
- Add account/workspace model.
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
- Add a proper sync queue drain/retry abstraction before Supabase implementation.
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
* **Storage Pruning:** A background worker deletes physical files (via `fs.unlink`) and nullifies the `content_hash` in the database for Discarded captures that are older than 60 days.

### 3. Failsafe Backup Protocol

* **Mechanism:** Backups must use asynchronous Node.js streams (via `archiver`) to prevent the Electron main process from freezing. Never buffer the entire database or image folder into RAM.
* **Safe Locking:** Always `fs.copyFileSync` the active SQLite database to a temporary file before zipping to avoid `EBUSY` OS lock crashes.
* **Restore:** When importing a `.bugpocket` file, the active `db.close()` must be called before extraction to release file locks. The `BrowserWindow` must execute `reload()` immediately after extraction.
* **Auto-Backups:** Automated backups write to a user-defined directory stored in `config_options`. Enforce a strict rolling limit (delete oldest after 3 backups).

### 4. Packaging Constraints

* **Native Modules:** The build pipeline MUST use `electron-builder` and explicitly rebuild the `better-sqlite3` native C++ module against the exact bundled V8 Electron version.
* **ASAR Unpacking:** `better-sqlite3` must be added to the `asarUnpack` configuration so the OS can execute the native `.node` binaries outside the read-only archive.
* **Custom Icon:** `build/icon.ico` is the Windows application icon. Keep `package.json > build.directories.buildResources` pointed at `build`, and keep `win.icon` pointed at `build/icon.ico`.
* **Packaging Gotcha:** `npm run dist` cannot overwrite `release-build/win-unpacked/resources/app.asar` while an unpacked or installed Bug Pocket process is using it. Close running Bug Pocket instances before packaging.
