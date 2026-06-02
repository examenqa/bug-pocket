# Bug Pocket Future Roadmap

Do not implement these features yet. This document exists to make the intended product direction clear for future agents and developers.

## Product Direction

Bug Pocket is a Windows-first, local-first QA capture tool.

The core product promise is:

> Capture bugs, scenarios, observations, and testing thoughts quickly without breaking the tester's flow, then clean them up and report them later.

The desktop app must remain the primary capture experience. Future web and mobile versions should support review, editing, sharing, AI credits, and lightweight note capture, but they must not weaken or complicate the fast desktop workflow.

## Current MVP Baseline

The current app already includes:

- Windows Electron desktop app
- Quick Capture Panel
- Main Desktop Panel
- Local SQLite database
- Content-addressed local attachment storage
- Snipping-style screenshot capture
- Inline Quick Capture screenshot review
- Native screenshot annotation tools: Arrow, Freehand, Text, Mask, Undo, and non-destructive annotated copies
- Entry types: Bug, Scenario, Question, Observation, Improvement
- Local capture statuses: Draft, Reported, Discarded
- Search/filter dashboard
- Full details page
- Configurable settings
- Template-based report generation
- Consolidated Quick Report template
- System tray and global shortcuts
- Manual `.bugpocket` backup export/import
- Automated rolling backups to a user-selected directory
- Windows startup toggle with background startup behavior
- Dev/prod user-data isolation
- Local Ollama AI triage implementation exists in code but is currently locked behind a coming-soon state
- Supabase Phase 1 scaffold: local Project URL / anon key settings, connection test, SyncEngine client initialization, and workspace-scoped schema draft

Do not remove or weaken the local-first desktop behavior.

## Phase 1: Desktop MVP Stabilization

Goal: make the existing desktop app reliable enough for daily QA use.

Focus areas:

- Finish and polish Windows installer/distribution flow.
- Verify packaged install behavior.
- Verify tray icon behavior after install.
- Verify global shortcuts after install.
- Verify screenshot capture after install.
- Verify database path and screenshot storage path.
- Add safe local data handling.
- Add useful empty states.
- Add basic diagnostics/log export.

Already implemented in this phase:

- Windows NSIS packaging configuration through `electron-builder`.
- Custom Windows icon wiring.
- Manual backup export/import.
- Automated rolling backups with a strict retention limit.
- Startup toggle with hidden/background launch.
- Single-instance lock.
- Separate dev and packaged user-data paths.

Acceptance criteria:

- User can install the app on Windows.
- User can capture entries quickly.
- Screenshots save reliably.
- Entries are visible in the Main Panel.
- Reports can be copied reliably.
- User can back up and restore local data.
- `npm run build` passes.

Important: do not add cloud sync, ads, or team features in this phase. Keep local Ollama AI optional, explicit, and outside Quick Capture.

## Phase 2: Screenshot Editing Tools

Goal: improve captured screenshots without turning Bug Pocket into a full image editor.

Recommended tools:

- Draw arrow
- Freehand drawing
- Add text label
- Mask/redact sensitive area
- Undo
- Save edited copy
- Preserve original screenshot where practical

Already implemented:

- Arrow, Freehand, Text, Mask, Undo, and `Ctrl+Z`.
- Inline Quick Capture review before attachment when enabled.
- Spotlight annotator from Dashboard and Bug Details screenshots.
- Non-destructive annotation versioning using `parent_id`.
- Version history display inside the annotator.

Still useful later:

- Crop.
- Rectangle tool.
- More explicit redact/mask strength options.
- Better version comparison or restore UX.

Rules:

- Keep editing fast and simple.
- Do not overload the screenshot UI.
- Edited screenshots should remain linked to the same entry.
- Support multiple attachments per entry.

Acceptance criteria:

- User can capture a screenshot.
- User can mark the important area.
- User can blur sensitive info.
- User can save the edited screenshot.
- Original screenshot is not accidentally lost unless the user chooses to overwrite.

## Phase 3: Support and Help

Goal: add a simple support area inside the desktop app.

Add a Support button/menu with:

- Help
- Report a Bug
- Request a Feature
- About Bug Pocket
- Export Diagnostics

Future Help direction:

- Add a Help page to the future web app.
- Link to that Help page from a Support button in the Main Panel.
- Include active desktop shortcuts and shortcut troubleshooting there once the web/support surface exists.

Report a Bug behavior:

- Should allow the user to report issues about Bug Pocket itself.
- It can reuse Bug Pocket's own entry/report structure.
- If cloud sync/support backend is not available yet, prepare the UI but keep submission local or mailto-based.

Rules:

- Do not auto-upload logs or screenshots without user confirmation.
- Make diagnostics export explicit.
- Keep support lightweight.

## Phase 4: Local Only Mode

Goal: support cautious testers who never want their data synced.

This becomes important once sync is added, but the setting can be planned early.

