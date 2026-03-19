import { state } from "../core/state.js";
import * as mapRenderer from "../core/map_renderer.js";
import { syncScenarioLocalizationState } from "../core/scenario_manager.js";
import { getFeatureOwnerCode } from "../core/sovereignty_manager.js";
import {
  applyOwnerToFeatureIds,
  buildScenarioOwnershipSavePayload,
  filterEditableOwnershipFeatureIds,
  resetOwnersToScenarioBaselineForFeatureIds,
  summarizeOwnershipForFeatureIds,
} from "../core/scenario_ownership_editor.js";
import { buildTooltipModel, t } from "./i18n.js";
import { showToast } from "./toast.js";

const DEV_WORKSPACE_STORAGE_KEY = "mapcreator_dev_workspace_expanded";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

function ui(key) {
  return t(key, "ui");
}

function localizeSelectionSummary(count) {
  return state.currentLanguage === "zh"
    ? `${count} 个地块已选。`
    : `${count} features selected.`;
}

function isLocalHost() {
  const host = String(globalThis.location?.hostname || "").trim().toLowerCase();
  return LOCAL_HOSTS.has(host);
}

function readStoredExpanded() {
  try {
    return localStorage.getItem(DEV_WORKSPACE_STORAGE_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

function writeStoredExpanded(nextValue) {
  try {
    localStorage.setItem(DEV_WORKSPACE_STORAGE_KEY, nextValue ? "1" : "0");
  } catch (_error) {
    // Ignore storage failures in dev-only UI state.
  }
}

function resolveFeatureFromHit(hit) {
  if (!hit?.id) return null;
  if (hit.targetType === "special") return state.specialRegionsById?.get(hit.id) || null;
  if (hit.targetType === "water") return state.waterRegionsById?.get(hit.id) || null;
  return state.landIndex?.get(hit.id) || null;
}

function resolveFeatureName(feature, fallbackId = "") {
  const model = buildTooltipModel(feature);
  return String(model.regionName || model.lines?.[0] || fallbackId || "").trim();
}

function resolveNeighborCount(featureId) {
  const index = state.runtimeFeatureIndexById?.get(featureId);
  if (!Number.isInteger(index)) return "";
  const neighbors = state.runtimeNeighborGraph?.[index];
  return Array.isArray(neighbors) ? String(neighbors.filter((value) => Number.isInteger(value)).length) : "";
}

function sanitizeSelectionState() {
  const rawIds = Array.isArray(state.devSelectionOrder)
    ? state.devSelectionOrder.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const nextIds = [];
  const seen = new Set();
  rawIds.forEach((id) => {
    if (!id || seen.has(id)) return;
    const feature = state.landIndex?.get(id);
    if (!feature) return;
    seen.add(id);
    nextIds.push(id);
  });
  const changed = rawIds.length !== nextIds.length || rawIds.some((id, index) => id !== nextIds[index]);
  if (changed) {
    state.devSelectionOrder = nextIds;
    state.devSelectionFeatureIds = new Set(nextIds);
    state.devClipboardFallbackText = "";
    state.devSelectionOverlayDirty = true;
  } else if (!(state.devSelectionFeatureIds instanceof Set)) {
    state.devSelectionFeatureIds = new Set(nextIds);
  }
  return nextIds;
}

function resolveSelectionEntries() {
  return sanitizeSelectionState()
    .map((featureId, index) => {
      const feature = state.landIndex?.get(featureId);
      if (!feature) return null;
      return {
        id: featureId,
        index,
        name: resolveFeatureName(feature, featureId) || featureId,
      };
    })
    .filter(Boolean);
}

function sortSelectionEntries(entries = []) {
  const nextEntries = [...entries];
  if (state.devSelectionSortMode === "name") {
    nextEntries.sort((a, b) => {
      const nameDelta = a.name.localeCompare(b.name);
      if (nameDelta !== 0) return nameDelta;
      return a.id.localeCompare(b.id);
    });
  }
  return nextEntries;
}

function buildClipboardText(format = "names_with_ids") {
  const entries = sortSelectionEntries(resolveSelectionEntries());
  if (!entries.length) return "";
  if (format === "names") {
    return entries.map((entry) => entry.name).join("\n");
  }
  if (format === "ids") {
    return entries.map((entry) => entry.id).join("\n");
  }
  return entries.map((entry) => `${entry.name} | ${entry.id}`).join("\n");
}

function normalizeOwnerInput(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function resolveOwnershipTargetIds() {
  const selectedIds = filterEditableOwnershipFeatureIds(sanitizeSelectionState()).matchedIds;
  if (selectedIds.length > 0) {
    return selectedIds;
  }
  const selectedId = state.devSelectedHit?.targetType === "land"
    ? String(state.devSelectedHit.id || "").trim()
    : "";
  return filterEditableOwnershipFeatureIds(selectedId ? [selectedId] : []).matchedIds;
}

function resolveOwnershipEditorModel() {
  const targetIds = resolveOwnershipTargetIds();
  const summary = summarizeOwnershipForFeatureIds(targetIds);
  const singleFeatureId = targetIds.length === 1 ? targetIds[0] : "";
  const singleFeature = singleFeatureId ? state.landIndex?.get(singleFeatureId) || null : null;
  const currentOwnerCode = singleFeatureId ? normalizeOwnerInput(getFeatureOwnerCode(singleFeatureId)) : "";
  const currentControllerCode = singleFeatureId
    ? normalizeOwnerInput(state.scenarioControllersByFeatureId?.[singleFeatureId] || currentOwnerCode)
    : "";
  return {
    targetIds,
    selectionCount: targetIds.length,
    singleFeatureId,
    singleFeature,
    currentOwnerCode,
    currentControllerCode,
    ownerCodes: summary.ownerCodes,
    isMixedOwner: summary.isMixed,
  };
}

function buildOwnershipMetaRows(model) {
  if (!model.selectionCount) return [];
  if (model.singleFeatureId) {
    return [
      ["ID", model.singleFeatureId],
      [ui("Name"), resolveFeatureName(model.singleFeature, model.singleFeatureId)],
      [ui("Owner"), model.currentOwnerCode],
      [ui("Controller"), model.currentControllerCode],
    ].filter(([, value]) => String(value || "").trim());
  }
  return [
    [ui("Selected"), String(model.selectionCount)],
    [
      ui("Owner"),
      model.isMixedOwner
        ? `${ui("Mixed")} (${model.ownerCodes.join(", ")})`
        : (model.ownerCodes[0] || ui("Unknown")),
    ],
  ];
}

function resolveOwnershipEditorHint(model) {
  if (!state.activeScenarioId) {
    return ui("Activate a scenario to edit and save political ownership.");
  }
  if (!model.selectionCount) {
    return ui("Select one or more land features to edit political ownership.");
  }
  if (model.singleFeatureId) {
    return ui("Apply a new owner tag to the selected feature or reset it to the active scenario baseline.");
  }
  return ui("Apply one owner tag across the current selection or reset those features to the active scenario baseline.");
}

function normalizeLocaleInput(value) {
  return String(value || "").trim();
}

function getScenarioGeoLocaleEntry(featureId) {
  const normalizedFeatureId = String(featureId || "").trim();
  const baseEntry = normalizedFeatureId
    ? (state.baseGeoLocales?.[normalizedFeatureId] && typeof state.baseGeoLocales[normalizedFeatureId] === "object"
      ? state.baseGeoLocales[normalizedFeatureId]
      : null)
    : null;
  const patchEntry = normalizedFeatureId
    ? (state.scenarioGeoLocalePatchData?.geo?.[normalizedFeatureId]
      && typeof state.scenarioGeoLocalePatchData.geo[normalizedFeatureId] === "object"
      ? state.scenarioGeoLocalePatchData.geo[normalizedFeatureId]
      : null)
    : null;
  return {
    baseEntry,
    patchEntry,
    mergedEntry: {
      en: normalizeLocaleInput(patchEntry?.en || baseEntry?.en || ""),
      zh: normalizeLocaleInput(patchEntry?.zh || baseEntry?.zh || ""),
    },
  };
}

function resolveLocaleEditorModel() {
  const targetIds = resolveOwnershipTargetIds();
  const featureId = targetIds.length === 1 ? String(targetIds[0] || "").trim() : "";
  const feature = featureId ? state.landIndex?.get(featureId) || null : null;
  const localeEntry = getScenarioGeoLocaleEntry(featureId);
  return {
    featureId,
    feature,
    selectionCount: targetIds.length,
    hasScenario: !!String(state.activeScenarioId || "").trim(),
    hasGeoLocalePatch: !!String(state.activeScenarioManifest?.geo_locale_patch_url || "").trim(),
    ...localeEntry,
  };
}

function buildLocaleMetaRows(model) {
  if (!model.featureId || !model.feature) return [];
  const rows = [
    ["ID", model.featureId],
    [ui("Name"), resolveFeatureName(model.feature, model.featureId)],
    [ui("Current EN"), model.mergedEntry.en],
    [ui("Current ZH"), model.mergedEntry.zh],
  ];
  return rows.filter(([, value]) => String(value || "").trim());
}

function resolveLocaleEditorHint(model) {
  if (!model.hasScenario) {
    return ui("Activate a scenario to edit localized geo names.");
  }
  if (!model.hasGeoLocalePatch) {
    return ui("The active scenario does not declare a geo locale patch target.");
  }
  if (model.selectionCount !== 1 || !model.featureId) {
    return ui("Select exactly one land feature to edit localized geo names.");
  }
  return ui("Edit EN and ZH for the selected feature, then save to rebuild the active scenario locale patch.");
}

function resolveInspectorRows() {
  const hit = state.devSelectedHit?.id ? state.devSelectedHit : state.devHoverHit;
  if (!hit?.id) {
    return {
      title: "No active feature",
      hint: ui("Hover a region or click one to inspect live debug metadata."),
      rows: [],
    };
  }

  const feature = resolveFeatureFromHit(hit);
  const tooltipModel = buildTooltipModel(feature);
  const detailTier = String(feature?.properties?.detail_tier || "").trim();
  const parentGroup =
    hit.targetType === "land" ? String(state.parentGroupByFeatureId?.get(hit.id) || "").trim() : "";
  const source = String(
    feature?.properties?.__source
      || (hit.targetType === "special" ? "scenario" : hit.targetType === "water" ? "context" : "primary")
  ).trim();
  const ownerCode = hit.targetType === "land"
    ? String(getFeatureOwnerCode(hit.id) || tooltipModel.countryCode || hit.countryCode || "").trim().toUpperCase()
    : "";
  const controllerCode = hit.targetType === "land"
    ? String(state.scenarioControllersByFeatureId?.[hit.id] || "").trim().toUpperCase()
    : "";

  const rows = [
    [ui("Target"), String(hit.targetType || "land")],
    [ui("Name"), resolveFeatureName(feature, hit.id)],
    ["ID", String(hit.id || "")],
    [ui("Country"), tooltipModel.countryCode ? `${tooltipModel.countryDisplayName || ""} (${tooltipModel.countryCode})` : ""],
    [ui("Parent Group"), parentGroup],
    [ui("Detail Tier"), detailTier],
    [ui("Owner"), ownerCode],
    [ui("Controller"), controllerCode],
    [ui("Scenario View"), String(state.scenarioViewMode || "ownership")],
    [ui("Hit Source"), String(hit.hitSource || "spatial")],
    [ui("Snap"), hit.viaSnap ? ui("Snap hit") : hit.strict ? ui("Strict hit") : ui("No")],
    [ui("Source Topology"), source],
    [ui("Neighbors"), resolveNeighborCount(hit.id)],
  ].filter(([, value]) => String(value || "").trim());

  return {
    title: resolveFeatureName(feature, hit.id),
    hint: tooltipModel.countryDisplayName || tooltipModel.countryCode || "",
    rows,
  };
}

function resolveRenderRows() {
  const renderPerf = state.renderPerfMetrics || {};
  const cache = state.renderPassCache || {};
  const frame = cache.lastFrame || {};
  const timings = frame.timings || {};
  return [
    [ui("Render Profile"), String(state.renderProfile || "auto")],
    [ui("Bundle Mode"), String(state.topologyBundleMode || "single")],
    [ui("Detail Deferred"), state.detailDeferred ? ui("Yes") : ui("No")],
    [ui("Detail Source"), String(state.detailSourceRequested || "")],
    [ui("Phase"), String(state.renderPhase || "idle")],
    [ui("Last Frame"), Number.isFinite(Number(frame.totalMs)) ? `${Number(frame.totalMs).toFixed(1)}ms` : ""],
    [ui("Last Action"), String(cache.lastAction || "")],
    [ui("Action Time"), Number.isFinite(Number(cache.lastActionDurationMs)) ? `${Number(cache.lastActionDurationMs).toFixed(1)}ms` : ""],
    ["setMapData", Number.isFinite(Number(renderPerf.setMapData?.durationMs)) ? `${Number(renderPerf.setMapData.durationMs).toFixed(1)}ms` : ""],
    [ui("Spatial Index"), Number.isFinite(Number(renderPerf.buildSpatialIndex?.durationMs)) ? `${Number(renderPerf.buildSpatialIndex.durationMs).toFixed(1)}ms` : ""],
    [ui("Static Meshes"), Number.isFinite(Number(renderPerf.rebuildStaticMeshes?.durationMs)) ? `${Number(renderPerf.rebuildStaticMeshes.durationMs).toFixed(1)}ms` : ""],
    [ui("Hit Canvas"), Number.isFinite(Number(renderPerf.buildHitCanvas?.durationMs)) ? `${Number(renderPerf.buildHitCanvas.durationMs).toFixed(1)}ms` : ""],
    [ui("Dynamic Borders"), Number.isFinite(Number(renderPerf.rebuildDynamicBorders?.durationMs)) ? `${Number(renderPerf.rebuildDynamicBorders.durationMs).toFixed(1)}ms` : ""],
    [ui("Border Reason"), String(state.dynamicBordersDirtyReason || "")],
    [ui("Political Pass"), Number.isFinite(Number(timings.political)) ? `${Number(timings.political).toFixed(1)}ms` : ""],
    [ui("Borders Pass"), Number.isFinite(Number(timings.borders)) ? `${Number(timings.borders).toFixed(1)}ms` : ""],
  ].filter(([, value]) => String(value || "").trim());
}

function resolveRuntimeRows() {
  const runtimeMeta = state.devRuntimeMeta;
  if (!runtimeMeta || typeof runtimeMeta !== "object") {
    return {
      title: "Runtime metadata unavailable",
      hint: isLocalHost()
        ? (state.devRuntimeMetaError || ui("Runtime metadata not available yet."))
        : ui("Runtime metadata is only available on the local dev server."),
      rows: [],
    };
  }
  return {
    title: String(runtimeMeta.url || "Local runtime"),
    hint: String(runtimeMeta.open_path || "/"),
    rows: [
      ["URL", String(runtimeMeta.url || "")],
      [ui("Port"), String(runtimeMeta.port || "")],
      ["PID", String(runtimeMeta.pid || "")],
      [ui("Started"), String(runtimeMeta.started_at || "")],
      [ui("Open Path"), String(runtimeMeta.open_path || "")],
      ["CWD", String(runtimeMeta.cwd || "")],
      [ui("Render Profile"), String(runtimeMeta.render_profile_default || "")],
      [ui("Topology Variant"), String(runtimeMeta.topology_variant || "")],
    ].filter(([, value]) => String(value || "").trim()),
  };
}

function renderMetaRows(container, rows) {
  if (!container) return;
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "dev-workspace-empty";
    empty.textContent = ui("No data yet.");
    container.appendChild(empty);
    return;
  }
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "dev-workspace-meta-row";

    const labelEl = document.createElement("div");
    labelEl.className = "dev-workspace-meta-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "dev-workspace-meta-value";
    valueEl.textContent = String(value || "");

    row.append(labelEl, valueEl);
    container.appendChild(row);
  });
}

async function loadRuntimeMeta() {
  if (!isLocalHost()) {
    state.devRuntimeMeta = null;
    state.devRuntimeMetaError = ui("Runtime metadata is only available on localhost.");
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  try {
    const url = new URL("/.runtime/dev/active_server.json", globalThis.location?.origin || globalThis.location?.href);
    url.searchParams.set("ts", String(Date.now()));
    const response = await fetch(url.href, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.devRuntimeMeta = await response.json();
    state.devRuntimeMetaError = "";
  } catch (error) {
    state.devRuntimeMeta = null;
    state.devRuntimeMetaError = String(error?.message || ui("Unable to fetch runtime metadata."));
  }
  state.updateDevWorkspaceUIFn?.();
}

function createDevWorkspacePanel(bottomDock) {
  let section = document.getElementById("devWorkspacePanel");
  if (section || !bottomDock) return section;

  section = document.createElement("section");
  section.id = "devWorkspacePanel";
  section.className = "dev-workspace-dock is-hidden";
  section.innerHTML = `
    <div class="dev-workspace-header">
      <div class="dev-workspace-title-row">
        <div>
          <div class="section-header sidebar-tool-title">Dev Workspace</div>
          <p id="devWorkspaceIntro" class="dev-workspace-note">Development tools take over the center dock while enabled.</p>
        </div>
      </div>
    </div>
    <div class="dev-workspace-grid">
      <div class="dev-workspace-panel">
        <div id="devFeatureInspectorLabel" class="dev-workspace-panel-title">Feature Inspector</div>
        <div id="devFeatureInspectorTitle" class="section-header-block">No active feature</div>
        <p id="devFeatureInspectorHint" class="dev-workspace-note">Hover a region or click one to inspect live debug metadata.</p>
        <div id="devFeatureInspectorMeta" class="dev-workspace-meta"></div>
      </div>
      <div id="devScenarioLocalePanel" class="dev-workspace-panel hidden">
        <div id="devScenarioLocaleLabel" class="dev-workspace-panel-title">Scenario Locale Editor</div>
        <div id="devScenarioLocaleTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioLocaleHint" class="dev-workspace-note">Select exactly one land feature to edit localized geo names.</p>
        <div id="devScenarioLocaleMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioLocaleEnLabel" class="dev-workspace-note" for="devScenarioLocaleEnInput">Localized EN</label>
        <input
          id="devScenarioLocaleEnInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Badghis"
        />
        <label id="devScenarioLocaleZhLabel" class="dev-workspace-note" for="devScenarioLocaleZhInput">Localized ZH</label>
        <textarea
          id="devScenarioLocaleZhInput"
          class="input dev-workspace-input dev-workspace-textarea"
          rows="2"
          spellcheck="false"
          placeholder="巴德吉斯"
        ></textarea>
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveLocaleBtn" type="button" class="btn-secondary">Save Localized Names</button>
        </div>
        <div id="devScenarioLocaleStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioOwnershipPanel" class="dev-workspace-panel hidden">
        <div id="devScenarioOwnershipLabel" class="dev-workspace-panel-title">Scenario Ownership Editor</div>
        <div id="devScenarioOwnershipTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioOwnershipHint" class="dev-workspace-note">Select one or more land features to edit political ownership.</p>
        <div id="devScenarioOwnershipMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioOwnerInputLabel" class="dev-workspace-note" for="devScenarioOwnerInput">Target Owner Tag</label>
        <input
          id="devScenarioOwnerInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="8"
          placeholder="GER"
        />
        <div class="dev-workspace-actions">
          <button id="devScenarioApplyOwnerBtn" type="button" class="btn-primary">Apply to Selection</button>
          <button id="devScenarioResetOwnerBtn" type="button" class="btn-secondary">Reset Selection</button>
          <button id="devScenarioSaveOwnersBtn" type="button" class="btn-secondary">Save Owners File</button>
        </div>
        <div id="devScenarioOwnershipStatus" class="dev-workspace-note"></div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devRenderStatusLabel" class="dev-workspace-panel-title">Render Status</div>
        <div id="devRenderStatusMeta" class="dev-workspace-meta"></div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devPaintMacrosLabel" class="dev-workspace-panel-title">Paint Macros</div>
        <p id="devPaintMacrosHint" class="dev-workspace-note">These actions reuse the current tool mode and selected color or owner.</p>
        <div class="dev-workspace-actions">
          <button id="devMacroCountryBtn" type="button" class="btn-secondary">Fill Country</button>
          <button id="devMacroParentBtn" type="button" class="btn-secondary">Fill Parent Group</button>
          <button id="devMacroOwnerBtn" type="button" class="btn-secondary">Fill Owner Scope</button>
          <button id="devMacroSelectionBtn" type="button" class="btn-secondary">Fill Multi-Selection</button>
        </div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devSelectionClipboardLabel" class="dev-workspace-panel-title">Selection Clipboard</div>
        <div class="dev-workspace-actions">
          <button id="devSelectionAddHoveredBtn" type="button" class="btn-secondary">Add Hovered</button>
          <button id="devSelectionToggleSelectedBtn" type="button" class="btn-secondary">Toggle Selected</button>
          <button id="devSelectionRemoveLastBtn" type="button" class="btn-secondary">Remove Last</button>
          <button id="devSelectionClearBtn" type="button" class="btn-secondary">Clear Selection</button>
        </div>
        <div class="dev-workspace-actions">
          <label id="devSelectionSortLabel" class="dev-workspace-note" for="devSelectionSortMode">Sort</label>
          <select id="devSelectionSortMode" class="select-input dev-workspace-select">
            <option value="selection">Selection Order</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div class="dev-workspace-actions">
          <button id="devCopyNamesBtn" type="button" class="btn-primary">Copy Names</button>
          <button id="devCopyNamesIdsBtn" type="button" class="btn-primary">Copy Names + ID</button>
          <button id="devCopyIdsBtn" type="button" class="btn-primary">Copy ID</button>
        </div>
        <div id="devSelectionSummary" class="dev-workspace-note">0 features selected.</div>
        <textarea id="devSelectionPreview" class="dev-selection-preview" readonly aria-label="Development selection preview"></textarea>
      </div>
      <div class="dev-workspace-panel">
        <div id="devLocalRuntimeLabel" class="dev-workspace-panel-title">Local Runtime</div>
        <div id="devRuntimeTitle" class="section-header-block">Runtime metadata unavailable</div>
        <p id="devRuntimeHint" class="dev-workspace-note"></p>
        <div id="devRuntimeMeta" class="dev-workspace-meta"></div>
      </div>
    </div>
  `;

  const headerRow = bottomDock.querySelector(".dock-header-row");
  bottomDock.insertBefore(section, headerRow?.nextSibling || bottomDock.firstChild || null);
  return section;
}

function bindButtonAction(button, action) {
  if (!button || button.dataset.bound === "true") return;
  button.addEventListener("click", action);
  button.dataset.bound = "true";
}

function updateToggleButton(toggleBtn) {
  if (!toggleBtn) return;
  const expanded = !!state.ui.devWorkspaceExpanded;
  toggleBtn.classList.toggle("is-active", expanded);
  toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-label", expanded ? ui("Hide development workspace") : ui("Show development workspace"));
  toggleBtn.setAttribute("title", expanded ? ui("Hide development workspace") : ui("Show development workspace"));
  toggleBtn.textContent = ui("Dev");
}

function syncDockState(bottomDock, expanded) {
  if (!bottomDock) return;
  bottomDock.classList.toggle("dev-workspace-mode", expanded);
  if (!expanded) return;

  state.ui.dockCollapsed = false;
  bottomDock.classList.remove("is-collapsed");
  const dockCollapseBtn = document.getElementById("dockCollapseBtn");
  if (dockCollapseBtn) {
    dockCollapseBtn.textContent = t("Collapse", "ui");
    dockCollapseBtn.setAttribute("aria-pressed", "false");
  }
}

function setExpandedState(nextValue, { bottomDock, panel, toggleBtn, persist = true } = {}) {
  const expanded = !!nextValue;
  state.ui.devWorkspaceExpanded = expanded;
  state.devSelectionModeEnabled = expanded;
  panel?.classList.toggle("is-hidden", !expanded);
  syncDockState(bottomDock, expanded);
  updateToggleButton(toggleBtn);
  if (persist) {
    writeStoredExpanded(expanded);
  }
  state.updateDevWorkspaceUIFn?.();
}

function copySelectionToClipboard(format, previewEl) {
  const text = buildClipboardText(format);
  state.devClipboardPreviewFormat = format;
  if (!text) {
    showToast("No selected regions to copy.", {
      title: ui("Selection Clipboard"),
      tone: "warning",
    });
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  state.devClipboardFallbackText = text;
  if (!globalThis.navigator?.clipboard?.writeText) {
    previewEl?.focus();
    previewEl?.select();
    showToast(ui("Clipboard API unavailable. The preview text is selected for manual copy."), {
      title: ui("Selection Clipboard"),
      tone: "warning",
      duration: 4200,
    });
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  globalThis.navigator.clipboard.writeText(text)
    .then(() => {
      showToast(
        state.currentLanguage === "zh"
          ? `已复制 ${sortSelectionEntries(resolveSelectionEntries()).length} 条地块记录到剪贴板。`
          : `Copied ${sortSelectionEntries(resolveSelectionEntries()).length} region entries to the clipboard.`,
        {
        title: ui("Selection copied"),
        tone: "success",
      });
      state.updateDevWorkspaceUIFn?.();
    })
    .catch(() => {
      previewEl?.focus();
      previewEl?.select();
      showToast(ui("Clipboard write failed. The preview text is selected for manual copy."), {
        title: ui("Selection Clipboard"),
        tone: "warning",
        duration: 4200,
      });
      state.updateDevWorkspaceUIFn?.();
    });
}

function initDevWorkspace() {
  const bottomDock = document.getElementById("bottomDock");
  const toggleBtn = document.getElementById("devWorkspaceToggleBtn");
  if (!bottomDock || !toggleBtn) return;

  const panel = createDevWorkspacePanel(bottomDock);
  if (!panel) return;

  const featureInspectorTitle = panel.querySelector("#devFeatureInspectorTitle");
  const featureInspectorHint = panel.querySelector("#devFeatureInspectorHint");
  const featureInspectorMeta = panel.querySelector("#devFeatureInspectorMeta");
  const scenarioLocalePanel = panel.querySelector("#devScenarioLocalePanel");
  const scenarioLocaleTitle = panel.querySelector("#devScenarioLocaleTitle");
  const scenarioLocaleHint = panel.querySelector("#devScenarioLocaleHint");
  const scenarioLocaleMeta = panel.querySelector("#devScenarioLocaleMeta");
  const scenarioLocaleEnInput = panel.querySelector("#devScenarioLocaleEnInput");
  const scenarioLocaleZhInput = panel.querySelector("#devScenarioLocaleZhInput");
  const scenarioLocaleStatus = panel.querySelector("#devScenarioLocaleStatus");
  const scenarioOwnershipPanel = panel.querySelector("#devScenarioOwnershipPanel");
  const scenarioOwnershipTitle = panel.querySelector("#devScenarioOwnershipTitle");
  const scenarioOwnershipHint = panel.querySelector("#devScenarioOwnershipHint");
  const scenarioOwnershipMeta = panel.querySelector("#devScenarioOwnershipMeta");
  const scenarioOwnerInput = panel.querySelector("#devScenarioOwnerInput");
  const scenarioOwnershipStatus = panel.querySelector("#devScenarioOwnershipStatus");
  const renderStatusMeta = panel.querySelector("#devRenderStatusMeta");
  const runtimeTitle = panel.querySelector("#devRuntimeTitle");
  const runtimeHint = panel.querySelector("#devRuntimeHint");
  const runtimeMeta = panel.querySelector("#devRuntimeMeta");
  const selectionSummary = panel.querySelector("#devSelectionSummary");
  const selectionPreview = panel.querySelector("#devSelectionPreview");
  const selectionSortMode = panel.querySelector("#devSelectionSortMode");

  const renderWorkspace = () => {
    panel.querySelector("#devWorkspaceIntro").textContent = ui("Development tools take over the center dock while enabled.");
    panel.querySelector("#devFeatureInspectorLabel").textContent = ui("Feature Inspector");
    panel.querySelector("#devScenarioLocaleLabel").textContent = ui("Scenario Locale Editor");
    panel.querySelector("#devScenarioLocaleEnLabel").textContent = ui("Localized EN");
    panel.querySelector("#devScenarioLocaleZhLabel").textContent = ui("Localized ZH");
    panel.querySelector("#devScenarioOwnershipLabel").textContent = ui("Scenario Ownership Editor");
    panel.querySelector("#devScenarioOwnerInputLabel").textContent = ui("Target Owner Tag");
    panel.querySelector("#devRenderStatusLabel").textContent = ui("Render Status");
    panel.querySelector("#devPaintMacrosLabel").textContent = ui("Paint Macros");
    panel.querySelector("#devPaintMacrosHint").textContent = ui("These actions reuse the current tool mode and selected color or owner.");
    panel.querySelector("#devSelectionClipboardLabel").textContent = ui("Selection Clipboard");
    panel.querySelector("#devSelectionSortLabel").textContent = ui("Sort");
    panel.querySelector("#devLocalRuntimeLabel").textContent = ui("Local Runtime");

    panel.querySelector("#devSelectionAddHoveredBtn").textContent = ui("Add Hovered");
    panel.querySelector("#devSelectionToggleSelectedBtn").textContent = ui("Toggle Selected");
    panel.querySelector("#devSelectionRemoveLastBtn").textContent = ui("Remove Last");
    panel.querySelector("#devSelectionClearBtn").textContent = ui("Clear Selection");
    panel.querySelector("#devMacroCountryBtn").textContent = ui("Fill Country");
    panel.querySelector("#devMacroParentBtn").textContent = ui("Fill Parent Group");
    panel.querySelector("#devMacroOwnerBtn").textContent = ui("Fill Owner Scope");
    panel.querySelector("#devMacroSelectionBtn").textContent = ui("Fill Multi-Selection");
    panel.querySelector("#devCopyNamesBtn").textContent = ui("Copy Names");
    panel.querySelector("#devCopyNamesIdsBtn").textContent = ui("Copy Names + ID");
    panel.querySelector("#devCopyIdsBtn").textContent = ui("Copy ID");
    selectionPreview.setAttribute("aria-label", ui("Development selection preview"));
    if (selectionSortMode?.options?.[0]) selectionSortMode.options[0].textContent = ui("Selection Order");
    if (selectionSortMode?.options?.[1]) selectionSortMode.options[1].textContent = ui("Name");

    const inspector = resolveInspectorRows();
    featureInspectorTitle.textContent = inspector.title;
    featureInspectorHint.textContent = inspector.hint || ui("Hover a region or click one to inspect live debug metadata.");
    renderMetaRows(featureInspectorMeta, inspector.rows);

    const hasActiveScenario = !!String(state.activeScenarioId || "").trim();
    const localeModel = resolveLocaleEditorModel();
    const priorLocaleEditorState = state.devLocaleEditor || {};
    const localeFeatureChanged = String(priorLocaleEditorState.featureId || "") !== String(localeModel.featureId || "");
    const localeEditorState = localeFeatureChanged
      ? {
        ...priorLocaleEditorState,
        featureId: localeModel.featureId,
        en: localeModel.mergedEntry.en,
        zh: localeModel.mergedEntry.zh,
      }
      : priorLocaleEditorState;
    if (localeFeatureChanged) {
      state.devLocaleEditor = localeEditorState;
    }
    scenarioLocalePanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioLocaleTitle) {
      scenarioLocaleTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioLocaleHint) {
      scenarioLocaleHint.textContent = resolveLocaleEditorHint(localeModel);
    }
    renderMetaRows(scenarioLocaleMeta, buildLocaleMetaRows(localeModel));
    if (scenarioLocaleEnInput && scenarioLocaleEnInput.value !== normalizeLocaleInput(localeEditorState.en)) {
      scenarioLocaleEnInput.value = normalizeLocaleInput(localeEditorState.en);
    }
    if (scenarioLocaleZhInput && scenarioLocaleZhInput.value !== normalizeLocaleInput(localeEditorState.zh)) {
      scenarioLocaleZhInput.value = normalizeLocaleInput(localeEditorState.zh);
    }
    const canEditLocale = hasActiveScenario && localeModel.selectionCount === 1 && !!localeModel.featureId && !localeEditorState.isSaving;
    if (scenarioLocaleEnInput) {
      scenarioLocaleEnInput.disabled = !canEditLocale;
      scenarioLocaleEnInput.placeholder = localeModel.baseEntry?.en || resolveFeatureName(localeModel.feature, localeModel.featureId) || "Badghis";
    }
    if (scenarioLocaleZhInput) {
      scenarioLocaleZhInput.disabled = !canEditLocale;
      scenarioLocaleZhInput.placeholder = localeModel.baseEntry?.zh || "";
    }
    const saveLocaleBtn = panel.querySelector("#devScenarioSaveLocaleBtn");
    if (saveLocaleBtn) {
      saveLocaleBtn.textContent = localeEditorState.isSaving ? ui("Saving...") : ui("Save Localized Names");
      saveLocaleBtn.disabled = !(hasActiveScenario && localeModel.hasGeoLocalePatch && localeModel.selectionCount === 1 && !!localeModel.featureId) || !!localeEditorState.isSaving;
    }
    if (scenarioLocaleStatus) {
      const localeStatusBits = [];
      if (localeEditorState.lastSaveMessage) {
        localeStatusBits.push(localeEditorState.lastSaveMessage);
      } else if (localeEditorState.lastSavedAt) {
        localeStatusBits.push(`${ui("Last Saved")}: ${localeEditorState.lastSavedAt}`);
      }
      scenarioLocaleStatus.textContent = localeStatusBits.join(" | ");
    }

    const ownershipModel = resolveOwnershipEditorModel();
    const editorState = state.devScenarioEditor || {};
    const requestedOwnerCode = normalizeOwnerInput(editorState.targetOwnerCode);
    const fallbackOwnerCode = normalizeOwnerInput(state.activeSovereignCode);
    const effectiveOwnerCode = requestedOwnerCode || fallbackOwnerCode;
    scenarioOwnershipPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioOwnershipTitle) {
      scenarioOwnershipTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioOwnershipHint) {
      scenarioOwnershipHint.textContent = resolveOwnershipEditorHint(ownershipModel);
    }
    renderMetaRows(scenarioOwnershipMeta, buildOwnershipMetaRows(ownershipModel));
    if (scenarioOwnerInput && scenarioOwnerInput.value !== requestedOwnerCode) {
      scenarioOwnerInput.value = requestedOwnerCode;
    }
    if (scenarioOwnerInput) {
      scenarioOwnerInput.placeholder = fallbackOwnerCode || "GER";
      scenarioOwnerInput.disabled = !hasActiveScenario || !!editorState.isSaving;
    }
    const statusBits = [];
    if (fallbackOwnerCode && !requestedOwnerCode) {
      statusBits.push(`${ui("Active Owner")}: ${fallbackOwnerCode}`);
    }
    if (editorState.lastSaveMessage) {
      statusBits.push(editorState.lastSaveMessage);
    } else if (editorState.lastSavedAt) {
      statusBits.push(`${ui("Last Saved")}: ${editorState.lastSavedAt}`);
    }
    if (scenarioOwnershipStatus) {
      scenarioOwnershipStatus.textContent = statusBits.join(" | ");
    }
    const canApplyOwner = hasActiveScenario && ownershipModel.selectionCount > 0 && !!effectiveOwnerCode && !editorState.isSaving;
    const canResetOwner = hasActiveScenario && ownershipModel.selectionCount > 0 && !editorState.isSaving;
    const canSaveOwners = hasActiveScenario && !editorState.isSaving;
    const applyOwnerBtn = panel.querySelector("#devScenarioApplyOwnerBtn");
    const resetOwnerBtn = panel.querySelector("#devScenarioResetOwnerBtn");
    const saveOwnersBtn = panel.querySelector("#devScenarioSaveOwnersBtn");
    if (applyOwnerBtn) {
      applyOwnerBtn.textContent = ui("Apply to Selection");
      applyOwnerBtn.disabled = !canApplyOwner;
    }
    if (resetOwnerBtn) {
      resetOwnerBtn.textContent = ui("Reset Selection");
      resetOwnerBtn.disabled = !canResetOwner;
    }
    if (saveOwnersBtn) {
      saveOwnersBtn.textContent = editorState.isSaving ? ui("Saving...") : ui("Save Owners File");
      saveOwnersBtn.disabled = !canSaveOwners;
    }

    renderMetaRows(renderStatusMeta, resolveRenderRows());

    const runtime = resolveRuntimeRows();
    runtimeTitle.textContent = runtime.title;
    runtimeHint.textContent = runtime.hint;
    renderMetaRows(runtimeMeta, runtime.rows);

    if (selectionSortMode && selectionSortMode.value !== state.devSelectionSortMode) {
      selectionSortMode.value = state.devSelectionSortMode;
    }

    const entries = sortSelectionEntries(resolveSelectionEntries());
    const entryCount = entries.length;
    selectionSummary.textContent = localizeSelectionSummary(entryCount);
    selectionPreview.value = buildClipboardText(state.devClipboardPreviewFormat || "names_with_ids")
      || state.devClipboardFallbackText
      || "";

    [
      panel.querySelector("#devCopyNamesBtn"),
      panel.querySelector("#devCopyNamesIdsBtn"),
      panel.querySelector("#devCopyIdsBtn"),
      panel.querySelector("#devSelectionRemoveLastBtn"),
      panel.querySelector("#devSelectionClearBtn"),
      panel.querySelector("#devMacroSelectionBtn"),
    ].forEach((button) => {
      if (button) {
        button.disabled = entryCount === 0;
      }
    });
  };

  state.updateDevWorkspaceUIFn = renderWorkspace;

  bindButtonAction(toggleBtn, () => {
    const next = !state.ui.devWorkspaceExpanded;
    setExpandedState(next, { bottomDock, panel, toggleBtn });
    if (next) {
      loadRuntimeMeta();
      panel.scrollTop = 0;
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  bindButtonAction(panel.querySelector("#devSelectionAddHoveredBtn"), () => {
    const hoveredId = state.devHoverHit?.targetType === "land" ? state.devHoverHit.id : state.hoveredId;
    mapRenderer.addFeatureToDevSelection(hoveredId);
  });
  bindButtonAction(panel.querySelector("#devSelectionToggleSelectedBtn"), () => {
    const selectedId = state.devSelectedHit?.targetType === "land" ? state.devSelectedHit.id : "";
    mapRenderer.toggleFeatureInDevSelection(selectedId);
  });
  bindButtonAction(panel.querySelector("#devSelectionRemoveLastBtn"), () => {
    mapRenderer.removeLastDevSelection();
  });
  bindButtonAction(panel.querySelector("#devSelectionClearBtn"), () => {
    mapRenderer.clearDevSelection();
  });

  bindButtonAction(panel.querySelector("#devMacroCountryBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentCountry();
  });
  bindButtonAction(panel.querySelector("#devMacroParentBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentParentGroup();
  });
  bindButtonAction(panel.querySelector("#devMacroOwnerBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentOwnerScope();
  });
  bindButtonAction(panel.querySelector("#devMacroSelectionBtn"), () => {
    mapRenderer.applyDevSelectionFill();
  });

  bindButtonAction(panel.querySelector("#devScenarioSaveLocaleBtn"), async () => {
    const localeModel = resolveLocaleEditorModel();
    if (!state.activeScenarioId || !localeModel.featureId) {
      showToast(ui("Select exactly one land feature before saving localized names."), {
        title: ui("Scenario Locale Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const geoLocalePatchUrl = String(state.activeScenarioManifest?.geo_locale_patch_url || "").trim();
    if (!geoLocalePatchUrl) {
      showToast(ui("The active scenario does not declare a geo locale patch target."), {
        title: ui("Scenario Locale Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const localeEditorState = state.devLocaleEditor || {};
    state.devLocaleEditor = {
      ...localeEditorState,
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/geo-locale/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: state.activeScenarioId,
          featureId: localeModel.featureId,
          en: normalizeLocaleInput(state.devLocaleEditor?.en),
          zh: normalizeLocaleInput(state.devLocaleEditor?.zh),
          mode: "manual_override",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      const patchUrl = new URL(geoLocalePatchUrl, globalThis.location?.origin || globalThis.location?.href);
      patchUrl.searchParams.set("_t", String(Date.now()));
      const patchResponse = await fetch(patchUrl.href, { cache: "no-store" });
      if (!patchResponse.ok) {
        throw new Error(`Unable to reload geo locale patch (HTTP ${patchResponse.status}).`);
      }
      const patchPayload = await patchResponse.json();
      syncScenarioLocalizationState({
        cityOverridesPayload: state.scenarioCityOverridesData,
        geoLocalePatchPayload: patchPayload,
      });
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        isSaving: false,
        featureId: localeModel.featureId,
        en: normalizeLocaleInput(state.devLocaleEditor?.en),
        zh: normalizeLocaleInput(state.devLocaleEditor?.zh),
        lastSavedAt: String(result.savedAt || ""),
        lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
        lastSaveTone: "success",
      };
      if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
      }
      showToast(ui("Scenario localized names saved."), {
        title: ui("Scenario Locale Editor"),
        tone: "success",
      });
    } catch (error) {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save localized names.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to save localized names.")), {
        title: ui("Scenario Locale Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioApplyOwnerBtn"), () => {
    const targetIds = resolveOwnershipTargetIds();
    const requestedOwnerCode = normalizeOwnerInput(state.devScenarioEditor?.targetOwnerCode);
    const ownerCode = requestedOwnerCode || normalizeOwnerInput(state.activeSovereignCode);
    const result = applyOwnerToFeatureIds(targetIds, ownerCode, {
      historyKind: "dev-workspace-ownership-apply",
      dirtyReason: "dev-workspace-ownership-apply",
      recomputeReason: "dev-workspace-ownership-apply",
    });
    if (!result.applied) {
      const message = result.reason === "missing-owner"
        ? ui("Enter a target owner tag or choose an active owner first.")
        : ui("Select one or more land features before applying ownership.");
      showToast(message, {
        title: ui("Scenario Ownership Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const changedLabel = result.changed === 1 ? ui("feature") : ui("features");
    showToast(`${ui("Applied ownership to")} ${result.changed} ${changedLabel}.`, {
      title: ui("Scenario Ownership Editor"),
      tone: result.changed > 0 ? "success" : "info",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioResetOwnerBtn"), () => {
    const result = resetOwnersToScenarioBaselineForFeatureIds(resolveOwnershipTargetIds(), {
      historyKind: "dev-workspace-ownership-reset",
      dirtyReason: "dev-workspace-ownership-reset",
      recomputeReason: "dev-workspace-ownership-reset",
    });
    if (!result.applied) {
      showToast(ui("Select one or more land features with scenario ownership before resetting."), {
        title: ui("Scenario Ownership Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(
      result.changed > 0
        ? `${ui("Reset ownership for")} ${result.changed} ${result.changed === 1 ? ui("feature") : ui("features")}.`
        : ui("Selected features already match the active scenario baseline."),
      {
        title: ui("Scenario Ownership Editor"),
        tone: result.changed > 0 ? "success" : "info",
      }
    );
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioSaveOwnersBtn"), async () => {
    if (!state.activeScenarioId || state.devScenarioEditor?.isSaving) return;
    const payload = buildScenarioOwnershipSavePayload();
    state.devScenarioEditor = {
      ...(state.devScenarioEditor || {}),
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/ownership/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: payload.scenarioId,
          baselineHash: payload.baselineHash,
          owners: payload.owners,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        isSaving: false,
        lastSavedAt: String(result.savedAt || ""),
        lastSavedPath: String(result.filePath || ""),
        lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
        lastSaveTone: "success",
      };
      showToast(ui("Scenario ownership file saved."), {
        title: ui("Scenario Ownership Editor"),
        tone: "success",
      });
    } catch (error) {
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save ownership file.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to save ownership file.")), {
        title: ui("Scenario Ownership Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devCopyNamesBtn"), () => {
    copySelectionToClipboard("names", selectionPreview);
  });
  bindButtonAction(panel.querySelector("#devCopyNamesIdsBtn"), () => {
    copySelectionToClipboard("names_with_ids", selectionPreview);
  });
  bindButtonAction(panel.querySelector("#devCopyIdsBtn"), () => {
    copySelectionToClipboard("ids", selectionPreview);
  });

  if (selectionSortMode && selectionSortMode.dataset.bound !== "true") {
    selectionSortMode.addEventListener("change", (event) => {
      state.devSelectionSortMode = String(event.target.value || "selection") === "name" ? "name" : "selection";
      renderWorkspace();
    });
    selectionSortMode.dataset.bound = "true";
  }

  if (scenarioOwnerInput && scenarioOwnerInput.dataset.bound !== "true") {
    scenarioOwnerInput.addEventListener("input", (event) => {
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        targetOwnerCode: normalizeOwnerInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioOwnerInput.dataset.bound = "true";
  }

  if (scenarioLocaleEnInput && scenarioLocaleEnInput.dataset.bound !== "true") {
    scenarioLocaleEnInput.addEventListener("input", (event) => {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        en: normalizeLocaleInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioLocaleEnInput.dataset.bound = "true";
  }

  if (scenarioLocaleZhInput && scenarioLocaleZhInput.dataset.bound !== "true") {
    scenarioLocaleZhInput.addEventListener("input", (event) => {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        zh: normalizeLocaleInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioLocaleZhInput.dataset.bound = "true";
  }

  const initialExpanded = readStoredExpanded();
  setExpandedState(initialExpanded, {
    bottomDock,
    panel,
    toggleBtn,
    persist: false,
  });
  renderWorkspace();
  loadRuntimeMeta();
}

export { initDevWorkspace };
