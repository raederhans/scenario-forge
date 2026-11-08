import { resolveCatalogEntryForTag, resolvePresetFeatureIds, getResolvedReleasableBoundaryVariant } from "../../core/releasable_manager.js";
import { selectScenarioBoundaryVariant } from "./scenario_territory_controller.js";
import { getGroupDisplayLabel } from "../../core/country_group_provider.js";

export function renderCountryGroupButtons(container, countryState, {
  t, language, translateGeo, selectedSystemId, selectSystem,
  createInspectorActionButton, applyGroup, createEmptyNote,
}) {
  const systems = countryState.groupSystems;
  const selected = systems.find((system) => system.id === selectedSystemId) || systems[0];
  const sourceLabel = (id) => id === "scenario_districts"
    ? t("Scenario districts", "ui") : t("Modern administrative regions", "ui");
  if (selected) {
    const note = document.createElement("small");
    note.className = "scenario-action-hint";
    note.textContent = sourceLabel(selected.id);
    container.appendChild(note);
  }
  if (systems.filter((system) => system.groups.length).length > 1) {
    const toggle = document.createElement("div");
    toggle.className = "frontline-segmented-field country-group-system-toggle";
    systems.forEach((system) => {
      const button = createInspectorActionButton(sourceLabel(system.id), () => {
        selectSystem(system.id);
        container.replaceChildren();
        renderCountryGroupButtons(container, countryState, {
          t, language, translateGeo, selectedSystemId: system.id, selectSystem,
          createInspectorActionButton, applyGroup, createEmptyNote,
        });
      });
      button.className = `frontline-segmented-choice${selected.id === system.id ? " is-active" : ""}`;
      button.setAttribute("aria-pressed", String(selected.id === system.id));
      toggle.appendChild(button);
    });
    container.appendChild(toggle);
  }
  const groups = selected?.groups || [];
  groups.forEach((group) => container.appendChild(createInspectorActionButton(
    getGroupDisplayLabel(group, language, translateGeo), () => applyGroup(group)
  )));
  if (!groups.length) container.appendChild(createEmptyNote(t("No hierarchy groups", "ui")));
}