Add a clear mode called:

**Local Only Mode**

Behavior:

- No cloud sync.
- No team sharing.
- No AI upload.
- No remote backup.
- No web visibility.
- Everything remains on the user's device.

UI requirements:

- Show a clear badge/status when Local Only Mode is active.
- Warn that data will not appear on web/mobile/team versions.
- Do not treat Local Only Mode as an error.
- Allow the user to choose this per workspace, not just globally, if possible.

Acceptance criteria:

- A local-only workspace never syncs.
- Sync service does not upload entries, attachments, reports, or metadata.
- AI actions are disabled or clearly blocked for local-only data unless the user explicitly changes mode.

## Phase 5: Login, Cloud Sync, and Personal Workspace

Goal: add account-based sync without breaking local-first capture.

Core principles:

- Capture must save locally first.
- Sync must happen in the background.
- App must work without internet.
- Cloud failure must not block local capture.

Add:

- Supabase Auth or equivalent authentication.
- Personal workspace creation/onboarding.
- Sync worker that drains the existing local sync queue.
- Attachment upload queue.
- Cloud storage for screenshots/attachments.
- Sync status per entry and attachment.
- Conflict handling using `updated_at`.
- Manual sync retry.
- Sync error visibility.

Sync statuses:

- Local Only
- Sync Pending
- Synced
- Sync Failed

Acceptance criteria:

- User can log in.
- Local entries sync to cloud.
- Synced entries remain available locally.
- App still works offline.
- Sync failures do not cause data loss.
- Screenshots upload and remain viewable after sync.

Important: do not delete local data immediately after cloud sync. Local data should remain as cache/offline backup unless the user chooses cleanup settings.

## Phase 6: Team Workspaces

Goal: allow teams to share bug notes, avoid duplicate reporting, and optionally allow lead approval.

Team model:

- Personal workspace
- Team workspace

Suggested roles:

- Owner
- Admin
- Lead
- Member
- Viewer

Team features:

- Shared entries.
- Shared screenshots.
- Comments.
- Assignment.
- Duplicate marking.
- Already Reported indicator.
- Issue ID/URL visibility.
- Lead review/approval flow.
- Activity history.
- Team filters.

Lead approval options can be introduced later as a team-review workflow that is separate from the local capture lifecycle. Do not treat these as active local defaults; the current local capture statuses remain `Draft`, `Reported`, and `Discarded`.

Possible future team-review options:

- New
- Needs Review
- Approved to Report
- Rejected / Not a Bug
- Duplicate
- Reported

Important: the first team version can focus on sharing and duplicate avoidance. Formal lead approval can come after shared workspace basics are stable.

Acceptance criteria:

- Team members can see shared entries.
- Team can avoid reporting the same issue twice.
- Lead/admin can mark entries as approved/rejected/duplicate.
- Reported Issue ID can be added and viewed by the team.

## Phase 7: Web Main Panel

Goal: add a web version for viewing and managing entries, not for quick capture.

The web app should support the Main Panel functionality:

- Dashboard
- Search
- Filters
- Entry details
- Screenshot preview
- Status updates
- Severity updates
- Issue ID and URL
- Comments
- Team review
- Copy report
- Account/team settings
- AI credit management later

The web app does not need:

- Desktop snipping
- System tray
- Global desktop shortcuts
- Quick Capture overlay

Rules:

- Do not force the desktop app to behave like a web app.
- Web should be a companion dashboard.
- Desktop remains the best capture tool.

Acceptance criteria:

- User can log in on web.
- User can see synced entries.
- User can update details/status.
- User can view screenshots.
- Team users can review shared entries.

## Phase 8: AI-Generated Bug Reports and Credit System

Goal: evolve the current optional local Ollama triage into a safer, engine-aware, cloud/account-ready AI system.

Current local AI baseline:

- Local Ollama triage implementation exists in code, but the packaged app currently locks AI Triage behind a coming-soon state.
- Settings > AI Triage shows a coming-soon placeholder instead of enable/model controls.
- Bug Details should not expose AI action buttons while `AI_TRIAGE_AVAILABLE = false`.
- The existing implementation calls `http://localhost:11434/api/chat` with Ollama's message-array schema when re-enabled.
- It can use screenshot base64, Application context, Module context, tester note, and existing manual fields.
- It returns `visual_analysis`, `bug_title`, `refined_summary`, `severity_level`, `steps_to_reproduce`, `expected_result`, and `actual_result`.
- `refined_summary` should overwrite the Bug Note only after an explicit AI action.
- Bug Details has refinement code for `Refine AI Draft` with a user correction note after the first successful AI pass, but it is currently hidden by the feature gate.
- The configured Ollama model name is dynamic but validated to a safe model-name character set.
- The current transport is tightly coupled to Ollama and does not yet support LM Studio, vLLM, or OpenAI-compatible local servers.

Important rules:

