#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.transport_workbench_contracts import validate_transport_manifest


DEFAULT_ROOT = PROJECT_ROOT / "data" / "transport_layers"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate transport workbench manifest contracts.")
    parser.add_argument(
        "--root",
        default=str(DEFAULT_ROOT),
        help="Directory containing transport layer subdirectories.",
    )
    parser.add_argument(
        "--manifest",
        action="append",
        default=[],
        help="Explicit manifest path. Can be supplied more than once.",
    )
    parser.add_argument(
        "--report-path",
        default="",
        help="Optional JSON report output path.",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def discover_manifest_paths(root: Path) -> list[Path]:
    resolved_root = root.resolve()
    return sorted(path.resolve() for path in resolved_root.glob("*/manifest.json") if path.is_file())


def inspect_transport_manifests(manifest_paths: list[Path]) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for path in manifest_paths:
        errors: list[str] = []
        try:
            manifest = load_json(path)
        except Exception as exc:  # pragma: no cover - exercised through CLI error surface
            errors.append(str(exc))
            reports.append(
                {
                    "manifest_path": str(path.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                    "status": "failed",
                    "errors": errors,
                }
            )
            continue

        errors.extend(
            validate_transport_manifest(
                manifest,
                source_label=str(path.relative_to(PROJECT_ROOT)).replace("\\", "/"),
            )
        )
        reports.append(
            {
                "manifest_path": str(path.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                "family": manifest.get("family"),
                "status": "failed" if errors else "ok",
                "errors": errors,
            }
        )
    return reports


def write_report(report_path: Path, reports: list[dict[str, Any]]) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps({"reports": reports}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    args = parse_args()
    explicit_manifest_paths = [Path(raw_path).resolve() for raw_path in args.manifest]
    manifest_paths = explicit_manifest_paths or discover_manifest_paths(Path(args.root))
    reports = inspect_transport_manifests(manifest_paths)
    if args.report_path:
        write_report(Path(args.report_path), reports)

    failed_reports = [report for report in reports if report.get("status") != "ok"]
    if failed_reports:
        print("[transport-contract] FAILED")
        for report in failed_reports:
            print(f"- {report['manifest_path']}")
            for error in report.get("errors", []):
                print(f"  - {error}")
        return 1

    print("[transport-contract] OK")
    for report in reports:
        print(f"- {report['manifest_path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
