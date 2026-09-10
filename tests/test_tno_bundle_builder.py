from __future__ import annotations

from collections import Counter
from contextlib import nullcontext
import inspect
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping, shape

from map_builder.contracts import SCENARIO_BUNDLE_STAGE_DESCRIPTORS
from tools.check_scenario_contracts import validate_publish_bundle_dir
from tools.extract_scenario_atlantropa import (
    split_topology_payload as split_atlantropa_topology_payload,
    update_manifest as update_atlantropa_manifest,
)
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
    apply_tno_named_water_exclusions,
    build_context_land_mask_geometry,
    build_relief_overlays,
    build_tno_named_marginal_water_features,
    clip_named_water_features_to_land_mask,
    build_tno_bathymetry_payload,
    build_polar_feature_diagnostics_from_topology,
    build_runtime_topology_state_from_countries_state,
    build_runtime_topology_payload,
    build_chunk_assets_stage,
    build_geo_locale_stage,
    build_single_antarctic_feature,
    build_startup_assets_stage,
    compact_written_json_hash,
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


def _decode_topology_arc(topology: dict, arc_index: int) -> list[tuple[float, float]]:
    source_index = -arc_index - 1 if arc_index < 0 else arc_index
    coords = topology["arcs"][source_index]
    transform_payload = topology.get("transform") or {}
    scale = transform_payload.get("scale")
    translate = transform_payload.get("translate")
    decoded: list[tuple[float, float]] = []
    x = 0.0
    y = 0.0
    for point in coords:
        px = float(point[0])
        py = float(point[1])
        if scale and translate:
            x += px
            y += py
            decoded.append((
                (x * float(scale[0])) + float(translate[0]),
                (y * float(scale[1])) + float(translate[1]),
            ))
        else:
            decoded.append((px, py))
    if arc_index < 0:
        decoded.reverse()
    return decoded


def _decode_topology_ring(topology: dict, arc_refs: list[int]) -> list[tuple[float, float]]:
    ring: list[tuple[float, float]] = []
    for arc_ref in arc_refs:
        arc = _decode_topology_arc(topology, int(arc_ref))
        if ring and arc and ring[-1] == arc[0]:
            ring.extend(arc[1:])
        else:
            ring.extend(arc)
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def _feature_geometry_from_topology(topology: dict, object_name: str, feature_id: str):
    geometries = topology["objects"][object_name]["geometries"]
    for geometry in geometries:
        props = geometry.get("properties") or {}
        if str(props.get("id") or geometry.get("id") or "") != feature_id:
            continue
        return _geometry_from_topology_geometry(topology, geometry)
    raise AssertionError(f"feature {feature_id} not found in topology object {object_name}")


def _geometry_from_topology_geometry(topology: dict, geometry: dict):
    if geometry.get("type") == "Polygon":
        rings = [_decode_topology_ring(topology, ring_refs) for ring_refs in geometry.get("arcs") or []]
        return Polygon(rings[0], rings[1:]) if rings else Polygon()
    if geometry.get("type") == "MultiPolygon":
        polygons = []
        for polygon_refs in geometry.get("arcs") or []:
            rings = [_decode_topology_ring(topology, ring_refs) for ring_refs in polygon_refs]
            if rings:
                polygons.append(Polygon(rings[0], rings[1:]))
        return MultiPolygon(polygons)
    raise AssertionError(f"unsupported topology geometry type {geometry.get('type')}")


