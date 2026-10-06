"""Ingest five pinned WDI population indicators from complete local API caches."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from map_builder.thematic_wgi_ingest import (
    DEFAULT_GENERATED_AT, WGI_AUDITED_TARGET_JOIN_KEYS, WGI_COUNTRY_MAPPING_RELATIVE_PATH,
    WGI_RUNTIME_SCENARIO_IDS, build_wgi_historical_reference_policy,
    coverage_counts_for_admin, source_signature,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
POPULATION_LAYER_ID = "population_wdi_population_v1"
POPULATION_SELECTED_YEAR = 2023
POPULATION_SOURCE_VERSION = "2026-07-13"
POPULATION_RUNTIME_DATA_VERSION = "wdi-2026-07-13:2023"
POPULATION_SOURCE_CACHE_RELATIVE_PATH = ".runtime/source-cache/thematic/wdi-population"
DEFAULT_POPULATION_SOURCE_CACHE_DIR = REPO_ROOT / POPULATION_SOURCE_CACHE_RELATIVE_PATH
POPULATION_MANIFEST_RELATIVE_PATH = "thematic_layers/population/wdi_population_v1/manifest.json"
POPULATION_METRICS_RELATIVE_PATH = "thematic_layers/population/wdi_population_v1/metrics.admin0.json"
POPULATION_AUDIT_RELATIVE_PATH = "thematic_layers/population/wdi_population_v1/build_audit.json"
POPULATION_RECIPE_RELATIVE_PATH = "thematic_layers/source_recipes/wdi_population_v1.manual.json"
POPULATION_OUTPUT_PATHS = (POPULATION_RECIPE_RELATIVE_PATH, POPULATION_MANIFEST_RELATIVE_PATH,
                           POPULATION_METRICS_RELATIVE_PATH, POPULATION_AUDIT_RELATIVE_PATH)
POPULATION_METRICS = {
    "wdi_population_total": ("SP.POP.TOTL", "persons"),
    "wdi_population_density": ("EN.POP.DNST", "persons_per_km2"),
    "wdi_urban_population_share": ("SP.URB.TOTL.IN.ZS", "percent"),
    "wdi_population_65_plus_share": ("SP.POP.65UP.TO.ZS", "percent"),
    "wdi_total_fertility_rate": ("SP.DYN.TFRT.IN", "births_per_woman"),
}
POPULATION_RUNTIME_METRIC_IDS = tuple(POPULATION_METRICS)
# Official country metadata codes absent from the existing WGI target list.
# CHI is deliberately excluded: its Channel Islands value cannot be split into islands.
POPULATION_AUDITED_TARGET_JOIN_KEYS = WGI_AUDITED_TARGET_JOIN_KEYS | frozenset(
    {"CUW", "FRO", "GIB", "IMN", "MAF", "MNP", "SXM", "TCA", "VGB"})
POPULATION_LICENSE = "CC BY 4.0"
POPULATION_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
POPULATION_COUNTRIES_URL = "https://api.worldbank.org/v2/country?format=json&per_page=400"
POPULATION_RUNTIME_METHOD = (
    "Official World Development Indicators 2023 country population, density, urban share, "
    "age-65-plus share and fertility raw values; main-map colors use raw-value bins. "
    "Auxiliary 0-100 values are project linear scalings, not World Bank scores. "
    "Historical scenarios show baseline-owner 2023 references, not historical population estimates. "
    "Country density is not a population raster."
)
POPULATION_NORMALIZATION = {
    "method": "official_raw_values_with_auxiliary_project_linear_scaling",
    "range": [0, 100],
    "formulas": {
        "wdi_population_total": "clamp(raw / 1500000000 * 100, 0, 100)",
        "wdi_population_density": "clamp(raw / 1000 * 100, 0, 100)",
        "wdi_urban_population_share": "raw",
        "wdi_population_65_plus_share": "raw",
        "wdi_total_fertility_rate": "clamp(raw / 8 * 100, 0, 100)",
    },
    "raw_value_policy": "Preserve every finite valid source value without rounding or clipping.",
    "missing_value_policy": "Only JSON null or an absent country observation is source_gap; malformed source values fail the build.",
    "notes": ["Auxiliary normalized values are project linear scalings, not World Bank scores or front-end bins."],
}


def population_runtime_selection() -> dict[str, Any]:
    policy = build_wgi_historical_reference_policy()
    policy.update({
        "reference_year": POPULATION_SELECTED_YEAR,
        "join_method": "Baseline owner tag -> explicit scenarioCountriesByTag[tag].base_iso2 -> existing ISO2-to-ISO3 mapping -> official WDI country value.",
        "interpretation": "2023 country reference values, not observed historical or subnational measurements; no historical population totals or population raster are computed.",
    })
    return {"data_version": POPULATION_RUNTIME_DATA_VERSION,
            "supported_metrics": list(POPULATION_RUNTIME_METRIC_IDS),
            "supported_scenarios": list(WGI_RUNTIME_SCENARIO_IDS),
            "country_code_mapping": f"data/{WGI_COUNTRY_MAPPING_RELATIVE_PATH}",
            "method": POPULATION_RUNTIME_METHOD, "historical_reference_policy": policy}


def normalize_population_metric(metric_id: str, raw: int | float) -> float:
    if POPULATION_METRICS[metric_id][1] == "percent":
        return raw
    divisors = {"wdi_population_total": 1_500_000_000, "wdi_population_density": 1000,
                "wdi_total_fertility_rate": 8, "wdi_urban_population_share": 100,
                "wdi_population_65_plus_share": 100}
    return min(100.0, max(0.0, raw / divisors[metric_id] * 100))


def _parse_raw(value: object, metric_id: str) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"Malformed WDI value for {metric_id}: {value!r}")
    if value < 0 or (POPULATION_METRICS[metric_id][1] == "percent" and value > 100):
        raise ValueError(f"Out-of-range WDI value for {metric_id}: {value!r}")
    if metric_id == "wdi_population_total" and int(value) != value:
        raise ValueError(f"Non-integer WDI population total: {value!r}")
    return value


def _read_api_cache(path: Path, *, indicator: bool = False) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if not path.is_file():
        raise FileNotFoundError(f"WDI source cache is missing: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[0], dict)
            or not isinstance(payload[1], list) or not payload[1]):
        raise ValueError(f"Malformed WDI API response: {path.name}")
    meta, rows = payload
    # Require one complete page; never treat a truncated source page as missing data.
    try:
        valid_page = (int(meta["page"]) == 1 and int(meta["pages"]) == 1
                      and int(meta["total"]) == len(rows) and int(meta["per_page"]) >= len(rows))
    except (KeyError, TypeError, ValueError):
        valid_page = False
    if not valid_page:
        raise ValueError(f"Incomplete or truncated WDI API page: {path.name}")
    if indicator and (str(meta.get("sourceid")) != "2" or meta.get("lastupdated") != POPULATION_SOURCE_VERSION):
        raise ValueError(f"WDI source/revision mismatch: {path.name}")
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError(f"Malformed WDI row: {path.name}")
    signature = source_signature(path)
    evidence = {"source_cache_path": signature.repo_relative_path, "source_sha256": signature.sha256,
                "source_size_bytes": signature.size_bytes, "api_metadata": meta}
    return meta, rows, evidence


def build_population_real_source_payloads(
    source_cache_dir: Path = DEFAULT_POPULATION_SOURCE_CACHE_DIR, *,
    generated_at: str = DEFAULT_GENERATED_AT, accessed_at: str | None = None,
) -> dict[str, dict[str, Any]]:
    accessed_at = accessed_at or generated_at
    _, country_rows, country_evidence = _read_api_cache(source_cache_dir / "countries.json")
    by_iso2: dict[str, dict[str, Any]] = {}
    by_iso3: dict[str, dict[str, Any]] = {}
    for row in country_rows:
        code, iso2 = row.get("id"), row.get("iso2Code")
        region = row.get("region")
        if (not isinstance(code, str) or not code or not isinstance(iso2, str) or not iso2
                or not isinstance(region, dict) or not region.get("id") or not row.get("name")):
            raise ValueError("Malformed WDI country metadata")
        if code in by_iso3 or iso2 in by_iso2:
            raise ValueError(f"Duplicate WDI country metadata: {code}/{iso2}")
        if region["id"] != "NA" and code != "CHI" and code not in POPULATION_AUDITED_TARGET_JOIN_KEYS:
            raise ValueError(f"Unknown WDI country code requires audit: {code}")
        by_iso2[iso2], by_iso3[code] = row, row
    official_sources = [{"source_id": "world_bank_country_metadata", "url": POPULATION_COUNTRIES_URL,
                         "accessed_at": accessed_at, **country_evidence}]
    observations: dict[str, dict[str, dict[str, Any]]] = {}
    aggregate_rows: list[dict[str, Any]] = []
    excluded_rows: list[dict[str, Any]] = []
    source_row_count = 0
    missing_rows: list[dict[str, str]] = []
    expected_country_ids = {code for code, row in by_iso3.items() if row["region"]["id"] != "NA" and code != "CHI"}
    for metric_id, (indicator_code, unit) in POPULATION_METRICS.items():
        _, rows, evidence = _read_api_cache(source_cache_dir / f"{indicator_code}.json", indicator=True)
        official_sources.append({
            "source_id": "world_bank_wdi_population", "name": "World Bank World Development Indicators",
            "url": f"https://data.worldbank.org/indicator/{indicator_code}",
            "source_package_url": f"https://api.worldbank.org/v2/country/all/indicator/{indicator_code}?format=json&date=2023&per_page=400&source=2",
            "metadata_url": f"https://databank.worldbank.org/metadataglossary/world-development-indicators/series/{indicator_code}",
            "release": "World Development Indicators", "version": POPULATION_SOURCE_VERSION,
            "selected_year": POPULATION_SELECTED_YEAR, "indicator_code": indicator_code,
            "accessed_at": accessed_at, "license": POPULATION_LICENSE, "license_url": POPULATION_LICENSE_URL,
            "terms_url": "https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets",
            "citation": f"World Bank, World Development Indicators, {indicator_code}, 2023; updated {POPULATION_SOURCE_VERSION}.",
            "selection_rule": "Complete source-2 API page for 2023, pinned to revision 2026-07-13; classify with official country metadata and exclude aggregates and CHI.",
            **evidence,
        })
        seen: set[str] = set()
        for row_number, row in enumerate(rows, start=1):
            source_row_count += 1
            if (not isinstance(row.get("indicator"), dict) or row["indicator"].get("id") != indicator_code
                    or row.get("date") != str(POPULATION_SELECTED_YEAR) or "value" not in row):
                raise ValueError(f"WDI indicator/year/observation mismatch: {indicator_code}:row:{row_number}")
            country = row.get("country")
            iso2 = country.get("id") if isinstance(country, dict) else None
            if iso2 not in by_iso2:
                raise ValueError(f"Unknown WDI country code: {iso2!r}")
            meta = by_iso2[iso2]
            code = meta["id"]
            if code in seen:
                raise ValueError(f"Duplicate WDI country observation: {indicator_code}/{code}")
            seen.add(code)
            source_iso3 = row.get("countryiso3code")
            if source_iso3 != code and not (meta["region"]["id"] == "NA" and source_iso3 == ""):
                raise ValueError(f"WDI country ISO3 mismatch: {iso2}/{source_iso3}/{code}")
            raw = _parse_raw(row["value"], metric_id)
            row_ref = f"{indicator_code}.json:row:{row_number}"
            audit_row = {"source_name": meta["name"], "source_code": code, "source_iso2": iso2,
                         "metric_id": metric_id, "year": POPULATION_SELECTED_YEAR, "source_row_ref": row_ref}
            if meta["region"]["id"] == "NA":
                aggregate_rows.append(audit_row | {"reason": "country_metadata_region_NA_aggregate"})
                continue
            if code == "CHI":
                excluded_rows.append(audit_row | {"reason": "Channel_Islands_composite_has_no_single_ISO3_target"})
                continue
            observations.setdefault(code, {})[metric_id] = {
                "raw_value": raw, "normalized_value": normalize_population_metric(metric_id, raw) if raw is not None else None,
                "year": POPULATION_SELECTED_YEAR, "unit": unit,
                "source_status": "observed" if raw is not None else "source_gap",
                "source_country_code": code, "source_row_ref": row_ref,
                "notes": f"Official WDI {indicator_code} raw value; auxiliary project linear scaling is not a World Bank score. Main-map colors use raw-value bins.",
            }
    if not observations:
        raise ValueError("WDI source cache produced no admin0 countries")
    features = []
    for code in sorted(expected_country_ids):
        values = observations.setdefault(code, {})
        for metric_id, (indicator_code, unit) in POPULATION_METRICS.items():
            if metric_id not in values:
                values[metric_id] = {"raw_value": None, "normalized_value": None, "year": POPULATION_SELECTED_YEAR,
                                     "unit": unit, "source_status": "source_gap", "source_country_code": code,
                                     "notes": f"No {indicator_code} observation in the complete pinned API response."}
                missing_rows.append({"join_key": code, "metric_id": metric_id})
        gaps = sum(value["raw_value"] is None for value in values.values())
        features.append({"join_key": code, "name": by_iso3[code]["name"], "source_country_codes": [code],
                         "coverage_status": "missing" if gaps == len(values) else "partial" if gaps else "complete", "values": values})
    metrics = {"schema_version": 1, "layer_id": POPULATION_LAYER_ID, "geography_level": "admin0",
               "join_key_type": "iso_a3", "metric_ids": list(POPULATION_RUNTIME_METRIC_IDS), "features": features,
               "notes": ["Pinned WDI 2023 country values; aggregates and Channel Islands composite are excluded and audited.",
                         "Population density is country-level persons per land km2, not a raster."]}
    counts = coverage_counts_for_admin(metrics)
    mapping = json.loads((REPO_ROOT / "data" / WGI_COUNTRY_MAPPING_RELATIVE_PATH).read_text(encoding="utf-8"))
    mapping_codes = set(mapping["by_iso_a2"].values())
    runtime_unmapped = [code for code in sorted(observations) if code not in mapping_codes]
    recipe = {
        "schema_version": 1, "recipe_id": "wdi_population_v1", "title": "WDI 2023 population source recipe",
        "source_family": "World Development Indicators population", "phase": "real_source_cache_v1",
        "source_policy": "real_source_cache_only", "generated_at": generated_at,
        "download_policy": {"network_allowed": False, "default_builder_downloads": False,
                            "source_cache_dir": POPULATION_SOURCE_CACHE_RELATIVE_PATH},
        "official_sources": official_sources, "normalization": POPULATION_NORMALIZATION,
        "metric_selection": {"year": POPULATION_SELECTED_YEAR, "version": POPULATION_SOURCE_VERSION,
                             "metrics": {key: {"indicator_code": code, "unit": unit} for key, (code, unit) in POPULATION_METRICS.items()}},
        "runtime_selection": population_runtime_selection(),
        "join_key_policy": {"join_key_type": "iso_a3", "country_classification": "row.country.id -> metadata.iso2Code; cross-check metadata.id with row.countryiso3code",
                            "aggregate_rule": "metadata.region.id == NA", "excluded_composite_codes": ["CHI"],
                            "unknown_codes_fail_closed": True, "name_fuzzy_matching": False},
        "missing_value_policy": POPULATION_NORMALIZATION["missing_value_policy"],
    }
    limitations = ["Country-level values do not measure individual historical or subnational regions.",
                   "Historical scenarios use 2023 baseline-owner reference values; no historical totals are calculated.",
                   "Country population density is not a GHSL/WorldPop raster or spatial population estimate.",
                   "Auxiliary normalized values are project linear scalings, not World Bank scores; map bins use raw values.",
                   "Channel Islands composite is excluded rather than split across Jersey and Guernsey.",
                   "Countries without an existing runtime mapping retain source values but may have no map match: " + ", ".join(runtime_unmapped)]
    manifest = {
        "schema_version": 1, "layer_id": POPULATION_LAYER_ID, "theme": "population", "title": "WDI Population",
        "description": "Official WDI 2023 country population total, density, urban share, age-65-plus share and fertility values.",
        "geometry_kind": "admin0", "metric_ids": list(POPULATION_RUNTIME_METRIC_IDS),
        "period": {"kind": "year", "year": POPULATION_SELECTED_YEAR, "label": "2023", "basis": "World Development Indicators"},
        "coverage_scope": {"geography_level": "admin0", "join_key_type": "iso_a3", "feature_count": len(features), "source_year": POPULATION_SELECTED_YEAR},
        "source_policy": "real_source_cache_only", "status": "experimental",
        "paths": {"metrics": f"data/{POPULATION_METRICS_RELATIVE_PATH}", "build_audit": f"data/{POPULATION_AUDIT_RELATIVE_PATH}", "source_recipes": [f"data/{POPULATION_RECIPE_RELATIVE_PATH}"]},
        "provenance": official_sources[1:], "license": {"fixture_data": "none", "source_metadata": [POPULATION_LICENSE], "attribution_required": True},
        "normalization": POPULATION_NORMALIZATION, "feature_counts": counts,
        "build_audit_path": f"data/{POPULATION_AUDIT_RELATIVE_PATH}", "generated_at": generated_at,
        "build_command": "python tools/build_thematic_layers.py --include-population-real",
        "runtime_consumer": {"status": "main_map_ready", "entry": "thematic_wgi_runtime", "supports_main_map_render": True, **population_runtime_selection()},
        "limitations": limitations,
    }
    metric_coverage = {metric_id: {"observed": sum(feature["values"][metric_id]["source_status"] == "observed" for feature in features),
                                  "source_gap": sum(feature["values"][metric_id]["source_status"] == "source_gap" for feature in features)} for metric_id in POPULATION_METRICS}
    audit = {
        "schema_version": 1, "layer_id": POPULATION_LAYER_ID, "generated_at": generated_at,
        "builder": {"tool": "tools/build_thematic_layers.py", "command": manifest["build_command"], "ingest_module": "map_builder.thematic_population_ingest"},
        "source_inputs": [{**source, "recipe_path": f"data/{POPULATION_RECIPE_RELATIVE_PATH}", "source_policy": "real_source_cache_only", "status": "local_cache_observed"} for source in official_sources],
        "coverage_summary": {**counts, "selected_year": POPULATION_SELECTED_YEAR, "version": POPULATION_SOURCE_VERSION,
                             "join_key_type": "iso_a3", "source_rows": source_row_count, "metric_count": len(POPULATION_METRICS), "metrics": metric_coverage,
                             "country_metadata_rows": len(country_rows), "country_metadata_countries": sum(row["region"]["id"] != "NA" for row in country_rows),
                             "country_metadata_aggregates": sum(row["region"]["id"] == "NA" for row in country_rows),
                             "source_rows_unmatched": len(excluded_rows), "source_rows_dropped_aggregate": len(aggregate_rows),
                             "runtime_unmapped_join_keys": runtime_unmapped},
        "missing_join_keys": missing_rows, "unmatched_source_rows": excluded_rows, "dropped_aggregate_rows": aggregate_rows,
        "outliers": [], "normalization_summary": POPULATION_NORMALIZATION,
        "license_summary": {"fixture_data": "none", "source_metadata": [POPULATION_LICENSE], "attribution_required": True},
        "warnings": ([f"{counts['partial']} countries have partial source coverage."] if counts["partial"] else [])
                    + ["Channel Islands composite excluded; no island-level population is inferred."]
                    + (["Source values without existing runtime mapping: " + ", ".join(runtime_unmapped)] if runtime_unmapped else []),
        "fixture_notice": {"enabled": False, "reason": "Built from five official WDI 2023 API caches with the same pinned revision."},
    }
    return {POPULATION_RECIPE_RELATIVE_PATH: recipe, POPULATION_MANIFEST_RELATIVE_PATH: manifest,
            POPULATION_METRICS_RELATIVE_PATH: metrics, POPULATION_AUDIT_RELATIVE_PATH: audit}
