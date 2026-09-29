import { state as runtimeState } from "../../core/state.js";
import { applyDeclarativeTranslations, t } from "../i18n.js";
const state = runtimeState;

function ui(key) {
  return t(key, "ui");
}

/**
 * Dev workspace shell builder.
 * 这里统一接管 panel / quickbar 的 DOM 搭建，以及展开态对应的 dock chrome 同步。
 * dev_workspace.js 继续保留 init facade、controller 装配、持久化和总刷新回调。
 */
export function createDevWorkspacePanel(bottomDock) {
  let section = document.getElementById("devWorkspacePanel");
  if (section || !bottomDock) return section;

  section = document.createElement("section");
  section.id = "devWorkspacePanel";
  section.className = "dev-workspace-dock is-hidden";
  section.innerHTML = `
    <div class="dev-workspace-category-strip">
      <div class="dev-workspace-category-tabs" role="tablist" aria-label="Development workspace sections" data-i18n-aria-label="Development workspace sections">
        <button id="devWorkspaceTabSelection" type="button" class="dev-workspace-category-tab is-active" data-dev-workspace-category="selection" role="tab" aria-selected="true" data-i18n="Selection">
          Selection
        </button>
        <button id="devWorkspaceTabScenario" type="button" class="dev-workspace-category-tab" data-dev-workspace-category="scenario" role="tab" aria-selected="false" data-i18n="Scenario Data">
          Scenario Data
        </button>
        <button id="devWorkspaceTabRuntime" type="button" class="dev-workspace-category-tab" data-dev-workspace-category="runtime" role="tab" aria-selected="false" data-i18n="Diagnostics & Runtime">
          Diagnostics &amp; Runtime
        </button>
      </div>
    </div>
    <div class="dev-workspace-grid">
      <div class="dev-workspace-panel" data-dev-category="selection">
        <div id="devSelectionClipboardLabel" class="dev-workspace-panel-title" data-i18n="Selection Clipboard"></div>
        <div class="dev-workspace-actions">
          <button id="devSelectionAddHoveredBtn" type="button" class="btn-secondary" data-i18n="Add Hovered"></button>
          <button id="devSelectionToggleSelectedBtn" type="button" class="btn-secondary" data-i18n="Toggle Selected"></button>
          <button id="devSelectionRemoveLastBtn" type="button" class="btn-secondary" data-i18n="Remove Last"></button>
          <button id="devSelectionClearBtn" type="button" class="btn-secondary" data-i18n="Clear Selection"></button>
        </div>
        <div class="dev-workspace-actions">
          <label id="devSelectionSortLabel" class="dev-workspace-note" for="devSelectionSortMode" data-i18n="Sort"></label>
          <select id="devSelectionSortMode" class="select-input dev-workspace-select">
            <option value="selection" data-i18n="Selection Order"></option>
            <option value="name" data-i18n="Name"></option>
          </select>
        </div>
        <div class="dev-workspace-actions">
          <button id="devCopyNamesBtn" type="button" class="btn-primary" data-i18n="Copy Names"></button>
          <button id="devCopyNamesIdsBtn" type="button" class="btn-primary" data-i18n="Copy Names + ID"></button>
          <button id="devCopyIdsBtn" type="button" class="btn-primary" data-i18n="Copy ID"></button>
        </div>
        <div id="devSelectionSummary" class="dev-workspace-note"></div>
        <textarea id="devSelectionPreview" class="dev-selection-preview" readonly data-i18n-aria-label="Development selection preview"></textarea>
      </div>
      <div class="dev-workspace-panel" data-dev-category="selection">
        <div id="devFeatureInspectorLabel" class="dev-workspace-panel-title" data-i18n="Feature Inspector"></div>
        <div id="devFeatureInspectorTitle" class="section-header-block" data-i18n="No active feature"></div>
        <div id="devFeatureInspectorMeta" class="dev-workspace-meta"></div>
      </div>
      <div id="devScenarioTagInspectorPanel" class="dev-workspace-panel hidden" data-dev-category="selection">
        <div id="devScenarioTagInspectorLabel" class="dev-workspace-panel-title" data-i18n="Tag Inspector"></div>
        <div id="devScenarioTagInspectorTitle" class="section-header-block"></div>
        <p id="devScenarioTagInspectorHint" class="dev-workspace-note"></p>
        <div id="devScenarioTagInspectorMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioTagInspectorThresholdLabel" class="dev-workspace-note" for="devScenarioTagInspectorThresholdInput" data-i18n="Low Feature Threshold"></label>
        <input id="devScenarioTagInspectorThresholdInput" class="input dev-workspace-input" type="number" min="0" max="999" step="1" />
        <label class="dev-workspace-note" for="devScenarioTagInspectorSelect">${ui("Scenario Tag")}</label>
        <select id="devScenarioTagInspectorSelect" class="select-input dev-workspace-select">
          <option value="">${ui("Select country")}</option>
        </select>
        <div class="dev-workspace-actions">
          <button id="devScenarioTagInspectorClearHighlightBtn" type="button" class="btn-secondary" data-i18n="Clear Highlight"></button>
        </div>
        <div id="devScenarioTagInspectorDetails" class="dev-workspace-meta"></div>
        <div id="devScenarioTagInspectorStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioCountryPanel" class="dev-workspace-panel hidden" data-dev-category="scenario">
        <div id="devScenarioCountryLabel" class="dev-workspace-panel-title" data-i18n="Country Name Editor"></div>
        <div id="devScenarioCountryTitle" class="section-header-block"></div>
        <p id="devScenarioCountryHint" class="dev-workspace-note"></p>
        <div id="devScenarioCountryMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioCountrySelectLabel" class="dev-workspace-note" for="devScenarioCountrySelect" data-i18n="Scenario Tag"></label>
        <select id="devScenarioCountrySelect" class="select-input dev-workspace-select">
          <option value="" data-i18n="Select country"></option>
        </select>
        <label id="devScenarioCountryNameEnLabel" class="dev-workspace-note" for="devScenarioCountryNameEnInput" data-i18n="English Name"></label>
        <input id="devScenarioCountryNameEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" />
        <label id="devScenarioCountryNameZhLabel" class="dev-workspace-note" for="devScenarioCountryNameZhInput" data-i18n="Chinese Name"></label>
        <input id="devScenarioCountryNameZhInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" />
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveCountryBtn" type="button" class="btn-primary" data-i18n="Save Country Names"></button>
        </div>
        <div id="devScenarioCountryStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioCapitalPanel" class="dev-workspace-panel hidden" data-dev-category="scenario">
        <div id="devScenarioCapitalLabel" class="dev-workspace-panel-title" data-i18n="Capital Editor"></div>
        <div id="devScenarioCapitalTitle" class="section-header-block"></div>
        <p id="devScenarioCapitalHint" class="dev-workspace-note"></p>
        <div id="devScenarioCapitalMeta" class="dev-workspace-meta"></div>
        <label class="dev-workspace-note" for="devScenarioCapitalSearchInput">${ui("Search country")}</label>
        <input id="devScenarioCapitalSearchInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" />
        <div id="devScenarioCapitalSearchResults" class="dev-workspace-meta"></div>
        <label id="devScenarioCapitalSelectLabel" class="dev-workspace-note" for="devScenarioCapitalSelect" data-i18n="Scenario Tag"></label>
        <select id="devScenarioCapitalSelect" class="select-input dev-workspace-select">
          <option value="" data-i18n="Select country"></option>
        </select>
        <div id="devScenarioCapitalCandidate" class="dev-workspace-note"></div>
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveCapitalBtn" type="button" class="btn-primary" data-i18n="Save Capital"></button>
        </div>
        <div id="devScenarioCapitalStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioDistrictPanel" class="dev-workspace-panel hidden" data-dev-category="scenario">
        <div id="devScenarioDistrictLabel" class="dev-workspace-panel-title" data-i18n="Scenario District Editor"></div>
        <div id="devScenarioDistrictTitle" class="section-header-block"></div>
        <p id="devScenarioDistrictHint" class="dev-workspace-note"></p>
        <div id="devScenarioDistrictMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioDistrictTagLabel" class="dev-workspace-note" for="devScenarioDistrictTagInput" data-i18n="Scenario Tag"></label>
        <input id="devScenarioDistrictTagInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="4" placeholder="FRA" />
        <div id="devScenarioDistrictTagModeNote" class="dev-workspace-note"></div>
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictUseSelectionBtn" type="button" class="btn-secondary" data-i18n="Use Selection Tag"></button>
          <button id="devScenarioDistrictClearBtn" type="button" class="btn-secondary" data-i18n="Clear"></button>
        </div>
        <label id="devScenarioDistrictSelectLabel" class="dev-workspace-note" for="devScenarioDistrictSelect" data-i18n="District"></label>
        <select id="devScenarioDistrictSelect" class="select-input dev-workspace-select">
          <option value="" data-i18n="Select district"></option>
        </select>
        <label id="devScenarioDistrictIdLabel" class="dev-workspace-note" for="devScenarioDistrictIdInput" data-i18n="District ID"></label>
        <input id="devScenarioDistrictIdInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="64" placeholder="berlin" />
        <label id="devScenarioDistrictNameEnLabel" class="dev-workspace-note" for="devScenarioDistrictNameEnInput" data-i18n="English Name"></label>
        <input id="devScenarioDistrictNameEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="Berlin" />
        <label id="devScenarioDistrictNameZhLabel" class="dev-workspace-note" for="devScenarioDistrictNameZhInput" data-i18n="Chinese Name"></label>
        <input id="devScenarioDistrictNameZhInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="Berlin" />
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictUpsertBtn" type="button" class="btn-secondary" data-i18n="Upsert District"></button>
          <button id="devScenarioDistrictAssignBtn" type="button" class="btn-secondary" data-i18n="Assign Selection"></button>
          <button id="devScenarioDistrictRemoveBtn" type="button" class="btn-secondary" data-i18n="Remove Selection"></button>
        </div>
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictDeleteBtn" type="button" class="btn-secondary" data-i18n="Delete Empty District"></button>
          <button id="devScenarioDistrictSaveBtn" type="button" class="btn-primary" data-i18n="Save Districts File"></button>
        </div>
        <label id="devScenarioDistrictTemplateLabel" class="dev-workspace-note" for="devScenarioDistrictTemplateTagInput" data-i18n="Shared Template Tag"></label>
        <input id="devScenarioDistrictTemplateTagInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="4" placeholder="FRA" />
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictPromoteBtn" type="button" class="btn-secondary" data-i18n="Promote To Shared Template"></button>
          <button id="devScenarioDistrictApplyTemplateBtn" type="button" class="btn-secondary" data-i18n="Apply Shared Template"></button>
        </div>
        <div id="devScenarioDistrictStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioLocalePanel" class="dev-workspace-panel hidden" data-dev-category="scenario">
        <div id="devScenarioLocaleLabel" class="dev-workspace-panel-title" data-i18n="Scenario Locale Editor"></div>
        <div id="devScenarioLocaleTitle" class="section-header-block"></div>
        <p id="devScenarioLocaleHint" class="dev-workspace-note"></p>
        <div id="devScenarioLocaleMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioLocaleEnLabel" class="dev-workspace-note" for="devScenarioLocaleEnInput" data-i18n="Localized EN"></label>
        <input id="devScenarioLocaleEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="Badghis" />
        <label id="devScenarioLocaleZhLabel" class="dev-workspace-note" for="devScenarioLocaleZhInput" data-i18n="Localized ZH"></label>
        <textarea id="devScenarioLocaleZhInput" class="input dev-workspace-input dev-workspace-textarea" rows="2" spellcheck="false" data-i18n-placeholder="Localized name"></textarea>
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveLocaleBtn" type="button" class="btn-secondary" data-i18n="Save Localized Names"></button>
        </div>
        <div id="devScenarioLocaleStatus" class="dev-workspace-note"></div>
      </div>
      <div class="dev-workspace-panel" data-dev-category="runtime">
        <div id="devRenderStatusLabel" class="dev-workspace-panel-title" data-i18n="Render Status"></div>
        <div id="devRenderStatusMeta" class="dev-workspace-meta"></div>
      </div>
      <div class="dev-workspace-panel" data-dev-category="runtime">
        <div id="devPaintMacrosLabel" class="dev-workspace-panel-title" data-i18n="Paint Macros"></div>
        <p id="devPaintMacrosHint" class="dev-workspace-note" data-i18n="These actions reuse the current tool mode and selected color or owner."></p>
        <div class="dev-workspace-actions">
          <button id="devMacroCountryBtn" type="button" class="btn-secondary" data-i18n="Fill Country"></button>
          <button id="devMacroParentBtn" type="button" class="btn-secondary" data-i18n="Fill Parent Group"></button>
          <button id="devMacroOwnerBtn" type="button" class="btn-secondary" data-i18n="Fill Owner Scope"></button>
          <button id="devMacroSelectionBtn" type="button" class="btn-secondary" data-i18n="Fill Multi-Selection"></button>
        </div>
      </div>
    </div>
  `;

  const dockPrimary = bottomDock.querySelector(".bottom-dock-primary");
  bottomDock.insertBefore(section, dockPrimary || null);
  applyDeclarativeTranslations(section);
  return section;
}

