"""Stage only explicitly reviewed same-ID European land restorations."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import box

from tools.repair_tno_balkan_anatolia_seams import build_candidate

DEFAULT_SPECS = ROOT / 'tools/repair_specs/tno_remaining_europe_20261005.json'
REVIEWED_SOURCES = {
    'nuts': dict(sha256='64cb81a6ecd3780aa506bfdb50069a1d3534e98d088b0123dfa95de730884290', bytes=26471025),
    'russia': dict(sha256='74012237384e53061aa63b6e20b9be24f94facfe615b52bbe72e62a81fa68ff0', bytes=120489189),
    'france': dict(sha256='6ed2c7b7ebb07b83c2e0067416819859d8bbd3d8e3d48660307c1e04b1953e42', bytes=5739022),
    'lakes': dict(sha256='3e9b2dac45850639a6d3fd03b0a7bee5a585f8b9d93f4b5041012c1ff20c110b', bytes=2381103),
    'rivers': dict(sha256='60dbebd1fc2d4f9ba8b6d5327a99960c6bfcbe9c6df1d5d4508d0b70fa950a04', bytes=5590332),
    'lakes_original': dict(sha256='0803a06f9c3cb4671d89b68c48b142aad9366ba40f665245e12a913fbc61722a', bytes=2349685),
}


def _digest(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def _numbers(value, length):
    return (isinstance(value, (list, tuple)) and len(value) == length
            and all(type(v) in (int, float) and math.isfinite(v) for v in value))


def read_manifest(path, *, data=None):
    """Reject incomplete specifications and source identities before source IO."""
    manifest = json.loads(Path(path).read_bytes() if data is None else data)
    if (not isinstance(manifest, dict) or type(manifest.get('schema_version')) is not int
            or manifest['schema_version'] != 1 or not _digest(manifest.get('baseline_topology_sha256'))):
        raise ValueError('Expected schema_version 1 and baseline_topology_sha256')
    sources = manifest.get('sources')
    if not isinstance(sources, dict) or set(sources) != set(REVIEWED_SOURCES):
        raise ValueError('Manifest must declare exactly the reviewed source keys')
    for key, pin in REVIEWED_SOURCES.items():
        row = sources[key]
        if (not isinstance(row, dict) or not _digest(row.get('sha256'))
                or type(row.get('bytes')) is not int or row['bytes'] <= 0
                or not isinstance(row.get('url'), str) or not row['url'].startswith('https://')
                or any(row.get(field) != pin[field] for field in ('sha256', 'bytes'))):
            raise ValueError(f'{key}: manifest differs from reviewed source identity')
    specs = manifest.get('specs')
    if not isinstance(specs, list) or not specs:
        raise ValueError('Manifest must contain a nonempty explicit specs array')
    names, seeds, identities = set(), set(), {}
    for spec in specs:
        if not isinstance(spec, dict):
            raise ValueError('Each reviewed spec must be an object')
        name, seed, bounds = spec.get('name'), spec.get('seed'), spec.get('bounds')
        area, contacts = spec.get('area_range_km2'), spec.get('contacts')
        if (not isinstance(name, str) or not name.strip() or name in names
                or not _numbers(seed, 2) or tuple(seed) in seeds or not _numbers(bounds, 4)
                or not (-180 <= bounds[0] < seed[0] < bounds[2] <= 180)
                or not (-90 < bounds[1] < seed[1] < bounds[3] < 90)
                or not _numbers(area, 2) or not 0 < area[0] <= area[1]
                or not isinstance(contacts, dict) or len(contacts) < 2):
            raise ValueError('Invalid or duplicate reviewed name/seed/bounds/area/contacts')
        names.add(name)
        seeds.add(tuple(seed))
        for fid, identity in contacts.items():
            if (not isinstance(fid, str) or not fid.strip() or '__tno' in fid
                    or fid.startswith(('RU_CITY_', 'RU_ARCTIC_FB_'))
                    or not isinstance(identity, (list, tuple)) or len(identity) != 2
                    or any(not isinstance(v, str) or not v.strip() for v in identity)):
                raise ValueError('Reviewed contacts require unsplit stable IDs and country/owner pairs')
            if fid in identities and identities[fid] != tuple(identity):
                raise ValueError(f'{fid}: inconsistent reviewed contact identity')
            identities[fid] = tuple(identity)
    return manifest


def read_pinned_frame(key, path, identity):
    """Bind GDAL to the same byte snapshot whose digest and size were checked."""
    path = Path(path)
    data = path.read_bytes()
    if len(data) != identity['bytes'] or hashlib.sha256(data).hexdigest() != identity['sha256']:
        raise ValueError(f'{key}: source bytes differ from reviewed manifest identity')
    frame = gpd.read_file(io.BytesIO(data))
    return frame, dict(path=str(path.resolve()), **identity,
                       read_binding='entire reviewed byte snapshot, including ZIP sidecars')


def _source_ids(frame, key):
    rules = {'nuts': ('NUTS_ID', '', 3035), 'russia': ('shapeID', 'RU_RAY_', 4326),
             'france': ('code', 'FR_ARR_', 4326)}
    column, prefix, epsg = rules[key]
    if frame.crs is None or frame.crs.to_epsg() != epsg or column not in frame:
        raise ValueError(f'{key}: expected original {column} and EPSG:{epsg}')
    raw = frame[column]
    if raw.isna().any() or not raw.is_unique or any(not isinstance(v, str) or not v.strip() for v in raw):
        raise ValueError(f'{key}: original source IDs must be nonempty unique strings')
    if key == 'nuts' and ('LEVL_CODE' not in frame or not frame.LEVL_CODE.eq(3).all()):
        raise ValueError('nuts: expected GISCO 2021 level-3 source')
    if key == 'russia' and (not {'shapeGroup', 'shapeType'}.issubset(frame.columns)
                           or not frame.shapeGroup.eq('RUS').all() or not frame.shapeType.eq('ADM2').all()):
        raise ValueError('russia: expected RUS ADM2 source')
    return prefix + raw, frame.to_crs(4326) if epsg != 4326 else frame


def read_sources(manifest, paths):
    required = {fid for spec in manifest['specs'] for fid in spec['contacts']}
    geometries, metadata = {}, {}
    for key in ('nuts', 'russia', 'france'):
        frame, metadata[key] = read_pinned_frame(key, paths[key], manifest['sources'][key])
        ids, frame = _source_ids(frame, key)
        for fid, geometry in zip(ids, frame.geometry):
            if fid not in required:
                continue
            if fid in geometries:
                raise ValueError(f'{fid}: conflicting source ID mappings')
            if (geometry is None or geometry.is_empty or not geometry.is_valid
                    or geometry.geom_type not in {'Polygon', 'MultiPolygon'}):
                raise ValueError(f'{fid}: invalid full same-ID source geometry')
            geometries[fid] = geometry
    if set(geometries) != required:
        raise ValueError(f'Missing full same-ID sources: {sorted(required - set(geometries))}')
    polygons = []
    # Bounds are a conservative superset of the explicitly reviewed holes.
    # Select full source polygons, never clipped rings or repaired geometry.
    water_scope = shapely.STRtree([box(*spec['bounds']) for spec in manifest['specs']])
    for key in ('lakes', 'rivers', 'lakes_original'):
        frame, metadata[key] = read_pinned_frame(key, paths[key], manifest['sources'][key])
        if frame.crs is None or frame.crs.to_epsg() != 4326:
            raise ValueError(f'{key}: protected water requires EPSG:4326')
        line_count, selected_count, excluded_count = 0, 0, 0
        excluded_invalid = []
        for index, geometry in enumerate(frame.geometry):
            if geometry is None or geometry.is_empty:
                raise ValueError(f'{key}: missing protected water geometry')
            if geometry.geom_type in {'Polygon', 'MultiPolygon'}:
                if not all(math.isfinite(v) for v in geometry.bounds):
                    raise ValueError(f'{key}: protected water has nonfinite bounds')
                selected = len(water_scope.query(geometry.envelope, predicate='intersects')) > 0
                if not selected:
                    excluded_count += 1
                    if not geometry.is_valid:
                        row = frame.iloc[index]
                        name = row.get('name')
                        excluded_invalid.append(dict(source_row=index,
                            source_id=str(row.get('ne_id', row.get('id', index))),
                            name=name if isinstance(name, str) else None,
                            bounds=list(geometry.bounds), reason=shapely.is_valid_reason(geometry)))
                    continue
                if not geometry.is_valid:
                    raise ValueError(f'{key}: invalid protected water polygon in reviewed bounds')
                polygons.append(geometry)
                selected_count += 1
            elif key == 'rivers' and geometry.geom_type in {'LineString', 'MultiLineString'}:
                line_count += 1
            else:
                raise ValueError(f'{key}: unexpected protected water geometry type')
        metadata[key]['unbuffered_river_line_count'] = line_count
        metadata[key].update(selected_full_polygon_count=selected_count,
            excluded_remote_polygon_count=excluded_count, excluded_remote_invalid_polygons=excluded_invalid,
            selection_scope='full original polygons whose envelopes intersect any explicit reviewed gap bounds; no clipping or repair')
    protected = shapely.union_all(polygons)
    if not protected.is_valid:
        raise ValueError('Invalid combined protected water')
    return geometries, protected, metadata


def _output_paths(output, report):
    output, report = Path(output).resolve(), Path(report).resolve()
    runtime = (ROOT / '.runtime').resolve()
    if any(path == runtime or not path.is_relative_to(runtime) for path in (output, report)):
        raise ValueError('Candidate and report must be inside this workspace .runtime directory')
    if output == report or output.exists() or report.exists():
        raise FileExistsError('Candidate and report paths must be distinct and new')
    return output, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-topology', type=Path, required=True)
    parser.add_argument('--owners', type=Path, required=True)
    parser.add_argument('--specs', type=Path, default=DEFAULT_SPECS)
    parser.add_argument('--nuts-source', type=Path, required=True)
    parser.add_argument('--russia-source', type=Path, required=True)
    parser.add_argument('--france-source', type=Path, default=ROOT / 'data/france_arrondissements.geojson')
    parser.add_argument('--lakes-source', type=Path, default=ROOT / 'data/global_lakes.geojson')
    parser.add_argument('--rivers-source', type=Path, default=ROOT / 'data/global_rivers.geojson')
    parser.add_argument('--lakes-original-source', type=Path, default=ROOT / 'data/ne_10m_lakes.zip')
    parser.add_argument('--output-topology', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args(argv)
    output, report_path = _output_paths(args.output_topology, args.report)
    manifest_bytes = args.specs.read_bytes()
    manifest = read_manifest(args.specs, data=manifest_bytes)
    baseline_bytes = args.baseline_topology.read_bytes()
    if hashlib.sha256(baseline_bytes).hexdigest() != manifest['baseline_topology_sha256']:
        raise ValueError('Baseline topology bytes differ from reviewed manifest')
    baseline = json.loads(baseline_bytes)
    owners = json.loads(args.owners.read_text(encoding='utf-8'))['owners']
    paths = {key: getattr(args, key + '_source') for key in ('nuts', 'russia', 'france', 'lakes', 'rivers')}
    paths['lakes_original'] = args.lakes_original_source
    sources, protected, metadata = read_sources(manifest, paths)
    candidate, report = build_candidate(baseline, owners, sources, protected, specs=manifest['specs'],
                                        progress=lambda event: print(json.dumps(event), flush=True))
    report['sources'] = metadata
    report['reviewed_manifest'] = dict(path=str(args.specs.resolve()),
        sha256=hashlib.sha256(manifest_bytes).hexdigest(), specs_count=len(manifest['specs']),
        baseline_topology_sha256=manifest['baseline_topology_sha256'])
    payloads = (json.dumps(candidate, ensure_ascii=False, separators=(',', ':'), allow_nan=False),
                json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
    for path, payload in zip((output, report_path), payloads):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('x', encoding='utf-8') as handle:
            handle.write(payload)
    print(json.dumps(dict(candidate=str(output), report=str(report_path), changed_ids=report['changed_ids'],
                          restored_area_km2=report['restored_area_km2'], residual_area_km2=report['residual_area_km2'])))


if __name__ == '__main__':
    main()
