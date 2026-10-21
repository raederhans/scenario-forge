#!/usr/bin/env python3
"""Build a base-bound runtime catalog for packaged HGO visual overlays."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import tempfile

FORMAT = 'hgo-visualization-catalog'
SCHEMA = 1
MAX_ASSET_BYTES = 24 * 1024 * 1024
MAX_CATALOG_BYTES = 512 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def safe_relative(relative):
    require(isinstance(relative, str) and relative and '\\' not in relative and ':' not in relative,
            f'Invalid overlay path: {relative!r}')
    path = PurePosixPath(relative)
    require(not path.is_absolute() and path.as_posix() == relative
            and all(part not in ('', '.', '..') for part in path.parts),
            f'Overlay path must stay relative: {relative!r}')
    return path


def read_overlay(overlays, relative):
    relative = safe_relative(relative)
    path = overlays.joinpath(*relative.parts)
    current = overlays
    for part in relative.parts:
        current = current / part
        require(not current.is_symlink(), f'Symbolic-link overlay asset refused: {relative.as_posix()}')
    resolved = path.resolve()
    require(resolved.is_relative_to(overlays) and resolved.is_file(),
            f'Missing or escaping overlay file: {relative.as_posix()}')
    payload = resolved.read_bytes()
    require(0 < len(payload) <= MAX_ASSET_BYTES,
            f'Overlay asset exceeds the per-asset size limit: {relative.as_posix()}')
    return resolved, payload


def descriptor(overlays, relative):
    _, payload = read_overlay(overlays, relative)
    return dict(path=safe_relative(relative).as_posix(), byteLength=len(payload), sha256=digest(payload))


def read_manifest(overlays, relative, expected_format):
    path, payload = read_overlay(overlays, relative)
    try:
        value = json.loads(payload.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f'Invalid JSON manifest: {relative}') from error
    require(isinstance(value, dict) and value.get('format') == expected_format
            and type(value.get('schemaVersion')) is int and value.get('schemaVersion') == SCHEMA,
            f'Unsupported overlay manifest: {relative}')
    return value, path


def validate_json_payload(overlays, relative, expected_format=None):
    path, payload = read_overlay(overlays, relative)
    try:
        parsed = json.loads(payload.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f'Invalid JSON overlay asset: {relative}') from error
    require(isinstance(parsed, dict), f'Overlay JSON asset must be an object: {relative}')
    if expected_format is not None:
        require(parsed.get('format') == expected_format and type(parsed.get('schemaVersion')) is int
                and parsed.get('schemaVersion') == SCHEMA,
                f'Unsupported overlay JSON asset: {relative}')
    return path, payload, parsed


def manifest_asset(overlays, manifest, name, relative, width, height, channels, encoding='gzip-u8'):
    assets = manifest.get('assets', {})
    source = assets.get(name)
    require(isinstance(source, dict), f'Missing source overlay asset: {name}')
    require(source.get('encoding') == encoding, f'{name}: unsupported source encoding')
    require(type(source.get('width')) is int and type(source.get('height')) is int
            and type(source.get('channels')) is int
            and (source['width'], source['height'], source['channels']) == (width, height, channels),
            f'{name}: source dimensions or channel count mismatch')
    url = source.get('url')
    safe_relative(url)
    source_path, payload = read_overlay(overlays, f'{relative}/{url}')
    require(len(payload) == source.get('byteLength') and digest(payload) == source.get('sha256'),
            f'{name}: source integrity mismatch')
    decoded_length = width * height * channels
    require(type(source.get('decodedByteLength')) is int and source['decodedByteLength'] == decoded_length,
            f'{name}: declared decoded size mismatch')
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
            decoded = stream.read(decoded_length + 1)
            require(len(decoded) == decoded_length and not stream.read(1),
                    f'{name}: gzip decoded size mismatch')
    except OSError as error:
        raise ValueError(f'{name}: invalid gzip stream') from error
    return dict(path=f'{relative}/{url}', encoding='gzip', dtype='u8', width=width, height=height,
                channels=channels, decodedByteLength=decoded_length,
                byteLength=len(payload), sha256=digest(payload))


def landform_labels_asset(overlays, geography, width, height):
    source = geography.get('assets', {}).get('labels', {})
    require(source.get('encoding') == 'json', 'Invalid landform labels encoding')
    relative = f"geography/{safe_relative(source.get('url')).as_posix()}"
    _, payload, value = validate_json_payload(overlays, relative)
    require(len(payload) == source.get('byteLength') and digest(payload) == source.get('sha256'),
            'Landform labels integrity mismatch')
    require(value.get('schemaVersion') == 1 and value.get('coordinateSpace') == 'hgo-pixel'
            and isinstance(value.get('labels'), list) and len(value['labels']) <= 2048,
            'Invalid landform labels')
    ids = set()
    finite = lambda n: type(n) in (int, float) and math.isfinite(n)
    for label in value['labels']:
        require(isinstance(label, dict), 'Invalid landform label')
        identity = label.get('id')
        require(isinstance(identity, str) and 0 < len(identity) <= 128 and identity not in ids,
                'Invalid landform label id')
        ids.add(identity)
        en, zh = label.get('nameEn'), label.get('nameZh')
        x, y, rank, minimum = (label.get(key) for key in ('x', 'y', 'rank', 'minZoom'))
        require(isinstance(en, str) and en.strip() and len(en) <= 200
                and isinstance(zh, str) and len(zh) <= 200, 'Invalid landform label name')
        require(finite(x) and finite(y) and 0 <= x < width and 0 <= y < height,
                'Invalid landform label coordinates')
        require(type(rank) is int and 1 <= rank <= 10 and finite(minimum) and 0 <= minimum <= 32,
                'Invalid landform label visibility')
    return dict(path=relative, encoding='json', byteLength=len(payload), sha256=digest(payload))


def write_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    require(not path.is_symlink(), f'Refusing symbolic-link output: {path}')
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        Path(temporary).replace(path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def build(root):
    root = Path(root).resolve()
    app = root / 'apps/hgo'
    overlays = app / 'assets/overlays'
    require(not overlays.is_symlink(), 'Overlay root may not be a symbolic link')
    overlays = overlays.resolve()
    require(overlays.is_relative_to(app.resolve()), 'Overlay root escapes the HGO app')
    base_path = app / 'assets/default/manifest.json'
    try:
        base = json.loads(base_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError('Missing or invalid native base manifest') from error
    require(base.get('format') == 'hgo-native-dataset' and type(base.get('schemaVersion')) is int
            and base.get('schemaVersion') == 1,
            'Unsupported native base dataset')
    base_identity = dict(id=base.get('id'), revision=base.get('revision'))
    require(isinstance(base_identity['id'], str) and bool(base_identity['id'])
            and isinstance(base_identity['revision'], str)
            and re.fullmatch(r'[a-f0-9]{64}', base_identity['revision']),
            'Invalid native base dataset identity')

    localization_path = 'localization/index.json'
    metrics_path = 'metrics/metrics.json'
    _, _, localization = validate_json_payload(overlays, localization_path,
                                               expected_format='hgo-native-localization')
    _, _, metrics = validate_json_payload(overlays, metrics_path,
                                         expected_format='hgo-native-metrics')
    geography, _ = read_manifest(overlays, 'geography/manifest.json', 'hgo-geographic-overlays')
    illumination, _ = read_manifest(overlays, 'illumination/manifest.json', 'hgo-illumination-overlays')
    require(localization.get('dataset') == base_identity, 'Localization base dataset mismatch')
    require(metrics.get('baseDataset') == base_identity, 'Metrics base dataset mismatch')
    require(geography.get('datasetRevision') == base_identity['revision'], 'Geography base dataset mismatch')
    require(illumination.get('baseDataset') == base_identity, 'Illumination base dataset mismatch')

    coordinate = base.get('coordinateSpace', {})
    width, height = coordinate.get('width'), coordinate.get('height')
    require(type(width) is int and type(height) is int and width > 0 and height > 0,
            'Invalid native base dimensions')
    require(geography.get('nativeSize') == [width, height], 'Geography native dimensions mismatch')
    require((illumination.get('width'), illumination.get('height')) == (512, 256),
            'Illumination overlay must use a 512x256 target grid')
    require(geography.get('coordinateSpace') == 'hgo-pixel-top-left',
            'Geography coordinate space mismatch')

    palette = geography.get('palette')
    require(isinstance(palette, list) and palette, 'Geography palette is missing')
    palette_bytes = encoded(dict(palette=palette))
    require(len(palette_bytes) <= MAX_ASSET_BYTES, 'Terrain palette exceeds the per-asset size limit')
    palette_path = overlays / 'geography/palette.json'
    palette_descriptor = dict(path='geography/palette.json', encoding='json',
                              byteLength=len(palette_bytes), sha256=digest(palette_bytes))

    localization_asset = descriptor(overlays, localization_path)
    metrics_asset = descriptor(overlays, metrics_path)
    localization_asset.update(encoding='json')
    metrics_asset.update(encoding='json')
    physical = geography.get('assets', {}).get('physical', {})
    terrain_width, terrain_height = physical.get('width'), physical.get('height')
    require(type(terrain_width) is int and type(terrain_height) is int
            and 0 < terrain_width <= width and 0 < terrain_height <= height,
            'Invalid native physical overlay dimensions')
    terrain = manifest_asset(overlays, geography, 'physical', 'geography',
                             terrain_width, terrain_height, 1)
    terrain_balanced = manifest_asset(overlays, geography, 'physicalBalanced', 'geography',
                                      1280, 640, 1)
    terrain_palette = palette_descriptor
    terrain_labels = landform_labels_asset(overlays, geography, width, height)
    for key in ('riversDistance', 'riversDistanceBalanced'):
        require(geography.get('assets', {}).get(key, {}).get('distanceField')
                == dict(version=1, zero=128, unitsPerTexel=16), f'{key}: unsupported distance field')
    rivers = manifest_asset(overlays, geography, 'riversDistance', 'geography', width, height, 1)
    rivers_balanced = manifest_asset(overlays, geography, 'riversDistanceBalanced', 'geography',
                                     2560, 1280, 1)
    night_source = illumination.get('assets', {}).get('nightLights')
    illumination_source = illumination.get('assets', {}).get('illumination')
    require(isinstance(night_source, dict) and isinstance(illumination_source, dict),
            'Missing illumination runtime assets')

    def illumination_asset(name, source, channels):
        require(source.get('encoding') == 'gzip-u8' and source.get('dtype') == 'u8'
                and type(source.get('width')) is int and type(source.get('height')) is int
                and type(source.get('channels')) is int
                and (source.get('width'), source.get('height'), source.get('channels')) == (512, 256, channels),
                f'{name}: unsupported illumination asset contract')
        relative = safe_relative(source.get('url'))
        _, payload = read_overlay(overlays, f'illumination/{relative.as_posix()}')
        decoded_length = 512 * 256 * channels
        require(len(payload) == source.get('byteLength') and digest(payload) == source.get('sha256'),
                f'{name}: source integrity mismatch')
        require(source.get('decodedByteLength') == decoded_length, f'{name}: decoded size mismatch')
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
                decoded = stream.read(decoded_length + 1)
                require(len(decoded) == decoded_length and not stream.read(1),
                        f'{name}: gzip decoded size mismatch')
        except OSError as error:
            raise ValueError(f'{name}: invalid gzip stream') from error
        return dict(path=f'illumination/{relative.as_posix()}', encoding='gzip', dtype='u8',
                    width=512, height=256, channels=channels, decodedByteLength=decoded_length,
                    byteLength=len(payload), sha256=digest(payload))

    night_lights = illumination_asset('nightLights', night_source, 1)
    day_night = illumination_asset('illumination', illumination_source, 4)
    require(illumination_source.get('vectorEncoding') == 'premultiplied-unit-rgb-edge-fade-v2',
            'Unsupported illumination vector encoding')
    day_night['vectorEncoding'] = illumination_source['vectorEncoding']

    provenance_paths = [
        'geography/manifest.json', 'geography/georeference.json', 'geography/name_reviews.json',
        'geography/rivers.u8.gz', 'geography/rivers-balanced.u8.gz',
        'geography/inverse-lonlat.f32.gz', 'geography/inverse-confidence.u8.gz',
        'geography/broad-inverse-lonlat.f32.gz', 'geography/broad-inverse-confidence.u8.gz',
        'illumination/manifest.json', 'illumination/night-lights-confidence.u8.gz',
        'metrics/provenance.json', 'localization/provenance.json',
        'localization/reviewed_translations.json',
        'localization/place_reviews.json',
        'localization/state_reviews.json',
        'localization/OPENCC-LICENSE.txt',
    ]
    provenance = [descriptor(overlays, path) for path in provenance_paths]
    payload = dict(format=FORMAT, schemaVersion=SCHEMA, baseDataset=base_identity,
                   assets=dict(localization=localization_asset, metrics=metrics_asset,
                               terrain=terrain, terrainBalanced=terrain_balanced,
                               terrainPalette=terrain_palette, terrainLabels=terrain_labels, rivers=rivers,
                               riversBalanced=rivers_balanced,
                               nightLights=night_lights, illumination=day_night),
                   provenance=provenance)
    catalog_bytes = encoded(payload)
    require(len(catalog_bytes) <= MAX_CATALOG_BYTES, 'Overlay catalog exceeds the 512 KiB size limit')

    write_atomic(palette_path, palette_bytes)
    catalog_path = overlays / 'catalog.json'
    write_atomic(catalog_path, catalog_bytes)
    return dict(catalog=str(catalog_path), assetCount=len(payload['assets']),
                provenanceCount=len(provenance), byteLength=len(catalog_bytes),
                baseDataset=base_identity)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
    args = parser.parse_args()
    print(json.dumps(build(args.root), sort_keys=True))


if __name__ == '__main__':
    main()
