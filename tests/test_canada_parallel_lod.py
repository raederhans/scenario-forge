import itertools
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Polygon, mapping, shape

from tools import scenario_chunk_assets as assets


REPO_ROOT = Path(__file__).resolve().parents[1]
LATITUDE = 60.00087751777518
LONGITUDES = [-123.78903789037889, -119.99819998199982,
              -115.56655566555665, -110.00090000900009, -102.00162001620016]


def _fixture():
    # NWT has a single segment; its four southern neighbours supply the nodes.
    polygons = [Polygon([(LONGITUDES[0], LATITUDE), (LONGITUDES[-1], LATITUDE),
                         (LONGITUDES[-1], 65), (LONGITUDES[0], 65)])]
    polygons.extend(Polygon([(a, LATITUDE), (a, 58), (b, 58), (b, LATITUDE)])
                    for a, b in zip(LONGITUDES, LONGITUDES[1:]))
    ids = ['CA_FED_61001', 'CA_FED_59026', 'CA_FED_48032', 'CA_FED_48025', 'CA_FED_47003']
    return {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'properties': {'id': feature_id, 'cntr_code': 'CA', 'name': feature_id},
         'geometry': mapping(polygon)} for feature_id, polygon in zip(ids, polygons)
    ]}


def _parallel(feature, west, east):
    points = {tuple(point) for ring in assets._polygon_rings(feature['geometry'])
              for point in ring if point[1] == LATITUDE and west <= point[0] <= east}
    return sorted(points)


