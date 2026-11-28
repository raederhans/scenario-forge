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


def _asset(folder, name, payload, width, height, channels, encoding):
    filename = f'{name}.gz'
    compressed = gzip.compress(payload, mtime=0)
    (folder / filename).write_bytes(compressed)
    return dict(url=filename, width=width, height=height, channels=channels,
                encoding=encoding, byteLength=len(compressed),
                decodedByteLength=len(payload),
                sha256=hashlib.sha256(compressed).hexdigest())


class IlluminationTests(unittest.TestCase):
    def test_softening_keeps_invalid_pixel_transparent(self):
        # An invalid strip at x=0: valid centers are 1..8 texels from it.
        source = bytes([0, 0, 0, 0] + [255, 128, 128, 96] * 8)
        result, _ = illumination.soften_illumination(source, 9, 1)
        cells = [result[i:i+4] for i in range(0, len(result), 4)]
        self.assertEqual(cells[0], bytes(4))

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

    def test_build_keeps_invalid_vectors_transparent(self):
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

            points = [(0, 0), (90, 0), (math.nan, math.nan), (0, 91)]
            lonlat = b''.join(struct.pack('<ff', *point) for point in points)
            lon_asset = _asset(geography_folder, 'lonlat', lonlat, 2, 2, 2, 'gzip-f32le-x2')
            confidence = _asset(geography_folder, 'confidence', bytes((180, 96, 0, 96)),
                                2, 2, 1, 'gzip-u8')
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
                             assets=dict(inverseLonLat=lon_asset,
                                         inverseConfidence=confidence,
                                         broadInverseLonLat=lon_asset,
                                         broadInverseConfidence=confidence,
                                         georeference=georeference_asset))
            geography_path = geography_folder / 'manifest.json'
            geography_path.write_text(json.dumps(geography), encoding='utf-8')

            output = root / 'illumination'
            illumination.build(base_path, geography_path, None, output)
            vectors = gzip.decompress((output / 'illumination.rgba8.gz').read_bytes())

            self.assertEqual(vectors[8:12], b'\0\0\0\0')
            self.assertEqual(vectors[12:16], b'\0\0\0\0')


if __name__ == '__main__':
    unittest.main()
