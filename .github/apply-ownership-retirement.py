"""Temporary branch-only delivery helper. Removed before the final PR diff."""
import base64
import hashlib
import os
from pathlib import Path
import re
import subprocess
import zlib

BRANCH = "codex/visual-editing-boundary-p1-p2-20260924"
EXPECTED = "7c774c77ca987a1a1b49044d475f12db1eed738acbbe41736cfb274a7c953e12"
if os.environ.get("GITHUB_REPOSITORY") != "raederhans/scenario-forge":
    raise SystemExit("Unexpected repository")
if os.environ.get("GITHUB_REF_NAME") != BRANCH:
    raise SystemExit("Unexpected branch")
encoded = "".join(Path(f".github/ownership-retirement.patch.part{i}").read_text().strip() for i in (1, 2))
patch = zlib.decompress(base64.b64decode(encoded, validate=True))
if hashlib.sha256(patch).hexdigest() != EXPECTED:
    raise SystemExit("Patch checksum mismatch")
entries = []
for block in patch.decode("utf-8").split("diff --git ")[1:]:
    header, _, body = block.partition("\n")
    match = re.fullmatch(r"a/([^\s]+) b/([^\s]+)", header)
    hashes = re.search(r"^index ([0-9a-f]{40})\.\.([0-9a-f]{40})", body, re.M)
    if not match or not hashes or match[1] != match[2]:
        raise SystemExit("Unsupported patch entry")
    path = match[1]
    if Path(path).is_absolute() or ".." in Path(path).parts or path.startswith(".github/"):
        raise SystemExit("Out-of-scope patch path")
    entries.append((path, hashes[1], hashes[2]))
if len(entries) != 39 or len({path for path, _, _ in entries}) != 39:
    raise SystemExit("Unexpected patch inventory")

def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()

def blob(path):
    return git("hash-object", "--", path) if Path(path).exists() else "0" * 40

if all(blob(path) == after for path, _, after in entries):
    print("Source patch already applied and verified")
    raise SystemExit(0)
for path, before, _ in entries:
    if blob(path) != before:
        raise SystemExit(f"Refusing concurrent/unexpected source changes: {path}")
output = Path(".runtime/tmp/ownership-retirement.patch")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(patch)
subprocess.run(["git", "apply", "--check", "--unidiff-zero", str(output)], check=True)
subprocess.run(["git", "apply", "--index", "--unidiff-zero", str(output)], check=True)
for path, _, after in entries:
    if blob(path) != after:
        raise SystemExit(f"Post-image verification failed: {path}")
if set(git("diff", "--cached", "--name-only").splitlines()) != {path for path, _, _ in entries}:
    raise SystemExit("Unexpected staged file")
subprocess.run(["git", "diff", "--cached", "--check"], check=True)
print(f"Applied and verified {len(entries)} source/test/documentation files")
