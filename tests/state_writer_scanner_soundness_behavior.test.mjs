import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  discoverStateWriterBindingsForSource,
  validateStateActionNonTargetParameterMutations,
} from "../tools/build_state_writer_policy.mjs";
import {
  DERIVED_ALIAS_TAINT_MODES,
  discoverFunctionParameterBindings,
  normalizeDerivedAliasTaintMode,
  normalizeJavaScriptSource,
  scanStateMutationInventory,
  scanStateMutations,
} from "../tools/state_writer_inventory.mjs";

function summarizeBindings(bindings = []) {
  return bindings.map(
    ({
      functionName,
      parameterName,
      parameterIndex,
      parameterPath,
      locator,
    }) => ({
      functionName,
      parameterName,
      parameterIndex,
      parameterPath,
      locator,
    }),
  );
}

function scanWithFunctionTrace(source, {
  binding,
  analysisTraversalMode = "auto",
  filePath = "js/scanner_scope_fixture.js",
} = {}) {
  const processedFunctions = [];
  const inventory = scanStateMutationInventory(source, {
    filePath,
    bindings: [binding],
    analysisTraversalMode,
    analysisInstrumentation: {
      onProcessFunction({ functionName }) {
        processedFunctions.push(functionName);
      },
    },
  });
  return {
    inventory,
    processedFunctions,
  };
}

function parameterBindingFor(
  source,
  functionName,
  parameterName,
  id = `parameter:${functionName}:${parameterName}`,
) {
  const candidate = discoverFunctionParameterBindings(
    source,
    { parameterNames: null },
  ).bindings.find((entry) => (
    entry.functionName === functionName
    && entry.parameterName === parameterName
  ));
  assert.ok(candidate, `${functionName}:${parameterName}`);
  return {
    id,
    kind: "function-parameter",
    name: candidate.parameterName,
    functionName: candidate.functionName,
    parameterName: candidate.parameterName,
    parameterIndex: candidate.parameterIndex,
    parameterPath: candidate.parameterPath,
    locator: {
      line: candidate.line,
      column: candidate.column,
    },
  };
}

test("var redeclarations preserve the original parameter binding identity and order", () => {
  const source = [
    "export function updateState(target, sibling) {",
    "  var target;",
    "  var target;",
    "  target.bootPhase = sibling.bootPhase;",
    "  sibling.bootReady = true;",
    "}",
  ].join("\n");
  const bindings = discoverFunctionParameterBindings(
    source,
    { parameterNames: null },
  ).bindings;

  assert.deepEqual(
    bindings.map(({ parameterName, parameterIndex, parameterPath }) => ({
      parameterName,
      parameterIndex,
      parameterPath,
    })),
    [
      { parameterName: "target", parameterIndex: 0, parameterPath: "$" },
      { parameterName: "sibling", parameterIndex: 1, parameterPath: "$" },
    ],
  );
  assert.deepEqual(
    scanStateMutations(source, {
      filePath: "js/var_redeclaration_fixture.js",
      bindings: [parameterBindingFor(source, "updateState", "target")],
    }).map(({ operation, key }) => ({ operation, key })),
    [{ operation: "assign", key: "bootPhase" }],
  );
});

test("unique function-parameter analysis matches full-program semantics while skipping unrelated function bodies", () => {
  const unrelatedFunctions = Array.from(
    { length: 80 },
    (_, index) => [
      `export function unrelated${index}(otherState) {`,
      `  otherState.unrelated${index} = true;`,
      "}",
    ].join("\n"),
  ).join("\n\n");
  const source = [
    'import { setBootStateFields } from "../core/state/actions/boot_actions.js";',
    "",
    "let escapedModuleState = null;",
    "function commitThroughLocalHelper(value) {",
    "  value.helperWrite = true;",
    "  setBootStateFields(value, { bootPhase: 'helper' });",
    "}",
    "const identityThroughConstHelper = (value) => value;",
    "",
    "export function updateScopedState({ target = fallbackState } = {}, ...rest) {",
    "  target.directWrite = rest.length;",
    "  const nestedClosure = () => {",
    "    target.nestedWrite = true;",
    "  };",
    "  nestedClosure();",
    "  commitThroughLocalHelper(target);",
    "  const helperReturnAlias = identityThroughConstHelper(target);",
    "  helperReturnAlias.helperReturnWrite = true;",
    "  const containerAlias = { value: target };",
    "  containerAlias.value.containerWrite = true;",
    "  escapedModuleState = target;",
    "  let reassignedAlias = target;",
    "  reassignedAlias = {};",
    "  reassignedAlias.ignoredAfterIdentityTransition = true;",
    "",
    "  function returnedObjectMethod() {",
    "    target.objectMethodWrite = true;",
    "    setBootStateFields(target, { bootReady: true });",
    "  }",
    "  const returnedArrayMethod = () => {",
    "    target.arrayMethodWrite = true;",
    "    setBootStateFields(target, { bootPreviewVisible: true });",
    "  };",
    "  function uncalledSibling() {",
    "    setBootStateFields(target, { bootPhase: 'uncalled' });",
    "  }",
    "",
    "  return Object.freeze({",
    "    returnedObjectMethod,",
    "    methods: [returnedArrayMethod],",
    "  });",
    "}",
    "",
    unrelatedFunctions,
    "",
  ].join("\n");
  const binding = {
    id: "parameter:updateScopedState:target",
    kind: "function-parameter",
    name: "target",
    functionName: "updateScopedState",
    parameterName: "target",
    parameterIndex: 0,
    parameterPath: "$/property:target",
  };

  const scoped = scanWithFunctionTrace(source, { binding });
  const fullProgram = scanWithFunctionTrace(source, {
    binding,
    analysisTraversalMode: "full-program",
  });

  assert.deepEqual(scoped.inventory, fullProgram.inventory);
  assert.ok(
    scoped.processedFunctions.includes("updateScopedState"),
    JSON.stringify(scoped.processedFunctions),
  );
  assert.ok(
    scoped.processedFunctions.includes("commitThroughLocalHelper"),
    JSON.stringify(scoped.processedFunctions),
  );
  assert.ok(
    scoped.processedFunctions.includes("returnedObjectMethod"),
    JSON.stringify(scoped.processedFunctions),
  );
  assert.ok(
    scoped.processedFunctions.includes("returnedArrayMethod"),
    JSON.stringify(scoped.processedFunctions),
  );
  assert.equal(
    scoped.processedFunctions.some((name) => name.startsWith("unrelated")),
    false,
    JSON.stringify(scoped.processedFunctions),
  );
  assert.equal(
    fullProgram.processedFunctions.filter(
      (name) => name.startsWith("unrelated"),
    ).length,
    80,
  );
  assert.equal(
    scoped.inventory.actionDelegations.some(
      ({ enclosingFunctionIdentity }) =>
        enclosingFunctionIdentity.includes("uncalledSibling"),
    ),
    false,
  );
});

