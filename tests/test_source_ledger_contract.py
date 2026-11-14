from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tools.check_source_ledger import (
    ALLOWED_LOCAL_PRESENCE,
    ALLOWED_STATUS,
    REQUIRED_FIELDS,
    validate_source_ledger_entries,
)


REPO_ROOT = Path(__file__).resolve().parents[1]


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _ledger_entry(
    *,
    source_id: str,
    local_path: str,
    local_sha: str,
    provenance_sidecar: str,
    status: str,
    local_presence: str,
    consumers: list[str],
) -> dict[str, object]:
    return {
        "source_id": source_id,
        "local_path": local_path,
        "origin_kind": "download",
        "upstream_url": "https://example.test/source.geojson",
        "immutable_ref": "fixture",
        "current_local_sha256": local_sha,
        "license": "",
        "citation": "https://example.test",
        "consumers": consumers,
        "rebuild_command": "python fixture.py",
        "provenance_sidecar": provenance_sidecar,
        "status": status,
        "local_presence": local_presence,
    }


class SourceLedgerContractTest(unittest.TestCase):
    def test_pending_upgrade_review_missing_local_source_warns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            consumer_path = project_root / "consumer.py"
            consumer_path.write_text("# fixture\n", encoding="utf-8")
            entry = _ledger_entry(
                source_id="fixture_pending",
                local_path="data/missing.geojson",
                local_sha="",
                provenance_sidecar="data/missing.provenance.json",
                status="pending_upgrade_review",
                local_presence="optional_cache",
                consumers=["consumer.py"],
            )

            report = validate_source_ledger_entries([entry], project_root=project_root)

            self.assertEqual(report["failures"], [])
            self.assertEqual(report["validated_entries"], 0)
            self.assertIn("[fixture_pending] missing optional local_path=", report["warnings"][0])

    def test_frozen_local_only_optional_cache_missing_source_warns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            consumer_path = project_root / "consumer.py"
            consumer_path.write_text("# fixture\n", encoding="utf-8")
            entry = _ledger_entry(
                source_id="fixture_hgo_optional",
                local_path="historic geographic overhaul/descriptor.mod",
                local_sha="",
                provenance_sidecar="data/hgo_catalogs/index.provenance.json",
                status="frozen_local_only",
                local_presence="optional_cache",
                consumers=["consumer.py"],
            )

            report = validate_source_ledger_entries([entry], project_root=project_root)

            self.assertEqual(report["failures"], [])
            self.assertEqual(report["validated_entries"], 0)
            self.assertIn("[fixture_hgo_optional] missing optional local_path=", report["warnings"][0])

    def test_checked_in_source_ledger_entries_keep_required_checker_fields(self) -> None:
        payload = json.loads((REPO_ROOT / "data/source_ledger.json").read_text(encoding="utf-8"))
        seen_ids: set[str] = set()

        for entry in payload:
            self.assertTrue(REQUIRED_FIELDS.issubset(entry), entry.get("source_id"))
            self.assertNotIn(entry["source_id"], seen_ids)
            seen_ids.add(entry["source_id"])
            self.assertIn(entry["status"], ALLOWED_STATUS)
            self.assertIn(entry["local_presence"], ALLOWED_LOCAL_PRESENCE)

    def test_frozen_verified_missing_local_source_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            consumer_path = project_root / "consumer.py"
            consumer_path.write_text("# fixture\n", encoding="utf-8")
            entry = _ledger_entry(
                source_id="fixture_frozen",
                local_path="data/missing.geojson",
                local_sha="",
                provenance_sidecar="data/missing.provenance.json",
                status="frozen_verified",
                local_presence="required",
                consumers=["consumer.py"],
            )

            report = validate_source_ledger_entries([entry], project_root=project_root)

            self.assertEqual(report["warnings"], [])
            self.assertEqual(report["validated_entries"], 0)
            self.assertIn("[fixture_frozen] missing local_path=", report["failures"][0])

    def test_pending_upgrade_review_required_local_source_fails_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            consumer_path = project_root / "consumer.py"
            consumer_path.write_text("# fixture\n", encoding="utf-8")
            entry = _ledger_entry(
                source_id="fixture_required_pending",
                local_path="data/missing.geojson",
                local_sha="",
                provenance_sidecar="data/missing.provenance.json",
                status="pending_upgrade_review",
                local_presence="required",
                consumers=["consumer.py"],
            )

            report = validate_source_ledger_entries([entry], project_root=project_root)

            self.assertEqual(report["warnings"], [])
            self.assertEqual(report["validated_entries"], 0)
            self.assertIn("[fixture_required_pending] missing local_path=", report["failures"][0])

    def test_existing_local_source_validates_hash_and_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            data_root = project_root / "data"
            data_root.mkdir()
            consumer_path = project_root / "consumer.py"
            consumer_path.write_text("# fixture\n", encoding="utf-8")
            payload = b'{"type":"FeatureCollection","features":[]}\n'
            local_path = data_root / "source.geojson"
            provenance_path = data_root / "source.provenance.json"
            local_path.write_bytes(payload)
            local_sha = _sha256_bytes(payload)
            provenance_path.write_text(json.dumps({"sha256": local_sha}), encoding="utf-8")
            entry = _ledger_entry(
                source_id="fixture_checked_in",
                local_path="data/source.geojson",
                local_sha=local_sha,
                provenance_sidecar="data/source.provenance.json",
                status="frozen_verified",
                local_presence="required",
                consumers=["consumer.py"],
            )

            report = validate_source_ledger_entries([entry], project_root=project_root)

            self.assertEqual(report["failures"], [])
            self.assertEqual(report["warnings"], [])
            self.assertEqual(report["validated_entries"], 1)


if __name__ == "__main__":
    unittest.main()
