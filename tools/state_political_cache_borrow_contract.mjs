import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { parse } from "acorn";
import { fullAncestor } from "acorn-walk";

export const POLITICAL_CACHE_RENDERER_PATH = "js/core/map_renderer.js";
export const POLITICAL_DERIVED_CACHE_PATH = "js/core/renderer/political_derived_state_cache.js";
export const POLITICAL_RASTER_CACHE_PATH = "js/core/renderer/political_id_raster_cache.js";
const ownerPath = "js/core/renderer/political_id_raster_runtime_owner.js";
const geometryPath = "js/core/political_geometry_store.js";
const collectionOwnerPath = "js/core/renderer/political_collection_owner.js";
const chunkPayloadsPath = "js/core/scenario/chunk_layer_payloads.js";
const fingerprints = Object.freeze({
  [POLITICAL_CACHE_RENDERER_PATH]: "f8a43c8a280d0e63cfbfeb010747181713534ac3a6230a7a0f806d671e6a4855",
  [POLITICAL_DERIVED_CACHE_PATH]: "842e22e35319d6df0bf8c82de98929c43ea7a0ff9f3d97ca6fbf22adc9ce0825",
  [POLITICAL_RASTER_CACHE_PATH]: "86b8bb72701594454238f012f7ca6dee86890cef46f131b33428f9f6f1101569",
  [ownerPath]: "9cfbc65be28984a80dd30999d2febf7abcb84d0998901d6e4b9cfb5daeb41f50",
  [geometryPath]: "2a717b1d433329a38f6ea29e793e2c93649f7b75d95fedcc9c9fd823334219e4",
  [collectionOwnerPath]: "339ee012af48aa0304fcb9b7fc8cbea02dfc8fccf11088d14687778603231368",
  [chunkPayloadsPath]: "8b2d728b4ad8b02fc48adb54f01b58ab1a00374719e0be2f1c91467434097dd8",
  "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
  "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
  "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
  "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
  "js/core/country_code_aliases.js": "460311cf93c7ffc8004cabbee374a8a76c12fd37c3ab82524d527e7b919c2f67",
});
// These existing computed-import providers have inspected finite targets that
// exclude the geometry sidecar. Any change or new computed importer rejects the
// closed consumer graph; a cached file list is never accepted as live authority.
const finiteImportProviders = Object.freeze({
  "js/bootstrap/deferred_ui_bootstrap.js": "090b0648dbafa5641d31fe84ff8f401729c0abb72fa0179499782ef0895dee3c",
  "js/core/data_service.js": "fdd0a319afb2a141fcbfeb21f83b4991406eac0c5e5a23a53faf8dadd52bdce1",
});
const geometryConsumerImports = Object.freeze({
  [POLITICAL_CACHE_RENDERER_PATH]: ["getPoliticalGeometrySnapshot", "registerPoliticalGeometrySnapshot"],
  [POLITICAL_DERIVED_CACHE_PATH]: ["getPoliticalGeometrySnapshot"],
  [collectionOwnerPath]: ["getPoliticalGeometrySnapshot", "registerPoliticalGeometrySnapshot"],
  [chunkPayloadsPath]: ["createPoliticalGeometryStore", "getPoliticalGeometrySnapshot"],
});
const normalize = source => String(source).replace(/\r\n?/g, "\n");
const hash = source => createHash("sha256").update(normalize(source)).digest("hex");
const parseModule = source => parse(source, { ecmaVersion: "latest", sourceType: "module" });
const functionNode = (ast, name) => ast.body.map(node => node.declaration || node)
  .find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
const freeze = value => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

function productionSourcePaths(directory = "js") {
  return readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? productionSourcePaths(`${directory}/${entry.name}`)
      : /\.(?:m?js)$/i.test(entry.name) ? [`${directory}/${entry.name}`] : []);
}

