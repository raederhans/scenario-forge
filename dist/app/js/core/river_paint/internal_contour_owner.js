import { buildPaintContourGraph } from '../renderer/paint_contour_graph.js';
import { createPaintContourMesh } from '../renderer/paint_contour_mesh.js';

const EMPTY = Object.freeze([]);

// Internal seams belong to a partition, before other source polygons obscure
// them. The border renderer applies source draw order to these complete meshes.
export function createRiverInternalContourOwner({ state, getActivePack, getCellFeature, resolveCellColor }) {
  let pack = null, scene = '', source = null, sourceSignal = '', initialized = false;
  let parents = new Map(), cellParents = new Map(), entries = new Map();
  let revision = 0, paintRevision = -1, builds = 0, disposed = false;
  const color = id => {
    const resolved = resolveCellColor(id);
    return typeof resolved === 'string' ? resolved : resolved?.color;
  };
  function syncContext() {
    if (disposed) return;
    const nextPack = getActivePack() || null;
    const nextScene = `${state.activeScenarioId || ''}|${state.sceneGeneration || 0}`;
    const nextSource = state.landData?.features;
    const nextSignal = `${state.topologyRevision || 0}|${state.scenarioDataGeneration || 0}`;
    const packChanged = !initialized || pack !== nextPack || scene !== nextScene;
    const geometryRevisionChanged = initialized && sourceSignal !== nextSignal;
    if (!packChanged && source === nextSource && !geometryRevisionChanged) return;
    initialized = true;
    pack = nextPack; scene = nextScene; source = nextSource; sourceSignal = nextSignal;
    if (packChanged) {
      parents = new Map((pack?.parents || EMPTY).map(parent => [parent.parentId, parent]));
      cellParents = new Map();
      for (const parent of parents.values()) for (const cell of parent.cells) cellParents.set(cell.id, parent.parentId);
      entries = new Map();
      paintRevision = -1;
    } else {
      for (const entry of entries.values()) {
        entry.ready = false; entry.view = null; entry.error = '';
        // Explicit geometry publication also permits mutation of an existing
        // reference. A collection replacement can reuse immutable cell graphs.
        if (geometryRevisionChanged) entry.graph = null;
      }
    }
    revision += 1;
  }
  function syncPaint(ids = null, explicit = false) {
    const next = Number(state.colorRevision || 0);
    if (!explicit && next === paintRevision) return false;
    const scoped = ids != null && (next === paintRevision || next === paintRevision + 1);
    const byParent = scoped ? new Map() : null;
    if (scoped) for (const id of ids) {
      const parentId = cellParents.get(id);
      if (!parentId) continue;
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(id);
    }
    let changed = false;
    for (const [parentId, entry] of entries) {
      if (!entry.ready || !entry.view || (scoped && !byParent.has(parentId))) continue;
      changed = entry.view.refresh(scoped ? byParent.get(parentId) : null) || changed;
    }
    if (changed) revision += 1;
    paintRevision = next;
    return changed;
  }
  function prepareParent(parentId) {
    const parent = parents.get(parentId);
    if (!parent) return null;
    let entry = entries.get(parentId);
    if (!entry) { entry = { ready: false, graph: null, geometries: null, view: null, error: '' }; entries.set(parentId, entry); }
    try {
      const features = parent.cells.map(cell => {
        const feature = getCellFeature(cell.id);
        const id = feature?.properties?.id || feature?.id;
        if (!feature || id !== cell.id || feature.properties?.__riverParentId !== parentId || feature.geometry !== cell.geometry) {
          throw new Error(`Missing or incompatible cell ${cell.id}`);
        }
        if (!['Polygon', 'MultiPolygon'].includes(cell.geometry?.type) || !cell.geometry.coordinates?.length) {
          throw new Error(`Invalid cell geometry ${cell.id}`);
        }
        return { id: cell.id, geometry: cell.geometry };
      });
      if (!features.length) throw new Error('Parent has no cells');
      const sameGeometry = entry.graph && entry.geometries?.length === features.length
        && features.every((feature, index) => entry.geometries[index] === feature.geometry);
      if (!sameGeometry) {
        entry.graph = buildPaintContourGraph(features); builds += 1;
        entry.geometries = features.map(feature => feature.geometry);
        entry.view = null;
      }
      if (entry.graph.diagnostics.invalidRings) throw new Error(`Invalid cell rings: ${entry.graph.diagnostics.invalidRings}`);
      if (!entry.graph.diagnostics.segmentCount) throw new Error('Parent has no valid cell edges');
      if (!entry.view) { entry.view = createPaintContourMesh(entry.graph, color); revision += 1; }
      entry.ready = true; entry.error = '';
      return entry;
    } catch (failure) {
      if (entry.ready || entry.view) revision += 1;
      entry.ready = false; entry.view = null;
      entry.error = failure?.message || String(failure);
      return entry;
    }
  }
  return Object.freeze({
    getParentMeshes(parentId) {
      syncContext(); syncPaint();
      const entry = disposed ? null : prepareParent(parentId);
      return entry?.ready && entry.view.getActiveArcCount() ? [entry.view.getMesh()] : EMPTY;
    },
    getRevision() { syncContext(); syncPaint(); return revision; },
    notifyPaintChanged(ids = null) {
      const before = revision;
      syncContext(); syncPaint(ids, true);
      return revision !== before;
    },
    async ensureReady() {
      if (disposed) throw new Error('River internal contour owner is disposed');
      syncContext(); syncPaint();
      const errors = [];
      for (const parentId of parents.keys()) {
        const entry = prepareParent(parentId);
        if (!entry.ready) errors.push(`${parentId}: ${entry.error}`);
      }
      if (errors.length) throw new Error(`River internal contour preparation failed: ${errors.join('; ')}`);
    },
    diagnostics() {
      syncContext(); syncPaint();
      const details = [...entries].map(([parentId, entry]) => ({ parentId, ready: entry.ready,
        error: entry.error, activeArcCount: entry.view?.getActiveArcCount() || 0, ...entry.graph?.diagnostics }));
      const readyParents = details.filter(entry => entry.ready).length;
      return { status: disposed ? 'disposed' : details.some(entry => entry.error) ? 'error'
        : readyParents === parents.size ? 'ready' : readyParents ? 'partial' : 'idle',
      packId: pack?.packId || null, revision, builds, parentCount: parents.size, readyParents,
      activeArcCount: details.reduce((sum, entry) => sum + entry.activeArcCount, 0), parents: details };
    },
    dispose() {
      disposed = true; pack = null; parents.clear(); cellParents.clear(); entries.clear(); revision += 1;
    },
  });
}
