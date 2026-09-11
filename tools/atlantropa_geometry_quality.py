"""Conservative, deterministic polygon reconciliation before topology encoding.

Areas and distances in diagnostics use the input coordinate system (degrees for
the TNO source). Small or remote components are reported, never discarded.
"""
from __future__ import annotations

from copy import deepcopy

from shapely.geometry import GeometryCollection, mapping, shape
from shapely.ops import unary_union

# GEOS differences on degree coordinates can leave roundoff intersections near
# 1e-16 square degrees. This is an overlap predicate tolerance, never an island
# area cutoff, snap grid, or geometry buffer.
OVERLAP_AREA_EPSILON = 1e-14


class GeometryConflictError(ValueError):
    """A repair would choose an ownership boundary or remove a stable feature ID."""

    def __init__(self, message, diagnostics):
        super().__init__(message)
        self.diagnostics = diagnostics


def _polygonal(geometry):
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        return geometry
    parts = [_polygonal(part) for part in getattr(geometry, "geoms", ())]
    return unary_union([part for part in parts if not part.is_empty]) if parts else GeometryCollection()


def _is_land(feature):
    props = feature.get("properties") or {}
    if props.get("atl_render_layer"):
        return props["atl_render_layer"] == "land"
    feature_id = str(props.get("id") or feature.get("id") or "").strip()
    return feature_id.startswith(("ATLPRV_", "ATLISL_", "ATLWLD_"))


def _records(features, *, land_only=False, owner_by_feature_id=None):
    records = []
    seen = set()
    for index, feature in enumerate(features):
        if land_only and not _is_land(feature):
            continue
        props = feature.get("properties") or {}
        feature_id = str(props.get("id") or feature.get("id") or "").strip()
        if not feature_id or feature_id in seen:
            raise GeometryConflictError("Missing or duplicate stable feature ID", {"feature_id": feature_id})
        seen.add(feature_id)
        geometry = shape(feature["geometry"]) if feature.get("geometry") else GeometryCollection()
        if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise GeometryConflictError("Expected a nonempty valid polygon", {"feature_id": feature_id})
        owner = str(props.get("owner_tag") or props.get("owner") or "").strip().upper()
        if owner_by_feature_id is not None:
            if feature_id in owner_by_feature_id:
                owner = str(owner_by_feature_id[feature_id] or "").strip().upper()
            elif owner == "ATL":
                owner = ""
        records.append((feature_id, index, owner, geometry))
    return sorted(records)


def _components(records):
    result = []
    for feature_id, _, _, geometry in records:
        parts = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
        parts.sort(key=lambda part: (-part.area, part.bounds))
        for index, part in enumerate(parts):
            result.append({
                "feature_id": feature_id,
                "component_index": index,
                "area": part.area,
                "centroid": [part.centroid.x, part.centroid.y],
                "distance_to_largest": part.distance(parts[0]),
            })
    return result


def normalize_land_features(features, *, priority=None, priority_source=None, owner_by_feature_id=None,
                            allow_retire_helper=False):
    """Remove same-owner overlap, with lexicographically smaller stable ID first.

    Non-land features pass through unchanged. Different or unknown owners fail closed. Complete
    duplicates also fail: callers must resolve provenance before removing an ID.
    Neither tolerance buffers nor minimum-area filters are applied.

    A caller-approved priority mapping (ID -> distinct rank, lower wins) can
    resolve conflicting owners. Its provenance must be named in priority_source.
    Every conflicting pair must have explicit, unequal ranks; no default rank
    implicitly resolves ownership. Owners must already reflect authoritative
    assignments, not synthetic source defaults.
    Explicit allow_retire_helper permits only completely covered ATLWLD helpers
    to be removed. Retired IDs are reported for the caller's ownership/metadata
    reconciliation; provinces and islands still fail if fully consumed.
    """
    result = deepcopy(features)
    records = _records(result, land_only=True, owner_by_feature_id=owner_by_feature_id)
    diagnostics = {"overlaps": [], "owner_conflicts": [], "components": [],
                   "retired_helper_ids": [], "retired_features": []}
    if priority is not None and not str(priority_source or "").strip():
        raise ValueError("Explicit priority requires priority_source provenance")
    # Check original pairs first; earlier same-owner subtraction must not hide
    # a later conflict with a differently owned feature.
    for offset, (feature_id, _, owner, geometry) in enumerate(records):
        for other_id, _, other_owner, other_geometry in records[offset + 1:]:
            if not geometry.intersects(other_geometry):
                continue
            overlap_area = geometry.intersection(other_geometry).area
            if overlap_area > OVERLAP_AREA_EPSILON and (not owner or owner != other_owner):
                resolved = (priority is not None and feature_id in priority and other_id in priority
                            and priority[feature_id] != priority[other_id])
                winner = (feature_id if priority[feature_id] < priority[other_id] else other_id) if resolved else None
                diagnostics["owner_conflicts"].append({
                    "feature_ids": [feature_id, other_id],
                    "owners": [owner, other_owner], "area": overlap_area,
                    "resolved": bool(resolved and owner and other_owner),
                    "kept_feature_id": winner,
                    "trimmed_feature_id": (other_id if winner == feature_id else feature_id) if resolved else None,
                    "priority_source": priority_source if resolved else None,
                })
    if any(not conflict["resolved"] for conflict in diagnostics["owner_conflicts"]):
        raise GeometryConflictError("Land overlap has conflicting or unknown owners", diagnostics)
    if priority is not None:
        records.sort(key=lambda record: (record[0] not in priority, priority.get(record[0], 0), record[0]))
    accepted = []
    retired_indexes = set()
    for feature_id, index, owner, geometry in records:
        original = geometry
        for previous_id, _, previous_owner, previous_geometry in accepted:
            if not geometry.intersects(previous_geometry):
                continue
            overlap_area = geometry.intersection(previous_geometry).area
            if overlap_area <= OVERLAP_AREA_EPSILON:
                continue
            diagnostics["overlaps"].append({
                "kept_feature_id": previous_id, "trimmed_feature_id": feature_id,
                "owners": [previous_owner, owner], "area": overlap_area,
                "priority_source": priority_source if priority is not None else "same_owner_stable_id",
            })
            geometry = _polygonal(geometry.difference(previous_geometry))
            if geometry.is_empty:
                if allow_retire_helper and feature_id.startswith("ATLWLD_"):
                    retired_indexes.add(index)
                    diagnostics["retired_helper_ids"].append(feature_id)
                    diagnostics["retired_features"].append({
                        "feature_id": feature_id, "owner": owner,
                        "reason": "fully_covered_generated_helper",
                        "priority_source": priority_source if priority is not None else "same_owner_stable_id",
                        "covered_by_feature_ids": [
                            entry["kept_feature_id"] for entry in diagnostics["overlaps"]
                            if entry["trimmed_feature_id"] == feature_id
                        ],
                    })
                    break
                raise GeometryConflictError("Overlap repair would remove a stable land ID", diagnostics)
        if index in retired_indexes:
            continue
        if not geometry.equals(original):
            result[index]["geometry"] = mapping(geometry)
        accepted.append((feature_id, index, owner, geometry))
    diagnostics["components"] = _components(accepted)
    return [feature for index, feature in enumerate(result) if index not in retired_indexes], diagnostics


