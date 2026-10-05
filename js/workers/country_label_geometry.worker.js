import '../../vendor/topojson-client.min.js';
import '../../vendor/d3.v7.min.js';
import '../core/geometry_transfer_codec_shared.js';
import { mergeCountryLabelGroups, unpackCountryLabelTransport } from '../core/renderer/country_label_geometry.js';

self.onmessage = async ({ data }) => {
  const { type, taskId } = data;
  if (type === 'CANCEL_TASK') return;
  try {
    if (type !== 'BUILD_COUNTRY_LABELS') throw new Error('Unsupported country label geometry task');
    const entries = unpackCountryLabelTransport(data.geometryTransport), groups = new Map();
    for (const { countryCode, feature } of entries) {
      if (!groups.has(countryCode)) groups.set(countryCode, []);
      groups.get(countryCode).push(feature);
    }
    const topology = data.topology ? { ...data.topology,
      arcs: unpackCountryLabelTransport(data.arcTransport)[0].coordinates, objects: {} } : null;
    const records = await mergeCountryLabelGroups([...groups], {
      topology, topojson: globalThis.topojson, geoArea: globalThis.d3.geoArea,
      geoContains: globalThis.d3.geoContains, geoBounds: globalThis.d3.geoBounds,
    });
    const packed = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(records);
    self.postMessage({ type: 'RESULT', taskId, result: packed.payload }, packed.transferables);
  } catch (error) {
    self.postMessage({ type: 'ERROR', taskId, message: error?.message || String(error) });
  }
};
