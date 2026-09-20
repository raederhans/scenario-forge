// Retention estimates, not measurements of browser/native heap allocation.
// Keep decoded geometry and projected-path weights separate: Path2D is opaque.
export const PROJECTED_PATH_CACHE_BUDGET = 32 * 1024 * 1024;
export const WORKER_GEOMETRY_CACHE_BUDGET = 64 * 1024 * 1024;
const complexityByGeometry = new WeakMap();

export function getGeometryRetentionWeights(feature) {
  const geometry = feature?.type === "Feature" || feature?.geometry ? feature.geometry : feature;
  if (!geometry || typeof geometry !== "object") return { decoded: 256, path: 256, points: 0 };
  if (complexityByGeometry.has(geometry)) return complexityByGeometry.get(geometry);
  let arrays = 0, scalars = 0, points = 0;
  function coordinates(value) {
    if (!Array.isArray(value)) return;
    arrays++;
    if (typeof value[0] === "number") { points++; scalars += value.length; }
    else for (const item of value) coordinates(item);
  }
  function visit(value) {
    if (value?.type === "GeometryCollection") for (const part of value.geometries || []) visit(part);
    else coordinates(value?.coordinates);
  }
  visit(geometry);
  const weight = { decoded: 256 + arrays * 32 + scalars * 8, path: 256 + points * 32, points };
  complexityByGeometry.set(geometry, weight);
  return weight;
}

export class GeometryBudgetMap extends Map {
  constructor({ budget = PROJECTED_PATH_CACHE_BUDGET, weigh = () => 256, autoTrim = true } = {}) {
    super();
    this.budget = Math.max(0, budget);
    this.weigh = weigh;
    this.autoTrim = autoTrim;
    this.weights = new Map();
    this.retainedWeight = 0;
    this.evictions = 0;
    this.oversizedSkips = 0;
  }
  get(key) {
    const value = super.get(key);
    if (super.has(key)) { super.delete(key); super.set(key, value); }
    return value;
  }
  set(key, value) {
    this.delete(key);
    const weight = Math.max(1, Math.ceil(this.weigh(value)) || 1);
    if (this.autoTrim && weight > this.budget) { this.oversizedSkips++; return this; }
    super.set(key, value);
    this.weights.set(key, weight);
    this.retainedWeight += weight;
    if (this.autoTrim) this.trim();
    return this;
  }
  delete(key) {
    if (!super.delete(key)) return false;
    this.retainedWeight -= this.weights.get(key) || 0;
    this.weights.delete(key);
    return true;
  }
  clear() {
    super.clear();
    this.weights.clear();
    this.retainedWeight = 0;
  }
  trim(protectedKeys = new Set()) {
    const evicted = [];
    for (const key of super.keys()) {
      if (this.retainedWeight <= this.budget) break;
      if (protectedKeys.has(key)) continue;
      this.delete(key);
      this.evictions++;
      evicted.push(key);
    }
    return evicted;
  }
  getStats() {
    return { entries: this.size, estimatedBytes: this.retainedWeight, budgetBytes: this.budget,
      overBudgetBytes: Math.max(0, this.retainedWeight - this.budget), evictions: this.evictions, oversizedSkips: this.oversizedSkips };
  }
}
