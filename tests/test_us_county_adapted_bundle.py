"""Synthetic historical bundle tests; no retained source or canonical writes."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import subprocess
import unittest
from unittest.mock import patch

from shapely.geometry import box, mapping
from map_builder.regional_geometry import _encode_exact_coverage
from tools.adapt_us_county_scenarios import partition_feature
from tools import stage_us_county_adapted_bundle as bundle


class HistoricalBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(dir=bundle.ROOT / '.runtime')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sid = 'hoi4_1936'
        self.baseline = self.root / 'baseline'
        self.adaptation = self.root / 'adaptation'
        self.sidecars = self.root / 'sidecars'
        for path in (self.baseline, self.adaptation, self.sidecars):
            path.mkdir()
        self.output = self.root / 'candidate' / self.sid
        self.source = self.root / 'counties.geojson'
        self.topology = _encode_exact_coverage(['US_ZN_01_001', 'US_BAD', 'OTHER'], [box(0, 0, 2, 1), box(4, 0, 5, 1), box(7, 0, 8, 1)])
        for row in self.topology['objects']['political']['geometries']:
            row['properties'] = {'id': row['properties']['id'], 'name': 'Historical ' + row['properties']['id'], 'cntr_code': 'US' if row['properties']['id'].startswith('US') else 'CA'}
        self.assignments = {'owners': {'US_ZN_01_001': 'USA', 'US_BAD': 'USA', 'OTHER': 'CAN'},
                            'cores': {'US_ZN_01_001': ['USA', 'HIS'], 'US_BAD': [], 'OTHER': ['CAN']}, 'controllers': {}}
        props = self.topology['objects']['political']['geometries'][0]['properties']
        features, check = partition_feature(props, box(0, 0, 2, 1),
            {'US_CNTY_01001': box(0, 0, 1, 1), 'US_CNTY_01003': box(1, 0, 2, 1)}, self.assignments)
        self.overlay = {'type': 'FeatureCollection', 'features': features}
        self.report = {'scenario_id': self.sid, 'mode': 'unique_id_all_us_patch', 'replaced_old_ids': ['US_ZN_01_001'],
            'unresolved_ids_retained_in_baseline': ['US_BAD'], 'partition_checks': [check],
            'assignment_sidecar_present': {'owners': True, 'cores': True, 'controllers': False}}
        self.manifest = {'scenario_id': self.sid, 'generated_at': '2026-09-23T00:00:00Z',
            'baseline_hash': bundle.stable_json_hash(self.assignments['owners']),
            'runtime_topology_url': f'data/scenarios/{self.sid}/runtime_topology.topo.json',
            'summary': {}, 'source': {}, 'hierarchy_overrides': {'groups': {'US_test': ['US_ZN_01_001', 'US_BAD']},
                                                               'country_codes': ['US'], 'labels': {'US_test': 'Historical state'}}}
        bundle.write(self.baseline / 'manifest.json', self.manifest)
        bundle.write(self.baseline / 'runtime_topology.topo.json', self.topology)
        for key in ('owners', 'cores'):
            bundle.write(self.baseline / f'{key}.by_feature.json', {'baseline_hash': self.manifest['baseline_hash'], key: self.assignments[key]})
        bundle.write(self.baseline / 'countries.json', {'countries': {'USA': {'feature_count': 2}, 'CAN': {'feature_count': 1}}})
        bundle.write(self.source, {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'id': f'US_CNTY_{geoid}', 'GEOID': geoid, 'STATEFP': '01'}, 'geometry': mapping(geometry)}
            for geoid, geometry in [('01001', box(0, 0, 1, 1)), ('01003', box(1, 0, 2, 1))]]})
        bundle.write(self.source.with_name('source-report.json'), {'display_geojson_sha256': bundle.digest(self.source), 'states': [
            {'statefp': '01', 'source_geoids': ['01001', '01003'], 'display_geoids': ['01001', '01003'],
             'coverage_valid': True, 'geometry_invalid_count': 0}]})
        self.bind()

    def bind(self):
        self.report.update(source_sha256=bundle.digest(self.source), baseline_sha256=bundle.digest(self.baseline / 'runtime_topology.topo.json'))
        bundle.write(self.adaptation / 'county_overlay.geojson', self.overlay)
        bundle.write(self.adaptation / 'adaptation.report.json', self.report)
        for key in self.assignments:
            values = {f['properties']['id']: f['lineage']['assignments'][key] for f in self.overlay['features'] if key in f['lineage']['assignments']}
            bundle.write(self.adaptation / f'{key}.by_feature.json', {key: values})
        baseline_ids = [r['properties']['id'] for r in self.topology['objects']['political']['geometries']]
        crosswalk, geometries = bundle.build_crosswalk(baseline_ids, self.report['replaced_old_ids'], self.overlay['features'])
        bundle.write(self.sidecars / 'crosswalk.json', {'scenario_id': self.sid, 'old_to_new': crosswalk})
        assets = []
        for name in bundle.SIDECARS:
            if (self.baseline / name).exists():
                adapted, unresolved = bundle.adapt_asset(name, bundle.read(self.baseline / name), crosswalk, geometries)
                bundle.write(self.sidecars / name, adapted)
                assets.append({'file': name, 'input_sha256': bundle.digest(self.baseline / name), 'status': 'adapted', 'unresolved': unresolved})
        bundle.write(self.sidecars / 'sidecars.report.json', {'scenario_id': self.sid,
            'source_sha256': self.report['source_sha256'], 'baseline_sha256': self.report['baseline_sha256'],
            'overlay_sha256': bundle.digest(self.adaptation / 'county_overlay.geojson'),
            'adaptation_report_sha256': bundle.digest(self.adaptation / 'adaptation.report.json'),
            'sidecar_plan_passed': True, 'assets': assets})

    def stage(self):
        return bundle.stage(self.baseline, self.adaptation, self.sidecars, self.source, self.output)

    def test_failed_build_leaves_no_candidate(self):
        # All generation primitives are real; failure injection only exercises atomic publication.
        with patch.object(bundle, 'finalize_stage', side_effect=RuntimeError('injected finalizer failure')):
            with self.assertRaisesRegex(RuntimeError, 'injected finalizer'):
                self.stage()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.glob('.historical-county-*')), [])

    def test_namespaced_contract_with_real_javascript_importer(self):
        script = '''
import { readFileSync } from 'node:fs';
import { planProjectFeatureMigration } from './js/core/project_feature_migration.js';
const cases = JSON.parse(readFileSync(0, 'utf8'));
const results = cases.map(({ contract, entries, ids }) => planProjectFeatureMigration({
    scenario: { id: contract.scenario_id, baselineHash: contract.source_baseline_hash },
    sovereigntyByFeatureId: entries, visualOverrides: entries,
    customPresets: { test: [{ name: 'kept', ids: Object.keys(entries) }] },
}, { manifest: { scenario_id: contract.scenario_id, baseline_hash: contract.target_baseline_hash,
    project_feature_migration: contract }, validFeatureIds: new Set(ids) }));
process.stdout.write(JSON.stringify(results));
'''
        cases = []
        for sid, old, retained in [('hoi4_1936', 'US_ZN_01_001', 'US_CNTY_01003'),
                                    ('blank_base', 'US_CNTY_01001', 'US_ZN_01_003')]:
            children = [old + '__county_overlay_01001', old + '__county_overlay_residual']
            crosswalk = {old: children, retained: [retained], 'CAN-1': ['CAN-1']}
            contract = bundle.project_migration_contract(sid, crosswalk, 'source', 'target')
            self.assertLessEqual(len(contract['feature_id_prefixes']), 2)
            self.assertNotIn('CAN-1', contract['crosswalk'])
            self.assertEqual(contract['crosswalk'][retained], [retained])
            self.assertTrue(all(child.startswith(tuple(contract['feature_id_prefixes'])) for child in children))
            cases.append({'contract': contract, 'entries': {old: 'EDIT', retained: 'KEEP', 'CAN-1': 'OTHER'},
                          'ids': [*children, retained, 'CAN-1']})
        completed = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(cases),
            cwd=bundle.ROOT, text=True, capture_output=True, check=True)
        for case, result in zip(cases, json.loads(completed.stdout)):
            old, retained, _ = case['entries']
            children = case['contract']['crosswalk'][old]
            expected = {**{child: 'EDIT' for child in children}, retained: 'KEEP', 'CAN-1': 'OTHER'}
            self.assertNotIn('sovereigntyByFeatureId', result['data'])
            self.assertEqual(result['data']['visualOverrides'], expected)
            self.assertEqual(result['data']['customPresets']['test'][0]['ids'], [*children, retained, 'CAN-1'])


if __name__ == '__main__':
    unittest.main()
