"""Political coarse boundaries must respect independently loaded detail shards."""
import itertools
import unittest
from shapely.geometry import Polygon, box, mapping, shape
from shapely.ops import unary_union
from tools import scenario_chunk_assets as assets


def feature(fid, geometry):
    return {'type': 'Feature', 'properties': {'id': fid, 'cntr_code': 'XX'}, 'geometry': mapping(geometry)}


class SharedShardLodTests(unittest.TestCase):
    def test_internal_simplification_preserves_every_mixed_shard_union(self):
        seam = [(1, 0), (1.00001, .25), (.99999, .5), (1.00001, .75), (1, 1)]
        left = Polygon([(0, 0), *seam, (0, 1)])
        right = Polygon([*seam, (2, 1), (2, 0)])
        other = box(2, 0, 3, 1)
        original = [left, right, other]
        payload = {'features': [feature(str(i), g) for i, g in enumerate(original)]}
        coarse = assets._optimize_political_coarse_payload(payload,
            owner_buckets_by_feature_id={'0': 'shard-a', '1': 'shard-a', '2': 'shard-b'})
        reduced = [shape(f['geometry']) for f in coarse['features']]
        self.assertLess(sum(len(g.exterior.coords) for g in reduced), sum(len(g.exterior.coords) for g in original))
        for first, second in itertools.product([False, True], repeat=2):
            mixed = [original[i] if (first if i < 2 else second) else reduced[i] for i in range(3)]
            self.assertTrue(unary_union(mixed).equals(unary_union(original)))
            self.assertAlmostEqual(sum(g.area for g in mixed), unary_union(mixed).area)

    def test_independent_shard_edge_never_rounds_or_simplifies(self):
        seam = [(1.000013, 0), (1.001013, .5), (1.000013, 1)]
        original = [Polygon([(0, 0), *seam, (0, 1)]), Polygon([*seam, (2, 1), (2, 0)])]
        coarse = assets._optimize_political_coarse_payload({'features': [feature(str(i), g) for i, g in enumerate(original)]},
            owner_buckets_by_feature_id={'0': 'shard-a', '1': 'shard-b'})
        for source, output in zip(original, coarse['features']):
            self.assertTrue(source.equals(shape(output['geometry'])))

    def test_preexisting_overlap_is_retained_without_repair(self):
        original = [box(0, 0, 2, 2), box(.5, .5, 1, 1), box(2, 0, 3, 2)]
        coarse = assets._optimize_political_coarse_payload({'features': [feature(str(i), g) for i, g in enumerate(original)]},
            owner_buckets_by_feature_id={'0': 'shard-a', '1': 'shard-b', '2': 'shard-a'})
        for source, output in zip(original, coarse['features']):
            self.assertTrue(source.equals(shape(output['geometry'])))

if __name__ == '__main__':
    unittest.main()
