from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import Point, shape

from map_builder.transport_workbench_contracts import finalize_transport_manifest


ROOT = Path(__file__).resolve().parents[1]
SOURCE_CACHE_DIR = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "airport"
AIRPORTS_GEOJSON_PATH = SOURCE_CACHE_DIR / "C28-21_GML" / "UTF-8" / "C28-21_Airport.geojson"
REFERENCE_GEOJSON_PATH = SOURCE_CACHE_DIR / "C28-21_GML" / "UTF-8" / "C28-21_AirportReferencePoint.geojson"
SURVEY_GEOJSON_PATH = SOURCE_CACHE_DIR / "C28-21_GML" / "UTF-8" / "C28-21_SurveyContent.geojson"
RECIPE_PATH = ROOT / "data" / "transport_layers" / "japan_airport" / "source_recipe.manual.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_airport"
FULL_OUTPUT_PATH = OUTPUT_DIR / "airports.geojson"
PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "airports.preview.geojson"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
AUDIT_PATH = OUTPUT_DIR / "build_audit.json"
CARRIER_PATH = ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"

AIRPORT_TYPE_MAP = {
    "1": {"slug": "company_managed", "label": "会社管理空港", "importance": "national_core", "importance_rank": 3},
    "2": {"slug": "national", "label": "国管理空港", "importance": "national_core", "importance_rank": 3},
    "3": {"slug": "specific_local", "label": "特定地方管理空港", "importance": "regional_core", "importance_rank": 2},
    "4": {"slug": "local", "label": "地方管理空港", "importance": "regional_core", "importance_rank": 2},
    "5": {"slug": "other", "label": "その他空港", "importance": "local_connector", "importance_rank": 1},
    "6": {"slug": "shared", "label": "共用空港", "importance": "national_core", "importance_rank": 3},
}
OWNER_TYPE_MAP = {
    "1": "国土交通省",
    "2": "防衛省",
    "3": "地方公共団体",
    "4": "成田国際空港株式会社",
    "5": "その他",
    "6": "国土交通省・防衛省共用",
}
STATUS_CATEGORY_MAP = {
    "供用中": "active",
    "休止中": "paused",
}
PREVIEW_IMPORTANCE = {"national_core", "regional_core"}


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


def ensure_required_sources() -> None:
    missing = [
        path
        for path in (RECIPE_PATH, AIRPORTS_GEOJSON_PATH, REFERENCE_GEOJSON_PATH, SURVEY_GEOJSON_PATH, CARRIER_PATH)
        if not path.exists()
    ]
    if not missing:
        return
    joined = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
    raise SystemExit(f"Missing required Japan airport source inputs: {joined}")


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_match_key(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text)
    return text.casefold()


def parse_reference_ids(value: Any) -> list[str]:
    text = normalize_text(value)
    if not text:
        return []
    return [
        part.lstrip("#")
        for part in text.split(",")
        if part and part.lstrip("#")
    ]


