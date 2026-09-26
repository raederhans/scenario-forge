"""Rebuild only Atlantropa in an isolated copy of the current published scenario.

Run as ``py -3 -B -m tools.rebuild_atlantropa_stage --stage-dir .runtime/...``.
This never publishes or rebuilds country rules and localization.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from pathlib import Path, PurePosixPath
import re
import shutil

import geopandas as gpd
from shapely.geometry import MultiPolygon, box, mapping, shape
from shapely.geometry.polygon import orient

from tools import patch_tno_1962_bundle as b
from tools import extract_scenario_atlantropa as extract


STABLE_PREFIXES = ("ATLPRV_", "ATLISL_")
IDENTITY_GUARDED_HELPER_PREFIXES = ("ATLSHL_", "ATLWLD_")
WATER_CLIP_GEOMETRY_EPSILON = 1e-12


def reconcile_feature_map(payload, key, old_ids, features, identity_map=None, merged_lineage=None,
                          identical_helper_ids=None):
    """Preserve stable/manual assignments, regenerate enumerated helper entries."""
    result = deepcopy(payload)
    values = result.setdefault(key, {})
    new = {feature["properties"]["id"]: feature for feature in features}
    for feature_id in old_ids - set(new):
        values.pop(feature_id, None)
    for feature_id, feature in new.items():
        if feature_id in (identical_helper_ids or ()) and feature_id in values:
            continue
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


def preserve_identical_atl_helper_assignments(old_features, new_features, *, renamed_ids=None,
                                               reallocated_ids=None):
    """Reconcile enumerated helpers by unique geometry and donor identity before assigning IDs."""
    old_helpers = [feature for feature in old_features
                   if str(feature.get("properties", {}).get("id") or "").startswith(IDENTITY_GUARDED_HELPER_PREFIXES)]
    new_helpers = [feature for feature in new_features
                   if str(feature.get("properties", {}).get("id") or "").startswith(IDENTITY_GUARDED_HELPER_PREFIXES)]
    old_ids = [feature["properties"]["id"] for feature in old_helpers]
    new_ids = [feature["properties"]["id"] for feature in new_helpers]
    if len(set(old_ids)) != len(old_ids) or len(set(new_ids)) != len(new_ids):
        raise ValueError("Atlantropa helper IDs are duplicated before identity reconciliation")
    identity_fields = ("region_id", "atl_geometry_role", "atl_join_mode", "source_standard",
                       "donor_state_ids", "donor_state_names", "donor_province_ids")

    def same_source(previous, current):
        old_props, new_props = previous.get("properties", {}), current.get("properties", {})
        old_layer = b.classify_atlantropa_feature_id(old_props.get("id"))
        new_layer = b.classify_atlantropa_feature_id(new_props.get("id"))
        if (old_layer is None or new_layer is None or old_layer[0] != new_layer[0]
                or old_props.get("atl_render_layer", old_layer[0]) != old_layer[0]
                or new_props.get("atl_render_layer", new_layer[0]) != new_layer[0]):
            return False
        return (all(old_props.get(field) == new_props.get(field) for field in identity_fields)
                and shape(previous["geometry"]).equals(shape(current["geometry"])))

    def retain(previous, current):
        old_props, props = previous["properties"], current["properties"]
        props["id"] = old_props["id"]
        for field in ("name", "owner_tag", "synthetic_owner", "assignment_source"):
            if field in old_props:
                props[field] = deepcopy(old_props[field])

    # Match the complete old and new sets before changing any ID: newly inserted
    # helpers can occupy several published numbers in a chain.
    matches = {}
    old_match_counts = Counter()
    for feature in new_helpers:
        candidates = [old for old in old_helpers if same_source(old, feature)]
        if len(candidates) > 1:
            raise ValueError(f"Ambiguous Atlantropa helper identity: {feature['properties']['id']}")
        if candidates:
            old_id = candidates[0]["properties"]["id"]
            matches[feature["properties"]["id"]] = candidates[0]
            old_match_counts[old_id] += 1
    duplicated_matches = [old_id for old_id, count in old_match_counts.items() if count > 1]
    if duplicated_matches:
        raise ValueError(f"Atlantropa helper identity reused by multiple new features: {duplicated_matches}")

    preserved = {old["properties"]["id"] for old in matches.values()}
    reserved = set(old_ids) | set(new_ids)
    next_number = {}
    for feature_id in reserved:
        match = re.fullmatch(r"(ATLSHL_|ATLWLD_)(.+)_(\d+)", str(feature_id))
        if match:
            group = match.group(1), match.group(2)
            next_number[group] = max(next_number.get(group, 0), int(match.group(3)))
    reallocations = {}
    for feature in new_helpers:
        current_id = feature["properties"]["id"]
        if current_id in matches or current_id not in preserved:
            continue
        match = re.fullmatch(r"(ATLSHL_|ATLWLD_)(.+)_(\d+)", str(current_id))
        if not match:
            raise ValueError(f"Cannot reallocate occupied Atlantropa helper ID: {current_id}")
        group = match.group(1), match.group(2)
        while True:
            next_number[group] += 1
            replacement = f"{match.group(1)}{match.group(2)}_{next_number[group]}"
            if replacement not in reserved:
                break
        name = str(feature["properties"].get("name") or "")
        name_match = re.search(r"\b(\d+)$", name)
        if name_match is None or int(name_match.group(1)) != int(match.group(3)):
            raise ValueError(f"Cannot reallocate helper with non-enumerated name: {current_id}")
        reallocations[current_id] = (feature, replacement, name[:name_match.start(1)] + str(next_number[group]))
        reserved.add(replacement)

    for feature in new_helpers:
        current_id = feature["properties"]["id"]
        previous = matches.get(current_id)
        if previous is not None:
            retain(previous, feature)
            if renamed_ids is not None and current_id != previous["properties"]["id"]:
                renamed_ids[current_id] = previous["properties"]["id"]
        elif current_id in reallocations:
            _, replacement, name = reallocations[current_id]
            feature["properties"]["id"] = replacement
            feature["properties"]["name"] = name
            if reallocated_ids is not None:
                reallocated_ids[current_id] = replacement
    final_ids = [feature["properties"]["id"] for feature in new_helpers]
    if len(set(final_ids)) != len(final_ids):
        raise ValueError("Atlantropa helper IDs collided after identity reconciliation")
    return preserved


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


def clip_new_atlantropa_land_from_named_water(topology, water_payload, old_atl, new_atl):
    """Clip only newly reclaimed land from intersecting, supported named water."""
    def land_union(features):
        geoms = [shape(feature["geometry"]) for feature in features
                 if feature.get("properties", {}).get("atl_render_layer") == "land"]
        if any(not geom.is_valid for geom in geoms):
            raise ValueError("Atlantropa render-land geometry is invalid")
        return b.safe_unary_union(geoms)

    old_land, new_land = land_union(old_atl), land_union(new_atl)
    if new_land is None:
        raise ValueError("Rebuilt Atlantropa has no render-land geometry")
    added = new_land.difference(old_land) if old_land is not None else new_land
    if added.is_empty or added.area <= 0:
        return None, {"changed_water_ids": [], "removed_area_degrees2": 0.0}

    source_features = water_payload.get("features")
    topo_geometries = topology.get("objects", {}).get("scenario_water", {}).get("geometries")
    if water_payload.get("type") != "FeatureCollection" or not isinstance(source_features, list) or not isinstance(topo_geometries, list):
        raise ValueError("Scoped named-water clip requires source and runtime water feature collections")
    source_by_id = {feature.get("properties", {}).get("id"): feature for feature in source_features}
    topo_by_id = {geom.get("properties", {}).get("id"): (index, geom)
                  for index, geom in enumerate(topo_geometries)}
    if (None in source_by_id or None in topo_by_id or len(source_by_id) != len(source_features)
            or len(topo_by_id) != len(topo_geometries) or set(source_by_id) != set(topo_by_id)):
        raise ValueError("Source water and runtime scenario_water IDs do not match uniquely")
    runtime_features = b.topology_object_to_feature_collection(topology, "scenario_water")["features"]
    runtime_by_id = {feature["properties"]["id"]: feature for feature in runtime_features}
    allowed = {str(spec["id"]): spec for spec in b.TNO_NAMED_MARGINAL_WATER_SPECS}
    replacements = {}
    diagnostics = []
    for feature_id, feature in source_by_id.items():
        original = shape(feature["geometry"])
        runtime = shape(runtime_by_id[feature_id]["geometry"])
        if not original.is_valid or not runtime.is_valid:
            if box(*original.bounds).intersects(added) or box(*runtime.bounds).intersects(added):
                raise ValueError(f"Invalid intersecting scenario_water geometry: {feature_id}")
            continue
        if original.intersection(added).area <= 0 and runtime.intersection(added).area <= 0:
            continue
        if not original.equals(runtime) or feature["properties"] != runtime_by_id[feature_id]["properties"]:
            raise ValueError(f"Source and runtime scenario_water differ before clipping: {feature_id}")
        spec = allowed.get(feature_id)
        if spec is None or not spec.get("clip_against_land_mask", True):
            raise ValueError(f"Unsupported scenario_water overlaps newly added Atlantropa land: {feature_id}")
        clipped = b.clip_named_water_features_to_land_mask([feature], added)[0]
        compiled = b.compile_named_water_regions({"type": "FeatureCollection", "features": [clipped]})["features"][0]
        expected = original.difference(added)
        actual = shape(compiled["geometry"])
        # The D3 compiler drops components below its numerical floor. Keep the
        # exact source-supported cutouts; orient their rings like compiled water.
        missing_parts = [part for part in b.iter_polygon_parts(expected)
                         if part.intersection(actual).area <= 0]
        if missing_parts:
            actual = MultiPolygon([*b.iter_polygon_parts(actual),
                                   *(orient(part, sign=-1) for part in missing_parts)])
            compiled["geometry"] = mapping(actual)
        if (not actual.is_valid or actual.is_empty
                or expected.symmetric_difference(actual).area > WATER_CLIP_GEOMETRY_EPSILON
                or any(part.intersection(actual).area <= 0 for part in b.iter_polygon_parts(expected))):
            raise ValueError(f"Named-water D3 compilation changed more than the new land cut: {feature_id}")
        if compiled["properties"] != feature["properties"]:
            raise ValueError(f"Named-water metadata changed during clipping: {feature_id}")
        replacements[feature_id] = compiled["geometry"]
        diagnostics.append({"id": feature_id, "removed_area_degrees2": original.intersection(added).area})

    if not replacements:
        return None, {"changed_water_ids": [], "removed_area_degrees2": 0.0}
    updated = deepcopy(water_payload)
    for feature in updated["features"]:
        feature_id = feature["properties"]["id"]
        if feature_id in replacements:
            feature["geometry"] = replacements[feature_id]
    for feature_id, geometry in replacements.items():
        index, old_geometry = topo_by_id[feature_id]
        topo_geometries[index] = b._geometry_to_topology_geometry(topology, old_geometry, shape(geometry))
    return updated, {
        "changed_water_ids": [entry["id"] for entry in diagnostics],
        "removed_area_degrees2": sum(entry["removed_area_degrees2"] for entry in diagnostics),
        "features": diagnostics,
    }


def preserve_political_chunks_for_unchanged_source(
    source_dir: Path, stage_dir: Path, political_before: dict, political_after: dict,
) -> list[str]:
    """Reuse published political LOD when its full source and assignments are unchanged."""
    if political_before != political_after:
        raise ValueError("Political source features changed; published chunks cannot be reused")
    political_ids = [str(feature.get("properties", {}).get("id") or "").strip()
                     for feature in political_before.get("features", [])]
    if not political_ids or any(not feature_id for feature_id in political_ids) or len(set(political_ids)) != len(political_ids):
        raise ValueError("Political source has missing or duplicate feature IDs")
    for filename, key in (("owners.by_feature.json", "owners"),
                          ("controllers.by_feature.json", "controllers"),
                          ("cores.by_feature.json", "cores")):
        old_path, new_path = source_dir / filename, stage_dir / filename
        if old_path.exists() != new_path.exists():
            raise ValueError(f"Political assignment map presence changed: {filename}")
        if not old_path.exists():
            continue
        old_values = b.load_json(old_path).get(key)
        new_values = b.load_json(new_path).get(key)
        if not isinstance(old_values, dict) or not isinstance(new_values, dict):
            raise ValueError(f"Political assignment map is invalid: {filename}")
        absent = object()
        if any(old_values.get(feature_id, absent) != new_values.get(feature_id, absent)
               for feature_id in political_ids):
            raise ValueError(f"Political assignment map changed: {filename}")

    manifest_name = "detail_chunks.manifest.json"
    old_manifest = b.load_json(source_dir / manifest_name)
    new_manifest = b.load_json(stage_dir / manifest_name)

    def political_index(manifest):
        entries = {}
        for entry in manifest.get("chunks", []):
            if entry.get("layer") != "political":
                continue
            chunk_id = str(entry.get("id") or "").strip()
            if not chunk_id or chunk_id in entries:
                raise ValueError("Political chunk manifest has missing or duplicate ID")
            entries[chunk_id] = entry
        return entries

    old_by_id = political_index(old_manifest)
    new_by_id = political_index(new_manifest)
    if (not old_by_id or set(old_by_id) != set(new_by_id)
            or any(old_by_id[chunk_id].get("url") != new_by_id[chunk_id].get("url")
                   for chunk_id in old_by_id)):
        raise ValueError("Political chunk ID/URL manifest changed")
    restore = []
    for index, entry in enumerate(new_manifest.get("chunks", [])):
        if entry.get("layer") != "political":
            continue
        chunk_id = str(entry["id"]).strip()
        previous = old_by_id[chunk_id]
        url_parts = PurePosixPath(str(entry["url"])).parts
        prefix = ("data", "scenarios", b.SCENARIO_ID, "chunks")
        if url_parts[:4] != prefix or len(url_parts) <= 4 or ".." in url_parts:
            raise ValueError(f"Political chunk URL is outside the scenario chunks: {chunk_id}")
        relative = Path("chunks", *url_parts[4:])
        old_path, new_path = source_dir / relative, stage_dir / relative
        restore.append((index, chunk_id, old_path, new_path, previous))
    for index, _chunk_id, old_path, new_path, previous in restore:
        shutil.copy2(old_path, new_path)
        new_manifest["chunks"][index] = deepcopy(previous)
    if restore:
        b.write_json(stage_dir / manifest_name, new_manifest)
    # The chunk writer may reformat an unchanged political mesh pack. Keep its
    # published bytes only after proving that every parsed value is identical.
    old_mesh, new_mesh = source_dir / "mesh_pack.json", stage_dir / "mesh_pack.json"
    if old_mesh.is_file() and new_mesh.is_file() and b.load_json(old_mesh) == b.load_json(new_mesh):
        shutil.copy2(old_mesh, new_mesh)
    return [chunk_id for _index, chunk_id, _old_path, _new_path, _previous in restore]


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
    helper_renames = {}
    helper_reallocations = {}
    identical_helper_ids = preserve_identical_atl_helper_assignments(
        old_atl, all_features, renamed_ids=helper_renames, reallocated_ids=helper_reallocations)
    b.write_json(diagnostic_dir / "normalized-atlantropa.geojson", {
        "type": "FeatureCollection", "features": all_features,
    })
    b.write_json(diagnostic_dir / "normalized-diagnostics.json", {
        "land": land_diagnostics, "sea": sea_diagnostics,
    })
    print(f"Strict geometry prepared: {len(land)} land/shoal, {len(sea)} sea features", flush=True)
    classified = b.apply_atlantropa_runtime_fields(b.geopandas_from_features(all_features))
    updated_water, water_clip_diagnostics = clip_new_atlantropa_land_from_named_water(
        topology, b.load_json(source_dir / "water_regions.geojson"), old_atl,
        b.gdf_to_feature_collection(classified)["features"],
    )
    # Existing lake boundaries continue to own their mask cutouts.
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
    political_after = b.topology_object_to_feature_collection(topology, "political")
    if political_after != political_before:
        raise ValueError("Scoped rebuild changed non-Atlantropa political geometry")

    shutil.copytree(source_dir, stage_dir)
    print("Topology encoded; writing isolated scenario assets", flush=True)
    if updated_water is not None:
        b.write_json(stage_dir / "water_regions.geojson", updated_water)
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
                b.load_json(path), key, old_ids, all_features, identity_map, merged_lineage,
                identical_helper_ids=identical_helper_ids))
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
        "named_water_new_atl_land_clip": water_clip_diagnostics,
        "identity_preserved_atl_helper_ids": sorted(identical_helper_ids),
        "identity_preserved_atl_helper_renames": helper_renames,
        "new_atl_helper_reallocations": helper_reallocations,
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
    preserved_political_chunks = preserve_political_chunks_for_unchanged_source(
        source_dir, stage_dir, political_before, political_after)
    audit = b.load_json(stage_dir / "audit.json")
    audit.setdefault("diagnostics", {})["identity_preserved_political_chunk_ids"] = preserved_political_chunks
    b.write_json(stage_dir / "audit.json", audit)
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
