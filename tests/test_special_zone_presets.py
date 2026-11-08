"""剧本预设特殊区域：成员必须是该剧本的现有地块，类别合法，默认关闭且带中英文名。"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from tools.build_special_zone_presets import ScenarioData

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {"demilitarized", "claim", "occupation", "lease", "economic", "restricted", "custom"}


class SpecialZonePresetTest(unittest.TestCase):
    def test_second_batch_presets(self) -> None:
        expected = {
            "hoi4_1939": {"preset-sudetenland": "claim", "preset-bohemia-moravia": "occupation",
                          "preset-memel": "claim", "preset-albania-occupation": "occupation", "preset-hatay": "claim"},
        }
        for scenario, presets in expected.items():
            data = ScenarioData(scenario)
            payload = json.loads((ROOT / "data/scenarios" / scenario / "special_zone_layers.json").read_text(encoding="utf-8"))
            layers = {entry["id"]: entry for entry in payload["layers"]}
            self.assertTrue(presets.keys() <= layers.keys())
            for lid, category in presets.items():
                with self.subTest(scenario=scenario, layer=lid):
                    self.assertFalse(layers[lid]["visible"])
                    self.assertTrue(layers[lid]["memberFeatureIds"])
                    self.assertEqual(layers[lid]["presetId"], category)
            if scenario == "hoi4_1939":
                sudetenland = set(layers["preset-sudetenland"]["memberFeatureIds"])
                protectorate = set(layers["preset-bohemia-moravia"]["memberFeatureIds"])
                self.assertFalse(sudetenland & protectorate)
                self.assertEqual(sudetenland, {fid for fid in data.owned_by("GER") if data.props(fid).get("cntr_code") == "CZ"})
                self.assertEqual(protectorate, {fid for fid in data.owned_by("BOM") if data.props(fid).get("cntr_code") == "CZ"})
                self.assertEqual(set(layers["preset-albania-occupation"]["memberFeatureIds"]),
                                 {fid for fid in data.features if data.props(fid).get("cntr_code") == "AL"})

    def test_hoi4_1936_second_batch(self) -> None:
        data = ScenarioData("hoi4_1936")
        payload = json.loads((ROOT / "data/scenarios/hoi4_1936/special_zone_layers.json").read_text(encoding="utf-8"))
        layers = {layer["id"]: layer for layer in payload["layers"]}
        mandates = {"preset-french-mandate", "preset-british-mandates", "preset-class-b-mandates", "preset-class-c-mandates"}
        expected = mandates | {"preset-kwantung-lease", "preset-new-territories-lease", "preset-kwangchowan-lease",
                               "preset-shanghai-concessions", "preset-tianjin-concessions", "preset-panama-canal-zone"}
        self.assertTrue(expected <= layers.keys())
        for lid in expected:
            with self.subTest(layer=lid):
                entry = layers[lid]
                self.assertFalse(entry["visible"])
                self.assertTrue(entry["memberFeatureIds"])
                self.assertEqual(entry["presetId"], "lease")
                if lid in mandates:
                    self.assertEqual(entry["style"]["fill"], "#60a5fa")
                    self.assertEqual(entry["style"]["stroke"], "#1d4ed8")
                    codes = {data.props(fid).get("cntr_code") for fid in entry["memberFeatureIds"]}
                    self.assertFalse(codes & {"IQ", "EG"})

        french = set(layers["preset-french-mandate"]["memberFeatureIds"])
        self.assertIn("TR631", french)
        self.assertTrue({fid for fid in data.features if data.props(fid).get("cntr_code") in {"SY", "LB"}} <= french)
        british = set(layers["preset-british-mandates"]["memberFeatureIds"])
        self.assertEqual(british, {fid for fid in data.features if data.props(fid).get("cntr_code") in {"PS", "IL", "JO"}})

        class_b = set(layers["preset-class-b-mandates"]["memberFeatureIds"])
        zanzibar_names = {"North Pemba", "South Pemba", "Unguja North", "Unguja South", "Mjini Magharibi"}
        zanzibar = {fid for fid in data.features
                    if data.props(fid).get("cntr_code") == "TZ" and data.props(fid).get("name") in zanzibar_names}
        self.assertEqual(len(zanzibar), 5)
        self.assertFalse(class_b & zanzibar)
        self.assertEqual(class_b, {fid for fid in data.features
                                  if data.props(fid).get("cntr_code") in {"TZ", "RW", "BI", "TG", "CM"}} - zanzibar)

        class_c = layers["preset-class-c-mandates"]["memberFeatureIds"]
        self.assertNotIn("GU", {data.props(fid).get("cntr_code") for fid in class_c})
        northern_provinces = {"Enga", "East Sepik", "Madang", "Sandaun", "Chimbu", "Eastern Highlands",
                              "Western Highlands", "Morobe", "East New Britain", "West New Britain",
                              "New Ireland", "Manus", "of Bougainville"}
        self.assertEqual({data.props(fid).get("name") for fid in class_c if data.props(fid).get("cntr_code") == "PG"},
                         northern_provinces)
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
