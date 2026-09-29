import json
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import box

from tools.build_physical_detail import ALPS_BOUNDS, replace_cover_in_region
from tools.build_physical_presentation import hillshade_anomaly
from map_builder.geo.spherical_safety import _topology_feature_collection, _collect_d3_spherical_diagnostics


class PhysicalDetailTests(unittest.TestCase):
    def test_all_physical_polygon_parts_are_small_spherical_areas(self):
        for name, object_name in [('global_physical_semantics.topo.json', 'physical_semantics'), ('global_physical_semantics.detail.topo.json', 'physical_semantics'), ('physical_hillshade.alps.topo.json', 'physical_hillshade')]:
            payload = json.loads((Path('data') / name).read_text(encoding='utf-8'))
            features = _topology_feature_collection(payload, object_name, 'physical-test')
            rows = _collect_d3_spherical_diagnostics(features, stage_label='physical-test')
            bad = [row for row in rows if row['error'] or row['worldBounds'] or not np.isfinite(row['area']) or row['area'] <= 0 or row['area'] > np.pi * 2]
            self.assertEqual(bad, [], name)

    def test_dem_shading_is_neutral_on_flat_land_and_uses_metric_northwest_light(self):
        flat = np.full((10, 10), 1200.0)
        np.testing.assert_allclose(hillshade_anomaly(flat, 0.025, 49), 0, atol=1e-12)
        east_rising = flat + np.arange(10)[None, :] * 200
        self.assertTrue((hillshade_anomaly(east_rising, 0.025, 49) > 0).all())
        self.assertTrue((hillshade_anomaly(east_rising[:, ::-1], 0.025, 49) < 0).all())

    def test_presentation_assets_are_bounded_and_bilingual(self):
        labels = json.loads(Path('data/physical_region_labels.geojson').read_text(encoding='utf-8'))
        self.assertEqual(len(labels['features']), 419)
        self.assertEqual(len({f['properties']['id'] for f in labels['features']}), 419)
        self.assertTrue(any('阿尔卑斯' in f['properties']['name_zh'] for f in labels['features']))
        self.assertFalse(any('\ufffd' in f['properties']['name_zh'] for f in labels['features']))
        path = Path('data/physical_hillshade.alps.topo.json')
        payload = json.loads(path.read_text(encoding='utf-8'))
        shade = gpd.GeoDataFrame.from_features(_topology_feature_collection(payload, 'physical_hillshade', 'shade-test'), crs='EPSG:4326')
        self.assertTrue(shade.geometry.is_valid.all())
        self.assertTrue(shade.geometry.within(box(*ALPS_BOUNDS).buffer(0.001)).all())
        self.assertTrue(shade.shade.between(-1, 1).all())
        self.assertLess(path.stat().st_size, 2_000_000)

    def test_replacement_only_changes_cover_inside_region(self):
        overview = gpd.GeoDataFrame([
            {'id': 'cover', 'atlas_layer': 'semantic_overlay', 'geometry': box(0, 0, 10, 10)},
            {'id': 'mountain', 'atlas_layer': 'relief_base', 'geometry': box(0, 0, 10, 10)},
        ], crs='EPSG:4326')
        detail = gpd.GeoDataFrame([{'id': 'detail', 'atlas_layer': 'semantic_overlay', 'geometry': box(2, 2, 3, 3)}], crs='EPSG:4326')
        combined = replace_cover_in_region(overview, detail, (2, 2, 4, 4)).set_index('id')
        self.assertEqual(combined.loc['cover'].geometry.area, 96)
        self.assertTrue(combined.loc['mountain'].geometry.equals(overview.iloc[1].geometry))
        self.assertTrue(combined.loc['cover'].geometry.disjoint(combined.loc['detail'].geometry.buffer(-0.01)))

    def test_shipped_detail_is_bounded_valid_and_adds_small_components(self):
        path = Path('data/global_physical_semantics.detail.topo.json')
        payload = json.loads(path.read_text(encoding='utf-8'))
        self.assertLess(path.stat().st_size, 2_000_000)
        self.assertEqual(payload['metadata']['detail_regions'][0]['bounds'], list(ALPS_BOUNDS))
        self.assertEqual(payload['metadata']['detail_regions'][0]['cell_degrees'], 0.05)
        features = gpd.GeoDataFrame.from_features(_topology_feature_collection(payload, 'physical_semantics', 'physical-detail-test'), crs='EPSG:4326')
        self.assertTrue(features.geometry.is_valid.all())
        self.assertTrue(features.id.is_unique)
        detail = features[features.id.str.startswith('alps_detail_')]
        self.assertEqual(len(detail), payload['metadata']['detail_feature_count'])
        self.assertGreater(len(detail), 100)
        self.assertTrue(detail.geometry.within(box(*ALPS_BOUNDS).buffer(0.001)).all())
        areas = detail.to_crs('EPSG:6933').geometry.area / 1e6
        self.assertTrue((areas < 900).any(), 'detail must preserve components filtered from the overview')


if __name__ == '__main__':
    unittest.main()
