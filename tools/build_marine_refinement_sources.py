"""Refresh the small SeaVoX supplement explicitly, then build shared source partitions.

Ordinary builds are offline. Existing geometry comes from the recorded, pre-coast
Marine Regions snapshot, never from scenario water exports or Atlantropa.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import requests
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from map_builder.geo.marine_refinement import (
    ADDITIONAL_SEAS, OCEAN_SECTORS, ADDITIONAL_SOURCE_PATH, SOURCE_PATH,
    additional_snapshot_features,
)
from map_builder.geo.water_region_authority import polygonal

WFS = "https://geo.vliz.be/geoserver/MarineRegions/ows"
PROTECTED = {"tno_bosporus_dardanelles", "tno_sea_of_marmara", "tno_black_sea", "tno_sea_of_azov"}


def write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def refresh():
    features = []
    for ocean, rows in ((False, ADDITIONAL_SEAS), (True, OCEAN_SECTORS)):
        for slug, name, zh, mrgid, category in rows:
            query = f"mrgid_sr='{mrgid}'"
            response = requests.get(WFS, params={
                "service": "WFS", "version": "1.0.0", "request": "GetFeature",
                "typeName": "MarineRegions:seavox_v19", "outputFormat": "application/json",
                "CQL_FILTER": query,
            }, timeout=60)
            response.raise_for_status()
            payload = response.json()
            rows_found = payload.get("features", [])
            if not rows_found or any(f.get("geometry", {}).get("type") not in {"Polygon", "MultiPolygon"} for f in rows_found):
                raise ValueError(f"Missing public polygons for {name}")
            geom = polygonal(unary_union([shape(f["geometry"]) for f in rows_found]))
            geom = polygonal(geom.simplify(0.005, preserve_topology=True))
            if geom.is_empty:
                raise ValueError(f"Empty source: {name}")
            props = {
                "id": f"marine_{slug}", "name": name, "label": name, "name_zh": zh,
                "water_type": "ocean" if ocean else category,
                "region_group": "ocean_macro" if ocean else "marine_macro",
                "parent_id": f"marine_{category}_ocean" if ocean else "",
                "interactive": True, "is_chokepoint": category == "strait", "neighbors": "",
                "source_standard": "marine_regions_seavox_v19", "source_layer": "seavox_v19",
                "source_query": query, "source_record_ids": [f"mrgid_sr:{mrgid}"],
                "source_feature_count": len(rows_found), "source_url": response.url,
                "source_simplify_degrees": 0.005,
            }
            features.append({"type": "Feature", "properties": props, "geometry": mapping(geom)})
            print(f"Fetched {name}: {len(rows_found)} public polygons", flush=True)
    write(ADDITIONAL_SOURCE_PATH, {
        "type": "FeatureCollection", "source_version": "SeaVoX v19 (2023)",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "citation": "https://doi.org/10.14284/590", "features": features,
    })


def build():
    from tools import patch_tno_1962_bundle as b
    import geopandas as gpd
    from map_builder.geo.water_region_authority import restore_marine_source
    # Source preparation must not feed the newly refined parent remainders back
    # into the next build's base-water subtraction rules.
    coarse = restore_marine_source(
        json.loads((ROOT / "data/water_regions.geojson").read_text(encoding="utf-8")),
        gpd.read_file(ROOT / "data/ne_10m_geography_marine_polys.zip"),
    )
    b._global_water_regions_feature_index = {f["properties"]["id"]: f for f in coarse["features"]}
    snapshot_path = ROOT / "data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    existing_ids = {f["properties"]["id"] for f in snapshot["features"]}
    snapshot["features"].extend(f for f in additional_snapshot_features() if f["properties"]["id"] not in existing_ids)
    prepared, diagnostics = b.build_tno_named_marginal_water_features(snapshot)
    features = []
    for source in prepared:
        old_id = source["properties"]["id"]
        if old_id in PROTECTED:
            continue
        feature = deepcopy(source)
        props = feature["properties"]
        props.pop("scenario_id", None)
        props.pop("render_as_base_geography", None)
        props["id"] = old_id.replace("tno_", "marine_", 1)
        props["parent_id"] = str(props.get("parent_id") or "").replace("tno_", "marine_", 1)
        for key in ("source_layer", "source_query", "source_record_ids"):
            props[key] = diagnostics[old_id][key]
        features.append(feature)
    additions = json.loads(ADDITIONAL_SOURCE_PATH.read_text(encoding="utf-8"))["features"]
    by_id = {f["properties"]["id"]: f for f in features}
    for f in additions:
        if f["properties"]["water_type"] == "ocean":
            features.append(f)
        elif f["properties"]["id"] in by_id:
            by_id[f["properties"]["id"]]["properties"]["name_zh"] = f["properties"]["name_zh"]
    write(SOURCE_PATH, {"type": "FeatureCollection", "features": features,
        "source_inputs": [str(snapshot_path.relative_to(ROOT)).replace('\\', '/'), str(ADDITIONAL_SOURCE_PATH.relative_to(ROOT)).replace('\\', '/')],
        "preparation": "Recorded Marine Regions source simplification and explicit named subtractions; no scenario land masks or supplements.",
    })
    print(f"Shared pre-coast marine source: {len(features)} features", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Explicitly refetch the SeaVoX supplement")
    args = parser.parse_args()
    if args.refresh:
        refresh()
    build()
