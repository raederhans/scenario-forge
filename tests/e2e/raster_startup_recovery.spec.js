const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile, readdir } = require("node:fs/promises");
const path = require("node:path");
const { test } = require("@playwright/test");
let openRasterApp, isTransientRasterModuleFailure, cleanup;
test.beforeAll(async () => {
  ({ openRasterApp, isTransientRasterModuleFailure } = await import("../../tools/political_id_raster_app_session.mjs"));
});
test.beforeEach(() => { cleanup = []; });
test.afterEach(async () => { for (const close of cleanup.reverse()) await close(); });

// Exercise the real browser module map without loading map data or the GPU.
async function fixture(t, moduleResponse, dependencyResponse = null) {
  let requests = 0;
  const documents = [];
  const server = createServer((request, response) => {
    if (request.url.startsWith("/app/?")) documents.push(request.url);
    if (request.url === "/app/js/core/map_renderer.js") {
      requests++;
      const { status = 200, type = "text/javascript", body = "export const renderer = true;" } = moduleResponse(requests);
      response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "Retry-After": "0" });
      response.end(body);
    } else if (request.url === "/app/js/core/dependency.js" && dependencyResponse) {
      const { status = 200, body = "export const dependency = true;" } = dependencyResponse(requests);
      response.writeHead(status, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end(body);
    } else if (request.url === "/app/js/core/state.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end('export const state = {bootPhase:"ready", startupReadonly:false, startupReadonlyUnlockInFlight:false, scenarioApplyInFlight:false};');
    } else if (request.url === "/app/js/core/scenario_manager.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end("export const scenarios = true;");
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>Module startup fixture</title>");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise(resolve => server.close(resolve)));
  const output = t.outputPath("startup");
  return {
    url: `http://127.0.0.1:${server.address().port}/app/`, output,
    requests: () => requests,
    documents: () => [...documents],
    diagnostics: async () => Promise.all((await readdir(output)).filter(name => name.endsWith(".json"))
      .map(async name => JSON.parse(await readFile(path.join(output, name), "utf8")))),
  };
}

test("native reference startup explicitly opts out of default raster rendering", async ({}, t) => {
  const f = await fixture(t, () => ({}));
  const { createRasterIntegrationCheck } = await import("../../tools/verify_political_id_raster_integration.mjs");
  const check = await createRasterIntegrationCheck({ baseUrl: f.url, scenarioId: "fixture", output: f.output });
  cleanup.push(() => check.close());
  assert.equal(f.documents().length, 1);
  assert.equal(new URL(f.documents()[0], f.url).searchParams.get("political_id_raster"), "0");
});

test("public raster startup recovers one evidenced module 503 in a fresh context and keeps its trace", async ({}, t) => {
  const f = await fixture(t, count => count === 1 ? { status: 503, body: "temporary service failure" } : {});
  const session = await openRasterApp(f.url, { published: true, startupOutput: f.output });
  cleanup.push(() => session.browser.close());
  assert.equal(f.requests(), 2);
  assert.deepEqual(session.errors, []);
  assert.equal(session.startupAttempts.length, 1);
  assert.equal(session.startupAttempts[0].willRetry, true);
  const [failure] = await f.diagnostics();
  assert.equal(failure.phase, "module-import");
  assert.equal(failure.network.find(entry => entry.status === 503).resourceType, "script");
  assert.ok((await readdir(f.output)).some(name => name.endsWith(".zip")));
});

test("startup recovers an evidenced dependency 503 even when the root module returned 200", async ({}, t) => {
  const f = await fixture(t, () => ({ body: 'import "./dependency.js"; export const renderer = true;' }),
    count => count === 1 ? { status: 503 } : {});
  const session = await openRasterApp(f.url, { published: true, startupOutput: f.output });
  cleanup.push(() => session.browser.close());
  assert.equal(f.requests(), 2);
  assert.equal(session.startupAttempts.length, 1);
  assert.deepEqual(session.errors, []);
  const [failure] = await f.diagnostics();
  assert.equal(failure.network.find(entry => entry.url.endsWith("map_renderer.js")).status, 200);
  assert.equal(failure.network.find(entry => entry.url.endsWith("dependency.js")).status, 503);
});

test("persistent module 503 fails after exactly two attempts with both failures preserved", async ({}, t) => {
  const f = await fixture(t, () => ({ status: 503 }));
  await assert.rejects(openRasterApp(f.url, { published: true, startupOutput: f.output }), error => {
    assert.equal(error.rasterStartupDiagnostics.length, 2);
    assert.equal(error.rasterStartupDiagnostics[1].willRetry, false);
    return /Failed to fetch dynamically imported module/.test(error.message);
  });
  assert.equal(f.requests(), 2);
  assert.equal((await f.diagnostics()).length, 2);
});

for (const [name, response] of [
  ["404", { status: 404 }],
  ["invalid MIME", { type: "text/html" }],
  ["evaluation error", { body: 'throw new Error("fixture evaluation failure");' }],
  ["syntax error", { body: "export const = ;" }],
]) {
  test(`public raster startup does not retry ${name}`, async ({}, t) => {
    const f = await fixture(t, () => response);
    await assert.rejects(openRasterApp(f.url, { published: true, startupOutput: f.output }));
    assert.equal(f.requests(), 1);
    const [failure] = await f.diagnostics();
    assert.equal(failure.willRetry, false);
    assert.ok(failure.errors.length > 0 || failure.error);
  });
}

test("local raster checks keep their original single attempt", async ({}, t) => {
  const f = await fixture(t, () => ({ status: 503 }));
  await assert.rejects(openRasterApp(f.url, { startupOutput: f.output }));
  assert.equal(f.requests(), 1);
});

test("startup recovery requires same-origin module HTTP evidence in the import phase", () => {
  const url = "https://raederhans.github.io/scenario-forge/app/";
  const moduleUrl = `${url}js/core/map_renderer.js`;
  const error = new Error(`Failed to fetch dynamically imported module: ${moduleUrl}`);
  const transient = { url: moduleUrl, status: 503, resourceType: "script" };
  const evidence = { published: true, phase: "module-import", url, network: [transient] };
  assert.equal(isTransientRasterModuleFailure(error, evidence), true);
  for (const changes of [
    { network: [] },
    { published: false },
    { phase: "startup-ready" },
    { network: [{ ...transient, url: "https://other.test/js/module.js" }] },
    { network: [{ ...transient, url: `${url}data/asset.js`, resourceType: "fetch" }] },
    { network: [{ ...transient, status: "failed", errorText: "net::ERR_CONNECTION_RESET" }] },
    { network: [{ ...transient, status: 500 }] },
    { network: [{ ...transient, headers: { "retry-after": "30" } }] },
    { network: [transient, { ...transient, url: `${url}js/missing.js`, status: 404 }] },
  ]) assert.equal(isTransientRasterModuleFailure(error, { ...evidence, ...changes }), false, JSON.stringify(changes));
});
