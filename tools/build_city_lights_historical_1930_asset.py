#!/usr/bin/env python3
"""Build a static 1930s electrification proxy asset from world city data."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_PATH = PROJECT_ROOT / "data" / "world_cities.geojson"
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "js" / "core" / "city_lights_historical_1930_asset.js"
DEFAULT_EXCLUSIONS_PATH = PROJECT_ROOT / "data" / "historical_city_lights_1930_exclusions.json"
DEFAULT_HIERARCHY_PATH = PROJECT_ROOT / "data" / "hierarchy.json"
DEFAULT_POPULATION_THRESHOLD = 1_200_000
DEFAULT_ADMIN_CAPITAL_POPULATION_THRESHOLD = 400_000
CALIBRATION_VERSION = "balanced-2026-04"
EUROPE_INTENSIVE_SUBREGIONS = {
    "subregion_northern_europe",
    "subregion_southern_europe",
    "subregion_western_europe",
}
US_COASTAL_HUB_NAMES = {
    "new york",
    "boston",
    "philadelphia",
    "baltimore",
    "washington",
    "los angeles",
    "san francisco",
    "seattle",
    "portland",
    "san diego",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a static 1930s electrification proxy asset module."
    )
    parser.add_argument(
        "--source-file",
        default=str(DEFAULT_SOURCE_PATH),
        help="Source world cities GeoJSON path.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Output JS module path.",
    )
    parser.add_argument(
        "--exclusions-file",
        default=str(DEFAULT_EXCLUSIONS_PATH),
        help="Optional JSON file with manual post-1930 city exclusions.",
    )
    parser.add_argument(
        "--hierarchy-file",
        default=str(DEFAULT_HIERARCHY_PATH),
        help="Country hierarchy metadata used for regional 1930s light calibration.",
    )
    parser.add_argument(
        "--population-threshold",
        type=int,
        default=DEFAULT_POPULATION_THRESHOLD,
        help="Keep non-capital cities at or above this population.",
    )
    parser.add_argument(
        "--admin-capital-population-threshold",
        type=int,
        default=DEFAULT_ADMIN_CAPITAL_POPULATION_THRESHOLD,
        help="Keep admin-capital cities at or above this population.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def load_features(source_path: Path) -> list[dict]:
    payload = read_json(source_path)
    features = payload.get("features", []) if isinstance(payload, dict) else []
    return features if isinstance(features, list) else []


def load_exclusions(path: Path) -> set[tuple[str, str]]:
    if not path.exists():
        return set()
    payload = read_json(path)
    exclusions: set[tuple[str, str]] = set()
    for entry in payload if isinstance(payload, list) else []:
        if not isinstance(entry, dict):
            continue
        country_code = str(entry.get("country_code") or "").strip().upper()
        name_ascii = str(entry.get("name_ascii") or "").strip().lower()
        if country_code and name_ascii:
            exclusions.add((country_code, name_ascii))
    return exclusions


def load_country_meta(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    payload = read_json(path)
    if not isinstance(payload, dict):
        return {}
    country_groups = payload.get("country_groups", {})
    if not isinstance(country_groups, dict):
        return {}
    country_meta = country_groups.get("country_meta", {})
    return country_meta if isinstance(country_meta, dict) else {}


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def resolve_calibration(
    *,
    country_code: str,
    name_ascii: str,
    base_tier: str,
    country_meta: dict[str, dict],
) -> dict[str, float | bool]:
    meta = country_meta.get(country_code, {})
    continent_id = str(meta.get("continent_id") or "").strip().lower()
    subregion_id = str(meta.get("subregion_id") or "").strip().lower()
    city_name = name_ascii.strip().lower()
    is_europe = continent_id == "continent_europe"
    is_europe_intensive = subregion_id in EUROPE_INTENSIVE_SUBREGIONS
    is_us_coastal_hub = country_code == "US" and city_name in US_COASTAL_HUB_NAMES
    is_japan = country_code == "JP"
    is_asian_population_cap = country_code in {"CN", "IN"}

    return {
        "weight_multiplier": 1.16 if is_europe_intensive else 1.10 if is_europe else 1.04 if is_japan else 1.0,
        "admin_bonus": 0.03 if is_japan else 0.0,
        "admin_population_threshold": 250_000.0 if is_europe else 0.0,
        "ordinary_population_threshold": 900_000.0 if is_europe and base_tier == "major" else 0.0,
        "admin_min_weight": 0.65 if is_europe_intensive else 0.63 if is_europe else 0.0,
        "ordinary_min_weight": 0.74 if is_europe_intensive else 0.72 if is_europe else 0.76 if is_us_coastal_hub else 0.0,
        "ordinary_force_keep": is_us_coastal_hub,
        "asian_population_cap": is_asian_population_cap,
    }


def compute_weight(
    population: float,
    *,
    is_country_capital: bool,
    is_admin_capital: bool,
    calibration: dict[str, float | bool],
) -> float:
    log_pop = math.log10(max(population, 1.0))
    population_component = clamp((log_pop - 4.9) / 2.0, 0.0, 1.0)
    weight = population_component * 0.72
    if is_country_capital:
        weight += 0.28
    elif is_admin_capital:
        weight += 0.16
    weight *= float(calibration.get("weight_multiplier") or 1.0)
    if is_admin_capital:
        weight += float(calibration.get("admin_bonus") or 0.0)
        weight = max(weight, float(calibration.get("admin_min_weight") or 0.0))
    elif not is_country_capital:
        weight = max(weight, float(calibration.get("ordinary_min_weight") or 0.0))
    if bool(calibration.get("asian_population_cap")) and not is_country_capital and population >= 20_000_000:
        weight = min(weight, 0.96)
    return round(clamp(weight, 0.18, 1.0), 4)


def build_entries(
    features: list[dict],
    exclusions: set[tuple[str, str]],
    population_threshold: int,
    admin_capital_population_threshold: int,
    country_meta: dict[str, dict],
) -> tuple[list[dict], dict[str, float | int | str]]:
    entries: list[dict] = []
    excluded_count = 0
    country_capital_count = 0
    admin_capital_count = 0

    for feature in features:
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        geometry = feature.get("geometry", {}) if isinstance(feature, dict) else {}
        if not isinstance(props, dict) or not isinstance(geometry, dict):
            continue

        country_code = str(props.get("country_code") or "").strip().upper()
        name_ascii = str(props.get("name_ascii") or props.get("name_en") or props.get("name") or "").strip()
        exclusion_key = (country_code, name_ascii.lower())
        if exclusion_key in exclusions:
            excluded_count += 1
            continue

        is_country_capital = bool(props.get("is_country_capital"))
        is_admin_capital = bool(props.get("is_admin_capital"))
        population = float(props.get("population") or 0)
        base_tier = str(props.get("base_tier") or "").strip().lower()
        calibration = resolve_calibration(
            country_code=country_code,
            name_ascii=name_ascii,
            base_tier=base_tier,
            country_meta=country_meta,
        )
        keep_entry = (
            is_country_capital
            or (
                is_admin_capital
                and population >= float(calibration.get("admin_population_threshold") or admin_capital_population_threshold)
            )
            or population >= float(calibration.get("ordinary_population_threshold") or population_threshold)
            or bool(calibration.get("ordinary_force_keep"))
        )
        if not keep_entry:
            continue

        coordinates = geometry.get("coordinates", []) if geometry.get("type") == "Point" else []
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            continue
        lon = float(coordinates[0])
        lat = float(coordinates[1])
        capital_kind = str(props.get("capital_kind") or "").strip() or "none"

        if is_country_capital:
            country_capital_count += 1
        elif is_admin_capital:
            admin_capital_count += 1

        entries.append(
            {
                "lon": round(lon, 5),
                "lat": round(lat, 5),
                "weight": compute_weight(
                    population,
                    is_country_capital=is_country_capital,
                    is_admin_capital=is_admin_capital,
                    calibration=calibration,
                ),
                "capitalKind": capital_kind,
                "population": int(round(population)),
                "nameAscii": name_ascii,
                "countryCode": country_code,
            }
        )

    entries.sort(
        key=lambda entry: (
            -float(entry["weight"]),
            -int(entry["population"]),
            str(entry["nameAscii"]).lower(),
        )
    )
    weights = [float(entry["weight"]) for entry in entries]
    stats: dict[str, float | int | str] = {
        "entryCount": len(entries),
        "countryCapitalCount": country_capital_count,
        "adminCapitalCount": admin_capital_count,
        "excludedCount": excluded_count,
        "populationThreshold": population_threshold,
        "adminCapitalPopulationThreshold": admin_capital_population_threshold,
        "calibrationVersion": CALIBRATION_VERSION,
        "maxWeight": round(max(weights), 4) if weights else 0.0,
        "meanWeight": round(sum(weights) / len(weights), 4) if weights else 0.0,
    }
    return entries, stats


def format_object_literal(payload: dict[str, object], indent: str = "  ") -> str:
    lines: list[str] = ["{"]
    keys = list(payload.keys())
    for index, key in enumerate(keys):
        suffix = "," if index < len(keys) - 1 else ""
        lines.append(f"{indent}{key}: {json.dumps(payload[key], ensure_ascii=False)}{suffix}")
    lines.append("}")
    return "\n".join(lines)


def format_entries(entries: list[dict], indent: str = "  ") -> str:
    lines: list[str] = []
    for entry in entries:
        lines.append(f"{indent}{format_object_literal(entry, indent=indent + '  ')},")
    return "\n".join(lines)


def write_module(
    output_path: Path,
    *,
    source_ref: str,
    exclusions_ref: str,
    entries: list[dict],
    stats: dict[str, float | int | str],
) -> None:
    module_text = f"""// Generated by tools/build_city_lights_historical_1930_asset.py
