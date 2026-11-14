import {
  INTENSITY_FIELD_CHANNEL_IDS,
  INTENSITY_FIELD_GRID,
  bakeIntensityComposite,
  createIntensityFieldsState,
} from "../intensity_field.js";

function toBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return globalThis.btoa(binary);
}

function fromBase64(value) {
  if (!value) return new Uint8Array();
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(String(value), "base64"));
  }
  const binary = globalThis.atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeGridByte(value) {
  const numeric = Number(value);
  return Math.max(0, Math.min(255, Math.round((Number.isFinite(numeric) ? numeric : 1) * 127.5)));
}

function decodeGridByte(byte) {
  const numeric = Math.max(0, Math.min(255, Number(byte) || 0));
  return numeric === 128 ? INTENSITY_FIELD_GRID.neutral : Math.max(0, Math.min(2, numeric / 127.5));
}

// 项目文件只保存 base grid 的 RLE-u8；composite 在加载后重建，避免把派生数据写进保存合同。
function encodeGrid(values) {
  const encoded = [];
  let index = 0;
  while (index < values.length) {
    const byte = encodeGridByte(values[index]);
    let runLength = 1;
    while (index + runLength < values.length && runLength < 255) {
      const nextByte = encodeGridByte(values[index + runLength]);
      if (nextByte !== byte) break;
      runLength += 1;
    }
    encoded.push(runLength, byte);
    index += runLength;
  }
  return {
    encoding: "rle-u8-base64",
    data: toBase64(Uint8Array.from(encoded)),
  };
}

function decodeGrid(payload) {
  const expectedLength = INTENSITY_FIELD_GRID.columns * INTENSITY_FIELD_GRID.rows;
  const values = new Float32Array(expectedLength).fill(INTENSITY_FIELD_GRID.neutral);
  if (!payload || payload.encoding !== "rle-u8-base64") return values;
  const bytes = fromBase64(payload.data);
  let cursor = 0;
  for (let index = 0; index + 1 < bytes.length && cursor < expectedLength; index += 2) {
    const runLength = bytes[index];
    const value = decodeGridByte(bytes[index + 1]);
    for (let runIndex = 0; runIndex < runLength && cursor < expectedLength; runIndex += 1) {
      values[cursor] = value;
      cursor += 1;
    }
  }
  return values;
}

function clonePoint(point) {
  return {
    id: point.id,
    lon: point.lon,
    lat: point.lat,
    strength: point.strength,
    radiusDeg: point.radiusDeg,
    falloff: point.falloff,
  };
}

export function createDefaultIntensityFieldsState() {
  return createIntensityFieldsState();
}

export function normalizeIntensityFieldsState(rawState) {
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  // 运行时对象已持有 Float32Array 时保持原引用，避免每帧编辑把大网格反复解码和复制。
  const runtimeReady = INTENSITY_FIELD_CHANNEL_IDS.every((channelId) => {
    const channel = raw.channels?.[channelId];
    return (
      channel
      && channel.grid?.base instanceof Float32Array
      && channel.grid?.composite instanceof Float32Array
      && channel.grid.base.length === INTENSITY_FIELD_GRID.columns * INTENSITY_FIELD_GRID.rows
      && channel.grid.composite.length === INTENSITY_FIELD_GRID.columns * INTENSITY_FIELD_GRID.rows
    );
  });
  if (runtimeReady) return raw;
  const rawChannels = raw.channels && typeof raw.channels === "object" ? raw.channels : raw;
  const decodedChannels = {};
  INTENSITY_FIELD_CHANNEL_IDS.forEach((channelId) => {
    const rawChannel = rawChannels[channelId] && typeof rawChannels[channelId] === "object"
      ? rawChannels[channelId]
      : {};
    decodedChannels[channelId] = {
      ...rawChannel,
      grid: {
        ...(rawChannel.grid || {}),
        base: rawChannel.grid?.base?.encoding ? decodeGrid(rawChannel.grid.base) : rawChannel.grid?.base,
      },
    };
  });
  return createIntensityFieldsState({ channels: decodedChannels });
}

export function serializeIntensityFieldsState(rawState) {
  const fields = normalizeIntensityFieldsState(rawState);
  const channels = {};
  INTENSITY_FIELD_CHANNEL_IDS.forEach((channelId) => {
    const channel = bakeIntensityComposite(fields.channels[channelId]);
    channels[channelId] = {
      schemaVersion: 1,
      channelId,
      enabled: !!channel.enabled,
      revision: Math.max(0, Math.round(Number(channel.revision) || 0)),
      points: channel.points.map(clonePoint),
      grid: {
        bounds: [...INTENSITY_FIELD_GRID.bounds],
        columns: INTENSITY_FIELD_GRID.columns,
        rows: INTENSITY_FIELD_GRID.rows,
        base: encodeGrid(channel.grid.base),
      },
    };
  });
  return {
    schemaVersion: 1,
    channels,
  };
}

export function updateIntensityFieldChannel(rawState, channelId, mutate) {
  const fields = normalizeIntensityFieldsState(rawState);
  const channel = fields.channels[channelId];
  if (!channel) return fields;
  if (typeof mutate === "function") {
    mutate(channel, fields);
  }
  channel.revision = (Math.max(0, Math.round(Number(channel.revision) || 0)) + 1);
  bakeIntensityComposite(channel);
  return fields;
}
