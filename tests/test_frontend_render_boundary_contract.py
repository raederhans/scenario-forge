from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]


class FrontendRenderBoundaryContractTest(unittest.TestCase):
    def test_mainline_modules_do_not_directly_call_render_now(self):
        targets = [
            REPO_ROOT / "js" / "main.js",
            REPO_ROOT / "js" / "ui" / "sidebar.js",
            REPO_ROOT / "js" / "core" / "map_renderer.js",
            REPO_ROOT / "js" / "ui" / "dev_workspace.js",
            REPO_ROOT / "js" / "core" / "scenario_ownership_editor.js",
            REPO_ROOT / "js" / "core" / "history_manager.js",
            REPO_ROOT / "js" / "ui" / "shortcuts.js",
        ]

        offenders = []
        needle = "state.renderNowFn("
        for path in targets:
            content = path.read_text(encoding="utf-8")
            if needle in content:
                offenders.append(path.relative_to(REPO_ROOT).as_posix())

        self.assertEqual(
            offenders,
            [],
            msg=f"Direct renderNowFn calls reappeared in mainline modules: {', '.join(offenders)}",
        )


if __name__ == "__main__":
    unittest.main()
