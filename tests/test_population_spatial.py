"""Numerical contracts for the offline GHSL population builder."""
import unittest
import gzip
from pathlib import Path
import tempfile

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import box
from shapely import set_precision

from map_builder.population_spatial import (aggregate_counts, audit_partition, decode_topology, exact_population, make_feature_records, normalize_zero_area_parts, prepare_features, read_json, tile_document, validate_raster, write_raster_tiles)


def topology(rectangles):
    arcs, geometries = [], []
    for identifier, coordinates in rectangles:
        arcs.append(coordinates)
        geometries.append({"type": "Polygon", "arcs": [[len(arcs) - 1]], "properties": {"id": identifier}})
    return {"type": "Topology", "arcs": arcs, "objects": {"political": {"type": "GeometryCollection", "geometries": geometries}}}


class PopulationSpatialTests(unittest.TestCase):
    def test_read_json_supports_gzip_topology_without_rebinding_raw_hash(self):
        from map_builder.population_spatial import sha256
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "topology.json.gz"
            raw = gzip.compress(b'{"type":"Topology","objects":{}}')
            path.write_bytes(raw)
            self.assertEqual(read_json(path)["type"], "Topology")
            self.assertEqual(sha256(path), hashlib.sha256(raw).hexdigest())
            self.assertNotEqual(sha256(path), hashlib.sha256(gzip.decompress(raw)).hexdigest())

    def raster(self, values):
        memory = MemoryFile()
        self.addCleanup(memory.close)
        dataset = memory.open(driver="GTiff", width=values.shape[1], height=values.shape[0], count=1, dtype="float64", crs="ESRI:54009", transform=from_origin(0, values.shape[0] * 1000, 1000, 1000), nodata=-200)
        dataset.write(values, 1)
        self.addCleanup(dataset.close)
        return dataset

    def test_fractional_border_counts_nodata_and_land_area(self):
        dataset = self.raster(np.array([[100., 300.], [0., -200.]]))
        entries = [{"id": "west", "geometry": box(0, 0, 1500, 2000), "status": "pending"}, {"id": "east", "geometry": box(1500, 0, 2000, 2000), "status": "pending"}]
        results = exact_population(dataset, entries)
        self.assertAlmostEqual(results["west"]["sum"], 250)
        self.assertAlmostEqual(results["east"]["sum"], 150)
        self.assertAlmostEqual(results["west"]["count"], 2.5)
        records = make_feature_records(entries, results, 1e6)
        self.assertEqual(records["west"]["status"], "partial_coverage")
        self.assertIsNone(records["west"]["density"])
        self.assertAlmostEqual(records["west"]["land_area_km2"], 3)
        self.assertAlmostEqual(records["west"]["coverage_fraction"], 2.5 / 3)

    def test_zero_and_nodata_are_distinct(self):
        entries = [{"id": "zero", "geometry": box(0, 0, 1000, 1000), "status": "pending"}, {"id": "missing", "geometry": box(1000, 0, 2000, 1000), "status": "pending"}]
        records = make_feature_records(entries, {"zero": {"sum": 0, "count": 1}, "missing": {"sum": 0, "count": 0}}, 1e6)
        self.assertEqual(records["zero"]["density"], 0)
        self.assertEqual(records["zero"]["status"], "ok")
        self.assertIsNone(records["missing"]["population"])
        self.assertEqual(records["missing"]["status"], "no_data")

    def test_overlap_ratio_roundoff_is_clamped_without_changing_counts(self):
        entry = {"id": "a", "geometry": box(0, 0, 1000, 1000), "status": "pending", "overlap_fraction": 1.000003}
        row = make_feature_records([entry], {"a": {"sum": 123, "count": 1}}, 1e6)["a"]
        self.assertEqual(row["overlap_fraction"], 1)
        self.assertEqual(row["raw_overlap_fraction"], 1.000003)
        self.assertEqual(row["population"], 123)
        self.assertEqual(row["density"], 123)

    def test_aggregation_conserves_counts_with_partial_edge_windows(self):
        values = np.array([[1., 2., -200.], [3., 4., 0.], [5., 6., 7.]])
        counts, valid = aggregate_counts(values, 2)
        np.testing.assert_array_equal(counts, [[10, 0], [11, 7]])
        np.testing.assert_array_equal(valid, [[4, 1], [2, 1]])
        self.assertEqual(float(counts.sum()), 28)
        tile = tile_document(counts, valid, [0, 0, 4000, 4000], 2000, 1000)
        self.assertIn([1, 0., 1.], tile["cells"])

    def test_topology_delta_transform_and_id_fallback(self):
        data = {"type": "Topology", "transform": {"scale": [0.5, 0.5], "translate": [10, 20]}, "arcs": [[[0, 0], [2, 0], [0, 2], [-2, 0], [0, -2]]], "objects": {"political": {"geometries": [{"type": "Polygon", "arcs": [[0]], "properties": {"NUTS_ID": "test"}}]}}}
        entry = decode_topology(data)[0]
        self.assertEqual(entry["id"], "test")
        self.assertEqual(entry["geometry"].bounds, (10, 20, 11, 21))
        data["objects"]["political"]["geometries"].append(data["objects"]["political"]["geometries"][0])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            decode_topology(data)

    def test_overlaps_are_flagged_instead_of_silently_double_counted(self):
        data = topology([("a", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), ("b", [[.5, 0], [1.5, 0], [1.5, 1], [.5, 1], [.5, 0]])])
        entries, overlaps = prepare_features(data)
        self.assertEqual([e["status"] for e in entries], ["pending", "pending"])
        self.assertEqual(len(overlaps), 1)
        self.assertGreater(overlaps[0]["area_km2"], 0)
        union = entries[0]["geometry"].union(entries[1]["geometry"])
        self.assertAlmostEqual(sum(e["weighted_area_m2"] for e in entries), union.area, delta=1)

    def test_invalid_geometry_remains_a_member(self):
        data = topology([("bowtie", [[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]])])
        entries, _ = prepare_features(data)
        self.assertEqual(entries[0]["status"], "pending")
        self.assertIn("geometry_repair", entries[0])
        records = make_feature_records(entries, {}, 1e6)
        self.assertIn("bowtie", records)
        self.assertIsNone(records["bowtie"]["population"])

    def test_degenerate_ring_is_explicit_invalid_member(self):
        entries, _ = prepare_features(topology([("degenerate", [[0, 0], [1, 1]])]))
        self.assertEqual(entries[0]["status"], "invalid_geometry")
        row = make_feature_records(entries, {}, 1e6)["degenerate"]
        self.assertIsNone(row["population"])
        self.assertEqual(entries[0]["dropped_zero_area_parts"], {"shells": 1, "holes": 0})

    def test_collinear_ring_repaired_to_line_is_not_land(self):
        entries, _ = prepare_features(topology([("line", [[0, 0], [1, 0], [2, 0], [0, 0]])]))
        self.assertEqual(entries[0]["status"], "invalid_geometry")

    def test_zero_area_part_removal_preserves_real_component_and_bowtie(self):
        real = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
        zero = [[2, 2], [2, 2]]
        bowtie = [[3, 0], [4, 1], [3, 1], [4, 0], [3, 0]]
        polygons, dropped = normalize_zero_area_parts([[zero], [real, zero], [bowtie]])
        self.assertEqual(polygons, [[real], [bowtie]])
        self.assertEqual(dropped, {"shells": 1, "holes": 1})

    def test_three_identical_polygons_use_thirds_for_population_and_area(self):
        ring = [[0, 0], [.01, 0], [.01, .01], [0, .01], [0, 0]]
        entries, _ = prepare_features(topology([(name, ring) for name in ("a", "b", "c")]))
        for entry in entries:
            self.assertEqual(entry["pieces"][0][1], 3)
            self.assertAlmostEqual(entry["weighted_area_m2"], entry["geometry"].area / 3)
        dataset = self.raster(np.array([[90., 30.], [60., 120.]]))
        results = exact_population(dataset, entries)
        single = exact_population(dataset, [{"id": "whole", "geometry": entries[0]["geometry"], "status": "pending"}])["whole"]
        self.assertAlmostEqual(sum(s["sum"] for s in results.values()), single["sum"])
        self.assertAlmostEqual(sum(s["count"] for s in results.values()), single["count"])
        audit = audit_partition(dataset, entries, results)
        self.assertTrue(audit["count_conservation_pass"])
        self.assertAlmostEqual(audit["allocated_land_area_km2"], audit["union_land_area_km2"])

    def test_lake_subtraction_removes_water_from_denominator(self):
        from map_builder.population_spatial import project_geometry
        data = topology([("a", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])])
        original, _ = prepare_features(data)
        lake = project_geometry(box(.25, .25, .75, .75))
        dry, _ = prepare_features(data, [lake])
        self.assertAlmostEqual(original[0]["geometry"].area - dry[0]["geometry"].area, set_precision(lake, .001).area, delta=1)

    def test_windowed_tile_artifacts_match_source_sum(self):
        dataset = self.raster(np.array([[1., 2., -200.], [0., 3., 4.], [5., -200., 6.]]))
        validate_raster(dataset, 1000)
        with tempfile.TemporaryDirectory() as directory:
            manifest, audit = write_raster_tiles(dataset, directory, "data/test", detail_resolution=1000, overview_resolution=2000, tile_size=2)
            self.assertTrue(audit["count_conservation_pass"])
            self.assertEqual(audit["source_population_sum"], 21)
            self.assertEqual(audit["overview_population_sum"], 21)
            self.assertEqual(audit["detail_population_sum"], 21)
            self.assertEqual(manifest["missing_cell"], "no_data")
            self.assertEqual(sum(row[1] for row in read_json(Path(directory) / "overview.json")["cells"]), 21)


if __name__ == "__main__":
    unittest.main()
