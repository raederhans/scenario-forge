import json
from pathlib import Path
import tomllib
import unittest

from tools.browser_smoke_profile_contract import validate_profile_path, validate_profile_payload


REPO_ROOT = Path(__file__).resolve().parents[1]
BROWSER_SMOKE_PROFILE = REPO_ROOT / "ops" / "browser-mcp" / "inspection-profile.toml"


class PlaywrightReadyGateContractTest(unittest.TestCase):
    def test_browser_smoke_profile_keeps_runtime_output_and_budget_contract(self):
        profile = tomllib.loads(BROWSER_SMOKE_PROFILE.read_text(encoding="utf-8"))

        self.assertEqual([], validate_profile_path(BROWSER_SMOKE_PROFILE))
        self.assertEqual(profile["outputs"]["artifact_dir"], ".runtime/browser/mcp-artifacts")
        self.assertEqual(
            profile["outputs"]["report_path"],
            ".runtime/reports/generated/browser/ai-browser-mcp-smoketest.md",
        )
        self.assertLess(
            profile["budgets"]["quick"]["max_runtime_sec"],
            profile["budgets"]["full"]["max_runtime_sec"],
        )
        routes_by_id = {route["id"]: route for route in profile["routes"]}
        route_ids = set(routes_by_id)
        self.assertIn("home", route_ids)
        self.assertIn("docs", route_ids)
        self.assertIn("data_readme", route_ids)
        self.assertIn("quick", routes_by_id["home"]["enabled_modes"])
        self.assertNotIn("quick", routes_by_id["docs"]["enabled_modes"])

    def test_browser_smoke_profile_validator_reports_contract_errors(self):
        errors = validate_profile_payload({"routes": {}}, path="<test-profile>")

        self.assertIn("<test-profile>: version must be an integer.", errors)
        self.assertIn("<test-profile>: defaults must be a table.", errors)
        self.assertIn("<test-profile>: routes must be an array of tables.", errors)

    def test_browser_smoke_profile_validator_rejects_invalid_modes_and_references(self):
        profile = _minimal_browser_smoke_profile()
        profile["routes"][0]["enabled_modes"] = ["quick", "slow"]
        profile["sections"][0]["page"] = "missing"
        profile["routes"][0]["url"] = "docs/"

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn("<test-profile>: routes[home].enabled_modes has invalid mode: slow.", errors)
        self.assertIn("<test-profile>: sections[left_sidebar].page references unknown route: missing.", errors)
        self.assertIn("<test-profile>: routes[home].url must be app-relative or localhost absolute.", errors)

    def test_browser_smoke_profile_validator_rejects_non_local_navigation(self):
        profile = _minimal_browser_smoke_profile()
        profile["defaults"]["base_host"] = "example.com"

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn("<test-profile>: defaults.base_host must be one of: 127.0.0.1, localhost.", errors)

        for route_url in ("https://example.com/app/", "http://localhost.evil.example/app/", "//evil.example/app/"):
            with self.subTest(route_url=route_url):
                profile = _minimal_browser_smoke_profile()
                profile["routes"][0]["url"] = route_url

                errors = validate_profile_payload(profile, path="<test-profile>")

                self.assertIn("<test-profile>: routes[home].url must be app-relative or localhost absolute.", errors)

        for route_url in ("http://localhost:8000/app/", "http://127.0.0.1:8000/app/"):
            with self.subTest(route_url=route_url):
                profile = _minimal_browser_smoke_profile()
                profile["routes"][0]["url"] = route_url

                errors = validate_profile_payload(profile, path="<test-profile>")

                self.assertNotIn("<test-profile>: routes[home].url must be app-relative or localhost absolute.", errors)

    def test_browser_smoke_profile_validator_rejects_path_unsafe_ids(self):
        profile = _minimal_browser_smoke_profile()
        profile["routes"][0]["id"] = "../home"
        profile["sections"][0]["id"] = "left/sidebar"
        profile["gestures"][0]["id"] = "map pan"

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn(
            "<test-profile>: routes[../home].id must use only letters, numbers, underscores, and hyphens.",
            errors,
        )
        self.assertIn(
            "<test-profile>: sections[left/sidebar].id must use only letters, numbers, underscores, and hyphens.",
            errors,
        )
        self.assertIn(
            "<test-profile>: gestures[map pan].id must use only letters, numbers, underscores, and hyphens.",
            errors,
        )

    def test_browser_smoke_profile_validator_rejects_blank_strings(self):
        profile = _minimal_browser_smoke_profile()
        profile["routes"][0]["id"] = "   "
        profile["routes"][0]["url"] = "\t"
        profile["sections"][0]["page"] = " "
        profile["sections"][0]["selector"] = "\n"
        profile["gestures"][0]["selector"] = "   "

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn("<test-profile>: routes[#0].id must be a non-empty string.", errors)
        self.assertIn("<test-profile>: routes[#0].url must be a non-empty string.", errors)
        self.assertIn("<test-profile>: sections[left_sidebar].page must be a non-empty string.", errors)
        self.assertIn("<test-profile>: sections[left_sidebar].selector must be a non-empty string.", errors)
        self.assertIn("<test-profile>: gestures[map_pan_zoom].selector must be a non-empty string.", errors)

    def test_browser_smoke_profile_validator_rejects_invalid_port_bounds(self):
        profile = _minimal_browser_smoke_profile()
        profile["defaults"]["port_range_start"] = 70000

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn("<test-profile>: defaults.port_range_start must be less than or equal to 65535.", errors)

        profile = _minimal_browser_smoke_profile()
        profile["routes"][0]["url"] = "http://localhost:70000/app/"

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn("<test-profile>: routes[home].url port must be in range 1..65535.", errors)

    def test_browser_smoke_profile_validator_rejects_unknown_fields(self):
        profile = _minimal_browser_smoke_profile()
        profile["routes"][0]["enabled_mode"] = ["quick"]
        profile["sections"][0]["capture_networks"] = True

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn("<test-profile>: routes[home] has unknown field: enabled_mode.", errors)
        self.assertIn("<test-profile>: sections[left_sidebar] has unknown field: capture_networks.", errors)

    def test_browser_smoke_profile_validator_requires_gesture_type(self):
        profile = _minimal_browser_smoke_profile()
        del profile["gestures"][0]["type"]

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn("<test-profile>: gestures[map_pan_zoom].type must be one of: drag_zoom.", errors)

    def test_browser_smoke_profile_validator_rejects_runtime_output_escape(self):
        profile = _minimal_browser_smoke_profile()
        profile["outputs"]["artifact_dir"] = "../browser-artifacts"
        profile["outputs"]["report_path"] = "/tmp/browser-smoke.md"

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn("<test-profile>: outputs.artifact_dir must stay under .runtime/browser/.", errors)
        self.assertIn("<test-profile>: outputs.report_path must stay under .runtime/reports/generated/browser/.", errors)

    def test_browser_smoke_profile_validator_keeps_quick_budgets_within_full(self):
        profile = _minimal_browser_smoke_profile()
        profile["budgets"]["quick"]["max_runtime_sec"] = 500

        errors = validate_profile_payload(profile, path="<test-profile>")

        self.assertIn(
            "<test-profile>: budgets.quick.max_runtime_sec must be less than or equal to budgets.full.max_runtime_sec.",
            errors,
        )


