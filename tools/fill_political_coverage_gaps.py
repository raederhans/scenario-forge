"""Fill enclosed political coverage gaps without changing feature IDs.

After an upstream rebuild, rerun this tool after apply_political_feature_merges.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from copy import deepcopy
from itertools import combinations
import json
from pathlib import Path
from statistics import median
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pyproj import Geod
from shapely import STRtree, make_valid, set_precision
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, shape
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
            if len(coordinates) < 4 or Polygon(coordinates).area < AREA_TOLERANCE:
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


def effective_water(topology, lakes, scenario_id="", manifest=None, base_features=()):
    manifest = manifest or {}
    result = {}
    rows = list(topology["objects"].get("scenario_water", {}).get("geometries", []))
    rows.extend(row for row in topology["objects"].get("scenario_atlantropa", {}).get("geometries", [])
                if row.get("properties", {}).get("atl_render_layer") == "water")
    mode = str(manifest.get("water_regions_mode", "")).strip().lower()
    exclusive = mode == "exclusive" if mode else manifest.get("presentation_features", {}).get("atlantropa_relief") is True
    entries = [] if exclusive else [(row, shape(row["geometry"])) for row in base_features]
    entries.extend((row, _decode_geometry(topology, row)) for row in rows)
    excluded_ids = {str(value).strip() for value in manifest.get("excluded_water_region_ids", [])}
    excluded_groups = {str(value).strip().lower() for value in manifest.get("excluded_water_region_groups", [])}
    for row, geometry in entries:
        props = row.get("properties") or {}
        identifier = props.get("id") or row.get("id")
        if not identifier or (props.get("scenario_id") and props["scenario_id"] != scenario_id):
            continue
        if identifier == "congo_lake" and scenario_id != "tno_1962":
            continue
        if not props.get("scenario_id") and (
            str(identifier).strip() in excluded_ids
            or str(props.get("region_group", "")).strip().lower() in excluded_groups
        ):
            continue
        result[identifier] = geometry
    for feature in lakes["features"]:
        props = feature["properties"]
        if props["id"] != "congo_lake" and not props.get("scenario_id"):
            result[props["id"]] = shape(feature["geometry"])
    return [polygon for geometry in result.values() for polygon in polygons(geometry)]


def physical_land(topology, scenario):
    names = ("land_mask", "context_land_mask", "scenario_coastline") if scenario else ("land",)
    for name in names:
        if name in topology["objects"]:
            return list(polygons(polygonal(_decode_geometry(topology, topology["objects"][name]))))
    return []


def has_land_basis(hole, land, land_tree, water, water_tree):
    dry = uncovered(hole, water, water_tree)
    area = area_km2(dry)
    if not land or area <= 0:
        return False
    return area_km2(uncovered(dry, land, land_tree)) <= area * 0.01


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


def own_inner_rings(topology, rows, geometries, water, max_hole_km2, land):
    tree = STRtree(geometries)
    water_tree = STRtree(water)
    additions = defaultdict(list)
    rings = []
    skipped = []
    land_tree = STRtree(land)
    for i, row in enumerate(rows):
        parts = [row["arcs"]] if row["type"] == "Polygon" else row["arcs"]
        for part in parts:
            shell = ring_coordinates(topology, part[0])
            if len(shell) < 4 or Polygon(shell).area < AREA_TOLERANCE:
                continue
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
                if area >= 0.01 and not has_land_basis(missing, land, land_tree, water, water_tree):
                    skipped.append(missing)
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
    return additions, assigned, skipped


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
    tree = STRtree(parts)
    pending = set(range(len(parts)))
    merged = []
    while pending:
        group = {pending.pop()}
        frontier = list(group)
        while frontier:
            index = frontier.pop()
            adjacent = set(map(int, tree.query(parts[index], predicate="intersects"))) & pending
            pending.difference_update(adjacent)
            group.update(adjacent)
            frontier.extend(adjacent)
        merged.extend(polygons(unary_union([parts[i] for i in sorted(group)])))
    return polygonal(merged[0] if len(merged) == 1 else MultiPolygon(merged))


def merge_assigned_holes(geometry, holes, coverage, tree):
    aligned = [uncovered(polygonal(snap(hole, geometry, ADJACENCY_TOLERANCE)), coverage, tree) for hole in holes]
    return add_coverage(geometry, [*aligned, *holes])


def find_gaps(geometries, water, max_hole_km2, land):
    original = unary_union(geometries)
    parts = list(polygons(original))
    part_tree = STRtree(parts)
    feature_tree = STRtree(geometries)
    water_tree = STRtree(water)
    buffers = {}
    gaps = []
    unassigned = []
    skipped = []
    land_tree = STRtree(land)
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
            if not has_land_basis(hole, land, land_tree, water, water_tree):
                skipped.append(hole)
                continue
            target = assign_gap(hole, geometries, feature_tree, buffers)
            if target is None:
                unassigned.append({"area_km2": area, "bounds": list(hole.bounds)})
                continue
            gaps.append((target, hole, area))
    return original, gaps, unassigned, skipped


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


def arc_refs(value):
    if isinstance(value, int):
        yield value if value >= 0 else ~value
    else:
        for child in value:
            yield from arc_refs(child)


def shared_arc_lengths(topology):
    owners = defaultdict(set)
    for row in topology["objects"]["political"]["geometries"]:
        for ref in set(arc_refs(row["arcs"])):
            owners[ref].add(feature_id(row))
    lengths = defaultdict(float)
    for ref, identifiers in owners.items():
        if len(identifiers) < 2:
            continue
        arc = topology["arcs"][ref]
        length = GEOD.line_length(*zip(*arc)) if len(arc) >= 2 else 0.0
        for pair in combinations(sorted(identifiers), 2):
            lengths[pair] += length
    return dict(lengths)


def rewrite_shared_arcs(topology, encoded, changed):
    replacements = encoded["objects"]["political"]["geometries"]
    used_new = {ref for i in changed for ref in arc_refs(replacements[i]["arcs"])}
    changed_arcs = [encoded["arcs"][i] for i in sorted(used_new)]
    endpoints = {tuple(point) for arcs in (topology["arcs"], changed_arcs)
                 for arc in arcs for point in (arc[0], arc[-1])}
    new_vertices = {tuple(point) for arc in changed_arcs for point in arc}
    vertices = new_vertices | {tuple(point) for arc in topology["arcs"] for point in arc}
    points = [Point(point) for point in sorted(vertices)]
    new_points = [Point(point) for point in sorted(new_vertices)]
    arcs = []
    indices = {}

    def node(arcs_in, points, selected=None):
        point_tree = STRtree(points)
        result = []
        for index, arc in enumerate(arcs_in):
            coordinates = tuple(map(tuple, arc))
            if selected is not None and index not in selected:
                result.append(coordinates)
                continue
            existing = set(coordinates)
            extra = [points[int(i)] for i in point_tree.query(LineString(coordinates), predicate="intersects")
                     if tuple(points[int(i)].coords[0]) not in existing]
            if extra:
                noded = [coordinates[0]]
                for a, b in zip(coordinates, coordinates[1:]):
                    segment = LineString([a, b])
                    interior = sorted((point for point in extra if segment.distance(point) == 0
                                       and 0 < segment.project(point) < segment.length), key=segment.project)
                    noded.extend(tuple(point.coords[0]) for point in interior)
                    endpoints.update(tuple(point.coords[0]) for point in interior)
                    noded.append(b)
                coordinates = tuple(noded)
            result.append(coordinates)
        return result

    old_arcs = node(topology["arcs"], new_points)
    new_arcs = node(encoded["arcs"], points, used_new)

    def encode(arcs_in):
        mappings = []
        for coordinates in arcs_in:
            refs = []
            start = 0
            for end in range(1, len(coordinates)):
                if end != len(coordinates) - 1 and coordinates[end] not in endpoints:
                    continue
                segment = coordinates[start:end + 1]
                canonical = min(segment, segment[::-1])
                if canonical not in indices:
                    indices[canonical] = len(arcs)
                    arcs.append([list(point) for point in canonical])
                index = indices[canonical]
                refs.append(index if segment == canonical else ~index)
                start = end
            mappings.append(refs)
        return mappings

    old_map = encode(old_arcs)
    new_map = encode(new_arcs)

    def remap(value, mapping):
        if value and isinstance(value[0], int):
            return [ref for item in value for ref in (
                mapping[item] if item >= 0 else [~ref for ref in reversed(mapping[~item])]
            )]
        return [remap(item, mapping) for item in value]

    def rewrite(obj):
        if "arcs" in obj:
            obj["arcs"] = remap(obj["arcs"], old_map)
        for child in obj.get("geometries", []):
            rewrite(child)

    for obj in topology["objects"].values():
        rewrite(obj)
    rows = topology["objects"]["political"]["geometries"]
    replacements = encoded["objects"]["political"]["geometries"]
    for index in changed:
        rows[index]["type"] = replacements[index]["type"]
        rows[index]["arcs"] = remap(replacements[index]["arcs"], new_map)
    topology["arcs"] = arcs


def validate_shared_arcs(before, after, repaired_ids, hole_boundaries):
    exemptions = {"make_valid": [], "filled_hole_boundary": []}
    lost = []
    for pair, length in before.items():
        decrease = length - after.get(pair, 0.0)
        if decrease <= 1.0:
            continue
        sample = {"feature_ids": list(pair), "decrease_m": decrease}
        if any(identifier in repaired_ids for identifier in pair):
            exemptions["make_valid"].append(sample)
        else:
            allowance = sum(hole_boundaries.get(identifier, 0.0) for identifier in pair)
            if decrease <= allowance + 1.0:
                exemptions["filled_hole_boundary"].append({**sample, "hole_boundary_m": allowance})
            else:
                lost.append({**sample, "hole_boundary_m": allowance})
    return {"checked_pairs": len(before), "passed": not lost, "shared_arc_violations": lost,
            "exemptions": {kind: {"pair_count": len(samples), "samples_first_20": samples[:20]}
                           for kind, samples in exemptions.items()}}


def _fill_topology_pass(topology, water=(), *, max_hole_km2=100.0, owners=None, dry_run=False, scenario=False,
                  fallback_land=(), _excluded_targets=frozenset()):
    absolute = _absolute_topology(topology) if "transform" in topology else topology
    political = absolute["objects"]["political"]
    rows = political["geometries"]
    decoded = [decode_political(absolute, row) for row in rows]
    geometries = []
    repaired_ids = []
    degenerate_parts = {}
    for row, (geometry, skipped) in zip(rows, decoded):
        parts = [row["arcs"]] if row["type"] == "Polygon" else row["arcs"]
        discarded = sum(len(ring_coordinates(absolute, part[0])) < 4 or
                        Polygon(ring_coordinates(absolute, part[0])).area < AREA_TOLERANCE for part in parts)
        if discarded:
            degenerate_parts[feature_id(row)] = discarded
        short_ring = skipped and any(len(ring_coordinates(absolute, refs)) < 4 for part in parts for refs in part)
        original = geometry if not skipped or short_ring else _decode_geometry(absolute, row)
        if short_ring or not original.is_valid:
            repaired_ids.append(feature_id(row))
        geometries.append(polygonal(geometry))
    land = physical_land(absolute, scenario)
    if set(absolute["objects"]) == {"political"}:
        land = list(fallback_land)
    additions, own_rings, skipped_own = own_inner_rings(absolute, rows, geometries, water, max_hole_km2, land)
    additions = {i: holes for i, holes in additions.items() if feature_id(rows[i]) not in _excluded_targets}
    own_rings = [item for item in own_rings if feature_id(rows[item[0]]) not in _excluded_targets]
    own_updated = [add_coverage(geometry, additions[i]) if i in additions else geometry
                   for i, geometry in enumerate(geometries)]
    original, gaps, unassigned, skipped_cross = find_gaps(own_updated, water, max_hole_km2, land)
    gaps = [item for item in gaps if feature_id(rows[item[0]]) not in _excluded_targets]
    report = gap_report(rows, own_rings + gaps, owners or {})
    report["shared_arc_violations"] = []
    report["skipped_shared_arc_features"] = sorted(_excluded_targets)
    report["discarded_degenerate_parts"] = {
        "count": sum(degenerate_parts.values()), "feature_count": len(degenerate_parts),
        "feature_ids_first_20": list(degenerate_parts)[:20],
    }
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
    report["skipped_no_land_basis"] = len({hole.wkb for hole in skipped_own + skipped_cross})
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
    report["_own_gaps"] = own_rings
    report["_cross_gaps"] = gaps
    report["_changed"] = changed
    report["_geometries"] = geometries
    report["_shared_repaired"] = set(repaired_ids) | set(degenerate_parts)
    report["_hole_boundaries"] = {}
    if not (gaps or own_rings):
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
    shared_before = shared_arc_lengths(absolute)
    hole_boundaries = defaultdict(float)
    for target, hole, _ in own_rings + gaps:
        hole_boundaries[feature_id(rows[target])] += boundary_length(hole.boundary)
    for target in own_counts:
        row = rows[target]
        parts = [row["arcs"]] if row["type"] == "Polygon" else row["arcs"]
        for part in parts:
            for refs in part[1:]:
                coordinates = ring_coordinates(absolute, refs)
                if len(coordinates) >= 2 and (len(coordinates) < 4 or Polygon(coordinates).area < AREA_TOLERANCE):
                    hole_boundaries[feature_id(row)] += boundary_length(LineString(coordinates))
    report["_hole_boundaries"] = hole_boundaries
    trial = deepcopy(absolute)
    rewrite_shared_arcs(trial, encoded, changed)
    roundtrip = [polygonal(decode_political(trial, row)[0])
                 for row in trial["objects"]["political"]["geometries"]]
    for index in range(len(rows)):
        if area_outside(roundtrip[index], [updated[index]]) + area_outside(updated[index], [roundtrip[index]]) >= AREA_TOLERANCE:
            raise ValueError(f"{feature_id(rows[index])}: shared arc encoding changed filled geometry")
    neighbors = validate_coverage(rows, sources, roundtrip, changed, baseline_overlaps)
    shared_after = shared_arc_lengths(trial)
    validation = validate_shared_arcs(shared_before, shared_after, set(repaired_ids) | set(degenerate_parts), hole_boundaries)
    violations = validation["shared_arc_violations"]
    if violations:
        rejected = {identifier for item in violations for identifier in item["feature_ids"]}
        targets = {feature_id(rows[i]) for i in changed}
        rejected &= targets
        if not rejected:
            rejected = targets
        result = _fill_topology_pass(topology, water, max_hole_km2=max_hole_km2, owners=owners,
                               dry_run=dry_run, scenario=scenario, fallback_land=fallback_land,
                               _excluded_targets=_excluded_targets | rejected)
        result["shared_arc_violations"] = violations + result["shared_arc_violations"]
        return result
    report["shared_arc_validation"] = validation
    if dry_run:
        return report
    for row, replacement in zip(rows, trial["objects"]["political"]["geometries"]):
        row.update(replacement)
    for name, obj in trial["objects"].items():
        if name != "political":
            absolute["objects"][name] = obj
    absolute["arcs"] = trial["arcs"]
    if "computed_neighbors" in political:
        political["computed_neighbors"] = [sorted(adjacent) for adjacent in neighbors]
    _compact_arcs(absolute)
    if absolute is not topology:
        topology.clear()
        topology.update(absolute)
    return report


def fill_topology(topology, water=(), *, max_hole_km2=100.0, owners=None, dry_run=False, scenario=False,
                  fallback_land=(), _excluded_targets=frozenset()):
    working = deepcopy(topology)
    original = _absolute_topology(topology) if "transform" in topology else topology
    rows = original["objects"]["political"]["geometries"]
    own_gaps, cross_gaps, violations = [], [], []
    changed = set()
    boundaries = defaultdict(float)
    report = None
    while True:
        entry = _fill_topology_pass(working, water, max_hole_km2=max_hole_km2, owners=owners,
                                   scenario=scenario, fallback_land=fallback_land,
                                   _excluded_targets=_excluded_targets)
        if report is None:
            report = entry
        violations.extend(entry["shared_arc_violations"])
        _excluded_targets = _excluded_targets | set(entry["skipped_shared_arc_features"])
        if not entry["hole_count"]:
            break
        own_gaps.extend(entry["_own_gaps"])
        cross_gaps.extend(entry["_cross_gaps"])
        changed.update(entry["_changed"])
        for identifier, length in entry["_hole_boundaries"].items():
            boundaries[identifier] += length
    if changed:
        validation = validate_shared_arcs(shared_arc_lengths(original), shared_arc_lengths(working),
                                          report["_shared_repaired"], boundaries)
        if validation["shared_arc_violations"]:
            rejected = {identifier for item in validation["shared_arc_violations"] for identifier in item["feature_ids"]}
            targets = {feature_id(rows[i]) for i in changed}
            rejected = rejected & targets or targets
            result = fill_topology(topology, water, max_hole_km2=max_hole_km2, owners=owners,
                                   dry_run=dry_run, scenario=scenario, fallback_land=fallback_land,
                                   _excluded_targets=_excluded_targets | rejected)
            result["shared_arc_violations"] = violations + validation["shared_arc_violations"] + result["shared_arc_violations"]
            return result
        geometries = report["_geometries"]
        additions = defaultdict(list)
        for target, hole, _ in own_gaps + cross_gaps:
            additions[target].append(hole)
        sources = [[geometry, *additions[i]] for i, geometry in enumerate(geometries)]
        updated = [polygonal(decode_political(working, row)[0])
                   for row in working["objects"]["political"]["geometries"]]
        baseline = existing_overlaps(geometries, changed)
        validate_coverage(rows, sources, updated, changed, baseline)
        report["existing_overlap_pair_count"] = len(baseline)
        report["shared_arc_validation"] = validation
        report.update(gap_report(rows, own_gaps + cross_gaps, owners or {}))
        report["cross_feature_gaps"] = gap_report(rows, cross_gaps, owners or {})
        counts = defaultdict(int)
        for target, _, _ in own_gaps:
            counts[target] += 1
        report["own_inner_rings"] = {
            "feature_count": len(counts), "ring_count": len(own_gaps),
            "area_km2": sum(area for _, _, area in own_gaps),
            "features": [{"feature_id": feature_id(rows[i]), "ring_count": count} for i, count in counts.items()],
        }
        report["changed_feature_count"] = len(changed)
        if not dry_run:
            original_rows = topology["objects"]["political"]["geometries"]
            for row, replacement in zip(original_rows, working["objects"]["political"]["geometries"]):
                row.update(replacement)
            topology.clear()
            topology.update(working)
            topology["objects"]["political"]["geometries"] = original_rows
    report["shared_arc_violations"] = violations
    report["skipped_no_land_basis"] = entry["skipped_no_land_basis"]
    report["skipped_shared_arc_features"] = sorted(set(report["skipped_shared_arc_features"]) | set(entry["skipped_shared_arc_features"]))
    return {key: value for key, value in report.items() if not key.startswith("_")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", action="append", choices=SCENARIOS)
    parser.add_argument("--max-hole-km2", type=float, default=100.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    lakes = read_json_source(DATA / "global_lakes.geojson")
    base_features = read_json_source(DATA / "water_regions.geojson")["features"]
    primary = read_json_source(DATA / "europe_topology.json")
    primary = _absolute_topology(primary) if "transform" in primary else primary
    fallback_land = physical_land(primary, False)
    report = {"dry_run": args.dry_run, "max_hole_km2": args.max_hole_km2, "topologies": {}}
    targets = [(DATA / name, None) for name in BASE_TOPOLOGIES]
    targets.extend((DATA / "scenarios" / scenario / "runtime_topology.topo.json", scenario)
                   for scenario in dict.fromkeys(args.scenario or SCENARIOS))
    for path, scenario in targets:
        topology = read_json_source(path)
        absolute = _absolute_topology(topology) if "transform" in topology else topology
        manifest = read_json_source(path.parent / "manifest.json") if scenario else {}
        owners = read_json_source(path.parent / "owners.by_feature.json")["owners"] if scenario else {}
        water = effective_water(absolute, lakes, scenario or "", manifest, base_features)
        entry = fill_topology(topology, water, max_hole_km2=args.max_hole_km2,
                              owners=owners, dry_run=args.dry_run, scenario=bool(scenario), fallback_land=fallback_land)
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
                          "changed_feature_count": entry["changed_feature_count"],
                          "skipped_no_land_basis": entry["skipped_no_land_basis"],
                          "shared_arc_validation": entry["shared_arc_validation"]}), flush=True)
    output = ROOT / ".runtime/reports/generated/fill_political_coverage_gaps.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    if not output.exists() or output.read_text(encoding="utf-8") != rendered + "\n":
        output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
