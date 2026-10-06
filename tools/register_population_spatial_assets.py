#!/usr/bin/env python3
"""Register the complete GHSL runtime pack while preserving unrelated records."""
from __future__ import annotations

import hashlib
import gzip
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.json_schema_contracts import validate_json_contract
from map_builder.io.writers import write_json_atomic

PACK = "data/thematic_layers/population/ghsl_population_2020_v1"


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def main():
    layer = read(f"{PACK}/manifest.json")
    errors = validate_json_contract(layer, schema_name="population_spatial_manifest.schema.json", source_label=f"{PACK}/manifest.json")
    if errors:
        raise ValueError("\n".join(errors))
    if layer.get("coverage_status") != "complete" or layer["runtime_consumer"].get("status") != "main_map_ready":
        raise ValueError("Only a complete validated population pack can be registered")
    if layer["source"].get("product") != "GHS_POP_E2020_GLOBE_R2023A_54009_1000_V1_0" \
            or layer["source"].get("resolution_m") != 1000 \
            or layer["runtime_consumer"].get("data_version") != layer["data_version"]:
        raise ValueError("The current runtime admits only the pinned GHSL 2020 1 km product")
    specs = {
        f"{PACK}/manifest.json": ("population_spatial_manifest", "population_spatial_manifest.schema.json"),
        layer["raster"]["overview_url"]: ("population_spatial_overview", "population_spatial_tile.schema.json"),
    }
    for scenario, descriptor in layer["scenarios"].items():
        specs[descriptor["features_url"]] = (f"population_spatial_features:{scenario}", "population_spatial_features.schema.json")
    for tile in layer["raster"]["detail_tiles"]:
        specs[tile["url"]] = (f"population_spatial_tile:{tile['id']}", "population_spatial_tile.schema.json")
    registry = read("data/runtime_asset_registry.json")
    manifest = read("data/manifest.json")
    # Validate and gather every asset before mutating the shared registrations.
    registrations = []
    for url, (key, schema) in specs.items():
        path = (ROOT / url).resolve()
        if not path.is_relative_to((ROOT / PACK).resolve()):
            raise ValueError(f"Population asset escapes its pack: {url}")
        payload = path.read_bytes()
        document = json.loads(payload)
        errors = validate_json_contract(document, schema_name=schema, source_label=url)
        if errors:
            raise ValueError("\n".join(errors[:10]))
        if key.startswith("population_spatial_features:"):
            scenario = key.split(":", 1)[1]
            descriptor = layer["scenarios"][scenario]
            if document["scenario_id"] != scenario or document["geometry_version"] != descriptor["geometry_version"] \
                    or document["feature_count"] != descriptor["feature_count"] \
                    or len(document["features"]) != descriptor["feature_count"]:
                raise ValueError(f"Feature identity/membership mismatch: {url}")
            scenario_manifest = read(f"data/scenarios/{scenario}/manifest.json")
            topology_path = (ROOT / scenario_manifest["runtime_topology_url"]).resolve()
            if hashlib.sha256(topology_path.read_bytes()).hexdigest() != descriptor["geometry_version"]:
                raise ValueError(f"Stale scenario geometry: {scenario}")
            def ids_from_topology(topology, object_name):
                ids = []
                for item in topology["objects"][object_name]["geometries"]:
                    props = item.get("properties") or {}
                    ids.append(str(props.get("id") or props.get("NUTS_ID") or item.get("id") or "").strip())
                if "" in ids or len(set(ids)) != len(ids):
                    raise ValueError(f"Empty or duplicate topology IDs: {scenario}")
                return set(ids)
            topology_bytes = topology_path.read_bytes()
            if topology_path.suffix == ".gz":
                topology_bytes = gzip.decompress(topology_bytes)
            core_ids = ids_from_topology(json.loads(topology_bytes), "political")
            extra_ids = ids_from_topology(read(scenario_manifest["scenario_atlantropa_topology_url"]), "scenario_atlantropa") \
                if scenario == "tno_1962" else set()
            if core_ids & extra_ids or len(core_ids) != descriptor["core_feature_count"] \
                    or len(extra_ids) != descriptor["extra_feature_count"] \
                    or set(document["features"]) != core_ids | extra_ids:
                raise ValueError(f"Population full topology membership mismatch: {scenario}")
            for feature_id, row in document["features"].items():
                if not feature_id or feature_id.strip() != feature_id:
                    raise ValueError(f"Invalid population feature ID: {url}")
                if any(value is not None and not math.isfinite(value) for value in
                       (row["population"], row["land_area_km2"], row["density"], row["coverage_fraction"])):
                    raise ValueError(f"Non-finite population observation: {feature_id}")
                status = row["status"]
                if status == "ok":
                    if row["population"] is None or not row["land_area_km2"] or row["coverage_fraction"] != 1 \
                            or row["density"] is None or not math.isclose(row["density"], row["population"] / row["land_area_km2"], rel_tol=1e-6, abs_tol=1e-6):
                        raise ValueError(f"Invalid complete population observation: {feature_id}")
                elif status == "partial_coverage":
                    if row["population"] is None or not row["land_area_km2"] or not 0 < (row["coverage_fraction"] or 0) < 1 or row["density"] is not None:
                        raise ValueError(f"Invalid partial population observation: {feature_id}")
                elif row["population"] is not None or row["density"] is not None:
                    raise ValueError(f"Unknown population must remain null: {feature_id}")
        elif schema == "population_spatial_tile.schema.json":
            width, height, size = document["width"], document["height"], document["cell_size_m"]
            left, bottom, right, top = document["bounds"]
            if not math.isclose(right - left, width * size, abs_tol=1e-6) or not math.isclose(top - bottom, height * size, abs_tol=1e-6):
                raise ValueError(f"Tile bounds/dimensions mismatch: {url}")
            seen = set()
            for index, count, area in document["cells"]:
                if index in seen or index >= width * height or not math.isfinite(count) or not math.isfinite(area) or area > size * size / 1e6 + 1e-6:
                    raise ValueError(f"Invalid or duplicated population cell: {url}")
                seen.add(index)
        registrations.append((url, key, schema, len(payload), hashlib.sha256(payload).hexdigest()))
    for url, key, schema, size, digest in registrations:
        role = key.split(":")[0]
        registry["assets"][key] = {
            "url": url, "role": role, "schema_ref": f"map_builder/schemas/{schema}",
            "metadata": {"layer_id": layer["layer_id"], "data_version": layer["data_version"],
                         "source_epoch": 2020, "source_resolution_m": layer["source"]["resolution_m"],
                         "load_policy": "on_demand_viewport" if role == "population_spatial_tile" else "on_demand"},
        }
        manifest["outputs"][url.removeprefix("data/")] = {
            "role": role, "type": "json", "artifact_class": "publish", "owner": "population_spatial",
            "schema_ref": f"map_builder/schemas/{schema}", "size_bytes": size, "sha256": digest,
            "description": "GHSL 2020 spatial population. Full feature statistics; lazy count-conserving heatmap tiles.",
        }
    for filename, role in [("audit.json", "population_spatial_audit"), ("source_ledger.json", "population_spatial_provenance")]:
        url = f"{PACK}/{filename}"
        payload = (ROOT / url).read_bytes()
        if not isinstance(json.loads(payload), dict):
            raise ValueError(f"Population metadata must be a JSON object: {url}")
        manifest["outputs"][url.removeprefix("data/")] = {
            "role": role, "type": "json", "artifact_class": "publish", "owner": "population_spatial",
            "schema_ref": "schema://json/object/v1", "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    # The provenance mirror is governed; the large original raster stays in the
    # optional local source cache and is pinned in that mirror by SHA256.
    ledger = read("data/source_ledger.json")
    source_id = "ghsl_population_2020_r2023a_1km"
    ledger = [entry for entry in ledger if entry.get("source_id") != source_id]
    mirror = f"{PACK}/source_ledger.json"
    source = layer["source"]
    ledger.append({
        "source_id": source_id, "local_path": mirror, "origin_kind": "derived",
        "upstream_url": source["url"], "immutable_ref": source["product"],
        "current_local_sha256": hashlib.sha256((ROOT / mirror).read_bytes()).hexdigest(),
        "license": source["license"], "citation": source["citation_url"],
        "consumers": ["map_builder/population_spatial.py", f"{PACK}/manifest.json"],
        "rebuild_command": "npm run build:population-spatial", "provenance_sidecar": mirror,
        "status": "frozen_verified", "local_presence": "required",
        "description": "Provenance mirror; original source raster is an optional .runtime cache, not a browser asset.",
    })
    write_json_atomic(ROOT / "data/runtime_asset_registry.json", registry, ensure_ascii=False, indent=2, trailing_newline=True)
    registry_bytes = (ROOT / "data/runtime_asset_registry.json").read_bytes()
    manifest["runtime_asset_registry"] = registry
    manifest["outputs"]["runtime_asset_registry.json"].update(
        size_bytes=len(registry_bytes), sha256=hashlib.sha256(registry_bytes).hexdigest()
    )
    write_json_atomic(ROOT / "data/manifest.json", manifest, ensure_ascii=False, indent=2, trailing_newline=True)
    write_json_atomic(ROOT / "data/source_ledger.json", ledger, ensure_ascii=False, indent=2, trailing_newline=True)
    from tools.build_data_catalog import main as build_catalog
    build_catalog()
    print(f"Registered {len(registrations)} population runtime assets.")


if __name__ == "__main__":
    main()
