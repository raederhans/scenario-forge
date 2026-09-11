import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createStartupBootOverlayController } from "../js/bootstrap/startup_boot_overlay.js";
import { state as runtimeState } from "../js/core/state.js";
import {
  clearStartupReadonlyStateFields,
  commitStartupReadonlyStateFields,
  replaceBootMetricsState,
  setBootStateFields,
} from "../js/core/state/actions/boot_actions.js";

const BOOT_STATE_KEYS = Object.freeze([
  "startupReadonly",
  "startupReadonlyReason",
  "startupReadonlyUnlockInFlight",
  "startupReadonlySince",
  "bootMetrics",
]);

function snapshotProperties(target, keys) {
  return new Map(keys.map((key) => [key, target[key]]));
}

function restoreProperties(target, snapshot) {
  clearStartupReadonlyStateFields(target, { preserveSince: false });
  commitStartupReadonlyStateFields(target, {
    active: true,
    reason: snapshot.get("startupReadonlyReason"),
    unlockInFlight: snapshot.get("startupReadonlyUnlockInFlight"),
    since: snapshot.get("startupReadonlySince"),
  });
  if (!snapshot.get("startupReadonly")) {
    clearStartupReadonlyStateFields(target, { preserveSince: true });
  }
  replaceBootMetricsState(target, snapshot.get("bootMetrics"));
}

test("boot snapshot restore preserves active and inactive timestamps and metrics identity", () => {
  for (const active of [false, true]) {
    const metrics = { fixture: { startedAt: 10 } };
    const original = {
      startupReadonly: active,
      startupReadonlyReason: active ? "detail-promotion" : "",
      startupReadonlyUnlockInFlight: active,
      startupReadonlySince: 123,
      bootMetrics: metrics,
    };
    const target = { ...original, startupReadonlySince: 999, bootMetrics: {} };
    restoreProperties(target, snapshotProperties(original, BOOT_STATE_KEYS));
    assert.deepEqual(target, original);
    assert.equal(target.bootMetrics, metrics);
  }
});

function createDocumentStub() {
  return {
    body: {
      classList: {
        toggle() {},
      },
    },
    getElementById() {
      return null;
    },
  };
}

// Seed attributes from the shipping shell so a hidden CSS class cannot be
// accidentally omitted from the regression fixture.
function createBootShellDocument() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const nodes = new Map();
  for (const match of html.matchAll(/<[a-z][^>]*\bid="(boot[^"]+)"[^>]*>/gi)) {
    const tag = match[0];
    const classes = new Set((tag.match(/\bclass="([^"]*)"/)?.[1] || "").split(/\s+/));
    const listeners = new Map();
    const attributes = new Map();
    nodes.set(match[1], {
      hidden: /\shidden(?:[\s=>])/.test(tag.replace(/"[^"]*"/g, '""')),
      open: false,
      textContent: "",
      style: {},
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
      classList: {
        contains: (name) => classes.has(name),
        toggle(name, active) { active ? classes.add(name) : classes.delete(name); },
      },
      addEventListener(name, handler) { listeners.set(name, handler); },
      click() { listeners.get("click")?.(); },
    });
  }
  return { ...createDocumentStub(), getElementById: (id) => nodes.get(id) || null };
}

