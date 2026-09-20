"""Same-ID Russian precision pilots with frozen scenario-owner and outer boundaries."""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import mapping, shape
from shapely.ops import polygonize

from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry
from tools.prepare_tno_russia_precision import digest, indexed_hausdorff, parent_id, read, safe_output


def polygon_parts(geometry):
    if geometry.geom_type == "Polygon":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygon_parts(part)


def boundary_equal(left, right):
    residual = left.symmetric_difference(right)
    # Only numerical overlay residual on the original boundary is acceptable.
    return residual.is_empty or (residual.area <= 1e-10 and left.boundary.buffer(1e-9).covers(residual))


def constrained_partition(baseline, sources, parents):
    """Restore internal ADM2 edges, keeping this selected owner domain fixed.

    This deliberately preserves accepted scenario coast/water/pilot boundaries.
    It does not claim to upgrade coastline precision or repair inherited gaps.
    Sources must be a valid shared coverage. Baseline edges node the extension
    cells and anchor split IDs; source parents determine new internal edges.
    """
    if not baseline or set(baseline) != set(parents):
        raise ValueError("Every selected feature requires exactly one source parent")
    if any(p not in sources for p in parents.values()):
        raise ValueError("Unresolved source parent")
    if any(g.is_empty or not g.is_valid or g.geom_type not in {"Polygon", "MultiPolygon"} for g in baseline.values()):
        raise ValueError("Invalid selected baseline")
    if len(baseline) == 1:
        # A frozen one-feature domain has no eligible internal edge to upgrade.
        return dict(baseline), {"faces": 0, "baseline_only_faces": 0, "domain_residual_deg2": 0,
                               "baseline_overlap_resolutions": [], "owner_domain_preserved": True,
                               "unchanged_reason": "single-feature frozen owner domain"}
    source_ids = sorted(set(parents.values()))
    source_geometries = [sources[p] for p in source_ids]
    if not coverage_is_valid_exact(source_geometries):
        raise ValueError("Selected source must be a valid shared coverage")
    domain = shapely.union_all(list(baseline.values()))
    families = defaultdict(list)
    for fid, parent in parents.items():
        families[parent].append(fid)
    clipped_sources = [g.intersection(domain) for g in source_geometries]
    lines = [domain.boundary, *(g.boundary for g in baseline.values())]
    lines.extend(p.boundary for g in clipped_sources for p in polygon_parts(g))
    faces = polygonize(shapely.union_all(lines))
    tree = shapely.STRtree(source_geometries)
    old_ids = sorted(baseline)
    old_geometries = [baseline[fid] for fid in old_ids]
    old_tree = shapely.STRtree(old_geometries)
    assigned = defaultdict(list)
    extension_faces = 0
    resolved_overlaps = []
    face_count = 0
    for face in faces:
        point = face.representative_point()
        if not domain.covers(point):
            continue
        face_count += 1
        hits = [source_ids[int(i)] for i in tree.query(point) if source_geometries[int(i)].covers(point)]
        if len(hits) > 1:
            raise ValueError("Ambiguous source parent at face interior")
        old_hits = [old_ids[int(i)] for i in old_tree.query(point) if old_geometries[int(i)].covers(point)]
        if hits:
            candidates = families[hits[0]]
            if len(candidates) == 1:
                receiver = candidates[0]
            else:
                matching = sorted(set(candidates) & set(old_hits))
                if len(matching) == 1:
                    receiver = matching[0]
                elif len(matching) > 1:
                    raise ValueError("Overlapping baseline split children")
                else:
                    distances = sorted((baseline[fid].distance(point), fid) for fid in candidates)
                    if len(distances) > 1 and abs(distances[0][0] - distances[1][0]) < 1e-12:
                        raise ValueError("Ambiguous split identity outside original child")
                    receiver = distances[0][1]
        else:
            extension_faces += 1
            if len(old_hits) > 1:
                distances = sorted((sources[parents[fid]].distance(point), fid) for fid in old_hits)
                if abs(distances[0][0] - distances[1][0]) < 1e-12:
                    raise ValueError("Baseline overlap has no unique nearest source parent")
                receiver = distances[0][1]
                resolved_overlaps.append({"ids": old_hits, "receiver": receiver, "area_deg2": face.area,
                                          "point": list(point.coords[0]),
                                          "rule": "unique nearest source parent within original same-owner overlap"})
            elif not old_hits:
                raise ValueError("Baseline-only face has ambiguous identity: " + json.dumps({
                    "old_hits": old_hits, "area": face.area, "bounds": face.bounds,
                    "point": list(point.coords[0])}))
            else:
                receiver = old_hits[0]
        assigned[receiver].append(face)
    result = {fid: shapely.union_all(assigned[fid]) for fid in old_ids}
    if any(g.is_empty or not g.is_valid or g.geom_type not in {"Polygon", "MultiPolygon"} for g in result.values()):
        raise ValueError("Partition erased or invalidated a feature")
    if not coverage_is_valid_exact(list(result.values())):
        raise ValueError("Partition coverage invalid")
    restored = shapely.union_all(list(result.values()))
    if not boundary_equal(domain, restored):
        raise ValueError("Owner/pilot domain changed: " + json.dumps({
            "residual_area": domain.symmetric_difference(restored).area, "ids": old_ids}))
    return result, {"faces": face_count, "baseline_only_faces": extension_faces,
                    "domain_residual_deg2": domain.symmetric_difference(restored).area,
                    "baseline_overlap_resolutions": resolved_overlaps,
                    "owner_domain_preserved": True}