test("module bindings retain full-program traversal under automatic scoping", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "export function firstModuleWriter() {",
    "  let alias = runtimeState;",
    "  alias.bootReady = true;",
    "  alias = {};",
    "  alias.bootPhase = 'ignored-after-identity-transition';",
    "}",
    "export function secondModuleWriter() {",
    "  publishUnknown(runtimeState);",
    "  runtimeState.bootPreviewVisible = true;",
    "}",
    "",
  ].join("\n");
  const binding = {
    id: "module:runtimeState",
    kind: "module",
    name: "runtimeState",
  };

  const automatic = scanWithFunctionTrace(source, { binding });
  const fullProgram = scanWithFunctionTrace(source, {
    binding,
    analysisTraversalMode: "full-program",
  });

  assert.deepEqual(automatic.inventory, fullProgram.inventory);
  assert.deepEqual(
    automatic.processedFunctions,
    fullProgram.processedFunctions,
  );
  assert.deepEqual(
    automatic.processedFunctions.sort(),
    ["firstModuleWriter", "secondModuleWriter"],
  );
  assert.equal(
    automatic.inventory.findings.some(
      ({ operation, key }) =>
        operation === "assign" && key === "bootReady",
    ),
    true,
  );
  assert.equal(
    automatic.inventory.findings.some(
      ({ reason, evidenceKind }) =>
        reason === "state-alias-escape"
        && evidenceKind === "unknown-call-argument",
    ),
    true,
  );
});

test("binding mutation preparation follows exact analysis-object lifetime", () => {
  const sourceA = [
    "export function prepareLifetimeA(target) {",
    "  target.ready = true;",
    "}",
  ].join("\n");
  const sourceB = [
    "export function prepareLifetimeB(target) {",
    "  target.ready = false;",
    "}",
  ].join("\n");
  const preparationBuilds = [];
  const scan = (source, label) => scanStateMutationInventory(source, {
    filePath: `js/${label}.js`,
    bindings: [parameterBindingFor(
      source,
      `prepareLifetime${label}`,
      "target",
    )],
    analysisInstrumentation: {
      onPrepareBindingMutationAnalysis() {
        preparationBuilds.push(label);
      },
    },
  });

  scan(sourceA, "A");
  scan(sourceA, "A");
  scan(sourceB, "B");
  scan(sourceA, "A");

  assert.deepEqual(preparationBuilds, ["A", "B", "A"]);
});

test("failed binding mutation preparation is retried without publishing a partial context", () => {
  const source = [
    "export function retryPreparation(target) {",
    "  target.ready = true;",
    "}",
  ].join("\n");
  const binding = parameterBindingFor(
    source,
    "retryPreparation",
    "target",
  );
  const expected = new Error("preparation-probe-failed");
  let attempts = 0;

  assert.throws(
    () => scanStateMutationInventory(source, {
      bindings: [binding],
      analysisInstrumentation: {
        onCompleteBindingMutationAnalysisPreparation() {
          attempts += 1;
          throw expected;
        },
      },
    }),
    (error) => error === expected,
  );
  scanStateMutationInventory(source, {
    bindings: [binding],
    analysisInstrumentation: {
      onCompleteBindingMutationAnalysisPreparation() {
        attempts += 1;
      },
    },
  });
  scanStateMutationInventory(source, {
    bindings: [binding],
    analysisInstrumentation: {
      onCompleteBindingMutationAnalysisPreparation() {
        attempts += 1;
      },
    },
  });

  assert.equal(attempts, 2);
});

test("target-owner exported closures remain fresh for every binding", () => {
  const source = [
    "function firstHidden(target) {",
    "  return function firstReturned() { target.first = true; };",
    "}",
    "function secondHidden(target) {",
    "  return function secondReturned() { target.second = true; };",
    "}",
  ].join("\n");
  const bindings = [
    parameterBindingFor(source, "firstHidden", "target", "first-target"),
    parameterBindingFor(source, "secondHidden", "target", "second-target"),
  ];
  const exportedFunctionNamesByBinding = new Map();
  const preparationPasses = [];

  scanStateMutationInventory(source, {
    bindings,
    analysisInstrumentation: {
      onCompleteBindingMutationAnalysisPreparation(summary) {
        preparationPasses.push(summary);
      },
      onDeriveBindingMutationExportedFunctions({
        bindingId,
        functionNames,
      }) {
        exportedFunctionNamesByBinding.set(bindingId, functionNames);
      },
    },
  });

  assert.deepEqual(
    exportedFunctionNamesByBinding.get("first-target"),
    ["firstHidden", "firstReturned"],
  );
  assert.deepEqual(
    exportedFunctionNamesByBinding.get("second-target"),
    ["secondHidden", "secondReturned"],
  );
  assert.equal(preparationPasses.length, 1);
  assert.equal(preparationPasses[0].ancestorWalks, 1);
  assert.ok(preparationPasses[0].fullWalks >= 2);
});

test("shared preparation is byte-equivalent across cache reuse modes", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "const defineProperty = Object.defineProperty;",
    "function identity(value) { return value; }",
    "export function update(target, other) {",
    "  const alias = target;",
    "  alias.bootReady = true;",
    "  const returned = identity(other);",
    '  returned.bootPhase = "pending";',
    '  defineProperty(target, "bootPreviewVisible", { value: true });',
    "  publishUnknown({ other });",
    "  runtimeState.bootPhase = other.bootPhase;",
    "  return other;",
    "}",
  ].join("\n");
  const targetBinding = parameterBindingFor(
    source,
    "update",
    "target",
    "matrix-target",
  );
  const otherBinding = parameterBindingFor(
    source,
    "update",
    "other",
    "matrix-other",
  );
  const moduleBinding = {
    id: "matrix-module",
    kind: "module",
    name: "runtimeState",
  };
  const cases = [
    {
      bindings: [targetBinding],
      analysisTraversalMode: "auto",
      derivedAliasTaintMode: DERIVED_ALIAS_TAINT_MODES.STRICT,
      recognizeCurrentContracts: true,
    },
    {
      bindings: [targetBinding],
      analysisTraversalMode: "full-program",
      derivedAliasTaintMode: DERIVED_ALIAS_TAINT_MODES.STRICT,
      recognizeCurrentContracts: true,
    },
    {
      bindings: [moduleBinding],
      analysisTraversalMode: "auto",
      derivedAliasTaintMode: DERIVED_ALIAS_TAINT_MODES.STRICT,
      recognizeCurrentContracts: true,
    },
    {
      bindings: [moduleBinding, targetBinding, otherBinding],
      analysisTraversalMode: "auto",
      derivedAliasTaintMode: DERIVED_ALIAS_TAINT_MODES.STRICT,
      recognizeCurrentContracts: true,
    },
    {
      bindings: [targetBinding, otherBinding],
      analysisTraversalMode: "auto",
      derivedAliasTaintMode:
        DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
      recognizeCurrentContracts: false,
    },
  ];

  cases.forEach((options, caseIndex) => {
    const caseSource = `${source}\n// cache-mode-case-${caseIndex}`;
    let sharedPreparationCount = 0;
    let freshPreparationCount = 0;
    const shared = scanStateMutationInventory(caseSource, {
      ...options,
      analysisInstrumentation: {
        onPrepareBindingMutationAnalysis() {
          sharedPreparationCount += 1;
        },
      },
    });
    const legacyFresh = scanStateMutationInventory(caseSource, {
      ...options,
      analysisInstrumentation: {
        bindingMutationAnalysisContextMode: "fresh",
        onPrepareBindingMutationAnalysis() {
          freshPreparationCount += 1;
        },
      },
    });
    assert.deepEqual(shared, legacyFresh);
    assert.equal(JSON.stringify(shared), JSON.stringify(legacyFresh));
    assert.equal(sharedPreparationCount, 1);
    assert.equal(freshPreparationCount, options.bindings.length);
  });

  const malformed = "export function malformed(target) {";
  const malformedBinding = {
    id: "malformed-target",
    kind: "function-parameter",
    name: "target",
    functionName: "malformed",
    parameterName: "target",
    parameterIndex: 0,
    parameterPath: "$",
  };
  const malformedShared = scanStateMutationInventory(malformed, {
    bindings: [malformedBinding],
  });
  const malformedFresh = scanStateMutationInventory(malformed, {
    bindings: [malformedBinding],
    analysisInstrumentation: {
      bindingMutationAnalysisContextMode: "fresh",
    },
  });
  assert.deepEqual(malformedShared, malformedFresh);
  assert.equal(
    JSON.stringify(malformedShared),
    JSON.stringify(malformedFresh),
  );

  const ambiguousSource = [
    "function duplicate(target) { target.first = true; }",
    "function duplicate(target) { target.second = true; }",
  ].join("\n");
  const ambiguousBinding = {
    id: "ambiguous-target",
    kind: "function-parameter",
    name: "target",
    functionName: "duplicate",
    parameterName: "target",
    parameterIndex: 0,
    parameterPath: "$",
  };
  const ambiguousShared = scanStateMutationInventory(ambiguousSource, {
    bindings: [ambiguousBinding],
  });
  const ambiguousFresh = scanStateMutationInventory(ambiguousSource, {
    bindings: [ambiguousBinding],
    analysisInstrumentation: {
      bindingMutationAnalysisContextMode: "fresh",
    },
  });
  assert.deepEqual(ambiguousShared, ambiguousFresh);

  for (const contextMode of ["shared", "fresh"]) {
    const expected = new Error(`matrix-${contextMode}-exception`);
    assert.throws(
      () => scanStateMutationInventory(source, {
        bindings: [targetBinding],
        analysisInstrumentation: {
          bindingMutationAnalysisContextMode: contextMode,
          onProcessFunction() {
            throw expected;
          },
        },
      }),
      (error) => error === expected,
    );
  }
});

