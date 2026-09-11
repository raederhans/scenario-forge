from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Polygon
from topojson import Topology

from tools import build_scenario_chunk_assets, scenario_chunk_assets

REPO_ROOT = Path(__file__).resolve().parents[1]


def _square(x: float, y: float, size: float = 1.0) -> Polygon:
    return Polygon([
        (x, y),
        (x + size, y),
        (x + size, y + size),
        (x, y + size),
    ])


def _bumped_square(x: float, y: float, size: float = 1.0, bump: float = 0.005) -> Polygon:
    return Polygon([
        (x, y),
        (x + (size * 0.25), y),
        (x + (size * 0.5), y - bump),
        (x + (size * 0.75), y),
        (x + size, y),
        (x + size, y + size),
        (x, y + size),
        (x, y),
    ])


def _chunk_feature_ids(payload: dict) -> list[str]:
    return [str(feature.get("properties", {}).get("id") or "") for feature in payload.get("features", [])]


class ScenarioChunkAssetsTest(unittest.TestCase):
    def test_checked_in_tno_chunk_manifest_byte_sizes_and_hashes_match_files(self) -> None:
        scenario_id = "tno_1962"
        manifest_path = REPO_ROOT / "data" / "scenarios" / scenario_id / "detail_chunks.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for chunk in manifest.get("chunks", []):
            with self.subTest(scenario_id=scenario_id, chunk_id=chunk.get("id")):
                chunk_path = REPO_ROOT.joinpath(*str(chunk["url"]).split("/"))
                self.assertTrue(chunk_path.exists(), str(chunk_path))
                self.assertEqual(chunk.get("byte_size"), chunk_path.stat().st_size)
                self.assertEqual(chunk.get("sha256"), build_scenario_chunk_assets.sha256_path(chunk_path))

    def test_checked_in_chunk_manifest_byte_sizes_match_files(self) -> None:
        for scenario_id in ("hoi4_1939", "tno_1962"):
            manifest_path = REPO_ROOT / "data" / "scenarios" / scenario_id / "detail_chunks.manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for chunk in manifest.get("chunks", []):
                with self.subTest(scenario_id=scenario_id, chunk_id=chunk.get("id")):
                    chunk_path = REPO_ROOT.joinpath(*str(chunk["url"]).split("/"))
                    self.assertTrue(chunk_path.exists(), str(chunk_path))
                    self.assertEqual(chunk.get("byte_size"), chunk_path.stat().st_size)

    def test_checked_in_political_coarse_lod_manifest_matches_payload(self) -> None:
        for scenario_id in ("hoi4_1939", "tno_1962"):
            manifest_path = REPO_ROOT / "data" / "scenarios" / scenario_id / "detail_chunks.manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            scenario_manifest_path = REPO_ROOT / "data" / "scenarios" / scenario_id / "manifest.json"
            scenario_manifest = json.loads(scenario_manifest_path.read_text(encoding="utf-8"))
            coarse_chunk = next(
                chunk for chunk in manifest.get("chunks", [])
                if chunk.get("id") == "political.coarse.r0c0"
            )
            chunk_path = REPO_ROOT.joinpath(*str(coarse_chunk["url"]).split("/"))
            payload = json.loads(chunk_path.read_text(encoding="utf-8"))
            features = payload.get("features")
            self.assertIsInstance(features, list)
            assert isinstance(features, list)

            with self.subTest(scenario_id=scenario_id):
                diagnostics = coarse_chunk.get("lod_diagnostics")
                self.assertIsInstance(diagnostics, dict)
                assert isinstance(diagnostics, dict)

                payload_cost = scenario_chunk_assets._summarize_payload_geometry_cost(payload)
                payload_byte_size = scenario_chunk_assets._minified_json_byte_size(payload)
                payload_bounds = scenario_chunk_assets._build_feature_bounds_summary(
                    features,
                    include_zero_area=True,
                )

                self.assertEqual(coarse_chunk.get("feature_count"), len(features))
                self.assertEqual(coarse_chunk.get("feature_bounds"), payload_bounds)
                self.assertEqual(coarse_chunk.get("byte_size"), chunk_path.stat().st_size)
                self.assertEqual(coarse_chunk.get("sha256"), build_scenario_chunk_assets.sha256_path(chunk_path))
                self.assertEqual(coarse_chunk.get("byte_size"), payload_byte_size)
                self.assertEqual(coarse_chunk.get("coord_count"), payload_cost["coord_count"])
                self.assertEqual(coarse_chunk.get("part_count"), payload_cost["part_count"])
                self.assertEqual(coarse_chunk.get("estimated_path_cost"), payload_cost["estimated_path_cost"])
                budget_hints = scenario_manifest.get("render_budget_hints")
                self.assertIsInstance(budget_hints, dict)
                assert isinstance(budget_hints, dict)
                political_path_cost_budget = budget_hints.get("max_required_political_estimated_path_cost")
                if political_path_cost_budget is not None:
                    self.assertGreaterEqual(political_path_cost_budget, coarse_chunk.get("estimated_path_cost"))
                self.assertEqual(diagnostics.get("optimized_feature_count"), len(features))
                self.assertEqual(diagnostics.get("optimized_coord_count"), payload_cost["coord_count"])
                self.assertEqual(diagnostics.get("optimized_part_count"), payload_cost["part_count"])
                self.assertEqual(diagnostics.get("optimized_byte_size"), payload_byte_size)
                self.assertEqual(diagnostics.get("optimized_estimated_path_cost"), payload_cost["estimated_path_cost"])
                self.assertGreater(diagnostics.get("source_coord_count"), diagnostics.get("optimized_coord_count"))
                self.assertGreater(diagnostics.get("source_byte_size"), diagnostics.get("optimized_byte_size"))
                self.assertGreater(
                    diagnostics.get("source_estimated_path_cost"),
                    diagnostics.get("optimized_estimated_path_cost"),
                )
                self.assertGreater(diagnostics.get("coord_reduction"), 0)
                self.assertGreater(diagnostics.get("byte_size_reduction"), 0)
                self.assertGreater(diagnostics.get("estimated_path_cost_reduction"), 0)

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
                        "RU_ARCTIC_FB_001": "RU",
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
                        "id": "RU_ARCTIC_FB_001",
                        "name": "Russia Shell Fallback 1",
                        "cntr_code": "RU",
                        "admin1_group": "",
                        "detail_tier": "scenario_runtime_shell",
                        "__source": "detail",
                        "interactive": False,
                        "render_as_base_geography": False,
                        "scenario_helper_kind": "shell_fallback",
                        "scenario_shell_owner_hint": "RU",
                        "scenario_shell_controller_hint": "RU",
                        "geometry": _square(4, 0),
                    },
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            atlantropa_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "ATLSHL_TEST",
                        "name": "Atlantropa Shore Seal",
                        "cntr_code": "ATL",
                        "admin1_group": "atl_group",
                        "detail_tier": "scenario_atlantropa",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "atl_render_layer": "shoal",
                        "atl_interactive": True,
                        "atl_color_rule": "shoal_pattern",
                        "atl_geometry_role": "shore_seal",
                        "atl_join_mode": "gap_fill",
                        "geometry": _square(3, 1),
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
                [political_gdf, atlantropa_gdf, land_mask_gdf, context_land_mask_gdf],
                object_name=["political", "scenario_atlantropa", "land_mask", "context_land_mask"],
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

            self.assertFalse((scenario_dir / "chunks" / "political.detail.country.atl.json").exists())
            atl_chunk_path = scenario_dir / "chunks" / "scenario_atlantropa.detail.r1c2.json"
            atl_chunk_payload = json.loads(atl_chunk_path.read_text(encoding="utf-8"))
            self.assertEqual(len(atl_chunk_payload["features"]), 1)
            atl_props = atl_chunk_payload["features"][0]["properties"]
            self.assertEqual(atl_props["id"], "ATLSHL_TEST")
            self.assertIs(atl_props["interactive"], True)
            self.assertIs(atl_props["atl_interactive"], True)
            self.assertEqual(atl_props["atl_render_layer"], "shoal")
            self.assertEqual(atl_props["atl_color_rule"], "shoal_pattern")
            self.assertEqual(atl_props["atl_geometry_role"], "shore_seal")
            self.assertEqual(atl_props["atl_join_mode"], "gap_fill")
            ru_chunk_path = scenario_dir / "chunks" / "political.detail.country.ru.json"
            ru_chunk_payload = json.loads(ru_chunk_path.read_text(encoding="utf-8"))
            self.assertEqual(len(ru_chunk_payload["features"]), 1)
            ru_props = ru_chunk_payload["features"][0]["properties"]
            self.assertEqual(ru_props["id"], "RU_ARCTIC_FB_001")
            self.assertEqual(ru_props["scenario_shell_owner_hint"], "RU")
            self.assertEqual(ru_props["scenario_shell_controller_hint"], "RU")
            self.assertFalse(scenario_chunk_assets._is_explicit_political_feature(ru_chunk_payload["features"][0]))

            owner_mesh = result["mesh_pack"]["meshes"]["opening_owner_borders"]
            self.assertEqual(owner_mesh["type"], "MultiLineString")
            self.assertGreater(len(owner_mesh["coordinates"]), 0)
            self.assertEqual(
                json.loads((scenario_dir / "mesh_pack.json").read_text(encoding="utf-8"))["meshes"]["opening_owner_borders"],
                owner_mesh,
            )

    def test_scenario_atlantropa_detail_chunks_keep_synthetic_feature_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({
                    "owners": {
                        "AAA-1": "AAA",
                        "ATLISL_adriatica_corfu": "ITA",
                        "ATLSHL_adriatica_4": "GRE",
                    }
                }),
                encoding="utf-8",
            )

            political_gdf = gpd.GeoDataFrame(
                [{"id": "AAA-1", "name": "Alpha", "cntr_code": "AAA", "geometry": _square(-10, 1)}],
                geometry="geometry",
                crs="EPSG:4326",
            )
            atlantropa_gdf = gpd.GeoDataFrame(
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
                        "atl_render_layer": "land",
                        "atl_interactive": True,
                        "atl_color_rule": "owner",
                        "atl_geometry_role": "donor_island",
                        "atl_join_mode": "boolean_weld",
                        "geometry": _square(1, 1),
                    },
                    {
                        "id": "ATLSHL_adriatica_4",
                        "name": "Shelf",
                        "cntr_code": "ATL",
                        "admin1_group": "atl_group",
                        "detail_tier": "scenario_atlantropa",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "atl_render_layer": "shoal",
                        "atl_interactive": True,
                        "atl_color_rule": "shoal_pattern",
                        "atl_geometry_role": "shore_seal",
                        "atl_join_mode": "gap_fill",
                        "geometry": _square(3, 1),
                    },
                    {
                        "id": "ATLSEA_FILL_adriatica_1",
                        "name": "Adriatic Sea Completion",
                        "cntr_code": "ATL",
                        "admin1_group": "atl_group",
                        "detail_tier": "scenario_atlantropa",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "atl_render_layer": "water",
                        "atl_interactive": True,
                        "atl_color_rule": "atlantropa_sea",
                        "atl_surface_kind": "sea",
                        "atl_geometry_role": "sea_completion",
                        "atl_join_mode": "gap_fill",
                        "geometry": _square(5, 1),
                    },
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            runtime_topology_payload = Topology(
                [political_gdf, atlantropa_gdf],
                object_name=["political", "scenario_atlantropa"],
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

            atl_chunk = json.loads((scenario_dir / "chunks" / "scenario_atlantropa.detail.r1c2.json").read_text(encoding="utf-8"))
            self.assertEqual(
                _chunk_feature_ids(atl_chunk),
                ["ATLISL_adriatica_corfu", "ATLSHL_adriatica_4", "ATLSEA_FILL_adriatica_1"],
            )
            props_by_id = {feature["properties"]["id"]: feature["properties"] for feature in atl_chunk["features"]}
            self.assertIs(props_by_id["ATLISL_adriatica_corfu"].get("interactive"), True)
            self.assertIs(props_by_id["ATLISL_adriatica_corfu"].get("atl_interactive"), True)
            self.assertEqual(props_by_id["ATLISL_adriatica_corfu"].get("atl_render_layer"), "land")
            self.assertEqual(props_by_id["ATLISL_adriatica_corfu"].get("atl_color_rule"), "owner")
            self.assertEqual(props_by_id["ATLISL_adriatica_corfu"].get("atl_geometry_role"), "donor_island")
            self.assertIs(props_by_id["ATLSHL_adriatica_4"].get("interactive"), True)
            self.assertIs(props_by_id["ATLSHL_adriatica_4"].get("atl_interactive"), True)
            self.assertEqual(props_by_id["ATLSHL_adriatica_4"].get("atl_render_layer"), "shoal")
            self.assertEqual(props_by_id["ATLSHL_adriatica_4"].get("atl_color_rule"), "shoal_pattern")
            self.assertEqual(props_by_id["ATLSHL_adriatica_4"].get("atl_join_mode"), "gap_fill")
            self.assertIs(props_by_id["ATLSEA_FILL_adriatica_1"].get("interactive"), True)
            self.assertEqual(props_by_id["ATLSEA_FILL_adriatica_1"].get("atl_render_layer"), "water")
            self.assertEqual(props_by_id["ATLSEA_FILL_adriatica_1"].get("atl_color_rule"), "atlantropa_sea")
            self.assertEqual(props_by_id["ATLSEA_FILL_adriatica_1"].get("atl_geometry_role"), "sea_completion")

            atl_manifest_chunk = next(chunk for chunk in result["detail_chunk_manifest"]["chunks"] if chunk["id"] == "scenario_atlantropa.detail.r1c2")
            self.assertEqual(atl_manifest_chunk["layer"], "scenario_atlantropa")
            self.assertEqual(atl_manifest_chunk["country_codes"], ["ATL"])
            self.assertTrue(atl_manifest_chunk["feature_bounds"])

    def test_political_coarse_uses_complete_runtime_topology_when_startup_is_partial(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"owners": {"AAA-detail": "AAA", "BBB-detail": "BBB"}}),
                encoding="utf-8",
            )

            startup_political_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "AAA-bootstrap",
                        "name": "Alpha Bootstrap",
                        "cntr_code": "AAA",
                        "admin1_group": "Alpha Group",
                        "detail_tier": "admin0",
                        "__source": "bootstrap",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "geometry": _square(0, 0),
                    }
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            runtime_political_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "AAA-detail",
                        "name": "Alpha Detail",
                        "cntr_code": "AAA",
                        "admin1_group": "Alpha Group",
                        "detail_tier": "adm2",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "geometry": _square(0, 0),
                    },
                    {
                        "id": "BBB-detail",
                        "name": "Beta Detail",
                        "cntr_code": "BBB",
                        "admin1_group": "Beta Group",
                        "detail_tier": "adm2",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "geometry": _square(2, 0),
                    },
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            startup_topology_payload = Topology(
                [startup_political_gdf],
                object_name=["political"],
                topology=True,
                prequantize=False,
                topoquantize=False,
                presimplify=False,
                toposimplify=False,
                shared_coords=False,
            ).to_dict()
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

            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "tno_1962", "generated_at": "2026-04-13T00:00:00Z"},
                layer_payloads={},
                startup_topology_payload=startup_topology_payload,
                runtime_topology_payload=runtime_topology_payload,
                startup_topology_url="data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json",
                runtime_topology_url="data/scenarios/tno_1962/runtime_topology.topo.json",
                generated_at="2026-04-13T00:00:00Z",
            )

            coarse_chunk = next(chunk for chunk in result["detail_chunk_manifest"]["chunks"] if chunk["id"] == "political.coarse.r0c0")
            self.assertEqual(coarse_chunk["feature_count"], 2)
            self.assertEqual(len(coarse_chunk["feature_bounds"]), coarse_chunk["feature_count"])
            coarse_payload = json.loads((scenario_dir / "chunks" / "political.coarse.r0c0.json").read_text(encoding="utf-8"))
            self.assertEqual(_chunk_feature_ids(coarse_payload), ["AAA-detail", "BBB-detail"])

            detail_chunk_ids = {
                chunk["id"]: chunk["feature_count"]
                for chunk in result["detail_chunk_manifest"]["chunks"]
                if str(chunk.get("id", "")).startswith("political.detail.country.")
            }
            self.assertEqual(detail_chunk_ids, {
                "political.detail.country.aaa": 1,
                "political.detail.country.bbb": 1,
            })

    def test_feature_bounds_summary_omits_empty_bounds(self) -> None:
        features = [
            {
                "type": "Feature",
                "properties": {"id": "flat"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [0, 0], [0, 0], [0, 0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "area"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[1, 1], [2, 1], [2, 2], [1, 1]]],
                },
            },
        ]

        bounds = scenario_chunk_assets._build_feature_bounds_summary(features)

        self.assertEqual(bounds, [[1.0, 1.0, 2.0, 2.0]])

        aligned_bounds = scenario_chunk_assets._build_feature_bounds_summary(
            features,
            include_zero_area=True,
        )

        self.assertEqual(aligned_bounds, [[0.0, 0.0, 0.0, 0.0], [1.0, 1.0, 2.0, 2.0]])

    def test_feature_bounds_summary_reads_geometry_collection_children(self) -> None:
        features = [
            {
                "type": "Feature",
                "properties": {"id": "collection"},
                "geometry": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {
                            "type": "Polygon",
                            "coordinates": [[[10, 20], [12, 20], [12, 22], [10, 20]]],
                        },
                        {
                            "type": "Point",
                            "coordinates": [15, 25],
                        },
                    ],
                },
            },
        ]

        bounds = scenario_chunk_assets._build_feature_bounds_summary(features)

        self.assertEqual(bounds, [[10.0, 20.0, 15.0, 25.0]])

    def test_political_coarse_uses_runtime_topology_when_startup_political_is_unmarked_shell_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "hoi4_1939"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"owners": {"AAA-detail": "AAA", "RU_ARCTIC_FB_002": "RU"}}),
                encoding="utf-8",
            )

            startup_shell_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "RU_ARCTIC_FB_001",
                        "name": "Russian Arctic shell fallback",
                        "cntr_code": "RU",
                        "geometry": _square(0, 0),
                    }
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            runtime_political_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "AAA-detail",
                        "name": "Alpha Detail",
                        "cntr_code": "AAA",
                        "admin1_group": "Alpha Group",
                        "detail_tier": "adm2",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "geometry": _square(2, 0),
                    },
                    {
                        "id": "RU_ARCTIC_FB_002",
                        "name": "Russian Arctic shell fallback",
                        "cntr_code": "RU",
                        "geometry": _square(4, 0),
                    }
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            startup_topology_payload = Topology(
                [startup_shell_gdf],
                object_name=["political"],
                topology=True,
                prequantize=False,
                topoquantize=False,
                presimplify=False,
                toposimplify=False,
                shared_coords=False,
            ).to_dict()
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

            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "hoi4_1939", "generated_at": "2026-04-13T00:00:00Z"},
                layer_payloads={},
                startup_topology_payload=startup_topology_payload,
                runtime_topology_payload=runtime_topology_payload,
                startup_topology_url="data/scenarios/hoi4_1939/runtime_topology.bootstrap.topo.json",
                runtime_topology_url="data/scenarios/hoi4_1939/runtime_topology.topo.json",
                generated_at="2026-04-13T00:00:00Z",
            )

            coarse_chunk = next(chunk for chunk in result["detail_chunk_manifest"]["chunks"] if chunk["id"] == "political.coarse.r0c0")
            self.assertEqual(coarse_chunk["feature_count"], 2)
            self.assertEqual(len(coarse_chunk["feature_bounds"]), coarse_chunk["feature_count"])
            coarse_payload = json.loads((scenario_dir / "chunks" / "political.coarse.r0c0.json").read_text(encoding="utf-8"))
            self.assertEqual(_chunk_feature_ids(coarse_payload), ["AAA-detail", "RU_ARCTIC_FB_002"])

    def test_political_coarse_uses_runtime_topology_when_startup_has_marked_shell(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"owners": {"AAA-detail": "AAA"}}),
                encoding="utf-8",
            )

            startup_shell_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "RU_ARCTIC_FB_001",
                        "name": "Russian Arctic shell fallback",
                        "cntr_code": "RU",
                        "detail_tier": "scenario_runtime_shell",
                        "interactive": False,
                        "render_as_base_geography": False,
                        "scenario_helper_kind": "shell_fallback",
                        "scenario_shell_owner_hint": "RU",
                        "scenario_shell_controller_hint": "RU",
                        "geometry": _square(0, 0),
                    }
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            runtime_political_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "AAA-detail",
                        "name": "Alpha Detail",
                        "cntr_code": "AAA",
                        "admin1_group": "Alpha Group",
                        "detail_tier": "adm2",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
                        "geometry": _square(2, 0),
                    }
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
            startup_topology_payload = Topology(
                [startup_shell_gdf],
                object_name=["political"],
                topology=True,
                prequantize=False,
                topoquantize=False,
                presimplify=False,
                toposimplify=False,
                shared_coords=False,
            ).to_dict()
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

            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "tno_1962", "generated_at": "2026-04-13T00:00:00Z"},
                layer_payloads={},
                startup_topology_payload=startup_topology_payload,
                runtime_topology_payload=runtime_topology_payload,
                startup_topology_url="data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json",
                runtime_topology_url="data/scenarios/tno_1962/runtime_topology.topo.json",
                generated_at="2026-04-13T00:00:00Z",
            )

            coarse_chunk = next(chunk for chunk in result["detail_chunk_manifest"]["chunks"] if chunk["id"] == "political.coarse.r0c0")
            self.assertEqual(coarse_chunk["feature_count"], 1)
            self.assertEqual(len(coarse_chunk["feature_bounds"]), coarse_chunk["feature_count"])
            coarse_payload = json.loads((scenario_dir / "chunks" / "political.coarse.r0c0.json").read_text(encoding="utf-8"))
            self.assertEqual(_chunk_feature_ids(coarse_payload), ["AAA-detail"])

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
                        "scenario_shell_owner_hint": "AAA",
                        "scenario_shell_controller_hint": "AAA",
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
            coarse_path = scenario_dir / "chunks" / "political.coarse.r0c0.json"
            coarse_text = coarse_path.read_text(encoding="utf-8")
            coarse_payload = json.loads(coarse_text)
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
                    "scenario_shell_controller_hint",
                    "scenario_shell_owner_hint",
                ],
            )
            expected_text = json.dumps(coarse_payload, ensure_ascii=False, separators=(",", ":")) + "\n"
            self.assertEqual(coarse_text, expected_text)

    def test_political_coarse_lod_simplifies_geometry_and_reports_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)

            # 这个 fixture 锁住 coarse LOD 的核心合同：manifest 指标来自最终写盘
            # payload，属性白名单和几何简化一起接受测试约束。
            feature_collection = {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "id": "AAA-1",
                            "name": "Alpha",
                            "cntr_code": "AAA",
                            "admin1_group": "Alpha Group",
                            "__source": "detail",
                            "interactive": True,
                        },
                        "geometry": _bumped_square(0, 0, size=4.0).__geo_interface__,
                    }
                ],
            }

            chunks, _lod_entries = scenario_chunk_assets._build_chunk_payloads_for_feature_collection(
                scenario_dir=scenario_dir,
                scenario_id="tno_1962",
                layer_key="political",
                feature_collection=feature_collection,
                payload_factory=lambda selected_feature_ids: scenario_chunk_assets._slice_feature_collection(
                    feature_collection,
                    selected_feature_ids,
                ),
                chunk_specs=scenario_chunk_assets.POLITICAL_COARSE_LOD_SPECS,
            )

            coarse_chunk = next(chunk for chunk in chunks if chunk["id"] == "political.coarse.r0c0")
            diagnostics = coarse_chunk["lod_diagnostics"]
            self.assertEqual(diagnostics["tier"], "political-coarse-simplified-v1")
            self.assertEqual(diagnostics["round_decimals"], 4)
            self.assertIs(diagnostics["preserve_topology"], True)
            self.assertEqual(diagnostics["source_feature_count"], 1)
            self.assertEqual(diagnostics["optimized_feature_count"], 1)
            self.assertEqual(coarse_chunk["feature_count"], 1)
            self.assertEqual(len(coarse_chunk["feature_bounds"]), coarse_chunk["feature_count"])
            self.assertGreater(diagnostics["source_coord_count"], diagnostics["optimized_coord_count"])
            self.assertGreater(diagnostics["source_byte_size"], diagnostics["optimized_byte_size"])
            self.assertEqual(diagnostics["optimized_byte_size"], coarse_chunk["byte_size"])
            self.assertGreaterEqual(diagnostics["source_part_count"], diagnostics["optimized_part_count"])
            self.assertEqual(coarse_chunk["coord_count"], diagnostics["optimized_coord_count"])
            self.assertGreater(diagnostics["source_estimated_path_cost"], diagnostics["optimized_estimated_path_cost"])
            coarse_path = scenario_dir / "chunks" / "political.coarse.r0c0.json"
            coarse_text = coarse_path.read_text(encoding="utf-8")
            coarse_payload = json.loads(coarse_text)
            self.assertEqual(_chunk_feature_ids(coarse_payload), ["AAA-1"])
            self.assertEqual(coarse_chunk["feature_bounds"], [scenario_chunk_assets._feature_bounds(coarse_payload["features"][0])])
            self.assertEqual(
                sorted(coarse_payload["features"][0]["properties"].keys()),
                ["__source", "admin1_group", "cntr_code", "id", "interactive", "name"],
            )
            expected_text = json.dumps(coarse_payload, ensure_ascii=False, separators=(",", ":")) + "\n"
            self.assertEqual(coarse_text, expected_text)

    def test_standalone_chunk_builder_syncs_detail_chunk_manifest_source_sha(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            scenario_dir = temp_root / "data" / "scenarios" / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            runtime_political_gdf = gpd.GeoDataFrame(
                [
                    {
                        "id": "AAA-1",
                        "name": "Alpha",
                        "cntr_code": "AAA",
                        "admin1_group": "Alpha Group",
                        "detail_tier": "adm2",
                        "__source": "detail",
                        "interactive": True,
                        "render_as_base_geography": False,
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
                    "political": runtime_topology_payload["objects"]["political"],
                    "land_mask": {"type": "GeometryCollection", "geometries": []},
                    "context_land_mask": {"type": "GeometryCollection", "geometries": []},
                    "scenario_water": {"type": "GeometryCollection", "geometries": []},
                },
                "arcs": runtime_topology_payload.get("arcs", []),
            }
            runtime_topology_path = scenario_dir / "runtime_topology.topo.json"
            runtime_topology_path.write_text(json.dumps(runtime_topology_payload), encoding="utf-8")
            startup_topology_path = scenario_dir / "runtime_topology.bootstrap.topo.json"
            startup_topology_path.write_text(json.dumps(startup_shell_payload), encoding="utf-8")
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"owners": {"AAA-1": "AAA"}}),
                encoding="utf-8",
            )
            manifest_path = scenario_dir / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "scenario_id": "tno_1962",
                        "generated_at": "2026-05-01T00:00:00Z",
                        "runtime_topology_url": "data/scenarios/tno_1962/runtime_topology.topo.json",
                        "runtime_bootstrap_topology_url": "data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json",
                        "source": {},
                    }
                ),
                encoding="utf-8",
            )
            previous_project_root = build_scenario_chunk_assets.PROJECT_ROOT
            build_scenario_chunk_assets.PROJECT_ROOT = temp_root
            try:
                with patch.object(
                    sys,
                    "argv",
                    [
                        "build_scenario_chunk_assets.py",
                        "--scenario-dir",
                        str(scenario_dir),
                    ],
                ):
                    exit_code = build_scenario_chunk_assets.main()
            finally:
                build_scenario_chunk_assets.PROJECT_ROOT = previous_project_root

            self.assertEqual(exit_code, 0)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            detail_manifest_path = scenario_dir / "detail_chunks.manifest.json"
            self.assertEqual(
                manifest["source"]["detail_chunk_manifest_sha256"],
                build_scenario_chunk_assets.sha256_path(detail_manifest_path),
            )
            detail_manifest = json.loads(detail_manifest_path.read_text(encoding="utf-8"))
            for chunk in detail_manifest.get("chunks", []):
                chunk_path = temp_root.joinpath(*str(chunk["url"]).split("/"))
                self.assertEqual(chunk.get("sha256"), build_scenario_chunk_assets.sha256_path(chunk_path))

    def test_build_scenario_chunk_assets_rejects_cross_scenario_manifest_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            scenario_dir = temp_root / "data" / "scenarios" / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            (scenario_dir / "manifest.json").write_text(
                json.dumps(
                    {
                        "scenario_id": "tno_1962",
                        "generated_at": "2026-05-01T00:00:00Z",
                        "runtime_topology_url": "data/scenarios/other/runtime_topology.topo.json",
                        "source": {},
                    }
                ),
                encoding="utf-8",
            )

            previous_project_root = build_scenario_chunk_assets.PROJECT_ROOT
            build_scenario_chunk_assets.PROJECT_ROOT = temp_root
            try:
                with patch.object(
                    sys,
                    "argv",
                    [
                        "build_scenario_chunk_assets.py",
                        "--scenario-dir",
                        str(scenario_dir),
                    ],
                ):
                    with self.assertRaises(Exception) as context:
                        build_scenario_chunk_assets.main()
            finally:
                build_scenario_chunk_assets.PROJECT_ROOT = previous_project_root

            self.assertIn("manifest.runtime_topology_url", str(context.exception))
            self.assertIn("data/scenarios/tno_1962", str(context.exception))

    def test_water_chunks_are_minified_without_trimming_runtime_fields(self) -> None:
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
            source_by_id = {feature["properties"]["id"]: feature for feature in water_payload["features"]}
            water_chunks = [chunk for chunk in result["detail_chunk_manifest"]["chunks"] if chunk["layer"] == "water"]
            self.assertTrue(any(chunk["lod"] == "detail" for chunk in water_chunks))
            for chunk in water_chunks:
                chunk_path = scenario_dir / "chunks" / f"{chunk['id']}.json"
                chunk_text = chunk_path.read_text(encoding="utf-8")
                payload = json.loads(chunk_text)
                self.assertEqual(chunk_text, json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
                self.assertEqual(chunk["byte_size"], len(chunk_path.read_bytes()))
                for feature in payload["features"]:
                    original = source_by_id[feature["properties"]["id"]]
                    self.assertEqual(feature["geometry"], original["geometry"])
                    self.assertEqual(feature["properties"], original["properties"])


if __name__ == "__main__":
    unittest.main()
