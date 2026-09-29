import {
  applyRiverCellOverride, createDefaultRiverPaintState, getActiveRiverPack,
  getRiverParentCompatibility, getRiverPartitionIndex, normalizeRiverPaintState,
} from '../../river_paint/partition_model.js';

function requireState(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('River paint requires a state object');
}

export function setRiverPaintState(target, value) {
  requireState(target);
  const next = normalizeRiverPaintState(value);
  target.riverPaint = next;
  return next;
}

export function setRiverPaintEditModeState(target, enabled) {
  requireState(target);
  target.riverPaint = { ...(target.riverPaint || createDefaultRiverPaintState()), editMode: enabled === true };
  return target.riverPaint;
}

export function applyRiverCellPaintState(target, cellId, color, { remove = false } = {}) {
  requireState(target);
  const pack = getActiveRiverPack(target.riverPaint, target.activeScenarioId, target.scenarioBaselineHash || '');
  const cell = getRiverPartitionIndex(pack)?.cells.get(cellId);
  if (!cell) throw new Error('River partition is not available in the current scenario');
  const parent = target.landIndex?.get(cell.parentId);
  if (getRiverParentCompatibility(pack, parent, cell.parentId).status !== 'ready') {
    throw new Error('River partition parent geometry is not ready');
  }
  const result = applyRiverCellOverride(target.riverPaint, cellId, color, { remove });
  if (result.changed) target.riverPaint = result.paint;
  return result;
}

// Validate the entire sparse undo patch before any write. Missing keys are deletes.
export function restoreRiverPaintOverridesState(target, patch) {
  requireState(target);
  if (patch == null) return false;
  if (typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Invalid river paint history');
  const index = getRiverPartitionIndex(target.riverPaint?.pack);
  const entries = Object.entries(patch);
  for (const [cellId, color] of entries) {
    if (!index?.cells.has(cellId) || (color != null && !/^#[0-9a-f]{6}$/i.test(color))) {
      throw new TypeError('Invalid river paint history entry');
    }
  }
  if (!entries.length) return false;
  const overrides = { ...target.riverPaint.overrides };
  for (const [cellId, color] of entries) {
    if (color == null) delete overrides[cellId];
    else overrides[cellId] = color.toLowerCase();
  }
  target.riverPaint = { ...target.riverPaint, overrides };
  return true;
}

export function clearAllRiverPaintOverridesState(target) {
  requireState(target);
  if (!target.riverPaint || !Object.keys(target.riverPaint.overrides || {}).length) return false;
  target.riverPaint = { ...target.riverPaint, overrides: {} };
  return true;
}

