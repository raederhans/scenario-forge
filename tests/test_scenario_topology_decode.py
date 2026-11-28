from __future__ import annotations

import copy
import json
import unittest
from unittest.mock import patch

from topojson.utils import serialize_as_geojson
from tools.scenario_topology_decode import topology_object_to_geojson


class ScenarioTopologyDecodeTest(unittest.TestCase):
    def test_matches_library_bytes_without_mutating_input(self):
        geometries = [
            {"type": "Polygon", "arcs": [[0, 1]], "id": "a", "properties": {"name": "日本"}},
            {"type": "MultiPolygon", "arcs": [[[~1, ~0]]]},
            {"type": "LineString", "arcs": [0, 1]},
            {"type": "MultiLineString", "arcs": [[0], [~1]]},
            {"type": "Point", "coordinates": [3, 4]},
            {"type": "MultiPoint", "coordinates": [[1, 2], [3, 4]]},
            {"type": "GeometryCollection", "geometries": [{"type": "LineString", "arcs": [0]}]},
        ]
        for quantized in (False, True):
            with self.subTest(quantized=quantized):
                payload = {"type": "Topology", "arcs": [
                    [[0, 0], [2, 0], [2, 2]], [[2, 2], [0, 2], [0, 0]],
                    [[i, i] for i in range(100)],
                ], "objects": {"political": {"type": "GeometryCollection", "geometries": geometries}}}
                if quantized:
                    payload["transform"] = {"scale": [0.1, 0.2], "translate": [-10, 20]}
                before = copy.deepcopy(payload)
                expected = serialize_as_geojson(payload, objectname="political")
                with patch("topojson.utils.np_array_from_arcs", side_effect=AssertionError("padded allocation")):
                    actual = topology_object_to_geojson(payload, "political")
                self.assertEqual(json.dumps(actual, ensure_ascii=False), json.dumps(expected, ensure_ascii=False))
                self.assertEqual(payload, before)

    def test_empty_and_point_only_topology(self):
        for geometries in ([], [{"type": "Point", "coordinates": [1, 2]}]):
            payload = {"arcs": [], "objects": {"p": {"type": "GeometryCollection", "geometries": geometries}}}
            self.assertEqual(topology_object_to_geojson(payload, "p"), serialize_as_geojson(payload, objectname="p"))


if __name__ == "__main__":
    unittest.main()
