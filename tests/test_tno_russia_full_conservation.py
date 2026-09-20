import pytest
from shapely.geometry import box

from tools.build_tno_russia_full_candidate import verify_normalized_coverage


def test_duplicate_only_repair_and_protected_city_are_conserved():
    old = {'a': box(0, 0, 2, 2), 'b': box(1, 0, 3, 2)}
    city = {'city': box(0, 0, .2, .2)}
    new = {'a': box(0, 0, 1.5, 2).difference(city['city']), 'b': box(1.5, 0, 3, 2)}
    report = verify_normalized_coverage(old, new, city)
    assert report['exclusive_territory_preserved']


def test_small_interior_hole_is_not_a_boundary_roundoff():
    old = {'a': box(0, 0, 2, 2)}
    hole = box(.5, .5, .500001, .500001)
    with pytest.raises(ValueError, match='national union'):
        verify_normalized_coverage(old, {'a': old['a'].difference(hole)}, {})


def test_moving_an_exclusive_border_with_constant_total_union_is_rejected():
    old = {'a': box(0, 0, 1, 1), 'b': box(1, 0, 2, 1)}
    new = {'a': box(0, 0, 1.1, 1), 'b': box(1.1, 0, 2, 1)}
    with pytest.raises(ValueError, match='expanded|exclusive'):
        verify_normalized_coverage(old, new, {})


def test_erasing_an_id_even_if_union_unchanged_is_rejected():
    old = {'a': box(0, 0, 1, 1), 'b': box(0, 0, 1, 1)}
    with pytest.raises(ValueError, match='ID'):
        verify_normalized_coverage(old, {'a': old['a']}, {})


def test_exclusive_cut_edge_uses_its_own_boundary_for_roundoff():
    old = {'a': box(0, 0, 2, 2), 'b': box(1, 0, 3, 2)}
    edge = 1 - 1e-12
    new = {'a': box(0, 0, edge, 2), 'b': box(edge, 0, 3, 2)}
    assert verify_normalized_coverage(old, new, {})['exclusive_territory_preserved']


def test_exclusive_cut_edge_does_not_allow_a_material_shift():
    old = {'a': box(0, 0, 2, 2), 'b': box(1, 0, 3, 2)}
    edge = 1 - 1e-7
    new = {'a': box(0, 0, edge, 2), 'b': box(edge, 0, 3, 2)}
    with pytest.raises(ValueError, match='expanded|exclusive'):
        verify_normalized_coverage(old, new, {})
