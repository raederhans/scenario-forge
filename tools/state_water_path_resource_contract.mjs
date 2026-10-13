import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { parse } from "acorn";
import { fullAncestor } from "acorn-walk";

export const WATER_PATH_RESOURCE_MODULE_PATH = "js/core/renderer/scenario_region_overlay_render_owner.js";
export const WATER_PATH_RESOURCE_FACTORY_NAME = "createScenarioRegionOverlayRenderOwner";
const rendererPath = "js/core/map_renderer.js";
const projectionPath = "js/core/renderer/renderer_projection_path_owner.js";
const surfacePath = "js/core/renderer/renderer_surface_host.js";
const cachePath = "js/core/renderer/geometry_cache_budget.js";
const navigationPath = "js/core/renderer/navigation_scene_owner.js";
const factoryFingerprint = "04bf4832d7dbcf165e682f6e597aa242d35f3d3eeed1cf438cc770d89b3a2abe";
const helperFingerprints = Object.freeze({
  getScenarioWaterPartPath: "5e34ad6daf885cbedbb97c50d71b86e9bcdc34aae14e7eb013187d28b8cde2b9",
  findCachedWaterFeaturePath: "32d204c0e190de82e07d10aa7845718dd5ccdd8080220509d1c5d45708f7d249",
  getCachedWaterFeaturePath: "67c56854887ad6424cc3bb1cb5c4894019a7c03da0ad02b49eb5327be6d4a22e",
  getScenarioWaterFeaturePath: "100281cf4afc4c28ca44e3c361cacded2b0e09d1c86d24fc937055a46fcd5113",
});
const sourceFingerprints = Object.freeze({
  [WATER_PATH_RESOURCE_MODULE_PATH]: "f3f43f4256264041e6c20a5f48d26f3dcfb3c204d5759804acc720a6fb907b4e",
  [rendererPath]: "f8a43c8a280d0e63cfbfeb010747181713534ac3a6230a7a0f806d671e6a4855",
  [cachePath]: "1daec3c19a136bfd8542f479a121119a34939121b1e367c4e6e4f3ddedfda3af",
  [surfacePath]: "58361f391628007208099fba71707254a680e46310274e91bf8f22a876df3e83",
  [projectionPath]: "489a62baf4bed0936dcd716b8ed2b9f87cc3fbec34ba0284d2adc1907dfae2bb",
  [navigationPath]: "7a5830d4f7d365d60a467f88d60af2ae72e5bcb2bfe643afa660b13e92a45c07",
  "js/core/renderer/projection_geometry_identity.js": "25aca815b841ab7238697cb512f2221bb1042bd50170a9804cee3e511669cf8e",
  "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539",
});
// These already inspected computed import providers have finite targets that
// exclude the protected factories. Their entire sources remain pinned.
const finiteImportProviders = Object.freeze({
  "js/bootstrap/deferred_ui_bootstrap.js": "090b0648dbafa5641d31fe84ff8f401729c0abb72fa0179499782ef0895dee3c",
  "js/core/data_service.js": "fdd0a319afb2a141fcbfeb21f83b4991406eac0c5e5a23a53faf8dadd52bdce1",
});
const protectedFactories = Object.freeze({
  [WATER_PATH_RESOURCE_MODULE_PATH]: WATER_PATH_RESOURCE_FACTORY_NAME,
  [projectionPath]: "createRendererProjectionPathOwner",
  [navigationPath]: "createNavigationSceneOwner",
});
const normalize = source => {
  if (typeof source !== "string") throw new TypeError("Source must be a string");
  return source.replace(/\r\n?/g, "\n");
};
const hash = source => createHash("sha256").update(source).digest("hex");
const parseModule = source => parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
const isFunction = node => ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node?.type);
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const issuedReceipts = new WeakSet();

