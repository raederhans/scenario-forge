"""Numerical contracts for the offline GHSL population builder."""
import unittest

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import box

from map_builder.population_spatial import (
    aggregate_counts,
    exact_population,
    make_feature_records,
    prepare_features,
    tile_document,
)


def topology(rectangles):
    arcs, geometries = [], []
    for identifier, coordinates in rectangles:
        arcs.append(coordinates)
        geometries.append({"type": "Polygon", "arcs": [[len(arcs) - 1]], "properties": {"id": identifier}})
    return {"type": "Topology", "arcs": arcs, "objects": {"political": {"type": "GeometryCollection", "geometries": geometries}}}


class PopulationSpatialTests(unittest.TestCase):
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

    def test_aggregation_conserves_counts_with_partial_edge_windows(self):
        values = np.array([[1., 2., -200.], [3., 4., 0.], [5., 6., 7.]])
        counts, valid = aggregate_counts(values, 2)
        np.testing.assert_array_equal(counts, [[10, 0], [11, 7]])
        np.testing.assert_array_equal(valid, [[4, 1], [2, 1]])
        self.assertEqual(float(counts.sum()), 28)
        tile = tile_document(counts, valid, [0, 0, 4000, 4000], 2000, 1000)
        self.assertIn([1, 0., 1.], tile["cells"])

    def test_overlaps_are_flagged_instead_of_silently_double_counted(self):
        data = topology([("a", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), ("b", [[.5, 0], [1.5, 0], [1.5, 1], [.5, 1], [.5, 0]])])
        entries, overlaps = prepare_features(data)
        self.assertEqual([e["status"] for e in entries], ["pending", "pending"])
        self.assertEqual(len(overlaps), 1)
        self.assertGreater(overlaps[0]["area_km2"], 0)
        union = entries[0]["geometry"].union(entries[1]["geometry"])
        self.assertAlmostEqual(sum(e["weighted_area_m2"] for e in entries), union.area, delta=1)


if __name__ == "__main__":
    unittest.main()
