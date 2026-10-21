import gzip
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
spec = importlib.util.spec_from_file_location('hgo_illumination', TOOLS / 'build_illumination.py')
illumination = importlib.util.module_from_spec(spec)
spec.loader.exec_module(illumination)


def _gzip(payload):
    return gzip.compress(payload, mtime=0)


def _asset(folder, name, payload, width, height, channels, encoding):
    filename = f'{name}.gz'
    compressed = _gzip(payload)
    (folder / filename).write_bytes(compressed)
    return dict(url=filename, width=width, height=height, channels=channels,
                encoding=encoding, byteLength=len(compressed),
                decodedByteLength=len(payload),
                sha256=hashlib.sha256(compressed).hexdigest())


class IlluminationTests(unittest.TestCase):
    def test_edge_weight_preserves_domain_and_does_not_treat_confidence_as_opacity(self):
        # An invalid strip at x=0: valid centers are 1..8 texels from it.
        source = bytes([0, 0, 0, 0] + [255, 128, 128, 96] * 8)
        result, stats = illumination.soften_illumination(source, 9, 1)
        cells = [result[i:i+4] for i in range(0, len(result), 4)]
        self.assertEqual(cells[0], bytes(4))
        self.assertEqual(cells[1], bytes([11, 6, 6, 11]))
        self.assertEqual([c[3] for c in cells], [0, 11, 81, 174, 244, 255, 255, 255, 255])
        self.assertEqual(cells[-1], bytes([255, 128, 128, 255]))
        self.assertEqual(stats, dict(fadedCells=4, fullWeightCells=4, invalidCells=1))
        # No artificial fade around the map frame or between confidence classes.
        a, _ = illumination.soften_illumination(bytes([255, 128, 128, 96, 255, 128, 128, 180]), 2, 1)
        self.assertEqual(a, bytes([255, 128, 128, 255] * 2))
        empty, _ = illumination.soften_illumination(bytes(16), 2, 2)
        self.assertEqual(empty, bytes(16))

    def test_geo_vector_encodes_both_hemispheres_and_solar_axes(self):
        self.assertEqual(illumination.encode_geo_vector(0, 0), (255, 128, 128))
        self.assertEqual(illumination.encode_geo_vector(180, 0), (0, 128, 128))
        self.assertEqual(illumination.encode_geo_vector(90, 0), (128, 255, 128))
        self.assertEqual(illumination.encode_geo_vector(0, 90), (128, 128, 255))
        self.assertEqual(illumination.encode_geo_vector(0, -90), (128, 128, 0))
        with self.assertRaises(ValueError):
            illumination.encode_geo_vector(0, math.nan)
        with self.assertRaises(ValueError):
            illumination.encode_geo_vector(181, 0)

    def test_bilinear_sampling_wraps_date_line_and_clamps_poles(self):
        width, height = 720, 360
        grid = bytearray(width * height)
        row = 179  # latitude 0.25 degrees is a source row center.
        grid[row * width] = 200
        grid[row * width + width - 1] = 100
        self.assertEqual(illumination.sample_bilinear(grid, width, height, 180, 0.25), 150)

        grid[0] = 77
        self.assertEqual(illumination.sample_bilinear(grid, width, height, -179.75, 90), 77)
        self.assertEqual(illumination.sample_bilinear(grid, width, height, -179.75, -90),
                         grid[(height - 1) * width])

    def test_build_preserves_invalid_mask_and_binds_source_and_base(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            geography_folder = root / 'geography'
            geography_folder.mkdir()
            base_revision = 'a' * 64
            base = dict(format='hgo-native-dataset', schemaVersion=1,
                        id='test-native-dataset', revision=base_revision,
                        coordinateSpace=dict(width=5120, height=2560))
            base_path = root / 'base.json'
            base_path.write_text(json.dumps(base), encoding='utf-8')

            night_points = [
                (0.0, 0.0),
                (90.0, 0.0),
                (math.nan, math.nan),
                (181.0, 0.0),
            ]
            broad_points = [
                (0.0, 0.0),
                (90.0, 0.0),
                (math.nan, math.nan),
                (0.0, 91.0),
            ]
            night_lonlat = b''.join(struct.pack('<ff', *point) for point in night_points)
            broad_lonlat = b''.join(struct.pack('<ff', *point) for point in broad_points)
            night_confidence = bytes((255, 90, 0, 255))
            broad_confidence = bytes((180, 96, 0, 96))
            night_lon_asset = _asset(geography_folder, 'inverse-lonlat', night_lonlat, 2, 2, 2,
                                     'gzip-f32le-x2')
            night_confidence_asset = _asset(geography_folder, 'inverse-confidence',
                                            night_confidence, 2, 2, 1, 'gzip-u8')
            broad_lon_asset = _asset(geography_folder, 'broad-inverse-lonlat', broad_lonlat,
                                     2, 2, 2, 'gzip-f32le-x2')
            broad_confidence_asset = _asset(geography_folder, 'broad-inverse-confidence',
                                            broad_confidence, 2, 2, 1, 'gzip-u8')
            georeference_bytes = json.dumps({'smoothRegistration': {'method': 'rbf'}}).encode('utf-8')
            georeference_path = geography_folder / 'georeference.json'
            georeference_path.write_bytes(georeference_bytes)
            georeference_asset = dict(url='georeference.json', encoding='json',
                                      byteLength=len(georeference_bytes),
                                      sha256=hashlib.sha256(georeference_bytes).hexdigest())
            geography = dict(format='hgo-geographic-overlays', schemaVersion=1,
                             datasetRevision=base_revision,
                             nativeSize=[5120, 2560],
                             coordinateSpace='hgo-pixel-top-left',
                             coverage=dict(inverseGridSize=[2, 2],
                                           sampleMethod='synthetic RBF reference centers'),
                             assets=dict(inverseLonLat=night_lon_asset,
                                         inverseConfidence=night_confidence_asset,
                                         broadInverseLonLat=broad_lon_asset,
                                         broadInverseConfidence=broad_confidence_asset,
                                         georeference=georeference_asset))
            geography_path = geography_folder / 'manifest.json'
            geography_path.write_text(json.dumps(geography), encoding='utf-8')

            cells = ['240'] * (illumination.EXPECTED_SOURCE_WIDTH * illumination.EXPECTED_SOURCE_HEIGHT)
            source_path = root / 'city-lights.js'
            source_path.write_text(
                "export const MODERN_CITY_LIGHTS_SOURCE = Object.freeze({name: 'Black Marble', "
                "url: 'https://example.test/black-marble',});\n"
                "export const MODERN_CITY_LIGHTS_GRID_WIDTH = 720;\n"
                "export const MODERN_CITY_LIGHTS_GRID_HEIGHT = 360;\n"
                "export const MODERN_CITY_LIGHTS_STEP_LON_DEG = 0.5;\n"
                "export const MODERN_CITY_LIGHTS_STEP_LAT_DEG = 0.5;\n"
                "export const MODERN_CITY_LIGHTS_GRID = new Uint8Array([" + ','.join(cells) + "]);\n",
                encoding='utf-8')

            output = root / 'illumination'
            result = illumination.build(base_path, geography_path, source_path, output)
            manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
            night_lights = gzip.decompress((output / 'night-lights.u8.gz').read_bytes())
            night_lights_confidence = gzip.decompress(
                (output / 'night-lights-confidence.u8.gz').read_bytes())
            vectors = gzip.decompress((output / 'illumination.rgba8.gz').read_bytes())

            self.assertEqual(result['baseDataset'], dict(id=base['id'], revision=base_revision))
            self.assertEqual((manifest['width'], manifest['height']), (2, 2))
            self.assertEqual(manifest['source']['attestation'], 'not_attested')
            self.assertEqual(manifest['source']['upstreamInputSha256'], 'unavailable')
            self.assertEqual(manifest['registration']['identity'], georeference_asset['sha256'])
            self.assertEqual(manifest['registration']['illuminationInverse']['confidenceSha256'],
                             broad_confidence_asset['sha256'])
            self.assertEqual(manifest['assets']['nightLights']['validityAsset'],
                             'nightLightsConfidence')
            self.assertEqual(len(night_lights), 4)
            self.assertEqual(night_lights_confidence, bytes((255, 90, 0, 0)))
            self.assertEqual(len(vectors), 16)
            self.assertEqual(night_lights[0], 240)
            self.assertEqual(vectors[0:4], bytes((11, 6, 6, 11)))
            self.assertEqual(vectors[4:8], bytes((6, 11, 6, 11)))
            self.assertEqual(manifest['assets']['illumination']['vectorEncoding'], illumination.VECTOR_ENCODING)
            self.assertEqual(night_lights[2], 0)
            self.assertEqual(vectors[8:12], b'\0\0\0\0')
            self.assertEqual(night_lights[3], 0)
            self.assertEqual(vectors[12:16], b'\0\0\0\0')
            self.assertEqual(manifest['stats']['nightLights']['nonFiniteOrOutOfRangeConfidentCount'], 1)
            self.assertEqual(manifest['stats']['illumination']['nonFiniteOrOutOfRangeConfidentCount'], 1)
            for key, filename in (('nightLights', 'night-lights.u8.gz'),
                                  ('nightLightsConfidence', 'night-lights-confidence.u8.gz'),
                                  ('illumination', 'illumination.rgba8.gz')):
                data = (output / filename).read_bytes()
                self.assertEqual(len(data), manifest['assets'][key]['byteLength'])
                self.assertEqual(hashlib.sha256(data).hexdigest(), manifest['assets'][key]['sha256'])
                self.assertEqual(len(gzip.decompress(data)),
                                 manifest['assets'][key]['decodedByteLength'])


if __name__ == '__main__':
    unittest.main()