function sourceModel(modulePath, source) {
  const ast = parseModule(source);
  const nodes = [], parents = new Map();
  fullAncestor(ast, (node, _state, ancestors) => {
    nodes.push(node);
    parents.set(node, ancestors.slice(0, -1));
  });
  const text = node => source.slice(node.start, node.end);
  const enclosingFunctions = node => parents.get(node).filter(isFunction);
  const identity = node => `${modulePath}#${node.id?.name || node.type}@${node.start}:${node.end}:${hash(text(node))}`;
  const describe = node => ({
    modulePath, nodeType: node.type, start: node.start, end: node.end,
    line: node.loc.start.line, column: node.loc.start.column,
    sourceFingerprint: hash(text(node)),
    lexicalFunctionIdentities: enclosingFunctions(node).map(identity),
  });
  const one = (predicate, label) => {
    const matches = nodes.filter(predicate);
    if (matches.length !== 1) throw new Error(`${label}: expected one site, found ${matches.length}`);
    return matches[0];
  };
  const topFunction = name => one(node => node.type === "FunctionDeclaration" && node.id?.name === name
    && enclosingFunctions(node).length === 0, name);
  return { ast, nodes, parents, text, describe, identity, enclosingFunctions, one, topFunction };
}

function productionSourcePaths(directory = "js") {
  return readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? productionSourcePaths(`${directory}/${entry.name}`)
      : /\.(?:m?js)$/i.test(entry.name) ? [`${directory}/${entry.name}`] : []);
}

function inspectConsumers(read, additionalPaths, violations) {
  // Optional fixture paths are additive. A caller cannot omit a live consumer
  // by supplying an old or incomplete list. There is no cached graph authority.
  const paths = [...new Set([...productionSourcePaths(), ...(additionalPaths || [])])].sort();
  const edges = [];
  for (const modulePath of paths) {
    const source = read(modulePath);
    if (Object.hasOwn(finiteImportProviders, modulePath)) continue;
    if (!/\b(?:import|export)\b/.test(source)) continue;
    fullAncestor(parseModule(source), node => {
      const specifier = node.type === "ImportExpression" ? node.source
        : ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) ? node.source : null;
      if (!specifier) return;
      const value = specifier.type === "Literal" ? specifier.value : null;
      if (typeof value !== "string") {
        if (node.type === "ImportExpression") violations.push({ code: "water-path-resource-dynamic-consumer-unresolved", modulePath });
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
        if (/[\\\u0000-\u001f\u007f%]/.test(pathname)) throw new Error("Invalid module pathname");
      } catch (_error) {
        violations.push({ code: "water-path-resource-consumer-path-invalid", modulePath });
        return;
      }
      const target = (pathname.startsWith(".") ? posix.normalize(posix.join(posix.dirname(modulePath), pathname))
        : pathname.startsWith("/") ? posix.normalize(pathname).slice(1) : "").toLowerCase();
      const expectedName = protectedFactories[target];
      if (expectedName) {
        if (modulePath !== rendererPath || node.type !== "ImportDeclaration" || node.specifiers.length !== 1
          || node.specifiers[0].type !== "ImportSpecifier" || node.specifiers[0].imported?.name !== expectedName
          || node.specifiers[0].local?.name !== expectedName) {
          violations.push({ code: "water-path-resource-consumer-unproved", modulePath, target });
        }
        edges.push({ modulePath, target, start: node.start, end: node.end, sourceFingerprint: hash(source.slice(node.start, node.end)) });
      } else if (/scenario_region_overlay_render_owner|renderer_projection_path_owner|navigation_scene_owner/i.test(pathname)) {
        violations.push({ code: "water-path-resource-consumer-path-unresolved", modulePath });
      }
    });
  }
  if (JSON.stringify(edges.map(edge => `${edge.modulePath}->${edge.target}`).sort())
    !== JSON.stringify(Object.keys(protectedFactories).map(target => `${rendererPath}->${target}`).sort())) {
    violations.push({ code: "water-path-resource-consumer-set-drift" });
  }
  return { edges, productionModuleCount: paths.length, additionalPathsAreAdditive: true };
}

