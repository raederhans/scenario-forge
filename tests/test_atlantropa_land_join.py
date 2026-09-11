import unittest

import geopandas as gpd
from shapely.geometry import MultiPolygon, box, mapping

from tools.patch_tno_1962_bundle import (
    build_runtime_topology_payload, restore_atl_source_coast_contact, topology_object_to_gdf,
    match_atl_island_lineage,
    hydrate_atl_island_lineage,
    verify_atl_final_coast_contact,
    atl_sea_land_reference, build_atl_sea_completion_rows,
)


class AtlantropaLandJoinTests(unittest.TestCase):
    def test_replaced_island_footprint_is_available_for_sea_completion(self):
        mainland = box(-2, -2, 0, 2)
        old_island = box(1, 0, 2, 1)
        new_island = box(1.5, 0, 2.5, 1)
        reference = MultiPolygon([mainland, old_island])
        sea_reference = atl_sea_land_reference(reference, old_island)
        self.assertTrue(sea_reference.equals(mainland))
        template = box(0, -1, 3, 2)
        expected = template.difference(sea_reference.buffer(.03)).difference(new_island.buffer(.002))
        rows, sea, _ = build_atl_sea_completion_rows("test", {
            "group_label": "Test", "feature_group_id": "test", "precision_simplify_tolerance": .0025,
        }, expected_sea_geom=expected, existing_sea_geom=None, occupied_sea_geom=None)
        self.assertTrue(rows)
        self.assertTrue(sea.covers(box(1.05, .05, 1.4, .95)))
        self.assertEqual(sea.intersection(new_island).area, 0)
        self.assertEqual(sea.intersection(mainland).area, 0)

    def test_final_contact_checks_each_retained_fragment_across_owners(self):
        reference = box(-1, -1, 0, 2)
        required = [("ATLPRV_test", box(0, 0, 1, 1))]
        self.assertEqual(verify_atl_final_coast_contact(required, box(0, 0, 1, 1), reference), 1)
        disconnected = MultiPolygon([box(0, 0, .2, 1), box(.3, 0, 1, 1)])
        with self.assertRaisesRegex(ValueError, "disconnected.*ATLPRV_test"):
            verify_atl_final_coast_contact(required, disconnected, reference)
        # Detached islands outside the explicitly proven set are permitted.
        self.assertEqual(verify_atl_final_coast_contact(required,
            MultiPolygon([box(0, 0, 1, 1), box(2, 0, 3, 1)]), reference), 1)

    def test_compacted_lineage_requires_exact_old_geometry_match(self):
        published = {"properties": {"id": "ATLISL_x_1"}, "geometry": mapping(box(0, 0, 1, 1))}
        source = {"properties": {"id": "ATLISL_x_1", "donor_province_ids": [18259]}, "geometry": mapping(box(0, 0, 1, 1))}
        restored = hydrate_atl_island_lineage([published], [source])
        self.assertEqual(restored[0]["properties"]["donor_province_ids"], [18259])
        self.assertNotIn("donor_province_ids", published["properties"])
        source["geometry"] = mapping(box(1, 1, 2, 2))
        with self.assertRaisesRegex(ValueError, "geometry does not match"):
            hydrate_atl_island_lineage([published], [source])

    def test_enumerated_island_follows_donor_lineage_not_same_id(self):
        row = {"id": "ATLISL_x_1", "donor_province_ids": [2], "geometry": box(0, 0, 1, 1)}
        old_same_id = {"properties": {"id": "ATLISL_x_1", "donor_province_ids": [1]}, "geometry": mapping(box(0, 0, 1, 1))}
        old_source_match = {"properties": {"id": "ATLISL_x_2", "donor_province_ids": [2]}, "geometry": mapping(box(0, 0, 1, 1))}
        matches = match_atl_island_lineage(row, {(1,): [old_same_id], (2,): [old_source_match]})
        self.assertEqual(matches, [old_source_match])
        row["geometry"] = box(10, 10, 11, 11)
        self.assertEqual(match_atl_island_lineage(row, {(2,): [old_source_match]}), [])

    def setUp(self):
        self.land = box(-2, -2, 0, 2)

    def restore(self, geometry, source, width=0.05):
        return restore_atl_source_coast_contact(
            geometry, source, self.land, collar_width=width, feature_id="ATLPRV_test"
        )

    def test_restores_artificial_margin_without_inventing_land(self):
        source = box(-0.1, 0, 1, 1)
        retained = box(0.03, 0, 1, 1)
        result, count = self.restore(retained, source)
        self.assertEqual(count, 1)
        self.assertGreater(result.boundary.intersection(self.land.boundary).length, 0)
        self.assertEqual(result.difference(source).area, 0)
        self.assertEqual(result.intersection(self.land).area, 0)
        self.assertEqual(result.geom_type, "Polygon")

    def test_retains_real_strait_and_remote_island(self):
        source = MultiPolygon([box(0.02, 0, 1, 1), box(5, 0, 5.1, 0.1)])
        result, count = self.restore(source, source)
        self.assertEqual(count, 0)
        self.assertTrue(result.equals(source))
        self.assertGreater(result.distance(self.land), 0)

    def test_restores_mainland_contact_without_connecting_source_island(self):
        source = MultiPolygon([box(-0.1, 0, 1, 1), box(0.01, 1.5, 0.02, 1.6)])
        retained = MultiPolygon([box(0.03, 0, 1, 1), box(0.01, 1.5, 0.02, 1.6)])
        result, count = self.restore(retained, source)
        self.assertEqual(count, 1)
        self.assertEqual(len(result.geoms), 2)
        self.assertTrue(any(part.equals(source.geoms[1]) for part in result.geoms))

    def test_unrecoverable_connection_is_an_explicit_error(self):
        with self.assertRaisesRegex(ValueError, "ATLPRV_test.*cannot reach"):
            self.restore(box(0.1, 0, 1, 1), box(-0.1, 0, 1, 1))

    def test_one_connected_retained_part_does_not_hide_another_gap(self):
        source = box(-0.1, 0, 1, 1)
        retained = MultiPolygon([box(0, 0, 1, 0.4), box(0.03, 0.6, 1, 1)])
        result, count = self.restore(retained, source)
        self.assertEqual(count, 1)
        self.assertEqual(result.geom_type, "Polygon")
        self.assertEqual(result.difference(source).area, 0)

    def test_runtime_topology_preserves_dedicated_coastline_geometry(self):
        frame = gpd.GeoDataFrame([{"id": "base", "geometry": box(0, 0, 1, 1)}], crs="EPSG:4326")
        coastline = gpd.GeoDataFrame([{"id": "coast", "geometry": box(0, 0, 2, 1)}], crs="EPSG:4326")
        topology = build_runtime_topology_payload(frame, frame, frame, frame, coastline)
        restored = topology_object_to_gdf(topology, "scenario_coastline").geometry.iloc[0]
        self.assertTrue(restored.equals(coastline.geometry.iloc[0]))


if __name__ == "__main__":
    unittest.main()
