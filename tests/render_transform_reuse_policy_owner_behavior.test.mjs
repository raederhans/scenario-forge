import assert from "node:assert/strict";
import test from "node:test";

import { createRenderTransformReusePolicyOwner } from "../js/core/renderer/render_transform_reuse_policy_owner.js";

const EXACT_FAST_PATH_REQUIRED_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
  "textureLabels",
];

function cloneZoomTransform(transform) {
  return {
    x: Number(transform?.x || 0),
    y: Number(transform?.y || 0),
    k: Math.max(0.0001, Number(transform?.k || 1)),
  };
}

function createOwner({
  state: stateOverrides = {},
  cache: cacheOverrides = {},
  references = {},
  heavyScenario = true,
  activePassNames,
} = {}) {
  const state = {
    width: 1000,
    height: 1000,
    renderProfile: "balanced",
    activeScenarioId: "tno_1962",
    zoomTransform: { k: 1, x: 0, y: 0 },
    deferContextBasePass: false,
    ...stateOverrides,
  };
  const cache = {
    canvases: {},
    counters: {},
    ...cacheOverrides,
  };
  const referenceTransforms = { ...references };
  return {
    cache,
    state,
    referenceTransforms,
    owner: createRenderTransformReusePolicyOwner({
      state,
      getters: {
        getRenderPassCacheState: () => cache,
        getPassReferenceTransform: (passName) => referenceTransforms[passName] || null,
        ...(activePassNames === undefined ? {} : { getActiveRenderPassNames: () => activePassNames }),
      },
      helpers: {
        cloneZoomTransform,
        isHeavyScenarioStagedApplyCandidate: () => heavyScenario,
      },
    }),
  };
}

function createRequiredPassCanvases() {
  return Object.fromEntries(EXACT_FAST_PATH_REQUIRED_PASS_NAMES.map((passName) => [passName, {}]));
}

function createRequiredPassReferences() {
  return Object.fromEntries(
    EXACT_FAST_PATH_REQUIRED_PASS_NAMES.map((passName) => [passName, { k: 1, x: 0, y: 0 }]),
  );
}

test("getContextBaseZoomBucketId classifies low mid and high zoom buckets", () => {
  const { owner } = createOwner();

  assert.equal(owner.getContextBaseZoomBucketId(1.0), "low");
  assert.equal(owner.getContextBaseZoomBucketId(1.6), "mid");
  assert.equal(owner.getContextBaseZoomBucketId(3.0), "high");
});

test("getContextBaseReuseMaxDistancePx clamps viewport-scaled distance", () => {
  assert.equal(createOwner({ state: { width: 500, height: 1000 } }).owner.getContextBaseReuseMaxDistancePx(), 320);
  assert.equal(createOwner({ state: { width: 1200, height: 2000 } }).owner.getContextBaseReuseMaxDistancePx(), 420);
  assert.equal(createOwner({ state: { width: 3000, height: 5000 } }).owner.getContextBaseReuseMaxDistancePx(), 640);
});

test("shouldEnableContextBaseTransformReuse requires balanced profile active scenario and heavy candidate", () => {
  assert.equal(createOwner({ state: { renderProfile: "auto" } }).owner.shouldEnableContextBaseTransformReuse(), false);
  assert.equal(createOwner({ state: { activeScenarioId: "" } }).owner.shouldEnableContextBaseTransformReuse(), false);
  assert.equal(createOwner({ heavyScenario: false }).owner.shouldEnableContextBaseTransformReuse(), false);
  assert.equal(createOwner().owner.shouldEnableContextBaseTransformReuse(), true);
});

test("shouldEnableContextScenarioTransformReuse requires balanced profile and active scenario", () => {
  assert.equal(createOwner().owner.shouldEnableContextScenarioTransformReuse(), true);
  assert.equal(createOwner({ state: { renderProfile: "auto" } }).owner.shouldEnableContextScenarioTransformReuse(), false);
  assert.equal(createOwner({ state: { activeScenarioId: "" } }).owner.shouldEnableContextScenarioTransformReuse(), false);
});

test("getContextBaseReuseDecision covers disabled missing reference threshold and reuse cases", () => {
  assert.equal(
    createOwner({ state: { renderProfile: "auto" } }).owner.getContextBaseReuseDecision({ k: 1, x: 0, y: 0 }).reason,
    "reuse-disabled",
  );
  assert.equal(
    createOwner().owner.getContextBaseReuseDecision({ k: 1, x: 0, y: 0 }).reason,
    "no-reference-transform",
  );
  assert.equal(
    createOwner({ references: { contextBase: { k: 1, x: 0, y: 0 } } })
      .owner.getContextBaseReuseDecision({ k: 1.6, x: 0, y: 0 }).reason,
    "zoom-bucket-change",
  );
  assert.equal(
    createOwner({ references: { contextBase: { k: 1.6, x: 0, y: 0 } } })
      .owner.getContextBaseReuseDecision({ k: 1.6, x: 360, y: 0 }).reason,
    "distance-threshold",
  );
  assert.equal(
    createOwner({ references: { contextBase: { k: 1.9, x: 0, y: 0 } } })
      .owner.getContextBaseReuseDecision({ k: 2.1, x: 0, y: 0 }).reason,
    "minor-contour-threshold",
  );

  const reuse = createOwner({ references: { contextBase: { k: 1.6, x: 0, y: 0 } } })
    .owner.getContextBaseReuseDecision({ k: 1.6, x: 50, y: 50 });
  assert.equal(reuse.reason, "transform-reuse");
  assert.equal(reuse.shouldExactRefresh, false);
});

