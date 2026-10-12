import { clearRiverCellOverrides } from "../../river_paint/partition_model.js";
import { normalizeHexColor } from "../../color_hex_utils.js";

// Canonical visual paint batch. Effects and history remain with the caller.
export function applyFeaturePaintState(target, featureIds, value, { remove = false } = {}) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("Paint state requires a state object");
  }
  if (!Array.isArray(featureIds)) throw new TypeError("Paint targets must be an array");
  const ids = Array.from(new Set(featureIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (ids.some((id) => ["__proto__", "constructor", "prototype"].includes(id))) {
    throw new TypeError("Invalid paint feature ID");
  }
  if (!ids.length) return [];
  const color = remove ? null : normalizeHexColor(value);
  if (!remove && !color) throw new TypeError("Paint color must be a hexadecimal RGB color");
  // Validate the entire request before the first mutation.
  target.visualOverrides = target.visualOverrides && typeof target.visualOverrides === "object" && !Array.isArray(target.visualOverrides)
    ? target.visualOverrides : {};
  const cleared = clearRiverCellOverrides(target.riverPaint, ids);
  if (cleared.changedCellIds.length) target.riverPaint = cleared.paint;
  for (const id of ids) {
    if (remove) {
      delete target.visualOverrides[id];
    } else {
      target.visualOverrides[id] = color;
    }
  }
  return ids;
}
