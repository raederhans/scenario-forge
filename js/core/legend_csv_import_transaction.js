import { state } from "./state.js";
import { buildLegendCsvCurrentModel } from "./legend_csv_schema.js";
import { buildLegendCsvImportPreview } from "./legend_csv_import_preview.js";
import { normalizeHexColor } from "./color_hex_utils.js";
import { setLegendLabelState, restoreLegendLabelSnapshotState } from "./state/actions/legend_actions.js";
import { patchSpecialZoneLegendFieldsState, restoreSpecialZoneLegendSnapshotState } from "./state/actions/special_zone_actions.js";
import { captureHistoryState, hasHistoryDelta, pushHistoryEntry } from "./history_manager.js";
import { markDirtyState } from "./state/actions/ui_dirty_actions.js";

function importError(code) {
  return Object.assign(new Error(code), { code });
}

/** Only a displayed, explicitly confirmed selection can reach canonical writes. */
export function applyLegendCsvImport({ target = state, source, selectedRecords = [], preview, confirmed = false } = {}) {
  if (target !== state) throw importError("history-target-mismatch");
  if (!confirmed || !preview || preview.sourceText !== source) throw importError("confirmation-required");
  if (preview.formatVersion !== 2) throw importError("legacy-readonly");
  const records = [...new Set(selectedRecords)];
  if (!records.length || records.some(record => !Number.isInteger(record))) throw importError("no-selection");
  const model = buildLegendCsvCurrentModel(state);
  const current = buildLegendCsvImportPreview(source, model.entries, model);
  if (current.formatVersion !== 2 || current.scope.scenarioId !== preview.scope?.scenarioId
    || current.scope.scenarioBaselineHash !== preview.scope?.scenarioBaselineHash) throw importError("stale-preview");
  const expectedRows = new Map(preview.rows.map(row => [row.record, row]));
  const currentRows = new Map(current.rows.map(row => [row.record, row]));
  // Validate the entire selected batch before the first write. Unknown, duplicate,
  // invalid and changed targets cannot slip through by changing the selection.
  const selected = records.map(record => {
    const expected = expectedRows.get(record);
    const row = currentRows.get(record);
    if (!expected?.canApply || !row?.canApply || !expected.targetSignature
      || expected.targetSignature !== row.targetSignature) throw importError("stale-preview");
    return row;
  });
  const legendColors = [];
  const legendSpecialZoneIds = [];
  const zonePatches = Object.create(null);
  for (const row of selected) {
    if (row.entry.kind === "color") { legendColors.push(row.entry.entryId.slice("category:".length)); continue; }
    const id = row.entry.entryId.slice("special-zone:".length);
    legendSpecialZoneIds.push(id);
    const patch = {};
    if (row.entry.label.trim() !== row.currentEntry.label) patch.name = row.entry.label.trim();
    const proposed = { fill: normalizeHexColor(row.entry.color), stroke: normalizeHexColor(row.entry.stroke), pattern: row.entry.pattern,
      fillOpacity: Number(row.entry.fillOpacity), strokeOpacity: Number(row.entry.strokeOpacity),
      patternOpacity: Number(row.entry.patternOpacity), strokeWidth: Number(row.entry.strokeWidth) };
    const existing = { ...row.currentEntry, fill: row.currentEntry.color };
    const style = Object.fromEntries(Object.entries(proposed).filter(([key, value]) => existing[key] !== value));
    if (Object.keys(style).length) {
      const layer = state.specialZoneLayers.layers.find(value => value.id === id);
      style.revision = Math.max(1, Number(layer.style?.revision) || 1) + 1;
      patch.style = style;
    }
    zonePatches[id] = patch;
  }
  const scope = { legendColors, legendSpecialZoneIds };
  const before = captureHistoryState(scope);
  const oldDirty = state.specialZonesOverlayDirty;
  const past = [...(state.historyPast || [])];
  const future = [...(state.historyFuture || [])];
  try {
    for (const row of selected) {
      if (row.entry.kind === "color") setLegendLabelState(state, row.entry.entryId.slice("category:".length), row.entry.label.trim());
    }
    const appliedZoneIds = patchSpecialZoneLegendFieldsState(state, zonePatches);
    if (appliedZoneIds.length !== legendSpecialZoneIds.length) throw importError("stale-preview");
    const after = captureHistoryState(scope);
    if (!hasHistoryDelta(before, after)) return { appliedCount: 0, skippedCount: current.rows.length };
    if (!pushHistoryEntry({ kind: "legend-csv-import", before, after,
      meta: { affectsSovereignty: false, scenarioId: model.scenarioId, scenarioBaselineHash: model.scenarioBaselineHash } })) {
      throw importError("history-unavailable");
    }
  } catch (error) {
    if (before.legendLabels) restoreLegendLabelSnapshotState(state, before.legendLabels, before.legendLabelKeysPresent);
    if (before.specialZoneLegendFields) restoreSpecialZoneLegendSnapshotState(state, before.specialZoneLegendFields);
    state.specialZonesOverlayDirty = oldDirty;
    state.historyPast = past;
    state.historyFuture = future;
    throw error;
  }
  // The history commit succeeded; visual/UI refresh belongs to the caller.
  markDirtyState(state, "legend-csv-import");
  return { appliedCount: selected.length, skippedCount: current.rows.length - selected.length };
}
