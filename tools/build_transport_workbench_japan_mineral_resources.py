from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import Point, shape


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ARCHIVE_PATH = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "mineral_resources" / "GSJ_DOC_INR_073_2017_DATA.zip"
SOURCE_MEMBER = "GSJ_DOC_INR_073_2017_DATA/mine_jp.csv"
RECIPE_PATH = ROOT / "data" / "transport_layers" / "japan_mineral_resources" / "source_recipe.manual.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_mineral_resources"
OVERRIDE_PATH = OUTPUT_DIR / "overrides" / "resource_class_overrides.json"
FULL_OUTPUT_PATH = OUTPUT_DIR / "mineral_resources.geojson"
PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "mineral_resources.preview.geojson"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
AUDIT_PATH = OUTPUT_DIR / "build_audit.json"
CARRIER_PATH = ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"

RESOURCE_GROUP_LABELS = {
    "precious_metals": "Precious metals",
    "base_metals": "Base metals",
    "ferrous_metals": "Ferrous and alloy metals",
    "fossil_resources": "Fossil resources",
    "industrial_minerals": "Industrial minerals",
    "construction_materials": "Construction materials",
    "other_resources": "Other resources",
}


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
    missing = [path for path in (SOURCE_ARCHIVE_PATH, RECIPE_PATH) if not path.exists()]
    if missing:
        joined = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
        raise SystemExit(f"Missing required Japan mineral source inputs: {joined}")


def load_route_mask():
    carrier = read_json(CARRIER_PATH)
    route_mask = carrier.get("frames", {}).get("main", {}).get("routeMask")
    if not route_mask:
        raise SystemExit("Japan carrier routeMask is missing.")
    return shape(route_mask)


def load_resource_class_overrides() -> dict[str, str]:
    if not OVERRIDE_PATH.exists():
        return {}
    payload = read_json(OVERRIDE_PATH)
    source = payload.get("legend_name_normalization")
    if not isinstance(source, dict):
        return {}
    overrides: dict[str, str] = {}
    for key, value in source.items():
        left = normalize_text(key)
        right = normalize_text(value)
        if left and right:
            overrides[left] = right
    return overrides


def read_source_rows() -> list[dict[str, str]]:
    with zipfile.ZipFile(SOURCE_ARCHIVE_PATH) as archive:
        try:
            raw_bytes = archive.read(SOURCE_MEMBER)
        except KeyError as exc:
            raise SystemExit(f"Missing mineral source member in archive: {SOURCE_MEMBER}") from exc
    decoded = raw_bytes.decode("cp932")
    reader = csv.DictReader(io.StringIO(decoded))
    return [{key: normalize_text(value) for key, value in row.items()} for row in reader]


def derive_resource_group(resource_type: str, resource_type_code: str, resource_class: str) -> str:
    code = normalize_match_key(resource_type_code)
    text = normalize_match_key(resource_type)
    resource_class_key = normalize_match_key(resource_class)

    if any(token in text for token in ("石油", "ガス", "石炭", "亜炭")) or code in {"oil", "gas", "c", "l"}:
        return "fossil_resources"
    if any(token in text for token in ("金", "銀")) or any(token in code for token in ("au", "ag")):
        return "precious_metals"
    if any(token in text for token in ("銅", "鉛", "亜鉛", "錫", "水銀", "モリブデン", "アンチモン", "リチウム", "タングステン")):
        return "base_metals"
    if any(token in code for token in ("cu", "pb", "zn", "hg", "mo", "sb", "li", "w")):
        return "base_metals"
    if any(token in text for token in ("鉄", "マンガン", "クロム", "ニッケル", "コバルト", "チタン", "バナジウム")):
        return "ferrous_metals"
    if any(token in code for token in ("fe", "mn", "cr", "ni", "co", "ti", "v")):
        return "ferrous_metals"
    if any(token in text for token in ("石灰石", "砂岩", "砂利", "砕石", "砂", "ドロマイト")):
        return "construction_materials"
    if code in {"ls", "ps", "pc", "pp", "tc", "py", "pyh"}:
        return "construction_materials"
    if any(token in text for token in ("粘土", "耐火粘土", "珪石", "長石", "石こう", "硫黄", "滑石", "珪砂", "ベントナイト", "陶石")):
        return "industrial_minerals"
    if code in {"cl", "rc", "fd", "si", "s"}:
        return "industrial_minerals"
    if "試錐" in resource_class_key or "試掘" in resource_class_key:
        return "fossil_resources"
    return "other_resources"