function inspectComposition(read) {
  const renderer = sourceModel(rendererPath, read(rendererPath));
  const projection = sourceModel(projectionPath, read(projectionPath));
  const navigation = sourceModel(navigationPath, read(navigationPath));
  const composition = renderer.topFunction("getScenarioRegionOverlayRenderOwner");
  const projectionComposition = renderer.topFunction("getRendererProjectionPathOwner");
  const factoryCall = renderer.one(node => node.type === "CallExpression" && node.callee.name === WATER_PATH_RESOURCE_FACTORY_NAME,
    "water owner production factory call");
  const properties = factoryCall.arguments[1]?.properties;
  if (factoryCall.arguments.length !== 2 || factoryCall.arguments[0]?.name !== "runtimeState"
    || factoryCall.arguments[1]?.type !== "ObjectExpression"
    || properties.some(node => node.type !== "Property" || node.computed)
    || !properties.some(node => node.shorthand && node.key.name === "rendererSurfaceHost")
    || renderer.enclosingFunctions(factoryCall).at(-1) !== composition) throw new Error("Water owner composition drift");
  const host = renderer.one(node => node.type === "VariableDeclarator" && node.id?.name === "rendererSurfaceHost", "surface host allocation");
  if (host.init?.type !== "CallExpression" || host.init.callee.name !== "createRendererSurfaceHost"
    || host.init.arguments.length) throw new Error("Surface host provider drift");
  const projectionCall = renderer.one(node => node.type === "CallExpression" && node.callee.name === "createRendererProjectionPathOwner",
    "projection production factory call");
  if (renderer.enclosingFunctions(projectionCall).at(-1) !== projectionComposition
    || !renderer.text(projectionCall).includes("surfaceHost: rendererSurfaceHost")
    || !renderer.text(projectionCall).includes("getD3: () => globalThis.d3")) throw new Error("Projection composition drift");
  const setSvg = projection.one(node => node.type === "CallExpression" && node.callee.type === "MemberExpression"
    && node.callee.object.name === "hostApi" && node.callee.property.name === "setPathSvg", "SVG path provider");
  if (setSvg.arguments.length !== 1 || setSvg.arguments[0].callee?.name !== "createPath"
    || !projection.text(setSvg).includes("geoPath: d3.geoPath.bind(d3)")) throw new Error("SVG path provider drift");
  const navigationComposition = renderer.topFunction("getNavigationSceneOwner");
  const publicPath = renderer.one(node => node.type === "CallExpression" && node.callee.type === "MemberExpression"
    && node.callee.property.name === "getCachedWaterFeaturePath", "public water resource forwarding call");
  const publicCallback = renderer.enclosingFunctions(publicPath).at(-1);
  const publicProperty = renderer.parents.get(publicCallback).at(-1);
  if (renderer.enclosingFunctions(publicPath)[0] !== navigationComposition
    || publicProperty?.type !== "Property" || publicProperty.key.name !== "getCachedWaterPath"
    || renderer.text(publicPath) !== "getScenarioRegionOverlayRenderOwner().getCachedWaterFeaturePath(feature, parts)") {
    throw new Error("Public water resource forwarding drift");
  }
  const cachedRead = navigation.one(node => node.type === "CallExpression" && node.callee.type === "MemberExpression"
    && node.callee.object.name === "h" && node.callee.property.name === "getCachedWaterPath", "public water resource consumer");
  const drawItem = navigation.enclosingFunctions(cachedRead).at(-1);
  const cachedFill = navigation.one(node => node.type === "CallExpression" && node.callee.type === "MemberExpression"
    && node.callee.object.name === "context" && node.callee.property.name === "fill"
    && node.arguments.length === 1 && node.arguments[0]?.name === "cached"
    && navigation.enclosingFunctions(node).at(-1) === drawItem, "public water resource fill");
  return {
    composition: renderer.describe(composition), factoryCall: renderer.describe(factoryCall),
    targetParameter: { index: 0, path: "$", name: "runtimeState" },
    providerParameter: { index: 1, path: "$/property:rendererSurfaceHost", name: "rendererSurfaceHost" },
    hostAllocation: renderer.describe(host), projectionComposition: renderer.describe(projectionComposition),
    projectionFactoryCall: renderer.describe(projectionCall), svgProvider: projection.describe(setSvg),
    publicResourceConsumer: {
      composition: renderer.describe(navigationComposition), forwardingCall: renderer.describe(publicPath),
      providerParameter: { index: 1, path: "$/property:helpers/property:getCachedWaterPath" },
      callbackCall: navigation.describe(cachedRead), canvasCall: navigation.describe(cachedFill), admitCall: false,
      resultUse: "The cached resource is passed to canvas fill; no field assignment or publication is proved safe",
    },
    intrinsicAssumptions: ["native Path2D construction creates a resource", "standard Map and WeakMap intrinsics"],
    callbackEffectsProvedPure: false,
  };
}