export function createDevWorkspaceQuickbar(bottomDock) {
  let quickbar = document.getElementById("devWorkspaceQuickbar");
  if (quickbar || !bottomDock) return quickbar;

  quickbar = document.createElement("div");
  quickbar.id = "devWorkspaceQuickbar";
  quickbar.className = "dev-workspace-quickbar";
  quickbar.innerHTML = `
    <span class="dev-quickbar-badge" aria-hidden="true">DEV</span>
    <div class="dev-workspace-quick-meta">
      <div class="dev-quick-meta">
        <span class="dev-quick-label" data-i18n="Current Selection"></span>
        <span id="devQuickSelectionValue" class="dev-quick-value">0</span>
      </div>
      <div class="dev-quick-meta">
        <span class="dev-quick-label" data-i18n="Tag"></span>
        <span id="devQuickTagValue" class="dev-quick-value">--</span>
      </div>
      <div class="dev-quick-meta">
        <span class="dev-quick-label" data-i18n="Owner"></span>
        <span id="devQuickOwnerValue" class="dev-quick-value">--</span>
      </div>
      <div class="dev-quick-meta">
        <span class="dev-quick-label" data-i18n="Controller"></span>
        <span id="devQuickControllerValue" class="dev-quick-value">--</span>
      </div>
    </div>
    <div class="dev-workspace-quick-owner">
      <span class="dev-quick-label" data-i18n="Selection"></span>
      <div class="dev-workspace-quick-owner-row">
        <div class="dev-workspace-quick-owner-controls">
          <button id="devQuickRemoveSelectedBtn" type="button" class="btn-secondary" data-i18n="Remove Selection"></button>
        </div>
      </div>
    </div>
    <div class="dev-workspace-quick-secondary" role="toolbar" aria-label="Development utility actions" data-i18n-aria-label="Development utility actions">
      <button id="devQuickRebuildBordersBtn" type="button" class="btn-secondary" data-i18n="Recalculate Borders" data-i18n-title="Rebuild political borders based on current ownership"></button>
    </div>
  `;

  const dockPrimary = bottomDock.querySelector(".bottom-dock-primary");
  bottomDock.insertBefore(quickbar, dockPrimary || null);
  applyDeclarativeTranslations(quickbar);
  return quickbar;
}

