import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { normalizeCountryCodeAlias } from "../js/core/country_code_aliases.js";

const featureIdentity = await import("../js/core/feature_identity.js");
const workerSource = await readFile(new URL("../js/workers/startup_boot.worker.js", import.meta.url), "utf8");
const sharedSource = await readFile(new URL("../js/core/feature_identity_shared.js", import.meta.url), "utf8");

test("country aliases preserve canonical, Unicode, and coercion behavior", () => {
  for (const [input, expected] of [
    ["UK", "GB"], ["EL", "GR"], ["GB", "GB"], ["2RA", "2RA"],
    ["", ""], ["ZZ", "ZZ"], ["XX", "XX"], [" u-k\t", "GB"],
    ["éL", "L"], ["ß", "SS"], ["ıe", "IE"], ["ｕｋ", ""],
    ["中UK文", "GB"], [null, ""], [undefined, ""], [false, ""],
    [0, ""], [42, "42"], [true, "TRUE"], [NaN, ""],
    [{ toString: () => " el " }, "GR"], [["u", "k"], "GB"],
  ]) {
    assert.equal(normalizeCountryCodeAlias(input), expected);
  }
});

test("shared script initializes its own identity API instead of reusing a stale global", () => {
  const sandbox = {
    __scenarioForgeFeatureIdentityShared: { getFeatureId: () => "stale-id" },
  };
  const feature = { id: "fallback-id", properties: { NUTS_ID: "GB-ALT" } };
  runInNewContext(sharedSource, sandbox);
  assert.equal(sandbox.__scenarioForgeFeatureIdentityShared.getFeatureId(feature), "GB-ALT");
  assert.equal(Object.isFrozen(sandbox.__scenarioForgeFeatureIdentityShared), true);
  runInNewContext(sharedSource, sandbox);
  assert.equal(sandbox.__scenarioForgeFeatureIdentityShared.getFeatureId(feature), "GB-ALT");
});

test("main-thread feature identity keeps alias and reserved-code behavior in shared helper", () => {
  const feature = {
    id: "GB-001",
    properties: {
      NUTS_ID: "GB-ALT",
      iso_a2: "uk",
      stable_key: "stable::gb-001",
    },
  };

  assert.equal(featureIdentity.getFeatureId(feature, { fallback: "fallback-id" }), "GB-ALT");
  assert.equal(featureIdentity.getCountryCode(feature), "GB");
  assert.equal(featureIdentity.getStableKey(feature), "stable::gb-001");
  assert.equal(featureIdentity.getCountryCode({ id: "RU_shell_01", properties: {} }), "RU");
  assert.equal(featureIdentity.getCountryCode({ properties: { NUTS_ID: "DE1" } }), "DE");
  assert.equal(featureIdentity.getCountryCode({ id: "FR12", properties: {} }), "FR");
  assert.equal(featureIdentity.getCountryCode({ id: "ZZ_001", properties: {} }), "");
  assert.equal(featureIdentity.getCountryCode({ properties: { country_code: "2ra" } }), "2RA");
});

test("startup worker delegates feature identity rules to the worker-safe shared helper", () => {
  assert.match(workerSource, /feature_identity_shared\.js/);
  assert.match(workerSource, /FEATURE_IDENTITY\.getFeatureId\(feature\)/);
  assert.match(workerSource, /FEATURE_IDENTITY\.getCountryCode\(feature, \{/);
  assert.doesNotMatch(workerSource, /const FEATURE_ID_KEYS = Object\.freeze/);
  assert.doesNotMatch(workerSource, /const COUNTRY_CODE_KEYS = Object\.freeze/);
  assert.match(sharedSource, /const FEATURE_ID_KEYS = Object\.freeze/);
  assert.match(sharedSource, /const COUNTRY_CODE_KEYS = Object\.freeze/);
});
