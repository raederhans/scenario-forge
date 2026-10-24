#!/usr/bin/env node
// Bundle the editor's main-thread JavaScript for the Pages artifact.
//   node tools/build_editor_bundle.mjs --app-root <dist app dir> [--no-minify] [--sourcemap]
//
// Output: <app-root>/js/bundle/main.js plus code-split chunks, minified. Source maps are
// opt-in: they are about 3x the code size and the Pages artifact sits near its 1 GiB cap.
// Web workers (js/workers, country_label_layout_worker.js) and the classic startup worker's
// importScripts files are not bundled; the Pages build still copies the raw js/ tree for them.
// Because every bundle file sits in js/bundle/, relative `new URL("…", import.meta.url)`
// references are rewritten from their source file's location to js/bundle/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_JS = path.join(REPO_ROOT, "js");
const BUNDLE_DIR_NAME = "bundle";
// Where bundle files live relative to the raw tree, in source coordinates.
const VIRTUAL_BUNDLE_DIR = path.join(SOURCE_JS, BUNDLE_DIR_NAME);
const META_URL = /new URL\(\s*(["'])(\.{1,2}\/[^"'`$]+)\1\s*,\s*import\.meta\.url\s*\)/g;

function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function rewriteMetaUrls(source, sourceFile) {
  let count = 0;
  const code = source.replace(META_URL, (_match, quote, relative) => {
    const target = path.resolve(path.dirname(sourceFile), relative);
    let rebased = toPosix(path.relative(VIRTUAL_BUNDLE_DIR, target));
    if (!rebased.startsWith(".")) rebased = `./${rebased}`;
    count += 1;
    return `new URL(${quote}${rebased}${quote}, import.meta.url)`;
  });
  return { code, count };
}

const rebaseMetaUrlPlugin = (stats) => ({
  name: "rebase-import-meta-url",
  setup(build) {
    build.onLoad({ filter: /\.js$/ }, async (args) => {
      if (!args.path.startsWith(SOURCE_JS)) return undefined;
      const source = await fs.promises.readFile(args.path, "utf8");
      const { code, count } = rewriteMetaUrls(source, args.path);
      if (count) stats.rewrites.push({ file: toPosix(path.relative(REPO_ROOT, args.path)), count });
      return { contents: code, loader: "js" };
    });
  },
});

export async function buildEditorBundle({ appRoot, minify = true, sourcemap = false } = {}) {
  if (!appRoot) throw new Error("appRoot is required");
  const outdir = path.join(appRoot, "js", BUNDLE_DIR_NAME);
  await fs.promises.rm(outdir, { recursive: true, force: true });
  const stats = { rewrites: [] };
  const result = await esbuild.build({
    entryPoints: [path.join(SOURCE_JS, "main.js")],
    bundle: true,
    splitting: true,
    format: "esm",
    target: "es2022",
    minify,
    sourcemap: sourcemap ? "linked" : false,
    outdir,
    entryNames: "[name]",
    chunkNames: "chunk-[hash]",
    metafile: true,
    logLevel: "warning",
    // data_service.js loads its data modules (city lights) through a computed import()
    // specifier, which esbuild leaves alone; they load from the raw js/ tree at runtime.
    plugins: [rebaseMetaUrlPlugin(stats)],
  });
  const outputs = Object.entries(result.metafile.outputs)
    .filter(([file]) => file.endsWith(".js"))
    .map(([file, info]) => ({ file: toPosix(path.relative(appRoot, file)), bytes: info.bytes }));
  const entry = outputs.find((output) => output.file.endsWith(`${BUNDLE_DIR_NAME}/main.js`));
  return {
    entry: entry?.file,
    entryBytes: entry?.bytes || 0,
    totalBytes: outputs.reduce((sum, output) => sum + output.bytes, 0),
    files: outputs.length,
    inputModules: Object.keys(result.metafile.inputs).length,
    metaUrlRewrites: stats.rewrites,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const appRootIndex = args.indexOf("--app-root");
  const appRoot = appRootIndex >= 0 ? path.resolve(args[appRootIndex + 1]) : null;
  if (!appRoot) {
    console.error("usage: node tools/build_editor_bundle.mjs --app-root <dist app dir> [--no-minify] [--sourcemap]");
    process.exit(2);
  }
  buildEditorBundle({ appRoot, minify: !args.includes("--no-minify"), sourcemap: args.includes("--sourcemap") })
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