export function createScenarioInspectorController({
  t,
  getView,
  selectGroupSystem,
  getCountryState,
  storeVisualOpen,
  selectInspectorCountry,
  getScenarioSubjectKindLabel,
  getResolvedCountryColor,
  getScenarioSubjectChildrenForParent,
  getReleasableChildrenForParent,
  appendActionSection,
  createInspectorActionButton,
  applyHierarchyGroupWithMode,
  render,
  createEmptyNote,
  renderRegionalPresets,
  normalizeCountryCode,
  applyScenarioReleasableCoreTerritory,
  selectedCountryActionsSection,
  scheduleAdaptiveInspectorHeights,
  setScenarioVisualAdjustmentsOpen,
  filterToVisibleFeatureIds,
  clearVisualOverridesForFeatureIds,
  showToast,
  applyVisualColorToOwnedRegions,
  clearCountryVisualOverrides,
  renderCountryColorSyncAffordance,
  // Catalog access is injectable for tests; the sidebar uses the releasable manager.
  resolveTerritoryEntry = resolveCatalogEntryForTag,
  resolveTerritoryFeatureIds = resolvePresetFeatureIds,
  getSelectedBoundaryVariant = getResolvedReleasableBoundaryVariant,
  selectBoundaryVariant = selectScenarioBoundaryVariant,
}) {
  const appendScenarioCountryCard = (container, countryState, { parentReturn = false } = {}) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = parentReturn
      ? "scenario-action-card scenario-navigation-card scenario-parent-return-btn"
      : "scenario-action-card";
    card.addEventListener("click", () => selectInspectorCountry(countryState.code));
    const copy = document.createElement("div");
    copy.className = "scenario-action-card-copy";
    const title = document.createElement("div");
    title.className = "country-row-title";
    title.textContent = parentReturn
      ? `${t("Return to", "ui")} ${countryState.displayName}`
      : countryState.displayName;
    const meta = document.createElement("div");
    meta.className = "country-select-meta";
    const subjectLabel = !parentReturn && countryState.scenarioSubject
      ? getScenarioSubjectKindLabel(countryState) : "";
    meta.textContent = subjectLabel ? `(${countryState.code}) · ${subjectLabel}` : `(${countryState.code})`;
    copy.appendChild(title);
    copy.appendChild(meta);
    const side = document.createElement("div");
    side.className = "country-row-actions";
    const swatch = document.createElement("span");
    swatch.className = "country-select-swatch";
    swatch.style.backgroundColor = getResolvedCountryColor(countryState);
    side.appendChild(swatch);
    card.appendChild(copy);
    card.appendChild(side);
    container.appendChild(card);
  };

  const appendScenarioChildCountryRows = (container, childStates = []) => {
    const children = Array.isArray(childStates) ? childStates : [];
    children.forEach((childState) => appendScenarioCountryCard(container, childState));
  };

  const renderScenarioRelatedCountryGroups = (container, countryState) => {
    const subjectChildren = getScenarioSubjectChildrenForParent(countryState?.code);
    const releasableChildren = getReleasableChildrenForParent(countryState?.code);
    if (!subjectChildren.length && !releasableChildren.length) return;

    const section = appendActionSection(container, t("Related Governments", "ui"), {
      bodyClassName: "inspector-action-list-natural",
    });

    if (subjectChildren.length) {
      const label = document.createElement("div");
      label.className = "inspector-mini-label";
      label.textContent = t("Subject Governments", "ui");
      section.appendChild(label);
      appendScenarioChildCountryRows(section, subjectChildren);
    }

    if (releasableChildren.length) {
      const label = document.createElement("div");
      label.className = "inspector-mini-label";
      label.textContent = t("Releasable Countries", "ui");
      section.appendChild(label);
      appendScenarioChildCountryRows(section, releasableChildren);
    }
  };

  const renderScenarioParentReturnAction = (container, countryState) => {
    const parentCode = normalizeCountryCode(
      countryState?.parentOwnerTag
      || (Array.isArray(countryState?.parentOwnerTags) ? countryState.parentOwnerTags[0] : "")
    );
    if (!parentCode) return;
    const parentState = getCountryState(parentCode);
    if (!parentState) return;

    appendScenarioCountryCard(container, parentState, { parentReturn: true });
  };

  const renderScenarioVisualAdjustments = (container, countryState) => {
    const details = document.createElement("details");
    details.className = "scenario-visual-adjustments inspector-action-section";
    details.open = true;
    selectedCountryActionsSection?.classList.toggle("has-open-visual-adjustments", details.open);
    details.addEventListener("toggle", () => {
      storeVisualOpen(details.open);
      selectedCountryActionsSection?.classList.toggle("has-open-visual-adjustments", details.open);
      scheduleAdaptiveInspectorHeights();
    });

    const summary = document.createElement("summary");
    summary.className = "section-header";
    summary.textContent = t("Color", "ui");
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "scenario-visual-adjustments-body";

    // Color Only 面板面向视觉颜色调整，主要写入视觉颜色覆盖。
    // 它可以复用 preset/hierarchy 的目标选择，但不得触发 owner/controller、边界或 diff 计数链。
    const note = document.createElement("p");
    note.className = "scenario-action-hint";
    note.textContent = t(
      "Edit map colors using the scenario reference groups. Reference boundaries stay unchanged.",
      "ui"
    );
    body.appendChild(note);

    if (!countryState) {
      body.appendChild(
        createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui"))
      );
      details.appendChild(body);
      container.appendChild(details);
      return;
    }

    const entry = resolveTerritoryEntry(countryState.code);
    const appendTerritorySection = () => {
      if (!entry) return;
      const territoryIds = resolveTerritoryFeatureIds(entry);
      const coreSection = appendActionSection(body, t("Territory", "ui"));
      const selectedVariant = getSelectedBoundaryVariant(entry);
      if (selectedVariant) {
        const select = document.createElement("select");
        select.className = "select-input";
        select.setAttribute("aria-label", t("Boundary variant", "ui"));
        select.title = selectedVariant.description;
        for (const variant of entry.boundary_variants) {
          const option = document.createElement("option");
          option.value = variant.id;
          option.textContent = variant.label;
          option.title = variant.description;
          select.appendChild(option);
        }
        select.value = selectedVariant.id;
        select.addEventListener("change", () => selectBoundaryVariant(
          countryState.code, select.value, () => selectInspectorCountry(countryState.code)
        ));
        coreSection.appendChild(select);
      }
      const companionInputs = [];
      for (const action of entry.companion_actions || []) {
        if (action.hidden_in_ui) continue;
        const label = document.createElement("label");
        label.className = "toggle-label";
        label.title = action.description || "";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "checkbox-input";
        input.value = action.id;
        input.checked = !!action.auto_apply_on_core_territory;
        input.disabled = !getCountryState(action.target_owner_tag);
        const text = document.createElement("span");
        text.textContent = action.label + (input.disabled
          ? ` — ${t("Target country is not in this scenario", "ui")}` : "");
        label.appendChild(input);
        label.appendChild(text);
        coreSection.appendChild(label);
        companionInputs.push(input);
      }

      const applyVisualBtn = createInspectorActionButton(
        t("Apply territory", "ui"),
        () => {
          applyScenarioReleasableCoreTerritory(countryState, {
            filterToVisibleFeatureIds,
            companionActionIds: companionInputs.filter((input) => input.checked && !input.disabled).map((input) => input.value),
          });
          setScenarioVisualAdjustmentsOpen(true);
        }
      );
      applyVisualBtn.disabled = !territoryIds.length;
      coreSection.appendChild(applyVisualBtn);
      const hint = document.createElement("p");
      hint.className = "scenario-action-hint";
      hint.textContent = t("Paints with this country's current color; can be undone.", "ui");
      coreSection.appendChild(hint);

      const clearVisualBtn = createInspectorActionButton(
        t("Clear Territory Visual Overrides", "ui"),
        () => {
          const requestedFeatureIds = resolveTerritoryFeatureIds(entry);
          const { matchedIds } = filterToVisibleFeatureIds(requestedFeatureIds);
          const result = clearVisualOverridesForFeatureIds(matchedIds, {
            render,
            historyKind: "scenario-core-clear-visual",
            dirtyReason: "scenario-core-clear-visual",
          });
          if (result.changed > 0) {
            showToast(
              `${t("Cleared", "ui")} ${result.changed} ${t("features", "ui")}`,
              {
                title: t("Visual overrides cleared", "ui"),
                tone: "success",
                duration: 2800,
              }
            );
          } else {
            showToast(t("No visual overrides to clear.", "ui"), {
              title: t("No changes", "ui"),
              tone: "info",
              duration: 2600,
            });
          }
          setScenarioVisualAdjustmentsOpen(true);
        }
      );
      clearVisualBtn.disabled = !territoryIds.length;
      coreSection.appendChild(clearVisualBtn);

      if (!territoryIds.length) {
        coreSection.appendChild(createEmptyNote(t("No core territory defined", "ui")));
      }
    };

    if (countryState.releasable) {
      appendTerritorySection();
    } else {
      const countrySection = appendActionSection(body, t("Country Visuals", "ui"));

      countrySection.appendChild(createInspectorActionButton(
        t("Paint Reference Regions With Country Color", "ui"),
        () => {
          const result = applyVisualColorToOwnedRegions(countryState);
          if (result.changed > 0) {
            showToast(
              `${t("Applied", "ui")} ${result.changed}/${result.matchedCount} ${t("features", "ui")}`,
              {
                title: t("Visual color applied", "ui"),
                tone: "success",
                duration: 2800,
              }
            );
          } else {
            showToast(t("No reference regions were recolored.", "ui"), {
              title: t("No changes", "ui"),
              tone: "info",
              duration: 2600,
            });
          }
          setScenarioVisualAdjustmentsOpen(true);
        }
      ));

      countrySection.appendChild(createInspectorActionButton(
        t("Clear Reference Region Color Edits", "ui"),
        () => {
          const result = clearCountryVisualOverrides(countryState);
          if (result.changed > 0) {
            showToast(
              `${t("Cleared", "ui")} ${result.changed} ${t("features", "ui")}`,
              {
                title: t("Visual overrides cleared", "ui"),
                tone: "success",
                duration: 2800,
              }
            );
          } else {
            showToast(t("No visual overrides to clear.", "ui"), {
              title: t("No changes", "ui"),
              tone: "info",
              duration: 2600,
            });
          }
          setScenarioVisualAdjustmentsOpen(true);
        }
      ));

      if (countryState.hierarchyGroups.length > 0) {
        const groupSection = appendActionSection(body, t("Hierarchy Groups (Visual Color)", "ui"));
        renderCountryGroupButtons(groupSection, countryState, {
          t,
          language: getView().language,
          translateGeo: (label) => t(label, "geo"),
          selectedSystemId: getView().inspectorGroupSystemByCode?.[countryState.code],
          selectSystem: (id) => selectGroupSystem(countryState.code, id),
          createInspectorActionButton,
          createEmptyNote,
          applyGroup: (group) => {
            applyHierarchyGroupWithMode(group, {
              mode: "visual",
              color: getView().selectedColor,
              render,
              visualHistoryKind: "scenario-hierarchy-apply-visual",
              visualDirtyReason: "scenario-hierarchy-apply-visual",
            });
            setScenarioVisualAdjustmentsOpen(true);
          },
        });
      }

      renderRegionalPresets(body, countryState, { mode: "visual" });
      appendTerritorySection();
    }

    details.appendChild(body);
    container.appendChild(details);
  };

  const renderScenarioActionsPanel = (container, countryState) => {
    container.replaceChildren();
    if (countryState) {
      renderCountryColorSyncAffordance(container, countryState);
    }

    if (!countryState) {
      container.appendChild(createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui")));
      return;
    }

    if (countryState.scenarioSubject) renderScenarioParentReturnAction(container, countryState);
    renderScenarioRelatedCountryGroups(container, countryState);
    renderScenarioVisualAdjustments(container, countryState);
  };

  return { renderScenarioActionsPanel };
}
