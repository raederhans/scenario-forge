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
