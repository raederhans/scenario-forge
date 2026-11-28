import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from tools.build_bathymetry_texture import decode_depth, encode_depth, marine_mask, write_png


class BathymetryTextureTests(unittest.TestCase):
    def test_encoding(self):
        np.testing.assert_array_equal(
            encode_depth(np.array([0, 11000, 12000, 3000, np.nan]),
                         np.array([True, True, True, False, True])),
            [1, 255, 255, 0, 0],
        )
        depths = np.linspace(0, 11000, 110001)
        codes = encode_depth(depths, np.ones(depths.shape, dtype=bool))
        self.assertTrue(np.all(np.diff(codes.astype(int)) >= 0))
        decoded = decode_depth(codes)
        step = 11000 * (2 * (codes.astype(float) - 1) + 1) / 254 ** 2
        self.assertTrue(np.all(np.abs(decoded - depths) <= step))
        self.assertEqual(decode_depth(0), 0)

    def test_antimeridian_merge_before_largest(self):
        elevation = np.ones((7, 12))
        elevation[1:5, 0] = -1
        elevation[1:5, -1] = -1
        elevation[1:4, 5:7] = -1
        expected = np.zeros_like(elevation, dtype=bool)
        expected[1:5, 0] = True
        expected[1:5, -1] = True
        np.testing.assert_array_equal(marine_mask(elevation), expected)

    def test_png_determinism(self):
        values = np.arange(256, dtype=np.uint8).reshape(16, 16)
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "a.png", Path(directory) / "b.png"
            write_png(first, values)
            write_png(second, values)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with Image.open(first) as image:
                self.assertEqual(image.mode, "L")
                np.testing.assert_array_equal(np.array(image), values)


if __name__ == "__main__":
    unittest.main()
