"""Same-ID restoration keeps competing claims, water and unrelated land intact."""
from copy import deepcopy
import hashlib
import io
import zipfile

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


@pytest.mark.parametrize('change', ['owner', 'country', 'missing_source', 'invalid_source', 'helper', 'bounds', 'area'])
def test_changed_identity_or_reviewed_geometry_rejected(example, change):
    baseline, owners, sources, specs, _ = example
    if change == 'owner':
        owners['BA'] = 'unexpected'
    elif change == 'country':
        baseline['objects']['political']['geometries'][0]['properties']['cntr_code'] = 'unexpected'
    elif change == 'missing_source':
        sources.pop('BA')
    elif change == 'invalid_source':
        sources['BA'] = shapely.Polygon([(19, 43), (19.1, 43.1), (19.1, 43), (19, 43.1)])
    elif change == 'helper':
        baseline['objects']['political']['geometries'][0]['properties']['interactive'] = False
    elif change == 'bounds':
        specs[0]['bounds'] = (19, 43, 19.11, 43.1)
    else:
        specs[0]['area_range_km2'] = (0, 1)
    with pytest.raises(ValueError):
        repair.build_candidate(baseline, owners, sources, shapely.GeometryCollection(), specs=specs)


@pytest.mark.parametrize('name', ['land_mask', 'scenario_water', 'scenario_atlantropa'])
def test_changed_surface_rejected(example, name):
    baseline, owners, sources, specs, hole = example
    add_object(baseline, name, box(19, 42, 21, 45) if name == 'land_mask' else hole)
    with pytest.raises(ValueError):
        repair.build_candidate(baseline, owners, sources, shapely.GeometryCollection(), specs=specs)


def test_all_source_claims_ambiguous_is_not_arbitrarily_assigned():
    gap = box(19, 43, 19.1, 43.1)
    assignments, ambiguous, unsupported = repair.partition_source_pieces(
        gap, {'A': gap, 'B': gap}, shapely.GeometryCollection())
    assert assignments == {}
    assert ambiguous.equals(gap) and unsupported.is_empty


def test_non_touching_replacements_batch_without_normalizing_existing_overlap():
    replacements = {'A': box(0, 0, 1, 1), 'B': box(.9, 0, 2, 1),
                    'C': box(2, 0, 3, 1), 'D': box(10, 0, 11, 1)}
    groups = repair.disjoint_replacement_groups(replacements)
    assert len(groups) == 2
    assert sorted(fid for group in groups for fid in group) == sorted(replacements)
    for group in groups:
        for index, fid in enumerate(group):
            assert all(not replacements[fid].intersects(replacements[other]) for other in group[index + 1:])
    assert repair.disjoint_replacement_groups(dict(reversed(list(replacements.items())))) == groups


@pytest.mark.parametrize('extent', [box(-1, -1, 1.5, 1.5), box(.25, .25, .75, .75),
                                   box(0, 0, 10, 10), box(-5, -5, -4, -4)])
def test_indexed_surface_matches_whole_overlay_for_holes_remote_and_nested_parts(extent):
    polygon = box(0, 0, 2, 2).difference(box(.5, .5, 1, 1))
    surface = shapely.GeometryCollection([shapely.MultiPolygon([polygon, box(10, 10, 11, 11)]),
                                          shapely.GeometryCollection()])
    actual = repair.intersect_indexed_surface(repair.index_surface_components(surface), extent)
    assert actual.equals(surface.intersection(extent))
    assert repair.intersect_indexed_surface(repair.index_surface_components(shapely.GeometryCollection()), extent).is_empty


def test_batched_encoding_matches_singleton_restoration(example, monkeypatch):
    baseline, owners, sources, specs, _ = example
    batched, batched_report = repair.build_candidate(baseline, owners, sources, shapely.GeometryCollection(), specs=specs)
    monkeypatch.setattr(repair, 'disjoint_replacement_groups', lambda values: [[fid] for fid in sorted(values)])
    singletons, singleton_report = repair.build_candidate(baseline, owners, sources, shapely.GeometryCollection(), specs=specs)
    a, b = _absolute_topology(batched), _absolute_topology(singletons)
    for before, after in zip(a['objects']['political']['geometries'], b['objects']['political']['geometries']):
        assert before['properties'] == after['properties']
        assert _decode_geometry(a, before).equals(_decode_geometry(b, after))
    assert batched_report['restored_area_km2'] == singleton_report['restored_area_km2']


def test_corrupt_source_identity_rejected_before_parsing(tmp_path):
    fake = tmp_path / 'fake.geojson'
    fake.write_text('{}', encoding='utf-8')
    with pytest.raises(ValueError, match='source bytes differ'):
        repair.read_sources(fake, fake, fake)


