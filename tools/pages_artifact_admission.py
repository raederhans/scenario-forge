from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.pages_artifact_root import resolve_pages_artifact_root, resolve_runtime_path
from tools.pages_artifact_shadow import (
    ShadowVerificationError,
    build_tree_snapshot,
    canonical_bytes,
    sha256_bytes,
    sha256_file,
    validate_pages_manifest,
)


ADMISSION_SCHEMA_VERSION = 1
SUMMARY_SCHEMA_VERSION = 1
BUILDER_PATH = "tools/build_pages_dist.py"
GIT_IDENTITY_PATTERN = re.compile(r"[0-9a-f]{40}")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


class PagesArtifactAdmissionError(ValueError):
    pass


def run_git(args: list[str], *, repo_root: Path = ROOT) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise PagesArtifactAdmissionError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def read_source_identity(*, repo_root: Path = ROOT) -> dict[str, str]:
    status = run_git(["status", "--porcelain", "--untracked-files=all"], repo_root=repo_root)
    if status:
        raise PagesArtifactAdmissionError("Pages artifact admission requires a clean source checkout")
    return {
        "gitSha": run_git(["rev-parse", "HEAD"], repo_root=repo_root),
        "gitTree": run_git(["rev-parse", "HEAD^{tree}"], repo_root=repo_root),
    }


def read_builder_identity(*, repo_root: Path = ROOT) -> dict[str, str]:
    builder_path = repo_root / BUILDER_PATH
    if not builder_path.is_file():
        raise PagesArtifactAdmissionError(f"Pages builder is missing: {builder_path}")
    return {"path": BUILDER_PATH, "sha256": sha256_file(builder_path)}


def receipt_hash(receipt: dict[str, Any]) -> str:
    unsigned = dict(receipt)
    unsigned.pop("receiptSha256", None)
    return sha256_bytes(canonical_bytes(unsigned))


def build_admission_receipt(
    artifact_root: Path,
    *,
    run_id: str,
    public_smoke: str = "not-run",
    source_identity: dict[str, str] | None = None,
    builder_identity: dict[str, str] | None = None,
    repo_root: Path = ROOT,
) -> dict[str, Any]:
    normalized_run_id = str(run_id).strip()
    if not normalized_run_id:
        raise PagesArtifactAdmissionError("Pages artifact admission runId is required")
    if public_smoke not in {"not-run", "passed"}:
        raise PagesArtifactAdmissionError("public smoke must be not-run or passed")
    selected_root = resolve_pages_artifact_root(
        artifact_root,
        repo_root=repo_root,
        allow_tracked_fallback=False,
        must_exist=True,
    )
    snapshot = build_tree_snapshot(selected_root)
    manifest = validate_pages_manifest(selected_root, snapshot)
    source = source_identity or read_source_identity(repo_root=repo_root)
    if any(
        not isinstance(source.get(field), str)
        or GIT_IDENTITY_PATTERN.fullmatch(source[field]) is None
        for field in ("gitSha", "gitTree")
    ):
        raise PagesArtifactAdmissionError("source identity must contain 40-character gitSha and gitTree")
    builder = builder_identity or read_builder_identity(repo_root=repo_root)
    if (
        builder.get("path") != BUILDER_PATH
        or not isinstance(builder.get("sha256"), str)
        or SHA256_PATTERN.fullmatch(builder["sha256"]) is None
    ):
        raise PagesArtifactAdmissionError("builder identity is incomplete")
    receipt = {
        "schemaVersion": ADMISSION_SCHEMA_VERSION,
        "status": "admitted",
        "runId": normalized_run_id,
        "source": dict(source),
        "builder": dict(builder),
        "artifact": {
            "root": selected_root.relative_to(repo_root.resolve()).as_posix(),
            "manifestPath": f"{selected_root.relative_to(repo_root.resolve()).as_posix()}/pages-dist-manifest.json",
            "manifestSha256": manifest["manifestSha256"],
            "treeSha256": snapshot["treeSha256"],
            "fileCount": snapshot["fileCount"],
            "totalBytes": snapshot["totalBytes"],
            "requiredFileCount": manifest["requiredFileCount"],
            "reachabilityAdmission": manifest["reachabilityAdmission"],
            "sizeGate": manifest["sizeGate"],
        },
        "publicSmoke": public_smoke,
    }
    receipt["receiptSha256"] = receipt_hash(receipt)
    return receipt


