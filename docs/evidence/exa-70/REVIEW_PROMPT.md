# External GPT-6 High review — EXA-70

Review the final draft PR head against main
`2ef9a0fe89b8bc5f06a30a0ead931e842815792b`. Use the PR's current exact head
and passing Windows CI, plus `docs/vite-toolchain.md` and this evidence folder.

Assess whether Vite 6.4.5, electron-vite 6.0.0, plugin-react 5.2.0 and locked
esbuild 0.25.12 are the smallest justified maintained compatible migration.
Independently verify all nine GHSA dispositions against the actual bundled Vite
editor code, Windows path/CORS controls and official patched ranges. Check exact
Electron/Node/Actions/builder/React/native/archive/brace preservation and lock scope.

Trace config, generated main/preload and the retained copy workaround through
dev, npm start and normal packaged execution. Assess the real accepted IPC,
isolated userData, sandbox/CSP/navigation, React Fast Refresh and security checks,
including test doubles and exclusions. Examine the dev-only debugger sandbox
diagnostic and unchanged meta-CSP warning without assuming their cause or clearing
EXA-66. Look for harness false positives, unsafe cleanup, unsupported claims or
remaining PR-specific blockers. Distinguish implementation acceptance from the
unexecuted Supabase boundary, live/installed/Store gates and the separate runtime
hold. Return actionable findings with severity and file/line evidence, or an
explicit no-PR-specific-blocker conclusion. Do not grant exceptions or merge approval.
