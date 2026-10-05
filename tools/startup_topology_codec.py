"""Lossless private wire encoding for transformed startup Topology arcs.

The encoded descriptor is only used inside startup bundles. Call
``decode_topology`` before passing a bundle topology to TopoJSON consumers.
"""

from __future__ import annotations

import base64
import binascii
import copy
import gzip
import io
import math
import struct
from typing import Any


ENCODING = "topology-delta-zigzag-uleb128-cross-arc-origin-v1"
COMPACT_ENCODING = "topology-delta-zigzag-closed-gzip-v2"
REFERENCE_ENCODING = "topology-arc-references-delta-sign-gzip-v1"
MAX_REFERENCE_COUNT = 5_000_000
REFERENCE_DEPTHS = {"LineString": 1, "MultiLineString": 2, "Polygon": 2, "MultiPolygon": 3}
MAX_ARC_COUNT = 1_000_000
MAX_POINT_COUNT = 5_000_000
INT32_MIN = -(2**31)
INT32_MAX = 2**31 - 1
MAX_UINT32 = 2**32 - 1


def _is_finite_number(value: object) -> bool:
    if type(value) is int:
        return True
    return type(value) is float and math.isfinite(value)


def _has_2d_transform(topology: dict[str, Any]) -> bool:
    transform = topology.get("transform")
    if not isinstance(transform, dict):
        return False
    scale = transform.get("scale")
    translate = transform.get("translate")
    return (
        isinstance(scale, list)
        and len(scale) == 2
        and isinstance(translate, list)
        and len(translate) == 2
        and all(_is_finite_number(value) for value in scale)
        and all(_is_finite_number(value) for value in translate)
    )


def _fits_int32(value: object) -> bool:
    return type(value) is int and INT32_MIN <= value <= INT32_MAX


def _zigzag(value: int) -> int:
    return value * 2 if value >= 0 else -value * 2 - 1


def _append_varint(value: int, target: bytearray) -> None:
    encoded = _zigzag(value)
    if encoded > MAX_UINT32:
        raise ValueError("startup topology codec integer exceeds uint32 zigzag range")
    while encoded >= 0x80:
        target.append((encoded & 0x7F) | 0x80)
        encoded >>= 7
    target.append(encoded)


