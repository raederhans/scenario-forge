"""Pure geometry constraints for scenario surface candidates."""
from __future__ import annotations

from typing import Any

import geopandas as gpd
import shapely
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree


def _polygon_boundaries(geometry):
    """Yield area boundaries, including polygons in mixed overlay results."""
    if geometry.geom_type == "Polygon":
        yield geometry.boundary
    elif geometry.geom_type in {"MultiPolygon", "GeometryCollection"}:
        for part in geometry.geoms:
            yield from _polygon_boundaries(part)


def constrain_candidate_surface_geometry(
    baseline: gpd.GeoDataFrame,
    candidate: gpd.GeoDataFrame,
    protected_geometry: Any,
) -> tuple[gpd.GeoDataFrame, dict[str, Any]]:
    """Remove only newly introduced protected-surface overlap.

    Existing baseline overlap remains allowed for compatibility.  Inputs are
    deliberately not repaired: malformed, empty, invalid, or changed-ID
    inputs fail closed.
    """
    if not isinstance(baseline, gpd.GeoDataFrame) or not isinstance(candidate, gpd.GeoDataFrame):
        raise TypeError("baseline and candidate must be GeoDataFrame instances")
    if baseline.crs is None or candidate.crs is None or baseline.crs != candidate.crs:
        raise ValueError("baseline and candidate must have the same explicit CRS")
    if baseline.empty or candidate.empty or baseline.geometry.isna().any() or candidate.geometry.isna().any():
        raise ValueError("baseline and candidate must contain non-empty geometries")
    if not bool(baseline.geometry.geom_type.isin(["Polygon", "MultiPolygon"]).all()) or not bool(candidate.geometry.geom_type.isin(["Polygon", "MultiPolygon"]).all()):
        raise ValueError("surface constraints require Polygon or MultiPolygon geometries")
    if not baseline.geometry.is_valid.all() or not candidate.geometry.is_valid.all():
        raise ValueError("invalid geometry is not repaired by surface constraints")
    if baseline.geometry.is_empty.any() or candidate.geometry.is_empty.any():
        raise ValueError("empty geometry is not accepted")
    if "id" not in baseline.columns or "id" not in candidate.columns:
        raise ValueError("baseline and candidate require an id column")
    if baseline["id"].isna().any() or candidate["id"].isna().any():
        raise ValueError("feature IDs cannot be null")
    old_raw_ids = [str(value) for value in baseline["id"]]
    new_raw_ids = [str(value) for value in candidate["id"]]
    if any(value != value.strip() for value in old_raw_ids + new_raw_ids):
        raise ValueError("feature IDs cannot contain surrounding whitespace")
    old_ids = [value.strip() for value in old_raw_ids]
    new_ids = [value.strip() for value in new_raw_ids]
    if any(not value for value in old_ids + new_ids):
        raise ValueError("feature IDs cannot be empty")
    if len(set(old_ids)) != len(old_ids) or len(set(new_ids)) != len(new_ids) or set(old_ids) != set(new_ids):
        raise ValueError("baseline and candidate must have the same unique IDs")
    if protected_geometry is None or protected_geometry.is_empty or not protected_geometry.is_valid:
        raise ValueError("protected geometry must be valid and non-empty")
    if protected_geometry.geom_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError("protected geometry must be Polygon or MultiPolygon")
    if not bool(shapely.coverage_is_valid(list(candidate.geometry))):
        raise ValueError("candidate geometry must be a valid non-overlapping coverage")
    baseline_union = unary_union(list(baseline.geometry))
    newly_forbidden = protected_geometry.difference(baseline_union)
    forbidden = newly_forbidden.intersection(baseline_union.union(unary_union(list(candidate.geometry))).envelope)
    candidate_geometries = list(candidate.geometry)
    # Node candidate and forbidden boundaries once, then polygonize the common
    # planar subdivision.  Independent difference() per feature can create
    # unmatched T-nodes at a shared boundary.
    # Clipping to the envelope can also retain touching lines, producing a
    # GeometryCollection. Its .boundary is None: passing it to unary_union
    # silently loses ALL forbidden polygon boundaries, not just those lines.
    lines = unary_union([*(geometry.boundary for geometry in candidate_geometries),
                         *_polygon_boundaries(forbidden)])
    faces = list(polygonize(lines))
    tree = STRtree(candidate_geometries)
    rebuilt: dict[int, list[Any]] = {index: [] for index in range(len(candidate_geometries))}
    for face in faces:
        point = face.representative_point()
        if forbidden.covers(point):
            continue
        for index in tree.query(point):
            if candidate_geometries[int(index)].covers(point):
                rebuilt[int(index)].append(face)
                break
    geometries = []
    removed_area = 0.0
    conservation_errors = []
    for index, geometry in enumerate(candidate_geometries):
        clipped = unary_union(rebuilt[index])
        if clipped.is_empty or not clipped.is_valid:
            raise ValueError("surface constraint produced empty or invalid geometry")
        error = geometry.difference(forbidden).symmetric_difference(clipped).area
        conservation_errors.append(float(error))
        if error > 1e-12:
            raise ValueError(f"surface constraint changed geometry outside permitted clipping: {new_ids[index]}: {error}")
        removed_area += max(0.0, geometry.difference(clipped).area)
        geometries.append(clipped)
    result = candidate.copy()
    result["geometry"] = geometries
    if any(geometry.geom_type not in {"Polygon", "MultiPolygon"} for geometry in result.geometry):
        raise ValueError("surface constraint output must remain Polygon or MultiPolygon")
    if not bool(shapely.coverage_is_valid(list(result.geometry))):
        raise ValueError("surface constraint produced invalid polygon coverage")
    residual_new_overlap = unary_union(list(result.geometry)).intersection(forbidden).area
    if residual_new_overlap > 1e-12:
        raise ValueError(f"surface constraint left new protected overlap: {residual_new_overlap}")
    return result, {
        "feature_count": len(result),
        "newly_forbidden_area": float(newly_forbidden.area),
        "removed_candidate_area": float(removed_area),
        "residual_new_overlap_area": float(residual_new_overlap),
        "max_per_feature_conservation_error": max(conservation_errors),
        "area_epsilon": 1e-12,
        "area_units": "squared CRS coordinate units",
        "baseline_overlap_allowed": True,
        "coverage_valid": True,
    }
