"""Restore source-supported SK territory in two explicitly reviewed SK/UA gaps.

Only the intersection with the same-ID Slovak administrative source is restored.
The remaining missing land has no established owner and stays unassigned. This
does not interpolate a new historical boundary or transfer territory to UA.

Source restoration does not certify coarse/detail transitions. The four
restoration IDs declare precision to avoid independent coarse rounding, but
that does not certify neighboring LOD boundaries or global coverage. Rebuilt
runtime validation and full-boundary mixed-LOD checks remain release gates.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import Point, box

from map_builder.json_source import read_json_source
from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.geo.measurement import densify_for_measurement
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry

EXTENT = (22.0, 48.25, 22.65, 49.05)
AREA_EPSILON = 1e-12  # Overlay roundoff, consistent with reviewed_seam.
SK_PREFIX = 'SK_ADM2_'
UA_PREFIX = 'UA_RAY_'
REVIEWED_SOURCE_SHA256 = 'ccc6ae7bda2b88f0b7cb56fa6048ffeb1de178d80fcdb9d58956087b29406261'
REVIEWED_SOURCE_URL = 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/SVK/ADM2/geoBoundaries-SVK-ADM2.geojson'
REVIEWED_GAPS = (
    dict(name='uzhhorod_north', seed=(22.399827126373165, 48.710306607414715),
         bounds=(22.156421564215663, 48.5169181063811, 22.468130517615577, 48.90238636631952),
         area_range_km2=(267.0, 269.0),
         contacts={SK_PREFIX + '56367889B14569056094647': ('SK', 'SLO'),
                   SK_PREFIX + '56367889B66923754975257': ('SK', 'SLO'),
                   SK_PREFIX + '56367889B97606993013938': ('SK', 'SLO'),
                   UA_PREFIX + '74538382B40204965193592': ('UA', 'HUN'),
                   UA_PREFIX + '74538382B51879903679765': ('UA', 'HUN'),
                   UA_PREFIX + '74538382B77535249747568': ('UA', 'HUN')}),
    dict(name='uzhhorod_south', seed=(22.13344836151066, 48.38970461198667),
         bounds=(22.124021240212414, 48.38464722347224, 22.139329501403132, 48.393326415264156),
         area_range_km2=(0.25, 0.27),
         contacts={SK_PREFIX + '56367889B65708067786299': ('SK', 'HUN'),
                   UA_PREFIX + '74538382B77535249747568': ('UA', 'HUN')}),
)


def area_km2(geometry):
    # Project a measurement-only copy so long straight lon/lat edges do not
    # change area merely because a source overlay inserts collinear vertices.
    measurement = densify_for_measurement(geometry, 0.001)
    return float(gpd.GeoSeries([measurement], crs=4326).to_crs(3035).area.iloc[0] / 1e6)


def _source_geometries(source):
    if source.crs is None or source.crs.to_epsg() != 4326:
        raise ValueError('Slovak source requires explicit EPSG:4326 CRS')
    if 'shapeID' not in source or source.shapeID.isna().any():
        raise ValueError('Slovak source requires nonempty shapeID')
    ids = source.shapeID.astype(str)
    if not ids.is_unique or any(not fid.strip() for fid in ids):
        raise ValueError('Slovak source shapeID must be unique and nonempty')
    if any(g is None or g.is_empty or not g.is_valid or g.geom_type not in {'Polygon', 'MultiPolygon'}
           for g in source.geometry):
        raise ValueError('Slovak source must contain valid nonempty polygonal geometry')
    return dict(zip(SK_PREFIX + ids, source.geometry))


def _polygonal(geometry):
    polygons = []
    for part in shapely.get_parts(geometry):
        if part.geom_type == 'Polygon':
            polygons.append(part)
        elif part.geom_type == 'GeometryCollection':
            polygons.extend(shapely.get_parts(_polygonal(part)))
    return shapely.union_all(polygons)


def _overlap_diagnostic(pair, old, new):
    old_overlap, new_overlap = _polygonal(old), _polygonal(new)
    difference = old_overlap.symmetric_difference(new_overlap).area
    if difference > AREA_EPSILON:
        raise ValueError(f'Existing pair overlap geometry changed: {pair}; {difference} deg2')
    return dict(ids=list(pair), old_area_degrees2=old_overlap.area,
                new_area_degrees2=new_overlap.area,
                symmetric_difference_area_degrees2=difference,
                geometry_equal=old_overlap.equals(new_overlap),
                hausdorff_degrees=(None if old_overlap.is_empty or new_overlap.is_empty
                                   else old_overlap.hausdorff_distance(new_overlap)))


def _merge_precision_ids(topology, changed_ids):
    existing_ids = {row['properties']['id'] for row in topology['objects']['political']['geometries']}
    declared = topology.get('political_precision_feature_ids', [])
    if (not isinstance(declared, list)
            or any(not isinstance(value, str) or not value.strip() or value != value.strip()
                   for value in declared)
            or len(set(declared)) != len(declared)
            or set(declared) - existing_ids):
        raise ValueError('Baseline political_precision_feature_ids must contain unique existing string IDs')
    if set(changed_ids) - existing_ids:
        raise ValueError('Precision targets must be existing political IDs')
    return [*declared, *sorted(set(changed_ids) - set(declared))]


def _reviewed_gaps(absolute, owners):
    extent = box(*EXTENT)
    rows, geometries = {}, {}
    for row in absolute['objects']['political']['geometries']:
        fid = row['properties']['id']
        if fid in rows:
            raise ValueError('Duplicate political ID')
        rows[fid] = row
        geometry = _decode_geometry(absolute, row)
        geometries[fid] = geometry
    local = {fid: g for fid, g in geometries.items() if g.intersects(extent)}
    occupied = shapely.union_all([g.intersection(extent) for g in local.values()])
    gaps = list(shapely.get_parts(extent.difference(occupied)))
    land = _decode_geometry(absolute, absolute['objects']['land_mask']).intersection(extent)
    exclusions = [_decode_geometry(absolute, absolute['objects'][name]).intersection(extent)
                  for name in ('scenario_water', 'scenario_atlantropa')]
    allowed = land.difference(shapely.union_all(exclusions))
    reviewed = []
    for spec in REVIEWED_GAPS:
        name = spec['name']
        matches = [gap for gap in gaps if gap.covers(Point(spec['seed']))]
        if len(matches) != 1:
            raise ValueError(f'{name}: reviewed gap missing or ambiguous')
        gap = matches[0]
        if gap.geom_type != 'Polygon' or not gap.is_valid or gap.intersects(extent.boundary):
            raise ValueError(f'{name}: gap must be valid and enclosed')
        if (any(abs(a - b) > 1e-9 for a, b in zip(gap.bounds, spec['bounds']))
                or not spec['area_range_km2'][0] <= area_km2(gap) <= spec['area_range_km2'][1]):
            raise ValueError(f'{name}: gap bounds or area changed')
        contacts = {fid for fid, geom in local.items()
                    if gap.boundary.intersection(geom.boundary).length > 1e-12}
        if contacts != set(spec['contacts']):
            raise ValueError(f'{name}: reviewed contact IDs changed: {sorted(contacts)}')
        for fid, (country, owner) in spec['contacts'].items():
            props = rows[fid]['properties']
            if (props.get('interactive') is False or props.get('scenario_helper_kind')
                    or fid.upper().startswith('RU_ARCTIC_FB_')
                    or 'shell fallback' in str(props.get('name', '')).lower()):
                raise ValueError(f'{name}: helper or noninteractive contact: {fid}')
            if props.get('cntr_code') != country or owners.get(fid) != owner:
                raise ValueError(f'{name}: source country or expected owner changed for {fid}')
        if (gap.difference(allowed).area > AREA_EPSILON
                or gap.boundary.intersection(allowed.boundary).length > 1e-12):
            raise ValueError(f'{name}: protected water, Atlantropa or land-mask boundary')
        reviewed.append((spec, gap))
    return rows, geometries, occupied, allowed, reviewed


def build_candidate(baseline, owners, source):
    """Accept owners and source whose reviewed byte identity the caller verified.

    The CLI enforces that identity in _read_reviewed_source; synthetic callers
    can supply explicit source frames to exercise the geometry algorithm.
    """
    sources = _source_geometries(source)
    absolute = _absolute_topology(baseline)
    rows, geometries, occupied, allowed, reviewed = _reviewed_gaps(absolute, owners)
    # Validate the old declaration before any geometry assembly.
    _merge_precision_ids(baseline, [])
    additions, reports = {}, []
    for spec, gap in reviewed:
        assignments = []
        for fid, (country, owner) in sorted(spec['contacts'].items()):
            if country != 'SK':
                continue
            if fid not in sources:
                raise ValueError(f'Missing same-ID Slovak source: {fid}')
            addition = _polygonal(sources[fid].intersection(gap))
            if addition.is_empty or not addition.is_valid:
                raise ValueError(f'No valid source-supported restoration: {fid}')
            if (addition.intersection(occupied).area > AREA_EPSILON
                    or addition.difference(allowed).area > AREA_EPSILON):
                raise ValueError(f'New overlap or protected-surface incursion: {fid}')
            additions[fid] = addition
            assignments.append(dict(id=fid, owner=owner, area_km2=area_km2(addition)))
        reports.append(dict(name=spec['name'], area_before_km2=area_km2(gap),
                            contact_ids=sorted(spec['contacts']), assignments=assignments))
    if not coverage_is_valid_exact(additions.values()):
        raise ValueError('Source-supported additions do not form exact coverage')
    # Baseline SK targets already overlap outside these reviewed gaps. Preserve
    # those existing polygons; each singleton still passes the shared assembler's
    # validity/encoding guards. New additions are checked jointly above.
    old_targets = [geometries[fid] for fid in sorted(additions)]
    candidate, encoding = baseline, []
    updated = {}
    for fid, addition in sorted(additions.items()):
        geometry = geometries[fid].union(addition)
        if geometries[fid].difference(geometry).area > AREA_EPSILON:
            raise ValueError(f'Original territory lost: {fid}')
        frame = gpd.GeoDataFrame([dict(id=fid, geometry=geometry)], crs=4326)
        candidate, diagnostic = replace_regional_geometry(candidate, frame, source_countries=['SK'])
        encoding.append(diagnostic)
        updated[fid] = geometry
    result = _absolute_topology(candidate)
    after = {}
    for row in result['objects']['political']['geometries']:
        fid = row['properties']['id']
        if row['properties'] != rows[fid]['properties']:
            raise ValueError(f'Political attributes changed: {fid}')
        geometry = _decode_geometry(result, row)
        if fid in geometries:
            after[fid] = geometry
            if fid not in additions and not geometry.equals_exact(geometries[fid], 0):
                raise ValueError(f'Unrelated geometry changed: {fid}')
    extent = box(*EXTENT)
    local_after = {fid: g for fid, g in after.items() if g.intersects(extent)}
    new_union = shapely.union_all([g.intersection(extent) for g in local_after.values()])
    restored = shapely.union_all(list(additions.values()))
    if new_union.symmetric_difference(occupied.union(restored)).area > AREA_EPSILON:
        raise ValueError('Candidate coverage differs from source-supported additions')
    for fid in additions:
        actual_addition = after[fid].difference(geometries[fid])
        other = shapely.union_all([g.intersection(extent) for other_id, g in local_after.items() if other_id != fid])
        if actual_addition.intersection(other).area > AREA_EPSILON:
            raise ValueError(f'Candidate introduced overlap: {fid}')
    overlap_pairs, checked_pairs, t_junctions = [], set(), []
    maximum_overlap_residual = 0.0
    feature_ids = list(after)
    before_tree = shapely.STRtree([geometries[fid] for fid in feature_ids])
    after_tree = shapely.STRtree([after[fid] for fid in feature_ids])
    for fid in sorted(additions):
        neighbors = {feature_ids[int(index)] for index in before_tree.query(geometries[fid], predicate='intersects')}
        neighbors.update(feature_ids[int(index)] for index in after_tree.query(after[fid], predicate='intersects'))
        for other_id in sorted(neighbors):
            pair = tuple(sorted((fid, other_id)))
            if fid == other_id or pair in checked_pairs:
                continue
            checked_pairs.add(pair)
            old_overlap = geometries[fid].intersection(geometries[other_id])
            new_overlap = after[fid].intersection(after[other_id])
            diagnostic = _overlap_diagnostic(pair, old_overlap, new_overlap)
            maximum_overlap_residual = max(maximum_overlap_residual,
                                          diagnostic['symmetric_difference_area_degrees2'])
            if diagnostic['old_area_degrees2'] or diagnostic['new_area_degrees2']:
                overlap_pairs.append(diagnostic)
        new_coordinates = set(map(tuple, shapely.get_coordinates(after[fid]))) - set(
            map(tuple, shapely.get_coordinates(geometries[fid])))
        for other_id in sorted(neighbors):
            if other_id == fid:
                continue
            geometry = after[other_id]
            other_vertices = set(map(tuple, shapely.get_coordinates(geometry)))
            for xy in sorted(new_coordinates - other_vertices):
                if geometry.boundary.covers(Point(xy)):
                    t_junctions.append(dict(id=fid, adjacent_id=other_id, coordinate=list(xy)))
    for name, obj in absolute['objects'].items():
        if name != 'political' and not _decode_geometry(absolute, obj).equals_exact(
                _decode_geometry(result, result['objects'][name]), 0):
            raise ValueError(f'Auxiliary geometry changed: {name}')
    reviewed_union = shapely.union_all([gap for _, gap in reviewed])
    source_residual = restored.difference(new_union)
    if source_residual.area > AREA_EPSILON:
        raise ValueError('Source-supported territory remains missing')
    for report, (_, gap) in zip(reports, reviewed):
        report['area_after_km2'] = area_km2(gap.difference(new_union))
    candidate['political_precision_feature_ids'] = _merge_precision_ids(baseline, additions)
    return candidate, dict(
        status='PASS_SOURCE_SUPPORTED_RESTORATION', rule='same-ID SK source intersection only',
        release_ready=False,
        area_method='epsg3035_densified_linear_lonlat_edges',
        measurement_max_segment_length_degrees=0.001,
        required_validation=['rebuilt_runtime_geometry_and_metadata_valid',
                             'full_boundary_mixed_lod_no_regression'],
        boundary_note='Remaining gap has no established owner; no historical boundary interpolation.',
        corridors=reports, changed_ids=sorted(additions), encoding=encoding,
        political_precision_feature_ids=candidate['political_precision_feature_ids'],
        precision_ids_added=sorted(set(additions) - set(baseline.get('political_precision_feature_ids', []))),
        filled_area_km2=area_km2(restored), residual_area_km2=area_km2(reviewed_union.difference(new_union)),
        source_supported_residual_area_km2=area_km2(source_residual),
        baseline_coverage_valid=bool(coverage_is_valid_exact(old_targets)),
        candidate_coverage_valid=bool(coverage_is_valid_exact([after[fid] for fid in sorted(additions)])),
        coverage_check_scope='four SK targets; existing overlaps retained, not certified as joint coverage',
        preexisting_overlaps_retained=True, preexisting_overlap_pairs=overlap_pairs,
        overlap_pairs_checked=len(checked_pairs),
        overlap_geometry_equal_within_area_tolerance=True,
        overlap_area_tolerance_degrees2=AREA_EPSILON,
        maximum_overlap_symmetric_difference_degrees2=maximum_overlap_residual,
        new_t_junctions=t_junctions,
        additions_coverage_valid=True, unrelated_geometry_exact=True,
        original_territory_retained=True, properties_unchanged=True, owners_unchanged=True,
        new_overlap_area_checked_within_tolerance=True)


def _output_paths(path):
    output = path.resolve()
    if not output.is_relative_to((ROOT / '.runtime').resolve()):
        raise ValueError('Output must be inside this workspace .runtime directory')
    report = output.with_suffix('.report.json')
    if output == report or output.exists() or report.exists():
        raise FileExistsError('Candidate and report paths must both be new')
    return output, report


def _read_reviewed_source(path):
    path = path.resolve()
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != REVIEWED_SOURCE_SHA256:
        raise ValueError('Slovak source differs from the explicitly reviewed source SHA256')
    metadata = dict(path=str(path), sha256=digest, reviewed_source_url=REVIEWED_SOURCE_URL,
                    reviewed_source_version='geoBoundaries 9469f09 / SVK ADM2')
    provenance_path = path.with_suffix('.provenance.json')
    if provenance_path.exists():
        provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
        if provenance.get('sha256') and provenance['sha256'] != digest:
            raise ValueError('Slovak source does not match its provenance SHA256')
        metadata['provenance'] = provenance
    return gpd.read_file(io.BytesIO(data)), metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-dir', required=True, type=Path)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output, report_path = _output_paths(args.output)
    baseline = read_json_source(args.baseline_dir / 'runtime_topology.topo.json')
    owners = json.loads((args.baseline_dir / 'owners.by_feature.json').read_text(encoding='utf-8'))['owners']
    source, source_metadata = _read_reviewed_source(args.source)
    candidate, report = build_candidate(baseline, owners, source)
    report['source'] = source_metadata
    payload = json.dumps(candidate, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    report_payload = json.dumps(report, indent=2, allow_nan=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as handle:
        handle.write(payload)
    with report_path.open('x', encoding='utf-8') as handle:
        handle.write(report_payload)
    print(json.dumps({key: report[key] for key in ('status', 'changed_ids', 'filled_area_km2', 'residual_area_km2')}))


if __name__ == '__main__':
    main()
