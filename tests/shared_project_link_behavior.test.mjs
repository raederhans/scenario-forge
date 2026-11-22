import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "../vendor/fflate.browser.js";
import { initializeSharedProjectLink, openStartupSharedProject } from "../js/bootstrap/startup_shared_project_link.js";
import { buildShareLink, getSharedProjectLinkFromUrl, validateSharedProjectUrl } from "../js/core/shared_project_url.js";
import { createDefaultBootState } from "../js/core/state/boot_state.js";
import { resolveStartupScenarioId } from "../js/bootstrap/startup_data_pipeline.js";
import { createSampleProjectBannerController } from "../js/ui/toolbar/sample_project_banner_controller.js";
import { markDirty } from "../js/core/dirty_state.js";
import { state as runtimeState } from "../js/core/state.js";
import { registerOwnedRuntimeHook } from "../js/core/state/index.js";
import { importProjectThroughFunnel } from "../js/core/interaction_funnel.js";

const raw = "https://example.test/p.json";

test("share links require an absolute public HTTPS address", () => {
  for (const invalid of ["", "p.json", "javascript:alert(1)", "data:,test", "http://example.test/p",
    "https://user:pw@example.test/p", "https://localhost:8080/p", "https://localhost./p",
    "https://service.local./p", "https://127.1/p", "https://0x7f000001/p", "https://[::1]/p",
    "https://example.test/" + "a".repeat(2048)]) {
    assert.throws(() => validateSharedProjectUrl(invalid));
    assert.throws(() => buildShareLink(invalid, "", "https://app.test/"));
  }
  const source = raw + "?key=a%26b";
  const link = new URL(buildShareLink(source, "tno_1962", "https://app.test/app/?sample=old#panel"));
  assert.deepEqual([...link.searchParams], [["project", source], ["default_scenario", "tno_1962"]]);
  assert.equal(getSharedProjectLinkFromUrl(link.search), source);
});

function setup(t, rawUrl = raw, state = createDefaultBootState()) {
  const location = new URL("https://app.test/app/?sample=test&sample_project=old&default_scenario=blank_base&tab=project#panel");
  location.searchParams.set("project", rawUrl);
  const history = { state: { tab: 1 }, replaceState(value, _, href) {
    assert.equal(value, history.state);
    location.href = href;
  } };
  globalThis.location = location;
  globalThis.history = history;
  t.after(() => { delete globalThis.location; delete globalThis.history; });
  Object.assign(state, { bootPhase: "ready", uiHydrationStatus: "ready" });
  const request = initializeSharedProjectLink(state);
  assert.equal(location.searchParams.has("sample"), false);
  assert.equal(location.searchParams.has("sample_project"), false);
  return { state, location, open: options => openStartupSharedProject(state, request, options) };
}

function response(body, { url = raw, ...init } = {}) {
  const result = new Response(body, init);
  Object.defineProperty(result, "url", { value: url });
  return result;
}
const accept = async () => true;

test("URL scenarios must exist in the registry and a shared link preserves the remembered preference", async t => {
  const { location } = setup(t);
  const registry = { default_scenario_id: "modern_world", scenarios: [
    { scenario_id: "modern_world" }, { scenario_id: "blank_base" },
  ] };
  const removeItem = t.mock.fn();
  globalThis.localStorage = { getItem: () => "retired", removeItem };
  t.after(() => { delete globalThis.localStorage; });
  assert.equal(await resolveStartupScenarioId(registry), "blank_base");
  location.searchParams.set("default_scenario", "../unknown");
  assert.equal(await resolveStartupScenarioId(registry), "modern_world");
  assert.equal(removeItem.mock.callCount(), 0);
});

test("invalid links are cleared without a prompt or request", async t => {
  const { open, location } = setup(t, "https://localhost/private");
  const showAppDialog = t.mock.fn();
  const fetchImpl = t.mock.fn();
  const result = await open({ showAppDialog, fetchImpl });
  assert.equal(result.errorCode, "invalid-url");
  assert.equal(location.searchParams.has("project"), false);
  assert.equal(showAppDialog.mock.callCount() + fetchImpl.mock.callCount(), 0);
});

test("only starts when both surfaces are ready, waits for consent, and cleans only the startup query", async t => {
  const { open, state, location } = setup(t);
  const fetchImpl = t.mock.fn();
  const options = { fetchImpl, showAppDialog: t.mock.fn(() => false) };
  state.bootPhase = "shell";
  await open(options);
  state.bootPhase = "ready";
  state.uiHydrationStatus = "pending";
  await open(options);
  assert.equal(options.showAppDialog.mock.callCount(), 0);
  state.uiHydrationStatus = "ready";
  state.isDirty = true;
  let decide, dialogShown;
  const shown = new Promise(resolve => { dialogShown = resolve; });
  const pending = open({ fetchImpl, showAppDialog(dialog) {
    assert.match(dialog.message, /example\.test/);
    assert.match(dialog.details, /unsaved|未保存/i);
    dialogShown();
    return new Promise(resolve => { decide = resolve; });
  } });
  assert.equal(state.sharedProjectLink.status, "confirming");
  assert.equal(fetchImpl.mock.callCount(), 0);
  await open(options);
  await shown;
  decide(false);
  await pending;
  assert.equal(fetchImpl.mock.callCount(), 0);
  assert.equal(state.sharedProjectLink.status, "cancelled");
  assert.equal(location.search + location.hash, "?tab=project#panel");
});

