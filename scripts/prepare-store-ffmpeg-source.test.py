"""Host-only checks. The planning test extracts sources but never runs a build."""

import ast
import hashlib
from importlib.util import module_from_spec, spec_from_file_location
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZIP_STORED, ZipFile


SPEC = spec_from_file_location("prepare_store_ffmpeg_source", Path(__file__).with_name("prepare-store-ffmpeg-source.py"))
delivery = module_from_spec(SPEC)
SPEC.loader.exec_module(delivery)
LOCK = json.loads((delivery.ROOT / "compliance/ffmpeg-source-delivery.json").read_bytes())


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class SourceDeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        archive_base, cls.files = delivery.source_archive(delivery.ROOT, LOCK["release"])
        cls.archive_name = archive_base + ".zip"
        cls.archive = cls.files[cls.archive_name]

    def test_reproducible_locked_source_archive(self):
        self.assertEqual(self.files, delivery.source_archive(delivery.ROOT, LOCK["release"])[1])
        self.assertEqual({name: delivery.receipt(data) for name, data in self.files.items()}, LOCK["files"])
        self.assertEqual(
            self.files[self.archive_name + ".sha256"].decode(),
            f"{sha256(self.archive)}  {self.archive_name}\n",
        )
        with ZipFile(BytesIO(self.archive)) as archive:
            names = archive.namelist()
            self.assertEqual(names, sorted(set(names)))
            self.assertEqual(archive.testzip(), None)
            for entry in archive.infolist():
                self.assertEqual(entry.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(entry.compress_type, ZIP_STORED)
                self.assertNotRegex(entry.filename, r"(?i)\.(dll|exe|nupkg|cer|pfx|appx|log)$|terms-draft|trial")
            inventory = json.loads(archive.read("INVENTORY.json"))
            checksums = dict(tuple(reversed(row.split("  ", 1))) for row in archive.read("SHA256SUMS").decode().splitlines())
            self.assertEqual(inventory["release"], LOCK["release"])
            self.assertEqual(set(checksums), set(names) - {"SHA256SUMS"})
            for name, digest in checksums.items():
                self.assertEqual(sha256(archive.read(name)), digest, name)
            self.assertEqual(
                {item["path"]: item["bytes"] for item in inventory["files"]},
                {entry.filename: entry.file_size for entry in archive.infolist()
                 if entry.filename not in {"SHA256SUMS", "INVENTORY.json"}},
            )
            for item in inventory["files"]:
                self.assertEqual(item["sha256"], checksums[item["path"]], item["path"])
            for destination, original in delivery.READABLE_COPIES.items():
                self.assertEqual(self.files[destination], archive.read(original))
            source_map = json.loads(archive.read("SOURCE-MAP.json"))
            self.assertEqual(source_map["release"], LOCK["release"])
            for source in source_map["sourceArchives"].values():
                self.assertEqual(sha256(archive.read(source["path"])), source["sha256"])

    def test_retained_material_is_required_and_hash_checked(self):
        with TemporaryDirectory(prefix="bug-pocket-ffmpeg-inputs-") as scratch:
            root = Path(scratch)
            inputs = root / "materials"
            inputs.mkdir()
            (root / "compliance").mkdir()
            source_map = b"test source map"
            checksums = f"{sha256(source_map)}  SOURCE-MAP.json\n".encode()
            (root / "compliance/ffmpeg-distribution-inputs.json").write_text(json.dumps({
                "localMaterials": {
                    "path": "materials", "files": 2,
                    "checksumsSha256": sha256(checksums), "sourceMapSha256": sha256(source_map),
                },
            }))
            with self.assertRaisesRegex(FileNotFoundError, "SHA256SUMS"):
                delivery.source_inputs(root)
            (inputs / "SHA256SUMS").write_bytes(checksums)
            with self.assertRaisesRegex(FileNotFoundError, "SOURCE-MAP.json"):
                delivery.source_inputs(root)
            (inputs / "SOURCE-MAP.json").write_bytes(b"wrong")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch.*SOURCE-MAP"):
                delivery.source_inputs(root)
            (inputs / "SOURCE-MAP.json").write_bytes(source_map)
            self.assertEqual(delivery.source_inputs(root), {"SOURCE-MAP.json": source_map})
            with self.assertRaisesRegex(ValueError, "Unsafe retained input path"):
                delivery.read_pinned(inputs, "../unrelated", "unused")

    def test_refuses_different_reviewed_runtime(self):
        release = {**LOCK["release"], "ffmpegDllSha256": "0" * 64}
        with self.assertRaisesRegex(ValueError, "Release identity"):
            delivery.source_archive(delivery.ROOT, release)

    def test_recipient_recipe_extracts_and_plans_with_env_tools(self):
        with TemporaryDirectory(prefix="bug-pocket-ffmpeg-plan-") as scratch:
            root = Path(scratch)
            bundle, work, tools = root / "bundle", root / "work", root / "portable tools"
            with ZipFile(BytesIO(self.archive)) as archive:
                archive.extractall(bundle)
            recipe = bundle / "build-win-x64.py"
            ast.parse(recipe.read_bytes())
            tools.mkdir()
            for name in ("clang-cl.exe", "nasm.exe", "llvm-lib.exe", "lld-link.exe"):
                tool = tools / name
                tool.write_text("Fixture only. Planning must never execute this.")
                tool.chmod(0o755)
            env = {**os.environ, "PATH": str(tools) + os.pathsep + os.environ.get("PATH", "")}
            command = [sys.executable, "-B", str(recipe), str(work), "--prepare"]
            result = subprocess.run(command, cwd=bundle, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            plan = json.loads(result.stdout)
            self.assertEqual(len(plan["commands"]), 390)
            self.assertFalse((work / "build").exists())
            for name, tool in plan["toolPaths"].items():
                self.assertEqual(Path(tool).resolve(), tools / name)
            ffmpeg = work / "third_party/ffmpeg"
            source_map = json.loads((bundle / "SOURCE-MAP.json").read_bytes())
            for name, expected in source_map["postPatchFiles"].items():
                self.assertEqual(sha256((ffmpeg / name).read_bytes()), expected["patchedSha256"])
            definition = bundle / "interfaces/ffmpeg-ordinals.def"
            abi = json.loads((bundle / "interfaces/win-x64-abi.json").read_bytes())
            self.assertEqual(
                dict((name, int(ordinal)) for name, ordinal in
                     (row.strip().split(" @") for row in definition.read_text().splitlines()[2:])),
                abi["namedExportsAndOrdinals"],
            )
            self.assertIn(f"/DEF:{definition}", plan["commands"][-1])
            wrappers = 0
            for vector in plan["commands"][:-2]:
                compiler = Path(vector[0]).name.lower()
                source = Path(vector[-2] if compiler == "clang-cl.exe" else vector[-3])
                self.assertTrue(source.is_file(), str(source))
                if not source.name.startswith("autorename_"):
                    continue
                wrappers += 1
                if compiler == "nasm.exe":
                    self.assertIn(f"-I{work}/", vector)
                    self.assertIn(f"-I{ffmpeg / 'libavcodec'}/", vector)
                else:
                    self.assertIn(f"/I{work}", vector)
                    self.assertIn(f"/I{ffmpeg / 'libavcodec'}", vector)
            self.assertEqual(wrappers, 25)
            self.assertEqual(
                sum(len(objects) for objects in plan["responseFiles"].values()), 388
            )
            repeat = subprocess.run(command, cwd=bundle, env=env, capture_output=True, text=True)
            self.assertEqual(repeat.returncode, 2)
            self.assertIn("requires a new workspace", repeat.stderr)


if __name__ == "__main__":
    unittest.main()
