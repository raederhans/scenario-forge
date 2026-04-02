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


if __name__ == "__main__":
    unittest.main()