function inspectGeometryConsumers(read, sourcePaths, violations) {
  const consumers = [];
  for (const file of sourcePaths) {
    const source = read(file);
    if (Object.hasOwn(finiteImportProviders, file)) continue;
    // Parse the specifier value rather than searching for the module's name;
    // escaped strings, renamed bindings and re-exports must not evade this gate.
    if (!/\b(?:import|export)\b/.test(source)) continue;
    fullAncestor(parseModule(source), node => {
      const specifier = node.type === "ImportExpression" ? node.source
        : ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) ? node.source : null;
      if (!specifier) return;
      const value = specifier.type === "Literal" ? specifier.value : null;
      const decodedPath = typeof value === "string" ? decodeURIComponent(value.split(/[?#]/, 1)[0]) : "";
      const target = decodedPath.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(file), decodedPath))
        : decodedPath.startsWith("/") ? decodedPath.slice(1) : "";
      if (target.toLowerCase() === geometryPath) {
        const expected = geometryConsumerImports[file];
        if (node.type !== "ImportDeclaration" || !expected || node.specifiers.length !== expected.length
          || node.specifiers.some(item => item.type !== "ImportSpecifier" || item.local?.name !== item.imported?.name)
          || JSON.stringify(node.specifiers.map(item => item.imported?.name).sort()) !== JSON.stringify([...(expected || [])].sort())) {
          violations.push({ code: "political-cache-geometry-consumer-unproved", modulePath: file });
        }
        consumers.push({ modulePath: file, target, start: node.start, end: node.end, sourceFingerprint: hash(source.slice(node.start, node.end)) });
      } else if (node.type === "ImportExpression" && value === null) {
        violations.push({ code: "political-cache-dynamic-consumer-unresolved", modulePath: file });
      } else if (/political_geometry_store/i.test(decodedPath)) {
        violations.push({ code: "political-cache-geometry-consumer-path-unresolved", modulePath: file });
      }
    });
  }
  if (JSON.stringify(consumers.map(entry => entry.modulePath).sort()) !== JSON.stringify(Object.keys(geometryConsumerImports).sort())) {
    violations.push({ code: "political-cache-geometry-consumer-set-drift" });
  }
  // The store allocates numeric revisions; the two forwarding producers spread
  // inspected snapshots into fresh object literals. Every sidecar reader is
  // pinned above, so revision remains a data field. Other fields still borrow.
  const producers = [];
  for (const file of [geometryPath, POLITICAL_CACHE_RENDERER_PATH, collectionOwnerPath]) {
    const source = read(file);
    fullAncestor(parseModule(source), node => {
      if (node.type !== "CallExpression" || node.callee.name !== "registerPoliticalGeometrySnapshot") return;
      if (node.arguments.length !== 2 || node.arguments[1].type !== "ObjectExpression") {
        violations.push({ code: "political-cache-geometry-producer-shape-drift", modulePath: file });
      }
      producers.push({ modulePath: file, start: node.start, end: node.end,
        sourceFingerprint: hash(source.slice(node.start, node.end)), revisionKind: file === geometryPath ? "allocated-number" : "forwarded-data-property" });
    });
  }
  if (producers.length !== 3) violations.push({ code: "political-cache-geometry-producer-set-drift" });
  return { consumers, producers, revisionReadsInvokeGetter: false, otherSnapshotFieldsMayBeBorrowed: true };
}

// Effects and result ownership are distinct. The private feature Map get is
// admitted only with its complete allocation/use proof below. Its result and
// every lookup-helper result still borrow the original feature. Commit/describe
// retain their diagnostics because input hooks and shared effects remain open.
export const POLITICAL_CACHE_METHOD_EFFECTS = freeze({
  raster: {
    get: { argumentCount: 1, privateMutation: ["LRU.delete", "LRU.set"], retainedArguments: [], borrowedResultPaths: [[]] },
    peek: { argumentCount: 1, privateMutation: [], retainedArguments: [], borrowedResultPaths: [[]] },
    set: { argumentCount: 3, privateMutation: ["LRU", "cpuBytes", "evictions"], retainedArguments: [{ index: 1, paths: [[]] }, { index: 2, paths: [["*"]] }], borrowedResultPaths: [] },
    entries: { argumentCount: 0, privateMutation: [], retainedArguments: [], borrowedResultPaths: [["*", "1"]] },
  },
  derived: {
    commit: { argumentCount: 1, privateMutation: ["baseline"], retainedArguments: [{ index: 0, paths: [["collection"], ["colors"], ["colorRevision"], ["identity", "*"]] }], borrowedResultPaths: [], result: "undefined",
      callbackEffects: ["getFeatureId(feature): input getters/coercion remain unproved"], admitCall: false },
    refreshColors: { argumentCount: 1, privateMutation: ["baseline.colors", "baseline.colorRevision"], retainedArguments: [{ index: 0, paths: [["colors"], ["colorRevision"]] }], borrowedResultPaths: [], result: "boolean", admitCall: true },
    reset: { argumentCount: 0, privateMutation: ["baseline"], retainedArguments: [], borrowedResultPaths: [], result: "undefined", admitCall: true },
    describe: { argumentCount: 1, privateMutation: [], retainedArguments: [], borrowedResultPaths: [["features"]],
      resultStorage: { path: ["features"], kind: "Map", valueBorrowedPaths: [[]] },
      sharedEffects: ["onMiss -> recordRenderPerfMetric -> renderer diagnostics actions"], admitCall: false },
  },
  featureIndex: { get: { argumentCount: 1, privateMutation: [], borrowedResultPaths: [[]], admitCall: true } },
});