test("getContextScenarioReuseDecision covers disabled missing reference distance frame limit and reuse cases", () => {
  assert.equal(
    createOwner({ state: { renderProfile: "auto" } }).owner.getContextScenarioReuseDecision({ k: 1, x: 0, y: 0 }).reason,
    "reuse-disabled",
  );
  assert.equal(
    createOwner().owner.getContextScenarioReuseDecision({ k: 1, x: 0, y: 0 }).reason,
    "no-reference-transform",
  );
  assert.equal(
    createOwner({ references: { contextScenario: { k: 1, x: 0, y: 0 } } })
      .owner.getContextScenarioReuseDecision({ k: 1, x: 961, y: 0 }).reason,
    "distance-threshold",
  );
  assert.equal(
    createOwner({
      cache: { counters: { contextScenarioReuseCount: 24 } },
      references: { contextScenario: { k: 1, x: 0, y: 0 } },
    }).owner.getContextScenarioReuseDecision({ k: 1, x: 0, y: 0 }).reason,
    "reuse-frame-limit",
  );

  const reuse = createOwner({
    cache: { counters: { contextScenarioReuseCount: 23 } },
    references: { contextScenario: { k: 1, x: 0, y: 0 } },
  }).owner.getContextScenarioReuseDecision({ k: 1, x: 50, y: 50 });
  assert.equal(reuse.reason, "transform-reuse");
  assert.equal(reuse.shouldExactRefresh, false);
});

test("ready ordinary maps can schedule sliced recovery while contextBase transform reuse remains disabled", () => {
  for (const options of [
    { state: { renderProfile: "auto" } },
    { heavyScenario: false },
    { state: { activeScenarioId: "" } },
  ]) {
    const { owner } = createOwner({
      ...options,
      cache: { canvases: createRequiredPassCanvases() },
      references: createRequiredPassReferences(),
    });
    assert.equal(owner.shouldStartExactAfterSettleFastPath(), true);
    assert.equal(owner.shouldEnableContextBaseTransformReuse(), false);
    assert.equal(owner.getContextBaseReuseDecision().shouldExactRefresh, true);
  }
});

test("HGO and unavailable active pipelines cannot reuse stale vector surfaces for sliced recovery", () => {
  for (const activePassNames of [["hgoPreview"], [...EXACT_FAST_PATH_REQUIRED_PASS_NAMES, "hgoPreview"], [], null]) {
    const { owner } = createOwner({
      activePassNames,
      cache: { canvases: createRequiredPassCanvases() },
      references: createRequiredPassReferences(),
    });
    assert.equal(owner.shouldStartExactAfterSettleFastPath(), false);
  }
  assert.equal(createOwner({
    activePassNames: [...EXACT_FAST_PATH_REQUIRED_PASS_NAMES, "borders", "labels"],
    cache: { canvases: createRequiredPassCanvases() },
    references: createRequiredPassReferences(),
  }).owner.shouldStartExactAfterSettleFastPath(), true);
});

test("shouldStartExactAfterSettleFastPath requires ready cached pass surfaces without requiring contextBase reuse", () => {
  assert.equal(
    createOwner({
      state: { renderProfile: "auto" },
      cache: { canvases: createRequiredPassCanvases() },
      references: createRequiredPassReferences(),
    }).owner.shouldStartExactAfterSettleFastPath(),
    true,
  );
  assert.equal(
    createOwner({
      state: { deferContextBasePass: true },
      cache: { canvases: createRequiredPassCanvases() },
      references: createRequiredPassReferences(),
    }).owner.shouldStartExactAfterSettleFastPath(),
    false,
  );

  for (const requiredPassName of EXACT_FAST_PATH_REQUIRED_PASS_NAMES) {
    const missingCanvas = createRequiredPassCanvases();
    delete missingCanvas[requiredPassName];
    assert.equal(
      createOwner({
        cache: { canvases: missingCanvas },
        references: createRequiredPassReferences(),
      }).owner.shouldStartExactAfterSettleFastPath(),
      false,
      `${requiredPassName} canvas is required`,
    );

    const missingReference = createRequiredPassReferences();
    delete missingReference[requiredPassName];
    assert.equal(
      createOwner({
        cache: { canvases: createRequiredPassCanvases() },
        references: missingReference,
      }).owner.shouldStartExactAfterSettleFastPath(),
      false,
      `${requiredPassName} reference transform is required`,
    );
  }

  const canvasesWithoutExcludedPasses = createRequiredPassCanvases();
  const referencesWithoutExcludedPasses = createRequiredPassReferences();
  for (const excludedPassName of ["borders", "labels", "hgoPreview"]) {
    assert.equal(canvasesWithoutExcludedPasses[excludedPassName], undefined);
    assert.equal(referencesWithoutExcludedPasses[excludedPassName], undefined);
  }
  assert.equal(
    createOwner({
      cache: { canvases: canvasesWithoutExcludedPasses },
      references: referencesWithoutExcludedPasses,
    }).owner.shouldStartExactAfterSettleFastPath(),
    true,
  );
});
