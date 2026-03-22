from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import tempfile
import unittest

import geopandas as gpd
from shapely.geometry import Polygon, mapping

from tools.check_scenario_contracts import validate_publish_bundle_dir
from tools.patch_tno_1962_bundle import (
    ATLANTROPA_REGION_CONFIGS,
    MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
    MANUAL_SYNC_POLICY_STRICT_BLOCK,
    apply_dev_manual_overrides,
    build_relief_overlays,
    build_tno_bathymetry_payload,
    build_runtime_topology_state_from_countries_state,
    build_polar_feature_diagnostics,
    build_runtime_topology_payload,
    build_single_antarctic_feature,
    detect_unsynced_manual_edits,
    normalize_feature_core_map,
    resolve_tno_palette_color,
    resolve_publish_filenames,
    topology_object_to_gdf,
    validate_geo_locale_manual_overrides,
    write_bundle_stage,
)


def _square(x: float, y: float, size: float = 1.0) -> Polygon:
    return Polygon([
        (x, y),
        (x + size, y),
        (x + size, y + size),
        (x, y + size),
    ])


def _write_publish_bundle_dir(
    target_dir: Path,
    *,
    owners: dict[str, str] | None = None,
    controllers: dict[str, str] | None = None,
    cores: dict[str, object] | None = None,
    runtime_feature_ids: list[str] | None = None,
    manifest_feature_count: int | None = None,
) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    owners_payload = owners if owners is not None else {"F-1": "AAA"}
    controllers_payload = controllers if controllers is not None else {"F-1": "AAA"}
    cores_payload = cores if cores is not None else {"F-1": ["AAA"]}
    runtime_ids = runtime_feature_ids if runtime_feature_ids is not None else ["F-1"]
    (target_dir / "manifest.json").write_text(
        json.dumps(
            {
                "scenario_id": "test_bundle",
                "summary": {
                    "feature_count": manifest_feature_count if manifest_feature_count is not None else len(owners_payload),
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (target_dir / "owners.by_feature.json").write_text(
        json.dumps({"owners": owners_payload}, ensure_ascii=False),
        encoding="utf-8",
    )
    (target_dir / "controllers.by_feature.json").write_text(
        json.dumps({"controllers": controllers_payload}, ensure_ascii=False),
        encoding="utf-8",
    )
    (target_dir / "cores.by_feature.json").write_text(
        json.dumps({"cores": cores_payload}, ensure_ascii=False),
        encoding="utf-8",
    )
    (target_dir / "runtime_topology.topo.json").write_text(
        json.dumps(
            {
                "type": "Topology",
                "objects": {
                    "political": {
                        "type": "GeometryCollection",
                        "geometries": [
                            {
                                "type": "Polygon",
                                "properties": {"id": feature_id},
                                "arcs": [],
                            }
                            for feature_id in runtime_ids
                        ],
                    }
                },
                "arcs": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (target_dir / "countries.json").write_text(json.dumps({"countries": {"AAA": {"tag": "AAA"}}}), encoding="utf-8")
    (target_dir / "geo_locale_patch.json").write_text(json.dumps({"geo": {}}), encoding="utf-8")
    (target_dir / "bathymetry.topo.json").write_text(
        json.dumps(
            {
                "type": "Topology",
                "objects": {
                    "bathymetry_bands": {"type": "GeometryCollection", "geometries": []},
                    "bathymetry_contours": {"type": "GeometryCollection", "geometries": []},
                },
                "arcs": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


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

    def test_apply_dev_manual_overrides_allows_rerunning_dev_manual_creates(self) -> None:
        countries_payload = {
            "countries": {
                "BOP": {
                    "tag": "BOP",
                    "display_name": "Old Name",
                    "display_name_en": "Old Name",
                    "display_name_zh": "旧名称",
                    "color_hex": "#111111",
                    "feature_count": 0,
                    "controller_feature_count": 0,
                    "primary_rule_source": "dev_manual_tag_create",
                    "rule_sources": ["dev_manual_tag_create"],
                }
            }
        }
        owners_payload = {"owners": {}}
        controllers_payload = {"controllers": {}}
        cores_payload = {"cores": {}}
        audit_payload = {}
        manual_overrides_payload = {
            "countries": {
                "BOP": {
                    "mode": "create",
                    "display_name": "Bopland",
                    "display_name_en": "Bopland",
                    "display_name_zh": "博普兰",
                    "color_hex": "#abcdef",
                    "entry_kind": "scenario_country",
                    "base_iso2": "BOP",
                    "lookup_iso2": "BOP",
                    "provenance_iso2": "BOP",
                }
            }
        }

        diagnostics = apply_dev_manual_overrides(
            countries_payload,
            owners_payload,
            controllers_payload,
            cores_payload,
            manual_overrides_payload,
            audit_payload,
        )

        self.assertEqual(countries_payload["countries"]["BOP"]["display_name_en"], "Bopland")
        self.assertEqual(countries_payload["countries"]["BOP"]["display_name_zh"], "博普兰")
        self.assertEqual(countries_payload["countries"]["BOP"]["color_hex"], "#abcdef")
        self.assertNotIn("BOP", diagnostics["create_tags"])
        self.assertIn("BOP", diagnostics["override_tags"])

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

    def test_build_relief_overlays_keeps_expected_overlay_kind_distribution(self) -> None:
        region_unions = {
            region_id: _square(index * 2, 0, 0.18 if index >= 6 else 1.0)
            for index, region_id in enumerate(ATLANTROPA_REGION_CONFIGS)
        }
        lake_geom = _square(0, 4, 2.0)

        payload = build_relief_overlays(region_unions, lake_geom)
        overlay_counts = Counter(
            feature["properties"]["overlay_kind"]
            for feature in payload["features"]
        )

        self.assertEqual(
            overlay_counts,
            Counter({
                "salt_flat_texture": 8,
                "new_shoreline": 8,
                "drained_basin_contour": 6,
                "lake_shoreline": 1,
                "swamp_margin": 1,
                "dam_approach": 1,
            }),
        )
        self.assertEqual(len(payload["features"]), 25)

    def test_build_tno_bathymetry_payload_marks_observed_and_synthetic_modes(self) -> None:
        region_unions = {
            "west_mediterranean": _square(0, 0, 1.0),
            "libya_suez_and_qattara": _square(3, 0, 1.0),
        }
        atl_sea_collection = [
            {
                "type": "Feature",
                "properties": {
                    "id": "ATLSEA_west_obs",
                    "region_id": "west_mediterranean",
                    "region_group": "atlantropa_west_mediterranean_margin_sea",
                    "atl_geometry_role": "donor_sea",
                },
                "geometry": mapping(_square(0.0, 1.2, 1.0)),
            },
            {
                "type": "Feature",
                "properties": {
                    "id": "ATLSEA_libya_syn",
                    "region_id": "libya_suez_and_qattara",
                    "region_group": "atlantropa_libya_suez_and_qattara_sea",
                    "atl_geometry_role": "sea_completion",
                },
                "geometry": mapping(_square(3.0, 1.2, 1.0)),
            },
        ]

        payload, diagnostics = build_tno_bathymetry_payload(atl_sea_collection, region_unions)
        band_gdf = topology_object_to_gdf(payload, "bathymetry_bands")
        contour_gdf = topology_object_to_gdf(payload, "bathymetry_contours")

        self.assertFalse(band_gdf.empty)
        self.assertFalse(contour_gdf.empty)
        self.assertEqual(set(band_gdf["bathymetry_mode"]), {"observed", "synthetic"})
        self.assertIn("west_mediterranean", diagnostics["observed_region_ids"])
        self.assertIn("libya_suez_and_qattara", diagnostics["synthetic_region_ids"])
        shallow_rows = band_gdf.loc[
            band_gdf["region_id"] == "libya_suez_and_qattara",
            "depth_max_m",
        ].astype(int)
        self.assertTrue((shallow_rows >= -200).all())
        self.assertTrue((shallow_rows <= -25).any())

    def test_build_runtime_topology_state_sets_tno_relief_default_hint_true(self) -> None:
        state = {
            "countries_payload": {
                "countries": {
                    "AAA": {
                        "tag": "AAA",
                        "display_name": "Alpha",
                        "display_name_en": "Alpha",
                        "display_name_zh": "阿尔法",
                        "featured": False,
                    }
                }
            },
            "owners_payload": {"owners": {"AAA-1": "AAA"}},
            "controllers_payload": {"controllers": {"AAA-1": "AAA"}},
            "cores_payload": {"cores": {"AAA-1": ["AAA"]}},
            "manifest_payload": {"scenario_id": "tno_1962", "featured_tags": [], "summary": {}},
            "audit_payload": {"summary": {}, "diagnostics": {}},
            "scenario_political_gdf": gpd.GeoDataFrame(
                [{"id": "AAA-1", "name": "Alpha", "cntr_code": "AAA", "geometry": _square(0, 0, 1.0)}],
                geometry="geometry",
                crs="EPSG:4326",
            ),
            "water_gdf": gpd.GeoDataFrame(
                [{"id": "water-1", "name": "Lake", "geometry": _square(2, 2, 1.0)}],
                geometry="geometry",
                crs="EPSG:4326",
            ),
            "land_mask_gdf": gpd.GeoDataFrame(
                [{"id": "mask-1", "name": "Mask", "geometry": _square(0, 0, 4.0)}],
                geometry="geometry",
                crs="EPSG:4326",
            ),
            "context_land_mask_gdf": gpd.GeoDataFrame(
                [{"id": "context-mask-1", "name": "Context Mask", "geometry": _square(0, 0, 4.0)}],
                geometry="geometry",
                crs="EPSG:4326",
            ),
            "relief_overlays_payload": {"type": "FeatureCollection", "features": []},
            "bathymetry_payload": {
                "type": "Topology",
                "objects": {
                    "bathymetry_bands": {
                        "type": "GeometryCollection",
                        "geometries": [
                            {
                                "type": "Polygon",
                                "properties": {"id": "band-1", "depth_min_m": 0, "depth_max_m": -50},
                                "arcs": [],
                            }
                        ],
                    },
                    "bathymetry_contours": {
                        "type": "GeometryCollection",
                        "geometries": [
                            {
                                "type": "LineString",
                                "properties": {"id": "contour-1", "depth_m": -100},
                                "arcs": [],
                            }
                        ],
                    },
                },
                "arcs": [],
            },
            "stage_metadata": {
                "generated_at": "2026-03-21T00:00:00Z",
                "source_root": "test-source-root",
                "hgo_donor_root": "test-hgo-root",
                "touched_east_asia_tags": [],
                "touched_south_asia_tags": [],
                "touched_regional_rule_tags": [],
                "applied_annex_maps": {},
                "atlantropa_diagnostics": {},
                "island_replacement_diagnostics": {},
                "med_water_diagnostics": {},
                "restore_diagnostics": {},
                "feature_assignment_override_diagnostics": {},
                "atl_feature_ids": [],
                "atl_sea_feature_ids": [],
                "bathymetry_diagnostics": {"band_feature_count": 1, "contour_feature_count": 1},
                "context_land_mask_tolerance": 0.25,
                "context_land_mask_area_delta_ratio": 0.0,
                "context_land_mask_fallback_used": False,
            },
        }

        result = build_runtime_topology_state_from_countries_state(state)

        self.assertTrue(result["manifest_payload"]["performance_hints"]["scenario_relief_overlays_default"])
        self.assertEqual(
            result["manifest_payload"]["bathymetry_topology_url"],
            "data/scenarios/tno_1962/bathymetry.topo.json",
        )
        self.assertEqual(result["manifest_payload"]["summary"]["tno_bathymetry_band_count"], 1)
        self.assertEqual(result["manifest_payload"]["summary"]["tno_bathymetry_contour_count"], 1)

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
        self.assertIn("bathymetry.topo.json", scenario_data)
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

    def test_validate_publish_bundle_dir_accepts_shell_fallback_runtime_only_features(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            bundle_dir = Path(tmp_dir) / "bundle"
            _write_publish_bundle_dir(
                bundle_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1", "RU_ARCTIC_FB_1"],
                manifest_feature_count=1,
            )

            errors = validate_publish_bundle_dir(bundle_dir)

            self.assertEqual(errors, [])

    def test_validate_publish_bundle_dir_rejects_strict_contract_failures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            bundle_dir = Path(tmp_dir) / "bundle"
            _write_publish_bundle_dir(
                bundle_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA", "F-2": "AAA"},
                cores={"F-1": ["AAA"], "F-2": "AAA"},
                runtime_feature_ids=["F-1", "F-2", "BAD-1"],
                manifest_feature_count=9,
            )

            errors = validate_publish_bundle_dir(bundle_dir)

            self.assertTrue(any("owners/controllers feature keysets must match" in error for error in errors))
            self.assertTrue(any("owners/cores feature keysets must match" in error for error in errors))
            self.assertTrue(any("must store arrays for every feature" in error for error in errors))
            self.assertTrue(any("feature_count must equal owners feature count" in error for error in errors))
            self.assertTrue(any("may only exceed the feature maps with shell fallback ids" in error for error in errors))

    def test_write_bundle_stage_blocks_publish_when_strict_checkpoint_validation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            _write_publish_bundle_dir(
                checkpoint_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA", "F-2": "AAA"},
                cores={"F-1": ["AAA"], "F-2": ["AAA"]},
                runtime_feature_ids=["F-1", "F-2"],
                manifest_feature_count=1,
            )

            with self.assertRaisesRegex(ValueError, "Strict bundle validation failed"):
                write_bundle_stage(
                    scenario_dir,
                    checkpoint_dir,
                    publish_scope="scenario_data",
                    manual_sync_policy=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
                )

            self.assertFalse((scenario_dir / "owners.by_feature.json").exists())


if __name__ == "__main__":
    unittest.main()
