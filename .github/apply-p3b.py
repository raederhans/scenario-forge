"""Temporary branch-only delivery helper; removed from the final PR diff."""
import base64, hashlib, json, os, re, subprocess, zlib
from pathlib import Path
BRANCH='codex/paint-contours-p3b-20260925'
if os.environ.get('GITHUB_REPOSITORY')!='raederhans/scenario-forge' or os.environ.get('GITHUB_REF_NAME')!=BRANCH:
    raise SystemExit('Unexpected repository/branch')
patch=zlib.decompress(base64.b64decode(''.join(Path(f'.github/p3b.patch.part{i}').read_text().strip() for i in (1,2,3)),validate=True))
if hashlib.sha256(patch).hexdigest()!='fd20b0b0c2f776bd6e41fa6330d3d17a8e13fada03d83716a8d19083170f0548':
    raise SystemExit('Patch checksum mismatch')
def git(*args): return subprocess.check_output(['git',*args],text=True).strip()
def blob(path): return git('hash-object',path) if Path(path).exists() else '0'*40
entries=[]
for block in patch.decode().split('diff --git ')[1:]:
    header,_,body=block.partition('\n')
    m=re.fullmatch(r'a/(\S+) b/\1',header)
    hashes=re.search(r'^index ([a-f0-9]{40})\.\.([a-f0-9]{40})',body,re.M)
    if not m or not hashes: raise SystemExit('Unsupported patch format')
    path=m[1]
    if Path(path).is_absolute() or '..' in Path(path).parts or path.startswith('.github/'):
        raise SystemExit('Invalid source path')
    entries.append((path,hashes[1],hashes[2]))
if len(entries)!=22: raise SystemExit('Unexpected patch count')
if not all(blob(p)==after for p,_,after in entries):
    for p,before,_ in entries:
        if blob(p)!=before: raise SystemExit(f'Concurrent/unexpected source change: {p}')
    out=Path('.runtime/tmp/p3b.patch');out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(patch)
    subprocess.run(['git','apply','--check','--unidiff-zero',str(out)],check=True)
    subprocess.run(['git','apply','--index','--unidiff-zero',str(out)],check=True)
    for p,_,after in entries:
        if blob(p)!=after: raise SystemExit(f'Postimage mismatch: {p}')
package=Path('package.json')
if blob('package.json')!='e67d3648c195838da2b493be01e9efa7ce6c7e05':
    if blob('package.json')!='3d854c815cffe0cf359e9bf792f6fa34a0d752e1': raise SystemExit('Unexpected package preimage')
    data=json.loads(package.read_text());data['scripts']['test:node:ownership-retirement']+=' tests/paint_contour_graph_behavior.test.mjs tests/paint_contour_runtime_behavior.test.mjs tests/render_pass_signature_policy_behavior.test.mjs'
    package.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    if blob('package.json')!='e67d3648c195838da2b493be01e9efa7ce6c7e05': raise SystemExit('Package postimage mismatch')
    subprocess.run(['git','add','package.json'],check=True)
allowed={p for p,_,_ in entries}|{'package.json'}
if not set(git('diff','--cached','--name-only').splitlines()).issubset(allowed): raise SystemExit('Unexpected staged source')
subprocess.run(['git','diff','--cached','--check'],check=True)
print('Verified P3B source and script registration')
