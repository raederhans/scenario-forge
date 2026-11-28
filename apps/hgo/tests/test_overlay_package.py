import shutil
import json
from pathlib import Path
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
import sys
sys.path.insert(0, str(TOOLS))
from build_app import build_app, encoded as app_encoded
from build_overlay_catalog import build as build_catalog, encoded as catalog_encoded


class OverlayPackageTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[3] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temporary.cleanup)
        self.workspace = Path(self.temporary.name) / 'workspace'
        self.app = self.workspace / 'apps/hgo'
        self.output = Path(self.temporary.name) / 'packed'
        source = TOOLS.parent
        self.app.mkdir(parents=True)
        for folder in ('src', 'assets/default', 'assets/overlays'):
            shutil.copytree(source / folder, self.app / folder)
        for name in ('index.html', 'styles.css'):
            shutil.copyfile(source / name, self.app / name)
        base = json.loads((self.app / 'assets/default/manifest.json').read_bytes())
        self.base_identity = {'id': base['id'], 'revision': base['revision']}
        self.catalog_path = self.app / 'assets/overlays/catalog.json'
        build_catalog(self.workspace)

    def read_catalog(self):
        return json.loads(self.catalog_path.read_text(encoding='utf-8'))

    def write_catalog(self, value):
        self.catalog_path.write_bytes(catalog_encoded(value))

    def test_catalog_binds_native_assets_and_app_build_copies_exact_closure(self):
        catalog = self.read_catalog()
        self.assertEqual(catalog['format'], 'hgo-visualization-catalog')
        self.assertEqual(catalog['baseDataset'], self.base_identity)
        build_app(self.app, self.output)
        packaged_base = json.loads((self.output / 'assets/default/manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(packaged_base['revision'], self.base_identity['revision'])
        for item in list(catalog['assets'].values()) + catalog['provenance']:
            self.assertTrue((self.output / 'assets/overlays' / item['path']).is_file())
        self.assertFalse((self.output / 'tools').exists())

    def test_builder_rejects_sidecar_from_another_base_dataset(self):
        path = self.app / 'assets/overlays/metrics/metrics.json'
        metrics = json.loads(path.read_text(encoding='utf-8'))
        metrics['baseDataset']['revision'] = '0' * 64
        path.write_bytes(app_encoded(metrics))
        with self.assertRaisesRegex(ValueError, 'Metrics base dataset mismatch'):
            build_catalog(self.workspace)

    def test_packager_rejects_escape_paths(self):
        catalog = self.read_catalog()
        catalog['assets']['terrain']['path'] = '../../secret.bin'
        self.write_catalog(catalog)
        with self.assertRaisesRegex(ValueError, 'escapes overlays'):
            build_app(self.app, self.output)

    def test_packager_rejects_wrong_gzip_decoded_size(self):
        catalog = self.read_catalog()
        catalog['assets']['terrain']['decodedByteLength'] += 1
        self.write_catalog(catalog)
        with self.assertRaisesRegex(ValueError, 'decoded size mismatch'):
            build_app(self.app, self.output)


if __name__ == '__main__':
    unittest.main()