function inspectFeatureLookup(renderer, ast, operationsByKey, violations) {
  const functionName = "findResolvedColorFeatureById";
  const cacheName = "resolvedColorFeatureLookupCache";
  const lookup = functionNode(ast, functionName);
  const site = node => ({ start: node.start, end: node.end,
    sourceFingerprint: hash(renderer.slice(node.start, node.end)) });
  if (!lookup) return null;
  const localIndex = [];
  const storageUses = [];
  const consumers = [];
  const returns = [];
  let allocation;
  fullAncestor(ast, (node, _state, ancestors) => {
    const parent = ancestors.at(-2);
    const owner = [...ancestors].reverse().find(entry => entry.type === "FunctionDeclaration");
    if (owner === lookup && node.type === "VariableDeclarator" && node.id.name === "index") {
      if (node.init?.type !== "NewExpression" || node.init.callee.name !== "Map" || node.init.arguments.length) {
        violations.push({ code: "political-cache-feature-index-allocation-drift" });
      } else allocation = { ...site(node.init), declaration: site(node), bindingName: "index" };
    }
    if (owner === lookup && node.type === "Identifier" && node.name === "index") {
      if (parent?.type === "VariableDeclarator" && parent.id === node) return;
      const call = ancestors.at(-3);
      if (parent?.type === "MemberExpression" && parent.object === node && !parent.computed
        && call?.type === "CallExpression" && call.callee === parent
        && ["has", "set"].includes(parent.property.name)) {
        localIndex.push({ ...site(call), method: parent.property.name });
      } else if (parent?.type !== "Property" || !parent.shorthand || parent.key.name !== "index") {
        violations.push({ code: "political-cache-feature-index-published" });
      }
    }
    if (node.type === "Identifier" && node.name === cacheName) {
      if (parent?.type === "VariableDeclarator" && parent.id === node) return;
      if (owner !== lookup) {
        violations.push({ code: "political-cache-feature-storage-consumer-drift" }); return;
      }
      if (parent?.type === "AssignmentExpression" && parent.left === node && parent.operator === "="
        && parent.right.type === "ObjectExpression"
        && parent.right.properties.map(item => item.shorthand && item.key.name).join(",") === "features,revision,index") {
        storageUses.push({ ...site(parent), kind: "private-storage-replacement" }); return;
      }
      const enclosing = ancestors.at(-3);
      if (parent?.type !== "MemberExpression" || parent.object !== node || parent.computed) {
        violations.push({ code: "political-cache-feature-storage-published" }); return;
      }
      if (["features", "revision"].includes(parent.property.name) && enclosing?.type === "BinaryExpression"
        && enclosing.operator === "!==" && enclosing.left === parent) {
        storageUses.push({ ...site(parent), kind: "identity-comparison" }); return;
      }
      const call = ancestors.at(-4);
      if (parent.property.name === "index" && enclosing?.type === "MemberExpression" && !enclosing.computed
        && enclosing.object === parent && enclosing.property.name === "get" && call?.type === "CallExpression"
        && call.callee === enclosing && !call.optional && call.arguments.length === 1
        && call.arguments[0].type === "Identifier" && call.arguments[0].name === "id") {
        const operation = { ...POLITICAL_CACHE_METHOD_EFFECTS.featureIndex.get, ...site(call),
          modulePath: POLITICAL_CACHE_RENDERER_PATH, functionName, method: "get", kind: "feature-index-get",
          borrowedArgumentIndexes: [], storageIdentity: `${POLITICAL_CACHE_RENDERER_PATH}/${functionName}/index` };
        operationsByKey[`${call.start}:${call.end}`] = operation;
        storageUses.push({ ...site(call), kind: operation.kind });
      } else violations.push({ code: "political-cache-feature-storage-use-drift" });
    }
    if (node.type === "Identifier" && node.name === functionName) {
      if (parent === lookup && lookup.id === node) return;
      if (parent?.type !== "CallExpression" || parent.callee !== node || parent.optional
        || parent.arguments.length !== 1 || parent.arguments[0].type === "SpreadElement") {
        violations.push({ code: "political-cache-feature-helper-published" }); return;
      }
      const operation = { ...site(parent), modulePath: POLITICAL_CACHE_RENDERER_PATH,
        functionName: owner?.id?.name, kind: "feature-lookup-helper", method: functionName,
        argumentCount: 1, borrowedArgumentIndexes: [], borrowedResultPaths: [[]], admitCall: false,
        inputEffects: ["String(featureId): coercion may invoke user code or throw"],
        nestedEffects: ["state landIndex.get provider", "feature identity getters/coercion", "private index replacement"] };
      consumers.push(operation);
      operationsByKey[`${parent.start}:${parent.end}`] = operation;
    }
    if (owner === lookup && node.type === "ReturnStatement") returns.push({ ...site(node.argument),
      borrowedResultPaths: node.argument.type === "Literal" && node.argument.value === null ? [] : [[]] });
  });
  if (!allocation || localIndex.map(entry => entry.method).sort().join(",") !== "has,set"
    || storageUses.length !== 4 || consumers.length !== 4 || returns.length !== 3) {
    violations.push({ code: "political-cache-feature-lookup-graph-drift" });
  }
  return { functionName, ...site(lookup), borrowedResultPaths: [[]], admitCall: false,
    allocation, localIndex, storageUses, consumers, returns,
    storageIdentity: `${POLITICAL_CACHE_RENDERER_PATH}/${functionName}/index`,
    inputFeatureOrigin: "getResolvedColorSourceFeatures() retains original state collection features",
    lookupResultOrigin: "runtimeState.landIndex or the private Map value; neither is detached" };
}

