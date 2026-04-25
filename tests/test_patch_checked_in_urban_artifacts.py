from __future__ import annotations

import unittest
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Polygon

from map_builder.cities import assign_urban_country_owners
from tools.patch_checked_in_urban_artifacts import (
    load_runtime_political_owner_shell,
    rebuild_urban_layer,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"


def _polygon(min_x: float, min_y: float, max_x: float, max_y: float) -> Polygon:
    return Polygon(
        [
            (min_x, min_y),
            (max_x, min_y),
            (max_x, max_y),
            (min_x, max_y),
        ]
    )


class PatchCheckedInUrbanArtifactsTest(unittest.TestCase):
    def test_rebuild_checked_in_urban_geojson_restores_required_metadata(self) -> None:
        owner_shell = load_runtime_political_owner_shell(DATA_DIR)
        external_urban = gpd.read_file(DATA_DIR / "europe_urban.geojson")

        rebuilt = rebuild_urban_layer(external_urban, owner_shell)

        self.assertEqual(len(rebuilt), len(external_urban))
        self.assertIn("id", rebuilt.columns)
        self.assertIn("country_owner_id", rebuilt.columns)
        self.assertEqual(int((rebuilt["id"].fillna("").astype(str).str.strip() == "").sum()), 0)
        self.assertEqual(int((rebuilt["country_owner_id"].fillna("").astype(str).str.strip() == "").sum()), 0)
        self.assertGreater(
            int((rebuilt["country_owner_method"].fillna("").astype(str).str.strip() == "nearest_gap_fallback").sum()),
            0,
        )
        runtime_ids = set(owner_shell["id"].fillna("").astype(str).str.strip())
        rebuilt_owner_ids = set(rebuilt["country_owner_id"].fillna("").astype(str).str.strip())
        self.assertTrue(rebuilt_owner_ids.issubset(runtime_ids))

    def test_assign_urban_country_owners_resolves_near_boundary_gaps(self) -> None:
        political = gpd.GeoDataFrame(
            [
                {
                    "id": "COUNTRY_A",
                    "cntr_code": "CA",
                    "geometry": _polygon(0.0, 0.0, 1.0, 1.0),
                }
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        urban = gpd.GeoDataFrame(
            [
                {
                    "id": "urban-near-gap",
                    "geometry": _polygon(1.02, 0.2, 1.03, 0.3),
                }
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )

        resolved = assign_urban_country_owners(urban, political)

        self.assertEqual(resolved.loc[0, "country_owner_id"], "COUNTRY_A")
        self.assertEqual(resolved.loc[0, "country_owner_code"], "CA")
        self.assertEqual(resolved.loc[0, "country_owner_method"], "nearest_gap_fallback")


if __name__ == "__main__":
    unittest.main()
