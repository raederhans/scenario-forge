"""Project newer startup wires into the standard v5 wire for older perf code.

Only the synthetic baseline's scenario inputs may change. Source hashes identify
source assets, not embedded wire bytes, so they remain the candidate's hashes.
"""

from __future__ import annotations

import argparse
import ast
import gzip
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.startup_topology_codec import decode_topology

STANDARD_TOPOLOGY_VERSION = 5


def baseline_bundle_version(root: Path) -> int:
    # Read the base's declared interface without importing its build dependencies.
    source = (root / "tools/build_startup_bundle.py").read_text(encoding="utf-8")
    for statement in ast.parse(source).body:
        if isinstance(statement, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "STARTUP_BUNDLE_VERSION"
            for target in statement.targets
        ):
            version = ast.literal_eval(statement.value)
            if type(version) is int and version >= STANDARD_TOPOLOGY_VERSION:
                return version
    raise ValueError("Baseline does not declare a supported startup bundle interface (v5 or newer)")


def standard_bundle(payload: dict) -> dict:
    projected = {**payload, "base": dict(payload["base"]), "scenario": dict(payload["scenario"]),
                 "manifest_subset": dict(payload["manifest_subset"])}
    for section, field in (("base", "topology_primary"), ("scenario", "runtime_topology_bootstrap")):
        topology = decode_topology(projected[section][field])
        if not isinstance(topology, dict) or not isinstance(topology.get("arcs"), list):
            raise ValueError(f"{section}.{field} did not decode to standard TopoJSON")
        if "arcs_encoding" in topology or "arc_references_encoding" in topology:
            raise ValueError(f"{section}.{field} retains an encoded descriptor")
        projected[section][field] = topology
    projected["version"] = STANDARD_TOPOLOGY_VERSION
    projected["manifest_subset"]["startup_bundle_version"] = STANDARD_TOPOLOGY_VERSION
    return projected


def json_bytes(payload: dict, *, manifest: bool = False) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, sort_keys=True,
                       indent=2 if manifest else None,
                       separators=None if manifest else (",", ":")) + "\n").encode("utf-8")


def project_startup_inputs(candidate_root: Path, baseline_root: Path, scenarios: list[str], *, verify: bool = False) -> dict:
    if candidate_root.resolve() == baseline_root.resolve():
        raise ValueError("Baseline projection must use a separate measurement tree")
    supported = baseline_bundle_version(baseline_root)
    changed_files = []
    assets = []
    for scenario_id in scenarios:
        if not scenario_id or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_" for character in scenario_id):
            raise ValueError(f"Invalid scenario id: {scenario_id}")
        relative_dir = Path("data/scenarios") / scenario_id
        manifest_path = relative_dir / "manifest.json"
        manifest = json.loads((candidate_root / manifest_path).read_text(encoding="utf-8"))
        needs_projection = manifest["startup_bundle_version"] > supported
        expected = {}
        for language in ("en", "zh"):
            relative_path = relative_dir / f"startup.bundle.{language}.json"
            if manifest[f"startup_bundle_url_{language}"] != relative_path.as_posix():
                raise ValueError("Unexpected startup bundle URL in governed scenario")
            source_bytes = (candidate_root / relative_path).read_bytes()
            payload = json.loads(source_bytes)
            if payload["version"] != manifest["startup_bundle_version"]:
                raise ValueError("Candidate startup bundle and manifest versions disagree")
            raw = json_bytes(standard_bundle(payload)) if needs_projection else source_bytes
            sidecar_path = Path(str(relative_path) + ".gz")
            compressed = (gzip.compress(raw, compresslevel=9, mtime=0) if needs_projection
                          else (candidate_root / sidecar_path).read_bytes())
            if json.loads(gzip.decompress(compressed)) != json.loads(raw):
                raise ValueError("Startup gzip sidecar does not match its JSON payload")
            expected[relative_path] = raw
            expected[sidecar_path] = compressed
        if needs_projection:
            manifest = {**manifest, "startup_bundle_version": STANDARD_TOPOLOGY_VERSION}
        expected[manifest_path] = (json_bytes(manifest, manifest=True) if needs_projection
                                   else (candidate_root / manifest_path).read_bytes())
        for relative_path, raw in expected.items():
            target_path = baseline_root / relative_path
            if verify:
                if target_path.read_bytes() != raw:
                    raise ValueError(f"Baseline startup projection differs from candidate workload: {relative_path}")
            elif target_path.read_bytes() != raw:
                target_path.write_bytes(raw)
            if raw != (candidate_root / relative_path).read_bytes():
                changed_files.append(relative_path.as_posix())
                assets.append({"path": relative_path.as_posix(), "bytes": len(raw),
                               "sha256": hashlib.sha256(raw).hexdigest()})
    return {"baseline_bundle_version": supported, "projection_bundle_version": STANDARD_TOPOLOGY_VERSION,
            "scenarios": scenarios, "changed_files": sorted(changed_files), "assets": assets}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-root", required=True, type=Path)
    parser.add_argument("--baseline-root", required=True, type=Path)
    parser.add_argument("--scenarios", required=True)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    report = project_startup_inputs(args.candidate_root, args.baseline_root, args.scenarios.split(","), verify=args.verify)
    if args.verify:
        if json.loads(args.receipt.read_text(encoding="utf-8")) != report:
            raise ValueError("Startup compatibility receipt does not match the verified projection")
    else:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_bytes(json_bytes(report, manifest=True))


if __name__ == "__main__":
    main()