def test_archive_attributes_and_geometry_are_read_from_the_same_pinned_snapshot(tmp_path, monkeypatch):
    archive = tmp_path / 'reviewed.zip'
    with zipfile.ZipFile(archive, 'w') as handle:
        handle.writestr('example.shp', b'reviewed geometry')
        handle.writestr('example.dbf', b'reviewed identities')
        handle.writestr('example.prj', b'reviewed CRS')
    reviewed_bytes = archive.read_bytes()
    monkeypatch.setitem(repair.SOURCES, 'admin1', dict(sha256=hashlib.sha256(reviewed_bytes).hexdigest(), url='pinned'))

    def inspect_snapshot(snapshot):
        assert isinstance(snapshot, io.BytesIO)
        assert snapshot.getvalue() == reviewed_bytes
        # Later changes to the filesystem do not change the bytes GDAL reads.
        archive.write_bytes(b'changed after hash validation')
        assert snapshot.getvalue() == reviewed_bytes
        return 'read frame'

    monkeypatch.setattr(repair.gpd, 'read_file', inspect_snapshot)
    frame, metadata = repair.read_pinned_source('admin1', archive)
    assert frame == 'read frame'
    assert metadata['archive_members_sha256']['example.dbf'] == hashlib.sha256(b'reviewed identities').hexdigest()
    assert 'sidecars' in metadata['read_binding']


def test_archive_dbf_change_is_rejected_before_gdal_reads(tmp_path, monkeypatch):
    archive = tmp_path / 'reviewed.zip'
    with zipfile.ZipFile(archive, 'w') as handle:
        handle.writestr('example.shp', b'unchanged geometry')
        handle.writestr('example.dbf', b'reviewed identities')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    monkeypatch.setitem(repair.SOURCES, 'admin1', dict(sha256=digest, url='pinned'))
    with zipfile.ZipFile(archive, 'w') as handle:
        handle.writestr('example.shp', b'unchanged geometry')
        handle.writestr('example.dbf', b'changed identities')
    monkeypatch.setattr(repair.gpd, 'read_file', lambda _: pytest.fail('Unpinned source reached GDAL'))
    with pytest.raises(ValueError, match='source bytes differ'):
        repair.read_pinned_source('admin1', archive)


def test_real_rs211_union_remnant_does_not_drop_original_polygon_territory():
    # Reduced reviewed fixture: 34 original and 38 addition coordinates.
    original = shapely.from_wkt('POLYGON ((20.072000720007196 44.00512704527044, 20.180001800018005 43.67705359553595, 19.927999279992804 43.56248826388263, 19.927999279992804 43.54686571865717, 20.036000360003612 43.489583052830525, 20.14400144001442 43.326414247142466, 20.288002880028813 43.31773505535055, 20.2520025200252 43.24309400594005, 20.2520025200252 43.1858113401134, 20.180001800018005 43.13720786607867, 20.072000720007196 43.00701998919989, 19.963999639996416 43.09554774547745, 19.855998559985608 43.1129061290613, 19.63999639996402 43.1858113401134, 19.4959949599496 43.30037667176673, 19.423994239942402 43.392376104761055, 19.243992439924398 43.4722246692467, 19.243992439924398 43.56248826388263, 19.27999279992801 43.59546919269194, 19.459994599946015 43.586790000899995, 19.4959949599496 43.62845012150122, 19.4959949599496 43.72565706957069, 19.27999279992801 43.954787732877335, 19.4959949599496 43.96346692466925, 19.603996039960407 44.01207039870398, 19.567995679956795 44.06240971109712, 19.4959949599496 44.0953906399064, 19.63999639996402 44.1682958509585, 19.819998199981995 44.07803225632257, 19.855998559985608 44.12837156871568, 19.89199891998922 44.14399411394113, 19.963999639996416 44.11101318513185, 20.072000720007196 44.11101318513185, 20.072000720007196 44.00512704527044))')
    addition = shapely.from_wkt('MULTIPOLYGON (((19.68117378286709 43.17191311895292, 19.690047793396825 43.16891795626342, 19.685898484460477 43.168609173744734, 19.681277195888025 43.17165297816952, 19.68117378286709 43.17191311895292)), ((19.54523492084474 43.24784842907795, 19.54171963755341 43.26146807628067, 19.530525810064816 43.272904458326884, 19.569949469101132 43.24153960133635, 19.561704954960035 43.242468267041424, 19.54523492084474 43.24784842907795)), ((19.38645435787898 43.409028747642544, 19.422858031387772 43.39288012539882, 19.41114288328563 43.3933504129365, 19.392835988246112 43.40213755810441, 19.38645435787898 43.409028747642544)), ((19.35903231163136 43.41223084679897, 19.348939570163765 43.416978856842896, 19.337770363579093 43.43062490422478, 19.37960688803931 43.412066276361706, 19.35903231163136 43.41223084679897)), ((19.227072642305135 43.511683737820576, 19.224069000467924 43.52754099479241, 19.224329888118888 43.52616367927135, 19.227856026834218 43.525364724002884, 19.232765324260356 43.52462825389085, 19.243992439924398 43.52677044680185, 19.243992439924398 43.4722246692467, 19.31473725440202 43.440842361512686, 19.3090710551145 43.44054918545713, 19.289947252853604 43.44527685885071, 19.27667619613675 43.45368246861711, 19.253181547739437 43.46210711575899, 19.246441151537347 43.46908590457486, 19.222514476839347 43.48269307846667, 19.225651832351616 43.4866166083845, 19.222977453662093 43.50280480964939, 19.227072642305135 43.511683737820576)))')
    replacement, diagnostic = repair.polygonal_replacement(original, addition)
    assert original.difference(replacement).is_empty
    assert original.union(addition).symmetric_difference(replacement).area == 0
    assert diagnostic["discarded_non_polygonal_area_degrees2"] == 0
    assert repair.coverage_is_valid_exact([replacement])
