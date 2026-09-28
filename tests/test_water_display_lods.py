import copy
import math
import unittest

from shapely.geometry import Polygon, mapping

from tools.build_water_display_lods import build_candidate, equal_earth, projected_boundary_error, signed_area, ring_correspondence_preserved


def collection(polygons):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": name}, "geometry": mapping(polygon)}
        for name, polygon in polygons
    ]}


class WaterDisplayLodTests(unittest.TestCase):
    def test_equal_earth_projection_uses_css_scale_and_zoom(self):
        self.assertEqual(equal_earth((0, 0), 210, 2), (0.0, 0.0))
        point = equal_earth((10, 20), 210, 2)
        doubled = equal_earth((10, 20), 210, 4)
        self.assertAlmostEqual(doubled[0], point[0] * 2)
        self.assertAlmostEqual(doubled[1], point[1] * 2)

    def test_candidate_preserves_input_and_accepts_verified_shared_edge(self):
        edge = [(1 + .004 * math.sin(i / 2), i / 40) for i in range(41)]
        left = Polygon([(0, 0), *edge, (0, 1), (0, 0)])
        right = Polygon([(2, 0), (2, 1), *edge[::-1], (2, 0)])
        source = collection([("left", left), ("right", right)])
        unchanged = copy.deepcopy(source)
        candidate, report = build_candidate(source, tolerance_degrees=.01)
        self.assertEqual(source, unchanged)
        self.assertEqual(report["candidate_status"], "PASS")
        self.assertEqual(report["adoption_status"], "NOT_EVALUATED")
        self.assertLess(report["output_points"], report["input_points"])
        self.assertTrue(report["checks"]["ids_preserved"])
        self.assertTrue(report["checks"]["part_and_hole_counts_preserved"])
        self.assertTrue(report["checks"]["aggregate_water_footprint_exact"])
        self.assertGreaterEqual(report["measured_unclipped_projected_polyline_hausdorff_css_px"], 0)
        self.assertEqual([f["properties"]["id"] for f in candidate["features"]], ["left", "right"])

    def test_overlapping_source_coverage_is_not_certified(self):
        polygon = Polygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)])
        source = collection([("a", polygon), ("b", polygon)])
        _, report = build_candidate(source)
        self.assertFalse(report["checks"]["source_water_coverage_valid"])
        self.assertEqual(report["candidate_status"], "NO-GO")
        self.assertEqual(report["adoption_status"], "NO-GO")

    def test_stable_winding_for_tiny_far_from_origin_ring_and_reorder_guard(self):
        ring = [(170, 70), (170.00001, 70), (170.00001, 70.00001), (170, 70.00001), (170, 70)]
        self.assertGreater(signed_area(ring), 0)
        self.assertLess(signed_area(ring[::-1]), 0)
        first = {"type": "MultiPolygon", "coordinates": [[ring], [[(171, 70), (171.001, 70), (171, 70.001), (171, 70)]]]}
        second = {"type": "MultiPolygon", "coordinates": list(reversed(first["coordinates"]))}
        self.assertFalse(ring_correspondence_preserved(first, second, .01))

    def test_pixel_error_is_measured_in_projection_space(self):
        before = mapping(Polygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]))
        after = mapping(Polygon([(0, 0), (1, 0), (1, 1), (0.005, 1), (0, 0)]))
        error = projected_boundary_error(before, after, 210, 2)
        self.assertGreater(error, 0)
        self.assertAlmostEqual(projected_boundary_error(before, after, 210, 4), error * 2)

    def test_rejects_duplicate_ids_and_invalid_budget(self):
        polygon = Polygon([(0, 0), (1, 0), (1, 1), (0, 0)])
        source = collection([("a", polygon), ("a", polygon)])
        with self.assertRaisesRegex(ValueError, "distinct"):
            build_candidate(source)
        with self.assertRaisesRegex(ValueError, "positive"):
            build_candidate(collection([("a", polygon)]), zoom=float("nan"))


if __name__ == "__main__":
    unittest.main()
