from __future__ import annotations

import unittest

from map_builder.scenario_city_overrides_composer import (
    build_capital_overrides_payload_from_capital_hints,
    compose_city_overrides_payload,
    extract_city_assets_payload,
    merge_capital_overrides_payload,
)


class ScenarioCityOverridesComposerTest(unittest.TestCase):
    def test_compose_city_overrides_prefers_explicit_capital_overrides_over_defaults(self) -> None:
        city_assets_payload = {
            "version": 1,
            "scenario_id": "test_scenario",
            "generated_at": "cities-pass",
            "cities": {
                "CITY::legacy": {
                    "display_name": {"en": "Legacy City", "zh": "鏃у煄"},
                    "aliases": ["Legacy City"],
                }
            },
            "audit": {
                "renamed_city_count": 1,
            },
        }
        default_capital_payload = build_capital_overrides_payload_from_capital_hints(
            {
                "version": 1,
                "scenario_id": "test_scenario",
                "generated_at": "defaults-pass",
                "entry_count": 1,
                "missing_tag_count": 0,
                "missing_tags": [],
                "entries": [
                    {
                        "tag": "AAA",
                        "city_id": "default-city",
                        "city_name": "Default City",
                    },
                    {
                        "tag": "BBB",
                        "city_id": "beta-city",
                        "city_name": "Beta City",
                    },
                ],
                "audit": {},
            },
            scenario_id="test_scenario",
        )
        explicit_capital_payload = {
            "version": 1,
            "scenario_id": "test_scenario",
            "generated_at": "explicit-pass",
            "capitals_by_tag": {"AAA": "explicit-city"},
            "capital_city_hints": {
                "AAA": {
                    "tag": "AAA",
                    "city_id": "explicit-city",
                    "city_name": "Explicit City",
                }
            },
            "audit": {
                "explicit_capital_override_count": 1,
            },
        }

        payload = compose_city_overrides_payload(
            city_assets_payload,
            merge_capital_overrides_payload(
                default_capital_payload,
                explicit_capital_payload,
                scenario_id="test_scenario",
            ),
            scenario_id="test_scenario",
            generated_at="compose-pass",
        )

        self.assertEqual(payload["capitals_by_tag"]["AAA"], "explicit-city")
        self.assertEqual(payload["capitals_by_tag"]["BBB"], "beta-city")
        self.assertEqual(payload["capital_city_hints"]["AAA"]["city_name"], "Explicit City")
        self.assertIn("CITY::legacy", payload["cities"])
        self.assertEqual(payload["audit"]["renamed_city_count"], 1)
        self.assertEqual(payload["audit"]["explicit_capital_override_count"], 1)

    def test_extract_city_assets_ignores_stale_capital_sections(self) -> None:
        payload = extract_city_assets_payload(
            {
                "version": 1,
                "scenario_id": "test_scenario",
                "generated_at": "stale-pass",
                "capitals_by_tag": {"AAA": "stale-city"},
                "capital_city_hints": {"AAA": {"city_id": "stale-city"}},
                "cities": {"CITY::legacy": {"aliases": ["Legacy City"]}},
                "audit": {
                    "renamed_city_count": 1,
                    "name_conflict_count": 0,
                    "explicit_capital_override_count": 9,
                },
            },
            scenario_id="test_scenario",
        )

        self.assertEqual(payload["cities"]["CITY::legacy"]["aliases"], ["Legacy City"])
        self.assertEqual(payload["audit"]["renamed_city_count"], 1)
        self.assertNotIn("capitals_by_tag", payload)
        self.assertNotIn("explicit_capital_override_count", payload["audit"])


if __name__ == "__main__":
    unittest.main()
