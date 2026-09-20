"""Measure Russian baseline overlaps, source exclusions and deformation review flags."""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import shape
from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from map_builder.io.writers import write_json_atomic
from tools.prepare_tno_russia_precision import read, parent_id, digest


def area_km2(geometry):
    if geometry.is_empty:
        return 0.0
    return float(gpd.GeoSeries([geometry], crs=4326).to_crs(6933).area.iloc[0] / 1e6)


def audit(baseline_dir, source_path):
    baseline = Path(baseline_dir)
    topo = _absolute_topology(read(baseline / "runtime_topology.topo.json"))
    owners = read(baseline / "owners.by_feature.json")["owners"]
    features = topo["objects"]["political"]["geometries"]
    geometries = {f["properties"]["id"]: _decode_geometry(topo, f) for f in features}
    props = {f["properties"]["id"]: f["properties"] for f in features}
    ids = sorted(fid for fid in geometries if fid.startswith("RU_RAY_"))
    rays = [geometries[fid] for fid in ids]
    tree = shapely.STRtree(rays)
    overlaps = []
    print("Audit Russian baseline overlaps", flush=True)
    for i, geom in enumerate(rays):
        for j in tree.query(geom, predicate="intersects"):
            j = int(j)
            if j <= i:
                continue
            overlap = geom.intersection(rays[j])
            if overlap.area <= 1e-10:
                continue
            overlaps.append({"ids": [ids[i], ids[j]], "owners": [owners[ids[i]], owners[ids[j]]],
                             "cross_owner": owners[ids[i]] != owners[ids[j]], "area_km2": area_km2(overlap),
                             "bounds": list(overlap.bounds), "point": list(overlap.representative_point().coords[0])})
    raw_features = read(source_path)["features"]
    raw = {"RU_RAY_" + f["properties"]["shapeID"]: shape(f["geometry"]) for f in raw_features}
    names = {"RU_RAY_" + f["properties"]["shapeID"]: f["properties"]["shapeName"] for f in raw_features}
    families = defaultdict(list)
    for fid in ids:
        families[parent_id(fid)].append(fid)
    current_parents = {parent: shapely.union_all([geometries[fid] for fid in children]) for parent, children in families.items()}
    parent_ids = sorted(families)
    source_areas = gpd.GeoSeries([raw[p] for p in parent_ids], crs=4326).to_crs(6933).area.values / 1e6
    current_areas = gpd.GeoSeries([current_parents[p] for p in parent_ids], crs=4326).to_crs(6933).area.values / 1e6
    flags = []
    for parent, source_area, current_area in zip(parent_ids, source_areas, current_areas):
        ratio = float(current_area/source_area) if source_area else None
        if ratio is None or ratio < .8 or ratio > 1.2:
            flags.append({"parent": parent, "name": names[parent], "source_area_km2": float(source_area),
                          "baseline_area_km2": float(current_area), "area_ratio": ratio,
                          "children": families[parent], "owners": sorted({owners[fid] for fid in families[parent]}),
                          "split": any(fid != parent for fid in families[parent]),
                          "status": "review flag, not proof of bad geography; inspect cuts, cities and source history"})
    all_ids = list(geometries)
    all_geometries = [geometries[fid] for fid in all_ids]
    all_tree = shapely.STRtree(all_geometries)
    land = _decode_geometry(topo, topo["objects"]["land_mask"])
    water = _decode_geometry(topo, topo["objects"]["scenario_water"])
    excluded = []
    print("Audit unused source masks", flush=True)
    for fid in sorted(set(raw)-set(families)):
        source = raw[fid]
        hits = [int(i) for i in all_tree.query(source, predicate="intersects")]
        covered = shapely.union_all([all_geometries[i] for i in hits])
        allowed = source.intersection(land).difference(water)
        gap = allowed.difference(covered)
        excluded.append({"id": fid, "name": names[fid], "bounds": list(source.bounds),
                         "source_area_km2": area_km2(source), "intersection_land_mask_km2": area_km2(source.intersection(land)),
                         "intersection_water_km2": area_km2(source.intersection(water)),
                         "uncovered_published_land_km2": area_km2(gap),
                         "covering_feature_ids": [all_ids[i] for i in hits],
                         "diagnosis": "negative-longitude source excluded by existing eastern-hemisphere clip" if source.bounds[2] < -20 else
                         "requires water/city-cut review; exclusion is not automatically correct"})
    report = {"version": 1, "source_sha256": digest(source_path),
              "baseline_runtime_sha256": digest(baseline / "runtime_topology.topo.json"),
              "baseline_ray_count": len(ids), "source_count": len(raw),
              "raw_source_valid_polygons": all(g.is_valid and not g.is_empty for g in raw.values()),
              "raw_source_valid_coverage": bool(shapely.coverage_is_valid(list(raw.values()))),
              "baseline_ray_valid_coverage": bool(shapely.coverage_is_valid(rays)),
              "overlap_pair_count": len(overlaps), "cross_owner_overlap_pair_count": sum(r["cross_owner"] for r in overlaps),
              "overlap_pair_area_sum_km2": sum(r["area_km2"] for r in overlaps),
              "overlap_area_note": "pair sum can double-count triple overlaps; not unique total area",
              "overlaps": sorted(overlaps, key=lambda r: r["area_km2"], reverse=True),
              "source_to_baseline_area_flags": sorted(flags, key=lambda r: abs((r["area_ratio"] or 0)-1), reverse=True),
              "unused_source_features": excluded,
              "policy": "No automatic country reassignment or gap filling. Valid source polygons do not establish factual administrative accuracy.",
              "unverified": ["Current real-world administrative truth and all source-internal missing districts",
                             "Global missing-land corridors beyond the three excluded source features",
                             "Whether the published land/water mask itself is geographically correct"]}
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, required=True)
    parser.add_argument("--source", type=Path, default=ROOT / "data/geoBoundaries-RUS-ADM2.geojson")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report_path = args.report.resolve()
    if report_path.exists() or any(report_path.is_relative_to(ROOT/n) for n in ("data", "dist")):
        raise ValueError("Report must be a new path outside production")
    report = audit(args.baseline_dir, args.source)
    write_json_atomic(report_path, report, indent=2)
    print(json.dumps({k:v for k,v in report.items() if k not in {"overlaps", "source_to_baseline_area_flags", "unused_source_features"}}, indent=2))
