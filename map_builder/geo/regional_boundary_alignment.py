"""Conservative same-ID boundary continuation for regional geometry pilots."""
from __future__ import annotations

import math

import geopandas as gpd
import shapely
from shapely.geometry import GeometryCollection, Polygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree


def _polygons(geometry):
    if geometry is None or geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    if geometry.geom_type == "GeometryCollection":
        return [part for child in geometry.geoms for part in _polygons(child)]
    return []


def _hole_union(geometry):
    holes = []
    for polygon in _polygons(geometry):
        holes.extend(Polygon(ring) for ring in polygon.interiors)
    return unary_union(holes) if holes else GeometryCollection()


def _validate_input(frame: gpd.GeoDataFrame, label: str) -> None:
    if frame is None or frame.empty:
        raise ValueError(f"{label} geometry layer is empty.")
    if "id" not in frame.columns:
        raise ValueError(f"{label} geometry layer requires an id column.")
    if frame["id"].isna().any():
        raise ValueError(f"{label} geometry layer contains null IDs.")
    ids = frame["id"].astype(str)
    if any(not value or value != value.strip() for value in ids):
        raise ValueError(f"{label} geometry layer contains empty or whitespace-padded IDs.")
    if frame.crs is None:
        raise ValueError(f"{label} geometry layer requires a CRS.")
    if ids.duplicated().any():
        raise ValueError(f"{label} geometry layer contains duplicate IDs.")
    geometries = frame.geometry.tolist()
    if any(
        geometry is None
        or geometry.is_empty
        or not geometry.is_valid
        or geometry.geom_type not in {"Polygon", "MultiPolygon"}
        for geometry in geometries
    ):
        raise ValueError(f"{label} geometry layer contains empty, invalid, or non-polygon geometry.")


def align_regional_boundaries(
    baseline: gpd.GeoDataFrame,
    candidate: gpd.GeoDataFrame,
    *,
    area_epsilon: float = 1e-12,
) -> tuple[gpd.GeoDataFrame, dict[str, object]]:
    """Extend candidate into baseline-only outer coverage without filling holes.

    Candidate geometry is authoritative wherever it exists. Extension faces are
    assigned to baseline IDs by boundary support length, then ID as a stable
    tie-breaker. No coordinates are moved and no geometry is repaired.
    """
    _validate_input(baseline, "baseline")
    _validate_input(candidate, "candidate")
    if not math.isfinite(area_epsilon) or area_epsilon < 0:
        raise ValueError("Area tolerance must be finite and nonnegative.")
    if baseline.crs != candidate.crs:
        raise ValueError(f"Baseline/candidate CRS mismatch: {baseline.crs} vs {candidate.crs}.")
    baseline_ids = set(baseline["id"].astype(str))
    candidate_ids = set(candidate["id"].astype(str))
    if any(not feature_id.strip() for feature_id in baseline_ids | candidate_ids):
        raise ValueError("Baseline and candidate IDs must be nonempty.")
    if baseline_ids != candidate_ids:
        raise ValueError("Baseline and candidate IDs must match exactly.")
    candidate_geometries = candidate.geometry.tolist()
    if not shapely.coverage_is_valid(candidate_geometries):
        raise ValueError("Candidate geometry must be a valid coverage.")

    baseline_by_id = dict(zip(baseline["id"].astype(str), baseline.geometry))
    candidate_by_id = dict(zip(candidate["id"].astype(str), candidate.geometry))
    baseline_union = unary_union(list(baseline_by_id.values()))
    candidate_union = unary_union(candidate_geometries)
    holes = _hole_union(candidate_union)
    extension = baseline_union.difference(candidate_union).difference(holes)
    extension = extension if not extension.is_empty else GeometryCollection()

    baseline_items = sorted(baseline_by_id.items())
    candidate_items = sorted(candidate_by_id.items())
    baseline_tree = STRtree([geometry for _, geometry in baseline_items])
    candidate_tree = STRtree([geometry for _, geometry in candidate_items])
    lines = [geometry.boundary for _, geometry in candidate_items]
    lines.extend(geometry.boundary for _, geometry in baseline_items)
    faces = list(polygonize(unary_union(lines))) if lines else []
    assigned: dict[str, list[object]] = {feature_id: [] for feature_id in sorted(baseline_ids)}
    ambiguous = 0
    affected: set[str] = set()
    for face in faces:
        if face.area == 0:
            continue
        point = face.representative_point()
        candidate_hits = candidate_tree.query(point)
        candidate_owners = [
            candidate_items[int(index)][0]
            for index in candidate_hits
            if candidate_items[int(index)][1].covers(point)
        ]
        if candidate_owners:
            # Candidate coverage has priority. Shared candidate edges are
            # already noded, so the representative point selects one ID.
            assigned[min(candidate_owners)].append(face)
            continue
        if not extension.covers(point):
            continue
        baseline_hits = baseline_tree.query(point)
        owners = [
            baseline_items[int(index)][0]
            for index in baseline_hits
            if baseline_items[int(index)][1].covers(point)
        ]
        if not owners:
            raise ValueError("Extension face has no deterministic baseline owner.")
        if len(owners) > 1:
            ambiguous += 1
        owner = min(
            owners,
            key=lambda feature_id: (
                -face.boundary.intersection(baseline_by_id[feature_id].boundary).length,
                feature_id,
            ),
        )
        assigned[owner].append(face)
        affected.add(owner)

    output = candidate.copy()
    for index, feature_id in enumerate(output["id"].astype(str)):
        additions = assigned[feature_id]
        if additions:
            output.at[output.index[index], "geometry"] = unary_union(additions)
    output = gpd.GeoDataFrame(output, geometry="geometry", crs=candidate.crs)
    output_geometries = output.geometry.tolist()
    if not shapely.coverage_is_valid(output_geometries):
        raise ValueError("Aligned regional output is not a valid coverage.")
    containment_errors = {
        feature_id: float(candidate_by_id[feature_id].difference(
            output.loc[output["id"].astype(str) == feature_id, "geometry"].iloc[0]
        ).area)
        for feature_id in candidate_ids
    }
    if any(error > area_epsilon for error in containment_errors.values()):
        raise ValueError(f"Aligned output does not contain candidate geometry: {containment_errors}")
    desired_union = candidate_union.union(extension)
    output_union = unary_union(output_geometries)
    union_residual = float(output_union.symmetric_difference(desired_union).area)
    if union_residual > area_epsilon:
        raise ValueError(f"Aligned output union differs from desired union by {union_residual}.")
    diagnostics = {
        "extension_area": float(extension.area),
        "affected_ids": sorted(affected),
        "ambiguous_face_count": ambiguous,
        "candidate_hole_area_excluded": float(holes.area),
        "face_count": len(faces),
        "union_residual": union_residual,
        "area_epsilon": area_epsilon,
        "area_units": "squared CRS coordinate units",
        "candidate_containment_errors": containment_errors,
    }
    return output, diagnostics
