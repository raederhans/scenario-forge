import gzip
import json
from pathlib import Path
import tempfile
import unittest

from tools.scenario_chunk_assets import apply_chunk_lod_policy, build_and_write_scenario_chunk_assets
from tools.scenario_chunk_format import feature_collection_to_topology


SCENARIOS = Path(__file__).resolve().parents[1] / "data" / "scenarios"


def polygon(fid, x):
    return {"type": "Feature", "properties": {"id": fid}, "geometry": {
        "type": "Polygon", "coordinates": [[[0, 0], [x, 0], [0, 1], [0, 0]]],
    }}


class ChunkLodPolicyTests(unittest.TestCase):
    def assert_threshold(self, chunks, entries, threshold):
        for lod, bounds in (("coarse", (0, threshold)), ("detail", (threshold, 99))):
            layer_chunks = [chunk for chunk in chunks if chunk["lod"] == lod]
            lod_entries = [entry for entry in entries if entry["lod"] == lod]
            self.assertTrue(layer_chunks)
            self.assertEqual({chunk["id"] for chunk in layer_chunks},
                             {cid for entry in lod_entries for cid in entry["chunk_ids"]})
            for item in [*layer_chunks, *lod_entries]:
                self.assertEqual((item["min_zoom"], item["max_zoom"]), bounds)

    def test_comparison_uses_decoded_coordinates_and_complete_id_sets(self):
        a, b = polygon("a", 1), polygon("b", 2)
        for scenario, details, threshold in [
            ("hoi4_1939", [[b, a], [a]], 99),
            ("hoi4_1939", [[b, polygon("a", 1.0000000001)], [a]], 1.35),
            ("hoi4_1939", [[a]], 1.35),
            ("hoi4_1939", [[a, b, polygon("c", 3)]], 1.35),
            ("tno_1962", [[a, polygon("b", 3)]], 3),
        ]:
            with self.subTest(scenario=scenario, details=details), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                (directory / "chunks").mkdir()
                chunks, entries = [], []
                for i, features in enumerate([[a, b], *details]):
                    lod = "detail" if i else "coarse"
                    cid = f"political.{lod}.{i}"
                    payload = {"type": "FeatureCollection", "features": features}
                    if not i:
                        payload = feature_collection_to_topology(payload)
                    path = directory / "chunks" / f"{cid}.json.gz"
                    path.write_bytes(gzip.compress(json.dumps(payload).encode()))
                    zoom = {"lod": lod, "min_zoom": 1.35 if i else 0, "max_zoom": 99 if i else 1.35}
                    chunks.append({**zoom, "layer": "political", "id": cid, "url": f"chunks/{path.name}"})
                    entries.append({**zoom, "chunk_ids": [cid]})
                apply_chunk_lod_policy(directory, {"scenario_id": scenario, "chunks": chunks},
                                       {"layers": {"political": entries}})
                self.assert_threshold(chunks, entries, threshold)

    def test_generator_writes_folded_context_layer(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            build_and_write_scenario_chunk_assets(
                scenario_dir=directory, manifest_payload={"scenario_id": "sample"},
                layer_payloads={"relief": {"type": "FeatureCollection", "features": [polygon("a", 1)]}},
            )
            self.check_manifests(directory, "relief", 99)

    def check_manifests(self, directory, layer, threshold):
        chunks = json.loads((directory / "detail_chunks.manifest.json").read_bytes())["chunks"]
        layers = json.loads((directory / "context_lod.manifest.json").read_bytes())["layers"]
        self.assert_threshold([c for c in chunks if c["layer"] == layer], layers[layer], threshold)

    def test_checked_in_thresholds(self):
        for scenario, layer, threshold in [
            ("hoi4_1936", "political", 99), ("hoi4_1939", "political", 99),
            ("tno_1962", "water", 99), ("tno_1962", "scenario_atlantropa", 99),
            ("tno_1962", "relief", 99), ("tno_1962", "political", 3),
        ]:
            with self.subTest(scenario=scenario, layer=layer):
                self.check_manifests(SCENARIOS / scenario, layer, threshold)
