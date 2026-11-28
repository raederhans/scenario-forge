import test from "node:test";
import assert from "node:assert/strict";
import { buildCityLocalizationPatchSteps, mergeCityLocalizationData } from "../js/core/data_loader.js";
import { prepareLocalizationCandidate, prepareFullLocalizationData } from "../js/core/state/content_state.js";

test("prepared city aliases follow synchronous merge precedence", async () => {
  const aliases = { " Final ": "earlier" };
  const cityAliases = { alias_to_stable_key: aliases, geo: { CITY: { en: "Alias English" } },
    locales: { geo: { CITY: { zh: "覆盖中文" } } }, cities: [{ stable_key: "CITY", name_en: "Final English", aliases: ["Final"] }] };
  const locales = { ui: { retained: "UI" }, geo: { OLD: { en: "Old" }, CITY: { fr: "French" } } };
  const geoAliases = { alias_to_stable_key: { existing: "OLD" } };
  const expected = mergeCityLocalizationData({ locales, geoAliases, cityAliases });
  const patch = await prepareLocalizationCandidate(buildCityLocalizationPatchSteps({ cityAliases }));
  const candidate = await prepareFullLocalizationData({
    uiLocales: locales.ui, geoLocales: locales.geo, aliasToStableKey: geoAliases.alias_to_stable_key, cityPatch: patch,
  });
  assert.deepEqual(candidate.baseGeoLocales, expected.locales.geo);
  assert.deepEqual(candidate.baseGeoAliasToStableKey, expected.geoAliases.alias_to_stable_key);
  assert.equal(candidate.baseGeoAliasToStableKey.Final, "CITY");
  assert.deepEqual(candidate.baseGeoLocales.CITY, expected.cityLocalizationPatch.geo.CITY);
});
