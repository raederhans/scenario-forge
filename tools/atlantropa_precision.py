"""Bound post-fit simplification without claiming additional donor resolution."""

from copy import deepcopy
from math import hypot

import shapely
from shapely.geometry import MultiPoint, Polygon, box, mapping, shape
from shapely.ops import snap
from shapely.strtree import STRtree


MAX_POSTPROCESS_DEGREES = 0.0025


def smooth_atlantropa_land(features, *, fixed_geometry, max_shift=0.05, protected=(), forbidden=None):
    def key(coordinate):
        return tuple(round(value, 9) for value in coordinate)

    order = sorted(range(len(features)), key=lambda i: features[i]["properties"]["id"])
    features = _conform_shared_edges(features)
    graph, original, feature_keys = {}, {}, {}
    causeway_keys = set()
    for index in order:
        geometry = features[index]["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        keys = set()
        for polygon in polygons:
            for ring in polygon:
                for coordinate in ring:
                    vertex = key(coordinate)
                    keys.add(vertex)
                    original[vertex] = min(original.get(vertex, tuple(coordinate)), tuple(coordinate))
                    graph.setdefault(vertex, set())
                for start, end in zip(ring, ring[1:]):
                    a, b = key(start), key(end)
                    if a != b:
                        graph[a].add(b)
                        graph[b].add(a)
        feature_keys[index] = keys
        if features[index]["properties"].get("atl_geometry_role") == "causeway":
            causeway_keys.update(keys)
    # Only the reference near the land matters; clipping keeps the checks local.
    minx, miny, maxx, maxy = shapely.total_bounds([shape(feature["geometry"]) for feature in features])
    fixed_geometry = fixed_geometry.intersection(box(minx - 1, miny - 1, maxx + 1, maxy + 1))
    boundary = fixed_geometry.boundary
    shapely.prepare(boundary)
    candidates = [vertex for vertex in sorted(graph)
                  if len(graph[vertex]) == 2 and vertex not in causeway_keys]
    near = (shapely.dwithin(boundary, shapely.points([original[vertex] for vertex in candidates]), 1e-7)
            if candidates else [])
    movable = {vertex for vertex, touches in zip(candidates, near) if not touches}
    pending = set(movable)
    skipped = 0
    for root in sorted(movable):
        if root not in pending:
            continue
        pending.remove(root)
        component, stack = {root}, [root]
        while stack:
            for neighbor in sorted(graph[stack.pop()]):
                if neighbor in pending:
                    pending.remove(neighbor)
                    component.add(neighbor)
                    stack.append(neighbor)
        if len(component) < 6:
            movable.difference_update(component)
            skipped += 1
    positions = original.copy()
    for coefficient in [0.5, *([0.33, -0.34] * 4)]:
        updated = positions.copy()
        for vertex in sorted(movable):
            a, b = sorted(graph[vertex])
            candidate = tuple(positions[vertex][axis] + coefficient * (
                (positions[a][axis] + positions[b][axis]) / 2 - positions[vertex][axis])
                for axis in range(2))
            dx, dy = (candidate[axis] - original[vertex][axis] for axis in range(2))
            distance = hypot(dx, dy)
            if distance > max_shift:
                candidate = (original[vertex][0] + dx * max_shift / distance,
                             original[vertex][1] + dy * max_shift / distance)
            updated[vertex] = candidate
        positions = updated

    def rebuild(index):
        geometry = deepcopy(features[index]["geometry"])
        def transform(coordinates, depth):
            if depth == 0:
                vertex = key(coordinates)
                return positions[vertex] if positions[vertex] != original[vertex] else coordinates
            values = [transform(value, depth - 1) for value in coordinates]
            return tuple(values) if isinstance(coordinates, tuple) else values
        geometry["coordinates"] = transform(geometry["coordinates"], 2 if geometry["type"] == "Polygon" else 3)
        return geometry

    original_shapes = {i: shape(features[i]["geometry"]) for i in order}
    # Land may retreat from forbidden areas (named water) but never grow into them.
    if forbidden is not None:
        forbidden = forbidden.intersection(box(minx - 1, miny - 1, maxx + 1, maxy + 1))
    reverted, locally_reverted = set(), set()
    while True:
        geometries = {i: rebuild(i) for i in order}
        shapes = {i: shape(geometries[i]) for i in order}
        # Each failing feature records where it fails; None means everywhere.
        problems = {i: [None] for i in order if shapes[i].is_empty or not shapes[i].is_valid}
        valid = [i for i in order if i not in problems]
        tree = STRtree([shapes[i] for i in valid])
        for i in valid:
            # Only area the smoothing added counts; overlap the source already had is kept.
            added = shapes[i].difference(original_shapes[i])
            gained = added.intersection(fixed_geometry)
            if gained.area > 1e-9:
                problems.setdefault(i, []).append(gained)
            if forbidden is not None:
                entered = added.intersection(forbidden)
                if entered.area > 0:
                    problems.setdefault(i, []).append(entered)
            for match in sorted(tree.query(shapes[i])):
                j = valid[match]
                overlap = shapes[i].intersection(shapes[j]) if i < j else None
                if overlap is not None and overlap.area > 1e-9:
                    problems.setdefault(i, []).append(overlap)
                    problems.setdefault(j, []).append(overlap)
        # Protected areas (open sea between the unsmoothed land) keep at least half their area.
        for area in protected:
            touching = [valid[match] for match in sorted(tree.query(area))]
            covered = shapely.union_all([shapes[i] for i in touching]).intersection(area).area if touching else 0.0
            if area.area - covered < 0.5 * area.area:
                for i in touching:
                    problems.setdefault(i, []).append(area)
        if not problems:
            break
        # Undo only the moves near each problem; a feature without such moves reverts whole.
        for i in sorted(problems, key=lambda i: features[i]["properties"]["id"]):
            moved = [vertex for vertex in sorted(feature_keys[i]) if positions[vertex] != original[vertex]]
            regions = problems[i]
            if None in regions:
                nearby = moved
            else:
                region = shapely.union_all(regions)
                nearby = [vertex for vertex, close in zip(moved, shapely.dwithin(
                    region, shapely.points([original[vertex] for vertex in moved]), 2 * max_shift)) if close] if moved else []
            feature_id = features[i]["properties"]["id"]
            if nearby and len(nearby) < len(moved):
                locally_reverted.add(feature_id)
            else:
                nearby = list(feature_keys[i])
                reverted.add(feature_id)
            for vertex in nearby:
                positions[vertex] = original[vertex]
    result = deepcopy(features)
    for i in order:
        result[i]["geometry"] = geometries[i]
    distances = [hypot(positions[v][0] - original[v][0], positions[v][1] - original[v][1])
                 for v in sorted(original)]
    return result, {
        "moved_vertex_count": sum(distance > 0 for distance in distances),
        "max_shift_degrees": max(distances, default=0.0),
        "reverted_feature_ids": sorted(reverted),
        "locally_reverted_feature_ids": sorted(locally_reverted - reverted),
        "skipped_short_chain_count": skipped,
    }


def absorb_enclosed_island_holes(features):
    """Return enclaves inside a boolean-weld island to the island.

    A hole of a welded island can only be filled by a piece lying wholly inside
    it; the island keeps that piece, as the published scenario does.
    """
    result = deepcopy(features)
    shapes = [shape(feature["geometry"]) for feature in result]
    absorbed = []
    for index, feature in enumerate(result):
        props = feature["properties"]
        if props.get("atl_join_mode") != "boolean_weld" or props.get("atl_geometry_role") != "donor_island":
            continue
        for part in getattr(shapes[index], "geoms", [shapes[index]]):
            for ring in part.interiors:
                hole = Polygon(ring)
                for other, geometry in enumerate(shapes):
                    if other == index or geometry.intersection(hole).area < hole.area * (1 - 1e-9):
                        continue
                    shapes[index] = shapes[index].union(hole)
                    shapes[other] = shapes[other].difference(hole)
                    absorbed.append({"island_id": props["id"], "from_id": result[other]["properties"]["id"],
                                     "area": hole.area})
                    break
    changed = {entry[key] for entry in absorbed for key in ("island_id", "from_id")}
    for index, feature in enumerate(result):
        if feature["properties"]["id"] in changed:
            feature["geometry"] = mapping(shapes[index])
    return result, absorbed

def _conform_shared_edges(features, tolerance=1e-7):
    """Insert a neighbour's vertex where it lies on an edge, so shared edges move together."""
    shapes = [shape(feature["geometry"]) for feature in features]
    vertices = [shapely.get_coordinates(geometry) for geometry in shapes]
    tree = STRtree([geometry.boundary for geometry in shapes])
    result = list(features)
    for index, geometry in enumerate(shapes):
        own = {tuple(round(value, 9) for value in point) for point in vertices[index]}
        missing = []
        for other in sorted(tree.query(geometry.boundary, predicate="dwithin", distance=tolerance)):
            if other == index:
                continue
            points = vertices[other]
            close = shapely.dwithin(geometry.boundary, shapely.points(points), tolerance)
            missing.extend(tuple(point) for point, near in zip(points, close)
                           if near and tuple(round(value, 9) for value in point) not in own)
        if missing:
            snapped = snap(geometry, MultiPoint(sorted(set(missing))), tolerance)
            result[index] = {**features[index], "geometry": mapping(snapped)}
    return result


def _parts(geometry):
    return [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)


def snap_atlantropa_geometry(geometry, reference, *, tolerance):
    """Reject cumulative reference-vertex snapping beyond the stated tolerance."""
    candidate = snap(geometry, reference, tolerance)
    reason = None
    deviation = None
    if not candidate.is_valid or candidate.is_empty:
        reason = "invalid_snap_geometry"
    else:
        deviation = geometry.boundary.hausdorff_distance(candidate.boundary)
        if deviation > tolerance:
            reason = "snap_displacement_exceeds_tolerance"
        elif len(_parts(candidate)) != len(_parts(geometry)):
            reason = "snap_changed_components"
        elif any(not any(part.intersection(original).area > 0 for original in _parts(geometry))
                 for part in _parts(candidate)):
            reason = "snap_detached_source_component"
    return (geometry if reason else candidate), {
        "snap_tolerance_degrees": tolerance,
        "snap_attempt_boundary_vertex_hausdorff_degrees": deviation,
        "snap_fallback_reason": reason,
    }


def simplify_atlantropa_geometry(geometry, *, tolerance=MAX_POSTPROCESS_DEGREES, forbidden=None):
    """Keep the unsimplified polygon whenever simplification violates a constraint."""
    budget = min(max(float(tolerance), 0.0), MAX_POSTPROCESS_DEGREES)
    candidate = geometry.simplify(budget, preserve_topology=True)
    reason = None
    original_parts, candidate_parts = _parts(geometry), _parts(candidate)
    deviation = geometry.boundary.hausdorff_distance(candidate.boundary)
    if candidate.is_empty or not candidate.is_valid:
        reason = "invalid"
    elif len(original_parts) != len(candidate_parts):
        reason = "component_count"
    elif deviation > budget:
        reason = "boundary_deviation"
    elif forbidden is not None and candidate.intersection(forbidden).area > geometry.intersection(forbidden).area:
        reason = "crossed_land_boundary"
    else:
        for part in original_parts:
            matches = [other for other in candidate_parts if other.intersection(part).area > 0]
            if len(matches) != 1 or len(matches[0].interiors) != len(part.interiors):
                reason = "component_or_hole_changed"
                break
            minx, miny, maxx, maxy = part.bounds
            if min(maxx - minx, maxy - miny) <= 2 * budget and not matches[0].equals(part):
                reason = "sub_budget_component_changed"
                break
            if forbidden is not None and part.boundary.intersection(forbidden.boundary).length > 0:
                if matches[0].boundary.intersection(forbidden.boundary).length <= 0:
                    reason = "coast_contact_lost"
                    break
    result = geometry if reason else candidate
    return result, {
        "max_postprocess_degrees": budget,
        "boundary_vertex_hausdorff_degrees": 0.0 if reason else deviation,
        "fallback_reason": reason,
    }
