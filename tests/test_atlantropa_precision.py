from copy import deepcopy
import json
from math import hypot
import unittest

from shapely.geometry import MultiPolygon, MultiPoint, Polygon, box, mapping, shape
from shapely.ops import snap

from tools.atlantropa_precision import absorb_enclosed_island_holes, simplify_atlantropa_geometry, snap_atlantropa_geometry, smooth_atlantropa_land
from tools.patch_tno_1962_bundle import build_boolean_weld_rows, build_shore_seal_rows, smooth_polygonal


class AtlantropaPrecisionTests(unittest.TestCase):
    @staticmethod
    def _staircase():
        edge = [(-0.1, -0.1), (0, 0)]
        for i in range(20):
            edge.extend([(i * 0.1 + 0.05, i * 0.1), (i * 0.1 + 0.05, (i + 1) * 0.1)])
        return [*edge, (2, 2), (2.1, 2.1)]

    @staticmethod
    def _feature(geometry, feature_id="land", role="donor_land"):
        return {"type": "Feature", "properties": {"id": feature_id, "atl_geometry_role": role},
                "geometry": mapping(geometry)}

    @staticmethod
    def _fixed_stair_ends():
        return MultiPolygon([box(-0.1, -0.2, 0, -0.1), box(2.1, 2, 2.2, 2.1)])

    def test_smoothing_removes_stairs_deterministically_without_mutating_input(self):
        edge = self._staircase()
        features = [self._feature(Polygon([*edge, (-2, 4)]))]
        before = deepcopy(features)
        result, diagnostics = smooth_atlantropa_land(features, fixed_geometry=self._fixed_stair_ends())
        after_edge = result[0]["geometry"]["coordinates"][0][1:len(edge) - 1]
        deviation = max(abs(y - x) for x, y in edge[1:-1])
        self.assertAlmostEqual(deviation, 0.05)
        self.assertLessEqual(max(abs(y - x) for x, y in after_edge), deviation * 0.3)
        self.assertGreater(diagnostics["moved_vertex_count"], 0)
        self.assertEqual(features, before)
        again = smooth_atlantropa_land(features, fixed_geometry=self._fixed_stair_ends())
        self.assertEqual(json.dumps((result, diagnostics)), json.dumps(again))

    def test_smoothing_preserves_fixed_coast_vertices(self):
        edge = self._staircase()
        features = [self._feature(Polygon([*edge, (-2, 4)]))]
        fixed = self._fixed_stair_ends()
        result, _ = smooth_atlantropa_land(features, fixed_geometry=fixed)
        self.assertEqual(result[0]["geometry"]["coordinates"][0][0], edge[0])
        self.assertEqual(result[0]["geometry"]["coordinates"][0][len(edge) - 1], edge[-1])
        self.assertGreater(shape(result[0]["geometry"]).symmetric_difference(shape(features[0]["geometry"])).area, 0)

    def test_smoothing_shared_stairs_preserves_coverage(self):
        edge = self._staircase()
        features = [self._feature(Polygon([*edge, (-2, 4)]), "a"),
                    self._feature(Polygon([*reversed(edge), (4, -2)]), "b")]
        result, diagnostics = smooth_atlantropa_land(features, fixed_geometry=box(10, 10, 11, 11))
        a, b = [shape(feature["geometry"]) for feature in result]
        original = shape(features[0]["geometry"]).union(shape(features[1]["geometry"]))
        self.assertLess(a.intersection(b).area, 1e-12)
        self.assertLess(abs(a.union(b).area - original.area), original.area * 0.02)
        self.assertGreater(diagnostics["moved_vertex_count"], 0)

    def test_smoothing_skips_short_chains_and_causeways(self):
        for geometry, role, skipped in [(box(0, 0, 1, 1), "donor_land", 1),
                                         (Polygon([*self._staircase(), (-2, 4)]), "causeway", 0)]:
            with self.subTest(role=role):
                features = [self._feature(geometry, role=role)]
                result, diagnostics = smooth_atlantropa_land(features, fixed_geometry=box(10, 10, 11, 11))
                self.assertEqual(result, features)
                self.assertEqual(diagnostics["moved_vertex_count"], 0)
                self.assertEqual(diagnostics["skipped_short_chain_count"], skipped)

    def test_smoothing_bounds_each_vertex_displacement(self):
        features = [self._feature(Polygon([*self._staircase(), (-2, 4)]))]
        result, diagnostics = smooth_atlantropa_land(features, fixed_geometry=box(10, 10, 11, 11), max_shift=0.01)
        for before, after in zip(features[0]["geometry"]["coordinates"][0], result[0]["geometry"]["coordinates"][0]):
            self.assertLessEqual(hypot(after[0] - before[0], after[1] - before[1]), 0.01 + 1e-15)
        self.assertLessEqual(diagnostics["max_shift_degrees"], 0.01 + 1e-15)
        self.assertGreater(diagnostics["moved_vertex_count"], 0)

    def test_smoothing_undoes_only_moves_that_enter_fixed_land(self):
        features = [self._feature(Polygon([*self._staircase(), (-2, 4)]))]
        fixed = box(0.065, 0.085, 0.075, 0.095)
        self.assertEqual(shape(features[0]["geometry"]).intersection(fixed).area, 0)
        result, diagnostics = smooth_atlantropa_land(features, fixed_geometry=fixed)
        self.assertLessEqual(shape(result[0]["geometry"]).intersection(fixed).area, 1e-9)
        self.assertEqual(diagnostics["locally_reverted_feature_ids"], ["land"])
        self.assertGreater(diagnostics["moved_vertex_count"], 0)

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


    def test_smoothing_keeps_half_of_protected_sea(self):
        features = [self._feature(Polygon([*self._staircase(), (-2, 4)]))]
        smoothed, _ = smooth_atlantropa_land(features, fixed_geometry=box(10, 10, 11, 11))
        gained = shape(smoothed[0]["geometry"]).difference(shape(features[0]["geometry"]))
        sea = max(getattr(gained, "geoms", [gained]), key=lambda part: part.area)
        result, diagnostics = smooth_atlantropa_land(features, fixed_geometry=box(10, 10, 11, 11), protected=[sea])
        self.assertLess(shape(result[0]["geometry"]).intersection(sea).area, 0.5 * sea.area)
        self.assertEqual(diagnostics["locally_reverted_feature_ids"], ["land"])
        self.assertGreater(diagnostics["moved_vertex_count"], 0)

    def test_smoothing_keeps_neighbours_together_when_one_lacks_a_shared_vertex(self):
        stair = self._staircase()
        upper = Polygon([*stair, (-2, 4)])
        # The lower neighbour's copy of the shared edge skips one stair corner's midpoint split.
        lower_ring = [*reversed(stair), (4, -2)]
        lower_ring.insert(len(lower_ring) // 2, lower_ring[len(lower_ring) // 2])
        upper_ring = list(upper.exterior.coords)[:-1]
        middle = len(stair) // 2
        a, b = upper_ring[middle], upper_ring[middle + 1]
        upper_ring.insert(middle + 1, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
        features = [self._feature(Polygon(upper_ring), "upper"), self._feature(Polygon(lower_ring), "lower")]
        result, _ = smooth_atlantropa_land(features, fixed_geometry=box(10, 10, 11, 11))
        shapes = [shape(feature["geometry"]) for feature in result]
        self.assertLess(shapes[0].intersection(shapes[1]).area, 1e-12)
        self.assertAlmostEqual(shapes[0].union(shapes[1]).area, shapes[0].area + shapes[1].area, places=12)
        self.assertEqual(len(shapes[0].union(shapes[1]).interiors) if shapes[0].union(shapes[1]).geom_type == "Polygon" else 0, 0)

    def test_enclosed_same_owner_piece_returns_to_boolean_weld_island(self):
        def feature(geometry, feature_id, owner, **props):
            return {"type": "Feature", "geometry": mapping(geometry),
                    "properties": {"id": feature_id, "owner_tag": owner, **props}}
        island = box(0, 0, 4, 4).difference(box(1, 1, 2, 2))
        weld = {"atl_join_mode": "boolean_weld", "atl_geometry_role": "donor_island"}
        features = [feature(island, "isle", "ITA", **weld),
                    feature(box(1, 1, 2, 2).union(box(5, 5, 6, 6)), "flat", "ITA")]
        result, absorbed = absorb_enclosed_island_holes(features)
        self.assertEqual(len(shape(result[0]["geometry"]).interiors), 0)
        self.assertAlmostEqual(shape(result[0]["geometry"]).area, 16)
        self.assertAlmostEqual(shape(result[1]["geometry"]).area, 1)
        self.assertEqual([entry["from_id"] for entry in absorbed], ["flat"])
        # An enclave of another owner is still returned; an unwelded island keeps its hole.
        foreign = [features[0], feature(box(1, 1, 2, 2), "flat", "ALB")]
        self.assertEqual(len(absorb_enclosed_island_holes(foreign)[1]), 1)
        unwelded = [feature(island, "isle", "ITA"), foreign[1]]
        self.assertEqual(absorb_enclosed_island_holes(unwelded)[0], unwelded)

if __name__ == "__main__":
    unittest.main()
