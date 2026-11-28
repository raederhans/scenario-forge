import unittest
from shapely.geometry import box, shape
from shapely import union_all
from tools.adapt_us_county_scenarios import partition_feature


class CountyAdaptationTests(unittest.TestCase):
    def test_unique_partition_preserves_residual_and_assignments(self):
        old = box(0, 0, 3, 1)
        props = {"id": "US_ZN_26_001", "name": "Historical district", "controller": "OCC"}
        assignments = {"owners": {props["id"]: "OLD"}, "cores": {props["id"]: ["A", "B"]}, "controllers": {}}
        features, check = partition_feature(props, old, {"US_CNTY_26001": box(0, 0, 1, 1), "US_CNTY_26003": box(1, 0, 2, 1)}, assignments)
        self.assertEqual(len(features), 3)
        self.assertEqual(len({f["properties"]["id"] for f in features}), 3)
        self.assertTrue(union_all([shape(f["geometry"]) for f in features]).equals(old))
        self.assertEqual(check["residual_area_degrees2"], 1)
        for feature in features:
            self.assertEqual(feature["properties"]["name"], props["name"])
            self.assertEqual(feature["properties"]["controller"], "OCC")
            self.assertEqual(feature["lineage"]["assignments"], {"owners": "OLD", "cores": ["A", "B"]})
        self.assertEqual(props["id"], "US_ZN_26_001")

    def test_ambiguous_polygonized_face_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Ambiguous county"):
            partition_feature({"id": "cut"}, box(0, 0, 3, 1),
                              {"US_CNTY_26001": box(0, 0, 2, 1), "US_CNTY_26003": box(1, 0, 3, 1)}, {})

    def test_single_boundary_point_match_uses_full_face_evidence(self):
        # Simulate a representative point rounded onto the only county boundary.
        # The whole face is actually outside it and must remain residual.
        from unittest.mock import patch
        from shapely.geometry import Point
        face = box(1, 0, 2, 1)
        county = box(0, 0, 1, 1)
        from shapely.geometry.base import BaseGeometry
        original_point = BaseGeometry.representative_point
        def rounded_point(geometry):
            return Point(1, .5) if geometry.equals(face) else original_point(geometry)
        with patch("shapely.geometry.base.BaseGeometry.representative_point", rounded_point):
            features, report = partition_feature({"id": "old"}, face, {"US_CNTY_26001": county}, {})
        self.assertEqual(len(features), 1)
        self.assertIsNone(features[0]["lineage"]["modern_county_id"])
        self.assertEqual(report["boundary_point_fallbacks"][0]["point_matches"], ["US_CNTY_26001"])
        self.assertEqual(report["boundary_point_fallbacks"][0]["decision"], "retained_residual_no_positive_county_overlap")

    def test_domain_face_boundary_or_outside_point_preserves_full_face(self):
        from unittest.mock import patch
        from shapely.geometry import Point
        old = box(0, 0, 1, 1)
        before = old.wkb
        for point in (Point(0, .5), Point(2, .5)):
            with self.subTest(point=point.wkt), patch(
                "shapely.geometry.base.BaseGeometry.representative_point", return_value=point
            ):
                features, report = partition_feature({"id": "old", "name": "Historical"}, old,
                    {"US_CNTY_26001": old}, {"owners": {"old": "USA"}, "controllers": {}})
            self.assertEqual(len(features), 1)
            self.assertTrue(shape(features[0]["geometry"]).equals(old))
            self.assertEqual(features[0]["lineage"]["modern_county_id"], "US_CNTY_26001")
            self.assertEqual(features[0]["lineage"]["assignments"], {"owners": "USA"})
            self.assertEqual(report["domain_membership_fallbacks"][0]["decision"], "entire_face_inside")
            self.assertEqual(old.wkb, before)


if __name__ == "__main__":
    unittest.main()
