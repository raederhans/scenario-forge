"""Temporary task-branch-only delivery helper; removed before the PR diff."""
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
patch = zlib.decompress(base64.b64decode(Path('.github/p3-review.patch.b64').read_text(), validate=True))
if hashlib.sha256(patch).hexdigest() != '8fbeb6e78d5fa69d7c709047d4b5946cf51ea3622abc43ca063ee004f8cecfa2':
    raise SystemExit('Patch checksum mismatch')
entries=[]
for block in patch.decode().split('diff --git ')[1:]:
    header, _, body = block.partition('\n')
    match = re.fullmatch(r'a/(\S+) b/\1', header)
    hashes = re.search(r'^index ([a-f0-9]{40})\.\.([a-f0-9]{40})', body, re.M)
    if not match or not hashes:
        raise SystemExit('Unsupported patch entry')
    path = match[1]
    if Path(path).is_absolute() or '..' in Path(path).parts or path.startswith('.github/'):
        raise SystemExit('Out-of-scope patch path')
    entries.append((path, hashes[1], hashes[2]))
if len(entries) != 8 or len({p for p,_,_ in entries}) != 8:
    raise SystemExit('Unexpected source inventory')

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

def blob(path):
    return git('hash-object', path) if Path(path).exists() else '0'*40

if not all(blob(path) == after for path,_,after in entries):
    for path,before,_ in entries:
        if blob(path) != before:
            raise SystemExit(f'Refusing concurrent or unexpected change: {path}')
    out=Path('.runtime/tmp/p3-review.patch'); out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(patch)
    subprocess.run(['git','apply','--check','--unidiff-zero',str(out)],check=True)
    subprocess.run(['git','apply','--index','--unidiff-zero',str(out)],check=True)
    for path,_,after in entries:
        if blob(path) != after:
            raise SystemExit(f'Post-image mismatch: {path}')
    if set(git('diff','--cached','--name-only').splitlines()) != {p for p,_,_ in entries}:
        raise SystemExit('Unexpected staged paths')
    subprocess.run(['git','diff','--cached','--check'],check=True)
print('Verified all eight continuation post-images')
