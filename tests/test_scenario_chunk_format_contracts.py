"""Contract and consumer compatibility for TopoJSON political coarse chunks."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from tools import check_scenario_contracts, validate_mixed_lod_coverage
from tools.scenario_chunk_format import feature_collection_to_topology

ROOT = Path(__file__).resolve().parents[1]


def collection_with_polygon(feature_id: str, coordinates):
    return {"type": "FeatureCollection", "features": [{
        "type": "Feature", "id": feature_id, "properties": {"id": feature_id},
        "geometry": {"type": "Polygon", "coordinates": coordinates},
    }]}


class ScenarioChunkFormatContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / ".runtime" / "tmp").mkdir(parents=True, exist_ok=True)

    def test_coarse_topology_is_decoded_for_contract_and_mixed_lod_consumers(self):
        collection = collection_with_polygon("land", [[[0, 0], [2, 0], [2, 1], [0, 0]]])
        topology = feature_collection_to_topology(collection)
        with tempfile.TemporaryDirectory(dir=ROOT / ".runtime" / "tmp") as temporary:
            path = Path(temporary) / "coarse.json"
            path.write_text(json.dumps(topology), encoding="utf-8")
            compact_size = len(json.dumps(collection, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
            errors = []
            features = check_scenario_contracts._validate_political_coarse_chunk(
                "coarse",
                {"data_format": "topojson", "feature_count": 1,
                 "feature_bounds": [[0, 0, 2, 1]], "cache_byte_size": compact_size},
                path,
                errors,
            )
            self.assertEqual(features, collection["features"])
            self.assertEqual(errors, [])

        rows = validate_mixed_lod_coverage.feature_rows(topology, "coarse")
        self.assertAlmostEqual(rows["land"].area, 1.0)

    def test_coarse_contract_rejects_format_mismatch_and_understated_cache(self):
        collection = collection_with_polygon("land", [[[0, 0], [2, 0], [2, 1], [0, 0]]])
        topology = feature_collection_to_topology(collection)
        with tempfile.TemporaryDirectory(dir=ROOT / ".runtime" / "tmp") as temporary:
            path = Path(temporary) / "coarse.json"
            path.write_text(json.dumps(topology), encoding="utf-8")
            errors = []
            self.assertIsNone(check_scenario_contracts._validate_political_coarse_chunk(
                "coarse", {"data_format": "geojson"}, path, errors))
            self.assertTrue(any("data_format" in error for error in errors))

            errors = []
            check_scenario_contracts._validate_political_coarse_chunk(
                "coarse", {"data_format": "topojson", "feature_count": 2,
                           "feature_bounds": [[0, 0, 2, 1]], "cache_byte_size": 1}, path, errors)
            self.assertTrue(any("feature_count" in error for error in errors))
            self.assertTrue(any("cache_byte_size" in error for error in errors))

    def test_coarse_contract_counts_zero_area_feature_bounds(self):
        collection = collection_with_polygon("line", [[[0, 0], [0, 1], [0, 2], [0, 0]]])
        topology = feature_collection_to_topology(collection)
        with tempfile.TemporaryDirectory(dir=ROOT / ".runtime" / "tmp") as temporary:
            path = Path(temporary) / "coarse.json"
            path.write_text(json.dumps(topology), encoding="utf-8")
            decoded_size = len(json.dumps(collection, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
            errors = []
            features = check_scenario_contracts._validate_political_coarse_chunk(
                "coarse", {"data_format": "topojson", "feature_count": 1,
                           "feature_bounds": [[0, 0, 0, 2]], "cache_byte_size": decoded_size}, path, errors)
            self.assertIsNotNone(features)
            self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
