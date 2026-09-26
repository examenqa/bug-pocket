# Bug Pocket Agent Handoff

Last updated: July 16, 2026.

This file is the working source of truth for engineers and coding agents. Prefer the current code and tests when this document and an old chat transcript disagree.

## Product

Bug Pocket is a Windows-first, local-first Electron application for fast QA capture. A tester can record a short note and screenshot without leaving the current task, then later complete, triage, format, and export the report.

Non-negotiable product rules:

- Local capture must work without a network connection or cloud account.
- Capturing a bug must never wait for Supabase or an AI provider.
- Quick Capture stays compact; detailed fields belong in Bug Details.
- Screenshots and credentials remain local unless the user explicitly invokes Cloud Sync, support upload, or AI triage.
- Cloud access is Bring Your Own Cloud (BYOC). Bug Pocket has no central discovery or credential middleman.

## Current Runtime

- App version: `0.9.9`
- Electron: `^43.1.0`
- React: `18.3`
- TypeScript: `5.9`
- SQLite: `better-sqlite3@12.11.1`
- Supabase JS: `2.106.2`
- Packaging: `electron-builder` with NSIS
- Target OS: Windows

Core commands:

```powershell
npm install
npm run dev
npm run test
npm run build
npm run test:packaged-smoke:build
npm run dist
```

`npm install` runs `electron-builder install-app-deps`. This rebuilds native dependencies against the installed Electron ABI. Do not remove it.

## Process Architecture

Bug Pocket separates trusted native work from the renderer:

- `src/main/index.ts`: Electron lifecycle, windows, tray, shortcuts, secure IPC registration, backup orchestration, updater integration, and graceful shutdown.
- `src/preload/index.ts`: typed `window.bugPocket` bridge. Do not expose raw Electron objects or `ipcRenderer`.
- `src/shared/types.ts`: shared domain and IPC types.
- `src/renderer/src/App.tsx`: route and shell composition.

Windows:

- Quick Capture: `#/capture`
- Dashboard: `#/dashboard`
- Bug Details: `#/bugs/:id`
- Settings: `#/settings/...`
- Screenshot overlay: `#/snip`

Every BrowserWindow must retain hardened navigation rules: deny arbitrary `will-navigate` targets and deny new windows by default. Approved HTTP(S) links open through `shell.openExternal` after protocol validation.

## Database Architecture

`src/main/database.ts` owns the SQLite layer.

Bug Pocket uses dynamic dual-database routing:

- `local.sqlite` is always open. It owns app settings, encrypted configuration, shortcuts, presets, templates, and local-only fallback data.
- `ws_<workspace-id>.sqlite` is mounted only while a cloud workspace is active. It owns that workspace's bugs, attachment metadata, taxonomy cache, and sync queue.
- With no active workspace, data operations fall back to `local.sqlite`.
- With an active workspace, workspace data must route strictly to the mounted workspace database. Do not silently route failed workspace operations into local data.

Database paths must always use `app.getPath('userData')`. Never write SQLite files relative to the installation directory or ASAR.

Workspace connections are explicit:

- `connectToWorkspace(id)` closes the previous workspace handle and mounts `ws_<id>.sqlite`.
- `disconnectWorkspace()` closes the better-sqlite3 handle and nulls it.
- Logout and credential replacement must stop/drain sync before disconnecting.

Taxonomy identifiers are polymorphic:

```ts
type TaxonomyId = string | number;
```

Legacy local rows can use numeric IDs. Cloud taxonomy uses canonical UUID strings. Never apply `Number(...)` or `parseInt(...)` to a taxonomy selection. The persistent `sync_identity` registry preserves known remote UUIDs and assigns random UUIDs to new local entities. Never derive cloud identity from local row numbers. See `docs/sync-protocol.md` for migration and revision rules.

Local workspace data acts as a loosely coupled cache. Do not reintroduce cross-database `REFERENCES` constraints between workspace bugs and taxonomy stored in another SQLite connection. Supabase owns authoritative cloud relational integrity.

