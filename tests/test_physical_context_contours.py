from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
import numpy as np
from shapely.geometry import LineString

from map_builder import config as cfg
from map_builder.processors import physical_context


def _empty_contour_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        columns=["id", "elevation_m", "geometry"],
        geometry="geometry",
        crs="EPSG:4326",
    )


def _stub_semantics_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        [
            {
                "id": "semantic_1",
                "atlas_class": "mountain_high_relief",
                "atlas_layer": "relief_base",
                "source": "test",
                "geometry": LineString([(0.0, 0.0), (1.0, 1.0)]),
            }
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )


class PhysicalContextContourTest(unittest.TestCase):
    def test_contour_config_uses_expected_processing_parameters(self) -> None:
        self.assertEqual(cfg.CONTOUR_PROCESSING_STEP_DEGREES, 0.0625)
        self.assertEqual(cfg.CONTOUR_MAJOR_SIMPLIFY_DEGREES, 0.025)
        self.assertEqual(cfg.CONTOUR_MINOR_SIMPLIFY_DEGREES, 0.015)

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

    def test_build_and_save_physical_context_layers_refuses_empty_contours(self) -> None:
        contour_minor = gpd.GeoDataFrame(
            [
                {
                    "id": "contour_minor_100_0",
                    "elevation_m": 100,
                    "geometry": LineString([(0.0, 0.0), (1.0, 0.0)]),
                }
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )

        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            with (
                patch.object(physical_context, "build_physical_semantics", return_value=_stub_semantics_gdf()),
                patch.object(
                    physical_context,
                    "build_contour_layers",
                    return_value=(_empty_contour_gdf(), contour_minor),
                ),
                patch.object(physical_context, "build_named_layer_topology") as mocked_build_topology,
            ):
                with self.assertRaisesRegex(RuntimeError, "empty contour layer\\(s\\): major"):
                    physical_context.build_and_save_physical_context_layers(
                        gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326"),
                        output_dir,
                    )

            mocked_build_topology.assert_not_called()
            self.assertFalse((output_dir / cfg.PHYSICAL_CONTOUR_MAJOR_TOPO_FILENAME).exists())
            self.assertFalse((output_dir / cfg.PHYSICAL_CONTOUR_MINOR_TOPO_FILENAME).exists())


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

    def test_minor_contour_topology_is_non_empty_and_excludes_major_intervals(self) -> None:
        levels = self._read_levels(cfg.PHYSICAL_CONTOUR_MINOR_TOPO_FILENAME)
        self.assertTrue(levels)
        self.assertTrue(all(level >= cfg.CONTOUR_MINOR_INTERVAL_M for level in levels))
        self.assertTrue(all(level % cfg.CONTOUR_MINOR_INTERVAL_M == 0 for level in levels))
        self.assertTrue(all(level % cfg.CONTOUR_MAJOR_INTERVAL_M != 0 for level in levels))

    def test_build_and_save_physical_context_layers_propagates_contour_generation_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            with (
                patch.object(physical_context, "build_physical_semantics", return_value=_stub_semantics_gdf()),
                patch.object(
                    physical_context,
                    "build_contour_layers",
                    side_effect=RuntimeError("dem source missing"),
                ),
                patch.object(physical_context, "build_named_layer_topology") as mocked_build_topology,
            ):
                with self.assertRaisesRegex(RuntimeError, "dem source missing"):
                    physical_context.build_and_save_physical_context_layers(
                        gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326"),
                        output_dir,
                    )

            mocked_build_topology.assert_not_called()
            self.assertFalse((output_dir / cfg.PHYSICAL_CONTOUR_MAJOR_TOPO_FILENAME).exists())
            self.assertFalse((output_dir / cfg.PHYSICAL_CONTOUR_MINOR_TOPO_FILENAME).exists())


if __name__ == "__main__":
    unittest.main()
