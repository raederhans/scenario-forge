"""Extract pinned, same-ID NUTS and Luxembourg sources for the TNO precision trial."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely

from map_builder.io.writers import write_json_atomic

NUTS_COUNTRIES = frozenset({"GB", "IT", "AT", "EE", "LV", "LT", "ES", "PT"})
NUTS_MAINLAND_COUNTRIES = frozenset({"CH", "HU", "RO", "BG", "SE", "NO", "FI", "SI", "HR", "RS", "AL", "MK"})
ADMIN1_COUNTRIES = {"LU": ("LUX", "LU_ADM1_"), "ME": ("MNE", "ME_ADM1_"), "MD": ("MDA", "")}
ADM2_COUNTRIES = {"CZ": ("CZE", "gb_cze_adm2"), "SK": ("SVK", "gb_svk_adm2")}
SUPPORTED_COUNTRIES = NUTS_COUNTRIES | NUTS_MAINLAND_COUNTRIES | ADMIN1_COUNTRIES.keys() | ADM2_COUNTRIES.keys()
DEFAULT_COUNTRIES = NUTS_COUNTRIES | {"LU"}
NUTS_URL = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2021_3035_LEVL_3.geojson"


def select_same_ids(source, baseline_properties, countries):
    ids = [row["id"] for row in baseline_properties]
    if len(ids) != len(set(ids)):
        raise ValueError("Baseline IDs must be unique")
    expected = {row["id"]: row["cntr_code"] for row in baseline_properties
                if row.get("cntr_code") in countries}
    if set(expected.values()) != set(countries):
        raise ValueError("Every requested country must have baseline IDs")
    if source.crs is None or not {"id", "cntr_code"}.issubset(source.columns):
        raise ValueError("Source requires IDs, country codes and an explicit CRS")
    if source["id"].isna().any() or not source["id"].is_unique:
        raise ValueError("Source IDs must be unique and non-null")
    selected = source.loc[source["id"].isin(expected), ["id", "cntr_code", "geometry"]].copy()
    if set(selected["id"]) != set(expected):
        raise ValueError(f"Source misses baseline IDs: {sorted(set(expected) - set(selected['id']))}")
    if any(expected[row.id] != row.cntr_code for row in selected.itertuples()):
        raise ValueError("Source country membership changed")
    selected = selected.to_crs(4326)
    if (selected.geometry.isna().any() or selected.geometry.is_empty.any()
            or not selected.geometry.is_valid.all()
            or not selected.geometry.geom_type.isin(["Polygon", "MultiPolygon"]).all()
            or not shapely.coverage_is_valid(selected.geometry.values)):
        raise ValueError("Source is not a valid nonempty polygon coverage")
    excluded = sorted(set(source.loc[source.cntr_code.isin(countries), "id"]) - set(expected))
    return selected, excluded


def parse_countries(countries):
    if countries is None:
        return set(DEFAULT_COUNTRIES)
    selected = {str(code).strip().upper() for code in countries}
    if not selected or len(selected) != len(countries) or selected - SUPPORTED_COUNTRIES:
        raise ValueError(f"Countries must be unique supported codes; unsupported: {sorted(selected - SUPPORTED_COUNTRIES)}")
    return selected


def load_governed_adm2(country):
    iso3, source_id = ADM2_COUNTRIES[country]
    path = ROOT / "data" / f"geoBoundaries-{iso3}-ADM2.geojson"
    sidecar_path = path.with_suffix(".provenance.json")
    ledger_path = ROOT / "data" / "source_ledger.json"
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    records = json.loads(ledger_path.read_text(encoding="utf-8"))
    matches = [row for row in records if row.get("source_id") == source_id]
    if len(matches) != 1:
        raise ValueError(f"Expected one governed source ledger entry for {country}")
    entry = matches[0]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if (sidecar.get("filename") != path.name
            or sidecar.get("configured_source_url") != entry.get("upstream_url")
            or sidecar.get("content_length") != path.stat().st_size
            or sidecar.get("sha256") != digest
            or entry.get("local_path") != path.relative_to(ROOT).as_posix()
            or entry.get("provenance_sidecar") != sidecar_path.relative_to(ROOT).as_posix()
            or entry.get("current_local_sha256") != digest):
        raise ValueError(f"{country} cached source does not match provenance and ledger")
    frame = gpd.read_file(path)
    if (not {"shapeID", "shapeGroup", "shapeType"}.issubset(frame.columns)
            or not frame.shapeGroup.eq(iso3).all() or not frame.shapeType.eq("ADM2").all()):
        raise ValueError(f"{country} source must contain only {iso3} ADM2 features")
    frame["id"] = country + "_ADM2_" + frame.shapeID.astype(str)
    frame["cntr_code"] = country
    return frame, path, entry["upstream_url"]


def prepare_sources(baseline_path, nuts_path, admin1_path, output_dir, countries=None):
    selected_countries = parse_countries(countries)
    output_dir = Path(output_dir).resolve()
    if (output_dir.exists() or output_dir.is_relative_to(ROOT / "data")
            or output_dir.is_relative_to(ROOT / "dist")):
        raise ValueError("Use a new output directory outside production data/dist")
    baseline = json.loads(Path(baseline_path).read_text(encoding="utf-8"))
    properties = [item["properties"] for item in baseline["objects"]["political"]["geometries"]]
    if len({row["id"] for row in properties}) != len(properties):
        raise ValueError("Baseline IDs must be unique")
    sources = []
    nuts_countries = selected_countries & (NUTS_COUNTRIES | NUTS_MAINLAND_COUNTRIES)
    if nuts_countries:
        nuts = gpd.read_file(nuts_path)
        if not {"NUTS_ID", "CNTR_CODE", "LEVL_CODE"}.issubset(nuts.columns) or not nuts.LEVL_CODE.eq(3).all():
            raise ValueError("Expected the pinned 2021 NUTS level 3 source")
        nuts["id"] = nuts.NUTS_ID
        nuts["cntr_code"] = nuts.CNTR_CODE.replace({"UK": "GB"})
        frame, excluded = select_same_ids(nuts, properties, nuts_countries)
        sources.append(("nuts", frame, nuts_path, NUTS_URL, excluded))
    admin_countries = selected_countries & ADMIN1_COUNTRIES.keys()
    if admin_countries:
        admin = gpd.read_file(admin1_path)
        if not {"adm0_a3", "adm1_code"}.issubset(admin.columns):
            raise ValueError("Expected Natural Earth ADM1 code fields")
        for country in sorted(admin_countries):
            adm0, prefix = ADMIN1_COUNTRIES[country]
            frame = admin.loc[admin.adm0_a3.eq(adm0)].copy()
            frame["id"] = prefix + frame.adm1_code
            frame["cntr_code"] = country
            frame, excluded = select_same_ids(frame, properties, {country})
            sources.append((country.lower(), frame, admin1_path,
                "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip", excluded))
    for country in sorted(selected_countries & ADM2_COUNTRIES.keys()):
        frame, path, upstream_url = load_governed_adm2(country)
        frame, excluded = select_same_ids(frame, properties, {country})
        sources.append((country.lower(), frame, path, upstream_url, excluded))
    selected_ids = [fid for _, frame, *_ in sources for fid in frame.id]
    if len(set(selected_ids)) != len(selected_ids):
        raise ValueError("Selected sources contain colliding IDs")
    if countries is not None and not shapely.coverage_is_valid(
            [geom for _, frame, *_ in sources for geom in frame.geometry.values]):
        raise ValueError("Selected sources do not form a valid joint coverage")
    report = {"status": "sources_only", "release_ready": False,
              "policy": "Retain scenario membership, administrative vintage and full cached source coordinates; no repair or simplification.",
              "sources": []}
    for name, frame, source_path, url, exclusions in sources:
        report["sources"].append({"name": name, "path": str(Path(source_path).resolve()),
            "upstream_url": url, "sha256": hashlib.sha256(Path(source_path).read_bytes()).hexdigest(),
            "feature_counts": dict(Counter(frame.cntr_code)), "excluded_source_ids": exclusions,
            "coordinates": int(shapely.get_num_coordinates(frame.geometry.values).sum()),
            "coverage_valid": True, "output": f"{name}.geojson"})
    output_dir.mkdir(parents=True)
    for name, frame, *_ in sources:
        write_json_atomic(output_dir / f"{name}.geojson", json.loads(frame.to_json()), indent=None, allow_nan=False)
    write_json_atomic(output_dir / "source-record.json", report, indent=2, allow_nan=False)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-runtime", required=True, type=Path)
    parser.add_argument("--nuts-source", required=True, type=Path)
    parser.add_argument("--admin1-source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--countries", nargs="+", help="Explicit supported source-country codes; defaults to the existing western set")
    args = parser.parse_args()
    print(json.dumps(prepare_sources(args.baseline_runtime, args.nuts_source, args.admin1_source, args.output_dir,
                                     countries=args.countries), indent=2))
