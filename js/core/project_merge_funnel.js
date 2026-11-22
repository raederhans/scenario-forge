import { normalizeHexColor } from "./color_hex_utils.js";
import { FileManager } from "./file_manager.js";
import { projectEditor } from "./hgo_project_routing.js";
import { captureImportDocumentIdentity, getDocumentEditGate } from "./interaction_funnel.js";
import { prepareProjectImportFile } from "./project_package_io.js";
import { applyProjectPaintMerge, loadScenarioReferenceData, planProjectPaintMerge } from "./project_paint_merge.js";
import { state } from "./state.js";

function assertDocumentEditable() {
  const { reason } = getDocumentEditGate();
  if (reason) {
    const messages = {
      "import-in-progress": "Project import is already in progress.",
      "import-recovery-required": "The project was imported, but editing is paused until map recovery succeeds.",
      "scenario-apply-in-progress": "Wait for the scenario to finish loading.",
      "startup-readonly": "Detailed interactions are still loading. Pan and zoom remain available.",
    };
    throw Object.assign(new Error(reason), { userMessage: messages[reason] });
  }
}

export async function prepareProjectMergeFile(file, { loadReference = loadScenarioReferenceData } = {}) {
  assertDocumentEditable();
  const prepared = await prepareProjectImportFile(file, { materializeFile: false });
  const payload = prepared.preview ? prepared.projectPayload : JSON.parse(await file.text());
  if (projectEditor(payload) !== "main") {
    throw Object.assign(new Error("HGO project"), { userMessage: "Open this HGO project in the HGO editor." });
  }
  const riverPaint = payload?.riverPaint;
  if (riverPaint != null) delete payload.riverPaint;
  const source = FileManager.normalizeImportedProjectData(payload);
  source.riverPaint = riverPaint;
  const invalidLabels = Object.keys(payload.legendLabels || {}).filter(key => !normalizeHexColor(key));
  const sourceReference = await loadReference(source.scenario?.id || "");

  return function preview({ mode, colorPolicy } = {}) {
    assertDocumentEditable();
    const isCurrent = captureImportDocumentIdentity(state);
    const plan = planProjectPaintMerge(source, state, { mode, colorPolicy, sourceReference, fileName: file.name });
    for (const id of invalidLabels) plan.report.invalidColors.push({ field: "legendLabels", id });
    return {
      report: { ...plan.report, addedLegendLabels: Object.entries(plan.patch.legendLabels) },
      commit() {
        assertDocumentEditable();
        if (!isCurrent()) return "stale";
        return applyProjectPaintMerge(state, plan) ? "merged" : "unchanged";
      },
    };
  };
}