def simplify_owner_interior(geometries, *, tolerance_degrees=.003, max_deviation_m=1000):
    """Reduce only owner-interior edges, retaining the exact constraint boundary."""
    ids = sorted(geometries)
    original = [geometries[fid] for fid in ids]
    metric = gpd.GeoSeries(original, crs=4326).to_crs(6933)
    attempts = []
    for _ in range(6):
        simplified = shapely.coverage_simplify(original, tolerance_degrees, simplify_boundary=False)
        if any(g.is_empty or not g.is_valid for g in simplified) or not coverage_is_valid_exact(simplified):
            raise ValueError("Owner-interior simplification invalidated coverage")
        projected = gpd.GeoSeries(simplified, crs=4326).to_crs(6933)
        deviation = max(indexed_hausdorff(a, b) for a, b in zip(metric, projected))
        attempts.append({"tolerance_degrees": tolerance_degrees, "max_projected_hausdorff_m": deviation,
                         "coordinates": int(shapely.get_num_coordinates(simplified).sum())})
        if deviation <= max_deviation_m:
            if not shapely.union_all(simplified).equals(shapely.union_all(original)):
                raise ValueError("Interior simplification moved frozen owner boundary")
            return dict(zip(ids, simplified)), {"attempts": attempts,
                    "coordinates_before": int(shapely.get_num_coordinates(original).sum()),
                    "coordinates_after": int(shapely.get_num_coordinates(simplified).sum())}
        tolerance_degrees /= 4
    raise ValueError("Owner-interior simplification exceeded deviation budget")


def node_owner_interfaces(geometries, diagnostics=None):
    """Insert common junctions after independent owner-domain partitioning."""
    ids = sorted(geometries)
    values = [geometries[fid] for fid in ids]
    tree = shapely.STRtree(values)
    assigned = defaultdict(list)
    numerical_slivers = []
    for face in polygonize(shapely.union_all([g.boundary for g in values])):
        point = face.representative_point()
        point_hits = [int(i) for i in tree.query(point) if values[int(i)].covers(point)]
        # A representative point can round onto a third polygon's boundary at
        # a junction. Only positive-area intersection establishes face ownership.
        hits = [i for i in point_hits if face.intersection(values[i]).area > 0]
        if len(hits) > 1:
            if face.area <= 1e-10 and all(values[i].boundary.buffer(1e-9).covers(face) for i in hits):
                numerical_slivers.append({"ids": [ids[i] for i in hits], "area_deg2": face.area})
                hits = [min(hits)]
            else:
                raise ValueError("Frozen owner domains contain a true overlap: " + json.dumps({
                    "ids": [ids[i] for i in hits], "area": face.area, "bounds": face.bounds}))
        if hits:
            assigned[ids[hits[0]]].append(face)
    result = {fid: shapely.union_all(assigned[fid]) for fid in ids}
    for fid in ids:
        if result[fid].is_empty or not boundary_equal(geometries[fid], result[fid]):
            raise ValueError(f"Interface noding changed geometry: {fid}")
    if not coverage_is_valid_exact(list(result.values())):
        error = ValueError("Noded owner interfaces still invalid")
        error.geometries = result
        raise error
    if diagnostics is not None:
        diagnostics["numerical_boundary_slivers"] = numerical_slivers
    return result


