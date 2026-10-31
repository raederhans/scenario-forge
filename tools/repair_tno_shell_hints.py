from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import shapely

from map_builder.regional_geometry import (
    _absolute_topology, _compact_arcs, _decode_geometry, _encode_exact_coverage,
    _offset_arcs, _update_bbox,
)
from tools.apply_tno_1962_identity_migrations import migration_map
from tools.apply_tno_split_overlay import rebuild_districts
from tools.check_scenario_contracts import write_json
from tools.materialize_polar_scenarios import refresh_scenario, synchronize_scenario_snapshot
from tools.rebuild_polar_assets import read, write, refresh_neighbors

SCENARIO_DIR = ROOT / 'data/scenarios/tno_1962'
PREFIX = 'RU_ARCTIC_FB_'


def repair_shells(topology, owners, countries, identities):
    result = _absolute_topology(topology)
    rows = result['objects']['political']['geometries']
    real = [row for row in rows if row['properties']['id'] in owners
            and not row['properties']['id'].startswith(PREFIX)]
    shapes = [_decode_geometry(result, row) for row in real]
    boundaries = [geometry.boundary for geometry in shapes]
    tree = shapely.STRtree(shapes)
    shells = sorted((row for row in rows if row['properties']['id'].startswith(PREFIX)),
                    key=lambda row: row['properties']['id'])
    number = max((int(row['properties']['id'].rsplit('_', 1)[1]) for row in shells), default=0)
    removed, additions, parts_by_id, report = [], [], {}, []
    changed = set()
    for row in shells:
        props = row['properties']
        fid = props['id']
        hint = props['scenario_shell_owner_hint']
        if hint not in countries:
            hint = identities[hint]
        grouped = defaultdict(list)
        components = []
        for part in shapely.get_parts(_decode_geometry(result, row)):
            votes = defaultdict(float)
            for index in tree.query(part, predicate='intersects'):
                length = part.boundary.intersection(boundaries[index]).length
                if length > 0:
                    votes[owners[real[index]['properties']['id']]] += length
            owner = min(votes, key=lambda tag: (-votes[tag], tag)) if votes else hint
            grouped[owner].append(part)
            components.append({'owner': owner, 'shared_boundary': dict(sorted(votes.items()))})
        targets = []
        if len(grouped) == 1:
            owner = next(iter(grouped))
            if any(props.get(key) != owner for key in ('scenario_shell_owner_hint', 'scenario_shell_controller_hint')):
                changed.add(fid)
            props.update(scenario_shell_owner_hint=owner, scenario_shell_controller_hint=owner)
            targets.append({'id': fid, 'hint': owner})
        else:
            removed.append(fid)
            for owner, parts in sorted(grouped.items()):
                number += 1
                child = f'{PREFIX}{owner}_{number:03}'
                geometry = shapely.union_all(parts)
                additions.append({'type': geometry.geom_type, 'properties': {
                    **deepcopy(props), 'id': child, 'scenario_shell_owner_hint': owner,
                    'scenario_shell_controller_hint': owner,
                }})
                parts_by_id[child] = geometry
                changed.add(child)
                targets.append({'id': child, 'hint': owner})
        report.append({'id': fid, 'targets': targets, 'components': components})
    if additions:
        encoded = _encode_exact_coverage(list(parts_by_id), list(parts_by_id.values()))
        offset = len(result['arcs'])
        result['arcs'].extend(encoded['arcs'])
        for row, encoded_row in zip(additions, encoded['objects']['political']['geometries']):
            row['arcs'] = _offset_arcs(encoded_row['arcs'], offset)
        rows[:] = [row for row in rows if row['properties']['id'] not in removed] + additions
        _compact_arcs(result)
        _update_bbox(result)
        refresh_neighbors(topology, result, changed)
    return (result if changed else topology), {
        'changed': len(changed), 'removed_ids': removed, 'shells': report,
    }


def remove_unreferenced_chunks(scenario_dir):
    manifest = read(scenario_dir / 'detail_chunks.manifest.json')

    def strings(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for item in value.values():
                yield from strings(item)
        elif isinstance(value, list):
            for item in value:
                yield from strings(item)

    referenced = {value.rsplit('/', 1)[-1] for value in strings(manifest)}
    directory = (scenario_dir / 'chunks').resolve()
    removed = []
    for path in sorted(directory.glob('political.detail.*.json*')):
        if path.name in referenced or (path.suffix == '.gz' and path.stem in referenced):
            continue
        if path.resolve().parent != directory:
            raise ValueError(f'Chunk outside scenario directory: {path}')
        path.unlink()
        removed.append(path.relative_to(scenario_dir).as_posix())
    return removed


def run_scenario(scenario_dir=SCENARIO_DIR):
    topology_path = scenario_dir / 'runtime_topology.topo.json'
    identities = migration_map(read(ROOT / 'data/scenario-rules/tno_1962.identity_map.json'))
    countries = read(scenario_dir / 'countries.json')['countries']
    # A retired tag hands its shells to whichever successor took most of its parcels.
    successors = defaultdict(lambda: defaultdict(int))
    for entry in read(ROOT / 'data/scenario-rules/tno_1962.split_overlay.json')['entries']:
        if entry.get('cores') == 'parent_if_single_child':
            identities[entry['only_from_owners'][0]] = entry['tag']
        elif len(entry.get('only_from_owners', [])) == 1 and entry['only_from_owners'][0] not in countries:
            successors[entry['only_from_owners'][0]][entry['tag']] += len(entry['select']['feature_ids'])
    for source, targets in successors.items():
        identities.setdefault(source, min(targets, key=lambda tag: (-targets[tag], tag)))
    repaired, report = repair_shells(
        read(topology_path), read(scenario_dir / 'owners.by_feature.json')['owners'],
        countries, identities,
    )
    if report['changed']:
        write(topology_path, repaired)
        refresh_scenario(scenario_dir, {}, removed_ids=report['removed_ids'])
        rebuild_districts(scenario_dir)
        synchronize_scenario_snapshot(scenario_dir)
    report['deleted_chunks'] = remove_unreferenced_chunks(scenario_dir)
    if report['changed'] or report['deleted_chunks']:
        write_json(ROOT / '.runtime/reports/generated/tno-shell-repair.json', report)
    return report


if __name__ == '__main__':
    print(json.dumps(run_scenario(), ensure_ascii=False, indent=2))
