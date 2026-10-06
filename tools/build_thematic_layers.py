#!/usr/bin/env python3
"""Build checked-in thematic layer foundation fixtures."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from map_builder.contracts import DATA_ARTIFACT_SPECS_BY_PATH
from map_builder.io.writers import write_json_atomic
from map_builder.runtime_asset_registry import load_runtime_asset_registry
from map_builder.thematic_layer_contracts import (
    validate_thematic_admin_metrics,
    validate_thematic_build_audit,
    validate_thematic_grid_rle,
    validate_thematic_layer_index,
    validate_thematic_layer_manifest,
)
from map_builder.thematic_wgi_ingest import (
    DEFAULT_WGI_SOURCE_CACHE_PATH,
    WGI_AUDIT_RELATIVE_PATH,
    WGI_COUNTRY_MAPPING_RELATIVE_PATH,
    WGI_RUNTIME_METRIC_IDS,
    WGI_RUNTIME_SCENARIO_IDS,
    WGI_RUNTIME_METHOD,
    build_wgi_historical_reference_policy,
    WGI_LAYER_ID,
    WGI_MANIFEST_RELATIVE_PATH,
    WGI_METRICS_RELATIVE_PATH,
    WGI_RECIPE_RELATIVE_PATH as WGI_REAL_RECIPE_RELATIVE_PATH,
    WGI_RUNTIME_DATA_VERSION,
    build_wgi_real_source_payloads,
)
from map_builder.thematic_hdi_ingest import (
    DEFAULT_HDI_SOURCE_CACHE_PATH,
    HDI_LAYER_ID as HDI_REAL_LAYER_ID,
    HDI_MANIFEST_RELATIVE_PATH as HDI_REAL_MANIFEST_RELATIVE_PATH,
    HDI_METRICS_RELATIVE_PATH as HDI_REAL_METRICS_RELATIVE_PATH,
    HDI_OUTPUT_PATHS as HDI_REAL_OUTPUT_PATHS,
    build_hdi_real_source_payloads,
    hdi_runtime_selection,
)
from map_builder.thematic_population_ingest import (
    DEFAULT_POPULATION_SOURCE_CACHE_DIR, POPULATION_LAYER_ID,
    POPULATION_MANIFEST_RELATIVE_PATH, POPULATION_METRICS_RELATIVE_PATH,
    POPULATION_OUTPUT_PATHS, build_population_real_source_payloads,
    population_runtime_selection,
)


DATA_ROOT = REPO_ROOT / "data"
DEFAULT_GENERATED_AT = "2026-06-22T00:00:00Z"
BUILD_COMMAND = "python tools/build_thematic_layers.py"
GRID_COLUMNS = 720
GRID_ROWS = 360
GRID_CELL_COUNT = GRID_COLUMNS * GRID_ROWS

INDEX_RELATIVE_PATH = "thematic_layers/index.json"
STATE_MANIFEST_RELATIVE_PATH = "thematic_layers/political/state_capacity_demo/manifest.json"
STATE_METRICS_RELATIVE_PATH = "thematic_layers/political/state_capacity_demo/metrics.admin0.json"
STATE_AUDIT_RELATIVE_PATH = "thematic_layers/political/state_capacity_demo/build_audit.json"
HDI_MANIFEST_RELATIVE_PATH = "thematic_layers/social/human_development_demo/manifest.json"
HDI_METRICS_RELATIVE_PATH = "thematic_layers/social/human_development_demo/metrics.admin0.json"
HDI_AUDIT_RELATIVE_PATH = "thematic_layers/social/human_development_demo/build_audit.json"
POP_MANIFEST_RELATIVE_PATH = "thematic_layers/population/population_density_demo/manifest.json"
POP_GRID_RELATIVE_PATH = "thematic_layers/population/population_density_demo/grid.rle.json"
POP_AUDIT_RELATIVE_PATH = "thematic_layers/population/population_density_demo/build_audit.json"
WGI_RECIPE_RELATIVE_PATH = "thematic_layers/source_recipes/wgi_state_capacity.manual.json"
HDI_RECIPE_RELATIVE_PATH = "thematic_layers/source_recipes/undp_hdi.manual.json"
POP_RECIPE_RELATIVE_PATH = "thematic_layers/source_recipes/population_density_grid.manual.json"

THEMATIC_OUTPUT_PATHS = (
    INDEX_RELATIVE_PATH,
    WGI_RECIPE_RELATIVE_PATH,
    HDI_RECIPE_RELATIVE_PATH,
    POP_RECIPE_RELATIVE_PATH,
    STATE_MANIFEST_RELATIVE_PATH,
    STATE_METRICS_RELATIVE_PATH,
    STATE_AUDIT_RELATIVE_PATH,
    HDI_MANIFEST_RELATIVE_PATH,
    HDI_METRICS_RELATIVE_PATH,
    HDI_AUDIT_RELATIVE_PATH,
    POP_MANIFEST_RELATIVE_PATH,
    POP_GRID_RELATIVE_PATH,
    POP_AUDIT_RELATIVE_PATH,
)
MANIFEST_REFRESH_PATHS = (*THEMATIC_OUTPUT_PATHS, "runtime_asset_registry.json")
THEMATIC_RUNTIME_PUBLISH_SCOPE = "repo_only"
THEMATIC_RUNTIME_READINESS = "catalog_only"
WGI_REAL_OUTPUT_PATHS = (
    WGI_REAL_RECIPE_RELATIVE_PATH,
    WGI_MANIFEST_RELATIVE_PATH,
    WGI_METRICS_RELATIVE_PATH,
    WGI_AUDIT_RELATIVE_PATH,
)


COUNTRIES = (
    ("USA", "United States"),
    ("GBR", "United Kingdom"),
    ("FRA", "France"),
    ("DEU", "Germany"),
    ("JPN", "Japan"),
    ("CHN", "China"),
    ("IND", "India"),
    ("BRA", "Brazil"),
    ("RUS", "Russia"),
    ("ZAF", "South Africa"),
)

STATE_METRIC_IDS = ("state_capacity_index", "government_effectiveness_demo", "rule_of_law_demo")
HDI_METRIC_IDS = ("human_development_index_demo", "education_index_demo", "income_index_demo")

STATE_VALUES: dict[str, tuple[float | None, float | None, float | None]] = {
    "USA": (78.0, 82.0, 74.0),
    "GBR": (80.0, 84.0, 79.0),
    "FRA": (76.0, 78.0, 73.0),
    "DEU": (83.0, 86.0, 81.0),
    "JPN": (81.0, 83.0, 80.0),
    "CHN": (68.0, 70.0, 58.0),
    "IND": (59.0, 57.0, 52.0),
    "BRA": (55.0, 51.0, None),
    "RUS": (60.0, 61.0, None),
    "ZAF": (53.0, 49.0, 47.0),
}

HDI_VALUES: dict[str, tuple[float | None, float | None, float | None]] = {
    "USA": (0.927, 0.899, 0.936),
    "GBR": (0.940, 0.914, 0.924),
    "FRA": (0.910, 0.884, 0.902),
    "DEU": (0.950, 0.920, 0.936),
    "JPN": (0.925, 0.887, 0.908),
    "CHN": (0.788, 0.728, 0.802),
    "IND": (0.644, 0.588, 0.672),
    "BRA": (0.760, 0.707, 0.742),
    "RUS": (0.821, 0.832, None),
    "ZAF": (0.717, 0.683, 0.704),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build thematic layer foundation fixtures.")
    parser.add_argument(
        "--generated-at",
        default=DEFAULT_GENERATED_AT,
        help="Stable timestamp embedded in generated thematic fixture files.",
    )
    parser.add_argument(
        "--include-wgi-real",
        action="store_true",
        help="Regenerate the WGI real-source layer from the local source cache.",
    )
    parser.add_argument(
        "--wgi-source-cache-path",
        type=Path,
        default=DEFAULT_WGI_SOURCE_CACHE_PATH,
        help="Local WGI .xlsx or .csv cache path used only with --include-wgi-real.",
    )
    parser.add_argument(
        "--include-hdi-real",
        action="store_true",
        help="Regenerate only the UNDP HDR 2025 real-source layer and its registrations from the local cache.",
    )
    parser.add_argument(
        "--hdi-source-cache-path",
        type=Path,
        default=DEFAULT_HDI_SOURCE_CACHE_PATH,
        help="Local HDR 2025 CSV cache path used with --include-hdi-real.",
    )
    parser.add_argument(
        "--include-population-real",
        action="store_true",
        help="Regenerate only the pinned WDI population layer and registrations from local API caches.",
    )
    parser.add_argument(
        "--population-source-cache-dir",
        type=Path,
        default=DEFAULT_POPULATION_SOURCE_CACHE_DIR,
        help="Local complete WDI API JSON cache directory used with --include-population-real.",
    )
    parser.add_argument(
        "--skip-runtime-registry",
        action="store_true",
        help="Write thematic files without updating data/runtime_asset_registry.json.",
    )
    parser.add_argument(
        "--skip-data-manifest",
        action="store_true",
        help="Write thematic files without refreshing data/manifest.json output metadata.",
    )
    return parser.parse_args()


def data_path(relative_path: str) -> Path:
    return DATA_ROOT / relative_path


def data_url(relative_path: str) -> str:
    return f"data/{relative_path}"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: object) -> None:
    write_json_atomic(path, payload, ensure_ascii=False, indent=2, trailing_newline=True)


def metric_payload(value: float | None, *, year: int, unit: str, missing_note: str = "") -> dict[str, Any]:
    if value is None:
        return {
            "raw_value": None,
            "normalized_value": None,
            "year": year,
            "unit": unit,
            "source_status": "source_gap",
            "notes": missing_note or "Fixture keeps this metric empty to test missing-value behavior.",
        }
    normalized = round(value * 100, 1) if unit == "index_0_1" else round(value, 1)
    return {
        "raw_value": value,
        "normalized_value": normalized,
        "year": year,
        "unit": unit,
        "source_status": "fixture",
        "notes": "Synthetic fixture value; not a real source observation.",
    }


def admin_metrics_payload(
    *,
    layer_id: str,
    metric_ids: tuple[str, ...],
    values_by_country: dict[str, tuple[float | None, ...]],
    year: int,
    unit: str,
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for iso_a3, name in COUNTRIES:
        metric_values = values_by_country[iso_a3]
        values = {
            metric_id: metric_payload(value, year=year, unit=unit)
            for metric_id, value in zip(metric_ids, metric_values)
        }
        missing_count = sum(1 for item in values.values() if item["raw_value"] is None)
        coverage_status = "complete"
        if missing_count == len(metric_ids):
            coverage_status = "missing"
        elif missing_count:
            coverage_status = "partial"
        features.append(
            {
                "join_key": iso_a3,
                "name": name,
                "coverage_status": coverage_status,
                "values": values,
            }
        )
    return {
        "schema_version": 1,
        "layer_id": layer_id,
        "geography_level": "admin0",
        "join_key_type": "iso_a3",
        "metric_ids": list(metric_ids),
        "features": features,
        "notes": [
            "Fixture-only values lock contract shape and missing-value semantics.",
            "Real WGI/HDI ingestion is intentionally deferred to the source-cache phase.",
        ],
    }


def coverage_counts_for_admin(payload: dict[str, Any]) -> dict[str, int]:
    counts = {"features": 0, "complete": 0, "partial": 0, "missing": 0}
    for feature in payload["features"]:
        counts["features"] += 1
        status = str(feature.get("coverage_status") or "")
        if status in counts:
            counts[status] += 1
    return counts


def rle_encode(cells: list[int]) -> list[list[int]]:
    if not cells:
        return []
    runs: list[list[int]] = []
    current_value = cells[0]
    current_length = 1
    for value in cells[1:]:
        if value == current_value:
            current_length += 1
            continue
        runs.append([current_value, current_length])
        current_value = value
        current_length = 1
    runs.append([current_value, current_length])
    return runs


def _clamp(value: int, lower: int, upper: int) -> int:
    return max(lower, min(upper, value))


def _lon_to_col(lon: float) -> int:
    return _clamp(int((lon + 180.0) / 0.5), 0, GRID_COLUMNS)


def _lat_to_row(lat: float) -> int:
    return _clamp(int((90.0 - lat) / 0.5), 0, GRID_ROWS)


def apply_rect(cells: list[int], *, lon_min: float, lon_max: float, lat_min: float, lat_max: float, value: int) -> None:
    col_start = _lon_to_col(lon_min)
    col_end = _lon_to_col(lon_max)
    row_start = _lat_to_row(lat_max)
    row_end = _lat_to_row(lat_min)
    for row in range(row_start, row_end):
        offset = row * GRID_COLUMNS
        for col in range(col_start, col_end):
            cells[offset + col] = value


def build_population_grid_payload() -> dict[str, Any]:
    cells = [0] * GRID_CELL_COUNT
    for rect in (
        {"lon_min": -125.0, "lon_max": -66.0, "lat_min": 25.0, "lat_max": 50.0, "value": 75},
        {"lon_min": -10.0, "lon_max": 35.0, "lat_min": 35.0, "lat_max": 60.0, "value": 95},
        {"lon_min": 68.0, "lon_max": 92.0, "lat_min": 7.0, "lat_max": 30.0, "value": 145},
        {"lon_min": 100.0, "lon_max": 125.0, "lat_min": 20.0, "lat_max": 42.0, "value": 135},
        {"lon_min": 135.0, "lon_max": 142.0, "lat_min": 34.0, "lat_max": 38.0, "value": 185},
    ):
        apply_rect(cells, **rect)
    return {
        "schema_version": 1,
        "layer_id": "population_density_demo",
        "metric_id": "population_density_intensity_demo",
        "geometry_kind": "grid_720x360",
        "grid": {
            "columns": GRID_COLUMNS,
            "rows": GRID_ROWS,
            "bounds": [-180, -90, 180, 90],
            "crs": "EPSG:4326",
            "cell_order": "row_major_north_to_south",
        },
        "encoding": "rle-u8-array",
        "neutral_value": 0,
        "min_value": 0,
        "max_value": 255,
        "missing_value_policy": {
            "source_gap_encoding": "none",
            "requires_missing_mask": True,
            "reserved_nodata_value": None,
            "notes": "Fixture has no missing cells; real source gaps must use missing_mask_rle.",
        },
        "missing_cell_count": 0,
        "data": rle_encode(cells),
        "normalization": {
            "method": "manual_fixture_intensity_0_255",
            "range": [0, 255],
            "source_units": "fixture intensity",
        },
        "limitations": [
            "Fixture grid only verifies encoding, bounds, and catalog plumbing.",
            "Real population density requires a pinned GHSL or WorldPop source cache.",
        ],
    }


def recipe_payloads(generated_at: str) -> dict[str, dict[str, Any]]:
    return {
        WGI_RECIPE_RELATIVE_PATH: {
            "schema_version": 1,
            "recipe_id": "wgi_state_capacity_manual",
            "title": "WGI governance proxy source recipe",
            "source_family": "World Bank Worldwide Governance Indicators",
            "phase": "foundation_contract",
            "source_policy": "fixture_only",
            "future_source_policy": "real_source_cache_only",
            "generated_at": generated_at,
            "download_policy": {"network_allowed": False, "phase1_real_downloads": False},
            "official_sources": [
                {
                    "source_id": "world_bank_wgi",
                    "url": "https://datacatalog.worldbank.org/search/dataset/0038026/worldwide-governance-indicators",
                    "release": "version 7 latest; updated 2026-03-18; coverage 1996-2024",
                    "periodicity": "annual",
                    "license": "World Bank catalog metadata; default World Bank data license is CC BY 4.0 unless metadata says otherwise.",
                    "citation": "World Bank Worldwide Governance Indicators Data Catalog entry.",
                    "selection_rule": "Pin release, year, official WGI dimensions, project proxy method, and source package checksum before ingest.",
                }
            ],
            "missing_value_policy": "Missing or unavailable source values must stay null and carry source_gap status.",
        },
        HDI_RECIPE_RELATIVE_PATH: {
            "schema_version": 1,
            "recipe_id": "undp_hdi_manual",
            "title": "UNDP HDI source recipe",
            "source_family": "UNDP Human Development Index",
            "phase": "foundation_contract",
            "source_policy": "fixture_only",
            "future_source_policy": "real_source_cache_only",
            "generated_at": generated_at,
            "download_policy": {"network_allowed": False, "phase1_real_downloads": False},
            "official_sources": [
                {
                    "source_id": "undp_hdi",
                    "url": "https://hdr.undp.org/data-center/human-development-index",
                    "release": "latest HDI dataset entry point; yearly recalculation policy applies",
                    "license": "CC BY 3.0 IGO for HDRO materials unless source-specific terms say otherwise.",
                    "citation": "United Nations Development Programme Human Development Reports Data Center.",
                    "selection_rule": "Pin report release, method note, country table, and revision basis before ingest.",
                }
            ],
            "missing_value_policy": "Latest-available-data gaps must stay null and preserve method-year notes.",
        },
        POP_RECIPE_RELATIVE_PATH: {
            "schema_version": 1,
            "recipe_id": "population_density_grid_manual",
            "title": "Population density grid source recipe",
            "source_family": "GHSL or WorldPop population grids",
            "phase": "foundation_contract",
            "source_policy": "fixture_only",
            "future_source_policy": "real_source_cache_only",
            "generated_at": generated_at,
            "download_policy": {"network_allowed": False, "phase1_real_downloads": False},
            "official_sources": [
                {
                    "source_id": "ghsl_population",
                    "url": "https://human-settlement.emergency.copernicus.eu/data.php",
                    "release": "GHSL Data Package P2023 family; product code and epoch must be pinned.",
                    "license": "CC BY 4.0 with required GHSL release and product citation.",
                    "citation": "Global Human Settlement Layer product and release publications.",
                    "selection_rule": "Pin product code, epoch, resolution, CRS, and NoData marker before ingest.",
                },
                {
                    "source_id": "worldpop_population",
                    "url": "https://www.worldpop.org/faq/",
                    "release": "dataset-specific DOI and production date required",
                    "license": "Dataset pages use CC BY 4.0 and may include ODbL for OSM/Microsoft-derived inputs.",
                    "citation": "WorldPop dataset-specific recommended citation and DOI.",
                    "selection_rule": "Pin DOI, country/global variant, production date, license split, and checksum before ingest.",
                },
            ],
            "missing_value_policy": "Source NoData markers must map to null or neutral cells with explicit audit counts.",
        },
    }


def build_wgi_index_entry(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "layer_id": WGI_LAYER_ID,
        "theme": "political",
        "title": manifest.get("title", "WGI Governance Proxy"),
        "description": manifest.get(
            "description",
            "World Bank WGI admin0 Government Effectiveness and Rule of Law scores with a project-defined state-capacity proxy.",
        ),
        "geometry_kind": "admin0",
        "manifest_path": data_url(WGI_MANIFEST_RELATIVE_PATH),
        "status": manifest.get("status", "experimental"),
        "source_policy": "real_source_cache_only",
        "coverage_scope": f"{manifest.get('feature_counts', {}).get('features', 0)} admin0 ISO_A3 source-cache features",
        "default_visible": False,
        "default_style": {
            "renderer": "choropleth",
            "palette": "viridis_0_100",
            "opacity": 0.72,
            "neutral_value": None,
        },
    }


def build_hdi_index_entry(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "layer_id": HDI_REAL_LAYER_ID,
        "theme": "social",
        "title": manifest["title"],
        "description": manifest["description"],
        "geometry_kind": "admin0",
        "manifest_path": data_url(HDI_REAL_MANIFEST_RELATIVE_PATH),
        "status": manifest["status"],
        "source_policy": manifest["source_policy"],
        "coverage_scope": f"{manifest['feature_counts']['features']} admin0 ISO_A3 source-cache features",
        "default_visible": False,
        "default_style": {"renderer": "choropleth", "palette": "plasma_0_100", "opacity": 0.72, "neutral_value": None},
    }


def build_population_index_entry(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "layer_id": POPULATION_LAYER_ID, "theme": "population",
        "title": manifest["title"], "description": manifest["description"],
        "geometry_kind": "admin0", "manifest_path": data_url(POPULATION_MANIFEST_RELATIVE_PATH),
        "status": manifest["status"], "source_policy": manifest["source_policy"],
        "coverage_scope": f"{manifest['feature_counts']['features']} admin0 ISO_A3 source-cache features",
        "default_visible": False,
        "default_style": {"renderer": "choropleth", "palette": "viridis_0_100", "opacity": 0.72, "neutral_value": None},
    }


def build_index_payload(generated_at: str, *, extra_layers: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    layers = [
        {
            "layer_id": "political_state_capacity_demo",
            "theme": "political",
            "title": "State Capacity Demo",
            "description": "Fixture-only admin0 thematic layer shaped for future WGI-backed ingestion.",
            "geometry_kind": "admin0",
            "manifest_path": data_url(STATE_MANIFEST_RELATIVE_PATH),
            "status": "fixture",
            "source_policy": "fixture_only",
            "coverage_scope": "10 admin0 ISO_A3 demo features",
            "default_visible": False,
            "default_style": {
                "renderer": "choropleth",
                "palette": "viridis_0_100",
                "opacity": 0.72,
                "neutral_value": None,
            },
        },
        {
            "layer_id": "social_human_development_demo",
            "theme": "social",
            "title": "Human Development Demo",
            "description": "Fixture-only admin0 thematic layer shaped for future UNDP HDI ingestion.",
            "geometry_kind": "admin0",
            "manifest_path": data_url(HDI_MANIFEST_RELATIVE_PATH),
            "status": "fixture",
            "source_policy": "fixture_only",
            "coverage_scope": "10 admin0 ISO_A3 demo features",
            "default_visible": False,
            "default_style": {
                "renderer": "choropleth",
                "palette": "plasma_0_100",
                "opacity": 0.72,
                "neutral_value": None,
            },
        },
        {
            "layer_id": "population_density_demo",
            "theme": "population",
            "title": "Population Density Demo",
            "description": "Fixture-only 720x360 grid layer shaped for future GHSL or WorldPop ingestion.",
            "geometry_kind": "grid_720x360",
            "manifest_path": data_url(POP_MANIFEST_RELATIVE_PATH),
            "status": "fixture",
            "source_policy": "fixture_only",
            "coverage_scope": "global 720x360 WGS84 grid",
            "default_visible": False,
            "default_style": {
                "renderer": "grid_heatmap",
                "palette": "inferno_0_255",
                "opacity": 0.55,
                "neutral_value": 0,
            },
        },
    ]
    if extra_layers:
        layers.extend(extra_layers)
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "layers": layers,
        "source_policy_legend": {
            "fixture_only": "Checked-in synthetic data for contract validation only.",
            "manual_seed": "Checked-in manual source rows with explicit provenance.",
            "real_source_cache_only": "Real source files must already exist in a local cache.",
            "external_download_supported": "A later fetcher may download after release and license pinning.",
        },
        "status_legend": {
            "fixture": "Contract and validation fixture.",
            "demo": "Demo data allowed in runtime preview.",
            "experimental": "Real-source candidate that still needs review.",
            "ready": "Pinned, audited, and ready for runtime consumption.",
        },
    }


def manifest_payload(
    *,
    layer_id: str,
    theme: str,
    title: str,
    description: str,
    geometry_kind: str,
    metric_ids: tuple[str, ...],
    period: dict[str, Any],
    feature_counts: dict[str, int],
    data_relative_path: str,
    data_path_key: str,
    build_audit_relative_path: str,
    recipe_relative_paths: tuple[str, ...],
    provenance: list[dict[str, Any]],
    license_metadata: list[str],
    normalization: dict[str, Any],
    runtime_status: str,
    limitations: list[str],
    generated_at: str,
) -> dict[str, Any]:
    paths: dict[str, Any] = {
        data_path_key: data_url(data_relative_path),
        "build_audit": data_url(build_audit_relative_path),
        "source_recipes": [data_url(path) for path in recipe_relative_paths],
    }
    return {
        "schema_version": 1,
        "layer_id": layer_id,
        "theme": theme,
        "title": title,
        "description": description,
        "geometry_kind": geometry_kind,
        "metric_ids": list(metric_ids),
        "period": period,
        "coverage_scope": {
            "geography_level": "grid" if geometry_kind == "grid_720x360" else "admin0",
            "join_key_type": "grid_cell" if geometry_kind == "grid_720x360" else "iso_a3",
            "feature_count": feature_counts["features"],
        },
        "source_policy": "fixture_only",
        "status": "fixture",
        "paths": paths,
        "provenance": provenance,
        "license": {
            "fixture_data": "Synthetic fixture values generated for this repository.",
            "source_metadata": license_metadata,
        },
        "normalization": normalization,
        "feature_counts": feature_counts,
        "build_audit_path": data_url(build_audit_relative_path),
        "generated_at": generated_at,
        "build_command": BUILD_COMMAND,
        "runtime_consumer": {
            "status": runtime_status,
            "entry": "thematic_layer_catalog",
        },
        "limitations": limitations,
    }


def build_audit_payload(
    *,
    layer_id: str,
    recipe_relative_paths: tuple[str, ...],
    coverage_summary: dict[str, int],
    normalization_summary: dict[str, Any],
    source_metadata: list[str],
    warnings: list[str],
    generated_at: str,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "layer_id": layer_id,
        "generated_at": generated_at,
        "builder": {
            "tool": "tools/build_thematic_layers.py",
            "command": BUILD_COMMAND,
        },
        "source_inputs": [
            {
                "recipe_path": data_url(path),
                "source_policy": "fixture_only",
                "status": "declared_requirements_only",
            }
            for path in recipe_relative_paths
        ],
        "coverage_summary": coverage_summary,
        "missing_join_keys": [],
        "unmatched_source_rows": [],
        "dropped_aggregate_rows": [],
        "outliers": [],
        "normalization_summary": normalization_summary,
        "license_summary": {
            "fixture_data": "Synthetic fixture values generated for this repository.",
            "source_metadata": source_metadata,
        },
        "warnings": warnings,
        "fixture_notice": {
            "enabled": True,
            "reason": "Phase 1 locks contracts and catalog plumbing before any real source download.",
        },
    }


def load_existing_wgi_payloads() -> dict[str, dict[str, Any]]:
    existing_paths = {
        relative_path: data_path(relative_path)
        for relative_path in WGI_REAL_OUTPUT_PATHS
        if data_path(relative_path).is_file()
    }
    if not existing_paths:
        return {}
    missing_paths = [relative_path for relative_path in WGI_REAL_OUTPUT_PATHS if relative_path not in existing_paths]
    if missing_paths:
        formatted = ", ".join(missing_paths)
        raise FileNotFoundError(f"WGI real-source outputs are incomplete; missing: {formatted}")

    payloads: dict[str, dict[str, Any]] = {}
    for relative_path in WGI_REAL_OUTPUT_PATHS:
        payloads[relative_path] = read_json(existing_paths[relative_path])
    return payloads


def load_existing_hdi_payloads() -> dict[str, dict[str, Any]]:
    existing_paths = {path: data_path(path) for path in HDI_REAL_OUTPUT_PATHS if data_path(path).is_file()}
    if not existing_paths:
        return {}
    missing_paths = [path for path in HDI_REAL_OUTPUT_PATHS if path not in existing_paths]
    if missing_paths:
        raise FileNotFoundError("UNDP HDI real-source outputs are incomplete; missing: " + ", ".join(missing_paths))
    return {path: read_json(existing_paths[path]) for path in HDI_REAL_OUTPUT_PATHS}


def load_existing_population_payloads() -> dict[str, dict[str, Any]]:
    existing_paths = {path: data_path(path) for path in POPULATION_OUTPUT_PATHS if data_path(path).is_file()}
    if not existing_paths:
        return {}
    missing_paths = [path for path in POPULATION_OUTPUT_PATHS if path not in existing_paths]
    if missing_paths:
        raise FileNotFoundError("WDI population real-source outputs are incomplete; missing: " + ", ".join(missing_paths))
    return {path: read_json(existing_paths[path]) for path in POPULATION_OUTPUT_PATHS}


def build_payloads(
    generated_at: str,
    *,
    wgi_payloads: dict[str, dict[str, Any]] | None = None,
    include_existing_wgi: bool = False,
    hdi_payloads: dict[str, dict[str, Any]] | None = None,
    include_existing_hdi: bool = True,
    population_payloads: dict[str, dict[str, Any]] | None = None,
    include_existing_population: bool = True,
) -> dict[str, dict[str, Any]]:
    state_metrics = admin_metrics_payload(
        layer_id="political_state_capacity_demo",
        metric_ids=STATE_METRIC_IDS,
        values_by_country=STATE_VALUES,
        year=2024,
        unit="index_0_100",
    )
    hdi_metrics = admin_metrics_payload(
        layer_id="social_human_development_demo",
        metric_ids=HDI_METRIC_IDS,
        values_by_country=HDI_VALUES,
        year=2024,
        unit="index_0_1",
    )
    population_grid = build_population_grid_payload()
    state_counts = coverage_counts_for_admin(state_metrics)
    hdi_counts = coverage_counts_for_admin(hdi_metrics)
    population_counts = {"features": GRID_CELL_COUNT, "complete": GRID_CELL_COUNT, "partial": 0, "missing": 0}

    if wgi_payloads is None and include_existing_wgi:
        wgi_payloads = load_existing_wgi_payloads()
    extra_layers: list[dict[str, Any]] = []
    if wgi_payloads and WGI_MANIFEST_RELATIVE_PATH in wgi_payloads:
        extra_layers.append(build_wgi_index_entry(wgi_payloads[WGI_MANIFEST_RELATIVE_PATH]))
    if hdi_payloads is None and include_existing_hdi:
        hdi_payloads = load_existing_hdi_payloads()
    if hdi_payloads and HDI_REAL_MANIFEST_RELATIVE_PATH in hdi_payloads:
        extra_layers.append(build_hdi_index_entry(hdi_payloads[HDI_REAL_MANIFEST_RELATIVE_PATH]))
    if population_payloads is None and include_existing_population:
        population_payloads = load_existing_population_payloads()
    if population_payloads and POPULATION_MANIFEST_RELATIVE_PATH in population_payloads:
        extra_layers.append(build_population_index_entry(population_payloads[POPULATION_MANIFEST_RELATIVE_PATH]))

    payloads: dict[str, dict[str, Any]] = {
        INDEX_RELATIVE_PATH: build_index_payload(generated_at, extra_layers=extra_layers),
        STATE_METRICS_RELATIVE_PATH: state_metrics,
        HDI_METRICS_RELATIVE_PATH: hdi_metrics,
        POP_GRID_RELATIVE_PATH: population_grid,
        **recipe_payloads(generated_at),
    }
    if wgi_payloads:
        payloads.update(wgi_payloads)
    if hdi_payloads:
        payloads.update(hdi_payloads)
    if population_payloads:
        payloads.update(population_payloads)

    payloads[STATE_MANIFEST_RELATIVE_PATH] = manifest_payload(
        layer_id="political_state_capacity_demo",
        theme="political",
        title="State Capacity Demo",
        description="Fixture-only admin0 layer that reserves WGI-shaped provenance and missing-value semantics.",
        geometry_kind="admin0",
        metric_ids=STATE_METRIC_IDS,
        period={"kind": "year", "year": 2024, "label": "2024 fixture", "basis": "WGI annual release shape only"},
        feature_counts=state_counts,
        data_relative_path=STATE_METRICS_RELATIVE_PATH,
        data_path_key="metrics",
        build_audit_relative_path=STATE_AUDIT_RELATIVE_PATH,
        recipe_relative_paths=(WGI_RECIPE_RELATIVE_PATH,),
        provenance=[
            {
                "source_id": "world_bank_wgi",
                "name": "Worldwide Governance Indicators",
                "url": "https://datacatalog.worldbank.org/search/dataset/0038026/worldwide-governance-indicators",
                "release": "version 7 latest; updated 2026-03-18; coverage 1996-2024",
                "published_at": "2026-03-18",
                "accessed_at": generated_at,
                "license": "World Bank catalog license metadata, usually CC BY 4.0 unless custom metadata applies.",
                "citation": "World Bank Worldwide Governance Indicators Data Catalog entry.",
                "selection_rule": "Use country-year rows after release, year, and indicator subset are pinned.",
            }
        ],
        license_metadata=["World Bank Data Catalog license metadata; release pin required before real ingest."],
        normalization={"method": "manual_fixture_linear_0_100", "range": [0, 100]},
        runtime_status="catalog_only",
        limitations=[
            "Values are synthetic fixtures and must not be shown as real WGI observations.",
            "Real WGI ingestion requires a pinned release package and source checksum.",
        ],
        generated_at=generated_at,
    )

    payloads[HDI_MANIFEST_RELATIVE_PATH] = manifest_payload(
        layer_id="social_human_development_demo",
        theme="social",
        title="Human Development Demo",
        description="Fixture-only admin0 layer that reserves UNDP HDI provenance and recalculation semantics.",
        geometry_kind="admin0",
        metric_ids=HDI_METRIC_IDS,
        period={"kind": "year", "year": 2024, "label": "2024 fixture", "basis": "HDI latest-available-data shape only"},
        feature_counts=hdi_counts,
        data_relative_path=HDI_METRICS_RELATIVE_PATH,
        data_path_key="metrics",
        build_audit_relative_path=HDI_AUDIT_RELATIVE_PATH,
        recipe_relative_paths=(HDI_RECIPE_RELATIVE_PATH,),
        provenance=[
            {
                "source_id": "undp_hdi",
                "name": "Human Development Index",
                "url": "https://hdr.undp.org/data-center/human-development-index",
                "release": "latest HDI dataset entry point; yearly recalculation policy applies",
                "accessed_at": generated_at,
                "license": "CC BY 3.0 IGO for HDRO materials unless source-specific terms say otherwise.",
                "citation": "United Nations Development Programme Human Development Reports Data Center.",
                "selection_rule": "Use pinned report tables and method notes after release-year selection.",
            }
        ],
        license_metadata=["UNDP HDRO terms use CC BY 3.0 IGO and yearly recalculation guidance."],
        normalization={"method": "manual_fixture_hdi_0_1_to_0_100", "range": [0, 100]},
        runtime_status="catalog_only",
        limitations=[
            "Values are synthetic fixtures and must not be shown as real HDI observations.",
            "Real HDI ingestion requires a pinned report release and methodology note.",
        ],
        generated_at=generated_at,
    )

    payloads[POP_MANIFEST_RELATIVE_PATH] = manifest_payload(
        layer_id="population_density_demo",
        theme="population",
        title="Population Density Demo",
        description="Fixture-only 720x360 RLE grid that reserves population density grid contracts.",
        geometry_kind="grid_720x360",
        metric_ids=("population_density_intensity_demo",),
        period={"kind": "fixture", "label": "global grid fixture", "basis": "GHSL or WorldPop grid shape only"},
        feature_counts=population_counts,
        data_relative_path=POP_GRID_RELATIVE_PATH,
        data_path_key="grid",
        build_audit_relative_path=POP_AUDIT_RELATIVE_PATH,
        recipe_relative_paths=(POP_RECIPE_RELATIVE_PATH,),
        provenance=[
            {
                "source_id": "ghsl_population",
                "name": "Global Human Settlement Layer population products",
                "url": "https://human-settlement.emergency.copernicus.eu/data.php",
                "release": "GHSL Data Package P2023 family; product code and epoch must be pinned.",
                "accessed_at": generated_at,
                "license": "CC BY 4.0 with GHSL release and product citation.",
                "citation": "GHSL release publication and selected product publication.",
                "selection_rule": "Pin product code, epoch, resolution, CRS, and NoData marker before ingest.",
            },
            {
                "source_id": "worldpop_population",
                "name": "WorldPop gridded population datasets",
                "url": "https://www.worldpop.org/faq/",
                "release": "dataset-specific DOI and production date required",
                "accessed_at": generated_at,
                "license": "Dataset-specific CC BY 4.0 and possible ODbL split.",
                "citation": "WorldPop dataset-specific DOI and recommended citation.",
                "selection_rule": "Pin DOI, variant, production date, license split, and checksum before ingest.",
            },
        ],
        license_metadata=[
            "GHSL uses CC BY 4.0 with release/product citation.",
            "WorldPop dataset pages provide DOI-specific citation and license split.",
        ],
        normalization={"method": "manual_fixture_intensity_0_255_to_0_100", "range": [0, 255]},
        runtime_status="catalog_only",
        limitations=[
            "Grid values are synthetic fixtures and must not be shown as real population density.",
            "Real grid ingestion requires pinned product code, epoch, resolution, and NoData mapping.",
        ],
        generated_at=generated_at,
    )

    payloads[STATE_AUDIT_RELATIVE_PATH] = build_audit_payload(
        layer_id="political_state_capacity_demo",
        recipe_relative_paths=(WGI_RECIPE_RELATIVE_PATH,),
        coverage_summary=state_counts,
        normalization_summary={"method": "manual_fixture_linear_0_100", "missing_value_policy": "null"},
        source_metadata=["World Bank WGI metadata only; real values not ingested."],
        warnings=["Fixture-only layer. Real-source download is intentionally out of scope for phase 1."],
        generated_at=generated_at,
    )
    payloads[HDI_AUDIT_RELATIVE_PATH] = build_audit_payload(
        layer_id="social_human_development_demo",
        recipe_relative_paths=(HDI_RECIPE_RELATIVE_PATH,),
        coverage_summary=hdi_counts,
        normalization_summary={"method": "manual_fixture_hdi_0_1_to_0_100", "missing_value_policy": "null"},
        source_metadata=["UNDP HDI metadata only; real values not ingested."],
        warnings=["Fixture-only layer. Real-source download is intentionally out of scope for phase 1."],
        generated_at=generated_at,
    )
    payloads[POP_AUDIT_RELATIVE_PATH] = build_audit_payload(
        layer_id="population_density_demo",
        recipe_relative_paths=(POP_RECIPE_RELATIVE_PATH,),
        coverage_summary=population_counts,
        normalization_summary={"method": "manual_fixture_intensity_0_255", "rle_runs": len(population_grid["data"])},
        source_metadata=["GHSL and WorldPop metadata only; real grid files not ingested."],
        warnings=["Fixture-only grid. Real-source download is intentionally out of scope for phase 1."],
        generated_at=generated_at,
    )

    return payloads


def validate_payloads(payloads: dict[str, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for relative_path, payload in sorted(payloads.items()):
        source_label = data_url(relative_path)
        if relative_path == INDEX_RELATIVE_PATH:
            errors.extend(validate_thematic_layer_index(payload, source_label=source_label))
        elif relative_path.endswith("/manifest.json"):
            errors.extend(validate_thematic_layer_manifest(payload, source_label=source_label))
        elif relative_path.endswith("/metrics.admin0.json"):
            errors.extend(validate_thematic_admin_metrics(payload, source_label=source_label))
        elif relative_path.endswith("/grid.rle.json"):
            errors.extend(validate_thematic_grid_rle(payload, source_label=source_label))
        elif relative_path.endswith("/build_audit.json"):
            errors.extend(validate_thematic_build_audit(payload, source_label=source_label))
    return errors


def runtime_asset_registry_entry(relative_path: str, *, role: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "url": data_url(relative_path),
        "role": role,
        "metadata": metadata,
    }


def update_runtime_asset_registry(payloads: dict[str, dict[str, Any]], *, only_layer_ids: set[str] | None = None) -> None:
    registry_path = DATA_ROOT / "runtime_asset_registry.json"
    registry = read_json(registry_path)
    assets = registry.setdefault("assets", {})
    if not isinstance(assets, dict):
        raise ValueError("data/runtime_asset_registry.json assets must be an object.")

    if only_layer_ids is not None and "thematic_layer_catalog" in assets:
        assets["thematic_layer_catalog"]["metadata"]["layer_count"] = len(payloads[INDEX_RELATIVE_PATH]["layers"])
    else:
        assets["thematic_layer_catalog"] = runtime_asset_registry_entry(
            INDEX_RELATIVE_PATH,
            role="thematic_layer_catalog",
            metadata={
                "layer_count": len(payloads[INDEX_RELATIVE_PATH]["layers"]),
                "publish_scope": THEMATIC_RUNTIME_PUBLISH_SCOPE,
                "runtime_readiness": THEMATIC_RUNTIME_READINESS,
            },
        )
    manifest_keys: dict[str, str] = dict(registry.get("thematic_layer_manifest_keys", {})) if only_layer_ids is not None else {}
    for layer in payloads[INDEX_RELATIVE_PATH]["layers"]:
        layer_id = str(layer["layer_id"])
        if only_layer_ids is not None and layer_id not in only_layer_ids:
            continue
        asset_key = f"thematic_layer:{layer_id}"
        manifest_path = str(layer["manifest_path"]).removeprefix("data/")
        manifest = payloads.get(manifest_path)
        if manifest is None:
            manifest = read_json(data_path(manifest_path))
        assets[asset_key] = runtime_asset_registry_entry(
            manifest_path,
            role="thematic_layer_manifest",
            metadata={
                "layer_id": layer_id,
                "source_policy": manifest["source_policy"],
                "theme": manifest["theme"],
                "geometry_kind": manifest["geometry_kind"],
                "publish_scope": THEMATIC_RUNTIME_PUBLISH_SCOPE,
                "runtime_readiness": manifest.get("runtime_consumer", {}).get("status", THEMATIC_RUNTIME_READINESS),
                **({
                    "data_version": WGI_RUNTIME_DATA_VERSION,
                    "supported_metrics": list(WGI_RUNTIME_METRIC_IDS),
                    "supported_scenarios": list(WGI_RUNTIME_SCENARIO_IDS),
                    "method": WGI_RUNTIME_METHOD,
                    "historical_reference_policy": build_wgi_historical_reference_policy(),
                } if layer_id == WGI_LAYER_ID else hdi_runtime_selection() if layer_id == HDI_REAL_LAYER_ID
                   else population_runtime_selection() if layer_id == POPULATION_LAYER_ID else {}),
            },
        )
        manifest_keys[layer_id] = asset_key

    if WGI_LAYER_ID in manifest_keys and (only_layer_ids is None or WGI_LAYER_ID in only_layer_ids):
        for asset_key, relative_path, role, schema_ref in (
            ("thematic_wgi_metrics", WGI_METRICS_RELATIVE_PATH, "thematic_admin_metrics", "map_builder/schemas/thematic_admin_metrics.schema.json"),
            ("thematic_wgi_country_mapping", WGI_COUNTRY_MAPPING_RELATIVE_PATH, "thematic_country_mapping", "map_builder/schemas/thematic_wgi_country_mapping.schema.json"),
        ):
            assets[asset_key] = runtime_asset_registry_entry(
                relative_path,
                role=role,
                metadata={
                    "layer_id": WGI_LAYER_ID,
                    "data_version": WGI_RUNTIME_DATA_VERSION,
                    "supported_metrics": list(WGI_RUNTIME_METRIC_IDS),
                    "supported_scenarios": list(WGI_RUNTIME_SCENARIO_IDS),
                    "method": WGI_RUNTIME_METHOD,
                    "historical_reference_policy": build_wgi_historical_reference_policy(),
                    "runtime_readiness": "main_map_ready",
                },
            )
            assets[asset_key]["schema_ref"] = schema_ref

    if HDI_REAL_LAYER_ID in manifest_keys and (only_layer_ids is None or HDI_REAL_LAYER_ID in only_layer_ids):
        assets["thematic_hdi_metrics"] = runtime_asset_registry_entry(
            HDI_REAL_METRICS_RELATIVE_PATH,
            role="thematic_admin_metrics",
            metadata={"layer_id": HDI_REAL_LAYER_ID, **hdi_runtime_selection(), "runtime_readiness": "main_map_ready"},
        )
        assets["thematic_hdi_metrics"]["schema_ref"] = "map_builder/schemas/thematic_admin_metrics.schema.json"

    if POPULATION_LAYER_ID in manifest_keys and (only_layer_ids is None or POPULATION_LAYER_ID in only_layer_ids):
        assets["thematic_population_metrics"] = runtime_asset_registry_entry(
            POPULATION_METRICS_RELATIVE_PATH,
            role="thematic_admin_metrics",
            metadata={"layer_id": POPULATION_LAYER_ID, **population_runtime_selection(), "runtime_readiness": "main_map_ready"},
        )
        assets["thematic_population_metrics"]["schema_ref"] = "map_builder/schemas/thematic_admin_metrics.schema.json"

    registry["thematic_layer_index_key"] = "thematic_layer_catalog"
    registry["thematic_layer_manifest_keys"] = manifest_keys
    write_json(registry_path, registry)


def build_manifest_output_metadata(relative_path: str, path: Path) -> dict[str, Any]:
    artifact_spec = DATA_ARTIFACT_SPECS_BY_PATH[relative_path]
    item: dict[str, Any] = {
        "role": artifact_spec.role,
        "artifact_class": artifact_spec.artifact_class,
        "owner": artifact_spec.owner,
        "description": artifact_spec.description,
        "size_bytes": path.stat().st_size,
        "sha256": file_sha256(path),
    }
    if artifact_spec.schema_ref:
        item["schema_ref"] = artifact_spec.schema_ref

    payload = read_json(path) if path.suffix == ".json" else {}
    if not isinstance(payload, dict):
        return item
    if relative_path == INDEX_RELATIVE_PATH:
        item.update({"type": "thematic_layer_index", "layer_count": len(payload.get("layers") or [])})
    elif relative_path.endswith("/manifest.json"):
        item.update(
            {
                "type": "thematic_layer_manifest",
                "layer_id": payload.get("layer_id", ""),
                "theme": payload.get("theme", ""),
                "geometry_kind": payload.get("geometry_kind", ""),
            }
        )
    elif relative_path.endswith("/metrics.admin0.json"):
        item.update(
            {
                "type": "thematic_admin_metrics",
                "layer_id": payload.get("layer_id", ""),
                "metric_count": len(payload.get("metric_ids") or []),
                "feature_count": len(payload.get("features") or []),
            }
        )
    elif relative_path.endswith("/grid.rle.json"):
        item.update(
            {
                "type": "thematic_grid_rle",
                "layer_id": payload.get("layer_id", ""),
                "rle_run_count": len(payload.get("data") or []),
            }
        )
    elif relative_path.endswith("/build_audit.json"):
        item.update(
            {
                "type": "thematic_build_audit",
                "layer_id": payload.get("layer_id", ""),
                "warning_count": len(payload.get("warnings") or []),
            }
        )
    elif relative_path.endswith(".manual.json"):
        item.update(
            {
                "type": "thematic_source_recipe",
                "recipe_id": payload.get("recipe_id", ""),
                "source_family": payload.get("source_family", ""),
                "source_policy": payload.get("source_policy", ""),
            }
        )
    return item


def refresh_data_manifest(output_paths: tuple[str, ...] = MANIFEST_REFRESH_PATHS) -> None:
    manifest_path = DATA_ROOT / "manifest.json"
    manifest = read_json(manifest_path)
    outputs = manifest.setdefault("outputs", {})
    if not isinstance(outputs, dict):
        raise ValueError("data/manifest.json outputs must be an object.")

    for relative_path in output_paths:
        if relative_path not in DATA_ARTIFACT_SPECS_BY_PATH:
            raise KeyError(f"Missing DataArtifactSpec for {relative_path}")
        path = data_path(relative_path)
        if not path.is_file():
            raise FileNotFoundError(f"Cannot refresh data manifest; output missing: {path}")
        outputs[relative_path] = build_manifest_output_metadata(relative_path, path)

    manifest["runtime_asset_registry"] = load_runtime_asset_registry()
    write_json(manifest_path, manifest)


def manifest_refresh_paths_for_payloads(payloads: dict[str, dict[str, Any]]) -> tuple[str, ...]:
    return (*tuple(payloads.keys()), "runtime_asset_registry.json")


def main() -> None:
    args = parse_args()
    requested_payloads: dict[str, dict[str, Any]] = {}
    entries: list[dict[str, Any]] = []
    if args.include_wgi_real:
        wgi_payloads = build_wgi_real_source_payloads(
            args.wgi_source_cache_path,
            generated_at=args.generated_at,
        )
        requested_payloads.update(wgi_payloads)
        entries.append(build_wgi_index_entry(wgi_payloads[WGI_MANIFEST_RELATIVE_PATH]))
    if args.include_hdi_real:
        hdi_payloads = build_hdi_real_source_payloads(args.hdi_source_cache_path, generated_at=args.generated_at)
        requested_payloads.update(hdi_payloads)
        entries.append(build_hdi_index_entry(hdi_payloads[HDI_REAL_MANIFEST_RELATIVE_PATH]))
    if getattr(args, "include_population_real", False):
        population_payloads = build_population_real_source_payloads(args.population_source_cache_dir, generated_at=args.generated_at)
        requested_payloads.update(population_payloads)
        entries.append(build_population_index_entry(population_payloads[POPULATION_MANIFEST_RELATIVE_PATH]))
    only_layer_ids = {entry["layer_id"] for entry in entries} if entries else None
    if entries:
        # Patch only the requested real layers; preserve unrelated catalog entries and files.
        index = read_json(data_path(INDEX_RELATIVE_PATH))
        for entry in entries:
            matches = [i for i, layer in enumerate(index["layers"]) if layer["layer_id"] == entry["layer_id"]]
            if matches:
                index["layers"][matches[0]] = entry
            else:
                index["layers"].append(entry)
        payloads = {INDEX_RELATIVE_PATH: index, **requested_payloads}
    else:
        payloads = build_payloads(
            args.generated_at,
            include_existing_wgi=True,
        )
    errors = validate_payloads(payloads)
    if errors:
        raise SystemExit("\n".join(errors))

    for relative_path in payloads:
        write_json(data_path(relative_path), payloads[relative_path])

    if not args.skip_runtime_registry:
        update_runtime_asset_registry(payloads, only_layer_ids=only_layer_ids)
    if not args.skip_data_manifest:
        refresh_data_manifest(manifest_refresh_paths_for_payloads(payloads))

    print(
        "[Thematic Layers] "
        f"layers={len(payloads[INDEX_RELATIVE_PATH]['layers'])} "
        f"outputs={len(payloads)} "
        f"generated_at={args.generated_at}"
    )


if __name__ == "__main__":
    main()
