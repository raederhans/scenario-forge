import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { parse } from "acorn";
import { full } from "acorn-walk";

export const POLITICAL_GPU_RESOURCE_PATH = "js/core/renderer/political_id_raster_gpu.js";
const ownerPath = "js/core/renderer/political_id_raster_runtime_owner.js";
const rendererPath = "js/core/map_renderer.js";
const sourceFingerprints = Object.freeze({
  [POLITICAL_GPU_RESOURCE_PATH]: "2bd9aff67ea2176bb9a50849305772a87e46a70074b4d2fc592f3206c3bdd7cf",
  [ownerPath]: "9cfbc65be28984a80dd30999d2febf7abcb84d0998901d6e4b9cfb5daeb41f50",
  [rendererPath]: "f8a43c8a280d0e63cfbfeb010747181713534ac3a6230a7a0f806d671e6a4855",
});
// Existing computed import providers have finite module sets: deferred UI's
// literal list and data_service's two-path guard. Pin the complete providers;
// any new computed importer fails the resource proof.
const finiteImportProviders = Object.freeze({
  "js/bootstrap/deferred_ui_bootstrap.js": "090b0648dbafa5641d31fe84ff8f401729c0abb72fa0179499782ef0895dee3c",
  "js/core/data_service.js": "fdd0a319afb2a141fcbfeb21f83b4991406eac0c5e5a23a53faf8dadd52bdce1",
});
const fingerprint = (source) => createHash("sha256").update(String(source).replace(/\r\n?/g, "\n")).digest("hex");
const parseModule = (source) => parse(source, { ecmaVersion: "latest", sourceType: "module" });
const topFunction = (ast, name) => ast.body.map((node) => node.declaration || node)
  .find((node) => node.type === "FunctionDeclaration" && node.id?.name === name);
const property = (object, name) => object?.properties?.find((node) => !node.computed && node.key?.name === name);
const callsNamed = (node, name) => {
  const calls = [];
  full(node, (entry) => { if (entry.type === "CallExpression" && entry.callee?.name === name) calls.push(entry); });
  return calls;
};

function productionSourcePaths(directory = "js") {
  return readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? productionSourcePaths(`${directory}/${entry.name}`)
      : /\.(?:m?js)$/i.test(entry.name) ? [`${directory}/${entry.name}`] : []);
}

