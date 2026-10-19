// Immutable line meshes share one packed registry across paint and worker
// producers. Ordinary GeoJSON coordinates are expanded only by explicit readers.
const packedMeshes = new WeakMap();

export const getPackedLineMesh = (mesh) => packedMeshes.get(mesh) || null;

export function isUsableLineMesh(mesh) {
  const packed = getPackedLineMesh(mesh);
  return packed ? packed.arcs.length > 0 : !!(mesh && Array.isArray(mesh.coordinates) && mesh.coordinates.length);
}

export function createPackedLineMesh(packed, properties = {}) {
  const { coordinates, offsets, arcs, positionValues, positionOffsets } = packed;
  if (!(coordinates instanceof Float64Array) || !(offsets instanceof Uint32Array)
    || !(arcs instanceof Uint32Array) || !offsets.length
    || coordinates.length !== offsets.at(-1) * 2
    || (positionOffsets && (!(positionOffsets instanceof Uint32Array)
      || !(positionValues instanceof Float64Array) || positionOffsets.length !== offsets.at(-1) + 1
      || positionOffsets.at(-1) !== positionValues.length))) throw new TypeError("Invalid packed line mesh.");
  let expanded = null;
  const mesh = { ...properties, type: properties.type || "MultiLineString", get coordinates() {
    if (!expanded) expanded = Array.from(arcs, (arc) => {
      const line = [];
      for (let index = offsets[arc]; index < offsets[arc + 1]; index += 1) {
        line.push(positionOffsets
          ? Array.from(positionValues.subarray(positionOffsets[index], positionOffsets[index + 1]))
          : [coordinates[index * 2], coordinates[index * 2 + 1]]);
      }
      return line;
    });
    return expanded;
  } };
  packedMeshes.set(mesh, packed);
  return mesh;
}
