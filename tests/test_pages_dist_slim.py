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

    def test_tno_standalone_water_is_lossless_from_both_manifests(self):
        base = "data/scenarios/tno_1962"
        url = f"{base}/water_regions.geojson"
        source = self.write(url, {"type": "FeatureCollection", "features": []})
        self.write(f"{base}/manifest.json", {"water_regions_url": url})
        self.write(f"{base}/startup.bundle.en.json", {"manifest_subset": {"water_regions_url": url}})
        pages.copy_runtime_data()
        manifest = json.loads((self.app / base / "manifest.json").read_bytes())
        bundle = json.loads((self.app / base / "startup.bundle.en.json").read_bytes())
        self.assertEqual(bundle["manifest_subset"]["water_regions_url"], manifest["water_regions_url"])
        self.assertEqual(manifest["water_regions_url"], url + ".gz")
        self.assertEqual(gzip.decompress((self.app / manifest["water_regions_url"]).read_bytes()), source.read_bytes())
        self.assertFalse((self.app / url).exists())
        self.write("index.html", {})
        self.write("landing/index.html", {})
        inventory = source_graph.build_source_inventory(self.root)
        self.assertEqual(inventory[f"app/{url}.gz"], source)
        self.assertNotIn(f"app/{url}", inventory)

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


if __name__ == "__main__":
    unittest.main()