for (const [label, body, code] of [
  ["ordinary JSON", '{"message":"File moved"}', "not-project"],
  ["ordinary JSON in a package", zipSync({ "map_project.json": strToU8('{"message":"File moved"}') }), "not-project"],
  ["HTML", "<html>sign in", "not-project"],
  ["invalid UTF-8", Uint8Array.of(123, 34, 255, 34, 58, 49, 125), "not-project"],
  ["nested prototype pollution key", '{"layers":[{"__proto__":1}]}', "unsafe-project-keys"],
  ["unsafe record key", '{"visualOverrides":{"constructor":1}}', "unsafe-project-keys"],
  ["unsafe legacy record key", '{"colors":{"prototype":1}}', "unsafe-project-keys"],
  ["unsafe river cell key", '{"riverPaint":{"overrides":{"constructor":1}}}', "unsafe-project-keys"],
  ["depth", '{"items":' + "[".repeat(65) + "1" + "]".repeat(65) + "}", "too-large"],
  ["node count", '{"items":[1,2,3]}', "too-large"],
  ["HGO", '{"format":"scenario-forge-hgo"}', "hgo-project"],
  ["legacy HGO", '{"scenario":{"id":"hgo_1936"}}', "hgo-project"],
  ["invalid ZIP", Uint8Array.of(80, 75, 3, 4), "not-project"],
  ["ZIP with too many entries", zipSync(Object.fromEntries(Array.from({ length: 129 }, (_, i) => [
    `file${i}`, new Uint8Array(),
  ]))), "too-large"],
]) {
  test(label + " is rejected before import", async t => {
    const { open } = setup(t);
    const importProject = t.mock.fn();
    const result = await open({ showAppDialog: accept, fetchImpl: () => response(body), importProject,
      ...(label === "node count" ? { maxNodes: 4 } : {}) });
    assert.deepEqual([result.status, result.errorCode], ["error", code]);
    assert.equal(importProject.mock.callCount(), 0);
  });
}

for (const zipped of [false, true]) {
  test((zipped ? "ZIP" : "JSON") + " preserves original bytes and uses the real confirmation callback in the funnel", async t => {
    const { open, state } = setup(t);
    const payload = { schemaVersion: 22, customPresets: { constructor: "blue", prototype: "red" } };
    const json = JSON.stringify(payload);
    const bytes = zipped ? zipSync({ "map_project.json": strToU8(json) }) : strToU8("\uFEFF  " + json);
    const showAppDialog = t.mock.fn(accept);
    const result = await open({ showAppDialog,
      fetchImpl(url, options) {
        assert.equal(state.sharedProjectLink.status, "loading");
        assert.equal(url, raw);
        const { signal, ...init } = options;
        assert.equal(signal.aborted, false);
        assert.deepEqual(init, { mode: "cors", credentials: "omit", redirect: "manual",
          referrerPolicy: "no-referrer", cache: "no-store" });
        return response(new ReadableStream({ start(stream) {
          stream.enqueue(bytes.slice(0, 2)); stream.enqueue(bytes.slice(2)); stream.close();
        } }));
      },
      async importProject(input, { ui, projectPayload, fileName }) {
        assert.equal(input, null);
        assert.equal(state.sharedProjectLink.status, "importing");
        assert.deepEqual(projectPayload, payload);
        assert.equal(fileName, zipped ? "p.zip" : "p.json");
        assert.equal(ui.showAppDialog, showAppDialog);
        assert.equal(await ui.showAppDialog({ title: "Load Anyway" }), true);
        return { status: "committed" };
      },
    });
    assert.equal(showAppDialog.mock.callCount(), 2);
    assert.equal(result.status, "success");
    assert.deepEqual(new Uint8Array(await result.originalFile.arrayBuffer()), bytes);
  });
}

for (const [name, makeResponse, errorCode] of [
  ["unsafe redirect", () => response("{}", { url: "http://example.test/p.json" }), "not-https"],
  ["oversize Content-Length", () => response("{}", { headers: { "content-length": "17" } }), "too-large"],
  ["stream exceeds JSON limit", () => response(" ".repeat(17)), "too-large"],
  ["ZIP exceeds compressed limit", () => response(Uint8Array.of(80, 75, 3, 4, 0)), "too-large"],
  ["HTTP failure", () => response("", { status: 404 }), "fetch-failed"],
  ["CORS failure", () => { throw new TypeError("Failed to fetch"); }, "cors-blocked"],
]) {
  test(name + " aborts the request", async t => {
    const { open } = setup(t);
    let signal;
    const result = await open({ showAppDialog: accept, maxBytes: 16, maxZipBytes: 4,
      fetchImpl(_, options) { signal = options.signal; return makeResponse(); } });
    assert.equal(result.errorCode, errorCode);
    assert.equal(signal.aborted, true);
  });
}

