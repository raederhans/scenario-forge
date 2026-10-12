import { INTENSITY_FIELD_GRID } from "../intensity_field.js";
import { normalizeIntensityFieldsState } from "../state/intensity_field_state.js";

const DEFAULT_MASK_GRAY_MAP = Object.freeze({
  min: 32,
  neutral: 128,
  max: 224,
});
const MASK_NEUTRAL_EPSILON = 1 / 255;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeMaskDimension(value) {
  return Math.max(0, Math.round(toFiniteNumber(value, 0)));
}

function normalizeTransform(transform = {}) {
  return {
    x: toFiniteNumber(transform?.x, 0),
    y: toFiniteNumber(transform?.y, 0),
    k: Math.max(0.0001, toFiniteNumber(transform?.k, 1)),
  };
}

function normalizeGrayMap(grayMap = DEFAULT_MASK_GRAY_MAP) {
  const neutral = clampNumber(Math.round(toFiniteNumber(grayMap.neutral, DEFAULT_MASK_GRAY_MAP.neutral)), 0, 255);
  const min = clampNumber(Math.round(toFiniteNumber(grayMap.min, DEFAULT_MASK_GRAY_MAP.min)), 0, neutral);
  const max = clampNumber(Math.round(toFiniteNumber(grayMap.max, DEFAULT_MASK_GRAY_MAP.max)), neutral, 255);
  return { min, neutral, max };
}

function createDefaultCanvas(width, height) {
  if (typeof globalThis.document?.createElement === "function") {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof globalThis.OffscreenCanvas === "function") {
    return new globalThis.OffscreenCanvas(width, height);
  }
  return null;
}

export function mapIntensityToMaskGrayByte(value, grayMap = DEFAULT_MASK_GRAY_MAP) {
  const normalizedMap = normalizeGrayMap(grayMap);
  const strength = clampNumber(
    toFiniteNumber(value, INTENSITY_FIELD_GRID.neutral),
    INTENSITY_FIELD_GRID.min,
    INTENSITY_FIELD_GRID.max,
  );
  if (strength <= INTENSITY_FIELD_GRID.neutral) {
    const ratio = INTENSITY_FIELD_GRID.neutral - strength;
    return clampNumber(Math.round(normalizedMap.neutral - ((normalizedMap.neutral - normalizedMap.min) * ratio)), 0, 255);
  }
  const ratio = strength - INTENSITY_FIELD_GRID.neutral;
  return clampNumber(Math.round(normalizedMap.neutral + ((normalizedMap.max - normalizedMap.neutral) * ratio)), 0, 255);
}

function buildMaskCacheKey(channelId, channel, {
  transform,
  widthPx,
  heightPx,
  dpr,
  offsetX,
  offsetY,
  grayMap,
  projectionKey,
}) {
  // cache key 绑定 projection/transform/DPR/grayMap；任一视觉输入变化都要重建 mask，避免缩放后复用旧像素。
  return [
    channelId,
    Number(channel?.revision || 0),
    channel?.enabled ? "on" : "off",
    widthPx,
    heightPx,
    Number(dpr).toFixed(3),
    Number(offsetX).toFixed(3),
    Number(offsetY).toFixed(3),
    Number(transform.x).toFixed(3),
    Number(transform.y).toFixed(3),
    Number(transform.k).toFixed(5),
    grayMap.min,
    grayMap.neutral,
    grayMap.max,
    String(projectionKey || "projection:default"),
  ].join("|");
}

