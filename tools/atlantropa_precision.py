"""Bound post-fit simplification without claiming additional donor resolution."""

from shapely.ops import snap


MAX_POSTPROCESS_DEGREES = 0.0025


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
