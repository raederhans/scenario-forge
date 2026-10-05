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

    def test_political_and_atlantropa_alias_share_domain_but_other_objects_can_share(self):
        path = [[0, 0], [1, 0], [2, 0]]
        topology = {
            "type": "Topology",
            "objects": {
                "political": _collection(_line(0)),
                "scenario_atlantropa": _collection(_line(1)),
                "land_mask": _collection(_line(2)),
            },
            "arcs": [deepcopy(path), deepcopy(path), deepcopy(path)],
        }

        candidate, diagnostics = optimize_topology(topology)
        political = candidate["objects"]["political"]["geometries"][0]["arcs"]
        atlantropa = candidate["objects"]["scenario_atlantropa"]["geometries"][0]["arcs"]
        land = candidate["objects"]["land_mask"]["geometries"][0]["arcs"]
        arc_id = lambda refs: refs[0] if refs[0] >= 0 else -refs[0] - 1

        self.assertEqual(arc_id(political), arc_id(land))
        self.assertNotEqual(arc_id(political), arc_id(atlantropa))
        self.assertEqual(
            diagnostics["consumer_domains"]["political"],
            diagnostics["consumer_domains"]["scenario_atlantropa"],
        )

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

    def test_transformed_or_invalid_topology_is_rejected(self):
        topology = {
            "type": "Topology",
            "transform": {"scale": [1, 1], "translate": [0, 0]},
            "objects": {"political": _collection(_line(0))},
            "arcs": [[[0, 0], [1, 0]]],
        }
        with self.assertRaisesRegex(ValueError, "transformed"):
            optimize_topology(topology)

        topology.pop("transform")
        topology["objects"]["political"]["geometries"][0]["arcs"] = [9]
        with self.assertRaisesRegex(ValueError, "missing arc"):
            optimize_topology(topology)

    def test_positions_require_at_least_two_ordinates(self):
        topology = {
            "type": "Topology",
            "objects": {"political": _collection(_line(0))},
            "arcs": [[[0], [1, 0]]],
        }
        with self.assertRaisesRegex(ValueError, "at least two ordinates"):
            optimize_topology(topology)

    def test_small_runtime_payload_returns_the_same_object_without_optimization(self):
        topology = {"type": "Topology", "objects": {}, "arcs": []}
        with patch("tools.lossless_topology.optimize_topology") as optimize:
            result = compact_large_runtime_topology(topology, max_bytes=1000)
        self.assertIs(result, topology)
        optimize.assert_not_called()

    def test_oversized_runtime_payload_uses_a_smaller_lossless_candidate(self):
        topology = {"type": "Topology", "objects": {}, "arcs": []}
        source_size = len(
            (json.dumps(topology, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        )
        candidate = {"arcs": []}
        with patch("tools.lossless_topology.optimize_topology", return_value=(candidate, {})) as optimize:
            result = compact_large_runtime_topology(topology, max_bytes=source_size)
        self.assertIs(result, candidate)
        optimize.assert_called_once_with(topology, preserve_arc_identity=True)

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

    def test_gzip_storage_is_explicit_and_returns_standard_topology(self):
        topology = {"type": "Topology", "objects": {}, "arcs": [], "padding": "x" * 2000}
        with patch("tools.lossless_topology.optimize_topology", return_value=(deepcopy(topology), {})):
            with self.assertRaisesRegex(ValueError, "split the payload"):
                compact_large_runtime_topology(topology, max_bytes=200)
            result = compact_large_runtime_topology(topology, max_bytes=200, allow_gzip_storage=True)
            self.assertIs(result, topology)
            with self.assertRaisesRegex(ValueError, "gzip storage"):
                compact_large_runtime_topology(topology, max_bytes=1, allow_gzip_storage=True)

    def test_gzip_storage_repeated_calls_preserve_arc_identity_without_optimization(self):
        ring = [[0, 0], [1.1234567890123, 0], [1, 1], [0, 0]]
        topology = {"type": "Topology", "objects": {
            "land_mask": {"type": "MultiPolygon", "arcs": [[[0]], [[1]]]},
            "context_land_mask": {"type": "MultiPolygon", "arcs": [[[2]], [[-4]]]},
        }, "arcs": [deepcopy(ring) for _ in range(4)], "padding": "x" * 2000}
        original = deepcopy(topology)
        with patch("tools.lossless_topology.optimize_topology", side_effect=AssertionError("must preserve source arcs")) as optimize:
            first = compact_large_runtime_topology(topology, max_bytes=300, allow_gzip_storage=True)
            second = compact_large_runtime_topology(first, max_bytes=300, allow_gzip_storage=True)
        self.assertIs(first, topology)
        self.assertIs(second, topology)
        self.assertEqual(second, original)
        optimize.assert_not_called()


if __name__ == "__main__":
    unittest.main()
