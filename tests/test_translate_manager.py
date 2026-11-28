from __future__ import annotations

import unittest

from tools.translate_manager import MachineTranslator, merge_geo


class GlobalGeoNamesTest(unittest.TestCase):
    def test_scoped_rebuild_preserves_reviewed_names_outside_scope(self):
        archer = {"en": "Archer County", "zh": "阿彻县现名"}
        warsaw = {"en": "Warsaw", "zh": "华沙"}
        geo, sources = merge_geo(
            geo_names=["Warszawa"],
            current_geo={"Archer County": archer, "Warszawa": {"en": "Warschau", "zh": "瓦尔绍"}},
            baseline_geo={
                "Archer County": {"en": "Archer County", "zh": "阿彻县", "scope": "global"},
                "Warszawa": {**warsaw, "scope": "global"},
            },
            alias_to_stable={}, stable_to_primary={}, search_only_aliases={"Archer County", "Warszawa"},
            translator=MachineTranslator(), include_stable_geo_keys=False, restrict_scope=True,
        )
        self.assertEqual(geo, {"Archer County": archer, "Warszawa": warsaw})
        self.assertEqual(sources, {"Archer County": "existing_reuse", "Warszawa": "baseline_reuse"})

    def test_rebuild_keeps_global_names_when_existing_snapshot_contains_scenario_names(self):
        modern = {"en": "Volgograd", "zh": "伏尔加格勒"}
        historical = {"en": "Paulusburg", "zh": "保卢斯堡"}
        geo, _ = merge_geo(
            geo_names=["Volgograd", "Nancy", "Danzig"],
            current_geo={
                "Volgograd": historical, "id::RU1": historical,
                "Nancy": {"en": "Nancy", "zh": "南齐希"},
                "Danzig": {"en": "Danzig", "zh": "但泽"},
            },
            baseline_geo={
                "Volgograd": {**modern, "scope": "global"},
                "id::RU1": {**modern, "scope": "global"},
                "Nancy": {"en": "Nancy", "zh": "南锡", "scope": "global"},
                "Danzig": {"en": "Gdańsk", "zh": "格但斯克"},
            },
            alias_to_stable={"Nancy": "id::FR1", "Volgograd": "id::RU1"},
            stable_to_primary={"id::RU1": "Volgograd", "id::FR1": "Nancy"},
            search_only_aliases={"Volgograd"},
            translator=MachineTranslator(),
            include_stable_geo_keys=True,
        )
        self.assertEqual(geo["Volgograd"], modern)
        self.assertEqual(geo["id::RU1"], modern)
        self.assertEqual(geo["Nancy"], {"en": "Nancy", "zh": "南锡"})
        self.assertEqual(geo["id::FR1"], geo["Nancy"])
        self.assertEqual(geo["Danzig"], {"en": "Danzig", "zh": "但泽"})


if __name__ == "__main__":
    unittest.main()
