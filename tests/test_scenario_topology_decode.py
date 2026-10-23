from __future__ import annotations

import copy
import json
import unittest
from unittest.mock import patch

from topojson.utils import serialize_as_geojson
from tools.scenario_topology_decode import topology_object_to_geojson


class ScenarioTopologyDecodeTest(unittest.TestCase):
    def test_water_fixture_loaders_match_library_without_padded_allocation(self):
        from tests import test_tno_water_geometries as water

        payload = {"type": "Topology", "arcs": [
            [[0, 0], [0, 1], [1, 1], [0, 0]],
            [[i / 1000, 0] for i in range(2000)],
        ], "objects": {name: {"type": "GeometryCollection", "geometries": [
            {"type": "Polygon", "arcs": [[0]], "properties": {"id": name}},
        ]} for name in ("political", "scenario_water", "land_mask")}}
        before = copy.deepcopy(payload)
        expected = {name: serialize_as_geojson(payload, objectname=name)
                    for name in payload["objects"]}
        with patch.object(water, "read_json_source", return_value=payload), \
             patch.object(type(water.RUNTIME_BOOTSTRAP_WATER_PATH), "read_text", return_value=json.dumps(payload)), \
             patch("topojson.utils.np_array_from_arcs", side_effect=AssertionError("padded allocation")):
            self.assertEqual(water._load_runtime_water_features(), expected["scenario_water"]["features"])
            self.assertEqual(water._load_runtime_bootstrap_water_features(), expected["scenario_water"]["features"])
            self.assertEqual(water._load_runtime_political_features(), expected["political"]["features"])
            self.assertEqual(water._load_runtime_topology_feature_collection("land_mask"), expected["land_mask"])
        self.assertEqual(payload, before)

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

    def test_landing_builders_do_not_pad_refined_water_arcs(self):
        import tempfile
        from pathlib import Path
        from tools import build_landing_europe_1936_showcase

        payload = {"type": "Topology", "arcs": [
            [[0, 0], [0, 1], [1, 1], [0, 0]],
            [[i / 1000, 0] for i in range(2000)],
        ], "objects": {"political": {"type": "GeometryCollection", "geometries": [
            {"type": "Polygon", "arcs": [[0]], "properties": {"id": "land"}},
        ]}}}
        expected = serialize_as_geojson(payload, objectname="political")["features"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "topology.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with patch("topojson.utils.np_array_from_arcs", side_effect=AssertionError("padded allocation")):
                for builder in (build_landing_europe_1936_showcase,):
                    with self.subTest(builder=builder.__name__):
                        self.assertEqual(builder.topology_features(path, "political"), expected)

    def test_empty_and_point_only_topology(self):
        for geometries in ([], [{"type": "Point", "coordinates": [1, 2]}]):
            payload = {"arcs": [], "objects": {"p": {"type": "GeometryCollection", "geometries": geometries}}}
            self.assertEqual(topology_object_to_geojson(payload, "p"), serialize_as_geojson(payload, objectname="p"))


if __name__ == "__main__":
    unittest.main()
