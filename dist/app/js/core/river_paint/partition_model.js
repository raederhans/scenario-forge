import { sameRiverParentGeometry, riverGeometryFingerprint } from './geometry_identity.js';

const MAX_PARENTS = 512;
const MAX_CELLS_PER_PARENT = 128;
const MAX_COORDINATES = 250000;
const MAX_CELLS = 8192;
const packIndexes = new WeakMap();
const validatedPacks = new WeakSet();
const hex = value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : null;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const digest = value => /^sha256:[0-9a-f]{64}$/.test(String(value || ''));

function fail(message) { throw new TypeError(`River partitions: ${message}`); }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function signedArea(ring) {
  const [x, y] = ring[0];
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += (ring[i][0] - x) * (ring[i + 1][1] - y) - (ring[i + 1][0] - x) * (ring[i][1] - y);
  }
  return sum / 2;
}

function geometryArea(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((sum, rings) => sum + Math.abs(signedArea(rings[0]))
    - rings.slice(1).reduce((holes, ring) => holes + Math.abs(signedArea(ring)), 0), 0);
}

function cloneGeometry(raw, budget, clockwise = false) {
  if (!object(raw) || !['Polygon', 'MultiPolygon'].includes(raw.type)) fail('expected Polygon/MultiPolygon');
  const polygons = raw.type === 'Polygon' ? [raw.coordinates] : raw.coordinates;
  if (!Array.isArray(polygons) || !polygons.length) fail('empty geometry');
  const result = polygons.map(rings => {
    if (!Array.isArray(rings) || !rings.length) fail('missing polygon rings');
    return rings.map((ring, ringIndex) => {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > budget.remaining) fail('invalid ring or coordinate budget exceeded');
      budget.remaining -= ring.length;
      const points = ring.map(point => {
        if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
          || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 80) fail('invalid/out-of-scope coordinate');
        return [point[0], point[1]];
      });
      if (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1]) fail('open ring');
      const area = signedArea(points);
      if (!Number.isFinite(area) || area === 0) fail('zero-area ring');
      if (clockwise && (ringIndex === 0 ? area >= 0 : area <= 0)) fail('incorrect d3 winding');
      return points;
    });
  });
  const geometry = { type: raw.type, coordinates: raw.type === 'Polygon' ? result[0] : result };
  if (!(geometryArea(geometry) > 0)) fail('non-positive polygon area');
  return geometry;
}

function cloneSource(raw) {
  if (!object(raw)) fail('missing source provenance');
  const out = {};
  for (const key of ['landPath', 'landDigest', 'riverPath', 'riverDigest', 'baseCommit', 'baselineHash']) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'string' || raw[key].length > 1024) fail('invalid source provenance');
      out[key] = raw[key];
    }
  }
  if (raw.riverNames !== undefined) {
    if (!Array.isArray(raw.riverNames) || raw.riverNames.length > 100 || raw.riverNames.some(name => !id(name))) fail('invalid river names');
    out.riverNames = [...raw.riverNames];
  }
  out.includeLakeCenterlines = raw.includeLakeCenterlines === true;
  return out;
}

