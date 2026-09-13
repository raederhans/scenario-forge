"""Bounded source processor registry for regional topology compute units.

Provides deterministic selection of safe regional compute units for modern
source country codes (ISO2), expanding coupled units (e.g. RU -> RU+UA,
CZ -> CZ+SK, NA -> US+CA+MX) while strictly preserving nonselected countries.
"""
from __future__ import annotations

from dataclasses import dataclass
import importlib
from typing import Any, Callable, Iterable

import geopandas as gpd
import pandas as pd

from map_builder import config as cfg


@dataclass(frozen=True)
class ProcessorUnit:
    """Declared regional compute unit with source country coverage and entry point."""

    name: str
    countries: tuple[str, ...]
    callable: str
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "countries": list(self.countries),
            "callable": self.callable,
            "reason": self.reason,
        }


_DEDICATED_PROCESSOR_UNITS: tuple[ProcessorUnit, ...] = (
    ProcessorUnit(
        name="france_master_precision",
        countries=("FR",),
        callable="map_builder.processors.france:apply_france_master_precision",
        reason="France master arrondissement precision restoration.",
    ),
    ProcessorUnit(
        name="north_america",
        countries=("CA", "MX", "US"),
        callable="map_builder.processors.north_america:apply_north_america_replacement",
        reason="North America joint detail replacement (US, CA, MX hybrid tiers).",
    ),
    ProcessorUnit(
        name="denmark_border_detail",
        countries=("DK",),
        callable="map_builder.processors.denmark_border_detail:apply_denmark_border_detail",
        reason="Denmark local border-detail refinement for North Schleswig.",
    ),
    ProcessorUnit(
        name="cz_sk_border_detail",
        countries=("CZ", "SK"),
        callable="map_builder.processors.cz_sk_border_detail:apply_cz_sk_border_detail",
        reason="Full CZ/SK ADM2 replacement and historical subset tagging.",
    ),
    ProcessorUnit(
        name="belarus",
        countries=("BY",),
        callable="map_builder.processors.belarus:apply_belarus_replacement",
        reason="Belarus hybrid replacement processor.",
    ),
    ProcessorUnit(
        name="russia_ukraine",
        countries=("RU", "UA"),
        callable="map_builder.processors.russia_ukraine:apply_russia_ukraine_replacement",
        reason="Russia and Ukraine joint hybrid replacement processor.",
    ),
    ProcessorUnit(
        name="au_city_overrides",
        countries=("AU",),
        callable="map_builder.processors.au_city_overrides:apply_au_city_overrides",
        reason="Australian urban area city-level overrides.",
    ),
)


def _configured_basic_units() -> tuple[ProcessorUnit, ...]:
    dedicated_codes = {code for unit in _DEDICATED_PROCESSOR_UNITS for code in unit.countries}
    africa_codes = sorted(set(cfg.AFRICA_BASIC_NE_COUNTRIES) | set(cfg.AFRICA_BASIC_GB_OVERRIDES))
    global_codes = sorted(
        set(cfg.GLOBAL_BASIC_NE_COUNTRY_RULES)
        | set(cfg.GLOBAL_BASIC_SPECIAL_SOURCES)
        | set(cfg.GLOBAL_BASIC_PASSTHROUGH_COUNTRIES)
    )
    return tuple(
        [
            ProcessorUnit(
                name=f"africa_admin1:{code}",
                countries=(code,),
                callable="map_builder.processors.africa_admin1:apply_africa_admin1_replacement",
                reason=f"Configured Africa admin1 detail for {code}.",
            )
            for code in africa_codes
            if code not in dedicated_codes
        ]
        + [
            ProcessorUnit(
                name=f"global_basic_admin1:{code}",
                countries=(code,),
                callable="map_builder.processors.global_basic_admin1:apply_global_basic_admin1_replacement",
                reason=f"Configured global basic admin1 detail for {code}.",
            )
            for code in global_codes
            if code not in dedicated_codes
        ]
    )


