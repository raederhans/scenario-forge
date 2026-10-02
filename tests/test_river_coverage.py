"""Coverage triage must distinguish actual cuts from pre-existing islands."""
import unittest

from shapely.geometry import MultiPolygon, box

from tools.river_partitions.survey_coverage import secondary_cut_share


class SecondaryCutShareTests(unittest.TestCase):
    def test_uncut_island_does_not_count_as_a_bank(self):
        mainland, island = box(0, 0, 10, 10), box(20, 0, 30, 10)
        self.assertEqual(secondary_cut_share(MultiPolygon([mainland, island]), [mainland, island]), 0)

    def test_only_secondary_faces_of_cut_components_count(self):
        mainland, island = box(0, 0, 10, 10), box(20, 0, 25, 10)
        cells = [box(0, 0, 8, 10), box(8, 0, 10, 10), island]
        self.assertAlmostEqual(secondary_cut_share(MultiPolygon([mainland, island]), cells), 20 / 150)

    def test_multiple_cut_components_and_tiny_faces_are_retained(self):
        parent = MultiPolygon([box(0, 0, 10, 10), box(20, 0, 30, 10)])
        cells = [box(0, 0, 5, 10), box(5, 0, 10, 10),
                 box(20, 0, 29.999999, 10), box(29.999999, 0, 30, 10)]
        self.assertAlmostEqual(secondary_cut_share(parent, cells), (50 + .00001) / 200)


if __name__ == "__main__":
    unittest.main()
