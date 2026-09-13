from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from tools.runtime_json_packing import compact_json_bytes, pack_published_runtime_data
from tools.political_detail_partition import partition_political_detail_features


class RuntimeJsonPackingTests(unittest.TestCase):
    def test_partition_uses_exact_token_cost_for_preserved_escapes_and_numbers(self):
        features = [{'type': 'Feature', 'properties': {'id': str(i), 'name': '中' * 20},
                     'geometry': {'type': 'Point', 'coordinates': [i, 0]}} for i in range(2)]
        entries = [(str(i), feature, [i, 0, i, 0]) for i, feature in enumerate(features)]
        exact_sizes = {str(i): len(json.dumps(feature, ensure_ascii=True, separators=(',', ':')).encode()) for i, feature in enumerate(features)}
        parsed_sizes = [len(json.dumps(feature, ensure_ascii=False, separators=(',', ':')).encode()) for feature in features]
        limit = 42 + sum(parsed_sizes) + 1
        self.assertEqual(len(partition_political_detail_features(entries, max_compact_bytes=limit)), 1)
        shards = partition_political_detail_features(entries, max_compact_bytes=limit, feature_compact_sizes=exact_sizes)
        self.assertEqual(len(shards), 2)

    def test_published_spatial_shards_keep_exact_tokens_and_all_references(self):
        runtime = Path(__file__).resolve().parents[1] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            app = Path(temporary)
            scenario = app / 'data/scenarios/test'
            chunks = scenario / 'chunks'
            chunks.mkdir(parents=True)
            feature_tokens = [b'{"type":"Feature","properties":{"id":"F' + str(i).encode() + b'"},"geometry":{"type":"Point","coordinates":[' + str(i).encode() + b',1.234567890123456789]}}' for i in [3, 1, 2, 0]]
            raw = b'{"type":"FeatureCollection","features":[' + b','.join(feature_tokens) + b']}'
            chunk_id = 'political.detail.country.fra'
            (chunks / (chunk_id + '.json')).write_bytes(raw)
            manifest_path = scenario / 'detail_chunks.manifest.json'
            manifest_path.write_text(json.dumps({'chunks': [{'id': chunk_id, 'layer': 'political', 'lod': 'detail', 'country_codes': ['FRA'], 'url': f'data/scenarios/test/chunks/{chunk_id}.json'}]}))
            (scenario / 'context_lod.manifest.json').write_text(json.dumps({'layers': {'political': [{'chunk_ids': [chunk_id]}]}}))
            (scenario / 'runtime_meta.json').write_text('{}')
            with patch('tools.political_detail_partition.POLITICAL_DETAIL_SHARD_MAX_PATH_COST', 24):
                pack_published_runtime_data(app)
            manifest = json.loads(manifest_path.read_bytes())
            self.assertEqual(len(manifest['chunks']), 2)
            decoded = [gzip.decompress((app / chunk['url']).read_bytes()) for chunk in manifest['chunks']]
            self.assertEqual(sum(len(json.loads(part)['features']) for part in decoded), 4)
            for token in feature_tokens:
                self.assertEqual(sum(token in part for part in decoded), 1)
            for chunk in manifest['chunks']:
                self.assertEqual(chunk['owner_code'], 'FRA')
                self.assertIsInstance(chunk['feature_bounds'], list)
                self.assertEqual(chunk['estimated_path_cost'], 24)
                features = json.loads(gzip.decompress((app / chunk['url']).read_bytes()))['features']
                self.assertEqual([bounds[0] for bounds in chunk['feature_bounds']], [feature['geometry']['coordinates'][0] for feature in features])
            context = json.loads((scenario / 'context_lod.manifest.json').read_bytes())
            self.assertEqual(context['layers']['political'][0]['chunk_ids'], [chunk['id'] for chunk in manifest['chunks']])
            self.assertEqual(json.loads((scenario / 'runtime_meta.json').read_bytes())['total_chunk_count'], 2)
            self.assertFalse((chunks / (chunk_id + '.json')).exists())

    def test_compaction_preserves_number_tokens_and_string_whitespace(self):
        raw = b'{ \n "number": 1.234567890123456789e-12, "negative": -0.0, "name": "a \\" b\\n c", "list": [1, 2] }'
        compact = compact_json_bytes(raw)
        self.assertEqual(json.loads(raw), json.loads(compact))
        self.assertIn(b'1.234567890123456789e-12', compact)
        self.assertIn(b'-0.0', compact)
        self.assertIn(b'a \\" b\\n c', compact)
        self.assertEqual(compact_json_bytes(compact), compact)

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

    def test_chunk_url_cannot_escape_its_scenario(self):
        runtime = Path(__file__).resolve().parents[1] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            app = Path(temporary) / 'app'
            scenario = app / 'data/scenarios/test'
            scenario.mkdir(parents=True)
            (scenario / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': [{'url': '../../outside.json'}]}))
            with self.assertRaisesRegex(ValueError, 'escapes app/data'):
                pack_published_runtime_data(app)


if __name__ == '__main__':
    unittest.main()
