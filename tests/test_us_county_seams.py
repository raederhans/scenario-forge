import unittest
from copy import deepcopy

from shapely.geometry import box, mapping, shape, Polygon
from map_builder.regional_geometry import _encode_exact_coverage
from tools.prepare_us_county_seams import constrain_seams


class CountySeamTests(unittest.TestCase):
    def fixture(self, foreign=None):
        baseline = _encode_exact_coverage(['OLD', 'CA'],
            [box(0, 0, 2.2, 1), foreign if foreign is not None else box(2, 0, 3, 1)])
        for row, code in zip(baseline['objects']['political']['geometries'], ['US', 'CA']):
            row['properties'].update(cntr_code=code, admin1_group='State' if code == 'US' else 'Canada')
        source = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': fid, 'admin1_group': 'State'}, 'geometry': mapping(g)}
            for fid, g in [('A', box(0, 0, 1, 1)), ('B', box(1, 0, 2.5, 1))]]}
        return source, baseline

    def test_clips_only_overlap_preserves_ids_and_inputs(self):
        source, baseline = self.fixture()
        original = deepcopy((source, baseline))
        output, report = constrain_seams(source, baseline)
        self.assertEqual((source, baseline), original)
        self.assertEqual(output['features'][0], source['features'][0])
        self.assertEqual(output['features'][1]['properties'], source['features'][1]['properties'])
        self.assertTrue(shape(output['features'][1]['geometry']).equals(box(1, 0, 2, 1)))
        self.assertAlmostEqual(report['foreign_overlaps_before'][0]['legacy_overlap_area_degrees2'], .2)
        self.assertEqual(report['foreign_overlap_area_after_degrees2'], 0)
        self.assertEqual(report['removed_union_area_degrees2'], .5)
        self.assertFalse(report['boundary_authority_claim'])

    def test_rejects_erased_county(self):
        source, baseline = self.fixture(box(0, 0, 3, 1))
        with self.assertRaisesRegex(ValueError, 'erased'):
            constrain_seams(source, baseline)

    def test_does_not_fill_gaps(self):
        source, baseline = self.fixture(box(3, 0, 4, 1))
        output, report = constrain_seams(source, baseline)
        self.assertEqual(output, source)
        self.assertEqual(report['changed_counties'], [])

    def test_rejects_invalid_neighbor(self):
        source, baseline = self.fixture(Polygon([(1, 0), (3, 1), (1, 1), (3, 0), (1, 0)]))
        with self.assertRaisesRegex(ValueError, 'Invalid neighbor'):
            constrain_seams(source, baseline)


if __name__ == '__main__':
    unittest.main()
