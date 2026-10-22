import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";

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
