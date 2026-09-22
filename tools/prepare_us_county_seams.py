"""Candidate-only county seams constrained by unchanged neighboring domains.

This is an explicit display precedence policy, not a claim that a cartographic
baseline establishes an international boundary. Never fills gaps or repairs
invalid neighbors. The original Census source and its report remain unchanged.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import shapely
from shapely.geometry import mapping, shape, box
from map_builder.regional_geometry import _absolute_topology
from map_builder.io.writers import write_json_atomic
from tools.stage_us_county_scenario import baseline_surface, validate_source_report
from tools.prepare_tno_russia_precision import read, digest

# Re-intersecting GEOS overlay output can leave floating-point area at shared
# edges. 1e-12 square degrees is below 0.013 m2 even at the equator; record the
# measured residual and never snap, buffer, or discard a polygon to meet it.
OVERLAY_ROUNDOFF_AREA_DEGREES2 = 1e-12


def constrain_seams(source, baseline):
    features = source['features']
    geometries = [shape(f['geometry']) for f in features]
    if any(g.is_empty or not g.is_valid or g.geom_type not in {'Polygon', 'MultiPolygon'} for g in geometries):
        raise ValueError('Invalid county polygon')
    if not shapely.coverage_is_valid(geometries):
        raise ValueError('Invalid source county coverage')
    tree = shapely.STRtree(geometries)
    absolute = _absolute_topology(baseline)
    groups = {f['properties']['admin1_group'] for f in features}
    masks, findings, old_valid, old_invalid = [], [], [], []
    for row in absolute['objects']['political']['geometries']:
        props = row['properties']
        geom, _ = baseline_surface(absolute, row)
        target = props.get('cntr_code') == 'US' and props.get('admin1_group') in groups
        if target:
            if geom is not None and geom.is_valid:
                old_valid.append(geom)
            else:
                old_invalid.append(props['id'])
            continue
        if geom is None or geom.is_empty:
            raise ValueError(f"Empty neighbor geometry: {props['id']}")
        nearby = tree.query(box(*geom.bounds))
        if not len(nearby):
            continue
        if not geom.is_valid:
            raise ValueError(f"Invalid neighbor near source: {props['id']}")
        overlap = geom.intersection(shapely.union_all([geometries[i] for i in nearby]))
        if overlap.area > 0:
            masks.append(geom)
            findings.append({'id': props['id'], 'country': props.get('cntr_code'),
                             'overlap_area_degrees2': overlap.area, '_geometry': geom,
                             'county_ids': [features[i]['properties']['id'] for i in nearby
                                            if geom.intersection(geometries[i]).area > 0]})
    old_union = shapely.union_all(old_valid)
    for finding in findings:
        neighbor = finding.pop('_geometry')
        inherited = neighbor.intersection(old_union)
        finding['legacy_overlap_area_degrees2'] = inherited.area
        finding['legacy_comparison_complete'] = not bool(old_invalid)
    mask = shapely.union_all(masks)
    mask_tree = shapely.STRtree(masks)
    output, changes, clipped = deepcopy(source), [], []
    roundoff = []
    for feature, original in zip(output['features'], geometries):
        local_mask = shapely.union_all([masks[i] for i in mask_tree.query(original, predicate='intersects')])
        overlap = original.intersection(local_mask)
        geometry = original.difference(local_mask) if overlap.area > 0 else original
        if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in {'Polygon', 'MultiPolygon'}:
            raise ValueError(f"Seam clipping erased or invalidated county: {feature['properties']['id']}")
        added_area = geometry.difference(original).area
        remaining_area = geometry.intersection(local_mask).area
        if added_area > OVERLAY_ROUNDOFF_AREA_DEGREES2 or remaining_area > OVERLAY_ROUNDOFF_AREA_DEGREES2:
            raise ValueError(f"Seam clipping changed domain incorrectly: {feature['properties']['id']}: added={added_area}, remaining={remaining_area}")
        if added_area or remaining_area:
            roundoff.append({'id': feature['properties']['id'], 'added_area_degrees2': added_area,
                             'remaining_overlap_area_degrees2': remaining_area})
        if overlap.area > 0:
            feature['geometry'] = mapping(geometry)
            changes.append({'id': feature['properties']['id'], 'removed_area_degrees2': overlap.area})
        clipped.append(geometry)
    if not shapely.coverage_is_valid(clipped):
        raise ValueError('Clipped county coverage is invalid; no snapping or repair permitted')
    remaining = shapely.union_all(clipped).intersection(mask).area
    if remaining > OVERLAY_ROUNDOFF_AREA_DEGREES2:
        raise ValueError('Positive-area foreign overlap remains')
    return output, {
        'policy': 'preserve_unchanged_neighbor_domains', 'candidate_only': True,
        'boundary_authority_claim': False, 'foreign_overlaps_before': findings,
        'foreign_overlap_area_after_degrees2': remaining, 'changed_counties': changes,
        'removed_union_area_degrees2': shapely.union_all(geometries).intersection(mask).area,
        'invalid_legacy_ids': sorted(old_invalid), 'coverage_valid': True,
        'county_count': len(features), 'release_ready': False,
        'overlay_roundoff_area_limit_degrees2': OVERLAY_ROUNDOFF_AREA_DEGREES2,
        'overlay_roundoff': roundoff,
    }


def prepare(source_path, baseline_path, output_dir):
    source_path, baseline_path, output_dir = map(Path, (source_path, baseline_path, output_dir))
    output_dir = output_dir.resolve()
    if output_dir.exists() or not output_dir.is_relative_to((ROOT / '.runtime').resolve()):
        raise ValueError('Use a new candidate directory under .runtime')
    source = read(source_path)
    source_report = validate_source_report(source_path, source)
    candidate, report = constrain_seams(source, read(baseline_path))
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='.county-seams-', dir=output_dir.parent) as temporary:
        stage = Path(temporary) / 'output'
        stage.mkdir()
        candidate_path = stage / 'counties.geojson'
        write_json_atomic(candidate_path, candidate, indent=None, separators=(',', ':'))
        report.update(source_sha256=digest(source_path), baseline_runtime_sha256=digest(baseline_path),
                      candidate_sha256=digest(candidate_path))
        updated = constrained_source_report(source_report, candidate, candidate_path, report)
        write_json_atomic(stage / 'source-report.json', updated, indent=2)
        write_json_atomic(stage / 'seam-report.json', report, indent=2)
        stage.rename(output_dir)
    return report


def constrained_source_report(upstream, candidate, candidate_path, seam_report):
    """Keep original source measurements separate from constrained display stats."""
    states = []
    for state in upstream['states']:
        features = [f for f in candidate['features'] if f['properties']['STATEFP'] == state['statefp']]
        geometries = [shape(f['geometry']) for f in features]
        states.append({'statefp': state['statefp'], 'source_geoids': state['source_geoids'],
                       'display_geoids': [f['properties']['GEOID'] for f in features],
                       'geometry_invalid_count': sum(not g.is_valid for g in geometries),
                       'coverage_valid': bool(shapely.coverage_is_valid(geometries)),
                       'display_coordinates': int(shapely.get_num_coordinates(geometries).sum()),
                       'display_counties': len(features)})
    return {'status': 'candidate', 'crs': upstream.get('crs', 'EPSG:4326'),
            'states': states, 'sources': upstream.get('sources', []),
            'upstream_source_report': upstream,
            'upstream_display_geojson_sha256': seam_report['source_sha256'],
            'display_geojson_sha256': digest(candidate_path),
            'display_geojson_bytes': candidate_path.stat().st_size,
            'display_counties': len(candidate['features']),
            'display_coordinates': sum(s['display_coordinates'] for s in states),
            'global_coverage_valid': seam_report['coverage_valid'],
            'seam_constraint': seam_report}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--county-source', type=Path, required=True)
    parser.add_argument('--baseline-runtime', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    result = prepare(args.county_source, args.baseline_runtime, args.output_dir)
    print({key: result[key] for key in ('county_count', 'removed_union_area_degrees2',
                                       'foreign_overlap_area_after_degrees2', 'coverage_valid')})
