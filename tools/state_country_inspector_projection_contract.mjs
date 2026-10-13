import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "acorn";

export const STATE_COUNTRY_INSPECTOR_PROJECTION_MODULE_PATH = "js/ui/sidebar/country_inspector_model.js";
const MODULE_PATH = STATE_COUNTRY_INSPECTOR_PROJECTION_MODULE_PATH;
const ALIASES_PATH = "js/core/country_code_aliases.js";
const FACTORY_NAME = "createCountryInspectorModel";
const MODULE_HASH = "c480f2ef2b761bd19335c0b5db5420b7316629a75b6135baa2f14307d843d05b";
const FACTORY_HASH = "e9f25b842fcdff0ca0a135fcd84265c04cfd0d36ef1fd3dc3c797d443d1ed214";
const ALIASES_HASH = "460311cf93c7ffc8004cabbee374a8a76c12fd37c3ab82524d527e7b919c2f67";
const HELPERS = Object.freeze({
  primitiveText: { hash: "15fb8c4244ba33aa9e01c445c6903cb08ec919475df312b83663fa2d31d79b4d", calls: 6, kind: "scalar" },
  normalizeCountryCode: { hash: "e4f08fb3ae7c736d507e0b3d01fd7ce37bf1b194602a421f9f402f43f2181755", calls: 35, kind: "scalar" },
  readExplicitInspectorGroupMeta: { hash: "208d889696841781455592210a0f510498932b39e37e0d2bfed4b98225b3ba04", calls: 2, kind: "private-string-record" },
  collectScenarioInspectorIso2Codes: { hash: "19d70c274aa0b56c652b2bdf252b2c11158997f0672f93d08b3281624409e9df", calls: 1, kind: "private-string-set" },
});
const issuedReceipts = new WeakSet();
const issuedSources = new WeakMap();
const normalize = source => source.replace(/\r\n?/g, "\n");
const hash = source => createHash("sha256").update(source).digest("hex");
const readDefault = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const isFunction = node => ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node?.type);
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function syntaxShape(value) {
  if (Array.isArray(value)) return value.map(syntaxShape);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).filter(key => !["start", "end", "loc", "raw"].includes(key))
    .sort().map(key => [key, syntaxShape(value[key])]));
}
const syntaxHash = node => hash(JSON.stringify(syntaxShape(node)));

function sourceModel(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const nodes = [], ancestors = new Map(), visited = new Set();
  const visit = (node, parents) => {
    if (!node || typeof node !== "object" || !node.type || visited.has(node)) return;
    visited.add(node); nodes.push(node); ancestors.set(node, parents);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => visit(value, [...parents, node]));
      else if (child?.type) visit(child, [...parents, node]);
    }
  };
  visit(ast, []);
  const text = node => source.slice(node.start, node.end);
  const functionIdentity = node => `${MODULE_PATH}#${node.id?.name || node.type}@${node.start}:${node.end}:${hash(text(node))}`;
  const describe = node => ({ nodeType: node.type, start: node.start, end: node.end, line: node.loc.start.line,
    column: node.loc.start.column + 1, source: text(node), sourceFingerprint: hash(text(node)), syntaxFingerprint: syntaxHash(node),
    lexicalFunctionIdentities: ancestors.get(node).filter(isFunction).map(functionIdentity) });
  const factories = ast.body.map(node => node.declaration || node)
    .filter(node => node.type === "FunctionDeclaration" && node.id?.name === FACTORY_NAME);
  if (factories.length !== 1) throw Error("factory declaration must be unique");
  const factory = factories[0];
  if (factory.params.map(node => node.name).join() !== "runtimeState,t") throw Error("factory parameters changed");
  return { ast, nodes, ancestors, text, describe, factory, functionIdentity };
}

function validateAliases(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const declaration = ast.body.flatMap(node => node.declarations || []).find(node => node.id?.name === "COUNTRY_CODE_ALIASES");
  const init = declaration?.init;
  if (init?.type !== "CallExpression" || init.callee?.object?.name !== "Object" || init.callee?.property?.name !== "freeze"
    || init.arguments.length !== 1 || init.arguments[0].type !== "ObjectExpression") throw Error("alias allocation changed");
  const entries = init.arguments[0].properties.map(node => [node.key.name, node.value.value]);
  if (JSON.stringify(entries) !== JSON.stringify([["UK", "GB"], ["EL", "GR"]])) throw Error("own string aliases changed");
}

/**
 * A source-bound call/result proof, not permission to skip argument evaluation,
 * property reads, Proxy/getter effects, nested calls or helper-body analysis.
 * Only these four local projections are covered. Neither metadata reader return
 * is authorized here. The exact factory slice is supported for the existing
 * pure-reader validator, with offsets rebased by parsing that actual scan source.
 */
