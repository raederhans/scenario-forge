"""Partition explicitly reviewed empty corridors without moving existing borders."""
from __future__ import annotations

import heapq
import math
from itertools import combinations

import shapely
from shapely.geometry import LineString
from shapely.ops import polygonize


def _bridge(point, gap, fixed_vertices, x_scale):
    """Reach an existing opposite vertex, routing around concavities if needed."""
    start = tuple(point.coords[0])

    def distance(a, b):
        return math.hypot((a[0] - b[0]) * x_scale, a[1] - b[1])

    def visible(a, b):
        # Overlay roundoff only; this never buffers or moves a coordinate.
        return LineString([a, b]).difference(gap).length <= 1e-12

    for end in sorted(fixed_vertices, key=lambda p: (distance(start, p), p)):
        line = LineString([start, end])
        if (end != start and visible(start, end)
                and line.difference(gap.boundary).length > 1e-12):
            return line
    nodes = [start, *sorted(set(map(tuple, shapely.get_coordinates(gap))) - {start})]
    distances, previous, queue = {0: 0.0}, {}, [(0.0, 0)]
    while queue:
        length, index = heapq.heappop(queue)
        if length != distances[index]:
            continue
        if nodes[index] in fixed_vertices:
            path = [nodes[index]]
            while index:
                index = previous[index]
                path.append(nodes[index])
            return LineString(path[::-1])
        for other, coordinate in enumerate(nodes):
            candidate = length + distance(nodes[index], coordinate)
            if (other == index or candidate >= distances.get(other, math.inf)
                    or not visible(nodes[index], coordinate)):
                continue
            distances[other], previous[other] = candidate, index
            heapq.heappush(queue, (candidate, other))
    raise ValueError("No corridor-contained path reaches the fixed border")


def partition_reviewed_seam(gap, receivers, fixed_boundary, *, allowed_surface):
    """Return additions by ID, retaining the old administrative boundary junctions.

    The caller must explicitly select a reviewed, enclosed gap. Shared receiver
    junctions connect to existing opposite-border vertices by visible segments
    (a visibility-graph route handles concavities). Each resulting face must
    have positive boundary support from exactly one original receiver. This is
    an interpolation rule for missing geometry, not new historical source data.
    """
    if gap.geom_type != "Polygon" or not gap.is_valid or gap.is_empty:
        raise ValueError("Reviewed gap must be a valid nonempty polygon")
    if gap.difference(allowed_surface).area > 1e-12:
        raise ValueError("Reviewed gap includes protected water or non-land surface")
    if not receivers or any(not g.is_valid or g.is_empty for g in receivers.values()):
        raise ValueError("Receivers must be valid nonempty polygons")
    if gap.intersection(shapely.union_all(list(receivers.values()))).area > 1e-12:
        raise ValueError("Reviewed gap is not empty")
    fixed = gap.boundary.intersection(fixed_boundary)
    vertices = set(map(tuple, shapely.get_coordinates(fixed)))
    if fixed.length == 0 or not vertices:
        raise ValueError("Reviewed gap has no fixed opposite boundary")
    x_scale = math.cos(math.radians(gap.centroid.y))
    junctions = set()
    for a, b in combinations(sorted(receivers), 2):
        contact = receivers[a].intersection(receivers[b]).intersection(gap.boundary)
        for point in shapely.get_parts(contact):
            if point.geom_type != "Point":
                if not point.is_empty:
                    raise ValueError("Ambiguous shared receiver junction")
            elif not fixed.covers(point):
                junctions.add(tuple(point.coords[0]))
    cuts = [_bridge(shapely.Point(xy), gap, vertices, x_scale) for xy in sorted(junctions)]
    if any(a.crosses(b) for a, b in combinations(cuts, 2)):
        raise ValueError("Corridor partition bridges cross")
    faces = [face for face in polygonize(shapely.union_all([gap.boundary, *cuts]))
             if gap.covers(face.representative_point())]
    assigned = {fid: [] for fid in sorted(receivers)}
    for face in faces:
        support = [fid for fid, geometry in receivers.items()
                   if face.boundary.intersection(geometry.boundary).length > 1e-12]
        if len(support) != 1:
            raise ValueError(f"Corridor face has ambiguous receiver support: {support}")
        assigned[support[0]].append(face)
    additions = {fid: shapely.union_all(parts) for fid, parts in assigned.items() if parts}
    total = shapely.union_all(list(additions.values()))
    if total.symmetric_difference(gap).area > 1e-12:
        raise ValueError("Corridor partition leaves uncovered area")
    if not shapely.coverage_is_valid(list(additions.values())):
        raise ValueError("Corridor additions are not a valid coverage")
    extended = [shapely.union_all([geometry, additions.get(fid, shapely.GeometryCollection())])
                for fid, geometry in sorted(receivers.items())]
    if not shapely.coverage_is_valid(extended):
        raise ValueError("Extended receivers are not a valid coverage")
    return additions, {"junction_count": len(junctions), "face_count": len(faces),
                       "bridges": [list(line.coords) for line in cuts]}
