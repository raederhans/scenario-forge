"""Inventory pinned Russian ADM2 lineage and prepare a shared, moderate-detail source."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import LineString, mapping, shape

from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from map_builder.io.writers import write_json_atomic

SPLIT = re.compile(r"__tno1962_\d+$")


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def parent_id(feature_id):
    return SPLIT.sub("", feature_id)


def indexed_hausdorff(left, right):
    """GEOS discrete boundary Hausdorff with indexed line chunks for large inputs."""
    def directed(source, target):
        chunks = []
        for polygon in shapely.get_parts(target):
            for ring in (polygon.exterior, *polygon.interiors):
                coordinates = np.asarray(ring.coords)
                chunks.extend(LineString(coordinates[i:i+65]) for i in range(0, len(coordinates)-1, 64))
        tree = shapely.STRtree(chunks)
        points = shapely.points(shapely.get_coordinates(source))
        _, distances = tree.query_nearest(points, all_matches=False, return_distance=True)
        return float(max(distances))
    return max(directed(left, right), directed(right, left))


def safe_output(directory, inputs=()):
    directory = Path(directory).resolve()
    if directory.exists() or any(directory.is_relative_to(ROOT / name) for name in ("data", "dist")):
        raise ValueError("Use a new output directory outside data/dist")
    if any(Path(p).resolve().is_relative_to(directory) or directory.is_relative_to(Path(p).resolve()) for p in inputs):
        raise ValueError("Output must not contain or be inside an input")
    return directory


def build_inventory(baseline_dir, source_path):
    baseline_dir, source_path = Path(baseline_dir), Path(source_path)
    topology = _absolute_topology(read(baseline_dir / "runtime_topology.topo.json"))
    features = topology["objects"]["political"]["geometries"]
    owners = read(baseline_dir / "owners.by_feature.json")["owners"]
    cores = read(baseline_dir / "cores.by_feature.json")["cores"]
    controller_path = baseline_dir / "controllers.by_feature.json"
    controllers = read(controller_path)["controllers"] if controller_path.exists() else owners
    source = read(source_path)
    raw = {}
    for feature in source["features"]:
        props = feature["properties"]
        fid = "RU_RAY_" + str(props["shapeID"])
        if fid in raw:
            raise ValueError(f"Duplicate source ID: {fid}")
        raw[fid] = feature
    records, used, counts = [], set(), Counter()
    for feature in features:
        props = feature["properties"]
        fid = props["id"]
        if not fid.startswith(("RU_RAY_", "RU_CITY_", "RU_ARCTIC_FB_")):
            continue
        kind = "adm2" if fid.startswith("RU_RAY_") else "city" if fid.startswith("RU_CITY_") else "shell"
        parent = parent_id(fid) if kind == "adm2" else None
        if parent and parent not in raw:
            raise ValueError(f"Unresolved parent: {fid}")
        if kind != "shell" and fid not in owners:
            raise ValueError(f"Missing owner: {fid}")
        geometry = _decode_geometry(topology, feature)
        if geometry is None or geometry.is_empty or not geometry.is_valid:
            raise ValueError(f"Invalid baseline geometry: {fid}")
        if parent:
            used.add(parent)
        counts[kind] += 1
        records.append({"id": fid, "source_parent_id": parent, "kind": kind,
                        "split": parent is not None and parent != fid,
                        "cntr_code": props.get("cntr_code"), "owner": owners.get(fid),
                        "controller": controllers.get(fid), "cores": cores.get(fid),
                        "properties": props, "coordinates": int(shapely.get_num_coordinates(geometry)),
                        "bounds": list(geometry.bounds), "representative_point": list(geometry.representative_point().coords[0])})
    excluded = [{"id": fid, "properties": raw[fid]["properties"], "bounds": list(shape(raw[fid]["geometry"]).bounds),
                 "decision": "retain_baseline_exclusion; not automatically added"}
                for fid in sorted(set(raw) - used)]
    return {"version": 1, "scenario_id": "tno_1962", "records": records, "excluded_source_features": excluded,
            "counts": dict(counts), "source_features": len(raw), "used_source_parents": len(used),
            "non_ru_labeled_adm2": sum(r["kind"] == "adm2" and r["cntr_code"] != "RU" for r in records),
            "split_children": sum(r["split"] for r in records),
            "split_parents": sorted({r["source_parent_id"] for r in records if r["split"]}),
            "source_sha256": digest(source_path), "baseline_runtime_sha256": digest(baseline_dir / "runtime_topology.topo.json")}, raw


def prepare(baseline_dir, source_path, output_dir, *, tolerance_m=500.0, max_deviation_m=1000.0):
    if not 0 < tolerance_m <= 2000:
        raise ValueError("Explicit shared simplification must be in (0, 2000] meters")
    output = safe_output(output_dir, [baseline_dir, source_path])
    inventory, raw = build_inventory(baseline_dir, source_path)
    ids = sorted(raw)
    geometries = [shape(raw[fid]["geometry"]) for fid in ids]
    if any(g.is_empty or not g.is_valid for g in geometries) or not shapely.coverage_is_valid(geometries):
        raise ValueError("Pinned ADM2 is not a valid coverage")
    source_frame = gpd.GeoDataFrame({"id": ids}, geometry=geometries, crs=4326)
    metric = source_frame.to_crs(6933)
    if not shapely.coverage_is_valid(metric.geometry.tolist()):
        raise ValueError("Projected source is not a valid coverage")
    if not 0 < max_deviation_m <= 2000:
        raise ValueError("Source maximum measured deviation must be in (0, 2000] meters")
    attempts = []
    effective_tolerance = tolerance_m
    for _ in range(6):
        simplified = shapely.coverage_simplify(metric.geometry.values, effective_tolerance, simplify_boundary=True)
        if any(g.is_empty or not g.is_valid for g in simplified) or not shapely.coverage_is_valid(simplified):
            raise ValueError("Shared simplification invalidated source")
        displacements = [indexed_hausdorff(a, b) for a, b in zip(metric.geometry, simplified)]
        measured = float(max(displacements))
        attempts.append({"tolerance_m": effective_tolerance, "max_hausdorff_m": measured,
                         "coordinates": int(shapely.get_num_coordinates(simplified).sum())})
        print(json.dumps(attempts[-1]), flush=True)
        if measured <= max_deviation_m:
            break
        effective_tolerance /= 4
    else:
        raise ValueError("Source simplification exceeded the measured deviation budget")
    metric["geometry"] = simplified
    result = metric.to_crs(4326)
    if not shapely.coverage_is_valid(result.geometry.tolist()):
        raise ValueError("Reprojected source is not a valid coverage")
    report = {"source_sha256": inventory["source_sha256"], "metric_crs": "EPSG:6933", "tolerance_m": effective_tolerance,
              "requested_tolerance_m": tolerance_m, "max_deviation_m": max_deviation_m, "attempts": attempts,
              "method": "joint coverage_simplify; baseline owner/pilot borders constrained by candidate stage",
              "raw_coordinates": int(shapely.get_num_coordinates(geometries).sum()),
              "simplified_coordinates": int(shapely.get_num_coordinates(result.geometry.values).sum()),
              "max_hausdorff_m": float(max(displacements)), "source_coverage_valid": True,
              "largest_displacements": sorted([{"id": fid, "hausdorff_m": float(d)} for fid, d in zip(ids, displacements)],
                                              key=lambda r: r["hausdorff_m"], reverse=True)[:10]}
    # Commit outputs only after all preparation checks pass.
    output.mkdir(parents=True)
    write_json_atomic(output / "inventory.json", inventory, indent=2)
    write_json_atomic(output / "source.report.json", report, indent=2)
    write_json_atomic(output / "source.geojson", {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": fid, "source_country": "RU"}, "geometry": mapping(g)}
        for fid, g in zip(ids, result.geometry)]}, indent=None, separators=(",", ":"))
    write_json_atomic(output / "baseline-files.json", {str(p.relative_to(baseline_dir)).replace("\\", "/"): digest(p)
                                                      for p in sorted(Path(baseline_dir).rglob("*")) if p.is_file()}, indent=2)
    return {**report, **{k: v for k, v in inventory.items() if k not in {"records", "excluded_source_features"}}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, required=True)
    parser.add_argument("--source", type=Path, default=ROOT / "data/geoBoundaries-RUS-ADM2.geojson")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--tolerance-m", type=float, default=500.0)
    args = parser.parse_args()
    print(json.dumps(prepare(args.baseline_dir, args.source, args.output_dir, tolerance_m=args.tolerance_m), indent=2))
