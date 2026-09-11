"""Small, offline helpers for comparing HGO island geometry with a target island.

It fits an axis-aligned scale and translation from one polygonal geometry's
bounding box to another's, so a candidate island can be audited before it is
admitted to the scenario pipeline.
"""

from __future__ import annotations

from shapely import affinity


_POLYGONAL_TYPES = frozenset({"Polygon", "MultiPolygon"})


def _validate_polygonal(geometry, label: str):
    if geometry is None:
        raise ValueError(f"{label} geometry is required")
    if getattr(geometry, "geom_type", None) not in _POLYGONAL_TYPES:
        raise ValueError(f"{label} geometry must be Polygon or MultiPolygon")
    if geometry.is_empty:
        raise ValueError(f"{label} geometry must be non-empty")
    if not geometry.is_valid:
        raise ValueError(f"{label} geometry must be valid")
    min_x, min_y, max_x, max_y = geometry.bounds
    if max_x <= min_x or max_y <= min_y:
        raise ValueError(f"{label} geometry must have positive bounding-box width and height")
    return (float(min_x), float(min_y), float(max_x), float(max_y))


def _ratio(numerator: float, denominator: float) -> float:
    return float(numerator / denominator) if denominator > 0 else 0.0


def fit_bbox_alignment(source, target) -> dict[str, object]:
    """Fit a no-rotation, no-shear bbox transform and return audit diagnostics.

    The returned tuple is arranged for the existing builder's
    ``apply_affine_to_geometry`` call: ``(ax, bx, cx, ay, by, cy)`` is expanded
    there as ``[ax, bx, ay, by, cx, cy]`` for Shapely.  Consequently, for this
    axis-aligned transform the tuple is ``(scale_x, 0, offset_x, 0,
    scale_y, offset_y)``.  The fitted transform maps the source bbox exactly
    onto the target bbox and is intentionally not presented as a geodetic
    registration.
    """

    source_bbox = _validate_polygonal(source, "source")
    target_bbox = _validate_polygonal(target, "target")
    source_min_x, source_min_y, source_max_x, source_max_y = source_bbox
    target_min_x, target_min_y, target_max_x, target_max_y = target_bbox

    ax = (target_max_x - target_min_x) / (source_max_x - source_min_x)
    ay = (target_max_y - target_min_y) / (source_max_y - source_min_y)
    bx = 0.0
    by = 0.0
    cx = target_min_x - ax * source_min_x
    cy = target_min_y - ay * source_min_y
    # The tuple is intentionally builder-compatible.  The builder reorders
    # these six values before calling Shapely's [a, b, d, e, xoff, yoff].
    coeffs = (float(ax), float(bx), float(cx), float(by), float(ay), float(cy))
    mapped = affinity.affine_transform(source, [ax, bx, by, ay, cx, cy])
    overlap = mapped.intersection(target)
    overlap_area = float(overlap.area)
    mapped_area = float(mapped.area)
    target_area = float(target.area)
    diagnostics = {
        "source_bbox": source_bbox,
        "target_bbox": target_bbox,
        "scale": {"x": float(ax), "y": float(ay)},
        "translation": {"x": float(cx), "y": float(cy)},
        "coefficients": coeffs,
        "mapped_bbox": tuple(float(value) for value in mapped.bounds),
        "mapped_area": mapped_area,
        "target_area": target_area,
        "overlap_area": overlap_area,
        "mapped_overlap_ratio": _ratio(overlap_area, mapped_area),
        "target_coverage_ratio": _ratio(overlap_area, target_area),
    }
    return {"geometry": mapped, "coefficients": coeffs, "diagnostics": diagnostics}


__all__ = ["fit_bbox_alignment"]
