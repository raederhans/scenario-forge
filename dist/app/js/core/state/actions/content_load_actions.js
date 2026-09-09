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
