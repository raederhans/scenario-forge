import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { full } from "acorn-walk";

export const CSV_TARGET_ACTION_PATH = "js/core/state/actions/special_zone_actions.js";
const SOURCE_FINGERPRINTS = Object.freeze({
  [CSV_TARGET_ACTION_PATH]: "7954e77106896b586ce1079ba7f41805859875b983474eafa02e8776296881e1",
  "js/core/legend_csv_schema.js": "21199ccd1394d13e55c66e4c7097a791a705ce7dd7ba642c642b462a8872faa4",
  "js/core/history_manager.js": "dd13d491044fbf1195333cb7721c45986e8ab1e6d7b7c4978d7657a6b4acdea5",
  "js/core/legend_csv_import_transaction.js": "92784e20f544c44830f57777255d7d4d97487bded7e24c1b9002d418f3cf50b9",
});
const EXPORTS = Object.freeze([
  ["patchSpecialZoneLegendFieldsState", 532, 72],
  ["restoreSpecialZoneLegendSnapshotState", 536, 77],
]);
const APPLY = "applySpecialZoneLegendFieldsState";
const RESTORE = "restoreSpecialZoneLegendFieldsWithPresence";
const normalize = source => String(source).replace(/\r\n?/g, "\n");
const hash = source => createHash("sha256").update(source).digest("hex");
const defaultReadSource = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const identity = name => JSON.stringify({ kind: "function", ancestry: [{ name, ordinal: 0 }] });
const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const nodes = (root, predicate) => {
  const result = [];
  full(root, node => { if (predicate(node)) result.push(node); });
  return result;
};
const functionNamed = (ast, name) => ast.body.map(node => node.declaration || node)
  .find(node => node.type === "FunctionDeclaration" && node.id?.name === name);

// This is an effect receipt for two canonical actions, not a reader/detachment
// contract. The fresh array and shallow records retain borrowed layer metadata.
// Each tuple names one reviewed expression, its lexical scope and its effect.
const SITE_SPECS = [
  [425, 21, "layer", RESTORE, "layer-copy", "layer", ["target", "current", "inputLayers", "layer", "layer"], ["specialZoneLayers", "layers", "*"], true],
  [431, 24, "currentStyle", RESTORE, "style-copy", "", [], ["*"], true],
  [465, 18, "layerId", APPLY, "private-count-set", "", [], ["*"], true, "unknown-call-argument"],
  [465, 39, "layerId", APPLY, "private-count-get", "", [], ["*"], true, "unknown-call-argument"],
  [471, 28, "mapLength", APPLY, "private-array-allocation", "mapLength", ["target", "current", "inputLayers", "mapLength"], ["specialZoneLayers", "layers", "length"], false, "unknown-call-argument"],
  [476, 63, "layerId", APPLY, "private-count-get", "", [], ["*"], true, "unknown-call-argument"],
  [476, 109, "layerId", APPLY, "string-own-key-read", "", [], ["*"], true, "unknown-call-argument"],
  [477, 23, "layer", APPLY, "private-array-borrow", "layer", ["target", "current", "inputLayers", "layer"], ["specialZoneLayers", "layers", "*"], true, "assignment-value"],
  [482, 23, "layer", APPLY, "private-array-borrow", "layer", ["target", "current", "inputLayers", "layer"], ["specialZoneLayers", "layers", "*"], true, "assignment-value"],
  [489, 23, "layerId", APPLY, "private-string-result-push", "", [], ["*"], true, "unknown-call-argument"],
  [496, 19, "layer", APPLY, "layer-copy", "layer", ["target", "current", "inputLayers", "layer"], ["specialZoneLayers", "layers", "*"], true],
  [510, 24, "layer.style", APPLY, "style-copy", "layer", ["target", "current", "inputLayers", "layer"], ["specialZoneLayers", "layers", "*", "style"], true],
  [514, 31, "next || layer", APPLY, "layer-copy", "", [], ["*"], true],
  [517, 23, "layer", APPLY, "private-array-borrow", "layer", ["target", "current", "inputLayers", "layer"], ["specialZoneLayers", "layers", "*"], true, "assignment-value"],
  [520, 21, "layerId", APPLY, "private-string-result-push", "", [], ["*"], true, "unknown-call-argument"],
  [524, 37, "current", APPLY, "canonical-borrowed-republication", "current", ["target", "current"], ["specialZoneLayers"], false],
];
const WRITE_SPECS = [
  [524, 5, "target.specialZoneLayers", "specialZoneLayers"],
  [525, 5, "target.specialZonesOverlayDirty", "specialZonesOverlayDirty"],
];

