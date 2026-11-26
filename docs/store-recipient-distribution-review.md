# Bug Pocket Store recipient terms and source access

26 November 2026 · EXA-65

Examen QA's SDK acquisition and Vali Sheik's acceptance are recorded in the [Microsoft runtime rights record](store-microsoft-runtime-rights.md). The [Store agreement review](#free-store-msix-agreement-review--26-november-2026) records the current decision. The earlier notice-corrected Bug Pocket 1.1.0.0 x64 AppX had SHA-256 `d46a201a3ea77fded4f6ccdbee2ba2cf11047d607ba73ea79f364daac53de471`. The fresh candidate is SHA-256 `1ba64e9af2a8da2c963bcf055004dbd7b701c500605096b67d001fc4186c9cc0`.

## Website wording and publication

The wording below is the original review draft for §§01 and 04 and the D3DCompiler supplement. The approved revision is live at website commit `7b4cf475668ea6919a94fab326e6810e26c66fe5`, with a versioned Help link. The live Terms and anonymous FFmpeg mirror were verified on first publication, and the live Terms were read again for this review. The Store proposal uses the same MIT and LGPL wording. [Live Terms](https://bugpocket.app/terms) · [Published revision](https://github.com/examenqa/bug-pocket-website/blob/7b4cf475668ea6919a94fab326e6810e26c66fe5/terms.html) · [Website publication in EXA-65](https://linear.app/examen-qa/issue/EXA-65/use-non-proprietary-electron-ffmpeg-and-ship-third-party-license#comment-c5619320-7c00-4ba6-9cb7-7be1d8c90b83) · [Privacy and support drafts](store-privacy-support-drafts.md)

### Section 01 — Application and third-party licences

> Bug Pocket is free and open source. Its original application code is licensed under the MIT licence. You may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of that code, including for commercial purposes. Include the copyright and permission notices in all copies or substantial portions of the code.
>
> Packaged releases include third-party components with their own licences and notices. See the third-party notices supplied with the release for those terms. The full MIT licence for Bug Pocket's original application code follows.

```text
MIT License

Copyright (c) 2026 Examen QA

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Section 04 — Lawful use and component rights

> Use Bug Pocket lawfully and capture only data you are authorized to capture. The MIT licence permits you to inspect, reverse engineer, modify, and redistribute Bug Pocket's original application code, including to make a competing product, under the licence in Section 01.
>
> Bug Pocket uses FFmpeg under the GNU Lesser General Public License, version 2.1 or later. You may modify the work for your own use and reverse engineer it to debug those modifications. See **FFmpeg source and licence** in Bug Pocket Help for the matching release’s licence, notices, corresponding source, and instructions for using a modified library.

### Microsoft D3DCompiler end-user supplement

Add this text under a distinct component heading in the customer terms.

> Microsoft’s `d3dcompiler_47.dll` is supplied as unmodified object code for use as part of Bug Pocket on Windows. Preserve its copyright, trademark and patent notices. You may keep the unchanged DLL with Bug Pocket, including in a local copy repackaged to exercise your FFmpeg rights.
>
> Distribution of a package containing the DLL must follow the applicable Microsoft permissions. The SDK permits Examen QA to authorize its distributors to supply the unmodified DLL as part of Bug Pocket as a qualifying classic Windows application, subject to the SDK conditions. Separate Microsoft licensing or applicable law may grant further rights. The MIT licence continues to govern distribution of Bug Pocket’s original application code.
>
> While using this DLL, comply with applicable export laws and its technical limits. Changes to the DLL, standalone redistribution, rental, lending, software hosting, circumvention of its technical limits, and reverse engineering of the component itself require applicable permission. Obtain Microsoft’s approval for disclosure of benchmarks of this component where its licence requires it. Preserve all notices and avoid implying Microsoft endorsement. These conditions apply solely to `d3dcompiler_47.dll`. The separate licences for Bug Pocket’s MIT code, FFmpeg, DXCompiler and other components continue to apply.
>
> Microsoft supplies the component as is, with no warranty or commitment to provide support. Where permitted by law, Microsoft excludes implied warranties of merchantability, fitness for a particular purpose, and noninfringement. Direct damages against Microsoft and its suppliers for claims concerning this component are limited to US $5, and indirect, incidental, special and consequential damages and lost profits are excluded, to the extent permitted by law. Mandatory consumer rights and statutory guarantees apply.

## D3DCompiler distributor and publisher obligations

Under SDK §2(a)(i), Examen QA can permit a distributor to include the unchanged DLL as part of the qualifying classic Windows application. Distributors and external users must agree to protections for the DLL that meet §2(a)(ii). Below is component wording for an independent distributor if its applicable agreement needs additional coverage.

> When authorized by Examen QA, you may copy and distribute the unmodified `d3dcompiler_47.dll` solely as part of the qualifying Bug Pocket classic Windows packages covered by your agreement. Supply it for use on Windows, preserve all notices, and keep the DLL within the application. Respect Microsoft’s marks and the applicable export and redistribution restrictions. Use the agreed D3DCompiler protections with any approved downstream distributor and with external users. This clause concerns only `d3dcompiler_47.dll`.

Examen QA retains its own duties under §§2(a)(ii)–(iii). The programme must add significant primary functionality and display Examen QA’s valid copyright. Preserve Microsoft’s notices and the unmodified object code. Examen QA remains responsible for the required downstream agreements and its SDK duty to indemnify, defend and hold Microsoft harmless. [Exact recorded SDK licence](../release-store/windows-sdk-acquisition-10.0.28000.2270/sdk_license.rtf) · [Microsoft REDIST list](https://learn.microsoft.com/en-us/legal/windows-sdk/redist#binaries)

## Store terms and agreement

The initial Store assessment below is retained for context. See the dated review for the verified acceptance record and current conclusion.

- **Distribution.** The current published App Developer Agreement v8.11 §4(b) covers Microsoft’s role as agent or commissionaire, including hosting, reproducing, signing and making the app available through the Store. The grant excludes FOSS material. Under §4(c), Examen QA remains responsible for third-party licence compliance, source availability and the rights Microsoft needs for its Store role. This agreement is the baseline for assessing Microsoft’s distribution role under SDK §2(a)(ii). [App Developer Agreement §§4(b)–(c)](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf#page=10)
- **Customer terms.** Under §4(i), Examen QA licenses the app to the customer and can supply the terms or a link for publication. The market-specific Standard Application License Terms (SALT) apply when separate terms are absent. Exhibit G ties default acceptance to download or use in its US/Canada text, which also contains application-wide reverse-engineering and transfer restrictions. Use publisher terms that expressly preserve the MIT and LGPL permissions. Check any custom terms against the applicable Microsoft Usage Rules. [App Developer Agreement §4(i) and Exhibit G](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf)
- **Display and agreement.** Microsoft's MSIX guidance says **Additional license terms** displays a link or plain text. The Microsoft Store Terms of Sale §12 describes agreement to the software licence that accompanies the transaction. A listing preview can establish display. Verify which exact terms accompany this free MSIX listing and how they become part of the customer’s acquisition in the intended markets. Review those terms and the existing Store distribution agreement against the specific SDK §2(a)(ii) protection standard for the DLL. Consider additional agreement steps only where that review finds a concrete gap. Apply the same channel-specific check to any publisher-provided payload. [MSIX listing terms field](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information) · [Store Terms of Sale §12](https://www.microsoft.com/en-us/store/b/terms-of-sale) · [Store listing draft](store-listing-draft.md#proposed-dedicated-destinations)

## Free Store MSIX agreement review — 26 November 2026

**One Microsoft clarification is needed.** The accepted Store agreement authorizes Microsoft to deliver Bug Pocket and provides a route for Examen QA's customer terms. It leaves open whether Microsoft's role under that agreement satisfies the distributor protection requirement in SDK §2(a)(ii) for `d3dcompiler_47.dll`.

**Accepted agreement.** Read-only Partner Center verification showed Examen QA as the Windows publisher. Account settings → Agreements records **App Developer Agreement – Windows Store, v8.11**, accepted by Vali Sheik on **3 October 2026** (displayed `10/3/2026` in the US interface). The acceptance row links to Microsoft's agreement page. The separate public v8.11 text was published **17 March 2026**, effective **17 April 2026**. The Apps and games list identifies Bug Pocket (`9MXD3L6S51ZH`) as an MSIX or PWA app with status **Not started** and markets and base price shown as `--`. The product overview did not expose a listing field during the read-only check. Free Microsoft-hosted x64 MSIX is the proposed first submission. [Partner Center agreements](https://partner.microsoft.com/en-us/dashboard/account/v3/settings/agreements) · [Account agreement documentation](https://learn.microsoft.com/en-us/partner-center/account-settings/manage-account#agreements) · [Bug Pocket Partner Center overview](https://partner.microsoft.com/en-us/dashboard/products/9MXD3L6S51ZH/overview) · [Published ADA v8.11](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf)

**Customer agreements.** ADA §§1(j), 1(y) and 4(i) cover free customers, make Examen QA the app licensor and apply market-specific Exhibit G Standard Application License Terms (SALT) if publisher terms are absent. Exhibit G (28 June 2021) assigns assent on download or use in its US/Canada text and makes acceptance a condition in its EEA text. Its default restrictions apply across the app. Sections 1, 3, 5, 7 and 10–11 address installation and use, copying and transfer, export, accompanying terms, warranty and liability. The US/Canada liability provision caps direct damages against the app publisher at the amount paid or US $1, whichever is greater. SDK §15 separately concerns Microsoft and its suppliers and uses US $5. [ADA §4(i)](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf#page=12) · [Exhibit G](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf#page=36)

**Publisher term delivery.** ADA §4(i) permits terms or a link through the listing materials and preserves the applicable Microsoft Usage Rules download and use floor. Microsoft Learn documents **Additional license terms** (single clickable URL or up to 10,000 characters of plain text). Microsoft Services Agreement §14(b)(i) and US/Canada Store Terms of Sale §12 recognize different terms provided with the app. The Usage Rules General Rules (d) make access and use subject to terms provided at acquisition, including at zero price. The Applications row covers up to 10 compatible devices and permits free app downloads on devices outside the Microsoft-account device list. The Store Terms of Sale §12 sentence on agreeing at purchase, download or install refers to purchased software licences. These sources document the normal free-app terms mechanism. A future listing preview can show presentation of the exact terms. This review has no Bug Pocket listing or acquisition evidence, and the published documents do not describe a separate assent screen requirement. [MSIX listing field, updated 24 August 2026](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information#additional-license-terms) · [MSA §14(b)(i), effective 30 September 2026](https://www.microsoft.com/en-us/servicesagreement) · [US/Canada Store Terms of Sale §12, September 2026](https://www.microsoft.com/en-us/store/b/terms-of-sale) · [Usage Rules](https://support.microsoft.com/en-us/windows/apps/usage-rules-for-digital-goods-rules)

| SDK requirement | Governing clause or mechanism | Evidence | Conclusion or gap |
| --- | --- | --- | --- |
| §2(a)(ii) Examen QA adds significant primary functionality, displays its programme copyright and indemnifies, defends and holds Microsoft harmless | SDK §§2(a)(i)–(iii) and publisher's own obligations under ADA §§4(c), 5(c) | Bug Pocket supplies its own QA capture and reporting functionality. Examen QA's SDK acceptance and the candidate's unchanged, in-app REDIST object code are recorded. | Publisher duties apply directly, including setup-program handling if applicable. Carry copyright display and notices forward to verification of the shipping package. |
| §2(a)(ii) External users agree to terms giving the DLL at least equivalent protection | ADA §4(i), Exhibit G fallback, MSIX **Additional license terms**, MSA §14(b)(i), Usage Rules General Rules (d) | Examen QA's live Terms contain a DLL-specific supplement. The field supports supplying publisher terms and the terms provided at acquisition apply even at zero price. The product is **Not started**. | Use the proposed component-scoped wording through the dedicated field for the planned listing. Product-specific customer presentation and agreement remain to be evidenced when the listing is authorized. Website presence alone supplies no evidence of their inclusion. |
| §§2(a)(i)–(iii), 7–9 and 13–15 DLL protections relevant to customers | Publisher's scoped terms preserve notices, Windows/app-only use, Microsoft permissions for distribution, export/technical limits, no support, as-is terms and Microsoft/supplier damages limits, subject to mandatory law | Published §§01 and 04 and the D3DCompiler supplement preserve MIT, LGPL modification and debugging, and separately licensed DXCompiler. The supplement lets recipients keep the unchanged DLL while locally repackaging to exercise FFmpeg rights. | The Store proposal below makes the remaining §7 wording explicit. Preserve the Usage Rules floor and access to anonymous source and licences. |
| §2(a)(ii) Distributors agree to equivalent DLL protection | ADA §§4(a)(i), 4(b)–(c), and Exhibit C §1, updated 10 September 2025, where applicable | Under the ordinary Store route Examen QA is the distributor and Microsoft acts as agent or commissionaire. Microsoft may host, reproduce, sign and deliver the package, including through multiple tiers. The §4(b) grant excludes FOSS material. Exhibit C allows Microsoft resale and sublicensing where applicable and keeps §4(i) customer licensing. The market link did not resolve to a current list. | The ADA gives Microsoft a defined Store role and places third-party compliance with Examen QA. It leaves open whether Microsoft and any applicable Store distribution tier are covered to the SDK standard. An independent distributor rider remains contingent on the answer. |

The exact SDK RTF requires distributors and external end users to agree to terms protecting the code at least as much as the SDK agreement. Sections 7–9 and 13–15 inform the scope of DLL-specific use, export, support, warranty and liability protection. SDK developer-only duties stay with Examen QA. For this Store-hosted MSIX path the separate publisher-hosted installer provisions in ADA Exhibit E are outside scope. [Exact linked SDK RTF](https://download.microsoft.com/download/0/F/F/0FF2B061-47DD-4F55-89B6-FD1D8C44F14D/sdk_license.rtf) · [ADA §4(a)](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf#page=8) · [ADA §§4(b)–(c)](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf#page=10) · [ADA Exhibit C](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf#page=28) · [Store-hosted MSIX route](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store)

### Proposed Store field and wording

For the first English MSIX listing, propose using **Additional license terms** with plain text so the scoped terms and their acceptance language appear together. Use the published application-licence and lawful-use wording and the D3DCompiler supplement above as the basis. The following is proposed Store copy to make the relevant SDK §7 protections explicit.

> By downloading or using the Bug Pocket Store package, you agree to these publisher terms for the Store package. Your rights under the MIT licence, the LGPL, other applicable component licences, the applicable Microsoft Usage Rules and mandatory law continue to apply.
>
> For `d3dcompiler_47.dll` only, follow its technical limits. Except as permitted by Microsoft or applicable law, you may use and copy the unchanged DLL only as part of Bug Pocket on Windows within your licensed Store use, including a local copy to exercise your FFmpeg rights. Keep Microsoft’s notices intact. Further copying, making the DLL available for others to copy, transfer or redistribution, rental, leasing, lending, commercial hosting, circumventing its technical limits, changing it, or reverse engineering, decompiling or disassembling it require applicable permission. Obtain Microsoft’s prior written approval before disclosing DLL benchmark results to a third party where the SDK licence requires it.

This proposal retains the supplement's export, no-endorsement, warranty, no-support and Microsoft/supplier damages provisions. It preserves independent access to FFmpeg source and licences. The live website copy is separately published. [Published D3DCompiler supplement](https://bugpocket.app/terms#d3dcompiler) · [Store listing draft](store-listing-draft.md#proposed-dedicated-destinations)

**Smallest next action.** Review the local **DRAFT—UNSENT** question for Microsoft asking whether the accepted ADA §§4(a)(i), 4(b)–(c) and applicable Exhibit C chain satisfy the distributor-agreement limb of SDK §2(a)(ii) for this unchanged DLL, assuming the publisher's §4(i) customer terms accompany the free MSIX. The draft is retained at `release-store/EXA-65-store-distributor-clarification-draft-20261126.md`. EXA-65 remains In Progress. Application distribution, Store submission and debugger work remain held.

## Proposed recipient access

The prepared archive matches Bug Pocket Store `1.1.0.0` on Windows x64, Electron `45.3.3` and the reviewed alternate `ffmpeg.dll`. The Store hook now checks the runtime and archive before copying the set into `app/resources/notices/ffmpeg-source/`. **Help and support → FFmpeg source and licence** copies the bundled set to a folder the recipient chooses. The [independent mirror](https://bugpocket.app/help/ffmpeg/1.1.0.0/win-x64/) serves the identical archive, licences and instructions without sign-in, purchase proof or D3DCompiler assent. First-publication verification recorded anonymous HTTP 200 and matching hashes for all nine files. [GNU LGPL 2.1 §§4 and 6](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.en.html)

| Release entry | Required contents |
| --- | --- |
| Version and binary identity | Store `1.1.0.0` x64 with Electron `45.3.3` and alternate DLL SHA-256 `8496b7330a9d4a14b33c791d5b1d583514f98a3cd5443385254039f5523d22dc`. Recheck against the actual release. |
| Corresponding source | `bug-pocket-1.1.0.0-win-x64-electron-45.3.3-ffmpeg-source.zip` (24,567,330 bytes), SHA-256 `841b62ad8ae22b9896488402f0bc4a6f6761298307f93a0139f681b53103f5d6`. Display the download, checksum, LGPL and Opus licences, and build and recipient instructions. The ZIP carries the exact inventory, `SOURCE-MAP.json`, pinned sources, ordered patches and overlay, build configuration and interfaces, recipe and original notices. |
| Matching application payload | The proposed separate publisher-provided unsigned AppX needs distribution approval and channel-specific agreement. Establish how a recipient obtains it and verify its separate SHA-256, manifest, identity and application payload against the actual Store release. Keep source and licence access independent of this channel. |

### Help page copy

> **FFmpeg source and licence**
>
> Bug Pocket uses FFmpeg under the GNU Lesser General Public License, version 2.1 or later. For Bug Pocket 1.1.0.0 on Windows x64 with Electron 45.3.3, download the matching FFmpeg source, checksum, licences and build instructions below. You can also save these files from the Store app under **Help and support → FFmpeg source and licence**. You can read the licences and download the source without an account or proof of purchase. The recipient guide explains the separate matching application payload and how to check a compatible modified library.

Use **Download FFmpeg source**, **SHA-256 checksum**, **LGPL 2.1 licence**, **Opus licence and notices**, **Build instructions** and **Recipient guide** as the link labels. The published Help page uses version-specific file URLs. The matching [Store listing paragraph](store-listing-draft.md#full-description) links to Help and should go live only when the links and the final packaged copy have been checked.

The [maintained build instructions](../compliance/ffmpeg-source/BUILDING.md) distinguish the earlier successful internal experiment from the new recipe’s host-only planning check. WinGet's Store package download requires Microsoft Entra ID authentication. The proposed publisher payload would let ordinary recipients attempt local replacement with the matching application files in a disposable VM. Verify acquisition and qualified agreement through that separate channel. The internal AppX install and replacement DLL loads leave the recipient acquisition and the packaged call unproven. [FFmpeg distribution record](store-ffmpeg-distribution.md#26-november-2026--version-matched-store-source-delivery) · [WinGet Store download requirements](https://learn.microsoft.com/en-us/windows/package-manager/winget/download) · [MSIX package integrity](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview#package-integrity-enforcement)

## Remaining decisions and release evidence

1. Review the unsent Microsoft question on the distributor-agreement requirement. When listing work is authorized, record the final Additional license terms and evidence that they accompany the free acquisition. Verify the copyright and Microsoft notices in the exact shipping package.
2. Carry forward the verified anonymous mirror and the fresh candidate's [installed Help export](store-ffmpeg-distribution.md#26-november-2026--bundled-source-export-validated), including cancellation, two matching exports, normal process exit and full rollback. Verify the separate route to the matching application payload when authorized and confirm release delivery against the final package.
3. Demonstrate that recipients can use a compatible modified FFmpeg DLL before relying on LGPL §6(b). Reuse the completed installed startup, native loading, persistence and shortcut QA. The internal AppX experiment established build, decode, installation and module loading. The packaged-call proof was inconclusive. The later rebuilt DLL still has ABI and runtime verification pending. Debugger work remains paused. If §6(b) cannot be supported, identify the corresponding work source or objects and relinking materials for §6(a). Public distribution and Store submission remain held.
