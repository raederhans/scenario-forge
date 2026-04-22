from pathlib import Path
import subprocess
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
RULE_FILE = REPO_ROOT / "tools" / "eslint-rules" / "no-direct-state-mutation.js"
ALLOWLIST_FILE = REPO_ROOT / "tools" / "eslint-rules" / "state-writer-allowlist.json"
CHECK_SCRIPT = REPO_ROOT / "tools" / "check_state_write_allowlist.mjs"
PACKAGE_JSON = REPO_ROOT / "package.json"


class StateWriteGuardrailContractTest(unittest.TestCase):
    def test_guardrail_files_exist(self):
        self.assertTrue(RULE_FILE.exists())
        self.assertTrue(ALLOWLIST_FILE.exists())
        self.assertTrue(CHECK_SCRIPT.exists())

    def test_package_json_exposes_guardrail_script(self):
        content = PACKAGE_JSON.read_text(encoding="utf-8")
        self.assertIn('"verify:state-write-allowlist"', content)
        self.assertIn("node tools/check_state_write_allowlist.mjs", content)

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

    def test_scanner_flags_member_computed_and_object_assign_writes(self):
        script = """
const { scanContentForStateWrites } = require('./tools/eslint-rules/no-direct-state-mutation.js');
const samples = {
  member: 'state.foo = 1;',
  memberOrAssign: 'state.foo ||= payload;',
  memberNullishAssign: 'state.foo ??= payload;',
  memberPlusAssign: 'state.foo += 1;',
  computed: 'state[key] = payload;',
  computedWithSpace: 'state [key] = payload;',
  computedNested: 'state[keys[index]] = payload;',
  computedOrAssign: 'state[key] ||= payload;',
  objectAssign: 'Object.assign(state, payload);',
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
