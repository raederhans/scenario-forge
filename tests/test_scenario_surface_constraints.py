from __future__ import annotations

import geopandas as gpd
import unittest
from unittest.mock import patch
from shapely.geometry import box

from map_builder.geo.scenario_surface_constraints import constrain_candidate_surface_geometry


class ScenarioSurfaceConstraintsTest(unittest.TestCase):
    def _gdf(self, rows):
        return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")

    def test_explicit_boundary_band_only_accepts_submillimetre_overlay_residual(self):
        frame = self._gdf([{"id": "A", "geometry": box(0, 0, 1, 1)}])
        protected = box(2, 0, 3, 1)
        # Simulate a numerical displacement during common-face reconstruction.
        with patch("map_builder.geo.scenario_surface_constraints.polygonize",
                   return_value=[box(0, 0, 1 - 1e-10, 1)]):
            with self.assertRaisesRegex(ValueError, "outside permitted clipping"):
                constrain_candidate_surface_geometry(frame, frame, protected)
            result, report = constrain_candidate_surface_geometry(
                frame, frame, protected, boundary_tolerance=1e-9)
            self.assertLess(result.geometry.iloc[0].area, 1)
            self.assertGreater(report["max_per_feature_conservation_error"], 1e-12)
            self.assertEqual(report["boundary_only_conservation_residuals"][0]["id"], "A")
        # Small total area alone cannot admit an interior missing island.
        damaged = box(0, 0, 1, 1).difference(box(.5, .5, .50001, .50001))
        with patch("map_builder.geo.scenario_surface_constraints.polygonize", return_value=[damaged]):
            with self.assertRaisesRegex(ValueError, "outside permitted clipping"):
                constrain_candidate_surface_geometry(frame, frame, protected, boundary_tolerance=1e-9)
        with patch("map_builder.geo.scenario_surface_constraints.polygonize",
                   return_value=[box(0, 0, .999, 1)]):
            with self.assertRaisesRegex(ValueError, "outside permitted clipping"):
                constrain_candidate_surface_geometry(frame, frame, protected, boundary_tolerance=1e-9)

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

    def test_two_adjacent_features_remain_valid_coverage(self):
        baseline = self._gdf([{"id": "A", "geometry": box(0, 0, 1, 1)}, {"id": "B", "geometry": box(1, 0, 2, 1)}])
        candidate = baseline.copy()
        result, diagnostics = constrain_candidate_surface_geometry(baseline, candidate, box(0, 0, 2, 1))
        self.assertTrue(diagnostics["coverage_valid"])
        self.assertEqual(result["id"].tolist(), ["A", "B"])
