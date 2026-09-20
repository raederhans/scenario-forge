import unittest
from shapely import coverage_is_valid, get_num_coordinates, union_all
from shapely.geometry import Polygon, mapping, shape
import itertools
from pathlib import Path
from unittest.mock import patch, MagicMock

from tools.scenario_chunk_assets import _optimize_political_coarse_payload, _build_political_chunk_payloads


class ExplicitPrecisionLodTest(unittest.TestCase):
    def test_explicit_id_partial_owner_preserves_selected_and_leaves_unselected_legacy(self):
        # 3 features: A1 (selected), A2 (non-selected, same owner), B1 (non-selected, different owner)
        # We need them to share boundaries. A1 shares with A2 and B1.

        edges = [[(x + 0.00001234567 + (0.001 if i % 2 else 0), i / 20)
                  for i in range(21)] for x in range(4)]
        geometries = [Polygon(edges[i] + edges[i + 1][::-1]) for i in range(3)]

        # A1 is selected (explicit ID), A2 is same owner, B1 is different owner
        ids = ['A1', 'A2', 'B1']
        codes = ['AA', 'AA', 'BB']
        owners = {'A1': 'OWNER_A', 'A2': 'OWNER_A', 'B1': 'OWNER_B'}

        features = [{'type': 'Feature', 'properties': {'id': fid, 'cntr_code': code},
                     'geometry': mapping(geom)} for fid, code, geom in zip(ids, codes, geometries)]

        diagnostics = {}
        result = _optimize_political_coarse_payload(
            {'type': 'FeatureCollection', 'features': features},
            owner_buckets_by_feature_id=owners,
            political_precision_feature_ids={'A1'},
            diagnostics=diagnostics
        )

        coarse = [shape(f['geometry']) for f in result['features']]
        # A1 shouldn't be simplified along its shared boundaries, A2 and B1 get simplified independently.

        # Check that A1 geometry is untouched (except for possible ring orientation by orient_polygons)
        # We compare the shapes to ignore ring orientation.
        self.assertTrue(shape(result['features'][0]['geometry']).equals(shape(mapping(geometries[0]))))

        # B1 should be simplified
        self.assertLess(get_num_coordinates(coarse[2]), get_num_coordinates(geometries[2]))
        # A2 should also be simplified since it's legacy
        self.assertLess(get_num_coordinates(coarse[1]), get_num_coordinates(geometries[1]))

    def test_explicit_id_mixed_owner_lod_seam(self):
        # >=2 adjacent explicitly selected regions, DIFFERENT owners, differing 3-letter cntr_code
        edges = [[(x + 0.00001234567 + (0.001 if i % 2 else 0), i / 20)
                  for i in range(21)] for x in range(3)]
        geometries = [Polygon(edges[i] + edges[i + 1][::-1]) for i in range(2)]

        ids = ['RU_RAY_1', 'RU_OMS_1']
        codes = ['RAY', 'OMS']
        owners = {'RU_RAY_1': 'RUS', 'RU_OMS_1': 'OMS'}

        features = [{'type': 'Feature', 'properties': {'id': fid, 'cntr_code': code},
                     'geometry': mapping(geom)} for fid, code, geom in zip(ids, codes, geometries)]

        diagnostics = {}
        result = _optimize_political_coarse_payload(
            {'type': 'FeatureCollection', 'features': features},
            owner_buckets_by_feature_id=owners,
            political_precision_feature_ids={'RU_RAY_1', 'RU_OMS_1'},
            diagnostics=diagnostics
        )

        coarse = [shape(f['geometry']) for f in result['features']]
        # Because they are explicitly selected, their coarse representation will retain the shared boundary.
        # Check all combinations of detailed (original) and coarse
        tags = sorted(set(owners.values()))
        for flags in itertools.product([False, True], repeat=len(tags)):
            detailed = {tag for tag, flag in zip(tags, flags) if flag}
            mixed = [g if owners[fid] in detailed else c for fid, g, c in zip(ids, geometries, coarse)]
            self.assertTrue(coverage_is_valid(mixed))
            self.assertTrue(union_all(mixed).equals(union_all(geometries)))

    def test_explicit_id_with_3_letter_cntr_code(self):
        # Use a polygon with enough points that simplification will reduce it
        geometry = mapping(Polygon([
            (0, 0), (0.1, 0.001), (0.2, 0), (0.3, 0.001), (0.4, 0), (0.5, 0.001),
            (1, 0), (1, 1), (0, 1), (0, 0)
        ]))
        # 3-letter code like RU_RAY
        features = [
            {'type': 'Feature', 'properties': {'id': 'RU_RAY_123', 'cntr_code': 'RAY'}, 'geometry': geometry},
            {'type': 'Feature', 'properties': {'id': 'OTHER_1', 'cntr_code': 'OTH'}, 'geometry': geometry}
        ]
        owners = {'RU_RAY_123': 'RUS', 'OTHER_1': 'OTH'}

        result = _optimize_political_coarse_payload(
            {'type': 'FeatureCollection', 'features': features},
            owner_buckets_by_feature_id=owners,
            political_precision_feature_ids={'RU_RAY_123'}
        )

        # RU_RAY_123 should be untouched
        self.assertTrue(shape(result['features'][0]['geometry']).equals(shape(geometry)))
        # OTHER_1 should be simplified
        simplified_other = shape(result['features'][1]['geometry'])
        self.assertLess(get_num_coordinates(simplified_other), get_num_coordinates(shape(geometry)))

    @patch('tools.scenario_chunk_assets._write_json')
    @patch('tools.scenario_chunk_assets._write_minified_json')
    @patch('tools.scenario_chunk_assets._load_owner_map', return_value={'F1': 'A'})
    def test_build_boundary_rejects_malformed_and_unknown_ids(self, mock_load, mock_min_write, mock_write):
        scenario_dir = Path('/fake/scenario')

        startup_topology = {
            'objects': {
                'political': {
                    'type': 'GeometryCollection',
                    'geometries': [
                        {'type': 'Polygon', 'arcs': [[0]], 'id': 'F1'}
                    ]
                }
            },
            'arcs': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            'transform': {'scale': [1, 1], 'translate': [0, 0]}
        }

        runtime_topology = dict(startup_topology)

        # Test unknown ID
        runtime_topology['political_precision_feature_ids'] = ['F1', 'UNKNOWN_ID']

        with self.assertRaisesRegex(ValueError, "unknown IDs"):
            _build_political_chunk_payloads(
                scenario_id="test",
                scenario_dir=scenario_dir,
                startup_topology_payload=startup_topology,
                runtime_topology_payload=runtime_topology,
            )

        # Test malformed (empty)
        runtime_topology['political_precision_feature_ids'] = ['F1', '   ']
        with self.assertRaisesRegex(ValueError, "nonempty unique strings"):
            _build_political_chunk_payloads(
                scenario_id="test",
                scenario_dir=scenario_dir,
                startup_topology_payload=startup_topology,
                runtime_topology_payload=runtime_topology,
            )

        # Test malformed (duplicate)
        runtime_topology['political_precision_feature_ids'] = ['F1', 'F1']
        with self.assertRaisesRegex(ValueError, "nonempty unique strings"):
            _build_political_chunk_payloads(
                scenario_id="test",
                scenario_dir=scenario_dir,
                startup_topology_payload=startup_topology,
                runtime_topology_payload=runtime_topology,
            )

if __name__ == '__main__':
    unittest.main()
