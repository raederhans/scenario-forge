"""Pinned copies of the main-repository files that HGO tools read.

HGO is maintained independently of the main application. Its builders and
tests read these snapshots, never the live main-repository data, so main data
changes cannot alter HGO outputs or break its checks. tools/sync_main_sources.py
refreshes the snapshots explicitly and reports what changed.

Snapshots keep the original path as their key. A "copy" snapshot stores the
original bytes, so builds and provenance hashes are unchanged; a "properties"
snapshot keeps every GeoJSON feature but only its properties.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

SNAPSHOT_DIR = 'apps/hgo/assets/sources/main'
MANIFEST_NAME = 'manifest.json'


def _directory(root):
    return Path(root) / SNAPSHOT_DIR


def read_manifest(root):
    path = _directory(root) / MANIFEST_NAME
    if not path.exists():
        return {'schemaVersion': 1, 'mainCommit': None, 'files': {}, 'archives': {}}
    return json.loads(path.read_bytes())


def write_manifest(root, manifest):
    path = _directory(root) / MANIFEST_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode('utf-8'))


def project_properties(data):
    """Keep every feature in order but only its properties."""
    payload = json.loads(data)
    features = [{'type': 'Feature', 'properties': feature.get('properties') or {}}
                for feature in payload.get('features', [])]
    return json.dumps({'type': payload.get('type', 'FeatureCollection'), 'features': features},
                      ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def pin(root, relative, data, mode='copy'):
    """Store `data` (the main file's bytes) as the pinned snapshot of `relative`."""
    if mode == 'properties':
        stored = project_properties(data)
    elif mode == 'copy':
        stored = data
    else:
        raise ValueError(f'Unknown snapshot mode: {mode}')
    snapshot = relative + '.gz'
    target = _directory(root) / snapshot
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(gzip.compress(stored, compresslevel=9, mtime=0))
    manifest = read_manifest(root)
    manifest['files'][relative] = {
        'snapshot': snapshot, 'mode': mode, 'sha256': hashlib.sha256(stored).hexdigest(),
        'byteLength': len(stored), 'mainSha256': hashlib.sha256(data).hexdigest(),
    }
    write_manifest(root, manifest)
    return manifest['files'][relative]


def read_bytes(root, relative):
    entry = read_manifest(root)['files'].get(relative)
    if not entry:
        raise KeyError(f'No pinned main source for {relative}; run tools/sync_main_sources.py')
    data = gzip.decompress((_directory(root) / entry['snapshot']).read_bytes())
    if hashlib.sha256(data).hexdigest() != entry['sha256'] or len(data) != entry['byteLength']:
        raise ValueError(f'Pinned main source does not match its manifest: {relative}')
    return data


def read_json(root, relative):
    return json.loads(read_bytes(root, relative))


def read_text(root, relative):
    return read_bytes(root, relative).decode('utf-8')


def archive_sha256(root, relative):
    """SHA-256 of a main-repository archive, verified when the snapshot was synced."""
    entry = read_manifest(root)['archives'].get(relative)
    if not entry:
        raise KeyError(f'No pinned main archive for {relative}; run tools/sync_main_sources.py')
    return entry['sha256']
