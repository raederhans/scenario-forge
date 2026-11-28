from __future__ import annotations

import base64
import copy
import gzip
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.startup_topology_codec import (
    ENCODING,
    COMPACT_ENCODING,
    REFERENCE_ENCODING,
    decode_topology,
    encode_topology,
    encode_startup_topology,
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


class StartupTopologyCodecTest(unittest.TestCase):
    def test_v7_fixed_wire_is_lossless_for_closed_arcs_and_nested_signed_references(self) -> None:
        fixture = json.loads((ROOT / "tests/fixtures/startup_topology_v7.json").read_text(encoding="utf-8"))
        source = fixture["source"]
        before = copy.deepcopy(source)
        encoded = encode_startup_topology(source)
        wire_before = copy.deepcopy(encoded)
        self.assertEqual(encoded["arcs_encoding"]["encoding"], COMPACT_ENCODING)
        self.assertEqual(encoded["arc_references_encoding"]["encoding"], REFERENCE_ENCODING)
        self.assertEqual(decode_topology(encoded), source)
        self.assertEqual(decode_topology(fixture["encoded"]), source)
        self.assertEqual(source, before)
        self.assertEqual(encoded, wire_before, "decoding must not mutate the wire input")

    def test_v7_rejects_malformed_closed_flags_gzip_and_delta_lengths(self) -> None:
        encoded = encode_startup_topology(_source_topology())
        mutations = (
            ("closed_gzip_base64", gzip.compress(b"\x80", mtime=0), "unused closed flags"),
            ("closed_gzip_base64", gzip.compress(b"\x04", mtime=0), "invalid closed arc"),
            ("closed_gzip_base64", gzip.compress(b"\x00\x00", mtime=0), "decoded length"),
            ("lengths_gzip_base64", b"not gzip", "gzip is invalid"),
        )
        for field, data, message in mutations:
            with self.subTest(field=field, message=message):
                candidate = copy.deepcopy(encoded)
                candidate["arcs_encoding"][field] = base64.b64encode(data).decode("ascii")
                with self.assertRaisesRegex(ValueError, message):
                    decode_topology(candidate)
        for delta_bytes in (-1, True, encoded["arcs_encoding"]["point_count"] * 10 + 1):
            candidate = copy.deepcopy(encoded)
            candidate["arcs_encoding"]["delta_bytes"] = delta_bytes
            with self.assertRaisesRegex(ValueError, "delta_bytes is invalid"):
                decode_topology(candidate)

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


if __name__ == "__main__":
    unittest.main()
