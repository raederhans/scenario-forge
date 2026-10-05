"""Fixed synthetic reviewed corridors independent of evolving canonical data."""
from copy import deepcopy

import geopandas as gpd
import pytest
import shapely
from shapely.geometry import box

from map_builder.regional_geometry import _absolute_topology, _decode_geometry, _encode_exact_coverage
from tools import repair_tno_levant_seams as repair


def add_object(topology, name, geometry):
    index = len(topology['arcs'])
    topology['arcs'].append([list(p) for p in geometry.exterior.coords])
    topology['objects'][name] = dict(type='Polygon', arcs=[[index]])


@pytest.fixture
def fixture(monkeypatch):
    gap = box(35.2, 33.2, 35.4, 33.4)
    geometries = {
        'ISR-3056': box(35, 33, 35.2, 33.6).union(box(35.2, 33, 35.4, 33.2)),
        'LBN-3059': box(35.4, 33, 35.6, 33.6).union(box(35.2, 33.4, 35.4, 33.6)),
        'unrelated': box(37, 34, 37.2, 34.2),
    }
    baseline = _encode_exact_coverage(list(geometries), list(geometries.values()))
    owners = {'ISR-3056': 'PAL', 'LBN-3059': 'LEB', 'unrelated': 'TUR'}
    countries = {'ISR-3056': 'IL', 'LBN-3059': 'LB', 'unrelated': 'XX'}
    for row in baseline['objects']['political']['geometries']:
        row['properties'].update(cntr_code=countries[row['properties']['id']], retained={'name': 'old'})
    baseline['political_precision_feature_ids'] = ['unrelated']
    baseline['other_metadata'] = {'prior_candidate': True}
    add_object(baseline, 'land_mask', box(34.5, 32.5, 38, 35))
    add_object(baseline, 'scenario_water', box(34.6, 32.6, 34.7, 32.7))
    add_object(baseline, 'scenario_atlantropa', box(34.7, 32.7, 34.8, 32.8))
    source = gpd.GeoDataFrame([
        dict(adm1_code='ISR-3056', geometry=geometries['ISR-3056'].union(box(35.2, 33.2, 35.3, 33.4))),
        dict(adm1_code='LBN-3059', geometry=geometries['LBN-3059'].union(box(35.3, 33.2, 35.4, 33.4))),
    ], crs=4326)
    spec = dict(name='reviewed', seed=tuple(gap.representative_point().coords[0]), bounds=gap.bounds,
                area_range_km2=(repair.area_km2(gap)*.99, repair.area_km2(gap)*1.01),
                contacts={'ISR-3056': ('IL', 'PAL'), 'LBN-3059': ('LB', 'LEB')})
    monkeypatch.setattr(repair, 'REVIEWED_GAPS', [spec])
    monkeypatch.setattr(repair, 'EXTENT', (34.5, 32.5, 38, 35))
    return baseline, owners, source, gap


def build(fixture, **kwargs):
    baseline, owners, source, _ = fixture
    return repair.build_candidate(baseline, owners, source, protected_water=kwargs.get('water', shapely.GeometryCollection()))


def test_restores_reviewed_gap_with_same_id_and_preserves_prior_candidate(fixture):
    baseline, owners, source, gap = fixture
    original, original_owners = deepcopy(baseline), deepcopy(owners)
    candidate, report = build(fixture)
    assert baseline == original and owners == original_owners
    assert report['status'] == 'PASS_SOURCE_SUPPORTED_RESTORATION' and not report['release_ready']
    assert report['full_boundary_pairs_checked'] == 1
    assert report['target_joint_coverage_valid'] and report['assembly_group_count'] == 1
    assert report['changed_ids'] == ['ISR-3056', 'LBN-3059']
    assert candidate['other_metadata'] == baseline['other_metadata']
    assert candidate['political_precision_feature_ids'] == ['unrelated', 'ISR-3056', 'LBN-3059']
    before, after = _absolute_topology(baseline), _absolute_topology(candidate)
    decoded = []
    for old, new in zip(before['objects']['political']['geometries'], after['objects']['political']['geometries']):
        assert old['properties'] == new['properties']
        a, b = _decode_geometry(before, old), _decode_geometry(after, new)
        assert a.difference(b).area <= repair.AREA_EPSILON
        decoded.append(b)
        fid = old['properties']['id']
        if fid == 'unrelated':
            assert a.equals_exact(b, 0)
        else:
            s = source[source.adm1_code == fid].geometry.iloc[0]
            assert b.equals(a.union(gap.intersection(s)))
    assert shapely.union_all(decoded).covers(gap)


