"""Assemble a same-ID regional candidate from an explicit global baseline."""
from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import json
from pathlib import Path
import sys

import geopandas as gpd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import _absolute_topology, _political_frame, replace_regional_geometry


def _read_replacements(path, parser):
    collection = read_json_strict(path)
    if not isinstance(collection, dict) or collection.get("type") != "FeatureCollection":
        parser.error("Replacement input must be a GeoJSON FeatureCollection.")
    features = collection.get("features")
    if not isinstance(features, list) or not features:
        parser.error("Replacement FeatureCollection must be nonempty.")
    if any(not isinstance(item, dict) or not isinstance(item.get("properties"), dict)
           or item["properties"].get("id") is None for item in features):
        parser.error("Every replacement feature requires properties.id.")
    crs = collection.get("crs")
    if crs and crs.get("properties", {}).get("name") not in {
        "EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:EPSG::4326"
    }:
        parser.error("Replacement GeoJSON must use WGS84 / EPSG:4326.")
    return gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")


def _run_processors(baseline, country_codes):
    from map_builder.regional_processors import apply_selected_processors, resolve_processor_units

    units = resolve_processor_units(country_codes)
    expanded = sorted({country for unit in units for country in unit["countries"]})
    if not expanded:
        raise ValueError("No country processor units were selected.")
    # Preflight completes before processors can load or download any source.
    master = _political_frame(_absolute_topology(baseline))
    if "id" not in master.columns or "cntr_code" not in master.columns or not master["id"].is_unique:
        raise ValueError("Processor baseline requires unique IDs and cntr_code.")
    source_codes = master["cntr_code"].fillna("").astype(str).str.strip().str.upper()
    expected_ids = set(master.loc[source_codes.isin(expanded), "id"].astype(str))
    if not expected_ids:
        raise ValueError("Selected processor countries have no matching baseline features.")
    # Existing processors print progress; keep stdout reserved for final JSON.
    with redirect_stdout(sys.stderr):
        processed = apply_selected_processors(master.copy(), expanded)
    if not isinstance(processed, gpd.GeoDataFrame) or not {"id", "cntr_code"}.issubset(processed.columns):
        raise ValueError("Country processors must return IDs and cntr_code in a GeoDataFrame.")
    processed_ids = processed["id"].astype(str)
    baseline_ids = set(master["id"].astype(str))
    if (not processed_ids.is_unique or processed["id"].isna().any()
            or set(processed_ids) != baseline_ids):
        raise ValueError("Country processors added, removed, or duplicated IDs; automatic mode supports same-ID geometry only.")
    processed_codes = processed["cntr_code"].fillna("").astype(str).str.strip().str.upper()
    replacements = processed.loc[processed_codes.isin(expanded)].copy()
    if set(replacements["id"].astype(str)) != expected_ids:
        raise ValueError("Country processors changed the selected country ID membership.")
    return replacements, expanded, {
        "input_mode": "registered_processors", "baseline_role": "global_master",
        "requested_source_countries": list(country_codes),
        "expanded_source_countries": expanded,
        "processor_units": [unit["name"] for unit in units],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-topology", required=True, type=Path,
                        help="Explicit verified global master topology; processor mode rejects scenario assets.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--replacement-geojson", type=Path)
    source.add_argument("--run-processors", action="store_true",
                        help="Run registered country processors against the global master baseline.")
    parser.add_argument("--output-topology", required=True, type=Path)
    parser.add_argument("--source-countries", nargs="+", help="Allowed baseline cntr_code values, e.g. FR DE")
    args = parser.parse_args(argv)
    baseline_path = args.baseline_topology.resolve()
    replacement_path = args.replacement_geojson.resolve() if args.replacement_geojson else None
    output_path = args.output_topology.resolve()
    input_paths = [baseline_path] + ([replacement_path] if replacement_path else [])
    if output_path in input_paths:
        parser.error("Output must be different from both input paths; in-place replacement is forbidden.")
    # Hard links also identify the same input even when their spelling differs.
    if output_path.exists() and any(output_path.samefile(path) for path in input_paths):
        parser.error("Output identifies an input file; in-place replacement is forbidden.")
    if args.run_processors and not args.source_countries:
        parser.error("--run-processors requires --source-countries.")
    try:
        baseline = read_json_strict(baseline_path)
        processor_diagnostics = {}
        countries = args.source_countries
        if args.run_processors:
            if ("scenarios" in baseline_path.parts
                    or any(name.startswith("scenario_") for name in baseline.get("objects", {}))):
                parser.error("Processor mode requires a global master baseline, not a scenario topology.")
            replacements, countries, processor_diagnostics = _run_processors(baseline, countries)
        else:
            replacements = _read_replacements(replacement_path, parser)
        result, diagnostics = replace_regional_geometry(
            baseline, replacements, source_countries=countries,
        )
    except (ValueError, TypeError, KeyError) as exc:
        parser.error(str(exc))
    # A caller-selected candidate path is mandatory; no default production path.
    write_json_atomic(output_path, result, indent=None, separators=(",", ":"), allow_nan=False)
    diagnostics.update({"baseline_topology": str(baseline_path), "output_topology": str(output_path)})
    diagnostics.update(processor_diagnostics)
    print(json.dumps(diagnostics, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