test("ambiguous function-parameter owners remain fail-closed in scoped and full modes", () => {
  const source = [
    "function update(target) {",
    "  target.bootReady = true;",
    "}",
    "function update(target) {",
    "  target.bootPreviewVisible = true;",
    "}",
    "",
  ].join("\n");
  const binding = {
    id: "parameter:update:target",
    kind: "function-parameter",
    name: "target",
    functionName: "update",
    parameterName: "target",
    parameterIndex: 0,
    parameterPath: "$",
  };

  const scoped = scanWithFunctionTrace(source, { binding });
  const fullProgram = scanWithFunctionTrace(source, {
    binding,
    analysisTraversalMode: "full-program",
  });

  assert.deepEqual(scoped.inventory, fullProgram.inventory);
  assert.deepEqual(scoped.processedFunctions, []);
  assert.equal(scoped.inventory.findings.length, 1);
  assert.equal(
    scoped.inventory.findings[0].reason,
    "binding-locator-ambiguous",
  );
});

test("formal parameter indexes and structural paths remain stable across destructured identifiers", () => {
  const discovery = discoverFunctionParameterBindings(
    `
      export function updateBoot(
        { ordinary, model, nested: { targetState } },
        [first, runtimeState],
        appState,
      ) {
        model.bootPhase = "ready";
      }
    `,
    { parameterNames: null },
  );

  assert.deepEqual(
    discovery.bindings.map(({ parameterName, parameterIndex, parameterPath }) => ({
      parameterName,
      parameterIndex,
      parameterPath,
    })),
    [
      {
        parameterName: "model",
        parameterIndex: 0,
        parameterPath: "$/property:model",
      },
      {
        parameterName: "ordinary",
        parameterIndex: 0,
        parameterPath: "$/property:ordinary",
      },
      {
        parameterName: "targetState",
        parameterIndex: 0,
        parameterPath: "$/property:nested/property:targetState",
      },
      {
        parameterName: "first",
        parameterIndex: 1,
        parameterPath: "$/index:0",
      },
      {
        parameterName: "runtimeState",
        parameterIndex: 1,
        parameterPath: "$/index:1",
      },
      {
        parameterName: "appState",
        parameterIndex: 2,
        parameterPath: "$",
      },
    ],
  );
});

test("previous structural parameter path survives a destructured target rename without claiming siblings", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function updateBoot({ ordinary, state: model }) {
        model.bootPhase = "ready";
        ordinary.ordinaryPayloadField = true;
      }
    `,
    "production",
    {
      previousWriter: {
        bindings: [{
          kind: "function-parameter",
          functionName: "updateBoot",
          parameterName: "runtimeState",
          parameterIndex: 0,
          parameterPath: "$/property:state",
        }],
      },
    },
  );

  assert.deepEqual(
    summarizeBindings(bindings).map(
      ({ functionName, parameterName, parameterIndex, parameterPath }) => ({
        functionName,
        parameterName,
        parameterIndex,
        parameterPath,
      }),
    ),
    [{
      functionName: "updateBoot",
      parameterName: "model",
      parameterIndex: 0,
      parameterPath: "$/property:state",
    }],
  );
});

test("direct formal parameter identity survives a local rename through the root path", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function updateBoot(model) {
        model.bootPhase = "ready";
      }
    `,
    "production",
    {
      previousWriter: {
        bindings: [{
          kind: "function-parameter",
          functionName: "updateBoot",
          parameterName: "runtimeState",
          parameterIndex: 0,
          parameterPath: "$",
        }],
      },
    },
  );

  assert.deepEqual(
    bindings.map(
      ({ functionName, parameterName, parameterIndex, parameterPath }) => ({
        functionName,
        parameterName,
        parameterIndex,
        parameterPath,
      }),
    ),
    [{
      functionName: "updateBoot",
      parameterName: "model",
      parameterIndex: 0,
      parameterPath: "$",
    }],
  );
});

test("changed arbitrary parameters do not gain state authority from dynamic-only mutations", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function updateValue(model, key) {
        model[key] = "ready";
      }
    `,
    "production",
    { scanAllParameters: true },
  );

  assert.deepEqual(bindings, []);
});

test("changed arbitrary parameters do not gain state authority from diagnostic-only escapes", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function dispatchValue(model) {
        unknownSink(model);
      }
    `,
    "production",
    { scanAllParameters: true },
  );

  assert.deepEqual(bindings, []);
});

test("changed arbitrary parameters gain state authority from canonical state-key mutations", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function updateBoot(model) {
        model.bootPhase = "ready";
      }
    `,
    "production",
    { scanAllParameters: true },
  );

  assert.deepEqual(
    bindings.map(({ functionName, parameterName, parameterIndex }) => ({
      functionName,
      parameterName,
      parameterIndex,
    })),
    [{
      functionName: "updateBoot",
      parameterName: "model",
      parameterIndex: 0,
    }],
  );
});

test("previous state-target identity retains dynamic-only mutations after a parameter rename", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function updateValue(model, key) {
        model[key] = "ready";
      }
    `,
    "production",
    {
      scanAllParameters: true,
      previousWriter: {
        bindings: [{
          kind: "function-parameter",
          functionName: "updateValue",
          parameterName: "runtimeState",
          parameterIndex: 0,
          parameterPath: "$",
        }],
      },
    },
  );

  assert.deepEqual(
    bindings.map(({ functionName, parameterName, parameterIndex }) => ({
      functionName,
      parameterName,
      parameterIndex,
    })),
    [{
      functionName: "updateValue",
      parameterName: "model",
      parameterIndex: 0,
    }],
  );
});