export function inspectStateCountryInspectorProjectionSources({ source, readSource = readDefault } = {}) {
  const violations = [];
  try {
    if (typeof source !== "string") throw Error("the actual scanned source is required");
    const current = normalize(source), currentHash = hash(current);
    const fullSource = currentHash === MODULE_HASH ? current : normalize(readSource(MODULE_PATH));
    if (hash(fullSource) !== MODULE_HASH) violations.push({ code: "country-inspector-projection-source-drift", modulePath: MODULE_PATH });
    const aliases = normalize(readSource(ALIASES_PATH));
    if (hash(aliases) !== ALIASES_HASH) violations.push({ code: "country-inspector-projection-source-drift", modulePath: ALIASES_PATH });
    if (violations.length) return { violations, receipt: null };
    const complete = sourceModel(fullSource);
    const factorySource = complete.text(complete.factory);
    if (hash(factorySource) !== FACTORY_HASH || (current !== fullSource && current !== factorySource)) {
      return { violations: [{ code: "country-inspector-projection-scan-source-drift", modulePath: MODULE_PATH }], receipt: null };
    }
    const imports = complete.ast.body.filter(node => node.type === "ImportDeclaration");
    if (imports.length !== 1 || imports[0].source.value !== "../../core/country_code_aliases.js"
      || imports[0].specifiers.length !== 1 || imports[0].specifiers[0].imported?.name !== "COUNTRY_CODE_ALIASES"
      || imports[0].specifiers[0].local?.name !== "COUNTRY_CODE_ALIASES") throw Error("alias import binding changed");
    validateAliases(aliases);
    const model = current === fullSource ? complete : sourceModel(current);
    const helpers = {}, operationsByKey = {};
    for (const [name, expected] of Object.entries(HELPERS)) {
      const declarations = model.factory.body.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === name);
      if (declarations.length !== 1 || hash(model.text(declarations[0])) !== expected.hash) throw Error(`helper declaration changed: ${name}`);
      const declaration = declarations[0];
      helpers[name] = { declaration: model.describe(declaration), lexicalIdentity: model.functionIdentity(declaration),
        result: expected.kind === "scalar" ? { kind: "scalar", type: "string", borrowedResultPaths: [] }
          : expected.kind === "private-string-record" ? { kind: expected.kind, fields: { id: "string", label: "string", anchorId: "string" }, borrowedResultPaths: [], allocation: "per-invocation" }
            : { kind: expected.kind, elementType: "string", borrowedResultPaths: [], allocation: "per-invocation" } };
      const calls = model.nodes.filter(node => node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === name);
      if (calls.length !== expected.calls) throw Error(`helper call graph changed: ${name}`);
      for (const call of calls) {
        if (call.optional || call.arguments.some(node => node.type === "SpreadElement")
          || call.arguments.length !== (name === "collectScenarioInspectorIso2Codes" ? 2 : 1)
          || model.ancestors.get(call).filter(isFunction)[0] !== model.factory) throw Error(`helper call binding changed: ${name}`);
        const expression = model.describe(call), key = `${call.start}:${call.end}`;
        if (operationsByKey[key]) throw Error("duplicate helper call expression");
        operationsByKey[key] = { helperName: name, expression, helper: helpers[name].declaration,
          helperLexicalIdentity: helpers[name].lexicalIdentity, arguments: call.arguments.map(model.describe),
          borrowedArgumentIndexes: call.arguments.map((_, index) => index), result: helpers[name].result,
          effectsPreserved: true, effects: { argumentEvaluationRequired: true, nestedEffectsRequired: true,
            directParameterWrites: false, parameterPublication: false,
            propertyReadsMayInvokeUserCode: name === "readExplicitInspectorGroupMeta" || name === "collectScenarioInspectorIso2Codes",
            primitiveCoercionOnly: name === "primitiveText" || name === "normalizeCountryCode" } };
      }
    }
    const receipt = freeze({ modulePath: MODULE_PATH, sourceFingerprint: currentHash, moduleSourceFingerprint: MODULE_HASH,
      sourceView: current === fullSource ? "module" : "factory-slice", factory: model.describe(model.factory),
      dependencyFingerprints: { [ALIASES_PATH]: ALIASES_HASH }, helpers, operationsByKey,
      unhandledBorrowedReturns: ["getScenarioCountryMeta", "getCountryGroupingMeta"],
      effectBoundary: "Argument/property evaluation, getters, Proxy traps and nested effects remain analyzed; no whole-model purity or metadata detachment is granted." });
    issuedReceipts.add(receipt); issuedSources.set(receipt, current);
    return { violations, receipt };
  } catch (error) {
    return { violations: [...violations, { code: "country-inspector-projection-proof-unavailable", message: error.message }], receipt: null };
  }
}

export function resolveStateCountryInspectorProjectionCall(receipt, callNode, helperNode, { source, filePath } = {}) {
  if (!issuedReceipts.has(receipt) || filePath !== MODULE_PATH || typeof source !== "string"
    || normalize(source) !== issuedSources.get(receipt) || callNode?.type !== "CallExpression"
    || helperNode?.type !== "FunctionDeclaration") return null;
  const operation = receipt.operationsByKey[`${callNode.start}:${callNode.end}`];
  if (!operation || callNode.callee?.type !== "Identifier" || callNode.callee.name !== operation.helperName
    || helperNode.id?.name !== operation.helperName || helperNode.start !== operation.helper.start || helperNode.end !== operation.helper.end) return null;
  try {
    const current = issuedSources.get(receipt);
    if (hash(current.slice(callNode.start, callNode.end)) !== operation.expression.sourceFingerprint
      || hash(current.slice(helperNode.start, helperNode.end)) !== operation.helper.sourceFingerprint
      || syntaxHash(callNode) !== operation.expression.syntaxFingerprint
      || syntaxHash(helperNode) !== operation.helper.syntaxFingerprint) return null;
    return operation;
  } catch { return null; }
}
