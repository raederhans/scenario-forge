from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any

from map_builder.io.writers import write_json_atomic
from shapely import make_valid
from shapely.geometry import LineString, MultiLineString, mapping, shape
from shapely.ops import unary_union
from shapely.validation import explain_validity
from topojson.utils import serialize_as_geojson

DEFAULT_RENDER_BUDGET_HINTS = {
    "max_required_chunks": 6,
    "max_optional_chunks": 3,
    "detail_zoom_threshold": 1.7,
}

LOD_SPECS = (
    {"lod": "coarse", "cols": 1, "rows": 1, "min_zoom": 0.0, "max_zoom": 1.7, "global_coverage": True},
    {"lod": "detail", "cols": 4, "rows": 2, "min_zoom": 1.7, "max_zoom": 99.0, "global_coverage": False},
)

POLITICAL_COARSE_LOD_SPECS = (
    {"lod": "coarse", "cols": 1, "rows": 1, "min_zoom": 0.0, "max_zoom": 1.35, "global_coverage": True},
)

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, payload: Any) -> None:
    try:
        write_json_atomic(path, payload, ensure_ascii=False, indent=2, trailing_newline=True)
    except PermissionError as exc:
        raise PermissionError(
            f"Scenario chunk write is blocked for {path}. "
            "Stop any local dev server or browser tab serving this scenario, then retry the publish."
        ) from exc


def _write_minified_json(path: Path, payload: Any) -> None:
    try:
        write_json_atomic(
            path,
            payload,
            ensure_ascii=False,
            indent=None,
            separators=(",", ":"),
            trailing_newline=True,
        )
    except PermissionError as exc:
        raise PermissionError(
            f"Scenario chunk write is blocked for {path}. "
            "Stop any local dev server or browser tab serving this scenario, then retry the publish."
        ) from exc


def _normalize_relative_url(raw_url: Any) -> str:
    return str(raw_url or "").strip().replace("\\", "/")


def _feature_id(feature: dict[str, Any], fallback_index: int) -> str:
    value = feature.get("id")
    if value is None:
        value = (feature.get("properties") or {}).get("id")
    text = str(value or "").strip()
    return text or f"feature-{fallback_index}"


def _normalize_country_code(raw_value: Any) -> str:
    code = re.sub(r"[^A-Z]", "", str(raw_value or "").strip().upper())
    if not code or code in {"ZZ", "XX"}:
        return ""
    return code


def _extract_country_code_from_id(value: Any) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    prefix = re.split(r"[-_]", text)[0]
    match = re.match(r"^[A-Z]{2,3}", prefix)
    return match.group(0) if match else ""


def _feature_country_code(feature: dict[str, Any]) -> str:
    props = feature.get("properties") if isinstance(feature, dict) else {}
    feature_id = _feature_identity(feature, 0).strip().upper()
    if feature_id.startswith("ATLISL_") or feature_id.startswith("ATLSHL_"):
        return "ATL"
    candidates = (
        props.get("cntr_code") if isinstance(props, dict) else None,
        props.get("CNTR_CODE") if isinstance(props, dict) else None,
        props.get("iso_a2") if isinstance(props, dict) else None,
        props.get("ISO_A2") if isinstance(props, dict) else None,
        _extract_country_code_from_id(feature.get("id") if isinstance(feature, dict) else None),
    )
    for candidate in candidates:
        code = _normalize_country_code(candidate)
        if code:
            return code
    return ""


