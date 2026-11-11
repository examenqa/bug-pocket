# DRAFT — Store privacy and support wording (EXA-51 / EXA-53)

11 November 2026 · Asia/Calcutta · **For owner review; not published or compliance clearance.**

Prepared against `examenqa/bug-pocket`, branch `codex/exa-66-electron-45-2-1`, HEAD `30180af4754526a3c5a72412beaf881659a8133f`. This document proposes replacement sections for the existing privacy/support pages and short in-app instructions. Source tags and editorial notes are review aids, not customer copy. No website, service or Partner Center change is included.

## Proposed replacement privacy sections

### Local capture, files and backups

Bug Pocket saves bug text, screenshots, annotations and report settings on your device. Local capture does not require an internet connection or cloud account. If you configure Cloud Sync, saved workspace content can subsequently sync to your project in the background. “Local-first” describes capture and local storage; optional remote features have the data flows described below. [S1, S4]

Local data includes a local SQLite database, separate databases for connected workspaces, and attachment files. Backup archives contain the local database, the currently active workspace database when connected, and the attachments referenced by those databases. They exclude inactive workspace databases and temporary unsaved screenshot-recovery captures. Backups can contain settings and encrypted credentials; protect your backup files. A folder you select may itself be synced by Windows or another service. Restoring saved cloud configuration/session data can allow background networking to resume. [S1, S4]

### Optional AI processing

AI assistance is optional and runs when you request it. With Bring Your Own Key (BYOK), Bug Pocket sends report text/context and prompts, the selected model, and an optional screenshot to your configured AI endpoint. The provider key authorizes the request. Screenshot input may be resized and JPEG-encoded before transmission. Supported configurations include OpenAI, Gemini-compatible endpoints, OpenRouter, Grok and custom/local compatible servers. A remotely hosted endpoint receives this data even though capture is local. Provider accounts, access, charges and data handling depend on your chosen service and account terms. [S2]

Native Ollama processing sends the report prompt and optional image to the Ollama server on this device at `localhost:11434`. You supply the server and model; saving its settings does not install or start them. A local endpoint alone does not establish the server/model's logging or retention practices. Other compatible endpoints use the location you configure. [S2]

Generated suggestions can be inaccurate or inappropriate. Review and edit them before using or sharing them. You can prepare a report about inappropriate output from the report preview using the manual email steps below. The report uses text you choose and edit, rather than automatically collecting the original model response. [S5]

### Optional Bring Your Own Cloud

Cloud Sync uses the Supabase project you configure, rather than a Bug Pocket-hosted primary customer bug database. Setup and authentication contact that project. A configured session can persist and refresh; an authorized workspace can sync report fields, taxonomy, attachment metadata and attachment files in the background. A keep-alive request also contacts the configured project when its saved URL and publishable key exist, including without an active workspace or signed-in sync session. Each background request does not require a new click. [S4]

The configured project and its administrators control access and remote data handling. Project settings, account/service terms and any connected infrastructure determine remote retention, logs, backups and deletion. Bug Pocket does not establish a universal provider retention period. Disconnecting/signing out stops workspace sync and attempts local session sign-out; a failed sign-out can leave saved authentication available for later restoration. Stored project configuration remains, so sign-out alone does not stop the configured keep-alive or erase remote data. [S4]

### Credentials and external handoffs

BYOK keys and persisted cloud sessions use Electron safeStorage encryption on Windows and local database storage. Supabase project URLs and publishable/anon keys are configuration settings; do not treat them as encrypted private credentials. Provider keys are used to authorize AI requests to the selected endpoint. Backup, account-bound decryption and credential recovery have separate limits. [S2, S4]

Copy/export actions place content on the clipboard or in files you choose. An explicit Linear or configured Jira action opens a browser URL containing report text/context; that path does not upload screenshot files. External browsers, trackers, clipboard history/sync and email services can retain their own copies or metadata under their own controls. Remote services may receive ordinary connection/request metadata; their handling is not established by desktop source. [S3]

### Desktop support and inappropriate-AI-output reports

The desktop report dialog prepares a text-only draft. Its exact selectable preview contains the visible category, your edited final message and, if supplied, your optional contact email. Nothing is selected automatically. You may explicitly insert selected current report text, then edit or remove it. Current text can contain your edits and is not a saved original AI response. The reporting flow does not automatically attach screenshots, logs, databases, credentials or hidden report/workspace identifiers. Text you insert can still contain sensitive information; review it before sharing. [S5]

