import json
from pathlib import Path
import unittest

from shapely.geometry import MultiPolygon, Point, Polygon, shape

from tools.build_world_urban_lights_asset import build_collection, compact_geometry, topology_signature

ROOT = Path(__file__).resolve().parents[1]


class WorldUrbanLightsAssetTests(unittest.TestCase):
    def test_compaction_retains_holes_components_and_interior_anchor(self):
        first = Polygon([(0, 0), (3, 0), (3, 3), (0, 3)], holes=[[(1, 1), (2, 1), (2, 2), (1, 2)]])
        geometry = MultiPolygon([first, Polygon([(4, 0), (5, 0), (5, 1), (4, 1)])])
        compact = shape(compact_geometry(geometry, 0.003))
        self.assertEqual(topology_signature(compact), (2, (1, 0)))
        self.assertTrue(compact.is_valid)
        for part in compact.geoms:
            self.assertFalse(part.exterior.is_ccw)
        feature = build_collection([(geometry, {})], [])['features'][0]
        self.assertTrue(compact.contains(Point(feature['properties']['anchor'])))
        self.assertFalse(compact.contains(Point(1.5, 1.5)))

    def test_matching_is_strict_and_does_not_duplicate_overlaps(self):
        outer = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)])
        inner = Polygon([(1, 1), (3, 1), (3, 3), (1, 3)])
        cities = [{'type': 'Feature', 'properties': {'id': name, 'population': 50, 'is_country_capital': True},
                   'geometry': {'type': 'Point', 'coordinates': coordinates}}
                  for name, coordinates in [('inside', [2, 2]), ('edge', [0, 1]), ('outside', [5, 5])]]
        features = build_collection([(outer, {}), (inner, {})], cities)['features']
        matches = [feature for feature in features if feature['properties']['city_ids']]
        self.assertEqual(len(matches), 1)
        self.assertEqual(shape(matches[0]['geometry']).area, 4)
        self.assertEqual(matches[0]['properties']['city_ids'], ['inside'])
        self.assertEqual(matches[0]['properties']['population_sum'], 50)
        self.assertEqual(matches[0]['properties']['capital_score'], 3)

    def test_ids_and_output_order_ignore_source_order(self):
        rows = [(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]), {}),
                (Polygon([(2, 0), (3, 0), (3, 1), (2, 1)]), {})]
        self.assertEqual(build_collection(rows, []), build_collection(list(reversed(rows)), []))

    def test_shipped_asset_covers_six_city_anchors_and_preserves_dark_holes(self):
        asset = json.loads((ROOT / 'data/world_urban_lights.geojson').read_text(encoding='utf-8'))
        features = asset['features']
        self.assertEqual(len(features), 11878)
        self.assertEqual(len({feature['id'] for feature in features}), len(features))
        self.assertLess((ROOT / 'data/world_urban_lights.geojson').stat().st_size, 8_000_000)
        self.assertEqual(sum(len(shape(feature['geometry']).interiors) for feature in features), 228)
        cities = json.loads((ROOT / 'data/world_cities.geojson').read_text(encoding='utf-8'))['features']
        city_names = {'London', 'Paris', 'Tokyo', 'Shanghai', 'New York City', 'Singapore'}
        selected = [city for city in cities if city['properties'].get('name_en') in city_names]
        self.assertEqual({city['properties']['name_en'] for city in selected}, city_names)
        city_ids = {city_id for feature in features for city_id in feature['properties']['city_ids']}
        for city in selected:
            self.assertIn(city['properties']['id'], city_ids)
        for feature in features:
            polygon = shape(feature['geometry'])
            self.assertTrue(polygon.is_valid)
            self.assertTrue(polygon.contains(Point(feature['properties']['anchor'])))
            for anchor in feature['properties']['anchors']:
                self.assertTrue(polygon.contains(Point(anchor)))


if __name__ == '__main__':
    unittest.main()
