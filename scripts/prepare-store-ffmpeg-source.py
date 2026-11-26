"""Assemble the locked Store FFmpeg source archive from retained review inputs."""

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import re
from zipfile import ZIP_STORED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
MAINTAINED = ("BUILDING.md", "RECIPIENT.md", "CHANGES.md", "build-win-x64.py")
SUPERSEDED = {"SOURCE-MAP.json", "CUSTOMER-TERMS-DRAFT.md", *MAINTAINED}
READABLE_COPIES = {
    "BUILDING.txt": "BUILDING.md",
    "RECIPIENT.txt": "RECIPIENT.md",
    "COPYING.LGPL-2.1.txt": "original-notices/ffmpeg/COPYING.LGPLv2.1",
    "OPUS-COPYING.txt": "original-notices/opus/src/COPYING",
    "OPUS-LICENSE-PLEASE-READ.txt": "original-notices/opus/src/LICENSE_PLEASE_READ.txt",
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def receipt(data):
    return {"bytes": len(data), "sha256": sha256(data)}


def read_pinned(directory, name, expected):
    parts = PurePosixPath(name).parts
    if (str(PurePosixPath(name)) != name or not parts
            or not all(re.fullmatch(r"[\w.-]+", part) and part not in {".", ".."} for part in parts)):
        raise ValueError(f"Unsafe retained input path: {name}")
    current = directory
    for part in parts:
        current /= part
        if current.is_symlink() or current.is_junction():
            raise ValueError(f"Linked retained input: {name}")
    data = current.read_bytes()
    if sha256(data) != expected:
        raise ValueError(f"Retained input SHA-256 mismatch: {name}")
    return data


def source_inputs(root):
    record = json.loads((root / "compliance/ffmpeg-distribution-inputs.json").read_bytes())["localMaterials"]
    directory = root / record["path"]
    checksums = read_pinned(directory, "SHA256SUMS", record["checksumsSha256"])
    files = {}
    seen = set()
    for row in checksums.decode("utf-8").splitlines():
        digest, name = row.split("  ", 1)
        if name.casefold() in seen:
            raise ValueError(f"Duplicate retained input: {name}")
        seen.add(name.casefold())
        files[name] = read_pinned(directory, name, digest)
    if len(files) + 1 != record["files"]:
        raise ValueError("Retained input inventory count mismatch")
    if sha256(files["SOURCE-MAP.json"]) != record["sourceMapSha256"]:
        raise ValueError("Retained source map SHA-256 mismatch")
    return files


def source_archive(root, release):
    reviewed = source_inputs(root)
    source_map = json.loads(reviewed["SOURCE-MAP.json"])
    alternate = source_map["shippedAlternate"]
    if (alternate["electron"], alternate["platform"], alternate["arch"], alternate["entrySha256"]) != (
        release["electronVersion"], release["platform"], release["architecture"], release["ffmpegDllSha256"]
    ) or (release["platform"], release["architecture"]) != ("win32", "x64"):
        raise ValueError("Release identity does not match the reviewed Windows x64 FFmpeg DLL")

    files = {name: data for name, data in reviewed.items() if name not in SUPERSEDED}
    for name in MAINTAINED:
        # Normalize tracked text across Git's checkout line-ending settings.
        files[name] = (root / "compliance/ffmpeg-source" / name).read_text(encoding="utf-8").encode("utf-8")

    patch_dir = "upstream/electron/patches/ffmpeg/"
    if files[patch_dir + ".patches"].decode("utf-8").splitlines() != source_map["patchesInOrder"]:
        raise ValueError("Electron patch order does not match the reviewed source map")
    for patch in source_map["patchesInOrder"]:
        if patch_dir + patch not in files:
            raise ValueError(f"Missing Electron patch: {patch}")
    for name, patch in source_map["postPatchFiles"].items():
        if sha256(files["patch-overlay/" + name]) != patch["patchedSha256"]:
            raise ValueError(f"Overlay does not match the reviewed patch result: {name}")
    for name, record in source_map["sourceArchives"].items():
        record["path"] = "archives/" + record["path"]
        record["metadata"]["upstreamReceiptName"] = record["metadata"].pop("path")
        if receipt(files[record["path"]]) != {"bytes": record["bytes"], "sha256": record["sha256"]}:
            raise ValueError(f"Source archive does not match the reviewed revision: {name}")

    abi = json.loads(files["interfaces/win-x64-abi.json"])
    exports = abi["namedExportsAndOrdinals"]
    original_names = files["interfaces/ffmpeg.def"].decode("utf-8").splitlines()[2:]
    if (abi["machine"] != "AMD64" or abi["shippedDllSha256"] != alternate["entrySha256"]
            or len(exports) != 53 or set(exports) != {name.strip() for name in original_names}
            or sorted(exports.values()) != list(range(1, 54))):
        raise ValueError("Recorded FFmpeg exports, ordinals or DLL identity do not match")
    files["interfaces/ffmpeg-ordinals.def"] = (
        "LIBRARY ffmpeg.dll\nEXPORTS\n"
        + "".join(f"  {name} @{ordinal}\n" for name, ordinal in sorted(exports.items(), key=lambda pair: pair[1]))
    ).encode("ascii")

    source_map["status"] = "Prepared source delivery. Release access and recipient replacement remain pending."
    source_map["release"] = release
    source_map["inventory"] = "INVENTORY.json"
    source_map["remaining"] = [
        "Verify the final packaged source bytes and publisher mirror using the actual recipient routes.",
        "Confirm the separate matching application-payload route and its channel terms.",
        "Demonstrate a packaged call to a compatible modified library acquired by a recipient.",
    ]
    del source_map["files"]
    files["SOURCE-MAP.json"] = json_bytes(source_map)
    files["INVENTORY.json"] = json_bytes({
        "schemaVersion": 1,
        "release": release,
        "files": [{"path": name, **receipt(files[name])} for name in sorted(files)],
    })
    files["SHA256SUMS"] = "".join(f"{sha256(files[name])}  {name}\n" for name in sorted(files)).encode("utf-8")

    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name in sorted(files):
            entry = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            # Already-compressed upstream archives account for most of the payload.
            # Store entries without compression to avoid a zlib version dependency.
            archive.writestr(entry, files[name], compress_type=ZIP_STORED)

    basename = f'bug-pocket-{release["packageVersion"]}-win-x64-electron-{release["electronVersion"]}-ffmpeg-source'
    archive_name = basename + ".zip"
    archive_bytes = buffer.getvalue()
    return basename, {
        archive_name: archive_bytes,
        archive_name + ".sha256": f"{sha256(archive_bytes)}  {archive_name}\n".encode("ascii"),
        "SOURCE-MAP.json": files["SOURCE-MAP.json"],
        "INVENTORY.json": files["INVENTORY.json"],
        **{name: files[original] for name, original in READABLE_COPIES.items()},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, help="new output directory; defaults to the ignored release-store location")
    parser.add_argument("--candidate-lock", action="store_true", help="print candidate lock JSON without writing files")
    options = parser.parse_args()
    lock = json.loads((ROOT / "compliance/ffmpeg-source-delivery.json").read_bytes())
    try:
        if lock["schemaVersion"] != 1:
            raise ValueError("Unsupported FFmpeg source delivery lock")
        basename, files = source_archive(ROOT, lock["release"])
        receipts = {name: receipt(files[name]) for name in sorted(files)}
        if options.candidate_lock:
            print(json_bytes({**lock, "files": receipts}).decode("utf-8"), end="")
            return
        if receipts != lock["files"]:
            raise ValueError("Generated FFmpeg source differs from the reviewed lock. Review the --candidate-lock output.")
        output = options.output_dir or ROOT / "release-store/ffmpeg-source-delivery" / basename
        output.mkdir(parents=True, exist_ok=False)
        for name, data in files.items():
            with (output / name).open("xb") as file:
                file.write(data)
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))
    print(f"FFmpeg source delivery written to {output.resolve()}")
    print(f"{len(files[basename + '.zip'])} bytes, SHA-256 {receipts[basename + '.zip']['sha256']}")


if __name__ == "__main__":
    main()
