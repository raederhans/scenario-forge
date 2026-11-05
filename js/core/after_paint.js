// Runs a callback after the next frame is painted.
//
// requestAnimationFrame callbacks run before paint, so panel work there still
// counts toward the interaction's latency. A timer queued from a frame callback
// runs after that frame is painted. Without a frame scheduler (Node tests,
// workers) the callback runs immediately, or on a timer when the caller asks
// for { withoutFrame: "timer" }. Returns a cancel function.
export function scheduleAfterPaint(callback, { withoutFrame = "sync" } = {}) {
  const requestFrame = globalThis.requestAnimationFrame;
  const setTimer = globalThis.setTimeout;
  let cancelled = false;
  const run = () => {
    if (!cancelled) callback();
  };
  if (typeof requestFrame !== "function" || typeof setTimer !== "function") {
    if (withoutFrame === "timer" && typeof setTimer === "function") setTimer(run, 0);
    else run();
  } else {
    requestFrame(() => setTimer(run, 0));
  }
  return () => { cancelled = true; };
}
