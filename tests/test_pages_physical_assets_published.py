from __future__ import annotations

import json
import unittest

from tools import build_pages_dist as pages


class PagesPhysicalAssetsPublishedTests(unittest.TestCase):
    def test_registered_physical_layer_assets_are_in_the_pages_runtime_file_list(self):
        registry = json.loads((pages.ROOT / "data/runtime_asset_registry.json").read_text(encoding="utf-8"))
        physical_urls = {
            key: asset["url"]
            for key, asset in registry["assets"].items()
            if key.startswith("context_layer:physical")
        }
        self.assertGreaterEqual(len(physical_urls), 4)
        published = set(pages.DATA_RUNTIME_FILES)
        for key, url in physical_urls.items():
            with self.subTest(asset=key):
                self.assertTrue(url.startswith("data/"), url)
                self.assertIn(url.removeprefix("data/"), published)


if __name__ == "__main__":
    unittest.main()
