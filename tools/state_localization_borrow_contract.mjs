import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "acorn";

export const STATE_LOCALIZATION_BORROW_MODULE_PATH = "js/core/scenario_localization_state.js";
const providerPath = "js/core/data_loader.js";
const indexName = "buildScenarioOverrideSourceCityIndex";
const lookupName = "getScenarioOverrideSourceCityFeature";
const coordinatesName = "getFeaturePointCoordinates";
const consumerName = "buildScenarioCityNameSyncPatch";
const sourceFingerprints = Object.freeze({
  [STATE_LOCALIZATION_BORROW_MODULE_PATH]: "99387328d612404da12060cf8b888af73536beabc82d56ed7159b5d636b9bbcc",
  [providerPath]: "1c1ec743924442370da388f32d599dcb172258a84184758093b989bc30bde605",
});
const normalizeSource = source => source.replace(/\r\n?/g, "\n");
const fingerprint = source => createHash("sha256").update(source).digest("hex");
const isFunction = node => ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type);
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

function sourceModel(modulePath, source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const nodes = [];
  const parents = new Map();
  function visit(node, ancestors = []) {
    if (!node || typeof node !== "object" || typeof node.type !== "string") return;
    nodes.push(node);
    parents.set(node, ancestors);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => visit(value, [...ancestors, node]));
      else if (child?.type) visit(child, [...ancestors, node]);
    }
  }
  visit(ast);
  const text = node => source.slice(node.start, node.end);
  const functionIdentity = node => `${modulePath}#${node.id?.name || node.type}@${node.start}:${node.end}:${fingerprint(text(node))}`;
  const lexicalFunctions = node => parents.get(node).filter(isFunction);
  const topName = node => lexicalFunctions(node)[0]?.id?.name || null;
  function describe(node) {
    const scope = lexicalFunctions(node);
    const sourceFingerprint = fingerprint(text(node));
    const lexicalFunctionIdentities = scope.map(functionIdentity);
    return {
      key: `${modulePath}#${lexicalFunctionIdentities.join("/") || "<module>"}::${node.type}@${node.start}:${node.end}:${sourceFingerprint}`,
      modulePath, nodeType: node.type, start: node.start, end: node.end,
      line: node.loc.start.line, column: node.loc.start.column,
      functionName: scope[0]?.id?.name || (isFunction(node) ? node.id?.name : null) || null,
      lexicalFunctionIdentities, source: text(node), sourceFingerprint,
    };
  }
  function one(predicate, label) {
    const matches = nodes.filter(predicate);
    if (matches.length !== 1) throw new Error(`${label}: expected one node, found ${matches.length}`);
    return matches[0];
  }
  const topFunction = name => one(node => node.type === "FunctionDeclaration" && node.id?.name === name
    && lexicalFunctions(node).length === 0, name);
  const binding = (functionName, name) => one(node => node.type === "VariableDeclarator"
    && node.id?.name === name && topName(node) === functionName, `${functionName}.${name}`);
  const expression = (functionName, type, sourceText) => one(node => node.type === type
    && topName(node) === functionName && text(node) === sourceText, sourceText);
  return { ast, nodes, parents, text, describe, one, topFunction, topName, binding, expression, functionIdentity };
}

/**
 * An exact source/effect receipt for the inspected local index and its consumers.
 * All offsets and hashes use LF-normalized source, as state_writer_inventory does.
 * Full source pins close the local consumer graph and bind lexical/global names;
 * even unrelated source edits require reinspection. There is no caller-supplied
 * fingerprint override and no method-name or module-wide purity exemption.
 *
 * Integrators must match module, lexical function identities, AST range AND hash.
 * A storageIdentity identifies an allocation SITE: each index invocation creates
 * a fresh Map. Never classify that Map as detached or as a root state alias.
 * Map entries borrow only ["feature"]; lookup returns borrow the root []. The
 * numeric index is not borrowed. Preserve traversal of arguments, getters,
 * coercion hooks, callbacks and all operations absent from operationsByKey.
 * A rejected receipt is not evidence that the downstream scanner found a write.
 */
