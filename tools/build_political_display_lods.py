"""Build a staged world/regional/detail display overlay, never rewrite source data.

Usage: python tools/build_political_display_lods.py --source-root . \
  --scenario-id tno_1962 --output-root .runtime/reports/generated/display-lod

The output is a candidate overlay, not a publication command. Shared-boundary
checks here do not replace scenario-specific constraints, catalog regeneration,
project identity binding or the canonical Pages release gate.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import gzip
import hashlib
import json
import math
from pathlib import Path
import re

from shapely import coverage_invalid_edges, coverage_is_valid, coverage_simplify, orient_polygons
from shapely.geometry import shape, mapping
from shapely.ops import unary_union


def feature_id(feature):
    value = str((feature.get("properties") or {}).get("id") or feature.get("id") or "").strip()
    if not value:
        raise ValueError("Display geometry requires a stable feature ID")
    return value


def coordinate_count(value):
    if isinstance(value, (list, tuple)):
        if value and isinstance(value[0], (int, float)):
            return 1
        return sum(coordinate_count(item) for item in value)
    if isinstance(value, dict):
        return coordinate_count(value.get("coordinates", [])) + sum(coordinate_count(g) for g in value.get("geometries", []))
    return 0


def topology_shape(geom):
    parts = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    return len(parts), sorted(len(part.interiors) for part in parts)


def simplify_coverage_features(features, tolerance, protected_ids=()):
    """Simplify shared interiors only; retain the exact perimeter and hole counts.

    Invalid/overlapping inputs, topology changes or excessive error fall back to
    the original features. Fallback is reported, never repaired or hidden.
    """
    if not math.isfinite(tolerance) or tolerance < 0:
        raise ValueError("tolerance must be finite and nonnegative")
    ids = [feature_id(feature) for feature in features]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate feature IDs in an LOD shard")
    before = sum(coordinate_count(f.get("geometry")) for f in features)
    report = {"input_points": before, "output_points": before, "max_deviation_degrees": 0.0,
              "status": "unchanged", "reason": "no-eligible-interior"}
    protected = set(protected_ids)
    indexes = [i for i, f in enumerate(features) if ids[i] not in protected
               and (f.get("geometry") or {}).get("type") in ("Polygon", "MultiPolygon")]
    if not indexes or tolerance == 0:
        return features, report
    geometry_by_index = {i: shape(features[i]["geometry"]) for i in indexes}
    invalid_ids = {i for i, g in geometry_by_index.items() if g.is_empty or not g.is_valid}
    dateline_ids = {i for i, g in geometry_by_index.items() if i not in invalid_ids and g.bounds[2] - g.bounds[0] > 180}
    indexes = [i for i in indexes if i not in invalid_ids | dateline_ids]
    # Preserve problematic features verbatim. Their neighbours' exposed edges
    # become the boundary of the remaining subcoverage and cannot simplify.
    # This does not repair inputs or relax coverage validity or error limits.
    if indexes:
        edges = coverage_invalid_edges([geometry_by_index[i] for i in indexes])
        invalid_ids.update(i for i, edge in zip(indexes, edges) if not edge.is_empty)
        indexes = [i for i in indexes if i not in invalid_ids]
    report["retained_exact_ids"] = [ids[i] for i in sorted(invalid_ids | dateline_ids)]
    if not indexes:
        reason = "invalid-source-coverage" if invalid_ids else "dateline-needs-spherical-review"
        return features, {**report, "status": "fallback", "reason": reason}
    originals = [geometry_by_index[i] for i in indexes]
    if not coverage_is_valid(originals):
        return features, {**report, "status": "fallback", "reason": "invalid-source-coverage"}
    source_union = unary_union(originals)
    # GEOS' area-based tolerance is not a Hausdorff bound. Tighten its input
    # tolerance when necessary; never raise the requested output error bound.
    simplified, deviation = originals, 0.0
    for attempt in range(6):
        candidate = list(coverage_simplify(originals, tolerance / (2 ** attempt), simplify_boundary=False))
        if (any(g.is_empty or not g.is_valid for g in candidate)
                or not coverage_is_valid(candidate)
                or not source_union.equals(unary_union(candidate))
                or any(topology_shape(a) != topology_shape(b) for a, b in zip(originals, candidate))):
            continue
        measured = max((a.hausdorff_distance(b) for a, b in zip(originals, candidate)), default=0.0)
        if math.isfinite(measured) and measured <= tolerance:
            simplified, deviation = candidate, measured
            break
    else:
        return features, {**report, "status": "fallback", "reason": "deviation-or-topology-limit"}
    result = list(features)
    for index, original, geom in zip(indexes, originals, simplified):
        if geom.equals_exact(original, 0):
            continue
        replacement = {**features[index], "geometry": mapping(orient_polygons(geom, exterior_cw=True))}
        if "bbox" in replacement:
            replacement["bbox"] = list(geom.bounds)
        result[index] = replacement
    after = sum(coordinate_count(f.get("geometry")) for f in result)
    if after >= before:
        return features, {**report, "reason": "no-point-reduction"}
    return result, {**report, "output_points": after, "max_deviation_degrees": deviation,
                    "status": "simplified", "reason": "shared-interiors-only"}


def load_json(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == ".gz" else raw)


def source_path(root, url):
    path = (root / url).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Asset path escapes source root")
    return path


def write_json(path, value):
    raw = (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(raw)
    temp.replace(path)
    return raw


def describe_chunk(template, features, url, raw):
    bounds = [list(shape(f["geometry"]).bounds) for f in features]
    if any(len(bound) != 4 or not all(map(math.isfinite, bound)) for bound in bounds):
        raise ValueError("Invalid feature bounds in candidate chunk")
    points = sum(coordinate_count(f["geometry"]) for f in features)
    # Source LOD diagnostics describe different bytes and must not be inherited.
    template = {key: value for key, value in template.items() if key != "lod_diagnostics"}
    parts = sum(topology_shape(shape(f["geometry"]))[0] for f in features)
    return {**template, "url": url, "sha256": hashlib.sha256(raw).hexdigest(),
            "byte_size": len(raw), "decoded_byte_size": len(raw), "cache_byte_size": len(raw),
            "feature_count": len(features), "coord_count": points,
            "part_count": parts, "estimated_path_cost": points + parts * 8 + len(features) * 3,
            "feature_bounds": bounds, "data_format": "geojson"}


def build_overlay(source_root, scenario_id, output_root, *, chunk_ids=(), protected_ids=(), world_tolerance=0.02, regional_tolerance=0.005):
    source_root, output_root = Path(source_root).resolve(), Path(output_root).resolve()
    if not re.fullmatch(r"[a-z0-9_-]+", scenario_id):
        raise ValueError("Invalid scenario ID")
    if output_root == source_root or source_root.is_relative_to(output_root):
        raise ValueError("Output must be a separate staging directory")
    prefix = Path("data/scenarios") / scenario_id
    manifest_path = source_path(source_root, prefix / "detail_chunks.manifest.json")
    context_path = source_path(source_root, prefix / "context_lod.manifest.json")
    manifest, context = load_json(manifest_path), load_json(context_path)
    original_manifest = deepcopy(manifest)
    coarse = [c for c in manifest["chunks"] if c["layer"] == "political" and c["lod"] == "coarse" and c.get("global_coverage")]
    if len(coarse) != 1:
        raise ValueError("Pilot requires exactly one complete political coarse base")
    base_meta = coarse[0]
    base_payload = load_json(source_path(source_root, base_meta["url"]))
    base_features = base_payload["features"]
    by_id = {feature_id(f): i for i, f in enumerate(base_features)}
    if len(by_id) != len(base_features):
        raise ValueError("Duplicate base IDs")
    selected_ids = set(chunk_ids)
    all_details = [c for c in manifest["chunks"] if c["layer"] == "political" and c["lod"] == "detail"]
    if selected_ids - {c["id"] for c in all_details}:
        raise ValueError("Unknown requested detail chunk")
    details = [c for c in all_details if not selected_ids or c["id"] in selected_ids]
    seen, reports, variants = set(), [], []
    new_base = list(base_features)
    for detail in details:
        payload = load_json(source_path(source_root, detail["url"]))
        features = payload["features"]
        ids = [feature_id(f) for f in features]
        if len(ids) != len(set(ids)) or seen.intersection(ids):
            raise ValueError("Overlapping shard membership requires explicit regrouping")
        seen.update(ids)
        regional, regional_report = simplify_coverage_features(features, regional_tolerance, protected_ids)
        world_report = {"status": "unchanged", "reason": "not-in-base"}
        if all(fid in by_id for fid in ids):
            members = [base_features[by_id[fid]] for fid in ids]
            world, world_report = simplify_coverage_features(members, world_tolerance, protected_ids)
            for fid, feature in zip(ids, world):
                new_base[by_id[fid]] = feature
        reports.append({"chunk_id": detail["id"], "world": world_report, "regional": regional_report})
        if regional_report["status"] != "simplified":
            continue
        regional_id = detail["id"].replace("political.detail.", "political.regional.", 1)
        url = (prefix / "chunks" / (regional_id + ".json")).as_posix()
        raw = write_json(output_root / url, {**payload, "features": regional})
        variant = describe_chunk(detail, regional, url, raw)
        variant.update(id=regional_id, lod="regional", lod_group_id=detail["id"],
                       min_zoom=detail.get("min_zoom", 1.35), max_zoom=4.5)
        # Same family IDs and original detail bytes. Overlap is intentional.
        detail.update(lod_group_id=detail["id"], min_zoom=4.0)
        variants.append(variant)
    manifest["chunks"].extend(variants)
    if any(a is not b for a, b in zip(new_base, base_features)):
        url = (prefix / "chunks" / "political.coarse.world.json").as_posix()
        raw = write_json(output_root / url, {**base_payload, "features": new_base})
        updated = describe_chunk(base_meta, new_base, url, raw)
        base_meta.clear(); base_meta.update(updated)
    groups = {}
    for chunk in manifest["chunks"]:
        if chunk["layer"] != "political":
            continue
        key = (chunk["lod"], chunk["min_zoom"], chunk["max_zoom"])
        groups.setdefault(key, []).append(chunk["id"])
    context.setdefault("layers", {})["political"] = [
        {"lod": lod, "min_zoom": lo, "max_zoom": hi, "chunk_ids": ids}
        for (lod, lo, hi), ids in groups.items()]
    report = {"scenario_id": scenario_id, "status": "staged-not-published",
              "source_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
              "processed_shards": len(details), "regional_variants": len(variants), "protected_ids": sorted(set(protected_ids)),
              "world_points_before": sum(coordinate_count(f["geometry"]) for f in base_features),
              "world_points_after": sum(coordinate_count(f["geometry"]) for f in new_base),
              "world_tolerance_degrees": world_tolerance, "regional_tolerance_degrees": regional_tolerance,
              "groups": reports}
    # Manifests are written last. Existing source manifests and detail geometry
    # are neither overwritten nor copied into a second editable authority.
    write_json(output_root / prefix / "detail_chunks.manifest.json", manifest)
    write_json(output_root / prefix / "context_lod.manifest.json", context)
    write_json(output_root / "display-lod-report.json", report)
    assert load_json(manifest_path) == original_manifest
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path("."))
    parser.add_argument("--scenario-id", required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--chunk-id", action="append", default=[])
    parser.add_argument("--protected-ids", type=Path)
    args = parser.parse_args()
    protected = load_json(args.protected_ids) if args.protected_ids else []
    if not isinstance(protected, list) or not all(isinstance(x, str) for x in protected):
        raise ValueError("Protected IDs must be a JSON string array")
    result = build_overlay(args.source_root, args.scenario_id, args.output_root,
                           chunk_ids=args.chunk_id, protected_ids=protected)
    print(json.dumps({k: v for k, v in result.items() if k != "groups"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
