"""Append major Nordic lakes to base and TNO water without changing existing arcs.

Stage under .runtime first. Existing marine, Congo, Aral and Atlantropa
geometries are preserved; scenario startup/chunk assets are refreshed after
these staged water files are promoted.

Run from the repository root with ``python -m tools.append_nordic_water
--stage-root .runtime/tmp/nordic-water-stage``.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import mapping

from map_builder.geo.spherical_safety import _topology_feature_collection
from map_builder.geo.water_validation import validate_water_runtime
from map_builder.geo.water_region_authority import compile_named_water_regions

ROOT = Path(__file__).resolve().parents[1]
INPUT_PATHS = (
    "data/europe_topology.json", "data/ne_10m_lakes.zip",
    "data/europe_topology.na_v2.json", "data/water_regions.geojson",
    "data/scenarios/tno_1962/runtime_topology.topo.json",
    "data/scenarios/tno_1962/water_regions.geojson",
    "data/scenarios/tno_1962/manifest.json",
)


def input_identity():
    return {relative: hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
            for relative in INPUT_PATHS}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="")


def decode(topology, name):
    return _topology_feature_collection(topology, name, "water_geometry_rebuild")


def decode_water(topology, name):
    collection = decode(topology, name)
    for key in ("water_geometry_precision", "water_geometry_quantization"):
        if key in topology:
            collection[key] = deepcopy(topology[key])
    return collection


def append_water_features(topology, object_name, features):
    """Append isolated lake rings without recoding any existing shared arc."""
    result = deepcopy(topology)
    water_object = result["objects"][object_name]
    if water_object["type"] != "GeometryCollection":
        raise ValueError(f"Expected GeometryCollection: {object_name}")
    known_ids = {g["properties"]["id"] for g in water_object["geometries"]}
    transform = result.get("transform")

    def add_ring(ring):
        points = [[float(x), float(y)] for x, y in ring]
        if transform:
            scale = transform["scale"]
            translate = transform["translate"]
            absolute = [[round((x - translate[0]) / scale[0]),
                         round((y - translate[1]) / scale[1])] for x, y in points]
            if len(set(map(tuple, absolute))) < 3:
                raise ValueError("Lake ring collapsed on topology grid")
            previous = [0, 0]
            points = []
            for x, y in absolute:
                points.append([x - previous[0], y - previous[1]])
                previous = [x, y]
        arc_index = len(result["arcs"])
        result["arcs"].append(points)
        return [arc_index]

    for feature in features:
        props = deepcopy(feature["properties"])
        feature_id = props["id"]
        if feature_id in known_ids:
            raise ValueError(f"Duplicate water region: {feature_id}")
        geometry = feature["geometry"]
        polygons = ([geometry["coordinates"]] if geometry["type"] == "Polygon"
                    else geometry["coordinates"])
        arcs = [[add_ring(ring) for ring in polygon] for polygon in polygons]
        water_object["geometries"].append({
            "type": geometry["type"], "arcs": arcs[0] if geometry["type"] == "Polygon" else arcs,
            "properties": props, "id": feature_id,
        })
        known_ids.add(feature_id)
    return result


def original_water_geometries(replacement, object_name, added_count):
    geometries = replacement["objects"][object_name]["geometries"]
    return geometries[:-added_count] if added_count else geometries


def appended_water_features(replacement, object_name, added_count):
    if not added_count:
        return []
    return decode(replacement, object_name)["features"][-added_count:]

def rebuild(stage_root):
    stage_root = stage_root.resolve()
    if not stage_root.is_relative_to(ROOT / ".runtime") or stage_root.exists():
        raise ValueError("stage-root must be a new directory under repository .runtime")
    inputs = input_identity()
    # Add only major Nordic lakes from the checked-in NE source. Existing marine
    # and scenario geometries must remain byte-for-byte equivalent after decode.
    from init_map_data import SEEDED_LAKE_REGION_SPECS, _union_named_water_geometries
    source_lakes = gpd.read_file(ROOT / "data/ne_10m_lakes.zip")
    source_water = read(ROOT / "data/water_regions.geojson")
    known_ids = {f["properties"]["id"] for f in source_water["features"]}
    new_lakes = []
    for spec in SEEDED_LAKE_REGION_SPECS:
        if spec["region_group"] != "nordic_lakes" or spec["id"] in known_ids:
            continue
        geometry = _union_named_water_geometries(source_lakes, spec["match_names"])
        if geometry is None or geometry.is_empty:
            raise ValueError(f"Missing Nordic lake source: {spec['id']}")
        geometry = geometry.simplify(0.005, preserve_topology=True)
        if not geometry.is_valid:
            raise ValueError(f"Invalid Nordic lake geometry: {spec['id']}")
        new_lakes.append({"type": "Feature", "properties": {
            "id": spec["id"], "name": spec["name"], "label": spec["label"],
            "water_type": "lake", "region_group": spec["region_group"],
            "parent_id": "", "neighbors": "", "is_chokepoint": False,
            "interactive": True, "source_standard": "natural_earth_lakes",
        }, "geometry": mapping(geometry)})
        known_ids.add(spec["id"])
    compiled_new_lakes = compile_named_water_regions({
        "type": "FeatureCollection", "features": new_lakes,
    })["features"]
    paths = []
    canonical_water = None
    for relative in ("data/europe_topology.json", "data/europe_topology.na_v2.json"):
        print(f"Append lakes to {relative}", flush=True)
        topology = read(ROOT / relative)
        replacement = append_water_features(topology, "water_regions", compiled_new_lakes)
        validate_water_runtime(replacement, land_object="land", ocean_object="ocean", stage_label=relative)
        for name in topology["objects"]:
            if name != "water_regions" and topology["objects"][name] != replacement["objects"][name]:
                raise ValueError(f"Non-water object changed: {relative}::{name}")
        if topology["objects"]["water_regions"]["geometries"] != \
                original_water_geometries(replacement, "water_regions", len(compiled_new_lakes)):
            raise ValueError(f"Existing water geometry changed: {relative}")
        write(stage_root / relative, replacement)
        paths.append(relative)
        if canonical_water is None:
            canonical_water = deepcopy(source_water)
            canonical_water["features"].extend(
                appended_water_features(replacement, "water_regions", len(compiled_new_lakes)))
    write(stage_root / "data/water_regions.geojson", canonical_water)
    paths.append("data/water_regions.geojson")

    from tools import patch_tno_1962_bundle as b
    relative = "data/scenarios/tno_1962/runtime_topology.topo.json"
    print(f"Append lakes to {relative}", flush=True)
    topology = read(ROOT / relative)
    current_water = read(ROOT / "data/scenarios/tno_1962/water_regions.geojson")
    named_ids = {f["properties"]["id"] for f in current_water["features"]}
    base_index = {f["properties"]["id"]: f for f in canonical_water["features"]}
    new_clones = []
    for clone in b.build_tno_base_geography_water_clone_features(base_index):
        if clone["properties"]["id"] not in named_ids:
            new_clones.append(clone)
            named_ids.add(clone["properties"]["id"])
    replacement = append_water_features(topology, "scenario_water", new_clones)
    validate_water_runtime(replacement, object_name="scenario_water", land_object="land_mask", stage_label=relative)
    for name in topology["objects"]:
        if name != "scenario_water" and topology["objects"][name] != replacement["objects"][name]:
            raise ValueError(f"Non-water object changed: TNO::{name}")
    if topology["objects"]["scenario_water"]["geometries"] != \
            original_water_geometries(replacement, "scenario_water", len(new_clones)):
        raise ValueError("Existing TNO water geometry changed")
    write(stage_root / relative, replacement)
    paths.append(relative)
    source_relative = "data/scenarios/tno_1962/water_regions.geojson"
    scenario_water = deepcopy(current_water)
    scenario_water["features"].extend(
        appended_water_features(replacement, "scenario_water", len(new_clones)))
    write(stage_root / source_relative, scenario_water)
    paths.append(source_relative)
    manifest_relative = "data/scenarios/tno_1962/manifest.json"
    manifest = read(ROOT / manifest_relative)
    manifest["excluded_water_region_ids"] = sorted(set(
        manifest.get("excluded_water_region_ids", [])) |
        set(b.TNO_BASE_GEOGRAPHY_WATER_CLONE_IDS))
    manifest.setdefault("summary", {})["tno_water_region_count"] = len(scenario_water["features"])
    write(stage_root / manifest_relative, manifest)
    paths.append(manifest_relative)
    if inputs != input_identity():
        raise ValueError("Canonical inputs changed during staging; rebuild before promotion.")
    write(stage_root / "outputs.json", {"paths": paths, "input_sha256": inputs,
                                        "base_count": len(canonical_water["features"]),
                                        "tno_count": len(scenario_water["features"])})
    print(json.dumps({"stage_root": str(stage_root), "paths": paths}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage-root", type=Path, required=True)
    args = parser.parse_args()
    rebuild(args.stage_root)


if __name__ == "__main__":
    main()
