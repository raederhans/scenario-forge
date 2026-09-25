import { isOwnershipEditingEnabled } from "../../core/map_editing_policy.js";
import { createCountryInspectorModel } from "./country_inspector_model.js";
import {
  ensureInspectorExpansionState,
  markInspectorExpansionInitializedState,
  setInspectorContinentExpandedState,
  setHgoIdentityVariantSelectionState,
} from "../../core/state/actions/scenario_presentation_actions.js";

/**
 * Owns the country inspector explorer panel:
 * - country list rendering
 * - search/grouped explorer rendering
 * - selected country detail rendering
 * - active owner / color picker interactions
 *
 * sidebar.js keeps the higher-level facade:
 * - scenario action/preset tree
 * - cross-panel orchestration
 * - runtimeState callback registration
 * - shared scenario/releasable domain helpers
 */
const HGO_VARIANT_LABEL_KEYS = Object.freeze({
  anarchism_ideology: "Anarchism ideology",
  anarchism_neutrality: "Anarchist neutrality",
  authoritarian_monarchism: "Authoritarian monarchism",
  authoritatian_monarchism: "Authoritarian monarchism",
  centrist_monarchism: "Centrist monarchism",
  centrist_republic: "Centrist republic",
  communism: "Communism",
  communist: "Communism",
  conservative_constitutionalism: "Conservative constitutionalism",
  conservative_monarchism: "Conservative monarchism",
  democracy: "Democracy",
  democratic: "Democratic",
  democratic_monarchism: "Democratic monarchism",
  fascism: "Fascism",
  left_anarchism: "Left anarchism",
  liberal_republic: "Liberal republic",
  monarchism: "Monarchism",
  monarchisn: "Monarchism",
  national_socialim: "National socialism",
  national_socialism: "National socialism",
  neutrality: "Neutrality",
  proclaimed_communism: "Proclaimed communism",
  republican_fascism: "Republican fascism",
  right_anarchism: "Right anarchism",
  socialism_ideology: "Socialism ideology",
  socialism_monarchy: "Socialist monarchy",
  socialist_ideology: "Socialism ideology",
  socialist_monarchy: "Socialist monarchy",
  stratocracy: "Stratocracy",
  stratocratic: "Stratocratic",
  stratocratic_monarchism: "Stratocratic monarchism",
  theocractic: "Theocratic",
  theocracy: "Theocracy",
  theocratic: "Theocratic",
  vanguardism: "Vanguardism",
});

const HGO_VARIANT_LABEL_SUFFIXES = Object.freeze(
  Object.keys(HGO_VARIANT_LABEL_KEYS).sort((a, b) => b.length - a.length),
);

