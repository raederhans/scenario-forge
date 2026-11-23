from __future__ import annotations

import json
from contextlib import ExitStack
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
import subprocess
from tempfile import NamedTemporaryFile

import numpy as np
import shapely

from tools.political_detail_partition import feature_bounds

POLITICAL_DECIMALS = {"tno_1962": 6}


def round_water_geometry(payload):
    if payload.get("type") == "Topology" and "transform" in payload:
        return

    def rounded(value):
        if isinstance(value, list):
            return [rounded(child) for child in value]
        return (round(value, 6) or 0) if isinstance(value, float) else value

    def visit(node):
        if "bbox" in node:
            node["bbox"] = rounded(node["bbox"])
        kind = node.get("type")
        if kind == "Topology":
            node["arcs"] = rounded(node["arcs"])
            for child in node["objects"].values():
                visit(child)
        elif kind == "FeatureCollection":
            for child in node["features"]:
                visit(child)
        elif kind == "Feature":
            if node.get("geometry"):
                visit(node["geometry"])
        elif kind == "GeometryCollection":
            for child in node["geometries"]:
                visit(child)
        elif "coordinates" in node:
            node["coordinates"] = rounded(node["coordinates"])

    visit(payload)


def _chunk_features(payload):
    if payload["type"] != "Topology":
        return payload["features"] if payload["type"] == "FeatureCollection" else [payload]

    def decode(geometry):
        kind = geometry["type"]
        if kind == "GeometryCollection":
            return {"type": kind, "geometries": [decode(child) for child in geometry["geometries"]]}
        if "arcs" not in geometry:
            return geometry

        def line(refs):
            points = []
            for ref in refs:
                arc = payload["arcs"][ref if ref >= 0 else ~ref]
                arc = arc if ref >= 0 else arc[::-1]
                points.extend(arc if not points else arc[1:])
            return points

        refs = geometry["arcs"]
        coords = line(refs) if kind == "LineString" else (
            [[line(ring) for ring in polygon] for polygon in refs] if kind == "MultiPolygon"
            else [line(ring) for ring in refs])
        return {"type": kind, "coordinates": coords}

    features = []
    for obj in payload["objects"].values():
        for geometry in obj["geometries"] if obj["type"] == "GeometryCollection" else [obj]:
            features.append({"type": "Feature", "geometry": decode(geometry)})
    return features


def _political_rings(features):
    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") == "Polygon":
            yield from geometry["coordinates"]
        elif geometry.get("type") == "MultiPolygon":
            for polygon in geometry["coordinates"]:
                yield from polygon


def _round_xy(point, decimals):
    return (round(point[0], decimals) or 0, round(point[1], decimals) or 0)


def _feature_indices(chunks, point_ids):
    vertices = []
    rings, polygons, features = [0], [0], [0]
    locations = []
    for chunk, path in chunks:
        ring_offset = len(rings) - 1
        for index, feature in enumerate(_chunk_features(json.loads(path.read_bytes()))):
            geometry = feature.get("geometry") or {}
            kind = geometry.get("type")
            if kind not in {"Polygon", "MultiPolygon"}:
                continue
            coords = geometry["coordinates"]
            for polygon in [coords] if kind == "Polygon" else coords:
                for ring in polygon:
                    vertices.extend(point_ids[tuple(point[:2])] for point in ring)
                    rings.append(len(vertices))
                polygons.append(len(rings) - 1)
            features.append(len(polygons) - 1)
            locations.append((chunk["lod"], path, index, ring_offset))
    return np.asarray(vertices, dtype=np.intp), tuple(map(np.asarray, (rings, polygons, features))), locations


def _source_overlap_pairs(geometry):
    parts = list(geometry.geoms)
    if len(parts) < 2:
        return 0
    parts = np.asarray([part if part.is_valid else shapely.make_valid(part) for part in parts])
    left, right = shapely.STRtree(parts).query(parts)
    keep = left < right
    return int(shapely.relate_pattern(parts[left[keep]], parts[right[keep]], "2********").sum())


