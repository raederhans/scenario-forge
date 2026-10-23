// Keeps an expensive panel rebuild out of the input frame.
//
// requestAnimationFrame callbacks run before the next paint, so rebuilding a panel
// there still counts toward the interaction's latency (INP). A request here only marks
// the panel stale. While the panel is visible, it is rebuilt after the next paint;
// while it is hidden, nothing runs until it scrolls or switches into view.
export function createDeferredPanelRender({
  render,
  element = null,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  setTimer = globalThis.setTimeout?.bind(globalThis),
  ObserverClass = globalThis.IntersectionObserver,
} = {}) {
  if (typeof render !== "function") throw new TypeError("Deferred panel render requires a render function.");
  let stale = false;
  let scheduled = false;
  // Unknown until the observer reports; assume visible so nothing is lost without it.
  let visible = true;

  function run() {
    scheduled = false;
    if (!stale || !visible) return;
    stale = false;
    render();
  }

  function schedule() {
    if (scheduled) return;
    if (typeof requestFrame !== "function" || typeof setTimer !== "function") {
      run();
      return;
    }
    scheduled = true;
    // A timer queued from a frame callback runs after that frame is painted.
    requestFrame(() => setTimer(run, 0));
  }

  let observer = null;
  if (element && typeof ObserverClass === "function") {
    observer = new ObserverClass((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      visible = !!entry.isIntersecting;
      if (visible && stale) schedule();
    });
    observer.observe(element);
  }

  return {
    request() {
      stale = true;
      if (visible) schedule();
    },
    dispose() {
      observer?.disconnect();
      observer = null;
      stale = false;
    },
  };
}