**Copy report** copies exactly that preview. **Open email app** separately requests a composer addressed to **valisheik@examenqa.com**, with subject **Bug Pocket report**, without a body or attachment. Opening email does not copy the report. Paste the preview, review the recipient and final email, and send it yourself. You can also create the email manually. These actions do not establish sending, receipt or review; the app does not track those outcomes. Email you choose to send is handled by your email service and the recipient's mailbox/service. No response or resolution time is guaranteed. [S5, O2]

Draft message/category/contact values remain only in the app window's renderer memory across closing/reopening the dialog and route changes. Copying, requesting email and their failures keep the draft. **Discard draft** clears the current draft; it does not clear other dialog-mode drafts. A renderer reload or end of its lifetime loses these in-memory drafts. Closing a dialog or minimizing the app to the tray does not end that lifetime. Uninserted text choices reset when the dialog reopens. Discarding does not delete source reports, clipboard copies, external email drafts or sent mail. Bug Pocket has no deletion control over those external copies. [S5]

### Website contact form — separate route

The website contact form is separate from the desktop report dialog. The existing website privacy notice describes collection of name, email and message, with Vercel hosting and Resend email handling. Its published description does not establish current forwarding, mailbox receipt, storage duration or deletion of every provider copy. Contact-form routing has not been changed to match the desktop email recipient by this draft. Final website disclosures must use the existing accepted website evidence and any remaining owner-confirmed facts; desktop copy/paste instructions do not describe a website submission. [W1, O2]

### Retention, deletion and requests

Local reports remain subject to the app's scoped data controls. Deleting a report removes its local records and queues a cloud deletion when applicable; it does not establish immediate removal from the configured project, backups or external copies. Clearing the current workspace affects its local database and unreferenced local attachment files. Factory reset removes local report/workspace data and attachments while retaining settings, hotkeys, AI keys, templates and presets. Use the relevant credential controls separately. These actions are not a universal “delete everything” operation. [S6]

Automatic cleanup has narrow scopes: unsaved screenshot-recovery captures have a 24-hour expiry; cleanup can be deferred by locked/unreadable databases. The 60-day rule concerns attachments associated with Discarded reports, measured from the report's last update, rather than deletion of every report. Automatic-backup pruning attempts to retain the latest three matching automatic backup files in the configured folder after a successful backup; it does not expire all manual/exported backups. None of these rules defines support-email or provider retention. [S6]

For support, privacy or deletion requests, contact **valisheik@examenqa.com**. The accepted manual cleanup target is to remove identified privacy-request messages and related sent replies **30 days after closure**, including accessible Trash where permitted. Closure means that the final disposition, actions and known unresolved limits have been communicated. Unrelated mail, including website-contact material in mixed conversations, must be preserved, and applicable retention/hold restrictions respected. This qualified target is not automatic deletion, a maximum lifetime for all support mail, proof that cleanup occurred, or provider-wide erasure. [O2, O3]

We cannot promise removal of clipboard history, recipient/user copies, exported files, provider logs/backups or other copies outside the app's controls. Provider-specific periods and applicable restrictions must be described only where established; no universal zero-retention or irreversible-erasure claim is made. [S3, S6, O3]

## Proposed support-page replacement

For Bug Pocket support, feature feedback, privacy/deletion requests or concerns about generated output, email **valisheik@examenqa.com**.

From **Help & Support**, choose **Report a Bug** or **Request a Feature**. To report generated output, choose **Report inappropriate AI output** from the report preview. Review the category and final text, optionally add contact email, and check **Exact report preview**. Choose **Copy report**, then **Open email app**. The requested subject is **Bug Pocket report**; paste the copied text, review it and send it yourself. No attachment or body is inserted automatically. If either action fails, select/copy the preview and create the email manually. Copying or requesting a composer does not confirm sending, delivery or review. [S5]

Closing the dialog keeps the draft in this app window's memory. **Discard draft** clears that draft, while clipboard and email copies remain outside Bug Pocket's deletion controls. Avoid confidential content. No reply or resolution deadline is promised. The website contact form is a separate route. [S5, O2]

## Concise proposed in-app instructions

