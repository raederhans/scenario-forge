"""Normalize duplicate Russian surfaces before same-ID national refinement.

Normalization is a separately audited geometry repair, not an owner-map rewrite.
The normalized snapshot becomes the frozen domain contract for refinement.
"""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import shape, mapping

from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry
from tools.prepare_tno_russia_precision import build_inventory, digest, parent_id, read, safe_output
from tools.pilot_tno_russia_precision import build_candidate, boundary_equal


def verify_normalized_coverage(old, normalized, protected):
    """Independent conservation gate; normalization may remove duplicates only."""
    if set(old) != set(normalized):
        raise ValueError('Normalization erased or introduced an ID')
    values = list(normalized.values())
    if any(g.is_empty or not g.is_valid or g.geom_type not in {'Polygon', 'MultiPolygon'} for g in values):
        raise ValueError('Normalization produced empty or invalid geometry')
    coverage_verification = {}
    if not coverage_is_valid_exact(values, coverage_verification):
        raise ValueError('Normalized Russian coverage is invalid')
    protected_union = shapely.union_all(list(protected.values()))
    expected = shapely.union_all(list(old.values())).difference(protected_union)
    actual = shapely.union_all(values)
    if not boundary_equal(expected, actual):
        raise ValueError('Normalization changed the national union beyond protected overlaps')
    ids = sorted(old)
    old_values = [old[i] for i in ids]
    tree = shapely.STRtree(old_values)
    removed = []
    for fid, before in old.items():
        after = normalized[fid]
        expansion = after.difference(before)
        if not expansion.is_empty and not (
                expansion.area <= 1e-10 and before.boundary.buffer(1e-9).covers(expansion)):
            raise ValueError(f'Normalization expanded {fid}')
        neighbors = [old_values[int(j)] for j in tree.query(before, predicate='intersects') if ids[int(j)] != fid]
        duplicate = shapely.union_all([*neighbors, protected_union])
        exclusive = before.difference(duplicate)
        loss = exclusive.difference(after)
        if not loss.is_empty and not (loss.area <= 1e-10 and exclusive.boundary.buffer(1e-9).covers(loss)):
            raise ValueError(f'Normalization removed exclusive territory of {fid}')
        if not before.equals(after):
            removed.append({'id': fid, 'removed_area_deg2': before.difference(after).area})
    return {'all_ids_preserved': True, 'coverage_valid': True, 'coverage_verification': coverage_verification,
            'union_preserved_except_protected': True,
            'exclusive_territory_preserved': True, 'changed_ids': removed}


def normalize_snapshot(baseline_dir, source_path, output_dir):
    from tools.normalize_tno_russia_coverage import normalize_baseline_overlaps

    baseline_dir, source_path = Path(baseline_dir), Path(source_path)
    output = safe_output(output_dir, [baseline_dir, source_path])
    baseline = read(baseline_dir / 'runtime_topology.topo.json')
    topology = _absolute_topology(baseline)
    rows = topology['objects']['political']['geometries']
    all_geometries = {r['properties']['id']: _decode_geometry(topology, r) for r in rows}
    owners = read(baseline_dir / 'owners.by_feature.json')['owners']
    old = {i: g for i, g in all_geometries.items() if i.startswith('RU_RAY_')}
    source = {'RU_RAY_' + f['properties']['shapeID']: shape(f['geometry'])
              for f in read(source_path)['features']}
    # Existing cities and foreign interactive land retain their published geometry.
    # Only their intersections with the selected Russian coverage are relevant.
    tree = shapely.STRtree(list(old.values()))
    protected = {i: g for i, g in all_geometries.items()
                 if i not in old and i in owners and len(tree.query(g, predicate='intersects'))}
    print(f'Normalize {len(old)} Russian IDs, {len(protected)} protected neighbors', flush=True)
    try:
        normalized, ledger = normalize_baseline_overlaps(
            old, source, {i: parent_id(i) for i in old}, protected=protected)
    except ValueError as error:
        failed = getattr(error, 'geometries', None)
        if failed:
            output.mkdir(parents=True)
            write_json_atomic(output / 'failed-coverage.geojson', {
                'type': 'FeatureCollection', 'baseline_runtime_sha256': digest(baseline_dir / 'runtime_topology.topo.json'),
                'source_sha256': digest(source_path), 'error': str(error),
                'features': [{'type': 'Feature', 'properties': {'id': i}, 'geometry': mapping(g)} for i, g in failed.items()]},
                indent=None, separators=(',', ':'))
            edges = shapely.coverage_invalid_edges(list(failed.values()))
            write_json_atomic(output / 'invalid-edges.json', {
                fid: edge.wkt for fid, edge in zip(failed, edges) if not edge.is_empty}, indent=2)
            if getattr(error, 'normalization_ledger', None) is not None:
                write_json_atomic(output / 'normalization-ledger.json', error.normalization_ledger, indent=2)
        raise
    conservation = verify_normalized_coverage(old, normalized, protected)
    ids = sorted(normalized)
    frame = gpd.GeoDataFrame({'id': ids}, geometry=[normalized[i] for i in ids], crs=4326)
    runtime, encoding = replace_regional_geometry(baseline, frame)
    if [r['properties'] for r in rows] != [r['properties'] for r in runtime['objects']['political']['geometries']]:
        raise ValueError('Normalization modified identity or metadata')
    for key, obj in topology['objects'].items():
        if key != 'political' and not _decode_geometry(topology, obj).equals_exact(
                _decode_geometry(runtime, runtime['objects'][key]), 0):
            raise ValueError(f'Normalization modified auxiliary object {key}')
    output.mkdir(parents=True)
    shutil.copytree(baseline_dir, output / 'tno_1962')
    write_json_atomic(output / 'tno_1962/runtime_topology.topo.json', runtime, indent=None, separators=(',', ':'))
    # This snapshot is only a geometry constraint input, not a publishable bundle.
    report = {'baseline_runtime_sha256': digest(baseline_dir / 'runtime_topology.topo.json'),
              'source_sha256': digest(source_path), 'selected_count': len(old),
              'owner_counts': dict(Counter(owners[i] for i in old)),
              'protected_ids': sorted(protected), 'normalization': ledger, 'conservation': conservation, 'encoder': encoding,
              'publishable': False}
    write_json_atomic(output / 'normalization.json', report, indent=2)
    return output / 'tno_1962'


def build(baseline_dir, source_path, prepared_dir, output_dir):
    output = safe_output(output_dir, [baseline_dir, source_path, prepared_dir])
    output.mkdir(parents=True)
    normalized = normalize_snapshot(baseline_dir, source_path, output / 'normalized')
    inventory, _ = build_inventory(normalized, source_path)
    prior = read(Path(prepared_dir) / 'inventory.json')
    if inventory['source_sha256'] != prior['source_sha256']:
        raise ValueError('Prepared source identity mismatch')
    prepared = output / 'prepared'
    prepared.mkdir()
    for name in ('source.geojson', 'source.report.json'):
        shutil.copy2(Path(prepared_dir) / name, prepared / name)
    write_json_atomic(prepared / 'inventory.json', inventory, indent=2)
    return build_candidate(normalized, prepared, output / 'candidate', batch='all_adm2')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-dir', type=Path, required=True)
    parser.add_argument('--source', type=Path, default=ROOT / 'data/geoBoundaries-RUS-ADM2.geojson')
    parser.add_argument('--prepared-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    print(build(args.baseline_dir, args.source, args.prepared_dir, args.output_dir))