test("explicit state-target names retain fail-closed diagnostic-only mutations", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function dispatchValue(target) {
        unknownSink(target);
      }
    `,
    "production",
    { scanAllParameters: true },
  );

  assert.deepEqual(
    bindings.map(({ functionName, parameterName, parameterIndex }) => ({
      functionName,
      parameterName,
      parameterIndex,
    })),
    [{
      functionName: "dispatchValue",
      parameterName: "target",
      parameterIndex: 0,
    }],
  );
});

test("ordinary concrete payload fields stay outside state-target discovery", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function updatePayload(payload) {
        payload.ordinaryPayloadField = true;
      }
    `,
    "production",
    { scanAllParameters: true },
  );

  assert.deepEqual(bindings, []);
});

test("changed destructured siblings do not inherit state authority from a target sibling", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function loadProject(sampleId, {
        targetState,
        helpers = {},
      } = {}) {
        targetState.bootPhase = "ready";
        consume({
          fetchImpl: helpers.fetchImpl,
          ui: helpers.ui,
          hooks: helpers.hooks,
        });
      }
    `,
    "production",
    { scanAllParameters: true },
  );

  assert.deepEqual(
    bindings.map(({ parameterName, parameterIndex, parameterPath }) => ({
      parameterName,
      parameterIndex,
      parameterPath,
    })),
    [{
      parameterName: "targetState",
      parameterIndex: 1,
      parameterPath: "$/property:targetState",
    }],
  );
});

test("changed nested-function payload parameters do not inherit an outer state binding", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function createController({ state }) {
        function hydrateBundle(bundle) {
          consume(bundle.runtimeTopologyPayload);
          consume(bundle.releasableCatalog);
          consume(bundle.auditPayload);
          state.bootPhase = "ready";
        }
        return { hydrateBundle };
      }
    `,
    "production",
    { scanAllParameters: true },
  );

  assert.deepEqual(
    bindings.map(({ functionName, parameterName, parameterPath }) => ({
      functionName,
      parameterName,
      parameterPath,
    })),
    [{
      functionName: "createController",
      parameterName: "state",
      parameterPath: "$/property:state",
    }],
  );
});

test("anonymous callback identities resolve their own parameter binding", async () => {
  const source = `
    consume((ordinary) => {
      ordinary.ordinaryPayloadField = true;
    });
    consume((model) => {
      model.bootPhase = "ready";
    });
    consume(function (diagnosticModel) {
      unknownSink(diagnosticModel);
    });
  `;
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    source,
    "production",
    { scanAllParameters: true },
  );

  assert.equal(bindings.length, 1);
  assert.ok(
    bindings.every(({ functionName }) =>
      functionName.startsWith("<anonymous>@")
    ),
  );
  assert.equal(new Set(bindings.map(({ functionName }) => functionName)).size, 1);
  assert.deepEqual(
    bindings.map(({ parameterName }) => parameterName).sort(),
    ["model"],
  );

  for (const binding of bindings) {
    const findings = scanStateMutations(source, {
      filePath: "js/fixture.js",
      bindings: [binding],
    });
    assert.ok(findings.length > 0);
    assert.ok(
      findings.every(({ root }) => root === binding.parameterName),
      JSON.stringify(findings),
    );
  }
});

test("registered imported actions accept a defaulted full-root state target only", () => {
  const source = `
    import { state as runtimeState } from "../core/state.js";
    import {
      setUiShellDebugTerritorySeededState,
    } from "../core/state/actions/boot_actions.js";
    import { consumeState } from "../core/other_helper.js";

    function update(
      state = runtimeState,
      childState = runtimeState.bootMetrics,
    ) {
      setUiShellDebugTerritorySeededState(state, true);
      setUiShellDebugTerritorySeededState(childState, true);
      consumeState(state);
    }
  `;
  const findings = scanStateMutations(source, {
    filePath: "js/bootstrap/ui_shell_debug_seed.js",
    bindings: [{
      id: "module:runtimeState",
      kind: "module",
      name: "runtimeState",
    }],
  });

  assert.deepEqual(
    findings.map(({ line, reason }) => ({ line, reason })),
    [
      { line: 13, reason: "state-alias-escape" },
      { line: 14, reason: "state-alias-escape" },
    ],
  );
});

test("runtime hook registration accepts only the exact imported compat target", () => {
  const binding = {
    id: "module:runtimeState",
    kind: "module",
    name: "runtimeState",
  };
  const accepted = scanStateMutations(`
    import { state as runtimeState } from "../core/state.js";
    import { registerRuntimeHook as registerHook } from "../core/state/index.js";
    registerHook(runtimeState, "refreshUiFn", () => true);
  `, {
    filePath: "js/ui/runtime_hook_fixture.js",
    bindings: [binding],
  });
  assert.deepEqual(accepted, []);

  const wrongSource = scanStateMutations(`
    import { state as runtimeState } from "../core/state.js";
    import { registerRuntimeHook } from "../core/other_helper.js";
    registerRuntimeHook(runtimeState, "refreshUiFn", () => true);
  `, {
    filePath: "js/ui/runtime_hook_fixture.js",
    bindings: [binding],
  });
  assert.ok(wrongSource.some(({ reason }) => reason === "state-alias-escape"));
});

test("local helper return aliases retain state identity through direct, wrapped, and container results", () => {
  const source = `
    function getState() {
      return state;
    }
    function identity(value) {
      return value;
    }
    function boxState() {
      return { value: state };
    }
    function writeThroughHelpers() {
      const direct = getState();
      direct.bootPhase = "direct";
      const wrapped = identity(state);
      wrapped.bootReady = true;
      const boxed = boxState();
      boxed.value.bootPreviewVisible = true;
    }
    writeThroughHelpers();
  `;
  const findings = scanStateMutations(source, {
    filePath: "tests/local_helper_return_alias_fixture.js",
    bindings: [{
      id: "test-file-root:state",
      kind: "test-file-root",
      name: "state",
    }],
  });

  assert.deepEqual(
    findings
      .filter(({ operation }) => operation === "assign")
      .map(({ key }) => key)
      .sort(),
    [
      "bootPhase",
      "bootReady",
    ],
  );
  assert.equal(
    findings.some(
      ({ operation, reason, line }) =>
        operation === "unsupported"
        && reason === "ambiguous-alias-flow"
        && line === 17,
    ),
    true,
  );
});

