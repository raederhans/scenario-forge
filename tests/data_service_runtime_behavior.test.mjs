import test from "node:test";
import assert from "node:assert/strict";
import * as dataServiceModule from "../js/core/data_service.js";

test("data service loads module runtime assets through getAsset", async () => {
  const payload = await dataServiceModule.getAsset("city_lights:historical_1930:asset", {
    moduleLoader: async (specifier) => ({
      specifier,
      exported: true,
    }),
  });

  assert.equal(payload.exported, true);
  assert.match(payload.specifier, /js\/core\/city_lights_historical_1930_asset\.js$/);

  const snapshot = dataServiceModule.getStatusSnapshot();
  const requestId = "asset:city_lights:historical_1930:asset";
  assert.equal(snapshot.resources[requestId].status, "ready");
  assert.equal(snapshot.resources[requestId].url, "js/core/city_lights_historical_1930_asset.js");
});
