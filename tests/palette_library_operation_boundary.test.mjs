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

// 乙类：applyPaletteLibraryColor 是 toolbar 工厂内的闭包，尚无可直接导入的入口，暂时截取执行。
test("toolbar palette apply wrapper gives recent-color, swatch, render and toast feedback per result", () => {
  const source = readFileSync(new URL("js/ui/toolbar.js", ROOT), "utf8");
  const ast = parseModule("js/ui/toolbar.js");
  let applyWrapper = null;
  walk(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier"
      && node.id.name === "applyPaletteLibraryColor") {
      applyWrapper = node.init;
    }
  });
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
