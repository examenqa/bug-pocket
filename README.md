# Bug Pocket

**[🌐 Visit bugpocket.app to download the latest Windows installer](https://bugpocket.app)**

Bug Pocket is a Windows-first, local-first desktop app for capturing bugs without interrupting active QA work. Testers can jot a short note, attach screenshots, annotate evidence, and return later to polish the report for Jira, Linear, Slack, email, or a custom template.

The public repository is intentionally decoupled from Examen QA release infrastructure. It does not auto-update, publish installers, or call private download endpoints by default.

## Core Stack

- **Electron** for the Windows desktop shell, native windows, tray behavior, global shortcuts, filesystem access, and OS dialogs.
- **React + TypeScript** for the renderer UI.
- **Decoupled Main/Renderer IPC** through the preload bridge at `src/preload/index.ts`; renderer code talks to native capabilities through `window.bugPocket` instead of direct Node access.
- **Embedded SQLite** via `better-sqlite3` for local state management under Electron's `app.getPath("userData")`.
- **Content-addressed attachments** stored on the local filesystem using SHA-256 hashes, so database rows never depend on absolute source file paths.
- **Optimized image pipeline** for local screenshots, annotation derivatives, and WebP/renderer assets. Screenshot evidence remains local-first and is copied into backup archives when exported.

## Local-First Architecture

Bug Pocket saves captures immediately to the user's machine:

- `bug-pocket.sqlite` stores bugs, taxonomy, settings, shortcuts, templates, and sync metadata.
- `attachments/` stores screenshot and attachment files by content hash.
- Backups export the SQLite database and attachment directory into `.bugpocket` archives.

Cloud Sync and support telemetry scaffolding exist in the codebase, but Cloud Sync is hidden in production builds while it remains under development. A normal local build does not require Supabase, S3, Vercel, or any hosted service.

## Main Architecture

Bug Pocket uses separate Electron windows for focused workflows:

- **Main App window:** dashboard, bug details, settings, templates, backups, and reporting.
- **Quick Panel window:** lightweight note capture with presets and screenshot attachment.
- **Snipping overlay window:** transient full-screen screenshot region capture.

The main process owns OS integrations and trusted local resources. The renderer stays UI-focused and uses typed IPC methods exposed by the preload bridge.

## Setup

```powershell
npm install
npm run dev
```

`npm install` runs `electron-rebuild` so `better-sqlite3` is compiled against the bundled Electron runtime.

For a production-style local build:

```powershell
npm run build
npm run start
```

To create a Windows NSIS installer locally:

```powershell
npm run dist
```

The installer is written to `release-build/`.

## Live Supabase Security Tests

`npm run test:security:live` executes real authentication, RPC, and RLS checks against a local Supabase Docker stack. It requires Docker Desktop and the Supabase CLI to be running. Apply [`supabase/schema-install.sql`](supabase/schema-install.sql) to the local project first, then expose the local URL, anon/publishable key, and service-role key reported by `supabase status -o env` as `SUPABASE_LOCAL_URL`, `SUPABASE_LOCAL_ANON_KEY`, and `SUPABASE_LOCAL_SERVICE_ROLE_KEY`.

The test runner rejects every non-loopback Supabase URL to prevent its destructive fixtures from reaching a hosted project.

## Developer Note: Windows SmartScreen

Public repository builds are unsigned. Windows may show an **Unknown Publisher** or SmartScreen warning when you run a compiled `.exe` installer.

That warning is expected for unsigned community builds and does not mean the app is broken. Avoiding it requires signing the installer with a trusted OV/EV code-signing certificate. Examen QA signing material is not included in this repository.

## License

Bug Pocket is released under the MIT License. See [LICENSE](LICENSE).