test("mutable non-state captures do not taint immutable helper results, while target and dynamic captures remain fail-closed", () => {
  const nonStateCapture = scanStateMutations(`
    let tooltipNode = null;
    function getTooltipNode() { return tooltipNode; }
    tooltipNode = document.createElement("div");
    const tooltip = getTooltipNode();
    tooltip.textContent = "ready";
  `, {
    filePath: "js/non_state_capture_fixture.js",
    bindings: [{
      id: "module:state",
      kind: "module",
      name: "state",
    }],
  });
  assert.deepEqual(nonStateCapture, []);

  for (const source of [
    `
      let captured = null;
      function getCaptured() { return captured; }
      captured = state;
      publish(getCaptured());
    `,
    `
      let captured = null;
      function getCaptured() { return captured; }
      captured = enabled ? state : fallback;
      publish(getCaptured());
    `,
  ]) {
    const findings = scanStateMutations(source, {
      filePath: "js/mutable_capture_fixture.js",
      bindings: [{
        id: "module:state",
        kind: "module",
        name: "state",
      }],
    });
    assert.equal(
      findings.some(({ operation, reason }) => (
        operation === "unsupported"
        && ["state-alias-escape", "ambiguous-alias-flow"].includes(reason)
      )),
      true,
      JSON.stringify(findings),
    );
  }
});

test("chained and parameter-mediated mutable captures remain fail-closed", () => {
  const chained = scanStateMutations(`
    let first = null;
    let second = null;
    function mutate() { second.chainWrite = true; }
    second = first;
    first = state;
    mutate();
  `, {
    filePath: "js/chained_mutable_capture_fixture.js",
    bindings: [{
      id: "module:state",
      kind: "module",
      name: "state",
    }],
  });
  assert.equal(
    chained.some(({ operation, key, reason, line }) => (
      operation === "unsupported"
      && key === "*"
      && reason === "ambiguous-alias-flow"
      && line === 4
    )),
    true,
    JSON.stringify(chained),
  );

  const parameterMediated = scanStateMutations(`
    let captured = null;
    function receive(value) { captured = value; }
    receive(state);
    function mutate() { captured.parameterWrite = true; }
    mutate();
  `, {
    filePath: "js/parameter_mutable_capture_fixture.js",
    bindings: [{
      id: "module:state",
      kind: "module",
      name: "state",
    }],
  });
  assert.equal(
    parameterMediated.some(({ operation, key, reason, line }) => (
      operation === "unsupported"
      && key === "*"
      && reason === "ambiguous-alias-flow"
      && line === 5
    )),
    true,
    JSON.stringify(parameterMediated),
  );

  const nonStateChain = scanStateMutations(`
    let first = null;
    let second = null;
    function mutate() { second.safeWrite = true; }
    second = first;
    first = document.createElement("div");
    mutate();
  `, {
    filePath: "js/non_state_chained_capture_fixture.js",
    bindings: [{
      id: "module:state",
      kind: "module",
      name: "state",
    }],
  });
  assert.deepEqual(nonStateChain, []);
});

test("registered reference-identity action arguments accept static destructured state paths only", () => {
  const source = `
    import { commitSpecialZoneLayersState } from "../core/state/actions/special_zone_actions.js";
    export function commit({ runtimeState }) {
      commitSpecialZoneLayersState(runtimeState, runtimeState.specialZoneLayers, {});
    }
  `;
  const binding = parameterBindingFor(source, "commit", "runtimeState");
  const accepted = scanStateMutations(source, {
    filePath: "js/ui/reference_identity_fixture.js",
    bindings: [binding],
  });
  assert.deepEqual(accepted, []);

  const directRootSource = source.replace(
    "commit({ runtimeState })",
    "commit(runtimeState)",
  );
  assert.deepEqual(scanStateMutations(directRootSource, {
    filePath: "js/ui/reference_identity_fixture.js",
    bindings: [parameterBindingFor(
      directRootSource,
      "commit",
      "runtimeState",
    )],
  }), []);

  for (const argument of [
    "runtimeState[key]",
    "runtimeState.specialZoneLayers[key]",
  ]) {
    const findings = scanStateMutations(source.replace(
      "runtimeState.specialZoneLayers",
      argument,
    ), {
      filePath: "js/ui/reference_identity_fixture.js",
      bindings: [binding],
    });
    assert.equal(
      findings.some(({ reason }) => reason === "state-alias-escape"),
      true,
      JSON.stringify(findings),
    );
  }

  const shadowedActionSource = source.replace(
    'import { commitSpecialZoneLayersState } from "../core/state/actions/special_zone_actions.js";\n',
    "",
  ).replace(
    "commitSpecialZoneLayersState(runtimeState, runtimeState.specialZoneLayers, {});",
    "const commitSpecialZoneLayersState = () => {};\n      commitSpecialZoneLayersState(runtimeState, runtimeState.specialZoneLayers, {});",
  );
  const shadowed = scanStateMutations(shadowedActionSource, {
    filePath: "js/ui/reference_identity_fixture.js",
    bindings: [parameterBindingFor(
      shadowedActionSource,
      "commit",
      "runtimeState",
    )],
  });
  assert.equal(
    shadowed.some(({ reason }) => reason === "state-alias-escape"),
    true,
    JSON.stringify(shadowed),
  );
});

test("explicit imported pure readers accept only an exact direct state root", () => {
  const source = `
    import { createCountryInspectorModel } from "./country_inspector_model.js";
    export function read(runtimeState, t, extra = []) {
      createCountryInspectorModel(runtimeState, t);
    }
  `;
  const options = {
    filePath: "js/ui/sidebar/country_inspector_controller.js",
    bindings: [parameterBindingFor(source, "read", "runtimeState")],
  };
  assert.deepEqual(scanStateMutations(source, options), []);

  for (const rejectedSource of [
    source.replace(
      "createCountryInspectorModel(runtimeState, t);",
      "createCountryInspectorModel(runtimeState.countryMetadata, t);",
    ),
    source.replace(
      "createCountryInspectorModel(runtimeState, t);",
      "createCountryInspectorModel(runtimeState);",
    ),
    source.replace(
      "createCountryInspectorModel(runtimeState, t);",
      "createCountryInspectorModel(runtimeState, ...extra);",
    ),
    source.replace(
      'import { createCountryInspectorModel } from "./country_inspector_model.js";\n',
      "",
    ).replace(
      "createCountryInspectorModel(runtimeState, t);",
      "const createCountryInspectorModel = () => {};\n      createCountryInspectorModel(runtimeState, t);",
    ),
  ]) {
    const rejected = scanStateMutations(rejectedSource, {
      ...options,
      bindings: [parameterBindingFor(
        rejectedSource,
        "read",
        "runtimeState",
      )],
    });
    assert.equal(
      rejected.some(({ reason, evidenceKind }) => (
        reason === "state-alias-escape"
        && evidenceKind === "unknown-call-argument"
      )),
      true,
      JSON.stringify(rejected),
    );
  }
});

test("borrowed chunk readers accept subtrees while unrelated calls and writes remain tracked", () => {
  const source = `
    import { buildScenarioChunkLayerSelectionSignatures } from "./chunk_layer_payloads.js";
    export function read(runtimeState, bundle, other) {
      const selected = other || runtimeState.activeScenarioChunks;
      buildScenarioChunkLayerSelectionSignatures(bundle, selected, null);
      runtimeState.activeScenarioChunks.loadedChunkIds = [];
    }
  `;
  const inspect = (text) => scanStateMutations(text, {
    filePath: "js/core/scenario/chunk_runtime.js",
    bindings: [parameterBindingFor(text, "read", "runtimeState")],
  });
  const findings = inspect(source);
  assert.equal(findings.some(({ reason }) => reason === "state-alias-escape"), false);
  assert.ok(findings.some(({ operation }) => operation === "assign"));
  assert.ok(inspect(source.replace(
    "buildScenarioChunkLayerSelectionSignatures(bundle, selected, null)",
    "unknownReader(bundle, selected, null)",
  )).some(({ reason }) => reason === "state-alias-escape"));
  assert.ok(inspect(source.replace(
    "buildScenarioChunkLayerSelectionSignatures(bundle, selected, null)",
    "buildScenarioChunkLayerSelectionSignatures(bundle, selected)",
  )).some(({ reason }) => reason === "state-alias-escape"));
});

