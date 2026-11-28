from copy import deepcopy
import unittest
from shapely.geometry import box, mapping, Polygon

from map_builder.processors.arctic_recovery import recover_arctic
from map_builder.regional_geometry import _encode_exact_coverage, _decode_geometry


class ArcticRecoveryTests(unittest.TestCase):
    def fixture(self):
        ids = ['RU_RAY_1', 'NEIGHBOR', 'RU_ARCTIC_FB_RKM_001']
        shapes = [box(0, 70, 4, 72.997), box(3, 74, 4, 76), box(0, 73, 4, 78)]
        topology = _encode_exact_coverage(ids, shapes)
        for item in topology['objects']['political']['geometries']:
            item['properties']['cntr_code'] = 'RU'
        props = topology['objects']['political']['geometries'][2]['properties']
        props.update(scenario_helper_kind='shell_fallback', interactive=False,
                     scenario_shell_owner_hint='OWNER',
                     scenario_shell_controller_hint='OWNER')
        land = _encode_exact_coverage(['land'], [Polygon([(0, 69), (4, 69), (4, 80), (0, 80)],
            holes=[[(1, 75), (2, 75), (2, 76), (1, 76)]])])
        topology['objects']['land'] = land['objects']['political']
        from map_builder.regional_geometry import _offset_arcs
        topology['objects']['land']['geometries'][0]['arcs'] = _offset_arcs(
            topology['objects']['land']['geometries'][0]['arcs'], len(topology['arcs']))
        topology['arcs'].extend(land['arcs'])
        source = {'features': [{'properties': {'shapeID': '1'}, 'geometry': mapping(box(0, 70, 4, 78))}]}
        return topology, source

    def decoded(self, topology):
        return {g['properties']['id']: _decode_geometry(topology, g)
                for g in topology['objects']['political']['geometries']}

    def test_recovery_protects_neighbors_lakes_and_original(self):
        topology, source = self.fixture()
        topology['objects']['political']['geometries'][0]['bbox'] = [0, 70, 4, 72.997]
        unchanged = deepcopy(topology)
        result, report = recover_arctic(topology, source)
        shapes = self.decoded(result)
        self.assertEqual(topology, unchanged)
        self.assertEqual(shapes['RU_RAY_1'].bounds[3], 78)
        self.assertEqual(result['objects']['political']['geometries'][0]['bbox'], [0, 70, 4, 78])
        self.assertAlmostEqual(shapes['RU_RAY_1'].intersection(box(1, 75, 2, 76)).area, 0)
        self.assertAlmostEqual(shapes['RU_RAY_1'].intersection(shapes['NEIGHBOR']).area, 0)
        self.assertEqual(shapes['NEIGHBOR'].wkb, self.decoded(topology)['NEIGHBOR'].wkb)
        self.assertAlmostEqual(self.decoded(topology)['RU_RAY_1'].difference(shapes['RU_RAY_1']).area, 0)
        self.assertAlmostEqual(shapes['RU_RAY_1'].intersection(box(0, 72.997, 3, 73)).area, .009)
        self.assertAlmostEqual(shapes['RU_ARCTIC_FB_RKM_001'].intersection(shapes['RU_RAY_1']).area, 0)
        self.assertTrue(report['non_target_coordinates_preserved'])
        self.assertTrue(report['nonpolitical_coordinates_preserved'])
        self.assertEqual(_decode_geometry(topology, topology['objects']['land']).wkb,
                         _decode_geometry(result, result['objects']['land']).wkb)

    def test_degenerate_baseline_and_base_helper_prefix_preserved(self):
        from map_builder.processors.arctic_recovery import decoded_structure
        topology, source = self.fixture()
        topology['objects']['political']['geometries'][2]['properties'] = {
            'id': 'RU_ARCTIC_FB_RKM_001', 'cntr_code': 'RU'}
        index = len(topology['arcs'])
        topology['arcs'].append([[20, 70], [20, 70]])
        bad = {'type': 'Polygon', 'arcs': [[index]], 'properties': {'id': 'DEGENERATE'}}
        topology['objects']['political']['geometries'].append(bad)
        result, report = recover_arctic(topology, source)
        kept = next(g for g in result['objects']['political']['geometries'] if g['properties']['id'] == 'DEGENERATE')
        self.assertEqual(decoded_structure(topology, bad), decoded_structure(result, kept))
        self.assertTrue(report['non_target_coordinates_preserved'])
        with self.assertRaisesRegex(ValueError, 'Not a removable Arctic helper'):
            recover_arctic(topology, source, owners={'RU_RAY_1': 'OWNER'})


if __name__ == '__main__':
    unittest.main()