export function normalizeRiverPartitionPack(raw) {
  if (validatedPacks.has(raw)) return raw;
  if (!object(raw) || raw.schemaVersion !== 1 || raw.kind !== 'river-paint-partitions'
    || raw.algorithmVersion !== 'river-joint-noding-v1' || !digest(raw.packId) || !id(raw.sceneId)
    || raw.coordinateIdentityPrecision !== 7 || raw.geometryWinding !== 'd3-clockwise-exterior') fail('unsupported pack contract');
  if (!Array.isArray(raw.parents) || !raw.parents.length || raw.parents.length > MAX_PARENTS) fail('invalid parent count');
  const budget = { remaining: MAX_COORDINATES };
  const parentIds = new Set(), cellIds = new Set();
  const parents = raw.parents.map(parent => {
    if (!object(parent) || !id(parent.parentId) || parentIds.has(parent.parentId) || !digest(parent.parentFingerprint)) fail('invalid/duplicate parent');
    parentIds.add(parent.parentId);
    const parentGeometry = cloneGeometry(parent.parentGeometry, budget);
    if (!Array.isArray(parent.cells) || parent.cells.length < 2 || parent.cells.length > MAX_CELLS_PER_PARENT) fail('invalid cell count');
    const cells = parent.cells.map(cell => {
      if (!object(cell) || !id(cell.id) || cellIds.has(cell.id) || !digest(cell.geometryFingerprint)) fail('invalid/duplicate cell');
      if (cell.id !== `river:${parent.parentId}:${cell.geometryFingerprint.slice(7, 23)}`) fail('invalid cell identity');
      cellIds.add(cell.id);
      if (cellIds.size > MAX_CELLS) fail('cell budget exceeded');
      return { id: cell.id, geometry: cloneGeometry(cell.geometry, budget, true), geometryFingerprint: cell.geometryFingerprint };
    });
    const parentArea = geometryArea(parentGeometry);
    const cellArea = cells.reduce((sum, cell) => sum + geometryArea(cell.geometry), 0);
    if (Math.abs(cellArea - parentArea) > Math.max(1e-12, parentArea * 1e-9)) fail('cell area does not preserve parent');
    return { parentId: parent.parentId, parentFingerprint: parent.parentFingerprint, parentGeometry, cells };
  });
  if (!Array.isArray(raw.support || []) || (raw.support || []).length > 2048) fail('invalid contour support count');
  const support = (raw.support || []).map(item => {
    if (!object(item) || !id(item.parentId) || parentIds.has(item.parentId)
      || !digest(item.parentFingerprint) || !digest(item.geometryFingerprint)) fail('invalid/duplicate contour support');
    parentIds.add(item.parentId);
    const parentGeometry = cloneGeometry(item.parentGeometry, budget);
    const geometry = cloneGeometry(item.geometry, budget, true);
    if (Math.abs(geometryArea(parentGeometry) - geometryArea(geometry)) > Math.max(1e-12, geometryArea(parentGeometry) * 1e-9)) fail('contour support changes area');
    return { parentId: item.parentId, parentFingerprint: item.parentFingerprint,
      parentGeometry, geometry, geometryFingerprint: item.geometryFingerprint };
  });
  const pack = deepFreeze({ schemaVersion: 1, kind: raw.kind, packId: raw.packId, sceneId: raw.sceneId,
    algorithmVersion: raw.algorithmVersion, coordinateIdentityPrecision: 7,
    geometryWinding: raw.geometryWinding, source: cloneSource(raw.source), parents, support });
  validatedPacks.add(pack);
  return pack;
}

export async function verifyRiverPartitionFingerprints(pack) {
  const normalized = normalizeRiverPartitionPack(pack);
  for (const parent of normalized.parents) {
    if (await riverGeometryFingerprint(parent.parentGeometry) !== parent.parentFingerprint) fail('parent fingerprint mismatch');
    for (const cell of parent.cells) {
      if (await riverGeometryFingerprint(cell.geometry) !== cell.geometryFingerprint) fail('cell fingerprint mismatch');
    }
  }
  for (const support of normalized.support) {
    if (await riverGeometryFingerprint(support.parentGeometry) !== support.parentFingerprint
      || await riverGeometryFingerprint(support.geometry) !== support.geometryFingerprint) fail('contour support fingerprint mismatch');
  }
  return normalized;
}

export function getRiverPartitionIndex(pack) {
  if (!pack) return null;
  const normalized = normalizeRiverPartitionPack(pack);
  if (packIndexes.has(normalized)) return packIndexes.get(normalized);
  const parents = new Map(), cells = new Map();
  for (const parent of normalized.parents) {
    parents.set(parent.parentId, parent);
    for (const cell of parent.cells) cells.set(cell.id, { ...cell, parentId: parent.parentId });
  }
  const support = new Map(normalized.support.map(item => [item.parentId, item]));
  const index = { parents, cells, support };
  packIndexes.set(normalized, index);
  return index;
}

