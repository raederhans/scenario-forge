import { recordContextLayerPublication } from "../context_layer_revision.js";

// Publish display aliases without mutating the immutable per-pack cache entries.
export function commitPhysicalContourDisplayState(target, { major, minor } = {}) {
  const changed = [];
  if (major !== undefined && target.physicalContourMajorData !== major
    && !(major === null && target.physicalContourMajorData == null)) {
    target.physicalContourMajorData = major;
    changed.push("physical_contours_major");
  }
  if (minor !== undefined && target.physicalContourMinorData !== minor
    && !(minor === null && target.physicalContourMinorData == null)) {
    target.physicalContourMinorData = minor;
    changed.push("physical_contours_minor");
  }
  if (changed.length) {
    const previousRevision = Number(target.contextLayerRevision) || 0;
    target.contextLayerRevision = previousRevision + 1;
    recordContextLayerPublication(target, previousRevision,
      changed.map(layer => layer === "physical_contours_major"
        ? target.physicalContourMajorData : target.physicalContourMinorData));
  }
  return changed;
}

// Finish only the resource request that still owns the pending slot.
export function finishBaseCitySupportLoad(target, { expectedPromise, cancelled = false } = {}) {
  if (!target || typeof target !== "object" || !expectedPromise
    || target.baseCityDataPromise !== expectedPromise) return false;
  target.baseCityDataPromise = null;
  if (cancelled) {
    target.baseCityDataState = "error";
    target.baseCityDataError = "City load cancelled.";
  }
  return true;
}

export function finishFullLocalizationLoad(target, { expectedPromise, cancelled = false } = {}) {
  if (!target || typeof target !== "object" || !expectedPromise
    || target.baseLocalizationDataPromise !== expectedPromise) return false;
  target.baseLocalizationDataPromise = null;
  if (cancelled) {
    target.baseLocalizationDataState = "error";
    target.baseLocalizationDataError = "Localization load cancelled.";
  }
  return true;
}

export function finishContextLayerLoad(target, layerName, { expectedPromise, cancelled = false } = {}) {
  if (!target || typeof target !== "object" || !expectedPromise
    || target.contextLayerLoadPromiseByName?.[layerName] !== expectedPromise) return false;
  delete target.contextLayerLoadPromiseByName[layerName];
  if (cancelled) {
    target.contextLayerLoadStateByName ||= {};
    target.contextLayerLoadErrorByName ||= {};
    target.contextLayerLoadStateByName[layerName] = "idle";
    target.contextLayerLoadErrorByName[layerName] = "";
  }
  return true;
}
