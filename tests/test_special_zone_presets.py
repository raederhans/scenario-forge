"""剧本预设特殊区域：成员必须是该剧本的现有地块，类别合法，默认关闭且带中英文名。"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {"demilitarized", "claim", "occupation", "lease", "economic", "restricted", "custom"}


class SpecialZonePresetTest(unittest.TestCase):
    def test_presets_reference_existing_parcels(self) -> None:
        for scenario_id in ("hoi4_1936", "hoi4_1939", "tno_1962", "modern_world"):
            base = ROOT / "data" / "scenarios" / scenario_id
            owners = json.loads((base / "owners.by_feature.json").read_text(encoding="utf-8"))["owners"]
            payload = json.loads((base / "special_zone_layers.json").read_text(encoding="utf-8"))
            self.assertTrue(payload["layers"], scenario_id)
            ids = [layer["id"] for layer in payload["layers"]]
            self.assertEqual(len(ids), len(set(ids)), scenario_id)
            for layer in payload["layers"]:
                with self.subTest(scenario=scenario_id, layer=layer["id"]):
                    self.assertIn(layer["presetId"], CATEGORIES)
                    self.assertEqual(layer["source"], "scenario")
                    self.assertFalse(layer["visible"])
                    self.assertTrue(layer["name"].strip() and layer["nameZh"].strip())
                    self.assertTrue(layer["memberFeatureIds"])
                    self.assertEqual(layer["memberFeatureIds"], sorted(set(layer["memberFeatureIds"])))
                    self.assertFalse(set(layer["memberFeatureIds"]) - set(owners))


if __name__ == "__main__":
    unittest.main()
