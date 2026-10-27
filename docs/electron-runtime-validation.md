# Electron runtime validation — EXA-66

> Historical 43.8.3 evidence from commit `e92e69b060eb868a95d85159863a07a32fba2060`.
> Results and version-dependent metadata below describe that earlier snapshot.
> The [28 October review follow-up](electron-runtime-review-followup.md) records
> the current 43.8.4 selection, bundled Node/Chromium security disposition,
> timeout fix and revalidation. This earlier Electron advisory scan alone did
> not establish bundled Node security coverage.

Reviewed on 27 October 2026. This is evidence for independent review of the
runtime update, not release or installed-package acceptance.

## Change and preservation

Pin Electron from locked `43.1.0` (`^43.1.0`) to exactly `43.8.3`. No other
dependency resolution changes. Keep native postinstall/rebuild, ASAR unpacking,
preload repair, renderer isolation and production application code unchanged.
Add a reproducible Windows component compatibility harness.

Base: `3ee28728b4e9522e182d43c025652a5d8f441c8b` on `main`.
Separate branch: `fix/exa-66-electron-runtime`, separate `exa-66-runtime`
worktree. The original clean `implementation` checkout and draft
[PR #6](https://github.com/examenqa/bug-pocket/pull/6) remain on
`fix/exa-64-secure-ai-transport` at
`27df3e64b958ba104967a4f51bb7655b5c1cae22`. No integration merge, installer,
Store packaging, publishing, or changes to that branch are part of this work.
The final source commit and CI run are recorded in this PR and Linear EXA-66;
this document deliberately does not contain its own commit hash.

Inputs read: repository AGENTS.md, complete EXA-66 (no comments), EXA-45 and its
complete final audit document, and related EXA-65 requirements. Linear's shared
agent-context endpoint returned `Tool get_agent_context not found`; the issue,
audit and repository sources were available. The graph returned misaligned
source for some symbols, so current local files governed those checks.

## Selection and compatibility

The [official 43.x release list](https://releases.electronjs.org/release?channel=stable&major=v43)
identifies `43.8.3` as the latest stable same-major patch. Electron supports
[three stable major lines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines);
the [current schedule](https://releases.electronjs.org/schedule) lists 43/44/45,
with tentative 43 EOL on 5 January 2027. This justifies a patch update without a
major migration. Recheck support and advisories before a later release.

[43.8.3 release notes](https://releases.electronjs.org/release/v43.8.3) also
include upstream security backports after the known certificate fix in 43.8.1.
The [breaking-changes guide](https://www.electronjs.org/docs/latest/breaking-changes)
documents 43.7.0 security changes involving subframe workers, extension preloads
and legacy WebContents-ID getUserMedia capture. This app's screenshot path uses
`desktopCapturer.getSources` screen thumbnails and `nativeImage`, exercised here.

Both [43.1.0](https://github.com/electron/electron/blob/v43.1.0/npm/package.json)
and [43.8.3](https://github.com/electron/electron/blob/v43.8.3/npm/package.json)
declare host Node `>=22.12.0`. The existing CI Node 20 setting is a preexisting
compatibility/support issue, owned by EXA-68. Local validation uses Node 24;
this change does not update CI or other tools. Native modules still need the
[Electron rebuild](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules).
The tested runtime ABI is `148`; actual better-sqlite3 loading passed in both
runtime component and packaged checks.

## Exact identity

| Item | Tested value |
| --- | --- |
| Application / architecture | Bug Pocket 0.9.9 / Windows x64 |
| Host OS | Windows NT 10.0.26300, UBR 9711; registry DisplayVersion 26H2 |
| Host tools | Node 24.13.1; npm 11.8.0 |
| Electron | 43.8.3 |
| Embedded Chromium | 150.0.7871.250 |
| Embedded Node | 24.22.0 |
| Embedded V8 / module ABI | 15.0.245.31-electron.0 / 148 |
| Native SQLite / builder / electron-vite | 12.11.1 / 26.8.1 / 2.3.0 |
| Electron source commit | `1c0ee213f150fc4a0d06304dcedabd9b2e8ce0f7` |
| Electron annotated tag object | `b10b48a42d0c376a9f871514527803fa9077d0d8` |
| Lockfile SHA-256 | `ce60ace46d6d357492ec913c9913111f6f3abf31d16407851cff701ae89466b4` |
| Official Windows x64 ZIP SHA-256 | `98efbd2d1c7bd44150c0aa800cd9ac5fefcefd2d44fd94958a95d6744d86c6de` |
| Installed stock electron.exe SHA-256 | `6fd8d202acc5c4064eacdcbfc319d12e72a5a0b5bb35122940995b09e54bc481` |
| Tested better_sqlite3.node SHA-256 | `b094e3eef5670412dcc84bb95db8952683236754490718da0697f0053b2ce985` |

The downloaded cached ZIP hash was independently compared to the
[official release asset digest](https://api.github.com/repos/electron/electron/releases/tags/v43.8.3).
Builder downloads this exact version for unpacked packaging. Packaged executable
resource editing changes its bytes; generated-artifact hashes are retained in
the evidence manifest. The native binding in ASAR-unpacked matches the tested
local binding. npm tarball provenance/integrity is recorded in package-lock.json.

EXA-65 must use the matching `ffmpeg-v43.8.3-win32-x64.zip`; its official SHA-256
is `5879bbe130206e855a7e6c53c4180116d32acb2c0c358b3503957df9c92bb28f`.
It is available, but alternate FFmpeg, codec verification and notices are
separate work. This branch tests the default Electron distribution.

## Shipped Electron advisory disposition

Electron is a devDependency but ships as the executable. A production-only npm
audit cannot establish its security. The official repository advisory feed was
reviewed in addition to fresh npm audits. The evidence snapshot records all
reviewed ranges; the 12 findings reported for the old runtime are below.
Every row is fixed by the selected `43.8.3`; app-feature exclusions are not used
to waive these fixes.

| Advisory | Severity | 43.x fixed from |
| --- | --- | --- |
| [GHSA-jr5w-w6x2-84p9](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9) certificate trust | High | 43.8.1 |
| [GHSA-qmv3-fv6v-rmhq](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq) preload cache | High | 43.5.0, conservatively; see below |
| [GHSA-j84w-jfhq-vhvj](https://github.com/electron/electron/security/advisories/GHSA-j84w-jfhq-vhvj) protocol cross-origin | High | 43.4.1 |
| [GHSA-gr2m-v5gq-v685](https://github.com/electron/electron/security/advisories/GHSA-gr2m-v5gq-v685) inherited sandbox | High | 43.4.1 |
| [GHSA-9qh4-3jw8-366w](https://github.com/electron/electron/security/advisories/GHSA-9qh4-3jw8-366w) webview workers | High | 43.4.1 |
| [GHSA-fw47-9c62-h3vw](https://github.com/electron/electron/security/advisories/GHSA-fw47-9c62-h3vw) HID/USB origin | Moderate | 43.7.0 |
| [GHSA-2p8c-gr87-2676](https://github.com/electron/electron/security/advisories/GHSA-2p8c-gr87-2676) SameSite links | Moderate | 43.7.0 |
| [GHSA-x562-297c-g43g](https://github.com/electron/electron/security/advisories/GHSA-x562-297c-g43g) pointer lock | Moderate | 43.7.6 |
| [GHSA-997q-gvvc-jwmx](https://github.com/electron/electron/security/advisories/GHSA-997q-gvvc-jwmx) external URL origin | Moderate | 43.7.0 |
| [GHSA-98mx-cjp9-gchm](https://github.com/electron/electron/security/advisories/GHSA-98mx-cjp9-gchm) extension tab information | Low | 43.5.1 |
| [GHSA-3qxv-5xgr-q7w9](https://github.com/electron/electron/security/advisories/GHSA-3qxv-5xgr-q7w9) frame geometry | Low | 43.7.3 |
| [GHSA-h3v5-h239-pg29](https://github.com/electron/electron/security/advisories/GHSA-h3v5-h239-pg29) macOS offscreen geometry | Low | 43.7.3 |

The preload repository advisory says 43.4.2 while the updated
[GitHub Advisory Database](https://github.com/advisories/GHSA-qmv3-fv6v-rmhq)
says 43.5.0. Use the stricter threshold. Certificate mitigation has no app-side
workaround and covers Chromium and Node networking.

The official metadata for
[GHSA-vv43-5jgx-7qv8](https://github.com/electron/electron/security/advisories/GHSA-vv43-5jgx-7qv8)
has an unbounded `>=40.0.0-alpha.1` range. Its impact is expressly limited to
macOS apps using Squirrel.Mac updates. Disposition: not applicable to the tested
Windows x64 artifact; do not reuse that disposition for a macOS release.
[GHSA-22mq-c535-7vv9](https://github.com/electron/electron/security/advisories/GHSA-22mq-c535-7vv9)
is limited to Electron 35/36; the app's CommonJS/ASAR usage does not make 43.8.3
affected. The official snapshot also distinguishes the upstream Actions workflow
advisory from shipped runtime exposure. No unresolved applicable High/Critical
Electron advisory was found in this dated review. This is not a claim about
future disclosures or all remaining application dependencies.

## Windows validation and limits

All commands below completed with exit 0, except the intentionally failing
security audits recorded separately. Full raw local command logs are retained
in the sibling `exa-66-evidence` directory; selected audit snapshots, identities
and runtime logs are committed under `docs/evidence/exa-66/`.

| Check | Result / coverage |
| --- | --- |
| Clean `npm ci` | New worktree without node_modules; postinstall rebuilt native dependencies for Electron 43.8.3 x64; 420 packages installed |
| `npm run test` | 144 Node/Electron tests passed, 0 failed, 0 skipped; 21 renderer checks passed |
| `npm run build` | TypeScript, main/preload/renderer bundles and preload path repair passed |
| `npm run test:packaged-smoke:build` | Unpacked Windows x64 packaging and production startup smoke passed; native binding outside ASAR, SQLite creation and tray asset loading |
| `npm run test:runtime-compatibility` | Two 43.8.3 launches using an isolated synthetic profile; actual database, SafeStorageAdapter and BYOK key encryption/decryption persisted across processes |
| Old-runtime writer / new-runtime reader | 43.1.0 wrote, 43.8.3 decrypted same synthetic session and BYOK key; both ABI 148; same current source and built preload |
| Native/runtime components | Built sandboxed preload bridge/IPC, context isolation/Node disabled, nativeImage PNG/JPEG, in-memory desktop thumbnails, tray create/destroy, disposable shortcut register/unregister |
| Lifecycle | Actual production shutdown helper drains a queued DB write, checkpoints/closes SQLite before quit; full tests cover renderer draft and operation barriers |
| Startup | Only `getLoginItemSettings()` read checked; no user login settings altered |

The initial sandboxed build could not spawn esbuild (`EPERM`); the permitted
unsandboxed rerun passed. Clean installation emitted a space-in-path native
build warning but completed with exit 0; actual native loading then passed.
Builder emitted existing duplicate-dependency/DEP0190 warnings. No toolchain
upgrade was needed for this runtime patch.

Reproduce the component and upgrade checks after building:

```powershell
npm run test:runtime-compatibility
$env:BUG_POCKET_COMPAT_WRITE_EXE = '<path-to-preserved-43.1.0-electron.exe>'
npm run test:runtime-compatibility
Remove-Item Env:BUG_POCKET_COMPAT_WRITE_EXE
```

The harness uses current source modules and a hidden sandboxed window with the
built preload. It does not run the actual app's window/secure-IPC registration
or full production startup. Captured thumbnails stay in memory. Tests use
synthetic credentials and disposable data; the installed running application
and user profile were not touched.

Unexecuted acceptance: full interactive capture/snipping/annotation/save,
multi-monitor/DPI behavior, actual shortcut invocation/collisions and tray/menu
actions, startup enable/disable and login/reboot behavior, notifications and
file dialogs, real profile upgrade/recovery or unavailable safeStorage, real
provider/cloud sessions, and full quit during in-flight capture/sync/AI. Live
Supabase/Docker checks are outside `npm test` and were not run. No NSIS install,
Store install/update/uninstall, signing, WACK or alternate-codec checks were
performed. Repeat installed-package checks in EXA-47/54 after final packaging.
Passing component or unpacked smoke does not prove these behaviors.
The schema-repeatability command also filters out the developer-access/RLS
test; a local reported skip count of zero does not mean that test ran.

## Fresh dependency audits

Commands: `npm audit --package-lock-only --ignore-scripts --json` and the same
with `--omit=dev`, before and after. Both audits exit 1 because other findings
remain. Counts represent package entries, not independent exploits.

| Snapshot | High | Moderate | Critical | Total |
| --- | --- | --- | --- | --- |
| Before, full lockfile | 20 | 4 | 0 | 24 |
| After, full lockfile | 19 | 4 | 0 | 23 |
| Before and after, production only | 3 | 0 | 0 | 3 |

Electron disappears from the full audit after the pin. The production entries
are `extract-zip`, `brace-expansion`, and transitive `minimatch`; EXA-67 owns
their remediation and applicability work. Remaining builder/development tree
findings belong to EXA-68. No blanket exception or release waiver is granted
here. The earlier EXA-45 audit's 23 full / 2 production counts were not reproduced
by these fresh snapshots; this report records the current responses. No audit
fix command or unrelated dependency upgrade was used.

CI outcomes, exact head/merge-ref identities, skips and any toolchain warnings
are recorded in the PR/Linear review handoff after the Windows run completes.