test("source-bound special-zone projection keeps its land-index output borrowed", () => {
  const source = `
    import { buildSpecialZoneRenderFeatures } from "../special_zone_layers.js";
    export function project(runtimeState) {
      return buildSpecialZoneRenderFeatures(
        runtimeState.specialZoneLayers,
        runtimeState.landIndex,
      );
    }
  `;
  const options = {
    filePath: "js/core/renderer/special_zone_layers_render_owner.js",
    bindings: [parameterBindingFor(source, "project", "runtimeState")],
  };
  const directReturn = scanStateMutations(source, options);
  assert.equal(
    directReturn.some(({ key, evidenceKind }) => (
      key === "specialZoneLayers"
      && evidenceKind === "unknown-call-argument"
    )),
    false,
    JSON.stringify(directReturn),
  );
  assert.equal(
    directReturn.filter(({ key, evidenceKind }) => (
      key === "landIndex" && evidenceKind === "unknown-call-argument"
    )).length,
    1,
    JSON.stringify(directReturn),
  );
  assert.equal(
    directReturn.some(({ key, evidenceKind }) => (
      key === "landIndex" && evidenceKind === "return-value"
    )),
    false,
    JSON.stringify(directReturn),
  );

  const localWriteSource = source.replace(
    "return buildSpecialZoneRenderFeatures(\n        runtimeState.specialZoneLayers,\n        runtimeState.landIndex,\n      );",
    "const projected = buildSpecialZoneRenderFeatures(\n        runtimeState.specialZoneLayers,\n        runtimeState.landIndex,\n      );\n      projected.features[0].geometry = null;",
  );
  const localWrite = scanStateMutations(localWriteSource, {
    ...options,
    bindings: [parameterBindingFor(
      localWriteSource,
      "project",
      "runtimeState",
    )],
  });
  assert.equal(
    localWrite.some(({ operation, key }) => (
      operation === "assign" && key === "landIndex"
    )),
    true,
    JSON.stringify(localWrite),
  );

  const sinkSource = source.replace(
    "return buildSpecialZoneRenderFeatures(\n        runtimeState.specialZoneLayers,\n        runtimeState.landIndex,\n      );",
    "holder.value = buildSpecialZoneRenderFeatures(\n        runtimeState.specialZoneLayers,\n        runtimeState.landIndex,\n      );",
  );
  const sink = scanStateMutations(sinkSource, {
    ...options,
    bindings: [parameterBindingFor(sinkSource, "project", "runtimeState")],
  });
  assert.equal(
    sink.some(({ key, evidenceKind }) => (
      key === "landIndex" && evidenceKind === "assignment-value"
    )),
    true,
    JSON.stringify(sink),
  );

  for (const rejectedSource of [
    source.replace("runtimeState.landIndex,\n      );", "runtimeState.landIndex, extra,\n      );"),
    source.replace("runtimeState.landIndex", "runtimeState[landIndexKey]"),
    source.replace(
      "buildSpecialZoneRenderFeatures(\n        runtimeState.specialZoneLayers,\n        runtimeState.landIndex,\n      )",
      "buildSpecialZoneRenderFeatures(...[\n        runtimeState.specialZoneLayers,\n        runtimeState.landIndex,\n      ])",
    ),
  ]) {
    const rejected = scanStateMutations(rejectedSource, {
      ...options,
      bindings: [parameterBindingFor(
        rejectedSource,
        "project",
        "runtimeState",
      )],
    });
    assert.equal(
      rejected.some(({ key, reason }) => (
        key === "specialZoneLayers"
        && reason === "state-alias-escape"
      )),
      true,
      JSON.stringify(rejected),
    );
  }
});

test("exact Map.prototype.get.call keeps borrowed state provenance and rejects mutable or inexact intrinsics", () => {
  const readSource = `
    const entry = Map.prototype.get.call(state.recordsById, id);
    entry.label = "updated";
  `;
  const borrowedWrite = scanStateMutations(readSource, {
    filePath: "js/map_intrinsic_fixture.js",
    bindings: [{ id: "module:state", kind: "module", name: "state" }],
  });
  assert.deepEqual(
    borrowedWrite.map(({ operation, key }) => ({ operation, key })),
    [{ operation: "assign", key: "recordsById" }],
  );

  const returnEscape = scanStateMutations(`
    function readEntry() {
      return Map.prototype.get.call(state.recordsById, id);
    }
  `, {
    filePath: "js/map_intrinsic_return_fixture.js",
    bindings: [{ id: "module:state", kind: "module", name: "state" }],
  });
  const sinkEscape = scanStateMutations(`
    holder.entry = Map.prototype.get.call(state.recordsById, id);
  `, {
    filePath: "js/map_intrinsic_sink_fixture.js",
    bindings: [{ id: "module:state", kind: "module", name: "state" }],
  });
  for (const findings of [returnEscape, sinkEscape]) {
    assert.equal(
    findings.some(({ key, reason }) => (
      key === "recordsById" && reason === "state-alias-escape"
    )),
      true,
      JSON.stringify(findings),
    );
  }

  const rejectedSources = [
    "Map.prototype.get.call(state.recordsById, id, extra);",
    "Map.prototype.get.call(state, id);",
    "Map.prototype.get.apply(state.recordsById, [id]);",
    "Map.prototype[\"get\"].call(state.recordsById, id);",
    "state.recordsById.get(id);",
    "function inspect(Map) { Map.prototype.get.call(state.recordsById, id); }",
    "function inspect(Function) { Map.prototype.get.call(state.recordsById, id); }",
    "Map = FakeMap; Map.prototype.get.call(state.recordsById, id);",
    "Map.prototype = {}; Map.prototype.get.call(state.recordsById, id);",
    "Map.prototype.get = replacement; Map.prototype.get.call(state.recordsById, id);",
    "Object.defineProperty(Map.prototype, \"get\", { value: replacement }); Map.prototype.get.call(state.recordsById, id);",
    "Reflect.set(Function.prototype, \"call\", replacement); Map.prototype.get.call(state.recordsById, id);",
    "patch(Map.prototype); Map.prototype.get.call(state.recordsById, id);",
    "const prototype = Map.prototype; patch(prototype); Map.prototype.get.call(state.recordsById, id);",
    "patch(Function.prototype.call); Map.prototype.get.call(state.recordsById, id);",
    "const prototype = Object.getPrototypeOf(new Map()); prototype.get = replacement; Map.prototype.get.call(state.recordsById, id);",
    "const get = Map.prototype.get; const prototype = Reflect.getPrototypeOf(get); prototype.call = replacement; Map.prototype.get.call(state.recordsById, id);",
    "const prototype = new Map().__proto__; prototype.get = replacement; Map.prototype.get.call(state.recordsById, id);",
    "const get = Map.prototype.get; const prototype = get.constructor.prototype; prototype.call = replacement; Map.prototype.get.call(state.recordsById, id);",
  ];
  for (const source of rejectedSources) {
    const findings = scanStateMutations(source, {
      filePath: "js/map_intrinsic_rejected_fixture.js",
      bindings: [{ id: "module:state", kind: "module", name: "state" }],
    });
    assert.equal(
      findings.some(({ reason }) => (
        reason === "state-alias-escape"
        || reason === "unsupported-call-mutation"
      )),
      true,
      JSON.stringify(findings),
    );
  }
});

