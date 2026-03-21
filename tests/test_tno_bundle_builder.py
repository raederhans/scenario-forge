from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import geopandas as gpd
from shapely.geometry import Polygon

from tools.patch_tno_1962_bundle import (
    MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
    MANUAL_SYNC_POLICY_STRICT_BLOCK,
    apply_dev_manual_overrides,
    build_polar_feature_diagnostics,
    build_runtime_topology_payload,
    build_single_antarctic_feature,
    detect_unsynced_manual_edits,
    normalize_feature_core_map,
    resolve_tno_palette_color,
    resolve_publish_filenames,
    topology_object_to_gdf,
    validate_geo_locale_manual_overrides,
)


def _square(x: float, y: float, size: float = 1.0) -> Polygon:
    return Polygon([
        (x, y),
        (x + size, y),
        (x + size, y + size),
        (x, y + size),
    ])


class TnoBundleBuilderTest(unittest.TestCase):
    def test_apply_dev_manual_overrides_can_create_override_and_assign_feature_maps(self) -> None:
        countries_payload = {
            "countries": {
                "AAA": {
                    "tag": "AAA",
                    "display_name": "Alpha",
                    "display_name_en": "Alpha",
                    "display_name_zh": "阿尔法",
                    "color_hex": "#111111",
                    "feature_count": 1,
                    "controller_feature_count": 1,
                }
            }
        }
        owners_payload = {"owners": {"F-1": "AAA"}}
        controllers_payload = {"controllers": {"F-1": "AAA"}}
        cores_payload = {"cores": {"F-1": ["AAA"]}}
        audit_payload = {}
        manual_overrides_payload = {
            "countries": {
                "AAA": {
                    "mode": "override",
                    "display_name_en": "Alpha Prime",
                    "display_name_zh": "阿尔法首府",
                    "color_hex": "#222222",
                    "featured": True,
                },
                "CCC": {
                    "mode": "create",
                    "display_name": "Caledonia",
                    "display_name_en": "Caledonia",
                    "display_name_zh": "卡莱多尼亚",
                    "color_hex": "#123456",
                    "parent_owner_tag": "AAA",
                    "entry_kind": "scenario_subject",
                    "subject_kind": "releasable_state",
                    "base_iso2": "CCC",
                    "lookup_iso2": "CCC",
                    "provenance_iso2": "CCC",
                    "continent_id": "continent_test",
                    "continent_label": "Test",
                    "subregion_id": "subregion_test",
                    "subregion_label": "Test",
                },
            },
            "assignments": {
                "F-1": {
                    "owner": "CCC",
                    "controller": "CCC",
                    "cores": ["CCC", "AAA"],
                }
            },
        }

        diagnostics = apply_dev_manual_overrides(
            countries_payload,
            owners_payload,
            controllers_payload,
            cores_payload,
            manual_overrides_payload,
            audit_payload,
        )

        self.assertEqual(countries_payload["countries"]["AAA"]["display_name_en"], "Alpha Prime")
        self.assertEqual(countries_payload["countries"]["AAA"]["color_hex"], "#222222")
        self.assertTrue(countries_payload["countries"]["AAA"]["featured"])
        self.assertIn("CCC", countries_payload["countries"])
        self.assertEqual(countries_payload["countries"]["CCC"]["primary_rule_source"], "dev_manual_tag_create")
        self.assertEqual(owners_payload["owners"]["F-1"], "CCC")
        self.assertEqual(controllers_payload["controllers"]["F-1"], "CCC")
        self.assertEqual(cores_payload["cores"]["F-1"], ["CCC", "AAA"])
        self.assertIn("CCC", diagnostics["create_tags"])
        self.assertIn("AAA", diagnostics["override_tags"])

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

    def test_build_single_antarctic_feature_collapses_runtime_sectors(self) -> None:
        runtime_gdf = gpd.GeoDataFrame(
            [
                {
                    "id": "AQ_EAST",
                    "name": "Antarctica East",
                    "cntr_code": "AQ",
                    "detail_tier": "antarctic_sector",
                    "__source": "primary",
                    "geometry": _square(0, -80, 2),
                },
                {
                    "id": "AQ_WEST",
                    "name": "Antarctica West",
                    "cntr_code": "AQ",
                    "detail_tier": "antarctic_sector",
                    "__source": "primary",
                    "geometry": _square(2, -80, 2),
                },
                {
                    "id": "BBB-1",
                    "name": "Elsewhere",
                    "cntr_code": "BBB",
                    "detail_tier": "",
                    "__source": "detail",
                    "geometry": _square(10, 10, 1),
                },
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )

        antarctic_gdf, assignments, diagnostics = build_single_antarctic_feature(runtime_gdf)

        self.assertEqual(antarctic_gdf["id"].tolist(), ["AQ"])
        self.assertEqual(antarctic_gdf.iloc[0]["cntr_code"], "AQ")
        self.assertEqual(assignments, {"AQ": {"owner": "AQ", "controller": "AQ", "core": ["AQ"]}})
        self.assertEqual(diagnostics["source_feature_count"], 2)
        self.assertEqual(sorted(diagnostics["source_feature_ids"]), ["AQ_EAST", "AQ_WEST"])

    def test_checked_in_tno_runtime_topology_has_clean_polar_features(self) -> None:
        runtime_topology_path = (
            Path(__file__).resolve().parents[1]
            / "data"
            / "scenarios"
            / "tno_1962"
            / "runtime_topology.topo.json"
        )
        topology_payload = json.loads(runtime_topology_path.read_text(encoding="utf-8"))
        political_gdf = topology_object_to_gdf(topology_payload, "political")
        feature_ids = political_gdf["id"].fillna("").astype(str).tolist()
        polar_diagnostics = build_polar_feature_diagnostics(political_gdf)
        shell_fragment_count = sum(feature_id.startswith("RU_ARCTIC_FB_") for feature_id in feature_ids)

        self.assertIn("AQ", feature_ids)
        self.assertFalse(any(feature_id.startswith("AQ_") for feature_id in feature_ids))
        self.assertGreaterEqual(shell_fragment_count, 300)
        self.assertIn("AQ", polar_diagnostics)
        self.assertTrue(
            all(
                "world_bounds" not in entry.get("flags", [])
                and "giant_feature" not in entry.get("flags", [])
                for entry in polar_diagnostics.values()
            )
        )

    def test_resolve_publish_filenames_scopes(self) -> None:
        runtime_only = resolve_publish_filenames("polar_runtime")
        scenario_data = resolve_publish_filenames("scenario_data")
        all_files = resolve_publish_filenames("all")

        self.assertEqual(runtime_only, ("runtime_topology.topo.json",))
        self.assertIn("geo_locale_patch.json", scenario_data)
        self.assertNotIn("runtime_topology.topo.json", scenario_data)
        self.assertEqual(all_files[-1], "runtime_topology.topo.json")

    def test_resolve_tno_palette_color_includes_1962_fixed_overrides(self) -> None:
        expected_colors = {
            "BRM": "#40839e",
            "CAM": "#685d6d",
            "CHI": "#ce9f61",
            "FRI": "#2a62a2",
            "GER": "#3c3c3c",
            "INS": "#9f344d",
            "MAN": "#a80043",
            "MEN": "#8f354b",
            "PAK": "#21331e",
            "SHX": "#955a74",
            "TIB": "#c8c8c8",
            "VIN": "#a76286",
            "XIK": "#6873a0",
            "XIN": "#5f8e9c",
            "YUN": "#763446",
        }

        for tag, color_hex in expected_colors.items():
            self.assertEqual(resolve_tno_palette_color(tag, {}), color_hex)

    def test_validate_geo_locale_manual_overrides_requires_exact_override_entries(self) -> None:
        geo_locale_payload = {
            "geo": {
                "AAA": {"en": "Alpha", "zh": "阿尔法"},
            }
        }
        manual_payload = {
            "geo": {
                "AAA": {"en": "Alpha", "zh": "阿尔法"},
            }
        }

        validate_geo_locale_manual_overrides(geo_locale_payload, manual_payload)

        bad_payload = {
            "geo": {
                "AAA": {"en": "Alpha", "zh": "阿尔法地区"},
            }
        }
        with self.assertRaisesRegex(ValueError, "manual overrides"):
            validate_geo_locale_manual_overrides(bad_payload, manual_payload)

    def test_detect_unsynced_manual_edits_writes_report_and_backup_or_blocks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            matching_payloads = {
                "countries.json": {"countries": {"AAA": {"tag": "AAA"}}},
                "owners.by_feature.json": {"owners": {"F-1": "AAA"}},
                "controllers.by_feature.json": {"controllers": {"F-1": "AAA"}},
                "cores.by_feature.json": {"cores": {"F-1": ["AAA"]}},
                "geo_locale_patch.json": {"geo": {"F-1": {"en": "Alpha", "zh": "阿尔法"}}},
            }
            for filename, payload in matching_payloads.items():
                (checkpoint_dir / filename).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                (scenario_dir / filename).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            (scenario_dir / "countries.json").write_text(
                json.dumps({"countries": {"AAA": {"tag": "AAA"}, "BBB": {"tag": "BBB"}}}, ensure_ascii=False),
                encoding="utf-8",
            )

            report = detect_unsynced_manual_edits(
                scenario_dir,
                checkpoint_dir,
                {
                    "scenario_manual_overrides": scenario_dir / "scenario_manual_overrides.json",
                    "geo_name_overrides": scenario_dir / "geo_name_overrides.manual.json",
                    "district_groups": scenario_dir / "district_groups.manual.json",
                },
                policy=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
                report_dir=root / "reports",
                backup_root=root / "backups",
            )

            self.assertTrue(report["has_drift"])
            self.assertTrue(Path(report["report_path"]).exists())
            self.assertTrue(Path(report["backup_path"]).exists())
            with self.assertRaises(ValueError):
                detect_unsynced_manual_edits(
                    scenario_dir,
                    checkpoint_dir,
                    {
                        "scenario_manual_overrides": scenario_dir / "scenario_manual_overrides.json",
                        "geo_name_overrides": scenario_dir / "geo_name_overrides.manual.json",
                        "district_groups": scenario_dir / "district_groups.manual.json",
                    },
                    policy=MANUAL_SYNC_POLICY_STRICT_BLOCK,
                    report_dir=root / "reports",
                    backup_root=root / "backups",
                )


if __name__ == "__main__":
    unittest.main()
