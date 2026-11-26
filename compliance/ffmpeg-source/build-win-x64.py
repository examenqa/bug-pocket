"""Prepare and plan a library-only Windows x64 FFmpeg build.

Use --prepare to extract the verified originals and apply Electron's recorded
overlay. The default prints a plan. --execute invokes the developer-shell tools.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

bundle = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("scratch", type=Path, help="fresh or previously prepared workspace")
parser.add_argument("--prepare", action="store_true", help="prepare a fresh workspace from the bundled sources")
parser.add_argument("--execute", action="store_true", help="run the planned library-only build")
options = parser.parse_args()
scratch = options.scratch.resolve()
ffmpeg = scratch / "third_party/ffmpeg"
opus = scratch / "third_party/opus"
out = scratch / "build"
files = json.loads((bundle / "interfaces/win-x64-sources.json").read_bytes())
source_map = json.loads((bundle / "SOURCE-MAP.json").read_bytes())
config = ffmpeg / files["configPrefix"]
definition = bundle / "interfaces/ffmpeg-ordinals.def"
tools = {}
for name in ("clang-cl.exe", "nasm.exe", "llvm-lib.exe", "lld-link.exe"):
    executable = shutil.which(name)
    tools[name] = str(Path(executable).resolve()) if executable else None

def check_hash(file, expected):
    if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
        raise ValueError(f"SHA-256 mismatch: {file}")

def prepare_sources():
    archives = source_map["sourceArchives"]
    sources = [
        (ffmpeg, bundle / archives["ffmpeg"]["path"], archives["ffmpeg"]["sha256"]),
        (opus, bundle / archives["chromium-opus"]["path"], archives["chromium-opus"]["sha256"]),
    ]
    for _, archive_path, sha256 in sources:
        check_hash(archive_path, sha256)
    for name, hashes in source_map["postPatchFiles"].items():
        check_hash(bundle / "patch-overlay" / name, hashes["patchedSha256"])
    scratch.mkdir()
    for destination, archive_path, _ in sources:
        destination.mkdir(parents=True)
        with tarfile.open(archive_path, "r:gz") as archive:
            archive.extractall(destination, filter="data")
    for name, hashes in source_map["postPatchFiles"].items():
        target = ffmpeg / name
        check_hash(target, hashes["baseSha256"])
        shutil.copyfile(bundle / "patch-overlay" / name, target)

if options.execute:
    if sys.platform != "win32" or os.environ.get("VSCMD_ARG_TGT_ARCH", "").lower() not in {"x64", "amd64"}:
        parser.error("execute from an existing Windows x64 Visual Studio developer shell")
    if not os.environ.get("INCLUDE") or not os.environ.get("LIB"):
        parser.error("the developer shell must have SDK include and import-library paths")
    for name, tool_path in tools.items():
        if not tool_path:
            parser.error(f"tool unavailable on the developer shell PATH: {name}")

if options.prepare:
    if scratch.exists():
        parser.error(f"--prepare requires a new workspace: {scratch}")
    prepare_sources()

commands = []
object_lists = {"ffmpeg": [], "opus": []}
sources = []

def compile_group(group, compiler, args, root, paths):
    for relative in paths:
        source = root / relative
        target = (out / group / relative).with_suffix(Path(relative).suffix + ".obj")
        prefix = "/Fo" if compiler == "clang-cl.exe" else "-o"
        wrapper_includes = []
        if group == "ffmpeg" and source.name.startswith("autorename_"):
            if compiler == "clang-cl.exe":
                wrapper_includes = ["/I" + str(scratch), "/I" + str(ffmpeg / "libavcodec")]
            else:
                wrapper_includes = ["-I" + str(scratch) + "/", "-I" + str(ffmpeg / "libavcodec") + "/"]
        argv = [tools[compiler] or compiler, *args, *wrapper_includes, source]
        argv += [prefix + str(target)] if compiler == "clang-cl.exe" else [prefix, target]
        commands.append([str(arg) for arg in argv])
        object_lists["opus" if group.startswith("opus") else "ffmpeg"].append(target)
        sources.append(source)

common = [
    "--target=x86_64-pc-windows-msvc", "/nologo", "/c", "/TC", "/O2", "/MT", "/Gy", "/Gw",
    "/DNDEBUG", "/DWIN32_LEAN_AND_MEAN", "/DNOMINMAX",
    "/D_CRT_SECURE_NO_WARNINGS", "/D_CRT_NONSTDC_NO_DEPRECATE",
    "/clang:-fno-strict-aliasing",
]
ffmpeg_args = [
    *common,
    "/DHAVE_AV_CONFIG_H", "/D_POSIX_C_SOURCE=200112", "/D_XOPEN_SOURCE=600",
    "/D_ISOC99_SOURCE", "/D_LARGEFILE_SOURCE", "/DPIC", "/DFFMPEG_CONFIGURATION=NULL",
    "/DCHROMIUM_NO_LOGGING",
    "/FI" + str(ffmpeg / "compat/msvcrt/snprintf.h"),
    "/FI" + str(ffmpeg / "compat/msvcrt/strtod.h"),
    "/I" + str(config), "/I" + str(ffmpeg), "/I" + str(opus / "src/include"),
    "/I" + str(bundle / "upstream/chromium"), "/I" + str(bundle / "interfaces"),
    "/clang:-Wno-incompatible-pointer-types", "/clang:-Wno-inconsistent-dllimport",
]
compile_group("ffmpeg", "clang-cl.exe", ffmpeg_args, ffmpeg, files["ffmpeg"]["c"])
nasm_args = [
    "-fwin64", "-DPIC", "-DARCH_X86_64", "-W+error=all", "-Wno-macro-params-legacy",
    "-P" + str(config / "config.asm"),
    *("-I" + str(p) + "/" for p in [config, ffmpeg / "libavcodec/x86", ffmpeg / "libavutil/x86", ffmpeg]),
]
compile_group("ffmpeg", "nasm.exe", nasm_args, ffmpeg, files["ffmpeg"]["asm"])

opus_defines = [
    "OPUS_BUILD", "OPUS_EXPORT=", "ENABLE_HARDENING", "USE_ALLOCA", "HAVE_ALLOCA_H",
    "inline=__inline", "CHROMIUM_NO_LOGGING", "OPUS_HAVE_RTCD", "CPU_INFO_BY_ASM",
    "OPUS_X86_MAY_HAVE_SSE", "OPUS_X86_MAY_HAVE_SSE2", "OPUS_X86_PRESUME_SSE",
    "OPUS_X86_PRESUME_SSE2", "OPUS_X86_MAY_HAVE_SSE4_1", "OPUS_X86_MAY_HAVE_AVX2",
]
opus_args = [
    *common, *("/D" + flag for flag in opus_defines),
    *("/I" + str(opus / p) for p in ["src", "src/celt", "src/silk", "src/silk/fixed", "src/silk/float", "src/include"]),
]
for group, flags in (
    ("base", []), ("sse41", ["/clang:-msse4.1"]),
    ("avx2", ["/clang:-mavx", "/clang:-mfma", "/clang:-mavx2"]),
):
    compile_group("opus-" + group, "clang-cl.exe", [*opus_args, *flags], opus, files["opus"][group])

opus_library = out / "opus.lib"
commands.append([tools["llvm-lib.exe"] or "llvm-lib.exe", "/OUT:" + str(opus_library), "@" + str(out / "opus.rsp")])
commands.append([
    tools["lld-link.exe"] or "lld-link.exe", "/DLL", "/MACHINE:X64", "/OPT:REF", "/OPT:ICF",
    "/DEF:" + str(definition),
    "/OUT:" + str(out / "ffmpeg.dll"), "/IMPLIB:" + str(out / "ffmpeg.lib"),
    "@" + str(out / "ffmpeg.rsp"), str(opus_library), "kernel32.lib",
])

for source in [*sources, definition]:
    if not source.is_file():
        parser.error(f"input unavailable: {source}. Use --prepare for a new source workspace.")

if not options.execute:
    print(json.dumps({
        "toolPaths": tools,
        "commands": commands,
        "responseFiles": {group: [str(obj) for obj in objects] for group, objects in object_lists.items()},
    }, indent=2))
    sys.exit(0)

out.mkdir(exist_ok=False)
for group, objects in object_lists.items():
    for obj in objects:
        obj.parent.mkdir(parents=True, exist_ok=True)
    (out / (group + ".rsp")).write_text(
        "\n".join(subprocess.list2cmdline([str(obj)]) for obj in objects) + "\n",
        encoding="utf-8",
    )
for command in commands:
    subprocess.run(command, check=True, cwd=scratch)
print(out / "ffmpeg.dll")
