# EXA-68 documentation review follow-up

28 October 2026. Reviewed code head:
`23850ea792ea767de8ea0f17ac9175c64aef7209`, base
`569fbeea537c8669df0be12578b239c4f9c0968a`.

The latest [EXA-68 review record](https://linear.app/examen-qa/issue/EXA-68/align-windows-ci-node-support-and-remediate-build-tool-advisories)
(comment `2e0d6e4e-6bce-4cd2-b2e6-0a109b5f2638`) records the independent GPT-6 High
verdict: no PR-specific code blocker. Its accepted P3 evidence correction is
implemented here. Maintainer merge approval has not been given.

## Corrected advisory disposition

The captured http-cache-semantics update 4.2.0 -> 4.3.0 leaves
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)'s
published affected range, `<=4.2.0`, and the dated after audit omits the record.
The official advisory lists no patched version; the
[upstream owner disputes the report](https://github.com/kornelski/http-cache-semantics/issues/56#issuecomment-5975759591).
This is **audit-range removal with an upstream-disputed report**. It is separate
from a verified code-level security fix, and no Bug Pocket exploit is demonstrated.
The previous patch-information-lag inference is removed.

The external review reports the same max-stale behavior in both versions. This
follow-up attributes that observation to the reviewer; it did not rerun the
reproduction. The prior downstream shared-cache exploit scenario remains
unestablished. No exception is granted and the advisory is not declared rejected.

## Recomputed evidence

| Disposition | Distinct GHSA records |
| --- | ---: |
| Fixed | 44 |
| Audit-range removal; upstream-disputed report | 1 |
| Pending EXA-66 Electron scope | 12 |
| Pending EXA-70 Vite scope | 9 |
| Total | 66 |

The 77 npm-source/range variants remain. Dated audit counts remain 21 -> 4
affected package entries, production-only 0 -> 0; these are not exploit counts.
All 89 captured lock-record deltas remain: the compatible-advisory reason group
now contains 10 records, with 1 separate audit-range-removal record. This changes
the explanation of the existing lock delta; the lockfile is unchanged.

Existing [EXA-70](https://linear.app/examen-qa/issue/EXA-70/migrate-vite-toolchain-and-remediate-residual-development-server)
separately tracks unresolved Vite/electron-vite/esbuild/bundled-editor middleware
and development/start/packaged-preload validation. It remains Todo. This follow-up
starts no migration and creates no duplicate issue. EXA-66's Chromium hold remains.

## Validation and decision boundary

Validate JSON parsing, direct recounts of dispositions and lock reason groups,
all normalized-LF manifest checksums, unchanged raw audit/test evidence,
Markdown/references and `git diff --check`. No local application tests, build,
installation or packaging are rerun for this documentation-only delta. The prior
[327 Node/Electron and 21 renderer CI passes](https://github.com/examenqa/bug-pocket/actions/runs/40629633128)
and [validation.json](validation.json) remain dated code-validation evidence;
the PR checks and execution checkpoint record the documentation head's CI result.

This entry supersedes the former 45-fixed summary and historical review-pending
wording without rewriting raw snapshots or test logs. PR #9 stays draft and
EXA-68 In Progress for the maintainer merge decision. Filtered Supabase boundary,
installed NSIS/Store/live acceptance and release gates remain separate and
unexecuted. No merge, synchronization, deletion, packaging or publishing occurs.
