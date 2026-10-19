import { createPackedLineMesh } from "./renderer/packed_line_mesh.js";

const FORMAT = "border-line-mesh-v1";
const MAX_OFFSET = 0xffffffff;
const ARRAY_FIELDS = ["provinceMeshes", "localMeshes"];
const MAP_FIELDS = ["provinceMeshesByCountry", "localMeshesByCountry"];

export function packBorderMeshResult(result) {
  const meshes = [], ids = new Map();
  const reference = (mesh) => {
    if (mesh == null) return mesh;
    if (ids.has(mesh)) return ids.get(mesh);
    if (!Array.isArray(mesh.coordinates)) throw new TypeError("Invalid border mesh coordinates.");
    const id = meshes.length;
    ids.set(mesh, id);
    const properties = {};
    for (const key of Object.keys(mesh)) if (key !== "coordinates") properties[key] = mesh[key];
    meshes.push({ lines: mesh.coordinates, properties });
    return id;
  };
  const references = { ...result };
  for (const field of ARRAY_FIELDS) if (Array.isArray(result[field])) references[field] = result[field].map(reference);
  for (const field of MAP_FIELDS) if (result[field] instanceof Map) {
    references[field] = new Map(Array.from(result[field], ([code, list]) => [code, list.map(reference)]));
  }
  if (Object.hasOwn(result, "mesh")) references.mesh = reference(result.mesh);
  let lineCount = 0, pointCount = 0, valueCount = 0, hasWidePositions = false;
  for (const { lines } of meshes) {
    lineCount += lines.length;
    for (const line of lines) {
      pointCount += line.length;
      for (const point of line) {
        valueCount += point.length;
        if (point.length !== 2) hasWidePositions = true;
      }
    }
  }
  if ([lineCount, pointCount, valueCount].some(count => count > MAX_OFFSET)) throw new RangeError("Border mesh transfer exceeds Uint32 offsets.");
  const coordinates = new Float64Array(pointCount * 2), offsets = new Uint32Array(lineCount + 1);
  const meshOffsets = new Uint32Array(meshes.length + 1);
  const positionValues = hasWidePositions ? new Float64Array(valueCount) : null;
  const positionOffsets = hasWidePositions ? new Uint32Array(pointCount + 1) : null;
  let lineIndex = 0, pointIndex = 0, valueIndex = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    meshOffsets[meshIndex] = lineIndex;
    for (const line of meshes[meshIndex].lines) {
      offsets[lineIndex++] = pointIndex;
      for (const point of line) {
        coordinates[pointIndex * 2] = point[0];
        coordinates[pointIndex * 2 + 1] = point[1];
        if (positionOffsets) {
          positionOffsets[pointIndex] = valueIndex;
          positionValues.set(point, valueIndex);
          valueIndex += point.length;
        }
        pointIndex++;
      }
    }
  }
  offsets[lineIndex] = pointIndex;
  meshOffsets[meshes.length] = lineIndex;
  if (positionOffsets) positionOffsets[pointIndex] = valueIndex;
  const packet = { format: FORMAT, coordinates, offsets, meshOffsets,
    properties: meshes.map(mesh => mesh.properties), references };
  const transfer = [coordinates.buffer, offsets.buffer, meshOffsets.buffer];
  if (positionOffsets) {
    Object.assign(packet, { positionValues, positionOffsets });
    transfer.push(positionValues.buffer, positionOffsets.buffer);
  }
  return { result: packet, transfer };
}

export function unpackBorderMeshResult(packet) {
  // Registration replies and callers supplying an ordinary kernel retain their
  // existing result contract; only BUILD uses this private wire envelope.
  if (packet?.format !== FORMAT) return packet;
  const { coordinates, offsets, meshOffsets, properties, positionValues, positionOffsets } = packet;
  if (!(coordinates instanceof Float64Array) || !(offsets instanceof Uint32Array)
    || !(meshOffsets instanceof Uint32Array) || properties.length + 1 !== meshOffsets.length
    || meshOffsets.at(-1) !== offsets.length - 1) throw new TypeError("Invalid border mesh transfer.");
  const arcs = new Uint32Array(offsets.length - 1);
  for (let index = 0; index < arcs.length; index++) arcs[index] = index;
  const meshes = properties.map((metadata, index) => createPackedLineMesh({ coordinates, offsets,
    arcs: arcs.subarray(meshOffsets[index], meshOffsets[index + 1]), positionValues, positionOffsets }, metadata));
  const reference = (id) => {
    if (id == null) return id;
    if (!Number.isInteger(id) || id < 0 || id >= meshes.length) throw new TypeError("Invalid border mesh reference.");
    return meshes[id];
  };
  const result = { ...packet.references };
  for (const field of ARRAY_FIELDS) if (Array.isArray(result[field])) result[field] = result[field].map(reference);
  for (const field of MAP_FIELDS) if (result[field] instanceof Map) {
    result[field] = new Map(Array.from(result[field], ([code, list]) => [code, list.map(reference)]));
  }
  if (Object.hasOwn(result, "mesh")) result.mesh = reference(result.mesh);
  return result;
}
