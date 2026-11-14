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

