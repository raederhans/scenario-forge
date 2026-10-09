import assert from "node:assert/strict";
import test from "node:test";

import { createVisualEffectsPassOwner } from "../js/core/renderer/visual_effects_pass_owner.js";

function createContext(events, { throwOnFill = false, throwOnPath = false } = {}) {
  const gradient = { addColorStop: (...args) => events.push(["color-stop", ...args]) };
  return {
    save: () => events.push("save"),
    restore: () => events.push("restore"),
    clearRect: () => {},
    fillRect: (...args) => events.push(["fill-rect", ...args]),
    beginPath: () => events.push("begin-path"),
    clip: () => events.push("clip"),
    fill: () => {
      events.push("fill");
      if (throwOnFill) throw new Error("hostile-fill");
    },
    stroke: () => events.push("stroke"),
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    strokeText: (label) => events.push(["stroke-text", label]),
    fillText: (label) => events.push(["fill-text", label]),
    setLineDash: (dash) => events.push(["dash", dash]),
    createPattern: (source, repeat) => {
      events.push(["create-pattern", source.kind, repeat]);
      return {
        setTransform: (matrix) => events.push(["pattern-transform", matrix.scale]),
      };
    },
    createRadialGradient: () => gradient,
    get throwOnPath() {
      return throwOnPath;
    },
  };
}

function createHarness({
  textureMode = "paper",
  bootReady = true,
  throwOnFill = false,
  throwOnPath = false,
} = {}) {
  const events = [];
  const images = [];
  const context = createContext(events, { throwOnFill, throwOnPath });
  const texture = {
    mode: textureMode,
    opacity: 0.7,
    sphereClip: true,
    paper: {
      assetId: "paper_vintage_01",
      scale: 1,
      grain: 0,
      wear: 0,
      warmth: 0,
      vignette: 0,
      blendMode: "multiply",
    },
    graticule: {
      majorStep: 90,
      minorStep: 45,
      labelStep: 90,
      majorWidth: 1,
      minorWidth: 0.5,
      majorOpacity: 0.5,
      minorOpacity: 0.25,
      color: "#123456",
      labelColor: "#654321",
      labelSize: 12,
    },
    draftGrid: {
      majorStep: 90,
      minorStep: 45,
      lonOffset: 0,
      latOffset: 0,
      roll: 0,
      width: 1,
      majorOpacity: 0.5,
      minorOpacity: 0.25,
      color: "#123456",
      dash: "dashed",
    },
  };
  const owner = createVisualEffectsPassOwner({
    getters: {
      getContext: () => context,
      getPathCanvas: () => (geometry) => {
        events.push(["path", geometry.type]);
        if (context.throwOnPath) throw new Error("hostile-path");
      },
      getPathSvg: () => ({ bounds: () => [[0, 0], [100, 80]] }),
      getProjection: () => ([longitude, latitude]) => [longitude + 180, latitude + 90],
      getViewportSize: () => ({ width: 100, height: 80 }),
      getTextureStyleConfig: () => {
        events.push("get-texture");
        return texture;
      },
      isBootInteractionReady: () => {
        events.push("boot-ready");
        return bootReady;
      },

    },
    helpers: {
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      getDashPattern: () => [4, 2],
      getSafeBlendMode: (value) => value,
      getSafeCanvasColor: (value, fallback) => value || fallback,
      normalizeTextureMode: (mode) => {
        events.push(`normalize:${String(mode)}`);
        return String(mode || "none").trim().toLowerCase();
      },
    },
    effects: {
      requestTextureRerender: () => events.push("request-rerender"),
      drawDayNightRuntimePass: (k, options) => events.push(["day-night-runtime", k, options]),
      recordRenderPerfMetric: (...args) => events.push(["metric", ...args]),
    },
    platform: {
      createCanvas: () => ({
        kind: "noise-tile",
        getContext: () => createContext([], {}),
      }),
      createImage: () => {
        const image = { kind: "asset-image" };
        images.push(image);
        return image;
      },
      createGeoRotation: () => (point) => point,
      createPatternTransform: (scale) => ({ scale }),
    },
    constants: {
      paperTextureAssetUrls: { paper_vintage_01: "paper.svg" },
      paperNoiseTileSize: 8,
      graticuleSampleDegrees: 45,
      textureLabelSerifStack: "serif",
    },
  });
  return { context, events, images, owner, texture };
}

