import unittest

from shapely.geometry import MultiPolygon, MultiPoint, Polygon, box, mapping, shape
from shapely.ops import snap

from tools.atlantropa_precision import (
    absorb_enclosed_island_holes,
    snap_atlantropa_geometry,
    smooth_atlantropa_land,
)


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

    def test_smoothing_preserves_fixed_coast_vertices(self):
        edge = self._staircase()
        features = [self._feature(Polygon([*edge, (-2, 4)]))]
        fixed = self._fixed_stair_ends()
        result, _ = smooth_atlantropa_land(features, fixed_geometry=fixed)
        self.assertEqual(result[0]["geometry"]["coordinates"][0][0], edge[0])
        self.assertEqual(result[0]["geometry"]["coordinates"][0][len(edge) - 1], edge[-1])
        self.assertGreater(shape(result[0]["geometry"]).symmetric_difference(shape(features[0]["geometry"])).area, 0)

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
        foreign = [features[0], feature(box(1, 1, 2, 2).union(box(5, 5, 6, 6)), "flat", "ALB")]
        self.assertEqual(len(absorb_enclosed_island_holes(foreign)[1]), 1)
        unwelded = [feature(island, "isle", "ITA"), foreign[1]]
        self.assertEqual(absorb_enclosed_island_holes(unwelded)[0], unwelded)


if __name__ == "__main__":
    unittest.main()
