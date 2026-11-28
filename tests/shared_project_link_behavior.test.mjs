import assert from "node:assert/strict";
import test from "node:test";
import { initializeSharedProjectLink, openStartupSharedProject } from "../js/bootstrap/startup_shared_project_link.js";
import { buildShareLink, getSharedProjectLinkFromUrl, validateSharedProjectUrl } from "../js/core/shared_project_url.js";
import { createDefaultBootState } from "../js/core/state/boot_state.js";

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

test("invalid links are cleared without a prompt or request", async t => {
  const { open, location } = setup(t, "https://localhost/private");
  const showAppDialog = t.mock.fn();
  const fetchImpl = t.mock.fn();
  const result = await open({ showAppDialog, fetchImpl });
  assert.equal(result.errorCode, "invalid-url");
  assert.equal(location.searchParams.has("project"), false);
  assert.equal(showAppDialog.mock.callCount() + fetchImpl.mock.callCount(), 0);
});

test("ordinary JSON is rejected before import", async t => {
  const { open } = setup(t);
  const importProject = t.mock.fn();
  const result = await open({ showAppDialog: accept, fetchImpl: () => response('{"message":"File moved"}'), importProject });
  assert.deepEqual([result.status, result.errorCode], ["error", "not-project"]);
  assert.equal(importProject.mock.callCount(), 0);
});