def _write_publish_bundle_dir(
    target_dir: Path,
    *,
    owners: dict[str, str] | None = None,
    controllers: dict[str, str] | None = None,
    cores: dict[str, object] | None = None,
    runtime_feature_ids: list[str] | None = None,
    runtime_feature_props: dict[str, dict[str, object]] | None = None,
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
                                "properties": {
                                    "id": feature_id,
                                    **((runtime_feature_props or {}).get(feature_id, {})),
                                },
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
    def test_context_land_mask_uses_fine_grained_simplification_before_precise_fallback(self) -> None:
        land_mask = Point(0, 0).buffer(10, quad_segs=128)

        _geom, tolerance, area_delta_ratio, fallback_used, arc_refs = build_context_land_mask_geometry(
            land_mask,
            target_arc_refs_min=1,
            target_arc_refs_max=2,
        )

        self.assertFalse(fallback_used)
        self.assertIsNotNone(tolerance)
        self.assertLess(area_delta_ratio, 0.005)
        self.assertLess(arc_refs, len(land_mask.exterior.coords))

    def test_context_land_mask_uses_bounded_publish_candidate_before_precise_fallback(self) -> None:
        land_mask = Polygon([
            (0, 0),
            (4, 0),
            (4, 1),
            (2.2, 1),
            (2, 1.2),
            (1.8, 1),
            (0, 1),
            (0, 0),
        ])

        _geom, tolerance, area_delta_ratio, fallback_used, arc_refs = build_context_land_mask_geometry(
            land_mask,
            tolerances=(0.5, 1.0),
            max_area_delta_ratio=0.0001,
            max_publish_area_delta_ratio=0.1,
            max_publish_preferred_tolerance=0.5,
            target_arc_refs_min=100,
            target_arc_refs_max=200,
        )

        self.assertFalse(fallback_used)
        self.assertEqual(tolerance, 0.5)
        self.assertLessEqual(area_delta_ratio, 0.1)
        self.assertLess(arc_refs, len(land_mask.exterior.coords))

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

    def test_build_runtime_topology_payload_keeps_large_overlays_out_of_shared_topology_pass(self) -> None:
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

        topology_mock.assert_not_called()

    def test_build_runtime_topology_payload_routes_atl_synthetic_features_to_scenario_atlantropa(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {
                    "id": "ATLISL_adriatica_corfu",
                    "name": "Corfu",
                    "cntr_code": "ITA",
                    "atl_join_mode": "none",
                    "interactive": True,
                    "geometry": _square(0, 0, 1.0),
                },
                {
                    "id": "ATLISL_adriatica_CRO_3",
                    "name": "Welded Adriatica",
                    "cntr_code": "CRO",
                    "atl_geometry_role": "donor_island",
                    "atl_join_mode": "boolean_weld",
                    "interactive": True,
                    "geometry": _square(1, 0, 1.0),
                },
                {
                    "id": "ATLWLD_adriatica_9",
                    "name": "Weld Helper",
                    "cntr_code": "ATL",
                    "atl_geometry_role": "shore_seal",
                    "atl_join_mode": "boolean_weld",
                    "interactive": True,
                    "geometry": _square(1, 1, 1.0),
                },
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
        political_ids = {
            geometry.get("properties", {}).get("id")
            for geometry in topo["objects"]["political"]["geometries"]
        }
        self.assertFalse(
            any(str(feature_id or "").startswith(("ATLISL_", "ATLSHL_", "ATLWLD_")) for feature_id in political_ids)
        )
        atlantropa_props = {
            geometry.get("properties", {}).get("id"): geometry.get("properties", {})
            for geometry in topo["objects"]["scenario_atlantropa"]["geometries"]
        }

        self.assertEqual(atlantropa_props["ATLISL_adriatica_corfu"]["cntr_code"], "ATL")
        self.assertIs(atlantropa_props["ATLISL_adriatica_corfu"].get("interactive"), True)
        self.assertEqual(atlantropa_props["ATLISL_adriatica_CRO_3"]["cntr_code"], "ATL")
        self.assertIs(atlantropa_props["ATLISL_adriatica_CRO_3"].get("interactive"), True)
        self.assertEqual(atlantropa_props["ATLWLD_adriatica_9"].get("atl_render_layer"), "land")
        self.assertEqual(atlantropa_props["ATLWLD_adriatica_9"].get("atl_color_rule"), "owner")
        self.assertIs(atlantropa_props["ATLWLD_adriatica_9"].get("atl_interactive"), True)
        self.assertIs(atlantropa_props["ATLWLD_adriatica_9"].get("interactive"), True)
        self.assertEqual(atlantropa_props["ATLSHL_adriatica_4"]["cntr_code"], "ATL")
        self.assertEqual(atlantropa_props["ATLSHL_adriatica_4"].get("atl_render_layer"), "shoal")
        self.assertEqual(atlantropa_props["ATLSHL_adriatica_4"].get("atl_color_rule"), "shoal_pattern")
        self.assertIs(atlantropa_props["ATLSHL_adriatica_4"].get("atl_interactive"), True)
        self.assertIs(atlantropa_props["ATLSHL_adriatica_4"].get("interactive"), True)

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
            require_chunks=False,
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
            ("tno_greenland_sea", Point(-14.183779, 76.629887)),
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

    def test_tno_irish_sea_source_spec_keeps_child_seams_closed(self) -> None:
        spec_map = {
            spec["id"]: spec
            for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
        }
        irish_sea_spec = spec_map["tno_irish_sea"]

        self.assertEqual(irish_sea_spec["source_layer"], "seavox_v19")
        self.assertEqual(
            irish_sea_spec["source_query"],
            "mrgid_l3='23731' OR mrgid_l4='23739' OR mrgid_sr='24210' OR mrgid_sr='24214'",
        )
        self.assertEqual(irish_sea_spec["snapshot_simplify_tolerance"], 0.002)
        self.assertEqual(irish_sea_spec["exclude_base_ids"], ("marine_irish_sea",))
        self.assertEqual(
            irish_sea_spec["subtract_named_ids"],
            (
                "tno_north_channel",
                "tno_st_georges_channel",
                "tno_st_brides_bay",
                "tno_cardigan_bay",
                "tno_caernarfon_bay",
                "tno_menai_strait",
                "tno_liverpool_bay",
                "tno_morecambe_bay",
                "tno_solway_firth",
            ),
        )
        self.assertEqual(spec_map["tno_caernarfon_bay"]["source_query"], "mrgid_sr='24220'")
        self.assertEqual(spec_map["tno_caernarfon_bay"]["parent_id"], "tno_irish_sea")
        self.assertEqual(spec_map["tno_menai_strait"]["source_query"], "mrgid_sr='24222'")
        self.assertEqual(spec_map["tno_menai_strait"]["parent_id"], "tno_irish_sea")
        self.assertEqual(spec_map["tno_morecambe_bay"]["source_query"], "mrgid_sr='24227'")
        self.assertEqual(spec_map["tno_morecambe_bay"]["parent_id"], "tno_irish_sea")

    def test_tno_channel_child_source_specs_keep_parent_seams_closed(self) -> None:
        spec_map = {
            spec["id"]: spec
            for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
        }

        self.assertEqual(
            spec_map["tno_english_channel"]["subtract_named_ids"],
            (
                "tno_strait_of_dover",
                "tno_poole_bay",
                "tno_solent",
                "tno_weymouth_bay",
                "tno_lyme_bay",
                "tno_plymouth_sound",
                "tno_mounts_bay",
            ),
        )
        self.assertEqual(spec_map["tno_strait_of_dover"]["source_query"], "mrgid_l4='23735'")
        self.assertEqual(spec_map["tno_strait_of_dover"]["subtract_named_ids"], ("tno_rye_bay",))
        self.assertEqual(spec_map["tno_rye_bay"]["source_layer"], "seavox_v19")
        self.assertEqual(spec_map["tno_rye_bay"]["source_query"], "mrgid_sr='24198'")
        self.assertEqual(spec_map["tno_rye_bay"]["parent_id"], "tno_strait_of_dover")

        self.assertEqual(spec_map["tno_weymouth_bay"]["source_query"], "mrgid_sr='24204'")
        self.assertEqual(spec_map["tno_weymouth_bay"]["parent_id"], "tno_english_channel")
        self.assertEqual(spec_map["tno_lyme_bay"]["source_query"], "mrgid_sr='24205'")
        self.assertEqual(spec_map["tno_lyme_bay"]["parent_id"], "tno_english_channel")
        self.assertEqual(spec_map["tno_plymouth_sound"]["source_query"], "mrgid_sr='24206'")
        self.assertEqual(spec_map["tno_plymouth_sound"]["parent_id"], "tno_english_channel")
        self.assertEqual(spec_map["tno_mounts_bay"]["source_query"], "mrgid_sr='24207'")
        self.assertEqual(spec_map["tno_mounts_bay"]["parent_id"], "tno_english_channel")

        self.assertEqual(spec_map["tno_north_channel"]["source_query"], "mrgid_l4='23739'")
        self.assertEqual(spec_map["tno_north_channel"]["subtract_named_ids"], ("tno_belfast_lough",))
        self.assertEqual(spec_map["tno_belfast_lough"]["source_layer"], "seavox_v19")
        self.assertEqual(spec_map["tno_belfast_lough"]["source_query"], "mrgid_sr='24233'")
        self.assertEqual(spec_map["tno_belfast_lough"]["parent_id"], "tno_north_channel")

    def test_tno_baltic_sea_source_spec_keeps_child_seams_closed(self) -> None:
        baltic_sea_spec = next(
            spec for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
            if spec["id"] == "tno_baltic_sea"
        )

        self.assertEqual(baltic_sea_spec["source_layer"], "iho")
        self.assertEqual(baltic_sea_spec["source_query"], "mrgid=2401")
        self.assertEqual(baltic_sea_spec["snapshot_simplify_tolerance"], 0.008)
        self.assertEqual(
            baltic_sea_spec["subtract_named_ids"],
            (
                "tno_kattegat",
                "tno_gulf_of_riga",
                "tno_bothnian_sea",
                "tno_bay_of_bothnia",
                "tno_gulf_of_finland",
                "tno_central_baltic_sea",
                "tno_the_sound",
                "tno_storebaelt",
                "tno_lillebaelt",
            ),
        )

    def test_tno_south_china_sea_source_spec_keeps_child_seams_closed(self) -> None:
        south_china_sea_spec = next(
            spec for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
            if spec["id"] == "tno_south_china_sea"
        )

        self.assertEqual(south_china_sea_spec["source_layer"], "seavox_v19")
        self.assertEqual(south_china_sea_spec["source_query"], "mrgid_sr='24144'")
        self.assertEqual(south_china_sea_spec["snapshot_simplify_tolerance"], 0.03)
        self.assertEqual(
            south_china_sea_spec["subtract_named_ids"],
            (
                "tno_taiwan_strait",
                "tno_gulf_of_tonkin",
                "tno_gulf_of_thailand",
                "tno_natuna_sea",
                "tno_singapore_strait",
                "tno_java_sea",
                "tno_sulu_sea",
            ),
        )
        self.assertEqual(
            south_china_sea_spec["clip_open_ocean_ids"],
            tno_bundle.TNO_PACIFIC_OPEN_OCEAN_IDS,
        )

    def test_tno_remaining_ocean_backlog_source_specs_keep_child_seams_closed(self) -> None:
        spec_map = {
            spec["id"]: spec
            for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
        }

        self.assertEqual(
            spec_map["tno_bering_sea"]["subtract_named_ids"],
            ("tno_gulf_of_alaska", "tno_anadyrskiy_zaliv"),
        )
        self.assertEqual(spec_map["tno_anadyrskiy_zaliv"]["source_query"], "mrgid_sr='24121'")
        self.assertEqual(spec_map["tno_anadyrskiy_zaliv"]["parent_id"], "tno_bering_sea")
        self.assertEqual(spec_map["tno_anadyrskiy_zaliv"]["water_type"], "gulf")

        self.assertEqual(
            spec_map["tno_greenland_sea"]["subtract_named_ids"],
            ("tno_norwegian_sea", "tno_fram_strait"),
        )
        self.assertEqual(spec_map["tno_fram_strait"]["source_query"], "mrgid_sr='26579'")
        self.assertEqual(spec_map["tno_fram_strait"]["parent_id"], "tno_greenland_sea")
        self.assertEqual(spec_map["tno_fram_strait"]["water_type"], "strait")

    def test_tno_arctic_open_ocean_split_boundary_matches_barents_regression(self) -> None:
        arctic_spec = next(
            spec for spec in tno_bundle.TNO_OPEN_OCEAN_SPLIT_SPECS
            if spec["source_id"] == "marine_arctic_ocean"
        )
        western_child, eastern_child = arctic_spec["children"]
        self.assertEqual(
            western_child["bbox"],
            tno_bundle.TNO_ARCTIC_OPEN_OCEAN_CHILD_BBOXES[western_child["id"]],
        )
        self.assertEqual(
            eastern_child["bbox"],
            tno_bundle.TNO_ARCTIC_OPEN_OCEAN_CHILD_BBOXES[eastern_child["id"]],
        )

        barents_spec = next(
            spec for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
            if spec["id"] == "tno_barents_sea"
        )
        self.assertEqual(
            tuple(barents_spec.get("supplement_bboxes") or ()),
            tno_bundle.TNO_POLAR_NAMED_WATER_SUPPLEMENT_BBOXES["tno_barents_sea"],
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

    def test_tno_southern_open_ocean_split_and_polar_supplements_use_shared_regression_boxes(self) -> None:
        southern_spec = next(
            spec for spec in tno_bundle.TNO_OPEN_OCEAN_SPLIT_SPECS
            if spec["source_id"] == "marine_southern_ocean"
        )
        for child_spec in southern_spec["children"]:
            expected_boxes = tno_bundle.TNO_SOUTHERN_OPEN_OCEAN_CHILD_BBOXES[child_spec["id"]]
            if "bbox" in child_spec:
                self.assertEqual(child_spec["bbox"], expected_boxes)
            else:
                self.assertEqual(tuple(child_spec.get("bboxes") or ()), expected_boxes)

        for feature_id in ("tno_greenland_sea", "tno_barents_sea", "tno_ross_sea"):
            spec = next(
                item for item in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
                if item["id"] == feature_id
            )
            self.assertEqual(
                tuple(spec.get("supplement_bboxes") or ()),
                tno_bundle.TNO_POLAR_NAMED_WATER_SUPPLEMENT_BBOXES[feature_id],
            )

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
        alaska_supplements = tuple(spec_map["tno_gulf_of_alaska"].get("supplement_bboxes") or ())
        self.assertEqual(alaska_supplements, ((-163.358, 54.8103, -163.3575, 54.811),))

    def test_named_water_base_controls_keep_geometry_subtraction_separate_from_clone_exclusion(self) -> None:
        spec_map = {
            spec["id"]: spec
            for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS
        }
        snapshot_payload = {
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "id": "tno_sea_of_japan",
                        "name": "Sea of Japan",
                        "source_record_ids": [],
                    },
                    "geometry": mapping(_square(0.0, 0.0, 10.0)),
                },
                {
                    "type": "Feature",
                    "properties": {
                        "id": "tno_black_sea",
                        "name": "Black Sea",
                        "source_record_ids": [],
                    },
                    "geometry": mapping(_square(20.0, 20.0, 10.0)),
                },
            ]
        }
        feature_index = {
            "marine_yellow_sea": {
                "type": "Feature",
                "properties": {"id": "marine_yellow_sea"},
                "geometry": mapping(_square(0.0, 0.0, 2.0)),
            },
            "marine_east_china_sea": {
                "type": "Feature",
                "properties": {"id": "marine_east_china_sea"},
                "geometry": mapping(_square(2.0, 0.0, 2.0)),
            },
            "marine_sea_of_okhotsk": {
                "type": "Feature",
                "properties": {"id": "marine_sea_of_okhotsk"},
                "geometry": mapping(_square(4.0, 0.0, 2.0)),
            },
        }
        sea_of_japan_spec = dict(spec_map["tno_sea_of_japan"])
        sea_of_japan_spec["subtract_named_ids"] = ()
        sea_of_japan_spec["clip_open_ocean_ids"] = ()
        black_sea_spec = dict(spec_map["tno_black_sea"])
        black_sea_spec["subtract_named_ids"] = ()

        with (
            patch.object(tno_bundle, "load_global_water_regions_feature_index", return_value=feature_index),
            patch.object(
                tno_bundle,
                "TNO_NAMED_MARGINAL_WATER_SPECS",
                (sea_of_japan_spec, black_sea_spec),
            ),
        ):
            named_features, diagnostics = build_tno_named_marginal_water_features(snapshot_payload)

        named_feature_map = {
            str(feature["properties"]["id"]): shape(feature["geometry"])
            for feature in named_features
        }
        self.assertEqual(
            diagnostics["tno_sea_of_japan"]["subtract_base_ids"],
            ["marine_yellow_sea", "marine_east_china_sea", "marine_sea_of_okhotsk"],
        )
        self.assertEqual(diagnostics["tno_black_sea"]["subtract_base_ids"], [])
        self.assertLess(named_feature_map["tno_sea_of_japan"].area, 100.0)
        self.assertAlmostEqual(named_feature_map["tno_black_sea"].area, 100.0, places=3)
        self.assertIn("marine_black_sea", tno_bundle.TNO_MANIFEST_EXCLUDED_BASE_WATER_REGION_IDS)
        self.assertEqual(tuple(sea_of_japan_spec.get("exclude_base_ids") or ()), ())
        self.assertEqual(tuple(black_sea_spec.get("exclude_base_ids") or ()), ("marine_black_sea",))

    def test_base_geography_water_clones_preserve_global_ids_and_runtime_contract(self) -> None:
        feature_index = {}
        for index, feature_id in enumerate(tno_bundle.TNO_BASE_GEOGRAPHY_WATER_CLONE_IDS):
            feature_index[feature_id] = {
                "type": "Feature",
                "properties": {
                    "id": feature_id,
                    "name": feature_id.replace("_", " ").title(),
                    "label": feature_id,
                    "water_type": "inland_sea" if feature_id == "caspian_sea" else "lake",
                    "region_group": "eurasia_lakes" if feature_id == "caspian_sea" else "great_lakes",
                    "neighbors": "lake_huron" if feature_id == "lake_michigan" else "",
                },
                "geometry": mapping(_square(float(index * 3), 0.0, 1.0)),
            }

        with patch.object(tno_bundle, "load_global_water_regions_feature_index", return_value=feature_index):
            clone_features = tno_bundle.build_tno_base_geography_water_clone_features()

        self.assertEqual(
            [feature["properties"]["id"] for feature in clone_features],
            list(tno_bundle.TNO_BASE_GEOGRAPHY_WATER_CLONE_IDS),
        )
        for feature in clone_features:
            props = feature["properties"]
            self.assertEqual(props["scenario_id"], "tno_1962")
            self.assertEqual(props["source_standard"], "tno_cloned_from_global_water_regions")
            self.assertEqual(props["source_feature_id"], props["id"])
            self.assertTrue(props["interactive"])
            self.assertTrue(props["render_as_base_geography"])
            self.assertIn(props["id"], tno_bundle.TNO_MANIFEST_EXCLUDED_BASE_WATER_REGION_IDS)

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

    def test_apply_tno_named_water_exclusions_removes_post_supplement_overlap(self) -> None:
        named_features = [
            {
                "type": "Feature",
                "properties": {"id": "macro"},
                "geometry": mapping(_square(0, 0, 2.0)),
            },
            {
                "type": "Feature",
                "properties": {"id": "detail"},
                "geometry": mapping(_square(1, 1, 1.0)),
            },
        ]
        specs = (
            {"id": "macro", "subtract_named_ids": ("detail",)},
            {"id": "detail"},
        )

        with patch.object(tno_bundle, "TNO_NAMED_MARGINAL_WATER_SPECS", specs):
            repaired_features = apply_tno_named_water_exclusions(named_features)

        repaired_by_id = {
            str(feature["properties"]["id"]): shape(feature["geometry"])
            for feature in repaired_features
        }
        self.assertAlmostEqual(repaired_by_id["macro"].intersection(repaired_by_id["detail"]).area, 0.0)
        self.assertAlmostEqual(repaired_by_id["macro"].area, 3.0, delta=0.0001)

    def test_apply_tno_named_water_exclusions_rejects_area_collapse(self) -> None:
        named_features = [
            {
                "type": "Feature",
                "properties": {"id": "macro"},
                "geometry": mapping(_square(0, 0, 2.0)),
            },
            {
                "type": "Feature",
                "properties": {"id": "detail"},
                "geometry": mapping(_square(0, 0, 1.9995)),
            },
        ]
        specs = (
            {"id": "macro", "subtract_named_ids": ("detail",)},
            {"id": "detail"},
        )

        with patch.object(tno_bundle, "TNO_NAMED_MARGINAL_WATER_SPECS", specs):
            with self.assertRaisesRegex(ValueError, "lost too much area"):
                apply_tno_named_water_exclusions(named_features)

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
        self.assertEqual(diagnostics["excluded_region_ids"], [])
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
        self.assertEqual(
            result["manifest_payload"]["presentation_features"],
            {"atlantropa_relief": True, "coastal_accent": True},
        )
        self.assertEqual(
            result["special_zone_layers_payload"],
            {
                "version": 1,
                "layers": [],
                "activeLayerId": "",
                "topologyFingerprint": "",
                "diagnostics": [],
            },
        )
        self.assertEqual(
            result["manifest_payload"]["source"]["runtime_topology_sha256"],
            compact_written_json_hash(result["runtime_topology_payload"]),
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
        shell_source_fragment_count = sum(
            int((geometry.get("properties", {}) or {}).get("source_fragment_count") or 1)
            for geometry in geometries
            if str((geometry.get("properties", {}) or {}).get("id") or "").strip().startswith("RU_ARCTIC_FB_")
        )
        shell_source_area = sum(
            float((geometry.get("properties", {}) or {}).get("source_fragment_area") or 0.0)
            for geometry in geometries
            if str((geometry.get("properties", {}) or {}).get("id") or "").strip().startswith("RU_ARCTIC_FB_")
        )
        shell_retained_area = sum(
            float((geometry.get("properties", {}) or {}).get("retained_fragment_area") or 0.0)
            for geometry in geometries
            if str((geometry.get("properties", {}) or {}).get("id") or "").strip().startswith("RU_ARCTIC_FB_")
        )

        self.assertIn("AQ", feature_ids)
        self.assertFalse(any(feature_id.startswith("AQ_") for feature_id in feature_ids))
        self.assertGreaterEqual(shell_fragment_count, 2)
        self.assertLess(shell_fragment_count, 100)
        self.assertFalse(any(re.fullmatch(r"RU_ARCTIC_FB_\d+", feature_id) for feature_id in feature_ids))
        self.assertGreaterEqual(shell_source_fragment_count, 9000)
        self.assertGreaterEqual(shell_retained_area / shell_source_area, 0.90)
        shell_props = [
            geometry.get("properties", {}) or {}
            for geometry in geometries
            if str((geometry.get("properties", {}) or {}).get("id") or "").strip().startswith("RU_ARCTIC_FB_")
        ]
        self.assertTrue(all(props.get("scenario_helper_kind") == "shell_fallback" for props in shell_props))
        self.assertTrue(all(props.get("interactive") is False for props in shell_props))
        self.assertTrue(all(props.get("render_as_base_geography") is False for props in shell_props))
        self.assertTrue(all(props.get("scenario_shell_owner_hint") for props in shell_props))
        self.assertTrue(all(props.get("scenario_shell_controller_hint") for props in shell_props))
        self.assertIn("AQ", polar_diagnostics)
        self.assertTrue(
            all(
                "world_bounds" not in entry.get("flags", [])
                and "giant_feature" not in entry.get("flags", [])
                for entry in polar_diagnostics.values()
            )
        )

    def test_build_runtime_shell_fragment_gdf_uses_full_runtime_shell_rows(self) -> None:
        runtime_gdf = gpd.GeoDataFrame(
            [
                {"id": "RU_ARCTIC_FB_001", "name": "Russia Shell Fallback 1", "cntr_code": "RU", "geometry": _square(0, 0)},
                {"id": "RU_ARCTIC_FB_002", "name": "Russia Shell Fallback 2", "cntr_code": "RU", "geometry": _square(2, 0)},
                {"id": "RU-REAL", "name": "Russia", "cntr_code": "RU", "geometry": _square(4, 0)},
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )

        shell_gdf = tno_bundle.build_runtime_shell_fragment_gdf(runtime_gdf)

        self.assertEqual(shell_gdf["id"].tolist(), ["RU_ARCTIC_FB_001", "RU_ARCTIC_FB_002"])
        self.assertEqual(shell_gdf["interactive"].tolist(), [False, False])
        self.assertEqual(shell_gdf["scenario_helper_kind"].tolist(), ["shell_fallback", "shell_fallback"])
        self.assertEqual(shell_gdf["render_as_base_geography"].tolist(), [False, False])

    def test_build_runtime_shell_fragment_gdf_coalesces_shell_rows_by_owner_hint(self) -> None:
        runtime_gdf = gpd.GeoDataFrame(
            [
                {"id": "RU_ARCTIC_FB_001", "name": "Russia Shell Fallback 1", "cntr_code": "RU", "geometry": _square(40, 70)},
                {"id": "RU_ARCTIC_FB_002", "name": "Russia Shell Fallback 2", "cntr_code": "RU", "geometry": _square(41, 70)},
                {"id": "RU_ARCTIC_FB_003", "name": "Russia Shell Fallback 3", "cntr_code": "RU", "geometry": _square(80, 70)},
                {"id": "RU-REAL-1", "name": "Russia A", "cntr_code": "RU", "geometry": _square(40, 68)},
                {"id": "RU-REAL-2", "name": "Russia B", "cntr_code": "RU", "geometry": _square(80, 68)},
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        owner_reference_gdf = runtime_gdf.loc[runtime_gdf["id"].isin(["RU-REAL-1", "RU-REAL-2"])].copy()

        shell_gdf = tno_bundle.build_runtime_shell_fragment_gdf(
            runtime_gdf,
            owner_reference_gdf=owner_reference_gdf,
            owners_by_feature={"RU-REAL-1": "SOV", "RU-REAL-2": "KOM"},
            controllers_by_feature={"RU-REAL-1": "SOV", "RU-REAL-2": "KOM"},
        )

        self.assertEqual(sorted(shell_gdf["scenario_shell_owner_hint"].tolist()), ["KOM", "SOV"])
        self.assertEqual(int(shell_gdf["source_fragment_count"].sum()), 3)
        self.assertGreater(float(shell_gdf["retained_fragment_area"].sum()), 0.0)
        self.assertGreater(float(shell_gdf["source_fragment_area"].sum()), 0.0)
        self.assertTrue(all(str(feature_id).startswith("RU_ARCTIC_FB_") for feature_id in shell_gdf["id"].tolist()))

    def test_build_qyzylorda_inland_water_feature_extracts_kaz_3197_hole(self) -> None:
        hole = Polygon([
            (62.8, 45.5),
            (64.0, 45.5),
            (64.0, 46.4),
            (62.8, 46.4),
        ])
        kaz_geometry = Polygon(_square(62.0, 45.0, 3.0).exterior.coords, [hole.exterior.coords])
        political_gdf = gpd.GeoDataFrame(
            [
                {
                    "id": tno_bundle.TNO_QYZYLORDA_INLAND_WATER_SOURCE_FEATURE_ID,
                    "name": "Qyzylorda",
                    "geometry": kaz_geometry,
                },
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )

        feature = tno_bundle.build_qyzylorda_inland_water_feature(political_gdf)

        props = feature["properties"]
        water_geom = shape(feature["geometry"])
        self.assertEqual(props["id"], tno_bundle.TNO_QYZYLORDA_INLAND_WATER_ID)
        self.assertEqual(props["source_feature_id"], tno_bundle.TNO_QYZYLORDA_INLAND_WATER_SOURCE_FEATURE_ID)
        self.assertEqual(props["water_type"], "lake")
        self.assertTrue(props["interactive"])
        self.assertTrue(water_geom.contains(tno_bundle.TNO_QYZYLORDA_INLAND_WATER_PROBE))

    def test_solidify_polygonal_interiors_fills_major_island_core_holes(self) -> None:
        core_hole = Polygon([
            (1.0, 1.0),
            (3.0, 1.0),
            (3.0, 3.0),
            (1.0, 3.0),
        ])
        island_with_hole = Polygon(_square(0.0, 0.0, 4.0).exterior.coords, [core_hole.exterior.coords])

        repaired = tno_bundle.solidify_polygonal_interiors(island_with_hole)

        self.assertIsNotNone(repaired)
        repaired_parts = tno_bundle.iter_polygon_parts(repaired)
        self.assertTrue(repaired.contains(Point(2.0, 2.0)))
        self.assertTrue(all(len(part.interiors) == 0 for part in repaired_parts))

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
        self.assertEqual(manifest_payload["style_defaults"]["ocean"]["fillColor"], "#2d4769")
        self.assertEqual(manifest_payload["style_defaults"]["ocean"]["preset"], "flat")
        self.assertFalse(manifest_payload["style_defaults"]["ocean"]["experimentalAdvancedStyles"])
        self.assertEqual(manifest_payload["style_defaults"]["atlantropa_sea"]["fillColor"], "#203856")

    def test_extract_scenario_atlantropa_manifest_writes_runtime_style_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir)
            (scenario_dir / "manifest.json").write_text(
                json.dumps({"scenario_id": "tno_1962", "style_defaults": {}}),
                encoding="utf-8",
            )

            update_atlantropa_manifest(scenario_dir, {"feature_count": 927})

            manifest_payload = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))

        self.assertEqual(
            manifest_payload["scenario_atlantropa_topology_url"],
            "data/scenarios/tno_1962/scenario_atlantropa.topo.json",
        )
        self.assertEqual(
            manifest_payload["scenario_atlantropa_metadata_url"],
            "data/scenarios/tno_1962/scenario_atlantropa_metadata.json",
        )
        self.assertIs(manifest_payload["performance_hints"]["scenario_atlantropa_default"], True)
        self.assertEqual(manifest_payload["summary"]["scenario_atlantropa_feature_count"], 927)
        self.assertEqual(manifest_payload["style_defaults"]["atlantropa_sea"]["fillColor"], "#203856")
        self.assertEqual(manifest_payload["style_defaults"]["atlantropa_salt_flat"]["fillColor"], "#7c6f53")
        self.assertEqual(manifest_payload["style_defaults"]["atlantropa_shoal"]["fillColor"], "#3a5d70")

    def test_extract_scenario_atlantropa_remaps_political_neighbors_after_split(self) -> None:
        payload = {
            "type": "Topology",
            "objects": {
                "political": {
                    "type": "GeometryCollection",
                    "computed_neighbors": [[1, 2, 3], [0, 2], [0, 1, 3], [0, 2]],
                    "geometries": [
                        {"type": "Polygon", "id": "AAA-1", "properties": {"id": "AAA-1", "CNTR_CODE": "AAA"}},
                        {"type": "Polygon", "id": "ATLSEA_mid", "properties": {"id": "ATLSEA_mid"}},
                        {"type": "Polygon", "id": "BBB-1", "properties": {"id": "BBB-1", "CNTR_CODE": "BBB"}},
                        {"type": "Polygon", "id": "ATLISL_side", "properties": {"id": "ATLISL_side"}},
                    ],
                }
            },
            "arcs": [],
        }

        migrated, atlantropa_geometries = split_atlantropa_topology_payload(payload)

        political = migrated["objects"]["political"]
        self.assertEqual(
            [geometry["id"] for geometry in political["geometries"]],
            ["AAA-1", "BBB-1"],
        )
        self.assertEqual(political["computed_neighbors"], [[1], [0]])
        self.assertEqual(
            [geometry["properties"]["id"] for geometry in atlantropa_geometries],
            ["ATLSEA_mid", "ATLISL_side"],
        )

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
            "#82132e",
        )
        gng_rule = next(
            rule for rule in east_asia_rules["country_rules"]
            if rule.get("rule_id") == "japan_guangdong_client_1962"
        )
        self.assertEqual(gng_rule["color_hex"], "#7A2E41")
        self.assertEqual(manual_overrides["countries"]["MAG"]["color_hex"], "#415638")
        self.assertEqual(manual_overrides["countries"]["ONG"]["color_hex"], "#0d4510")
        self.assertEqual(manual_overrides["countries"]["GAY"]["color_hex"], "#4f4f4f")

    def test_second_wave_runtime_colors_keep_manual_sources_locked(self) -> None:
        countries_payload = json.loads(
            Path("data/scenarios/tno_1962/countries.json").read_text(encoding="utf-8")
        )["countries"]
        manual_overrides = json.loads(
            Path("data/scenarios/tno_1962/scenario_manual_overrides.json").read_text(encoding="utf-8")
        )
        expected_colors = {
            "KOR": tno_bundle.TNO_1962_MANUAL_COUNTRY_OVERRIDES["KOR"]["color_hex"],
            "MAG": manual_overrides["countries"]["MAG"]["color_hex"],
            "ONG": manual_overrides["countries"]["ONG"]["color_hex"],
            "GAY": manual_overrides["countries"]["GAY"]["color_hex"],
        }

        for tag, expected_color in expected_colors.items():
            self.assertEqual(
                countries_payload[tag]["color_hex"].lower(),
                expected_color.lower(),
            )
            self.assertEqual(countries_payload[tag]["color_policy"], "locked")
        self.assertEqual(countries_payload["GNG"]["color_policy"], "palette")

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

    def test_single_object_topology_prunes_unused_arcs(self) -> None:
        source_topology = {
            "type": "Topology",
            "transform": {"scale": [1, 1], "translate": [0, 0]},
            "objects": {
                "scenario_atlantropa": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "properties": {"id": "A"}, "arcs": [[0, ~2]]},
                    ],
                },
                "political": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "properties": {"id": "P"}, "arcs": [[1]]},
                    ],
                },
            },
            "arcs": [
                [[0, 0], [1, 0]],
                [[9, 9], [9, 10]],
                [[2, 2], [3, 3]],
            ],
        }

        payload = tno_bundle.build_single_object_topology_payload(source_topology, "scenario_atlantropa")

        self.assertEqual(payload["arcs"], [source_topology["arcs"][0], source_topology["arcs"][2]])
        self.assertEqual(
            payload["objects"]["scenario_atlantropa"]["geometries"][0]["arcs"],
            [[0, ~1]],
        )

    def test_tno_country_registry_preserves_controller_only_retired_tags(self) -> None:
        countries_payload = {"countries": {"POR": {"tag": "POR", "entry_kind": "controller_only"}}}
        owners_payload = {"owners": {"F-1": "AAA"}}

        tno_bundle.normalize_tno_country_registry(countries_payload, owners_payload)

        self.assertEqual(countries_payload["countries"]["POR"]["entry_kind"], "controller_only")

    def test_final_wave_runtime_entries_keep_expected_sources_and_entry_kinds(self) -> None:
        countries = json.loads(
            Path("data/scenarios/tno_1962/countries.json").read_text(encoding="utf-8")
        )["countries"]

        for tag in ("POR", "PRC", "SIC", "SIK", "XSM"):
            self.assertEqual(countries[tag]["entry_kind"], "controller_only")
            self.assertEqual(countries[tag]["primary_rule_source"], f"tno_1962_controller_only_{tag.lower()}")
        self.assertTrue(countries["POR"]["hidden_from_country_list"])

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

        explicit_scenario_color_tags = {}
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
            if country_entry.get("color_policy") == "locked":
                continue
            if not audit_hex:
                continue
            if country_hex != audit_hex:
                mismatches.append((tag, country_hex, audit_hex))

        self.assertEqual(mismatches, [])

    def test_tno_palette_audit_sync_uses_color_policy_not_static_override_list(self) -> None:
        source = Path("tools/patch_tno_1962_bundle.py").read_text(encoding="utf-8")
        self.assertIn("def apply_tno_country_color_policy_backfill", source)
        self.assertIn('raw_entry["color_policy"] = COLOR_POLICY_PALETTE', source)
        self.assertNotIn("TNO_1962_LOCKED_COLOR_OVERRIDES", source)

    def test_apply_tno_country_color_policy_backfill_marks_locked_and_palette_entries(self) -> None:
        countries_payload = {
            "countries": {
                "KOR": {
                    "tag": "KOR",
                    "color_hex": "#009163",
                    "source": "manual_rule",
                    "source_type": "scenario_extension",
                    "primary_rule_source": "tno_1962_kor_manual_override",
                },
                "GNG": {
                    "tag": "GNG",
                    "color_hex": "#7a2e41",
                    "source": "manual_rule",
                    "source_type": "scenario_extension",
                    "primary_rule_source": "japan_guangdong_client_1962",
                },
                "AAA": {"tag": "AAA", "color_hex": "#111111"},
                "BBB": {"tag": "BBB", "color_hex": "#222222", "color_policy": "locked"},
                "MAG": {"tag": "MAG", "color_hex": "#cac6b2", "color_policy": "locked"},
            }
        }
        with patch.object(
            tno_bundle,
            "load_tno_palette_audit_entries",
            return_value={
                "KOR": {"map_hex": "#009163"},
                "GNG": {"map_hex": "#7a2e41"},
                "AAA": {"map_hex": "#abcdef"},
                "BBB": {"map_hex": "#123456"},
            },
        ):
            tno_bundle.apply_tno_country_color_policy_backfill(countries_payload)

        self.assertEqual(countries_payload["countries"]["KOR"]["color_hex"], "#009163")
        self.assertEqual(countries_payload["countries"]["KOR"]["color_policy"], "locked")
        self.assertEqual(countries_payload["countries"]["GNG"]["color_policy"], "palette")
        self.assertEqual(countries_payload["countries"]["AAA"]["color_policy"], "palette")
        self.assertEqual(countries_payload["countries"]["BBB"]["color_policy"], "locked")
        self.assertEqual(countries_payload["countries"]["MAG"]["color_hex"], "#cac6b2")
        self.assertEqual(countries_payload["countries"]["MAG"]["color_policy"], "locked")

    def test_current_tno_explicit_country_colors_are_locked_and_bundled(self) -> None:
        countries_payload = json.loads(
            Path("data/scenarios/tno_1962/countries.json").read_text(encoding="utf-8")
        )["countries"]
        explicit_tags = sorted(
            tag for tag, entry in countries_payload.items()
            if entry.get("color_hex") and (
                entry.get("source") in {"controller_rule", "scenario_generated"}
                or entry.get("entry_kind") == "controller_only"
                or entry.get("primary_rule_source") == "dev_manual_tag_create"
                or str(entry.get("primary_rule_source") or "").endswith("_manual_override")
            )
        )
        for expected_tag in ("KOR", "MAG", "ONG", "GAY", "XIK", "PRC", "SIC", "SIK", "XSM"):
            self.assertIn(expected_tag, explicit_tags)
        self.assertNotIn("GNG", explicit_tags)

        for tag in explicit_tags:
            self.assertEqual(countries_payload[tag]["color_policy"], "locked", tag)
        audit_entries = json.loads(
            Path("data/palette-maps/tno.audit.json").read_text(encoding="utf-8")
        )["entries"]
        for tag, entry in countries_payload.items():
            if entry.get("color_hex") and audit_entries.get(tag, {}).get("map_hex"):
                self.assertIn(entry.get("color_policy"), {"locked", "palette"}, tag)

        for bundle_name in ("startup.bundle.en.json", "startup.bundle.zh.json"):
            bundled_countries = json.loads(
                Path(f"data/scenarios/tno_1962/{bundle_name}").read_text(encoding="utf-8")
            )["scenario"]["countries"]["countries"]
            for tag in explicit_tags:
                self.assertEqual(
                    bundled_countries[tag]["color_hex"],
                    countries_payload[tag]["color_hex"],
                    f"{bundle_name}:{tag}:color_hex",
                )
                self.assertEqual(
                    bundled_countries[tag].get("color_policy"),
                    countries_payload[tag]["color_policy"],
                    f"{bundle_name}:{tag}:color_policy",
                )

    def test_sync_tno_country_colors_from_palette_audit_only_updates_palette_entries(self) -> None:
        countries_payload = {
            "countries": {
                "KOR": {"tag": "KOR", "color_hex": "#111111", "color_policy": "palette"},
                "AAA": {"tag": "AAA", "color_hex": "#111111", "color_policy": "palette"},
            }
        }
        with patch.object(
            tno_bundle,
            "load_tno_palette_audit_entries",
            return_value={
                "KOR": {"map_hex": "#009163"},
                "AAA": {"map_hex": "#abcdef"},
            },
        ):
            summary = tno_bundle.sync_tno_country_colors_from_palette_audit(countries_payload)

        self.assertEqual(countries_payload["countries"]["KOR"]["color_hex"], "#009163")
        self.assertEqual(countries_payload["countries"]["AAA"]["color_hex"], "#abcdef")
        self.assertEqual(summary["synced_tags"], ["KOR", "AAA"])
        self.assertEqual(summary["skipped_explicit_tags"], [])

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
                runtime_feature_ids=["F-1", "RU_ARCTIC_FB_RFA_001"],
                runtime_feature_props={
                    "RU_ARCTIC_FB_RFA_001": {
                        "scenario_helper_kind": "shell_fallback",
                        "scenario_shell_owner_hint": "RFA",
                        "scenario_shell_controller_hint": "RFA",
                        "interactive": False,
                    },
                },
                manifest_feature_count=1,
            )

            errors = validate_publish_bundle_dir(bundle_dir)

            self.assertTrue(any("build_snapshot.json" in error for error in errors))

    def test_validate_publish_bundle_dir_rejects_legacy_shell_runtime_only_features(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            bundle_dir = Path(tmp_dir) / "bundle"
            _write_publish_bundle_dir(
                bundle_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1", "RU_ARCTIC_FB_1"],
                runtime_feature_props={
                    "RU_ARCTIC_FB_1": {
                        "scenario_helper_kind": "shell_fallback",
                        "interactive": False,
                    },
                },
                manifest_feature_count=1,
            )

            errors = validate_publish_bundle_dir(bundle_dir)

            self.assertTrue(
                any("runtime-only Arctic shell features must be coalesced" in error for error in errors),
                errors,
            )

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

    def test_apply_tno_feature_assignment_overrides_skips_water_cut_ids(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {
                    "id": "LIVE-LAND",
                    "name": "Live Land",
                    "cntr_code": "OLD",
                    "geometry": _square(0, 0),
                },
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        original_overrides = tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES
        tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = {
            "RKK": ["LIVE-LAND", "REMOVED-WATER"],
        }
        try:
            owners_payload = {"owners": {"LIVE-LAND": "OLD"}}
            controllers_payload = {"controllers": {"LIVE-LAND": "OLD"}}
            cores_payload = {"cores": {"LIVE-LAND": ["OLD"]}}

            diagnostics = apply_tno_feature_assignment_overrides(
                owners_payload=owners_payload,
                controllers_payload=controllers_payload,
                cores_payload=cores_payload,
                scenario_political_gdf=political_gdf,
                ignored_missing_feature_ids={"REMOVED-WATER"},
            )

            self.assertEqual(diagnostics["feature_count"], 1)
            self.assertEqual(diagnostics["ignored_missing_feature_ids"], ["REMOVED-WATER"])
            self.assertEqual(owners_payload["owners"], {"LIVE-LAND": "RKK"})
            self.assertNotIn("REMOVED-WATER", owners_payload["owners"])
            self.assertEqual(political_gdf.iloc[0]["cntr_code"], "RKK")
        finally:
            tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = original_overrides

    def test_apply_tno_feature_assignment_overrides_follows_cut_feature_source_map(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {
                    "id": "SOURCE-LAND__tno1962_1",
                    "name": "Cut Land 1",
                    "cntr_code": "OLD",
                    "geometry": _square(0, 0),
                },
                {
                    "id": "SOURCE-LAND__tno1962_2",
                    "name": "Cut Land 2",
                    "cntr_code": "OLD",
                    "geometry": _square(2, 0),
                },
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        original_overrides = tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES
        tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = {
            "RKK": ["SOURCE-LAND"],
        }
        try:
            owners_payload = {"owners": {
                "SOURCE-LAND__tno1962_1": "OLD",
                "SOURCE-LAND__tno1962_2": "OLD",
            }}
            controllers_payload = {"controllers": {
                "SOURCE-LAND__tno1962_1": "OLD",
                "SOURCE-LAND__tno1962_2": "OLD",
            }}
            cores_payload = {"cores": {
                "SOURCE-LAND__tno1962_1": ["OLD"],
                "SOURCE-LAND__tno1962_2": ["OLD"],
            }}

            diagnostics = apply_tno_feature_assignment_overrides(
                owners_payload=owners_payload,
                controllers_payload=controllers_payload,
                cores_payload=cores_payload,
                scenario_political_gdf=political_gdf,
                source_feature_id_by_new_id={
                    "SOURCE-LAND__tno1962_1": "SOURCE-LAND",
                    "SOURCE-LAND__tno1962_2": "SOURCE-LAND",
                },
            )

            self.assertEqual(diagnostics["feature_count"], 2)
            self.assertEqual(diagnostics["derived_feature_count"], 2)
            self.assertEqual(set(owners_payload["owners"].values()), {"RKK"})
            self.assertEqual(political_gdf["cntr_code"].tolist(), ["RKK", "RKK"])
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
        cores_payload = json.loads((scenario_dir / "cores.by_feature.json").read_text(encoding="utf-8"))
        countries_payload = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))
        runtime_topology = json.loads((scenario_dir / "runtime_topology.topo.json").read_text(encoding="utf-8"))

        owners = owners_payload["owners"]
        cores = cores_payload["cores"]
        countries = countries_payload["countries"]
        political_geometries = runtime_topology["objects"]["political"]["geometries"]
        atlantropa_geometries = runtime_topology["objects"]["scenario_atlantropa"]["geometries"]
        self.assertFalse(
            any(
                str(geometry.get("properties", {}).get("id", "")).startswith(("ATLISL_", "ATLSHL_", "ATLWLD_", "ATLSEA_"))
                for geometry in political_geometries
            )
        )
        atlisl_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLISL_")
        ]
        atlshl_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLSHL_")
        ]

        self.assertTrue(atlisl_props)
        for props in atlisl_props:
            feature_id = props["id"]
            self.assertIn(feature_id, owners, feature_id)
            self.assertIn(feature_id, cores, feature_id)
            self.assertEqual(props.get("cntr_code"), "ATL", feature_id)
            owner_tag = owners[feature_id]
            core_tags = cores[feature_id]
            self.assertIn(owner_tag, countries, feature_id)
            self.assertNotEqual(owner_tag, "ATL", feature_id)
            self.assertTrue(core_tags, feature_id)
            for core_tag in core_tags:
                self.assertIn(core_tag, countries, feature_id)
                self.assertNotEqual(core_tag, "ATL", feature_id)
            if str(props.get("atl_join_mode") or "").strip().lower() == "boolean_weld":
                self.assertIs(props.get("interactive"), True, feature_id)
            else:
                self.assertIs(props.get("interactive"), True, feature_id)
        for props in atlshl_props:
            self.assertIs(props.get("interactive"), True, props.get("id"))
            self.assertIs(props.get("atl_interactive"), True, props.get("id"))
        helper_prefixes = ("ATLWLD_", "ATLSEA_FILL_")
        helper_roles = {"shore_seal", "sea_completion", "donor_sea"}
        helper_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith(helper_prefixes)
            or str(geometry.get("properties", {}).get("atl_geometry_role", "")).strip().lower() in helper_roles
            or str(geometry.get("properties", {}).get("atl_join_mode", "")).strip().lower() == "gap_fill"
        ]
        self.assertTrue(helper_props)
        for props in helper_props:
            self.assertIs(props.get("interactive"), True, props.get("id"))
            self.assertIs(props.get("atl_interactive"), True, props.get("id"))

    def test_checked_in_tno_1962_atlsea_runtime_contract_keeps_donor_sea_projectable(self) -> None:
        scenario_dir = Path(tno_bundle.SCENARIO_DIR)
        runtime_topology = json.loads((scenario_dir / "runtime_topology.topo.json").read_text(encoding="utf-8"))
        political_geometries = runtime_topology["objects"]["political"]["geometries"]
        atlantropa_geometries = runtime_topology["objects"]["scenario_atlantropa"]["geometries"]
        self.assertFalse(
            any(
                str(geometry.get("properties", {}).get("id", "")).startswith("ATLSEA_")
                for geometry in political_geometries
            )
        )
        donor_sea_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLSEA_")
            and not str(geometry.get("properties", {}).get("id", "")).startswith("ATLSEA_FILL_")
            and str(geometry.get("properties", {}).get("atl_geometry_role") or "").strip().lower() == "donor_sea"
        ]
        fill_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLSEA_FILL_")
        ]

        self.assertGreater(len(donor_sea_props), 50)
        for props in donor_sea_props:
            feature_id = props.get("id")
            self.assertEqual(props.get("cntr_code"), "ATL", feature_id)
            self.assertEqual(str(props.get("atl_surface_kind") or "").strip().lower(), "sea", feature_id)
            self.assertEqual(str(props.get("atl_geometry_role") or "").strip().lower(), "donor_sea", feature_id)
            self.assertEqual(props.get("atl_render_layer"), "water", feature_id)
            self.assertEqual(props.get("atl_color_rule"), "atlantropa_sea", feature_id)
            self.assertIs(props.get("atl_interactive"), True, feature_id)
            self.assertIs(props.get("interactive"), True, feature_id)
            self.assertIs(props.get("render_as_base_geography"), False, feature_id)
        self.assertGreater(len(fill_props), 100)
        for props in fill_props:
            feature_id = props.get("id")
            self.assertEqual(str(props.get("atl_geometry_role") or "").strip().lower(), "sea_completion", feature_id)
            self.assertEqual(props.get("atl_render_layer"), "water", feature_id)
            self.assertEqual(props.get("atl_color_rule"), "atlantropa_sea", feature_id)
            self.assertIs(props.get("atl_interactive"), True, feature_id)
            self.assertIs(props.get("interactive"), True, feature_id)

    def test_checked_in_tno_1962_cyprus_rebuilt_island_covers_runtime_baseline_west(self) -> None:
        scenario_dir = Path(tno_bundle.SCENARIO_DIR)
        atlantropa_topology = json.loads((scenario_dir / "scenario_atlantropa.topo.json").read_text(encoding="utf-8"))
        runtime_baseline_topology = json.loads((Path(tno_bundle.ROOT) / "data" / "europe_topology.runtime_political_v1.json").read_text(encoding="utf-8"))
        rebuilt = _feature_geometry_from_topology(atlantropa_topology, "scenario_atlantropa", "ATLISL_levant_cyprus")
        baseline = _feature_geometry_from_topology(runtime_baseline_topology, "political", "CY000")
        minx, miny, maxx, maxy = baseline.bounds
        west_baseline = baseline.intersection(box(minx, miny, minx + ((maxx - minx) * 0.33), maxy))
        west_cover_ratio = rebuilt.intersection(west_baseline).area / west_baseline.area

        self.assertGreaterEqual(west_cover_ratio, 0.95)
        self.assertLessEqual(rebuilt.area, baseline.area * 1.08)

    def test_tno_1962_cyprus_island_rebuild_keeps_baseline_area_clamp_contract(self) -> None:
        levant_config = tno_bundle.ATLANTROPA_REGION_CONFIGS["levant"]
        cyprus_group = next(
            group
            for group in levant_config["major_island_groups"]
            if group.get("id") == "cyprus"
        )

        self.assertEqual(cyprus_group["baseline_feature_ids"], ["CY000"])
        self.assertEqual(cyprus_group["max_baseline_area_ratio"], 1.08)

    def test_mediterranean_closure_fills_gap_without_flooding_land_or_other_water(self) -> None:
        template = box(0, 0, 10, 10)
        baseline_land = box(3, 3, 4, 4)
        atlantropa_land = box(6, 6, 7, 7)
        existing_sea = box(0, 0, 2, 10)
        other_water = box(8, 0, 10, 10)
        rows, completion, diagnostics = tno_bundle.build_mediterranean_sea_closure_rows(
            expected_template_geom=template,
            baseline_land_geom=baseline_land,
            atlantropa_land_geom=atlantropa_land,
            existing_sea_geom=existing_sea,
            other_water_geom=other_water,
        )
        self.assertEqual([row["properties"]["id"] for row in rows], ["ATLSEA_FILL_mediterranean_1"])
        self.assertTrue(completion.covers(Point(5, 5)))
        for excluded in [baseline_land, atlantropa_land, existing_sea, other_water]:
            self.assertEqual(completion.intersection(excluded).area, 0)
        self.assertEqual(completion.area, 58)
        self.assertEqual(diagnostics["remaining_hole_area"], 0)
        self.assertEqual(diagnostics["remaining_hole_count"], 0)
        self.assertTrue(shape(rows[0]["geometry"]).equals(completion))

    def test_mediterranean_closure_is_deterministic_and_idempotent(self) -> None:
        parts = [box(0, 0, 2, 2), box(4, 0, 6, 2)]
        arguments = dict(
            baseline_land_geom=None, atlantropa_land_geom=None, existing_sea_geom=None,
        )
        first_rows, first_union, _ = tno_bundle.build_mediterranean_sea_closure_rows(
            expected_template_geom=MultiPolygon(parts), **arguments,
        )
        reversed_rows, _, _ = tno_bundle.build_mediterranean_sea_closure_rows(
            expected_template_geom=MultiPolygon(parts[::-1]), **arguments,
        )
        self.assertEqual(first_rows, reversed_rows)
        self.assertEqual(len(first_rows), 1)
        rows, completion, diagnostics = tno_bundle.build_mediterranean_sea_closure_rows(
            expected_template_geom=MultiPolygon(parts),
            baseline_land_geom=None,
            atlantropa_land_geom=None,
            existing_sea_geom=first_union,
        )
        self.assertEqual(rows, [])
        self.assertIsNone(completion)
        self.assertEqual(diagnostics["remaining_hole_area"], 0)

    def test_mediterranean_closure_preserves_small_islands_and_exact_seams(self) -> None:
        island = box(0.9999, 0.9999, 1.0001, 1.0001)
        existing_sea = box(0, 0, 0.5, 2)
        _, completion, diagnostics = tno_bundle.build_mediterranean_sea_closure_rows(
            expected_template_geom=box(0, 0, 2, 2),
            baseline_land_geom=island,
            atlantropa_land_geom=None,
            existing_sea_geom=existing_sea,
        )
        self.assertEqual(completion.intersection(island).area, 0)
        self.assertTrue(completion.covers(Point(0.50000001, 1)))
        self.assertEqual(diagnostics["remaining_hole_area"], 0)

    def test_mediterranean_unmanaged_template_excludes_regional_responsibility(self) -> None:
        configs = {
            "west": {"sea_completion_bbox": (0, 0, 2, 2)},
            "east": {"aoi_bbox": (3, 0, 5, 2)},
        }
        with patch.object(tno_bundle, "ATLANTROPA_REGION_CONFIGS", configs):
            unmanaged = tno_bundle.build_mediterranean_unmanaged_template_geom(box(0, 0, 5, 2))
        self.assertTrue(unmanaged.equals(box(2, 0, 3, 2)))

    def test_mediterranean_other_water_excludes_named_source_beyond_coarse_base(self) -> None:
        def feature(geom, region_group):
            return {"type": "Feature", "geometry": mapping(geom), "properties": {"region_group": region_group}}

        template = box(0, 0, 5, 5)
        with (
            patch.object(tno_bundle, "load_mediterranean_template_water_gdf", return_value=gpd.GeoDataFrame(geometry=[template])),
            patch.object(tno_bundle, "load_global_water_regions_feature_index", return_value={
                "med": feature(template, "mediterranean"),
                "red": feature(box(4, 0, 5, 1), "marine_macro"),
            }),
        ):
            other = tno_bundle.build_mediterranean_other_water_geom({
                "features": [feature(box(3, 0, 6, 2), "marine_macro")],
            })
        self.assertTrue(other.equals(box(3, 0, 5, 2)))

    def test_mediterranean_unmanaged_template_excludes_outside_construction_extent(self) -> None:
        configs = {
            "west": {"sea_completion_bbox": (0, 1, 2, 3)},
            "east": {"aoi_bbox": (3, 1, 5, 3)},
        }
        # The lower strip models med_open_basin extending into the Red Sea.
        with patch.object(tno_bundle, "ATLANTROPA_REGION_CONFIGS", configs):
            unmanaged = tno_bundle.build_mediterranean_unmanaged_template_geom(box(0, 0, 5, 3))
        self.assertTrue(unmanaged.equals(box(2, 1, 3, 3)))
        self.assertEqual(unmanaged.intersection(box(0, 0, 5, 1)).area, 0)

    def test_mediterranean_generator_appends_closure_without_changing_regional_rows(self) -> None:
        configs = {
            region: {"aoi_bbox": bounds, "group_label": region, "feature_group_id": region}
            for region, bounds in [("west", (0, 0, 2, 2)), ("east", (3, 0, 5, 2))]
        }
        regional_rows = {
            region: tno_bundle.make_feature(box(*config["aoi_bbox"]), {"id": f"ATLSEA_FILL_{region}_1"})
            for region, config in configs.items()
        }

        def regional_completion(region_id, _config, **_kwargs):
            row = regional_rows[region_id]
            return [row], shape(row["geometry"]), {}

        with (
            patch.object(tno_bundle, "ATLANTROPA_REGION_CONFIGS", configs),
            patch.object(tno_bundle, "load_mediterranean_template_water_gdf", return_value=gpd.GeoDataFrame(geometry=[box(0, 0, 5, 2)])),
            patch.object(tno_bundle, "local_land_union", return_value=box(10, 10, 11, 11)),
            patch.object(tno_bundle, "build_region_affine_coeffs", return_value=(None, None)),
            patch.object(tno_bundle, "build_atl_sea_completion_rows", side_effect=regional_completion),
        ):
            rows, sea, diagnostics = tno_bundle.build_atl_sea_from_hgo(
                {}, gpd.GeoDataFrame(geometry=[]), {}, other_water_geom=None,
            )
        self.assertEqual(rows[:2], list(regional_rows.values()))
        self.assertEqual(rows[2]["properties"]["id"], "ATLSEA_FILL_mediterranean_1")
        self.assertTrue(shape(rows[2]["geometry"]).equals(box(2, 0, 3, 2)))
        self.assertTrue(sea.equals(box(0, 0, 5, 2)))
        self.assertEqual(diagnostics["mediterranean_closure"]["remaining_hole_area"], 0)

    def test_checked_in_tno_1962_ionian_cross_region_gaps_are_atlantropa_water(self) -> None:
        topology = json.loads(
            (Path(tno_bundle.SCENARIO_DIR) / "scenario_atlantropa.topo.json").read_text(encoding="utf-8")
        )
        sea = tno_bundle.safe_unary_union([
            _geometry_from_topology_geometry(topology, geometry)
            for geometry in topology["objects"]["scenario_atlantropa"]["geometries"]
            if (geometry.get("properties") or {}).get("atl_color_rule") == "atlantropa_sea"
        ])
        for coordinates in [(18, 36), (20, 36), (20, 38)]:
            with self.subTest(coordinates=coordinates):
                self.assertTrue(sea.covers(Point(*coordinates)), "Cross-region Ionian sea gap")

    def test_checked_in_tno_1962_southwest_greece_gap_is_atlantropa_water(self) -> None:
        scenario_dir = Path(tno_bundle.SCENARIO_DIR)
        atlantropa_topology = json.loads((scenario_dir / "scenario_atlantropa.topo.json").read_text(encoding="utf-8"))
        probe = Point(20.6, 35.0)
        water_hits = []
        for geometry in atlantropa_topology["objects"]["scenario_atlantropa"]["geometries"]:
            props = geometry.get("properties") or {}
            if props.get("atl_render_layer") != "water" or props.get("atl_color_rule") != "atlantropa_sea":
                continue
            decoded = _geometry_from_topology_geometry(atlantropa_topology, geometry)
            if decoded.contains(probe) or decoded.touches(probe):
                water_hits.append(props.get("id"))

        self.assertIn("ATLSEA_FILL_libya_suez_9", water_hits)

    def test_checked_in_tno_1962_atlsea_chunks_keep_d3_small_polygon_orientation(self) -> None:
        def signed_area(ring: list) -> float:
            total = 0.0
            for first, second in zip(ring, ring[1:]):
                total += (float(first[0]) * float(second[1])) - (float(second[0]) * float(first[1]))
            return total / 2.0

        scenario_dir = Path(tno_bundle.SCENARIO_DIR)
        chunk_manifest = json.loads((scenario_dir / "detail_chunks.manifest.json").read_text(encoding="utf-8"))
        checked_chunk_paths = [
            Path(tno_bundle.ROOT).joinpath(*str(chunk.get("url") or "").split("/"))
            for chunk in chunk_manifest.get("chunks", [])
            if chunk.get("layer") == "scenario_atlantropa"
        ]
        self.assertTrue(checked_chunk_paths)
        donor_sea_count = 0
        for chunk_path in checked_chunk_paths:
            payload = json.loads(chunk_path.read_text(encoding="utf-8"))
            for feature in payload.get("features", []):
                props = feature.get("properties", {})
                feature_id = str(props.get("id") or "").strip()
                if not feature_id.startswith("ATLSEA_") or feature_id.startswith("ATLSEA_FILL_"):
                    continue
                if str(props.get("atl_geometry_role") or "").strip().lower() != "donor_sea":
                    continue
                donor_sea_count += 1
                geometry = feature.get("geometry") or {}
                polygons = (
                    [geometry.get("coordinates") or []]
                    if geometry.get("type") == "Polygon"
                    else geometry.get("coordinates") or []
                )
                for polygon in polygons:
                    if polygon:
                        self.assertLessEqual(
                            signed_area(polygon[0]),
                            0.0,
                            f"{feature_id} in {chunk_path.name} must use d3 small-polygon orientation",
                        )

        self.assertGreater(donor_sea_count, 100)

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
        self.assertIn("water_runtime_from_scenario", descriptors)
        self.assertEqual(descriptors["geo_locale"].outputs, ("geo locale checkpoint variants",))
        self.assertEqual(descriptors["water_state"].outputs, ("water state checkpoint artifacts",))
        self.assertEqual(descriptors["water_runtime_from_scenario"].outputs, ("water runtime checkpoint artifacts",))
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

    def test_build_startup_support_stage_admits_and_records_content_addressed_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir()
            checkpoint_dir.mkdir()

            def write_support_outputs(**kwargs) -> None:
                kwargs["runtime_bootstrap_output_path"].write_bytes(b"runtime")
                kwargs["startup_locales_output_path"].write_bytes(b"locales")
                kwargs["startup_geo_aliases_output_path"].write_bytes(b"aliases")

            with (
                patch.object(tno_bundle, "_scenario_build_session_lock", return_value=nullcontext()),
                patch.object(tno_bundle, "_checkpoint_build_lock", return_value=nullcontext()),
                patch.object(tno_bundle, "ensure_runtime_topology_checkpoints"),
                patch.object(tno_bundle, "validate_geo_locale_checkpoint"),
                patch.object(tno_bundle, "build_startup_bootstrap_assets", side_effect=write_support_outputs),
                patch.object(tno_bundle, "_record_checkpoint_stage_outputs") as record_outputs_mock,
            ):
                tno_bundle.build_startup_support_assets_stage(scenario_dir, checkpoint_dir)

            record_kwargs = record_outputs_mock.call_args.kwargs
            artifact_identity = record_kwargs["stage_artifact"]
            stage_signature = record_kwargs["stage_signature"]
            self.assertEqual(stage_signature["artifact_identity"], artifact_identity)
            self.assertRegex(artifact_identity["manifestDigest"], r"^sha256:[0-9a-f]{64}$")
            self.assertRegex(artifact_identity["treeDigest"], r"^sha256:[0-9a-f]{64}$")
            self.assertEqual(
                artifact_identity["sourceIdentity"],
                f"sha256:{stage_signature['signature']}",
            )
            self.assertEqual(
                [entry["path"] for entry in artifact_identity["files"]],
                sorted(
                    [
                        tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME,
                        tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME,
                        tno_bundle.CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
                    ]
                ),
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

    def test_external_publish_checkpoint_validation_uses_tno_profile_and_hard_fails_final_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            checkpoint_dir = root / "tno-water-checkpoints"
            checkpoint_dir.mkdir(parents=True)
            (checkpoint_dir / "manifest.json").write_text("{}", encoding="utf-8")
            errors = [
                f"Required file is missing: {root / 'mapped' / tno_bundle.SCENARIO_ID / 'build_snapshot.json'}",
                f"Required file is missing: {root / 'mapped' / tno_bundle.SCENARIO_ID / 'detail_chunks.manifest.json'}",
                "manifest.source.detail_chunk_manifest_sha256 must match the checked-in artifact sha. manifest=old actual=new.",
                "startup bundle en source.detail_chunk_manifest_sha256 must match manifest.source.detail_chunk_manifest_sha256.",
                "runtime_topology is missing feature ids referenced by owners/cores in strict mode. Sample: ['ATLISL_x'].",
                "manifest.summary.feature_count must equal owners feature count in strict mode.",
                "audit.json summary must match manifest.summary for derived scenario artifacts.",
            ]
            validation_dirs: list[Path] = []

            def fake_validate_publish_bundle_dir(target_dir: Path) -> list[str]:
                validation_dirs.append(target_dir)
                self.assertEqual(target_dir.name, tno_bundle.SCENARIO_ID)
                return errors

            with patch.object(tno_bundle, "validate_publish_bundle_dir", side_effect=fake_validate_publish_bundle_dir):
                filtered = tno_bundle.validate_tno_publish_checkpoint_dir(checkpoint_dir)

        self.assertEqual(len(validation_dirs), 1)
        self.assertEqual(
            filtered,
            [
                f"Required file is missing: {root / 'mapped' / tno_bundle.SCENARIO_ID / 'build_snapshot.json'}",
                f"Required file is missing: {root / 'mapped' / tno_bundle.SCENARIO_ID / 'detail_chunks.manifest.json'}",
                "manifest.source.detail_chunk_manifest_sha256 must match the checked-in artifact sha. manifest=old actual=new.",
                "startup bundle en source.detail_chunk_manifest_sha256 must match manifest.source.detail_chunk_manifest_sha256.",
                "runtime_topology is missing feature ids referenced by owners/cores in strict mode. Sample: ['ATLISL_x'].",
                "manifest.summary.feature_count must equal owners feature count in strict mode.",
                "audit.json summary must match manifest.summary for derived scenario artifacts.",
            ],
        )

    def test_publish_checkpoint_validation_does_not_create_legacy_capital_hints(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            checkpoint_dir = root / "tno-water-checkpoints"
            checkpoint_dir.mkdir(parents=True)
            (checkpoint_dir / "city_overrides.json").write_text("{}", encoding="utf-8")
            validation_dirs: list[Path] = []

            def fake_validate_publish_bundle_dir(target_dir: Path) -> list[str]:
                validation_dirs.append(target_dir)
                return []

            with patch.object(tno_bundle, "validate_publish_bundle_dir", side_effect=fake_validate_publish_bundle_dir):
                errors = tno_bundle.validate_tno_publish_checkpoint_dir(checkpoint_dir)

        self.assertEqual(errors, [])
        self.assertEqual(len(validation_dirs), 1)
        self.assertFalse((checkpoint_dir / "capital_hints.json").exists())

    def test_prechunk_publish_checkpoint_validation_only_allows_missing_build_snapshot(self) -> None:
        errors = [
            "Required file is missing: /tmp/tno_1962/build_snapshot.json",
            "Required file is missing: /tmp/tno_1962/detail_chunks.manifest.json",
            "manifest.summary.feature_count must equal owners feature count in strict mode.",
        ]

        with patch.object(tno_bundle, "validate_tno_publish_checkpoint_dir", return_value=errors):
            filtered = tno_bundle.validate_tno_prechunk_publish_checkpoint_dir(Path("checkpoint"))

        self.assertEqual(
            filtered,
            [
                "Required file is missing: /tmp/tno_1962/detail_chunks.manifest.json",
                "manifest.summary.feature_count must equal owners feature count in strict mode.",
            ],
        )

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

    def test_run_changed_domain_plan_for_water_repairs_contract_outputs_after_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "scenario"
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            events: list[str] = []

            def fake_run_single_stage(stage: str, **kwargs):
                events.append(f"stage:{stage}")
                if stage == tno_bundle.STAGE_WRITE_BUNDLE:
                    self.assertIs(
                        kwargs["validate_publish_checkpoint_dir"],
                        tno_bundle.validate_tno_prechunk_publish_checkpoint_dir,
                    )
                if stage == tno_bundle.STAGE_WATER_RUNTIME_FROM_SCENARIO:
                    return {"runtime_topology_payload": {"objects": {}}}
                return None

            def fake_checkpoint_chunks(*_args, **_kwargs):
                events.append("checkpoint_chunks")

            def fake_repair(*_args, **_kwargs):
                events.append("safe_repair")
                return ["build_snapshot"]

            summary_sync_calls = 0

            def fake_water_summary_sync(*_args, **_kwargs):
                nonlocal summary_sync_calls
                summary_sync_calls += 1
                events.append("water_summary")
                return ["water_summary"] if summary_sync_calls == 1 else []

            with (
                patch.object(tno_bundle, "_stage_signature_is_current", return_value=False),
                patch.object(tno_bundle, "_stage_outputs_are_ready", return_value=False),
                patch.object(tno_bundle, "_run_single_stage", side_effect=fake_run_single_stage),
                patch.object(
                    tno_bundle,
                    "rebuild_water_domain_feature_maps_from_validated_scenario",
                ) as rebuild_maps_mock,
                patch.object(tno_bundle, "build_checkpoint_chunk_assets", side_effect=fake_checkpoint_chunks),
                patch.object(tno_bundle, "apply_safe_scenario_contract_repairs", side_effect=fake_repair) as repair_mock,
                patch.object(tno_bundle, "sync_tno_water_summary_from_scenario", side_effect=fake_water_summary_sync) as summary_sync_mock,
                patch.object(tno_bundle, "record_runtime_topology_stage_signature", return_value=None),
            ):
                result = tno_bundle._run_changed_domain_plan(
                    changed_domain="water",
                    scenario_dir=scenario_dir,
                    checkpoint_dir=checkpoint_dir,
                    publish_scope="all",
                    manual_sync_policy=MANUAL_SYNC_POLICY_STRICT_BLOCK,
                    refresh_named_water_snapshot=False,
                )

            self.assertEqual(
                events[-6:],
                ["stage:chunk_assets", "water_summary", "safe_repair", "water_summary", "safe_repair", "water_summary"],
            )
            self.assertLess(events.index("stage:water_runtime_from_scenario"), events.index("checkpoint_chunks"))
            self.assertLess(events.index("checkpoint_chunks"), events.index("stage:write_bundle"))
            self.assertLess(events.index("stage:write_bundle"), events.index("stage:chunk_assets"))
            rebuild_maps_mock.assert_not_called()
            self.assertEqual(repair_mock.call_count, 2)
            self.assertEqual(summary_sync_mock.call_count, 3)
            self.assertEqual(result["safe_fixes_applied"], ["water_summary", "build_snapshot"])

    def test_run_changed_domain_plan_for_water_repairs_maps_when_runtime_stage_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "scenario"
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            events: list[str] = []

            def fake_run_single_stage(stage: str, **kwargs):
                events.append(f"stage:{stage}")
                return None

            def fake_checkpoint_chunks(*_args, **_kwargs):
                events.append("checkpoint_chunks")

            with (
                patch.object(tno_bundle, "_stage_signature_is_current", return_value=True),
                patch.object(tno_bundle, "_stage_outputs_are_ready", return_value=True),
                patch.object(tno_bundle, "_run_single_stage", side_effect=fake_run_single_stage),
                patch.object(
                    tno_bundle,
                    "rebuild_water_domain_feature_maps_from_validated_scenario",
                ) as rebuild_maps_mock,
                patch.object(tno_bundle, "build_checkpoint_chunk_assets", side_effect=fake_checkpoint_chunks),
                patch.object(tno_bundle, "apply_safe_scenario_contract_repairs", return_value=[]),
                patch.object(tno_bundle, "sync_tno_water_summary_from_scenario", return_value=[]),
                patch.object(tno_bundle, "record_runtime_topology_stage_signature", return_value=None),
            ):
                tno_bundle._run_changed_domain_plan(
                    changed_domain="water",
                    scenario_dir=scenario_dir,
                    checkpoint_dir=checkpoint_dir,
                    publish_scope="all",
                    manual_sync_policy=MANUAL_SYNC_POLICY_STRICT_BLOCK,
                    refresh_named_water_snapshot=False,
                )

            rebuild_maps_mock.assert_not_called()
            self.assertEqual(events, ["checkpoint_chunks", "stage:write_bundle"])

    def test_water_runtime_from_scenario_stage_uses_checked_in_water_surface(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            def write_json(path: Path, payload: object) -> None:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            water_payload = {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "properties": {
                        "id": "fixture_checked_in_water",
                        "name": "Fixture Checked-In Water",
                        "region_group": "marine_detail",
                        "water_type": "bay",
                    },
                    "geometry": mapping(_square(0.0, 0.0)),
                }],
            }
            runtime_payload = {
                "type": "Topology",
                "objects": {
                    "scenario_water": {
                        "type": "GeometryCollection",
                        "geometries": [{
                            "type": "Polygon",
                            "properties": {"id": "stale_water"},
                            "arcs": [],
                        }],
                    },
                    "political": {"type": "GeometryCollection", "geometries": []},
                },
                "arcs": [],
            }
            write_json(scenario_dir / "water_regions.geojson", water_payload)
            write_json(scenario_dir / "runtime_topology.topo.json", runtime_payload)
            write_json(scenario_dir / "runtime_topology.bootstrap.topo.json", runtime_payload)
            write_json(scenario_dir / "manifest.json", {"summary": {"feature_count": 0}})
            write_json(scenario_dir / "audit.json", {"summary": {"feature_count": 0}, "diagnostics": {}})

            def fake_chunk_assets(path: Path) -> None:
                write_json(path / "detail_chunks.manifest.json", {"chunks": []})
                (path / "chunks").mkdir(parents=True, exist_ok=True)

            events: list[str] = []

            with (
                patch.object(tno_bundle, "validate_runtime_topology_water_outputs", return_value={"ok": True}) as validate_mock,
                patch.object(
                    tno_bundle,
                    "rebuild_water_domain_feature_maps_from_validated_scenario",
                    side_effect=lambda *_args, **_kwargs: events.append("rebuild_maps"),
                ) as rebuild_maps_mock,
                patch.object(tno_bundle, "record_runtime_topology_stage_signature", return_value=None),
                patch.object(
                    tno_bundle,
                    "build_checkpoint_chunk_assets",
                    side_effect=lambda path: (events.append("chunks"), fake_chunk_assets(path)),
                ) as chunks_mock,
                patch.object(
                    tno_bundle,
                    "write_tno_coverage_ledgers",
                    side_effect=lambda *_args, **_kwargs: events.append("coverage_ledgers"),
                ) as coverage_ledgers_mock,
                patch.object(
                    tno_bundle,
                    "sync_checkpoint_audit_summary_from_manifest",
                    side_effect=lambda path: events.append("sync_audit"),
                ) as sync_audit_mock,
                patch.object(tno_bundle, "validate_tno_prechunk_publish_checkpoint_dir", return_value=[]) as validate_publish_mock,
            ):
                state = tno_bundle.build_water_runtime_from_scenario_stage(scenario_dir, checkpoint_dir)

            checkpoint_water = json.loads((checkpoint_dir / "water_regions.geojson").read_text(encoding="utf-8"))
            checkpoint_runtime = json.loads((checkpoint_dir / "runtime_topology.topo.json").read_text(encoding="utf-8"))
            water_ids = {
                feature["properties"]["id"]
                for feature in checkpoint_water["features"]
            }
            runtime_water_ids = {
                geometry["properties"]["id"]
                for geometry in checkpoint_runtime["objects"]["scenario_water"]["geometries"]
            }
            self.assertEqual(water_ids, {"fixture_checked_in_water"})
            self.assertEqual(runtime_water_ids, water_ids)
            self.assertEqual(state["water_feature_count"], 1)
            checkpoint_manifest = json.loads((checkpoint_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(checkpoint_manifest["summary"]["tno_water_region_count"], 1)
            self.assertEqual(
                checkpoint_manifest["summary"]["tno_named_marginal_water_count"],
                len(tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS),
            )
            self.assertEqual(events, ["rebuild_maps", "chunks", "coverage_ledgers", "sync_audit"])
            validate_mock.assert_called_once()
            rebuild_maps_mock.assert_called_once_with(scenario_dir, checkpoint_dir)
            chunks_mock.assert_called_once_with(checkpoint_dir)
            coverage_ledgers_mock.assert_called_once_with(checkpoint_dir, checkpoint_manifest)
            sync_audit_mock.assert_called_once_with(checkpoint_dir)
            validate_publish_mock.assert_called_once_with(checkpoint_dir)

    def test_sync_checkpoint_audit_summary_from_manifest_keeps_checkpoint_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            checkpoint_dir = Path(tmp_dir)
            manifest_payload = {
                "scenario_id": "tno_1962",
                "generated_at": "2026-06-02T00:00:00Z",
                "summary": {"feature_count": 130, "water_feature_count": 130},
            }
            audit_payload = {
                "scenario_id": "stale",
                "generated_at": "stale",
                "summary": {"feature_count": 1},
                "checks": [{"id": "kept"}],
            }
            (checkpoint_dir / "manifest.json").write_text(
                json.dumps(manifest_payload),
                encoding="utf-8",
            )
            (checkpoint_dir / "audit.json").write_text(
                json.dumps(audit_payload),
                encoding="utf-8",
            )

            tno_bundle.sync_checkpoint_audit_summary_from_manifest(checkpoint_dir)

            synced_audit = json.loads((checkpoint_dir / "audit.json").read_text(encoding="utf-8"))
            self.assertEqual(synced_audit["scenario_id"], "tno_1962")
            self.assertEqual(synced_audit["generated_at"], "2026-06-02T00:00:00Z")
            self.assertEqual(synced_audit["summary"], manifest_payload["summary"])
            self.assertEqual(synced_audit["checks"], [{"id": "kept"}])

    def test_sync_tno_water_summary_from_scenario_tracks_checked_in_water_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "scenario"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            water_payload = {
                "type": "FeatureCollection",
                "features": [
                    {"type": "Feature", "properties": {"id": "water_a"}, "geometry": mapping(_square(0, 0))},
                    {"type": "Feature", "properties": {"id": "water_b"}, "geometry": mapping(_square(2, 0))},
                ],
            }
            stale_summary = {
                "feature_count": 10,
                "tno_water_region_count": 1,
                "tno_named_marginal_water_count": 1,
            }
            (scenario_dir / "manifest.json").write_text(
                json.dumps({"scenario_id": "tno_1962", "summary": dict(stale_summary)}),
                encoding="utf-8",
            )
            (scenario_dir / "audit.json").write_text(
                json.dumps({
                    "scenario_id": "tno_1962",
                    "summary": dict(stale_summary),
                    "diagnostics": {"tno_named_marginal_water_ids": ["stale_water"]},
                }),
                encoding="utf-8",
            )
            (scenario_dir / "water_regions.geojson").write_text(
                json.dumps(water_payload),
                encoding="utf-8",
            )

            applied = tno_bundle.sync_tno_water_summary_from_scenario(scenario_dir)
            second_applied = tno_bundle.sync_tno_water_summary_from_scenario(scenario_dir)

            self.assertEqual(applied, ["water_summary"])
            self.assertEqual(second_applied, [])
            for filename in ("manifest.json", "audit.json"):
                payload = json.loads((scenario_dir / filename).read_text(encoding="utf-8"))
                self.assertEqual(payload["summary"]["feature_count"], 10)
                self.assertEqual(payload["summary"]["tno_water_region_count"], 2)
                self.assertEqual(
                    payload["summary"]["tno_named_marginal_water_count"],
                    len(tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS),
                )
            audit_payload = json.loads((scenario_dir / "audit.json").read_text(encoding="utf-8"))
            self.assertEqual(
                audit_payload["diagnostics"]["tno_named_marginal_water_ids"],
                [spec["id"] for spec in tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS],
            )

    def test_water_runtime_from_scenario_stage_requires_shared_checkpoint_surface(self) -> None:
        checkpoint_dir = Path("/tmp/checkpoint")
        required = {
            str(path.relative_to(checkpoint_dir)).replace("\\", "/")
            for path in tno_bundle._stage_required_paths(
                tno_bundle.STAGE_WATER_RUNTIME_FROM_SCENARIO,
                scenario_dir=Path("/tmp/scenario"),
                checkpoint_dir=checkpoint_dir,
            )
        }
        expected = {
            *tno_bundle.resolve_publish_filenames(tno_bundle.PUBLISH_SCOPE_ALL),
            "controllers.by_feature.json",
            "detail_chunks.manifest.json",
            "chunks",
        }

        self.assertEqual(required, expected)

    def test_d3_orientation_flags_are_registered_on_source_orientation_owner(self) -> None:
        flagged_ids = {
            str(child_spec.get("id") or "").strip()
            for split_spec in tno_bundle.TNO_OPEN_OCEAN_SPLIT_SPECS
            for child_spec in split_spec.get("children", ())
            if str(child_spec.get("id") or "").strip() and child_spec.get("d3_reverse_orientation")
        }

        self.assertTrue(flagged_ids)
        self.assertTrue(flagged_ids.issubset(tno_bundle.D3_SPHERICAL_SOURCE_POSITIVE_ORIENTATION_FEATURE_IDS))

    def test_clip_open_ocean_split_features_leaves_d3_orientation_to_source_owner(self) -> None:
        signature = inspect.signature(tno_bundle.clip_tno_open_ocean_split_features)
        self.assertNotIn("d3_reverse_orientation_ids", signature.parameters)
        feature_id = next(iter(tno_bundle.D3_SPHERICAL_SOURCE_POSITIVE_ORIENTATION_FEATURE_IDS))
        feature = {
            "type": "Feature",
            "properties": {"id": feature_id, "name": feature_id},
            "geometry": mapping(_square(0.0, 0.0)),
        }

        with patch.object(tno_bundle, "reverse_polygonal_orientation_for_d3") as reverse_mock:
            result = tno_bundle.clip_tno_open_ocean_split_features([feature], {})

        reverse_mock.assert_not_called()
        self.assertEqual(result[0]["properties"]["id"], feature_id)

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

    def test_startup_support_stage_signature_reuses_matching_output_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )

            with patch.object(tno_bundle, "load_stage_signature", return_value=entry):
                self.assertTrue(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

            self.assertEqual(
                [item["filename"] for item in entry["output_identity"]],
                sorted([
                    tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME,
                    tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME,
                    tno_bundle.CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
                ]),
            )
            self.assertTrue(
                all(set(item) == {"filename", "byte_length", "sha256"} for item in entry["output_identity"])
            )

    def test_startup_support_stage_signature_rejects_same_length_content_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            output_path = checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME
            output_path.write_bytes(b"bb")

            with patch.object(tno_bundle, "load_stage_signature", return_value=entry):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

    def test_startup_support_stage_signature_rejects_missing_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            (checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME).unlink()

            with patch.object(tno_bundle, "load_stage_signature", return_value=entry):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

    def test_startup_support_stage_legacy_signature_rebuilds_then_reuses(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            rebuilt_entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            legacy_entry = {key: value for key, value in rebuilt_entry.items() if key != "output_identity"}

            with patch.object(tno_bundle, "load_stage_signature", return_value=legacy_entry):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )
            with patch.object(tno_bundle, "load_stage_signature", return_value=rebuilt_entry):
                self.assertTrue(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

    def test_startup_support_stage_restores_matching_content_addressed_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            artifact_identity = tno_bundle._admit_startup_support_artifact(
                checkpoint_dir,
                stage_signature=entry["signature"],
            )
            entry["artifact_identity"] = artifact_identity
            output_path = checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME
            output_path.write_bytes(b"drifted")

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value=entry),
                patch.object(tno_bundle, "load_stage_artifact", return_value=artifact_identity),
            ):
                self.assertTrue(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )
            self.assertEqual(output_path.read_bytes(), b"aa")

    def test_startup_support_stage_rejects_damaged_cache_without_changing_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            artifact_identity = tno_bundle._admit_startup_support_artifact(
                checkpoint_dir,
                stage_signature=entry["signature"],
            )
            entry["artifact_identity"] = artifact_identity
            output_path = checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME
            output_path.write_bytes(b"checkpoint-drift")
            object_key = next(
                item["sha256"]
                for item in artifact_identity["files"]
                if item["path"] == tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME
            )
            tno_bundle._startup_support_cache(checkpoint_dir)._object_path(object_key).write_bytes(b"cache-drift")

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value=entry),
                patch.object(tno_bundle, "load_stage_artifact", return_value=artifact_identity),
            ):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

            self.assertEqual(output_path.read_bytes(), b"checkpoint-drift")

    def test_startup_support_stage_rejects_manifest_tree_identity_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            artifact_identity = tno_bundle._admit_startup_support_artifact(
                checkpoint_dir,
                stage_signature=entry["signature"],
            )
            drifted_identity = dict(artifact_identity)
            drifted_identity["treeDigest"] = f"sha256:{'0' * 64}"
            entry["artifact_identity"] = drifted_identity

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value=entry),
                patch.object(tno_bundle, "load_stage_artifact", return_value=drifted_identity),
            ):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

    def test_startup_support_forward_replace_failure_rolls_back_all_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            artifact_identity = tno_bundle._admit_startup_support_artifact(
                checkpoint_dir,
                stage_signature=entry["signature"],
            )
            entry["artifact_identity"] = artifact_identity
            filenames = [item["filename"] for item in entry["output_identity"]]
            for index, filename in enumerate(filenames, start=1):
                (checkpoint_dir / filename).write_bytes(f"checkpoint-{index}".encode("utf-8"))
            original_outputs = {
                filename: (checkpoint_dir / filename).read_bytes()
                for filename in filenames
            }
            forward_count = 0

            def fail_second_forward_replace(source: Path, target: Path) -> None:
                nonlocal forward_count
                if Path(source).parent.name == "artifact":
                    forward_count += 1
                    if forward_count == 2:
                        raise OSError("simulated forward replace failure")
                os.replace(source, target)

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value=entry),
                patch.object(tno_bundle, "load_stage_artifact", return_value=artifact_identity),
                patch.object(
                    tno_bundle,
                    "_replace_startup_support_file",
                    side_effect=fail_second_forward_replace,
                ),
            ):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

            self.assertEqual(
                {
                    filename: (checkpoint_dir / filename).read_bytes()
                    for filename in filenames
                },
                original_outputs,
            )

    def test_startup_support_rollback_failure_preserves_backup_and_raises_fatal_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            artifact_identity = tno_bundle._admit_startup_support_artifact(
                checkpoint_dir,
                stage_signature=entry["signature"],
            )
            entry["artifact_identity"] = artifact_identity
            filenames = [item["filename"] for item in entry["output_identity"]]
            for index, filename in enumerate(filenames, start=1):
                (checkpoint_dir / filename).write_bytes(f"checkpoint-{index}".encode("utf-8"))
            original_outputs = {
                filename: (checkpoint_dir / filename).read_bytes()
                for filename in filenames
            }
            forward_count = 0
            rollback_failed = False

            def fail_forward_and_rollback_replace(source: Path, target: Path) -> None:
                nonlocal forward_count, rollback_failed
                source_path = Path(source)
                if source_path.parent.name == "artifact":
                    forward_count += 1
                    if forward_count == 2:
                        raise OSError("simulated forward replace failure")
                elif source_path.parent.name == "rollback" and not rollback_failed:
                    rollback_failed = True
                    raise OSError("simulated rollback replace failure")
                os.replace(source, target)

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value=entry),
                patch.object(tno_bundle, "load_stage_artifact", return_value=artifact_identity),
                patch.object(
                    tno_bundle,
                    "_replace_startup_support_file",
                    side_effect=fail_forward_and_rollback_replace,
                ),
                self.assertRaises(tno_bundle.StartupSupportArtifactRecoveryError) as raised,
            ):
                tno_bundle._stage_signature_is_current(
                    tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                    scenario_dir=scenario_dir,
                    checkpoint_dir=checkpoint_dir,
                )

            recovery_error = raised.exception
            self.assertTrue(recovery_error.backup_path.is_dir())
            self.assertIn(str(recovery_error.backup_path), str(recovery_error))
            self.assertTrue(recovery_error.rollback_errors)
            self.assertEqual(
                {
                    filename: (checkpoint_dir / filename).read_bytes()
                    for filename in filenames[1:]
                },
                {
                    filename: original_outputs[filename]
                    for filename in filenames[1:]
                },
            )
            self.assertEqual(
                {
                    filename: (recovery_error.backup_path / filename).read_bytes()
                    for filename in filenames
                },
                original_outputs,
            )

    def _write_startup_support_outputs(self, root: Path) -> tuple[Path, Path]:
        scenario_dir = root / "scenario"
        checkpoint_dir = root / "checkpoint"
        scenario_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        for filename, contents in (
            (tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, b"aa"),
            (tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME, b"aa"),
            (tno_bundle.CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME, b"aa"),
        ):
            (checkpoint_dir / filename).write_bytes(contents)
        return scenario_dir, checkpoint_dir

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
