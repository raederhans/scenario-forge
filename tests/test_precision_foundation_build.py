import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from tools.precision_build_support import assert_gzip_matches, cached_json_result, PhaseRecorder
from tools.precision_candidate_receipt import snapshot, gate_inventory, GATES


class PrecisionFoundationBuildTests(unittest.TestCase):
    def setUp(self):
        runtime_tmp = Path(__file__).resolve().parents[1] / '.runtime' / 'tmp'
        runtime_tmp.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime_tmp)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_streaming_gzip_checks_all_bytes_without_read_bytes(self):
        plain = self.root / 'a.json'; packed = self.root / 'a.json.gz'
        data = b'large geometry data\n' * 200000
        plain.write_bytes(data); packed.write_bytes(gzip.compress(data))
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('unbounded read')):
            assert_gzip_matches(packed, plain, block_bytes=4096)

    def test_streaming_gzip_rejects_length_content_and_crc_errors(self):
        plain = self.root / 'a'; packed = self.root / 'a.gz'
        plain.write_bytes(b'abcd')
        for data in (b'abc', b'abcde', b'abce'):
            packed.write_bytes(gzip.compress(data))
            with self.assertRaises(ValueError): assert_gzip_matches(packed, plain, block_bytes=2)
        data = bytearray(gzip.compress(b'abcd')); data[-8] ^= 1; packed.write_bytes(data)
        with self.assertRaises((OSError, EOFError)): assert_gzip_matches(packed, plain)

    def test_concatenated_gzip_members_are_compared(self):
        plain = self.root / 'a'; packed = self.root / 'a.gz'
        plain.write_bytes(b'abcd'); packed.write_bytes(gzip.compress(b'ab') + gzip.compress(b'cd'))
        assert_gzip_matches(packed, plain, block_bytes=3)

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

    def test_phase_recorder_labels_lifetime_peak_not_a_per_phase_peak(self):
        ticks = iter([1., 3., 7.]); recorder = PhaseRecorder(clock=lambda: next(ticks), process_peak=lambda: 100)
        recorder.checkpoint('parse'); recorder.checkpoint('build')
        self.assertEqual([p['elapsed_seconds'] for p in recorder.phases], [2., 4.])
        self.assertEqual(recorder.phases[1]['process_lifetime_peak_working_set_bytes'], 100)

    def test_candidate_snapshot_is_path_and_content_bound(self):
        (self.root / 'a').write_text('data')
        source = {'git_sha': 'a' * 40, 'git_tree': 'b' * 40}
        before = snapshot(self.root, source)
        self.assertEqual(before, snapshot(self.root, source))
        (self.root / 'a').rename(self.root / 'b')
        self.assertNotEqual(before['candidate_tree_sha256'], snapshot(self.root, source)['candidate_tree_sha256'])

    def test_empty_candidates_and_filesystem_links_are_rejected(self):
        with self.assertRaises(ValueError): snapshot(self.root, {})
        target = self.root / 'target'
        target.mkdir()
        (target / 'a').write_text('data')
        link = self.root / 'link'
        if os.name == 'nt':
            # Junctions exercise the real reparse-point guard without requiring
            # Windows' privileged symbolic-link creation permission.
            subprocess.run([
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                'New-Item -ItemType Junction -Path $env:TEST_LINK_PATH '
                '-Target $env:TEST_LINK_TARGET -ErrorAction Stop | Out-Null',
            ], env={**os.environ, 'TEST_LINK_PATH': str(link), 'TEST_LINK_TARGET': str(target)},
                check=True, capture_output=True)
            self.assertTrue(link.is_junction())
        else:
            link.symlink_to(target, target_is_directory=True)
            self.assertTrue(link.is_symlink())
        with self.assertRaises(ValueError): snapshot(self.root, {})

    def test_inventory_rejects_stale_source_candidate_missing_or_conflicting_gates(self):
        (self.root / 'a').write_text('data')
        current = snapshot(self.root, {'git_sha': 'a' * 40, 'git_tree': 'b' * 40})
        receipts = [{'schema_version': 1, 'gate': gate, 'source': current['source'],
                     'candidate_tree_sha256': current['candidate_tree_sha256'], 'status': 'passed', 'exit_code': 0, 'inputs_unchanged': True, 'command': ['reviewed-validator']} for gate in GATES]
        self.assertTrue(gate_inventory(current, receipts)['all_commands_passed'])
        self.assertFalse(gate_inventory(current, receipts)['release_ready'])
        self.assertFalse(gate_inventory(current, receipts[:-1])['all_commands_passed'])
        self.assertFalse(gate_inventory(current, receipts + [receipts[0]])['all_commands_passed'])
        receipts[0] = {**receipts[0], 'source': {'git_sha': 'stale'}}
        self.assertFalse(gate_inventory(current, receipts)['all_commands_passed'])
        self.assertEqual(len(gate_inventory(current, receipts)['rejected_receipts']), 1)

    def test_unavailable_memory_is_not_claimed_as_zero(self):
        recorder = PhaseRecorder(process_peak=lambda: None)
        recorder.checkpoint('linux')
        self.assertIsNone(recorder.phases[0]['process_lifetime_peak_working_set_bytes'])

    def test_execution_receipts_bind_real_command_mutation_failure_and_logs(self):
        import subprocess, sys
        from tools import precision_candidate_receipt as receipt
        root = self.root / 'repo'; root.mkdir()
        (root / '.gitignore').write_text('.runtime/\n')
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(root), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
        candidate = root / '.runtime/candidate'; candidate.mkdir(parents=True)
        (candidate / 'geometry.json').write_text('{}')
        out = root / '.runtime/receipts/pass.json'
        def execute(path, code):
            return receipt.main(['run', '--candidate-root', str(candidate), '--out', str(path), '--gate', 'strict', '--', sys.executable, '-c', code])
        with patch.object(receipt, 'ROOT', root):
            self.assertEqual(execute(out, "print('strict checked')"), 0)
            bound = json.loads(out.read_text()); self.assertEqual(bound['source'], receipt.source_identity(root))
            self.assertTrue(bound['inputs_unchanged'])
            with self.assertRaisesRegex(ValueError, 'exists'): execute(out, 'pass')
            failed = out.with_name('failure.json')
            self.assertEqual(execute(failed, 'raise SystemExit(3)'), 1)
            self.assertEqual(json.loads(failed.read_text())['exit_code'], 3)
            mutation = out.with_name('mutation.json')
            self.assertEqual(execute(mutation, "import os; from pathlib import Path; (Path(os.environ['SCENARIO_FORGE_CANDIDATE_ROOT']) / 'geometry.json').write_text('changed')"), 1)
            self.assertFalse(json.loads(mutation.read_text())['inputs_unchanged'])
            out.with_suffix('.stdout.log').write_text('tampered')
            with self.assertRaisesRegex(ValueError, 'changed receipt log'):
                receipt.main(['inventory', '--candidate-root', str(candidate), '--receipt', str(out), '--out', str(out.with_name('inventory.json'))])

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
