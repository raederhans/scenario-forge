import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();

const FILES = Object.freeze({
  packageJson: "package.json",
  stateWriteAllowlist: "tools/eslint-rules/state-writer-allowlist.json",
  renderer: "js/core/map_renderer.js",
  publicFacade: "js/core/map_renderer/public.js",
  rendererRuntimeState: "js/core/state/renderer_runtime_state.js",
  canvasColorHelpers: "js/core/renderer/canvas_color_helpers.js",
  scenarioRefreshRuntime: "js/core/map_renderer/scenario_refresh_runtime.js",
  interactionHitCandidates: "js/core/map_renderer/interaction_hit_candidates.js",
  interactionFunnel: "js/core/interaction_funnel.js",
  historyManager: "js/core/history_manager.js",
  dirtyState: "js/core/dirty_state.js",
  scenarioRefreshPlans: "js/core/map_renderer/scenario_refresh_plans.js",
  scenarioVisualInvalidationExecutor: "js/core/map_renderer/scenario_visual_invalidation_executor.js",
  exactAfterSettleScheduler: "js/core/map_renderer/exact_after_settle_scheduler.js",
  exactAfterSettleRefreshPlans: "js/core/map_renderer/exact_after_settle_refresh_plans.js",
  exactAfterSettlePassCatalog: "js/core/renderer/exact_after_settle_pass_catalog.js",
  hgoPreviewRenderOwner: "js/core/map_renderer/hgo_runtime_preview_render_owner.js",
  renderTransactionDiagnostics: "js/core/renderer/render_transaction_diagnostics.js",
  renderCacheOwner: "js/core/renderer/render_cache_owner.js",
  renderTransformReusePolicyOwner: "js/core/renderer/render_transform_reuse_policy_owner.js",
  projectedGeometryBoundsOwner: "js/core/renderer/projected_geometry_bounds_owner.js",
  viewportReadModelOwner: "js/core/renderer/viewport_read_model_owner.js",
  viewportCommandOwner: "js/core/renderer/viewport_command_owner.js",
  rendererViewportUpdateOwner: "js/core/renderer/renderer_viewport_update_owner.js",
  rendererStartupTransactionOwner: "js/core/renderer/renderer_startup_transaction_owner.js",
  setMapDataTransactionOwner: "js/core/map_renderer/set_map_data_transaction_owner.js",
  renderRequestBoundaryOwner: "js/core/map_renderer/render_request_boundary_owner.js",
  renderPhaseLifecycleOwner: "js/core/map_renderer/render_phase_lifecycle_owner.js",
  renderPerfMetricsRuntimeOwner: "js/core/renderer/render_perf_metrics_runtime_owner.js",
  visibleFrameDiagnosticsOwner: "js/core/renderer/visible_frame_diagnostics_owner.js",
  rendererRenderLifecycleOwner: "js/core/renderer/renderer_render_lifecycle_owner.js",
  viewportResizeLifecycleOwner: "js/core/renderer/viewport_resize_lifecycle_owner.js",
  zoomInteractionLifecycleOwner: "js/core/renderer/zoom_interaction_lifecycle_owner.js",
  mapInteractionEventBindingOwner: "js/core/renderer/map_interaction_event_binding_owner.js",
  spatialIndexRuntimeOwner: "js/core/renderer/spatial_index_runtime_owner.js",
  rendererSurfaceHost: "js/core/renderer/renderer_surface_host.js",
  rendererSurfaceLifecycleOwner: "js/core/renderer/renderer_surface_lifecycle_owner.js",
  rendererProjectionPathOwner: "js/core/renderer/renderer_projection_path_owner.js",
  rendererSvgSurfaceLifecycleOwner: "js/core/renderer/renderer_svg_surface_lifecycle_owner.js",
  rendererFitProjectionOwner: "js/core/renderer/renderer_fit_projection_owner.js",
  scenarioWaterCachePolicyOwner: "js/core/renderer/scenario_water_cache_policy_owner.js",
  renderPipelinePasses: "js/core/renderer/render_pipeline_passes.js",
  renderPipelineCatalog: "js/core/renderer/render_pipeline_catalog.js",
  visualEffectsPassOwner: "js/core/renderer/visual_effects_pass_owner.js",
  dayNightRuntimeOwner: "js/core/renderer/day_night_runtime_owner.js",
  contextPassOrchestratorOwner: "js/core/renderer/context_pass_orchestrator_owner.js",
  politicalPassOrchestratorOwner: "js/core/renderer/political_pass_orchestrator_owner.js",
  politicalBackgroundRenderOwner: "js/core/renderer/political_background_render_owner.js",
  politicalPartialRepaintOwner: "js/core/renderer/political_partial_repaint_owner.js",
  renderPassCatalog: "js/core/map_renderer/render_pass_catalog.js",
  renderInvalidationCatalog: "js/core/map_renderer/render_invalidation_catalog.js",
  rendererSurfaceHostPreflightDoc: "docs/active/renderer-surface-host-preflight-20260626.md",
  rendererSurfaceHostInventoryTest: "tests/renderer_surface_host_inventory_boundary.test.mjs",
  rendererSurfaceLifecyclePreflightDoc: "docs/active/renderer-surface-lifecycle-preflight-20260626.md",
  rendererSurfaceLifecycleInventoryTest: "tests/renderer_surface_lifecycle_inventory_boundary.test.mjs",
  rendererProjectionPathPreflightDoc: "docs/active/renderer-projection-path-lifecycle-preflight-20260627.md",
  rendererProjectionPathOwnerDoc: "docs/active/renderer-projection-path-owner-p28-20260628.md",
  rendererProjectionPathLifecycleInventoryTest: "tests/renderer_projection_path_lifecycle_inventory_boundary.test.mjs",
  rendererSvgSurfaceLifecyclePreflightDoc: "docs/active/renderer-svg-surface-lifecycle-preflight-20260629.md",
  rendererSvgSurfaceLifecycleOwnerDoc: "docs/active/renderer-svg-surface-lifecycle-owner-p30-20260629.md",
  rendererSvgSurfaceLifecycleInventoryTest: "tests/renderer_svg_surface_lifecycle_inventory_boundary.test.mjs",
  rendererFitProjectionLifecyclePreflightDoc: "docs/active/renderer-fit-projection-lifecycle-preflight-20260629.md",
  rendererFitProjectionOwnerTest: "tests/renderer_fit_projection_owner_behavior.test.mjs",
  rendererFitProjectionLifecycleInventoryTest: "tests/renderer_fit_projection_lifecycle_inventory_boundary.test.mjs",
  rendererViewportUpdateOwnerTest: "tests/renderer_viewport_update_owner_behavior.test.mjs",
  rendererStartupTransactionOwnerTest: "tests/renderer_startup_transaction_owner_behavior.test.mjs",
  rendererStartupTransactionPreflightDoc: "docs/active/renderer-startup-transaction-preflight-20260629.md",
  rendererStartupTransactionInventoryTest: "tests/renderer_startup_transaction_inventory_boundary.test.mjs",
  rendererSetMapDataTransactionPreflightDoc: "docs/active/renderer-set-map-data-transaction-preflight-20260630.md",
  rendererSetMapDataTransactionOwnerTest: "tests/renderer_set_map_data_transaction_owner_behavior.test.mjs",
  rendererSetMapDataTransactionInventoryTest: "tests/renderer_set_map_data_transaction_inventory_boundary.test.mjs",
  rendererTransactionResetHardeningPreflightDoc: "docs/active/renderer-transaction-reset-hardening-preflight-20260630.md",
  rendererTransactionResetOwnerDoc: "docs/active/renderer-transaction-reset-owner-p49-20260701.md",
  rendererTransactionResetOwner: "js/core/map_renderer/renderer_transaction_reset_owner.js",
  rendererTransactionResetOwnerTest: "tests/renderer_transaction_reset_owner_behavior.test.mjs",
  rendererTransactionResetHardeningInventoryTest: "tests/renderer_transaction_reset_hardening_inventory_boundary.test.mjs",
  rendererRenderLifecyclePreflightDoc: "docs/active/renderer-render-lifecycle-preflight-20260630.md",
  rendererRenderLifecycleInventoryTest: "tests/renderer_render_lifecycle_inventory_boundary.test.mjs",
  rendererRenderPassCacheHostPreflightDoc: "docs/active/renderer-render-pass-cache-host-preflight-20260701.md",
  rendererRenderPassCacheHostInventoryTest: "tests/renderer_render_pass_cache_host_inventory_boundary.test.mjs",
  rendererRenderPassCacheHostOwnerDoc: "docs/active/renderer-render-pass-cache-host-owner-p51-20260702.md",
  renderPassCacheHostOwner: "js/core/map_renderer/render_pass_cache_host_owner.js",
  renderPassCacheHostOwnerTest: "tests/render_pass_cache_host_owner_behavior.test.mjs",
  renderPassCacheHostOwnerInventoryTest: "tests/render_pass_cache_host_owner_inventory.test.mjs",
  rendererRenderPassCommitAccountingOwnerDoc: "docs/active/renderer-render-pass-commit-accounting-owner-p52-20260702.md",
  renderPassCommitAccountingOwner: "js/core/map_renderer/render_pass_commit_accounting_owner.js",
  renderPassCommitAccountingOwnerTest: "tests/render_pass_commit_accounting_owner_behavior.test.mjs",
  renderPassCommitAccountingOwnerInventoryTest: "tests/render_pass_commit_accounting_owner_inventory.test.mjs",
  drawCanvasOrchestrationOwner: "js/core/map_renderer/draw_canvas_orchestration_owner.js",
  cachedPassCompositorOwner: "js/core/renderer/cached_pass_compositor_owner.js",
  cachedPassCompositorOwnerTest: "tests/cached_pass_compositor_owner_behavior.test.mjs",
  transformedFrameCompositorOwner: "js/core/map_renderer/transformed_frame_compositor_owner.js",
  transformedFrameCompositorOwnerTest: "tests/transformed_frame_compositor_owner_behavior.test.mjs",
  rendererFrameCompositorBoundaryTest: "tests/test_map_renderer_frame_compositor_owner_boundary_contract.py",
  rendererClickSelectionTransactionPreflightDoc: "docs/active/renderer-click-selection-transaction-preflight-20260702.md",
  rendererClickSelectionDecisionOwnerDoc: "docs/active/renderer-click-selection-pure-decision-owner-p1-8-20260709.md",
  clickSelectionTransactionOwner: "js/core/map_renderer/click_selection_transaction_owner.js",
  clickSelectionTransactionOwnerTest: "tests/click_selection_transaction_owner_behavior.test.mjs",
  rendererClickSelectionTransactionInventoryTest: "tests/renderer_click_selection_transaction_inventory_boundary.test.mjs",
  rendererRenderRequestBoundaryOwnerDoc: "docs/active/renderer-render-request-boundary-owner-p41-20260630.md",
  rendererRenderRequestBoundaryOwnerTest: "tests/renderer_render_request_boundary_owner_behavior.test.mjs",
  rendererRenderRequestBoundaryInventoryTest: "tests/renderer_render_request_boundary_inventory.test.mjs",
  rendererRenderPhaseLifecycleOwnerDoc: "docs/active/renderer-render-phase-lifecycle-owner-p43-20260630.md",
  rendererRenderPhaseLifecycleOwnerTest: "tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs",
  rendererRenderPhaseLifecycleInventoryTest: "tests/renderer_render_phase_lifecycle_inventory.test.mjs",
  rendererHitCanvasSchedulingPreflightDoc: "docs/active/renderer-hit-canvas-scheduling-preflight-20260630.md",
  rendererHitCanvasSchedulingOwnerDoc: "docs/active/renderer-hit-canvas-scheduling-owner-p47-20260701.md",
  hitCanvasSchedulingOwner: "js/core/map_renderer/hit_canvas_scheduling_owner.js",
  hitCanvasSchedulingOwnerTest: "tests/hit_canvas_scheduling_owner_behavior.test.mjs",
  hitCanvasSchedulingOwnerInventoryTest: "tests/hit_canvas_scheduling_owner_inventory.test.mjs",
  rendererHitCanvasSchedulingInventoryTest: "tests/renderer_hit_canvas_scheduling_inventory_boundary.test.mjs",
  rendererMapHoverInteractionOwnerDoc: "docs/active/renderer-map-hover-interaction-owner-p48-20260701.md",
  mapHoverInteractionOwner: "js/core/map_renderer/map_hover_interaction_owner.js",
  mapHoverInteractionOwnerTest: "tests/map_hover_interaction_owner_behavior.test.mjs",
  mapHoverInteractionOwnerInventoryTest: "tests/map_hover_interaction_owner_inventory.test.mjs",
  visibleFrameDiagnosticsOwnerDoc: "docs/active/renderer-visible-frame-diagnostics-owner-p42-20260630.md",
  visibleFrameDiagnosticsOwnerTest: "tests/visible_frame_diagnostics_owner_behavior.test.mjs",
  visibleFrameDiagnosticsInventoryTest: "tests/visible_frame_diagnostics_owner_inventory.test.mjs",
});

const FORBIDDEN_TRANSACTION_RESET_HELPER_PATHS = Object.freeze([
  "js/core/map_renderer/renderer_transaction_reset_helper.js",
  "js/core/map_renderer/renderer_transaction_reset_controller.js",
  "js/core/map_renderer/shared_renderer_transaction_reset_owner.js",
  "js/core/map_renderer/shared_renderer_transaction_reset_helper.js",
  "js/core/map_renderer/shared_renderer_transaction_reset_controller.js",
  "js/core/map_renderer/reset_transaction_owner.js",
  "js/core/map_renderer/reset_transaction_helper.js",
  "js/core/map_renderer/reset_transaction_controller.js",
  "js/core/map_renderer/transaction_reset_owner.js",
  "js/core/map_renderer/transaction_reset_helper.js",
  "js/core/map_renderer/transaction_reset_controller.js",
  "js/core/renderer/renderer_transaction_reset_owner.js",
  "js/core/renderer/renderer_transaction_reset_helper.js",
  "js/core/renderer/renderer_transaction_reset_controller.js",
  "js/core/renderer/shared_renderer_transaction_reset_owner.js",
  "js/core/renderer/shared_renderer_transaction_reset_helper.js",
  "js/core/renderer/shared_renderer_transaction_reset_controller.js",
  "js/core/renderer/reset_transaction_owner.js",
  "js/core/renderer/reset_transaction_helper.js",
  "js/core/renderer/reset_transaction_controller.js",
  "js/core/renderer/transaction_reset_owner.js",
  "js/core/renderer/transaction_reset_helper.js",
  "js/core/renderer/transaction_reset_controller.js",
]);

const LINE_BUDGETS = Object.freeze({
  [FILES.renderer]: 20513,
  [FILES.scenarioRefreshRuntime]: 729,
  [FILES.scenarioVisualInvalidationExecutor]: 260,
  [FILES.exactAfterSettleScheduler]: 760,
  [FILES.exactAfterSettlePassCatalog]: 120,
  [FILES.hgoPreviewRenderOwner]: 280,
  [FILES.renderCacheOwner]: 620,
  [FILES.renderTransformReusePolicyOwner]: 260,
  [FILES.projectedGeometryBoundsOwner]: 420,
  [FILES.viewportReadModelOwner]: 260,
  [FILES.viewportCommandOwner]: 220,
  [FILES.contextPassOrchestratorOwner]: 280,
  [FILES.dayNightRuntimeOwner]: 360,
  [FILES.politicalPassOrchestratorOwner]: 280,
  [FILES.politicalBackgroundRenderOwner]: 1380,
  [FILES.politicalPartialRepaintOwner]: 760,
  [FILES.rendererViewportUpdateOwner]: 220,
  [FILES.rendererStartupTransactionOwner]: 220,
  [FILES.setMapDataTransactionOwner]: 260,
  [FILES.renderRequestBoundaryOwner]: 160,
  [FILES.renderPhaseLifecycleOwner]: 260,
  [FILES.renderPerfMetricsRuntimeOwner]: 200,
  [FILES.renderPassCacheHostOwner]: 260,
  [FILES.renderPassCommitAccountingOwner]: 260,
  [FILES.drawCanvasOrchestrationOwner]: 320,
  [FILES.cachedPassCompositorOwner]: 320,
  [FILES.transformedFrameCompositorOwner]: 420,
  [FILES.visualEffectsPassOwner]: 650,
  [FILES.clickSelectionTransactionOwner]: 620,
  [FILES.hitCanvasSchedulingOwner]: 220,
  [FILES.mapHoverInteractionOwner]: 400, // Owns hover state, overlay scheduling and tooltip lifecycle.
  [FILES.rendererTransactionResetOwner]: 260,
  [FILES.visibleFrameDiagnosticsOwner]: 320,
  [FILES.viewportResizeLifecycleOwner]: 360,
  [FILES.zoomInteractionLifecycleOwner]: 320,
  [FILES.mapInteractionEventBindingOwner]: 220,
  [FILES.rendererSurfaceHost]: 120,
  [FILES.rendererSurfaceLifecycleOwner]: 220,
  [FILES.rendererProjectionPathOwner]: 180,
  [FILES.rendererSvgSurfaceLifecycleOwner]: 320,
  [FILES.rendererFitProjectionOwner]: 240,
  [FILES.scenarioWaterCachePolicyOwner]: 260,
  [FILES.renderPipelineCatalog]: 120,
  [FILES.renderPassCatalog]: 80,
  [FILES.renderInvalidationCatalog]: 180,
});

function readProjectFile(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required architecture file: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

export function includesExactLfFragment(source, lfFragment) {
  return String(source).replace(/\r\n?/g, "\n").includes(lfFragment);
}

function lineCount(source) {
  return source.split(/\r?\n/).length;
}

function includesImport(source, importPath) {
  const normalized = source.replaceAll('"', "'");
  return normalized.includes(`from '${importPath}';`);
}

function listProjectSourceFiles(rootRelativePath) {
  const root = path.join(REPO_ROOT, rootRelativePath);
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
        results.push(path.relative(REPO_ROOT, absolutePath).replaceAll(path.sep, "/"));
      }
    }
  }
  return results.sort();
}

function hasMapRendererImport(source) {
  return /from\s+["'][^"']*map_renderer\.js["']/.test(source)
    || /import\s+["'][^"']*map_renderer\.js["']\s*;?/.test(source)
    || /import\s*\(\s*["'][^"']*map_renderer\.js["']\s*\)/.test(source);
}

function isForbiddenTransactionResetHelperPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (normalized === FILES.rendererTransactionResetOwner) {
    return false;
  }
  if (!normalized.startsWith("js/core/")) {
    return false;
  }
  const baseName = path.basename(normalized);
  if (!/\.m?js$/.test(baseName)) {
    return false;
  }
  const stem = baseName.replace(/\.m?js$/, "");
  return stem.includes("reset")
    && stem.includes("transaction")
    && /(?:^|_)(?:owner|helper|controller)(?:_|$)/.test(stem);
}

function isForbiddenRenderLifecycleOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (normalized === FILES.renderPhaseLifecycleOwner) {
    return false;
  }
  if (!normalized.startsWith("js/core/map_renderer/") && !normalized.startsWith("js/core/renderer/")) {
    return false;
  }
  const baseName = path.basename(normalized);
  if (!/\.m?js$/.test(baseName)) {
    return false;
  }
  const stem = baseName.replace(/\.m?js$/, "");
  const parts = stem.split("_").filter(Boolean);
  return parts.includes("render")
    && parts.includes("lifecycle")
    && parts.some((part) => ["owner", "helper", "controller"].includes(part));
}

function isForbiddenDrawCanvasOrchestrationOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (normalized === FILES.drawCanvasOrchestrationOwner) {
    return false;
  }
  if (!normalized.startsWith("js/core/")) {
    return false;
  }
  const baseName = path.basename(normalized);
  if (!/\.m?js$/.test(baseName)) {
    return false;
  }
  const stem = baseName.replace(/\.m?js$/, "").toLowerCase();
  const compact = stem.replace(/[_-]/g, "");
  return compact.includes("drawcanvas")
    && (compact.includes("orchestration") || compact.includes("orchestrator"))
    && /(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)/.test(stem);
}

function isForbiddenCachedPassCompositorOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (normalized === FILES.cachedPassCompositorOwner) return false;
  if (!normalized.startsWith("js/core/")) return false;
  const baseName = path.basename(normalized);
  if (!/\.m?js$/.test(baseName)) return false;
  const stem = baseName.replace(/\.m?js$/, "").toLowerCase().replace(/-/g, "_");
  const compact = stem.replaceAll("_", "");
  return compact.includes("cachedpasscompositor")
    && /(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)/.test(stem);
}

function isForbiddenTransformedFrameCompositorOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (normalized === FILES.transformedFrameCompositorOwner) return false;
  if (!normalized.startsWith("js/core/")) return false;
  const baseName = path.basename(normalized);
  if (!/\.m?js$/.test(baseName)) return false;
  const stem = baseName.replace(/\.m?js$/, "").toLowerCase().replace(/-/g, "_");
  const compact = stem.replaceAll("_", "");
  return compact.includes("transformedframecompositor")
    && /(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)/.test(stem);
}

function isClickSelectionTransactionOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (!normalized.startsWith("js/core/")) {
    return false;
  }
  const baseName = path.basename(normalized);
  if (!/\.m?js$/.test(baseName)) {
    return false;
  }
  const stem = baseName.replace(/\.m?js$/, "").toLowerCase();
  const compact = stem.replace(/[_-]/g, "");
  const hasClick = compact.includes("click") || compact.includes("mapclick");
  const hasSelection = compact.includes("selection") || compact.includes("select");
  const hasTransaction = compact.includes("transaction");
  const hasOwnerShape = /(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)/.test(stem);
  return hasOwnerShape && hasClick && (hasSelection || hasTransaction);
}

function hasHitCanvasOwnerImport(source) {
  const importPattern = /\bfrom\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  return Array.from(source.matchAll(importPattern)).some((match) => {
    const specifier = match[1] || match[2] || match[3] || "";
    return specifier.toLowerCase().replace(/[_/-]/g, "").includes("hitcanvas");
  });
}

function isForbiddenHitCanvasOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (!normalized.startsWith("js/core/")) {
    return false;
  }
  const baseName = path.basename(normalized);
  if (!/\.m?js$/.test(baseName)) {
    return false;
  }
  const stem = baseName.replace(/\.m?js$/, "");
  return stem.toLowerCase().replace(/[_-]/g, "").includes("hitcanvas");
}

