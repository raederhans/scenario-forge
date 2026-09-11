import unittest
from unittest.mock import patch

from shapely.geometry import GeometryCollection, LineString, Polygon, box, mapping
from shapely.ops import unary_union

from tools.atlantropa_coastline import build_atlantropa_land_reference, build_scenario_coastline_geometry


class AtlantropaCoastlineTest(unittest.TestCase):
    def test_shared_reference_keeps_whole_intersecting_features_and_global_land(self):
        canonical = box(0, 0, 2, 2).union(box(20, 20, 21, 21))
        crossing = box(1, 1, 5, 5)
        unselected = box(8, 8, 9, 9)
        result = build_atlantropa_land_reference(canonical, [crossing, unselected], [(1, 1, 3, 3)])
        self.assertTrue(result.equals(canonical.union(crossing)))
        self.assertTrue(result.covers(box(4, 4, 5, 5)))
        self.assertFalse(result.intersects(unselected))

    def test_shared_reference_preserves_source_holes_and_supports_explicit_cuts(self):
        canonical = Polygon([(0, 0), (5, 0), (5, 5), (0, 5)], [[(1, 1), (1, 2), (2, 2), (2, 1)]])
        protrusion = box(4, 0, 6, 5)
        reference = build_atlantropa_land_reference(canonical, [protrusion], [(4, 0, 5, 5)])
        self.assertEqual(len(reference.interiors), 1)
        cut = box(4.5, 1, 5.5, 2)
        result = build_scenario_coastline_geometry(reference, [], removed_land_geometry=cut)
        self.assertEqual(len(result.interiors), 2)
        self.assertTrue(result.equals(reference.difference(cut)))

    def test_shared_reference_repairs_invalid_selected_feature_without_buffering(self):
        canonical = box(-2, -2, -1, -1)
        bowtie = Polygon([(0, 0), (2, 2), (2, 0), (0, 2), (0, 0)])
        result = build_atlantropa_land_reference(canonical, [bowtie], [(0, 0, 1, 1)])
        self.assertTrue(result.is_valid)
        self.assertAlmostEqual(result.area, 3)

    def test_shared_reference_political_coverage_cannot_fill_canonical_lake(self):
        coast = Polygon([(0, 0), (5, 0), (5, 5), (0, 5)], [[(1, 1), (1, 4), (4, 4), (4, 1)]])
        island = box(2, 2, 3, 3)
        canonical = coast.union(island)
        political = box(0, 0, 6, 5)
        result = build_atlantropa_land_reference(canonical, [political], [(4, 0, 6, 5)])
        self.assertTrue(result.equals(canonical.union(box(5, 0, 6, 5))))
        self.assertTrue(result.covers(island))

    def test_shared_reference_accepts_geos_polygon_with_zero_area_boundary_remnant(self):
        canonical = box(0, 0, 2, 2)
        calls = 0

        def union_with_boundary_remnant(geometries):
            nonlocal calls
            calls += 1
            surface = unary_union(geometries)
            if calls == 2:
                # GEOS may return a valid mixed-dimensional collection. Its
                # boundary remnant is not part of the land surface contract.
                return GeometryCollection([surface, LineString([(3, 0), (4, 0)])])
            return surface

        with patch("tools.atlantropa_coastline.unary_union", side_effect=union_with_boundary_remnant):
            result = build_atlantropa_land_reference(canonical, [], [(0, 0, 2, 2)])
        self.assertEqual(result.geom_type, "Polygon")
        self.assertTrue(result.equals(canonical))

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
