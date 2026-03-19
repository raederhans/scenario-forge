from __future__ import annotations

import unittest

import geopandas as gpd
from shapely.geometry import Polygon

from tools.patch_tno_1962_bundle import (
    build_runtime_topology_payload,
    normalize_feature_core_map,
)


def _square(x: float, y: float, size: float = 1.0) -> Polygon:
    return Polygon([
        (x, y),
        (x + size, y),
        (x + size, y + size),
        (x, y + size),
    ])


class TnoBundleBuilderTest(unittest.TestCase):
    def test_normalize_feature_core_map_handles_legacy_formats(self) -> None:
        payload = normalize_feature_core_map(
            {
                "AFG-1": "['AFG']",
                "ITA-1": "ITA",
                "AZE-1": "['SOV', 'RKK']",
                "AFA-1": ["AFA"],
                "EMPTY": "",
            }
        )

        self.assertEqual(
            payload,
            {
                "AFG-1": ["AFG"],
                "ITA-1": ["ITA"],
                "AZE-1": ["SOV", "RKK"],
                "AFA-1": ["AFA"],
            },
        )

    def test_build_runtime_topology_payload_prunes_empty_properties_and_skips_land_copy(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {
                    "id": "AAA-1",
                    "name": "Alpha",
                    "cntr_code": "AAA",
                    "admin1_group": "",
                    "detail_tier": "",
                    "__source": "detail",
                    "scenario_id": None,
                    "region_group": None,
                    "atl_surface_kind": None,
                    "interactive": None,
                    "render_as_base_geography": None,
                    "geometry": _square(0, 0),
                },
                {
                    "id": "ATL-1",
                    "name": "Atlantropa",
                    "cntr_code": "ATL",
                    "admin1_group": "atl_group",
                    "detail_tier": "scenario_atlantropa",
                    "__source": "hgo_donor",
                    "scenario_id": "tno_1962",
                    "region_group": "atl_region",
                    "atl_surface_kind": "salt_flat_land",
                    "interactive": False,
                    "render_as_base_geography": False,
                    "geometry": _square(2, 0),
                },
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        water_gdf = gpd.GeoDataFrame(
            [{"id": "water-1", "name": "Lake", "geometry": _square(0, 2)}],
            geometry="geometry",
            crs="EPSG:4326",
        )
        land_mask_gdf = gpd.GeoDataFrame(
            [{"id": "mask-1", "name": "Mask", "geometry": _square(0, 0, 4)}],
            geometry="geometry",
            crs="EPSG:4326",
        )
        context_land_mask_gdf = gpd.GeoDataFrame(
            [{"id": "context-mask-1", "name": "Context Mask", "geometry": _square(0, 0, 4)}],
            geometry="geometry",
            crs="EPSG:4326",
        )

        topo = build_runtime_topology_payload(
            political_gdf,
            water_gdf,
            land_mask_gdf,
            context_land_mask_gdf,
        )

        self.assertIn("land_mask", topo["objects"])
        self.assertNotIn("land", topo["objects"])

        props_by_id = {
            geometry["properties"]["id"]: geometry["properties"]
            for geometry in topo["objects"]["political"]["geometries"]
        }
        self.assertEqual(
            props_by_id["AAA-1"],
            {
                "id": "AAA-1",
                "name": "Alpha",
                "cntr_code": "AAA",
                "__source": "detail",
            },
        )
        self.assertEqual(
            props_by_id["ATL-1"],
            {
                "id": "ATL-1",
                "name": "Atlantropa",
                "cntr_code": "ATL",
                "admin1_group": "atl_group",
                "detail_tier": "scenario_atlantropa",
                "__source": "hgo_donor",
                "scenario_id": "tno_1962",
                "region_group": "atl_region",
                "atl_surface_kind": "salt_flat_land",
                "interactive": False,
                "render_as_base_geography": False,
            },
        )


if __name__ == "__main__":
    unittest.main()