export function inspectStateLocalizationBorrowSources({
  source,
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
} = {}) {
  const violations = [];
  const sources = new Map();
  for (const [modulePath, expected] of Object.entries(sourceFingerprints)) {
    try {
      const input = modulePath === STATE_LOCALIZATION_BORROW_MODULE_PATH && source !== undefined ? source : readSource(modulePath);
      if (typeof input !== "string") throw new TypeError("Source must be a string");
      const current = normalizeSource(input);
      sources.set(modulePath, current);
      if (fingerprint(current) !== expected) violations.push({ code: "localization-borrow-source-drift", modulePath });
    } catch (error) {
      violations.push({ code: "localization-borrow-source-unavailable", modulePath, message: error.message });
    }
  }
  if (violations.length) return { violations, receipt: null };

  try {
    const model = sourceModel(STATE_LOCALIZATION_BORROW_MODULE_PATH, sources.get(STATE_LOCALIZATION_BORROW_MODULE_PATH));
    const provider = sourceModel(providerPath, sources.get(providerPath));
    const describe = model.describe;
    const index = model.topFunction(indexName);
    const lookup = model.topFunction(lookupName);
    const coordinates = model.topFunction(coordinatesName);
    const consumer = model.topFunction(consumerName);
    const normalizer = provider.topFunction("normalizeCityText");
    const normalizerImport = model.one(node => node.type === "ImportSpecifier"
      && node.local.name === "normalizeCityText" && node.imported.name === "normalizeCityText"
      && model.parents.get(node).at(-1).source.value === "./data_loader.js", "normalizer import");
    const normalizerExport = provider.one(node => node.type === "ExportSpecifier"
      && node.local.name === "normalizeCityText" && node.exported.name === "normalizeCityText"
      && !provider.parents.get(node).at(-1).source, "normalizer export");
    const stateImport = model.one(node => node.type === "ImportSpecifier" && node.local.name === "runtimeState"
      && node.imported.name === "state" && model.parents.get(node).at(-1).source.value === "./state.js", "state import");
    const matches = model.binding(indexName, "matches");
    if (matches.init.type !== "NewExpression" || matches.init.callee.name !== "Map" || matches.init.arguments.length) {
      throw new Error("matches is not the inspected empty local Map");
    }
    const storageIdentity = `${model.functionIdentity(index)}::matches@${matches.id.start}:${matches.id.end}`;
    const mapResult = () => ({ kind: "private-map-capability", storageIdentity, allocation: "per-index-invocation" });
    const featureOrigin = {
      stateBinding: describe(stateImport), statePath: ["worldCitiesData", "features", "*"],
      expression: describe(model.binding(indexName, "feature").init), retainsOriginalReference: true,
    };
    const featureResult = (nullable = true) => ({
      kind: nullable ? "borrowed-feature-or-null" : "borrowed-feature-value", borrowedResultPaths: [[]], origin: featureOrigin,
    });
    const coordinatesResult = () => ({
      kind: "borrowed-coordinates-or-null", borrowedResultPaths: [[]],
      origin: {
        parameter: describe(coordinates.params[0]), parameterIndex: 0,
        propertyPaths: [["geometry", "coordinates"], ["geometry", "coordinates", "0"]],
        propertyReadsMayInvokeUserCode: true,
      },
    });
    const entryResult = () => ({
      kind: "map-entry-or-nullish", storageIdentity, borrowedResultPaths: [["feature"]],
      scalarResultPaths: [{ path: ["index"], type: "number" }], nullishResults: ["null", "undefined"], origin: featureOrigin,
    });
    const operationsByKey = {};
    function operation(node, kind, result, effects = [], detail = {}) {
      const expression = describe(node);
      if (operationsByKey[expression.key]) throw new Error(`Duplicate operation: ${expression.key}`);
      const receipt = {
        expression, kind, result, effects,
        ...(node.type === "CallExpression" ? { arguments: node.arguments.map(describe), argumentCount: node.arguments.length } : {}),
        ...detail,
      };
      operationsByKey[expression.key] = receipt;
      return receipt;
    }
    operation(matches.init, "private-map-create", mapResult(), [{ kind: "allocate-private-map", storageIdentity }]);
    const mapCalls = model.nodes.filter(node => node.type === "CallExpression" && !node.optional
      && node.callee.type === "MemberExpression" && !node.callee.computed
      && ((model.topName(node) === indexName && node.callee.object.name === "matches")
        || (model.topName(node) === lookupName && node.callee.object.name === "sourceCityIndex")));
    if (mapCalls.length !== 10) throw new Error("Local Map call graph changed");
    for (const call of mapCalls) {
      const method = call.callee.property.name;
      const receiverBinding = call.callee.object.name === "matches" ? matches.id : lookup.params[1];
      const detail = { storageIdentity, receiverBinding: describe(receiverBinding) };
      if (method === "set") {
        const value = call.arguments[1];
        const storesNull = value.type === "Literal" && value.value === null;
        if (!storesNull && (value.type !== "ObjectExpression" || model.text(value) !== "{ feature, index }")) {
          throw new Error("Unexpected Map entry shape");
        }
        operation(call, "private-map-set", mapResult(), [{
          kind: "write-private-map", storageIdentity, valueKind: storesNull ? "null" : "borrowed-feature-record",
          borrowedValuePaths: storesNull ? [] : [["feature"]],
        }], {
          ...detail, value: describe(value),
          ...(storesNull ? {} : {
            retainedFeature: describe(value.properties.find(property => property.key.name === "feature").value),
            numericIndex: describe(value.properties.find(property => property.key.name === "index").value),
          }),
        });
      } else if (method === "get") {
        operation(call, "private-map-get", entryResult(), [{ kind: "read-private-map", storageIdentity }], detail);
      } else if (method === "has") {
        operation(call, "private-map-has", { kind: "scalar", type: "boolean" }, [{ kind: "read-private-map", storageIdentity }], detail);
      } else throw new Error("Unexpected local Map operation");
    }
    operation(model.expression(indexName, "MemberExpression", "matches.size"), "private-map-size",
      { kind: "scalar", type: "number" }, [{ kind: "read-private-map", storageIdentity }], { storageIdentity });

    const normalizerCalls = model.nodes.filter(node => node.type === "CallExpression" && node.callee.name === "normalizeCityText");
    for (const call of normalizerCalls) {
      operation(call, "normalizer-string-result", { kind: "scalar", type: "string", when: "returns-normally" }, [
        { kind: "string-coercion", argumentIndex: 0, mayInvokeUserCode: true, mayThrow: true },
      ], { calleeBinding: describe(normalizerImport), providerFunctionIdentity: provider.functionIdentity(normalizer) });
    }
    const indexCall = model.one(node => node.type === "CallExpression" && node.callee.name === indexName, "index invocation");
    const lookupCall = model.one(node => node.type === "CallExpression" && node.callee.name === lookupName, "lookup invocation");
    if (model.topName(indexCall) !== consumerName || model.topName(lookupCall) !== consumerName) {
      throw new Error("Unexpected helper consumer");
    }
    operation(indexCall, "index-helper-invocation", mapResult(), [{ kind: "invoke-inspected-helper", functionIdentity: model.functionIdentity(index) }]);
    operation(lookupCall, "lookup-helper-invocation", featureResult(), [{ kind: "invoke-inspected-helper", functionIdentity: model.functionIdentity(lookup) }], { storageIdentity });
    const coordinatesCall = model.one(node => node.type === "CallExpression" && node.callee.name === coordinatesName, "coordinates invocation");
    if (model.topName(coordinatesCall) !== "resolveScenarioGeoFeatureIdForCityFeature"
      || coordinatesCall.arguments.length !== 1 || coordinatesCall.arguments[0].name !== "cityFeature") {
      throw new Error("Unexpected coordinate helper consumer");
    }
    operation(coordinatesCall, "coordinates-helper-invocation", coordinatesResult(), [
      { kind: "invoke-inspected-helper", functionIdentity: model.functionIdentity(coordinates) },
      { kind: "property-read", argumentIndex: 0, mayInvokeUserCode: true, mayThrow: true },
    ]);
    operation(model.binding(indexName, "feature").init, "original-feature-read", featureResult(false), [
      { kind: "read-array-element", mayInvokeUserCode: true },
    ]);
    for (const node of model.nodes.filter(node => node.type === "MemberExpression" && model.topName(node) === lookupName
      && ["byId", "byAlias"].includes(node.object.name) && ["feature", "index"].includes(node.property.name))) {
      operation(node, node.property.name === "feature" ? "borrowed-feature-projection" : "numeric-index-projection",
        node.property.name === "feature" ? featureResult(false) : { kind: "scalar", type: "number" }, [], { storageIdentity });
    }

    function bindingReceipt(functionName, name, provenance) {
      const node = model.binding(functionName, name);
      return { name, declaration: describe(node), identifier: describe(node.id),
        declarationKind: model.parents.get(node).at(-1).kind, initializer: node.init ? describe(node.init) : null, provenance };
    }
    const localBindings = [
      bindingReceipt(indexName, "matches", mapResult()),
      bindingReceipt(indexName, "features", { kind: "borrowed-array-or-empty", borrowedResultPaths: [[]], statePath: ["worldCitiesData", "features"] }),
      bindingReceipt(indexName, "feature", featureResult(false)),
      bindingReceipt(indexName, "index", { kind: "scalar", type: "number", initialValue: 0,
        update: describe(model.expression(indexName, "AssignmentExpression", "index += 1")) }),
      bindingReceipt(consumerName, "sourceCityIndex", {
        ...mapResult(), initialValue: "undefined",
        establishedBy: describe(model.expression(consumerName, "AssignmentExpression", "sourceCityIndex ||= buildScenarioOverrideSourceCityIndex(overrideEntries)")),
      }),
      bindingReceipt(lookupName, "byId", entryResult()), bindingReceipt(lookupName, "byAlias", entryResult()),
      bindingReceipt(consumerName, "sourceFeature", featureResult()),
    ];
    const returnResult = (fn, expression) => {
      if (fn === index) return mapResult();
      if (fn === lookup) return featureResult();
      if (expression?.type === "Literal" && expression.value === null) return { kind: "scalar", type: "null" };
      if (!["geometry.coordinates", "geometry.coordinates[0]"].includes(model.text(expression))) {
        throw new Error("Unexpected coordinate return projection");
      }
      return coordinatesResult();
    };
    const returns = fn => model.nodes.filter(node => node.type === "ReturnStatement" && model.topName(node) === fn.id.name)
      .map(node => ({ statement: describe(node), expression: describe(node.argument), result: returnResult(fn, node.argument) }));
    const functions = Object.fromEntries([index, lookup, coordinates].map(fn => [fn.id.name, {
      declaration: describe(fn), functionIdentity: model.functionIdentity(fn),
      parameters: fn.params.map(describe), returns: returns(fn),
      returnProvenance: fn === index ? mapResult() : fn === lookup ? featureResult() : coordinatesResult(),
    }]));
    const statePath = node => {
      if (node?.type === "Identifier" && node.name === "runtimeState") return [];
      if (node?.type !== "MemberExpression" || node.computed) return null;
      const parent = statePath(node.object);
      return parent && [...parent, node.property.name];
    };
    const unhandledStateEffects = model.nodes.filter(node => node.type === "AssignmentExpression" && statePath(node.left))
      .map(node => ({ expression: describe(node), kind: "state-write", statePath: statePath(node.left) }));
    const actionCall = model.one(node => node.type === "CallExpression"
      && node.callee.name === "applyScenarioChunkCityExternalEffectState", "external state action");
    unhandledStateEffects.push({ expression: describe(actionCall), kind: "delegated-state-action", targetArgumentIndex: 0 });

    return { violations, receipt: freeze({
      schemaVersion: 1, modulePath: STATE_LOCALIZATION_BORROW_MODULE_PATH,
      sourceFingerprint: sourceFingerprints[STATE_LOCALIZATION_BORROW_MODULE_PATH],
      coordinateSystem: "LF-normalized-UTF16", sourceFingerprints: { ...sourceFingerprints },
      functions, localBindings, operationsByKey,
      storage: {
        storageIdentity, binding: describe(matches.id), origin: describe(matches.init),
        allocation: "per-index-invocation", keyType: "string", entry: entryResult(),
        lookupParameter: { binding: describe(lookup.params[1]), argumentIndex: 1, storageIdentity },
      },
      normalizer: {
        importBinding: describe(normalizerImport), providerModulePath: providerPath,
        providerSourceFingerprint: sourceFingerprints[providerPath], exportBinding: provider.describe(normalizerExport),
        declaration: provider.describe(normalizer), functionIdentity: provider.functionIdentity(normalizer),
        resultType: "string", resultCondition: "returns-normally", intrinsic: "String",
        calls: normalizerCalls.map(describe), mayInvokeArgumentCoercion: true,
      },
      consumerGraph: {
        consumer: describe(consumer), closedBySourceFingerprint: sourceFingerprints[STATE_LOCALIZATION_BORROW_MODULE_PATH],
        indexCall: describe(indexCall), lookupCall: describe(lookupCall),
        publication: describe(model.expression(consumerName, "AssignmentExpression", "sourceCityIndex ||= buildScenarioOverrideSourceCityIndex(overrideEntries)")),
        publicationBinding: describe(model.binding(consumerName, "sourceCityIndex").id),
        lookupArgument: describe(lookupCall.arguments[1]), lookupParameter: describe(lookup.params[1]),
        coordinatesCall: describe(coordinatesCall), coordinatesArgument: describe(coordinatesCall.arguments[0]),
        coordinatesParameter: describe(coordinates.params[0]),
      },
      unhandledStateEffects,
      requiredRemainingAnalysis: { arguments: true, propertyGetters: true, coercionHooks: true, nestedCallbacks: true, unlistedOperations: true },
    }) };
  } catch (error) {
    return { violations: [{ code: "localization-borrow-shape-mismatch", message: error.message }], receipt: null };
  }
}
