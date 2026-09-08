from __future__ import annotations

import hashlib
import json
import importlib.util
import re
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
from shapely import wkb
from shapely.geometry import LineString, Point, Polygon

from tools.check_transport_workbench_manifests import discover_manifest_paths

REPO_ROOT = Path(__file__).resolve().parents[1]
GLOBAL_ROAD_RECIPE = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'source_recipe.manual.json'
GLOBAL_RAIL_RECIPE = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'source_recipe.manual.json'
GLOBAL_ROAD_CATALOG = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'catalog.json'
GLOBAL_RAIL_CATALOG = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'catalog.json'
GLOBAL_ROAD_SHARD_ROOT = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'shards'
GLOBAL_RAIL_REGION_ROOT = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'regions'
GLOBAL_AIRPORT_ROOT = REPO_ROOT / 'data' / 'transport_layers' / 'global_airport'
GLOBAL_PORT_ROOT = REPO_ROOT / 'data' / 'transport_layers' / 'global_port'
GLOBAL_TRANSPORT_CATALOG_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_catalogs.py'
ROAD_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_roads.py'
RAIL_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_rail.py'
POINT_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_points.py'
COMMON_HELPER = REPO_ROOT / 'map_builder' / 'overture_transport_common.py'
COUNTRY_REAL_PACK_BUILDER = REPO_ROOT / 'tools' / 'build_transport_country_real_packs.py'
COUNTRY_PACK_WRITER = REPO_ROOT / 'map_builder' / 'transport_country_pack_writer.py'
SOURCE_EXTRACT_CACHE = REPO_ROOT / 'map_builder' / 'transport_source_extract_cache.py'
TRANSPORT_FAMILY_REGISTRY = REPO_ROOT / 'map_builder' / 'transport_family_registry.py'
TRANSPORT_CAPABILITY_REGISTRY = REPO_ROOT / 'js' / 'core' / 'transport_capability_registry.js'


CHINA_OSM_GPKG_GOLDEN_SHA256 = {
    "china_industrial_zones": {
        "build_audit.json": "0ee3c26190c49a9a243958f989b19cfb26049ce67fd93a2f58dd4ae5921a0d3b",
        "industrial_zones.geojson": "56d798cb2c3ebaa5dea1e0a666e8b354523fb1c77effe6aefc04f6efd0d614ba",
        "industrial_zones.preview.geojson": "56d798cb2c3ebaa5dea1e0a666e8b354523fb1c77effe6aefc04f6efd0d614ba",
        "manifest.json": "d14758fd8d9f3958dc8a4bdad4add836d5d070d6a5da6d84f31fb755fa80fe04",
    },
    "china_logistics_hubs": {
        "build_audit.json": "f6432a2707a2d8990722380fa6e92a2fb4a3c82ed51d38000df0722bbe113aa9",
        "logistics_hubs.geojson": "4ff47b1230d18dabec617eecf345ee099f6781c31388bfdb59166679185c987e",
        "logistics_hubs.preview.geojson": "4ff47b1230d18dabec617eecf345ee099f6781c31388bfdb59166679185c987e",
        "manifest.json": "c6997df25eb09476fa8c4413b795bd240804da7589b35187bdf2ce1faaa9568c",
    },
    "china_rail": {
        "build_audit.json": "220e18b3a63b2f51d8162ca7229d8127718d4d44f6a9ec6414841d67dd4fafab",
        "manifest.json": "3b93bea0375ff33636a5a404fbcb2a5990281efd427939b20d05a2683ea470c7",
        "rail_stations_major.geojson": "771815dbf268c0b0ed0cbefdcc2170f88c1dd5657390e2776c483a736bae7181",
        "rail_stations_major.preview.geojson": "771815dbf268c0b0ed0cbefdcc2170f88c1dd5657390e2776c483a736bae7181",
        "railways.preview.topo.json": "930fc801ce48d72c6f6df335e75f08d85a75515849e02fba0902f4df698986c5",
        "railways.topo.json": "b2a73e65f0911f824d6fc506b8abc1cae8dc6e8d1dffac283fc9753dc9df08cc",
    },
    "china_road": {
        "build_audit.json": "a3ff1181d8e44e0a348b5d63348a2af359084878d228aead2fe5269a953a5918",
        "manifest.json": "8d88ce0747245950c657fb3b17430d32e24c6253be4c11b20c4f1040fe7c98e0",
        "road_labels.geojson": "005f1af730534e227432f336d3eea949a5ed95280070c5ae32247b79e1dbe022",
        "road_labels.preview.geojson": "4d622444e2b7b38a6bc00fc9e526e8e9cdc4c5b0877ccee43603c61a3d193f70",
        "roads.preview.topo.json": "0ed7eb872c9a244f0272c96cae044643900e31f6a6fe3c632ad298c0c8f0fe3a",
        "roads.topo.json": "68aae6c81de465eae856e0824f1be286b82d885854c1b28241ee3a94aa840ad6",
    },
}


class GlobalTransportBuilderContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pyarrow_available = importlib.util.find_spec("pyarrow") is not None

    def test_new_global_transport_files_exist(self) -> None:
        for path in (
            GLOBAL_ROAD_RECIPE,
            GLOBAL_RAIL_RECIPE,
            GLOBAL_TRANSPORT_CATALOG_BUILDER,
            ROAD_BUILDER,
            RAIL_BUILDER,
            POINT_BUILDER,
            COMMON_HELPER,
            COUNTRY_REAL_PACK_BUILDER,
            COUNTRY_PACK_WRITER,
            SOURCE_EXTRACT_CACHE,
        ):
            self.assertTrue(path.exists(), path.as_posix())

    def test_country_real_pack_builder_uses_shared_pack_writer_and_extract_cache(self) -> None:
        builder_content = COUNTRY_REAL_PACK_BUILDER.read_text(encoding='utf-8')
        writer_content = COUNTRY_PACK_WRITER.read_text(encoding='utf-8')
        extract_cache_content = SOURCE_EXTRACT_CACHE.read_text(encoding='utf-8')
        registry_content = TRANSPORT_FAMILY_REGISTRY.read_text(encoding='utf-8')

        self.assertIn('from map_builder.transport_country_pack_writer import (', builder_content)
        self.assertIn('write_country_pack', builder_content)
        self.assertIn('from map_builder.transport_family_registry import (', builder_content)
        self.assertIn('from map_builder.transport_source_extract_cache import (', builder_content)
        self.assertIn('marker_matches', builder_content)
        self.assertIn('source_marker_from_signature', builder_content)
        self.assertIn('write_marker', builder_content)
        self.assertIn('class FamilySpec', registry_content)
        self.assertIn('class GpkgLayerGroup', registry_content)
        self.assertNotRegex(builder_content, r'(?m)^def feature_collection\(')
        self.assertNotRegex(builder_content, r'(?m)^def topology_payload\(')
        self.assertNotRegex(builder_content, r'(?m)^def file_signature\(')
        self.assertNotRegex(builder_content, r'(?m)^def source_signature\(')
        self.assertNotIn('def build_osm_pbf_road_pack', builder_content)
        self.assertNotIn('def build_osm_pbf_rail_pack', builder_content)
        self.assertNotIn('"default": {"label": "default"', builder_content)
        self.assertNotIn('"mainMapEligible": True', builder_content)
        self.assertNotIn('"apply_bridge_supported": True', builder_content)
        self.assertNotIn('write_json(output_dir / "manifest.json"', builder_content)
        self.assertIn('def write_country_pack(', writer_content)
        self.assertIn('def write_country_pack_layers(', writer_content)
        self.assertIn('def country_pack_layer_suffix(', writer_content)
        self.assertIn('def source_marker_from_signature(', extract_cache_content)
        self.assertIn('def marker_matches(', extract_cache_content)

    def test_osm_gpkg_family_registry_covers_real_country_builders(self) -> None:
        from map_builder.transport_family_registry import OSM_GPKG_FAMILY_SPECS, osm_gpkg_family_for_pack_id

        expected = {
            "road": ("line", "line", {"roads": ("gis_osm_roads_free",)}),
            "rail": ("line", "line", {"railways": ("gis_osm_railways_free",), "rail_stations_major": ("gis_osm_transport_free",)}),
            "industrial_zones": ("point", "polygon_or_point", {"industrial_zones": ("gis_osm_landuse_a_free",)}),
            "logistics_hubs": ("point", "point", {"logistics_hubs": ("gis_osm_transport_free", "gis_osm_transport_a_free")}),
        }
        for family, (output_kind, capability_kind, outputs) in expected.items():
            with self.subTest(family=family):
                spec = OSM_GPKG_FAMILY_SPECS[family]
                self.assertEqual(spec.output_geometry_kind, output_kind)
                self.assertEqual(spec.capability_geometry_kind, capability_kind)
                self.assertEqual(
                    {output.output_layer: tuple(layer.source_layer for layer in output.source_layers) for output in spec.outputs},
                    outputs,
                )
                self.assertTrue(all(layer.row_builder_id for layer in spec.gpkg_layers))
                self.assertTrue(all(output.dedup_subset for output in spec.outputs))
                self.assertTrue(all(output.scope_strategy in {"line", "carrier"} for output in spec.outputs))
                self.assertTrue(spec.audit_shape)

        for pack_id, family in {
            "china_road": "road",
            "china_rail": "rail",
            "china_industrial_zones": "industrial_zones",
            "china_logistics_hubs": "logistics_hubs",
            "india_road": "road",
            "russia_logistics_hubs": "logistics_hubs",
        }.items():
            with self.subTest(pack_id=pack_id):
                self.assertEqual(osm_gpkg_family_for_pack_id(pack_id), family)

    def test_osm_gpkg_family_geometry_matches_frontend_capability_registry(self) -> None:
        from map_builder.transport_family_registry import OSM_GPKG_FAMILY_SPECS

        registry_text = TRANSPORT_CAPABILITY_REGISTRY.read_text(encoding="utf-8")
        frontend_geometry = {
            match.group("family"): match.group("geometry")
            for match in re.finditer(
                r"(?P<family>[a-z_]+): createTransportCapabilityFamily\(\{.*?geometryKind: \"(?P<geometry>[a-z_]+)\"",
                registry_text,
                re.S,
            )
        }
        for family, spec in OSM_GPKG_FAMILY_SPECS.items():
            with self.subTest(family=family):
                self.assertEqual(frontend_geometry[family], spec.capability_geometry_kind)

    def test_country_pack_writer_assembles_manifest_audit_and_bridge_contract(self) -> None:
        from map_builder.transport_country_pack_writer import write_country_pack
        from map_builder.transport_workbench_contracts import finalize_transport_manifest

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output_dir = root / 'test_pack'

            def rel_path(path: Path) -> str:
                return path.relative_to(root).as_posix()

            line = gpd.GeoDataFrame(
                [{'id': 'r1', 'name': 'Test Road', 'geometry': LineString([(1.0, 2.0), (3.0, 4.0)])}],
                geometry='geometry',
                crs='EPSG:4326',
            )
            labels = gpd.GeoDataFrame(
                [{'id': 'r1_label', 'name': 'Test Road', 'geometry': LineString([(1.0, 2.0), (3.0, 4.0)])}],
                geometry='geometry',
                crs='EPSG:4326',
            )
            recipe = {
                'version': 7,
                'source_truth': 'real_source_cache_only',
                'geometry_truth': 'fixture_geometry',
                'source_signature': {'fixture': {'sha256': 'abc123'}},
            }

            result = write_country_pack(
                output_dir,
                pack_id='test_road',
                family='road',
                geometry_kind='line',
                country='testland',
                recipe=recipe,
                preview={'roads': line.head(1), 'road_labels': labels.head(1)},
                full={'roads': line, 'road_labels': labels},
                audit_extra={'matched_count': 1},
                build_command='python tools/build_transport_country_real_packs.py --pack test_road',
                generated_at='2026-06-14T00:00:00Z',
                rel_path=rel_path,
                carrier_asset_key='testland_carrier',
                carrier_extension={'carrier_asset_key': 'stale_carrier', 'scope': 'country'},
                finalize_manifest=finalize_transport_manifest,
                main_map_consumer_keys=('roads', 'road_labels'),
                main_map_sidecars={'road_labels': {'required': True}},
            )

            manifest = json.loads((output_dir / 'manifest.json').read_text(encoding='utf-8'))
            audit = json.loads((output_dir / 'build_audit.json').read_text(encoding='utf-8'))

            self.assertEqual(result['manifest'], manifest)
            self.assertEqual(result['audit'], audit)
            self.assertEqual(manifest['default_variant'], 'default')
            self.assertEqual(manifest['paths'], manifest['variants']['default']['paths'])
            self.assertEqual(manifest['feature_counts'], manifest['variants']['default']['feature_counts'])
            self.assertEqual(audit['feature_counts'], manifest['feature_counts'])
            self.assertEqual(audit['source_signature'], manifest['source_signature'])
            self.assertEqual(manifest['source_signature'], {'fixture': {'sha256': 'abc123'}})
            self.assertEqual(manifest['carrier_asset_key'], 'testland_carrier')
            self.assertEqual(manifest['extensions']['carrier']['carrier_asset_key'], 'testland_carrier')
            self.assertEqual(manifest['extensions']['road']['carrier_asset_key'], 'testland_carrier')
            self.assertEqual(manifest['extensions']['carrier']['scope'], 'country')
            self.assertEqual(manifest['extensions']['road']['scope'], 'country')
            self.assertTrue(manifest['mainMapEligible'])
            self.assertTrue(manifest['apply_bridge_supported'])
            self.assertEqual(manifest['main_map_consumer']['supported_keys'], ['roads', 'road_labels'])
            self.assertEqual(manifest['sidecars'], {'road_labels': {'required': True}})
            self.assertEqual(manifest['clip_bbox'], [1.0, 2.0, 3.0, 4.0])
            self.assertEqual(manifest['paths']['preview']['roads'], 'test_pack/roads.preview.topo.json')
            self.assertEqual(manifest['paths']['preview']['road_labels'], 'test_pack/road_labels.preview.geojson')

    def test_china_osm_gpkg_country_builders_keep_byte_stable_golden_outputs(self) -> None:
        import tools.build_transport_country_real_packs as builder

        fixture_source_id = "geofabrik_gpkg_china_fixture"
        fixture_path = Path("fixture.gpkg")

        def fixture_frame(layer: str) -> gpd.GeoDataFrame:
            if layer == "gis_osm_roads_free":
                return gpd.GeoDataFrame(
                    [
                        {"osm_id": "100", "fclass": "motorway", "name": "Alpha Expressway", "ref": "G1", "geometry": LineString([(100, 30), (101, 31)])},
                        {"osm_id": "101", "fclass": "tertiary", "name": "Local Connector", "ref": "", "geometry": LineString([(101, 30), (102, 30.5)])},
                    ],
                    geometry="geometry",
                    crs="EPSG:4326",
                )
            if layer == "gis_osm_railways_free":
                return gpd.GeoDataFrame(
                    [
                        {"osm_id": "200", "fclass": "rail", "name": "North Rail", "geometry": LineString([(100, 32), (101, 33)])},
                        {"osm_id": "201", "fclass": "tram", "name": "City Tram", "geometry": LineString([(100.2, 32), (100.3, 32.2)])},
                    ],
                    geometry="geometry",
                    crs="EPSG:4326",
                )
            if layer == "gis_osm_transport_free":
                return gpd.GeoDataFrame(
                    [
                        {"osm_id": "300", "fclass": "railway_station", "name": "Central Station", "geometry": Point(100.5, 32.5)},
                        {"osm_id": "301", "fclass": "airport", "name": "Cargo Airport", "geometry": Point(101.5, 31.5)},
                    ],
                    geometry="geometry",
                    crs="EPSG:4326",
                )
            if layer == "gis_osm_landuse_a_free":
                return gpd.GeoDataFrame(
                    [
                        {"osm_id": "400", "fclass": "industrial", "name": "River Industrial Park", "geometry": Polygon([(100, 30), (101, 30), (101, 31), (100, 31), (100, 30)])},
                        {"osm_id": "401", "fclass": "industrial", "name": "", "geometry": Polygon([(102, 30), (103, 30), (103, 31), (102, 31), (102, 30)])},
                    ],
                    geometry="geometry",
                    crs="EPSG:4326",
                )
            if layer == "gis_osm_transport_a_free":
                return gpd.GeoDataFrame(
                    [
                        {"osm_id": "500", "fclass": "port", "name": "Dry Port", "geometry": Polygon([(104, 30), (105, 30), (105, 31), (104, 31), (104, 30)])},
                    ],
                    geometry="geometry",
                    crs="EPSG:4326",
                )
            raise AssertionError(layer)

        def fake_read_geofabrik_gpkg_layer(path: Path, layer: str, columns: list[str], *, where: str = "") -> gpd.GeoDataFrame:
            return fixture_frame(layer)

        def fake_source_recipe_for(pack_id: str, output_dir: Path) -> tuple[dict[str, object], dict[str, object]]:
            recipe = {
                "version": 1,
                "source_truth": "fixture_source",
                "geometry_truth": "fixture_geometry",
                "source_signature": {"fixture": {"sha256": f"{pack_id}-sha"}},
            }
            builder.write_json(output_dir / "source_recipe.manual.json", recipe)
            return recipe, {"ready": True}

        with tempfile.TemporaryDirectory() as tmp:
            output_root = Path(tmp)
            def fixed_rel(path: Path) -> str:
                return path.relative_to(output_root).as_posix()

            with (
                patch.object(builder, "OUTPUT_ROOT", output_root),
                patch.object(builder, "rel", fixed_rel),
                patch.object(builder, "utc_now", lambda: "2026-06-15T00:00:00Z"),
                patch.object(builder, "geofabrik_gpkg_paths", lambda pack_id: [(fixture_source_id, fixture_path)]),
                patch.object(builder, "read_geofabrik_gpkg_layer", fake_read_geofabrik_gpkg_layer),
                patch.object(builder, "source_recipe_for", fake_source_recipe_for),
                patch.object(builder, "filter_lines_to_carrier_or_empty", lambda gdf, country_key: gdf),
                patch.object(builder, "clip_to_carrier_or_empty", lambda gdf, country_key, label=None: gdf),
                patch.object(builder, "clip_to_carrier", lambda gdf, country_key, label=None: gdf),
                patch.object(builder, "filter_to_carrier", lambda gdf, country_key, label=None: gdf),
            ):
                builder.build_osm_gpkg_registry_pack("china_road", "china")
                builder.build_osm_gpkg_registry_pack("china_rail", "china")
                builder.build_osm_gpkg_registry_pack("china_industrial_zones", "china")
                builder.build_osm_gpkg_registry_pack("china_logistics_hubs", "china")

            for pack_id, expected_hashes in CHINA_OSM_GPKG_GOLDEN_SHA256.items():
                with self.subTest(pack_id=pack_id):
                    pack_dir = output_root / pack_id
                    actual_hashes = {
                        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in sorted(pack_dir.iterdir())
                        if path.is_file() and path.name != "source_recipe.manual.json"
                    }
                    self.assertEqual(actual_hashes, expected_hashes)

    def test_global_road_recipe_uses_overture_single_source_policy(self) -> None:
        payload = json.loads(GLOBAL_ROAD_RECIPE.read_text(encoding='utf-8'))
        self.assertEqual(payload.get('source_policy'), 'overture_only_checked_in_v1')
        self.assertEqual(payload.get('family'), 'road')
        self.assertEqual(payload.get('primary_source', {}).get('provider'), 'Overture Maps Foundation')
        self.assertEqual(payload.get('primary_source', {}).get('subtype'), 'road')

    def test_global_rail_recipe_uses_overture_single_source_policy(self) -> None:
        payload = json.loads(GLOBAL_RAIL_RECIPE.read_text(encoding='utf-8'))
        self.assertEqual(payload.get('source_policy'), 'overture_only_checked_in_v1')
        self.assertEqual(payload.get('family'), 'rail')
        self.assertEqual(payload.get('primary_source', {}).get('provider'), 'Overture Maps Foundation')
        self.assertEqual(payload.get('primary_source', {}).get('subtype'), 'rail')

    def test_builders_emit_checked_in_manifest_contract(self) -> None:
        for builder in (ROAD_BUILDER, RAIL_BUILDER, POINT_BUILDER):
            content = builder.read_text(encoding='utf-8')
            self.assertIn('finalize_transport_manifest', content)
            self.assertIn('distribution_tier', content)
            self.assertIn('feature_counts', content)
            self.assertIn('build_audit', content)

    def test_road_recipe_declares_backbone_only_phase_a(self) -> None:
        payload = json.loads(GLOBAL_ROAD_RECIPE.read_text(encoding='utf-8'))
        rules = payload.get('product_rules', {})
        self.assertEqual(rules.get('preview_scope'), 'motorway + trunk only')
        self.assertEqual(rules.get('phase_a_scope'), 'motorway + trunk backbone only')
        self.assertEqual(rules.get('labels_phase'), 'phase_b_pending_ref_sidecar')
        self.assertNotIn('primary', rules.get('preview_min_length_m', {}))
        self.assertNotIn('primary', rules.get('full_min_length_m', {}))
        self.assertEqual(payload.get('primary_source', {}).get('classes'), ['motorway', 'trunk'])

    def test_rail_recipe_declares_line_only_phase_a(self) -> None:
        payload = json.loads(GLOBAL_RAIL_RECIPE.read_text(encoding='utf-8'))
        rules = payload.get('product_rules', {})
        self.assertEqual(rules.get('phase_a_scope'), 'line_only_backbone')
        self.assertEqual(rules.get('stations_phase'), 'phase_b_pending_major_station_source')
        self.assertEqual(
            rules.get('focus_region_priority'),
            [
                'japan',
                'europe',
                'russia',
                'east_asia',
                'north_america',
                'south_america',
                'africa_middle_east',
                'south_southeast_asia_oceania',
            ],
        )
        self.assertIn('low_priority', rules.get('region_policy', {}))
        self.assertEqual(
            rules.get('region_policy', {}).get('low_priority', {}).get('drop_unnamed_standard_gauge'),
            True,
        )

    def test_global_transport_catalog_baseline_counts_are_current(self) -> None:
        road_catalog = json.loads(GLOBAL_ROAD_CATALOG.read_text(encoding='utf-8'))
        rail_catalog = json.loads(GLOBAL_RAIL_CATALOG.read_text(encoding='utf-8'))
        self.assertEqual(len(road_catalog.get('entries') or []), 39)
        self.assertEqual(len(rail_catalog.get('entries') or []), 25)

    def test_global_transport_catalogs_record_phase_status_and_class_buckets(self) -> None:
        road_catalog = json.loads(GLOBAL_ROAD_CATALOG.read_text(encoding='utf-8'))
        rail_catalog = json.loads(GLOBAL_RAIL_CATALOG.read_text(encoding='utf-8'))
        road_classes = Counter()
        rail_classes = Counter()

        for entry in road_catalog.get('entries') or []:
            manifest_path = REPO_ROOT / entry['manifest_path']
            audit_path = manifest_path.with_name('build_audit.json')
            self.assertTrue(audit_path.exists(), audit_path.as_posix())
            audit = json.loads(audit_path.read_text(encoding='utf-8'))
            road_classes.update(audit.get('class_counts') or {})
            self.assertEqual(entry.get('phase_status', {}).get('road_labels'), 'phase_b_pending_ref_sidecar')

        for entry in rail_catalog.get('entries') or []:
            manifest_path = REPO_ROOT / entry['manifest_path']
            audit_path = manifest_path.with_name('build_audit.json')
            self.assertTrue(audit_path.exists(), audit_path.as_posix())
            audit = json.loads(audit_path.read_text(encoding='utf-8'))
            rail_classes.update(audit.get('class_counts') or audit.get('line_class_counts') or {})
            self.assertEqual(entry.get('phase_status', {}).get('major_stations'), 'phase_b_pending_source')

        self.assertGreater(road_classes['motorway'], 0)
        self.assertGreater(road_classes['trunk'], 0)
        self.assertEqual(road_classes['primary'], 0)
        self.assertEqual(road_classes['secondary'], 0)
        self.assertGreater(rail_classes['mainline'], 0)
        self.assertGreater(rail_classes['regional'], 0)
        self.assertGreater(rail_classes['secondary'], 0)

    def test_road_label_builder_handles_empty_input(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import build_label_candidates, empty_roads_frame

        labels = build_label_candidates(empty_roads_frame())
        self.assertEqual(len(labels), 0)
        self.assertIn('geometry', labels.columns)

    def test_preview_roads_excludes_primary(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import build_preview_roads

        gdf = gpd.GeoDataFrame(
            [
                {'id': 'm1', 'name': 'M1', 'ref': 'M1', 'class': 'motorway', 'source': 'Overture', 'length_m': 20_000.0, 'reveal_rank': 1, 'priority': 3, 'geometry': LineString([(0, 0), (1, 0)])},
                {'id': 't1', 'name': 'T1', 'ref': 'T1', 'class': 'trunk', 'source': 'Overture', 'length_m': 30_000.0, 'reveal_rank': 2, 'priority': 2, 'geometry': LineString([(0, 1), (1, 1)])},
                {'id': 'p1', 'name': 'P1', 'ref': 'P1', 'class': 'primary', 'source': 'Overture', 'length_m': 200_000.0, 'reveal_rank': 2, 'priority': 1, 'geometry': LineString([(0, 2), (1, 2)])},
            ],
            geometry='geometry',
            crs='EPSG:4326',
        )

        preview = build_preview_roads(gdf)
        self.assertEqual(set(preview['class'].tolist()), {'motorway', 'trunk'})

    def test_normalize_road_batch_remeasures_lengths_after_simplify(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import normalize_road_batch

        original = LineString([
            (0.0, 0.0),
            (0.0, 0.10),
            (0.10, 0.10),
            (0.10, 0.20),
        ])
        simplified = LineString([
            (0.0, 0.0),
            (0.10, 0.10),
        ])

        def fake_simplify(subset: gpd.GeoDataFrame, tolerance_m: float) -> gpd.GeoDataFrame:
            updated = subset.copy()
            updated['geometry'] = [simplified] * len(updated)
            return updated

        with patch('tools.build_global_transport_roads.simplify_lines', side_effect=fake_simplify):
            normalized = normalize_road_batch([
                {'id': 't1', 'class': 'trunk', 'names': {'primary': 'T1'}, 'geometry': wkb.dumps(original)},
            ])

        self.assertEqual(len(normalized), 1)
        self.assertLess(float(normalized.iloc[0]['length_m']), 22_000.0)
        self.assertEqual(int(normalized.iloc[0]['reveal_rank']), 2)

    def test_normalize_road_batch_reapplies_full_threshold_after_simplify(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import normalize_road_batch

        original = LineString([
            (0.0, 0.0),
            (0.0, 0.02),
            (0.02, 0.02),
        ])
        simplified = LineString([
            (0.0, 0.0),
            (0.01, 0.01),
        ])

        def fake_simplify(subset: gpd.GeoDataFrame, tolerance_m: float) -> gpd.GeoDataFrame:
            updated = subset.copy()
            updated['geometry'] = [simplified] * len(updated)
            return updated

        with patch('tools.build_global_transport_roads.simplify_lines', side_effect=fake_simplify):
            normalized = normalize_road_batch([
                {'id': 't2', 'class': 'trunk', 'names': {'primary': 'T2'}, 'geometry': wkb.dumps(original)},
            ])

        self.assertEqual(len(normalized), 0)

    def test_full_roads_only_keep_motorway_and_trunk(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import build_full_roads

        gdf = gpd.GeoDataFrame(
            [
                {'id': 't1', 'name': 'T1', 'ref': 'T1', 'class': 'trunk', 'source': 'Overture', 'length_m': 30_000.0, 'reveal_rank': 2, 'priority': 2, 'geometry': LineString([(0, 0), (1, 0)])},
                {'id': 'p1', 'name': 'P1', 'ref': 'P1', 'class': 'primary', 'source': 'Overture', 'length_m': 150_000.0, 'reveal_rank': 2, 'priority': 1, 'geometry': LineString([(0, 1), (1, 1)])},
                {'id': 'p2', 'name': 'P2', 'ref': '', 'class': 'primary', 'source': 'Overture', 'length_m': 150_000.0, 'reveal_rank': 2, 'priority': 1, 'geometry': LineString([(0, 2), (1, 2)])},
                {'id': 'p3', 'name': 'P3', 'ref': 'P3', 'class': 'primary', 'source': 'Overture', 'length_m': 70_000.0, 'reveal_rank': 3, 'priority': 1, 'geometry': LineString([(0, 3), (1, 3)])},
            ],
            geometry='geometry',
            crs='EPSG:4326',
        )

        full = build_full_roads(gdf)
        self.assertEqual(set(full['id'].tolist()), {'t1'})

    def test_road_batch_mapping_drops_primary_before_geometry(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import map_batch_rows

        rows = map_batch_rows([
            {'id': 'p1', 'class': 'primary', 'names': {'primary': 'P1'}, 'routes': [], 'sources': [], 'geometry': b'noop'},
            {'id': 'p2', 'class': 'primary', 'names': {'primary': 'P2'}, 'routes': [{'ref': 'P2'}], 'sources': [], 'geometry': b'noop'},
            {'id': 't1', 'class': 'trunk', 'names': {'primary': 'T1'}, 'routes': [], 'sources': [], 'geometry': b'noop'},
        ])

        self.assertEqual([row['id'] for row in rows], ['t1'])

    def test_road_shard_center_assignment_is_deterministic(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import shard_bbox_center_matches

        shard = {'id': 'w030_e000', 'lon_min': -30.0, 'lon_max': 0.0}
        self.assertTrue(shard_bbox_center_matches({'xmin': -20.0, 'xmax': -10.0}, shard))
        self.assertFalse(shard_bbox_center_matches({'xmin': 5.0, 'xmax': 10.0}, shard))

    def test_road_shards_use_finer_dense_region_splits(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import ROAD_SHARDS

        shard_ids = {entry['id'] for entry in ROAD_SHARDS}
        self.assertIn('e000_e005', shard_ids)
        self.assertIn('e010_e012', shard_ids)
        self.assertIn('e120_e125', shard_ids)
        self.assertIn('w090_w085', shard_ids)
        self.assertIn('w075_w070', shard_ids)
        self.assertIn('w082p5_w080', shard_ids)
        self.assertNotIn('e000_e030', shard_ids)
        self.assertNotIn('e010_e015', shard_ids)
        self.assertNotIn('w090_w080', shard_ids)
        self.assertNotIn('e090_e100', shard_ids)

    def test_checked_in_road_shard_dirs_match_builder_truth(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import ROAD_SHARDS

        expected_ids = {entry['id'] for entry in ROAD_SHARDS}
        actual_ids = {path.name for path in GLOBAL_ROAD_SHARD_ROOT.iterdir() if path.is_dir()}
        self.assertEqual(actual_ids, expected_ids)

    def test_custom_road_shard_spec_supports_dense_manual_splits(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import get_custom_shard_spec

        shard = get_custom_shard_spec('e010_e012', 10.0, 12.0)
        self.assertEqual(shard['id'], 'e010_e012')
        self.assertEqual(shard['lon_min'], 10.0)
        self.assertEqual(shard['lon_max'], 12.0)

    def test_road_builder_uses_single_normalized_chunk_truth(self) -> None:
        content = ROAD_BUILDER.read_text(encoding='utf-8')
        self.assertNotIn('preview_chunks', content)
        self.assertNotIn('preview_label_chunks', content)
        self.assertNotIn('label_chunks', content)

    def test_road_builder_writes_labels_after_both_backbones(self) -> None:
        content = ROAD_BUILDER.read_text(encoding='utf-8')
        preview_topo_index = content.index("write_json(paths['roads_preview']")
        full_topo_index = content.index("write_json(paths['roads_full']")
        preview_labels_index = content.index("write_json(paths['labels_preview']")
        full_labels_index = content.index("write_json(paths['labels_full']")
        self.assertLess(preview_topo_index, full_topo_index)
        self.assertLess(full_topo_index, preview_labels_index)
        self.assertLess(preview_labels_index, full_labels_index)

    def test_road_phase_a_keeps_labels_out_of_manifest(self) -> None:
        content = ROAD_BUILDER.read_text(encoding='utf-8')
        self.assertIn("'phase_b_reserved_outputs': ['road_labels']", content)
        self.assertIn("'road_labels': 'phase_b_pending_ref_sidecar'", content)
        self.assertNotIn("'road_labels': str(ROAD_LABELS_PATH.relative_to(ROOT)).replace('\\\\', '/')", content)
        self.assertIn("OUTPUT_DIR / 'shards' / shard_spec['id']", content)
        self.assertIn("build_command = f\"{build_command} --shard {shard_spec['id']}\"", content)

    def test_rail_builder_declares_phase_logs(self) -> None:
        content = RAIL_BUILDER.read_text(encoding='utf-8')
        self.assertIn("log_progress('starting normalized rail chunk scan')", content)
        self.assertIn("log_progress('starting preview backbone assembly')", content)
        self.assertIn("log_progress('starting full backbone assembly')", content)

    def test_road_catalog_matches_current_shard_manifests(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import ROAD_SHARDS

        catalog = json.loads(GLOBAL_ROAD_CATALOG.read_text(encoding='utf-8'))
        self.assertEqual(catalog.get('family'), 'road')
        self.assertEqual(catalog.get('distribution_tier'), 'sharded_manifest_catalog')

        entries = catalog.get('entries', [])
        expected_ids = [entry['id'] for entry in ROAD_SHARDS]
        self.assertEqual([entry.get('id') for entry in entries], expected_ids)

        for shard, entry in zip(ROAD_SHARDS, entries):
            manifest_path = REPO_ROOT / entry['manifest_path']
            self.assertTrue(manifest_path.exists(), manifest_path.as_posix())
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            self.assertEqual(entry.get('lon_min'), float(shard['lon_min']))
            self.assertEqual(entry.get('lon_max'), float(shard['lon_max']))
            self.assertEqual(
                manifest.get('build_command'),
                f"python tools/build_global_transport_roads.py --shard {shard['id']}",
            )
            self.assertEqual(
                ((manifest.get('extensions') or {}).get('road') or {}).get('shard'),
                {
                    'id': shard['id'],
                    'lon_min': float(shard['lon_min']),
                    'lon_max': float(shard['lon_max']),
                },
            )

    def test_catalog_builder_defaults_to_road_until_rail_outputs_exist(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_catalogs import parse_args

        with patch('sys.argv', ['build_global_transport_catalogs.py']):
            args = parse_args()

        self.assertEqual(args.family, 'road')

    def test_rail_focus_region_prefilter_drops_low_priority_noise(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import map_batch_rows

        rows = map_batch_rows([
            {
                'id': 'focus_jp',
                'class': 'standard_gauge',
                'bbox': {'xmin': 139.0, 'xmax': 140.0, 'ymin': 35.0, 'ymax': 36.0},
                'names': {},
                'sources': [],
                'geometry': b'noop',
            },
        ], region_id='japan')

        self.assertEqual([row['id'] for row in rows], ['focus_jp'])
        self.assertEqual(rows[0]['focus_region'], 'japan')

        low_priority_rows = map_batch_rows([
            {
                'id': 'low_priority_unnamed',
                'class': 'standard_gauge',
                'bbox': {'xmin': 20.0, 'xmax': 21.0, 'ymin': -30.0, 'ymax': -29.0},
                'names': {},
                'sources': [],
                'geometry': b'noop',
            },
            {
                'id': 'low_priority_unknown',
                'class': 'unknown',
                'bbox': {'xmin': 20.0, 'xmax': 21.0, 'ymin': -30.0, 'ymax': -29.0},
                'names': {'primary': ''},
                'sources': [],
                'geometry': b'noop',
            },
        ], region_id='low_priority')
        self.assertEqual(low_priority_rows, [])

    def test_rail_focus_region_priority_prefers_japan_over_east_asia(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import assign_focus_region_id

        row_bbox = {'xmin': 138.0, 'xmax': 139.0, 'ymin': 35.0, 'ymax': 36.0}
        self.assertEqual(assign_focus_region_id(row_bbox), 'japan')

    def test_rail_focus_region_priority_prefers_europe_over_russia(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import assign_focus_region_id

        row_bbox = {'xmin': 34.0, 'xmax': 35.0, 'ymin': 55.0, 'ymax': 56.0}
        self.assertEqual(assign_focus_region_id(row_bbox), 'europe')

    def test_rail_adjacent_shard_assignment_uses_center_point(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import get_shard_spec, shard_bbox_center_matches

        west_shard = get_shard_spec('eu_e010_e025')
        east_shard = get_shard_spec('eu_e025_e045')
        boundary_bbox = {'xmin': 24.0, 'xmax': 26.0, 'ymin': 50.0, 'ymax': 51.0}
        self.assertTrue(shard_bbox_center_matches(boundary_bbox, east_shard))
        self.assertFalse(shard_bbox_center_matches(boundary_bbox, west_shard))

    def test_rail_region_and_shard_specs_exist(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import FOCUS_REGION_SPECS, RAIL_SHARDS

        region_ids = {spec['id'] for spec in FOCUS_REGION_SPECS}
        shard_region_ids = {spec['region_id'] for spec in RAIL_SHARDS}
        self.assertEqual(
            region_ids,
            {
                'europe',
                'japan',
                'russia',
                'east_asia',
                'north_america',
                'south_america',
                'africa_middle_east',
                'south_southeast_asia_oceania',
            },
        )
        self.assertEqual(shard_region_ids, region_ids)
        self.assertIn('jp_e128_e147', {spec['id'] for spec in RAIL_SHARDS})
        self.assertIn('sa_w082_w058', {spec['id'] for spec in RAIL_SHARDS})
        self.assertIn('ame_e035_e065', {spec['id'] for spec in RAIL_SHARDS})
        self.assertIn('ssea_e155_e180', {spec['id'] for spec in RAIL_SHARDS})

    def test_rail_shard_can_infer_region_when_region_flag_is_default(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import resolve_requested_region_specs

        region_specs = resolve_requested_region_specs('all_focus', 'jp_e128_e147')
        self.assertEqual([spec['id'] for spec in region_specs], ['japan'])

    def test_rail_shard_and_region_conflict_is_rejected(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import resolve_requested_region_specs

        with self.assertRaises(SystemExit):
            resolve_requested_region_specs('europe', 'jp_e128_e147')

    def test_checked_in_rail_shard_dirs_match_builder_truth(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import RAIL_SHARDS

        expected_pairs = {(spec['region_id'], spec['id']) for spec in RAIL_SHARDS}
        actual_pairs = set()
        for region_dir in GLOBAL_RAIL_REGION_ROOT.iterdir():
            if not region_dir.is_dir():
                continue
            shard_root = region_dir / 'shards'
            if not shard_root.exists():
                continue
            for shard_dir in shard_root.iterdir():
                if shard_dir.is_dir():
                    actual_pairs.add((region_dir.name, shard_dir.name))
        self.assertEqual(actual_pairs, expected_pairs)

    def test_checked_in_rail_full_feature_ids_are_globally_unique(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import RAIL_SHARDS

        seen_counts: Counter[str] = Counter()
        for shard_spec in RAIL_SHARDS:
            topo_path = (
                GLOBAL_RAIL_REGION_ROOT
                / shard_spec['region_id']
                / 'shards'
                / shard_spec['id']
                / 'railways.topo.json'
            )
            payload = json.loads(topo_path.read_text(encoding='utf-8'))
            for geometry in payload.get('objects', {}).get('railways', {}).get('geometries', []):
                feature_id = str((geometry.get('properties') or {}).get('id') or '').strip()
                if feature_id:
                    seen_counts[feature_id] += 1

        duplicates = sorted(feature_id for feature_id, count in seen_counts.items() if count > 1)
        self.assertFalse(duplicates, duplicates[:10])

    def test_shared_manifest_discovery_covers_global_shard_manifests(self) -> None:
        discovered = {
            path.resolve()
            for path in discover_manifest_paths(REPO_ROOT / 'data' / 'transport_layers')
        }
        expected = {
            *(
                path.resolve()
                for path in GLOBAL_ROAD_SHARD_ROOT.rglob('manifest.json')
                if path.is_file()
            ),
            *(
                path.resolve()
                for path in GLOBAL_RAIL_REGION_ROOT.rglob('manifest.json')
                if path.is_file()
            ),
        }
        self.assertFalse(expected - discovered, sorted(str(path) for path in expected - discovered))

    def test_rail_builder_keeps_stations_out_of_phase_a_manifest(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import (
            build_audit_payload,
            build_manifest_payload,
            empty_railways_frame,
            empty_station_collection,
            get_output_paths,
        )

        output_dir = REPO_ROOT / '.runtime' / 'tmp' / 'rail_test_manifest_contract'
        output_dir.mkdir(parents=True, exist_ok=True)
        paths = get_output_paths(output_dir)
        for path in paths.values():
            if path.suffix:
                path.write_text('{}' if path.suffix == '.json' else '', encoding='utf-8')
        audit = build_audit_payload(
            paths=paths,
            region_spec={'id': 'japan', 'lon_min': 128.0, 'lon_max': 147.0, 'lat_min': 30.0, 'lat_max': 46.0},
            shard_spec={'id': 'jp_e128_e147', 'lon_min': 128.0, 'lon_max': 147.0},
            source_signature={'dummy': True},
            result={
                'raw_line_count': 0,
                'filtered_line_count': 0,
                'line_class_counts': {'mainline': 0, 'regional': 0, 'secondary': 0},
                'region_counts': {'japan': 0, 'europe': 0, 'russia': 0, 'east_asia': 0, 'north_america': 0, 'low_priority': 0},
            },
            preview_railways=empty_railways_frame(),
            railways=empty_railways_frame(),
            major_stations=empty_station_collection(),
            output_size_bytes={'railways_preview': 0, 'railways_full': 0, 'stations_preview': 0, 'stations_full': 0},
        )
        manifest = build_manifest_payload(
            paths=paths,
            region_spec={'id': 'japan', 'lon_min': 128.0, 'lon_max': 147.0, 'lat_min': 30.0, 'lat_max': 46.0},
            shard_spec={'id': 'jp_e128_e147', 'lon_min': 128.0, 'lon_max': 147.0},
            source_signature={'dummy': True},
            preview_railways=empty_railways_frame(),
            railways=empty_railways_frame(),
            audit=audit,
            build_command='python tools/build_global_transport_rail.py --region japan --shard jp_e128_e147',
        )

        self.assertEqual(audit['phase_status']['major_stations'], 'phase_b_pending_source')
        self.assertEqual(audit['runtime_readiness']['transport_overview_rail'], 'backbone_only_not_ui_ready')
        self.assertEqual(audit['shard_id'], 'jp_e128_e147')
        self.assertNotIn('rail_stations_major', manifest['paths']['preview'])
        self.assertNotIn('rail_stations_major', manifest['paths']['full'])
        self.assertEqual(manifest['extensions']['rail']['phase_b_reserved_outputs'], ['rail_stations_major'])
        self.assertEqual(manifest['extensions']['rail']['region']['id'], 'japan')
        self.assertEqual(manifest['extensions']['rail']['shard']['id'], 'jp_e128_e147')

    def test_rail_recipe_selection_rules_describe_center_assignment(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import get_output_paths, write_source_recipe

        output_dir = REPO_ROOT / '.runtime' / 'tmp' / 'rail_test_recipe_selection_rule'
        output_dir.mkdir(parents=True, exist_ok=True)
        paths = get_output_paths(output_dir)
        write_source_recipe(
            paths['recipe'],
            {'id': 'japan', 'lon_min': 128.0, 'lon_max': 147.0, 'lat_min': 30.0, 'lat_max': 46.0},
            {'id': 'jp_e128_e147', 'lon_min': 128.0, 'lon_max': 147.0},
        )
        recipe = json.loads(paths['recipe'].read_text(encoding='utf-8'))
        self.assertEqual(recipe['region']['selection_rule'], 'bbox_center_priority_region_assignment')
        self.assertEqual(recipe['shard']['selection_rule'], 'bbox_longitude_center_assignment_within_region')

    def test_rail_catalog_matches_region_shard_manifests(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import FOCUS_REGION_SPECS, RAIL_SHARDS

        catalog = json.loads(GLOBAL_RAIL_CATALOG.read_text(encoding='utf-8'))
        self.assertEqual(catalog.get('family'), 'rail')
        self.assertEqual(catalog.get('distribution_tier'), 'regional_sharded_manifest_catalog')
        self.assertEqual(catalog.get('coverage_scope'), 'focus_regions_plus_coarse_gap_regions')

        regions = catalog.get('regions', [])
        entries = catalog.get('entries', [])
        self.assertEqual(len(regions), len(FOCUS_REGION_SPECS))
        self.assertEqual(len(entries), len(RAIL_SHARDS))
        self.assertEqual([region.get('id') for region in regions], [spec['id'] for spec in FOCUS_REGION_SPECS])
        self.assertEqual([entry.get('id') for entry in entries], [spec['id'] for spec in RAIL_SHARDS])

        for shard_spec, entry in zip(RAIL_SHARDS, entries):
            manifest_path = REPO_ROOT / entry['manifest_path']
            self.assertTrue(manifest_path.exists(), manifest_path.as_posix())
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            self.assertEqual(entry.get('region_id'), shard_spec['region_id'])
            self.assertEqual(entry.get('lon_min'), float(shard_spec['lon_min']))
            self.assertEqual(entry.get('lon_max'), float(shard_spec['lon_max']))
            self.assertEqual(
                manifest.get('build_command'),
                f"python tools/build_global_transport_rail.py --region {shard_spec['region_id']} --shard {shard_spec['id']}",
            )
            self.assertEqual(manifest.get('feature_counts'), entry.get('feature_counts'))
            self.assertEqual(
                ((manifest.get('extensions') or {}).get('rail') or {}).get('phase_status'),
                entry.get('phase_status'),
            )

    def test_rail_runtime_opens_and_saves(self) -> None:
        state_content = (REPO_ROOT / 'js' / 'core' / 'state' / 'ui_state.js').read_text(encoding='utf-8')
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'transport_appearance_controller.js'
        ).read_text(encoding='utf-8')
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        file_manager_content = (REPO_ROOT / 'js' / 'core' / 'file_manager.js').read_text(encoding='utf-8')
        interaction_content = (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8')

        self.assertIn('showRail', state_content)
        self.assertIn('showRail', appearance_controller_content)
        self.assertIn('getTransportOverviewRenderOwner().drawRailwaysLayer(k, options)', renderer_content)
        transport_owner_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_render_owner.js').read_text(encoding='utf-8')
        self.assertIn('!!runtimeState.showTransport && !!runtimeState.showRail', transport_owner_content)
        self.assertIn('getTransportOverviewVisibilityField', file_manager_content)
        self.assertIn('const visibilityField = getTransportOverviewVisibilityField(familyId);', interaction_content)
        self.assertIn('const layerRequest = getContextLayerRequestFromKeys(getTransportOverviewDataLayerKeys(familyId));', interaction_content)
        self.assertIn('function buildTransportOverviewLayerVisibility(appState) {', file_manager_content)
        self.assertIn('result[field] = !!appState[field];', file_manager_content)
        self.assertIn('restoreImportedLayerVisibilityState(state, data.layerVisibility);', interaction_content)
        self.assertIn('const TRANSPORT_OVERVIEW_VISIBILITY_FIELDS = listTransportOverviewCapabilityFamilyIds()', state_content)
        self.assertIn('transportOverviewLayerVisibility[field] = !!layerVisibility[field];', state_content)

    def test_road_runtime_opens_main_map_only(self) -> None:
        state_content = (REPO_ROOT / 'js' / 'core' / 'state' / 'ui_state.js').read_text(encoding='utf-8')
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'transport_appearance_controller.js'
        ).read_text(encoding='utf-8')
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        data_loader_content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        file_manager_content = (REPO_ROOT / 'js' / 'core' / 'file_manager.js').read_text(encoding='utf-8')
        interaction_content = (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8')

        self.assertIn('showRoad', state_content)
        self.assertIn('showRoad', appearance_controller_content)
        self.assertIn('getTransportOverviewRenderOwner().drawRoadsLayer(k, options)', renderer_content)
        transport_owner_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_render_owner.js').read_text(encoding='utf-8')
        self.assertIn('!!runtimeState.showTransport && !!runtimeState.showRoad', transport_owner_content)
        self.assertIn('layerName === "roads"', data_loader_content)
        self.assertIn('getTransportOverviewVisibilityFields()', file_manager_content)
        self.assertIn('const visibilityField = getTransportOverviewVisibilityField(familyId);', interaction_content)
        self.assertIn('const layerRequest = getContextLayerRequestFromKeys(getTransportOverviewDataLayerKeys(familyId));', interaction_content)
        self.assertIn('function normalizeTransportOverviewLayerVisibility(layerVisibility) {', file_manager_content)
        self.assertRegex(
            file_manager_content,
            r'function normalizeTransportOverviewLayerVisibility\(layerVisibility\)\s*\{\s*'
            r'commitUiVisibilityState\(\s*layerVisibility,\s*'
            r'Object\.fromEntries\(getTransportOverviewVisibilityFields\(\)\.map\(\(field\) => \[\s*'
            r'field,\s*layerVisibility\[field\] === undefined \? false : !!layerVisibility\[field\],',
        )
        self.assertIn('transportOverviewLayerVisibility[field] = !!layerVisibility[field];', state_content)
        self.assertIn('getTransportOverviewVisibilityField,', interaction_content)
        self.assertIn('getTransportOverviewDataLayerKeys,', interaction_content)
        self.assertIn('listTransportOverviewCapabilityFamilyIds,', interaction_content)
        self.assertIn('await restoreImportedTransportOverviewDataLayers(state);', interaction_content)

    def test_transport_toggles_release_deferred_context_markers(self) -> None:
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'transport_appearance_controller.js'
        ).read_text(encoding='utf-8')
        appearance_transport_summary_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'appearance_transport_summary.js'
        ).read_text(encoding='utf-8')
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        state_config_content = (REPO_ROOT / 'js' / 'core' / 'state' / 'config.js').read_text(encoding='utf-8')

        self.assertIn('"releaseDeferredContextBasePassFn"', state_config_content)
        self.assertIn(
            'registerRuntimeHook(runtimeState, "releaseDeferredContextBasePassFn", releaseDeferredContextBasePass);',
            renderer_content,
        )
        self.assertIn('const hasVisibleTransportFamily = () => (', appearance_controller_content)
        self.assertIn('listTransportOverviewCapabilityFamilyIds().some((familyId) => isTransportOverviewFamilyVisible(familyId))', appearance_controller_content)
        self.assertIn('if (normalized && hasVisibleTransportFamily()) {', appearance_controller_content)
        self.assertIn('runtimeState.releaseDeferredContextBasePassFn?.("transport-master-toggle");', appearance_controller_content)
        self.assertIn('reason === "hidden"', appearance_transport_summary_content)
        self.assertIn('getTransportOverviewDataLayerKeys,', appearance_controller_content)
        self.assertIn('const getTransportOverviewDataLayerRequest = (familyId) => {', appearance_controller_content)
        self.assertIn('const layerKeys = getTransportOverviewDataLayerKeys(familyId);', appearance_controller_content)
        self.assertIn('const requestTransportOverviewDataLayers = (familyId, reason, { renderNow = true } = {}) => {', appearance_controller_content)
        self.assertIn('runtimeState.ensureContextLayerDataFn(layerRequest, { reason, renderNow })', appearance_controller_content)
        self.assertIn('const releaseDeferredContextForTransportToggle = (reason) => {', appearance_controller_content)
        self.assertIn('runtimeState.releaseDeferredContextBasePassFn?.(reason);', appearance_controller_content)
        for reason in ("toggle-airports", "toggle-ports", "toggle-rail", "toggle-road"):
            self.assertIn(f'releaseDeferredContextForTransportToggle("{reason}");', appearance_controller_content)
        toggle_expectations = {
            "toggleAirports.addEventListener": (
                'releaseDeferredContextForTransportToggle("toggle-airports");',
                'requestTransportOverviewDataLayers("airport", "toolbar-toggle");',
            ),
            "togglePorts.addEventListener": (
                'releaseDeferredContextForTransportToggle("toggle-ports");',
                'requestTransportOverviewDataLayers("port", "toolbar-toggle");',
            ),
            "toggleRail.addEventListener": (
                'releaseDeferredContextForTransportToggle("toggle-rail");',
                'requestTransportOverviewDataLayers("rail", "toolbar-toggle");',
            ),
            "toggleRoad.addEventListener": (
                'releaseDeferredContextForTransportToggle("toggle-road");',
                'requestTransportOverviewDataLayers("road", "toolbar-toggle");',
            ),
        }
        for anchor, (release_token, request_token) in toggle_expectations.items():
            section = appearance_controller_content.split(anchor, 1)[1].split("});", 1)[0]
            self.assertLess(section.index(release_token), section.index(request_token))

    def test_rail_runtime_loader_uses_catalog_not_eager_pack(self) -> None:
        data_loader_content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        registry_content = (REPO_ROOT / 'js' / 'core' / 'transport_capability_registry.js').read_text(encoding='utf-8')
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'transport_appearance_controller.js'
        ).read_text(encoding='utf-8')
        self.assertIn('resolveDataAssetUrl("transport_catalog:rail")', data_loader_content)
        self.assertNotIn('data/transport_layers/global_rail/railways.topo.json', data_loader_content)
        self.assertNotIn('data/transport_layers/global_rail/rail_stations_major.geojson', data_loader_content)
        self.assertIn('listTransportOverviewCapabilityFamilyIds()', data_loader_content)
        self.assertIn('getTransportOverviewDataLayerKeys(familyId)', data_loader_content)
        self.assertIn('EXPLICIT_CONTEXT_CATALOG_LAYER_NAMES.has(name)', data_loader_content)
        self.assertIn('rail: Object.freeze(["railways", "rail_stations_major"])', registry_content)
        self.assertIn('getTransportOverviewDataLayerKeys,', appearance_controller_content)
        self.assertIn('const layerKeys = getTransportOverviewDataLayerKeys(familyId);', appearance_controller_content)
        self.assertIn('getTransportOverviewDataLayerKeys,', (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8'))
        self.assertIn('const layerRequest = getContextLayerRequestFromKeys(getTransportOverviewDataLayerKeys(familyId));', (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8'))
        default_eager_section = data_loader_content.split('if (includeContextLayers === true) {', 1)[1].split('}', 1)[0]
        self.assertIn('Object.keys(CONTEXT_LAYER_PACKS)', default_eager_section)
        self.assertNotIn('EXPLICIT_CONTEXT_CATALOG_LAYER_NAMES', default_eager_section)
        self.assertIn('["railways", "rail_stations_major"]', registry_content)

    def test_road_runtime_loader_uses_catalog_roads_only(self) -> None:
        data_loader_content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        toolbar_content = (REPO_ROOT / 'js' / 'ui' / 'toolbar.js').read_text(encoding='utf-8')
        interaction_content = (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8')
        self.assertIn('resolveDataAssetUrl("transport_catalog:road")', data_loader_content)
        self.assertIn('layerName === "roads"', data_loader_content)
        self.assertIn('EXPLICIT_CONTEXT_CATALOG_LAYER_NAMES.has(name)', data_loader_content)
        self.assertNotIn('road_labels.geojson', data_loader_content)
        self.assertNotIn('ensureContextLayerDataFn("road_labels"', toolbar_content)
        self.assertNotIn('ensureContextLayerDataFn("road_labels"', interaction_content)

    def test_transport_appearance_ui_exposes_live_rail_controls(self) -> None:
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'transport_appearance_controller.js'
        ).read_text(encoding='utf-8')
        html_content = (REPO_ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertIn('toggleRail', appearance_controller_content)
        self.assertIn('transportRailControls', appearance_controller_content)
        self.assertIn('drawRailwaysLayer', (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8'))
        self.assertIn('railLabelsEnabled', appearance_controller_content)
        self.assertIn('railLabelDensity', appearance_controller_content)
        self.assertIn('id="toggleRail"', html_content)
        self.assertIn('id="transportRailControls"', html_content)
        self.assertIn('id="railLabelsEnabled"', html_content)
        self.assertIn('id="railLabelDensity"', html_content)
        self.assertNotIn('data-i18n="Planned">Planned</span>', html_content.split('transportRailSummaryMeta', 1)[1].split('</details>', 1)[0])

    def test_transport_appearance_ui_exposes_live_road_controls_with_labels(self) -> None:
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'transport_appearance_controller.js'
        ).read_text(encoding='utf-8')
        html_content = (REPO_ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertIn('toggleRoad', appearance_controller_content)
        self.assertIn('transportRoadControls', appearance_controller_content)
        self.assertIn('drawRoadsLayer', (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8'))
        self.assertIn('roadLabelsEnabled', appearance_controller_content)
        self.assertIn('roadLabelDensity', appearance_controller_content)
        self.assertIn('id="toggleRoad"', html_content)
        self.assertIn('id="transportRoadControls"', html_content)
        self.assertIn('id="roadLabelsEnabled"', html_content)
        self.assertIn('id="roadLabelDensity"', html_content)
        self.assertNotIn('data-i18n="Planned">Planned</span>', html_content.split('transportRoadSummaryMeta', 1)[1].split('</details>', 1)[0])

    def test_rail_renderer_consumes_label_config_and_station_layer(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_render_owner.js').read_text(encoding='utf-8')
        self.assertIn('railConfig.labelsEnabled', renderer_content)
        self.assertIn('railConfig.labelDensity', renderer_content)
        self.assertIn('railConfig.labelMode', renderer_content)
        self.assertIn('drawRailStationsMajorLayer', renderer_content)
        self.assertIn('runtimeState.railStationsMajorData', renderer_content)

    def test_rail_renderer_threshold_order_keeps_all_as_broadest_setting(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_render_owner.js').read_text(encoding='utf-8')
        visibility_policy_content = (REPO_ROOT / 'js' / 'core' / 'transport_overview_visibility_policy.js').read_text(encoding='utf-8')
        registry_content = (REPO_ROOT / 'js' / 'core' / 'transport_capability_registry.js').read_text(encoding='utf-8')
        self.assertIn('function getTransportOverviewLineRevealRankThreshold(familyId, value)', registry_content)
        self.assertIn('return normalized === "primary" ? 1 : normalized === "secondary" ? 2 : 3;', registry_content)
        self.assertIn('getIncludedTransportOverviewLineClass("rail", feature, strategy)', renderer_content)
        self.assertIn('if (revealRank > Math.max(1, Math.round(Number(strategy.maximumRevealRank || 1)))) return "";', visibility_policy_content)
        self.assertIn('getTransportOverviewLineClassScopeRank(normalizedFamilyId, lineClass) > Math.max(1, Math.round(Number(strategy.minimumScopeRank || 1)))', visibility_policy_content)
        self.assertIn('getTransportOverviewLabelZoomConfig,', renderer_content)
        self.assertIn('export function getTransportOverviewLabelZoomConfig(familyId, labelDensity)', visibility_policy_content)
        self.assertIn('export function getTransportOverviewImportanceThresholdRank(value)', registry_content)
        self.assertNotIn('export function getTransportOverviewImportanceThresholdRank', visibility_policy_content)
        self.assertNotIn('function getTransportOverviewLabelZoomConfig', renderer_content)
        self.assertNotIn('function getTransportOverviewImportanceThresholdRank', renderer_content)
        self.assertNotIn('getContextFacilityThresholdRank', renderer_content)
        self.assertNotIn('function getTransportAirportScopeThreshold', renderer_content)
        self.assertNotIn('function getTransportPortScopeThreshold', renderer_content)
        self.assertNotIn('getTransportOverviewImportanceThresholdRank,', renderer_content)
        self.assertNotIn('getContextFacilityThresholdRank', visibility_policy_content)
        self.assertNotIn('getTransportAirportScopeThreshold', visibility_policy_content)
        self.assertNotIn('getTransportPortScopeThreshold', visibility_policy_content)
        self.assertNotIn('getTransportPortZoomRevealFloor', visibility_policy_content)

    def test_road_renderer_uses_road_scope_threshold_helper(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_render_owner.js').read_text(encoding='utf-8')
        visibility_policy_content = (REPO_ROOT / 'js' / 'core' / 'transport_overview_visibility_policy.js').read_text(encoding='utf-8')
        registry_content = (REPO_ROOT / 'js' / 'core' / 'transport_capability_registry.js').read_text(encoding='utf-8')
        self.assertIn('export function resolveTransportOverviewLineStrategy(familyId, familyConfig = {}, { scale = 1, visualMode = "distribution" } = {})', registry_content)
        self.assertIn('if (normalizedFamilyId === "road") {', registry_content)
        self.assertIn('return normalizedScope === "motorway_only" ? 1 : 2;', registry_content)
        self.assertIn('export function getTransportOverviewLineClassScopeRank(familyId, lineClass)', registry_content)
        self.assertIn('if (normalizedLineClass === "trunk") return 2;', registry_content)
        self.assertIn('const strategy = resolveTransportOverviewLineStrategy("road", roadConfig, {', renderer_content)
        self.assertIn('getIncludedTransportOverviewLineClass("road", feature, strategy)', renderer_content)
        self.assertIn('export function getTransportOverviewFilteredFeatureCount({', visibility_policy_content)
        self.assertIn('shouldIncludeTransportOverviewLineFeature(normalizedFamilyId, feature, strategy)', visibility_policy_content)

    def test_road_renderer_threshold_order_keeps_all_as_broadest_setting(self) -> None:
        registry_content = (REPO_ROOT / 'js' / 'core' / 'transport_capability_registry.js').read_text(encoding='utf-8')
        self.assertIn('function getTransportOverviewLineRevealRankThreshold(familyId, value)', registry_content)
        self.assertIn('return normalized === "primary" ? 1 : normalized === "secondary" ? 2 : 3;', registry_content)

    def test_rail_transport_overview_default_primary_color_is_dark(self) -> None:
        registry_content = (REPO_ROOT / 'js' / 'core' / 'transport_capability_registry.js').read_text(encoding='utf-8')
        state_defaults_content = (REPO_ROOT / 'js' / 'core' / 'state_defaults.js').read_text(encoding='utf-8')
        self.assertIn('rail: Object.freeze({', registry_content)
        self.assertIn('primaryColor: "#0f172a"', registry_content)
        self.assertIn('getTransportCapabilityDefaultOverviewConfig', state_defaults_content)

    def test_transport_overview_renderer_consumes_visual_style_policy(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_render_owner.js').read_text(encoding='utf-8')
        style_policy_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_style_policy.js').read_text(encoding='utf-8')
        self.assertIn('from "./transport_overview_style_policy.js";', renderer_content)
        self.assertIn('getTransportOverviewAirportVisualStyle,', renderer_content)
        self.assertIn('getTransportOverviewPortVisualStyle,', renderer_content)
        self.assertIn('getTransportOverviewRailVisualStyle,', renderer_content)
        self.assertIn('getTransportOverviewRoadVisualStyle,', renderer_content)
        self.assertNotIn('function getTransportOverviewRoadVisualStyle', renderer_content)
        self.assertNotIn('function getTransportOverviewRailVisualStyle', renderer_content)
        self.assertIn('export function getTransportOverviewRoadVisualStyle(primaryColor, visualStrength)', style_policy_content)
        self.assertIn('export function getTransportOverviewRailVisualStyle(primaryColor, visualStrength)', style_policy_content)
        self.assertIn('export function getTransportOverviewAirportVisualStyle(primaryColor, visualStrength)', style_policy_content)
        self.assertIn('export function getTransportOverviewPortVisualStyle(primaryColor, visualStrength)', style_policy_content)
        self.assertNotIn('function mixHexColors', style_policy_content)
        self.assertNotIn('runtimeState', style_policy_content)
        self.assertNotIn('context.', style_policy_content)
        self.assertNotIn('canvas', style_policy_content)

    def test_rail_stations_placeholder_sidecars_remain_real_empty_collections(self) -> None:
        sample_station_path = (
            GLOBAL_RAIL_REGION_ROOT
            / 'japan'
            / 'shards'
            / 'jp_e128_e147'
            / 'rail_stations_major.geojson'
        )
        payload = json.loads(sample_station_path.read_text(encoding='utf-8'))
        self.assertEqual(payload.get('type'), 'FeatureCollection')
        self.assertEqual(payload.get('features'), [])

    def test_airport_port_runtime_loader_uses_global_point_packs(self) -> None:
        data_loader_content = (REPO_ROOT / "js" / "core" / "data_loader.js").read_text(encoding="utf-8")
        pages_dist_content = (REPO_ROOT / "tools" / "build_pages_dist.py").read_text(encoding="utf-8")

        self.assertIn('resolveDataAssetUrl("context_layer:airports")', data_loader_content)
        self.assertIn('resolveDataAssetUrl("context_layer:ports")', data_loader_content)
        self.assertNotIn("data/transport_layers/japan_airport/airports.geojson", data_loader_content)
        self.assertNotIn("data/transport_layers/japan_port/ports.geojson", data_loader_content)
        self.assertIn("data/transport_layers/global_airport/airports.geojson", pages_dist_content)
        self.assertIn("data/transport_layers/global_port/ports.geojson", pages_dist_content)
        self.assertIn("data/transport_layers/japan_airport/airports.geojson", pages_dist_content)
        self.assertIn("data/transport_layers/japan_port/ports.core.geojson", pages_dist_content)
        self.assertIn("data/transport_layers/japan_port/ports.expanded.geojson", pages_dist_content)
        self.assertIn("data/transport_layers/japan_port/ports.geojson", pages_dist_content)

    def test_global_airport_port_point_packs_have_world_scope_contract(self) -> None:
        cases = (
            ("airport", GLOBAL_AIRPORT_ROOT, "airports"),
            ("port", GLOBAL_PORT_ROOT, "ports"),
        )
        japan_bbox = {"lon_min": 122.0, "lon_max": 154.0, "lat_min": 20.0, "lat_max": 46.0}

        for family, root, pack_key in cases:
            with self.subTest(family=family):
                full_path = root / f"{pack_key}.geojson"
                preview_path = root / f"{pack_key}.preview.geojson"
                manifest_path = root / "manifest.json"
                recipe_path = root / "source_recipe.manual.json"
                for path in (full_path, preview_path, manifest_path, recipe_path):
                    self.assertTrue(path.exists(), path.as_posix())

                payload = json.loads(full_path.read_text(encoding="utf-8"))
                features = payload.get("features", [])
                self.assertGreater(len(features), 100)
                self.assertTrue(
                    any(
                        not (
                            japan_bbox["lon_min"] <= feature["geometry"]["coordinates"][0] <= japan_bbox["lon_max"]
                            and japan_bbox["lat_min"] <= feature["geometry"]["coordinates"][1] <= japan_bbox["lat_max"]
                        )
                        for feature in features
                    )
                )

                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                self.assertEqual(manifest.get("coverage_scope"), "world")
                self.assertEqual(manifest.get("family"), family)
                self.assertEqual(manifest.get("geometry_kind"), "point")
                self.assertEqual(manifest.get("country"), "world")
                self.assertEqual(manifest.get("feature_counts", {}).get("full", {}).get(pack_key), len(features))

                recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
                self.assertEqual(recipe.get("family"), family)
                self.assertEqual(recipe.get("source", {}).get("license"), "public domain")
                self.assertIn("naturalearth", recipe.get("source", {}).get("url", ""))

    def test_port_renderer_default_reveal_floor_keeps_regional_ports_visible(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_render_owner.js').read_text(encoding='utf-8')
        registry_content = (REPO_ROOT / 'js' / 'core' / 'transport_capability_registry.js').read_text(encoding='utf-8')
        port_payload = json.loads((REPO_ROOT / 'data' / 'transport_layers' / 'japan_port' / 'ports.geojson').read_text(encoding='utf-8'))
        max_importance_rank = max(
            int(round(float(feature.get('properties', {}).get('importance_rank') or 1)))
            for feature in port_payload.get('features', [])
        )
        self.assertEqual(max_importance_rank, 2)
        self.assertIn('function resolveTransportOverviewPointWorldFloor(familyId, visualMode)', registry_content)
        self.assertIn('if (familyId === "port") return 2;', registry_content)
        self.assertIn('const strategy = resolveTransportOverviewPointStrategy("port", portConfig, {', renderer_content)
        self.assertIn('thresholdRank: strategy.thresholdRank,', renderer_content)

    def test_rail_runtime_loader_keeps_station_collection_shape_even_when_empty(self) -> None:
        data_loader_content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        self.assertIn('rail_stations_major', data_loader_content)
        self.assertIn('features: stationFeatures', data_loader_content)

    def test_road_renderer_consumes_roads_with_inline_ref_name_labels(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_overview_render_owner.js').read_text(encoding='utf-8')
        line_label_policy_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'transport_line_label_policy.js').read_text(encoding='utf-8')
        context_pass_orchestrator_content = (REPO_ROOT / 'js' / 'core' / 'renderer' / 'context_pass_orchestrator_owner.js').read_text(encoding='utf-8')
        main_renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        self.assertIn('function drawRoadsLayer(k, { interactive = false } = {})', renderer_content)
        self.assertIn('runtimeState.roadsData', renderer_content)
        self.assertIn('!!runtimeState.showTransport && !!runtimeState.showRoad', renderer_content)
        self.assertIn('from "./transport_line_label_policy.js";', renderer_content)
        self.assertIn('buildTransportOverviewLineStrokeSpecs,', renderer_content)
        self.assertIn('getRoadLabelClassPriority,', renderer_content)
        self.assertIn('priority: getRoadLabelClassPriority(roadClass)', renderer_content)
        self.assertIn('export function buildTransportOverviewLineStrokeSpecs(style,', line_label_policy_content)
        self.assertIn('export function resolveTransportOverviewLineCoordinateWidth(screenWidthPx, k, floorPx = 0.75)', line_label_policy_content)
        self.assertIn('export function resolveTransportOverviewLineDash(dashPx, k)', line_label_policy_content)
        self.assertNotIn('const classPriority = {', renderer_content)
        self.assertNotIn('function resolveTransportOverviewLineCoordinateWidth', renderer_content)
        self.assertNotIn('function resolveTransportOverviewLineDash', renderer_content)
        self.assertIn('export function getTransportOverviewRoadLabelText(properties = {}, mode = "ref")', line_label_policy_content)
        self.assertIn('export function getRoadLabelClassPriority(roadClass)', line_label_policy_content)
        self.assertIn('export function resolveTransportRoadLabelClassAndPriority(properties = {})', line_label_policy_content)
        self.assertIn('labelCount', renderer_content)
        self.assertIn('getTransportOverviewRenderOwner().drawRoadsLayer(k, options)', main_renderer_content)
        self.assertIn('getTransportOverviewRenderOwner().drawRailwaysLayer(k, options)', main_renderer_content)
        self.assertIn('getTransportOverviewRenderOwner().drawAirportsLayer(k, options)', main_renderer_content)
        self.assertIn('getTransportOverviewRenderOwner().drawPortsLayer(k, options)', main_renderer_content)
        self.assertIn('drawRoadsLayer(k, { interactive });', context_pass_orchestrator_content)
        self.assertIn('drawRailwaysLayer(k, { interactive });', context_pass_orchestrator_content)
        self.assertIn('drawAirportsLayer(k, { interactive });', context_pass_orchestrator_content)
        self.assertIn('drawPortsLayer(k, { interactive });', context_pass_orchestrator_content)
        self.assertNotIn('function drawAirportsLayer(k, { interactive = false } = {})', main_renderer_content)
        self.assertNotIn('function drawPortsLayer(k, { interactive = false } = {})', main_renderer_content)
        self.assertNotIn('function drawRailwaysLayer(k, { interactive = false } = {})', main_renderer_content)
        self.assertNotIn('function drawRoadsLayer(k, { interactive = false } = {})', main_renderer_content)
        self.assertNotIn('function getTransportOverviewStyleConfig()', main_renderer_content)
        self.assertNotIn('state.roadLabelsData', renderer_content)

    def test_road_save_load_is_open_while_workbench_bridge_stays_closed(self) -> None:
        file_manager_content = (REPO_ROOT / 'js' / 'core' / 'file_manager.js').read_text(encoding='utf-8')
        interaction_content = (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8')
        registry_content = (REPO_ROOT / 'js' / 'core' / 'transport_capability_registry.js').read_text(encoding='utf-8')
        ui_state_content = (REPO_ROOT / 'js' / 'core' / 'state' / 'ui_state.js').read_text(encoding='utf-8')
        self.assertIn('function getTransportOverviewVisibilityFields() {', file_manager_content)
        self.assertIn('function buildTransportOverviewLayerVisibility(appState) {', file_manager_content)
        self.assertIn('function normalizeTransportOverviewLayerVisibility(layerVisibility) {', file_manager_content)
        self.assertIn('const TRANSPORT_OVERVIEW_VISIBILITY_FIELDS = listTransportOverviewCapabilityFamilyIds()', ui_state_content)
        self.assertIn('async function restoreImportedTransportOverviewDataLayers(importState) {', interaction_content)
        self.assertIn('if (!importState.showTransport) return;', interaction_content)
        self.assertIn('const visibilityField = getTransportOverviewVisibilityField(familyId);', interaction_content)
        self.assertIn('if (!visibilityField || !importState[visibilityField]) continue;', interaction_content)
        self.assertIn('applyCompatibility: TRANSPORT_CAPABILITY_APPLY_COMPATIBILITY.mainMapBridge', registry_content)
        self.assertIn('function getTransportWorkbenchActivePackBridgeSupport(normalizedFamilyId, familyConfig = {}, compatibility = "")', registry_content)
        self.assertIn('if (!activePackId) return null;', registry_content)
        self.assertIn('reason: "active_pack_required"', registry_content)
        self.assertIn('|| !bridgeSupport.supported', registry_content)
        self.assertIn('return null;', registry_content)

    def test_data_loader_no_longer_hardcodes_missing_global_transport_pack_paths(self) -> None:
        content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        self.assertNotIn('data/transport_layers/global_road/roads.topo.json', content)
        self.assertNotIn('data/transport_layers/global_road/road_labels.geojson', content)
        self.assertNotIn('data/transport_layers/global_rail/railways.topo.json', content)
        self.assertNotIn('data/transport_layers/global_rail/rail_stations_major.geojson', content)


if __name__ == '__main__':
    unittest.main()
