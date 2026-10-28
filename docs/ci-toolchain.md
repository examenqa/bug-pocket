# Windows CI and toolchain (EXA-68)

**28 October 2026 follow-up:** [EXA-70's Vite migration](vite-toolchain.md)
records the subsequent Vite/electron-vite/React-plugin selection, bundled editor
repairs and Windows development/start/packaged verification. The EXA-68 narrative
and snapshots below remain historical; their residual Vite records and Todo
status describe that earlier checkpoint. Its disputed HTTP-cache record retains
the audit-range-only classification, and EXA-66's runtime hold remains separate.

Baseline: main `569fbeea537c8669df0be12578b239c4f9c0968a`, inspected 28 October 2026.
Resolve actual dependencies from the lockfile. The audit snapshots in
[`evidence/exa-68`](evidence/exa-68) are dated evidence, not permanent safety claims.

## Supported host and Actions

`.node-version` pins **24.22.1**; `engines.node` accepts compatible Node 24 patches
from that version. Both Windows CI and local verification use the pin. The
[official release](https://nodejs.org/en/blog/release/v24.22.1) identifies it as a
security release; the [official schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)
supports Node 24 through 30 April 2028. Installed host 24.13.1 was evaluated and
replaced for verification because it predates those security fixes. The verified
Windows x64 ZIP SHA-256 is
`d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5`
([official checksums](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt)).

The host bundles npm 11.19.1. Electron remains locked at **43.1.0** with its own
embedded Node; this remediation cannot clear EXA-66's Electron/Chromium hold.
All resolved host engine ranges satisfy 24.22.1 (see `engines.json`).

CI pins [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
and [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)
by their full release commit SHAs. Both use Node 24 internally and require
[runner 2.327.1+](https://github.com/actions/checkout/tree/v7.0.1).
The Windows hosted runner meets this requirement. Permissions remain
`contents: read`; push/PR targets remain main/dev; npm caching, the 45-minute
timeout, test/build/smoke steps and native-install behavior are preserved.

The baseline [main CI run](https://github.com/examenqa/bug-pocket/actions/runs/40626934135)
passed on Node 20.20.2 despite five engine mismatches and a warning that the v4
Actions targeted deprecated Node 20 and were forced onto Node 24. Passing tests
did not establish supported host compatibility. Final PR checks and the execution
checkpoint record the new exact-head CI result.

## Compatible dependency changes

Pin maintained stable [electron-builder 26.18.1](https://github.com/electron-userland/electron-builder/releases/tag/electron-builder%4026.18.1),
evaluating it instead of historical 26.18.0. Its companion packages include
builder-util-runtime 9.7.1 and @electron/rebuild 4.2.1. The builder update fixes
the credential-redirect advisory and the Linux AppImage search-path advisory
(the latter route is not used by Windows NSIS/dir targets).

Targeted updates within parent semver ranges repair XML/YAML, tar, undici,
browserslist and CSS processing paths. The HTTP-cache change has the separate
audit-range disposition below. No new override is introduced.
The approved minimatch 3/5/9/10 brace resolutions and their compatibility tests,
yauzl 3.4.0 archive remediation, Electron, Vite 5.4.21 and electron-vite 2.3.0
remain. `lock-changes.json` records every changed package record and rationale;
`advisory-dispositions.json` records every baseline advisory, resolved dependency
chains, audit-range observations, patched versions or residual scope and primary
advisory links.

Fresh full audit: **21 entries (17 high, 4 moderate) -> 4 (2 high, 2 moderate)**.
Production-only: **0 -> 0**. Entries include propagated package findings; these
totals are not counts of distinct exploitable vulnerabilities. Production-only
omits the separately shipped Electron runtime.

The 66 distinct GHSA records are **44 fixed, 1 audit-range removal with an
upstream-disputed report, 12 pending EXA-66 and 9 pending EXA-70**.
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
falls outside the captured audit range after http-cache-semantics 4.2.0 -> 4.3.0,
but the official advisory lists no patched version and the
[upstream owner disputes the report](https://github.com/kornelski/http-cache-semantics/issues/56#issuecomment-5975759591).
This records audit-range removal without claiming a verified code-level security
fix or a demonstrated Bug Pocket exploit. The dated raw audit snapshots remain
unchanged. See [the review follow-up](evidence/exa-68/REVIEW_FOLLOWUP.md).

Remaining findings are explicit unresolved work, with no exception granted:

- `bug-pocket -> electron@43.1.0`: EXA-66 runtime/Chromium remediation and its
  independent review remain separate.
- Direct `vite@5.4.21` and `electron-vite@2.3.0 -> vite@5.4.21`, plus both paths
  to `esbuild@0.21.5`: patched versions require a coordinated major migration.
  Vite bundles the vulnerable editor middleware; overriding a separate
  launch-editor dependency cannot replace that code. Windows developer editor
  command/NTLM findings remain relevant, including malicious-site requests to
  loopback middleware. Other findings require exposed development servers,
  custom middleware or non-Windows paths, as recorded per advisory. Build and
  packaged production execution do not start those development servers.

The separate unresolved migration is tracked in existing
[EXA-70](https://linear.app/examen-qa/issue/EXA-70/migrate-vite-toolchain-and-remediate-residual-development-server),
which remains Todo. It must verify development, start and packaged preload paths,
patched editor middleware and esbuild. Do not force incompatible esbuild versions
into the existing toolchain or treat the default loopback bind as an exception.

## Native and preload verification

Retain `postinstall: electron-builder install-app-deps`, `npmRebuild`,
`npm_config_build_from_source=false`, both native ASAR-unpack patterns, icons,
afterPack resource editing, extra assets and every NSIS option. The existing
`scripts/fix-preload.js` copy remains part of build/start/dist.

The unpacked smoke uses disposable userData and requires SQLite initialization,
the unpacked native binding, tray/icon startup and a hidden sandboxed window
loading the packaged preload bridge. The window retains context isolation,
disabled Node integration, web security and navigation/new-window guards. The
probe checks exposed bridge methods and absence of renderer `require`/`process`.
It does not invoke cloud services or open production userData.

Local Windows x64 10.0.26300 verification passed clean `npm ci`, focused brace,
native SQLite and window security checks, **327 Node/Electron tests plus 21
renderer checks**, `npm run build` and `npm run test:packaged-smoke:build`.
The native probe identifies embedded Node **24.18.0 / ABI 148**, Electron 43.1.0
and better-sqlite3's SQLite 3.53.2. The packaged `.js` and workaround `.mjs`
preloads have identical SHA-256 bytes. `validation.json` retains the initial
three-window structural-test failure, its correction and final passing checks.

The existing `schema-install` filter still leaves the Supabase boundary test
unexecuted even when Node 24 reports zero skips. Live Supabase/provider, interactive
normal use, installed NSIS, migration, Store package/installation and WACK acceptance
are separate, unexecuted gates. No installer or Store artifact is created here.

## Warning dispositions and review gates

No warnings are suppressed. npm 11 warns about `npm_config_build_from_source`
because it is a native installer's environment option rather than npm's own
config; installed prebuild-install reads it, and builder logs confirm
`buildFromSource=false`. Retain it for the required native-install semantics.
npm also reports legacy transitive deprecations and install scripts not yet in
an allowScripts policy; scripts execute, including native rebuild. No blanket
allowScripts approval was added. The local path-with-spaces diagnostic is emitted
by @electron/rebuild's source fallback (its throw is disabled upstream); successful
native loading and unpacked smoke establish the actual result. These notices
are recorded for review and are not security exceptions.
Builder also reports deduplicated dependency references and explains that its
executable editing is disabled by the preserved `signAndEditExecutable: false`;
the existing afterPack icon hook remains responsible for icon editing. These
diagnostics do not establish NSIS installed acceptance.

Implementation, local verification, passing PR CI, external final review,
maintainer approval and release acceptance are distinct. The independent GPT-6
High review of head `23850ea792ea767de8ea0f17ac9175c64aef7209` found no PR-specific
code blocker and requested this documentation correction. No further full review
or local application retest is required solely for this documentation delta.
PR #9 remains draft and EXA-68 In Progress pending the maintainer merge decision.
EXA-46/61 must reassess
the now-updated v26 packaging candidate through installed feasibility; no Store
format choice or release approval is inferred from unpacked validation.
