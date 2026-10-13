import { createHash } from "node:crypto";
import { parse } from "acorn";
import { VISUAL_PAINT_ACTION_PATH, VISUAL_PAINT_ACTION_SOURCE_FINGERPRINT, inspectVisualPaintInputSites } from "./state_visual_paint_contract.mjs";

const normalize = (source) => String(source).replace(/\r\n?/g, "\n");
const fingerprint = (source) => createHash("sha256").update(normalize(source)).digest("hex");
const sourceRevision = "311e5dfe8f335ec11817aabd7e2fda4f49c1ba52";
const receipts = Object.freeze([
  ["js/core/map_renderer.js", "93c5f0e16585f8ff9916c3fe2d884c191aa9aa479b8967256e8be842e2893c81", "f8a43c8a280d0e63cfbfeb010747181713534ac3a6230a7a0f806d671e6a4855", "viewport"],
  ["js/core/state/color_state.js", "7f8c97d4a14f27f97b39e0385eabda857204529880b39e807d3d168b42892e59", "8a3fc8d0320e36dfd31452bb8ea6bb3c7ec3cda9d66a41ce68d19f30c408fa20", "paint-wrapper"],
  ["js/core/state/actions/scenario_activation_actions.js", "4dda5e6240f1eaaf632f60f8360905fcfcb8d93d2773d0398af0292423c61e0e", "6365c4a5606a990bc4ea58bf719c940bcd9bfdd1766ade2166c493f689a8f4a8", "paint-import"],
].map(([modulePath, previousFingerprint, sourceFingerprint, kind]) => Object.freeze({ modulePath, previousFingerprint, sourceFingerprint, kind })));

function topFunction(source, name) {
  return parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .map((node) => node.declaration || node)
    .find((node) => node.type === "FunctionDeclaration" && node.id?.name === name);
}

// Preserve original retirement identities and source anchors. These receipts
// admit only three exact transformations, while retirement mutation checks and
// historical site counts still run in the caller.
export function inspectBoundedGovernanceSourceRefresh({
  modulePath, sourceFingerprint, source, readCurrentSource, readHistoricalSource,
}) {
  const receipt = receipts.find((entry) => entry.modulePath === modulePath && entry.previousFingerprint === sourceFingerprint);
  if (!receipt) return null;
  try {
    const current = normalize(source);
    const previous = normalize(readHistoricalSource(sourceRevision, modulePath));
    if (fingerprint(current) !== receipt.sourceFingerprint || fingerprint(previous) !== receipt.previousFingerprint) return false;
    if (receipt.kind === "viewport") {
      const owner = normalize(readCurrentSource("js/core/renderer/viewport_command_owner.js"));
      const factory = topFunction(owner, "createViewportCommandOwner");
      if (!factory || fingerprint(owner.slice(factory.start, factory.end)) !== "5819a7cd34b87a4e49547763a963f48cc1ba182985669c25fcb3943ca38ebb56") return false;
      const oldFn = topFunction(previous, "getViewportCommandOwner");
      const newFn = topFunction(current, "getViewportCommandOwner");
      // Only these two viewport forwarders and their exports were added outside
      // the composition. Keep every historical source byte and retirement anchor.
      const forwarders = "function captureViewportView() {\n  return getViewportCommandOwner().captureViewportView();\n}\n\n"
        + "function restoreViewportView(view) {\n  return getViewportCommandOwner().restoreViewportView(view);\n}\n\n";
      const exports = "  // Viewport, diagnostics, and render scheduling facade.\n  captureViewportView,\n  restoreViewportView,\n";
      if (current.split(forwarders).length !== 2 || current.split(exports).length !== 2) return false;
      const withoutForwarders = current.replace(forwarders, "")
        .replace(exports, "  // Viewport, diagnostics, and render scheduling facade.\n");
      return !!oldFn && !!newFn && withoutForwarders === previous.slice(0, oldFn.start)
        + current.slice(newFn.start, newFn.end) + previous.slice(oldFn.end);
    }
    const action = normalize(readCurrentSource(VISUAL_PAINT_ACTION_PATH));
    if (fingerprint(action) !== VISUAL_PAINT_ACTION_SOURCE_FINGERPRINT
      || inspectVisualPaintInputSites(action, { readSource: readCurrentSource }).violations.length) return false;
    if (receipt.kind === "paint-import") {
      const before = 'import { applyFeaturePaintState } from "../color_state.js";';
      return previous.split(before).length === 2 && current === previous.replace(before,
        'import { applyFeaturePaintState } from "./visual_paint_actions.js";');
    }
    const oldFn = topFunction(previous, "applyFeaturePaintState");
    const newFn = topFunction(current, "applyFeaturePaintState");
    const movedFn = topFunction(action, "applyFeaturePaintState");
    if (!oldFn || !newFn || !movedFn || previous.slice(oldFn.start, oldFn.end) !== action.slice(movedFn.start, movedFn.end)) return false;
    const reconstructed = (previous.slice(0, oldFn.start) + current.slice(newFn.start, newFn.end) + previous.slice(oldFn.end))
      .replace('import { clearRiverCellOverrides, createDefaultRiverPaintState } from "../river_paint/partition_model.js";',
        'import { createDefaultRiverPaintState } from "../river_paint/partition_model.js";')
      .replace('import { normalizeHexColor } from "../color_hex_utils.js";',
        'import { applyFeaturePaintState as applyVisualFeaturePaintState } from "./actions/visual_paint_actions.js";');
    return current === reconstructed;
  } catch {
    return false;
  }
}
