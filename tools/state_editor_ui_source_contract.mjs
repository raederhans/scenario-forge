import { createHash } from "node:crypto";
import { parse } from "acorn";

const REVISION = "52427d3a2b5e786f30ffcfb3491b6733be339f79";
const HOOK_PROVIDERS = {
  "js/core/state/index.js": "811223a7c5422b5aca91af5ea9cf58d3e9253afbcb550b467db3bb240914efb4",
  "js/core/state/runtime_hooks.js": "7f9013a236f228c8f4fde9069d6649441a9acd44fd6feb1a9725ff899f5ca1c2",
  "js/core/state/bus.js": "3a7323add0e7c4e87468338d74dc97f54038f86b118c6f1cf1cdc10d9d133bca",
  "js/core/state/config.js": "afa638dfa75616e09538a24ba9491febb7467fe38fb8598f396588e89d8a117b",
};
const SIDEBAR_PROVIDERS = {
  ...HOOK_PROVIDERS,
  "js/ui/palette_color_check_editor.js": "9f1a6bac9b8a06d8c943388831f6383e655a92f8320f3bf04a99e2a905e5551d",
  "js/ui/palette_color_check.js": "709fa6a6392987acb29e89cc42562e58708bdceca1588a715a8c2b4b97672393",
  "js/ui/palette_color_check_model.js": "f0f8902d4d00a476db9789f63aca2b4cd860341afc7827ae9a1320f70490fa44",
  "js/ui/palette_color_check_export.js": "2fd8bc850bd6fe5ebb3f0fb4cb107444691d2c1f43a84ea5d0bb17e5cd5d6abc",
  "js/ui/editor_workspace.js": "01afa5b349bc6734fee970185b3ed4fa2f66c5ac5690300ba1bc644804c94990",
  "js/ui/sidebar/project_support_diagnostics_controller.js": "e9976e31588dc4c37ad40af090019be5d00bd686f435ff9fc5b945c12ce9e172",
  "js/core/color_manager.js": "a9d801e17223a7f69af86186ee361a2ef847b72ee9d4e20738aeef5c985622bc",
  "js/core/color_hex_utils.js": "925fe10aa8433ccab2880057e64bdf7407554d893f0409a521229c1f7857a510",
  "js/core/legend_state_normalizers.js": "89f35bd0e8cffb5e599183d4055b4a57fa43dfe8125d39c663f1e33a9087810f",
  "js/core/file_manager.js": "2847f811fa70287538bb5b6e5f5f4cf6da5f7c302b77bc1e66e5b20f5daccdbc",
};
const TOOLBAR_PROVIDERS = {
  ...HOOK_PROVIDERS,
  "js/ui/view_bookmarks.js": "ad7745ea3d29e4451d98ecda644a790cdc73ec3d08cb693782986ea36443f1b5",
  "js/core/view_bookmarks.js": "c632986ef61d0f30393dc833a9bbe8d363da6fadc4512a5aa9b7b736550439ba",
  "js/core/map_renderer/public.js": "3e1f5ca347e07f2acd48b1c6eb194dcdbc387ea1231e6fd01c37980c8598c49f",
  "js/core/map_renderer.js": "f8a43c8a280d0e63cfbfeb010747181713534ac3a6230a7a0f806d671e6a4855",
  "js/core/renderer/viewport_command_owner.js": "e290355818ad29393a9a79f045b0e13a680de98b900be4e7fc80ccc940037ade",
  "js/core/state/actions/renderer_interaction_actions.js": "cb17749958bce05a30d974bf469535c57920a480dcd526ac20f648ed5a2dd5f5",
};
const lines = value => value.join("\n");
const sidebarTransforms = [
  ["hook-import", 'import { callRuntimeHook, registerRuntimeHook } from "../core/state/index.js";',
    'import { callRuntimeHook, registerRuntimeHook } from "../core/state/runtime_hooks.js";'],
  ["palette-editor-import", 'import { initEditorWorkspace } from "./editor_workspace.js";',
    'import { initEditorWorkspace } from "./editor_workspace.js";\nimport { initPaletteColorCheckEditor } from "./palette_color_check_editor.js";'],
  ["read-color-fallback", lines([
    "  const getResolvedCountryColor = (countryState) => {",
    '    if (!countryState?.code) return "#cccccc";',
    "    const fallbackColor = ensureCountryPaletteColor(countryState.code, countryState.fallbackIndex || 0);",
    "    return (", "      runtimeState.sovereignBaseColors?.[countryState.code] ||",
    "      runtimeState.countryPalette?.[countryState.code] ||", "      fallbackColor", "    );", "  };",
  ]), lines([
    "  const getResolvedCountryColor = (countryState) => {",
    '    if (!countryState?.code) return "#cccccc";',
    "    return (", "      runtimeState.sovereignBaseColors?.[countryState.code] ||",
    "      runtimeState.countryPalette?.[countryState.code] ||", "      defaultCountryPalette[countryState.code] ||",
    "      ColorManager.getPoliticalFallbackColor(countryState.code, countryState.fallbackIndex || 0) ||",
    '      "#cccccc"', "    );", "  };",
  ])],
  ["legend-focus-initializer", "  let refreshLegendEditor = () => {};", "  let refreshLegendEditor = () => {};\n  let focusLegendColor = () => false;"],
  ["legend-focus-result-binding", "    bindEvents: bindProjectSupportDiagnosticsEvents,\n    refreshLegendEditor,",
    "    bindEvents: bindProjectSupportDiagnosticsEvents,\n    refreshLegendEditor,\n    focusLegendColor,"],
  ["palette-editor-composition", "  syncEditorSelection();\n  scheduleAdaptiveInspectorHeights();", lines([
    "  syncEditorSelection();", "  initPaletteColorCheckEditor({", "    state: runtimeState,",
    "    getCountries: () => [...latestCountryStatesByCode.values()],", "    defaultPalette: defaultCountryPalette,",
    "    fallbackColor: (code, index) => ColorManager.getPoliticalFallbackColor(code, index),",
    "    selectCountry: selectInspectorCountry,", "    focusLegendColor,", "    workspace: editorWorkspace,",
    "  });", "  scheduleAdaptiveInspectorHeights();",
  ])],
];
const toolbarTransforms = [
  ["hook-import", 'import { callCompatRuntimeHook, callRuntimeHook, registerRuntimeHook } from "../core/state/index.js";',
    'import { callCompatRuntimeHook, callRuntimeHook, registerRuntimeHook } from "../core/state/runtime_hooks.js";'],
  ["bookmark-imports", 'import { bindPoliticalRasterTrialControl } from "./toolbar/political_raster_trial_control.js";', lines([
    'import { bindPoliticalRasterTrialControl } from "./toolbar/political_raster_trial_control.js";',
    'import { initViewBookmarks } from "./view_bookmarks.js";',
    'import { getViewBookmarkScope } from "../core/view_bookmarks.js";',
  ])],
  ["viewport-forwarder-imports", "  getPoliticalIdRasterDiagnostics,\n  setPoliticalIdRasterTrialEnabled,",
    "  getPoliticalIdRasterDiagnostics,\n  captureViewportView,\n  restoreViewportView,\n  setPoliticalIdRasterTrialEnabled,"],
  ["bookmark-local", "function initToolbar({ render } = {}) {", "function initToolbar({ render } = {}) {\n  let viewBookmarks = null;"],
  ["workspace-hook-callback", '  registerRuntimeHook(state, "updateWorkspaceStatusFn", refreshWorkspaceStatus);', lines([
    '  registerRuntimeHook(state, "updateWorkspaceStatusFn", () => {',
    "    refreshWorkspaceStatus();", "    viewBookmarks?.refresh();", "  });",
  ])],
  ["zoom-refresh", "  function updateZoomUi() {", "  function updateZoomUi() {\n    viewBookmarks?.refresh();"],
  ["bookmark-composition", '  registerRuntimeHook(state, "runToolSelectionFn", runToolSelection);', lines([
    "  viewBookmarks = initViewBookmarks({", '    host: document.getElementById("zoomUtilityViewportGroup"),',
    "    getContext: () => ({", "      scope: getViewBookmarkScope({ scenarioId: runtimeState.activeScenarioId, mapMode: runtimeState.mapSemanticMode }),",
    '      label: runtimeState.activeScenarioManifest?.display_name || runtimeState.activeScenarioId || "",',
    "      language: runtimeState.currentLanguage,",
    '      ready: runtimeState.bootPhase === "ready" && !runtimeState.startupReadonly && !runtimeState.scenarioApplyInFlight,',
    "    }),", "    captureView: captureViewportView,", "    restoreView: restoreViewportView,", "  });", "",
    '  registerRuntimeHook(state, "runToolSelectionFn", runToolSelection);',
  ])],
];
const definitions = {
  "js/ui/sidebar.js": {
    previous: "1f4ac3fea7a46572daf9bfd3fc6852b1c18bb04532d3638da8e54c2a2849d112",
    intermediate: "54ca2d69d1d5d6eb2ea823d612f9fa7f7fb15524600848d40e6bb0a28f192632",
    current: "7ae4734bd9a0ad54071238e750ecfecb41054ebf565e077f6defc9721bcf54ab",
    count: 2221, providers: SIDEBAR_PROVIDERS, transforms: sidebarTransforms,
    deltas: [
      { kind: "removed-palette-initialization-call", nodeType: "CallExpression",
        previous: "ca2a0044272c25d1155837595f73b1fe90fc44df68ea3e2c0bd9bb1155a64938", current: null,
        previousAncestry: ["initSidebar#0", "ArrowFunctionExpression:aaff205a3b5d7703b6d7c6d5c9a1b6809c917d1c9a722488020058dbd35685ce#0"],
        effect: "This getter no longer calls ensureCountryPaletteColor. Other callers and the mutating helper are unchanged; new fallback reads are not declared pure." },
      { kind: "extended-controller-result-assignment", nodeType: "AssignmentExpression",
        previous: "0ba617cc79d339c042f14e66d436dca95c1af2bf7b9687b1d567e75f3256c008",
        current: "9dea78fb6cdc95c751b53ea8d557808b8a9a45e0cb4604c0155e3680f406c28c",
        previousAncestry: ["initSidebar#0"], currentAncestry: ["initSidebar#0"],
        effect: "The existing effectful controller call is retained; its focusLegendColor result is additionally assigned to a local binding." },
    ],
  },
  "js/ui/toolbar.js": {
    previous: "a580f7b8b9029454b668eefd794419c1fffe23a5d4c43923ad9fbb2109eea22e",
    intermediate: "5922fff8c8f1851aa015d1aac92b7db149ebaa4cfbf05a07a72b48527e434e17",
    current: "2bf6afd666b44d295e78d30d153ccd0e5a9795374374afd1101776d26799773a",
    count: 1553, providers: TOOLBAR_PROVIDERS, transforms: toolbarTransforms,
    deltas: [
      { kind: "replaced-workspace-hook-callback", nodeType: "CallExpression",
        previous: "160cd22a81b98ea0d3910d0327dbc8c391b457fafd3d16ac874f36ed802c5662",
        current: "df485d3bac1f4bbe25097452e2caaafe7115b982729d7dd12d259d7b85877157",
        previousAncestry: ["initToolbar#0"], currentAncestry: ["initToolbar#0"],
        effect: "The same hook name now receives a wrapper calling refreshWorkspaceStatus() then viewBookmarks?.refresh(); arguments and return values are not forwarded. Hook, UI and viewport effects remain effectful." },
    ],
  },
};
const normalize = value => {
  if (typeof value !== "string") throw Error("source evidence must be text");
  return value.replace(/\r\n?/g, "\n");
};
const hash = value => createHash("sha256").update(value).digest("hex");
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function sitesOf(source) {
  const sites = [], ordinals = new Map();
  const visit = (node, ancestry) => {
    if (!node?.type) return;
    let scope = ancestry;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
      const name = node.id?.name || `${node.type}:${hash(source.slice(node.start, node.end))}`;
      const key = JSON.stringify([...ancestry, name]), ordinal = ordinals.get(key) || 0;
      ordinals.set(key, ordinal + 1); scope = [...ancestry, `${name}#${ordinal}`];
    }
    if (["AssignmentExpression", "UpdateExpression", "CallExpression", "NewExpression"].includes(node.type)
      || node.type === "UnaryExpression" && node.operator === "delete") {
      const sourceText = source.slice(node.start, node.end);
      sites.push({ nodeType: node.type, operator: node.operator || "", start: node.start, end: node.end,
        line: node.loc.start.line, column: node.loc.start.column + 1,
        lexicalAncestry: scope, source: sourceText, sourceFingerprint: hash(sourceText) });
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => visit(value, scope));
      else if (child?.type) visit(child, scope);
    }
  };
  visit(parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true }), []);
  return sites.sort((left, right) => left.start - right.start || left.end - right.end);
}
function replaceExactly(state, [name, before, after]) {
  const start = state.source.indexOf(before), end = start + before.length;
  if (start < 0 || state.source.indexOf(before, start + 1) >= 0) throw Error(`non-unique edit: ${name}`);
  for (const site of state.sites) {
    if (site.end <= start) continue;
    if (site.start >= end) { site.start += after.length - before.length; site.end += after.length - before.length; continue; }
    if (site.start < start || site.end > end) throw Error(`unregistered site changes across ${name}`);
    const offset = after.indexOf(site.source);
    if (offset < 0 || after.indexOf(site.source, offset + 1) >= 0) throw Error(`unregistered site removed or duplicated by ${name}`);
    site.start = start + offset; site.end = site.start + site.source.length;
  }
  state.source = state.source.slice(0, start) + after + state.source.slice(end);
  state.transforms.push({ name, start, beforeFingerprint: hash(before), afterFingerprint: hash(after) });
}
const sameAncestry = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const position = site => ({ start: site.start, end: site.end, line: site.line, column: site.column });
function exactDeltaSite(sites, fingerprint, kind, ancestry) {
  const matches = sites.filter(site => site.sourceFingerprint === fingerprint && site.nodeType === kind && sameAncestry(site.lexicalAncestry, ancestry));
  if (matches.length !== 1) throw Error("effect delta site is missing or ambiguous");
  return matches[0];
}

