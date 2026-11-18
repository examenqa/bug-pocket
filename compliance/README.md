# Provisional notice collector

This host-Node groundwork preserves reviewed source inputs. Collection success is **not release compliance approval**. Runtime/FFmpeg, native/Bare provenance, artwork and actual Store artifact acceptance stay pending. The historical strict CLI below remains available; the Store-only packaging adapter is described in the 12 November addendum.

Use Node 24.22.1 and the repository's existing installed dependencies. The collector uses only Node built-ins, reads JSON and bytes, and never imports application or dependency code. No installation, network call, build or runtime execution is part of collection.

From the repository root, set these variables explicitly:

```powershell
& $portableNode scripts/generate-third-party-notices.cjs --root $repositoryRoot --manifest compliance/notices-inputs.json --out $newExternalOutputDirectory
```

Output must be a fresh directory outside the repository; its parent must already exist. Existing output directories are refused rather than overwritten. This task's execution evidence and generated outputs are kept outside OneDrive as well.

The output files are `THIRD_PARTY_NOTICES.provisional.txt` and `third-party-inventory.provisional.json`. Ordering uses relative identifiers and ordinal comparison. Original selected bytes, including line endings, are preserved. No run timestamps or machine paths are generated.

## Reviewed inputs

`notices-inputs.json` pins application and lockfile hashes, 98 physical package identities/metadata hashes, 104 complete notice inputs and 54 distinct copyright excerpts across 1,874 source occurrences. Every occurrence pins its full source hash and exact byte selection. Nested versions keep their physical lockfile paths. The isarray MIT section comes from its reviewed README range; standalone licenses/NOTICE files must remain complete.

Eight separately counted supplements preserve the application's existing MIT assertion, Electron npm wrapper-only text, SQLite source dedication, four conditional libutf/liburl license/NOTICE texts and the simdutf-derived attribution header. The five offline native-source snapshots came from the preserved diagnosis. Their origin identifiers describe source evidence, not verified prebuilt composition. No runtime source URL or ownership statement is supplied.

The 39 known `.bare` payloads are hashed as inert bytes and retained as pending provenance inputs. They are neither loaded nor excluded. Electron's devDependency placement does not exclude the shipped runtime; the wrapper license cannot supply the missing runtime/Chromium/FFmpeg corpus.

The seven pending dispositions are emitted unchanged and cannot be approved by successful collection. The collector requires provisional status and `releaseComplianceApproved: false`.

## Drift and limitations

Collection fails for missing/changed required bytes or package metadata, changed package/lockfile identity, unexpected closure members, new notice-named files, newly discovered copyright headers or native payloads, and escaping/linked input paths. It does not rewrite or automatically refresh the reviewed manifest. Newly discovered text needs an explicit input review, with differences recorded before manifest updates.

Header discovery matches the diagnosis's bounded scan: relevant comment blocks in the first 12,000 bytes of `.js/.cjs/.mjs/.ts/.c/.h/.cpp` files. This supplements exact reviewed ranges; it is not an exhaustive license scanner. README prose, later source text, other formats and generated/bundled code still need final artifact review. Conservative closure includes install helpers and conditionally unused libraries because they may be copied.

The initial reconciliation is exactly 98/104/54. Supplements are separate, not count corrections. Future count differences are reported in the inventory, not silently forced to the historical totals. Package/metadata/input drift normally blocks first and requires review.

Run only the synthetic regressions:

```powershell
& $portableNode --test scripts/generate-third-party-notices.test.cjs
```

Tests use unique external temporary fixtures. `NOTICE_TEST_TMPDIR` can select an external evidence parent. No installed package code is used.

Later work must reconcile real bundle/native/package manifests, exact EXA-66-cleared runtime and alternate FFmpeg source/build/notices, artwork rights, corresponding-source/relinking/Store terms, packaging inclusion and installed notice accessibility. Application UI integration remains deferred. Store-only source preparation below does not settle those pending dispositions.

## 12 November 2026 — bounded Store notice preparation

`collectProductionNotices()` reuses the reviewed inputs in `notices-inputs.json`; no new dependency or licence-auditing framework was added. The historical manifest is unchanged. Its whole-file root package/lock hashes predate the current runtime/source checkpoint. The Store adapter records both reviewed and actual root hashes instead of relabelling that evidence. It still requires the exact reviewed physical production package set, locked/installed versions, metadata hashes and original notice/source hashes. Missing original text for any package, changed versions, new packages or unreviewed notice/header inputs fail explicitly. It never substitutes an SPDX identifier or guessed licence text.

