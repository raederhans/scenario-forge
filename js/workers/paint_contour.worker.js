import { createPaintContourGraphBuilder } from '../core/renderer/paint_contour_graph.js';
import '../core/geometry_transfer_codec_shared.js';
let builder = null;
let finished = false, dirty = true;
self.onmessage = ({ data }) => {
  const { type, taskId } = data;
  if (type === 'CANCEL_TASK') return;
  try {
    let result = null;
    if (type === 'BEGIN') { builder = createPaintContourGraphBuilder({ nearSeamTolerance: data.nearSeamTolerance }); finished = false; dirty = true; }
    else if (!builder) throw new Error('Paint contour source is not registered');
    else if (type === 'WATER') { builder.setWaterMask(data.waterMask); dirty = true; }
    else if (type === 'PATCH') {
      const certified = data.certifiedEquivalent === true;
      if (certified && (!finished || dirty || data.removedIds?.length)) throw new Error('No completed unchanged contour graph');
      // Any failed decoding/patch must prevent reuse of the previous result.
      dirty = true;
      let features = data.features;
      if (data.geometryTransport) {
        const transport = data.geometryTransport;
        if (transport.encoding !== 'geo-f64-batches-v1' || !Array.isArray(transport.batches)) {
          throw new Error('Invalid paint contour geometry transport');
        }
        features = transport.batches.flatMap(batch => batch?.encoding === 'geo-f64-v1'
          ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(batch) : batch);
      }
      builder.patch(features, data.removedIds);
      if (certified) dirty = false;
    }
    else if (type === 'CONFIRM') {
      if (!finished || dirty) throw new Error('No completed unchanged contour graph');
      result = { unchanged: true };
    }
    else if (type === 'FINISH') result = builder.finish();
    else throw new Error('Unknown paint contour request');
    const transfer = result && !result.unchanged ? [result.coordinates.buffer, result.offsets.buffer, result.owners.buffer] : [];
    self.postMessage({ type: 'RESULT', taskId, result }, transfer);
    if (type === 'FINISH') { finished = true; dirty = false; }
  } catch (error) {
    dirty = true;
    self.postMessage({ type: 'ERROR', taskId, message: error?.message || String(error) });
  }
};
