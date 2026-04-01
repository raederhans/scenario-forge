from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
from shapely.geometry import GeometryCollection, MultiPoint, Point, shape
from topojson import Topology


ROOT = Path(__file__).resolve().parents[1]
SOURCE_CACHE_DIR = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "rail"
OFFICIAL_LINES_GEOJSON_PATH = SOURCE_CACHE_DIR / "N02-24_GML" / "UTF-8" / "N02-24_RailroadSection.geojson"
OFFICIAL_LINES_SHP_PATH = SOURCE_CACHE_DIR / "N02-24_GML" / "N02-24_RailroadSection.shp"
OFFICIAL_STATIONS_GEOJSON_PATH = SOURCE_CACHE_DIR / "N02-24_GML" / "UTF-8" / "N02-24_Station.geojson"
OFFICIAL_STATIONS_SHP_PATH = SOURCE_CACHE_DIR / "N02-24_GML" / "N02-24_Station.shp"
OSM_PATCH_PATH = SOURCE_CACHE_DIR / "osm_lifecycle_lines.geojson"
RECIPE_PATH = ROOT / "data" / "transport_layers" / "japan_rail" / "source_recipe.manual.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_rail"
OVERRIDE_DIR = OUTPUT_DIR / "overrides"
LINE_CLASS_OVERRIDE_PATH = OVERRIDE_DIR / "line_class_overrides.json"
MAJOR_STATION_OVERRIDE_PATH = OVERRIDE_DIR / "major_station_overrides.json"
RAILWAYS_TOPO_PATH = OUTPUT_DIR / "railways.topo.json"
RAILWAYS_PREVIEW_TOPO_PATH = OUTPUT_DIR / "railways.preview.topo.json"
MAJOR_STATIONS_PATH = OUTPUT_DIR / "rail_stations_major.geojson"
MAJOR_STATIONS_PREVIEW_PATH = OUTPUT_DIR / "rail_stations_major.preview.geojson"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
AUDIT_PATH = OUTPUT_DIR / "build_audit.json"
CARRIER_PATH = ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"
TOPO_PREQUANTIZE = 1_000_000
METRIC_CRS = "EPSG:3857"
PREVIEW_MIN_LENGTH_METERS = {
    "high_speed": 0.0,
    "trunk": 6_000.0,
    "branch": 12_000.0,
    "service": 18_000.0,
}
DEFAULT_LINE_CLASS_BY_RAIL_TYPE_CODE = {
    "11": "trunk",
    "12": "trunk",
    "13": "branch",
    "14": "branch",
    "15": "branch",
    "16": "branch",
    "17": "service",
    "21": "branch",
    "22": "branch",
    "23": "branch",
    "24": "branch",
    "25": "high_speed",
}
SHINKANSEN_RE = re.compile(r"(?:\u65b0\u5e79\u7dda|shinkansen)", re.IGNORECASE)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any, *, compact: bool = False) -> None:
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    path.write_text(text, encoding="utf-8")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_match_key(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text)
    return text.casefold()


def ensure_required_sources() -> None:
    missing = []
    if not RECIPE_PATH.exists():
        missing.append(RECIPE_PATH)
    if not OFFICIAL_LINES_GEOJSON_PATH.exists() and not OFFICIAL_LINES_SHP_PATH.exists():
        missing.append(OFFICIAL_LINES_GEOJSON_PATH)
    if not OFFICIAL_STATIONS_GEOJSON_PATH.exists() and not OFFICIAL_STATIONS_SHP_PATH.exists():
        missing.append(OFFICIAL_STATIONS_GEOJSON_PATH)
    if missing:
        joined = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
        raise SystemExit(f"Missing required Japan rail source inputs: {joined}")


def pick_official_source(preferred: Path, fallback: Path) -> tuple[Path, str]:
    if preferred.exists():
        return preferred, "utf-8"
    return fallback, "cp932"


def load_route_mask():
    carrier = read_json(CARRIER_PATH)
    route_mask = carrier.get("frames", {}).get("main", {}).get("routeMask")
    if not route_mask:
        raise SystemExit("Japan carrier routeMask is missing.")
    return shape(route_mask)


