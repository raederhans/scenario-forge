from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DOC_FILES = [
    REPO_ROOT / "docs" / "active" / "refactor_and_perf_2026-04-20" / "README.md",
    REPO_ROOT / "docs" / "active" / "refactor_and_perf_2026-04-20" / "context.md",
    REPO_ROOT / "docs" / "active" / "refactor_and_perf_2026-04-20" / "plan.md",
    REPO_ROOT / "docs" / "active" / "refactor_and_perf_2026-04-20" / "task.md",
    REPO_ROOT / "docs" / "active" / "refactor_and_perf_2026-04-20" / "step0_perf_probe_skeleton.md",
]


class RefactorAndPerfPlanContractTest(unittest.TestCase):
    def test_docs_drop_stale_active_further_split_refs(self):
        for path in DOC_FILES:
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("docs/active/further_split", content, path.name)

    def test_docs_pin_archive_path_and_default_scenario_step0(self):
        combined = "\n".join(path.read_text(encoding="utf-8") for path in DOC_FILES)
        self.assertIn("docs/archive/further_split/", combined)
        self.assertIn("default_scenario", combined)

    def test_docs_mark_runtime_hooks_step_as_next_round(self):
        combined = "\n".join(path.read_text(encoding="utf-8") for path in DOC_FILES)
        self.assertIn("Step 4 后移到下一轮", combined)
        self.assertIn("state.runtimeHooks.*", combined)


if __name__ == "__main__":
    unittest.main()
