from __future__ import annotations

import json
import unittest
from pathlib import Path
from tools.build_data_catalog import build_catalog_markdown, build_catalog_payload


REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_JSON = REPO_ROOT / "data" / "CATALOG.json"
CATALOG_MD = REPO_ROOT / "data" / "CATALOG.md"


class DataCatalogContractTest(unittest.TestCase):
    def _load_catalog(self) -> dict:
        return json.loads(CATALOG_JSON.read_text(encoding="utf-8"))

    def test_checked_in_catalog_matches_builder(self) -> None:
        checked_in_payload = self._load_catalog()
        checked_in_markdown = CATALOG_MD.read_text(encoding="utf-8")
        rebuilt_payload = build_catalog_payload()
        rebuilt_markdown = build_catalog_markdown(rebuilt_payload)

        self.assertEqual(checked_in_payload, rebuilt_payload)
        self.assertEqual(checked_in_markdown, rebuilt_markdown)

    def test_catalog_excludes_optional_cache_source_assets(self) -> None:
        payload = self._load_catalog()
        entries = {entry["key"]: entry for entry in payload.get("entries") or []}

        self.assertIn("source:gb_chn_adm2", entries)
        self.assertNotIn("source:gb_bfa_adm1", entries)
        self.assertNotIn("source:gb_ukr_adm2", entries)
        self.assertNotIn("source:hgo_mod_2241701657", entries)

    def test_catalog_preserves_runtime_asset_alias_identity_for_shared_urls(self) -> None:
        payload = self._load_catalog()
        entries_by_url = {entry["url"]: entry for entry in payload.get("entries") or []}

        world_cities = entries_by_url["data/world_cities.geojson"]

        self.assertEqual(world_cities["key"], "world_cities")
        self.assertIn("city_lights:historical_1930:source", world_cities.get("aliases") or [])


if __name__ == "__main__":
    unittest.main()
