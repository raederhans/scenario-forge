import test from "node:test";
import assert from "node:assert/strict";
import { loadCitySupportData } from "../js/core/data_loader.js";

test("night-light data does not fetch aliases or clone locales, then labels reuse normalized geometry", async () => {
  const requests = [];
  const locales = { ui: {}, geo: { retained: { en: "Existing" } } };
  const options = {
    worldCitiesUrls: ["cities"], cityAliasesUrls: ["aliases"], locales,
    d3Client: { json: async (url) => {
      requests.push(url);
      return url === "cities" ? { type: "FeatureCollection", features: [{ type: "Feature",
        geometry: { type: "Point", coordinates: [12, 48] },
        properties: { id: "test-city", name: "City", population: 250000 },
      }] } : {};
    } },
  };
  const geometry = await loadCitySupportData({ ...options, includeLocalization: false });
  assert.deepEqual(requests, ["cities"]);
  assert.equal(geometry.localizationReady, false);
  assert.equal(geometry.locales, undefined);
  assert.equal(geometry.worldCities.features.length, 1);
  const full = await loadCitySupportData({ ...options, cityCollection: geometry.worldCities });
  assert.equal(full.worldCities, geometry.worldCities);
  assert.equal(full.localizationReady, true);
  assert.deepEqual(requests, ["cities", "aliases"]);
  assert.deepEqual(full.locales.geo.retained, locales.geo.retained);
  assert.ok(Object.keys(full.cityLocalizationPatch.geo).length > 0);
});