REGIONAL_PROCESSOR_UNITS: tuple[ProcessorUnit, ...] = _DEDICATED_PROCESSOR_UNITS + _configured_basic_units()

COUNTRY_TO_UNIT: dict[str, ProcessorUnit] = {
    code: unit
    for unit in REGIONAL_PROCESSOR_UNITS
    for code in unit.countries
}

SUPPORTED_COUNTRY_CODES: frozenset[str] = frozenset(COUNTRY_TO_UNIT.keys())

EXPLICIT_UNSUPPORTED_BROAD_SCOPE_PROCESSORS: tuple[str, ...] = (
    "africa_admin1",
    "global_basic_admin1",
)


def get_supported_country_codes() -> frozenset[str]:
    """Return the set of supported modern ISO2 source country codes."""
    return SUPPORTED_COUNTRY_CODES


def get_supported_coverage_limits() -> dict[str, Any]:
    """Return explicit supported coverage limits, coupled expansions, and policy exclusions."""
    return {
        "supported_countries": sorted(SUPPORTED_COUNTRY_CODES),
        "coupled_expansions": {
            "RU": ["RU", "UA"],
            "UA": ["RU", "UA"],
            "CZ": ["CZ", "SK"],
            "SK": ["CZ", "SK"],
            "US": ["CA", "MX", "US"],
            "CA": ["CA", "MX", "US"],
            "MX": ["CA", "MX", "US"],
        },
        "unsupported_broad_scope_processors": list(EXPLICIT_UNSUPPORTED_BROAD_SCOPE_PROCESSORS),
        "policy": (
            "Modern source country codes must be 2-letter ISO2 codes (not 3-letter scenario owners or aliases). "
            "Countries outside bounded coverage require explicit replacement GeoJSON."
        ),
    }


def _validate_source_country_code(raw_code: Any) -> str:
    if not isinstance(raw_code, str):
        raise ValueError(
            f"Invalid source country code type {type(raw_code).__name__}: '{raw_code}'. "
            "Source country codes must be 2-letter ISO2 strings. Explicit replacement GeoJSON required."
        )
    code = raw_code.strip()
    if not code:
        raise ValueError(
            "Empty source country code provided. Source country codes must be 2-letter ISO2 strings. "
            "Explicit replacement GeoJSON required."
        )
    if len(code) == 3 and code.isalpha():
        raise ValueError(
            f"Alias or scenario owner '{code}' rejected. Source country codes must be 2-letter ISO2 codes "
            f"(e.g., 'RU', not '{code.upper()}'). Explicit replacement GeoJSON required."
        )
    if len(code) != 2 or not code.isalpha():
        raise ValueError(
            f"Invalid source country code '{code}'. Source country codes must be 2-letter ISO2 codes. "
            "Explicit replacement GeoJSON required."
        )
    normalized = code.upper()
    if normalized not in SUPPORTED_COUNTRY_CODES:
        raise ValueError(
            f"Unsupported source country code: '{normalized}'. Bounded processor registry only supports: "
            f"{sorted(SUPPORTED_COUNTRY_CODES)}. Broad dynamic scope or unknown countries require an "
            "explicit replacement GeoJSON instead of dynamic processor selection."
        )
    return normalized


def resolve_processor_units(country_codes: Iterable[str]) -> list[dict[str, Any]]:
    """Select safe compute units for modern source country codes.

    Expands coupled units (e.g. RU -> RU+UA, CZ -> CZ+SK, US -> CA+MX+US)
    by joint operation, and returns units in canonical pipeline order.
    """
    if isinstance(country_codes, str):
        country_codes = [country_codes]

    validated_codes = {_validate_source_country_code(c) for c in country_codes}
    if not validated_codes:
        return []

    needed_units: set[str] = {COUNTRY_TO_UNIT[code].name for code in validated_codes}
    resolved: list[dict[str, Any]] = []
    for unit in REGIONAL_PROCESSOR_UNITS:
        if unit.name in needed_units:
            resolved.append(unit.as_dict())
    return resolved


