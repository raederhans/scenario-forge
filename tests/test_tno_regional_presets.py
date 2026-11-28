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

    def test_presets_stay_inside_the_country(self):
        for tag, presets in self.resolved.items():
            own = OWN_TAGS.get(tag, {tag})
            for preset in presets:
                with self.subTest(tag=tag, preset=preset["name"]):
                    outside = [i for i in preset["ids"] if self.owners.get(i) not in own]
                    self.assertEqual(outside, [])


if __name__ == "__main__":
    unittest.main()
