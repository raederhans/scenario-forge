"""Lossless sharing of exact, repeated TopoJSON subarcs."""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import json
import math
from typing import Any


_DOMAIN_ALIASES = {
    "political": "political+scenario_atlantropa",
    "scenario_atlantropa": "political+scenario_atlantropa",
}


def _point_atom(value: Any) -> tuple[str, Any]:
    if isinstance(value, bool):
        raise ValueError("TopoJSON coordinates must be numeric scalars, not booleans")
    if isinstance(value, int):
        return ("int", value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("TopoJSON coordinates must be finite")
        return ("float", value.hex())
    raise ValueError("TopoJSON coordinates must be numeric scalars")


def _point_key(point: Any) -> tuple[tuple[str, Any], ...]:
    if not isinstance(point, list) or len(point) < 2:
        raise ValueError("TopoJSON positions must contain at least two ordinates")
    return tuple(_point_atom(value) for value in point)


def _iter_arc_refs(tree: Any):
    if isinstance(tree, bool):
        raise ValueError("TopoJSON arc references must be integers")
    if isinstance(tree, int):
        yield tree
        return
    if not isinstance(tree, list):
        raise ValueError("TopoJSON arc references must be nested integer arrays")
    for item in tree:
        yield from _iter_arc_refs(item)


def _geometry_arc_refs(geometry: Any):
    if not isinstance(geometry, dict):
        raise ValueError("TopoJSON geometries must be objects")
    if geometry.get("type") == "GeometryCollection":
        geometries = geometry.get("geometries")
        if not isinstance(geometries, list):
            raise ValueError("GeometryCollection.geometries must be an array")
        for child in geometries:
            yield from _geometry_arc_refs(child)
    if "arcs" in geometry:
        yield from _iter_arc_refs(geometry["arcs"])


def _walk_geometry(geometry: Any):
    if not isinstance(geometry, dict):
        raise ValueError("TopoJSON geometries must be objects")
    yield geometry
    if geometry.get("type") == "GeometryCollection":
        geometries = geometry.get("geometries")
        if not isinstance(geometries, list):
            raise ValueError("GeometryCollection.geometries must be an array")
        for child in geometries:
            yield from _walk_geometry(child)


def _validate_topology(topology: Any) -> tuple[list[list[list[Any]]], dict[str, Any]]:
    if not isinstance(topology, dict) or topology.get("type") != "Topology":
        raise ValueError("expected a Topology object")
    if "transform" in topology:
        raise ValueError("transformed TopoJSON is unsupported; provide absolute coordinates")
    arcs = topology.get("arcs")
    objects = topology.get("objects")
    if not isinstance(arcs, list) or not isinstance(objects, dict):
        raise ValueError("Topology must contain arcs and objects")
    for arc_index, arc in enumerate(arcs):
        if not isinstance(arc, list) or len(arc) < 2:
            raise ValueError(f"arc {arc_index} must contain at least two positions")
        for point in arc:
            _point_key(point)
    for object_name, obj in objects.items():
        if not isinstance(obj, dict):
            raise ValueError(f"Topology object {object_name!r} must be an object")
        for ref in _geometry_arc_refs(obj):
            arc_index = ref if ref >= 0 else -ref - 1
            if arc_index < 0 or arc_index >= len(arcs):
                raise ValueError(f"Topology object {object_name!r} references missing arc {ref}")
    return arcs, objects


def _owner_masks(objects: dict[str, Any], arc_count: int) -> tuple[list[int], dict[str, str]]:
    aliases = {name: _DOMAIN_ALIASES.get(name, name) for name in objects}
    domain_ids: dict[str, int] = {}
    for domain in aliases.values():
        if domain not in domain_ids:
            domain_ids[domain] = len(domain_ids)
    masks = [0] * arc_count
    for object_name, obj in objects.items():
        bit = 1 << domain_ids[aliases[object_name]]
        for ref in _geometry_arc_refs(obj):
            arc_index = ref if ref >= 0 else -ref - 1
            masks[arc_index] |= bit
    return masks, aliases


def _rewrite_arc_tree(tree: Any, arc_map: list[list[int]]) -> Any:
    if isinstance(tree, bool):
        raise ValueError("TopoJSON arc references must be integers")
    if isinstance(tree, int):
        index = tree if tree >= 0 else -tree - 1
        refs = arc_map[index]
        return list(refs) if tree >= 0 else [-ref - 1 for ref in reversed(refs)]
    if not isinstance(tree, list):
        raise ValueError("TopoJSON arc references must be nested integer arrays")
    rewritten = []
    for item in tree:
        if isinstance(item, bool):
            raise ValueError("TopoJSON arc references must be integers")
        if isinstance(item, int):
            index = item if item >= 0 else -item - 1
            refs = arc_map[index]
            rewritten.extend(refs if item >= 0 else [-ref - 1 for ref in reversed(refs)])
        else:
            rewritten.append(_rewrite_arc_tree(item, arc_map))
    return rewritten


def _compatible_groups(arc_ids: list[int], owner_masks: list[int]) -> list[list[int]]:
    groups: list[list[int]] = []
    for arc_id in sorted(arc_ids, key=lambda value: (-owner_masks[value].bit_count(), value)):
        group = next(
            (items for items in groups
             if all(not (owner_masks[arc_id] & owner_masks[other]) for other in items)),
            None,
        )
        if group is None:
            group = []
            groups.append(group)
        group.append(arc_id)
    return groups


def optimize_topology(
    topology: dict[str, Any],
    *,
    preserve_arc_identity: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Share exact repeated subarcs and return a copy plus diagnostics.

    Coordinates are never rounded or transformed. With preserve_arc_identity
    enabled, distinct source arcs are shared only when no consumer domain uses
    both. The political and scenario_atlantropa objects intentionally share a
    consumer domain.
    """
    if not isinstance(preserve_arc_identity, bool):
        raise TypeError("preserve_arc_identity must be a boolean")
    source_arcs, source_objects = _validate_topology(topology)
    candidate = deepcopy(topology)
    arcs = candidate["arcs"]
    objects = candidate["objects"]
    arc_count = len(arcs)
    owner_masks, aliases = (
        _owner_masks(objects, arc_count)
        if preserve_arc_identity
        else ([0] * arc_count, {})
    )

    coordinate_ids: dict[tuple[tuple[str, Any], ...], int] = {}
    points: list[list[Any]] = []
    ids_by_arc: list[list[int]] = []
    max_vertices = max((len(arc) for arc in arcs), default=0)
    position_bits = max(1, (max_vertices - 1).bit_length())
    edge_shift = position_bits + 1
    edge_occurrences: dict[tuple[int, int], int | list[int]] = {}
    edge_count = 0

    for arc_id, arc in enumerate(arcs):
        row = []
        for point in arc:
            key = _point_key(point)
            vertex_id = coordinate_ids.get(key)
            if vertex_id is None:
                vertex_id = len(points)
                coordinate_ids[key] = vertex_id
                points.append(point)
            row.append(vertex_id)
        ids_by_arc.append(row)
        for position, (start, end) in enumerate(zip(row, row[1:])):
            edge_key = (start, end) if start <= end else (end, start)
            forward = 1 if start <= end else 0
            occurrence = (arc_id << edge_shift) | (position << 1) | forward
            previous = edge_occurrences.get(edge_key)
            if previous is None:
                edge_occurrences[edge_key] = occurrence
            elif isinstance(previous, list):
                previous.append(occurrence)
            else:
                edge_occurrences[edge_key] = [previous, occurrence]
            edge_count += 1

    repeated_edges = {
        edge_key: occurrences
        for edge_key, occurrences in edge_occurrences.items()
        if isinstance(occurrences, list)
    }
    del edge_occurrences

    def decode_occurrence(value: int) -> tuple[int, int, int]:
        arc_id = value >> edge_shift
        remainder = value & ((1 << edge_shift) - 1)
        return arc_id, remainder >> 1, remainder & 1

    chains: dict[tuple[int, ...], set[tuple[int, int, int]]] = {}
    pair_count = 0
    cross_arc_segment_count = 0
    for occurrences in repeated_edges.values():
        decoded = [decode_occurrence(value) for value in occurrences]
        if len({item[0] for item in decoded}) > 1:
            cross_arc_segment_count += 1
        for left_index, (arc_a, pos_a, direction_a) in enumerate(decoded):
            for arc_b, pos_b, direction_b in decoded[left_index + 1:]:
                if arc_a == arc_b:
                    continue
                pair_count += 1
                same_direction = direction_a == direction_b
                vertices_a = ids_by_arc[arc_a]
                vertices_b = ids_by_arc[arc_b]

                if same_direction:
                    if pos_a and pos_b and vertices_a[pos_a - 1] == vertices_b[pos_b - 1]:
                        continue
                elif pos_a and pos_b + 2 < len(vertices_b) and vertices_a[pos_a - 1] == vertices_b[pos_b + 2]:
                    continue

                left = 0
                while pos_a - left > 0:
                    other = pos_b - left - 1 if same_direction else pos_b + left + 2
                    if (other < 0 or other >= len(vertices_b)
                            or vertices_a[pos_a - left - 1] != vertices_b[other]):
                        break
                    left += 1

                right = 0
                while pos_a + 2 + right < len(vertices_a):
                    other = pos_b + 2 + right if same_direction else pos_b - 1 - right
                    if (other < 0 or other >= len(vertices_b)
                            or vertices_a[pos_a + 2 + right] != vertices_b[other]):
                        break
                    right += 1

                start_a, end_a = pos_a - left, pos_a + right
                start_b = pos_b - left if same_direction else pos_b - right
                end_b = pos_b + right if same_direction else pos_b + left
                sequence = tuple(vertices_a[start_a:end_a + 2])
                reverse = sequence[::-1]
                canonical = sequence if sequence <= reverse else reverse
                chain_occurrences = chains.get(canonical)
                if chain_occurrences is None:
                    chain_occurrences = set()
                    chains[canonical] = chain_occurrences
                chain_occurrences.add((arc_a, start_a, end_a))
                chain_occurrences.add((arc_b, start_b, end_b))

    selected_edges = [bytearray(max(0, len(row) - 1)) for row in ids_by_arc]
    selected_ranges: list[list[tuple[int, int, tuple[int, ...]]]] = [[] for _ in arcs]
    selected_groups = 0
    selected_edge_occurrences = 0

    for canonical, occurrences in sorted(
        chains.items(),
        key=lambda item: (-len(item[0]), -len(item[1])),
    ):
        by_arc: dict[int, list[tuple[int, int]]] = defaultdict(list)
        for arc_id, start, end in occurrences:
            by_arc[arc_id].append((start, end))
        arc_groups = (
            _compatible_groups(list(by_arc), owner_masks)
            if preserve_arc_identity
            else [list(by_arc)]
        )

        for group in arc_groups:
            if len(group) < 2:
                continue
            chosen = []
            for arc_id in group:
                for start, end in sorted(by_arc[arc_id]):
                    if not any(selected_edges[arc_id][start:end + 1]):
                        chosen.append((arc_id, start, end))
                        break
            if len({arc_id for arc_id, _, _ in chosen}) < 2:
                continue
            for arc_id, start, end in chosen:
                selected_edges[arc_id][start:end + 1] = b"\x01" * (end - start + 1)
                selected_ranges[arc_id].append((start, end, canonical))
                selected_edge_occurrences += end - start + 1
            selected_groups += 1

    new_arcs: list[list[list[Any]]] = []
    new_arc_vertices: list[tuple[int, ...]] = []
    variants: dict[tuple[int, ...], list[tuple[int, int]]] = defaultdict(list)

    def add_piece(canonical: tuple[int, ...], owner_mask: int) -> int:
        for new_arc_id, used_mask in variants[canonical]:
            if not preserve_arc_identity or not (used_mask & owner_mask):
                if preserve_arc_identity:
                    variants[canonical] = [
                        (index, mask | owner_mask if index == new_arc_id else mask)
                        for index, mask in variants[canonical]
                    ]
                return new_arc_id
        new_arc_id = len(new_arcs)
        new_arcs.append([list(points[vertex_id]) for vertex_id in canonical])
        new_arc_vertices.append(canonical)
        variants[canonical].append((new_arc_id, owner_mask))
        return new_arc_id

    arc_map: list[list[int]] = []
    for arc_id, row in enumerate(ids_by_arc):
        refs: list[int] = []
        cursor = 0
        for start, end, canonical in sorted(selected_ranges[arc_id], key=lambda item: item[0]):
            if cursor < start:
                run = tuple(row[cursor:start + 1])
                base = run if run <= run[::-1] else run[::-1]
                new_arc_id = add_piece(base, owner_masks[arc_id])
                refs.append(new_arc_id if run == base else -new_arc_id - 1)
            run = tuple(row[start:end + 2])
            if run != canonical and run[::-1] != canonical:
                raise AssertionError("selected chain does not match its canonical coordinates")
            new_arc_id = add_piece(canonical, owner_masks[arc_id])
            refs.append(new_arc_id if run == canonical else -new_arc_id - 1)
            cursor = end + 1
        if cursor < len(row) - 1:
            run = tuple(row[cursor:])
            base = run if run <= run[::-1] else run[::-1]
            new_arc_id = add_piece(base, owner_masks[arc_id])
            refs.append(new_arc_id if run == base else -new_arc_id - 1)
        if not refs:
            raise AssertionError(f"source arc {arc_id} mapped to no candidate refs")
        arc_map.append(refs)

    for obj in objects.values():
        for geometry in _walk_geometry(obj):
            if "arcs" in geometry:
                geometry["arcs"] = _rewrite_arc_tree(geometry["arcs"], arc_map)
    candidate["arcs"] = new_arcs

    candidate_arc_vertices = []
    for arc in new_arcs:
        candidate_arc_vertices.append(tuple(coordinate_ids[_point_key(point)] for point in arc))
    for source_arc_id, refs in enumerate(arc_map):
        rebuilt: list[int] = []
        for ref in refs:
            candidate_arc_id = ref if ref >= 0 else -ref - 1
            part = candidate_arc_vertices[candidate_arc_id]
            if ref < 0:
                part = part[::-1]
            if rebuilt:
                if rebuilt[-1] != part[0]:
                    raise AssertionError(f"candidate refs do not join for source arc {source_arc_id}")
                rebuilt.extend(part[1:])
            else:
                rebuilt.extend(part)
        if rebuilt != ids_by_arc[source_arc_id]:
            raise AssertionError(f"candidate refs changed source arc {source_arc_id}")

    input_ref_count = sum(1 for obj in source_objects.values() for _ in _geometry_arc_refs(obj))
    output_ref_count = sum(1 for obj in objects.values() for _ in _geometry_arc_refs(obj))
    diagnostics = {
        "preserve_arc_identity": preserve_arc_identity,
        "consumer_domains": aliases,
        "input_arcs": arc_count,
        "candidate_arcs": len(new_arcs),
        "input_vertices": sum(len(row) for row in ids_by_arc),
        "unique_coordinate_values": len(coordinate_ids),
        "input_edge_occurrences": edge_count,
        "repeated_segment_keys": len(repeated_edges),
        "cross_arc_segment_keys": cross_arc_segment_count,
        "maximal_pair_chains": len(chains),
        "cross_arc_occurrence_pairs_examined": pair_count,
        "selected_shared_chain_groups": selected_groups,
        "selected_shared_edge_occurrences": selected_edge_occurrences,
        "input_geometry_arc_refs": input_ref_count,
        "candidate_geometry_arc_refs": output_ref_count,
        "exact_arc_reconstruction": True,
    }
    return candidate, diagnostics


def compact_large_runtime_topology(
    topology: dict[str, Any],
    *,
    max_bytes: int = 100 * 1024 * 1024,
) -> dict[str, Any]:
    """Losslessly compact an oversized runtime topology or require splitting."""
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 0:
        raise ValueError("max_bytes must be a non-negative integer")

    def compact_size(payload: dict[str, Any]) -> int:
        text = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ) + "\n"
        return len(text.encode("utf-8"))

    source_size = compact_size(topology)
    if source_size < max_bytes:
        return topology

    candidate, _ = optimize_topology(topology, preserve_arc_identity=True)
    candidate_size = compact_size(candidate)
    chosen = candidate if candidate_size < source_size else topology
    chosen_size = min(candidate_size, source_size)
    if chosen_size >= max_bytes:
        raise ValueError(
            f"lossless runtime topology is {chosen_size} bytes (limit {max_bytes}); "
            "split the payload instead of reducing coordinate precision"
        )
    return chosen
