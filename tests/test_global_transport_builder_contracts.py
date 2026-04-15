from __future__ import annotations

import json
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
from shapely import wkb
from shapely.geometry import LineString

REPO_ROOT = Path(__file__).resolve().parents[1]
GLOBAL_ROAD_RECIPE = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'source_recipe.manual.json'
GLOBAL_RAIL_RECIPE = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'source_recipe.manual.json'
ROAD_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_roads.py'
RAIL_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_rail.py'
COMMON_HELPER = REPO_ROOT / 'map_builder' / 'overture_transport_common.py'


class GlobalTransportBuilderContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pyarrow_available = importlib.util.find_spec("pyarrow") is not None

    def test_new_global_transport_files_exist(self) -> None:
        for path in (GLOBAL_ROAD_RECIPE, GLOBAL_RAIL_RECIPE, ROAD_BUILDER, RAIL_BUILDER, COMMON_HELPER):
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

    def test_rail_builder_keeps_stations_out_of_phase_a_manifest(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import build_audit_payload, build_manifest_payload, empty_railways_frame, empty_station_collection

        audit = build_audit_payload(
            source_signature={'dummy': True},
            result={'raw_line_count': 0, 'filtered_line_count': 0, 'line_class_counts': {'mainline': 0, 'regional': 0, 'secondary': 0}},
            preview_railways=empty_railways_frame(),
            railways=empty_railways_frame(),
            major_stations=empty_station_collection(),
            output_size_bytes={'railways_preview': 0, 'railways_full': 0, 'stations_preview': 0, 'stations_full': 0},
        )
        manifest = build_manifest_payload(
            source_signature={'dummy': True},
            preview_railways=empty_railways_frame(),
            railways=empty_railways_frame(),
            audit=audit,
        )

        self.assertEqual(audit['phase_status']['major_stations'], 'phase_b_pending_source')
        self.assertEqual(audit['runtime_readiness']['transport_overview_rail'], 'backbone_only_not_ui_ready')
        self.assertNotIn('rail_stations_major', manifest['paths']['preview'])
        self.assertNotIn('rail_stations_major', manifest['paths']['full'])
        self.assertEqual(manifest['extensions']['rail']['phase_b_reserved_outputs'], ['rail_stations_major'])

    def test_runtime_gate_still_closed_for_road_and_rail(self) -> None:
        for path in (
            REPO_ROOT / 'js' / 'core' / 'file_manager.js',
            REPO_ROOT / 'js' / 'core' / 'interaction_funnel.js',
            REPO_ROOT / 'js' / 'ui' / 'toolbar.js',
            REPO_ROOT / 'js' / 'core' / 'map_renderer.js',
        ):
            content = path.read_text(encoding='utf-8')
            self.assertNotIn('showRoad', content)
            self.assertNotIn('showRail', content)


if __name__ == '__main__':
    unittest.main()