export function createCountryInspectorController({
  runtimeState,
  list,
  searchInput,
  selectedCountryActionsSection,
  countryInspectorDetail,
  countryInspectorSelected,
  countryInspectorSetActive,
  countryInspectorDetailHint,
  countryInspectorColorRow,
  countryInspectorColorSwatch,
  countryInspectorColorInput,
  countryRowRefsByCode,
  getLatestCountryStatesByCode,
  setLatestCountryStatesByCode,
  getCountryInspectorColorPickerOpen,
  setCountryInspectorColorPickerOpen,
  t,
  normalizeCountryCode,
  normalizeHexColor,
  updateScenarioInspectorLayout,
  scheduleAdaptiveInspectorHeights,
  flushSidebarRender,
  createEmptyNote,
  getDynamicCountryEntries,
  createCountryInspectorState,
  getCountryChildSectionsForParent,
  buildCountryRowMetaText,
  getResolvedCountryColor,
  getDisplayCountryColor,
  getPrimaryReleasablePresetRef,
  applyScenarioReleasableCoreTerritory,
  applyCountryColor,
  incrementSidebarCounter,
  markDirty,
  showToast,
  getHgoIdentity = null,
  getHgoIdentityCoverage = null,
  getHgoIdentityStatus = null,
  getSelectedLandInspectorCountryCode = null,
  onHgoIdentityRetry = null,
  onHgoIdentitySettingsChange = null,
}) {
  const {
    buildInspectorTopLevelCountryEntries,
    getPriorityCountryOrderMap,
    compareInspectorCountries,
    buildCountryColorTree,
    getDefaultExpandedInspectorGroupId,
    getInspectorGroupExpansionKey,
  } = createCountryInspectorModel(runtimeState, t);

  function ensureInitialInspectorExpansion(groupedEntries = []) {
    if (runtimeState.inspectorExpansionInitialized || !groupedEntries.length) return;
    ensureInspectorExpansionState(runtimeState);

    if (runtimeState.expandedInspectorContinents.size > 0) {
      markInspectorExpansionInitializedState(runtimeState);
      return;
    }

    const defaultGroupId = getDefaultExpandedInspectorGroupId(groupedEntries);
    if (defaultGroupId) {
      setInspectorContinentExpandedState(
        runtimeState,
        getInspectorGroupExpansionKey(defaultGroupId),
        true,
      );
    }
    markInspectorExpansionInitializedState(runtimeState);
  }

  const getSearchTerm = () => (searchInput?.value || "").trim().toLowerCase();

  const ensureHgoIdentitySettings = () => {
    if (!runtimeState.hgoIdentity || typeof runtimeState.hgoIdentity !== "object") {
      runtimeState.hgoIdentity = {};
    }
    runtimeState.hgoIdentity.enabled = runtimeState.hgoIdentity.enabled === true;
    runtimeState.hgoIdentity.nameMode = runtimeState.hgoIdentity.nameMode === "hgo" ? "hgo" : "scenario";
    runtimeState.hgoIdentity.showSuggestedAliases = runtimeState.hgoIdentity.showSuggestedAliases !== false;
    if (!runtimeState.hgoIdentity.variantSelections || typeof runtimeState.hgoIdentity.variantSelections !== "object") {
      runtimeState.hgoIdentity.variantSelections = {};
    }
    return runtimeState.hgoIdentity;
  };

  const isCountryInspectorDetailsVisible = () => runtimeState.countryInspectorShowDetails === true;

  const setCountryInspectorDetailsVisible = (visible) => {
    runtimeState.countryInspectorShowDetails = visible === true;
  };

  const getCountryHgoIdentity = (countryState) => {
    const settings = ensureHgoIdentitySettings();
    if (!settings.enabled || typeof getHgoIdentity !== "function") return null;
    const countryCode = normalizeCountryCode(countryState?.code || countryState?.tag || "");
    return getHgoIdentity(countryState, {
      nameMode: settings.nameMode,
      allowSuggestedAliases: settings.showSuggestedAliases,
      preferredVariantKey: settings.variantSelections[countryCode] || "",
    });
  };

  const getCountryInspectorDisplayName = (countryState, identity = null) => {
    const settings = ensureHgoIdentitySettings();
    if (settings.enabled && settings.nameMode === "hgo" && identity?.displayName) {
      return identity.displayName;
    }
    return countryState?.displayName || countryState?.name || countryState?.code || "";
  };

  const getHgoMatchLabel = (matchKind = "") => {
    const labels = {
      exact: "exact",
      reviewed_alias: "reviewed alias",
      suggested_alias: "suggested alias",
      missing: "missing",
    };
    return labels[String(matchKind || "").trim()] || "missing";
  };

  const getHgoBadgeTone = (matchKind = "") => (
    String(matchKind || "").trim() === "suggested_alias" ? "weak" : "strong"
  );

  const appendHgoBadge = (parent, text, { tone = "strong" } = {}) => {
    if (!parent || !text) return null;
    const badge = document.createElement("span");
    badge.className = `hgo-identity-badge hgo-identity-badge-${tone}`;
    badge.textContent = text;
    parent.appendChild(badge);
    return badge;
  };

  const getFlagTierUrl = (identity, preferredTier = "small", { allowPreferredFallback = true } = {}) => {
    const tier = identity?.flag?.preferredVariantFlag
      || identity?.flag?.base?.[preferredTier]
      || (allowPreferredFallback ? identity?.flag?.preferredBaseFlag : null);
    return String(tier?.pngPath || tier?.png_path || "").trim();
  };

  const formatHgoVariantRawLabel = (value = "") => {
    const normalized = String(value || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if (!normalized) return "";
    return normalized.replace(/\b[a-z]/g, (char) => char.toUpperCase());
  };

  const formatHgoVariantPrefixLabel = (value = "") => {
    const normalized = String(value || "").trim().replace(/[-\s]+/g, "_").replace(/_+/g, "_");
    if (/^[a-z0-9]{2,5}$/i.test(normalized)) {
      return normalized.toUpperCase();
    }
    return formatHgoVariantRawLabel(normalized);
  };

  const formatHgoVariantLabel = (value = "") => {
    const raw = String(value || "").trim();
    const normalizedRawKey = raw.replace(/[-\s]+/g, "_").replace(/_+/g, "_");
    const normalizedKey = normalizedRawKey.toLowerCase();
    if (!normalizedKey) return "";
    const exactLabelKey = HGO_VARIANT_LABEL_KEYS[normalizedKey];
    if (exactLabelKey) return t(exactLabelKey, "ui");
    const matchedSuffix = HGO_VARIANT_LABEL_SUFFIXES.find(
      (suffix) => normalizedKey.endsWith(`_${suffix}`),
    );
    if (matchedSuffix) {
      const prefix = normalizedRawKey.slice(0, -(matchedSuffix.length + 1));
      const prefixLabel = formatHgoVariantPrefixLabel(prefix);
      const translatedSuffix = t(HGO_VARIANT_LABEL_KEYS[matchedSuffix], "ui");
      return prefixLabel ? `${prefixLabel} · ${translatedSuffix}` : translatedSuffix;
    }
    return formatHgoVariantRawLabel(raw);
  };

  const getRowMetaText = (countryState, identity, { showDetails = false, showRelationMeta = false } = {}) => {
    if (!showDetails) return "";
    const metaBits = [
      buildCountryRowMetaText(countryState, { showRelationMeta }),
      countryState?.code ? `tag ${countryState.code}` : "",
    ].filter(Boolean);
    if (identity) {
      metaBits.push(getHgoMatchLabel(identity.matchKind));
      const variantCount = Number(identity.flag?.variantCount || identity.flag?.variants?.length || 0) || 0;
      if (variantCount > 0) {
        metaBits.push(`${variantCount} variants`);
      }
    }
    return metaBits.join(" · ");
  };

  const updateFlagImage = (image, identity, preferredTier = "small") => {
    if (!image) return;
    const flagUrl = getFlagTierUrl(identity, preferredTier);
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.classList.toggle("hidden", !flagUrl);
    if (flagUrl) {
      image.src = flagUrl;
    } else {
      image.removeAttribute("src");
    }
  };

  const renderHgoIdentityControls = (countryStates = []) => {
    const host = list?.parentElement;
    if (!host) return;
    const settings = ensureHgoIdentitySettings();
    let controls = host.querySelector("[data-hgo-identity-controls]");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "hgo-identity-controls";
      controls.dataset.hgoIdentityControls = "true";
      host.insertBefore(controls, list);
    }
    const status = typeof getHgoIdentityStatus === "function" ? getHgoIdentityStatus() : { status: "disabled" };
    const coverage = settings.enabled && typeof getHgoIdentityCoverage === "function"
      ? getHgoIdentityCoverage(countryStates, { allowSuggestedAliases: settings.showSuggestedAliases })
      : null;
    const statusText = !settings.enabled
      ? t("HGO disabled", "ui")
      : (status?.status === "loading" ? t("HGO loading", "ui") : t("HGO unavailable", "ui"));
    const coverageText = coverage ? "" : statusText;

    controls.replaceChildren();

    const topRow = document.createElement("div");
    topRow.className = "hgo-identity-control-row";

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "toggle-label hgo-identity-toggle";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.className = "checkbox-input";
    enabledInput.checked = settings.enabled;
    enabledInput.addEventListener("change", () => {
      settings.enabled = !!enabledInput.checked;
      onHgoIdentitySettingsChange?.();
    });
    const enabledText = document.createElement("span");
    enabledText.textContent = t("HGO identity", "ui");
    enabledLabel.appendChild(enabledInput);
    enabledLabel.appendChild(enabledText);

    const summary = document.createElement("span");
    summary.className = "hgo-identity-summary";
    summary.textContent = coverageText;

    topRow.appendChild(enabledLabel);
    if (coverageText) {
      topRow.appendChild(summary);
    }
    if (status?.status === "error") {
      const retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.className = "hgo-identity-retry-btn";
      retryButton.textContent = t("Retry", "ui");
      retryButton.addEventListener("click", () => {
        onHgoIdentityRetry?.();
      });
      topRow.appendChild(retryButton);
    }
    controls.appendChild(topRow);

    const modeRow = document.createElement("div");
    modeRow.className = "hgo-identity-mode-row";
    [
      ["scenario", t("Scenario names", "ui")],
      ["hgo", t("HGO names", "ui")],
    ].forEach(([mode, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hgo-identity-mode-btn";
      button.classList.toggle("is-active", settings.nameMode === mode);
      button.setAttribute("aria-pressed", String(settings.nameMode === mode));
      button.textContent = label;
      button.disabled = !settings.enabled;
      button.addEventListener("click", () => {
        settings.nameMode = mode;
        onHgoIdentitySettingsChange?.();
      });
      modeRow.appendChild(button);
    });
    controls.appendChild(modeRow);

    const detailsLabel = document.createElement("label");
    detailsLabel.className = "toggle-label country-inspector-details-toggle";
    const detailsInput = document.createElement("input");
    detailsInput.type = "checkbox";
    detailsInput.className = "checkbox-input";
    detailsInput.checked = isCountryInspectorDetailsVisible();
    detailsInput.addEventListener("change", () => {
      setCountryInspectorDetailsVisible(detailsInput.checked);
      onHgoIdentitySettingsChange?.();
    });
    const detailsText = document.createElement("span");
    detailsText.textContent = t("Show more info", "ui");
    detailsLabel.appendChild(detailsInput);
    detailsLabel.appendChild(detailsText);
    controls.appendChild(detailsLabel);

    const suggestedLabel = document.createElement("label");
    suggestedLabel.className = "toggle-label hgo-identity-suggested-toggle";
    const suggestedInput = document.createElement("input");
    suggestedInput.type = "checkbox";
    suggestedInput.className = "checkbox-input";
    suggestedInput.checked = settings.showSuggestedAliases;
    suggestedInput.disabled = !settings.enabled;
    suggestedInput.addEventListener("change", () => {
      settings.showSuggestedAliases = !!suggestedInput.checked;
      onHgoIdentitySettingsChange?.();
    });
    const suggestedText = document.createElement("span");
    suggestedText.textContent = t("Show suggested aliases", "ui");
    suggestedLabel.appendChild(suggestedInput);
    suggestedLabel.appendChild(suggestedText);
    controls.appendChild(suggestedLabel);
  };

  const resolveSelectedLandInspectorCountryState = () => {
    const selectedLandCode = typeof getSelectedLandInspectorCountryCode === "function"
      ? normalizeCountryCode(getSelectedLandInspectorCountryCode())
      : "";
    if (!selectedLandCode) return null;
    return getLatestCountryStatesByCode().get(selectedLandCode) || null;
  };

  const renderSelectedLandCountryQuickTab = () => {
    const host = list?.parentElement;
    if (!host) return;

    const countryState = resolveSelectedLandInspectorCountryState();
    let tab = host.querySelector("[data-selected-land-country-quick-tab]");
    if (!countryState) {
      if (tab) {
        tab.classList.add("hidden");
        tab.setAttribute("aria-hidden", "true");
        tab.replaceChildren();
      }
      return;
    }

    if (!tab) {
      tab = document.createElement("div");
      tab.className = "selected-land-country-quick-tab";
      tab.dataset.selectedLandCountryQuickTab = "true";
      host.insertBefore(tab, list);
    }
    tab.classList.remove("hidden");
    tab.setAttribute("aria-hidden", "false");
    tab.replaceChildren();

    const header = document.createElement("div");
    header.className = "selected-land-country-quick-header";
    const label = document.createElement("span");
    label.textContent = t("Selected map country", "ui");
    const code = document.createElement("span");
    code.className = "selected-land-country-quick-code";
    code.textContent = countryState.code;
    header.appendChild(label);
    header.appendChild(code);

    tab.appendChild(header);
    renderCountrySelectRow(tab, countryState, {
      childSections: [],
      hideExpandToggle: true,
      registerRowRef: false,
      rowClassName: "selected-land-country-quick-card",
      showActivateSubaction: false,
      showRelationMeta: true,
    });
  };

  const registerCountryRowRef = (countryCode, ref) => {
    const normalized = normalizeCountryCode(countryCode);
    if (!normalized || !ref) return;
    const refs = countryRowRefsByCode.get(normalized) || [];
    refs.push(ref);
    countryRowRefsByCode.set(normalized, refs);
  };

  const positionCountryInspectorColorAnchor = () => {
    if (!countryInspectorColorInput || !countryInspectorColorSwatch) return;
    const rect = countryInspectorColorSwatch.getBoundingClientRect();
    countryInspectorColorInput.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    countryInspectorColorInput.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
  };

  const closeCountryInspectorColorPicker = () => {
    if (!countryInspectorColorInput) return;
    setCountryInspectorColorPickerOpen(false);
    countryInspectorColorInput.blur();
  };

  const syncCountryRowVisuals = (ref, countryState) => {
    if (!ref || !countryState) return;
    const isSelected = runtimeState.selectedInspectorCountryCode === countryState.code;
    const isActiveOwner = runtimeState.activeSovereignCode === countryState.code;
    ref.row?.classList.toggle("is-selected", isSelected);
    ref.row?.classList.toggle("is-active-owner", isActiveOwner);
    ref.wrapper?.classList.toggle("is-selected", isSelected);
    ref.wrapper?.classList.toggle("is-active-owner", isActiveOwner);
    if (ref.main) {
      ref.main.setAttribute("aria-pressed", String(isSelected));
    }
    if (ref.swatch) {
      ref.swatch.style.backgroundColor = getResolvedCountryColor(countryState);
    }
    const identity = getCountryHgoIdentity(countryState);
    updateFlagImage(ref.flag, identity, "small");
    if (ref.title) {
      ref.title.textContent = getCountryInspectorDisplayName(countryState, identity);
    }
    if (ref.meta) {
      ref.meta.textContent = getRowMetaText(countryState, identity, {
        showDetails: isCountryInspectorDetailsVisible(),
        showRelationMeta: !!ref.showRelationMeta,
      });
      ref.meta.classList.toggle("hidden", !ref.meta.textContent);
    }
  };

  const ensureSelectedInspectorCountry = () => {
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const normalized = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    const resolved = normalized && latestCountryStatesByCode.has(normalized)
      ? normalized
      : "";

    runtimeState.selectedInspectorCountryCode = resolved;
    runtimeState.inspectorHighlightCountryCode = resolved;
    return resolved;
  };

  const selectInspectorCountry = (code) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return;
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const previousSelectedCode = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    const countryState = latestCountryStatesByCode.get(normalized);
    let requiresListRebuild = false;
    if (countryState?.topLevelGroupId) {
      const groupKey = getInspectorGroupExpansionKey(countryState.topLevelGroupId);
      if (setInspectorContinentExpandedState(runtimeState, groupKey, true)) {
        requiresListRebuild = true;
      }
    }
    if (countryState?.releasable && countryState.parentOwnerTag && runtimeState.expandedInspectorReleaseParents instanceof Set) {
      if (!runtimeState.expandedInspectorReleaseParents.has(countryState.parentOwnerTag)) {
        runtimeState.expandedInspectorReleaseParents.add(countryState.parentOwnerTag);
        requiresListRebuild = true;
      }
    }
    runtimeState.selectedInspectorCountryCode = normalized;
    runtimeState.inspectorHighlightCountryCode = normalized;
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.open = true;
    }
    if (typeof runtimeState.updatePaintModeUIFn === "function") {
      runtimeState.updatePaintModeUIFn();
    }
    flushSidebarRender(`sidebar-inspector-country:${normalized}`);
    if (requiresListRebuild) {
      renderList();
      return;
    }
    refreshCountryRows({
      countryCodes: [previousSelectedCode, normalized],
      refreshInspector: true,
    });
  };

  const renderCountrySelectRow = (
    parent,
    countryState,
    {
      childStates = [],
      childSections = null,
      forceExpanded = false,
      hideExpandToggle = false,
      registerRowRef = true,
      rowClassName = "",
      showActivateSubaction = true,
      showRelationMeta = false,
    } = {}
  ) => {
    const normalizedChildSections = Array.isArray(childSections)
      ? childSections
      : (Array.isArray(childStates) && childStates.length
        ? [{ id: "children", label: "", states: childStates }]
        : []);
    const childCount = normalizedChildSections.reduce(
      (sum, section) => sum + (Array.isArray(section?.states) ? section.states.length : 0),
      0
    );
    const hasChildren = childCount > 0;
    const isActiveOwner = runtimeState.activeSovereignCode === countryState.code;
    const hasReleasableActivateAction = !!(
      isOwnershipEditingEnabled() && showActivateSubaction &&
      runtimeState.activeScenarioId &&
      countryState.releasable &&
      getPrimaryReleasablePresetRef(countryState)
    );
    const isExpanded = hasChildren && (
      forceExpanded ||
      runtimeState.expandedInspectorReleaseParents.has(countryState.code)
    );

    const row = document.createElement("div");
    row.className = "country-select-row";
    String(rowClassName || "").split(/\s+/).filter(Boolean).forEach((className) => {
      row.classList.add(className);
    });
    row.dataset.countryCode = countryState.code;
    const isSelected = runtimeState.selectedInspectorCountryCode === countryState.code;
    row.classList.toggle("is-selected", isSelected);
    row.classList.toggle("is-active-owner", isActiveOwner);
    row.classList.toggle("has-children", hasChildren);

    const main = document.createElement("button");
    main.type = "button";
    main.className = "country-select-main country-select-main-btn";
    main.setAttribute("aria-pressed", String(isSelected));
    main.addEventListener("click", () => {
      selectInspectorCountry(countryState.code);
    });

    const identity = getCountryHgoIdentity(countryState);
    const flag = document.createElement("img");
    flag.className = "hgo-identity-row-flag";
    flag.loading = "lazy";
    flag.decoding = "async";
    updateFlagImage(flag, identity, "small");

    const title = document.createElement("div");
    title.className = "country-select-title";
    title.textContent = getCountryInspectorDisplayName(countryState, identity);

    const meta = document.createElement("div");
    meta.className = "country-select-meta";
    meta.textContent = getRowMetaText(countryState, identity, {
      showDetails: isCountryInspectorDetailsVisible(),
      showRelationMeta,
    });
    meta.classList.toggle("hidden", !meta.textContent);

    const side = document.createElement("div");
    side.className = "country-select-side";

    let childrenMeta = null;
    if (hasChildren) {
      childrenMeta = document.createElement("div");
      childrenMeta.className = "country-children-meta";
      const metaCopy = document.createElement("span");
      metaCopy.className = "country-children-meta-copy";
      const countBadge = document.createElement("span");
      countBadge.className = "country-children-count";
      countBadge.textContent = String(childCount);
      const countLabel = document.createElement("span");
      countLabel.className = "country-children-meta-label";
      countLabel.textContent = t("Related Countries", "ui");
      metaCopy.appendChild(countBadge);
      metaCopy.appendChild(countLabel);
      childrenMeta.appendChild(metaCopy);

      if (!hideExpandToggle) {
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "country-action-btn country-children-toggle";
        toggleBtn.textContent = isExpanded ? "v" : ">";
        toggleBtn.setAttribute("aria-label", `${childCount} ${t("Related Countries", "ui")}`);
        toggleBtn.setAttribute("aria-expanded", String(isExpanded));
        toggleBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (runtimeState.expandedInspectorReleaseParents.has(countryState.code)) {
            runtimeState.expandedInspectorReleaseParents.delete(countryState.code);
          } else {
            runtimeState.expandedInspectorReleaseParents.add(countryState.code);
          }
          renderList();
        });
        childrenMeta.appendChild(toggleBtn);
      }
    }

    const swatch = document.createElement("span");
    swatch.className = "country-select-swatch";
    swatch.style.backgroundColor = getResolvedCountryColor(countryState);

    const identityLine = document.createElement("div");
    identityLine.className = "country-select-identity-line";
    identityLine.appendChild(flag);
    identityLine.appendChild(title);
    identityLine.classList.toggle("has-hgo-flag", !flag.classList.contains("hidden"));
    main.appendChild(identityLine);
    main.appendChild(meta);
    row.appendChild(main);

    side.appendChild(swatch);
    row.appendChild(side);
    if (childrenMeta) {
      row.appendChild(childrenMeta);
    }

    if (!hasChildren && !hasReleasableActivateAction) {
      if (registerRowRef) {
        registerCountryRowRef(countryState.code, {
          row,
          wrapper: null,
          main,
          flag,
          swatch,
          title,
          meta,
          showRelationMeta,
        });
      }
      parent.appendChild(row);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "country-explorer-group country-select-card";
    wrapper.dataset.countryCode = countryState.code;
    if (hasReleasableActivateAction) {
      wrapper.classList.add("has-subaction");
    }
    wrapper.classList.toggle("is-active-owner", isActiveOwner);
    wrapper.classList.toggle("is-selected", isSelected);
    wrapper.appendChild(row);

    if (hasReleasableActivateAction) {
      const activateStrip = document.createElement("button");
      activateStrip.type = "button";
      activateStrip.className = "country-select-subaction";
      activateStrip.textContent = t("Activate Releasable", "ui");
      activateStrip.title = t("Apply this releasable's political ownership and make it active.", "ui");
      activateStrip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyScenarioReleasableCoreTerritory(countryState, {
          source: "scenario-row-activate",
          forceSovereignty: true,
        });
      });
      wrapper.appendChild(activateStrip);
    }

    if (isExpanded) {
      const childList = document.createElement("div");
      childList.className = "country-children";
      normalizedChildSections.forEach((section) => {
        if (section?.label) {
          const sectionLabel = document.createElement("div");
          sectionLabel.className = "inspector-mini-label";
          sectionLabel.textContent = section.label;
          childList.appendChild(sectionLabel);
        }
        (Array.isArray(section?.states) ? section.states : []).forEach((childState) => {
          renderCountrySelectRow(childList, childState, {
            showRelationMeta: false,
          });
        });
      });
      wrapper.appendChild(childList);
    }
    if (registerRowRef) {
      registerCountryRowRef(countryState.code, {
        row,
        wrapper,
        main,
        flag,
        swatch,
        title,
        meta,
        showRelationMeta,
      });
    }
    parent.appendChild(wrapper);
  };

  const getCountrySearchRank = (countryState, term, upperTerm) => {
    const displayName = String(countryState?.displayName || "").trim().toLowerCase();
    const name = String(countryState?.name || "").trim().toLowerCase();
    const code = String(countryState?.code || "").trim().toUpperCase();
    const subregion = String(countryState?.subregionDisplayLabel || "").trim().toLowerCase();
    const continent = String(countryState?.continentDisplayLabel || "").trim().toLowerCase();
    const identity = getCountryHgoIdentity(countryState);
    const hgoTokens = (identity?.searchTokens || [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    if (!displayName && !name && !code) return null;
    if (!(
      displayName.includes(term)
      || name.includes(term)
      || code.includes(upperTerm)
      || subregion.includes(term)
      || continent.includes(term)
      || hgoTokens.some((token) => token.includes(term))
    )) {
      return null;
    }
    if (code === upperTerm) return 0;
    if (displayName === term || name === term) return 1;
    if (hgoTokens.some((token) => token === term)) return 1;
    if (displayName.startsWith(term) || name.startsWith(term)) return 2;
    if (hgoTokens.some((token) => token.startsWith(term))) return 2;
    if (code.startsWith(upperTerm)) return 3;
    if (subregion.startsWith(term) || continent.startsWith(term)) return 4;
    return 5;
  };

  const buildInspectorSearchGroups = (countryStates, term, priorityOrderMap) => {
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const upperTerm = String(term || "").trim().toUpperCase();
    const groupsByParentCode = new Map();

    const ensureSearchGroup = (parentState) => {
      const parentCode = normalizeCountryCode(parentState?.code);
      if (!parentCode) return null;
      if (!groupsByParentCode.has(parentCode)) {
        groupsByParentCode.set(parentCode, {
          parentState,
          parentMatched: false,
          parentSearchRank: null,
          matchedChildCodes: new Set(),
          bestRank: Number.MAX_SAFE_INTEGER,
        });
      }
      return groupsByParentCode.get(parentCode);
    };

    countryStates.forEach((countryState) => {
      const searchRank = getCountrySearchRank(countryState, term, upperTerm);
      if (searchRank === null) return;

      if (!countryState.releasable) {
        const group = ensureSearchGroup(countryState);
        if (!group) return;
        group.parentMatched = true;
        group.parentSearchRank = searchRank;
        group.bestRank = Math.min(group.bestRank, searchRank);
        return;
      }

      const parentState = (countryState.releasable || countryState.scenarioSubject) && countryState.parentOwnerTag
        ? latestCountryStatesByCode.get(countryState.parentOwnerTag)
        : null;
      if (!parentState) {
        const fallbackGroup = ensureSearchGroup(countryState);
        if (!fallbackGroup) return;
        fallbackGroup.parentMatched = true;
        fallbackGroup.parentSearchRank = searchRank;
        fallbackGroup.bestRank = Math.min(fallbackGroup.bestRank, searchRank);
        return;
      }

      const group = ensureSearchGroup(parentState);
      if (!group) return;
      group.matchedChildCodes.add(countryState.code);
      group.bestRank = Math.min(group.bestRank, searchRank);
    });

    return Array.from(groupsByParentCode.values())
      .map((group) => ({
        parentState: group.parentState,
        parentMatched: group.parentMatched,
        parentSearchRank: group.parentSearchRank,
        childSections: group.parentState?.releasable
          ? []
          : getCountryChildSectionsForParent(group.parentState.code, {
            matchedChildCodes: group.matchedChildCodes,
          }),
        bestRank: Number.isFinite(group.bestRank) ? group.bestRank : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => {
        if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
        return compareInspectorCountries(a.parentState, b.parentState, priorityOrderMap);
      });
  };

  const renderCountrySearchResults = (countryStates, term, priorityOrderMap) => {
    const searchGroups = buildInspectorSearchGroups(countryStates, term, priorityOrderMap);
    if (!searchGroups.length) {
      list.appendChild(createEmptyNote(t("No matching countries", "ui")));
      return;
    }

    searchGroups.forEach((group) => {
      renderCountrySelectRow(list, group.parentState, {
        childSections: group.childSections,
        forceExpanded: group.childSections.some((section) => Array.isArray(section?.states) && section.states.length > 0),
        hideExpandToggle: group.childSections.some((section) => Array.isArray(section?.states) && section.states.length > 0),
        showRelationMeta: !!group.parentState?.releasable,
      });
    });
  };

  const ensureHgoIdentityDetail = () => {
    if (!countryInspectorSelected) return null;
    let detail = countryInspectorSelected.querySelector("[data-hgo-identity-detail]");
    if (!detail) {
      detail = document.createElement("div");
      detail.className = "hgo-identity-detail";
      detail.dataset.hgoIdentityDetail = "true";
      countryInspectorSelected.insertBefore(detail, countryInspectorSelected.firstElementChild);
    }
    return detail;
  };

  const renderHgoIdentityDetail = (countryState) => {
    const detail = ensureHgoIdentityDetail();
    if (!detail) return;
    const identity = getCountryHgoIdentity(countryState);
    detail.replaceChildren();
    if (!countryState || !identity) {
      detail.classList.add("hidden");
      return;
    }
    detail.classList.remove("hidden");

    const header = document.createElement("div");
    header.className = "hgo-identity-detail-header";
    const flagUrl = getFlagTierUrl(identity, "medium", { allowPreferredFallback: false })
      || getFlagTierUrl(identity, "full", { allowPreferredFallback: false })
      || getFlagTierUrl(identity, "small");
    if (flagUrl) {
      const flag = document.createElement("img");
      flag.className = "hgo-identity-detail-flag";
      flag.src = flagUrl;
      flag.alt = "";
      flag.setAttribute("aria-hidden", "true");
      flag.loading = "lazy";
      flag.decoding = "async";
      header.appendChild(flag);
    }

    const copy = document.createElement("div");
    copy.className = "hgo-identity-detail-copy";
    const title = document.createElement("div");
    title.className = "hgo-identity-detail-title";
    title.textContent = getCountryInspectorDisplayName(countryState, identity);
    copy.appendChild(title);
    const showDetails = isCountryInspectorDetailsVisible();
    if (showDetails) {
      const badges = document.createElement("div");
      badges.className = "hgo-identity-badges";
      appendHgoBadge(badges, getHgoMatchLabel(identity.matchKind), {
        tone: getHgoBadgeTone(identity.matchKind),
      });
      if (identity.targetTag && identity.targetTag !== identity.tag) {
        appendHgoBadge(badges, `${identity.tag} -> ${identity.targetTag}`, {
          tone: getHgoBadgeTone(identity.matchKind),
        });
      }
      copy.appendChild(badges);
    }
    header.appendChild(copy);
    detail.appendChild(header);

    const names = identity.hgoNames || {};
    if (showDetails && Object.keys(names).length > 0) {
      const namesList = document.createElement("div");
      namesList.className = "hgo-identity-name-list";
      Object.entries(names).forEach(([language, name]) => {
        const row = document.createElement("div");
        row.className = "hgo-identity-name-row";
        const key = document.createElement("span");
        key.className = "hgo-identity-name-lang";
        key.textContent = language;
        const value = document.createElement("span");
        value.className = "hgo-identity-name-value";
        value.textContent = name;
        row.appendChild(key);
        row.appendChild(value);
        namesList.appendChild(row);
      });
      detail.appendChild(namesList);
    }

    const variants = Array.isArray(identity.flag?.variants) ? identity.flag.variants : [];
    const hasBaseFlag = !!(identity.flag?.preferredBaseFlag || Object.keys(identity.flag?.base || {}).length > 0);
    if (hasBaseFlag || variants.length > 0) {
      const countryCode = normalizeCountryCode(countryState?.code || identity.sourceTag || identity.tag || "");
      const selectedVariantKey = identity.flag?.preferredVariantKey || "";
      const options = [
        ...(hasBaseFlag ? [{
          key: "",
          label: t("Base flag", "ui"),
        }] : []),
        ...variants.map((variant) => ({
          key: variant.key,
          label: formatHgoVariantLabel(variant.variantSource || variant.label || variant.key),
        })),
      ];
      const selectedOption = options.find((option) => option.key === selectedVariantKey) || options[0];
      const picker = document.createElement("div");
      picker.className = "hgo-identity-variant-picker";
      const label = document.createElement("label");
      label.className = "hgo-identity-variant-label";
      label.textContent = t("Flag option", "ui");
      const control = document.createElement("div");
      control.className = "hgo-identity-variant-control";
      const select = document.createElement("select");
      select.className = "hgo-identity-variant-select";
      options.forEach((option) => {
        const node = document.createElement("option");
        node.value = option.key;
        node.textContent = option.label || option.key || t("Base flag", "ui");
        select.appendChild(node);
      });
      select.value = selectedOption?.key || "";
      select.addEventListener("change", function handleHgoVariantChange() {
        const nextKey = String(select.value || "").trim();
        ensureHgoIdentitySettings();
        setHgoIdentityVariantSelectionState(runtimeState, countryCode, nextKey);
        onHgoIdentitySettingsChange?.();
      });
      control.appendChild(select);
      label.appendChild(control);
      picker.appendChild(label);
      detail.appendChild(picker);
    }

    if (showDetails && identity.paletteColor) {
      const palette = document.createElement("div");
      palette.className = "hgo-identity-palette-row";
      const swatch = document.createElement("span");
      swatch.className = "hgo-identity-palette-swatch";
      swatch.style.backgroundColor = identity.paletteColor;
      const label = document.createElement("span");
      label.textContent = `HGO palette ${identity.paletteColor}`;
      palette.appendChild(swatch);
      palette.appendChild(label);
      detail.appendChild(palette);
    }
  };

  const keepGroupHeaderAtSameScrollPosition = (groupKey, previousHeaderTop = null) => {
    if (!list || !groupKey || previousHeaderTop == null) return;
    const nextHeader = list.querySelector(`[data-inspector-group-key="${groupKey}"]`);
    if (!nextHeader) return;
    const nextHeaderTop = nextHeader.getBoundingClientRect().top;
    list.scrollTop += nextHeaderTop - previousHeaderTop;
  };

  const renderGroupedCountryExplorer = (countryStates) => {
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const hasCountryGrouping =
      Array.isArray(runtimeState.countryGroupsData?.continents) &&
      runtimeState.countryGroupsData.continents.length > 0;

    if (!hasCountryGrouping) {
      countryStates.forEach((countryState) => {
        renderCountrySelectRow(list, countryState, {
          childSections: getCountryChildSectionsForParent(countryState.code),
        });
      });
      return;
    }

    const groupedEntries = buildCountryColorTree(countryStates);
    ensureInitialInspectorExpansion(groupedEntries);
    const fragment = document.createDocumentFragment();

    groupedEntries.forEach((continent) => {
      const countries = continent.countries
        .map((entry) => latestCountryStatesByCode.get(entry.code))
        .filter(Boolean);

      if (!countries.length) return;

      const groupKey = getInspectorGroupExpansionKey(continent.id);
      const isOpen = runtimeState.expandedInspectorContinents.has(groupKey);

      const group = document.createElement("div");
      group.className = "country-explorer-group";

      const header = document.createElement("button");
      header.type = "button";
      header.className = "inspector-accordion-btn country-explorer-header";
      header.dataset.inspectorGroupKey = groupKey;
      header.setAttribute("aria-expanded", String(isOpen));
      header.addEventListener("click", () => {
        const previousHeaderTop = header.getBoundingClientRect().top;
        setInspectorContinentExpandedState(runtimeState, groupKey, !isOpen);
        renderList({ anchorGroupKey: groupKey, previousHeaderTop });
      });

      const heading = document.createElement("div");
      heading.className = "country-explorer-heading";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = `${continent.displayLabel} (${countries.length})`;

      const chevron = document.createElement("span");
      chevron.className = "inspector-mini-label";
      chevron.textContent = isOpen ? "v" : ">";

      heading.appendChild(title);
      header.appendChild(heading);
      header.appendChild(chevron);
      group.appendChild(header);

      if (isOpen) {
        const groupList = document.createElement("div");
        groupList.className = "country-explorer-list";
        countries.forEach((countryState) => {
          renderCountrySelectRow(groupList, countryState, {
            childSections: getCountryChildSectionsForParent(countryState.code),
          });
        });
        group.appendChild(groupList);
      }

      fragment.appendChild(group);
    });

    list.appendChild(fragment);
  };

  const renderCountryInspectorDetail = () => {
    if (!countryInspectorSelected) return;
    incrementSidebarCounter?.("inspectorRenders");

    updateScenarioInspectorLayout();

    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const selectedCode = ensureSelectedInspectorCountry();
    const countryState = selectedCode ? latestCountryStatesByCode.get(selectedCode) : null;
    const isEmpty = !countryState;
    renderSelectedLandCountryQuickTab();

    if (countryInspectorDetail) {
      countryInspectorDetail.classList.toggle("hidden", isEmpty);
    }
    countryInspectorSelected.classList.toggle("hidden", isEmpty);

    if (!countryState) {
      if (countryInspectorSetActive) {
        countryInspectorSetActive.disabled = true;
        countryInspectorSetActive.classList.remove("is-active");
        countryInspectorSetActive.classList.add("hidden");
        countryInspectorSetActive.textContent = t("Use as Active Owner", "ui");
        countryInspectorSetActive.setAttribute("aria-pressed", "false");
      }
      if (countryInspectorDetailHint) {
        countryInspectorDetailHint.classList.add("hidden");
        countryInspectorDetailHint.textContent = "";
      }
      if (countryInspectorColorRow) {
        countryInspectorColorRow.classList.add("hidden");
      }
      if (countryInspectorColorInput) {
        countryInspectorColorInput.disabled = true;
        countryInspectorColorInput.style.removeProperty("left");
        countryInspectorColorInput.style.removeProperty("top");
      }
      renderHgoIdentityDetail(null);
      setCountryInspectorColorPickerOpen(false);
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const isScenarioReleasable = !!runtimeState.activeScenarioId && !!countryState.releasable;
    if (countryInspectorSetActive) {
      const isActive = runtimeState.activeSovereignCode === countryState.code;
      countryInspectorSetActive.disabled = !isOwnershipEditingEnabled();
      countryInspectorSetActive.classList.toggle("hidden", !isOwnershipEditingEnabled() || isScenarioReleasable);
      countryInspectorSetActive.classList.toggle("is-active", !isScenarioReleasable && isActive);
      countryInspectorSetActive.textContent = isActive
        ? t("Stop Using as Active Owner", "ui")
        : t("Use as Active Owner", "ui");
      countryInspectorSetActive.setAttribute("aria-pressed", String(!isScenarioReleasable && isActive));
    }
    if (countryInspectorDetailHint) {
      if (isOwnershipEditingEnabled() && isScenarioReleasable) {
        countryInspectorDetailHint.classList.remove("hidden");
        countryInspectorDetailHint.textContent = t(
          "Use Activate Releasable or Reapply Core Territory in Scenario Actions.",
          "ui"
        );
      } else {
        countryInspectorDetailHint.classList.add("hidden");
        countryInspectorDetailHint.textContent = "";
      }
    }

    renderHgoIdentityDetail(countryState);

    if (countryInspectorColorRow) {
      countryInspectorColorRow.classList.add("hidden");
    }
    if (countryInspectorColorInput) {
      countryInspectorColorInput.disabled = true;
      countryInspectorColorInput.style.removeProperty("left");
      countryInspectorColorInput.style.removeProperty("top");
    }
    setCountryInspectorColorPickerOpen(false);
    scheduleAdaptiveInspectorHeights();
  };

  const renderList = ({ anchorGroupKey = "", previousHeaderTop = null } = {}) => {
    incrementSidebarCounter?.("fullListRenders");
    updateScenarioInspectorLayout();
    const term = getSearchTerm();
    const entries = getDynamicCountryEntries();
    const countryStates = entries.map((entry, entryIndex) => createCountryInspectorState(entry, entryIndex));
    const visibleCountryStates = countryStates.filter((countryState) => !countryState?.hiddenFromCountryList);
    const topLevelCountryStates = buildInspectorTopLevelCountryEntries(visibleCountryStates);
    const priorityOrderMap = getPriorityCountryOrderMap();
    setLatestCountryStatesByCode(new Map(countryStates.map((countryState) => [countryState.code, countryState])));
    countryRowRefsByCode.clear();
    ensureSelectedInspectorCountry();
    renderHgoIdentityControls(visibleCountryStates);
    renderSelectedLandCountryQuickTab();
    list.replaceChildren();

    if (!visibleCountryStates.length) {
      list.appendChild(createEmptyNote(t("No countries available", "ui")));
      renderCountryInspectorDetail();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    if (term) {
      renderCountrySearchResults(visibleCountryStates, term, priorityOrderMap);
    } else {
      renderGroupedCountryExplorer(topLevelCountryStates);
      keepGroupHeaderAtSameScrollPosition(anchorGroupKey, previousHeaderTop);
    }

    renderCountryInspectorDetail();
    if (typeof runtimeState.renderPresetTreeFn === "function") {
      runtimeState.renderPresetTreeFn();
    }
    if (typeof runtimeState.updateWorkspaceStatusFn === "function") {
      runtimeState.updateWorkspaceStatusFn();
    }
    scheduleAdaptiveInspectorHeights();
  };

  const refreshCountryRows = ({
    countryCodes = [],
    refreshInspector = true,
    refreshPresetTree = false,
    forceAll = false,
  } = {}) => {
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const normalizedCodes = Array.from(new Set(
      (Array.isArray(countryCodes) ? countryCodes : [])
        .map((code) => normalizeCountryCode(code))
        .filter(Boolean)
    ));
    const selectedCode = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    const activeCode = normalizeCountryCode(runtimeState.activeSovereignCode);
    if (selectedCode) normalizedCodes.push(selectedCode);
    if (activeCode) normalizedCodes.push(activeCode);
    const targetCodes = forceAll || !normalizedCodes.length
      ? Array.from(countryRowRefsByCode.keys())
      : Array.from(new Set(normalizedCodes));

    targetCodes.forEach((countryCode) => {
      const refs = countryRowRefsByCode.get(countryCode) || [];
      const countryState = latestCountryStatesByCode.get(countryCode);
      if (!countryState || !refs.length) return;
      refs.forEach((ref) => syncCountryRowVisuals(ref, countryState));
    });
    incrementSidebarCounter?.("rowRefreshes", targetCodes.length || 1);

    if (refreshInspector) {
      renderCountryInspectorDetail();
    }
    if (refreshPresetTree && typeof runtimeState.renderPresetTreeFn === "function") {
      runtimeState.renderPresetTreeFn();
    }
    if (typeof runtimeState.updateWorkspaceStatusFn === "function") {
      runtimeState.updateWorkspaceStatusFn();
    }
    scheduleAdaptiveInspectorHeights();
  };

  const bindEvents = () => {
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.addEventListener("input", () => {
        renderList();
        if (typeof runtimeState.renderPresetTreeFn === "function") {
          runtimeState.renderPresetTreeFn();
        }
      });
      searchInput.dataset.bound = "true";
    }

    if (countryInspectorSetActive && !countryInspectorSetActive.dataset.bound) {
      countryInspectorSetActive.addEventListener("click", () => {
        if (!isOwnershipEditingEnabled()) return;
        const latestCountryStatesByCode = getLatestCountryStatesByCode();
        const selectedCode = ensureSelectedInspectorCountry();
        if (!selectedCode) return;
        const countryState = latestCountryStatesByCode.get(selectedCode);
        if (runtimeState.activeScenarioId && countryState?.releasable) {
          return;
        }
        const isCurrentlyActive = runtimeState.activeSovereignCode === selectedCode;
        const previousActiveCode = runtimeState.activeSovereignCode;
        runtimeState.activeSovereignCode = isCurrentlyActive ? "" : selectedCode;
        markDirty(isCurrentlyActive ? "set-inactive-sovereign" : "set-active-sovereign");
        if (typeof runtimeState.updateActiveSovereignUIFn === "function") {
          runtimeState.updateActiveSovereignUIFn();
        }
        flushSidebarRender(
          isCurrentlyActive ? "sidebar-active-sovereign:clear" : `sidebar-active-sovereign:${selectedCode}`
        );
        refreshCountryRows({
          countryCodes: [previousActiveCode, selectedCode],
          refreshInspector: true,
        });
        if (!isCurrentlyActive) {
          showToast(
            t("Political ownership editing now targets the selected country.", "ui"),
            {
              title: t("Active owner updated", "ui"),
              tone: "info",
              duration: 3200,
            }
          );
        }
      });
      countryInspectorSetActive.dataset.bound = "true";
    }

    if (countryInspectorColorSwatch && countryInspectorColorInput && !countryInspectorColorSwatch.dataset.bound) {
      countryInspectorColorSwatch.addEventListener("click", () => {
        positionCountryInspectorColorAnchor();
        countryInspectorColorInput.focus({ preventScroll: true });
        setCountryInspectorColorPickerOpen(true);
        if (typeof countryInspectorColorInput.showPicker === "function") {
          countryInspectorColorInput.showPicker();
        } else {
          countryInspectorColorInput.click();
        }
      });
      countryInspectorColorSwatch.dataset.bound = "true";
    }

    if (countryInspectorColorInput && !countryInspectorColorInput.dataset.bound) {
      countryInspectorColorInput.addEventListener("change", (event) => {
        const latestCountryStatesByCode = getLatestCountryStatesByCode();
        const selectedCode = ensureSelectedInspectorCountry();
        if (!selectedCode) return;
        const countryState = latestCountryStatesByCode.get(selectedCode);
        if (!countryState) return;
        const nextColor = normalizeHexColor(event.target.value);
        const currentColor = getDisplayCountryColor(countryState);
        if (!nextColor || nextColor === currentColor) {
          closeCountryInspectorColorPicker();
          renderCountryInspectorDetail();
          return;
        }
        applyCountryColor(selectedCode, nextColor);
        closeCountryInspectorColorPicker();
        markDirty("inspector-country-color");
        refreshCountryRows({
          countryCodes: [selectedCode],
          refreshInspector: true,
        });
      });
      countryInspectorColorInput.addEventListener("blur", () => {
        setCountryInspectorColorPickerOpen(false);
      });
      countryInspectorColorInput.dataset.bound = "true";
    }
  };

  return {
    bindEvents,
    closeCountryInspectorColorPicker,
    ensureSelectedInspectorCountry,
    refreshCountryRows,
    renderCountryInspectorDetail,
    renderCountrySelectRow,
    renderList,
    selectInspectorCountry,
    syncCountryRowVisuals,
  };
}
