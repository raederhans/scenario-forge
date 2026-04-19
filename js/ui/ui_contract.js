const UI_TITLE_ROLE_CLASSES = Object.freeze({
  shellAnchor: "sidebar-shell-anchor",
  anchorTitle: "sidebar-anchor-title",
  sectionTitle: "sidebar-section-title",
  supportTitle: "sidebar-support-title",
  appendixTitle: "sidebar-appendix-title",
  toolTitle: "sidebar-tool-title",
});

const UI_SURFACE_ROLE_CLASSES = Object.freeze({
  sectionShell: "sidebar-section-shell",
  sectionHead: "sidebar-section-head",
  supportBlock: "sidebar-support-block",
  supportHead: "sidebar-support-head",
  appendixShell: "sidebar-appendix-shell",
  appendixHead: "sidebar-appendix-head",
  emptyState: "sidebar-empty-state",
  detailGroup: "sidebar-detail-group",
  supportActions: "sidebar-support-actions",
  toolPanel: "sidebar-tool-panel",
});

const UI_COPY_ROLE_CLASSES = Object.freeze({
  groupLabel: "sidebar-group-label",
  fieldLabel: "sidebar-field-label",
  helpCopy: "sidebar-help-copy",
  emptyCopy: "sidebar-empty-copy",
  sectionInfoTrigger: "sidebar-section-info-trigger",
});

const UI_ACTION_ROLE_CLASSES = Object.freeze({
  primary: "sidebar-action-primary",
  secondary: "sidebar-action-secondary",
  supportEntry: "sidebar-support-entry-btn",
  toolPrimary: "sidebar-tool-action-primary",
  modifiers: Object.freeze({
    danger: "is-danger",
    sectionTail: "is-section-tail",
    secondary: "is-secondary",
    conditional: "is-conditional",
    title: "is-title",
  }),
});

const UI_URL_STATE_KEYS = Object.freeze({
  scope: "scope",
  tab: "tab",
  section: "section",
  guideSection: "guide_section",
  query: "query",
  page: "page",
  view: "view",
});

const UI_SCOPE_CONTRACT = Object.freeze({
  categories: Object.freeze([
    "current-object",
    "current-layer",
    "current-project",
  ]),
  defaultCategory: "current-project",
  switchingMode: "automatic-default-and-manual-lock",
});

const UI_OVERLAY_KINDS = Object.freeze({
  popover: Object.freeze({
    kind: "popover",
    allowsFocusTrap: false,
    intent: "local-short-stay-micro-action",
  }),
  dialog: Object.freeze({
    kind: "dialog",
    allowsFocusTrap: true,
    intent: "long-read-form-danger-confirm-project-setting",
  }),
  overlay: Object.freeze({
    kind: "overlay",
    allowsFocusTrap: false,
    intent: "blocking-state-or-workspace-switch",
  }),
});

const UI_TEXT_CONTRACT = Object.freeze({
  shellAnchors: Object.freeze(["scope-project", "scope-inspector"]),
  primaryAnchors: Object.freeze(["project-legend-anchor"]),
  sectionTitles: Object.freeze([
    "country-inspector",
    "territories-presets",
    "water-regions",
    "special-regions",
    "frontline",
  ]),
  supportHeads: Object.freeze(["utilities-support"]),
  appendixHeads: Object.freeze(["diagnostics-appendix"]),
  structuralLabels: Object.freeze([
    "visibility-group",
    "interaction-group",
    "water-overrides-group",
    "special-region-overrides-group",
    "export-format-field",
  ]),
  emptyStateTitles: Object.freeze([
    "water-region-empty",
    "special-region-empty",
  ]),
});

const UI_INTERACTION_CONTRACT = Object.freeze({
  defaultButtonLanguage: "text-first",
  singlePrimaryActionPerSurface: true,
  iconOnlyAllowlist: Object.freeze([
    "high-frequency-tool",
    "viewport-control",
    "shell-utility",
    "micro-control",
  ]),
  iconOnlyBlocklist: Object.freeze([
    "project-action",
    "support-tool-entry",
    "danger-action",
    "settings-entry",
    "language-toggle",
  ]),
  overlayKinds: UI_OVERLAY_KINDS,
});

const UI_URL_STATE_CONTRACT = Object.freeze({
  required: Object.freeze([
    UI_URL_STATE_KEYS.scope,
    UI_URL_STATE_KEYS.tab,
    UI_URL_STATE_KEYS.section,
    UI_URL_STATE_KEYS.query,
    UI_URL_STATE_KEYS.page,
    UI_URL_STATE_KEYS.view,
  ]),
  localOnly: Object.freeze([
    "hover",
    "tooltip",
    "transient",
  ]),
});

const UI_DENSITY_CONTRACT = Object.freeze({
  loose: Object.freeze(["map-canvas", "top-bar", "left-rail", "dock-shell"]),
  medium: Object.freeze(["right-sidebar", "utility-group", "support-surface", "appendix-surface"]),
  tight: Object.freeze(["local-list", "local-tool-group", "micro-control", "pro-workspace-core"]),
});

function getFocusableElements(container) {
  if (!(container instanceof HTMLElement)) return [];
  return Array.from(container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => (
    element instanceof HTMLElement
    && !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && element.tabIndex >= 0
  ));
}

function focusSurface(container) {
  if (!(container instanceof HTMLElement)) return null;
  const [firstFocusable] = getFocusableElements(container);
  const target = firstFocusable || container;
  if (target === container && !container.hasAttribute("tabindex")) {
    container.setAttribute("tabindex", "-1");
  }
  if (typeof target.focus === "function") {
    target.focus({ preventScroll: true });
    return target;
  }
  return null;
}

