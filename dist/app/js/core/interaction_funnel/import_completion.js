// One committed document owns this recovery job. Task-local cancellation also
// prevents a timed-out attempt from committing after a successful retry.
export function createProjectImportCompletion({
  required, optional, isCurrent, finalize, onState = () => {}, onFailure = () => {},
  requiredTimeoutMs = 120000, optionalTimeoutMs = 30000,
}) {
  const tasks = [...required, ...optional];
  const states = new Map(tasks.map(task => [task.name, "pending"]));
  const failures = new Map();
  const controller = new AbortController();
  let running = null;
  let optionalRun = null;
  let cancelled = false;
  let initialFinalized = false;
  const current = () => !cancelled && isCurrent();
  const snapshot = () => ({
    phase: !current() ? "cancelled"
      : !initialFinalized || required.some(task => states.get(task.name) !== "complete")
        ? required.some(task => states.get(task.name) === "failed") || states.get("project-ui") === "failed" ? "blocked" : "recovering"
        : failures.size ? "partial"
          : optional.some(task => states.get(task.name) !== "complete") ? "loading" : "complete",
    editable: current() && initialFinalized && required.every(task => states.get(task.name) === "complete"),
    tasks: Object.fromEntries(states),
    warnings: [...failures].map(([resource, error]) => ({ resource, message: String(error?.message || error) })),
  });
  const publish = () => { try { onState(snapshot()); } catch (error) { console.warn("Import recovery observer failed", error); } };
  async function execute(task, timeoutMs) {
    if (!current()) return false;
    const attempt = new AbortController();
    const abort = () => attempt.abort();
    controller.signal.addEventListener("abort", abort, { once: true });
    let timer;
    let rejectAbort;
    const valid = () => current() && !attempt.signal.aborted;
    states.set(task.name, "running");
    publish();
    try {
      const interrupted = new Promise((_, reject) => {
        rejectAbort = () => reject(Object.assign(new Error("Import completion cancelled."), { name: "AbortError" }));
        attempt.signal.addEventListener("abort", rejectAbort, { once: true });
        timer = setTimeout(() => {
          reject(new Error(`${task.name} timed out. Retry to continue.`));
          attempt.abort();
        }, timeoutMs);
      });
      const work = Promise.resolve().then(() => {
        if (!valid()) throw Object.assign(new Error("Import completion cancelled."), { name: "AbortError" });
        return task.run({ isCurrent: valid, signal: attempt.signal });
      });
      const result = await Promise.race([work, interrupted]);
      if (!valid()) return false;
      if (result === false) throw new Error(`${task.name} could not be restored.`);
      states.set(task.name, "complete");
      failures.delete(task.name);
      return true;
    } catch (error) {
      attempt.abort();
      if (!current()) return false;
      states.set(task.name, "failed");
      failures.set(task.name, error);
      try { onFailure(task.name, error); } catch { /* Observer cannot interrupt recovery. */ }
      return false;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      attempt.signal.removeEventListener("abort", rejectAbort);
      publish();
    }
  }
  const uiTask = { name: "project-ui", run: () => finalize() };
  async function finish() {
    if (!current()) return false;
    return execute(uiTask, optionalTimeoutMs);
  }
  async function recoverRequired() {
    for (const task of required) {
      if (states.get(task.name) !== "complete" && !await execute(task, requiredTimeoutMs)) return false;
    }
    if (!await finish()) return false;
    initialFinalized = true;
    publish();
    return true;
  }
  const startOptional = () => {
    if (optionalRun) return optionalRun;
    optionalRun = (async () => {
      for (const task of optional) {
        if (!current()) break;
        if (states.get(task.name) !== "complete") await execute(task, optionalTimeoutMs);
      }
      await finish();
      publish();
      return snapshot();
    })();
    return optionalRun;
  };
  return {
    getState: snapshot,
    async start() {
      publish();
      running = recoverRequired();
      const ready = await running;
      running = null;
      return ready;
    },
    startOptional,
    cancel() {
      if (current() && (!initialFinalized || required.some(task => states.get(task.name) !== "complete"))) return false;
      cancelled = true;
      controller.abort();
      publish();
      return true;
    },
    async retry(name) {
      if (!current()) return false;
      if (running) return false;
      const task = tasks.find(candidate => candidate.name === name) || (name === "project-ui" ? uiTask : null);
      if (!task || !failures.has(name)) return false;
      running = (async () => {
        if (required.includes(task) || !initialFinalized) {
          if (!await recoverRequired()) return false;
          optionalRun = null;
          await startOptional();
        } else {
          // Finish the detached queue before retrying: its final render and a
          // retry must not race over the same document's resource receivers.
          if (optionalRun) await optionalRun;
          if (!current()) return false;
          if (!await execute(task, optionalTimeoutMs)) return false;
          if (task !== uiTask && !await finish()) return false;
        }
        publish();
        return current() && !failures.has(name);
      })();
      try { return await running; } finally { running = null; }
    },
  };
}
