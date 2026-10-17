from pathlib import Path
import json
import os
import re
import subprocess
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
RULE_FILE = REPO_ROOT / "tools" / "eslint-rules" / "no-direct-state-mutation.js"
ALLOWLIST_FILE = REPO_ROOT / "tools" / "eslint-rules" / "state-writer-allowlist.json"
CHECK_SCRIPT = REPO_ROOT / "tools" / "check_state_write_allowlist.mjs"
P4_POLICY_FILE = REPO_ROOT / "tools" / "state_writer_policy.json"
P4_POLICY_BUILDER = REPO_ROOT / "tools" / "build_state_writer_policy.mjs"
P4_POLICY_CHECKER = REPO_ROOT / "tools" / "check_state_writer_policy.mjs"
P4_POLICY_EVIDENCE_VALIDATOR = (
    REPO_ROOT / "tools" / "verification" / "state_writer_policy_evidence.mjs"
)
P4_INVENTORY = REPO_ROOT / "tools" / "state_writer_inventory.mjs"
P4_ACTIONS_DIR = REPO_ROOT / "js" / "core" / "state" / "actions"
P4_READ_ONLY_ACTION_MODULES = {
    "js/core/state/actions/scenario_transaction_rollback_actions.js",
}
PACKAGE_JSON = REPO_ROOT / "package.json"
STATE_WRITER_POLICY_EVIDENCE_MODE_ENV = "STATE_WRITER_POLICY_EVIDENCE_MODE"
STATE_WRITER_POLICY_EVIDENCE_PATH_ENV = "STATE_WRITER_POLICY_EVIDENCE_PATH"
STATE_WRITER_POLICY_EVIDENCE_ID_ENV = "STATE_WRITER_POLICY_EVIDENCE_ID"
STATE_WRITER_POLICY_EVIDENCE_STRICT_MODE = "strict"


def run_p4_policy_boundary_check(
    latest_phase,
    *,
    environment=None,
    runner=subprocess.run,
):
    effective_environment = os.environ if environment is None else environment
    evidence_mode = effective_environment.get(
        STATE_WRITER_POLICY_EVIDENCE_MODE_ENV,
        "",
    ).strip()
    if evidence_mode:
        evidence_path = effective_environment.get(
            STATE_WRITER_POLICY_EVIDENCE_PATH_ENV,
            "",
        ).strip()
        evidence_id = effective_environment.get(
            STATE_WRITER_POLICY_EVIDENCE_ID_ENV,
            "",
        ).strip()
        if evidence_mode != STATE_WRITER_POLICY_EVIDENCE_STRICT_MODE:
            return subprocess.CompletedProcess(
                args=[],
                returncode=2,
                stdout="",
                stderr=(
                    "State writer policy evidence validation failed "
                    "code=state-writer-evidence-consumer-mode-invalid "
                    "disposition=blocked"
                ),
            ), ""
        if not evidence_path:
            return subprocess.CompletedProcess(
                args=[],
                returncode=2,
                stdout="",
                stderr=(
                    "State writer policy evidence validation failed "
                    "code=state-writer-evidence-consumer-path-missing "
                    "disposition=blocked"
                ),
            ), ""
        if not re.fullmatch(r"[0-9a-f]{64}", evidence_id):
            return subprocess.CompletedProcess(
                args=[],
                returncode=2,
                stdout="",
                stderr=(
                    "State writer policy evidence validation failed "
                    "code=state-writer-evidence-consumer-id-missing "
                    "disposition=blocked"
                ),
            ), ""
        command = [
            "node",
            P4_POLICY_EVIDENCE_VALIDATOR.relative_to(REPO_ROOT).as_posix(),
            "validate",
            "--evidence",
            evidence_path,
            "--expected-id",
            evidence_id,
            "--phase",
            latest_phase,
        ]
        expected_stdout = "State writer policy evidence reusable-exact"
    else:
        command = [
            "node",
            "tools/check_state_writer_policy.mjs",
            "--phase",
            latest_phase,
        ]
        expected_stdout = "P4 state writer policy pass:"
    return runner(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    ), expected_stdout


