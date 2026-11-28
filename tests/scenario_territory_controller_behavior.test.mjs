import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { clearHistory } from "../js/core/history_manager.js";
import { createScenarioTerritoryController } from "../js/ui/sidebar/scenario_territory_controller.js";

const TOUCHED_STATE_KEYS = ["activeScenarioId", "releasableCatalog", "releasableBoundaryVariantByTag", "visualOverrides"];
let savedState = null;
test.beforeEach(() => {
  savedState = Object.fromEntries(TOUCHED_STATE_KEYS.map(key => [key, state[key]]));
  clearHistory();
});
test.afterEach(() => {
  clearHistory();
  Object.assign(state, savedState);
});
const country = { code: "CORE", color: "#aabbcc" };
const source = (...ids) => ({ type: "feature_ids", feature_ids: ids });
function harness({ missingTarget = false } = {}) {
  const entry = { tag: "CORE", default_boundary_variant_id: "small",
    boundary_variants: [
      { id: "small", preset_source: source("core") },
      { id: "large", preset_source: source("core", "old", "other") },
    ], companion_actions: [
      { id: "ally", target_owner_tag: "ALLY", auto_apply_on_core_territory: true, preset_source: source("ally") },
      { id: "hidden", target_owner_tag: "ALLY", hidden_in_ui: true, auto_apply_on_core_territory: true, preset_source: source("hidden") },
    ] };
  state.activeScenarioId = "test-territory";
  state.releasableCatalog = { entries: [entry] };
  state.releasableBoundaryVariantByTag = { CORE: "small" };
  state.visualOverrides = { old: "#AABBCC", other: "#123456" };
  const controller = createScenarioTerritoryController({
    t: value => value,
    getCountryState: code => code === "CORE" ? country : missingTarget ? null : { code: "ALLY", color: "#112233" },
    getResolvedCountryColor: value => value.color,
    showToast() {}, render() {}, renderList() {},
  });
  const apply = controller.applyScenarioReleasableCoreTerritory;
  controller.applyScenarioReleasableCoreTerritory = (countryState, options = {}) => apply(countryState, {
    filterToVisibleFeatureIds: ids => ({ matchedIds: ids }), ...options,
  });
  return { controller };
}
const overrides = () => ({ ...state.visualOverrides });

test("selected variant and companions use current country colors in one batch transaction", () => {
  const { controller } = harness();
  state.releasableBoundaryVariantByTag.CORE = "large";
  assert.equal(controller.applyScenarioReleasableCoreTerritory(country), true);
  assert.deepEqual(overrides(), { core: "#aabbcc", old: "#aabbcc", other: "#aabbcc", ally: "#112233" });
});

test("hidden companions never execute even if selected; missing targets are skipped", () => {
  for (const missingTarget of [false, true]) {
    clearHistory();
    const { controller } = harness({ missingTarget });
    controller.applyScenarioReleasableCoreTerritory(country, { companionActionIds: ["ally", "hidden"] });
    assert.equal(Object.hasOwn(overrides(), "ally"), !missingTarget);
    assert.equal(Object.hasOwn(overrides(), "hidden"), false);
  }
});
