# Store local trial approval, procedure and results

Updated 25 November 2026. **The approved retry completed installed QA and rollback for `AMIGO\BugPocketQA` on Windows build `10.0.26300.0`.** Vali confirmed the ChatGPT artwork provenance and authorized the existing mark for Bug Pocket and its Store listing and marketing. [Artwork provenance and authorization](store-artwork-provenance.md)

## Completed installed retry

SignTool and Authenticode verified the separate signed copy, SHA-256 `83c76e724c7955ffb1745d6b4ad6b65ee2d5fefd0422d1c9a63fd9d34303a1c2`. The corrected comparison verified both exact-signer CMS signatures and accepted only `AppxSignature.p7x`, `AppxMetadata/CodeIntegrity.cat` and their exact `[Content_Types].xml` overrides. ZIP entries increased from 287 to 289 and mappings from 97 to 99. All other original streams, including the manifest and BlockMap, matched.

The first install command in the retry stopped at the reviewed payload count check before moving QA data or deploying anything. In the split-stage Windows PowerShell 5.1 runner, the corrected loader assigns the JSON receipt to `$reviewedEntries` directly from `Read-Receipt`, then iterates its entries to populate the ordinal dictionary and requires 280 entries. The packet's same-console commands already use the verifier's dictionary directly. The corrected runner completed the sole deployment using the same verified signing copy. The local `install.json` and `install-corrected-loader.json` record both outcomes.

- **Installed payload.** All 280 application streams and 76 notice originals matched. The ordinary QA account read the combined notices, Feather MIT, Lucide ISC and both runtime notices. The installed SQLite Release and Store startup addons loaded from their expected paths with the reviewed hashes. Internal runtime versions were unmeasured in the installed app.
- **App behavior.** The capture, main-panel and region shortcuts worked. A synthetic note and annotated PNG reopened after restart. Actual Windows sign-in startup was quiet, manual activation focused the existing instance, and explicit opt-out returned the Windows startup state to disabled. The export dialog offered PNG only. Secondary Windows startup activation with an instance already running remains untested.
- **Rollback.** The observer before sign-out confirmed process closure after its exit-code sampling ended. The final tray Quit recorded exit code 0 for all five trial processes. The trial package and PFN data, temporary trust, certificate and private key, and signing files were removed. Restored QA data matched all 74 file hashes and 28 directories. Both unsigned packages were preserved.

The retry receipts pin the approval-time packet SHA-256 `7733f44e973c573e696663853646ca82ac182ebb9df0531fc65c9a3f5c5c8674`. The exact packet is retained locally as `approved-retry-packet.md` next to the retry receipts. The 11 PowerShell blocks below reproduce the approved commands. [Local retry result](../release-store/trial-20261125-notice-x64/evidence/installed-trial-retry-20261125/RESULT.txt)

