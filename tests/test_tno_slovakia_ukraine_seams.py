"""Stable synthetic fixtures; canonical data may already contain the repair."""
from copy import deepcopy

import geopandas as gpd
import pytest
import shapely
from shapely.geometry import box, mapping, shape

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


def test_reject_changed_owner(fixture):
    baseline, owners, source, _ = fixture
    owners[next(iter(owners))] = 'HUN'
    with pytest.raises(ValueError, match='expected owner changed'):
        repair.build_candidate(baseline, owners, source)


@pytest.mark.parametrize('props', [{'interactive': False}, {'scenario_helper_kind': 'shell_fallback'}])
def test_reject_helper_or_noninteractive_contact(fixture, props):
    baseline, owners, source, _ = fixture
    baseline['objects']['political']['geometries'][0]['properties'].update(props)
    with pytest.raises(ValueError, match='helper or noninteractive'):
        repair.build_candidate(baseline, owners, source)


def test_reject_changed_reviewed_bounds(fixture, monkeypatch):
    baseline, owners, source, _ = fixture
    specs = deepcopy(repair.REVIEWED_GAPS)
    specs[0]['bounds'] = (22.1, 48.6, 22.4, 48.9)
    monkeypatch.setattr(repair, 'REVIEWED_GAPS', specs)
    with pytest.raises(ValueError, match='bounds or area changed'):
        repair.build_candidate(baseline, owners, source)


def test_existing_occupancy_cannot_be_restored(fixture):
    baseline, owners, source, gaps = fixture
    index = len(baseline['arcs'])
    baseline['arcs'].append([list(p) for p in box(22.21, 48.62, 22.23, 48.65).exterior.coords])
    baseline['objects']['political']['geometries'].append(
        dict(type='Polygon', arcs=[[index]], properties=dict(id='HELPER', cntr_code='SK', interactive=False)))
    with pytest.raises(ValueError, match='bounds or area changed|contact IDs changed'):
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


@pytest.mark.parametrize('mutation', ['missing_crs', 'duplicate', 'invalid', 'missing_id'])
def test_reject_changed_source_contract(fixture, mutation):
    baseline, owners, source, _ = fixture
    if mutation == 'missing_crs':
        source = source.set_crs(None, allow_override=True)
    elif mutation == 'duplicate':
        source.loc[1, 'shapeID'] = source.loc[0, 'shapeID']
    elif mutation == 'invalid':
        source.loc[0, 'geometry'] = shapely.Polygon([(0, 0), (1, 1), (1, 0), (0, 1)])
    else:
        source.loc[0, 'shapeID'] = 'UNKNOWN'
    with pytest.raises(ValueError):
        repair.build_candidate(baseline, owners, source)


def test_reject_mutated_metadata(fixture, monkeypatch):
    baseline, owners, source, _ = fixture
    assembler = repair.replace_regional_geometry

    def changed(*args, **kwargs):
        result, diagnostic = assembler(*args, **kwargs)
        result['objects']['political']['geometries'][0]['properties']['detail'] = 'changed'
        return result, diagnostic

    monkeypatch.setattr(repair, 'replace_regional_geometry', changed)
    with pytest.raises(ValueError, match='attributes changed'):
        repair.build_candidate(baseline, owners, source)


def test_output_must_be_new_and_inside_runtime(tmp_path, monkeypatch):
    monkeypatch.setattr(repair, 'ROOT', tmp_path)
    with pytest.raises(ValueError, match='inside this workspace .runtime'):
        repair._output_paths(tmp_path / 'canonical.topo.json')
    candidate = tmp_path / '.runtime' / 'candidate.topo.json'
    candidate.parent.mkdir()
    report = candidate.with_suffix('.report.json')
    report.write_text('keep')
    with pytest.raises(FileExistsError):
        repair._output_paths(candidate)
    assert report.read_text() == 'keep'


def test_overlay_roundoff_is_reported_with_existing_tolerance():
    old = box(0, 0, 1, 1)
    new = box(0, 0, 1 + repair.AREA_EPSILON / 2, 1)
    report = repair._overlap_diagnostic(('A', 'B'), old, new)
    assert 0 < report['symmetric_difference_area_degrees2'] <= repair.AREA_EPSILON
    assert report['geometry_equal'] is False
    assert report['old_area_degrees2'] == 1
    assert report['new_area_degrees2'] > 1
    assert report['hausdorff_degrees'] > 0


