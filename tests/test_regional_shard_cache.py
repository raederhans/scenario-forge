"""Regional rebuild caches may contain several disjoint shards for one owner."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tests import test_regional_scenario_assets as fixtures
from tools.regional_scenario_assets import build_regional_scenario_assets
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets


class RegionalShardCacheTests(unittest.TestCase):
    def _fixture(self, root, mode='complete'):
        baseline, candidate = fixtures.RegionalScenarioAssetsTest()._fixture(root, changed=False)
        (baseline / 'owners.by_feature.json').write_text(json.dumps({'owners': {'RU_A': 'KEEP', 'RU_B': 'KEEP'}}))
        manifest = json.loads((baseline / 'manifest.json').read_bytes())
        runtime = json.loads((baseline / 'runtime_topology.topo.json').read_bytes())
        build_and_write_scenario_chunk_assets(scenario_dir=baseline, manifest_payload=manifest, runtime_topology_payload=runtime, generated_at='test')
        chunk_manifest_path = baseline / 'detail_chunks.manifest.json'
        chunks_manifest = json.loads(chunk_manifest_path.read_bytes())
        whole = next(chunk for chunk in chunks_manifest['chunks'] if chunk['lod'] == 'detail')
        features = json.loads((baseline / 'chunks/political.detail.country.keep.json').read_bytes())['features']
        shards = []
        for index, feature in enumerate(features[:1] if mode == 'incomplete' else features):
            chunk_id = f'political.detail.country.keep.part.{index:03}'
            path = baseline / 'chunks' / f'{chunk_id}.json'
            path.write_text(json.dumps({'type': 'FeatureCollection', 'features': [features[0] if mode == 'duplicate' else feature]}))
            shards.append({**whole, 'id': chunk_id, 'owner_code': 'KEEP', 'url': f'data/scenarios/demo/chunks/{path.name}', 'byte_size': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        chunks_manifest['chunks'] = [chunk for chunk in chunks_manifest['chunks'] if chunk['lod'] != 'detail'] + shards
        chunk_manifest_path.write_text(json.dumps(chunks_manifest))
        return baseline, candidate

    def test_complete_shard_set_is_a_valid_regional_cache(self):
        runtime = Path(__file__).resolve().parents[1] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            root = Path(directory)
            baseline, candidate = self._fixture(root)
            result = build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=root / 'result')
            self.assertEqual(result['status'], 'candidate')

    def test_missing_or_duplicate_members_reject_before_publish(self):
        runtime = Path(__file__).resolve().parents[1] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        for mode in ('incomplete', 'duplicate'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(dir=runtime) as directory:
                root = Path(directory)
                baseline, candidate = self._fixture(root, mode)
                with self.assertRaisesRegex(ValueError, 'incomplete|membership'):
                    build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=root / 'result')
                self.assertFalse((root / 'result').exists())
