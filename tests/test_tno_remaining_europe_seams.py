"""Reviewed manifest/source boundaries and staged same-ID restoration."""
import hashlib

import geopandas as gpd
import pytest
from shapely.geometry import box

from tools import repair_tno_remaining_europe_seams as repair


def manifest():
    return dict(schema_version=1, baseline_topology_sha256='a' * 64,
                sources={key: dict(**pin, url='https://example.test/pinned')
                         for key, pin in repair.REVIEWED_SOURCES.items()},
                specs=[dict(name='reviewed', seed=[19.05, 43.05], bounds=[19, 43, 19.1, 43.1],
                            area_range_km2=[90, 100], contacts={'FI111': ['FI', 'FIN'],
                                                               'RU_RAY_1B2': ['RU', 'FIN']})])


@pytest.mark.parametrize('change', ['digest', 'bytes'])
def test_changed_source_bytes_never_reach_gdal(tmp_path, monkeypatch, change):
    path = tmp_path / 'source.geojson'
    path.write_bytes(b'reviewed snapshot')
    identity = dict(bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    if change == 'digest': path.write_bytes(b'changed! snapshot')
    else: identity['bytes'] += 1
    monkeypatch.setattr(repair.gpd, 'read_file', lambda _: pytest.fail('Unpinned bytes reached GDAL'))
    with pytest.raises(ValueError, match='source bytes differ'):
        repair.read_pinned_frame('nuts', path, identity)


@pytest.mark.parametrize('key,column,expected,epsg,extra', [
    ('nuts', 'NUTS_ID', 'CH032', 3035, {'LEVL_CODE': [3]}),
    ('russia', 'shapeID', 'RU_RAY_1B2', 4326, {'shapeGroup': ['RUS'], 'shapeType': ['ADM2']}),
    ('france', 'code', 'FR_ARR_68004', 4326, {}),
])
def test_fixed_original_id_mapping_and_crs(key, column, expected, epsg, extra):
    original = expected.removeprefix('RU_RAY_').removeprefix('FR_ARR_')
    frame = gpd.GeoDataFrame({column: [original], **extra}, geometry=[box(7, 47, 8, 48)], crs=4326)
    if epsg != 4326: frame = frame.to_crs(epsg)
    ids, mapped = repair._source_ids(frame, key)
    assert ids.tolist() == [expected]
    assert mapped.crs.to_epsg() == 4326
    assert mapped.geometry.iloc[0].symmetric_difference(box(7, 47, 8, 48)).area < 1e-7


@pytest.fixture
def synthetic(tmp_path, monkeypatch):
    frames = {
        'nuts': gpd.GeoDataFrame({'NUTS_ID': ['FI111'], 'LEVL_CODE': [3]}, geometry=[box(18.9, 42.9, 19.06, 43.2)], crs=4326).to_crs(3035),
        'russia': gpd.GeoDataFrame({'shapeID': ['1B2'], 'shapeGroup': ['RUS'], 'shapeType': ['ADM2']}, geometry=[box(19.04, 42.9, 19.2, 43.2)], crs=4326),
        'france': gpd.GeoDataFrame({'code': ['68004']}, geometry=[box(7, 47, 8, 48)], crs=4326),
    }
    paths, pins = {}, {}
    value = manifest()
    for key, frame in frames.items():
        path = tmp_path / (key + '.geojson')
        frame.to_file(path, driver='GeoJSON')
        pins[key] = dict(bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        value['sources'][key].update(pins[key])
        paths[key] = path
    monkeypatch.setattr(repair, 'REVIEWED_SOURCES', pins)
    return value, paths


def test_arbitrary_contact_id_has_no_source_fallback(synthetic):
    value, paths = synthetic
    value['specs'][0]['contacts']['arbitrary'] = value['specs'][0]['contacts'].pop('FI111')
    with pytest.raises(ValueError, match='Missing full same-ID sources'):
        repair.read_sources(value, paths)
