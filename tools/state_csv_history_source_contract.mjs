import { createHash } from "node:crypto";
import { parse } from "acorn";

export const CSV_HISTORY_SOURCE_PATH = "js/core/history_manager.js";
const SOURCE_REVISION = "52427d3a2b5e786f30ffcfb3491b6733be339f79";
const PREVIOUS_HASH = "895bb71dade9a1c3ec6d8827255da654e71fa76722bdbba3c34be01ec32891d2";
const HOOK_HASH = "8a16fe10760048725a7f03e2e306a8355a59521224ce701bdc74b22115219915";
const CURRENT_HASH = "dd13d491044fbf1195333cb7721c45986e8ab1e6d7b7c4978d7657a6b4acdea5";
// Only providers used by the added CSV capture/restore paths and the existing
// hook migration are pinned here. This is not a permission to call them or to
// skip their normal action, input, effect or retirement validation.
const PROVIDERS = Object.freeze({
  "js/core/state/index.js": "811223a7c5422b5aca91af5ea9cf58d3e9253afbcb550b467db3bb240914efb4",
  "js/core/state/runtime_hooks.js": "7f9013a236f228c8f4fde9069d6649441a9acd44fd6feb1a9725ff899f5ca1c2",
  "js/core/state/bus.js": "3a7323add0e7c4e87468338d74dc97f54038f86b118c6f1cf1cdc10d9d133bca",
  "js/core/state/config.js": "afa638dfa75616e09538a24ba9491febb7467fe38fb8598f396588e89d8a117b",
  "js/core/state/actions/legend_actions.js": "e82ac9f6585dbdfba302ccc39cdfaa85d97311fa6f5e5a9890bc4427f2002992",
  "js/core/state/actions/special_zone_actions.js": "7954e77106896b586ce1079ba7f41805859875b983474eafa02e8776296881e1",
  "js/core/state/actions/scenario_palette_actions.js": "38b3b56dd5e421d0e7a323a153b071f4cfb936834584070b29344ab1c82d8d6d",
  "js/core/legend_csv_schema.js": "21199ccd1394d13e55c66e4c7097a791a705ce7dd7ba642c642b462a8872faa4",
  "js/core/legend_state_normalizers.js": "89f35bd0e8cffb5e599183d4055b4a57fa43dfe8125d39c663f1e33a9087810f",
  "js/core/color_hex_utils.js": "925fe10aa8433ccab2880057e64bdf7407554d893f0409a521229c1f7857a510",
  "js/core/dirty_state.js": "2c9225bb1d70f575b7aae87661e85bb39b172a31fc6776099c9c9b0c6a00b1eb",
  "js/core/state/actions/ui_dirty_actions.js": "eab3360a68c5da6893b021aeaf75fe37b0c5b754188029f92b1cc48399efeaf7",
});
const normalize = source => {
  if (typeof source !== "string") throw Error("source evidence must be text");
  return source.replace(/\r\n?/g, "\n");
};
const hash = source => createHash("sha256").update(source).digest("hex");
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const text = lines => lines.join("\n");
const captureFields = text([
  "  if (legendKeys.length) {",
  "    snapshot.legendLabels = captureEntries(runtimeState.legendLabels || {}, legendKeys);",
  "    snapshot.legendLabelKeysPresent = JSON.stringify(legendKeys.filter(key => Object.hasOwn(runtimeState.legendLabels || {}, key)));",
  "  }",
  "",
  "  const zoneIds = new Set((Array.isArray(legendSpecialZoneIds) ? legendSpecialZoneIds : [])",
  '    .filter(id => typeof id === "string" && id));',
  "  if (zoneIds.size) {",
  "    const layers = Array.isArray(runtimeState.specialZoneLayers?.layers) ? runtimeState.specialZoneLayers.layers : [];",
  "    const selected = [];",
  "    for (const id of zoneIds) {",
  "      const matches = layers.filter(layer => layer?.id === id);",
  "      if (matches.length !== 1) continue;",
  "      const layer = matches[0];",
  '      const hasStyle = Object.hasOwn(layer, "style");',
  '      const styleObject = !!(hasStyle && layer.style && typeof layer.style === "object" && !Array.isArray(layer.style));',
  "      const fields = {",
  '        name: Object.hasOwn(layer, "name") ? cloneStructuredValue(layer.name) : null,',
  "        style: cloneStructuredValue(captureEntries(styleObject ? layer.style : {}, SPECIAL_ZONE_LEGEND_STYLE_KEYS)),",
  "        presence: {",
  '          name: Object.hasOwn(layer, "name"),',
  "          style: hasStyle,",
  "          styleObject,",
  "          styleKeys: styleObject ? SPECIAL_ZONE_LEGEND_STYLE_KEYS.filter(key => Object.hasOwn(layer.style, key)) : [],",
  "        },",
  "      };",
  "      if (hasStyle && !styleObject) fields.styleContainerValue = cloneStructuredValue(layer.style);",
  "      selected.push([id, fields]);",
  "    }",
  "    if (selected.length) snapshot.specialZoneLegendFields = JSON.stringify(Object.fromEntries(selected));",
  "  }",
  "",
  "",
]);
const restoreFields = text([
  '  if (Object.hasOwn(snapshot, "legendLabels")',
  "    && restoreLegendLabelSnapshotState(runtimeState, snapshot.legendLabels, snapshot.legendLabelKeysPresent)) {",
  '    markDirty("legend-history");',
  "  }",
  '  if (Object.hasOwn(snapshot, "specialZoneLegendFields")',
  "    && restoreSpecialZoneLegendSnapshotState(runtimeState, snapshot.specialZoneLegendFields).length) {",
  '    markDirty("legend-history");',
  "  }",
  "",
]);
const scopeGuard = text([
  "function isLegendCsvHistoryScopeCurrent(entry) {",
  '  if (entry?.kind !== "legend-csv-import") return true;',
  "  const scenarioId = entry.meta?.scenarioId;",
  "  const baselineHash = entry.meta?.scenarioBaselineHash;",
  '  return typeof scenarioId === "string" && scenarioId.length > 0',
  '    && typeof baselineHash === "string" && baselineHash.length > 0',
  "    && scenarioId === runtimeState.activeScenarioId",
  "    && baselineHash === runtimeState.scenarioBaselineHash;",
  "}",
  "",
  "",
]);
const transforms = [
  ["hook-import", 'import { callRuntimeHook, callRuntimeHooks } from "./state/index.js";',
    'import { callRuntimeHook, callRuntimeHooks } from "./state/runtime_hooks.js";'],
  ["csv-imports", 'import { restoreSpecialZoneSnapshotState } from "./state/actions/special_zone_actions.js";', text([
    "import {", "  restoreSpecialZoneSnapshotState,", "  restoreSpecialZoneLegendSnapshotState,",
    '} from "./state/actions/special_zone_actions.js";',
    'import { SPECIAL_ZONE_LEGEND_STYLE_KEYS } from "./legend_csv_schema.js";',
    'import { restoreLegendLabelSnapshotState } from "./state/actions/legend_actions.js";',
    'import { normalizeColor } from "./legend_state_normalizers.js";',
  ])],
  ["capture-parameters", "  stylePaths = [],\n", "  stylePaths = [],\n  legendColors = [],\n  legendSpecialZoneIds = [],\n"],
  ["capture-color-keys", "  const styleKeys = uniqueKeys(stylePaths);\n",
    "  const styleKeys = uniqueKeys(stylePaths);\n  const legendKeys = uniqueKeys((Array.isArray(legendColors) ? legendColors : []).map(normalizeColor));\n"],
  ["capture-csv-fields", "  if (strategicOverlay) {", captureFields + "  if (strategicOverlay) {"],
  ["restore-csv-fields", "  applyStyleSnapshot(snapshot.styleConfig);\n", "  applyStyleSnapshot(snapshot.styleConfig);\n" + restoreFields],
  ["csv-scope-guard", "function canUndoHistory() {", scopeGuard + "function canUndoHistory() {"],
  ["undo-scope-check", "  return Array.isArray(runtimeState.historyPast) && runtimeState.historyPast.length > 0;",
    "  return Array.isArray(runtimeState.historyPast) && runtimeState.historyPast.length > 0\n    && isLegendCsvHistoryScopeCurrent(runtimeState.historyPast.at(-1));"],
  ["redo-scope-check", "  return Array.isArray(runtimeState.historyFuture) && runtimeState.historyFuture.length > 0;",
    "  return Array.isArray(runtimeState.historyFuture) && runtimeState.historyFuture.length > 0\n    && isLegendCsvHistoryScopeCurrent(runtimeState.historyFuture.at(-1));"],
];

