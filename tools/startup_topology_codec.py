"""Lossless private wire encoding for transformed startup Topology arcs.

The encoded descriptor is only used inside startup bundles. Call
``decode_topology`` before passing a bundle topology to TopoJSON consumers.
"""

from __future__ import annotations

import base64
import binascii
import copy
import math
import struct
from typing import Any


ENCODING = "topology-delta-zigzag-uleb128-cross-arc-origin-v1"
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


def decode_topology(topology: object) -> object:
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

    max_stream_bytes = point_count * 10
    stream_value = descriptor.get("delta_pairs_zigzag_uleb128_base64")
    if not isinstance(stream_value, str) or len(stream_value) > ((max_stream_bytes + 2) // 3) * 4:
        raise ValueError("startup topology codec varint stream is too large")
    if len(stream_value) < ((point_count * 2 + 2) // 3) * 4:
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
    for length in arc_lengths:
        arc: list[list[int]] = []
        for point_index in range(length):
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
        arcs.append(arc)
    if offset != len(stream):
        raise ValueError("startup topology codec varint stream has trailing bytes")

    decoded = copy.copy(topology)
    decoded.pop("arcs_encoding")
    decoded["arcs"] = arcs
    return decoded
