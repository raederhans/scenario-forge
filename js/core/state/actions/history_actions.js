// Canonical history-stack publication. Entries remain borrowed; callers own
// capture, rollback ordering, notifications and undo/redo orchestration.
export function restoreHistoryStacksState(target, past, future) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[history_actions] target must be an object");
  }
  if (!Array.isArray(past) || !Array.isArray(future)) {
    throw new TypeError("[history_actions] both stacks must be arrays");
  }
  target.historyPast = past;
  target.historyFuture = future;
}
