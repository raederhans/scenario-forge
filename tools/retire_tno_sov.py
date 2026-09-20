"""Stage the reviewed default-SOV retirement without changing map geometry."""
from __future__ import annotations
import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.prepare_tno_russia_precision import read, safe_output
from map_builder.io.writers import write_json_atomic
from tools.regional_scenario_assets import build_regional_scenario_assets
from tools.build_tno_russia_precision_assets import finalize_stage
from tools.patch_tno_1962_bundle import (
    apply_sov_residual_rules, prune_cores_to_registered_country_tags,
    recalculate_country_feature_counts, rebuild_tno_featured_tags, retire_sov_helper_properties, stable_json_hash,
)


def stage(baseline, output):
    baseline = Path(baseline).resolve()
    output = safe_output(output, [baseline])
    rule = read(ROOT / 'data/scenario-rules/tno_1962.sov_residuals.manual.json')
    countries = read(baseline / 'countries.json')
    owners = read(baseline / 'owners.by_feature.json')
    controllers = {'controllers': dict(owners['owners'])}
    cores = read(baseline / 'cores.by_feature.json')
    old_owners, old_cores = dict(owners['owners']), dict(cores['cores'])
    changed = apply_sov_residual_rules(rule, countries, owners, controllers, cores)
    prune = prune_cores_to_registered_country_tags(cores, countries, owners)
    inputs = output.parent / (output.name + '.inputs')
    if inputs.exists(): raise ValueError('Input staging directory exists')
    inputs.mkdir(parents=True)
    owner_path = inputs / 'owners.by_feature.json'
    write_json_atomic(owner_path, owners, indent=2)
    runtime = read(baseline / 'runtime_topology.topo.json')
    helper_ids = []
    for feature in runtime['objects']['political']['geometries']:
        if retire_sov_helper_properties(feature['properties'], rule):
            helper_ids.append(feature['properties']['id'])
    runtime_path = inputs / 'runtime_topology.topo.json'
    write_json_atomic(runtime_path, runtime, indent=None, separators=(',', ':'))
    print('Build owner chunks', flush=True)
    rebuild = build_regional_scenario_assets(baseline_dir=baseline,
        candidate_runtime_path=runtime_path, candidate_owners_path=owner_path,
        output_dir=output)
    manifest, audit = read(output / 'manifest.json'), read(output / 'audit.json')
    recalculate_country_feature_counts(countries, owners, audit, manifest)
    rebuild_tno_featured_tags(manifest, countries)
    manifest['baseline_hash'] = stable_json_hash(owners['owners'])
    for name, payload in [('owners.by_feature.json', owners), ('cores.by_feature.json', cores),
                          ('countries.json', countries), ('manifest.json', manifest), ('audit.json', audit)]:
        write_json_atomic(output / name, payload, indent=2)
    if (output / 'controllers.by_feature.json').exists():
        write_json_atomic(output / 'controllers.by_feature.json', controllers, indent=2)
    # Preserve all unrelated authoring fields and assignments, removing only SOV core references.
    for name, key in [('scenario_manual_overrides.json', 'assignments'),
                      ('scenario_mutations.json', 'assignments_by_feature_id')]:
        payload = read(output / name)
        for fid, assignment in payload.get(key, {}).items():
            if 'SOV' in assignment.get('cores', []):
                assignment['cores'] = [tag for tag in assignment['cores'] if tag != 'SOV'] or [owners['owners'][fid]]
        write_json_atomic(output / name, payload, indent=2)
    cities = read(output / 'city_overrides.json')
    for key in ('capitals_by_tag', 'capital_city_hints'):
        cities.get(key, {}).pop('SOV', None)
    write_json_atomic(output / 'city_overrides.json', cities, indent=2)
    print('Bind startup and scenario contracts', flush=True)
    fixes = finalize_stage(output)
    assert {i for i in owners['owners'] if owners['owners'][i] != old_owners[i]} == set(changed)
    assert not any(tag == 'SOV' for tag in owners['owners'].values())
    assert not any('SOV' in tags for tags in cores['cores'].values())
    report = {'changed_owner_ids': changed, 'changed_core_count': sum(cores['cores'][i] != old_cores[i] for i in old_cores),
              'core_prune': prune, 'rebuild': rebuild, 'safe_fixes': fixes,
              'changed_helper_ids': helper_ids, 'geometry_changed': False, 'production_applied': False}
    write_json_atomic(output.parent / (output.name + '.retirement-report.json'), report, indent=2)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline-dir', required=True, type=Path)
    p.add_argument('--output-dir', required=True, type=Path)
    a = p.parse_args()
    result = stage(a.baseline_dir, a.output_dir)
    print({k:v for k,v in result.items() if k not in {'rebuild','safe_fixes'}})
