import copy
import json
from pathlib import Path
import random
import unittest

from shapely.geometry import Polygon, MultiPolygon, LineString, box, mapping, shape
from shapely.ops import unary_union
from tools.build_river_partitions import (
    build_pack, canonical_geometry, decode_features, geometry_fingerprint,
    partition_parent, select_rivers, node_contour_neighbors,
)


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

    def test_multiple_crossings_retain_every_piece(self):
        line = LineString([(-1, .5), (3, .5), (3, 1.5), (-1, 1.5)])
        entry, _ = partition_parent(feature(box(0, 0, 2, 2)), [line])
        self.assertEqual(len(entry["cells"]), 3)

    def test_hole_is_not_filled(self):
        polygon = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], [[(1, 1), (1, 3), (3, 3), (3, 1)]])
        entry, report = partition_parent(feature(polygon), [LineString([(-1, 2), (5, 2)])])
        self.assertEqual(report["status"], "partitioned")
        combined = unary_union([shape(c["geometry"]) for c in entry["cells"]])
        self.assertEqual(combined.area, polygon.area)
        self.assertEqual(combined.intersection(box(1, 1, 3, 3)).area, 0)

    def test_disconnected_original_is_not_a_new_cut(self):
        polygon = MultiPolygon([box(0, 0, 1, 1), box(2, 0, 3, 1)])
        entry, report = partition_parent(feature(polygon), [LineString([(0, 0), (3, 0)])])
        self.assertIsNone(entry)
        self.assertEqual(report["status"], "uncut")

    def test_rejects_invalid_and_global_geometry(self):
        bowtie = Polygon([(0, 0), (2, 2), (0, 2), (2, 0), (0, 0)])
        for polygon in (bowtie, box(-179, 0, 179, 2), box(0, 85, 1, 86)):
            entry, report = partition_parent(feature(polygon), [LineString([(-1, 1), (3, 1)])])
            self.assertIsNone(entry)
            self.assertEqual(report["status"], "rejected")

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

    def test_stable_identity_under_ring_reversal_and_line_order(self):
        f = feature(box(0, 0, 2, 2))
        reverse = copy.deepcopy(f)
        reverse["geometry"]["coordinates"] = [list(reversed(r)) for r in f["geometry"]["coordinates"]]
        self.assertEqual(geometry_fingerprint(f["geometry"]), geometry_fingerprint(reverse["geometry"]))
        a = LineString([(-1, .5), (3, .5)])
        b = LineString([(-1, 1.5), (3, 1.5)])
        left, _ = partition_parent(f, [a, b])
        right, _ = partition_parent(reverse, [LineString(list(b.coords)[::-1]), a])
        self.assertEqual([c["id"] for c in left["cells"]], [c["id"] for c in right["cells"]])

    def test_decode_delta_and_reverse_arcs(self):
        topology = {"type": "Topology", "transform": {"scale": [1, 1], "translate": [10, 20]},
                    "arcs": [[[0, 0], [2, 0], [0, 2]], [[0, 0], [0, 2], [2, 0]]],
                    "objects": {"political": {"type": "GeometryCollection", "geometries": [
                        {"type": "Polygon", "properties": {"id": "P"}, "arcs": [[0, -2]]}]}}}
        decoded = decode_features(topology)
        self.assertEqual(shape(decoded[0]["geometry"]).area, 4)
        self.assertEqual(decoded[0]["geometry"]["coordinates"][0][0], [10, 20])

    def test_river_selection_is_explicit(self):
        rivers = [{"type": "Feature", "properties": {"name": "Volga", "featurecla": kind},
                   "geometry": mapping(LineString([(i, 0), (i, 2)]))}
                  for i, kind in enumerate(["River", "Lake Centerline", "Canal"])]
        self.assertEqual(len(select_rivers(rivers, ["volga"])), 1)
        self.assertEqual(len(select_rivers(rivers, ["Volga"], True)), 2)
        with self.assertRaises(ValueError):
            select_rivers(rivers, ["missing"])

    def test_pack_requires_unique_ids_and_source_scope(self):
        f = feature(box(0, 0, 2, 2))
        river = [LineString([(-1, 1), (3, 1)])]
        with self.assertRaises(ValueError):
            build_pack([f, f], river, scene_id="test", source={})
        with self.assertRaises(ValueError):
            build_pack([f], river, scene_id="test", source={}, parent_ids={"missing"})
        a, _ = build_pack([f], river, scene_id="test", source={"revision": "1"})
        b, _ = build_pack([f], river, scene_id="other", source={"revision": "1"})
        self.assertNotEqual(a["packId"], b["packId"])

    def test_stendal_joint_noding_regression(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/river_paint/stendal.json").read_text())
        lines = select_rivers(fixture["rivers"], ["Elbe"])
        entry, report = partition_parent(fixture["parent"], lines)
        self.assertEqual(report["status"], "partitioned")
        self.assertEqual(len(entry["cells"]), fixture["expectedCells"])
        self.assertEqual(report["symmetricDifferenceDegrees2"], 0)
        self.assertEqual(report["overlapDegrees2"], 0)

    def test_neighbor_noding_preserves_domain_and_cut_endpoint(self):
        left = feature(box(0, 0, 2, 2), "P")
        right = feature(box(2, 0, 4, 2), "N")
        entry, _ = partition_parent(left, [LineString([(-1, .375), (3, .375)])])
        original = copy.deepcopy(right)
        support, checks = node_contour_neighbors([left, right], [entry])
        self.assertEqual(len(support), 1)
        self.assertEqual(right, original)
        self.assertTrue(shape(support[0]["geometry"]).equals(shape(right["geometry"])))
        self.assertIn((2, .375), list(shape(support[0]["geometry"]).exterior.coords))
        self.assertEqual(checks[0]["symmetricDifferenceDegrees2"], 0)

    def test_seeded_crossings_preserve_coverage(self):
        rng = random.Random(191)
        for _ in range(80):
            y = rng.uniform(.01, 1.99)
            entry, report = partition_parent(feature(box(0, 0, 2, 2)), [LineString([(-1, y), (3, y)])])
            self.assertEqual(report["status"], "partitioned")
            self.assertEqual(report["overlapDegrees2"], 0)
            self.assertLessEqual(report["symmetricDifferenceDegrees2"], 1e-12)


if __name__ == "__main__":
    unittest.main()
