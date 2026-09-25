"""Temporary branch-only transport. Removed from the final PR diff."""
import base64
import hashlib
import os
from pathlib import Path
import re
import subprocess
import zlib

BRANCH = 'codex/visual-editing-p3-20260925'
if os.environ.get('GITHUB_REPOSITORY') != 'raederhans/scenario-forge' or os.environ.get('GITHUB_REF_NAME') != BRANCH:
    raise SystemExit('Unexpected repository or branch')

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

expected_parts = ['f87c65d2cdf6043d4d38ce0d42e5b8daf32b24fc','e4710cd2bd11222db732696170723b79c244c116','2f64dc3234b796e36996dc0daa40e997fe8e3e19','bd1c8fbef4ef0a963e315edc5038434bee4229dd','8f3e915e5f17ca3da6f02820a5370b870a404c96','c86704e8d062d70c16915366537ec5324f2b0a80','8208ed6771696482ef0f6284578e218a6a5f2930','9511df489979eb2171415a46fe0d9564dd22c42e','c2d5ede43ef2d026ff33b69c6ebe3cf1915196b8','cb9ba666039d8d522b6962519cca865908156ea7','4a4843ea55a8af2ef64bb9c27bc4098425f34cfd','2974728643e8a5cb292804cb39ac76222fd3d91a']
encoded = []
for index, expected in enumerate(expected_parts, 1):
    path = f'.github/p3a.patch.part{index}'
    if git('hash-object', path) != expected:
        raise SystemExit(f'Transport chunk mismatch: {path}')
    encoded.append(Path(path).read_text())
patch = zlib.decompress(base64.b64decode(''.join(encoded), validate=True))
if hashlib.sha256(patch).hexdigest() != 'dbcc3bba037ae41739337d02e860c5d16f6f676d613536fc8cea00e19689d8a2':
    raise SystemExit('Patch checksum mismatch')
entries = []
for block in patch.decode().split('diff --git ')[1:]:
    header, _, body = block.partition('\n')
    match = re.fullmatch(r'a/(\S+) b/\1', header)
    hashes = re.search(r'^index ([0-9a-f]{40})\.\.([0-9a-f]{40})', body, re.M)
    if not match or not hashes:
        raise SystemExit('Unsupported patch entry')
    path = match[1]
    if Path(path).is_absolute() or '..' in Path(path).parts or path.startswith('.github/'):
        raise SystemExit('Out-of-scope patch path')
    entries.append((path, hashes[1], hashes[2]))
if len(entries) != 33 or len({p for p, _, _ in entries}) != 33:
    raise SystemExit('Unexpected source inventory')

def blob(path):
    return git('hash-object', path) if Path(path).exists() else '0' * 40

if all(blob(path) == after for path, _, after in entries):
    print('Source patch already applied and verified')
else:
    for path, before, _ in entries:
        if blob(path) != before:
            raise SystemExit(f'Concurrent/unexpected source change: {path}')
    output = Path('.runtime/tmp/p3a.patch')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(patch)
    subprocess.run(['git','apply','--check','--unidiff-zero',str(output)], check=True)
    subprocess.run(['git','apply','--index','--unidiff-zero',str(output)], check=True)
    for path, _, after in entries:
        if blob(path) != after:
            raise SystemExit(f'Post-image mismatch: {path}')
    if set(git('diff','--cached','--name-only').splitlines()) != {p for p, _, _ in entries}:
        raise SystemExit('Unexpected staged paths')
    subprocess.run(['git','diff','--cached','--check'], check=True)
    print(f'Applied and verified {len(entries)} source/test/documentation files')
