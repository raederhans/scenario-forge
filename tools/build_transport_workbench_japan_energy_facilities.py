from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ARCHIVE_PATH = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "energy_facilities" / "P03-07_GML.zip"
EXTRACT_DIR = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "energy_facilities" / "P03-07_GML"
EXTRACT_ROOT = EXTRACT_DIR / "P03-07_GML"
RECIPE_PATH = ROOT / "data" / "transport_layers" / "japan_energy_facilities" / "source_recipe.manual.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_energy_facilities"
OVERRIDE_PATH = OUTPUT_DIR / "overrides" / "facility_subtype_reference.json"
FULL_OUTPUT_PATH = OUTPUT_DIR / "energy_facilities.geojson"
PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "energy_facilities.preview.geojson"
SUBTYPE_CATALOG_PATH = OUTPUT_DIR / "subtype_catalog.json"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
AUDIT_PATH = OUTPUT_DIR / "build_audit.json"
CARRIER_PATH = ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"
STATUS_MAP = {
    "1": "existing",
    "2": "under_construction",
    "3": "construction_preparation",
    "4": "conversion_under_construction",
}
POWER_SOURCE_SPECS = {
    "P03-07-g_GeneralHydroelectricPowerPlant.shp": "general_hydroelectric_power_plant",
    "P03-07-g_PumpedStorageHydroelectricPlant.shp": "pumped_storage_hydroelectric_power_plant",
    "P03-07-g_ThermalPowerPlant.shp": "thermal_power_plant",
    "P03-07-g_NuclearPowerPlant.shp": "nuclear_power_plant",
    "P03-07-g_GeothermalPowerPlant.shp": "geothermal_power_plant",
    "P03-07-g_WindPowerPlant.shp": "wind_power_plant",
    "P03-07-g_PhotovoltaicPowerPlant.shp": "photovoltaic_power_plant",
}
EXCLUDED_SOURCE_MEMBERS = [
    "P03-07-g_PondInformation.shp",
]


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
    missing = [path for path in (SOURCE_ARCHIVE_PATH, RECIPE_PATH, OVERRIDE_PATH) if not path.exists()]
    if missing:
        joined = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
        raise SystemExit(f"Missing required Japan energy source inputs: {joined}")


def ensure_extracted_archive() -> None:
    expected = EXTRACT_ROOT / "P03-07-g_ThermalPowerPlant.shp"
    if expected.exists():
        return
    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SOURCE_ARCHIVE_PATH) as archive:
        archive.extractall(EXTRACT_DIR)


def load_route_mask():
    carrier = read_json(CARRIER_PATH)
    route_mask = carrier.get("frames", {}).get("main", {}).get("routeMask")
    if not route_mask:
        raise SystemExit("Japan carrier routeMask is missing.")
    return shape(route_mask)