def _minimal_browser_smoke_profile():
    return {
        "version": 1,
        "defaults": {
            "base_host": "localhost",
            "port_range_start": 8000,
            "port_range_end": 8010,
            "server_title_pattern": "Scenario Forge",
            "wsl_windows_fallback": True,
        },
        "decision": {
            "default_mode": "auto",
            "auto_start_mode": "quick",
            "upgrade_on_cross_section_anomaly": True,
            "cross_section_threshold": 2,
            "upgrade_on_insufficient_evidence": False,
            "min_sections_for_confidence": 4,
            "full_trigger_keywords": ["scan all sections"],
            "quick_trigger_keywords": ["inspect ui"],
        },
        "budgets": {
            "quick": {
                "max_sections": 2,
                "max_screenshots": 2,
                "max_runtime_sec": 60,
                "max_network_entries": 100,
            },
            "full": {
                "max_sections": 4,
                "max_screenshots": 4,
                "max_runtime_sec": 120,
                "max_network_entries": 100,
            },
        },
        "evidence": {
            "console_min_level": "warning",
            "network_include_static": True,
            "network_failed_only": True,
        },
        "outputs": {
            "artifact_dir": ".runtime/browser/mcp-artifacts",
            "report_path": ".runtime/reports/generated/browser/ai-browser-mcp-smoketest.md",
        },
        "routes": [
            {
                "id": "home",
                "url": "/app/",
                "scroll": 0,
                "screenshot": True,
                "capture_console": True,
                "capture_network": True,
                "enabled_modes": ["quick", "full"],
            }
        ],
        "sections": [
            {
                "id": "left_sidebar",
                "page": "home",
                "selector": "aside.sidebar",
                "expand": "none",
                "scroll": 0,
                "screenshot": "always",
                "priority": "high",
                "enabled_modes": ["quick", "full"],
            }
        ],
        "gestures": [
            {
                "id": "map_pan_zoom",
                "page": "home",
                "selector": "#mapContainer",
                "type": "drag_zoom",
                "from": [980, 500],
                "to": [1120, 580],
                "wheel": -700,
                "screenshot": True,
                "enabled_modes": ["quick", "full"],
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
