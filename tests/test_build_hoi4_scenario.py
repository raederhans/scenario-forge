from __future__ import annotations

import unittest
from scenario_builder.hoi4.compiler import _apply_country_full_names
from scenario_builder.hoi4.models import ScenarioCountryRecord
from tools.build_hoi4_scenario import PROJECT_ROOT, resolve_manual_rules


class BuildHoi4ScenarioDefaultsTest(unittest.TestCase):
    def test_resolve_manual_rules_restores_hoi4_1939_base_plus_override_default(self) -> None:
        resolved = resolve_manual_rules("", "hoi4_1939")
        self.assertEqual(
            resolved,
            ",".join(
                [
                    str(PROJECT_ROOT / "data" / "scenario-rules" / "hoi4_1936.manual.json"),
                    str(PROJECT_ROOT / "data" / "scenario-rules" / "hoi4_1939.manual.json"),
                ]
            ),
        )

    def test_apply_country_full_names_rejects_missing_or_incomplete_entries(self) -> None:
        countries = {
            tag: ScenarioCountryRecord(tag=tag, display_name=name, color_hex=color, feature_count=1,
                                       quality="manual_reviewed", source="unit-test")
            for tag, name, color in [("AAA", "Alpha", "#111111"), ("BBB", "Beta", "#222222")]
        }

        with self.assertRaisesRegex(ValueError, "missing tags: BBB"):
            _apply_country_full_names(
                countries,
                scenario_id="unit_test",
                country_full_names={"tags": {"AAA": {"en": "Alpha Republic", "zh": "阿尔法共和国"}}},
            )

        with self.assertRaisesRegex(ValueError, "incomplete bilingual entries: BBB"):
            _apply_country_full_names(
                countries,
                scenario_id="unit_test",
                country_full_names={
                    "tags": {
                        "AAA": {"en": "Alpha Republic", "zh": "阿尔法共和国"},
                        "BBB": {"en": "Beta Republic"},
                    }
                },
            )


if __name__ == "__main__":
    unittest.main()
