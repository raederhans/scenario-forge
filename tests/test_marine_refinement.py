import unittest
from unittest.mock import patch

from shapely.geometry import LineString, box, mapping, shape

from map_builder.geo import marine_refinement as marine


def feature(feature_id, geometry, **props):
    return {"type": "Feature", "properties": {"id": feature_id, **props}, "geometry": mapping(geometry)}


class MarineRefinementTests(unittest.TestCase):
    def test_source_seam_reconciliation_is_order_independent_and_keeps_union(self):
        a = feature("marine_north_sea", box(0, 0, 5, 5))
        b = feature("marine_norwegian_sea", box(0, 4, 5, 8))
        first = marine.reconcile_marine_source_boundaries({"features": [a, b]})
        second = marine.reconcile_marine_source_boundaries({"features": [b, a]})
        geometries = {f["properties"]["id"]: shape(f["geometry"]) for f in first["features"]}
        for f in second["features"]:
            self.assertTrue(shape(f["geometry"]).equals(geometries[f["properties"]["id"]]))
        left, right = geometries.values()
        self.assertEqual(left.intersection(right).area, 0)
        self.assertTrue(left.union(right).equals(box(0, 0, 5, 8)))

    def test_new_source_seams_keep_union_for_base_and_scenario_ids(self):
        pairs = (("barents_sea", "kara_sea"), ("kara_sea", "laptev_sea"),
                 ("laptev_sea", "east_siberian_sea"), ("beaufort_sea", "chukchi_sea"),
                 ("bering_sea", "bering_strait"), ("persian_gulf", "strait_of_hormuz"))
        for prefix in ("marine_", "tno_"):
            for parent, child in pairs:
                with self.subTest(prefix=prefix, parent=parent, child=child):
                    inputs = [feature(prefix + parent, box(0, 0, 5, 5)),
                              feature(prefix + child, box(4, 0, 7, 5))]
                    result = marine.reconcile_marine_source_boundaries({"features": inputs})
                    left, right = [shape(f["geometry"]) for f in result["features"]]
                    self.assertEqual(left.intersection(right).area, 0)
                    self.assertTrue(left.union(right).equals(box(0, 0, 7, 5)))
                    self.assertEqual(inputs[0]["geometry"], mapping(box(0, 0, 5, 5)))

    def test_shared_source_preserves_lakes_med_and_old_identity(self):
        lake = feature("lake", box(0, 0, 1, 1), water_type="lake")
        med = feature("med", box(2, 2, 3, 3), region_group="mediterranean")
        ocean = feature("ocean", box(0, 0, 10, 10), water_type="ocean")
        old = feature("sea", box(0, 0, 4, 4), name="Sea")
        new = feature("sea", box(0, 0, 3, 4), name="Sea")
        sector = feature("sector", box(-5, -5, 5, 5), water_type="ocean", parent_id="ocean")
        source = {"type": "FeatureCollection", "features": [lake, med, ocean, old]}
        with patch.object(marine, "load_collection", return_value={"features": [new, sector]}):
            result = marine.refine_base_water_regions(source)
        by_id = {f["properties"]["id"]: f for f in result["features"]}
        self.assertEqual(by_id["lake"], lake)
        self.assertEqual(by_id["med"], med)
        self.assertEqual(by_id["sea"], new)
        self.assertEqual(len(by_id), 5)
        self.assertTrue(shape(by_id["sector"]["geometry"]).equals(box(0, 0, 5, 5)))
        self.assertEqual(source["features"][-1], old)

    def test_legacy_ocean_union_recovers_subdivided_source_without_mutation(self):
        parent = feature("ocean", box(5, 0, 10, 10), water_type="ocean")
        child = feature("sector", box(0, 0, 5, 10), water_type="ocean", parent_id="ocean")
        original = {"type": "FeatureCollection", "features": [parent, child]}
        result = marine.restore_ocean_parent_footprints(original)
        self.assertTrue(shape(result["features"][0]["geometry"]).equals(box(0, 0, 10, 10)))
        self.assertEqual(original["features"][0], parent)

    def test_supplement_is_public_polygon_data_with_unique_source_ids(self):
        source = marine.load_collection(marine.ADDITIONAL_SOURCE_PATH)
        self.assertEqual(len(source["features"]), len(marine.ADDITIONAL_SEAS) + len(marine.OCEAN_SECTORS))
        ids = [f["properties"]["id"] for f in source["features"]]
        self.assertEqual(len(set(ids)), len(ids))
        for f in source["features"]:
            self.assertTrue(shape(f["geometry"]).is_valid)
            self.assertFalse(shape(f["geometry"]).is_empty)
            self.assertEqual(f["properties"]["source_feature_count"], 1)
            self.assertTrue(f["properties"]["source_record_ids"])
            self.assertNotIn("scenario_id", f["properties"])
        tno = marine.additional_snapshot_features()
        self.assertEqual(len(tno), len(marine.ADDITIONAL_SEAS))
        self.assertTrue(all(f["properties"]["id"].startswith("tno_") for f in tno))

    def test_strait_interior_corridors_remain_continuous_after_coast_clipping(self):
        # Interior tracks around coastal land, not straight shortcuts across it.
        corridors = {
            "bering_strait": [(-168.8, 65.4), (-168.8, 66.1)],
            "strait_of_hormuz": [(56.1, 26.5), (56.3, 26.6), (56.8, 26.6), (56.9, 26.3)],
            "florida_strait": [(-81, 24), (-80.5, 24)],
        }
        for relative, prefix in (("data/water_regions.geojson", "marine_"),
                                 ("data/scenarios/tno_1962/water_regions.geojson", "tno_")):
            features = {f["properties"]["id"]: f for f in marine.load_collection(marine.ROOT / relative)["features"]}
            for slug, points in corridors.items():
                with self.subTest(asset=relative, strait=slug):
                    geometry = shape(features[prefix + slug]["geometry"])
                    self.assertTrue(geometry.covers(LineString(points)))

    def test_published_marine_partitions_do_not_overlap_across_hierarchy_levels(self):
        from shapely.strtree import STRtree
        for relative in ("data/water_regions.geojson", "data/scenarios/tno_1962/water_regions.geojson"):
            collection = marine.load_collection(marine.ROOT / relative)
            features = [f for f in collection["features"] if f["properties"].get("region_group") in {"marine_macro", "marine_detail", "ocean_macro"}]
            geometries = [shape(f["geometry"]) for f in features]
            tree = STRtree(geometries)
            prefix = "tno_" if "tno_1962" in relative else "marine_"
            ids = {f["properties"]["id"] for f in features}
            self.assertTrue({prefix + row[0] for row in marine.ADDITIONAL_SEAS} <= ids)
            for index, geometry in enumerate(geometries):
                self.assertTrue(geometry.is_valid, features[index]["properties"]["id"])
                self.assertFalse(geometry.is_empty, features[index]["properties"]["id"])
                for other in tree.query(geometry, predicate="intersects"):
                    if other <= index:
                        continue
                    # Integer-grid encoding may move a shared edge by one cell.
                    # Check exclusive interiors beyond that measured resolution,
                    # not exact floating-point equality at serialized boundaries.
                    grid = collection.get("water_geometry_quantization", {}).get("grid_degrees", [1e-9, 1e-9])
                    margin = (grid[0] ** 2 + grid[1] ** 2) ** 0.5
                    overlap = geometry.intersection(geometries[other]).buffer(-margin).area
                    self.assertLessEqual(overlap, 1e-8, (relative, features[index]["properties"]["id"], features[other]["properties"]["id"], overlap))


if __name__ == "__main__":
    unittest.main()
