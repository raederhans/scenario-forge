import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { fullAncestor } from "acorn-walk";

export const POLITICAL_CACHE_RENDERER_PATH = "js/core/map_renderer.js";
export const POLITICAL_DERIVED_CACHE_PATH = "js/core/renderer/political_derived_state_cache.js";
export const POLITICAL_RASTER_CACHE_PATH = "js/core/renderer/political_id_raster_cache.js";
const ownerPath = "js/core/renderer/political_id_raster_runtime_owner.js";
const fingerprints = Object.freeze({
  [POLITICAL_CACHE_RENDERER_PATH]: "2c6268b741ddc394bc9025b6fb35eb43a7dc746351433ef44cdccc2c83bbcded",
  [POLITICAL_DERIVED_CACHE_PATH]: "842e22e35319d6df0bf8c82de98929c43ea7a0ff9f3d97ca6fbf22adc9ce0825",
  [POLITICAL_RASTER_CACHE_PATH]: "86b8bb72701594454238f012f7ca6dee86890cef46f131b33428f9f6f1101569",
  [ownerPath]: "9cfbc65be28984a80dd30999d2febf7abcb84d0998901d6e4b9cfb5daeb41f50",
  "js/core/political_geometry_store.js": "2a717b1d433329a38f6ea29e793e2c93649f7b75d95fedcc9c9fd823334219e4",
  "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
  "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
  "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
  "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
  "js/core/country_code_aliases.js": "460311cf93c7ffc8004cabbee374a8a76c12fd37c3ab82524d527e7b919c2f67",
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

// Effects and result ownership are distinct. Only refreshColors/reset are
// admitted by the scanner. Commit's feature-reader callback and borrowing
// readers remain conservative until input hooks and receiving consumers are proved.
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
  featureIndex: { get: { argumentCount: 1, privateMutation: [], borrowedResultPaths: [[]], admitCall: false } },
});

export function inspectStatePoliticalCacheBorrowSources({
  source,
  readSource = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
} = {}) {
  const violations = [];
  const sources = new Map();
  const read = file => {
    if (!sources.has(file)) sources.set(file, normalize(file === POLITICAL_CACHE_RENDERER_PATH && source !== undefined ? source : readSource(file)));
    return sources.get(file);
  };
  try {
    for (const [file, expected] of Object.entries(fingerprints)) {
      if (hash(read(file)) !== expected) violations.push({ code: "political-cache-source-drift", modulePath: file });
    }
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
    const lookup = functionNode(ast, "findResolvedColorFeatureById");
    if (!derivedFactory || !rasterFactory || !lookup) violations.push({ code: "political-cache-factory-missing" });
    if (violations.length) return { violations, receipt: null };
    return { violations, receipt: freeze({
      modulePath: POLITICAL_CACHE_RENDERER_PATH, sourceFingerprint: fingerprints[POLITICAL_CACHE_RENDERER_PATH],
      dependencies: { ...fingerprints }, operationsByKey,
      methods: POLITICAL_CACHE_METHOD_EFFECTS,
      factories: [
        { modulePath: POLITICAL_DERIVED_CACHE_PATH, sourceFingerprint: hash(read(POLITICAL_DERIVED_CACHE_PATH).slice(derivedFactory.start, derivedFactory.end)) },
        { modulePath: POLITICAL_RASTER_CACHE_PATH, sourceFingerprint: hash(read(POLITICAL_RASTER_CACHE_PATH).slice(rasterFactory.start, rasterFactory.end)) },
      ],
      featureLookup: { functionName: lookup.id.name, sourceFingerprint: hash(renderer.slice(lookup.start, lookup.end)), borrowedResultPaths: [[]], admitCall: false },
      diagnosticEffect: { provider: "recordRenderPerfMetric", factory: "createRenderPerfMetricsRuntimeOwner",
        actions: ["ensureRenderPerfMetricsState", "commitRenderPerfMetricState"], mirror: "mirrorRenderPerfMetricSnapshot" },
      unadmittedBorrowedConsumers: ["derived.commit", "derived.describe", "raster.get", "raster.peek", "raster.entries", "featureIndex.get"],
    }) };
  } catch (error) {
    return { violations: [{ code: "political-cache-proof-unavailable", message: error.message }], receipt: null };
  }
}
