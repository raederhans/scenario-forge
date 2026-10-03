// Private startup-bundle wire codec. Always restore standard TopoJSON arcs
// before exposing a startup topology to feature(), merge(), or other clients.
var SCENARIO_FORGE_STARTUP_TOPOLOGY_CODEC_SHARED = globalThis.__scenarioForgeStartupTopologyCodecShared || (() => {
  const ENCODING = "topology-delta-zigzag-uleb128-cross-arc-origin-v1";
  const COMPACT_ENCODING = "topology-delta-zigzag-closed-gzip-v2";
  const REFERENCE_ENCODING = "topology-arc-references-delta-sign-gzip-v1";
  const MAX_REFERENCE_COUNT = 5_000_000;
  const REFERENCE_DEPTHS = { LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
  const FIRST_DELTA_MODE = "first pair stores this arc absolute integer start minus previous nonempty arc start";
  const MAX_ARC_COUNT = 1_000_000;
  const MAX_POINT_COUNT = 5_000_000;
  const INT32_MIN = -2_147_483_648;
  const INT32_MAX = 2_147_483_647;
  const MAX_UINT32 = 4_294_967_295;
  const INVALID_BASE64_ALPHABET = /[^A-Za-z0-9+/]/;

  function fail(message) {
    throw new Error(`[startup_topology_codec] ${message}`);
  }

  function checkedCount(value, name, maximum) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(`${name} is invalid.`);
    return value;
  }

  function base64CharacterCount(byteCount) {
    return Math.ceil(byteCount / 3) * 4;
  }

  function decodeBase64(value, expectedBytes, label) {
    if (typeof value !== "string" || value.length !== base64CharacterCount(expectedBytes) || value.length % 4 !== 0) {
      fail(`${label} base64 length or syntax is invalid.`);
    }
    const paddingStart = value.indexOf("=");
    const paddingCount = paddingStart < 0 ? 0 : value.length - paddingStart;
    if (paddingCount > 2 || (paddingCount > 0 && paddingStart < value.length - 2)) {
      fail(`${label} base64 padding is invalid.`);
    }
    const alphabetLength = paddingStart < 0 ? value.length : paddingStart;
    if (paddingCount === 1 && alphabetLength % 4 !== 3) fail(`${label} base64 padding is invalid.`);
    if (paddingCount === 2 && alphabetLength % 4 !== 2) fail(`${label} base64 padding is invalid.`);
    const alphabet = paddingStart < 0 ? value : value.slice(0, paddingStart);
    if (INVALID_BASE64_ALPHABET.test(alphabet)) fail(`${label} base64 syntax is invalid.`);
    if (paddingCount > 0 && value.slice(paddingStart) !== "=".repeat(paddingCount)) fail(`${label} base64 syntax is invalid.`);
    let binary;
    try {
      binary = atob(value);
    } catch {
      fail(`${label} base64 could not be decoded.`);
    }
    if (binary.length !== expectedBytes) fail(`${label} decoded length is invalid.`);
    const bytes = new Uint8Array(expectedBytes);
    for (let i = 0; i < expectedBytes; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function readSignedVarint(bytes, cursor) {
    let encoded = 0;
    let multiplier = 1;
    for (let byteIndex = 0; byteIndex < 5; byteIndex += 1) {
      if (cursor.offset >= bytes.length) fail("varint stream is truncated.");
      const byte = bytes[cursor.offset++];
      const payload = byte % 128;
      if (byteIndex === 4 && (payload > 15 || byte >= 128)) fail("varint exceeds uint32.");
      encoded += payload * multiplier;
      if (byte < 128) {
        if (encoded > MAX_UINT32) fail("varint exceeds uint32.");
        const value = encoded % 2 === 1 ? -((encoded + 1) / 2) : encoded / 2;
        if (value < INT32_MIN || value > INT32_MAX) fail("decoded integer exceeds int32.");
        return value;
      }
      multiplier *= 128;
    }
    fail("varint exceeds five bytes.");
  }

  function decodeTopology(topology, binary = null) {
    if (!topology || typeof topology !== "object" || !Object.hasOwn(topology, "arcs_encoding")) return topology;
    if (topology.type !== "Topology") fail("encoded value is not a Topology.");
    if (Object.hasOwn(topology, "arcs")) fail("topology contains both arcs and arcs_encoding.");

    const descriptor = topology.arcs_encoding;
    if (!descriptor || typeof descriptor !== "object" || descriptor.encoding !== ENCODING) fail("encoding is unsupported.");
    if (descriptor.first_delta_mode !== FIRST_DELTA_MODE) fail("first-delta mode is unsupported.");

    const arcCount = checkedCount(descriptor.arc_count, "arc_count", MAX_ARC_COUNT);
    const pointCount = checkedCount(descriptor.point_count, "point_count", MAX_POINT_COUNT);
    if (!arcCount || !pointCount) fail("encoded counts must be nonzero.");

    const lengthBytes = binary?.lengths || decodeBase64(descriptor.arc_lengths_u32_le_base64, arcCount * 4, "arc lengths");
    const lengthView = new DataView(lengthBytes.buffer, lengthBytes.byteOffset, lengthBytes.byteLength);
    const arcLengths = new Array(arcCount);
    let summedPoints = 0;
    for (let i = 0; i < arcCount; i += 1) {
      const length = lengthView.getUint32(i * 4, true);
      if (length > pointCount - summedPoints) fail("point_count does not match arc lengths.");
      summedPoints += length;
      arcLengths[i] = length;
    }
    if (summedPoints !== pointCount) fail("point_count does not match arc lengths.");

    const closed = binary?.closed || null;
    let closedCount = 0;
    if (closed) {
      if (closed.length !== Math.ceil(arcCount / 8)) fail("closed flags length mismatch.");
      for (let i = 0; i < arcCount; i += 1) {
        if (closed[i >> 3] & (1 << (i % 8))) {
          if (arcLengths[i] < 2) fail("invalid closed arc.");
          closedCount += 1;
        }
      }
      if (arcCount % 8 && closed.at(-1) >> (arcCount % 8)) fail("unused closed flags.");
    }

    const streamValue = descriptor.delta_pairs_zigzag_uleb128_base64;
    const minStreamBytes = (pointCount - closedCount) * 2;
    const maxStreamBytes = (pointCount - closedCount) * 10;
    if (
      !binary && (typeof streamValue !== "string"
      || streamValue.length < base64CharacterCount(minStreamBytes)
      || streamValue.length > base64CharacterCount(maxStreamBytes))
    ) {
      fail("varint stream size is invalid.");
    }
    const paddingBytes = binary ? 0 : (streamValue.endsWith("==") ? 2 : (streamValue.endsWith("=") ? 1 : 0));
    const streamByteCount = binary ? binary.deltas.length : (streamValue.length / 4) * 3 - paddingBytes;
    if (streamByteCount < minStreamBytes || streamByteCount > maxStreamBytes) fail("varint stream size is invalid.");
    const stream = binary?.deltas || decodeBase64(streamValue, streamByteCount, "varint stream");

    const arcs = new Array(arcCount);
    const cursor = { offset: 0 };
    let previousStartX = 0;
    let previousStartY = 0;
    for (let arcIndex = 0; arcIndex < arcCount; arcIndex += 1) {
      const length = arcLengths[arcIndex];
      const arc = new Array(length);
      let sumX = 0, sumY = 0;
      for (let pointIndex = 0; pointIndex < length; pointIndex += 1) {
        if (closed && pointIndex === length - 1 && (closed[arcIndex >> 3] & (1 << (arcIndex % 8)))) {
          if (-sumX < INT32_MIN || -sumX > INT32_MAX || -sumY < INT32_MIN || -sumY > INT32_MAX) fail("closing delta overflow.");
          arc[pointIndex] = [sumX === 0 ? 0 : -sumX, sumY === 0 ? 0 : -sumY];
          continue;
        }
        let dx = readSignedVarint(stream, cursor);
        let dy = readSignedVarint(stream, cursor);
        if (pointIndex === 0) {
          dx += previousStartX;
          dy += previousStartY;
          if (dx < INT32_MIN || dx > INT32_MAX || dy < INT32_MIN || dy > INT32_MAX) {
            fail("first-point predictor overflow.");
          }
          previousStartX = dx;
          previousStartY = dy;
        } else {
          sumX += dx;
          sumY += dy;
        }
        arc[pointIndex] = [dx, dy];
      }
      arcs[arcIndex] = arc;
    }
    if (cursor.offset !== stream.length) fail("varint stream has trailing bytes.");

    const decoded = { ...topology };
    delete decoded.arcs_encoding;
    decoded.arcs = arcs;
    return decoded;
  }

  async function inflateText(value, expectedBytes, label) {
    if (typeof value !== "string" || value.length > base64CharacterCount(expectedBytes + Math.ceil(expectedBytes / 1000) + 1024)) fail(`${label} compressed size is invalid.`);
    const padding = value.endsWith("==") ? 2 : (value.endsWith("=") ? 1 : 0);
    const compressed = decodeBase64(value, value.length / 4 * 3 - padding, label);
    const decoder = globalThis.__scenarioForgeJsonResourceDecoderShared;
    if (!decoder?.decompressGzip) fail("gzip decoder is unavailable.");
    const bytes = new Uint8Array(await decoder.decompressGzip(compressed, { label, maxOutputBytes: expectedBytes }));
    if (bytes.length !== expectedBytes) fail(`${label} decoded length mismatch.`);
    return bytes;
  }

  function referenceGeometries(objects) {
    if (!objects || typeof objects !== "object" || Array.isArray(objects)) fail("invalid topology objects.");
    const result = [];
    function visit(geometry, nesting = 0) {
      if (!geometry || typeof geometry !== "object" || nesting > 64) fail("invalid reference geometry.");
      if (geometry.type === "GeometryCollection") {
        for (const child of geometry.geometries || []) visit(child, nesting + 1);
      } else if (Object.hasOwn(REFERENCE_DEPTHS, geometry.type) && Object.hasOwn(geometry, "arcs")) {
        result.push([geometry, REFERENCE_DEPTHS[geometry.type]]);
      }
    }
    for (const name of Object.keys(objects).sort()) visit(objects[name]);
    return result;
  }

  async function decodeStartupTopology(input) {
    if (!input || typeof input !== "object") return input;
    let topology = input;
    const descriptor = topology.arcs_encoding;
    if (descriptor?.encoding === COMPACT_ENCODING) {
      const arcCount = checkedCount(descriptor.arc_count, "arc_count", MAX_ARC_COUNT);
      const pointCount = checkedCount(descriptor.point_count, "point_count", MAX_POINT_COUNT);
      const deltaBytes = checkedCount(descriptor.delta_bytes, "delta_bytes", pointCount * 10);
      if (!arcCount || !pointCount) fail("encoded counts must be nonzero.");
      const lengths = await inflateText(descriptor.lengths_gzip_base64, arcCount * 4, "arc lengths");
      const closed = await inflateText(descriptor.closed_gzip_base64, Math.ceil(arcCount / 8), "closed flags");
      const deltas = await inflateText(descriptor.deltas_gzip_base64, deltaBytes, "deltas");
      topology = decodeTopology({ ...topology, arcs_encoding: {
        encoding: ENCODING, arc_count: arcCount, point_count: pointCount, first_delta_mode: FIRST_DELTA_MODE,
      } }, { lengths, closed, deltas });
    } else {
      topology = decodeTopology(topology);
    }
    if (!Object.hasOwn(topology, "arc_references_encoding")) return topology;
    const refsDescriptor = topology.arc_references_encoding;
    if (refsDescriptor?.encoding !== REFERENCE_ENCODING) fail("reference encoding is unsupported.");
    const count = checkedCount(refsDescriptor.reference_count, "reference_count", MAX_REFERENCE_COUNT);
    const containers = checkedCount(refsDescriptor.container_count, "container_count", MAX_REFERENCE_COUNT);
    const refsBytes = checkedCount(refsDescriptor.refs_bytes, "refs_bytes", count * 5);
    const lengthsBytes = checkedCount(refsDescriptor.lengths_bytes, "lengths_bytes", containers * 5);
    const refs = await inflateText(refsDescriptor.refs_gzip_base64, refsBytes, "references");
    const lengths = await inflateText(refsDescriptor.lengths_gzip_base64, lengthsBytes, "reference lengths");
    const signs = await inflateText(refsDescriptor.signs_gzip_base64, Math.ceil(count / 8), "reference signs");
    if (count % 8 && signs.at(-1) >> (count % 8)) fail("unused reference signs.");
    const objects = structuredClone(topology.objects);
    const cursor = { offset: 0 }, lengthCursor = { offset: 0 };
    let previous = 0, used = 0, usedContainers = 0;
    function unpack(depth) {
      if (++usedContainers > containers) fail("reference container mismatch.");
      const length = readSignedVarint(lengths, lengthCursor);
      if (length < 0 || length > (depth > 1 ? containers - usedContainers : count - used)) fail("reference length out of range.");
      const values = new Array(length);
      for (let i = 0; i < length; i += 1) {
        if (depth > 1) values[i] = unpack(depth - 1);
        else {
          previous += readSignedVarint(refs, cursor);
          if (previous < 0 || previous >= (topology.arcs?.length || 0)) fail("reference index out of range.");
          values[i] = signs[used >> 3] & (1 << (used % 8)) ? ~previous : previous;
          used += 1;
        }
      }
      return values;
    }
    for (const [geometry, depth] of referenceGeometries(objects)) {
      if (geometry.arcs !== null) fail("conflicting arc references.");
      geometry.arcs = unpack(depth);
    }
    if (used !== count || usedContainers !== containers || cursor.offset !== refs.length || lengthCursor.offset !== lengths.length) fail("reference stream count or trailing bytes mismatch.");
    const decoded = { ...topology, objects };
    delete decoded.arc_references_encoding;
    return decoded;
  }

  return Object.freeze({ decodeTopology, decodeStartupTopology, encoding: ENCODING });
})();

globalThis.__scenarioForgeStartupTopologyCodecShared = SCENARIO_FORGE_STARTUP_TOPOLOGY_CODEC_SHARED;
if (typeof module === "object" && module && module.exports) {
  module.exports = SCENARIO_FORGE_STARTUP_TOPOLOGY_CODEC_SHARED;
}
