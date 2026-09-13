import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import box

from map_builder.processors import africa_admin1, global_basic_admin1


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
             patch.object(africa_admin1, "_build_ne_country_features", return_value=built) as build:
            result = africa_admin1.apply_africa_admin1_replacement(detail, country_codes={"AO"})
        build.assert_called_once()
        self.assertEqual(result[result.cntr_code.isin(["BJ", "ZZ"])]["marker"].tolist(), ["BJ", "ZZ"])
        self.assertEqual(result[result.cntr_code == "AO"]["id"].tolist(), ["AO_ADM1_1"])

    def test_global_subset_does_not_build_unselected_special_source(self):
        detail = _rows("GB", "BA", "ZZ")
        built = gpd.GeoDataFrame(
            [{"id": "GB_NUTS1_X", "name": "X", "cntr_code": "GB", "admin1_group": "X",
              "detail_tier": "nuts1_basic", "geometry": box(0, 0, 1, 1)}], crs="EPSG:4326"
        )
        with patch.object(global_basic_admin1, "_load_primary_political_shells", return_value=detail), \
             patch.object(global_basic_admin1, "_build_gb_nuts1_features", return_value=built) as build_special, \
             patch.object(global_basic_admin1, "_build_ne_country_features") as build_ne:
            result = global_basic_admin1.apply_global_basic_admin1_replacement(detail, country_codes={"GB"})
        build_special.assert_called_once()
        build_ne.assert_not_called()
        self.assertEqual(result[result.cntr_code.isin(["BA", "ZZ"])]["marker"].tolist(), ["BA", "ZZ"])

    def test_unknown_subset_code_is_rejected_without_loading_sources(self):
        detail = _rows("ZZ")
        with patch.object(africa_admin1, "_load_ne_admin1") as load_africa:
            with self.assertRaises(ValueError):
                africa_admin1.apply_africa_admin1_replacement(detail, country_codes={"ZZ"})
        load_africa.assert_not_called()
        with patch.object(global_basic_admin1, "_load_ne_admin1") as load_global:
            with self.assertRaises(ValueError):
                global_basic_admin1.apply_global_basic_admin1_replacement(detail, country_codes={"ZZ"})
        load_global.assert_not_called()


if __name__ == "__main__":
    unittest.main()
