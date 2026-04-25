from pathlib import Path
import json
import subprocess
import textwrap
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
HISTORY_MANAGER_JS = REPO_ROOT / "js" / "core" / "history_manager.js"


class HistoryManagerStrategicOverlayContractTest(unittest.TestCase):
    def _run_node_json(self, script: str):
        completed = subprocess.run(
            ["node", "--experimental-default-type=module", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise AssertionError(
                "Node behavior test failed.\n"
                f"STDOUT:\n{completed.stdout}\n"
                f"STDERR:\n{completed.stderr}"
            )
        return json.loads(completed.stdout)

    def test_capture_snapshot_includes_operational_lines_contract(self):
        content = HISTORY_MANAGER_JS.read_text(encoding="utf-8")

        self.assertIn("snapshot.operationalLines = cloneStructuredValue(runtimeState.operationalLines || []);", content)

    def test_undo_redo_replays_operational_lines_and_marks_dirty(self):
        result = self._run_node_json(textwrap.dedent(
            """
            globalThis.document = {
              body: { classList: { toggle() {} } },
              getElementById() { return null; },
            };
            globalThis.window = globalThis;
            globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
            globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);

            const { state } = await import("./js/core/state.js");
            const { bindRenderBoundary } = await import("./js/core/render_boundary.js");
            const { captureHistoryState, pushHistoryEntry, undoHistory, redoHistory } = await import("./js/core/history_manager.js");

            const calls = {
              overlayUi: 0,
              historyUi: 0,
              flushes: [],
            };

            bindRenderBoundary({
              flushRender(payload = {}) {
                calls.flushes.push(String(payload.reason || ""));
              },
            });

            Object.assign(state, {
              historyPast: [],
              historyFuture: [],
              historyMax: 80,
              visualOverrides: {},
              featureOverrides: {},
              waterRegionOverrides: {},
              specialRegionOverrides: {},
              sovereignBaseColors: {},
              countryBaseColors: {},
              countryPalette: {},
              sovereigntyByFeatureId: {},
              scenarioControllersByFeatureId: {},
              annotationView: {
                frontlineEnabled: true,
                frontlineStyle: "clean",
              },
              operationalLines: [{
                id: "line-before",
                label: "Before",
                kind: "frontline",
                points: [[1, 2], [3, 4]],
              }],
              operationGraphics: [],
              unitCounters: [],
              frontlineOverlayDirty: false,
              operationalLinesDirty: false,
              operationGraphicsDirty: false,
              unitCountersDirty: false,
              isDirty: false,
              dirtyRevision: 0,
              lastDirtyReason: "",
              updateHistoryUIFn() {
                calls.historyUi += 1;
              },
              updateToolUIFn() {},
              updateSwatchUIFn() {},
              updatePaintModeUIFn() {},
              updateToolbarInputsFn() {},
              updateActiveSovereignUIFn() {},
              renderCountryListFn() {},
              renderWaterRegionListFn() {},
              renderSpecialRegionListFn() {},
              renderPresetTreeFn() {},
              updateLegendUI() {},
              updateStrategicOverlayUIFn() {
                calls.overlayUi += 1;
              },
              refreshColorStateFn() {},
              recomputeDynamicBordersNowFn() {},
            });

            const before = captureHistoryState({ strategicOverlay: true });
            state.operationalLines = [{
              id: "line-after",
              label: "After",
              kind: "axis",
              points: [[9, 9], [10, 10]],
            }];
            const after = captureHistoryState({ strategicOverlay: true });

            pushHistoryEntry({
              before,
              after,
              meta: { kind: "test-strategic-overlay-history" },
            });

            undoHistory();
            const afterUndo = {
              operationalLines: JSON.parse(JSON.stringify(state.operationalLines)),
              overlayUiCalls: calls.overlayUi,
              dirtyRevision: state.dirtyRevision,
              isDirty: state.isDirty,
              operationalLinesDirty: state.operationalLinesDirty,
            };

            redoHistory();
            const afterRedo = {
              operationalLines: JSON.parse(JSON.stringify(state.operationalLines)),
              overlayUiCalls: calls.overlayUi,
              dirtyRevision: state.dirtyRevision,
              isDirty: state.isDirty,
              operationalLinesDirty: state.operationalLinesDirty,
            };

            console.log(JSON.stringify({
              historyPastLength: state.historyPast.length,
              historyFutureLength: state.historyFuture.length,
              afterUndo,
              afterRedo,
              flushes: calls.flushes,
            }));
            """
        ))

        self.assertEqual(result["historyPastLength"], 1)
        self.assertEqual(result["historyFutureLength"], 0)
        self.assertEqual(
            result["afterUndo"]["operationalLines"],
            [{
                "id": "line-before",
                "label": "Before",
                "kind": "frontline",
                "points": [[1, 2], [3, 4]],
            }],
        )
        self.assertEqual(
            result["afterRedo"]["operationalLines"],
            [{
                "id": "line-after",
                "label": "After",
                "kind": "axis",
                "points": [[9, 9], [10, 10]],
            }],
        )
        self.assertGreaterEqual(result["afterUndo"]["overlayUiCalls"], 1)
        self.assertGreaterEqual(result["afterRedo"]["overlayUiCalls"], 2)
        self.assertTrue(result["afterUndo"]["operationalLinesDirty"])
        self.assertTrue(result["afterRedo"]["operationalLinesDirty"])
        self.assertTrue(result["afterUndo"]["isDirty"])
        self.assertTrue(result["afterRedo"]["isDirty"])
        self.assertGreaterEqual(result["afterUndo"]["dirtyRevision"], 1)
        self.assertGreaterEqual(result["afterRedo"]["dirtyRevision"], 2)
        self.assertEqual(result["flushes"], ["history-undo", "history-redo"])


if __name__ == "__main__":
    unittest.main()
