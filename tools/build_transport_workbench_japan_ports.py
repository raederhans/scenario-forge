from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import shape

from map_builder.transport_workbench_contracts import finalize_transport_manifest


ROOT = Path(__file__).resolve().parents[1]
SOURCE_CACHE_DIR = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "port"
PORTS_SHP_PATH = SOURCE_CACHE_DIR / "C02-14_GML" / "C02-14_GML" / "C02-14-g_PortAndHarbor.shp"
RECIPE_PATH = ROOT / "data" / "transport_layers" / "japan_port" / "source_recipe.manual.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_port"
FULL_OUTPUT_PATH = OUTPUT_DIR / "ports.geojson"
PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "ports.preview.geojson"
EXPANDED_OUTPUT_PATH = OUTPUT_DIR / "ports.expanded.geojson"
EXPANDED_PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "ports.expanded.preview.geojson"
CORE_OUTPUT_PATH = OUTPUT_DIR / "ports.core.geojson"
CORE_PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "ports.core.preview.geojson"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
AUDIT_PATH = OUTPUT_DIR / "build_audit.json"
CARRIER_PATH = ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"

LEGAL_DESIGNATION_MAP = {
    "11": {"slug": "international_strategy", "label": "International strategic port", "importance": "national_core", "importance_rank": 3},
    "12": {"slug": "international_hub", "label": "International hub port", "importance": "national_core", "importance_rank": 3},
    "13": {"slug": "important", "label": "Important port", "importance": "regional_core", "importance_rank": 2},
    "14": {"slug": "local", "label": "Local port", "importance": "local_connector", "importance_rank": 1},
    "15": {"slug": "shelter", "label": "Shelter / special-use port", "importance": "special_support", "importance_rank": 1},
}
PORT_CLASS_MAP = {
    "0": "Unspecified",
    "1": "Class A",
    "2": "Class B",
}
MANAGER_TYPE_MAP = {
    "1": "Prefecture",
    "2": "Municipality",
    "3": "Port authority",
    "4": "Local public body",
    "5": "Other",
}
AGENCY_MAP = {
    "1": "Japan Coast Guard",
    "2": "Quarantine station",
    "3": "Customs",
    "4": "Immigration office",
    "5": "Airport / navigation office",
    "6": "Harbor office",
    "7": "Maritime traffic center",
    "8": "International strategic port office",
}