// Source: {source_ref}
// Manual exclusions: {exclusions_ref}
// Historical city lights are a 1930s electrification proxy derived from world city metadata.

export const HISTORICAL_1930_CITY_LIGHTS_SOURCE = Object.freeze({format_object_literal({
    "name": "1930s electrification proxy",
    "source": source_ref,
    "exclusions": exclusions_ref,
})});

export const HISTORICAL_1930_CITY_LIGHTS_STATS = Object.freeze({format_object_literal(stats)});

export const HISTORICAL_1930_CITY_LIGHTS_ENTRIES = Object.freeze([
{format_entries(entries)}
]);
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(module_text, encoding="utf-8")


def main() -> int:
    args = parse_args()
    source_path = Path(args.source_file).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    exclusions_path = Path(args.exclusions_file).expanduser().resolve()
    hierarchy_path = Path(args.hierarchy_file).expanduser().resolve()

    if not source_path.exists():
        raise SystemExit(f"Source file not found: {source_path}")

    features = load_features(source_path)
    exclusions = load_exclusions(exclusions_path)
    country_meta = load_country_meta(hierarchy_path)
    entries, stats = build_entries(
        features,
        exclusions,
        args.population_threshold,
        args.admin_capital_population_threshold,
        country_meta,
    )
    write_module(
        output_path,
        source_ref=source_path.as_uri(),
        exclusions_ref=exclusions_path.as_uri(),
        entries=entries,
        stats=stats,
    )
    print(
        f"Built historical city lights asset: {output_path} "
        f"(entries={stats['entryCount']}, country_capitals={stats['countryCapitalCount']}, "
        f"admin_capitals={stats['adminCapitalCount']}, max_weight={stats['maxWeight']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
