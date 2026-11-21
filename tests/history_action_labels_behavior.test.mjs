import test from "node:test";
import assert from "node:assert/strict";
import { getHistoryActionLabel } from "../js/core/history_action_labels.js";
import { coalesceQuickFillGesture } from "../js/core/history_quick_fill_gesture.js";
import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { toggleLanguage, updateHistoryButton, updateUIText } from "../js/ui/i18n.js";

test("merged quick fill counts changed regions, including the initial click", () => {
  state.currentLanguage = "zh";
  const gesture = { featureId: "a", color: "#123456", scenarioId: "scene" };
  const entry = coalesceQuickFillGesture({
    kind: "fill-feature-color",
    before: { visualOverrides: { a: null } },
    after: { visualOverrides: { a: gesture.color } },
    meta: { quickFillGesture: { ...gesture, type: "leaf-click", timeStamp: 1 } },
  }, {
    kind: "fill-country-batch",
    before: { visualOverrides: { a: gesture.color, b: null, c: gesture.color } },
    after: { visualOverrides: { a: gesture.color, b: gesture.color, c: gesture.color } },
    meta: { quickFillGesture: { ...gesture, type: "double-click", timeStamp: 2, leadingClickTimeStamp: 1 } },
  });
  assert.equal(getHistoryActionLabel("Undo", entry), "撤销：填色 2 个地块");
});

test("country, reset, clear and unknown entries have localized labels", () => {
  state.currentLanguage = "zh";
  state.scenarioCountriesByTag = { GER: { display_name_zh: "德国", display_name_en: "Germany" } };
  const after = { sovereignBaseColors: { GER: "#abcdef" } };
  for (const kind of ["inspector-country-color", "palette-country-color", "palette-library-apply-owner-color"]) {
    assert.equal(getHistoryActionLabel("Undo", { kind, after }), "撤销：修改 德国 颜色");
  }
  assert.equal(getHistoryActionLabel("Undo", { kind: "reset-country-colors" }), "撤销：重置国家配色");
  assert.equal(getHistoryActionLabel("Redo", { kind: "clear-map" }), "重做：清空地图");
  assert.equal(getHistoryActionLabel("Redo", { kind: "unknown" }), "重做");
});

test("switching language keeps the next action in both button attributes", async (ctx) => {
  state.currentLanguage = "zh";
  const undo = { dataset: {}, setAttribute(name, value) { this[name] = value; } };
  const redo = { ...undo };
  const original = globalThis.document;
  globalThis.document = {
    documentElement: {},
    getElementById: (id) => ({ undoBtn: undo, redoBtn: redo })[id],
    querySelectorAll: () => [],
  };
  const entry = { kind: "fill-feature-color", before: { visualOverrides: { a: null } }, after: { visualOverrides: { a: "#abcdef" } } };
  registerRuntimeHook(state, "updateHistoryUIFn", () => {
    updateHistoryButton(undo, "Undo", entry);
    updateHistoryButton(redo, "Redo", null);
  });
  ctx.after(() => {
    registerRuntimeHook(state, "updateHistoryUIFn", null);
    globalThis.document = original;
  });
  updateUIText();
  assert.deepEqual([undo.title, undo["aria-label"], undo.disabled], ["撤销：填色 1 个地块", "撤销：填色 1 个地块", false]);
  await toggleLanguage();
  assert.deepEqual([undo.title, undo["aria-label"], undo.disabled], ["Undo: Paint 1 region", "Undo: Paint 1 region", false]);
  assert.deepEqual([redo.title, redo["aria-label"], redo.disabled], ["Redo", "Redo", true]);
});

test("named edits in the history list and toolbar use the active language", () => {
  for (const [entry, en, zh] of [
    [{ kind: "replace-color" }, "Replace color", "替换颜色"],
    [{ kind: "country-name" }, "Rename country", "重命名国家"],
    [{ kind: "reset-country-overrides" }, "Reset country overrides", "重置国家局部配色"],
    [{ kind: "auto-fill-region" }, "Auto-fill regions", "按区域自动填色"],
    [{ kind: "place-map-label" }, "Place map label", "添加地图文字"],
    [{ kind: "edit-map-label" }, "Edit map label", "编辑地图文字"],
    [{ kind: "move-map-label" }, "Move map label", "移动地图文字"],
    [{ kind: "delete-map-label" }, "Delete map label", "删除地图文字"],
    [{ kind: "move-unit-counter" }, "Move unit counter", "移动兵棋"],
    [{ kind: "create-operational-line" }, "Create operational line", "绘制作战线"],
    [{ meta: { kind: "appearance-preset-import" } }, "Import appearance preset", "导入外观预设"],
    [{ label: "Physical intensity field" }, "Physical intensity field", "地形强度场"],
  ]) {
    state.currentLanguage = "en";
    assert.equal(getHistoryActionLabel(null, entry), en);
    state.currentLanguage = "zh";
    assert.equal(getHistoryActionLabel("Redo", entry), `重做：${zh}`);
  }
});