def read_official_lines(route_mask) -> tuple[gpd.GeoDataFrame, dict[str, Any]]:
    path, encoding = pick_official_source(OFFICIAL_LINES_GEOJSON_PATH, OFFICIAL_LINES_SHP_PATH)
    lines = gpd.read_file(path, encoding=encoding)
    lines = lines.set_crs("EPSG:4326") if lines.crs is None else lines.to_crs("EPSG:4326")
    lines = lines.loc[lines.geometry.notnull()].copy()
    lines = lines.loc[lines.geometry.intersects(route_mask)].copy()
    lines["geometry"] = lines.geometry.intersection(route_mask)
    lines = lines.loc[~lines.geometry.is_empty].copy()
    info = {
        "path": path,
        "encoding": encoding,
        "member": str(path.relative_to(ROOT)).replace("\\", "/"),
    }
    return lines, info


def read_official_stations(route_mask) -> tuple[gpd.GeoDataFrame, dict[str, Any]]:
    path, encoding = pick_official_source(OFFICIAL_STATIONS_GEOJSON_PATH, OFFICIAL_STATIONS_SHP_PATH)
    stations = gpd.read_file(path, encoding=encoding)
    stations = stations.set_crs("EPSG:4326") if stations.crs is None else stations.to_crs("EPSG:4326")
    stations = stations.loc[stations.geometry.notnull()].copy()
    stations = stations.loc[stations.geometry.intersects(route_mask)].copy()
    stations["geometry"] = stations.geometry.intersection(route_mask)
    stations = stations.loc[~stations.geometry.is_empty].copy()
    info = {
        "path": path,
        "encoding": encoding,
        "member": str(path.relative_to(ROOT)).replace("\\", "/"),
    }
    return stations, info


def load_optional_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    payload = read_json(path)
    return payload if isinstance(payload, dict) else {}


def normalize_override_class(value: Any) -> str:
    normalized = normalize_text(value)
    return normalized if normalized in {"high_speed", "trunk", "branch", "service"} else ""


def build_line_class_override_map(payload: dict[str, Any]) -> dict[str, str]:
    override_map: dict[str, str] = {}
    for source_key in ("line_class_by_name", "line_class_by_match_key"):
        source = payload.get(source_key)
        if not isinstance(source, dict):
            continue
        for key, value in source.items():
            normalized_key = normalize_match_key(key)
            normalized_class = normalize_override_class(value)
            if normalized_key and normalized_class:
                override_map[normalized_key] = normalized_class
    return override_map


def classify_line(name: str, rail_type_code: str, class_overrides: dict[str, str]) -> str:
    override = class_overrides.get(normalize_match_key(name), "")
    if override in {"high_speed", "trunk", "branch", "service"}:
        return override
    if SHINKANSEN_RE.search(name):
        return "high_speed"
    return DEFAULT_LINE_CLASS_BY_RAIL_TYPE_CODE.get(rail_type_code, "trunk")


def build_line_id(name: str, operator: str, geometry_wkb: bytes, index: int) -> str:
    digest = hashlib.sha1()
    digest.update(name.encode("utf-8"))
    digest.update(operator.encode("utf-8"))
    digest.update(geometry_wkb)
    digest.update(str(index).encode("ascii"))
    return f"jp-rail-{digest.hexdigest()[:12]}"


def build_station_id(name: str, group_code: str, station_code: str) -> str:
    digest = hashlib.sha1()
    digest.update(name.encode("utf-8"))
    digest.update(group_code.encode("utf-8"))
    digest.update(station_code.encode("utf-8"))
    return f"jp-station-{digest.hexdigest()[:12]}"