function inspectStructures(ast, source) {
  const text = node => source.slice(node.start, node.end);
  const helper = functionNamed(ast, APPLY);
  if (!helper || helper.params.map(node => node.name).join() !== "target,patchesById,restoreMissing") {
    throw Error("canonical helper binding changed");
  }
  const loops = nodes(helper, node => node.type === "ForStatement");
  if (loops.length !== 2) throw Error("indexed traversal changed");
  for (const [index, loop] of loops.entries()) {
    const input = index === 0 ? "countedLayers" : "inputLayers";
    const length = index === 0 ? "countLength" : "mapLength";
    if (text(loop.test) !== `index < ${length}` || text(loop.update) !== "index += 1"
      || !text(loop.body).includes(`if (!(index in ${input})) continue;`)) throw Error("sparse traversal changed");
    const ids = nodes(loop, node => node.type === "VariableDeclarator" && node.id?.name === "layerId");
    if (ids.length !== 1 || text(ids[0].init) !== "layer ? layer.id : undefined") throw Error("id snapshot changed");
    const guard = index === 0 ? 'typeof layerId === "string" && layerId'
      : 'typeof layerId !== "string" || !layerId || counts.get(layerId) !== 1 || !Object.hasOwn(patchesById, layerId)';
    if (!nodes(loop, node => node.type === "IfStatement" && text(node.test) === guard).length) throw Error("same-binding string guard changed");
  }
  const body = text(helper);
  for (const fragment of ["const counts = new Map();", "const updatedIds = [];", "const layers = new Array(mapLength);",
    "const mapLength = inputLayers.length;", "const patch = patchesById[layerId];",
    "target.specialZoneLayers = { ...current, layers };", "target.specialZonesOverlayDirty = true;", "return updatedIds;"]) {
    if (!body.includes(fragment)) throw Error(`effect boundary changed: ${fragment}`);
  }
  if (nodes(helper, node => node.type === "MemberExpression" && ["map", "forEach"].includes(node.property?.name)
    && ["current", "inputLayers", "countedLayers"].includes(node.object?.name)).length) throw Error("dynamic traversal returned");
  const patch = functionNamed(ast, EXPORTS[0][0]);
  const restore = functionNamed(ast, EXPORTS[1][0]);
  if (!text(patch).includes("return applySpecialZoneLegendFieldsState(target, patchesById, false);")
    || !text(restore).includes('if (typeof snapshotJson !== "string") return [];')
    || !text(restore).includes("snapshotById = JSON.parse(snapshotJson)")
    || !text(restore).includes("return applySpecialZoneLegendFieldsState(target, snapshotById, true);")) throw Error("action call edge changed");
  for (const [name, line, column] of EXPORTS) {
    const fn = functionNamed(ast, name), parameter = fn?.params[0];
    if (parameter?.name !== "target" || fn.body.loc.start.line !== line
      || fn.body.loc.start.column + 1 !== column) throw Error("target export binding changed");
  }
}

function exactExpression(ast, source, scope, line, column, expression) {
  const fn = functionNamed(ast, scope);
  const matches = fn ? nodes(fn, node => node.loc.start.line === line && node.loc.start.column + 1 === column
    && source.slice(node.start, node.end) === expression) : [];
  if (matches.length !== 1) throw Error(`expression boundary changed: ${scope}:${line}:${column}`);
  const node = matches[0];
  return { start: node.start, end: node.end, line, column, endLine: node.loc.end.line,
    endColumn: node.loc.end.column + 1, enclosingFunctionIdentity: identity(scope), sourceFingerprint: hash(expression) };
}

