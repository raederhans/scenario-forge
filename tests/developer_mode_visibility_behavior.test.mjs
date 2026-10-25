import test from "node:test";
import assert from "node:assert/strict";

import { shouldShowDeveloperModeEntry } from "../js/ui/toolbar/developer_mode_visibility.js";

test("developer mode entry is hidden for ordinary visitors by default", () => {
  assert.equal(shouldShowDeveloperModeEntry(), false);
  assert.equal(shouldShowDeveloperModeEntry({ hostname: "raederhans.github.io", search: "", storedDeveloperMode: null }), false);
  assert.equal(shouldShowDeveloperModeEntry({ hostname: "raederhans.github.io", search: "?dev=0&sample=demo" }), false);
  assert.equal(shouldShowDeveloperModeEntry({ hostname: "example.com", storedDeveloperMode: "garbage" }), false);
});

test("developer mode entry is visible on local development hosts", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
    assert.equal(shouldShowDeveloperModeEntry({ hostname }), true, hostname);
  }
});

test("developer mode entry is visible when the URL opts in with dev=1", () => {
  assert.equal(shouldShowDeveloperModeEntry({ hostname: "raederhans.github.io", search: "?dev=1" }), true);
  assert.equal(shouldShowDeveloperModeEntry({ hostname: "raederhans.github.io", search: "?view=guide&dev=1" }), true);
});

test("developer mode entry stays visible once this browser stored a developer mode state", () => {
  assert.equal(shouldShowDeveloperModeEntry({ hostname: "raederhans.github.io", storedDeveloperMode: "true" }), true);
  assert.equal(shouldShowDeveloperModeEntry({ hostname: "raederhans.github.io", storedDeveloperMode: "false" }), true);
});
