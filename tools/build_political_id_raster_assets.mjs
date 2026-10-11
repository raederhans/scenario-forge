import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { openRasterApp, selectRasterScenario, captureRasterView } from "./political_id_raster_app_session.mjs";
import { decodePoliticalIdRasterAsset } from "../js/core/renderer/political_id_raster_assets.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!["--base-url", "--scenario", "--extend"].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error("Usage: node tools/build_political_id_raster_assets.mjs --base-url http://127.0.0.1:8008/app/ [--scenario hoi4_1939] [--extend true]");
  flags.set(process.argv[i], process.argv[i + 1]);
}
const supported = ["hoi4_1936", "hoi4_1939", "tno_1962"];
const ids = flags.has("--scenario") ? [flags.get("--scenario")] : supported;
if (ids.some(id => !supported.includes(id))) throw new Error("Unsupported raster scenario");
const baseUrl = flags.get("--base-url");
if (!baseUrl) throw new Error("--base-url is required");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function readSources(id) {
  const sources = [];
  for (const name of ["manifest.json", "detail_chunks.manifest.json", "runtime_topology.bootstrap.topo.json"]) {
    const bytes = await fs.readFile(path.join(root, "data/scenarios", id, name));
    const content = name === "manifest.json" ? (() => {
      const value = JSON.parse(bytes);
      delete value.political_id_raster_manifest_url; delete value.snapshot_fingerprint;
      return Buffer.from(JSON.stringify(value));
    })() : bytes;
    sources.push({ path: `data/scenarios/${id}/${name}`, sha256: sha(content) });
  }
  return sources;
}
if (flags.has("--extend") && !["true", "false"].includes(flags.get("--extend"))) throw new Error("--extend must be true or false");
const extend = flags.get("--extend") === "true";
const profiles = [
  ...(!extend ? [1, 2].map(dpr => ({ dpr, viewport: { width: 1280, height: 900 } })) : []),
  { dpr: 1.25, viewport: { width: 1366, height: 768 } },
  { dpr: 1.5, viewport: { width: 1440, height: 900 } },
];
for (const id of ids) {
  const assets = new Map();
  const views = [];
  const scenarioDir = path.join(root, "data/scenarios", id);
  const output = path.join(scenarioDir, "political_id_raster");
  if (extend) {
    const previous = JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8"));
    if (previous.schemaVersion !== 1 || previous.scenarioId !== id
      || JSON.stringify(previous.sources) !== JSON.stringify(await readSources(id))) throw new Error("Existing coverage has different source inputs; perform a full rebuild");
    for (const entry of previous.tiles) {
      if (!/^\.\/[a-f0-9]{64}\.pidr\.gz$/.test(entry.url)) throw new Error("Invalid existing asset path");
      const compressed = await fs.readFile(path.join(output, entry.url));
      const bytes = gunzipSync(compressed);
      if (compressed.length !== entry.compressedByteLength || bytes.length !== entry.byteLength || sha(bytes) !== entry.sha256) throw new Error("Existing asset integrity mismatch");
      assets.set(entry.identity, bytes);
    }
    views.push(...previous.coverage.views.map(view => ({ ...view, viewport: view.viewport || previous.coverage.viewport })));
  }
  for (const { dpr, viewport } of profiles) {
    const session = await openRasterApp(baseUrl, { dpr, viewport, build: true, scenarioId: id });
    try {
      await selectRasterScenario(session.page, id);
      for (const zoom of [100, 130]) {
        const captured = await captureRasterView(session.page, id, zoom);
        const view = { dpr, viewport: [viewport.width, viewport.height], zoom, level: captured.diagnostics.level, featureCount: captured.featureCount };
        const previousView = views.findIndex(entry => entry.dpr === dpr && entry.zoom === zoom
          && entry.viewport[0] === viewport.width && entry.viewport[1] === viewport.height);
        if (previousView < 0) views.push(view);
        else views[previousView] = view;
        for (const asset of captured.assets) {
          const buffer = Buffer.from(asset.base64, "base64");
          const codes = new Map();
          decodePoliticalIdRasterAsset(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), {
            identity: asset.identity, idToCode: key => { if (!codes.has(key)) codes.set(key, codes.size + 1); return codes.get(key); } });
          const previous = assets.get(asset.identity);
          if (previous && !previous.equals(buffer)) throw new Error("Producer generated conflicting bytes for the same identity");
          assets.set(asset.identity, buffer);
        }
        console.log(JSON.stringify({ scenario: id, dpr, zoom, captured: captured.assets.length, builds: captured.diagnostics.builds }));
      }
      if (session.errors.length) throw new Error(session.errors.join("\n"));
    } finally { await session.browser.close(); }
  }
  await fs.mkdir(output, { recursive: true });
  const stat = await fs.lstat(output);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Asset output must be a regular directory");
  const manifest = { schemaVersion: 1, scenarioId: id, coverage: { viewport: [1280, 900], views }, tiles: [] };
  let compressedBytes = 0;
  for (const [identity, buffer] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
    const payloadHash = sha(buffer), name = `${payloadHash}.pidr.gz`;
    const compressed = gzipSync(buffer, { level: 6 });
    await fs.writeFile(path.join(output, name), compressed);
    compressedBytes += compressed.length;
    manifest.tiles.push({ identity, url: `./${name}`, byteLength: buffer.length,
      compression: "gzip", compressedByteLength: compressed.length, sha256: payloadHash });
  }
  const retained = new Set(manifest.tiles.map(tile => tile.url.slice(2)));
  for (const entry of await fs.readdir(output, { withFileTypes: true })) {
    if (entry.isFile() && /^[0-9a-f]{64}\.pidr\.gz$/.test(entry.name) && !retained.has(entry.name)) {
      await fs.unlink(path.join(output, entry.name));
    }
  }
  const manifestPath = path.join(scenarioDir, "manifest.json");
  const scenario = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  scenario.political_id_raster_manifest_url = `data/scenarios/${id}/political_id_raster/manifest.json`;
  await fs.writeFile(manifestPath, JSON.stringify(scenario, null, 2) + "\n");
  // Startup uses the embedded manifest without fetching manifest.json again.
  // Update only this derived URL and preserve the existing source payload.
  for (const language of ["en", "zh"]) {
    const bundlePath = path.join(scenarioDir, `startup.bundle.${language}.json`);
    const bundle = JSON.parse(await fs.readFile(bundlePath, "utf8"));
    bundle.manifest_subset.political_id_raster_manifest_url = scenario.political_id_raster_manifest_url;
    const bytes = Buffer.from(JSON.stringify(bundle));
    await fs.writeFile(bundlePath, bytes);
    await fs.writeFile(`${bundlePath}.gz`, gzipSync(bytes, { level: 9 }));
  }
  const refreshed = spawnSync(process.execPath, [path.join(root, "tools/run_python.mjs"),
    path.join(root, "tools/refresh_political_id_raster_snapshot.py"), "--scenario", id],
  { cwd: root, stdio: "inherit" });
  if (refreshed.error || refreshed.status !== 0) throw new Error(`Scenario snapshot refresh failed: ${id}`, { cause: refreshed.error });
  manifest.sources = await readSources(id);
  await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ scenario: id, tiles: manifest.tiles.length, compressedBytes, output }));
}
