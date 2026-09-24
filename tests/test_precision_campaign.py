import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools import precision_candidate_receipt as receipts
from tools import precision_campaign as campaign
from tools.precision_build_support import hash_json, sha256_file, write_json_atomic
from tools.precision_comparison import sample_plan, summarize, validate_axes, validate_sample


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / '.runtime/candidate').mkdir(parents=True)
        (self.root / 'input.json').write_text('{}')
        (self.root / '.runtime/candidate/manifest.json').write_text('{"scenario_id":"modern_world"}')
        self.source = {'git_sha': 'a' * 40, 'git_tree': 'b' * 40}
        self.target = {'id': 'us-modern', 'countries': ['US'], 'scenario_id': 'modern_world',
                       'kind': 'precision-candidate', 'declared_stage': 'complete-bundle',
                       'candidate_root': '.runtime/candidate', 'parameters': {'lod': 1}, 'sources': [
                           {'id': 'fixture', 'version': '1', 'uri': 'https://example.test/source',
                            'license': 'test-only', 'license_uri': 'https://example.test/license',
                            'files': [{'path': 'input.json', 'sha256': sha256_file(self.root / 'input.json')}]}]}
        self.document = {'schema_version': 1, 'targets': [self.target]}

    def bind(self):
        return campaign.target_binding(self.target, self.source, root=self.root)

    def test_missing_candidates_are_not_green(self):
        self.target['candidate_root'] = '.runtime/missing'
        report = campaign.inventory(self.document, self.source, root=self.root)
        row = report['targets'][0]
        self.assertEqual(row['state'], 'missing-or-invalid-inputs')
        self.assertEqual(set(row['gates'].values()), {'not-run'})
        self.assertFalse(row['release_ready'])
        self.assertFalse(row['published'])

    def test_country_scenario_index_and_distinct_stage(self):
        report = campaign.inventory(self.document, self.source, root=self.root)
        self.assertEqual(report['by_country_scenario'], {'US/modern_world': ['us-modern']})
        row = report['targets'][0]
        self.assertEqual(row['declared_stage'], 'complete-bundle')
        self.assertEqual(row['reviewed_acceptance'], 'not-established')
        self.assertFalse(row['all_commands_passed'])

    def test_no_provenance_is_not_source_prepared(self):
        self.target['sources'] = []
        report = campaign.inventory(self.document, self.source, root=self.root)
        self.assertIn('missing-source-provenance', report['targets'][0]['blockers'])

    def test_parameter_and_source_changes_invalidate_binding(self):
        first = self.bind()['binding_sha256']
        self.target['parameters']['lod'] = 2
        self.assertNotEqual(first, self.bind()['binding_sha256'])
        (self.root / 'input.json').write_text('{"changed":true}')
        with self.assertRaisesRegex(ValueError, 'Source digest'):
            self.bind()

    def test_wrong_scenario_manifest_fails(self):
        (self.root / '.runtime/candidate/manifest.json').write_text('{"scenario_id":"tno_1962"}')
        with self.assertRaisesRegex(ValueError, 'scenario identity'):
            self.bind()

    def test_incomplete_bundle_and_license(self):
        (self.root / '.runtime/candidate/manifest.json').unlink()
        (self.root / '.runtime/candidate/a').write_text('x')
        with self.assertRaisesRegex(ValueError, 'lacks manifest'):
            self.bind()
        self.target['declared_stage'] = 'partial-geometry'
        self.bind()
        self.target['sources'][0]['license'] = ''
        with self.assertRaisesRegex(ValueError, 'license'):
            self.bind()

    def test_reference_is_never_precision_acceptance(self):
        for kind in ('canonical-reference', 'synthetic-fixture'):
            self.target['kind'] = kind
            row = campaign.inventory(self.document, self.source, root=self.root)['targets'][0]
            self.assertFalse(row['release_ready'])
            self.assertIn('reference-or-fixture-does-not-validate-precision-candidate', row['blockers'])

    def test_reject_path_escape(self):
        with self.assertRaises(ValueError):
            campaign.repo_file('../outside', self.root)

    def test_bound_receipt_and_tampered_logs(self):
        current = self.bind()
        folder = self.root / '.runtime/evidence';folder.mkdir()
        for name in ('stdout', 'stderr'):
            (folder / f'{name}.log').write_text('')
        receipt = {'schema_version': 1, 'gate': 'strict', 'source': self.source,
                   'candidate_tree_sha256': current['snapshot']['candidate_tree_sha256'], 'command': ['test'],
                   'status': 'passed', 'exit_code': 0, 'inputs_unchanged': True,
                   'logs': {name: {'file': f'{name}.log', 'sha256': sha256_file(folder / f'{name}.log')} for name in ('stdout', 'stderr')}}
        write_json_atomic(folder / 'command.json', receipt)
        envelope = {'schema_version': 1, 'binding': current['binding'], 'binding_sha256': current['binding_sha256'],
                    'inputs_unchanged': True, 'receipt_file': 'command.json', 'receipt_sha256': sha256_file(folder / 'command.json')}
        write_json_atomic(folder / 'gate.json', envelope)
        self.target['receipts'] = ['.runtime/evidence/gate.json']
        row = campaign.inventory(self.document, self.source, root=self.root)['targets'][0]
        self.assertEqual(row['gates']['strict'], 'passed')
        self.assertFalse(row['release_ready'])
        self.target['receipts'].append('.runtime/evidence/gate.json')
        self.assertEqual(campaign.inventory(self.document, self.source, root=self.root)['targets'][0]['gates']['strict'], 'conflicting-evidence')
        (folder / 'stdout.log').write_text('tamper')
        row = campaign.inventory(self.document, self.source, root=self.root)['targets'][0]
        self.assertEqual(row['state'], 'invalid-evidence')
        self.assertEqual(row['gates']['strict'], 'not-run')

    def test_duplicate_target_ids_rejected(self):
        self.document['targets'].append(copy.deepcopy(self.target))
        path = self.root / 'campaign.json';write_json_atomic(path, self.document)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            campaign.load_campaign(path)

    def test_real_command_exit_is_retained(self):
        (self.root / '.gitignore').write_text('.runtime/\n')
        for command in (['git', 'init', '-q'], ['git', 'add', '.'], ['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']):
            subprocess.run(command, cwd=self.root, check=True)
        with patch.object(receipts, 'ROOT', self.root):
            code = campaign.run_gate(self.document, 'us-modern', 'strict', Path('.runtime/evidence/failed.json'),
                                     [sys.executable, '-c', 'raise SystemExit(7)'], root=self.root)
        self.assertEqual(code, 1)
        envelope = json.loads((self.root / '.runtime/evidence/failed.json').read_text())
        value = receipts.read_verified_receipt(self.root / '.runtime/evidence' / envelope['receipt_file'])
        self.assertEqual(value['exit_code'], 7)
        self.assertEqual(value['status'], 'failed')


