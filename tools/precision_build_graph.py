"""Small content-addressed build stages. Cached outputs are not release approval.

Stage owners declare their file inputs, parameters, algorithm closure and toolchain.
Dependencies are immutable output directories. Stages run sequentially, validate
cache hits, and atomically publish only after all inputs remain unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
import shutil
import tempfile
import time
from typing import Any, Callable, Mapping

from tools.precision_build_support import hash_json, sha256_file, write_json_atomic

SCHEMA_VERSION = 1


def checked_directory(path: Path) -> Path:
    path = Path(path).absolute()
    for parent in (path, *path.parents):
        if parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)():
            raise ValueError(f'Build paths may not traverse links: {parent}')
    return path


def file_inventory(root: Path) -> dict[str, dict[str, Any]]:
    root = checked_directory(root)
    if not root.is_dir():
        raise ValueError(f'Missing stage output directory: {root}')
    inventory = {}
    for current, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            candidate = Path(current) / name
            if candidate.is_symlink() or getattr(candidate, 'is_junction', lambda: False)():
                raise ValueError(f'Linked stage output: {candidate}')
        for name in sorted(files):
            candidate = Path(current) / name
            if not candidate.is_file():
                raise ValueError(f'Non-regular stage output: {candidate}')
            inventory[candidate.relative_to(root).as_posix()] = {
                'sha256': sha256_file(candidate), 'bytes': candidate.stat().st_size,
            }
    return dict(sorted(inventory.items()))


def input_inventory(paths: Mapping[str, Path]) -> dict[str, dict[str, Any]]:
    result = {}
    for name, path in sorted(paths.items()):
        path = checked_directory(Path(path))
        if not path.is_file():
            raise ValueError(f'Missing declared build input {name}: {path}')
        # Bind content, not host-dependent absolute paths or modification times.
        result[name] = {'sha256': sha256_file(path), 'bytes': path.stat().st_size}
    return result


@dataclass(frozen=True)
class BuildStage:
    name: str
    build: Callable[[Path, Mapping[str, Path]], None]
    validate: Callable[[Path], None]
    inputs: Mapping[str, Path] = field(default_factory=dict)
    parameters: Mapping[str, Any] = field(default_factory=dict)
    algorithms: Mapping[str, Path] = field(default_factory=dict)
    toolchain: Mapping[str, Any] = field(default_factory=dict)
    dependencies: tuple[str, ...] = ()


@dataclass(frozen=True)
class StageResult:
    name: str
    key: str
    output_root: Path
    output_sha256: str
    cache_hit: bool
    elapsed_seconds: float
    invalidation_reason: str

    def summary(self) -> dict[str, Any]:
        return {key: value for key, value in self.__dict__.items() if key != 'output_root'}


class BuildGraph:
    """Coordinates keys and immutable artifacts, not geometry or domain policy."""
    def __init__(self, cache_root: Path):
        self.cache_root = checked_directory(cache_root)
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.results: dict[str, StageResult] = {}

    @staticmethod
    def _valid_name(name: str) -> bool:
        return bool(name) and all(c in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in name)

    def run(self, stages: list[BuildStage]) -> dict[str, StageResult]:
        by_name = {}
        for stage in stages:
            if not self._valid_name(stage.name) or stage.name in by_name:
                raise ValueError(f'Invalid or duplicate stage name: {stage.name}')
            if not stage.algorithms or not stage.toolchain:
                raise ValueError(f'{stage.name} requires an explicit algorithm closure and toolchain')
            if not callable(stage.build) or not callable(stage.validate):
                raise TypeError('Build and validation callbacks must be callable')
            input_inventory(stage.inputs)
            input_inventory(stage.algorithms)
            hash_json(stage.parameters)
            hash_json(stage.toolchain)
            by_name[stage.name] = stage
        # Validate the complete graph before executing or publishing any stage.
        visiting, visited, order = set(), set(), []
        def visit(name):
            if name not in by_name:
                raise ValueError(f'Unknown build dependency: {name}')
            if name in visiting:
                raise ValueError(f'Cyclic build dependency: {name}')
            if name in visited:
                return
            visiting.add(name)
            for dependency in by_name[name].dependencies:
                visit(dependency)
            visiting.remove(name)
            visited.add(name)
            order.append(by_name[name])
        for name in by_name:
            visit(name)
        self.results = {}
        for stage in order:
            self.results[stage.name] = self._run_stage(stage)
        return dict(self.results)

    def _identity(self, stage: BuildStage) -> dict[str, Any]:
        return {
            'schema_version': SCHEMA_VERSION, 'stage': stage.name,
            'engine_sha256': sha256_file(Path(__file__)),
            'inputs': input_inventory(stage.inputs),
            'parameters': stage.parameters,
            'algorithms': input_inventory(stage.algorithms),
            'toolchain': stage.toolchain,
            'dependencies': {name: {'key': self.results[name].key,
                                    'output_sha256': self.results[name].output_sha256}
                             for name in stage.dependencies},
        }

    def _check_dependencies(self, stage: BuildStage) -> None:
        for name in stage.dependencies:
            result = self.results[name]
            if hash_json(file_inventory(result.output_root)) != result.output_sha256:
                raise ValueError(f'Build dependency mutated: {name}')

    def _run_stage(self, stage: BuildStage) -> StageResult:
        import json
        started = time.monotonic()
        self._check_dependencies(stage)
        identity = self._identity(stage)
        key = hash_json(identity)
        entry = checked_directory(self.cache_root / stage.name / key)
        reason = 'absent'
        if entry.exists():
            try:
                payload = checked_directory(entry / 'outputs')
                receipt_path = checked_directory(entry / 'receipt.json')
                receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
                current = file_inventory(payload)
                if (receipt['schema_version'] != SCHEMA_VERSION or receipt['key'] != key
                        or receipt['identity'] != identity or receipt['outputs'] != current):
                    raise ValueError('Invalid cached output envelope')
                stage.validate(payload)
                if file_inventory(payload) != current:
                    raise ValueError("Cache validator changed output bytes")
                self._check_dependencies(stage)
                if hash_json(self._identity(stage)) != key:
                    raise ValueError('Inputs changed while validating cache')
                return StageResult(stage.name, key, payload, hash_json(current), True,
                                   time.monotonic() - started, 'unchanged-inputs')
            except (OSError, ValueError, TypeError, KeyError) as error:
                # Preserve corrupt evidence; never overwrite a possibly in-use entry.
                reason = f'rejected-cache:{type(error).__name__}'
                quarantine = entry.with_name(key + '.rejected-' + str(time.time_ns()))
                entry.rename(quarantine)
        entry.parent.mkdir(parents=True, exist_ok=True)
        temp = Path(tempfile.mkdtemp(prefix='.' + key + '.', dir=entry.parent))
        try:
            output = temp / 'outputs'
            output.mkdir()
            stage.build(output, {name: self.results[name].output_root for name in stage.dependencies})
            current = file_inventory(output)  # reject links before owner code reads output
            stage.validate(output)
            if file_inventory(output) != current:
                raise ValueError("Stage validator changed output bytes")
            if not current:
                raise ValueError(f'Empty stage output: {stage.name}')
            self._check_dependencies(stage)
            if hash_json(self._identity(stage)) != key:
                raise ValueError(f'Inputs changed during build: {stage.name}')
            write_json_atomic(temp / 'receipt.json', {
                'schema_version': SCHEMA_VERSION, 'key': key, 'identity': identity, 'outputs': current,
            })
            try:
                temp.rename(entry)
            except OSError:
                # A concurrent equivalent build is safe only when its bytes agree.
                if not entry.is_dir() or file_inventory(entry / 'outputs') != current:
                    raise ValueError(f'Conflicting concurrent build for {stage.name}')
                receipt = json.loads((entry / 'receipt.json').read_text(encoding='utf-8'))
                if receipt.get('identity') != identity or receipt.get('outputs') != current:
                    raise ValueError(f'Invalid concurrent build for {stage.name}')
            return StageResult(stage.name, key, entry / 'outputs', hash_json(current), False,
                               time.monotonic() - started, reason)
        finally:
            shutil.rmtree(temp, ignore_errors=True)
