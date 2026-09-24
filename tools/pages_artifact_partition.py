from __future__ import annotations

"""Lossless application/data packaging, not a hosting or URL migration.

All mutations are confined to new directories under .runtime. The caller supplies
an independently retained admission receipt. A package cannot approve itself.
"""
import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.pages_artifact_admission import verify_artifact_handoff
from tools.pages_artifact_root import resolve_runtime_path
from tools.pages_artifact_shadow import build_tree_snapshot, canonical_bytes, sha256_bytes

PARTITION_SCHEMA_VERSION = 1
DATA_PREFIX = "app/data/"


def _path(value: str | Path, repo_root: Path, *, exists: bool = False) -> Path:
    return resolve_runtime_path(value, repo_root=repo_root, must_exist=exists, require_directory=True)


def _new_output(value: str | Path, repo_root: Path, inputs: list[Path]) -> Path:
    output = _path(value, repo_root)
    if output.exists():
        raise ValueError("Output must be a new immutable directory")
    if any(output == root or root in output.parents or output in root.parents for root in inputs):
        raise ValueError("Output and input trees must be disjoint")
    return output


def _seal(value: dict[str, Any]) -> str:
    return sha256_bytes(canonical_bytes({key: item for key, item in value.items() if key != "sha256"}))


def _safe_file(value: str) -> str:
    if not isinstance(value, str) or "\\" in value or ":" in value or "\0" in value:
        raise ValueError("Invalid package-relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {".", ".."} for part in path.parts) or path.as_posix() != value:
        raise ValueError("Invalid package-relative path")
    return value


def _copy_records(source: Path, destination: Path, records: list[dict[str, Any]]) -> None:
    for record in records:
        relative = _safe_file(record["path"])
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        # Never use hard links: a mutation in a consumer must not modify the
        # admitted source artifact or an already retained release version.
        shutil.copyfile(source / relative, target)


def partition_artifact(artifact_root: Path, receipt: dict[str, Any], expected_source_sha: str,
                       output_root: Path, *, repo_root: Path = ROOT) -> dict[str, Any]:
    source = _path(artifact_root, repo_root, exists=True)
    output = _new_output(output_root, repo_root, [source])
    verify_artifact_handoff(source, receipt, expected_source_sha=expected_source_sha, repo_root=repo_root)
    original = build_tree_snapshot(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        parts = {}
        for name, data_part in (("application", False), ("data", True)):
            root = stage / name
            root.mkdir()
            records = [record for record in original["files"] if record["path"].startswith(DATA_PREFIX) == data_part]
            _copy_records(source, root, records)
            snapshot = build_tree_snapshot(root)
            if snapshot["files"] != records:
                raise ValueError(f"Copied {name} bytes differ from the admitted input")
            parts[name] = snapshot
        if not parts["application"]["files"] or not parts["data"]["files"]:
            raise ValueError("Both an application and a data asset set are required")
        manifest = {
            "schemaVersion": PARTITION_SCHEMA_VERSION,
            "kind": "lossless-pages-partition",
            "sourceSha": expected_source_sha,
            "admissionReceiptSha256": receipt["receiptSha256"],
            "artifactTreeSha256": original["treeSha256"],
            "parts": parts,
            "mounts": {"data": DATA_PREFIX},
            "urlsRewritten": False,
        }
        manifest["sha256"] = _seal(manifest)
        (stage / "partition.json").write_bytes(canonical_bytes(manifest) + b"\n")
        # Reject a source mutation that happened while copying, not only a bad
        # output. No package is published until this second verification passes.
        verify_artifact_handoff(source, receipt, expected_source_sha=expected_source_sha, repo_root=repo_root)
        stage.rename(output)
        return manifest
    except BaseException:
        shutil.rmtree(stage)
        raise


def verify_partition(package_root: Path, receipt: dict[str, Any], expected_source_sha: str,
                     *, repo_root: Path = ROOT) -> dict[str, Any]:
    package = _path(package_root, repo_root, exists=True)
    # Reject links and extra root entries before opening a manifest path.
    build_tree_snapshot(package)
    if {entry.name for entry in package.iterdir()} != {"application", "data", "partition.json"}:
        raise ValueError("Unexpected package root entries")
    manifest = json.loads((package / "partition.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != PARTITION_SCHEMA_VERSION \
            or manifest.get("kind") != "lossless-pages-partition" or manifest.get("sha256") != _seal(manifest):
        raise ValueError("Invalid partition manifest identity")
    if manifest.get("sourceSha") != expected_source_sha \
            or manifest.get("admissionReceiptSha256") != receipt.get("receiptSha256") \
            or manifest.get("artifactTreeSha256") != receipt.get("artifact", {}).get("treeSha256"):
        raise ValueError("Partition is not bound to the independently selected release receipt")
    if manifest.get("mounts") != {"data": DATA_PREFIX} or manifest.get("urlsRewritten") is not False:
        raise ValueError("Unsupported package mount or URL transformation")
    if not isinstance(manifest.get("parts"), dict) or set(manifest["parts"]) != {"application", "data"}:
        raise ValueError("Partition must have exactly two governed asset sets")
    paths = set()
    combined = []
    for name in ("application", "data"):
        snapshot = build_tree_snapshot(package / name)
        if snapshot != manifest["parts"][name]:
            raise ValueError(f"Partition {name} inventory differs from its actual bytes")
        for record in snapshot["files"]:
            relative = _safe_file(record["path"])
            if relative in paths or relative.startswith(DATA_PREFIX) != (name == "data"):
                raise ValueError("Duplicate or misclassified asset mount")
            paths.add(relative)
            combined.append(record)
    combined.sort(key=lambda record: record["path"])
    if sha256_bytes(canonical_bytes(combined)) != manifest["artifactTreeSha256"]:
        raise ValueError("Partition union differs from the admitted artifact")
    return manifest


def assemble_artifact(package_root: Path, receipt: dict[str, Any], expected_source_sha: str,
                      output_root: Path, *, repo_root: Path = ROOT) -> dict[str, Any]:
    package = _path(package_root, repo_root, exists=True)
    output = _new_output(output_root, repo_root, [package])
    manifest = verify_partition(package, receipt, expected_source_sha, repo_root=repo_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        for name in ("application", "data"):
            _copy_records(package / name, stage, manifest["parts"][name]["files"])
        result = verify_artifact_handoff(stage, receipt, expected_source_sha=expected_source_sha, repo_root=repo_root)
        verify_partition(package, receipt, expected_source_sha, repo_root=repo_root)
        stage.rename(output)
        return {"status": "byte-identical", "sourceSha": expected_source_sha,
                "receiptSha256": receipt["receiptSha256"], "treeSha256": result["treeSha256"],
                "output": output.relative_to(repo_root.resolve()).as_posix()}
    except BaseException:
        shutil.rmtree(stage)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("partition", "assemble"))
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        receipt_path = resolve_runtime_path(args.receipt, repo_root=ROOT, must_exist=True)
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        operation = partition_artifact if args.operation == "partition" else assemble_artifact
        result = operation(args.input_root, receipt, args.source_sha, args.output_root)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Pages partition failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
