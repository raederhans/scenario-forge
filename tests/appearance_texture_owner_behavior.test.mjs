import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createDefaultDayNightStyleConfig,
  normalizeDayNightStyleConfig,
} from "../js/core/state.js";
import {
  TEXTURE_STYLE_PATHS,
  createAppearanceTextureOwner,
  formatUtcMinutes,
} from "../js/ui/toolbar/appearance_texture_owner.js";

class TestClassList {
  constructor(node) {
    this.node = node;
  }

  add(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.add(token));
    this.node.className = Array.from(values).join(" ");
  }

  remove(...tokens) {
    const removals = new Set(tokens);
    const values = String(this.node.className || "").split(/\s+/).filter((token) => token && !removals.has(token));
    this.node.className = values.join(" ");
  }

  contains(token) {
    return String(this.node.className || "").split(/\s+/).includes(token);
  }

  toggle(token, force) {
    const shouldEnable = force === undefined ? !this.contains(token) : !!force;
    if (shouldEnable) {
      this.add(token);
    } else {
      this.remove(token);
    }
    return shouldEnable;
  }
}

class TestElement {
  constructor() {
    this.attributes = new Map();
    this.checked = false;
    this.className = "";
    this.classList = new TestClassList(this);
    this.dataset = {};
    this.disabled = false;
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler({
        target: this,
        ...event,
      });
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createTestDocument(nodeMap) {
  return {
    getElementById: (id) => nodeMap[id] || null,
  };
}

function buildNodes(ids) {
  return Object.fromEntries(ids.map((id) => [id, new TestElement()]));
}

function createHarness(ids, runtimeOverrides = {}) {
  const nodes = buildNodes(ids);
  const dirtyReasons = [];
  const historyEntries = [];
  let captureIndex = 0;
  const runtimeState = {
    styleConfig: {
      texture: {
        mode: "paper",
        opacity: 0.56,
        paper: { scale: 1.25 },
      },
      dayNight: {
        enabled: true,
        mode: "manual",
        manualUtcMinutes: 8 * 60 + 15,
        cityLightsEnabled: true,
        cityLightsStyle: "modern",
      },
    },
    syncDayNightClockTimerCount: 0,
    syncDayNightClockTimerFn() {
      this.syncDayNightClockTimerCount += 1;
    },
    ...runtimeOverrides,
  };
  const owner = createAppearanceTextureOwner({
    runtimeState,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    normalizeOceanFillColor: (value) => String(value || "").toLowerCase(),
    renderDirty: (reason) => dirtyReasons.push(reason),
    documentRef: createTestDocument(nodes),
    captureHistoryStateFn: ({ stylePaths }) => ({
      id: ++captureIndex,
      stylePaths,
    }),
    pushHistoryEntryFn: (entry) => historyEntries.push(entry),
  });
  return { dirtyReasons, historyEntries, nodes, owner, runtimeState };
}

test("formatUtcMinutes clamps and renders UTC labels", () => {
  assert.equal(formatUtcMinutes(-20), "00:00 UTC");
  assert.equal(formatUtcMinutes(24 * 60 + 20), "23:59 UTC");
  assert.equal(formatUtcMinutes(8 * 60 + 7), "08:07 UTC");
});

test("texture owner renders active mode panels and value labels", () => {
  const harness = createHarness([
    "textureSelect",
    "textureOpacity",
    "texturePaperControls",
    "texturePaperScale",
    "texturePaperScaleValue",
    "textureGraticuleControls",
    "textureDraftGridControls",
    "textureOpacityValue",
  ]);

  harness.owner.renderTextureUI();

  assert.equal(harness.nodes.textureSelect.value, "paper");
  assert.equal(harness.nodes.textureOpacity.value, "56");
  assert.equal(harness.nodes.textureOpacity.getAttribute("aria-disabled"), "false");
  assert.equal(harness.nodes.textureOpacityValue.textContent, "56%");
  assert.equal(harness.nodes.texturePaperScale.value, "125");
  assert.equal(harness.nodes.texturePaperScaleValue.textContent, "1.25x");
  assert.equal(harness.nodes.texturePaperControls.classList.contains("hidden"), false);
  assert.equal(harness.nodes.textureGraticuleControls.classList.contains("hidden"), true);
  assert.equal(harness.nodes.textureDraftGridControls.classList.contains("hidden"), true);
});

test("texture owner binds range inputs once and commits texture history on change", () => {
  const harness = createHarness([
    "texturePaperScale",
    "texturePaperScaleValue",
  ]);

  harness.owner.bindEvents();
  harness.owner.bindEvents();
  harness.nodes.texturePaperScale.value = "150";
  harness.nodes.texturePaperScale.dispatch("input");
  harness.nodes.texturePaperScale.dispatch("change");

  assert.equal(harness.nodes.texturePaperScale.listeners.get("input").length, 1);
  assert.equal(harness.nodes.texturePaperScale.listeners.get("change").length, 1);
  assert.equal(harness.runtimeState.styleConfig.texture.paper.scale, 1.5);
  assert.deepEqual(harness.dirtyReasons, ["texture-style-input", "texture-style"]);
  assert.equal(harness.historyEntries.length, 1);
  assert.equal(harness.historyEntries[0].kind, "texture-paper-scale");
  assert.deepEqual(harness.historyEntries[0].before.stylePaths, TEXTURE_STYLE_PATHS);
  assert.deepEqual(harness.historyEntries[0].after.stylePaths, TEXTURE_STYLE_PATHS);
});

test("texture owner commits a pending history entry before a different control starts", () => {
  const harness = createHarness([
    "texturePaperScale",
    "texturePaperWarmth",
  ]);

  harness.owner.bindEvents();
  harness.nodes.texturePaperScale.value = "150";
  harness.nodes.texturePaperScale.dispatch("input");
  harness.nodes.texturePaperWarmth.value = "70";
  harness.nodes.texturePaperWarmth.dispatch("input");
  harness.nodes.texturePaperWarmth.dispatch("change");

  assert.equal(harness.runtimeState.styleConfig.texture.paper.scale, 1.5);
  assert.equal(harness.runtimeState.styleConfig.texture.paper.warmth, 0.7);
  assert.deepEqual(
    harness.historyEntries.map((entry) => entry.kind),
    ["texture-paper-scale", "texture-paper-warmth"],
  );
});

test("texture paper scale roundtrips back to one-to-one size", () => {
  const harness = createHarness([
    "texturePaperScale",
    "texturePaperScaleValue",
  ], {
    styleConfig: {
      texture: {
        mode: "paper",
        paper: { scale: 1 },
      },
    },
  });

  harness.owner.bindEvents();
  harness.nodes.texturePaperScale.value = "90";
  harness.nodes.texturePaperScale.dispatch("input");
  harness.nodes.texturePaperScale.value = "100";
  harness.nodes.texturePaperScale.dispatch("input");
  harness.nodes.texturePaperScale.dispatch("change");

  assert.equal(harness.runtimeState.styleConfig.texture.paper.scale, 1);
  assert.equal(harness.nodes.texturePaperScaleValue.textContent, "1.00x");
  assert.deepEqual(harness.dirtyReasons, ["texture-style-input", "texture-style-input", "texture-style"]);
});

test("day-night owner syncs computer UTC time into the manual slider", () => {
  const harness = createHarness([
    "dayNightEnabled",
    "dayNightManualControls",
    "dayNightManualTime",
    "dayNightManualTimeValue",
    "dayNightSyncComputerUtcBtn",
  ]);
  harness.nodes.dayNightManualControls.classList.add("hidden");

  harness.owner.renderDayNightUI();
  harness.owner.bindEvents();
  harness.nodes.dayNightManualTime.value = "930";
  harness.nodes.dayNightManualTime.dispatch("input");
  harness.nodes.dayNightSyncComputerUtcBtn.dispatch("click");

  const now = new Date();
  const expectedUtcMinutes = (now.getUTCHours() * 60) + now.getUTCMinutes();
  const syncedUtcMinutes = harness.runtimeState.styleConfig.dayNight.manualUtcMinutes;

  assert.equal(harness.runtimeState.styleConfig.dayNight.mode, "manual");
  assert.ok(Math.abs(syncedUtcMinutes - expectedUtcMinutes) <= 1);
  assert.equal(harness.nodes.dayNightManualControls.classList.contains("hidden"), false);
  assert.equal(harness.nodes.dayNightManualTimeValue.textContent, formatUtcMinutes(syncedUtcMinutes));
  assert.equal(harness.runtimeState.syncDayNightClockTimerCount, 3);
  assert.deepEqual(harness.dirtyReasons, ["day-night-time", "day-night-sync-computer-utc"]);
});

test("day-night normalization preserves live UTC and cycle modes", () => {
  const utc = normalizeDayNightStyleConfig({
    mode: "utc",
    manualUtcMinutes: 18 * 60,
  });
  const cycle = normalizeDayNightStyleConfig({
    mode: "cycle",
    cycleSecondsPerDay: 45,
  });

  assert.equal(utc.mode, "utc");
  assert.equal(utc.manualUtcMinutes, 18 * 60);
  assert.equal(cycle.mode, "cycle");
  assert.equal(cycle.cycleSecondsPerDay, 45);
});

test("day-night owner toggles mode panels and writes cycle speed", () => {
  const harness = createHarness([
    "dayNightMode",
    "dayNightManualControls",
    "dayNightCycleControls",
    "dayNightManualTime",
    "dayNightManualTimeValue",
    "dayNightCycleSpeed",
    "dayNightCycleSpeedValue",
  ], {
    styleConfig: {
      texture: { mode: "none" },
      dayNight: {
        enabled: true,
        mode: "cycle",
        manualUtcMinutes: 720,
        cycleSecondsPerDay: 120,
      },
    },
  });

  harness.owner.renderDayNightUI();
  harness.owner.bindEvents();

  assert.equal(harness.nodes.dayNightMode.value, "cycle");
  assert.equal(harness.nodes.dayNightManualControls.classList.contains("hidden"), true);
  assert.equal(harness.nodes.dayNightCycleControls.classList.contains("hidden"), false);
  assert.equal(harness.nodes.dayNightCycleSpeed.value, "120");
  assert.equal(harness.nodes.dayNightCycleSpeedValue.textContent, "120s / day");

  harness.nodes.dayNightMode.value = "utc";
  harness.nodes.dayNightMode.dispatch("change");
  assert.equal(harness.runtimeState.styleConfig.dayNight.mode, "utc");
  assert.equal(harness.nodes.dayNightManualControls.classList.contains("hidden"), true);
  assert.equal(harness.nodes.dayNightCycleControls.classList.contains("hidden"), true);

  harness.nodes.dayNightCycleSpeed.value = "45";
  harness.nodes.dayNightCycleSpeed.dispatch("input");
  assert.equal(harness.runtimeState.styleConfig.dayNight.mode, "cycle");
  assert.equal(harness.runtimeState.styleConfig.dayNight.cycleSecondsPerDay, 45);
});

test("day-night renderer supports utc and cycle clock tokens", () => {
  const source = readFileSync(
    join(process.cwd(), "js", "core", "renderer", "day_night_runtime_owner.js"),
    "utf8",
  );

  assert.match(source, /function getCycleUtcMinutes\(config = getDayNightStyleConfig\(\), now = createDate\(\)\)/);
  assert.match(source, /if \(config\.mode === "cycle"\) \{\s*return `\$\{dayKey\}\|cycle:/);
  assert.match(source, /getCycleUtcMinutes\(config, now\)\.toFixed\(2\)/);
  assert.match(source, /const cycleFrameIntervalMs = Number\(constants\.cycleFrameIntervalMs\) \|\| \(1000 \/ 30\);/);
  assert.match(source, /function scheduleDayNightCycleFrame\(callback\)/);
  assert.match(source, /requestAnimationFrame\(callback\)/);
  assert.match(source, /function syncDayNightCycleAnimation\(initialConfig\)/);
  assert.match(source, /initialMode !== "utc" && initialMode !== "cycle"/);
  assert.match(source, /mode !== "utc" && mode !== "cycle"/);
});

test("day-night owner renders modern defaults from normalized state", () => {
  const defaults = createDefaultDayNightStyleConfig();
  const harness = createHarness([
    "dayNightCityLightsEnabled",
    "dayNightCityLightsStyle",
    "dayNightCityLightsIntensity",
    "dayNightCityLightsIntensityValue",
    "dayNightCityLightsTextureOpacity",
    "dayNightCityLightsTextureOpacityValue",
    "dayNightCityLightsCorridorStrength",
    "dayNightCityLightsCorridorStrengthValue",
    "dayNightCityLightsCoreSharpness",
    "dayNightCityLightsCoreSharpnessValue",
    "dayNightCityLightsPopulationBoostEnabled",
    "dayNightCityLightsPopulationBoostStrength",
    "dayNightCityLightsPopulationBoostStrengthValue",
    "dayNightShadowOpacity",
    "dayNightShadowOpacityValue",
  ], {
    styleConfig: {
      texture: { mode: "none" },
      dayNight: {},
    },
  });

  harness.owner.renderDayNightUI();

  assert.equal(harness.nodes.dayNightCityLightsEnabled.checked, defaults.cityLightsEnabled);
  assert.equal(harness.nodes.dayNightCityLightsStyle.value, defaults.cityLightsStyle);
  assert.equal(harness.nodes.dayNightCityLightsIntensity.value, String(Math.round(defaults.cityLightsIntensity * 100)));
  assert.equal(harness.nodes.dayNightCityLightsIntensityValue.textContent, "115%");
  assert.equal(harness.nodes.dayNightCityLightsTextureOpacity.value, String(Math.round(defaults.cityLightsTextureOpacity * 100)));
  assert.equal(harness.nodes.dayNightCityLightsTextureOpacityValue.textContent, "74%");
  assert.equal(harness.nodes.dayNightCityLightsCorridorStrength.value, String(Math.round(defaults.cityLightsCorridorStrength * 100)));
  assert.equal(harness.nodes.dayNightCityLightsCorridorStrengthValue.textContent, "42%");
  assert.equal(harness.nodes.dayNightCityLightsCoreSharpness.value, String(Math.round(defaults.cityLightsCoreSharpness * 100)));
  assert.equal(harness.nodes.dayNightCityLightsCoreSharpnessValue.textContent, "62%");
  assert.equal(harness.nodes.dayNightCityLightsPopulationBoostEnabled.checked, defaults.cityLightsPopulationBoostEnabled);
  assert.equal(harness.nodes.dayNightCityLightsPopulationBoostStrength.value, String(Math.round(defaults.cityLightsPopulationBoostStrength * 100)));
  assert.equal(harness.nodes.dayNightCityLightsPopulationBoostStrengthValue.textContent, "30%");
  assert.equal(harness.nodes.dayNightShadowOpacity.value, String(Math.round(defaults.shadowOpacity * 100)));
  assert.equal(harness.nodes.dayNightShadowOpacityValue.textContent, "38%");
});

test("day-night modern range fallbacks match normalized defaults", () => {
  const defaults = normalizeDayNightStyleConfig({});
  const harness = createHarness([
    "dayNightCityLightsIntensity",
    "dayNightCityLightsTextureOpacity",
    "dayNightCityLightsCorridorStrength",
    "dayNightCityLightsCoreSharpness",
    "dayNightCityLightsPopulationBoostStrength",
    "dayNightShadowOpacity",
  ]);

  harness.owner.bindEvents();
  [
    "dayNightCityLightsIntensity",
    "dayNightCityLightsTextureOpacity",
    "dayNightCityLightsCorridorStrength",
    "dayNightCityLightsCoreSharpness",
    "dayNightCityLightsPopulationBoostStrength",
    "dayNightShadowOpacity",
  ].forEach((id) => {
    harness.nodes[id].value = "invalid";
    harness.nodes[id].dispatch("input");
  });

  assert.equal(harness.runtimeState.styleConfig.dayNight.cityLightsIntensity, defaults.cityLightsIntensity);
  assert.equal(harness.runtimeState.styleConfig.dayNight.cityLightsTextureOpacity, defaults.cityLightsTextureOpacity);
  assert.equal(harness.runtimeState.styleConfig.dayNight.cityLightsCorridorStrength, defaults.cityLightsCorridorStrength);
  assert.equal(harness.runtimeState.styleConfig.dayNight.cityLightsCoreSharpness, defaults.cityLightsCoreSharpness);
  assert.equal(
    harness.runtimeState.styleConfig.dayNight.cityLightsPopulationBoostStrength,
    defaults.cityLightsPopulationBoostStrength,
  );
  assert.equal(harness.runtimeState.styleConfig.dayNight.shadowOpacity, defaults.shadowOpacity);
});

test("day-night HTML initial values match normalized defaults", () => {
  const defaults = createDefaultDayNightStyleConfig();
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const assertRangeDefault = (id, expectedPercent) => {
    const inputPattern = new RegExp(`<input[^>]*id="${id}"[^>]*value="${expectedPercent}"`, "s");
    const valuePattern = new RegExp(`<span[^>]*id="${id}Value"[^>]*>${expectedPercent}%<\\/span>`, "s");
    assert.match(html, inputPattern);
    assert.match(html, valuePattern);
  };

  assertRangeDefault("dayNightCityLightsIntensity", Math.round(defaults.cityLightsIntensity * 100));
  assertRangeDefault("dayNightCityLightsTextureOpacity", Math.round(defaults.cityLightsTextureOpacity * 100));
  assertRangeDefault("dayNightCityLightsCorridorStrength", Math.round(defaults.cityLightsCorridorStrength * 100));
  assertRangeDefault("dayNightCityLightsCoreSharpness", Math.round(defaults.cityLightsCoreSharpness * 100));
  assertRangeDefault(
    "dayNightCityLightsPopulationBoostStrength",
    Math.round(defaults.cityLightsPopulationBoostStrength * 100),
  );
  assertRangeDefault("dayNightHistoricalCityLightsDensity", Math.round(defaults.historicalCityLightsDensity * 100));
  assertRangeDefault(
    "dayNightHistoricalCityLightsSecondaryRetention",
    Math.round(defaults.historicalCityLightsSecondaryRetention * 100),
  );
  assertRangeDefault("dayNightShadowOpacity", Math.round(defaults.shadowOpacity * 100));
  assert.match(html, new RegExp(`<input[^>]*id="dayNightCycleSpeed"[^>]*value="${defaults.cycleSecondsPerDay}"`, "s"));
  assert.match(html, /<span[^>]*id="dayNightCycleSpeedValue"[^>]*><\/span>/s);
});
