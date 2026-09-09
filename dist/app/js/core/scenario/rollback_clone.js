// One capture reuses topology/container objects. Arrays remain value copies,
// matching cloneScenarioStateValue: indexing every coordinate in a WeakMap
// costs more than copying those small arrays and retains them until capture ends.
export function createScenarioRollbackClone() {
  const copies = new WeakMap();
  function clone(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    const existing = copies.get(value);
    if (existing !== undefined) return existing;
    const copy = value instanceof Date ? new Date(value.getTime())
      : value instanceof Map ? new Map()
      : value instanceof Set ? new Set()
      : {};
    copies.set(value, copy);
    if (value instanceof Map) {
      for (const [key, entry] of value) copy.set(clone(key), clone(entry));
    } else if (value instanceof Set) {
      for (const entry of value) copy.add(clone(entry));
    } else if (!(value instanceof Date)) {
      for (const key of Object.keys(value)) copy[key] = clone(value[key]);
    }
    return copy;
  }
  return clone;
}
