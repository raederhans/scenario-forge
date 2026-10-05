"""Coverage-set proof checked against explicit independent chunk combinations."""
import itertools
import random

import pytest
import shapely
from shapely.geometry import Polygon, box

from tools.validate_mixed_lod_coverage import mixed_coverage_sets, union, validate


def test_formula_matches_exhaustive_loading_states_with_overlaps_and_missing_chunks():
    rng = random.Random(8127)
    cells = [box(x, y, x+1, y+1) for x in range(4) for y in range(3)]
    def region():
        return union(c for c in cells if rng.random() < .35)
    for trial in range(16):
        before = {str(i): (region(), region()) for i in range(3)}
        after = {str(i): (region(), region()) for i in range(3)}
        if trial % 2:
            del before['2']
        if trial % 3:
            del after['0']
        keys = sorted(before.keys() | after.keys())
        empty = union([])
        actual_regressions, actual_unions = [], []
        for states in itertools.product((0, 1), repeat=len(keys)):
            old = union(before.get(k, (empty, empty))[s] for k, s in zip(keys, states))
            new = union(after.get(k, (empty, empty))[s] for k, s in zip(keys, states))
            actual_regressions.append(old.difference(new))
            actual_unions.append(new)
        domain = box(0, 0, 4, 3)
        guaranteed, regression, missing = mixed_coverage_sets(before, after, domain=domain, additions=domain)
        expected_guaranteed = shapely.intersection_all(actual_unions)
        assert guaranteed.equals(expected_guaranteed)
        assert regression.equals(union(actual_regressions))
        assert missing.equals(domain.difference(expected_guaranteed))


def scenario(runtime, coarse, chunks):
    return {'runtime': runtime, 'coarse': coarse, 'chunks': chunks,
            'membership': {fid: key for key, rows in chunks.items() for fid in rows}}


def test_restoration_must_survive_coarse_and_detail_not_just_detail():
    old = scenario({'a': box(0, 0, 1, 1)}, {'a': box(0, 0, 1, 1)}, {'a': {'a': box(0, 0, 1, 1)}})
    new = scenario({'a': box(0, 0, 2, 1)}, old['coarse'], {'a': {'a': box(0, 0, 2, 1)}})
    result = validate(old, new)
    assert not result['passed']
    assert result['restoration_not_guaranteed_in_all_states']['area_degrees2'] == 1
    assert result['any_same_state_coverage_regression']['area_degrees2'] == 0


def test_neighbor_coarse_protrusion_cannot_hide_mixed_lod_regression():
    source = {'a': box(0, 0, 1, 1), 'b': box(1, 0, 2, 1)}
    detail = {'left': {'a': source['a']}, 'right': {'b': source['b']}}
    old = scenario(source, {'a': box(0, 0, 1.25, 1), 'b': box(1.25, 0, 2, 1)}, detail)
    new = scenario(source, {'a': source['a'], 'b': old['coarse']['b']}, detail)
    result = validate(old, new)
    assert not result['passed']
    assert result['any_same_state_coverage_regression']['area_degrees2'] == .25
    repaired = scenario(source, dict(source), detail)
    assert validate(old, repaired)['passed']


def test_unsupported_coarse_protrusion_is_not_source_territory_loss():
    source = {'a': box(0, 0, 1, 1)}
    chunks = {'a': dict(source)}
    old = scenario(source, {'a': box(0, 0, 2, 1)}, chunks)
    new = scenario(source, dict(source), chunks)
    assert validate(old, new)['passed']


@pytest.mark.parametrize('bounds', [(0, 0, 0, 1), (0, 0, 1, 0), (1, 0, 0, 1),
                                   (0, 0, float('nan'), 1), (0, 0, float('inf'), 1)])
def test_invalid_bounds_cannot_turn_missing_restoration_into_pass(bounds):
    old = scenario({'a': box(0, 0, 1, 1)}, {'a': box(0, 0, 1, 1)}, {'a': {'a': box(0, 0, 1, 1)}})
    new = scenario({'a': box(0, 0, 2, 1)}, old['coarse'], {'a': {'a': box(0, 0, 2, 1)}})
    with pytest.raises(ValueError, match='Bounds must'):
        validate(old, new, bounds)


def test_complete_source_gate_does_not_overlay_invalid_old_coarse_but_rejects_new_holes():
    source = {'a': box(0, 0, 2, 1)}
    chunks = {'a': dict(source)}
    old = scenario(source, {'a': Polygon([(0, 0), (2, 1), (0, 1), (2, 0), (0, 0)])}, chunks)
    new = scenario(source, dict(source), chunks)
    with pytest.raises(ValueError, match='Invalid coarse'):
        validate(old, new)
    result = validate(old, new, full_source_coverage=True)
    assert result['passed']
    assert result['coverage_comparison'] == 'complete_source_in_all_states'
    assert result['any_same_state_coverage_regression'] is None
    new['coarse']['a'] = box(0, 0, 1, 1)
    assert not validate(old, new, full_source_coverage=True)['passed']
