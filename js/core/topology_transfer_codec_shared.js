// Classic startup workers and module border workers share this lossless arc transport.
// Only newly allocated buffers are transferred; source topology remains usable.
var SCENARIO_FORGE_TOPOLOGY_TRANSFER_CODEC_SHARED = (() => {
  function packTopologyForTransfer(topology, { minCoordinateCount = 0 } = {}) {
    const arcs = topology.arcs || [];
    let pointCount = 0;
    let valueCount = 0;
    for (const arc of arcs) {
      pointCount += arc.length;
      for (const point of arc) valueCount += point.length;
    }
    if (valueCount < minCoordinateCount) return null;
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

  function unpackTopologyFromTransfer(topology, topologyArcs) {
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

  return Object.freeze({ packTopologyForTransfer, unpackTopologyFromTransfer });
})();
globalThis.__scenarioForgeTopologyTransferCodecShared = SCENARIO_FORGE_TOPOLOGY_TRANSFER_CODEC_SHARED;