function updateToggleButton(toggleBtn) {
  if (!toggleBtn) return;
  const expanded = !!runtimeState.ui.devWorkspaceExpanded;
  let label = toggleBtn.querySelector(".dev-workspace-toggle-label");
  if (!label) {
    label = document.createElement("span");
    label.className = "dev-workspace-toggle-label";
    toggleBtn.replaceChildren(label);
  }
  toggleBtn.classList.toggle("is-active", expanded);
  toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-label", expanded ? ui("Hide development workspace") : ui("Show development workspace"));
  toggleBtn.setAttribute("title", expanded ? ui("Hide development workspace") : ui("Show development workspace"));
  label.textContent = ui("Dev");
}

function syncDockState(bottomDock, expanded) {
  if (!bottomDock) return;
  bottomDock.classList.toggle("dev-workspace-mode", expanded);
  if (!expanded) return;

  runtimeState.ui.dockCollapsed = false;
  bottomDock.classList.remove("is-collapsed");
  const dockCollapseBtn = document.getElementById("dockCollapseBtn");
  if (dockCollapseBtn) {
    dockCollapseBtn.setAttribute("aria-pressed", "false");
    dockCollapseBtn.setAttribute("aria-label", t("Collapse quick dock", "ui"));
    dockCollapseBtn.setAttribute("title", t("Collapse", "ui"));
  }
}

export function applyDevWorkspaceExpandedChrome({ bottomDock, toggleBtn, expanded, updateDockCollapsedUi } = {}) {
  syncDockState(bottomDock, expanded);
  updateToggleButton(toggleBtn);
  updateDockCollapsedUi?.();
}