def _conflicting_edge_pairs(edges, projected, invalid_geometry, decimals):
    edges = edges[(projected[edges[:, 0]] != projected[edges[:, 1]]).any(axis=1)]
    lines = shapely.linestrings(projected[edges])
    tree = shapely.STRtree(lines)
    left, right = tree.query(lines, predicate="intersects")
    keep = left < right
    left, right = left[keep], right[keep]
    interior = shapely.relate_pattern(lines[left], lines[right], "T********")
    pairs = set()
    for a, b in zip(edges[left[interior]], edges[right[interior]]):
        pairs.add(tuple(sorted((tuple(sorted(a)), tuple(sorted(b))))))
    if pairs:
        return pairs, []
    # Containment or a vertex contact can invalidate a face without crossing two edge interiors.
    _, _, position = shapely.is_valid_reason(invalid_geometry).partition("[")
    if not position:
        return pairs, []
    witness = shapely.Point(*map(float, position.rstrip("]").split()))
    nearby = tree.query(witness, predicate="dwithin", distance=2 ** 0.5 * 10 ** -decimals)
    return pairs, np.unique(edges[nearby])


def _restore_edge_endpoints(pairs, source, projected, needed):
    """Choose the fewest additional endpoints that recover the source DE-9IM relation."""
    if not pairs:
        return
    ids = np.asarray(sorted(pairs)).reshape(-1, 4)
    original, current = source[ids], projected[ids]

    def relations(coords):
        return shapely.relate(shapely.linestrings(coords[:, :2]), shapely.linestrings(coords[:, 2:]))

    expected = relations(original)
    bits = np.array([8, 4, 2, 1])
    allowed = []
    for mask in range(16):
        trial = np.where(((mask & bits) != 0)[None, :, None], original, current)
        allowed.append(relations(trial) == expected)
    masks = sorted(range(16), key=int.bit_count)
    for endpoints, matches in zip(ids, np.asarray(allowed).T):
        fixed = sum(bit for i, bit in zip(endpoints, bits) if i in needed or (source[i] == projected[i]).all())
        for mask in masks:
            if mask & fixed != fixed or not matches[mask]:
                continue
            selected = endpoints[(mask & bits) != 0]
            # A shared endpoint has one state on both edges.
            if not set(selected).isdisjoint(endpoints[(mask & bits) == 0]):
                continue
            needed.update(i for i in selected if (source[i] != projected[i]).any())
            break


def _feature_protection(chunks, grid, protected, decimals, remaining_scans, affected_rings, whole_features):
    points = list(grid)
    vertices, offsets, locations = _feature_indices(chunks, {point: i for i, point in enumerate(points)})
    stats = {chunk["lod"]: dict(source_invalid_features=0, source_overlap_features=0, source_overlap_pairs=0)
             for chunk, _ in chunks}
    if not locations:
        return set(), 0, stats
    rings, polygons, features = offsets
    source = np.asarray(points)
    projected = np.asarray([point if point in protected else _round_xy(point, decimals) for point in points])

    def geometries(xy):
        return shapely.from_ragged_array(shapely.GeometryType.MULTIPOLYGON, xy[vertices], offsets)

    source_shapes = geometries(source)
    valid = shapely.is_valid(source_shapes)
    for i in np.flatnonzero(~valid):
        counts = stats[locations[i][0]]
        pairs = _source_overlap_pairs(source_shapes[i])
        counts["source_invalid_features"] += 1
        counts["source_overlap_features"] += int(pairs > 0)
        counts["source_overlap_pairs"] += pairs
    del source_shapes

    restored = set()
    for scan in range(remaining_scans):
        shapes = geometries(projected)
        invalid = np.flatnonzero(valid & ~shapely.is_valid(shapes))
        if not len(invalid):
            return {points[i] for i in restored}, scan, stats
        pairs = set()
        needed = set()
        affected = []
        for i in invalid:
            lod, path, index, ring_offset = locations[i]
            edge_lists = []
            for r in range(polygons[features[i]], polygons[features[i + 1]]):
                ring = vertices[rings[r]:rings[r + 1]]
                edge_lists.append(np.column_stack((ring[:-1], ring[1:])))
                affected.append(((lod, path, r - ring_offset), ring))
            edges = np.concatenate(edge_lists)
            conflicts, nearby = _conflicting_edge_pairs(edges, projected, shapes[i], decimals)
            if conflicts:
                pairs.update(conflicts)
                continue
            if len(nearby):
                movable = nearby[(source[nearby] != projected[nearby]).any(axis=1)]
                if len(movable):
                    needed.update(movable)
                    continue
            whole_features.add((lod, path, index))
            needed.update(np.unique(edges))
        _restore_edge_endpoints(pairs, source, projected, needed)
        added = list(needed)
        projected[added] = source[added]
        changed = np.zeros(len(points), dtype=bool)
        changed[added] = True
        affected_rings.update(key for key, ring in affected if changed[ring].any())
        restored.update(needed)
    raise ValueError("Political feature protection did not converge in ten scans")


