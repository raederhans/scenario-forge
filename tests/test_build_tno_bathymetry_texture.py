import tempfile
import unittest
from pathlib import Path

import numpy as np
from scipy import ndimage

from tools.build_bathymetry_texture import write_png
from tools.build_tno_bathymetry_texture import (
    COAST_DEPTH_M, CORRECTION_LENGTH_KM, D_EAST, D_WEST, KM_PER_ARCMIN,
    assign_basin_drops, build_depth, encode_overlay, floor_limit,
    masked_gaussian, screened_poisson_correction,
)


class TnoBathymetryTextureTests(unittest.TestCase):
    def test_component_water_levels(self):
        water = np.zeros((6, 9), dtype=bool)
        water[0, :6] = True
        water[1, 6] = True
        water[4, 2:9] = True
        drops, count = assign_basin_drops(water, np.arange(7, 16))
        self.assertEqual(count, 2)
        np.testing.assert_array_equal(drops[0, :6], D_WEST)
        self.assertEqual(drops[1, 6], D_WEST)
        np.testing.assert_array_equal(drops[4, 2:9], D_EAST)
        np.testing.assert_array_equal(drops[~water], 0)
        boundary_drops, _ = assign_basin_drops(np.ones((1, 3), dtype=bool), [10, 11, 12])
        np.testing.assert_array_equal(boundary_drops, D_EAST)

    def test_half_plane_discrete_solution(self):
        water = np.ones((401, 201), dtype=bool)
        water[:, 0] = False
        raw = np.full(water.shape, 4000.0)
        correction = screened_poisson_correction(raw, water, np.zeros(401))
        boundary = COAST_DEPTH_M - 4000
        columns = np.arange(1, 61)
        decay = np.arccosh(1 + KM_PER_ARCMIN ** 2 / (2 * CORRECTION_LENGTH_KM ** 2))
        expected = boundary * np.exp(-columns * decay)
        np.testing.assert_allclose(correction[200, columns], expected, rtol=1e-4)
        self.assertTrue(np.all(np.diff(correction[200, columns]) > 0))
        five_lengths = int(np.ceil(5 * CORRECTION_LENGTH_KM / KM_PER_ARCMIN))
        self.assertLess(abs(correction[200, five_lengths]), 0.01 * abs(boundary))
        band = correction[195:206, 1:61]
        np.testing.assert_allclose(band, np.broadcast_to(band[5], band.shape), rtol=1e-6)

    def test_deep_core(self):
        water = np.zeros((151, 151), dtype=bool)
        water[1:-1, 1:-1] = True
        raw = np.full(water.shape, 4000.0)
        correction = screened_poisson_correction(raw, water, np.zeros(151))
        distance = ndimage.distance_transform_edt(water, sampling=KM_PER_ARCMIN)
        core = distance > 6 * CORRECTION_LENGTH_KM
        self.assertTrue(np.any(core))
        self.assertTrue(np.all(np.abs(correction[core]) < 0.01 * raw[core]))

    def test_corner_has_no_nearshore_local_maxima(self):
        water = np.ones((201, 201), dtype=bool)
        water[:, 0] = False
        water[100, 1] = False
        depth, _ = build_depth(np.full(water.shape, -4100.0), water,
                               np.zeros(201), np.zeros(201))
        footprint = np.array([[False, True, False], [True, False, True], [False, True, False]])
        neighbor_max = ndimage.maximum_filter(np.where(water, depth, -np.inf),
                                              footprint=footprint, mode="constant", cval=-np.inf)
        distance = ndimage.distance_transform_edt(np.pad(water, 1), sampling=KM_PER_ARCMIN)[1:-1, 1:-1]
        nearshore = water & (distance <= 6 * CORRECTION_LENGTH_KM)
        self.assertFalse(np.any(depth[nearshore] > neighbor_max[nearshore]))

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

    def test_smoothed_floor_and_stats(self):
        water = np.zeros((21, 21), dtype=bool)
        water[1:-1, 1:-1] = True
        distance = ndimage.distance_transform_edt(water, sampling=KM_PER_ARCMIN)
        floor = masked_gaussian(floor_limit(distance), water, sigma=4)
        depth, stats = build_depth(np.full(water.shape, 1000.0), water,
                                   np.zeros(21), np.zeros(21))
        np.testing.assert_allclose(depth, masked_gaussian(floor, water))
        self.assertEqual(stats["floor_limited_ratio"], 1)
        self.assertEqual(stats["corrected_ratio"], 1)
        self.assertGreater(stats["mean_abs_correction_m"], 50)

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

    def test_png_determinism(self):
        water = np.array([[True, True], [False, False]])
        land = np.array([[False, False], [True, False]])
        values = encode_overlay(np.array([[10, 4000], [0, 0]]), water, land)
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "first.png", Path(directory) / "second.png"
            write_png(first, values)
            write_png(second, values)
            self.assertEqual(first.read_bytes(), second.read_bytes())


if __name__ == "__main__":
    unittest.main()
