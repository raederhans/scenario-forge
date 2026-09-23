"""Stage a county-ID migration for the modern-world baseline, outside production.

County geometry is prepared separately. This adapter preserves every non-target
geometry and rejects scenario assignments it cannot derive without guessing.
The overlap crosswalk is review evidence, never an automatic import migration.
"""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
import re
import shutil
import sys
import time
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import shape

from map_builder.geo.topology import compute_neighbor_graph
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import (
    _absolute_topology, _compact_arcs, _decode_geometry, _encode_exact_coverage,
    _offset_arcs, _update_bbox,
)
from tools.prepare_tno_russia_precision import digest, read
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets
from tools.build_tno_russia_precision_assets import finalize_stage, peak_memory
from tools.build_startup_bootstrap_assets import (
    build_bootstrap_runtime_topology, build_startup_locales_payload,
    build_startup_geo_aliases_payload,
)
from tools.generate_hierarchy import slugify
from tools.patch_tno_1962_bundle import stable_json_hash

LEGACY_LINEAGE_PATH = ROOT / "tools/us_county_legacy_lineage.json"
COUNTY_ID_PATTERN = re.compile(r"US_CNTY_[0-9]{5}\Z")
ZONE_ID_PATTERN = re.compile(r"US_ZN_[0-9]{2}_[0-9]{3}\Z")


def validate_source_report(source_path, source):
    """Bind a complete, reviewed state scope to the exact display artifact."""
    report = read(source_path.with_name("source-report.json"))
    if report.get("display_geojson_sha256") != digest(source_path):
        raise ValueError("County source report does not match display bytes")
    actual = {}
    for feature in source.get("features", []):
        props = feature.get("properties", {})
        geoid = props.get("GEOID")
        state = props.get("STATEFP")
        if (not isinstance(geoid, str) or not isinstance(state, str)
                or geoid[:2] != state or props.get("id") != f"US_CNTY_{geoid}"):
            raise ValueError("County GEOID, state and feature ID disagree")
        actual.setdefault(state, []).append(geoid)
    declared = {}
    for state in report.get("states", []):
        statefp = state.get("statefp")
        source_ids, display_ids = state.get("source_geoids"), state.get("display_geoids")
        if (statefp in declared or not source_ids or not display_ids
                or len(set(source_ids)) != len(source_ids)
                or sorted(source_ids) != sorted(display_ids)
                or sorted(source_ids) != sorted(actual.get(statefp, []))
                or state.get("coverage_valid") is not True
                or state.get("geometry_invalid_count") != 0):
            raise ValueError("County source must contain every declared state's complete valid membership")
        declared[statefp] = source_ids
    if not declared or set(declared) != set(actual):
        raise ValueError("County source scope differs from the source report")
    return report


def baseline_surface(topology, row):
    """Ignore only zero-extent polygon parts when measuring a replaced baseline.

    Modern US_ZN_36_015 contains a two-coordinate repeated point. The county
    replacement is authoritative; this is an audit decoder, not geometry repair.
    """
    if row.get("type") != "MultiPolygon":
        return _decode_geometry(topology, row), 0
    parts, discarded = [], 0
    for polygon in row["arcs"]:
        exterior = [tuple(point) for i in polygon[0]
                    for point in topology["arcs"][i if i >= 0 else ~i]]
        if len(set(exterior)) == 1:
            discarded += 1
            continue
        parts.append(_decode_geometry(topology, {"type": "Polygon", "arcs": polygon}))
    return shapely.union_all(parts), discarded


