// Central color resolver for land features.
// It keeps canonical visual/owner state precedence in one small, testable place.

function readSafeColor(colorMap, key, getSafeColor) {
  if (!colorMap || typeof colorMap !== "object" || !key) return "";
  return getSafeColor(colorMap[key], "");
}

function defaultSafeColor(value, fallback = "") {
  const raw = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

function resolveFeatureColor(featureId, ctx = {}) {
  const id = String(featureId || "").trim();
  const runtimeState = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
  const getSafeColor = typeof ctx.getSafeColor === "function" ? ctx.getSafeColor : defaultSafeColor;
  const feature = ctx.feature || null;

  if (typeof ctx.isOceanFeature === "function" && ctx.isOceanFeature(feature, id)) {
    const color = getSafeColor(
      typeof ctx.getOceanBaseFillColor === "function" ? ctx.getOceanBaseFillColor(feature, id) : "",
      "",
    );
    return {
      color,
      source: color ? "ocean" : "",
      featureId: id,
      ownerCode: "",
    };
  }

  const visualColor = readSafeColor(runtimeState.visualOverrides, id, getSafeColor);
  if (visualColor) {
    return { color: visualColor, source: "visualOverrides", featureId: id, ownerCode: "" };
  }

  const compatFeatureColor = readSafeColor(runtimeState.featureOverrides, id, getSafeColor);
  if (compatFeatureColor) {
    return { color: compatFeatureColor, source: "featureOverrides", featureId: id, ownerCode: "" };
  }

  const ownerCode = String(
    typeof ctx.getOwnerCode === "function" ? ctx.getOwnerCode(feature, id) : "",
  ).trim().toUpperCase();
  if (!ownerCode) {
    return { color: null, source: "", featureId: id, ownerCode: "" };
  }

  const ownerColor = readSafeColor(runtimeState.sovereignBaseColors, ownerCode, getSafeColor);
  if (ownerColor) {
    return { color: ownerColor, source: "sovereignBaseColors", featureId: id, ownerCode };
  }

  const compatOwnerColor = readSafeColor(runtimeState.countryBaseColors, ownerCode, getSafeColor);
  return {
    color: compatOwnerColor || null,
    source: compatOwnerColor ? "countryBaseColors" : "",
    featureId: id,
    ownerCode,
  };
}

export {
  resolveFeatureColor,
};
