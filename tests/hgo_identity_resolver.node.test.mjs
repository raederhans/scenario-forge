import assert from "node:assert/strict";
import test from "node:test";
import { HGO_MATCH_KINDS, createHgoIdentityResolver } from "../js/core/hgo_identity_resolver.js";

const placeNames = {
  entries: {
    ABK: { names: { en: "Abkhazia" } },
    FEA: { names: { en: "French Equatorial Africa" } },
    LKA: { names: { en: "Sri Lanka" } },
  },
};

const aliases = {
  reviewed_aliases: { AEF: { target_tag: "FEA" } },
  suggested_aliases: { CEY: { target_tag: "LKA" } },
};

function createResolver() {
  return createHgoIdentityResolver({
    placeNames,
    aliases,
  });
}

test("exact tag lookup resolves the HGO identity", () => {
  const identity = createResolver().resolveIdentity(
    { tag: "ABK", displayName: "Scenario Abkhazia" },
    { nameMode: "hgo" },
  );

  assert.equal(identity.matchKind, HGO_MATCH_KINDS.exact);
  assert.equal(identity.displayName, "Abkhazia");
});

test("reviewed aliases are strong HGO identity matches", () => {
  const identity = createResolver().resolveIdentity(
    { tag: "AEF", displayName: "Afrique Equatoriale Francaise" },
    { nameMode: "hgo" },
  );

  assert.equal(identity.matchKind, HGO_MATCH_KINDS.reviewedAlias);
  assert.equal(identity.targetTag, "FEA");
  assert.equal(identity.displayName, "French Equatorial Africa");
});

test("disabled suggested aliases fall back to the scenario identity", () => {
  const resolver = createResolver();
  const hidden = resolver.resolveIdentity(
    { tag: "CEY", displayName: "Ceylon" },
    { nameMode: "hgo", allowSuggestedAliases: false },
  );

  assert.equal(hidden.matchKind, HGO_MATCH_KINDS.missing);
  assert.equal(hidden.displayName, "Ceylon");
});
