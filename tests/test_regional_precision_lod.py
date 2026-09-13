import itertools
import unittest

from shapely import coverage_is_valid, get_num_coordinates, union_all
from shapely.geometry import Polygon, mapping, shape

from tools.scenario_chunk_assets import _optimize_political_coarse_payload


class RegionalPrecisionLodTest(unittest.TestCase):
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
