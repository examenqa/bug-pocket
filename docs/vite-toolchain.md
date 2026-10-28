# Windows Vite toolchain (EXA-70)

Evidence captured **28 October 2026**, starting from main
`2ef9a0fe89b8bc5f06a30a0ead931e842815792b`.
The dated files under [`evidence/exa-70`](evidence/exa-70) record this migration.
Resolve current versions from the lockfile; audit results are dated observations.

| Component | Before | Selected | Reason |
| --- | --- | --- | --- |
| Vite | 5.4.21 | **6.4.5** | Latest patch of the oldest upstream-supported security branch. |
| electron-vite | 2.3.0 | **6.0.0** | Current stable release with explicit Vite 6 compatibility. |
| React plugin | 4.7.0 | **5.2.0** | Most recent plugin release that accepts Vite 6. |
| Vite's esbuild | 0.21.5 | **0.25.12** | Resolves Vite's declared `^0.25.0`; patched threshold is 0.25.0. |
| tsx's esbuild | 0.28.1 | **0.28.1** | Existing separate compatible tree, unchanged. |

The direct toolchain declarations are exact pins. esbuild is exactly locked
through the supported parent range; no esbuild override is added. The
[`lock-changes.json`](evidence/exa-70/lock-changes.json) inventory retains every
added, removed and changed lock record, its parent path and reason.
[`evidence-hashes.json`](evidence/exa-70/evidence-hashes.json) distinguishes raw
Windows capture hashes from normalized LF hashes. With `core.autocrlf=true`,
working copies can contain CRLF while Git stores LF. The before lock's normalized
hash matches the verified baseline Git blob; snapshot bytes remain untouched.

