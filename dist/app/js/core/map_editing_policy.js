// Product capability boundary. Map/scenario reference data remains readable.
// No runtime flag, imported project, or developer mode can enable ownership edits.
export const MAP_EDITING_CAPABILITIES = Object.freeze({
  visualPainting: true,
  ownershipEditing: false,
});

export function isOwnershipEditingEnabled() {
  return MAP_EDITING_CAPABILITIES.ownershipEditing;
}

export function normalizePaintMode(_requestedMode) {
  return "visual";
}

export function ownershipEditingDisabledResult(requestedCount = 0) {
  return {
    applied: false,
    changed: 0,
    matchedCount: 0,
    requestedCount: Number.isSafeInteger(requestedCount) && requestedCount > 0 ? requestedCount : 0,
    missingCount: 0,
    reason: "ownership-editing-disabled",
    mode: "ownership",
  };
}