def _load_callable(import_path: str) -> Callable[[gpd.GeoDataFrame], gpd.GeoDataFrame]:
    if ":" in import_path:
        mod_name, func_name = import_path.split(":", 1)
    else:
        mod_name, func_name = import_path.rsplit(".", 1)
    module = importlib.import_module(mod_name)
    return getattr(module, func_name)


def apply_with_subset_guard(
    processor_fn: Callable[[gpd.GeoDataFrame], gpd.GeoDataFrame],
    master_gdf: gpd.GeoDataFrame,
    target_countries: Iterable[str],
) -> gpd.GeoDataFrame:
    """Wrapper that executes a processor while strictly isolating and preserving non-target country rows."""
    if master_gdf.empty:
        return master_gdf.copy()
    if "cntr_code" not in master_gdf.columns:
        raise ValueError("Regional processor input is missing cntr_code.")
    target_set = {str(c).strip().upper() for c in target_countries}
    codes = master_gdf["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    non_target_mask = ~codes.isin(target_set)
    non_target_gdf = master_gdf[non_target_mask].copy()

    result_gdf = processor_fn(master_gdf.copy())
    if not isinstance(result_gdf, gpd.GeoDataFrame) or "cntr_code" not in result_gdf.columns:
        raise ValueError("Regional processor result must be a GeoDataFrame with cntr_code.")
    result_codes = result_gdf["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    target_result = result_gdf[result_codes.isin(target_set)].copy()
    return gpd.GeoDataFrame(
        pd.concat([non_target_gdf, target_result], ignore_index=True),
        crs=master_gdf.crs or "EPSG:4326",
    )


def apply_selected_processors(
    master_gdf: gpd.GeoDataFrame,
    country_codes: Iterable[str],
    *,
    processor_overrides: dict[str, Callable[[gpd.GeoDataFrame], gpd.GeoDataFrame]] | None = None,
) -> gpd.GeoDataFrame:
    """Apply resolved compute units sequentially, preserving nonselected countries."""
    units = resolve_processor_units(country_codes)
    if not units or master_gdf.empty:
        return master_gdf.copy()

    current = master_gdf.copy()
    index = 0
    while index < len(units):
        unit = units[index]
        unit_name = unit["name"]
        broad_prefix = None
        if unit_name.startswith("africa_admin1:"):
            broad_prefix = "africa_admin1:"
        elif unit_name.startswith("global_basic_admin1:"):
            broad_prefix = "global_basic_admin1:"
        batch = [unit]
        if broad_prefix is not None and unit_name not in (processor_overrides or {}):
            while (index + len(batch) < len(units)
                   and units[index + len(batch)]["name"].startswith(broad_prefix)
                   and units[index + len(batch)]["name"] not in (processor_overrides or {})):
                batch.append(units[index + len(batch)])
        target_countries = {code for item in batch for code in item["countries"]}
        override_key = broad_prefix[:-1] if broad_prefix else unit_name
        if processor_overrides and override_key in processor_overrides:
            processor_fn = processor_overrides[override_key]
        elif processor_overrides and len(batch) == 1 and unit_name in processor_overrides:
            processor_fn = processor_overrides[unit_name]
        else:
            processor_fn = _load_callable(unit["callable"])
        before_codes = current["cntr_code"].fillna("").astype(str).str.upper().str.strip()
        expected = set(before_codes[before_codes.isin(target_countries)])
        if broad_prefix is not None:
            result = processor_fn(current.copy(), country_codes=target_countries)
        else:
            result = processor_fn(current.copy())
        if not isinstance(result, gpd.GeoDataFrame) or "cntr_code" not in result.columns:
            raise ValueError(f"Regional processor {unit_name} returned an invalid result.")
        after_codes = result["cntr_code"].fillna("").astype(str).str.upper().str.strip()
        if not expected.issubset(set(after_codes)):
            raise ValueError(f"Regional processor {unit_name} dropped selected countries: {sorted(expected - set(after_codes))}")
        current = apply_with_subset_guard(lambda _ignored: result, current, target_countries)
        index += len(batch)

    return current
