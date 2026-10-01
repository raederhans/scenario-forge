"""Build opt-in river paint partitions without changing administrative identities.

Inputs are immutable GeoJSON/TopoJSON snapshots. No snapping, endpoint extension,
sliver deletion, repair, or cross-river merging is performed. Only valid, complete
partitions enter the pack; rejected/uncut parents remain visible in the audit.
Output geometry uses clockwise exterior rings for the existing d3 renderer.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import shapely
from shapely.geometry import LineString, MultiLineString, Polygon, MultiPolygon, Point, shape, mapping
from shapely.geometry.polygon import orient
from shapely.ops import polygonize_full, unary_union

SCHEMA_VERSION = 1
ALGORITHM_VERSION = "river-joint-noding-v1"
MAX_PARTS = 128


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _canonical_ring(ring):
    # JS Math.round-compatible integer grid, used for identity only.
    points = [(math.floor(float(p[0]) * 1e7 + 0.5), math.floor(float(p[1]) * 1e7 + 0.5)) for p in ring]
    while len(points) > 1 and points[-1] == points[0]:
        points.pop()
    if not points:
        raise ValueError("Empty ring")
    # Remove adjacent duplicates for normalized identity, never from rendering.
    points = [p for i, p in enumerate(points) if i == 0 or p != points[i - 1]]
    candidates = []
    minimum = min(points)
    for sequence in (points, list(reversed(points))):
        for i, p in enumerate(sequence):
            if p == minimum:
                candidates.append(sequence[i:] + sequence[:i])
    return min(candidates)


def canonical_geometry(geometry: dict) -> str:
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    if geometry["type"] not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Expected polygon geometry")
    normalized = []
    for polygon in polygons:
        if not polygon:
            raise ValueError("Empty polygon")
        normalized.append([_canonical_ring(polygon[0]), *sorted(_canonical_ring(r) for r in polygon[1:])])
    return json.dumps(sorted(normalized), separators=(",", ":"))


def geometry_fingerprint(geometry: dict) -> str:
    return _digest(canonical_geometry(geometry).encode("utf-8"))


def feature_id(feature: dict) -> str:
    return str(feature.get("properties", {}).get("id") or feature.get("id") or "").strip()


def decode_features(document: dict, object_name: str = "political") -> list[dict]:
    """Decode polygon/line TopoJSON without pulling in another dependency."""
    if document.get("type") == "FeatureCollection":
        return document.get("features", [])
    if document.get("type") != "Topology":
        raise ValueError("Input must be GeoJSON FeatureCollection or TopoJSON Topology")
    transform = document.get("transform")
    arcs = []
    for arc in document.get("arcs", []):
        x = y = 0
        decoded = []
        for point in arc:
            if transform:
                x += point[0]
                y += point[1]
                decoded.append([x * transform["scale"][0] + transform["translate"][0],
                                y * transform["scale"][1] + transform["translate"][1]])
            else:
                decoded.append(list(point[:2]))
        arcs.append(decoded)

    def join(indices):
        coordinates = []
        for index in indices:
            arc = arcs[index if index >= 0 else ~index]
            if index < 0:
                arc = list(reversed(arc))
            if coordinates and arc and coordinates[-1] != arc[0]:
                raise ValueError("Disconnected TopoJSON arcs")
            coordinates.extend(arc if not coordinates else arc[1:])
        return coordinates

    def geometry(item):
        kind = item.get("type")
        values = item.get("arcs", [])
        if kind == "Polygon":
            return {"type": kind, "coordinates": [join(r) for r in values]}
        if kind == "MultiPolygon":
            return {"type": kind, "coordinates": [[join(r) for r in p] for p in values]}
        if kind == "LineString":
            return {"type": kind, "coordinates": join(values)}
        if kind == "MultiLineString":
            return {"type": kind, "coordinates": [join(r) for r in values]}
        raise ValueError(f"Unsupported TopoJSON geometry: {kind}")

    obj = document.get("objects", {}).get(object_name)
    if obj is None:
        raise ValueError(f"Missing TopoJSON object: {object_name}")
    items = obj.get("geometries", []) if obj.get("type") == "GeometryCollection" else [obj]
    return [{"type": "Feature", "id": item.get("id"), "properties": item.get("properties", {}),
             "geometry": geometry(item)} for item in items]


def _polygons(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    return []


def _lines(geometry):
    if isinstance(geometry, LineString):
        return [] if geometry.is_empty else [geometry]
    result = []
    for part in getattr(geometry, "geoms", []):
        result.extend(_lines(part))
    return result


def _coordinates_are_local(geometry) -> bool:
    # v1 deliberately rejects date-line/polar domains instead of guessing a CRS.
    minx, miny, maxx, maxy = geometry.bounds
    return (-180 <= minx <= maxx <= 180 and -80 <= miny <= maxy <= 80 and maxx - minx < 180)


def partition_parent(feature: dict, river_lines, *, max_parts=MAX_PARTS) -> tuple[dict | None, dict]:
    parent_id = feature_id(feature)
    audit = {"parentId": parent_id, "status": "rejected"}
    try:
        if not parent_id:
            raise ValueError("Missing parent ID")
        original = shape(feature["geometry"])
        if not _polygons(original) or original.is_empty or not original.is_valid:
            raise ValueError("Invalid/empty parent polygon; automatic repair is forbidden")
        if not _coordinates_are_local(original):
            raise ValueError("Date-line/polar domain is outside the v1 planar partition contract")
        source_components = len(_polygons(original))
        # Node original linework with the original boundary exactly once.
        # Intersecting each river with the polygon first can manufacture almost-
        # coincident endpoints and turn real crossings into dangling cut edges.
        crossing = [river for river in river_lines if river.intersects(original)]
        if not crossing:
            return None, {**audit, "status": "no_intersection"}
        noded = unary_union([original.boundary, *crossing])
        faces, cuts, dangles, invalid = polygonize_full(noded)
        if not invalid.is_empty:
            raise ValueError("Polygonization produced invalid ring linework")
        parts = []
        for face in faces.geoms:
            point = face.representative_point()
            # Degenerate narrow faces may have no representable interior point.
            # Use entire-face evidence in that case rather than an area cutoff.
            if not face.contains(point):
                inside = face.intersection(original)
                outside = face.difference(original)
                if outside.is_empty and not inside.is_empty:
                    parts.append(face)
                elif not inside.is_empty:
                    raise ValueError("Ambiguous original-domain membership for a narrow face")
            elif original.covers(point):
                parts.append(face)
        if len(parts) <= source_components:
            return None, {**audit, "status": "uncut", "sourceComponents": source_components,
                          "cutLineLength": cuts.length, "interiorDanglingLineLength": dangles.intersection(original).length}
        if len(parts) > max_parts:
            raise ValueError(f"Partition exceeds {max_parts} faces; review rather than drop fragments")
        if any(part.is_empty or not part.is_valid or part.area <= 0 for part in parts):
            raise ValueError("Invalid/zero-area partition face")
        combined = unary_union(parts)
        difference = original.symmetric_difference(combined).area
        distance = original.hausdorff_distance(combined)
        overlap = sum(parts[i].intersection(parts[j]).area for i in range(len(parts)) for j in range(i))
        area_tolerance = max(1e-14, original.area * 1e-12)
        if difference > area_tolerance or overlap > area_tolerance or distance > 1e-9:
            raise ValueError(f"Coverage check failed: difference={difference}, overlap={overlap}, distance={distance}")
        parent_geometry = d3_geometry(original)
        cells = []
        for part in parts:
            cell_geometry = mapping(orient(part, sign=-1.0))
            cell_fingerprint = geometry_fingerprint(cell_geometry)
            cells.append({"id": f"river:{parent_id}:{cell_fingerprint[7:23]}",
                          "geometry": cell_geometry, "geometryFingerprint": cell_fingerprint})
        cells.sort(key=lambda item: item["id"])
        if len({cell["id"] for cell in cells}) != len(cells):
            raise ValueError("Cell identity collision at the declared coordinate identity grid")
        entry = {"parentId": parent_id, "parentGeometry": parent_geometry,
                 "parentFingerprint": geometry_fingerprint(parent_geometry), "cells": cells}
        audit.update(status="partitioned", sourceComponents=source_components, cells=len(cells),
                     addedFaces=len(cells) - source_components, symmetricDifferenceDegrees2=difference,
                     overlapDegrees2=overlap, hausdorffDegrees=distance,
                     smallestFaceDegrees2=min(p.area for p in parts),
                     cutLineLength=cuts.intersection(original).length, interiorDanglingLineLength=dangles.intersection(original).length)
        return entry, audit
    except (ValueError, TypeError, KeyError, shapely.errors.GEOSException) as exc:
        return None, {**audit, "reason": str(exc)}


def select_rivers(features: list[dict], names: list[str], include_lake_centerlines=False):
    wanted = {name.strip().casefold() for name in names}
    selected, found = [], set()
    for feature in features:
        props = feature.get("properties", {})
        kind = str(props.get("featurecla", props.get("FEATURECLA", "River"))).strip().casefold()
        if kind not in ({"river", "lake centerline"} if include_lake_centerlines else {"river"}):
            continue
        aliases = {str(props.get(key, "")).strip().casefold() for key in ("name", "NAME", "name_en", "NAME_EN")}
        matched = wanted.intersection(aliases)
        if not matched:
            continue
        geometry = shape(feature["geometry"])
        if not geometry.is_valid or not _lines(geometry):
            raise ValueError(f"Invalid river linework: {sorted(matched)}")
        selected.extend(_lines(geometry))
        found.update(matched)
    if wanted - found:
        raise ValueError(f"River names not found: {sorted(wanted - found)}")
    return selected



def d3_geometry(geometry):
    parts = [orient(part, sign=-1.0) for part in _polygons(geometry)]
    return mapping(parts[0] if isinstance(geometry, Polygon) else MultiPolygon(parts))


def _points(geometry):
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    return [tuple(point[:2]) for polygon in polygons for ring in polygon for point in ring]


def node_contour_neighbors(land_features, entries):
    """Preserve neighbor surfaces, inserting only proven source-edge cut vertices.

    The renderer's shared-edge graph compares a declared integer identity grid.
    Rounding a new intersection can make two collinear subsegments fail that
    exact comparison against an un-noded neighbor edge. Store small auxiliary
    geometry patches so both sides use the very same endpoint. These are not
    administrative replacements or new paint targets. All source geometry and
    coverage identities remain independently auditable.
    """
    if not entries:
        return [], []
    source_by_id = {feature_id(feature): feature for feature in land_features}
    split_ids = {entry["parentId"] for entry in entries}
    new_points = set()
    for entry in entries:
        original_points = set(_points(entry["parentGeometry"]))
        for cell in entry["cells"]:
            new_points.update(set(_points(cell["geometry"])) - original_points)
    points = sorted(new_points)
    if not points:
        return [], []
    point_tree = shapely.STRtree([Point(point) for point in points])
    support, checks = [], []
    for fid, feature in source_by_id.items():
        if fid in split_ids:
            continue
        props = feature.get("properties", {})
        if props.get("interactive") is False or props.get("render_as_base_geography") is True or "_FB_" in fid:
            continue
        original = shape(feature["geometry"])
        if not _polygons(original) or original.is_empty or not original.is_valid or not _coordinates_are_local(original):
            continue
        # Floating point roundoff only. This is not a geographical snap radius.
        tolerance = 64 * math.ulp(max(1.0, *map(abs, original.bounds)))
        nearby = [points[int(i)] for i in point_tree.query(original.envelope.buffer(tolerance))]
        if not nearby:
            continue
        inserted = 0
        def node_ring(ring):
            nonlocal inserted
            out = []
            for a, b in zip(ring, ring[1:]):
                a, b = tuple(a[:2]), tuple(b[:2])
                out.append(a)
                dx, dy = b[0] - a[0], b[1] - a[1]
                length2 = dx * dx + dy * dy
                if not length2:
                    continue
                interior = []
                for point in nearby:
                    if point == a or point == b:
                        continue
                    t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2
                    if not 0 < t < 1:
                        continue
                    cross = (point[0] - a[0]) * dy - (point[1] - a[1]) * dx
                    if cross * cross <= tolerance * tolerance * length2:
                        interior.append((t, point))
                for _, point in sorted(set(interior)):
                    if out[-1] != point:
                        out.append(point)
                        inserted += 1
            out.append(tuple(ring[-1][:2]))
            return out
        polygons = []
        for polygon in _polygons(original):
            polygons.append(Polygon(node_ring(list(polygon.exterior.coords)),
                                    [node_ring(list(ring.coords)) for ring in polygon.interiors]))
        if not inserted:
            continue
        combined = polygons[0] if isinstance(original, Polygon) else MultiPolygon(polygons)
        difference = original.symmetric_difference(combined).area
        distance = original.hausdorff_distance(combined)
        if not combined.is_valid or difference > max(1e-14, original.area * 1e-12) or distance > tolerance:
            raise ValueError(f"Neighbor noding changed source domain beyond roundoff: {fid}")
        geometry = d3_geometry(combined)
        support.append({"parentId": fid, "parentFingerprint": geometry_fingerprint(mapping(original)),
                        "parentGeometry": d3_geometry(original), "geometry": geometry,
                        "geometryFingerprint": geometry_fingerprint(geometry)})
        checks.append({"parentId": fid, "insertedVertices": inserted,
                       "symmetricDifferenceDegrees2": difference, "hausdorffDegrees": distance})
    support.sort(key=lambda item: item["parentId"])
    return support, checks

def build_pack(land_features: list[dict], river_lines, *, scene_id: str, source: dict,
               parent_ids: set[str] | None = None, max_parents=10000):
    ids = [feature_id(f) for f in land_features]
    if not all(ids) or len(set(ids)) != len(ids):
        raise ValueError("Land inputs require unique nonempty IDs")
    if parent_ids and parent_ids - set(ids):
        raise ValueError(f"Requested parents missing from input: {sorted(parent_ids - set(ids))}")
    entries, audits = [], []
    tree = shapely.STRtree(river_lines)
    for feature in land_features:
        fid = feature_id(feature)
        if parent_ids and fid not in parent_ids:
            continue
        props = feature.get("properties", {})
        if props.get("interactive") is False or props.get("render_as_base_geography") is True or "_FB_" in fid:
            audits.append({"parentId": fid, "status": "excluded_auxiliary"})
            continue
        try:
            geometry = shape(feature["geometry"])
            candidates = [river_lines[int(i)] for i in tree.query(geometry, predicate="intersects")]
        except (ValueError, TypeError, KeyError, shapely.errors.GEOSException) as exc:
            audits.append({"parentId": fid, "status": "rejected", "reason": str(exc)})
            continue
        if not candidates:
            continue
        entry, audit = partition_parent(feature, candidates)
        audits.append(audit)
        if entry:
            entries.append(entry)
            if len(entries) > max_parents:
                raise ValueError(f"More than {max_parents} split parents; narrow the pilot scope")
    entries.sort(key=lambda p: p["parentId"])
    support, support_checks = node_contour_neighbors(land_features, entries)
    identity = {"sceneId": scene_id, "algorithm": ALGORITHM_VERSION, "source": source,
                "parents": [[p["parentId"], p["parentFingerprint"], [c["geometryFingerprint"] for c in p["cells"]]] for p in entries],
                "support": [[p["parentId"], p["geometryFingerprint"]] for p in support]}
    pack_id = _digest(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode())
    pack = {"schemaVersion": SCHEMA_VERSION, "kind": "river-paint-partitions", "packId": pack_id,
            "sceneId": scene_id, "algorithmVersion": ALGORITHM_VERSION,
            "coordinateIdentityPrecision": 7, "geometryWinding": "d3-clockwise-exterior",
            "source": source, "parents": entries, "support": support}
    report = {"schemaVersion": 1, "packId": pack_id, "source": source,
              "summary": dict(Counter(a["status"] for a in audits)),
              "parentCount": len(entries), "cellCount": sum(len(p["cells"]) for p in entries),
              "audit": audits, "supportCount": len(support), "supportChecks": support_checks, "shapelyVersion": shapely.__version__}
    return pack, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--land", type=Path, required=True)
    parser.add_argument("--rivers", type=Path, default=Path("data/global_rivers.geojson"))
    parser.add_argument("--river", action="append", required=True, dest="names")
    parser.add_argument("--parent", action="append", default=[])
    parser.add_argument("--scene-id", required=True, help="Exact scenario ID; use modern_world for the modern map")
    parser.add_argument("--land-object", default="political")
    parser.add_argument("--base-commit", default="")
    parser.add_argument("--baseline-hash", default="")
    parser.add_argument("--include-lake-centerlines", action="store_true")
    parser.add_argument("--max-parents", type=int, default=10000)
    parser.add_argument("--output", type=Path, default=Path(".runtime/reports/generated/river-paint/partitions.json"))
    args = parser.parse_args(argv)
    if args.max_parents <= 0:
        parser.error("--max-parents must be positive")
    source = {"landPath": args.land.as_posix(), "landDigest": _digest(args.land.read_bytes()),
              "riverPath": args.rivers.as_posix(), "riverDigest": _digest(args.rivers.read_bytes()),
              "riverNames": sorted(set(args.names)), "includeLakeCenterlines": args.include_lake_centerlines}
    if args.base_commit:
        source["baseCommit"] = args.base_commit
    if args.baseline_hash:
        source["baselineHash"] = args.baseline_hash
    land = decode_features(_read(args.land), args.land_object)
    rivers = select_rivers(decode_features(_read(args.rivers), "rivers"), args.names, args.include_lake_centerlines)
    pack, report = build_pack(land, rivers, scene_id=args.scene_id, source=source,
                              parent_ids=set(args.parent) or None, max_parents=args.max_parents)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    audit_path = args.output.with_suffix(".audit.json")
    audit_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"pack": str(args.output), "audit": str(audit_path), **report["summary"],
                      "parentCount": report["parentCount"], "cellCount": report["cellCount"]}))


if __name__ == "__main__":
    main()