test("shipping boot shell exposes recovery actions and separates error details in both languages", () => {
  const bootFields = {
    phase: runtimeState.bootPhase, message: runtimeState.bootMessage,
    progress: runtimeState.bootProgress, blocking: runtimeState.bootBlocking,
    error: runtimeState.bootError, canContinueWithoutScenario: runtimeState.bootCanContinueWithoutScenario,
  };
  const originalLanguage = runtimeState.currentLanguage;
  const globals = Object.getOwnPropertyDescriptors(globalThis);
  try {
    let reloads = 0;
    globalThis.location = { reload() { reloads += 1; } };
    for (const language of ["en", "zh"]) {
      runtimeState.currentLanguage = language;
      globalThis.document = createBootShellDocument();
      const node = (id) => {
        const element = document.getElementById(id);
        assert.ok(element, `${id} must exist in index.html`);
        return element;
      };
      const visible = (id) => !node(id).hidden && !node(id).classList.contains("hidden");
      const controller = createStartupBootOverlayController();
      controller.initializeBootOverlay();
      const rawError = "First visible frame was not accepted <renderer>";
      controller.setBootState("error", { error: rawError, progress: 94 });
      assert.equal(visible("bootOverlayActions"), true);
      assert.equal(node("bootOverlay").getAttribute("aria-busy"), "false");
      assert.equal(visible("bootContinueBtn"), false);
      assert.equal(visible("bootOverlayProgress"), false);
      assert.equal(visible("bootOverlayProgressText"), false);
      assert.equal(visible("bootOverlayErrorDetails"), true);
      assert.equal(node("bootOverlayErrorText").textContent, rawError);
      assert.equal(node("bootOverlayMessage").textContent, controller.getBootCopy("error").message);
      assert.equal(node("bootRetryBtn").textContent, language === "zh" ? "重试" : "Retry");
      node("bootRetryBtn").click();
      let continued = 0;
      controller.setBootContinueHandler(() => { continued += 1; });
      controller.setBootState("error", { error: rawError, canContinueWithoutScenario: true });
      assert.equal(visible("bootContinueBtn"), true);
      assert.equal(node("bootOverlayMessage").textContent, controller.getBootCopy("error").continueMessage);
      node("bootContinueBtn").click();
      assert.equal(continued, 1);
      node("bootOverlayErrorDetails").open = true;
      controller.setBootState("ready");
      assert.equal(visible("bootOverlayActions"), false);
      assert.equal(visible("bootContinueBtn"), false);
      assert.equal(visible("bootOverlayErrorDetails"), false);
      assert.equal(node("bootOverlayErrorDetails").open, false);
      assert.equal(node("bootOverlayErrorText").textContent, "");
    }
    assert.equal(reloads, 2);
  } finally {
    setBootStateFields(runtimeState, bootFields);
    runtimeState.currentLanguage = originalLanguage;
    for (const key of ["document", "location"]) {
      if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
      else delete globalThis[key];
    }
  }
});

test("boot overlay keeps boot metrics and global mirror on the same committed root", () => {
  const stateSnapshot = snapshotProperties(runtimeState, BOOT_STATE_KEYS);
  const hadDocument = Object.hasOwn(globalThis, "document");
  const originalDocument = globalThis.document;
  const hadBootMetrics = Object.hasOwn(globalThis, "__bootMetrics");
  const originalBootMetrics = globalThis.__bootMetrics;

  try {
    globalThis.document = createDocumentStub();
    const controller = createStartupBootOverlayController();

    controller.resetBootMetrics();
    assert.equal(globalThis.__bootMetrics, runtimeState.bootMetrics);
    const resetRoot = runtimeState.bootMetrics;

    controller.startBootMetric("startup-data");
    assert.equal(globalThis.__bootMetrics, runtimeState.bootMetrics);
    assert.notEqual(runtimeState.bootMetrics, resetRoot);

    controller.finishBootMetric("startup-data", { status: "ready" });
    assert.equal(globalThis.__bootMetrics, runtimeState.bootMetrics);
    assert.equal(runtimeState.bootMetrics["startup-data"].status, "ready");
  } finally {
    restoreProperties(runtimeState, stateSnapshot);
    if (hadDocument) {
      globalThis.document = originalDocument;
    } else {
      delete globalThis.document;
    }
    if (hadBootMetrics) {
      globalThis.__bootMetrics = originalBootMetrics;
    } else {
      delete globalThis.__bootMetrics;
    }
  }
});

test("boot overlay preserves readonly activation time and clears it on ordinary deactivate", () => {
  const stateSnapshot = snapshotProperties(runtimeState, BOOT_STATE_KEYS);
  const hadDocument = Object.hasOwn(globalThis, "document");
  const originalDocument = globalThis.document;

  try {
    globalThis.document = createDocumentStub();
    commitStartupReadonlyStateFields(runtimeState, {
      active: false,
      reason: "",
      unlockInFlight: false,
      since: 0,
    });
    const controller = createStartupBootOverlayController();

    controller.setStartupReadonlyState(true, {
      reason: "detail-promotion",
      unlockInFlight: true,
    });
    const activatedAt = runtimeState.startupReadonlySince;

    assert.equal(runtimeState.startupReadonly, true);
    assert.equal(runtimeState.startupReadonlyReason, "detail-promotion");
    assert.equal(runtimeState.startupReadonlyUnlockInFlight, true);
    assert.ok(Number(activatedAt) > 0);

    controller.setStartupReadonlyState(true, {
      reason: "scenario-health-gate",
      unlockInFlight: false,
    });
    assert.equal(runtimeState.startupReadonlySince, activatedAt);

    controller.setStartupReadonlyState(false);
    assert.equal(runtimeState.startupReadonly, false);
    assert.equal(runtimeState.startupReadonlyReason, "");
    assert.equal(runtimeState.startupReadonlyUnlockInFlight, false);
    assert.equal(runtimeState.startupReadonlySince, 0);
  } finally {
    restoreProperties(runtimeState, stateSnapshot);
    if (hadDocument) {
      globalThis.document = originalDocument;
    } else {
      delete globalThis.document;
    }
  }
});
