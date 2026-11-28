import unittest

from shapely.geometry import box, mapping

from tools.prepare_us_county_adaptation_sidecars import adapt_asset, build_crosswalk


class SidecarTests(unittest.TestCase):
    def setUp(self):
        self.crosswalk = {'US_OLD': ['US_A', 'US_B'], 'FR_1': ['FR_1']}
        self.geometries = {'US_A': box(0, 0, 1, 1), 'US_B': box(1, 0, 2, 1)}

    def test_bucket_totals_and_anchors_are_not_duplicated(self):
        payload = {'bucket_by_feature': {'US_OLD': 's1', 'FR_1': 's2'},
                   'buckets': {'s1': {'manpower': 100, 'steel': 20}, 's2': {'steel': 30}},
                   'metrics': {'steel': {'max': 30}}, 'resource_points': {'features': [{'amount': 20}]},
                   'victory_points': [{'host_feature_id': 'US_OLD', 'lon': .5, 'lat': .5, 'value': 10},
                                      {'host_feature_id': 'FR_1', 'value': 4}]}
        result, unresolved = adapt_asset('strategic_values.by_feature.json', payload, self.crosswalk, self.geometries)
        self.assertEqual(unresolved, [])
        self.assertEqual(result['bucket_by_feature'], {'US_A': 's1', 'US_B': 's1', 'FR_1': 's2'})
        for key in ('buckets', 'metrics', 'resource_points'):
            self.assertEqual(result[key], payload[key])
        self.assertEqual(len(result['victory_points']), 2)
        self.assertEqual(result['victory_points'][0]['host_feature_id'], 'US_A')
        self.assertEqual(result['victory_points'][1], payload['victory_points'][1])
        self.assertEqual(payload['victory_points'][0]['host_feature_id'], 'US_OLD')

    def test_ambiguous_missing_and_outside_points_remain_unresolved(self):
        for coordinates in ({'lon': 1, 'lat': .5}, {'lon': 4, 'lat': .5}, {}):
            result, unresolved = adapt_asset('capital_hints.json', {'entries': [{'host_feature_id': 'US_OLD', **coordinates}]}, self.crosswalk, self.geometries)
            self.assertEqual(len(unresolved), 1)
            self.assertEqual(result['entries'][0]['host_feature_id'], 'US_OLD')

    def test_crosswalk_identity_and_duplicate_rejection(self):
        feature = {'id': 'US_A', 'properties': {'id': 'US_A'}, 'geometry': mapping(box(0, 0, 1, 1)),
                   'lineage': {'old_feature_id': 'US_OLD', 'piece_id': 'US_A'}}
        crosswalk, _ = build_crosswalk(['US_OLD', 'FR_1'], ['US_OLD'], [feature])
        self.assertEqual(crosswalk, {'FR_1': ['FR_1'], 'US_OLD': ['US_A']})
        with self.assertRaises(ValueError):
            build_crosswalk(['US_OLD', 'FR_1'], ['US_OLD'], [feature, feature])
        with self.assertRaises(ValueError):
            build_crosswalk(['US_OLD'], ['US_OLD'], [])


if __name__ == '__main__':
    unittest.main()