1. Choose the category. Write your message, or explicitly insert selected current text and edit it. Add contact email only if wanted.
2. Check **Exact report preview**, then **Copy report**.
3. Choose **Open email app**. If a composer appears, check **valisheik@examenqa.com** and **Bug Pocket report**, paste, review and send.
4. If copying or opening email fails, select/copy the preview and address an email manually. Sending, receipt and review are not confirmed.
5. **Close and keep draft** preserves this in-memory draft; **Discard draft** clears it. Neither clears clipboard/email copies. [S5]

## Editorial reconciliation and policy basis

- The public privacy/homepage wording read on 11 November still includes broad local-only/cloud-only-exception wording, calls sync upcoming, and makes update/deletion claims that need qualification. It already mentions AI transfers and a website form. Replace the affected sections together; do not describe this as a missing policy. Existing help copy is not evidence of installed startup acceptance. The contact page itself was unavailable to the read-only fetch; its current UI was not verified. Remove the unsupported periodic app-update-check and no-IP-logging claims; the accepted source inventory/README establishes no desktop auto-updater, and no blanket provider-logging claim is established. Store-managed updates remain intended future distribution behavior subject to acceptance. [W1, S1, S8, O1]
- Both existing direct-send paths remain disabled. The desktop renderer and actual main entry deny direct submission; the injected-transport seam is a fixture, not a shipping service. The separate website support-forwarding entry remains disabled under accepted owner/evidence records. Slack/BPR1 setup, receipts and provisioning remain paused. Do not advertise Slack forwarding, an upload API, receipts or a new hosted service. D1's conditional future support-only Slack retention and D2's key/receipt periods do not govern manual email. The website contact form is not that disabled support-forwarding entry. [S7, O3, O4]
- Current Microsoft Store Policies v7.20, checked 11 November: §10.5 requires an accurate privacy explanation covering personal information handling and controls. §11.16 requires live-AI metadata/declarations, compliant content, reporting and appropriate developer action. These drafts and a composer request do not prove operational handling or acceptance. Use dedicated privacy/support fields; do not substitute this draft for the live policy. [M1, M2]

## Owner decisions, manual checks and publication prerequisites

- [ ] Vali accepts final privacy/support wording and the proposed destinations, including official contact and an accurate separate website-form description. Publish only through a separately authorized change; reconcile privacy, support/help, relevant marketing/terms, in-app links and Store fields.
- [ ] Confirm practical monitoring, assessment/developer action and handling for manual AI-output emails. Apply D3 only to identified privacy requests; finalize email-service/access/copy limitations from existing evidence. Do not reopen D1–D3 or transfer the Slack terms to email.
- [ ] Later authorized manual acceptance: real preview/clipboard fallback and composer/no-mail-app behavior, user-sent email/receipt, draft retention/discard, keyboard/focus/Narrator and operator handling. No such acceptance occurred here.
- [ ] Match the frozen candidate's provider/image controls, BYOC/background/sign-out/reset/backup behavior and current provider-account disclosures. Keep unavailable provider details qualified.
- [ ] Complete EXA-51/53 acceptance and applicable runtime, provider/cloud, native/installed/startup, codec/notices, final-candidate, accessibility, WACK and Store gates before publication. Electron remains 45.2.1; all execution/release holds remain. First public Store launch: no legacy NSIS import prerequisite is added. [O1, S8]

## Source references (editorial; preserve historical records)

All repository line references below refer to HEAD `30180af4754526a3c5a72412beaf881659a8133f`. Source was read, not executed.

