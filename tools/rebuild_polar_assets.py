"""Materialize the bounded repair of legacy polar clipping and omitted islands.

Run from the repository root. Geometry changes preserve all unrelated decoded
coordinates. Use --geometry-only to inspect geometry before refreshing scenarios.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import sys

import shapely

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from map_builder.json_source import json_source_sha256, read_json_source, write_runtime_topology_source
from map_builder.processors.arctic_recovery import (
    AREA_EPSILON, _read, decoded_structure, polygonal, recover_arctic,
)
from map_builder.regional_geometry import (
    _absolute_topology, _compact_arcs, _encode_exact_coverage, _offset_arcs, _update_bbox,
)

FORBIDDEN_BLANK_PROPERTIES = {
    'cntr_code', 'country_code', 'owner', 'controller', 'core', 'cores',
    'scenario_owner', 'scenario_controller', 'color', 'color_hex',
    'admin1_group', 'legacy_name', 'anchor_county_name',
}


def read(path):
    if Path(path).name in {'runtime_topology.topo.json', 'runtime_topology.topo.json.gz'}:
        return read_json_source(path)
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write(path, payload):
    path = Path(path)
    if path.name == 'runtime_topology.topo.json':
        actual_path = write_runtime_topology_source(path.parent, payload)
        try:
            scenario_relative = path.parent.resolve().relative_to((ROOT / 'data/scenarios').resolve())
        except ValueError:
            return actual_path
        manifest_path = path.parent / 'manifest.json'
        if manifest_path.exists():
            manifest = read(manifest_path)
            actual_url = (actual_path.resolve().relative_to(ROOT).as_posix())
            manifest['runtime_topology_url'] = actual_url
            digest = json_source_sha256(actual_path)
            if not isinstance(manifest.get('source'), dict):
                raise ValueError(f'Missing runtime source metadata in {manifest_path}')
            manifest['source']['runtime_topology_sha256'] = digest
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return actual_path
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    path.write_bytes(data)
    mirror = path.with_suffix(path.suffix + '.gz')
    if mirror.exists():
        mirror.write_bytes(gzip.compress(data, mtime=0))


def append_missing(topology, donor, wanted_ids, *, ownerless=False):
    """Copy existing canonical identities; blank restoration excludes occupied land."""
    result, donor = _absolute_topology(topology), _absolute_topology(donor)
    rows = result['objects']['political']['geometries']
    existing = {r['properties']['id'] for r in rows}
    targets = sorted((r for r in donor['objects']['political']['geometries']
                      if r['properties']['id'] in set(wanted_ids) - existing),
                     key=lambda row: row['properties']['id'])
    if not targets:
        return result, dict(added_ids=[], changed_ids=[], removed_helper_ids=[])
    original_views = {r['properties']['id']: decoded_structure(result, r) for r in rows}
    working = [_read(result, r) for r in rows]
    tree = shapely.STRtree(working)
    additions = {}
    properties = {}
    for target in targets:
        fid = target['properties']['id']
        geom = _read(donor, target)
        overlaps = [working[int(j)] for j in tree.query(geom, predicate='intersects')
                    if not rows[int(j)]['properties']['id'].startswith('RU_ARCTIC_FB_')]
        occupied = shapely.union_all(overlaps + list(additions.values()))
        if not ownerless and geom.intersection(occupied).area > AREA_EPSILON:
            raise ValueError(f'Island overlaps existing political coverage: {fid}')
        geom = polygonal(geom.difference(occupied)) if ownerless else geom
        if geom.is_empty or geom.area <= AREA_EPSILON:
            continue
        additions[fid] = geom
        props = deepcopy(target['properties'])
        if ownerless:
            props = {k: v for k, v in props.items() if k not in FORBIDDEN_BLANK_PROPERTIES}
        properties[fid] = props
    restored = shapely.union_all(list(additions.values()))
    replacements, removed = {}, []
    if ownerless:
        for row, geom in zip(rows, working):
            fid = row['properties']['id']
            if not fid.startswith('RU_ARCTIC_FB_') or geom.intersection(restored).area <= AREA_EPSILON:
                continue
            rest = polygonal(geom.difference(restored))
            if rest.area <= AREA_EPSILON:
                removed.append(fid)
            else:
                replacements[fid] = rest
    changes = {**replacements, **additions}
    if not changes:
        return result, dict(added_ids=[], changed_ids=[], removed_helper_ids=[])
    encoded = _encode_exact_coverage(list(changes), list(changes.values()))
    offset = len(result['arcs'])
    result['arcs'].extend(encoded['arcs'])
    encoded_rows = {r['properties']['id']: r for r in encoded['objects']['political']['geometries']}
    rows[:] = [r for r in rows if r['properties']['id'] not in removed]
    for fid in additions:
        rows.append({'properties': properties[fid]})
    for row in rows:
        fid = row['properties']['id']
        if fid in changes:
            encoded_row = encoded_rows[fid]
            row.update(type=encoded_row['type'], arcs=_offset_arcs(encoded_row['arcs'], offset))
            if 'bbox' in row:
                row['bbox'] = list(changes[fid].bounds)
    _compact_arcs(result)
    _update_bbox(result)
    for row in rows:
        fid = row['properties']['id']
        if fid not in changes and decoded_structure(result, row) != original_views[fid]:
            raise AssertionError(f'Unrelated coordinates changed: {fid}')
    return result, dict(added_ids=list(additions), changed_ids=list(replacements), removed_helper_ids=removed)


def refresh_neighbors(before, after, changed_ids):
    """Preserve unrelated graph edges, remap indices, and refresh changed incidences."""
    rows = after['objects']['political']['geometries']
    old_obj = before['objects']['political']
    old_ids = [r['properties']['id'] for r in old_obj['geometries']]
    ids = [r['properties']['id'] for r in rows]
    indices = {fid: i for i, fid in enumerate(ids)}
    changes = set(changed_ids) | (set(ids) - set(old_ids))
    graph = [set() for _ in rows]
    old_graph = old_obj.get('computed_neighbors')
    if old_graph is None or len(old_graph) != len(old_ids):
        changes = set(ids)
    else:
        for i, neighbors in enumerate(old_graph):
            fid = old_ids[i]
            if fid not in indices or fid in changes:
                continue
            for j in neighbors:
                peer = old_ids[j]
                if peer in indices and peer not in changes:
                    graph[indices[fid]].add(indices[peer])
    geometries = [_read(after, r) for r in rows]
    tree = shapely.STRtree(geometries)
    for fid in changes & set(ids):
        i = indices[fid]
        for j in tree.query(geometries[i], predicate='intersects'):
            j = int(j)
            if j != i:
                graph[i].add(j)
                graph[j].add(i)
    after['objects']['political']['computed_neighbors'] = [sorted(s) for s in graph]
    precision = set(after.get('political_precision_feature_ids', [])) | changes
    precision.update(ids[j] for fid in changes & set(ids) for j in graph[indices[fid]])
    after['political_precision_feature_ids'] = sorted(precision & set(ids))
    for i, neighbors in enumerate(graph):
        if i in neighbors or any(i not in graph[j] for j in neighbors):
            raise AssertionError('Invalid neighbor graph')


def transplant_political(current, candidate):
    """Compose a verified political candidate with independently repaired water."""
    result, candidate = _absolute_topology(current), _absolute_topology(candidate)
    offset = len(result['arcs'])
    result['arcs'].extend(candidate['arcs'])
    political = deepcopy(candidate['objects']['political'])
    for row in political['geometries']:
        if 'arcs' in row:
            row['arcs'] = _offset_arcs(row['arcs'], offset)
    result['objects']['political'] = political
    _compact_arcs(result)
    _update_bbox(result)
    return result


def refresh_base_manifest():
    """Refresh the two changed registered base outputs using the normal summary."""
    from init_map_data import _topology_summary
    path = ROOT / 'data/manifest.json'
    manifest = read(path)
    for name in ('europe_topology.na_v2.json', 'europe_topology.runtime_political_v1.json'):
        asset = ROOT / 'data' / name
        metadata = manifest['outputs'][name]
        metadata.update(_topology_summary(asset))
        metadata.update(size_bytes=asset.stat().st_size, sha256=hashlib.sha256(asset.read_bytes()).hexdigest())
    manifest['generated_at'] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--geometry-only', action='store_true')
    mode.add_argument('--materialize-only', action='store_true', help='Resume from saved geometry reports')
    parser.add_argument('--candidate-dir', type=Path, help='Optional already-verified Arctic candidates')
    args = parser.parse_args()
    data = ROOT / 'data'
    report_dir = ROOT / '.runtime/reports/generated/polar-repair'
    if args.materialize_only:
        from tools.materialize_polar_scenarios import refresh_scenario
        refresh_base_manifest()
        for sid in ('modern_world', 'hoi4_1936', 'hoi4_1939', 'tno_1962', 'blank_base'):
            report = read(report_dir / f'{sid}.json')
            print(f'[polar] {sid}: scenario artifacts', flush=True)
            refresh_scenario(data / 'scenarios' / sid, report['assignments'],
                             removed_ids=report['removed_helper_ids'])
            print(f'[polar] {sid}: complete', flush=True)
        return
    source = read(data / 'geoBoundaries-RUS-ADM2.geojson')
    land = read(data / 'europe_topology.json')
    modern = read(data / 'scenarios/modern_world/runtime_topology.topo.json')
    no_ids = [r['properties']['id'] for r in modern['objects']['political']['geometries']
              if r['properties']['id'].startswith('NO_PRIMARY_GAP_')]
    if len(no_ids) != 9:
        raise ValueError('Expected the nine canonical Norwegian island components')
    report_dir.mkdir(parents=True, exist_ok=True)
    reports = {}
    targets = [('detail', data / 'europe_topology.na_v2.json'),
               ('runtime', data / 'europe_topology.runtime_political_v1.json')]
    targets += [(sid, data / 'scenarios' / sid / 'runtime_topology.topo.json')
                for sid in ('modern_world', 'hoi4_1936', 'hoi4_1939', 'tno_1962', 'blank_base')]
    repaired_runtime = None
    for key, path in targets:
        print(f'[polar] {key}: geometry', flush=True)
        before = read(path)
        assignments = {}
        if key == 'blank_base':
            wanted = set(reports['runtime']['selected_ids']) | set(no_ids)
            wanted |= {r['properties']['id'] for r in repaired_runtime['objects']['political']['geometries']
                       if r['properties']['id'] == 'GL' or r['properties']['id'].startswith('AQ_')}
            candidate, report = append_missing(before, repaired_runtime, wanted, ownerless=True)
        else:
            candidate_name = {'detail': 'na_v2', 'tno_1962': 'tno'}.get(key, key)
            candidate_path = args.candidate_dir / f'{candidate_name}.json' if args.candidate_dir else None
            if candidate_path and candidate_path.exists():
                candidate = read(candidate_path)
                report = read(candidate_path.with_suffix(candidate_path.suffix + '.report.json'))
                candidate = transplant_political(before, candidate)
            else:
                owners = read(path.parent / 'owners.by_feature.json')['owners'] if key == 'tno_1962' else None
                controller_path = path.parent / 'controllers.by_feature.json'
                controllers = read(controller_path)['controllers'] if owners and controller_path.exists() else owners
                candidate, report = recover_arctic(before, source, land_topology=land,
                                                    owners=owners, controllers=controllers)
            assignments.update(report['new_assignments'])
            if key != 'detail':
                candidate, added = append_missing(candidate, modern, no_ids)
                report['added_ids'] = added['added_ids']
                no_owner = {'hoi4_1936': 'NOR', 'hoi4_1939': 'NOR', 'tno_1962': 'RKNO', 'modern_world': 'NO'}.get(key)
                if no_owner:
                    assignments.update({fid: dict(owner=no_owner, controller=no_owner, cores=[no_owner])
                                        for fid in added['added_ids']})
        changed = set(report['changed_ids']) | set(report.get('added_ids', [])) | set(assignments)
        refresh_neighbors(before, candidate, changed)
        write(path, candidate)
        report['assignments'] = assignments
        write(report_dir / f'{key}.json', report)
        reports[key] = report
        if key == 'runtime':
            repaired_runtime = candidate
        print(f'[polar] {key}: complete', flush=True)
    write(report_dir / 'summary.json', reports)
    if not args.geometry_only:
        from tools.materialize_polar_scenarios import refresh_scenario
        refresh_base_manifest()
        for key, path in targets:
            if key in {'runtime', 'detail'}:
                continue
            report = reports[key]
            print(f'[polar] {key}: scenario artifacts', flush=True)
            refresh_scenario(path.parent, report['assignments'], removed_ids=report['removed_helper_ids'])


if __name__ == '__main__':
    main()
