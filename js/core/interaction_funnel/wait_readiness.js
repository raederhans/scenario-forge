import { ensureDetailTopologyBoundary } from "../render_boundary.js";
import { state } from "../state.js";

function waitForPoll(pollMs) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, Number(pollMs) || 50));
  });
}

export async function waitForScenarioApplyIdle({ timeoutMs = 30_000, pollMs = 50 } = {}) {
  if (!state.scenarioApplyInFlight) {
    return true;
  }
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 30_000);
  while (state.scenarioApplyInFlight) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out while waiting for scenario apply to settle before project import.");
    }
    await waitForPoll(pollMs);
  }
  return true;
}

export async function waitForStartupReadonlyUnlock({ timeoutMs = 45_000, pollMs = 50 } = {}) {
  if (!state.startupReadonly) {
    return true;
  }
  try {
    await ensureDetailTopologyBoundary({ applyMapData: false });
  } catch {
    // Startup unlock owns the final failure path. Keep polling below.
  }
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 45_000);
  while (state.startupReadonly) {
    if (Date.now() >= deadline) {
      throw new Error(
        "Detailed interactions are still loading. Project import could not continue before startup readonly unlocked."
      );
    }
    await waitForPoll(pollMs);
  }
  return true;
}
