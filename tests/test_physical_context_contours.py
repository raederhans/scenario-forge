from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from map_builder import config as cfg
from map_builder.processors import physical_context


class PhysicalContextContourTest(unittest.TestCase):
    def test_build_contour_layers_splits_major_and_minor_levels(self) -> None:
        dem = np.array(
            [
                [100.0, 200.0, 300.0, 400.0, 500.0],
                [200.0, 300.0, 400.0, 500.0, 600.0],
                [300.0, 400.0, 500.0, 600.0, 700.0],
                [400.0, 500.0, 600.0, 700.0, 800.0],
                [500.0, 600.0, 700.0, 800.0, 900.0],
            ],
            dtype=np.float32,
        )
        x = np.arange(5, dtype=np.float32)
        y = np.arange(5, dtype=np.float32)

        with patch.object(physical_context, "_load_contour_dem_array", return_value=(dem, x, y)):
            major, minor = physical_context.build_contour_layers()

        self.assertFalse(major.empty)
        self.assertFalse(minor.empty)

        major_levels = set(major["elevation_m"].astype(int).tolist())
        minor_levels = set(minor["elevation_m"].astype(int).tolist())

        self.assertEqual(major_levels, {500})
        self.assertEqual(minor_levels, {200, 300, 400, 600, 700, 800})
        self.assertTrue(all(level % cfg.CONTOUR_MAJOR_INTERVAL_M == 0 for level in major_levels))
        self.assertTrue(all(level % cfg.CONTOUR_MAJOR_INTERVAL_M != 0 for level in minor_levels))

    def test_build_contour_layers_raises_when_dem_has_no_finite_positive_elevations(self) -> None:
        dem = np.full((4, 4), np.nan, dtype=np.float32)
        x = np.arange(4, dtype=np.float32)
        y = np.arange(4, dtype=np.float32)

        with patch.object(physical_context, "_load_contour_dem_array", return_value=(dem, x, y)):
            with self.assertRaisesRegex(RuntimeError, "no finite positive land elevations"):
                physical_context.build_contour_layers()


class PhysicalContourTopologyContractTest(unittest.TestCase):
    @staticmethod
    def _read_levels(filename: str) -> list[int]:
        repo_root = Path(__file__).resolve().parents[1]
        payload = json.loads((repo_root / "data" / filename).read_text(encoding="utf-8"))
        geometries = payload.get("objects", {}).get("contours", {}).get("geometries", [])
        return [int(geometry["properties"]["elevation_m"]) for geometry in geometries]

    def test_major_contour_topology_is_non_empty_and_uses_major_intervals(self) -> None:
        levels = self._read_levels(cfg.PHYSICAL_CONTOUR_MAJOR_TOPO_FILENAME)
        self.assertTrue(levels)
        self.assertTrue(all(level >= cfg.CONTOUR_MAJOR_INTERVAL_M for level in levels))
        self.assertTrue(all(level % cfg.CONTOUR_MAJOR_INTERVAL_M == 0 for level in levels))


if __name__ == "__main__":
    unittest.main()
