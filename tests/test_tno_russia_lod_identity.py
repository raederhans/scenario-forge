from shapely.geometry import Polygon, box
from tools.validate_tno_russia_precision import lod_coordinates_identical


def test_ring_direction_does_not_change_exact_mixed_coverage():
    a = box(0, 0, 1, 1)
    assert lod_coordinates_identical({'a': a}, {
        'coarse': {'a': Polygon(list(a.exterior.coords)[::-1])}, 'detail': {'a': a}})


def test_surface_equality_does_not_hide_missing_shared_vertex():
    detailed = Polygon([(0, 0), (1, 0), (1, .5), (1, 1), (0, 1)])
    coarse = box(0, 0, 1, 1)
    assert detailed.equals(coarse)
    assert not lod_coordinates_identical({'a': detailed}, {
        'coarse': {'a': coarse}, 'detail': {'a': detailed}})


def test_tiny_shift_and_missing_feature_cannot_use_identity_proof():
    a = box(0, 0, 1, 1)
    assert not lod_coordinates_identical({'a': a}, {'coarse': {'a': box(0, 0, 1 + 1e-12, 1)}})
    assert not lod_coordinates_identical({'a': a}, {'coarse': {}})