## Attachments

Attachments are content-addressed:

- Filename: `<sha256>.<extension>`
- Directory: `<userData>/attachments`
- SQLite stores `content_hash` and `file_extension`, never arbitrary absolute paths.

Remote metadata validation is mandatory:

- `content_hash` must match `/^[a-f0-9]{64}$/i`.
- Extension allowlist: `png`, `jpg`, `jpeg`, `webp`.
- Resolve the absolute path and assert it remains inside the attachments directory.
- Reject invalid metadata before any database mutation or file write.

Remote downloads are atomic and verified:

1. Download to `<hash>.tmp`.
2. Calculate SHA-256 from the temporary bytes.
3. Compare with remote `content_hash`.
4. Rename atomically to the final path only on a match.
5. Delete the temporary file and retry later on mismatch or interruption.

Do not pass renderer-provided filesystem paths into AI or sync code. AI triage accepts a local attachment ID; the main process resolves and validates the path.

## Cloud Sync

Primary implementation: `src/main/sync/syncService.ts` (`SyncEngine`).

Cloud Sync is available in production. It is not a placeholder feature gate.

Current behavior:

- BYOC Supabase URL and publishable key are stored locally.
- Project URLs must be HTTPS `*.supabase.co`, except loopback HTTP URLs used for local Supabase testing.
- Secret/service-role keys are rejected. Never persist or accept privileged server credentials from the renderer.
- Supabase Auth sessions persist through `SafeStorageAdapter` using Electron `safeStorage` and local SQLite.
- Each remote workspace has a separate local SQLite database.
- Taxonomy pulls before bugs and attachments to satisfy cloud relationships.
- Local sync events drain in deterministic queue order, with taxonomy operations processed before dependent bug operations.
- Retry count and last error are recorded; diagnostics and force retry are available in Sync Settings.
- Supabase HTTP 503 is translated to `PROJECT_PAUSED`. Automatic retries stop until a manual retry or restart.
- A silent keep-alive ping runs only when BYOC credentials exist.

Remote pull is lossless and table-specific:

- Bugs and attachments have independent composite cursors `(updated_at, id)`.
- Each table drains batches until fewer than the batch limit are returned.
- Rows sort by `updated_at ASC, id ASC`.
- Persist a cursor only after its local batch transaction commits.
- Never replace this with a shared timestamp watermark; that causes permanent starvation across tables.

Conflict decisions use server revisions and idempotent operation receipts through `apply_sync_mutation`; client clocks never decide winners. Terminal remote tombstones delete the corresponding local cache row. Rejected local snapshots remain in `sync_conflicts` for recovery.

Workspace switching sequence:

1. Stop and drain the sync worker.
2. Disconnect the old workspace database.
3. Mount the new `ws_<id>.sqlite`.
4. Persist the new active workspace in `local.sqlite`.
5. Refresh role/permission state.
6. Restart sync.

## BYOC Onboarding And RBAC

Supabase installation source: `supabase/schema-install.sql`.

The install script must remain idempotent. It provisions tables, functions, triggers, storage buckets, grants, and RLS policies. Policy changes must be safe when the script is rerun.

Onboarding modes:

- Single workspace setup
- Team workspace setup with configurable role permissions
- Join Team using an encrypted invite token

Roles are dynamic through `roles_permissions` (`can_read`, `can_write`). RLS is authoritative. The renderer is only a usability layer; main-process IPC also checks cached `can_write` before every mutation.

Never authorize writes by comparing a role name such as `developer`. Any custom role with `can_write = false` is read-only.

Invite flow:

- Admin pre-authorizes an email through `invite_user_to_workspace`.
- Invite token uses AES-256-GCM and PBKDF2 with a random 12-byte IV.
- Payload includes project URL, publishable key, workspace/team ID, target email, issued time, and a 24-hour expiration.
- Imported details are shown to the user before `Confirm & Connect`.
- Login/signup email must match the email bound into the token.
- After authenticated login, `claim_pending_invite()` claims membership; signup triggers do not silently claim invitations.
- Replacing credentials must fully disconnect the previous project before saving or initializing the new one.

