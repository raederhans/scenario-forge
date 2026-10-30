from copy import deepcopy

import shapely
from shapely.geometry import box, MultiPolygon

from map_builder.regional_geometry import _decode_geometry, _encode_exact_coverage
from tools.repair_tno_shell_hints import repair_shells


def fixture(shell):
    topology = _encode_exact_coverage(
        ['left', 'right', 'RU_ARCTIC_FB_OLD_001'],
        [box(0, 0, 2, 2), box(4, 0, 6, 2), shell])
    topology['objects']['political']['geometries'][2]['properties'].update(
        scenario_shell_owner_hint='OLD', scenario_shell_controller_hint='OLD')
    return topology


def test_components_with_different_neighbors_split_without_owners():
    shell = MultiPolygon([box(0, 2, 2, 3), box(4, 2, 6, 3)])
    topology = fixture(shell)
    original = deepcopy(topology)
    owners = {'left': 'A', 'right': 'B'}
    result, report = repair_shells(topology, owners, {'A': {}, 'B': {}}, {'OLD': 'A'})
    assert topology == original
    assert report['removed_ids'] == ['RU_ARCTIC_FB_OLD_001']
    rows = result['objects']['political']['geometries']
    shells = [row for row in rows if row['properties']['id'] not in owners]
    assert {row['properties']['id'] for row in shells} == {'RU_ARCTIC_FB_A_002', 'RU_ARCTIC_FB_B_003'}
    assert shapely.union_all([_decode_geometry(result, row) for row in shells]).equals(shell)
    for row in shells:
        props = row['properties']
        assert props['scenario_shell_owner_hint'] == props['scenario_shell_controller_hint']
    assert repair_shells(result, owners, {'A': {}, 'B': {}}, {'OLD': 'A'})[1]['changed'] == 0


def test_shared_boundary_length_changes_hint_without_replacing_id():
    topology = fixture(box(1, 2, 6, 3))
    result, report = repair_shells(topology, {'left': 'A', 'right': 'B'}, {'A': {}, 'B': {}}, {'OLD': 'A'})
    shell = result['objects']['political']['geometries'][2]
    assert report['changed'] == 1 and report['removed_ids'] == []
    assert shell['properties']['id'] == 'RU_ARCTIC_FB_OLD_001'
    assert shell['properties']['scenario_shell_owner_hint'] == 'B'
    assert shell['properties']['scenario_shell_controller_hint'] == 'B'
    assert _decode_geometry(result, shell).equals(box(1, 2, 6, 3))


def test_island_preserves_current_hint_and_migrates_retired_hint():
    topology = fixture(box(10, 10, 11, 11))
    result, report = repair_shells(topology, {'left': 'A', 'right': 'B'}, {'OLD': {}, 'A': {}, 'B': {}}, {'OLD': 'A'})
    assert result == topology and report['changed'] == 0
    result, report = repair_shells(topology, {'left': 'A', 'right': 'B'}, {'A': {}, 'B': {}}, {'OLD': 'A'})
    props = result['objects']['political']['geometries'][2]['properties']
    assert props['scenario_shell_owner_hint'] == props['scenario_shell_controller_hint'] == 'A'
    assert report['removed_ids'] == []
