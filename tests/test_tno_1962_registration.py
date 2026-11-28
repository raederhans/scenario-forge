import copy

import numpy as np
import pytest
from pyproj import Transformer
from shapely import contains_xy
from shapely.geometry import Polygon, box

from tools.build_tno_1962_approved_assignments import (
    build_assignments,
    represented_originals,
    evaluate_robustness,
    project_votes,
)
from tools.tno_1962_registration import (
    RegionalModel,
    SourceMap,
    sample_equal_area,
    sample_feature,
    summarize_votes,
)


@pytest.mark.parametrize('scheme', ['tps', 'affine'])
def test_registration_on_synthetic_control_grid(scheme):
    project = Transformer.from_crs(4326, '+proj=aeqd +lat_0=55 +lon_0=70 +datum=WGS84 +units=km', always_xy=True)
    controls = []
    for lon in np.linspace(65, 75, 7):
        for lat in np.linspace(50, 60, 7):
            x, y = project.transform(lon, lat)
            controls.append(dict(lon=lon, lat=lat, x=500 + x / 10, y=500 - y / 10, weight=.25))
    model = RegionalModel(controls, (65, 50, 75, 60), scheme, 1000)
    points = np.array([[68.3, 53.2], [71.1, 57.4]])
    x, y = project.transform(*points.T)
    expected = np.column_stack([500 + x / 10, 500 - y / 10])
    np.testing.assert_allclose(model.lonlat_to_pixel(points), expected, atol=1e-6)
    np.testing.assert_allclose(model.pixel_to_lonlat(expected), points, atol=1e-6)


def test_stratified_samples_respect_holes_and_area_at_high_latitude():
    geometry = Polygon([(0, 50), (10, 50), (10, 80), (0, 80)], holes=[[(1, 51), (2, 51), (2, 52), (1, 52)]])
    points = sample_equal_area(geometry, 8000, seed=4)
    assert contains_xy(geometry, *points.T).all()
    from tools.tno_1962_registration import TO_AREA
    low = box(0, 50, 10, 65).difference(box(1, 51, 2, 52))
    from shapely.ops import transform
    expected = transform(TO_AREA.transform, low).area / transform(TO_AREA.transform, geometry).area
    assert np.mean(points[:, 1] < 65) == pytest.approx(expected, abs=.02)
    assert np.mean(points[:, 1] < 65) > .6


class SyntheticRegistration:
    def lonlat_to_pixel(self, points, scheme):
        return np.asarray(points) * 100


def test_all_sea_cannot_generate_a_land_candidate():
    source = SourceMap(np.ones((100, 100), dtype=int), ['unknown', 'sea'], ['', ''])
    result = sample_feature(box(0, 0, 1, 1), SyntheticRegistration(), source)
    assert not result['sample_sufficient']
    assert not result['schemes_agree']
    assert result['schemes']['tps']['mode'] is None


def approval_fixture():
    identity = dict(original_to_project={
        'KMC': dict(policy='one_to_one', project_tags=['PFC'], default_project_tag='PFC'),
        'MAG': dict(policy='one_to_one', project_tags=['MAG'], default_project_tag='MAG')},
        conflict_migrations={'RSF': dict(new_tag='MAG'), 'MAG': dict(new_tag='MGN')},
        china_policy=dict(country_codes=['CN'], feature_id_prefixes=['CN_']),
        scope=dict(country_codes=['RU', 'CN'], feature_id_prefixes=['CN_', 'US_'],
                   project_owners=[], excluded_owners=['AFA', 'GRN']))
    stats = summarize_votes(['land'] * 400, ['KMC'] * 400)
    row = dict(fid='RU_TEST', country_code='RU', current_owner='RFA', status='sampled', sample_seed=7,
               area_km2=10, city_anchor_owners=[], regions=['far_east'],
               schemes={'tps': stats, 'affine': copy.deepcopy(stats)})
    regions = {'far_east': dict(passed=False, schemes={'tps': dict(p90_km=20, median_km=10), 'affine': dict(p90_km=25, median_km=15)})}
    return dict(rows=[row], regions=regions), identity


class ShiftRegistration:
    def lonlat_to_pixel(self, points, scheme):
        return (np.asarray(points) + 2) * 100


def calculate_fixture(candidates, identity, raster=None):
    if raster is None:
        raster = np.ones((400, 400), dtype=int)
    source = SourceMap(raster, ['unknown', 'land', 'land'], ['', 'KMC', 'MAG'])
    row = candidates['rows'][0]
    result = evaluate_robustness(row, box(-.02, -.02, .02, .02), ShiftRegistration(), source,
                                 candidates['regions'], identity, represented_originals(candidates, identity))
    return {row['fid']: result}


def test_shifted_samples_change_owner_on_synthetic_border():
    candidates, identity = approval_fixture()
    raster = np.ones((400, 400), dtype=int)
    raster[:, 210:] = 2
    robust = calculate_fixture(candidates, identity, raster)
    cases = robust['RU_TEST']['cases']
    assert all(c['project_mode'] == 'PFC' for c in cases if c['bearing_degrees'] is None)
    assert all(c['project_mode'] == 'MAG' for c in cases if c['bearing_degrees'] == 90)
    assert all(c['project_mode'] == 'PFC' for c in cases if c['bearing_degrees'] == 270)
    approved, review = build_assignments(candidates, identity, robust)
    assert not approved['assignments']
    assert 'unstable_owner' in review[0]['reasons']


def test_merge_identity_votes_before_computing_mode_and_share():
    candidates, identity = approval_fixture()
    identity['original_to_project']['OTHER'] = dict(policy='one_to_one', project_tags=['PFC'], default_project_tag='PFC')
    result = project_votes({'KMC': 40, 'OTHER': 35, 'MAG': 25}, 100, candidates['rows'][0], identity, set())
    assert result['project_mode'] == 'PFC'
    assert result['project_share'] == .75
    assert result['project_votes'] == {'PFC': 75, 'MAG': 25}