[Vite's support policy](https://vite.dev/releases) currently gives security
backports to 6.4; 5.x is unsupported. Moving to 7 or 8 is unnecessary to resolve
these findings. [electron-vite 6](https://github.com/alex8088/electron-vite/releases/tag/v6.0.0)
explicitly retains Vite 6 and 7 compatibility. Earlier electron-vite releases
also accept Vite 6, but no continued maintenance commitment for those branches
was established. Version 6 uses Rolldown to bundle its configuration; application
builds still use the selected Vite 6 toolchain.

[plugin-react 5.2.0](https://github.com/vitejs/vite-plugin-react/releases/tag/plugin-react%405.2.0)
is the most recent Vite 6-compatible release; current plugin 6 requires Vite 8.
Its [README](https://raw.githubusercontent.com/vitejs/vite-plugin-react/plugin-react%405.2.0/packages/plugin-react/README.md)
documents Fast Refresh for React 16.9 and later, including the unchanged React
18.3.1. The older 4.7.0 declared compatible peers, but has been superseded.
No plugin-branch backport guarantee was found or is claimed. All selected host
engines accept the preserved Node **24.22.1**; the lock-wide check is in
[`engines.json`](evidence/exa-70/engines.json).

## Advisory and bundled-source evidence

[`advisory-dispositions.json`](evidence/exa-70/advisory-dispositions.json) links
all nine official advisory API snapshots and compares their actual affected
ranges to the after lock. [`source-evidence.json`](evidence/exa-70/source-evidence.json)
identifies the installed Vite distribution by SHA-256 and checks it against
the official registry tarball. Vite's embedded editor implementation is inspected
directly; updating a separate `launch-editor` package would not replace it.

Fresh full npm audit changes from **4 package entries (2 high, 2 moderate)** to
**1 high entry**, all from unchanged Electron. Production-only audit remains
**0 -> 0**. The distinct GHSA count changes from **21 -> 12**: the nine EXA-70
records leave their affected ranges, while the twelve Electron records remain
with EXA-66. Package-entry counts include propagated dependencies and do not
measure independently exploitable application paths. Production npm audit also
omits the separately shipped Electron runtime. Raw before/after audits and their
hashes are retained in [`audit-summary.json`](evidence/exa-70/audit-summary.json).

| Advisory | Patched threshold in selected line | Source or applicability evidence |
| --- | --- | --- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | esbuild 0.25.0 | Both locked esbuild trees exceed the affected range; serve/CORS is checked separately. |
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) | Vite 6.4.2 | Optimized `.map` paths must remain optimized dependency files before reading. |
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | Vite 6.4.4 | Bundled editor strips position suffixes, then resolves the path before the existence check. |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | Vite 6.4.4 | Bundled Windows command construction rejects percent signs and line breaks before execution. |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | Vite 6.4.4 | Patched HTML transform; application uses a normal SPA rather than the affected custom middleware setup. |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | Vite 6.4.3 | Strict file checks reject Windows tildes and non-drive colons before allow/deny evaluation. |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | Vite 6.4.4 | Absolute editor arguments; WSL conversion prefixes relative paths with `./`. |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | Vite 6.4.4 | Safe-module registry stores resolved filesystem identities. Advisory requires non-Windows; POSIX execution remains excluded. |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | Vite 6.4.3 | Bundled editor rejects UNC paths before any existence check. |

Version and source replacement establish the upstream repair. Executed benign
fixture checks are recorded separately. A loopback bind alone does not dismiss
malicious-site requests to a running local development server.

## Preload and native pipeline

The unchanged `electron.vite.config.ts` explicitly builds main and preload as
CommonJS. Main remains `out/main/index.js`; preload emits `out/preload/index.js`.
electron-vite 6 normalizes the existing `rollupOptions` configuration internally,
then presents the equivalent options to Vite 6. Its default dependency
externalization retains native `better-sqlite3`; explicit existing external
entries remain.

The current application source and generated main bundle implement the same
`preloadPath()` selection: development uses `../preload/index.js`; production
prefers an existing `../preload/index.mjs`, with `.js` as fallback. This is an
application convention. Current upstream does not unconditionally rewrite
every preload reference to `.mjs`.

Retain `scripts/fix-preload.js` and its build/start/dist invocations. It copies
the generated CommonJS `.js` bytes to the preferred production `.mjs` path.
The source evidence records byte equality; normal development, `npm start` and
packaged execution must each establish sandboxed loading and an accepted benign
IPC call. The older hidden-window bridge-presence probe alone cannot establish
normal IPC acceptance. The script's comment is corrected to describe the traced
behavior.

Electron's declaration and exact **43.1.0** lock record, Node 24.22.1, Actions
SHAs, builder 26.18.1, SQLite 12.11.1, React 18, archive remediation and approved
brace resolutions are preserved. So are native rebuilding, ASAR unpack patterns,
NSIS settings, icon editing and assets. Renderer sandboxing, context isolation,
CSP, navigation guards and IPC validation remain in the existing source.

## Windows verification and boundaries

Final executed checks, audit counts, startup isolation paths, warnings and
exclusions belong in `evidence/exa-70/validation.json` and the result snapshots
beside it. On Windows 10.0.26300 / Node 24.22.1 / npm 11.19.1, clean `npm ci`,
**327 Node/Electron tests, 21 renderer checks and ten security groups** passed.
TypeScript/Vite build and `electron-builder --win --dir` SQLite/tray/preload
smoke passed. No installer was created.

Normal dev, actual `npm start` and unpacked ASAR startup each rendered the real
application, accepted `settings:get` and `bugs:count`, rejected invalid IPC and
verified sandbox/isolation/navigation controls. The debugger pauses before app
imports to establish disposable userData before SQLite opens. Actual loaded
preloads were dev `.js`, start `.mjs` and packaged ASAR `.mjs`. Dev CSS HMR and
React Fast Refresh updated and restored the fixture in the same document.
Temporary files/profiles were removed and fixture source bytes restored. Only
Windows startup registry writes were intercepted to preserve user settings.
The CI workflow now runs these normal-startup checks after its existing smoke;
final PR-head CI is recorded in the PR and Linear checkpoint after pushing.

Initial toolchain validation encountered sandbox `spawn EPERM` in
Vite's Windows `net use` real-path probe. Repeating the same build with supported
process permissions passed, without a compatibility code change. That successful
early build preceded the final React plugin selection; final-head verification
must use all selected versions.

The new security fixture initially collided on port 5173 because Vite normalized
port zero to its default. Selecting an available OS port fixed the fixture;
the final full suite passed. Other harness adjustments and their superseded
results are explicit in `check-failures.json`.

The first [PR CI run](https://github.com/examenqa/bug-pocket/actions/runs/40641113588)
installed successfully but stopped when the security fixture's ordinary file
returned 403. A focused Windows regression reproduced that exact failure with
an actual 8.3 temporary-directory alias and passed after canonicalizing its
parent through `fs.realpathSync.native`. Vite correctly rejects tildes even
inside an allowed root. The fixture now uses the canonical directory spelling;
all deny/strict controls remain enabled. The first CI run did not record its
temp spelling, so attribution to that runner's alias is an inference. The
subsequent run prints both raw and canonical paths. See `short-temp-regression.json`.

The [second CI run](https://github.com/examenqa/bug-pocket/actions/runs/40641773413)
recorded `RUNNER~1` expanding to `runneradmin` and passed the ordinary-file,
CORS and Windows alternate-path controls. It then exposed a separate fixture
assumption: temp was on C: while the checkout/process cwd was D:. Vite 6's
Windows raw `/@fs` middleware strips the URL drive and serves relative to `/`,
so the outside-file request reached a nonexistent D: path and returned 404.
The disposable check process now changes into its canonical fixture directory
and restores cwd before cleanup. An actual allowed raw-file 200, real outside
file bytes and public allow/deny API assertions precede the still-required
outside-file 403. No denial assertion or application configuration was weakened.

Unsuppressed npm configuration/install-script notices, inherited transitive
deprecations, the local path-with-spaces rebuild diagnostic and builder duplicate
reference/resource-editing notices are recorded. The unchanged meta CSP emits
a `frame-ancestors` warning in every startup mode. Dev debugger startup also
emitted an Electron `startupData` diagnostic; the actual sandboxed bridge, real
IPC, renderer and HMR checks passed. Start/packaged did not emit it. Its cause
is not established, and this observation does not clear EXA-66. Expected invalid
IPC errors confirm the deliberate negative assertions. Debugger-free manual
acceptance and OS startup registration are not established by this harness.

The filtered `schema-install` run does not execute the Supabase boundary test.
Live Supabase/provider, POSIX advisory scenarios, installed NSIS, Store packages
and WACK acceptance remain outside the executed Windows checks unless explicitly
recorded otherwise. Only unpacked test artifacts are authorized here.

Historical EXA-68 evidence remains unchanged. Its disputed
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
record retains **audit-range removal; upstream-disputed report**, without a
verified code-level security-fix claim. Electron/Chromium remediation and
EXA-66's security hold remain separate from the nine Vite-scope records.

EXA-70 remains **In Progress** pending an independent external GPT-6 High review
and maintainer approval. Passing local checks and CI do not grant a security
exception or authorize merge, integration synchronization, installation-package
creation or publishing.
