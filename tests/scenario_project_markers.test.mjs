import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildScenarioProjectMarkerEntries, drawScenarioProjectMarkers } from "../js/core/renderer/scenario_project_markers.js";
import { createFacilitySurfaceOwner, shouldBlockUnderlyingMapSelectionForFacility } from "../js/core/renderer/facility_surface.js";

const manifest = JSON.parse(readFileSync(new URL("../data/scenarios/tno_1962/manifest.json", import.meta.url)));
const state = { activeScenarioId: "tno_1962", showScenarioAtlantropa: true };
const projection = ([x, y]) => [x * 2, y * 2];
const transform = { k: 3, apply: ([x, y]) => [x * 3 + 10, y * 3 + 20] };
const entries = () => buildScenarioProjectMarkerEntries(manifest, state, projection, transform);

test("project markers follow scenario visibility and screen projection", () => {
  assert.equal(entries().length, 3);
  assert.deepEqual(entries()[1].screenPoint, transform.apply(projection([32.35, 30.60])));
  for (const changes of [{ showScenarioAtlantropa: false }, { activeScenarioId: "hoi4_1936" }]) {
    assert.deepEqual(buildScenarioProjectMarkerEntries(manifest, { ...state, ...changes }, projection, transform), []);
  }
  assert.ok(entries().every((entry) => entry.familyId === "project" && shouldBlockUnderlyingMapSelectionForFacility(entry)));
});

test("project cards display localized names, status, body and optional location note", () => {
  for (const language of ["en", "zh"]) {
    const owner = createFacilitySurfaceOwner({ getLanguage: () => language, helpers: { t: (key) => key } });
    for (const entry of entries()) {
      assert.equal(owner.buildFacilityInfoCardTitle(entry), entry.properties.name[language]);
      const model = owner.buildFacilityInfoCardFieldSections(entry);
      assert.deepEqual(model.rows.map((row) => row.value), [
        entry.properties.kind === "dam" ? "Dam" : "Canal",
        entry.properties.status[language], entry.properties.body[language],
        ...(entry.properties.location_note ? [entry.properties.location_note[language]] : []),
      ]);
      assert.equal(model.hasExtraRows, false);
    }
  }
});

test("project symbol retains its screen radius across zoom levels", () => {
  for (const scale of [1, 4]) {
    const points = [];
    const context = {
      save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
      moveTo(x, y) { points.push([x, y]); }, lineTo() {},
    };
    drawScenarioProjectMarkers(context, [entries()[0]], scale);
    assert.ok(Math.abs((entries()[0].projectedPoint[1] - points[0][1]) * scale - 5) < 1e-9);
  }
});

test("project marker visibility follows the scenario and the Atlantropa switch", async () => {
  const { hasVisibleScenarioProjectMarkers } = await import("../js/core/renderer/scenario_project_markers.js");
  const manifest = { project_markers: [{ id: "suez_canal" }] };
  assert.equal(hasVisibleScenarioProjectMarkers(manifest, { activeScenarioId: "tno_1962", showScenarioAtlantropa: true }), true);
  assert.equal(hasVisibleScenarioProjectMarkers(manifest, { activeScenarioId: "tno_1962", showScenarioAtlantropa: false }), false);
  assert.equal(hasVisibleScenarioProjectMarkers(manifest, { activeScenarioId: "hoi4_1936", showScenarioAtlantropa: true }), false);
  assert.equal(hasVisibleScenarioProjectMarkers({}, { activeScenarioId: "tno_1962", showScenarioAtlantropa: true }), false);
});
