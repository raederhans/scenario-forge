// Frame-budget scheduler for renderer follow-up work.
// It keeps exact-after-settle and interaction follow-ups off the input event call stack.
const DEFAULT_FRAME_BUDGET_MS = 8;
const PRIORITY_WEIGHT = {
  high: 0,
  normal: 1,
  low: 2,
};

const queue = [];
let scheduled = false;
let sequence = 0;

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function hasPendingInput() {
  const scheduler = globalThis.navigator?.scheduling;
  if (!scheduler || typeof scheduler.isInputPending !== "function") return false;
  try {
    return !!scheduler.isInputPending({ includeContinuous: true });
  } catch (error) {
    return !!scheduler.isInputPending();
  }
}

function scheduleDrain() {
  if (scheduled) return;
  scheduled = true;
  const drain = (deadline = null) => {
    scheduled = false;
    const idleBudget = deadline && typeof deadline.timeRemaining === "function"
      ? Math.max(1, deadline.timeRemaining())
      : DEFAULT_FRAME_BUDGET_MS;
    runFrameTasks(Math.min(DEFAULT_FRAME_BUDGET_MS, idleBudget));
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(drain, { timeout: 80 });
    return;
  }
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => drain(null));
    return;
  }
  globalThis.setTimeout(() => drain(null), 0);
}

export function enqueueFrameTask(task, { priority = "normal", label = "task" } = {}) {
  if (typeof task !== "function") return null;
  const entry = {
    id: sequence += 1,
    task,
    priority: Object.prototype.hasOwnProperty.call(PRIORITY_WEIGHT, priority) ? priority : "normal",
    label: String(label || "task"),
    canceled: false,
  };
  queue.push(entry);
  scheduleDrain();
  return {
    id: entry.id,
    cancel() {
      entry.canceled = true;
    },
  };
}

export function runFrameTasks(budgetMs = DEFAULT_FRAME_BUDGET_MS) {
  const startedAt = nowMs();
  const budget = Math.max(1, Number(budgetMs) || DEFAULT_FRAME_BUDGET_MS);
  queue.sort((left, right) => {
    const priorityDelta = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
    return priorityDelta || (left.id - right.id);
  });
  while (queue.length) {
    if (nowMs() - startedAt >= budget) break;
    if (hasPendingInput()) break;
    const entry = queue.shift();
    if (!entry || entry.canceled) continue;
    try {
      entry.task({
        label: entry.label,
        elapsedMs: Math.max(0, nowMs() - startedAt),
        budgetMs: budget,
      });
    } catch (error) {
      // One failed renderer slice must not strand later exact-frame tasks.
      console.error("[frame-scheduler] task failed", error);
    }
  }
  if (queue.some((entry) => !entry.canceled)) {
    scheduleDrain();
  }
}

export function getFrameSchedulerQueueLength() {
  return queue.filter((entry) => !entry.canceled).length;
}