COVERAGE_TIERS = {
    "core": {
        "label": "core",
        "description": "International strategic, international hub, and important ports only.",
        "legal_designation_codes": ["11", "12", "13"],
        "preview_path": CORE_PREVIEW_OUTPUT_PATH,
        "full_path": CORE_OUTPUT_PATH,
        "distribution_tier": "curated_core",
    },
    "expanded": {
        "label": "expanded",
        "description": "Core ports plus local ports that remain inside the Japan carrier route mask.",
        "legal_designation_codes": ["11", "12", "13", "14"],
        "preview_path": EXPANDED_PREVIEW_OUTPUT_PATH,
        "full_path": EXPANDED_OUTPUT_PATH,
        "distribution_tier": "official_expanded",
    },
    "full_official": {
        "label": "full_official",
        "description": "All official port nodes inside the current route mask, including shelter and special-use ports.",
        "legal_designation_codes": ["11", "12", "13", "14", "15"],
        "preview_path": PREVIEW_OUTPUT_PATH,
        "full_path": FULL_OUTPUT_PATH,
        "distribution_tier": "official_full",
    },
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


def ensure_required_sources() -> None:
    missing = [
        path
        for path in (RECIPE_PATH, PORTS_SHP_PATH, CARRIER_PATH)
        if not path.exists()
    ]
    if not missing:
        return
    joined = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
    raise SystemExit(f"Missing required Japan port source inputs: {joined}")


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
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def parse_bool(value: Any) -> bool | None:
    text = normalize_text(value).lower()
    if text == "true":
        return True
    if text == "false":
        return False
    return None


def parse_code_list(value: Any) -> list[str]:
    text = normalize_text(value)
    if not text:
        return []
    return [part for part in (entry.strip() for entry in text.split(",")) if part]


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


def read_official_ports(route_mask) -> gpd.GeoDataFrame:
    ports = gpd.read_file(PORTS_SHP_PATH, encoding="cp932")
    ports = ports.set_crs("EPSG:4326") if ports.crs is None else ports.to_crs("EPSG:4326")
    ports = ports.loc[ports.geometry.notnull()].copy()
    ports = ports.loc[ports.geometry.geom_type == "Point"].copy()
    ports = ports.loc[ports.geometry.intersects(route_mask)].copy()
    ports["geometry"] = ports.geometry.intersection(route_mask)
    return ports.loc[~ports.geometry.is_empty].copy()


def normalize_ports(ports: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    rows: list[dict[str, Any]] = []
    for row in ports.itertuples(index=False):
        legal_code = normalize_text(getattr(row, "C02_002", ""))
        legal_meta = LEGAL_DESIGNATION_MAP.get(legal_code)
        if not legal_meta:
            continue
        name = normalize_text(getattr(row, "C02_005", ""))
        port_code = normalize_text(getattr(row, "C02_003", ""))
        admin_code = normalize_text(getattr(row, "C02_004", ""))
        agency_codes = parse_code_list(getattr(row, "C02_010", ""))
        stable_key = f"port::{normalize_match_key(name)}::{port_code or admin_code}"
        rows.append({
            "id": build_id("jp-port", stable_key, legal_code),
            "stable_key": stable_key,
            "name": name,
            "name_match_key": normalize_match_key(name),
            "facility_type": "port",
            "category": legal_meta["slug"],
            "importance": legal_meta["importance"],
            "importance_rank": legal_meta["importance_rank"],
            "source_dataset": "mlit_c02_2014",
            "source_year": 2014,
            "port_code": port_code,
            "admin_code": admin_code,
            "port_class": PORT_CLASS_MAP.get(normalize_text(getattr(row, "C02_001", "")), ""),
            "port_class_code": normalize_text(getattr(row, "C02_001", "")),
            "legal_designation": legal_meta["slug"],
            "legal_designation_code": legal_code,
            "legal_designation_label": legal_meta["label"],
            "manager": normalize_text(getattr(row, "C02_007", "")),
            "manager_type": MANAGER_TYPE_MAP.get(normalize_text(getattr(row, "C02_006", "")), ""),
            "manager_type_code": normalize_text(getattr(row, "C02_006", "")),
            "date_established": normalize_text(getattr(row, "C02_008", "")),
            "date_designated": normalize_text(getattr(row, "C02_009", "")),
            "agency_codes": "|".join(agency_codes),
            "agency_labels": "|".join(AGENCY_MAP.get(code, code) for code in agency_codes),
            "outer_facility_length_m": parse_int(getattr(row, "C02_011", None)),
            "mooring_facility_length_m": parse_int(getattr(row, "C02_012", None)),
            "ferry_service": parse_bool(getattr(row, "C02_013", None)),
            "geometry": getattr(row, "geometry"),
        })
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def select_coverage_tier(normalized: gpd.GeoDataFrame, tier_id: str) -> gpd.GeoDataFrame:
    tier_meta = COVERAGE_TIERS[tier_id]
    allowed_codes = set(tier_meta["legal_designation_codes"])
    return normalized.loc[normalized["legal_designation_code"].isin(allowed_codes)].copy()


def main() -> None:
    ensure_required_sources()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    route_mask = load_route_mask()
    recipe = read_json(RECIPE_PATH)

    ports = read_official_ports(route_mask)
    normalized = normalize_ports(ports)
    tier_packs = {
        tier_id: select_coverage_tier(normalized, tier_id)
        for tier_id in COVERAGE_TIERS
    }

    for tier_id, tier_meta in COVERAGE_TIERS.items():
        tier_gdf = tier_packs[tier_id]
        write_json(tier_meta["full_path"], feature_collection_payload(tier_gdf), compact=False)
        write_json(tier_meta["preview_path"], feature_collection_payload(tier_gdf), compact=False)

    source_signature = {
        "mlit_c02_2014_ports": {
            "filename": PORTS_SHP_PATH.name,
            "size_bytes": PORTS_SHP_PATH.stat().st_size,
            "sha256": file_sha256(PORTS_SHP_PATH),
        },
    }
    variants = {
        tier_id: {
            "label": tier_meta["label"],
            "description": tier_meta["description"],
            "distribution_tier": tier_meta["distribution_tier"],
            "legal_designation_codes": list(tier_meta["legal_designation_codes"]),
            "paths": {
                "preview": {
                    "ports": str(tier_meta["preview_path"].relative_to(ROOT)).replace("\\", "/"),
                },
                "full": {
                    "ports": str(tier_meta["full_path"].relative_to(ROOT)).replace("\\", "/"),
                },
            },
            "feature_counts": {
                "preview": {
                    "ports": int(len(tier_packs[tier_id])),
                },
                "full": {
                    "ports": int(len(tier_packs[tier_id])),
                },
            },
        }
        for tier_id, tier_meta in COVERAGE_TIERS.items()
    }
    manifest = {
        "adapter_id": "japan_port_v1",
        "family": "port",
        "geometry_kind": "point",
        "country": "Japan",
        "schema_version": 2,
        "generated_at": utc_now(),
        "recipe_path": str(RECIPE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "distribution_tier": "coverage_tiered",
        "license_tier": "review_required",
        "coverage_scope": "japan_main_islands_route_mask",
        "paths": {
            "preview": {
                "ports": str(CORE_PREVIEW_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "full": {
                "ports": str(FULL_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "build_audit": str(AUDIT_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "source_signature": source_signature,
        "recipe_version": recipe.get("version", "japan_port_sources_v1"),
        "feature_counts": {
            "preview": {
                "ports": int(len(tier_packs["core"])),
            },
            "full": {
                "ports": int(len(tier_packs["full_official"])),
            },
        },
        "clip_bbox": [round(value, 6) for value in route_mask.bounds],
        "build_command": "python tools/build_transport_workbench_japan_ports.py",
        "runtime_consumer": "transport_workbench_port_preview",
        "source_policy": "local_source_cache_only_internal_trial",
        "official_port_member": "C02-14_GML/C02-14-g_PortAndHarbor.shp",
        "official_encoding": "cp932",
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "source_fallback_encoding": "cp932",
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
        "release_policy": "internal_trial_only",
        "publish_guard": "replace_c02_source_before_public_release",
        "scope_policy": "japan_corridor_main_islands",
    }
    manifest = finalize_transport_manifest(
        manifest,
        default_variant="core",
        variants=variants,
        extension={"variant_axis": "coverage"},
    )
    audit = {
        "generated_at": utc_now(),
        "adapter_id": "japan_port_v1",
        "raw_port_feature_count": int(len(ports)),
        "normalized_port_count": int(len(normalized)),
        "default_variant": "core",
        "coverage_tier_counts": {
            tier_id: int(len(tier_gdf))
            for tier_id, tier_gdf in tier_packs.items()
        },
        "legal_designation_counts": {
            code: int((normalized["legal_designation_code"] == code).sum())
            for code in LEGAL_DESIGNATION_MAP.keys()
        },
        "manager_type_counts": {
            code: int((normalized["manager_type_code"] == code).sum())
            for code in sorted(set(normalized["manager_type_code"].tolist()))
            if code
        },
        "importance_counts": {
            level: int((normalized["importance"] == level).sum())
            for level in ("national_core", "regional_core", "local_connector", "special_support")
            if int((normalized["importance"] == level).sum()) > 0
        },
        "recipe_version": recipe.get("version", "japan_port_sources_v1"),
        "source_policy": "local_source_cache_only_internal_trial",
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "source_fallback_encoding": "cp932",
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
        "source_signature": source_signature,
        "notes": [
            "Coverage tiers now expose core, expanded, and full official port subsets instead of collapsing the runtime contract to a single curated set.",
            "The legacy preview path now points at the core tier so existing consumers stay stable while upgraded consumers can opt into expanded or full_official coverage.",
            "The current C02 source is kept for internal trial use only. Public or commercial release must replace or re-license the source path first.",
            "Port district polygons and harbor district boundaries remain out of scope for v1.",
        ],
    }
    write_json(MANIFEST_PATH, manifest, compact=False)
    write_json(AUDIT_PATH, audit, compact=False)
    print("Built Japan port transport workbench packs.")


if __name__ == "__main__":
    main()
