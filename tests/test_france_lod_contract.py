import itertools
import unittest

from shapely import coverage_is_valid, get_num_coordinates, union_all, get_parts
from shapely.geometry import Polygon, mapping, shape

from tools.scenario_chunk_assets import _optimize_political_coarse_payload


class FranceLodContractTest(unittest.TestCase):
    def test_mixed_owner_lods_keep_exact_coverage_and_boundary_precision(self):
        offset = 0.00001234567
        edges = [
            [(x + offset + (0.001 if i % 2 else 0), i / 20) for i in range(21)]
            for x in range(4)
        ]
        geometries = [Polygon(edges[i] + list(reversed(edges[i + 1]))) for i in range(3)]
        features = [
            {"type": "Feature", "properties": {"id": f"FR_ARR_{i}", "name": str(i)},
             "geometry": mapping(geometry)}
            for i, geometry in enumerate(geometries)
        ]
        owners = {"FR_ARR_0": "FRA", "FR_ARR_1": "FRA", "FR_ARR_2": "BRG"}
        result = _optimize_political_coarse_payload(
            {"type": "FeatureCollection", "features": features},
            owner_buckets_by_feature_id=owners,
        )
        coarse = [shape(feature["geometry"]) for feature in result["features"]]
        self.assertLess(sum(get_num_coordinates(coarse)), sum(get_num_coordinates(geometries)))
        self.assertEqual([f["properties"] for f in result["features"]], [f["properties"] for f in features])
        for use_fra_detail, use_brg_detail in itertools.product((False, True), repeat=2):
            mixed = [
                geometries[i] if (use_fra_detail if i < 2 else use_brg_detail) else coarse[i]
                for i in range(3)
            ]
            with self.subTest(fra_detail=use_fra_detail, brg_detail=use_brg_detail):
                self.assertTrue(coverage_is_valid(mixed))
                self.assertTrue(union_all(mixed).equals(union_all(geometries)))
        self.assertTrue(coarse[2].equals_exact(geometries[2], 0, normalize=True))
        self.assertTrue(all(not polygon.exterior.is_ccw for polygon in get_parts(coarse)))

    def test_missing_owner_or_invalid_coverage_retains_original_coordinates(self):
        geom = mapping(Polygon([(0.0000123, 0), (1, 0), (1, 1), (0.0000123, 0)]))
        features = [{"type": "Feature", "properties": {"id": f"FR_ARR_{i}"}, "geometry": geom} for i in range(2)]
        for owners in (None, {"FR_ARR_0": "FRA", "FR_ARR_1": "FRA"}):
            result = _optimize_political_coarse_payload(
                {"type": "FeatureCollection", "features": features},
                owner_buckets_by_feature_id=owners,
            )
            self.assertEqual([f["geometry"] for f in result["features"]], [geom, geom])