function projectGridPoint(projection, lon, lat, transform, offsetX, offsetY, dpr) {
  const projected = typeof projection === "function" ? projection([lon, lat]) : null;
  if (!Array.isArray(projected) || projected.length < 2) return null;
  const x = Number(projected[0]);
  const y = Number(projected[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [
    ((x * transform.k) + transform.x + offsetX) * dpr,
    ((y * transform.k) + transform.y + offsetY) * dpr,
  ];
}

function fillProjectedRun(maskContext, {
  byte,
  colStart,
  colEndExclusive,
  row,
  projection,
  transform,
  widthPx,
  heightPx,
  dpr,
  offsetX,
  offsetY,
}) {
  // 同一行连续同强度 cell 合并成一个投影四边形，减少 fill 次数，同时保留经纬网格边界语义。
  const lonStep = 360 / INTENSITY_FIELD_GRID.columns;
  const latStep = 180 / INTENSITY_FIELD_GRID.rows;
  const lon0 = INTENSITY_FIELD_GRID.bounds[0] + (colStart * lonStep);
  const lon1 = INTENSITY_FIELD_GRID.bounds[0] + (colEndExclusive * lonStep);
  const lat0 = INTENSITY_FIELD_GRID.bounds[3] - (row * latStep);
  const lat1 = INTENSITY_FIELD_GRID.bounds[3] - ((row + 1) * latStep);
  const points = [
    projectGridPoint(projection, lon0, lat0, transform, offsetX, offsetY, dpr),
    projectGridPoint(projection, lon1, lat0, transform, offsetX, offsetY, dpr),
    projectGridPoint(projection, lon1, lat1, transform, offsetX, offsetY, dpr),
    projectGridPoint(projection, lon0, lat1, transform, offsetX, offsetY, dpr),
  ];
  if (points.some((point) => !point)) return false;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  if (Math.max(...xs) < 0 || Math.min(...xs) > widthPx || Math.max(...ys) < 0 || Math.min(...ys) > heightPx) {
    return false;
  }
  maskContext.fillStyle = `rgb(${byte}, ${byte}, ${byte})`;
  maskContext.beginPath();
  maskContext.moveTo(points[0][0], points[0][1]);
  maskContext.lineTo(points[1][0], points[1][1]);
  maskContext.lineTo(points[2][0], points[2][1]);
  maskContext.lineTo(points[3][0], points[3][1]);
  maskContext.closePath();
  maskContext.fill();
  return true;
}

export function createIntensityFieldMaskOwner({
  getFieldsState = () => ({}),
  getProjection = () => null,
  createCanvas = createDefaultCanvas,
} = {}) {
  const cacheByChannel = new Map();

  const invalidateMask = (channelId = null) => {
    if (channelId) {
      cacheByChannel.delete(String(channelId));
      return;
    }
    cacheByChannel.clear();
  };

  const getMaskCanvas = (channelId, options = {}) => {
    const normalizedChannelId = String(channelId || "").trim();
    const fields = normalizeIntensityFieldsState(getFieldsState());
    const channel = fields.channels?.[normalizedChannelId] || null;
    if (!channel?.enabled) {
      return { canvas: null, renderedCellCount: 0, renderedRunCount: 0, cacheHit: false, reason: "disabled" };
    }

    const projection = options.projection || getProjection();
    if (typeof projection !== "function") {
      return { canvas: null, renderedCellCount: 0, renderedRunCount: 0, cacheHit: false, reason: "projection-missing" };
    }

    const widthPx = normalizeMaskDimension(options.widthPx);
    const heightPx = normalizeMaskDimension(options.heightPx);
    if (widthPx <= 0 || heightPx <= 0) {
      return { canvas: null, renderedCellCount: 0, renderedRunCount: 0, cacheHit: false, reason: "empty-layout" };
    }

    const transform = normalizeTransform(options.transform);
    const dpr = Math.max(0.0001, toFiniteNumber(options.dpr, 1));
    const offsetX = toFiniteNumber(options.offsetX, 0);
    const offsetY = toFiniteNumber(options.offsetY, 0);
    const grayMap = normalizeGrayMap(options.grayMap || DEFAULT_MASK_GRAY_MAP);
    const key = buildMaskCacheKey(normalizedChannelId, channel, {
      transform,
      widthPx,
      heightPx,
      dpr,
      offsetX,
      offsetY,
      grayMap,
      projectionKey: options.projectionKey,
    });
    const cached = cacheByChannel.get(normalizedChannelId);
    if (cached?.key === key) {
      return { ...cached.result, cacheHit: true };
    }

    const composite = channel.grid?.composite;
    if (!composite || composite.length !== INTENSITY_FIELD_GRID.columns * INTENSITY_FIELD_GRID.rows) {
      return { canvas: null, renderedCellCount: 0, renderedRunCount: 0, cacheHit: false, reason: "grid-missing" };
    }

    let canvas = null;
    let maskContext = null;
    let renderedCellCount = 0;
    let renderedRunCount = 0;
    const neutralByte = grayMap.neutral;

    const ensureMaskContext = () => {
      if (maskContext) return maskContext;
      canvas = createCanvas(widthPx, heightPx);
      if (!canvas || typeof canvas.getContext !== "function") return null;
      canvas.width = widthPx;
      canvas.height = heightPx;
      maskContext = canvas.getContext("2d");
      if (!maskContext) return null;
      if (typeof maskContext.setTransform === "function") {
        maskContext.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (typeof maskContext.clearRect === "function") {
        maskContext.clearRect(0, 0, widthPx, heightPx);
      }
      maskContext.globalCompositeOperation = "source-over";
      maskContext.globalAlpha = 1;
      return maskContext;
    };

    for (let row = 0; row < INTENSITY_FIELD_GRID.rows; row += 1) {
      const rowOffset = row * INTENSITY_FIELD_GRID.columns;
      let col = 0;
      while (col < INTENSITY_FIELD_GRID.columns) {
        const byte = mapIntensityToMaskGrayByte(composite[rowOffset + col], grayMap);
        if (Math.abs(byte - neutralByte) <= MASK_NEUTRAL_EPSILON) {
          col += 1;
          continue;
        }
        const colStart = col;
        col += 1;
        // run-length 扫描只合并相同 gray byte；跨强度合并会破坏 mask 采样的单调性。
        while (col < INTENSITY_FIELD_GRID.columns) {
          const nextByte = mapIntensityToMaskGrayByte(composite[rowOffset + col], grayMap);
          if (nextByte !== byte) break;
          col += 1;
        }
        const ctx = ensureMaskContext();
        if (!ctx) {
          return { canvas: null, renderedCellCount: 0, renderedRunCount: 0, cacheHit: false, reason: "canvas-missing" };
        }
        const filled = fillProjectedRun(ctx, {
          byte,
          colStart,
          colEndExclusive: col,
          row,
          projection,
          transform,
          widthPx,
          heightPx,
          dpr,
          offsetX,
          offsetY,
        });
        if (filled) {
          renderedRunCount += 1;
          renderedCellCount += col - colStart;
        }
      }
    }

    const result = {
      canvas: renderedRunCount > 0 ? canvas : null,
      renderedCellCount,
      renderedRunCount,
      cacheHit: false,
      reason: renderedRunCount > 0 ? "rendered" : "neutral",
    };
    cacheByChannel.set(normalizedChannelId, { key, result });
    return result;
  };

  return {
    getMaskCanvas,
    invalidateMask,
  };
}
