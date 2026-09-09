// Reuse only the exact offscreen composite. The caller still blits and runs all frame effects.
// Every writer of pass pixels or the shared buffer must invalidate before it starts writing.
export function createExactCompositeReuseOwner({ getCache, getReferenceTransform, getLayout,
  getDpr, diagnosticsEnabled = () => false, resetContext, compose } = {}) {
  let previous = null;
  function invalidate() { previous = null; }
  function snapshot(buffer, names, transform) {
    const cache = getCache();
    if (diagnosticsEnabled()) return null;
    const values = [buffer, buffer.width, buffer.height, getDpr(), transform?.k, transform?.x, transform?.y];
    for (const name of names) {
      const canvas = cache.canvases?.[name];
      const reference = getReferenceTransform(name);
      if (!canvas || !reference || cache.dirty?.[name]) return null;
      const layout = getLayout(name);
      values.push(name, canvas, canvas.width, canvas.height,
        reference.k, reference.x, reference.y, layout?.offsetX, layout?.offsetY);
    }
    return values;
  }
  function composeExact(bufferCanvas, passNames, currentTransform) {
    const context = bufferCanvas.getContext("2d");
    if (!context) { invalidate(); return { ok: false, reason: "missing-target-context" }; }
    const inputs = snapshot(bufferCanvas, passNames, currentTransform);
    if (inputs && previous && inputs.length === previous.length
      && inputs.every((value, index) => Object.is(value, previous[index]))) {
      return { ok: true, reused: true };
    }
    // Clear eligibility before any write: thrown/declined compositions cannot publish cached pixels.
    invalidate();
    resetContext(context, bufferCanvas.width, bufferCanvas.height);
    const result = compose(context, passNames, currentTransform, { requireAllPasses: true });
    if (result.ok) previous = inputs;
    return { ...result, reused: false };
  }
  return { invalidate, composeExact };
}
