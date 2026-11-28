import unittest

import geopandas as gpd
from shapely.geometry import box

from map_builder.geo.regional_boundary_alignment import align_regional_boundaries


def _frame(geometries):
    return gpd.GeoDataFrame(
        [{"id": feature_id, "geometry": geometry} for feature_id, geometry in geometries.items()],
        geometry="geometry",
        crs="EPSG:4326",
    )


class RegionalBoundaryAlignmentTests(unittest.TestCase):
    def test_candidate_retreat_is_extended_to_baseline_ids(self):
        baseline = _frame({"A": box(0, 0, 2, 1), "B": box(2, 0, 4, 1)})
        candidate = _frame({"A": box(0, 0, 1.8, 1), "B": box(1.8, 0, 3.8, 1)})
        result, report = align_regional_boundaries(baseline, candidate)
        self.assertAlmostEqual(result.geometry.union_all().area, baseline.geometry.union_all().area)
        self.assertGreater(report["extension_area"], 0)
        self.assertEqual(report["ambiguous_face_count"], 0)

    def test_candidate_interior_hole_is_preserved(self):
        shell = box(0, 0, 4, 4)
        candidate_geom = shell.difference(box(1, 1, 3, 3))
        baseline = _frame({"A": shell})
        candidate = _frame({"A": candidate_geom})
        result, report = align_regional_boundaries(baseline, candidate)
        self.assertAlmostEqual(result.geometry.iloc[0].area, candidate_geom.area)
        self.assertGreater(report["candidate_hole_area_excluded"], 0)

    def test_internal_candidate_boundary_is_not_moved(self):
        baseline = _frame({"A": box(0, 0, 2, 1), "B": box(2, 0, 4, 1)})
        candidate = _frame({"A": box(0, 0, 2, 1), "B": box(2, 0, 3.8, 1)})
        result, _ = align_regional_boundaries(baseline, candidate)
        self.assertTrue(result.loc[result.id == "A", "geometry"].iloc[0].equals(candidate.loc[candidate.id == "A", "geometry"].iloc[0]))


if __name__ == "__main__":
    unittest.main()
