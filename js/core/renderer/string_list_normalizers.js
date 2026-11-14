export function normalizeIterableStringList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : Array.from(values || []))
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

export function normalizeStringList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

export function normalizeLayerKeyList(layerKeys = []) {
  return Array.from(
    new Set(
      (Array.isArray(layerKeys) ? layerKeys : [])
        .map((layerKey) => String(layerKey || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}
