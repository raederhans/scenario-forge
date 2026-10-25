#!/usr/bin/env python3
"""Build georeferenced modern night lights and static geographic vectors for HGO."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import sys

import numpy as np
from scipy.ndimage import distance_transform_edt

sys.path.insert(0, str(Path(__file__).resolve().parent))
import main_sources  # noqa: E402

SCHEMA = 1
FORMAT = 'hgo-illumination-overlays'
EXPECTED_SOURCE_WIDTH = 720
EXPECTED_SOURCE_HEIGHT = 360
SOURCE_STEP_DEGREES = 0.5
VECTOR_ENCODING = 'premultiplied-unit-rgb-edge-fade-v2'
EDGE_FADE_CELLS = 4
MAX_GRID_CELLS = 50_000_000
SOURCE_ID = 'nasa_black_marble_2016_3km_gray'
SOURCE_ATTESTATION = 'not_attested'
SOURCE_STATUS = 'pending_upgrade_review'
SOURCE_JS_RELATIVE = 'js/core/city_lights_modern_asset.js'
SOURCE_DESCRIPTOR = re.compile(
    r'MODERN_CITY_LIGHTS_SOURCE\s*=\s*Object\.freeze\(\{\s*'
    r'name:\s*(["\'])(.*?)\1,\s*url:\s*(["\'])(.*?)\3,\s*\}\);', re.S)
GRID_DECLARATION = re.compile(
    r'MODERN_CITY_LIGHTS_GRID\s*=\s*new Uint8Array\(\[\s*(.*?)\s*\]\);', re.S)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def _read_json(path):
    data = Path(path).read_bytes()
    return json.loads(data.decode('utf-8')), data


def _load_asset(manifest_path, manifest, name, encoding, channels):
    asset = manifest.get('assets', {}).get(name)
    if not isinstance(asset, dict) or asset.get('encoding') != encoding:
        raise ValueError(f'Geography asset {name} has an unsupported encoding')
    width, height = asset.get('width'), asset.get('height')
    if (not isinstance(width, int) or isinstance(width, bool) or width <= 0
            or not isinstance(height, int) or isinstance(height, bool) or height <= 0
            or width * height > MAX_GRID_CELLS):
        raise ValueError(f'Geography asset {name} has invalid dimensions')
    if channels is not None and asset.get('channels') not in (None, channels):
        raise ValueError(f'Geography asset {name} has invalid channel count')
    url = asset.get('url')
    if not isinstance(url, str):
        raise ValueError(f'Geography asset {name} has no URL')
    root = Path(manifest_path).resolve().parent
    path = (root / url).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f'Geography asset {name} escapes its directory')
    compressed = path.read_bytes()
    if (len(compressed) != asset.get('byteLength') or sha(compressed) != asset.get('sha256')):
        raise ValueError(f'Geography asset {name} integrity mismatch')
    try:
        decoded = gzip.decompress(compressed)
    except OSError as error:
        raise ValueError(f'Geography asset {name} is not valid gzip data') from error
    expected = width * height * (4 * channels if encoding == 'gzip-f32le-x2' else channels)
    if len(decoded) != expected or len(decoded) != asset.get('decodedByteLength'):
        raise ValueError(f'Geography asset {name} decoded size mismatch')
    return asset, compressed, decoded


def _load_json_asset(manifest_path, manifest, name):
    asset = manifest.get('assets', {}).get(name)
    if not isinstance(asset, dict) or asset.get('encoding') != 'json':
        raise ValueError(f'Geography asset {name} has an unsupported encoding')
    url = asset.get('url')
    if not isinstance(url, str):
        raise ValueError(f'Geography asset {name} has no URL')
    root = Path(manifest_path).resolve().parent
    path = (root / url).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f'Geography asset {name} escapes its directory')
    payload = path.read_bytes()
    if len(payload) != asset.get('byteLength') or sha(payload) != asset.get('sha256'):
        raise ValueError(f'Geography asset {name} integrity mismatch')
    return asset, payload


def read_city_lights(path=None):
    # Without an explicit file, read HGO's pinned snapshot of the main asset.
    raw = Path(path).read_bytes() if path is not None else main_sources.read_bytes(Path(__file__).resolve().parents[3], SOURCE_JS_RELATIVE)
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError as error:
        raise ValueError('Modern city-lights asset is not UTF-8') from error
    source = SOURCE_DESCRIPTOR.search(text)
    if not source:
        raise ValueError('Modern city-lights source descriptor is missing')
    width_match = re.search(r'MODERN_CITY_LIGHTS_GRID_WIDTH\s*=\s*(\d+)\s*;', text)
    height_match = re.search(r'MODERN_CITY_LIGHTS_GRID_HEIGHT\s*=\s*(\d+)\s*;', text)
    lon_step = re.search(r'MODERN_CITY_LIGHTS_STEP_LON_DEG\s*=\s*([\d.]+)\s*;', text)
    lat_step = re.search(r'MODERN_CITY_LIGHTS_STEP_LAT_DEG\s*=\s*([\d.]+)\s*;', text)
    grid_match = GRID_DECLARATION.search(text)
    if not all((width_match, height_match, lon_step, lat_step, grid_match)):
        raise ValueError('Modern city-lights grid metadata is incomplete')
    width, height = int(width_match[1]), int(height_match[1])
    if (width, height) != (EXPECTED_SOURCE_WIDTH, EXPECTED_SOURCE_HEIGHT):
        raise ValueError(f'Expected {EXPECTED_SOURCE_WIDTH}x{EXPECTED_SOURCE_HEIGHT} city-lights grid')
    if float(lon_step[1]) != SOURCE_STEP_DEGREES or float(lat_step[1]) != SOURCE_STEP_DEGREES:
        raise ValueError('Modern city-lights grid is not sampled at 0.5 degree centers')
    grid_text = grid_match[1].strip()
    parts = grid_text.split(',')
    if parts and not parts[-1].strip():
        parts.pop()
    if len(parts) != width * height:
        raise ValueError('Modern city-lights byte count does not match grid dimensions')
    values = bytearray()
    for value in parts:
        token = value.strip()
        if not token.isdigit():
            raise ValueError('Modern city-lights grid contains a non-integer byte')
        number = int(token)
        if number > 255:
            raise ValueError('Modern city-lights grid contains a value outside Uint8 range')
        values.append(number)
    return dict(name=source[2], url=source[4]), bytes(values), dict(width=width, height=height,
                                                                       stepLonDegrees=SOURCE_STEP_DEGREES,
                                                                       stepLatDegrees=SOURCE_STEP_DEGREES), raw


def sample_bilinear(grid, width, height, longitude, latitude):
    """Bilinear sample at a geographic coordinate; longitude wraps and latitude clamps."""
    if len(grid) != width * height or width <= 0 or height <= 0:
        raise ValueError('Invalid source grid')
    if not math.isfinite(longitude) or not math.isfinite(latitude):
        raise ValueError('Cannot sample non-finite coordinates')
    longitude = ((longitude + 180.0) % 360.0) - 180.0
    latitude = max(-90.0, min(90.0, latitude))
    x = (longitude + 180.0) / SOURCE_STEP_DEGREES - 0.5
    x0_raw = math.floor(x)
    x1_raw = x0_raw + 1
    fx = x - x0_raw
    x0, x1 = x0_raw % width, x1_raw % width
    y = (90.0 - latitude) / SOURCE_STEP_DEGREES - 0.5
    y = max(0.0, min(float(height - 1), y))
    y0 = math.floor(y)
    y1 = min(height - 1, y0 + 1)
    fy = y - y0
    top = grid[y0 * width + x0] * (1.0 - fx) + grid[y0 * width + x1] * fx
    bottom = grid[y1 * width + x0] * (1.0 - fx) + grid[y1 * width + x1] * fx
    return top * (1.0 - fy) + bottom * fy


def encode_geo_vector(longitude, latitude):
    """Encode an Earth-centered unit normal as RGB bytes in [0,255]."""
    if (not math.isfinite(longitude) or not math.isfinite(latitude)
            or longitude < -180.0 or longitude > 180.0
            or latitude < -90.0 or latitude > 90.0):
        raise ValueError('Invalid geographic coordinate')
    lon = math.radians(longitude)
    lat = math.radians(latitude)
    cos_lat = math.cos(lat)
    vector = (cos_lat * math.cos(lon), cos_lat * math.sin(lon), math.sin(lat))
    return tuple(max(0, min(255, math.floor((component + 1.0) * 127.5 + 0.5))) for component in vector)


def _gzip(data):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode='wb', compresslevel=6, mtime=0, filename='') as handle:
        handle.write(data)
    return output.getvalue()


def soften_illumination(vectors, width, height):
    """Bake a visual edge weight, independently of geographic confidence codes.

    RGB is premultiplied in encoded space so one LINEAR GPU sample can safely
    interpolate valid cells with RGBA-zero invalid cells. No coordinates are
    extrapolated, and supported interior normals keep their original bytes.
    """
    field = np.frombuffer(vectors, dtype=np.uint8).reshape(height, width, 4).copy()
    valid = field[:, :, 3] > 0
    if valid.all():
        weight = np.ones((height, width))
    else:
        distance = distance_transform_edt(valid)
        t = np.clip((distance - .5) / EDGE_FADE_CELLS, 0, 1)
        weight = t * t * (3 - 2 * t)
    alpha = np.floor(weight * 255 + .5).astype(np.uint8)
    field[:, :, :3] = np.floor(field[:, :, :3].astype(float) * alpha[:, :, None] / 255 + .5).astype(np.uint8)
    field[:, :, 3] = alpha
    return field.tobytes(), dict(fadedCells=int(((alpha > 0) & (alpha < 255)).sum()),
                                fullWeightCells=int((alpha == 255).sum()),
                                invalidCells=int((alpha == 0).sum()))


def build(base_manifest_path, geography_manifest_path, city_lights_path, output):
    base, _ = _read_json(base_manifest_path)
    if (base.get('format') != 'hgo-native-dataset' or base.get('schemaVersion') != 1
            or not isinstance(base.get('id'), str)
            or not re.fullmatch(r'[a-f0-9]{64}', str(base.get('revision', '')))):
        raise ValueError('Invalid native base dataset manifest')

    geography, geography_bytes = _read_json(geography_manifest_path)
    if geography.get('format') != 'hgo-geographic-overlays' or geography.get('schemaVersion') != 1:
        raise ValueError('Unsupported geographic overlay manifest')
    if geography.get('datasetRevision') != base['revision']:
        raise ValueError('Geographic overlay dataset revision mismatch')
    base_size = base.get('coordinateSpace', {})
    if geography.get('nativeSize') != [base_size.get('width'), base_size.get('height')]:
        raise ValueError('Geographic overlay native dimensions mismatch')
    if geography.get('coordinateSpace') != 'hgo-pixel-top-left':
        raise ValueError('Geographic overlay coordinate space mismatch')
    grid_size = geography.get('coverage', {}).get('inverseGridSize')
    if (not isinstance(grid_size, list) or len(grid_size) != 2
            or any(not isinstance(v, int) or isinstance(v, bool) or v <= 0 for v in grid_size)):
        raise ValueError('Geographic overlay inverse-grid dimensions are missing')

    geo_path = Path(geography_manifest_path).resolve()
    night_lon_asset, _, night_lonlat = _load_asset(
        geo_path, geography, 'inverseLonLat', 'gzip-f32le-x2', 2)
    night_confidence_asset, _, night_confidence = _load_asset(
        geo_path, geography, 'inverseConfidence', 'gzip-u8', 1)
    broad_lon_asset, _, broad_lonlat = _load_asset(
        geo_path, geography, 'broadInverseLonLat', 'gzip-f32le-x2', 2)
    broad_confidence_asset, _, broad_confidence = _load_asset(
        geo_path, geography, 'broadInverseConfidence', 'gzip-u8', 1)
    georeference_asset, _ = _load_json_asset(geo_path, geography, 'georeference')
    width, height = grid_size
    for asset in (night_lon_asset, night_confidence_asset, broad_lon_asset, broad_confidence_asset):
        if (asset.get('width'), asset.get('height')) != (width, height):
            raise ValueError('Inverse geography assets do not match their manifest grid')
    count = width * height
    if len(night_confidence) != count or len(broad_confidence) != count:
        raise ValueError('Inverse confidence size mismatch')
    night_confidence_values = set(night_confidence)
    broad_confidence_values = set(broad_confidence)

    descriptor, lights_grid, source_grid, source_bytes = read_city_lights(city_lights_path)
    night_lights = bytearray(count)
    night_lights_confidence = bytearray(count)
    illumination = bytearray(count * 4)
    night_valid_count = 0
    night_invalid_confident_count = 0
    illumination_valid_count = 0
    illumination_invalid_confident_count = 0
    for index in range(count):
        night_lon, night_lat = struct.unpack_from('<ff', night_lonlat, index * 8)
        night_conf = night_confidence[index]
        night_valid = (night_conf > 0 and math.isfinite(night_lon) and math.isfinite(night_lat)
                       and -180.0 <= night_lon <= 180.0 and -90.0 <= night_lat <= 90.0)
        if night_valid:
            night_valid_count += 1
            night_lights_confidence[index] = night_conf
            sample = sample_bilinear(lights_grid, source_grid['width'], source_grid['height'],
                                     night_lon, night_lat)
            night_lights[index] = max(0, min(255, math.floor(sample + 0.5)))
        elif night_conf > 0:
            night_invalid_confident_count += 1

        broad_lon, broad_lat = struct.unpack_from('<ff', broad_lonlat, index * 8)
        broad_conf = broad_confidence[index]
        broad_valid = (broad_conf > 0 and math.isfinite(broad_lon) and math.isfinite(broad_lat)
                       and -180.0 <= broad_lon <= 180.0 and -90.0 <= broad_lat <= 90.0)
        if broad_valid:
            illumination_valid_count += 1
            red, green, blue = encode_geo_vector(broad_lon, broad_lat)
            offset = index * 4
            illumination[offset:offset + 4] = bytes((red, green, blue, broad_conf))
        elif broad_conf > 0:
            illumination_invalid_confident_count += 1

    source_info = dict(id=SOURCE_ID, descriptor=descriptor, status=SOURCE_STATUS,
                       attestation=SOURCE_ATTESTATION, upstreamInputSha256='unavailable',
                       localAssetPath=SOURCE_JS_RELATIVE, localAssetSha256=sha(source_bytes),
                       grid=source_grid, sampling='0.5-degree cell centers',
                       temporalMeaning='2016 modern night-light reference; not a 1936 observation or realtime signal')
    registration = dict(id='hgo-rbf-continuous-modern-reference',
                        manifestPath='apps/hgo/assets/overlays/geography/manifest.json',
                        manifestSha256=sha(geography_bytes), format=geography['format'],
                        identity=georeference_asset['sha256'], identityAsset='georeference',
                        datasetRevision=geography['datasetRevision'],
                        coordinateSpace=geography['coordinateSpace'], nativeSize=geography['nativeSize'],
                        gridSize=[width, height],
                        sampleMethod=geography.get('coverage', {}).get('sampleMethod'),
                        nightLightsInverse=dict(method='RBF continuous modern-reference inverse',
                                                lonLatSha256=night_lon_asset['sha256'],
                                                confidenceSha256=night_confidence_asset['sha256'],
                                                confidenceCodes=sorted(night_confidence_values)),
                        illuminationInverse=dict(method='RBF continuous broad-reference inverse',
                                                 lonLatSha256=broad_lon_asset['sha256'],
                                                 confidenceSha256=broad_confidence_asset['sha256'],
                                                 confidenceMeaning={'0': 'unsupported or invalid',
                                                                    '96': 'broad solar approximation from distant controls',
                                                                    '180': 'modern-reference domain'}),
                        validMask='confidence > 0 and finite longitude/latitude within geographic bounds')

    illumination, fade_stats = soften_illumination(illumination, width, height)
    compressed_lights = _gzip(night_lights)
    compressed_lights_confidence = _gzip(night_lights_confidence)
    compressed_illumination = _gzip(illumination)
    assets = {
        'nightLights': dict(url='night-lights.u8.gz', width=width, height=height, channels=1,
                            dtype='u8', encoding='gzip-u8', byteLength=len(compressed_lights),
                            decodedByteLength=len(night_lights), sha256=sha(compressed_lights),
                            resampling='bilinear geographic sampling with wrapped longitude and clamped latitude',
                            invalidValue=0, validityAsset='nightLightsConfidence'),
        'nightLightsConfidence': dict(url='night-lights-confidence.u8.gz', width=width, height=height,
                                      channels=1, dtype='u8', encoding='gzip-u8',
                                      byteLength=len(compressed_lights_confidence),
                                      decodedByteLength=len(night_lights_confidence),
                                      sha256=sha(compressed_lights_confidence),
                                      meaning='0 means no valid RBF inverse; non-zero preserves inverseConfidence'),
        'illumination': dict(url='illumination.rgba8.gz', width=width, height=height, channels=4,
                             dtype='u8', encoding='gzip-u8', byteLength=len(compressed_illumination),
                             decodedByteLength=len(illumination), sha256=sha(compressed_illumination),
                             layout='interleaved RGBA',
                             vectorEncoding=VECTOR_ENCODING,
                             rgb='Encoded Earth-centered unit vector, premultiplied by the quantized alpha weight; divide RGB by alpha before decoding',
                             alpha='Independent smooth domain-edge display weight; not inverseConfidence or probability. Invalid positions have RGBA zero',
                             edgeFadeCells=EDGE_FADE_CELLS,
                             edgeFadeMethod='smoothstep(0, 4, distance-to-invalid-cell-center - 0.5); no fade at map frame alone',
                             sampling='LINEAR with encoded RGB premultiplied by alpha',
                             invalidAlpha=0),
    }
    payload = dict(format=FORMAT, schemaVersion=SCHEMA,
                   baseDataset=dict(id=base['id'], revision=base['revision']),
                   width=width, height=height, channels=4, dtype='u8', encoding='gzip-u8',
                   source=source_info, registration=registration, assets=assets,
                   stats=dict(gridCells=count,
                              nightLights=dict(validCells=night_valid_count,
                                               invalidCells=count - night_valid_count,
                                               confidenceZeroCount=night_confidence.count(0),
                                               nonFiniteOrOutOfRangeConfidentCount=night_invalid_confident_count,
                                               confidenceCodes=sorted(night_confidence_values)),
                              illumination=dict(validCells=illumination_valid_count,
                                                displayWeight=fade_stats,
                                                invalidCells=count - illumination_valid_count,
                                                confidenceZeroCount=broad_confidence.count(0),
                                                nonFiniteOrOutOfRangeConfidentCount=illumination_invalid_confident_count,
                                                confidenceCodes=sorted(broad_confidence_values))))
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'night-lights.u8.gz').write_bytes(compressed_lights)
    (output / 'night-lights-confidence.u8.gz').write_bytes(compressed_lights_confidence)
    (output / 'illumination.rgba8.gz').write_bytes(compressed_illumination)
    (output / 'manifest.json').write_bytes(encoded(payload))
    return dict(baseDataset=payload['baseDataset'], width=width, height=height,
                validNightLightCells=night_valid_count,
                validIlluminationCells=illumination_valid_count,
                invalidCells=count - illumination_valid_count,
                nightLightsBytes=len(compressed_lights),
                nightLightsConfidenceBytes=len(compressed_lights_confidence),
                illuminationBytes=len(compressed_illumination))


def main():
    here = Path(__file__).resolve()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-manifest', type=Path,
                        default=here.parents[1] / 'assets/default/manifest.json')
    parser.add_argument('--geography-manifest', type=Path,
                        default=here.parents[1] / 'assets/overlays/geography/manifest.json')
    parser.add_argument('--city-lights-source', type=Path, default=None,
                        help='Defaults to the pinned snapshot from tools/sync_main_sources.py.')
    parser.add_argument('--output', type=Path,
                        default=here.parents[1] / 'assets/overlays/illumination')
    args = parser.parse_args()
    print(json.dumps(build(args.base_manifest, args.geography_manifest,
                           args.city_lights_source, args.output), sort_keys=True))


if __name__ == '__main__':
    main()