def normalize_lines(lines: gpd.GeoDataFrame, class_overrides: dict[str, str]) -> gpd.GeoDataFrame:
    lines = lines.copy()
    lines["rail_type_code"] = lines["N02_001"].map(normalize_text)
    lines["operator_type_code"] = lines["N02_002"].map(normalize_text)
    lines["name"] = lines["N02_003"].map(normalize_text)
    lines["operator"] = lines["N02_004"].map(normalize_text)
    lines = lines.loc[lines["name"] != ""].copy()
    lines["line_class"] = lines.apply(
        lambda row: classify_line(row["name"], row["rail_type_code"], class_overrides),
        axis=1,
    )
    lines["status"] = "active"
    lines["source"] = "official_jp"
    lines["source_flags"] = ""
    lines = lines.to_crs(METRIC_CRS)
    lines["length_m"] = lines.geometry.length.astype(float)
    lines = lines.to_crs("EPSG:4326")
    lines["id"] = [
        build_line_id(name, operator, geometry.wkb, index)
        for index, (name, operator, geometry) in enumerate(zip(lines["name"], lines["operator"], lines.geometry), start=1)
    ]
    return lines[[
        "id",
        "name",
        "operator",
        "rail_type_code",
        "operator_type_code",
        "line_class",
        "status",
        "source",
        "source_flags",
        "length_m",
        "geometry",
    ]]


def representative_point(geometry) -> Point:
    if isinstance(geometry, Point):
        return geometry
    if isinstance(geometry, MultiPoint):
        return geometry.representative_point()
    if isinstance(geometry, GeometryCollection):
        return geometry.representative_point()
    return geometry.representative_point()


def resolve_station_override(
    station_name: str,
    group_code: str,
    overrides_by_group_code: dict[str, Any],
    overrides_by_name: dict[str, Any],
) -> dict[str, Any] | None:
    override = overrides_by_group_code.get(group_code)
    if isinstance(override, dict):
        return override
    return overrides_by_name.get(normalize_match_key(station_name)) if station_name else None


