import copy
import json
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from tools.apply_tno_1962_identity_migrations import apply_identity_migrations, IDENTITY_PATH, read_json
from tools.apply_tno_1962_corrections import (
    best_effort_owner, drop_small_enclaves, political_neighbors, select_corrections,
)


@pytest.fixture
def migration_directory():
    path = Path(__file__).resolve().parents[1] / '.runtime/tmp' / f'tno-migration-{uuid4().hex}'
    path.mkdir(parents=True)
    yield path
    shutil.rmtree(path)


def test_atomic_identity_migration_and_idempotence(migration_directory):
    tmp_path = migration_directory
    payloads = {
        'manifest.json': {'scenario_id': 'tno_1962'},
        'runtime_topology.topo.json': {'objects': {'political': {'geometries': [
            {'properties': {'id': 'RU_ARCTIC_FB_RSF_034', 'scenario_shell_owner_hint': 'RSF',
                            'scenario_shell_controller_hint': 'TAN'}},
        ]}}},
        'countries.json': {'countries': {tag: {'tag': tag, 'display_name': name} for tag, name in
                                       [('MAG', 'Magnitogorsk'), ('RSF', 'Magadan'), ('TAN', 'Committee'),
                                        ('PRC', 'Old China'), ('GSW', 'Colonial government'), ('ANG', 'Old Angola')]}},
        'owners.by_feature.json': {'owners': {'a': 'MAG', 'b': 'RSF', 'c': 'TAN', 'd': 'GSW'}},
        'cores.by_feature.json': {'cores': {'a': ['MAG', 'PRC'], 'b': ['RSF']}},
        'city_overrides.json': {'capitals_by_tag': {'MAG': 'Magnitogorsk', 'RSF': 'Magadan', 'TAN': 'Kyzyl', 'PRC': 'China'}},
        'releasable_catalog.manual.json': {'entries': [
            {'tag': 'MAG', 'scenario_ids': ['tno_1962']},
            {'tag': 'MAG', 'scenario_ids': ['hoi4_1936']},
        ]},
    }
    for name, payload in payloads.items():
        (tmp_path / name).write_text(json.dumps(payload), encoding='utf-8')
    assert apply_identity_migrations(tmp_path, IDENTITY_PATH, [])
    countries = read_json(tmp_path / 'countries.json')['countries']
    assert countries['MGN']['display_name'] == 'Magnitogorsk'
    assert countries['MAG']['display_name'] == 'Magadan'
    assert countries['PRC']['display_name'] == 'Committee'
    assert countries['ANG']['display_name'] == 'Colonial government'
    shell = read_json(tmp_path / 'runtime_topology.topo.json')['objects']['political']['geometries'][0]['properties']
    assert shell == {'id': 'RU_ARCTIC_FB_RSF_034', 'scenario_shell_owner_hint': 'MAG',
                     'scenario_shell_controller_hint': 'PRC'}
    assert read_json(tmp_path / 'owners.by_feature.json')['owners'] == dict(a='MGN', b='MAG', c='PRC', d='ANG')
    assert read_json(tmp_path / 'cores.by_feature.json')['cores']['a'] == ['MGN', 'CHI']
    assert read_json(tmp_path / 'city_overrides.json')['capitals_by_tag']['PRC'] == 'Kyzyl'
    assert [row['tag'] for row in read_json(tmp_path / 'releasable_catalog.manual.json')['entries']] == ['MGN', 'MAG']
    before = {path.name: path.read_bytes() for path in tmp_path.glob('*.json')}
    assert apply_identity_migrations(tmp_path, IDENTITY_PATH, []) == []
    assert before == {path.name: path.read_bytes() for path in tmp_path.glob('*.json')}


@pytest.fixture
def candidate():
    return dict(fid='RU_TEST', current_owner='RFA', country_code='RU', status='sampled',
                regions=['central_siberia'], city_anchor_owners=[],
                schemes={scheme: dict(votes={'KEM': 50, 'SBA': 30, 'IRK': 20}, valid_land_samples=100)
                         for scheme in ('tps', 'affine')})