class ComparisonTests(unittest.TestCase):
    def test_modes_enforce_single_variable(self):
        a = {'source': {'git_tree': 'a'}, 'candidate_tree_sha256': 'x'}
        b = {'source': {'git_tree': 'b'}, 'candidate_tree_sha256': 'x'}
        validate_axes('fixed-data', a, b)
        with self.assertRaises(ValueError): validate_axes('fixed-code', a, b)
        b['source'] = a['source'];b['candidate_tree_sha256'] = 'y'
        validate_axes('fixed-code', a, b)
        with self.assertRaises(ValueError): validate_axes('fixed-data', a, b)

    def test_counterbalance_and_no_sample_retries(self):
        plan = sample_plan(2, 5)
        self.assertEqual(len(plan), 14)
        self.assertEqual([x['side'] for x in plan[:4]], ['left', 'right', 'right', 'left'])
        self.assertEqual(len({x['id'] for x in plan}), len(plan))

    def test_freshness_and_assertions(self):
        sample = {'schema_version': 1, 'sample_id': 'new', 'candidate_tree_sha256': 'x', 'scenario_id': 'modern_world',
                  'assertions_passed': True, 'environment': {'dpr': 1}, 'metrics': {'fill': 10}}
        validate_sample(sample, sample_id='new', candidate_hash='x', scenario='modern_world')
        for key, value in [('sample_id', 'old'), ('assertions_passed', False), ('metrics', {'fill': float('nan')})]:
            with self.assertRaises(ValueError):
                validate_sample({**sample, key: value}, sample_id='new', candidate_hash='x', scenario='modern_world')

    def test_environment_changes_and_incomplete_pairs_rejected(self):
        rows = [{'phase': 'measured', 'side': side, 'measurement': {'environment': {'dpr': 1}, 'metrics': {'fill': value}}}
                for side, value in [('left', 10), ('right', 8)]]
        self.assertEqual(summarize(rows)['fill']['right_over_left'], .8)
        with self.assertRaises(ValueError): summarize(rows[:1])
        rows[1]['measurement']['environment']['dpr'] = 2
        with self.assertRaises(ValueError): summarize(rows)


class ComparisonExecutionTests(unittest.TestCase):
    def test_real_counterbalanced_runner_uses_receipts_and_stops_on_failure(self):
        import shutil
        from tools.precision_comparison import run
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tools').mkdir()
            (root / '.runtime/candidate').mkdir(parents=True)
            (root / '.runtime/candidate/data.json').write_text('{}')
            source = Path(receipts.__file__).resolve().parents[1]
            for name in ('precision_candidate_receipt.py', 'precision_build_support.py', 'pages_artifact_root.py'):
                shutil.copyfile(source / 'tools' / name, root / 'tools' / name)
            harness = root / 'probe.py'
            harness.write_text("import json,os,sys\nfrom pathlib import Path\nsource,candidate,out,key=sys.argv[1:]\nassert Path(source).is_dir() and Path(candidate).is_dir()\nPath(out).write_text(json.dumps({'schema_version':1,'sample_id':key,'scenario_id':'modern_world','candidate_tree_sha256':os.environ['SCENARIO_FORGE_CANDIDATE_TREE_SHA256'],'assertions_passed':True,'environment':{'fixture':'synthetic'},'metrics':{'fill_ms':1}}))\n")
            (root / '.gitignore').write_text('.runtime/\n__pycache__/\n')
            for argv in (['git','init','-q'], ['git','add','.'], ['git','-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture']):
                subprocess.run(argv, cwd=root, check=True)
            variant = {'source_root':str(root),'candidate_root':'.runtime/candidate'}
            definition = {'schema_version':1,'evidence_kind':'synthetic-fixture','mode':'fixed-data','left':variant,'right':variant,
                'scenario_id':'modern_world','warmups':0,'runs':1,'harness_files':[str(harness)],
                'command':[sys.executable,str(harness),'{source_root}','{candidate_root}','{sample_out}','{sample_id}']}
            report = run(definition, Path('.runtime/comparison/success'), root=root)
            self.assertEqual(report['status'],'completed-diagnostic',report)
            self.assertEqual(len(report['samples']),2)
            self.assertFalse(report['performance_accepted'])
            definition['command'] = [sys.executable,'-c','raise SystemExit(9)','{source_root}','{candidate_root}','{sample_out}','{sample_id}']
            failed = run(definition, Path('.runtime/comparison/failure'), root=root)
            self.assertEqual(failed['status'],'failed')
            self.assertEqual(len(failed['samples']),1)
            self.assertNotIn('summary',failed)


if __name__ == '__main__':
    unittest.main()
