from __future__ import annotations

import json
import importlib.util
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
from shapely import wkb
from shapely.geometry import LineString

from tools.check_transport_workbench_manifests import discover_manifest_paths

REPO_ROOT = Path(__file__).resolve().parents[1]
GLOBAL_ROAD_RECIPE = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'source_recipe.manual.json'
GLOBAL_RAIL_RECIPE = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'source_recipe.manual.json'
GLOBAL_ROAD_CATALOG = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'catalog.json'
GLOBAL_RAIL_CATALOG = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'catalog.json'
GLOBAL_ROAD_SHARD_ROOT = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'shards'
GLOBAL_RAIL_REGION_ROOT = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'regions'
GLOBAL_TRANSPORT_CATALOG_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_catalogs.py'
ROAD_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_roads.py'
RAIL_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_rail.py'
COMMON_HELPER = REPO_ROOT / 'map_builder' / 'overture_transport_common.py'


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
            COMMON_HELPER,
        ):
            self.assertTrue(path.exists(), path.as_posix())

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
        for builder in (ROAD_BUILDER, RAIL_BUILDER):
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
            ['japan', 'europe', 'russia', 'east_asia', 'north_america'],
        )
        self.assertIn('low_priority', rules.get('region_policy', {}))
        self.assertEqual(
            rules.get('region_policy', {}).get('low_priority', {}).get('drop_unnamed_standard_gauge'),
            True,
        )

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
            {'europe', 'japan', 'russia', 'east_asia', 'north_america'},
        )
        self.assertEqual(shard_region_ids, region_ids)
        self.assertIn('jp_e128_e147', {spec['id'] for spec in RAIL_SHARDS})

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
        self.assertEqual(catalog.get('coverage_scope'), 'focus_regions_only')

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
        state_content = (REPO_ROOT / 'js' / 'core' / 'state.js').read_text(encoding='utf-8')
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'appearance_controls_controller.js'
        ).read_text(encoding='utf-8')
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        file_manager_content = (REPO_ROOT / 'js' / 'core' / 'file_manager.js').read_text(encoding='utf-8')
        interaction_content = (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8')

        self.assertIn('showRail', state_content)
        self.assertIn('showRail', appearance_controller_content)
        self.assertIn('showRail', renderer_content)
        self.assertIn('showRail', file_manager_content)
        self.assertIn('showRail', interaction_content)
        self.assertIn('data.layerVisibility.showRail', file_manager_content)
        self.assertIn('state.showRail = !!data.layerVisibility.showRail', interaction_content)

    def test_road_runtime_opens_main_map_only(self) -> None:
        state_content = (REPO_ROOT / 'js' / 'core' / 'state.js').read_text(encoding='utf-8')
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'appearance_controls_controller.js'
        ).read_text(encoding='utf-8')
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        data_loader_content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        file_manager_content = (REPO_ROOT / 'js' / 'core' / 'file_manager.js').read_text(encoding='utf-8')
        interaction_content = (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8')

        self.assertIn('showRoad', state_content)
        self.assertIn('showRoad', appearance_controller_content)
        self.assertIn('showRoad', renderer_content)
        self.assertIn('layerName === "roads"', data_loader_content)
        self.assertNotIn('showRoad', file_manager_content)
        self.assertNotIn('showRoad', interaction_content)
        self.assertNotIn('data.layerVisibility.showRoad', file_manager_content)
        self.assertNotIn('state.showRoad = !!data.layerVisibility.showRoad', interaction_content)

    def test_transport_toggles_release_deferred_context_markers(self) -> None:
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'appearance_controls_controller.js'
        ).read_text(encoding='utf-8')
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        state_config_content = (REPO_ROOT / 'js' / 'core' / 'state' / 'config.js').read_text(encoding='utf-8')

        self.assertIn('"releaseDeferredContextBasePassFn"', state_config_content)
        self.assertIn(
            'registerRuntimeHook(runtimeState, "releaseDeferredContextBasePassFn", releaseDeferredContextBasePass);',
            renderer_content,
        )
        self.assertIn('const hasVisibleTransportFamily = () => !!(', appearance_controller_content)
        self.assertIn('if (normalized && hasVisibleTransportFamily()) {', appearance_controller_content)
        self.assertIn('runtimeState.releaseDeferredContextBasePassFn?.("transport-master-toggle");', appearance_controller_content)
        self.assertIn('const releaseDeferredContextForTransportToggle = (reason) => {', appearance_controller_content)
        self.assertIn('runtimeState.releaseDeferredContextBasePassFn?.(reason);', appearance_controller_content)
        for reason in ("toggle-airports", "toggle-ports", "toggle-rail", "toggle-road"):
            self.assertIn(f'releaseDeferredContextForTransportToggle("{reason}");', appearance_controller_content)
        toggle_expectations = {
            "toggleAirports.addEventListener": (
                'releaseDeferredContextForTransportToggle("toggle-airports");',
                'runtimeState.ensureContextLayerDataFn("airports"',
            ),
            "togglePorts.addEventListener": (
                'releaseDeferredContextForTransportToggle("toggle-ports");',
                'runtimeState.ensureContextLayerDataFn("ports"',
            ),
            "toggleRail.addEventListener": (
                'releaseDeferredContextForTransportToggle("toggle-rail");',
                'runtimeState.ensureContextLayerDataFn(["railways", "rail_stations_major"]',
            ),
            "toggleRoad.addEventListener": (
                'releaseDeferredContextForTransportToggle("toggle-road");',
                'runtimeState.ensureContextLayerDataFn("roads"',
            ),
        }
        for anchor, (release_token, ensure_token) in toggle_expectations.items():
            section = appearance_controller_content.split(anchor, 1)[1].split("});", 1)[0]
            self.assertLess(section.index(release_token), section.index(ensure_token))

    def test_rail_runtime_loader_uses_catalog_not_eager_pack(self) -> None:
        data_loader_content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        appearance_controller_content = (
            REPO_ROOT / 'js' / 'ui' / 'toolbar' / 'appearance_controls_controller.js'
        ).read_text(encoding='utf-8')
        self.assertIn('data/transport_layers/global_rail/catalog.json', data_loader_content)
        self.assertNotIn('data/transport_layers/global_rail/railways.topo.json', data_loader_content)
        self.assertNotIn('data/transport_layers/global_rail/rail_stations_major.geojson', data_loader_content)
        self.assertIn('["railways", "rail_stations_major"]', appearance_controller_content)
        self.assertIn('["railways", "rail_stations_major"]', (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8'))

    def test_road_runtime_loader_uses_catalog_roads_only(self) -> None:
        data_loader_content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        toolbar_content = (REPO_ROOT / 'js' / 'ui' / 'toolbar.js').read_text(encoding='utf-8')
        interaction_content = (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8')
        self.assertIn('data/transport_layers/global_road/catalog.json', data_loader_content)
        self.assertIn('layerName === "roads"', data_loader_content)
        self.assertNotIn('road_labels.geojson', data_loader_content)
        self.assertNotIn('ensureContextLayerDataFn("road_labels"', toolbar_content)
        self.assertNotIn('ensureContextLayerDataFn("road_labels"', interaction_content)

    def test_transport_appearance_ui_exposes_live_rail_controls(self) -> None:
        toolbar_content = (REPO_ROOT / 'js' / 'ui' / 'toolbar.js').read_text(encoding='utf-8')
        html_content = (REPO_ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertIn('toggleRail', toolbar_content)
        self.assertIn('transportRailControls', toolbar_content)
        self.assertIn('drawRailwaysLayer', (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8'))
        self.assertIn('railLabelsEnabled', toolbar_content)
        self.assertIn('railLabelDensity', toolbar_content)
        self.assertIn('id="toggleRail"', html_content)
        self.assertIn('id="transportRailControls"', html_content)
        self.assertIn('id="railLabelsEnabled"', html_content)
        self.assertIn('id="railLabelDensity"', html_content)
        self.assertNotIn('data-i18n="Planned">Planned</span>', html_content.split('transportRailSummaryMeta', 1)[1].split('</details>', 1)[0])

    def test_transport_appearance_ui_exposes_live_road_controls_without_labels(self) -> None:
        toolbar_content = (REPO_ROOT / 'js' / 'ui' / 'toolbar.js').read_text(encoding='utf-8')
        html_content = (REPO_ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertIn('toggleRoad', toolbar_content)
        self.assertIn('transportRoadControls', toolbar_content)
        self.assertIn('drawRoadsLayer', (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8'))
        self.assertIn('id="toggleRoad"', html_content)
        self.assertIn('id="transportRoadControls"', html_content)
        self.assertNotIn('data-i18n="Planned">Planned</span>', html_content.split('transportRoadSummaryMeta', 1)[1].split('</details>', 1)[0])
        self.assertNotIn('id="roadLabelsEnabled"', html_content)

    def test_rail_renderer_consumes_label_config_and_station_layer(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        self.assertIn('railConfig.labelsEnabled', renderer_content)
        self.assertIn('railConfig.labelDensity', renderer_content)
        self.assertIn('railConfig.labelMode', renderer_content)
        self.assertIn('drawRailStationsMajorLayer', renderer_content)
        self.assertIn('state.railStationsMajorData', renderer_content)

    def test_rail_renderer_threshold_order_keeps_all_as_broadest_setting(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        self.assertIn('function getTransportRailRevealRankThreshold(value)', renderer_content)
        self.assertIn('if (normalized === "primary") return 1;', renderer_content)
        self.assertIn('if (normalized === "secondary") return 2;', renderer_content)
        self.assertIn('return 3;', renderer_content)
        self.assertIn('if (revealRank > maximumRevealRank) return;', renderer_content)

    def test_road_renderer_uses_road_scope_threshold_helper(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        self.assertIn('function getTransportRoadScopeThreshold(scope)', renderer_content)
        self.assertIn('return normalized === "motorway_only" ? 1 : 2;', renderer_content)
        self.assertIn('const minimumScopeRank = getTransportRoadScopeThreshold(roadConfig.scope);', renderer_content)

    def test_road_renderer_threshold_order_keeps_all_as_broadest_setting(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        self.assertIn('function getTransportRoadRevealRankThreshold(value)', renderer_content)
        self.assertIn('if (normalized === "primary") return 1;', renderer_content)
        self.assertIn('if (normalized === "secondary") return 2;', renderer_content)
        self.assertIn('return 3;', renderer_content)

    def test_rail_transport_overview_default_primary_color_is_dark(self) -> None:
        state_defaults_content = (REPO_ROOT / 'js' / 'core' / 'state_defaults.js').read_text(encoding='utf-8')
        self.assertIn('case "rail":', state_defaults_content)
        self.assertIn('primaryColor: "#0f172a"', state_defaults_content)

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

    def test_rail_runtime_loader_keeps_station_collection_shape_even_when_empty(self) -> None:
        data_loader_content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        self.assertIn('rail_stations_major', data_loader_content)
        self.assertIn('features: stationFeatures', data_loader_content)

    def test_road_renderer_consumes_roads_without_labels(self) -> None:
        renderer_content = (REPO_ROOT / 'js' / 'core' / 'map_renderer.js').read_text(encoding='utf-8')
        self.assertIn('function drawRoadsLayer(k, { interactive = false } = {})', renderer_content)
        self.assertIn('state.roadsData', renderer_content)
        self.assertIn('!!state.showTransport && !!state.showRoad', renderer_content)
        self.assertNotIn('state.roadLabelsData', renderer_content)

    def test_road_save_load_gate_stays_closed(self) -> None:
        file_manager_content = (REPO_ROOT / 'js' / 'core' / 'file_manager.js').read_text(encoding='utf-8')
        interaction_content = (REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js').read_text(encoding='utf-8')
        self.assertNotIn('data.layerVisibility.showRoad', file_manager_content)
        self.assertNotIn('state.showRoad = !!data.layerVisibility.showRoad', interaction_content)
        self.assertNotIn('ensureContextLayerDataFn("roads"', interaction_content)

    def test_data_loader_no_longer_hardcodes_missing_global_transport_pack_paths(self) -> None:
        content = (REPO_ROOT / 'js' / 'core' / 'data_loader.js').read_text(encoding='utf-8')
        self.assertNotIn('data/transport_layers/global_road/roads.topo.json', content)
        self.assertNotIn('data/transport_layers/global_road/road_labels.geojson', content)
        self.assertNotIn('data/transport_layers/global_rail/railways.topo.json', content)
        self.assertNotIn('data/transport_layers/global_rail/rail_stations_major.geojson', content)


if __name__ == '__main__':
    unittest.main()
