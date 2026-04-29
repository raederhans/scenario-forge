from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Polygon
from topojson import Topology

from tools import scenario_chunk_assets


def _square(x: float, y: float, size: float = 1.0) -> Polygon:
    return Polygon([
        (x, y),
        (x + size, y),
        (x + size, y + size),
        (x, y + size),
    ])


class ScenarioChunkAssetsTest(unittest.TestCase):
    def test_write_json_wraps_permission_error_with_actionable_message(self) -> None:
        target = Path("C:/tmp/political.detail.country.rur.json")
        with patch.object(
            scenario_chunk_assets,
            "write_json_atomic",
            side_effect=PermissionError("WinError 5"),
        ):
            with self.assertRaisesRegex(PermissionError, "Scenario chunk write is blocked"):
                scenario_chunk_assets._write_json(target, {"type": "FeatureCollection", "features": []})

    def test_build_and_write_scenario_chunk_assets_preserves_helper_fields_and_writes_opening_owner_mesh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({
                    "owners": {
                        "AAA-1": "AAA",
                        "BBB-1": "BBB",
                        "ATLSHL_TEST": "ATL",
                    }
                }),
                encoding="utf-8",
            )

            political_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "AAA-1",
                        "name": "Alpha",
                        "cntr_code": "AAA",
                        "admin1_group": "",
                        "detail_tier": "adm2",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "geometry": _square(0, 0),
                    },
                    {
                        "id": "BBB-1",
                        "name": "Beta",
                        "cntr_code": "BBB",
                        "admin1_group": "",
                        "detail_tier": "adm2",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "geometry": _square(1, 0),
                    },
                    {
                        "id": "ATLSHL_TEST",
                        "name": "Atlantropa Shore Seal",
                        "cntr_code": "ATL",
                        "admin1_group": "atl_group",
                        "detail_tier": "scenario_atlantropa",
                        "__source": "detail",
                        "interactive": False,
                        "render_as_base_geography": False,
                        "atl_geometry_role": "shore_seal",
                        "atl_join_mode": "gap_fill",
                        "geometry": _square(3, 0),
                    },
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            land_mask_gdf = gpd.GeoDataFrame(
                [{"id": "mask-1", "name": "Mask", "geometry": _square(0, 0, 5)}],
                geometry="geometry",
                crs="EPSG:4326",
            )
            context_land_mask_gdf = gpd.GeoDataFrame(
                [{"id": "context-mask-1", "name": "Context Mask", "geometry": _square(0, 0, 5)}],
                geometry="geometry",
                crs="EPSG:4326",
            )
            runtime_topology_payload = Topology(
                [political_gdf, land_mask_gdf, context_land_mask_gdf],
                object_name=["political", "land_mask", "context_land_mask"],
                topology=True,
                prequantize=False,
                topoquantize=False,
                presimplify=False,
                toposimplify=False,
                shared_coords=False,
            ).to_dict()

            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "tno_1962", "generated_at": "2026-04-02T00:00:00Z"},
                layer_payloads={},
                startup_topology_payload=runtime_topology_payload,
                runtime_topology_payload=runtime_topology_payload,
                startup_topology_url="data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json",
                runtime_topology_url="data/scenarios/tno_1962/runtime_topology.topo.json",
                generated_at="2026-04-02T00:00:00Z",
            )

            atl_chunk_path = scenario_dir / "chunks" / "political.detail.country.atl.json"
            atl_chunk_payload = json.loads(atl_chunk_path.read_text(encoding="utf-8"))
            self.assertEqual(len(atl_chunk_payload["features"]), 1)
            atl_props = atl_chunk_payload["features"][0]["properties"]
            self.assertEqual(atl_props["id"], "ATLSHL_TEST")
            self.assertFalse(atl_props["interactive"])
            self.assertEqual(atl_props["atl_geometry_role"], "shore_seal")
            self.assertEqual(atl_props["atl_join_mode"], "gap_fill")

            owner_mesh = result["mesh_pack"]["meshes"]["opening_owner_borders"]
            self.assertEqual(owner_mesh["type"], "MultiLineString")
            self.assertGreater(len(owner_mesh["coordinates"]), 0)
            self.assertEqual(
                json.loads((scenario_dir / "mesh_pack.json").read_text(encoding="utf-8"))["meshes"]["opening_owner_borders"],
                owner_mesh,
            )

    def test_political_detail_chunks_keep_atl_synthetic_features_in_atl_bucket(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({
                    "owners": {
                        "ATLISL_adriatica_corfu": "ITA",
                        "ATLSHL_adriatica_4": "GRE",
                    }
                }),
                encoding="utf-8",
            )

            political_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "ATLISL_adriatica_corfu",
                        "name": "Corfu",
                        "cntr_code": "ATL",
                        "admin1_group": "atl_group",
                        "detail_tier": "scenario_atlantropa",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "atl_geometry_role": "donor_island",
                        "atl_join_mode": "boolean_weld",
                        "geometry": _square(0, 0),
                    },
                    {
                        "id": "ATLSHL_adriatica_4",
                        "name": "Shelf",
                        "cntr_code": "ATL",
                        "admin1_group": "atl_group",
                        "detail_tier": "scenario_atlantropa",
                        "__source": "detail",
                        "interactive": False,
                        "render_as_base_geography": False,
                        "atl_geometry_role": "shore_seal",
                        "atl_join_mode": "gap_fill",
                        "geometry": _square(2, 0),
                    },
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            runtime_topology_payload = Topology(
                [political_gdf],
                object_name=["political"],
                topology=True,
                prequantize=False,
                topoquantize=False,
                presimplify=False,
                toposimplify=False,
                shared_coords=False,
            ).to_dict()

            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "tno_1962", "generated_at": "2026-04-23T00:00:00Z"},
                layer_payloads={},
                startup_topology_payload=runtime_topology_payload,
                runtime_topology_payload=runtime_topology_payload,
                startup_topology_url="data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json",
                runtime_topology_url="data/scenarios/tno_1962/runtime_topology.topo.json",
                generated_at="2026-04-23T00:00:00Z",
            )

            atl_chunk = json.loads((scenario_dir / "chunks" / "political.detail.country.atl.json").read_text(encoding="utf-8"))
            self.assertEqual(
                sorted(feature["properties"]["id"] for feature in atl_chunk["features"]),
                ["ATLISL_adriatica_corfu", "ATLSHL_adriatica_4"],
            )
            manifest_chunk = next(chunk for chunk in result["detail_chunk_manifest"]["chunks"] if chunk["id"] == "political.detail.country.atl")
            self.assertEqual(manifest_chunk["country_codes"], ["ATL"])

    def test_political_coarse_falls_back_to_runtime_topology_when_startup_shell_has_no_political(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)

            runtime_political_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "AAA-1",
                        "name": "Alpha",
                        "cntr_code": "AAA",
                        "admin1_group": "Alpha Group",
                        "detail_tier": "scenario_atlantropa",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "scenario_helper_kind": "shell_fallback",
                        "atl_geometry_role": "shore_seal",
                        "atl_join_mode": "gap_fill",
                        "geometry": _square(0, 0),
                    }
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            runtime_topology_payload = Topology(
                [runtime_political_gdf],
                object_name=["political"],
                topology=True,
                prequantize=False,
                topoquantize=False,
                presimplify=False,
                toposimplify=False,
                shared_coords=False,
            ).to_dict()
            startup_shell_payload = {
                "type": "Topology",
                "objects": {
                    "land_mask": {"type": "GeometryCollection", "geometries": []},
                    "context_land_mask": {"type": "GeometryCollection", "geometries": []},
                    "scenario_water": {"type": "GeometryCollection", "geometries": []},
                },
                "arcs": [],
            }

            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "tno_1962", "generated_at": "2026-04-13T00:00:00Z"},
                layer_payloads={},
                startup_topology_payload=startup_shell_payload,
                runtime_topology_payload=runtime_topology_payload,
                startup_topology_url="data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json",
                runtime_topology_url="data/scenarios/tno_1962/runtime_topology.topo.json",
                generated_at="2026-04-13T00:00:00Z",
            )

            coarse_chunk = next(chunk for chunk in result["detail_chunk_manifest"]["chunks"] if chunk["id"] == "political.coarse.r0c0")
            self.assertEqual(coarse_chunk["feature_count"], 1)
            self.assertGreater(coarse_chunk["byte_size"], 0)
            self.assertGreater(coarse_chunk["coord_count"], 0)
            self.assertGreater(coarse_chunk["part_count"], 0)
            self.assertGreater(coarse_chunk["estimated_path_cost"], 0)
            coarse_payload = json.loads((scenario_dir / "chunks" / "political.coarse.r0c0.json").read_text(encoding="utf-8"))
            self.assertEqual(len(coarse_payload["features"]), 1)
            self.assertNotIn("id", coarse_payload["features"][0])
            self.assertEqual(
                sorted(coarse_payload["features"][0]["properties"].keys()),
                [
                    "__source",
                    "admin1_group",
                    "atl_geometry_role",
                    "atl_join_mode",
                    "cntr_code",
                    "detail_tier",
                    "id",
                    "interactive",
                    "name",
                    "render_as_base_geography",
                    "scenario_helper_kind",
                ],
            )

    def test_water_coarse_is_minified_without_trimming_runtime_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)

            water_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "tno_parent_sea",
                        "label": "Parent Sea",
                        "name": "Parent Sea",
                        "interactive": True,
                        "water_type": "sea",
                        "region_group": "marine_macro",
                        "parent_id": "",
                        "neighbors": "tno_child_gulf",
                        "is_chokepoint": False,
                        "scenario_id": "tno_1962",
                        "source_standard": "marine_regions_seavox_v19",
                        "source_province_ids": "100,101",
                        "topology_mode": "true_water",
                        "render_as_base_geography": False,
                        "geometry": _square(0, 0, 3),
                    },
                    {
                        "id": "tno_child_gulf",
                        "label": "Child Gulf",
                        "name": "Child Gulf",
                        "interactive": True,
                        "water_type": "gulf",
                        "region_group": "marine_detail",
                        "parent_id": "tno_parent_sea",
                        "neighbors": "tno_parent_sea",
                        "is_chokepoint": True,
                        "scenario_id": "tno_1962",
                        "source_standard": "marine_regions_seavox_v19",
                        "source_province_ids": "102",
                        "topology_mode": "true_water",
                        "render_as_base_geography": False,
                        "geometry": _square(0.5, 0.5, 1),
                    },
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )

            runtime_topology_payload = Topology(
                [water_gdf],
                object_name=["scenario_water"],
                topology=True,
                prequantize=False,
                topoquantize=False,
                presimplify=False,
                toposimplify=False,
                shared_coords=False,
            ).to_dict()

            water_payload = {
                "type": "FeatureCollection",
                "features": json.loads(water_gdf.to_json())["features"],
            }

            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "tno_1962", "generated_at": "2026-04-13T00:00:00Z"},
                layer_payloads={"water": water_payload},
                startup_topology_payload=None,
                runtime_topology_payload=runtime_topology_payload,
                startup_topology_url="data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json",
                runtime_topology_url="data/scenarios/tno_1962/runtime_topology.topo.json",
                generated_at="2026-04-13T00:00:00Z",
            )

            coarse_chunk = next(chunk for chunk in result["detail_chunk_manifest"]["chunks"] if chunk["id"] == "water.coarse.r0c0")
            self.assertEqual(coarse_chunk["feature_count"], 2)
            self.assertGreater(coarse_chunk["byte_size"], 0)
            self.assertGreater(coarse_chunk["coord_count"], 0)
            self.assertGreater(coarse_chunk["part_count"], 0)
            self.assertGreater(coarse_chunk["estimated_path_cost"], 0)

            coarse_path = scenario_dir / "chunks" / "water.coarse.r0c0.json"
            coarse_text = coarse_path.read_text(encoding="utf-8")
            coarse_payload = json.loads(coarse_text)
            self.assertEqual(len(coarse_payload["features"]), 2)
            self.assertEqual(
                sorted(coarse_payload["features"][0]["properties"].keys()),
                [
                    "id",
                    "interactive",
                    "is_chokepoint",
                    "label",
                    "name",
                    "neighbors",
                    "parent_id",
                    "region_group",
                    "render_as_base_geography",
                    "scenario_id",
                    "source_province_ids",
                    "source_standard",
                    "topology_mode",
                    "water_type",
                ],
            )
            expected_text = json.dumps(coarse_payload, ensure_ascii=False, separators=(",", ":")) + "\n"
            self.assertEqual(coarse_text, expected_text)


if __name__ == "__main__":
    unittest.main()