def test_substantial_overlap_change_is_rejected():
    with pytest.raises(ValueError, match='overlap geometry changed'):
        repair._overlap_diagnostic(('A', 'B'), box(0, 0, 1, 1), box(0, 0, 1.001, 1))


def test_unreviewed_source_bytes_are_rejected(tmp_path):
    path = tmp_path / 'same-shapeIDs.geojson'
    path.write_text('{"type":"FeatureCollection","features":[]}', encoding='utf-8')
    with pytest.raises(ValueError, match='explicitly reviewed source SHA256'):
        repair._read_reviewed_source(path)


def test_area_measurement_preserves_partition_and_empty_geometry():
    corridor = shapely.Polygon([(36, 32), (40, 34), (40, 34.004), (36, 32.004)])
    pieces = [corridor.intersection(box(35, 30, 38, 36)),
              corridor.intersection(box(38, 30, 41, 36))]
    original = corridor.wkb
    assert sum(repair.area_km2(piece) for piece in pieces) == pytest.approx(
        repair.area_km2(corridor), abs=1e-5)
    assert repair.area_km2(shapely.Polygon()) == 0
    assert corridor.wkb == original


def test_existing_precision_ids_are_retained(fixture):
    baseline, owners, source, _ = fixture
    keep = [row['properties']['id'] for row in baseline['objects']['political']['geometries']
            if row['properties']['cntr_code'] == 'UA'][:2]
    baseline['political_precision_feature_ids'] = keep[:]
    candidate, report = repair.build_candidate(baseline, owners, source)
    assert baseline['political_precision_feature_ids'] == keep
    assert candidate['political_precision_feature_ids'][:len(keep)] == keep
    assert set(candidate['political_precision_feature_ids']) == set(keep) | set(report['changed_ids'])
    assert report['precision_ids_added'] == report['changed_ids']


@pytest.mark.parametrize('declared', [None, 'SK', [1], ['UNKNOWN'], [' A '], ['DUP', 'DUP']])
def test_invalid_existing_precision_declaration_is_rejected(fixture, declared):
    baseline, _, _, _ = fixture
    baseline['political_precision_feature_ids'] = declared
    with pytest.raises(ValueError, match='unique existing string IDs'):
        repair._merge_precision_ids(baseline, [])


def test_narrow_regions_survive_shared_coarse_generation_with_or_without_precision(fixture):
    from tools.scenario_chunk_assets import _optimize_political_coarse_payload

    baseline, owners, _, _ = fixture
    ids = [fid for fid in owners if fid.startswith(repair.SK_PREFIX)]
    sources = [box(22.400001, 48.700001, 22.400021, 48.800001),
               box(22.400021, 48.700001, 22.400041, 48.800001),
               box(23, 48, 23.1, 48.1), box(24, 48, 24.1, 48.1)]
    assert all(g.is_valid for g in sources) and shapely.coverage_is_valid(sources)
    payload = dict(type='FeatureCollection', features=[
        dict(type='Feature', properties=dict(id=fid, cntr_code='SK'), geometry=mapping(g))
        for fid, g in zip(ids, sources)])
    ordinary = _optimize_political_coarse_payload(payload, owner_buckets_by_feature_id=owners)
    assert all(shape(f['geometry']).equals(g) for f, g in zip(ordinary['features'], sources))
    declared = repair._merge_precision_ids(baseline, ids)
    protected = _optimize_political_coarse_payload(
        payload, owner_buckets_by_feature_id=owners, political_precision_feature_ids=set(declared))
    coarse = [shape(f['geometry']) for f in protected['features']]
    assert all(g.is_valid for g in coarse) and shapely.coverage_is_valid(coarse)
    assert all(a.equals(b) for a, b in zip(sources, coarse))
    assert shapely.union_all(sources).equals(shapely.union_all(coarse))


def test_source_restoration_does_not_certify_release_readiness(fixture):
    baseline, owners, source, _ = fixture
    _, report = repair.build_candidate(baseline, owners, source)
    assert report['status'] == 'PASS_SOURCE_SUPPORTED_RESTORATION'
    assert report['source_supported_residual_area_km2'] == 0
    assert report['additions_coverage_valid'] is True
    assert report['release_ready'] is False
    assert 'full_boundary_mixed_lod_no_regression' in report['required_validation']
    assert 'rebuilt_runtime_geometry_and_metadata_valid' in report['required_validation']
