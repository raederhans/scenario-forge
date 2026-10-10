import test from "node:test";
import assert from "node:assert/strict";
import { readPoliticalIdRasterPreference, getPoliticalIdRasterEligibility } from "../js/core/renderer/political_id_raster_trial.js";

test("URL overrides the saved experiment without requiring storage access", () => {
  const broken = { getItem() { throw new Error("blocked"); } };
  assert.equal(readPoliticalIdRasterPreference({ search: "?political_id_raster=1", storage: broken }), true);
  assert.equal(readPoliticalIdRasterPreference({ search: "?political_id_raster=0", storage: { getItem: () => "1" } }), false);
  assert.equal(readPoliticalIdRasterPreference({ search: "", storage: broken }), false);
  assert.equal(readPoliticalIdRasterPreference({ search: "", storage: { getItem: () => "1" } }), true);
});
test("the trial is eligible only after safe startup and only for the three supported scenarios", () => {
  const base = { requested: true, exporting: false, debugMode: "PROD", ready: true, firstVisible: true,
    readonly: false, unlocking: false, riverPartitions: false, scenarioId: "hoi4_1939" };
  for (const scenarioId of ["hoi4_1936", "hoi4_1939", "tno_1962"]) assert.equal(getPoliticalIdRasterEligibility({ ...base, scenarioId }), "eligible");
  for (const [patch, reason] of [[{ requested: false }, "off"], [{ scenarioId: "modern_world" }, "unsupported-scenario"],
    [{ ready: false }, "startup"], [{ firstVisible: false }, "startup"], [{ readonly: true }, "startup"],
    [{ unlocking: true }, "startup"], [{ exporting: true }, "export"], [{ riverPartitions: true }, "river-partitions"], [{ debugMode: "DEBUG" }, "debug-mode"]]) {
    assert.equal(getPoliticalIdRasterEligibility({ ...base, ...patch }), reason);
  }
});


test("trial control persists changes and exposes translatable live status", async () => {
  const { bindPoliticalRasterTrialControl } = await import("../js/ui/toolbar/political_raster_trial_control.js");
  const target = new EventTarget();
  const original = globalThis.addEventListener;
  globalThis.addEventListener = target.addEventListener.bind(target);
  const toggle = new EventTarget(); toggle.dataset = {}; toggle.checked = false;
  const status = { dataset: {}, textContent: "" };
  let info = { requested: false, displayState: "off", reason: "off" };
  const changes = [];
  try {
    const options = { document: { getElementById: id => id === "politicalRasterTrial" ? toggle : status },
      getDiagnostics: () => info, t: value => value,
      setEnabled: value => { changes.push(value); info = { requested: value, displayState: "preparing" }; } };
    bindPoliticalRasterTrialControl(options);
    bindPoliticalRasterTrialControl(options);
    assert.equal(status.dataset.state, "off");
    toggle.checked = true; toggle.dispatchEvent(new Event("change"));
    assert.deepEqual(changes, [true]);
    assert.equal(status.dataset.i18n, "Preparing accelerated display");
    info = { requested: true, displayState: "precise" };
    target.dispatchEvent(new Event("political-id-raster-status"));
    assert.equal(status.textContent, "Precise display restored");
    assert.equal(toggle.checked, true);
  } finally { globalThis.addEventListener = original; }
});
