"""Pixel oracle for offline R8 rivers and the renderer's edge contract."""
import gzip
import sys
import json
from pathlib import Path
import unittest

import numpy as np

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / 'tools'))
import build_geographic_overlays as geo


class RiverDistanceTests(unittest.TestCase):
    def test_edge_distance_quantization(self):
        # Quantization of Euclidean distance has a <= 1/32 texel error
        # except in the documented saturated exterior/interior.
        diagonal = np.eye(16, dtype=np.uint8)
        field = geo.river_distance_field(diagonal)
        from scipy.ndimage import distance_transform_edt
        outside = distance_transform_edt(~np.pad(diagonal > 0, 1))[1:-1, 1:-1]
        exact = .5-outside
        selected = (diagonal == 0)&(field > 0)
        self.assertLessEqual(np.abs((field.astype(float)-128)/16-exact)[selected].max(), 1/32)

    def test_packaged_fields_match_sources_and_manifest(self):
        folder = APP/'assets/overlays/geography'
        manifest = json.loads((folder/'manifest.json').read_bytes())
        for key, source in [('riversDistance', 'rivers'), ('riversDistanceBalanced', 'riversBalanced')]:
            meta, source_meta = manifest['assets'][key], manifest['assets'][source]
            packed = (folder/meta['url']).read_bytes()
            self.assertEqual(len(packed), meta['byteLength'])
            self.assertEqual(geo.digest(packed), meta['sha256'])
            field = np.frombuffer(gzip.decompress(packed), dtype=np.uint8)
            self.assertEqual(len(field), meta['decodedByteLength'])
            original = np.frombuffer(gzip.decompress((folder/source_meta['url']).read_bytes()),
                                     dtype=np.uint8).reshape(source_meta['height'], source_meta['width'])
            self.assertEqual((meta['width'], meta['height']), (source_meta['width'], source_meta['height']))
            np.testing.assert_array_equal(field.reshape(original.shape), geo.river_distance_field(original))
            # At the source texel centers the default binary boundary remains
            # identical; the diagonal correction only changes subtexel edges.
            np.testing.assert_array_equal(field.reshape(original.shape) > 128, original > 0)


if __name__ == '__main__':
    unittest.main()
