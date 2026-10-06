"""Ingest the pinned UNDP HDR 2025 country table from a local CSV cache."""
from __future__ import annotations

import csv
import math
from pathlib import Path
from typing import Any

from map_builder.thematic_wgi_ingest import (
    DEFAULT_GENERATED_AT, WGI_AUDITED_TARGET_JOIN_KEYS, WGI_COUNTRY_MAPPING_RELATIVE_PATH,
    WGI_RUNTIME_SCENARIO_IDS, build_wgi_historical_reference_policy, coverage_counts_for_admin,
    source_signature,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
HDI_LAYER_ID = "social_human_development_v1"
HDI_SELECTED_YEAR = 2023
HDI_RUNTIME_DATA_VERSION = "undp-hdr-2025:2023"
HDI_SOURCE_CACHE_RELATIVE_PATH = ".runtime/source-cache/thematic/undp/HDR25_Composite_indices_complete_time_series.csv"
DEFAULT_HDI_SOURCE_CACHE_PATH = REPO_ROOT / HDI_SOURCE_CACHE_RELATIVE_PATH
HDI_SOURCE_URL = "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv"
HDI_DOCUMENTATION_URL = "https://hdr.undp.org/data-center/documentation-and-downloads"
HDI_TECHNICAL_NOTES_URL = "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Technical_Notes.pdf"
HDI_LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/igo/"
HDI_TERMS_URL = "https://hdr.undp.org/terms-use"
HDI_LICENSE = "CC BY 3.0 IGO"
HDI_RELEASE = "Human Development Report 2025"
HDI_MANIFEST_RELATIVE_PATH = "thematic_layers/social/human_development_v1/manifest.json"
HDI_METRICS_RELATIVE_PATH = "thematic_layers/social/human_development_v1/metrics.admin0.json"
HDI_AUDIT_RELATIVE_PATH = "thematic_layers/social/human_development_v1/build_audit.json"
HDI_RECIPE_RELATIVE_PATH = "thematic_layers/source_recipes/undp_hdi_v1.manual.json"
HDI_OUTPUT_PATHS = (HDI_RECIPE_RELATIVE_PATH, HDI_MANIFEST_RELATIVE_PATH, HDI_METRICS_RELATIVE_PATH, HDI_AUDIT_RELATIVE_PATH)
HDI_METRICS = {
    "undp_hdi": ("hdi_2023", "index_0_1"),
    "undp_life_expectancy": ("le_2023", "years"),
    "undp_expected_schooling": ("eys_2023", "years"),
    "undp_mean_schooling": ("mys_2023", "years"),
    "undp_gni_per_capita": ("gnipc_2023", "usd_2021_ppp"),
}
HDI_RUNTIME_METRIC_IDS = tuple(HDI_METRICS)
HDI_RUNTIME_METHOD = (
    "Official UNDP HDR 2025 country values for 2023 passed through as raw values; "
    "main-map colors use raw-value bins, with official HDI thresholds at 0.55, 0.7 and 0.8. "
    "Component bins are fixed cartographic ranges, not official UNDP categories. "
    "Auxiliary normalized values use HDI x 100 and the report's dimension goalposts on a clipped 0-100 scale for other consumers. "
    "Modern World uses geographic country codes; historical scenarios use baseline owner reference mapping."
)
HDI_NORMALIZATION = {
    "method": "official_raw_values_with_auxiliary_goalpost_normalized_values",
    "range": [0, 100],
    "technical_notes_url": HDI_TECHNICAL_NOTES_URL,
    "technical_notes_page": 2,
    "formulas": {
        "undp_hdi": "raw * 100",
        "undp_life_expectancy": "clamp((raw - 20) / (85 - 20) * 100, 0, 100)",
        "undp_expected_schooling": "clamp(raw / 18 * 100, 0, 100)",
        "undp_mean_schooling": "clamp(raw / 15 * 100, 0, 100)",
        "undp_gni_per_capita": "clamp(log(raw / 100) / log(75000 / 100) * 100, 0, 100)",
    },
    "raw_value_policy": "Preserve every finite valid source value without rounding or clipping.",
    "notes": [
        "Auxiliary normalized values preserve the existing 0-100 data contract for other consumers; main-map colors use raw-value bins.",
        "HDI raw-value bins use official thresholds at 0.55, 0.7 and 0.8; component bins use fixed cartographic ranges and are not official UNDP categories.",
        "The auxiliary normalization is a project transformation of the attributed UNDP source values; it does not change raw values.",
    ],
    "missing_value_policy": "Missing, unknown or invalid source values remain null; never reconstruct HDI or fill from another edition.",
}


def build_hdi_historical_reference_policy() -> dict[str, Any]:
    policy = build_wgi_historical_reference_policy()
    policy["reference_year"] = HDI_SELECTED_YEAR
    policy["join_method"] = "Baseline owner tag -> scenarioCountriesByTag[tag].base_iso2 (explicit two-letter ISO2) -> existing ISO2-to-ISO3 mapping -> official UNDP country value."
    policy["interpretation"] = "2023 human development reference values mapped to scenario baseline owners; not observed measurements for historical years."
    return policy


def hdi_runtime_selection() -> dict[str, Any]:
    return {
        "data_version": HDI_RUNTIME_DATA_VERSION,
        "supported_metrics": list(HDI_RUNTIME_METRIC_IDS),
        "supported_scenarios": list(WGI_RUNTIME_SCENARIO_IDS),
        "country_code_mapping": f"data/{WGI_COUNTRY_MAPPING_RELATIVE_PATH}",
        "method": HDI_RUNTIME_METHOD,
        "historical_reference_policy": build_hdi_historical_reference_policy(),
    }


def _parse_raw(value: object, metric_id: str) -> float | None:
    try:
        raw = float(str(value).strip())
    except (ValueError, TypeError):
        return None
    if not math.isfinite(raw) or raw < 0:
        return None
    if metric_id == "undp_hdi" and raw > 1:
        return None
    if metric_id == "undp_gni_per_capita" and raw <= 0:
        return None
    return raw


def normalize_hdi_metric(metric_id: str, raw: float) -> float:
    if metric_id == "undp_hdi":
        score = raw * 100
    elif metric_id == "undp_life_expectancy":
        score = (raw - 20) / 65 * 100
    elif metric_id == "undp_expected_schooling":
        score = raw / 18 * 100
    elif metric_id == "undp_mean_schooling":
        score = raw / 15 * 100
    elif metric_id == "undp_gni_per_capita":
        score = math.log(raw / 100) / math.log(75000 / 100) * 100
    else:
        raise ValueError(f"Unknown UNDP metric: {metric_id}")
    return min(100.0, max(0.0, score))


def build_hdi_real_source_payloads(
    source_path: Path = DEFAULT_HDI_SOURCE_CACHE_PATH,
    *,
    generated_at: str = DEFAULT_GENERATED_AT,
    accessed_at: str | None = None,
) -> dict[str, dict[str, Any]]:
    accessed_at = accessed_at or generated_at
    if not source_path.is_file():
        raise FileNotFoundError(f"UNDP source cache is missing: {source_path.resolve()}")
    signature = source_signature(source_path)
    if signature.path.suffix.lower() != ".csv":
        raise ValueError("UNDP HDR 2025 source cache must be a CSV file")
    features: list[dict[str, Any]] = []
    aggregate_rows: list[dict[str, Any]] = []
    unmatched_rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    source_row_count = 0
    with signature.path.open(encoding="cp1252", newline="") as handle:
        reader = csv.DictReader(handle)
        required_columns = {"iso3", "country", *(column for column, _ in HDI_METRICS.values())}
        missing_columns = required_columns.difference(reader.fieldnames or [])
        if missing_columns:
            raise ValueError("UNDP HDR 2025 CSV missing required columns: " + ", ".join(sorted(missing_columns)))
        for row_number, row in enumerate(reader, start=2):
            source_row_count += 1
            code = str(row["iso3"] or "").strip().upper()
            name = str(row["country"] or "").strip()
            row_ref = f"{signature.path.name}:row:{row_number}"
            audit_row = {"source_name": name, "source_code": code, "year": HDI_SELECTED_YEAR, "source_row_ref": row_ref}
            if code.startswith("ZZ"):
                aggregate_rows.append(audit_row | {"reason": "aggregate_row"})
                continue
            if code not in WGI_AUDITED_TARGET_JOIN_KEYS:
                unmatched_rows.append(audit_row | {"reason": "unmatched_join_key"})
                continue
            if code in seen:
                raise ValueError(f"Duplicate UNDP country ISO3: {code}")
            seen.add(code)
            values = {}
            for metric_id, (column, unit) in HDI_METRICS.items():
                raw = _parse_raw(row[column], metric_id)
                values[metric_id] = {
                    "raw_value": raw,
                    "normalized_value": normalize_hdi_metric(metric_id, raw) if raw is not None else None,
                    "year": HDI_SELECTED_YEAR,
                    "unit": unit,
                    "source_status": "observed" if raw is not None else "source_gap",
                    "source_country_code": code,
                    "source_row_ref": row_ref,
                    "notes": (
                        f"UNDP HDR 2025 {column} source value; auxiliary normalization does not alter the raw value. "
                        + ("Main-map colors use raw-value bins at official HDI thresholds 0.55, 0.7 and 0.8."
                           if metric_id == "undp_hdi" else
                           "Main-map colors use raw-value bins with fixed cartographic ranges, not official UNDP categories.")
                    ),
                }
            missing_count = sum(value["raw_value"] is None for value in values.values())
            features.append({
                "join_key": code, "name": name or code,
                "coverage_status": "missing" if missing_count == len(values) else "partial" if missing_count else "complete",
                "source_country_codes": [code], "values": values,
            })
    if not features:
        raise ValueError("UNDP source cache produced no admin0 countries")
    features.sort(key=lambda feature: feature["join_key"])
    metrics = {
        "schema_version": 1, "layer_id": HDI_LAYER_ID, "geography_level": "admin0",
        "join_key_type": "iso_a3", "metric_ids": list(HDI_RUNTIME_METRIC_IDS), "features": features,
        "notes": ["Pinned HDR 2025 source values for 2023; aggregate rows are excluded and audited.", "HDI is passed through from the source and never reconstructed from component values."],
    }
    counts = coverage_counts_for_admin(metrics)
    source = {
        "source_id": "undp_hdr_2025", "name": "UNDP Human Development Reports",
        "url": HDI_DOCUMENTATION_URL, "source_package_url": HDI_SOURCE_URL,
        "technical_notes_url": HDI_TECHNICAL_NOTES_URL, "release": HDI_RELEASE, "version": "2025",
        "accessed_at": accessed_at, "selected_year": HDI_SELECTED_YEAR,
        "license": HDI_LICENSE, "license_url": HDI_LICENSE_URL, "terms_url": HDI_TERMS_URL,
        "citation": "United Nations Development Programme, Human Development Report 2025, composite indices complete time series.",
        "selection_rule": "Use country ISO3 rows and the five pinned 2023 columns; exclude all ZZ aggregate rows and never fill from another report edition.",
        "source_cache_path": signature.repo_relative_path, "source_sha256": signature.sha256,
        "source_size_bytes": signature.size_bytes, "source_encoding": "cp1252",
    }
    recipe = {
        "schema_version": 1, "recipe_id": "undp_hdi_v1", "title": "UNDP HDR 2025 real-source recipe",
        "source_family": "UNDP Human Development Index", "phase": "real_source_cache_v1",
        "source_policy": "real_source_cache_only", "generated_at": generated_at,
        "download_policy": {"network_allowed": False, "default_builder_downloads": False, "source_cache_path": HDI_SOURCE_CACHE_RELATIVE_PATH},
        "official_sources": [source],
        "metric_selection": {"year": HDI_SELECTED_YEAR, "metrics": {key: {"source_column": column, "unit": unit} for key, (column, unit) in HDI_METRICS.items()}},
        "normalization": HDI_NORMALIZATION, "runtime_selection": hdi_runtime_selection(),
        "join_key_policy": {"join_key_type": "iso_a3", "aggregate_prefix": "ZZ", "unmatched_rows_are_audited": True, "name_fuzzy_matching": False},
        "missing_value_policy": HDI_NORMALIZATION["missing_value_policy"],
    }
    manifest = {
        "schema_version": 1, "layer_id": HDI_LAYER_ID, "theme": "social", "title": "UNDP Human Development",
        "description": "Official UNDP HDR 2025 country HDI, life expectancy, schooling and GNI per capita values for 2023.",
        "geometry_kind": "admin0", "metric_ids": list(HDI_RUNTIME_METRIC_IDS),
        "period": {"kind": "year", "year": HDI_SELECTED_YEAR, "label": "2023", "basis": HDI_RELEASE},
        "coverage_scope": {"geography_level": "admin0", "join_key_type": "iso_a3", "feature_count": len(features), "source_year": HDI_SELECTED_YEAR},
        "source_policy": "real_source_cache_only", "status": "experimental",
        "paths": {"metrics": f"data/{HDI_METRICS_RELATIVE_PATH}", "build_audit": f"data/{HDI_AUDIT_RELATIVE_PATH}", "source_recipes": [f"data/{HDI_RECIPE_RELATIVE_PATH}"]},
        "provenance": [source], "license": {"fixture_data": "none", "source_metadata": [HDI_LICENSE], "attribution_required": True},
        "normalization": HDI_NORMALIZATION, "feature_counts": counts,
        "build_audit_path": f"data/{HDI_AUDIT_RELATIVE_PATH}", "generated_at": generated_at,
        "build_command": "python tools/build_thematic_layers.py --include-hdi-real",
        "runtime_consumer": {"status": "main_map_ready", "entry": "thematic_wgi_runtime", "supports_main_map_render": True, **hdi_runtime_selection()},
        "limitations": [
            "Country-level source data does not measure individual historical or subnational regions.",
            "Auxiliary normalized values use report goalposts for other consumers; main-map colors use raw-value bins and raw source values remain unchanged.",
            "HDI raw-value bins use official thresholds at 0.55, 0.7 and 0.8; component bins are cartographic ranges, not official UNDP categories.",
            "Historical scenarios show 2023 reference values through explicit baseline owner mappings, not historical measurements.",
            "Missing source values remain blank; no HDI reconstruction or cross-edition imputation is performed.",
        ],
    }
    metric_coverage = {
        metric_id: {"observed": sum(feature["values"][metric_id]["source_status"] == "observed" for feature in features), "source_gap": sum(feature["values"][metric_id]["source_status"] == "source_gap" for feature in features)}
        for metric_id in HDI_RUNTIME_METRIC_IDS
    }
    audit = {
        "schema_version": 1, "layer_id": HDI_LAYER_ID, "generated_at": generated_at,
        "builder": {"tool": "tools/build_thematic_layers.py", "command": manifest["build_command"], "ingest_module": "map_builder.thematic_hdi_ingest"},
        "source_inputs": [{**source, "recipe_path": f"data/{HDI_RECIPE_RELATIVE_PATH}", "source_policy": "real_source_cache_only", "status": "local_cache_observed"}],
        "coverage_summary": {**counts, "selected_year": HDI_SELECTED_YEAR, "join_key_type": "iso_a3", "source_rows": source_row_count, "metric_count": len(HDI_METRICS), "metrics": metric_coverage, "source_rows_unmatched": len(unmatched_rows), "source_rows_dropped_aggregate": len(aggregate_rows)},
        "missing_join_keys": [], "unmatched_source_rows": unmatched_rows, "dropped_aggregate_rows": aggregate_rows,
        "outliers": [], "normalization_summary": HDI_NORMALIZATION,
        "license_summary": {"fixture_data": "none", "source_metadata": [HDI_LICENSE], "attribution_required": True},
        "warnings": ([f"{counts['partial']} countries have partial source coverage."] if counts["partial"] else []) + ([f"{len(unmatched_rows)} source rows have unmatched ISO3 codes."] if unmatched_rows else []),
        "fixture_notice": {"enabled": False, "reason": "Built from the pinned official UNDP HDR 2025 local CSV cache."},
    }
    return {HDI_RECIPE_RELATIVE_PATH: recipe, HDI_MANIFEST_RELATIVE_PATH: manifest, HDI_METRICS_RELATIVE_PATH: metrics, HDI_AUDIT_RELATIVE_PATH: audit}
