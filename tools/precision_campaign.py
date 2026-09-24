"""Country/scenario evidence envelopes over precision_candidate_receipt.

Only command execution evidence is aggregated. This tool never promotes data or
turns a successful command into reviewed visual/performance/release approval.
Paths in a campaign are repository-relative. Outputs belong under .runtime.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tools import precision_candidate_receipt as receipts
from tools.pages_artifact_root import has_reparse_point_component, resolve_runtime_path
from tools.precision_build_support import hash_json, sha256_file, write_json_atomic

KINDS = ('precision-candidate', 'canonical-reference', 'synthetic-fixture')
STAGES = ('source-preparation', 'partial-geometry', 'complete-bundle')


def read_json(path: Path):
    with Path(path).open(encoding='utf-8') as handle:
        return json.load(handle)


def repo_file(value: str, root: Path) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        raise ValueError('Expected repository-relative evidence file')
    path = root / value
    if has_reparse_point_component(path) or not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f'Missing, external or linked evidence file: {value}')
    return path


def load_campaign(path: Path) -> dict:
    document = read_json(path)
    if document.get('schema_version') != 1 or not isinstance(document.get('targets'), list):
        raise ValueError('Campaign requires schema_version=1 and targets')
    seen = set()
    for target in document['targets']:
        key = target.get('id', '')
        if not isinstance(key, str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}', key) or key in seen:
            raise ValueError(f'Invalid or duplicate target id: {key}')
        seen.add(key)
        countries = target.get('countries')
        if not isinstance(countries, list) or not countries or len(set(countries)) != len(countries) or any(not isinstance(c, str) or not re.fullmatch(r'[A-Z]{2,3}', c) for c in countries):
            raise ValueError(f'Invalid countries: {key}')
        if not re.fullmatch(r'[a-z0-9_]+', str(target.get('scenario_id', ''))):
            raise ValueError(f'Invalid scenario: {key}')
        if target.get('kind') not in KINDS or target.get('declared_stage') not in STAGES:
            raise ValueError(f'Explicit kind and declared_stage required: {key}')
        if not isinstance(target.get('parameters'), dict) or not isinstance(target.get('sources'), list):
            raise ValueError(f'Explicit parameters and sources required: {key}')
    return document


def target_binding(target: dict, source: dict, *, root: Path = ROOT) -> dict:
    """Bind declared provenance to actual input bytes, never infer a license."""
    if not target['sources']:
        raise ValueError('missing-source-provenance')
    sources, ids = [], set()
    for item in target['sources']:
        for key in ('id', 'version', 'uri', 'license', 'license_uri'):
            if not isinstance(item.get(key), str) or not item[key].strip():
                raise ValueError(f'Missing source field: {key}')
        if item['id'] in ids:
            raise ValueError('Duplicate source id')
        ids.add(item['id'])
        if not item['uri'].startswith('https://') or not item['license_uri'].startswith('https://'):
            raise ValueError('Source and license references must be explicit HTTPS URIs')
        assets = []
        if not isinstance(item.get('files'), list) or not item['files']:
            raise ValueError('Source must bind at least one original input file')
        for asset in item['files']:
            path = repo_file(asset['path'], root)
            digest = sha256_file(path)
            if digest != asset.get('sha256'):
                raise ValueError(f'Source digest mismatch: {asset["path"]}')
            assets.append({'path': asset['path'], 'sha256': digest, 'size_bytes': path.stat().st_size})
        sources.append({key: item[key] for key in ('id', 'version', 'uri', 'license', 'license_uri')} | {'files': assets})
    candidate = resolve_runtime_path(Path(target['candidate_root']), repo_root=root, label='Candidate', must_exist=True, require_directory=True)
    snapshot = receipts.snapshot(candidate, source)
    manifest = candidate / 'manifest.json'
    if manifest.is_file():
        value = read_json(manifest)
        actual_id = value.get('scenario_id', value.get('id'))
        if actual_id != target['scenario_id']:
            raise ValueError('Candidate scenario identity mismatch')
    elif target['declared_stage'] == 'complete-bundle':
        raise ValueError('Declared complete bundle lacks manifest.json')
    definition = {key: target[key] for key in ('id', 'countries', 'scenario_id', 'kind', 'declared_stage', 'parameters')}
    definition['sources'] = sources
    definition['source'] = source
    definition['candidate_tree_sha256'] = snapshot['candidate_tree_sha256']
    return {'binding': definition, 'binding_sha256': hash_json(definition), 'snapshot': snapshot}


def read_gate_envelope(path: Path, current: dict, root: Path) -> dict:
    path = repo_file(path.relative_to(root).as_posix() if path.is_absolute() else str(path), root)
    value = read_json(path)
    if value.get('schema_version') != 1 or value.get('binding_sha256') != current['binding_sha256'] or value.get('binding') != current['binding']:
        raise ValueError('Campaign/source/parameter/candidate binding mismatch')
    if value.get('inputs_unchanged') is not True:
        raise ValueError('Campaign inputs changed during command')
    relative = value.get('receipt_file', '')
    if not isinstance(relative, str) or Path(relative).name != relative:
        raise ValueError('Receipt must be adjacent to its envelope')
    receipt_path = path.parent / relative
    if sha256_file(receipt_path) != value.get('receipt_sha256'):
        raise ValueError('Receipt digest mismatch')
    return receipts.read_verified_receipt(receipt_path)


def inventory(document: dict, source: dict, *, root: Path = ROOT) -> dict:
    targets = []
    for target in document['targets']:
        row = {key: target[key] for key in ('id', 'countries', 'scenario_id', 'kind', 'declared_stage')}
        row.update({'gates': {key: 'not-run' for key in receipts.GATES}, 'release_ready': False,
                    'published': False, 'blockers': [], 'reviewed_acceptance': 'not-established'})
        try:
            current = target_binding(target, source, root=root)
            gates, errors = [], []
            for path in target.get('receipts', []):
                try:
                    gates.append(read_gate_envelope(Path(path), current, root))
                except (ValueError, KeyError, TypeError, OSError) as exc:
                    errors.append({'receipt': path, 'error': str(exc)})
            report = receipts.gate_inventory(current['snapshot'], gates)
            row.update({'binding_sha256': current['binding_sha256'], 'gates': report['gates'],
                        'candidate_tree_sha256': current['snapshot']['candidate_tree_sha256'],
                        'total_bytes': current['snapshot']['total_bytes'], 'rejected_receipts': errors + report['rejected_receipts'],
                        'all_commands_passed': report['all_commands_passed'] and not errors,
                        'state': 'bound-command-evidence'})
            if errors or report['rejected_receipts']:
                row['state'] = 'invalid-evidence'
            if target['kind'] != 'precision-candidate':
                row['blockers'].append('reference-or-fixture-does-not-validate-precision-candidate')
        except (ValueError, KeyError, TypeError, OSError) as exc:
            row.update({'state': 'missing-or-invalid-inputs', 'all_commands_passed': False})
            row['blockers'].append(str(exc))
        targets.append(row)
    by_country_scenario = {}
    for target in targets:
        for country in target['countries']:
            by_country_scenario.setdefault(f'{country}/{target["scenario_id"]}', []).append(target['id'])
    return {'schema_version': 1, 'source': source, 'targets': targets,
            'by_country_scenario': by_country_scenario, 'release_ready': False,
            'note': 'States are exact-byte command evidence, not reviewed gate acceptance or publication.'}


def run_gate(document: dict, target_id: str, gate: str, out: Path, command: list[str], *, root: Path = ROOT) -> int:
    target = next((item for item in document['targets'] if item['id'] == target_id), None)
    if target is None:
        raise ValueError('Unknown target id')
    source = receipts.source_identity(root)
    before = target_binding(target, source, root=root)
    out = resolve_runtime_path(out, repo_root=root, label='Envelope')
    if out.exists():
        raise ValueError('Envelope exists; use a new run id')
    receipt_path = out.with_name(out.stem + '.command.json')
    # Reuse the established process-tree timeout, clean-source check and logs.
    result = receipts.main(['run', '--candidate-root', target['candidate_root'], '--gate', gate,
                            '--out', str(receipt_path), '--', *command])
    try:
        after = target_binding(target, receipts.source_identity(root), root=root)
        unchanged = before['binding_sha256'] == after['binding_sha256']
    except (ValueError, KeyError, TypeError, OSError):
        unchanged = False
    write_json_atomic(out, {'schema_version': 1, 'binding': before['binding'],
                           'binding_sha256': before['binding_sha256'], 'inputs_unchanged': unchanged,
                           'receipt_file': receipt_path.name, 'receipt_sha256': sha256_file(receipt_path)})
    return result if unchanged else 1


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    cut = args.index('--') if '--' in args else len(args)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('inventory', 'run'))
    parser.add_argument('--campaign', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--target')
    parser.add_argument('--gate', choices=receipts.GATES)
    options = parser.parse_args(args[:cut])
    document = load_campaign(repo_file(options.campaign.as_posix(), ROOT))
    if options.operation == 'run':
        if not options.target or not options.gate or cut == len(args):
            raise ValueError('run requires target, gate and a command after --')
        return run_gate(document, options.target, options.gate, options.out, args[cut + 1:])
    if cut != len(args):
        raise ValueError('inventory does not execute commands')
    out = resolve_runtime_path(options.out, repo_root=ROOT, label='Inventory')
    if out.exists():
        raise ValueError('Inventory exists; use a new output')
    report = inventory(document, receipts.source_identity(ROOT))
    write_json_atomic(out, report)
    return 0 if all(t.get('all_commands_passed') for t in report['targets']) and report['targets'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
