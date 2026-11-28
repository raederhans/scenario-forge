import assert from "node:assert/strict";
import test from "node:test";
import thematicIndex from "../data/thematic_layers/index.json" with { type: "json" };
import wgiManifest from "../data/thematic_layers/political/wgi_state_capacity_v1/manifest.json" with { type: "json" };
import wdiPopulationManifest from "../data/thematic_layers/population/wdi_population_v1/manifest.json" with { type: "json" };
import { normalizeThematicLayerCatalogPayload } from "../js/core/thematic/thematic_layer_catalog.js";
import { THEMATIC_WGI_LAYER_ID } from "../js/core/thematic/thematic_wgi_data.js";
import { THEMATIC_POPULATION_LAYER_ID } from "../js/core/thematic/thematic_population_data.js";

test("WGI manifest admits the layer to the main map", () => {
  const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
    manifestByLayerId: { [THEMATIC_WGI_LAYER_ID]: wgiManifest },
  });
  const wgi = preview.layers.find((layer) => layer.layerId === THEMATIC_WGI_LAYER_ID);
  assert.equal(wgi.supportsMainMapRender, true);
});

test("a foreign population layer identity cannot gain main-map admission", () => {
  const catalog = structuredClone(thematicIndex);
  const row = catalog.layers.find((layer) => layer.layer_id === THEMATIC_POPULATION_LAYER_ID);
  row.layer_id = "population_unaccepted";
  const preview = normalizeThematicLayerCatalogPayload(catalog, {
    manifestByLayerId: { [row.layer_id]: wdiPopulationManifest },
  });
  const population = preview.layers.find((layer) => layer.layerId === row.layer_id);
  assert.equal(population.supportsMainMapRender, false);
});
