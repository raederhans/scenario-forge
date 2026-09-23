"""Synthetic historical bundle tests; no retained source or canonical writes."""
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import gzip
import subprocess
import unittest
from unittest.mock import patch

from shapely.geometry import box, mapping
from map_builder.regional_geometry import _encode_exact_coverage, _decode_geometry
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

    def test_preserves_untouched_geometry_properties_assignments_and_controller_absence(self):
        result, values, crosswalk, _ = bundle.assemble(self.topology, self.overlay, self.report, self.assignments)
        self.assertEqual(values['controllers'], {})
        for child in crosswalk['US_ZN_01_001']:
            self.assertEqual(values['owners'][child], 'USA')
            self.assertEqual(values['cores'][child], ['USA', 'HIS'])
        for old in self.topology['objects']['political']['geometries'][1:]:
            row = next(r for r in result['objects']['political']['geometries'] if r['properties']['id'] == old['properties']['id'])
            self.assertEqual(row, old)
            self.assertTrue(_decode_geometry(result, row).equals_exact(_decode_geometry(self.topology, old), 0))
        hierarchy = bundle.hierarchy_override(self.manifest['hierarchy_overrides'], crosswalk)
        self.assertEqual(hierarchy['groups']['US_test'], crosswalk['US_ZN_01_001'] + ['US_BAD'])

    def test_explicit_partial_controller_assignments_preserved(self):
        assignments = deepcopy(self.assignments)
        assignments['controllers'] = {'US_ZN_01_001': 'OCC'}
        overlay = deepcopy(self.overlay)
        for feature in overlay['features']:
            feature['lineage']['assignments']['controllers'] = 'OCC'
        _, values, crosswalk, _ = bundle.assemble(self.topology, overlay, self.report, assignments)
        self.assertEqual(values['controllers'], {child: 'OCC' for child in crosswalk['US_ZN_01_001']})

    def test_only_unchanged_inherited_tno_arctic_shell_may_lack_owner(self):
        fid = 'RU_ARCTIC_FB_ALT_001'
        baseline = _encode_exact_coverage([fid], [box(0, 0, 1, 1)])
        props = baseline['objects']['political']['geometries'][0]['properties']
        props.update(scenario_helper_kind='shell_fallback', scenario_shell_owner_hint='ALT',
                     scenario_shell_controller_hint='ALT')
        candidate = deepcopy(baseline)
        bundle.validate_political_ownership('tno_1962', baseline, candidate, {}, {}, {fid: [fid]})
        self.assertEqual(candidate, baseline)
        for kind in ('other_scenario', 'changed_hint', 'changed_arc', 'removed_owner', 'new_shell', 'missing_hint', 'numeric_shell'):
            test_baseline, test_candidate = deepcopy(baseline), deepcopy(candidate)
            original_owners, crosswalk, sid = {}, {fid: [fid]}, 'tno_1962'
            if kind == 'other_scenario':
                sid = 'hoi4_1936'
            elif kind == 'changed_hint':
                test_candidate['objects']['political']['geometries'][0]['properties']['scenario_shell_owner_hint'] = 'GER'
            elif kind == 'changed_arc':
                test_candidate['arcs'][0][0][0] += .01
            elif kind == 'removed_owner':
                original_owners[fid] = 'ALT'
            elif kind == 'new_shell':
                crosswalk = {}
            elif kind == 'missing_hint':
                for topology in (test_baseline, test_candidate):
                    topology['objects']['political']['geometries'][0]['properties'].pop('scenario_shell_controller_hint')
            else:
                for topology in (test_baseline, test_candidate):
                    topology['objects']['political']['geometries'][0]['properties']['id'] = 'RU_ARCTIC_FB_001'
                crosswalk = {'RU_ARCTIC_FB_001': ['RU_ARCTIC_FB_001']}
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'Missing political ownership'):
                bundle.validate_political_ownership(sid, test_baseline, test_candidate, original_owners, {}, crosswalk)

    def test_stale_and_malformed_evidence_never_publishes(self):
        path = self.adaptation / 'owners.by_feature.json'
        bundle.write(path, {'owners': {}})
        with self.assertRaisesRegex(ValueError, 'assignment sidecar mismatch'):
            self.stage()
        self.assertFalse(self.output.exists())
        self.bind()
        bundle.write(self.source, {'features': []})
        with self.assertRaisesRegex(ValueError, 'source report'):
            self.stage()
        self.assertFalse(self.output.exists())

    def test_unknown_refs_and_ambiguous_hosts_fail_closed(self):
        bundle.write(self.baseline / 'unknown.json', {'feature_id': 'US_ZN_01_001'})
        with self.assertRaisesRegex(ValueError, 'Unsupported replaced-feature'):
            self.stage()
        (self.baseline / 'unknown.json').unlink()
        bundle.write(self.baseline / 'capital_hints.json', {'capital': {'host_feature_id': 'US_ZN_01_001', 'lon': 1, 'lat': .5}})
        self.bind()
        with self.assertRaisesRegex(ValueError, 'Unresolved, stale or malformed'):
            self.stage()
        self.assertFalse(self.output.exists())

    def test_authoring_capital_hosts_and_inherited_label_reviews(self):
        _, _, crosswalk, geometries = bundle.assemble(self.topology, self.overlay, self.report, self.assignments)
        parent = 'US_ZN_01_001'
        original = {'capitals_by_tag': {'USA': 'CITY::example'},
                    'capital_city_hints': {'USA': {'host_feature_id': parent, 'lon': .5, 'lat': .5,
                                                   'display_name': 'Historical capital'}},
                    'audit': {'entry_count': 1}}
        adapted = bundle.adapt_authoring_asset('capital_defaults.partial.json', original, crosswalk, geometries)
        child = adapted['capital_city_hints']['USA']['host_feature_id']
        self.assertIn(child, crosswalk[parent])
        self.assertEqual(adapted['capitals_by_tag'], original['capitals_by_tag'])
        self.assertEqual(adapted['audit'], original['audit'])
        self.assertEqual(original['capital_city_hints']['USA']['host_feature_id'], parent)
        original['capital_city_hints']['USA']['lon'] = 1
        with self.assertRaisesRegex(ValueError, 'Unresolved capital defaults'):
            bundle.adapt_authoring_asset('capital_defaults.partial.json', original, crosswalk, geometries)
        reviewed = {'reviewed_collision_feature_ids': [parent, 'OTHER'], 'excluded_feature_prefixes': ['ATL_']}
        expected = {**reviewed, 'reviewed_collision_feature_ids': [*crosswalk[parent], 'OTHER']}
        self.assertEqual(bundle.adapt_authoring_asset('geo_locale_reviewed_exceptions.json', reviewed, crosswalk, geometries), expected)
        for name in ('unknown.json', 'unknown.geojson', 'city_assets.partial.json'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unsupported replaced-feature'):
                bundle.adapt_authoring_asset(name, {'unknown_reference': parent}, crosswalk, geometries)

    def test_tampered_properties_assignments_and_geometry_rejected(self):
        for field in ('properties', 'assignments', 'geometry'):
            overlay = deepcopy(self.overlay)
            child = overlay['features'][0]
            if field == 'properties':
                child['properties']['name'] = 'Modern rename'
            elif field == 'assignments':
                child['lineage']['assignments']['owners'] = 'WRONG'
            else:
                child['geometry'] = mapping(box(0, 0, .5, 1))
            with self.subTest(field=field), self.assertRaises(ValueError):
                bundle.assemble(self.topology, overlay, self.report, self.assignments)

    def test_full_synthetic_build_and_atomic_failure(self):
        # All generation primitives are real; failure injection only exercises atomic publication.
        with patch.object(bundle, 'finalize_stage', side_effect=RuntimeError('injected finalizer failure')):
            with self.assertRaisesRegex(RuntimeError, 'injected finalizer'):
                self.stage()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.glob('.historical-county-*')), [])
        with patch.object(bundle, 'finalize_stage', wraps=bundle.finalize_stage) as finalize:
            result = self.stage()
        finalize.assert_called_once()
        self.assertTrue(result['complete_runtime_bundle'])
        manifest = bundle.read(self.output / 'manifest.json')
        self.assertEqual(manifest['summary']['feature_count'], 4)
        self.assertNotIn('US_BAD', manifest['project_feature_migration']['crosswalk'])
        self.assertEqual(bundle.read(self.output / 'countries.json')['countries']['USA']['feature_count'], 3)
        self.assertFalse((self.output / 'controllers.by_feature.json').exists())
        for name in ('detail_chunks.manifest.json', 'runtime_topology.bootstrap.topo.json', 'locales.startup.json', 'geo_aliases.startup.json'):
            self.assertTrue((self.output / name).is_file(), name)
        self.assertEqual(bundle.read(self.output / 'owners.by_feature.json')['baseline_hash'], manifest['baseline_hash'])
        self.assertEqual(manifest['source']['us_county_source_report_sha256'], bundle.digest(self.source.with_name('source-report.json')))
        runtime = bundle.read(self.output / 'runtime_topology.topo.json')
        self.assertEqual(set(runtime['political_precision_feature_ids']), {f['properties']['id'] for f in self.overlay['features']})
        for name in ('startup.bundle.en.json', 'startup.bundle.zh.json', 'build_snapshot.json', 'audit.json'):
            self.assertTrue((self.output / name).exists())
        for language in ('en', 'zh'):
            startup = bundle.read(self.output / f'startup.bundle.{language}.json')
            self.assertEqual(startup['manifest_subset']['source'], manifest['source'])
            self.assertEqual(startup['manifest_subset']['hierarchy_overrides'], manifest['hierarchy_overrides'])
            for key, value in manifest['source'].items():
                self.assertEqual(startup['source'][key], value)
            self.assertEqual(startup['baseline_hash'], manifest['baseline_hash'])
        for path in self.output.rglob('*.json.gz'):
            self.assertEqual(gzip.decompress(path.read_bytes()), path.with_suffix('').read_bytes())

    def test_global_hierarchy_projects_known_members_and_preserves_other_countries(self):
        crosswalk = {'US_ZN_01_001': ['US_ZN_01_001__a', 'US_ZN_01_001__b'],
                     'US_CNTY_01003': ['US_CNTY_01003'], 'CAN-1': ['CAN-1']}
        global_hierarchy = {'groups': {'US_Alabama': ['US_ZN_01_001', 'US_CNTY_01003', 'missing-old-id'],
                                       'US_Absent': ['missing-id'], 'CA_Test': ['CAN-1']},
                            'labels': {'US_Alabama': 'Alabama', 'US_Absent': 'Absent', 'CA_Test': 'Canada'}}
        override = bundle.hierarchy_override({}, crosswalk, global_hierarchy)
        self.assertEqual(override, {'country_codes': ['US'],
            'groups': {'US_Alabama': ['US_ZN_01_001__a', 'US_ZN_01_001__b', 'US_CNTY_01003']},
            'labels': {'US_Alabama': 'Alabama'}})
        self.assertEqual(bundle.hierarchy_override({}, {'HGO-S1': ['HGO-S1__a']}, global_hierarchy), {})
        script = '''
import { readFileSync } from 'node:fs';
import { getEffectiveScenarioHierarchyFromInputs } from './js/core/scenario_hierarchy.js';
const { base, override } = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(getEffectiveScenarioHierarchyFromInputs(base, override)));
'''
        completed = subprocess.run(['node', '--input-type=module', '-e', script],
            input=json.dumps({'base': global_hierarchy, 'override': override}),
            cwd=bundle.ROOT, text=True, capture_output=True, check=True)
        effective = json.loads(completed.stdout)
        self.assertEqual(effective['groups']['CA_Test'], ['CAN-1'])
        self.assertEqual(effective['groups']['US_Alabama'], override['groups']['US_Alabama'])
        ambiguous = deepcopy(global_hierarchy)
        ambiguous['groups']['US_Other'] = ['US_ZN_01_001']
        with self.assertRaisesRegex(ValueError, 'Ambiguous global US hierarchy'):
            bundle.hierarchy_override({}, crosswalk, ambiguous)

    def test_output_must_be_new_and_exact_scenario_directory(self):
        self.output = self.output.with_name('wrong')
        with self.assertRaisesRegex(ValueError, 'exact supported scenario_id'):
            self.stage()

    def test_auxiliary_assignment_preserved_and_unknown_assignment_rejected(self):
        self.topology['objects']['scenario_atlantropa'] = {'type': 'GeometryCollection', 'geometries': [
            {'type': 'Point', 'coordinates': [10, 10], 'properties': {'id': 'ATL_AUX'}}]}
        self.assignments['owners']['ATL_AUX'] = 'CAN'
        bundle.write(self.baseline / 'runtime_topology.topo.json', self.topology)
        bundle.write(self.baseline / 'owners.by_feature.json', {'owners': self.assignments['owners']})
        self.bind()
        self.sid = 'hgo_1936'
        self.output = self.output.with_name(self.sid)
        self.manifest.update(scenario_id=self.sid, runtime_topology_url=f'data/scenarios/{self.sid}/runtime_topology.topo.json')
        self.report['scenario_id'] = self.sid
        # HGO has its own feature namespace; retain its historical properties.
        def hgo_ids(value):
            return json.loads(json.dumps(value).replace('US_ZN_01_001', 'HGO-S261'))
        self.topology, self.overlay, self.report, self.assignments, self.manifest = map(hgo_ids,
            (self.topology, self.overlay, self.report, self.assignments, self.manifest))
        bundle.write(self.baseline / 'runtime_topology.topo.json', self.topology)
        for key in ('owners', 'cores'):
            bundle.write(self.baseline / f'{key}.by_feature.json', {key: self.assignments[key]})
        bundle.write(self.baseline / 'manifest.json', self.manifest)
        self.bind()
        result = self.stage()
        self.assertFalse(result['chunked'])
        self.assertEqual(bundle.read(self.output / 'owners.by_feature.json')['owners']['ATL_AUX'], 'CAN')
        self.assertEqual(bundle.read(self.output / 'manifest.json')['summary']['feature_count'], 5)
        self.output = self.root / 'second' / self.sid
        self.assignments['owners']['UNKNOWN'] = 'CAN'
        bundle.write(self.baseline / 'owners.by_feature.json', {'owners': self.assignments['owners']})
        self.bind()
        with self.assertRaisesRegex(ValueError, 'auxiliary assignments'):
            self.stage()
        self.output = self.baseline
        with self.assertRaises(ValueError):
            self.stage()

    def test_blank_keeps_empty_assignments_and_inherited_unlabelled_properties(self):
        self.sid = 'blank_base'
        self.output = self.output.with_name(self.sid)
        self.manifest.update(scenario_id=self.sid, map_mode='blank', scenario_contract_profile='lightweight_base',
                             runtime_topology_url=f'data/scenarios/{self.sid}/runtime_topology.topo.json',
                             baseline_hash=bundle.stable_json_hash({}))
        self.report['scenario_id'] = self.sid
        self.assignments = {key: {} for key in self.assignments}
        for row in self.topology['objects']['political']['geometries']:
            row['properties'].pop('cntr_code', None)
        for feature in self.overlay['features']:
            feature['properties'].pop('cntr_code', None)
            feature['lineage']['assignments'] = {}
        bundle.write(self.baseline / 'manifest.json', self.manifest)
        bundle.write(self.baseline / 'runtime_topology.topo.json', self.topology)
        for key in ('owners', 'cores'):
            bundle.write(self.baseline / f'{key}.by_feature.json', {key: {}})
        self.bind()
        self.stage()
        manifest = bundle.read(self.output / 'manifest.json')
        self.assertNotEqual(manifest['baseline_hash'], self.manifest['baseline_hash'])
        for key in ('owners', 'cores'):
            self.assertEqual(bundle.read(self.output / f'{key}.by_feature.json')[key], {})
        for row in bundle.read(self.output / 'runtime_topology.topo.json')['objects']['political']['geometries']:
            self.assertNotIn('cntr_code', row['properties'])

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
                                    ('blank_base', 'US_CNTY_01001', 'US_ZN_01_003'),
                                    ('hgo_1936', 'HGO-S1', 'HGO-S12')]:
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
            self.assertEqual(result['data']['sovereigntyByFeatureId'], expected)
            self.assertEqual(result['data']['visualOverrides'], expected)
            self.assertEqual(result['data']['customPresets']['test'][0]['ids'], [*children, retained, 'CAN-1'])
        with self.assertRaisesRegex(ValueError, 'distinct baseline hashes'):
            bundle.project_migration_contract('blank_base', {}, 'same', 'same')
        with self.assertRaisesRegex(ValueError, 'outside reviewed namespace'):
            bundle.project_migration_contract('hoi4_1936', {'CAN-1': ['CAN-1__child']}, 'source', 'target')


if __name__ == '__main__':
    unittest.main()
