import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import box

from map_builder.processors import africa_admin1


def _rows(*codes):
    return gpd.GeoDataFrame(
        [{"id": f"{code}_OLD", "name": code, "cntr_code": code, "marker": code,
          "geometry": box(i, 0, i + 1, 1)} for i, code in enumerate(codes)],
        crs="EPSG:4326",
    )


class RegionalBasicProcessorTests(unittest.TestCase):
    def test_africa_subset_preserves_other_rows_and_only_builds_selected_country(self):
        detail = _rows("AO", "BJ", "ZZ")
        built = gpd.GeoDataFrame(
            [{"id": "AO_ADM1_1", "name": "A", "cntr_code": "AO", "admin1_group": "A",
              "detail_tier": "adm1_basic", "geometry": box(0, 0, 1, 1)}], crs="EPSG:4326"
        )
        with patch.object(africa_admin1, "_load_primary_political_shells", return_value=detail), \
             patch.object(africa_admin1, "_load_ne_admin1", return_value=detail), \
             patch.object(africa_admin1, "_build_ne_country_features", return_value=built):
            result = africa_admin1.apply_africa_admin1_replacement(detail, country_codes={"AO"})
        self.assertEqual(result[result.cntr_code.isin(["BJ", "ZZ"])]["marker"].tolist(), ["BJ", "ZZ"])
        self.assertEqual(result[result.cntr_code == "AO"]["id"].tolist(), ["AO_ADM1_1"])


if __name__ == "__main__":
    unittest.main()
