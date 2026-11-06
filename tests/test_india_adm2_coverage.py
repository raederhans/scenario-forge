from pathlib import Path
import unittest

import shapely
from shapely.geometry import Polygon, box

from map_builder.processors.south_asia import simplify_india_adm2_coverage
from map_builder.regional_geometry import _decode_geometry, _encode_exact_coverage
from tools.rebuild_polar_assets import read
from tools.repair_india_adm2_coverage import is_india_feature, repair_topology

ROOT = Path(__file__).resolve().parents[1]


def wiggly_pair():
    """Two districts sharing a detailed zig-zag edge, like neighbouring ADM2 units."""
    edge = [(1 + (0.004 if i % 2 else -0.004), i / 50) for i in range(51)]
    left = Polygon([(0, 0), *edge, (0, 1)])
    right = Polygon([*edge, (2, 1), (2, 0)])
    return left, right


def topology_from(rows):
    encoded = _encode_exact_coverage([fid for fid, _ in rows], [geometry for _, geometry in rows])
    for row in encoded["objects"]["political"]["geometries"]:
        row["properties"]["cntr_code"] = row["properties"]["id"][:2]
    encoded["objects"]["political"]["computed_neighbors"] = [[] for _ in rows]
    return encoded


class IndiaCoverageSimplifyTests(unittest.TestCase):
    def test_neighbouring_districts_keep_one_shared_edge(self):
        left, right = simplify_india_adm2_coverage(wiggly_pair())
        self.assertTrue(shapely.coverage_is_valid([left, right]))
        self.assertEqual(left.intersection(right).area, 0)
        self.assertLess(shapely.get_num_coordinates(left), 51)

    def test_repair_partitions_published_outline_and_keeps_neighbours(self):
        left_source, right_source = simplify_india_adm2_coverage(wiggly_pair())
        coverage = {"IN_ADM2_A": left_source, "IN_ADM2_B": right_source}
        # Published pieces simplified one by one: they overlap along the shared edge.
        old_left = Polygon([(0, 0), (1.02, 0), (1.02, 1), (0, 1)])
        old_right = Polygon([(0.98, 0), (2, 0), (2, 1), (0.98, 1)])
        outline = shapely.union_all([old_left, old_right])
        neighbour = box(2, 0, 3, 1)
        pieces = topology_from([("IN_ADM2_A", old_left), ("IN_ADM2_B", old_right), ("XX_1", neighbour)])
        published_neighbour = _decode_geometry(pieces, pieces["objects"]["political"]["geometries"][2])

        repaired, _ = repair_topology(pieces, coverage, {}, {})

        rows = repaired["objects"]["political"]["geometries"]
        self.assertEqual([r["properties"]["id"] for r in rows], ["IN_ADM2_A", "IN_ADM2_B", "XX_1"])
        geometries = {r["properties"]["id"]: _decode_geometry(repaired, r) for r in rows}
        self.assertTrue(shapely.coverage_is_valid([geometries["IN_ADM2_A"], geometries["IN_ADM2_B"]]))
        self.assertEqual(geometries["IN_ADM2_A"].intersection(geometries["IN_ADM2_B"]).area, 0)
        self.assertAlmostEqual(shapely.union_all([geometries["IN_ADM2_A"], geometries["IN_ADM2_B"]])
                               .symmetric_difference(outline).area, 0, places=12)
        self.assertTrue(geometries["XX_1"].equals_exact(published_neighbour, 0))


class IndiaScenarioCoverageContractTests(unittest.TestCase):
    def test_hoi4_india_features_form_a_coverage(self):
        for scenario in ("hoi4_1936", "hoi4_1939"):
            with self.subTest(scenario=scenario):
                topology = read(ROOT / "data/scenarios" / scenario / "runtime_topology.topo.json")
                geometries = [_decode_geometry(topology, row) for row in topology["objects"]["political"]["geometries"]
                              if is_india_feature(row["properties"]["id"])]
                self.assertGreater(len(geometries), 300)
                self.assertTrue(shapely.coverage_is_valid(geometries))


if __name__ == "__main__":
    unittest.main()
