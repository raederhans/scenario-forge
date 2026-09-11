"""Rebuild only Atlantropa in an isolated copy of the current published scenario.

Run as ``py -3 -B -m tools.rebuild_atlantropa_stage --stage-dir .runtime/...``.
This never publishes or rebuilds country rules and localization.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from pathlib import Path
import shutil

import geopandas as gpd
from shapely.geometry import shape

from tools import patch_tno_1962_bundle as b
from tools import extract_scenario_atlantropa as extract


STABLE_PREFIXES = ("ATLPRV_", "ATLISL_")


def reconcile_feature_map(payload, key, old_ids, features, identity_map=None, merged_lineage=None):
    """Preserve stable/manual assignments, regenerate enumerated helper entries."""
    result = deepcopy(payload)
    values = result.setdefault(key, {})
    new = {feature["properties"]["id"]: feature for feature in features}
    for feature_id in old_ids - set(new):
        values.pop(feature_id, None)
    for feature_id, feature in new.items():
        source_ids = (merged_lineage or {}).get(feature_id) or []
        source_values = [payload[key][old_id] for old_id in source_ids if old_id in payload.get(key, {})]
        if source_values:
            if key == "cores":
                values[feature_id] = sorted({tag for tags in source_values for tag in tags})
            elif len(set(source_values)) == 1:
                values[feature_id] = source_values[0]
            else:
                raise ValueError(f"Island merge has conflicting {key}: {feature_id} from {source_ids}")
            continue
        lineage_id = (identity_map or {}).get(feature_id)
        if lineage_id and lineage_id in payload.get(key, {}):
            values[feature_id] = deepcopy(payload[key][lineage_id])
            continue
        if feature_id.startswith(STABLE_PREFIXES) and feature_id in values:
            continue
        owner = feature["properties"].get("owner_tag") or b.ATL_TAG
        values[feature_id] = [owner] if key == "cores" else owner
    return result


def _mask_frame(name, geometry):
    return gpd.GeoDataFrame([{"id": f"tno_1962_{name}", "name": name,
                             "geometry": b.split_full_width_polygonal_parts_for_d3(geometry)}], crs="EPSG:4326")


def merge_atlantropa_bathymetry(previous, generated):
    def unquantized(payload):
        result = deepcopy(payload)
        transform = result.pop("transform", None)
        if transform:
            sx, sy = transform["scale"]
            tx, ty = transform["translate"]
            for index, arc in enumerate(result.get("arcs", [])):
                x = y = 0
                decoded = []
                for dx, dy in arc:
                    x, y = x + dx, y + dy
                    decoded.append([x * sx + tx, y * sy + ty])
                result["arcs"][index] = decoded
        return result
    result, incoming = unquantized(previous), unquantized(generated)
    offset = len(result["arcs"])
    result["arcs"].extend(incoming["arcs"])
    remap = {index: index + offset for index in range(len(incoming["arcs"]))}
    for name, value in incoming["objects"].items():
        existing = result["objects"].setdefault(name, {"type": "GeometryCollection", "geometries": []})
        kept = [geom for geom in existing["geometries"]
                if geom.get("properties", {}).get("region_id") not in b.ATLANTROPA_REGION_CONFIGS]
        for geometry in value["geometries"]:
            if geometry.get("properties", {}).get("region_id") not in b.ATLANTROPA_REGION_CONFIGS:
                continue
            geometry["arcs"] = b._remap_topology_arc_refs(geometry["arcs"], remap)
            kept.append(geometry)
        existing["geometries"] = kept
    b.compact_topology_arcs(result)
    result.pop("bbox", None)
    return result


def rebuild_stage(source_dir: Path, stage_dir: Path, *, overlap_policy="strict", published_lineage=None):
    source_dir, stage_dir = source_dir.resolve(), stage_dir.resolve()
    runtime_root = (b.ROOT / ".runtime").resolve()
    if not stage_dir.is_relative_to(runtime_root) or stage_dir == runtime_root or stage_dir.exists():
        raise ValueError("stage-dir must be a new directory under repository .runtime")
    if stage_dir.name != b.SCENARIO_ID:
        raise ValueError("stage-dir must end in tno_1962 for the existing TNO contract profile")
    if source_dir == stage_dir or not source_dir.is_dir():
        raise ValueError("A separate existing source scenario is required")
    topology = b.load_json(source_dir / b.CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME)
    if topology.get("transform"):
        raise ValueError("Scoped replacement requires the existing unquantized runtime topology")
    political_before = b.topology_object_to_feature_collection(topology, "political")
    old_atl = b.topology_object_to_feature_collection(topology, extract.ATLANTROPA_OBJECT_NAME)["features"]
    if published_lineage is not None:
        old_atl = b.hydrate_atl_island_lineage(old_atl, b.load_json(published_lineage)["features"])
    old_ids = {feature["properties"]["id"] for feature in old_atl}
    if overlap_policy not in {"strict", "preserve-published-visible"}:
        raise ValueError("Unknown overlap policy")
    priority = None
    priority_source = None
    if overlap_policy == "preserve-published-visible":
        priority = {feature["properties"]["id"]: -index for index, feature in enumerate(old_atl)}
        priority_source = f"Explicit preserve-published-visible policy; frozen source {source_dir} draw order"
    diagnostic_dir = stage_dir.with_name(stage_dir.name + "-diagnostics")
    diagnostic_dir.mkdir(parents=True, exist_ok=True)
    b.write_json(diagnostic_dir / "published-draw-order.json", {"policy": overlap_policy,
                 "feature_ids": [feature["properties"]["id"] for feature in old_atl]})
    def save_donor_diagnostics(features, diagnostics):
        b.write_json(diagnostic_dir / "donor-before-normalize.geojson", {"type": "FeatureCollection", "features": features})
        b.write_json(diagnostic_dir / "donor-diagnostics.json", diagnostics)
    owners = b.load_json(source_dir / "owners.by_feature.json")
    baseline = b.load_runtime_political_gdf()
    reference = b.load_atlantropa_land_reference(baseline)
    donor = b.load_hgo_context(b.resolve_hgo_root())
    try:
        land, regions, land_diagnostics, replacements = b.build_atlantropa_from_hgo(
            donor, baseline, owner_by_feature_id=owners.get("owners", {}), land_reference=reference,
            published_features=old_atl, pre_normalize_callback=save_donor_diagnostics,
            overlap_priority=priority, overlap_priority_source=priority_source,
        )
    except ValueError as error:
        b.write_json(diagnostic_dir / "failure.json", {"error": str(error), "diagnostics": getattr(error, "diagnostics", None)})
        raise
    water_snapshot = b.load_json(source_dir / b.MARINE_REGIONS_NAMED_WATER_SNAPSHOT_FILENAME)
    water = b.topology_object_to_gdf(topology, "scenario_water")
    congo = b.safe_unary_union(water.loc[water["id"] == "congo_lake"].geometry)
    removed_ids, replacement_diagnostics = b.collect_baseline_island_drop_ids(baseline, replacements)
    explicit_cuts = b.safe_unary_union([congo, *baseline.loc[baseline["id"].isin(removed_ids)].geometry])
    base_without_cuts = reference.difference(explicit_cuts) if explicit_cuts is not None else reference
    sea, _, sea_diagnostics = b.build_atl_sea_from_hgo(
        donor, baseline, regions, land_reference=reference, replacement_specs=replacements,
        other_water_geom=b.build_mediterranean_other_water_geom(water_snapshot),
    )
    sea, sea_quality = b.exclude_land_from_sea(sea, land)
    sea_diagnostics["geometry_quality"] = sea_quality
    sea_union = b.safe_unary_union([shape(feature["geometry"]) for feature in sea])
    all_features = [*land, *sea]
    b.write_json(diagnostic_dir / "normalized-atlantropa.geojson", {
        "type": "FeatureCollection", "features": all_features,
    })
    b.write_json(diagnostic_dir / "normalized-diagnostics.json", {
        "land": land_diagnostics, "sea": sea_diagnostics,
    })
    print(f"Strict geometry prepared: {len(land)} land/shoal, {len(sea)} sea features", flush=True)
    classified = b.apply_atlantropa_runtime_fields(b.geopandas_from_features(all_features))
    # This scoped rebuild preserves scenario_water, so its lake boundaries must
    # also own the mask cutouts. Global water may have been re-encoded separately.
    base_water = b.build_tno_base_geography_water_clone_union([
        feature for feature in b.gdf_to_feature_collection(water)["features"]
        if feature["properties"].get("id") in b.TNO_BASE_GEOGRAPHY_WATER_CLONE_IDS
    ])
    if sea_union is not None:
        base_without_cuts = base_without_cuts.difference(sea_union)
    if base_water is not None:
        base_without_cuts = base_without_cuts.difference(base_water)
    # Keep the existing mask convention: shoals contribute to physical coverage,
    # while the dedicated coastline helper only adds render-layer land.
    mask = b.safe_unary_union([base_without_cuts, *[shape(feature["geometry"]) for feature in land]])
    context, tolerance, area_delta, fallback, arc_refs = b.build_context_land_mask_geometry(mask)
    coast = b.build_scenario_coastline_geometry(
        reference, b.gdf_to_feature_collection(classified)["features"], removed_land_geometry=explicit_cuts,
    )
    for name, frame in ((extract.ATLANTROPA_OBJECT_NAME, classified),
                        ("land_mask", _mask_frame("land_mask", mask)),
                        ("context_land_mask", _mask_frame("context_land_mask", context)),
                        ("scenario_coastline", _mask_frame("scenario_coastline", coast))):
        b.replace_topology_object_from_gdf_for_d3(topology, name, frame)
    b.compact_topology_arcs(topology)
    if b.topology_object_to_feature_collection(topology, "political") != political_before:
        raise ValueError("Scoped rebuild changed non-Atlantropa political geometry")

    shutil.copytree(source_dir, stage_dir)
    print("Topology encoded; writing isolated scenario assets", flush=True)
    b.write_json(stage_dir / b.CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME, topology)
    b.write_json(stage_dir / b.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, b.build_bootstrap_runtime_topology(topology))
    for filename, key in (("owners.by_feature.json", "owners"), ("controllers.by_feature.json", "controllers"),
                          ("cores.by_feature.json", "cores")):
        path = source_dir / filename
        if path.exists():
            identity_map = {new: old for value in land_diagnostics.values() if isinstance(value, dict)
                            for new, old in value.get("island_identity_map", {}).items()}
            merged_lineage = {entry["feature_id"]: entry["old_feature_ids"]
                              for value in land_diagnostics.values() if isinstance(value, dict)
                              for entry in value.get("island_identity", {}).get("lineage", [])
                              if len(entry["old_feature_ids"]) > 1}
            b.write_json(stage_dir / filename, reconcile_feature_map(
                b.load_json(path), key, old_ids, all_features, identity_map, merged_lineage))
    countries = b.load_json(stage_dir / "countries.json")
    for filename, map_key, count_key in (("owners.by_feature.json", "owners", "feature_count"),
                                          ("controllers.by_feature.json", "controllers", "controller_feature_count")):
        if not (source_dir / filename).exists():
            continue
        old_map = b.load_json(source_dir / filename)[map_key]
        new_map = b.load_json(stage_dir / filename)[map_key]
        before, after = Counter(old_map.values()), Counter(new_map.values())
        for tag, entry in countries.get("countries", {}).items():
            delta = after[tag] - before[tag]
            if delta and count_key in entry:
                entry[count_key] += delta
    b.write_json(stage_dir / "countries.json", countries)

    geometries = topology["objects"][extract.ATLANTROPA_OBJECT_NAME]["geometries"]
    metadata = extract.build_metadata(b.SCENARIO_ID, geometries)
    b.write_json(stage_dir / extract.ATLANTROPA_TOPOLOGY_FILENAME,
                 b.build_single_object_topology_payload(topology, extract.ATLANTROPA_OBJECT_NAME))
    b.write_json(stage_dir / extract.ATLANTROPA_METADATA_FILENAME, metadata)
    manifest = b.load_json(stage_dir / "manifest.json")
    summary = manifest.setdefault("summary", {})
    summary["scenario_atlantropa_feature_count"] = len(all_features)
    summary["scenario_runtime_topology_object_count"] = len(topology["objects"])
    new_owners = b.load_json(stage_dir / "owners.by_feature.json")["owners"]
    summary["feature_count"] = len(new_owners)
    summary["owner_count"] = len(set(new_owners.values()))
    synthetic_count = sum(bool(countries["countries"].get(tag, {}).get("synthetic_owner"))
                          for tag in new_owners.values())
    summary["synthetic_owner_feature_count"] = synthetic_count
    if "synthetic_count" in summary:
        summary["synthetic_count"] = synthetic_count
    b.write_json(stage_dir / "manifest.json", manifest)
    audit = b.load_json(stage_dir / "audit.json")
    audit.setdefault("summary", {})["scenario_atlantropa_feature_count"] = len(all_features)
    for tag, entry in countries.get("countries", {}).items():
        stats = audit.setdefault("owner_stats", {}).get(tag)
        if stats is not None and (stats.get("feature_count") != entry.get("feature_count")
                                  or stats.get("controller_feature_count") != entry.get("controller_feature_count")):
            audit["owner_stats"][tag] = b.build_owner_stats_entry(entry)
    audit.setdefault("diagnostics", {}).update({
        "atlantropa_region_stats": land_diagnostics, "mediterranean_water_region_stats": sea_diagnostics,
        "atlantropa_island_replacement_stats": replacement_diagnostics,
        "context_land_mask_tolerance": tolerance, "context_land_mask_area_delta_ratio": area_delta,
        "context_land_mask_fallback_used": fallback, "context_land_mask_arc_refs": arc_refs,
        "atl_feature_count": len(land), "atl_sea_feature_count": len(sea),
        "runtime_topology_objects": list(topology["objects"]),
        "runtime_feature_count": len(new_owners),
    })
    b.write_json(stage_dir / "audit.json", audit)
    runtime_meta = b.load_json(stage_dir / "runtime_meta.json")
    runtime_meta["runtime_topology_object_names"] = list(topology["objects"])
    runtime_meta["runtime_topology_object_count"] = len(topology["objects"])
    b.write_json(stage_dir / "runtime_meta.json", runtime_meta)

    group_ids = {config["feature_group_id"] for config in b.ATLANTROPA_REGION_CONFIGS.values()}
    def is_atl_relief(feature):
        props = feature.get("properties", {})
        return props.get("id") in group_ids or props.get("parent_id") in group_ids
    relief_path = stage_dir / b.CHECKPOINT_RELIEF_FILENAME
    if relief_path.exists():
        relief = b.load_json(relief_path)
        generated = b.build_relief_overlays(regions, congo)
        relief["features"] = [feature for feature in relief["features"] if not is_atl_relief(feature)] + [
            feature for feature in generated["features"] if is_atl_relief(feature)]
        b.write_json(relief_path, relief)
    bathymetry, _ = b.build_tno_bathymetry_payload(sea, regions)
    bathymetry_path = stage_dir / b.CHECKPOINT_BATHYMETRY_FILENAME
    b.write_json(bathymetry_path, merge_atlantropa_bathymetry(b.load_json(bathymetry_path), bathymetry))
    # Reuse the standard dependency and contract writers. The final baseline
    # comparison must confirm localization and all non-ATL semantics survived.
    b.build_checkpoint_chunk_assets(stage_dir)
    print("Chunks and startup assets written; refreshing scenario contracts", flush=True)
    b.apply_safe_scenario_contract_repairs(
        stage_dir, rebuild_chunk_assets=False,
        report_path=diagnostic_dir / "scenario-contracts.json",
    )
    return {"stage_dir": str(stage_dir), "land_count": len(land), "sea_count": len(sea)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=b.SCENARIO_DIR)
    parser.add_argument("--stage-dir", type=Path, required=True)
    parser.add_argument("--overlap-policy", choices=("strict", "preserve-published-visible"), default="strict")
    parser.add_argument("--published-lineage", type=Path,
                        help="Explicit legacy checkpoint with geometry-identical island donor provenance")
    args = parser.parse_args()
    print(rebuild_stage(args.source_dir, args.stage_dir, overlap_policy=args.overlap_policy,
                        published_lineage=args.published_lineage))


if __name__ == "__main__":
    main()
