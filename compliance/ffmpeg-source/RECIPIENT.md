# FFmpeg source and licence for Bug Pocket 1.1.0.0 x64

Bug Pocket uses FFmpeg under the GNU Lesser General Public License, version 2.1 or later. Bug Pocket’s original application code is MIT licensed. See `original-notices/ffmpeg` and `original-notices/opus` for the respective licences and notices. The full candidate Chromium notices are included separately under `resources/notices/electron` in the Store app.

## Get the matching source

In the Store app, open **Help and support → FFmpeg source and licence**. Choose a destination folder. Bug Pocket saves a copy of the bundled files in a new subfolder. The installed resource folder `resources/notices/ffmpeg-source` contains the archive, checksum, this guide, LGPL and Opus licences, and source inventory. The planned additional download route is the [Bug Pocket Help page](https://bugpocket.app/help). A version-specific archive link will be added there after publication approval. The source and licence are intended to be available without sign-in, purchase proof or assent to Microsoft component terms.

Choose the entry for Bug Pocket Store `1.1.0.0` on Windows x64, with Electron `45.3.3`. Compare `Get-FileHash -Algorithm SHA256 <source-zip>` to its `.sha256` file. Extract the archive and check `SHA256SUMS` for each included file. `SOURCE-MAP.json` records the exact shipped DLL identity and corresponding source revisions. Follow `BUILDING.md` to plan and build your compatible modification. The LGPL permits modification for your own use and reverse engineering the combined work to debug those modifications.

## Matching application payload and replacement

The source archive covers FFmpeg and bundled Opus source. The separate matching application payload for local modification is pending channel and agreement approval. A public source link alone cannot supply that payload. The publisher’s unsigned AppX is the proposed input. Verify its published hash, manifest and payload comparison against the actual Store release before using it. The internal trial AppX is evidence for that trial.

Use a disposable Windows x64 VM with matching build and AppX tools, no existing registration or staged package of the same identity, and synthetic data. Work from a copy of the verified matching payload. Use the following proposed sequence in the VM.

1. Build following `BUILDING.md`. Keep the AMD64 ABI and all 53 exported names and ordinals. Record the modified source and replacement DLL hash. Check synthetic decode against known PCM.
2. Unpack the copy with `MakeAppx unpack /p <copy.appx> /d <fresh-directory> /no`. Use the application files, assets and manifest to construct the payload-only layout. Replace only `app/ffmpeg.dll`. Preserve package identity, publisher, app ID, startup declarations, capabilities and notices. Use `MakeAppx pack /d <payload-only-directory> /p <derivative.appx> /no` to regenerate package metadata. Compare the repacked payload entries before signing.
3. Use the VM’s own trusted test signing identity with a subject matching the manifest publisher, verify the signature, and install the derivative per user in the VM. Activate the app by its registered AUMID and check the process identity, loaded module path and replacement hash. Observe a direct call to a verified export with an observation method demonstrated under the relevant process restrictions. A standalone decode or loaded module proves only that check.
4. Quit the app normally and record closure. Restore the disposable VM snapshot or remove its trial package, certificate and trust. Keep the ordinary Store installation and user data on the original device.

The internal AppX experiment showed compilation with the earlier recipe, ABI and decode checks, repack, installation and exact replacement module loads. Packaged-call observation was inconclusive. The later rebuilt DLL has ABI and runtime verification pending. The recipient acquisition and replacement sequence has yet to be established for an actual Store recipient. If using a compatible modified shared library cannot be demonstrated under LGPL §6(b), the publisher will need to assess the corresponding application source or objects and relinking materials under §6(a) before release.
