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


def test_changed_source_bytes_are_rejected_before_reading(monkeypatch, tmp_path):
    monkeypatch.setattr(repair, 'REVIEWED_SHA256', {'source.shp': 'not-this-file'})
    (tmp_path / 'source.shp').write_bytes(b'altered source')
    with pytest.raises(ValueError, match='Reviewed source bytes changed'):
        repair.read_reviewed_sources(tmp_path)
