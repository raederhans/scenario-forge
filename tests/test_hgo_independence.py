import json
from pathlib import Path
import unittest

from map_builder.contracts import resolve_scenario_contract_profile

ROOT = Path(__file__).resolve().parents[1]


class HgoIndependenceTests(unittest.TestCase):
    def test_common_scenarios_do_not_claim_native_hgo(self):
        index = json.loads((ROOT / 'data/scenarios/index.json').read_bytes())
        self.assertNotIn('hgo_1936', [s['scenario_id'] for s in index['scenarios']])
        self.assertEqual(index['default_scenario_id'], 'tno_1962')
        with self.assertRaisesRegex(ValueError, 'independent'):
            resolve_scenario_contract_profile('hgo_1936')

    def test_main_catalog_keeps_identity_and_retires_preview_geometry(self):
        registry = json.loads((ROOT / 'data/runtime_asset_registry.json').read_bytes())['assets']
        self.assertIn('hgo_identity_aliases', registry)
        self.assertFalse(any(k.startswith('hgo_runtime_') for k in registry))
        manifest = json.loads((ROOT / 'data/manifest.json').read_bytes())
        self.assertFalse(any(k.startswith('hgo_runtime/') for k in manifest['outputs']))
        native = json.loads((ROOT / 'apps/hgo/assets/default/manifest.json').read_bytes())
        self.assertEqual(native['coordinateSpace']['kind'], 'pixel')
        self.assertEqual(native['stats']['waterStateCount'], 924)

    def test_retired_builders_cannot_reintroduce_the_embedded_runtime(self):
        for path in ('data/hgo_runtime', 'data/scenarios/hgo_1936', 'scenario_builder/hgo',
                     'tools/build_hgo_runtime_assets.py', 'tools/build_hgo_runtime_seed.py',
                     'tools/build_hgo_scenario.py', 'tools/spike_hgo_runtime_lod_assets.mjs'):
            self.assertFalse((ROOT / path).exists(), path)
        scripts = json.loads((ROOT / 'package.json').read_bytes())['scripts']
        self.assertNotIn('spike:hgo-runtime-lod', scripts)


if __name__ == '__main__':
    unittest.main()