function isRendererOwnerPath(sourcePath) {
  const baseName = path.basename(sourcePath);
  return sourcePath.startsWith("js/core/renderer/")
    && (baseName.endsWith("_owner.js") || baseName === "renderer_surface_lifecycle_owner.js");
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return "";
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function countToken(source, token) {
  return source.split(token).length - 1;
}

function collectFailures() {
  const failures = [];
  const packageJson = readProjectFile(FILES.packageJson);
  const stateWriteAllowlist = readProjectFile(FILES.stateWriteAllowlist);
  const renderer = readProjectFile(FILES.renderer);
  const publicFacadeSource = readProjectFile(FILES.publicFacade);
  const rendererRuntimeState = readProjectFile(FILES.rendererRuntimeState);
  const canvasColorHelpers = readProjectFile(FILES.canvasColorHelpers);
  const scenarioRefreshRuntime = readProjectFile(FILES.scenarioRefreshRuntime);
  const interactionHitCandidates = readProjectFile(FILES.interactionHitCandidates);
  const interactionFunnel = readProjectFile(FILES.interactionFunnel);
  const historyManager = readProjectFile(FILES.historyManager);
  const dirtyState = readProjectFile(FILES.dirtyState);
  const scenarioRefreshPlans = readProjectFile(FILES.scenarioRefreshPlans);
  const scenarioVisualInvalidationExecutor = readProjectFile(FILES.scenarioVisualInvalidationExecutor);
  const exactAfterSettleScheduler = readProjectFile(FILES.exactAfterSettleScheduler);
  const exactAfterSettleRefreshPlans = readProjectFile(FILES.exactAfterSettleRefreshPlans);
  const exactAfterSettlePassCatalog = readProjectFile(FILES.exactAfterSettlePassCatalog);
  const hgoPreviewRenderOwner = readProjectFile(FILES.hgoPreviewRenderOwner);
  const renderTransactionDiagnostics = readProjectFile(FILES.renderTransactionDiagnostics);
  const renderCacheOwner = readProjectFile(FILES.renderCacheOwner);
  const renderTransformReusePolicyOwner = readProjectFile(FILES.renderTransformReusePolicyOwner);
  const projectedGeometryBoundsOwner = readProjectFile(FILES.projectedGeometryBoundsOwner);
  const viewportReadModelOwner = readProjectFile(FILES.viewportReadModelOwner);
  const viewportCommandOwner = readProjectFile(FILES.viewportCommandOwner);
  const rendererViewportUpdateOwner = readProjectFile(FILES.rendererViewportUpdateOwner);
  const rendererStartupTransactionOwner = readProjectFile(FILES.rendererStartupTransactionOwner);
  const viewportResizeLifecycleOwner = readProjectFile(FILES.viewportResizeLifecycleOwner);
  const zoomInteractionLifecycleOwner = readProjectFile(FILES.zoomInteractionLifecycleOwner);
  const mapInteractionEventBindingOwner = readProjectFile(FILES.mapInteractionEventBindingOwner);
  const spatialIndexRuntimeOwner = readProjectFile(FILES.spatialIndexRuntimeOwner);
  const rendererSurfaceHost = readProjectFile(FILES.rendererSurfaceHost);
  const rendererSurfaceLifecycleOwner = readProjectFile(FILES.rendererSurfaceLifecycleOwner);
  const rendererProjectionPathOwner = readProjectFile(FILES.rendererProjectionPathOwner);
  const rendererSvgSurfaceLifecycleOwner = readProjectFile(FILES.rendererSvgSurfaceLifecycleOwner);
  const rendererFitProjectionOwner = readProjectFile(FILES.rendererFitProjectionOwner);
  const scenarioWaterCachePolicyOwner = readProjectFile(FILES.scenarioWaterCachePolicyOwner);
  const renderPipelinePasses = readProjectFile(FILES.renderPipelinePasses);
  const renderPipelineCatalog = readProjectFile(FILES.renderPipelineCatalog);
  const renderPassCatalog = readProjectFile(FILES.renderPassCatalog);
  const renderInvalidationCatalog = readProjectFile(FILES.renderInvalidationCatalog);
  const rendererSurfaceHostPreflightDoc = readProjectFile(FILES.rendererSurfaceHostPreflightDoc);
  const rendererSurfaceHostInventoryTest = readProjectFile(FILES.rendererSurfaceHostInventoryTest);
  const rendererSurfaceLifecyclePreflightDoc = readProjectFile(FILES.rendererSurfaceLifecyclePreflightDoc);
  const rendererSurfaceLifecycleInventoryTest = readProjectFile(FILES.rendererSurfaceLifecycleInventoryTest);
  const rendererProjectionPathPreflightDoc = readProjectFile(FILES.rendererProjectionPathPreflightDoc);
  const rendererProjectionPathOwnerDoc = readProjectFile(FILES.rendererProjectionPathOwnerDoc);
  const rendererProjectionPathLifecycleInventoryTest = readProjectFile(FILES.rendererProjectionPathLifecycleInventoryTest);
  const rendererSvgSurfaceLifecyclePreflightDoc = readProjectFile(FILES.rendererSvgSurfaceLifecyclePreflightDoc);
  const rendererSvgSurfaceLifecycleOwnerDoc = readProjectFile(FILES.rendererSvgSurfaceLifecycleOwnerDoc);
  const rendererSvgSurfaceLifecycleInventoryTest = readProjectFile(FILES.rendererSvgSurfaceLifecycleInventoryTest);
  const rendererFitProjectionLifecyclePreflightDoc = readProjectFile(FILES.rendererFitProjectionLifecyclePreflightDoc);
  const rendererFitProjectionOwnerTest = readProjectFile(FILES.rendererFitProjectionOwnerTest);
  const rendererFitProjectionLifecycleInventoryTest = readProjectFile(FILES.rendererFitProjectionLifecycleInventoryTest);
  const rendererViewportUpdateOwnerTest = readProjectFile(FILES.rendererViewportUpdateOwnerTest);
  const rendererStartupTransactionPreflightDoc = readProjectFile(FILES.rendererStartupTransactionPreflightDoc);
  const rendererStartupTransactionInventoryTest = readProjectFile(FILES.rendererStartupTransactionInventoryTest);
  const rendererSetMapDataTransactionPreflightDoc = readProjectFile(FILES.rendererSetMapDataTransactionPreflightDoc);
  const setMapDataTransactionOwner = readProjectFile(FILES.setMapDataTransactionOwner);
  const rendererSetMapDataTransactionOwnerTest = readProjectFile(FILES.rendererSetMapDataTransactionOwnerTest);
  const rendererSetMapDataTransactionInventoryTest = readProjectFile(FILES.rendererSetMapDataTransactionInventoryTest);
  const renderRequestBoundaryOwner = readProjectFile(FILES.renderRequestBoundaryOwner);
  const renderPhaseLifecycleOwner = readProjectFile(FILES.renderPhaseLifecycleOwner);
  const renderPerfMetricsRuntimeOwner = readProjectFile(FILES.renderPerfMetricsRuntimeOwner);
  const visibleFrameDiagnosticsOwner = readProjectFile(FILES.visibleFrameDiagnosticsOwner);
  const rendererTransactionResetHardeningPreflightDoc = readProjectFile(
    FILES.rendererTransactionResetHardeningPreflightDoc,
  );
  const rendererTransactionResetOwnerDoc = readProjectFile(FILES.rendererTransactionResetOwnerDoc);
  const rendererTransactionResetOwner = readProjectFile(FILES.rendererTransactionResetOwner);
  const rendererTransactionResetOwnerTest = readProjectFile(FILES.rendererTransactionResetOwnerTest);
  const rendererTransactionResetHardeningInventoryTest = readProjectFile(
    FILES.rendererTransactionResetHardeningInventoryTest,
  );
  const rendererRenderLifecyclePreflightDoc = readProjectFile(FILES.rendererRenderLifecyclePreflightDoc);
  const rendererRenderLifecycleInventoryTest = readProjectFile(FILES.rendererRenderLifecycleInventoryTest);
  const rendererRenderPassCacheHostPreflightDoc = readProjectFile(
    FILES.rendererRenderPassCacheHostPreflightDoc,
  );
  const rendererRenderPassCacheHostInventoryTest = readProjectFile(
    FILES.rendererRenderPassCacheHostInventoryTest,
  );
  const rendererRenderPassCacheHostOwnerDoc = readProjectFile(FILES.rendererRenderPassCacheHostOwnerDoc);
  const renderPassCacheHostOwner = readProjectFile(FILES.renderPassCacheHostOwner);
  const renderPassCacheHostOwnerTest = readProjectFile(FILES.renderPassCacheHostOwnerTest);
  const renderPassCacheHostOwnerInventoryTest = readProjectFile(FILES.renderPassCacheHostOwnerInventoryTest);
  const rendererRenderPassCommitAccountingOwnerDoc = readProjectFile(
    FILES.rendererRenderPassCommitAccountingOwnerDoc,
  );
  const renderPassCommitAccountingOwner = readProjectFile(FILES.renderPassCommitAccountingOwner);
  const renderPassCommitAccountingOwnerTest = readProjectFile(FILES.renderPassCommitAccountingOwnerTest);
  const renderPassCommitAccountingOwnerInventoryTest = readProjectFile(
    FILES.renderPassCommitAccountingOwnerInventoryTest,
  );
  const drawCanvasOrchestrationOwner = readProjectFile(FILES.drawCanvasOrchestrationOwner);
  const cachedPassCompositorOwner = readProjectFile(FILES.cachedPassCompositorOwner);
  const cachedPassCompositorOwnerTest = readProjectFile(FILES.cachedPassCompositorOwnerTest);
  const transformedFrameCompositorOwner = readProjectFile(FILES.transformedFrameCompositorOwner);
  const transformedFrameCompositorOwnerTest = readProjectFile(FILES.transformedFrameCompositorOwnerTest);
  const visualEffectsPassOwner = readProjectFile(FILES.visualEffectsPassOwner);
  const dayNightRuntimeOwner = readProjectFile(FILES.dayNightRuntimeOwner);
  const contextPassOrchestratorOwner = readProjectFile(FILES.contextPassOrchestratorOwner);
  const politicalPassOrchestratorOwner = readProjectFile(FILES.politicalPassOrchestratorOwner);
  const politicalBackgroundRenderOwner = readProjectFile(FILES.politicalBackgroundRenderOwner);
  const politicalPartialRepaintOwner = readProjectFile(FILES.politicalPartialRepaintOwner);
  const rendererFrameCompositorBoundaryTest = readProjectFile(FILES.rendererFrameCompositorBoundaryTest);
  const rendererClickSelectionTransactionPreflightDoc = readProjectFile(
    FILES.rendererClickSelectionTransactionPreflightDoc,
  );
  const rendererClickSelectionDecisionOwnerDoc = readProjectFile(
    FILES.rendererClickSelectionDecisionOwnerDoc,
  );
  const clickSelectionTransactionOwner = readProjectFile(FILES.clickSelectionTransactionOwner);
  const clickSelectionTransactionOwnerTest = readProjectFile(FILES.clickSelectionTransactionOwnerTest);
  const rendererClickSelectionTransactionInventoryTest = readProjectFile(
    FILES.rendererClickSelectionTransactionInventoryTest,
  );
  const rendererRenderRequestBoundaryOwnerDoc = readProjectFile(FILES.rendererRenderRequestBoundaryOwnerDoc);
  const rendererRenderRequestBoundaryOwnerTest = readProjectFile(FILES.rendererRenderRequestBoundaryOwnerTest);
  const rendererRenderRequestBoundaryInventoryTest = readProjectFile(
    FILES.rendererRenderRequestBoundaryInventoryTest,
  );
  const rendererRenderPhaseLifecycleOwnerDoc = readProjectFile(FILES.rendererRenderPhaseLifecycleOwnerDoc);
  const rendererRenderPhaseLifecycleOwnerTest = readProjectFile(FILES.rendererRenderPhaseLifecycleOwnerTest);
  const rendererRenderPhaseLifecycleInventoryTest = readProjectFile(
    FILES.rendererRenderPhaseLifecycleInventoryTest,
  );
  const rendererHitCanvasSchedulingPreflightDoc = readProjectFile(FILES.rendererHitCanvasSchedulingPreflightDoc);
  const rendererHitCanvasSchedulingOwnerDoc = readProjectFile(FILES.rendererHitCanvasSchedulingOwnerDoc);
  const hitCanvasSchedulingOwner = readProjectFile(FILES.hitCanvasSchedulingOwner);
  const hitCanvasSchedulingOwnerTest = readProjectFile(FILES.hitCanvasSchedulingOwnerTest);
  const hitCanvasSchedulingOwnerInventoryTest = readProjectFile(FILES.hitCanvasSchedulingOwnerInventoryTest);
  const rendererHitCanvasSchedulingInventoryTest = readProjectFile(FILES.rendererHitCanvasSchedulingInventoryTest);
  const rendererMapHoverInteractionOwnerDoc = readProjectFile(FILES.rendererMapHoverInteractionOwnerDoc);
  const mapHoverInteractionOwner = readProjectFile(FILES.mapHoverInteractionOwner);
  const mapHoverInteractionOwnerTest = readProjectFile(FILES.mapHoverInteractionOwnerTest);
  const mapHoverInteractionOwnerInventoryTest = readProjectFile(FILES.mapHoverInteractionOwnerInventoryTest);
  const visibleFrameDiagnosticsOwnerDoc = readProjectFile(FILES.visibleFrameDiagnosticsOwnerDoc);
  const visibleFrameDiagnosticsOwnerTest = readProjectFile(FILES.visibleFrameDiagnosticsOwnerTest);
  const visibleFrameDiagnosticsInventoryTest = readProjectFile(FILES.visibleFrameDiagnosticsInventoryTest);
  const sources = {
    [FILES.packageJson]: packageJson,
    [FILES.stateWriteAllowlist]: stateWriteAllowlist,
    [FILES.renderer]: renderer,
    [FILES.publicFacade]: publicFacadeSource,
    [FILES.rendererRuntimeState]: rendererRuntimeState,
    [FILES.canvasColorHelpers]: canvasColorHelpers,
    [FILES.scenarioRefreshRuntime]: scenarioRefreshRuntime,
    [FILES.interactionHitCandidates]: interactionHitCandidates,
    [FILES.interactionFunnel]: interactionFunnel,
    [FILES.historyManager]: historyManager,
    [FILES.dirtyState]: dirtyState,
    [FILES.scenarioRefreshPlans]: scenarioRefreshPlans,
    [FILES.scenarioVisualInvalidationExecutor]: scenarioVisualInvalidationExecutor,
    [FILES.exactAfterSettleScheduler]: exactAfterSettleScheduler,
    [FILES.exactAfterSettleRefreshPlans]: exactAfterSettleRefreshPlans,
    [FILES.exactAfterSettlePassCatalog]: exactAfterSettlePassCatalog,
    [FILES.hgoPreviewRenderOwner]: hgoPreviewRenderOwner,
    [FILES.renderTransactionDiagnostics]: renderTransactionDiagnostics,
    [FILES.renderCacheOwner]: renderCacheOwner,
    [FILES.renderTransformReusePolicyOwner]: renderTransformReusePolicyOwner,
    [FILES.projectedGeometryBoundsOwner]: projectedGeometryBoundsOwner,
    [FILES.viewportReadModelOwner]: viewportReadModelOwner,
    [FILES.viewportCommandOwner]: viewportCommandOwner,
    [FILES.rendererViewportUpdateOwner]: rendererViewportUpdateOwner,
    [FILES.rendererStartupTransactionOwner]: rendererStartupTransactionOwner,
    [FILES.viewportResizeLifecycleOwner]: viewportResizeLifecycleOwner,
    [FILES.zoomInteractionLifecycleOwner]: zoomInteractionLifecycleOwner,
    [FILES.mapInteractionEventBindingOwner]: mapInteractionEventBindingOwner,
    [FILES.spatialIndexRuntimeOwner]: spatialIndexRuntimeOwner,
    [FILES.rendererSurfaceHost]: rendererSurfaceHost,
    [FILES.rendererSurfaceLifecycleOwner]: rendererSurfaceLifecycleOwner,
    [FILES.rendererProjectionPathOwner]: rendererProjectionPathOwner,
    [FILES.rendererSvgSurfaceLifecycleOwner]: rendererSvgSurfaceLifecycleOwner,
    [FILES.rendererFitProjectionOwner]: rendererFitProjectionOwner,
    [FILES.scenarioWaterCachePolicyOwner]: scenarioWaterCachePolicyOwner,
    [FILES.renderPipelinePasses]: renderPipelinePasses,
    [FILES.renderPipelineCatalog]: renderPipelineCatalog,
    [FILES.renderPassCatalog]: renderPassCatalog,
    [FILES.renderInvalidationCatalog]: renderInvalidationCatalog,
    [FILES.rendererSurfaceHostPreflightDoc]: rendererSurfaceHostPreflightDoc,
    [FILES.rendererSurfaceHostInventoryTest]: rendererSurfaceHostInventoryTest,
    [FILES.rendererSurfaceLifecyclePreflightDoc]: rendererSurfaceLifecyclePreflightDoc,
    [FILES.rendererSurfaceLifecycleInventoryTest]: rendererSurfaceLifecycleInventoryTest,
    [FILES.rendererProjectionPathPreflightDoc]: rendererProjectionPathPreflightDoc,
    [FILES.rendererProjectionPathOwnerDoc]: rendererProjectionPathOwnerDoc,
    [FILES.rendererProjectionPathLifecycleInventoryTest]: rendererProjectionPathLifecycleInventoryTest,
    [FILES.rendererSvgSurfaceLifecyclePreflightDoc]: rendererSvgSurfaceLifecyclePreflightDoc,
    [FILES.rendererSvgSurfaceLifecycleOwnerDoc]: rendererSvgSurfaceLifecycleOwnerDoc,
    [FILES.rendererSvgSurfaceLifecycleInventoryTest]: rendererSvgSurfaceLifecycleInventoryTest,
    [FILES.rendererFitProjectionLifecyclePreflightDoc]: rendererFitProjectionLifecyclePreflightDoc,
    [FILES.rendererFitProjectionOwnerTest]: rendererFitProjectionOwnerTest,
    [FILES.rendererFitProjectionLifecycleInventoryTest]: rendererFitProjectionLifecycleInventoryTest,
    [FILES.rendererViewportUpdateOwnerTest]: rendererViewportUpdateOwnerTest,
    [FILES.rendererStartupTransactionPreflightDoc]: rendererStartupTransactionPreflightDoc,
    [FILES.rendererStartupTransactionInventoryTest]: rendererStartupTransactionInventoryTest,
    [FILES.rendererSetMapDataTransactionPreflightDoc]: rendererSetMapDataTransactionPreflightDoc,
    [FILES.setMapDataTransactionOwner]: setMapDataTransactionOwner,
    [FILES.rendererSetMapDataTransactionOwnerTest]: rendererSetMapDataTransactionOwnerTest,
    [FILES.rendererSetMapDataTransactionInventoryTest]: rendererSetMapDataTransactionInventoryTest,
    [FILES.renderRequestBoundaryOwner]: renderRequestBoundaryOwner,
    [FILES.renderPhaseLifecycleOwner]: renderPhaseLifecycleOwner,
    [FILES.renderPerfMetricsRuntimeOwner]: renderPerfMetricsRuntimeOwner,
    [FILES.visibleFrameDiagnosticsOwner]: visibleFrameDiagnosticsOwner,
    [FILES.rendererTransactionResetHardeningPreflightDoc]: rendererTransactionResetHardeningPreflightDoc,
    [FILES.rendererTransactionResetOwnerDoc]: rendererTransactionResetOwnerDoc,
    [FILES.rendererTransactionResetOwner]: rendererTransactionResetOwner,
    [FILES.rendererTransactionResetOwnerTest]: rendererTransactionResetOwnerTest,
    [FILES.rendererTransactionResetHardeningInventoryTest]: rendererTransactionResetHardeningInventoryTest,
    [FILES.rendererRenderLifecyclePreflightDoc]: rendererRenderLifecyclePreflightDoc,
    [FILES.rendererRenderLifecycleInventoryTest]: rendererRenderLifecycleInventoryTest,
    [FILES.rendererRenderPassCacheHostPreflightDoc]: rendererRenderPassCacheHostPreflightDoc,
    [FILES.rendererRenderPassCacheHostInventoryTest]: rendererRenderPassCacheHostInventoryTest,
    [FILES.rendererRenderPassCacheHostOwnerDoc]: rendererRenderPassCacheHostOwnerDoc,
    [FILES.renderPassCacheHostOwner]: renderPassCacheHostOwner,
    [FILES.renderPassCacheHostOwnerTest]: renderPassCacheHostOwnerTest,
    [FILES.renderPassCacheHostOwnerInventoryTest]: renderPassCacheHostOwnerInventoryTest,
    [FILES.rendererRenderPassCommitAccountingOwnerDoc]: rendererRenderPassCommitAccountingOwnerDoc,
    [FILES.renderPassCommitAccountingOwner]: renderPassCommitAccountingOwner,
    [FILES.renderPassCommitAccountingOwnerTest]: renderPassCommitAccountingOwnerTest,
    [FILES.renderPassCommitAccountingOwnerInventoryTest]: renderPassCommitAccountingOwnerInventoryTest,
    [FILES.drawCanvasOrchestrationOwner]: drawCanvasOrchestrationOwner,
    [FILES.cachedPassCompositorOwner]: cachedPassCompositorOwner,
    [FILES.cachedPassCompositorOwnerTest]: cachedPassCompositorOwnerTest,
    [FILES.transformedFrameCompositorOwner]: transformedFrameCompositorOwner,
    [FILES.transformedFrameCompositorOwnerTest]: transformedFrameCompositorOwnerTest,
    [FILES.visualEffectsPassOwner]: visualEffectsPassOwner,
    [FILES.dayNightRuntimeOwner]: dayNightRuntimeOwner,
    [FILES.contextPassOrchestratorOwner]: contextPassOrchestratorOwner,
    [FILES.politicalPassOrchestratorOwner]: politicalPassOrchestratorOwner,
    [FILES.politicalBackgroundRenderOwner]: politicalBackgroundRenderOwner,
    [FILES.politicalPartialRepaintOwner]: politicalPartialRepaintOwner,
    [FILES.rendererFrameCompositorBoundaryTest]: rendererFrameCompositorBoundaryTest,
    [FILES.rendererClickSelectionTransactionPreflightDoc]: rendererClickSelectionTransactionPreflightDoc,
    [FILES.rendererClickSelectionDecisionOwnerDoc]: rendererClickSelectionDecisionOwnerDoc,
    [FILES.clickSelectionTransactionOwner]: clickSelectionTransactionOwner,
    [FILES.clickSelectionTransactionOwnerTest]: clickSelectionTransactionOwnerTest,
    [FILES.rendererClickSelectionTransactionInventoryTest]: rendererClickSelectionTransactionInventoryTest,
    [FILES.rendererRenderRequestBoundaryOwnerDoc]: rendererRenderRequestBoundaryOwnerDoc,
    [FILES.rendererRenderRequestBoundaryOwnerTest]: rendererRenderRequestBoundaryOwnerTest,
    [FILES.rendererRenderRequestBoundaryInventoryTest]: rendererRenderRequestBoundaryInventoryTest,
    [FILES.rendererRenderPhaseLifecycleOwnerDoc]: rendererRenderPhaseLifecycleOwnerDoc,
    [FILES.rendererRenderPhaseLifecycleOwnerTest]: rendererRenderPhaseLifecycleOwnerTest,
    [FILES.rendererRenderPhaseLifecycleInventoryTest]: rendererRenderPhaseLifecycleInventoryTest,
    [FILES.rendererHitCanvasSchedulingPreflightDoc]: rendererHitCanvasSchedulingPreflightDoc,
    [FILES.rendererHitCanvasSchedulingOwnerDoc]: rendererHitCanvasSchedulingOwnerDoc,
    [FILES.hitCanvasSchedulingOwner]: hitCanvasSchedulingOwner,
    [FILES.hitCanvasSchedulingOwnerTest]: hitCanvasSchedulingOwnerTest,
    [FILES.hitCanvasSchedulingOwnerInventoryTest]: hitCanvasSchedulingOwnerInventoryTest,
    [FILES.rendererHitCanvasSchedulingInventoryTest]: rendererHitCanvasSchedulingInventoryTest,
    [FILES.rendererMapHoverInteractionOwnerDoc]: rendererMapHoverInteractionOwnerDoc,
    [FILES.mapHoverInteractionOwner]: mapHoverInteractionOwner,
    [FILES.mapHoverInteractionOwnerTest]: mapHoverInteractionOwnerTest,
    [FILES.mapHoverInteractionOwnerInventoryTest]: mapHoverInteractionOwnerInventoryTest,
    [FILES.visibleFrameDiagnosticsOwnerDoc]: visibleFrameDiagnosticsOwnerDoc,
    [FILES.visibleFrameDiagnosticsOwnerTest]: visibleFrameDiagnosticsOwnerTest,
    [FILES.visibleFrameDiagnosticsInventoryTest]: visibleFrameDiagnosticsInventoryTest,
  };

  for (const [relativePath, budget] of Object.entries(LINE_BUDGETS)) {
    const count = lineCount(sources[relativePath]);
    if (count > budget) {
      failures.push(`${relativePath} has ${count} lines; budget is ${budget}. Move focused behavior into an owner.`);
    }
  }

  for (const token of [
    "export function createRenderPerfMetricsRuntimeOwner(",
    "function recordRenderPerfMetric(",
    "function beginContextMetricSession(",
    "function collectContextMetric(",
    "function endContextMetricSession(",
    "function resetContextBreakdownForExactFrame(",
    "return Object.freeze({",
  ]) {
    if (!renderPerfMetricsRuntimeOwner.includes(token)) {
      failures.push(`${FILES.renderPerfMetricsRuntimeOwner} must own token: ${token}`);
    }
  }
  for (const token of [
    "import ",
    "map_renderer.js",
    "runtimeState",
    "globalThis",
    "window",
    "document",
    "Date.now(",
    "performance.now(",
  ]) {
    if (renderPerfMetricsRuntimeOwner.includes(token)) {
      failures.push(`${FILES.renderPerfMetricsRuntimeOwner} must not contain token: ${token}`);
    }
  }
  for (const token of [
    "createRenderPerfMetricsRuntimeOwner({",
    "getRenderPerfContextBreakdownSnapshot: () => (",
    "captureRenderPerfContextBreakdownState(runtimeState)",
    "commitRenderPerfMetricState: (payload) => commitRenderPerfMetricState(runtimeState, payload)",
    "setRenderPerfContextBreakdownState: (breakdown) => setRenderPerfContextBreakdownState(runtimeState, breakdown)",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep render perf owner composition token: ${token}`);
    }
  }

  for (const token of [
    "export function createRendererSurfaceHost(options = {})",
    "export const RENDERER_SURFACE_HANDLE_KEYS",
    "function createEmptyHandles()",
    "function normalizeHandleValue(value)",
    "function describeHandle(value)",
    "setMany",
    "snapshot",
  ]) {
    if (!rendererSurfaceHost.includes(token)) {
      failures.push(`${FILES.rendererSurfaceHost} must own token: ${token}`);
    }
  }
  for (const token of [
    "map_renderer.js",
    "runtimeState",
    "from \"../state.js\"",
    "from \"./state.js\"",
    "drawCanvas",
    "updateMap",
    "renderPassToCache",
    "buildHitCanvas",
    "applyDevSelectionFill",
    "renderExportPassesToCanvas",
    "renderLegend",
    "projectGeoToScreen",
    "invalidateRenderPasses",
    "requestInteractionRender",
    "requestRendererRender",
    "setMapData",
    "buildInteractionInfrastructureAfterStartup",
    "handleResize",
    "fitProjection",
    "initZoom",
    "bindEvents",
  ]) {
    if (rendererSurfaceHost.includes(token)) {
      failures.push(`${FILES.rendererSurfaceHost} must not own renderer semantic token: ${token}`);
    }
  }

  for (const token of [
    "export function createRendererSurfaceLifecycleOwner({",
    "function resolveDomHandles({",
    "function ensureCanvasLayerHandles({",
    "function ensureHitCanvasHandle()",
    "function acquireCanvasContexts()",
    "getDocument",
    "createHitCanvasElement",
    "ensureCanvasLayers",
    "getCanvasLayer",
    "CANVAS_LAYER_NAMES",
    "willReadFrequently: true",
  ]) {
    if (!rendererSurfaceLifecycleOwner.includes(token)) {
      failures.push(`${FILES.rendererSurfaceLifecycleOwner} must own mechanical lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "from \"../state.js\"",
    "from \"./state.js\"",
    "map_renderer.js",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "applyDevSelectionFill",
    "refreshMapDataForScenarioChunkPromotion",
    "exactAfterSettle",
    "setMapData",
    "fitProjection",
    "initZoom",
    "bindEvents",
    "updateMap",
    "renderLegend",
    "renderExportPassesToCanvas",
  ]) {
    if (rendererSurfaceLifecycleOwner.includes(token)) {
      failures.push(`${FILES.rendererSurfaceLifecycleOwner} must not own renderer semantic token: ${token}`);
    }
  }

  for (const token of [
    "export function createRendererProjectionPathOwner({",
    "function initializeProjectionPaths()",
    "const getD3 = requireFunction(getters, \"getD3\", \"getters\");",
    "getContext: requireFunction(host, \"getContext\", \"surfaceHost\")",
    "getHitContext: requireFunction(host, \"getHitContext\", \"surfaceHost\")",
    "setProjection: requireFunction(host, \"setProjection\", \"surfaceHost\")",
    "setPathSvg: requireFunction(host, \"setPathSvg\", \"surfaceHost\")",
    "setPathCanvas: requireFunction(host, \"setPathCanvas\", \"surfaceHost\")",
    "setPathHitCanvas: requireFunction(host, \"setPathHitCanvas\", \"surfaceHost\")",
    "requireFunction(d3, \"geoEqualEarth\", \"d3\")",
    "requireFunction(d3, \"geoPath\", \"d3\")",
    "requireFunction(rawProjection, \"precision\", \"d3.geoEqualEarth()\")",
    "const nextProjection = hostApi.setProjection(projection);",
    "requireFunction(nextProjection, \"clipExtent\", \"surfaceHost.setProjection(projection)\")(null);",
    "const pathSvg = hostApi.setPathSvg(createPath({",
    "const pathCanvas = hostApi.setPathCanvas(createPath({",
    "const pathHitCanvas = hostApi.setPathHitCanvas(createPath({",
  ]) {
    if (!rendererProjectionPathOwner.includes(token)) {
      failures.push(`${FILES.rendererProjectionPathOwner} must own projection/path lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "from \"../state.js\"",
    "from \"./state.js\"",
    "map_renderer.js",
    "fitProjection",
    "fitExtent",
    "setCanvasSize",
    "buildSpatialIndex",
    "rebuildProjectedBoundsCache",
    "updateZoomTranslateExtent",
    "markAllOverlaysDirty",
    "updateMap",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "applyDevSelectionFill",
    "setMapData",
    "exactAfterSettle",
    "refreshMapDataForScenarioChunkPromotion",
    "strategicOverlayRuntime",
  ]) {
    if (rendererProjectionPathOwner.includes(token)) {
      failures.push(`${FILES.rendererProjectionPathOwner} must not own renderer semantic token: ${token}`);
    }
  }

  for (const token of [
    "export function createRendererSvgSurfaceLifecycleOwner({",
    "function ensureSvgSurface()",
    "const getD3 = requireFunction(getters, \"getD3\", \"getters\");",
    "getMapContainer: requireFunction(host, \"getMapContainer\", \"surfaceHost\")",
    "setMapSvg: requireFunction(host, \"setMapSvg\", \"surfaceHost\")",
    "setViewportGroup: requireFunction(host, \"setViewportGroup\", \"surfaceHost\")",
    "setStrategicDefs: requireFunction(host, \"setStrategicDefs\", \"surfaceHost\")",
    "setFrontlineOverlayGroup: requireFunction(host, \"setFrontlineOverlayGroup\", \"surfaceHost\")",
    "setFrontlineLabelsGroup: requireFunction(host, \"setFrontlineLabelsGroup\", \"surfaceHost\")",
    "setOperationalLinesGroup: requireFunction(host, \"setOperationalLinesGroup\", \"surfaceHost\")",
    "setOperationGraphicsGroup: requireFunction(host, \"setOperationGraphicsGroup\", \"surfaceHost\")",
    "setOperationGraphicsEditorGroup: requireFunction(host, \"setOperationGraphicsEditorGroup\", \"surfaceHost\")",
    "setUnitCountersGroup: requireFunction(host, \"setUnitCountersGroup\", \"surfaceHost\")",
    "setSpecialZonesGroup: requireFunction(host, \"setSpecialZonesGroup\", \"surfaceHost\")",
    "setSpecialZoneEditorGroup: requireFunction(host, \"setSpecialZoneEditorGroup\", \"surfaceHost\")",
    "setHoverGroup: requireFunction(host, \"setHoverGroup\", \"surfaceHost\")",
    "setDevSelectionGroup: requireFunction(host, \"setDevSelectionGroup\", \"surfaceHost\")",
    "setInspectorHighlightGroup: requireFunction(host, \"setInspectorHighlightGroup\", \"surfaceHost\")",
    "setIntensityFieldPreviewGroup: requireFunction(host, \"setIntensityFieldPreviewGroup\", \"surfaceHost\")",
    "setInteractionRect: requireFunction(host, \"setInteractionRect\", \"surfaceHost\")",
    "mapContainer.querySelector(\"#map-svg\")",
    "selectOrAppend(svg, \"g.viewport-layer\", \"g\", \"viewport-layer\")",
    "selectOrAppend(svg, \"defs.strategic-overlay-defs\", \"defs\", \"strategic-overlay-defs\")",
    "selectOrAppend(svg, \"g.intensity-field-preview-layer\", \"g\", \"intensity-field-preview-layer\")",
    "svg.select(\"rect.interaction-layer\")",
    ".attr(\"fill\", \"transparent\")",
    ".lower();",
  ]) {
    if (!rendererSvgSurfaceLifecycleOwner.includes(token)) {
      failures.push(`${FILES.rendererSvgSurfaceLifecycleOwner} must own SVG lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "from \"../state.js\"",
    "from \"./state.js\"",
    "map_renderer.js",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "applyDevSelectionFill",
    "refreshMapDataForScenarioChunkPromotion",
    "exactAfterSettle",
    "strategicOverlayRuntime",
    "renderFrontlineOverlay",
    "renderOperationalLinesIfNeeded",
    "renderOperationGraphicsIfNeeded",
    "renderUnitCountersIfNeeded",
    "renderSpecialZonesIfNeeded",
    "renderDevSelectionOverlayIfNeeded",
    "renderInspectorHighlightOverlayIfNeeded",
    "renderHoverOverlayIfNeeded",
    "geoEqualEarth",
    "geoPath",
    "fitProjection",
    "updateMap",
    "initZoom",
    "bindEvents",
    "renderLegend",
    "LegendManager",
  ]) {
    if (rendererSvgSurfaceLifecycleOwner.includes(token)) {
      failures.push(`${FILES.rendererSvgSurfaceLifecycleOwner} must not own renderer semantic token: ${token}`);
    }
  }

  if (!renderer.includes('from "./renderer/renderer_surface_host.js";')) {
    failures.push(`${FILES.renderer} must import ${FILES.rendererSurfaceHost}.`);
  }
  if (!renderer.includes('from "./renderer/renderer_surface_lifecycle_owner.js";')) {
    failures.push(`${FILES.renderer} must import ${FILES.rendererSurfaceLifecycleOwner}.`);
  }
  if (!renderer.includes('from "./renderer/renderer_projection_path_owner.js";')) {
    failures.push(`${FILES.renderer} must import ${FILES.rendererProjectionPathOwner}.`);
  }
  if (!renderer.includes('from "./renderer/renderer_svg_surface_lifecycle_owner.js";')) {
    failures.push(`${FILES.renderer} must import ${FILES.rendererSvgSurfaceLifecycleOwner}.`);
  }
  for (const sourcePath of listProjectSourceFiles("js")) {
    if (sourcePath === FILES.renderer) continue;
    const source = readProjectFile(sourcePath);
    if (source.includes("renderer_surface_host.js")) {
      failures.push(`${sourcePath} must not import renderer_surface_host.js directly; use ${FILES.renderer} as the composition root.`);
    }
    if (source.includes("renderer_surface_lifecycle_owner.js")) {
      failures.push(`${sourcePath} must not import renderer_surface_lifecycle_owner.js directly; use ${FILES.renderer} as the composition root.`);
    }
    if (source.includes("renderer_projection_path_owner.js")) {
      failures.push(`${sourcePath} must not import renderer_projection_path_owner.js directly; use ${FILES.renderer} as the composition root.`);
    }
    if (source.includes("renderer_svg_surface_lifecycle_owner.js")) {
      failures.push(`${sourcePath} must not import renderer_svg_surface_lifecycle_owner.js directly; use ${FILES.renderer} as the composition root.`);
    }
  }
  if (!renderer.includes("const rendererSurfaceHost = createRendererSurfaceHost();")) {
    failures.push(`${FILES.renderer} must instantiate rendererSurfaceHost once.`);
  }
  for (const token of [
    "let mapContainer = null;",
    "let canvasLayers = null;",
    "let context = null;",
    "let projection = null;",
    "let pathCanvas = null;",
    "let zoomBehavior = null;",
    "let viewportGroup = null;",
  ]) {
    if (renderer.includes(token)) {
      failures.push(`${FILES.renderer} must store surface handle ${token} in rendererSurfaceHost.`);
    }
  }
  for (const token of [
    "getContext: () => rendererSurfaceHost.getContext()",
    "getProjection: () => rendererSurfaceHost.getProjection()",
    "getPathCanvas: () => rendererSurfaceHost.getPathCanvas()",
    "getPathSvg: () => rendererSurfaceHost.getPathSvg()",
    "getZoomBehavior: () => rendererSurfaceHost.getZoomBehavior()",
    "getInteractionRect: () => rendererSurfaceHost.getInteractionRect()",
    "getMapContainer: () => rendererSurfaceHost.getMapContainer()",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep owner getter closure: ${token}`);
    }
  }

  for (const heading of [
    "## Current surface handle inventory",
    "## P24 candidate surface host API",
    "## P24 allowed first move",
  ]) {
    if (!rendererSurfaceHostPreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererSurfaceHostPreflightDoc} must keep heading: ${heading}`);
    }
  }



  for (const heading of [
    "## Scope and guardrails",
    "## Current P24 surface host state",
    "## Current initMap surface lifecycle map",
    "## DOM/root lifecycle inventory",
    "## Canvas lifecycle inventory",
    "## SVG/group lifecycle inventory",
    "## Context acquisition inventory",
    "## Projection/path lifecycle inventory",
    "## Zoom/event lifecycle inventory",
    "## RuntimeState bridge write inventory",
    "## P26 allowed first move",
    "## P26 forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererSurfaceLifecyclePreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererSurfaceLifecyclePreflightDoc} must keep heading: ${heading}`);
    }
  }
  for (const token of [
    "P26 candidate extraction is limited to DOM/canvas/SVG surface lifecycle wrapper; projection/path/zoom/event/render semantics are not yet moved.",
    "P26 may add `js/core/renderer/renderer_surface_lifecycle_owner.js`.",
    "Map container and tooltip lookup.",
    "2D context acquisition into `rendererSurfaceHost`.",
    "Projection/path creation.",
    "`fitProjection`.",
    "`initZoom`.",
    "`bindEvents`.",
    "Direct runtimeState writes.",
    "P26 must not add `js/core/renderer/renderer_render_lifecycle_owner.js`.",
  ]) {
    if (!rendererSurfaceLifecyclePreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererSurfaceLifecyclePreflightDoc} must lock P26 surface lifecycle boundary token: ${token}`);
    }
  }
  for (const token of [
    "const LIFECYCLE_OWNER_SEMANTIC_BLACKLIST = Object.freeze([",
    "const LIFECYCLE_OWNER_REQUIRED_TOKENS = Object.freeze([",
    "const P26_FORBIDDEN_REGION_TOKENS = Object.freeze([",
    "const RUNTIME_STATE_BRIDGE_HELPER_TOKENS = Object.freeze([",
    "const FORBIDDEN_RUNTIME_STATE_BRIDGE_WRITE_PARTS = Object.freeze([",
    "renderer_surface_lifecycle_owner.js",
    "renderer_projection_path_owner.js",
    "createRendererSurfaceLifecycleOwner({",
    "createRendererProjectionPathOwner({",
    "getRendererSurfaceLifecycleOwner().acquireCanvasContexts();",
    "getRendererProjectionPathOwner().initializeProjectionPaths();",
    "renderer_render_lifecycle_owner.js",
    "assertNoRendererOwnerImportsMapRenderer",
    "P33 must keep surface bridge state writes behind applyRendererSurfaceBridgeState",
    "P33 bridge call must stay between rebuildPoliticalLandCollections and migrateLegacyColorState",
  ]) {
    if (!rendererSurfaceLifecycleInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererSurfaceLifecycleInventoryTest} must lock P26 lifecycle inventory token: ${token}`);
    }
  }
  for (const token of [
    "export function applyRendererSurfaceBridgeState(target, handles = {})",
    "target.colorCanvas = source.mapCanvas ?? null;",
    "target.canvasLayers = source.canvasLayers ?? null;",
    "target.lineCanvas = null;",
    "target.colorCtx = source.context ?? null;",
    "target.politicalPatchCanvas = source.politicalPatchCanvas ?? null;",
    "target.politicalPatchCtx = source.politicalPatchContext ?? null;",
    "target.interactionOverlayCanvas = source.interactionOverlayCanvas ?? null;",
    "target.interactionOverlayCtx = source.interactionOverlayContext ?? null;",
    "target.lineCtx = null;",
    "return target;",
  ]) {
    if (!rendererRuntimeState.includes(token)) {
      failures.push(`${FILES.rendererRuntimeState} must own P33 surface bridge state token: ${token}`);
    }
  }
  if (rendererRuntimeState.includes("renderer_surface_host.js")) {
    failures.push(`${FILES.rendererRuntimeState} must not import ${FILES.rendererSurfaceHost}; pass plain handles from map_renderer.`);
  }
  for (const token of [
    "applyRendererSurfaceBridgeState,",
    "applyRendererSurfaceBridgeState(runtimeState, {",
    "mapCanvas: rendererSurfaceHost.getMapCanvas(),",
    "canvasLayers: rendererSurfaceHost.getCanvasLayers(),",
    "context: rendererSurfaceHost.getContext(),",
    "politicalPatchCanvas: rendererSurfaceHost.getPoliticalPatchCanvas(),",
    "politicalPatchContext: rendererSurfaceHost.getPoliticalPatchContext(),",
    "interactionOverlayCanvas: rendererSurfaceHost.getInteractionOverlayCanvas(),",
    "interactionOverlayContext: rendererSurfaceHost.getInteractionOverlayContext(),",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must route P33 surface bridge state through applyRendererSurfaceBridgeState token: ${token}`);
    }
  }
  for (const tokenParts of [
    ["runtimeState.", "colorCanvas = rendererSurfaceHost.getMapCanvas()"],
    ["runtimeState.", "canvasLayers = rendererSurfaceHost.getCanvasLayers()"],
    ["runtimeState.", "lineCanvas = null"],
    ["runtimeState.", "colorCtx = rendererSurfaceHost.getContext()"],
    ["runtimeState.", "politicalPatchCanvas = rendererSurfaceHost.getPoliticalPatchCanvas()"],
    ["runtimeState.", "politicalPatchCtx = rendererSurfaceHost.getPoliticalPatchContext()"],
    ["runtimeState.", "interactionOverlayCanvas = rendererSurfaceHost.getInteractionOverlayCanvas()"],
    ["runtimeState.", "interactionOverlayCtx = rendererSurfaceHost.getInteractionOverlayContext()"],
    ["runtimeState.", "lineCtx = null"],
  ]) {
    if (renderer.includes(tokenParts.join(""))) {
      failures.push(`${FILES.renderer} must not keep direct P33 surface bridge write: ${tokenParts.join("")}`);
    }
  }
  const startupOwnerRebuildIndex = rendererStartupTransactionOwner.indexOf("\"rebuildPoliticalLandCollections\"");
  const startupOwnerBridgeIndex = rendererStartupTransactionOwner.indexOf("\"applyRendererSurfaceBridgeState\"");
  const startupOwnerMigrateIndex = rendererStartupTransactionOwner.indexOf("\"migrateLegacyColorState\"");
  if (
    startupOwnerRebuildIndex < 0
    || startupOwnerBridgeIndex < 0
    || startupOwnerMigrateIndex < 0
    || !(startupOwnerRebuildIndex < startupOwnerBridgeIndex && startupOwnerBridgeIndex < startupOwnerMigrateIndex)
  ) {
    failures.push(`${FILES.rendererStartupTransactionOwner} must order applyRendererSurfaceBridgeState between rebuildPoliticalLandCollections and migrateLegacyColorState.`);
  }
  const startupOwnerFactorySource = sliceBetween(
    renderer,
    "function getRendererStartupTransactionOwner()",
    "function getStrategicOverlayHelpersOwner()",
  );
  if (!startupOwnerFactorySource.includes("applyRendererSurfaceBridgeState(runtimeState, {")) {
    failures.push(`${FILES.renderer} must inject applyRendererSurfaceBridgeState into the startup transaction owner.`);
  }
  for (const token of [
    "rendererStartupTransactionOwner = createRendererStartupTransactionOwner({",
    "resetLayerResolverCache: () => {",
    "layerResolverCache.primaryRef = null;",
    "runtimeState.topologyRevision = Number(runtimeState.topologyRevision || 0) + 1;",
    "runtimeState.hitCanvasTopologyRevision = 0;",
    "getRenderPassCacheState().perfOverlayEnabled = enabled;",
    "applyRendererSurfaceBridgeState(runtimeState, {",
    "normalizeColorStateForRender(state, {",
    "runtimeState.debugMode = nextDebugMode;",
    "resetRenderPhaseState: () => getRenderPhaseLifecycleOwner().resetRenderPhaseState(\"init-map\"),",
    "resetTooltipState: () => getMapHoverInteractionOwner().resetTooltipState(),",
    "runtimeState.deferContextBasePass = false;",
    "runtimeState.syncDayNightClockTimerFn = syncDayNightClockTimer;",
    "syncDayNightClockTimer();",
  ]) {
    if (!startupOwnerFactorySource.includes(token)) {
      failures.push(`${FILES.renderer} must wire P36 startup transaction owner factory token: ${token}`);
    }
  }
  if (!packageJson.includes('"test:node:renderer-surface-runtime-bridge-state": "node --test tests/renderer_surface_runtime_bridge_state_behavior.test.mjs"')) {
    failures.push(`${FILES.packageJson} must expose test:node:renderer-surface-runtime-bridge-state.`);
  }
  const rendererSourceFiles = listProjectSourceFiles("js/core/renderer");
  if (rendererSourceFiles.includes("js/core/renderer/renderer_render_lifecycle_owner.js")) {
    failures.push("P26 must not introduce js/core/renderer/renderer_render_lifecycle_owner.js.");
  }
  if (!rendererSourceFiles.includes(FILES.rendererProjectionPathOwner)) {
    failures.push(`P28 must introduce ${FILES.rendererProjectionPathOwner}.`);
  }
  for (const sourcePath of rendererSourceFiles.filter(isRendererOwnerPath)) {
    const source = readProjectFile(sourcePath);
    if (hasMapRendererImport(source)) {
      failures.push(`${sourcePath} must not import js/core/map_renderer.js; keep ${FILES.renderer} as the composition root.`);
    }
  }

  for (const heading of [
    "## Scope and guardrails",
    "## Current P26 surface lifecycle state",
    "## Current projection/path creation order",
    "## Projection/path handle inventory",
    "## Projection/path consumer inventory",
    "## fitProjection side-effect inventory",
    "## Projected bounds and viewport dependency map",
    "## P28 allowed first move",
    "## P28 forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererProjectionPathPreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererProjectionPathPreflightDoc} must keep heading: ${heading}`);
    }
  }
  for (const token of [
    "P28 may add `js/core/renderer/renderer_projection_path_owner.js`.",
    "P28 may move only projection/path handle creation and registration:",
    "Register `projection`, `pathSVG`, `pathCanvas`, and `pathHitCanvas` into `rendererSurfaceHost`.",
    "Preserve `initMap` ordering by calling the owner exactly where projection/path creation currently happens.",
    "P28 must not move `fitProjection`.",
    "P28 must not add `projection.fitExtent` to `js/core/renderer/renderer_projection_path_owner.js`.",
    "Direct runtimeState writes.",
    "`setCanvasSize`.",
    "`updateMap`.",
    "`drawCanvas`.",
    "`renderPassToCache`.",
    "Hit canvas build.",
    "Selection/fill.",
    "Scenario refresh/chunk.",
    "Exact-after-settle.",
    "Strategic overlay runtime.",
    "Render lifecycle owner work.",
  ]) {
    if (!rendererProjectionPathPreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererProjectionPathPreflightDoc} must lock P28 projection/path boundary token: ${token}`);
    }
  }
  for (const heading of [
    "## Scope and guardrails",
    "## Current implementation state",
    "## initMap ordering",
    "## Owner responsibilities",
    "## Forbidden areas",
    "## Validation commands",
    "## P29 handoff",
  ]) {
    if (!rendererProjectionPathOwnerDoc.includes(heading)) {
      failures.push(`${FILES.rendererProjectionPathOwnerDoc} must keep heading: ${heading}`);
    }
  }
  for (const token of [
    "P28 adds `js/core/renderer/renderer_projection_path_owner.js`.",
    "getRendererProjectionPathOwner().initializeProjectionPaths();",
    "`fitProjection` or `projection.fitExtent`.",
    "direct `runtimeState` writes.",
    "P29 should treat projection/path creation as owned by `renderer_projection_path_owner.js`",
  ]) {
    if (!rendererProjectionPathOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererProjectionPathOwnerDoc} must lock P28 owner handoff token: ${token}`);
    }
  }


  if (!rendererSourceFiles.includes(FILES.rendererSvgSurfaceLifecycleOwner)) {
    failures.push(`P30 must introduce ${FILES.rendererSvgSurfaceLifecycleOwner}.`);
  }
  for (const heading of [
    "## Scope and guardrails",
    "## Current surface/projection lifecycle baseline",
    "## ensureHybridLayers responsibility map",
    "## SVG root lifecycle inventory",
    "## SVG group ordering inventory",
    "## Interaction rect layering inventory",
    "## Legend and legacy SVG cleanup inventory",
    "## Strategic overlay group boundary",
    "## P30 allowed first move",
    "## P30 forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererSvgSurfaceLifecyclePreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererSvgSurfaceLifecyclePreflightDoc} must keep heading: ${heading}`);
    }
  }
  for (const token of [
    "P30 may add `js/core/renderer/renderer_svg_surface_lifecycle_owner.js`.",
    "P30 may move only SVG root and static group creation/registration.",
    "Preserve group ordering and interaction rect layering.",
    "Keep `js/core/map_renderer.js` as the composition root.",
    "Keep strategic overlay rendering and editor rendering outside the owner.",
    "`drawCanvas`.",
    "`renderPassToCache`.",
    "Hit canvas build.",
    "Selection/fill.",
    "Scenario refresh/chunk.",
    "Exact-after-settle.",
    "Strategic overlay runtime.",
    "Projection/path creation.",
    "`fitProjection`.",
    "`updateMap`.",
    "`initZoom` or `bindEvents`.",
    "Direct runtimeState writes.",
  ]) {
    if (!rendererSvgSurfaceLifecyclePreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererSvgSurfaceLifecyclePreflightDoc} must lock P30 SVG lifecycle boundary token: ${token}`);
    }
  }
  for (const token of [
    "const SVG_OWNER_REQUIRED_TOKENS = Object.freeze([",
    "const SVG_GROUP_ORDER_TOKENS = Object.freeze([",
    "const MAP_RENDERER_WRAPPER_TOKENS = Object.freeze([",
    "const ENSURE_HYBRID_LAYERS_FORBIDDEN_TOKENS = Object.freeze([",
    "const LEGEND_AND_LEGACY_TOKENS = Object.freeze([",
    "const SVG_LIFECYCLE_TOKENS = Object.freeze([",
    "const RENDER_SEMANTIC_ANCHORS = Object.freeze([",
    "const SVG_OWNER_FORBIDDEN_TOKENS = Object.freeze([",
    "const P30_ALLOWED_TOKENS = Object.freeze([",
    "const P30_FORBIDDEN_TOKENS = Object.freeze([",
    "function createSvgElement()",
    "createRendererSvgSurfaceLifecycleOwner({",
    "getRendererSvgSurfaceLifecycleOwner().ensureSvgSurface();",
    "assertExcludes(ensureHybridLayersSource, token, \"ensureHybridLayers must delegate raw SVG lifecycle work to the owner\");",
    "renderer_svg_surface_lifecycle_owner.js",
    "renderer_surface_lifecycle_owner.js",
    "renderer_projection_path_owner.js",
    "function renderFrontlineOverlay()",
    "renderOperationalLinesIfNeeded",
    "renderOperationGraphicsIfNeeded",
    "renderUnitCountersIfNeeded",
    "renderSpecialZonesIfNeeded",
    "renderDevSelectionOverlayIfNeeded",
    "renderInspectorHighlightOverlayIfNeeded",
    "renderHoverOverlayIfNeeded",
    "function drawCanvas()",
    "function renderPassToCache(",
    "buildHitCanvas",
    "P30 may add `js/core/renderer/renderer_svg_surface_lifecycle_owner.js`.",
    "P30 may move only SVG root and static group creation/registration.",
    "Strategic overlay runtime.",
    "Projection/path creation.",
    "Direct runtimeState writes.",
  ]) {
    if (!rendererSvgSurfaceLifecycleInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererSvgSurfaceLifecycleInventoryTest} must lock P30 SVG lifecycle inventory token: ${token}`);
    }
  }

  for (const heading of [
    "## Scope and guardrails",
    "## Current implementation state",
    "## ensureHybridLayers ordering",
    "## Owner responsibilities",
    "## Forbidden areas",
    "## Validation commands",
    "## P31 handoff",
  ]) {
    if (!rendererSvgSurfaceLifecycleOwnerDoc.includes(heading)) {
      failures.push(`${FILES.rendererSvgSurfaceLifecycleOwnerDoc} must keep heading: ${heading}`);
    }
  }
  for (const token of [
    "P30 adds `js/core/renderer/renderer_svg_surface_lifecycle_owner.js`.",
    "getRendererSvgSurfaceLifecycleOwner().ensureSvgSurface();",
    "`ensureHybridLayers()` remains the wrapper.",
    "`renderer_svg_surface_lifecycle_owner.js` owns SVG root/static group creation and registration.",
    "`drawCanvas`, `renderPassToCache`, hit canvas build, selection/fill, scenario refresh/chunk, exact-after-settle, strategic overlay runtime, projection/path creation, `fitProjection`, `updateMap`, `initZoom`, `bindEvents`, and direct `runtimeState` writes remain outside the owner.",
    "P31 can build on the SVG owner only after preserving group ordering and interaction rect layering.",
  ]) {
    if (!rendererSvgSurfaceLifecycleOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererSvgSurfaceLifecycleOwnerDoc} must lock P30 owner closeout token: ${token}`);
    }
  }
  for (const token of [
    "\"test:node:renderer-svg-surface-lifecycle-owner\": \"node --test tests/renderer_svg_surface_lifecycle_owner_behavior.test.mjs\"",
    "\"test:node:renderer-svg-surface-lifecycle-inventory\": \"node --test tests/renderer_svg_surface_lifecycle_inventory_boundary.test.mjs\"",
    "\"test:node:renderer-svg-surface-lifecycle\": \"node --test tests/renderer_svg_surface_lifecycle_owner_behavior.test.mjs tests/renderer_svg_surface_lifecycle_inventory_boundary.test.mjs\"",
    "\"test:node:strategic-overlay-runtime-owner\": \"node --test tests/strategic_overlay_runtime_owner_behavior.test.mjs\"",
  ]) {
    if (!packageJson.includes(token)) {
      failures.push(`${FILES.packageJson} must expose P30 validation script: ${token}`);
    }
  }

  if (!rendererSourceFiles.includes(FILES.rendererFitProjectionOwner)) {
    failures.push("P32 must add js/core/renderer/renderer_fit_projection_owner.js.");
  }
  if (!rendererSourceFiles.includes(FILES.rendererViewportUpdateOwner)) {
    failures.push(`P34 must add ${FILES.rendererViewportUpdateOwner}.`);
  }
  for (const heading of [
    "## Scope and guardrails",
    "## Current P30 surface/projection/svg lifecycle baseline",
    "## Current fitProjection call sites",
    "## fitProjection input inventory",
    "## fitProjection side-effect inventory",
    "## Projected bounds dependency map",
    "## Spatial index and hit-canvas dependency map",
    "## Special zone and overlay dependency map",
    "## Viewport command/resize dependency map",
    "## P32 allowed first move",
    "## P32 forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererFitProjectionLifecyclePreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererFitProjectionLifecyclePreflightDoc} must keep heading: ${heading}`);
    }
  }
  for (const token of [
    "P31 is preflight only.",
    "P32 may add `js/core/renderer/renderer_fit_projection_owner.js`.",
    "P32 may only move fitProjection orchestration through dependency-injected getters and effects.",
    "`js/core/map_renderer.js` remains the composition root.",
    "runtimeState.landData",
    "runtimeState.width",
    "runtimeState.height",
    "PROJECTION_FIT_PADDING_RATIO",
    "getLogicalCanvasDimensions()",
    "getRenderableLandFeatures(canvasWidth, canvasHeight, { forceProd: true })",
    "rendererSurfaceHost.getProjection()",
    "projection.fitExtent",
    "cityAnchorCache = new WeakMap();",
    "rebuildProjectedBoundsCache();",
    "buildSpatialIndex();",
    "runtimeState.hitCanvasDirty = true;",
    "updateSpecialZonesPaths();",
    "renderSpecialZoneEditorOverlay();",
    "updateZoomTranslateExtent();",
    "markAllOverlaysDirty();",
    "projected_geometry_bounds_owner.js` owns projected bounds calculations and cache rebuild helpers through injected getters and effects.",
    "viewport_read_model_owner.js` owns read-model calculations",
    "viewport_command_owner.js` owns zoom command effects",
    "viewport_resize_lifecycle_owner.js` currently calls fitProjection as an injected effect",
    "Render pass execution is not part of P32.",
    "Direct `runtimeState` writes.",
    "Import of `js/core/map_renderer.js`.",
    "`drawCanvas`.",
    "`renderPassToCache`.",
    "Hit canvas build.",
    "Selection/fill.",
    "Scenario refresh/chunk.",
    "Exact-after-settle.",
    "Strategic overlay runtime.",
    "Render lifecycle owner.",
    "`setMapData` migration.",
    "`initZoom` or `bindEvents` migration.",
    "Renderer public facade change.",
  ]) {
    if (!rendererFitProjectionLifecyclePreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererFitProjectionLifecyclePreflightDoc} must lock P31/P32 fitProjection lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "const FIT_PROJECTION_OWNER_TEST_PATH = \"tests/renderer_fit_projection_owner_behavior.test.mjs\";",
    "const MAP_RENDERER_WIRING_TOKENS = Object.freeze([",
    "const FIT_PROJECTION_STATE_WRITE_TOKEN_PARTS = Object.freeze([",
    "const FIT_PROJECTION_WRAPPER_TOKENS = Object.freeze([",
    "const OWNER_REQUIRED_TOKENS = Object.freeze([",
    "const OWNER_FORBIDDEN_TOKENS = Object.freeze([",
    "const MAP_RENDERER_RAW_BODY_TOKENS = Object.freeze([",
    "const RENDER_SEMANTIC_ANCHORS = Object.freeze([",
    "repoFileExists(FIT_PROJECTION_OWNER_PATH)",
    "function fitProjection({ skipSpatialIndex = false } = {})",
    "return getRendererFitProjectionOwner().fitProjection({ skipSpatialIndex });",
    "effects.fitProjection?.({ skipSpatialIndex: interactiveLayoutResize });",
    "renderer_projection_path_owner.js",
    "renderer_svg_surface_lifecycle_owner.js",
    "function drawCanvas()",
    "function renderPassToCache(",
    "async function buildHitCanvasAfterStartup",
    "createExactAfterSettleScheduler({",
    "createScenarioRefreshRuntime({",
    "createStrategicOverlayRuntimeOwner({",
    "Direct `runtimeState` writes.",
    "Renderer public facade change.",
  ]) {
    if (!rendererFitProjectionLifecycleInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererFitProjectionLifecycleInventoryTest} must lock P32 fitProjection inventory token: ${token}`);
    }
  }
  for (const token of [
    "import { createRendererFitProjectionOwner } from \"../js/core/renderer/renderer_fit_projection_owner.js\";",
    "no land data returns false without effects",
    "invalid width or height returns false without effects",
    "computes padding and fit extent exactly",
    "chooses renderable feature collection when non-empty",
    "falls back to state land data when renderable list is empty",
    "calls effects in exact order",
    "respects skipSpatialIndex",
    "fails fast when projection.fitExtent is missing",
    "fails fast when required injected dependencies are missing",
    "fails fast when projection fit padding ratio is not finite",
    "owner source stays independent from runtime state writes and render semantics",
  ]) {
    if (!rendererFitProjectionOwnerTest.includes(token)) {
      failures.push(`${FILES.rendererFitProjectionOwnerTest} must lock P32 behavior token: ${token}`);
    }
  }
  for (const token of [
    "export function createRendererFitProjectionOwner({",
    "function requireFiniteNumber(owner, name, ownerName)",
    "renderer fit projection owner requires ${ownerName}.${name}",
    "renderer fit projection owner requires finite ${ownerName}.${name}",
    "function fitProjection({ skipSpatialIndex = false } = {})",
    "state?.landData?.features",
    "projectionFitPaddingRatio",
    "const getLogicalCanvasDimensions = requireFunction(",
    "const getRenderableLandFeatures = requireFunction(",
    "const resetCityAnchorCache = requireFunction(effects, \"resetCityAnchorCache\", \"effects\");",
    "const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();",
    "getRenderableLandFeatures,",
    "const features = getRenderableLandFeatures(canvasWidth, canvasHeight, {",
    "fitExtent([[padding, padding], [x1, y1]], fitTarget);",
    "resetCityAnchorCache();",
    "rebuildProjectedBoundsCache();",
    "buildSpatialIndex();",
    "setHitCanvasDirty();",
    "updateSpecialZonesPaths();",
    "renderSpecialZoneEditorOverlay();",
    "updateZoomTranslateExtent();",
    "markAllOverlaysDirty();",
  ]) {
    if (!rendererFitProjectionOwner.includes(token)) {
      failures.push(`${FILES.rendererFitProjectionOwner} must own P32 fitProjection token: ${token}`);
    }
  }
  for (const token of [
    "map_renderer.js",
    "runtimeState",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "applyDevSelectionFill",
    "refreshMapDataForScenarioChunkPromotion",
    "exactAfterSettle",
    "strategicOverlayRuntime",
    "renderFrontlineOverlay",
    "renderSpecialZones",
    "renderHoverOverlay",
    "setMapData",
    "initZoom",
    "bindEvents",
    "requestRender",
    "flushRenderBoundary",
  ]) {
    if (rendererFitProjectionOwner.includes(token)) {
      failures.push(`${FILES.rendererFitProjectionOwner} must not include forbidden renderer semantic token: ${token}`);
    }
  }
  for (const token of [
    "from \"./renderer/renderer_fit_projection_owner.js\";",
    "let rendererFitProjectionOwner = null;",
    "function getRendererFitProjectionOwner()",
    "createRendererFitProjectionOwner({",
    "return getRendererFitProjectionOwner().fitProjection({ skipSpatialIndex });",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must wire P32 fitProjection owner token: ${token}`);
    }
  }
  if (!packageJson.includes("\"test:node:renderer-fit-projection-lifecycle-inventory\": \"node --test tests/renderer_fit_projection_lifecycle_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P31 fitProjection lifecycle inventory script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-fit-projection-owner\": \"node --test tests/renderer_fit_projection_owner_behavior.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P32 fitProjection owner behavior script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-fit-projection-lifecycle\": \"node --test tests/renderer_fit_projection_owner_behavior.test.mjs tests/renderer_fit_projection_lifecycle_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P32 fitProjection lifecycle script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-viewport-update-owner\": \"node --test tests/renderer_viewport_update_owner_behavior.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P34 renderer viewport update owner behavior script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-startup-transaction-owner\": \"node --test tests/renderer_startup_transaction_owner_behavior.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P36 startup transaction owner behavior script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-startup-transaction-inventory\": \"node --test tests/renderer_startup_transaction_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P35 startup transaction inventory script.`);
  }
  if (!rendererSourceFiles.includes("js/core/renderer/renderer_startup_transaction_owner.js")) {
    failures.push("P36 must add js/core/renderer/renderer_startup_transaction_owner.js.");
  }
  for (const heading of [
    "## Scope and guardrails",
    "## Current P34 renderer lifecycle baseline",
    "## initMap owned sequence after surface/projection setup",
    "## Cache and topology reset inventory",
    "## Render pass and visible-frame reset inventory",
    "## Runtime phase and deferred-flag reset inventory",
    "## Day-night and canvas pointer style inventory",
    "## Interaction infrastructure startup branch",
    "## P36 allowed first move",
    "## P36 forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererStartupTransactionPreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererStartupTransactionPreflightDoc} must keep heading: ${heading}`);
    }
  }
  for (const token of [
    "P35 is preflight only.",
    "P36 may add `js/core/renderer/renderer_startup_transaction_owner.js`.",
    "P36 may only move the `initMap` reset/startup transaction after projection/path creation through injected getters and effects.",
    "P36 must keep `initMap` as the composition root and must preserve the public wrapper in `js/core/map_renderer.js`.",
    "P36 must keep state writes as injected effects from `map_renderer.js` or existing state ops.",
    "P36 must preserve `applyRendererSurfaceBridgeState(runtimeState, { ... })` call location relative to `rebuildPoliticalLandCollections()` and `migrateLegacyColorState()`.",
    "render lifecycle owner",
    "`drawCanvas`",
    "`renderPassToCache`",
    "hit canvas build",
    "`setMapData` migration",
    "scenario refresh/chunk migration",
    "exact-after-settle scheduler migration",
    "strategic overlay runtime migration",
    "`initZoom` or `bindEvents` migration",
    "renderer public facade change",
    "direct `runtimeState` writes inside the new owner",
    "import of `js/core/map_renderer.js` from the new owner",
  ]) {
    if (!rendererStartupTransactionPreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererStartupTransactionPreflightDoc} must lock P35/P36 startup transaction token: ${token}`);
    }
  }
  for (const token of [
    "const STARTUP_OWNER_PATH = \"js/core/renderer/renderer_startup_transaction_owner.js\";",
    "const STARTUP_OWNER_TEST_PATH = \"tests/renderer_startup_transaction_owner_behavior.test.mjs\";",
    "const PREFLIGHT_DOC_PATH = \"docs/active/renderer-startup-transaction-preflight-20260629.md\";",
    "const OWNERIZED_INIT_MAP_TOKENS = Object.freeze([",
    "const RESET_TRANSACTION_TOKENS = Object.freeze([",
    "const OWNER_EFFECT_TOKENS = Object.freeze([",
    "const LATER_STARTUP_BRANCH_TOKENS = Object.freeze([",
    "const RENDER_SEMANTIC_ANCHORS = Object.freeze([",
    "const P36_ALLOWED_DOC_TOKENS = Object.freeze([",
    "const P36_FORBIDDEN_DOC_TOKENS = Object.freeze([",
    "repoFileExists(STARTUP_OWNER_PATH)",
    "repoFileExists(STARTUP_OWNER_TEST_PATH)",
    "getRendererProjectionPathOwner().initializeProjectionPaths();",
    "getRendererStartupTransactionOwner().runInitMapResetTransaction({ debugMode });",
    "fitProjection({ skipSpatialIndex: shouldDeferInteractionInfrastructure });",
    "initZoom();",
    "bindEvents();",
    "function render()",
    "function drawCanvas()",
    "function renderPassToCache(",
    "async function buildHitCanvasAfterStartup",
    "createScenarioRefreshRuntime({",
    "createExactAfterSettleScheduler({",
    "createStrategicOverlayRuntimeOwner({",
    "viewport owner must read viewport group through injected getter",
    "fitProjection owner must not own initMap transaction token",
    "startup transaction owner must expose initMap reset transaction method",
    "map_renderer must wire startup transaction owner effect",
  ]) {
    if (!rendererStartupTransactionInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererStartupTransactionInventoryTest} must lock P35 startup transaction inventory token: ${token}`);
    }
  }

  if (!fs.existsSync(path.join(REPO_ROOT, FILES.setMapDataTransactionOwner))) {
    failures.push("P38 must introduce js/core/map_renderer/set_map_data_transaction_owner.js.");
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererSetMapDataTransactionOwnerTest))) {
    failures.push("P38 must include setMapData transaction owner behavior coverage.");
  }
  if (fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecycleOwner))) {
    failures.push("P38 must not introduce js/core/renderer/renderer_render_lifecycle_owner.js.");
  }
  const setMapDataSource = sliceBetween(
    renderer,
    "function setMapData({",
    "function resetRendererRefreshTransactionState({",
  );
  if (!setMapDataSource) {
    failures.push(`${FILES.renderer} must keep function setMapData({ as the public wrapper.`);
  }
  const setMapDataOwnerFactorySource = sliceBetween(
    renderer,
    "function getSetMapDataTransactionOwner()",
    "function getStrategicOverlayHelpersOwner()",
  );
  if (!setMapDataOwnerFactorySource) {
    failures.push(`${FILES.renderer} must wire getSetMapDataTransactionOwner before strategic overlay owners.`);
  }
  for (const heading of [
    "## Scope and guardrails",
    "## Current P36 renderer lifecycle baseline",
    "## setMapData transaction overview",
    "## Pre-reset and render frame invalidation inventory",
    "## Political collection rebuild and coverage logging inventory",
    "## Color and scenario state sanitation inventory",
    "## Canvas, runtime meta, and interaction infrastructure branch",
    "## Projection, spatial index, special zone, and zoom branch",
    "## Staged warmup, render, and perf metrics branch",
    "## P38 allowed first move",
    "## P38 forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererSetMapDataTransactionPreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererSetMapDataTransactionPreflightDoc} must keep heading: ${heading}`);
    }
  }
  for (const token of [
    "P37 is preflight only.",
    "P37 must keep `js/core/map_renderer/set_map_data_transaction_owner.js` absent.",
    "P36 startup transaction owner: `js/core/renderer/renderer_startup_transaction_owner.js` owns the `initMap` reset transaction after projection/path initialization.",
    "P34 viewport update owner: `js/core/renderer/renderer_viewport_update_owner.js`",
    "P32 fitProjection owner: `js/core/renderer/renderer_fit_projection_owner.js` owns `fitProjection` through injected getters and effects.",
    "`js/core/map_renderer.js` remains the composition root and still contains `function setMapData({`.",
    "resetRendererTransactionState({",
    "clearPendingPoliticalColorEdit({",
    "clearRenderPassReferenceTransforms()",
    "clearLastGoodFrame(\"set-map-data\")",
    "invalidateInteractionComposite(\"set-map-data\")",
    "resetFirstVisibleFramePainted(\"set-map-data\")",
    "invalidateAllRenderPasses(\"set-map-data\")",
    "markAllOverlaysDirty()",
    "queueTooltipUpdate({ visible: false })",
    "rebuildPrimaryPoliticalCollections()",
    "Composite coverage",
    "Composite country coverage detail/primary",
    "sanitizeCountryColorMap",
    "sanitizeColorMap",
    "runtimeState.specialRegionOverrides = {}",
    "migrateLegacyColorState()",
    "setCanvasSize()",
    "buildRuntimePoliticalMeta()",
    "runtimeState.sovereigntyInitialized = false",
    "islandNeighborsCache = {",
    "ensureSphericalFeatureDiagnosticsCache().clear()",
    "shouldDeferInteractionInfrastructure",
    "buildIndex()",
    "ensureSovereigntyState()",
    "runtimeState.deferHitCanvasBuild = true",
    "setInteractionInfrastructureState(\"deferred-startup\"",
    "rebuildProjectedBoundsCache()",
    "rebuildStaticMeshes()",
    "invalidateBorderCache()",
    "updateDynamicBorderStatusUI()",
    "rebuildResolvedColors()",
    "fitProjection({ skipSpatialIndex: shouldDeferInteractionInfrastructure })",
    "buildSpatialIndex()",
    "updateSpecialZonesPaths()",
    "renderSpecialZoneEditorOverlay()",
    "updateZoomTranslateExtent()",
    "resetZoomToFit()",
    "enforceZoomConstraints()",
    "runtimeState.hitCanvasDirty = true",
    "beginStagedMapDataWarmup(startedAt)",
    "render()",
    "recordRenderPerfMetric(\"setMapDataFirstPaint\"",
    "recordRenderPerfMetric(\"setMapData\"",
    "function drawCanvas()",
    "function renderPassToCache(",
    "async function buildHitCanvasAfterStartup",
    "createScenarioRefreshRuntime({",
    "createExactAfterSettleScheduler({",
    "createStrategicOverlayRuntimeOwner({",
    "Add `js/core/map_renderer/set_map_data_transaction_owner.js`.",
    "Move setMapData orchestration into owner through injected getters/effects.",
    "Keep public setMapData wrapper in `js/core/map_renderer.js` stable.",
    "Keep scenario refresh runtime separate.",
    "Keep `render()`, `drawCanvas()`, `renderPassToCache()`, hit canvas build, exact-after-settle scheduler, strategic overlay runtime out of the owner.",
    "Keep direct state writes either in map_renderer injected effects or existing state ops.",
    "Do not add a new state-write allowlist entry unless explicitly justified.",
    "Preserve `recordRenderPerfMetric` semantics and ordering.",
    "No `renderer_render_lifecycle_owner.js`.",
    "No drawCanvas migration.",
    "No renderPassToCache migration.",
    "No hit canvas build migration.",
    "No scenario refresh runtime migration.",
    "No exact-after-settle scheduler migration.",
    "No strategic overlay runtime migration.",
    "No public facade changes.",
    "No owner importing `js/core/map_renderer.js`.",
    "No broad state-write allowlist expansion.",
  ]) {
    if (!rendererSetMapDataTransactionPreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererSetMapDataTransactionPreflightDoc} must lock P37/P38 setMapData transaction token: ${token}`);
    }
  }

  for (const token of [
    "export function createSetMapDataTransactionOwner({",
    "state = {},",
    "getters = {},",
    "effects = {},",
    "const REQUIRED_EFFECT_NAMES = Object.freeze([",
    "const REQUIRED_GETTER_NAMES = Object.freeze([",
    "function runSetMapDataTransaction(options = {})",
    "reason: SET_MAP_DATA_REASON",
    "options: normalizedOptions",
    "shouldDeferInteractionInfrastructure",
    "staged: false",
    "runEffect(\"resetRendererTransactionState\", {",
    "runEffect(\"clearPendingPoliticalColorEdit\", {",
    "runEffect(\"recordCompositeCoverageDiagnostics\", politicalCollections)",
    "runEffect(\"sanitizeSetMapDataColorState\")",
    "runEffect(\"setDeferHitCanvasBuild\", true)",
    "runEffect(\"fitProjection\", { skipSpatialIndex: summary.shouldDeferInteractionInfrastructure })",
    "runEffect(\"setHitCanvasDirty\", true)",
    "runEffect(\"beginStagedMapDataWarmup\", startedAt)",
    "runEffect(\"render\")",
    "runEffect(\"recordRenderPerfMetric\", \"setMapDataFirstPaint\"",
    "runEffect(\"recordRenderPerfMetric\", \"setMapData\"",
    "runEffect(\"setInteractionInfrastructureState\", \"ready\"",
    "return Object.freeze({",
  ]) {
    if (!setMapDataTransactionOwner.includes(token)) {
      failures.push(`${FILES.setMapDataTransactionOwner} must keep P38 owner token: ${token}`);
    }
  }
  for (const token of [
    "runEffect(\"resetRendererTransactionState\", {",
    "runEffect(\"clearPendingPoliticalColorEdit\", {",
    "runEffect(\"clearRenderPassReferenceTransforms\")",
    "runEffect(\"clearLastGoodFrame\", SET_MAP_DATA_REASON)",
    "runEffect(\"invalidateInteractionComposite\", SET_MAP_DATA_REASON)",
    "runEffect(\"resetFirstVisibleFramePainted\", SET_MAP_DATA_REASON)",
    "runEffect(\"invalidateAllRenderPasses\", SET_MAP_DATA_REASON)",
    "runEffect(\"markAllOverlaysDirty\")",
    "runEffect(\"queueTooltipUpdate\", { visible: false })",
    "runEffect(\"rebuildPrimaryPoliticalCollections\")",
    "runEffect(\"recordCompositeCoverageDiagnostics\", politicalCollections)",
    "runEffect(\"sanitizeSetMapDataColorState\")",
    "runEffect(\"migrateLegacyColorState\")",
    "runEffect(\"setCanvasSize\")",
    "runEffect(\"buildRuntimePoliticalMeta\")",
    "runEffect(\"resetSovereigntyInitialized\")",
    "runEffect(\"resetIslandNeighborsCache\")",
    "runEffect(\"clearSphericalFeatureDiagnosticsCache\")",
  ]) {
    if (!setMapDataTransactionOwner.includes(token)) {
      failures.push(`${FILES.setMapDataTransactionOwner} must preserve ordered transaction effect: ${token}`);
    }
  }
  for (const token of [
    "map_renderer.js",
    "runtimeState",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
    "renderer_render_lifecycle_owner",
  ]) {
    if (setMapDataTransactionOwner.includes(token)) {
      failures.push(`${FILES.setMapDataTransactionOwner} must avoid forbidden boundary token: ${token}`);
    }
  }
  if (hasMapRendererImport(setMapDataTransactionOwner)) {
    failures.push(`${FILES.setMapDataTransactionOwner} must not import map_renderer.js.`);
  }

  for (const token of [
    "function setMapData({",
    "refitProjection = true",
    "resetZoom = true",
    "suppressRender = false",
    "interactionLevel = \"full\"",
    "deferInteractionInfrastructure = false",
    "return getSetMapDataTransactionOwner().runSetMapDataTransaction({",
    "refitProjection,",
    "resetZoom,",
    "suppressRender,",
    "interactionLevel,",
    "deferInteractionInfrastructure,",
  ]) {
    if (!setMapDataSource.includes(token)) {
      failures.push(`${FILES.renderer} setMapData wrapper must keep token: ${token}`);
    }
  }
  for (const token of [
    "resetRendererTransactionState({",
    "clearPendingPoliticalColorEdit({",
    "rebuildPrimaryPoliticalCollections()",
    "recordRenderPerfMetric(\"setMapDataFirstPaint\"",
    "recordRenderPerfMetric(\"setMapData\"",
  ]) {
    if (setMapDataSource.includes(token)) {
      failures.push(`${FILES.renderer} setMapData wrapper must delegate transaction token to owner: ${token}`);
    }
  }

  for (const token of [
    "import { createSetMapDataTransactionOwner } from \"./map_renderer/set_map_data_transaction_owner.js\";",
    "let setMapDataTransactionOwner = null;",
    "function getSetMapDataTransactionOwner()",
    "setMapDataTransactionOwner = createSetMapDataTransactionOwner({",
    "getActiveScenarioId: () => runtimeState.activeScenarioId",
    "getLandFeatureCount: () => Array.isArray(runtimeState.landData?.features)",
    "getRenderProfile: () => runtimeState.renderProfile",
    "recordCompositeCoverageDiagnostics: ({",
    "Composite coverage",
    "Composite country coverage detail/primary",
    "sanitizeSetMapDataColorState: () => {",
    "resetSovereigntyInitialized: () => {",
    "resetIslandNeighborsCache: () => {",
    "clearSphericalFeatureDiagnosticsCache: () => {",
    "setDeferHitCanvasBuild: (deferred) => {",
    "setHitCanvasDirty: (dirty) => {",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must wire P38 setMapData owner token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState.countryBaseColors = sanitizeCountryColorMap",
    "runtimeState.featureOverrides = sanitizeColorMap",
    "runtimeState.waterRegionOverrides = sanitizeColorMap",
    "runtimeState.specialRegionOverrides = {};",
    "runtimeState.sovereigntyInitialized = false;",
    "islandNeighborsCache = {",
    "ensureProjectedBoundsCache();",
    "clearSphericalFeatureDiagnosticsCacheState(runtimeState);",
    "runtimeState.deferHitCanvasBuild = Boolean(deferred);",
    "setHitCanvasDirtyState(runtimeState, dirty);",
  ]) {
    if (!setMapDataOwnerFactorySource.includes(token)) {
      failures.push(`${FILES.renderer} P38 owner wiring must keep concrete state write/effect token: ${token}`);
    }
  }
  for (const token of [
    "function render()",
    "function drawCanvas()",
    "function renderPassToCache(",
    "async function buildHitCanvasAfterStartup",
    "createScenarioRefreshRuntime({",
    "createExactAfterSettleScheduler({",
    "createStrategicOverlayRuntimeOwner({",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep out-of-scope renderer anchor outside P38 owner: ${token}`);
    }
    if (setMapDataTransactionOwner.includes(token)) {
      failures.push(`${FILES.setMapDataTransactionOwner} must not absorb out-of-scope renderer anchor: ${token}`);
    }
  }

  for (const token of [
    "const SET_MAP_DATA_TRANSACTION_OWNER_PATH = \"js/core/map_renderer/set_map_data_transaction_owner.js\";",
    "const SET_MAP_DATA_TRANSACTION_OWNER_TEST_PATH = \"tests/renderer_set_map_data_transaction_owner_behavior.test.mjs\";",
    "const RENDER_LIFECYCLE_OWNER_PATH = \"js/core/renderer/renderer_render_lifecycle_owner.js\";",
    "const PREFLIGHT_DOC_PATH = \"docs/active/renderer-set-map-data-transaction-preflight-20260630.md\";",
    "const SET_MAP_DATA_SIGNATURE_TOKENS = Object.freeze([",
    "const SET_MAP_DATA_WRAPPER_TOKENS = Object.freeze([",
    "const SET_MAP_DATA_OWNER_ORDER_TOKENS = Object.freeze(`",
    "const MAP_RENDERER_WIRING_TOKENS = Object.freeze([",
    "const MAP_RENDERER_STATE_WRITE_TOKEN_PARTS = Object.freeze([",
    "const OWNER_FORBIDDEN_TOKEN_PARTS = Object.freeze([",
    "[RUNTIME_STATE_TOKEN, \".specialRegionOverrides = {};\"],",
    "[RUNTIME_STATE_TOKEN, \".sovereigntyInitialized = false;\"],",
    "[RUNTIME_STATE_TOKEN, \".deferHitCanvasBuild = Boolean(deferred);\"],",
    "[\"setHitCanvasDirtyState(runtimeState, dirty);\"],",
    "const P38_OUT_OF_SCOPE_ANCHORS = Object.freeze([",
    "const P38_ALLOWED_DOC_TOKENS = Object.freeze([",
    "const P38_FORBIDDEN_DOC_TOKENS = Object.freeze([",
    "repoFileExists(SET_MAP_DATA_TRANSACTION_OWNER_PATH)",
    "repoFileExists(SET_MAP_DATA_TRANSACTION_OWNER_TEST_PATH)",
    "repoFileExists(RENDER_LIFECYCLE_OWNER_PATH)",
    "function getSetMapDataSource(rendererSource)",
    "function setMapData({",
    "return getSetMapDataTransactionOwner().runSetMapDataTransaction({",
    "runEffect(\"resetRendererTransactionState\", {",
    "runEffect(\"clearPendingPoliticalColorEdit\", {",
    "runEffect(\"recordCompositeCoverageDiagnostics\", politicalCollections)",
    "sanitizeSetMapDataColorState: () => {",
    "Composite coverage",
    "Composite country coverage detail/primary",
    "islandNeighborsCache = {",
    "clearSphericalFeatureDiagnosticsCacheState(runtimeState);",
    "shouldDeferInteractionInfrastructure",
    "runEffect(\"recordRenderPerfMetric\", \"setMapDataFirstPaint\"",
    "runEffect(\"recordRenderPerfMetric\", \"setMapData\"",
    "function render()",
    "function drawCanvas()",
    "function renderPassToCache(",
    "async function buildHitCanvasAfterStartup",
    "createScenarioRefreshRuntime({",
    "createExactAfterSettleScheduler({",
    "createStrategicOverlayRuntimeOwner({",
    "startup transaction owner must avoid setMapData scope",
    "viewport owner must read viewport group through injected getter",
    "fitProjection owner must avoid setMapData transaction scope",
    "public facade must keep setMapData export",
  ]) {
    if (!rendererSetMapDataTransactionInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererSetMapDataTransactionInventoryTest} must lock P38 setMapData inventory token: ${token}`);
    }
  }
  for (const token of [
    "const EFFECT_NAMES = Object.freeze([",
    "const GETTER_NAMES = Object.freeze([",
    "createSetMapDataTransactionOwner",
    "default transaction runs exact effects and payloads",
    "refitProjection=false rebuilds projected bounds",
    "resetZoom=false marks hit canvas dirty",
    "suppressRender=true skips staged warmup render",
    "readonly startup and explicit defer use deferred interaction infrastructure",
    "owner fails fast when required effects or getters are missing",
    "owner source stays inside the setMapData transaction boundary",
  ]) {
    if (!rendererSetMapDataTransactionOwnerTest.includes(token)) {
      failures.push(`${FILES.rendererSetMapDataTransactionOwnerTest} must cover P38 owner behavior token: ${token}`);
    }
  }
  if (!packageJson.includes("\"test:node:renderer-set-map-data-transaction-owner\": \"node --test tests/renderer_set_map_data_transaction_owner_behavior.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P38 setMapData transaction owner script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-set-map-data-transaction-inventory\": \"node --test tests/renderer_set_map_data_transaction_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P38 setMapData transaction inventory script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-set-map-data-transaction\": \"npm run test:node:renderer-set-map-data-transaction-owner && npm run test:node:renderer-set-map-data-transaction-inventory\"")) {
    failures.push(`${FILES.packageJson} must expose P38 setMapData transaction combined script.`);
  }

  for (const heading of [
    "## Scope and guardrails",
    "## Current P38 transaction owner baseline",
    "## initMap startup reset inventory",
    "## setMapData transaction reset inventory",
    "## resetRendererTransactionState inventory",
    "## resetRendererRefreshTransactionState inventory",
    "## markRendererTopologyChanged inventory",
    "## Scenario refresh reset consumers",
    "## Exact-after-settle reset boundary",
    "## State-write and composition-root boundary",
    "## P40/P41 allowed follow-up",
    "## Forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererTransactionResetHardeningPreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererTransactionResetHardeningPreflightDoc} must keep P39 heading: ${heading}`);
    }
  }
  for (const token of [
    "P39 is preflight/hardening only.",
    "No production runtime behavior changes.",
    "`resetRendererTransactionState` remains in `js/core/map_renderer.js` for P39.",
    "`resetRendererRefreshTransactionState` remains in `js/core/map_renderer.js` for P39.",
    "`markRendererTopologyChanged` remains in `js/core/map_renderer.js` for P39.",
    "The setMapData owner calls `resetRendererTransactionState` as an injected effect.",
    "The startup transaction owner does not call the setMapData owner and does not own setMapData reset.",
    "Scenario refresh runtime remains separate and only receives `resetRendererTransactionState` as an injected dependency.",
    "Exact-after-settle scheduler remains separate.",
    "No new state-write allowlist entry.",
    "No production reset owner/helper.",
    "No renamed renderer transaction reset owner/helper/controller under `js/core/**`.",
    "No `renderer_render_lifecycle_owner.js`.",
    "No drawCanvas migration.",
    "No renderPassToCache migration.",
    "No hit canvas migration.",
    "No scenario refresh migration.",
    "No exact scheduler migration.",
    "No strategic runtime migration.",
  ]) {
    if (!rendererTransactionResetHardeningPreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererTransactionResetHardeningPreflightDoc} must lock P39 boundary token: ${token}`);
    }
  }

  for (const token of [
    "const P39_DOC_PATH = \"docs/active/renderer-transaction-reset-hardening-preflight-20260630.md\";",
    "const P49_DOC_PATH = \"docs/active/renderer-transaction-reset-owner-p49-20260701.md\";",
    "const RESET_OWNER_PATH = \"js/core/map_renderer/renderer_transaction_reset_owner.js\";",
    "const FORBIDDEN_RESET_HELPER_PATHS = Object.freeze([",
    "const P39_DOC_HEADINGS = Object.freeze([",
    "const RESET_TRANSACTION_STATE_TOKENS = Object.freeze([",
    "const RESET_RENDERER_REFRESH_STATE_TOKENS = Object.freeze([",
    "const MARK_RENDERER_TOPOLOGY_CHANGED_TOKENS = Object.freeze([",
    "const SET_MAP_DATA_OWNER_RESET_TOKENS = Object.freeze([",
    "const STARTUP_OWNER_RESET_TOKENS = Object.freeze([",
    "repoFileExists(RENDER_LIFECYCLE_OWNER_PATH)",
    "function listRepoSourceFiles(rootRelativePath)",
    "function isForbiddenResetHelperPath(sourcePath)",
    "stem.includes(\"reset\")",
    "stem.includes(\"transaction\")",
    "/(?:^|_)(?:owner|helper|controller)(?:_|$)/.test(stem)",
    "function resetRendererTransactionState({",
    "cancelSecondarySpatialBuild = false",
    "cancelHoverOverlayRender = false",
    "hitCanvasDirty = false",
    "getRendererTransactionResetOwner().resetRendererTransactionState({",
    "\"clearPendingDynamicBorderTimer\"",
    "\"clearRenderPhaseTimer\"",
    "\"cancelPendingIndexUiRefresh\"",
    "\"cancelPendingSidebarRefresh\"",
    "\"cancelScheduledHoverOverlayRender\"",
    "\"setRenderPhaseIdle\"",
    "\"resetRenderDiagnostics\"",
    "\"clearStagedMapDataTasks\"",
    "\"cancelExactAfterSettleRefresh\"",
    "\"cancelScheduledHitCanvasBuild\"",
    "\"cancelSecondarySpatialBuild\"",
    "\"resetPhysicalLandClipPathCache\"",
    "function markRendererTopologyChanged({ hitCanvasDirty = false } = {})",
    "getRendererTransactionResetOwner().markRendererTopologyChanged({ hitCanvasDirty })",
    "\"resetExactRefreshOptimizationState\"",
    "\"resetVisibleInternalBorderMeshSignature\"",
    "runEffect(\\\"resetRendererTransactionState\\\", {",
    "cancelHoverOverlayRender: true",
    "cancelSecondarySpatialBuild: true",
    "runEffect(\\\"clearPendingPoliticalColorEdit\\\", {",
    "runEffect(\\\"clearLastGoodFrame\\\", SET_MAP_DATA_REASON)",
    "runEffect(\\\"invalidateInteractionComposite\\\", SET_MAP_DATA_REASON)",
    "runEffect(\\\"resetFirstVisibleFramePainted\\\", SET_MAP_DATA_REASON)",
    "runEffect(\\\"invalidateAllRenderPasses\\\", SET_MAP_DATA_REASON)",
    "runInitMapResetTransaction",
    "scenario refresh runtime must keep injected resetRendererTransactionState dependency",
    "exact-after-settle scheduler must keep reset boundary separate",
    "package.json must expose the P49 reset owner test",
    "package.json must expose the P39 reset hardening inventory test",
  ]) {
    if (!rendererTransactionResetHardeningInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererTransactionResetHardeningInventoryTest} must lock P39 inventory token: ${token}`);
    }
  }

  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererTransactionResetHardeningPreflightDoc))) {
    failures.push(`${FILES.rendererTransactionResetHardeningPreflightDoc} must exist for P39.`);
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererTransactionResetHardeningInventoryTest))) {
    failures.push(`${FILES.rendererTransactionResetHardeningInventoryTest} must exist for P39.`);
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererTransactionResetOwner))) {
    failures.push(`${FILES.rendererTransactionResetOwner} must exist for P49.`);
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererTransactionResetOwnerDoc))) {
    failures.push(`${FILES.rendererTransactionResetOwnerDoc} must exist for P49.`);
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererTransactionResetOwnerTest))) {
    failures.push(`${FILES.rendererTransactionResetOwnerTest} must exist for P49.`);
  }
  if (!packageJson.includes("\"test:node:renderer-transaction-reset-hardening-inventory\": \"node --test tests/renderer_transaction_reset_hardening_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P39 reset hardening inventory script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-transaction-reset-owner\": \"node --test tests/renderer_transaction_reset_owner_behavior.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P49 reset owner script.`);
  }
  if (!packageJson.includes("\"test:node:renderer-transaction-reset\": \"npm run test:node:renderer-transaction-reset-owner && npm run test:node:renderer-transaction-reset-hardening-inventory\"")) {
    failures.push(`${FILES.packageJson} must expose P49 combined reset script.`);
  }
  for (const relativePath of FORBIDDEN_TRANSACTION_RESET_HELPER_PATHS) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`P49 must keep extra reset helper absent: ${relativePath}`);
    }
  }
  for (const sourcePath of listProjectSourceFiles("js/core")) {
    if (isForbiddenTransactionResetHelperPath(sourcePath)) {
      failures.push(`P49 must keep extra reset helper absent: ${sourcePath}`);
    }
  }
  for (const fixturePath of [
    "js/core/renderer/renderer_transaction_reset_controller.js",
    "js/core/renderer/reset_renderer_transaction_helper.js",
    "js/core/renderer/reset_transaction_owner.js",
    "js/core/map_renderer/transaction_reset_helper.mjs",
  ]) {
    if (!isForbiddenTransactionResetHelperPath(fixturePath)) {
      failures.push(`${FILES.packageJson} P39 reset helper detector must catch renamed helper path: ${fixturePath}`);
    }
  }
  for (const fixturePath of [
    "js/core/map_renderer/set_map_data_transaction_owner.js",
    FILES.rendererTransactionResetOwner,
    "js/core/renderer/renderer_startup_transaction_owner.js",
  ]) {
    if (isForbiddenTransactionResetHelperPath(fixturePath)) {
      failures.push(`${FILES.packageJson} P39 reset helper detector must allow existing owner path: ${fixturePath}`);
    }
  }
  if (fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecycleOwner))) {
    failures.push("P39 must keep js/core/renderer/renderer_render_lifecycle_owner.js absent.");
  }
  for (const importFixture of [
    "import { thing } from \"./map_renderer.js\";",
    "import \"./map_renderer.js\";",
    "await import(\"./map_renderer.js\");",
  ]) {
    if (!hasMapRendererImport(importFixture)) {
      failures.push(`${FILES.packageJson} map_renderer import detector must catch import form: ${importFixture}`);
    }
  }

  for (const token of [
    "function resetRendererTransactionState({",
    "cancelSecondarySpatialBuild = false",
    "cancelHoverOverlayRender = false",
    "hitCanvasDirty = false",
    "function resetRendererRefreshTransactionState({",
    "getRendererTransactionResetOwner().resetRendererTransactionState({",
    "getRendererTransactionResetOwner().resetRendererRefreshTransactionState({",
    "getRendererTransactionResetOwner().markRendererTopologyChanged({ hitCanvasDirty })",
    "function getRendererTransactionResetOwner()",
    "createRendererTransactionResetOwner({",
    "setRenderPhaseIdle: () => setRenderPhase(RENDER_PHASE_IDLE)",
    "cancelScheduledHitCanvasBuild: (options) => (",
    "getHitCanvasSchedulingOwner().cancelScheduledHitCanvasBuild(options)",
    "cancelDeferredWork(secondarySpatialBuildHandle)",
    "pendingSecondarySpatialBuildReasons.clear()",
    "runtimeState.deferContextBasePass = false",
    "runtimeState.deferHitCanvasBuild = false",
    "setDeferExactAfterSettleState(runtimeState, false)",
    "layerResolverCache.primaryRef = null",
    "layerResolverCache.detailRef = null",
    "layerResolverCache.bundleMode = null",
    "layerResolverCache.contextRevision = 0",
    "runtimeState.devHoverHit = null",
    "runtimeState.devSelectedHit = null",
    "runtimeState.devSelectionFeatureIds = new Set()",
    "runtimeState.devSelectionOrder = []",
    "runtimeState.devClipboardFallbackText = \"\"",
    "runtimeState.devClipboardPreviewFormat = \"names_with_ids\"",
    "function markRendererTopologyChanged({ hitCanvasDirty = false } = {})",
    "runtimeState.topologyRevision = Number(runtimeState.topologyRevision || 0) + 1",
    "runtimeState.hitCanvasDirty = true",
    "runtimeState.hitCanvasTopologyRevision = 0",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P39 reset/topology token: ${token}`);
    }
  }
  for (const token of [
    "export function createRendererTransactionResetOwner",
    "\"clearPendingDynamicBorderTimer\"",
    "\"clearRenderPhaseTimer\"",
    "\"cancelPendingIndexUiRefresh\"",
    "\"cancelPendingSidebarRefresh\"",
    "\"cancelScheduledHoverOverlayRender\"",
    "\"setRenderPhaseIdle\"",
    "\"resetRenderDiagnostics\"",
    "\"clearStagedMapDataTasks\"",
    "\"cancelExactAfterSettleRefresh\"",
    "\"cancelScheduledHitCanvasBuild\"",
    "reason: REFRESH_RESET_REASON",
    "\"cancelSecondarySpatialBuild\"",
    "\"setDeferContextBasePass\"",
    "\"setDeferHitCanvasBuild\"",
    "\"setDeferExactAfterSettle\"",
    "\"resetLayerResolverCache\"",
    "\"resetDevInteractionState\"",
    "\"resetDevClipboardState\"",
    "\"resetPhysicalLandClipPathCache\"",
    "\"resetExactRefreshOptimizationState\"",
    "\"resetVisibleInternalBorderMeshSignature\"",
    "\"bumpTopologyRevision\"",
    "\"setHitCanvasDirty\"",
    "\"resetHitCanvasTopologyRevision\"",
    "resetRendererRefreshTransactionState({",
    "markRendererTopologyChanged({",
  ]) {
    if (!rendererTransactionResetOwner.includes(token)) {
      failures.push(`${FILES.rendererTransactionResetOwner} must keep P49 reset owner token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "scheduleHitCanvasBuildIfNeeded",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
    "map_renderer.js",
  ]) {
    if (rendererTransactionResetOwner.includes(token)) {
      failures.push(`${FILES.rendererTransactionResetOwner} must avoid forbidden token: ${token}`);
    }
  }
  for (const token of [
    "runEffect(\"resetRendererTransactionState\", {",
    "cancelHoverOverlayRender: true",
    "cancelSecondarySpatialBuild: true",
    "runEffect(\"clearPendingPoliticalColorEdit\", {",
    "runEffect(\"clearLastGoodFrame\", SET_MAP_DATA_REASON)",
    "runEffect(\"invalidateInteractionComposite\", SET_MAP_DATA_REASON)",
    "runEffect(\"resetFirstVisibleFramePainted\", SET_MAP_DATA_REASON)",
    "runEffect(\"invalidateAllRenderPasses\", SET_MAP_DATA_REASON)",
  ]) {
    if (!setMapDataTransactionOwner.includes(token)) {
      failures.push(`${FILES.setMapDataTransactionOwner} must keep P39 setMapData reset token: ${token}`);
    }
  }
  for (const token of [
    "map_renderer.js",
    "runtimeState",
    "renderer_transaction_reset_owner",
    "renderer_transaction_reset_helper",
    "shared_renderer_transaction_reset_owner",
    "shared_renderer_transaction_reset_helper",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
  ]) {
    if (setMapDataTransactionOwner.includes(token)) {
      failures.push(`${FILES.setMapDataTransactionOwner} must keep P39 forbidden boundary token absent: ${token}`);
    }
  }
  if (hasMapRendererImport(setMapDataTransactionOwner)) {
    failures.push(`${FILES.setMapDataTransactionOwner} must keep composition-root import boundary.`);
  }
  for (const token of [
    "runInitMapResetTransaction",
    "resetLayerResolverCache",
    "resetPhysicalLandClipPathCache",
    "resetExactRefreshOptimizationState",
    "bumpTopologyRevision",
    "resetHitCanvasTopologyRevision",
    "clearPendingPoliticalColorEdit",
    "cancelExactAfterSettleRefresh",
    "invalidateAllRenderPasses",
  ]) {
    if (!rendererStartupTransactionOwner.includes(token)) {
      failures.push(`${FILES.rendererStartupTransactionOwner} must keep P39 startup reset token: ${token}`);
    }
  }
  for (const token of [
    "setMapData",
    "set_map_data_transaction_owner",
  ]) {
    if (rendererStartupTransactionOwner.includes(token)) {
      failures.push(`${FILES.rendererStartupTransactionOwner} must keep P39 setMapData scope token absent: ${token}`);
    }
  }
  if (!scenarioRefreshRuntime.includes("resetRendererTransactionState")) {
    failures.push(`${FILES.scenarioRefreshRuntime} must keep injected resetRendererTransactionState dependency.`);
  }
  if (!scenarioRefreshRuntime.includes("resetRendererTransactionState({ hitCanvasDirty: true })")) {
    failures.push(`${FILES.scenarioRefreshRuntime} must keep scenario apply reset call.`);
  }
  if (scenarioRefreshRuntime.includes("set_map_data_transaction_owner")) {
    failures.push(`${FILES.scenarioRefreshRuntime} must keep setMapData owner import absent.`);
  }
  for (const token of [
    "set_map_data_transaction_owner",
    "renderer_transaction_reset_owner",
    "renderer_transaction_reset_helper",
    "shared_renderer_transaction_reset_owner",
    "shared_renderer_transaction_reset_helper",
  ]) {
    if (exactAfterSettleScheduler.includes(token)) {
      failures.push(`${FILES.exactAfterSettleScheduler} must keep P39 reset helper import absent: ${token}`);
    }
  }

  for (const heading of [
    "## Scope and guardrails",
    "## Current P38/P39 renderer transaction baseline",
    "## Current render facade and scheduler entry inventory",
    "## Current drawCanvas lifecycle inventory",
    "## Current renderPassToCache lifecycle inventory",
    "## Current hit canvas build inventory",
    "## Current render cache and pass catalog boundary",
    "## Current exact-after-settle render boundary",
    "## Current scenario refresh render boundary",
    "## Current strategic overlay render boundary",
    "## Current public facade and export boundary",
    "## P41 allowed first move candidates",
    "## P41 forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererRenderLifecyclePreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererRenderLifecyclePreflightDoc} must keep P40 heading: ${heading}`);
    }
  }
  for (const token of [
    "P40 is preflight only.",
    "No production runtime behavior changes.",
    "P40 does not add `renderer_render_lifecycle_owner.js`.",
    "No state-write allowlist changes.",
    "P40 does not migrate `render()`, `drawCanvas()`, `renderPassToCache()`, hit canvas build",
    "P40 does not migrate scenario refresh runtime behavior.",
    "P40 does not migrate exact-after-settle scheduler behavior.",
    "P40 does not migrate strategic overlay runtime or render behavior.",
    "P40 makes no public facade changes.",
    "`render_cache_owner.js` owns render cache invalidation authority.",
    "`render_pipeline_passes.js` and `render_pipeline_catalog.js` own pass definitions/catalog.",
    "`render_invalidation_catalog.js` owns invalidation vocabulary.",
    "`render_transform_reuse_policy_owner.js` owns transform reuse policy.",
    "`exact_after_settle_scheduler.js` owns exact-after-settle scheduling.",
    "`scenario_refresh_runtime.js` owns scenario refresh/chunk visual/infra flow.",
    "`set_map_data_transaction_owner.js` owns only setMapData transaction order.",
    "`renderer_startup_transaction_owner.js` owns only initMap startup reset order.",
    "P41 may choose one small first move after P40 review.",
    "P41 must not begin with `drawCanvas` or `renderPassToCache` migration.",
  ]) {
    if (!rendererRenderLifecyclePreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererRenderLifecyclePreflightDoc} must lock P40 boundary token: ${token}`);
    }
  }
  for (const token of [
    "const P40_DOC_PATH = \"docs/active/renderer-render-lifecycle-preflight-20260630.md\";",
    "function isForbiddenRenderLifecycleOwnerPath(sourcePath)",
    "parts.includes(\"render\")",
    "parts.includes(\"lifecycle\")",
    "renderer_render_lifecycle_owner.js",
    "function render()",
    "function drawCanvas()",
    "function renderPassToCache(",
    "async function buildHitCanvasAfterStartup",
    "createExactAfterSettleScheduler({",
    "createScenarioRefreshRuntime({",
    "createStrategicOverlayRuntimeOwner({",
    "export { RENDER_PASS_NAMES } from \\\"./map_renderer/render_pass_catalog.js\\\";",
    "from \\\"../map_renderer.js\\\";",
    "render cache owner must not import map_renderer",
    "render pipeline passes owner must not import map_renderer",
    "transform reuse policy owner must avoid render lifecycle host token",
    "package.json must expose the P40 render lifecycle inventory test",
  ]) {
    if (!rendererRenderLifecycleInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererRenderLifecycleInventoryTest} must lock P40 inventory token: ${token}`);
    }
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecyclePreflightDoc))) {
    failures.push(`${FILES.rendererRenderLifecyclePreflightDoc} must exist for P40.`);
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecycleInventoryTest))) {
    failures.push(`${FILES.rendererRenderLifecycleInventoryTest} must exist for P40.`);
  }
  if (!packageJson.includes("\"test:node:renderer-render-lifecycle-inventory\": \"node --test tests/renderer_render_lifecycle_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P40 render lifecycle inventory script.`);
  }
  if (fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecycleOwner))) {
    failures.push("P40 must keep js/core/renderer/renderer_render_lifecycle_owner.js absent.");
  }
  for (const sourcePath of listProjectSourceFiles("js/core")) {
    if (isForbiddenRenderLifecycleOwnerPath(sourcePath)) {
      failures.push(`P40 must keep production render lifecycle owner/helper absent: ${sourcePath}`);
    }
  }
  for (const fixturePath of [
    "js/core/renderer/renderer_render_lifecycle_owner.js",
    "js/core/renderer/render_lifecycle_helper.js",
    "js/core/map_renderer/render_lifecycle_owner.mjs",
    "js/core/map_renderer/shared_render_lifecycle_controller.js",
  ]) {
    if (!isForbiddenRenderLifecycleOwnerPath(fixturePath)) {
      failures.push(`${FILES.packageJson} P40 render lifecycle detector must catch renamed owner path: ${fixturePath}`);
    }
  }
  for (const fixturePath of [
    "js/core/renderer/renderer_surface_lifecycle_owner.js",
    "js/core/renderer/renderer_svg_surface_lifecycle_owner.js",
    "js/core/renderer/renderer_startup_transaction_owner.js",
    "js/core/renderer/render_cache_owner.js",
  ]) {
    if (isForbiddenRenderLifecycleOwnerPath(fixturePath)) {
      failures.push(`${FILES.packageJson} P40 render lifecycle detector must allow existing owner path: ${fixturePath}`);
    }
  }
  for (const token of [
    "function render()",
    "function drawCanvas()",
    "function renderPassToCache(",
    "async function buildHitCanvasAfterStartup",
    "createExactAfterSettleScheduler({",
    "createScenarioRefreshRuntime({",
    "createStrategicOverlayRuntimeOwner({",
    "export { RENDER_PASS_NAMES } from \"./map_renderer/render_pass_catalog.js\";",
    "render,",
    "setMapData,",
    "initMap,",
    "renderExportPassesToCanvas,",
    "export function renderLegend",
    "requestInteractionRender,",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P40 render lifecycle/facade token: ${token}`);
    }
  }
  for (const token of [
    "render,",
    "setMapData,",
    "initMap,",
    "RENDER_PASS_NAMES,",
    "from \"../map_renderer.js\";",
  ]) {
    const publicFacade = readProjectFile("js/core/map_renderer/public.js");
    if (!publicFacade.includes(token)) {
      failures.push(`js/core/map_renderer/public.js must keep P40 public facade token: ${token}`);
    }
  }
  for (const token of [
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
  ]) {
    if (setMapDataTransactionOwner.includes(token)) {
      failures.push(`${FILES.setMapDataTransactionOwner} must keep P40 render lifecycle token absent: ${token}`);
    }
  }
  for (const token of [
    "setMapData",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
  ]) {
    if (rendererStartupTransactionOwner.includes(token)) {
      failures.push(`${FILES.rendererStartupTransactionOwner} must keep P40 render lifecycle/setMapData token absent: ${token}`);
    }
  }
  if (hasMapRendererImport(renderCacheOwner)) {
    failures.push(`${FILES.renderCacheOwner} must not import js/core/map_renderer.js for P40.`);
  }
  if (hasMapRendererImport(renderPipelinePasses)) {
    failures.push(`${FILES.renderPipelinePasses} must not import js/core/map_renderer.js for P40.`);
  }
  for (const token of [
    "document",
    "window",
    "globalThis.d3",
    "projection",
    "zoomBehavior",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "runtimeState",
  ]) {
    if (renderTransformReusePolicyOwner.includes(token)) {
      failures.push(`${FILES.renderTransformReusePolicyOwner} must not touch P40 render lifecycle host token: ${token}`);
    }
  }
  for (const [relativePath, source] of [
    [FILES.scenarioRefreshRuntime, scenarioRefreshRuntime],
    [FILES.exactAfterSettleScheduler, exactAfterSettleScheduler],
    ["js/core/renderer/strategic_overlay_runtime_owner.js", readProjectFile("js/core/renderer/strategic_overlay_runtime_owner.js")],
  ]) {
    for (const token of ["renderer_render_lifecycle_owner.js", "render_lifecycle_owner.js"]) {
      if (source.includes(token)) {
        failures.push(`${relativePath} must not import P40 render lifecycle owner: ${token}`);
      }
    }
  }
  if (stateWriteAllowlist.includes("renderer_render_lifecycle_owner")
    || stateWriteAllowlist.includes("render_lifecycle_owner")) {
    failures.push(`${FILES.stateWriteAllowlist} must not include a P40 render lifecycle owner.`);
  }

  for (const heading of [
    "## Scope and guardrails",
    "## Current P47 renderer lifecycle baseline",
    "## renderPassToCache current entry inventory",
    "## Pass canvas sizing and context acquisition inventory",
    "## Transform and reference-transform inventory",
    "## Dirty/signature/cache-state inventory",
    "## Draw callback contract inventory",
    "## Pass timings and render transaction diagnostics inventory",
    "## Render cache owner boundary",
    "## Render pipeline catalog boundary",
    "## Exact-after-settle and deferred pass boundary",
    "## P51 allowed first move",
    "## Forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererRenderPassCacheHostPreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererRenderPassCacheHostPreflightDoc} must keep P50 heading: ${heading}`);
    }
  }
  for (const token of [
    "P50 is preflight only.",
    "`renderPassToCache(` remains in `map_renderer.js`.",
    "`drawCanvas()` remains in `map_renderer.js`.",
    "No render pass drawing functions move.",
    "No public facade changes.",
    "No state-write allowlist changes.",
    "`render_cache_owner.js` remains authoritative",
    "`render_pipeline_passes.js` owns idle pass preparation and calls injected `renderPassToCache`.",
    "`render_pipeline_catalog.js` owns idle pass definitions/catalog.",
    "`render_invalidation_catalog.js` owns invalidation vocabulary.",
    "`render_transform_reuse_policy_owner.js` owns transform reuse policy.",
    "P51 may add a render pass cache host adapter owner.",
    "P51 must preserve the current `drawFn(k)` callback contract.",
    "P51 must delegate existing draw callback behavior and must keep render pass drawing functions in their current modules.",
    "no additional preflight is required before a narrow P51 host adapter owner",
  ]) {
    if (!rendererRenderPassCacheHostPreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererRenderPassCacheHostPreflightDoc} must lock P50 boundary token: ${token}`);
    }
  }
  for (const token of [
    "P51 render pass cache host owner",
    "`js/core/map_renderer/render_pass_cache_host_owner.js`",
    "`renderPassToCache` remains the stable wrapper",
    "Cache commit/accounting stays in `map_renderer.js`",
  ]) {
    if (!rendererRenderPassCacheHostOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererRenderPassCacheHostOwnerDoc} must lock P51 owner boundary token: ${token}`);
    }
  }
  for (const token of [
    "const P50_DOC_PATH = \"docs/active/renderer-render-pass-cache-host-preflight-20260701.md\";",
    "const P51_DOC_PATH = \"docs/active/renderer-render-pass-cache-host-owner-p51-20260702.md\";",
    "const RENDER_PASS_CACHE_HOST_OWNER_PATH = \"js/core/map_renderer/render_pass_cache_host_owner.js\";",
    "function renderPassToCache(",
    "function drawCanvas()",
    "const hostResult = getRenderPassCacheHostOwner().prepareRenderPassHost({",
    "passStart = nowMs();",
    "getRenderPassCommitAccountingOwner().commitRenderPass({",
    "drawResult: hostResult.drawResult,",
    "hostSummary: hostResult,",
    "P51 owner must keep host setup token",
    "P51 owner must avoid cache commit or broad lifecycle token",
    "render cache owner must not import map_renderer",
    "render pipeline passes owner must not import map_renderer",
    "transform reuse policy owner must avoid render pass host token",
    "package.json must expose the P50 render pass cache host inventory test",
  ]) {
    if (!rendererRenderPassCacheHostInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererRenderPassCacheHostInventoryTest} must lock P50 inventory token: ${token}`);
    }
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderPassCacheHostPreflightDoc))) {
    failures.push(`${FILES.rendererRenderPassCacheHostPreflightDoc} must exist for P50.`);
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderPassCacheHostInventoryTest))) {
    failures.push(`${FILES.rendererRenderPassCacheHostInventoryTest} must exist for P50.`);
  }
  for (const relativePath of [
    FILES.rendererRenderPassCacheHostOwnerDoc,
    FILES.renderPassCacheHostOwner,
    FILES.renderPassCacheHostOwnerTest,
    FILES.renderPassCacheHostOwnerInventoryTest,
  ]) {
    if (!fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`${relativePath} must exist for P51 render pass cache host owner.`);
    }
  }
  if (!packageJson.includes("\"test:node:renderer-render-pass-cache-host-inventory\": \"node --test tests/renderer_render_pass_cache_host_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P50 render pass cache host inventory script.`);
  }
  for (const token of [
    "\"test:node:render-pass-cache-host-owner\": \"node --test tests/render_pass_cache_host_owner_behavior.test.mjs\"",
    "\"test:node:render-pass-cache-host-owner-inventory\": \"node --test tests/render_pass_cache_host_owner_inventory.test.mjs\"",
    "\"test:node:render-pass-cache-host-owner-suite\": \"npm run test:node:render-pass-cache-host-owner && npm run test:node:render-pass-cache-host-owner-inventory && npm run test:node:renderer-render-pass-cache-host-inventory\"",
  ]) {
    if (!packageJson.includes(token)) {
      failures.push(`${FILES.packageJson} must expose P51 render pass cache host owner script: ${token}`);
    }
  }
  if (!renderer.includes("function renderPassToCache(")) {
    failures.push(`${FILES.renderer} must keep P50 renderPassToCache anchor.`);
  }
  if (!renderer.includes("function drawCanvas()")) {
    failures.push(`${FILES.renderer} must keep P50 drawCanvas anchor.`);
  }
  const renderPassToCacheSource = sliceBetween(
    renderer,
    "function renderPassToCache(",
    "function resetCanvasContext(",
  );
  for (const token of [
    "let passStart = 0;",
    "const hostResult = getRenderPassCacheHostOwner().prepareRenderPassHost({",
    "drawFn,",
    "onHostReady: () => {",
    "passStart = nowMs();",
    "if (hostResult?.skipped) return;",
    "getRenderPassCommitAccountingOwner().commitRenderPass({",
    "drawResult: hostResult.drawResult,",
    "hostSummary: hostResult,",
  ]) {
    if (!renderPassToCacheSource.includes(token)) {
      failures.push(`${FILES.renderer} renderPassToCache must keep P51/P52 wrapper delegation token: ${token}`);
    }
  }
  for (const token of [
    "const passCanvas = ensureRenderPassCanvas(passName);",
    "const passContext = passCanvas.getContext(\"2d\");",
    "const layout = getRenderPassLayout(passName);",
    "withRenderTarget(passContext, () => {",
    "prepareTargetContext(passContext, transform, layout)",
    "drawResult = drawFn(k);",
    "const cache = getRenderPassCacheState();",
    "recordRenderPerfMetric(\"renderPassCommitSkipped\"",
    "setPassReferenceTransform(passName, transform);",
    "const identity = getVisibleFrameIdentity(transform);",
    "cache.politicalPassSceneGeneration =",
    "cache.signatures[passName] = getRenderPassSignature(passName, transform);",
    "cache.dirty[passName] = false;",
    "cache.partialPoliticalDirtyIds.clear();",
    "schedulePoliticalPathWarmup(transform);",
    "recordPassTiming(timings, passName, passStart);",
    "getPassCounterNames(passName).forEach((counterName) => incrementPerfCounter(counterName));",
    "cache.counters.contextScenarioReuseCount = 0;",
  ]) {
    if (renderPassToCacheSource.includes(token)) {
      failures.push(`${FILES.renderer} renderPassToCache must delegate extracted host or commit token: ${token}`);
    }
  }
  if (!renderer.includes("import { createRenderPassCacheHostOwner } from \"./map_renderer/render_pass_cache_host_owner.js\";")) {
    failures.push(`${FILES.renderer} must import P51 render pass cache host owner from map_renderer namespace.`);
  }
  for (const token of [
    "export function createRenderPassCacheHostOwner({",
    "function prepareRenderPassHost({",
    "\"ensureRenderPassCanvas\"",
    "\"prepareTargetContext\"",
    "\"withRenderTarget\"",
    "\"getRenderPassLayout\"",
    "passCanvas.getContext(\"2d\")",
    "Math.max(0.0001, Number(transform?.k || 1))",
    "drawResult = drawFn(k);",
    "Object.freeze([...(trace?.effectOrder || [])])",
  ]) {
    if (!renderPassCacheHostOwner.includes(token)) {
      failures.push(`${FILES.renderPassCacheHostOwner} must keep P51 host setup token: ${token}`);
    }
  }
  for (const token of [
    "setPassReferenceTransform",
    "setPassFullReferenceTransform",
    "clearPassFullReferenceTransforms",
    "cache.signatures",
    "cache.dirty",
    "cache.partialPoliticalDirtyIds",
    "schedulePoliticalPathWarmup",
    "recordPassTiming",
    "recordRenderPerfMetric",
    "getPassCounterNames",
    "incrementPerfCounter",
    "drawCanvas",
    "buildHitCanvas",
  ]) {
    if (renderPassCacheHostOwner.includes(token)) {
      failures.push(`${FILES.renderPassCacheHostOwner} must avoid P51 cache commit or broad lifecycle token: ${token}`);
    }
  }
  if (fs.existsSync(path.join(REPO_ROOT, "js/core/renderer/render_pass_cache_host_owner.js"))) {
    failures.push("P51 render pass cache host owner must stay under js/core/map_renderer, not js/core/renderer.");
  }
  for (const [relativePath, source] of [
    [FILES.renderCacheOwner, renderCacheOwner],
    [FILES.renderPipelinePasses, renderPipelinePasses],
  ]) {
    if (hasMapRendererImport(source)) {
      failures.push(`${relativePath} must not import js/core/map_renderer.js for P50.`);
    }
  }
  for (const token of [
    "function ensureRenderPassCanvas(passName)",
    "function getRenderPassLayout(passName)",
    "setPassReferenceTransform(passName, transform)",
    "setPassFullReferenceTransform(passName, transform)",
    "function clearPassFullReferenceTransforms(passNames = null)",
  ]) {
    if (!renderCacheOwner.includes(token)) {
      failures.push(`${FILES.renderCacheOwner} must keep P50 cache host token: ${token}`);
    }
  }
  if (!renderPipelinePasses.includes("renderPassToCache(passName, drawFn, transform, timings);")) {
    failures.push(`${FILES.renderPipelinePasses} must keep P50 injected renderPassToCache call.`);
  }
  if (!renderPipelineCatalog.includes("export const IDLE_RENDER_PASS_DEFINITIONS")) {
    failures.push(`${FILES.renderPipelineCatalog} must keep P50 idle render pass catalog.`);
  }
  if (!renderInvalidationCatalog.includes("export const PASS_RESOURCE_MAP")) {
    failures.push(`${FILES.renderInvalidationCatalog} must keep P50 invalidation catalog.`);
  }
  for (const token of [
    "P52 render pass commit/accounting owner",
    "`js/core/map_renderer/render_pass_commit_accounting_owner.js`",
    "`renderPassToCache` remains the stable wrapper.",
    "No `drawCanvas()` migration.",
    "No public facade, state-write allowlist, or `dist/**` changes.",
  ]) {
    if (!rendererRenderPassCommitAccountingOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererRenderPassCommitAccountingOwnerDoc} must lock P52 boundary token: ${token}`);
    }
  }
  for (const relativePath of [
    FILES.rendererRenderPassCommitAccountingOwnerDoc,
    FILES.renderPassCommitAccountingOwner,
    FILES.renderPassCommitAccountingOwnerTest,
    FILES.renderPassCommitAccountingOwnerInventoryTest,
  ]) {
    if (!fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`${relativePath} must exist for P52 render pass commit/accounting owner.`);
    }
  }
  for (const token of [
    "\"test:node:render-pass-commit-accounting-owner\": \"node --test tests/render_pass_commit_accounting_owner_behavior.test.mjs\"",
    "\"test:node:render-pass-commit-accounting-inventory\": \"node --test tests/render_pass_commit_accounting_owner_inventory.test.mjs\"",
  ]) {
    if (!packageJson.includes(token)) {
      failures.push(`${FILES.packageJson} must expose P52 render pass commit/accounting script: ${token}`);
    }
  }
  if (!renderer.includes("import { createRenderPassCommitAccountingOwner } from \"./map_renderer/render_pass_commit_accounting_owner.js\";")) {
    failures.push(`${FILES.renderer} must import P52 render pass commit/accounting owner from map_renderer namespace.`);
  }
  for (const token of [
    "let renderPassCommitAccountingOwner = null;",
    "function getRenderPassCommitAccountingOwner()",
    "renderPassCommitAccountingOwner = createRenderPassCommitAccountingOwner({",
    "getRenderPassCommitAccountingOwner().commitRenderPass({",
    "drawResult: hostResult.drawResult,",
    "hostSummary: hostResult,",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P52 commit/accounting wrapper token: ${token}`);
    }
  }
  for (const token of [
    "export function createRenderPassCommitAccountingOwner({",
    "function commitRenderPass({",
    "\"getRenderPassCacheState\"",
    "\"getVisibleFrameIdentity\"",
    "\"getRenderPassSignature\"",
    "\"getPassCounterNames\"",
    "\"nowMs\"",
    "\"recordRenderPerfMetric\"",
    "\"setPassReferenceTransform\"",
    "\"setPassFullReferenceTransform\"",
    "\"clearPassFullReferenceTransforms\"",
    "renderPassCommitSkipped",
    "cache.politicalPassSceneGeneration =",
    "cache.signatures[normalizedPassName] =",
    "cache.dirty[normalizedPassName] = false;",
    "cache.partialPoliticalDirtyIds.clear();",
    "cache.counters.contextScenarioReuseCount = 0;",
    "Object.freeze([...(trace?.effectOrder || [])])",
  ]) {
    if (!renderPassCommitAccountingOwner.includes(token)) {
      failures.push(`${FILES.renderPassCommitAccountingOwner} must keep P52 commit/accounting token: ${token}`);
    }
  }
  for (const token of [
    "prepareRenderPassHost",
    "ensureRenderPassCanvas",
    "passCanvas.getContext(\"2d\")",
    "getRenderPassLayout",
    "prepareTargetContext",
    "withRenderTarget",
    "drawCanvas",
    "drawPoliticalPass",
    "drawContextBasePass",
    "drawContextScenarioPass",
    "buildHitCanvas",
    "scenario_refresh",
    "exact_after_settle",
    "strategic_overlay",
    "runtimeState",
    "document",
    "window",
    "globalThis.d3",
  ]) {
    if (renderPassCommitAccountingOwner.includes(token)) {
      failures.push(`${FILES.renderPassCommitAccountingOwner} must avoid P52 host setup or adjacent renderer token: ${token}`);
    }
  }
  for (const token of [
    "createRenderPassCommitAccountingOwner",
    "commitRenderPass",
    "cache.signatures",
    "cache.dirty",
    "recordRenderPerfMetric",
    "recordPassTiming",
    "schedulePoliticalPathWarmup",
  ]) {
    if (renderPassCacheHostOwner.includes(token)) {
      failures.push(`${FILES.renderPassCacheHostOwner} must avoid P52 commit/accounting token: ${token}`);
    }
  }
  if (fs.existsSync(path.join(REPO_ROOT, "js/core/renderer/render_pass_commit_accounting_owner.js"))) {
    failures.push("P52 render pass commit/accounting owner must stay under js/core/map_renderer, not js/core/renderer.");
  }
  for (const [relativePath, source] of [
    [FILES.publicFacade, publicFacadeSource],
    [FILES.stateWriteAllowlist, stateWriteAllowlist],
    [FILES.hitCanvasSchedulingOwner, hitCanvasSchedulingOwner],
    [FILES.scenarioRefreshRuntime, scenarioRefreshRuntime],
    [FILES.exactAfterSettleScheduler, exactAfterSettleScheduler],
    ["js/core/renderer/strategic_overlay_runtime_owner.js", readProjectFile("js/core/renderer/strategic_overlay_runtime_owner.js")],
    ["js/core/renderer/strategic_overlay_render_owner.js", readProjectFile("js/core/renderer/strategic_overlay_render_owner.js")],
  ]) {
    for (const token of [
      "render_pass_commit_accounting",
      "renderer_render_pass_commit_accounting",
      "renderPassCommitAccounting",
    ]) {
      if (source.includes(token)) {
        failures.push(`${relativePath} must not include P52 render pass commit/accounting token: ${token}`);
      }
    }
  }
  for (const token of [
    "document",
    "window",
    "globalThis.d3",
    "projection",
    "zoomBehavior",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "runtimeState",
  ]) {
    if (renderTransformReusePolicyOwner.includes(token)) {
      failures.push(`${FILES.renderTransformReusePolicyOwner} must avoid P50 render pass host token: ${token}`);
    }
  }
  for (const [relativePath, source] of [
    [FILES.renderRequestBoundaryOwner, renderRequestBoundaryOwner],
    [FILES.renderPhaseLifecycleOwner, renderPhaseLifecycleOwner],
    [FILES.visibleFrameDiagnosticsOwner, visibleFrameDiagnosticsOwner],
    [FILES.hitCanvasSchedulingOwner, hitCanvasSchedulingOwner],
  ]) {
    for (const token of ["renderPassToCache", "drawCanvas"]) {
      if (source.includes(token)) {
        failures.push(`${relativePath} must avoid P50 render pass host lifecycle token: ${token}`);
      }
    }
  }
  for (const relativePath of [
    FILES.rendererRenderLifecycleOwner,
    "js/core/map_renderer/render_lifecycle_owner.js",
    "js/core/renderer/render_lifecycle_owner.js",
    "js/core/renderer/render_lifecycle_helper.js",
    "js/core/renderer/render_lifecycle_controller.js",
    "js/core/map_renderer/render_lifecycle_helper.js",
    "js/core/map_renderer/render_lifecycle_controller.js",
  ]) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`P50 must keep broad render lifecycle owner/helper absent: ${relativePath}`);
    }
  }
  for (const token of [
    "render,",
    "setMapData,",
    "initMap,",
    "RENDER_PASS_NAMES,",
    "from \"../map_renderer.js\";",
  ]) {
    if (!publicFacadeSource.includes(token)) {
      failures.push(`${FILES.publicFacade} must keep P50 public facade token: ${token}`);
    }
  }
  for (const [relativePath, source] of [
    [FILES.publicFacade, publicFacadeSource],
    [FILES.stateWriteAllowlist, stateWriteAllowlist],
    [FILES.scenarioRefreshRuntime, scenarioRefreshRuntime],
    [FILES.exactAfterSettleScheduler, exactAfterSettleScheduler],
    ["js/core/renderer/strategic_overlay_runtime_owner.js", readProjectFile("js/core/renderer/strategic_overlay_runtime_owner.js")],
    ["js/core/renderer/strategic_overlay_render_owner.js", readProjectFile("js/core/renderer/strategic_overlay_render_owner.js")],
  ]) {
    for (const token of ["render_pass_cache_host", "renderer_render_pass_cache_host", "renderPassCacheHost"]) {
      if (source.includes(token)) {
        failures.push(`${relativePath} must not include P50 render pass cache host token: ${token}`);
      }
    }
  }

  if (!packageJson.includes("\"test:node:renderer-draw-canvas-orchestration-inventory\": \"node --test tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P53 drawCanvas orchestration inventory script.`);
  }
  if (!renderer.includes("function drawCanvas()")) {
    failures.push(`${FILES.renderer} must keep P53 drawCanvas anchor.`);
  }
  if (!renderer.includes("function renderPassToCache(")) {
    failures.push(`${FILES.renderer} must keep P53 renderPassToCache wrapper anchor.`);
  }
  const drawCanvasSource = sliceBetween(
    renderer,
    "function drawCanvas()",
    "function readRenderPerfMetricDuration(",
  );
  if (!drawCanvasSource.includes("getDrawCanvasOrchestrationOwner().drawCanvasFrame();")) {
    failures.push(`${FILES.renderer} drawCanvas must keep P2.1 thin wrapper.`);
  }
  for (const token of [
    "export function createDrawCanvasOrchestrationOwner({ constants = {}, getters = {}, effects = {} } = {})",
    "function drawCanvasFrame(options)",
    "const includeSummary = options?.includeSummary === true;",
    "getRenderPhase() === renderPhaseInteracting && getFirstVisibleFramePainted()",
    "const useTransformedFrame = currentPhase === renderPhaseInteracting",
    "drawTransformedFrameFromCaches",
    "drawLastGoodFrameFallback",
    "drawBaseVisibleFrameFallback",
    "resetContextBreakdownForExactFrame",
    "ensureIdleRenderPasses",
    "composeCachedPasses",
    "abortPendingExactAfterSettleRefreshAfterPaint",
    "markFirstVisibleFramePainted",
    "captureLastGoodFrame",
    "recordRenderPerfMetric",
    "finalizePendingExactAfterSettleRefreshAfterPaint",
    "incrementPerfCounter(\"frames\");",
  ]) {
    if (!drawCanvasOrchestrationOwner.includes(token)) {
      failures.push(`${FILES.drawCanvasOrchestrationOwner} must keep P2.1 orchestration token: ${token}`);
    }
  }
  for (const token of [
    "export function createCachedPassCompositorOwner({ constants = {}, getters = {}, helpers = {}, effects = {} } = {})",
    "function drawTransformedPass(passName, currentTransform, referenceTransform = null)",
    "function composeRenderPassesToTarget(",
    "{ requireAllPasses = false } = {},",
    "const cacheSnapshot = getRenderPassCacheSnapshot();",
    "const targetContext = getActiveTargetContext();",
    "const scaleRatio = current.k / Math.max(reference.k, 0.0001);",
    "const missingCanvasPassNames = [];",
    "const missingReferenceTransformPassNames = [];",
    "recordTransformedPassDiagnostics(passName, {",
    "Math.round(-Number(layout?.offsetX || 0) * dpr)",
    "return Object.freeze({",
  ]) {
    if (!cachedPassCompositorOwner.includes(token)) {
      failures.push(`${FILES.cachedPassCompositorOwner} must keep P2.2a compositor token: ${token}`);
    }
  }
  for (const token of [
    "composeTransformedFrameToBuffer",
    "drawTransformedFrameFromCaches",
    "buildInteractionComposite",
    "drawInteractionComposite",
    "drawInteractionBorderSnapshot",
    "drawBordersPass",
    "drawLastGoodFrameFallback",
    "drawBaseVisibleFrameFallback",
    "renderPassToCache",
    "runtimeState",
    "globalThis",
    "document",
    "window",
    "runGetter",
    "runEffect",
    "createTrace",
  ]) {
    if (cachedPassCompositorOwner.includes(token)) {
      failures.push(`${FILES.cachedPassCompositorOwner} must avoid P2.2a adjacent/global token: ${token}`);
    }
  }
  for (const token of [
    "import { createCachedPassCompositorOwner } from \"./renderer/cached_pass_compositor_owner.js\";",
    "let cachedPassCompositorOwner = null;",
    "function getCachedPassCompositorOwner() {",
    "getActiveTargetContext: () => rendererSurfaceHost.getContext()",
    "getRenderPassCacheSnapshot: getRenderPassCacheState",
    "recordTransformedPassDiagnostics: (passName, details) => {",
    "return getCachedPassCompositorOwner().drawTransformedPass(",
    "return getCachedPassCompositorOwner().composeRenderPassesToTarget(",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P2.2a composition-root token: ${token}`);
    }
  }
  for (const token of [
    "getPassCanvas: (passName) => getRenderPassCacheState()",
    "isPassDirty: (passName) => !!getRenderPassCacheState()",
  ]) {
    if (renderer.includes(token)) {
      failures.push(`${FILES.renderer} must use one P2.2a cache snapshot per compositor method: ${token}`);
    }
  }
  for (const token of [
    "composeTransformedFrameToBuffer",
    "drawTransformedFrameFromCaches",
    "buildInteractionComposite",
    "drawInteractionComposite",
    "drawInteractionBorderSnapshot",
    "drawBordersPass",
    "drawLastGoodFrameFallback",
    "drawBaseVisibleFrameFallback",
    "renderPassToCache",
  ]) {
    if (!renderer.includes(`function ${token}(`)) {
      failures.push(`${FILES.renderer} must retain P2.2a adjacent function: ${token}`);
    }
  }
  for (const token of ["cached_pass_compositor_owner", "cachedPassCompositorOwner"]) {
    if (publicFacadeSource.includes(token)) {
      failures.push(`${FILES.publicFacade} must not expose P2.2a cached-pass compositor token: ${token}`);
    }
    if (stateWriteAllowlist.includes(token)) {
      failures.push(`${FILES.stateWriteAllowlist} must not include P2.2a cached-pass compositor token: ${token}`);
    }
  }
  for (const relativePath of [
    "js/core/renderer/cached_pass_compositor_helper.js",
    "js/core/renderer/cached_pass_compositor_controller.js",
    "js/core/renderer/cached_pass_compositor_adapter.js",
    "js/core/renderer/shared_cached_pass_compositor_owner.js",
    "js/core/map_renderer/cached_pass_compositor_owner.js",
    "js/core/map_renderer/cached_pass_compositor_helper.js",
    "js/core/map_renderer/cached_pass_compositor_controller.js",
    "js/core/map_renderer/cached_pass_compositor_adapter.js",
  ]) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`P2.2a must keep duplicate cached-pass compositor absent: ${relativePath}`);
    }
  }
  for (const sourcePath of listProjectSourceFiles("js/core")) {
    if (isForbiddenCachedPassCompositorOwnerPath(sourcePath)) {
      failures.push(`P2.2a must keep renamed cached-pass compositor absent: ${sourcePath}`);
    }
  }
  for (const token of [
    "export function createTransformedFrameCompositorOwner({",
    "function composeTransformedFrameToBuffer(",
    "function drawTransformedFrameFromCaches(",
    "setInteractionCompositeRejectedReason(compositeReuseDecision.reason || \"unknown\")",
    "setPendingExactPoliticalFastFrame(false)",
    "blitCompositeBufferToMain(bufferCanvas)",
    "return Object.freeze({",
  ]) {
    if (!transformedFrameCompositorOwner.includes(token)) {
      failures.push(`${FILES.transformedFrameCompositorOwner} must keep P2.2b compositor token: ${token}`);
    }
  }
  for (const token of [
    "renderPassToCache",
    "drawLastGoodFrameFallback",
    "drawBaseVisibleFrameFallback",
    "runtimeState",
    "globalThis",
    "document",
    "window",
    "runGetter",
    "runEffect",
    "createTrace",
  ]) {
    if (transformedFrameCompositorOwner.includes(token)) {
      failures.push(`${FILES.transformedFrameCompositorOwner} must avoid P2.2b adjacent/global token: ${token}`);
    }
  }
  for (const token of [
    "import { createTransformedFrameCompositorOwner } from \"./map_renderer/transformed_frame_compositor_owner.js\";",
    "let transformedFrameCompositorOwner = null;",
    "function getTransformedFrameCompositorOwner() {",
    "return getTransformedFrameCompositorOwner().composeTransformedFrameToBuffer(",
    "return getTransformedFrameCompositorOwner().drawTransformedFrameFromCaches(timings, options);",
    "setInteractionCompositeRejectedReason: (reason) => {",
    "setPendingExactPoliticalFastFrame: (value) => {",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P2.2b composition-root token: ${token}`);
    }
  }
  for (const token of ["transformed_frame_compositor_owner", "transformedFrameCompositorOwner"]) {
    if (publicFacadeSource.includes(token)) {
      failures.push(`${FILES.publicFacade} must not expose P2.2b compositor token: ${token}`);
    }
    if (stateWriteAllowlist.includes(token)) {
      failures.push(`${FILES.stateWriteAllowlist} must not include P2.2b compositor token: ${token}`);
    }
  }
  for (const relativePath of [
    "js/core/map_renderer/transformed_frame_compositor_helper.js",
    "js/core/map_renderer/transformed_frame_compositor_controller.js",
    "js/core/map_renderer/transformed_frame_compositor_adapter.js",
    "js/core/map_renderer/shared_transformed_frame_compositor_owner.js",
    "js/core/renderer/transformed_frame_compositor_owner.js",
    "js/core/renderer/transformed_frame_compositor_helper.js",
    "js/core/renderer/transformed_frame_compositor_controller.js",
    "js/core/renderer/transformed_frame_compositor_adapter.js",
  ]) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`P2.2b must keep duplicate transformed-frame compositor absent: ${relativePath}`);
    }
  }
  for (const sourcePath of listProjectSourceFiles("js/core")) {
    if (isForbiddenTransformedFrameCompositorOwnerPath(sourcePath)) {
      failures.push(`P2.2b must keep renamed transformed-frame compositor absent: ${sourcePath}`);
    }
  }
  for (const token of [
    "const hostResult = getRenderPassCacheHostOwner().prepareRenderPassHost({",
    "getRenderPassCommitAccountingOwner().commitRenderPass({",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P53 P51/P52 renderPassToCache wrapper token: ${token}`);
    }
  }
  for (const token of [
    "export function createRenderPipelinePassesOwner({",
    "function getIdleRenderPassDefinitions()",
    "function prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache = getRenderPassCacheState())",
    "function ensureIdleRenderPasses(timings, passNames = null)",
    "renderPassToCache(passName, drawFn, transform, timings);",
  ]) {
    if (!renderPipelinePasses.includes(token)) {
      failures.push(`${FILES.renderPipelinePasses} must keep P53 pass orchestration token: ${token}`);
    }
  }
  for (const token of [
    "export const IDLE_RENDER_PASS_DEFINITIONS = [",
    "{ passName: \"background\", drawKey: \"drawBackgroundPass\" }",
    "{ passName: \"labels\", drawKey: \"drawLabelsPass\" }",
  ]) {
    if (!renderPipelineCatalog.includes(token)) {
      failures.push(`${FILES.renderPipelineCatalog} must keep P53 idle pass definition token: ${token}`);
    }
  }
  for (const token of [
    "export const RENDER_PASS_NAMES = [",
    "export const INTERACTION_COMPOSITE_PASS_NAMES = [",
    "export const TRANSFORMED_FRAME_PASS_NAMES = [",
  ]) {
    if (!renderPassCatalog.includes(token)) {
      failures.push(`${FILES.renderPassCatalog} must keep P53 pass group token: ${token}`);
    }
  }
  for (const token of [
    "function drawHitCanvas()",
    "async function buildHitCanvasAfterStartup({ keepReady = false, reason = \"startup-deferred-hit-canvas\" } = {})",
    "function scheduleHitCanvasBuildIfNeeded({ reason = \"idle-render\" } = {})",
    "function refreshMapDataForScenarioChunkPromotion(options = {})",
    "function refreshMapDataForScenarioApply(options = {})",
    "createStrategicOverlayRuntimeOwner({",
    "createStrategicOverlayRenderOwner({",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P53 adjacent boundary anchor: ${token}`);
    }
  }
  for (const [relativePath, source] of [
    [FILES.renderRequestBoundaryOwner, renderRequestBoundaryOwner],
    [FILES.renderPhaseLifecycleOwner, renderPhaseLifecycleOwner],
    [FILES.visibleFrameDiagnosticsOwner, visibleFrameDiagnosticsOwner],
    [FILES.hitCanvasSchedulingOwner, hitCanvasSchedulingOwner],
    [FILES.exactAfterSettleScheduler, exactAfterSettleScheduler],
    [FILES.scenarioRefreshRuntime, scenarioRefreshRuntime],
    ["js/core/renderer/strategic_overlay_runtime_owner.js", readProjectFile("js/core/renderer/strategic_overlay_runtime_owner.js")],
    ["js/core/renderer/strategic_overlay_render_owner.js", readProjectFile("js/core/renderer/strategic_overlay_render_owner.js")],
  ]) {
    if (source.includes("function drawCanvas()")) {
      failures.push(`${relativePath} must not own P53 drawCanvas.`);
    }
    if (source.includes("renderPassToCache(passName")) {
      failures.push(`${relativePath} must not call P53 renderPassToCache directly.`);
    }
  }
  for (const token of [
    "drawHitCanvas",
    "drawHitCanvasWithMetric",
    "buildHitCanvasAfterStartup",
    "getDirtyHitCanvasPointProbeHit",
  ]) {
    if (hitCanvasSchedulingOwner.includes(token)) {
      failures.push(`${FILES.hitCanvasSchedulingOwner} must avoid P53 hit canvas build/probe token: ${token}`);
    }
  }
  if (!exactAfterSettleScheduler.includes("function scheduleExactAfterSettleRefresh(")) {
    failures.push(`${FILES.exactAfterSettleScheduler} must keep P53 exact scheduler entry.`);
  }
  if (!scenarioRefreshRuntime.includes("function refreshMapDataForScenarioChunkPromotion(")) {
    failures.push(`${FILES.scenarioRefreshRuntime} must keep P53 scenario chunk refresh entry.`);
  }
  for (const token of [
    "draw_canvas_orchestration",
    "renderer_draw_canvas_orchestration",
    "drawCanvasOrchestration",
  ]) {
    if (publicFacadeSource.includes(token)) {
      failures.push(`${FILES.publicFacade} must not expose P53 drawCanvas orchestration token: ${token}`);
    }
    if (stateWriteAllowlist.includes(token)) {
      failures.push(`${FILES.stateWriteAllowlist} must not include P53 drawCanvas orchestration token: ${token}`);
    }
  }
  for (const relativePath of [
    FILES.rendererRenderLifecycleOwner,
    "js/core/renderer/draw_canvas_orchestration_owner.js",
    "js/core/renderer/draw_canvas_orchestration_helper.js",
    "js/core/renderer/draw_canvas_orchestration_controller.js",
    "js/core/renderer/draw_canvas_orchestration_adapter.js",
    "js/core/map_renderer/draw_canvas_orchestration_helper.js",
    "js/core/map_renderer/draw_canvas_orchestration_controller.js",
    "js/core/map_renderer/draw_canvas_orchestration_adapter.js",
    "js/core/map_renderer/shared_draw_canvas_orchestration_owner.js",
  ]) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`P53 must keep production owner/helper absent: ${relativePath}`);
    }
  }
  for (const sourcePath of listProjectSourceFiles("js/core")) {
    if (isForbiddenDrawCanvasOrchestrationOwnerPath(sourcePath)) {
      failures.push(`P53 must keep production drawCanvas orchestration owner/helper absent: ${sourcePath}`);
    }
  }

  for (const heading of [
    "## Scope and guardrails",
    "## Current P48 hover interaction baseline",
    "## Click entry and event binding inventory",
    "## Land click transaction inventory",
    "## Water click transaction inventory",
    "## Special region click transaction inventory",
    "## Dev selection and fill inventory",
    "## History/dirty/render refresh inventory",
    "## Scenario detail readiness boundary",
    "## P55/P56 allowed first move",
    "## Forbidden areas",
    "## Required validation commands",
  ]) {
    if (!rendererClickSelectionTransactionPreflightDoc.includes(heading)) {
      failures.push(`${FILES.rendererClickSelectionTransactionPreflightDoc} must keep P54 heading: ${heading}`);
    }
  }
  for (const token of [
    "P54 is preflight only.",
    "No production runtime changes.",
    "The click handler function remains in `js/core/map_renderer.js` as `async function handleClick(event, _interactionContext = null)`.",
    "`js/core/renderer/map_interaction_event_binding_owner.js` remains a binding owner only.",
    "`js/core/interaction_funnel.js` keeps the dispatch bridge.",
    "Land click transaction logic remains in `map_renderer.js`.",
    "Water click transaction logic remains in `map_renderer.js`.",
    "Special region click transaction logic remains in `map_renderer.js`.",
    "Dev selection and fill remain in `map_renderer.js` and existing UI owners.",
    "Click and fill transactions currently call the existing history, dirty-state, and render refresh paths:",
    "Detailed land interaction readiness remains inside `map_renderer.js`:",
    "The first implementation should probably extract water/special selection clearing or the dev-selection click transaction only.",
    "Do not combine land fill, sovereignty, water fill, special region, and dev selection in one owner.",
    "Adding click-selection transaction owner/helper/controller/adapter files under `js/core/**`.",
  ]) {
    if (!rendererClickSelectionTransactionPreflightDoc.includes(token)) {
      failures.push(`${FILES.rendererClickSelectionTransactionPreflightDoc} must lock P54 boundary token: ${token}`);
    }
  }
  for (const token of [
    "`resolveClickSelectionDecision(resolvedHit, readonlyModifiers) -> { decision, target }`",
    "The owner receives the exact four-key scalar `resolvedHit` projection, never the raw hit object.",
    "Water ctrl/meta toggle remains a root-owned selection behavior and reads the frozen modifier snapshot independently.",
    "Only the land dev-selection branch consumes `decision.devSelectionRequested`.",
    "History, dirty state, runtime selection writes, hydration, refreshed-hit resolution, sidebar refresh, rendering, DOM/UI work, and metrics remain root-owned.",
    "Canonical empty admission is explicit: `if (target.kind === \"empty\" || !id) {`; typed land/water/special targets with blank or null ids retain their typed kind and enter the same clear branch.",
    "Pre-edit selector: 19 files, 186 commands, 6 main-thread commands, with only this new phase record unmatched.",
  ]) {
    if (!rendererClickSelectionDecisionOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererClickSelectionDecisionOwnerDoc} must lock P1.8 boundary token: ${token}`);
    }
  }
  for (const token of [
    "const DOC_PATH = \"docs/active/renderer-click-selection-transaction-preflight-20260702.md\";",
    "const P1_8_DOC_PATH = \"docs/active/renderer-click-selection-pure-decision-owner-p1-8-20260709.md\";",
    "const CLICK_SELECTION_TRANSACTION_OWNER_PATH = \"js/core/map_renderer/click_selection_transaction_owner.js\";",
    "const P54_DOC_HEADINGS = Object.freeze([",
    "function extractFunctionSource(source, functionName)",
    "function isClickSelectionTransactionOwnerPath(sourcePath)",
    "async function handleClick(event, interactionContext = null)",
    "mapClick: handleClick",
    "interactionRect.on(\\\"click\\\", requireFunction(handlers, \\\"dispatchMapClick\\\"));",
    "Land click transaction logic remains",
    "Water click transaction logic remains",
    "Special region click transaction logic remains",
    "P1.8 must keep exactly one production click selection owner/helper path",
    "transaction behavior coverage executes the canonical owner factory",
    "action failure propagates and stops later sidebar and render work",
  ]) {
    if (!rendererClickSelectionTransactionInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererClickSelectionTransactionInventoryTest} must lock P54 inventory token: ${token}`);
    }
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererClickSelectionTransactionPreflightDoc))) {
    failures.push(`${FILES.rendererClickSelectionTransactionPreflightDoc} must exist for P54.`);
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.rendererClickSelectionTransactionInventoryTest))) {
    failures.push(`${FILES.rendererClickSelectionTransactionInventoryTest} must exist for P54.`);
  }
  for (const requiredPath of [
    FILES.rendererClickSelectionDecisionOwnerDoc,
    FILES.clickSelectionTransactionOwner,
    FILES.clickSelectionTransactionOwnerTest,
  ]) {
    if (!fs.existsSync(path.join(REPO_ROOT, requiredPath))) {
      failures.push(`${requiredPath} must exist for P1.8.`);
    }
  }
  if (!packageJson.includes("\"test:node:renderer-click-selection-transaction-inventory\": \"node --test tests/renderer_click_selection_transaction_inventory_boundary.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P54 click selection transaction inventory script.`);
  }
  if (!packageJson.includes("\"test:node:click-selection-transaction-owner\": \"node --test tests/click_selection_transaction_owner_behavior.test.mjs\"")) {
    failures.push(`${FILES.packageJson} must expose P1.8 click selection decision owner script.`);
  }
  const clickFacade = [
    "async function handleClick(event, interactionContext = null) {",
    "  return getClickSelectionTransactionOwner().handleClick(event, interactionContext);",
    "}",
  ].join("\n");
  if (!includesExactLfFragment(renderer, clickFacade)) {
    failures.push(`${FILES.renderer} must keep the exact P3.3 click transaction facade.`);
  }
  for (const token of [
    "createClickSelectionTransactionOwner,",
    "let clickSelectionTransactionOwner = null;",
    "function getClickSelectionTransactionOwner()",
    "clickSnapRadiusPx: HIT_SNAP_RADIUS_CLICK_PX,",
    "landFillColor: LAND_FILL_COLOR,",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P3.3 click owner composition token: ${token}`);
    }
  }
  for (const token of [
    "getHitFromEvent(event, {",
    "const resolvedHit = {",
    "const readonlyModifiers = Object.freeze({",
    "const { decision, target } = resolveClickSelectionDecision(resolvedHit, readonlyModifiers);",
    "if (target.kind === \"empty\" || !id) {",
    "if (target.kind === \"special\") {",
    "if (target.kind === \"water\") {",
    "if (target.kind !== \"land\") return;",
    "if (decision.devSelectionRequested) {",
    "await ensureLeafDetailReady(countryCode, { announce: true })",
    "setClickSelectedWaterRegionId(\"\")",
    "setClickSelectedSpecialRegionId(id)",
    "requestInteractionRender(\"clear-water-selection-empty-click\")",
    "requestInteractionRender(\"select-special-region\")",
    "requestInteractionRender(\"click-fill\")",
    "return Object.freeze({ handleClick });",
  ]) {
    if (!clickSelectionTransactionOwner.includes(token)) {
      failures.push(`${FILES.clickSelectionTransactionOwner} must keep P3.3 transaction token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "globalThis",
    "document",
    "window",
    "addEventListener",
    "State(runtimeState",
  ]) {
    if (clickSelectionTransactionOwner.includes(token)) {
      failures.push(`${FILES.clickSelectionTransactionOwner} must use injected click ports and avoid token: ${token}`);
    }
  }
  for (const token of [
    "mapClick: handleClick",
    "mapDoubleClick: handleDoubleClick",
    "dispatchMapClick",
    "dispatchMapDoubleClick",
    "function updateDevSelectedHit(hit = null)",
    "function addFeatureToDevSelection(featureId)",
    "function toggleFeatureInDevSelection(featureId)",
    "function clearDevSelection()",
    "function applyDevSelectionFill()",
    "function requestInteractionRender(reason = \"interaction\")",
    "getRenderRequestBoundaryOwner().requestInteractionRenderBoundary(reason).completed;",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P54 composition/dev/render token: ${token}`);
    }
  }
  for (const token of [
    "requireFunction(helpers, \"bindInteractionFunnel\")({",
    "mapClick: requireFunction(handlers, \"mapClick\")",
    "mapDoubleClick: requireFunction(handlers, \"mapDoubleClick\")",
    "interactionRect.on(\"click\", requireFunction(handlers, \"dispatchMapClick\"));",
    "interactionRect.on(\"dblclick\", requireFunction(handlers, \"dispatchMapDoubleClick\"));",
  ]) {
    if (!mapInteractionEventBindingOwner.includes(token)) {
      failures.push(`${FILES.mapInteractionEventBindingOwner} must keep P54 injected event binding token: ${token}`);
    }
  }
  for (const token of [
    "let mapClickImpl = null;",
    "export function bindInteractionFunnel({",
    "mapClickImpl = typeof mapClick === \"function\" ? mapClick : null;",
    "export function dispatchMapClick(event)",
    "debugState.lastClickContext = buildMapInteractionContext(\"click\", event);",
    "return mapClickImpl(event, debugState.lastClickContext);",
  ]) {
    if (!interactionFunnel.includes(token)) {
      failures.push(`${FILES.interactionFunnel} must keep P54 click dispatch token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "state.",
    "document",
    "window",
    "map_renderer.js",
    "markDirty",
    "captureHistoryState",
    "pushHistoryEntry",
    "commitHistoryEntry",
    "requestInteractionRender",
    "selectedWaterRegionId",
    "selectedSpecialRegionId",
  ]) {
    if (interactionHitCandidates.includes(token)) {
      failures.push(`${FILES.interactionHitCandidates} must remain pure for P54 and avoid token: ${token}`);
    }
  }
  for (const token of [
    "handleClick",
    "dispatchMapClick",
    "selectedWaterRegionId",
    "selectedSpecialRegionId",
    "toggleFeatureInDevSelection",
    "applyWaterRegionFill",
    "applyVisualSubdivisionFill",
    "markDirty",
    "commitHistoryEntry",
    "pushHistoryEntry",
  ]) {
    if (mapHoverInteractionOwner.includes(token)) {
      failures.push(`${FILES.mapHoverInteractionOwner} must remain hover-only for P54 and avoid token: ${token}`);
    }
  }
  for (const token of [
    "function captureHistoryState({",
    "function pushHistoryEntry(entry)",
    "function hasHistoryDelta(before, after)",
  ]) {
    if (!historyManager.includes(token)) {
      failures.push(`${FILES.historyManager} must keep P54 history ownership token: ${token}`);
    }
  }
  for (const token of [
    "function markDirty(reason = \"\")",
    "markDirtyState(runtimeState, reason);",
    "updateDirtyIndicator();",
  ]) {
    if (!dirtyState.includes(token)) {
      failures.push(`${FILES.dirtyState} must keep P54 dirty ownership token: ${token}`);
    }
  }
  for (const token of [
    "click_selection_transaction",
    "renderer_click_selection_transaction",
    "clickSelectionTransaction",
    "mapClickSelection",
  ]) {
    if (publicFacadeSource.includes(token)) {
      failures.push(`${FILES.publicFacade} must not expose P54 click selection transaction token: ${token}`);
    }
    if (stateWriteAllowlist.includes(token)) {
      failures.push(`${FILES.stateWriteAllowlist} must not include P54 click selection transaction token: ${token}`);
    }
  }
  for (const relativePath of [
    "js/core/map_renderer/click_selection_transaction_helper.js",
    "js/core/map_renderer/click_selection_transaction_controller.js",
    "js/core/map_renderer/click_selection_transaction_adapter.js",
    "js/core/renderer/click_selection_transaction_owner.js",
    "js/core/renderer/click_selection_transaction_helper.js",
    "js/core/renderer/click_selection_transaction_controller.js",
    "js/core/renderer/click_selection_transaction_adapter.js",
  ]) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`P1.8 must keep extra click selection owner/helper absent: ${relativePath}`);
    }
  }
  const clickSelectionOwnerPaths = listProjectSourceFiles("js/core")
    .filter((sourcePath) => isClickSelectionTransactionOwnerPath(sourcePath));
  if (
    clickSelectionOwnerPaths.length !== 1
    || clickSelectionOwnerPaths[0] !== FILES.clickSelectionTransactionOwner
  ) {
    failures.push(
      `P1.8 must keep exactly one production click selection owner/helper path: ${clickSelectionOwnerPaths.join(", ")}`,
    );
  }
  for (const token of [
    "const RESOLVED_HIT_KEYS = [",
    "const READONLY_MODIFIER_KEYS = [",
    "const ownKeys = Reflect.ownKeys(value);",
    "export function resolveClickSelectionDecision(resolvedHit, readonlyModifiers)",
    "devSelectionRequested: target.kind === \"land\" && (readonlyModifiers.ctrlKey || readonlyModifiers.metaKey)",
    "return { decision, target };",
  ]) {
    if (!clickSelectionTransactionOwner.includes(token)) {
      failures.push(`${FILES.clickSelectionTransactionOwner} must keep P1.8 pure owner token: ${token}`);
    }
  }
  for (const token of [
    "import ",
    "globalThis",
    "runtimeState",
    "map_renderer.js",
    "document",
    "window",
    "addEventListener",
    "pushHistoryEntry",
  ]) {
    if (clickSelectionTransactionOwner.includes(token)) {
      failures.push(`${FILES.clickSelectionTransactionOwner} must keep injected ownership and avoid token: ${token}`);
    }
  }
  for (const token of [
    "click selection owner module exposes the transaction factory and pure resolver",
    "empty hit returns exact empty target and false decision",
    "land ctrl or meta requests dev selection while shift and alt stay inert",
    "water and special targets never reuse the land dev-selection decision",
    "blank identity fields normalize to null without mutating input",
    "Reflect.ownKeys(result)",
    "repeated calls return equal data and preserve both inputs",
    "nonEnumerableKey",
    "Symbol(\"feature\")",
    "createResolvedHit({ id: undefined })",
    "empty hit clears water then special and invalidates each selection exactly once",
    "action failure propagates and stops later sidebar and render work",
  ]) {
    if (!clickSelectionTransactionOwnerTest.includes(token)) {
      failures.push(`${FILES.clickSelectionTransactionOwnerTest} must keep P1.8 behavior token: ${token}`);
    }
  }
  if (!fs.existsSync(path.join(REPO_ROOT, FILES.renderRequestBoundaryOwner))) {
    failures.push(`${FILES.renderRequestBoundaryOwner} must exist for P41.`);
  }
  if (fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecycleOwner))) {
    failures.push("P41 must keep js/core/renderer/renderer_render_lifecycle_owner.js absent.");
  }
  for (const token of [
    "export function createRenderRequestBoundaryOwner({",
    "const REQUIRED_EFFECT_NAMES = Object.freeze([",
    "const REQUIRED_GETTER_NAMES = Object.freeze([",
    "requestRendererRenderBoundary",
    "requestInteractionRenderBoundary",
    "flushInteractionRenderBoundary",
    "createSummary({",
    "effectOrder",
    "getterOrder",
  ]) {
    if (!renderRequestBoundaryOwner.includes(token)) {
      failures.push(`${FILES.renderRequestBoundaryOwner} must keep P41 owner token: ${token}`);
    }
  }
  for (const token of [
    "map_renderer.js",
    "runtimeState",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
    "renderer_render_lifecycle_owner",
  ]) {
    if (renderRequestBoundaryOwner.includes(token)) {
      failures.push(`${FILES.renderRequestBoundaryOwner} must avoid P41 forbidden token: ${token}`);
    }
  }
  if (renderRequestBoundaryOwner.includes("fallback({ effectApi")) {
    failures.push(`${FILES.renderRequestBoundaryOwner} must keep external fallback callbacks narrow.`);
  }
  if (hasMapRendererImport(renderRequestBoundaryOwner)) {
    failures.push(`${FILES.renderRequestBoundaryOwner} must not import map_renderer.js.`);
  }
  for (const token of [
    "from \"./map_renderer/render_request_boundary_owner.js\";",
    "let renderRequestBoundaryOwner = null;",
    "function getRenderRequestBoundaryOwner()",
    "renderRequestBoundaryOwner = createRenderRequestBoundaryOwner({",
    "requestRender,",
    "flushRenderBoundary,",
    "render,",
    "hasInteractionRenderContext: () => Boolean(rendererSurfaceHost.getContext())",
    "getRenderRequestBoundaryOwner().requestInteractionRenderBoundary(reason).completed;",
    "getRenderRequestBoundaryOwner().flushInteractionRenderBoundary(reason).completed;",
    "getRenderRequestBoundaryOwner().requestRendererRenderBoundary(reason, {",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P41 render request wrapper token: ${token}`);
    }
  }
  const renderRequestWrapperStart = renderer.indexOf("function requestInteractionRender");
  const renderRequestWrapperEnd = renderer.indexOf("function normalizeDevInteractionHit");
  const renderRequestWrapperSource = renderRequestWrapperStart >= 0 && renderRequestWrapperEnd > renderRequestWrapperStart
    ? renderer.slice(renderRequestWrapperStart, renderRequestWrapperEnd)
    : "";
  for (const token of [
    "const requested = flush ? flushRenderBoundary(reason) : requestRender(reason);",
    "if (rendererSurfaceHost.getContext()) render();",
  ]) {
    if (renderRequestWrapperSource.includes(token)) {
      failures.push(`${FILES.renderer} P41 wrapper must delegate old inline token: ${token}`);
    }
  }
  for (const token of [
    "\"test:node:renderer-render-request-boundary-owner\": \"node --test tests/renderer_render_request_boundary_owner_behavior.test.mjs\"",
    "\"test:node:renderer-render-request-boundary-inventory\": \"node --test tests/renderer_render_request_boundary_inventory.test.mjs\"",
    "\"test:node:renderer-render-request-boundary\": \"npm run test:node:renderer-render-request-boundary-owner && npm run test:node:renderer-render-request-boundary-inventory\"",
  ]) {
    if (!packageJson.includes(token)) {
      failures.push(`${FILES.packageJson} must expose P41 render request boundary script: ${token}`);
    }
  }
  for (const token of [
    "requestRendererRenderBoundary returns a frozen default request summary",
    "requestRendererRenderBoundary preserves fallback completion after request miss",
    "requestInteractionRenderBoundary keeps request then context render fallback order",
    "flushInteractionRenderBoundary uses flush boundary effect only",
    "createRenderRequestBoundaryOwner fails fast for missing dependencies",
    "render request boundary owner stays outside render lifecycle internals",
  ]) {
    if (!rendererRenderRequestBoundaryOwnerTest.includes(token)) {
      failures.push(`${FILES.rendererRenderRequestBoundaryOwnerTest} must cover P41 behavior token: ${token}`);
    }
  }
  for (const token of [
    "P41 render request boundary owner files and package scripts are registered",
    "P41 owner keeps the render request boundary narrow",
    "P41 map renderer only delegates existing request wrappers",
    "P41 keeps render lifecycle and public facade boundaries in place",
  ]) {
    if (!rendererRenderRequestBoundaryInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererRenderRequestBoundaryInventoryTest} must cover P41 inventory token: ${token}`);
    }
  }
  for (const heading of [
    "# Renderer Render Request Boundary Owner P41",
    "## Scope",
    "## Implementation Plan",
    "## Validation Plan",
    "## Delivery Package",
  ]) {
    if (!rendererRenderRequestBoundaryOwnerDoc.includes(heading)) {
      failures.push(`${FILES.rendererRenderRequestBoundaryOwnerDoc} must keep P41 heading: ${heading}`);
    }
  }
  for (const token of [
    "`render_request_boundary_owner.js` owns request/flush/fallback ordering only.",
    "`map_renderer.js` remains the composition root and keeps public wrapper names stable.",
    "`setRenderPhase()` and `scheduleRenderPhaseIdle()` stay in `map_renderer.js` for P41.",
    "`drawCanvas()`, `renderPassToCache()`, hit canvas, scenario refresh, exact scheduler, strategic owners, `public.js`, state-write allowlist, and `dist/app/**` stay out of scope.",
  ]) {
    if (!rendererRenderRequestBoundaryOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererRenderRequestBoundaryOwnerDoc} must lock P41 boundary token: ${token}`);
    }
  }

  if (!fs.existsSync(path.join(REPO_ROOT, FILES.visibleFrameDiagnosticsOwner))) {
    failures.push(`${FILES.visibleFrameDiagnosticsOwner} must exist for P42.`);
  }
  if (fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecycleOwner))) {
    failures.push("P42 must keep js/core/renderer/renderer_render_lifecycle_owner.js absent.");
  }
  for (const token of [
    "export function createVisibleFrameDiagnosticsOwner({",
    "const REQUIRED_EFFECT_NAMES = Object.freeze([",
    "const REQUIRED_GETTER_NAMES = Object.freeze([",
    "recordVisibleFrameTransaction",
    "recordFirstVisibleFrameBlocked",
    "markFirstVisibleFramePainted",
    "resetFirstVisibleFramePainted",
    "createSummary({",
    "effectOrder",
    "getterOrder",
    "counterOrder",
    "Object.freeze({",
  ]) {
    if (!visibleFrameDiagnosticsOwner.includes(token)) {
      failures.push(`${FILES.visibleFrameDiagnosticsOwner} must keep P42 owner token: ${token}`);
    }
  }
  for (const token of [
    "map_renderer.js",
    "runtimeState =",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
    "renderer_render_lifecycle_owner",
  ]) {
    if (visibleFrameDiagnosticsOwner.includes(token)) {
      failures.push(`${FILES.visibleFrameDiagnosticsOwner} must avoid P42 forbidden token: ${token}`);
    }
  }
  if (hasMapRendererImport(visibleFrameDiagnosticsOwner)) {
    failures.push(`${FILES.visibleFrameDiagnosticsOwner} must not import map_renderer.js.`);
  }
  for (const token of [
    "from \"./renderer/visible_frame_diagnostics_owner.js\";",
    "let visibleFrameDiagnosticsOwner = null;",
    "function getVisibleFrameDiagnosticsOwner()",
    "visibleFrameDiagnosticsOwner = createVisibleFrameDiagnosticsOwner({",
    "recordVisibleFrameTransactionDiagnostics: (payload) => recordVisibleFrameTransactionDiagnostics(runtimeState, payload)",
    "hasFirstVisibleFramePainted: () => Boolean(runtimeState.firstVisibleFramePainted)",
    "return getVisibleFrameDiagnosticsOwner().recordVisibleFrameTransaction(status, details).metricEntry;",
    "getVisibleFrameDiagnosticsOwner().recordFirstVisibleFrameBlocked(reason, blockReason);",
    "getVisibleFrameDiagnosticsOwner().markFirstVisibleFramePainted(reason);",
    "getVisibleFrameDiagnosticsOwner().resetFirstVisibleFramePainted(reason);",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P42 visible-frame diagnostics wrapper token: ${token}`);
    }
  }
  const visibleFrameWrapperStart = renderer.indexOf("function recordVisibleFrameTransactionMetric");
  const visibleFrameWrapperEnd = renderer.indexOf("function recordUiRefreshMetric");
  const visibleFrameWrapperSource = visibleFrameWrapperStart >= 0 && visibleFrameWrapperEnd > visibleFrameWrapperStart
    ? renderer.slice(visibleFrameWrapperStart, visibleFrameWrapperEnd)
    : "";
  if (!visibleFrameWrapperSource) {
    failures.push(`${FILES.renderer} must keep recordVisibleFrameTransactionMetric wrapper.`);
  }
  for (const token of [
    "incrementPerfCounter(\"visibleFrameTransactionCount\")",
    "if (normalizedStatus === \"committed\")",
    "recordVisibleFrameTransactionDiagnostics(runtimeState, {",
    "return recordRenderPerfMetric(\"visibleFrameTransaction\"",
  ]) {
    if (visibleFrameWrapperSource.includes(token)) {
      failures.push(`${FILES.renderer} P42 wrapper must delegate old inline token: ${token}`);
    }
  }
  for (const token of [
    "export function recordVisibleFrameTransactionDiagnostics",
    "function recordRenderTransactionIdentitySnapshot",
    "export function recordRenderTransactionSnapshot",
    "function detectSnapshotWarnings",
    "lastAcceptedFrameIdentity",
    "renderReuseAcrossDataGeneration",
    "visibleFrameStatus",
  ]) {
    if (!renderTransactionDiagnostics.includes(token)) {
      failures.push(`${FILES.renderTransactionDiagnostics} must keep P42 diagnostics token: ${token}`);
    }
  }
  const publicFacade = readProjectFile("js/core/map_renderer/public.js");
  if (publicFacade.includes("visible_frame_diagnostics_owner")) {
    failures.push("js/core/map_renderer/public.js must not expose P42 visible-frame diagnostics owner.");
  }
  for (const [relativePath, source] of [
    [FILES.scenarioRefreshRuntime, scenarioRefreshRuntime],
    [FILES.exactAfterSettleScheduler, exactAfterSettleScheduler],
  ]) {
    if (source.includes("visible_frame_diagnostics_owner")) {
      failures.push(`${relativePath} must not import P42 visible-frame diagnostics owner.`);
    }
  }
  if (stateWriteAllowlist.includes("visible_frame_diagnostics_owner")) {
    failures.push(`${FILES.stateWriteAllowlist} must not include P42 visible-frame diagnostics owner.`);
  }
  for (const token of [
    "\"test:node:visible-frame-diagnostics-owner\": \"node --test tests/visible_frame_diagnostics_owner_behavior.test.mjs\"",
    "\"test:node:visible-frame-diagnostics-inventory\": \"node --test tests/visible_frame_diagnostics_owner_inventory.test.mjs\"",
    "\"test:node:visible-frame-diagnostics\": \"npm run test:node:visible-frame-diagnostics-owner && npm run test:node:visible-frame-diagnostics-inventory\"",
  ]) {
    if (!packageJson.includes(token)) {
      failures.push(`${FILES.packageJson} must expose P42 visible-frame diagnostics script: ${token}`);
    }
  }
  for (const token of [
    "recordVisibleFrameTransaction preserves committed diagnostic and metric payload",
    "markFirstVisibleFramePainted records accepted payload once and keeps hook payload",
    "markFirstVisibleFramePainted records blocked payload without accepting the frame",
    "visible frame status counters preserve missing reused rejected and blocked buckets",
    "createVisibleFrameDiagnosticsOwner fails fast for missing dependencies",
    "visible frame diagnostics owner returns frozen summaries and stays outside render lifecycle internals",
  ]) {
    if (!visibleFrameDiagnosticsOwnerTest.includes(token)) {
      failures.push(`${FILES.visibleFrameDiagnosticsOwnerTest} must cover P42 behavior token: ${token}`);
    }
  }
  for (const token of [
    "P42 visible frame diagnostics owner files and package scripts are registered",
    "P42 owner owns diagnostics payload orchestration only",
    "map_renderer delegates visible frame diagnostics while keeping render lifecycle anchors",
    "render transaction diagnostics keeps visible frame snapshot ownership",
    "P42 keeps public facade scenario exact and state-write boundaries unchanged",
  ]) {
    if (!visibleFrameDiagnosticsInventoryTest.includes(token)) {
      failures.push(`${FILES.visibleFrameDiagnosticsInventoryTest} must cover P42 inventory token: ${token}`);
    }
  }
  for (const heading of [
    "# Renderer Visible Frame Diagnostics Owner P42",
    "## Scope",
    "## Implementation Plan",
    "## Validation Plan",
    "## Delivery Package",
  ]) {
    if (!visibleFrameDiagnosticsOwnerDoc.includes(heading)) {
      failures.push(`${FILES.visibleFrameDiagnosticsOwnerDoc} must keep P42 heading: ${heading}`);
    }
  }
  for (const token of [
    "`visible_frame_diagnostics_owner.js` owns visible-frame diagnostic payload and metric ordering only.",
    "`map_renderer.js` remains the composition root and keeps first-visible wrapper names stable.",
    "`drawCanvas()`, `renderPassToCache()`, hit canvas, scenario refresh, exact scheduler, strategic owners, `public.js`, and state-write allowlist stay out of scope; `dist/app/**` is the checked-in generated Pages mirror and must stay synchronized when P42 ships.",
    "Metric names, reason strings, paintSource values, blockReason values, and payload keys remain compatible with the pre-P42 wrappers.",
  ]) {
    if (!visibleFrameDiagnosticsOwnerDoc.includes(token)) {
      failures.push(`${FILES.visibleFrameDiagnosticsOwnerDoc} must lock P42 boundary token: ${token}`);
    }
  }

  if (!fs.existsSync(path.join(REPO_ROOT, FILES.renderPhaseLifecycleOwner))) {
    failures.push(`${FILES.renderPhaseLifecycleOwner} must exist for P43.`);
  }
  if (fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecycleOwner))) {
    failures.push("P43 must keep js/core/renderer/renderer_render_lifecycle_owner.js absent.");
  }
  for (const token of [
    "export function createRenderPhaseLifecycleOwner({",
    "const REQUIRED_EFFECT_NAMES = Object.freeze([",
    "const REQUIRED_GETTER_NAMES = Object.freeze([",
    "function clearRenderPhaseTimer(",
    "function setRenderPhase(",
    "function scheduleRenderPhaseIdle(",
    "function resetRenderPhaseState(",
    "getAdaptiveSettleProfile",
    "PROMOTION_ACTIVE_STATUSES",
    "createSummary({",
    "effectOrder",
    "getterOrder",
    "Object.freeze({",
  ]) {
    if (!renderPhaseLifecycleOwner.includes(token)) {
      failures.push(`${FILES.renderPhaseLifecycleOwner} must keep P43 owner token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "map_renderer.js",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
    "renderer_render_lifecycle_owner",
  ]) {
    if (renderPhaseLifecycleOwner.includes(token)) {
      failures.push(`${FILES.renderPhaseLifecycleOwner} must avoid P43 forbidden token: ${token}`);
    }
  }
  if (hasMapRendererImport(renderPhaseLifecycleOwner)) {
    failures.push(`${FILES.renderPhaseLifecycleOwner} must not import map_renderer.js.`);
  }
  for (const token of [
    "from \"./map_renderer/render_phase_lifecycle_owner.js\";",
    "let renderPhaseLifecycleOwner = null;",
    "function getRenderPhaseLifecycleOwner()",
    "renderPhaseLifecycleOwner = createRenderPhaseLifecycleOwner({",
    "getRenderPhase: () => runtimeState.renderPhase",
    "getRenderPhaseTimerId: () => runtimeState.renderPhaseTimerId",
    "hasPendingDayNightRefresh: () => Boolean(runtimeState.pendingDayNightRefresh)",
    "shouldStartExactAfterSettleFastPath",
    "clearTimeout: (timerId) => globalThis.clearTimeout(timerId)",
    "setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs)",
    "setRenderPhaseTimerId: (timerId) => {",
    "setRenderPhaseValue: (phase) => {",
    "setPhaseEnteredAt: (enteredAtMs) => {",
    "setIsInteracting: (isInteracting) => {",
    "cancelPoliticalPathWarmup",
    "setHoverOverlayDirty: (dirty) => {",
    "setPendingDayNightRefresh: (pending) => {",
    "invalidateRenderPasses",
    "updateDprStage",
    "setCanvasSize",
    "setAdaptiveSettleProfile: (settleProfile) => {",
    "scheduleScenarioChunkRefresh: (options) => (",
    "setDeferExactAfterSettle: (deferred) => {",
    "render,",
    "scheduleExactAfterSettleRefresh",
    "resetRenderPhaseState: () => getRenderPhaseLifecycleOwner().resetRenderPhaseState(\"init-map\")",
    "getRenderPhaseLifecycleOwner().clearRenderPhaseTimer();",
    "getRenderPhaseLifecycleOwner().setRenderPhase(phase);",
    "getRenderPhaseLifecycleOwner().scheduleRenderPhaseIdle();",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P43 render phase lifecycle wrapper token: ${token}`);
    }
  }
  const clearPhaseTimerWrapperSource = sliceBetween(
    renderer,
    "function clearRenderPhaseTimer()",
    "function clamp01",
  );
  const setRenderPhaseWrapperSource = sliceBetween(
    renderer,
    "function setRenderPhase(phase)",
    "function isInteractionRecoveryBlocked",
  );
  const scheduleRenderPhaseIdleWrapperSource = sliceBetween(
    renderer,
    "function scheduleRenderPhaseIdle()",
    "function flushPendingScenarioChunkRefreshAfterExact",
  );
  for (const [label, source, tokens] of [
    ["clearRenderPhaseTimer", clearPhaseTimerWrapperSource, [
      "globalThis.clearTimeout",
      "runtimeState.renderPhaseTimerId = null",
    ]],
    ["setRenderPhase", setRenderPhaseWrapperSource, [
      "runtimeState.renderPhase = phase",
      "runtimeState.phaseEnteredAt = nowMs()",
      "runtimeState.isInteracting = phase === RENDER_PHASE_INTERACTING",
      "cancelPoliticalPathWarmup(`phase-${phase}`)",
      "runtimeState.pendingDayNightRefresh = false",
    ]],
    ["scheduleRenderPhaseIdle", scheduleRenderPhaseIdleWrapperSource, [
      "runtimeState.adaptiveSettleProfile = settleProfile",
      "globalThis.setTimeout",
      "runtimeState.deferExactAfterSettle = true",
      "scheduleExactAfterSettleRefresh(settleProfile)",
    ]],
  ]) {
    if (!source) {
      failures.push(`${FILES.renderer} must keep ${label} wrapper for P43.`);
    }
    for (const token of tokens) {
      if (source.includes(token)) {
        failures.push(`${FILES.renderer} P43 ${label} wrapper must delegate old inline token: ${token}`);
      }
    }
  }
  for (const [relativePath, source] of [
    [FILES.scenarioRefreshRuntime, scenarioRefreshRuntime],
    [FILES.exactAfterSettleScheduler, exactAfterSettleScheduler],
    ["js/core/renderer/strategic_overlay_runtime_owner.js", readProjectFile("js/core/renderer/strategic_overlay_runtime_owner.js")],
  ]) {
    if (source.includes("render_phase_lifecycle_owner")) {
      failures.push(`${relativePath} must not import P43 render phase lifecycle owner.`);
    }
  }
  if (readProjectFile("js/core/map_renderer/public.js").includes("render_phase_lifecycle_owner")) {
    failures.push("js/core/map_renderer/public.js must not expose P43 render phase lifecycle owner.");
  }
  if (stateWriteAllowlist.includes("render_phase_lifecycle_owner")) {
    failures.push(`${FILES.stateWriteAllowlist} must not include P43 render phase lifecycle owner.`);
  }
  for (const token of [
    "\"test:node:renderer-render-phase-lifecycle-owner\": \"node --test tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs\"",
    "\"test:node:renderer-render-phase-lifecycle-inventory\": \"node --test tests/renderer_render_phase_lifecycle_inventory.test.mjs\"",
    "\"test:node:renderer-render-phase-lifecycle\": \"npm run test:node:renderer-render-phase-lifecycle-owner && npm run test:node:renderer-render-phase-lifecycle-inventory\"",
  ]) {
    if (!packageJson.includes(token)) {
      failures.push(`${FILES.packageJson} must expose P43 render phase lifecycle script: ${token}`);
    }
  }
  for (const token of [
    "clearRenderPhaseTimer clears an active timer handle and returns a frozen summary",
    "setRenderPhase enters interacting with exact write and effect order",
    "setRenderPhase enters idle and flushes pending day-night refresh",
    "scheduleRenderPhaseIdle clears old timer and stores a new adaptive timer",
    "scheduleRenderPhaseIdle callback starts exact fast path when quiet",
    "resetRenderPhaseState restores idle phase timer fields through injected effects",
    "createRenderPhaseLifecycleOwner fails fast for missing dependencies",
    "render phase lifecycle owner stays outside broad render internals",
  ]) {
    if (!rendererRenderPhaseLifecycleOwnerTest.includes(token)) {
      failures.push(`${FILES.rendererRenderPhaseLifecycleOwnerTest} must cover P43 behavior token: ${token}`);
    }
  }
  for (const token of [
    "P43 render phase lifecycle owner files and package scripts are registered",
    "P43 owner owns render phase and timer lifecycle only",
    "map_renderer delegates phase lifecycle wrappers while keeping render anchors",
    "P41 and P42 owners remain narrow after P43",
    "scenario exact strategic public facade and state-write boundaries stay unchanged",
    "P43 leaves dist app mirror untouched",
  ]) {
    if (!rendererRenderPhaseLifecycleInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererRenderPhaseLifecycleInventoryTest} must cover P43 inventory token: ${token}`);
    }
  }
  for (const heading of [
    "# Renderer Render Phase Lifecycle Owner P43",
    "## Scope",
    "## Implementation Plan",
    "## Validation Plan",
    "## Delivery Package",
  ]) {
    if (!rendererRenderPhaseLifecycleOwnerDoc.includes(heading)) {
      failures.push(`${FILES.rendererRenderPhaseLifecycleOwnerDoc} must keep P43 heading: ${heading}`);
    }
  }
  for (const token of [
    "`render_phase_lifecycle_owner.js` owns render phase value writes, phase-enter timestamps, phase timer clearing, phase idle scheduling, and reset phase state only.",
    "`map_renderer.js` remains the composition root and keeps `clearRenderPhaseTimer()`, `setRenderPhase()`, and `scheduleRenderPhaseIdle()` wrapper names stable.",
    "`drawCanvas()`, `renderPassToCache()`, hit canvas, scenario refresh runtime, exact-after-settle scheduler, strategic overlay runtime, `public.js`, state-write allowlist, and `dist/app/**` stay out of scope.",
    "P41 request boundary and P42 visible-frame diagnostics owners remain narrow and do not import P43.",
  ]) {
    if (!rendererRenderPhaseLifecycleOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererRenderPhaseLifecycleOwnerDoc} must lock P43 boundary token: ${token}`);
    }
  }

  for (const heading of [
    "## Objective",
    "## First Principles",
    "## P47 Acceptance Checklist",
    "## Architecture Checker Target State",
    "## Validation Owner",
  ]) {
    if (!rendererHitCanvasSchedulingOwnerDoc.includes(heading)) {
      failures.push(`${FILES.rendererHitCanvasSchedulingOwnerDoc} must keep P47 heading: ${heading}`);
    }
  }
  for (const token of [
    "Move only the hit canvas deferred scheduling and scheduled-handle cancellation lifecycle",
    "The only production extraction is the scheduling owner.",
    "The wrapper preserves the existing boolean behavior: it returns `false` after scheduling",
    "mode: \"deferred\"",
    "activeScenarioId: String(runtimeState.activeScenarioId || \"\")",
    "Replace the preflight rule that forbids all production `hit_canvas` files with a unique-owner rule",
    "Prefer behavior assertions and narrow owner-path assertions over broad brittle source-token counts.",
  ]) {
    if (!rendererHitCanvasSchedulingOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererHitCanvasSchedulingOwnerDoc} must lock P47 token: ${token}`);
    }
  }
  if (!rendererHitCanvasSchedulingPreflightDoc.includes("Recommended next implementation: hit canvas scheduling owner.")) {
    failures.push(`${FILES.rendererHitCanvasSchedulingPreflightDoc} must keep historical P47 handoff token.`);
  }
  for (const token of [
    "test(\"scheduled callback clears handle before drawing deferred hit canvas metric\"",
    "mode: \"deferred\"",
    "reason: \"custom-reason\"",
    "activeScenarioId: \"scenario-b\"",
    "test(\"cancel cancels an existing scheduled handle and clears it\"",
    "test(\"createHitCanvasSchedulingOwner fails fast for missing dependencies\"",
  ]) {
    if (!hitCanvasSchedulingOwnerTest.includes(token)) {
      failures.push(`${FILES.hitCanvasSchedulingOwnerTest} must cover P47 behavior token: ${token}`);
    }
  }
  for (const token of [
    "const OWNER_PATH = \"js/core/map_renderer/hit_canvas_scheduling_owner.js\";",
    "function gitDiffNames(paths)",
    "only the P47 production hit canvas scheduling owner exists",
    "public facade state allowlist and P47 owner dist mirror remain untouched",
    "getHitCanvasSchedulingOwner().scheduleHitCanvasBuildIfNeeded({ reason });",
    "getHitCanvasSchedulingOwner().cancelScheduledHitCanvasBuild({ reason: \"strict-validation\" });",
  ]) {
    if (!hitCanvasSchedulingOwnerInventoryTest.includes(token)) {
      failures.push(`${FILES.hitCanvasSchedulingOwnerInventoryTest} must lock P47 owner inventory token: ${token}`);
    }
  }
  for (const token of [
    "const DOC_PATH = \"docs/active/renderer-hit-canvas-scheduling-owner-p47-20260701.md\";",
    "only P47 production hit canvas scheduling owner and no broad render lifecycle owner exist",
    "schedule wrapper must keep old falsy contract",
    "scenario refresh runtime must keep injected hit canvas scheduling boundary",
    "package exposes the canonical P47 hit canvas scheduling suite",
  ]) {
    if (!rendererHitCanvasSchedulingInventoryTest.includes(token)) {
      failures.push(`${FILES.rendererHitCanvasSchedulingInventoryTest} must lock P47 scheduling inventory token: ${token}`);
    }
  }
  for (const token of [
    "\"test:node:hit-canvas-scheduling-owner\": \"node --test tests/hit_canvas_scheduling_owner_behavior.test.mjs\"",
    "\"test:node:hit-canvas-scheduling-owner-inventory\": \"node --test tests/hit_canvas_scheduling_owner_inventory.test.mjs\"",
    "\"test:node:hit-canvas-scheduling-owner-suite\": \"npm run test:node:hit-canvas-scheduling-owner && npm run test:node:hit-canvas-scheduling-owner-inventory && node --test tests/renderer_hit_canvas_scheduling_inventory_boundary.test.mjs\"",
  ]) {
    if (!packageJson.includes(token)) {
      failures.push(`${FILES.packageJson} must expose P47 hit canvas scheduling script: ${token}`);
    }
  }
  if (packageJson.includes("\"test:node:renderer-hit-canvas-scheduling-inventory\":")) {
    failures.push(`${FILES.packageJson} must keep the superseded P47 inventory alias retired.`);
  }
  if (fs.existsSync(path.join(REPO_ROOT, FILES.rendererRenderLifecycleOwner))) {
    failures.push("P47 must keep js/core/renderer/renderer_render_lifecycle_owner.js absent.");
  }
  const hitCanvasSourceFiles = listProjectSourceFiles("js/core")
    .filter((sourcePath) => /hit[_-]?canvas|hitCanvas/i.test(sourcePath))
    .sort();
  if (JSON.stringify(hitCanvasSourceFiles) !== JSON.stringify([FILES.hitCanvasSchedulingOwner])) {
    failures.push(`P47 must allow exactly one production hit canvas source: ${FILES.hitCanvasSchedulingOwner}; found ${hitCanvasSourceFiles.join(", ") || "(none)"}.`);
  }
  for (const sourcePath of listProjectSourceFiles("js/core")) {
    if (isForbiddenHitCanvasOwnerPath(sourcePath) && sourcePath !== FILES.hitCanvasSchedulingOwner) {
      failures.push(`P47 must not add extra production hit canvas owner/helper/controller/scheduler: ${sourcePath}`);
    }
  }
  for (const token of [
    "function drawHitCanvas()",
    "function drawHitCanvasWithMetric(details = {})",
    "function recordDeferredFullHitCanvasMetric({ reason = \"deferred-full\", keepReady = false } = {})",
    "async function buildHitCanvasAfterStartup({ keepReady = false, reason = \"startup-deferred-hit-canvas\" } = {})",
    "function scheduleHitCanvasBuildIfNeeded({ reason = \"idle-render\" } = {})",
    "function ensureHitCanvasUpToDate({ force = false } = {})",
    "function getDirtyHitCanvasPointProbeHit(event)",
    "function getValidatedCanvasHit(event, strictIds = null, { forceBuild = false } = {})",
    "function markRendererTopologyChanged({ hitCanvasDirty = false } = {})",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P47 hit canvas anchor: ${token}`);
    }
  }
  for (const token of [
    "import { createHitCanvasSchedulingOwner } from \"./map_renderer/hit_canvas_scheduling_owner.js\";",
    "let hitCanvasSchedulingOwner = null;",
    "function getHitCanvasSchedulingOwner()",
    "hasHitCanvasRuntime: () => Boolean(rendererSurfaceHost.getHitContext() && rendererSurfaceHost.getPathHitCanvas())",
    "isHitCanvasDirty: () => Boolean(runtimeState.hitCanvasDirty)",
    "isHitCanvasBuildDeferred: () => Boolean(runtimeState.deferHitCanvasBuild)",
    "getScheduledHitCanvasBuildHandle: () => runtimeState.hitCanvasBuildScheduled",
    "setScheduledHitCanvasBuildHandle: (handle) => {",
    "runScheduledHitCanvasBuild: (details) => drawScheduledHitCanvasWithMetric(details)",
    "function drawScheduledHitCanvasWithMetric(details = {})",
    "mode: \"deferred\"",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must wire P47 scheduling owner token: ${token}`);
    }
  }
  for (const token of [
    "export function createHitCanvasSchedulingOwner",
    "\"scheduleDeferredWork\"",
    "\"cancelDeferredWork\"",
    "\"setScheduledHitCanvasBuildHandle\"",
    "\"runScheduledHitCanvasBuild\"",
    "\"hasHitCanvasRuntime\"",
    "\"isHitCanvasDirty\"",
    "\"isHitCanvasBuildDeferred\"",
    "\"getRenderPhase\"",
    "\"getScheduledHitCanvasBuildHandle\"",
    "\"getActiveScenarioId\"",
    "mode: \"deferred\"",
    "activeScenarioId: String(getterApi.getActiveScenarioId() || \"\")",
  ]) {
    if (!hitCanvasSchedulingOwner.includes(token)) {
      failures.push(`${FILES.hitCanvasSchedulingOwner} must lock scheduling token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "rendererSurfaceHost",
    "drawHitCanvas",
    "drawHitCanvasWithMetric",
    "recordDeferredFullHitCanvasMetric",
    "buildHitCanvasAfterStartup",
    "getDirtyHitCanvasPointProbeHit",
    "hitCanvasTopologyRevision",
    "from \"../map_renderer.js\"",
    "from \"./map_renderer.js\"",
  ]) {
    if (hitCanvasSchedulingOwner.includes(token)) {
      failures.push(`${FILES.hitCanvasSchedulingOwner} must avoid renderer body token: ${token}`);
    }
  }
  const hitCanvasScheduleSource = sliceBetween(
    renderer,
    "function scheduleHitCanvasBuildIfNeeded({ reason = \"idle-render\" } = {})",
    "function ensureHitCanvasUpToDate({ force = false } = {})",
  );
  for (const token of [
    "getHitCanvasSchedulingOwner().scheduleHitCanvasBuildIfNeeded({ reason });",
    "return false;",
  ]) {
    if (!hitCanvasScheduleSource.includes(token)) {
      failures.push(`${FILES.renderer} schedule wrapper must keep P47 token: ${token}`);
    }
  }
  for (const token of [
    "scheduleDeferredWork(() =>",
    "drawHitCanvasWithMetric({",
    "runtimeState.hitCanvasBuildScheduled = scheduleDeferredWork",
  ]) {
    if (hitCanvasScheduleSource.includes(token)) {
      failures.push(`${FILES.renderer} schedule wrapper must not keep old scheduling body token: ${token}`);
    }
  }
  const hitCanvasForcedSource = sliceBetween(
    renderer,
    "function ensureHitCanvasUpToDate({ force = false } = {})",
    "function isHitCanvasCurrent()",
  );
  if (!hitCanvasForcedSource.includes("getHitCanvasSchedulingOwner().cancelScheduledHitCanvasBuild({ reason: \"strict-validation\" });")) {
    failures.push(`${FILES.renderer} forced validation must cancel hit canvas scheduling through owner.`);
  }
  const resetOwnerFactorySource = sliceBetween(
    renderer,
    "function getRendererTransactionResetOwner()",
    "function getMapHoverInteractionOwner()",
  );
  if (!resetOwnerFactorySource.includes("getHitCanvasSchedulingOwner().cancelScheduledHitCanvasBuild(options)")) {
    failures.push(`${FILES.renderer} reset path must route hit canvas scheduling cancellation through P47 owner.`);
  }
  if (!rendererTransactionResetOwner.includes("reason: REFRESH_RESET_REASON")) {
    failures.push(`${FILES.rendererTransactionResetOwner} reset path must preserve renderer-refresh-reset cancellation reason.`);
  }
  if (renderer.includes("cancelDeferredWork(runtimeState.hitCanvasBuildScheduled)")) {
    failures.push(`${FILES.renderer} must remove direct hit canvas scheduled-work cancellation after P47.`);
  }
  if (!scenarioRefreshRuntime.includes("setInteractionInfrastructureState, scheduleSecondarySpatialIndexBuild, scheduleHitCanvasBuildIfNeeded,")) {
    failures.push(`${FILES.scenarioRefreshRuntime} must keep scheduleHitCanvasBuildIfNeeded injected dependency.`);
  }
  if (countToken(scenarioRefreshRuntime, "scheduleHitCanvasBuildIfNeeded") !== 3) {
    failures.push(`${FILES.scenarioRefreshRuntime} must keep three scheduleHitCanvasBuildIfNeeded references.`);
  }
  if (countToken(scenarioRefreshRuntime, "runtimeState.hitCanvasTopologyRevision") !== 1) {
    failures.push(`${FILES.scenarioRefreshRuntime} must keep current single runtimeState.hitCanvasTopologyRevision reset.`);
  }
  if (hasHitCanvasOwnerImport(scenarioRefreshRuntime)) {
    failures.push(`${FILES.scenarioRefreshRuntime} must not import hit canvas modules.`);
  }
  for (const token of [
    "buildHitCanvasAfterStartup",
    "drawHitCanvas",
    "runtimeState.hitCanvasBuildScheduled",
  ]) {
    if (scenarioRefreshRuntime.includes(token)) {
      failures.push(`${FILES.scenarioRefreshRuntime} must avoid direct hit canvas build/scheduling ownership token: ${token}`);
    }
  }
  if (hasMapRendererImport(spatialIndexRuntimeOwner)) {
    failures.push(`${FILES.spatialIndexRuntimeOwner} must not import map_renderer.js.`);
  }
  if (countToken(spatialIndexRuntimeOwner, "state.hitCanvasDirty") !== 2) {
    failures.push(`${FILES.spatialIndexRuntimeOwner} must keep exactly two state.hitCanvasDirty markers.`);
  }
  for (const token of [
    "scheduleHitCanvasBuildIfNeeded",
    "buildHitCanvasAfterStartup",
    "drawHitCanvas",
    "hitCanvasBuildScheduled",
    "hit_canvas",
  ]) {
    if (spatialIndexRuntimeOwner.includes(token)) {
      failures.push(`${FILES.spatialIndexRuntimeOwner} must avoid hit canvas scheduling/build ownership token: ${token}`);
    }
  }
  for (const [relativePath, source] of [
    [FILES.interactionHitCandidates, interactionHitCandidates],
    [FILES.mapInteractionEventBindingOwner, mapInteractionEventBindingOwner],
  ]) {
    if (hasMapRendererImport(source)) {
      failures.push(`${relativePath} must not import map_renderer.js for hit canvas scheduling preflight.`);
    }
    if (hasHitCanvasOwnerImport(source)) {
      failures.push(`${relativePath} must not import hit canvas owner/helper/controller/scheduler.`);
    }
    for (const token of [
      "buildHitCanvasAfterStartup",
      "drawHitCanvas",
      "scheduleHitCanvasBuildIfNeeded",
      "hitCanvasBuildScheduled",
      "hitCanvasTopologyRevision",
    ]) {
      if (source.includes(token)) {
        failures.push(`${relativePath} must avoid hit canvas build/scheduling token: ${token}`);
      }
    }
  }
  for (const token of [
    "function collectSpatialGridCandidates",
    "function rankCandidates",
    "function findFirstContainingCandidate",
    "function toHitResult",
    "function shouldPreferWaterHit",
    "export {",
  ]) {
    if (!interactionHitCandidates.includes(token)) {
      failures.push(`${FILES.interactionHitCandidates} must keep pure hit-candidate export: ${token}`);
    }
  }
  if (interactionHitCandidates.includes("runtimeState")) {
    failures.push(`${FILES.interactionHitCandidates} must remain runtimeState-free.`);
  }
  for (const token of [
    "render,",
    "setMapData,",
    "initMap,",
    "RENDER_PASS_NAMES,",
    "from \"../map_renderer.js\";",
  ]) {
    if (!publicFacadeSource.includes(token)) {
      failures.push(`${FILES.publicFacade} must keep public facade token: ${token}`);
    }
  }
  for (const token of [
    "hit_canvas",
    "hitCanvasScheduling",
    "renderer_render_lifecycle_owner",
    "render_lifecycle_owner",
  ]) {
    if (publicFacadeSource.includes(token)) {
      failures.push(`${FILES.publicFacade} must not expose hit canvas scheduling preflight token: ${token}`);
    }
    if (stateWriteAllowlist.includes(token)) {
      failures.push(`${FILES.stateWriteAllowlist} must not add hit canvas scheduling preflight token: ${token}`);
    }
  }

  for (const heading of [
    "## Objective",
    "## First Principles",
    "## Allowed Write Set",
    "## Plan",
    "## Validation Results",
  ]) {
    if (!rendererMapHoverInteractionOwnerDoc.includes(heading)) {
      failures.push(`${FILES.rendererMapHoverInteractionOwnerDoc} must keep P48 heading: ${heading}`);
    }
  }
  for (const token of [
    "Move only the `handleMouseMove(event)` hover, tooltip, cursor, and hover-overlay orchestration",
    "Runtime writes remain in `map_renderer.js` through injected effects",
    "Existing P47 hit canvas scheduling owner",
    "click/double-click, selection/fill, brush/physical-intensity",
  ]) {
    if (!rendererMapHoverInteractionOwnerDoc.includes(token)) {
      failures.push(`${FILES.rendererMapHoverInteractionOwnerDoc} must lock P48 boundary token: ${token}`);
    }
  }
  for (const token of [
    "const OWNER_PATH = \"js/core/map_renderer/map_hover_interaction_owner.js\";",
    "handleMouseMove wrapper must delegate to P48 owner",
    "event binding owner must keep injected mousemove handler",
    "interaction hit candidates must avoid hover owner ownership",
    "public facade state-write allowlist owners scenario runtime exact scheduler and owner mirrors remain untouched",
    "package and architecture checker register P48 validation gates",
  ]) {
    if (!mapHoverInteractionOwnerInventoryTest.includes(token)) {
      failures.push(`${FILES.mapHoverInteractionOwnerInventoryTest} must lock P48 inventory token: ${token}`);
    }
  }
  for (const token of [
    "\"test:node:map-hover-interaction-owner\": \"node --test tests/map_hover_interaction_owner_behavior.test.mjs\"",
    "\"test:node:map-hover-interaction-inventory\": \"node --test tests/map_hover_interaction_owner_inventory.test.mjs\"",
    "\"test:node:map-hover-interaction\": \"npm run test:node:map-hover-interaction-owner && npm run test:node:map-hover-interaction-inventory\"",
  ]) {
    if (!packageJson.includes(token)) {
      failures.push(`${FILES.packageJson} must expose P48 map hover interaction script: ${token}`);
    }
  }
  for (const token of [
    "export function createMapHoverInteractionOwner",
    "\"getHitFromEvent\"",
    "function queueTooltipUpdate(",
    "function setMapInteractionCursor(",
    "function clearUnderlyingHoverForFacilityEntry(",
    "function handleMouseMove(event)",
    "eventType: \"hover\"",
    "\"facility-tooltip\"",
    "\"feature-tooltip\"",
  ]) {
    if (!mapHoverInteractionOwner.includes(token)) {
      failures.push(`${FILES.mapHoverInteractionOwner} must lock P48 hover orchestration token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "rendererSurfaceHost",
    "from \"../map_renderer.js\"",
    "from \"./map_renderer.js\"",
    "dispatchMapClick",
    "dispatchMapDoubleClick",
    "handleClick",
    "handleDoubleClick",
    "brushSession",
    "physicalIntensity",
    "drawHitCanvas",
    "buildHitCanvasAfterStartup",
    "scheduleHitCanvasBuildIfNeeded",
    "scenarioRefreshRuntime",
    "exactAfterSettle",
    "strategicOverlayRuntime",
  ]) {
    if (mapHoverInteractionOwner.includes(token)) {
      failures.push(`${FILES.mapHoverInteractionOwner} must avoid forbidden P48 migration token: ${token}`);
    }
  }
  for (const token of [
    "import { createMapHoverInteractionOwner } from \"./map_renderer/map_hover_interaction_owner.js\";",
    "let mapHoverInteractionOwner = null;",
    "function getMapHoverInteractionOwner()",
    "mapHoverInteractionOwner = createMapHoverInteractionOwner({",
  ]) {
    if (!renderer.includes(token)) {
      failures.push(`${FILES.renderer} must keep P48 injected boundary token: ${token}`);
    }
  }
  const hoverWrapperSource = sliceBetween(
    renderer,
    "function handleMouseMove(event) {",
    "function addRecentColor(color) {",
  );
  if (!hoverWrapperSource.includes("getMapHoverInteractionOwner().handleMouseMove(event);")) {
    failures.push(`${FILES.renderer} handleMouseMove wrapper must delegate to P48 owner.`);
  }
  for (const token of [
    "queueTooltipUpdate({",
    "setMapInteractionCursor(",
    "getHitFromEvent(event,",
    "runtimeState.hoveredId =",
    "hoveredFacilityEntry =",
    "inspectHgoRuntimePreviewFromEvent(event",
  ]) {
    if (hoverWrapperSource.includes(token)) {
      failures.push(`${FILES.renderer} handleMouseMove wrapper must not keep old P48 hover body token: ${token}`);
    }
  }
  if (!mapInteractionEventBindingOwner.includes("interactionRect.on(\"mousemove\", requireFunction(handlers, \"handleMouseMove\"));")) {
    failures.push(`${FILES.mapInteractionEventBindingOwner} must keep handleMouseMove injected through event binding owner.`);
  }
  if (mapInteractionEventBindingOwner.includes("map_hover_interaction_owner")) {
    failures.push(`${FILES.mapInteractionEventBindingOwner} must not import P48 hover owner.`);
  }
  for (const [relativePath, source] of [
    [FILES.interactionHitCandidates, interactionHitCandidates],
    [FILES.scenarioRefreshRuntime, scenarioRefreshRuntime],
    [FILES.exactAfterSettleScheduler, exactAfterSettleScheduler],
  ]) {
    if (source.includes("map_hover_interaction_owner") || source.includes("createMapHoverInteractionOwner")) {
      failures.push(`${relativePath} must not import or own P48 hover interaction owner.`);
    }
  }
  for (const token of ["map_hover_interaction_owner", "MapHoverInteraction"]) {
    if (publicFacadeSource.includes(token)) {
      failures.push(`${FILES.publicFacade} must not expose P48 hover owner token: ${token}`);
    }
    if (stateWriteAllowlist.includes(token)) {
      failures.push(`${FILES.stateWriteAllowlist} must not add P48 hover owner token: ${token}`);
    }
  }

  const requiredImports = [
    "./map_renderer/set_map_data_transaction_owner.js",
    "./map_renderer/render_request_boundary_owner.js",
    "./map_renderer/render_phase_lifecycle_owner.js",
    "./map_renderer/hit_canvas_scheduling_owner.js",
    "./map_renderer/map_hover_interaction_owner.js",
    "./renderer/visible_frame_diagnostics_owner.js",
    "./map_renderer/scenario_refresh_runtime.js",
    "./renderer/canvas_color_helpers.js",
    "./map_renderer/exact_after_settle_scheduler.js",
    "./map_renderer/hgo_runtime_preview_render_owner.js",
    "./renderer/renderer_surface_lifecycle_owner.js",
    "./renderer/renderer_projection_path_owner.js",
    "./renderer/renderer_svg_surface_lifecycle_owner.js",
    "./renderer/renderer_fit_projection_owner.js",
    "./renderer/renderer_viewport_update_owner.js",
    "./renderer/renderer_startup_transaction_owner.js",
  ];
  for (const importPath of requiredImports) {
    if (!includesImport(renderer, importPath)) {
      failures.push(`${FILES.renderer} must import ${importPath}.`);
    }
  }

  const ownerFiles = [
    FILES.scenarioRefreshRuntime,
    FILES.canvasColorHelpers,
    FILES.scenarioVisualInvalidationExecutor,
    FILES.renderPhaseLifecycleOwner,
    FILES.hitCanvasSchedulingOwner,
    FILES.exactAfterSettleScheduler,
    FILES.exactAfterSettleRefreshPlans,
    FILES.exactAfterSettlePassCatalog,
    FILES.hgoPreviewRenderOwner,
    FILES.renderCacheOwner,
    FILES.renderTransformReusePolicyOwner,
    FILES.projectedGeometryBoundsOwner,
    FILES.viewportReadModelOwner,
    FILES.viewportCommandOwner,
    FILES.rendererViewportUpdateOwner,
    FILES.rendererStartupTransactionOwner,
    FILES.viewportResizeLifecycleOwner,
    FILES.zoomInteractionLifecycleOwner,
    FILES.mapInteractionEventBindingOwner,
    FILES.rendererSurfaceHost,
    FILES.rendererSurfaceLifecycleOwner,
    FILES.rendererProjectionPathOwner,
    FILES.rendererSvgSurfaceLifecycleOwner,
    FILES.scenarioWaterCachePolicyOwner,
    FILES.renderPipelinePasses,
    FILES.renderPipelineCatalog,
    FILES.renderPassCatalog,
    FILES.renderInvalidationCatalog,
  ];
  for (const ownerPath of ownerFiles) {
    const source = sources[ownerPath];
    if (/from\s+["'][^"']*map_renderer\.js["']/.test(source)) {
      failures.push(`${ownerPath} must not import js/core/map_renderer.js.`);
    }
  }

  for (const forbiddenImport of [
    "scenario_refresh_runtime.js",
    "exact_after_settle_scheduler.js",
  ]) {
    if (scenarioVisualInvalidationExecutor.includes(forbiddenImport)) {
      failures.push(`${FILES.scenarioVisualInvalidationExecutor} must not import ${forbiddenImport}.`);
    }
  }

  if (!scenarioVisualInvalidationExecutor.includes("function createScenarioVisualInvalidationExecutor(deps = {})")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must own createScenarioVisualInvalidationExecutor.`);
  }
  if (!scenarioVisualInvalidationExecutor.includes("function getRequiredRendererEffect(deps, name)")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must fail fast when renderer effects are missing.`);
  }
  if (scenarioVisualInvalidationExecutor.includes("function noop()") || scenarioVisualInvalidationExecutor.includes("= noop")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must not silently noop renderer side effects.`);
  }
  if (!scenarioVisualInvalidationExecutor.includes("function executeScenarioVisualInvalidation({")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must own executeScenarioVisualInvalidation.`);
  }
  if (!scenarioVisualInvalidationExecutor.includes("from \"./render_invalidation_catalog.js\";")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must import render invalidation catalog.`);
  }
  if (!scenarioVisualInvalidationExecutor.includes("UNSUPPORTED_RENDER_PASS_INPUT_KEYS")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must use UNSUPPORTED_RENDER_PASS_INPUT_KEYS from the catalog.`);
  }
  if (scenarioVisualInvalidationExecutor.includes("const RETIRED_VISUAL_INVALIDATION_PASS_INPUT_KEYS = Object.freeze([")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must not locally define retired visual invalidation pass inputs.`);
  }
  const renderCacheOwnerFactorySource = sliceBetween(
    renderer,
    "function getRenderCacheOwner() {",
    "function getCachedPassCompositorOwner() {",
  );
  if (renderCacheOwnerFactorySource.includes("invalidateInteractionComposite,")) {
    failures.push(`${FILES.renderer} must not inject invalidateInteractionComposite into the render cache owner.`);
  }
  if (renderCacheOwner.includes("invalidateInteractionComposite = () => {}")) {
    failures.push(`${FILES.renderCacheOwner} must not keep an injected invalidateInteractionComposite helper fallback.`);
  }
  if (!scenarioVisualInvalidationExecutor.includes("findRetiredVisualInvalidationPassInputKey(executionPlan)")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must reject retired execution-plan pass inputs through one retired-key check.`);
  }
  if (/function executeScenarioVisualInvalidation\([\s\S]*?\btargetPasses\s*=/.test(scenarioVisualInvalidationExecutor)) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must not accept top-level targetPasses.`);
  }
  if (scenarioVisualInvalidationExecutor.includes("const legacyTargetPasses =")) {
    failures.push(`${FILES.scenarioVisualInvalidationExecutor} must route fallback pass lists through the execution plan bridge.`);
  }
  if (!scenarioRefreshRuntime.includes("createScenarioVisualInvalidationExecutor({")) {
    failures.push(`${FILES.scenarioRefreshRuntime} must create the scenario visual invalidation executor.`);
  }
  if (!scenarioRefreshRuntime.includes("scenarioVisualInvalidationExecutor.executeScenarioVisualInvalidation({")) {
    failures.push(`${FILES.scenarioRefreshRuntime} chunk promotion visual invalidation must call the executor.`);
  }
  if (scenarioRefreshRuntime.includes("const invalidationTargetPasses = targetPasses.length")) {
    failures.push(`${FILES.scenarioRefreshRuntime} must get invalidationTargetPasses from the FrameGraph execution bridge.`);
  }
  const chunkPromotionRuntimeSource = sliceBetween(
    scenarioRefreshRuntime,
    "function refreshMapDataForScenarioChunkPromotion(",
    "function refreshMapDataForScenarioApply(",
  );
  if (/executionPlan:\s*\{[^}]*\btargetPasses\s*[,}:]/.test(chunkPromotionRuntimeSource)) {
    failures.push(`${FILES.scenarioRefreshRuntime} must not pass retired targetPasses through the visual invalidation execution plan.`);
  }
  if (!scenarioRefreshPlans.includes("function resolveFrameGraphInvalidationExecutionPlan(")) {
    failures.push(`${FILES.scenarioRefreshPlans} must own resolveFrameGraphInvalidationExecutionPlan.`);
  }
  const frameGraphFactoryStart = scenarioRefreshPlans.indexOf("function createFrameGraphInvalidation(");
  const frameGraphBridgeStart = scenarioRefreshPlans.indexOf("function getFrameGraphInvalidationTargetPasses(", frameGraphFactoryStart);
  if (frameGraphFactoryStart < 0 || frameGraphBridgeStart < 0) {
    failures.push(`${FILES.scenarioRefreshPlans} must keep createFrameGraphInvalidation next to the FrameGraph execution bridge.`);
  } else if (/legacyTargetPasses|targetPasses\s*=|targetPasses:|getTargetResourcesForPasses\(targetPasses\)/.test(scenarioRefreshPlans.slice(frameGraphFactoryStart, frameGraphBridgeStart))) {
    failures.push(`${FILES.scenarioRefreshPlans} FrameGraph invalidation descriptors must not accept or expose pass fields.`);
  }
  const exportBlock = scenarioRefreshPlans.slice(scenarioRefreshPlans.indexOf("export {"));
  if (exportBlock.includes("getFrameGraphInvalidationTargetPasses,")) {
    failures.push(`${FILES.scenarioRefreshPlans} must keep getFrameGraphInvalidationTargetPasses inside the bridge.`);
  }
  const frameGraphExecutionPlanSource = sliceBetween(
    scenarioRefreshPlans,
    "function resolveFrameGraphInvalidationExecutionPlan(",
    "function createScenarioApplyRefreshPlan(",
  );
  if (/\btargetPasses\s*[,}:]/.test(frameGraphExecutionPlanSource)) {
    failures.push(`${FILES.scenarioRefreshPlans} execution plans must expose invalidationTargetPasses instead of targetPasses.`);
  }
  if (!scenarioRefreshPlans.includes("from \"./render_invalidation_catalog.js\";")) {
    failures.push(`${FILES.scenarioRefreshPlans} must import render invalidation catalog.`);
  }
  for (const token of [
    "const PASS_RESOURCE_MAP = Object.freeze({",
    "const RESOURCE_PASS_MAP = Object.freeze(",
    "const FIRST_FRAME_BASE_TARGET_RESOURCES = Object.freeze([",
    "const FIRST_FRAME_HGO_TARGET_RESOURCES = Object.freeze([",
    "const UNSUPPORTED_FRAME_GRAPH_INVALIDATION_INPUT_KEYS = Object.freeze([",
    "function getTargetResourcesForPasses(",
    "function getTargetPassesForResources(",
    "function hasAnyTargetResource(",
    "function getFirstFrameTargetResources(",
    "function resolveFirstFrameTargetResources(",
  ]) {
    if (scenarioRefreshPlans.includes(token)) {
      failures.push(`${FILES.scenarioRefreshPlans} must not own extracted render invalidation catalog token: ${token}`);
    }
  }
  for (const token of [
    "const DEFAULT_RENDER_INVALIDATION_PASSES =",
    "const RETIRED_VISUAL_INVALIDATION_PASS_INPUT_KEYS = Object.freeze([",
  ]) {
    if (scenarioVisualInvalidationExecutor.includes(token)) {
      failures.push(`${FILES.scenarioVisualInvalidationExecutor} must not own extracted render invalidation catalog token: ${token}`);
    }
  }
  if (!exactAfterSettleRefreshPlans.includes("from \"../renderer/exact_after_settle_pass_catalog.js\";")) {
    failures.push(`${FILES.exactAfterSettleRefreshPlans} must import exact-after-settle pass catalog.`);
  }
  if (!renderPipelinePasses.includes("from \"./exact_after_settle_pass_catalog.js\";")) {
    failures.push(`${FILES.renderPipelinePasses} must import exact-after-settle pass catalog.`);
  }
  if (renderer.includes("EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES")) {
    failures.push(`${FILES.renderer} must not import or bridge EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES.`);
  }
  if (renderer.includes("exactAfterSettleDeferredPassNames: EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES")) {
    failures.push(`${FILES.renderer} must not inject exactAfterSettleDeferredPassNames from the host shell.`);
  }
  const exactFastPathRequiredPassListSource = sliceBetween(
    renderTransformReusePolicyOwner,
    "const EXACT_AFTER_SETTLE_FAST_PATH_REQUIRED_PASS_NAMES = Object.freeze([",
    "]);",
  );
  const exactFastPathRequiredPassNames = [
    "background",
    "physicalBase",
    "political",
    "contextBase",
    "contextScenario",
    "effects",
    "lineEffects",
    "contextMarkers",
    "dayNight",
    "textureLabels",
  ];
  const exactFastPathDeclaredPassNames = Array.from(
    exactFastPathRequiredPassListSource.matchAll(/"([^"]+)"/g),
    (match) => match[1],
  );
  if (JSON.stringify(exactFastPathDeclaredPassNames) !== JSON.stringify(exactFastPathRequiredPassNames)) {
    failures.push(`${FILES.renderTransformReusePolicyOwner} exact fast-path list must exactly match the required pass order.`);
  }
  for (const passName of exactFastPathRequiredPassNames) {
    if (!exactFastPathRequiredPassListSource.includes(`"${passName}"`)) {
      failures.push(`${FILES.renderTransformReusePolicyOwner} exact fast-path list must include ${passName}.`);
    }
  }
  for (const passName of ["borders", "labels", "hgoPreview"]) {
    if (exactFastPathRequiredPassListSource.includes(`"${passName}"`)) {
      failures.push(`${FILES.renderTransformReusePolicyOwner} exact fast-path list must not include ${passName}.`);
    }
  }
  for (const token of [
    "document.",
    "window.",
    "globalThis.d3",
    "requestAnimationFrame(",
    ".getContext(",
    "projection.",
    "zoomBehavior",
  ]) {
    if (renderTransformReusePolicyOwner.includes(token)) {
      failures.push(`${FILES.renderTransformReusePolicyOwner} must not touch renderer lifecycle token: ${token}`);
    }
  }
  if (/runtimeState\s*\./.test(renderTransformReusePolicyOwner)) {
    failures.push(`${FILES.renderTransformReusePolicyOwner} must not write or read runtimeState directly.`);
  }
  for (const token of [
    "runtimeState",
    "state.",
    "globalThis.d3",
    "Path2D",
    "document.",
    "window.",
    "requestAnimationFrame(",
    ".getContext(",
    "drawCanvas",
    "renderPassToCache",
    "zoomBehavior",
  ]) {
    if (projectedGeometryBoundsOwner.includes(token)) {
      failures.push(`${FILES.projectedGeometryBoundsOwner} must not touch renderer lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "zoomBehavior",
    "interactionRect",
    ".call(zoomBehavior",
    "runtimeState",
    "document.",
  ]) {
    if (viewportReadModelOwner.includes(token)) {
      failures.push(`${FILES.viewportReadModelOwner} must not touch renderer lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "../map_renderer.js",
    "./map_renderer.js",
    "runtimeState",
    "drawCanvas",
    "handleResize",
    "initZoom",
    "fitProjection",
    "setCanvasSize",
    "renderPassToCache",
  ]) {
    if (viewportCommandOwner.includes(token)) {
      failures.push(`${FILES.viewportCommandOwner} must not touch renderer lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "../map_renderer.js",
    "./map_renderer.js",
    "runtimeState",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "setMapData",
    "fitProjection",
    "exactAfterSettle",
    "refreshMapDataForScenarioChunkPromotion",
    "strategicOverlayRuntime",
    "applyDevSelectionFill",
  ]) {
    if (rendererViewportUpdateOwner.includes(token)) {
      failures.push(`${FILES.rendererViewportUpdateOwner} must not touch renderer lifecycle token: ${token}`);
    }
  }
  const viewportUpdateWrapperSource = sliceBetween(
    renderer,
    "function updateMap(transform)",
    "function getProjectedHgoRuntimePreviewBounds()",
  );
  const zoomInteractionLifecycleFactorySource = sliceBetween(
    renderer,
    "function getZoomInteractionLifecycleOwner()",
    "function getMapInteractionEventBindingOwner()",
  );
  if (!viewportUpdateWrapperSource.includes("return getRendererViewportUpdateOwner().updateMap(transform);")) {
    failures.push(`${FILES.renderer} updateMap wrapper must delegate to ${FILES.rendererViewportUpdateOwner}.`);
  }
  if (!zoomInteractionLifecycleFactorySource.includes("updateMap,")) {
    failures.push(`${FILES.renderer} zoom interaction lifecycle must keep updateMap injected as an effect.`);
  }
  if (!zoomInteractionLifecycleOwner.includes("const updateMap = requireFunction(effects, \"updateMap\", \"effects\");")) {
    failures.push(`${FILES.zoomInteractionLifecycleOwner} must require updateMap as a runtime effect.`);
  }
  if (zoomInteractionLifecycleOwner.includes("effects.updateMap?.(")) {
    failures.push(`${FILES.zoomInteractionLifecycleOwner} must call required updateMap directly.`);
  }
  for (const token of [
    "renderPhysicalIntensityBrushPreview();",
    "getStrategicOverlayRenderOwner().syncUnitCounterScalesDuringZoom();",
    "syncSpecialZonePatternTransformDuringZoom();",
    "drawCanvas();",
  ]) {
    if (viewportUpdateWrapperSource.includes(token)) {
      failures.push(`${FILES.renderer} updateMap wrapper must not keep raw viewport update token: ${token}`);
    }
  }
  for (const token of [
    "../map_renderer.js",
    "./map_renderer.js",
    "runtimeState",
    "drawCanvas",
    "initZoom",
    "renderPassToCache",
    "createElement(",
    "appendChild(",
    ".getContext(",
    "mapCanvas",
    "mapSvg",
    "projection.",
  ]) {
    if (viewportResizeLifecycleOwner.includes(token)) {
      failures.push(`${FILES.viewportResizeLifecycleOwner} must not touch renderer lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "../map_renderer.js",
    "./map_renderer.js",
    "runtimeState",
    "document.",
    "zoomBehavior",
    "drawScenarioRegionOverlaysPass",
    "context.",
  ]) {
    if (scenarioWaterCachePolicyOwner.includes(token)) {
      failures.push(`${FILES.scenarioWaterCachePolicyOwner} must not touch renderer lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "../map_renderer.js",
    "./map_renderer.js",
    "runtimeState",
    "drawCanvas",
    "renderPassToCache",
    "handleResize",
    "fitProjection",
    "setCanvasSize",
    "canvas",
    "svg",
    "projection",
    "path",
    "document.",
  ]) {
    if (zoomInteractionLifecycleOwner.includes(token)) {
      failures.push(`${FILES.zoomInteractionLifecycleOwner} must not touch renderer lifecycle token: ${token}`);
    }
  }
  for (const token of [
    "runtimeState",
    "selectedColor",
    "applyDevSelectionFill",
    "drawCanvas",
    "document.",
  ]) {
    if (mapInteractionEventBindingOwner.includes(token)) {
      failures.push(`${FILES.mapInteractionEventBindingOwner} must not touch renderer behavior token: ${token}`);
    }
  }
  for (const token of [
    "const EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES = new Set([",
    "const EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES = [",
    "function getExactAfterSettleDprRestorePasses(",
    "export function getExactAfterSettleDprRestorePasses(",
  ]) {
    if (exactAfterSettleRefreshPlans.includes(token)) {
      failures.push(`${FILES.exactAfterSettleRefreshPlans} must not own extracted exact-after-settle pass policy token: ${token}`);
    }
  }

  const ownershipRules = [
    {
      ownerPath: FILES.renderRequestBoundaryOwner,
      ownerTokens: [
        "export function createRenderRequestBoundaryOwner({",
        "function requestRendererRenderBoundary(",
        "function requestInteractionRenderBoundary(",
        "function flushInteractionRenderBoundary(",
        "effectOrder.push(requestEffectName);",
        "fallback();",
        "effectApi.flushRenderBoundary(normalizedReason)",
      ],
      rendererRequiredTokens: [
        "from \"./map_renderer/render_request_boundary_owner.js\";",
        "let renderRequestBoundaryOwner = null;",
        "function getRenderRequestBoundaryOwner()",
        "renderRequestBoundaryOwner = createRenderRequestBoundaryOwner({",
        "requestRender,",
        "flushRenderBoundary,",
        "render,",
        "hasInteractionRenderContext: () => Boolean(rendererSurfaceHost.getContext())",
        "getRenderRequestBoundaryOwner().requestInteractionRenderBoundary(reason).completed;",
        "getRenderRequestBoundaryOwner().flushInteractionRenderBoundary(reason).completed;",
        "getRenderRequestBoundaryOwner().requestRendererRenderBoundary(reason, {",
      ],
    },
    {
      ownerPath: FILES.renderPhaseLifecycleOwner,
      ownerTokens: [
        "export function createRenderPhaseLifecycleOwner({",
        "function clearRenderPhaseTimer(",
        "function setRenderPhase(",
        "function scheduleRenderPhaseIdle(",
        "function resetRenderPhaseState(",
        "clearRenderPhaseTimerCore(trace)",
        "setRenderPhase(renderPhaseIdle",
        "scheduleExactAfterSettleRefresh",
      ],
      rendererRequiredTokens: [
        "from \"./map_renderer/render_phase_lifecycle_owner.js\";",
        "let renderPhaseLifecycleOwner = null;",
        "function getRenderPhaseLifecycleOwner()",
        "renderPhaseLifecycleOwner = createRenderPhaseLifecycleOwner({",
        "setRenderPhaseTimerId: (timerId) => {",
        "setRenderPhaseValue: (phase) => {",
        "setPhaseEnteredAt: (enteredAtMs) => {",
        "setIsInteracting: (isInteracting) => {",
        "cancelPoliticalPathWarmup",
        "setHoverOverlayDirty: (dirty) => {",
        "setPendingDayNightRefresh: (pending) => {",
        "invalidateRenderPasses",
        "updateDprStage",
        "setCanvasSize",
        "setAdaptiveSettleProfile: (settleProfile) => {",
        "getRenderPhaseLifecycleOwner().clearRenderPhaseTimer();",
        "getRenderPhaseLifecycleOwner().setRenderPhase(phase);",
        "getRenderPhaseLifecycleOwner().scheduleRenderPhaseIdle();",
      ],
    },
    {
      ownerPath: FILES.visibleFrameDiagnosticsOwner,
      ownerTokens: [
        "export function createVisibleFrameDiagnosticsOwner({",
        "function recordVisibleFrameTransaction(",
        "function recordFirstVisibleFrameBlocked(",
        "function markFirstVisibleFramePainted(",
        "function resetFirstVisibleFramePainted(",
        "counterOrder",
        "recordVisibleFrameTransactionCore(",
      ],
      rendererRequiredTokens: [
        "from \"./renderer/visible_frame_diagnostics_owner.js\";",
        "let visibleFrameDiagnosticsOwner = null;",
        "function getVisibleFrameDiagnosticsOwner()",
        "visibleFrameDiagnosticsOwner = createVisibleFrameDiagnosticsOwner({",
        "return getVisibleFrameDiagnosticsOwner().recordVisibleFrameTransaction(status, details).metricEntry;",
      ],
    },
    {
      ownerPath: FILES.rendererSurfaceLifecycleOwner,
      ownerTokens: [
        "export function createRendererSurfaceLifecycleOwner({",
        "function resolveDomHandles({",
        "function ensureCanvasLayerHandles({",
        "function ensureHitCanvasHandle()",
        "function acquireCanvasContexts()",
        "createHitCanvasElement",
        "ensureCanvasLayers",
        "getCanvasLayer",
        "CANVAS_LAYER_NAMES",
      ],
      rendererRequiredTokens: [
        "from \"./renderer/renderer_surface_lifecycle_owner.js\";",
        "let rendererSurfaceLifecycleOwner = null;",
        "function getRendererSurfaceLifecycleOwner()",
        "createRendererSurfaceLifecycleOwner({",
        "surfaceHost: rendererSurfaceHost",
        "getDocument: () => document",
        "createHitCanvasElement,",
        "CANVAS_LAYER_NAMES,",
        "ensureCanvasLayers,",
        "getCanvasLayer,",
        "getRendererSurfaceLifecycleOwner().resolveDomHandles({ containerId });",
        "getRendererSurfaceLifecycleOwner().ensureCanvasLayerHandles({",
        "getRendererSurfaceLifecycleOwner().ensureHitCanvasHandle();",
        "getRendererSurfaceLifecycleOwner().acquireCanvasContexts();",
      ],
      rendererForbiddenTokens: [
        "rendererSurfaceHost.setMapContainer(document.getElementById(containerId))",
        "rendererSurfaceHost.setTooltip(document.getElementById(\"tooltip\"))",
        "rendererSurfaceHost.setCanvasLayers(ensureCanvasLayers(rendererSurfaceHost.getMapContainer(), {",
        "rendererSurfaceHost.setMapCanvas(getCanvasLayer(nextCanvasLayers, CANVAS_LAYER_NAMES.composite)?.canvas || null);",
        "rendererSurfaceHost.setPoliticalPatchCanvas(getCanvasLayer(nextCanvasLayers, CANVAS_LAYER_NAMES.politicalPatch)?.canvas || null);",
        "rendererSurfaceHost.setInteractionOverlayCanvas(getCanvasLayer(nextCanvasLayers, CANVAS_LAYER_NAMES.interactionOverlay)?.canvas || null);",
        "rendererSurfaceHost.setContext(rendererSurfaceHost.getMapCanvas().getContext(\"2d\"))",
        "rendererSurfaceHost.setHitContext(rendererSurfaceHost.getHitCanvas().getContext(\"2d\", { willReadFrequently: true }))",
      ],
    },
    {
      ownerPath: FILES.rendererProjectionPathOwner,
      ownerTokens: [
        "export function createRendererProjectionPathOwner({",
        "function initializeProjectionPaths()",
        "const getD3 = requireFunction(getters, \"getD3\", \"getters\");",
        "getContext: requireFunction(host, \"getContext\", \"surfaceHost\")",
        "getHitContext: requireFunction(host, \"getHitContext\", \"surfaceHost\")",
        "setProjection: requireFunction(host, \"setProjection\", \"surfaceHost\")",
        "setPathSvg: requireFunction(host, \"setPathSvg\", \"surfaceHost\")",
        "setPathCanvas: requireFunction(host, \"setPathCanvas\", \"surfaceHost\")",
        "setPathHitCanvas: requireFunction(host, \"setPathHitCanvas\", \"surfaceHost\")",
        "const nextProjection = hostApi.setProjection(projection);",
        "requireFunction(nextProjection, \"clipExtent\", \"surfaceHost.setProjection(projection)\")(null);",
      ],
      rendererRequiredTokens: [
        "from \"./renderer/renderer_projection_path_owner.js\";",
        "let rendererProjectionPathOwner = null;",
        "function getRendererProjectionPathOwner()",
        "createRendererProjectionPathOwner({",
        "surfaceHost: rendererSurfaceHost",
        "getD3: () => globalThis.d3",
        "projectionPrecision: PROJECTION_PRECISION",
        "pathPointRadius: PATH_POINT_RADIUS",
        "getRendererProjectionPathOwner().initializeProjectionPaths();",
      ],
      rendererForbiddenTokens: [
        "const nextProjection = rendererSurfaceHost.setProjection(globalThis.d3.geoEqualEarth().precision(PROJECTION_PRECISION));",
        "nextProjection.clipExtent(null);",
        "rendererSurfaceHost.setPathSvg(globalThis.d3.geoPath(nextProjection).pointRadius(PATH_POINT_RADIUS));",
        "rendererSurfaceHost.setPathCanvas(globalThis.d3.geoPath(nextProjection, rendererSurfaceHost.getContext()).pointRadius(PATH_POINT_RADIUS));",
        "rendererSurfaceHost.setPathHitCanvas(globalThis.d3.geoPath(nextProjection, rendererSurfaceHost.getHitContext()).pointRadius(PATH_POINT_RADIUS));",
      ],
    },
    {
      ownerPath: FILES.rendererSvgSurfaceLifecycleOwner,
      ownerTokens: [
        "export function createRendererSvgSurfaceLifecycleOwner({",
        "function ensureSvgSurface()",
        "const getD3 = requireFunction(getters, \"getD3\", \"getters\");",
        "getMapContainer: requireFunction(host, \"getMapContainer\", \"surfaceHost\")",
        "setMapSvg: requireFunction(host, \"setMapSvg\", \"surfaceHost\")",
        "setViewportGroup: requireFunction(host, \"setViewportGroup\", \"surfaceHost\")",
        "setStrategicDefs: requireFunction(host, \"setStrategicDefs\", \"surfaceHost\")",
        "setInteractionRect: requireFunction(host, \"setInteractionRect\", \"surfaceHost\")",
        "mapContainer.querySelector(\"#map-svg\")",
        "selectOrAppend(svg, \"g.viewport-layer\", \"g\", \"viewport-layer\")",
        "selectOrAppend(svg, \"defs.strategic-overlay-defs\", \"defs\", \"strategic-overlay-defs\")",
        "selectOrAppend(svg, \"g.intensity-field-preview-layer\", \"g\", \"intensity-field-preview-layer\")",
        "svg.select(\"rect.interaction-layer\")",
        ".attr(\"fill\", \"transparent\")",
        ".lower();",
      ],
      rendererRequiredTokens: [
        "from \"./renderer/renderer_svg_surface_lifecycle_owner.js\";",
        "let rendererSvgSurfaceLifecycleOwner = null;",
        "function getRendererSvgSurfaceLifecycleOwner()",
        "createRendererSvgSurfaceLifecycleOwner({",
        "surfaceHost: rendererSurfaceHost",
        "getD3: () => globalThis.d3",
        "createSvgElement,",
        "getRendererSvgSurfaceLifecycleOwner().ensureSvgSurface();",
      ],
      rendererForbiddenTokens: [
        "let nextMapSvg = rendererSurfaceHost.getMapContainer().querySelector(\"#map-svg\");",
        "nextMapSvg = createSvgElement();",
        "rendererSurfaceHost.getMapContainer().appendChild(nextMapSvg);",
        "rendererSurfaceHost.setMapSvg(nextMapSvg);",
        "let nextViewportGroup = svg.select(\"g.viewport-layer\");",
        "rendererSurfaceHost.setViewportGroup(nextViewportGroup);",
        "let nextStrategicDefs = svg.select(\"defs.strategic-overlay-defs\");",
        "rendererSurfaceHost.setStrategicDefs(nextStrategicDefs);",
        "rendererSurfaceHost.setFrontlineOverlayGroup(nextFrontlineOverlayGroup);",
        "rendererSurfaceHost.setInteractionRect(nextInteractionRect);",
      ],
    },
    {
      ownerPath: FILES.canvasColorHelpers,
      ownerTokens: [
        "function isProbablyCanvasColor(value) {",
        "function getSafeCanvasColor(value, fallback) {",
        "function parseCanvasColorChannels(value) {",
        "function getCanvasColorRelativeLuminance(value) {",
        "function mixCanvasColors(baseColor, targetColor, amount) {",
        'import { ColorManager } from "../color_manager.js";',
      ],
      rendererRequiredTokens: [
        "from \"./renderer/canvas_color_helpers.js\";",
      ],
      rendererForbiddenTokens: [
        "const COLOR_HEX_RE =",
        "const COLOR_FUNC_RE =",
        "const COLOR_NAME_RE =",
        "function isProbablyCanvasColor(value) {",
        "function getSafeCanvasColor(value, fallback) {",
        "function parseCanvasColorChannels(value) {",
        "function getCanvasColorRelativeLuminance(value) {",
        "function mixCanvasColors(baseColor, targetColor, amount) {",
      ],
    },
    {
      ownerPath: FILES.scenarioRefreshRuntime,
      ownerTokens: [
        "let deferredScenarioChunkPromotionInfraHandle = null;",
        "let scenarioChunkPromotionVersion = 0;",
        "function refreshMapDataForScenarioApply({",
      ],
      rendererRequiredTokens: [
        "let scenarioRefreshRuntime = null;",
        "createScenarioRefreshRuntime({",
        "return scenarioRefreshRuntime.refreshMapDataForScenarioApply(options);",
      ],
      rendererForbiddenTokens: [
        "let deferredScenarioChunkPromotionInfraHandle = null;",
        "let scenarioChunkPromotionVersion = 0;",
        "function buildScenarioChunkPromotionVisualMetricDetails(",
      ],
    },
    {
      ownerPath: FILES.exactAfterSettleScheduler,
      ownerTokens: [
        "let deferredExactContextRefreshHandle = null;",
        "let deferredExactContextRefreshVersion = 0;",
        "function buildExactAfterSettleRefreshPlan(",
        "function scheduleExactAfterSettleRefresh(",
      ],
      rendererRequiredTokens: [
        "let exactAfterSettleScheduler = null;",
        "createExactAfterSettleScheduler({",
        "return getExactAfterSettleScheduler().scheduleExactAfterSettleRefresh(profile);",
      ],
      rendererForbiddenTokens: [
        "let deferredExactContextRefreshHandle = null;",
        "function buildExactAfterSettleRefreshPlan(",
        "function applyExactAfterSettleRefreshPlan(plan) {",
      ],
    },
    {
      ownerPath: FILES.exactAfterSettlePassCatalog,
      ownerTokens: [
        "export const EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES = new Set([",
        "export const EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES = [",
        "export function getExactAfterSettleDprRestorePasses(",
      ],
    },
    {
      ownerPath: FILES.hgoPreviewRenderOwner,
      ownerTokens: [
        "function drawPreviewPass() {",
        "function inspectFromEvent(event, { eventType = \"unknown\" } = {}) {",
        "function getProjectedBounds() {",
        "const HGO_RUNTIME_PREVIEW_RENDER_PASS_NAMES = Object.freeze([",
      ],
      rendererRequiredTokens: [
        "let hgoRuntimePreviewRenderOwner = null;",
        "createHgoRuntimePreviewRenderOwner({",
        "return getHgoRuntimePreviewRenderOwner().inspectFromEvent(event, { eventType });",
        "getHgoRuntimePreviewRenderOwner().drawPreviewPass();",
      ],
      rendererForbiddenTokens: [
        "function renderHgoRuntimePreviewIfReady(",
        "const HGO_RUNTIME_PREVIEW_RENDER_PASS_NAMES =",
        "function getHgoRuntimePreviewCanvasPointFromEvent(",
        "const HGO_RUNTIME_PREVIEW_PROJECTION_NAME =",
      ],
    },
    {
      ownerPath: FILES.renderCacheOwner,
      ownerTokens: [
        "function invalidateRenderPasses(",
        "function invalidateAllRenderPasses(",
        "function clearRenderPassReferenceTransforms(",
        "function invalidateInteractionComposite(",
        "function clearLastGoodFrame(",
        "function createMutationSummary(",
        "const RENDER_CACHE_OWNER_SUMMARY_VERSION = 1;",
        "requestedPassNames,",
        "normalizedPassNames,",
        "droppedPassNames,",
        "sharedReferenceTransformCleared",
      ],
      rendererRequiredTokens: [
        "function getMutationPassNames(mutation = {})",
        "return applyRenderPassInvalidationEffects(getRenderCacheOwner().invalidateRenderPasses(",
        "return applyRenderPassInvalidationEffects(getRenderCacheOwner().invalidateAllRenderPasses(",
        "const mutation = getRenderCacheOwner().clearRenderPassReferenceTransforms(",
        "return getRenderCacheOwner().invalidateInteractionComposite(",
        "return getRenderCacheOwner().clearLastGoodFrame(",
      ],
      rendererForbiddenTokens: [
        "cache.dirty[passName] = true;",
        "cache.reasons[passName] = String(reason || \"unspecified\");",
        "cache.interactionComposite.valid = false;",
        "cache.interactionComposite.referenceTransform = null;",
        "cache.interactionComposite.signature = \"\";",
        "cache.lastGoodFrame.valid = false;",
        "cache.lastGoodFrame.stale = true;",
        "delete cache.referenceTransforms[passName];",
        "renderPassCache.referenceTransform = null;",
        "renderPassCache.referenceTransforms = {};",
        "renderPassCache.fullReferenceTransforms = {};",
      ],
    },
    {
      ownerPath: FILES.renderTransformReusePolicyOwner,
      ownerTokens: [
        "export function createRenderTransformReusePolicyOwner(",
        "function getContextBaseZoomBucketId(",
        "function getContextBaseReuseMaxDistancePx(",
        "function getTransformReuseDelta(",
        "function shouldEnableContextBaseTransformReuse(",
        "function shouldEnableContextScenarioTransformReuse(",
        "function getContextBaseReuseDecision(",
        "function getContextScenarioReuseDecision(",
        "function shouldStartExactAfterSettleFastPath(",
      ],
      rendererRequiredTokens: [
        "createRenderTransformReusePolicyOwner({",
        "return getRenderTransformReusePolicyOwner().getContextBaseReuseDecision(",
        "return getRenderTransformReusePolicyOwner().getContextScenarioReuseDecision(",
        "return getRenderTransformReusePolicyOwner().shouldStartExactAfterSettleFastPath(",
      ],
      rendererForbiddenTokens: [
        "const CONTEXT_BASE_REUSE_MIN_DISTANCE_PX =",
        "const CONTEXT_BASE_REUSE_MAX_DISTANCE_PX =",
        "const CONTEXT_BASE_REUSE_MAX_DISTANCE_VIEWPORT_RATIO =",
        "const CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD =",
        "const CONTEXT_BASE_BUCKET_LOW_MAX =",
        "const CONTEXT_BASE_BUCKET_MID_MAX =",
        "const CONTEXT_SCENARIO_REUSE_MAX_DISTANCE_PX =",
        "const CONTEXT_SCENARIO_REUSE_FRAME_LIMIT =",
      ],
    },
    {
      ownerPath: FILES.projectedGeometryBoundsOwner,
      ownerTokens: [
        "export function createProjectedGeometryBoundsOwner(",
        "function computeProjectedCoordinateBounds(",
        "function computeProjectedGeoBounds(",
        "function getProjectedFeatureBounds(",
        "function rebuildProjectedBoundsCache(",
        "function getSphericalGeometryDiagnostics(",
        "function collectSafeWaterRegionGeometryPartsInfo(",
        "function sanitizeWaterRegionFeatures(",
        "function clearProjectedBoundsCache(",
        "function mergeProjectedBounds(",
      ],
      rendererRequiredTokens: [
        "from \"./renderer/projected_geometry_bounds_owner.js\";",
        "let projectedGeometryBoundsOwner = null;",
        "createProjectedGeometryBoundsOwner({",
        "getD3: () => globalThis.d3,",
        "return getProjectedGeometryBoundsOwner().computeProjectedGeoBounds(geoObject);",
        "return getProjectedGeometryBoundsOwner().getProjectedFeatureBounds(feature, { featureId, allowCompute });",
        "return getProjectedGeometryBoundsOwner().sanitizeWaterRegionFeatures(features);",
        "collectFeatureHitGeometries: collectSafeWaterRegionGeometryParts,",
        "let scenarioWaterPartPathCache = new WeakMap();",
        "let scenarioWaterFeaturePathCache = new WeakMap();",
      ],
      rendererForbiddenTokens: [
        "const sphericalGeometryDiagnosticsByObject = new WeakMap();",
        "const safeWaterRegionGeometryPartsByFeature = new WeakMap();",
        "const sanitizedWaterRegionFeatureByFeature = new WeakMap();",
        "const waterSphericalSanitizationWarnings = new Set();",
        "const SPHERICAL_GEOMETRY_MAX_AREA =",
      ],
    },
    {
      ownerPath: FILES.viewportReadModelOwner,
      ownerTokens: [
        "export function createViewportReadModelOwner(",
        "function getViewportRenderSignature(",
        "function getProjectionRenderSignature(",
        "function getViewportGeoBounds(",
        "function calculatePanExtent(",
        "function getProjectedRenderableContentBounds(",
        "function getCenteredFitZoomTransform(",
        "function getZoomPercent(",
      ],
      rendererRequiredTokens: [
        "createViewportReadModelOwner({",
        "return getViewportReadModelOwner().getViewportRenderSignature(",
        "return getViewportReadModelOwner().getProjectionRenderSignature(",
        "return getViewportReadModelOwner().getViewportGeoBounds(",
        "return getViewportReadModelOwner().calculatePanExtent(",
        "return getViewportReadModelOwner().getProjectedRenderableContentBounds(",
        "return getViewportReadModelOwner().getCenteredFitZoomTransform(",
        "return getViewportReadModelOwner().getZoomPercent(",
      ],
      rendererForbiddenTokens: [
        "const samplePoints = [",
        "sortedLongitudes[trimCount]",
        "projection.scale() || 0",
        "return `${Math.round(scale * 100)}%`;",
      ],
    },
    {
      ownerPath: FILES.viewportCommandOwner,
      ownerTokens: [
        "export function createViewportCommandOwner(",
        "function updateZoomTranslateExtent(",
        "function resetZoomToFit(",
        "function zoomByStep(",
        "function setZoomPercent(",
        "function enforceZoomConstraints(",
      ],
      rendererRequiredTokens: [
        "from \"./renderer/viewport_command_owner.js\";",
        "let viewportCommandOwner = null;",
        "createViewportCommandOwner({",
        "setZoomTransform: (transform) => {",
        "return getViewportCommandOwner().updateZoomTranslateExtent(",
        "return getViewportCommandOwner().resetZoomToFit(",
        "return getViewportCommandOwner().zoomByStep(",
        "return getViewportCommandOwner().setZoomPercent(",
        "return getViewportCommandOwner().enforceZoomConstraints(",
      ],
      rendererForbiddenTokens: [
        "zoomBehavior.scaleExtent([MIN_ZOOM_SCALE, MAX_ZOOM_SCALE]);",
        "globalThis.d3.select(interactionRect.node()).call(zoomBehavior.transform, transform);",
        "globalThis.d3.select(interactionRect.node()).call(zoomBehavior.scaleBy",
        "globalThis.d3.select(interactionRect.node()).call(zoomBehavior.scaleTo",
        "globalThis.d3.select(interactionRect.node()).call(zoomBehavior.translateBy",
      ],
    },
    {
      ownerPath: FILES.rendererViewportUpdateOwner,
      ownerTokens: [
        "export function createRendererViewportUpdateOwner(",
        "getters = {},",
        "const getViewportGroup = requireFunction(getters, \"getViewportGroup\", \"getters\");",
        "function updateMap(transform)",
        "const setZoomTransform = requireFunction(effects, \"setZoomTransform\", \"effects\");",
        "const setHitCanvasDirty = requireFunction(effects, \"setHitCanvasDirty\", \"effects\");",
        "const updateZoomUi = requireFunction(effects, \"updateZoomUi\", \"effects\");",
        "const viewportGroup = getViewportGroup();",
        "viewportGroup.attr(\"transform\"",
        "const drawFrame = requireFunction(effects, \"drawFrame\", \"effects\");",
        "setZoomTransform(transform);",
        "setHitCanvasDirty();",
        "updateZoomUi();",
        "renderPhysicalIntensityBrushPreview();",
        "syncUnitCounterScalesDuringZoom();",
        "syncSpecialZonePatternTransformDuringZoom();",
        "drawFrame();",
      ],
      rendererRequiredTokens: [
        "from \"./renderer/renderer_viewport_update_owner.js\";",
        "let rendererViewportUpdateOwner = null;",
        "function getRendererViewportUpdateOwner()",
        "rendererViewportUpdateOwner = createRendererViewportUpdateOwner({",
        "return getRendererViewportUpdateOwner().updateMap(transform);",
      ],
    },
    {
      ownerPath: FILES.viewportResizeLifecycleOwner,
      ownerTokens: [
        "export function createViewportResizeLifecycleOwner(",
        "function requestMapContainerResizeSync(",
        "function bindMapContainerResizeObserver(",
        "function bindBrowserPixelRatioObserver(",
        "function bindVisualViewportResizeObserver(",
        "function handleBrowserPixelRatioRefresh(",
        "function handleResize(",
        "function scheduleResizeSpatialRefresh(",
      ],
      rendererRequiredTokens: [
        "createViewportResizeLifecycleOwner({",
        "return getViewportResizeLifecycleOwner().requestMapContainerResizeSync(",
        "return getViewportResizeLifecycleOwner().handleResize(",
        "return getViewportResizeLifecycleOwner().bindBrowserZoomObservers(",
      ],
      rendererForbiddenTokens: [
        "let mapContainerResizeObserver =",
        "let mapContainerResizeFrame =",
        "let mapContainerResizeTimer =",
        "let pendingMapResizeReason =",
        "let browserPixelRatioMediaQuery =",
        "let browserPixelRatioMediaQueryHandler =",
        "let visualViewportResizeHandler =",
        "let resizeSpatialRefreshHandle =",
      ],
    },
    {
      ownerPath: FILES.zoomInteractionLifecycleOwner,
      ownerTokens: [
        "export function createZoomInteractionLifecycleOwner(",
        "const updateMap = requireFunction(effects, \"updateMap\", \"effects\");",
        "function initZoom(",
        "function flushLatestZoomTransform(",
      ],
      rendererRequiredTokens: [
        "createZoomInteractionLifecycleOwner({",
        "return getZoomInteractionLifecycleOwner().initZoom(",
      ],
      rendererForbiddenTokens: [
        "zoomBehavior = globalThis.d3",
        ".on(\"start\", () => {",
        ".on(\"zoom\", (event) => {",
        ".on(\"end\", (event) => {",
      ],
    },
    {
      ownerPath: FILES.mapInteractionEventBindingOwner,
      ownerTokens: [
        "export function createMapInteractionEventBindingOwner(",
        "function bindEvents(",
      ],
      rendererRequiredTokens: [
        "createMapInteractionEventBindingOwner({",
        "return getMapInteractionEventBindingOwner().bindEvents(",
      ],
      rendererForbiddenTokens: [
        "bindInteractionFunnel({",
        "interactionRect.on(\"mousemove\"",
        "interactionRect.on(\"pointerdown.fieldTool\"",
        "window.addEventListener(\"resize\"",
      ],
    },
    {
      ownerPath: FILES.scenarioWaterCachePolicyOwner,
      ownerTokens: [
        "export function createScenarioWaterCachePolicyOwner(",
        "function normalizeScenarioWaterCacheStrategyMode(",
        "function getForcedScenarioWaterCacheMode(",
        "function normalizeScenarioWaterCoverageAlgo(",
        "function getForcedScenarioWaterCoverageAlgo(",
        "function getScenarioWaterVisibleCoverageRatioLegacy(",
        "function getScenarioWaterVisibleCoverageRatioGrid(",
        "function getScenarioWaterCacheComplexitySignals(",
        "function shouldUseDirectScenarioWaterDraw(",
      ],
      rendererRequiredTokens: [
        "createScenarioWaterCachePolicyOwner({",
        "return getScenarioWaterCachePolicyOwner().getForcedScenarioWaterCacheMode(",
        "return getScenarioWaterCachePolicyOwner().getScenarioWaterCacheComplexitySignals(",
        "return getScenarioWaterCachePolicyOwner().shouldUseDirectScenarioWaterDraw(",
      ],
      rendererForbiddenTokens: [
        "const SCENARIO_WATER_CACHE_MODE_PARAM =",
        "const SCENARIO_WATER_CACHE_MODE_ALT_PARAM =",
        "const SCENARIO_WATER_CACHE_MODES =",
        "const SCENARIO_WATER_COVERAGE_ALGO_PARAM =",
        "const SCENARIO_WATER_COVERAGE_ALGO_ALT_PARAM =",
        "const SCENARIO_WATER_COVERAGE_ALGOS =",
        "const SCENARIO_WATER_COVERAGE_GRID_BASE_COLUMNS =",
        "const SCENARIO_WATER_COVERAGE_GRID_BASE_ROWS =",
        "const SCENARIO_WATER_COVERAGE_GRID_MAX_DPR =",
        "const SCENARIO_WATER_LOW_COMPLEXITY_FEATURE_MAX =",
        "const SCENARIO_WATER_LOW_COMPLEXITY_COVERAGE_MAX =",
        "const SCENARIO_WATER_LOW_COMPLEXITY_PREV_RENDERED_MAX =",
      ],
    },
    {
      ownerPath: FILES.visualEffectsPassOwner,
      ownerTokens: [
        "export function createVisualEffectsPassOwner({",
        "function drawEffectsPass(",
        "function drawLineEffectsPass(",
        "function drawTextureLabelEffectsPass(",
        "function drawDayNightPass(",
        "function drawOldPaperTexture(",
        "function drawGraticuleTextureLines(",
        "function drawGraticuleTextureLabels(",
        "function drawDraftGridTexture(",
        "function invalidateTextureRasterCaches(",
        "return Object.freeze({",
      ],
      ownerForbiddenTokens: [
        "import ",
        "runtimeState",
        "RendererRuntimeContext",
        "document.",
        "window.",
        "globalThis",
        "d3.",
      ],
      rendererRequiredTokens: [
        "import { createVisualEffectsPassOwner } from \"./renderer/visual_effects_pass_owner.js\";",
        "let visualEffectsPassOwner = null;",
        "function getVisualEffectsPassOwner() {",
        "return getVisualEffectsPassOwner().drawEffectsPass(k, options);",
        "return getVisualEffectsPassOwner().drawLineEffectsPass(k, options);",
        "return getVisualEffectsPassOwner().drawTextureLabelEffectsPass(k);",
        "return getVisualEffectsPassOwner().drawDayNightPass(k, options);",
      ],
      rendererForbiddenTokens: [
        "function drawEffectsPass(k, { interactive = false } = {}) {",
        "function drawLineEffectsPass(k, { interactive = false } = {}) {",
        "function drawDayNightPass(k, { interactive = false } = {}) {",
        "function drawOldPaperTexture(",
        "function drawGraticuleTextureLines(",
        "function drawGraticuleTextureLabels(",
        "function drawDraftGridTexture(",
        "const textureAssetCache = new Map();",
        "const texturePatternCache = new Map();",
        "const textureGeometryCache = new Map();",
        "const textureNoiseTileCache = new Map();",
      ],
    },
    {
      ownerPath: FILES.contextPassOrchestratorOwner,
      ownerTokens: [
        "export function createContextPassOrchestratorOwner({",
        "function drawContextBasePass(",
        "function drawContextMarkersPass(",
        "function drawContextScenarioPass(",
        "return Object.freeze({",
      ],
      ownerForbiddenTokens: [
        "import ",
        "runtimeState",
        "RendererRuntimeContext",
        "document.",
        "window.",
        "globalThis",
        "d3.",
      ],
      rendererRequiredTokens: [
        "import { createContextPassOrchestratorOwner } from \"./renderer/context_pass_orchestrator_owner.js\";",
        "let contextPassOrchestratorOwner = null;",
        "function getContextPassOrchestratorOwner() {",
        "return getContextPassOrchestratorOwner().drawContextBasePass(k, options);",
        "return getContextPassOrchestratorOwner().drawContextMarkersPass(k, options);",
        "return getContextPassOrchestratorOwner().drawContextScenarioPass(k, options);",
      ],
      rendererForbiddenTokens: [
        "function drawContextBasePass(k, { interactive = false } = {}) {",
        "function drawContextMarkersPass(k, { interactive = false } = {}) {",
        "function drawContextScenarioPass(k, { interactive = false } = {}) {",
      ],
    },
    {
      ownerPath: FILES.politicalPassOrchestratorOwner,
      ownerTokens: [
        "export function createPoliticalPassOrchestratorOwner({",
        "function resolveRecoveryQuality(",
        "function drawPoliticalPass(k)",
        "const identity = resolvePoliticalPassIdentity(k);",
        "const viewport = resolvePoliticalPassViewport(identity);",
        "const featureMetrics = drawPoliticalFineFeatureLoop({ k, identity, viewport });",
        "return Object.freeze({ drawPoliticalPass });",
      ],
      ownerForbiddenTokens: [
        "import ",
        "runtimeState",
        "RendererRuntimeContext",
        "document.",
        "window.",
        "globalThis",
        "d3.",
        "getContext(",
        "drawPoliticalFeature(",
        "buildPoliticalRasterWorkerPacket(",
        "tryPartialPoliticalPassRepaint(",
        "orderPoliticalShellUnderlayFirst(",
        "invalidateRenderPasses(",
        "requestRendererRender(",
      ],
      rendererRequiredTokens: [
        "import { createPoliticalPassOrchestratorOwner } from \"./renderer/political_pass_orchestrator_owner.js\";",
        "let politicalPassOrchestratorOwner = null;",
        "function getPoliticalPassOrchestratorOwner() {",
        "function resolvePoliticalPassIdentity(k) {",
        "function resolvePoliticalPassViewport(identity) {",
        "function publishPoliticalPassDiagnostics({ identity, viewport }) {",
        "function drawPoliticalPassBackground({ identity, viewport }) {",
        "function buildPoliticalPassWorkerPacket({ identity, viewport }) {",
        "function requestPoliticalPassWorker({ identity, packetState }) {",
        "function drawPoliticalFineFeatureLoop({ k, identity, viewport }) {",
        "resolvePoliticalRecoveryQuality: getPoliticalRecoveryQuality,",
        "return getPoliticalPassOrchestratorOwner().drawPoliticalPass(k);",
        "tryPartialPoliticalPassRepaint,",
      ],
      rendererForbiddenTokens: [
        "function drawPoliticalPass(k) {\n  if (isHgoRuntimePreviewReady())",
      ],
    },
    {
      ownerPath: FILES.politicalBackgroundRenderOwner,
      ownerTokens: [
        "export function createPoliticalBackgroundRenderOwner({",
        "function createScenarioPoliticalBackgroundCacheState(",
        "function runScenarioPoliticalBackgroundDeferredFullCacheSlice(",
        "function drawScenarioPoliticalBackgroundFills(",
        "function buildAdmin0MergedShapes(",
        "function drawOceanDepthMaskLayer(",
        "function drawBackgroundPass()",
        "function drawPoliticalBackgroundFills(options = {})",
        "function drawPoliticalBackgroundFillsForEntries(entries = [],",
        "cancelScenarioPoliticalBackgroundDeferredFullCache,",
      ],
      ownerForbiddenTokens: [
        "import ",
        "runtimeState",
        "RendererRuntimeContext",
        "document.",
        "window.",
        "globalThis",
        "requestPoliticalRasterWorkerPass",
        "buildPoliticalRasterWorkerPacket(",
        "tryPartialPoliticalPassRepaint(",
      ],
      rendererRequiredTokens: [
        "import { createPoliticalBackgroundRenderOwner } from \"./renderer/political_background_render_owner.js\";",
        "let politicalBackgroundRenderOwner = null;",
        "function getPoliticalBackgroundRenderOwner() {",
        "return getPoliticalBackgroundRenderOwner().drawBackgroundPass();",
        "return getPoliticalBackgroundRenderOwner().drawPoliticalBackgroundFills(options);",
        "return getPoliticalBackgroundRenderOwner().drawPoliticalBackgroundFillsForEntries(entries, options);",
        "return getPoliticalBackgroundRenderOwner().cancelScenarioPoliticalBackgroundDeferredFullCache(reason);",
        "function drawPoliticalPassBackground({ identity, viewport }) {",
        "function buildCountryDominantFillColorMap() {",
      ],
      rendererForbiddenTokens: [
        "function createScenarioPoliticalBackgroundCacheState(",
        "function runScenarioPoliticalBackgroundDeferredFullCacheSlice(",
        "function drawScenarioPoliticalBackgroundFills(",
        "function buildAdmin0MergedShapes(",
        "function drawOceanDepthMaskLayer(",
      ],
    },
    {
      ownerPath: FILES.politicalPartialRepaintOwner,
      ownerTokens: [
        "export function createPoliticalPartialRepaintOwner({",
        "function buildPoliticalRasterWorkerPacket(",
        "function drawPoliticalWorkerBitmapResult(",
        "function tryPartialPoliticalPassRepaint(",
        "function resolvePoliticalPassIdentity(k)",
        "function requestPoliticalPassWorker({ identity, packetState })",
        "function drawPoliticalFineFeatureLoop({ k, identity, viewport })",
      ],
      ownerForbiddenTokens: [
        "import ",
        "runtimeState",
        "RendererRuntimeContext",
        "document.",
        "window.",
        "globalThis",
        "new Worker(",
        "setTimeout(",
      ],
      rendererRequiredTokens: [
        "import { createPoliticalPartialRepaintOwner } from \"./renderer/political_partial_repaint_owner.js\";",
        "let politicalPartialRepaintOwner = null;",
        "function getPoliticalPartialRepaintOwner() {",
        "return getPoliticalPartialRepaintOwner().tryPartialPoliticalPassRepaint(transform, nextSignature, timings);",
        "return getPoliticalPartialRepaintOwner().resolvePoliticalPassIdentity(k);",
        "return getPoliticalPartialRepaintOwner().drawPoliticalFineFeatureLoop({ k, identity, viewport });",
      ],
      rendererForbiddenTokens: [
        "function tryPartialPoliticalPassRepaint(transform, nextSignature, timings) {\n  const cache = getRenderPassCacheState();",
      ],
    },
    {
      ownerPath: FILES.renderPipelineCatalog,
      ownerTokens: [
        "export const IDLE_RENDER_PASS_DEFINITIONS = [",
        'passName: "background", drawKey: "drawBackgroundPass"',
        'passName: "hgoPreview", drawKey: "drawHgoPreviewPass"',
        'passName: "contextScenario", drawKey: "drawContextScenarioPass"',
        'passName: "textureLabels", drawKey: "drawTextureLabelEffectsPass"',
      ],
      rendererRequiredPath: FILES.renderPipelinePasses,
      rendererRequiredTokens: [
        "from \"./render_pipeline_catalog.js\";",
      ],
      rendererForbiddenPath: FILES.renderPipelinePasses,
      rendererForbiddenTokens: [
        '["background", (k) => drawBackgroundPass(k)],',
        '["hgoPreview", (k) => drawHgoPreviewPass(k)],',
        '["contextScenario", (k) => drawContextScenarioPass(k)],',
        '["textureLabels", (k) => drawTextureLabelEffectsPass(k)],',
      ],
    },
    {
      ownerPath: FILES.renderPassCatalog,
      ownerTokens: [
        "export const RENDER_PASS_NAMES = [",
        "export const TRANSFORM_REUSED_RENDER_PASS_NAMES = new Set([",
        "export const VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES = new Set([",
        "export const INTERACTION_COMPOSITE_PASS_NAMES = [",
        "export const TRANSFORMED_FRAME_PASS_NAMES = [",
        "export const RENDER_PASS_OVERSCAN_RATIO_PER_SIDE = 0.15;",
      ],
      rendererRequiredTokens: [
        "from \"./map_renderer/render_pass_catalog.js\";",
        "export { RENDER_PASS_NAMES } from \"./map_renderer/render_pass_catalog.js\";",
      ],
      rendererForbiddenTokens: [
        "export const RENDER_PASS_NAMES = [",
        "const TRANSFORM_REUSED_RENDER_PASS_NAMES = new Set([",
        "const VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES = new Set([",
        "const INTERACTION_COMPOSITE_PASS_NAMES = [",
        "const TRANSFORMED_FRAME_PASS_NAMES = [",
        "const RENDER_PASS_OVERSCAN_RATIO_PER_SIDE =",
      ],
    },
    {
      ownerPath: FILES.renderInvalidationCatalog,
      ownerTokens: [
        "export const PASS_RESOURCE_MAP = Object.freeze({",
        "export const RESOURCE_PASS_MAP = Object.freeze(",
        "export const DEFAULT_RENDER_INVALIDATION_PASSES = [",
        "export const FIRST_FRAME_BASE_TARGET_RESOURCES = Object.freeze([",
        "export const FIRST_FRAME_HGO_TARGET_RESOURCES = Object.freeze([",
        "export const UNSUPPORTED_RENDER_PASS_INPUT_KEYS = Object.freeze([",
        "export function getTargetResourcesForPasses(",
        "export function getTargetPassesForResources(",
        "export function getFirstFrameTargetResources(",
        "export function resolveFirstFrameTargetResources(",
      ],
    },
  ];

  for (const rule of ownershipRules) {
    const ownerSource = sources[rule.ownerPath];
    for (const token of rule.ownerTokens) {
      if (!ownerSource.includes(token)) {
        failures.push(`${rule.ownerPath} must own token: ${token}`);
      }
    }
    for (const token of rule.ownerForbiddenTokens || []) {
      if (ownerSource.includes(token)) {
        failures.push(`${rule.ownerPath} must not own forbidden token: ${token}`);
      }
    }
    for (const token of rule.rendererRequiredTokens || []) {
      const targetPath = rule.rendererRequiredPath || FILES.renderer;
      if (!sources[targetPath].includes(token)) {
        failures.push(`${targetPath} must keep wrapper token: ${token}`);
      }
    }
    for (const token of rule.rendererForbiddenTokens || []) {
      const targetPath = rule.rendererForbiddenPath || FILES.renderer;
      if (sources[targetPath].includes(token)) {
        failures.push(`${targetPath} must not own extracted token: ${token}`);
      }
    }
  }

  for (const relativePath of [
    "js/core/renderer/visual_effects_pass_helper.js",
    "js/core/renderer/visual_effects_pass_controller.js",
    "js/core/renderer/visual_effects_pass_adapter.js",
    "js/core/renderer/shared_visual_effects_pass_owner.js",
    "js/core/map_renderer/visual_effects_pass_owner.js",
    "js/core/map_renderer/visual_effects_pass_helper.js",
    "js/core/map_renderer/visual_effects_pass_controller.js",
    "js/core/map_renderer/visual_effects_pass_adapter.js",
  ]) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`${relativePath} duplicates the canonical visual effects pass owner.`);
    }
  }

  for (const relativePath of [
    "js/core/renderer/context_pass_orchestrator_helper.js",
    "js/core/renderer/context_pass_orchestrator_controller.js",
    "js/core/renderer/context_pass_orchestrator_adapter.js",
    "js/core/renderer/shared_context_pass_orchestrator_owner.js",
    "js/core/map_renderer/context_pass_orchestrator_owner.js",
    "js/core/map_renderer/context_pass_orchestrator_helper.js",
    "js/core/map_renderer/context_pass_orchestrator_controller.js",
    "js/core/map_renderer/context_pass_orchestrator_adapter.js",
  ]) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`${relativePath} duplicates the canonical context pass orchestrator owner.`);
    }
  }

  for (const relativePath of [
    "js/core/renderer/political_pass_owner.js",
    "js/core/renderer/political_pass_helper.js",
    "js/core/renderer/political_pass_controller.js",
    "js/core/renderer/political_pass_adapter.js",
    "js/core/renderer/political_pass_orchestrator_helper.js",
    "js/core/renderer/political_pass_orchestrator_controller.js",
    "js/core/renderer/political_pass_orchestrator_adapter.js",
    "js/core/renderer/shared_political_pass_orchestrator_owner.js",
    "js/core/map_renderer/political_pass_orchestrator_owner.js",
    "js/core/map_renderer/political_pass_orchestrator_helper.js",
    "js/core/map_renderer/political_pass_orchestrator_controller.js",
    "js/core/map_renderer/political_pass_orchestrator_adapter.js",
  ]) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      failures.push(`${relativePath} duplicates the canonical political pass orchestrator owner.`);
    }
  }

  if (publicFacadeSource.includes("political_pass_orchestrator_owner")) {
    failures.push(`${FILES.publicFacade} must not expose the political pass orchestrator owner.`);
  }
  if (stateWriteAllowlist.includes(FILES.politicalPassOrchestratorOwner)) {
    failures.push(`${FILES.politicalPassOrchestratorOwner} must not enter the state-write allowlist.`);
  }

  return failures;
}

function main() {
  const failures = collectFailures();
  if (failures.length > 0) {
    console.error("Architecture boundary check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log("Architecture boundary check passed.");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
