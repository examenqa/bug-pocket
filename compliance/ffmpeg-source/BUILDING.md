# Build the Windows x64 FFmpeg library

This source set matches the alternate FFmpeg DLL for Bug Pocket Store 1.1.0.0 x64 and Electron 45.3.3. `SOURCE-MAP.json` records the shipped DLL hash, source revisions and ordered patches. Verify the ZIP against its companion `.sha256` file and verify the extracted entries against `SHA256SUMS` before building.

## Prepare and inspect

Extract the source ZIP into a regular directory. Open a Windows x64 Visual Studio developer shell. Use Python 3.12 or later and have `clang-cl.exe`, `llvm-lib.exe`, `lld-link.exe` and `nasm.exe` available on that shell’s `PATH`. The shell provides `INCLUDE` and `LIB` for the x64 MSVC and Windows SDK headers and libraries. The recipe resolves tool paths from that environment. The earlier build used LLVM 23.1.6, NASM 3.02, MSVC 14.44.35207 and SDK 10.0.26100.0. Keep a few GiB free for extraction, objects and the DLL. Toolchain downloads and SDK licences are separate from this source archive.

From the extracted source ZIP directory run the following. Choose a workspace name that does not already exist.

```powershell
$ffmpegWork = Join-Path $env:TEMP 'bug-pocket-1.1.0.0-ffmpeg-work'
python .\build-win-x64.py $ffmpegWork --prepare > .\build-plan.json
```

`--prepare` checks the original archive hashes, checks the overlay, extracts it into the Chromium-style `third_party/ffmpeg` and `third_party/opus` layout, then applies the verified post-patch files. Those files are the result of the four Electron patches listed in `SOURCE-MAP.json` in their original order. If applying the included patches yourself, begin with the unpatched archive and use that order on a separate tree. The preserved GN and generation inputs document the selected Windows x64 configuration.

Planning checks that all selected sources exist and emits the tool paths, command vectors and response-file contents without executing tools. The generated wrappers use the Chromium root and wrapper-specific `libavcodec` include paths. The linker definition assigns all 53 export names their recorded ordinals.

## Build and verify

Use the same shell and prepared workspace. Make your compatible source modification in the prepared tree before invoking the build.

```powershell
python .\build-win-x64.py $ffmpegWork --execute
```

The recipe writes `build/ffmpeg.dll` in that workspace. Use a fresh workspace for another build. Check AMD64, all 53 export names and ordinals and the expected `KERNEL32.dll` dependency against `interfaces/win-x64-abi.json`. For example, run `llvm-readobj --file-headers --coff-exports --coff-imports <path-to-ffmpeg.dll>` and `Get-FileHash -Algorithm SHA256 <path-to-ffmpeg.dll>`. Record the DLL hash and use a synthetic Opus decode with known PCM output to check behavior before attempting a packaged replacement. See `RECIPIENT.md` for the separate replacement validation.

## Verification boundary

The earlier internal build used equivalent commands with a scratch wrapper layout and explicit export ordinals. It passed the AMD64 ABI comparison and decoded a reference 203-byte Opus frame into 960 mono 48 kHz PCM samples with zero differences. The packaged renderers loaded its DLL. A call to the replacement export inside those renderers remains unproven. This maintained recipe was checked by extracting the reviewed inputs and generating the command plan. Executing the maintained recipe, producing a byte-identical copy of the original binary, and recipient operation of a modified library are outside that check. See `CHANGES.md` for the source and recipe history.
