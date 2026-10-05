"""Projection-only densification that preserves every original ring vertex.

GEOS segmentize may collapse valid near-collinear overlay fragments. Construct
the measurement copy directly, without geometry repair or ring normalization.
Never use this copy as replacement political geometry.
"""
import math

from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Polygon


def densify_for_measurement(geometry, max_segment_length=0.001):
    if not math.isfinite(max_segment_length) or max_segment_length <= 0:
        raise ValueError('Measurement segment length must be finite and positive')
    if geometry.is_empty:
        return geometry

    def coordinates(ring):
        points = list(ring.coords)
        result = []
        for start, end in zip(points, points[1:]):
            result.append(start)
            count = max(1, math.ceil(math.hypot(end[0] - start[0], end[1] - start[1]) / max_segment_length))
            for index in range(1, count):
                ratio = index / count
                result.append(tuple(a + (b - a) * ratio for a, b in zip(start, end)))
        result.append(points[-1])
        return result

    if geometry.geom_type == 'Polygon':
        return Polygon(coordinates(geometry.exterior), [coordinates(ring) for ring in geometry.interiors])
    if geometry.geom_type == 'MultiPolygon':
        return MultiPolygon([densify_for_measurement(part, max_segment_length) for part in geometry.geoms])
    if geometry.geom_type == 'GeometryCollection':
        return GeometryCollection([densify_for_measurement(part, max_segment_length) for part in geometry.geoms])
    if geometry.geom_type in {'LineString', 'LinearRing'}:
        return LineString(coordinates(geometry))
    raise ValueError(f'Unsupported measurement geometry: {geometry.geom_type}')
