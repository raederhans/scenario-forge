import unittest

import shapely
from shapely.geometry import Polygon, box

from tools.pilot_tno_russia_precision import boundary_equal, constrained_partition, simplify_owner_interior, node_owner_interfaces
from tools.prepare_tno_russia_precision import indexed_hausdorff, parent_id


class RussiaPrecisionTests(unittest.TestCase):
    def test_internal_detail_changes_but_outer_domain_is_fixed(self):
        old = {"A": box(0, 0, 1, 2), "B": box(1, 0, 2, 2)}
        edge = [(1, 0), (1.15, .5), (.85, 1), (1.1, 1.5), (1, 2)]
        source = {"P": Polygon([(0, 0), *edge, (0, 2)]),
                  "Q": Polygon([*edge, (2, 2), (2, 0)])}
        result, report = constrained_partition(old, source, {"A": "P", "B": "Q"})
        self.assertTrue(boundary_equal(result["A"], source["P"]))
        self.assertTrue(shapely.union_all(list(result.values())).equals(box(0, 0, 2, 2)))
        self.assertTrue(report["owner_domain_preserved"])
        self.assertTrue(shapely.coverage_is_valid(list(result.values())))

    def test_source_cannot_expand_owner_or_fill_existing_water_hole(self):
        original = Polygon([(0, 0), (3, 0), (3, 3), (0, 3)],
                           holes=[[(1, 1), (2, 1), (2, 2), (1, 2)]])
        result, _ = constrained_partition({"A": original}, {"P": box(-1, -1, 4, 4)}, {"A": "P"})
        self.assertTrue(result["A"].equals(original))

    def test_split_children_keep_identity_when_source_is_unsplit(self):
        old = {"P__tno1962_2": box(2, 0, 3, 2), "P__tno1962_1": box(0, 0, 1, 2)}
        result, _ = constrained_partition(old, {"P": box(-1, -1, 4, 3)}, {fid: "P" for fid in old})
        for fid in old:
            self.assertTrue(result[fid].equals(old[fid]))

    def test_baseline_only_extension_keeps_original_identity(self):
        old = {"A": box(0, 0, 1, 1), "B": box(1, 0, 2, 1)}
        result, _ = constrained_partition(old, {"P": box(.1, .1, 1, .9), "Q": box(1, .1, 1.9, .9)},
                                          {"A": "P", "B": "Q"})
        for fid in old:
            self.assertTrue(result[fid].equals(old[fid]))

    def test_missing_parent_and_overlapping_source_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "Unresolved"):
            constrained_partition({"A": box(0, 0, 1, 1)}, {}, {"A": "P"})
        with self.assertRaisesRegex(ValueError, "shared coverage"):
            constrained_partition({"A": box(0, 0, 1, 1), "B": box(1, 0, 2, 1)},
                                  {"P": box(0, 0, 1.5, 1), "Q": box(1, 0, 2, 1)}, {"A": "P", "B": "Q"})

    def test_split_suffix_only_removed_at_end(self):
        self.assertEqual(parent_id("RU_RAY_123__tno1962_3"), "RU_RAY_123")
        self.assertEqual(parent_id("RU_RAY_123"), "RU_RAY_123")

    def test_overlapping_old_edges_use_unique_source_parent_and_record_decision(self):
        old = {"A": box(0, 0, 1.2, 1), "B": box(1, 0, 2, 1)}
        result, report = constrained_partition(old, {"P": box(0, 0, .9, 1), "Q": box(1.1, 0, 2, 1)},
                                              {"A": "P", "B": "Q"})
        self.assertTrue(shapely.coverage_is_valid(list(result.values())))
        self.assertTrue(shapely.union_all(list(result.values())).equals(box(0, 0, 2, 1)))
        self.assertTrue(report["baseline_overlap_resolutions"])

    def test_shared_interior_simplification_preserves_domain(self):
        edge = [(1 + (.0001 if i % 2 else 0), i / 20) for i in range(21)]
        geoms = {"A": Polygon([(0, 0), *edge, (0, 1)]), "B": Polygon([*edge, (2, 1), (2, 0)])}
        result, report = simplify_owner_interior(geoms)
        self.assertLess(report["coordinates_after"], report["coordinates_before"])
        self.assertTrue(shapely.union_all(list(result.values())).equals(shapely.union_all(list(geoms.values()))))

    def test_interface_nodes_are_inserted_but_true_overlap_is_rejected(self):
        values = {"A": box(0, 0, 1, 2), "B": box(1, 0, 2, 1), "C": box(1, 1, 2, 2)}
        result = node_owner_interfaces(values)
        self.assertTrue(shapely.coverage_is_valid(list(result.values())))
        for fid in values:
            self.assertTrue(result[fid].equals(values[fid]))
        with self.assertRaisesRegex(ValueError, "true overlap"):
            node_owner_interfaces({"A": box(0, 0, 1.1, 1), "B": box(1, 0, 2, 1)})
        report = {}
        result = node_owner_interfaces({"A": box(0, 0, 1+1e-13, 1), "B": box(1, 0, 2, 1)}, report)
        self.assertTrue(shapely.coverage_is_valid(list(result.values())))
        self.assertTrue(report["numerical_boundary_slivers"])

    def test_indexed_measurement_matches_geos_with_holes_and_long_edges(self):
        fixtures = [
            (box(0, 0, 10, 10), box(.1, .2, 11, 9)),
            (Polygon([(0, 0), (20, 0), (20, 2), (0, 2)], holes=[[(1, .5), (2, .5), (2, 1), (1, 1)]]), box(0, 0, 20, 2)),
            (shapely.union_all([box(0, 0, 1, 1), box(10, 10, 11, 11)]), box(0, 0, 1, 1)),
        ]
        for a, b in fixtures:
            with self.subTest(a=a.wkt):
                self.assertAlmostEqual(indexed_hausdorff(a, b), shapely.hausdorff_distance(a, b), places=12)


if __name__ == "__main__":
    unittest.main()
