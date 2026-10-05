"""Wire compression must preserve expanded geometry and honest cache accounting."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import scenario_chunk_assets as assets
from tools.scenario_chunk_format import decode_political_chunk


def dense_neighbors():
    seam = [[1.000013 + (i % 2) * .000013, i / 100] for i in range(101)]
    rings = [[[0, 0], *seam, [0, 1], [0, 0]],
             [*reversed(seam), [2, 0], [2, 1], seam[-1]]]
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": str(i), "cntr_code": "AA"},
         "geometry": {"type": "Polygon", "coordinates": [ring]}}
        for i, ring in enumerate(rings)
    ]}


class CoarseWireAssetsTest(unittest.TestCase):
    def test_small_payload_is_unchanged(self):
        payload = dense_neighbors()
        wire, size = assets._encode_political_coarse_wire(payload)
        self.assertIs(wire, payload)
        self.assertEqual(size, assets._minified_json_byte_size(payload))

    def test_shared_wire_roundtrip_and_expanded_cache_cost(self):
        payload = dense_neighbors()
        with patch.object(assets, "POLITICAL_COARSE_TOPOLOGY_MIN_BYTES", 0):
            wire, size = assets._encode_political_coarse_wire(payload)
            self.assertEqual(wire["type"], "Topology")
            self.assertEqual(decode_political_chunk(wire), payload)
            self.assertLess(assets._minified_json_byte_size(wire), size)
            runtime = Path(__file__).resolve().parents[1] / ".runtime/tmp"
            runtime.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=runtime) as directory:
                chunks, _ = assets._build_chunk_payloads_for_feature_collection(
                    scenario_id="fixture", scenario_dir=Path(directory), layer_key="political",
                    feature_collection=payload, payload_factory=lambda ids: payload,
                    chunk_specs=assets.POLITICAL_COARSE_LOD_SPECS,
                    owner_buckets_by_feature_id={"0": "left", "1": "right"},
                )
                entry = chunks[0]
                actual = json.loads((Path(directory) / "chunks/political.coarse.r0c0.json").read_text())
                expanded = decode_political_chunk(actual)
                self.assertEqual(entry["data_format"], "topojson")
                self.assertEqual(entry["feature_count"], len(expanded["features"]))
                self.assertEqual(len(entry["feature_bounds"]), len(expanded["features"]))
                self.assertEqual(entry["cache_byte_size"], assets._minified_json_byte_size(expanded))
                self.assertGreater(entry["cache_byte_size"], entry["decoded_byte_size"])
                self.assertEqual(entry["byte_size"], entry["decoded_byte_size"])
                self.assertEqual(entry["lod_diagnostics"]["optimized_byte_size"], entry["byte_size"])


if __name__ == "__main__":
    unittest.main()
