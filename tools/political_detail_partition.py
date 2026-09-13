"""Lossless whole-feature partitioning shared by source and Pages builds.

Only the standard library is used so the minimal Pages build needs no GIS stack.
"""
from __future__ import annotations

import json

POLITICAL_DETAIL_SHARD_MAX_COMPACT_BYTES = 2 * 1024 * 1024
POLITICAL_DETAIL_SHARD_MAX_PATH_COST = 100_000


def geometry_coordinates(geometry):
    if not isinstance(geometry, dict):
        return
    if geometry.get("type") == "GeometryCollection":
        for child in geometry.get("geometries", []):
            yield from geometry_coordinates(child)
        return

    def walk(node):
        if not isinstance(node, (list, tuple)) or not node:
            return
        if len(node) >= 2 and isinstance(node[0], (int, float)) and isinstance(node[1], (int, float)):
            yield node[:2]
        else:
            for child in node:
                yield from walk(child)

    yield from walk(geometry.get("coordinates"))


def geometry_part_count(geometry):
    if not isinstance(geometry, dict):
        return 0
    kind = geometry.get("type")
    if kind == "GeometryCollection":
        return sum(geometry_part_count(child) for child in geometry.get("geometries", []))
    coordinates = geometry.get("coordinates") or []
    if kind in {"MultiPoint", "MultiLineString", "MultiPolygon"}:
        return len(coordinates)
    return int(bool(coordinates)) if kind in {"Point", "LineString", "Polygon"} else 0


def feature_costs(feature):
    geometry = feature.get("geometry")
    coords = sum(1 for _ in geometry_coordinates(geometry))
    parts = geometry_part_count(geometry)
    return coords + 8 * parts + 3, len(json.dumps(feature, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def feature_bounds(feature):
    coords = list(geometry_coordinates(feature.get("geometry")))
    if not coords:
        return [-180.0, -90.0, 180.0, 90.0]
    return [max(-180.0, min(c[0] for c in coords)), max(-90.0, min(c[1] for c in coords)),
            min(180.0, max(c[0] for c in coords)), min(90.0, max(c[1] for c in coords))]


def partition_political_detail_features(entries, *, max_compact_bytes=None, max_path_cost=None, feature_compact_sizes=None):
    """Median spatial bisection; an indivisible oversized feature stays intact."""
    byte_limit = POLITICAL_DETAIL_SHARD_MAX_COMPACT_BYTES if max_compact_bytes is None else int(max_compact_bytes)
    path_limit = POLITICAL_DETAIL_SHARD_MAX_PATH_COST if max_path_cost is None else int(max_path_cost)
    if byte_limit <= 0 or path_limit <= 0:
        raise ValueError("Political detail shard budgets must be positive")
    if not entries:
        return []

    def anchor(entry, axis):
        return (entry[2][axis] + entry[2][axis + 2]) / 2

    def split(items):
        # Include the source writer's trailing newline in the compact budget.
        compact_size = 42 + sum(item[2] for item in items) + max(0, len(items) - 1)
        if len(items) <= 1 or (sum(item[1] for item in items) <= path_limit and compact_size <= byte_limit):
            return [items]
        spreads = [max(anchor(item[0], axis) for item in items) - min(anchor(item[0], axis) for item in items) for axis in (0, 1)]
        axis = 0 if spreads[0] >= spreads[1] else 1
        ordered = sorted(items, key=lambda item: (anchor(item[0], axis), item[0][0]))
        middle = len(ordered) // 2
        return split(ordered[:middle]) + split(ordered[middle:])

    items = []
    for entry in entries:
        path_cost, compact_size = feature_costs(entry[1])
        if feature_compact_sizes is not None:
            compact_size = feature_compact_sizes[entry[0]]
        items.append((entry, path_cost, compact_size))
    shards = split(items)
    shards.sort(key=lambda shard: (min(anchor(item[0], 0) for item in shard),
                                   min(anchor(item[0], 1) for item in shard), min(item[0][0] for item in shard)))
    return [[item[0] for item in shard] for shard in shards]


def political_detail_chunk_ids(owner_bucket, shard_count):
    prefix = f"political.detail.country.{str(owner_bucket or '').strip().lower()}"
    return [prefix] if shard_count == 1 else [f"{prefix}.part.{index}" for index in range(shard_count)]
