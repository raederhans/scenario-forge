"""Fill enclosed political coverage gaps without changing feature IDs.

After an upstream rebuild, rerun this tool after apply_political_feature_merges.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
from statistics import median
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pyproj import Geod
from shapely import STRtree, make_valid, set_precision
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import snap, unary_union

from map_builder.json_source import read_json_source, write_runtime_topology_source
from map_builder.regional_geometry import (
    _absolute_topology, _compact_arcs, _decode_geometry, _encode_exact_coverage,
)
from tools.apply_political_feature_merges import BASE_TOPOLOGIES, SCENARIOS, feature_id, write_compact
from tools.check_scenario_contracts import write_json
from tools.materialize_polar_scenarios import refresh_scenario

DATA = ROOT / "data"
GEOD = Geod(ellps="WGS84")
ADJACENCY_TOLERANCE = 1e-7
AREA_TOLERANCE = 1e-12
VALIDATION_GRID = 1e-9


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        if not geometry.is_empty:
            yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygons(part)


def area_km2(geometry):
    def ring_area(ring):
        longitude, latitude = ring.xy
        return abs(GEOD.polygon_area_perimeter(longitude, latitude)[0])

    return sum(ring_area(p.exterior) - sum(ring_area(r) for r in p.interiors)
               for p in polygons(geometry)) / 1e6


def boundary_length(geometry):
    if geometry.geom_type in {"LineString", "LinearRing"}:
        return GEOD.geometry_length(geometry)
    return sum(boundary_length(part) for part in getattr(geometry, "geoms", ()))


def ring_coordinates(topology, refs):
    coordinates = []
    for ref in refs:
        arc = topology["arcs"][ref if ref >= 0 else ~ref]
        segment = arc if ref >= 0 else arc[::-1]
        coordinates.extend(segment if not coordinates else segment[1:])
    return coordinates


def polygonal(geometry):
    parts = list(polygons(make_valid(geometry)))
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def decode_political(topology, row):
    parts = [row["arcs"]] if row["type"] == "Polygon" else row["arcs"]
    cleaned = []
    skipped = 0
    for rings in parts:
        retained = []
        shell_valid = False
        for index, refs in enumerate(rings):
            coordinates = ring_coordinates(topology, refs)
            if len(coordinates) < 4 or Polygon(coordinates).area == 0 or (
                index > 0 and Polygon(coordinates).area < AREA_TOLERANCE
            ):
                skipped += 1
                continue
            if index == 0:
                shell_valid = True
            retained.append(refs)
        if shell_valid:
            cleaned.append(retained)
    geometry = _decode_geometry(topology, {"type": "MultiPolygon", "arcs": cleaned})
    if row["type"] == "Polygon" and cleaned:
        geometry = geometry.geoms[0]
    return geometry, skipped


def effective_water(topology, lakes, scenario_id="", manifest=None):
    manifest = manifest or {}
    result = {}
    rows = list(topology["objects"].get("scenario_water", {}).get("geometries", []))
    rows.extend(row for row in topology["objects"].get("scenario_atlantropa", {}).get("geometries", [])
                if row.get("properties", {}).get("atl_render_layer") == "water")
    for row in rows:
        props = row.get("properties") or {}
        identifier = props.get("id") or row.get("id")
        if not identifier or (props.get("scenario_id") and props["scenario_id"] != scenario_id):
            continue
        if identifier == "congo_lake" and scenario_id != "tno_1962":
            continue
        if not props.get("scenario_id") and (
            identifier in manifest.get("excluded_water_region_ids", [])
            or props.get("region_group") in manifest.get("excluded_water_region_groups", [])
        ):
            continue
        result[identifier] = _decode_geometry(topology, row)
    for feature in lakes["features"]:
        props = feature["properties"]
        if props["id"] != "congo_lake" and not props.get("scenario_id"):
            result[props["id"]] = shape(feature["geometry"])
    return [polygon for geometry in result.values() for polygon in polygons(geometry)]


def water_overlap(hole, water, water_tree):
    nearby = [water[int(j)] for j in water_tree.query(hole, predicate="intersects")]
    return area_km2(hole.intersection(unary_union(nearby))) if nearby else 0


def uncovered(hole, geometries, tree):
    remaining = hole
    for index in tree.query(hole):
        remaining = remaining.difference(geometries[int(index)])
        if remaining.is_empty:
            break
    return polygonal(remaining)


def own_inner_rings(topology, rows, geometries, water, max_hole_km2):
    tree = STRtree(geometries)
    water_tree = STRtree(water)
    additions = defaultdict(list)
    rings = []
    for i, row in enumerate(rows):
        parts = [row["arcs"]] if row["type"] == "Polygon" else row["arcs"]
        for part in parts:
            for refs in part[1:]:
                coordinates = ring_coordinates(topology, refs)
                degenerate = len(coordinates) < 4 or Polygon(coordinates).area < AREA_TOLERANCE
                hole = MultiPolygon([]) if degenerate else polygonal(Polygon(coordinates))
                area = area_km2(hole)
                if area > max_hole_km2 or water_overlap(hole, water, water_tree) > area * 0.01:
                    continue
                missing = uncovered(hole, geometries, tree)
                if not degenerate and missing.area < AREA_TOLERANCE:
                    continue
                rings.append((i, missing, area_km2(missing)))
    ring_tree = STRtree([hole for _, hole, _ in rings])
    assigned = []
    for index, (target, hole, area) in enumerate(rings):
        earlier = [rings[int(j)][1] for j in ring_tree.query(hole, predicate="intersects") if j < index]
        remaining = hole
        for previous in earlier:
            remaining = remaining.difference(previous)
        if not hole.is_empty and remaining.is_empty:
            continue
        additions[target].append(remaining)
        assigned.append((target, remaining, area_km2(remaining)))
    return additions, assigned


def assign_gap(hole, geometries, tree, buffers):
    adjacent = sorted(int(j) for j in tree.query(hole, predicate="dwithin", distance=ADJACENCY_TOLERANCE))
    lengths = {}
    for j in adjacent:
        if j not in buffers:
            buffers[j] = geometries[j].buffer(ADJACENCY_TOLERANCE)
        lengths[j] = boundary_length(hole.boundary.intersection(buffers[j]))
    return max(lengths, key=lengths.get) if lengths and max(lengths.values()) > 0 else None


def add_coverage(geometry, additions):
    parts = list(polygons(geometry))
    for addition in additions:
        for patch in polygons(addition):
            if patch.area < AREA_TOLERANCE:
                continue
            nearby = set(int(i) for i in STRtree(parts).query(
                patch, predicate="dwithin", distance=ADJACENCY_TOLERANCE
            ))
            combined = unary_union([patch, *(parts[i] for i in sorted(nearby))])
            parts = [part for i, part in enumerate(parts) if i not in nearby] + list(polygons(polygonal(combined)))
    return polygonal(parts[0] if len(parts) == 1 else MultiPolygon(parts))


def merge_assigned_holes(geometry, holes, coverage, tree):
    aligned = [uncovered(polygonal(snap(hole, geometry, ADJACENCY_TOLERANCE)), coverage, tree) for hole in holes]
    return add_coverage(geometry, [*aligned, *holes])


def find_gaps(geometries, water, max_hole_km2):
    original = unary_union(geometries)
    parts = list(polygons(original))
    part_tree = STRtree(parts)
    feature_tree = STRtree(geometries)
    water_tree = STRtree(water)
    buffers = {}
    gaps = []
    unassigned = []
    for part_index, part in enumerate(parts):
        for ring in part.interiors:
            enclosure = Polygon(ring)
            islands = [Polygon(parts[int(j)].exterior)
                       for j in part_tree.query(enclosure, predicate="intersects") if j != part_index]
            hole = enclosure.difference(unary_union(islands)) if islands else enclosure
            hole = uncovered(hole, geometries, feature_tree)
            if hole.area < AREA_TOLERANCE:
                continue
            area = area_km2(hole)
            if area <= 0 or area > max_hole_km2:
                continue
            if water_overlap(hole, water, water_tree) > area * 0.01:
                continue
            target = assign_gap(hole, geometries, feature_tree, buffers)
            if target is None:
                unassigned.append({"area_km2": area, "bounds": list(hole.bounds)})
                continue
            gaps.append((target, hole, area))
    return original, gaps, unassigned


def gap_report(rows, gaps, owners):
    areas = sorted(area for _, _, area in gaps)
    by_owner = defaultdict(lambda: {"hole_count": 0, "area_km2": 0.0})
    for target, _, area in gaps:
        row = rows[target]
        owner = owners.get(feature_id(row), row.get("properties", {}).get("cntr_code", ""))
        by_owner[owner]["hole_count"] += 1
        by_owner[owner]["area_km2"] += area
    return {
        "hole_count": len(gaps),
        "area_km2": {"total": sum(areas), "min": min(areas) if areas else 0,
                     "median": median(areas) if areas else 0, "max": max(areas) if areas else 0},
        "owners_top_10": [{"owner": owner, **values} for owner, values in sorted(
            by_owner.items(), key=lambda item: (-item[1]["hole_count"], item[0])
        )[:10]],
    }


def existing_overlaps(geometries, changed):
    tree = STRtree(geometries)
    overlaps = {}
    seen = set()
    for i in sorted(changed):
        for other in tree.query(geometries[i], predicate="intersects"):
            j = int(other)
            pair = tuple(sorted((i, j)))
            if i == j or pair in seen:
                continue
            seen.add(pair)
            area = geometries[i].intersection(geometries[j]).area
            if area > 0:
                overlaps[pair] = area
    return overlaps


def area_outside(geometry, containers):
    container_parts = [part for container in containers for part in polygons(container)]
    tree = STRtree(container_parts)
    difference = sum(uncovered(part, container_parts, tree).area for part in polygons(geometry))
    if difference >= AREA_TOLERANCE:
        checked_parts = [set_precision(part, VALIDATION_GRID) for part in container_parts]
        checked_tree = STRtree(checked_parts)
        difference = sum(uncovered(set_precision(part, VALIDATION_GRID), checked_parts, checked_tree).area
                         for part in polygons(geometry))
    return difference


def validate_coverage(rows, sources, updated, changed, baseline_overlaps):
    for i, geometry in enumerate(updated):
        if not geometry.is_valid:
            raise ValueError(f"{feature_id(rows[i])}: filled geometry is invalid")
    differences = [(feature_id(rows[i]), area_outside(updated[i], sources[i])
                    + sum(area_outside(source, [updated[i]]) for source in sources[i]))
                   for i in sorted(changed)]
    difference = sum(area for _, area in differences)
    if difference >= AREA_TOLERANCE:
        raise ValueError(f"Filled coverage differs from original coverage and gaps: {difference} square degrees; "
                         f"largest differences: {sorted(differences, key=lambda item: -item[1])[:5]}")
    tree = STRtree(updated)
    neighbors = [[] for _ in updated]
    for i, geometry in enumerate(updated):
        for other in tree.query(geometry, predicate="intersects"):
            j = int(other)
            if j <= i:
                continue
            if i in changed or j in changed:
                overlap = geometry.intersection(updated[j]).area
                before = baseline_overlaps.get((i, j), 0.0)
                if overlap > before + AREA_TOLERANCE:
                    raise ValueError(f"Political overlap increased: {feature_id(rows[i])}, {feature_id(rows[j])}: "
                                     f"{before} -> {overlap} square degrees")
            neighbors[i].append(j)
            neighbors[j].append(i)
    return neighbors


def fill_topology(topology, water=(), *, max_hole_km2=100.0, owners=None, dry_run=False):
    absolute = _absolute_topology(topology) if "transform" in topology else topology
    political = absolute["objects"]["political"]
    rows = political["geometries"]
    decoded = [decode_political(absolute, row) for row in rows]
    geometries = []
    repaired_ids = []
    for row, (geometry, _) in zip(rows, decoded):
        if not geometry.is_valid:
            repaired_ids.append(feature_id(row))
        geometries.append(polygonal(geometry))
    additions, own_rings = own_inner_rings(absolute, rows, geometries, water, max_hole_km2)
    own_updated = [add_coverage(geometry, additions[i]) if i in additions else geometry
                   for i, geometry in enumerate(geometries)]
    original, gaps, unassigned = find_gaps(own_updated, water, max_hole_km2)
    report = gap_report(rows, own_rings + gaps, owners or {})
    own_counts = defaultdict(int)
    for target, _, _ in own_rings:
        own_counts[target] += 1
    report["own_inner_rings"] = {
        "feature_count": len(own_counts), "ring_count": len(own_rings),
        "area_km2": sum(area for _, _, area in own_rings),
        "features": [{"feature_id": feature_id(rows[i]), "ring_count": count} for i, count in own_counts.items()],
    }
    report["cross_feature_gaps"] = gap_report(rows, gaps, owners or {})
    report["unassigned"] = unassigned
    report["skipped_degenerate_rings"] = {
        "count": sum(count for _, count in decoded),
        "features": [{"feature_id": feature_id(row), "count": count}
                     for row, (_, count) in zip(rows, decoded) if count],
    }
    report["make_valid_repairs"] = {"feature_count": len(repaired_ids), "feature_ids_first_20": repaired_ids[:20]}
    changed = set(additions) | {target for target, _, _ in gaps}
    report["changed_feature_count"] = len(changed)
    baseline_overlaps = existing_overlaps(geometries, changed)
    report["existing_overlap_pair_count"] = len(baseline_overlaps)
    if dry_run or not (gaps or own_rings):
        return report

    cross_additions = defaultdict(list)
    for target, hole, _ in gaps:
        cross_additions[target].append(hole)
    updated = list(own_updated)
    coverage_tree = STRtree(own_updated)
    for target, holes in cross_additions.items():
        updated[target] = merge_assigned_holes(own_updated[target], holes, own_updated, coverage_tree)
    for target in changed:
        parts = [Polygon(part.exterior, [ring for ring in part.interiors if Polygon(ring).area >= AREA_TOLERANCE])
                 for part in polygons(updated[target])]
        updated[target] = polygonal(parts[0] if len(parts) == 1 else MultiPolygon(parts))
    sources = [[geometry, *additions.get(i, []), *cross_additions.get(i, [])] for i, geometry in enumerate(geometries)]
    neighbors = validate_coverage(rows, sources, updated, changed, baseline_overlaps)

    encoded = _encode_exact_coverage([feature_id(row) for row in rows], updated)
    encoded_rows = encoded["objects"]["political"]["geometries"]
    for row, geometry in zip(encoded_rows, updated):
        if _decode_geometry(encoded, row).symmetric_difference(geometry).area >= AREA_TOLERANCE:
            raise ValueError(f"{feature_id(row)}: encoding changed filled geometry")
    preserved = set(range(len(rows))) - additions.keys() - cross_additions.keys()
    existing_arcs = {}
    endpoints = set()
    for i in preserved:
        parts = [rows[i]["arcs"]] if rows[i]["type"] == "Polygon" else rows[i]["arcs"]
        for rings in parts:
            for refs in rings:
                for ref in refs:
                    index = ref if ref >= 0 else ~ref
                    coordinates = tuple(map(tuple, absolute["arcs"][index]))
                    existing_arcs[coordinates] = index
                    existing_arcs[coordinates[::-1]] = ~index
                    endpoints.update((coordinates[0], coordinates[-1]))
    arc_map = []
    for arc in encoded["arcs"]:
        coordinates = tuple(map(tuple, arc))
        refs = []
        start = 0
        for end in range(1, len(coordinates)):
            if end != len(coordinates) - 1 and coordinates[end] not in endpoints:
                continue
            segment = coordinates[start:end + 1]
            if segment in existing_arcs:
                refs.append(existing_arcs[segment])
            else:
                refs.append(len(absolute["arcs"]))
                absolute["arcs"].append([list(point) for point in segment])
            start = end
        arc_map.append(refs)

    def remap(value):
        if value and isinstance(value[0], int):
            return [ref for item in value for ref in (
                arc_map[item] if item >= 0 else [~ref for ref in reversed(arc_map[~item])]
            )]
        return [remap(item) for item in value]

    for i, (row, replacement) in enumerate(zip(rows, encoded_rows)):
        if i in preserved:
            continue
        row["type"] = replacement["type"]
        row["arcs"] = remap(replacement["arcs"])
    if "computed_neighbors" in political:
        political["computed_neighbors"] = [sorted(adjacent) for adjacent in neighbors]
    _compact_arcs(absolute)
    if absolute is not topology:
        topology.clear()
        topology.update(absolute)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", action="append", choices=SCENARIOS)
    parser.add_argument("--max-hole-km2", type=float, default=100.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    lakes = read_json_source(DATA / "global_lakes.geojson")
    report = {"dry_run": args.dry_run, "max_hole_km2": args.max_hole_km2, "topologies": {}}
    targets = [(DATA / name, None) for name in BASE_TOPOLOGIES]
    targets.extend((DATA / "scenarios" / scenario / "runtime_topology.topo.json", scenario)
                   for scenario in dict.fromkeys(args.scenario or SCENARIOS))
    for path, scenario in targets:
        topology = read_json_source(path)
        absolute = _absolute_topology(topology) if "transform" in topology else topology
        manifest = read_json_source(path.parent / "manifest.json") if scenario else {}
        owners = read_json_source(path.parent / "owners.by_feature.json")["owners"] if scenario else {}
        water = effective_water(absolute, lakes, scenario or "", manifest)
        entry = fill_topology(topology, water, max_hole_km2=args.max_hole_km2,
                              owners=owners, dry_run=args.dry_run)
        report["topologies"][path.relative_to(ROOT).as_posix()] = entry
        if args.dry_run or not entry["hole_count"]:
            continue
        if scenario:
            written = write_runtime_topology_source(path.parent, topology)
            url = written.relative_to(ROOT).as_posix()
            if manifest.get("runtime_topology_url") != url:
                manifest["runtime_topology_url"] = url
                write_json(path.parent / "manifest.json", manifest)
            refresh_scenario(path.parent, {}, [])
        else:
            write_compact(path, topology)
        print(json.dumps({"written_topology": path.relative_to(ROOT).as_posix(),
                          "hole_count": entry["hole_count"],
                          "changed_feature_count": entry["changed_feature_count"]}), flush=True)
    output = ROOT / ".runtime/reports/generated/fill_political_coverage_gaps.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    if not output.exists() or output.read_text(encoding="utf-8") != rendered + "\n":
        output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
