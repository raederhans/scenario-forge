import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from tools.build_bathymetry_texture import (
    block_mean_depth, decode_depth, encode_depth, marine_mask, split_tiles, write_png,
)


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

    def test_marine_components(self):
        elevation = np.ones((9, 12))
        elevation[1:4, 1:4] = -100
        elevation[6:8, 2:4] = -200
        elevation[6:8, 8:10] = -300
        expected = np.zeros_like(elevation, dtype=bool)
        expected[1:4, 1:4] = True
        np.testing.assert_array_equal(marine_mask(elevation), expected)
        expected[6:8, 8:10] = True
        np.testing.assert_array_equal(marine_mask(elevation, [(6, 8)]), expected)
        np.testing.assert_array_equal(marine_mask(np.ones((2, 3))), False)

    def test_antimeridian_merge_before_largest(self):
        elevation = np.ones((7, 12))
        elevation[1:5, 0] = -1
        elevation[1:5, -1] = -1
        elevation[1:4, 5:7] = -1
        expected = np.zeros_like(elevation, dtype=bool)
        expected[1:5, 0] = True
        expected[1:5, -1] = True
        np.testing.assert_array_equal(marine_mask(elevation), expected)

    def test_block_mean(self):
        depth = np.array([[10, 30, 99, 99], [99, 80, 99, 99]])
        ocean = np.array([[True, True, False, False], [False, True, False, False]])
        means, mask = block_mean_depth(depth, ocean, 2)
        np.testing.assert_array_equal(means, [[40, 0]])
        np.testing.assert_array_equal(mask, [[True, False]])

    def test_tiles(self):
        encoded = np.arange(96, dtype=np.uint8).reshape(4, 24)
        encoded[:2, 2:4] = 0
        tiles = split_tiles(encoded, 2)
        expected_keys = [f"{col}_{row}" for col in range(12) for row in range(2)
                         if (col, row) != (1, 0)]
        self.assertEqual(list(tiles), expected_keys)
        restored = np.zeros_like(encoded)
        for name, tile in tiles.items():
            col, row = map(int, name.split("_"))
            restored[row * 2:(row + 1) * 2, col * 2:(col + 1) * 2] = tile
        np.testing.assert_array_equal(restored, encoded)

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
