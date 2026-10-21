import gzip
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
import sys
sys.path.insert(0, str(TOOLS))
from build_app import build_app, encoded as app_encoded
from build_overlay_catalog import build as build_catalog, encoded as catalog_encoded


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


class OverlayPackageTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[3] / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temporary.cleanup)
        self.workspace = Path(self.temporary.name) / 'workspace'
        self.app = self.workspace / 'apps/hgo'
        self.output = Path(self.temporary.name) / 'packed'
        self.base_identity = self._make_base()
        self._make_overlays()
        self.catalog_path = self.app / 'assets/overlays/catalog.json'
        build_catalog(self.workspace)

    def put(self, relative, payload):
        path = self.app / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return path

    def put_json(self, relative, value):
        return self.put(relative, app_encoded(value))

    def _make_base(self):
        self.put('index.html', b'<a href="../../index.html">Back</a><script type="module" src="./src/main.js"></script>')
        self.put('styles.css', b'body{margin:0}')
        self.put('src/main.js', b'export const ready = true;')
        ids = gzip.compress(b'\x01\x00', mtime=0)
        core = app_encoded(dict(schemaVersion=1, states=[], entities=[]))
        places = app_encoded(dict(schemaVersion=1, places=[]))
        payloads = {'ids': ('ids.u16.gz', ids, 'gzip', 2),
                    'core': ('core.json', core, 'json', None),
                    'places': ('places.json', places, 'json', None)}
        assets = {}
        for name, (filename, payload, encoding, decoded_length) in payloads.items():
            self.put(f'assets/default/{filename}', payload)
            assets[name] = dict(url=filename, encoding=encoding, byteLength=len(payload), sha256=digest(payload))
            if decoded_length is not None:
                assets[name]['decodedByteLength'] = decoded_length
        provenance = dict(files={'source/map.bmp': 'fixture evidence'})
        self.put_json('assets/default/provenance.json', provenance)
        source = dict(provenanceUrl='provenance.json', fingerprint=digest(app_encoded(provenance)))
        revision = digest(app_encoded(dict(schemaVersion=1, assets=assets, source=provenance)))
        identity = dict(id='fixture-hgo', revision=revision)
        manifest = dict(format='hgo-native-dataset', schemaVersion=1, id=identity['id'],
                        revision=revision,
                        coordinateSpace=dict(kind='pixel', width=1, height=1,
                                             origin='top-left', wrapX=False),
                        assets=assets, source=source)
        self.put_json('assets/default/manifest.json', manifest)
        return identity

    def _binary_asset(self, folder, name, payload, width, height, channels):
        filename = f'{name}.gz'
        compressed = gzip.compress(payload, mtime=0)
        self.put(f'{folder}/{filename}', compressed)
        return dict(url=filename, encoding='gzip-u8', width=width, height=height,
                    channels=channels, byteLength=len(compressed),
                    decodedByteLength=len(payload), sha256=digest(compressed))

    def _json_asset(self, folder, name, value):
        filename = f'{name}.json'
        payload = app_encoded(value)
        self.put(f'{folder}/{filename}', payload)
        return dict(url=filename, encoding='json', byteLength=len(payload), sha256=digest(payload))

    def _make_overlays(self):
        self.put_json('assets/overlays/localization/index.json',
                      dict(format='hgo-native-localization', schemaVersion=1,
                           dataset=self.base_identity, entities={}, places={}, states={}))
        self.put_json('assets/overlays/metrics/metrics.json',
                      dict(format='hgo-native-metrics', schemaVersion=1,
                           baseDataset=self.base_identity, states=[]))
        self.put_json('assets/overlays/localization/provenance.json', dict(schemaVersion=1, sources=[]))
        self.put_json('assets/overlays/localization/reviewed_translations.json',
                      dict(schemaVersion=1, entities={}, geographicTerms={}, scopedNames={}))
        self.put_json('assets/overlays/localization/place_reviews.json',
                      dict(schemaVersion=1, entries=[]))
        self.put_json('assets/overlays/localization/state_reviews.json',
                      dict(schemaVersion=1, entries=[]))
        self.put('assets/overlays/localization/OPENCC-LICENSE.txt', b'Apache License 2.0\n')
        self.put_json('assets/overlays/metrics/provenance.json', dict(schemaVersion=1, sources=[]))

        geo_folder = 'assets/overlays/geography'
        self.put_json(f'{geo_folder}/name_reviews.json', dict(schemaVersion=1, entries=[]))
        physical = self._binary_asset(geo_folder, 'physical.u8', b'\x11', 1, 1, 1)
        physical_balanced = self._binary_asset(geo_folder, 'physical-balanced.u8',
                                               bytes(1280 * 640), 1280, 640, 1)
        rivers = self._binary_asset(geo_folder, 'rivers.u8', b'\x00', 1, 1, 1)
        rivers_balanced = self._binary_asset(geo_folder, 'rivers-balanced.u8',
                                             bytes(2560 * 1280), 2560, 1280, 1)
        rivers_distance = self._binary_asset(geo_folder, 'rivers-distance.u8', b'\x00', 1, 1, 1)
        rivers_distance_balanced = self._binary_asset(geo_folder, 'rivers-distance-balanced.u8',
                                                      bytes(2560 * 1280), 2560, 1280, 1)
        for asset in (rivers_distance, rivers_distance_balanced):
            asset['distanceField'] = dict(version=1, zero=128, unitsPerTexel=16)
        inverse = gzip.compress(struct.pack('<ff', 0.0, 0.0), mtime=0)
        inverse_confidence = gzip.compress(bytes((180,)), mtime=0)
        for name, payload in [('inverse-lonlat.f32.gz', inverse),
                              ('inverse-confidence.u8.gz', inverse_confidence),
                              ('broad-inverse-lonlat.f32.gz', inverse),
                              ('broad-inverse-confidence.u8.gz', inverse_confidence)]:
            self.put(f'{geo_folder}/{name}', payload)
        georeference = self._json_asset(geo_folder, 'georeference', dict(smoothRegistration={}))
        labels = self._json_asset(geo_folder, 'labels', dict(schemaVersion=1, coordinateSpace='hgo-pixel', labels=[]))
        geography = dict(format='hgo-geographic-overlays', schemaVersion=1,
                         datasetRevision=self.base_identity['revision'], nativeSize=[1, 1],
                         coordinateSpace='hgo-pixel-top-left',
                         coverage=dict(inverseGridSize=[1, 1]),
                         palette=[dict(code=1, id='plains', color='#123456',
                                       label=dict(en='Plains', zh='平原'))],
                         assets=dict(physical=physical, physicalBalanced=physical_balanced,
                                     rivers=rivers, riversBalanced=rivers_balanced,
                                     riversDistance=rivers_distance, riversDistanceBalanced=rivers_distance_balanced,
                                     georeference=georeference, labels=labels))
        self.put_json(f'{geo_folder}/manifest.json', geography)

        illumination_folder = 'assets/overlays/illumination'
        night_bytes = bytes(512 * 256)
        vector_bytes = bytes(512 * 256 * 4)
        confidence_bytes = bytes(512 * 256)
        night_asset = self._binary_asset(illumination_folder, 'night-lights.u8', night_bytes, 512, 256, 1)
        vector_asset = self._binary_asset(illumination_folder, 'illumination.rgba8', vector_bytes, 512, 256, 4)
        vector_asset['vectorEncoding'] = 'premultiplied-unit-rgb-edge-fade-v2'
        confidence_asset = self._binary_asset(illumination_folder, 'night-lights-confidence.u8', confidence_bytes,
                                              512, 256, 1)
        # The builder's runtime contract uses gzip-u8; source sidecar descriptors use the same encoding.
        for asset in (night_asset, vector_asset, confidence_asset):
            asset['dtype'] = 'u8'
        illumination = dict(format='hgo-illumination-overlays', schemaVersion=1,
                            baseDataset=self.base_identity, width=512, height=256,
                            assets=dict(nightLights=night_asset, illumination=vector_asset,
                                        nightLightsConfidence=confidence_asset))
        self.put_json(f'{illumination_folder}/manifest.json', illumination)

    def read_catalog(self):
        return json.loads(self.catalog_path.read_text(encoding='utf-8'))

    def write_catalog(self, value):
        self.catalog_path.write_bytes(catalog_encoded(value))

    def test_catalog_binds_native_assets_and_app_build_copies_exact_closure(self):
        catalog = self.read_catalog()
        self.assertEqual(catalog['format'], 'hgo-visualization-catalog')
        self.assertEqual(catalog['baseDataset'], self.base_identity)
        self.assertEqual(catalog['assets']['terrain']['path'], 'geography/physical.u8.gz')
        self.assertEqual((catalog['assets']['terrain']['width'], catalog['assets']['terrain']['height']), (1, 1))
        self.assertEqual(catalog['assets']['terrainBalanced']['path'],
                         'geography/physical-balanced.u8.gz')
        self.assertEqual((catalog['assets']['terrainBalanced']['width'],
                          catalog['assets']['terrainBalanced']['height']), (1280, 640))
        self.assertEqual(catalog['assets']['riversBalanced']['path'],
                         'geography/rivers-distance-balanced.u8.gz')
        self.assertEqual(catalog['assets']['terrainLabels']['path'], 'geography/labels.json')
        self.assertEqual((catalog['assets']['riversBalanced']['width'],
                          catalog['assets']['riversBalanced']['height']), (2560, 1280))
        palette_path = self.app / 'assets/overlays/geography/palette.json'
        self.assertEqual(json.loads(palette_path.read_text(encoding='utf-8'))['palette'],
                         json.loads((self.app / 'assets/overlays/geography/manifest.json').read_text(encoding='utf-8'))['palette'])
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

    def test_builder_rejects_invalid_or_unattested_landform_names(self):
        folder = self.app / 'assets/overlays/geography'
        manifest_path = folder / 'manifest.json'
        original = json.loads(manifest_path.read_bytes())
        for value in [dict(schemaVersion=1, coordinateSpace='lonlat', labels=[]),
                      dict(schemaVersion=1, coordinateSpace='hgo-pixel', labels=[
                          dict(id='bad', nameEn='Outside', nameZh='', x=5, y=0, rank=1, minZoom=2)])]:
            manifest = json.loads(json.dumps(original))
            asset = self._json_asset('assets/overlays/geography', 'labels', value)
            manifest['assets']['labels'] = asset
            manifest_path.write_bytes(app_encoded(manifest))
            with self.assertRaisesRegex(ValueError, '[Ll]andform label'):
                build_catalog(self.workspace)
        manifest_path.write_bytes(app_encoded(original))
        with self.assertRaisesRegex(ValueError, 'Landform labels integrity'):
            build_catalog(self.workspace)

    def test_builder_rejects_a_mask_mislabeled_as_a_distance_field(self):
        path = self.app / 'assets/overlays/geography/manifest.json'
        manifest = json.loads(path.read_bytes())
        del manifest['assets']['riversDistance']['distanceField']
        path.write_bytes(app_encoded(manifest))
        with self.assertRaisesRegex(ValueError, 'unsupported distance field'):
            build_catalog(self.workspace)

    def test_packager_rejects_escape_paths_and_wrong_base(self):
        catalog = self.read_catalog()
        catalog['assets']['terrain']['path'] = '../../secret.bin'
        self.write_catalog(catalog)
        with self.assertRaisesRegex(ValueError, 'escapes overlays'):
            build_app(self.app, self.output)

        catalog = self.read_catalog()
        catalog['assets']['terrain']['path'] = 'geography/physical.u8.gz'
        catalog['baseDataset']['revision'] = '0' * 64
        self.write_catalog(catalog)
        with self.assertRaisesRegex(ValueError, 'base dataset mismatch'):
            build_app(self.app, self.output)

    def test_packager_rejects_hash_corruption_and_wrong_gzip_decoded_size(self):
        terrain = self.app / 'assets/overlays/geography/physical.u8.gz'
        original = terrain.read_bytes()
        terrain.write_bytes(original[:-1] + bytes((original[-1] ^ 1,)))
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            build_app(self.app, self.output)
        terrain.write_bytes(original)

        catalog = self.read_catalog()
        catalog['assets']['terrain']['decodedByteLength'] += 1
        self.write_catalog(catalog)
        with self.assertRaisesRegex(ValueError, 'decoded size mismatch'):
            build_app(self.app, self.output)

    def test_packager_enforces_per_asset_decoded_size_limit_for_balanced_layers(self):
        catalog = self.read_catalog()
        balanced = catalog['assets']['riversBalanced']
        balanced.update(width=6000, height=6000, decodedByteLength=36_000_000)
        self.write_catalog(catalog)
        with self.assertRaisesRegex(ValueError, 'declared decoded size mismatch'):
            build_app(self.app, self.output)

    def test_boundary_rejects_provenance_path_outside_overlay_root(self):
        build_app(self.app, self.output)
        catalog_path = self.output / 'assets/overlays/catalog.json'
        catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
        catalog['provenance'][0]['path'] = '../default/manifest.json'
        catalog_path.write_bytes(catalog_encoded(catalog))
        node = shutil.which('node')
        self.assertIsNotNone(node)
        checker = TOOLS / 'check_boundary.mjs'
        result = subprocess.run([node, str(checker), str(self.output)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Invalid Overlay provenance path', result.stderr)


if __name__ == '__main__':
    unittest.main()