Never add a self-enrollment RLS policy to `workspace_members`. Standard authenticated clients cannot insert their own memberships.

Live RLS/RPC verification:

```powershell
npm run test:security:live
```

This requires Docker Desktop, Supabase CLI, the local schema, and loopback-only Supabase environment variables. The test runner intentionally rejects hosted URLs.

## IPC And Renderer Security

Security helpers live under `src/main/ipc/`:

- `secureIpc.ts`: trusted-sender checks and argument schema validation.
- `workspaceWriteAccess.ts`: cached `can_write` enforcement.
- Focused handlers such as `byokAiConfigIpc.ts` and `bugDeletionIpc.ts`.

Rules:

- Every invoke channel needs explicit runtime argument validation.
- Destructive handlers must validate sender origin and authorization before touching SQLite.
- Renderer configuration reads expose key-presence booleans, never decrypted API keys.
- Renderer key operations are replace or clear, not read-back.
- Keep the restrictive CSP in `src/renderer/index.html`.
- Do not expose `desktopCapturer`; return only verified image data or a controlled local result.
- External URLs must be limited to `http:` and `https:` and opened in the system browser.

## AI Processing

Primary implementation: `src/main/ai/byokIssueProcessor.ts`.

- Uses native `fetch` and OpenAI-compatible `/chat/completions`; do not add provider SDKs without a concrete need.
- Supports OpenAI, Gemini-compatible endpoints, OpenRouter, Grok, and custom/local compatible servers.
- API keys are encrypted with Electron `safeStorage` and never cross IPC in plaintext.
- Provider failures surface actionable upstream messages.
- Gemini requests use the configured model first, followed by deduplicated fallback models only on HTTP 429/5xx. See `docs/ai-lifecycle.md` for deadlines, cancellation, and field-safe merging.
- Vision images are resolved by attachment ID, resized with `nativeImage`, and JPEG-compressed before Base64 encoding.
- Strict JSON response mode maps `title`, `bugNote`, `stepsToReproduce`, `expectedResult`, and `actualResult` into editable React state.
- Malformed JSON falls back to Bug Note instead of crashing.

AI is explicit and user-triggered. Never run AI automatically during Quick Capture.

## Backup, Restore, And Data Deletion

Primary implementation: `src/main/sync/backupService.ts`.

Backups include:

- `local.sqlite`
- The active `ws_<id>.sqlite`, when connected
- Only attachment files referenced by the archived databases
- A manifest containing database mapping and attachment hash/size metadata

Do not walk and archive the entire shared attachments directory; doing so leaks inactive workspace data.

Restore protocol:

1. Extract to a staging directory, never directly into live `userData`.
2. Validate manifest paths and reject traversal.
3. Open staged databases and require `PRAGMA integrity_check` to return `ok`.
4. Stop active operations and close database handles.
5. Atomically replace the validated database files.
6. Roll back both files if commit validation fails.
7. Remove dynamic `*.sqlite-wal` and `*.sqlite-shm` sidecars as part of the controlled swap.
8. On pre-commit failure, leave live files untouched.

Deletion commands are distinct:

- `clearCurrentWorkspace()`: removes only the mounted workspace and prunes files no longer referenced by any local or workspace database.
- `factoryReset()`: removes all workspace databases and attachments, and clears local bugs/taxonomy while retaining app settings and presets.

Do not collapse these into one broad delete operation.

## Application Lifecycle

`gracefulShutdown()` must:

1. Pause renderer mutation entry points.
2. Drain `OperationBarrier` tasks.
3. Stop and drain sync.
4. Disconnect workspace and close SQLite handles.
5. Proceed with application quit.

Long-running backups, workspace switches, and AI calls must register with `src/main/OperationBarrier.ts`. If shutdown fails, restart background services and global shortcuts where possible.

Closing the main window normally minimizes Bug Pocket to the system tray. Application quit uses the explicit graceful lifecycle.

