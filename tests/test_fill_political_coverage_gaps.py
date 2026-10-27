import copy
import unittest

from shapely.geometry import MultiPolygon, Polygon, box, mapping
from shapely import STRtree
from shapely.affinity import translate
from shapely.ops import unary_union

from map_builder.regional_geometry import _decode_geometry, _encode_exact_coverage
from tools.fill_political_coverage_gaps import (
    area_km2, assign_gap, effective_water, fill_topology, merge_assigned_holes, validate_coverage,
)


def topology_for(*geometries):
    topology = _encode_exact_coverage([f"feature_{i}" for i in range(len(geometries))], geometries)
    for i, row in enumerate(topology["objects"]["political"]["geometries"]):
        row["id"] = f"top_level_{i}"
        row["properties"].update(owner=f"owner_{i}", name=f"Name {i}")
    topology["objects"]["political"]["computed_neighbors"] = [[] for _ in geometries]
    return topology


def decoded(topology):
    return [_decode_geometry(topology, row) for row in topology["objects"]["political"]["geometries"]]


class FillPoliticalCoverageGapsTest(unittest.TestCase):
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

    def test_existing_overlap_does_not_block_filling_a_hole(self):
        shell = box(0, 0, 0.02, 0.02)
        hole = box(0.005, 0.005, 0.01, 0.01)
        right = box(0.015, 0, 0.03, 0.02)
        topology = topology_for(shell.difference(hole), right)
        before = decoded(topology)
        report = fill_topology(topology)
        after = decoded(topology)
        self.assertEqual(report["hole_count"], 1)
        self.assertEqual(report["changed_feature_count"], 1)
        self.assertEqual(report["existing_overlap_pair_count"], 1)
        self.assertTrue(after[0].equals(shell))
        self.assertTrue(after[1].equals(right))
        self.assertEqual(after[0].intersection(after[1]).area, before[0].intersection(before[1]).area)
        self.assertTrue(unary_union(after).equals(unary_union([*before, hole])))

    def test_shared_inner_hole_is_assigned_only_once(self):
        hole = box(0.012, 0.005, 0.018, 0.015)
        left = box(0, 0, 0.02, 0.02).difference(hole)
        right = box(0.01, 0, 0.03, 0.02).difference(hole)
        topology = topology_for(left, right)
        report = fill_topology(topology)
        after = decoded(topology)
        self.assertEqual(report["hole_count"], 1)
        self.assertEqual(after[0].intersection(after[1]).area, left.intersection(right).area)
        self.assertTrue(unary_union(after).equals(box(0, 0, 0.03, 0.02)))
        self.assertEqual(fill_topology(topology)["hole_count"], 0)

    def test_filling_preserves_unrelated_polygon_parts(self):
        shell = box(0, 0, 0.02, 0.02)
        hole = box(0.005, 0.005, 0.01, 0.01)
        islands = [box(i, 0, i + 0.1, 0.1) for i in range(1, 20)]
        topology = topology_for(MultiPolygon([shell.difference(hole), *islands]))
        self.assertEqual(fill_topology(topology)["hole_count"], 1)
        self.assertTrue(decoded(topology)[0].equals(MultiPolygon([shell, *islands])))

    def test_near_zero_ring_is_removed_but_covered_enclave_is_not_refilled(self):
        shell = box(0, 0, 0.02, 0.02)
        tiny = box(0.005, 0.005, 0.015, 0.005 + 1e-13)
        topology = topology_for(shell.difference(tiny))
        self.assertEqual(fill_topology(topology)["own_inner_rings"]["ring_count"], 1)
        self.assertTrue(decoded(topology)[0].equals(shell))
        enclave = box(0.005, 0.005, 0.015, 0.015)
        topology = topology_for(shell.difference(enclave), translate(enclave, xoff=1e-15))
        self.assertEqual(fill_topology(topology)["hole_count"], 0)

    def test_snapped_adjacent_faces_keep_the_filled_area(self):
        neighbor = Polygon([(0, 0), (1, 0), (0, 1), (0, 0)])
        hole = Polygon([(1 + 1e-15, 0), (1, 1), (0, 1 + 1e-15), (1 + 1e-15, 0)])
        result = merge_assigned_holes(neighbor, [hole], [neighbor], STRtree([neighbor]))
        self.assertTrue(result.is_valid)
        self.assertLess(result.symmetric_difference(neighbor.union(hole)).area, 1e-12)
        self.assertAlmostEqual(result.area, 1)

    def seam(self):
        hole = box(0.009, 0.002, 0.010, 0.018)
        left = box(0, 0, 0.010, 0.020).difference(hole)
        right = Polygon([(0.010, 0), (0.020, 0), (0.020, 0.020), (0.010, 0.020),
                         (0.010, 0.018), (0.010, 0.002), (0.010, 0)])
        return topology_for(left, right), hole

    def assert_exact_fill(self, before, after, hole):
        self.assertTrue(unary_union(after).symmetric_difference(unary_union([*before, hole])).is_empty)
        for i, geometry in enumerate(after):
            self.assertTrue(geometry.is_valid)
            for other in after[i + 1:]:
                self.assertEqual(geometry.intersection(other).area, 0)

    def test_seam_goes_to_longest_shared_boundary(self):
        topology, hole = self.seam()
        original = copy.deepcopy(topology)
        before = decoded(topology)
        report = fill_topology(topology)
        after = decoded(topology)
        self.assertEqual(report["hole_count"], 1)
        self.assertTrue(after[0].equals(before[0].union(hole)))
        self.assertTrue(after[1].equals(before[1]))
        self.assert_exact_fill(before, after, hole)
        rows = topology["objects"]["political"]["geometries"]
        for old, new in zip(original["objects"]["political"]["geometries"], rows):
            self.assertEqual(new["id"], old["id"])
            self.assertEqual(new["properties"], old["properties"])
        refs = [{ref if ref >= 0 else ~ref for ring in row["arcs"] for ref in ring} for row in rows]
        self.assertTrue(refs[0] & refs[1])
        self.assertEqual(topology["objects"]["political"]["computed_neighbors"], [[1], [0]])

    def test_lake_hole_is_not_filled(self):
        topology, hole = self.seam()
        original = copy.deepcopy(topology)
        self.assertEqual(fill_topology(topology, [hole])["hole_count"], 0)
        self.assertEqual(topology, original)

    def test_water_overlap_threshold(self):
        for fraction, count in [(0.005, 1), (0.02, 0)]:
            with self.subTest(fraction=fraction):
                topology, _ = self.seam()
                water = box(0.009, 0.002, 0.009 + 0.001 * fraction, 0.018)
                self.assertEqual(fill_topology(topology, [water])["hole_count"], count)

    def test_large_hole_is_not_filled(self):
        hole = box(0.1, 0.1, 0.9, 0.9)
        topology = topology_for(box(0, 0, 1, 1).difference(hole))
        original = copy.deepcopy(topology)
        self.assertGreater(area_km2(hole), 100)
        self.assertEqual(fill_topology(topology)["hole_count"], 0)
        self.assertEqual(topology, original)
        self.assertEqual(fill_topology(topology, max_hole_km2=10000)["hole_count"], 1)

    def test_feature_inner_ring_is_filled_into_itself(self):
        shell = box(0, 0, 0.020, 0.020)
        hole = box(0.005, 0.005, 0.015, 0.015)
        topology = topology_for(shell.difference(hole))
        self.assertEqual(fill_topology(topology)["hole_count"], 1)
        self.assertTrue(decoded(topology)[0].equals(shell))

    def test_enclosed_island_is_preserved(self):
        hole = box(0.005, 0.005, 0.015, 0.015)
        island = box(0.008, 0.008, 0.012, 0.012)
        topology = topology_for(box(0, 0, 0.020, 0.020).difference(hole), island)
        before = decoded(topology)
        self.assertEqual(fill_topology(topology)["hole_count"], 1)
        after = decoded(topology)
        self.assertTrue(after[1].equals(island))
        self.assert_exact_fill(before, after, hole)
        self.assertEqual(fill_topology(topology)["hole_count"], 0)

    def test_idempotence(self):
        topology, _ = self.seam()
        self.assertEqual(fill_topology(topology)["hole_count"], 1)
        filled = copy.deepcopy(topology)
        self.assertEqual(fill_topology(topology)["hole_count"], 0)
        self.assertEqual(topology, filled)

    def test_degenerate_inner_rings_are_removed_even_without_gap_assignment(self):
        for target in (0, 1):
            with self.subTest(target=target):
                topology, _ = self.seam()
                rows = topology["objects"]["political"]["geometries"]
                degenerate = [[[0.011, 0.005], [0.011, 0.005]],
                              [[0.011, 0.005], [0.012, 0.005], [0.013, 0.005], [0.011, 0.005]]]
                for arc in degenerate:
                    rows[target]["arcs"].append([len(topology["arcs"])])
                    topology["arcs"].append(arc)
                original = copy.deepcopy(topology)
                report = fill_topology(topology, dry_run=True)
                self.assertEqual(topology, original)
                self.assertEqual(report["hole_count"], 3)
                self.assertEqual(report["own_inner_rings"]["ring_count"], 2)
                self.assertEqual(report["own_inner_rings"]["feature_count"], 1)
                self.assertEqual(report["skipped_degenerate_rings"], {
                    "count": 2, "features": [{"feature_id": f"feature_{target}", "count": 2}],
                })
                self.assertEqual(fill_topology(topology)["hole_count"], 3)
                self.assertEqual(len(rows[target]["arcs"]), 1)
                self.assertTrue(_decode_geometry(topology, rows[target]).is_valid)
                refs = [{ref if ref >= 0 else ~ref for ring in row["arcs"] for ref in ring}
                        for row in rows]
                self.assertTrue(refs[0] & refs[1])
                filled = copy.deepcopy(topology)
                self.assertEqual(fill_topology(topology)["hole_count"], 0)
                self.assertEqual(topology, filled)

    def test_dry_run_preserves_topology_and_reports_owner(self):
        topology, _ = self.seam()
        original = copy.deepcopy(topology)
        report = fill_topology(topology, owners={"feature_0": "RAJ"}, dry_run=True)
        self.assertEqual(report["hole_count"], 1)
        self.assertEqual(report["owners_top_10"][0]["owner"], "RAJ")
        self.assertEqual(topology, original)

    def test_self_intersecting_inner_ring_is_repaired_only_when_assigned(self):
        shell = box(0, 0, 0.020, 0.020)
        invalid = Polygon(shell.exterior.coords, [[
            (0.004, 0.004), (0.016, 0.016), (0.004, 0.016), (0.012, 0.004), (0.004, 0.004),
        ]])
        self.assertFalse(invalid.is_valid)
        other_shell = box(0.040, 0, 0.060, 0.020)
        other = other_shell.difference(box(0.045, 0.005, 0.055, 0.015))
        for water in ([], [shell]):
            with self.subTest(water=bool(water)):
                topology = topology_for(invalid, other)
                original = copy.deepcopy(topology)
                before = decoded(topology)[0].wkb
                report = fill_topology(topology, water, dry_run=True)
                self.assertEqual(topology, original)
                self.assertEqual(report["make_valid_repairs"], {
                    "feature_count": 1, "feature_ids_first_20": ["feature_0"],
                })
                self.assertEqual(report["hole_count"], 1 if water else 2)
                fill_topology(topology, water)
                after = decoded(topology)
                self.assertTrue(after[1].equals(other_shell))
                if water:
                    self.assertEqual(after[0].wkb, before)
                else:
                    self.assertTrue(after[0].is_valid)
                    self.assertTrue(after[0].equals(shell))
                    self.assertEqual(after[0].intersection(after[1]).area, 0)
                filled = copy.deepcopy(topology)
                self.assertEqual(fill_topology(topology, water)["hole_count"], 0)
                self.assertEqual(topology, filled)

    def test_cross_feature_assignment_with_subprecision_coordinate_difference(self):
        topology, hole = self.seam()
        neighbors = decoded(topology)
        shifted = translate(hole, xoff=1e-15, yoff=1e-15)
        self.assertEqual(assign_gap(shifted, neighbors, STRtree(neighbors), {}), 0)
        self.assertIsNone(assign_gap(box(1, 1, 2, 2), neighbors, STRtree(neighbors), {}))
        shifted_topology = topology_for(neighbors[0], translate(neighbors[1], xoff=-1e-15))
        before = unary_union(decoded(shifted_topology))
        report = fill_topology(shifted_topology)
        self.assertEqual(report["cross_feature_gaps"]["hole_count"], 1)
        after = decoded(shifted_topology)
        self.assertLess(after[0].intersection(after[1]).area, 1e-12)
        self.assertLess(unary_union(after).symmetric_difference(before.union(hole)).area, 1e-12)

    def test_effective_water_uses_runtime_exclusions_and_common_lakes(self):
        water = _encode_exact_coverage(["common", "excluded", "congo_lake", "foreign"],
                                       [box(i, 0, i + 0.1, 0.1) for i in range(4)])
        rows = water["objects"].pop("political")
        water["objects"]["scenario_water"] = rows
        rows["geometries"][2]["properties"]["scenario_id"] = "tno_1962"
        rows["geometries"][3]["properties"]["scenario_id"] = "modern_world"
        common = box(5, 0, 5.1, 0.1)
        lakes = {"features": [{"properties": {"id": "common"}, "geometry": mapping(common)}]}
        result = effective_water(water, lakes, "tno_1962",
                                 {"excluded_water_region_ids": ["common", "excluded", "congo_lake"]})
        self.assertEqual(len(result), 2)
        self.assertTrue(any(geometry.equals(common) for geometry in result))
        self.assertTrue(any(geometry.equals(box(2, 0, 2.1, 0.1)) for geometry in result))


if __name__ == "__main__":
    unittest.main()
