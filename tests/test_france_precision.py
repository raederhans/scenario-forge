import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Polygon, box
from shapely import coverage_is_valid

from map_builder.processors.france import _source_arrondissement_layer, restore_matching_source_geometry


class FrancePrecisionTests(unittest.TestCase):
    def _source(self):
        return gpd.GeoDataFrame(
            [{"code": "01001", "nom": "Ain", "geometry": box(0, 0, 2, 2)},
             {"code": "01002", "nom": "Bugey", "geometry": box(2, 0, 4, 2)}],
            crs="EPSG:4326",
        )

    def test_matching_ids_restore_source_coverage_and_preserve_row_metadata(self):
        raw_source = self._source()
        raw_source.loc[len(raw_source)] = {"code": "01003", "nom": "Third", "geometry": box(4, 0, 6, 2)}
        with patch("map_builder.processors.france.fetch_or_load_geojson", return_value=raw_source):
            source = _source_arrondissement_layer()
        existing = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "marker": "second", "geometry": box(2, 0, 3, 1)},
             {"id": "FR_ARR_01001", "marker": "first", "geometry": box(0, 0, 1, 1)}],
            crs="EPSG:4326",
        )
        self.assertTrue(bool(coverage_is_valid(list(source.geometry))))
        restored = restore_matching_source_geometry(existing, source, allow_master_restore=True)
        self.assertEqual(restored["id"].tolist(), existing["id"].tolist())
        self.assertEqual(restored["marker"].tolist(), ["second", "first"])
        self.assertTrue(bool(coverage_is_valid(list(restored.geometry))))
        self.assertTrue(all(restored.geometry.iloc[i].equals(source.set_index("id").loc[row.id, "geometry"])
                            for i, (_, row) in enumerate(existing.iterrows())))

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

    def test_master_restore_rejects_duplicate_source_ids_or_crs_mismatch(self):
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

        source = self._source().to_crs("EPSG:3857")
        existing = gpd.GeoDataFrame(
            [{"id": "FR_ARR_01002", "geometry": box(2, 0, 4, 2)}], crs="EPSG:4326"
        )
        with self.assertRaisesRegex(ValueError, "CRS mismatch"):
            restore_matching_source_geometry(existing, source, allow_master_restore=True)


if __name__ == "__main__":
    unittest.main()
