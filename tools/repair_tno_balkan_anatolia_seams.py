"""Restore unambiguous same-ID source pieces in explicitly reviewed inland gaps.

Overlapping source claims stay unassigned. This restores neither whole modern
countries nor inferred historical borders; existing territory and owners stay
intact. Mixed-LOD validation remains a separate prerequisite for integration.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import Point, box

from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry
from map_builder.coverage_validation import coverage_is_valid_exact
from tools.audit_tno_east_europe_gaps import is_shell_helper
from tools.repair_tno_slovakia_ukraine_seams import (
    AREA_EPSILON, _merge_precision_ids, _output_paths, _overlap_diagnostic,
    _polygonal, area_km2,
)

SOURCES = {
    'bih': dict(sha256='39008bc48f8a8bad48f816a8d6a474d5a3fa8d8ae37d2431ac904deeb20f6f48',
                url='https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/90a1d52/releaseData/gbOpen/BIH/ADM1/geoBoundaries-BIH-ADM1.geojson'),
    'nuts': dict(sha256='64cb81a6ecd3780aa506bfdb50069a1d3534e98d088b0123dfa95de730884290',
                 url='https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2021_3035_LEVL_3.geojson'),
    'admin1': dict(sha256='efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05',
                   url='https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip'),
}
REVIEWED_GAPS = (
    dict(name='bih_mne_srb', seed=(19.04599045990461, 43.304716267662684),
         bounds=(18.923589235892365, 43.04868010980108, 19.716435520519674, 43.56328298505877),
         area_range_km2=(331.5, 331.8),
         contacts={'BA_ADM1_54001226B66267900922909': ('BA', 'CRO'),
                   'ME_ADM1_MNE-1510': ('ME', 'MNT'), 'ME_ADM1_MNE-1516': ('ME', 'MNT'),
                   'ME_ADM1_MNE-1520': ('ME', 'MNT'), 'RS211': ('RS', 'SER')}),
    dict(name='aleppo_kilis_hatay', seed=(36.997710529305465, 36.727624727747276),
         bounds=(36.66816668166683, 36.62087066870669, 37.781606387492516, 36.834378786787866),
         area_range_km2=(223.4, 223.7),
         contacts={'SYR-137': ('TUR', 'TUR'), 'TR631': ('TR', 'TUR'),
                   'TRC11': ('TR', 'TUR'), 'TRC13': ('TR', 'TUR')}),
    dict(name='raqqah_sanliurfa', seed=(38.607186071860724, 36.789246989469895),
         bounds=(38.3091830918309, 36.662530789307894, 39.224192241922424, 36.90279974874748),
         area_range_km2=(113.7, 114.0),
         contacts={'SYR-136': ('TUR', 'TUR'), 'SYR-137': ('TUR', 'TUR'), 'TRC21': ('TR', 'TUR')}),
    dict(name='hasaka_mardin', seed=(41.06072360525502, 37.09645360266738),
         bounds=(40.658806588065886, 37.0635094500945, 41.61113814527981, 37.129471307713075),
         area_range_km2=(81.1, 81.4),
         contacts={'SYR-141': ('TUR', 'TUR'), 'TRC31': ('TR', 'TUR')}),
)


def partition_source_pieces(gap, sources, protected_water):
    """Only land claimed by exactly one reviewed same-ID source is restorable."""
    pieces = {fid: _polygonal(source.intersection(gap).difference(protected_water))
              for fid, source in sources.items()}
    ambiguous = shapely.union_all([
        _polygonal(pieces[left].intersection(pieces[right]))
        for index, left in enumerate(pieces) for right in list(pieces)[index + 1:]
    ])
    exclusive = {fid: _polygonal(piece.difference(ambiguous)) for fid, piece in pieces.items()}
    exclusive = {fid: geom for fid, geom in exclusive.items() if geom.area > AREA_EPSILON}
    restored = shapely.union_all(list(exclusive.values()))
    return exclusive, ambiguous, gap.difference(shapely.union_all(list(pieces.values())))


def polygonal_replacement(original, addition):
    union = original.union(addition)
    replacement = _polygonal(union)
    # A valid source union can include a zero-area LineString from near-collinear
    # overlay arithmetic. Retain original territory within the existing overlay
    # roundoff budget and all union area; report non-polygonal remnants and the
    # measured original-territory residual rather than claiming bitwise identity.
    original_residual = original.difference(replacement)
    if (original_residual.area > AREA_EPSILON
            or union.difference(replacement).area != 0
            or not replacement.is_valid or not coverage_is_valid_exact([replacement])):
        raise ValueError('Source union cannot be represented as lossless valid polygonal coverage')
    remnants = union.difference(replacement)
    return replacement, dict(union_geometry_type=union.geom_type,
                             discarded_non_polygonal_length_degrees=remnants.length,
                             discarded_non_polygonal_area_degrees2=remnants.area,
                             original_territory_residual_area_degrees2=original_residual.area,
                             original_territory_retained_exact=original_residual.is_empty)


def disjoint_replacement_groups(replacements):
    """Batch non-touching targets without changing their individual boundaries.

    Intersecting targets remain in separate groups, preserving pre-existing
    overlaps instead of asking the shared topology encoder to normalize them.
    A spatial index avoids repeating a global encode for every restored ID.
    """
    ids = sorted(replacements)
    tree = shapely.STRtree([replacements[fid] for fid in ids])
    colors, groups = {}, []
    for index, fid in enumerate(ids):
        used = {colors[int(other)] for other in tree.query(replacements[fid], predicate='intersects')
                if int(other) in colors}
        color = next((i for i in range(len(groups)) if i not in used), len(groups))
        if color == len(groups):
            groups.append([])
        groups[color].append(fid)
        colors[index] = color
    for group in groups:
        if not coverage_is_valid_exact([replacements[fid] for fid in group]):
            raise ValueError('Independent replacement group is not valid coverage')
    return groups


def index_surface_components(geometry):
    """Index complete components; never simplify or modify their coordinates."""
    pending, parts = [geometry], []
    while pending:
        part = pending.pop()
        if part.is_empty:
            continue
        if part.geom_type == 'GeometryCollection' or part.geom_type.startswith('Multi'):
            pending.extend(reversed(list(shapely.get_parts(part))))
        else:
            parts.append(part)
    return parts, shapely.STRtree(parts)


def intersect_indexed_surface(index, extent):
    parts, tree = index
    # Exact intersection predicates exclude water surrounding an inland hole
    # without running the much costlier overlay against the global collection.
    # Clip full intersecting components exactly once.
    return shapely.union_all([parts[int(i)].intersection(extent)
                              for i in sorted(tree.query(extent, predicate='intersects'))])


def build_candidate(baseline, owners, sources, protected_water, *, specs=REVIEWED_GAPS, progress=None):
    """CLI pins source bytes; explicit frames/specs allow synthetic regressions."""
    if protected_water is None or not protected_water.is_valid:
        raise ValueError('Protected water must be valid, including an explicitly empty collection')
    _merge_precision_ids(baseline, [])
    absolute = _absolute_topology(baseline)
    rows, before = {}, {}
    for row in absolute['objects']['political']['geometries']:
        fid = row['properties']['id']
        if fid in rows:
            raise ValueError('Duplicate political ID')
        rows[fid] = row
        before[fid] = _decode_geometry(absolute, row)
    before_ids = list(before)
    before_tree = shapely.STRtree(list(before.values()))
    original_surfaces = {name: _decode_geometry(absolute, absolute['objects'][name])
                         for name in ('land_mask', 'scenario_water', 'scenario_atlantropa')}
    surface_indexes = {name: index_surface_components(geometry) for name, geometry in original_surfaces.items()}
    additions, corridors, reviewed = {}, [], []
    for spec_index, spec in enumerate(specs):
        west, south, east, north = spec['bounds']
        extent = box(west - .1, south - .1, east + .1, north + .1)
        local = {before_ids[int(index)]: before[before_ids[int(index)]]
                 for index in sorted(before_tree.query(extent, predicate='intersects'))}
        if any(not geom.is_valid or geom.is_empty for geom in local.values()):
            raise ValueError('Invalid local political input')
        occupied = shapely.union_all([geom.intersection(extent) for geom in local.values()])
        surfaces = {name: intersect_indexed_surface(index, extent) for name, index in surface_indexes.items()}
        if any(not geometry.is_valid for geometry in surfaces.values()):
            raise ValueError('Invalid surface input')
        allowed = surfaces['land_mask'].difference(shapely.union_all([
            surfaces['scenario_water'], surfaces['scenario_atlantropa']]))
        gaps = [gap for gap in shapely.get_parts(allowed.difference(occupied))
                if gap.covers(Point(spec['seed']))]
        if len(gaps) != 1:
            raise ValueError(f"{spec['name']}: reviewed gap missing or ambiguous")
        gap = gaps[0]
        gap_area = area_km2(gap) if gap.is_valid and gap.geom_type == 'Polygon' else None
        if (not gap.is_valid or gap.geom_type != 'Polygon' or gap.intersects(extent.boundary)
                or any(abs(a - b) > 1e-9 for a, b in zip(gap.bounds, spec['bounds']))
                or gap_area is None or not spec['area_range_km2'][0] <= gap_area <= spec['area_range_km2'][1]):
            diagnostic = dict(bounds=list(gap.bounds), reviewed_bounds=spec['bounds'],
                              area_km2=gap_area, reviewed_area_range_km2=spec['area_range_km2'],
                              valid=bool(gap.is_valid), geometry_type=gap.geom_type,
                              touches_frame=bool(gap.intersects(extent.boundary)))
            raise ValueError(f"{spec['name']}: reviewed geometry changed: {json.dumps(diagnostic)}")
        if gap.boundary.intersection(allowed.boundary).length > 1e-12:
            raise ValueError(f"{spec['name']}: surface boundary requires separate review")
        contacts = {fid for fid, geom in local.items()
                    if gap.boundary.intersection(geom.boundary).length > 1e-12}
        if contacts != set(spec['contacts']):
            raise ValueError(f"{spec['name']}: reviewed contact IDs changed")
        for fid, (country, owner) in spec['contacts'].items():
            props = rows[fid]['properties']
            if props.get('cntr_code') != country or owners.get(fid) != owner:
                raise ValueError(f'{fid}: reviewed metadata or owner changed')
            if (props.get('interactive') is False or props.get('scenario_helper_kind')
                    or is_shell_helper(fid, props)):
                raise ValueError(f'{fid}: helper contact cannot be restored')
            source = sources.get(fid)
            if source is None or source.is_empty or not source.is_valid or source.geom_type not in {'Polygon', 'MultiPolygon'}:
                raise ValueError(f'{fid}: missing or invalid same-ID polygonal source')
        exclusive, ambiguous, unsupported = partition_source_pieces(
            gap, {fid: sources[fid] for fid in contacts}, protected_water)
        restored = shapely.union_all(list(exclusive.values()))
        if restored.intersection(occupied).area > AREA_EPSILON or restored.difference(allowed).area > AREA_EPSILON:
            raise ValueError('New overlap or protected-surface incursion')
        for fid, geometry in exclusive.items():
            additions[fid] = shapely.union_all([additions.get(fid, shapely.GeometryCollection()), geometry])
        corridors.append(dict(name=spec['name'], contact_ids=sorted(contacts),
                              area_before_km2=gap_area, restored_area_km2=area_km2(restored),
                              residual_area_km2=area_km2(gap.difference(restored)),
                              ambiguous_source_area_km2=area_km2(ambiguous),
                              unsupported_or_water_area_km2=area_km2(unsupported),
                              lake_intersection_area_km2=area_km2(_polygonal(gap.intersection(protected_water))),
                              assignments=[dict(id=fid, owner=owners[fid], area_km2=area_km2(geom))
                                           for fid, geom in sorted(exclusive.items())]))
        reviewed.append(gap)
        if progress is not None and ((spec_index + 1) % 100 == 0 or spec_index + 1 == len(specs)):
            progress(dict(stage='reviewed_gaps', specs_done=spec_index + 1, specs_total=len(specs)))
    if not additions:
        raise ValueError('No unambiguous source-supported additions')
    replacements, union_diagnostics = {}, []
    for fid, addition in sorted(additions.items()):
        try:
            replacement, diagnostic = polygonal_replacement(before[fid], addition)
        except ValueError as exc:
            raise ValueError(f'{fid}: {exc}') from exc
        replacements[fid] = replacement
        union_diagnostics.append(dict(id=fid, **diagnostic))
    candidate, encoding = baseline, []
    groups = disjoint_replacement_groups(replacements)
    for group_index, group in enumerate(groups):
        if progress is not None:
            progress(dict(stage='encode_group', group=group_index + 1, groups=len(groups), feature_count=len(group)))
        candidate, diagnostic = replace_regional_geometry(
            candidate, gpd.GeoDataFrame([dict(id=fid, geometry=replacements[fid]) for fid in group], crs=4326),
            source_countries=sorted({rows[fid]['properties']['cntr_code'] for fid in group}))
        encoding.append(diagnostic)
    result = _absolute_topology(candidate)
    after = {}
    for row in result['objects']['political']['geometries']:
        fid = row['properties']['id']
        if row['properties'] != rows[fid]['properties']:
            raise ValueError(f'{fid}: political attributes changed')
        after[fid] = _decode_geometry(result, row)
        if fid not in additions and not after[fid].equals_exact(before[fid], 0):
            raise ValueError(f'{fid}: unrelated geometry changed')
        if fid in additions and after[fid].symmetric_difference(before[fid].union(additions[fid])).area > AREA_EPSILON:
            raise ValueError(f'{fid}: encoded candidate differs from intended addition')
    for name, obj in absolute['objects'].items():
        if name != 'political' and not _decode_geometry(absolute, obj).equals_exact(
                _decode_geometry(result, result['objects'][name]), 0):
            raise ValueError(f'{name}: auxiliary geometry changed')
    ids = list(before)
    before_tree, after_tree = shapely.STRtree(list(before.values())), shapely.STRtree([after[fid] for fid in ids])
    checked, overlaps = set(), []
    for fid in additions:
        indices = set(before_tree.query(before[fid], predicate='intersects')) | set(after_tree.query(after[fid], predicate='intersects'))
        for index in indices:
            other = ids[int(index)]
            pair = tuple(sorted((fid, other)))
            if fid == other or pair in checked:
                continue
            checked.add(pair)
            diagnostic = _overlap_diagnostic(pair, before[fid].intersection(before[other]),
                                             after[fid].intersection(after[other]))
            if diagnostic['old_area_degrees2'] or diagnostic['new_area_degrees2']:
                overlaps.append(diagnostic)
    candidate['political_precision_feature_ids'] = _merge_precision_ids(baseline, additions)
    return candidate, dict(status='PASS_UNAMBIGUOUS_SAME_ID_RESTORATION', release_ready=False,
                           required_validation=['rebuilt_runtime_geometry_and_metadata_valid', 'full_boundary_mixed_lod_no_regression'],
                           rule='same-ID gap intersection minus all competing source claims and protected water',
                           changed_ids=sorted(additions), corridors=corridors, encoding=encoding,
                           assembly_group_count=len(groups),
                           union_diagnostics=union_diagnostics,
                           restored_area_km2=area_km2(shapely.union_all(list(additions.values()))),
                           residual_area_km2=sum(row['residual_area_km2'] for row in corridors),
                           overlap_pairs_checked=len(checked), preexisting_overlap_pairs=overlaps,
                           original_territory_retained=True, unrelated_geometry_exact=True,
                           overlay_area_tolerance_degrees2=AREA_EPSILON,
                           properties_unchanged=True, owners_unchanged=True, auxiliary_geometry_exact=True,
                           area_method='epsg3035_densified_linear_lonlat_edges', measurement_max_segment_length_degrees=.001)


def read_pinned_source(key, path):
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SOURCES[key]['sha256']:
        raise ValueError(f'{key}: source bytes differ from explicitly reviewed SHA256')
    metadata = dict(path=str(path.resolve()), **SOURCES[key])
    if key == 'admin1':
        # All shapefile members are bound by the reviewed archive digest. Read
        # that same byte snapshot so GDAL cannot consult mutable loose sidecars.
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            metadata['archive_members_sha256'] = {
                name: hashlib.sha256(archive.read(name)).hexdigest()
                for name in archive.namelist()
                if Path(name).suffix in {'.shp', '.shx', '.dbf', '.prj', '.cpg'}
            }
        metadata['read_binding'] = 'entire reviewed ZIP byte snapshot including DBF, CRS and encoding sidecars'
    else:
        metadata['read_binding'] = 'reviewed single-file byte snapshot'
    return gpd.read_file(io.BytesIO(data)), metadata


def read_sources(bih_path, nuts_path, admin1_path):
    frames, metadata = {}, {}
    for key, path in [('bih', bih_path), ('nuts', nuts_path), ('admin1', admin1_path)]:
        frames[key], metadata[key] = read_pinned_source(key, path)
    bih, nuts, admin = frames['bih'], frames['nuts'], frames['admin1']
    if (bih.crs is None or bih.crs.to_epsg() != 4326 or not bih.shapeGroup.eq('BIH').all()
            or not bih.shapeType.eq('ADM1').all() or not bih.shapeID.is_unique):
        raise ValueError('Expected BIH ADM1 same-ID source with explicit WGS84 CRS')
    if nuts.crs is None or nuts.crs.to_epsg() != 3035 or not nuts.LEVL_CODE.eq(3).all() or not nuts.NUTS_ID.is_unique:
        raise ValueError('Expected GISCO 2021 level-3 source in EPSG3035')
    if admin.crs is None or admin.crs.to_epsg() != 4326 or not admin.adm1_code.is_unique:
        raise ValueError('Expected Natural Earth ADM1 stable IDs and explicit WGS84 CRS')
    nuts = nuts.to_crs(4326)
    mne, syr = admin.loc[admin.adm0_a3.eq('MNE')], admin.loc[admin.adm0_a3.eq('SYR')]
    sources = {**dict(zip('BA_ADM1_' + bih.shapeID, bih.geometry)),
               **dict(zip('ME_ADM1_' + mne.adm1_code, mne.geometry)),
               **dict(zip(syr.adm1_code, syr.geometry)),
               **dict(zip(nuts.NUTS_ID, nuts.geometry))}
    return sources, metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-topology', type=Path, required=True)
    parser.add_argument('--owners', type=Path, required=True)
    parser.add_argument('--bih-source', type=Path, required=True)
    parser.add_argument('--nuts-source', type=Path, required=True)
    parser.add_argument('--admin1-source', type=Path, required=True)
    parser.add_argument('--lakes-source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output, report_path = _output_paths(args.output)
    sources, metadata = read_sources(args.bih_source, args.nuts_source, args.admin1_source)
    lakes = gpd.read_file(args.lakes_source)
    if (lakes.crs is None or lakes.crs.to_epsg() != 4326 or not lakes.geometry.is_valid.all()
            or lakes.geometry.isna().any() or lakes.geometry.is_empty.any()
            or not lakes.geometry.geom_type.isin(['Polygon', 'MultiPolygon']).all()):
        raise ValueError('Protected lake source must be valid with explicit WGS84 CRS')
    protected = shapely.union_all(lakes.geometry)
    baseline = json.loads(args.baseline_topology.read_text(encoding='utf-8'))
    owners = json.loads(args.owners.read_text(encoding='utf-8'))['owners']
    candidate, report = build_candidate(baseline, owners, sources, protected)
    report['sources'] = metadata
    report['protected_lakes_source'] = dict(path=str(args.lakes_source.resolve()),
        sha256=hashlib.sha256(args.lakes_source.read_bytes()).hexdigest())
    candidate_payload = json.dumps(candidate, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    report_payload = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as handle:
        handle.write(candidate_payload)
    with report_path.open('x', encoding='utf-8') as handle:
        handle.write(report_payload)
    print(json.dumps(dict(candidate=str(output), report=str(report_path), changed_ids=report['changed_ids'],
                          restored_area_km2=report['restored_area_km2'], residual_area_km2=report['residual_area_km2'])))


if __name__ == '__main__':
    main()
