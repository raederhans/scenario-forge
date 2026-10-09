#!/usr/bin/env python3
"""Build a deterministic native pixel HGO dataset from an installed source mod."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re

import numpy as np
from PIL import Image

from source_parser import Block, color_hex, history_at, parse

SCHEMA = 1
# These two upstream files omit only their final state brace. Corrections are
# byte-pinned, recorded in provenance, and never written into the source mod.
MISSING_FINAL_BRACE = {
    'history/states/1892-Cannes.txt': '08fac91cb61967d31d6a25258281a303adef9b682f94500d07d9620c242437f6',
    'history/states/9858-South Rodi.txt': '9f310702a50054ed09bc94a864a5be75d261e6e18b84e5656ac4265a9b7decbd',
}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Source:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.files = {}
        self.diagnostics = []

    def read(self, path):
        path = Path(path)
        data = path.read_bytes()
        self.files[path.relative_to(self.root).as_posix()] = sha(data)
        return data

    def text(self, path):
        return self.read(path).decode('utf-8-sig')


def definitions(source):
    table, seen = {}, set()
    for row in csv.reader(io.StringIO(source.text(source.root / 'map/definition.csv')), delimiter=';'):
        if not row or not row[0].strip() or row[0].lstrip().startswith('#'):
            continue
        if len(row) < 5:
            raise ValueError('Invalid definition row')
        pid, *rgb = map(int, row[:4])
        if pid < 0 or any(c < 0 or c > 255 for c in rgb):
            raise ValueError('Invalid definition ID/RGB')
        key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
        if pid in table or key in seen:
            raise ValueError('Duplicate definition ID/RGB')
        table[pid] = key
        seen.add(key)
    if not table or len(table) > 65535:
        raise ValueError('Definition count exceeds uint16 capacity')
    return dict(sorted(table.items()))


def localization(source):
    names = {}
    # Normal files first; explicit replace directory wins, with deterministic ordering.
    files = sorted((source.root / 'localisation').rglob('*_l_english.yml'),
                   key=lambda p: ('replace' in p.parts, p.relative_to(source.root).as_posix()))
    for path in files:
        for line in source.text(path).splitlines():
            match = re.match(r'^\s*([^\s:#]+):\d*\s+"(.*)"\s*(?:#.*)?$', line)
            if match:
                names[match[1]] = re.sub(r'§.', '', match[2]).replace('\\"', '"').replace('\\n', ' ')

    def resolve(key):
        text = names.get(key, key)
        for _ in range(5):
            new = re.sub(r'\$([^$]+)\$', lambda m: names.get(m[1], m[1]), text)
            if new == text:
                break
            text = new
        return text.strip()
    return resolve


def source_states(source, resolve):
    states, by_province, points = {}, {}, {}
    files = sorted((source.root / 'history/states').glob('*.txt'))
    if not files:
        raise ValueError('No native states')
    for path in files:
        try:
            text = source.text(path)
            relative = path.relative_to(source.root).as_posix()
            if source.files[relative] == MISSING_FINAL_BRACE.get(relative):
                text += '\n}'
                source.diagnostics.append(dict(kind='source-syntax-correction', file=relative,
                                               correction='append final state closing brace'))
            state = parse(text).get('state')
            if not isinstance(state, Block):
                raise ValueError('Missing state block')
            sid = int(state.get('id'))
            if sid in states or sid < 0:
                raise ValueError('Duplicate/invalid state ID')
            hist = history_at(state.get('history', Block([])))
            owner = hist.get('owner')
            if not isinstance(owner, str) or not owner:
                raise ValueError('Missing state owner')
            provinces = list(map(int, state.get('provinces', Block([])).values()))
            if not provinces:
                raise ValueError('State has no provinces')
            for pid in provinces:
                if pid in by_province:
                    raise ValueError(f'Duplicate state membership for province {pid}')
                by_province[pid] = sid
            cores = set()
            for key, tag in hist.entries:
                if key == 'add_core_of':
                    cores.add(tag)
                elif key == 'remove_core_of':
                    cores.discard(tag)
            name_key = str(state.get('name', f'STATE_{sid}'))
            states[sid] = dict(id=sid, name=resolve(name_key), nameKey=name_key,
                               entityTag=owner, controllerTag=hist.get('controller', owner),
                               coreTags=sorted(cores), category=state.get('state_category', ''),
                               provinceIds=sorted(provinces))
            for vp in hist.all('victory_points'):
                values = vp.values()
                if len(values) % 2:
                    raise ValueError('Invalid victory point pairs')
                for p, weight in zip(values[0::2], values[1::2]):
                    pid, importance = int(p), float(weight)
                    if importance < 0:
                        raise ValueError('Negative victory point value')
                    if pid not in provinces:
                        source.diagnostics.append(dict(kind='omitted-victory-point', file=path.name,
                                                       stateId=sid, provinceId=pid, reason='outside-source-state'))
                        continue
                    points[pid] = (sid, importance)
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError(f'{path.name}: {error}') from error
    return dict(sorted(states.items())), by_province, points


def province_geometry(ids, count):
    """Two bounded row passes; anchors are the nearest member pixel to centroids."""
    height, width = ids.shape
    counts = np.zeros(count, dtype=np.int64)
    sx, sy = np.zeros(count), np.zeros(count)
    x0, y0 = np.full(count, width), np.full(count, height)
    x1, y1 = np.zeros(count, dtype=np.int64), np.zeros(count, dtype=np.int64)
    for start in range(0, height, 128):
        chunk = ids[start:start + 128]
        code = chunk.ravel()
        y, x = np.indices(chunk.shape)
        x, y = x.ravel(), y.ravel() + start
        counts += np.bincount(code, minlength=count)
        sx += np.bincount(code, weights=x, minlength=count)
        sy += np.bincount(code, weights=y, minlength=count)
        np.minimum.at(x0, code, x)
        np.minimum.at(y0, code, y)
        np.maximum.at(x1, code, x + 1)
        np.maximum.at(y1, code, y + 1)
    cx, cy = sx / np.maximum(counts, 1), sy / np.maximum(counts, 1)
    nearest = np.full(count, np.inf)
    anchors = np.full(count, -1, dtype=np.int64)
    for start in range(0, height, 128):
        chunk = ids[start:start + 128]
        code = chunk.ravel()
        y, x = np.indices(chunk.shape)
        x, y = x.ravel(), y.ravel() + start
        dist = (x - cx[code]) ** 2 + (y - cy[code]) ** 2
        batch = np.full(count, np.inf)
        np.minimum.at(batch, code, dist)
        candidates = np.full(count, width * height, dtype=np.int64)
        mask = dist == batch[code]
        np.minimum.at(candidates, code[mask], y[mask] * width + x[mask])
        improved = batch < nearest
        nearest[improved], anchors[improved] = batch[improved], candidates[improved]
    result = {}
    for code in np.flatnonzero(counts):
        result[int(code)] = dict(pixelCount=int(counts[code]),
                                 bounds=[int(x0[code]), int(y0[code]), int(x1[code]), int(y1[code])],
                                 anchor=[float(anchors[code] % width) + .5, float(anchors[code] // width) + .5])
    return result


def merge_geometry(items):
    items = list(items)
    if not items:
        raise ValueError('Region has no source pixels')
    return dict(pixelCount=sum(p['pixelCount'] for p in items),
                bounds=[min(p['bounds'][0] for p in items), min(p['bounds'][1] for p in items),
                        max(p['bounds'][2] for p in items), max(p['bounds'][3] for p in items)],
                anchor=max(items, key=lambda p: p['pixelCount'])['anchor'])


def source_entities(source, states, resolve, palettes):
    palette_entries, palette_sources = {}, []
    for path in palettes:
        data = Path(path).read_bytes()
        payload = json.loads(data)
        palette_sources.append(dict(name=Path(path).name, sha256=sha(data)))
        for tag, entry in payload['entries'].items():
            palette_entries.setdefault(tag, entry)
    definitions_by_tag = {}
    for path in sorted((source.root / 'common/country_tags').glob('*.txt')):
        for key, ref in parse(source.text(path)).entries:
            if key and isinstance(ref, str):
                definitions_by_tag[key] = ref
    override_path = source.root / 'common/countries/colors.txt'
    overrides = parse(source.text(override_path)) if override_path.exists() else Block([])
    capital_states = {}
    # Read native country history for capital-state evidence, never infer a capital city.
    tags = sorted({s['entityTag'] for s in states.values()})
    for path in sorted((source.root / 'history/countries').glob('*.txt')):
        tag = path.name.split(' ', 1)[0]
        if tag in tags:
            text = source.text(path)
            match = re.search(r'(?m)^capital\s*=\s*(\d+)', text)
            if match:
                capital_states[tag] = int(match[1])
    entities = []
    for tag in tags:
        ref = definitions_by_tag.get(tag)
        body = Block([])
        label = tag
        if ref:
            path = (source.root / 'common' / ref.replace('\\', '/')).resolve()
            if not path.is_relative_to(source.root):
                raise ValueError('Country path escapes source root')
            label = path.stem
            if path.exists():
                body = parse(source.text(path))
        override = overrides.get(tag, Block([]))
        color = color_hex(override.get('color')) or color_hex(body.get('color'))
        color_source = 'native' if color else 'palette'
        entry = palette_entries.get(tag, {})
        if not color:
            color = next((entry.get(k) for k in ('map_hex', 'color', 'ui_hex', 'country_file_hex')
                          if re.fullmatch(r'#[0-9a-fA-F]{6}', str(entry.get(k, '')))), None)
        if not color:
            raise ValueError(f'Missing source color for {tag}; provide an explicit palette')
        name = resolve(tag)
        if name == tag:
            name = entry.get('localized_name') or label
        entity = dict(tag=tag, name=name, color=color.lower(), colorSource=color_source,
                      kind='water' if tag == 'WTR' else 'reference',
                      **merge_geometry(s for s in states.values() if s['entityTag'] == tag))
        if tag in capital_states:
            entity['capitalStateId'] = capital_states[tag]
        entities.append(entity)
    return entities, palette_sources


def build(source_root, output, palettes=()):
    source = Source(source_root)
    definitions_by_id = definitions(source)
    resolve = localization(source)
    states, by_province, points = source_states(source, resolve)
    undefined = set(by_province) - definitions_by_id.keys()
    if undefined:
        raise ValueError(f'States reference undefined provinces: {sorted(undefined)[:8]}')
    bmp = source.read(source.root / 'map/provinces.bmp')
    with Image.open(io.BytesIO(bmp)) as image:
        rgb = np.asarray(image.convert('RGB'), dtype=np.uint32)
    height, width = rgb.shape[:2]
    if width * height > 50_000_000:
        raise ValueError('Native raster exceeds runtime budget')
    keys = (rgb[:, :, 0] << 16) | (rgb[:, :, 1] << 8) | rgb[:, :, 2]
    del rgb
    province_ids = [None, *definitions_by_id]
    code_by_id = {pid: code for code, pid in enumerate(province_ids) if code}
    lookup = np.zeros(1 << 24, dtype=np.uint16)
    for pid, key in definitions_by_id.items():
        lookup[key] = code_by_id[pid]
    ids = lookup[keys]
    del lookup, keys
    if np.any(ids == 0):
        raise ValueError('Raster contains undefined RGB values')
    geometry = province_geometry(ids, len(province_ids))
    missing = [province_ids[c] for c in geometry if province_ids[c] not in by_province]
    if missing:
        raise ValueError(f'Pixel-present provinces have no state: {missing[:8]}')
    for state in states.values():
        state.update(merge_geometry(geometry[code_by_id[p]] for p in state['provinceIds'] if code_by_id[p] in geometry))
    entities, palette_sources = source_entities(source, states, resolve, palettes)
    places = []
    for pid, (sid, importance) in sorted(points.items(), key=lambda p: (-p[1][1], p[0])):
        if code_by_id[pid] not in geometry or importance == 0:
            continue
        x, y = geometry[code_by_id[pid]]['anchor']
        places.append(dict(id=f'vp-{pid}', name=resolve(f'VICTORY_POINTS_{pid}'), provinceId=pid,
                           stateId=sid, entityTag=states[sid]['entityTag'], x=x, y=y,
                           importance=importance, isCapital=False))
    core = dict(schemaVersion=SCHEMA, provinceIds=province_ids,
                provinceStateIds=[None] + [by_province.get(pid) for pid in province_ids[1:]],
                states=list(states.values()), entities=entities)
    raw_ids = ids.astype('<u2', copy=False).tobytes()
    # GzipFile (not platform-sensitive gzip.compress) fixes both timestamp and header.
    stream = io.BytesIO()
    with gzip.GzipFile(fileobj=stream, mode='wb', compresslevel=6, mtime=0, filename='') as handle:
        handle.write(raw_ids)
    payloads = {'ids': ('ids.u16.gz', 'gzip', stream.getvalue()),
                'core': ('core.json', 'json', encoded(core)),
                'places': ('places.json', 'json', encoded(dict(schemaVersion=SCHEMA, places=places)))}
    assets = {k: dict(url=name, encoding=encoding, byteLength=len(data), sha256=sha(data))
              for k, (name, encoding, data) in payloads.items()}
    assets['ids']['decodedByteLength'] = len(raw_ids)
    provenance = dict(id='hgo_mod_2241701657', asOf='1936.1.1',
                      coordinatePolicy='untransformed-native-pixels', files=source.files, palettes=palette_sources,
                      capitalPolicy='native capital state retained; no inferred capital-city flags',
                      diagnostics=source.diagnostics)
    revision = sha(encoded(dict(schemaVersion=SCHEMA, assets=assets, source=provenance)))
    manifest = dict(format='hgo-native-dataset', schemaVersion=SCHEMA, id='hgo-1936', revision=revision,
                    coordinateSpace=dict(kind='pixel', width=width, height=height, origin='top-left', wrapX=False),
                    assets=assets, source=dict(id=provenance['id'], asOf=provenance['asOf'],
                                              fileCount=len(source.files), fingerprint=sha(encoded(provenance)),
                                              omittedPlaceReferenceCount=sum(d['kind'] == 'omitted-victory-point' for d in source.diagnostics),
                                              provenanceUrl='provenance.json'),
                    stats=dict(stateCount=len(states), provinceCount=len(definitions_by_id),
                               presentProvinceCount=len(geometry), entityCount=len(entities),
                               waterStateCount=sum(s['entityTag'] == 'WTR' for s in states.values()),
                               placeCount=len(places)))
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    for name, _, data in payloads.values():
        (output / name).write_bytes(data)
    (output / 'provenance.json').write_bytes(encoded(provenance))
    (output / 'manifest.json').write_bytes(encoded(manifest))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--palette', action='append', default=[], type=Path,
                        help='Explicit source color/name fallback; first pack wins')
    args = parser.parse_args()
    manifest = build(args.source_root, args.output, args.palette)
    print(json.dumps(dict(revision=manifest['revision'], stats=manifest['stats'],
                          assets={k: v['byteLength'] for k, v in manifest['assets'].items()})))


if __name__ == '__main__':
    main()