def parse_int(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def build_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha1()
    for part in parts:
        digest.update(part.encode("utf-8"))
    return f"{prefix}-{digest.hexdigest()[:12]}"


def feature_collection_payload(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    return json.loads(gdf.to_json(drop_id=True))


def load_route_mask():
    carrier = read_json(CARRIER_PATH)
    route_mask = carrier.get("frames", {}).get("main", {}).get("routeMask")
    if not route_mask:
        raise SystemExit("Japan carrier routeMask is missing.")
    return shape(route_mask)


def read_geojson(path: Path, route_mask = None, *, require_points: bool = False) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(path, encoding="utf-8")
    gdf = gdf.set_crs("EPSG:4326") if gdf.crs is None else gdf.to_crs("EPSG:4326")
    if "geometry" in gdf.columns:
        gdf = gdf.loc[gdf.geometry.notnull()].copy()
        if route_mask is not None:
            gdf = gdf.loc[gdf.geometry.intersects(route_mask)].copy()
            gdf["geometry"] = gdf.geometry.intersection(route_mask)
            gdf = gdf.loc[~gdf.geometry.is_empty].copy()
        if require_points:
            gdf = gdf.loc[gdf.geometry.geom_type == "Point"].copy()
    return gdf


def build_reference_map(reference_points: gpd.GeoDataFrame) -> dict[str, Point]:
    mapping: dict[str, Point] = {}
    for row in reference_points.itertuples(index=False):
        key = normalize_text(getattr(row, "C28_000", ""))
        geom = getattr(row, "geometry", None)
        if not key or not isinstance(geom, Point) or geom.is_empty:
            continue
        mapping[key] = geom
    return mapping


def build_latest_survey_map(surveys: gpd.GeoDataFrame) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    for row in surveys.itertuples(index=False):
        survey_id = normalize_text(getattr(row, "C28_000", ""))
        if not survey_id:
            continue
        year = parse_int(getattr(row, "C28_014", None))
        current = entries.get(survey_id)
        if current and (current.get("survey_year") or 0) >= (year or 0):
            continue
        entries[survey_id] = {
            "survey_year": year,
            "landings_per_day": parse_int(getattr(row, "C28_015", None)),
            "passengers_per_day": parse_int(getattr(row, "C28_016", None)),
        }
    return entries


def normalize_airports(
    airports: gpd.GeoDataFrame,
    reference_map: dict[str, Point],
    survey_map: dict[str, dict[str, Any]],
) -> gpd.GeoDataFrame:
    rows: list[dict[str, Any]] = []
    missing_reference: list[str] = []
    for row in airports.itertuples(index=False):
        name = normalize_text(getattr(row, "C28_005", ""))
        admin_code = normalize_text(getattr(row, "C28_001", ""))
        ref_id = next(iter(parse_reference_ids(getattr(row, "C28_101", ""))), "")
        geometry = reference_map.get(ref_id)
        if geometry is None or geometry.is_empty:
            missing_reference.append(name or admin_code or ref_id or "unknown")
            continue
        type_code = normalize_text(getattr(row, "C28_003", ""))
        type_meta = AIRPORT_TYPE_MAP.get(type_code, {
            "slug": f"unknown_{type_code or 'missing'}",
            "label": normalize_text(type_code) or "不明",
            "importance": "local_connector",
            "importance_rank": 1,
        })
        survey_ids = parse_reference_ids(getattr(row, "C28_103", ""))
        survey_candidates = [survey_map[survey_id] for survey_id in survey_ids if survey_id in survey_map]
        latest_survey = max(
            survey_candidates,
            key=lambda entry: int(entry.get("survey_year") or 0),
            default={},
        )
        stable_key = f"airport::{normalize_match_key(name)}::{admin_code or ref_id}"
        rows.append({
            "id": build_id("jp-airport", stable_key, ref_id),
            "stable_key": stable_key,
            "name": name,
            "name_match_key": normalize_match_key(name),
            "facility_type": "airport",
            "category": type_meta["slug"],
            "importance": type_meta["importance"],
            "importance_rank": type_meta["importance_rank"],
            "source_dataset": "mlit_c28_2021",
            "source_year": 2021,
            "admin_code": admin_code,
            "airport_type": type_meta["slug"],
            "airport_type_code": type_code,
            "airport_type_label": type_meta["label"],
            "owner": OWNER_TYPE_MAP.get(normalize_text(getattr(row, "C28_006", "")), ""),
            "owner_code": normalize_text(getattr(row, "C28_006", "")),
            "manager": OWNER_TYPE_MAP.get(normalize_text(getattr(row, "C28_007", "")), ""),
            "manager_code": normalize_text(getattr(row, "C28_007", "")),
            "status": normalize_text(getattr(row, "C28_004", "")),
            "status_category": STATUS_CATEGORY_MAP.get(normalize_text(getattr(row, "C28_004", "")), "unknown"),
            "legal_designation": normalize_text(getattr(row, "C28_008", "")),
            "operation_start": normalize_text(getattr(row, "C28_009", "")),
            "operation_end": normalize_text(getattr(row, "C28_010", "")),
            "scheduled_service_code": normalize_text(getattr(row, "C28_011", "")),
            "runway_length_m_max": parse_int(getattr(row, "C28_012", None)),
            "runway_width_m_max": parse_int(getattr(row, "C28_013", None)),
            "survey_year_latest": latest_survey.get("survey_year"),
            "landings_per_day_latest": latest_survey.get("landings_per_day"),
            "passengers_per_day_latest": latest_survey.get("passengers_per_day"),
            "iata": "",
            "icao": "",
            "geometry": geometry,
        })
    if missing_reference:
        sample = ", ".join(missing_reference[:6])
        raise SystemExit(
            "Airport reference points are missing for "
            f"{len(missing_reference)} airport features. Sample: {sample}"
        )
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def build_preview_airports(airports: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return airports.loc[airports["importance"].isin(PREVIEW_IMPORTANCE)].copy()


def main() -> None:
    ensure_required_sources()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    route_mask = load_route_mask()
    recipe = read_json(RECIPE_PATH)

    airports = read_geojson(AIRPORTS_GEOJSON_PATH)
    reference_points = read_geojson(REFERENCE_GEOJSON_PATH, require_points=True)
    surveys = gpd.read_file(SURVEY_GEOJSON_PATH, encoding="utf-8")

    normalized_all = normalize_airports(
        airports,
        build_reference_map(reference_points),
        build_latest_survey_map(surveys),
    )
    normalized = normalized_all.loc[normalized_all.geometry.intersects(route_mask)].copy()
    preview = build_preview_airports(normalized)

    write_json(FULL_OUTPUT_PATH, feature_collection_payload(normalized), compact=False)
    write_json(PREVIEW_OUTPUT_PATH, feature_collection_payload(preview), compact=False)

    source_signature = {
        "mlit_c28_2021_airports": {
            "filename": AIRPORTS_GEOJSON_PATH.name,
            "size_bytes": AIRPORTS_GEOJSON_PATH.stat().st_size,
            "sha256": file_sha256(AIRPORTS_GEOJSON_PATH),
        },
        "mlit_c28_2021_reference_points": {
            "filename": REFERENCE_GEOJSON_PATH.name,
            "size_bytes": REFERENCE_GEOJSON_PATH.stat().st_size,
            "sha256": file_sha256(REFERENCE_GEOJSON_PATH),
        },
        "mlit_c28_2021_survey_content": {
            "filename": SURVEY_GEOJSON_PATH.name,
            "size_bytes": SURVEY_GEOJSON_PATH.stat().st_size,
            "sha256": file_sha256(SURVEY_GEOJSON_PATH),
        },
    }
    manifest = {
        "adapter_id": "japan_airport_v1",
        "family": "airport",
        "geometry_kind": "point",
        "country": "Japan",
        "schema_version": 1,
        "generated_at": utc_now(),
        "recipe_path": str(RECIPE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "distribution_tier": "single_pack",
        "paths": {
            "preview": {
                "airports": str(PREVIEW_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "full": {
                "airports": str(FULL_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "build_audit": str(AUDIT_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "source_signature": source_signature,
        "recipe_version": recipe.get("version", "japan_airport_sources_v1"),
        "feature_counts": {
            "preview": {
                "airports": int(len(preview)),
            },
            "full": {
                "airports": int(len(normalized)),
            },
        },
        "clip_bbox": [round(value, 6) for value in route_mask.bounds],
        "build_command": "python tools/build_transport_workbench_japan_airports.py",
        "runtime_consumer": "transport_workbench_airport_preview",
        "source_policy": "local_source_cache_only",
        "official_airport_member": "UTF-8/C28-21_Airport.geojson",
        "official_reference_member": "UTF-8/C28-21_AirportReferencePoint.geojson",
        "official_survey_member": "UTF-8/C28-21_SurveyContent.geojson",
        "official_encoding": "utf-8",
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
        "scope_policy": "japan_corridor_main_islands",
    }
    manifest = finalize_transport_manifest(
        manifest,
        default_variant="default",
        variants={
            "default": {
                "label": "default",
                "distribution_tier": manifest["distribution_tier"],
                "paths": manifest["paths"],
                "feature_counts": manifest["feature_counts"],
            }
        },
    )
    audit = {
        "generated_at": utc_now(),
        "adapter_id": "japan_airport_v1",
        "raw_airport_feature_count": int(len(airports)),
        "raw_reference_point_count": int(len(reference_points)),
        "normalized_airport_count": int(len(normalized)),
        "normalized_airport_count_before_scope_clip": int(len(normalized_all)),
        "preview_airport_count": int(len(preview)),
        "airport_type_counts": {
            key: int((normalized["airport_type_code"] == key).sum())
            for key in AIRPORT_TYPE_MAP.keys()
        },
        "importance_counts": {
            level: int((normalized["importance"] == level).sum())
            for level in ("national_core", "regional_core", "local_connector")
        },
        "scheduled_service_code_counts": {
            code: int((normalized["scheduled_service_code"] == code).sum())
            for code in sorted(set(normalized["scheduled_service_code"].tolist()))
            if code
        },
        "latest_survey_attached_count": int(normalized["survey_year_latest"].notna().sum()),
        "recipe_version": recipe.get("version", "japan_airport_sources_v1"),
        "source_policy": "local_source_cache_only",
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
        "source_signature": source_signature,
        "notes": [
            "Airport geometry is anchored to the official airport reference point layer, not polygon centroids.",
            "Airport preview keeps national_core and regional_core facilities only so the first carrier view stays readable.",
            "IATA and ICAO stay blank because the official C28 source does not provide them in this build chain.",
        ],
    }
    write_json(MANIFEST_PATH, manifest, compact=False)
    write_json(AUDIT_PATH, audit, compact=False)
    print("Built Japan airport transport workbench packs.")


if __name__ == "__main__":
    main()
