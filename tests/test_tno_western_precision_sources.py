import unittest

import geopandas as gpd
from shapely.geometry import box

from tools.prepare_tno_western_precision_sources import select_same_ids


class WesternPrecisionSourceTests(unittest.TestCase):
    def fixture(self):
        return gpd.GeoDataFrame([
            {"id": "UKA", "cntr_code": "GB", "geometry": box(0, 0, 1, 1)},
            {"id": "UKB", "cntr_code": "GB", "geometry": box(1, 0, 2, 1)},
        ], crs=4326)

    def test_historical_membership_filters_source_without_changing_geometry(self):
        source = self.fixture()
        result, excluded = select_same_ids(source, [{"id": "UKA", "cntr_code": "GB"}], {"GB"})
        self.assertEqual(list(result.id), ["UKA"])
        self.assertEqual(excluded, ["UKB"])
        self.assertTrue(result.geometry.iloc[0].equals_exact(source.geometry.iloc[0], 0))

    def test_missing_ids_duplicate_source_and_changed_country_fail(self):
        source = self.fixture()
        for baseline in [[{"id": "UNKNOWN", "cntr_code": "GB"}], [{"id": "UKA", "cntr_code": "IT"}]]:
            with self.assertRaises(ValueError):
                select_same_ids(source, baseline, {baseline[0]["cntr_code"]})
        source.loc[1, "id"] = "UKA"
        with self.assertRaises(ValueError):
            select_same_ids(source, [{"id": "UKA", "cntr_code": "GB"}], {"GB"})

    def test_overlapping_source_is_not_silently_repaired(self):
        source = self.fixture()
        source.loc[1, "geometry"] = box(.5, 0, 2, 1)
        with self.assertRaises(ValueError):
            select_same_ids(source, source[["id", "cntr_code"]].to_dict("records"), {"GB"})


if __name__ == "__main__":
    unittest.main()