def select_pilots(topology, inventory):
    records = {r["id"]: r for r in inventory["records"] if r["kind"] == "adm2"}
    rows = topology["objects"]["political"]["geometries"]
    all_ids = [r["properties"]["id"] for r in rows]
    graph = topology["objects"]["political"]["computed_neighbors"]
    neighbors = {fid: [all_ids[j] for j in graph[i]] for i, fid in enumerate(all_ids)}
    options = [r for r in records.values() if r["owner"] == "OMS" and not r["split"]]
    if not options:
        raise ValueError("No inland OMS pilot candidates")
    seed = min(options, key=lambda r: (r["representative_point"][0]-73)**2 + (r["representative_point"][1]-55)**2)["id"]
    inland, queue = [], [seed]
    while queue and len(inland) < 12:
        fid = queue.pop(0)
        if fid in inland or fid not in records or records[fid]["owner"] != "OMS" or records[fid]["split"]:
            continue
        inland.append(fid)
        queue.extend(sorted(neighbors[fid]))
    pairs = [(fid, other) for fid, r in records.items() for other in neighbors[fid]
             if other in records and fid < other and not r["split"] and not records[other]["split"]
             and r["owner"] != records[other]["owner"] and 35 < r["representative_point"][0] < 85
             and 50 < r["representative_point"][1] < 65]
    if not pairs:
        raise ValueError("No cross-owner pilot adjacency")
    ordered_pairs = sorted(pairs, key=lambda p: (records[p[0]]["representative_point"][0]-52)**2
                           + (records[p[0]]["representative_point"][1]-58)**2)
    geometry_by_id = {}
    row_by_id = {r["properties"]["id"]: r for r in rows}
    def geometry(fid):
        if fid not in geometry_by_id:
            geometry_by_id[fid] = _decode_geometry(topology, row_by_id[fid])
        return geometry_by_id[fid]
    skipped = []
    for pair in ordered_pairs:
        tags = {records[fid]["owner"] for fid in pair}
        region = set(pair)
        for fid in pair:
            region.update(n for n in neighbors[fid] if n in records and records[n]["owner"] in tags)
        groups = [shapely.union_all([geometry(fid) for fid in region if records[fid]["owner"] == tag]) for tag in sorted(tags)]
        overlap = groups[0].intersection(groups[1]).area
        shared_length = groups[0].boundary.intersection(groups[1].boundary).length
        if overlap == 0 and shared_length > 0:
            break
        skipped.append({"pair": list(pair), "owners": sorted(tags), "cross_owner_overlap_deg2": overlap,
                        "shared_boundary_length_degrees": shared_length,
                        "decision": "not an eligible no-allocation-change pilot; requires separate geometry review"})
    else:
        raise ValueError("No clean cross-owner pilot boundary; review overlaps first")
    special = {r["id"] for r in records.values() if r["split"]}
    special.update(region)
    # Selecting a split parent always includes every existing child.
    special_parents = {records[fid]["source_parent_id"] for fid in special}
    special.update(r["id"] for r in records.values() if r["source_parent_id"] in special_parents)
    return {"inland": sorted(inland), "special": sorted(special), "pilots": sorted(set(inland) | special), "all_adm2": sorted(records),
            "cross_owner_pair": list(pair), "excluded_pilot_boundaries": skipped}


