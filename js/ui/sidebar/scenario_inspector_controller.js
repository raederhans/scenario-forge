import { isOwnershipEditingEnabled } from "../../core/map_editing_policy.js";
export function createScenarioInspectorController({
  t,
  getView,
  getCountryState,
  activateScenarioCountry,
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
  getResolvedReleasableBoundaryVariant,
  getScenarioCountryMeta,
  applyReleasableBoundaryVariantSelection,
  getPrimaryReleasablePresetRef,
  applyScenarioReleasableCoreTerritory,
  renderScenarioHistoricalTransfers,
  selectedCountryActionsSection,
  scheduleAdaptiveInspectorHeights,
  setScenarioMapPaintMode,
  setScenarioVisualAdjustmentsOpen,
  filterToVisibleFeatureIds,
  clearVisualOverridesForFeatureIds,
  showToast,
  applyVisualColorToOwnedRegions,
  clearCountryVisualOverrides,
  renderCountryColorSyncAffordance,
  hasScenarioCoreTerritoryActions,
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

  const renderScenarioParentActions = (container, countryState) => {
    if (countryState?.scenarioSubject) {
      renderScenarioParentReturnAction(container, countryState);
    }
    renderScenarioRelatedCountryGroups(container, countryState);

    const groupSection = appendActionSection(container, t("Hierarchy Groups", "ui"), {
      collapsible: true,
      defaultOpen: false,
      rememberKey: "territories-presets:hierarchy-groups",
    });
    countryState.hierarchyGroups.forEach((group) => {
      groupSection.appendChild(createInspectorActionButton(
        t(group.label, "geo") || group.label,
        () => applyHierarchyGroupWithMode(group, {
          mode: "ownership",
          ownerCode: countryState.code,
          render,
          ownershipHistoryKind: "scenario-hierarchy-apply-ownership",
          ownershipDirtyReason: "scenario-hierarchy-apply-ownership",
        })
      ));
    });
    if (!countryState.hierarchyGroups.length) {
      groupSection.appendChild(createEmptyNote(t("No hierarchy groups", "ui")));
    }

    renderRegionalPresets(container, countryState, { mode: "ownership" });
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

  const renderScenarioBoundaryVariantActions = (container, countryState) => {
    const variants = Array.isArray(countryState?.boundaryVariants) ? countryState.boundaryVariants : [];
    if (variants.length <= 1) return;

    const section = appendActionSection(container, t("Boundary Variants", "ui"));
    const activeVariant = getResolvedReleasableBoundaryVariant(getScenarioCountryMeta(countryState.code) || countryState);

    variants.forEach((variant) => {
      const button = createInspectorActionButton(variant.label || variant.id, () => {
        applyReleasableBoundaryVariantSelection(countryState, variant);
      });
      const isActive = String(activeVariant?.id || "").trim().toLowerCase() === String(variant?.id || "").trim().toLowerCase();
      button.disabled = isActive;
      if (isActive) {
        button.title = t("Already using this boundary variant.", "ui");
      }
      section.appendChild(button);
    });
  };

  const renderScenarioCoreTerritoryAction = (container, countryState) => {
    const section = appendActionSection(container, t("Core Territory", "ui"));
    const presetRef = getPrimaryReleasablePresetRef(countryState);
    if (!presetRef) {
      section.appendChild(createEmptyNote(t("No core territory defined", "ui")));
      return;
    }

    const card = document.createElement("div");
    card.className = "scenario-action-card scenario-core-action-card";

    const copy = document.createElement("div");
    copy.className = "scenario-action-card-copy";

    const title = document.createElement("div");
    title.className = "country-row-title";
    title.textContent = presetRef.preset?.name || t("Core Territory", "ui");

    const meta = document.createElement("div");
    meta.className = "country-select-meta";
    const metaBits = [`${presetRef.preset?.ids?.length || 0} ${t("features", "ui")}`];
    const selectedVariantLabel = String(countryState?.selectedBoundaryVariantLabel || "").trim();
    if (selectedVariantLabel && Array.isArray(countryState?.boundaryVariants) && countryState.boundaryVariants.length > 1) {
      metaBits.push(selectedVariantLabel);
    }
    meta.textContent = metaBits.join(" · ");

    copy.appendChild(title);
    copy.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "country-row-actions scenario-core-action-row";
    const isReleasable = !!countryState?.releasable;

    const activateBtn = document.createElement("button");
    activateBtn.type = "button";
    activateBtn.className = "btn-primary";
    activateBtn.textContent = isReleasable ? t("Activate Releasable", "ui") : t("Target This Country", "ui");
    activateBtn.addEventListener("click", () => {
      activateScenarioCountry(countryState);
    });
    actions.appendChild(activateBtn);

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "btn-secondary";
    applyBtn.textContent = t("Reapply Core Territory", "ui");
    applyBtn.addEventListener("click", () => {
      applyScenarioReleasableCoreTerritory(countryState, {
        source: "scenario-actions",
        actionMode: "ownership",
      });
    });
    actions.appendChild(applyBtn);

    card.appendChild(copy);
    card.appendChild(actions);
    section.appendChild(card);
  };

  const renderScenarioReleasableActions = (container, countryState) => {
    renderScenarioParentReturnAction(container, countryState);
    renderScenarioBoundaryVariantActions(container, countryState);
    renderScenarioCoreTerritoryAction(container, countryState);
    renderScenarioHistoricalTransfers(container, countryState);
  };

  const renderScenarioVisualAdjustments = (container, countryState) => {
    const details = document.createElement("details");
    details.className = "scenario-visual-adjustments inspector-action-section";
    details.open = !isOwnershipEditingEnabled() || getView().visualOpen;
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

    if (isOwnershipEditingEnabled()) {
      const brushSection = appendActionSection(body, t("Brush", "ui"));
      const isVisualBrush = String(getView().paintMode || "visual") !== "sovereignty";
      const brushBtn = createInspectorActionButton(
        isVisualBrush
          ? t("Return to Political Ownership Brush", "ui")
          : t("Use Visual Color Brush", "ui"),
        () => {
          storeVisualOpen(true);
          setScenarioMapPaintMode(isVisualBrush ? "ownership" : "visual");
        }
      );
      brushSection.appendChild(brushBtn);
    }

    if (!countryState) {
      body.appendChild(
        createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui"))
      );
      details.appendChild(body);
      container.appendChild(details);
      return;
    }

    if (countryState.releasable) {
      const presetRef = getPrimaryReleasablePresetRef(countryState);
      const coreSection = appendActionSection(body, t("Core Territory Visuals", "ui"));

      const applyVisualBtn = createInspectorActionButton(
        t("Apply Visual Color to Core Territory", "ui"),
        () => {
          applyScenarioReleasableCoreTerritory(countryState, {
            source: "visual-adjustments",
            actionMode: "visual",
          });
          setScenarioVisualAdjustmentsOpen(true);
        }
      );
      applyVisualBtn.disabled = !presetRef;
      coreSection.appendChild(applyVisualBtn);

      const clearVisualBtn = createInspectorActionButton(
        t("Clear Core Territory Visual Overrides", "ui"),
        () => {
          if (!presetRef) return;
          const requestedFeatureIds = Array.isArray(presetRef.preset?.ids) ? presetRef.preset.ids : [];
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
      clearVisualBtn.disabled = !presetRef;
      coreSection.appendChild(clearVisualBtn);

      if (!presetRef) {
        coreSection.appendChild(createEmptyNote(t("No core territory defined", "ui")));
      }
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
        countryState.hierarchyGroups.forEach((group) => {
          groupSection.appendChild(createInspectorActionButton(
            t(group.label, "geo") || group.label,
            () => {
              applyHierarchyGroupWithMode(group, {
                mode: "visual",
                color: getView().selectedColor,
                render,
                visualHistoryKind: "scenario-hierarchy-apply-visual",
                visualDirtyReason: "scenario-hierarchy-apply-visual",
              });
              setScenarioVisualAdjustmentsOpen(true);
            }
          ));
        });
      }

      renderRegionalPresets(body, countryState, { mode: "visual" });
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

    if (!isOwnershipEditingEnabled()) {
      if (countryState.scenarioSubject) renderScenarioParentReturnAction(container, countryState);
      renderScenarioRelatedCountryGroups(container, countryState);
    } else if (hasScenarioCoreTerritoryActions(countryState)) {
      renderScenarioReleasableActions(container, countryState);
    } else {
      renderScenarioParentActions(container, countryState);
    }
    renderScenarioVisualAdjustments(container, countryState);
  };

  return { renderScenarioActionsPanel };
}
