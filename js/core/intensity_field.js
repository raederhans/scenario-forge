export const INTENSITY_FIELD_GRID = Object.freeze({
  bounds: Object.freeze([-180, -90, 180, 90]),
  columns: 720,
  rows: 360,
  neutral: 1,
  min: 0,
  max: 2,
});

// 强度场是可保存的全局乘数网格：1 表示不改动原图层，0-2 只表达相对增强/削弱。
export const INTENSITY_FIELD_CHANNELS = Object.freeze({
  physicalAtlas: Object.freeze({
    id: "physicalAtlas",
    targetPasses: Object.freeze(["physicalBase", "contextBase"]),
    applyMode: "spatialAlpha",
    label: "Atlas",
  }),
  physicalContour: Object.freeze({
    id: "physicalContour",
    targetPasses: Object.freeze(["contextBase"]),
    applyMode: "spatialAlpha",
    label: "Contour",
  }),
  urbanGlow: Object.freeze({
    id: "urbanGlow",
    targetPasses: Object.freeze(["contextBase", "dayNight"]),
    applyMode: "featureMultiplier",
    label: "Glow",
  }),
  oceanDepth: Object.freeze({
    id: "oceanDepth",
    targetPasses: Object.freeze(["background"]),
    applyMode: "passMask",
    label: "Depth",
  }),
});

export const INTENSITY_FIELD_CHANNEL_IDS = Object.freeze(Object.keys(INTENSITY_FIELD_CHANNELS));