test("one deadline covers the entire download including a stalled body", async t => {
  const { open } = setup(t);
  let fire, cleared = false;
  const result = await open({ showAppDialog: accept, timers: {
    setTimeout(callback, ms) { assert.equal(ms, 30_000); fire = callback; return 42; },
    clearTimeout(id) { assert.equal(id, 42); cleared = true; },
  }, fetchImpl(_, { signal }) {
    return response(new ReadableStream({ pull(stream) {
      signal.addEventListener("abort", () => stream.error(signal.reason), { once: true });
      fire();
    } }));
  } });
  assert.equal(result.errorCode, "timeout");
  assert.equal(cleared, true);
});

test("an unsuccessful funnel result is reported to the banner", async t => {
  const { open } = setup(t);
  const result = await open({ showAppDialog: accept, fetchImpl: () => response('{"colors":{}}'),
    importProject: () => ({ status: "failed" }) });
  assert.equal(result.errorCode, "import-failed");
});

test("edits made after consent cancel the download's import and notify the user", async t => {
  const { open, state } = setup(t);
  const toast = t.mock.fn();
  t.after(registerOwnedRuntimeHook(state, "showToastFn", toast));
  const importProject = t.mock.fn(() => true);
  const result = await open({ showAppDialog: accept, importProject, fetchImpl() {
    state.dirtyRevision = 1;
    state.historyPast = [{ label: "paint" }];
    return response('{"schemaVersion":22}');
  } });
  assert.equal(result.status, "cancelled");
  assert.equal(importProject.mock.callCount(), 0);
  assert.equal(toast.mock.callCount(), 1);
});

test("a redirect stops at the original host and shows the final raw link hint", async t => {
  const { open, state } = setup(t);
  const importProject = t.mock.fn(() => true);
  const requests = [];
  const result = await open({ showAppDialog: accept, importProject, fetchImpl(url, options) {
    requests.push(url);
    if (options.redirect === "follow") requests.push("https://elsewhere.test/map.json");
    return { type: "opaqueredirect", status: 0, ok: false, url: "" };
  } });
  assert.deepEqual(requests, [raw]);
  assert.equal(result.errorCode, "redirect");
  assert.equal(importProject.mock.callCount(), 0);
  const root = bannerElement(), bodyNode = bannerElement();
  createSampleProjectBannerController(state, { root, bodyNode }).render();
  assert.equal(bodyNode.textContent, "This link redirects elsewhere. Use the final raw file link.");
});

function bannerElement() {
  return Object.assign(new EventTarget(), {
    dataset: {}, classList: { toggle() {} },
    setAttribute(key, value) { this[key] = value; },
    removeAttribute(key) { delete this[key]; },
  });
}

test("opening another document clears the shared banner and releases the original download", async t => {
  const { open, state } = setup(t, raw, runtimeState);
  globalThis.document = { getElementById: () => null };
  t.after(() => { delete globalThis.document; });
  const root = bannerElement(), download = bannerElement();
  const controller = createSampleProjectBannerController(state, { root, downloadOriginalLink: download });
  controller.bindEvents();
  t.after(registerOwnedRuntimeHook(state, "refreshSampleProjectBannerFn", () => controller.render()));
  const result = await open({ showAppDialog: accept, fetchImpl: () => response('{"schemaVersion":22}') });
  assert.equal(result.status, "success");
  const original = download.href;
  assert.match(original, /^blob:/);
  markDirty("paint");
  assert.equal(root.hidden, false);
  const replacement = await importProjectThroughFunnel(null, { fileName: "p.json",
    projectPayload: { schemaVersion: 22, projectName: "Local map" } });
  assert.match(replacement.status, /^committed/);
  assert.equal(state.projectName, "Local map");
  assert.equal(state.sharedProjectLink.status, "idle");
  assert.equal(state.sharedProjectLink.originalFile, null);
  assert.equal(root.hidden, true);
  assert.equal(download.href, undefined);
  await assert.rejects(fetch(original), TypeError);
  await replacement.completion;
});

test("shared banner downloads the fetched bytes, saves a copy and can be dismissed", async t => {
  const root = bannerElement(), copy = bannerElement(), download = bannerElement(), dismiss = bannerElement(), title = bannerElement();
  const saveCopy = t.mock.fn();
  const shared = { status: "success", host: "example.test", originalFile: new File(["original"], "p.json") };
  const controller = createSampleProjectBannerController({ sharedProjectLink: shared }, {
    root, saveCopyButton: copy, saveCopy, downloadOriginalLink: download, dismissButton: dismiss, titleNode: title,
  });
  controller.bindEvents();
  controller.render();
  assert.match(title.textContent, /example\.test/);
  assert.equal(root.hidden, false);
  assert.equal(copy.hidden, false);
  copy.dispatchEvent(new Event("click"));
  assert.equal(saveCopy.mock.callCount(), 1);
  assert.equal(download.download, "p.json");
  assert.match(download.href, /^blob:/);
  assert.equal(await (await fetch(download.href)).text(), "original");
  dismiss.dispatchEvent(new Event("click"));
  controller.render();
  assert.equal(root.hidden, true);
});
