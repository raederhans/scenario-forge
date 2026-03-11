import { state } from "../core/state.js";
import * as mapRenderer from "../core/map_renderer.js";
import { getFeatureOwnerCode } from "../core/sovereignty_manager.js";
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
