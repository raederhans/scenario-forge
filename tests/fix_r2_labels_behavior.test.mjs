import assert from "node:assert/strict";
import test from "node:test";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { normalizeMapLabel } from "../js/core/state/strategic_overlay_state.js";

test("hidden bound lettering restores automatic country names until lettering is shown again", () => {
  const state = { annotationView: {}, mapLabels: [normalizeMapLabel({ countryCode: "AAA", lon: 0, lat: 0 }, "title")] };
  const runtime = createLabelsRuntime({ runtimeState: state, rendererSurfaceHost: {} });
  for (const visible of [true, false, true]) {
    state.annotationView.showMapLabels = visible;
    assert.equal(runtime.getCountryLabelSuppressionSignature(), visible ? "AAA" : "");
  }
});
