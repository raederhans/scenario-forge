"""Unit tests for bounded source processor registry."""
from __future__ import annotations

import unittest

from map_builder.regional_processors import resolve_processor_units


class RegionalProcessorsRegistryTests(unittest.TestCase):
    def test_resolve_ru_expansion(self) -> None:
        # Selecting RU alone expands to RU+UA
        units_ru = resolve_processor_units(["RU"])
        self.assertEqual(len(units_ru), 1)
        self.assertEqual(units_ru[0]["name"], "russia_ukraine")
        self.assertEqual(units_ru[0]["countries"], ["RU", "UA"])

        # Selecting UA alone expands to RU+UA
        units_ua = resolve_processor_units(["UA"])
        self.assertEqual(len(units_ua), 1)
        self.assertEqual(units_ua[0]["name"], "russia_ukraine")
        self.assertEqual(units_ua[0]["countries"], ["RU", "UA"])

        # Selecting both RU and UA yields single deduplicated unit
        units_both = resolve_processor_units(["RU", "UA"])
        self.assertEqual(len(units_both), 1)
        self.assertEqual(units_both[0]["name"], "russia_ukraine")

    def test_resolve_multiple_countries_canonical_order(self) -> None:
        # Provide multiple countries in non-canonical order
        units = resolve_processor_units(["AU", "DK", "FR", "RU"])
        names = [u["name"] for u in units]
        self.assertEqual(
            names,
            ["france_master_precision", "denmark_border_detail", "russia_ukraine", "au_city_overrides"],
        )

    def test_alias_owner_confusion_rejected(self) -> None:
        # ISO3 scenario owners and tags must be rejected
        for invalid_owner in ("RUS", "FRA", "USA", "SOV", "GER", "POL", "CZE"):
            with self.assertRaises(ValueError):
                resolve_processor_units([invalid_owner])


if __name__ == "__main__":
    unittest.main()