test("factory validates every runtime port and freezes the public API", () => {
  const dependencyNames = {
    getters: [
      "getContext", "getPathCanvas", "getPathSvg", "getProjection", "getViewportSize",
      "getTextureStyleConfig", "isBootInteractionReady",
    ],
    helpers: ["clamp", "getDashPattern", "getSafeBlendMode", "getSafeCanvasColor", "normalizeTextureMode"],
    effects: ["requestTextureRerender", "drawDayNightRuntimePass", "recordRenderPerfMetric"],
    platform: ["createCanvas", "createImage", "createGeoRotation", "createPatternTransform"],
  };
  for (const [groupName, names] of Object.entries(dependencyNames)) {
    for (const missingName of names) {
      const dependencies = Object.fromEntries(Object.entries(dependencyNames).map(([name, groupNames]) => [
        name,
        Object.fromEntries(groupNames.map((dependencyName) => [dependencyName, () => {}])),
      ]));
      delete dependencies[groupName][missingName];
      assert.throws(
        () => createVisualEffectsPassOwner(dependencies),
        new RegExp(`${groupName}\\.${missingName} must be a function`),
      );
    }
  }
  assert.deepEqual(Object.keys(createHarness().owner), [
    "drawEffectsPass",
    "drawLineEffectsPass",
    "drawTextureLabelEffectsPass",
    "drawDayNightPass",
    "invalidateTextureRasterCaches",
  ]);
  assert.equal(Object.isFrozen(createHarness().owner), true);
});

test("pass facades preserve readiness, mode selection, and day-night delegation", () => {
  const skippedByMode = createHarness({ textureMode: "graticule" });
  skippedByMode.owner.drawEffectsPass(2);
  assert.deepEqual(skippedByMode.events, ["get-texture", "normalize:graticule"]);

  const skippedByBoot = createHarness({ bootReady: false });
  skippedByBoot.owner.drawEffectsPass(2);
  assert.deepEqual(skippedByBoot.events, ["get-texture", "normalize:paper", "boot-ready"]);

  const dayNight = createHarness();
  dayNight.owner.drawDayNightPass(12, { interactive: true });
  assert.deepEqual(dayNight.events, [["day-night-runtime", 12, { interactive: true }]]);
});

test("graticule lines and labels retain line-before-label drawing", () => {
  const harness = createHarness({ textureMode: "graticule" });
  harness.owner.drawLineEffectsPass(4, { interactive: true });
  const lastStrokeIndex = harness.events.findLastIndex((event) => event === "stroke");
  harness.owner.drawTextureLabelEffectsPass(4);
  const firstLabelIndex = harness.events.findIndex((event) => Array.isArray(event) && event[0] === "stroke-text");
  assert.ok(lastStrokeIndex >= 0);
  assert.ok(firstLabelIndex > lastStrokeIndex);
  assert.equal(harness.events.filter((event) => event === "save").length,
    harness.events.filter((event) => event === "restore").length);

});

test("paper asset, pattern, and noise caches keep identity until explicit raster invalidation", () => {
  const harness = createHarness();
  harness.owner.drawEffectsPass(3);
  assert.equal(harness.images.length, 1);
  assert.equal(harness.events.filter((event) => Array.isArray(event) && event[0] === "create-pattern").length, 1);

  harness.images[0].onload();
  assert.equal(harness.events.at(-1), "request-rerender");
  harness.owner.drawEffectsPass(3);
  assert.equal(harness.events.filter((event) => Array.isArray(event) && event[0] === "create-pattern").length, 3);
  harness.owner.drawEffectsPass(3);
  assert.equal(harness.events.filter((event) => Array.isArray(event) && event[0] === "create-pattern").length, 3);

  harness.owner.invalidateTextureRasterCaches();
  harness.owner.drawEffectsPass(3);
  assert.equal(harness.events.filter((event) => Array.isArray(event) && event[0] === "create-pattern").length, 5);
  assert.equal(harness.images.length, 1);
});

test("canvas stacks restore after hostile texture path failures", () => {
  for (const [options, expectedError, expectedDepth] of [
    [{ throwOnPath: true }, /hostile-path/, 1],
    [{ throwOnFill: true }, /hostile-fill/, 2],
  ]) {
    const harness = createHarness(options);
    assert.throws(() => harness.owner.drawEffectsPass(1), expectedError);
    assert.equal(harness.events.filter((event) => event === "save").length, expectedDepth);
    assert.equal(harness.events.filter((event) => event === "restore").length, expectedDepth);
  }
});

test("null options fail before runtime access while omitted options retain defaults", () => {
  for (const methodName of ["drawEffectsPass", "drawLineEffectsPass", "drawDayNightPass"]) {
    const harness = createHarness();
    assert.throws(() => harness.owner[methodName](1, null), TypeError);
    assert.deepEqual(harness.events, []);
  }
  const harness = createHarness({ textureMode: "none" });
  harness.owner.drawLineEffectsPass(1);
  assert.deepEqual(harness.events, ["get-texture", "boot-ready"]);
});
