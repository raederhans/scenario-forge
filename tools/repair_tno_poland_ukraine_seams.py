"""Build a staged same-ID repair for five reviewed PL/UA land corridors."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import geopandas as gpd
import shapely
from shapely.geometry import Point, box

from map_builder.geo.reviewed_seam import partition_reviewed_seam
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry

EXTENT = (21.5, 48.5, 26.0, 52.5)
# Explicit reviewed components, not a global hole-filling policy. Upper bounds
# catch changed sources that join these corridors to additional missing land.
CORRIDORS = (
    ("volhynia", (23.9869395246, 51.0435013106), (23.62, 50.43, 24.19, 51.64), 800),
    ("lviv", (23.1915637123, 49.9499949612), (22.64, 49.49, 23.78, 50.40), 480),
    ("southern_tripoint", (22.5874810324, 49.0266356142), (22.45, 48.95, 22.81, 49.10), 100),
    ("southern_border", (22.7512525860, 49.2332960949), (22.70, 49.15, 22.79, 49.30), 40),
    ("southern_sliver", (22.7595643743, 49.3417011452), (22.74, 49.33, 22.79, 49.36), 3),
)


def area_km2(geometry):
    return float(gpd.GeoSeries([geometry], crs=4326).to_crs(3035).area.iloc[0] / 1e6)


def build_candidate(baseline, owners):
    absolute = _absolute_topology(baseline)
    extent = box(*EXTENT)
    rows, geometries = {}, {}
    for row in absolute['objects']['political']['geometries']:
        fid = row['properties']['id']
        geometry = _decode_geometry(absolute, row)
        rows[fid] = row
        if geometry.intersects(extent):
            geometries[fid] = geometry
    occupied = shapely.union_all(list(geometries.values()))
    gaps = list(shapely.get_parts(extent.difference(occupied)))
    # Clip first: world-sized special/water overlays are unnecessary here.
    land = _decode_geometry(absolute, absolute['objects']['land_mask']).intersection(extent)
    exclusions = [_decode_geometry(absolute, absolute['objects'][name]).intersection(extent)
                  for name in ('scenario_water', 'scenario_atlantropa')]
    allowed = land.difference(shapely.union_all(exclusions))
    additions, reports, reviewed = {}, [], []
    for name, seed, bounds, max_area in CORRIDORS:
        matches = [gap for gap in gaps if gap.covers(Point(seed))]
        if len(matches) != 1:
            raise ValueError(f'{name}: reviewed gap missing or ambiguous; inspect the new baseline')
        gap = matches[0]
        if not box(*bounds).covers(gap) or area_km2(gap) > max_area:
            raise ValueError(f'{name}: gap exceeds reviewed extent or area')
        if gap.intersects(extent.boundary):
            raise ValueError(f'{name}: gap is not enclosed')
        contacts = {fid: g for fid, g in geometries.items()
                    if gap.boundary.intersection(g.boundary).length > 1e-12}
        countries = {rows[fid]['properties']['cntr_code'] for fid in contacts}
        if not {'PL', 'UA'}.issubset(countries) or countries - {'PL', 'UA', 'BY', 'SK'}:
            raise ValueError(f'{name}: unexpected bordering source countries: {countries}')
        receivers = {fid: g for fid, g in contacts.items() if rows[fid]['properties']['cntr_code'] == 'UA'}
        fixed = shapely.union_all([g.boundary for fid, g in contacts.items() if fid not in receivers])
        parts, diagnostic = partition_reviewed_seam(gap, receivers, fixed, allowed_surface=allowed)
        for fid, geometry in parts.items():
            additions.setdefault(fid, []).append(geometry)
        metric_gap = gpd.GeoSeries([gap], crs=4326).to_crs(3035).iloc[0]
        reports.append(dict(name=name, area_before_km2=area_km2(gap),
                            maximum_inscribed_diameter_m=2 * shapely.maximum_inscribed_circle(metric_gap, tolerance=5).length,
                            adjacent_countries=sorted(countries),
                            assignments=[dict(id=fid, owner=owners[fid], area_km2=area_km2(g))
                                         for fid, g in sorted(parts.items())], **diagnostic))
        reviewed.append(gap)
    replacements = []
    for fid, parts in sorted(additions.items()):
        old = geometries[fid]
        updated = shapely.union_all([old, *parts])
        if old.difference(updated).area > 1e-12:
            raise ValueError(f'Original territory lost: {fid}')
        replacements.append(dict(id=fid, geometry=updated))
    replacement = gpd.GeoDataFrame(replacements, crs=4326)
    candidate, encoding = replace_regional_geometry(baseline, replacement, source_countries=['UA'])
    after = dict(geometries)
    after.update(dict(zip(replacement.id, replacement.geometry)))
    new_union = shapely.union_all(list(after.values()))
    reviewed_union = shapely.union_all(reviewed)
    residual = reviewed_union.difference(new_union)
    if residual.area > 1e-12 or new_union.symmetric_difference(occupied.union(reviewed_union)).area > 1e-12:
        raise ValueError('Repair did not exactly cover the reviewed corridors')
    # Coverage validity permits holes. Explicitly reject remaining land gaps
    # with boundary support from BOTH source countries in this reviewed window.
    country_unions = {code: shapely.union_all([g for fid, g in after.items()
                       if rows[fid]['properties']['cntr_code'] == code]) for code in ('PL', 'UA')}
    for gap in shapely.get_parts(allowed.difference(new_union)):
        if gap.area > 1e-12 and all(gap.boundary.intersection(g.boundary).length > 1e-10
                                    for g in country_unions.values()):
            raise ValueError('Unassigned PL/UA land corridor remains in the reviewed window')
    # Existing cross-source overlaps are not changed by this additive repair.
    for fid in additions:
        added = after[fid].difference(geometries[fid])
        if added.intersection(occupied).area > 1e-12 or added.difference(allowed).area > 1e-12:
            raise ValueError(f'New overlap or protected-surface incursion: {fid}')
    for report, gap in zip(reports, reviewed):
        report['area_after_km2'] = area_km2(gap.difference(new_union))
    report = dict(status='PASS', rule='reviewed gap / unique receiver boundary support / fixed opposite vertices',
                  corridors=reports, encoding=encoding, changed_ids=sorted(additions),
                  filled_area_km2=area_km2(reviewed_union), residual_area_km2=area_km2(residual),
                  unrelated_geometry_exact=True, original_territory_retained=True,
                  added_coordinate_count=int(sum(shapely.get_num_coordinates(after[fid]) - shapely.get_num_coordinates(geometries[fid]) for fid in additions)))
    return candidate, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    baseline = json.loads((args.baseline_dir / 'runtime_topology.topo.json').read_text(encoding='utf-8'))
    owners = json.loads((args.baseline_dir / 'owners.by_feature.json').read_text(encoding='utf-8'))['owners']
    candidate, report = build_candidate(baseline, owners)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(candidate, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    report_payload = json.dumps(report, indent=2, allow_nan=False)
    args.output.write_text(payload, encoding='utf-8')
    args.output.with_suffix('.report.json').write_text(report_payload, encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('status', 'changed_ids', 'filled_area_km2', 'residual_area_km2', 'added_coordinate_count')}))


if __name__ == '__main__':
    main()
