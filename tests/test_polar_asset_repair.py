import unittest

from shapely.geometry import box

from map_builder.processors.arctic_recovery import _read, decoded_structure
from map_builder.regional_geometry import _encode_exact_coverage
from tools.rebuild_polar_assets import append_missing, refresh_neighbors, transplant_political


def topology(ids, geometries):
    result = _encode_exact_coverage(ids, geometries)
    for row in result['objects']['political']['geometries']:
        row['properties']['cntr_code'] = 'RU'
    return result


class PolarAssetRepairTest(unittest.TestCase):
    def test_ownerless_restore_excludes_existing_land_and_trims_helper(self):
        base = topology(['old', 'RU_ARCTIC_FB_1'], [box(0, 0, 1, 1), box(1, 0, 3, 1)])
        donor = topology(['missing'], [box(.5, 0, 2, 1)])
        output, report = append_missing(base, donor, ['missing'], ownerless=True)
        rows = {r['properties']['id']: r for r in output['objects']['political']['geometries']}
        self.assertEqual(report['added_ids'], ['missing'])
        self.assertEqual(_read(output, rows['missing']).area, 1)
        self.assertEqual(_read(output, rows['RU_ARCTIC_FB_1']).area, 1)
        self.assertNotIn('cntr_code', rows['missing']['properties'])
        self.assertEqual(decoded_structure(base, base['objects']['political']['geometries'][0]),
                         decoded_structure(output, rows['old']))
        repeated, again = append_missing(output, donor, ['missing'], ownerless=True)
        self.assertEqual(again['added_ids'], [])
        self.assertEqual(repeated, output)

    def test_neighbors_remap_removed_helper_and_add_island(self):
        before = topology(['west', 'removed', 'east'], [box(0, 0, 1, 1), box(9, 9, 10, 10), box(1, 0, 2, 1)])
        before['objects']['political']['computed_neighbors'] = [[2], [], [0]]
        after = topology(['west', 'east', 'island'], [box(0, 0, 1, 1), box(1, 0, 2, 1), box(2, 0, 3, 1)])
        refresh_neighbors(before, after, {'island'})
        self.assertEqual(after['objects']['political']['computed_neighbors'], [[1], [0, 2], [1]])

    def test_missing_donors_do_not_duplicate_each_other(self):
        before = topology(['old'], [box(-3, 0, -2, 1)])
        donor = topology(['second', 'first'], [box(1, 0, 3, 1), box(0, 0, 2, 1)])
        result, report = append_missing(before, donor, ['first', 'second'], ownerless=True)
        rows = {r['properties']['id']: r for r in result['objects']['political']['geometries']}
        first, second = [_read(result, rows[fid]) for fid in ('first', 'second')]
        self.assertEqual(report['added_ids'], ['first', 'second'])
        self.assertEqual(first.intersection(second).area, 0)
        self.assertEqual(first.union(second).area, 3)

    def test_transplant_preserves_current_nonpolitical_geometry(self):
        before = topology(['old'], [box(0, 0, 1, 1)])
        before['objects']['water'] = before['objects']['political']['geometries'][0].copy()
        candidate = topology(['new'], [box(3, 3, 4, 4)])
        output = transplant_political(before, candidate)
        self.assertEqual(decoded_structure(before, before['objects']['water']),
                         decoded_structure(output, output['objects']['water']))
        self.assertEqual(output['objects']['political']['geometries'][0]['properties']['id'], 'new')


if __name__ == '__main__':
    unittest.main()
