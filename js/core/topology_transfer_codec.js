// Keep the TopoJSON object graph in structured clone, while transferring the large arc numbers.
export function packTopologyForTransfer(topology) {
  const arcs = topology.arcs || [];
  let pointCount = 0;
  let valueCount = 0;
  for (const arc of arcs) {
    pointCount += arc.length;
    for (const point of arc) valueCount += point.length;
  }
  const arcLengths = new Uint32Array(arcs.length);
  const pointLengths = new Uint32Array(pointCount);
  const values = new Float64Array(valueCount);
  let pointIndex = 0;
  let valueIndex = 0;
  arcs.forEach((arc, arcIndex) => {
    arcLengths[arcIndex] = arc.length;
    for (const point of arc) {
      pointLengths[pointIndex++] = point.length;
      values.set(point, valueIndex);
      valueIndex += point.length;
    }
  });
  const { arcs: _arcs, ...topologyWithoutArcs } = topology;
  return {
    topology: topologyWithoutArcs,
    topologyArcs: { arcLengths, pointLengths, values },
    transfer: [arcLengths.buffer, pointLengths.buffer, values.buffer],
  };
}

// Bound both passes by elapsed time and coordinate work, including a single
// large arc (or unusually wide point). Keep the synchronous wire format exact.
export async function packTopologyForTransferAsync(topology, {
  signal,
  nowMs = () => performance.now(),
  yieldControl = () => globalThis.scheduler?.yield
    ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)),
  timeBudgetMs = 4,
  coordinateBatchSize = 16_384,
} = {}) {
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const error = new Error("Topology preparation aborted.");
      error.name = "AbortError";
      throw error;
    }
  };
  const batchSize = Math.max(1, Number(coordinateBatchSize) || 16_384);
  const checkInterval = Math.min(256, batchSize);
  let work = 0;
  let uncheckedWork = 0;
  let startedAt = nowMs();
  function checkpoint(amount = 1) {
    work += amount;
    uncheckedWork += amount;
    if (uncheckedWork < checkInterval) return null;
    throwIfAborted();
    uncheckedWork = 0;
    if (work < batchSize && nowMs() - startedAt < timeBudgetMs) return null;
    return Promise.resolve(yieldControl()).then(() => {
      throwIfAborted();
      work = 0;
      startedAt = nowMs();
    });
  }
  throwIfAborted();
  const arcs = topology.arcs || [];
  let pointCount = 0;
  let valueCount = 0;
  for (const arc of arcs) {
    pointCount += arc.length;
    for (const point of arc) {
      valueCount += point.length;
      const pause = checkpoint(Math.max(1, point.length));
      if (pause) await pause;
    }
    const pause = checkpoint();
    if (pause) await pause;
  }
  throwIfAborted();
  const arcLengths = new Uint32Array(arcs.length);
  const pointLengths = new Uint32Array(pointCount);
  const values = new Float64Array(valueCount);
  let pointIndex = 0;
  let valueIndex = 0;
  for (let arcIndex = 0; arcIndex < arcs.length; arcIndex++) {
    const arc = arcs[arcIndex];
    arcLengths[arcIndex] = arc.length;
    for (const point of arc) {
      pointLengths[pointIndex++] = point.length;
      for (let axis = 0; axis < point.length; axis++) {
        values[valueIndex++] = point[axis];
        const pause = checkpoint();
        if (pause) await pause;
      }
      const pause = checkpoint();
      if (pause) await pause;
    }
    const pause = checkpoint();
    if (pause) await pause;
  }
  throwIfAborted();
  const { arcs: _arcs, ...topologyWithoutArcs } = topology;
  return {
    topology: topologyWithoutArcs,
    topologyArcs: { arcLengths, pointLengths, values },
    transfer: [arcLengths.buffer, pointLengths.buffer, values.buffer],
  };
}

export function unpackTopologyFromTransfer(topology, topologyArcs) {
  const { arcLengths, pointLengths, values } = topologyArcs;
  const arcs = new Array(arcLengths.length);
  let pointIndex = 0;
  let valueIndex = 0;
  for (let arcIndex = 0; arcIndex < arcLengths.length; arcIndex++) {
    const arc = new Array(arcLengths[arcIndex]);
    for (let index = 0; index < arc.length; index++) {
      const length = pointLengths[pointIndex++];
      const point = new Array(length);
      for (let axis = 0; axis < length; axis++) point[axis] = values[valueIndex++];
      arc[index] = point;
    }
    arcs[arcIndex] = arc;
  }
  if (pointIndex !== pointLengths.length || valueIndex !== values.length) throw new Error("Invalid transferred topology arcs.");
  return { ...topology, arcs };
}