// The scanner may consume a result proof without accepting the call's effects.
// Keep the source state binding exact: these roots do not describe unrelated
// function-parameter scans, even when the expression happens to be identical.
export function resolvePoliticalCacheOperation(receipt, node, { filePath, binding } = {}) {
  if (!receipt || filePath !== POLITICAL_CACHE_RENDERER_PATH || node?.type !== "CallExpression") return null;
  const operation = receipt.operationsByKey[`${node.start}:${node.end}`];
  if (!operation) return null;
  if (operation.borrowedResultPaths.length && !(binding?.kind === "module" && binding.name === "runtimeState"
    && binding.importSource === "./state.js" && binding.importedName === "state")) return null;
  return operation;
}

export function inspectStatePoliticalCacheBorrowSources({
  source,
  readSource = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
  sourcePaths,
} = {}) {
  const violations = [];
  const sources = new Map();
  const read = file => {
    if (!sources.has(file)) sources.set(file, normalize(file === POLITICAL_CACHE_RENDERER_PATH && source !== undefined ? source : readSource(file)));
    return sources.get(file);
  };
  try {
    for (const [file, expected] of Object.entries({ ...fingerprints, ...finiteImportProviders })) {
      if (hash(read(file)) !== expected) violations.push({ code: "political-cache-source-drift", modulePath: file });
    }
    if (violations.length) return { violations, receipt: null };
    const geometrySnapshots = inspectGeometryConsumers(read, sourcePaths || productionSourcePaths(), violations);
    if (violations.length) return { violations, receipt: null };
    const renderer = read(POLITICAL_CACHE_RENDERER_PATH);
    const ast = parseModule(renderer);
    const declarations = ast.body.map(node => node.declaration || node);
    const declaration = declarations.filter(node => node.type === "VariableDeclaration")
      .flatMap(node => node.declarations).find(node => node.id?.name === "politicalDerivedStateCache");
    const factoryCall = declaration?.init;
    const properties = factoryCall?.arguments[0]?.properties;
    const onMiss = properties?.find(node => node.key?.name === "onMiss")?.value;
    if (factoryCall?.callee?.name !== "createPoliticalDerivedStateCache" || factoryCall.arguments.length !== 1
      || properties?.length !== 2 || !properties.some(node => node.shorthand && node.key?.name === "getFeatureId")
      || onMiss?.type !== "ArrowFunctionExpression" || onMiss.body?.callee?.name !== "recordRenderPerfMetric") {
      return { violations: [{ code: "political-cache-composition-drift" }], receipt: null };
    }
    const operationsByKey = {};
    const uses = [];
    fullAncestor(ast, (node, _state, ancestors) => {
      if (node.type !== "Identifier" || node.name !== "politicalDerivedStateCache") return;
      const parent = ancestors.at(-2);
      const call = ancestors.at(-3);
      if (parent?.type === "VariableDeclarator" && parent === declaration) return;
      if (parent?.type !== "MemberExpression" || parent.object !== node || parent.computed
        || call?.type !== "CallExpression" || call.callee !== parent || call.optional
        || call.arguments.some(argument => argument.type === "SpreadElement")) {
        violations.push({ code: "political-cache-capability-published" }); return;
      }
      const method = parent.property.name;
      const effects = POLITICAL_CACHE_METHOD_EFFECTS.derived[method];
      if (!effects || effects.argumentCount !== call.arguments.length) {
        violations.push({ code: "political-cache-method-drift", method }); return;
      }
      const owner = [...ancestors].reverse().find(entry => entry.type === "FunctionDeclaration");
      uses.push(method);
      operationsByKey[`${call.start}:${call.end}`] = {
        ...effects, modulePath: POLITICAL_CACHE_RENDERER_PATH, method,
        functionName: owner?.id?.name, start: call.start, end: call.end,
        sourceFingerprint: hash(renderer.slice(call.start, call.end)),
        borrowedArgumentIndexes: call.arguments.map((_, index) => index),
        // The complete factory and all private capability uses are pinned.
        // Nested argument calls are still independently visited by the scanner.
        storageIdentity: "politicalDerivedStateCache/baseline",
      };
    });
    if (uses.sort().join(",") !== "commit,describe,refreshColors,refreshColors,reset") {
      violations.push({ code: "political-cache-consumer-set-drift" });
    }
    const derivedFactory = functionNode(parseModule(read(POLITICAL_DERIVED_CACHE_PATH)), "createPoliticalDerivedStateCache");
    const rasterFactory = functionNode(parseModule(read(POLITICAL_RASTER_CACHE_PATH)), "createPoliticalIdRasterCache");
    const featureLookup = inspectFeatureLookup(renderer, ast, operationsByKey, violations);
    if (!derivedFactory || !rasterFactory || !featureLookup) violations.push({ code: "political-cache-factory-missing" });
    if (violations.length) return { violations, receipt: null };
    return { violations, receipt: freeze({
      modulePath: POLITICAL_CACHE_RENDERER_PATH, sourceFingerprint: fingerprints[POLITICAL_CACHE_RENDERER_PATH],
      dependencies: { ...fingerprints, ...finiteImportProviders }, operationsByKey, geometrySnapshots,
      methods: POLITICAL_CACHE_METHOD_EFFECTS,
      factories: [
        { modulePath: POLITICAL_DERIVED_CACHE_PATH, sourceFingerprint: hash(read(POLITICAL_DERIVED_CACHE_PATH).slice(derivedFactory.start, derivedFactory.end)) },
        { modulePath: POLITICAL_RASTER_CACHE_PATH, sourceFingerprint: hash(read(POLITICAL_RASTER_CACHE_PATH).slice(rasterFactory.start, rasterFactory.end)) },
      ],
      featureLookup,
      diagnosticEffect: { provider: "recordRenderPerfMetric", factory: "createRenderPerfMetricsRuntimeOwner",
        actions: ["ensureRenderPerfMetricsState", "commitRenderPerfMetricState"], mirror: "mirrorRenderPerfMetricSnapshot" },
      unadmittedBorrowedConsumers: ["derived.commit", "derived.describe", "raster.get", "raster.peek", "raster.entries", "findResolvedColorFeatureById"],
    }) };
  } catch (error) {
    return { violations: [{ code: "political-cache-proof-unavailable", message: error.message }], receipt: null };
  }
}
