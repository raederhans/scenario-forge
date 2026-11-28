import unittest

from shapely.geometry import MultiPolygon, box

from tools.patch_tno_1962_bundle import restore_atl_source_coast_contact


class AtlantropaLandJoinTests(unittest.TestCase):
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

    def test_unrecoverable_connection_is_an_explicit_error(self):
        with self.assertRaisesRegex(ValueError, "ATLPRV_test.*cannot reach"):
            self.restore(box(0.1, 0, 1, 1), box(-0.1, 0, 1, 1))


if __name__ == "__main__":
    unittest.main()
