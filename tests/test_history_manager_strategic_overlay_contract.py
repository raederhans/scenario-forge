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
        result = self._run_node_json(textwrap.dedent(
            """
            const { state } = await import("./js/core/state.js");
            const { captureHistoryState } = await import("./js/core/history_manager.js");
            state.operationalLines = [{ id: "line", points: [[1, 2], [3, 4]] }];
            state.operationGraphics = [{ id: "graphic" }];
            state.unitCounters = [{ id: "unit" }];
            const full = captureHistoryState({ strategicOverlay: true });
            const scoped = captureHistoryState({ strategicOverlay: ["operationalLines", "sovereigntyByFeatureId"] });
            state.operationalLines[0].points[0][0] = 99;
            scoped.operationalLines[0].points[1][1] = 88;
            console.log(JSON.stringify({
              full, scoped, live: state.operationalLines,
              ordinary: captureHistoryState({ featureIds: ["a"] }),
            }));
            """
        ))
        self.assertEqual(result["full"]["operationalLines"][0]["points"], [[1, 2], [3, 4]])
        self.assertEqual(result["full"]["operationGraphics"], [{"id": "graphic"}])
        self.assertEqual(result["full"]["unitCounters"], [{"id": "unit"}])
        self.assertEqual(set(result["scoped"]), {"operationalLines"})
        self.assertEqual(result["scoped"]["operationalLines"][0]["points"], [[1, 2], [3, 88]])
        self.assertEqual(result["live"][0]["points"], [[99, 2], [3, 4]])
        self.assertNotIn("operationalLines", result["ordinary"])

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
              specialZoneMembershipBrushMode: "add",
              specialZoneLayers: {
                version: 1,
                layers: [{
                  id: "zone-a",
                  name: "Zone A",
                  visible: true,
                  legendVisible: true,
                  style: { fill: "#112233", stroke: "#445566", pattern: "solid" },
                  memberFeatureIds: ["a"],
                }],
                activeLayerId: "zone-a",
                diagnostics: [],
              },
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
            state.specialZoneMembershipBrushMode = "remove";
            state.specialZoneLayers = {
              ...state.specialZoneLayers,
              layers: [{
                ...state.specialZoneLayers.layers[0],
                memberFeatureIds: ["a", "b"],
              }],
            };
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
              specialZoneMembershipBrushMode: state.specialZoneMembershipBrushMode,
              specialZoneMembers: state.specialZoneLayers.layers[0].memberFeatureIds,
              specialZonesOverlayDirty: state.specialZonesOverlayDirty,
            };

            redoHistory();
            const afterRedo = {
              operationalLines: JSON.parse(JSON.stringify(state.operationalLines)),
              overlayUiCalls: calls.overlayUi,
              dirtyRevision: state.dirtyRevision,
              isDirty: state.isDirty,
              operationalLinesDirty: state.operationalLinesDirty,
              specialZoneMembershipBrushMode: state.specialZoneMembershipBrushMode,
              specialZoneMembers: state.specialZoneLayers.layers[0].memberFeatureIds,
              specialZonesOverlayDirty: state.specialZonesOverlayDirty,
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
        self.assertEqual(result["afterUndo"]["specialZoneMembershipBrushMode"], "add")
        self.assertEqual(result["afterRedo"]["specialZoneMembershipBrushMode"], "remove")
        self.assertEqual(result["afterUndo"]["specialZoneMembers"], ["a"])
        self.assertEqual(result["afterRedo"]["specialZoneMembers"], ["a", "b"])
        self.assertTrue(result["afterUndo"]["specialZonesOverlayDirty"])
        self.assertTrue(result["afterRedo"]["specialZonesOverlayDirty"])
        self.assertTrue(result["afterUndo"]["isDirty"])
        self.assertTrue(result["afterRedo"]["isDirty"])
        self.assertGreaterEqual(result["afterUndo"]["dirtyRevision"], 1)
        self.assertGreaterEqual(result["afterRedo"]["dirtyRevision"], 2)
        self.assertEqual(result["flushes"], ["history-undo", "history-redo"])

    def test_undo_redo_replays_unified_intensity_field_channel(self):
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
            const { createIntensityFieldsState, sampleIntensityField } = await import("./js/core/intensity_field.js");
            const { updateIntensityFieldChannel } = await import("./js/core/state/intensity_field_state.js");
            const { captureHistoryState, pushHistoryEntry, undoHistory, redoHistory } = await import("./js/core/history_manager.js");

            const calls = { toolbar: 0, flushes: [] };
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
              isDirty: false,
              dirtyRevision: 0,
              updateHistoryUIFn() {},
              updateToolUIFn() {},
              updateSwatchUIFn() {},
              updatePaintModeUIFn() {},
              updateToolbarInputsFn() { calls.toolbar += 1; },
              updateActiveSovereignUIFn() {},
              renderCountryListFn() {},
              renderWaterRegionListFn() {},
              renderSpecialRegionListFn() {},
              renderPresetTreeFn() {},
              updateLegendUI() {},
              updateStrategicOverlayUIFn() {},
              refreshColorStateFn() {},
              recomputeDynamicBordersNowFn() {},
            });
            let fields = updateIntensityFieldChannel(createIntensityFieldsState(), "physicalAtlas", (channel) => {
              channel.enabled = true;
              channel.points = [{ id: "before", lon: 10, lat: 46, strength: 1.6, radiusDeg: 6, falloff: "smooth" }];
            });
            fields = updateIntensityFieldChannel(fields, "physicalContour", (channel) => {
              channel.enabled = true;
              channel.points = [{ id: "contour-stable", lon: -20, lat: 10, strength: 1.8, radiusDeg: 5, falloff: "smooth" }];
            });
            state.intensityFields = fields;

            const before = captureHistoryState({ intensityFieldChannels: ["physicalAtlas"] });
            state.intensityFields = updateIntensityFieldChannel(state.intensityFields, "physicalAtlas", (channel) => {
              channel.enabled = true;
              channel.points = [{ id: "after", lon: 10, lat: 46, strength: 0.45, radiusDeg: 6, falloff: "linear" }];
            });
            const after = captureHistoryState({ intensityFieldChannels: ["physicalAtlas"] });

            pushHistoryEntry({ before, after, meta: { kind: "intensity-field-channel" } });
            undoHistory();
            const afterUndo = {
              pointId: state.intensityFields.channels.physicalAtlas.points[0].id,
              sample: sampleIntensityField(state.intensityFields, "physicalAtlas", 10, 46),
              contourPointId: state.intensityFields.channels.physicalContour.points[0].id,
              contourSample: sampleIntensityField(state.intensityFields, "physicalContour", -20, 10),
            };
            redoHistory();
            const afterRedo = {
              pointId: state.intensityFields.channels.physicalAtlas.points[0].id,
              sample: sampleIntensityField(state.intensityFields, "physicalAtlas", 10, 46),
              contourPointId: state.intensityFields.channels.physicalContour.points[0].id,
              contourSample: sampleIntensityField(state.intensityFields, "physicalContour", -20, 10),
            };

            console.log(JSON.stringify({
              afterUndo,
              afterRedo,
              toolbarCalls: calls.toolbar,
              dirtyRevision: state.dirtyRevision,
              flushes: calls.flushes,
            }));
            """
        ))

        self.assertEqual(result["afterUndo"]["pointId"], "before")
        self.assertGreater(result["afterUndo"]["sample"], 1.3)
        self.assertEqual(result["afterUndo"]["contourPointId"], "contour-stable")
        self.assertGreater(result["afterUndo"]["contourSample"], 1.5)
        self.assertEqual(result["afterRedo"]["pointId"], "after")
        self.assertLess(result["afterRedo"]["sample"], 0.8)
        self.assertEqual(result["afterRedo"]["contourPointId"], "contour-stable")
        self.assertGreater(result["afterRedo"]["contourSample"], 1.5)
        self.assertGreaterEqual(result["toolbarCalls"], 2)
        self.assertGreaterEqual(result["dirtyRevision"], 2)
        self.assertEqual(result["flushes"], ["history-undo", "history-redo"])


if __name__ == "__main__":
    unittest.main()
