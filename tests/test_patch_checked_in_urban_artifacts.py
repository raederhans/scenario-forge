from __future__ import annotations

from helpers.polygon_fixtures import _polygon
import unittest

import geopandas as gpd

from map_builder.cities import assign_urban_country_owners


class PatchCheckedInUrbanArtifactsTest(unittest.TestCase):
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
