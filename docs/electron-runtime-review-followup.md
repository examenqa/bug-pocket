# EXA-66 — PR #7 review follow-up, 28 October 2026

This follow-up addresses the supplied independent review of PR #7 at
`e92e69b060eb868a95d85159863a07a32fba2060`. Keep the PR draft and issue
In Progress. The [43.8.3 report](electron-runtime-validation.md), its evidence
files and CI run 40525125483 remain historical results for that commit.
They are not relabelled as validation of this update or of a combined PR #6/#7.

## Focused change

Pin Electron exactly `43.8.4`, the latest supported stable 43.x release observed
on 28 October. Its [official release](https://github.com/electron/electron/releases/tag/v43.8.4)
was published at `2026-10-27T17:52:41Z`, after the earlier evidence capture.
It updates embedded Node from `24.22.0` to the `24.22.1` security release.
Chromium remains `150.0.7871.250`; unchanged version strings alone do not
establish which source backports are present.

The lockfile changes only the Electron declaration, resolved version, tarball
and integrity. Preserve production code, native rebuild/ASAR unpacking,
preload repair and renderer isolation. Host Node/toolchain changes remain
EXA-68. Native SQLite stays `12.11.1`, builder `26.8.1`, electron-vite `2.3.0`.

Work stays on `fix/exa-66-electron-runtime` in its existing separate worktree,
based on main `3ee28728b4e9522e182d43c025652a5d8f441c8b`. PR #6's branch and
original checkout remain at `27df3e64b958ba104967a4f51bb7655b5c1cae22`.
No combined branch, integration merge, Store packaging or publishing is included.
The exact final follow-up commit and new CI identities are recorded in the
PR/Linear handoff, avoiding a self-referential commit hash here.

## Runtime security disposition and remaining blocker

**Security sign-off remains held.** Updating to 43.8.4 addresses the bundled
Node release gap identified by the review, but the current Chromium source
comparison identifies a separate unpatched Critical fix. Local/CI success
does not waive that gap. There was no demonstrated Bug Pocket exploit.

The [dated source evidence](evidence/exa-66/2026-10-28/official-runtime-security.json)
records primary release/advisory links, source revisions, patch matches and
explicit unresolved cases. It separates Electron, Node and Chromium; a clear
Electron advisory feed or npm audit alone cannot establish bundled coverage.

Electron: rechecked the 70 published repository advisory records against
43.8.4. The 12 findings from the original 43.1.0 audit remain outside their
affected ranges. Preserve the conservative preload threshold (43.5.0 despite
conflicting 43.4.2 repository metadata) and the macOS-only Squirrel.Mac
exception. These are Electron-advisory dispositions, not an all-runtime waiver.

Node: the [24.22.1 security release](https://nodejs.org/en/blog/release/v24.22.1)
and selected Electron DEPS/source pin establish the core update. Its eight
published CVEs are individually recorded below and in the evidence:

| CVE | Area | Current disposition |
| --- | --- | --- |
| CVE-2026-106069 | TLS noncanonical IP validation | Fixed core code in the selected Node 24.22.1 source |
| CVE-2026-106072 | TLS noncanonical IP validation | Fixed core code; advisory rates Medium but release groups it with High; use conservative High for review |
| CVE-2026-105482 | DNS input/null validation | Fixed core code in selected Node source |
| CVE-2026-105483 | TLS IP normalization | Fixed core code in selected Node source |
| CVE-2026-111497 | Brotli decoder | Electron uses Chromium's Brotli; inspected Chromium source contains the upstream fix rather than assuming Node's dependency roll is used |
| CVE-2026-105481 | HTTP agent guard | Fixed core code in selected Node source |
| CVE-2026-106074 | Crypto snapshot random caches | Fixed core code in selected Node source |
| CVE-2026-106073 | Permission-model realpathSync | Fixed core code in selected Node source |

The Node release's upstream OpenSSL roll is not proof that this Electron build
ships OpenSSL 3.5.9: it uses Chromium/BoringSSL integration and reports an
OpenSSL version field of `0.0.0`. Dependency/build-specific evidence and the
Chromium backport review govern those components. Brotli's unchanged `1.2.0`
version field likewise does not establish absence of the checked source fix.

Chromium: the selected `150.0.7871.250` tag plus Electron's active patch set
contains inherited security backports. Their exact mappings are recorded in
the evidence. Newer Chrome bulletin findings are neither automatically waived
by a major-version difference nor automatically called app exploits.
The reviewed 70-entry M150 LTS bulletin has 58 exact backport matches, one
Android exclusion, and 11 unresolved component dispositions. The source
snapshot also records the embedded Undici/c-ares updates and their published
advisory ranges; those dependency checks do not resolve Chromium gaps.

In particular, **Critical CVE-2026-118306** (Chromium bug 571156746) has an
official M150-LTS fix in
[CL 8641638](https://chromium-review.googlesource.com/c/chromium/src/+/8641638),
commit `44420b26c66adbdcd2515afa0aa8c34a6d294113`. The
[selected source](https://chromium.googlesource.com/chromium/src/+/150.0.7871.250/storage/browser/file_system/sandbox_directory_database.cc)
retains the live database iterator while calling `RemoveFileInfo`; its error
path can reset the database. The upstream fix destroys the iterator before
performing removals. The file is unconditionally included by the selected
storage build rules. Inspection of all 240 active Electron Chromium patches
found no equivalent fix targeting this file/function. A second agent verified
the source/fix comparison. Windows cannot be excluded merely by platform.

The dated October 27 desktop-bulletin comparison records 52 findings: this
source-level Critical gap, three demonstrated Android-only Windows exclusions,
and 48 unresolved applicability/backport dispositions. Twenty-four have
explicit M150 Gerrit changes; a missing bug ID alone is not an affected-version
proof. None are excluded solely because the bulletin targets a newer major.
Unresolved cases need vendor/backport or specific non-applicability evidence.

The smallest authorized update therefore remains the latest supported 43.x
patch, with the security gate explicitly open. Release acceptance requires a
supported runtime containing the outstanding fix, or sufficient vendor/source
non-applicability evidence. If that requires a major upgrade or a custom
Chromium/Electron backport, it is a broader compatibility/artifact requirement
to approve separately; neither was implemented here.

## Harness timeout and profile cleanup

The former timeout called `kill()` and immediately rejected, allowing profile
deletion before child shutdown. `runtime-compatibility-driver.cjs` now owns
the process/cleanup sequence; the compatibility command calls this helper.

- A 60-second phase timeout latches its original error and requests SIGKILL.
  The promise awaits `close`, including stdio closure; `kill()` success or an
  `exit` event is not cleanup authorization.
- Termination confirmation is bounded at five seconds. If close is still
  unconfirmed, the child/pipes are detached, the original failure is retained,
  and the profile is left intact with its path in diagnostics. A later close
  does not trigger delayed deletion.
- Once closure is confirmed, cleanup retries only Windows lock/access errors
  (`EBUSY`, `EPERM`, `ENOTEMPTY`, `EACCES`): four total attempts, with bounded
  100/200/300 ms waits. Permanent errors fail immediately.
- Kill/late-child/cleanup errors become diagnostics without replacing the
  original timeout. Exhausted cleanup retains and reports the profile. A
  cleanup failure after otherwise successful checks is still a failure.

`npm run test:runtime-harness` runs 12 deterministic regressions, now included
in `npm test` through its existing CI entry point. Injected timers, child
events and cleanup functions cover delayed close after timeout/exit/pass
marker, unconfirmed termination, kill/late errors, Windows retries/exhaustion,
permanent cleanup failure, synchronous/asynchronous spawn failure, nonzero
exit despite a marker, missing marker and success. There are no wall-clock
timeout races in these regressions. No workflow or host-tool version changed.

## Actual Windows identities and artifacts

| Item | Current measured value |
| --- | --- |
| App / architecture | Bug Pocket 0.9.9 / Windows x64 |
| Host OS | Windows NT 10.0.26300.9711, DisplayVersion 26H2 |
| Host Node / npm | 24.13.1 / 11.8.0 |
| Electron / Chromium | 43.8.4 / 150.0.7871.250 |
| Embedded Node / V8 / ABI | 24.22.1 / 15.0.245.31-electron.0 / 148 |
| Other observed embedded components | c-ares 1.34.9, Brotli 1.2.0, Undici 7.30.1; OpenSSL version field 0.0.0 |
| Electron source commit | `21d45d34fab5df606a08487790f691b4f4911e65` |
| Electron annotated tag object | `26c55b9fb8595e1c6e6cb97835210f2d18fc7c6d` |
| Lockfile SHA-256 | `8aec271e470df0d6f87830acac6be3f0aca40540a2f5748da2da282097a94553` |
| Official/downloaded stock Windows x64 ZIP SHA-256 | `c9974747ee3feeb338be107d431eb7e53d4a3f37a6fd9af85f7ae554cd9385b8` |
| Stock electron.exe SHA-256 | `044280e7ae08d1cbb29df983c5bba08aeb134fd9fe700c617ebecc18bf3849af` |
| Local unpacked Bug Pocket.exe SHA-256 | `a1af637de55c1f00f830f95916f7c55bbbdd71daa9b6d7d4881adefe7119e585` |
| Local app.asar SHA-256 | `2c38048a5d6a367894940bad769376b845e89f606f3c16585d96ec0a45454e6f` |
| Local unpacked better_sqlite3.node SHA-256 | `21b2ea350fb6199a32a9447cf31b2c529f7f7c76ac5f6e6e3cc5de9448c7a34d` |

Both the installed stock runtime and unpacked executable were directly probed
through child-process pipes with `ELECTRON_RUN_AS_NODE=1`; these are measured
embedded versions, not only package metadata. The cached ZIP hash matches the
[official release asset digest](https://api.github.com/repos/electron/electron/releases/tags/v43.8.4).
The stock and packaged executable hashes differ because packaging edits
resources. The manifest identifies local generated bytes, not a CI artifact,
installer or approved release candidate.

EXA-65 coordination now targets `ffmpeg-v43.8.4-win32-x64.zip`, official digest
`d8107c65c8bd49fdd78546c8ad329c8d5feda8f224e27a948c76f3a0d01caf3c`.
The earlier 43.8.3 metadata remains historical. The alternate artifact's
availability/digest was verified; it was not swapped into this build, and no
codec/notices acceptance is implied.

## Fresh validation

All validation commands below exited 0 on Windows. Full raw local logs are in
the sibling `exa-66-evidence/2026-10-28/` directory. Selected logs, versions,
audits, source security evidence and hashes are committed in
[`docs/evidence/exa-66/2026-10-28/`](evidence/exa-66/2026-10-28/).

| Command/check | Actual current result |
| --- | --- |
| Clean `npm ci` | 420 packages installed; native postinstall completed for Electron 43.8.4 x64 |
| `npm run test` | 156 Node/Electron tests passed, 0 failed, 0 reported skips; 21 renderer checks passed |
| `npm run build` | TypeScript, main/preload/renderer bundles and preload repair passed |
| `npm run test:packaged-smoke:build` | Build, Windows x64 unpacked packaging, native ASAR-unpacked binding, SQLite initialization and tray asset smoke passed |
| `npm run test:runtime-compatibility` | Two 43.8.4 processes; real SQLite, safeStorage/SafeStorageAdapter/session/BYOK persistence, built sandboxed preload IPC, PNG/JPEG, desktop thumbnails, tray and shortcut registration/cleanup passed |
| 43.1.0 writer → 43.8.4 reader | Actual old executable wrote a disposable synthetic profile; selected reader decrypted the same session/key without reseeding |
| 43.8.3 writer → 43.8.4 reader | Preserved old stock executable wrote a different disposable synthetic profile; selected reader decrypted the same session/key |
| Lifecycle/startup | Production shutdown helper drained queued DB work, checkpointed/closed DB before quit; login settings read only |
| Harness regression | 12 deterministic tests passed as part of the 156 total |

Old writers and new readers all used ABI 148 and the same current source/built
preload. Original executables were only read; no original or installed user
profile was opened. Runtime screenshots/thumbnails remain in memory.
The native installer again emitted the space-in-path warning but completed;
actual binding loads passed. Existing builder duplicate-dependency and DEP0190
warnings remain recorded separately from validation failures.

The schema-only test command excludes “Supabase keeps developer access read-only
while preserving workspace boundaries.” Node 24 does not report that excluded
entry as a skip; it was not executed. Live Supabase/Docker checks were not run.
The desktop compatibility command remains local evidence; only its deterministic
helper regressions are newly part of the ordinary CI test command.

Current full lockfile audits before/after the 43.8.3 → 43.8.4 change both report
23 package entries (19 High, 4 Moderate, 0 Critical); production-only remains
3 High entries. Both audit commands exit 1. Electron is absent in both full
responses: npm's result alone did not detect the embedded Node security gap.
Production `extract-zip`, `brace-expansion` and inherited `minimatch` findings
remain EXA-67; build/toolchain findings remain EXA-68. No audit fix, dependency
waiver or unrelated upgrade was applied.

## Acceptance boundaries

Unexecuted: combined PR #6/#7 validation; actual application secure-IPC/window
wiring and complete interactive capture/snipping/annotation/save; multi-monitor
and DPI behavior; actual shortcut dispatch/collisions and tray/menu actions;
startup enable/disable, login/reboot; notifications/dialogs; real installed
profile upgrade/recovery and unavailable safeStorage; live providers/cloud;
full application quit during in-flight capture/sync/AI. Component checks use
the actual production modules and a separate hidden window, not full startup.

No NSIS/Store install/update/uninstall, WACK, signing, alternate-codec package
or publishing checks were run. Repeat affected interactive/installed/live
acceptance after the relevant combined/final packaged baseline is chosen.
Green unit/component/unpacked smoke results do not establish those behaviors
or resolve a security disposition. Independent review remains required.
