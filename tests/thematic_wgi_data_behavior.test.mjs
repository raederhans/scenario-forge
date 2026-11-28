import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  THEMATIC_WGI_METRIC_ID,
  getThematicWgiObservation,
  loadThematicWgiData,
  resolveThematicWgiJoinKey,
} from "../js/core/thematic/thematic_wgi_data.js";

const dataRoot = new URL("../data/thematic_layers/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("political/wgi_state_capacity_v1/manifest.json", dataRoot)));
const metrics = JSON.parse(await readFile(new URL("political/wgi_state_capacity_v1/metrics.admin0.json", dataRoot)));

function fixtureFetcher(manifestPayload = manifest, metricsPayload = metrics) {
  return async (path) => path.endsWith("manifest.json") ? manifestPayload : metricsPayload;
}

test("Government Effectiveness preserves the published score", async () => {
  const payload = await loadThematicWgiData({ fetchJson: fixtureFetcher() });
  const usa = getThematicWgiObservation(payload, "USA");
  const sourceUsa = metrics.features.find((row) => row.join_key === "USA").values[THEMATIC_WGI_METRIC_ID];
  assert.equal(usa.status, "value");
  assert.equal(usa.value, sourceUsa.normalized_value);
});

test("unmapped geographies have no observation", async () => {
  const realPayload = await loadThematicWgiData({ fetchJson: fixtureFetcher() });
  assert.deepEqual(getThematicWgiObservation(realPayload, "ZZZ"), {
    status: "unmatched", value: null, joinKey: "ZZZ", uncertainty: null,
  });
  assert.equal(getThematicWgiObservation(realPayload, "").status, "unmatched");
});

test("join prefers explicit ISO_A3 then explicit geographic alpha2 without scenario or feature-id inference", () => {
  assert.equal(resolveThematicWgiJoinKey({ properties: { ISO_A3: " usa " } }, "FR"), "USA");
  assert.equal(resolveThematicWgiJoinKey({ properties: { ISO_A3: "-99", iso_a3: "fra" } }, "US"), "FRA");
  assert.equal(resolveThematicWgiJoinKey({ properties: { ISO_A3: "-99", cntr_code: "US" } }), "USA");
  assert.equal(resolveThematicWgiJoinKey({ properties: { cntr_code: "FR" } }, "US"), "USA");
  assert.equal(resolveThematicWgiJoinKey({}, "UK"), "GBR");
  assert.equal(resolveThematicWgiJoinKey({}, "EL"), "GRC");
  assert.equal(resolveThematicWgiJoinKey({}, "XK"), "XKX");
  assert.equal(resolveThematicWgiJoinKey({ id: "US-123", properties: { owner: "US", group: "USA", ADM0_A3: "USA", SOV_A3: "USA" } }), "");
  assert.equal(resolveThematicWgiJoinKey({}, "USA"), "");
  assert.equal(resolveThematicWgiJoinKey({}, "ZZ"), "");
});
