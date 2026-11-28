import { clamp } from "./value_normalization.js";

export function normalizeHexColor(value) {
  const input = String(value || "").trim().toLowerCase();
  const shortHex = /^#([0-9a-f]{3})$/.exec(input);
  if (shortHex) {
    return `#${shortHex[1]
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }
  if (/^#[0-9a-f]{6}$/.test(input)) return input;
  return null;
}

export function normalizeHexColorWithFallback(value, fallback = "#1d4ed8", defaultColor = "#1d4ed8") {
  return normalizeHexColor(value) || normalizeHexColor(fallback) || normalizeHexColor(defaultColor) || "#1d4ed8";
}

export function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex(r, g, b) {
  const toHex = (value) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function srgbToLinear(value) {
  if (value <= 0.04045) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
}

export function getHexRelativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = srgbToLinear(rgb.r / 255);
  const g = srgbToLinear(rgb.g / 255);
  const b = srgbToLinear(rgb.b / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function mixHexColors(baseColor, targetColor, amount) {
  const base = hexToRgb(baseColor);
  const target = hexToRgb(targetColor);
  if (!base || !target) return null;
  const mix = clamp(Number(amount) || 0, 0, 1);
  return rgbToHex(
    base.r + ((target.r - base.r) * mix),
    base.g + ((target.g - base.g) * mix),
    base.b + ((target.b - base.b) * mix),
  );
}
