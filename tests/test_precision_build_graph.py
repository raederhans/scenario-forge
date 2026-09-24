import json
from pathlib import Path
import tempfile
import unittest

from tools.precision_build_graph import BuildGraph, BuildStage, file_inventory


class BuildGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.txt'
        self.source.write_text('source', encoding='utf-8')
        self.algorithm = self.root / 'algorithm.py'
        self.algorithm.write_text('version one', encoding='utf-8')
        self.calls = []
        self.graph = BuildGraph(self.root / 'cache')

    def stage(self, name, *, dependencies=(), parameters=None, toolchain=None, build=None, inputs=None):
        def default_build(output, deps):
            self.calls.append(name)
            (output / 'value.json').write_text(json.dumps({
                'source': self.source.read_text(),
                'dependencies': {key: json.loads((path / 'value.json').read_text()) for key, path in deps.items()},
                'parameters': parameters or {},
            }), encoding='utf-8')
        def validate(output):
            if not isinstance(json.loads((output / 'value.json').read_text()), dict):
                raise ValueError('Expected object')
        return BuildStage(name, build or default_build, validate,
                          {'source': self.source} if inputs is None else inputs,
                          parameters or {}, {'algorithm': self.algorithm},
                          toolchain or {'python': 'test-toolchain'}, dependencies)

    def test_dependency_order_and_warm_reuse(self):
        stages = [self.stage('assembly', dependencies=('lod',)), self.stage('lod', dependencies=('geometry',)), self.stage('geometry')]
        first = self.graph.run(stages)
        self.assertEqual(self.calls, ['geometry', 'lod', 'assembly'])
        second = self.graph.run(stages)
        self.assertEqual(self.calls, ['geometry', 'lod', 'assembly'])
        self.assertTrue(all(value.cache_hit for value in second.values()))
        self.assertEqual(first['assembly'].output_sha256, second['assembly'].output_sha256)

    def test_parameters_invalidate_only_dependent_branch(self):
        self.graph.run([self.stage('geometry'), self.stage('lod', dependencies=('geometry',)), self.stage('sidecar')])
        result = self.graph.run([self.stage('geometry'), self.stage('lod', dependencies=('geometry',), parameters={'tolerance': 1}), self.stage('sidecar')])
        self.assertTrue(result['geometry'].cache_hit)
        self.assertFalse(result['lod'].cache_hit)
        self.assertTrue(result['sidecar'].cache_hit)

    def test_input_algorithm_and_toolchain_invalidate(self):
        stage = self.stage('geometry')
        first = self.graph.run([stage])['geometry']
        self.source.write_text('new')
        second = self.graph.run([stage])['geometry']
        self.algorithm.write_text('version two')
        third = self.graph.run([stage])['geometry']
        fourth = self.graph.run([self.stage('geometry', toolchain={'python': 'other'})])['geometry']
        self.assertEqual(len({r.key for r in [first, second, third, fourth]}), 4)

    def test_missing_input_does_not_reuse_previous_success(self):
        self.graph.run([self.stage('geometry')])
        self.source.unlink()
        with self.assertRaises(ValueError): self.graph.run([self.stage('geometry')])

    def test_corrupt_output_and_envelope_are_rebuilt(self):
        stage = self.stage('geometry')
        result = self.graph.run([stage])['geometry']
        (result.output_root / 'value.json').write_text('{}')
        rebuilt = self.graph.run([stage])['geometry']
        self.assertFalse(rebuilt.cache_hit)
        self.assertTrue(rebuilt.invalidation_reason.startswith('rejected-cache:'))
        (rebuilt.output_root.parent / 'receipt.json').write_text('{}')
        self.assertFalse(self.graph.run([stage])['geometry'].cache_hit)
        self.assertEqual(len(list((self.root / 'cache/geometry').glob('*.rejected-*'))), 2)

    def test_empty_invalid_or_failed_stage_never_published(self):
        for mode in ['empty', 'invalid', 'failure']:
            def build(output, deps):
                if mode == 'failure': raise RuntimeError('stage failed')
                if mode == 'invalid': (output / 'value.json').write_text('[]')
            with self.assertRaises((ValueError, OSError, RuntimeError)):
                self.graph.run([self.stage(mode, build=build)])
            self.assertFalse(list((self.root / 'cache' / mode).glob('*/receipt.json')))

    def test_input_change_during_build_is_rejected(self):
        def build(output, deps):
            (output / 'value.json').write_text('{}')
            self.source.write_text('mutated')
        with self.assertRaisesRegex(ValueError, 'Inputs changed during build'):
            self.graph.run([self.stage('geometry', build=build)])

    def test_dependency_mutation_is_rejected(self):
        def build(output, deps):
            (deps['geometry'] / 'value.json').write_text('{}')
            (output / 'value.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'dependency mutated'):
            self.graph.run([self.stage('geometry'), self.stage('lod', dependencies=('geometry',), build=build)])

    def test_missing_later_input_fails_before_any_stage(self):
        with self.assertRaises(ValueError):
            self.graph.run([self.stage('first'), self.stage('second', inputs={'missing': self.root / 'absent'})])
        self.assertEqual(self.calls, [])

    def test_graph_errors_fail_before_work(self):
        for stages in [[self.stage('bad/name')], [self.stage('a'), self.stage('a')],
                       [self.stage('a', dependencies=('missing',))],
                       [self.stage('a', dependencies=('b',)), self.stage('b', dependencies=('a',))]]:
            with self.assertRaises(ValueError): self.graph.run(stages)
        self.assertEqual(self.calls, [])

    def test_symlink_input_and_output_rejected(self):
        link = self.root / 'link.txt'
        try: link.symlink_to(self.source)
        except OSError: self.skipTest('Platform cannot create a symlink')
        with self.assertRaises(ValueError): self.graph.run([self.stage('input', inputs={'source': link})])
        def build(output, deps): (output / 'value.json').symlink_to(self.source)
        with self.assertRaises(ValueError): self.graph.run([self.stage('output', build=build)])

    def test_output_files_added_after_build_invalidate(self):
        stage = self.stage('geometry')
        result = self.graph.run([stage])['geometry']
        (result.output_root / 'extra.json').write_text('{}')
        self.assertFalse(self.graph.run([stage])['geometry'].cache_hit)


if __name__ == '__main__': unittest.main()
