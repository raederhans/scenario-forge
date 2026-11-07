import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.build_era_railways import (
    ModCylindricalGeoreference,
    PixelGeoreference,
    haversine_km,
    parse_province_anchors,
    parse_railways,
    parse_supply_nodes,
    register_scenario_manifest,
)


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

    def test_parse_railways_rejects_count_mismatch(self):
        path = self.write("railways.txt", "2 3 1 2\n")
        with self.assertRaises(ValueError):
            parse_railways(path)

    def test_parse_supply_nodes_dedupes_in_order(self):
        path = self.write("supply_nodes.txt", "1 67\n1 101\n1 67\n")
        self.assertEqual(parse_supply_nodes(path), [67, 101])

    def test_province_anchor_uses_type_38_and_flips_vertical_axis(self):
        path = self.write(
            "unitstacks.txt",
            "9904;0;3006.00;10.32;1360.00;0.00;0.24\n9904;38;3006.00;10.50;1358.66;-1.57;0.24\n",
        )
        anchors = parse_province_anchors(path, map_height=2048)
        self.assertEqual(set(anchors), {9904})
        x, y = anchors[9904]
        self.assertAlmostEqual(x, 3006.0)
        self.assertAlmostEqual(y, 2048 - 1358.66)

    def test_register_scenario_manifest_keeps_sorted_keys_and_is_idempotent(self):
        path = self.write("manifest.json", json.dumps({"audit_url": "a", "featured_tags": []}, indent=2) + "\n")
        register_scenario_manifest(path, "data/transport_layers/x/era_rail.geojson")
        first = path.read_text(encoding="utf-8")
        self.assertEqual(list(json.loads(first)), ["audit_url", "era_railways_url", "featured_tags"])
        register_scenario_manifest(path, "data/transport_layers/x/era_rail.geojson")
        self.assertEqual(path.read_text(encoding="utf-8"), first)


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


class ModCylindricalGeoreferenceTest(unittest.TestCase):
    def test_reuses_unchanged_provinces_and_fits_latitude_from_y(self):
        width, height = 5120, 2560
        rng = np.random.default_rng(2)

        def mod_lat(y):
            return 85.0 - 170.0 * (y / height) ** 1.1

        mod_anchors, vanilla_positions = {}, {}
        for pid in range(1, 1201):
            x, y = rng.uniform(0, width), rng.uniform(100, height - 100)
            mod_anchors[pid] = (x, y)
            vanilla_positions[pid] = (x / width * 360.0 - 180.0, mod_lat(y))
        # ID 被模组重用到别处：位置与原版经度不一致，应被排除。
        for pid in range(1, 51):
            lon, lat = vanilla_positions[pid]
            vanilla_positions[pid] = ((lon + 200.0 + 180.0) % 360.0 - 180.0, lat)

        model = ModCylindricalGeoreference(mod_anchors, vanilla_positions, width=width)
        self.assertTrue(set(range(1, 51)).isdisjoint(model.consistent_ids))
        self.assertGreaterEqual(len(model.consistent_ids), 1100)
        lon, lat = model.to_lonlat(2560.0, 1000.0)
        self.assertAlmostEqual(lon, 0.0, delta=0.05)
        self.assertAlmostEqual(lat, mod_lat(1000.0), delta=0.3)


if __name__ == "__main__":
    unittest.main()
