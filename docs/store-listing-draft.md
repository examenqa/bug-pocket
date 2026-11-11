# DRAFT — Microsoft Store listing and reviewer notes (EXA-53 / EXA-51)

11 November 2026 · Asia/Calcutta · **For Vali's review; not entered in Partner Center, published or compliance clearance.**

Source baseline: `examenqa/bug-pocket` / `codex/exa-66-electron-45-2-1` / `30180af4754526a3c5a72412beaf881659a8133f`. Customer copy below describes the intended first Store release and must match the accepted final candidate before use. Source references and pending items are editorial, not storefront copy.

## Confirmed owner launch choices — 11 November 2026

| Item | Confirmed owner choice |
| --- | --- |
| Application price | Free to use |
| Source and licence | Open source under the existing MIT licence; retain licensing files unchanged |
| Launch markets | All markets available for this product |
| Language | English for the app, website and Store listing |
| Primary category | Developer tools |
| Subcategory | Utilities |

Source code: [examenqa/bug-pocket](https://github.com/examenqa/bug-pocket). Licence: [existing MIT licence](../LICENSE). Optional AI/cloud-provider accounts and usage may incur separate charges; these are not the application's price. [R8]

These are confirmed owner choices, not a record of settings entered or verified in Partner Center. Partner Center entry and verification remain pending. Final wording, operational/manual acceptance and release gates remain pending; these decisions do not authorize publication.

## Scope to preserve

First public Store launch, native x64 first, with Windows 10 included in the intended audience and older/current Windows 11 in the validation matrix. Windows 10 22H2/build 19045 is the first trial target. The separate AppX config declares provisional `10.0.19045.0` minimum/tested values; these are not measured compatibility or a proven lowest supported Windows build. ARM64/emulation support is not accepted for this initial scope. [R1, R2]

Preserve capture/annotation, report formatting/exports, backup/restore, optional BYOK/native Ollama and configured BYOC Supabase. In-app startup opt-in and quiet sign-in/tray/shortcut readiness remain first-release requirements, with source prepared and installed acceptance pending. Future public distribution is intended to be Store-only. Current first-public-launch direction supersedes older legacy-NSIS-import prerequisites; preserve existing data without adding legacy migration work to this submission. Fresh persistence and future Store-update preservation still require validation. [R1, R2]

The accepted version plan is app **1.1.0 → Store 1.1.0.0** using the provisional electron-builder 26.18.1 AppX/x64 route. Root source remains 0.9.9 and Electron remains pinned to **45.2.1**. No emitted/allocated/uploaded candidate is established by these plans; recheck the ledger when assigning the actual version. [R1, R2]

## Proposed customer-facing text — pending candidate acceptance

### Product name

Bug Pocket

### Short description

Free and open source bug capture for QA. Save notes and screenshots locally, annotate evidence, format reports, and choose optional AI assistance or your own cloud sync.

### Full description

Bug Pocket is free to use and open source under the MIT licence. It helps QA testers capture an issue quickly and finish the report when they are ready.

Save a short bug note and screenshot while you work. Add annotations, organize the details, and format a report using editable templates. Copy report text, save screenshot evidence, or open a report in Linear or your configured Jira site.

Local capture works without a cloud account or internet connection. Create and restore backup archives containing local data, the active workspace and their referenced attachments. Inactive workspace databases are excluded.

Optional AI assistance can help draft report fields from text and, when included, a screenshot. Bring your own provider key and compatible endpoint, or use your own local Ollama server and model. AI suggestions need your review. Provider access and account requirements depend on the service you choose.

For optional Cloud Sync, connect your own Supabase project. Configured authentication, workspace sync, attachment transfers and keep-alive requests can run in the background. AI requests to remote providers and configured cloud features transmit relevant data; local capture does not mean every feature stays on the device. Optional AI/cloud-provider charges are separate from Bug Pocket's free application price.

To report a problem or inappropriate AI output, prepare and edit a text-only report in the app. Copy its exact preview, request your email app, then paste, review and send it yourself. The app does not confirm sending, delivery or review.

Editorial factual basis: [R3–R6, R8]. Do not paste this basis line into the Store description.

### Product features

Each line is a proposed separate feature field:

- Free and open source under the MIT licence
- Quick bug notes and screenshot capture with local storage
- Screenshot annotations: arrows, freehand, text, masks and undo
- Editable bug details, taxonomy, filters and report templates
- Copy report text, save screenshot evidence, and open Linear or configured Jira reports
- Backup and restore for local data and the active workspace
- Optional BYOK AI assistance and native local Ollama support
- Optional sync through your own Supabase project
- Global shortcuts and tray access
- Text-only support and AI-output reports through a manual email handoff

Editorial basis: [R3–R6, R8]. Every feature line is under 200 characters. Startup controls remain in the first-release scope; add customer-facing startup wording only after installed behavior is accepted. Do not drop that requirement to finalize the listing. No working-installed-startup claim is made here. [R2]

### AI-use disclosure

Bug Pocket includes optional live generative AI for drafting bug-report fields. You choose a configured BYOK provider/compatible endpoint or native local Ollama. Requests can include report text/context, prompts and an optional screenshot. Remote providers receive that data; their account terms and any charges apply separately from Bug Pocket's free application price. Review generated text before use. Report inappropriate output from the report preview using the manual email handoff. [R4, R6, R8]

This is metadata copy only. The corresponding Partner Center live-AI declaration, reporting/operator handling and final controls remain acceptance items. Current policy is **§11.16**, not §10.2.9. [M1]

### Reporting instructions

From **Help & Support**, choose **Report a Bug** or **Request a Feature**. To report generated output, choose **Report inappropriate AI output** from the report preview. Choose the category, edit the message and optionally include contact email. Nothing is selected automatically. Use **Exact report preview**, then **Copy report** and **Open email app**.

The composer request includes only **valisheik@examenqa.com** and subject **Bug Pocket report**, with no body or attachment. Paste, review and send the email yourself. If copying/opening fails, select/copy the preview and create the email manually. Neither action confirms sending, receipt or review. Closing the dialog keeps the draft in this window's memory; **Discard draft** clears that draft, without removing clipboard or email copies. [R6]

## Proposed dedicated destinations

| Store field | Proposed value | Publication condition |
| --- | --- | --- |
| Privacy policy | https://bugpocket.app/privacy | Keep the durable existing URL; publish accepted replacement sections and reconcile in-app links first. |
| Website | https://bugpocket.app/ | Reconcile broad local-only/cloud-tier claims and acquisition wording with the accepted candidate and Store-only plan. |
| Support contact | valisheik@examenqa.com | Official owner-designated support/privacy/deletion address; confirm manual operator handling. |
| Optional support webpage | https://bugpocket.app/help | Use only after its desktop reporting/startup wording matches accepted behavior. |

These are proposed field values, not verified delivery or a new deployment. The website contact form remains a separate name/email/message route; its existing Resend/forwarding configuration is not changed by the desktop recipient. `examenmail.com` is a test catcher and must not appear as the operational contact. Existing public privacy/help wording was read; the contact page itself was unavailable to the read-only fetch. [R7, M3]

## Draft reviewer notes — complete against the accepted candidate before submission

**Submission identity/status:** First public Store submission, native x64. Planned AppX identity `ExamenQA.BugPocket`, publisher `CN=8D9BF560-2073-427E-9DB1-92BB6AB1F379`, product `9MXD3L6S51ZH`. Intended AUMID `ExamenQA.BugPocket_tgn4dm49y0b56!BugPocket`. Insert final package filename/hash, source SHA, app/package versions and observed installed identity before submission. Prepared configuration/source is not generated-manifest, install, compatibility or certification evidence. [R1, R2]

1. **Local core:** Start without cloud credentials or a provider account. Create a note/screenshot in Quick Capture, save it, open Bug Details, annotate an image, edit fields and inspect the report preview. Check copying and saving evidence. Capture itself must not wait for cloud or AI. Repeat offline on the accepted Windows matrix. Record actual candidate labels/shortcuts rather than assuming defaults. [R3]
2. **Exports/backups:** Test report templates and explicit browser handoffs to Linear/configured Jira with synthetic text. Create/restore a disposable backup and verify the local/active-workspace-only scope. A chosen backup folder can be synced by external software. This is not a whole-installation or legacy migration claim. [R3, R5]
3. **Optional AI:** Open AI settings; configure approved nonproduction BYOK access or a preprovisioned local Ollama server/model. Record selected provider/endpoint/model and image behavior. Invoke triage explicitly; inspect editable results, error/cancel handling and no forced overwrite. Provide separately authorized review access/instructions for advertised remote features without putting personal keys in this document. Saving native settings does not start/install/pull models. Live provider/model acceptance remains pending. [R4]
4. **Optional BYOC:** Use the approved isolated Supabase project/access instructions supplied with the final submission. Verify auth/session, workspace roles, background sync, attachments and disconnect behavior. Saved URL/key can permit keep-alive independently of active sync; sign-out is not remote deletion or configuration clearing. Do not expose production/customer credentials. Live cloud/role/storage acceptance remains separate. [R5]
5. **Manual reporting:** From the report preview choose inappropriate-output reporting. Explicitly select/insert current text, edit it, optionally add contact email and compare **Exact report preview** with copied text. Request email: verify fixed recipient/subject and no inserted body/attachment. Paste/review/send manually only in a separately authorized acceptance exercise. Test no-mail-app/copy failure, close/reopen, discard, keyboard/focus/Narrator and operator assessment/developer action. Success status is not delivery/review evidence. Both direct-send paths stay disabled; Slack/BPR1 is paused and is not a service for reviewers to test. [R6, R7]
6. **Windows integration:** Accept first-run opt-in, exact `BugPocketStartup` task state/read-back, opt-out and Windows-disabled/policy/error outcomes. Verify sign-in background/tray presentation, actual shortcut dispatch and ordinary single-instance/manual launching on installed Windows 10/11 candidates. Native bridge source is prepared; prior source/fixture work does not establish functioning installed startup. Accessibility acceptance remains pending. [R2]
7. **Desktop capability explanation:** The planned `runFullTrust` capability supports this Electron desktop app's local SQLite/files, screenshot capture, global shortcuts, tray and fixed startup integration. It is not a claim of completed capability approval. Confirm the actual generated manifest and provide the final candidate-specific explanation in submission fields. [R2, M4]

These are future reviewer steps, not a completed test record. The reporting checkpoint records focused offline checks and an exact Electron 45.2.1 declaration check; it explicitly leaves real composer, delivery, accessibility and operator acceptance pending. This drafting task ran no tests, builds, application/native execution, packaging or installation. All runtime/release holds remain. [R6]

## Finalisation checklist

- [ ] **Vali acceptance:** final description/features, live-AI disclosure, manual reporting/handling and privacy/support destinations; EXA-51/53 acceptance is still pending.
- [ ] **Enter and verify approved choices:** Free application price, all markets available for this product, English, and Developer tools / Utilities. Owner decisions are confirmed; Partner Center entry and final English app/website/Store consistency remain to be verified. [R8]
- [ ] **Remaining submission decisions:** age-rating questionnaire, discoverability, release date/publishing hold, search terms, publisher/legal details and any other unconfirmed fields. No age rating or launch date is assumed.
- [ ] **Assets:** final-candidate screenshots, captions and any promotional material. Prepared package logos do not satisfy screenshot or accessibility acceptance. For this first submission, leave “What's new” blank. [M2]
- [ ] **Candidate match:** actual architecture/Windows declarations, installed startup/shortcuts/tray, accessibility, capabilities, native/codec/notices, provider/cloud and final candidate acceptance; then WACK, certification and delivered-install/update gates. Preserve the x64-first Windows 10-inclusive first-public-launch scope.
- [ ] **Operational/publication:** accept manual mailbox monitoring and appropriate AI-report action; keep D3 cleanup limited to privacy requests. Publish aligned privacy/support/public copy and check live links only through separately authorized work. Do not reopen paused Slack/BPR1 provisioning or assume its conditional retention terms apply to email.
- [ ] **Ready-to-submit record:** replace provisional identifiers/version/steps with the frozen accepted package and appropriate review access. Do not claim certified Windows compatibility, successful mail delivery or final compliance clearance. No Partner Center edits or publication are authorized by this draft.

## Sources

Repository references are to HEAD `30180af4754526a3c5a72412beaf881659a8133f`; current source and later owner direction govern over historical copy.

- **R1 — Approved planning:** [EXA-62 scope/approval](https://linear.app/examen-qa/document/exa-62-store-launch-scope-and-baseline-decision-packet-30-october-2026-5abe247bf9e9); [EXA-46 accepted version/route plan](https://linear.app/examen-qa/document/exa-46-store-packaging-and-version-strategy-decision-30-october-2026-003ccd058f62); [EXA-53 requirements](https://linear.app/examen-qa/issue/EXA-53/prepare-partner-center-listing-and-certification-notes). Later first-public-launch direction supersedes older legacy-import prerequisites.
- **R2 — Current intended packaging/startup and limits:** [Store config](../electron-builder.store.cjs); [startup fragment](../build/appx-startup.xml); [Store preparation and source-only addenda](store-appx-packaging.txt); [runtime runbook](runtime-validation-runbook.txt), especially line 172; [native bridge contract](../native/store-startup/README.txt). [package.json](../package.json) retains Electron 45.2.1/root 0.9.9.
- **R3 — Core/report features:** [QuickCaptureForm.tsx](../src/renderer/src/components/QuickCaptureForm.tsx); [ScreenshotAnnotator.tsx](../src/renderer/src/components/ScreenshotAnnotator.tsx), lines 396–409; [BugDetailPage.tsx](../src/renderer/src/pages/BugDetailPage.tsx), lines 159–174, 380–400; [reports.ts](../src/renderer/src/services/reports.ts), lines 14–82; [DashboardPage.tsx](../src/renderer/src/pages/DashboardPage.tsx).
- **R4 — Optional AI:** [byokIssueProcessor.ts](../src/main/ai/byokIssueProcessor.ts), lines 43–64, 97–116, 153–204; [ollamaTriage.ts](../src/main/ai/ollamaTriage.ts), lines 9–69; [AiSettings.tsx](../src/renderer/src/components/settings/AiSettings.tsx), lines 156–168.
- **R5 — Backups/BYOC:** [database.ts](../src/main/database.ts), lines 267–325; [backupService.ts](../src/main/sync/backupService.ts), lines 109–138; [syncService.ts](../src/main/sync/syncService.ts), lines 134–180, 358–400, 660–701, 1043–1083; [keepAlive.ts](../src/main/sync/keepAlive.ts), lines 1–48; [index.ts](../src/main/index.ts), lines 84–88, 667–699.
- **R6 — Exact manual flow and validation limits:** [supportDraft.ts](../src/renderer/src/utils/supportDraft.ts), lines 38–74, 99–160; [SupportModal.tsx](../src/renderer/src/components/shared/SupportModal.tsx), lines 167–254; [supportEmailIpc.ts](../src/main/ipc/supportEmailIpc.ts), lines 12–24; [App.tsx](../src/renderer/src/App.tsx), lines 137–140, 249–274; [checkpoint commit and validation record](https://github.com/examenqa/bug-pocket/commit/30180af4754526a3c5a72412beaf881659a8133f); [disabled actual main entry](../src/main/support/feedbackService.ts), lines 62–77; [source gate](../src/shared/supportFeedback.ts), lines 3–5.
- **R7 — Privacy/owner/public-copy reconciliation:** [companion draft and full source register](store-privacy-support-drafts.md); [8 November official-contact correction](C:/MyApps/BugPocket-compliance-evidence/EXA-51/20261108-contact-correction-01a1a741/00-ADDENDUM.txt); [accepted D1–D3 scope](C:/MyApps/BugPocket-compliance-evidence/EXA-51/20261106-slack-handling-01a1a741/13-D1-D3-OWNER-CHOICES.txt); [privacy](https://bugpocket.app/privacy), [home](https://bugpocket.app/), [help](https://bugpocket.app/help), read 11 November, plus this task's owner instruction.
- **R8 — Confirmed launch choices:** Vali's 11 November 2026 instruction in this chat, “EXA-51 / EXA-53 — record approved launch choices”: free to use/open source; existing MIT retained; all markets available for this product; English app/website/Store; Developer tools / Utilities. [Existing licence](../LICENSE) and [source repository](https://github.com/examenqa/bug-pocket). Owner approval does not establish Partner Center entry or publication approval.
- **M1 — Current official AI/accuracy rules:** [Store Policies §11.16](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#1116-live-generative-ai-content) and §10.1; v7.20, effective 22 October 2026, checked 11 November. Metadata/declaration, compliant content, reporting and appropriate developer action are separate requirements.
- **M2 — Official listing guidance:** [MSIX Store listing fields](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info), checked 11 November: plain-text description ≤10,000 characters; features ≤200 characters each, at most 20; at least one screenshot; first-submission “What's new” blank.
- **M3 — Official privacy/support fields:** [Privacy policy and support info](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info).
- **M4 — Official reviewer guidance:** [Notes for certification and restricted capabilities](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options#notes-for-certification). Supply concise feature/access steps and relevant test-service access, not unsupported acceptance claims.
