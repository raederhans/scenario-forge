import json
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def run_normalizers(payload):
    script = """
import {
  normalizeScenarioTagInput,
  normalizeScenarioNameInput,
  normalizeScenarioColorInput,
  sanitizeScenarioColorList
} from './js/ui/dev_workspace/dev_workspace_normalizers.js';

const payload = JSON.parse(process.argv[1]);
const result = {
  tag: normalizeScenarioTagInput(payload.tag),
  name: normalizeScenarioNameInput(payload.name),
  color: normalizeScenarioColorInput(payload.color),
  colors: sanitizeScenarioColorList(payload.colors)
};
process.stdout.write(JSON.stringify(result));
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(payload)],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


class DevWorkspaceNormalizersContractTest(unittest.TestCase):
    def test_tag_normalization_uppercases_and_strips_inner_whitespace(self):
        output = run_normalizers({
            "tag": "  a b\tc  ",
            "name": "",
            "color": "",
            "colors": [],
        })
        self.assertEqual(output["tag"], "ABC")

    def test_name_normalization_collapses_whitespace(self):
        output = run_normalizers({
            "tag": "",
            "name": "  Alpha\n  Beta\tGamma  ",
            "color": "",
            "colors": [],
        })
        self.assertEqual(output["name"], "Alpha Beta Gamma")

    def test_color_normalization_and_sanitization_keep_hex6_unique(self):
        output = run_normalizers({
            "tag": "",
            "name": "",
            "color": " ab12ef ",
            "colors": ["ab12ef", "#AB12EF", " #12 34 56 ", "#abc", "#GGGGGG", ""],
        })
        self.assertEqual(output["color"], "#AB12EF")
        self.assertEqual(output["colors"], ["#AB12EF", "#123456"])


if __name__ == "__main__":
    unittest.main()
