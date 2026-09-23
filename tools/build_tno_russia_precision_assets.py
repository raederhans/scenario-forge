"""Stage Russian precision assets, synchronize compressed bytes and measure resources."""
from __future__ import annotations

import argparse
import ctypes
import gzip
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.regional_scenario_assets import build_regional_scenario_assets, _copy_gzip
from tools.prepare_tno_russia_precision import read, safe_output
from map_builder.io.writers import write_json_atomic


def peak_memory():
    if os.name != "nt":
        return None
    class Counters(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ["PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage"]]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    current = ctypes.windll.kernel32.GetCurrentProcess
    current.restype = ctypes.c_void_p
    info = ctypes.windll.psapi.GetProcessMemoryInfo
    info.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    if not info(current(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError()
    return counters.PeakWorkingSetSize


def sizes(directory):
    manifest = read(directory / "detail_chunks.manifest.json")
    chunks = [directory / "chunks" / Path(e["url"]).name for e in manifest["chunks"]]
    political = [directory / "chunks" / Path(e["url"]).name for e in manifest["chunks"] if e["layer"] == "political"]
    compressed_sizes = {}
    def compressed(path):
        # Totals, political totals and largest-chunk rows share the same files.
        # Compress each once per report, without caching across measurements.
        if path not in compressed_sizes:
            compressed_sizes[path] = len(gzip.compress(path.read_bytes(), compresslevel=6, mtime=0))
        return compressed_sizes[path]
    return {"chunk_count": len(chunks), "chunks_json_bytes": sum(p.stat().st_size for p in chunks),
            "chunks_gzip6_bytes": sum(compressed(p) for p in chunks),
            "political_chunks_gzip6_bytes": sum(compressed(p) for p in political),
            "largest_political_chunks": sorted([{"name": p.name, "json_bytes": p.stat().st_size,
                                                  "gzip6_bytes": compressed(p)} for p in political],
                                                 key=lambda r: r["json_bytes"], reverse=True)[:8],
            "startup_gzip6_bytes": {lang: compressed(directory / f"startup.bundle.{lang}.json") for lang in ("en", "zh")}}


def finalize_stage(output):
    output = Path(output)
    from tools.check_scenario_contracts import (
        apply_safe_scenario_contract_repairs, _build_snapshot_for_scenario, _refresh_audit_payload,
    )
    fixes = apply_safe_scenario_contract_repairs(output, rebuild_chunk_assets=False)
    # Startup generation emits pretty JSON and compact gzip. Make HTTP and disk
    # byte-identical, then bind snapshot/audit without regenerating bundles.
    for path in output.rglob("*.json"):
        sibling = Path(str(path) + ".gz")
        if sibling.exists() and gzip.decompress(sibling.read_bytes()) != path.read_bytes():
            _copy_gzip(path)
    manifest = read(output / "manifest.json")
    snapshot = _build_snapshot_for_scenario(output, manifest)
    manifest["snapshot_fingerprint"] = snapshot["snapshot_fingerprint"]
    write_json_atomic(output / "manifest.json", manifest, indent=2)
    _refresh_audit_payload(output, manifest, snapshot_payload=snapshot)
    for name in ("manifest.json", "build_snapshot.json", "audit.json"):
        if Path(str(output / name) + ".gz").exists():
            _copy_gzip(output / name)
    for path in output.rglob("*.json.gz"):
        if gzip.decompress(path.read_bytes()) != Path(str(path)[:-3]).read_bytes():
            raise ValueError(f"Stale gzip after finalization: {path}")
    return fixes


def build(baseline, candidate, output):
    baseline, candidate = Path(baseline).resolve(), Path(candidate).resolve()
    output = safe_output(output, [baseline, candidate])
    started = time.monotonic()
    print("Build staged chunks and runtime", flush=True)
    report = build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=output)
    print("Finalize startup, snapshot and audit", flush=True)
    fixes = finalize_stage(output)
    immutable = ["owners.by_feature.json", "controllers.by_feature.json", "cores.by_feature.json", "countries.json",
                 "scenario_manual_overrides.json", "scenario_mutations.json"]
    for name in immutable:
        if (baseline / name).exists() and (baseline / name).read_bytes() != (output / name).read_bytes():
            raise ValueError(f"Assignment input changed: {name}")
    measurement = {"elapsed_seconds": time.monotonic()-started, "process_peak_working_set_bytes": peak_memory(),
                   "baseline": sizes(baseline), "candidate": sizes(output), "safe_fixes": fixes,
                   "unchanged_assignment_files": [n for n in immutable if (baseline / n).exists()],
                   "owner_changed_ids": report["owner_changed_ids"], "release_ready": False, "browser_validated": False}
    write_json_atomic(output.parent / (output.name + ".build-report.json"), measurement, indent=2)
    return measurement


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, required=True)
    parser.add_argument("--candidate-runtime", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.baseline_dir, args.candidate_runtime, args.output_dir), indent=2))
