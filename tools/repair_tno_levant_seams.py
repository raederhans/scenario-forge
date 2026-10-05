"""Restore four explicitly reviewed inland seams from unchanged same-ID NE sources.

Only reviewed empty land is added. Historical owner sidecars and all existing
territory remain authoritative. Derived runtime/LOD validation is a separate gate.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import Point, box
from shapely.ops import transform
from pyproj import CRS, Transformer

from map_builder.json_source import json_source_sha256, read_json_source, resolve_json_source_path
from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry
from tools.repair_tno_slovakia_ukraine_seams import _merge_precision_ids, _overlap_diagnostic, _polygonal

AREA_EPSILON = 1e-12
EXTENT = (32, 28.5, 43, 37.5)
REVIEWED_GAPS = (
    dict(name='syrian_desert', seed=(38.561756632656625, 33.25247633426334),
         bounds=(36.812168121681225, 32.324670731707315, 40.667806678066796, 34.32956403564036),
         area_range_km2=(172.42, 172.43), contacts={'IRQ-3471': ('IQ', 'IRQ'), 'JOR-850': ('JO', 'JOR'),
         'SYR-139': ('SY', 'SYR'), 'SYR-142': ('TUR', 'TUR'), 'SYR-143': ('SY', 'SYR'), 'SYR-144': ('SY', 'SYR')}),
    dict(name='pal_leb', seed=(35.5050933993503, 33.17351756927233),
         bounds=(35.480154801548025, 33.08496793267932, 35.54459242071413, 33.26549512195122),
         area_range_km2=(27.18, 27.19), contacts={'ISR-3056': ('IL', 'PAL'), 'LBN-3059': ('LB', 'LEB')}),
    dict(name='lebanon_internal', seed=(35.613348045742015, 33.51838573030277),
         bounds=(35.58815588155883, 33.43039976599766, 35.635501809563564, 33.602247763477635),
         area_range_km2=(16.13, 16.14), contacts={'LBN-3022': ('LB', 'LEB'), 'LBN-3025': ('LB', 'LEB'), 'LBN-3060': ('LB', 'LEB')}),
    dict(name='jerusalem_west_bank', seed=(35.25842531152586, 31.788296678966788),
         bounds=(35.228152281522824, 31.71018395283953, 35.26415264152644, 31.82474928449284),
         area_range_km2=(13.78, 13.79), contacts={'ISR-3058': ('IL', 'PAL'), 'WEB+00?': ('PS', 'PAL')}),
)
REVIEWED_SHA256 = {
    'ne_10m_admin_1_states_provinces.shp': 'c6f5c8b4b1320d9417033762419c6df1eb423989cd880fba78ea0b1e3522cbe4',
    'ne_10m_admin_1_states_provinces.dbf': '445a8a9bea889634faf0af18081830df0b05b8471fc6af8dc42aecdd7a71bba1',
    'ne_10m_admin_1_states_provinces.shx': '37a9e2bc79ed31d3bdea3cb62d928f77281a1c88d645cd33430231c75dbcf350',
    'ne_10m_admin_1_states_provinces.prj': 'a02a27b1d1982c8516d83398e85a3c8b1aef1713c13ef4d84d7bde17430c07c4',
    'ne_10m_admin_1_states_provinces.cpg': '3ad3031f5503a4404af825262ee8232cc04d4ea6683d42c5dd0a2f2a27ac9824',
    'global_lakes.geojson': '3e9b2dac45850639a6d3fd03b0a7bee5a585f8b9d93f4b5041012c1ff20c110b',
    'global_rivers.geojson': '60dbebd1fc2d4f9ba8b6d5327a99960c6bfcbe9c6df1d5d4508d0b70fa950a04',
}


def area_km2(geometry):
    if geometry.is_empty:
        return 0.0
    west, south, east, north = geometry.bounds
    projection = CRS.from_proj4(f'+proj=laea +lat_0={(south+north)/2} +lon_0={(west+east)/2} +datum=WGS84 +units=m')
    project = Transformer.from_crs(4326, projection, always_xy=True).transform
    return float(transform(project, shapely.segmentize(geometry, 0.001)).area / 1e6)


def _source_geometries(frame):
    if frame.crs is None or frame.crs.to_epsg() != 4326 or 'adm1_code' not in frame:
        raise ValueError('Same-ID source requires adm1_code and EPSG:4326')
    ids = frame.adm1_code
    if ids.isna().any() or not ids.is_unique or any(not str(v).strip() for v in ids):
        raise ValueError('Source IDs must be unique and nonempty')
    sources = dict(zip(ids.astype(str), frame.geometry))
    for fid in {fid for spec in REVIEWED_GAPS for fid in spec['contacts']}:
        geometry = sources.get(fid)
        if geometry is None or geometry.is_empty or not geometry.is_valid or geometry.geom_type not in {'Polygon', 'MultiPolygon'}:
            raise ValueError(f'Missing or invalid same-ID source: {fid}')
    return sources


def build_candidate(baseline, owners, source, *, protected_water):
    """Pure candidate assembly; CLI additionally binds reviewed source file bytes."""
    sources = _source_geometries(source)
    if not protected_water.is_valid:
        raise ValueError('Invalid protected water geometry')
    _merge_precision_ids(baseline, [])
    absolute = _absolute_topology(baseline)
    rows = {g['properties']['id']: g for g in absolute['objects']['political']['geometries']}
    if len(rows) != len(absolute['objects']['political']['geometries']):
        raise ValueError('Duplicate political ID')
    before = {fid: _decode_geometry(absolute, row) for fid, row in rows.items()}
    extent = box(*EXTENT)
    local = {fid: g for fid, g in before.items() if g.intersects(extent)}
    if any(not g.is_valid for g in local.values()):
        raise ValueError('Invalid local political geometry')
    occupied = shapely.union_all([g.intersection(extent) for g in local.values()])
    exclusions = [protected_water, *[_decode_geometry(absolute, absolute['objects'][name])
                  for name in ('scenario_water', 'scenario_atlantropa')]]
    land = _decode_geometry(absolute, absolute['objects']['land_mask'])
    allowed = land.intersection(extent).difference(shapely.union_all(exclusions))
    gaps = list(shapely.get_parts(extent.difference(occupied)))
    additions, corridors, reviewed = {}, [], []
    for spec in REVIEWED_GAPS:
        name = spec['name']
        hits = [g for g in gaps if g.covers(Point(spec['seed']))]
        if len(hits) != 1:
            raise ValueError(f'{name}: reviewed gap absent, already repaired or ambiguous')
        gap = hits[0]
        if (gap.geom_type != 'Polygon' or not gap.is_valid or gap.intersects(extent.boundary)
                or any(abs(a-b) > 1e-9 for a, b in zip(gap.bounds, spec['bounds']))
                or not spec['area_range_km2'][0] <= area_km2(gap) <= spec['area_range_km2'][1]):
            raise ValueError(f'{name}: reviewed gap bounds, area or enclosure changed')
        contacts = {fid for fid, g in local.items() if gap.boundary.intersection(g.boundary).length > 1e-12}
        if contacts != set(spec['contacts']):
            raise ValueError(f'{name}: reviewed contact IDs changed')
        if gap.difference(allowed).area > AREA_EPSILON or gap.boundary.intersection(allowed.boundary).length > 1e-12:
            raise ValueError(f'{name}: protected water, Atlantropa or land-mask boundary')
        pieces = {}
        for fid, (country, owner) in spec['contacts'].items():
            props = rows[fid]['properties']
            if (props.get('cntr_code') != country or owners.get(fid) != owner
                    or props.get('interactive') is False or props.get('scenario_helper_kind')):
                raise ValueError(f'{name}: expected attributes or owner changed: {fid}')
            piece = _polygonal(gap.intersection(sources[fid]))
            if piece.is_empty or not piece.is_valid:
                raise ValueError(f'{name}: no valid source restoration: {fid}')
            pieces[fid] = piece
        restored = shapely.union_all(list(pieces.values()))
        if gap.symmetric_difference(restored).area > AREA_EPSILON:
            raise ValueError(f'{name}: incomplete same-ID source support')
        for fid, piece in pieces.items():
            if piece.intersection(shapely.union_all([p for other, p in pieces.items() if other != fid])).area > AREA_EPSILON:
                raise ValueError(f'{name}: ambiguous source allocation')
            additions[fid] = shapely.union_all([additions.get(fid, shapely.GeometryCollection()), piece])
        corridors.append(dict(name=name, area_before_km2=area_km2(gap),
            source_residual_degrees2=gap.difference(restored).area,
            assignments=[dict(id=fid, owner=owners[fid], area_km2=area_km2(piece)) for fid, piece in sorted(pieces.items())]))
        reviewed.append((spec, gap))
    candidate, encodings, updated_geometries = deepcopy(baseline), [], {}
    for fid, addition in sorted(additions.items()):
        if addition.intersection(occupied).area > AREA_EPSILON:
            raise ValueError(f'Restoration overlaps existing territory: {fid}')
        updated = before[fid].union(addition)
        if not updated.is_valid or before[fid].difference(updated).area > AREA_EPSILON:
            raise ValueError(f'Invalid restoration or original territory lost: {fid}')
        updated_geometries[fid] = updated
    joint_valid = coverage_is_valid_exact(updated_geometries.values())
    # When existing target overlaps prevent joint coverage, retain them rather
    # than changing old territory. The singleton path checks each valid polygon;
    # the complete neighbor-pair checks below certify no new overlap.
    groups = [sorted(additions)] if joint_valid else [[fid] for fid in sorted(additions)]
    for group in groups:
        frame = gpd.GeoDataFrame([dict(id=fid, geometry=updated_geometries[fid]) for fid in group], crs=4326)
        candidate, diagnostic = replace_regional_geometry(candidate, frame)
        encodings.append(diagnostic)
    result = _absolute_topology(candidate)
    result_rows = {g['properties']['id']: g for g in result['objects']['political']['geometries']}
    if set(result_rows) != set(rows):
        raise ValueError('Political IDs changed')
    after = {fid: _decode_geometry(result, row) for fid, row in result_rows.items()}
    for fid in rows:
        if rows[fid]['properties'] != result_rows[fid]['properties']:
            raise ValueError(f'Political attributes changed: {fid}')
        expected = before[fid].union(additions[fid]) if fid in additions else before[fid]
        if (fid not in additions and not after[fid].equals_exact(expected, 0)) or after[fid].symmetric_difference(expected).area > AREA_EPSILON:
            raise ValueError(f'Unexpected geometry change: {fid}')
    new_union = shapely.union_all([g.intersection(extent) for g in after.values() if g.intersects(extent)])
    for report, (spec, gap) in zip(corridors, reviewed):
        residual = gap.difference(new_union)
        if residual.area > AREA_EPSILON or not new_union.covers(Point(spec['seed'])):
            raise ValueError(f'{spec["name"]}: restoration remains missing')
        report.update(area_after_km2=area_km2(residual), residual_degrees2=residual.area,
                      probe=list(spec['seed']), probe_covered=True)
    diagnostics, pairs, junctions = [], set(), []
    ids = list(after)
    tree = shapely.STRtree(list(after.values()))
    for fid in sorted(additions):
        neighbors = {ids[int(i)] for i in tree.query(after[fid], predicate='intersects')}
        neighbors.update(other for other, g in before.items() if g.intersects(before[fid]))
        new_coords = set(map(tuple, shapely.get_coordinates(after[fid]))) - set(map(tuple, shapely.get_coordinates(before[fid])))
        for other in sorted(neighbors - {fid}):
            pair = tuple(sorted((fid, other)))
            if pair not in pairs:
                pairs.add(pair)
                diagnostics.append(_overlap_diagnostic(pair, before[fid].intersection(before[other]), after[fid].intersection(after[other])))
            other_coords = set(map(tuple, shapely.get_coordinates(after[other])))
            for xy in sorted(new_coords - other_coords):
                if after[other].boundary.covers(Point(xy)):
                    junctions.append(dict(id=fid, adjacent_id=other, coordinate=list(xy)))
    for name, obj in absolute['objects'].items():
        if name != 'political' and not _decode_geometry(absolute, obj).equals_exact(_decode_geometry(result, result['objects'][name]), 0):
            raise ValueError(f'Auxiliary geometry changed: {name}')
    candidate['political_precision_feature_ids'] = _merge_precision_ids(baseline, additions)
    return candidate, dict(status='PASS_SOURCE_SUPPORTED_RESTORATION', release_ready=False,
        rule='reviewed inland gap intersection with unchanged same-ID Natural Earth source',
        changed_ids=sorted(additions), corridors=corridors, encoding=encodings,
        filled_area_km2=area_km2(shapely.union_all(list(additions.values()))),
        original_territory_retained=True, properties_unchanged=True, owners_unchanged=True,
        unrelated_geometry_exact=True, auxiliary_geometry_exact=True,
        overlap_area_tolerance_degrees2=AREA_EPSILON, full_boundary_pairs=diagnostics,
        full_boundary_pairs_checked=len(pairs), new_t_junctions=junctions,
        target_joint_coverage_valid=bool(joint_valid), assembly_group_count=len(groups),
        area_method='laea_densified_linear_lonlat_edges', measurement_max_segment_length_degrees=0.001,
        required_validation=['rebuilt_runtime_geometry_and_metadata_valid', 'full_boundary_mixed_lod_no_regression'])


def read_reviewed_sources(source_dir):
    source_dir = Path(source_dir).resolve()
    identities = {}
    for name, expected in REVIEWED_SHA256.items():
        digest = hashlib.sha256((source_dir / name).read_bytes()).hexdigest()
        if digest != expected:
            raise ValueError(f'Reviewed source bytes changed: {name}')
        identities[name] = digest
    source = gpd.read_file(source_dir / 'ne_10m_admin_1_states_provinces.shp', bbox=EXTENT)
    lakes = gpd.read_file(source_dir / 'global_lakes.geojson')
    rivers = gpd.read_file(source_dir / 'global_rivers.geojson')
    if any(frame.crs is None or frame.crs.to_epsg() != 4326 for frame in (lakes, rivers)):
        raise ValueError('Water sources require EPSG:4326')
    polygons = [g for frame in (lakes, rivers) for g in frame.geometry if g.geom_type in {'Polygon', 'MultiPolygon'}]
    if any(not g.is_valid for g in polygons):
        raise ValueError('Invalid polygonal protected water')
    return source, shapely.union_all(polygons), dict(directory=str(source_dir), sha256=identities,
        natural_earth_version=(source_dir / 'ne_10m_admin_1_states_provinces.VERSION.txt').read_text().strip(),
        lake_polygon_count=len(lakes), river_polygon_count=sum(g.geom_type in {'Polygon', 'MultiPolygon'} for g in rivers.geometry),
        river_line_count=sum(g.geom_type in {'LineString', 'MultiLineString'} for g in rivers.geometry),
        invalid_river_line_count=int((~rivers.is_valid).sum()),
        river_policy='Line rivers are recorded, never buffered into invented polygonal exclusions.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario-dir', required=True, type=Path)
    parser.add_argument('--topology', type=Path, help='Optional prior candidate to compose with this restoration')
    parser.add_argument('--source-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    report_path = output.with_suffix('.report.json')
    if not output.is_relative_to((ROOT / '.runtime').resolve()):
        raise ValueError('Candidate output must be inside this workspace .runtime')
    if output == report_path or output.exists() or report_path.exists():
        raise FileExistsError('Candidate and report paths must both be new')
    topology_path = resolve_json_source_path((args.topology or args.scenario_dir / 'runtime_topology.topo.json').resolve())
    baseline = read_json_source(topology_path)
    owners = json.loads((args.scenario_dir / 'owners.by_feature.json').read_text(encoding='utf-8'))['owners']
    source, protected_water, identities = read_reviewed_sources(args.source_dir)
    candidate, report = build_candidate(baseline, owners, source, protected_water=protected_water)
    report['sources'] = identities
    report['input_topology'] = dict(path=str(topology_path), sha256=json_source_sha256(topology_path))
    report['replay_argv'] = ['node', 'tools/run_python.mjs', 'tools/repair_tno_levant_seams.py',
        '--scenario-dir', str(args.scenario_dir.resolve()), '--topology', str(topology_path),
        '--source-dir', str(args.source_dir.resolve()), '--output', str(output)]
    report['sidecar_policy'] = 'owners, controllers and cores sidecars are inputs only and are never rewritten'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(candidate, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status', 'changed_ids', 'filled_area_km2', 'full_boundary_pairs_checked')}))


if __name__ == '__main__':
    main()
