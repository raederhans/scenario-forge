from __future__ import annotations

import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import build_pages_dist as pages
from tools import check_pages_source_graph as source_graph


class PagesDistSlimTests(unittest.TestCase):
    def setUp(self):
        runtime = pages.ROOT / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.app = self.root / "output/app"
        self.scenarios = self.app / "data/scenarios"
        for name, value in (("ROOT", self.root), ("APP_DIST_ROOT", self.app)):
            patcher = patch.object(pages, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.write("data/scenarios/index.json", {"scenarios": [{
            "scenario_id": "sample", "manifest_url": "data/scenarios/sample/manifest.json",
        }]})
        self.write("data/scenarios/sample/manifest.json", {
            "startup_bundle_url_en": "data/scenarios/sample/startup.bundle.en.json",
        })
        self.bundle = self.root / "data/scenarios/sample/startup.bundle.en.json"
        self.bundle.write_bytes(b'{"manifest_subset":{},"value":12345678901234567890}')

    def write(self, relative, payload):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def compress_bundle(self):
        self.bundle.with_suffix(".json.gz").write_bytes(gzip.compress(self.bundle.read_bytes(), mtime=0))

    def test_compressed_bundle_only_is_published_byte_exact(self):
        original = self.bundle.read_bytes()
        self.compress_bundle()
        pages.copy_runtime_data()
        published = self.scenarios / "sample/startup.bundle.en.json"
        self.assertFalse(published.exists())
        self.assertEqual(original, gzip.decompress(published.with_suffix(".json.gz").read_bytes()))
        manifest = json.loads((published.parent / "manifest.json").read_bytes())
        self.assertEqual("data/scenarios/sample/startup.bundle.en.json", manifest["startup_bundle_url_en"])

    def test_plain_bundle_without_gzip_is_preserved(self):
        pages.copy_runtime_data()
        self.assertEqual(self.bundle.read_bytes(), (self.scenarios / "sample/startup.bundle.en.json").read_bytes())

    def test_gzip_url_validation_rejects_missing_bundle_and_subset_resource(self):
        self.compress_bundle()
        pages.copy_runtime_data()
        pages.validate_dist_scenario_startup_urls()
        published = self.scenarios / "sample/startup.bundle.en.json.gz"
        published.write_bytes(gzip.compress(json.dumps({"manifest_subset": {
            "owners_url": "data/scenarios/sample/missing.json",
        }}).encode()))
        with self.assertRaisesRegex(FileNotFoundError, "missing.json"):
            pages.validate_dist_scenario_startup_urls()
        published.unlink()
        with self.assertRaisesRegex(FileNotFoundError, "startup.bundle.en.json"):
            pages.validate_dist_scenario_startup_urls()

    def test_audit_rewrite_updates_gzip_without_restoring_plaintext(self):
        self.bundle.write_text(json.dumps({"manifest_subset": {"audit_url": "data/scenarios/sample/audit.json"}}))
        self.compress_bundle()
        pages.copy_runtime_data()
        published = self.scenarios / "sample/startup.bundle.en.json.gz"
        self.assertNotIn("audit_url", json.loads(gzip.decompress(published.read_bytes()))["manifest_subset"])
        published.write_bytes(gzip.compress(self.bundle.read_bytes()))
        pages.strip_scenario_publish_audit_urls(self.scenarios)
        self.assertNotIn("audit_url", json.loads(gzip.decompress(published.read_bytes()))["manifest_subset"])
        self.assertFalse(published.with_suffix("").exists())

    def test_build_only_files_and_metadata_are_excluded(self):
        excluded = (
            "data/scenario-rules/sample.manual.json",
            "data/palette-maps/sample.audit.json",
            "data/thematic_layers/sample/audit.json",
            "data/thematic_layers/sample/build_audit.json",
            "data/scenarios/tno_1962/scenario_mutations.json",
        )
        for relative in excluded:
            self.write(relative, {})
        self.write("data/thematic_layers/sample/manifest.json", {
            "audit_url": excluded[2], "build_audit_path": excluded[3],
            "paths": {"build_audit": excluded[3], "data": "data/thematic_layers/sample/values.json"},
        })
        self.write("data/thematic_layers/sample/values.json", {"value": 7})
        self.write("data/CATALOG.json", {"entries": [{"url": path} for path in excluded]})
        self.write("data/runtime_asset_registry.json", {"assets": {str(i): {"url": path} for i, path in enumerate(excluded)}})
        self.write("data/manifest.json", {"outputs": {path.removeprefix("data/"): {} for path in excluded}})
        pages.copy_runtime_data()
        for relative in excluded:
            self.assertFalse((self.app / relative).exists(), relative)
        manifest = json.loads((self.app / "data/thematic_layers/sample/manifest.json").read_bytes())
        self.assertNotIn("audit_url", manifest)
        self.assertNotIn("build_audit_path", manifest)
        self.assertEqual({"data": "data/thematic_layers/sample/values.json"}, manifest["paths"])
        self.assertEqual([], json.loads((self.app / "data/CATALOG.json").read_bytes())["entries"])
        self.assertEqual({}, json.loads((self.app / "data/runtime_asset_registry.json").read_bytes())["assets"])
        self.assertEqual({}, json.loads((self.app / "data/manifest.json").read_bytes())["outputs"])

    def test_source_inventory_tracks_compressed_publication(self):
        self.compress_bundle()
        self.write("index.html", {})
        self.write("landing/index.html", {})
        inventory = source_graph.build_source_inventory(self.root)
        self.assertIn("app/data/scenarios/sample/startup.bundle.en.json.gz", inventory)
        self.assertNotIn("app/data/scenarios/sample/startup.bundle.en.json", inventory)


if __name__ == "__main__":
    unittest.main()
