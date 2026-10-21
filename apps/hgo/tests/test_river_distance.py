"""Pixel oracle for offline R8 rivers and the renderer's edge contract."""
import gzip
import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np

APP = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('river_geo', APP/'tools/build_geographic_overlays.py')
geo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geo)


def coverage(field, x, y, width, device_scale):
    # WebGL linear filtering addresses texel centers at i+.5.
    px, py = x-.5, y-.5
    ix, iy = np.floor(px).astype(int), np.floor(py).astype(int)
    fx, fy = px-ix, py-iy
    def sample(dx, dy):
        return (field[np.clip(iy+dy, 0, field.shape[0]-1),
                      np.clip(ix+dx, 0, field.shape[1]-1)].astype(float)-128)/16
    a, b, c, d = sample(0, 0), sample(1, 0), sample(0, 1), sample(1, 1)
    distance = ((1-fx)*a+fx*b)*(1-fy)+((1-fx)*c+fx*d)*fy
    diagonal = (a > 0)&(d > 0)
    t = np.clip((fx+fy)*.5, 0, 1)
    segment = .5-np.hypot(fx-t, fy-t)
    distance = np.where(diagonal, np.maximum(distance, segment), distance)
    diagonal = (b > 0)&(c > 0)
    t = np.clip((1-fx+fy)*.5, 0, 1)
    segment = .5-np.hypot(fx-(1-t), fy-t)
    distance = np.where(diagonal, np.maximum(distance, segment), distance)
    threshold = (1-width)*.5
    feather = max(1/32, min(.5, .5/device_scale))
    t = np.clip((distance-threshold+feather)/(2*feather), 0, 1)
    return t*t*(3-2*t)


class RiverDistanceTests(unittest.TestCase):
    def test_empty_provenance_and_border_contract(self):
        self.assertFalse(geo.river_distance_field(np.zeros((8, 8), dtype=np.uint8)).any())
        a = np.zeros((8, 8), dtype=np.uint8)
        a[:, 0] = 128
        b = np.where(a, 255, 0)
        field = geo.river_distance_field(a)
        np.testing.assert_array_equal(field, geo.river_distance_field(b))
        self.assertEqual(field[4, 0], 136)  # +.5 inside one-pixel branch
        self.assertEqual(field[4, 1], 120)  # -.5 immediately outside

    def test_width_moves_edges_and_preserves_opaque_thin_center(self):
        for thickness in (1, 2, 4):
            mask = np.zeros((32, 32), dtype=np.uint8)
            mask[:, 12:12+thickness] = 255
            field = geo.river_distance_field(mask)
            x = np.arange(0, 32, 1/128)+1/256
            y = np.full(x.shape, 16.)
            for zoom in (2, 8):
                for dpr in (1, 2):
                    values = [coverage(field, x, y, w, zoom*dpr) for w in (.5, 1, 3)]
                    measured = [float(v.sum()/128) for v in values]
                    np.testing.assert_allclose(measured, [thickness-.5, thickness, thickness+2], atol=.03)
                    self.assertTrue(all(v.max() > .99 for v in values))
                    self.assertTrue(np.all(values[0] <= values[1]))
                    self.assertTrue(np.all(values[1] <= values[2]))

    def test_diagonal_and_junction_are_nested_and_keep_thin_line(self):
        mask = np.eye(32, dtype=np.uint8)*255
        mask[16, 4:28] = 128
        field = geo.river_distance_field(mask)
        y, x = np.mgrid[0:32:1/8, 0:32:1/8]+1/16
        images = [coverage(field, x, y, w, 8) for w in (.5, 1, 3)]
        self.assertTrue(np.all(images[0] <= images[1]))
        self.assertTrue(np.all(images[1] <= images[2]))
        self.assertLess(images[0].sum(), images[1].sum())
        self.assertLess(images[1].sum(), images[2].sum())
        # Real diagonal branches remain visible at their centers at every setting.
        centers = np.arange(4, 28, 1/32)+.5
        self.assertTrue(np.all(coverage(field, centers, centers, .5, 8) > .99))
        cy, cx = np.mgrid[:32, :32]+.5
        np.testing.assert_array_equal(coverage(field, cx, cy, 1, 8) > .5, mask > 0)

    def test_diagonal_reconstruction_does_not_bridge_nonadjacent_lines(self):
        mask = np.zeros((16, 16), dtype=np.uint8)
        mask[:, 6] = 255
        mask[:, 8] = 255
        field = geo.river_distance_field(mask)
        y = np.arange(2, 14, 1/16)
        x = np.full(y.shape, 7.5)
        self.assertFalse(coverage(field, x, y, 1, 8).any())
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
