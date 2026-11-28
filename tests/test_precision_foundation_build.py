import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tools.precision_build_support import assert_gzip_matches, cached_json_result


class PrecisionFoundationBuildTests(unittest.TestCase):
    def setUp(self):
        runtime_tmp = Path(__file__).resolve().parents[1] / '.runtime' / 'tmp'
        runtime_tmp.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime_tmp)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_streaming_gzip_rejects_length_content_and_crc_errors(self):
        plain = self.root / 'a'; packed = self.root / 'a.gz'
        plain.write_bytes(b'abcd')
        for data in (b'abc', b'abcde', b'abce'):
            packed.write_bytes(gzip.compress(data))
            with self.assertRaises(ValueError): assert_gzip_matches(packed, plain, block_bytes=2)
        data = bytearray(gzip.compress(b'abcd')); data[-8] ^= 1; packed.write_bytes(data)
        with self.assertRaises((OSError, EOFError)): assert_gzip_matches(packed, plain)

    def test_content_cache_reuses_only_verified_matching_outputs(self):
        calls = []
        def build(): calls.append(1); return {'neighbors': [[1], [0]]}
        def validate(value):
            if value != {'neighbors': [[1], [0]]}: raise ValueError('bad graph')
        inputs = {'geometry': 'hash', 'algorithm': 1}
        _, first = cached_json_result(self.root, inputs, build, validate)
        _, second = cached_json_result(self.root, inputs, build, validate)
        self.assertFalse(first['hit']); self.assertTrue(second['hit']); self.assertEqual(len(calls), 1)
        (self.root / (first['key'] + '.json')).write_text('{broken')
        _, third = cached_json_result(self.root, inputs, build, validate)
        self.assertFalse(third['hit']); self.assertEqual(len(calls), 2)
        _, changed = cached_json_result(self.root, {**inputs, 'algorithm': 2}, build, validate)
        self.assertFalse(changed['hit'])

    def test_real_adjacency_cache_reuses_geometry_unchanged_and_rejects_corruption(self):
        from copy import deepcopy
        from shapely.geometry import box
        from map_builder.regional_geometry import _encode_exact_coverage
        from tools import stage_us_county_adapted_bundle as bundle
        from tools.precision_build_support import hash_json
        bundle.ROOT.joinpath('.runtime/tmp').mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=bundle.ROOT / '.runtime/tmp') as directory:
            topology = _encode_exact_coverage(['a', 'b'], [box(0, 0, 1, 1), box(1, 0, 2, 1)])
            before = deepcopy(topology)
            cache = Path(directory) / 'cache'
            graph, diagnostics, first = bundle.cached_neighbor_graph(topology, {'a', 'b'}, cache)
            self.assertEqual(graph, [[1], [0]])
            self.assertEqual(topology, before)
            with patch.object(bundle, 'neighbor_frame', side_effect=AssertionError('decoded again')):
                same, _, second = bundle.cached_neighbor_graph(topology, {'a', 'b'}, cache)
            self.assertEqual(same, graph); self.assertTrue(second['hit']); self.assertFalse(first['hit'])
            path = cache / (first['key'] + '.json')
            record = json.loads(path.read_text())
            record['value']['graph'] = [[1], []]
            record['value_sha256'] = hash_json(record['value'])
            path.write_text(json.dumps(record))
            repaired, _, third = bundle.cached_neighbor_graph(topology, {'a', 'b'}, cache)
            self.assertFalse(third['hit']); self.assertEqual(repaired, graph)
            changed = _encode_exact_coverage(['a', 'b'], [box(0, 0, 1, 1), box(3, 0, 4, 1)])
            next_graph, _, fourth = bundle.cached_neighbor_graph(changed, {'a', 'b'}, cache)
            self.assertFalse(fourth['hit']); self.assertEqual(next_graph, [[], []])
            _, _, fifth = bundle.cached_neighbor_graph(topology, {'a'}, cache)
            self.assertFalse(fifth['hit'], 'retained invalid-geometry policy is part of the key')

if __name__ == '__main__': unittest.main()