// Enumerate every historical mutation/call/construction expression, including
// nested helpers and callbacks. These are preservation witnesses, not the
// retirement validator's mutation count or a source of diagnostic credits.
function effectSites(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const sites = [], ordinals = new Map();
  const visit = (node, ancestry) => {
    if (!node || typeof node !== "object" || !node.type) return;
    let scope = ancestry;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
      const name = node.id?.name || `${node.type}:${hash(source.slice(node.start, node.end))}`;
      const key = JSON.stringify([...ancestry, name]), ordinal = ordinals.get(key) || 0;
      ordinals.set(key, ordinal + 1);
      scope = [...ancestry, `${name}#${ordinal}`];
    }
    if (["AssignmentExpression", "UpdateExpression", "CallExpression", "NewExpression"].includes(node.type)
      || (node.type === "UnaryExpression" && node.operator === "delete")) {
      const value = source.slice(node.start, node.end);
      sites.push({ nodeType: node.type, operator: node.operator || "", start: node.start, end: node.end,
        line: node.loc.start.line, column: node.loc.start.column + 1, lexicalAncestry: scope,
        source: value, sourceFingerprint: hash(value) });
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => visit(value, scope));
      else if (child?.type) visit(child, scope);
    }
  };
  visit(ast, []);
  return sites.sort((left, right) => left.start - right.start || left.end - right.end);
}

