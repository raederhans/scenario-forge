"""D3 spherical-geometry preparation and validation helpers."""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import Iterable

import geopandas as gpd
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping
from map_builder.geo.water_geometry import compile_water_feature_collection


PROJECT_ROOT = Path(__file__).resolve().parents[2]
D3_VENDOR_PATH = PROJECT_ROOT / "vendor" / "d3.v7.min.js"
TOPOJSON_VENDOR_PATH = PROJECT_ROOT / "vendor" / "topojson-client.min.js"
PRIMARY_POLAR_WATER_IDS = frozenset({
    "marine_arctic_ocean",
    "marine_southern_ocean",
})
POLAR_COVERAGE_LOSS_RATIO_MAX = 0.0001
NODE_VALIDATION_TIMEOUT_SECONDS = 15


def _iter_polygon_parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    if isinstance(geometry, GeometryCollection):
        return [part for child in geometry.geoms for part in _iter_polygon_parts(child)]
    return []


def _split_polar_longitude_bands(geometry):
    # Retain the valid source surface, including its pole and antimeridian.
    # Linear samples avoid great-circle shortcuts without epsilon gaps or
    # mutually touching MultiPolygons created by artificial longitude bands.
    from shapely.geometry import shape
    compiled = compile_water_feature_collection({
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {}, "geometry": mapping(geometry)}],
    })
    return shape(compiled["features"][0]["geometry"])


def prepare_primary_polar_water_regions(
    water_regions: gpd.GeoDataFrame,
    *,
    target_ids: Iterable[str] = PRIMARY_POLAR_WATER_IDS,
) -> gpd.GeoDataFrame:
    """Rewind the primary polar-water shells while preserving rows and coverage."""
    if water_regions is None or water_regions.empty:
        return water_regions
    if "id" not in water_regions.columns:
        raise ValueError("Polar water spherical preparation requires an id column.")

    targets = {str(feature_id).strip() for feature_id in target_ids if str(feature_id).strip()}
    result = water_regions.copy()
    ids = result["id"].fillna("").astype(str).str.strip()
    duplicate_targets = sorted(feature_id for feature_id in targets if int((ids == feature_id).sum()) > 1)
    if duplicate_targets:
        raise ValueError(f"Polar water ids must be unique: {duplicate_targets}")

    for index in result.index[ids.isin(targets)]:
        geometry = result.at[index, "geometry"]
        if geometry is None or geometry.is_empty or not isinstance(geometry, (Polygon, MultiPolygon)):
            feature_id = str(result.at[index, "id"]).strip()
            raise ValueError(f"Polar water '{feature_id}' has empty or non-polygonal geometry.")
        oriented = _split_polar_longitude_bands(geometry)
        if oriented is None or oriented.is_empty or not oriented.is_valid:
            feature_id = str(result.at[index, "id"]).strip()
            raise ValueError(f"Polar water '{feature_id}' collapsed during D3 spherical preparation.")
        source_area = float(geometry.area)
        coverage_loss_ratio = max(0.0, source_area - float(oriented.area)) / source_area
        if coverage_loss_ratio > POLAR_COVERAGE_LOSS_RATIO_MAX:
            feature_id = str(result.at[index, "id"]).strip()
            raise ValueError(
                f"Polar water '{feature_id}' lost excessive coverage during D3 spherical preparation: "
                f"ratio={coverage_loss_ratio:.9f}."
            )
        result.at[index, "geometry"] = oriented
    return result


def _feature_collection_from_gdf(gdf: gpd.GeoDataFrame, target_ids: set[str]) -> dict:
    features = []
    ids = gdf["id"].fillna("").astype(str).str.strip()
    for index in gdf.index[ids.isin(target_ids)]:
        row = gdf.loc[index]
        properties = {column: row[column] for column in gdf.columns if column != "geometry"}
        features.append({
            "type": "Feature",
            "id": str(row["id"]).strip(),
            "properties": properties,
            "geometry": mapping(row.geometry),
        })
    return {"type": "FeatureCollection", "features": features}


