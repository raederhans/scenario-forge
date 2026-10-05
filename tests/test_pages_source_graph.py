from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import check_pages_source_graph as checker


class PagesSourceGraphTests(unittest.TestCase):
    def setUp(self):
        fixture_parent = checker.ROOT / ".runtime/tmp/pages-source-fixtures"
        fixture_parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="源码-", dir=fixture_parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {
            "MAPCREATOR_LANDING_ENTRY": "", "MAPCREATOR_LANDING_SOURCE": "",
            "MAPCREATOR_EDITOR_ENTRY": "", "MAPCREATOR_EDITOR_SOURCE": "",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.write("landing/index.html", '<script src="app.mjs" type="module"></script><link href="styles.css" rel="stylesheet">')
        self.write("landing/app.mjs", 'import "./展示.mjs";')
        self.write("landing/展示.mjs", 'export const title = "地图";')
        self.write("landing/styles.css", '@import "theme.css"; a { background: url("assets/地图.svg"); }')
        self.write("landing/theme.css", "/* url(missing.svg) */ a::after { content: 'url(missing.svg)'; }")
        self.write("landing/assets/地图.svg", "<svg/>")
        self.write("index.html", '<script type="module" src="js/main.js"></script>')
        self.write("js/main.js", 'import "./feature.mjs"; import("./lazy.js"); new URL("../data/CATALOG.json", import.meta.url);')
        self.write("js/feature.mjs", "export const value = 1;")
        self.write("js/lazy.js", "export default 1;")
        self.write("data/CATALOG.json", "{}")

    def write(self, name, source):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")

    def check(self, registry=()):
        return checker.check_source_graph(self.root, dynamic_import_registry=registry)

    def test_real_parser_unicode_and_read_only_without_dist(self):
        before = {p.relative_to(self.root): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob("*") if p.is_file()}
        result = self.check()
        self.assertEqual("pass", result["status"], result)
        self.assertEqual(5, result["javascript_file_count"])
        self.assertEqual(2, result["css_file_count"])
        after = {p.relative_to(self.root): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        self.assertFalse((self.root / "dist").exists())

    def test_deleted_resources_are_not_satisfied_by_stale_dist(self):
        cases = [
            ("js/feature.mjs", "app/js/feature.mjs"),
            ("js/lazy.js", "app/js/lazy.js"),
            ("landing/展示.mjs", "展示.mjs"),
            ("landing/app.mjs", "app.mjs"),
            ("landing/theme.css", "theme.css"),
            ("landing/assets/地图.svg", "assets/地图.svg"),
            ("data/CATALOG.json", "app/data/CATALOG.json"),
        ]
        for source, target in cases:
            with self.subTest(source=source):
                path = self.root / source
                original = path.read_text(encoding="utf-8")
                self.write(f"dist/{target}", original)
                path.unlink()
                try:
                    result = self.check()
                    self.assertEqual("fail", result["status"])
                    self.assertIn(target, [r.get("resolved_path") for r in result["unresolved_references"]])
                finally:
                    self.write(source, original)

    def test_unregistered_expression_in_landing_is_rejected(self):
        self.write("landing/app.mjs", "const name = './展示.mjs'; import(name);")
        result = self.check()
        self.assertEqual("fail", result["status"])
        self.assertTrue(any(r["kind"] == "unresolved_dynamic_expression" for r in result["unresolved_references"]))

    def test_registered_expression_and_missing_target(self):
        self.write("js/main.js", 'const MODULES = ["./lazy.js"]; for (const path of MODULES) import(path);')
        registry = [{"id": "fixture", "source": "app/js/main.js", "expression_index": 0,
                     "expected_expression": "path", "source_binding": "MODULES",
                     "source_binding_resolution": "module-relative", "targets": ["app/js/lazy.js"]}]
        self.assertEqual("pass", self.check(registry)["status"])
        (self.root / "js/lazy.js").unlink()
        self.assertEqual("fail", self.check(registry)["status"])

    def test_css_escapes_imports_and_external_urls(self):
        self.write("landing/styles.css", r'''@IMPORT url("theme.css") layer(base);
        a {background: u\72l(assets/地图.svg); mask: url(data:image/svg+xml;base64,AAAA);}
        b {background: url(https://example.com/image.png); filter: url(#local);}
        c::after {content: "url(missing.png)";} /* @import 'absent.css'; */''')
        self.assertEqual("pass", self.check()["status"])
        self.write("landing/theme.css", '@import "missing.css";')
        self.assertEqual("fail", self.check()["status"])

    def test_inventory_uses_publication_policy_and_copy_precedence(self):
        self.write("app/index.html", '<script src="js/main.js" type="module"></script>')
        self.write("app/js/main.js", 'import "./absent.js";')
        self.write("data/scenarios/demo/manifest.json", '{"detail_chunk_manifest_url":"chunks.json"}')
        self.write("data/scenarios/demo/runtime_topology.topo.json", "large data")
        self.write("data/scenarios/demo/chunks.json", "{}")
        self.write("data/scenarios/demo/audit.json", "{}")
        self.write("data/private.json", "{}")
        self.write("data/transport_layers/demo/carrier.json", "{}")
        self.write("data/transport_layers/demo/full.geojson", "{}")
        inventory = checker.build_source_inventory(self.root)
        self.assertEqual(self.root / "js/main.js", inventory["app/js/main.js"])
        self.assertIn("app/data/scenarios/demo/chunks.json", inventory)
        self.assertIn("app/data/transport_layers/demo/carrier.json", inventory)
        for name in ("scenarios/demo/runtime_topology.topo.json", "scenarios/demo/audit.json", "private.json", "transport_layers/demo/full.geojson"):
            self.assertNotIn(f"app/data/{name}", inventory)

    def test_non_code_data_is_never_read(self):
        read_text = Path.read_text
        def guarded_read(path, *args, **kwargs):
            if path == self.root / "data/CATALOG.json":
                raise AssertionError("source checker read data body")
            return read_text(path, *args, **kwargs)
        with patch.object(Path, "read_text", guarded_read):
            self.assertEqual("pass", self.check()["status"])


if __name__ == "__main__":
    unittest.main()
