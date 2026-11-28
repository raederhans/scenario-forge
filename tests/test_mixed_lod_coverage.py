"""Coverage-set proof checked against explicit independent chunk combinations."""
import itertools
import random

import shapely
from shapely.geometry import box

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