test("source-bound owner factories admit only their exact state property", async () => {
  // Scanner offsets refer to normalized LF source, including on Windows checkouts.
  const rendererSource = normalizeJavaScriptSource(await readFile(
    new URL("../js/core/map_renderer.js", import.meta.url),
    "utf8",
  ));
  const functionStart = rendererSource.indexOf("function getRenderCacheOwner() {");
  const nextFunctionStart = rendererSource.indexOf(
    "\nfunction ",
    functionStart + 1,
  );
  assert.ok(functionStart >= 0 && nextFunctionStart > functionStart);
  const getterSource = rendererSource
    .slice(functionStart, nextFunctionStart)
    .trim();
  const source = [
    'import { state as runtimeState } from "./state.js";',
    'import { createRenderCacheOwner } from "./renderer/render_cache_owner.js";',
    getterSource,
  ].join("\n\n");
  const options = {
    filePath: "js/core/map_renderer.js",
    bindings: [{
      id: "module:runtimeState",
      kind: "module",
      name: "runtimeState",
    }],
  };
  const stateValueStart = source.indexOf("state: runtimeState")
    + "state: ".length;
  const factoryObjectStart = source.indexOf(
    "{",
    source.indexOf("createRenderCacheOwner("),
  );
  assert.ok(stateValueStart >= "state: ".length);
  assert.ok(factoryObjectStart >= 0);
  const findings = scanStateMutations(source, options);
  assert.deepEqual(findings, []);

  const driftedSource = source.replace(
    "state: runtimeState,",
    "state: runtimeState /* source drift */,",
  );
  assert.notEqual(driftedSource, source);
  const driftedStateValueStart = driftedSource.indexOf("state: runtimeState")
    + "state: ".length;
  const driftedFactoryObjectStart = driftedSource.indexOf(
    "{",
    driftedSource.indexOf("createRenderCacheOwner("),
  );
  const drifted = scanStateMutations(driftedSource, options);
  assert.equal(
    drifted.some(({ start, reason }) => (
      start === driftedStateValueStart && reason === "state-alias-escape"
    )),
    true,
    JSON.stringify(drifted),
  );
  assert.equal(
    drifted.some(({ start, reason, evidenceKind }) => (
      start === driftedFactoryObjectStart
      && reason === "state-alias-escape"
      && evidenceKind === "unknown-call-argument"
    )),
    true,
    JSON.stringify(drifted),
  );

  const unregisteredSource = source.replaceAll(
    "createRenderCacheOwner",
    "unregisteredFactory",
  );
  const unregisteredStateValueStart = unregisteredSource.indexOf(
    "state: runtimeState",
  ) + "state: ".length;
  const unregisteredFactoryObjectStart = unregisteredSource.indexOf(
    "{",
    unregisteredSource.indexOf("unregisteredFactory("),
  );
  const unregistered = scanStateMutations(unregisteredSource, options);
  assert.equal(
    unregistered.some(({ start, reason }) => (
      start === unregisteredStateValueStart && reason === "state-alias-escape"
    )),
    true,
    JSON.stringify(unregistered),
  );
  assert.equal(
    unregistered.some(({ start, reason, evidenceKind }) => (
      start === unregisteredFactoryObjectStart
      && reason === "state-alias-escape"
      && evidenceKind === "unknown-call-argument"
    )),
    true,
    JSON.stringify(unregistered),
  );

  const extraStateSource = source.replace(
    "state: runtimeState,",
    "state: runtimeState, escapedState: runtimeState,",
  );
  const extraStateValueStart = extraStateSource.indexOf("escapedState: runtimeState")
    + "escapedState: ".length;
  const extraStateFindings = scanStateMutations(extraStateSource, options);
  assert.ok(extraStateFindings.some(({ start, reason }) => (
    start === extraStateValueStart && reason === "state-alias-escape"
  )), JSON.stringify(extraStateFindings));

  const mutatedSource = source.replace(
    "return renderCacheOwner;",
    "runtimeState.bootPhase = 'ready'; return renderCacheOwner;",
  );
  const mutationFindings = scanStateMutations(mutatedSource, options);
  assert.ok(mutationFindings.some(({ key, unsupported }) => (
    key === "bootPhase" && !unsupported
  )), JSON.stringify(mutationFindings));
});

test("direct object containers retain state taint for downstream member writes", () => {
  const source = `
    const box = { value: state };
    box.value.bootPhase = "ready";
  `;
  const findings = scanStateMutations(source, {
    filePath: "tests/direct_state_container_fixture.js",
    bindings: [{
      id: "test-file-root:state",
      kind: "test-file-root",
      name: "state",
    }],
  });

  assert.equal(
    findings.some(
      ({ operation, reason, line }) =>
        operation === "unsupported"
        && reason === "ambiguous-alias-flow"
        && line === 3,
    ),
    true,
  );
});

test("computed state projections remain fail-closed in legacy-baseline mode", () => {
  const source = `
    const keys = ["bootPhase", "bootReady"];
    const patch = Object.fromEntries(
      keys.map((key) => [key, runtimeState[key]]),
    );
    consume(patch);
  `;
  const findings = scanStateMutations(source, {
    filePath: "tests/computed_state_projection_fixture.js",
    bindings: [{
      id: "test-file-root:runtimeState",
      kind: "test-file-root",
      name: "runtimeState",
    }],
    derivedAliasTaintMode:
      DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  });

  assert.equal(
    findings.some(
      ({ operation, key, reason }) =>
        operation === "unsupported"
        && key === "*"
        && reason === "state-alias-escape",
    ),
    true,
  );
});

test("derived alias taint defaults to strict and legacy-baseline preserves the frozen scanner result", () => {
  const source = `
    function identity(value) {
      return value;
    }
    function write(target) {
      const alias = identity(target);
      alias.bootPhase = "ready";
    }
    write(state);
  `;
  const options = {
    filePath: "js/strict_derived_alias_fixture.js",
    bindings: [{
      id: "test-file-root:state",
      kind: "test-file-root",
      name: "state",
    }],
  };

  const defaultFindings = scanStateMutations(source, options);
  const strictFindings = scanStateMutations(source, {
    ...options,
    derivedAliasTaintMode: DERIVED_ALIAS_TAINT_MODES.STRICT,
  });
  const legacyFindings = scanStateMutations(source, {
    ...options,
    derivedAliasTaintMode:
      DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  });

  assert.deepEqual(defaultFindings, strictFindings);
  assert.equal(
    strictFindings.some(
      ({ operation, key }) =>
        operation === "assign" && key === "bootPhase",
    ),
    true,
  );
  assert.equal(
    legacyFindings.some(
      ({ operation, key }) =>
        operation === "assign" && key === "bootPhase",
    ),
    false,
  );
  assert.equal(
    legacyFindings.some(
      ({ operation, reason }) =>
        operation === "unsupported"
        && reason === "state-alias-escape",
    ),
    true,
  );
});

