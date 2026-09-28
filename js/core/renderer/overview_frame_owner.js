import { coversViewport, transformCoverage } from "./cached_surface_coverage.js";
import { pageResourceBudget } from "../runtime_resource_budget.js";

// Retain at most one accepted overview, not a history of viewport bitmaps.
const MAX_OVERVIEW_BYTES = 32 * 1024 * 1024;

export function createOverviewFrameOwner({
  getIdentity,
  createCanvas = () => document.createElement("canvas"),
  resourceBudget = pageResourceBudget,
  recordMetric = () => {},
} = {}) {
  const resourceOwner = Symbol("overview-frame");
  let frame = null;

  function clear() {
    if (frame) { frame.canvas.width = 0; frame.canvas.height = 0; }
    frame = null;
    resourceBudget.release(resourceOwner);
  }

  function isCurrent() {
    if (!frame) return false;
    if (getIdentity(frame.transform) !== frame.identity || resourceBudget.snapshot().pressure) {
      clear();
      return false;
    }
    return true;
  }

  function capture(source, transform, dpr) {
    if (!source || !Number.isFinite(transform?.k) || transform.k <= 0 || !(dpr > 0)) return false;
    if (isCurrent() && frame.transform.k <= transform.k) return false;
    const bytes = source.width * source.height * 4;
    clear();
    if (!(bytes > 0) || bytes > MAX_OVERVIEW_BYTES || !resourceBudget.admitSpeculative(bytes).admitted) return false;
    const canvas = createCanvas();
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) { canvas.width = 0; canvas.height = 0; return false; }
    try { context.drawImage(source, 0, 0); }
    catch (error) { canvas.width = 0; canvas.height = 0; throw error; }
    const reference = { x: transform.x, y: transform.y, k: transform.k };
    frame = { canvas, transform: reference, dpr, identity: getIdentity(reference) };
    resourceBudget.update(resourceOwner, { bitmaps: bytes });
    recordMetric("overviewFrameCapture", 0, { k: reference.k, estimatedBytes: bytes });
    return true;
  }

  function draw(context, current, dpr) {
    if (!context || !isCurrent() || frame.dpr !== dpr) return false;
    const { canvas, transform: reference } = frame;
    const coverage = transformCoverage({ minX: 0, minY: 0,
      maxX: canvas.width / dpr, maxY: canvas.height / dpr }, reference, current);
    if (!coversViewport(coverage, context.canvas.width / dpr, context.canvas.height / dpr)) return false;
    const ratio = current.k / reference.k;
    // Identity and actual coverage are checked before touching visible pixels.
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      context.translate((current.x - reference.x * ratio) * dpr, (current.y - reference.y * ratio) * dpr);
      context.scale(ratio, ratio);
      context.drawImage(canvas, 0, 0);
    } finally { context.restore(); }
    recordMetric("overviewFrameReuse", 0, { referenceK: reference.k, targetK: current.k });
    return true;
  }

  return Object.freeze({ capture, draw, clear });
}