class CanadaParallelLodTest(unittest.TestCase):
    def test_topology_normalizer_preserves_untouched_geometry_properties_and_neighbors(self):
        from copy import deepcopy
        from map_builder.processors.arctic_recovery import decoded_structure
        from map_builder.regional_geometry import _absolute_topology, _encode_exact_coverage

        source = _fixture()
        source['features'].append({'type': 'Feature', 'properties': {'id': 'UNRELATED'},
                                   'geometry': mapping(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]))})
        ids = [f['properties']['id'] for f in source['features']]
        topology = _encode_exact_coverage(ids, [shape(f['geometry']) for f in source['features']])
        rows = topology['objects']['political']['geometries']
        for index, row in enumerate(rows):
            row['properties'].update(marker=index, name='preserved')
            row['id'] = index
        # Include a non-political object sharing an arc, plus neighbour metadata.
        topology['objects']['water'] = {'type': 'GeometryCollection', 'geometries': [
            {'type': 'LineString', 'arcs': [0], 'properties': {'id': 'water'}}]}
        topology['neighbors'] = [[1], [0]]
        before = deepcopy(topology)
        normalized = assets.normalize_canada_topology(topology)
        self.assertEqual(topology, before)
        self.assertEqual(assets.normalize_canada_topology(normalized), normalized)
        self.assertEqual(normalized['neighbors'], before['neighbors'])
        self.assertEqual(decoded_structure(normalized, normalized['objects']['water']),
                         decoded_structure(_absolute_topology(before), before['objects']['water']))
        for original, updated in zip(rows, normalized['objects']['political']['geometries']):
            self.assertEqual(original['properties'], updated['properties'])
            self.assertEqual(original['id'], updated['id'])
            if original['properties']['id'] != 'CA_FED_61001':
                self.assertEqual(decoded_structure(before, original), decoded_structure(normalized, updated))
        unrelated = _encode_exact_coverage(['other'], [Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])])
        self.assertEqual(assets.normalize_canada_topology(unrelated), unrelated)

    def test_normal_runtime_builder_output_keeps_joint_source_nodes(self):
        from tools.build_runtime_political_topology import _write_output_topology
        from map_builder.processors.arctic_recovery import decoded_structure
        from map_builder.regional_geometry import _absolute_topology

        source = _fixture()
        frame = gpd.GeoDataFrame([dict(f['properties'], geometry=shape(f['geometry']))
                                  for f in source['features']], crs='EPSG:4326')
        runtime_dir = REPO_ROOT / '.runtime' / 'tmp'
        runtime_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime_dir) as temporary:
            output_path = Path(temporary) / 'runtime.topo.json'
            _write_output_topology(output_path=output_path, political=frame)
            topology = _absolute_topology(json.loads(output_path.read_text(encoding='utf-8')))
        features = [{'properties': row['properties'], 'geometry': decoded_structure(topology, row)}
                    for row in topology['objects']['political']['geometries']]
        north_edges = assets._canada_parallel_edges(features[0])
        self.assertEqual(len(north_edges), 4)
        latitude = north_edges[0][0][1]
        north_nodes = {tuple(point) for edge in north_edges for point in edge}
        for feature in features[1:]:
            south_nodes = {tuple(point) for edge in assets._canada_parallel_edges(feature) for point in edge}
            west, east = sorted(point[0] for point in south_nodes)
            self.assertEqual({p for p in north_nodes if west <= p[0] <= east}, south_nodes)
            self.assertTrue(all(point[1] == latitude for point in south_nodes))

    def test_source_nodes_make_actual_d3_paths_equal_for_every_mixed_lod(self):
        source = _fixture()
        original_text = json.dumps(source)
        detail = assets._normalize_canada_parallel_boundary_nodes(source)
        coarse = assets._optimize_political_coarse_payload(source)
        self.assertEqual(json.dumps(source), original_text)
        self.assertEqual(assets._normalize_canada_parallel_boundary_nodes(detail), detail)
        for original, normalized in zip(source['features'], detail['features']):
            self.assertTrue(shape(original['geometry']).equals(shape(normalized['geometry'])))
        paths = []
        for flags in itertools.product([False, True], repeat=5):
            mixed = [detail['features'][i] if flag else coarse['features'][i]
                     for i, flag in enumerate(flags)]
            for neighbour, (west, east) in zip(mixed[1:], zip(LONGITUDES, LONGITUDES[1:])):
                north = _parallel(mixed[0], west, east)
                south = _parallel(neighbour, west, east)
                self.assertEqual(north, south)
                paths.extend([north, south])
        # Use the same vendored D3 and projection as the renderer. This exposes
        # the curved crack that a planar Shapely intersection cannot detect.
        paths += [[(LONGITUDES[0], LATITUDE), (LONGITUDES[-1], LATITUDE)],
                  [(x, LATITUDE) for x in LONGITUDES]]
        script = """
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = {};
vm.runInNewContext(fs.readFileSync('vendor/d3.v7.min.js', 'utf8'), sandbox);
const path = sandbox.d3.geoPath(sandbox.d3.geoEqualEarth().scale(800).precision(0.1));
const lines = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(lines.map(coordinates => path({type: 'LineString', coordinates}))));
"""
        result = subprocess.run(['node', '-e', script], input=json.dumps(paths), text=True,
                                capture_output=True, cwd=REPO_ROOT, check=True)
        projected = json.loads(result.stdout)
        for north, south in zip(projected[:-2:2], projected[1:-2:2]):
            self.assertEqual(north, south)
        self.assertNotEqual(projected[-2], projected[-1])

    def test_unrelated_canadian_edges_still_simplify_and_precision_still_stays_exact(self):
        source = _fixture()
        unrelated = {'type': 'Feature', 'properties': {'id': 'CA_FED_10001', 'cntr_code': 'CA'},
                     'geometry': mapping(Polygon([(0, 0), (.25, -.002), (.5, 0), (1, 0), (1, 1), (0, 1)]))}
        precise = {'type': 'Feature', 'properties': {'id': 'US_precise', 'cntr_code': 'US'},
                   'geometry': mapping(Polygon([(4.000012345, 0), (5, 0), (5, 1), (4.000012345, 1)]))}
        source['features'].extend([unrelated, precise])
        result = assets._optimize_political_coarse_payload(source, political_precision_feature_ids={'US_precise'})
        expected = assets._round_feature_geometry(
            {'geometry': assets._simplify_political_coarse_geometry(unrelated['geometry'])},
            decimals=assets.POLITICAL_COARSE_ROUND_DECIMALS)
        self.assertEqual(result['features'][-2]['geometry'], expected)
        self.assertLess(len(expected['coordinates'][0]), len(unrelated['geometry']['coordinates'][0]))
        self.assertEqual(result['features'][-1]['geometry'], precise['geometry'])
        self.assertEqual([f['properties'] for f in result['features']],
                         [f['properties'] for f in source['features']])

    def test_chunk_builder_nodes_detail_and_rebuilds_affected_reusable_shard(self):
        source = _fixture()
        runtime_dir = REPO_ROOT / '.runtime' / 'tmp'
        runtime_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime_dir) as temporary:
            scenario_dir = Path(temporary)
            owners = {feature['properties']['id']: 'CAN' for feature in source['features']}
            (scenario_dir / 'owners.by_feature.json').write_text(json.dumps({'owners': owners}), encoding='utf-8')
            with patch.object(assets, '_topology_object_to_feature_collection', return_value=source):
                chunks, _ = assets._build_political_chunk_payloads(
                    scenario_id='test', scenario_dir=scenario_dir,
                    startup_topology_payload={}, runtime_topology_payload={})
                reusable = {chunk['id']: chunk for chunk in chunks if chunk['lod'] == 'detail'}
                # Simulate a previous build with identical IDs but the old seam.
                for chunk in reusable.values():
                    (scenario_dir / 'chunks' / (chunk['id'] + '.json')).write_text(json.dumps(source), encoding='utf-8')
                assets._build_political_chunk_payloads(
                    scenario_id='test', scenario_dir=scenario_dir,
                    startup_topology_payload={}, runtime_topology_payload={},
                    reusable_political_chunks=reusable)
            detail = json.loads((scenario_dir / 'chunks' / 'political.detail.country.can.json').read_text(encoding='utf-8'))
            north = detail['features'][0]
            self.assertEqual(_parallel(north, LONGITUDES[0], LONGITUDES[-1]),
                             [(x, LATITUDE) for x in LONGITUDES])


if __name__ == '__main__':
    unittest.main()