- Cloud AI must run through a backend.
- Never bundle remote API keys in the Electron app.
- Never send data to AI automatically.
- User must explicitly click an AI generation action.
- Show what data will be sent.
- Allow excluding screenshots.
- Cache AI-generated reports.
- Only spend credits on explicit AI actions.
- Future engine-agnostic local AI support needs an API Base URL setting and a transport abstraction.

Future AI context model:

Application and Module are no longer simple labels only. They already support optional `context_description` fields. Future work can expand these into richer structured context fields.

Application context fields:

- Name
- Description
- Domain / app type
- Common user roles
- Notes

Module context fields:

- Name
- Linked application
- Description
- Primary responsibility
- Common workflows
- Important rules/context

AI report generation should use:

- Application description
- Module description
- Entry type
- Bug note
- Environment
- Device
- Browser
- Screenshots/attachments, only if explicitly allowed
- Existing manually entered fields

AI output rules:

- Do not invent unsupported facts.
- Use application/module context to improve accuracy.
- Clearly separate inferred content from confirmed user-entered content.
- Prefer placeholders when steps, expected result, or actual result are missing.
- Allow user to review and edit AI output before copying or saving.

AI features:

- Generate polished bug title.
- Generate refined summary.
- Generate steps to reproduce.
- Generate expected/actual result.
- Suggest severity.
- Suggest duplicate/similar entries.
- Generate team/chat summary if a chat template is intentionally reintroduced.
- Generate Linear/Jira-friendly report.

Credit model:

- User has AI credits.
- Web can offer rewarded ads to earn AI credits.
- Desktop can consume AI credits.
- Desktop should not show ads initially.
- Normal banner/display ads should not be tied to credits.
- Rewarded ads should be optional.

Acceptance criteria:

- User can generate AI report from saved entry.
- Credit is deducted only after successful generation.
- Generated report is cached.
- Failed AI generation does not spend credit.
- User can see remaining credits.

## Phase 9: Lite Mobile App

Goal: create a lightweight mobile companion app.

Mobile purpose:

- Quick notes
- Quick thoughts
- Scenario capture
- Review entries
- Update status
- Add Issue ID
- Attach images/photos

Mobile should support:

- Add quick note.
- Add Scenario / Question / Observation.
- Attach existing image from gallery.
- Take photo from camera.
- View synced entries.
- Edit basic fields.
- Add comments.
- Mark as reported.
- Copy/share report.

Mobile does not need:

- Snipping Tool behavior.
- Desktop-style screenshot capture.
- Full dashboard complexity in the first version.

Acceptance criteria:

- User can create a note from mobile.
- User can attach a photo or existing image.
- Entry syncs to the same cloud database.
- Entry is visible on desktop/web.
- User can review and update entries.

## Phase 10: Integrations

Goal: reduce duplicate manual work when reporting bugs to external platforms.

Possible integrations:

- Linear
- Jira
- GitHub Issues
- Trello
- Google Sheets export
- CSV/Excel export
- Markdown export

Start with export/copy first, then API integrations later.

Recommended order:

1. Copy formatted report.
2. Export CSV/Excel.
3. Generate platform-specific Markdown.
4. Add issue link tracking.
5. Add API-based issue creation later.

Acceptance criteria:

- User can generate a platform-ready report.
- User can copy it cleanly.
- User can store Issue ID and Issue URL.
- API integrations do not block normal local capture.

## Cross-Cutting Product Rules

### Quick Capture Rules

Do not overload the Quick Capture panel.

Quick Capture should stay focused on:

- Entry Type
- Application
- Module
- Environment
- Bug Note
- Screenshot
- Save

Do not add Device, Browser, status, severity, Issue ID, or long report fields to Quick Capture unless explicitly requested.

### Main Panel Rules

The Main Panel can contain full functionality:

- Full details
- Reports
- Status
- Severity
- Screenshots
- Settings
- Search
- Filters
- Team review later

### Privacy Rules

- Local-first by default.
- Never auto-upload without sync/account context.
- Local Only Mode must be respected.
- AI upload must require explicit action.
- Screenshots may contain sensitive client data, so handle them carefully.

### AI Rules

- No automatic AI in Quick Capture.
- Local Ollama AI is opt-in and experimental.
- Cloud AI remains future work.
- No frontend API keys.
- Cloud AI must be backend-mediated.
- Cache AI output.
- Spend credits only on successful explicit AI generation.

### Ads Rules

- No ads in desktop MVP.
- If ads are added, prefer rewarded ads on web only.
- Watching an ad can grant AI credits.
- Do not show intrusive ads inside the desktop capture workflow.

### Testing / Verification

After each implementation phase:

```powershell
npm run build
```

Before release or packaging:

- Verify installer behavior.
- Verify tray behavior.
- Verify global shortcuts.
- Verify screenshot capture.
- Verify local data persistence.
- Verify backup/restore.
- Verify local AI remains disabled by default and never runs automatically.
