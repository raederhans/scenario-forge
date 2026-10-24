import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
import main_sources
import sync_main_sources


class MainSourcesTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[3] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=runtime)
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_copy_snapshot_returns_the_original_bytes(self):
        data = b'{"geo":{"York":{"zh":"\xe7\xba\xa6\xe5\x85\x8b"}}}\r\n'
        entry = main_sources.pin(self.root, 'data/locales.json', data)
        self.assertEqual(main_sources.read_bytes(self.root, 'data/locales.json'), data)
        self.assertEqual(entry['sha256'], entry['mainSha256'])
        self.assertEqual(main_sources.read_json(self.root, 'data/locales.json')['geo']['York']['zh'], '约克')

    def test_properties_snapshot_keeps_every_feature_without_geometry(self):
        source = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': 'b', 'name_en': 'Bay'}, 'geometry': {'type': 'Point', 'coordinates': [1, 2]}},
            {'type': 'Feature', 'properties': {'id': 'a', 'name_en': 'Sea'}, 'geometry': None}]}
        data = json.dumps(source).encode()
        entry = main_sources.pin(self.root, 'data/marine.geojson', data, mode='properties')
        pinned = main_sources.read_json(self.root, 'data/marine.geojson')
        self.assertEqual([feature['properties']['id'] for feature in pinned['features']], ['b', 'a'])
        self.assertTrue(all('geometry' not in feature for feature in pinned['features']))
        self.assertNotEqual(entry['sha256'], entry['mainSha256'])

    def test_tampered_snapshot_is_rejected(self):
        entry = main_sources.pin(self.root, 'data/hierarchy.json', b'{"labels":{}}')
        (self.root / main_sources.SNAPSHOT_DIR / entry['snapshot']).write_bytes(gzip.compress(b'{"labels":{"x":1}}'))
        with self.assertRaisesRegex(ValueError, 'does not match'):
            main_sources.read_bytes(self.root, 'data/hierarchy.json')

    def test_missing_snapshot_never_falls_back_to_main_data(self):
        (self.root / 'data').mkdir()
        (self.root / 'data/world_cities.geojson').write_bytes(b'{"features":[]}')
        with self.assertRaisesRegex(KeyError, 'sync_main_sources'):
            main_sources.read_bytes(self.root, 'data/world_cities.geojson')
        with self.assertRaisesRegex(KeyError, 'sync_main_sources'):
            main_sources.archive_sha256(self.root, 'data/ne_10m_lakes.zip')

    def test_sync_summary_counts_entry_changes(self):
        before = json.dumps({'entries': [{'stable_key': 'a', 'zh': '甲'}, {'stable_key': 'b', 'zh': '乙'}]}).encode()
        after = json.dumps({'entries': [{'stable_key': 'a', 'zh': '甲'}, {'stable_key': 'b', 'zh': '丙'}, {'stable_key': 'c'}]}).encode()
        self.assertEqual(sync_main_sources.summarize(before, after), {'added': 1, 'removed': 0, 'modified': 1})
        self.assertEqual(sync_main_sources.summarize(b'const a = 1;', b'const a = 2;'), {'changed': True})


if __name__ == '__main__':
    unittest.main()