function inspectFactory(model) {
  const factory = model.topFunction(WATER_PATH_RESOURCE_FACTORY_NAME);
  if (hash(model.text(factory)) !== factoryFingerprint) throw new Error("Factory source drift");
  const helperNodes = Object.fromEntries(Object.keys(helperFingerprints).map(name => [name, model.one(node =>
    node.type === "FunctionDeclaration" && node.id?.name === name && model.enclosingFunctions(node).at(-1) === factory, name)]));
  const functions = {}, helpersByKey = {};
  const returnCounts = { getScenarioWaterPartPath: 3, findCachedWaterFeaturePath: 3, getCachedWaterFeaturePath: 2, getScenarioWaterFeaturePath: 3 };
  for (const [name, node] of Object.entries(helperNodes)) {
    if (hash(model.text(node)) !== helperFingerprints[name]) throw new Error(`${name}: source drift`);
    const returns = model.nodes.filter(item => item.type === "ReturnStatement" && model.enclosingFunctions(item).at(-1) === node);
    if (returns.length !== returnCounts[name]) throw new Error(`${name}: return graph drift`);
    const entry = {
      functionName: name, declaration: model.describe(node), functionIdentity: model.identity(node),
      parameters: node.params.map((parameter, index) => ({ ...model.describe(parameter), index, path: "$", name: parameter.name })),
      returns: returns.map(statement => ({ statement: model.describe(statement), expression: model.describe(statement.argument),
        expressionSource: model.text(statement.argument),
        resultKind: statement.argument.type === "Literal" && statement.argument.value === null ? "null" : "private-path2d-or-null" })),
      resultKind: "private-path2d-or-null", borrowedResultPaths: [], admitCall: false,
      effectsPreserved: true, mutableResource: true, detachedData: false,
    };
    functions[name] = entry;
    helpersByKey[`${node.start}:${node.end}`] = entry;
  }
  const inHelper = node => Object.values(helperNodes).includes(model.enclosingFunctions(node).find(item => item !== factory));
  const constructions = model.nodes.filter(node => inHelper(node) && node.type === "NewExpression"
    && node.callee.type === "MemberExpression" && !node.callee.computed
    && node.callee.object.name === "globalThis" && node.callee.property.name === "Path2D");
  if (constructions.map(model.text).sort().join("|") !== "new globalThis.Path2D()|new globalThis.Path2D(pathString)") {
    throw new Error("Path2D construction graph drift");
  }
  const allocation = model.one(node => node.type === "VariableDeclarator" && node.id?.name === "scenarioWaterPathCache", "path cache allocation");
  if (allocation.init?.type !== "NewExpression" || allocation.init.callee.name !== "GeometryBudgetMap"
    || model.parents.get(allocation).at(-1)?.kind !== "const"
    || model.enclosingFunctions(allocation).at(-1) !== factory) throw new Error("Path cache allocation drift");
  const cacheCalls = model.nodes.filter(node => node.type === "CallExpression" && node.callee.type === "MemberExpression"
    && !node.callee.computed && node.callee.object.name === "scenarioWaterPathCache");
  const writes = cacheCalls.filter(node => node.callee.property.name === "set");
  const reads = cacheCalls.filter(node => node.callee.property.name === "get");
  if (writes.length !== 2 || reads.length !== 3
    || model.text(writes[0]) !== "scenarioWaterPathCache.set(part, { path, estimatedBytes: getGeometryRetentionWeights(part).path })"
    || model.text(writes[1]) !== "scenarioWaterPathCache.set(cacheKey, { path, parts: [...parts], estimatedBytes })") {
    throw new Error("Path cache producer graph drift");
  }
  const projectionTexts = ["scenarioWaterPathCache.get(part).path", "cached?.path", "cached.path", "retained?.path"];
  const projections = projectionTexts.map(text => model.one(node => inHelper(node) && node.type === "MemberExpression"
    && model.text(node) === text, text));
  const helperCalls = model.nodes.filter(node => node.type === "CallExpression" && Object.hasOwn(helperNodes, node.callee.name || ""));
  const counts = Object.fromEntries(Object.keys(helperNodes).map(name => [name, helperCalls.filter(node => node.callee.name === name).length]));
  if (JSON.stringify(Object.values(counts)) !== JSON.stringify([3, 1, 3, 2])
    || helperCalls.some(node => node.optional || node.arguments.some(argument => argument.type === "SpreadElement"))) {
    throw new Error("Local helper consumer graph drift");
  }
  const equality = model.one(node => node.type === "FunctionDeclaration" && node.id?.name === "sameWaterPathParts"
    && model.enclosingFunctions(node).at(-1) === factory, "parts identity check");
  const fill = model.one(node => node.type === "CallExpression" && node.callee.name === "fillWaterPath"
    && node.arguments[0]?.name === "waterPath", "water resource caller");
  return {
    factory: { ...model.describe(factory), functionName: WATER_PATH_RESOURCE_FACTORY_NAME, functionIdentity: model.identity(factory) },
    functions, helpersByKey,
    constructions: constructions.map(model.describe), pathProjections: projections.map(model.describe),
    cache: {
      allocation: model.describe(allocation), storageIdentity: `${model.identity(factory)}/scenarioWaterPathCache@${allocation.start}:${allocation.end}`,
      instanceScope: "one private allocation per factory invocation", returnedMapIsDetached: false,
      entryBorrowedResultPaths: [["parts", "*"]], keyMayBorrowGeometry: true,
      resourceField: ["path"], resourceResultKind: "private-path2d-or-null",
      writes: writes.map(node => ({ ...model.describe(node), admitCall: false, retainsInputReferences: true })),
      reads: reads.map(node => ({ ...model.describe(node), admitCall: false, resultIsOriginalEntry: true,
        borrowedResultPaths: [["parts", "*"]], privateMutation: ["LRU.delete", "LRU.set"] })),
      allOperations: cacheCalls.map(node => ({ ...model.describe(node), method: node.callee.property.name, admitCall: false })),
      partsIdentityCheck: model.describe(equality),
    },
    helperCallSites: helperCalls.map(node => ({ ...model.describe(node), helperName: node.callee.name,
      argumentCount: node.arguments.length, admitCall: false })),
    caller: { ...model.describe(fill), argumentIndex: 0, argument: model.describe(fill.arguments[0]), admitCall: false },
    preservedEffects: [
      "Original feature/parts/coordinate reads may invoke getters, iterators or coercion hooks and may throw",
      "Injected geometry/path/projection callbacks and nested callback bodies retain their effects",
      "GeometryBudgetMap get changes LRU; set/delete/clear change private retention and retain geometry references",
      "Geometry weight helpers update a private WeakMap and read original geometry",
      "Path2D construction/addPath mutate resources; canvas fill/stroke/save/restore and style changes remain effects",
      "Metrics, scheduling, cancellation, render requests and any state actions remain independently checked",
    ],
  };
}

