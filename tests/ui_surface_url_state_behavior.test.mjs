import test from "node:test";
import assert from "node:assert/strict";
import { createUiSurfaceUrlState } from "../js/ui/ui_surface_url_state.js";

test("property navigation preserves section keys and unrelated URL state without a segment parameter", (context) => {
  const previous = { location: globalThis.location, history: globalThis.history };
  globalThis.location = { pathname: "/app/", search: "?section=countries&scenario=test", hash: "#map" };
  const writes = [];
  globalThis.history = {
    state: { retained: true },
    replaceState(state, title, url) {
      writes.push({ state, url });
      globalThis.location.search = new URL(url, "http://localhost").search;
    },
  };
  context.after(() => Object.assign(globalThis, previous));
  const urlState = createUiSurfaceUrlState({ uiUrlStateKeys: { section: "section" } });
  for (const key of ["data-appearance-panel-borders", "countries"]) {
    urlState.replaceUiUrlParams((params) => params.set("section", key));
    assert.deepEqual(writes.at(-1), {
      state: { retained: true },
      url: `/app/?section=${key}&scenario=test#map`,
    });
  }
});
