// Shared yield point for sliced renderer and data preparation.
//
// A scheduler.yield() continuation runs ahead of the next frame, so a long
// sliced job only lets the browser paint when Chrome's 100 ms render-starvation
// guard fires: the map drops to about 10 fps while zoom or chunk preparation
// runs. Background priority lets frames and input go first, and the job still
// gets every gap between them.
const noop = () => {};

export function yieldToBackground() {
  const scheduler = globalThis.scheduler;
  if (typeof scheduler?.postTask === "function") {
    return scheduler.postTask(noop, { priority: "background" });
  }
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