def exclude_land_from_sea(sea_features, land_features):
    """Clip sea to confirmed land, retaining all sea outside that footprint.

    Run after final sea completion and land reconciliation. No dilation or
    simplification is allowed here: connections and legitimate islands survive.
    """
    result = deepcopy(sea_features)
    sea_records = _records(result)
    land_records = _records(land_features, land_only=True)
    land_union = unary_union([record[3] for record in land_records])
    diagnostics = {"land_sea_overlaps": []}
    for feature_id, index, _, geometry in sea_records:
        if not geometry.intersects(land_union):
            continue
        overlap_area = geometry.intersection(land_union).area
        if overlap_area <= OVERLAP_AREA_EPSILON:
            continue
        diagnostics["land_sea_overlaps"].append({"feature_id": feature_id, "area": overlap_area})
        repaired = _polygonal(geometry.difference(land_union))
        if repaired.is_empty:
            raise GeometryConflictError("Land exclusion would remove a stable sea ID", diagnostics)
        result[index]["geometry"] = mapping(repaired)
    return result, diagnostics


def remove_processing_encroachments(features, source_surfaces_by_owner, *, allow_retire_helper=False):
    """Remove only processing additions in another owner's exclusive source.

    The caller supplies authoritative owner_tag values and affine/AOI source
    surfaces captured before snapping. Genuine source-source overlap remains for
    strict ownership reconciliation. No inference is made without an own source.
    """
    result = deepcopy(features)
    records = _records(result, land_only=True)
    sources = {}
    for owner, surface in sorted(source_surfaces_by_owner.items()):
        normalized_owner = str(owner).strip().upper()
        if surface is None or surface.is_empty:
            continue
        if not surface.is_valid or surface.geom_type not in ("Polygon", "MultiPolygon"):
            raise GeometryConflictError("Expected valid polygonal source surface", {"owner": normalized_owner})
        if not normalized_owner or normalized_owner in sources:
            raise GeometryConflictError("Missing or duplicate normalized source owner", {"owner": normalized_owner})
        sources[normalized_owner] = surface
    diagnostics = {"processing_encroachments": [], "missing_source_features": [],
                   "retired_helper_ids": [], "retired_features": []}
    retired_indexes = set()
    exclusive_others = {}
    for feature_id, index, owner, geometry in records:
        if not owner or owner not in sources:
            diagnostics["missing_source_features"].append({"feature_id": feature_id, "owner": owner,
                                                          "reason": "no_authoritative_own_source"})
            continue
        if owner not in exclusive_others:
            others = unary_union([source for other_owner, source in sources.items() if other_owner != owner])
            exclusive_others[owner] = others.difference(sources[owner])
        forbidden = exclusive_others[owner]
        if not geometry.intersects(forbidden):
            continue
        area = geometry.intersection(forbidden).area
        if area <= OVERLAP_AREA_EPSILON:
            continue
        repaired = _polygonal(geometry.difference(forbidden))
        diagnostics["processing_encroachments"].append({
            "feature_id": feature_id, "owner": owner, "removed_area": area,
            "source_policy": "other_owner_exclusive_pre_snap_source",
            "source_owners": [other_owner for other_owner, source in sources.items()
                              if other_owner != owner
                              and geometry.intersection(source.difference(sources[owner])).area > OVERLAP_AREA_EPSILON],
        })
        if repaired.is_empty:
            if allow_retire_helper and feature_id.startswith("ATLWLD_"):
                retired_indexes.add(index)
                diagnostics["retired_helper_ids"].append(feature_id)
                diagnostics["retired_features"].append({
                    "feature_id": feature_id, "owner": owner,
                    "reason": "generated_helper_entirely_in_other_owner_exclusive_source",
                    "source_policy": "other_owner_exclusive_pre_snap_source",
                })
                continue
            raise GeometryConflictError("Source encroachment repair would remove a stable land ID", diagnostics)
        result[index]["geometry"] = mapping(repaired)
    return [feature for index, feature in enumerate(result) if index not in retired_indexes], diagnostics
