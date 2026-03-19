from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point

from map_builder.cities import emit_default_scenario_city_assets


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class CityAssetsTest(unittest.TestCase):
    def test_emit_default_scenario_city_assets_accepts_high_confidence_controlled_capital_without_state_hint(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenarios" / "modern_world"
            _write_json(
                scenario_dir / "manifest.json",
                {
                    "version": 2,
                    "scenario_id": "modern_world",
                    "display_name": "Modern World",
                    "bookmark_name": "Modern World",
                    "bookmark_description": "test",
                    "bookmark_date": "2026.1.1.12",
                    "default_country": "US",
                    "featured_tags": ["US"],
                    "palette_id": "hoi4_vanilla",
                    "baseline_hash": "hash",
                    "countries_url": "data/scenarios/modern_world/countries.json",
                    "owners_url": "data/scenarios/modern_world/owners.by_feature.json",
                    "controllers_url": "data/scenarios/modern_world/controllers.by_feature.json",
                    "cores_url": "data/scenarios/modern_world/cores.by_feature.json",
                    "audit_url": "data/scenarios/modern_world/audit.json",
                    "summary": {"feature_count": 1},
                    "generated_at": "2026-03-16T00:00:00Z",
                    "performance_hints": {},
                    "style_defaults": {},
                    "city_overrides_url": "data/scenarios/modern_world/city_overrides.json",
                    "capital_hints_url": "data/scenarios/modern_world/capital_hints.json",
                },
            )
            _write_json(
                scenario_dir / "countries.json",
                {
                    "countries": {
                        "US": {
                            "display_name": "United States of America",
                            "lookup_iso2": "US",
                            "base_iso2": "US",
                            "capital_state_id": None,
                        }
                    }
                },
            )
            _write_json(scenario_dir / "owners.by_feature.json", {"owners": {"US_CNTY_11001": "US"}})
            _write_json(scenario_dir / "controllers.by_feature.json", {"controllers": {"US_CNTY_11001": "US"}})

            world_cities = gpd.GeoDataFrame(
                [
                    {
                        "id": "CITY::washington",
                        "stable_key": "US::washington-dc",
                        "country_code": "US",
                        "name": "Washington, D.C.",
                        "name_ascii": "Washington",
                        "name_en": "Washington, D.C.",
                        "name_zh": "华盛顿",
                        "aliases": ["Washington", "Washington, D.C."],
                        "host_feature_id": "US_CNTY_11001",
                        "political_feature_id": "US_CNTY_11001",
                        "capital_kind": "country_capital",
                        "base_tier": "major",
                        "population": 4338000,
                        "is_country_capital": True,
                        "is_admin_capital": True,
                        "urban_area_id": "urban::washington",
                        "lon": -77.0365,
                        "lat": 38.8977,
                        "source": "natural_earth",
                        "geometry": Point(-77.0365, 38.8977),
                    }
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )

            emit_default_scenario_city_assets(tmp_path, world_cities)

            payload = json.loads((scenario_dir / "city_overrides.json").read_text(encoding="utf-8"))
            hint = payload["capital_city_hints"]["US"]

            self.assertEqual(hint["city_id"], "CITY::washington")
            self.assertEqual(hint["resolution_method"], "controlled_city_fallback")
            self.assertEqual(payload["audit"]["featured_runtime_missing_tags"], [])


if __name__ == "__main__":
    unittest.main()
