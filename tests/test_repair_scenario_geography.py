from copy import deepcopy
import unittest

import geopandas as gpd
import shapely
from shapely.geometry import box

from map_builder.regional_geometry import _encode_exact_coverage
from map_builder.processors.arctic_recovery import _read, decoded_structure
from tools.repair_scenario_geography import repair_topology, repair_placeholder_frame, PLACEHOLDER_ID, SOMALIA_IDS, GUIANA_ID


def fixture(items):
    topology = _encode_exact_coverage(list(items), list(items.values()))
    for row in topology['objects']['political']['geometries']:
        row['properties'].update(owner='KEEP', cntr_code='XX', name=row['properties']['id'])
    topology['objects']['extra'] = {'type': 'LineString', 'arcs': [0]}
    return topology


def shapes(topology):
    return {row['properties']['id']: _read(topology, row)
            for row in topology['objects']['political']['geometries']}


class ScenarioGeographyRepairTests(unittest.TestCase):
    def test_builder_frame_policy_is_idempotent_and_preserves_metadata(self):
        frame = gpd.GeoDataFrame([
            {'id': PLACEHOLDER_ID, 'owner': 'RAJ', 'geometry': box(0, 0, 3, 2)},
            {'id': 'PAK-1111', 'owner': 'PAK', 'geometry': box(0, 0, 2, 2)},
            {'id': 'OTHER', 'owner': 'RAJ', 'geometry': box(5, 5, 6, 6)},
        ], crs=4326)
        repaired = repair_placeholder_frame(frame)
        self.assertEqual(repaired.iloc[0].geometry.area, 2)
        self.assertEqual(repaired.iloc[0]['owner'], 'RAJ')
        self.assertEqual(frame.iloc[0].geometry.area, 6)
        self.assertTrue(repaired.iloc[1].geometry.equals_exact(frame.iloc[1].geometry, 0))
        self.assertIs(repair_placeholder_frame(repaired), repaired)
        absent = frame.iloc[1:]
        self.assertIs(repair_placeholder_frame(absent), absent)

    def test_overlap_preserves_union_and_unrelated_geometry(self):
        before = fixture({PLACEHOLDER_ID: box(0, 0, 3, 2), 'PAK-1111': box(0, 0, 2, 2),
                          'KEEP': box(6, 6, 7, 7)})
        original = deepcopy(before)
        after, report = repair_topology(before)
        a, b = shapes(after), shapes(before)
        self.assertEqual(before, original)
        self.assertEqual(report['changed_ids'], [PLACEHOLDER_ID])
        self.assertEqual(a[PLACEHOLDER_ID].intersection(a['PAK-1111']).area, 0)
        self.assertTrue(shapely.union_all(list(a.values())).equals(shapely.union_all(list(b.values()))))
        self.assertEqual(decoded_structure(before, before['objects']['extra']),
                         decoded_structure(after, after['objects']['extra']))
        self.assertEqual(repair_topology(after)[0], after)

    def test_fully_covered_placeholder_removal_is_reported(self):
        before = fixture({PLACEHOLDER_ID: box(0, 0, 1, 1), 'PAK-1109': box(0, 0, 2, 2)})
        after, report = repair_topology(before)
        self.assertEqual(report['removed_ids'], [PLACEHOLDER_ID])
        self.assertNotIn(PLACEHOLDER_ID, shapes(after))
        self.assertEqual(after['objects']['political']['computed_neighbors'], [[]])

    def test_recovery_preserves_owner_and_avoids_occupied_donor_coverage(self):
        fid = SOMALIA_IDS[0]
        before = fixture({fid: box(0, 0, 1, 1), 'KEEP': box(2, 0, 3, 1)})
        donor = fixture({fid: box(0, 0, 3, 1), GUIANA_ID: box(5, 0, 6, 1)})
        after, report = repair_topology(before, donor, restore_ids=[fid], add_ids=[GUIANA_ID], ownerless=True)
        geom = shapes(after)
        self.assertEqual(geom[fid].area, 2)
        self.assertEqual(geom[fid].intersection(geom['KEEP']).area, 0)
        props = {r['properties']['id']: r['properties'] for r in after['objects']['political']['geometries']}
        self.assertEqual(props[fid]['owner'], 'KEEP')
        self.assertNotIn('owner', props[GUIANA_ID])
        self.assertNotIn('cntr_code', props[GUIANA_ID])
        self.assertEqual(report['added_ids'], [GUIANA_ID])
        self.assertEqual(repair_topology(after, donor, restore_ids=[fid], add_ids=[GUIANA_ID])[0], after)

    def test_missing_donor_fails_without_mutating_input(self):
        before = fixture({'KEEP': box(0, 0, 1, 1)})
        original = deepcopy(before)
        with self.assertRaisesRegex(ValueError, 'Missing donor identity'):
            repair_topology(before, before, add_ids=[GUIANA_ID])
        self.assertEqual(before, original)


if __name__ == '__main__':
    unittest.main()
