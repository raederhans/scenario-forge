import { createPaintContourGraphBuilder } from '../core/renderer/paint_contour_graph.js';
let builder = null;
self.onmessage = ({ data }) => {
  const { type, taskId } = data;
  if (type === 'CANCEL_TASK') return;
  try {
    let result = null;
    if (type === 'BEGIN') builder = createPaintContourGraphBuilder();
    else if (!builder) throw new Error('Paint contour source is not registered');
    else if (type === 'PATCH') builder.patch(data.features, data.removedIds);
    else if (type === 'FINISH') result = builder.finish();
    else throw new Error('Unknown paint contour request');
    const transfer = result ? [result.coordinates.buffer, result.offsets.buffer, result.owners.buffer] : [];
    self.postMessage({ type: 'RESULT', taskId, result }, transfer);
  } catch (error) {
    self.postMessage({ type: 'ERROR', taskId, message: error?.message || String(error) });
  }
};
