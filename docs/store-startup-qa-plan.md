# Store startup bridge QA plan

## Current checkpoint — 17 November 2026

The phase-one 45.2.1 allowance below is consumed. The corrected trial **passed**; reuse `C:\Users\BugPocketQA\BugPocket-native-retry-20261117-9f41e2a8\RESULT.txt`. It used one Electron launch, one addon load, one `activation()` and one `read()`; both calls returned the expected unpackaged `package_identity_unavailable` result. Root and two descendants closed through held handles with exit 0; cleanup followed closure. This establishes loading/delayed imports and the unpackaged identity gate on **45.2.1 only**.

Electron **45.3.3** is prepared in source after bounded qualification; see [packaging addendum](store-appx-packaging.txt). The current candidate-specific instruction authorises review, commit and normal push of exactly the 11-file upgrade, official 45.3.3 win32-x64 ZIP and SHASUMS acquisition/byte verification, and adaptation of the corrected external trial into a fresh QA-owned evidence root. This supersedes the earlier source-only hold only for those actions.

Up to **three supervised Electron launches** may address pre-loading harness failures, with **one addon-loading attempt total**. Record the attempt before `require()`; after that attempt, no further Electron launch is authorised, even if loading or a native call fails. Reuse exclusive file signals, directly held process handles, readiness/ownership checks, the 30-second work and five-second graceful/closure allowances, and cleanup only after confirmed root/descendant closure and output completion. Measure 45.3.3 / Chromium 156.0.8078.100 / Node 24.22.3 / V8 15.6.75.57-electron.0 / ABI 150 / win32 / x64 inside the trial; no preliminary Electron version launch.

The unchanged addon remains the 10 November binary built with **45.2.1 headers/import library**, size 176,640 bytes, SHA-256 `9ee8dcce1ad3752276e0c6c4970f1e579319685b2dbe2a2fd49105e186712c65`. This trial assesses that binary on 45.3.3; its build provenance is not relabeled and no rebuild is authorised. Call only `activation()` once then `read()` once, expecting unpackaged `package_identity_unavailable`, with no BrowserWindow, renderer, BugPocket entrypoint, SQLite, credentials, integrations or startup mutation. Preserve all previous trial sources, evidence, markers and retained resources. No npm/lifecycle, FFmpeg acquisition, application test/build, packaging/sign/install or further product source change is authorised.

The two committed CSP/ANGLE dispositions retain their scope. Historical phase-one prerequisites and authority below describe the earlier trial, not current missing inputs or an unspent allowance. Phase two remains pending and unauthorised, including installed PFN/AUMID/task lookup, opt-in/out, sign-in activation, tray/shortcut readiness and shutdown. Both direct-send paths remain disabled; Slack and all other runtime/release holds remain.

## Historical phase-one plan — authority consumed

Plan dated 12 November 2026; authority reconciled 17 November 2026 · next milestone: one authorised unpackaged native-loading trial, conditional on verified inputs.

Verified starting identity on 17 November 2026: `AMIGO\BugPocketQA` / `C:\Users\BugPocketQA`; worktree `C:\MyApps\BugPocket-exa66-45-2-1`; origin `https://github.com/examenqa/bug-pocket.git`; branch `codex/exa-66-electron-45-2-1`; HEAD `1bddffa245f156e0167cf242b8d7547fe24c71bd`. Preserve unrelated work and both untracked `docs/upstream-clarification-{angle-120931,csp-120930}.md` drafts.

Reuse [runtime runbook](runtime-validation-runbook.txt), [bridge README](../native/store-startup/README.txt) and [packaging notes](store-appx-packaging.txt), especially the completed 10 November build and later Store preparation. No completed validation is rerun; the runtime security audit stays closed. Electron remains pinned to **45.2.1**, both direct-send paths disabled and Slack paused. The 17 November 2026 user instruction authorises official runtime acquisition if needed and preparation, supervision, completion and trial-only cleanup of one phase-one trial after input verification. All other application, build, package, install, startup-setting and release holds remain; phase two is unauthorised.

