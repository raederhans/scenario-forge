"""Refresh HGO's pinned main-repository sources and report what changed.

This is the only step that reads live main-repository data. Run it on purpose,
review the report, then rebuild the HGO overlays (build_localization.py,
build_overlay_catalog.py, build_geographic_overlays.py, build_illumination.py)
and commit the snapshots together with the rebuilt outputs.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import main_sources  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
FILES = {
    'data/locales.json': 'copy',
    'data/geo_aliases.json': 'copy',
    'data/hierarchy.json': 'copy',
    'data/city_aliases.json': 'copy',
    'data/world_cities.geojson': 'copy',
    'data/hgo_catalogs/hgo_place_names.json': 'copy',
    'data/palettes/hoi4_vanilla.palette.json': 'copy',
    'data/marine_regions.refined.source.geojson': 'properties',
    'data/marine_regions.additional.source.geojson': 'properties',
    'data/global_physical_semantics.topo.json': 'copy',
    'data/global_rivers.geojson': 'copy',
    'data/physical_region_labels.geojson': 'copy',
    'js/core/state_defaults.js': 'copy',
    'js/core/city_lights_modern_asset.js': 'copy',
}
LOCALIZATION = 'apps/hgo/assets/overlays/localization'
ADMIN1_ARCHIVE = 'data/ne_10m_admin_1_states_provinces.zip'
ADMIN1_RECORDS = 'derived/ne_10m_admin_1_states_provinces.review_records.json'
ADMIN1_FIELDS = ['ne_id', 'name', 'name_en', 'name_zh', 'adm1_code', 'iso_a2']


def read_committed(root, relative):
    """Committed bytes at the main HEAD, independent of checkout line endings."""
    try:
        return subprocess.run(['git', 'show', f'HEAD:{relative}'], cwd=root, check=True,
                              capture_output=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return (root / relative).read_bytes()


def read_dbf(data):
    count = struct.unpack_from('<I', data, 4)[0]
    header, width = struct.unpack_from('<HH', data, 8)
    fields, offset = [], 1
    for pos in range(32, header - 1, 32):
        if data[pos] == 13:
            break
        name = data[pos:pos + 11].split(b'\0')[0].decode('ascii')
        size = data[pos + 16]
        fields.append((name, offset, size))
        offset += size
    for start in range(header, header + count * width, width):
        yield {name: data[start + off:start + off + size].decode('utf8').strip(' \0') for name, off, size in fields}


def reviewed_archives(root):
    reviewed = json.loads(read_committed(root, f'{LOCALIZATION}/reviewed_translations.json'))
    state_reviews = json.loads(read_committed(root, f'{LOCALIZATION}/state_reviews.json'))
    archives = {reviewed['countryReference']['path']: reviewed['countryReference']}
    for item in state_reviews.get('sourceArchives', []):
        archives[item['path']] = item
    return archives, state_reviews


def admin1_records(root, state_reviews, member):
    referenced = {str(item['ne_id']) for row in state_reviews['entries'] for item in row.get('evidence', [])
                  if isinstance(item, dict) and item.get('member') == member and 'ne_id' in item}
    with zipfile.ZipFile(io.BytesIO(read_committed(root, ADMIN1_ARCHIVE))) as source:
        records = [{key: record[key] for key in ADMIN1_FIELDS} for record in read_dbf(source.read(member))
                   if record['ne_id'] in referenced]
    records.sort(key=lambda record: record['ne_id'])
    return json.dumps({'archive': ADMIN1_ARCHIVE, 'member': member, 'records': records},
                      ensure_ascii=False, indent=2).encode('utf-8') + b'\n'


def keyed(value):
    """Map a source to {key: canonical JSON} for a change summary."""
    if isinstance(value, dict) and isinstance(value.get('entries'), list):
        rows = value['entries']
    elif isinstance(value, dict) and isinstance(value.get('features'), list):
        rows = [feature.get('properties') or {} for feature in value['features']]
    elif isinstance(value, dict) and isinstance(value.get('geo'), dict):
        return {key: json.dumps(item, sort_keys=True) for key, item in value['geo'].items()}
    elif isinstance(value, dict):
        return {key: json.dumps(item, sort_keys=True) for key, item in value.items()}
    else:
        return None
    result = {}
    for index, row in enumerate(rows):
        identity = str(row.get('stable_key') or row.get('id') or row.get('city_id') or index)
        result[identity] = json.dumps(row, sort_keys=True)
    return result


def summarize(before, after):
    try:
        old, new = keyed(json.loads(before)), keyed(json.loads(after))
    except ValueError:
        old = new = None
    if old is None or new is None:
        return {'changed': True}
    return {'added': len(new.keys() - old.keys()), 'removed': len(old.keys() - new.keys()),
            'modified': sum(old[key] != new[key] for key in old.keys() & new.keys())}


def sync(root=ROOT):
    root = Path(root)
    previous = main_sources.read_manifest(root)
    report = {'files': {}, 'archives': {}}
    for relative, mode in FILES.items():
        data = read_committed(root, relative)
        before = main_sources.read_bytes(root, relative) if relative in previous['files'] else None
        entry = main_sources.pin(root, relative, data, mode)
        if before is None:
            report['files'][relative] = {'status': 'added'}
        elif hashlib.sha256(before).hexdigest() != entry['sha256']:
            report['files'][relative] = {'status': 'changed', **summarize(before, main_sources.read_bytes(root, relative))}
    archives, state_reviews = reviewed_archives(root)
    manifest = main_sources.read_manifest(root)
    manifest['archives'] = {}
    for relative, reference in sorted(archives.items()):
        actual = hashlib.sha256(read_committed(root, relative)).hexdigest()
        manifest['archives'][relative] = {'sha256': actual, 'member': reference.get('member')}
        if actual != reference['sha256']:
            report['archives'][relative] = 'differs from the reviewed hash; re-review before rebuilding'
    main_sources.write_manifest(root, manifest)
    member = archives[ADMIN1_ARCHIVE]['member']
    records = admin1_records(root, state_reviews, member)
    before = main_sources.read_bytes(root, ADMIN1_RECORDS) if ADMIN1_RECORDS in previous['files'] else None
    main_sources.pin(root, ADMIN1_RECORDS, records)
    if before != records:
        report['files'][ADMIN1_RECORDS] = {'status': 'added' if before is None else 'changed'}
    manifest = main_sources.read_manifest(root)
    try:
        commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    manifest['mainCommit'] = commit
    main_sources.write_manifest(root, manifest)
    report['mainCommit'] = commit
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    print(json.dumps(sync(args.root), ensure_ascii=False, indent=2))
