import unittest

import geopandas as gpd
from shapely.geometry import box

from tools.prepare_tno_major_country_precision import (
    freeze_owner_domains,
    geographic_target_ids,
    map_source,
)
from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tests import test_tno_regional_precision as regional_tests


class MajorCountryPrecisionTests(unittest.TestCase):
    def fixture(self):
        rows = [{"properties": {"id": fid, "cntr_code": country}}
                for fid, country in [("JP_A", "JP"), ("JP_B", "JP"), ("CN_A", "CN")]]
        source = gpd.GeoDataFrame([
            {"id": "JP_B", "cntr_code": "JP", "geometry": box(1, 0, 2, 1)},
            {"id": "JP_A", "cntr_code": "JP", "geometry": box(0, 0, 1, 1)},
        ], crs=4326)
        return rows, source

    def test_geographic_ids_do_not_follow_mutable_scenario_allegiance(self):
        rows = [{"properties": {"id": "CN_CITY_a", "cntr_code": "CHI"}},
                {"properties": {"id": "CN_CITY_b", "cntr_code": "MAN"}},
                {"properties": {"id": "other", "cntr_code": "CN"}}]
        self.assertEqual(geographic_target_ids(rows, "CN"), ["CN_CITY_a", "CN_CITY_b"])
        source = gpd.GeoDataFrame([
            {"id": "CN_CITY_a", "cntr_code": "CN", "geometry": box(0, 0, 1, 1)},
            {"id": "CN_CITY_b", "cntr_code": "CN", "geometry": box(1, 0, 2, 1)},
        ], crs=4326)
        result, _ = map_source(rows, source, "CN")
        self.assertEqual(result.id.tolist(), ["CN_CITY_a", "CN_CITY_b"])
        self.assertEqual(geographic_target_ids([
            {"properties": {"id": "IN_ADM2_a", "cntr_code": "PAK"}},
            {"properties": {"id": "US_ZN_a", "cntr_code": "JAP"}},
        ], "IN"), ["IN_ADM2_a"])
        self.assertEqual(geographic_target_ids([
            {"properties": {"id": "US_ZN_a", "cntr_code": "JAP"}},
        ], "US"), ["US_ZN_a"])

    def test_frozen_owner_domains_do_not_move_foreign_allocation(self):
        baseline, replacement = regional_tests.TnoRegionalPrecisionTests().fixture()
        absolute = _absolute_topology(baseline)
        owners = {"DE_A": "ONE", "BE_A": "TWO", "NL_A": "TWO"}
        frozen, diagnostics = freeze_owner_domains(absolute, replacement, owners, .002)
        by_id = dict(zip(frozen.id, frozen.geometry))
        old = {r["properties"]["id"]: _decode_geometry(absolute, r)
               for r in absolute["objects"]["political"]["geometries"]}
        self.assertTrue(by_id["DE_A"].equals(old["DE_A"]))
        self.assertTrue(by_id["BE_A"].union(by_id["NL_A"]).equals(old["BE_A"].union(old["NL_A"])))
        self.assertTrue(all(d["owner_domain_preserved"] for d in diagnostics.values()))

    def test_partial_mode_preserves_failed_domain_and_rejects_nearest_resolution(self):
        from unittest.mock import patch
        baseline, replacement = regional_tests.TnoRegionalPrecisionTests().fixture()
        absolute = _absolute_topology(baseline)
        owners = {"DE_A": "ONE", "BE_A": "TWO", "NL_A": "TWO"}
        from tools.prepare_tno_major_country_precision import constrained_partition
        def partition(old, sources, parents):
            result, diagnostic = constrained_partition(old, sources, parents)
            if "DE_A" in old:
                diagnostic["baseline_overlap_resolutions"] = [{"rule": "nearest"}]
            return result, diagnostic
        with patch("tools.prepare_tno_major_country_precision.constrained_partition", side_effect=partition):
            with self.assertRaisesRegex(ValueError, "nearest_source"):
                freeze_owner_domains(absolute, replacement, owners, .002)
            frozen, diagnostics = freeze_owner_domains(absolute, replacement, owners, .002, preserve_failed_domains=True)
        self.assertEqual(set(frozen.id), {"BE_A", "NL_A"})
        self.assertEqual(diagnostics["ONE"]["preserved_ids"], ["DE_A"])
        self.assertIn("nearest_source", diagnostics["ONE"]["reason"])


if __name__ == "__main__":
    unittest.main()
