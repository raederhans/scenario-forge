"""Keep physical polygon ring traversal compatible with D3 spherical fill."""
from map_builder.geo.spherical_safety import _topology_feature_collection, _reverse_topology_ring_refs


def repair_physical_topology_winding(payload, object_name):
    """Reverse references only: arc coordinates, IDs and boundaries are unchanged.

    The topology encoder can emit mixed orientation for shared rings. These
    physical areas are planar lon/lat polygons, with date-line parts split.
    D3 requires clockwise outer rings and counterclockwise holes.
    """
    collection = _topology_feature_collection(payload, object_name, 'physical-winding')
    geometries = payload['objects'][object_name]['geometries']
    changed = 0
    for geometry, feature in zip(geometries, collection['features'], strict=True):
        kind = geometry['type']
        if kind not in ('Polygon', 'MultiPolygon'):
            continue
        parts = [geometry['arcs']] if kind == 'Polygon' else geometry['arcs']
        coordinates = feature['geometry']['coordinates']
        coordinate_parts = [coordinates] if kind == 'Polygon' else coordinates
        for rings, coordinate_rings in zip(parts, coordinate_parts, strict=True):
            for index, points in enumerate(coordinate_rings):
                signed_area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(points, points[1:]))
                if (index == 0 and signed_area > 0) or (index > 0 and signed_area < 0):
                    rings[index] = _reverse_topology_ring_refs(rings[index])
                    changed += 1
    return changed
