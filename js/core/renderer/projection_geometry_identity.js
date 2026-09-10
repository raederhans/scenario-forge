// Geometry producers advance this token when mutating a projection. Object
// identity also distinguishes replacement projections and path streams.
const generations = new WeakMap();
let nextGeneration = 0;

export function getProjectionGeometryGeneration(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return 0;
  if (!generations.has(value)) generations.set(value, ++nextGeneration);
  return generations.get(value);
}

export function markProjectionGeometryChanged(projection) {
  if (!projection || (typeof projection !== "object" && typeof projection !== "function")) return 0;
  generations.set(projection, ++nextGeneration);
  return generations.get(projection);
}
