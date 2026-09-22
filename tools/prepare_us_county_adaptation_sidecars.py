"""Prepare explicit sidecar plans for county overlays; never publish a bundle.

Unresolved references suppress the entire affected output file. Crosswalks are
scenario-local subdivisions, not modern county identity or historical authority.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / '.runtime/tmp/us-county-upgrade/source-national-verified/counties.geojson'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build_crosswalk(baseline_ids, replaced_ids, features):
    baseline = set(baseline_ids)
    replaced = set(replaced_ids)
    if not replaced <= baseline:
        raise ValueError('Replacement IDs are absent from baseline')
    crosswalk = {fid: [fid] for fid in sorted(baseline - replaced)}
    children, geometries = {}, {}
    for feature in features:
        lineage = feature['lineage']
        old = lineage['old_feature_id']
        child = feature['properties']['id']
        if old not in replaced or child in geometries or child in baseline:
            raise ValueError(f'Invalid or colliding child lineage: {child}')
        if feature.get('id') != child or lineage.get('piece_id') != child:
            raise ValueError(f'Inconsistent child ID: {child}')
        geometry = shape(feature['geometry'])
        if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in {'Polygon', 'MultiPolygon'}:
            raise ValueError(f'Invalid child geometry: {child}')
        children.setdefault(old, []).append(child)
        geometries[child] = geometry
    if set(children) != replaced:
        raise ValueError('Replacement coverage does not match overlay lineage')
    crosswalk.update({old: sorted(ids) for old, ids in children.items()})
    return crosswalk, geometries


def expand_assignments(values, crosswalk):
    result = {}
    for old, value in values.items():
        for child in crosswalk.get(old, [old]):
            if child in result:
                raise ValueError(f'Assignment collision: {child}')
            result[child] = deepcopy(value)
    return result


def adapt_hosts(value, crosswalk, geometries, unresolved, path='', *, require_point=False):
    """Only host_feature_id has this schema; other ID fields are not guessed."""
    if isinstance(value, list):
        for index, item in enumerate(value):
            adapt_hosts(item, crosswalk, geometries, unresolved, f'{path}/{index}', require_point=require_point)
    elif isinstance(value, dict):
        old = value.get('host_feature_id')
        if isinstance(old, str) and old in crosswalk and crosswalk[old] != [old]:
            candidates = crosswalk[old]
            lon, lat = value.get('lon'), value.get('lat')
            has_point = all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in (lon, lat))
            matches = [fid for fid in candidates if geometries[fid].covers(Point(lon, lat))] if has_point else []
            if not has_point and len(candidates) == 1 and not require_point:
                matches = candidates
            if len(matches) == 1:
                value['host_feature_id'] = matches[0]
            else:
                unresolved.append({'field': path + '/host_feature_id', 'old_id': old,
                                   'reason': 'missing_coordinates' if not has_point else 'non_unique_point_cover',
                                   'matching_children': matches})
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                adapt_hosts(item, crosswalk, geometries, unresolved, f'{path}/{key}', require_point=require_point)


def remaining_references(value, replaced, path=''):
    result = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in replaced:
                result.append({'field': path + '/' + key, 'old_id': key, 'reason': 'unsupported_reference'})
            result.extend(remaining_references(item, replaced, path + '/' + key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            result.extend(remaining_references(item, replaced, f'{path}/{index}'))
    elif isinstance(value, str) and value in replaced:
        result.append({'field': path, 'old_id': value, 'reason': 'unsupported_reference'})
    return result


def adapt_asset(name, payload, crosswalk, geometries):
    result = deepcopy(payload)
    unresolved = []
    if name == 'strategic_values.by_feature.json':
        result['bucket_by_feature'] = expand_assignments(result['bucket_by_feature'], crosswalk)
        adapt_hosts(result.get('victory_points', []), crosswalk, geometries, unresolved, '/victory_points', require_point=True)
        for key in ('buckets', 'metrics', 'resource_points'):
            if result.get(key) != payload.get(key):
                raise ValueError(f'Strategic aggregate changed: {key}')
    elif name == 'scenario_mutations.json':
        if 'assignments_by_feature_id' in result:
            result['assignments_by_feature_id'] = expand_assignments(result['assignments_by_feature_id'], crosswalk)
        # Overlay children inherit historical parent names, not modern county names.
        # Only the verified bilingual-label schema is eligible for this policy.
        if 'geo_locale' in result:
            labels = result['geo_locale']
            eligible = {old: ids for old, ids in crosswalk.items()
                        if old in labels and isinstance(labels[old], dict)
                        and set(labels[old]) <= {'en', 'zh'}
                        and all(isinstance(value, str) for value in labels[old].values())}
            result['geo_locale'] = expand_assignments(labels, eligible)
    elif name in {'city_overrides.json', 'capital_hints.json', 'victory_points.json'}:
        adapt_hosts(result, crosswalk, geometries, unresolved, require_point=name == 'victory_points.json')
    else:
        raise ValueError(f'Unsupported sidecar: {name}')
    replaced = {old for old, children in crosswalk.items() if children != [old]}
    known_paths = {row['field'] for row in unresolved}
    unresolved.extend(row for row in remaining_references(result, replaced) if row['field'] not in known_paths)
    return result, unresolved


def run(adaptation_dir, output_dir, *, source_path=DEFAULT_SOURCE, root=ROOT):
    adaptation_dir, output_dir, root = Path(adaptation_dir), Path(output_dir), Path(root)
    runtime_root = (root / '.runtime').resolve()
    if not output_dir.resolve().is_relative_to(runtime_root) or output_dir.resolve() == runtime_root:
        raise ValueError('Output must be a new candidate directory under .runtime')
    if output_dir.exists():
        raise ValueError('Output directory must be new')
    source_hash = digest(source_path)
    if read(Path(source_path).with_name('source-report.json')).get('display_geojson_sha256') != source_hash:
        raise ValueError('Source report hash mismatch')
    entries = []
    for report_path in sorted(adaptation_dir.glob('*/adaptation.report.json')):
        report = read(report_path)
        sid = report['scenario_id']
        if sid != report_path.parent.name:
            raise ValueError('Scenario ID/directory mismatch')
        scenario_dir = root / 'data/scenarios' / sid
        manifest = read(scenario_dir / 'manifest.json')
        baseline_path = root / manifest['runtime_topology_url']
        if report['baseline_sha256'] != digest(baseline_path) or report['source_sha256'] != source_hash:
            raise ValueError(f'Stale adaptation input hashes: {sid}')
        topology = read(baseline_path)
        baseline_ids = [row['properties']['id'] for row in topology['objects']['political']['geometries']]
        overlay_path = report_path.parent / 'county_overlay.geojson'
        crosswalk, geometries = build_crosswalk(baseline_ids, report['replaced_old_ids'], read(overlay_path)['features'])
        assets = []
        for name in ('strategic_values.by_feature.json', 'victory_points.json', 'city_overrides.json', 'capital_hints.json', 'scenario_mutations.json'):
            path = scenario_dir / name
            if path.exists():
                adapted, unresolved = adapt_asset(name, read(path), crosswalk, geometries)
                assets.append((name, adapted, {'file': name, 'input_sha256': digest(path),
                               'status': 'unresolved' if unresolved else 'adapted', 'unresolved': unresolved}))
        entries.append((sid, crosswalk, assets, {'scenario_id': sid, 'candidate_only': True, 'release_ready': False,
            'scope': 'Known sidecar plan only; runtime, hierarchy, chunks and complete bundle are not produced',
            'label_policy': 'Inherited historical en/zh labels; no modern county renaming',
            'baseline_sha256': report['baseline_sha256'], 'source_sha256': source_hash,
            'overlay_sha256': digest(overlay_path), 'adaptation_report_sha256': digest(report_path),
            'replaced_old_id_count': len(report['replaced_old_ids']),
            'identity_count': sum(ids == [old] for old, ids in crosswalk.items()),
            'assets': [row[2] for row in assets]}))
    if not entries:
        raise ValueError('No adaptation reports found')
    output_dir.mkdir(parents=True)
    summary = []
    for sid, crosswalk, assets, report in entries:
        destination = output_dir / sid
        destination.mkdir()
        write(destination / 'crosswalk.json', {'scenario_id': sid, 'old_to_new': crosswalk})
        for name, adapted, asset_report in assets:
            if asset_report['status'] == 'adapted':
                write(destination / name, adapted)
        report['sidecar_plan_passed'] = all(row[2]['status'] == 'adapted' for row in assets)
        write(destination / 'sidecars.report.json', report)
        summary.append({'scenario_id': sid, 'sidecar_plan_passed': report['sidecar_plan_passed'],
                        'unresolved_references': sum(len(row[2]['unresolved']) for row in assets), 'release_ready': False})
    write(output_dir / 'summary.json', summary)
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adaptation-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--county-source', type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    print(json.dumps(run(args.adaptation_dir, args.output_dir, source_path=args.county_source), indent=2))
