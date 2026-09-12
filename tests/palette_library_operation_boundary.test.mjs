import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import {
  discoverFunctionParameterBindings,
  scanStateMutations,
} from "../tools/state_writer_inventory.mjs";

const ROOT = new URL("../", import.meta.url);

function parseModule(relativePath) {
  return parse(readFileSync(new URL(relativePath, ROOT), "utf8"), {
    ecmaVersion: "latest",
    sourceType: "module",
  });
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

function importedNames(ast, source) {
  const declaration = ast.body.find((node) => (
    node.type === "ImportDeclaration" && node.source.value === source
  ));
  return new Set((declaration?.specifiers || []).map((specifier) => specifier.imported?.name || specifier.local.name));
}

function parameterBinding(source, functionName, parameterName) {
  const binding = discoverFunctionParameterBindings(source, { parameterNames: null }).bindings
    .find((candidate) => (
      candidate.functionName === functionName && candidate.parameterName === parameterName
    ));
  assert.ok(binding, `missing ${functionName}:${parameterName} state-writer binding`);
  return {
    id: `${functionName}:${parameterName}`,
    kind: "function-parameter",
    name: binding.parameterName,
    functionName: binding.functionName,
    parameterName: binding.parameterName,
    parameterIndex: binding.parameterIndex,
    parameterPath: binding.parameterPath,
    locator: { line: binding.line, column: binding.column },
  };
}

function scanParameter(source, filePath, functionName, parameterName) {
  return scanStateMutations(source, {
    filePath,
    bindings: [parameterBinding(source, functionName, parameterName)],
  });
}

test("palette operation receives capabilities without a state binding or UI/renderer dependencies", () => {
  const filePath = "js/core/palette_library_operation.js";
  const source = readFileSync(new URL(filePath, ROOT), "utf8");
  const ast = parseModule(filePath);
  const bindings = discoverFunctionParameterBindings(source, { parameterNames: null }).bindings;
  assert.equal(bindings.some(({ parameterName }) => /^(?:state|runtimeState|appState)$/.test(parameterName)), false);
  const forbiddenImports = ast.body
    .filter((node) => node.type === "ImportDeclaration")
    .map((node) => String(node.source.value))
    .filter((source) => source.includes("/ui/") || source.includes("map_renderer") || source.includes("state"));
  assert.deepEqual(forbiddenImports, []);
});

test("palette state access delegates writes and rejects unrelated state mutations", () => {
  const filePath = "js/core/palette_library_state_access.js";
  const source = readFileSync(new URL(filePath, ROOT), "utf8");
  const ast = parseModule(filePath);
  assert.deepEqual(scanParameter(source, filePath, "createPaletteLibraryStateAccess", "state"), []);
  const factory = ast.body.find((node) => node.type === "ExportNamedDeclaration"
    && node.declaration?.type === "FunctionDeclaration").declaration;
  const insertionPoint = factory.body.start + 1;
  const illegalSource = source.slice(0, insertionPoint) + "\nstate.ui = {};\n" + source.slice(insertionPoint);
  assert.equal(
    scanParameter(illegalSource, filePath, "createPaletteLibraryStateAccess", "state")
      .some(({ key }) => key === "ui"),
    true,
  );
});

test("palette facade delegates compatible colors and selection mode to their state owners", () => {
  const filePath = "js/core/state/actions/palette_library_actions.js";
  const source = readFileSync(new URL(filePath, ROOT), "utf8");
  const ast = parseModule(filePath);
  const facadeFindings = [
    "selectPalettePaintColorState",
    "applyPaletteFeatureColorState",
    "applyPaletteOwnerColorState",
  ].flatMap((functionName) => scanParameter(source, filePath, functionName, "target"));
  assert.deepEqual(facadeFindings, []);
  const activationPath = "js/core/state/actions/scenario_activation_actions.js";
  const activationSource = readFileSync(new URL(activationPath, ROOT), "utf8");
  const findings = ["applyPaletteFeatureColorState", "applyPaletteOwnerColorState"]
    .flatMap((functionName) => scanParameter(activationSource, activationPath, functionName, "target"));
  assert.deepEqual(
    new Set(findings.map(({ key }) => key)),
    new Set([
      "visualOverrides",
      "featureOverrides",
      "sovereignBaseColors",
      "countryBaseColors",
    ]),
  );
  const presentationPath = "js/core/state/actions/scenario_presentation_actions.js";
  const presentationSource = readFileSync(new URL(presentationPath, ROOT), "utf8");
  assert.deepEqual(
    new Set(scanParameter(presentationSource, presentationPath, "selectPaletteVisualPaintModeState", "target").map(({ key }) => key)),
    new Set(["paintMode"]),
  );
  assert.deepEqual(importedNames(ast, "./scenario_activation_actions.js"),
    new Set(["applyPaletteFeatureColorState", "applyPaletteOwnerColorState"]));
  assert.deepEqual(importedNames(ast, "./scenario_presentation_actions.js"),
    new Set(["selectPaletteVisualPaintModeState"]));
  assert.deepEqual(
    importedNames(ast, "./appearance_selection_actions.js"),
    new Set(["setSelectedColorState"]),
  );
});

test("palette panel feedback delegates UI state and the scanner rejects a direct UI write", () => {
  const filePath = "js/ui/toolbar/palette_library_panel.js";
  const source = readFileSync(new URL(filePath, ROOT), "utf8");
  const productionFindings = scanParameter(
    source,
    filePath,
    "selectPalettePaintColor",
    "appState",
  );
  assert.deepEqual(
    productionFindings.filter(({ key }) => key !== "*"),
    [],
    "panel feedback may invoke its registered UI hook but must not write a UI state path directly",
  );
  const illegalSource = source.replace(
    "patchUiChromeState(appState, { politicalEditingExpanded: false }, { normalizeExisting: false });",
    "appState.ui.politicalEditingExpanded = false;",
  );
  assert.equal(
    scanParameter(illegalSource, filePath, "selectPalettePaintColor", "appState")
      .some(({ key }) => key === "ui"),
    true,
  );
});

test("toolbar composes the palette operation instead of owning target queries or color transactions", () => {
  const source = readFileSync(new URL("js/ui/toolbar.js", ROOT), "utf8");
  const ast = parseModule("js/ui/toolbar.js");
  assert.equal(
    importedNames(ast, "../core/palette_library_operation.js").has("createPaletteLibraryOperation"),
    true,
  );

  const forbiddenDefinitions = new Set([
    "getFeatureIdsForOwnerColorRefresh",
    "resolvePaletteLibraryApplyTarget",
  ]);
  const defined = new Set();
  let operationFactoryCalls = 0;
  let applyWrapper = null;
  walk(ast, (node) => {
    if (node.type === "FunctionDeclaration" && node.id) defined.add(node.id.name);
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      defined.add(node.id.name);
      if (node.id.name === "applyPaletteLibraryColor") applyWrapper = node.init;
    }
    if (node.type === "CallExpression" && node.callee?.type === "Identifier"
      && node.callee.name === "createPaletteLibraryOperation") {
      operationFactoryCalls += 1;
    }
  });

  assert.deepEqual([...forbiddenDefinitions].filter((name) => defined.has(name)), []);
  assert.equal(operationFactoryCalls, 1);
  assert.ok(applyWrapper, "toolbar must keep one UI feedback wrapper for palette apply results");

  const execute = (result) => {
    const calls = [];
    const context = {
      applyPaletteLibraryOperation: (rawColor) => {
        calls.push(["operation", rawColor]);
        return result;
      },
      addRecentColor: (color) => calls.push(["recent", color]),
      updateSwatchUI: () => calls.push(["swatch"]),
      render: () => calls.push(["render"]),
      showToast: (...args) => calls.push(["toast", ...args]),
      t: (message) => message,
    };
    const apply = vm.runInNewContext(`(${source.slice(applyWrapper.start, applyWrapper.end)})`, context);
    return { result: apply("#AABBCC"), calls };
  };

  assert.deepEqual(execute({ status: "applied", color: "#aabbcc", target: {} }), {
    result: true,
    calls: [
      ["operation", "#AABBCC"],
      ["recent", "#aabbcc"],
      ["swatch"],
      ["render"],
    ],
  });
  const noTarget = execute({ status: "no-target" });
  assert.equal(noTarget.result, false);
  assert.deepEqual(noTarget.calls.map((call) => call[0]), ["operation", "toast"]);
  assert.deepEqual(execute({ status: "invalid-color" }), {
    result: false,
    calls: [["operation", "#AABBCC"]],
  });
});
