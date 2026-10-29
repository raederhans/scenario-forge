import copy
from types import SimpleNamespace

import numpy as np
import pytest
from pyproj import Transformer
from shapely import contains_xy
from shapely.geometry import Polygon, box

from tools.build_tno_1962_approved_assignments import (
    build_assignments, resolve_identity, normalize_current, represented_originals,
    evaluate_robustness, perturbation_radius, project_votes, in_scope,
)
from tools.tno_1962_registration import (
    RegionalModel, SourceMap, distance_metrics, old_britain_owners, region_for, regions_for,
    sample_equal_area, sample_feature, spatial_folds, summarize_votes,
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


def test_spatial_holdout_keeps_entire_blocks_out_of_training():
    points = np.array([[30.1, 60.1], [34.9, 64.9], [35.1, 60.1], [40.1, 65.1]])
    folds = spatial_folds(points)
    assert folds[0] == folds[1]
    for fold in set(folds):
        train = {tuple(p // 5) for p in points[folds != fold]}
        held_out = {tuple(p // 5) for p in points[folds == fold]}
        assert train.isdisjoint(held_out)
    assert not distance_metrics([1, 2, np.nan], 3)['passed']
    assert distance_metrics([5] * 10, 10)['passed']
    assert not distance_metrics([30] * 10, 10)['passed']


def test_vote_denominators_do_not_change_when_sea_wins():
    result = summarize_votes(['sea'] * 91 + ['land'] * 72, [''] * 91 + ['OMO'] * 70 + ['NRL'] * 2)
    assert result['votes'] == {'OMO': 70, 'NRL': 2}
    assert result['mode'] == 'OMO'
    assert result['mode_land_share'] == pytest.approx(70 / 72)
    assert result['mode_total_share'] == pytest.approx(70 / 163)
    assert result['valid_land_fraction'] == pytest.approx(72 / 163)
    assert result['sea_fraction'] == pytest.approx(91 / 163)
    assert summarize_votes(['land', 'land'], ['AAA', 'BBB'])['tied']


def test_raster_out_of_bounds_is_not_clipped_to_land():
    source = SourceMap(np.ones((2, 2), dtype=int), ['unknown', 'land'], ['', 'AAA'])
    _, kinds, owners = source.lookup([[-.1, 1], [2, 1], [np.nan, 0], [1.5, .5]])
    result = summarize_votes(kinds, owners)
    assert result['valid_land_samples'] == 1
    assert result['invalid_fraction'] == .75


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


def test_thin_polygon_samples_stay_in_original_geometry():
    geometry = Polygon([(49, 39), (49.2, 39.2), (49.20001, 39.20002), (49.00001, 39.00002)])
    points = sample_equal_area(geometry, 400, seed=3)
    assert len(points) == 400
    assert contains_xy(geometry, *points.T).all()


class SyntheticRegistration:
    def lonlat_to_pixel(self, points, scheme):
        return np.asarray(points) * 100


def test_boundary_sampling_collects_enough_land_samples():
    raster = np.ones((100, 100), dtype=int)
    raster[:, 50:] = 2
    source = SourceMap(raster, ['unknown', 'land', 'sea'], ['', 'AAA', ''])
    result = sample_feature(box(0, 0, 1, 1), SyntheticRegistration(), source, seed=2)
    assert result['boundary']
    assert result['sample_sufficient']
    assert result['schemes_agree']
    assert result['schemes']['tps']['valid_land_samples'] >= 1600
    assert result['schemes']['tps']['valid_land_fraction'] == pytest.approx(.5, abs=.03)


def test_all_sea_cannot_generate_a_land_candidate():
    source = SourceMap(np.ones((100, 100), dtype=int), ['unknown', 'sea'], ['', ''])
    result = sample_feature(box(0, 0, 1, 1), SyntheticRegistration(), source)
    assert not result['sample_sufficient']
    assert not result['schemes_agree']
    assert result['schemes']['tps']['mode'] is None


def test_old_britain_transfers_only_trigger_states():
    states = {i: SimpleNamespace(owner_tag='ENG') for i in range(1, 5)}
    effects = 'ENG_OldBritain_ContentToggleEffect = {' + ''.join(
        f'every_state = {{ limit = {{ is_{tag}_state = yes }} transfer_state_to = {tag} }}'
        for tag in ('SCO', 'WAL', 'CRN')) + '}'
    triggers = ' '.join(f'is_{tag}_state = {{ OR = {{ state = {i} }} }}' for i, tag in enumerate(('SCO', 'WAL', 'CRN'), 1))
    owners, transfers = old_britain_owners(states, effects, triggers)
    assert owners == {1: 'SCO', 2: 'WAL', 3: 'CRN', 4: 'ENG'}
    assert transfers == {'1': 'SCO', '2': 'WAL', '3': 'CRN'}


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


def test_all_18_cases_approve_small_parcel_despite_failed_precision_gate():
    candidates, identity = approval_fixture()
    robust = calculate_fixture(candidates, identity)
    cases = robust['RU_TEST']['cases']
    assert len(cases) == 18
    assert {(c['scheme'], c['bearing_degrees']) for c in cases} == {
        (scheme, bearing) for scheme in ('tps', 'affine') for bearing in [None, *range(0, 360, 45)]}
    assert all(c['project_mode'] == 'PFC' and c['project_share'] == 1 for c in cases)
    assert robust['RU_TEST']['radius_km'] == 20
    approved, review = build_assignments(candidates, identity, robust)
    assert approved['assignments'] == {'RU_TEST': 'PFC'}
    assert not review
    assert approved['summary']['change_matrix']['RFA->PFC'] == dict(count=1, area_km2=10)
    assert approved['summary']['russia']['RFA_split']['approved'] == 1


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


def test_project_tag_country_codes_do_not_exclude_russian_owners():
    candidates, identity = approval_fixture()
    candidates['rows'][0]['country_code'] = 'RFA'
    identity['scope']['project_owners'] = ['RFA']
    robust = calculate_fixture(candidates, identity)
    approved, review = build_assignments(candidates, identity, robust)
    assert approved['assignments'] == {'RU_TEST': 'PFC'}
    assert approved['summary']['russia']['far_east']['approved'] == 1
    assert approved['summary']['russia']['RFA_split']['approved'] == 1
    assert not review


def test_radius_uses_largest_p90_and_configurable_clamps():
    candidates, _ = approval_fixture()
    row, regions = candidates['rows'][0], candidates['regions']
    row['regions'] = ['south_asia']
    regions['south_asia'] = regions.pop('far_east')
    assert perturbation_radius(row, regions) == 30
    regions['south_asia']['schemes']['tps']['p90_km'] = 400
    assert perturbation_radius(row, regions) == 120
    assert perturbation_radius(row, regions, 50, 200) == 200
    row['regions'].append('second')
    regions['second'] = dict(schemes={'tps': dict(p90_km=None), 'affine': dict(p90_km=40)})
    assert perturbation_radius(row, regions) is None


def test_japanese_owner_code_does_not_expand_geographic_scope():
    _, identity = approval_fixture()
    assert in_scope(dict(fid='CN_CITY_1', country_code='JAP', current_owner='JAP'), identity)
    assert in_scope(dict(fid='US_CNTY_1', country_code='JAP', current_owner='JAP'), identity)
    assert not in_scope(dict(fid='TWN-1', country_code='JAP', current_owner='JAP'), identity)


@pytest.mark.parametrize('failure', ['share', 'land', 'tie', 'missing_case', 'city', 'excluded', 'greenland', 'missing_p90'])
def test_robust_approval_gates(failure):
    candidates, identity = approval_fixture()
    if failure == 'city':
        candidates['rows'][0]['city_anchor_owners'] = [dict(city_id='city', owner='MAG')]
    robust = calculate_fixture(candidates, identity)
    case = robust['RU_TEST']['cases'][-1]
    if failure == 'share':
        case['project_share'] = .599
    elif failure == 'land':
        case['valid_land_fraction'] = .799
    elif failure == 'tie':
        case['project_tied'] = True
    elif failure == 'missing_case':
        robust['RU_TEST']['cases'].pop()
    elif failure == 'excluded':
        candidates['rows'][0]['current_owner'] = 'AFA'
    elif failure == 'greenland':
        candidates['rows'][0]['country_code'] = 'GL'
    elif failure == 'missing_p90':
        robust['RU_TEST'] = dict(missing_radius=True, cases=[], city_conflicts=[])
    approved, review = build_assignments(candidates, identity, robust)
    assert not approved['assignments']
    assert len(review) == (0 if failure in ('excluded', 'greenland') else 1)


def test_exact_thresholds_and_identity_equivalent_current_owner():
    candidates, identity = approval_fixture()
    robust = calculate_fixture(candidates, identity)
    for case in robust['RU_TEST']['cases']:
        case['project_share'] = .70
        case['valid_land_fraction'] = .8
    approved, _ = build_assignments(candidates, identity, robust)
    assert approved['assignments']
    candidates['rows'][0]['current_owner'] = 'KMC'
    approved, review = build_assignments(candidates, identity, robust)
    assert not approved['assignments'] and not review
    assert approved['summary']['robust_unchanged'] == 1
    assert normalize_current('RSF', identity) == 'MAG'
    assert normalize_current('MAG', identity) == 'MGN'


def test_merge_identity_votes_before_computing_mode_and_share():
    candidates, identity = approval_fixture()
    identity['original_to_project']['OTHER'] = dict(policy='one_to_one', project_tags=['PFC'], default_project_tag='PFC')
    result = project_votes({'KMC': 40, 'OTHER': 35, 'MAG': 25}, 100, candidates['rows'][0], identity, set())
    assert result['project_mode'] == 'PFC'
    assert result['project_share'] == .75
    assert result['project_votes'] == {'PFC': 75, 'MAG': 25}


def test_china_preserves_existing_entities_and_only_splits_missing_entities():
    candidates, identity = approval_fixture()
    identity['original_to_project'].update({
        'CHI': dict(policy='preserve_custom', project_tags=['CHI', 'NCP', 'RGC'], default_project_tag='CHI'),
        'GAN': dict(policy='preserve_custom', project_tags=['GAN', 'GMA'], default_project_tag='GAN'),
        'NEW': dict(policy='one_to_one', project_tags=['NEW'], default_project_tag='NEW'),
        'GUZ': dict(policy='preserve_custom', project_tags=['GUZ'], default_project_tag='GUZ')})
    identity['conflict_migrations']['GUI'] = dict(new_tag='GUZ')
    candidates['rows'] = [dict(current_owner=tag) for tag in ['NCP', 'GMA', 'GUI']]
    present = represented_originals(candidates, identity)
    assert {'CHI', 'GAN', 'GUZ'} <= present and 'NEW' not in present
    assert resolve_identity('CHI', 'GMA', identity, 'CN', present) == 'GMA'
    assert resolve_identity('GAN', 'NCP', identity, 'CN', present) == 'NCP'
    assert resolve_identity('NEW', 'NCP', identity, 'CN', present) == 'NEW'
    assert resolve_identity('GUZ', 'GUI', identity, 'CN', present) == 'GUZ'
    identity['china_policy']['country_codes'].append('NCP')
    assert resolve_identity('GAN', 'NCP', identity, 'NCP', present) == 'NCP'
    assert resolve_identity('GAN', 'NCP', identity, 'MEN', present, 'CN_CITY_1') == 'NCP'
    assert resolve_identity('GAN', 'MON', identity, 'MEN', present, 'MNG-1') == 'GAN'
    assert region_for(-175, 65) == 'far_east'
    assert list(regions_for([[-175, 65], [55, 55], [70, 55], [105, 55], [130, 35]])) == [
        'far_east', 'west_russia', 'west_siberia', 'central_siberia', 'east_asia']


def test_russian_median_radius_share_configuration_and_review_summary():
    candidates, identity = approval_fixture()
    row, regions = candidates['rows'][0], candidates['regions']
    regions['far_east']['schemes']['tps'].update(median_km=80, p90_km=200)
    assert perturbation_radius(row, regions) == 60
    assert perturbation_radius(row, regions, russian_max_radius=90) == 80
    assert perturbation_radius(row, regions, russian_max_radius=250, russian_error_stat='p90_km') == 200
    regions['far_east']['schemes']['tps']['median_km'] = 10
    robust = calculate_fixture(candidates, identity)
    for case in robust['RU_TEST']['cases']:
        case['project_share'] = .60
    approved, review = build_assignments(candidates, identity, robust)
    assert approved['assignments'] and not review
    approved, review = build_assignments(candidates, identity, robust, russian_min_share=.61)
    assert not approved['assignments'] and len(review) == 1
    assert approved['summary']['russia']['RFA_split']['manual_review'] == 1
    assert approved['summary']['russia']['far_east']['manual_review'] == 1
    row['regions'] = ['south_asia']
    approved, review = build_assignments(candidates, identity, robust)
    assert not approved['assignments'] and len(review) == 1


def test_real_identity_india_alias_preserves_raj_and_pakistan_changes():
    import json
    from pathlib import Path
    identity = json.loads((Path(__file__).resolve().parents[1] / 'data/scenario-rules/tno_1962.identity_map.json').read_text(encoding='utf-8'))
    assert normalize_current('IND', identity) == 'RAJ'
    assert normalize_current('RAJ', identity) == 'RAJ'
    assert resolve_identity('IND', 'PAK', identity, 'PAK', set()) == 'RAJ'
    candidates, _ = approval_fixture()
    candidates['rows'][0].update(current_owner='RAJ', country_code='IN', regions=['south_asia'])
    robust = calculate_fixture(*approval_fixture())
    for case in robust['RU_TEST']['cases']:
        case['project_mode'] = 'RAJ'
    approved, review = build_assignments(candidates, identity, robust)
    assert not approved['assignments'] and not review
    assert approved['summary']['robust_unchanged'] == 1
    candidates['rows'][0]['current_owner'] = 'PAK'
    approved, review = build_assignments(candidates, identity, robust)
    assert approved['assignments'] == {'RU_TEST': 'RAJ'} and not review


def test_tan_prc_identity_migration_is_not_a_territorial_change():
    import json
    from pathlib import Path
    identity = json.loads((Path(__file__).resolve().parents[1] / 'data/scenario-rules/tno_1962.identity_map.json').read_text(encoding='utf-8'))
    assert normalize_current('TAN', identity) == 'PRC'
    assert resolve_identity('PRC', 'TAN', identity, 'TAN', set()) == 'PRC'
    candidates, _ = approval_fixture()
    candidates['rows'][0].update(current_owner='TAN', country_code='TAN')
    robust = calculate_fixture(*approval_fixture())
    for case in robust['RU_TEST']['cases']:
        case['project_mode'] = 'PRC'
    approved, review = build_assignments(candidates, identity, robust)
    assert not approved['assignments'] and not review
    assert approved['summary']['robust_unchanged'] == 1
    for case in robust['RU_TEST']['cases']:
        case['project_mode'] = 'MEN'
    approved, review = build_assignments(candidates, identity, robust)
    assert approved['assignments'] == {'RU_TEST': 'MEN'} and not review
