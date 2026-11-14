import assert from "node:assert/strict";
import test from "node:test";

import * as contentLoadActions from "../js/core/state/actions/content_load_actions.js";

test("resource finalizers cannot clear a replacement request or its status", () => {
  const previous = Promise.resolve();
  const replacement = Promise.resolve();
  const state = {
    baseCityDataPromise: replacement, baseCityDataState: "loading", baseCityDataError: "",
    baseLocalizationDataPromise: replacement, baseLocalizationDataState: "loading", baseLocalizationDataError: "",
    contextLayerLoadPromiseByName: { rivers: replacement },
    contextLayerLoadStateByName: { rivers: "loading" }, contextLayerLoadErrorByName: { rivers: "" },
  };
  const options = { expectedPromise: previous, cancelled: true };
  assert.equal(contentLoadActions.finishBaseCitySupportLoad(state, options), false);
  assert.equal(contentLoadActions.finishFullLocalizationLoad(state, options), false);
  assert.equal(contentLoadActions.finishContextLayerLoad(state, "rivers", options), false);
  assert.equal(state.baseCityDataPromise, replacement);
  assert.equal(state.baseLocalizationDataPromise, replacement);
  assert.equal(state.contextLayerLoadPromiseByName.rivers, replacement);
  assert.equal(state.baseCityDataState, "loading");
  assert.equal(state.baseLocalizationDataState, "loading");
  assert.equal(state.contextLayerLoadStateByName.rivers, "loading");
});


