import json
import tempfile
import unittest
from pathlib import Path

from map_builder.processors.contour_lod import build_lod as build, decode_topology


class BuildContourLodAssetsTest(unittest.TestCase):
    def test_decode_preserves_negative_arc_direction_and_properties(self):
        payload = {
            "type": "Topology",
            "transform": {"scale": [1, 1], "translate": [0, 0]},
            "arcs": [[[0, 0], [1, 0]], [[0, 1], [1, 0]]],
            "objects": {"contours": {"type": "GeometryCollection", "geometries": [
                {"type": "LineString", "arcs": [0], "properties": {"elevation_m": 1000, "source": "x"}},
                {"type": "LineString", "arcs": [-2], "properties": {"elevation_m": 500, "source": "x"}},
            ]}},
        }
        gdf = decode_topology(payload, "contours")
        self.assertEqual(list(gdf["elevation_m"]), [1000, 500])
        self.assertEqual(list(gdf.iloc[1].geometry.coords), [(1, 1), (0, 1)])
        self.assertTrue(all(gdf["source"] == "x"))

    def test_build_filters_elevation_and_keeps_valid_lines(self):
        source = {
            "type": "Topology", "transform": {"scale": [1, 1], "translate": [0, 0]},
            "arcs": [[[0, 0], [1, 0]], [[0, 1], [1, 0]]],
            "objects": {"contours": {"type": "GeometryCollection", "geometries": [
                {"type": "LineString", "arcs": [0], "properties": {"elevation_m": 1000}},
                {"type": "LineString", "arcs": [1], "properties": {"elevation_m": 500}},
            ]}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "source.json", Path(tmp) / "out.json"
            src.write_text(json.dumps(source), encoding="utf-8")
            stats = build(src, dst, 0.1, 1000)
            self.assertEqual(src.read_text(encoding="utf-8"), json.dumps(source))
            self.assertEqual(stats["features"], 1)
            self.assertGreater(stats["bytes"], 0)
            output = json.loads(dst.read_text(encoding="utf-8"))
            self.assertEqual(output["objects"]["contours"]["geometries"][0]["properties"]["elevation_m"], 1000)

    def test_closed_line_with_no_area_is_dropped_after_simplification(self):
        source = {"type": "Topology", "transform": {"scale": [1, 1], "translate": [0, 0]},
                  "arcs": [[[0, 0], [0, 0], [0, 0]]],
                  "objects": {"contours": {"type": "GeometryCollection", "geometries": [
                      {"type": "LineString", "arcs": [0], "properties": {"elevation_m": 1000}}
                  ]}}}
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "source.json", Path(tmp) / "out.json"
            src.write_text(json.dumps(source), encoding="utf-8")
            self.assertEqual(build(src, dst, 0.1, 1000)["features"], 0)

    def test_joined_arcs_share_one_endpoint(self):
        payload = {
            "transform": {"scale": [1, 1], "translate": [0, 0]},
            "arcs": [[[0, 0], [1, 0]], [[1, 0], [1, 1]]],
            "objects": {"contours": {"geometries": [
                {"type": "LineString", "arcs": [0, 1], "properties": {"elevation_m": 500}},
            ]}},
        }
        geometry = decode_topology(payload, "contours").iloc[0].geometry
        self.assertEqual(list(geometry.coords), [(0, 0), (1, 0), (2, 1)])


if __name__ == "__main__":
    unittest.main()