The combined text and inventory associate each original input with its package name, exact version and physical path, including nested versions. Full standalone notice files retain every byte; reviewed README licence sections and copyright excerpts retain their exact selected bytes. Whole-file selections are also returned for packaging under `originals/`. Surrounding source code and README prose are not copied merely because they contain a selected excerpt. Ordering is deterministic and no machine paths or run timestamps are generated.

This mode collects notices only: it does not hash or qualify native binaries. The strict historical `collectNotices()`/CLI behavior is preserved, including its original root/native-byte checks. All seven pending dispositions remain in the Store output. The sole excluded historical supplement is the Electron npm-wrapper licence; it cannot establish the future candidate's runtime notices.

The future Store `afterPack` adapter in `scripts/prepare-store-notices.cjs` requires the actual candidate's nonempty regular `LICENSE.electron.txt` and `LICENSES.chromium.html`. Builder 26.18.1 retains these from the selected Electron distribution, renaming its root `LICENSE`. The adapter copies their original bytes into `resources/notices/electron/` and leaves the candidate originals in place. It has no fallback to an installed Electron directory. It stages the combined provisional text, inventory and complete original production notice files under `resources/notices/`, outside ASAR. Prior output is never overwritten; missing inputs fail before the notice directory is created. A write failure fails packaging; partial output must not be reused as accepted evidence.

Only temporary synthetic fixtures were collected in this task. No production notice output or final candidate notices were generated, and no Electron/native/builder code was imported. The focused Node 24.22.1 run passed **70 tests, 0 failures, 0 skipped**, across the two notice test files. See `docs/store-appx-packaging.txt` for the exact command and remaining artifact-dependent acceptance. Source configuration and collection success establish no patent/licensing clearance.


## 17 November 2026 — SQLite 13 source reconciliation

`notices-inputs-sqlite13.json` is the current versioned production input review. The original `notices-inputs.json`, its 98-package diagnosis and source snapshots remain byte-for-byte unchanged. The new manifest is derived from the exact locked better-sqlite3 13.2.0 / node-addon-api 8.9.2 closure: 67 packages, 70 complete notice inputs, 51 distinct copyright excerpts across 1,861 source occurrences, eight separate supplements and 49 inert native-file identities. The changed counts are recorded against the historical diagnosis rather than forced to match it.

Only better-sqlite3 metadata changes and node-addon-api metadata is added among retained/new production packages. Thirty-two historical physical packages leave production closure. Existing supplied notice texts and SQLite dedication are retained by exact selected-byte hashes; the newly supplied complete Node.js API collaborators MIT license is reviewed in full. Discovery also retains any generated identical SQLite source-header occurrences. No collector checks or discovery exclusions changed.

The Store preparation adapter now selects the versioned manifest. Use the existing collector with `manifestPath: 'compliance/notices-inputs-sqlite13.json'` for this candidate. Production-notices mode still excludes the Electron npm-wrapper supplement (seven collected supplements) and performs no native-byte qualification. The historical strict CLI remains available with an explicit historical manifest; current strict collection requires the reviewed current native bytes.

All seven pending dispositions and `releaseComplianceApproved: false` remain. This is provisional source collection, not final packaged notices, Store FFmpeg or release acceptance. The native file inventory includes bundled cross-platform inputs and the explicitly built local binding; their presence does not claim they were loaded. Runtime binary selection and hash evidence is separate.

Execution and collection evidence: `C:\Users\BugPocketQA\BugPocket-exa66-sqlite13-20261117-cd6d931a`. See the runtime runbook and packaging note for actual stage results and remaining gates.


## 19 November 2026 — generated SQLite source copies

The SQLite 13 manifest names five reviewed occurrences across three generated SQLite source files. Each occurrence points to a required canonical file and matching SHA-256 and byte range. A missing build copy is recorded as absent. A present copy must pass the full-file and selected-text checks and is recorded as verified. The collector still rejects unlisted source notices, invalid inputs and missing canonical sources or licence text.

The clean package and the copied generated layout both produced deterministic provisional outputs with 67 production packages, 70 notice inputs and 51 copyright excerpts. The clean layout verified 1,856 source occurrences. The generated layout verified 1,861. These inventory counts exclude native payload verification. The historical manifests and all seven pending dispositions are preserved. Bundled binding qualification and the Store gates tracked in the packaging notes remain pending.