def _read_varint(data: bytes, offset: int) -> tuple[int, int]:
    encoded = 0
    for byte_index in range(5):
        if offset >= len(data):
            raise ValueError("startup topology codec varint stream is truncated")
        byte = data[offset]
        offset += 1
        payload = byte & 0x7F
        if byte_index == 4 and (payload > 0x0F or byte & 0x80):
            raise ValueError("startup topology codec varint exceeds uint32")
        encoded |= payload << (byte_index * 7)
        if not byte & 0x80:
            value = -(encoded // 2) - 1 if encoded & 1 else encoded // 2
            if not INT32_MIN <= value <= INT32_MAX:
                raise ValueError("startup topology codec decoded integer exceeds int32")
            return value, offset
    raise ValueError("startup topology codec varint exceeds five bytes")


def _decode_base64(value: object, *, expected_bytes: int, label: str) -> bytes:
    if not isinstance(value, str):
        raise ValueError(f"startup topology codec {label} must be base64 text")
    expected_chars = ((expected_bytes + 2) // 3) * 4
    if len(value) != expected_chars:
        raise ValueError(f"startup topology codec {label} encoded length mismatch")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"startup topology codec {label} is invalid base64") from exc
    if len(decoded) != expected_bytes:
        raise ValueError(f"startup topology codec {label} decoded length mismatch")
    return decoded


def encode_topology(topology: object) -> object:
    """Encode supported transformed 2D integer arcs; return unsupported input unchanged."""

    if not isinstance(topology, dict) or topology.get("type") != "Topology" or "arcs_encoding" in topology:
        return topology
    arcs = topology.get("arcs")
    if not _has_2d_transform(topology) or not isinstance(arcs, list):
        return topology
    if not 0 < len(arcs) <= MAX_ARC_COUNT:
        return topology

    point_count = 0
    for arc in arcs:
        if not isinstance(arc, list):
            return topology
        point_count += len(arc)
        if point_count > MAX_POINT_COUNT:
            return topology
        for pair in arc:
            if not isinstance(pair, list) or len(pair) != 2:
                return topology
            if not _fits_int32(pair[0]) or not _fits_int32(pair[1]):
                return topology

    if point_count == 0:
        return topology

    lengths = bytearray(len(arcs) * 4)
    stream = bytearray()
    previous_start = (0, 0)
    for arc_index, arc in enumerate(arcs):
        struct.pack_into("<I", lengths, arc_index * 4, len(arc))
        for point_index, pair in enumerate(arc):
            x, y = pair
            if point_index == 0:
                dx = x - previous_start[0]
                dy = y - previous_start[1]
                if not INT32_MIN <= dx <= INT32_MAX or not INT32_MIN <= dy <= INT32_MAX:
                    return topology
                previous_start = (x, y)
            else:
                dx, dy = x, y
            _append_varint(dx, stream)
            _append_varint(dy, stream)

    encoded = copy.copy(topology)
    encoded.pop("arcs")
    encoded["arcs_encoding"] = {
        "encoding": ENCODING,
        "arc_count": len(arcs),
        "point_count": point_count,
        "arc_lengths_u32_le_base64": base64.b64encode(lengths).decode("ascii"),
        "delta_pairs_zigzag_uleb128_base64": base64.b64encode(stream).decode("ascii"),
        "first_delta_mode": "first pair stores this arc absolute integer start minus previous nonempty arc start",
    }
    return encoded


def _descriptor_count(descriptor: dict[str, Any], key: str, limit: int) -> int:
    value = descriptor.get(key)
    if type(value) is not int or not 0 <= value <= limit:
        raise ValueError(f"startup topology codec {key} is invalid")
    return value


def _decode_delta_topology(topology: object, closed: bytes | None = None) -> object:
    """Restore standard TopoJSON arcs, passing legacy topologies through unchanged."""

    if not isinstance(topology, dict) or "arcs_encoding" not in topology:
        return topology
    if "arcs" in topology:
        raise ValueError("startup topology codec topology cannot contain both arcs and arcs_encoding")
    descriptor = topology.get("arcs_encoding")
    if not isinstance(descriptor, dict) or descriptor.get("encoding") != ENCODING:
        raise ValueError("startup topology codec encoding is unsupported")
    if descriptor.get("first_delta_mode") != "first pair stores this arc absolute integer start minus previous nonempty arc start":
        raise ValueError("startup topology codec first-delta mode is unsupported")

    arc_count = _descriptor_count(descriptor, "arc_count", MAX_ARC_COUNT)
    point_count = _descriptor_count(descriptor, "point_count", MAX_POINT_COUNT)
    if arc_count == 0 or point_count == 0:
        raise ValueError("startup topology codec encoded counts must be nonzero")

    lengths = _decode_base64(
        descriptor.get("arc_lengths_u32_le_base64"),
        expected_bytes=arc_count * 4,
        label="arc lengths",
    )
    arc_lengths = [struct.unpack_from("<I", lengths, index * 4)[0] for index in range(arc_count)]
    if sum(arc_lengths) != point_count:
        raise ValueError("startup topology codec point count does not match arc lengths")

    closed_count = 0
    if closed is not None:
        if len(closed) != (arc_count + 7) // 8:
            raise ValueError("startup topology codec closed flags length mismatch")
        for i, length in enumerate(arc_lengths):
            if closed[i // 8] & (1 << (i % 8)):
                if length < 2:
                    raise ValueError("startup topology codec invalid closed arc")
                closed_count += 1
        if arc_count % 8 and closed[-1] >> (arc_count % 8):
            raise ValueError("startup topology codec unused closed flags")
    encoded_points = point_count - closed_count
    max_stream_bytes = encoded_points * 10
    stream_value = descriptor.get("delta_pairs_zigzag_uleb128_base64")
    if not isinstance(stream_value, str) or len(stream_value) > ((max_stream_bytes + 2) // 3) * 4:
        raise ValueError("startup topology codec varint stream is too large")
    if len(stream_value) < ((encoded_points * 2 + 2) // 3) * 4:
        raise ValueError("startup topology codec varint stream is too short")
    stream_bytes = (len(stream_value) // 4) * 3
    if stream_value.endswith("=="):
        stream_bytes -= 2
    elif stream_value.endswith("="):
        stream_bytes -= 1
    stream = _decode_base64(stream_value, expected_bytes=stream_bytes, label="varint stream")

    arcs: list[list[list[int]]] = []
    offset = 0
    previous_start = (0, 0)
    for arc_index, length in enumerate(arc_lengths):
        arc: list[list[int]] = []
        sum_x = sum_y = 0
        for point_index in range(length):
            if closed is not None and point_index == length - 1 and closed[arc_index // 8] & (1 << (arc_index % 8)):
                if not _fits_int32(-sum_x) or not _fits_int32(-sum_y):
                    raise ValueError("startup topology codec closing delta overflow")
                arc.append([-sum_x, -sum_y])
                continue
            dx, offset = _read_varint(stream, offset)
            dy, offset = _read_varint(stream, offset)
            if point_index == 0:
                x = previous_start[0] + dx
                y = previous_start[1] + dy
                if not INT32_MIN <= x <= INT32_MAX or not INT32_MIN <= y <= INT32_MAX:
                    raise ValueError("startup topology codec first-point predictor overflow")
                previous_start = (x, y)
                arc.append([x, y])
            else:
                arc.append([dx, dy])
                sum_x += dx
                sum_y += dy
        arcs.append(arc)
    if offset != len(stream):
        raise ValueError("startup topology codec varint stream has trailing bytes")

    decoded = copy.copy(topology)
    decoded.pop("arcs_encoding")
    decoded["arcs"] = arcs
    return decoded


def _gzip_text(data: bytes | bytearray) -> str:
    return base64.b64encode(gzip.compress(bytes(data), compresslevel=9, mtime=0)).decode("ascii")


def _inflate_text(value: object, expected_bytes: int, label: str) -> bytes:
    # gzip may expand beyond its trailer's ISIZE; bound the read itself too.
    if not isinstance(value, str) or len(value) > ((expected_bytes + (expected_bytes + 999) // 1000 + 1024 + 2) // 3) * 4:
        raise ValueError(f"startup topology codec {label} compressed size is invalid")
    try:
        compressed = base64.b64decode(value, validate=True)
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as source:
            data = source.read(expected_bytes + 1)
    except (ValueError, OSError, EOFError) as exc:
        raise ValueError(f"startup topology codec {label} gzip is invalid") from exc
    if len(data) != expected_bytes:
        raise ValueError(f"startup topology codec {label} decoded length mismatch")
    return data


def _reference_geometries(objects: dict):
    def visit(geometry, depth=0):
        if not isinstance(geometry, dict) or depth > 64:
            raise ValueError("startup topology codec invalid reference geometry")
        if geometry.get("type") == "GeometryCollection":
            for child in geometry.get("geometries", []):
                yield from visit(child, depth + 1)
        elif geometry.get("type") in REFERENCE_DEPTHS and "arcs" in geometry:
            yield geometry, REFERENCE_DEPTHS[geometry["type"]]
    for name in sorted(objects, key=lambda name: name.encode("utf-16-be", errors="surrogatepass")):
        yield from visit(objects[name])


def _encode_references(topology: dict) -> dict:
    objects = topology.get("objects")
    if not isinstance(objects, dict) or "arc_references_encoding" in topology:
        return topology
    objects = copy.deepcopy(objects)
    refs, lengths, signs = bytearray(), bytearray(), bytearray()
    previous = count = containers = 0

    def pack(values, depth):
        nonlocal previous, count, containers
        if not isinstance(values, list) or len(values) > MAX_REFERENCE_COUNT:
            raise ValueError("unsupported arc references")
        containers += 1
        if containers > MAX_REFERENCE_COUNT:
            raise ValueError("too many reference containers")
        _append_varint(len(values), lengths)
        for value in values:
            if depth > 1:
                pack(value, depth - 1)
            else:
                if not _fits_int32(value) or count >= MAX_REFERENCE_COUNT:
                    raise ValueError("unsupported arc reference")
                index = ~value if value < 0 else value
                delta = index - previous
                if not _fits_int32(delta):
                    raise ValueError("unsupported arc reference delta")
                if count % 8 == 0:
                    signs.append(0)
                if value < 0:
                    signs[count // 8] |= 1 << (count % 8)
                _append_varint(delta, refs)
                previous = index
                count += 1

    try:
        geometries = list(_reference_geometries(objects))
        for geometry, depth in geometries:
            pack(geometry["arcs"], depth)
            geometry["arcs"] = None
    except ValueError:
        return topology
    if not geometries:
        return topology
    return {**topology, "objects": objects, "arc_references_encoding": {
        "encoding": REFERENCE_ENCODING, "reference_count": count, "container_count": containers,
        "refs_bytes": len(refs), "lengths_bytes": len(lengths),
        "refs_gzip_base64": _gzip_text(refs), "lengths_gzip_base64": _gzip_text(lengths),
        "signs_gzip_base64": _gzip_text(signs),
    }}


def encode_startup_topology(topology: object) -> object:
    """V7 startup representation: exact closed-ring prediction and signed arc refs."""
    if not isinstance(topology, dict) or topology.get("type") != "Topology":
        return topology
    encoded = encode_topology(topology)
    if encoded is not topology:
        descriptor = encoded["arcs_encoding"]
        closed = bytearray((len(topology["arcs"]) + 7) // 8)
        stream = bytearray()
        px = py = 0
        for index, arc in enumerate(topology["arcs"]):
            is_closed = len(arc) > 1 and sum(p[0] for p in arc[1:]) == 0 and sum(p[1] for p in arc[1:]) == 0
            if is_closed:
                closed[index // 8] |= 1 << (index % 8)
            for i, (x, y) in enumerate(arc[:-1] if is_closed else arc):
                dx, dy = (x - px, y - py) if i == 0 else (x, y)
                if i == 0:
                    px, py = x, y
                _append_varint(dx, stream)
                _append_varint(dy, stream)
        encoded["arcs_encoding"] = {
            "encoding": COMPACT_ENCODING,
            "arc_count": descriptor["arc_count"], "point_count": descriptor["point_count"],
            "delta_bytes": len(stream),
            "lengths_gzip_base64": _gzip_text(base64.b64decode(descriptor["arc_lengths_u32_le_base64"])),
            "closed_gzip_base64": _gzip_text(closed), "deltas_gzip_base64": _gzip_text(stream),
        }
    return _encode_references(encoded)


def decode_topology(topology: object) -> object:
    if not isinstance(topology, dict):
        return topology
    descriptor = topology.get("arcs_encoding")
    if isinstance(descriptor, dict) and descriptor.get("encoding") == COMPACT_ENCODING:
        arc_count = _descriptor_count(descriptor, "arc_count", MAX_ARC_COUNT)
        point_count = _descriptor_count(descriptor, "point_count", MAX_POINT_COUNT)
        delta_bytes = _descriptor_count(descriptor, "delta_bytes", point_count * 10)
        if not arc_count or not point_count:
            raise ValueError("startup topology codec encoded counts must be nonzero")
        lengths = _inflate_text(descriptor.get("lengths_gzip_base64"), arc_count * 4, "arc lengths")
        closed = _inflate_text(descriptor.get("closed_gzip_base64"), (arc_count + 7) // 8, "closed flags")
        deltas = _inflate_text(descriptor.get("deltas_gzip_base64"), delta_bytes, "deltas")
        topology = _decode_delta_topology({**topology, "arcs_encoding": {
            "encoding": ENCODING, "arc_count": arc_count, "point_count": point_count,
            "arc_lengths_u32_le_base64": base64.b64encode(lengths).decode("ascii"),
            "delta_pairs_zigzag_uleb128_base64": base64.b64encode(deltas).decode("ascii"),
            "first_delta_mode": "first pair stores this arc absolute integer start minus previous nonempty arc start",
        }}, closed)
    else:
        topology = _decode_delta_topology(topology)
    if "arc_references_encoding" not in topology:
        return topology
    descriptor = topology["arc_references_encoding"]
    if not isinstance(descriptor, dict) or descriptor.get("encoding") != REFERENCE_ENCODING:
        raise ValueError("startup topology codec reference encoding unsupported")
    count = _descriptor_count(descriptor, "reference_count", MAX_REFERENCE_COUNT)
    containers = _descriptor_count(descriptor, "container_count", MAX_REFERENCE_COUNT)
    refs_size = _descriptor_count(descriptor, "refs_bytes", count * 5)
    lengths_size = _descriptor_count(descriptor, "lengths_bytes", containers * 5)
    refs = _inflate_text(descriptor.get("refs_gzip_base64"), refs_size, "references")
    lengths = _inflate_text(descriptor.get("lengths_gzip_base64"), lengths_size, "reference lengths")
    signs = _inflate_text(descriptor.get("signs_gzip_base64"), (count + 7) // 8, "reference signs")
    if count % 8 and signs[-1] >> (count % 8):
        raise ValueError("startup topology codec unused reference signs")
    objects = copy.deepcopy(topology.get("objects", {}))
    offset = length_offset = previous = used = used_containers = 0

    def unpack(depth):
        nonlocal offset, length_offset, previous, used, used_containers
        used_containers += 1
        if used_containers > containers:
            raise ValueError("startup topology codec reference container mismatch")
        length, length_offset = _read_varint(lengths, length_offset)
        if length < 0 or length > (containers - used_containers if depth > 1 else count - used):
            raise ValueError("startup topology codec reference length out of range")
        result = []
        for _ in range(length):
            if depth > 1:
                result.append(unpack(depth - 1))
            else:
                delta, offset = _read_varint(refs, offset)
                previous += delta
                if not 0 <= previous < len(topology.get("arcs", [])):
                    raise ValueError("startup topology codec reference index out of range")
                result.append(~previous if signs[used // 8] & (1 << (used % 8)) else previous)
                used += 1
        return result
    for geometry, depth in _reference_geometries(objects):
        if geometry["arcs"] is not None:
            raise ValueError("startup topology codec conflicting arc references")
        geometry["arcs"] = unpack(depth)
    if used != count or used_containers != containers or offset != len(refs) or length_offset != len(lengths):
        raise ValueError("startup topology codec reference stream count or trailing bytes mismatch")
    decoded = {**topology, "objects": objects}
    decoded.pop("arc_references_encoding")
    return decoded
