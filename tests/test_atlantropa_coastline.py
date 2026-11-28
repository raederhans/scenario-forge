import unittest
from shapely.geometry import Polygon, box, mapping
from tools.atlantropa_coastline import build_atlantropa_land_reference, build_scenario_coastline_geometry


class AtlantropaCoastlineTest(unittest.TestCase):
    def test_shared_reference_preserves_source_holes_and_supports_explicit_cuts(self):
        canonical = Polygon([(0, 0), (5, 0), (5, 5), (0, 5)], [[(1, 1), (1, 2), (2, 2), (2, 1)]])
        protrusion = box(4, 0, 6, 5)
        reference = build_atlantropa_land_reference(canonical, [protrusion], [(4, 0, 5, 5)])
        self.assertEqual(len(reference.interiors), 1)
        cut = box(4.5, 1, 5.5, 2)
        result = build_scenario_coastline_geometry(reference, [], removed_land_geometry=cut)
        self.assertEqual(len(result.interiors), 2)
        self.assertTrue(result.equals(reference.difference(cut)))

    def test_union_removes_attached_seam_but_preserves_lakes_and_islands(self):
        mainland = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], [[(1, 1), (1, 2), (2, 2), (2, 1)]])
        baseline = mainland.union(box(8, 0, 9, 1))
        features = [
            {"properties": {"atl_render_layer": layer}, "geometry": mapping(geometry)}
            for layer, geometry in [("land", box(4, 0, 6, 4)), ("shoal", box(6, 0, 7, 4)), ("sea", box(0, 4, 6, 7))]
        ]
        result = build_scenario_coastline_geometry(baseline, features)
        self.assertTrue(result.equals(baseline.union(box(4, 0, 6, 4))))
        self.assertEqual(result.boundary.intersection(box(3.99, 1, 4.01, 3)).length, 0)
        self.assertEqual(sum(len(part.interiors) for part in result.geoms), 1)

    def test_explicit_scenario_cuts_preserve_new_lake_and_replace_island(self):
        base = box(0, 0, 5, 5).union(box(8, 0, 9, 1))
        cuts = box(1, 1, 2, 2).union(box(8, 0, 9, 1))
        addition = box(8, 0, 8.5, 1)
        result = build_scenario_coastline_geometry(base, [
            {"properties": {"atl_render_layer": "land"}, "geometry": mapping(addition)}
        ], removed_land_geometry=cuts)
        self.assertTrue(result.equals(base.difference(cuts).union(addition)))
