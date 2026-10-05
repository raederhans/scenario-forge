"""Reviewed manifest/source boundaries and staged same-ID restoration."""
from copy import deepcopy
import hashlib
import json

import geopandas as gpd
import pytest
import shapely
from shapely.geometry import LineString, Polygon, box

from map_builder.regional_geometry import _absolute_topology, _decode_geometry, _encode_exact_coverage
from tools import repair_tno_remaining_europe_seams as repair
from tools.repair_tno_balkan_anatolia_seams import area_km2


def manifest():
    return dict(schema_version=1, baseline_topology_sha256='a' * 64,
                sources={key: dict(**pin, url='https://example.test/pinned')
                         for key, pin in repair.REVIEWED_SOURCES.items()},
                specs=[dict(name='reviewed', seed=[19.05, 43.05], bounds=[19, 43, 19.1, 43.1],
                            area_range_km2=[90, 100], contacts={'FI111': ['FI', 'FIN'],
                                                               'RU_RAY_1B2': ['RU', 'FIN']})])


def write_json(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')
    return path


def test_valid_manifest_is_read_without_implicit_spec_selection(tmp_path):
    value = manifest()
    assert repair.read_manifest(write_json(tmp_path / 'specs.json', value)) == value


@pytest.mark.parametrize('change', ['version', 'baseline', 'keys', 'digest', 'bytes', 'url',
                                  'empty', 'duplicate', 'contacts', 'nonfinite', 'seed',
                                  'split', 'city', 'inconsistent_owner'])
def test_invalid_manifest_rejected_before_source_io(tmp_path, change):
    value = manifest()
    spec = value['specs'][0]
    if change == 'version': value['schema_version'] = True
    elif change == 'baseline': value['baseline_topology_sha256'] = 'unreviewed'
    elif change == 'keys': value['sources']['arbitrary'] = value['sources']['nuts']
    elif change == 'digest': value['sources']['nuts']['sha256'] = '0' * 64
    elif change == 'bytes': value['sources']['nuts']['bytes'] += 1
    elif change == 'url': value['sources']['nuts']['url'] = 'file://local'
    elif change == 'empty': value['specs'] = []
    elif change == 'duplicate': value['specs'].append(deepcopy(spec))
    elif change == 'contacts': spec['contacts'].pop('FI111')
    elif change == 'nonfinite': spec['bounds'][0] = float('nan')
    elif change == 'seed': spec['seed'] = [25, 43.05]
    elif change == 'split': spec['contacts']['RU_RAY_1B2__tno1962_1'] = spec['contacts'].pop('RU_RAY_1B2')
    elif change == 'city': spec['contacts']['RU_CITY_TEST'] = spec['contacts'].pop('RU_RAY_1B2')
    elif change == 'inconsistent_owner':
        other = deepcopy(spec)
        other.update(name='other', seed=[19.04, 43.05])
        other['contacts']['FI111'][1] = 'GER'
        value['specs'].append(other)
    with pytest.raises(ValueError):
        repair.read_manifest(write_json(tmp_path / 'specs.json', value))


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


def test_source_reader_uses_the_checked_snapshot(tmp_path, monkeypatch):
    path = tmp_path / 'source.geojson'
    path.write_bytes(b'original')
    identity = dict(bytes=8, sha256=hashlib.sha256(b'original').hexdigest())
    def inspect(snapshot):
        path.write_bytes(b'changed!')
        assert snapshot.read() == b'original'
        return 'frame'
    monkeypatch.setattr(repair.gpd, 'read_file', inspect)
    assert repair.read_pinned_frame('nuts', path, identity)[0] == 'frame'


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


def test_no_fallback_to_france_id_or_duplicate_codes():
    frame = gpd.GeoDataFrame({'id': ['68004']}, geometry=[box(7, 47, 8, 48)], crs=4326)
    with pytest.raises(ValueError, match='original code'):
        repair._source_ids(frame, 'france')
    frame['code'] = ['68004']
    frame = gpd.GeoDataFrame(frame.loc[frame.index.repeat(2)].reset_index(drop=True), crs=4326)
    with pytest.raises(ValueError, match='unique'):
        repair._source_ids(frame, 'france')


@pytest.fixture
def synthetic(tmp_path, monkeypatch):
    monkeypatch.setattr(repair, 'ROOT', tmp_path)
    hole, outer = box(19, 43, 19.1, 43.1), box(18.9, 42.9, 19.2, 43.2)
    occupied = outer.difference(hole)
    baseline = _encode_exact_coverage(['FI111', 'RU_RAY_1B2', 'unrelated'], [
        occupied.intersection(box(18.8, 42.8, 19.05, 43.3)),
        occupied.intersection(box(19.05, 42.8, 19.3, 43.3)), box(20, 44, 20.1, 44.1)])
    for row in baseline['objects']['political']['geometries']:
        row['properties']['cntr_code'] = {'FI111': 'FI', 'RU_RAY_1B2': 'RU', 'unrelated': 'XX'}[row['properties']['id']]
    for name, polygon in [('land_mask', box(18, 42, 21, 45)),
                          ('scenario_water', box(17, 41, 17.1, 41.1)),
                          ('scenario_atlantropa', box(17, 40, 17.1, 40.1))]:
        index = len(baseline['arcs'])
        baseline['arcs'].append([list(xy) for xy in polygon.exterior.coords])
        baseline['objects'][name] = dict(type='Polygon', arcs=[[index]])
    baseline_path = write_json(tmp_path / 'baseline.json', baseline)
    owners_path = write_json(tmp_path / 'owners.json', {'owners': {'FI111': 'FIN', 'RU_RAY_1B2': 'FIN', 'unrelated': 'XX'}})
    water = box(19.01, 43.02, 19.02, 43.03)
    frames = {
        'nuts': gpd.GeoDataFrame({'NUTS_ID': ['FI111'], 'LEVL_CODE': [3]}, geometry=[box(18.9, 42.9, 19.06, 43.2)], crs=4326).to_crs(3035),
        'russia': gpd.GeoDataFrame({'shapeID': ['1B2'], 'shapeGroup': ['RUS'], 'shapeType': ['ADM2']}, geometry=[box(19.04, 42.9, 19.2, 43.2)], crs=4326),
        'france': gpd.GeoDataFrame({'code': ['68004']}, geometry=[box(7, 47, 8, 48)], crs=4326),
        'lakes': gpd.GeoDataFrame({'name': ['lake']}, geometry=[water], crs=4326),
        'lakes_original': gpd.GeoDataFrame({'name': ['original']}, geometry=[water], crs=4326),
        'rivers': gpd.GeoDataFrame({'name': ['line']}, geometry=[LineString([(19, 43), (19.1, 43.1)])], crs=4326),
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
    value['baseline_topology_sha256'] = hashlib.sha256(baseline_path.read_bytes()).hexdigest()
    area = area_km2(hole)
    value['specs'][0]['area_range_km2'] = [area * .999, area * 1.001]
    manifest_path = write_json(tmp_path / 'specs.json', value)
    return baseline, baseline_path, owners_path, value, manifest_path, paths, water


def test_arbitrary_contact_id_has_no_source_fallback(synthetic):
    _, _, _, value, _, paths, _ = synthetic
    value['specs'][0]['contacts']['arbitrary'] = value['specs'][0]['contacts'].pop('FI111')
    with pytest.raises(ValueError, match='Missing full same-ID sources'):
        repair.read_sources(value, paths)


def _replace_original_lakes(synthetic, monkeypatch, geometries):
    _, _, _, value, _, paths, _ = synthetic
    frame = gpd.GeoDataFrame({'name': ['test'] * len(geometries)}, geometry=geometries, crs=4326)
    frame.to_file(paths['lakes_original'], driver='GeoJSON')
    pin = dict(bytes=paths['lakes_original'].stat().st_size,
               sha256=hashlib.sha256(paths['lakes_original'].read_bytes()).hexdigest())
    monkeypatch.setitem(repair.REVIEWED_SOURCES, 'lakes_original', pin)
    value['sources']['lakes_original'].update(pin)
    return value, paths


def test_remote_invalid_lake_is_recorded_and_full_intersecting_lake_retained(synthetic, monkeypatch):
    remote = Polygon([(101, 54), (102, 55), (101, 55), (102, 54), (101, 54)])
    # Most of this lake is outside the reviewed hole; retain its complete ring.
    full_lake = box(18.8, 43.02, 19.02, 43.03)
    value, paths = _replace_original_lakes(synthetic, monkeypatch, [remote, full_lake])
    _, protected, metadata = repair.read_sources(value, paths)
    assert full_lake.difference(protected).is_empty
    assert protected.intersection(remote.envelope).is_empty
    assert metadata['lakes_original']['selected_full_polygon_count'] == 1
    assert metadata['lakes_original']['excluded_remote_polygon_count'] == 1
    assert metadata['lakes_original']['excluded_remote_invalid_polygons'][0]['bounds'] == list(remote.bounds)


def test_invalid_lake_with_envelope_in_reviewed_bounds_fails_closed(synthetic, monkeypatch):
    invalid = Polygon([(19.01, 43.01), (19.09, 43.09), (19.01, 43.09), (19.09, 43.01), (19.01, 43.01)])
    value, paths = _replace_original_lakes(synthetic, monkeypatch, [invalid])
    with pytest.raises(ValueError, match='invalid protected water polygon in reviewed bounds'):
        repair.read_sources(value, paths)


def test_synthetic_cli_stages_exclusive_land_and_preserves_water_and_owners(synthetic, tmp_path):
    baseline, baseline_path, owners_path, _, manifest_path, paths, water = synthetic
    original_owners = owners_path.read_bytes()
    output, report = tmp_path / '.runtime/candidate.json', tmp_path / '.runtime/report.json'
    argv = ['--baseline-topology', str(baseline_path), '--owners', str(owners_path),
            '--specs', str(manifest_path), '--output-topology', str(output), '--report', str(report)]
    for key, path in paths.items():
        argv.extend(['--' + key.replace('_', '-') + '-source', str(path)])
    repair.main(argv)
    candidate = _absolute_topology(json.loads(output.read_text(encoding='utf-8')))
    old = _absolute_topology(baseline)
    new_rows = {row['properties']['id']: row for row in candidate['objects']['political']['geometries']}
    for row in old['objects']['political']['geometries']:
        fid = row['properties']['id']
        assert row['properties'] == new_rows[fid]['properties']
        before, after = _decode_geometry(old, row), _decode_geometry(candidate, new_rows[fid])
        assert before.difference(after).area <= 1e-10
        if fid == 'unrelated': assert before.equals_exact(after, 0)
    union = shapely.union_all([_decode_geometry(candidate, row) for row in new_rows.values()])
    assert union.intersection(water).area == 0
    assert union.intersection(box(19.04, 43, 19.06, 43.1)).area <= 1e-10
    result = json.loads(report.read_text(encoding='utf-8'))
    assert result['changed_ids'] == ['FI111', 'RU_RAY_1B2']
    assert result['owners_unchanged'] and not result['release_ready']
    assert result['sources']['rivers']['unbuffered_river_line_count'] == 1
    assert result['corridors'][0]['lake_intersection_area_km2'] > 0
    assert result['corridors'][0]['ambiguous_source_area_km2'] > 0
    assert baseline_path.read_bytes() == json.dumps(baseline).encode()
    assert owners_path.read_bytes() == original_owners
    with pytest.raises(FileExistsError): repair.main(argv)


def test_changed_baseline_rejected_before_source_read(synthetic, tmp_path, monkeypatch):
    _, baseline_path, owners_path, _, manifest_path, _, _ = synthetic
    baseline_path.write_bytes(b'changed baseline')
    monkeypatch.setattr(repair, 'read_sources', lambda *_: pytest.fail('Unreviewed baseline reached sources'))
    with pytest.raises(ValueError, match='Baseline topology bytes differ'):
        repair.main(['--baseline-topology', str(baseline_path), '--owners', str(owners_path),
                     '--specs', str(manifest_path), '--nuts-source', 'unused', '--russia-source', 'unused',
                     '--output-topology', str(tmp_path / '.runtime/candidate.json'),
                     '--report', str(tmp_path / '.runtime/report.json')])


def test_canonical_or_existing_output_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(repair, 'ROOT', tmp_path)
    with pytest.raises(ValueError, match='.runtime'):
        repair._output_paths(tmp_path / 'data/canonical.json', tmp_path / '.runtime/report.json')
    with pytest.raises(FileExistsError):
        repair._output_paths(tmp_path / '.runtime/same.json', tmp_path / '.runtime/same.json')