function replaceExactly(state, [name, before, after]) {
  const start = state.source.indexOf(before), end = start + before.length;
  if (start < 0 || state.source.indexOf(before, start + 1) >= 0) throw Error(`non-unique transformation: ${name}`);
  for (const site of state.sites) {
    if (site.end <= start) continue;
    if (site.start >= end) {
      site.start += after.length - before.length;
      site.end += after.length - before.length;
      continue;
    }
    if (site.start < start || site.end > end) throw Error(`historical site crosses edit: ${name}`);
    const offset = after.indexOf(site.source);
    if (offset < 0 || after.indexOf(site.source, offset + 1) >= 0) throw Error(`historical site was changed or duplicated: ${name}`);
    site.start = start + offset;
    site.end = site.start + site.source.length;
  }
  state.source = state.source.slice(0, start) + after + state.source.slice(end);
  state.transforms.push({ name, start, beforeFingerprint: hash(before), afterFingerprint: hash(after) });
}

export function inspectStateCsvHistorySourceRefreshEvidence({
  modulePath, sourceFingerprint, source, readCurrentSource, readHistoricalSource,
} = {}) {
  if (modulePath !== CSV_HISTORY_SOURCE_PATH || sourceFingerprint !== PREVIOUS_HASH) {
    return { matched: null, violations: [], receipt: null };
  }
  try {
    const current = normalize(source), previous = normalize(readHistoricalSource(SOURCE_REVISION, modulePath));
    if (hash(previous) !== PREVIOUS_HASH || hash(current) !== CURRENT_HASH) throw Error("current or historical source drift");
    for (const [path, expected] of Object.entries(PROVIDERS)) {
      if (hash(normalize(readCurrentSource(path))) !== expected) throw Error(`provider source drift: ${path}`);
    }
    const previousSites = effectSites(previous), counts = {};
    for (const site of previousSites) counts[site.nodeType] = (counts[site.nodeType] || 0) + 1;
    if (previousSites.length !== 181 || counts.CallExpression !== 144 || counts.NewExpression !== 3
      || counts.AssignmentExpression !== 33 || counts.UnaryExpression !== 1) throw Error("historical site inventory changed");
    const state = { source: previous, sites: previousSites.map(site => ({ ...site })), transforms: [] };
    replaceExactly(state, transforms[0]);
    if (hash(state.source) !== HOOK_HASH) throw Error("hook migration is not the exact intermediate source");
    for (const transform of transforms.slice(1)) replaceExactly(state, transform);
    if (state.source !== current) throw Error("CSV changes do not reconstruct the complete current source");
    const currentSites = new Map(effectSites(current).map(site => [`${site.start}:${site.end}:${site.nodeType}`, site]));
    const consumed = new Set();
    const preservedSites = state.sites.map((mapped, index) => {
      const key = `${mapped.start}:${mapped.end}:${mapped.nodeType}`, actual = currentSites.get(key), old = previousSites[index];
      if (!actual || consumed.has(key) || actual.source !== old.source || actual.operator !== old.operator
        || JSON.stringify(actual.lexicalAncestry) !== JSON.stringify(old.lexicalAncestry)) throw Error("historical site ancestry or identity changed");
      consumed.add(key);
      return { nodeType: old.nodeType, sourceFingerprint: old.sourceFingerprint, lexicalAncestry: old.lexicalAncestry,
        previous: { start: old.start, end: old.end, line: old.line, column: old.column },
        current: { start: actual.start, end: actual.end, line: actual.line, column: actual.column } };
    });
    return { matched: true, violations: [], receipt: freeze({ modulePath, previousSourceRevision: SOURCE_REVISION,
      previousSourceFingerprint: PREVIOUS_HASH, hookIntermediateFingerprint: HOOK_HASH, sourceFingerprint: CURRENT_HASH,
      providerFingerprints: { ...PROVIDERS }, transforms: state.transforms, preservedSites,
      preservedSiteCounts: counts, preservedHistoricalSiteCount: preservedSites.length,
      grantsWriterAuthority: false, grantsDiagnosticCredit: false, refreshesRetirementIdentity: false,
      boundary: "Only exact source continuity is proved. Historical retirement counts, memberships, action checks and current mutation rejection still run independently." }) };
  } catch (error) {
    return { matched: false, violations: [{ code: "csv-history-source-refresh-invalid", message: error.message }], receipt: null };
  }
}

// Tri-state adapter: unknown pairs defer to other existing receipts; a known
// pair with failed evidence is rejected and must not fall back to old credit.
export function inspectStateCsvHistorySourceRefresh(options) {
  return inspectStateCsvHistorySourceRefreshEvidence(options).matched;
}
