import unittest
import json
from pathlib import Path
import tempfile

from shapely.geometry import box, mapping

from tools.prepare_us_county_adaptation_sidecars import adapt_asset, build_crosswalk, digest, run


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

    def test_single_child_city_without_coordinates_but_vp_requires_point(self):
        crosswalk = {'US_OLD': ['US_A']}
        payload = {'host_feature_id': 'US_OLD'}
        city, unresolved = adapt_asset('city_overrides.json', payload, crosswalk, self.geometries)
        self.assertEqual(city['host_feature_id'], 'US_A')
        self.assertEqual(unresolved, [])
        _, unresolved = adapt_asset('victory_points.json', [payload], crosswalk, self.geometries)
        self.assertEqual(len(unresolved), 1)

    def test_mutations_expand_assignments_and_inherit_historical_labels(self):
        payload = {'assignments_by_feature_id': {'US_OLD': {'owner': 'USA', 'cores': ['USA']}, 'FR_1': {'owner': 'FRA'}},
                   'geo_locale': {'US_OLD': {'en': 'Old County'}}}
        result, unresolved = adapt_asset('scenario_mutations.json', payload, self.crosswalk, self.geometries)
        self.assertEqual(result['assignments_by_feature_id']['US_A'], payload['assignments_by_feature_id']['US_OLD'])
        self.assertEqual(result['assignments_by_feature_id']['US_B'], payload['assignments_by_feature_id']['US_OLD'])
        self.assertEqual(result['assignments_by_feature_id']['FR_1'], payload['assignments_by_feature_id']['FR_1'])
        self.assertEqual(result['geo_locale'], {'US_A': {'en': 'Old County'}, 'US_B': {'en': 'Old County'}})
        self.assertEqual(unresolved, [])
        payload['geo_locale']['US_OLD']['population'] = 10
        result, unresolved = adapt_asset('scenario_mutations.json', payload, self.crosswalk, self.geometries)
        self.assertEqual(result['geo_locale'], payload['geo_locale'])
        self.assertEqual(unresolved[0]['field'], '/geo_locale/US_OLD')

    def test_crosswalk_identity_and_duplicate_rejection(self):
        feature = {'id': 'US_A', 'properties': {'id': 'US_A'}, 'geometry': mapping(box(0, 0, 1, 1)),
                   'lineage': {'old_feature_id': 'US_OLD', 'piece_id': 'US_A'}}
        crosswalk, _ = build_crosswalk(['US_OLD', 'FR_1'], ['US_OLD'], [feature])
        self.assertEqual(crosswalk, {'FR_1': ['FR_1'], 'US_OLD': ['US_A']})
        with self.assertRaises(ValueError):
            build_crosswalk(['US_OLD', 'FR_1'], ['US_OLD'], [feature, feature])
        with self.assertRaises(ValueError):
            build_crosswalk(['US_OLD'], ['US_OLD'], [])

    def test_run_binds_hashes_and_suppresses_unresolved_asset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scenario = root / 'data/scenarios/test'
            adaptation = root / 'adaptation/test'
            scenario.mkdir(parents=True)
            adaptation.mkdir(parents=True)
            def put(path, value):
                path.write_text(json.dumps(value), encoding='utf-8')
            source = root / 'counties.geojson'
            put(source, {'features': []})
            put(root / 'source-report.json', {'display_geojson_sha256': digest(source)})
            baseline = scenario / 'runtime.json'
            put(baseline, {'objects': {'political': {'geometries': [{'properties': {'id': 'US_OLD'}}, {'properties': {'id': 'FR_1'}}]}}})
            put(scenario / 'manifest.json', {'runtime_topology_url': 'data/scenarios/test/runtime.json'})
            report = {'scenario_id': 'test', 'source_sha256': digest(source), 'baseline_sha256': digest(baseline), 'replaced_old_ids': ['US_OLD']}
            put(adaptation / 'adaptation.report.json', report)
            features = [{'id': fid, 'properties': {'id': fid}, 'geometry': mapping(geometry),
                         'lineage': {'old_feature_id': 'US_OLD', 'piece_id': fid}}
                        for fid, geometry in self.geometries.items()]
            put(adaptation / 'county_overlay.geojson', {'features': features})
            put(scenario / 'city_overrides.json', {'host_feature_id': 'US_OLD'})
            output = root / '.runtime/output'
            summary = run(root / 'adaptation', output, source_path=source, root=root)
            self.assertFalse(summary[0]['sidecar_plan_passed'])
            self.assertFalse((output / 'test/city_overrides.json').exists())
            self.assertTrue((output / 'test/crosswalk.json').exists())
            baseline.write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Stale adaptation'):
                run(root / 'adaptation', root / '.runtime/stale-output', source_path=source, root=root)
            self.assertFalse((root / '.runtime/stale-output').exists())
            with self.assertRaisesRegex(ValueError, 'under .runtime'):
                run(root / 'adaptation', root / 'data/output', source_path=source, root=root)


if __name__ == '__main__':
    unittest.main()
