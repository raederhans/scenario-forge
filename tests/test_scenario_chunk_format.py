"""Lossless coarse political chunk format conversions."""
from __future__ import annotations

import copy
import math
import unittest

from tools.scenario_chunk_format import decode_political_chunk, feature_collection_to_topology


def feature(fid, geometry, **metadata):
    return {"type": "Feature", "id": fid, "properties": {"label": fid}, "geometry": geometry, **metadata}


class ScenarioChunkFormatTests(unittest.TestCase):
    def test_encoder_round_trips_polygons_holes_multipolygons_and_nulls_exactly(self):
        first = feature("first", {"type": "Polygon", "coordinates": [
            [[-0.0, 0.0], [1, 0], [1, 1], [-0.0, 0.0]],
            [[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.2]],
        ]}, bbox=[-0.0, 0, 1, 1])
        second = feature("second", {"type": "MultiPolygon", "coordinates": [[
            [[2, 0], [3, 0], [3, 1], [2, 0]],
        ], [
            [[4, 0], [5, 0], [5, 1], [4, 0]],
            [[4.2, 0.2], [4.3, 0.2], [4.3, 0.3], [4.2, 0.2]],
        ]]})
        third = feature("empty", None)
        source = {"type": "FeatureCollection", "features": [first, second, third]}
        original = copy.deepcopy(source)

        topology = feature_collection_to_topology(source)
        decoded = decode_political_chunk(topology)

        self.assertEqual(decoded, source)
        self.assertEqual(topology["objects"]["political"]["geometries"][0]["bbox"], first["bbox"])
        self.assertEqual([g.get("id") for g in topology["objects"]["political"]["geometries"]],
                         ["first", "second", "empty"])
        self.assertEqual(source, original)
        self.assertEqual(math.copysign(1, decoded["features"][0]["geometry"]["coordinates"][0][0][0]), -1)

    def test_direct_feature_collection_returns_same_object(self):
        payload = {"type": "FeatureCollection", "features": []}
        self.assertIs(decode_political_chunk(payload), payload)

    def test_encoder_accepts_shapely_style_tuple_coordinates(self):
        payload = {"type": "FeatureCollection", "features": [feature("tuple", {
            "type": "Polygon", "coordinates": (
                ((0, 0), (1, 0), (1, 1), (0, 0)),
            ),
        })]}
        topology = feature_collection_to_topology(payload)
        self.assertEqual(topology["arcs"], [[ [0, 0], [1, 0], [1, 1], [0, 0] ]])

    def test_decoder_concatenates_arcs_and_reverses_negative_reference(self):
        # Arc 1 is stored opposite the ring direction; -2 is its reversed index.
        topology = {"type": "Topology", "arcs": [
            [[0, 0], [1, 0], [1, 1]],
            [[0, 0], [0, 1], [1, 1]],
        ], "objects": {"political": {"type": "GeometryCollection", "geometries": [
            {"type": "Polygon", "arcs": [[0, -2]], "id": "joined", "properties": {"k": 1}},
        ]}}}
        result = decode_political_chunk(topology)
        self.assertEqual(result["features"][0]["geometry"]["coordinates"][0],
                         [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])

    def test_internal_repeated_segment_points_are_preserved(self):
        ring = [[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]]
        topology = {"type": "Topology", "arcs": [ring], "objects": {"political": {
            "type": "GeometryCollection", "geometries": [{"type": "Polygon", "arcs": [[0]]}],
        }}}
        self.assertEqual(decode_political_chunk(topology)["features"][0]["geometry"]["coordinates"][0], ring)

    def test_encoder_rejects_unrepresentable_or_lossy_inputs(self):
        good_ring = [[0, 0], [1, 0], [1, 1], [0, 0]]
        cases = [
            ({"type": "FeatureCollection", "features": [], "name": "loss"}, "unsupported member"),
            ({"type": "FeatureCollection", "features": [feature("x", {"type": "LineString", "coordinates": good_ring})]}, "only Polygon"),
            ({"type": "FeatureCollection", "features": [feature("x", {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1]]]})]}, "at least four"),
            ({"type": "FeatureCollection", "features": [feature("x", {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [float('nan'), 0]]]})]}, "finite number"),
        ]
        for payload, expected in cases:
            with self.subTest(expected=expected), self.assertRaisesRegex(ValueError, expected):
                feature_collection_to_topology(payload)

    def test_decoder_rejects_bad_shapes_indices_transforms_and_short_arcs(self):
        base = {"type": "Topology", "arcs": [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                "objects": {"political": {"type": "GeometryCollection", "geometries": [
                    {"type": "Polygon", "arcs": [[0]]},
                ]}}}
        cases = []
        transformed = copy.deepcopy(base)
        transformed["transform"] = {"scale": [1, 1], "translate": [0, 0]}
        cases.append((transformed, "transformed Topology"))
        bad_index = copy.deepcopy(base)
        bad_index["objects"]["political"]["geometries"][0]["arcs"] = [[8]]
        cases.append((bad_index, "out of range"))
        short_arc = copy.deepcopy(base)
        short_arc["arcs"] = [[[0, 0]]]
        cases.append((short_arc, "at least two positions"))
        bad_object = copy.deepcopy(base)
        bad_object["objects"]["other"] = bad_object["objects"].pop("political")
        cases.append((bad_object, "exactly the 'political'"))
        for topology, expected in cases:
            with self.subTest(expected=expected), self.assertRaisesRegex(ValueError, expected):
                decode_political_chunk(topology)


if __name__ == "__main__":
    unittest.main()
