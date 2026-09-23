import unittest

import geopandas as gpd
from shapely.geometry import box

from tools.prepare_tno_western_precision_sources import load_governed_adm2, parse_countries, select_same_ids


class WesternPrecisionSourceTests(unittest.TestCase):
    def test_default_and_explicit_country_selection(self):
        self.assertEqual(parse_countries(None), {"GB", "IT", "AT", "EE", "LV", "LT", "ES", "PT", "LU"})
        self.assertEqual(parse_countries(["CH", "HU", "MD"]), {"CH", "HU", "MD"})
        self.assertEqual(parse_countries(["CZ", "SK"]), {"CZ", "SK"})
        for countries in ([], ["CH", "CH"], ["GR"], ["unknown"]):
            with self.subTest(countries=countries), self.assertRaises(ValueError):
                parse_countries(countries)

    def test_governed_adm2_sources_have_exact_country_ids(self):
        for code, count in (("CZ", 77), ("SK", 79)):
            with self.subTest(code=code):
                frame, _, url = load_governed_adm2(code)
                self.assertEqual(len(frame), count)
                self.assertTrue(frame.id.is_unique)
                self.assertTrue(frame.id.str.startswith(f"{code}_ADM2_").all())
                self.assertTrue(url.startswith("https://github.com/wmgeolab/geoBoundaries/raw/9469f09/"))

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

    def test_duplicate_baseline_ids_and_source_country_drift_fail(self):
        source = self.fixture()
        with self.assertRaisesRegex(ValueError, "Baseline IDs must be unique"):
            select_same_ids(source, [{"id": "UKA", "cntr_code": "GB"}] * 2, {"GB"})
        source.loc[0, "cntr_code"] = "IT"
        with self.assertRaisesRegex(ValueError, "country membership changed"):
            select_same_ids(source, [{"id": "UKA", "cntr_code": "GB"}], {"GB"})

    def test_overlapping_source_is_not_silently_repaired(self):
        source = self.fixture()
        source.loc[1, "geometry"] = box(.5, 0, 2, 1)
        with self.assertRaises(ValueError):
            select_same_ids(source, source[["id", "cntr_code"]].to_dict("records"), {"GB"})


if __name__ == "__main__":
    unittest.main()
