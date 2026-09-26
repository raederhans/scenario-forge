"""Repair same-ID internal seams from a verified source partition.

The existing exterior and foreign/water surfaces are constraints. Only enclosed
holes covered by source land can be added. Source IDs define the partition;
outside source land, an existing overlap can extend its uniquely nearest source
parent, but cannot introduce a new feature or a foreign country.
"""
from collections import defaultdict

import shapely
from shapely.geometry import Polygon, GeometryCollection
from shapely.ops import polygonize

from map_builder.coverage_validation import coverage_is_valid_exact


def repair_source_coverage(baseline, sources, *, protected=None):
    if not baseline or set(baseline) != set(sources):
        raise ValueError("Repair requires exactly the same nonempty source and baseline IDs")
    ids = sorted(baseline)
    old, source = [baseline[i] for i in ids], [sources[i] for i in ids]
    if any(g.is_empty or not g.is_valid or g.geom_type not in {"Polygon", "MultiPolygon"} for g in old):
        raise ValueError("Invalid baseline polygon")
    if not coverage_is_valid_exact(source):
        raise ValueError("Sources must form valid shared coverage")
    protected = protected if protected is not None else GeometryCollection()
    old_domain, source_domain = shapely.union_all(old), shapely.union_all(source)
    additions = []
    for part in shapely.get_parts(old_domain):
        for ring in part.interiors:
            hole = Polygon(ring)
            # A real source hole (lake, enclave, waterway) is not a seam defect.
            if not source_domain.covers(hole):
                continue
            addition = hole.difference(protected)
            if not addition.is_empty:
                additions.append(addition)
    domain = shapely.union_all([old_domain, *additions])
    source_tree, old_tree = shapely.STRtree(source), shapely.STRtree(old)
    lines = [domain.boundary, *(g.boundary for g in old)]
    lines.extend(g.boundary for g in source)
    assigned = defaultdict(list)
    faces, extensions = 0, 0
    resolved_extensions = []
    for face in polygonize(shapely.union_all(lines)):
        point = face.representative_point()
        if not domain.covers(point):
            continue
        faces += 1
        hits = [int(i) for i in source_tree.query(point) if source[int(i)].contains(point)]
        if len(hits) > 1:
            raise ValueError("Ambiguous source ownership")
        if not hits:
            hits = [int(i) for i in old_tree.query(point) if old[int(i)].contains(point)]
            if len(hits) > 1:
                distances = sorted((source[i].distance(point), i) for i in hits)
                if abs(distances[0][0] - distances[1][0]) < 1e-12:
                    raise ValueError("Ambiguous source extension in existing overlap")
                receiver = distances[0][1]
                resolved_extensions.append({'ids': [ids[i] for i in hits], 'receiver': ids[receiver],
                    'area_deg2': face.area, 'source_distance_degrees': distances[0][0]})
                hits = [receiver]
            if not hits:
                raise ValueError(f"Unresolved baseline-only face: {face.bounds}, {face.area}")
            extensions += 1
        assigned[ids[hits[0]]].append(face)
    result = {fid: shapely.union_all(assigned[fid]) for fid in ids}
    if not coverage_is_valid_exact(result.values()):
        raise ValueError("Repair did not produce valid shared coverage")
    restored = shapely.union_all(list(result.values()))
    residual = restored.symmetric_difference(domain)
    if residual.area > 1e-10:
        raise ValueError("Repair changed the constrained domain")
    added = restored.difference(old_domain)
    if added.intersection(protected).area > 1e-10:
        raise ValueError("Repair invaded a protected region")
    return result, {"feature_count": len(ids), "faces": faces,
                    "baseline_only_faces": extensions, "filled_holes": len(additions),
                    "added_area_deg2": added.area, "domain_residual_deg2": residual.area,
                    "source_extension_overlap_resolutions": resolved_extensions,
                    "coverage_valid": True, "assignment_rule": "same-ID source partition"}
