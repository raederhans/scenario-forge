from __future__ import annotations

import hashlib
import json
import re
import time
import unicodedata
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

from map_builder.transport_workbench_contracts import finalize_transport_manifest


ROOT = Path(__file__).resolve().parents[1]
RECIPE_PATH = ROOT / "data" / "transport_layers" / "japan_logistics_hubs" / "source_recipe.manual.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_logistics_hubs"
FULL_OUTPUT_PATH = OUTPUT_DIR / "logistics_hubs.geojson"
PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "logistics_hubs.preview.geojson"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
AUDIT_PATH = OUTPUT_DIR / "build_audit.json"
CARRIER_PATH = ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"
SOURCE_CACHE_DIR = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "logistics_hubs"
ARCHIVE_DIR = SOURCE_CACHE_DIR / "P31"
EXTRACT_DIR = SOURCE_CACHE_DIR / "_extract"
PREFECTURE_CODES = [f"{code:02d}" for code in range(1, 47)]
SOURCE_BASE_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/P31/P31-13"
HUB_TYPE_MAP = {
    "1": "container_terminal",
    "2": "air_cargo_terminal",
    "3": "rail_cargo_station",
    "4": "bonded_area",
    "5": "truck_terminal",
    "6": "warehouse",
    "7": "wholesale_market",
}
HUB_CLASSIFICATION_MAP = {
    "11": "foreign_trade_container_terminal",
    "14": "ferry_ro_ro_terminal",
    "21": "core_airport",
    "23": "local_managed_airport",
    "24": "other_airport",
    "26": "other_air_transport_node",
    "31": "general_freight_station",
    "32": "temporary_or_transfer_freight_station",
    "33": "off_rail_station",
    "42": "bonded_warehouse",
    "51": "general_truck_terminal",
    "52": "carrier_dedicated_truck_terminal",
    "61": "general_warehouse_class_1",
    "62": "general_warehouse_class_2",
    "63": "general_warehouse_class_3",
    "64": "open_yard_warehouse",
    "65": "water_surface_warehouse",
    "66": "tank_warehouse",
    "67": "dangerous_goods_warehouse_building",
    "68": "dangerous_goods_warehouse_tank",
    "71": "central_wholesale_market",
    "72": "local_wholesale_market",
}
OPERATOR_CLASS_MAP = {
    "1": "public",
    "2": "private",
    "3": "other",
}
DOWNLOAD_ATTEMPTS = 4
RETRYABLE_HTTP_STATUS = {500, 502, 503, 504}
DOWNLOAD_HEADERS = {
    "User-Agent": "mapcreator/1.0 (+https://github.com/openai/codex)",
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


def parse_int(value: Any) -> int | None:
    text = normalize_text(value)
    if not text or text in {"0", "0.0"}:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def parse_float(value: Any) -> float | None:
    text = normalize_text(value)
    if not text or text in {"0", "0.0"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def build_id(*parts: str) -> str:
    digest = hashlib.sha1()
    for part in parts:
        digest.update(part.encode("utf-8"))
    return f"jp-logistics-{digest.hexdigest()[:12]}"


def ensure_required_inputs() -> None:
    missing = [path for path in (RECIPE_PATH, CARRIER_PATH) if not path.exists()]
    if missing:
        joined = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
        raise SystemExit(f"Missing required Japan logistics hub inputs: {joined}")


def ensure_download(url: str, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers=DOWNLOAD_HEADERS)
    temp_path = destination.with_suffix(f"{destination.suffix}.part")
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response, temp_path.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
            for replace_attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
                try:
                    temp_path.replace(destination)
                    break
                except PermissionError:
                    if replace_attempt >= DOWNLOAD_ATTEMPTS:
                        raise
                    time.sleep(0.75 * replace_attempt)
            return
        except urllib.error.HTTPError as error:
            if temp_path.exists():
                temp_path.unlink()
            if error.code not in RETRYABLE_HTTP_STATUS or attempt >= DOWNLOAD_ATTEMPTS:
                raise
            time.sleep(1.5 * attempt)
        except urllib.error.URLError:
            if temp_path.exists():
                temp_path.unlink()
            if attempt >= DOWNLOAD_ATTEMPTS:
                raise
            time.sleep(1.5 * attempt)


def ensure_extracted_archive(archive_path: Path, extract_root: Path, *, prefecture_code: str) -> Path:
    shp_path = extract_root / f"P31-13_{prefecture_code}" / f"P31-13_{prefecture_code}_e.shp"
    if shp_path.exists():
        return shp_path
    extract_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(extract_root)
    if not shp_path.exists():
        raise SystemExit(f"Missing extracted P31 shapefile for prefecture {prefecture_code}: {shp_path.relative_to(ROOT)}")
    return shp_path


def load_route_mask():
    carrier = read_json(CARRIER_PATH)
    route_mask = carrier.get("frames", {}).get("main", {}).get("routeMask")
    if not route_mask:
        raise SystemExit("Japan carrier routeMask is missing.")
    return shape(route_mask)


def feature_collection_payload(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    return json.loads(gdf.to_json(drop_id=True))


def normalize_logistics_hubs(route_mask) -> tuple[gpd.GeoDataFrame, dict[str, int], dict[str, int], dict[str, dict[str, Any]]]:
    frames = []
    raw_counts: dict[str, int] = {}
    clipped_counts: dict[str, int] = {}
    source_signature: dict[str, dict[str, Any]] = {}
    for prefecture_code in PREFECTURE_CODES:
        filename = f"P31-13_{prefecture_code}.zip"
        archive_path = ARCHIVE_DIR / filename
        source_url = f"{SOURCE_BASE_URL}/{filename}"
        ensure_download(source_url, archive_path)
        shp_path = ensure_extracted_archive(archive_path, EXTRACT_DIR / prefecture_code, prefecture_code=prefecture_code)
        gdf = gpd.read_file(shp_path, encoding="cp932")
        gdf = gdf.set_crs("EPSG:4326") if gdf.crs is None else gdf.to_crs("EPSG:4326")
        gdf = gdf.loc[gdf.geometry.notnull()].copy()
        raw_counts[prefecture_code] = int(len(gdf))
        gdf = gdf.loc[gdf.geometry.geom_type == "Point"].copy()
        gdf = gdf.loc[gdf.geometry.intersects(route_mask)].copy()
        gdf["geometry"] = gdf.geometry.intersection(route_mask)
        gdf = gdf.loc[~gdf.geometry.is_empty].copy()
        clipped_counts[prefecture_code] = int(len(gdf))
        source_signature[prefecture_code] = {
            "filename": filename,
            "size_bytes": archive_path.stat().st_size,
            "sha256": file_sha256(archive_path),
        }
        if gdf.empty:
            continue
        rows = []
        for row in gdf.itertuples(index=False):
            name = normalize_text(getattr(row, "P31_001", ""))
            hub_type_code = normalize_text(getattr(row, "P31_002", ""))
            classification_code = normalize_text(getattr(row, "P31_003", ""))
            address = normalize_text(getattr(row, "P31_005", ""))
            rows.append({
                "id": build_id(filename, name, hub_type_code, classification_code, address),
                "name": name,
                "match_key": normalize_match_key(name),
                "hub_type_code": hub_type_code,
                "hub_type": HUB_TYPE_MAP.get(hub_type_code, "unknown"),
                "classification_code": classification_code,
                "classification_label": HUB_CLASSIFICATION_MAP.get(classification_code, ""),
                "prefecture_code": normalize_text(getattr(row, "P31_004", "")),
                "address": address,
                "operator_classification_code": normalize_text(getattr(row, "P31_006", "")),
                "operator_classification": OPERATOR_CLASS_MAP.get(normalize_text(getattr(row, "P31_006", "")), ""),
                "maintenance_year": parse_int(getattr(row, "P31_007", "")),
                "size_value": parse_float(getattr(row, "P31_008", "")),
                "remarks": normalize_text(getattr(row, "P31_009", "")),
                "source_dataset": "mlit_p31_2013",
                "source_member": filename,
                "geometry": getattr(row, "geometry"),
            })
        frames.append(gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326"))
    if not frames:
        raise SystemExit("No logistics hub features remained after source ingestion and clipping.")
    combined = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs="EPSG:4326")
    return combined, raw_counts, clipped_counts, source_signature


def main() -> None:
    ensure_required_inputs()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    recipe = read_json(RECIPE_PATH)
    route_mask = load_route_mask()
    hubs, raw_counts, clipped_counts, source_signature = normalize_logistics_hubs(route_mask)

    write_json(FULL_OUTPUT_PATH, feature_collection_payload(hubs), compact=False)
    write_json(PREVIEW_OUTPUT_PATH, feature_collection_payload(hubs), compact=False)

    manifest = {
        "adapter_id": "japan_logistics_hubs_v1",
        "family": "logistics_hubs",
        "geometry_kind": "point",
        "country": "Japan",
        "schema_version": 1,
        "generated_at": utc_now(),
        "recipe_path": str(RECIPE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "paths": {
            "preview": {
                "logistics_hubs": str(PREVIEW_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "full": {
                "logistics_hubs": str(FULL_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "build_audit": str(AUDIT_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "source_signature": source_signature,
        "recipe_version": recipe.get("version", "japan_logistics_hubs_sources_v1"),
        "feature_counts": {
            "preview": {
                "logistics_hubs": int(len(hubs)),
            },
            "full": {
                "logistics_hubs": int(len(hubs)),
            },
        },
        "clip_bbox": [round(value, 6) for value in route_mask.bounds],
        "build_command": "python tools/build_transport_workbench_japan_logistics_hubs.py",
        "runtime_consumer": "transport_workbench_manifest_preview",
        "distribution_tier": "internal_only",
        "license_tier": "review_required",
        "coverage_scope": "japan_main_islands_v1",
        "source_policy": "local_source_cache_with_download",
        "source_url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P31.html",
        "source_encoding": "cp932",
        "excluded_regions": [
            "outside_japan_main_islands_route_mask"
        ],
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "source_fallback_encoding": "cp932",
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
        "supplement_to": "industrial_zones",
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
        "adapter_id": "japan_logistics_hubs_v1",
        "recipe_version": recipe.get("version", "japan_logistics_hubs_sources_v1"),
        "raw_feature_counts_by_prefecture": raw_counts,
        "clipped_feature_counts_by_prefecture": clipped_counts,
        "normalized_feature_count": int(len(hubs)),
        "hub_type_counts": {
            hub_type: int((hubs["hub_type"] == hub_type).sum())
            for hub_type in sorted(set(hubs["hub_type"].tolist()))
        },
        "operator_classification_counts": {
            operator: int((hubs["operator_classification"] == operator).sum())
            for operator in sorted(set(hubs["operator_classification"].tolist()))
        },
        "source_policy": "local_source_cache_with_download",
        "source_url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P31.html",
        "source_encoding": "cp932",
        "excluded_regions": [
            {
                "rule": "outside_japan_main_islands_route_mask",
                "count": int(sum(raw_counts.values()) - sum(clipped_counts.values())),
            }
        ],
        "source_signature": source_signature,
        "notes": [
            "This family stays separate from industrial land polygons and is treated as a logistics supplement layer.",
            "Preview and full outputs are identical for v1 because no approved thinning rule exists yet.",
            "P31 type, classification, and operator fields are normalized into stable code-plus-label pairs."
        ],
    }
    write_json(MANIFEST_PATH, manifest, compact=False)
    write_json(AUDIT_PATH, audit, compact=False)
    print("Built Japan logistics hub transport workbench pack.")


if __name__ == "__main__":
    main()