def test_best_effort_threshold_mapping_and_city_anchor(candidate):
    identity = read_json(IDENTITY_PATH)
    assert best_effort_owner(candidate, identity, set()) == 'RUR'
    candidate['city_anchor_owners'] = [{'owner': 'KEM'}]
    assert best_effort_owner(candidate, identity, set()) == 'RUR'
    candidate['city_anchor_owners'] = [{'owner': 'IRK'}]
    assert best_effort_owner(candidate, identity, set()) is None


@pytest.mark.parametrize('change', ['below', 'disagree', 'tie', 'outside', 'excluded', 'ownerless'])
def test_best_effort_rejections(candidate, change):
    row = copy.deepcopy(candidate)
    if change == 'below':
        row['schemes']['affine']['votes'] = {'KEM': 49, 'SBA': 30, 'IRK': 21}
    elif change == 'disagree':
        row['schemes']['affine']['votes'] = {'KEM': 30, 'SBA': 70}
    elif change == 'tie':
        row['schemes']['affine']['votes'] = {'KEM': 50, 'SBA': 50}
    elif change == 'outside':
        row['regions'] = ['south_asia']
    elif change == 'excluded':
        row['current_owner'] = 'AFA'
    else:
        row['current_owner'] = None
    assert best_effort_owner(row, read_json(IDENTITY_PATH), set()) is None


def test_selection_keeps_approved_and_marks_best_effort(candidate):
    record = dict(fid='RU_TEST', current_owner='RFA', normalized_current_owner='RFA', area_km2=10)
    approved = {'approved': [dict(fid='approved', project_owner='MAG')]}
    result = select_corrections({'rows': [candidate]}, approved, {'rows': [record]}, read_json(IDENTITY_PATH))
    assert result['approved']['project_owner'] == 'MAG'
    assert result['approved']['method'] == 'approved'
    assert result['RU_TEST']['project_owner'] == 'RUR'
    assert result['RU_TEST']['method'] == 'best_effort'


def test_political_neighbors_follow_shared_arcs():
    topology = {'objects': {'political': {'geometries': [
        {'type': 'Polygon', 'arcs': [[0, 1]], 'properties': {'id': 'a'}},
        {'type': 'MultiPolygon', 'arcs': [[[~1, 2]]], 'properties': {'id': 'b'}},
        {'type': 'Polygon', 'arcs': [[3]], 'properties': {'id': 'c'}},
    ]}}}
    neighbors = political_neighbors(topology)
    assert neighbors['a'] == {'b'} and neighbors['b'] == {'a'} and not neighbors['c']


def test_small_enclave_changes_are_dropped_until_stable():
    owners = {'city': 'SAM', 'district': 'SAM', 'ring': 'SAM', 'big': 'SAM', 'east': 'ORE'}
    neighbors = {'city': {'district'}, 'district': {'city', 'ring'}, 'ring': {'district', 'east'},
                 'big': {'district', 'east'}, 'east': {'ring', 'big'}}
    row = lambda owner, area: {'project_owner': owner, 'area_km2': area}
    selected = {'city': row('ORE', 60), 'ring': row('ORE', 100), 'big': row('ORE', 9000)}
    kept, dropped = drop_small_enclaves(selected, owners, neighbors)
    # The ring touches ORE land and the large parcel is never dropped; the city face would be a speck.
    assert dropped == ['city']
    assert set(kept) == {'ring', 'big'}


def test_enclave_change_stays_when_a_neighbor_votes_for_the_same_owner():
    owners = {'perm': 'BKR', 'krai': 'BKR', 'kemerovo': 'RUR', 'south': 'RUR'}
    neighbors = {'perm': {'krai'}, 'krai': {'perm'}, 'kemerovo': {'south'}, 'south': {'kemerovo'}}
    row = lambda owner: {'project_owner': owner, 'area_km2': 700}
    selected = {'perm': row('PRM'), 'kemerovo': row('NOV')}
    # The surrounding krai votes PRM but missed the gates; Kemerovo's surroundings vote for someone else.
    kept, dropped = drop_small_enclaves(selected, owners, neighbors, {'krai': 'PRM', 'south': 'KEM'})
    assert dropped == ['kemerovo'] and set(kept) == {'perm'}
