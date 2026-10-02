from __future__ import annotations

import tempfile
import unittest
import json
import re
from pathlib import Path

from tools.i18n_audit import build_localization_ownership_audit, collect_code_strings
from tools.pages_artifact_root import resolve_pages_artifact_root

REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIST_ROOT = resolve_pages_artifact_root(repo_root=REPO_ROOT)


class I18nAuditTest(unittest.TestCase):
    def _write_repo_file(self, repo_root: Path, relative_path: str, content: str) -> None:
        path = repo_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def _write_repo_json(self, repo_root: Path, relative_path: str, payload: dict) -> None:
        self._write_repo_file(
            repo_root,
            relative_path,
            json.dumps(payload, ensure_ascii=False, indent=2),
        )

    def test_collects_legacy_and_declarative_coverage_separately(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/ui/i18n.js",
                """
const uiMap = [
  ["createTagBtn", "Create Tag"],
];
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <button id="createTagBtn">Create Tag</button>
    <button data-i18n="Scenario Tag Creator">Scenario Tag Creator</button>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Scenario Tag Creator", result["declarative_ui_keys"])
            self.assertIn("Create Tag", result["legacy_ui_map_keys"])
            self.assertIn("Create Tag", result["covered_default_literals"])
            self.assertIn("Scenario Tag Creator", result["covered_default_literals"])

    def test_counts_select_option_with_data_i18n_as_covered_literal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <select>
      <option value="manual" data-i18n="Manual">Manual</option>
    </select>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Manual", result["declarative_ui_keys"])
            self.assertIn("Manual", result["covered_default_literals"])
            self.assertNotIn("Manual", result["uncovered_user_visible_literals"])

    def test_counts_canvas_fallback_text_with_data_i18n_as_covered_literal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <canvas data-i18n="Interactive map color layer.">Interactive map color layer.</canvas>
    <canvas data-i18n="Interactive map line layer.">Interactive map line layer.</canvas>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            for token in ("Interactive map color layer.", "Interactive map line layer."):
                with self.subTest(token=token):
                    self.assertIn(token, result["declarative_ui_keys"])
                    self.assertIn(token, result["covered_default_literals"])
                    self.assertNotIn(token, result["uncovered_user_visible_literals"])

    def test_splits_uncovered_a11y_and_non_translatable_literals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/sample.js",
                """
const count = 3;
showToast("Apply Scenario");
showToast(`Copied ${count} region entries to the clipboard.`);
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <button aria-label="Toggle left panel">Panels</button>
    <input placeholder="berlin" />
    <span>0px</span>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Copied {expr} region entries to the clipboard.", result["dynamic_ui_candidates"])
            self.assertIn("Apply Scenario", result["uncovered_user_visible_literals"])
            self.assertIn("Toggle left panel", result["a11y_literals"])
            self.assertIn("berlin", result["non_translatable_tokens"])
            self.assertIn("0px", result["non_translatable_tokens"])

    def test_treats_known_data_source_names_as_non_translatable_literals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <span>GeoNames</span>
    <span>Marine Regions</span>
    <span>Natural Earth</span>
    <span>OpenFlights</span>
    <span>OurAirports</span>
    <span>OpenStreetMap</span>
    <span>Camino</span>
    <span>FRA GIS</span>
    <span>ITE 3000</span>
    <span>NaPTAN</span>
    <span>Network Rail</span>
    <span>OpenDataNI</span>
    <span>USGS MRDS</span>
    <span>data.gouv.fr</span>
    <span>Wikidata</span>
    <span>geoBoundaries</span>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            for token in (
                "GeoNames",
                "Marine Regions",
                "Natural Earth",
                "OpenFlights",
                "OurAirports",
                "OpenStreetMap",
                "Camino",
                "FRA GIS",
                "ITE 3000",
                "NaPTAN",
                "Network Rail",
                "OpenDataNI",
                "USGS MRDS",
                "data.gouv.fr",
                "Wikidata",
                "geoBoundaries",
            ):
                with self.subTest(token=token):
                    self.assertIn(token, result["non_translatable_tokens"])
                    self.assertNotIn(token, result["uncovered_user_visible_literals"])

    def test_build_localization_ownership_audit_reports_source_and_scenario_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            locales_payload = {
                "ui": {
                    "Special zone diagnostics": {
                        "en": "Special zone diagnostics",
                        "zh": "特殊区域诊断",
                    },
                },
                "geo": {
                    "HGO 1936": {
                        "en": "HGO 1936",
                        "zh": "历史地理重置 1936",
                    },
                },
            }
            self._write_repo_json(repo_root, "data/locales.json", locales_payload)
            self._write_repo_json(repo_root, "data/i18n/manual_ui.json", {"Special zone diagnostics": "特殊区域诊断"})
            self._write_repo_json(repo_root, "data/i18n/manual_geo_overrides.json", {"HGO 1936": "历史地理重置 1936"})
            self._write_repo_json(repo_root, "data/i18n/locales_baseline.json", locales_payload)
            self._write_repo_file(
                repo_root,
                "js/core/i18n_catalog.js",
                """
export const UI_COPY_CATALOG = Object.freeze({
  "Special zone diagnostics": { zh: "特殊区域诊断", en: "Special zone diagnostics" },
});
                """.strip(),
            )
            self._write_repo_file(repo_root, "js/ui/i18n.js", "export function t(key) { return key; }")
            self._write_repo_file(
                repo_root,
                "index.html",
                '<button data-i18n="Special zone diagnostics">Special zone diagnostics</button>',
            )
            self._write_repo_json(
                repo_root,
                "data/scenarios/index.json",
                {
                    "version": 1,
                    "scenarios": [
                        {
                            "scenario_id": "hgo_1936",
                            "display_name": "HGO 1936",
                            "manifest_url": "data/scenarios/hgo_1936/manifest.json",
                        }
                    ],
                },
            )
            self._write_repo_json(
                repo_root,
                "data/scenarios/hgo_1936/manifest.json",
                {
                    "scenario_id": "hgo_1936",
                    "display_name": "HGO 1936",
                    "bookmark_name": "HGO_1936_INTERNAL_NAME",
                    "bookmark_description": "Historic Geographical Overhaul state-level vector scenario.",
                },
            )
            self._write_repo_json(repo_root, "data/scenarios/hgo_1936/geo_locale_patch.zh.json", {})
            self._write_repo_json(repo_root, "data/scenarios/hgo_1936/locales.startup.json", {})
            self._write_repo_json(repo_root, "data/scenarios/hgo_1936/startup.bundle.en.json", {})
            self._write_repo_json(repo_root, "data/scenarios/hgo_1936/startup.bundle.zh.json", {})

            code_strings = collect_code_strings(repo_root)
            audit = build_localization_ownership_audit(
                repo_root=repo_root,
                locales_path=repo_root / "data" / "locales.json",
                scenarios_root=repo_root / "data" / "scenarios",
                locales=locales_payload,
                code_strings=code_strings,
                scenario_geo_missing=[],
                scenario_metadata_missing=["Historic Geographical Overhaul state-level vector scenario."],
            )

            self.assertEqual(audit["summary"]["ui_locale_entries"], 1)
            self.assertEqual(audit["summary"]["manual_ui_entries"], 1)
            self.assertEqual(audit["summary"]["catalog_ui_entries"], 1)
            self.assertEqual(audit["summary"]["scenario_count"], 1)
            self.assertEqual(audit["summary"]["scenario_startup_ready_count"], 1)
            self.assertEqual(audit["ui_sources"]["runtime_catalog"]["path"], "js/core/i18n_catalog.js")
            scenario_record = audit["scenario_assets"][0]
            self.assertEqual(scenario_record["scenario_id"], "hgo_1936")
            self.assertTrue(scenario_record["assets"]["geo_locale_patch_zh"]["exists"])
            self.assertEqual(
                scenario_record["metadata_missing"],
                ["Historic Geographical Overhaul state-level vector scenario."],
            )
            self.assertNotIn("HGO_1936_INTERNAL_NAME", scenario_record["metadata_strings"])

    def test_treats_simple_numeric_units_as_non_translatable_literals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <span>1.5 km</span>
    <span>≈ 333 km</span>
    <span>20 ms</span>
    <span>3 km2</span>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            for token in ("1.5 km", "≈ 333 km", "20 ms", "3 km2"):
                with self.subTest(token=token):
                    self.assertIn(token, result["non_translatable_tokens"])
                    self.assertNotIn(token, result["uncovered_user_visible_literals"])

    def test_keeps_literal_translated_ui_alias_in_sync_with_ui_t_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/sample.js",
                """
const label = t("Create Tag", "ui");
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertEqual(result["ui_t_keys"], result["literal_translated_ui_keys"])

    def test_unicode_icon_escape_does_not_count_as_uncovered_literal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/sample.js",
                r"""
const gear = document.createElement("button");
gear.textContent = "\u2699";
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertNotIn("\\u2699", result["uncovered_user_visible_literals"])
            self.assertNotIn("⚙", result["uncovered_user_visible_literals"])

    def test_collect_code_strings_ignores_broken_multiline_declarative_markup_without_hiding_valid_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <button
      data-i18n="Broken
      data-extra="ignored"
    >Broken</button>
    <button data-i18n="Scenario Tag Creator">Scenario Tag Creator</button>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Scenario Tag Creator", result["declarative_ui_keys"])
            self.assertNotIn("Broken      data-extra=", result["declarative_ui_keys"])

    def test_ignores_script_and_importmap_contents_in_markup_audit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <head>
    <script type="importmap">
      {
        "imports": {
          "/js/": "./js/"
        }
      }
    </script>
    <script>
      (() => {
        const preload = document.createElement("link");
        preload.setAttribute("data-startup-bundle-preload", "true");
      })();
    </script>
  </head>
  <body>
    <button data-i18n="Scenario Tag Creator">Scenario Tag Creator</button>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertNotIn('{ "imports": { "/js/": "./js/" } }', result["uncovered_user_visible_literals"])
            self.assertFalse(
                any("data-startup-bundle-preload" in item for item in result["uncovered_user_visible_literals"])
            )
            self.assertIn("Scenario Tag Creator", result["covered_default_literals"])

    def test_collects_inline_ui_translation_keys_and_alt_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/core/i18n_catalog.js",
                """
export const UI_COPY_CATALOG = Object.freeze({
  "Export preview ready": { zh: "导出预览已就绪", en: "Export preview ready" },
  Override: { zh: "覆盖", en: "Override" },
});
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <img data-i18n-alt="Export preview ready" alt="Export preview ready" />
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Export preview ready", result["inline_ui_keys"])
            self.assertIn("Override", result["inline_ui_keys"])
            self.assertIn("Export preview ready", result["declarative_ui_keys"])
            self.assertIn("Export preview ready", result["covered_default_literals"])

    def test_inline_ui_catalog_keys_are_unique(self) -> None:
        catalog_source = (REPO_ROOT / "js" / "core" / "i18n_catalog.js").read_text(encoding="utf-8")
        block_match = re.search(
            r"export\s+const\s+UI_COPY_CATALOG\s*=\s*Object\.freeze\(\{(?P<body>.*?)\n\}\);",
            catalog_source,
            re.DOTALL,
        )
        self.assertIsNotNone(block_match)
        key_pattern = re.compile(r'^  (?:(?P<quoted>"(?:\\.|[^"])*")|(?P<identifier>[A-Za-z][A-Za-z0-9_]*))\s*:', re.MULTILINE)
        seen: set[str] = set()
        duplicates: list[str] = []
        for match in key_pattern.finditer(block_match.group("body")):
            raw_key = match.group("quoted") or match.group("identifier") or ""
            key = json.loads(raw_key) if raw_key.startswith('"') else raw_key
            if key in seen:
                duplicates.append(key)
            seen.add(key)
        self.assertEqual([], duplicates)

    def test_collects_landing_markup_and_runtime_alt_literals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "landing/index.html",
                """
<!doctype html>
<html>
  <body>
    <a data-i18n="Start mapping">Start mapping</a>
    <img data-i18n-alt="Landing preview" alt="Landing preview" />
  </body>
</html>
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "landing/app.js",
                """
const translations = {
  en: {
    startMapping: "Start mapping",
  },
  zh: {
    startMapping: "开始制图",
  },
};
const image = document.querySelector("img");
image.setAttribute("alt", "Landing runtime preview");
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertEqual(result["source_scope_stats"]["landing"]["file_count"], 2)
            self.assertIn("Start mapping", result["landing_translation_default_values"])
            self.assertIn("Start mapping", result["declarative_ui_keys"])
            self.assertIn("Landing preview", result["declarative_ui_keys"])
            self.assertIn("Landing runtime preview", result["uncovered_user_visible_literals"])

    def test_collects_quoted_landing_keys_and_object_assign_additions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "landing/app.js",
                """
const translations = {
  en: {
    "initialKey": "Initial English label",
  },
  zh: {
    "initialKey": "初始标签",
  },
};
Object.assign(translations.en, {
  "libraryArtwork": "Vector artwork",
  'libraryProject': 'Editable project',
  nextStep: "Keep editing",
});
Object.assign(translations.en, { firstInline: "Inline label", "secondInline": "Another label" });
Object.assign(translations.zh, { libraryArtwork: "矢量作品" });
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "landing/index.html",
                '<span data-i18n="libraryArtwork">Vector artwork</span>',
            )

            result = collect_code_strings(repo_root)

            self.assertEqual(
                {"initialKey", "libraryArtwork", "libraryProject", "nextStep", "firstInline", "secondInline"},
                set(result["landing_translation_keys"]),
            )
            self.assertIn("Vector artwork", result["covered_default_literals"])
            self.assertNotIn("Vector artwork", result["uncovered_user_visible_literals"])
            self.assertIn("Another label", result["landing_translation_default_values"])
            self.assertNotIn("矢量作品", result["landing_translation_default_values"])

    def test_landing_additions_do_not_hide_unknown_or_non_literal_translation_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "landing/app.js",
                """
Object.assign(translations.en, { "coveredKey": "Translated English label", dynamicKey: getLabel(), prefixedKey: "Prefix " + getSuffix() });
Object.assign(otherTranslations.en, { "otherObjectKey": "Other dictionary label" });
Object.assign(translations.zh, { "chineseOnlyKey": "只有中文" });
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "landing/index.html",
                """
