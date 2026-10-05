"""Review triage for uncovered river parents; never edits source or approves packs.

Cached broad packs must have the current land/river byte identities. The secondary
cut share counts only faces inside an actually subdivided original component, so
an unrelated original island cannot masquerade as a second river bank. All areas
and lengths are in source planar degrees, not geodesic measurements.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

from shapely.geometry import LineString, shape
from shapely.ops import unary_union

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools import build_river_partitions as default_generator


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def secondary_cut_share(parent, cells):
    """Sum secondary faces of cut components, retaining every positive face."""
    components = [parent] if parent.geom_type == "Polygon" else list(parent.geoms)
    secondary = 0.0
    for component in components:
        # Entire-face intersection avoids assuming the interior point of a tiny
        # positive face is representable. Uncut islands contribute exactly zero.
        areas = [cell.intersection(component).area for cell in cells]
        areas = [area for area in areas if area > 0]
        if len(areas) > 1:
            secondary += sum(areas) - max(areas)
    return secondary / parent.area


def audit_entry(entry, feature, lines, generator):
    parent = shape(entry["parentGeometry"])
    cells = [shape(cell["geometry"]) for cell in entry["cells"]]
    combined = unary_union(cells)
    area_tolerance = max(1e-14, parent.area * 1e-12)
    overlap = sum(cell.intersection(other).area for i, cell in enumerate(cells) for other in cells[:i])
    seams = unary_union([cell.boundary for cell in cells]).difference(parent.boundary.buffer(1e-9))
    source = unary_union(lines)
    off_source = seams.difference(source.buffer(1e-9)).length
    reversed_entry, build_audit = generator.partition_parent(
        feature, [LineString(list(line.coords)[::-1]) for line in reversed(lines)])
    coverage = parent.symmetric_difference(combined).area
    hausdorff = parent.hausdorff_distance(combined)
    stable = reversed_entry is not None and [c["id"] for c in reversed_entry["cells"]] == [c["id"] for c in entry["cells"]]
    fingerprints = generator.geometry_fingerprint(entry["parentGeometry"]) == entry["parentFingerprint"] and all(
        generator.geometry_fingerprint(cell["geometry"]) == cell["geometryFingerprint"] for cell in entry["cells"])
    positive_valid = parent.is_valid and all(cell.is_valid and cell.area > 0 for cell in cells)
    passed = positive_valid and fingerprints and stable and coverage <= area_tolerance and overlap <= area_tolerance and hausdorff <= 1e-9 and off_source <= 1e-9
    return {
        "passed": passed, "allPositiveFacesValid": positive_valid,
        "fingerprintsMatch": fingerprints, "stableIdsUnderReverseLines": stable,
        "coverageDegrees2": coverage, "overlapDegrees2": overlap,
        "hausdorffDegrees": hausdorff, "offSourceSeamLengthDegrees": off_source,
        "interiorDanglingLineLengthDegrees": build_audit.get("interiorDanglingLineLength", 0),
        "secondaryCutFaceShare": secondary_cut_share(parent, cells),
        "minimumCellShare": min(cell.area for cell in cells) / parent.area,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--land", type=Path, required=True)
    parser.add_argument("--rivers", type=Path, required=True)
    parser.add_argument("--approved", type=Path, required=True)
    parser.add_argument("--pack", type=Path, action="append", required=True)
    parser.add_argument("--generator", type=Path, help="Optional immutable generator snapshot")
    parser.add_argument("--min-secondary-share", type=float, default=.03)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if not 0 < args.min_secondary_share <= .5:
        parser.error("--min-secondary-share must be in (0, 0.5]")
    protected = [args.land, args.rivers, args.approved, *args.pack]
    if args.generator:
        protected.append(args.generator)
    if args.output.resolve() in [path.resolve() for path in protected]:
        parser.error("Output must not overwrite an input")
    generator = default_generator
    if args.generator:
        spec = importlib.util.spec_from_file_location("coverage_generator_snapshot", args.generator)
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
    identity = {"landDigest": digest(args.land), "riverDigest": digest(args.rivers)}
    approved = read(args.approved)
    if any(approved["source"][key] != value for key, value in identity.items()):
        raise ValueError("Approved source identity differs from current inputs")
    old_ids = {p["parentId"] for p in approved["parents"]}
    features = {generator.feature_id(f): f for f in generator.decode_features(read(args.land))}
    river_features = generator.decode_features(read(args.rivers), "rivers")
    records = {}
    for pack_path in args.pack:
        pack = read(pack_path)
        if (pack.get("kind") != "river-paint-partitions" or pack.get("schemaVersion") != 1
                or pack.get("algorithmVersion") != approved.get("algorithmVersion")
                or pack["sceneId"] != approved["sceneId"]
                or pack["source"]["includeLakeCenterlines"] != approved["source"]["includeLakeCenterlines"]
                or any(pack["source"][key] != value for key, value in identity.items())):
            raise ValueError(f"Cached pack source differs: {pack_path}")
        names = pack["source"]["riverNames"]
        by_river = {name: generator.select_rivers(river_features, [name], pack["source"]["includeLakeCenterlines"]) for name in names}
        lines = [line for value in by_river.values() for line in value]
        for entry in pack["parents"]:
            pid = entry["parentId"]
            if pid in old_ids:
                continue
            feature = features[pid]
            geometry = shape(entry["parentGeometry"])
            exact_source = json.dumps(generator.d3_geometry(shape(feature["geometry"])), sort_keys=True, separators=(",", ":"))
            exact_cached = json.dumps(entry["parentGeometry"], sort_keys=True, separators=(",", ":"))
            if exact_source != exact_cached or generator.geometry_fingerprint(feature["geometry"]) != entry["parentFingerprint"]:
                raise ValueError(f"Cached parent differs from source: {pid}")
            checks = audit_entry(entry, feature, lines, generator)
            # Attribution requires a nonzero interior source segment, not country.
            interior = geometry.buffer(-1e-9)
            rivers = [name for name, river_lines in by_river.items() if unary_union(river_lines).intersection(interior).length > 1e-9]
            if not rivers:
                raise ValueError(f"Cached parent has no selected interior river segment: {pid}")
            props = feature.get("properties", {})
            reason = "substantial_component_crossing"
            if not checks["passed"]:
                status, reason = "held", "geometry_or_identity_check_failed"
            elif checks["interiorDanglingLineLengthDegrees"] > 1e-9:
                status, reason = "held", "interior_source_dangle"
            elif checks["secondaryCutFaceShare"] < args.min_secondary_share:
                status, reason = "deferred", "secondary_cut_share_below_review_threshold"
            else:
                status = "proposed_for_visual_review"
            record = {"parentId": pid, "name": props.get("name", pid),
                      "country": props.get("cntr_code", props.get("country_code", pid.split('_')[0][:2])),
                      "rivers": rivers, "cells": len(entry["cells"]),
                      "bounds": list(geometry.bounds), "centroid": [geometry.centroid.x, geometry.centroid.y],
                      "status": status, "reason": reason, "checks": checks,
                      "evidencePack": str(pack_path)}
            if pid in records:
                raise ValueError(f"Uncovered parent occurs in multiple packs: {pid}; jointly rebuild first")
            records[pid] = record
    ordered = sorted(records.values(), key=lambda record: (record["rivers"], record["centroid"][1], record["centroid"][0], record["parentId"]))
    result = {"schemaVersion": 1, "sceneId": approved["sceneId"], "source": identity,
              "approvedPackId": approved["packId"], "approvedParentCount": len(old_ids),
              "generatorDigest": digest(args.generator or Path(default_generator.__file__)),
              "reviewThresholdSecondaryCutFaceShare": args.min_secondary_share,
              "summary": dict(Counter(record["status"] for record in ordered)), "records": ordered}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"]))


if __name__ == "__main__":
    main()
