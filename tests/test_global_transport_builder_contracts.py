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


if __name__ == '__main__':
    unittest.main()
