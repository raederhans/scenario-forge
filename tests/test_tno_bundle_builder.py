from __future__ import annotations

from collections import Counter
from contextlib import nullcontext
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Point, Polygon, mapping, shape

from map_builder.contracts import SCENARIO_BUNDLE_STAGE_DESCRIPTORS
from tools.check_scenario_contracts import validate_publish_bundle_dir
from tools import patch_tno_1962_bundle as tno_bundle
from tools.patch_tno_1962_bundle import (
    ATLANTROPA_REGION_CONFIGS,
    MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
    MANUAL_SYNC_POLICY_STRICT_BLOCK,
    TNO_1962_GREECE_COARSE_OWNER_BACKFILL,
    TNO_1962_OWNER_ONLY_BACKFILL,
    apply_tno_greece_coarse_owner_backfill,
    apply_tno_owner_only_backfill,
    apply_tno_feature_assignment_overrides,
    apply_tno_decolonization_metadata,
    apply_dev_manual_overrides,
    build_relief_overlays,
    clip_named_water_features_to_land_mask,
    build_tno_bathymetry_payload,
    build_polar_feature_diagnostics_from_topology,
    build_runtime_topology_state_from_countries_state,
    build_runtime_topology_payload,
    build_chunk_assets_stage,
    build_geo_locale_stage,
    build_single_antarctic_feature,
    build_startup_assets_stage,
    ensure_water_stage_checkpoints,
    detect_unsynced_manual_edits,
    patch_tno_palette_defaults,
    rebuild_feature_maps_from_political_gdf,
    normalize_feature_core_map,
    resolve_tno_palette_color,
    resolve_publish_filenames,
    topology_object_to_gdf,
    validate_runtime_topology_water_outputs,
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
    (target_dir / "runtime_topology.bootstrap.topo.json").write_text(
        json.dumps(
            {
                "type": "Topology",
                "objects": {
                    "bootstrap": {"type": "GeometryCollection", "geometries": []},
                },
                "arcs": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (target_dir / "startup.bundle.en.json").write_text(json.dumps({"ok": True}, ensure_ascii=False), encoding="utf-8")
    (target_dir / "startup.bundle.zh.json").write_text(json.dumps({"ok": True}, ensure_ascii=False), encoding="utf-8")
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
    for filename in resolve_publish_filenames(tno_bundle.PUBLISH_SCOPE_SCENARIO_DATA):
        path = target_dir / filename
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        if filename.endswith(".topo.json"):
            payload: object = {
                "type": "Topology",
                "objects": {},
                "arcs": [],
            }
        elif filename.endswith(".geojson"):
            payload = {
                "type": "FeatureCollection",
                "features": [],
            }
        else:
            payload = {}
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


class TnoBundleBuilderTest(unittest.TestCase):
    def test_apply_tno_greece_coarse_owner_backfill_requires_controller_core_consistency(self) -> None:
        owners_payload = {"owners": {}}
        controllers_payload = {
            "controllers": dict(TNO_1962_GREECE_COARSE_OWNER_BACKFILL)
        }
        cores_payload = {
            "cores": {
                feature_id: [tag]
                for feature_id, tag in TNO_1962_GREECE_COARSE_OWNER_BACKFILL.items()
            }
        }
        scenario_political_gdf = gpd.GeoDataFrame(
            {
                "id": [
                    "GR_ADM1_GRC-2883",
                    "GR_ADM1_GRC-2884",
                    "GR_ADM1_GRC-2885",
                    "GR_ADM1_GRC-2886",
                    "GR_ADM1_GRC-2892",
                    "GR_ADM1_GRC-2900",
                    "GR_ADM1_GRC-2949",
                    "GR_ADM1_GRC-2989",
                    "GR_ADM1_GRC-2991",
                    "GR_ADM1_GRC-2992",
                    "GR_ADM1_GRC-3001",
                ],
                "geometry": [_square(float(index), 0.0) for index in range(11)],
            },
            geometry="geometry",
            crs="EPSG:4326",
        )

        diagnostics = apply_tno_greece_coarse_owner_backfill(
            owners_payload,
            controllers_payload,
            cores_payload,
            scenario_political_gdf,
        )

        self.assertEqual(diagnostics["feature_count"], 11)
        self.assertEqual(owners_payload["owners"]["GR_ADM1_GRC-2883"], "GRE")
        self.assertEqual(owners_payload["owners"]["GR_ADM1_GRC-2992"], "BUL")
        self.assertEqual(owners_payload["owners"]["GR_ADM1_GRC-3001"], "BUL")

    def test_apply_tno_greece_coarse_owner_backfill_rejects_missing_controller_or_core(self) -> None:
        owners_payload = {"owners": {}}
        controllers_payload = {"controllers": {}}
        cores_payload = {"cores": {}}
        scenario_political_gdf = gpd.GeoDataFrame(
            {
                "id": list(TNO_1962_GREECE_COARSE_OWNER_BACKFILL.keys()),
                "geometry": [_square(float(index), 0.0) for index in range(11)],
            },
            geometry="geometry",
            crs="EPSG:4326",
        )

        with self.assertRaisesRegex(ValueError, "requires controller tag"):
            apply_tno_greece_coarse_owner_backfill(
                owners_payload,
                controllers_payload,
                cores_payload,
                scenario_political_gdf,
            )

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
                    "atl_geometry_role": "donor_land",
                    "atl_join_mode": "none",
                    "interactive": False,
                    "render_as_base_geography": False,
                    "geometry": _square(2, 0),
                },
                {
                    "id": "RU_ARCTIC_FB_001",
                    "name": "Russia Shell Fallback 1",
                    "cntr_code": "RU",
                    "admin1_group": "",
                    "detail_tier": "scenario_runtime_shell",
                    "__source": "detail",
                    "scenario_id": "tno_1962",
                    "scenario_helper_kind": "shell_fallback",
                    "interactive": False,
                    "render_as_base_geography": False,
                    "geometry": _square(4, 0),
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
        self.assertIn("scenario_water", topo["objects"])
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
                "atl_geometry_role": "donor_land",
                "atl_join_mode": "none",
                "interactive": False,
                "render_as_base_geography": False,
            },
        )
        self.assertEqual(
            props_by_id["RU_ARCTIC_FB_001"],
            {
                "id": "RU_ARCTIC_FB_001",
                "name": "Russia Shell Fallback 1",
                "cntr_code": "RU",
                "detail_tier": "scenario_runtime_shell",
                "__source": "detail",
                "scenario_id": "tno_1962",
                "scenario_helper_kind": "shell_fallback",
                "interactive": False,
                "render_as_base_geography": False,
            },
        )

    def test_build_runtime_topology_payload_builds_all_layers_in_single_topology_call(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [{"id": "AAA-1", "name": "Alpha", "cntr_code": "AAA", "geometry": _square(0, 0, 1.0)}],
            geometry="geometry",
            crs="EPSG:4326",
        )
        water_gdf = gpd.GeoDataFrame(
            [{"id": "water-1", "name": "Lake", "geometry": _square(2, 2, 1.0)}],
            geometry="geometry",
            crs="EPSG:4326",
        )
        land_mask_gdf = gpd.GeoDataFrame(
            [{"id": "mask-1", "name": "Mask", "geometry": _square(0, 0, 4.0)}],
            geometry="geometry",
            crs="EPSG:4326",
        )
        context_land_mask_gdf = gpd.GeoDataFrame(
            [{"id": "context-mask-1", "name": "Context Mask", "geometry": _square(0, 0, 4.0)}],
            geometry="geometry",
            crs="EPSG:4326",
        )

        with patch.object(tno_bundle, "build_named_topology", wraps=tno_bundle.build_named_topology) as topology_mock:
            build_runtime_topology_payload(
                political_gdf,
                water_gdf,
                land_mask_gdf,
                context_land_mask_gdf,
            )

        topology_mock.assert_called_once()
        layer_names = [layer_name for layer_name, _ in topology_mock.call_args.args[0]]
        self.assertEqual(
            layer_names,
            ["political", "land_mask", "context_land_mask", "scenario_water"],
        )

    def test_build_runtime_topology_payload_forces_atl_synthetic_country_code(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {"id": "ATLISL_adriatica_corfu", "name": "Corfu", "cntr_code": "ITA", "geometry": _square(0, 0, 1.0)},
                {"id": "ATLSHL_adriatica_4", "name": "Shelf", "cntr_code": "GRE", "geometry": _square(2, 0, 1.0)},
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        water_gdf = gpd.GeoDataFrame(
            [{"id": "water-1", "name": "Lake", "geometry": _square(4, 4, 1.0)}],
            geometry="geometry",
            crs="EPSG:4326",
        )
        land_mask_gdf = gpd.GeoDataFrame(
            [{"id": "mask-1", "name": "Mask", "geometry": _square(0, 0, 6.0)}],
            geometry="geometry",
            crs="EPSG:4326",
        )
        context_land_mask_gdf = gpd.GeoDataFrame(
            [{"id": "context-mask-1", "name": "Context Mask", "geometry": _square(0, 0, 6.0)}],
            geometry="geometry",
            crs="EPSG:4326",
        )

        topo = build_runtime_topology_payload(
            political_gdf,
            water_gdf,
            land_mask_gdf,
            context_land_mask_gdf,
        )
        political_props = {
            geometry.get("properties", {}).get("id"): geometry.get("properties", {})
            for geometry in topo["objects"]["political"]["geometries"]
        }

        self.assertEqual(political_props["ATLISL_adriatica_corfu"]["cntr_code"], "ATL")
        self.assertEqual(political_props["ATLSHL_adriatica_4"]["cntr_code"], "ATL")
        self.assertIn(political_props["ATLSHL_adriatica_4"].get("interactive"), (False, None))

    def test_build_runtime_topology_state_keeps_water_stage_artifacts_in_full_state(self) -> None:
        source = Path(tno_bundle.__file__).read_text(encoding="utf-8")
        self.assertRegex(
            source,
            re.compile(
                r'full_state = \{\s*\*\*countries_state,\s*\*\*water_state,\s*\}',
                re.S,
            ),
        )

    def test_validate_runtime_topology_water_outputs_uses_strong_validator_without_chunk_gate(self) -> None:
        report = {"checks": {}}
        runtime_topology_payload = {"type": "Topology", "objects": {}, "arcs": []}
        water_feature_collection = {"type": "FeatureCollection", "features": []}
        named_water_snapshot_payload = {"type": "FeatureCollection", "features": []}

        with (
            patch.object(tno_bundle, "build_tno_water_geometry_report", return_value=report) as build_report_mock,
            patch.object(tno_bundle, "validate_tno_water_geometry_report", return_value=report) as validate_report_mock,
        ):
            result = validate_runtime_topology_water_outputs(
                runtime_topology_payload,
                water_feature_collection,
                named_water_snapshot_payload,
            )

        self.assertIs(result, report)
        build_report_mock.assert_called_once_with(
            scenario_id=tno_bundle.SCENARIO_ID,
            source_water=water_feature_collection,
            runtime_topology_payload=runtime_topology_payload,
            named_water_snapshot=named_water_snapshot_payload,
        )
        validate_report_mock.assert_called_once_with(
            report,
            stage_label="runtime_topology.scenario_water",
            require_chunks=False,
        )

    def test_named_water_specs_include_regression_probe_supplements(self) -> None:
        spec_map = {
            spec["id"]: spec
            for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
        }

        for feature_id, point in (
            ("tno_poole_bay", Point(-1.86, 50.62)),
            ("tno_cardigan_bay", Point(-4.63, 52.12)),
            ("tno_humber_estuary", Point(-0.18, 53.63)),
            ("tno_greenland_sea", Point(-1.73, 76.73)),
            ("tno_ross_sea", Point(-168.0911, -78.5673)),
        ):
            supplement_bboxes = tuple(spec_map[feature_id].get("supplement_bboxes") or ())
            self.assertTrue(
                any(
                    bbox[0] <= point.x <= bbox[2] and bbox[1] <= point.y <= bbox[3]
                    for bbox in supplement_bboxes
                ),
                f"{feature_id} should keep a supplement bbox covering validator regression probe {point.wkt}",
            )

    def test_tno_arctic_open_ocean_split_boundary_matches_barents_regression(self) -> None:
        arctic_spec = next(
            spec for spec in tno_bundle.TNO_OPEN_OCEAN_SPLIT_SPECS
            if spec["source_id"] == "marine_arctic_ocean"
        )
        western_child, eastern_child = arctic_spec["children"]
        self.assertEqual(western_child["bbox"][2], tno_bundle.TNO_ARCTIC_SPLIT_LONGITUDE)
        self.assertEqual(eastern_child["bbox"][0], tno_bundle.TNO_ARCTIC_SPLIT_LONGITUDE)

        barents_spec = next(
            spec for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
            if spec["id"] == "tno_barents_sea"
        )
        self.assertIn(
            (0.0, 79.5, tno_bundle.TNO_ARCTIC_SPLIT_LONGITUDE, 82.2),
            tuple(barents_spec.get("supplement_bboxes") or ()),
        )

        cardigan_spec = next(
            spec for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
            if spec["id"] == "tno_cardigan_bay"
        )
        self.assertFalse(cardigan_spec.get("supplement_respects_land_mask", True))
        self.assertFalse(cardigan_spec.get("clip_against_land_mask", True))

        humber_spec = next(
            spec for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
            if spec["id"] == "tno_humber_estuary"
        )
        self.assertFalse(humber_spec.get("clip_against_land_mask", True))

    def test_named_water_specs_include_seam_repair_supplements(self) -> None:
        spec_map = {
            spec["id"]: spec
            for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
        }
        self.assertTrue(
            any(bbox[0] <= 55.821 <= bbox[2] and bbox[1] <= 25.711 <= bbox[3] for bbox in spec_map["tno_gulf_of_oman"].get("supplement_bboxes") or ()),
        )
        self.assertTrue(
            any(bbox[0] <= 55.821 <= bbox[2] and bbox[1] <= 25.711 <= bbox[3] for bbox in spec_map["tno_persian_gulf"].get("supplement_bboxes") or ()),
        )
        self.assertTrue(
            any(bbox[0] <= 105.236 <= bbox[2] and bbox[1] <= 8.743 <= bbox[3] for bbox in spec_map["tno_gulf_of_thailand"].get("supplement_bboxes") or ()),
        )
        self.assertTrue(
            any(bbox[0] <= 128.689 <= bbox[2] and bbox[1] <= 2.494 <= bbox[3] for bbox in spec_map["tno_halmahera_sea"].get("supplement_bboxes") or ()),
        )

    def test_macro_named_seas_keep_validator_probes_without_extra_supplements(self) -> None:
        spec_map = {
            spec["id"]: spec
            for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
        }
        snapshot_payload = json.loads(
            (Path(tno_bundle.SCENARIO_DIR) / "derived" / "marine_regions_named_waters.snapshot.geojson").read_text(
                encoding="utf-8"
            )
        )
        snapshot_feature_map = {
            str(feature.get("properties", {}).get("id") or "").strip(): feature
            for feature in snapshot_payload.get("features", [])
            if str(feature.get("properties", {}).get("id") or "").strip()
        }

        for feature_id, point in (
            ("tno_labrador_sea", Point(-52.7329, 53.9977)),
            ("tno_gulf_of_alaska", Point(-147.3894, 57.3575)),
            ("tno_tasman_sea", Point(160.0, -31.8)),
        ):
            self.assertEqual(tuple(spec_map[feature_id].get("supplement_bboxes") or ()), ())
            snapshot_feature = snapshot_feature_map[feature_id]
            snapshot_geom = tno_bundle.normalize_polygonal(shape(snapshot_feature.get("geometry")))
            self.assertIsNotNone(snapshot_geom)
            self.assertTrue(
                snapshot_geom.contains(point) or snapshot_geom.touches(point),
                f"{feature_id} snapshot geometry should already cover validator probe {point.wkt}",
            )

    def test_clip_named_water_features_to_land_mask_removes_macro_land_overlap(self) -> None:
        named_features = [
            {
                "type": "Feature",
                "properties": {"id": "macro-sea", "name": "Macro Sea"},
                "geometry": mapping(_square(0, 0, 4.0)),
            }
        ]
        land_mask_geom = _square(1, 1, 2.0)

        clipped_features = clip_named_water_features_to_land_mask(named_features, land_mask_geom)

        self.assertEqual(len(clipped_features), 1)
        clipped_geom = shape(clipped_features[0]["geometry"])
        self.assertTrue(clipped_geom.is_valid)
        self.assertAlmostEqual(clipped_geom.intersection(land_mask_geom).area, 0.0)

    def test_clip_named_water_features_to_land_mask_honors_detail_skip_flag(self) -> None:
        named_features = [
            {
                "type": "Feature",
                "properties": {"id": "tno_humber_estuary", "name": "Humber Estuary"},
                "geometry": mapping(_square(0, 0, 2.0)),
            }
        ]
        land_mask_geom = _square(0.5, 0.5, 1.0)

        clipped_features = clip_named_water_features_to_land_mask(named_features, land_mask_geom)

        clipped_geom = shape(clipped_features[0]["geometry"])
        self.assertAlmostEqual(clipped_geom.intersection(land_mask_geom).area, 1.0)

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

        with patch.object(tno_bundle, "validate_runtime_topology_water_outputs", return_value={"ok": True}):
            result = build_runtime_topology_state_from_countries_state(state)

        self.assertTrue(result["manifest_payload"]["performance_hints"]["scenario_relief_overlays_default"])
        self.assertEqual(
            result["manifest_payload"]["bathymetry_topology_url"],
            "data/scenarios/tno_1962/bathymetry.topo.json",
        )
        self.assertEqual(result["manifest_payload"]["summary"]["tno_bathymetry_band_count"], 1)
        self.assertEqual(result["manifest_payload"]["summary"]["tno_bathymetry_contour_count"], 1)

    def test_load_or_refresh_named_water_snapshot_backfills_derived_provenance_from_legacy_root_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "scenario"
            (scenario_dir / "derived").mkdir(parents=True, exist_ok=True)
            snapshot_payload = {"type": "FeatureCollection", "features": []}
            provenance_payload = {"generated_at": "legacy-pass"}
            (scenario_dir / "derived" / "marine_regions_named_waters.snapshot.geojson").write_text(
                json.dumps(snapshot_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            (scenario_dir / "water_regions.provenance.json").write_text(
                json.dumps(provenance_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            loaded_snapshot, loaded_provenance = tno_bundle.load_or_refresh_marine_regions_named_water_snapshot(scenario_dir)

            self.assertEqual(loaded_snapshot, snapshot_payload)
            self.assertEqual(loaded_provenance, provenance_payload)
            self.assertTrue((scenario_dir / "derived" / "water_regions.provenance.json").exists())

    def test_load_or_refresh_named_water_snapshot_backfills_derived_snapshot_from_legacy_root_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "scenario"
            (scenario_dir / "derived").mkdir(parents=True, exist_ok=True)
            snapshot_payload = {"type": "FeatureCollection", "features": [{"id": "legacy-water"}]}
            provenance_payload = {"generated_at": "derived-pass"}
            (scenario_dir / "marine_regions_named_waters.snapshot.geojson").write_text(
                json.dumps(snapshot_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            (scenario_dir / "derived" / "water_regions.provenance.json").write_text(
                json.dumps(provenance_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            loaded_snapshot, loaded_provenance = tno_bundle.load_or_refresh_marine_regions_named_water_snapshot(scenario_dir)

            self.assertEqual(loaded_snapshot, snapshot_payload)
            self.assertEqual(loaded_provenance, provenance_payload)
            self.assertTrue((scenario_dir / "derived" / "marine_regions_named_waters.snapshot.geojson").exists())

    def test_startup_bundle_assets_stage_rebuilds_support_assets_when_locales_or_aliases_are_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            (checkpoint_dir / tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME).write_text(
                json.dumps({"type": "Topology", "objects": {}}, ensure_ascii=False),
                encoding="utf-8",
            )

            with (
                patch.object(tno_bundle, "ensure_runtime_topology_checkpoints") as ensure_runtime_mock,
                patch.object(tno_bundle, "build_startup_support_assets_stage") as support_stage_mock,
                patch.object(tno_bundle, "build_startup_bundles") as build_startup_bundles_mock,
                patch.object(tno_bundle, "_record_checkpoint_stage_outputs") as record_outputs_mock,
            ):
                tno_bundle.build_startup_bundle_assets_stage(
                    scenario_dir,
                    checkpoint_dir,
                    refresh_named_water_snapshot=False,
                )

            ensure_runtime_mock.assert_called_once()
            support_stage_mock.assert_called_once_with(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=False,
            )
            build_startup_bundles_mock.assert_called_once()
            record_outputs_mock.assert_called_once()

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
        geometries = topology_payload.get("objects", {}).get("political", {}).get("geometries", [])
        feature_ids = [
            str((geometry.get("properties", {}) or {}).get("id") or "").strip()
            for geometry in geometries
        ]
        polar_diagnostics = build_polar_feature_diagnostics_from_topology(topology_payload, "political")
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
        self.assertIn("derived/marine_regions_named_waters.snapshot.geojson", scenario_data)
        self.assertIn("derived/water_regions.provenance.json", scenario_data)
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
            "MON": "#666057",
            "PAK": "#21331e",
            "SHX": "#955a74",
            "SOV": "#7d0d18",
            "TIB": "#c8c8c8",
            "VIN": "#a76286",
            "XIK": "#6873a0",
            "XIN": "#5f8e9c",
            "YUN": "#763446",
        }

        for tag, color_hex in expected_colors.items():
            self.assertEqual(resolve_tno_palette_color(tag, {}), color_hex)

    def test_patch_tno_palette_defaults_patches_selected_tno_baseline_entries(self) -> None:
        countries_payload = {
            "countries": {
                "LIB": {
                    "tag": "LIB",
                    "display_name": "Liberia",
                    "color_hex": "#9882bf",
                    "source_type": "tno_baseline",
                    "continent_id": "continent_africa",
                },
                "JOR": {
                    "tag": "JOR",
                    "display_name": "Italian Transjordan",
                    "color_hex": "#486b3a",
                    "source_type": "tno_baseline",
                    "continent_id": "continent_asia",
                },
                "FRA": {
                    "tag": "FRA",
                    "display_name": "France",
                    "color_hex": "#111111",
                    "source_type": "tno_baseline",
                    "continent_id": "continent_europe",
                },
                "SOV": {
                    "tag": "SOV",
                    "display_name": "Soviet Union",
                    "color_hex": "#111111",
                    "source_type": "tno_baseline",
                    "continent_id": "continent_europe",
                },
                "ARM": {
                    "tag": "ARM",
                    "display_name": "Armenia",
                    "color_hex": "#b066b4",
                    "source_type": "scenario_extension",
                    "continent_id": "continent_asia",
                },
            }
        }
        manifest_payload = {"style_defaults": {}}

        patch_tno_palette_defaults(countries_payload, manifest_payload)

        self.assertEqual(countries_payload["countries"]["LIB"]["color_hex"], "#78828c")
        self.assertEqual(countries_payload["countries"]["JOR"]["color_hex"], "#486b3a")
        self.assertEqual(countries_payload["countries"]["FRA"]["color_hex"], "#0f0f65")
        self.assertEqual(countries_payload["countries"]["SOV"]["color_hex"], "#7d0d18")
        self.assertEqual(countries_payload["countries"]["ARM"]["color_hex"], "#b066b4")
        self.assertEqual(manifest_payload["palette_id"], "tno")

    def test_apply_tno_decolonization_metadata_sets_explicit_raj_color(self) -> None:
        countries_payload = {
            "countries": {
                "BZ": {"tag": "BZ", "display_name": "Belize", "color_hex": "#111111", "continent_id": "continent_north_america", "continent_label": "North America", "subregion_id": "subregion_central_america", "subregion_label": "Central America", "base_iso2": "BZ", "lookup_iso2": "BZ", "provenance_iso2": "BZ"},
                "GY": {"tag": "GY", "display_name": "Guyana", "color_hex": "#111111", "continent_id": "continent_south_america", "continent_label": "South America", "subregion_id": "subregion_south_america", "subregion_label": "South America", "base_iso2": "GY", "lookup_iso2": "GY", "provenance_iso2": "GY"},
                "MC": {"tag": "MC", "display_name": "Macau", "color_hex": "#111111", "continent_id": "continent_asia", "continent_label": "Asia", "subregion_id": "subregion_eastern_asia", "subregion_label": "Eastern Asia", "base_iso2": "MO", "lookup_iso2": "MO", "provenance_iso2": "MO"},
                "CEY": {"tag": "CEY", "display_name": "Ceylon", "color_hex": "#111111", "continent_id": "continent_asia", "continent_label": "Asia", "subregion_id": "subregion_southern_asia", "subregion_label": "Southern Asia", "base_iso2": "LK", "lookup_iso2": "LK", "provenance_iso2": "LK", "source_type": "scenario_extension", "historical_fidelity": "tno_baseline"},
                "AST": {"tag": "AST", "display_name": "Australia", "color_hex": "#111111", "continent_id": "continent_oceania", "continent_label": "Oceania", "subregion_id": "subregion_melanesia", "subregion_label": "Melanesia", "base_iso2": "PG", "lookup_iso2": "PG", "provenance_iso2": "PG", "source_type": "scenario_extension", "historical_fidelity": "tno_baseline"},
                "BWA": {"tag": "BWA", "display_name": "British West Africa", "color_hex": "#111111", "continent_id": "continent_africa", "continent_label": "Africa", "subregion_id": "subregion_western_africa", "subregion_label": "Western Africa", "base_iso2": "NG", "lookup_iso2": "NG", "provenance_iso2": "NG", "source_type": "scenario_extension", "historical_fidelity": "tno_baseline"},
                "RAJ": {"tag": "RAJ", "display_name": "British Raj", "color_hex": "#111111", "continent_id": "continent_asia", "continent_label": "Asia", "subregion_id": "subregion_southern_asia", "subregion_label": "Southern Asia", "base_iso2": "IN", "lookup_iso2": "IN", "provenance_iso2": "IN", "parent_owner_tag": "ENG", "parent_owner_tags": ["ENG"], "subject_kind": "raj", "entry_kind": "scenario_subject", "source_type": "tno_baseline", "historical_fidelity": "tno_baseline"},
                "SAF": {"tag": "SAF", "display_name": "South Africa", "color_hex": "#111111", "continent_id": "continent_africa", "continent_label": "Africa", "subregion_id": "subregion_southern_africa", "subregion_label": "Southern Africa", "base_iso2": "ZA", "lookup_iso2": "ZA", "provenance_iso2": "ZA", "source_type": "scenario_extension", "historical_fidelity": "tno_baseline"},
            }
        }

        apply_tno_decolonization_metadata(countries_payload)

        raj_entry = countries_payload["countries"]["RAJ"]
        self.assertEqual(raj_entry["color_hex"], "#cc5668")
        self.assertEqual(raj_entry["entry_kind"], "scenario_country")
        self.assertEqual(raj_entry["parent_owner_tag"], "")
        self.assertEqual(raj_entry["subject_kind"], "")

    def test_second_wave_color_sources_match_expected_targets(self) -> None:
        manual_overrides = json.loads(
            Path("data/scenarios/tno_1962/scenario_manual_overrides.json").read_text(encoding="utf-8")
        )
        east_asia_rules = json.loads(
            Path("data/scenario-rules/tno_1962.east_asia_ownership.manual.json").read_text(encoding="utf-8")
        )

        self.assertEqual(
            tno_bundle.TNO_1962_MANUAL_COUNTRY_OVERRIDES["KOR"]["color_hex"],
            "#009163",
        )
        gng_rule = next(
            rule for rule in east_asia_rules["country_rules"]
            if rule.get("rule_id") == "japan_guangdong_client_1962"
        )
        self.assertEqual(gng_rule["color_hex"], "#7A2E41")
        self.assertEqual(manual_overrides["countries"]["MAG"]["color_hex"], "#cac6b2")
        self.assertEqual(manual_overrides["countries"]["ONG"]["color_hex"], "#51875b")
        self.assertEqual(manual_overrides["countries"]["GAY"]["color_hex"], "#4b4150")

    def test_second_wave_runtime_colors_match_tno_audit_targets(self) -> None:
        countries_payload = json.loads(
            Path("data/scenarios/tno_1962/countries.json").read_text(encoding="utf-8")
        )["countries"]
        audit_entries = json.loads(
            Path("data/palette-maps/tno.audit.json").read_text(encoding="utf-8")
        )["entries"]

        expected_tags = ["KOR", "GNG", "MAG", "ONG", "GAY"]
        for tag in expected_tags:
            self.assertEqual(
                countries_payload[tag]["color_hex"],
                audit_entries[tag]["map_hex"],
            )

    def test_final_wave_runtime_colors_match_tno_audit_targets(self) -> None:
        countries_payload = json.loads(
            Path("data/scenarios/tno_1962/countries.json").read_text(encoding="utf-8")
        )["countries"]
        audit_entries = json.loads(
            Path("data/palette-maps/tno.audit.json").read_text(encoding="utf-8")
        )["entries"]

        expected_tags = ["PRC", "SIC", "SIK", "TIB", "XIK"]
        for tag in expected_tags:
            self.assertEqual(
                countries_payload[tag]["color_hex"],
                audit_entries[tag]["map_hex"],
            )

    def test_final_wave_runtime_entries_keep_expected_sources_and_entry_kinds(self) -> None:
        countries = json.loads(
            Path("data/scenarios/tno_1962/countries.json").read_text(encoding="utf-8")
        )["countries"]

        self.assertEqual(countries["PRC"]["entry_kind"], "controller_only")
        self.assertEqual(countries["PRC"]["primary_rule_source"], "tno_1962_controller_only_prc")

        self.assertEqual(countries["SIC"]["entry_kind"], "controller_only")
        self.assertEqual(countries["SIC"]["primary_rule_source"], "tno_1962_controller_only_sic")

        self.assertEqual(countries["SIK"]["entry_kind"], "controller_only")
        self.assertEqual(countries["SIK"]["primary_rule_source"], "tno_1962_controller_only_sik")

        self.assertEqual(countries["TIB"]["entry_kind"], "scenario_subject")
        self.assertEqual(countries["TIB"]["primary_rule_source"], "japan_tibet_client_1962")

        self.assertEqual(countries["XIK"]["entry_kind"], "scenario_country")
        self.assertEqual(countries["XIK"]["primary_rule_source"], "dev_manual_tag_create")

    def test_tno_runtime_country_colors_follow_mixed_palette_policy(self) -> None:
        countries = json.loads(
            Path("data/scenarios/tno_1962/countries.json").read_text(encoding="utf-8")
        )["countries"]
        audit_entries = json.loads(
            Path("data/palette-maps/tno.audit.json").read_text(encoding="utf-8")
        )["entries"]

        explicit_scenario_color_tags = {
            "PHI": "#5b83a4",
            "MAL": "#d39d80",
            "LAO": "#c7a18d",
            "ARM": "#b066b4",
            "BRG": "#1a1a1a",
        }
        palette_priority_tags = {
            "KAZ": "#aa233c",
            "UZB": "#9b2b40",
            "ANG": "#c15e5e",
            "MZB": "#492a25",
            "RWA": "#438f00",
            "ZAM": "#9666a7",
            "ZIM": "#004a00",
            "EGY": "#89bb78",
            "TUN": "#b54613",
            "LBA": "#bcc2a3",
            "MAD": "#3d5069",
            "MOR": "#ac8b6c",
        }

        mismatches = []
        for tag, country_entry in countries.items():
            audit_entry = audit_entries.get(tag, {})
            audit_hex = str(audit_entry.get("map_hex") or "").strip().lower()
            country_hex = str(country_entry.get("color_hex") or "").strip().lower()

            if tag in explicit_scenario_color_tags:
                self.assertEqual(country_hex, explicit_scenario_color_tags[tag])
                continue
            if tag in palette_priority_tags:
                self.assertEqual(country_hex, palette_priority_tags[tag])
                self.assertEqual(country_hex, audit_hex)
                continue
            if not audit_hex:
                continue
            if country_hex != audit_hex:
                mismatches.append((tag, country_hex, audit_hex))

        self.assertEqual(mismatches, [])

    def test_tno_palette_audit_sync_keeps_explicit_scenario_color_exceptions(self) -> None:
        source = Path("tools/patch_tno_1962_bundle.py").read_text(encoding="utf-8")
        for tag in ["PHI", "MAL", "LAO", "ARM", "BRG"]:
            self.assertIn(f'    "{tag}",', source)

    def test_scenario_manager_keeps_active_scenario_colors_tag_scoped(self) -> None:
        manager_source = Path("js/core/scenario_manager.js").read_text(encoding="utf-8")
        bundle_loader_source = Path("js/core/scenario/bundle_loader.js").read_text(encoding="utf-8")
        self.assertNotIn("buildScenarioRuntimeDefaultTagColors", manager_source)
        self.assertNotIn("buildRuntimeDefaultColorsByIso2", manager_source)
        self.assertIn("function getScenarioFixedOwnerColors(", manager_source)
        self.assertIn("function getScenarioFixedOwnerColors(countryMap = {})", bundle_loader_source)
        self.assertIn("next[normalizedTag] = color;", bundle_loader_source)

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

    def test_rebuild_feature_maps_skips_runtime_shell_fragments_before_explicit_or_source_map_resolution(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {"id": "RU_ARCTIC_FB_001", "name": "Russia Shell Fallback 1", "geometry": _square(0, 0)},
                {"id": "F-1", "name": "Alpha", "geometry": _square(2, 0)},
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )

        owners_payload, controllers_payload, cores_payload = rebuild_feature_maps_from_political_gdf(
            political_gdf,
            source_feature_id_by_new_id={"RU_ARCTIC_FB_001": "SRC-SHELL", "F-1": "SRC-F1"},
            source_owners={"SRC-SHELL": "SOV", "SRC-F1": "AAA"},
            source_controllers={"SRC-SHELL": "SOV", "SRC-F1": "AAA"},
            source_cores={"SRC-SHELL": ["SOV"], "SRC-F1": ["AAA"]},
            explicit_assignments={"RU_ARCTIC_FB_001": {"owner": "SOV", "controller": "SOV", "core": ["SOV"]}},
        )

        self.assertEqual(owners_payload["owners"], {"F-1": "AAA"})
        self.assertEqual(controllers_payload["controllers"], {"F-1": "AAA"})
        self.assertEqual(cores_payload["cores"], {"F-1": ["AAA"]})

    def test_apply_tno_feature_assignment_overrides_rejects_runtime_shell_fragments(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {"id": "RU_ARCTIC_FB_096", "name": "Russia Shell Fallback 96", "geometry": _square(0, 0)},
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        original_overrides = tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES
        tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = {"TAT": ["RU_ARCTIC_FB_096"]}
        try:
            with self.assertRaisesRegex(ValueError, "cannot target runtime shell fragments"):
                apply_tno_feature_assignment_overrides(
                    owners_payload={"owners": {}},
                    controllers_payload={"controllers": {}},
                    cores_payload={"cores": {}},
                    scenario_political_gdf=political_gdf,
                )
        finally:
            tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = original_overrides

    def test_apply_tno_feature_assignment_overrides_preserves_atlisl_runtime_country_code(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {
                    "id": "ATLISL_tyrrhenian_corsica",
                    "name": "Corsica",
                    "cntr_code": "ATL",
                    "geometry": _square(0, 0),
                },
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        original_overrides = tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES
        tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = {"ITA": ["ATLISL_tyrrhenian_corsica"]}
        try:
            owners_payload = {"owners": {}}
            controllers_payload = {"controllers": {}}
            cores_payload = {"cores": {}}

            diagnostics = apply_tno_feature_assignment_overrides(
                owners_payload=owners_payload,
                controllers_payload=controllers_payload,
                cores_payload=cores_payload,
                scenario_political_gdf=political_gdf,
            )

            self.assertEqual(diagnostics["feature_count"], 1)
            self.assertEqual(owners_payload["owners"]["ATLISL_tyrrhenian_corsica"], "ITA")
            self.assertEqual(controllers_payload["controllers"]["ATLISL_tyrrhenian_corsica"], "ITA")
            self.assertEqual(cores_payload["cores"]["ATLISL_tyrrhenian_corsica"], ["ITA"])
            self.assertEqual(political_gdf.iloc[0]["cntr_code"], "ATL")
        finally:
            tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = original_overrides

    def test_apply_tno_owner_only_backfill_updates_only_owners_and_runtime_cntr_code(self) -> None:
        feature_ids = list(TNO_1962_OWNER_ONLY_BACKFILL.keys())
        political_gdf = gpd.GeoDataFrame(
            [
                {"id": feature_id, "name": feature_id, "cntr_code": "OLD", "geometry": _square(float(index), 0.0)}
                for index, feature_id in enumerate(feature_ids)
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        owners_payload = {"owners": {feature_id: "OLD" for feature_id in feature_ids}}
        controllers_payload = {"controllers": {feature_id: "KEEP" for feature_id in feature_ids}}
        cores_payload = {"cores": {feature_id: ["KEEP"] for feature_id in feature_ids}}

        diagnostics = apply_tno_owner_only_backfill(owners_payload, political_gdf)

        self.assertEqual(diagnostics["feature_count"], len(TNO_1962_OWNER_ONLY_BACKFILL))
        for feature_id, expected_owner in TNO_1962_OWNER_ONLY_BACKFILL.items():
            self.assertEqual(owners_payload["owners"][feature_id], expected_owner)
            self.assertEqual(controllers_payload["controllers"][feature_id], "KEEP")
            self.assertEqual(cores_payload["cores"][feature_id], ["KEEP"])
        runtime_owner_map = dict(zip(political_gdf["id"], political_gdf["cntr_code"]))
        for feature_id, expected_owner in TNO_1962_OWNER_ONLY_BACKFILL.items():
            self.assertEqual(runtime_owner_map[feature_id], expected_owner)

    def test_checked_in_tno_1962_owner_only_backfill_touchset_keeps_checked_in_data_consistent(self) -> None:
        scenario_dir = Path(tno_bundle.SCENARIO_DIR)
        owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
        countries_payload = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))

        owners = owners_payload["owners"]
        countries = countries_payload["countries"]
        for feature_id in TNO_1962_OWNER_ONLY_BACKFILL:
            self.assertIn(feature_id, owners, feature_id)

        affected_tags = sorted(
            {
                *TNO_1962_OWNER_ONLY_BACKFILL.values(),
                *(str(owners.get(feature_id) or "").strip() for feature_id in TNO_1962_OWNER_ONLY_BACKFILL),
            }
        )
        owner_counts = Counter(str(owner or "").strip() for owner in owners.values())
        for tag in affected_tags:
            self.assertEqual(countries.get(tag, {}).get("feature_count"), owner_counts[tag], tag)

    def test_checked_in_tno_1962_atlisl_runtime_contract_stays_consistent(self) -> None:
        scenario_dir = Path(tno_bundle.SCENARIO_DIR)
        owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
        runtime_topology = json.loads((scenario_dir / "runtime_topology.topo.json").read_text(encoding="utf-8"))

        owners = owners_payload["owners"]
        political_geometries = runtime_topology["objects"]["political"]["geometries"]
        atlisl_props = [
            geometry.get("properties", {})
            for geometry in political_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLISL_")
        ]
        atlshl_props = [
            geometry.get("properties", {})
            for geometry in political_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLSHL_")
        ]

        self.assertTrue(atlisl_props)
        for props in atlisl_props:
            feature_id = props["id"]
            self.assertIn(feature_id, owners, feature_id)
            self.assertEqual(props.get("cntr_code"), "ATL", feature_id)
            self.assertIs(props.get("interactive"), True, feature_id)
        for props in atlshl_props:
            self.assertIs(props.get("interactive"), False, props.get("id"))

    def test_atlantropa_west_med_owner_overrides_use_existing_algeria_subject_tags(self) -> None:
        overrides = ATLANTROPA_REGION_CONFIGS["west_med"]["state_owner_overrides"]

        self.assertEqual(overrides[8454], "ALC")
        self.assertEqual(overrides[8465], "IAL")
        self.assertNotIn("ALG", set(overrides.values()))

    def test_checkpoint_build_lock_is_reentrant_and_cleans_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            lock_path = checkpoint_dir / tno_bundle.CHECKPOINT_BUILD_LOCK_FILENAME

            with tno_bundle._checkpoint_build_lock(checkpoint_dir):
                self.assertTrue(lock_path.exists())
                with tno_bundle._checkpoint_build_lock(checkpoint_dir):
                    self.assertTrue(lock_path.exists())

            self.assertFalse(lock_path.exists())

    def test_checkpoint_build_lock_rejects_same_thread_different_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            checkpoint_dir = Path(tmp_dir) / "checkpoint"

            with tno_bundle._checkpoint_build_lock(checkpoint_dir, transaction_id="tx-1"):
                with self.assertRaisesRegex(RuntimeError, "another build is in progress"):
                    with tno_bundle._checkpoint_build_lock(checkpoint_dir, transaction_id="tx-2"):
                        self.fail("lock acquisition should have been blocked")

    def test_checkpoint_build_lock_rejects_different_thread_same_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            errors: list[str] = []

            def worker() -> None:
                try:
                    with tno_bundle._checkpoint_build_lock(checkpoint_dir, transaction_id="tx-1"):
                        pass
                except RuntimeError as exc:
                    errors.append(str(exc))

            with tno_bundle._checkpoint_build_lock(checkpoint_dir, transaction_id="tx-1"):
                thread = threading.Thread(target=worker)
                thread.start()
                thread.join(timeout=5)

            self.assertTrue(errors)
            self.assertIn("another build is in progress", errors[0])

    def test_checkpoint_build_lock_blocks_when_lock_file_already_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            lock_path = checkpoint_dir / tno_bundle.CHECKPOINT_BUILD_LOCK_FILENAME
            lock_path.write_text(
                json.dumps({"pid": 424242, "checkpoint_dir": str(checkpoint_dir)}, ensure_ascii=False),
                encoding="utf-8",
            )

            with patch.object(tno_bundle, "_pid_is_alive", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "another build is in progress"):
                    with tno_bundle._checkpoint_build_lock(checkpoint_dir):
                        self.fail("lock acquisition should have been blocked")

    def test_checkpoint_build_lock_removes_stale_lock_before_acquiring(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            lock_path = checkpoint_dir / tno_bundle.CHECKPOINT_BUILD_LOCK_FILENAME
            lock_path.write_text(
                json.dumps({"pid": 999999, "checkpoint_dir": str(checkpoint_dir)}, ensure_ascii=False),
                encoding="utf-8",
            )

            with patch.object(tno_bundle, "_pid_is_alive", return_value=False):
                with tno_bundle._checkpoint_build_lock(checkpoint_dir):
                    self.assertTrue(lock_path.exists())

            self.assertFalse(lock_path.exists())

    def test_resolve_tno_root_prefers_cli_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "tno_root"
            (root / "map").mkdir(parents=True, exist_ok=True)
            (root / "history/states").mkdir(parents=True, exist_ok=True)
            (root / "map/provinces.bmp").write_bytes(b"bmp")
            (root / "map/definition.csv").write_text("0;0;0;0;land;false;unknown;0\n", encoding="utf-8")
            (root / "history/states/163-Dalmatia.txt").write_text("state={}", encoding="utf-8")

            with patch.object(tno_bundle, "_CLI_TNO_ROOT_OVERRIDE", root):
                resolved = tno_bundle.resolve_tno_root()

            self.assertEqual(resolved, root)

    def test_resolve_hgo_root_supports_env_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "hgo_root"
            (root / "map").mkdir(parents=True, exist_ok=True)
            (root / "history/states").mkdir(parents=True, exist_ok=True)
            (root / "map/provinces.bmp").write_bytes(b"bmp")
            (root / "map/definition.csv").write_text("0;0;0;0;land;false;unknown;0\n", encoding="utf-8")

            with patch.dict(os.environ, {tno_bundle.HGO_ROOT_ENV_VAR: str(root)}, clear=False):
                with patch.object(tno_bundle, "_CLI_HGO_ROOT_OVERRIDE", None):
                    resolved = tno_bundle.resolve_hgo_root()

            self.assertEqual(resolved, root)

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

    def test_scenario_bundle_contracts_define_startup_and_chunk_stages(self) -> None:
        descriptors = {descriptor.name: descriptor for descriptor in SCENARIO_BUNDLE_STAGE_DESCRIPTORS}

        self.assertIn("startup_assets", descriptors)
        self.assertIn("chunk_assets", descriptors)
        self.assertIn("water_state", descriptors)
        self.assertEqual(descriptors["geo_locale"].outputs, ("geo locale checkpoint variants",))
        self.assertEqual(descriptors["water_state"].outputs, ("water state checkpoint artifacts",))
        self.assertEqual(descriptors["startup_assets"].outputs, ("startup bootstrap topology", "startup bundles"))
        self.assertEqual(descriptors["chunk_assets"].outputs, ("published scenario chunk assets",))

    def test_ensure_water_stage_checkpoints_builds_water_outputs_from_existing_countries_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            with (
                patch.object(tno_bundle.scenario_bundle_platform, "all_checkpoint_files_exist", side_effect=[False, True]),
                patch.object(tno_bundle, "build_countries_stage_state") as build_countries_mock,
                patch.object(tno_bundle, "write_countries_stage_checkpoints") as write_countries_mock,
                patch.object(tno_bundle, "build_water_stage_state") as build_water_mock,
                patch.object(tno_bundle, "write_water_stage_checkpoints") as write_water_mock,
            ):
                ensure_water_stage_checkpoints(scenario_dir, checkpoint_dir)

            build_countries_mock.assert_not_called()
            write_countries_mock.assert_not_called()
            build_water_mock.assert_called_once_with(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=False,
            )
            write_water_mock.assert_called_once()

    def test_build_geo_locale_stage_stops_before_startup_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            with (
                patch.object(tno_bundle, "ensure_runtime_topology_checkpoints") as ensure_runtime_mock,
                patch.object(tno_bundle, "build_tno_geo_locale_patch") as build_geo_mock,
                patch.object(tno_bundle, "ensure_geo_locale_variant_checkpoints") as ensure_variant_mock,
                patch.object(tno_bundle, "validate_geo_locale_checkpoint") as validate_geo_mock,
                patch.object(tno_bundle, "build_startup_bootstrap_assets") as build_bootstrap_mock,
                patch.object(tno_bundle, "build_startup_bundles") as build_bundles_mock,
            ):
                build_geo_locale_stage(scenario_dir, checkpoint_dir)

            ensure_runtime_mock.assert_called_once()
            build_geo_mock.assert_called_once()
            ensure_variant_mock.assert_called_once_with(checkpoint_dir)
            validate_geo_mock.assert_called_once()
            build_bootstrap_mock.assert_not_called()
            build_bundles_mock.assert_not_called()

    def test_build_startup_assets_stage_builds_startup_outputs_independently(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            with (
                patch.object(tno_bundle, "build_startup_support_assets_stage") as build_support_mock,
                patch.object(tno_bundle, "build_startup_bundle_assets_stage") as build_bundle_mock,
            ):
                build_startup_assets_stage(scenario_dir, checkpoint_dir)

            build_support_mock.assert_called_once_with(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=False,
            )
            build_bundle_mock.assert_called_once_with(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=False,
            )

    def test_write_bundle_stage_no_longer_rebuilds_chunk_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            with (
                patch.object(
                    tno_bundle.scenario_bundle_publish_service,
                    "publish_scenario_build_in_locked_session",
                ) as publish_service_mock,
                patch.object(tno_bundle, "rebuild_published_scenario_chunk_assets") as rebuild_chunk_mock,
            ):
                write_bundle_stage(
                    scenario_dir,
                    checkpoint_dir,
                    publish_scope="scenario_data",
                    manual_sync_policy=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
                )

            publish_service_mock.assert_called_once()
            rebuild_chunk_mock.assert_not_called()

    def test_build_chunk_assets_stage_requires_published_inputs_and_runs_chunk_builder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            with (
                patch.object(tno_bundle.scenario_bundle_platform, "require_chunk_stage_publish_inputs") as require_chunk_mock,
                patch.object(tno_bundle, "rebuild_published_scenario_chunk_assets") as rebuild_chunk_mock,
            ):
                build_chunk_assets_stage(scenario_dir, checkpoint_dir)

            require_chunk_mock.assert_called_once_with(scenario_dir)
            rebuild_chunk_mock.assert_called_once_with(scenario_dir, checkpoint_dir)

    def test_run_changed_domain_plan_for_geo_locale_uses_planner_targets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "scenario"
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            executed_stages: list[str] = []

            def fake_run_single_stage(stage: str, **kwargs):
                executed_stages.append(stage)
                return None

            with (
                patch.object(tno_bundle, "_stage_signature_is_current", return_value=False),
                patch.object(tno_bundle, "_run_single_stage", side_effect=fake_run_single_stage),
                patch.object(tno_bundle.scenario_publish_service, "publish_scenario_outputs") as publish_mock,
            ):
                result = tno_bundle._run_changed_domain_plan(
                    changed_domain="geo-locale",
                    scenario_dir=scenario_dir,
                    checkpoint_dir=checkpoint_dir,
                    publish_scope="all",
                    manual_sync_policy=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
                    refresh_named_water_snapshot=False,
                )

            self.assertEqual(executed_stages, ["geo_locale", "startup_support_assets"])
            self.assertEqual(
                [call.kwargs["target"] for call in publish_mock.call_args_list],
                ["geo-locale", "startup-support-assets"],
            )
            self.assertEqual(result["published_targets"], ["geo-locale", "startup-support-assets"])

    def test_stage_signature_is_never_reused_for_forced_water_snapshot_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "scenario"
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value={"signature": "same"}),
                patch.object(tno_bundle, "_build_stage_signature_entry", return_value={"signature": "same"}),
            ):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_WATER_STATE,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                        refresh_named_water_snapshot=True,
                    )
                )

    def test_main_runtime_topology_stage_builds_missing_water_stage_first(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "scenario"
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            args = type(
                "Args",
                (),
                {
                    "stage": tno_bundle.STAGE_RUNTIME_TOPOLOGY,
                    "changed_domain": "",
                    "checkpoint_dir": str(checkpoint_dir),
                    "scenario_dir": str(scenario_dir),
                    "tno_root": None,
                    "hgo_root": None,
                    "publish_scope": "all",
                    "manual_sync_policy": MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
                    "refresh_named_water_snapshot": False,
                },
            )()

            with (
                patch.object(tno_bundle, "parse_args", return_value=args),
                patch.object(tno_bundle, "_scenario_build_session_lock", return_value=nullcontext()),
                patch.object(tno_bundle, "_checkpoint_build_lock", return_value=nullcontext()),
                patch.object(tno_bundle, "ensure_water_stage_checkpoints") as ensure_water_mock,
                patch.object(tno_bundle, "build_runtime_topology_stage", return_value={"owner_baseline_hash": "x", "owners_payload": {"owners": {}}, "runtime_water_regions": {"features": []}, "context_land_mask_arc_refs": 0}) as build_runtime_mock,
                patch.object(tno_bundle, "write_runtime_topology_stage_checkpoints") as write_runtime_mock,
                patch.object(tno_bundle, "print_bundle_summary") as print_summary_mock,
            ):
                tno_bundle.main()

            ensure_water_mock.assert_called_once_with(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=False,
            )
            build_runtime_mock.assert_called_once_with(checkpoint_dir)
            write_runtime_mock.assert_called_once()
            print_summary_mock.assert_called_once()

    def test_write_bundle_stage_uses_shared_scenario_build_lock(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            with (
                patch.object(tno_bundle, "_scenario_build_session_lock", return_value=nullcontext()) as session_lock_mock,
                patch.object(
                    tno_bundle.scenario_bundle_publish_service,
                    "publish_scenario_build_in_locked_session",
                ) as publish_service_mock,
            ):
                write_bundle_stage(
                    scenario_dir,
                    checkpoint_dir,
                    publish_scope=tno_bundle.PUBLISH_SCOPE_POLAR_RUNTIME,
                    manual_sync_policy=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
                )

            session_lock_mock.assert_called_once_with(scenario_dir)
            publish_service_mock.assert_called_once()

    def test_write_bundle_stage_blocks_publish_when_live_dev_server_targets_workspace(self) -> None:
        runtime_tmp_root = tno_bundle.ROOT / ".runtime" / "tmp"
        runtime_tmp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime_tmp_root) as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            _write_publish_bundle_dir(checkpoint_dir)

            with (
                patch.object(
                    tno_bundle,
                    "_load_active_server_metadata",
                    return_value={
                        "pid": 12345,
                        "cwd": str(tno_bundle.ROOT),
                        "url": "http://127.0.0.1:8810",
                    },
                ),
                patch.object(tno_bundle, "_pid_is_alive", return_value=True),
            ):
                with self.assertRaisesRegex(RuntimeError, "live dev server"):
                    write_bundle_stage(
                        scenario_dir,
                        checkpoint_dir,
                        publish_scope="scenario_data",
                        manual_sync_policy=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
                    )


if __name__ == "__main__":
    unittest.main()
