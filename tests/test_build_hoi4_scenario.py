from __future__ import annotations

import unittest
from pathlib import Path

from tools.build_hoi4_scenario import PROJECT_ROOT, resolve_manual_rules


class BuildHoi4ScenarioDefaultsTest(unittest.TestCase):
    def test_resolve_manual_rules_keeps_hoi4_1936_single_pack_default(self) -> None:
        resolved = resolve_manual_rules("", "hoi4_1936")
        self.assertEqual(
            resolved,
            str(PROJECT_ROOT / "data" / "scenario-rules" / "hoi4_1936.manual.json"),
        )

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

    def test_resolve_manual_rules_preserves_explicit_override(self) -> None:
        explicit = "custom/a.json,custom/b.json"
        self.assertEqual(resolve_manual_rules(explicit, "hoi4_1939"), explicit)

    def test_resolve_manual_rules_uses_scenario_specific_file_for_other_scenarios(self) -> None:
        scenario_rules_dir = PROJECT_ROOT / "data" / "scenario-rules"
        target_path = scenario_rules_dir / "unit_test.manual.json"
        try:
            target_path.write_text('{"version": 1, "rules": []}\n', encoding="utf-8")
            self.assertEqual(resolve_manual_rules("", "unit_test"), str(target_path))
        finally:
            target_path.unlink(missing_ok=True)

    def test_resolve_manual_rules_returns_empty_string_when_no_default_exists(self) -> None:
        self.assertEqual(resolve_manual_rules("", "missing_scenario"), "")


if __name__ == "__main__":
    unittest.main()
