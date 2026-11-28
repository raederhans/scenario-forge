"""Supplement synchronization preserves evidence and unrelated ownership in fixtures."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


from tools import sync_marine_refinement as sync


class SyncMarineRefinementTests(unittest.TestCase):
    def setUp(self):
        temporary_root = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        temporary = TemporaryDirectory(dir=temporary_root)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.feature = {
            "type": "Feature", "properties": {
                "id": "tno_fixture_sea", "name": "Fixture Sea", "label": "Fixture Sea",
                "name_zh": "测试海", "source_layer": "seavox_v19", "source_query": "mrgid_sr='123'",
                "source_record_ids": ["mrgid_sr:123", "mrgid_sr:124"],
                "source_standard": "marine_regions_seavox_v19", "source_feature_count": 2,
                "source_url": "https://example.test/polygon", "source_simplify_degrees": 0.005,
            },
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]]},
        }
        marine = deepcopy(self.feature)
        marine["properties"]["id"] = "marine_fixture_sea"
        for name in ("additional", "refined"):
            self.write(f"data/marine_regions.{name}.source.geojson", {"features": [marine]})
        self.write("data/source_ledger.json", [
            {"local_path": f"data/marine_regions.{name}.source.geojson", "current_local_sha256": "old", "extension": name}
            for name in ("additional", "refined")
        ] + [{"local_path": "data/unrelated.bin", "current_local_sha256": "keep"}])
        self.write("data/locales.json", {"geo": {
            "Fixture Sea": {"en": "old", "zh": "old", "fr": "Mer"},
            "Unrelated": {"en": "Unrelated", "zh": "保留"},
        }, "ui": {"keep": "value"}, "extension": True})
        self.write("data/manifest.json", {"outputs": {
            "marine_regions.refined.source.geojson": {"owner": "source-builder", "extension": 1},
            "locales.json": {"owner": "locales-builder"},
            "unrelated.json": {"sha256": "keep"},
        }, "extension": True})
        self.write("data/scenarios/tno_1962/water_regions.geojson", {"features": [self.feature]})

    def write(self, relative, payload):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def read(self, relative):
        return sync.read(self.root / relative)

    def bytes(self):
        return {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*.json")}

    def test_shared_hashes_and_translations_are_scoped_and_idempotent(self):
        sync.sync_shared_source_metadata(self.root)
        ledger = self.read("data/source_ledger.json")
        for row in ledger[:2]:
            self.assertEqual(row["current_local_sha256"], hashlib.sha256(
                (self.root / row["local_path"]).read_bytes()).hexdigest())
            self.assertIn("extension", row)
        self.assertEqual(ledger[2], {"local_path": "data/unrelated.bin", "current_local_sha256": "keep"})
        locales = self.read("data/locales.json")
        self.assertEqual(locales["geo"]["Fixture Sea"], {"en": "Fixture Sea", "zh": "测试海", "fr": "Mer"})
        manifest = self.read("data/manifest.json")
        self.assertEqual(manifest["outputs"]["unrelated.json"], {"sha256": "keep"})
        self.assertEqual(manifest["outputs"]["locales.json"]["geo_entry_count"], 2)
        self.assertEqual(manifest["outputs"]["marine_regions.refined.source.geojson"]["extension"], 1)

    def test_repeated_shared_sync_preserves_file_bytes(self):
        sync.sync_shared_source_metadata(self.root)
        before = self.bytes()
        sync.sync_shared_source_metadata(self.root)
        self.assertEqual(self.bytes(), before)

    def test_missing_promoted_water_fails_before_metadata_writes(self):
        before = self.bytes()
        with self.assertRaisesRegex(ValueError, "Promote water geometry"):
            sync.sync_tno_source_metadata(self.root, [self.feature], [{"id": "missing"}])
        self.assertEqual(self.bytes(), before)


if __name__ == "__main__":
    unittest.main()
