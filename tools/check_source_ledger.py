"""Validate the checked-in source ledger against local files and sidecars."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
LEDGER_PATH = DATA_DIR / "source_ledger.json"

ALLOWED_ORIGIN_KINDS = {"download", "api_export", "manual_import"}
ALLOWED_STATUS = {"frozen_verified", "frozen_local_only", "pending_upgrade_review"}
REQUIRED_FIELDS = {
    "source_id",
    "local_path",
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


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    if not LEDGER_PATH.exists():
        raise SystemExit(f"Missing source ledger: {LEDGER_PATH}")
    payload = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise SystemExit("source_ledger.json must contain a non-empty list.")

    failures: list[str] = []
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

        local_path = PROJECT_ROOT / str(entry["local_path"])
        if not local_path.exists():
            failures.append(f"[{source_id}] missing local_path={local_path}")
            continue
        local_sha = _sha256_path(local_path)
        if str(entry["current_local_sha256"]) != local_sha:
            failures.append(
                f"[{source_id}] current_local_sha256 mismatch: "
                f"{entry['current_local_sha256']} != {local_sha}"
            )

        provenance_path = PROJECT_ROOT / str(entry["provenance_sidecar"])
        if not provenance_path.exists():
            failures.append(f"[{source_id}] missing provenance_sidecar={provenance_path}")
        else:
            provenance_payload = json.loads(provenance_path.read_text(encoding="utf-8"))
            if str(provenance_payload.get("sha256") or "") != local_sha:
                failures.append(
                    f"[{source_id}] provenance sha256 mismatch: "
                    f"{provenance_payload.get('sha256')} != {local_sha}"
                )

        consumers = entry["consumers"]
        if not isinstance(consumers, list) or not consumers:
            failures.append(f"[{source_id}] consumers must be a non-empty list")
        else:
            for consumer in consumers:
                consumer_path = PROJECT_ROOT / str(consumer)
                if not consumer_path.exists():
                    failures.append(f"[{source_id}] missing consumer path={consumer_path}")

    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        raise SystemExit(1)

    print(f"[source-ledger] OK: {len(payload)} entries validated.")


if __name__ == "__main__":
    main()