def _collect_d3_spherical_diagnostics(
    feature_collection: dict,
    *,
    stage_label: str,
) -> list[dict]:
    if not D3_VENDOR_PATH.exists():
        raise RuntimeError(f"D3 spherical validator dependency is missing: {D3_VENDOR_PATH}")
    script = r"""
const fs = require("fs");
const vm = require("vm");
const collection = JSON.parse(fs.readFileSync(0, "utf8"));
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(process.argv[1], "utf8"), sandbox);
const d3 = sandbox.d3;
function isWorldBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 2
    && Math.abs(Number(bounds[0][0]) + 180) < 1e-9
    && Math.abs(Number(bounds[0][1]) + 90) < 1e-9
    && Math.abs(Number(bounds[1][0]) - 180) < 1e-9
    && Math.abs(Number(bounds[1][1]) - 90) < 1e-9;
}
function polygonParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry];
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).map((coordinates) => ({ type: "Polygon", coordinates }));
  }
  return [];
}
const rows = [];
for (const feature of collection.features || []) {
  const id = String(feature?.properties?.id || feature?.id || "").trim();
  const objects = [{ partIndex: null, geometry: feature.geometry }]
    .concat(polygonParts(feature.geometry).map((geometry, partIndex) => ({ partIndex, geometry })));
  for (const object of objects) {
    let area = NaN;
    let bounds = null;
    let error = "";
    try {
      area = Number(d3.geoArea(object.geometry));
      bounds = d3.geoBounds(object.geometry);
    } catch (caught) {
      error = String(caught?.message || caught);
    }
    rows.push({ id, partIndex: object.partIndex, area, bounds, worldBounds: isWorldBounds(bounds), error });
  }
}
process.stdout.write(JSON.stringify(rows));
"""
    try:
        completed = subprocess.run(
            ["node", "-e", script, str(D3_VENDOR_PATH)],
            input=json.dumps(feature_collection, default=str),
            text=True,
            encoding="utf-8",
            capture_output=True,
            cwd=PROJECT_ROOT,
            check=False,
            timeout=NODE_VALIDATION_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"D3 spherical diagnostics timed out at {stage_label} after "
            f"{NODE_VALIDATION_TIMEOUT_SECONDS}s."
        ) from exc
    except OSError as exc:
        raise RuntimeError(
            f"D3 spherical diagnostics could not start Node at {stage_label}: {exc}"
        ) from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or f"exit {completed.returncode}"
        raise RuntimeError(f"D3 spherical validator failed: {detail}")
    try:
        rows = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise RuntimeError("D3 spherical validator returned invalid JSON.") from exc
    return rows if isinstance(rows, list) else []


def validate_primary_polar_water_feature_collection(
    feature_collection: dict,
    *,
    expected_ids: Iterable[str] = PRIMARY_POLAR_WATER_IDS,
    require_all: bool,
    stage_label: str,
) -> None:
    expected = {str(feature_id).strip() for feature_id in expected_ids if str(feature_id).strip()}
    features = feature_collection.get("features", []) if isinstance(feature_collection, dict) else []
    ids = [
        str((feature.get("properties") or {}).get("id") or feature.get("id") or "").strip()
        for feature in features
        if isinstance(feature, dict)
    ]
    selected = [feature for feature, feature_id in zip(features, ids) if feature_id in expected]
    selected_ids = [feature_id for feature_id in ids if feature_id in expected]
    failures = []
    if len(selected_ids) != len(set(selected_ids)):
        failures.append("duplicate ids")
    if require_all and set(selected_ids) != expected:
        failures.append(f"expected ids={sorted(expected)} actual ids={sorted(set(selected_ids))}")
    if not selected:
        if failures:
            raise ValueError(f"Polar water spherical validation failed at {stage_label}: " + "; ".join(failures))
        return

    diagnostics = _collect_d3_spherical_diagnostics(
        {"type": "FeatureCollection", "features": selected},
        stage_label=stage_label,
    )
    for row in diagnostics:
        area = row.get("area")
        if row.get("error") or not isinstance(area, (int, float)) or not math.isfinite(float(area)) or float(area) <= 0:
            failures.append(f"{row.get('id')}: invalid area")
        elif float(area) > math.pi * 2:
            failures.append(f"{row.get('id')}: excessive spherical area={float(area):.9f}")
        if row.get("worldBounds"):
            failures.append(f"{row.get('id')}: world bounds")
    if failures:
        raise ValueError(f"Polar water spherical validation failed at {stage_label}: " + "; ".join(failures))


def validate_primary_polar_water_gdf(
    water_regions: gpd.GeoDataFrame,
    *,
    require_all: bool,
    stage_label: str,
) -> None:
    if water_regions is None or water_regions.empty:
        if require_all:
            raise ValueError(f"Polar water spherical validation failed at {stage_label}: empty layer")
        return
    feature_collection = _feature_collection_from_gdf(water_regions, set(PRIMARY_POLAR_WATER_IDS))
    validate_primary_polar_water_feature_collection(
        feature_collection,
        require_all=require_all,
        stage_label=stage_label,
    )


