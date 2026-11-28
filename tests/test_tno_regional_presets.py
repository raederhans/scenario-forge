"""TNO 1962 区域预设：规则能按当前剧本大区完整解析，产物与规则一致，本国预设不越出本国地块。"""

import json
import unittest

from tools.apply_tno_regional_presets import (
    RULES_PATH,
    SCENARIO_DIR,
    _load_feature_index,
    resolve_presets,
)

OWN_TAGS = {"RKO": {"OE00", "OE01", "OE02", "OE03"}}


class TnoRegionalPresetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
        district_groups = json.loads((SCENARIO_DIR / "district_groups.manual.json").read_text(encoding="utf-8"))["tags"]
        cls.owners, cntr_codes = _load_feature_index()
        cls.resolved = resolve_presets(cls.rules, district_groups, cls.owners, cntr_codes)
        cls.countries = json.loads((SCENARIO_DIR / "countries.json").read_text(encoding="utf-8"))["countries"]

    def test_published_presets_match_the_rules(self):
        # 不一致说明改了大区或地块 id 后没有重跑 tools/apply_tno_regional_presets.py
        for tag, presets in self.resolved.items():
            published = {p["name"]: p["ids"] for p in self.countries[tag]["regional_presets"]}
            for preset in presets:
                with self.subTest(tag=tag, preset=preset["name"]):
                    self.assertEqual(published.get(preset["name"]), preset["ids"])

    def test_own_preset_key_countries_only_see_their_own_presets(self):
        for tag, rule in self.rules["countries"].items():
            if rule.get("own_preset_key"):
                self.assertEqual(self.countries[tag].get("preset_lookup_code"), tag)

    def test_presets_stay_inside_the_country(self):
        for tag, presets in self.resolved.items():
            own = OWN_TAGS.get(tag, {tag})
            for preset in presets:
                with self.subTest(tag=tag, preset=preset["name"]):
                    outside = [i for i in preset["ids"] if self.owners.get(i) not in own]
                    self.assertEqual(outside, [])


if __name__ == "__main__":
    unittest.main()
