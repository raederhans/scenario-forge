"""Bounded validation and content-addressed reuse for precision candidate builds.

Cache entries are expendable local acceleration, never release evidence. A miss,
corrupt record, changed toolchain or changed algorithm recomputes the result.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Any, Callable

BLOCK_BYTES = 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(BLOCK_BYTES), b''):
            digest.update(block)
    return digest.hexdigest()


def hash_json(value: Any) -> str:
    digest = hashlib.sha256()
    encoder = json.JSONEncoder(sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    for part in encoder.iterencode(value):
        digest.update(part.encode('utf-8'))
    return digest.hexdigest()


def write_json_atomic(path: Path, value: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as target:
            json.dump(value, target, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
            target.write('\n')
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def assert_gzip_matches(compressed: Path, original: Path, *, block_bytes: int = BLOCK_BYTES) -> None:
    """Compare all bytes and consume the gzip trailer/CRC with bounded buffers."""
    if not isinstance(block_bytes, int) or block_bytes <= 0:
        raise ValueError('block_bytes must be a positive integer')
    with gzip.open(compressed, 'rb') as packed, Path(original).open('rb') as plain:
        while True:
            left, right = packed.read(block_bytes), plain.read(block_bytes)
            if left != right:
                raise ValueError(f'Stale gzip after binding restoration: {Path(compressed).name}')
            if not left:
                return


class PhaseRecorder:
    def __init__(self, *, clock: Callable[[], float] = time.monotonic,
                 process_peak: Callable[[], int | None] = lambda: None):
        self.clock, self.process_peak = clock, process_peak
        self.started = self.previous = clock()
        self.phases: list[dict[str, Any]] = []

    def checkpoint(self, name: str) -> None:
        current = self.clock()
        self.phases.append({'phase': name, 'elapsed_seconds': current - self.previous,
                            'cumulative_seconds': current - self.started,
                            # This is NOT a per-phase or sampled RSS peak.
                            'process_lifetime_peak_working_set_bytes': self.process_peak()})
        self.previous = current


def cached_json_result(cache_root: Path, inputs: Any, build: Callable[[], Any],
                       validate: Callable[[Any], None]) -> tuple[Any, dict[str, Any]]:
    key = hash_json(inputs)
    cache_root = Path(cache_root)
    if cache_root.is_symlink():
        raise ValueError('Cache root may not be a symlink')
    path = cache_root / (key + '.json')
    if path.is_file() and not path.is_symlink():
        try:
            record = json.loads(path.read_text(encoding='utf-8'))
            value = record['value']
            if record['schema_version'] != 1 or record['key'] != key or record['value_sha256'] != hash_json(value):
                raise ValueError('Stale cache envelope')
            validate(value)
            return value, {'key': key, 'hit': True}
        except (ValueError, TypeError, KeyError, OSError):
            pass
    value = build()
    validate(value)
    write_json_atomic(path, {'schema_version': 1, 'key': key, 'value_sha256': hash_json(value), 'value': value})
    return value, {'key': key, 'hit': False}
