from __future__ import annotations

import geopandas as gpd
import unittest
from shapely.geometry import box, MultiPolygon

from map_builder.geo.scenario_surface_constraints import constrain_candidate_surface_geometry


class ScenarioSurfaceConstraintsTest(unittest.TestCase):
    def _gdf(self, rows):
        return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")

    def test_new_protected_overlap_is_removed(self):
        baseline = self._gdf([{"id": "A", "name": "old", "geometry": box(0, 0, 1, 1)}])
        candidate = self._gdf([{"id": "A", "name": "new", "geometry": box(0, 0, 2, 1)}])
        result, diagnostics = constrain_candidate_surface_geometry(baseline, candidate, box(1.5, 0, 2.5, 1))
        self.assertAlmostEqual(result.geometry.iloc[0].area, 1.5)
        self.assertGreater(diagnostics["removed_candidate_area"], 0)

    def test_baseline_protected_overlap_is_preserved(self):
        baseline = self._gdf([{"id": "A", "geometry": box(0, 0, 1.5, 1)}])
        candidate = self._gdf([{"id": "A", "geometry": box(0, 0, 1.5, 1)}])
        result, _ = constrain_candidate_surface_geometry(baseline, candidate, box(1, 0, 2, 1))
        self.assertAlmostEqual(result.geometry.iloc[0].area, 1.5)

    def test_envelope_touching_protection_does_not_drop_polygon_boundaries(self):
        baseline = self._gdf([{"id": "A", "geometry": box(0, 0, 1, 1)}])
        candidate = self._gdf([{"id": "A", "geometry": box(0, 0, 2, 1)}])
        protected = MultiPolygon([box(1.5, 0, 2.5, 0.5), box(0, 1, 0.5, 2)])
        forbidden = protected.difference(baseline.geometry.iloc[0]).intersection(box(0, 0, 2, 1))
        self.assertEqual(forbidden.geom_type, "GeometryCollection")
        self.assertIsNone(forbidden.boundary)
        result, report = constrain_candidate_surface_geometry(baseline, candidate, protected)
        expected = candidate.geometry.iloc[0].difference(forbidden)
        self.assertTrue(result.geometry.iloc[0].equals(expected))
        self.assertEqual(result.geometry.iloc[0].area, 1.75)
        self.assertEqual(report["residual_new_overlap_area"], 0)
        self.assertTrue(report["coverage_valid"])

    def test_two_adjacent_features_remain_valid_coverage(self):
        baseline = self._gdf([{"id": "A", "geometry": box(0, 0, 1, 1)}, {"id": "B", "geometry": box(1, 0, 2, 1)}])
        candidate = baseline.copy()
        result, diagnostics = constrain_candidate_surface_geometry(baseline, candidate, box(0, 0, 2, 1))
        self.assertTrue(diagnostics["coverage_valid"])
        self.assertEqual(result["id"].tolist(), ["A", "B"])

    def test_invalid_empty_and_changed_ids_fail(self):
        baseline = self._gdf([{"id": "A", "geometry": box(0, 0, 1, 1)}])
        with self.assertRaises(ValueError):
            constrain_candidate_surface_geometry(baseline, self._gdf([{"id": "B", "geometry": box(0, 0, 1, 1)}]), box(0, 0, 1, 1))
        with self.assertRaises(ValueError):
            constrain_candidate_surface_geometry(baseline, self._gdf([{"id": "A", "geometry": box(0, 0, 0, 1)}]), box(0, 0, 1, 1))

    def test_crs_and_protected_type_are_required(self):
        baseline = self._gdf([{"id": "A", "geometry": box(0, 0, 1, 1)}])
        no_crs = baseline.copy(); no_crs.set_crs(None, allow_override=True, inplace=True)
        with self.assertRaises(ValueError):
            constrain_candidate_surface_geometry(no_crs, baseline, box(0, 0, 1, 1))
        with self.assertRaises(ValueError):
            constrain_candidate_surface_geometry(baseline, baseline, box(0, 0, 1, 1).boundary)

    def test_overlapping_candidate_and_whitespace_id_fail_before_clipping(self):
        baseline = self._gdf([{"id": "A", "geometry": box(0, 0, 1, 1)}, {"id": "B", "geometry": box(1, 0, 2, 1)}])
        overlapping = self._gdf([{"id": "A", "geometry": box(0, 0, 1.5, 1)}, {"id": "B", "geometry": box(1, 0, 2, 1)}])
        with self.assertRaises(ValueError):
            constrain_candidate_surface_geometry(baseline, overlapping, box(0, 0, 2, 1))
        whitespace = self._gdf([{"id": " A", "geometry": box(0, 0, 1, 1)}, {"id": "B", "geometry": box(1, 0, 2, 1)}])
        with self.assertRaises(ValueError):
            constrain_candidate_surface_geometry(baseline, whitespace, box(0, 0, 2, 1))

    def test_non_geometry_properties_are_unchanged(self):
        baseline = self._gdf([{"id": "A", "owner": "old", "geometry": box(0, 0, 1, 1)}])
        candidate = self._gdf([{"id": "A", "owner": "new", "geometry": box(0, 0, 1, 1)}])
        result, _ = constrain_candidate_surface_geometry(baseline, candidate, box(0, 0, 1, 1))
        self.assertEqual(result["owner"].tolist(), ["new"])