## Phase 1 — single authorised trial: native loading

**Available.** Completed QA compile/link/static inspection records a Node-API 8 x64 DLL, 176,640 bytes. Loading/delay-load resolution remain untested. Build provenance: `C:\MyApps\BugPocket-tooling\electron-v45.2.1-startup-20261110-c5b8467b\native-build-process-record.txt` (Electron 45.2.1 headers/x64 `node.lib`).

**Inputs / missing prerequisites.**

- Addon: `C:\MyApps\BugPocket-exa66-45-2-1\native\store-startup\build\Release\bug_pocket_store_startup.node`. Before any future load, require SHA-256 `9ee8dcce1ad3752276e0c6c4970f1e579319685b2dbe2a2fd49105e186712c65` and recorded size; refuse changed or linked inputs. Reuse build evidence; do not rebuild.
- Runtime: the official **Electron 45.2.1 win32-x64 `electron.exe`**, with its matching distribution files. **No approved absolute executable path or measured executable hash is established.** Headers, import libraries and host Node do not supply a runtime; no substitute Electron or npm launcher.
- Recorded provenance, not local availability: [electron-v45.2.1-win32-x64.zip](https://github.com/electron/electron/releases/download/v45.2.1/electron-v45.2.1-win32-x64.zip), SHA-256 `7c342aee45d5b4ccafe5dfe9037028796b082735a576e21e2b4e2d8422ebb727`; official `SHASUMS256.txt` SHA-256 `7ffbf4a406ba5df5bd97e8a549ed1042af209456f98cf041c4dfababdc2f9abb`. Use runbook §1–2 provenance/tag/commit checks: record approved executable path/hash, rehash ZIP/checksum files, verify the checksum entry and executable bytes against the ZIP entry. JSON assertions alone are insufficient; missing/unsupported verification stops execution. Official runtime acquisition if necessary is authorised by the 17 November instruction; all provenance and byte checks remain prerequisites.
- Still needed: verified QA session, approved runtime/input record, fresh QA-owned execution/evidence root and reviewed harness/supervisor source plus hashes. No harness is created by this plan.

**Authorised procedure, conditional on verified inputs.**

1. Verify actual account `AMIGO\BugPocketQA`, both OS profile/`USERPROFILE` as `C:\Users\BugPocketQA`, x64 Windows/build and the worktree identity above. Use a new owned root outside Git, OneDrive and system Temp; refuse existing/linked destinations. Redirect synthetic `userData`, `sessionData`, TEMP/TMP and logs there; preserve HOME/USERPROFILE. Allowlist the environment, excluding inherited Node loaders/options, runtime overrides and `ELECTRON_RUN_AS_NODE`.
2. One standalone CommonJS Electron **main entry**, directly launched by the verified executable under a supervisor: set temporary paths before readiness; import only Electron/built-ins and the absolute addon. No BugPocket entrypoint, SQLite, services, renderer code or `BrowserWindow`. After readiness, verify/record `process.execPath`, PID and runtime tuple against runbook §2 before loading.
3. Load once; inspect own property names/descriptors (exports are non-enumerable), expecting functions `read`, `enable`, `disable`, `activation`. Call only `activation()` then `read()`, once each, sequentially, without arguments. **No `enable()`/`disable()`**, login-item setters or registry fallback; no real accounts/credentials, `.env` inputs or integration/network requests.
4. Expected unpackaged responses: both identify `BugPocketStartup`, with `identityVerified:false` and `errorCode:'package_identity_unavailable'`; activation stays `activationKnown:false` / `startupActivation:false`; read stays `state:'error'` / `enabled:null`. The reviewed identity gate precedes task/activation APIs. Unknown is not disabled. This checks loading, delayed imports and identity rejection, not real Store task lookup, activation or operation.
5. Parent bound: 30 seconds for launch/loading/calls, then ≤5 seconds graceful quit and ≤5 seconds owned-process termination/closure confirmation. Await native completion before normal quit; a JS timeout cannot cancel running native work or safely unload it. Timeout/forced termination fails. Record command, hashes, versions, output/results, exit code and ownership/closure evidence. Require held-handle `WaitForExit`, closed output streams and closure of owned children; markers/PID disappearance/kill success are insufficient. Terminate only verified owned processes, never by name.
6. After confirmed closure, verify absolute ownership and delete only trial-created profiles/scratch/harness copies. Keep evidence and pre-existing inputs/build outputs; retain resources on uncertain closure/cleanup failure. Synthetic profiles and the QA account reduce accidental data contact; main/native code retains QA-user OS/network permissions. This is neither a security sandbox nor enforced network isolation.

**Authority received.** The 17 November instruction permits exactly one trial and its preparation, supervision/owned-process termination, evidence and trial-only cleanup. Verified inputs and QA environment remain prerequisites. Failure does not authorise a retry or expanded execution.

**Result.** Pass: verified inputs/tuple, expected exports/rejection, no windows/startup mutation, normal exit and confirmed closure/cleanup. Failure: mismatch, unexpected identity, crash, mutation, timeout or forced termination. Incomplete: missing approval/input/environment or unconfirmed closure/cleanup; preserve evidence and any observed failure. Passing establishes only this narrow loading result.

## Phase 2 — later installed acceptance

**Available / missing.** Store configuration/integration/artwork and the addon are prepared. Trusted signed candidate, emitted/installed identity and authorised installed QA environment/results remain missing.

**Prerequisites and essential checks only.**

- Verify signing/trust, installed package/executable/addon and actual PFN `ExamenQA.BugPocket_tgn4dm49y0b56`, application `BugPocket`, AUMID `ExamenQA.BugPocket_tgn4dm49y0b56!BugPocket`. A configured/taskbar ID is insufficient.
- Resolve exactly `BugPocketStartup`; verify manifest `Enabled=false` and initially disabled actual state on a fresh eligible installation.
- First manual run offers opt-in without automatic change; verify No thanks, explicit opt-in and later opt-out with actual-state read-back, respecting Windows user/policy settings without a registry fallback.
- Real sign-in launches quietly with no capture/main window; tray becomes ready and the configured global shortcut opens capture.
- Manual launch opens normally; secondary manual launch focuses the existing instance; secondary startup activation preserves visibility.
- Clean shutdown drains queued/running native work without crash, hang or surviving owned processes.
- **Windows 10 compatibility remains unvalidated until actually tested.** Provisional build-19045 declarations and Windows 11 results do not establish it.

**Authority needed.** Separate candidate build/package/sign/trust/install and application-runtime authority, plus explicit disposable-QA startup-setting and sign-out/sign-in authority. None is included in phase 1.

**Result.** Pass: recorded success for every check on the declared OS scope. Failure: incorrect identity/task, consent/policy, launch/shortcut/instance or shutdown behavior. Missing prerequisites or unrun checks/OS cases are incomplete.

## Execution authority — phase 1 only, 17 November 2026

The user authorises harness/supervisor preparation/review and **one bounded unpackaged native-loading trial under verified `AMIGO\BugPocketQA` / `C:\Users\BugPocketQA`**, conditional on verified official Electron 45.2.1 x64 path/provenance/hash/distribution, the recorded addon hash and an owned synthetic root. This includes official runtime acquisition if absent, loading/export inspection, `activation()` and `read()` once each, evidence, closure verification and trial-only cleanup/owned-process termination within the stated bound.

This excludes phase two, other acquisitions/downloads, dependency changes/rebuilds, full application execution, test suites, builds/packages/signing/trust/installation, startup-setting changes, integrations, publication and release. **Publication and every other application/runtime/package/install/release hold remain in force.** The same instruction separately authorises the three-document checkpoint commit and normal push to the existing branch; no hook/workflow bypass, force-push, PR, merge, tag, external message or Linear change is authorised. Electron stays 45.2.1, both direct-send paths stay disabled and Slack stays paused.
