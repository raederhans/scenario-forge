"""Same-ID restoration keeps competing claims, water and unrelated land intact."""
from copy import deepcopy

import pytest
import shapely
from shapely.geometry import box

from map_builder.regional_geometry import _absolute_topology, _decode_geometry, _encode_exact_coverage
from tools import repair_tno_balkan_anatolia_seams as repair


def add_object(topology, name, geometry):
    index = len(topology['arcs'])
    topology['arcs'].append([list(p) for p in geometry.exterior.coords])
    topology['objects'][name] = dict(type='Polygon', arcs=[[index]])


@pytest.fixture
def example():
    hole = box(19, 43, 19.1, 43.1)
    outer = box(18.9, 42.9, 19.2, 43.2)
    occupied = outer.difference(hole)
    pieces = [occupied.intersection(box(18.8, 42.8, 19.05, 43.3)),
              occupied.intersection(box(19.05, 42.8, 19.3, 43.3))]
    topology = _encode_exact_coverage(['BA', 'ME', 'unrelated'], [*pieces, box(20, 44, 20.1, 44.1)])
    for row in topology['objects']['political']['geometries']:
        row['properties'].update(cntr_code=row['properties']['id'], nested={'keep': [1, 2]})
    add_object(topology, 'land_mask', box(18, 42, 21, 45))
    add_object(topology, 'scenario_water', box(17, 41, 17.1, 41.1))
    add_object(topology, 'scenario_atlantropa', box(17, 40, 17.1, 40.1))
    sources = {'BA': box(18.9, 42.9, 19.06, 43.2), 'ME': box(19.04, 42.9, 19.2, 43.2)}
    owners = {'BA': 'CRO', 'ME': 'MNT', 'unrelated': 'other'}
    spec = dict(name='synthetic', bounds=hole.bounds, seed=(19.05, 43.05),
                area_range_km2=(repair.area_km2(hole) * .999, repair.area_km2(hole) * 1.001),
                contacts={'BA': ('BA', 'CRO'), 'ME': ('ME', 'MNT')})
    return topology, owners, sources, [spec], hole


def test_exclusive_source_portions_restored_while_competing_claims_stay_missing(example):
    baseline, owners, sources, specs, hole = example
    saved, saved_owners = deepcopy(baseline), dict(owners)
    candidate, report = repair.build_candidate(baseline, owners, sources, shapely.GeometryCollection(), specs=specs)
    assert baseline == saved and owners == saved_owners
    old, new = _absolute_topology(baseline), _absolute_topology(candidate)
    restored = []
    for a, b in zip(old['objects']['political']['geometries'], new['objects']['political']['geometries']):
        fid = a['properties']['id']
        before, after = _decode_geometry(old, a), _decode_geometry(new, b)
        assert a['properties'] == b['properties']
        assert before.difference(after).area <= repair.AREA_EPSILON
        if fid == 'unrelated':
            assert before.equals_exact(after, 0)
        else:
            added = after.difference(before)
            assert added.difference(sources[fid]).area <= repair.AREA_EPSILON
            assert added.intersection(sources['ME' if fid == 'BA' else 'BA']).area <= repair.AREA_EPSILON
            restored.append(added)
    assert report['release_ready'] is False
    assert report['corridors'][0]['ambiguous_source_area_km2'] > 0
    assert hole.difference(shapely.union_all(restored)).area == pytest.approx(.002)
    assert set(candidate['political_precision_feature_ids']) == {'BA', 'ME'}


def test_protected_lake_is_left_unassigned_even_when_source_covers_it(example):
    baseline, owners, sources, specs, hole = example
    lake = box(19.01, 43.02, 19.02, 43.03)
    candidate, report = repair.build_candidate(baseline, owners, sources, lake, specs=specs)
    absolute = _absolute_topology(candidate)
    union = shapely.union_all([_decode_geometry(absolute, row) for row in absolute['objects']['political']['geometries']])
    assert union.intersection(lake).area == 0
    assert report['corridors'][0]['lake_intersection_area_km2'] > 0


def test_all_source_claims_ambiguous_is_not_arbitrarily_assigned():
    gap = box(19, 43, 19.1, 43.1)
    assignments, ambiguous, unsupported = repair.partition_source_pieces(
        gap, {'A': gap, 'B': gap}, shapely.GeometryCollection())
    assert assignments == {}
    assert ambiguous.equals(gap) and unsupported.is_empty