def replace_counties(baseline: dict, source: dict, owners: dict, cores: dict):
    features = source.get("features", [])
    if not features:
        raise ValueError("County source is empty")
    ids = [f.get("properties", {}).get("id", "") for f in features]
    if len(ids) != len(set(ids)) or any(
        not isinstance(fid, str) or len(fid) != 13 or not fid.startswith("US_CNTY_")
        or not fid[8:].isascii() or not fid[8:].isdigit() for fid in ids
    ):
        raise ValueError("Unique US_CNTY_<five-digit GEOID> IDs are required")
    if any(f["properties"].get("cntr_code") != "US" for f in features):
        raise ValueError("Only US county sources are supported")
    groups = {f["properties"].get("admin1_group") for f in features}
    if None in groups or "" in groups:
        raise ValueError("Source must provide state names in admin1_group")
    result = _absolute_topology(baseline)
    rows = result["objects"]["political"]["geometries"]
    old_ids = [f["properties"]["id"] for f in rows]
    if len(old_ids) != len(set(old_ids)):
        raise ValueError("Baseline has duplicate feature IDs")
    selected = [f for f in rows if f["properties"].get("cntr_code") == "US"
                and f["properties"].get("admin1_group") in groups]
    if not selected:
        raise ValueError("No baseline US states match the source")
    selected_ids = {f["properties"]["id"] for f in selected}
    if set(ids) & (set(old_ids) - selected_ids):
        raise ValueError("New county ID collides with an untouched feature")
    if any(owners.get(fid) != "US" or cores.get(fid) != ["US"] for fid in selected_ids):
        raise ValueError("County migration requires uniform modern US ownership and cores")
    geometries = [shape(f["geometry"]) for f in features]
    if any(g.is_empty or not g.is_valid or g.geom_type not in {"Polygon", "MultiPolygon"}
           for g in geometries):
        raise ValueError("Invalid county source geometry")
    # No repair or snapping here: source adapter owns the coverage decision.
    if not shapely.coverage_is_valid(geometries):
        raise ValueError("County source must have valid shared coverage")
    baseline_parts = [baseline_surface(result, f) for f in selected]
    old_geometries = [g for g, _ in baseline_parts]
    invalid_baseline = {f["properties"]["id"]: str(shapely.is_valid_reason(g))
                        for f, g in zip(selected, old_geometries) if g is None or not g.is_valid}
    # Invalid OLD polygons cannot establish an overlap migration. Replacing the
    # source is still allowed, but those legacy edits remain explicitly unresolved.
    # Never repair an old bow-tie and present its invented surface as evidence.
    old_surface = shapely.union_all([g for g in old_geometries if g is not None and g.is_valid])
    new_surface = shapely.union_all(geometries)
    # A source change may reveal old missing land, but may not silently paint
    # another country. Report actual intersections; do not assign by proximity.
    foreign_overlap = []
    tree = shapely.STRtree(geometries)
    for row in rows:
        props = row["properties"]
        if props["id"] in selected_ids:
            continue
        foreign = _decode_geometry(result, row)
        if foreign is None:
            raise ValueError(f"Neighbor geometry cannot be decoded: {props['id']}")
        if not foreign.is_valid and len(tree.query(foreign.envelope)):
            raise ValueError(f"Invalid neighbor near county source: {props['id']}")
        if foreign is not None and foreign.is_valid:
            nearby = tree.query(foreign, predicate="intersects")
            if not len(nearby):
                continue
            area = foreign.intersection(shapely.union_all([geometries[i] for i in nearby])).area
            if area > 0:
                foreign_overlap.append({"id": props["id"], "area_degrees2": area})
    encoded = _encode_exact_coverage(ids, geometries)
    offset = len(result["arcs"])
    result["arcs"].extend(encoded["arcs"])
    new_rows = encoded["objects"]["political"]["geometries"]
    for row, feature in zip(new_rows, features):
        row["arcs"] = _offset_arcs(row["arcs"], offset)
        row["properties"] = {**feature["properties"], "__source": "detail"}
    result["objects"]["political"]["geometries"] = [
        row for row in rows if row["properties"]["id"] not in selected_ids
    ] + new_rows
    _compact_arcs(result)
    _update_bbox(result)
    if "bbox" in result["objects"]["political"]:
        result["objects"]["political"]["bbox"] = result["bbox"]
    result["political_precision_feature_ids"] = sorted(
        (set(result.get("political_precision_feature_ids", [])) - selected_ids) | set(ids))
    new_owners = {fid: owner for fid, owner in owners.items() if fid not in selected_ids}
    new_cores = {fid: tags for fid, tags in cores.items() if fid not in selected_ids}
    new_owners.update({fid: "US" for fid in ids})
    new_cores.update({fid: ["US"] for fid in ids})
    crosswalk = {}
    for row, old in zip(selected, old_geometries):
        matches = []
        if row["properties"]["id"] in invalid_baseline:
            crosswalk[row["properties"]["id"]] = []
            continue
        for i in sorted(tree.query(old, predicate="intersects")):
            area = old.intersection(geometries[i]).area
            if area > 0:
                matches.append({"id": ids[i], "overlap_area_degrees2": area,
                                "old_area_fraction": area / old.area,
                                "new_area_fraction": area / geometries[i].area})
        crosswalk[row["properties"]["id"]] = matches
    report = {"states": sorted(groups), "baseline_target_count": len(selected),
              "invalid_baseline_unresolved": invalid_baseline,
              "baseline_surface_comparison_complete": not bool(invalid_baseline),
              "baseline_zero_extent_parts": {f["properties"]["id"]: count
                                             for f, (_, count) in zip(selected, baseline_parts) if count},
              "candidate_count": len(ids), "added_ids": sorted(set(ids) - selected_ids),
              "removed_ids": sorted(selected_ids - set(ids)),
              "baseline_coordinates": int(shapely.get_num_coordinates(old_geometries).sum()),
              "candidate_coordinates": int(shapely.get_num_coordinates(geometries).sum()),
              "new_land_degrees2": None if invalid_baseline else new_surface.difference(old_surface).area,
              "removed_land_degrees2": None if invalid_baseline else old_surface.difference(new_surface).area,
              "foreign_overlap": foreign_overlap, "crosswalk": crosswalk,
              "automatic_project_migration": False, "release_ready": False,
              "remaining": ["review changed outer surface and foreign seams",
                            "resolve old project split/merge edits before migration",
                            "adapt historical scenario cut boundaries separately"]}
    return result, new_owners, new_cores, report


