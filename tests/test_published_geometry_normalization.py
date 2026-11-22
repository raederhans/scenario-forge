import copy
import gzip
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from tools.published_geometry_normalization import normalize_published_geometry, round_water_geometry
from tools.runtime_json_packing import pack_published_runtime_data
from tools.scenario_chunk_format import decode_political_chunk, feature_collection_to_topology

ROOT = Path(__file__).resolve().parents[1]
MEASURE = """
const fs=require('fs'),vm=require('vm'),s=vm.createContext({});
for(const name of ['vendor/d3.v7.min.js','vendor/topojson-client.min.js','js/core/scenario_chunk_format_shared.js'])
  vm.runInContext(fs.readFileSync(name,'utf8'),s);
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const decode=p=>p.type==='Topology'?s.topojson.feature(p,p.objects.political):p;
const before=decode(input.before),after=decode(input.after);
const over=c=>c.features.filter(f=>s.d3.geoArea(f)>2*Math.PI).length;
const result={count:before.features.length,before:over(before),after:over(after)};
const orient=c=>s.__scenarioForgeScenarioChunkFormatShared.orientPoliticalFeatureCollection(c,s.d3.geoArea);
orient(before);orient(after);
result.invariant=before.features.every((f,i)=>JSON.stringify(f)===JSON.stringify(after.features[i]));
process.stdout.write(JSON.stringify(result));
"""


def measure(before, after):
    result = subprocess.run(['node', '-e', MEASURE], cwd=ROOT,
                            input=json.dumps({'before': before, 'after': after}),
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def collection():
    outer = [[0.123456789, 0], [4, 0], [4, 4], [0.123456789, 4], [0.123456789, 0]]
    hole = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]
    return {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'id': str(i), 'properties': {'number': 1.123456789},
         'geometry': {'type': 'Polygon', 'coordinates': rings}}
        for i, rings in enumerate([[outer], [outer, hole]])]}


