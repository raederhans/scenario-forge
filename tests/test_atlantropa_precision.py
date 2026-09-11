import unittest

from shapely.geometry import MultiPolygon, MultiPoint, Polygon, box
from shapely.ops import snap

from tools.atlantropa_precision import simplify_atlantropa_geometry, snap_atlantropa_geometry
from tools.patch_tno_1962_bundle import build_boolean_weld_rows, build_shore_seal_rows, smooth_polygonal


class AtlantropaPrecisionTests(unittest.TestCase):
    def test_dense_reference_cannot_walk_a_vertex_beyond_snap_budget(self):
        source = box(0, 0, 1, 1)
        reference = MultiPoint([(1 + index * 0.05, 1) for index in range(1, 21)])
        unsafe = snap(source, reference, 0.1)
        self.assertGreater(source.boundary.hausdorff_distance(unsafe.boundary), 0.1)
        result, diagnostic = snap_atlantropa_geometry(source, reference, tolerance=0.1)
        self.assertTrue(result.equals(source))
        self.assertEqual(diagnostic["snap_fallback_reason"], "snap_displacement_exceeds_tolerance")

    def test_bounded_snap_keeps_supported_component(self):
        source = box(0, 0, 1, 1)
        result, diagnostic = snap_atlantropa_geometry(source, MultiPoint([(1.04, 1)]), tolerance=0.05)
        self.assertIsNone(diagnostic["snap_fallback_reason"])
        self.assertGreater(result.intersection(source).area, 0)
        self.assertLessEqual(source.boundary.hausdorff_distance(result.boundary), 0.05)

    def test_collapsed_buffer_reports_geometry_error_before_simplify(self):
        # Closing this narrow real polygon falls below the builder's existing
        # normalization area floor, although its input is retained.
        source = Polygon([(0, 0), (1, 0), (0.5, 2.00000001e-9)])
        with self.assertRaisesRegex(ValueError, "collapsed.*buffer"):
            smooth_polygonal(source, buffer_radius=0.0035, simplify_tolerance=0.01)

    def test_small_coastal_detail_is_closer_than_previous_simplification(self):
        source = Polygon([(0, 0), (1, 0), (1, 1), (0.504, 1), (0.5, 1.006), (0.496, 1), (0, 1)])
        result, diagnostic = simplify_atlantropa_geometry(source, tolerance=0.01)
        old = source.simplify(0.01, preserve_topology=True)
        self.assertLess(source.boundary.hausdorff_distance(result.boundary), source.boundary.hausdorff_distance(old.boundary))
        self.assertLessEqual(diagnostic["boundary_vertex_hausdorff_degrees"], 0.0025)

    def test_pixel_square_and_tiny_island_are_not_rounded_or_removed(self):
        source = MultiPolygon([box(0, 0, 0.0703125, 0.0703125), box(1, 1, 1.001, 1.001)])
        result, _ = simplify_atlantropa_geometry(source)
        self.assertTrue(result.equals(source))

    def test_preserves_hole_and_exact_coast_contact(self):
        land = box(-1, -1, 0, 2)
        source = Polygon([(0, 0), (1, 0), (1, 1), (0, 1)], [[(0.5, 0.5), (0.6, 0.5), (0.6, 0.6), (0.5, 0.6)]])
        result, _ = simplify_atlantropa_geometry(source, forbidden=land)
        self.assertEqual(len(result.interiors), 1)
        self.assertGreater(result.boundary.intersection(land.boundary).length, 0)
        self.assertEqual(result.intersection(land).area, 0)

    def test_falls_back_when_shortcut_crosses_original_land(self):
        source = Polygon([(0, 0), (1, 0), (1, 1), (0.501, 1), (0.5, 0.999), (0.499, 1), (0, 1)])
        forbidden = box(-1, -1, 2, 2).difference(source)
        result, diagnostic = simplify_atlantropa_geometry(source, forbidden=forbidden)
        self.assertTrue(result.equals(source))
        self.assertEqual(diagnostic["fallback_reason"], "crossed_land_boundary")

    def test_generated_connectors_do_not_smooth_back_into_land(self):
        mainland = box(-1, 0, 0, 1)
        donor = box(0.03, 0, 1, 1)
        config = {"aoi_bbox": [-2, -2, 2, 2], "feature_group_id": "test", "group_label": "Test",
                  "boolean_weld_width": 0.04, "boolean_weld_max_area": 2,
                  "shore_seal_width": 0.06, "shore_seal_max_area": 2, "simplify_tolerance": 0.01}
        rows = [{"id": "ATLPRV_test", "geometry": donor, "atl_geometry_role": "donor_land",
                 "assigned_owner_tag": "ITA", "donor_state_ids": [], "donor_province_ids": []}]
        for build in (build_boolean_weld_rows, build_shore_seal_rows):
            with self.subTest(builder=build.__name__):
                connectors = build("test", config, rows, mainland, source_support=box(-0.1, 0, 1, 1))
                self.assertTrue(connectors)
                for row in connectors:
                    self.assertEqual(row["geometry"].intersection(mainland.union(donor)).area, 0)
                    self.assertLessEqual(row["postprocess_precision"]["boundary_vertex_hausdorff_degrees"], 0.0025)

    def test_later_helpers_cannot_close_a_source_strait(self):
        mainland = box(-1, -1, 0, 1)
        source = box(0.02, 0, 0.2, 0.2)
        config = {"aoi_bbox": [-2, -2, 2, 2], "feature_group_id": "test", "group_label": "Test",
                  "boolean_weld_width": 0.03, "boolean_weld_max_area": 1,
                  "shore_seal_width": 0.06, "shore_seal_max_area": 1}
        rows = [{"id": "ATLPRV_test", "geometry": source, "atl_geometry_role": "donor_land"}]
        for build in (build_boolean_weld_rows, build_shore_seal_rows):
            self.assertEqual(build("test", config, rows, mainland, source_support=source), [])

    def test_helpers_do_not_duplicate_an_existing_nonjoinable_island(self):
        mainland = box(-1, 0, 0, 1)
        donor = box(0.03, 0, 1, 1)
        island = box(0.005, 0.1, 0.025, 0.9)
        config = {"aoi_bbox": [-2, -2, 2, 2], "feature_group_id": "test", "group_label": "Test",
                  "boolean_weld_width": 0.04, "boolean_weld_max_area": 2,
                  "shore_seal_width": 0.06, "shore_seal_max_area": 2}
        rows = [{"id": "ATLPRV_test", "geometry": donor, "atl_geometry_role": "donor_land", "assigned_owner_tag": "ITA"},
                {"id": "ATLISL_test", "geometry": island, "atl_geometry_role": "donor_island", "assigned_owner_tag": "CRO"}]
        for build in (build_boolean_weld_rows, build_shore_seal_rows):
            connectors = build("test", config, rows, mainland, source_support=box(-0.1, 0, 1, 1))
            self.assertTrue(connectors)
            self.assertTrue(all(row["geometry"].intersection(island).area == 0 for row in connectors))


if __name__ == "__main__":
    unittest.main()