- **S1 — Local capture/storage/backups:** [database.ts](../src/main/database.ts), lines 231–325; [backupService.ts](../src/main/sync/backupService.ts), lines 109–138; [README](../README.md), Local-First Architecture. README's older direct-support-send wording is superseded by S5/S7.
- **S2 — AI and credentials:** [byokIssueProcessor.ts](../src/main/ai/byokIssueProcessor.ts), lines 43–64, 97–116, 153–204; [openAiCompatibleChat.ts](../src/main/ai/openAiCompatibleChat.ts), lines 32–73; [ollamaTriage.ts](../src/main/ai/ollamaTriage.ts), lines 9–69; [AiSettings.tsx](../src/renderer/src/components/settings/AiSettings.tsx), lines 156–168; [AI lifecycle](ai-lifecycle.md).
- **S3 — Export/browser/clipboard:** [reports.ts](../src/renderer/src/services/reports.ts), lines 14–52, 77–82; [BugDetailPage.tsx](../src/renderer/src/pages/BugDetailPage.tsx), lines 159–174, 380–384; [index.ts](../src/main/index.ts), line 1131. External-copy limits follow from these handoffs, not a provider-retention investigation.
- **S4 — BYOC/session/background:** [syncService.ts](../src/main/sync/syncService.ts), lines 134–180, 358–400, 660–701, 1043–1083; [SafeStorageAdapter.ts](../src/main/sync/SafeStorageAdapter.ts), lines 11–51; [keepAlive.ts](../src/main/sync/keepAlive.ts), lines 1–48; [index.ts](../src/main/index.ts), lines 84–88, backup restore handlers; [database.ts](../src/main/database.ts), lines 2226–2259.
- **S5 — Manual reporting:** [supportDraft.ts](../src/renderer/src/utils/supportDraft.ts), lines 11–15, 38–74, 99–160; [SupportModal.tsx](../src/renderer/src/components/shared/SupportModal.tsx), close/selection/action handlers and lines 167–254; [supportEmailIpc.ts](../src/main/ipc/supportEmailIpc.ts), lines 12–24; [App.tsx](../src/renderer/src/App.tsx), lines 137–140, 249–274; [BugDetailPage.tsx](../src/renderer/src/pages/BugDetailPage.tsx), lines 353–356, 389–400; [implementation checkpoint](https://github.com/examenqa/bug-pocket/commit/30180af4754526a3c5a72412beaf881659a8133f).
- **S6 — Scoped local deletion/cleanup:** [database.ts](../src/main/database.ts), lines 351–451, 3793–3975; [DataManagementPanel.tsx](../src/renderer/src/components/settings/DataManagementPanel.tsx), lines 160–165, 193–214; [index.ts](../src/main/index.ts), lines 667–699.
- **S7 — Disabled desktop sending:** [supportFeedback.ts](../src/shared/supportFeedback.ts), lines 3–5; [renderer guard](../src/renderer/src/utils/supportFeedback.ts), lines 20–35; [actual main entry and isolated fixture](../src/main/support/feedbackService.ts), lines 62–77.
- **S8 — Current launch/validation limits:** [runtime runbook](runtime-validation-runbook.txt), especially first-public-launch clarification at line 172; [Store preparation/addenda](store-appx-packaging.txt); [Store trial config](../electron-builder.store.cjs). Later source-only records supersede older pending/complete statements within their actual scope.
- **O1 — Requirements and approved scope:** [EXA-51](https://linear.app/examen-qa/issue/EXA-51/implement-store-privacy-and-third-party-data-disclosure-requirements), [EXA-53](https://linear.app/examen-qa/issue/EXA-53/prepare-partner-center-listing-and-certification-notes), [approved EXA-62 packet](https://linear.app/examen-qa/document/exa-62-store-launch-scope-and-baseline-decision-packet-30-october-2026-5abe247bf9e9), as qualified by the later first-public-launch direction and this 11 November drafting instruction.
- **O2 — Official contact correction:** [8 November accepted addendum](C:/MyApps/BugPocket-compliance-evidence/EXA-51/20261108-contact-correction-01a1a741/00-ADDENDUM.txt). `examenmail.com` is a test catcher, not an operational support/privacy/deletion contact; changing copy does not establish changed forwarding.
- **O3 — Accepted D1–D3, without scope expansion:** [6 November A4 owner choices](C:/MyApps/BugPocket-compliance-evidence/EXA-51/20261106-slack-handling-01a1a741/13-D1-D3-OWNER-CHOICES.txt), plus O2's mailbox correction. D3 remains a qualified manual target, not evidence of cleanup.
- **O4 — Existing disabled/paused operational boundary:** [7 November enablement gates](C:/MyApps/BugPocket-compliance-evidence/EXA-51/20261107-settings-acceptance-01a1a741/02-ENABLEMENT-GATES.txt), O2's later corrections, and the current owner's 11 November instruction. Reused only; no settings or security investigation reopened.
- **W1 — Existing public copy, read 11 November:** [privacy](https://bugpocket.app/privacy), [home](https://bugpocket.app/), [help](https://bugpocket.app/help). Published claims are evidence of wording, not proof of current service behavior.
- **M1 — Official current policy:** [Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#105-personal-information), §10.5 and [§11.16 live generative AI](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#1116-live-generative-ai-content), v7.20, effective 22 October 2026.
- **M2 — Official fields:** [Privacy policy and support info](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info), checked 11 November 2026.