class PublishedGeometryNormalizationTests(unittest.TestCase):
    def setUp(self):
        runtime = ROOT / '.runtime/tmp'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temporary.cleanup)
        self.app = Path(self.temporary.name)
        self.use_scenario('test')

    def use_scenario(self, name):
        self.scenario = self.app / 'data/scenarios' / name
        (self.scenario / 'chunks').mkdir(parents=True)

    def stage(self, payload, layer, name='sample.json', **metadata):
        path = self.scenario / 'chunks' / name
        path.write_text(json.dumps(payload), encoding='utf-8')
        manifest = self.scenario / 'detail_chunks.manifest.json'
        chunks = json.loads(manifest.read_bytes())['chunks'] if manifest.exists() else []
        chunks.append({'id': name, 'layer': layer, 'url': path.relative_to(self.app).as_posix(), **metadata})
        manifest.write_text(json.dumps({'chunks': chunks}), encoding='utf-8')
        return path

    def test_water_rounding_keeps_grid_bounds_and_leaves_other_layers_and_properties(self):
        payload = collection()
        payload['bbox'] = [0.123456789, -0.00000001, 4, 4]
        water = self.stage(payload, 'water', bounds=[0, 0, 4, 4], feature_bounds=[], coord_count=15, part_count=2)
        relief = self.stage(payload, 'relief', 'relief.json')
        exact = self.stage(payload, 'water', 'exact.json')
        political_payload = json.loads(json.dumps(payload))
        for feature in political_payload['features']:
            for ring in feature['geometry']['coordinates']:
                ring.reverse()
        political = self.stage(political_payload, 'political', 'political.json')
        untouched = {p: p.read_bytes() for p in [relief, exact, political]}
        normalize_published_geometry(self.app, byte_exact_paths=[exact])
        after = json.loads(water.read_bytes())
        self.assertEqual(after['bbox'], [0.123457, 0, 4, 4])
        self.assertNotIn('-0.0', water.read_text())
        self.assertEqual(after['features'][0]['geometry']['coordinates'][0][0], [0.123457, 0])
        self.assertEqual(after['features'][0]['properties'], payload['features'][0]['properties'])
        chunk = json.loads((self.scenario / 'detail_chunks.manifest.json').read_bytes())['chunks'][0]
        # 分片 bounds 是网格单元范围，取整后保持原值。
        self.assertEqual(chunk['bounds'], [0, 0, 4, 4])
        self.assertEqual(chunk['feature_bounds'], [[0.123457, 0, 4, 4]] * 2)
        self.assertEqual((chunk['coord_count'], chunk['part_count']), (15, 2))
        for path, raw in untouched.items():
            self.assertEqual(path.read_bytes(), raw)

    def test_water_topology_rounding_transform_skip_and_global_bounds(self):
        payload = feature_collection_to_topology(collection())
        original = copy.deepcopy(payload)
        round_water_geometry(payload)
        self.assertEqual(payload['arcs'][0][0], [0.123457, 0])
        self.assertEqual(payload['objects'], original['objects'])
        transformed = copy.deepcopy(original)
        transformed['transform'] = {'scale': [0.123456789, 1], 'translate': [0, 0]}
        saved = copy.deepcopy(transformed)
        round_water_geometry(transformed)
        self.assertEqual(transformed, saved)
        path = self.stage(original, 'water', bounds=[-180, -90, 180, 90], feature_bounds=[])
        normalize_published_geometry(self.app)
        metadata = json.loads((self.scenario / 'detail_chunks.manifest.json').read_bytes())['chunks'][0]
        self.assertEqual(metadata['bounds'], [-180, -90, 180, 90])
        self.assertEqual(metadata['feature_bounds'], [[0.123457, 0, 4, 4]] * 2)
        self.assertEqual(json.loads(path.read_bytes()), payload)

    def test_political_geojson_and_topology_runtime_invariant(self):
        for scenario in ['tno_1962', 'hoi4_1936', 'hoi4_1939']:
            self.use_scenario(scenario)
            before = collection()
            expected = copy.deepcopy(before)
            if scenario == 'tno_1962':
                for feature in expected['features']:
                    for point in feature['geometry']['coordinates'][0]:
                        point[0] = round(point[0], 5)
            coarse = self.stage(feature_collection_to_topology(before), 'political', 'coarse.json', lod='coarse')
            detail = self.stage(before, 'political', 'detail.json', lod='detail', feature_bounds=[], bounds=[0, 0, 5, 5])
            pack_published_runtime_data(self.app)
            for path in [coarse, detail]:
                after = json.loads(gzip.decompress(path.with_suffix('.json.gz').read_bytes()))
                self.assertEqual(measure(expected, after), {'count': 2, 'before': 2, 'after': 0, 'invariant': True})
                if path == coarse:
                    self.assertEqual(after['arcs'], feature_collection_to_topology(expected)['arcs'])
                    self.assertEqual(after['objects']['political']['geometries'][1]['arcs'], [[-2], [-3]])
                else:
                    self.assertTrue(all('sphericalArea' not in f for f in after['features']))
            if scenario == 'tno_1962':
                chunk = json.loads((self.scenario / 'detail_chunks.manifest.json').read_bytes())['chunks'][1]
                self.assertEqual(chunk['feature_bounds'], [[0.12346, 0, 4, 4]] * 2)
                self.assertEqual(chunk['bounds'], [0, 0, 5, 5])

    def test_point_protection_rescans_shared_vertices_and_retains_short_arcs(self):
        self.use_scenario('tno_1962')
        a, b, c = [0.0000011, 0], [0.0000022, 0.0000022], [0.0000033, 0]
        d, e = [1.12345678, 0], [1.12345789, 0]
        outline = [a, b, c, d, e, [1, 1], [0, 1], a]
        tiny = [b, [0.0000021, 0.0000023], [0.0000024, 0.0000024], b]
        collinear_after_rounding = [[2.0000001, 3], [3, 3.0000002], [4.0000001, 3], [2.0000001, 3]]
        detail_payload = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'id': str(i), 'properties': {},
             'geometry': {'type': 'Polygon', 'coordinates': [ring]}}
            for i, ring in enumerate([outline, tiny, collinear_after_rounding])]}
        topology = feature_collection_to_topology(detail_payload)
        topology['arcs'] = [outline[:4], [d, e], outline[4:]]
        topology['objects']['political']['geometries'] = topology['objects']['political']['geometries'][:1]
        topology['objects']['political']['geometries'][0]['arcs'] = [[0, 1, 2]]
        coarse = self.stage(topology, 'political', 'coarse.json', lod='coarse')
        detail = self.stage(detail_payload, 'political', 'detail.json', lod='detail')
        report = pack_published_runtime_data(self.app)['geometry_normalization'][-1]
        self.assertEqual((report['protected_points'], report['scans']), (8, 3))
        self.assertEqual(report['layers']['detail']['protected_rings'], 3)
        self.assertEqual(report['layers']['coarse']['protected_rings'], 1)
        after = json.loads(gzip.decompress(coarse.with_suffix('.json.gz').read_bytes()))
        self.assertEqual(after['arcs'][1], [[1.12346, 0]] * 2)
        features = json.loads(gzip.decompress(detail.with_suffix('.json.gz').read_bytes()))['features']
        self.assertEqual(decode_political_chunk(after)['features'][0]['geometry'], features[0]['geometry'])
        rings = [feature['geometry']['coordinates'][0] for feature in features]
        for actual, expected in zip(rings, [[a, b, c, [1.12346, 0], [1.12346, 0], [1, 1], [0, 1], a],
                                            tiny, collinear_after_rounding]):
            self.assertIn(actual, [expected, expected[::-1]])

    def test_nonzero_sliver_preserves_spherical_winding(self):
        self.use_scenario('tno_1962')
        ring = [[47.37199952749717, 42.61129861865701], [47.37121322804954, 42.609782090775376],
                [47.370196877982124, 42.60782186656386], [47.37199952749717, 42.61129861865701]]
        before = collection()
        before['features'] = before['features'][:1]
        before['features'][0]['geometry']['coordinates'] = [ring]
        naive = copy.deepcopy(before)
        naive['features'][0]['geometry']['coordinates'] = [[[round(v, 5) for v in point] for point in ring]]
        self.assertEqual(measure(before, naive)['after'], 1)
        path = self.stage(before, 'political', lod='detail')
        pack_published_runtime_data(self.app)
        after = json.loads(gzip.decompress(path.with_suffix('.json.gz').read_bytes()))
        self.assertEqual(measure(before, after), {'count': 1, 'before': 0, 'after': 0, 'invariant': True})

    def test_shared_edge_negative_indices_and_multiple_arcs(self):
        payload = {'type': 'Topology', 'arcs': [
            [[1, 1], [1, 0]], [[0, 0], [1, 0]],
            [[1, 1], [0, 1], [0, 0]], [[1, 1], [2, 1], [2, 0], [1, 0]]],
            'objects': {'political': {'type': 'GeometryCollection', 'geometries': [
                {'type': 'Polygon', 'arcs': [[1, -1, 2]]},
                {'type': 'Polygon', 'arcs': [[3, -1]]}]}}}
        path = self.stage(payload, 'political')
        report = normalize_published_geometry(self.app)
        after = json.loads(path.read_bytes())
        self.assertEqual(after['arcs'], payload['arcs'])
        geometries = after['objects']['political']['geometries']
        self.assertEqual(geometries[0]['arcs'], [[-3, 0, -2]])
        self.assertEqual(geometries[1], payload['objects']['political']['geometries'][1])
        self.assertEqual(report[0]['invariantFailures'], 0)
        self.assertEqual(measure(payload, after), {'count': 2, 'before': 1, 'after': 0, 'invariant': True})

    def test_reference_reversal_preserves_source_when_invariant_fails(self):
        payload = {'type': 'Topology', 'arcs': [
            [[0, 0], [1, 0]], [[1.1, 0], [1, 1], [0, 0]]],
            'objects': {'political': {'type': 'GeometryCollection', 'geometries': [
                {'type': 'Polygon', 'arcs': [[0, 1]]}]}}}
        path = self.stage(payload, 'political')
        original = path.read_bytes()
        report = normalize_published_geometry(self.app)
        self.assertEqual(report[0]['invariantFailures'], 1)
        self.assertEqual(path.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
