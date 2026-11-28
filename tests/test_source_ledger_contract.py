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


def _ledger_entry(source_id, local_path, provenance_sidecar, *, status, local_sha=""):
    return {
        "source_id": source_id,
        "local_path": local_path,
        "origin_kind": "download",
        "upstream_url": "https://example.test/source.geojson",
        "immutable_ref": "fixture",
        "current_local_sha256": local_sha,
        "license": "",
        "citation": "https://example.test",
        "consumers": ["consumer.py"],
        "rebuild_command": "python fixture.py",
        "provenance_sidecar": provenance_sidecar,
        "status": status,
        "local_presence": "required",
    }


class SourceLedgerContractTest(unittest.TestCase):
    def test_checked_in_source_ledger_entries_keep_required_checker_fields(self) -> None:
        payload = json.loads((REPO_ROOT / "data/source_ledger.json").read_text(encoding="utf-8"))
        seen_ids: set[str] = set()

        for entry in payload:
            self.assertTrue(REQUIRED_FIELDS.issubset(entry), entry.get("source_id"))
            self.assertNotIn(entry["source_id"], seen_ids)
            seen_ids.add(entry["source_id"])
            self.assertIn(entry["status"], ALLOWED_STATUS)
            self.assertIn(entry["local_presence"], ALLOWED_LOCAL_PRESENCE)

    def test_missing_required_and_optional_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            (project_root / "consumer.py").write_text("# fixture\n", encoding="utf-8")
            entry = _ledger_entry(
                source_id="fixture_required_pending",
                local_path="data/missing.geojson",
                provenance_sidecar="data/missing.provenance.json",
                status="pending_upgrade_review",
            )

            report = validate_source_ledger_entries([entry], project_root=project_root)

            self.assertEqual(report["warnings"], [])
            self.assertEqual(report["validated_entries"], 0)
            self.assertIn("[fixture_required_pending] missing local_path=", report["failures"][0])
            entry["local_presence"] = "optional_cache"
            report = validate_source_ledger_entries([entry], project_root=project_root)
            self.assertEqual(report["failures"], [])
            self.assertEqual(report["validated_entries"], 0)
            self.assertIn("[fixture_required_pending] missing optional local_path=", report["warnings"][0])

    def test_existing_local_source_validates_hash_and_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            (project_root / "consumer.py").write_text("# fixture\n", encoding="utf-8")
            payload = b'{"type":"FeatureCollection","features":[]}\n'
            local_path = project_root / "data/source.geojson"
            local_path.parent.mkdir()
            provenance_path = project_root / "data/source.provenance.json"
            local_path.write_bytes(payload)
            local_sha = hashlib.sha256(payload).hexdigest()
            provenance_path.write_text(json.dumps({"sha256": local_sha}), encoding="utf-8")
            entry = _ledger_entry(
                source_id="fixture_checked_in",
                local_path="data/source.geojson",
                local_sha=local_sha,
                provenance_sidecar="data/source.provenance.json",
                status="frozen_verified",
            )

            report = validate_source_ledger_entries([entry], project_root=project_root)

            self.assertEqual(report["failures"], [])
            self.assertEqual(report["warnings"], [])
            self.assertEqual(report["validated_entries"], 1)


if __name__ == "__main__":
    unittest.main()
