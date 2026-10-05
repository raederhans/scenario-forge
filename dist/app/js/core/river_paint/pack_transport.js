// Download-only format. Authentication and saved projects still use the full
// schema-1 pack. Keep these ceilings equal to partition_model.js, never larger.
const MAX_COORDINATES = 250000;
const MAX_PARENTS = 512;
const MAX_CELLS = 8192;
const MAX_CELLS_PER_PARENT = 128;
const MAX_SUPPORT = 2048;
const TRANSPORT_KIND = 'river-paint-indexed-coordinates';
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
function fail(message) { throw new TypeError(`River partition transport: ${message}`); }

function record(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid record');
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('unknown record field');
  }
  if (required.some(key => !Object.hasOwn(value, key))) fail('missing record field');
}
function array(value, min, max, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < min || value.length > max) fail(`invalid ${label} count`);
  if (Reflect.ownKeys(value).length !== value.length + 1) fail('invalid array fields');
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid array entry');
  }
}
function source(value) {
  const fields = ['landPath', 'landDigest', 'riverPath', 'riverDigest', 'baseCommit', 'baselineHash'];
  record(value, [...fields, 'riverNames', 'includeLakeCenterlines'], []);
  for (const key of fields) {
    if (Object.hasOwn(value, key) && (typeof value[key] !== 'string' || value[key].length > 1024)) fail('invalid source');
  }
  if (Object.hasOwn(value, 'riverNames')) {
    array(value.riverNames, 0, 100, 'river names');
    for (const name of value.riverNames) if (!id(name)) fail('invalid river name');
  }
  if (Object.hasOwn(value, 'includeLakeCenterlines') && typeof value.includeLakeCenterlines !== 'boolean') fail('invalid source flag');
}

// Validate every shape/count/reference first. No coordinate expansion occurs
// during this pass, even for a tiny table referenced more than 250,000 times.
function preflight(value) {
  record(value, ['transportVersion', 'kind', 'coordinates', 'pack']);
  if (value.transportVersion !== 1 || value.kind !== TRANSPORT_KIND) fail('unsupported transport contract');
  array(value.coordinates, 1, MAX_COORDINATES, 'coordinate table');
  for (const point of value.coordinates) {
    array(point, 2, 2, 'coordinate dimensions');
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])
      || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 80) fail('invalid coordinate table point');
  }
  const pack = value.pack;
  record(pack, ['schemaVersion', 'kind', 'packId', 'sceneId', 'algorithmVersion',
    'coordinateIdentityPrecision', 'geometryWinding', 'source', 'parents', 'support']);
  if (pack.schemaVersion !== 1 || pack.kind !== 'river-paint-partitions' || !digest(pack.packId) || !id(pack.sceneId)
    || pack.algorithmVersion !== 'river-joint-noding-v1' || pack.coordinateIdentityPrecision !== 7
    || pack.geometryWinding !== 'd3-clockwise-exterior') fail('unsupported pack contract');
  source(pack.source);
  array(pack.parents, 1, MAX_PARENTS, 'parent');
  array(pack.support, 0, MAX_SUPPORT, 'support');
  let references = 0, cells = 0;
  const geometry = raw => {
    record(raw, ['type', 'coordinates']);
    if (!['Polygon', 'MultiPolygon'].includes(raw.type)) fail('invalid geometry type');
    const polygons = raw.type === 'Polygon' ? [raw.coordinates] : raw.coordinates;
    array(polygons, 1, Math.floor((MAX_COORDINATES - references) / 4), 'polygon');
    for (const rings of polygons) {
      array(rings, 1, Math.floor((MAX_COORDINATES - references) / 4), 'ring');
      for (const ring of rings) {
        array(ring, 4, MAX_COORDINATES - references, 'coordinate reference');
        references += ring.length;
        for (const index of ring) {
          if (!Number.isSafeInteger(index) || index < 0 || index >= value.coordinates.length) fail('invalid coordinate index');
        }
      }
    }
  };
  for (const parent of pack.parents) {
    record(parent, ['parentId', 'parentFingerprint', 'parentGeometry', 'cells']);
    if (!id(parent.parentId) || !digest(parent.parentFingerprint)) fail('invalid parent');
    array(parent.cells, 2, MAX_CELLS_PER_PARENT, 'cell');
    cells += parent.cells.length;
    if (cells > MAX_CELLS) fail('cell budget exceeded');
    geometry(parent.parentGeometry);
    for (const cell of parent.cells) {
      record(cell, ['id', 'geometry', 'geometryFingerprint']);
      if (!id(cell.id) || !digest(cell.geometryFingerprint)) fail('invalid cell');
      geometry(cell.geometry);
    }
  }
  for (const item of pack.support) {
    record(item, ['parentId', 'parentFingerprint', 'parentGeometry', 'geometry', 'geometryFingerprint']);
    if (!id(item.parentId) || !digest(item.parentFingerprint) || !digest(item.geometryFingerprint)) fail('invalid support');
    geometry(item.parentGeometry); geometry(item.geometry);
  }
  if (value.coordinates.length > references) fail('coordinate table exceeds reference count');
}

export function decodeRiverPartitionTransport(value) {
  // Old downloads remain valid. Import/serialization boundaries do not call
  // this decoder, and therefore never accept a transport wrapper as a save.
  if (value && typeof value === 'object'
    && Object.getOwnPropertyDescriptor(value, 'kind')?.value === 'river-paint-partitions'
    && !Object.hasOwn(value, 'transportVersion')) return value;
  preflight(value);
  const table = value.coordinates;
  const geometry = raw => {
    const ring = indexes => indexes.map(index => [table[index][0], table[index][1]]);
    return { type: raw.type, coordinates: raw.type === 'Polygon'
      ? raw.coordinates.map(ring) : raw.coordinates.map(rings => rings.map(ring)) };
  };
  const pack = value.pack;
  return { ...pack, source: { ...pack.source,
    ...(Object.hasOwn(pack.source, 'riverNames') ? { riverNames: [...pack.source.riverNames] } : {}) },
  parents: pack.parents.map(parent => ({ ...parent, parentGeometry: geometry(parent.parentGeometry),
    cells: parent.cells.map(cell => ({ ...cell, geometry: geometry(cell.geometry) })) })),
  support: pack.support.map(item => ({ ...item, parentGeometry: geometry(item.parentGeometry), geometry: geometry(item.geometry) })) };
}
