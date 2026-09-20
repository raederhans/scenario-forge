"""Exact coverage checks for point-touching holes observed in the Russian baseline.

GEOS 3.13.1 can flag disjoint, edge-matched polygons whose hole touches a
shared shell vertex. On native failure, check the coverage definition directly:
disjoint interiors and intersections made of identical input edges/vertices.
No snapping, rounding, geometry edits or positive tolerances are involved.
"""
import shapely
from shapely.geometry import LineString, MultiPoint


def _segments_and_vertices(geometry):
    segments, vertices = set(), set()
    for polygon in shapely.get_parts(geometry):
        for ring in [polygon.exterior, *polygon.interiors]:
            coordinates = list(ring.coords)
            vertices.update(coordinates)
            segments.update(tuple(sorted((a, b))) for a, b in zip(coordinates, coordinates[1:]) if a != b)
    return segments, vertices


def coverage_is_valid_exact(geometries, diagnostics=None):
    values = list(geometries)
    if any(g.is_empty or not g.is_valid or g.geom_type not in {'Polygon', 'MultiPolygon'} for g in values):
        return False
    if shapely.coverage_is_valid(values):
        if diagnostics is not None:
            diagnostics.update(method='native', valid=True)
        return True
    invalid = shapely.coverage_invalid_edges(values)
    tree, cache, seen = shapely.STRtree(values), {}, set()
    for i, edge in enumerate(invalid):
        if edge.is_empty:
            continue
        for item in tree.query(values[i], predicate='intersects'):
            j = int(item)
            pair = tuple(sorted((i, j)))
            if i == j or pair in seen:
                continue
            seen.add(pair)
            if not values[i].relate_pattern(values[j], 'F********'):
                return False
            for k in pair:
                if k not in cache:
                    cache[k] = _segments_and_vertices(values[k])
            a_edges, a_points = cache[i]
            b_edges, b_points = cache[j]
            shared = shapely.union_all([
                *[LineString(segment) for segment in a_edges & b_edges],
                MultiPoint(list(a_points & b_points)),
            ])
            actual = values[i].boundary.intersection(values[j].boundary)
            if not shared.equals(actual):
                return False
    if diagnostics is not None:
        diagnostics.update(method='exact_input_segments_and_disjoint_interiors', valid=True,
                           native_invalid_count=sum(not edge.is_empty for edge in invalid),
                           checked_pairs=len(seen), geometry_modified=False)
    return True
