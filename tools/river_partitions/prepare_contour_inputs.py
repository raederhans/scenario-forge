"""Prepare full interactive land and independent Shapely seam lengths for JS acceptance.

Run from the repository root. Reuses the generator's TopoJSON decoder; does not
cut, repair, snap or alter any source/pack geometry. Lengths are planar degrees.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

from shapely.geometry import shape
from shapely.ops import unary_union

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.build_river_partitions import decode_features, feature_id


def digest(path):
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def interactive_features(document, object_name="political"):
    decoded = decode_features(document, object_name)
    features = []
    ids = set()
    for feature in decoded:
        fid = feature_id(feature)
        props = feature.get("properties", {})
        if props.get("interactive") is False or props.get("render_as_base_geography") is True or "_FB_" in fid:
            continue
        if not fid or fid in ids:
            raise ValueError(f"Missing/duplicate interactive source ID: {fid!r}")
        if feature.get("geometry", {}).get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"Interactive source {fid}: expected polygon")
        ids.add(fid)
        features.append({**feature, "id": fid})
    if not features:
        raise ValueError("Empty interactive land scope")
    return features, len(decoded)


def seam_expectations(pack, source):
    source_by_id = {feature["id"]: feature for feature in source}
    expected = {}
    used = set()
    for entry in [*pack["parents"], *pack.get("support", [])]:
        fid = entry["parentId"]
        if fid in used or fid not in source_by_id:
            raise ValueError(f"Missing/duplicate pack source parent: {fid}")
        used.add(fid)
        if entry["parentGeometry"] != source_by_id[fid]["geometry"]:
            raise ValueError(f"Source parent geometry changed: {fid}")
        parent = shape(entry["parentGeometry"])
        if parent.is_empty or not parent.is_valid:
            raise ValueError(f"Invalid pack parent geometry: {fid}")
        if "cells" not in entry:
            support = shape(entry["geometry"])
            # Joint noding adds points on existing edges; binary roundoff can
            # make GEOS equals() false despite unchanged boundary coverage.
            if not support.is_valid or support.symmetric_difference(parent).area > max(1e-12, parent.area * 1e-9):
                raise ValueError(f"Support changes source coverage: {fid}")
            continue
        cells = [shape(cell["geometry"]) for cell in entry["cells"]]
        if len(cells) < 2 or any(cell.is_empty or not cell.is_valid for cell in cells):
            raise ValueError(f"Invalid partition cells: {fid}")
        union = unary_union(cells)
        tolerance = max(1e-12, parent.area * 1e-9)
        if (union.symmetric_difference(parent).area > tolerance
                or abs(sum(cell.area for cell in cells) - union.area) > tolerance):
            raise ValueError(f"Partition coverage/overlap changed: {fid}")
        expected[fid] = (sum(cell.boundary.length for cell in cells) - parent.boundary.length) / 2
    return expected


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--land", required=True, type=Path)
    parser.add_argument("--land-object", default="political")
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if not args.output.resolve().is_relative_to((Path.cwd() / ".runtime").resolve()):
            raise ValueError("Output must stay under this checkout's .runtime/")
        if args.output.resolve() in {p.resolve() for p in (args.land, args.baseline, args.candidate)}:
            raise ValueError("Output must not overwrite input")
        source, decoded_count = interactive_features(read(args.land), args.land_object)
        baseline, candidate = read(args.baseline), read(args.candidate)
        land_digest = digest(args.land)
        for label, pack in (("baseline", baseline), ("candidate", candidate)):
            if pack.get("source", {}).get("landDigest") != land_digest:
                raise ValueError(f"{label}: source landDigest does not match --land")
        if baseline["sceneId"] != candidate["sceneId"]:
            raise ValueError("Baseline/candidate scene IDs differ")
        result = {"schemaVersion": 1, "scope": {
            "sceneId": candidate["sceneId"], "landObject": args.land_object,
            "decodedSourceCount": decoded_count, "interactiveSourceCount": len(source),
            "filter": "interactive != false; render_as_base_geography != true; ID excludes _FB_",
            "units": "planar coordinate degrees; not metres or real-world river coverage",
        }, "digests": {"land": land_digest, "baseline": digest(args.baseline), "candidate": digest(args.candidate)},
            "sourceFeatures": source,
            "baselineSeams": seam_expectations(baseline, source),
            "candidateSeams": seam_expectations(candidate, source)}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"output": args.output.as_posix(), **result["scope"]}))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(2, f"Contour input error: {exc}\n")


if __name__ == "__main__":
    sys.exit(main())
