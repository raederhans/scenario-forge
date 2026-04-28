from __future__ import annotations

import re
import unittest
import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
LANDING_INDEX = REPO_ROOT / "landing" / "index.html"
LANDING_APP_JS = REPO_ROOT / "landing" / "app.js"
LANDING_STYLES_CSS = REPO_ROOT / "landing" / "styles.css"
DIST_ROOT_INDEX = REPO_ROOT / "dist" / "index.html"
DIST_APP_JS = REPO_ROOT / "dist" / "app.js"
DIST_STYLES_CSS = REPO_ROOT / "dist" / "styles.css"
DIST_APP_INDEX = REPO_ROOT / "dist" / "app" / "index.html"
DIST_MANIFEST = REPO_ROOT / "dist" / "pages-dist-manifest.json"
VERIFY_SHARED_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "verify-shared.yml"


class PagesDistStartupShellTest(unittest.TestCase):

    def test_landing_source_keeps_landing_contract(self) -> None:
        html = LANDING_INDEX.read_text(encoding="utf-8")
        app_js = LANDING_APP_JS.read_text(encoding="utf-8")
        styles_css = LANDING_STYLES_CSS.read_text(encoding="utf-8")

        for expected_fragment in (
            './styles.css',
            './app.js',
            './app/?view=guide',
            'data-i18n="heroTitle"',
            'data-i18n="heroTitleAccent"',
            'data-i18n="productStageLabel"',
            'data-i18n-aria-label="heroMetricsLabel"',
            'data-i18n-aria-label="productPreviewLabel"',
            'data-i18n-aria-label="brandHomeLabel"',
            'data-i18n-aria-label="primaryNavLabel"',
            'data-i18n-aria-label="languageSwitcherLabel"',
            'data-i18n-alt="productPreviewAlt"',
            'data-i18n-alt="workOneAlt"',
            'data-i18n-alt="workTwoAlt"',
            'data-i18n-alt="workThreeAlt"',
            'data-i18n="chipBlank"',
            'data-i18n="chipModern"',
            'data-reveal',
            'footer',
            'data-lang="zh"',
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, html)

        for expected_fragment in (
            "scenario_forge_landing_lang",
            "heroTitleAccent",
            "heroMetricsLabel",
            "productPreviewLabel",
            "productStageLabel",
            "brandHomeLabel",
            "languageSwitcherLabel",
            "productPreviewAlt",
            "data-i18n-alt",
            "data-i18n-aria-label",
            "zh:",
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, app_js)

        self.assertIn("prefers-reduced-motion", styles_css)
        self.assertIn('html[data-reveal="enabled"]', styles_css)
        self.assertIn(".is-revealed", styles_css)

    def test_landing_i18n_table_keeps_english_and_chinese_values_separate(self) -> None:
        app_js = LANDING_APP_JS.read_text(encoding="utf-8")
        en_start = app_js.index("  en: {")
        zh_start = app_js.index("  zh: {")
        en_table = app_js[en_start:zh_start]
        zh_table = app_js[zh_start:]

        for expected_fragment in (
            'featureGroupOneTitle: "Scenario baselines"',
            'featureGroupTwoTitle: "Political editing"',
            'featureGroupThreeTitle: "Presentation layers"',
            'featureGroupFourTitle: "Project and export"',
            'roadmapOneTitle: "Transport workbench"',
            'roadmapTwoTitle: "Japan road preview"',
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, en_table)

        for expected_fragment in (
            'featureGroupOneTitle: "场景基线"',
            'featureGroupTwoTitle: "政治编辑"',
            'featureGroupThreeTitle: "展示图层"',
            'featureGroupFourTitle: "项目与导出"',
            'workflowTitle: "从基线到可讲故事地图，一条更短的路。"',
            'audienceTitle: "适合那些需要让地图承载场景的人。"',
            'roadmapOneTitle: "交通工作台"',
            'roadmapTwoTitle: "日本道路预览"',
            'roadmapTwoBody: "目前是交通相关样例里最成熟的一块。"',
            'ctaBody: "展示页负责讲清楚产品，编辑器负责真正把场景落到地图上。"',
            'metaTitle: "Scenario Forge — 场景优先政治地图工作台"',
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, zh_table)

        for stale_fragment in ("baseline", "scenario", "Scenario-first", "transport"):
            with self.subTest(stale_fragment=stale_fragment):
                self.assertNotIn(stale_fragment, zh_table)

    def test_dist_root_index_keeps_landing_startup_contract(self) -> None:
        if not DIST_ROOT_INDEX.exists():
            self.skipTest("dist/index.html is only available after build_pages_dist runs")
        html = DIST_ROOT_INDEX.read_text(encoding="utf-8")

        for expected_fragment in (
            "./styles.css",
            "./app.js",
            "./app/?view=guide",
            'data-i18n="heroTitle"',
            'data-i18n="heroTitleAccent"',
            'data-i18n="productStageLabel"',
            'data-i18n-aria-label="heroMetricsLabel"',
            'data-i18n-aria-label="productPreviewLabel"',
            'data-i18n-aria-label="brandHomeLabel"',
            'data-i18n-aria-label="primaryNavLabel"',
            'data-i18n-aria-label="languageSwitcherLabel"',
            'data-i18n-alt="productPreviewAlt"',
            'data-i18n-alt="workOneAlt"',
            'data-i18n="workOneTitle"',
            'data-i18n="ctaPrimary"',
            "data-reveal",
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, html)

    def test_dist_app_js_keeps_landing_i18n_contract(self) -> None:
        if not DIST_APP_JS.exists():
            self.skipTest("dist/app.js is only available after build_pages_dist runs")
        app_js = DIST_APP_JS.read_text(encoding="utf-8")

        for expected_fragment in (
            "scenario_forge_landing_lang",
            "heroTitle",
            "heroTitleAccent",
            "heroMetricsLabel",
            "productPreviewLabel",
            "productStageLabel",
            "brandHomeLabel",
            "languageSwitcherLabel",
            "productPreviewAlt",
            "data-i18n-alt",
            "zh:",
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, app_js)

    def test_dist_styles_keeps_reveal_and_motion_contract(self) -> None:
        if not DIST_STYLES_CSS.exists():
            self.skipTest("dist/styles.css is only available after build_pages_dist runs")
        styles_css = DIST_STYLES_CSS.read_text(encoding="utf-8")

        self.assertIn("prefers-reduced-motion", styles_css)
        self.assertRegex(styles_css, re.compile(r'\[data-reveal(?:=["\']enabled["\'])?\]'))
        self.assertIn(".is-revealed", styles_css)

    def test_dist_app_index_keeps_pages_startup_contract(self) -> None:
        if not DIST_APP_INDEX.exists():
            self.skipTest("dist/app/index.html is only available after build_pages_dist runs")
        html = DIST_APP_INDEX.read_text(encoding="utf-8")

        self.assertIn('<meta name="default-scenario" content="tno_1962" />', html)
        self.assertIn('<meta name="robots" content="noindex,nofollow" />', html)
        self.assertIn('<link rel="modulepreload" href="js/main.js" />', html)
        self.assertIn('<link rel="preload" href="data/scenarios/index.json" as="fetch" crossorigin />', html)
        self.assertNotIn('<link rel="preload" href="data/europe_topology.json" as="fetch" crossorigin />', html)
        self.assertNotIn('href="data/locales.startup.json"', html)
        self.assertNotIn('href="data/geo_aliases.startup.json"', html)

    def test_dist_manifest_keeps_pages_size_and_required_files_contract(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        paths = {record["path"] for record in payload["files"]}

        self.assertLessEqual(payload["total_bytes"], payload["max_allowed_bytes"])
        self.assertEqual(payload["max_allowed_bytes"], 950 * 1024 * 1024)
        for expected_path in (
            "index.html",
            "app/index.html",
            ".nojekyll",
            "app/js/main.js",
            "app/data/scenarios/index.json",
            "app/data/scenarios/tno_1962/startup.bundle.en.json",
            "app/data/scenarios/tno_1962/chunks/political.coarse.r0c0.json",
            "app/data/europe_topology.na_v2.json",
            "app/data/transport_layers/global_road/catalog.json",
            "app/data/transport_layers/japan_road/roads.preview.topo.json",
            "app/data/transport_layers/japan_industrial_zones/industrial_zones.open.preview.geojson",
        ):
            with self.subTest(expected_path=expected_path):
                self.assertIn(expected_path, paths)

        for excluded_path in (
            "app/data/PROBAV_LC100_global_v3.0.1_2019_discrete.tif",
            "app/data/ETOPO_2022_v1_60s_N90W180_surface.tif",
            "app/data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson",
            "app/data/scenarios/tno_1962/audit.json",
            "app/data/i18n/locales_baseline.json",
            "app/data/transport_layers/global_road/shards/w120_w090/roads.topo.json",
            "app/data/transport_layers/japan_road/roads.topo.json",
            "app/data/transport_layers/japan_industrial_zones/industrial_zones.open.geojson",
        ):
            with self.subTest(excluded_path=excluded_path):
                self.assertNotIn(excluded_path, paths)

    def test_deploy_dist_artifact_preserves_nojekyll(self) -> None:
        workflow_lines = VERIFY_SHARED_WORKFLOW.read_text(encoding="utf-8").splitlines()
        upload_block_start = workflow_lines.index("          name: deploy-dist")
        upload_block = "\n".join(workflow_lines[upload_block_start : upload_block_start + 4])

        self.assertIn("path: dist", upload_block)
        self.assertIn("include-hidden-files: true", upload_block)


if __name__ == "__main__":
    unittest.main()
