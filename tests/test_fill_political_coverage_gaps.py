import copy
import unittest
from shapely.geometry import Polygon, box
from shapely import STRtree
from map_builder.regional_geometry import _decode_geometry, _encode_exact_coverage
from tools.fill_political_coverage_gaps import (
    fill_topology,
    merge_assigned_holes,
    validate_coverage,
    rewrite_shared_arcs,
    shared_arc_lengths,
)


def topology_for(*geometries):
    topology = _encode_exact_coverage([f"feature_{i}" for i in range(len(geometries))], geometries)
    for i, row in enumerate(topology["objects"]["political"]["geometries"]):
        row["id"] = f"top_level_{i}"
        row["properties"].update(owner=f"owner_{i}", name=f"Name {i}")
    topology["objects"]["political"]["computed_neighbors"] = [[] for _ in geometries]
    bounds = (min(g.bounds[0] for g in geometries), min(g.bounds[1] for g in geometries),
              max(g.bounds[2] for g in geometries), max(g.bounds[3] for g in geometries))
    topology["objects"]["land"] = {"type": "Polygon", "arcs": [[len(topology["arcs"])]]}
    topology["arcs"].append(list(map(list, box(*bounds).exterior.coords)))
    return topology


def decoded(topology):
    return [_decode_geometry(topology, row) for row in topology["objects"]["political"]["geometries"]]


class FillPoliticalCoverageGapsTest(unittest.TestCase):
    def test_split_old_arc_is_shared_by_unchanged_neighbor_and_other_objects(self):
        topology = {"type": "Topology", "arcs": [
            [[1, 0], [1, 2]], [[1, 2], [0, 2], [0, 0], [1, 0]],
            [[1, 0], [2, 0], [2, 2], [1, 2]],
        ], "objects": {"political": {"type": "GeometryCollection", "geometries": [
            {"type": "Polygon", "properties": {"id": "left"}, "arcs": [[0, 1]]},
            {"type": "Polygon", "properties": {"id": "right"}, "arcs": [[-1, 2]]},
        ]}, "coastline": {"type": "LineString", "arcs": [0]}}}
        before = shared_arc_lengths(topology)
        encoded = copy.deepcopy(topology)
        encoded["arcs"][0] = [[1, 0], [1, 1]]
        encoded["arcs"].append([[1, 1], [1, 2]])
        encoded["objects"]["political"]["geometries"][0]["arcs"] = [[0, 3, 1]]
        rewrite_shared_arcs(topology, encoded, {0})
        self.assertLess(abs(shared_arc_lengths(topology)[("left", "right")] - before[("left", "right")]), 1)
        self.assertEqual(len(topology["objects"]["coastline"]["arcs"]), 2)
        self.assertTrue(decoded(topology)[1].equals(box(1, 0, 2, 2)))

    def test_snap_does_not_discard_a_narrow_hole_above_area_tolerance(self):
        shell = box(0, 0, 0.02, 0.02)
        hole = box(0.01, 0.005, 0.010000001, 0.015)
        geometry = shell.difference(hole)
        updated = merge_assigned_holes(geometry, [hole], [geometry], STRtree([geometry]))
        self.assertLess(updated.symmetric_difference(shell).area, 1e-12)

    def test_coverage_validation_rejects_missing_coverage_and_overlap(self):
        left, right = box(0, 0, 1, 1), box(1, 0, 2, 1)
        rows = topology_for(left, right)["objects"]["political"]["geometries"]
        self.assertEqual(validate_coverage(rows, [[left], [right]], [left, right], {0, 1}, {}), [[1], [0]])
        with self.assertRaisesRegex(ValueError, "differs"):
            validate_coverage(rows, [[left], [right]], [box(0, 0, 0.99, 1), right], {0}, {})
        with self.assertRaisesRegex(ValueError, "overlap"):
            validate_coverage(rows, [[box(0, 0, 1.01, 1)], [right]], [box(0, 0, 1.01, 1), right], {0}, {})

    def seam(self):
        hole = box(0.009, 0.002, 0.010, 0.018)
        left = box(0, 0, 0.010, 0.020).difference(hole)
        right = Polygon([(0.010, 0), (0.020, 0), (0.020, 0.020), (0.010, 0.020),
                         (0.010, 0.018), (0.010, 0.002), (0.010, 0)])
        return topology_for(left, right), hole

    def test_lake_hole_is_not_filled(self):
        topology, hole = self.seam()
        original = copy.deepcopy(topology)
        self.assertEqual(fill_topology(topology, [hole])["hole_count"], 0)
        self.assertEqual(topology, original)

    def test_feature_inner_ring_is_filled_into_itself(self):
        shell = box(0, 0, 0.020, 0.020)
        hole = box(0.005, 0.005, 0.015, 0.015)
        topology = topology_for(shell.difference(hole))
        self.assertEqual(fill_topology(topology)["hole_count"], 1)
        self.assertTrue(decoded(topology)[0].equals(shell))


if __name__ == "__main__":
    unittest.main()
