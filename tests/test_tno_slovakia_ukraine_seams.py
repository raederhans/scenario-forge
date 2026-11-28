"""Stable synthetic fixtures; canonical data may already contain the repair."""
from copy import deepcopy

import geopandas as gpd
import pytest
import shapely
from shapely.geometry import box

from map_builder.regional_geometry import _absolute_topology, _decode_geometry, _encode_exact_coverage
from tools import repair_tno_slovakia_ukraine_seams as repair


def add_object(topology, name, geometry):
    index = len(topology['arcs'])
    topology['arcs'].append([list(p) for p in geometry.exterior.coords])
    topology['objects'][name] = dict(type='Polygon', arcs=[[index]])


@pytest.fixture
def fixture(monkeypatch):
    specs = deepcopy(repair.REVIEWED_GAPS)
    sk = [fid for fid, value in specs[0]['contacts'].items() if value[0] == 'SK']
    ua = [fid for fid, value in specs[0]['contacts'].items() if value[0] == 'UA']
    small_sk = next(fid for fid, value in specs[1]['contacts'].items() if value[0] == 'SK')
    gaps = [box(22.2, 48.6, 22.4, 48.9), box(22.2, 48.3, 22.3, 48.4)]
    geometries = {
        sk[0]: box(22.0, 48.5, 22.2, 48.7).union(box(22.0, 48.5, 22.6, 48.6)),
        sk[1]: box(22.0, 48.7, 22.2, 48.8),
        sk[2]: box(22.0, 48.8, 22.2, 49.0).union(box(22.0, 48.9, 22.6, 49.0)),
        ua[0]: box(22.4, 48.6, 22.6, 48.7),
        ua[1]: box(22.4, 48.7, 22.6, 48.8),
        ua[2]: box(22.4, 48.8, 22.6, 48.9).union(box(22.3, 48.3, 22.6, 48.4)),
        small_sk: box(22.0, 48.2, 22.2, 48.5).union(box(22.0, 48.2, 22.6, 48.3)).union(
            box(22.0, 48.4, 22.6, 48.5)),
    }
    owners = {fid: owner for spec in specs for fid, (_, owner) in spec['contacts'].items()}
    countries = {fid: country for spec in specs for fid, (country, _) in spec['contacts'].items()}
    topology = _encode_exact_coverage(list(geometries), list(geometries.values()))
    for row in topology['objects']['political']['geometries']:
        fid = row['properties']['id']
        row['properties'].update(cntr_code=countries[fid], detail={'keep': 1})
    add_object(topology, 'land_mask', box(21.9, 48.1, 22.7, 49.1))
    add_object(topology, 'scenario_water', box(20, 40, 20.1, 40.1))
    add_object(topology, 'scenario_atlantropa', box(20, 41, 20.1, 41.1))
    source_rows = []
    for index, fid in enumerate(sk):
        # Use the existing junction values, avoiding decimal-addition drift.
        lower, upper = [(48.6, 48.7), (48.7, 48.8), (48.8, 48.9)][index]
        extension = box(22.2, lower, 22.22, upper)
        source_rows.append(dict(shapeID=fid.removeprefix(repair.SK_PREFIX),
                                geometry=geometries[fid].union(extension)))
    source_rows.append(dict(shapeID=small_sk.removeprefix(repair.SK_PREFIX),
                            geometry=geometries[small_sk].union(box(22.2, 48.3, 22.22, 48.4))))
    for spec, gap in zip(specs, gaps):
        spec.update(seed=tuple(gap.representative_point().coords[0]), bounds=gap.bounds,
                    area_range_km2=(repair.area_km2(gap) * .99, repair.area_km2(gap) * 1.01))
    monkeypatch.setattr(repair, 'REVIEWED_GAPS', specs)
    monkeypatch.setattr(repair, 'EXTENT', (21.9, 48.1, 22.7, 49.1))
    return topology, owners, gpd.GeoDataFrame(source_rows, crs=4326), gaps


def test_same_id_source_intersection_restores_only_supported_land(fixture):
    baseline, owners, source, gaps = fixture
    original, original_owners = deepcopy(baseline), dict(owners)
    candidate, report = repair.build_candidate(baseline, owners, source)
    assert baseline == original and owners == original_owners
    assert report['status'] == 'PASS_SOURCE_SUPPORTED_RESTORATION'
    assert report['source_supported_residual_area_km2'] == 0
    assert report['residual_area_km2'] > report['filled_area_km2'] > 0
    assert report['preexisting_overlaps_retained']
    assert all(fid.startswith(repair.SK_PREFIX) for fid in report['changed_ids'])
    assert set(report['changed_ids']) <= set(candidate['political_precision_feature_ids'])
    assert report['political_precision_feature_ids'] == candidate['political_precision_feature_ids']
    old = _absolute_topology(baseline)
    source_by_id = repair._source_geometries(source)
    reviewed = shapely.union_all(gaps)
    for before, after in zip(old['objects']['political']['geometries'], candidate['objects']['political']['geometries']):
        fid = before['properties']['id']
        a, b = _decode_geometry(old, before), _decode_geometry(candidate, after)
        assert before['properties'] == after['properties']
        if fid in report['changed_ids']:
            assert a.difference(b).area <= repair.AREA_EPSILON
            assert b.equals(a.union(source_by_id[fid].intersection(reviewed)))
        else:
            assert a.equals_exact(b, 0)


def test_reject_changed_contact(fixture):
    baseline, owners, source, _ = fixture
    baseline['objects']['political']['geometries'][0]['properties']['id'] = 'HELPER'
    with pytest.raises(ValueError, match='contact IDs changed'):
        repair.build_candidate(baseline, owners, source)


@pytest.mark.parametrize('surface', ['land_mask', 'scenario_water', 'scenario_atlantropa'])
def test_reject_protected_surfaces(fixture, surface):
    baseline, owners, source, gaps = fixture
    if surface == 'land_mask':
        add_object(baseline, surface, box(22.2, 48.1, 22.7, 49.1))
    else:
        add_object(baseline, surface, gaps[0])
    with pytest.raises(ValueError, match='protected water, Atlantropa or land-mask boundary'):
        repair.build_candidate(baseline, owners, source)


def test_unreviewed_source_bytes_are_rejected(tmp_path):
    path = tmp_path / 'same-shapeIDs.geojson'
    path.write_text('{"type":"FeatureCollection","features":[]}', encoding='utf-8')
    with pytest.raises(ValueError, match='explicitly reviewed source SHA256'):
        repair._read_reviewed_source(path)