Windows compatibility across the supported matrix, migration and update validation, accessibility, WACK and final Store acceptance remain open. External sharing, Store submission and public distribution remain held while FFmpeg source and build closure, recipient delivery and replacement, attribution and terms, and the exact Windows SDK entitlement are resolved. [Distribution status](../compliance/README.md#25-november-2026--installed-local-retry-and-distribution-status)

## First trial and checker correction

The prior signed copy passed `signtool verify /pa /v` with the recorded signer. The original package-shape check **failed** because it expected only `AppxSignature.p7x`, while SignTool also emitted `AppxMetadata/CodeIntegrity.cat` (287 unsigned entries, 289 signed). Independent comparison verified that all 286 original streams other than `[Content_Types].xml` were unchanged, that the XML gained exactly the two corresponding overrides, and that both metadata CMS signatures passed with the recorded signer and SHA-256. Microsoft documents SignTool creating the catalog during MSIX signing. [Microsoft winapp CLI documentation](https://github.com/microsoft/winappCli/blob/main/docs/usage.md#create-external-catalog)

Execution stopped before QA data was moved or the package was installed or launched. Rollback removed the prior trial's certificate, private key, device-wide trust and signed copy. The original stop and comparison receipts remain under [installed-trial evidence](../release-store/trial-20261125-notice-x64/evidence/installed-trial-20261125/RESULT.txt), including [verification-stop.json](../release-store/trial-20261125-notice-x64/evidence/installed-trial-20261125/verification-stop.json) and [signed-metadata-comparison.json](../release-store/trial-20261125-notice-x64/evidence/installed-trial-20261125/signed-metadata-comparison.json). The prior `signing/` directory contains historical receipts. The approved retry used a fresh sibling directory.

Windows PowerShell 5.1.26100.10068 parsed all 11 PowerShell blocks and completed **38 focused checks** under StrictMode. Two disposable ZIP layouts passed the structural comparison, including an XML serialization variation. The checker rejected 35 cases covering changed application, manifest and BlockMap bytes, missing or extra entries, aliases and duplicates, invalid Content_Types changes, and invalid CMS evidence. A read-only Windows catalog probe verified the original CMS signature and rejected modified signed content in memory. The final check confirmed the exact unsigned successor hash and compatibility with its 287 entries and 97 Content_Types mappings. Disposable ZIPs were removed. [Fixture runner](../release-store/trial-20261125-notice-x64/evidence/installed-trial-20261125/test-signing-metadata-fixtures.ps1) · [Fixture receipt](../release-store/trial-20261125-notice-x64/evidence/installed-trial-20261125/signing-metadata-correction-fixtures.json)

Six disposable Windows PowerShell 5.1 StrictMode path-guard checks also passed, covering ancestor traversal, junction rejection and terminating missing-path errors. The earlier signing guard remains recorded as failed. The completed retry reused the 79 passing notice tests and static artifact inspection.

## Exact reviewed input

- Unsigned successor: `C:\MyApps\BugPocket-exa66-45-2-1\release-store\trial-20261125-notice-x64\package\Bug-Pocket-Store-1.1.0-x64.appx`
- Size: **195,082,228 bytes**. SHA-256: **`d46a201a3ea77fded4f6ccdbee2ba2cf11047d607ba73ea79f364daac53de471`**.
- Identity: `ExamenQA.BugPocket`, publisher **`CN=8D9BF560-2073-427E-9DB1-92BB6AB1F379`**, x64, version `1.1.0.0`. PFN `ExamenQA.BugPocket_tgn4dm49y0b56`; AUMID `ExamenQA.BugPocket_tgn4dm49y0b56!BugPocket`. Only `runFullTrust`; one `BugPocketStartup` task with manifest `Enabled=false`.
- The original unsigned AppX stays at `release-store\trial-20261125-x64\source\release-store\Bug-Pocket-Store-1.1.0-x64.appx`, SHA-256 `f286068168eb93422afa5171199f6499167832b7f9610fbc60144023ee105ca1`. Preserve it and its evidence.
- Receipts: successor `evidence/successor-inspection.json` and `evidence/independent-feather-notice-verification.json`. Every mapped file except the combined notices, provisional inventory and new Feather original matches the original package. All 76 notice originals, both runtime copies, identity, native resources, ZIP CRCs and 7,720 BlockMap block hashes passed static verification. No installed/runtime acceptance is claimed.

## Read-only preflight and isolation

Verified `AMIGO\BugPocketQA`, SID ending `-1006`, OS profile/USERPROFILE `C:\Users\BugPocketQA`, x64 host reporting `10.0.26300.0`, GitHub login `examenqa`, expected repository/branch and HEAD `62564ee8564940999434262419e500c7a3f30e8a`. Use the actual OS profile, not a fabricated HOME/USERPROFILE. Root package `0.9.9`, Store metadata `1.1.0`, all dependency pins, the Git index and clarification drafts remain unchanged.

The unsandboxed read-only current-user query found **no `ExamenQA.BugPocket` registration**. No matching-subject certificate was found in CurrentUser My/TrustedPeople or LocalMachine My/TrustedPeople. All-user package and online provisioning queries require administrator elevation and could not be completed by this QA token. **Do not infer that other users or the machine have no staged package.** As part of the approved pre-install work, an administrator must record `Get-AppxPackage -AllUsers -Name ExamenQA.BugPocket`, `Get-AppxProvisionedPackage -Online` filtered to that identity, and any staged/registered same-identity content. Any result, access denial, different signer or identity collision stops installation; do not replace, unregister or provision over another user's package. A different account alone does not isolate machine-wide AppX staging/signers. Use a clean VM/device or return for a revised plan if this precondition fails.

Existing QA data **was found** at `C:\Users\BugPocketQA\AppData\Roaming\Bug Pocket`, including `local.sqlite`. The checker correction's read-only census matched all 73 historical file hashes and found one additional `logs/main.log`. Include all files present in the fresh retry census. The earlier checks found the PFN directory under `C:\Users\BugPocketQA\AppData\Local\Packages` and the checked Roaming/Local `bug-pocket` and Local `Bug Pocket` alternatives absent. Recheck all paths and processes immediately before execution.

After approval, with confirmed process closure, preserve the existing QA Roaming directory by a guarded same-volume rename to the currently absent, exact sibling **`C:\Users\BugPocketQA\AppData\Roaming\Bug Pocket.pre-store-trial-20261125`**. Record its file/hash census first; refuse links, an existing destination or a path outside the named QA profile. Do not open its SQLite/configuration or import it. This temporarily isolates the existing QA profile, including desktop-app read-through paths. Do not move any other user's data. If another candidate app-data path appears, stop and extend the preservation record before launching.

Let the fresh installed app create only synthetic QA state. Keep credentials, sync, support/AI uploads and integrations unconfigured; use synthetic notes/screenshots only. MSIX may redirect app data to package LocalCache/LocalState, so record actual created paths and writes rather than assuming redirection. The full-trust app is not a security sandbox. TEMP/TMP and supervisor logs may use a newly owned trial directory; do not redirect OS identity variables. Exclude inherited `NODE_OPTIONS`, `NODE_PATH`, `ELECTRON_RENDERER_URL`, `ELECTRON_RUN_AS_NODE`, Electron mirror/override variables, GPU/GL overrides and remote-debug switches. Do not reuse the smoke-test environment for this normal installed/startup trial.

## Approved certificate and trust procedure

No suitable existing certificate was discovered. Propose **one 14-day, RSA-2048/SHA-256, non-exportable end-entity test signing certificate** in **BugPocketQA's `Cert:\CurrentUser\My`**, exact subject **`CN=8D9BF560-2073-427E-9DB1-92BB6AB1F379`**, EKU Code Signing `1.3.6.1.5.5.7.3.3`, KeyUsage DigitalSignature, basic constraints CA=false. Friendly name `Bug Pocket local QA 20261125`. Record the generated thumbprint, dates and key-container identity. An administrator logged in as another user must not create the private key in that user's CurrentUser store.

Export **only the public `.cer`** to `C:\MyApps\BugPocket-exa66-45-2-1\release-store\trial-20261125-notice-x64\signing-retry-20261125\BugPocket-local-QA-20261125.cer`. No PFX or private-key export. An administrator would import that exact public certificate into **`Cert:\LocalMachine\TrustedPeople`**, recording its thumbprint and before/after store census. This trust is **device-wide**, including other accounts; it is not confined to BugPocketQA or this one package. It can trust other packages signed by that key. Protect the non-exportable private key and remove the newly introduced trust after the trial. Do not add a Root/CA entry, change policy/Developer Mode, or modify any other certificate. [Microsoft subject/certificate/trust requirements](https://learn.microsoft.com/en-us/windows/msix/package/create-certificate-package-signing) · [Trust scope and cleanup](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/security).

## Signing, user-only install and activation

1. Recheck the unsigned input SHA-256 and all preconditions. Make a single signing copy at `release-store\trial-20261125-notice-x64\signing-retry-20261125\Bug-Pocket-Store-1.1.0-x64.test-signed.appx`, preserving both unsigned packages. Use existing SDK `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe`, SHA-256 `f72bda523e9a03f502386f8407e21fc06e9d21baccc9e14c17b0e22a19fbed38`; no tooling installation. As BugPocketQA, select only the recorded new certificate: `signtool sign /fd SHA256 /s My /sha1 <exact-thumbprint> <signing-copy>`. No timestamp/network service is needed for this short test.
2. Verify `signtool verify /pa /v <signing-copy>`, the exact signer and subject, the new signed SHA-256, and the stream and Content_Types comparison below. Check both added CMS signatures against the exact signer before preserving data or installing. The CMS check verifies cryptography. SignTool and Authenticode supply package integrity and trust verification. [Microsoft SignTool procedure](https://learn.microsoft.com/en-us/windows/msix/package/sign-app-package-using-signtool) · [Microsoft SignedCms.CheckSignature](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.pkcs.signedcms.checksignature?view=netframework-4.8.1)
3. Return to the **non-elevated BugPocketQA** session. `Add-AppxPackage -Path <verified-signing-copy>` installs only for that current user. Do not use `-AllUsers`, provisioning, `-AllowUnsigned`, force-update flags or identity/signature bypasses. Record returned deployment details and `Get-AppxPackage -Name ExamenQA.BugPocket`: exact full name/PFN, publisher, version, architecture, install path and status. The installed EXE, ASAR, both native addons, FFmpeg, Microsoft DLLs and notices must match the reviewed payload hashes. [Per-user deployment](https://learn.microsoft.com/en-us/powershell/module/appx/add-appxpackage?view=windowsserver2025-ps).
4. Activate via the registered AUMID, e.g. `explorer.exe 'shell:AppsFolder\ExamenQA.BugPocket_tgn4dm49y0b56!BugPocket'`, in the QA desktop. Record launch time, owned process tree/executable path and normal installed behavior. Do not run the executable under an alternate main entry or enable development overrides.

## Targeted acceptance only

- **Native/preload/local data:** ordinary manual launch must open the app; verify preload-backed settings/dashboard, local capture save/reopen/restart persistence, and graceful quit. Record loaded module paths/hashes for the installed Release `better_sqlite3.node` (`b30113cad4809493e15db46f8f56b8af114ba176cfa665093827bb936b2016c6`) and Store bridge (`0b423248ff6f6657c3dcdf014f5bc7ae48ce4d7915529042cfd7eafe791ed96d`). Module-path evidence plus actual local operations and successful startup status/activation proves these particular binaries loaded; source/static hashes alone do not. Record any unobservable runtime version as unmeasured, not inferred. No new harness or binary modification is approved by this packet.
- **Installed notices:** as the ordinary QA user, locate `<InstallLocation>\app\resources\notices`; read/open the combined text, Feather original, unchanged Lucide ISC and both runtime texts without elevation or ACL changes. Hash the full files against the inspection receipt, verify all 76 originals, and record recipient access. Public FFmpeg prominence/source links still need shipping work.
- **Image workflows affected by runtime/native paths:** one local screenshot/crop, annotation and PNG/JPEG export/reopen using synthetic content. Reuse prior keyboard/DPI/multimonitor evidence within its original scope; do not repeat the full matrix or suite.
- **Startup and shortcuts:** actual installed identity must resolve exactly `BugPocketStartup`; initially read disabled, and confirm first-run No thanks does not enable it. Then explicitly opt in in the QA app and read back Windows' actual state. User/policy denial is a result, not a reason for registry fallback. With approval for the QA session transition and saved QA work, sign out/in **only BugPocketQA**; verify real startup activation is quiet, tray-ready and global capture shortcut works. Manual activation/second instance must show/focus normally; secondary startup activation must preserve visibility. Opt out and verify actual disabled state. Keep existing [phase-two cases](store-startup-qa-plan.md#phase-2--later-installed-acceptance) and graceful drain/owned-process closure requirements. Do not change startup for another account.

Current-host results cannot supply Windows 10/other-Windows-version acceptance. Preserve the missing earlier exit receipt as UNVERIFIED; direct-send paths remain disabled and Slack paused. WACK, Store certification, update/data persistence, accessibility and all unrelated acceptance holds remain in force.

## Rollback and exact cleanup scope

After trial (or any failure), opt out if possible, quit through the graceful lifecycle, and verify closure of the owned process tree. On unconfirmed closure retain resources/data and diagnose; do not delete under a live process. In the BugPocketQA session remove **only the recorded trial full package name** with `Remove-AppxPackage -Package <recorded-full-name>`, without `-AllUsers`. If any pre-existing registration was found earlier, this trial must not have proceeded over it. [Current-user uninstall](https://learn.microsoft.com/en-us/powershell/module/appx/remove-appxpackage?view=windowsserver2025-ps).

Preserve compact synthetic results. Remove/rename aside only newly created QA app-data paths identified by the before/after census; validate their absolute paths and ownership first. Restore `Bug Pocket.pre-store-trial-20261125` atomically to the exact original Roaming name after the synthetic replacement is removed and all processes close; require the restored file hashes to match the pre-trial census. Do not factory-reset, clear workspaces or delete original databases/attachments. A failed restore retains both copies and stops cleanup.

The administrator removes `Cert:\LocalMachine\TrustedPeople\<new-thumbprint>` **only if absent before and introduced by this trial**, after verifying the thumbprint and subject. BugPocketQA removes the one new My-store certificate and its private key/container, and the trial-created public CER and signed copy when no longer needed. Do not remove existing same-subject/different-thumbprint certificates or any roots. Recheck current-user registration absence, startup absence/disabled state and trust-store deltas; record all cleanup outcomes. The original package, unsigned successor, source changes and evidence remain.

## Scope of the one approved retry

Vali approved one retry on unsigned SHA-256 `d46a201a3ea77fded4f6ccdbee2ba2cf11047d607ba73ea79f364daac53de471`. The scope covered administrator conflict checks, guarded preservation and restoration of QA-only Roaming data, one new non-exportable 14-day certificate in BugPocketQA My, temporary device-wide trust of the public leaf in LocalMachine TrustedPeople, and signing and verification of one copy in `signing-retry-20261125`. It also covered BugPocketQA-only deployment and activation, the targeted installed cases and one QA-only sign-out/in after saved-work confirmation, then scoped rollback. The completed retry used that approval.


## Exact execution commands for this approval

The approved procedure used separate Windows PowerShell 5.1 consoles for the administrator and the non-elevated BugPocketQA desktop. A failed check stops dependent steps and triggers the applicable rollback for changes already made.

### Shared setup in both consoles

~~~powershell
$ErrorActionPreference = 'Stop'
$trialRoot = 'C:\MyApps\BugPocket-exa66-45-2-1\release-store\trial-20261125-notice-x64'
$trialUnsigned = Join-Path $trialRoot 'package\Bug-Pocket-Store-1.1.0-x64.appx'
$trialInputHash = 'D46A201A3EA77FDED4F6CCDBEE2BA2CF11047D607BA73EA79F364DAAC53DE471'
$trialState = Join-Path $trialRoot 'signing-retry-20261125'
$trialSigned = Join-Path $trialState 'Bug-Pocket-Store-1.1.0-x64.test-signed.appx'
$trialPublicCer = Join-Path $trialState 'BugPocket-local-QA-20261125.cer'
$trialSignTool = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
$trialPublisher = 'CN=8D9BF560-2073-427E-9DB1-92BB6AB1F379'
$trialName = 'ExamenQA.BugPocket'
$trialFamily = 'ExamenQA.BugPocket_tgn4dm49y0b56'
$trialFullName = 'ExamenQA.BugPocket_1.1.0.0_x64__tgn4dm49y0b56'
$qaProfileDir = 'C:\Users\BugPocketQA'
$qaData = Join-Path $qaProfileDir 'AppData\Roaming\Bug Pocket'
$qaBackup = "$qaData.pre-store-trial-20261125"
$qaSynthetic = "$qaData.store-trial-synthetic-20261125"
$qaOtherData = @(
    (Join-Path $qaProfileDir "AppData\Local\Packages\$trialFamily")
    (Join-Path $qaProfileDir 'AppData\Roaming\bug-pocket')
    (Join-Path $qaProfileDir 'AppData\Local\bug-pocket')
    (Join-Path $qaProfileDir 'AppData\Local\Bug Pocket')
)
$trialLogin = [Security.Principal.WindowsIdentity]::GetCurrent()
$trialAdmin = [Security.Principal.WindowsPrincipal]::new($trialLogin).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

function Assert-QaTrialUser {
    if ($trialAdmin -or $trialLogin.Name -ine 'AMIGO\BugPocketQA' -or
        [Environment]::GetFolderPath('UserProfile') -ine $qaProfileDir -or
        $env:USERPROFILE -ine $qaProfileDir) {
        throw 'Use the real non-elevated BugPocketQA account and profile.'
    }
}

function Assert-TrialInput {
    if ((Get-FileHash -LiteralPath $trialUnsigned -Algorithm SHA256).Hash -cne $trialInputHash) {
        throw 'Unsigned successor hash mismatch.'
    }
    if ((Get-FileHash -LiteralPath $trialSignTool -Algorithm SHA256).Hash -cne
        'F72BDA523E9A03F502386F8407E21FC06E9D21BACCC9E14C17B0E22A19FBED38') {
        throw 'Pinned SignTool hash mismatch.'
    }
}

function Assert-TrialPlainPath([string]$target) {
    $item = Get-Item -LiteralPath $target -Force -ErrorAction Stop
    while ($item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path $($item.FullName)" }
        $item = if ($item -is [System.IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
    }
}

function Read-TrialSigner {
    Assert-TrialPlainPath $trialState
    $signerPath = Join-Path $trialState 'signer.json'
    Assert-TrialPlainPath $signerPath
    $receipt = Get-Content -LiteralPath $signerPath -Raw | ConvertFrom-Json
    if ($receipt.Thumbprint -cnotmatch '^[A-F0-9]{40}$' -or
        $receipt.Subject -cne $trialPublisher -or $receipt.UnsignedSHA256 -cne $trialInputHash) {
        throw 'Signing receipt mismatch.'
    }
    $receipt
}

function Assert-TrialProcessesClosed {
    if (Get-Process -Name 'Bug Pocket','BugPocket' -ErrorAction SilentlyContinue) {
        throw 'Confirm normal Bug Pocket process closure before continuing.'
    }
}
~~~

### 1. Administrator checks for conflicting packages

Repeat this check before importing trust. Any matching installation, provisioned package, staged content or query failure stops the trial. [Windows machine package catalog](https://learn.microsoft.com/en-us/uwp/api/windows.management.deployment.packagemanager.findpackages) · [Get-AppxPackage](https://learn.microsoft.com/en-us/powershell/module/appx/get-appxpackage?view=windows-11)

~~~powershell
function Assert-TrialPackageClear {
    if (-not $trialAdmin) { throw 'Use the administrator console.' }
    $registrations = @(Get-AppxPackage -AllUsers -Name $trialName)
    $provisioned = @(Get-AppxProvisionedPackage -Online | Where-Object {
        $_.DisplayName -ieq $trialName -or $_.PackageName -like "$($trialName)_*"
    })
    $manager = [Windows.Management.Deployment.PackageManager,Windows.Management.Deployment,ContentType=WindowsRuntime]::new()
    $catalog = @($manager.FindPackages($trialName, $trialPublisher))
    if ($registrations.Count -or $provisioned.Count -or $catalog.Count) {
        $registrations | Format-List Name,PackageFullName,PackageUserInformation
        $provisioned | Format-List DisplayName,PackageName
        $catalog | ForEach-Object { $_.Id.FullName }
        throw 'Existing or staged package found. Preserve it and stop.'
    }
    'No matching registration, provisioning or package catalog entry.'
}
Assert-TrialPackageClear
~~~

### 2. BugPocketQA signs a copy and exports only the public certificate

~~~powershell
Assert-QaTrialUser
Assert-TrialInput
Assert-TrialProcessesClosed
Assert-TrialPlainPath $trialRoot
if ((Test-Path -LiteralPath $trialState) -or (Get-AppxPackage -Name $trialName) -or
    (Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -ceq $trialPublisher })) {
    throw 'An existing retry signing directory, QA package or matching personal certificate needs review.'
}
New-Item -ItemType Directory -Path $trialState | Out-Null
$certParameters = @{
    Type = 'Custom'
    Subject = $trialPublisher
    CertStoreLocation = 'Cert:\CurrentUser\My'
    Provider = 'Microsoft Software Key Storage Provider'
    KeyAlgorithm = 'RSA'
    KeyLength = 2048
    HashAlgorithm = 'SHA256'
    KeyUsage = 'DigitalSignature'
    KeyExportPolicy = 'NonExportable'
    TextExtension = @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
    NotAfter = (Get-Date).AddDays(14)
    FriendlyName = 'Bug Pocket local QA 20261125'
}
$trialCert = New-SelfSignedCertificate @certParameters
[ordered]@{
    Subject = $trialCert.Subject
    Thumbprint = $trialCert.Thumbprint
    NotBefore = $trialCert.NotBefore
    NotAfter = $trialCert.NotAfter
    UnsignedSHA256 = $trialInputHash
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $trialState 'signer.json') -Encoding UTF8
$trialKey = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($trialCert)
try { $trialKey.Key.UniqueName | Set-Content -LiteralPath (Join-Path $trialState 'key-container.txt') }
finally { $trialKey.Dispose() }
Export-Certificate -Cert $trialCert -FilePath $trialPublicCer -Type CERT -NoClobber | Out-Null
Copy-Item -LiteralPath $trialUnsigned -Destination $trialSigned
if ((Get-FileHash -LiteralPath $trialSigned -Algorithm SHA256).Hash -cne $trialInputHash) {
    throw 'Signing copy hash mismatch.'
}
& $trialSignTool sign /fd SHA256 /s My /sha1 $trialCert.Thumbprint $trialSigned
if ($LASTEXITCODE -ne 0) { throw "SignTool sign returned $LASTEXITCODE." }
(Get-FileHash -LiteralPath $trialSigned -Algorithm SHA256).Hash |
    Set-Content -LiteralPath (Join-Path $trialState 'signed-sha256.txt') -Encoding ASCII
$trialCert.Thumbprint
~~~

### 3. Administrator temporarily trusts the exact public leaf

Use the thumbprint displayed by the QA console to verify the public certificate independently of the file. Record that this thumbprint was absent before placement in TrustedPeople. [Microsoft trust scope](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/security)

~~~powershell
Assert-TrialPackageClear
$signer = Read-TrialSigner
$qaThumbprint = (Read-Host 'Thumbprint displayed by the BugPocketQA console').Trim().ToUpperInvariant()
Assert-TrialPlainPath $trialPublicCer
$publicLeaf = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
    [IO.File]::ReadAllBytes($trialPublicCer))
$trustPath = "Cert:\LocalMachine\TrustedPeople\$qaThumbprint"
$trustReceipt = Join-Path $trialState 'trust-intent.json'
if ($qaThumbprint -cne $signer.Thumbprint -or $publicLeaf.Thumbprint -cne $qaThumbprint -or
    $publicLeaf.Subject -cne $trialPublisher -or $publicLeaf.HasPrivateKey -or
    (Test-Path -LiteralPath $trustPath) -or (Test-Path -LiteralPath $trustReceipt)) {
    throw 'Public leaf or its before-state failed verification.'
}
[ordered]@{ Thumbprint = $qaThumbprint; Subject = $trialPublisher; WasAbsent = $true } |
    ConvertTo-Json | Set-Content -LiteralPath $trustReceipt -Encoding UTF8
$trustStore = [Security.Cryptography.X509Certificates.X509Store]::new('TrustedPeople','LocalMachine')
try {
    $trustStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $trustStore.Add($publicLeaf)
}
finally { $trustStore.Close() }
Get-Item -LiteralPath $trustPath | Select-Object Subject,Thumbprint,NotAfter
~~~

### 4. BugPocketQA verifies the signature, preserves QA data and installs

Define the census helper in the QA console. Rerun its definition after sign-out for rollback. It records relative paths and content hashes without following links.

~~~powershell
function Get-TrialDataCensus([string]$rootPath) {
    Assert-TrialPlainPath $rootPath
    function Get-PlainChildren([string]$folder) {
        foreach ($item in Get-ChildItem -LiteralPath $folder -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Unexpected data link $($item.FullName)" }
            $relative = $item.FullName.Substring($rootPath.Length + 1)
            if ($item.PSIsContainer) {
                "D $relative"
                Get-PlainChildren $item.FullName
            } else {
                "F $((Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash) $relative"
            }
        }
    }
    Get-PlainChildren $rootPath | Sort-Object
}
~~~

Load these read-only checker definitions in the same QA console. The path rules are scoped to this pinned package. Its canonical URI escapes are %20 for a space and %40 for @. Archive names must match exactly between copies, and decoded paths must be unique under Windows case-insensitive comparison.

<!-- signing-metadata-checker:start -->
~~~powershell
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem, System.Security

function ConvertFrom-TrialEntryPath([string]$name) {
    if ($name -cnotmatch '\A(?:[A-Za-z0-9_.\[\]/-]|%20|%40)+\z') {
        throw "Noncanonical entry path: $name"
    }
    $decoded = [Uri]::UnescapeDataString($name)
    foreach ($segment in $decoded.Split('/')) {
        if (-not $segment -or $segment.StartsWith(' ') -or $segment.EndsWith(' ') -or
            $segment.EndsWith('.') -or
            $segment -match '\A(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]) *(?:\.|\z)') {
            throw "Noncanonical entry path: $name"
        }
    }
    $decoded
}

function Get-TrialZipIndex([IO.Compression.ZipArchive]$zip) {
    $entries = [Collections.Generic.Dictionary[string,IO.Compression.ZipArchiveEntry]]::new([StringComparer]::Ordinal)
    $decodedNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
        $name = ConvertFrom-TrialEntryPath $entry.FullName
        if (-not $decodedNames.Add($name)) { throw "Duplicate or aliased ZIP entry: $($entry.FullName)" }
        $entries.Add($entry.FullName, $entry)
    }
    $folders = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $decodedNames) {
        $slash = $name.LastIndexOf('/')
        while ($slash -ge 0) {
            $parent = $name.Substring(0, $slash)
            if ($decodedNames.Contains($parent)) { throw "ZIP file also used as a directory: $parent" }
            if ($folders.ContainsKey($parent)) {
                if ($folders[$parent] -cne $parent) { throw "ZIP directory casing alias: $parent" }
            } else {
                $folders.Add($parent, $parent)
            }
            $slash = $parent.LastIndexOf('/')
        }
    }
    return ,$entries
}

function Get-TrialContentTypes($entries) {
    $entryName = '[Content_Types].xml'
    if (-not $entries.ContainsKey($entryName)) { throw 'Missing [Content_Types].xml.' }
    $namespace = 'http://schemas.openxmlformats.org/package/2006/content-types'
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.IgnoreWhitespace = $true
    $settings.MaxCharactersInDocument = 1048576
    $doc = [Xml.XmlDocument]::new()
    $doc.XmlResolver = $null
    $stream = $entries[$entryName].Open()
    try {
        $reader = [Xml.XmlReader]::Create($stream, $settings)
        try { $doc.Load($reader) } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }

    $root = $doc.DocumentElement
    if ($null -eq $root -or -not [string]::Equals($root.Name, 'Types', [StringComparison]::Ordinal) -or
        -not [string]::Equals($root.NamespaceURI, $namespace, [StringComparison]::Ordinal) -or
        $root.Attributes.Count -ne 1 -or -not [string]::Equals($root.GetAttribute('xmlns'), $namespace, [StringComparison]::Ordinal)) {
        throw 'Unexpected Content_Types root or namespace.'
    }
    foreach ($node in $doc.ChildNodes) {
        if ($node -ne $root -and $node.NodeType -ne [Xml.XmlNodeType]::XmlDeclaration) {
            throw 'Unexpected Content_Types document node.'
        }
    }
    $mappings = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    $keys = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($node in $root.ChildNodes) {
        if ($node.NodeType -ne [Xml.XmlNodeType]::Element -or
            -not [string]::Equals($node.NamespaceURI, $namespace, [StringComparison]::Ordinal) -or
            $node.Attributes.Count -ne 2 -or $node.HasChildNodes) {
            throw 'Unexpected Content_Types declaration.'
        }
        $contentType = $node.GetAttribute('ContentType')
        switch -CaseSensitive ($node.Name) {
            'Default' {
                $part = $node.GetAttribute('Extension')
                if ($part -cnotmatch '\A[A-Za-z0-9]+\z') { throw 'Invalid Content_Types Extension.' }
            }
            'Override' {
                $part = $node.GetAttribute('PartName')
                if (-not $part.StartsWith('/')) { throw 'Invalid Content_Types PartName.' }
                $null = ConvertFrom-TrialEntryPath $part.Substring(1)
            }
            default { throw "Unexpected Content_Types declaration: $($node.Name)" }
        }
        $key = "$($node.Name)|$part"
        if ([string]::IsNullOrWhiteSpace($contentType) -or -not $keys.Add($key)) {
            throw "Empty or duplicate Content_Types declaration: $key"
        }
        $mappings.Add($key, $contentType)
    }
    return ,$mappings
}

function Get-TrialSigningComparison([string]$unsignedPath, [string]$signedPath) {
    $expected = [ordered]@{
        'AppxSignature.p7x' = 'application/vnd.ms-appx.signature'
        'AppxMetadata/CodeIntegrity.cat' = 'application/vnd.ms-pkiseccat'
    }
    $unsignedZip = [IO.Compression.ZipFile]::OpenRead($unsignedPath)
    $signedZip = $null
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $signedZip = [IO.Compression.ZipFile]::OpenRead($signedPath)
        $unsigned = Get-TrialZipIndex $unsignedZip
        $signed = Get-TrialZipIndex $signedZip
        foreach ($name in $expected.Keys) {
            if ($unsigned.ContainsKey($name) -or -not $signed.ContainsKey($name)) {
                throw "Expected signing entry must be new: $name"
            }
        }
        foreach ($name in $signed.Keys) {
            if (-not $unsigned.ContainsKey($name) -and $name -cnotin $expected.Keys) {
                throw "Unexpected signed ZIP entry: $name"
            }
        }
        foreach ($name in $unsigned.Keys) {
            if (-not $signed.ContainsKey($name)) { throw "Missing original ZIP entry: $name" }
        }

        $before = Get-TrialContentTypes $unsigned
        $after = Get-TrialContentTypes $signed
        foreach ($key in $before.Keys) {
            if (-not $after.ContainsKey($key) -or -not [string]::Equals($after[$key], $before[$key], [StringComparison]::Ordinal)) {
                throw "Content_Types changed or removed original declaration: $key"
            }
        }
        $additions = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
        foreach ($name in $expected.Keys) {
            $key = "Override|/$name"
            if ($before.ContainsKey($key) -or -not $after.ContainsKey($key) -or
                -not [string]::Equals($after[$key], $expected[$name], [StringComparison]::Ordinal)) {
                throw "Missing or incorrect new Content_Types override: $name"
            }
            $additions.Add($key, $expected[$name])
        }
        foreach ($key in $after.Keys) {
            if (-not $before.ContainsKey($key) -and -not $additions.ContainsKey($key)) {
                throw "Unexpected Content_Types declaration added: $key"
            }
        }

        function Get-EntryHash($entry) {
            $stream = $entry.Open()
            try { [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '') }
            finally { $stream.Dispose() }
        }
        $unsignedEntries = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
        foreach ($name in $unsigned.Keys) {
            $hash = Get-EntryHash $unsigned[$name]
            if ($name -cne '[Content_Types].xml' -and (Get-EntryHash $signed[$name]) -cne $hash) {
                throw "Signing changed original ZIP entry bytes: $name"
            }
            $unsignedEntries.Add($name, $hash)
        }
        $metadata = [Collections.Generic.Dictionary[string,byte[]]]::new([StringComparer]::Ordinal)
        foreach ($name in $expected.Keys) {
            $entry = $signed[$name]
            if ($entry.Length -lt 1 -or $entry.Length -gt 1048576) { throw "Unexpected CMS entry length: $name" }
            $buffer = [IO.MemoryStream]::new()
            try {
                $stream = $entry.Open()
                try { $stream.CopyTo($buffer) } finally { $stream.Dispose() }
                $metadata.Add($name, $buffer.ToArray())
            } finally { $buffer.Dispose() }
        }
        [pscustomobject]@{
            UnsignedEntries = $unsignedEntries
            SignedEntryCount = $signed.Count
            Metadata = $metadata
            ContentTypeCounts = @($before.Count, $after.Count)
        }
    } finally {
        $sha256.Dispose()
        if ($null -ne $signedZip) { $signedZip.Dispose() }
        $unsignedZip.Dispose()
    }
}

function Assert-TrialMetadataCms([byte[]]$bytes, [string]$entryName, [string]$thumbprint, [string]$publisher) {
    switch -CaseSensitive ($entryName) {
        'AppxSignature.p7x' {
            if ($bytes.Length -le 4 -or [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -cne 'PKCX') {
                throw "Missing PKCX prefix: $entryName"
            }
            $encoded = [byte[]]::new($bytes.Length - 4)
            [Array]::Copy($bytes, 4, $encoded, 0, $encoded.Length)
            $contentOid = '1.3.6.1.4.1.311.2.1.4'
        }
        'AppxMetadata/CodeIntegrity.cat' {
            $encoded = $bytes
            $contentOid = '1.3.6.1.4.1.311.10.1'
        }
        default { throw "Unexpected CMS entry: $entryName" }
    }
    $cms = [Security.Cryptography.Pkcs.SignedCms]::new()
    try { $cms.Decode($encoded) } catch { throw "Invalid CMS encoding: $entryName. $($_.Exception.Message)" }
    if ($cms.Detached -or $cms.ContentInfo.Content.Length -eq 0 -or
        $cms.ContentInfo.ContentType.Value -cne $contentOid -or $cms.SignerInfos.Count -ne 1) {
        throw "Unexpected CMS content type, content or signer count: $entryName"
    }
    $info = $cms.SignerInfos[0]
    $certificate = $info.Certificate
    if ($null -eq $certificate -or $certificate.Thumbprint -cne $thumbprint -or
        $certificate.Subject -cne $publisher -or $info.DigestAlgorithm.Value -cne '2.16.840.1.101.3.4.2.1') {
        throw "CMS signer or digest mismatch: $entryName"
    }
    try { $cms.CheckSignature($true) } catch { throw "CMS signature verification failed: $entryName. $($_.Exception.Message)" }
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        [ordered]@{
            Entry = $entryName
            SHA256 = [BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace('-', '')
            Thumbprint = $certificate.Thumbprint
            Subject = $certificate.Subject
            ContentTypeOID = $contentOid
            DigestAlgorithmOID = $info.DigestAlgorithm.Value
        }
    } finally { $sha256.Dispose() }
}
~~~
<!-- signing-metadata-checker:end -->

~~~powershell
Assert-QaTrialUser
Assert-TrialInput
Assert-TrialProcessesClosed
$signer = Read-TrialSigner
Assert-TrialPlainPath $trialSigned
$signedHash = (Get-FileHash -LiteralPath $trialSigned -Algorithm SHA256).Hash
if ($signedHash -cne (Get-Content -LiteralPath (Join-Path $trialState 'signed-sha256.txt') -Raw).Trim()) {
    throw 'Signed copy hash mismatch.'
}
& $trialSignTool verify /pa /v $trialSigned
if ($LASTEXITCODE -ne 0) { throw "SignTool verify returned $LASTEXITCODE." }
$signature = Get-AuthenticodeSignature -LiteralPath $trialSigned
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
    $signature.SignerCertificate.Thumbprint -cne $signer.Thumbprint -or
    $signature.SignerCertificate.Subject -cne $trialPublisher) {
    throw 'Signature or signer mismatch.'
}

$comparison = Get-TrialSigningComparison $trialUnsigned $trialSigned
$unsignedEntries = $comparison.UnsignedEntries
$verifiedMetadata = @(foreach ($name in $comparison.Metadata.Keys) {
    Assert-TrialMetadataCms $comparison.Metadata[$name] $name $signer.Thumbprint $trialPublisher
})
Assert-TrialInput
if ((Get-FileHash -LiteralPath $trialSigned -Algorithm SHA256).Hash -cne $signedHash) {
    throw 'Signed copy changed during verification.'
}
[ordered]@{
    UnsignedSHA256 = $trialInputHash
    SignedSHA256 = $signedHash
    Thumbprint = $signer.Thumbprint
    Subject = $trialPublisher
    SignToolAndAuthenticode = 'Verified'
    UnsignedEntryCount = $unsignedEntries.Count
    SignedEntryCount = $comparison.SignedEntryCount
    ContentTypeCounts = $comparison.ContentTypeCounts
    VerifiedMetadata = $verifiedMetadata
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $trialState 'signature-verification.json') -Encoding UTF8

if (Get-AppxPackage -Name $trialName) { throw 'QA already has a package registration.' }
foreach ($otherPath in @($qaBackup,$qaSynthetic) + $qaOtherData) {
    if (Test-Path -LiteralPath $otherPath) { throw "Unexpected data path $otherPath" }
}
Get-TrialDataCensus $qaData | Set-Content -LiteralPath (Join-Path $trialState 'qa-data-before.txt') -Encoding UTF8
Move-Item -LiteralPath $qaData -Destination $qaBackup
if ((Test-Path -LiteralPath $qaData) -or -not (Test-Path -LiteralPath $qaBackup -PathType Container)) {
    throw 'Original QA data preservation failed.'
}
if (Compare-Object @(Get-Content -LiteralPath (Join-Path $trialState 'qa-data-before.txt')) @(Get-TrialDataCensus $qaBackup) -CaseSensitive) {
    throw 'Saved QA data did not match its before-state census.'
}
[ordered]@{ FullName = $trialFullName; SignedSHA256 = $signedHash; Thumbprint = $signer.Thumbprint } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $trialState 'install-intent.json') -Encoding UTF8
if ((Get-FileHash -LiteralPath $trialSigned -Algorithm SHA256).Hash -cne $signedHash) {
    throw 'Signed copy changed after verification.'
}
Add-AppxPackage -Path $trialSigned
$deployed = Get-AppxPackage -Name $trialName
if ($deployed.PackageFullName -cne $trialFullName -or $deployed.PackageFamilyName -cne $trialFamily -or
    $deployed.Publisher -cne $trialPublisher -or $deployed.Status -ne 'Ok') {
    throw 'Installed identity or status mismatch.'
}
$deployed | Select-Object Name,PackageFullName,PackageFamilyName,Publisher,Version,Architecture,InstallLocation,Status |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $trialState 'installed.json') -Encoding UTF8
foreach ($entryName in $unsignedEntries.Keys | Where-Object { $_.StartsWith('app/', [StringComparison]::Ordinal) }) {
    $installedFile = Join-Path $deployed.InstallLocation ((ConvertFrom-TrialEntryPath $entryName).Replace('/','\'))
    if ((Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash -cne $unsignedEntries[$entryName]) {
        throw "Installed file mismatch $entryName"
    }
}
& "$env:SystemRoot\explorer.exe" ("shell:AppsFolder\{0}!BugPocket" -f $trialFamily)
~~~

Run the targeted cases above. After saving QA work, confirming startup opt-in, and closing the app gracefully, use the following in the interactive QA console. Sign back into BugPocketQA to observe startup. Opt out and verify the disabled state before rollback.

~~~powershell
Assert-QaTrialUser
Assert-TrialProcessesClosed
& "$env:SystemRoot\System32\shutdown.exe" /l
~~~

### 5. Rollback

After opting out and verifying normal process closure, run the shared setup and census helper in the QA console. The install receipt limits removal to the package introduced by this trial.

~~~powershell
Assert-QaTrialUser
Assert-TrialProcessesClosed
$signer = Read-TrialSigner
$intentPath = Join-Path $trialState 'install-intent.json'
$deployed = Get-AppxPackage -Name $trialName
if ($deployed) {
    $intent = Get-Content -LiteralPath $intentPath -Raw | ConvertFrom-Json
    if ($deployed.PackageFullName -cne $trialFullName -or $deployed.Publisher -cne $trialPublisher -or
        $intent.FullName -cne $trialFullName -or $intent.Thumbprint -cne $signer.Thumbprint) {
        throw 'Unexpected package. Leave it in place.'
    }
    Remove-AppxPackage -Package $trialFullName
    if (Get-AppxPackage -Name $trialName) { throw 'QA package removal is unconfirmed.' }
}
if (Test-Path -LiteralPath $qaBackup) {
    $censusPath = Join-Path $trialState 'qa-data-before.txt'
    $baseline = @(Get-Content -LiteralPath $censusPath)
    if (Compare-Object $baseline @(Get-TrialDataCensus $qaBackup) -CaseSensitive) {
        throw 'Backup census mismatch. Preserve the available copies.'
    }
    if (Test-Path -LiteralPath $qaData) {
        Assert-TrialPlainPath $qaData
        if (-not (Test-Path -LiteralPath $intentPath) -or (Test-Path -LiteralPath $qaSynthetic)) {
            throw 'Cannot attribute the replacement data safely.'
        }
        Move-Item -LiteralPath $qaData -Destination $qaSynthetic
    }
    Move-Item -LiteralPath $qaBackup -Destination $qaData
    if (Compare-Object $baseline @(Get-TrialDataCensus $qaData) -CaseSensitive) {
        throw 'Restored data census mismatch.'
    }
}
~~~

Record residual app-data paths from the trial census. A synthetic Roaming sibling may be retained for evidence. Leave any pre-existing or unverified path in place.

In the administrator console, remove the public leaf according to its before-state receipt.

~~~powershell
if (-not $trialAdmin) { throw 'Use the administrator console.' }
$signer = Read-TrialSigner
$trustReceipt = Join-Path $trialState 'trust-intent.json'
if (Test-Path -LiteralPath $trustReceipt) {
    $intent = Get-Content -LiteralPath $trustReceipt -Raw | ConvertFrom-Json
    $trustPath = "Cert:\LocalMachine\TrustedPeople\$($signer.Thumbprint)"
    if ($intent.WasAbsent -ne $true -or $intent.Thumbprint -cne $signer.Thumbprint -or
        $intent.Subject -cne $trialPublisher) { throw 'Trust receipt mismatch.' }
    if (Test-Path -LiteralPath $trustPath) {
        if ((Get-Item -LiteralPath $trustPath).Subject -cne $trialPublisher) { throw 'Unexpected trust leaf.' }
        Remove-Item -LiteralPath $trustPath
    }
    if (Test-Path -LiteralPath $trustPath) { throw 'Removal of test trust is unconfirmed.' }
}
~~~

In BugPocketQA, remove the matching new personal certificate, private key and signing files. Keep the receipts. [Certificate provider and private-key removal](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/about/about_certificate_provider?view=powershell-5.1)

~~~powershell
Assert-QaTrialUser
$signer = Read-TrialSigner
if (Test-Path -LiteralPath "Cert:\LocalMachine\TrustedPeople\$($signer.Thumbprint)") {
    throw 'First remove the device-wide test trust.'
}
$personalPath = "Cert:\CurrentUser\My\$($signer.Thumbprint)"
if (Test-Path -LiteralPath $personalPath) {
    if ((Get-Item -LiteralPath $personalPath).Subject -cne $trialPublisher) { throw 'Unexpected personal certificate.' }
    Remove-Item -LiteralPath $personalPath -DeleteKey
}
foreach ($trialFile in @($trialPublicCer,$trialSigned)) {
    if (Test-Path -LiteralPath $trialFile -PathType Leaf) {
        Assert-TrialPlainPath $trialFile
        Remove-Item -LiteralPath $trialFile
    }
}
if (Test-Path -LiteralPath $personalPath) { throw 'Removal of test certificate is unconfirmed.' }
Assert-TrialInput
~~~

The proposed changes are the QA personal certificate and key, temporary device-wide trust of its public leaf, the signing copy and receipts, Windows-managed package staging and BugPocketQA registration, temporary isolation of existing QA data, synthetic QA files, the BugPocketQA startup opt-in/out, and one BugPocketQA sign-out/in. Rollback removes the registration, signing files, new certificate/key and trust, and verifies the original QA data. Windows may retain ordinary deployment and event-log evidence.
