# Bug Pocket

Windows-first Electron desktop app for quick bug capture while testing.

## What is implemented

- Electron + React + TypeScript app scaffolded with `electron-vite`
- Local SQLite database in the user app data directory
- Quick capture window with Entry Type, Application, Module, Environment, Bug Note, Take Screenshot, and Save
- Quick capture dropdowns can add missing Entry Type, Application, Module, and Environment values in place
- Entry types for Bug, Scenario, Question, Observation, and Improvement
- Dashboard with search and filters for Entry Type, Application, Module, Environment, Status, Severity, and Reported state
- Full bug details view with device, browser, local capture status, severity, reported state, issue fields, tags, screenshots, and report preview
- Local capture lifecycle statuses: Draft, Reported, and Discarded
- Screenshot attachment preview, add, and remove actions from the full bug details view
- Offline-first local save for entries and attachments, with visible sync status badges
- Generic attachment source model for snips, screenshots, clipboard images, uploads, camera photos, and other files
- Settings page for adding, editing, and removing applications, modules, environments, devices, browsers, severities, issue platforms, and report templates
- Snipping Tool-like region capture that saves PNG files locally and stores attachment paths in SQLite
- System tray entry and configurable global shortcuts: `Ctrl + Alt + P` for Quick Capture and `Ctrl + Alt + M` for the Main App
- Template-only report generation and copy actions
- App icon and favicon use the text-free mark at `resources/bug-pocket-icon.png`
- Header title uses the transparent text logo at `resources/bug-pocket-title.png`
- Color scheme based on the Bug Pocket logo artwork
- Supabase-ready sync service placeholder and schema draft

## Layouts and routes

Bug Pocket uses two Electron windows:

- Quick Capture window: loads `#/capture`
- Main App window: loads `#/dashboard`, `#/bugs/:id`, and `#/settings`

The route names are intentionally web-friendly so the renderer can later be reused in a browser app. Quick capture uses the shared bug creation service, so records saved from `#/capture` are the same records shown and edited in the main dashboard.

The Quick Capture panel intentionally shows only Entry Type, Application, Module, Environment, Bug Note, Take Screenshot, and Save. The Main App panel contains the complete dashboard, full detail editing, report generation, and configuration workflows.

## Setup

```powershell
npm install
npm run dev
```

`npm install` runs `electron-rebuild` for `better-sqlite3` so the native SQLite binding matches Electron.

For a production renderer/main build:

```powershell
npm run build
npm run start
```

## Local data

Bug Pocket stores local data under Electron's `app.getPath("userData")` directory:

- `bug-pocket.sqlite`
- `screenshots/*.png`

No Supabase account is required for the MVP.

Entries and attachments are saved locally first. The current MVP marks local records with sync states such as `Local Only` and `Sync Pending`; the cloud push/pull implementation is prepared but intentionally deferred.

## Future sync notes

The app includes:

- `src/main/sync/syncService.ts`
- `.env.example`
- `supabase/schema-draft.sql`

Sync is intentionally not active yet. The next phase should add authentication, workspace/team membership, RLS policies, Supabase Storage upload for screenshots, local change tracking, and timestamp-based conflict handling.

Future mobile clients can reuse the cloud schema for quick notes, scenarios, review, and attachments. Mobile should attach existing images or camera photos rather than implement desktop snipping.

## Future AI and monetization notes

Ads and AI are intentionally out of scope for the current local-first MVP. Finish the desktop app, cloud sync, and the future web main panel before adding monetization.

Preferred future model:

- Keep Quick Capture ad-free, fast, and offline-first.
- Add AI report generation only after cloud accounts and backend support exist.
- Run AI calls through a backend service so provider API keys are never bundled into the Electron app.
- Use a shared cloud credit balance so credits earned on web can be spent from either web or desktop.
- If ads are added, use web rewarded ads for an explicit "watch an ad to earn AI credit" flow.
- Do not tie normal display/banner ads to credits, clicks, or generated reports.
- Cache generated reports and only spend credits for intentional AI generation actions.
