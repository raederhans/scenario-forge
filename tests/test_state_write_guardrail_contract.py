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


if __name__ == "__main__":
    unittest.main()
