import unittest

import geopandas as gpd
from shapely.geometry import Polygon, box, shape

from tools.prepare_us_county_source import prepare_frames


def frame(ids, geometries):
    return gpd.GeoDataFrame({"GEOID": ids, "STATEFP": [s[:2] for s in ids]}, geometry=geometries, crs=4326)


class CountySourceTests(unittest.TestCase):
    def test_shared_tiger_boundary_not_old_county_mask(self):
        tiger = frame(["26001", "26003", "72001"], [box(0, 0, 1.2, 1), box(1.2, 0, 2, 1), box(5, 0, 6, 1)])
        cb = frame(["26001", "26003"], [box(0, 0, 1, 1), box(1, 0, 2, 1)])
        output, report = prepare_frames(tiger, cb, {"26"})
        a, b = [shape(f["geometry"]) for f in output["features"]]
        self.assertEqual([f["id"] for f in output["features"]], ["US_CNTY_26001", "US_CNTY_26003"])
        self.assertEqual(output["features"][0]["properties"]["cntr_code"], "US")
        self.assertEqual(output["features"][0]["properties"]["admin1_group"], "Michigan")
        self.assertEqual(output["features"][0]["properties"]["detail_tier"], "fine")
        self.assertEqual(a.bounds[2], 1.2)
        self.assertEqual(a.boundary.intersection(b.boundary).length, 1)
        self.assertEqual(report["states"][0]["unassigned_mask_area_km2"], 0)
        self.assertEqual(report["states"][0]["source_geoids"], ["26001", "26003"])
        self.assertEqual(report["states"][0]["display_geoids"], ["26001", "26003"])

    def test_mask_preserves_hole_and_does_not_fill_missing_source(self):
        mask = Polygon([(0, 0), (3, 0), (3, 3), (0, 3)], [[(1, 1), (2, 1), (2, 2), (1, 2)]])
        output, report = prepare_frames(frame(["12001"], [box(0, 0, 2.5, 3)]), frame(["12001"], [mask]), {"12"})
        geometry = shape(output["features"][0]["geometry"])
        self.assertEqual(geometry.intersection(box(1, 1, 2, 2)).area, 0)
        self.assertGreater(report["states"][0]["unassigned_mask_area_km2"], 0)

    def test_duplicates_crs_and_invalid_geometry_rejected(self):
        cb = frame(["26001"], [box(0, 0, 1, 1)])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            prepare_frames(frame(["26001", "26001"], [box(0, 0, 1, 1)] * 2), cb, {"26"})
        with self.assertRaisesRegex(ValueError, "crs_missing"):
            prepare_frames(cb.set_crs(None, allow_override=True), cb, {"26"})
        with self.assertRaisesRegex(ValueError, "invalid_polygon"):
            prepare_frames(frame(["26001"], [Polygon([(0, 0), (1, 1), (0, 1), (1, 0)])]), cb, {"26"})

    def test_cross_state_overlap_is_not_hidden_by_valid_states(self):
        source = frame(["26001", "12001"], [box(0, 0, 1.2, 1), box(1, 0, 2, 1)])
        _, report = prepare_frames(source, source, {"26", "12"})
        self.assertTrue(all(r["coverage_valid"] for r in report["states"]))
        self.assertFalse(report["global_coverage_valid"])
        with self.assertRaisesRegex(ValueError, "cross_state_coverage"):
            prepare_frames(source, source, {"26", "12"}, .002)


if __name__ == "__main__":
    unittest.main()
