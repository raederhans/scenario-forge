from copy import deepcopy
import json
import math
import unittest
from unittest.mock import patch

from tools.lossless_topology import (
    compact_large_runtime_topology,
    optimize_topology,
)


def _line(ref, *, line_id=None):
    geometry = {"type": "LineString", "arcs": [ref]}
    if line_id is not None:
        geometry.update({"id": line_id, "properties": {"line_id": line_id, "kept": True}})
    return geometry


def _collection(*geometries):
    return {"type": "GeometryCollection", "geometries": list(geometries)}


def _decode_line(topology, geometry):
    points = []
    for ref in geometry["arcs"]:
        arc_id = ref if ref >= 0 else -ref - 1
        part = topology["arcs"][arc_id]
        if ref < 0:
            part = list(reversed(part))
        points.extend(part if not points else part[1:])
    return points


class LosslessTopologyTests(unittest.TestCase):
    def test_reverse_and_overlapping_subarcs_reconstruct_exactly(self):
        topology = {
            "type": "Topology",
            "objects": {
                "lines": _collection(
                    _line(0, line_id="forward"),
                    _line(1, line_id="reverse-overlap"),
                )
            },
            "arcs": [
                [[0, 0], [1, 0], [2, 0], [3, 0]],
                [[2, 0], [1, 0], [0, 0], [-1, 0]],
            ],
        }

        candidate, diagnostics = optimize_topology(topology, preserve_arc_identity=False)
        geometries = candidate["objects"]["lines"]["geometries"]

        self.assertEqual(_decode_line(candidate, geometries[0]), topology["arcs"][0])
        self.assertEqual(_decode_line(candidate, geometries[1]), topology["arcs"][1])
        forward_refs = geometries[0]["arcs"]
        reverse_refs = geometries[1]["arcs"]
        forward_ids = {ref if ref >= 0 else -ref - 1 for ref in forward_refs}
        reverse_ids = {ref if ref >= 0 else -ref - 1 for ref in reverse_refs}
        self.assertTrue(forward_ids & reverse_ids)
        self.assertTrue(any(ref < 0 for ref in reverse_refs))
        self.assertTrue(diagnostics["exact_arc_reconstruction"])

    def test_default_domains_preserve_same_object_arc_identity(self):
        path = [[0, 0], [1, 0], [2, 0]]
        topology = {
            "type": "Topology",
            "objects": {
                "political": _collection(_line(0, line_id="first"), _line(0, line_id="same-source"),
                                         _line(1, line_id="distinct-source")),
            },
            "arcs": [deepcopy(path), deepcopy(path)],
        }

        candidate, diagnostics = optimize_topology(topology)
        geometries = candidate["objects"]["political"]["geometries"]
        same_source_refs = geometries[0]["arcs"]
        repeated_use_refs = geometries[1]["arcs"]
        distinct_source_refs = geometries[2]["arcs"]

        self.assertEqual(same_source_refs, repeated_use_refs)
        self.assertNotEqual(
            {ref if ref >= 0 else -ref - 1 for ref in same_source_refs},
            {ref if ref >= 0 else -ref - 1 for ref in distinct_source_refs},
        )
        self.assertTrue(diagnostics["preserve_arc_identity"])

    def test_negative_zero_is_distinct_and_input_is_not_mutated(self):
        topology = {
            "type": "Topology",
            "objects": {
                "political": _collection(_line(0)),
                "land_mask": _collection(_line(1)),
            },
            "arcs": [
                [[-0.0, 0.0], [1.0, 0.0]],
                [[0.0, 0.0], [1.0, 0.0]],
            ],
        }
        original = deepcopy(topology)

        candidate, _ = optimize_topology(topology)

        self.assertEqual(topology, original)
        self.assertEqual(len(candidate["arcs"]), 2)
        negative_line = candidate["objects"]["political"]["geometries"][0]
        positive_line = candidate["objects"]["land_mask"]["geometries"][0]
        negative_x = _decode_line(candidate, negative_line)[0][0]
        positive_x = _decode_line(candidate, positive_line)[0][0]
        self.assertLess(math.copysign(1.0, negative_x), 0)
        self.assertGreater(math.copysign(1.0, positive_x), 0)
        candidate["arcs"][0][0][0] = 77.0
        self.assertLess(math.copysign(1.0, topology["arcs"][0][0][0]), 0)

    def test_compact_runtime_payload_fails_closed_when_lossless_result_is_too_large(self):
        topology = {"type": "Topology", "objects": {}, "arcs": []}
        candidate = {"padding": "x" * 26}
        source_size = len(
            (json.dumps(topology, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        )
        candidate_size = len(
            (json.dumps(candidate, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        )
        self.assertLess(candidate_size, source_size)
        with patch("tools.lossless_topology.optimize_topology", return_value=(candidate, {})):
            with self.assertRaisesRegex(ValueError, "split the payload"):
                compact_large_runtime_topology(topology, max_bytes=candidate_size)


if __name__ == "__main__":
    unittest.main()