def feature_collection_payload(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    return json.loads(gdf.to_json())


def build_facility_id(facility_subtype: str, name: str, operator: str, address: str, row_index: int) -> str:
    digest = hashlib.sha1()
    digest.update(facility_subtype.encode("utf-8"))
    digest.update(name.encode("utf-8"))
    digest.update(operator.encode("utf-8"))
    digest.update(address.encode("utf-8"))
    digest.update(str(row_index).encode("ascii"))
    return f"jp-energy-{digest.hexdigest()[:12]}"


def load_subtype_reference() -> dict[str, Any]:
    payload = read_json(OVERRIDE_PATH)
    if not isinstance(payload, dict):
        raise SystemExit("Energy facility subtype reference must be a JSON object.")
    return payload


def read_subtype_features(route_mask) -> tuple[gpd.GeoDataFrame, dict[str, int], dict[str, int]]:
    frames = []
    raw_counts: dict[str, int] = {}
    clipped_counts: dict[str, int] = {}
    row_index = 0
    for filename, facility_subtype in POWER_SOURCE_SPECS.items():
        shp_path = EXTRACT_ROOT / filename
        if not shp_path.exists():
            raise SystemExit(f"Missing extracted energy source member: {shp_path.relative_to(ROOT)}")
        gdf = gpd.read_file(shp_path, encoding="cp932")
        gdf = gdf.set_crs("EPSG:4326") if gdf.crs is None else gdf.to_crs("EPSG:4326")
        gdf = gdf.loc[gdf.geometry.notnull()].copy()
        raw_counts[facility_subtype] = int(len(gdf))
        gdf = gdf.loc[gdf.geometry.intersects(route_mask)].copy()
        clipped_counts[facility_subtype] = int(len(gdf))
        if gdf.empty:
            continue
        gdf["geometry"] = gdf.geometry.intersection(route_mask)
        gdf = gdf.loc[~gdf.geometry.is_empty].copy()
        gdf["facility_subtype"] = facility_subtype
        gdf["facility_label"] = facility_subtype.replace("_", " ")
        gdf["operator"] = gdf["P03_001"].map(normalize_text)
        gdf["name"] = gdf["P03_002"].map(normalize_text)
        gdf["address"] = gdf["P03_003"].map(normalize_text)
        gdf["status_code"] = gdf["P03_004"].map(normalize_text)
        gdf["status"] = gdf["status_code"].map(lambda value: STATUS_MAP.get(value, "unknown"))
        gdf["start_date"] = gdf["P03_005"].map(normalize_text)
        gdf["source"] = "mlit_p03_2007_power_plants"
        gdf["match_key"] = gdf["name"].map(normalize_match_key)
        ids = []
        for _, row in gdf.iterrows():
            row_index += 1
            ids.append(build_facility_id(
                facility_subtype,
                normalize_text(row["name"]),
                normalize_text(row["operator"]),
                normalize_text(row["address"]),
                row_index,
            ))
        gdf["id"] = ids
        frames.append(gdf[[
            "id",
            "name",
            "facility_subtype",
            "facility_label",
            "operator",
            "address",
            "status_code",
            "status",
            "start_date",
            "source",
            "match_key",
            "geometry",
        ]])
    if not frames:
        raise SystemExit("No energy facility features remained after extraction and clipping.")
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs="EPSG:4326"), raw_counts, clipped_counts


def build_subtype_catalog(subtype_reference: dict[str, Any], facilities: gpd.GeoDataFrame) -> list[dict[str, Any]]:
    local_subtypes = subtype_reference.get("local_subtypes", {})
    reference_only_subtypes = subtype_reference.get("reference_only_subtypes", {})
    facility_counts = facilities["facility_subtype"].value_counts().to_dict()
    catalog = []
    for subtype_id, meta in local_subtypes.items():
        catalog.append({
            "subtype_id": subtype_id,
            "availability": "local",
            "feature_count": int(facility_counts.get(subtype_id, 0)),
            "group": normalize_text(meta.get("group")),
            "distribution_tier": normalize_text(meta.get("distribution_tier")),
            "source_status": normalize_text(meta.get("source_status")),
        })
    for subtype_id, meta in reference_only_subtypes.items():
        catalog.append({
            "subtype_id": subtype_id,
            "availability": "reference_only",
            "feature_count": 0,
            "group": normalize_text(meta.get("group")),
            "distribution_tier": normalize_text(meta.get("distribution_tier")),
            "source_status": normalize_text(meta.get("source_status")),
        })
    catalog.sort(key=lambda item: (item["availability"] != "local", item["subtype_id"]))
    return catalog


