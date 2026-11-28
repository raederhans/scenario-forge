from __future__ import annotations

import json
import importlib.util
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
from shapely import wkb
from shapely.geometry import LineString

REPO_ROOT = Path(__file__).resolve().parents[1]
GLOBAL_ROAD_CATALOG = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'catalog.json'
GLOBAL_RAIL_CATALOG = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'catalog.json'
GLOBAL_RAIL_REGION_ROOT = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'regions'


class GlobalTransportBuilderContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pyarrow_available = importlib.util.find_spec("pyarrow") is not None

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
            self.assertEqual(manifest['paths']['preview']['roads'], 'test_pack/roads.preview.topo.json')
            self.assertEqual(manifest['paths']['preview']['road_labels'], 'test_pack/road_labels.preview.geojson')

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
                ((manifest.get('extensions') or {}).get('road') or {}).get('shard'),
                {
                    'id': shard['id'],
                    'lon_min': float(shard['lon_min']),
                    'lon_max': float(shard['lon_max']),
                },
            )

    def test_rail_adjacent_shard_assignment_uses_center_point(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_rail import get_shard_spec, shard_bbox_center_matches

        west_shard = get_shard_spec('eu_e010_e025')
        east_shard = get_shard_spec('eu_e025_e045')
        boundary_bbox = {'xmin': 24.0, 'xmax': 26.0, 'ymin': 50.0, 'ymax': 51.0}
        self.assertTrue(shard_bbox_center_matches(boundary_bbox, east_shard))
        self.assertFalse(shard_bbox_center_matches(boundary_bbox, west_shard))

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
            self.assertEqual(manifest.get('feature_counts'), entry.get('feature_counts'))
            self.assertEqual(
                ((manifest.get('extensions') or {}).get('rail') or {}).get('phase_status'),
                entry.get('phase_status'),
            )


if __name__ == '__main__':
    unittest.main()
