"""Bind candidate validation commands to exact source and candidate bytes.

Examples:
  python tools/precision_candidate_receipt.py snapshot --candidate-root .runtime/candidate/tno_1962 --out .runtime/receipts/snapshot.json
  python tools/precision_candidate_receipt.py run --candidate-root .runtime/candidate/tno_1962 --gate strict --out .runtime/receipts/strict.json -- python tools/check_scenario_contracts.py --strict --scenario-dir .runtime/candidate/tno_1962
  python tools/precision_candidate_receipt.py inventory --candidate-root .runtime/candidate/tno_1962 --receipt .runtime/receipts/strict.json --out .runtime/receipts/inventory.json

Inventory never publishes or approves a release. A successful command is a bound
execution receipt, not automatic proof that its
assertions cover the named gate. Review the recorded argv when accepting a gate.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tools.pages_artifact_root import resolve_runtime_path, has_reparse_point_component
from tools.precision_build_support import hash_json, sha256_file, write_json_atomic

GATES = ('strict', 'lod', 'project', 'visual', 'performance')
SCHEMA = 1


def source_identity(root: Path = ROOT) -> dict:
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
    if git('status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Candidate receipts require a clean source checkout')
    return {'git_sha': git('rev-parse', 'HEAD'), 'git_tree': git('rev-parse', 'HEAD^{tree}')}


def snapshot(candidate_root: Path, source: dict) -> dict:
    candidate_root = Path(candidate_root)
    if has_reparse_point_component(candidate_root) or not candidate_root.is_dir():
        raise ValueError('Candidate must be an existing non-symlink directory')
    records = []
    for path in sorted(candidate_root.rglob('*')):
        if has_reparse_point_component(path):
            raise ValueError(f'Symlink in candidate: {path}')
        if not path.is_file():
            continue
        before = path.stat()
        digest = sha256_file(path)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise ValueError(f'Candidate changed during hashing: {path}')
        records.append({'path': path.relative_to(candidate_root).as_posix(), 'size_bytes': before.st_size, 'sha256': digest})
    if not records:
        raise ValueError('Empty candidate')
    return {'schema_version': SCHEMA, 'source': dict(source), 'candidate_tree_sha256': hash_json(records),
            'file_count': len(records), 'total_bytes': sum(row['size_bytes'] for row in records), 'files': records}


def gate_inventory(current: dict, receipts: list[dict]) -> dict:
    gates = {gate: 'not-run' for gate in GATES}
    rejected = []
    for receipt in receipts:
        gate = receipt.get('gate')
        if (receipt.get('schema_version') != SCHEMA or gate not in gates
            or receipt.get('source') != current['source']
            or receipt.get('candidate_tree_sha256') != current['candidate_tree_sha256']):
            rejected.append({'gate': gate, 'reason': 'source-or-candidate-binding-mismatch'})
            continue
        # Duplicate/conflicting evidence is never resolved by picking a green run.
        if gates[gate] != 'not-run':
            gates[gate] = 'conflicting-evidence'
            continue
        gates[gate] = 'passed' if receipt.get('status') == 'passed' and receipt.get('exit_code') == 0 and receipt.get('inputs_unchanged') is True and receipt.get('command') else 'failed'
    return {'schema_version': SCHEMA, 'source': current['source'],
            'candidate_tree_sha256': current['candidate_tree_sha256'], 'file_count': current['file_count'],
            'total_bytes': current['total_bytes'], 'gates': gates, 'rejected_receipts': rejected,
            'all_commands_passed': not rejected and all(status == 'passed' for status in gates.values()),
            'release_ready': False, 'release_status': 'requires-reviewed-gate-acceptance'}


def read_verified_receipt(path: Path) -> dict:
    """Read an execution receipt and validate both adjacent immutable logs."""
    path = Path(path)
    if has_reparse_point_component(path) or not path.is_file():
        raise ValueError(f'Missing or linked receipt: {path}')
    value = json.loads(path.read_text(encoding='utf-8'))
    for stream in ('stdout', 'stderr'):
        entry = value.get('logs', {}).get(stream, {})
        name = entry.get('file', '')
        if not isinstance(name, str) or not name or Path(name).name != name:
            raise ValueError(f'Invalid receipt log path: {path}')
        log = path.resolve().parent / name
        if (has_reparse_point_component(log) or not log.is_file()
                or sha256_file(log) != entry.get('sha256')):
            raise ValueError(f'Missing or changed receipt log: {path}')
    return value


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('snapshot', 'run', 'inventory'))
    parser.add_argument('--candidate-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--gate', choices=GATES)
    parser.add_argument('--receipt', action='append', type=Path, default=[])
    parser.add_argument('--timeout-seconds', type=int, default=1800)
    # Split explicitly: argparse.REMAINDER would otherwise swallow options.
    args_list = list(sys.argv[1:] if argv is None else argv)
    cut = args_list.index('--') if '--' in args_list else len(args_list)
    command = args_list[cut + 1:]
    args = parser.parse_args(args_list[:cut])
    candidate = resolve_runtime_path(args.candidate_root, repo_root=ROOT, label='Candidate', must_exist=True, require_directory=True)
    output = resolve_runtime_path(args.out, repo_root=ROOT, label='Receipt')
    if output.is_relative_to(candidate):
        raise ValueError('Receipt must be outside the candidate')
    if output.exists():
        raise ValueError('Receipt already exists; select a new output path')
    source = source_identity(ROOT)
    before = snapshot(candidate, source)
    if args.operation == 'snapshot':
        if command:
            raise ValueError('snapshot does not execute commands')
        write_json_atomic(output, before)
        return 0
    if args.operation == 'inventory':
        receipts = []
        for path in args.receipt:
            path = resolve_runtime_path(path, repo_root=ROOT, label='Gate receipt', must_exist=True)
            receipts.append(read_verified_receipt(path))
        report = gate_inventory(before, receipts)
        write_json_atomic(output, report)
        return 0 if report['all_commands_passed'] else 2
    if not args.gate or not command or args.timeout_seconds <= 0:
        raise ValueError('run requires a gate, positive timeout and command after --')
    output.parent.mkdir(parents=True, exist_ok=True)
    stdout = output.with_suffix('.stdout.log')
    stderr = output.with_suffix('.stderr.log')
    if stdout.exists() or stderr.exists():
        raise ValueError('Receipt logs already exist; select a new output path')
    started = time.monotonic()
    exit_code, error = -1, ''
    try:
        with stdout.open('wb') as out, stderr.open('wb') as err:
            process = subprocess.Popen(command, cwd=ROOT, env={**os.environ,
                'SCENARIO_FORGE_CANDIDATE_ROOT': str(candidate),
                'SCENARIO_FORGE_CANDIDATE_TREE_SHA256': before['candidate_tree_sha256']},
                stdout=out, stderr=err, start_new_session=os.name != 'nt',
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
            try:
                exit_code = process.wait(timeout=args.timeout_seconds)
            except subprocess.TimeoutExpired:
                # Kill only this command's owned process tree, including its test servers.
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], check=False, stdout=err, stderr=err)
                else:
                    try: os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                if process.poll() is None:
                    process.kill()
                process.wait()
                raise
    except (subprocess.TimeoutExpired, OSError) as exc:
        error = str(exc)
    try:
        unchanged = snapshot(candidate, source)['candidate_tree_sha256'] == before['candidate_tree_sha256'] and source_identity(ROOT) == source
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        unchanged = False
        error = error or str(exc)
    report = {'schema_version': SCHEMA, 'gate': args.gate, 'source': source,
              'candidate_tree_sha256': before['candidate_tree_sha256'], 'command': command,
              'exit_code': exit_code, 'status': 'passed' if exit_code == 0 and unchanged else 'failed',
              'inputs_unchanged': unchanged, 'error': error, 'elapsed_seconds': time.monotonic() - started,
              'logs': {key: {'file': file.name, 'sha256': sha256_file(file)} for key, file in [('stdout', stdout), ('stderr', stderr)]}}
    write_json_atomic(output, report)
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
