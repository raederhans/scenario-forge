import test from 'node:test';
import assert from 'node:assert/strict';
import { selectScenarioChunks } from '../js/core/scenario_chunk_manager.js';

test('precision coarse base survives detail budget without admitting expensive detail tail', () => {
  const make = (id, lod, cost) => ({id, url: `${id}.json`, layer:'political', lod,
    globalCoverage: lod === 'coarse', bounds:[-1,-1,1,1], minZoom:0, maxZoom:99,
    priority:0, countryCodes:[], estimatedPathCost:cost, byteSize:10,
    coordCount:cost, partCount:1, featureCount:1});
  const selection = selectScenarioChunks({scenarioId:'tno_1962',
    chunkRegistry:{byLayer:{political:[make('base','coarse',1000000),
      make('detail-a','detail',10),make('detail-b','detail',10)]}},
    zoom:10,viewportBbox:[-10,-10,10,10],visibleLayers:['political'],
    renderBudgetHints:{max_required_political_chunks:2,min_required_political_chunks:1,
      max_required_political_estimated_path_cost:15,max_optional_chunks:0}});
  assert.deepEqual(selection.requiredChunks.map(c=>c.id),['base','detail-a']);
  assert.equal(selection.selectedEstimatedPathCostSum,1000010);
});
