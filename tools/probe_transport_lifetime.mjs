import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportArgument = process.argv.indexOf("--report");
const directoryArgument = process.argv.indexOf("--report-dir");
if ((reportArgument >= 0) === (directoryArgument >= 0)) throw new Error("Use exactly one of --report or --report-dir under .runtime");
const argument = reportArgument >= 0 ? reportArgument : directoryArgument;
if (!process.argv[argument + 1]) throw new Error("Report path is required");
const selectedPath = path.resolve(root, process.argv[argument + 1]);
const reportPath = reportArgument >= 0 ? selectedPath : path.join(selectedPath, `canonical-road-${randomUUID()}.json`);
const runtimeRoot = path.join(root, ".runtime");
if (!reportPath.startsWith(runtimeRoot + path.sep) || fs.existsSync(reportPath)) throw new Error("Report must be a new .runtime file");
for (let current = path.dirname(reportPath); current !== root; current = path.dirname(current)) {
  if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink report parents are forbidden");
}
await fsp.mkdir(path.dirname(reportPath), { recursive: true });
const requests = [], httpErrors = [], browserErrors = [], consoleIssues = [], failedRequests = [];
const report = { kind: "canonical-road-lifetime-probe", status: "running", dataClass: "committed-canonical-not-local-precision-candidate",
  pressureClass: "explicit-synthetic-ledger-pressure", productionActions: false, samples: [] };
const server = http.createServer(async (request, response) => {
  try {
    const route = new URL(request.url, "http://127.0.0.1").pathname;
    requests.push(route);
    if (route === "/") {
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end('<!doctype html><base href="/"><link rel="icon" href="data:,"><div id="carrier" style="width:1200px;height:850px"></div><script src="/vendor/d3.v7.min.js"></script><script src="/vendor/topojson-client.min.js"></script>');
      return;
    }
    if (!/^\/(js|vendor|data|css)\//.test(route)) throw new Error("Unsupported probe path");
    const target = path.resolve(root, "." + decodeURIComponent(route));
    if (!target.startsWith(root + path.sep) || !(await fsp.stat(target)).isFile()) throw new Error("Missing probe file");
    const types = { ".js": "text/javascript", ".json": "application/json", ".geojson": "application/json", ".css": "text/css", ".gz": "application/gzip" };
    response.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(target).pipe(response);
  } catch (error) {
    httpErrors.push({ path: request.url, error: String(error) });
    response.writeHead(404); response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("console", (message) => { if (["warning", "error"].includes(message.type())) consoleIssues.push(message.text()); });
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.samples = await page.evaluate(async () => {
    const road = await import("/js/ui/transport_workbench_road_preview.js");
    const carrier = await import("/js/ui/transport_workbench_carrier.js");
    const { pageResourceBudget } = await import("/js/core/runtime_resource_budget.js");
    const manifestResponse = await fetch("/data/transport_layers/japan_road/manifest.json");
    if (!manifestResponse.ok) throw new Error("Canonical manifest unavailable");
    const manifest = await manifestResponse.json();
    await carrier.ensureTransportWorkbenchCarrierForManifest(manifest, document.querySelector("#carrier"));
    const baseline = pageResourceBudget.snapshot();
    const pressureOwner = Symbol("probe-only-pressure");
    pageResourceBudget.update(pressureOwner, { workerGeometry: baseline.softLimitBytes });
    const config = { roadClass: ["motorway", "trunk", "primary"], minProjectedSegmentPx: 0,
      zoomGate: "loose", strokePreset: "corridor", showRefs: false };
    const rows = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      const started = performance.now();
      const snapshot = await road.renderJapanRoadPreview(config);
      if (!snapshot || snapshot.status !== "ready" || snapshot.lifetime.retainedPackCount !== 1
          || !snapshot.stats.totalRoads || !snapshot.stats.visibleRoads || !(snapshot.lifetime.estimatedPackBytes > 0)) {
        throw new Error("Canonical preview was not loaded/rendered/accounted");
      }
      const svgCount = document.querySelectorAll('[data-road-id]').length;
      if (!svgCount) throw new Error("No actual road SVG paths were drawn");
      const ids = snapshot.dataRows.map((row) => row.id);
      if (ids.length && !road.selectJapanRoadPreviewFeature(ids[0])) throw new Error("Real road selection failed");
      rows.push({ cycle, stage: "visible", elapsedMs: performance.now() - started, snapshot, svgCount });
      road.clearJapanRoadPreview();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const hidden = road.getJapanRoadPreviewSnapshot();
      if (hidden.lifetime.retainedPackCount !== 0 || hidden.lifetime.estimatedPackBytes !== 0
          || document.querySelectorAll('[data-road-id]').length) throw new Error("Hidden road payload or SVG references survived");
      rows.push({ cycle, stage: "hidden", snapshot: hidden });
    }
    road.destroyJapanRoadPreview();
    carrier.destroyTransportWorkbenchCarrier();
    pageResourceBudget.release(pressureOwner);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = pageResourceBudget.snapshot();
    if (after.estimatedBytes !== baseline.estimatedBytes || after.ownerCount !== baseline.ownerCount) {
      throw new Error("Owned road/request reservations did not return to their baseline");
    }
    rows.push({ stage: "released", baseline, after, declaredPreviewRoads: manifest.feature_counts.preview.roads,
      sourceSignature: manifest.source_signature, recipePath: manifest.recipe_path, carrierScope: manifest.extensions?.carrier?.scope_policy });
    return rows;
  });
  assert.equal(requests.filter((url) => url === "/data/transport_layers/japan_road/roads.topo.json").length, 0,
    "shared pressure must prevent speculative full-road download");
  assert.equal(requests.some((url) => url.endsWith("/core/map_renderer.js")), false,
    "the isolated road consumer must not import the political renderer");
  assert.deepEqual(httpErrors, []); assert.deepEqual(browserErrors, []);
  assert.deepEqual(consoleIssues, []); assert.deepEqual(failedRequests, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = String(error);
  process.exitCode = 1;
} finally {
  report.requests = requests;
  Object.assign(report, { httpErrors, browserErrors, consoleIssues, failedRequests });
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(JSON.stringify({ status: report.status, report: path.relative(root, reportPath), error: report.error }));
}
