from __future__ import annotations

from helpers.polygon_fixtures import _square
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import LineString, Polygon, shape
from topojson import Topology

from tools import build_scenario_chunk_assets, scenario_chunk_assets


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
    def test_opening_owner_borders_include_only_strict_shared_edges(self) -> None:
        cases = (
            ("adjacent", [_square(0, 0)], [_square(1, 0)], 1.0),
            ("point contact", [_square(0, 0)], [_square(1, 1)], 0.0),
            ("gap", [_square(0, 0)], [_square(1.001, 0)], 0.0),
            ("same-side overlap", [_square(0, 0)], [_square(0.5, 0)], 0.0),
            (
                "overlap plus strict edge",
                [_square(0, 0), _square(3, 0)],
                [_square(1, 0), _square(3.5, 0)],
                1.0,
            ),
            ("full overlap", [_square(0, 0)], [_square(0, 0)], 0.0),
        )
        for name, owner_a, owner_b, expected_length in cases:
            with self.subTest(name=name):
                features = [
                    {
                        "type": "Feature",
                        "properties": {"id": f"{owner}-{index}"},
                        "geometry": polygon.__geo_interface__,
                    }
                    for owner, polygons in (("AAA", owner_a), ("BBB", owner_b))
                    for index, polygon in enumerate(polygons)
                ]
                owners = {feature["properties"]["id"]: feature["properties"]["id"][:3] for feature in features}
                with patch.object(
                    scenario_chunk_assets,
                    "_topology_object_to_feature_collection",
                    return_value={"type": "FeatureCollection", "features": features},
                ):
                    mesh = scenario_chunk_assets._build_opening_owner_border_mesh({}, owners)
                self.assertEqual(mesh["type"], "MultiLineString")
                self.assertAlmostEqual(
                    sum(LineString(coords).length for coords in mesh["coordinates"]),
                    expected_length,
                )
                if expected_length:
                    self.assertTrue(LineString(mesh["coordinates"][0]).equals(LineString([(1, 0), (1, 1)])))

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
                    {"id": "AAA-1", "cntr_code": "AAA", "geometry": _square(0, 0)},
                    {"id": "BBB-1", "cntr_code": "BBB", "geometry": _square(1, 0)},
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

    def test_political_coarse_uses_complete_runtime_topology_when_startup_is_partial(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"owners": {"AAA-detail": "AAA", "BBB-detail": "BBB"}}),
                encoding="utf-8",
            )

            def political_topology(rows):
                frame = gpd.GeoDataFrame([
                    {"id": fid, "cntr_code": owner, "detail_tier": tier, "geometry": _square(x, 0)}
                    for fid, owner, tier, x in rows
                ], crs="EPSG:4326")
                return Topology([frame], object_name=["political"], prequantize=False).to_dict()

            startup_topology_payload = political_topology([("AAA-bootstrap", "AAA", "admin0", 0)])
            runtime_topology_payload = political_topology([
                ("AAA-detail", "AAA", "adm2", 0), ("BBB-detail", "BBB", "adm2", 2),
            ])

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
                chunk_specs=scenario_chunk_assets.LOD_SPECS[:1],
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

            with patch.object(build_scenario_chunk_assets, "PROJECT_ROOT", temp_root):
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

            self.assertIn("manifest.runtime_topology_url", str(context.exception))
            self.assertIn("data/scenarios/tno_1962", str(context.exception))

    def test_fr_arr_coarse_simplifies_shared_coverage_and_preserves_ids(self) -> None:
        shared_ys = [index / 10 for index in range(11)]
        left = Polygon([(0, 0), (1, 0), *[(1, y) for y in shared_ys[1:]], (0, 1), (0, 0)])
        right = Polygon([(1, 0), (2, 0), (2, 1), (1, 1), *[(1, y) for y in shared_ys[-2:0:-1]], (1, 0)])
        payload = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"id": "FR_ARR_00001", "cntr_code": "FR", "marker": "left"}, "geometry": left.__geo_interface__},
                {"type": "Feature", "properties": {"id": "FR_ARR_00002", "cntr_code": "FR", "marker": "right"}, "geometry": right.__geo_interface__},
            ],
        }
        optimized = scenario_chunk_assets._optimize_political_coarse_payload(
            payload,
            owner_buckets_by_feature_id={"FR_ARR_00001": "FRA", "FR_ARR_00002": "FRA"},
        )
        self.assertEqual(_chunk_feature_ids(optimized), ["FR_ARR_00001", "FR_ARR_00002"])
        self.assertEqual([feature["properties"].get("marker") for feature in optimized["features"]], [None, None])
        optimized_geometries = [shape(feature["geometry"]) for feature in optimized["features"]]
        self.assertLess(
            scenario_chunk_assets._summarize_payload_geometry_cost(optimized)["coord_count"],
            scenario_chunk_assets._summarize_payload_geometry_cost(payload)["coord_count"],
        )
        shared = optimized_geometries[0].boundary.intersection(optimized_geometries[1].boundary)
        self.assertGreater(shared.length, 0)
        self.assertTrue(optimized_geometries[0].is_valid and optimized_geometries[1].is_valid)

if __name__ == "__main__":
    unittest.main()
