import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { hasDirectStateWrites } from "../tools/check_state_write_allowlist.mjs";

const testPath = "tests/allowlist_fixture.test.mjs";
const stateImport = 'import { state as app } from "../js/core/state.js";';

test("test fixtures and source assertions are not application state writes", () => {
  assert.equal(hasDirectStateWrites(`
    const state = {};
    state.foo = 1;
    const source = "state.foo = 2;";
    const template = \`runtimeState.foo = 3;\`;
    // appState.foo = 4;
  `, testPath), false);
});

test("imported singleton writes remain violations, including aliases", () => {
  for (const mutation of [
    "app.foo = 1;",
    "const alias = app; alias.foo = 1;",
    "Object.assign(app, { foo: 1 });",
    "app.foo += 1;",
    "app['foo'] = 1;",
    "function restore(target) { target.foo = 1; } restore(app);",
  ]) {
    assert.equal(hasDirectStateWrites(stateImport + mutation, testPath), true, mutation);
  }
});

test("shadowed bindings and readonly uses do not become direct writes", () => {
  assert.equal(hasDirectStateWrites(stateImport + `
    function fixture(app) { app.foo = 1; }
    assert.equal(app.foo, 1);
    const source = "app.foo = 2;";
  `, testPath), false);
});

test("canonical action delegation does not count as a direct singleton write", () => {
  const actionImport = 'import { setCurrentLanguage } from "../js/core/state/content_state.js";';
  assert.equal(hasDirectStateWrites(stateImport + actionImport + `
    setCurrentLanguage(app, "zh");
    function updateLocal(app) { app.foo = 1; }
    updateLocal({});
  `, testPath), false);
});

test("an action call cannot hide a direct singleton write in the same fixture", () => {
  const actionImport = 'import { setCurrentLanguage } from "../js/core/state/content_state.js";';
  assert.equal(hasDirectStateWrites(stateImport + actionImport + `
    setCurrentLanguage(app, "zh");
    app.currentLanguage = "en";
  `, testPath), true);
});

test("unsupported dynamic imports keep conservative legacy detection", () => {
  assert.equal(hasDirectStateWrites(`
    const { state } = await import("/js/core/state.js");
    state.foo = 1;
  `, testPath), true);
});

test("production legacy scan remains unchanged", () => {
  assert.equal(hasDirectStateWrites("function f(runtimeState) { runtimeState.foo = 1; }", "js/core/example.js"), true);
});

test("reported real test fixtures pass semantic classification without file exceptions", () => {
  for (const file of [
    "border_mesh_owner_behavior.test.mjs",
    "contracts/state_action_source_boundary_contracts.mjs",
    "country_inspector_model_behavior.test.mjs",
    "map_hover_interaction_owner_behavior.test.mjs",
    "regional_preset_controller_behavior.test.mjs",
    "renderer_surface_host_behavior.test.mjs",
    "scenario_water_signature_behavior.test.mjs",
    "strategic_overlay_render_owner_behavior.test.mjs",
    "viewport_read_model_owner_behavior.test.mjs",
    "workspace_chrome_support_surface_controller_behavior.test.mjs",
    "state_writer_policy_behavior.test.mjs",
    "state_writer_policy_manifest_behavior.test.mjs",
    "state_writer_scanner_soundness_behavior.test.mjs",
    "state_writer_policy_soundness_behavior.test.mjs",
    "day_night_runtime_owner_behavior.test.mjs",
    "political_background_render_owner_behavior.test.mjs",
    "e2e/dev/shared_labels_runtime.dev.spec.js",
    "palette_library_panel_grouping.test.mjs",
    "project_import_transaction_behavior.test.mjs",
    "scenario_import_trust_projection_behavior.test.mjs",
    "startup_boot_overlay_behavior.test.mjs",
    "strategic_history_scope_behavior.test.mjs",
  ]) {
    const relativePath = `tests/${file}`;
    assert.equal(hasDirectStateWrites(fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"), relativePath), false, file);
  }
});
