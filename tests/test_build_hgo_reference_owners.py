import numpy as np
import pytest
from shapely.geometry import Polygon, box

from tools.build_hgo_reference_owners import Raster, sample_equal_area, sample_feature, subject_effects, summarize_samples
from source_parser import parse


STATES = {
    1: dict(entityTag='AAA', controllerTag='CCC', name='West'),
    2: dict(entityTag='BBB', controllerTag='BBB', name='East'),
    3: dict(entityTag='WTR', controllerTag='WTR', name='Sea'),
}


class IdentityRegistration:
    def lookup(self, points):
        return points, np.ones(len(points), dtype=bool)


def test_synthetic_raster_equal_area_mode_and_controller():
    raster = Raster(np.array([[1, 1, 1, 2], [1, 1, 1, 2]], dtype=np.uint16), [None, 1, 2], STATES)
    result = sample_feature(box(0, 0, 4, 2), IdentityRegistration(), raster, 3)
    assert result['status'] == 'sampled'
    assert result['valid_land_samples'] >= 200
    assert result['hgo_owner'] == 'AAA'
    assert result['share'] == pytest.approx(.75, abs=.03)
    assert {c['tag'] for c in result['controllers']} == {'CCC', 'BBB'}
    assert {s['id'] for s in result['states']} == {1, 2}


def test_water_out_of_bounds_and_tie():
    raster = Raster(np.array([[1, 3, 2]], dtype=np.uint16), [None, 1, 2, 3], STATES)
    ids = raster.lookup(np.array([[.5, .5], [1.5, .5], [2.5, .5], [-.1, .5], [3, .5], [np.nan, 0]]))
    assert ids.tolist() == [1, 0, 2, 0, 0, 0]
    result = summarize_samples(ids, STATES)
    assert result['valid_land_samples'] == 2
    assert result['tied']
    assert result['hgo_owner'] == 'AAA'
    assert result['share'] == .5


def test_unsupported_has_no_invented_owner():
    class Unsupported:
        def lookup(self, points):
            return np.full(points.shape, np.nan), np.zeros(len(points), dtype=bool)
    raster = Raster(np.array([[1]], dtype=np.uint16), [None, 1], STATES)
    result = sample_feature(box(0, 0, 1, 1), Unsupported(), raster, 0)
    assert result['status'] == 'unsupported'
    assert result['hgo_owner'] is None
    assert result['mix'] == []


def test_sampling_is_equal_area_not_uniform_latitude():
    points = sample_equal_area(box(0, 0, 10, 80), 10000, 17)
    expected = np.sin(np.deg2rad(40)) / np.sin(np.deg2rad(80))
    assert np.mean(points[:, 1] < 40) == pytest.approx(expected, abs=.02)


def test_supported_water_is_not_reported_as_valid_land():
    raster = Raster(np.array([[3]], dtype=np.uint16), [None, 1, 2, 3], STATES)
    result = sample_feature(box(0, 0, 1, 1), IdentityRegistration(), raster, 0)
    assert result['status'] == 'insufficient_samples'
    assert result['total_samples'] == 25600
    assert result['supported_fraction'] == 1
    assert result['valid_land_samples'] == 0
    assert result['hgo_owner'] is None


def test_degenerate_polygon_is_not_sampled():
    class MustNotSample:
        def lookup(self, points):
            pytest.fail('Degenerate geometry must not reach raster registration')
    polygon = Polygon([(1, 0), (1, 1), (1, 2), (1, 0)])
    raster = Raster(np.array([[1]], dtype=np.uint16), [None, 1], STATES)
    result = sample_feature(polygon, MustNotSample(), raster, 0)
    assert result['status'] == 'invalid_geometry'
    assert result['hgo_owner'] is None
    assert result['total_samples'] == 0
    assert result['mix'] == []
    assert len(sample_equal_area(polygon, 200)) == 0


def test_equal_area_attempt_limit_returns_without_looping():
    assert sample_equal_area(box(0, 0, 1, 1), 200, max_attempts=0).shape == (0, 2)


def test_no_dlc_nested_else_and_dated_relations():
    block = parse('''
    # puppet = XXX
    if = { limit = { has_dlc = "Together for Victory" }
      set_autonomy = { target = MAL autonomous_state = autonomy_dominion }
      else = { puppet = MAL }
    }
    1937.1.1 = { puppet = FUT }
    ''')
    effects = subject_effects(block, 'ENG', 'history/countries/ENG.txt')
    assert len(effects) == 2
    assert effects[0]['conditional']
    assert effects[0]['active_by_default'] is False
    assert effects[1]['autonomy'] == 'autonomy_puppet'
    assert effects[1]['active_by_default'] is True
