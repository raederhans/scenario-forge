import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { registerOwnedRuntimeHook } from "../js/core/state/index.js";
import { initScenarioControls } from "../js/ui/scenario_controls.js";

// CI 运行 Node 20，没有 Promise.withResolvers。
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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

for (const choice of ["clean", "cancel", "discard", "save", "failed save", "new edits during save"]) {
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
      isDirty: choice !== "clean", dirtyRevision: 1,
      historyPast: [{}], historyFuture: [{}],
    });
    const calls = [];
    const saved = deferred();
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
    if (choice === "clean") {
      assert.equal(doc.body.children.length, 0);
    } else {
      assert.equal(doc.body.children.length, 1);
      assert.equal(state.activeScenarioId, "old");
      const label = choice === "discard" ? "Discard and continue" : choice === "cancel" ? "Cancel" : "Save first";
      const button = doc.body.find(label);
      assert.ok(button, `dialog offers ${label}`);
      button.dispatchEvent(new Event("click"));
      if (label === "Save first") {
        await tick();
        assert.deepEqual(calls, ["save"]);
        assert.equal(state.activeScenarioId, "old");
        if (choice === "new edits during save") state.dirtyRevision++;
        saved.resolve(choice !== "failed save");
      }
    }
    await tick();
    const switched = ["clean", "discard", "save"].includes(choice);
    assert.equal(state.activeScenarioId, switched ? "new" : "old");
    assert.equal(state.historyPast.length, switched ? 0 : 1);
    assert.equal(state.historyFuture.length, switched ? 0 : 1);
  });
}