def normalize_row(row: dict[str, str], resource_class_overrides: dict[str, str]) -> dict[str, Any] | None:
    lat = row.get("lat", "")
    lon = row.get("lon", "")
    if not lat or not lon:
        return None
    try:
        latitude = float(lat)
        longitude = float(lon)
    except ValueError:
        return None
    resource_class_raw = row.get("legend_name", "")
    resource_class = resource_class_overrides.get(resource_class_raw, resource_class_raw)
    mine_name = row.get("mine_name", "")
    resource_type = row.get("mineral_j", "")
    resource_type_code = row.get("mineral", "")
    normalized_resource_group = derive_resource_group(resource_type, resource_type_code, resource_class)
    display_name = mine_name or resource_class or resource_type or resource_type_code
    if not display_name:
        return None
    point = Point(longitude, latitude)
    return {
        "id": f"jp-mineral-{row.get('id', '')}",
        "name": display_name,
        "resource_type": resource_type,
        "resource_type_code": resource_type_code,
        "resource_class": resource_class,
        "normalized_resource_group": normalized_resource_group,
        "normalized_resource_group_label": RESOURCE_GROUP_LABELS[normalized_resource_group],
        "work_status": row.get("work_status", ""),
        "map_name": row.get("map_name", ""),
        "map_pub_year": row.get("map_pub_year", ""),
        "map_publisher": row.get("map_publisher", ""),
        "map_uri": row.get("map_uri", ""),
        "source": "gsj_mine_distribution_2017",
        "match_key": normalize_match_key(display_name),
        "geometry": point,
    }


