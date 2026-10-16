const accountingByBudget = new WeakMap();

export function getProjectedPathResourceAccounting(resourceBudget) {
  if (!resourceBudget || typeof resourceBudget !== "object"
    || typeof resourceBudget.update !== "function" || typeof resourceBudget.release !== "function") {
    throw new TypeError("A runtime resource budget is required for projected path accounting.");
  }
  let accounting = accountingByBudget.get(resourceBudget);
  if (accounting) return accounting;

  const resourceOwner = Symbol("projected-path-references");
  const references = new WeakMap();
  let estimatedBytes = 0;
  let batchDepth = 0;
  let dirty = false;

  function publish() {
    if (!dirty) return;
    dirty = false;
    if (estimatedBytes > 0) resourceBudget.update(resourceOwner, { projectedPaths: estimatedBytes });
    else resourceBudget.release(resourceOwner);
  }

  function changed() {
    dirty = true;
    if (batchDepth === 0) publish();
  }

  function normalizedWeight(value) {
    const weight = Number(value);
    return Number.isFinite(weight) ? Math.max(1, Math.ceil(weight)) : 256;
  }

  function getMaxOwnerWeight(owners) {
    let weight = 0;
    for (const entry of owners.values()) weight = Math.max(weight, entry.weight);
    return weight;
  }

  function retain(owner, path, bytes = 256) {
    if (!owner || !path || (typeof path !== "object" && typeof path !== "function")) return false;
    let record = references.get(path);
    if (!record) {
      record = { owners: new Map(), weight: 0 };
      references.set(path, record);
    }
    const previousWeight = record.weight;
    const nextWeight = normalizedWeight(bytes);
    const ownerRecord = record.owners.get(owner) || { count: 0, weight: 0 };
    ownerRecord.count += 1;
    ownerRecord.weight = Math.max(ownerRecord.weight, nextWeight);
    record.owners.set(owner, ownerRecord);
    record.weight = getMaxOwnerWeight(record.owners);
    if (record.weight !== previousWeight) {
      estimatedBytes += record.weight - previousWeight;
      changed();
    }
    return true;
  }

  function release(owner, path) {
    if (!owner || !path || (typeof path !== "object" && typeof path !== "function")) return false;
    const record = references.get(path);
    const ownerRecord = record?.owners.get(owner);
    if (!ownerRecord) return false;
    const previousWeight = record.weight;
    ownerRecord.count -= 1;
    if (ownerRecord.count <= 0) record.owners.delete(owner);
    if (!record.owners.size) {
      references.delete(path);
      estimatedBytes -= previousWeight;
      changed();
      return true;
    }
    record.weight = getMaxOwnerWeight(record.owners);
    if (record.weight !== previousWeight) {
      estimatedBytes += record.weight - previousWeight;
      changed();
    }
    return true;
  }

  function batch(callback) {
    batchDepth += 1;
    try {
      return callback();
    } finally {
      batchDepth -= 1;
      if (batchDepth === 0) publish();
    }
  }

  accounting = Object.freeze({
    batch,
    getEstimatedBytes: () => estimatedBytes,
    release,
    retain,
  });
  accountingByBudget.set(resourceBudget, accounting);
  return accounting;
}
