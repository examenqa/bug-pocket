# Store trial: Microsoft runtime redistribution

25 November 2026. Follow-up to the completed seven-item review in `compliance/README.md`; no new general audit or final licensing clearance. This disposition covers the original unsigned x64 AppX, SHA-256 `f286068168eb93422afa5171199f6499167832b7f9610fbc60144023ee105ca1`. Reuse it for a successor only after matching these DLL and notice bytes.

## Exact shipped inputs

The retained `release-store/trial-20261125-x64/evidence/content-inspection.json` verifies both files against the official Electron 45.3.3 win32-x64 distribution, asset `748614127`, archive SHA-256 `49dd2d3875944f08de03d34595cd30093c588b9edcabb41a0ac481028a3a5a8a`. Their bytes were not replaced by Bug Pocket. Additional in-memory ZIP/string inspection on this date read version resources without loading either DLL; the compact receipt is [store-microsoft-runtime-20261125.json](evidence/store-microsoft-runtime-20261125.json).

| Packaged file | Version and resource identity | Bytes | SHA-256 | Applicable route |
| --- | --- | ---: | --- | --- |
| `app/d3dcompiler_47.dll` | `10.0.28000.2270`; `Direct3D HLSL Compiler for Redistribution`; Microsoft Corporation | 4,753,864 | `f5c95e919b4ffa1ac71049cd45b9f986d2965e6888395ca2806337985334fa56` | Proprietary Windows SDK Distributable Code, subject to the qualifying SDK grant and conditions below. |
| `app/dxcompiler.dll` | `1.9.2609.0`; `DirectX Compiler - Google Dawn Custom Build`; Microsoft(r) Corporation | 25,779,712 | `d4dc0f6bd47938e86f0e1b8006236e18393532702ee9e48cffce09c83872692a` | Open-source DXC/LLVM notices supplied with the custom Dawn build; do not describe this file as an unidentified proprietary SDK runtime. |

The payload inventory has no standalone `dxil.dll`, `d3dcsx_47.dll`, `vcruntime*.dll`, `msvcp*.dll`, or UCRT DLLs. Other shipped root DLLs are Electron's WER helper, FFmpeg, SwiftShader and the Vulkan loader. Windows system DLL imports and build-host SDK/compiler tools are not copies redistributed by this AppX. The inventory does not make a separate claim about static compiler-runtime code.

## D3DCompiler: existing redistribution grant, narrow outstanding evidence

Microsoft's current [Windows SDK REDIST list](https://learn.microsoft.com/en-us/legal/windows-sdk/redist#binaries) expressly lists `Redist/D3D/x64/d3dcompiler_47.dll` for unmodified redistribution with Classic Windows applications, subject to a validly licensed SDK and its terms. Its exclusion concerns Universal Windows apps. This package's `Windows.FullTrustApplication` entry point represents a packaged classic app, as explained by the [manifest activation schema](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-application#combinations-of-activation-info-attributes). Store delivery alone does not make it a UWP app.

The [Microsoft-published SDK licence, section 2(a)](https://github.com/microsoft/win32metadata/blob/main/licenses/sdk_license.txt) supplies the Distributable Code grant. Its conditions include adding significant primary functionality; preserving required notices; Windows-only distribution; restrictions on altering setup code; distributor/end-user protective terms; a valid application copyright notice; and publisher responsibility/indemnity. Review the actual applicable licence before release. Do not apply Microsoft-specific restrictions across FFmpeg or other separately licensed code.

**Outstanding before external distribution:** retain the publisher's qualifying SDK licence/version and acceptance record, and establish the SDK origin/redistribution grant for the exact `10.0.28000.2270` bytes inherited from Electron. The locally installed SDK is `10.0.26100.0`; its D3DCompiler is 4,741,464 bytes and differs from the shipped file. It is evidence that an SDK is installed, not a byte match or proof of rights to the shipped revision. Record publisher acceptance of the applicable distributor conditions and component-scoped recipient terms. The SDK source/build mapping for Electron's exact file has not been obtained here.

This is a documented proprietary redistributable route with an entitlement/evidence gap. No royalty charge or need for separately negotiated permission has been established. Do not remove or swap the working DLL to resolve a paperwork gap.

## DXCompiler: custom open-source build

The shipped file's custom Dawn version resource and exact Electron archive match identify its immediate provenance. The upstream [DXC 1.9.2609 README](https://github.com/microsoft/DirectXShaderCompiler/blob/v1.9.2609/README.md) describes the compiler library; its [licence](https://github.com/microsoft/DirectXShaderCompiler/blob/v1.9.2609/LICENSE.TXT) permits redistribution under the University of Illinois/NCSA terms, with additional included third-party notices. Preserve applicable copyright, conditions, disclaimers and non-endorsement terms. The version tag is a licence reference, not proof that Google's custom build is byte-for-byte that tagged source.

The actual `app/LICENSES.chromium.html` already contains the complete `DirectX-Shader-Compiler` notice section, beginning with the LLVM/NCSA licence and associated third-party text. The full corpus is 5,705,935 bytes, SHA-256 `7dac8267ac6da8d959cfe88f5f055b18a397f10230380b5329125e167bf5639b`; the packaged `app/resources/notices/electron/LICENSES.chromium.html` is identical. The decoded DXC `<pre>` section is 29,842 UTF-8 bytes, SHA-256 `05f32c081b3c75cd2cc2a0655b571ba94ebcfc64e9ccca6e5a9e36d6cb67e540` (decoded HTML entities, original CRLF retained). Keep the whole corpus rather than substituting the short SPDX name.

The exact Dawn/DXC source commit and build receipt behind this custom DLL have not been independently recovered in this follow-up. Attempts to retrieve the pinned Chromium source through the available web/GitHub tools failed; the artifact does not embed a recoverable 40-character source revision. Immediate binary provenance and included licence evidence are established; a custom-source reconstruction is not claimed. NCSA does not require a corresponding-source offer or recipient relinking route. No separate commercial or royalty grant has been established as necessary for these bytes.

## Decision and next action

Retain both DLLs and the existing runtime corpus. The current evidence identifies **no shipped Microsoft DLL requiring separately negotiated permission**. Proprietary status alone is not such a finding. Separately negotiated rights would become a blocker only if the publisher cannot establish a qualifying existing grant for the actual file or proposes a component/use outside it.

The separately authorized installed retry recorded ordinary-user access to the Electron and Chromium notices. Before external sharing or Store submission, close the D3DCompiler entitlement, SDK version and downstream-terms record. A replacement would affect Chromium's shader/GPU paths and require a matching Electron/ANGLE/Dawn build plus renderer, capture, annotation, image-export and GPU/fallback validation. No replacement is justified or implemented by this evidence, and no licence purchase or organization contact occurred.
