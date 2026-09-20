"""Restore audited Russian source omissions inside the published land/water mask."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import box, shape

from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import (
    _absolute_topology, _decode_geometry, _encode_exact_coverage, _offset_arcs,
    _compact_arcs, _update_bbox, compute_neighbor_graph,
)
from tools.prepare_tno_russia_precision import read, digest, safe_output
from tools.pilot_tno_russia_precision import node_owner_interfaces, polygon_parts, boundary_equal
from tools.audit_tno_russia_geometry import area_km2

RECOVERED_OWNERS = {
    'RU_RAY_50074027B3022028163112': 'PFC',
    'RU_RAY_50074027B2401368915177': 'PFC',
    'RU_RAY_50074027B30798664015080': 'RKK',
}
IULTINSKY = 'RU_RAY_50074027B76144209526439'
NEIGHBORS = {'PFC': IULTINSKY, 'RKK': 'RU_RAY_50074027B83524270497208'}


def polygonal(geometry):
    result = shapely.union_all(list(polygon_parts(geometry)))
    if result.is_empty or not result.is_valid:
        raise ValueError('Recovery produced empty or invalid polygonal geometry')
    return result


def recover(runtime_path, baseline_dir, source_path, output_dir):
    runtime_path, baseline_dir, source_path = map(Path, (runtime_path, baseline_dir, source_path))
    output = safe_output(output_dir, [runtime_path, baseline_dir, source_path])
    runtime = _absolute_topology(read(runtime_path))
    rows = runtime['objects']['political']['geometries']
    by_id = {r['properties']['id']: r for r in rows}
    geoms = {fid: _decode_geometry(runtime, r) for fid, r in by_id.items()}
    source = {'RU_RAY_' + f['properties']['shapeID']: f for f in read(source_path)['features']}
    owners = read(baseline_dir / 'owners.by_feature.json')['owners']
    countries = read(baseline_dir / 'countries.json')['countries']
    for tag, fid in NEIGHBORS.items():
        if owners.get(fid) != tag or tag not in countries:
            raise ValueError(f'Reviewed neighboring allocation changed: {fid}')
    if any(fid in by_id or fid in owners for fid in RECOVERED_OWNERS):
        raise ValueError('Recovery requires the audited missing-ID baseline')
    land = _decode_geometry(runtime, runtime['objects']['land_mask'])
    water = _decode_geometry(runtime, runtime['objects']['scenario_water'])
    interactive = {fid: g for fid, g in geoms.items() if fid in owners}
    interactive_ids = list(interactive)
    interactive_values = list(interactive.values())
    tree = shapely.STRtree(interactive_values)

    restored = {}
    measurements = []
    for fid in [IULTINSKY, *sorted(RECOVERED_OWNERS)]:
        raw = shape(source[fid]['geometry'])
        # The retired source clip ended at +179.99 as well as discarding
        # negative longitudes. Restore both demonstrated losses, subtracting
        # all existing interactive land below.
        missing = raw.intersection(shapely.union_all([
            box(-180, -90, 0, 90), box(179.99, -90, 180, 90),
        ])) if fid == IULTINSKY else raw
        allowed = missing.intersection(land).difference(water)
        occupied = shapely.union_all([interactive_values[int(j)] for j in tree.query(allowed, predicate='intersects')])
        extension = polygonal(allowed.difference(occupied))
        restored[fid] = extension
        measurements.append({'id': fid, 'owner': owners[fid] if fid == IULTINSKY else RECOVERED_OWNERS[fid],
                             'source_area_km2': area_km2(missing), 'allowed_land_km2': area_km2(allowed),
                             'already_interactive_km2': area_km2(allowed.intersection(occupied)),
                             'restored_km2': area_km2(extension)})
    if not coverage_is_valid_exact(list(restored.values())):
        # Overlay junctions are noded without accepting genuine overlap.
        restored = node_owner_interfaces(restored)
    restore_union = shapely.union_all(list(restored.values()))
    rays = {fid: g for fid, g in geoms.items() if fid.startswith('RU_RAY_')}
    rays[IULTINSKY] = polygonal(shapely.union_all([rays[IULTINSKY], restored[IULTINSKY]]))
    rays.update({fid: restored[fid] for fid in RECOVERED_OWNERS})
    rays = node_owner_interfaces(rays)
    removed_helpers, helper_changes = [], {}
    for fid, geom in geoms.items():
        props = by_id[fid]['properties']
        if not fid.startswith('RU_ARCTIC_FB_') or not geom.intersects(restore_union):
            continue
        cut = geom.intersection(restore_union)
        if cut.area == 0:
            continue
        if props.get('interactive') is not False or props.get('scenario_helper_kind') != 'shell_fallback':
            raise ValueError(f'Refusing to trim a non-helper: {fid}')
        remainder = shapely.union_all(list(polygon_parts(geom.difference(restore_union))))
        if remainder.is_empty:
            removed_helpers.append(fid)
        elif not remainder.is_valid:
            raise ValueError(f'Helper trim invalidated {fid}')
        else:
            helper_changes[fid] = remainder
    # Encode the mutually noded ray coverage and each remaining helper. This
    # keeps all existing political identities except fully consumed helpers.
    replacement = {**rays, **helper_changes}
    encoded = _encode_exact_coverage(list(replacement), list(replacement.values()))
    offset = len(runtime['arcs'])
    runtime['arcs'].extend(encoded['arcs'])
    enc = {r['properties']['id']: r for r in encoded['objects']['political']['geometries']}
    rows[:] = [r for r in rows if r['properties']['id'] not in removed_helpers]
    for fid in sorted(RECOVERED_OWNERS):
        rows.append({'type': enc[fid]['type'], 'id': len(rows), 'properties': {
            'id': fid, 'name': source[fid]['properties']['shapeName'], 'cntr_code': 'RU', '__source': 'detail'},
            'arcs': []})
    for row in rows:
        fid = row['properties']['id']
        if fid in replacement:
            row['type'] = enc[fid]['type']
            row['arcs'] = _offset_arcs(enc[fid]['arcs'], offset)
            if 'bbox' in row:
                row['bbox'] = list(replacement[fid].bounds)
            if fid in helper_changes and 'retained_fragment_area' in row['properties']:
                row['properties']['retained_fragment_area'] = round(helper_changes[fid].area, 6)
    _compact_arcs(runtime)
    _update_bbox(runtime)
    after = {r['properties']['id']: _decode_geometry(runtime, r) for r in rows}
    for fid, geometry in replacement.items():
        if not boundary_equal(after[fid], geometry):
            raise ValueError(f'Encoding changed recovered geometry: {fid}')
    for fid in set(geoms) - set(replacement) - set(removed_helpers):
        if not geoms[fid].equals_exact(after[fid], 0):
            raise ValueError(f'Unrelated geometry changed: {fid}')
    frame = gpd.GeoDataFrame({'id': list(after)}, geometry=list(after.values()), crs=4326)
    runtime['objects']['political']['computed_neighbors'] = compute_neighbor_graph(frame)
    # Existing city cutouts and trimmed shells must meet the restored district
    # boundaries at every LOD. Independent coarse simplification moves those
    # edges (the baseline Volgograd coarse polygon is even invalid).
    ordered_ids = list(after)
    graph = runtime['objects']['political']['computed_neighbors']
    lod_constraints = {ordered_ids[j] for i, fid in enumerate(ordered_ids) if fid in rays
                       for j in graph[i] if ordered_ids[j] not in rays}
    lod_constraints |= {fid for fid in after if fid.startswith('RU_CITY_')} | set(helper_changes)
    runtime['political_precision_feature_ids'] = sorted(
        (set(runtime.get('political_precision_feature_ids', [])) | set(rays) | lod_constraints)
        - set(removed_helpers))
    runtime['objects']['political']['bbox'] = frame.total_bounds.tolist()
    report = {'source_sha256': digest(source_path), 'input_runtime_sha256': digest(runtime_path),
              'added_ids': sorted(RECOVERED_OWNERS), 'expanded_ids': [IULTINSKY],
              'removed_helper_ids': removed_helpers, 'trimmed_helper_ids': sorted(helper_changes),
              'assignments': RECOVERED_OWNERS, 'measurements': measurements,
              'lod_constraint_ids': sorted(lod_constraints),
              'policy': 'Restore pinned source inside existing land minus water and existing interactive coverage. '
                        'PFC follows Iultinsky/Anadyr; RKK follows Kayakentsky. Helpers give way to recovered interactive land.',
              'source_accuracy_limit': 'Published land/water mask retained; this does not certify its real-world coastline accuracy.'}
    output.mkdir(parents=True)
    write_json_atomic(output / 'runtime-candidate.topo.json', runtime, indent=None, separators=(',', ':'))
    write_json_atomic(output / 'report.json', report, indent=2)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('runtime', 'baseline-dir', 'source', 'output-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    print(recover(a.runtime, a.baseline_dir, a.source, a.output_dir))