export function getIntensityFieldTargetPasses(channelId) {
  const channel = INTENSITY_FIELD_CHANNELS[channelId];
  if (!channel) return [];
  if (Array.isArray(channel.targetPasses)) return [...channel.targetPasses];
  return channel.targetPass ? [channel.targetPass] : [];
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function createNeutralGridValues() {
  return new Float32Array(INTENSITY_FIELD_GRID.columns * INTENSITY_FIELD_GRID.rows).fill(INTENSITY_FIELD_GRID.neutral);
}

function getGridLength() {
  return INTENSITY_FIELD_GRID.columns * INTENSITY_FIELD_GRID.rows;
}

function normalizeGridValues(values) {
  const expectedLength = getGridLength();
  if (!values) return createNeutralGridValues();
  const source = ArrayBuffer.isView(values) || Array.isArray(values) ? values : [];
  if (source instanceof Float32Array && source.length === expectedLength) {
    for (let index = 0; index < expectedLength; index += 1) {
      source[index] = clampNumber(
        toFiniteNumber(source[index], INTENSITY_FIELD_GRID.neutral),
        INTENSITY_FIELD_GRID.min,
        INTENSITY_FIELD_GRID.max,
      );
    }
    return source;
  }
  const next = createNeutralGridValues();
  const limit = Math.min(source.length, expectedLength);
  for (let index = 0; index < limit; index += 1) {
    next[index] = clampNumber(toFiniteNumber(source[index], INTENSITY_FIELD_GRID.neutral), INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max);
  }
  return next;
}

export function normalizeIntensityPoint(rawPoint, index = 0) {
  if (!rawPoint || typeof rawPoint !== "object") return null;
  const lon = toFiniteNumber(rawPoint.lon, NaN);
  const lat = toFiniteNumber(rawPoint.lat, NaN);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const strength = rawPoint.strength === undefined && rawPoint.weight !== undefined
    ? 1 + (toFiniteNumber(rawPoint.weight, 0) * 0.35)
    : toFiniteNumber(rawPoint.strength, 1);
  return {
    id: String(rawPoint.id || `point-${index + 1}`).trim() || `point-${index + 1}`,
    lon: clampNumber(lon, -180, 180),
    lat: clampNumber(lat, -90, 90),
    strength: clampNumber(strength, INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max),
    radiusDeg: clampNumber(toFiniteNumber(rawPoint.radiusDeg, toFiniteNumber(rawPoint.radiusKm, 500) / 111), 0.25, 30),
    falloff: String(rawPoint.falloff || "smooth").trim().toLowerCase() === "linear" ? "linear" : "smooth",
  };
}

export function createIntensityFieldChannel(channelId, rawChannel = {}) {
  const normalizedChannelId = INTENSITY_FIELD_CHANNELS[channelId] ? channelId : "physicalAtlas";
  const raw = rawChannel && typeof rawChannel === "object" ? rawChannel : {};
  const channel = {
    schemaVersion: 1,
    channelId: normalizedChannelId,
    enabled: raw.enabled === undefined ? false : !!raw.enabled,
    revision: Math.max(0, Math.round(toFiniteNumber(raw.revision, 0))),
    grid: {
      bounds: [...INTENSITY_FIELD_GRID.bounds],
      columns: INTENSITY_FIELD_GRID.columns,
      rows: INTENSITY_FIELD_GRID.rows,
      base: normalizeGridValues(raw.grid?.base || raw.base),
      composite: normalizeGridValues(raw.grid?.composite || raw.composite),
    },
    points: (Array.isArray(raw.points) ? raw.points : [])
      .map(normalizeIntensityPoint)
      .filter(Boolean),
  };
  bakeIntensityComposite(channel);
  return channel;
}

export function createIntensityFieldsState(rawState = {}) {
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  const rawChannels = raw.channels && typeof raw.channels === "object" ? raw.channels : raw;
  const channels = {};
  INTENSITY_FIELD_CHANNEL_IDS.forEach((channelId) => {
    channels[channelId] = createIntensityFieldChannel(channelId, rawChannels[channelId]);
  });
  return {
    schemaVersion: 1,
    channels,
  };
}

function getGridIndex(column, row) {
  const wrappedColumn = ((column % INTENSITY_FIELD_GRID.columns) + INTENSITY_FIELD_GRID.columns) % INTENSITY_FIELD_GRID.columns;
  const clampedRow = clampNumber(row, 0, INTENSITY_FIELD_GRID.rows - 1);
  return clampedRow * INTENSITY_FIELD_GRID.columns + wrappedColumn;
}

function getCellLonLat(column, row) {
  const lonStep = 360 / INTENSITY_FIELD_GRID.columns;
  const latStep = 180 / INTENSITY_FIELD_GRID.rows;
  return {
    lon: -180 + ((column + 0.5) * lonStep),
    lat: 90 - ((row + 0.5) * latStep),
  };
}

function getWrappedLonDelta(left, right) {
  const raw = Math.abs(left - right);
  return Math.min(raw, 360 - raw);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clampNumber((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - (2 * t));
}

function getPointInfluence(point, lon, lat) {
  const dx = getWrappedLonDelta(point.lon, lon);
  const dy = Math.abs(point.lat - lat);
  const distance = Math.hypot(dx, dy);
  if (distance > point.radiusDeg) return 0;
  const linear = 1 - (distance / Math.max(0.0001, point.radiusDeg));
  return point.falloff === "linear" ? linear : smoothstep(0, 1, linear);
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const x = clampNumber(Math.floor(toFiniteNumber(rect.x, 0)), 0, INTENSITY_FIELD_GRID.columns - 1);
  const y = clampNumber(Math.floor(toFiniteNumber(rect.y, 0)), 0, INTENSITY_FIELD_GRID.rows - 1);
  const width = clampNumber(Math.ceil(toFiniteNumber(rect.width, 0)), 0, INTENSITY_FIELD_GRID.columns - x);
  const height = clampNumber(Math.ceil(toFiniteNumber(rect.height, 0)), 0, INTENSITY_FIELD_GRID.rows - y);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function mergeRects(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width - 1, right.x + right.width - 1);
  const maxY = Math.max(left.y + left.height - 1, right.y + right.height - 1);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function getBrushRowWindow(centerLat, radius) {
  const latStep = 180 / INTENSITY_FIELD_GRID.rows;
  const top = clampNumber(centerLat + radius, -90, 90);
  const bottom = clampNumber(centerLat - radius, -90, 90);
  return {
    start: clampNumber(Math.floor((90 - top) / latStep) - 1, 0, INTENSITY_FIELD_GRID.rows - 1),
    end: clampNumber(Math.ceil((90 - bottom) / latStep) + 1, 0, INTENSITY_FIELD_GRID.rows - 1),
  };
}

function getBrushColumnRanges(centerLon, radius) {
  const lonStep = 360 / INTENSITY_FIELD_GRID.columns;
  const minLon = centerLon - radius;
  const maxLon = centerLon + radius;
  const toColumn = (lon) => clampNumber(Math.floor(((lon + 180) / 360) * INTENSITY_FIELD_GRID.columns), 0, INTENSITY_FIELD_GRID.columns - 1);
  if (minLon < -180 || maxLon > 180) {
    const wrappedMin = minLon < -180 ? minLon + 360 : minLon;
    const wrappedMax = maxLon > 180 ? maxLon - 360 : maxLon;
    return [
      { start: 0, end: toColumn(wrappedMax) + 1 },
      { start: toColumn(wrappedMin) - 1, end: INTENSITY_FIELD_GRID.columns - 1 },
    ].map((range) => ({
      start: clampNumber(range.start, 0, INTENSITY_FIELD_GRID.columns - 1),
      end: clampNumber(range.end, 0, INTENSITY_FIELD_GRID.columns - 1),
    }));
  }
  return [{
    start: clampNumber(toColumn(minLon) - 1, 0, INTENSITY_FIELD_GRID.columns - 1),
    end: clampNumber(toColumn(maxLon) + 1, 0, INTENSITY_FIELD_GRID.columns - 1),
  }];
}

function bakeCompositeCell(target, points, column, row) {
  const { lon, lat } = getCellLonLat(column, row);
  const index = getGridIndex(column, row);
  target.grid.composite[index] = target.grid.base[index];
  let influenceTotal = 0;
  let weightedTotal = 0;
  points.forEach((point) => {
    const influence = getPointInfluence(point, lon, lat);
    if (influence <= 0) return;
    influenceTotal += influence;
    weightedTotal += influence * point.strength;
  });
  if (influenceTotal > 0) {
    const baked = weightedTotal / influenceTotal;
    const blend = clampNumber(influenceTotal, 0, 1);
    target.grid.composite[index] = clampNumber(
      target.grid.base[index] + ((baked - target.grid.base[index]) * blend),
      INTENSITY_FIELD_GRID.min,
      INTENSITY_FIELD_GRID.max,
    );
  }
}

export function bakeIntensityComposite(channel, rect = null) {
  const target = channel && typeof channel === "object" ? channel : createIntensityFieldChannel("physicalAtlas");
  const base = normalizeGridValues(target.grid?.base || target.base);
  const composite = target.grid?.composite instanceof Float32Array && target.grid.composite.length === getGridLength()
    ? normalizeGridValues(target.grid.composite)
    : createNeutralGridValues();
  const points = (Array.isArray(target.points) ? target.points : [])
    .map(normalizeIntensityPoint)
    .filter(Boolean);
  target.grid = {
    bounds: [...INTENSITY_FIELD_GRID.bounds],
    columns: INTENSITY_FIELD_GRID.columns,
    rows: INTENSITY_FIELD_GRID.rows,
    base,
    composite,
  };
  target.points = points;
  const dirtyRect = normalizeRect(rect);
  if (!dirtyRect) {
    target.grid.composite.set(base);
  }
  const scanRect = dirtyRect || {
    x: 0,
    y: 0,
    width: INTENSITY_FIELD_GRID.columns,
    height: INTENSITY_FIELD_GRID.rows,
  };
  for (let row = scanRect.y; row < scanRect.y + scanRect.height; row += 1) {
    for (let column = scanRect.x; column < scanRect.x + scanRect.width; column += 1) {
      bakeCompositeCell(target, points, column, row);
    }
  }
  return target;
}

export function stampIntensityBrush(channel, { lon, lat, radiusDeg = 3, strength = 1, mode = "paint" } = {}) {
  const target = bakeIntensityComposite(channel, { x: 0, y: 0, width: 0, height: 0 });
  const centerLon = clampNumber(toFiniteNumber(lon, 0), -180, 180);
  const centerLat = clampNumber(toFiniteNumber(lat, 0), -90, 90);
  const radius = clampNumber(toFiniteNumber(radiusDeg, 3), 0.25, 30);
  const nextStrength = mode === "erase"
    ? INTENSITY_FIELD_GRID.neutral
    : clampNumber(toFiniteNumber(strength, INTENSITY_FIELD_GRID.neutral), INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max);
  const rowWindow = getBrushRowWindow(centerLat, radius);
  const columnRanges = getBrushColumnRanges(centerLon, radius);
  let dirtyRect = null;
  let touched = false;
  columnRanges.forEach((range) => {
    let localMinColumn = INTENSITY_FIELD_GRID.columns;
    let localMaxColumn = 0;
    let localTouched = false;
    for (let row = rowWindow.start; row <= rowWindow.end; row += 1) {
      for (let column = range.start; column <= range.end; column += 1) {
        const { lon: cellLon, lat: cellLat } = getCellLonLat(column, row);
        const influence = getPointInfluence({ lon: centerLon, lat: centerLat, radiusDeg: radius, falloff: "smooth" }, cellLon, cellLat);
        if (influence <= 0) continue;
        const index = getGridIndex(column, row);
        target.grid.base[index] = clampNumber(
          target.grid.base[index] + ((nextStrength - target.grid.base[index]) * influence),
          INTENSITY_FIELD_GRID.min,
          INTENSITY_FIELD_GRID.max,
        );
        localMinColumn = Math.min(localMinColumn, column);
        localMaxColumn = Math.max(localMaxColumn, column);
        localTouched = true;
        touched = true;
      }
    }
    if (localTouched) {
      dirtyRect = mergeRects(dirtyRect, {
        x: localMinColumn,
        y: rowWindow.start,
        width: localMaxColumn - localMinColumn + 1,
        height: rowWindow.end - rowWindow.start + 1,
      });
    }
  });
  if (dirtyRect) bakeIntensityComposite(target, dirtyRect);
  return touched ? dirtyRect : null;
}

export function sampleIntensityField(fieldsState, channelId, lon, lat) {
  const fields = fieldsState?.channels?.[channelId]?.grid?.composite
    ? fieldsState
    : createIntensityFieldsState(fieldsState);
  const channel = fields.channels[channelId];
  if (!channel?.enabled) return INTENSITY_FIELD_GRID.neutral;
  const values = channel.grid?.composite;
  if (!values || !values.length) return INTENSITY_FIELD_GRID.neutral;
  const normalizedLon = ((clampNumber(toFiniteNumber(lon, 0), -180, 180) + 180) / 360) * INTENSITY_FIELD_GRID.columns;
  const normalizedLat = ((90 - clampNumber(toFiniteNumber(lat, 0), -90, 90)) / 180) * INTENSITY_FIELD_GRID.rows;
  const x0 = Math.floor(normalizedLon);
  const y0 = clampNumber(Math.floor(normalizedLat), 0, INTENSITY_FIELD_GRID.rows - 1);
  const tx = normalizedLon - x0;
  const ty = normalizedLat - y0;
  const y1 = clampNumber(y0 + 1, 0, INTENSITY_FIELD_GRID.rows - 1);
  const v00 = values[getGridIndex(x0, y0)];
  const v10 = values[getGridIndex(x0 + 1, y0)];
  const v01 = values[getGridIndex(x0, y1)];
  const v11 = values[getGridIndex(x0 + 1, y1)];
  const top = v00 + ((v10 - v00) * tx);
  const bottom = v01 + ((v11 - v01) * tx);
  return clampNumber(top + ((bottom - top) * ty), INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max);
}

export function extractFieldRectPatch(channel, rect) {
  const source = bakeIntensityComposite(channel);
  const x = clampNumber(Math.round(rect?.x || 0), 0, INTENSITY_FIELD_GRID.columns - 1);
  const y = clampNumber(Math.round(rect?.y || 0), 0, INTENSITY_FIELD_GRID.rows - 1);
  const width = clampNumber(Math.round(rect?.width || 0), 0, INTENSITY_FIELD_GRID.columns - x);
  const height = clampNumber(Math.round(rect?.height || 0), 0, INTENSITY_FIELD_GRID.rows - y);
  const values = [];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      values.push(source.grid.base[getGridIndex(column, row)]);
    }
  }
  return { x, y, width, height, values };
}

export function applyFieldRectPatch(channel, patch) {
  const target = bakeIntensityComposite(channel, { x: 0, y: 0, width: 0, height: 0 });
  const x = clampNumber(Math.round(patch?.x || 0), 0, INTENSITY_FIELD_GRID.columns - 1);
  const y = clampNumber(Math.round(patch?.y || 0), 0, INTENSITY_FIELD_GRID.rows - 1);
  const width = clampNumber(Math.round(patch?.width || 0), 0, INTENSITY_FIELD_GRID.columns - x);
  const height = clampNumber(Math.round(patch?.height || 0), 0, INTENSITY_FIELD_GRID.rows - y);
  const values = Array.isArray(patch?.values) ? patch.values : [];
  let cursor = 0;
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      target.grid.base[getGridIndex(column, row)] = clampNumber(
        toFiniteNumber(values[cursor], INTENSITY_FIELD_GRID.neutral),
        INTENSITY_FIELD_GRID.min,
        INTENSITY_FIELD_GRID.max,
      );
      cursor += 1;
    }
  }
  bakeIntensityComposite(target, { x, y, width, height });
  return target;
}
