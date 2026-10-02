from __future__ import annotations

import base64
import copy
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.startup_topology_codec import (
    ENCODING,
    _append_varint,
    decode_topology,
    encode_topology,
)


def _source_topology() -> dict:
    return {
        "type": "Topology",
        "transform": {"scale": [0.1, 0.1], "translate": [-180.0, -90.0], "vendor": "preserved"},
        "bbox": [-180.0, -90.0, 180.0, 90.0],
        "objects": {
            "water_regions": {
                "type": "GeometryCollection",
                "geometries": [
                    {"type": "LineString", "properties": {"id": "water-1", "source": "SeaVoX"}, "arcs": [0]},
                    {"type": "LineString", "properties": {"id": "water-2"}, "arcs": [1]},
                ],
            },
        },
        "arcs": [
            [[12, -5], [4, 0], [-2, 3]],
            [[15, -7], [0, 1]],
            [],
        ],
        "source": {"version": "fixture", "citation": "kept unchanged"},
    }


def _encoded_from_delta_arcs(arcs: list[list[list[int]]]) -> dict:
    lengths = bytearray(len(arcs) * 4)
    stream = bytearray()
    point_count = 0
    for arc_index, arc in enumerate(arcs):
        struct.pack_into("<I", lengths, arc_index * 4, len(arc))
        point_count += len(arc)
        for dx, dy in arc:
            _append_varint(dx, stream)
            _append_varint(dy, stream)
    return {
        "type": "Topology",
        "transform": {"scale": [1, 1], "translate": [0, 0]},
        "objects": {},
        "arcs_encoding": {
            "encoding": ENCODING,
            "arc_count": len(arcs),
            "point_count": point_count,
            "arc_lengths_u32_le_base64": base64.b64encode(lengths).decode("ascii"),
            "delta_pairs_zigzag_uleb128_base64": base64.b64encode(stream).decode("ascii"),
            "first_delta_mode": "first pair stores this arc absolute integer start minus previous nonempty arc start",
        },
    }


class StartupTopologyCodecTest(unittest.TestCase):
    def test_encode_decode_is_lossless_and_preserves_topology_metadata(self) -> None:
        source = _source_topology()
        encoded = encode_topology(source)

        self.assertIsNot(encoded, source)
        self.assertNotIn("arcs", encoded)
        self.assertEqual(encoded["arcs_encoding"]["encoding"], ENCODING)
        self.assertEqual(encoded["arcs_encoding"]["arc_count"], 3)
        self.assertEqual(encoded["arcs_encoding"]["point_count"], 5)
        decoded = decode_topology(encoded)
        self.assertEqual(decoded, source)
        self.assertEqual(decoded["objects"], source["objects"])
        self.assertEqual(decoded["transform"], source["transform"])
        self.assertEqual(decoded["source"], source["source"])

    def test_legacy_topologies_and_unsupported_arcs_are_unchanged(self) -> None:
        source = _source_topology()
        source.pop("transform")
        self.assertIs(encode_topology(source), source)
        self.assertIs(decode_topology(source), source)

        wrong_type = _source_topology()
        wrong_type["type"] = "FeatureCollection"
        self.assertIs(encode_topology(wrong_type), wrong_type)

        for unsupported_arc in (
            [[-0.0, 0]],
            [[1.0, 0]],
            [[1, 2, 3]],
            [[2**31, 0]],
            [[True, 0]],
        ):
            candidate = _source_topology()
            candidate["arcs"] = [unsupported_arc]
            self.assertIs(encode_topology(candidate), candidate)

        predictor_overflow = _source_topology()
        predictor_overflow["arcs"] = [[[-100, 0]], [[2**31 - 1, 0]]]
        self.assertIs(encode_topology(predictor_overflow), predictor_overflow)

    def test_decoder_rejects_unknown_encoding_and_inconsistent_counts(self) -> None:
        encoded = encode_topology(_source_topology())
        unknown = copy.deepcopy(encoded)
        unknown["arcs_encoding"]["encoding"] = "future-codec"
        with self.assertRaisesRegex(ValueError, "unsupported"):
            decode_topology(unknown)

        contradictory = copy.deepcopy(encoded)
        contradictory["arcs"] = []
        with self.assertRaisesRegex(ValueError, "both arcs"):
            decode_topology(contradictory)

        wrong_count = copy.deepcopy(encoded)
        wrong_count["arcs_encoding"]["point_count"] += 1
        with self.assertRaisesRegex(ValueError, "point count"):
            decode_topology(wrong_count)

        invalid_base64 = copy.deepcopy(encoded)
        invalid_base64["arcs_encoding"]["arc_lengths_u32_le_base64"] = "%%%"
        with self.assertRaisesRegex(ValueError, "arc lengths"):
            decode_topology(invalid_base64)

    def test_decoder_rejects_truncated_trailing_and_unsafe_predictor_data(self) -> None:
        encoded = encode_topology(_source_topology())
        truncated = copy.deepcopy(encoded)
        stream = base64.b64decode(truncated["arcs_encoding"]["delta_pairs_zigzag_uleb128_base64"])
        truncated["arcs_encoding"]["delta_pairs_zigzag_uleb128_base64"] = base64.b64encode(stream[:-1]).decode("ascii")
        with self.assertRaises(ValueError):
            decode_topology(truncated)

        trailing = copy.deepcopy(encoded)
        stream = base64.b64decode(trailing["arcs_encoding"]["delta_pairs_zigzag_uleb128_base64"])
        trailing["arcs_encoding"]["delta_pairs_zigzag_uleb128_base64"] = base64.b64encode(stream + b"\x00").decode("ascii")
        with self.assertRaisesRegex(ValueError, "trailing"):
            decode_topology(trailing)

        overflow = _encoded_from_delta_arcs([
            [[100, 0]],
            [[2_147_483_548, 0]],
        ])
        with self.assertRaisesRegex(ValueError, "predictor overflow"):
            decode_topology(overflow)


if __name__ == "__main__":
    unittest.main()
