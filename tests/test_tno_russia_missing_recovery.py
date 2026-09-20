import json

import pytest
import shapely
from shapely.geometry import box, mapping

from map_builder.regional_geometry import _encode_exact_coverage, _offset_arcs, _decode_geometry
from tools.recover_tno_russia_missing import recover, IULTINSKY, RECOVERED_OWNERS, NEIGHBORS
from tools.validate_tno_russia_recovery import validate


def fixture(tmp_path, positive_limit=180):
    baseline = tmp_path / 'baseline'
    baseline.mkdir()
    kayak = NEIGHBORS['RKK']
    old = {IULTINSKY: box(175, 64, positive_limit, 66), kayak: box(47, 42, 48, 43),
           'RU_ARCTIC_FB_PFC_026': box(-180, 64, -175, 67),
           'RU_ARCTIC_FB_USA_044': box(-178, 64, -176, 65)}
    source = {
        IULTINSKY: shapely.union_all([box(175, 64, 180, 66), box(-180, 64, -178, 66)]),
        'RU_RAY_50074027B3022028163112': box(-178, 64, -176, 65),
        'RU_RAY_50074027B2401368915177': box(-178, 65, -176, 66),
        'RU_RAY_50074027B30798664015080': box(47.5, 42, 48.5, 43),
    }
    topo = {'type': 'Topology', 'arcs': [], 'objects': {'political': {'type': 'GeometryCollection', 'geometries': []}}}

    def encoded(fid, geom):
        one = _encode_exact_coverage([fid], [geom])
        row = one['objects']['political']['geometries'][0]
        row['arcs'] = _offset_arcs(row['arcs'], len(topo['arcs']))
        topo['arcs'].extend(one['arcs'])
        return row

    for fid, geom in old.items():
        row = encoded(fid, geom)
        if fid.startswith('RU_ARCTIC_FB_'):
            row['properties'].update({'interactive': False, 'scenario_helper_kind': 'shell_fallback'})
        topo['objects']['political']['geometries'].append(row)
    topo['objects']['land_mask'] = encoded('land', shapely.union_all([*source.values(), old[kayak]]))
    topo['objects']['scenario_water'] = encoded('water', box(48.4, 41, 49, 44))
    path = baseline / 'runtime_topology.topo.json'
    path.write_text(json.dumps(topo), encoding='utf8')
    (baseline / 'owners.by_feature.json').write_text(json.dumps({'owners': {IULTINSKY: 'PFC', kayak: 'RKK'}}), encoding='utf8')
    (baseline / 'countries.json').write_text(json.dumps({'countries': {'PFC': {}, 'RKK': {}}}), encoding='utf8')
    src = tmp_path / 'source.json'
    src.write_text(json.dumps({'features': [
        {'properties': {'shapeID': fid.removeprefix('RU_RAY_'), 'shapeName': fid}, 'geometry': mapping(g)}
        for fid, g in source.items()]}), encoding='utf8')
    return baseline, path, src, old


def test_dateline_recovery_keeps_positive_half_and_removes_only_covered_helpers(tmp_path):
    baseline, path, src, old = fixture(tmp_path)
    result = recover(path, baseline, src, tmp_path / 'out')
    assert result['assignments'] == RECOVERED_OWNERS
    assert result['removed_helper_ids'] == ['RU_ARCTIC_FB_USA_044']
    after = json.loads((tmp_path / 'out/runtime-candidate.topo.json').read_text(encoding='utf8'))
    assert 'RU_ARCTIC_FB_PFC_026' in after['political_precision_feature_ids']
    assert 'RU_ARCTIC_FB_USA_044' not in after['political_precision_feature_ids']
    for index, row in enumerate(after['objects']['political']['geometries']):
        if row['properties']['id'] in RECOVERED_OWNERS:
            assert row['id'] == index
    shapes = {r['properties']['id']: _decode_geometry(after, r) for r in after['objects']['political']['geometries']}
    assert shapes[IULTINSKY].intersection(box(0, -90, 180, 90)).equals(old[IULTINSKY])
    assert shapes[IULTINSKY].intersection(box(-180, -90, 0, 90)).area == 4
    iz = shapes['RU_RAY_50074027B30798664015080']
    assert iz.equals(box(48, 42, 48.4, 43))
    assert shapes['RU_ARCTIC_FB_PFC_026'].intersection(shapely.union_all([
        shapes[fid] for fid in [IULTINSKY, *RECOVERED_OWNERS]])).area == 0
    assert shapely.coverage_is_valid([g for fid, g in shapes.items() if fid.startswith('RU_RAY_')])
    assert validate(path, tmp_path / 'out/runtime-candidate.topo.json', baseline, src)['status'] == 'PASS'


def test_changed_neighbor_owner_requires_new_review(tmp_path):
    baseline, path, src, _ = fixture(tmp_path)
    owners = baseline / 'owners.by_feature.json'
    payload = json.loads(owners.read_text())
    payload['owners'][IULTINSKY] = 'RFA'
    owners.write_text(json.dumps(payload))
    with pytest.raises(ValueError, match='neighboring allocation changed'):
        recover(path, baseline, src, tmp_path / 'out')


def test_legacy_positive_dateline_clip_is_also_restored(tmp_path):
    baseline, path, src, old = fixture(tmp_path, positive_limit=179.99)
    recover(path, baseline, src, tmp_path / 'out')
    after_path = tmp_path / 'out/runtime-candidate.topo.json'
    after = json.loads(after_path.read_text(encoding='utf8'))
    row = next(r for r in after['objects']['political']['geometries'] if r['properties']['id'] == IULTINSKY)
    restored = _decode_geometry(after, row)
    assert restored.intersection(box(0, -90, 180, 90)).equals(box(175, 64, 180, 66))
    assert restored.covers(old[IULTINSKY])
    assert validate(path, after_path, baseline, src)['status'] == 'PASS'