class StateWriteGuardrailContractTest(unittest.TestCase):
    def test_guardrail_files_exist(self):
        self.assertTrue(RULE_FILE.exists())
        self.assertTrue(ALLOWLIST_FILE.exists())
        self.assertTrue(CHECK_SCRIPT.exists())

    def test_package_json_exposes_guardrail_script(self):
        content = PACKAGE_JSON.read_text(encoding="utf-8")
        self.assertIn('"verify:state-write-allowlist"', content)
        self.assertIn("node tools/check_state_write_allowlist.mjs", content)

    def test_p4_policy_foundation_files_exist(self):
        for file_path in [
            P4_POLICY_FILE,
            P4_POLICY_BUILDER,
            P4_POLICY_CHECKER,
            P4_POLICY_EVIDENCE_VALIDATOR,
            P4_INVENTORY,
        ]:
            self.assertTrue(file_path.exists(), str(file_path))

    def test_package_json_exposes_p4_policy_scripts(self):
        scripts = json.loads(PACKAGE_JSON.read_text(encoding="utf-8")).get("scripts", {})
        expected_scripts = {
            "test:node:p4:state-writer-policy",
            "verify:p4:state-writer-policy",
            "test:python:p4:state-write-boundary",
            "verify:p4:routes",
        }
        self.assertTrue(expected_scripts.issubset(scripts))

    def test_p4_legacy_direct_projection_matches_existing_allowlist(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        policy = json.loads(P4_POLICY_FILE.read_text(encoding="utf-8"))
        projected = sorted(
            writer["path"]
            for writer in policy.get("writers", [])
            if writer.get("authority") == "legacy-direct"
        )
        self.assertEqual(projected, sorted(allowlist.get("files", [])))

    def test_p4_policy_checker_matches_current_workspace(self):
        policy = json.loads(P4_POLICY_FILE.read_text(encoding="utf-8"))
        latest_phase = policy.get("progress", {}).get("latestPhase")
        self.assertIsInstance(latest_phase, str)
        self.assertTrue(latest_phase)
        result, expected_stdout = run_p4_policy_boundary_check(latest_phase)
        if result.returncode != 0:
            details = "\n".join(
                part for part in [result.stdout.strip(), result.stderr.strip()] if part
            )
            self.fail(details or "P4 state writer policy check failed")
        self.assertIn(expected_stdout, result.stdout)

    def test_p4_policy_strict_evidence_consumer_uses_only_validator(self):
        calls = []

        def fake_runner(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(
                args=command,
                returncode=0,
                stdout=(
                    "State writer policy evidence reusable-exact "
                    "id=" + "a" * 64
                ),
                stderr="",
            )

        evidence_path = str(REPO_ROOT / ".runtime" / "evidence.json")
        evidence_id = "a" * 64
        result, expected_stdout = run_p4_policy_boundary_check(
            "P4.3",
            environment={
                STATE_WRITER_POLICY_EVIDENCE_MODE_ENV: "strict",
                STATE_WRITER_POLICY_EVIDENCE_PATH_ENV: evidence_path,
                STATE_WRITER_POLICY_EVIDENCE_ID_ENV: evidence_id,
            },
            runner=fake_runner,
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn(expected_stdout, result.stdout)
        self.assertEqual(len(calls), 1)
        self.assertEqual(
            calls[0][0],
            [
                "node",
                "tools/verification/state_writer_policy_evidence.mjs",
                "validate",
                "--evidence",
                evidence_path,
                "--expected-id",
                evidence_id,
                "--phase",
                "P4.3",
            ],
        )
        self.assertNotIn("tools/check_state_writer_policy.mjs", calls[0][0])

    def test_p4_policy_default_consumer_keeps_live_checker(self):
        calls = []

        def fake_runner(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(
                args=command,
                returncode=0,
                stdout="P4 state writer policy pass: fixture",
                stderr="",
            )

        result, expected_stdout = run_p4_policy_boundary_check(
            "P4.3",
            environment={},
            runner=fake_runner,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(expected_stdout, "P4 state writer policy pass:")
        self.assertEqual(
            calls[0][0],
            [
                "node",
                "tools/check_state_writer_policy.mjs",
                "--phase",
                "P4.3",
            ],
        )

    def test_p4_policy_strict_evidence_consumer_fails_closed_without_path(self):
        calls = []
        result, expected_stdout = run_p4_policy_boundary_check(
            "P4.3",
            environment={STATE_WRITER_POLICY_EVIDENCE_MODE_ENV: "strict"},
            runner=lambda *args, **kwargs: calls.append((args, kwargs)),
        )

        self.assertEqual(result.returncode, 2)
        self.assertEqual(expected_stdout, "")
        self.assertIn("state-writer-evidence-consumer-path-missing", result.stderr)
        self.assertEqual(calls, [])

        result, expected_stdout = run_p4_policy_boundary_check(
            "P4.3",
            environment={
                STATE_WRITER_POLICY_EVIDENCE_MODE_ENV: "strict",
                STATE_WRITER_POLICY_EVIDENCE_PATH_ENV: ".runtime/evidence.json",
            },
            runner=lambda *args, **kwargs: calls.append((args, kwargs)),
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(expected_stdout, "")
        self.assertIn("state-writer-evidence-consumer-id-missing", result.stderr)
        self.assertEqual(calls, [])

    def test_p4_mutating_action_modules_match_current_policy(self):
        action_modules = (
            sorted(P4_ACTIONS_DIR.glob("*.js"))
            if P4_ACTIONS_DIR.exists()
            else []
        )
        policy = json.loads(P4_POLICY_FILE.read_text(encoding="utf-8"))
        expected_action_modules = sorted(
            writer["path"]
            for writer in policy.get("writers", [])
            if writer.get("authority") == "domain-action"
            and writer.get("path", "").startswith(
                "js/core/state/actions/"
            )
        )
        self.assertTrue(
            P4_READ_ONLY_ACTION_MODULES.isdisjoint(expected_action_modules)
        )
        self.assertEqual(
            [
                path.relative_to(REPO_ROOT).as_posix()
                for path in action_modules
                if path.relative_to(REPO_ROOT).as_posix()
                not in P4_READ_ONLY_ACTION_MODULES
            ],
            expected_action_modules,
        )
        self.assertTrue(
            P4_READ_ONLY_ACTION_MODULES.issubset(
                {
                    path.relative_to(REPO_ROOT).as_posix()
                    for path in action_modules
                }
            )
        )

    def test_allowlist_script_matches_current_workspace(self):
        result = subprocess.run(
            ["node", "tools/check_state_write_allowlist.mjs"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            details = "\n".join(
                part for part in [result.stdout.strip(), result.stderr.strip()] if part
            )
            self.fail(details or "state write allowlist check failed")
        self.assertIn("State write allowlist passed", result.stdout)

    def test_legacy_scanner_classifies_fixtures_and_singleton_writes_semantically(self):
        checker_source = CHECK_SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("LEGACY_SCANNER_FIXTURE_PATHS", checker_source)
        result = subprocess.run(
            ["node", "--test", "tests/state_write_allowlist_behavior.test.mjs"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_transport_workbench_state_owner_is_explicit_state_writer(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertIn(
            "js/ui/toolbar/transport_workbench_state_owner.js",
            allowlist.get("files", []),
        )
        self.assertNotIn(
            "js/ui/toolbar/transport_workbench_controller.js",
            allowlist.get("files", []),
        )

    def test_appearance_city_points_owner_is_explicit_state_writer(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertIn(
            "js/ui/toolbar/appearance_city_points_owner.js",
            allowlist.get("files", []),
        )

    def test_appearance_physical_owner_is_explicit_state_writer(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertIn(
            "js/ui/toolbar/appearance_physical_owner.js",
            allowlist.get("files", []),
        )

    def test_intensity_field_editor_section_is_explicit_state_writer(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertIn(
            "js/ui/toolbar/intensity_field_editor_section.js",
            allowlist.get("files", []),
        )

    def test_appearance_reference_owner_is_explicit_state_writer(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertIn(
            "js/ui/toolbar/appearance_reference_owner.js",
            allowlist.get("files", []),
        )

    def test_appearance_rivers_owner_is_explicit_state_writer(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertIn(
            "js/ui/toolbar/appearance_rivers_owner.js",
            allowlist.get("files", []),
        )

    def test_appearance_parent_border_owner_is_explicit_state_writer(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertIn(
            "js/ui/toolbar/appearance_parent_border_owner.js",
            allowlist.get("files", []),
        )

    def test_transport_appearance_controller_is_explicit_state_writer(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertIn(
            "js/ui/toolbar/transport_appearance_controller.js",
            allowlist.get("files", []),
        )

    def test_layer_observability_diagnostics_stay_read_only(self):
        allowlist = json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
        self.assertNotIn(
            "js/ui/toolbar/layer_status_diagnostics.js",
            allowlist.get("files", []),
        )
        self.assertNotIn(
            "js/ui/toolbar/toolbar_render_scheduler.js",
            allowlist.get("files", []),
        )

    def test_scanner_flags_member_computed_and_object_assign_writes(self):
        script = """
const { scanContentForStateWrites } = require('./tools/eslint-rules/no-direct-state-mutation.js');
const samples = {
  member: 'state.foo = 1;',
  runtimeMember: 'runtimeState.foo = 1;',
  appMember: 'appState.foo = 1;',
  memberOrAssign: 'state.foo ||= payload;',
  runtimeMemberOrAssign: 'runtimeState.foo ||= payload;',
  appMemberOrAssign: 'appState.foo ||= payload;',
  memberNullishAssign: 'state.foo ??= payload;',
  memberPlusAssign: 'state.foo += 1;',
  computed: 'state[key] = payload;',
  runtimeComputed: 'runtimeState[key] = payload;',
  appComputed: 'appState[key] = payload;',
  computedWithSpace: 'state [key] = payload;',
  computedNested: 'state[keys[index]] = payload;',
  computedOrAssign: 'state[key] ||= payload;',
  objectAssign: 'Object.assign(state, payload);',
  runtimeObjectAssign: 'Object.assign(runtimeState, payload);',
  appObjectAssign: 'Object.assign(appState, payload);',
};
for (const [name, source] of Object.entries(samples)) {
  const matches = scanContentForStateWrites(source);
  if (!matches.length) {
    console.error(`scanner missed ${name}`);
    process.exit(1);
  }
}
"""
        result = subprocess.run(
            ["node", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            details = "\n".join(
                part for part in [result.stdout.strip(), result.stderr.strip()] if part
            )
            self.fail(details or "scanner did not detect direct state write sample")

    def test_scanner_ignores_computed_read_comparisons(self):
        script = """
const { scanContentForStateWrites } = require('./tools/eslint-rules/no-direct-state-mutation.js');
const samples = [
  'if (state[key] === value) {}',
  'if (state[key] == value) {}',
];
for (const source of samples) {
  const matches = scanContentForStateWrites(source);
  if (matches.length) {
    console.error(`scanner falsely matched: ${source}`);
    process.exit(1);
  }
}
"""
        result = subprocess.run(
            ["node", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            details = "\n".join(
                part for part in [result.stdout.strip(), result.stderr.strip()] if part
            )
            self.fail(details or "scanner falsely matched computed read comparison")


if __name__ == "__main__":
    unittest.main()
