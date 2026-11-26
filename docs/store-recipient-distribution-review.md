# Bug Pocket Store recipient terms and source access

Review draft · 26 November 2026 · EXA-65

Examen QA's SDK acquisition and Vali Sheik's acceptance are recorded in the [Microsoft runtime rights record](store-microsoft-runtime-rights.md). The customer terms, distributor rider and access arrangement below await approval. The reviewed reference is the notice-corrected Bug Pocket 1.1.0.0 x64 AppX, SHA-256 `d46a201a3ea77fded4f6ccdbee2ba2cf11047d607ba73ea79f364daac53de471`.

## Replacement website wording

Replace both sections of the [current website terms](https://bugpocket.app/terms) in full. Use the same MIT and LGPL wording in any Store terms for the packaged release. See the separate [privacy and support drafts](store-privacy-support-drafts.md) for their own disclosures.

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

- **Distribution.** The current published App Developer Agreement v8.11 §4(b) covers Microsoft’s role as agent or commissionaire, including hosting, reproducing, signing and making the app available through the Store. The grant excludes FOSS material. Under §4(c), Examen QA remains responsible for third-party licence compliance, source availability and the rights Microsoft needs for its Store role. This agreement is the baseline for assessing Microsoft’s distribution role under SDK §2(a)(ii). [App Developer Agreement §§4(b)–(c)](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf#page=10)
- **Customer terms.** Under §4(i), Examen QA licenses the app to the customer and can supply the terms or a link for publication. The market-specific Standard Application License Terms (SALT) apply when separate terms are absent. Exhibit G ties default acceptance to download or use in its US/Canada text, which also contains application-wide reverse-engineering and transfer restrictions. Use publisher terms that expressly preserve the MIT and LGPL permissions. Check any custom terms against the applicable Microsoft Usage Rules. [App Developer Agreement §4(i) and Exhibit G](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/store/documents/legal/ada/fy26/MS.Store.ADAv8.11.US.EN.pdf)
- **Display and agreement.** Microsoft's MSIX guidance says **Additional license terms** displays a link or plain text. The Microsoft Store Terms of Sale §12 describes agreement to the software licence that accompanies the transaction. A listing preview can establish display. Verify which exact terms accompany this free MSIX listing and how they become part of the customer’s acquisition in the intended markets. Review those terms and the existing Store distribution agreement against the specific SDK §2(a)(ii) protection standard for the DLL. Consider additional agreement steps only where that review finds a concrete gap. Apply the same channel-specific check to any publisher-provided payload. [MSIX listing terms field](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information) · [Store Terms of Sale §12](https://www.microsoft.com/en-us/store/b/terms-of-sale) · [Store listing draft](store-listing-draft.md#proposed-dedicated-destinations)

## Proposed recipient access

The prepared archive matches Bug Pocket Store `1.1.0.0` on Windows x64, Electron `45.3.3` and the reviewed alternate `ffmpeg.dll`. The Store hook now checks the runtime and archive before copying the set into `app/resources/notices/ffmpeg-source/`. **Help and support → FFmpeg source and licence** copies the bundled set to a folder the recipient chooses. The proposed independent mirror is `https://bugpocket.app/help/ffmpeg/1.1.0.0/win-x64/`, reachable from the existing Help page. Serve the identical archive, licence and instructions there without sign-in, purchase proof or D3DCompiler assent. Publication approval and live verification are pending. [GNU LGPL 2.1 §§4 and 6](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.en.html)

| Release entry | Required contents |
| --- | --- |
| Version and binary identity | Store `1.1.0.0` x64 with Electron `45.3.3` and alternate DLL SHA-256 `8496b7330a9d4a14b33c791d5b1d583514f98a3cd5443385254039f5523d22dc`. Recheck against the actual release. |
| Corresponding source | `bug-pocket-1.1.0.0-win-x64-electron-45.3.3-ffmpeg-source.zip` (24,567,330 bytes), SHA-256 `841b62ad8ae22b9896488402f0bc4a6f6761298307f93a0139f681b53103f5d6`. Display the download, checksum, LGPL and Opus licences, and build and recipient instructions. The ZIP carries the exact inventory, `SOURCE-MAP.json`, pinned sources, ordered patches and overlay, build configuration and interfaces, recipe and original notices. |
| Matching application payload | The proposed separate publisher-provided unsigned AppX needs distribution approval and channel-specific agreement. Establish how a recipient obtains it and verify its separate SHA-256, manifest, identity and application payload against the actual Store release. Keep source and licence access independent of this channel. |

### Help page copy

> **FFmpeg source and licence**
>
> Bug Pocket uses FFmpeg under the GNU Lesser General Public License, version 2.1 or later. For Bug Pocket 1.1.0.0 on Windows x64 with Electron 45.3.3, download the matching FFmpeg source, checksum, licences and build instructions below. You can also save these files from the Store app under **Help and support → FFmpeg source and licence**. You can read the licences and download the source without an account or proof of purchase. The recipient guide explains the separate matching application payload and how to check a compatible modified library.

Use **Download FFmpeg source**, **SHA-256 checksum**, **LGPL 2.1 licence**, **Opus licence and notices**, **Build instructions** and **Recipient guide** as the link labels. Assign the version-specific file URLs on the publisher-controlled Help page after approval. The matching [Store listing paragraph](store-listing-draft.md#full-description) links to Help and should go live only when the links and the final packaged copy have been checked.

The [maintained build instructions](../compliance/ffmpeg-source/BUILDING.md) distinguish the earlier successful internal experiment from the new recipe’s host-only planning check. WinGet's Store package download requires Microsoft Entra ID authentication. The proposed publisher payload would let ordinary recipients attempt local replacement with the matching application files in a disposable VM. Verify acquisition and qualified agreement through that separate channel. The internal AppX install and replacement DLL loads leave the recipient acquisition and the packaged call unproven. [FFmpeg distribution record](store-ffmpeg-distribution.md#26-november-2026--version-matched-store-source-delivery) · [WinGet Store download requirements](https://learn.microsoft.com/en-us/windows/package-manager/winget/download) · [MSIX package integrity](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview#package-integrity-enforcement)

## Remaining decisions and release evidence

1. Review the replacement website copy and component terms. Identify which exact customer terms accompany the free Store release and whether the existing customer and distributor agreements meet SDK §2(a)(ii) for the DLL. Verify the copyright and Microsoft notices in the exact shipping package.
2. Approve the locked archive and the exact version-specific Help mirror URL. Verify ordinary access and SHA-256 equality, Help export from the final Store package, and the separate route to the matching application payload after those routes are authorized.
3. Demonstrate that recipients can use a compatible modified FFmpeg DLL before relying on LGPL §6(b). Reuse the completed installed startup, native loading, persistence and shortcut QA. The internal AppX experiment established build, decode, installation and module loading. The packaged-call proof was inconclusive. The later rebuilt DLL still has ABI and runtime verification pending. Debugger work remains paused. If §6(b) cannot be supported, identify the corresponding work source or objects and relinking materials for §6(a). Public distribution and Store submission remain held.
