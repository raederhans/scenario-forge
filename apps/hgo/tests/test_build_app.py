import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_app import build_app, encoded


class BuildAppTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[3] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'app'
        self.output = self.base / 'packed'
        self.put('index.html', b'<a id="back-link" href="../../index.html">Back</a><script type="module" src="./src/main.js"></script>')
        self.put('styles.css', b'body{margin:0}')
        self.put('src/main.js', b'export const ready = true;')
        self.put('tools/secret.py', b'not shipped')
        self.put('tests/test_secret.py', b'not shipped')
        self.put('assets/default/old_seed.json', b'not shipped')
        self.put('source/provinces.bmp', b'not shipped')
        payloads = {'ids': ('ids.u16.gz', gzip.compress(b'\x01\x00', mtime=0)),
                    'core': ('core.json', encoded(dict(schemaVersion=1))),
                    'places': ('places.json', encoded(dict(schemaVersion=1, places=[])))}
        assets = {}
        for name, (file, payload) in payloads.items():
            self.put('assets/default/' + file, payload)
            assets[name] = dict(url=file, encoding='gzip' if name == 'ids' else 'json',
                                byteLength=len(payload), sha256=hashlib.sha256(payload).hexdigest())
        assets['ids']['decodedByteLength'] = 2
        provenance = dict(files={'source/map.bmp': 'source evidence'})
        self.put('assets/default/provenance.json', encoded(provenance))
        self.manifest = dict(format='hgo-native-dataset', schemaVersion=1, id='fixture',
                             coordinateSpace=dict(kind='pixel', width=1, height=1, origin='top-left', wrapX=False),
                             assets=assets, source=dict(provenanceUrl='provenance.json', fingerprint=hashlib.sha256(encoded(provenance)).hexdigest()),
                             revision=hashlib.sha256(encoded(dict(schemaVersion=1, assets=assets, source=provenance))).hexdigest())
        self.write_manifest()

    def put(self, relative, payload):
        file = self.source / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(payload)

    def write_manifest(self):
        self.put('assets/default/manifest.json', encoded(self.manifest))

    def test_only_declared_closure_and_rewritten_navigation_are_published(self):
        result = build_app(self.source, self.output, '../app/')
        self.assertEqual(result['fileCount'], 8)
        self.assertIn('href="../app/"', (self.output / 'index.html').read_text())
        self.assertTrue((self.output / 'assets/default/provenance.json').is_file())
        self.assertFalse((self.output / 'tools').exists())
        self.assertFalse((self.output / 'assets/default/old_seed.json').exists())
        self.put('src/old.js', b'export {};')
        build_app(self.source, self.output)
        (self.source / 'src/old.js').unlink()
        build_app(self.source, self.output)
        self.assertFalse((self.output / 'src/old.js').exists())

    def test_transport_corruption_fails_before_existing_output_changes(self):
        build_app(self.source, self.output)
        before = (self.output / 'index.html').read_bytes()
        self.put('assets/default/ids.u16.gz', b'bad')
        with self.assertRaisesRegex(ValueError, 'length mismatch'):
            build_app(self.source, self.output, '../changed/')
        self.assertEqual((self.output / 'index.html').read_bytes(), before)

    def test_default_package_navigation_returns_to_repository_editor(self):
        editor = self.base / 'index.html'
        editor.write_text('<title>Main editor</title>')
        output = self.base / '.runtime/dist/hgo'
        build_app(self.source, output)
        entry = (output / 'index.html').read_text()
        href = entry.split('id="back-link" href="', 1)[1].split('"', 1)[0]
        self.assertEqual((output / href).resolve(), editor.resolve())
        self.assertTrue((output / href).is_file())

    def test_escape_and_unsafe_output_are_rejected(self):
        for destination in [self.source, self.base, self.source / 'dist']:
            with self.assertRaisesRegex(ValueError, 'outside'):
                build_app(self.source, destination)
        self.manifest['assets']['core']['url'] = '../../../outside.json'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'escapes|missing'):
            build_app(self.source, self.output)

    def test_same_size_corruption_and_revision_drift_are_rejected(self):
        path = self.source / 'assets/default/core.json'
        original = path.read_bytes()
        path.write_bytes(original.replace(b'1', b'2'))
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            build_app(self.source, self.output)
        path.write_bytes(original)
        self.manifest['revision'] = '0' * 64
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'revision mismatch'):
            build_app(self.source, self.output)

    def test_unowned_output_and_provenance_drift_are_rejected(self):
        self.output.mkdir()
        (self.output / 'user.txt').write_text('preserve')
        with self.assertRaisesRegex(ValueError, 'without an HGO build receipt'):
            build_app(self.source, self.output)
        self.assertEqual((self.output / 'user.txt').read_text(), 'preserve')
        self.put('assets/default/provenance.json', encoded(dict(files={})))
        with self.assertRaisesRegex(ValueError, 'Provenance fingerprint'):
            build_app(self.source, self.base / 'other')


if __name__ == '__main__':
    unittest.main()
