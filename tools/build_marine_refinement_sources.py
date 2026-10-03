"""Refresh selected Marine Regions sources explicitly, then build shared source partitions.

Ordinary builds are offline. Existing geometry comes from the recorded, pre-coast
Marine Regions snapshot, never from scenario water exports or Atlantropa.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import requests
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from map_builder.geo.marine_refinement import (
    ADDITIONAL_SEAS, OCEAN_SECTORS, ADDITIONAL_SOURCE_PATH, SOURCE_PATH,
    ADDITIONAL_DETAIL_PARENTS, additional_snapshot_features,
    additional_source_contract, additional_source_simplify_degrees,
)
from map_builder.geo.water_region_authority import polygonal

WFS = "https://geo.vliz.be/geoserver/MarineRegions/ows"
PROTECTED = {"tno_bosporus_dardanelles", "tno_sea_of_marmara", "tno_black_sea", "tno_sea_of_azov"}
SOURCE_DATASET_METADATA = {
    "seavox_v19": {
        "source_layer": "seavox_v19",
        "source_standard": "marine_regions_seavox_v19",
        "source_version": "SeaVoX v19 (2023)",
        "endpoint": WFS,
        "citation": "https://doi.org/10.14284/590",
    },
    "world_bay_gulf": {
        "source_layer": "world_bay_gulf",
        "source_standard": "marine_regions_world_bay_gulf",
        "endpoint": WFS,
        "gazetteer": "https://www.marineregions.org/",
        "citation": "Marine Regions Gazetteer: https://www.marineregions.org/; public WFS: " + WFS,
    },
}


def write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def source_collection_metadata(features):
    layers = sorted({
        str(feature.get("properties", {}).get("source_layer") or "").strip()
        for feature in features
        if str(feature.get("properties", {}).get("source_layer") or "").strip()
    })
    unknown_layers = [layer for layer in layers if layer not in SOURCE_DATASET_METADATA]
    if unknown_layers:
        raise ValueError(f"Missing source metadata for Marine Regions layer(s): {', '.join(unknown_layers)}")

    datasets = [deepcopy(SOURCE_DATASET_METADATA[layer]) for layer in layers]
    versions = [dataset["source_version"] for dataset in datasets if dataset.get("source_version")]
    if len(layers) == 1 and versions:
        source_version = versions[0]
    elif layers:
        source_version = "Marine Regions public source layers"
    else:
        source_version = "Marine Regions source collection"
    citations = [
        dataset.get("citation") or dataset.get("gazetteer")
        for dataset in datasets
    ]
    citation = "; ".join(dict.fromkeys(citations))
    return {
        "source_version": source_version,
        "citation": citation,
        "source_datasets": datasets,
    }


def _numeric_source_id(value, *, context):
    if isinstance(value, bool):
        raise ValueError(f"Boolean is not a numeric Marine Regions ID ({context}): {value!r}")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value.strip()):
        return int(value.strip())
    raise ValueError(f"Invalid numeric Marine Regions ID ({context}): {value!r}")


def _source_id_expectations(contract, requested_mrgid, *, context):
    requested_id = _numeric_source_id(requested_mrgid, context=f"request {context}")
    expectations = {}
    for record_id in contract["source_record_ids"]:
        if not isinstance(record_id, str) or ":" not in record_id:
            raise ValueError(f"Malformed source_record_ids entry for {context}: {record_id!r}")
        field, value = record_id.split(":", 1)
        field = field.strip()
        if not field:
            raise ValueError(f"Missing MRGID field in source_record_ids for {context}: {record_id!r}")
        expected_id = _numeric_source_id(value.strip(), context=f"source_record_ids {context}")
        if expected_id != requested_id:
            raise ValueError(
                f"Source contract ID does not match requested ID for {context}: "
                f"{record_id!r} != {requested_mrgid!r}"
            )
        expectations.setdefault(field, set()).add(expected_id)
    if not expectations:
        raise ValueError(f"Source contract has no source_record_ids for {context}")
    return expectations


def _validate_response_source_ids(rows_found, expectations, *, context):
    for index, feature in enumerate(rows_found):
        properties = feature.get("properties") or {}
        matched = False
        returned_ids = {}
        for field, expected_values in expectations.items():
            if field not in properties:
                continue
            actual_id = _numeric_source_id(
                properties[field], context=f"response feature {index} field {field} for {context}"
            )
            returned_ids[field] = actual_id
            if actual_id in expected_values:
                matched = True
        if not matched:
            raise ValueError(
                f"Unexpected MRGID in response feature {index} for {context}: "
                f"expected {expectations}, got {returned_ids or properties}"
            )


def refresh(*, missing_only=False):
    existing = json.loads(ADDITIONAL_SOURCE_PATH.read_text(encoding="utf-8")) if missing_only and ADDITIONAL_SOURCE_PATH.exists() else {}
    features = existing.get("features", [])
    existing_ids = {f["properties"]["id"] for f in features}
    for ocean, rows in ((False, ADDITIONAL_SEAS), (True, OCEAN_SECTORS)):
        for slug, name, zh, mrgid, category in rows:
            if f"marine_{slug}" in existing_ids:
                continue
            contract = additional_source_contract(slug, mrgid)
            source_layer = contract["source_layer"]
            query = contract["source_query"]
            expectations = _source_id_expectations(contract, mrgid, context=slug)
            response = requests.get(WFS, params={
                "service": "WFS", "version": "1.0.0", "request": "GetFeature",
                "typeName": f"MarineRegions:{source_layer}", "outputFormat": "application/json",
                "CQL_FILTER": query,
            }, timeout=60)
            response.raise_for_status()
            payload = response.json()
            rows_found = payload.get("features", [])
            if not rows_found or any(
                not isinstance(feature.get("geometry"), dict)
                or feature["geometry"].get("type") not in {"Polygon", "MultiPolygon"}
                for feature in rows_found
            ):
                raise ValueError(f"Missing public polygons for {name}")
            _validate_response_source_ids(rows_found, expectations, context=slug)
            geom = polygonal(unary_union([shape(f["geometry"]) for f in rows_found]))
            simplify_degrees = additional_source_simplify_degrees(slug)
            geom = polygonal(geom.simplify(simplify_degrees, preserve_topology=True))
            if geom.is_empty:
                raise ValueError(f"Empty source: {name}")
            props = {
                "id": f"marine_{slug}", "name": name, "label": name, "name_zh": zh,
                "water_type": "ocean" if ocean else category,
                "region_group": "ocean_macro" if ocean else "marine_detail" if slug in ADDITIONAL_DETAIL_PARENTS else "marine_macro",
                "parent_id": f"marine_{category}_ocean" if ocean else f"marine_{ADDITIONAL_DETAIL_PARENTS[slug]}" if slug in ADDITIONAL_DETAIL_PARENTS else "",
                "interactive": True, "is_chokepoint": category == "strait", "neighbors": "",
                "source_standard": contract["source_standard"], "source_layer": source_layer,
                "source_query": query, "source_record_ids": list(contract["source_record_ids"]),
                "source_feature_count": len(rows_found), "source_url": response.url,
                "source_simplify_degrees": simplify_degrees,
            }
            features.append({"type": "Feature", "properties": props, "geometry": mapping(geom)})
            print(f"Fetched {name}: {len(rows_found)} public polygons", flush=True)
    write(ADDITIONAL_SOURCE_PATH, {
        "type": "FeatureCollection", **source_collection_metadata(features),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "features": features,
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
    parser.add_argument("--refresh", action="store_true", help="Explicitly refetch the Marine Regions supplement")
    parser.add_argument("--refresh-missing", action="store_true", help="Fetch missing Marine Regions records without changing recorded existing polygons")
    args = parser.parse_args()
    if args.refresh or args.refresh_missing:
        refresh(missing_only=args.refresh_missing and not args.refresh)
    build()
