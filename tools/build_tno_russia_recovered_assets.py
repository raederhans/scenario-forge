"""Stage national Russian geometry plus audited missing-ID assignments."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from map_builder.io.writers import write_json_atomic
from tools.prepare_tno_russia_precision import read, safe_output, digest
from tools.regional_scenario_assets import build_regional_scenario_assets
from tools.build_tno_russia_precision_assets import finalize_stage, peak_memory, sizes
from tools.patch_tno_1962_bundle import recalculate_country_feature_counts, stable_json_hash


def build(baseline_dir, recovery_dir, output_dir):
    baseline, recovery = Path(baseline_dir), Path(recovery_dir)
    output = safe_output(output_dir, [baseline, recovery])
    report = read(recovery / 'report.json')
    assignments = report['assignments']
    owners = read(baseline / 'owners.by_feature.json')
    controllers_path = baseline / 'controllers.by_feature.json'
    controllers = read(controllers_path) if controllers_path.exists() else None
    cores = read(baseline / 'cores.by_feature.json')
    countries = read(baseline / 'countries.json')
    if set(assignments) != set(report['added_ids']):
        raise ValueError('Recovery assignments do not match added IDs')
    for fid, tag in assignments.items():
        if fid in owners['owners'] or fid in cores['cores'] or tag not in countries['countries'] or tag == 'SOV':
            raise ValueError(f'Invalid recovered assignment: {fid}')
        owners['owners'][fid] = tag
        cores['cores'][fid] = [tag]
        if controllers is not None:
            controllers['controllers'][fid] = tag
    inputs = output.parent / (output.name + '.inputs')
    inputs.mkdir(parents=True, exist_ok=False)
    write_json_atomic(inputs / 'owners.by_feature.json', owners, indent=2)
    started = time.monotonic()
    print('Build full Russian owner chunks including recovered IDs', flush=True)
    rebuild = build_regional_scenario_assets(
        baseline_dir=baseline, candidate_runtime_path=recovery / 'runtime-candidate.topo.json',
        candidate_owners_path=inputs / 'owners.by_feature.json', output_dir=output,
        added_feature_ids=tuple(report['added_ids']), removed_helper_ids=tuple(report['removed_helper_ids']))
    if rebuild['owner_changed_ids']:
        raise ValueError('An existing feature owner changed during recovery')
    manifest, audit = read(output / 'manifest.json'), read(output / 'audit.json')
    recalculate_country_feature_counts(countries, owners, audit, manifest)
    manifest['baseline_hash'] = stable_json_hash(owners['owners'])
    for name, payload in [('owners.by_feature.json', owners), ('cores.by_feature.json', cores),
                          ('countries.json', countries), ('manifest.json', manifest), ('audit.json', audit)]:
        write_json_atomic(output / name, payload, indent=2)
    if controllers is not None:
        write_json_atomic(output / 'controllers.by_feature.json', controllers, indent=2)
    # Persist reviewed new IDs in existing authoring carriers. Later user edits
    # replace these ordinary assignments through the normal project workflow.
    for name, key in [('scenario_manual_overrides.json', 'assignments'),
                      ('scenario_mutations.json', 'assignments_by_feature_id')]:
        payload = read(output / name)
        for fid, tag in assignments.items():
            if fid in payload[key]:
                raise ValueError(f'Unexpected preexisting authoring assignment: {fid}')
            payload[key][fid] = {'owner': tag, 'controller': tag, 'cores': [tag]}
        write_json_atomic(output / name, payload, indent=2)
    print('Finalize full Russian startup, snapshot and audit', flush=True)
    fixes = finalize_stage(output)
    measurement = {'elapsed_seconds': time.monotonic() - started,
                   'process_peak_working_set_bytes': peak_memory(),
                   'baseline': sizes(baseline), 'candidate': sizes(output),
                   'recovery_report_sha256': digest(recovery / 'report.json'),
                   'rebuild': rebuild, 'safe_fixes': fixes, 'browser_validated': False,
                   'production_applied': False}
    write_json_atomic(output.parent / (output.name + '.build-report.json'), measurement, indent=2)
    return measurement


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('baseline-dir', 'recovery-dir', 'output-dir'):
        parser.add_argument('--' + name, type=Path, required=True)
    a = parser.parse_args()
    print(build(a.baseline_dir, a.recovery_dir, a.output_dir))