function captureFocusOrigin(doc = document) {
  return doc?.activeElement instanceof HTMLElement ? doc.activeElement : null;
}

function restoreFocusOrigin(element) {
  if (element instanceof HTMLElement && document.contains(element)) {
    element.focus({ preventScroll: true });
  }
  return element instanceof HTMLElement ? element : null;
}

function applyDialogContract(
  dialog,
  {
    tone = "info",
    labelledBy = "",
    describedBy = [],
  } = {},
) {
  if (!(dialog instanceof HTMLElement)) return dialog;
  const normalizedTone = String(tone || "info").trim().toLowerCase();
  const descriptionIds = Array.isArray(describedBy)
    ? describedBy.filter((value) => String(value || "").trim())
    : [String(describedBy || "").trim()].filter(Boolean);

  dialog.setAttribute(
    "role",
    normalizedTone === "warning" || normalizedTone === "error" ? "alertdialog" : "dialog",
  );
  dialog.setAttribute("aria-modal", "true");
  if (labelledBy) {
    dialog.setAttribute("aria-labelledby", labelledBy);
  } else {
    dialog.removeAttribute("aria-labelledby");
  }
  if (descriptionIds.length) {
    dialog.setAttribute("aria-describedby", descriptionIds.join(" "));
  } else {
    dialog.removeAttribute("aria-describedby");
  }
  dialog.dataset.uiOverlayKind = UI_OVERLAY_KINDS.dialog.kind;
  dialog.tabIndex = -1;
  return dialog;
}

function createFocusReturnRegistry() {
  return new WeakMap();
}

function rememberSurfaceTrigger(registry, surface, trigger) {
  if (!(registry instanceof WeakMap) || !(surface instanceof HTMLElement) || !(trigger instanceof HTMLElement)) {
    return;
  }
  registry.set(surface, trigger);
}

function restoreSurfaceTriggerFocus(registry, surface, explicitTrigger = null) {
  const target = explicitTrigger instanceof HTMLElement
    ? explicitTrigger
    : (registry instanceof WeakMap && surface instanceof HTMLElement ? registry.get(surface) : null);
  if (target && typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }
  return target || null;
}

function getUiContractSnapshot() {
  return {
    scope: {
      categories: [...UI_SCOPE_CONTRACT.categories],
      defaultCategory: UI_SCOPE_CONTRACT.defaultCategory,
      switchingMode: UI_SCOPE_CONTRACT.switchingMode,
    },
    classes: {
      title: { ...UI_TITLE_ROLE_CLASSES },
      surface: { ...UI_SURFACE_ROLE_CLASSES },
      copy: { ...UI_COPY_ROLE_CLASSES },
      action: {
        primary: UI_ACTION_ROLE_CLASSES.primary,
        secondary: UI_ACTION_ROLE_CLASSES.secondary,
        supportEntry: UI_ACTION_ROLE_CLASSES.supportEntry,
        toolPrimary: UI_ACTION_ROLE_CLASSES.toolPrimary,
        modifiers: { ...UI_ACTION_ROLE_CLASSES.modifiers },
      },
    },
    text: {
      shellAnchors: [...UI_TEXT_CONTRACT.shellAnchors],
      primaryAnchors: [...UI_TEXT_CONTRACT.primaryAnchors],
      sectionTitles: [...UI_TEXT_CONTRACT.sectionTitles],
      supportHeads: [...UI_TEXT_CONTRACT.supportHeads],
      appendixHeads: [...UI_TEXT_CONTRACT.appendixHeads],
      structuralLabels: [...UI_TEXT_CONTRACT.structuralLabels],
      emptyStateTitles: [...UI_TEXT_CONTRACT.emptyStateTitles],
    },
    interaction: {
      defaultButtonLanguage: UI_INTERACTION_CONTRACT.defaultButtonLanguage,
      singlePrimaryActionPerSurface: UI_INTERACTION_CONTRACT.singlePrimaryActionPerSurface,
      iconOnlyAllowlist: [...UI_INTERACTION_CONTRACT.iconOnlyAllowlist],
      iconOnlyBlocklist: [...UI_INTERACTION_CONTRACT.iconOnlyBlocklist],
      overlayKinds: {
        popover: { ...UI_INTERACTION_CONTRACT.overlayKinds.popover },
        dialog: { ...UI_INTERACTION_CONTRACT.overlayKinds.dialog },
        overlay: { ...UI_INTERACTION_CONTRACT.overlayKinds.overlay },
      },
    },
    urlState: {
      required: [...UI_URL_STATE_CONTRACT.required],
      localOnly: [...UI_URL_STATE_CONTRACT.localOnly],
    },
    density: {
      loose: [...UI_DENSITY_CONTRACT.loose],
      medium: [...UI_DENSITY_CONTRACT.medium],
      tight: [...UI_DENSITY_CONTRACT.tight],
    },
  };
}

export {
  UI_ACTION_ROLE_CLASSES,
  UI_COPY_ROLE_CLASSES,
  UI_DENSITY_CONTRACT,
  UI_INTERACTION_CONTRACT,
  UI_OVERLAY_KINDS,
  UI_SCOPE_CONTRACT,
  UI_SURFACE_ROLE_CLASSES,
  UI_TEXT_CONTRACT,
  UI_TITLE_ROLE_CLASSES,
  UI_URL_STATE_CONTRACT,
  UI_URL_STATE_KEYS,
  applyDialogContract,
  captureFocusOrigin,
  createFocusReturnRegistry,
  focusSurface,
  getFocusableElements,
  getUiContractSnapshot,
  rememberSurfaceTrigger,
  restoreFocusOrigin,
  restoreSurfaceTriggerFocus,
};
