# Provisional notice collector

This host-Node groundwork preserves reviewed source inputs. Collection success is **not release compliance approval**. Runtime/FFmpeg, native/Bare provenance, artwork and actual Store artifact acceptance stay pending. Packaging configuration and hooks do not invoke this collector.

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

Later work must reconcile real bundle/native/package manifests, exact EXA-66-cleared runtime and alternate FFmpeg source/build/notices, artwork rights, corresponding-source/relinking/Store terms, packaging inclusion and installed notice accessibility. All proposed FFmpeg/runtime hooks and application UI integration remain deferred.

