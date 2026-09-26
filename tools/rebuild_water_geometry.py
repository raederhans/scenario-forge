"""Rebuild named water geometry without rebuilding political or Atlantropa data.

Stage under .runtime first. The output manifest lists only water-owned files;
scenario/startup contract materializers run separately after these are applied.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import shape

from map_builder.geo.spherical_safety import _topology_feature_collection
from map_builder.geo.water_geometry import replace_water_topology_object, transplant_water_features
from map_builder.geo.water_validation import validate_water_runtime
from map_builder.geo.physical_water_mask import physical_mask_to_planar_geometry, inherit_physical_water_masks
from map_builder.geo.water_region_authority import (
    compile_named_water_regions, polygonal, restore_marine_source,
)
from map_builder.geo.marine_refinement import (
    refine_base_water_regions, additional_snapshot_features, reconcile_marine_source_boundaries,
)
from shapely.geometry import mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
INPUT_PATHS = (
    "data/ne_10m_geography_marine_polys.zip", "data/europe_topology.json",
    "data/europe_topology.na_v2.json", "data/water_regions.geojson",
    "data/scenarios/tno_1962/runtime_topology.topo.json",
    "data/scenarios/tno_1962/water_regions.geojson",
    "data/marine_regions.refined.source.geojson",
    "data/marine_regions.additional.source.geojson",
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

def rebuild(stage_root, *, refine_marine=False):
    stage_root = stage_root.resolve()
    if not stage_root.is_relative_to(ROOT / ".runtime") or stage_root.exists():
        raise ValueError("stage-root must be a new directory under repository .runtime")
    inputs = input_identity()
    source_marine = gpd.read_file(ROOT / "data/ne_10m_geography_marine_polys.zip")
    source_water = restore_marine_source(read(ROOT / "data/water_regions.geojson"), source_marine)
    if refine_marine:
        source_water = refine_base_water_regions(source_water)
    paths = []
    canonical_water = None
    compiled_primary = None
    physical_authority = read(ROOT / "data/europe_topology.json")
    for relative in ("data/europe_topology.json", "data/europe_topology.na_v2.json"):
        print(f"Compile {relative}", flush=True)
        topology = read(ROOT / relative)
        original = topology
        if relative.endswith(".na_v2.json"):
            topology = inherit_physical_water_masks(topology, physical_authority)
        if refine_marine and compiled_primary is not None:
            replacement = transplant_water_features(topology, compiled_primary)
        else:
            compiled = compile_named_water_regions(source_water,
                ocean_mask=decode(topology, "ocean"), land_mask=decode(topology, "land"))
            replacement = replace_water_topology_object(topology, compiled)
        if refine_marine:
            preserved = {f["properties"]["id"] for f in decode(original, "water_regions")["features"]
                         if f["properties"].get("region_group") not in {"ocean_macro", "marine_macro", "marine_detail"}}
            replacement = transplant_water_features(replacement, original, feature_ids=preserved)
        write(stage_root / relative, replacement)
        validate_water_runtime(replacement, land_object="land", ocean_object="ocean", stage_label=relative)
        # Actual decoder checks foreign objects, including arcs shared with water.
        for name in original["objects"]:
            expected = physical_authority if name in {"land", "ocean"} else original
            if name != "water_regions" and decode(expected, name) != decode(replacement, name):
                raise ValueError(f"Non-water object changed: {relative}::{name}")
        paths.append(relative)
        if canonical_water is None:
            canonical_water = decode_water(replacement, "water_regions")
            compiled_primary = replacement
    write(stage_root / "data/water_regions.geojson", canonical_water)
    paths.append("data/water_regions.geojson")

    # Import the existing scenario definitions, but regenerate only ordinary
    # water; use current masks and preserve every unrelated runtime object.
    from tools import patch_tno_1962_bundle as b
    relative = "data/scenarios/tno_1962/runtime_topology.topo.json"
    print(f"Compile {relative}", flush=True)
    topology = read(ROOT / relative)
    current_water = read(ROOT / "data/scenarios/tno_1962/water_regions.geojson")
    if refine_marine:
        # Adopt only new ordinary-sea polygons. Existing TNO sectors, lakes and
        # scenario coast keep their IDs and footprints except these exact cuts.
        additions = additional_snapshot_features()
        originals = {f["properties"]["id"]: deepcopy(f) for f in current_water["features"]}
        added_ids = {f["properties"]["id"] for f in additions}
        supplement = unary_union([shape(f["geometry"]) for f in additions])
        for feature in current_water["features"]:
            props = feature["properties"]
            if props.get("region_group") in {"ocean_macro", "marine_macro", "marine_detail"} and props["id"] not in added_ids:
                feature["geometry"] = mapping(polygonal(shape(feature["geometry"]).difference(supplement)))
        current_water["features"] = [f for f in current_water["features"] if f["properties"]["id"] not in added_ids]
        for feature in additions:
            feature["properties"].update(scenario_id="tno_1962", render_as_base_geography=False)
        physical_land = physical_mask_to_planar_geometry(decode(topology, "land_mask"))
        for feature in additions:
            feature["geometry"] = mapping(polygonal(shape(feature["geometry"]).difference(physical_land)))
        current_water["features"].extend(additions)
        current_water = reconcile_marine_source_boundaries(current_water)
        # Existing runtime water is already physically clipped. Re-clipping its
        # spherical coast creates new numerical slivers along unrelated shores.
        changed = [f for f in current_water["features"] if f["properties"]["id"] not in originals
                   or not shape(f["geometry"]).equals(shape(originals[f["properties"]["id"]]["geometry"]))]
        preserved = set(originals) - {f["properties"]["id"] for f in changed}
        compiled = compile_named_water_regions({"type": "FeatureCollection", "features": changed})
        replacement = replace_water_topology_object(topology, compiled, object_name="scenario_water")
        replacement = transplant_water_features(replacement, topology, object_name="scenario_water", feature_ids=preserved)
        by_id = {g["properties"]["id"]: g for g in replacement["objects"]["scenario_water"]["geometries"]}
        replacement["objects"]["scenario_water"]["geometries"] = [by_id[f["properties"]["id"]] for f in current_water["features"]]
        write(stage_root / relative, replacement)
        validate_water_runtime(replacement, object_name="scenario_water", land_object="land_mask", stage_label=relative)
        for name in topology["objects"]:
            if name != "scenario_water" and decode(topology, name) != decode(replacement, name):
                raise ValueError(f"Non-water object changed: TNO::{name}")
        paths.append(relative)
        source_relative = "data/scenarios/tno_1962/water_regions.geojson"
        write(stage_root / source_relative, decode_water(replacement, "scenario_water"))
        paths.append(source_relative)
        if inputs != input_identity():
            raise ValueError("Canonical inputs changed during staging; rebuild before promotion.")
        write(stage_root / "outputs.json", {"paths": paths, "input_sha256": inputs,
            "base_count": len(canonical_water["features"]), "tno_count": len(current_water["features"])})
        print(json.dumps({"stage_root": str(stage_root), "paths": paths}), flush=True)
        return
    named = [deepcopy(f) for f in current_water["features"]
             if f["properties"].get("water_type") != "ocean"]
    physical_land = physical_mask_to_planar_geometry(decode(topology, "land_mask"))
    named_by_id = {f["properties"]["id"]: f for f in named}
    clips = {}
    for spec in b.TNO_NAMED_MARGINAL_WATER_SPECS:
        feature = named_by_id.get(spec["id"])
        if feature is None:
            raise ValueError(f"Missing current named water {spec['id']}")
        for feature_id in spec.get("clip_open_ocean_ids", ()):
            clips.setdefault(feature_id, []).append(polygonal(shape(feature["geometry"])))
    component_min = {spec["id"]: float(spec.get("component_min_area") or 0)
                     for family in b.TNO_OPEN_OCEAN_SPLIT_SPECS for spec in family["children"]}
    atlantropa = decode(topology, "scenario_atlantropa")
    atlantropa_water = [shape(f["geometry"]) for f in atlantropa["features"]
                        if f["properties"].get("atl_render_layer") == "water"]
    template = b.load_mediterranean_template_water_gdf()
    atlantic_exclusions = [*atlantropa_water, *template.geometry]
    macros = b.clip_tno_open_ocean_split_features(
        b.build_tno_open_ocean_split_features(land_mask_geom=physical_land,
            base_water_regions=canonical_water,
            supplement_subtract_geometries_by_source_id={"marine_atlantic_ocean": atlantic_exclusions}),
        clips, component_min)
    print("TNO source partitions built; compile shared boundaries", flush=True)
    updated_by_id = {f["properties"]["id"]: f for f in [*macros, *named]}
    # Preserve original feature order, metadata and durable editing IDs.
    candidate = deepcopy(current_water)
    for feature in candidate["features"]:
        feature["geometry"] = updated_by_id[feature["properties"]["id"]]["geometry"]
    compiled = compile_named_water_regions(candidate, land_mask=physical_land)
    print("TNO planar compilation complete; encode topology", flush=True)
    write(stage_root / "data/scenarios/tno_1962/water_regions.geojson", compiled)
    replacement = replace_water_topology_object(topology, compiled, object_name="scenario_water")
    write(stage_root / relative, replacement)
    validate_water_runtime(replacement, object_name="scenario_water", land_object="land_mask", stage_label=relative)
    for name in topology["objects"]:
        if name != "scenario_water" and decode(topology, name) != decode(replacement, name):
            raise ValueError(f"Non-water object changed: TNO::{name}")
    paths.append(relative)
    source_relative = "data/scenarios/tno_1962/water_regions.geojson"
    write(stage_root / source_relative, decode_water(replacement, "scenario_water"))
    paths.append(source_relative)
    if inputs != input_identity():
        raise ValueError("Canonical inputs changed during staging; rebuild before promotion.")
    write(stage_root / "outputs.json", {"paths": paths, "input_sha256": inputs,
                                        "base_count": len(canonical_water["features"]),
                                        "tno_count": len(compiled["features"])})
    print(json.dumps({"stage_root": str(stage_root), "paths": paths}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage-root", type=Path, required=True)
    parser.add_argument("--refine-marine", action="store_true", help="Apply shared sources and ordinary-sea supplements")
    args = parser.parse_args()
    rebuild(args.stage_root, refine_marine=args.refine_marine)


if __name__ == "__main__":
    main()