def _feature_properties(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature.get("properties") if isinstance(feature, dict) else None
    return props if isinstance(props, dict) else {}


def _feature_identity(feature: dict[str, Any], fallback_index: int = 0) -> str:
    props = _feature_properties(feature)
    preferred = str(props.get("id") or "").strip()
    return preferred or _feature_id(feature, fallback_index)


def _is_antarctic_sector_feature(feature: dict[str, Any]) -> bool:
    props = _feature_properties(feature)
    feature_id = _feature_identity(feature, 0).strip().upper()
    country_code = _feature_country_code(feature)
    detail_tier = str(props.get("detail_tier") or "").strip().lower()
    return detail_tier == "antarctic_sector" and (country_code == "AQ" or feature_id.startswith("AQ_"))


def _is_shell_helper_feature(feature: dict[str, Any]) -> bool:
    props = _feature_properties(feature)
    helper_kind = str(props.get("scenario_helper_kind") or "").strip().lower()
    feature_id = _feature_identity(feature, 0).strip().upper()
    name = str(props.get("name") or feature.get("name") or "").strip().lower()
    return helper_kind == "shell_fallback" or feature_id.startswith("RU_ARCTIC_FB_") or "shell fallback" in name


def _feature_atl_geometry_role(feature: dict[str, Any]) -> str:
    return str(_feature_properties(feature).get("atl_geometry_role") or "").strip().lower()


def _feature_atl_join_mode(feature: dict[str, Any]) -> str:
    return str(_feature_properties(feature).get("atl_join_mode") or "").strip().lower()


def _is_atlantropa_helper_feature(feature: dict[str, Any]) -> bool:
    feature_id = _feature_identity(feature, 0).strip().upper()
    if feature_id.startswith("ATLSHL_") or feature_id.startswith("ATLWLD_") or feature_id.startswith("ATLSEA_FILL_"):
        return True
    geometry_role = _feature_atl_geometry_role(feature)
    join_mode = _feature_atl_join_mode(feature)
    return (
        geometry_role in {"shore_seal", "sea_completion", "donor_sea"}
        or join_mode in {"gap_fill", "boolean_weld"}
    )


def _is_explicit_political_feature(feature: dict[str, Any]) -> bool:
    props = _feature_properties(feature)
    if props.get("render_as_base_geography") is True:
        return False
    if props.get("interactive") is False:
        return False
    if _is_antarctic_sector_feature(feature):
        return False
    if _is_shell_helper_feature(feature):
        return False
    if _is_atlantropa_helper_feature(feature):
        return False
    return True


def _iter_line_coords(geometry) -> list[list[list[float]]]:
    if geometry is None or geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        coords = [[float(x), float(y)] for x, y, *_rest in geometry.coords]
        return [coords] if len(coords) >= 2 else []
    if isinstance(geometry, MultiLineString):
        lines: list[list[list[float]]] = []
        for part in geometry.geoms:
            lines.extend(_iter_line_coords(part))
        return lines
    if hasattr(geometry, "geoms"):
        lines: list[list[list[float]]] = []
        for part in geometry.geoms:
            lines.extend(_iter_line_coords(part))
        return lines
    return []


def _build_opening_owner_border_mesh(
    runtime_topology_payload: dict[str, Any] | None,
    owners_by_feature_id: dict[str, Any] | None,
) -> dict[str, Any]:
    feature_collection = _topology_object_to_feature_collection(runtime_topology_payload, "political")
    if not isinstance(feature_collection, dict) or not isinstance(feature_collection.get("features"), list):
        return {"type": "MultiLineString", "coordinates": []}

    owners = owners_by_feature_id if isinstance(owners_by_feature_id, dict) else {}
    geometries_by_owner: dict[str, list[Any]] = defaultdict(list)
    for index, feature in enumerate(feature_collection.get("features") or []):
        if not isinstance(feature, dict) or not _is_explicit_political_feature(feature):
            continue
        feature_id = _feature_identity(feature, index)
        owner_tag = str(owners.get(feature_id) or "").strip().upper()
        if not owner_tag:
            continue
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        geom = shape(geometry_payload)
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = make_valid(geom)
        if geom.is_empty:
            continue
        geometries_by_owner[owner_tag].append(geom)

    owner_regions: list[tuple[str, Any]] = []
    for owner_tag in sorted(geometries_by_owner):
        geom = unary_union(geometries_by_owner[owner_tag])
        if not geom.is_valid:
            geom = make_valid(geom)
        if geom.is_empty:
            continue
        owner_regions.append((owner_tag, geom))

    line_coordinates: list[list[list[float]]] = []
    for index, (_owner_a, geom_a) in enumerate(owner_regions):
        min_ax, min_ay, max_ax, max_ay = geom_a.bounds
        for _owner_b, geom_b in owner_regions[index + 1:]:
            min_bx, min_by, max_bx, max_by = geom_b.bounds
            if max_ax < min_bx or max_bx < min_ax or max_ay < min_by or max_by < min_ay:
                continue
            shared_boundary = geom_a.intersection(geom_b)
            line_coordinates.extend(_iter_line_coords(shared_boundary))

    return {
        "type": "MultiLineString",
        "coordinates": line_coordinates,
    }


def _collect_coordinates(node: Any, sink: list[tuple[float, float]]) -> None:
    if isinstance(node, (list, tuple)):
        if len(node) >= 2 and all(isinstance(value, (int, float)) for value in node[:2]):
            sink.append((float(node[0]), float(node[1])))
            return
        for child in node:
            _collect_coordinates(child, sink)


def _feature_bounds(feature: dict[str, Any]) -> list[float]:
    coordinates: list[tuple[float, float]] = []
    _collect_coordinates((feature.get("geometry") or {}).get("coordinates"), coordinates)
    if not coordinates:
        return [-180.0, -90.0, 180.0, 90.0]
    longitudes = [coord[0] for coord in coordinates]
    latitudes = [coord[1] for coord in coordinates]
    return [
        max(-180.0, min(180.0, min(longitudes))),
        max(-90.0, min(90.0, min(latitudes))),
        max(-180.0, min(180.0, max(longitudes))),
        max(-90.0, min(90.0, max(latitudes))),
    ]


def _bounds_intersect(left: list[float], right: list[float]) -> bool:
    return not (
        left[2] < right[0]
        or right[2] < left[0]
        or left[3] < right[1]
        or right[3] < left[1]
    )


def _layer_payload_to_feature_collection(layer_key: str, payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not payload or not isinstance(payload, dict):
        return None
    if isinstance(payload.get("features"), list):
        return {
            "type": "FeatureCollection",
            "features": payload.get("features") or [],
        }
    if layer_key == "cities":
        feature_collection = payload.get("featureCollection")
        if isinstance(feature_collection, dict) and isinstance(feature_collection.get("features"), list):
            return {
                "type": "FeatureCollection",
                "features": feature_collection.get("features") or [],
            }
    return None


def _topology_object_to_feature_collection(topology_payload: dict[str, Any] | None, object_name: str) -> dict[str, Any] | None:
    if not isinstance(topology_payload, dict):
        return None
    objects = topology_payload.get("objects")
    if not isinstance(objects, dict) or object_name not in objects:
        return None
    feature_collection = serialize_as_geojson(topology_payload, objectname=object_name)
    if not isinstance(feature_collection, dict) or not isinstance(feature_collection.get("features"), list):
        return None
    return {
        "type": "FeatureCollection",
        "features": feature_collection.get("features") or [],
    }


def _sanitize_feature_collection_polygonal_geometries(feature_collection: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(feature_collection, dict) or not isinstance(feature_collection.get("features"), list):
        return feature_collection
    sanitized_features: list[dict[str, Any]] = []
    for feature in feature_collection.get("features") or []:
        if not isinstance(feature, dict):
            continue
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            sanitized_features.append(feature)
            continue
        geom = shape(geometry_payload)
        if geom.is_empty:
            sanitized_features.append(feature)
            continue
        if not geom.is_valid:
            try:
                geom = make_valid(geom)
            except Exception:
                sanitized_features.append(feature)
                continue
        sanitized_features.append({
            "type": "Feature",
            "id": feature.get("id"),
            "properties": dict(feature.get("properties") or {}),
            "geometry": mapping(geom),
        })
    return {
        "type": "FeatureCollection",
        "features": sanitized_features,
    }


def _slice_city_override_payload(payload: dict[str, Any], selected_feature_ids: set[str]) -> dict[str, Any]:
    original_feature_collection = payload.get("featureCollection") if isinstance(payload, dict) else None
    feature_collection = None
    if isinstance(original_feature_collection, dict) and isinstance(original_feature_collection.get("features"), list):
      feature_collection = {
          "type": "FeatureCollection",
          "features": [
              feature
              for index, feature in enumerate(original_feature_collection.get("features") or [])
              if _feature_id(feature, index) in selected_feature_ids
          ],
      }
    cities = payload.get("cities") if isinstance(payload, dict) and isinstance(payload.get("cities"), dict) else {}
    return {
        "type": "city_overrides",
        "version": int(payload.get("version") or 1) if isinstance(payload, dict) else 1,
        "scenario_id": str(payload.get("scenario_id") or "").strip() if isinstance(payload, dict) else "",
        "generated_at": str(payload.get("generated_at") or "").strip() if isinstance(payload, dict) else "",
        "cities": cities,
        "capitals_by_tag": payload.get("capitals_by_tag") if isinstance(payload.get("capitals_by_tag"), dict) else {},
        "capital_city_hints": payload.get("capital_city_hints") if isinstance(payload.get("capital_city_hints"), dict) else {},
        "audit": payload.get("audit") if isinstance(payload.get("audit"), dict) else None,
        "featureCollection": feature_collection,
    }


def _slice_layer_payload(layer_key: str, payload: dict[str, Any], selected_feature_ids: set[str]) -> dict[str, Any] | None:
    if layer_key == "cities":
        return _slice_city_override_payload(payload, selected_feature_ids)
    feature_collection = _layer_payload_to_feature_collection(layer_key, payload)
    if not feature_collection:
        return None
    return {
        "type": "FeatureCollection",
        "features": [
            feature
            for index, feature in enumerate(feature_collection.get("features") or [])
            if _feature_id(feature, index) in selected_feature_ids
        ],
    }


def _slice_feature_collection(feature_collection: dict[str, Any], selected_feature_ids: set[str]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            feature
            for index, feature in enumerate(feature_collection.get("features") or [])
            if _feature_id(feature, index) in selected_feature_ids
        ],
    }


def _round_geometry_coordinates(node: Any, *, decimals: int) -> Any:
    if isinstance(node, (int, float)):
        return round(float(node), decimals)
    if isinstance(node, list):
        return [_round_geometry_coordinates(item, decimals=decimals) for item in node]
    return node


def _round_feature_geometry(feature: dict[str, Any], *, decimals: int) -> dict[str, Any]:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return geometry
    rounded = dict(geometry)
    if "coordinates" in rounded:
        rounded["coordinates"] = _round_geometry_coordinates(rounded["coordinates"], decimals=decimals)
    return rounded


def _optimize_political_coarse_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("features"), list):
        return payload
    property_whitelist = (
        "id",
        "name",
        "cntr_code",
        "__source",
        "interactive",
        "detail_tier",
        "admin1_group",
        "render_as_base_geography",
        "scenario_helper_kind",
        "atl_geometry_role",
        "atl_join_mode",
    )
    optimized_features: list[dict[str, Any]] = []
    for feature in payload.get("features") or []:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        optimized_properties = {
            key: properties[key]
            for key in property_whitelist
            if key in properties and properties[key] not in (None, "")
        }
        optimized_features.append(
            {
                "type": "Feature",
                "properties": optimized_properties,
                "geometry": _round_feature_geometry(feature, decimals=4),
            }
        )
    return {
        "type": "FeatureCollection",
        "features": optimized_features,
    }


def _collect_feature_ids(feature_collection: dict[str, Any] | None) -> set[str]:
    if not isinstance(feature_collection, dict) or not isinstance(feature_collection.get("features"), list):
        return set()
    return {
        str(((feature.get("properties") or {}).get("id") if isinstance(feature, dict) else None) or _feature_id(feature, index)).strip()
        for index, feature in enumerate(feature_collection.get("features") or [])
        if str(((feature.get("properties") or {}).get("id") if isinstance(feature, dict) else None) or _feature_id(feature, index)).strip()
    }


def _collect_invalid_feature_geometries(
    feature_collection: dict[str, Any] | None,
    *,
    feature_ids: set[str] | None = None,
) -> list[str]:
    if not isinstance(feature_collection, dict) or not isinstance(feature_collection.get("features"), list):
        return []
    failures: list[str] = []
    for index, feature in enumerate(feature_collection.get("features") or []):
        if not isinstance(feature, dict):
            continue
        feature_id = _feature_id(feature, index)
        if feature_ids is not None and feature_id not in feature_ids:
            continue
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            failures.append(f"{feature_id}: empty geometry")
            continue
        geom = shape(geometry_payload)
        if geom.is_empty:
            failures.append(f"{feature_id}: empty geometry")
            continue
        if not geom.is_valid:
            failures.append(f"{feature_id}: {explain_validity(geom)}")
    return failures


def _collect_chunk_feature_ids(
    *,
    scenario_dir: Path,
    layer_key: str,
    chunks: list[dict[str, Any]],
) -> set[str]:
    feature_ids: set[str] = set()
    for chunk in chunks:
        if str(chunk.get("layer") or "").strip() != layer_key:
            continue
        raw_url = _normalize_relative_url(chunk.get("url"))
        if not raw_url:
            continue
        chunk_path = scenario_dir / "chunks" / Path(raw_url).name
        if not chunk_path.exists():
            raise FileNotFoundError(f"Expected chunk payload missing during validation: {chunk_path}")
        payload = json.loads(chunk_path.read_text(encoding="utf-8"))
        feature_collection = _layer_payload_to_feature_collection(layer_key, payload)
        if feature_collection is None:
            raise ValueError(f"Chunk payload for layer '{layer_key}' is not a feature collection: {chunk_path}")
        feature_ids.update(_collect_feature_ids(feature_collection))
    return feature_ids


def _validate_water_chunk_consistency(
    *,
    scenario_dir: Path,
    layer_payloads: dict[str, dict[str, Any] | None] | None,
    runtime_topology_payload: dict[str, Any] | None,
    all_chunks: list[dict[str, Any]],
    validation_feature_ids: set[str] | None = None,
) -> None:
    water_layer_payload = (layer_payloads or {}).get("water")
    runtime_water_feature_collection = _sanitize_feature_collection_polygonal_geometries(
        _topology_object_to_feature_collection(runtime_topology_payload, "scenario_water")
    )
    water_chunk_entries = [chunk for chunk in all_chunks if str(chunk.get("layer") or "").strip() == "water"]

    if water_layer_payload is None and runtime_water_feature_collection is None and not water_chunk_entries:
        return

    if water_layer_payload is None:
        raise ValueError("Water chunk validation requires layer_payloads['water'].")
    if runtime_water_feature_collection is None:
        raise ValueError("Water chunk validation requires runtime_topology_payload.objects['scenario_water'].")
    if not water_chunk_entries:
        raise ValueError("Water chunk validation requires at least one generated water chunk.")

    source_water_feature_collection = _layer_payload_to_feature_collection("water", water_layer_payload)
    if source_water_feature_collection is None:
        raise ValueError("Water chunk validation could not read a feature collection from layer_payloads['water'].")

    source_water_ids = _collect_feature_ids(source_water_feature_collection)
    runtime_water_ids = _collect_feature_ids(runtime_water_feature_collection)
    chunk_water_ids = _collect_chunk_feature_ids(
        scenario_dir=scenario_dir,
        layer_key="water",
        chunks=water_chunk_entries,
    )
    if source_water_ids != runtime_water_ids or source_water_ids != chunk_water_ids:
        raise ValueError(
            "Water region IDs drifted across publish artifacts: "
            f"source={len(source_water_ids)} runtime={len(runtime_water_ids)} chunks={len(chunk_water_ids)} "
            f"missing_in_runtime={sorted(source_water_ids - runtime_water_ids)} "
            f"missing_in_chunks={sorted(source_water_ids - chunk_water_ids)} "
            f"extra_in_runtime={sorted(runtime_water_ids - source_water_ids)} "
            f"extra_in_chunks={sorted(chunk_water_ids - source_water_ids)}"
        )
    source_invalid = _collect_invalid_feature_geometries(
        source_water_feature_collection,
        feature_ids=validation_feature_ids,
    )
    runtime_invalid = _collect_invalid_feature_geometries(
        runtime_water_feature_collection,
        feature_ids=validation_feature_ids,
    )
    chunk_invalid: list[str] = []
    for chunk in water_chunk_entries:
        raw_url = _normalize_relative_url(chunk.get("url"))
        if not raw_url:
            continue
        chunk_path = scenario_dir / "chunks" / Path(raw_url).name
        payload = json.loads(chunk_path.read_text(encoding="utf-8"))
        feature_collection = _layer_payload_to_feature_collection("water", payload)
        chunk_failures = _collect_invalid_feature_geometries(
            feature_collection,
            feature_ids=validation_feature_ids,
        )
        chunk_invalid.extend(f"{Path(raw_url).name}:{failure}" for failure in chunk_failures)
    if source_invalid or runtime_invalid or chunk_invalid:
        raise ValueError(
            "Water geometry validation failed across publish artifacts: "
            f"source_invalid={source_invalid[:12]} "
            f"runtime_invalid={runtime_invalid[:12]} "
            f"chunk_invalid={chunk_invalid[:12]}"
        )


def _build_chunk_payloads_for_feature_collection(
    *,
    scenario_id: str,
    scenario_dir: Path,
    layer_key: str,
    feature_collection: dict[str, Any] | None,
    payload_factory,
    chunk_specs: tuple[dict[str, Any], ...] = LOD_SPECS,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    if not feature_collection or not isinstance(feature_collection.get("features"), list) or not feature_collection["features"]:
        return [], {}

    chunks_dir = scenario_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    features = feature_collection.get("features") or []
    feature_bounds = [(_feature_id(feature, index), feature, _feature_bounds(feature)) for index, feature in enumerate(features)]
    manifest_chunks: list[dict[str, Any]] = []
    lod_entries: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for spec in chunk_specs:
        cols = int(spec["cols"])
        rows = int(spec["rows"])
        lon_step = 360.0 / cols
        lat_step = 180.0 / rows
        for row in range(rows):
            for col in range(cols):
                min_lon = -180.0 + (col * lon_step)
                max_lon = min(180.0, min_lon + lon_step)
                min_lat = -90.0 + (row * lat_step)
                max_lat = min(90.0, min_lat + lat_step)
                bounds = [min_lon, min_lat, max_lon, max_lat]
                selected_feature_ids = {
                    feature_id
                    for feature_id, _feature, candidate_bounds in feature_bounds
                    if spec["global_coverage"] or _bounds_intersect(bounds, candidate_bounds)
                }
                if not selected_feature_ids:
                    continue
                chunk_payload = payload_factory(selected_feature_ids)
                if not chunk_payload:
                    continue
                selected_features = [
                    feature
                    for index, feature in enumerate(features)
                    if _feature_id(feature, index) in selected_feature_ids
                ]
                chunk_country_codes = sorted({
                    country_code
                    for feature in selected_features
                    for country_code in [_feature_country_code(feature)]
                    if country_code
                })
                chunk_id = f"{layer_key}.{spec['lod']}.r{row}c{col}"
                chunk_filename = f"{chunk_id}.json"
                chunk_path = scenario_dir / "chunks" / chunk_filename
                if layer_key == "political" and spec["lod"] == "coarse":
                    chunk_payload = _optimize_political_coarse_payload(chunk_payload)
                    _write_minified_json(chunk_path, chunk_payload)
                elif layer_key == "water" and spec["lod"] == "coarse":
                    _write_minified_json(chunk_path, chunk_payload)
                else:
                    _write_json(chunk_path, chunk_payload)
                manifest_chunks.append({
                    "id": chunk_id,
                    "layer": layer_key,
                    "lod": spec["lod"],
                    "url": f"data/scenarios/{scenario_id}/chunks/{chunk_filename}",
                    "min_zoom": spec["min_zoom"],
                    "max_zoom": spec["max_zoom"],
                    "bounds": bounds,
                    "priority": 100 if layer_key == "political" and spec["lod"] == "coarse" else (90 if layer_key == "political" else (1 if spec["lod"] == "coarse" else 2)),
                    "feature_count": len(selected_feature_ids),
                    "data_format": "geojson",
                    "global_coverage": bool(spec["global_coverage"]),
                    "country_codes": chunk_country_codes,
                })
                lod_entries[layer_key].append({
                    "lod": spec["lod"],
                    "min_zoom": spec["min_zoom"],
                    "max_zoom": spec["max_zoom"],
                    "chunk_ids": [chunk_id],
                })
    return manifest_chunks, lod_entries


def _build_chunk_payloads_for_layer(
    *,
    scenario_id: str,
    scenario_dir: Path,
    layer_key: str,
    payload: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    feature_collection = _layer_payload_to_feature_collection(layer_key, payload)
    return _build_chunk_payloads_for_feature_collection(
        scenario_id=scenario_id,
        scenario_dir=scenario_dir,
        layer_key=layer_key,
        feature_collection=feature_collection,
        payload_factory=lambda selected_feature_ids: _slice_layer_payload(layer_key, payload, selected_feature_ids),
        chunk_specs=LOD_SPECS,
    )


def _build_political_chunk_payloads(
    *,
    scenario_id: str,
    scenario_dir: Path,
    startup_topology_payload: dict[str, Any] | None,
    runtime_topology_payload: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    all_chunks: list[dict[str, Any]] = []
    lod_layers: dict[str, list[dict[str, Any]]] = defaultdict(list)

    startup_feature_collection = _topology_object_to_feature_collection(startup_topology_payload, "political")
    runtime_feature_collection = _topology_object_to_feature_collection(runtime_topology_payload, "political")
    coarse_feature_collection = startup_feature_collection or runtime_feature_collection
    if coarse_feature_collection:
        chunks, lod_entries = _build_chunk_payloads_for_feature_collection(
            scenario_id=scenario_id,
            scenario_dir=scenario_dir,
            layer_key="political",
            feature_collection=coarse_feature_collection,
            payload_factory=lambda selected_feature_ids: _slice_feature_collection(coarse_feature_collection, selected_feature_ids),
            chunk_specs=POLITICAL_COARSE_LOD_SPECS,
        )
        all_chunks.extend(chunks)
        for lod_layer_key, entries in lod_entries.items():
            lod_layers[lod_layer_key].extend(entries)

    if runtime_feature_collection:
        chunks_dir = scenario_dir / "chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)
        feature_groups: dict[str, list[tuple[str, dict[str, Any], list[float]]]] = defaultdict(list)
        for index, feature in enumerate(runtime_feature_collection.get("features") or []):
            feature_id = _feature_id(feature, index)
            country_code = _feature_country_code(feature) or "misc"
            feature_groups[country_code].append((feature_id, feature, _feature_bounds(feature)))
        for country_code, entries in sorted(feature_groups.items()):
            if not entries:
                continue
            selected_feature_ids = {feature_id for feature_id, _feature, _bounds in entries}
            bounds = [
                min(entry_bounds[0] for _feature_id, _feature, entry_bounds in entries),
                min(entry_bounds[1] for _feature_id, _feature, entry_bounds in entries),
                max(entry_bounds[2] for _feature_id, _feature, entry_bounds in entries),
                max(entry_bounds[3] for _feature_id, _feature, entry_bounds in entries),
            ]
            chunk_payload = _slice_feature_collection(runtime_feature_collection, selected_feature_ids)
            chunk_id = f"political.detail.country.{country_code.lower()}"
            chunk_filename = f"{chunk_id}.json"
            _write_json(chunks_dir / chunk_filename, chunk_payload)
            all_chunks.append({
                "id": chunk_id,
                "layer": "political",
                "lod": "detail",
                "url": f"data/scenarios/{scenario_id}/chunks/{chunk_filename}",
                "min_zoom": 1.35,
                "max_zoom": 99.0,
                "bounds": bounds,
                "priority": 95,
                "feature_count": len(selected_feature_ids),
                "data_format": "geojson",
                "global_coverage": False,
                "country_codes": [country_code] if country_code != "misc" else [],
            })
            lod_layers["political"].append({
                "lod": "detail",
                "min_zoom": 1.35,
                "max_zoom": 99.0,
                "chunk_ids": [chunk_id],
            })

    return all_chunks, lod_layers


def build_and_write_scenario_chunk_assets(
    *,
    scenario_dir: Path,
    manifest_payload: dict[str, Any],
    layer_payloads: dict[str, dict[str, Any] | None] | None = None,
    startup_topology_payload: dict[str, Any] | None = None,
    runtime_topology_payload: dict[str, Any] | None = None,
    startup_topology_url: str = "",
    runtime_topology_url: str = "",
    generated_at: str = "",
    default_startup_topology_url: str = "",
    water_validation_feature_ids: set[str] | None = None,
) -> dict[str, Any]:
    scenario_dir = scenario_dir.resolve()
    scenario_id = str(manifest_payload.get("scenario_id") or scenario_dir.name).strip()
    if not scenario_id:
        raise ValueError("scenario_id is required to build scenario chunk assets.")

    generated_at = generated_at or str(manifest_payload.get("generated_at") or "").strip() or _utc_now()
    startup_topology_url = _normalize_relative_url(startup_topology_url) or _normalize_relative_url(default_startup_topology_url)
    runtime_topology_url = _normalize_relative_url(runtime_topology_url) or _normalize_relative_url(manifest_payload.get("runtime_topology_url"))

    all_chunks: list[dict[str, Any]] = []
    lod_layers: dict[str, list[dict[str, Any]]] = defaultdict(list)
    political_chunks, political_lod_entries = _build_political_chunk_payloads(
        scenario_id=scenario_id,
        scenario_dir=scenario_dir,
        startup_topology_payload=startup_topology_payload,
        runtime_topology_payload=runtime_topology_payload,
    )
    all_chunks.extend(political_chunks)
    for lod_layer_key, entries in political_lod_entries.items():
        lod_layers[lod_layer_key].extend(entries)
    for layer_key, payload in (layer_payloads or {}).items():
        chunks, lod_entries = _build_chunk_payloads_for_layer(
            scenario_id=scenario_id,
            scenario_dir=scenario_dir,
            layer_key=str(layer_key).strip().lower(),
            payload=payload or {},
        )
        all_chunks.extend(chunks)
        for lod_layer_key, entries in lod_entries.items():
            lod_layers[lod_layer_key].extend(entries)

    detail_chunk_manifest = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": generated_at,
        "chunks": all_chunks,
    }
    context_lod_manifest = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": generated_at,
        "layers": lod_layers,
    }
    runtime_meta_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": generated_at,
        "startup_topology_url": startup_topology_url,
        "runtime_topology_url": runtime_topology_url,
        "political_chunk_count": len([chunk for chunk in all_chunks if chunk.get("layer") == "political"]),
        "total_chunk_count": len(all_chunks),
        "runtime_topology_object_names": sorted((runtime_topology_payload or {}).get("objects", {}).keys()) if isinstance(runtime_topology_payload, dict) else [],
        "runtime_topology_object_count": len((runtime_topology_payload or {}).get("objects", {})) if isinstance(runtime_topology_payload, dict) else 0,
    }
    owners_payload_path = scenario_dir / "owners.by_feature.json"
    owners_by_feature_id = {}
    if owners_payload_path.exists():
        owners_payload = json.loads(owners_payload_path.read_text(encoding="utf-8"))
        if isinstance(owners_payload, dict) and isinstance(owners_payload.get("owners"), dict):
            owners_by_feature_id = owners_payload["owners"]
    opening_owner_borders = _build_opening_owner_border_mesh(
        runtime_topology_payload,
        owners_by_feature_id,
    )
    mesh_pack_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": generated_at,
        "coastline_source": "runtime_topology" if runtime_topology_url else "",
        "mesh_summary": {
            "runtime_topology_url": runtime_topology_url,
            "startup_topology_url": startup_topology_url,
        },
        "meshes": {
            "opening_owner_borders": opening_owner_borders,
        },
    }

    detail_chunk_manifest_path = scenario_dir / "detail_chunks.manifest.json"
    context_lod_manifest_path = scenario_dir / "context_lod.manifest.json"
    runtime_meta_path = scenario_dir / "runtime_meta.json"
    mesh_pack_path = scenario_dir / "mesh_pack.json"

    _write_json(detail_chunk_manifest_path, detail_chunk_manifest)
    _write_json(context_lod_manifest_path, context_lod_manifest)
    _write_json(runtime_meta_path, runtime_meta_payload)
    _write_json(mesh_pack_path, mesh_pack_payload)

    _validate_water_chunk_consistency(
        scenario_dir=scenario_dir,
        layer_payloads=layer_payloads,
        runtime_topology_payload=runtime_topology_payload,
        all_chunks=all_chunks,
        validation_feature_ids=water_validation_feature_ids,
    )

    manifest_payload["startup_topology_url"] = startup_topology_url
    manifest_payload["detail_chunk_manifest_url"] = f"data/scenarios/{scenario_id}/detail_chunks.manifest.json"
    manifest_payload["runtime_meta_url"] = f"data/scenarios/{scenario_id}/runtime_meta.json"
    manifest_payload["mesh_pack_url"] = f"data/scenarios/{scenario_id}/mesh_pack.json"
    manifest_payload["context_lod_manifest"] = f"data/scenarios/{scenario_id}/context_lod.manifest.json"
    manifest_payload["render_budget_hints"] = {
        **DEFAULT_RENDER_BUDGET_HINTS,
        **(manifest_payload.get("render_budget_hints") if isinstance(manifest_payload.get("render_budget_hints"), dict) else {}),
    }

    return {
        "detail_chunk_manifest": detail_chunk_manifest,
        "context_lod_manifest": context_lod_manifest,
        "runtime_meta": runtime_meta_payload,
        "mesh_pack": mesh_pack_payload,
    }
