from copy import deepcopy
import pytest

from tools.patch_tno_1962_bundle import apply_sov_residual_rules, prune_cores_to_registered_country_tags, retire_sov_helper_properties


def fixture():
    rules = {'country_rules': [{'tag': 'IRK', 'include_feature_ids': ['A', 'B']}]}
    countries = {'countries': {'SOV': {}, 'IRK': {}, 'CHT': {}}}
    owners = {'owners': {'A': 'SOV', 'B': 'CHT', 'C': 'CHT'}}
    controllers = {'controllers': dict(owners['owners'])}
    cores = {'cores': {'A': ['SOV'], 'B': ['SOV', 'CHT'], 'C': ['SOV']}}
    return rules, countries, owners, controllers, cores


def test_retirement_preserves_later_manual_owner_and_other_cores():
    rules, countries, owners, controllers, cores = fixture()
    assert apply_sov_residual_rules(rules, countries, owners, controllers, cores) == ['A']
    assert owners['owners'] == {'A': 'IRK', 'B': 'CHT', 'C': 'CHT'}
    assert 'SOV' not in countries['countries']
    prune_cores_to_registered_country_tags(cores, countries, owners)
    assert cores['cores'] == {'A': ['IRK'], 'B': ['CHT'], 'C': ['CHT']}
    snapshot = deepcopy((countries, owners, controllers, cores))
    assert apply_sov_residual_rules(rules, countries, owners, controllers, cores) == []
    assert (countries, owners, controllers, cores) == snapshot


def test_unreviewed_residual_fails_before_changing_payloads():
    values = fixture()
    values[2]['owners']['new'] = 'SOV'
    snapshot = deepcopy(values)
    with pytest.raises(ValueError, match='Unreviewed SOV'):
        apply_sov_residual_rules(*values)
    assert values == snapshot


def test_reassigned_residual_keeps_other_existing_cores():
    values = fixture()
    values[4]['cores']['A'] = ['SOV', 'CHT']
    apply_sov_residual_rules(*values)
    assert values[4]['cores']['A'] == ['CHT']


def test_helper_hint_cleanup_preserves_id_and_rejects_unreviewed_helpers():
    props = {'id':'H', 'name':'Russia Shell Fallback SOV', 'scenario_shell_owner_hint':'SOV',
             'scenario_shell_controller_hint':'SOV', 'interactive':False}
    with pytest.raises(ValueError, match='Unreviewed SOV helper'):
        retire_sov_helper_properties(props, {'helper_assignments':{}})
    assert props['scenario_shell_owner_hint'] == 'SOV'
    assert retire_sov_helper_properties(props, {'helper_assignments':{'H':'RKK'}})
    assert props == {'id':'H', 'name':'Russia Shell Fallback RKK', 'scenario_shell_owner_hint':'RKK',
                     'scenario_shell_controller_hint':'RKK', 'interactive':False}