## UI Structure

Important renderer files:

- `DashboardPage.tsx`: state tabs, filters, bug list, count metric, and attachment spotlight.
- `BugDetailPage.tsx`: editable report, attachment actions, report preview, export actions, and AI triage.
- `useAutoSave.ts`: details debounce, dirty comparison, in-flight state, and flush handshake.
- `SettingsPage.tsx`: route-based settings content.
- `SyncSettings.tsx`: progressive BYOC setup, Join Team, authentication, workspace switch/name, diagnostics, invites, and disconnect.
- `AiSettings.tsx`: BYOK provider, model, encrypted key status, and system prompt.
- `TemplateSettings.tsx` / `TemplateManager.tsx`: report destinations, token insertion, and templates.
- `QuickCaptureForm.tsx`: compact capture and screenshot attachment state.
- `ScreenshotAnnotator.tsx`: arrow, freehand, text, mask, and undo.

Settings navigation lives in the global sidebar. Do not reintroduce a second nested Settings sidebar.

Quick Capture fields remain:

- Application
- Module
- Environment
- User Role
- Bug Note
- Screenshot

`entry_type` is hardcoded to `Bug` in Quick Capture and preset payloads.

## Build And Packaging

Important packaging constraints:

- `asarUnpack` must include `**/*.node` and `node_modules/better-sqlite3/**/*`.
- `extraResources` copies `assets/` into packaged resources.
- Main-process assets use `getAssetPath()` and `process.resourcesPath` when packaged.
- Windows icon source is `build/icon.ico`.
- `afterPack` runs `scripts/patch-windows-icon.cjs` because executable resource editing is handled explicitly.
- `scripts/fix-preload.js` is required after electron-vite build. Do not remove it without verifying development, start, and packaged preload paths.
- Close running Bug Pocket processes before rebuilding `release-build`.

`npm run dist` builds the NSIS installer in `release-build/`.

## CI And Tests

Workflow: `.github/workflows/ci.yml`.

- Runs on `windows-latest` for pushes and pull requests targeting `main` or `dev`.
- Uses Node 20 for native dependency stability.
- `npm ci` sets `npm_config_build_from_source=false` to prefer compatible prebuilds.
- Runs tests, TypeScript/electron-vite build, and packaged smoke verification.

Node 20 test runner constraints:

- Do not add `--test-isolation=none`; Node 20 does not support it.
- Native TypeScript tests must use `node --import tsx --test ...`.
- Tests launched through `scripts/run-electron-test.cjs` run in Electron where native bindings are required.
- Time-sensitive tests must freeze their clock deterministically; do not calculate expiry from two independent `Date.now()` calls.

Required verification for normal changes:

```powershell
npm run test
npm run build
```

For native, asset, database, preload, or packaging changes also run:

```powershell
npm run test:packaged-smoke:build
```

## Repository Hygiene

- `main` and `dev` are protected integration branches; keep them synchronized only after CI passes.
- Do not commit generated local Supabase state such as `supabase/.branches/` or scratch SQL under `supabase/snippets/`.
- Do not commit `.env` files, Supabase secret/service-role keys, provider API keys, AWS keys, or signing material.
- Preserve unrelated user changes in a dirty worktree.
- Use focused commits and include the verification performed.

## High-Risk Regression Checklist

Before changing sync, storage, auth, backup, IPC, or updater code, verify that the change does not reintroduce any of these resolved failures:

- Workspace self-enrollment or role escalation
- Plaintext API keys crossing IPC
- Renderer-provided absolute file paths
- Attachment path traversal or unverified binary downloads
- Shared sync timestamp watermarks
- Open workspace handles after logout
- Cross-workspace attachment leakage in backups or deletion
- Destructive restore before archive validation
- Read-only roles mutating through IPC
- Unstaged updater shutdown
- Main-process quit while a backup, AI call, or sync write is active
- Native `better-sqlite3` bindings packed inside ASAR
- TypeScript tests launched on Node 20 without the `tsx` loader
