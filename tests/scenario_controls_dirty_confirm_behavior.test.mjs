import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { registerOwnedRuntimeHook } from "../js/core/state/index.js";
import { initScenarioControls } from "../js/ui/scenario_controls.js";

import { createDeferredPromise } from "./helpers/deferred_promise.mjs";

class Element extends EventTarget {
  children = [];
  dataset = {};
  classList = { toggle() {} };
  setAttribute() {}
  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  remove() {}
  find(text) {
    if (this.textContent === text) return this;
    for (const child of this.children) {
      const match = child.find(text);
      if (match) return match;
    }
  }
}

for (const choice of ["failed save", "new edits during save"]) {
  test(`applying a scenario with ${choice}`, async (context) => {
    const select = new Element();
    const apply = new Element();
    const doc = new EventTarget();
    Object.assign(doc, {
      body: new Element(),
      createElement: () => new Element(),
      getElementById: id => ({ scenarioSelect: select, applyScenarioBtn: apply })[id],
    });
    globalThis.document = doc;
    globalThis.HTMLElement = Element;
    globalThis.requestAnimationFrame = () => {};
    context.after(() => {
      delete globalThis.document;
      delete globalThis.HTMLElement;
      delete globalThis.requestAnimationFrame;
    });
    Object.assign(state, {
      currentLanguage: "en", activeScenarioId: "old", bootBlocking: false,
      scenarioRegistry: { scenarios: [{ scenario_id: "new" }] },
      activeScenarioManifest: { opening_view: null },
      isDirty: true, dirtyRevision: 1,
      historyPast: [{}], historyFuture: [{}],
    });
    const calls = [];
    const saved = createDeferredPromise();
    context.after(registerOwnedRuntimeHook(state, "runProjectSaveFn", () => {
      calls.push("save");
      return saved.promise;
    }));
    context.after(initScenarioControls({
      applyScenario(id) { calls.push(id); state.activeScenarioId = id; },
    }));
    const tick = () => new Promise(resolve => setImmediate(resolve));
    await tick();
    select.value = "new";
    select.dispatchEvent(new Event("change"));
    apply.dispatchEvent(new Event("click"));

    const button = doc.body.find("Save first");
    button.dispatchEvent(new Event("click"));

    await tick();
    assert.deepEqual(calls, ["save"]);
    assert.equal(state.activeScenarioId, "old");
    if (choice === "new edits during save") state.dirtyRevision++;
    saved.resolve(choice !== "failed save");

    await tick();
    assert.equal(state.activeScenarioId, "old");
    assert.equal(state.historyPast.length, 1);
    assert.equal(state.historyFuture.length, 1);
  });
}
