import copy
import unittest

from shapely.geometry import Polygon, LineString, box, mapping, shape
from shapely.ops import unary_union
from tools.build_river_partitions import partition_parent


def feature(geometry, fid="P"):
    return {"type": "Feature", "properties": {"id": fid}, "geometry": mapping(geometry)}


class RiverPartitionTests(unittest.TestCase):
    def test_crossing_preserves_parent(self):
        f = feature(box(0, 0, 2, 2))
        before = copy.deepcopy(f)
        entry, report = partition_parent(f, [LineString([(-1, 1), (3, 1)])])
        self.assertEqual(report["status"], "partitioned")
        self.assertEqual(len(entry["cells"]), 2)
        self.assertEqual(f, before)
        self.assertTrue(unary_union([shape(c["geometry"]) for c in entry["cells"]]).equals(shape(f["geometry"])))

    def test_interior_endpoint_does_not_invent_cut(self):
        entry, report = partition_parent(feature(box(0, 0, 2, 2)), [LineString([(-1, 1), (1, 1)])])
        self.assertIsNone(entry)
        self.assertEqual(report["status"], "uncut")

    def test_existing_border_is_not_a_partition(self):
        entry, report = partition_parent(feature(box(0, 0, 2, 2)), [LineString([(0, 0), (2, 0)])])
        self.assertIsNone(entry)
        self.assertEqual(report["status"], "uncut")

    def test_hole_is_not_filled(self):
        polygon = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], [[(1, 1), (1, 3), (3, 3), (3, 1)]])
        entry, report = partition_parent(feature(polygon), [LineString([(-1, 2), (5, 2)])])
        self.assertEqual(report["status"], "partitioned")
        combined = unary_union([shape(c["geometry"]) for c in entry["cells"]])
        self.assertEqual(combined.area, polygon.area)
        self.assertEqual(combined.intersection(box(1, 1, 3, 3)).area, 0)

    def test_no_sliver_deletion(self):
        entry, report = partition_parent(feature(box(0, 0, 2, 2)), [LineString([(-1, .00001), (3, .00001)])])
        self.assertEqual(report["status"], "partitioned")
        self.assertEqual(len(entry["cells"]), 2)
        self.assertLess(min(shape(c["geometry"]).area for c in entry["cells"]), .0001)

    def test_partition_budget_rejects_instead_of_truncating(self):
        entry, report = partition_parent(feature(box(0, 0, 2, 2)),
                                         [LineString([(-1, .5), (3, .5)]), LineString([(-1, 1.5), (3, 1.5)])], max_parts=2)
        self.assertIsNone(entry)
        self.assertEqual(report["status"], "rejected")


if __name__ == "__main__":
    unittest.main()
