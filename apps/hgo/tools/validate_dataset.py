#!/usr/bin/env python3
"""Validate the independent HGO dataset; optionally compare every source RGB pixel."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re

import numpy as np


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate(folder, source_root=None):
    folder = Path(folder).resolve()
    manifest = json.loads((folder / 'manifest.json').read_bytes())
    require(manifest.get('format') == 'hgo-native-dataset' and manifest.get('schemaVersion') == 1,
            'Unsupported native dataset')
    space = manifest['coordinateSpace']
    width, height = space['width'], space['height']
    require(space['kind'] == 'pixel' and space['origin'] == 'top-left' and space['wrapX'] is False,
            'Not a native pixel dataset')
    require(type(width) is int and type(height) is int and width > 0 and height > 0 and width * height <= 50_000_000,
            'Invalid native dimensions')
    blobs = {}
    require(set(manifest['assets']) == {'ids', 'core', 'places'}, 'Unexpected dataset assets')
    for name, asset in manifest['assets'].items():
        path = (folder / asset['url']).resolve()
        require(path.is_relative_to(folder) and path != folder, 'Asset path escapes dataset')
        require(0 < asset['byteLength'] <= 160 * 1024 * 1024, 'Asset exceeds budget')
        require(path.stat().st_size == asset['byteLength'], f'{name}: byte length mismatch')
        blob = path.read_bytes()
        require(digest(blob) == asset['sha256'], f'{name}: integrity mismatch')
        require(asset['encoding'] == ('gzip' if name == 'ids' else 'json'), 'Invalid asset encoding')
        blobs[name] = blob
    expected_size = width * height * 2
    require(manifest['assets']['ids']['decodedByteLength'] == expected_size, 'Decoded length mismatch')
    with gzip.GzipFile(fileobj=io.BytesIO(blobs['ids'])) as handle:
        raw = handle.read(expected_size + 1)
    require(len(raw) == expected_size, 'Truncated or oversized ID image')
    ids = np.frombuffer(raw, dtype='<u2').reshape(height, width)
    core = json.loads(blobs['core'])
    require(core['schemaVersion'] == 1, 'Unsupported core')
    pids, sids = core['provinceIds'], core['provinceStateIds']
    require(len(pids) == len(sids) and 1 < len(pids) <= 65536 and pids[0] is None and sids[0] is None,
            'Invalid dense tables')
    require(all(type(p) is int and p >= 0 for p in pids[1:]) and len(set(pids)) == len(pids),
            'Duplicate/invalid source province IDs')
    entities = {e['tag']: e for e in core['entities']}
    states = {s['id']: s for s in core['states']}
    require(len(entities) == len(core['entities']) and len(states) == len(core['states']), 'Duplicate region IDs')
    require(all(re.fullmatch(r'#[0-9a-fA-F]{6}', e['color']) for e in entities.values()), 'Invalid source color')
    present, counts = np.unique(ids, return_counts=True)
    require(0 not in present and int(present[-1]) < len(pids), 'Unknown/nodata pixel')
    require(all(sids[int(c)] in states for c in present), 'Pixel-present province has no state')
    require(all(s is None or s in states for s in sids), 'Unknown state table reference')
    expected_members = {s: set() for s in states}
    pixel_counts = {s: 0 for s in states}
    for code, sid in enumerate(sids):
        if code and sid is not None:
            expected_members[sid].add(pids[code])
    for code, count in zip(present, counts):
        pixel_counts[sids[int(code)]] += int(count)

    def member(anchor, sid=None, tag=None):
        require(isinstance(anchor, list) and len(anchor) == 2 and
                all(type(n) in (int, float) and np.isfinite(n) for n in anchor), 'Invalid region anchor')
        x, y = anchor
        require(0 <= x < width and 0 <= y < height, 'Anchor outside raster')
        actual = sids[int(ids[int(y), int(x)])]
        require(actual == sid if sid is not None else states[actual]['entityTag'] == tag,
                'Anchor outside member region')

    for sid, state in states.items():
        require(type(sid) is int and sid >= 0 and state['entityTag'] in entities, 'Invalid state identity')
        require(set(state['provinceIds']) == expected_members[sid] and len(state['provinceIds']) == len(expected_members[sid]),
                'State province membership mismatch')
        require(state['pixelCount'] == pixel_counts[sid] and pixel_counts[sid] > 0, 'State pixel count mismatch')
        x0, y0, x1, y1 = state['bounds']
        require(0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height, 'Invalid state bounds')
        member(state['anchor'], sid=sid)
    for tag, entity in entities.items():
        require((entity['kind'] == 'water') == (tag == 'WTR'), 'Editable water classification mismatch')
        member(entity['anchor'], tag=tag)
    places = json.loads(blobs['places'])
    require(places['schemaVersion'] == 1, 'Unsupported places')
    code_by_id = {pid: code for code, pid in enumerate(pids)}
    place_ids = set()
    for place in places['places']:
        require(place['id'] not in place_ids, 'Duplicate place ID')
        place_ids.add(place['id'])
        member([place['x'], place['y']], sid=place['stateId'])
        require(int(ids[int(place['y']), int(place['x'])]) == code_by_id.get(place['provinceId']), 'Place outside province')
        require(place['entityTag'] == states[place['stateId']]['entityTag'] and type(place['isCapital']) is bool,
                'Invalid place reference')
    provenance_path = (folder / manifest['source']['provenanceUrl']).resolve()
    require(provenance_path.is_relative_to(folder), 'Provenance path escapes dataset')
    provenance = json.loads(provenance_path.read_bytes())
    require(digest(encoded(provenance)) == manifest['source']['fingerprint'], 'Provenance mismatch')
    revision = digest(encoded(dict(schemaVersion=1, assets=manifest['assets'], source=provenance)))
    require(revision == manifest['revision'], 'Dataset revision mismatch')
    stats = dict(stateCount=len(states), provinceCount=len(pids) - 1, presentProvinceCount=len(present),
                 entityCount=len(entities), waterStateCount=sum(s['entityTag'] == 'WTR' for s in states.values()),
                 placeCount=len(places['places']))
    require(stats == manifest['stats'], 'Dataset statistics mismatch')
    if source_root:
        from PIL import Image
        from build_dataset import Source, definitions
        source = Source(source_root)
        native = definitions(source)
        require(set(pids[1:]) == set(native), 'Source definition coverage mismatch')
        keys = np.zeros(len(pids), dtype=np.uint32)
        for pid, code in code_by_id.items():
            if code:
                keys[code] = native[pid]
        bmp = source.read(source.root / 'map/provinces.bmp')
        with Image.open(io.BytesIO(bmp)) as image:
            rgb = np.asarray(image.convert('RGB'), dtype=np.uint32)
        require(rgb.shape[:2] == (height, width), 'Source shape mismatch')
        original = (rgb[:, :, 0] << 16) | (rgb[:, :, 1] << 8) | rgb[:, :, 2]
        mismatches = int(np.count_nonzero(keys[ids] != original))
        require(mismatches == 0, f'Source RGB roundtrip mismatch: {mismatches}')
        stats['sourcePixelMismatches'] = mismatches
        for path, expected in provenance['files'].items():
            target = (source.root / path).resolve()
            require(target.is_relative_to(source.root) and digest(target.read_bytes()) == expected,
                    f'Source provenance drift: {path}')
    return dict(valid=True, revision=revision, **stats)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--source-root', type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.folder, args.source_root)))
