import unittest

import shapely
from shapely.geometry import Polygon, box

from tools.pilot_tno_russia_precision import boundary_equal, constrained_partition, node_owner_interfaces


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


if __name__ == "__main__":
    unittest.main()
