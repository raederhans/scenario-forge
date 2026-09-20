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
NUTS_URL = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2021_3035_LEVL_3.geojson"


def select_same_ids(source, baseline_properties, countries):
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


def prepare_sources(baseline_path, nuts_path, admin1_path, output_dir):
    output_dir = Path(output_dir).resolve()
    if (output_dir.exists() or output_dir.is_relative_to(ROOT / "data")
            or output_dir.is_relative_to(ROOT / "dist")):
        raise ValueError("Use a new output directory outside production data/dist")
    baseline = json.loads(Path(baseline_path).read_text(encoding="utf-8"))
    properties = [item["properties"] for item in baseline["objects"]["political"]["geometries"]]
    if len({row["id"] for row in properties}) != len(properties):
        raise ValueError("Baseline IDs must be unique")
    nuts = gpd.read_file(nuts_path)
    if not {"NUTS_ID", "CNTR_CODE", "LEVL_CODE"}.issubset(nuts.columns) or not nuts.LEVL_CODE.eq(3).all():
        raise ValueError("Expected the pinned 2021 NUTS level 3 source")
    nuts["id"] = nuts.NUTS_ID
    nuts["cntr_code"] = nuts.CNTR_CODE.replace({"UK": "GB"})
    nuts, excluded = select_same_ids(nuts, properties, NUTS_COUNTRIES)
    admin = gpd.read_file(admin1_path)
    lu = admin.loc[admin.adm0_a3.eq("LUX")].copy()
    lu["id"] = "LU_ADM1_" + lu.adm1_code
    lu["cntr_code"] = "LU"
    lu, lu_excluded = select_same_ids(lu, properties, {"LU"})
    report = {"status": "sources_only", "release_ready": False,
              "policy": "Retain scenario membership, administrative vintage and full cached source coordinates; no repair or simplification.",
              "sources": []}
    for name, frame, source_path, url, exclusions in [
        ("nuts", nuts, nuts_path, NUTS_URL, excluded),
        ("lu", lu, admin1_path, "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip", lu_excluded),
    ]:
        report["sources"].append({"name": name, "path": str(Path(source_path).resolve()),
            "upstream_url": url, "sha256": hashlib.sha256(Path(source_path).read_bytes()).hexdigest(),
            "feature_counts": dict(Counter(frame.cntr_code)), "excluded_source_ids": exclusions,
            "coordinates": int(shapely.get_num_coordinates(frame.geometry.values).sum()),
            "coverage_valid": True, "output": f"{name}.geojson"})
    output_dir.mkdir(parents=True)
    for name, frame in [("nuts", nuts), ("lu", lu)]:
        write_json_atomic(output_dir / f"{name}.geojson", json.loads(frame.to_json()), indent=None, allow_nan=False)
    write_json_atomic(output_dir / "source-record.json", report, indent=2, allow_nan=False)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-runtime", required=True, type=Path)
    parser.add_argument("--nuts-source", required=True, type=Path)
    parser.add_argument("--admin1-source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare_sources(args.baseline_runtime, args.nuts_source, args.admin1_source, args.output_dir), indent=2))