/**
 * Exact result provenance only. This never admits a call, an argument escape,
 * a returned cache entry, an effect, or all uses of a method/resource name.
 * Both module and isolated-factory offsets refer to the PROVIDED normalized
 * source. An edited fragment cannot be replaced with the known disk factory.
 * Consumers must resolve the callee lexically, then use the resolver below;
 * all arguments, callbacks, return escapes and effects remain scanner work.
 */
export function inspectStateWaterPathResourceSources({
  source,
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
  sourcePaths,
} = {}) {
  const violations = [];
  try {
    const actualSource = normalize(source === undefined ? readSource(WATER_PATH_RESOURCE_MODULE_PATH) : source);
    const sourceForm = hash(actualSource) === sourceFingerprints[WATER_PATH_RESOURCE_MODULE_PATH] ? "module"
      : hash(actualSource.trim()) === factoryFingerprint ? "isolated-factory" : null;
    if (!sourceForm) return { violations: [{ code: "water-path-resource-provided-source-drift", modulePath: WATER_PATH_RESOURCE_MODULE_PATH }], receipt: null };
    const sources = new Map();
    const read = file => {
      if (!sources.has(file)) sources.set(file, normalize(file === WATER_PATH_RESOURCE_MODULE_PATH && sourceForm === "module"
        ? actualSource : readSource(file)));
      return sources.get(file);
    };
    const dependencies = { ...sourceFingerprints, ...finiteImportProviders };
    for (const [modulePath, expected] of Object.entries(dependencies)) {
      if (hash(read(modulePath)) !== expected) violations.push({ code: "water-path-resource-source-drift", modulePath });
    }
    if (violations.length) return { violations, receipt: null };
    const model = sourceModel(WATER_PATH_RESOURCE_MODULE_PATH, actualSource);
    if (sourceForm === "isolated-factory" && (model.ast.body.length !== 1 || model.ast.body[0].type !== "FunctionDeclaration")) {
      throw new Error("Isolated input must be exactly the factory declaration");
    }
    const factory = inspectFactory(model);
    const composition = inspectComposition(read);
    const consumerGraph = inspectConsumers(read, sourcePaths, violations);
    if (violations.length) return { violations, receipt: null };
    const receipt = freeze({
      modulePath: WATER_PATH_RESOURCE_MODULE_PATH, sourceForm, sourceFingerprint: hash(actualSource),
      offsetEncoding: "LF-normalized-UTF16", dependencies,
      ...factory, composition, consumerGraph, admitCall: false, effectsPreserved: true,
    });
    issuedReceipts.add(receipt);
    return { violations, receipt };
  } catch (error) {
    violations.push({ code: "water-path-resource-proof-unavailable", message: error.message });
    return { violations, receipt: null };
  }
}

/** Match the already lexically resolved local helper, never a callee name. */
export function resolveStateWaterPathResourceHelper(receipt, node, { source, filePath } = {}) {
  if (!receipt || !issuedReceipts.has(receipt) || filePath !== WATER_PATH_RESOURCE_MODULE_PATH
    || node?.type !== "FunctionDeclaration" || typeof source !== "string") return null;
  const normalized = normalize(source);
  if (hash(normalized) !== receipt.sourceFingerprint) return null;
  const helper = receipt.helpersByKey[`${node.start}:${node.end}`];
  if (!helper || node.id?.name !== helper.functionName || node.async || node.generator
    || node.params.length !== helper.parameters.length
    || node.params.some((parameter, index) => parameter.type !== "Identifier" || parameter.name !== helper.parameters[index].name)
    || hash(normalized.slice(node.start, node.end)) !== helper.declaration.sourceFingerprint
    || JSON.stringify(helper.declaration.lexicalFunctionIdentities) !== JSON.stringify([receipt.factory.functionIdentity])
    || node.start <= receipt.factory.start || node.end >= receipt.factory.end) return null;
  return helper;
}