<span data-i18n="coveredKey">Translated English label</span>
<span data-i18n="missingKey">Missing English label</span>
<span data-i18n="dynamicKey">Dynamic English label</span>
<span data-i18n="prefixedKey">Prefix requiring a dynamic suffix</span>
<span data-i18n="otherObjectKey">Other dictionary label</span>
<span data-i18n="chineseOnlyKey">English label without an English dictionary entry</span>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertEqual(["coveredKey"], result["landing_translation_keys"])
            self.assertEqual(
                {"missingKey", "dynamicKey", "prefixedKey", "otherObjectKey", "chineseOnlyKey"},
                set(result["declarative_ui_keys"]) - set(result["landing_translation_keys"]),
            )
            self.assertIn("Other dictionary label", result["uncovered_user_visible_literals"])
            self.assertIn("Missing English label", result["uncovered_user_visible_literals"])

    def test_collects_transport_descriptor_fields_as_ui_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/ui/toolbar/transport_workbench_descriptor.js",
                """
const config = {
  label: "Road classes",
  description: "Decide what enters the Japan road pack before any style rule runs.",
};
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Road classes", result["ui_t_keys"])
            self.assertIn("Road classes", result["dynamic_config_ui_keys"])
            self.assertIn(
                "Decide what enters the Japan road pack before any style rule runs.",
                result["ui_t_keys"],
            )

    def test_main_runtime_supports_same_declarative_alt_attribute_as_audit(self) -> None:
        i18n_js = (REPO_ROOT / "js" / "ui" / "i18n.js").read_text(encoding="utf-8")

        self.assertIn('getAttribute("data-i18n-alt")', i18n_js)
        self.assertIn('setLocalizedAttribute(element, "alt", t(altKey, "ui"))', i18n_js)
        self.assertIn("[data-i18n-alt]", i18n_js)

    def test_transport_shell_copy_is_localized_and_transport_headings_are_wired(self) -> None:
        locales = json.loads((REPO_ROOT / "data" / "locales.json").read_text(encoding="utf-8"))
        ui = locales.get("ui") or {}

        for index_path in [
            REPO_ROOT / "index.html",
            PAGES_DIST_ROOT / "app" / "index.html",
        ]:
            index_html = index_path.read_text(encoding="utf-8")
            self.assertIn(
                'id="appearanceTabTransport"\n'
                '                  type="button"\n'
                '                  class="appearance-tab-btn"\n'
                '                  data-appearance-tab="transport"\n'
                '                  role="tab"\n'
                '                  aria-selected="false"\n'
                '                  aria-controls="appearancePanelTransport"\n'
                '                  tabindex="-1"\n'
                '                  data-i18n="Transport"',
                index_html,
            )
            self.assertIn(
                '<h2 id="lblTransportPanel" class="section-header" data-i18n="Transport">Transport</h2>',
                index_html,
            )
            self.assertIn(
                'data-i18n="Open the transport workbench for transport preview, layer order, diagnostics, and apply-to-map controls."',
                index_html,
            )
            self.assertIn('data-i18n-aria-label="Transport actions"', index_html)
        self.assertIn("Transport actions", ui)
        self.assertIn(
            "Open the transport workbench for transport preview, layer order, diagnostics, and apply-to-map controls.",
            ui,
        )

    def test_cloud_save_and_fragment_ui_keys_exist_in_source_and_dist_locales(self) -> None:
        required_ui_keys = {
            "Cloud Saves",
            "Cloud save created.",
            "Comment",
            "Comment posted.",
            "Community save import started.",
            "Community save loaded into the editor.",
            "Community saves refreshed.",
            "Latest cloud save published.",
            "Load",
            "Local backend cloud saves are available after login.",
            "Local backend unavailable. Start the local dev server to use Cloud Saves.",
            "Logged in as",
            "Logged out.",
            "Login",
            "Logout",
            "No community saves yet",
            "Password",
            "Publish Latest",
            "Refresh Community",
            "Register",
            "Report",
            "Report submitted for review.",
            "Save Cloud Copy",
            "Save title",
            "Username",
            "fragments",
        }

        locales_paths = [REPO_ROOT / "data" / "locales.json"]
        dist_locales_path = PAGES_DIST_ROOT / "app" / "data" / "locales.json"
        if dist_locales_path.exists():
            locales_paths.append(dist_locales_path)

        for locales_path in locales_paths:
            locales = json.loads(locales_path.read_text(encoding="utf-8"))
            ui = locales.get("ui") or {}
            for key in required_ui_keys:
                with self.subTest(locales_path=locales_path, key=key):
                    self.assertIn(key, ui)
                    self.assertTrue(str((ui.get(key) or {}).get("zh", "")).strip())

    def test_appearance_preset_ui_keys_are_wired_and_localized(self) -> None:
        required_ui_keys = {
            "Appearance Presets",
            "Save Current Appearance",
            "Preset Library",
            "Preset Name",
            "Save Preset",
            "0 presets",
            "preset",
            "presets",
            "Appearance Preset",
        }

        index_html = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="appearancePresetSummary" class="panel-hint" data-i18n="0 presets"', index_html)

        locales = json.loads((REPO_ROOT / "data" / "locales.json").read_text(encoding="utf-8"))
        baseline = json.loads((REPO_ROOT / "data" / "i18n" / "locales_baseline.json").read_text(encoding="utf-8"))
        for label, payload in (("source", locales), ("baseline", baseline)):
            ui = payload.get("ui") or {}
            for key in required_ui_keys:
                with self.subTest(label=label, key=key):
                    self.assertIn(key, ui)
                    self.assertTrue(str((ui.get(key) or {}).get("zh", "")).strip())

    def test_locale_ui_domain_terms_avoid_obvious_machine_mistranslations(self) -> None:
        locales = json.loads((REPO_ROOT / "data" / "locales.json").read_text(encoding="utf-8"))
        ui = locales.get("ui") or {}
        geo = locales.get("geo") or {}
        high_risk_terms = {
            "Classes": "类别",
            "Road": "道路",
            "Rail": "铁路",
            "Airport": "机场",
            "Airport inspector": "机场检查器",
            "Rail inspector": "铁路检查器",
            "Port inspector": "港口检查器",
            "Hub category": "枢纽类别",
            "Port": "港口",
            "Energy carrier": "能源预览面板",
            "Industrial land carrier": "工业用地预览面板",
            "Road lens": "道路视图",
            "Lens": "视图",
            "Layers": "图层",
            "Guide": "指南",
            "Mineral inspector": "矿产检查器",
            "Station opacity": "车站不透明度",
        }

        for key, expected_zh in high_risk_terms.items():
            with self.subTest(key=key):
                self.assertEqual((ui.get(key) or {}).get("zh"), expected_zh)

        self.assertEqual((geo.get("id::FR_ARR_62007") or {}).get("zh"), "朗斯")

        banned_fragments = (
            "课程",
            "检查员",
            "督察",
            "轮毂",
            "电台",
            "端口",
            "家庭",
            "承运",
            "镜头",
            "航空公司",
            "能量载体",
            "集线器",
            "透镜",
            "工业陆运载体",
            "载体",
            "航空母舰",
            "搬运车",
            "检验员",
            "镜片",
        )
        for section_name, section in (("ui", ui), ("geo", geo)):
            for key, entry in section.items():
                zh_value = entry.get("zh", "") if isinstance(entry, dict) else ""
                with self.subTest(section=section_name, key=key):
                    self.assertFalse(any(fragment in zh_value for fragment in banned_fragments), zh_value)


if __name__ == "__main__":
    unittest.main()