// A resource origin proof for exactly one factory parameter. This does not
// classify GPU methods or callbacks as pure and does not suppress their scans.
export function inspectPoliticalGpuResourceOrigin({
  source,
  readSource = (modulePath) => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
  sourcePaths = productionSourcePaths(),
} = {}) {
  const violations = [];
  const sources = new Map();
  const read = (file) => {
    if (!sources.has(file)) sources.set(file, file === POLITICAL_GPU_RESOURCE_PATH && source !== undefined ? source : readSource(file));
    return sources.get(file);
  };
  try {
    for (const [file, expected] of Object.entries(sourceFingerprints)) {
      if (fingerprint(read(file)) !== expected) violations.push({ code: "resource-origin-source-drift", modulePath: file });
    }
    if (violations.length) return { violations, binding: null };
    const gpu = topFunction(parseModule(read(POLITICAL_GPU_RESOURCE_PATH)), "createPoliticalIdRasterGpu");
    const canvas = property(gpu?.params[0]?.left, "canvas")?.value;
    if (canvas?.type !== "AssignmentPattern" || canvas.left?.name !== "canvas"
      || canvas.right?.type !== "NewExpression" || canvas.right.callee?.name !== "OffscreenCanvas"
      || canvas.right.arguments.length !== 2 || canvas.right.arguments.some((arg) => arg.type !== "Literal" || arg.value !== 1)) {
      violations.push({ code: "resource-origin-default-canvas-invalid" });
    }
    const owner = topFunction(parseModule(read(ownerPath)), "createPoliticalIdRasterRuntimeOwner");
    const provider = property(owner?.params[0], "createGpu")?.value;
    const calls = callsNamed(owner, "createGpu");
    const options = calls[0]?.arguments[0];
    if (provider?.type !== "AssignmentPattern" || provider.right?.name !== "createPoliticalIdRasterGpu"
      || calls.length !== 1 || calls[0].arguments.length !== 1 || options?.type !== "ObjectExpression"
      || options.properties.length !== 1 || !property(options, "onContextLost")) {
      violations.push({ code: "resource-origin-gpu-provider-invalid" });
    }
    const composition = topFunction(parseModule(read(rendererPath)), "getPoliticalIdRasterRuntimeOwner");
    const owners = callsNamed(composition, "createPoliticalIdRasterRuntimeOwner");
    if (owners.length !== 1 || owners[0].arguments.length !== 1 || owners[0].arguments[0]?.type !== "ObjectExpression"
      || owners[0].arguments[0].properties.some((node) => node.type !== "Property" || node.computed || node.key?.name === "createGpu")) {
      violations.push({ code: "resource-origin-owner-provider-invalid" });
    }
    const edges = [];
    for (const file of sourcePaths) {
      const text = read(file);
      if (Object.hasOwn(finiteImportProviders, file)) {
        if (fingerprint(text) !== finiteImportProviders[file]) violations.push({ code: "resource-origin-dynamic-provider-drift", modulePath: file });
        continue;
      }
      // Module specifiers may encode every character of a target name. Inspect
      // all import/re-export nodes rather than filtering their original bytes.
      full(parseModule(text), (node) => {
        const specifier = node.type === "ImportExpression" ? node.source
          : ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) ? node.source : null;
        if (!specifier) return;
        const value = specifier.type === "Literal" ? specifier.value : null;
        if (typeof value !== "string") {
          if (node.type === "ImportExpression") {
            violations.push({ code: "resource-origin-dynamic-consumer-unresolved", modulePath: file });
          }
          return;
        }
        let pathname;
        try {
          // Strip URL suffixes before decoding once: encoded ?/# are pathname
          // data. Backslashes have URL separator semantics that POSIX lacks.
          pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
          if (/[\\\u0000-\u001f\u007f]/.test(pathname)) throw new Error("Invalid module pathname");
        } catch (_error) {
          violations.push({ code: "resource-origin-consumer-path-invalid", modulePath: file });
          return;
        }
        const target = pathname.startsWith(".")
          ? posix.normalize(posix.join(posix.dirname(file), pathname))
          : pathname.startsWith("/") ? posix.normalize(pathname).slice(1) : "";
        // Windows can resolve differently cased URLs to the same implementation.
        // Folding is only for detecting protected consumers; source/provider
        // fingerprints and the existing edge set still control admission.
        const protectedTarget = target.toLowerCase();
        if ([POLITICAL_GPU_RESOURCE_PATH, ownerPath].includes(protectedTarget)) {
          const expectedName = protectedTarget === ownerPath ? "createPoliticalIdRasterRuntimeOwner" : "createPoliticalIdRasterGpu";
          if (node.type !== "ImportDeclaration" || node.specifiers.length !== 1
            || node.specifiers[0].type !== "ImportSpecifier" || node.specifiers[0].imported?.name !== expectedName
            || node.specifiers[0].local?.name !== expectedName) {
            violations.push({ code: "resource-origin-consumer-shape-invalid", modulePath: file });
          }
          edges.push(`${file}->${protectedTarget}`);
        } else if (/political_id_raster_(?:gpu|runtime_owner)/i.test(pathname)) {
          violations.push({ code: "resource-origin-consumer-path-unresolved", modulePath: file });
        }
      });
    }
    if (JSON.stringify(edges.sort()) !== JSON.stringify([
      `${ownerPath}->${POLITICAL_GPU_RESOURCE_PATH}`, `${rendererPath}->${ownerPath}`,
    ].sort())) violations.push({ code: "resource-origin-consumer-set-drift" });
  } catch (error) {
    violations.push({ code: "resource-origin-proof-unavailable", message: error.message });
  }
  return { violations, binding: violations.length ? null : {
    functionName: "createPoliticalIdRasterGpu", parameterIndex: 0, parameterPath: "$/property:canvas", parameterName: "canvas",
  } };
}
