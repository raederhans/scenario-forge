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
        self.write("apps/hgo/index.html", '<script type="module" src="./src/main.js"></script><link href="./styles.css" rel="stylesheet">')
        self.write("apps/hgo/src/main.js", 'export const title = "原生地图";')
        self.write("apps/hgo/styles.css", "body { color: white; }")

    def write(self, name, source):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")

    def check(self, registry=()):
        return checker.check_source_graph(self.root, dynamic_import_registry=registry)

    def test_deleted_resources_are_not_satisfied_by_stale_dist(self):
        path = self.root / "js/feature.mjs"
        target = "app/js/feature.mjs"
        self.write(f"dist/{target}", path.read_text(encoding="utf-8"))
        path.unlink()
        result = self.check()
        self.assertEqual("fail", result["status"])
        self.assertIn(target, [r.get("resolved_path") for r in result["unresolved_references"]])

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


if __name__ == "__main__":
    unittest.main()