def test_repeat_is_explicitly_rejected(fixture):
    candidate, _ = build(fixture)
    with pytest.raises(ValueError, match='absent, already repaired or ambiguous'):
        repair.build_candidate(candidate, fixture[1], fixture[2], protected_water=shapely.GeometryCollection())


def test_existing_overlap_is_retained_without_forcing_joint_coverage(fixture):
    baseline = fixture[0]
    absolute = _absolute_topology(baseline)
    row = baseline['objects']['political']['geometries'][0]
    original = _decode_geometry(absolute, absolute['objects']['political']['geometries'][0])
    # A coarse protrusion overlaps the neighbor outside the reviewed empty gap.
    expanded = original.union(box(35.4, 33, 35.41, 33.1))
    index = len(baseline['arcs'])
    baseline['arcs'].append([list(p) for p in expanded.exterior.coords])
    row.update(type='Polygon', arcs=[[index]])
    _, report = build(fixture)
    assert not report['target_joint_coverage_valid']
    assert report['assembly_group_count'] == 2
    overlap = report['full_boundary_pairs'][0]
    assert overlap['old_area_degrees2'] > 0
    assert overlap['symmetric_difference_area_degrees2'] <= repair.AREA_EPSILON


@pytest.mark.parametrize('protection', ['lakes', 'scenario_water', 'scenario_atlantropa', 'land_mask'])
def test_never_fills_protected_water_or_non_land(fixture, protection):
    baseline, _, _, gap = fixture
    if protection == 'lakes':
        water = gap
    elif protection == 'land_mask':
        add_object(baseline, protection, box(34.5, 32.5, 35.2, 35))
        water = shapely.GeometryCollection()
    else:
        add_object(baseline, protection, gap)
        water = shapely.GeometryCollection()
    with pytest.raises(ValueError, match='protected water, Atlantropa or land-mask boundary'):
        build(fixture, water=water)


def test_source_partial_support_fails_closed(fixture):
    fixture[2].at[0, 'geometry'] = box(35, 33, 35.2, 33.6).union(box(35.2, 33.2, 35.25, 33.4))
    with pytest.raises(ValueError, match='incomplete same-ID source support'):
        build(fixture)


def test_ambiguous_source_overlap_fails_closed(fixture):
    fixture[2].at[0, 'geometry'] = fixture[2].geometry.iloc[0].union(fixture[3])
    with pytest.raises(ValueError, match='ambiguous source allocation'):
        build(fixture)


@pytest.mark.parametrize('mutation', ['owner', 'country', 'helper', 'interactive', 'id'])
def test_changed_contact_contract_fails_closed(fixture, mutation):
    baseline, owners, _, _ = fixture
    props = baseline['objects']['political']['geometries'][0]['properties']
    if mutation == 'owner':
        owners[props['id']] = 'ISR'
    elif mutation == 'country':
        props['cntr_code'] = 'modern-owner'
    elif mutation == 'helper':
        props['scenario_helper_kind'] = 'shell_fallback'
    elif mutation == 'interactive':
        props['interactive'] = False
    else:
        props['id'] = 'new-id'
    with pytest.raises(ValueError, match='contact IDs changed|expected attributes or owner changed'):
        build(fixture)


@pytest.mark.parametrize('mutation', ['duplicate', 'missing', 'invalid', 'crs'])
def test_invalid_source_contract(fixture, mutation):
    source = fixture[2]
    if mutation == 'duplicate':
        source.at[1, 'adm1_code'] = source.adm1_code.iloc[0]
    elif mutation == 'missing':
        source.at[1, 'adm1_code'] = 'not-same-id'
    elif mutation == 'invalid':
        source.at[1, 'geometry'] = shapely.Polygon([(0, 0), (1, 1), (0, 1), (1, 0)])
    else:
        source.geometry.array.crs = None
    with pytest.raises(ValueError, match='Source IDs|Missing or invalid same-ID|requires adm1_code'):
        build(fixture)


def test_changed_source_bytes_are_rejected_before_reading(monkeypatch, tmp_path):
    monkeypatch.setattr(repair, 'REVIEWED_SHA256', {'source.shp': 'not-this-file'})
    (tmp_path / 'source.shp').write_bytes(b'altered source')
    with pytest.raises(ValueError, match='Reviewed source bytes changed'):
        repair.read_reviewed_sources(tmp_path)
