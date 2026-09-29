import { buildOwnerBorderMesh } from './border_mesh_dynamic_runtime.js';
import { isPoliticalBorderEnabled } from './political_border_policy.js';

const EMPTY = Object.freeze([]);

// Political identity is the immutable scenario reference, independent of paint.
// Chunked scenes deliberately keep only shell geometry in runtimePoliticalTopology;
// their full, precomputed opening mesh is the authoritative border source.
export function createPoliticalBorderRuntime({
  state,
  resolveOwnerCode,
  isEligible = () => true,
  buildMesh = buildOwnerBorderMesh,
} = {}) {
  let identity = [], meshes = EMPTY, revision = 0, builds = 0;
  let status = 'idle', source = '', error = '';
  function sync() {
    const scenarioId = String(state.activeScenarioId || '');
    const enabled = isPoliticalBorderEnabled(state);
    const pack = state.activeScenarioMeshPack;
    const manifest = state.activeScenarioManifest || {};
    const expectsPack = !!scenarioId && !!(manifest.mesh_pack_url || manifest.detail_chunk_manifest_url);
    const usePack = !!scenarioId && (!!pack || expectsPack);
    const topology = usePack ? null : state.runtimePoliticalTopology;
    const next = [enabled, scenarioId, usePack ? pack : topology, expectsPack, state.mapSemanticMode];
    // A precomputed reference mesh does not depend on visible chunk shells or
    // overlay publication. Only topology-built meshes need those predicates.
    if (!usePack) next.push(state.sceneGeneration, state.scenarioBaselineHash,
      state.scenarioBaselineOwnersByFeatureId, state.scenarioShellOverlayRevision,
      state.showWaterRegions, state.showScenarioAtlantropa);
    if (identity.length === next.length && next.every((value, i) => value === identity[i])) return;
    identity = next; revision += 1; meshes = EMPTY; error = '';
    source = usePack ? 'scenario-mesh-pack' : 'topology';
    if (!enabled) { status = 'disabled'; return; }
    if (usePack) {
      if (!pack) { status = 'pending'; return; }
      if (String(pack.scenario_id || '') !== scenarioId) {
        status = 'error'; error = 'Political border mesh belongs to another scenario'; return;
      }
      const mesh = pack.meshes?.opening_owner_borders;
      if (mesh?.type !== 'MultiLineString' || !Array.isArray(mesh.coordinates)) {
        status = 'error'; error = 'Scenario political border mesh is unavailable'; return;
      }
      meshes = mesh.coordinates.length ? [mesh] : EMPTY;
    } else {
      if (!topology?.objects?.political) { status = 'pending'; return; }
      const mesh = buildMesh({ runtimeTopology: topology, excludeSea: true,
        shouldExcludeOwnerBorderEntity: entity => !isEligible(entity),
        resolveOwnerBorderCode: resolveOwnerCode });
      builds += 1;
      meshes = mesh?.coordinates?.length ? [mesh] : EMPTY;
    }
    status = 'ready';
  }
  return Object.freeze({
    getMeshes() { sync(); return meshes; },
    getRevision() { sync(); return revision; },
    diagnostics() {
      sync();
      return { status, source, error, revision, builds,
        lineCount: meshes.reduce((count, mesh) => count + mesh.coordinates.length, 0) };
    },
    dispose() { identity = []; meshes = EMPTY; status = 'idle'; revision += 1; },
  });
}
