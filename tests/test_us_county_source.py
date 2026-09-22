import tempfile
import unittest
import hashlib
from pathlib import Path

import geopandas as gpd
import shapely
from shapely.geometry import Polygon, box, shape

from tools.prepare_us_county_source import bind_display_bytes, prepare_frames, repair_clip_overlap_from_source, safe_output_directory, selected_states


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

    def test_simplification_preserves_union_and_shared_boundary(self):
        line = [(1, 0), (1.001, .3), (.999, .7), (1, 1)]
        a = Polygon([(0, 0)] + line + [(0, 1)])
        b = Polygon(line + [(2, 1), (2, 0)])
        source = frame(["26001", "26003"], [a, b])
        output, report = prepare_frames(source, source, {"26"}, .1)
        shapes = [shape(f["geometry"]) for f in output["features"]]
        self.assertTrue(shapely.union_all(shapes).equals(box(0, 0, 2, 1)))
        self.assertTrue(shapely.coverage_is_valid(shapes))
        self.assertLess(report["display_coordinates"], report["clipped_coordinates"])

    def test_overlap_cannot_be_simplified_away(self):
        source = frame(["26001", "26003"], [box(0, 0, 1.2, 1), box(1, 0, 2, 1)])
        _, report = prepare_frames(source, source, {"26"})
        self.assertFalse(report["states"][0]["coverage_valid"])
        with self.assertRaisesRegex(ValueError, "requires_valid_coverage"):
            prepare_frames(source, source, {"26"}, .01)

    def test_state_selection_and_output_safety(self):
        self.assertEqual(selected_states("MI,FL"), {"26", "12"})
        self.assertEqual(len(selected_states()), 51)
        with self.assertRaises(ValueError):
            selected_states("PR")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(safe_output_directory(root / ".runtime" / "stage", root), root / ".runtime" / "stage")
            for bad in (root / "data", root / ".runtime", root / ".runtime" / ".." / "data"):
                with self.assertRaises(ValueError):
                    safe_output_directory(bad, root)

    def test_legal_name_and_dc_metadata(self):
        source = frame(["11001"], [box(0, 0, 1, 1)]).to_crs(4269)
        source["NAME"] = "Washington"
        source["NAMELSAD"] = "District of Columbia"
        output, report = prepare_frames(source, source, {"11"})
        props = output["features"][0]["properties"]
        self.assertEqual(props["name"], "District of Columbia")
        self.assertEqual(props["admin1_group"], "District of Columbia")
        self.assertEqual(report["source_crs"]["tiger"], "EPSG:4269")

    def test_clip_overlap_requires_exact_source_exclusion_and_preserves_union(self):
        originals = [box(0, 0, 1, 1), box(1, 0, 2, 1)]
        clipped = [originals[0], box(.9999999999999999, 0, 2, 1)]
        repaired, records = repair_clip_overlap_from_source(clipped, originals)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["removed_from_index"], 1)
        self.assertTrue(shapely.coverage_is_valid(repaired))
        self.assertTrue(shapely.union_all(repaired).equals(shapely.union_all(clipped)))
        ambiguous = [box(0, 0, 1.1, 1), box(.9, 0, 2, 1)]
        _, records = repair_clip_overlap_from_source(ambiguous, originals)
        self.assertEqual(records, [])

    def test_joint_noding_preserves_county_domains_without_tolerance(self):
        originals = [box(0, 0, 1, 1), box(1, 0, 2, 1)]
        clipped = [Polygon([(0, 0), (1, 0), (1, .5), (1, 1), (0, 1)]), originals[1]]
        self.assertFalse(shapely.coverage_is_valid(clipped))
        repaired, records = repair_clip_overlap_from_source(clipped, originals)
        self.assertTrue(shapely.coverage_is_valid(repaired))
        self.assertTrue(all(a.equals(b) for a, b in zip(clipped, repaired)))
        self.assertEqual(records[0]["method"], "joint_boundary_noding_unique_original_source_faces")

    def test_cross_state_overlap_is_not_hidden_by_valid_states(self):
        source = frame(["26001", "12001"], [box(0, 0, 1.2, 1), box(1, 0, 2, 1)])
        _, report = prepare_frames(source, source, {"26", "12"})
        self.assertTrue(all(r["coverage_valid"] for r in report["states"]))
        self.assertFalse(report["global_coverage_valid"])
        with self.assertRaisesRegex(ValueError, "cross_state_coverage"):
            prepare_frames(source, source, {"26", "12"}, .002)

    def test_report_binds_exact_bytes_and_retains_empty_source_members(self):
        tiger = frame(["26001", "26003"], [box(0, 0, 1, 1), box(2, 0, 3, 1)])
        cb = frame(["26001"], [box(0, 0, 1, 1)])
        _, report = prepare_frames(tiger, cb, {"26"})
        self.assertEqual(report["states"][0]["source_geoids"], ["26001", "26003"])
        self.assertEqual(report["states"][0]["display_geoids"], ["26001"])
        data = b'{"type":"FeatureCollection","features":[]}\n'
        bind_display_bytes(report, data)
        self.assertEqual(report["display_geojson_sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(report["display_geojson_bytes"], len(data))
        self.assertNotEqual(report["display_geojson_sha256"], hashlib.sha256(data.rstrip()).hexdigest())


if __name__ == "__main__":
    unittest.main()