export function createDefaultRiverPaintState() {
  return { schemaVersion: 1, editMode: false, pack: null, overrides: {} };
}

export function normalizeRiverPaintState(raw) {
  if (raw == null) return createDefaultRiverPaintState();
  if (!object(raw) || raw.schemaVersion !== 1) fail('unsupported paint state');
  const pack = raw.pack ? normalizeRiverPartitionPack(raw.pack) : null;
  const index = getRiverPartitionIndex(pack);
  if (!object(raw.overrides || {})) fail('invalid overrides');
  const overrides = {};
  for (const [key, value] of Object.entries(raw.overrides || {})) {
    if (!index?.cells.has(key) || !hex(value)) fail('unknown cell or invalid color');
    Object.defineProperty(overrides, key, { value: hex(value), enumerable: true, writable: true, configurable: true });
  }
  return { schemaVersion: 1, editMode: raw.editMode === true, pack, overrides };
}

export function getActiveRiverPack(paint, sceneId, baselineHash = null) {
  const pack = paint?.pack;
  if (!pack || pack.sceneId !== String(sceneId || '')) return null;
  if (baselineHash !== null && pack.source.baselineHash && pack.source.baselineHash !== String(baselineHash || '')) return null;
  return pack;
}

export function getRiverParentCompatibility(pack, feature, featureId) {
  const parent = getRiverPartitionIndex(pack)?.parents.get(String(featureId || ''));
  if (!parent) return { status: 'unsplit', parent: null };
  if (!feature?.geometry) return { status: 'unavailable', parent };
  return { status: sameRiverParentGeometry(parent.parentGeometry, feature.geometry) ? 'ready' : 'geometry-mismatch', parent };
}

export function resolveRiverCellColor(paint, cellId, resolveParentColor) {
  const cell = getRiverPartitionIndex(paint?.pack)?.cells.get(cellId);
  if (!cell) return null;
  return hex(paint?.overrides?.[cellId]) || resolveParentColor(cell.parentId);
}

export function collectRiverCellIdsForParents(paint, featureIds) {
  const index = getRiverPartitionIndex(paint?.pack);
  if (!index) return [];
  return [...new Set(featureIds)].flatMap(parentId => index.parents.get(String(parentId))?.cells.map(cell => cell.id) || []);
}

export function clearRiverCellOverrides(paint, featureIds) {
  const keys = collectRiverCellIdsForParents(paint, featureIds).filter(key => Object.hasOwn(paint.overrides, key));
  if (!keys.length) return { paint, changedCellIds: [] };
  const overrides = { ...paint.overrides };
  keys.forEach(key => { delete overrides[key]; });
  return { paint: { ...paint, overrides }, changedCellIds: keys };
}

export function applyRiverCellOverride(paint, cellId, value, { remove = false } = {}) {
  if (!getRiverPartitionIndex(paint?.pack)?.cells.has(cellId)) fail('unknown edit cell');
  const color = remove ? null : hex(value);
  if (!remove && !color) fail('invalid edit color');
  const before = Object.hasOwn(paint.overrides, cellId) ? paint.overrides[cellId] : null;
  if (before === color) return { paint, changed: false, before, after: color };
  const overrides = { ...paint.overrides };
  if (remove) delete overrides[cellId];
  else overrides[cellId] = color;
  return { paint: { ...paint, overrides }, changed: true, before, after: color };
}

export function getEditedRiverParentIds(paint) {
  const index = getRiverPartitionIndex(paint?.pack);
  return index ? [...new Set(Object.keys(paint?.overrides || {}).map(id => index.cells.get(id)?.parentId).filter(Boolean))] : [];
}
