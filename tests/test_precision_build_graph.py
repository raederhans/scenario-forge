import json
from pathlib import Path
import tempfile
import unittest

from tools.precision_build_graph import BuildGraph, BuildStage


class BuildGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.txt'
        self.source.write_text('source', encoding='utf-8')
        self.algorithm = self.root / 'algorithm.py'
        self.algorithm.write_text('version one', encoding='utf-8')
        self.graph = BuildGraph(self.root / 'cache')

    def stage(self, name, *, toolchain=None, build=None):
        def default_build(output, deps):
            (output / 'value.json').write_text(json.dumps({'source': self.source.read_text()}), encoding='utf-8')

        def validate(output):
            if not isinstance(json.loads((output / 'value.json').read_text()), dict):
                raise ValueError('Expected object')
        return BuildStage(name, build or default_build, validate,
                          {'source': self.source}, {}, {'algorithm': self.algorithm},
                          toolchain or {'python': 'test-toolchain'})

    def test_input_algorithm_and_toolchain_invalidate(self):
        stage = self.stage('geometry')
        first = self.graph.run([stage])['geometry']
        self.source.write_text('new')
        second = self.graph.run([stage])['geometry']
        self.algorithm.write_text('version two')
        third = self.graph.run([stage])['geometry']
        fourth = self.graph.run([self.stage('geometry', toolchain={'python': 'other'})])['geometry']
        self.assertEqual(len({r.key for r in [first, second, third, fourth]}), 4)

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


if __name__ == '__main__': unittest.main()
