"""Rebuild India ADM2-derived political geometry from a shared-edge source coverage.

The base builder used to simplify every India ADM2 district on its own, which
left overlaps and slivers between neighbours. Those survived parcel merges and
HOI4 geometry splits, so princely-state borders drew doubled or jagged lines.

This is the targeted equivalent of rebuilding India upstream and replaying the
post-build steps, without touching any other country:

1. simplify the cached geoBoundaries ADM2 source as one coverage
   (``simplify_india_adm2_coverage``, the same step the builder now uses);
2. assemble each published India feature from its ADM2 leaves through the
   merge plans (``IN_MRG_*``) and the HOI4 geometry split rules (``__SPLIT_*``);
3. partition the published India outline with that source
   (``repair_source_coverage``), so the country outline, every neighbour and
   every feature ID stay as they are;
4. move partition junctions that land between outline vertices onto the
   nearest outline vertex, so outline arcs stay shared with neighbours;
5. replace the geometry in place and re-share coincident outline arcs.

Derived scenario assets are then rebuilt by the scenario contract builder.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import shapely  # noqa: E402
from shapely.geometry import MultiPolygon, Polygon, shape  # noqa: E402

from map_builder import config as cfg  # noqa: E402
from map_builder.coverage_validation import coverage_is_valid_exact  # noqa: E402
from map_builder.geo.source_coverage_repair import repair_source_coverage  # noqa: E402
from map_builder.io.fetch import fetch_or_load_geojson  # noqa: E402
from map_builder.processors.south_asia import (  # noqa: E402
    exclude_deferred_island_districts,
    simplify_india_adm2_coverage,
)
from map_builder.regional_geometry import (  # noqa: E402
    _absolute_topology,
    _compact_arcs,
    _decode_geometry,
    _encode_exact_coverage,
    _geometries,
    _offset_arcs,
    _update_bbox,
)
from map_builder.json_source import read_json_source  # noqa: E402
from tools.apply_political_feature_merges import manifest_in_sync, refresh_manifest, write_compact  # noqa: E402
from tools.check_scenario_contracts import apply_safe_scenario_contract_repairs, write_json  # noqa: E402
from tools.materialize_polar_scenarios import synchronize_scenario_snapshot  # noqa: E402
from tools.rebuild_polar_assets import read, refresh_neighbors, write  # noqa: E402

MERGE_DIR = ROOT / "data/political_feature_merges"
SPLIT_RULES = ROOT / "data/scenario-rules/hoi4_geometry_splits.json"
SPLIT_MARK = "__SPLIT_"
# Degrees (about 1 cm); removes only vertices noded onto straight shared edges.
COLLINEAR_TOLERANCE = 1e-7
SCENARIOS = ("hoi4_1936", "hoi4_1939", "modern_world", "tno_1962", "blank_base")
PROTECTED_OBJECTS = ("political", "scenario_water", "scenario_atlantropa", "scenario_special_land")
BASE_TOPOLOGIES = ("europe_topology.na_v2.json", "europe_topology.runtime_political_v1.json")


def is_india_feature(feature_id: str) -> bool:
    return feature_id.startswith(("IN_ADM2_", "IN_MRG_"))


def load_source_coverage() -> dict[str, object]:
    frame = fetch_or_load_geojson(cfg.IND_ADM2_URL, cfg.IND_ADM2_FILENAME,
                                  fallback_urls=cfg.IND_ADM2_FALLBACK_URLS)
    frame = frame.set_crs("EPSG:4326", allow_override=True) if frame.crs is None else frame.to_crs("EPSG:4326")
    frame = exclude_deferred_island_districts(frame)
    frame = frame[frame.geometry.notna() & ~frame.geometry.is_empty]
    ids = ("IN_ADM2_" + frame["shapeID"].astype(str)).tolist()
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate India ADM2 source IDs")
    return dict(zip(ids, simplify_india_adm2_coverage(frame.geometry.tolist())))


def load_merge_members() -> dict[str, list[str]]:
    order = json.loads((MERGE_DIR / "apply_order.json").read_text(encoding="utf-8"))["plans"]
    members: dict[str, list[str]] = {}
    for name in order:
        plan = json.loads((MERGE_DIR / name).read_text(encoding="utf-8"))
        for group in plan["groups"]:
            if not is_india_feature(group["id"]):
                continue
            if members.get(group["id"], group["member_ids"]) != group["member_ids"]:
                raise ValueError(f"Conflicting merge members for {group['id']}")
            members[group["id"]] = list(group["member_ids"])
    return members


def load_split_masks() -> dict[str, object]:
    """Child ID -> (cut polygon, inside?) for binary HOI4 split rules."""
    rules = json.loads(SPLIT_RULES.read_text(encoding="utf-8"))
    masks = {}
    for entry in rules["entries"]:
        if not any(is_india_feature(fid) for fid in entry["feature_ids"]):
            continue
        if "polygon" not in entry:
            raise ValueError(f"Only binary polygon splits are supported for India: {entry['id']}")
        polygon = shape(entry["polygon"])
        for parent in entry["feature_ids"]:
            masks[parent + SPLIT_MARK + entry["inside"]["suffix"]] = (parent, polygon, True)
            masks[parent + SPLIT_MARK + entry["outside"]["suffix"]] = (parent, polygon, False)
    return masks


def polygonal(geometry):
    if geometry.geom_type == "GeometryCollection":
        geometry = shapely.union_all([g for g in geometry.geoms if g.geom_type in {"Polygon", "MultiPolygon"}])
    return geometry


def leaf_ids(feature_id, members, seen=None):
    seen = set() if seen is None else seen
    if feature_id in seen:
        raise ValueError(f"Merge cycle at {feature_id}")
    seen.add(feature_id)
    if feature_id.startswith("IN_ADM2_"):
        return [feature_id]
    if feature_id not in members:
        raise ValueError(f"Unknown India merge group: {feature_id}")
    return [leaf for member in members[feature_id] for leaf in leaf_ids(member, members, seen)]


def source_partition(feature_ids, coverage, members, masks):
    """Feature ID -> source geometry assembled like merges and splits did."""
    owner_of_leaf = {}
    sources = {}
    for feature_id in feature_ids:
        if SPLIT_MARK in feature_id:
            if feature_id not in masks:
                raise ValueError(f"No split rule for {feature_id}")
            parent, polygon, inside = masks[feature_id]
        else:
            parent, polygon, inside = feature_id, None, None
        leaves = leaf_ids(parent, members)
        missing = [leaf for leaf in leaves if leaf not in coverage]
        if missing:
            raise ValueError(f"{feature_id}: ADM2 leaves missing from source: {missing[:5]}")
        geometry = shapely.union_all([coverage[leaf] for leaf in leaves])
        if polygon is not None:
            geometry = polygonal(geometry.intersection(polygon) if inside else geometry.difference(polygon))
        else:
            for leaf in leaves:
                if leaf in owner_of_leaf:
                    raise ValueError(f"ADM2 leaf {leaf} used by {owner_of_leaf[leaf]} and {feature_id}")
                owner_of_leaf[leaf] = feature_id
        if geometry.is_empty:
            raise ValueError(f"{feature_id}: empty source geometry")
        sources[feature_id] = geometry
    known = {tuple(c) for g in coverage.values() for ring in _ring_points(g) for c in ring.coords}
    return node_new_vertices(sources, known)


def node_new_vertices(geometries, known_vertices):
    """Insert vertices created by split cuts into the neighbours' edges.

    A cut adds a vertex where it crosses a parent's outer edge; the feature on
    the other side of that edge needs the same vertex for an exact coverage.
    """
    new = sorted({tuple(c) for g in geometries.values() for ring in _ring_points(g) for c in ring.coords}
                 - known_vertices)
    if not new:
        return geometries
    tree = shapely.STRtree(shapely.points(new))
    result = {}
    for feature_id, geometry in geometries.items():
        polygons = []
        for polygon in shapely.get_parts(geometry):
            rings = []
            for ring in [polygon.exterior, *polygon.interiors]:
                coords = [tuple(c) for c in ring.coords]
                segments = shapely.linestrings([[a, b] for a, b in zip(coords, coords[1:])])
                seg_index, point_index = tree.query(segments, predicate="dwithin", distance=1e-9)
                inserts = {}
                for s, p in zip(seg_index.tolist(), point_index.tolist()):
                    point = new[p]
                    a, b = coords[s], coords[s + 1]
                    if point in (a, b):
                        continue
                    t = ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / (
                        (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
                    if 0 < t < 1:
                        inserts.setdefault(s, []).append((t, point))
                out = [coords[0]]
                for s in range(len(coords) - 1):
                    out.extend(point for _, point in sorted(inserts.get(s, [])))
                    out.append(coords[s + 1])
                rings.append(out)
            polygons.append(Polygon(rings[0], rings[1:]))
        noded = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
        if not noded.is_valid:
            raise ValueError(f"{feature_id}: invalid after noding split vertices")
        result[feature_id] = noded
    if not coverage_is_valid_exact(result.values()):
        raise ValueError("India source partition is not a valid coverage after noding")
    return result


def _ring_points(geometry):
    for polygon in shapely.get_parts(geometry):
        if polygon.geom_type == "MultiPolygon" or polygon.geom_type == "GeometryCollection":
            yield from _ring_points(polygon)
        elif polygon.geom_type == "Polygon":
            yield from [polygon.exterior, *polygon.interiors]


def _invalid_location(geometry):
    if geometry is None:
        return None
    match = re.search(r"\[([-0-9.eE+]+) ([-0-9.eE+]+)\]", shapely.is_valid_reason(geometry))
    return (float(match.group(1)), float(match.group(2))) if match else None


def snap_outline_junctions(pieces, outline_vertices):
    """Move vertices noded onto a published outline edge onto its end vertex.

    The repaired partition adds outline vertices only where a source edge meets
    the outline. Each such vertex moves to the nearer end of its outline edge,
    the same way in every piece, so shared edges stay shared and the outline
    keeps the published vertex sequence (and its arcs shared with neighbours).
    When a move would make a piece invalid, the other end is tried, and failing
    that the vertex stays where it is.
    """
    union = shapely.union_all(list(pieces.values()))
    options = {}
    for ring in _ring_points(union):
        coords = [tuple(c) for c in ring.coords[:-1]]
        n = len(coords)
        anchored = [i for i, c in enumerate(coords) if c in outline_vertices]
        for first, last in zip(anchored, anchored[1:] + anchored[:1]):
            last += n if last <= first else 0
            run = [coords[i % n] for i in range(first + 1, last)]
            a, b = coords[first], coords[last % n]
            segment = shapely.LineString([a, b])
            # Other corners (e.g. a filled hole meeting a foreign feature) stay.
            if not run or a == b or any(segment.distance(shapely.Point(c)) > 1e-9 for c in run):
                continue
            for c in run:
                dist = lambda p: (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2  # noqa: E731
                options[c] = sorted((a, b), key=lambda p: (dist(p), p))
    mapping = {c: targets[0] for c, targets in options.items()}

    def rebuild_ring(ring):
        out = []
        for c in ring.coords:
            c = mapping.get(tuple(c), tuple(c))
            if not out or out[-1] != c:
                out.append(c)
        # Drop spikes a moved junction can leave behind (a, b, a).
        changed = True
        while changed and len(out) > 3:
            changed = False
            for i in range(1, len(out) - 1):
                if out[i - 1] == out[i + 1]:
                    del out[i:i + 2]
                    changed = True
                    break
            if not changed and len(out) > 3 and out[-2] == out[1]:
                out = out[1:-1]
                changed = True
        return out if len(out) >= 4 else None

    def rebuild(geometry):
        polygons = []
        for polygon in shapely.get_parts(geometry):
            shell = rebuild_ring(polygon.exterior)
            if shell is None:
                continue
            holes = [h for h in (rebuild_ring(r) for r in polygon.interiors) if h is not None]
            polygons.append(Polygon(shell, holes))
        if not polygons:
            return None
        return polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)

    vertices_of = {fid: {tuple(c) for ring in _ring_points(g) for c in ring.coords}
                   for fid, g in pieces.items()}
    users = Counter(c for vertices in vertices_of.values() for c in vertices)
    result = {fid: rebuild(g) for fid, g in pieces.items()}
    kept = 0
    while True:
        failing = [fid for fid, g in result.items() if g is None or not g.is_valid]
        if not failing:
            break
        touched = set()
        for fid in failing:
            moved = vertices_of[fid] & set(mapping)
            # A moved junction (shared by two pieces) is what can cross an edge;
            # dropping a vertex that only lies on the outline cannot. Revisit
            # the junction nearest to the reported problem first.
            junctions = sorted(c for c in moved if users[c] > 1)
            location = _invalid_location(result[fid])
            if junctions and location is not None:
                junctions = [min(junctions, key=lambda c: (c[0] - location[0]) ** 2 + (c[1] - location[1]) ** 2)]
            for c in junctions or sorted(moved):
                rest = options[c][options[c].index(mapping[c]) + 1:]
                if rest:
                    mapping[c] = rest[0]
                else:
                    del mapping[c]
                    kept += 1
                touched.add(c)
        if not touched:
            raise ValueError(f"Cannot snap outline junctions of {failing[:5]}")
        for fid, vertices in vertices_of.items():
            if vertices & touched:
                result[fid] = rebuild(pieces[fid])
    return result, {"moved_outline_vertices": len(mapping), "kept_outline_vertices": kept}


def reshare_arcs(topology, arc_indices):
    """Split the given arcs at every arc endpoint they pass through, then dedupe.

    Only vertices that already exist are used as split points, so no decoded
    geometry changes; coincident outline chains become one shared arc again.
    """
    arcs = topology["arcs"]
    junctions = {tuple(p) for arc in arcs for p in (arc[0], arc[-1])}
    registry, remap, new_arcs = {}, {}, []
    for index, arc in enumerate(arcs):
        pieces = []
        if index in arc_indices:
            start = 0
            for end in range(1, len(arc)):
                if end == len(arc) - 1 or tuple(arc[end]) in junctions:
                    pieces.append(arc[start:end + 1])
                    start = end
        else:
            pieces.append(arc)
        refs = []
        for piece in pieces:
            forward = tuple(map(tuple, piece))
            canonical = min(forward, forward[::-1]) if index in arc_indices else forward
            key = (canonical, index in arc_indices)
            if index not in arc_indices or key not in registry:
                registry[key] = len(new_arcs)
                new_arcs.append([list(p) for p in canonical])
            number = registry[key]
            refs.append(number if canonical == forward else ~number)
        remap[index] = refs

    def rewrite(value):
        if not value or isinstance(value[0], list):
            return [rewrite(v) for v in value]
        return [new for old in value for new in
                (remap[old] if old >= 0 else [~i for i in reversed(remap[~old])])]

    for obj in topology["objects"].values():
        for row in _geometries(obj):
            if "arcs" in row:
                row["arcs"] = rewrite(row["arcs"])
    topology["arcs"] = new_arcs
    _compact_arcs(topology)


def _arc_set(value, sink):
    if isinstance(value, list):
        for item in value:
            _arc_set(item, sink)
    else:
        sink.add(value if value >= 0 else ~value)


def repair_topology(topology, coverage, members, masks):
    if "transform" in topology:
        raise ValueError("Quantized runtime topologies are not supported")
    absolute = _absolute_topology(topology)
    rows = absolute["objects"]["political"]["geometries"]
    india_ids = [r["properties"]["id"] for r in rows if is_india_feature(r["properties"]["id"])]
    if not india_ids:
        return topology, None
    baseline = {r["properties"]["id"]: _decode_geometry(absolute, r) for r in rows
                if r["properties"]["id"] in set(india_ids)}
    sources = source_partition(india_ids, coverage, members, masks)
    extent = shapely.box(*shapely.union_all(list(baseline.values())).bounds)
    protected, skipped = [], 0
    # Features that can own land next to India. Masks and context layers (land,
    # ocean, land_mask, ...) cover India itself and would block every hole fill.
    for name in PROTECTED_OBJECTS:
        for row in absolute["objects"].get(name, {}).get("geometries", []):
            if name == "political" and row["properties"]["id"] in baseline:
                continue
            if row.get("type") not in {"Polygon", "MultiPolygon"}:
                continue
            try:
                geometry = _decode_geometry(absolute, row)
            except ValueError:
                # Some unrelated scenario rows (e.g. degenerate rings far from
                # India) cannot be decoded; they cannot constrain India either.
                skipped += 1
                continue
            if geometry.intersects(extent):
                protected.append(geometry if geometry.is_valid else shapely.make_valid(geometry))
    # The published outline is kept as it is, including where it already
    # overlapped a neighbour; only the partition inside it changes.
    repaired, report = repair_source_coverage(baseline, sources, protected=shapely.union_all(protected))
    # Published outline vertices: the old pieces' vertices plus the corners
    # their union gained where overlapping old pieces crossed.
    outline_vertices = {tuple(c) for g in [*baseline.values(), shapely.union_all(list(baseline.values()))]
                        for ring in _ring_points(g) for c in ring.coords}
    snapped, moved = snap_outline_junctions(repaired, outline_vertices)
    # Polygonizing also noded the old overlapping edges onto the new shared
    # edges; drop those collinear vertices without touching the outline.
    snapped = dict(zip(snapped, shapely.coverage_simplify(
        list(snapped.values()), COLLINEAR_TOLERANCE, simplify_boundary=False)))
    if not coverage_is_valid_exact(snapped.values()):
        raise ValueError("Snapped India partition is not a valid coverage")
    domain_drift = shapely.union_all(list(snapped.values())).symmetric_difference(
        shapely.union_all(list(repaired.values()))).area
    if domain_drift > 1e-10:
        raise ValueError(f"Snapping changed the India outline: {domain_drift}")
    india_set = set(india_ids)
    candidate = deepcopy(absolute)
    candidate_rows = candidate["objects"]["political"]["geometries"]
    encoded = _encode_exact_coverage(india_ids, [snapped[fid] for fid in india_ids])
    offset = len(candidate["arcs"])
    candidate["arcs"].extend(encoded["arcs"])
    replacements = {item["properties"]["id"]: item for item in encoded["objects"]["political"]["geometries"]}
    for row in candidate_rows:
        replacement = replacements.get(row["properties"]["id"])
        if replacement is not None:
            row["type"] = replacement["type"]
            row["arcs"] = _offset_arcs(replacement["arcs"], offset)
            if "bbox" in row:
                row["bbox"] = list(snapped[row["properties"]["id"]].bounds)
    _compact_arcs(candidate)
    # Re-share outline arcs with the neighbours that touched India before.
    india_arcs = set()
    for row in candidate_rows:
        if row["properties"]["id"] in india_set:
            _arc_set(row["arcs"], india_arcs)
    india_vertices = {tuple(p) for i in india_arcs for p in candidate["arcs"][i]}
    touching = {i for i, arc in enumerate(candidate["arcs"]) if i in india_arcs
                or any(tuple(p) in india_vertices for p in arc)}
    reshare_arcs(candidate, touching)
    _update_bbox(candidate)
    unchanged = verify_replacement(absolute, candidate, snapped)
    refresh_neighbors(topology, candidate, india_set)
    report.update(**moved, outline_drift_deg2=domain_drift,
                  india_feature_count=len(india_ids), unchanged_non_india_features=unchanged,
                  skipped_protected_geometries=skipped)
    return candidate, report


def _ring_coordinates(topology, row):
    """Decoded coordinate lists of a row, without building shapely geometry."""
    def line(indices):
        coordinates = []
        for index in indices:
            segment = topology["arcs"][index if index >= 0 else ~index]
            if index < 0:
                segment = segment[::-1]
            coordinates.extend(segment if not coordinates else segment[1:])
        return [tuple(p) for p in coordinates]

    kind, arcs = row.get("type"), row.get("arcs")
    if kind == "Polygon":
        return [line(ring) for ring in arcs]
    if kind == "MultiPolygon":
        return [[line(ring) for ring in polygon] for polygon in arcs]
    if kind in {"LineString"}:
        return line(arcs)
    if kind == "MultiLineString":
        return [line(item) for item in arcs]
    return row.get("coordinates")


def verify_replacement(before, after, replaced):
    """Every other object keeps identical coordinates; India matches its pieces."""
    unchanged = 0
    for name, obj in before["objects"].items():
        after_rows = list(_geometries(after["objects"][name]))
        before_rows = list(_geometries(obj))
        if len(after_rows) != len(before_rows):
            raise ValueError(f"Object {name} changed its geometry count")
        for old, new in zip(before_rows, after_rows):
            feature_id = (old.get("properties") or {}).get("id")
            if name == "political" and feature_id in replaced:
                if (new.get("properties") or {}).get("id") != feature_id:
                    raise ValueError(f"Feature order changed at {feature_id}")
                if not _decode_geometry(after, new).equals(replaced[feature_id]):
                    raise ValueError(f"Encoded India geometry differs: {feature_id}")
                continue
            if old.get("properties") != new.get("properties") or old.get("type") != new.get("type"):
                raise ValueError(f"Unselected feature properties changed: {feature_id}")
            if _ring_coordinates(before, old) != _ring_coordinates(after, new):
                raise ValueError(f"Unselected geometry changed: {name}:{feature_id}")
            unchanged += 1
    return unchanged


def _summary(report):
    return {**{k: v for k, v in report.items() if k != "source_extension_overlap_resolutions"},
            "overlap_resolutions": len(report["source_extension_overlap_resolutions"])}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenarios", nargs="*", default=list(SCENARIOS))
    parser.add_argument("--base-topologies", nargs="*", default=list(BASE_TOPOLOGIES))
    parser.add_argument("--no-refresh", action="store_true", help="Only rewrite runtime topologies.")
    args = parser.parse_args(argv)
    coverage = load_source_coverage()
    members = load_merge_members()
    masks = load_split_masks()
    reports = ROOT / ".runtime/reports/generated"
    reports.mkdir(parents=True, exist_ok=True)
    in_sync = manifest_in_sync() if args.base_topologies else []
    for name in args.base_topologies:
        path = ROOT / "data" / name
        candidate, report = repair_topology(read_json_source(path), coverage, members, masks)
        if report is not None:
            write_compact(path, candidate)
            write_json(reports / f"{Path(name).stem}.india-coverage.json", report)
            print(json.dumps({"base_topology": name, **_summary(report)}), flush=True)
    if args.base_topologies:
        print(json.dumps({"manifest_refreshed": refresh_manifest(in_sync)}), flush=True)
    for scenario in args.scenarios:
        scenario_dir = ROOT / "data/scenarios" / scenario
        topology_path = scenario_dir / "runtime_topology.topo.json"
        candidate, report = repair_topology(read(topology_path), coverage, members, masks)
        if report is None:
            print(json.dumps({"scenario": scenario, "changed": 0}), flush=True)
            continue
        write(topology_path, candidate)
        write_json(reports / f"{scenario}.india-coverage.json", report)
        if not args.no_refresh:
            # IDs and owners are unchanged, so only the derived assets are rebuilt;
            # the assignment sidecars keep their bytes.
            apply_safe_scenario_contract_repairs(scenario_dir)
            synchronize_scenario_snapshot(scenario_dir)
        print(json.dumps({"scenario": scenario, **_summary(report)}), flush=True)


if __name__ == "__main__":
    main()