export function inspectStateCsvTargetEffects({ source, readSource = defaultReadSource } = {}) {
  const violations = [];
  try {
    if (typeof source !== "string") throw Error("the actual scanned source is required");
    const current = normalize(source);
    for (const [modulePath, expected] of Object.entries(SOURCE_FINGERPRINTS)) {
      const value = modulePath === CSV_TARGET_ACTION_PATH ? current : normalize(readSource(modulePath));
      if (hash(value) !== expected) violations.push({ code: "csv-target-effect-source-drift", modulePath });
    }
    if (violations.length) return { violations, receipt: null };
    const ast = parse(current, { ecmaVersion: "latest", sourceType: "module", locations: true });
    inspectStructures(ast, current);
    const sites = SITE_SPECS.map(([line, column, expression, scope, effect, alias, aliasChain, pathSegments, dynamic, evidenceKind]) => ({
      ...exactExpression(ast, current, scope, line, column, expression), expression, effect, count: 1,
      root: "target", alias, aliasChain, pathSegments, dynamic, evidenceKind: evidenceKind || null,
      key: pathSegments[0], operation: "unsupported", unsupported: true, reason: "state-alias-escape",
    }));
    const writes = WRITE_SPECS.map(([line, column, expression, key]) => ({
      ...exactExpression(ast, current, APPLY, line, column, expression), expression,
      root: "target", alias: "target", aliasChain: ["target"], pathSegments: [key], dynamic: false,
      evidenceKind: null, key, operation: "assign", unsupported: false, reason: "", count: 1,
    }));
    return { violations, receipt: deepFreeze({
      modulePath: CSV_TARGET_ACTION_PATH, sourceFingerprint: hash(current), sourceFingerprints: { ...SOURCE_FINGERPRINTS },
      bindings: EXPORTS.map(([functionName, line, column]) => ({ functionName, parameterName: "target", parameterIndex: 0,
        parameterPath: "$", kind: "function-parameter", name: "target", locator: { line, column },
        id: `parameter:${functionName}:0:09fc96082d34:${line}:${column}` })),
      sites, writes,
      effects: {
        counts: "Invocation-local Map; only exact set/get with same-binding primitive string keys; never published.",
        layers: "Invocation-local indexed array; preserves holes and borrowed layer references; shallow copies retain unknown metadata references.",
        arrayAllocation: "The intrinsic one-argument Array constructor does not coerce the argument; no receiver map, forEach or species dispatch.",
        publication: "Borrowed records are republished only through target.specialZoneLayers, with the separate canonical dirty-state assignment retained.",
        result: "Invocation-local array of the same guarded string layerId snapshots.",
        reads: "Property getters, Proxy traps and pre-existing property-read/spread effects may invoke user code; this receipt does not make the action pure.",
        restoration: "Primitive JSON text is decoded without a reviver; existing raw presence and unknown-metadata semantics are preserved.",
      },
      borrowedStorage: { layers: ["specialZoneLayers", "layers", "*"], shallowRecords: ["specialZoneLayers", "layers", "*"],
        containerMetadata: ["specialZoneLayers"] },
      detached: false, pure: false,
    }) };
  } catch (error) {
    return { receipt: null, violations: [...violations, { code: "csv-target-effect-proof-invalid", message: error.message }] };
  }
}

const findingIdentity = finding => JSON.stringify([
  finding.root, finding.alias, finding.aliasChain, finding.operation, finding.key, finding.pathSegments,
  finding.dynamic, finding.unsupported, finding.reason, finding.evidenceKind || null,
  finding.start, finding.end, finding.line, finding.column, finding.endLine, finding.endColumn,
  finding.enclosingFunctionIdentity, finding.sourceFingerprint, finding.ambiguous === true,
]);

// Consume a complete proven inventory once. Missing, duplicated, forged or new
// sites leave the original evidence untouched. An already-filtered array is a
// no-op, so the later validation pass can safely apply the same contract again.
export function filterStateCsvTargetEffectFindings({ relativePath, source, binding, findings = [],
  enforceCurrentContracts = true, readSource = defaultReadSource } = {}) {
  if (!enforceCurrentContracts || relativePath !== CSV_TARGET_ACTION_PATH || !Array.isArray(findings)
    || !findings.some(finding => finding.unsupported === true)) return findings;
  const { receipt } = inspectStateCsvTargetEffects({ source, readSource });
  if (!receipt) return findings;
  const expectedBinding = receipt.bindings.find(entry => entry.functionName === binding?.functionName);
  if (!expectedBinding || ["id", "kind", "name", "functionName", "parameterName", "parameterIndex", "parameterPath"]
    .some(key => binding[key] !== expectedBinding[key])
    || (binding.authority !== undefined && binding.authority !== "domain-action")) return findings;
  if (findings.some(finding => finding.filePath !== relativePath || finding.bindingId !== binding.id
    || finding.bindingKind !== "function-parameter")) return findings;
  const expected = [...receipt.sites, ...receipt.writes].map(findingIdentity).sort();
  const actual = findings.map(findingIdentity).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return findings;
  return findings.filter(finding => finding.unsupported !== true);
}
