import itertools
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

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
    def test_topology_normalizer_preserves_neighbors(self):
        from copy import deepcopy
        from map_builder.regional_geometry import _encode_exact_coverage

        source = _fixture()
        ids = [f['properties']['id'] for f in source['features']]
        topology = _encode_exact_coverage(ids, [shape(f['geometry']) for f in source['features']])
        topology['neighbors'] = [[1], [0]]
        before = deepcopy(topology)
        normalized = assets.normalize_canada_topology(topology)
        self.assertEqual(topology, before)
        self.assertEqual(assets.normalize_canada_topology(normalized), normalized)
        self.assertEqual(normalized['neighbors'], before['neighbors'])

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
