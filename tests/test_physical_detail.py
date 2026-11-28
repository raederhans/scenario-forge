import json
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import box

from tools.build_physical_detail import replace_cover_in_region
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


if __name__ == '__main__':
    unittest.main()