def _ring_protection(original, mapped):
    seen = set()
    revisited = {}
    twice_area = 0
    previous = mapped[-1]
    for point in mapped:
        if point != previous:
            twice_area += previous[0] * point[1] - previous[1] * point[0]
            if point in seen:
                revisited[point] = set()
            seen.add(point)
        previous = point
    if not twice_area:
        return set(original)
    if revisited:
        for old, new in zip(original, mapped):
            if new in revisited:
                revisited[new].add(old)
    return {old for group in revisited.values() if len(group) > 1 for old in group}


def _round_political_chunk(path, target, chunk, decimals, grid, protected, stats):
    payload = json.loads(path.read_bytes())
    if payload["type"] == "Topology" and "transform" in payload:
        raise ValueError(f"Political rounding requires absolute coordinates: {path}")
    features = _chunk_features(payload)
    required = {}
    scale = 10 ** decimals
    for index, ring in enumerate(_political_rings(features)):
        stats["points_before"] += len(ring)
        original = [tuple(point[:2]) for point in ring[:-1]]
        for point in original:
            if point not in grid:
                grid[point] = tuple(round(v * scale) for v in _round_xy(point, decimals))
        needed = _ring_protection(original, [grid[point] for point in original])
        if needed:
            required[index] = needed

    lines = payload["arcs"] if payload["type"] == "Topology" else _political_rings(features)
    for line in lines:
        for point in line:
            xy = tuple(point[:2])
            if xy in protected:
                continue
            x, y = _round_xy(xy, decimals)
            displacement = max(abs(Decimal(str(x)) - Decimal(str(xy[0]))),
                               abs(Decimal(str(y)) - Decimal(str(xy[1]))))
            stats["max_displacement_degrees"] = max(stats["max_displacement_degrees"], float(displacement))
            point[:2] = x, y
    features = _chunk_features(payload)
    stats["points_after"] += sum(map(len, _political_rings(features)))
    country_detail = chunk["lod"] == "detail" and chunk["id"].startswith("political.detail.country.")
    if country_detail or "feature_bounds" in chunk:
        bounds = [feature_bounds(feature) for feature in features]
        chunk["feature_bounds"] = bounds
        if country_detail and bounds:
            chunk["bounds"] = [min(box[0] for box in bounds), min(box[1] for box in bounds),
                               max(box[2] for box in bounds), max(box[3] for box in bounds)]
    target.write_bytes(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    return required


def round_published_political_chunks(app_root, manifest_path, manifest, excluded):
    scenario = manifest_path.parent.name
    if scenario not in POLITICAL_DECIMALS or manifest_path in excluded:
        return
    decimals = POLITICAL_DECIMALS[scenario]
    chunks = [(chunk, (app_root / chunk["url"]).resolve()) for chunk in manifest["chunks"]
              if chunk.get("layer") == "political"]
    if not chunks or any(path in excluded or path.suffix == ".gz" for _, path in chunks):
        return
    chunks_dir = (manifest_path.parent / "chunks").resolve()
    if any(not path.is_relative_to(chunks_dir) for _, path in chunks):
        raise ValueError("Chunk URL is outside its scenario chunks directory")
    grid = {}
    protected = set()
    affected_rings = set()
    whole_features = set()
    feature_stats = None
    with ExitStack() as staging:
        targets = []
        for _, path in chunks:
            with NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
                target = Path(temporary.name)
            staging.callback(target.unlink, missing_ok=True)
            targets.append(target)
        pairs = [[str(path), str(target)] for (_, path), target in zip(chunks, targets)]
        iteration = 0
        while iteration < 10:
            iteration += 1
            required = set()
            layers = {}
            for (chunk, path), target in zip(chunks, targets):
                lod = chunk["lod"]
                stats = layers.setdefault(lod, dict(points_before=0, points_after=0, removed_duplicates=0,
                                                    max_displacement_degrees=0))
                rings = _round_political_chunk(path, target, chunk, decimals, grid, protected, stats)
                for index, points in rings.items():
                    affected_rings.add((lod, path, index))
                    required.update(points)

            if not required:
                winding = _run_political_script(pairs, "--check-winding")
                for (chunk, path), rings in zip(chunks, winding, strict=True):
                    for index, ring in rings:
                        affected_rings.add((chunk["lod"], path, index))
                        required.update(tuple(point[:2]) for point in ring)
            if required:
                feature_stats = None
            elif feature_stats is None:
                required, updates, feature_stats = _feature_protection(
                    chunks, grid, protected, decimals, 11 - iteration, affected_rings, whole_features)
                iteration += max(0, updates - 1)
            if not required:
                for (_, path), target in zip(chunks, targets):
                    target.replace(path)
                for lod, stats in layers.items():
                    stats["protected_rings"] = sum(layer == lod for layer, _, _ in affected_rings)
                    stats["whole_features"] = sum(layer == lod for layer, _, _ in whole_features)
                    stats.update(feature_stats[lod])
                return dict(scenario_id=scenario, decimals=decimals, distinct_points=len(grid),
                            protected_points=len(protected), scans=iteration, layers=layers)
            added = required - protected
            if not added:
                raise ValueError("Political rings remain degenerate at original precision")
            protected.update(added)
            for point in added:
                grid[point] = tuple(Fraction(str(v)) * 10 ** decimals for v in point)
    raise ValueError("Political point protection did not converge in ten scans")


def _run_political_script(files, *args):
    script = Path(__file__).with_name("orient_published_political_chunks.mjs")
    result = subprocess.run(["node", str(script), *args], input=json.dumps(files), text=True,
                            capture_output=True, check=True)
    return json.loads(result.stdout)


def normalize_published_geometry(app_root: Path, *, byte_exact_paths=()):
    app_root = app_root.resolve()
    excluded = {(app_root / path).resolve() for path in byte_exact_paths}
    political = []
    for manifest_path in sorted((app_root / "data/scenarios").glob("*/detail_chunks.manifest.json")):
        if manifest_path.resolve() in excluded:
            continue
        manifest = json.loads(manifest_path.read_bytes())
        updated = False
        for chunk in manifest.get("chunks", []):
            if chunk.get("layer") not in {"water", "political"}:
                continue
            path = (app_root / chunk["url"]).resolve()
            if not path.is_relative_to((manifest_path.parent / "chunks").resolve()):
                raise ValueError("Chunk URL is outside its scenario chunks directory")
            if path in excluded or path.suffix == ".gz":
                continue
            if chunk["layer"] == "political":
                political.append(str(path))
                continue
            payload = json.loads(path.read_bytes())
            if payload.get("type") == "Topology" and "transform" in payload:
                continue
            round_water_geometry(payload)
            path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            # chunk["bounds"] 是切片网格单元的范围，不随要素坐标变化；只有逐要素外包框要按最终 payload 重算。
            if "feature_bounds" in chunk:
                chunk["feature_bounds"] = [feature_bounds(feature) for feature in _chunk_features(payload)]
                updated = True
        if updated:
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if not political:
        return []
    return _run_political_script(political)