def validate_primary_polar_water_topology(
    topology_payload: dict,
    *,
    object_name: str = "water_regions",
    require_all: bool,
    stage_label: str,
) -> None:
    feature_collection = _topology_feature_collection(topology_payload, object_name, stage_label)
    validate_primary_polar_water_feature_collection(
        feature_collection,
        require_all=require_all,
        stage_label=stage_label,
    )


def _topology_feature_collection(topology_payload: dict, object_name: str, stage_label: str) -> dict:
    if not TOPOJSON_VENDOR_PATH.exists():
        raise RuntimeError(f"TopoJSON spherical validator dependency is missing: {TOPOJSON_VENDOR_PATH}")
    script = r"""
const fs = require("fs");
const vm = require("vm");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(process.argv[1], "utf8"), sandbox);
const object = input.topology?.objects?.[input.objectName];
if (!object) throw new Error(`missing topology object ${input.objectName}`);
process.stdout.write(JSON.stringify(sandbox.topojson.feature(input.topology, object)));
"""
    try:
        completed = subprocess.run(
            ["node", "-e", script, str(TOPOJSON_VENDOR_PATH)],
            input=json.dumps({"topology": topology_payload, "objectName": object_name}, default=str),
            text=True,
            encoding="utf-8",
            capture_output=True,
            cwd=PROJECT_ROOT,
            check=False,
            timeout=NODE_VALIDATION_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"TopoJSON round-trip decoding timed out at {stage_label} after "
            f"{NODE_VALIDATION_TIMEOUT_SECONDS}s for object '{object_name}'."
        ) from exc
    except OSError as exc:
        raise RuntimeError(
            f"TopoJSON round-trip decoding could not start Node at {stage_label} "
            f"for object '{object_name}': {exc}"
        ) from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or f"exit {completed.returncode}"
        raise ValueError(f"Polar water topology round-trip failed at {stage_label}: {detail}")
    try:
        feature_collection = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Polar water topology round-trip failed at {stage_label}: invalid JSON") from exc
    return feature_collection


def _reverse_topology_ring_refs(ring_refs):
    if not isinstance(ring_refs, list) or not all(isinstance(arc_ref, int) for arc_ref in ring_refs):
        return ring_refs
    return [~arc_ref for arc_ref in reversed(ring_refs)]


def repair_primary_polar_water_topology_orientation(
    topology_payload: dict,
    *,
    object_name: str = "water_regions",
) -> int:
    """Reverse target TopoJSON ring traversal after encoders that flip winding."""
    object_payload = (topology_payload.get("objects") or {}).get(object_name)
    geometries = object_payload.get("geometries") if isinstance(object_payload, dict) else None
    if not isinstance(geometries, list):
        return 0
    feature_collection = _topology_feature_collection(
        topology_payload,
        object_name,
        "primary_topology.orientation_probe",
    )
    invalid_part_indexes_by_id: dict[str, set[int]] = {}
    for row in _collect_d3_spherical_diagnostics(
        feature_collection,
        stage_label="primary_topology.orientation_probe",
    ):
        part_index = row.get("partIndex")
        area = row.get("area")
        invalid = (
            row.get("worldBounds")
            or row.get("error")
            or not isinstance(area, (int, float))
            or not math.isfinite(float(area))
            or float(area) <= 0
            or float(area) > math.pi * 2
        )
        if invalid and isinstance(part_index, int):
            invalid_part_indexes_by_id.setdefault(str(row.get("id") or ""), set()).add(part_index)
    modified_part_count = 0
    for geometry in geometries:
        if not isinstance(geometry, dict):
            continue
        properties = geometry.get("properties") or {}
        feature_id = str(properties.get("id") or geometry.get("id") or "").strip()
        if feature_id not in PRIMARY_POLAR_WATER_IDS:
            continue
        geometry_type = str(geometry.get("type") or "")
        arcs = geometry.get("arcs")
        invalid_part_indexes = invalid_part_indexes_by_id.get(feature_id, set())
        if geometry_type == "Polygon" and isinstance(arcs, list) and 0 in invalid_part_indexes:
            geometry["arcs"] = [_reverse_topology_ring_refs(ring_refs) for ring_refs in arcs]
            modified_part_count += 1
        elif geometry_type == "MultiPolygon" and isinstance(arcs, list):
            repaired_polygons = []
            for polygon_index, polygon_refs in enumerate(arcs):
                if not isinstance(polygon_refs, list):
                    repaired_polygons.append(polygon_refs)
                    continue
                if polygon_index in invalid_part_indexes:
                    polygon_refs = [_reverse_topology_ring_refs(ring_refs) for ring_refs in polygon_refs]
                    modified_part_count += 1
                repaired_polygons.append(polygon_refs)
            geometry["arcs"] = repaired_polygons
    return modified_part_count
