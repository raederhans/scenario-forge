import test from "node:test";
import assert from "node:assert/strict";
import { createStrategicOverlayController } from "../js/ui/sidebar/strategic_overlay_controller.js";
import { t } from "../js/core/i18n.js";
import { state as runtimeState } from "../js/core/state.js";
import { setCurrentLanguage } from "../js/core/state/content_state.js";

class Select {
  children = [];
  dataset = {};
  value = "";
  replaceChildren() { this.children = []; }
  appendChild(option) { this.children.push(option); }
}

function fixture(context) {
  const originals = Object.fromEntries(["document", "HTMLSelectElement"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const language = runtimeState.currentLanguage;
  globalThis.HTMLSelectElement = Select;
  globalThis.document = { createElement: () => ({}), getElementById: () => null, querySelector: () => null };
  context.after(() => {
    setCurrentLanguage(runtimeState, language);
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const state = {
    operationalLines: [
      { id: "line-1", kind: "defensive_line", label: "Custom line" },
      { id: "line-2", kind: "offensive_line", label: "" },
      { id: "line-3", kind: "spearhead_line", label: "Attack" },
      { id: "line-4", kind: "frontline", label: "中文自定义" },
    ],
    operationGraphics: [
      { id: "graphic-1", kind: "attack", label: "Custom graphic" },
      ...["retreat", "supply", "naval", "encirclement", "theater"].map((kind) => ({ id: kind, kind, label: "" })),
      { id: "unknown-id", label: "" },
    ],
    operationalLineEditor: { selectedId: "line-1" },
    operationGraphicsEditor: { selectedId: "graphic-1" },
  };
  const elements = Object.fromEntries(["operationalLineList", "operationGraphicList", "operationalLineKindSelect", "operationGraphicKindSelect"].map((key) => [key, new Select()]));
  const controller = createStrategicOverlayController({ state, elements: { ...elements, strategicCommandButtons: [] }, helpers: { t, normalizeAnnotationView: () => ({}) } });
  return { state, elements, refresh: () => controller.refreshUI({ scopes: ["operationalLines", "operationGraphics"] }) };
}

test("overlay lists and type choices translate on refresh without changing user labels, ids, or selection", (context) => {
  const { state, elements, refresh } = fixture(context);
  const originalEntities = structuredClone([state.operationalLines, state.operationGraphics]);
  const labels = (key) => elements[key].children.map((entry) => entry.textContent);
  const listLabels = (key) => labels(key).slice(1);
  setCurrentLanguage(runtimeState, "en");
  refresh();
  assert.deepEqual(listLabels("operationalLineList"), ["Custom line (Defensive Line)", "Offensive Line", "Attack (Spearhead Line)", "中文自定义 (Frontline)"]);
  assert.deepEqual(listLabels("operationGraphicList"), ["Custom graphic (Attack)", "Retreat", "Supply", "Naval", "Encirclement", "Theater", "unknown-id"]);

  setCurrentLanguage(runtimeState, "zh");
  refresh();
  assert.deepEqual(listLabels("operationalLineList"), ["Custom line (防御线)", "进攻线", "Attack (突击线)", "中文自定义 (前线)"]);
  assert.deepEqual(listLabels("operationGraphicList"), ["Custom graphic (进攻)", "撤退", "补给", "海军", "包围", "战区", "unknown-id"]);
  assert.deepEqual(labels("operationalLineKindSelect"), ["前线", "进攻线", "突击线", "防御线"]);
  assert.deepEqual(labels("operationGraphicKindSelect"), ["进攻", "撤退", "补给", "海军", "包围", "战区"]);
  assert.equal(elements.operationalLineList.value, "line-1");
  assert.equal(elements.operationGraphicList.value, "graphic-1");
  assert.equal(elements.operationalLineKindSelect.value, "defensive_line");
  assert.equal(elements.operationGraphicKindSelect.value, "attack");
  assert.deepEqual([state.operationalLines, state.operationGraphics], originalEntities);

  const existingOptions = [...elements.operationalLineList.children];
  refresh();
  existingOptions.forEach((option, index) => assert.equal(elements.operationalLineList.children[index], option));
});
