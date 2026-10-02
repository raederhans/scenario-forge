import { getMapDataBoundary } from '../map_data_boundary.js';
import { applyRiverCellPaintState } from '../state/actions/river_paint_actions.js';
import { getRiverPaintRuntime } from './runtime.js';

// A paint target remains (parentId, cellId). Only this command path writes a
// child override; country/reference selection continues to receive parent IDs.
export function createRiverPaintEditorOwner({ state, captureHistoryState, commitHistoryEntry,
  refreshParents, markDirty, addRecentColor, selectColor, announce = () => {}, nowMs = () => 0 } = {}) {
  const runtime = getRiverPaintRuntime(state);
  function eligible(hit) {
    if (!hit?.riverCellId && !hit?.riverBlockedReason) return false;
    if (hit.riverBlockedReason) return true;
    const pack = runtime.getActivePack();
    return hit.riverPackId !== pack?.packId || runtime.getCellFeature(hit.riverCellId)?.properties?.__riverParentId !== hit.id
      ? 'stale' : true;
  }
  function apply(hit, { brushSession = null } = {}) {
    const accepted = eligible(hit);
    if (!accepted) return { consumed: false, changed: false };
    if (hit.riverBlockedReason || accepted === 'stale') {
      if (!brushSession) announce(hit.riverBlockedReason || 'stale');
      return { consumed: true, changed: false };
    }
    const cellId = hit.riverCellId;
    if (state.currentTool === 'eyedropper') {
      const color = getMapDataBoundary(state).paint.resolveRiverCellColor(cellId).color;
      if (color) selectColor(color);
      return { consumed: true, changed: false };
    }
    // A delayed click must not turn into a whole-parent fill after a mode change.
    if (!state.riverPaint?.editMode || state.interactionGranularity === 'country'
      || !['fill', 'eraser'].includes(state.currentTool)) return { consumed: true, changed: false };
    if (brushSession?.visitedRiverCellIds?.has(cellId)) return { consumed: true, changed: false };
    const started = nowMs();
    const before = captureHistoryState({ riverCellIds: [cellId] });
    const remove = state.currentTool === 'eraser';
    const result = applyRiverCellPaintState(state, cellId, state.selectedColor, { remove });
    if (brushSession) {
      brushSession.visitedRiverCellIds ||= new Set();
      brushSession.visitedRiverCellIds.add(cellId);
    }
    if (!result.changed) return { consumed: true, changed: false };
    const reason = remove ? 'river-cell-erase' : 'river-cell-fill';
    if (brushSession) {
      brushSession.affectedRiverCellIds ||= new Set();
      brushSession.affectedRiverCellIds.add(cellId);
      brushSession.riverParentIds ||= new Set();
      brushSession.riverParentIds.add(hit.id);
      brushSession.before.riverPaintOverrides ||= {};
      // Never overwrite a first-touch snapshot when another bank is visited.
      for (const [id, color] of Object.entries(before.riverPaintOverrides || {})) {
        if (!Object.hasOwn(brushSession.before.riverPaintOverrides, id)) brushSession.before.riverPaintOverrides[id] = color;
      }
      brushSession.changed = true;
    } else {
      commitHistoryEntry({ kind: reason, before, after: captureHistoryState({ riverCellIds: [cellId] }) });
      markDirty(reason);
      if (!remove) addRecentColor(state.selectedColor);
    }
    refreshParents([hit.id], { renderNow: true, inputStartedAt: started, inputLabel: reason,
      coalescePatchPreview: !!brushSession });
    return { consumed: true, changed: true };
  }
  return Object.freeze({
    handleClick(hit) { return apply(hit).consumed; },
    handleBrush(hit, brushSession) { return apply(hit, { brushSession }); },
  });
}
