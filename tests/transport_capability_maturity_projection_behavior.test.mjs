import assert from "node:assert/strict";
import test from "node:test";

import manifest from "../data/transport_layers/japan_road/manifest.json" with { type: "json" };
import { getTransportWorkbenchFamilyPreviewConfig } from "../js/ui/transport_workbench/transport_workbench_family_registry.js";
import { resolveTransportRoadFeatureMaturityProjection } from "../js/core/transport_capability_registry.js";

const roadPreview = getTransportWorkbenchFamilyPreviewConfig("road");
const roadManifestSummary = {
  family: manifest.family,
  mainMapEligible: manifest.mainMapEligible,
  apply_bridge_supported: manifest.apply_bridge_supported,
};

test("road maturity projects validated manifest facts without treating previewOnly as main-map immaturity", () => {
  const maturity = resolveTransportRoadFeatureMaturityProjection({
    familyId: "road",
    workbenchPreview: roadPreview,
    manifestSummary: roadManifestSummary,
  });

  assert.deepEqual(maturity, {
    familyId: "road",
    ready: true,
    workbenchPreview: { available: true, previewOnly: true },
    mainMapOverview: { eligible: true, source: "manifest_summary" },
    applyBridge: { supported: true, source: "manifest_summary" },
    pagesOwner: { owner: "transport-workbench", readOnlyProjection: true },
    reasonCodes: ["maturity_ready"],
  });
  assert.equal(Object.isFrozen(maturity), true);
  assert.equal(Object.isFrozen(maturity.reasonCodes), true);
  assert.equal(Object.isFrozen(maturity.mainMapOverview), true);
});

test("road maturity fails closed for absent, malformed, mismatched, and conflicting evidence", () => {
  const cases = [
    [{ familyId: "rail", workbenchPreview: roadPreview, manifestSummary: roadManifestSummary }, "unsupported_family"],
    [{ familyId: "road", manifestSummary: roadManifestSummary }, "workbench_preview_missing"],
    [{ familyId: "road", workbenchPreview: "preview", manifestSummary: roadManifestSummary }, "workbench_preview_invalid_type"],
    [{ familyId: "road", workbenchPreview: { ...roadPreview, familyId: "rail" }, manifestSummary: roadManifestSummary }, "workbench_preview_family_mismatch"],
    [{ familyId: "road", workbenchPreview: { ...roadPreview, previewOnly: false }, manifestSummary: roadManifestSummary }, "workbench_preview_semantics_invalid"],
    [{ familyId: "road", workbenchPreview: roadPreview }, "manifest_summary_missing"],
    [{ familyId: "road", workbenchPreview: roadPreview, manifestSummary: "manifest" }, "manifest_summary_invalid_type"],
    [{ familyId: "road", workbenchPreview: roadPreview, manifestSummary: { ...roadManifestSummary, family: "rail" } }, "manifest_family_mismatch"],
    [{ familyId: "road", workbenchPreview: roadPreview, manifestSummary: { ...roadManifestSummary, mainMapEligible: "true" } }, "manifest_main_map_eligible_invalid"],
    [{ familyId: "road", workbenchPreview: roadPreview, manifestSummary: { ...roadManifestSummary, apply_bridge_supported: "true" } }, "manifest_apply_bridge_supported_invalid"],
    [{ familyId: "road", workbenchPreview: roadPreview, manifestSummary: { ...roadManifestSummary, apply_bridge_supported: false } }, "manifest_bridge_eligibility_conflict"],
  ];

  cases.forEach(([input, reasonCode]) => {
    const maturity = resolveTransportRoadFeatureMaturityProjection(input);
    assert.equal(maturity.ready, false);
    assert.equal(maturity.reasonCodes.includes(reasonCode), true);
  });

  assert.equal(resolveTransportRoadFeatureMaturityProjection(cases[0][0]).familyId, "rail");
});

test("road maturity preserves valid manifest facts when the workbench preview evidence is absent", () => {
  const maturity = resolveTransportRoadFeatureMaturityProjection({
    familyId: "road",
    manifestSummary: roadManifestSummary,
  });

  assert.equal(maturity.ready, false);
  assert.deepEqual(maturity.workbenchPreview, { available: false, previewOnly: false });
  assert.deepEqual(maturity.mainMapOverview, { eligible: true, source: "manifest_summary" });
  assert.deepEqual(maturity.applyBridge, { supported: true, source: "manifest_summary" });
  assert.deepEqual(maturity.pagesOwner, { owner: "transport-workbench", readOnlyProjection: true });
  assert.deepEqual(maturity.reasonCodes, ["workbench_preview_missing"]);
});

test("road maturity preserves Pages ownership and manifest facts when preview evidence has an invalid type", () => {
  const maturity = resolveTransportRoadFeatureMaturityProjection({
    familyId: "road",
    workbenchPreview: "preview",
    manifestSummary: roadManifestSummary,
  });

  assert.equal(maturity.ready, false);
  assert.deepEqual(maturity.workbenchPreview, { available: false, previewOnly: false });
  assert.deepEqual(maturity.mainMapOverview, { eligible: true, source: "manifest_summary" });
  assert.deepEqual(maturity.applyBridge, { supported: true, source: "manifest_summary" });
  assert.deepEqual(maturity.pagesOwner, { owner: "transport-workbench", readOnlyProjection: true });
  assert.deepEqual(maturity.reasonCodes, ["workbench_preview_invalid_type"]);
});

test("road maturity preserves valid workbench preview evidence when the manifest summary is absent", () => {
  const maturity = resolveTransportRoadFeatureMaturityProjection({
    familyId: "road",
    workbenchPreview: roadPreview,
  });

  assert.equal(maturity.ready, false);
  assert.deepEqual(maturity.workbenchPreview, { available: true, previewOnly: true });
  assert.deepEqual(maturity.mainMapOverview, { eligible: false, source: "manifest_summary" });
  assert.deepEqual(maturity.applyBridge, { supported: false, source: "manifest_summary" });
  assert.deepEqual(maturity.pagesOwner, { owner: "transport-workbench", readOnlyProjection: true });
  assert.deepEqual(maturity.reasonCodes, ["manifest_summary_missing"]);
});