test("immutable local callbacks remain code values across derived alias taint modes", () => {
  const source = `
    export function createController() {
      const sync = () => {
        if (runtimeState.paletteLibraryOpen) {
          consume(runtimeState.paletteLibrarySearch);
        }
      };
      const schedule = () => {
        globalThis.requestAnimationFrame(sync);
      };
      return { schedule };
    }
  `;
  const options = {
    filePath: "js/immutable_callback_fixture.js",
    bindings: [{
      id: "test-file-root:runtimeState",
      kind: "test-file-root",
      name: "runtimeState",
    }],
  };

  for (const derivedAliasTaintMode of [
    DERIVED_ALIAS_TAINT_MODES.STRICT,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  ]) {
    const findings = scanStateMutations(source, {
      ...options,
      derivedAliasTaintMode,
    });
    assert.equal(
      findings.some(
        ({ reason, evidenceKind, line }) =>
          reason === "state-alias-escape"
          && evidenceKind === "unknown-call-argument"
          && line === 9,
      ),
      false,
      JSON.stringify(findings, null, 2),
    );
  }
});

test("derived alias taint mode rejects unknown values", () => {
  assert.equal(
    normalizeDerivedAliasTaintMode(),
    DERIVED_ALIAS_TAINT_MODES.STRICT,
  );
  assert.throws(
    () => normalizeDerivedAliasTaintMode("permissive"),
    (error) =>
      error?.code === "derived-alias-taint-mode-invalid",
  );
  assert.throws(
    () =>
      scanStateMutations("state.bootPhase = 'ready';", {
        filePath: "js/unknown_taint_mode_fixture.js",
        bindings: [{
          id: "test-file-root:state",
          kind: "test-file-root",
          name: "state",
        }],
        derivedAliasTaintMode: "unknown",
      }),
    (error) =>
      error?.code === "derived-alias-taint-mode-invalid",
  );
});

test("registered action exports reject concrete mutation through non-target parameters", async () => {
  const source = `
    export function setBootStateFields(target, options, metadata, key) {
      options.bootPhase = "ready";
      metadata[key] = "ready";
      Object.assign(metadata, { bootPhase: "ready" });
      target.bootPhase = "ready";
    }
  `;

  const violations = await validateStateActionNonTargetParameterMutations(
    "js/core/state/actions/boot_actions.js",
    source,
    [{
      modulePath: "js/core/state/actions/boot_actions.js",
      exportName: "setBootStateFields",
      targetArgumentIndex: 0,
    }],
  );

  assert.deepEqual(
    violations.map(({ code, exportName, parameterName, operation, key }) => ({
      code,
      exportName,
      parameterName,
      operation,
      key,
    })),
    [
      {
        code: "state-action-non-target-parameter-mutation",
        exportName: "setBootStateFields",
        parameterName: "options",
        operation: "assign",
        key: "bootPhase",
      },
      {
        code: "state-action-non-target-parameter-mutation",
        exportName: "setBootStateFields",
        parameterName: "metadata",
        operation: "assign",
        key: "*",
      },
      {
        code: "state-action-non-target-parameter-mutation",
        exportName: "setBootStateFields",
        parameterName: "metadata",
        operation: "object-assign",
        key: "*",
      },
    ],
  );
});

test("registered action exports reject conservative container evidence through non-target parameters", async () => {
  const directContainerSource = `
    export function setBootStateFields(target, other) {
      const box = { value: other };
      box.value.bootPhase = "ready";
      target.bootPhase = "ready";
    }
  `;
  const helperContainerSource = `
    function boxValue(value) {
      return { value };
    }
    export function setBootStateFields(target, other) {
      const box = boxValue(other);
      box.value.bootPhase = "ready";
      target.bootPhase = "ready";
    }
  `;
  const directEscapeSource = `
    export function setBootStateFields(target, other) {
      consumeUnknown(other);
      target.bootPhase = "ready";
    }
  `;
  const aliasedEscapeSource = `
    export function setBootStateFields(target, other) {
      const alias = other;
      consumeUnknown(alias);
      target.bootPhase = "ready";
    }
  `;
  const contract = [{
    modulePath: "js/core/state/actions/boot_actions.js",
    exportName: "setBootStateFields",
    targetArgumentIndex: 0,
  }];

  for (const source of [
    directContainerSource,
    helperContainerSource,
    directEscapeSource,
    aliasedEscapeSource,
  ]) {
    const violations =
      await validateStateActionNonTargetParameterMutations(
        "js/core/state/actions/boot_actions.js",
        source,
        contract,
      );
    assert.ok(
      violations.some(
        ({
          code,
          parameterName,
          operation,
          reason,
          evidenceKind,
        }) =>
          code === "state-action-non-target-parameter-mutation"
          && parameterName === "other"
          && operation === "unsupported"
          && [
            "ambiguous-alias-flow",
            "state-alias-escape",
          ].includes(reason)
          && (
            reason !== "state-alias-escape"
            || evidenceKind === "unknown-call-argument"
          ),
      ),
      JSON.stringify(violations, null, 2),
    );
  }
});

test("registered action exports allow read-only value and options parameters", async () => {
  const source = `
    export function setBootStateFields(target, fields, options = {}) {
      const reason = options.reason || "unknown";
      target.bootPhase = fields.bootPhase;
      return reason;
    }
  `;

  assert.deepEqual(
    await validateStateActionNonTargetParameterMutations(
      "js/core/state/actions/boot_actions.js",
      source,
      [{
        modulePath: "js/core/state/actions/boot_actions.js",
        exportName: "setBootStateFields",
        targetArgumentIndex: 0,
      }],
    ),
    [],
  );
});

test("scenario activation action values remain provably read-only", async () => {
  const modulePath =
    "js/core/state/actions/scenario_activation_actions.js";
  const source = await readFile(
    new URL(`../${modulePath}`, import.meta.url),
    "utf8",
  );

  assert.deepEqual(
    await validateStateActionNonTargetParameterMutations(
      modulePath,
      source,
    ),
    [],
  );
});

test("renderer cache diagnostics traversal keeps the non-target value read-only", async () => {
  const modulePath = "js/core/state/actions/renderer_cache_actions.js";
  const source = await readFile(
    new URL(`../${modulePath}`, import.meta.url),
    "utf8",
  );

  assert.deepEqual(
    await validateStateActionNonTargetParameterMutations(
      modulePath,
      source,
    ),
    [],
  );
});

test("action binding discovery fails closed when a non-target parameter is mutated", async () => {
  await assert.rejects(
    discoverStateWriterBindingsForSource(
      "js/core/state/actions/boot_actions.js",
      `
        export function setBootStateFields(target, otherState, key) {
          otherState[key] = "ready";
          target.bootPhase = "ready";
        }
      `,
      "production",
      { scanAllParameters: true },
    ),
    (error) =>
      error?.code === "state-action-non-target-parameter-mutation"
      && error.violations?.[0]?.parameterName === "otherState"
      && error.violations?.[0]?.operation === "assign"
      && error.violations?.[0]?.key === "*",
  );
});