def feature_collection_payload(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    return json.loads(gdf.to_json())


def main() -> None:
    ensure_required_sources()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    recipe = read_json(RECIPE_PATH)
    route_mask = load_route_mask()
    resource_class_overrides = load_resource_class_overrides()
    raw_rows = read_source_rows()

    normalized_records = []
    invalid_row_count = 0
    excluded_outside_mask_count = 0
    for row in raw_rows:
        normalized = normalize_row(row, resource_class_overrides)
        if not normalized:
            invalid_row_count += 1
            continue
        if not normalized["geometry"].intersects(route_mask):
            excluded_outside_mask_count += 1
            continue
        normalized_records.append(normalized)

    if not normalized_records:
        raise SystemExit("No mineral resource features remained after normalization and four-islands clipping.")

    minerals = gpd.GeoDataFrame(normalized_records, geometry="geometry", crs="EPSG:4326")

    write_json(FULL_OUTPUT_PATH, feature_collection_payload(minerals), compact=False)
    write_json(PREVIEW_OUTPUT_PATH, feature_collection_payload(minerals), compact=False)

    source_signature = {
        "gsj_mine_distribution_2017": {
            "filename": SOURCE_ARCHIVE_PATH.name,
            "size_bytes": SOURCE_ARCHIVE_PATH.stat().st_size,
            "sha256": file_sha256(SOURCE_ARCHIVE_PATH),
            "member": SOURCE_MEMBER,
        }
    }
    if OVERRIDE_PATH.exists():
        source_signature["resource_class_overrides"] = {
            "filename": str(OVERRIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
            "size_bytes": OVERRIDE_PATH.stat().st_size,
            "sha256": file_sha256(OVERRIDE_PATH),
        }

    manifest = {
        "adapter_id": "japan_mineral_resources_v1",
        "family": "mineral_resources",
        "geometry_kind": "point",
        "country": "Japan",
        "schema_version": 2,
        "generated_at": utc_now(),
        "recipe_path": str(RECIPE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "paths": {
            "preview": {
                "mineral_resources": str(PREVIEW_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "full": {
                "mineral_resources": str(FULL_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "build_audit": str(AUDIT_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "source_signature": source_signature,
        "recipe_version": recipe.get("version", "japan_mineral_resources_sources_v1"),
        "feature_counts": {
            "preview": {
                "mineral_resources": int(len(minerals)),
            },
            "full": {
                "mineral_resources": int(len(minerals)),
            },
        },
        "clip_bbox": [round(value, 6) for value in route_mask.bounds],
        "build_command": "python tools/build_transport_workbench_japan_mineral_resources.py",
        "runtime_consumer": "transport_workbench_manifest_preview",
        "distribution_tier": "public_candidate",
        "license_tier": "review_required",
        "coverage_scope": "japan_main_islands_v1",
        "source_policy": "local_source_cache_only",
        "source_member": SOURCE_MEMBER,
        "source_encoding": "cp932",
        "source_url": "https://www.gsj.jp/data/interim-report/GSJ_DOC_INR_073_2017_DATA.zip",
        "excluded_regions": [
            "outside_japan_main_islands_route_mask"
        ],
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "source_fallback_encoding": "cp932",
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
        "taxonomy_contract": {
            "primary_group_field": "normalized_resource_group",
            "primary_group_label_field": "normalized_resource_group_label",
            "source_type_field": "resource_type",
            "source_type_code_field": "resource_type_code",
        },
    }
    audit = {
        "generated_at": utc_now(),
        "adapter_id": "japan_mineral_resources_v1",
        "recipe_version": recipe.get("version", "japan_mineral_resources_sources_v1"),
        "raw_row_count": int(len(raw_rows)),
        "invalid_row_count": int(invalid_row_count),
        "excluded_outside_mask_count": int(excluded_outside_mask_count),
        "normalized_feature_count": int(len(minerals)),
        "resource_class_override_count": int(len(resource_class_overrides)),
        "resource_type_count": int(minerals["resource_type"].astype(str).nunique()),
        "resource_class_count": int(minerals["resource_class"].astype(str).nunique()),
        "normalized_resource_group_count": int(minerals["normalized_resource_group"].astype(str).nunique()),
        "normalized_resource_group_counts": {
            group_id: int((minerals["normalized_resource_group"] == group_id).sum())
            for group_id in RESOURCE_GROUP_LABELS.keys()
            if int((minerals["normalized_resource_group"] == group_id).sum()) > 0
        },
        "source_policy": "local_source_cache_only",
        "source_member": SOURCE_MEMBER,
        "source_encoding": "cp932",
        "source_url": "https://www.gsj.jp/data/interim-report/GSJ_DOC_INR_073_2017_DATA.zip",
        "excluded_regions": [
            {
                "rule": "outside_japan_main_islands_route_mask",
                "count": int(excluded_outside_mask_count),
            }
        ],
        "source_signature": source_signature,
        "notes": [
            "The first mineral resource pack uses the GSJ mine distribution CSV exactly as supplied in the local source cache.",
            "Preview and full outputs are identical for v1 because no stable importance model has been approved yet.",
            "Historical resource-class spellings are only normalized through the repo-versioned override file.",
            "normalized_resource_group is a stable display taxonomy layer added on top of the original resource_type and resource_type_code fields.",
        ],
    }
    write_json(MANIFEST_PATH, manifest, compact=False)
    write_json(AUDIT_PATH, audit, compact=False)
    print("Built Japan mineral resource transport workbench pack.")


if __name__ == "__main__":
    main()
