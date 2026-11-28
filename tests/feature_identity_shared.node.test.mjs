import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCountryCodeAlias } from "../js/core/country_code_aliases.js";

const featureIdentity = await import("../js/core/feature_identity.js");

test("country codes normalize aliases and distinguish reserved codes", () => {
  assert.equal(normalizeCountryCodeAlias("UK"), "GB");
  assert.equal(featureIdentity.normalizeFeatureCountryCode("ZZ"), "");
  assert.equal(featureIdentity.normalizeFeatureCountryCode("ZZ", { allowReserved: true }), "ZZ");
  assert.equal(featureIdentity.normalizeFeatureCountryCode("123"), "");
  assert.equal(featureIdentity.normalizeFeatureCountryCode("2RA"), "2RA");
});

test("feature identity prefers NUTS_ID over the feature id and fallback", () => {
  const feature = {
    id: "GB-001",
    properties: {
      NUTS_ID: "GB-ALT",
      iso_a2: "uk",
    },
  };

  assert.equal(featureIdentity.getFeatureId(feature, { fallback: "fallback-id" }), "GB-ALT");
  assert.equal(featureIdentity.getCountryCode(feature), "GB");
});