def normalize_stations(stations: gpd.GeoDataFrame, station_overrides: dict[str, Any], lines: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    stations = stations.copy()
    stations["station_name"] = stations["N02_005"].map(normalize_text)
    stations["station_code"] = stations["N02_005c"].map(normalize_text)
    stations["group_code"] = stations["N02_005g"].map(normalize_text)
    stations["line_name"] = stations["N02_003"].map(normalize_text)
    stations = stations.loc[stations["station_name"] != ""].copy()
    if not station_overrides:
        return gpd.GeoDataFrame(
            columns=["id", "name", "city_key", "station_code", "group_code", "importance", "source", "linked_line_classes", "geometry"],
            crs="EPSG:4326",
        )
    overrides_by_group_code = station_overrides.get("stations_by_group_code", {}) if isinstance(station_overrides.get("stations_by_group_code"), dict) else {}
    overrides_by_name_source = station_overrides.get("stations_by_name", {}) if isinstance(station_overrides.get("stations_by_name"), dict) else {}
    overrides_by_name = {
        normalize_match_key(key): value
        for key, value in overrides_by_name_source.items()
        if normalize_match_key(key) and isinstance(value, dict)
    }
    lines_by_name = {
        normalize_match_key(row["name"]): row["line_class"]
        for _, row in lines.iterrows()
    }
    groups = []
    for group_key, group in stations.groupby(stations["group_code"].where(stations["group_code"] != "", stations["station_name"])):
        station_name = normalize_text(group["station_name"].iloc[0])
        normalized_group_key = normalize_text(group_key)
        override = resolve_station_override(station_name, normalized_group_key, overrides_by_group_code, overrides_by_name)
        if not isinstance(override, dict):
            continue
        union = group.geometry.union_all()
        point = representative_point(union)
        if point.is_empty:
            continue
        linked_classes = sorted({
            lines_by_name.get(normalize_match_key(line_name), "trunk")
            for line_name in group["line_name"].tolist()
            if normalize_text(line_name)
        })
        groups.append({
            "id": build_station_id(station_name, normalized_group_key, normalize_text(group["station_code"].iloc[0])),
            "name": station_name,
            "city_key": normalize_text(override.get("city_key") or station_name),
            "importance": normalize_text(override.get("importance") or "regional_core"),
            "source": "official_jp",
            "station_code": normalize_text(group["station_code"].iloc[0]),
            "group_code": normalized_group_key,
            "linked_line_classes": "|".join(linked_classes),
            "geometry": point,
        })
    return gpd.GeoDataFrame(groups, geometry="geometry", crs="EPSG:4326")


def count_station_override_entries(payload: dict[str, Any]) -> int:
    total = 0
    for key in ("stations_by_group_code", "stations_by_name"):
        source = payload.get(key)
        if isinstance(source, dict):
            total += sum(1 for value in source.values() if isinstance(value, dict))
    return total


def build_preview_lines(lines: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return lines.loc[
        lines.apply(
            lambda row: float(row["length_m"]) >= PREVIEW_MIN_LENGTH_METERS.get(str(row["line_class"]), 12_000.0),
            axis=1,
        )
    ].copy()


def topology_from_gdf(gdf: gpd.GeoDataFrame, object_name: str) -> dict[str, Any]:
    safe_gdf = gdf.copy()
    for column in safe_gdf.columns:
        if column == "geometry":
            continue
        safe_gdf[column] = safe_gdf[column].astype(object).where(pd.notna(safe_gdf[column]), None)
    topology = Topology(
        safe_gdf,
        object_name=object_name,
        topology=True,
        prequantize=TOPO_PREQUANTIZE,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=True,
    )
    return topology.to_dict()


def feature_collection_payload(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    return json.loads(gdf.to_json())


def main() -> None:
    ensure_required_sources()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    route_mask = load_route_mask()
    recipe = read_json(RECIPE_PATH)
    line_class_override_payload = load_optional_json(LINE_CLASS_OVERRIDE_PATH)
    station_override_payload = load_optional_json(MAJOR_STATION_OVERRIDE_PATH)
    class_overrides = build_line_class_override_map(line_class_override_payload)
    station_overrides = station_override_payload

    official_lines, official_lines_info = read_official_lines(route_mask)
    official_stations, official_stations_info = read_official_stations(route_mask)
    normalized_lines = normalize_lines(official_lines, class_overrides)
    major_stations = normalize_stations(official_stations, station_overrides, normalized_lines)
    preview_lines = build_preview_lines(normalized_lines)

    write_json(RAILWAYS_TOPO_PATH, topology_from_gdf(normalized_lines, "railways"), compact=True)
    write_json(RAILWAYS_PREVIEW_TOPO_PATH, topology_from_gdf(preview_lines, "railways"), compact=True)
    write_json(MAJOR_STATIONS_PATH, feature_collection_payload(major_stations), compact=False)
    write_json(MAJOR_STATIONS_PREVIEW_PATH, feature_collection_payload(major_stations), compact=False)

    source_signature = {
        "mlit_n02_2024_lines": {
            "filename": official_lines_info["path"].name,
            "size_bytes": official_lines_info["path"].stat().st_size,
            "sha256": file_sha256(official_lines_info["path"]),
        },
        "mlit_n02_2024_stations": {
            "filename": official_stations_info["path"].name,
            "size_bytes": official_stations_info["path"].stat().st_size,
            "sha256": file_sha256(official_stations_info["path"]),
        },
    }
    if OSM_PATCH_PATH.exists():
        source_signature["osm_japan_lifecycle_patch"] = {
            "filename": OSM_PATCH_PATH.name,
            "size_bytes": OSM_PATCH_PATH.stat().st_size,
            "sha256": file_sha256(OSM_PATCH_PATH),
        }
    if LINE_CLASS_OVERRIDE_PATH.exists():
        source_signature["line_class_overrides"] = {
            "filename": str(LINE_CLASS_OVERRIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
            "size_bytes": LINE_CLASS_OVERRIDE_PATH.stat().st_size,
            "sha256": file_sha256(LINE_CLASS_OVERRIDE_PATH),
        }
    if MAJOR_STATION_OVERRIDE_PATH.exists():
        source_signature["major_station_overrides"] = {
            "filename": str(MAJOR_STATION_OVERRIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
            "size_bytes": MAJOR_STATION_OVERRIDE_PATH.stat().st_size,
            "sha256": file_sha256(MAJOR_STATION_OVERRIDE_PATH),
        }

    manifest = {
        "adapter_id": "japan_rail_v1",
        "family": "rail",
        "geometry_kind": "line",
        "country": "Japan",
        "schema_version": 1,
        "generated_at": utc_now(),
        "recipe_path": "data/transport_layers/japan_rail/source_recipe.manual.json",
        "paths": {
            "preview": {
                "railways": "data/transport_layers/japan_rail/railways.preview.topo.json",
                "rail_stations_major": "data/transport_layers/japan_rail/rail_stations_major.preview.geojson",
            },
            "full": {
                "railways": "data/transport_layers/japan_rail/railways.topo.json",
                "rail_stations_major": "data/transport_layers/japan_rail/rail_stations_major.geojson",
            },
            "build_audit": "data/transport_layers/japan_rail/build_audit.json",
        },
        "source_signature": source_signature,
        "recipe_version": recipe.get("version", "japan_rail_sources_v1"),
        "feature_counts": {
            "preview": {
                "railways": int(len(preview_lines)),
                "rail_stations_major": int(len(major_stations)),
            },
            "full": {
                "railways": int(len(normalized_lines)),
                "rail_stations_major": int(len(major_stations)),
            },
        },
        "clip_bbox": list(route_mask.bounds),
        "build_command": "python tools/build_transport_workbench_japan_rail.py",
        "runtime_consumer": "transport_workbench_rail_preview",
        "source_policy": "local_source_cache_only",
        "official_lines_member": official_lines_info["member"],
        "official_lines_encoding": official_lines_info["encoding"],
        "official_stations_member": official_stations_info["member"],
        "official_stations_encoding": official_stations_info["encoding"],
        "override_paths": {
            "line_class_overrides": str(LINE_CLASS_OVERRIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
            "major_station_overrides": str(MAJOR_STATION_OVERRIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "source_fallback_encoding": "cp932",
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
    }
    audit = {
        "generated_at": utc_now(),
        "adapter_id": "japan_rail_v1",
        "raw_official_line_count": int(len(official_lines)),
        "raw_official_station_feature_count": int(len(official_stations)),
        "normalized_line_count": int(len(normalized_lines)),
        "preview_line_count": int(len(preview_lines)),
        "major_station_count": int(len(major_stations)),
        "line_class_counts": {
            line_class: int((normalized_lines["line_class"] == line_class).sum())
            for line_class in ("high_speed", "trunk", "branch", "service")
        },
        "line_class_override_count": int(len(class_overrides)),
        "major_station_override_count": int(count_station_override_entries(station_override_payload)),
        "osm_patch_present": OSM_PATCH_PATH.exists(),
        "recipe_version": recipe.get("version", "japan_rail_sources_v1"),
        "source_policy": "local_source_cache_only",
        "official_lines_member": official_lines_info["member"],
        "official_lines_encoding": official_lines_info["encoding"],
        "official_stations_member": official_stations_info["member"],
        "official_stations_encoding": official_stations_info["encoding"],
        "preview_thresholds_m": PREVIEW_MIN_LENGTH_METERS,
        "source_signature": source_signature,
        "override_paths": {
            "line_class_overrides": str(LINE_CLASS_OVERRIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
            "major_station_overrides": str(MAJOR_STATION_OVERRIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "notes": [
            "Official N02 lines are the active backbone for the first rail pack.",
            "Line classes use official rail-type codes first, then repo-versioned overrides for product-level corrections.",
            "Major stations are emitted only from repo-versioned major_station_overrides.json so the first pack never guesses importance silently.",
            "OSM lifecycle patch presence is recorded in the audit, but the first builder does not auto-merge that patch without an explicit local recipe step.",
        ],
    }
    write_json(MANIFEST_PATH, manifest, compact=False)
    write_json(AUDIT_PATH, audit, compact=False)
    print("Built Japan rail transport workbench packs.")


if __name__ == "__main__":
    main()
