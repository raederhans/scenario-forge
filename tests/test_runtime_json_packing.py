from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tools.runtime_json_packing import compact_json_bytes, pack_published_runtime_data
from tools.political_detail_partition import partition_political_detail_features


class RuntimeJsonPackingTests(unittest.TestCase):
    def test_population_detail_delivery_records_match_the_gzip_file(self):
        runtime = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            app = Path(temporary)
            layer = app / "data/thematic_layers/population/ghsl_population_2020_v1"
            (layer / "tiles").mkdir(parents=True)
            tile = layer / "tiles/r0_c0.json"
            tile.write_bytes(b'{"cells":[[7,123.45678901234567890,0.25]]}')
            original = tile.read_bytes()
            url = tile.relative_to(app).as_posix()
            key = url.removeprefix("data/")
            (layer / "manifest.json").write_text(json.dumps({"raster": {"detail_tiles": [{"url": url}]}}))
            registry = {"assets": {"population_spatial_tile:r0_c0": {"url": url}}}
            data = app / "data"
            for name, payload in {
                "manifest.json": {"outputs": {key: {}}, "runtime_asset_registry": registry},
                "runtime_asset_registry.json": registry,
                "CATALOG.json": {"entries": [{"url": url}]},
            }.items():
                (data / name).write_text(json.dumps(payload))

            pack_published_runtime_data(app)
            published = json.loads((layer / "manifest.json").read_bytes())["raster"]["detail_tiles"][0]
            encoded = (app / published["url"]).read_bytes()
            self.assertFalse(tile.exists())
            self.assertEqual(gzip.decompress(encoded), original)
            self.assertEqual(published, {"url": url + ".gz", "byte_size": len(encoded),
                                        "sha256": hashlib.sha256(encoded).hexdigest()})
            manifest = json.loads((data / "manifest.json").read_bytes())
            self.assertEqual(manifest["outputs"], {key + ".gz": {"size_bytes": len(encoded), "sha256": published["sha256"]}})
            published_registry = json.loads((data / "runtime_asset_registry.json").read_bytes())
            self.assertEqual(published_registry, manifest["runtime_asset_registry"])
            self.assertEqual(published_registry["assets"]["population_spatial_tile:r0_c0"]["url"], published["url"])
            entry = json.loads((data / "CATALOG.json").read_bytes())["entries"][0]
            self.assertEqual(entry["url"], published["url"])
            self.assertEqual(entry["hashRef"], f"data/manifest.json::outputs::{key}.gz::sha256")

    def test_default_size_override_still_rejects_non_json_python_properties(self):
        feature = {'properties': {'id': 'bad', 'unsupported': {1, 2}},
                   'geometry': {'type': 'Point', 'coordinates': [0, 0]}}
        entries = [('bad', feature, [0, 0, 0, 0])]
        with self.assertRaises(TypeError):
            partition_political_detail_features(entries, feature_compact_sizes={'bad': 1})

    def test_source_hash_uses_manifest_gzip_runtime_url_and_stored_bytes(self):
        runtime = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            app = Path(temporary)
            scenario = app / "data/scenarios/test"
            scenario.mkdir(parents=True)
            plain = scenario / "runtime_topology.topo.json"
            plain.write_bytes(b'{ "different": "plain topology" }')
            compressed = plain.with_name(plain.name + ".gz")
            encoded = gzip.compress(b'{"type":"Topology","objects":{},"arcs":[]}', mtime=0)
            compressed.write_bytes(encoded)
            old = "a" * 64
            manifest = {"runtime_topology_url": "data/scenarios/test/runtime_topology.topo.json.gz", "source": {"runtime_topology_sha256": old}}
            (scenario / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            bundle = scenario / "startup.bundle.en.json"
            bundle.write_text(json.dumps({"source": {"runtime_topology_sha256": old}}), encoding="utf-8")
            pack_published_runtime_data(app)
            expected = hashlib.sha256(encoded).hexdigest()
            self.assertEqual(json.loads((scenario / "manifest.json").read_bytes())["source"]["runtime_topology_sha256"], expected)
            self.assertEqual(json.loads(bundle.read_bytes())["source"]["runtime_topology_sha256"], expected)
            self.assertEqual(compressed.read_bytes(), encoded)
            plain.unlink()
            pack_published_runtime_data(app)
            self.assertEqual(json.loads(bundle.read_bytes())["source"]["runtime_topology_sha256"], expected)

    def test_packed_manifest_decodes_identically_and_retains_cache_weight(self):
        runtime = Path(__file__).resolve().parents[1] / '.runtime' / 'tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            app = Path(temporary) / 'app'
            scenario = app / 'data/scenarios/test'
            chunks = scenario / 'chunks'
            chunks.mkdir(parents=True)
            payload = {'type': 'FeatureCollection', 'features': [{'id': 'a', 'properties': {'name': '法国'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[0.123456789123, 1], [2, 3], [0.123456789123, 1]]]}}]}
            raw = json.dumps(payload, ensure_ascii=False, indent=2).encode()
            chunk = chunks / 'political.detail.country.a.json'
            chunk.write_bytes(raw)
            orphan = chunks / 'political.detail.country.old.json'
            orphan.write_text('{}')
            manifest_path = scenario / 'detail_chunks.manifest.json'
            manifest_path.write_text(json.dumps({'chunks': [{'id': 'a', 'url': 'data/scenarios/test/chunks/' + chunk.name, 'byte_size': len(raw), 'coord_count': 3}]}))
            old_digest = 'a' * 64
            (scenario / 'manifest.json').write_text(json.dumps({'source': {'detail_chunk_manifest_sha256': old_digest}}))
            exact = app / 'data/exact.json'
            exact.write_bytes(b'{ "untouched": true }\r\n')
            sidecar_source = scenario / 'startup.bundle.en.json'
            bundle_raw = b'{"source":{"detail_chunk_manifest_sha256":"' + old_digest.encode() + b'"},"precise":1.234567890123456789e-12}'
            sidecar_source.write_bytes(bundle_raw)
            sidecar_source.with_suffix('.json.gz').write_bytes(gzip.compress(raw))
            main_manifest = app / 'data/manifest.json'
            main_manifest.write_text(json.dumps({'outputs': {'scenarios/test/detail_chunks.manifest.json': {'size_bytes': 0, 'sha256': 'old'}}}))
            result = pack_published_runtime_data(app, byte_exact_paths=['data/exact.json'])
            self.assertEqual(result['gzip_chunk_count'], 1)
            packed_meta = json.loads(manifest_path.read_bytes())['chunks'][0]
            encoded = (app / packed_meta['url']).read_bytes()
            decoded = gzip.decompress(encoded)
            self.assertEqual(decoded, compact_json_bytes(raw))
            self.assertEqual(json.loads(decoded), payload)
            self.assertEqual(packed_meta['byte_size'], len(encoded))
            self.assertEqual(packed_meta['decoded_byte_size'], len(decoded))
            self.assertEqual(packed_meta['cache_byte_size'], len(raw))
            self.assertEqual(packed_meta['sha256'], hashlib.sha256(encoded).hexdigest())
            self.assertEqual(packed_meta['coord_count'], 3)
            self.assertFalse(chunk.exists())
            self.assertFalse(orphan.exists())
            self.assertEqual(exact.read_bytes(), b'{ "untouched": true }\r\n')
            self.assertEqual(gzip.decompress(sidecar_source.with_suffix('.json.gz').read_bytes()), sidecar_source.read_bytes())
            self.assertIn(b'1.234567890123456789e-12', sidecar_source.read_bytes())
            self.assertEqual(json.loads(sidecar_source.read_bytes())['source']['detail_chunk_manifest_sha256'], hashlib.sha256(manifest_path.read_bytes()).hexdigest())
            record = json.loads(main_manifest.read_bytes())['outputs']['scenarios/test/detail_chunks.manifest.json']
            self.assertEqual(record['sha256'], hashlib.sha256(manifest_path.read_bytes()).hexdigest())
            self.assertEqual(record['size_bytes'], manifest_path.stat().st_size)
            # Repeating packing leaves published data and cache weights stable.
            pack_published_runtime_data(app, byte_exact_paths=['data/exact.json'])
            self.assertEqual((app / packed_meta['url']).read_bytes(), encoded)
            self.assertEqual(json.loads(manifest_path.read_bytes())['chunks'][0], packed_meta)


if __name__ == '__main__':
    unittest.main()
