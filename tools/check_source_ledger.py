"""Validate the checked-in source ledger against local files and sidecars."""
from __future__ import annotations

import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.precision_build_support import sha256_file as _sha256_path


DATA_DIR = PROJECT_ROOT / "data"
LEDGER_PATH = DATA_DIR / "source_ledger.json"

ALLOWED_ORIGIN_KINDS = {"download", "api_export", "manual_import"}
ALLOWED_STATUS = {"frozen_verified", "frozen_local_only", "pending_upgrade_review"}
ALLOWED_LOCAL_PRESENCE = {"required", "optional_cache"}
MISSING_LOCAL_ALLOWED_PRESENCE = {"optional_cache"}
REQUIRED_FIELDS = {
    "source_id",
    "local_path",
    "local_presence",
    "origin_kind",
    "upstream_url",
    "immutable_ref",
    "current_local_sha256",
    "license",
    "citation",
    "consumers",
    "rebuild_command",
    "provenance_sidecar",
    "status",
}


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def validate_source_ledger_entries(payload: list[object], *, project_root: Path) -> dict[str, object]:
    failures: list[str] = []
    warnings: list[str] = []
    validated_entries = 0
    seen_ids: set[str] = set()
    for entry in payload:
        if not isinstance(entry, dict):
            failures.append("Ledger entry must be an object.")
            continue
        missing = sorted(REQUIRED_FIELDS.difference(entry))
        if missing:
            failures.append(f"Entry missing required fields: {missing}")
            continue
        source_id = str(entry["source_id"])
        if source_id in seen_ids:
            failures.append(f"[{source_id}] duplicate source_id")
            continue
        seen_ids.add(source_id)

        origin_kind = str(entry["origin_kind"])
        if origin_kind not in ALLOWED_ORIGIN_KINDS:
            failures.append(f"[{source_id}] invalid origin_kind={origin_kind}")
        status = str(entry["status"])
        if status not in ALLOWED_STATUS:
            failures.append(f"[{source_id}] invalid status={status}")
        local_presence = str(entry["local_presence"])
        if local_presence not in ALLOWED_LOCAL_PRESENCE:
            failures.append(f"[{source_id}] invalid local_presence={local_presence}")

        consumers = entry["consumers"]
        if not isinstance(consumers, list) or not consumers:
            failures.append(f"[{source_id}] consumers must be a non-empty list")
        else:
            for consumer in consumers:
                consumer_path = project_root / str(consumer)
                if not consumer_path.exists():
                    failures.append(f"[{source_id}] missing consumer path={consumer_path}")

        local_path = project_root / str(entry["local_path"])
        if not local_path.exists():
            if local_presence in MISSING_LOCAL_ALLOWED_PRESENCE:
                warnings.append(f"[{source_id}] missing optional local_path={local_path}")
                continue
            failures.append(f"[{source_id}] missing local_path={local_path}")
            continue
        local_sha = _sha256_path(local_path)
        if str(entry["current_local_sha256"]) != local_sha:
            failures.append(
                f"[{source_id}] current_local_sha256 mismatch: "
                f"{entry['current_local_sha256']} != {local_sha}"
            )

        provenance_path = project_root / str(entry["provenance_sidecar"])
        if not provenance_path.exists():
            failures.append(f"[{source_id}] missing provenance_sidecar={provenance_path}")
        else:
            provenance_payload = _read_json(provenance_path)
            if str(provenance_payload.get("sha256") or "") != local_sha:
                failures.append(
                    f"[{source_id}] provenance sha256 mismatch: "
                    f"{provenance_payload.get('sha256')} != {local_sha}"
                )
        validated_entries += 1

    return {
        "failures": failures,
        "warnings": warnings,
        "validated_entries": validated_entries,
        "total_entries": len(payload),
    }


def main() -> None:
    if not LEDGER_PATH.exists():
        raise SystemExit(f"Missing source ledger: {LEDGER_PATH}")
    payload = _read_json(LEDGER_PATH)
    if not isinstance(payload, list) or not payload:
        raise SystemExit("source_ledger.json must contain a non-empty list.")

    report = validate_source_ledger_entries(payload, project_root=PROJECT_ROOT)
    failures = report["failures"]
    warnings = report["warnings"]
    if failures:
        for warning in warnings:
            print(f"WARN {warning}", file=sys.stderr)
        for failure in failures:
            print(failure, file=sys.stderr)
        raise SystemExit(1)

    for warning in warnings:
        print(f"WARN {warning}")
    print(
        "[source-ledger] OK: "
        f"{report['validated_entries']} entries validated, "
        f"{len(warnings)} optional local sources warned, "
        f"{report['total_entries']} total ledger entries."
    )


if __name__ == "__main__":
    main()
