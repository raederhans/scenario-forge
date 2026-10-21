import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_native_metrics import build, encoded


class NativeMetricsTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[3] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.output = self.root / 'metrics'
        self.base = self.root / 'base'
        self.base.mkdir()
        self.put('history/states/1-Alpha.txt', '''state={
 id=1 provinces={11 12}
 resources={steel=3.5 oil=0}
 history={
  owner=AAA
  buildings={infrastructure=4 industrial_complex=2 11={air_base=3 infrastructure=2} 12={naval_base=1}}
  1936.1.1={resources={rubber=1} buildings={arms_factory=1 11={air_base=4}}}
  1937.1.1={buildings={industrial_complex=99}}
 }
}''')
        self.put('history/states/2-Beta.txt', '''state={
 id=2 provinces={21}
 history={owner=BBB buildings={infrastructure=2 999={dockyard=3}}}
}''')
        core = {
            'schemaVersion': 1,
            'provinceIds': [None, 11, 12, 21],
            'provinceStateIds': [None, 1, 1, 2],
            'states': [
                {'id': 1, 'provinceIds': [11, 12]},
                {'id': 2, 'provinceIds': [21]},
            ],
        }
        core_bytes = encoded(core)
        (self.base / 'core.json').write_bytes(core_bytes)
        manifest = {
            'format': 'hgo-native-dataset', 'schemaVersion': 1,
            'id': 'hgo-1936', 'revision': 'a' * 64,
            'source': {'id': 'hgo_mod_2241701657', 'asOf': '1936.1.1'},
            'assets': {'core': {'url': 'core.json', 'byteLength': len(core_bytes),
                                'sha256': hashlib.sha256(core_bytes).hexdigest()}},
        }
        (self.base / 'manifest.json').write_bytes(encoded(manifest))

    def put(self, name, text):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def generate(self):
        return build(self.source, self.base / 'manifest.json', self.output)

    def test_values_are_date_selected_scoped_and_deterministic(self):
        self.generate()
        before = {path.name: path.read_bytes() for path in self.output.iterdir()}
        self.generate()
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.output.iterdir()})
        payload = json.loads((self.output / 'metrics.json').read_bytes())
        alpha = payload['states']['1']
        beta = payload['states']['2']
        self.assertEqual(payload['baseDataset'], {'id': 'hgo-1936', 'revision': 'a' * 64})
        self.assertEqual(payload['asOf'], '1936.1.1')
        self.assertEqual(alpha['values']['resource_steel'], 3.5)
        self.assertEqual(alpha['values']['resource_oil'], 0)
        self.assertEqual(alpha['values']['resource_rubber'], 1)
        self.assertIsNone(alpha['values']['resource_chromium'])
        self.assertEqual(alpha['values']['infrastructure'], 4)
        self.assertEqual(alpha['values']['industrial_complex'], 2)
        self.assertEqual(alpha['values']['arms_factory'], 1)
        self.assertEqual(alpha['values']['air_base'], 4)
        self.assertEqual(alpha['provinceBuildings']['11']['infrastructure'], 2)
        self.assertEqual(alpha['provinceBuildings']['11']['air_base'], 4)
        self.assertEqual(alpha['provinceBuildings']['12']['naval_base'], 1)
        self.assertIsNone(beta['values']['resource_steel'])
        self.assertIsNone(beta['values']['dockyard'])
        self.assertNotIn('anchor', alpha)

    def test_stale_province_reference_is_diagnostic_and_not_placed(self):
        self.generate()
        payload = json.loads((self.output / 'metrics.json').read_bytes())
        provenance = json.loads((self.output / 'provenance.json').read_bytes())
        self.assertNotIn('999', payload['states']['2']['provinceBuildings'])
        stale = [item for item in provenance['diagnostics']
                 if item['kind'] == 'stale-province-building-reference']
        self.assertEqual(len(stale), 1)
        self.assertEqual(stale[0]['provinceId'], 999)
        self.assertEqual(stale[0]['reason'], 'unknown-to-base-dataset')
        self.assertEqual(stale[0]['buildings'], {'dockyard': 3})
        self.assertNotIn('coordinates', stale[0])

    def test_source_base_membership_must_match(self):
        self.put('history/states/1-Alpha.txt', '''state={id=1 provinces={11} history={owner=AAA}}''')
        with self.assertRaisesRegex(ValueError, 'province membership mismatch'):
            self.generate()

    def test_base_core_integrity_is_checked(self):
        (self.base / 'core.json').write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
            self.generate()


if __name__ == '__main__':
    unittest.main()