def build_candidate(baseline_dir, prepared_dir, output_dir, *, batch="inland", selection_file=None):
    started = time.monotonic()
    baseline_dir, prepared_dir = Path(baseline_dir), Path(prepared_dir)
    output = safe_output(output_dir, [baseline_dir, prepared_dir])
    inventory = read(prepared_dir / "inventory.json")
    runtime_path = baseline_dir / "runtime_topology.topo.json"
    if digest(runtime_path) != inventory["baseline_runtime_sha256"]:
        raise ValueError("Inventory no longer matches frozen baseline")
    baseline = read(runtime_path)
    absolute = _absolute_topology(baseline)
    selections = select_pilots(absolute, inventory)
    selected = set(selections[batch])
    records = {r["id"]: r for r in inventory["records"]}
    if selection_file is not None:
        explicit = read(selection_file)
        if not isinstance(explicit, list) or not explicit or any(not isinstance(i, str) for i in explicit):
            raise ValueError("Selection must be a nonempty ID list")
        if len(set(explicit)) != len(explicit) or any(i not in records or records[i]['kind'] != 'adm2' for i in explicit):
            raise ValueError("Selection contains duplicate or unknown ADM2 IDs")
        selected = set(explicit)
        parents = {records[i]['source_parent_id'] for i in selected}
        if any(r['kind'] == 'adm2' and r['source_parent_id'] in parents and r['id'] not in selected for r in records.values()):
            raise ValueError("Selection must include complete source families")
        batch = "explicit"
    rows = absolute["objects"]["political"]["geometries"]
    by_id = {r["properties"]["id"]: r for r in rows}
    sources = {f["properties"]["id"]: shape(f["geometry"]) for f in read(prepared_dir / "source.geojson")["features"]}
    old = {fid: _decode_geometry(absolute, by_id[fid]) for fid in selected}
    owner_groups = defaultdict(list)
    for fid in sorted(selected):
        owner_groups[records[fid]["owner"]].append(fid)
    replacement, constraints = {}, {}
    for owner, ids in sorted(owner_groups.items()):
        print(f"Partition {owner}: {len(ids)} features", flush=True)
        result, diagnostics = constrained_partition({fid: old[fid] for fid in ids}, sources,
                                                    {fid: records[fid]["source_parent_id"] for fid in ids})
        result, diagnostics["interior_simplification"] = simplify_owner_interior(result)
        replacement.update(result)
        constraints[owner] = diagnostics
    interface_report = {}
    replacement = node_owner_interfaces(replacement, interface_report)
    frame = gpd.GeoDataFrame({"id": sorted(selected)}, geometry=[replacement[f] for f in sorted(selected)], crs=4326)
    candidate, diagnostics = replace_regional_geometry(baseline, frame)
    previous = baseline.get("political_precision_feature_ids", [])
    candidate["political_precision_feature_ids"] = sorted(set(previous) | selected)
    # This builder only swaps geometry by ID. Verify protected object semantics,
    # allocations and owner domains separately from the encoder's own checks.
    for name in absolute["objects"]:
        if name != "political" and not _decode_geometry(absolute, absolute["objects"][name]).equals_exact(
                _decode_geometry(candidate, candidate["objects"][name]), 0):
            raise ValueError(f"Auxiliary object changed: {name}")
    new_rows = candidate["objects"]["political"]["geometries"]
    if [r["properties"] for r in rows] != [r["properties"] for r in new_rows]:
        raise ValueError("Political metadata changed")
    after = {r["properties"]["id"]: r for r in new_rows}
    max_feature_delta = []
    for fid in sorted(selected):
        g = _decode_geometry(candidate, after[fid])
        if not boundary_equal(g, replacement[fid]):
            raise ValueError(f"Encoded geometry changed: {fid}")
        max_feature_delta.append({"id": fid, "symmetric_difference_deg2": old[fid].symmetric_difference(g).area,
                                  "coordinates_before": int(shapely.get_num_coordinates(old[fid])),
                                  "coordinates_after": int(shapely.get_num_coordinates(g))})
    report = {"batch": batch, "selected_count": len(selected), "selected_ids": sorted(selected),
              "owner_counts": {owner: len(ids) for owner, ids in sorted(owner_groups.items())},
              "split_children": sum(records[fid]["split"] for fid in selected),
              "non_ru_labeled": sum(records[fid]["cntr_code"] != "RU" for fid in selected),
              "coordinates_before": int(shapely.get_num_coordinates(list(old.values())).sum()),
              "coordinates_after": int(shapely.get_num_coordinates(list(replacement.values())).sum()),
              "constraints": constraints, "interface_noding": interface_report,
              "selections": selections if batch != "all_adm2" else {"cross_owner_pair": selections["cross_owner_pair"]},
              "feature_deltas": sorted(max_feature_delta, key=lambda r: r["symmetric_difference_deg2"], reverse=True),
              "encoder": diagnostics, "elapsed_seconds": time.monotonic()-started,
              "policy": "Baseline owner/pilot domains and holes retained; only internal boundaries restored. Cities/shells and allocations untouched.",
              "release_ready": False, "browser_validated": False}
    output.mkdir(parents=True)
    write_json_atomic(output / "runtime-candidate.topo.json", candidate, indent=None, separators=(",", ":"))
    write_json_atomic(output / "report.json", report, indent=2)
    return {k: v for k, v in report.items() if k not in {"selected_ids", "feature_deltas", "encoder", "selections", "constraints"}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, required=True)
    parser.add_argument("--prepared-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--batch", choices=["inland", "special", "pilots", "all_adm2"], default="inland")
    parser.add_argument("--selection-file", type=Path)
    args = parser.parse_args()
    print(json.dumps(build_candidate(args.baseline_dir, args.prepared_dir, args.output_dir, batch=args.batch,
                                     selection_file=args.selection_file), indent=2))