def startup_county_lod(candidate):
    """Load identity from runtime metadata and geometry from coarse/detail chunks."""
    result = build_bootstrap_runtime_topology(candidate)
    result["objects"].setdefault("political", {"type": "GeometryCollection", "geometries": []})
    return result, {"county_count": len(candidate.get("political_precision_feature_ids", [])),
                    "startup_political_count": len(result["objects"]["political"]["geometries"]),
                    "startup_arc_count": len(result["arcs"]),
                    "identity_source": "runtime political metadata",
                    "geometry_source": "shared coarse and bounded detail chunks"}


def county_hierarchy_override(source):
    groups, labels = {}, {}
    for feature in source["features"]:
        props = feature["properties"]
        group_id = f"US_{slugify(props['admin1_group'])}"
        groups.setdefault(group_id, []).append(props["id"])
        labels[group_id] = props["admin1_group"]
    return {"country_codes": ["US"], "groups": {key: sorted(ids) for key, ids in groups.items()},
            "labels": labels}


def reviewed_legacy_lineage(payload, baseline_runtime_hash, county_source_hash,
                            old_ids, new_owners, invalid_ids):
    """Accept explicit county membership only for the reviewed input bytes."""
    if payload.get("version") != 1 or payload.get("scenario_id") != "modern_world":
        raise ValueError("Unsupported US legacy lineage review record")
    binding = payload.get("binding") or {}
    entries = payload.get("lineage")
    if not isinstance(entries, list) or len(entries) != 8:
        raise ValueError("US legacy lineage review must contain exactly eight zones")
    seen_sources, seen_targets, crosswalk = set(), set(), {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid US legacy lineage entry")
        source_id, targets = entry.get("source_id"), entry.get("target_ids")
        if (not isinstance(source_id, str) or not ZONE_ID_PATTERN.fullmatch(source_id)
                or source_id in seen_sources
                or not isinstance(targets, list) or not targets):
            raise ValueError(f"Invalid or duplicate US legacy source: {source_id}")
        seen_sources.add(source_id)
        for target_id in targets:
            if (not isinstance(target_id, str) or not COUNTY_ID_PATTERN.fullmatch(target_id)
                    or target_id in seen_targets):
                raise ValueError(f"Invalid, duplicate, or conflicting US legacy target: {target_id}")
            seen_targets.add(target_id)
        crosswalk[source_id] = targets
    if binding.get("baseline_runtime_sha256") != baseline_runtime_hash:
        return {}, "baseline_runtime_sha256_mismatch"
    if binding.get("county_source_sha256") != county_source_hash:
        return {}, "county_source_sha256_mismatch"
    stable_targets = {fid for fid in old_ids if fid in new_owners and fid not in invalid_ids
                      and fid.startswith("US_")}
    for source_id, targets in crosswalk.items():
        if source_id not in old_ids:
            raise ValueError(f"Unknown US legacy source: {source_id}")
        for target_id in targets:
            if target_id in stable_targets or new_owners.get(target_id) != "US":
                raise ValueError(f"Conflicting or non-US legacy target: {target_id}")
    return {source_id: targets for source_id, targets in crosswalk.items()
            if source_id not in invalid_ids}, "applied"


def project_migration_contract(old_ids, new_ids, invalid_ids, source_hash, target_hash,
                               legacy_crosswalk=None):
    """Approve stable identity and separately reviewed, input-bound zone membership.

    Area intersections never authorize assignments. Invalid old polygons remain
    unresolved even when an audit record names them.
    """
    scoped = {fid for fid in old_ids if fid.startswith("US_")}
    unresolved = (scoped - set(new_ids)) | (scoped & set(invalid_ids))
    crosswalk = {fid: [fid] for fid in sorted(scoped - unresolved)}
    for source_id, targets in (legacy_crosswalk or {}).items():
        if source_id in scoped and source_id not in invalid_ids and source_id in unresolved:
            crosswalk[source_id] = targets
            unresolved.remove(source_id)
    return {"version": 1, "scenario_id": "modern_world",
            "source_baseline_hash": source_hash, "target_baseline_hash": target_hash,
            "feature_id_prefixes": ["US_"],
            "crosswalk": dict(sorted(crosswalk.items())),
            "unresolved_ids": sorted(unresolved)}


def _stage_into(baseline_dir: Path, source_path: Path, output_dir: Path, *, build_chunks=True):
    baseline_dir, source_path, output_dir = (
        p.resolve() for p in (baseline_dir, source_path, output_dir))
    runtime_root = (ROOT / ".runtime").resolve()
    if (output_dir.name != "modern_world" or output_dir.exists() or not output_dir.is_relative_to(runtime_root)
            or output_dir == runtime_root or baseline_dir.is_relative_to(output_dir)
            or output_dir.is_relative_to(baseline_dir) or source_path.is_relative_to(output_dir)):
        raise ValueError("Use a new .runtime output directory ending in modern_world, separate from inputs")
    manifest = read(baseline_dir / "manifest.json")
    if manifest.get("scenario_id") != "modern_world":
        raise ValueError("This migration adapter currently supports only modern_world")
    if any((baseline_dir / name).exists() for name in
           ("controllers.by_feature.json", "scenario_mutations.json", "scenario_manual_overrides.json")):
        raise ValueError("Scenario has additional assignments or mutations requiring a reviewed adapter")
    started = time.monotonic()
    source = read(source_path)
    source_report = validate_source_report(source_path, source)
    seam_constraint = source_report.get("seam_constraint")
    if seam_constraint and seam_constraint.get("baseline_runtime_sha256") != digest(baseline_dir / "runtime_topology.topo.json"):
        raise ValueError("Seam-constrained source belongs to a different scenario baseline")
    candidate, owners, cores, report = replace_counties(
        read(baseline_dir / "runtime_topology.topo.json"), source,
        read(baseline_dir / "owners.by_feature.json")["owners"],
        read(baseline_dir / "cores.by_feature.json")["cores"])
    print("County replacement and overlap crosswalk prepared", flush=True)
    rows = candidate["objects"]["political"]["geometries"]
    frame = gpd.GeoDataFrame([dict(row["properties"], geometry=_decode_geometry(candidate, row))
                             for row in rows], crs="EPSG:4326")
    candidate["objects"]["political"]["computed_neighbors"] = compute_neighbor_graph(frame)
    shutil.copytree(baseline_dir, output_dir)
    write_json_atomic(output_dir / "runtime_topology.topo.json", candidate, indent=None, separators=(",", ":"))
    write_json_atomic(output_dir / "owners.by_feature.json", {"owners": owners}, indent=2)
    write_json_atomic(output_dir / "cores.by_feature.json", {"cores": cores}, indent=2)
    countries = read(output_dir / "countries.json")
    countries["countries"]["US"]["feature_count"] = sum(owner == "US" for owner in owners.values())
    write_json_atomic(output_dir / "countries.json", countries, indent=2)
    # Capital/city references must remain valid; do not silently rehost a city.
    def host_ids(value):
        if isinstance(value, dict):
            if value.get("host_feature_id"):
                yield value["host_feature_id"]
            for item in value.values():
                yield from host_ids(item)
        elif isinstance(value, list):
            for item in value:
                yield from host_ids(item)
    removed = set(report["removed_ids"])
    for name in ("capital_hints.json", "city_overrides.json"):
        broken = removed.intersection(host_ids(read(output_dir / name)))
        if broken:
            raise ValueError(f"City hosts require explicit migration: {name}: {sorted(broken)}")
    manifest["summary"]["feature_count"] = len(rows)
    old_baseline_hash = manifest["baseline_hash"]
    manifest["baseline_hash"] = stable_json_hash(owners)
    old_ids = set(read(baseline_dir / "owners.by_feature.json")["owners"])
    legacy_crosswalk, lineage_status = reviewed_legacy_lineage(
        read(LEGACY_LINEAGE_PATH), digest(baseline_dir / "runtime_topology.topo.json"),
        digest(source_path), old_ids, owners, report["invalid_baseline_unresolved"])
    manifest["project_feature_migration"] = project_migration_contract(
        old_ids, owners, report["invalid_baseline_unresolved"],
        old_baseline_hash, manifest["baseline_hash"], legacy_crosswalk)
    report["project_migration"] = {
        "stable_identity_count": len(manifest["project_feature_migration"]["crosswalk"]) - len(legacy_crosswalk),
        "reviewed_legacy_count": len(legacy_crosswalk),
        "reviewed_legacy_target_count": sum(len(targets) for targets in legacy_crosswalk.values()),
        "reviewed_legacy_status": lineage_status,
        "unresolved_ids": manifest["project_feature_migration"]["unresolved_ids"],
        "source_baseline_hash": old_baseline_hash, "target_baseline_hash": manifest["baseline_hash"],
        "policy": "stable_identity_plus_input_bound_reviewed_lineage; ambiguous or invalid edited IDs reject import"}
    manifest["source"]["us_county_source_sha256"] = digest(source_path)
    # Include untouched US states too: a partial source must not erase their
    # existing memberships when replacing the country's hierarchy overlay.
    full_us_features = [{"properties": row["properties"]} for row in rows
                        if row["properties"].get("cntr_code") == "US"]
    manifest["hierarchy_overrides"] = county_hierarchy_override({"features": full_us_features})
    write_json_atomic(output_dir / "manifest.json", manifest, indent=2)
    if build_chunks:
        print("Build county detail shards and shared coarse LOD", flush=True)
        startup, report["startup_lod"] = startup_county_lod(candidate)
        startup_url = "data/scenarios/modern_world/runtime_topology.bootstrap.topo.json"
        write_json_atomic(output_dir / "runtime_topology.bootstrap.topo.json", startup,
                          indent=None, separators=(",", ":"))
        manifest["runtime_bootstrap_topology_url"] = startup_url
        build_and_write_scenario_chunk_assets(
            scenario_dir=output_dir, manifest_payload=manifest,
            runtime_topology_payload=candidate, startup_topology_payload=startup,
            startup_topology_url=startup_url,
            runtime_topology_url=manifest["runtime_topology_url"])
        # Chunked startup requests these resources even for modern-world.
        # Retain existing translations for every runtime ID/name; new county
        # names fall back to the source properties until explicitly translated.
        whitelist = {"locale_keys": [str(value) for row in rows for key, value in row["properties"].items()
                                      if key in {"id", "name"} and value]}
        locales = build_startup_locales_payload(
            read(ROOT / "data/locales.json"), read(ROOT / "data/europe_topology.json"),
            startup, {}, startup_support_whitelist=whitelist)
        aliases = build_startup_geo_aliases_payload(read(ROOT / "data/geo_aliases.json"), locales)
        for name, payload in (("locales.startup.json", locales), ("geo_aliases.startup.json", aliases)):
            write_json_atomic(output_dir / name, payload, indent=None, separators=(",", ":"))
        write_json_atomic(output_dir / "manifest.json", manifest, indent=2)
    finalize_stage(output_dir)
    report.update({"scenario_id": "modern_world", "source_sha256": digest(source_path),
                   "baseline_runtime_sha256": digest(baseline_dir / "runtime_topology.topo.json"),
                   "candidate_runtime_sha256": digest(output_dir / "runtime_topology.topo.json"),
                   "elapsed_seconds": time.monotonic() - started,
                   "peak_working_set_bytes": peak_memory(), "chunks_built": build_chunks})
    if build_chunks:
        chunk_manifest = read(output_dir / "detail_chunks.manifest.json")
        us_chunks = [c for c in chunk_manifest["chunks"]
                     if c.get("lod") == "detail" and c.get("country_codes") == ["US"]]
        report["us_detail_chunks"] = [{k: c.get(k) for k in
            ("id", "feature_count", "coord_count", "byte_size", "bounds")} for c in us_chunks]
        report["us_detail_gzip_bytes"] = sum(len(gzip.compress(
            (output_dir / "chunks" / Path(c["url"]).name).read_bytes(), mtime=0)) for c in us_chunks)
    write_json_atomic(output_dir / "us_county_migration.report.json", report, indent=2)
    return report


def stage(baseline_dir: Path, source_path: Path, output_dir: Path, *, build_chunks=True):
    """Publish a candidate directory only after all build steps succeed."""
    output_dir = output_dir.resolve()
    runtime_root = (ROOT / ".runtime").resolve()
    if output_dir.name != "modern_world" or output_dir.exists() or not output_dir.is_relative_to(runtime_root):
        raise ValueError("Use a new .runtime output directory ending in modern_world")
    if source_path.resolve().is_relative_to(output_dir) or baseline_dir.resolve().is_relative_to(output_dir):
        raise ValueError("Output must be separate from inputs")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".county-build-", dir=output_dir.parent) as temporary:
        staged_dir = Path(temporary) / "modern_world"
        report = _stage_into(baseline_dir, source_path, staged_dir, build_chunks=build_chunks)
        staged_dir.rename(output_dir)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, default=ROOT / "data/scenarios/modern_world")
    parser.add_argument("--county-source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--no-chunks", action="store_true")
    args = parser.parse_args()
    result = stage(args.baseline_dir, args.county_source, args.output_dir, build_chunks=not args.no_chunks)
    print(json.dumps({k: v for k, v in result.items() if k not in {"crosswalk", "added_ids", "removed_ids"}}, indent=2))
