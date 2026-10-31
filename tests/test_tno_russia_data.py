import json
import math
from pathlib import Path

import pytest

from map_builder.json_source import read_json_source
from map_builder.scenario_family_palette import hex_to_oklab
from tools.repair_tno_russia import corrected_assignments

ROOT = Path(__file__).resolve().parents[1]
SCENARIO = ROOT / 'data/scenarios/tno_1962'
USER_RULES = json.loads((ROOT / 'tests/fixtures/tno_user_reassign.json').read_text(encoding='utf-8'))
CHANGED_RULES = {fid: row for fid, row in USER_RULES.items() if row['from'] != row['to']}


@pytest.fixture(scope='module')
def scenario():
    return {name: read_json_source(SCENARIO / name) for name in (
        'countries.json', 'owners.by_feature.json', 'runtime_topology.topo.json', 'manifest.json')}


def test_all_shell_hints_resolve_to_existing_countries(scenario):
    countries = scenario['countries.json']['countries']
    shells = [row['properties'] for row in scenario['runtime_topology.topo.json']['objects']['political']['geometries']
              if row['properties'].get('scenario_helper_kind') == 'shell_fallback']
    assert shells
    for shell in shells:
        assert shell['scenario_shell_owner_hint'] in countries, shell['id']
        assert shell['scenario_shell_controller_hint'] in countries, shell['id']


def test_adjacent_administrative_children_have_distinct_family_colors(scenario):
    countries = scenario['countries.json']['countries']
    owners = scenario['owners.by_feature.json']['owners']
    families = {'RKO', 'RKU', 'RKM', 'RKK', 'GEA', 'GCO', 'AOI', 'ITA', 'IBR', 'SAF', 'ANG'}
    pairs = set()
    for name in ('political', 'scenario_atlantropa'):
        obj = scenario['runtime_topology.topo.json']['objects'][name]
        rows = obj['geometries']
        for index, neighbors in enumerate(obj.get('computed_neighbors', [])):
            a = owners.get(rows[index]['properties']['id'])
            for neighbor in neighbors:
                b = owners.get(rows[neighbor]['properties']['id'])
                if a and b and a != b:
                    parent = countries[a].get('parent_owner_tag')
                    if parent in families and parent == countries[b].get('parent_owner_tag'):
                        pairs.add(tuple(sorted((a, b))))
    assert pairs
    for a, b in pairs:
        distance = math.dist(hex_to_oklab(countries[a]['color_hex']), hex_to_oklab(countries[b]['color_hex']))
        assert distance >= 0.03, (a, b, distance)


def test_administrative_containers_and_retired_tags(scenario):
    countries = scenario['countries.json']['countries']
    owners = scenario['owners.by_feature.json']['owners']
    for tag in ('RKO', 'GEA', 'GCO', 'AOI'):
        assert countries[tag]['entry_kind'] == 'scenario_container'
        assert countries[tag]['feature_count'] == 0
        assert tag not in owners.values()
        assert any(country.get('parent_owner_tag') == tag and country['feature_count'] > 0
                   for country in countries.values())
    for tag in ('AFA', 'PG01', 'PG02', 'PG03', 'PG04'):
        assert tag not in countries
        assert tag not in owners.values()


def test_repaired_adjacent_colors_remain_distinguishable_and_fic_retires(scenario):
    countries = scenario['countries.json']['countries']
    for a, b in [('URL', 'OUR'), ('FAV', 'URA'), ('NRL', 'OMO')]:
        distance = math.dist(hex_to_oklab(countries[a]['color_hex']), hex_to_oklab(countries[b]['color_hex']))
        assert distance >= 0.03, (a, b, distance)
    assert 'FIC' not in countries
    assert 'FIC' not in scenario['manifest.json']['featured_tags']
    assert scenario['owners.by_feature.json']['owners']['RU_RAY_50074027B90244452662579'] == 'AMR'


def test_south_adjacent_owners_have_distinct_colors(scenario):
    countries = scenario['countries.json']['countries']
    owners = scenario['owners.by_feature.json']['owners']
    south = {'CLL', 'CLC', 'JAM', 'TRI', 'BAH', 'BLZ', 'GUY', 'GUC', 'STC', 'PUE', 'PCZ',
             'SER', 'ALB', 'SNM', 'PAD', 'ITA', 'CRO', 'MNT', 'BUL', 'GRE', 'HUN', 'DOM'}
    pairs = set()
    for name in ('political', 'scenario_atlantropa'):
        obj = scenario['runtime_topology.topo.json']['objects'][name]
        rows = obj['geometries']
        for index, neighbors in enumerate(obj.get('computed_neighbors', [])):
            a = owners.get(rows[index]['properties']['id'])
            for neighbor in neighbors:
                b = owners.get(rows[neighbor]['properties']['id'])
                if a and b and a != b and {a, b} & south:
                    pairs.add(tuple(sorted((a, b))))
    assert pairs
    for a, b in pairs:
        distance = math.dist(hex_to_oklab(countries[a]['color_hex']), hex_to_oklab(countries[b]['color_hex']))
        assert distance >= 0.03, (a, b, distance)


@pytest.mark.parametrize('feature_id,rule', CHANGED_RULES.items())
def test_user_reassigned_feature_has_requested_owner(scenario, feature_id, rule):
    assert len(CHANGED_RULES) == 49
    assert scenario['owners.by_feature.json']['owners'][feature_id] == {'RKO': 'OE00'}.get(rule['to'], rule['to'])


def test_reassignment_preserves_unrelated_cores_and_unchanged_rows():
    from tools.repair_tno_russia import CITY_REASSIGNMENTS

    rules = {**CITY_REASSIGNMENTS, **USER_RULES}
    owners = {fid: row['from'] for fid, row in rules.items()}
    cores = {fid: [row['from']] for fid, row in rules.items()}
    cores['RU_MRG_56d7f2c40815'] = ['RKO', 'RKM']
    cores['RU_MRG_e85ce6b2cbb5'] = ['GER']
    result = corrected_assignments(owners, cores)
    assert result['BY_INT_BREST']['cores'] == ['RKO']
    assert result['RU_MRG_56d7f2c40815']['cores'] == ['RKO', 'RKM']
    assert result['RU_MRG_e85ce6b2cbb5']['cores'] == ['GER']
    assert not (set(result) & {fid for fid, row in USER_RULES.items() if row['from'] == row['to']})
    owners.update({fid: row['owner'] for fid, row in result.items()})
    cores.update({fid: row['cores'] for fid, row in result.items()})
    assert corrected_assignments(owners, cores) == {}
