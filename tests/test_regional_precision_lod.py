import itertools
import unittest

from shapely import coverage_is_valid, get_num_coordinates, union_all
from shapely.geometry import Polygon, box, mapping, shape
from unittest.mock import patch

from tools.scenario_chunk_assets import _optimize_political_coarse_payload, _shared_coverage_simplified_geometries


class RegionalPrecisionLodTest(unittest.TestCase):
    def test_partial_coverage_preserves_overlap_participants_across_shards(self):
        edge = [(1 + (0.001 if i % 2 else 0), i / 20) for i in range(21)]
        geometries = [Polygon([(0, 0), *edge, (0, 1)]),
                      Polygon([*edge, (2, 1), (2, 0)]),
                      Polygon([(4, 0), (6, 0), (6, 1), (4, 1)]),
                      Polygon([(5, 0), (7, 0), (7, 1), (5, 1)])]
        features = [{'properties': {'id': str(i), 'cntr_code': 'US'}, 'geometry': mapping(g)}
                    for i, g in enumerate(geometries)]
        # The two overlap participants are in different load shards; neither
        # may become eligible simply because its own shard looks valid.
        buckets = {'0': 'A', '1': 'A', '2': 'A', '3': 'B'}
        diagnostics = {}
        result = _optimize_political_coarse_payload(
            {'features': features}, owner_buckets_by_feature_id=buckets,
            precision_source_countries={'US'}, diagnostics=diagnostics)
        coarse = [shape(f['geometry']) for f in result['features']]
        self.assertLess(sum(get_num_coordinates(coarse)), sum(get_num_coordinates(geometries)))
        self.assertEqual(diagnostics['regional_shared_coverage_eligible_count'], 2)
        self.assertEqual(diagnostics['regional_shared_coverage_retained_count'], 2)
        for i in (2, 3):
            self.assertEqual(result['features'][i]['geometry'], features[i]['geometry'])
        for flags in itertools.product([False, True], repeat=2):
            detailed = {tag for tag, flag in zip(['A', 'B'], flags) if flag}
            mixed = [g if buckets[str(i)] in detailed else c for i, (g, c) in enumerate(zip(geometries, coarse))]
            self.assertTrue(union_all(mixed).equals(union_all(geometries)))
            self.assertEqual(mixed[2].intersection(mixed[3]).area, geometries[2].intersection(geometries[3]).area)
        self.assertTrue(all(not g.exterior.is_ccw for g in coarse[:2]))

    def test_partial_coverage_rejects_shard_union_drift(self):
        left = Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])
        right = Polygon([(1, 0), (2, 0), (2, 1), (1, 1)])
        features = [(i, {'properties': {'id': str(i)}, 'geometry': mapping(g)})
                    for i, g in enumerate([left, right])]
        # First two unions validate the eligible subset; the next two model a
        # reinsertion union discrepancy observed in a real USA candidate shard.
        with patch('tools.scenario_chunk_assets.unary_union', side_effect=[left, left, left, right]):
            output, applied = _shared_coverage_simplified_geometries(
                features, {'0': 'A', '1': 'A'}, allow_partial=True)
        self.assertFalse(applied)
        self.assertEqual(output, {})

    def test_containing_polygon_is_retained_even_when_only_inner_edges_are_invalid(self):
        edge = [(1 + (0.001 if i % 2 else 0), i / 20) for i in range(21)]
        geometries = [Polygon([(0, 0), *edge, (0, 1)]),
                      Polygon([*edge, (2, 1), (2, 0)]), box(1.0002, .549, 1.0006, .551)]
        features = [{'properties': {'id': str(i), 'cntr_code': 'US'}, 'geometry': mapping(g)}
                    for i, g in enumerate(geometries)]
        result = _optimize_political_coarse_payload(
            {'features': features}, owner_buckets_by_feature_id={'0': 'A', '1': 'A', '2': 'B'},
            precision_source_countries={'US'})
        for i in (0, 2):
            self.assertEqual(result['features'][i]['geometry'], features[i]['geometry'])
        coarse = [shape(f['geometry']) for f in result['features']]
        for detail_a, detail_b in itertools.product([False, True], repeat=2):
            mixed = [geometries[i] if (detail_a if i < 2 else detail_b) else coarse[i] for i in range(3)]
            self.assertTrue(mixed[0].intersection(mixed[2]).equals(geometries[0].intersection(geometries[2])))
            self.assertTrue(union_all(mixed).equals(union_all(geometries)))

    def test_partial_coverage_retains_overlap_with_undeclared_foreign_feature(self):
        edge = [(1 + (0.001 if i % 2 else 0), i / 20) for i in range(21)]
        geometries = [Polygon([(0, 0), *edge, (0, 1)]),
                      Polygon([*edge, (2, 1), (2, 0)]), box(4, 0, 6, 1), box(5, 0, 7, 1),
                      box(1.0002, .549, 1.0006, .551)]
        features = [{'properties': {'id': str(i), 'cntr_code': 'MX' if i == 4 else 'US'},
                     'geometry': mapping(g)} for i, g in enumerate(geometries)]
        result = _optimize_political_coarse_payload(
            {'features': features}, owner_buckets_by_feature_id={str(i): 'A' for i in range(5)},
            precision_source_countries={'US'})
        # An unrelated declared overlap triggers partial fallback. The foreign
        # inner polygon is outside that coverage but must still protect its host.
        self.assertEqual(result['features'][0]['geometry'], features[0]['geometry'])

    def test_joint_source_countries_keep_mixed_owner_lods_connected(self):
        edges = [[(x + 0.00001234567 + (0.001 if i % 2 else 0), i / 20)
                  for i in range(21)] for x in range(5)]
        geometries = [Polygon(edges[i] + edges[i + 1][::-1]) for i in range(4)]
        codes = ['BE', 'DE', 'DE', 'NL']
        ids = ['BE1', 'DE1', 'DE2', 'NL1']
        owners = dict(zip(ids, ['BRG', 'GER', 'GER', 'HOL']))
        features = [{'type': 'Feature', 'properties': {'id': fid, 'cntr_code': code},
                     'geometry': mapping(geom)} for fid, code, geom in zip(ids, codes, geometries)]
        diagnostics = {}
        result = _optimize_political_coarse_payload(
            {'type': 'FeatureCollection', 'features': features},
            owner_buckets_by_feature_id=owners,
            precision_source_countries={'DE', 'BE', 'NL'}, diagnostics=diagnostics)
        coarse = [shape(f['geometry']) for f in result['features']]
        self.assertTrue(diagnostics['regional_shared_coverage_applied'])
        self.assertLess(sum(get_num_coordinates(coarse)), sum(get_num_coordinates(geometries)))
        tags = sorted(set(owners.values()))
        for flags in itertools.product([False, True], repeat=len(tags)):
            detailed = {tag for tag, flag in zip(tags, flags) if flag}
            mixed = [g if owners[fid] in detailed else c for fid, g, c in zip(ids, geometries, coarse)]
            self.assertTrue(coverage_is_valid(mixed))
            self.assertTrue(union_all(mixed).equals(union_all(geometries)))
        self.assertEqual([f['properties'] for f in result['features']], [f['properties'] for f in features])

    def test_declared_region_never_falls_back_to_individual_rounding(self):
        geometry = mapping(Polygon([(0.000012345, 0), (1, 0), (1, 1), (0.000012345, 0)]))
        features = [{'type': 'Feature', 'properties': {'id': 'DE1', 'cntr_code': 'DE'}, 'geometry': geometry}]
        result = _optimize_political_coarse_payload(
            {'features': features}, precision_source_countries={'DE'})
        self.assertEqual(result['features'][0]['geometry'], geometry)


if __name__ == '__main__':
    unittest.main()