// Source continuity only: explicit effect deltas cannot supply writer grants,
// retirement identities/counts, pure-reader permissions or diagnostic credit.
export function inspectStateEditorUiSourceRefreshEvidence({ modulePath, sourceFingerprint, source, readCurrentSource, readHistoricalSource } = {}) {
  const definition = Object.hasOwn(definitions, modulePath) ? definitions[modulePath] : null;
  if (!definition || definition.previous !== sourceFingerprint) return { matched: null, violations: [], receipt: null };
  try {
    const current = normalize(source), previous = normalize(readHistoricalSource(REVISION, modulePath));
    if (hash(previous) !== definition.previous || hash(current) !== definition.current) throw Error("current or historical source drift");
    for (const [path, expected] of Object.entries(definition.providers)) {
      if (hash(normalize(readCurrentSource(path))) !== expected) throw Error(`provider source drift: ${path}`);
    }
    const oldSites = sitesOf(previous), currentSites = sitesOf(current);
    if (oldSites.length !== definition.count) throw Error("historical effect site inventory changed");
    const deltaOld = new Set(), deltaCurrent = new Set();
    const effectDeltas = definition.deltas.map(delta => {
      const old = exactDeltaSite(oldSites, delta.previous, delta.nodeType, delta.previousAncestry);
      const changed = delta.current ? exactDeltaSite(currentSites, delta.current, delta.nodeType, delta.currentAncestry) : null;
      deltaOld.add(old); if (changed) deltaCurrent.add(changed);
      if (!changed && currentSites.some(site => site.sourceFingerprint === old.sourceFingerprint && sameAncestry(site.lexicalAncestry, old.lexicalAncestry))) throw Error("removed effect was restored");
      return { ...delta, previousSite: position(old), currentSite: changed ? position(changed) : null };
    });
    const retained = oldSites.filter(site => !deltaOld.has(site));
    const state = { source: previous, sites: retained.map(site => ({ ...site })), transforms: [] };
    replaceExactly(state, definition.transforms[0]);
    if (hash(state.source) !== definition.intermediate) throw Error("hook-only intermediate changed");
    for (const transform of definition.transforms.slice(1)) replaceExactly(state, transform);
    if (state.source !== current) throw Error("exact transforms do not reconstruct current source");
    const byRange = new Map(currentSites.map(site => [`${site.start}:${site.end}:${site.nodeType}`, site])), used = new Set(deltaCurrent);
    const preservedSites = state.sites.map((mapped, index) => {
      const old = retained[index], actual = byRange.get(`${mapped.start}:${mapped.end}:${mapped.nodeType}`);
      if (!actual || used.has(actual) || actual.source !== old.source || actual.operator !== old.operator
        || !sameAncestry(actual.lexicalAncestry, old.lexicalAncestry)) throw Error("unregistered historical site or ancestry change");
      used.add(actual);
      return { nodeType: old.nodeType, sourceFingerprint: old.sourceFingerprint, lexicalAncestry: old.lexicalAncestry,
        previous: position(old), current: position(actual) };
    });
    const addedSites = currentSites.filter(site => !used.has(site)).map(site => ({ nodeType: site.nodeType,
      sourceFingerprint: site.sourceFingerprint, lexicalAncestry: site.lexicalAncestry, current: position(site) }));
    return { matched: true, violations: [], receipt: freeze({ modulePath, previousSourceRevision: REVISION,
      previousSourceFingerprint: definition.previous, hookIntermediateFingerprint: definition.intermediate, sourceFingerprint: definition.current,
      transforms: state.transforms, providerFingerprints: { ...definition.providers }, effectDeltas, preservedSites, addedSites,
      historicalSiteCount: oldSites.length, currentSiteCount: currentSites.length,
      grantsWriterAuthority: false, grantsDiagnosticCredit: false, grantsPureReaderPermission: false, refreshesRetirementIdentity: false,
      boundary: "Registered wiring changes have real UI/hook/storage/viewport effects. Original retirement anchors and counts, current mutation rejection and all action/effect checks remain independent." }) };
  } catch (error) {
    return { matched: false, violations: [{ code: "editor-ui-source-refresh-invalid", message: error.message }], receipt: null };
  }
}
export function inspectStateEditorUiSourceRefresh(options) {
  return inspectStateEditorUiSourceRefreshEvidence(options).matched;
}
