import unittest

from shapely.affinity import affine_transform
from shapely.geometry import MultiPolygon, Polygon, box

from tools.atlantropa_island_alignment import fit_bbox_alignment


class AtlantropaIslandAlignmentTests(unittest.TestCase):
    def test_bbox_translation_and_axis_scale(self):
        source = box(1, 2, 3, 6)
        target = box(10, 20, 14, 30)
        result = fit_bbox_alignment(source, target)

        self.assertEqual(result["coefficients"], (2.0, 0.0, 8.0, 0.0, 2.5, 15.0))
        self.assertTrue(result["geometry"].equals(target))
        self.assertEqual(result["diagnostics"]["mapped_overlap_ratio"], 1.0)
        self.assertEqual(result["diagnostics"]["target_coverage_ratio"], 1.0)

    def test_coefficients_match_project_affine_order_and_preserve_relative_position(self):
        source = box(0, 0, 2, 4)
        target = box(10, 20, 16, 30)
        result = fit_bbox_alignment(source, target)
        ax, bx, cx, by, ay, cy = result["coefficients"]
        shapely_result = affine_transform(source, [ax, bx, by, ay, cx, cy])

        self.assertTrue(shapely_result.equals(result["geometry"]))
        self.assertEqual(shapely_result.centroid.x, 13.0)
        self.assertEqual(shapely_result.centroid.y, 25.0)

    def test_multipolygon_is_transformed_as_one_island_geometry(self):
        source = MultiPolygon([box(0, 0, 1, 1), box(3, 2, 5, 4)])
        target = box(10, 20, 20, 30)
        result = fit_bbox_alignment(source, target)

        self.assertEqual(result["geometry"].geom_type, "MultiPolygon")
        self.assertEqual(len(result["geometry"].geoms), 2)
        self.assertEqual(result["diagnostics"]["mapped_bbox"], target.bounds)

    def test_rejects_missing_invalid_and_degenerate_inputs(self):
        target = box(0, 0, 1, 1)
        cases = [
            (None, target, "source geometry is required"),
            (box(0, 0, 1, 0), target, "source geometry must be valid"),
            (box(0, 0, 1, 1).boundary, target, "Polygon or MultiPolygon"),
            (target, box(0, 0, 1, 0), "target geometry must be valid"),
        ]
        for source, candidate_target, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    fit_bbox_alignment(source, candidate_target)


if __name__ == "__main__":
    unittest.main()
