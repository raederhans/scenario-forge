"""Independently verify recovered source land, identities and assignment deltas."""
from __future__ import annotations
import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import shapely
from shapely.geometry import box, shape
from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.prepare_tno_russia_precision import read
from tools.pilot_tno_russia_precision import boundary_equal
from tools.recover_tno_russia_missing import IULTINSKY, RECOVERED_OWNERS
from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.io.writers import write_json_atomic


def validate(before_path, after_path, baseline_dir, source_path, stage_dir=None):
    before, after = (_absolute_topology(read(Path(p))) for p in (before_path, after_path))
    old_rows = {r['properties']['id']: r for r in before['objects']['political']['geometries']}
    new_rows = {r['properties']['id']: r for r in after['objects']['political']['geometries']}
    old = {i: _decode_geometry(before, r) for i, r in old_rows.items()}
    new = {i: _decode_geometry(after, r) for i, r in new_rows.items()}
    baseline = Path(baseline_dir)
    owners = read(baseline / 'owners.by_feature.json')['owners']
    source = {'RU_RAY_' + f['properties']['shapeID']: shape(f['geometry']) for f in read(Path(source_path))['features']}
    if set(new) - set(old) != set(RECOVERED_OWNERS):
        raise ValueError('Unexpected recovery additions')
    removed = set(old) - set(new)
    if any(not i.startswith('RU_ARCTIC_FB_') or old_rows[i]['properties'].get('interactive') is not False for i in removed):
        raise ValueError('An interactive or unrelated ID was removed')
    land = _decode_geometry(before, before['objects']['land_mask'])
    water = _decode_geometry(before, before['objects']['scenario_water'])
    occupied_values = [g for fid, g in old.items() if fid in owners]
    occupied_tree = shapely.STRtree(occupied_values)
    expected = {}
    for fid in [IULTINSKY, *RECOVERED_OWNERS]:
        raw = source[fid]
        if fid == IULTINSKY:
            raw = raw.intersection(shapely.union_all([
                box(-180, -90, 0, 90), box(179.99, -90, 180, 90),
            ]))
        allowed = raw.intersection(land).difference(water)
        occupied = shapely.union_all([occupied_values[int(j)] for j in occupied_tree.query(allowed, predicate='intersects')])
        expected[fid] = allowed.difference(occupied)
        target = shapely.union_all([old[fid], expected[fid]]) if fid == IULTINSKY else expected[fid]
        if not boundary_equal(target, new[fid]):
            raise ValueError(f'Recovery does not match unoccupied source land: {fid}')
    extension = shapely.union_all(list(expected.values()))
    trimmed = []
    for fid, geom in old.items():
        props = old_rows[fid]['properties']
        if fid.startswith('RU_ARCTIC_FB_') and geom.intersection(extension).area > 0:
            target = geom.difference(extension)
            if props.get('interactive') is not False or props.get('scenario_helper_kind') != 'shell_fallback':
                raise ValueError('Recovery touched an interactive helper')
            if target.is_empty:
                if fid not in removed:
                    raise ValueError('Fully consumed helper remains')
                continue
            if fid in removed or not boundary_equal(target, new[fid]):
                raise ValueError(f'Helper trim mismatch: {fid}')
            trimmed.append(fid)
        elif fid != IULTINSKY and (fid in removed or not boundary_equal(geom, new[fid])):
            raise ValueError(f'Unrelated geometry changed: {fid}')
        expected_props = dict(props)
        if fid in trimmed and 'retained_fragment_area' in expected_props:
            expected_props['retained_fragment_area'] = round(new[fid].area, 6)
        if fid not in removed and new_rows[fid]['properties'] != expected_props:
            raise ValueError(f'Existing metadata changed: {fid}')
    for fid in RECOVERED_OWNERS:
        props = new_rows[fid]['properties']
        if props.get('interactive') is False or props.get('cntr_code') != 'RU':
            raise ValueError('Recovered district is not a Russian interactive feature')
    for key, obj in before['objects'].items():
        if key != 'political' and not _decode_geometry(before, obj).equals_exact(_decode_geometry(after, after['objects'][key]), 0):
            raise ValueError(f'Auxiliary geometry changed: {key}')
    rays = [g for i, g in new.items() if i.startswith('RU_RAY_')]
    if any(g.is_empty or not g.is_valid for g in new.values()) or not coverage_is_valid_exact(rays):
        raise ValueError('Recovered runtime coverage invalid')
    if stage_dir:
        stage = Path(stage_dir)
        for name, key in [('owners.by_feature.json', 'owners'), ('controllers.by_feature.json', 'controllers'),
                          ('cores.by_feature.json', 'cores')]:
            if not (baseline / name).exists():
                continue
            expected_payload = read(baseline / name)
            for fid, tag in RECOVERED_OWNERS.items():
                expected_payload[key][fid] = [tag] if key == 'cores' else tag
            if read(stage / name) != expected_payload:
                raise ValueError(f'Unexpected assignment delta: {name}')
        for name, key in [('scenario_manual_overrides.json', 'assignments'),
                          ('scenario_mutations.json', 'assignments_by_feature_id')]:
            expected_payload = read(baseline / name)
            for fid, tag in RECOVERED_OWNERS.items():
                expected_payload[key][fid] = {'owner': tag, 'controller': tag, 'cores': [tag]}
            if read(stage / name) != expected_payload:
                raise ValueError(f'Unexpected authoring delta: {name}')
    return {'status': 'PASS', 'new_interactive_ids': sorted(RECOVERED_OWNERS),
            'expanded_existing_ids': [IULTINSKY], 'removed_helpers': sorted(removed),
            'trimmed_helpers': sorted(trimmed), 'ray_count': len(rays), 'assignment_files_checked': bool(stage_dir),
            'existing_owners_unchanged': True if stage_dir else None,
            'source_land_recovery_exact': True, 'auxiliary_geometry_unchanged': True}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('before', 'after', 'baseline-dir', 'source', 'report'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--stage-dir', type=Path)
    a = p.parse_args()
    result = validate(a.before, a.after, a.baseline_dir, a.source, a.stage_dir)
    write_json_atomic(a.report, result, indent=2)
    print(result)
