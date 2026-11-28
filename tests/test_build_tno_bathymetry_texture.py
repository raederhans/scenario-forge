import unittest
import numpy as np
from tools.build_tno_bathymetry_texture import (
    COAST_DEPTH_M,
    CORRECTION_LENGTH_KM,
    KM_PER_ARCMIN,
    encode_overlay,
    floor_limit,
    masked_gaussian,
    screened_poisson_correction,
)


class TnoBathymetryTextureTests(unittest.TestCase):
    def test_row_weights_and_signed_depth(self):
        water = np.zeros((3, 3), dtype=bool)
        water[:, 1] = True
        raw = np.full(water.shape, -100.0)
        latitudes = np.array([0, 30, 60])
        correction = screened_poisson_correction(raw, water, latitudes)
        horizontal = 1 / (KM_PER_ARCMIN * np.cos(np.deg2rad(latitudes))) ** 2
        vertical = 1 / KM_PER_ARCMIN ** 2
        diagonal = 2 * horizontal + 2 * vertical + 1 / CORRECTION_LENGTH_KM ** 2
        values = correction[:, 1]
        lhs = diagonal * values
        lhs[:-1] -= vertical * values[1:]
        lhs[1:] -= vertical * values[:-1]
        boundary = COAST_DEPTH_M + 100
        expected = 2 * horizontal * boundary
        expected[[0, -1]] += vertical * boundary
        np.testing.assert_allclose(lhs, expected, rtol=1e-6)

    def test_floor_increases_offshore(self):
        distance = np.array([1.853, 5, 12, 25, 50, 70])
        depth = floor_limit(distance)
        self.assertTrue(np.all(np.diff(depth) >= 0))
        self.assertEqual(depth[-1], 60)

    def test_masked_gaussian_excludes_land(self):
        water = np.zeros((9, 9), dtype=bool)
        water[2:7, 2:7] = True
        depth = np.zeros(water.shape)
        depth[water] = 100
        depth[4, 4] = 200
        smoothed = masked_gaussian(depth, water)
        self.assertTrue(np.all(smoothed[water] >= 100 - 1e-12))
        self.assertTrue(np.all(smoothed[water] <= 200))
        np.testing.assert_array_equal(smoothed[~water], 0)

    def test_overlay_encoding(self):
        water = np.array([[True, True, False, False]])
        land = np.array([[False, False, True, False]])
        encoded = encode_overlay(np.array([[0, 4000, 0, 0]]), water, land)
        self.assertTrue(np.all(encoded[water] >= 1))
        self.assertEqual(encoded[0, 2], 1)
        self.assertEqual(encoded[0, 3], 0)


if __name__ == "__main__":
    unittest.main()
