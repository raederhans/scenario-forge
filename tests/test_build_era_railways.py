import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.build_era_railways import LandSnapper, PixelGeoreference, haversine_km, parse_railways


class EraRailwaySourceParsingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name: str, text: str) -> Path:
        path = self.root / name
        path.write_text(text, encoding="utf-8")
        return path

    def test_parse_railways_reads_level_and_province_chain(self):
        path = self.write("railways.txt", "3 4 6521 11444 3312 6282 \n# 注释\n\n1 2 3326 241\n")
        segments = parse_railways(path)
        self.assertEqual([(s.level, s.province_ids) for s in segments], [(3, (6521, 11444, 3312, 6282)), (1, (3326, 241))])


class PixelGeoreferenceTest(unittest.TestCase):
    def test_recovers_smooth_mapping_and_drops_mismatched_control_point(self):
        rng = np.random.default_rng(1)
        xs = rng.uniform(0, 5632, 300)
        ys = rng.uniform(200, 1800, 300)

        def truth(x, y):
            lon = x * 360.0 / 5632 - 180.0
            lat = 80.0 - y * 0.08 + 0.000004 * (y - 1000) ** 2
            return lon, lat

        controls = []
        for index, (x, y) in enumerate(zip(xs, ys)):
            lon, lat = truth(x, y)
            controls.append({"province_id": index, "name": f"p{index}", "x": x, "y": y, "lon": lon, "lat": lat})
        # 模拟名称误匹配：坐标被放到地球另一侧。
        controls[0] = {**controls[0], "name": "mismatch", "lon": controls[0]["lon"] + 90.0}

        georef = PixelGeoreference(controls)
        self.assertIn("mismatch", georef.stats["dropped_control_points"])
        probe = np.array([[1000.0, 900.0], [4000.0, 1500.0]])
        predicted = georef.to_lonlat(probe)
        for (x, y), (lon, lat) in zip(probe, predicted):
            expected_lon, expected_lat = truth(x, y)
            self.assertLess(float(haversine_km(lon, lat, expected_lon, expected_lat)), 5.0)


class LandSnapperTest(unittest.TestCase):
    def test_atlantropa_sea_polygons_are_not_treated_as_land(self):
        # 两个相邻方块：x∈[0,1] 为新陆地（盐碱地），x∈[1,2] 为残余海面。
        topology = {
            "type": "Topology",
            "arcs": [
                [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
                [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]],
            ],
            "objects": {
                "scenario_atlantropa": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "arcs": [[0]], "properties": {"id": "land", "atl_surface_kind": "salt_flat_land"}},
                        {"type": "Polygon", "arcs": [[1]], "properties": {"id": "sea", "atl_surface_kind": "sea"}},
                    ],
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "topology.json"
            path.write_text(json.dumps(topology), encoding="utf-8")
            snapper = LandSnapper(path, ("political", "scenario_atlantropa"))
        self.assertTrue(snapper.is_land(0.5, 0.5))
        self.assertFalse(snapper.is_land(1.5, 0.5))
        (lon, _lat), moved = snapper.snap(1.5, 0.5)
        self.assertTrue(moved)
        self.assertLess(lon, 1.0)


if __name__ == "__main__":
    unittest.main()