def validate_admission_receipt(receipt: dict[str, Any]) -> None:
    if receipt.get("schemaVersion") != ADMISSION_SCHEMA_VERSION or receipt.get("status") != "admitted":
        raise PagesArtifactAdmissionError("receipt is not an admitted current-schema artifact")
    if receipt.get("receiptSha256") != receipt_hash(receipt):
        raise PagesArtifactAdmissionError("receiptSha256 mismatch")
    artifact = receipt.get("artifact")
    if not isinstance(artifact, dict) or any(
        artifact.get(field) in (None, "")
        for field in (
            "root",
            "manifestPath",
            "manifestSha256",
            "treeSha256",
            "fileCount",
            "totalBytes",
            "requiredFileCount",
            "reachabilityAdmission",
            "sizeGate",
        )
    ):
        raise PagesArtifactAdmissionError("receipt artifact identity is incomplete")


def build_admission_summary(receipt: dict[str, Any]) -> dict[str, Any]:
    validate_admission_receipt(receipt)
    artifact = receipt["artifact"]
    return {
        "schemaVersion": SUMMARY_SCHEMA_VERSION,
        "status": receipt["status"],
        "runId": receipt["runId"],
        "gitSha": receipt["source"]["gitSha"],
        "gitTree": receipt["source"]["gitTree"],
        "builderSha256": receipt["builder"]["sha256"],
        "artifactRoot": artifact["root"],
        "manifestPath": artifact["manifestPath"],
        "manifestSha256": artifact["manifestSha256"],
        "treeSha256": artifact["treeSha256"],
        "fileCount": artifact["fileCount"],
        "totalBytes": artifact["totalBytes"],
        "requiredFileCount": artifact["requiredFileCount"],
        "reachabilityAdmission": artifact["reachabilityAdmission"],
        "sizeGate": artifact["sizeGate"],
        "publicSmoke": receipt["publicSmoke"],
        "receiptSha256": receipt["receiptSha256"],
    }


def verify_artifact_handoff(
    artifact_root: Path,
    receipt: dict[str, Any],
    *,
    expected_source_sha: str,
    repo_root: Path = ROOT,
) -> dict[str, Any]:
    """Verify the downloaded artifact itself before promoting an existing build."""
    validate_admission_receipt(receipt)
    if GIT_IDENTITY_PATTERN.fullmatch(expected_source_sha) is None:
        raise PagesArtifactAdmissionError("expected source SHA is required")
    if receipt.get("source", {}).get("gitSha") != expected_source_sha:
        raise PagesArtifactAdmissionError("artifact source SHA does not match the selected release")
    if receipt.get("publicSmoke") != "passed":
        raise PagesArtifactAdmissionError("artifact has no passing smoke receipt")
    selected_root = resolve_pages_artifact_root(
        artifact_root, repo_root=repo_root, allow_tracked_fallback=False, must_exist=True,
    )
    snapshot = build_tree_snapshot(selected_root)
    manifest = validate_pages_manifest(selected_root, snapshot)
    actual = {
        "treeSha256": snapshot["treeSha256"],
        "fileCount": snapshot["fileCount"],
        "totalBytes": snapshot["totalBytes"],
        "manifestSha256": manifest["manifestSha256"],
    }
    for field, value in actual.items():
        if receipt["artifact"].get(field) != value:
            raise PagesArtifactAdmissionError(f"downloaded artifact {field} mismatch")
    return build_admission_summary(receipt)


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Record compact Pages artifact build admission")
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--run-id")
    parser.add_argument("--verify-receipt", type=Path)
    parser.add_argument("--expected-source-sha")
    parser.add_argument("--public-smoke", choices=("not-run", "passed"), default="not-run")
    parser.add_argument("--receipt-out", type=Path)
    parser.add_argument("--summary-out", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        artifact_root = resolve_pages_artifact_root(
            args.artifact_root,
            allow_tracked_fallback=False,
            must_exist=True,
        )
        if args.verify_receipt:
            receipt_path = resolve_runtime_path(args.verify_receipt, label="Pages handoff receipt")
            result = verify_artifact_handoff(
                artifact_root, json.loads(receipt_path.read_text(encoding="utf-8")),
                expected_source_sha=str(args.expected_source_sha or ""),
            )
            print(json.dumps(result, sort_keys=True))
            return 0
        if not args.run_id or not args.receipt_out or not args.summary_out:
            raise PagesArtifactAdmissionError("recording requires run-id, receipt-out and summary-out")
        receipt_out = resolve_runtime_path(args.receipt_out, label="Pages admission receipt output")
        summary_out = resolve_runtime_path(args.summary_out, label="Pages admission summary output")
        receipt = build_admission_receipt(
            artifact_root,
            run_id=args.run_id,
            public_smoke=args.public_smoke,
        )
        write_json(receipt_out, receipt)
        write_json(summary_out, build_admission_summary(receipt))
        return 0
    except (OSError, ValueError, ShadowVerificationError, PagesArtifactAdmissionError) as exc:
        print(f"pages artifact admission failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
