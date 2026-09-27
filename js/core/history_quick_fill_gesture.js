// Pure history composition: immediate leaf feedback and one undo per recognized
// double-click, without delaying normal clicks or absorbing unrelated edits.
export function coalesceQuickFillGesture(previous, next) {
  const first = previous?.meta?.quickFillGesture;
  const batch = next?.meta?.quickFillGesture;
  if (first?.type !== "leaf-click" || batch?.type !== "double-click") return null;
  if (previous.kind !== "fill-feature-color" || !["fill-parent-group", "fill-country-batch"].includes(next.kind)) return null;
  if (first.featureId !== batch.featureId || first.color !== batch.color || first.scenarioId !== batch.scenarioId) return null;
  if (!Number.isFinite(first.timeStamp) || first.timeStamp <= 0 || batch.leadingClickTimeStamp !== first.timeStamp) return null;
  const elapsed = batch.timeStamp - first.timeStamp;
  // The browser already recognized dblclick and the caller binds its exact
  // leading click. Rendering can delay dispatch; elapsed wall time must not
  // split that gesture into two undo entries on slower machines.
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  if (previous.meta?.affectsSovereignty || next.meta?.affectsSovereignty) return null;
  const id = first.featureId;
  const before = { ...next.before };
  const oldBefore = previous.before?.visualOverrides;
  const oldAfter = previous.after?.visualOverrides;
  if (!oldBefore || !oldAfter || Object.keys(oldBefore).length !== 1 || !Object.hasOwn(oldBefore, id)) return null;
  if (!Object.hasOwn(next.before?.visualOverrides || {}, id) || oldAfter[id] !== next.before.visualOverrides[id]) return null;
  before.visualOverrides = { ...next.before.visualOverrides, [id]: oldBefore[id] };
  if (Object.keys(previous.before).some((key) => key !== "visualOverrides")) return null;
  return { ...next, before };
}
