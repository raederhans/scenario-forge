"""Run counterbalanced, single-variable precision measurements without retries.

A reviewed harness writes a fresh JSON measurement for every invocation. The
existing receipt runner owns timeouts, logs and source/candidate byte checks.
This runner does not set a performance acceptance threshold or publish data.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tools import precision_candidate_receipt as receipts
from tools.pages_artifact_root import has_reparse_point_component, resolve_runtime_path
from tools.precision_build_support import hash_json, sha256_file, write_json_atomic

MODES = ('fixed-data', 'fixed-code')


def validate_axes(mode: str, left: dict, right: dict) -> None:
    if mode not in MODES:
        raise ValueError('Unknown comparison mode')
    if mode == 'fixed-data' and left['candidate_tree_sha256'] != right['candidate_tree_sha256']:
        raise ValueError('fixed-data requires identical candidate bytes')
    if mode == 'fixed-code' and left['source']['git_tree'] != right['source']['git_tree']:
        raise ValueError('fixed-code requires identical source trees')


def sample_plan(warmups: int, runs: int) -> list[dict]:
    if isinstance(warmups, bool) or isinstance(runs, bool) or not isinstance(warmups, int) or not isinstance(runs, int) or warmups < 0 or runs < 1:
        raise ValueError('Expected nonnegative warmups and positive measured runs')
    return [{'id': f'{phase}-{index + 1}-{side}', 'phase': phase, 'pair': index + 1, 'side': side}
            for phase, count in (('warmup', warmups), ('measured', runs))
            for index in range(count) for side in (('left', 'right') if index % 2 == 0 else ('right', 'left'))]


def validate_sample(value: dict, *, sample_id: str, candidate_hash: str, scenario: str) -> None:
    if value.get('schema_version') != 1 or value.get('sample_id') != sample_id:
        raise ValueError('Missing or stale measurement identity')
    if value.get('candidate_tree_sha256') != candidate_hash or value.get('scenario_id') != scenario:
        raise ValueError('Measurement used the wrong candidate or scenario')
    if value.get('assertions_passed') is not True or not isinstance(value.get('environment'), dict) or not value['environment']:
        raise ValueError('Measurement lacks behavior assertions or environment identity')
    metrics = value.get('metrics')
    if not isinstance(metrics, dict) or not metrics:
        raise ValueError('Missing metrics')
    for name, number in metrics.items():
        if not isinstance(name, str) or not name or isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0:
            raise ValueError(f'Invalid metric: {name}')


def summarize(samples: list[dict]) -> dict:
    measured = [row for row in samples if row['phase'] == 'measured']
    if not measured:
        raise ValueError('No measured samples')
    environments = {hash_json(row['measurement']['environment']) for row in samples}
    keys = {tuple(sorted(row['measurement']['metrics'])) for row in samples}
    if len(environments) != 1 or len(keys) != 1:
        raise ValueError('Environment or measured metric set changed between samples')
    values = {side: [row['measurement']['metrics'] for row in measured if row['side'] == side] for side in ('left', 'right')}
    if not values['left'] or len(values['left']) != len(values['right']):
        raise ValueError('Incomplete comparison; do not summarize only successful samples')
    result = {}
    for key in next(iter(keys)):
        by_side = {}
        for side in ('left', 'right'):
            data = sorted(row[key] for row in values[side])
            by_side[side] = {'samples': data, 'median': statistics.median(data),
                             'p95_nearest_rank': data[math.ceil(0.95 * len(data)) - 1]}
        denominator = by_side['left']['median']
        result[key] = {**by_side, 'right_over_left': by_side['right']['median'] / denominator if denominator else None}
    return result


def run(definition: dict, output: Path, *, root: Path = ROOT) -> dict:
    if definition.get('schema_version') != 1 or definition.get('evidence_kind') not in ('precision-candidate', 'canonical-reference', 'synthetic-fixture'):
        raise ValueError('Explicit schema and evidence_kind required')
    output = resolve_runtime_path(output, repo_root=root, label='Comparison output')
    if output.exists():
        raise ValueError('Comparison output exists; choose a new run directory')
    command = definition.get('command')
    if not isinstance(command, list) or not command or any(not isinstance(arg, str) for arg in command):
        raise ValueError('command must be a shell-free argv array')
    for token in ('{source_root}', '{candidate_root}', '{sample_out}', '{sample_id}'):
        if not any(token in arg for arg in command):
            raise ValueError(f'Harness command must explicitly consume {token}')
    harness = [Path(name).resolve() for name in definition.get('harness_files', [])]
    if not harness or any(not p.is_file() or has_reparse_point_component(p) for p in harness):
        raise ValueError('Missing fixed harness files')
    harness_hashes = {str(path): sha256_file(path) for path in harness}
    variant_roots, candidates, inputs = {}, {}, {}
    for side in ('left', 'right'):
        variant = definition[side]
        checkout = Path(variant['source_root']).resolve()
        if has_reparse_point_component(checkout):
            raise ValueError('Linked checkout is unsupported')
        candidate = resolve_runtime_path(Path(variant['candidate_root']), repo_root=checkout,
                                         label=f'{side} candidate', must_exist=True, require_directory=True)
        inputs[side] = receipts.snapshot(candidate, receipts.source_identity(checkout))
        variant_roots[side], candidates[side] = checkout, candidate
    validate_axes(definition['mode'], inputs['left'], inputs['right'])
    plan = sample_plan(definition.get('warmups', 2), definition.get('runs', 5))
    run_id = output.name
    if not run_id or any(ch not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for ch in run_id):
        raise ValueError('Output directory name must be a safe unique run id')
    sample_roots = {
        side: resolve_runtime_path(checkout / '.runtime' / 'precision-measurements' / run_id,
                                   repo_root=checkout, label='Sample output')
        for side, checkout in variant_roots.items()
    }
    for destination in (output, *sample_roots.values()):
        for candidate in candidates.values():
            if destination == candidate or destination.is_relative_to(candidate) or candidate.is_relative_to(destination):
                raise ValueError('Comparison outputs must not overlap candidate inputs')
    output.mkdir(parents=True)
    report = {'schema_version': 1, 'mode': definition['mode'], 'evidence_kind': definition['evidence_kind'],
              'definition_sha256': hash_json(definition), 'harness_sha256': harness_hashes,
              'inputs': {side: {key: inputs[side][key] for key in ('source', 'candidate_tree_sha256', 'total_bytes')} for side in inputs},
              'plan': plan, 'samples': [], 'status': 'running', 'performance_accepted': False,
              'note': 'Counterbalanced diagnostic comparison, not a release approval. Five samples give a coarse p95 estimate.'}
    try:
        for item in plan:
            side, sample_id = item['side'], item['id']
            checkout, candidate = variant_roots[side], candidates[side]
            sample_root = resolve_runtime_path(sample_roots[side] / sample_id,
                                               repo_root=checkout, label='Sample output')
            if sample_root.exists():
                raise ValueError('Sample output exists; refusing stale evidence')
            sample_root.mkdir(parents=True)
            sample_out, receipt_out = sample_root / 'measurement.json', sample_root / 'command.json'
            replacements = {'source_root': str(checkout), 'candidate_root': str(candidate), 'sample_out': str(sample_out),
                            'sample_id': sample_id, 'scenario_id': definition['scenario_id']}
            argv = list(command)
            for key, value in replacements.items():
                argv = [arg.replace('{' + key + '}', value) for arg in argv]
            receipt_command = [sys.executable, str(checkout / 'tools/precision_candidate_receipt.py'), 'run',
                               '--candidate-root', str(candidate), '--gate', 'performance', '--out', str(receipt_out), '--', *argv]
            completed = subprocess.run(receipt_command, cwd=checkout, check=False)
            row = {**item, 'receipt_path': str(receipt_out), 'exit_code': completed.returncode}
            report['samples'].append(row)
            if completed.returncode:
                raise ValueError(f'Failed sample {sample_id}; no automatic retries')
            receipt = receipts.read_verified_receipt(receipt_out)
            if receipt.get('source') != inputs[side]['source'] or receipt.get('candidate_tree_sha256') != inputs[side]['candidate_tree_sha256'] or receipt.get('status') != 'passed':
                raise ValueError('Source or candidate changed between samples')
            if not sample_out.is_file() or has_reparse_point_component(sample_out):
                raise ValueError('Harness did not produce a regular measurement file')
            value = json.loads(sample_out.read_text(encoding='utf-8'))
            validate_sample(value, sample_id=sample_id, candidate_hash=inputs[side]['candidate_tree_sha256'], scenario=definition['scenario_id'])
            row.update({'receipt_sha256': sha256_file(receipt_out), 'measurement_sha256': sha256_file(sample_out), 'measurement': value})
            if any(sha256_file(path) != digest for path, digest in harness_hashes.items()):
                raise ValueError('Fixed harness changed during comparison')
            write_json_atomic(output / 'comparison.json', report)
        for side in inputs:
            after = receipts.snapshot(candidates[side], receipts.source_identity(variant_roots[side]))
            if after != inputs[side]:
                raise ValueError('Measured source or input changed at final check')
        report['summary'] = summarize(report['samples'])
        report['status'] = 'completed-diagnostic'
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
        report.update({'status': 'failed', 'error': str(exc)})
    write_json_atomic(output / 'comparison.json', report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--definition', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(argv)
    report = run(json.loads(args.definition.read_text(encoding='utf-8')), args.out)
    return 0 if report['status'] == 'completed-diagnostic' else 1


if __name__ == '__main__':
    raise SystemExit(main())
