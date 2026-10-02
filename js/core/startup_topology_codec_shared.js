// Private startup-bundle wire codec. Always restore standard TopoJSON arcs
// before exposing a startup topology to feature(), merge(), or other clients.
var SCENARIO_FORGE_STARTUP_TOPOLOGY_CODEC_SHARED = globalThis.__scenarioForgeStartupTopologyCodecShared || (() => {
  const ENCODING = "topology-delta-zigzag-uleb128-cross-arc-origin-v1";
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

  function decodeTopology(topology) {
    if (!topology || typeof topology !== "object" || !Object.hasOwn(topology, "arcs_encoding")) return topology;
    if (topology.type !== "Topology") fail("encoded value is not a Topology.");
    if (Object.hasOwn(topology, "arcs")) fail("topology contains both arcs and arcs_encoding.");

    const descriptor = topology.arcs_encoding;
    if (!descriptor || typeof descriptor !== "object" || descriptor.encoding !== ENCODING) fail("encoding is unsupported.");
    if (descriptor.first_delta_mode !== FIRST_DELTA_MODE) fail("first-delta mode is unsupported.");

    const arcCount = checkedCount(descriptor.arc_count, "arc_count", MAX_ARC_COUNT);
    const pointCount = checkedCount(descriptor.point_count, "point_count", MAX_POINT_COUNT);
    if (!arcCount || !pointCount) fail("encoded counts must be nonzero.");

    const lengthBytes = decodeBase64(descriptor.arc_lengths_u32_le_base64, arcCount * 4, "arc lengths");
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

    const streamValue = descriptor.delta_pairs_zigzag_uleb128_base64;
    const minStreamBytes = pointCount * 2;
    const maxStreamBytes = pointCount * 10;
    if (
      typeof streamValue !== "string"
      || streamValue.length < base64CharacterCount(minStreamBytes)
      || streamValue.length > base64CharacterCount(maxStreamBytes)
    ) {
      fail("varint stream size is invalid.");
    }
    const paddingBytes = streamValue.endsWith("==") ? 2 : (streamValue.endsWith("=") ? 1 : 0);
    const streamByteCount = (streamValue.length / 4) * 3 - paddingBytes;
    if (streamByteCount < minStreamBytes || streamByteCount > maxStreamBytes) fail("varint stream size is invalid.");
    const stream = decodeBase64(streamValue, streamByteCount, "varint stream");

    const arcs = new Array(arcCount);
    const cursor = { offset: 0 };
    let previousStartX = 0;
    let previousStartY = 0;
    for (let arcIndex = 0; arcIndex < arcCount; arcIndex += 1) {
      const length = arcLengths[arcIndex];
      const arc = new Array(length);
      for (let pointIndex = 0; pointIndex < length; pointIndex += 1) {
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

  return Object.freeze({ decodeTopology, encoding: ENCODING });
})();

globalThis.__scenarioForgeStartupTopologyCodecShared = SCENARIO_FORGE_STARTUP_TOPOLOGY_CODEC_SHARED;
if (typeof module === "object" && module && module.exports) {
  module.exports = SCENARIO_FORGE_STARTUP_TOPOLOGY_CODEC_SHARED;
}
