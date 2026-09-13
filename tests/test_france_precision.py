import unittest
import json
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Polygon, box
from shapely import coverage_is_valid

from map_builder.processors.france import (
    _source_arrondissement_layer,
    apply_france_master_precision,
    apply_holistic_replacements,
    restore_matching_source_geometry,
)


class FrancePrecisionTests(unittest.TestCase):
    def _source(self):
        return gpd.GeoDataFrame(
            [{"code": "01001", "nom": "Ain", "geometry": box(0, 0, 2, 2)},
             {"code": "01002", "nom": "Bugey", "geometry": box(2, 0, 4, 2)}],
            crs="EPSG:4326",
        )

    def test_matching_mode_replaces_geometry_without_injecting_source_only_rows(self):
        existing = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "name": "old", "cntr_code": "FR", "marker": "keep", "geometry": box(2, 0, 3, 2)},
             {"id": "DE1", "name": "Germany", "cntr_code": "DE", "marker": "other", "geometry": box(5, 0, 6, 1)}],
            crs="EPSG:4326",
        )
        with patch("map_builder.processors.france.fetch_or_load_geojson", return_value=self._source()):
            result = apply_holistic_replacements(existing)
        self.assertEqual(result["id"].tolist(), ["FR_ARR_01002", "DE1"])
        self.assertEqual(result["marker"].tolist(), ["keep", "other"])
        self.assertTrue(result.iloc[0].geometry.equals(box(2, 0, 3, 2)))

    def test_explicit_master_authorization_restores_source_and_same_bounds_cut_is_not_inferred(self):
        existing = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "cntr_code": "FR", "geometry": Polygon([(2, 0), (4, 0), (4, 2), (2, 2), (2, 0)]).difference(Polygon([(2, 0), (4, 0), (4, 2)]))}],
            crs="EPSG:4326",
        )
        source = self._source()
        preserved = restore_matching_source_geometry(existing, source)
        self.assertTrue(preserved.iloc[0].geometry.equals(existing.iloc[0].geometry))
        restored = restore_matching_source_geometry(existing, source, allow_master_restore=True)
        self.assertTrue(restored.iloc[0].geometry.equals(box(2, 0, 4, 2)))

    def test_legacy_mode_still_builds_all_source_rows_without_simplifying(self):
        existing = gpd.GeoDataFrame(
            [{"id": "FR", "name": "France", "cntr_code": "FR", "geometry": box(0, 0, 1, 1)}],
            crs="EPSG:4326",
        )
        with patch("map_builder.processors.france.fetch_or_load_geojson", return_value=self._source()):
            result = apply_holistic_replacements(existing)
        self.assertEqual(result["id"].tolist(), ["FR_ARR_01001", "FR_ARR_01002"])
        self.assertTrue(result.iloc[0].geometry.equals(box(0, 0, 2, 2)))

    def test_master_restore_rejects_duplicate_source_ids(self):
        source = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "geometry": box(0, 0, 1, 1)},
             {"id": "FR_ARR_01002", "geometry": box(1, 0, 2, 1)}],
            crs="EPSG:4326",
        )
        existing = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "geometry": box(0, 0, 1, 1)}], crs="EPSG:4326"
        )
        with self.assertRaisesRegex(ValueError, "duplicate IDs"):
            restore_matching_source_geometry(existing, source, allow_master_restore=True)

    def test_master_restore_rejects_missing_expected_id(self):
        existing = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "geometry": box(0, 0, 1, 1)}], crs="EPSG:4326"
        )
        with self.assertRaisesRegex(ValueError, "missing IDs"):
            restore_matching_source_geometry(existing, self._source().iloc[:1], allow_master_restore=True)

    def test_master_restore_rejects_invalid_source_geometry(self):
        invalid = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])
        source = gpd.GeoDataFrame([{"id": "FR_ARR_01002", "geometry": invalid}], crs="EPSG:4326")
        existing = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "geometry": box(0, 0, 1, 1)}], crs="EPSG:4326"
        )
        with self.assertRaisesRegex(ValueError, "invalid geometries"):
            restore_matching_source_geometry(existing, source, allow_master_restore=True)

    def test_master_restore_rejects_crs_mismatch(self):
        source = self._source().to_crs("EPSG:3857")
        existing = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "geometry": box(2, 0, 4, 2)}], crs="EPSG:4326"
        )
        with self.assertRaisesRegex(ValueError, "CRS mismatch"):
            restore_matching_source_geometry(existing, source, allow_master_restore=True)

    def test_precision_wrapper_skips_source_fetch_without_fr_ids(self):
        existing = gpd.GeoDataFrame(
            [{"id": "DE_1", "cntr_code": "DE", "geometry": box(0, 0, 1, 1)}], crs="EPSG:4326"
        )
        with patch("map_builder.processors.france._source_arrondissement_layer") as load:
            result = apply_france_master_precision(existing)
        load.assert_not_called()
        self.assertIs(result, existing)

    def test_real_tno_fr_ids_restore_against_source_and_check_coverage(self):
        from tools.build_na_detail_topology import _topology_object_to_gdf

        with open("data/scenarios/tno_1962/runtime_topology.topo.json", encoding="utf-8") as handle:
            topology = json.load(handle)
        runtime = _topology_object_to_gdf(topology, "political")
        existing = runtime[runtime["id"].astype(str).str.startswith("FR_ARR_")].copy()
        source = _source_arrondissement_layer()
        self.assertEqual(len(existing), 315)
        self.assertEqual(existing["id"].nunique(), 315)
        self.assertEqual(len(source), 320)
        self.assertTrue(bool(coverage_is_valid(list(source.geometry))))
        restored = restore_matching_source_geometry(existing, source, allow_master_restore=True)
        self.assertTrue(all(restored.geometry.iloc[i].equals(source.set_index("id").loc[row.id, "geometry"])
                            for i, (_, row) in enumerate(existing.iterrows())))


if __name__ == "__main__":
    unittest.main()
