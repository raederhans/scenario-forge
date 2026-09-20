"""Attribute baseline overlap surfaces to pinned source parents; select bounded safe expansion."""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import shapely
from shapely.geometry import shape
from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from map_builder.io.writers import write_json_atomic
from tools.prepare_tno_russia_precision import read, digest, parent_id, safe_output
from tools.audit_tno_russia_geometry import area_km2


def source_partition_evidence(overlap, left, right):
    common = overlap.intersection(left).intersection(right)
    only_left = overlap.intersection(left).difference(right)
    only_right = overlap.intersection(right).difference(left)
    outside = overlap.difference(shapely.union_all([left, right]))
    return {'left_source_km2': area_km2(only_left), 'right_source_km2': area_km2(only_right),
            'both_sources_km2': area_km2(common), 'outside_sources_km2': area_km2(outside)}


def triage(baseline_dir, prepared_dir, audit_path, output_dir):
    output = safe_output(output_dir, [baseline_dir, prepared_dir])
    audit, inventory = read(audit_path), read(prepared_dir / 'inventory.json')
    runtime_path = baseline_dir / 'runtime_topology.topo.json'
    if digest(runtime_path) != audit['baseline_runtime_sha256'] or digest(runtime_path) != inventory['baseline_runtime_sha256']:
        raise ValueError('Snapshot identity changed')
    source_path = ROOT / 'data/geoBoundaries-RUS-ADM2.geojson'
    if digest(source_path) != audit['source_sha256']:
        raise ValueError('Source identity changed')
    source = {'RU_RAY_' + f['properties']['shapeID']: shape(f['geometry']) for f in read(source_path)['features']}
    topo = _absolute_topology(read(runtime_path))
    geometries = {f['properties']['id']: _decode_geometry(topo, f) for f in topo['objects']['political']['geometries']}
    records = {r['id']: r for r in inventory['records'] if r['kind'] == 'adm2'}
    evidence, blocked = [], set()
    for pair in audit['overlaps']:
        if not pair['cross_owner']:
            continue
        left, right = pair['ids']
        blocked.update(pair['ids'])
        overlap = geometries[left].intersection(geometries[right])
        measurement = source_partition_evidence(overlap, source[parent_id(left)], source[parent_id(right)])
        evidence.append({**pair, **measurement,
                         'decision': 'source suggests interior allocation only; preserve scenario owner domains pending reviewed boundary'})
    flagged_parents = {f['parent'] for f in audit['source_to_baseline_area_flags']}
    cities = [g for fid, g in geometries.items() if fid.startswith('RU_CITY_')]
    city_union = shapely.union_all(cities)
    reasons = {}
    for fid, record in records.items():
        why = []
        if fid in blocked: why.append('cross_owner_overlap')
        if parent_id(fid) in flagged_parents: why.append('area_ratio_flag')
        if record['split']: why.append('split_family_retained_in_existing_pilot')
        if geometries[fid].intersection(city_union).area > 1e-10: why.append('city_overlap')
        if why: reasons[fid] = why
    eligible = set(records) - set(reasons)
    # Whole connected components avoid cutting arbitrary rectangular geographic windows.
    ids = sorted(eligible)
    tree = shapely.STRtree([geometries[i] for i in ids])
    adjacency = {i: set() for i in ids}
    for n, fid in enumerate(ids):
        for k in tree.query(geometries[fid], predicate='intersects'):
            other = ids[int(k)]
            if other != fid and records[other]['owner'] == records[fid]['owner']:
                adjacency[fid].add(other)
    components, remaining = [], set(ids)
    while remaining:
        seed = min(remaining)
        group, stack = set(), [seed]
        while stack:
            fid = stack.pop()
            if fid in group: continue
            group.add(fid)
            stack.extend(adjacency[fid] - group)
        remaining -= group
        if 2 <= len(group) <= 40:
            components.append({'owner': records[seed]['owner'], 'ids': sorted(group)})
    components.sort(key=lambda c: (-len(c['ids']), c['owner'], c['ids'][0]))
    selected, chosen, owners = [], [], set()
    for component in components:
        if component['owner'] in owners or len(selected) + len(component['ids']) > 120:
            continue
        selected.extend(component['ids'])
        chosen.append(component)
        owners.add(component['owner'])
        if len(owners) >= 6: break
    report = {'baseline_runtime_sha256': audit['baseline_runtime_sha256'], 'source_sha256': audit['source_sha256'],
              'cross_owner_pair_count': len(evidence), 'source_partition_evidence': evidence,
              'excluded_features': reasons, 'eligible_count': len(eligible), 'selected_components': chosen,
              'selected_count': len(selected), 'owner_counts': dict(Counter(records[i]['owner'] for i in selected)),
              'policy': 'No reassignment or missing-ID insertion; independent source evidence is not scenario authority.'}
    output.mkdir(parents=True)
    write_json_atomic(output / 'report.json', report, indent=2)
    write_json_atomic(output / 'selection.json', sorted(selected), indent=2)
    return {k: v for k, v in report.items() if k not in {'source_partition_evidence', 'excluded_features', 'selected_components'}}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for key in ('baseline-dir', 'prepared-dir', 'audit', 'output-dir'):
        p.add_argument('--' + key, type=Path, required=True)
    a = p.parse_args()
    print(triage(a.baseline_dir, a.prepared_dir, a.audit, a.output_dir))