def main() -> None:
    ensure_required_sources()
    ensure_extracted_archive()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    recipe = read_json(RECIPE_PATH)
    route_mask = load_route_mask()
    subtype_reference = load_subtype_reference()
    facilities, raw_counts, clipped_counts = read_subtype_features(route_mask)
    subtype_catalog = build_subtype_catalog(subtype_reference, facilities)

    write_json(FULL_OUTPUT_PATH, feature_collection_payload(facilities), compact=False)
    write_json(PREVIEW_OUTPUT_PATH, feature_collection_payload(facilities), compact=False)
    write_json(SUBTYPE_CATALOG_PATH, subtype_catalog, compact=False)

    source_signature = {
        "mlit_p03_2007_power_plants": {
            "filename": SOURCE_ARCHIVE_PATH.name,
            "size_bytes": SOURCE_ARCHIVE_PATH.stat().st_size,
            "sha256": file_sha256(SOURCE_ARCHIVE_PATH),
        },
        "facility_subtype_reference": {
            "filename": str(OVERRIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
            "size_bytes": OVERRIDE_PATH.stat().st_size,
            "sha256": file_sha256(OVERRIDE_PATH),
        },
    }
    manifest = {
        "adapter_id": "japan_energy_facilities_v1",
        "family": "energy_facilities",
        "geometry_kind": "point",
        "country": "Japan",
        "schema_version": 1,
        "generated_at": utc_now(),
        "recipe_path": str(RECIPE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "paths": {
            "preview": {
                "energy_facilities": str(PREVIEW_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "full": {
                "energy_facilities": str(FULL_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "subtype_catalog": str(SUBTYPE_CATALOG_PATH.relative_to(ROOT)).replace("\\", "/"),
            "build_audit": str(AUDIT_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "source_signature": source_signature,
        "recipe_version": recipe.get("version", "japan_energy_facilities_sources_v1"),
        "feature_counts": {
            "preview": {
                "energy_facilities": int(len(facilities)),
            },
            "full": {
                "energy_facilities": int(len(facilities)),
            },
        },
        "clip_bbox": [round(value, 6) for value in route_mask.bounds],
        "build_command": "python tools/build_transport_workbench_japan_energy_facilities.py",
        "runtime_consumer": "transport_workbench_manifest_preview",
        "distribution_tier": "internal_only",
        "license_tier": "review_required",
        "coverage_scope": "japan_main_islands_v1",
        "source_policy": "local_source_cache_only",
        "source_archive": str(SOURCE_ARCHIVE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "source_url": "https://nlftp.mlit.go.jp/ksj/gml/data/P03/P03-07/P03-07_GML.zip",
        "source_encoding": "cp932",
        "excluded_regions": [
            "outside_japan_main_islands_route_mask",
            "P03-07-g_PondInformation"
        ],
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "source_fallback_encoding": "cp932",
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
    }
    audit = {
        "generated_at": utc_now(),
        "adapter_id": "japan_energy_facilities_v1",
        "recipe_version": recipe.get("version", "japan_energy_facilities_sources_v1"),
        "raw_feature_counts_by_subtype": raw_counts,
        "clipped_feature_counts_by_subtype": clipped_counts,
        "normalized_feature_count": int(len(facilities)),
        "status_counts": {
            status: int((facilities["status"] == status).sum())
            for status in sorted(set(facilities["status"].tolist()))
        },
        "source_policy": "local_source_cache_only",
        "source_archive": str(SOURCE_ARCHIVE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "source_url": "https://nlftp.mlit.go.jp/ksj/gml/data/P03/P03-07/P03-07_GML.zip",
        "source_encoding": "cp932",
        "excluded_source_members": EXCLUDED_SOURCE_MEMBERS,
        "excluded_regions": [
            {
                "rule": "outside_japan_main_islands_route_mask",
                "count": int(sum(raw_counts.values()) - sum(clipped_counts.values())),
            }
        ],
        "local_subtypes": [item["subtype_id"] for item in subtype_catalog if item["availability"] == "local"],
        "reference_only_subtypes": [item["subtype_id"] for item in subtype_catalog if item["availability"] == "reference_only"],
        "source_signature": source_signature,
        "notes": [
            "The first local energy family pack intentionally contains only official MLIT P03 power-plant subtypes.",
            "Preview and full outputs are identical for v1 because no approved thinning rule exists yet.",
            "Reference-only subtypes are governed in subtype_catalog.json and are not fabricated into map features."
        ],
    }
    write_json(MANIFEST_PATH, manifest, compact=False)
    write_json(AUDIT_PATH, audit, compact=False)
    print("Built Japan energy facility transport workbench pack.")


if __name__ == "__main__":
    main()
