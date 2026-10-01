// New product routes are additive. Existing gates, ordering and budgets remain intact.
export function createRiverPaintRecords(existingRecords) {
  const start = Math.max(0, ...existingRecords.map(r => r.selectorOrder || 0)) + 1;
  const shared = { ownerHints: ['renderer-runtime'], domains: ['renderer-runtime'], tiers: ['contract'], cost: 'fast',
    resourceLocks: [], executionOwners: ['child-safe'], profiles: ['pr-fast'], platforms: ['all'],
    entrypointPolicyIndex: 4, verificationOrder: null, verification: null, selector: {} };
  return [{ ...shared, id: 'node:test:node:river-paint', commandRef: 'test:node:river-paint', selectorOrder: start,
    sourceRefs: ['js/core/river_paint/editor_owner.js', 'js/core/river_paint/geometry_identity.js', 'js/core/river_paint/partition_model.js', 'js/core/river_paint/pilot_loader.js', 'js/core/river_paint/pilot_manifest.js', 'js/core/river_paint/render_owner.js', 'js/core/river_paint/runtime.js', 'js/core/state/actions/river_paint_actions.js',
      'js/core/map_renderer.js', 'js/core/map_data_boundary.js', 'js/core/history_manager.js',
      'js/core/file_manager.js', 'js/core/interaction_funnel.js', 'js/core/interaction_funnel/import_apply_orchestration.js',
      'js/core/state/color_state.js', 'js/core/state/actions/scenario_activation_actions.js',
      'js/core/scenario_apply_pipeline.js', 'js/core/scenario/lifecycle_runtime.js', 'js/core/legend_state_normalizers.js',
      'js/ui/river_paint_controls.js', 'js/ui/river_cell_picker.js', 'js/ui/toolbar.js', 'index.html',
      'js/core/renderer/political_partial_repaint_owner.js', 'js/core/renderer/political_pass_orchestrator_owner.js', 'tests/political_pass_orchestrator_owner_behavior.test.mjs', 'js/core/renderer/brush_interaction_session_owner.js',
      'js/core/map_renderer/click_selection_transaction_owner.js', 'js/core/map_renderer/map_hover_interaction_owner.js',
      'js/core/renderer/transient_overlay_render_owner.js', 'js/core/renderer/fill_target_policy.js',
      'tests/river_paint_history_import.test.mjs', 'tests/river_paint_model.test.mjs', 'tests/river_paint_runtime.test.mjs', 'tests/river_paint_ui_render.test.mjs', 'tests/helpers/river_paint_fixture.mjs',
      'data/river_partitions/modern_world_pilot.json', 'tools/verification/catalog/records/river_paint.mjs'] },
  { ...shared, id: 'local:river-paint:generator', commandRef: 'python -m unittest tests.test_river_partitions -q', selectorOrder: start + 1,
    ownerHints: ['geo-contract'], domains: ['geo-contract'],
    sourceRefs: ['tools/build_river_partitions.py', 'tests/test_river_partitions.py', 'tests/fixtures/river_paint/stendal.json',
      'data/river_partitions/modern_world_pilot.json'] },
  { ...shared, id: 'e2e:tests/e2e/river_paint.spec.js', selectorOrder: start + 2,
    commandRef: 'node tools/e2e_layering.mjs run-spec tests/e2e/river_paint.spec.js', sourceRefs: ['tests/e2e/river_paint.spec.js'],
    tiers: ['regression'], cost: 'heavy', resourceLocks: ['browser-dev-server', 'playwright-browser', '.runtime-output'],
    executionOwners: ['main-thread'], profiles: ['full'], entrypointPolicyIndex: 0 }];
}
