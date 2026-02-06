// Color assignment manager for region and political auto-fill.

class ColorManager {
  static regionPalette = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b",
    "#e377c2", "#7f7f7f", "#bcbd22", "#17becf", "#393b79", "#637939",
    "#8c6d31", "#843c39", "#7b4173", "#3182bd", "#31a354", "#756bb1",
    "#636363", "#e6550d", "#969696", "#9c9ede", "#cedb9c", "#e7ba52",
  ];

  static strictPoliticalPalette = [
    "#1f77b4", "#d62728", "#2ca02c", "#ff7f0e", "#9467bd", "#17becf",
  ];

  static regionColorMap = new Map();

  static getRegionColor(tag) {
    const key = String(tag || "Unknown").trim() || "Unknown";
    if (ColorManager.regionColorMap.has(key)) {
      return ColorManager.regionColorMap.get(key);
    }

    const index = ColorManager.regionColorMap.size % ColorManager.regionPalette.length;
    const color = ColorManager.regionPalette[index];
    ColorManager.regionColorMap.set(key, color);
    return color;
  }

  static getFeatureId(item, fallbackIndex) {
    if (!item) return `feature-${fallbackIndex}`;
    return (
      item?.properties?.id ||
      item?.properties?.NUTS_ID ||
      item?.id ||
      `feature-${fallbackIndex}`
    );
  }

  static getCountryCode(item, fallbackIndex) {
    const props = item?.properties || {};
    const raw =
      props.cntr_code ||
      props.CNTR_CODE ||
      props.iso_a2 ||
      props.ISO_A2 ||
      props.adm0_a2 ||
      props.ADM0_A2 ||
      "";
    const code = String(raw || "").trim().toUpperCase();
    if (code) return code;
    return `feature-${fallbackIndex}`;
  }

  static stableHash(input) {
    const text = String(input || "");
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  static pickPaletteColor(palette, used, seedIndex = 0) {
    if (!Array.isArray(palette) || palette.length === 0) return null;
    const start = Math.abs(seedIndex) % palette.length;
    for (let offset = 0; offset < palette.length; offset += 1) {
      const candidate = palette[(start + offset) % palette.length];
      if (!used.has(candidate)) return candidate;
    }
    return palette[start];
  }

  static getPoliticalFallbackColor(token, fallbackIndex = 0) {
    const palette = ColorManager.strictPoliticalPalette;
    const seed = ColorManager.stableHash(token) + Number(fallbackIndex || 0);
    return palette[Math.abs(seed) % palette.length];
  }

  static computePoliticalColors(topology, objectName) {
    const result = {};
    const object = topology?.objects?.[objectName];
    const geometries = object?.geometries || [];
    if (!geometries.length) {
      return result;
    }

    const palette = ColorManager.strictPoliticalPalette;
    const countryByIndex = geometries.map((geometry, index) =>
      ColorManager.getCountryCode(geometry, index)
    );
    const countryAdjacency = new Map();

    geometries.forEach((geometry, index) => {
      const countryCode = countryByIndex[index];
      if (!countryAdjacency.has(countryCode)) {
        countryAdjacency.set(countryCode, new Set());
      }
    });

    let neighbors = [];
    try {
      if (globalThis.topojson?.neighbors) {
        neighbors = globalThis.topojson.neighbors(geometries) || [];
      }
    } catch (error) {
      neighbors = [];
      console.warn("Political neighbor graph failed, falling back to hash coloring:", error);
    }
    if (!Array.isArray(neighbors) || neighbors.length !== geometries.length) {
      neighbors = new Array(geometries.length).fill(null).map(() => []);
    }

    geometries.forEach((_, index) => {
      const countryCode = countryByIndex[index];
      const neighborIndexes = neighbors[index] || [];
      for (const neighborIndex of neighborIndexes) {
        if (!Number.isInteger(neighborIndex)) continue;
        if (neighborIndex < 0 || neighborIndex >= countryByIndex.length) continue;
        const neighborCode = countryByIndex[neighborIndex];
        if (!neighborCode || neighborCode === countryCode) continue;
        countryAdjacency.get(countryCode)?.add(neighborCode);
        countryAdjacency.get(neighborCode)?.add(countryCode);
      }
    });

    const countryOrder = Array.from(countryAdjacency.keys()).sort((a, b) => {
      const degreeA = countryAdjacency.get(a)?.size || 0;
      const degreeB = countryAdjacency.get(b)?.size || 0;
      if (degreeA !== degreeB) return degreeB - degreeA;
      return String(a).localeCompare(String(b));
    });
    const colorByCountry = new Map();

    countryOrder.forEach((countryCode) => {
      const used = new Set();
      const neighborsForCountry = countryAdjacency.get(countryCode) || new Set();
      neighborsForCountry.forEach((neighborCode) => {
        const color = colorByCountry.get(neighborCode);
        if (color) used.add(color);
      });
      const seed = ColorManager.stableHash(countryCode);
      const chosen = ColorManager.pickPaletteColor(palette, used, seed);
      colorByCountry.set(countryCode, chosen);
    });

    geometries.forEach((geometry, index) => {
      const id = ColorManager.getFeatureId(geometry, index);
      const countryCode = countryByIndex[index];
      const chosen =
        colorByCountry.get(countryCode) ||
        ColorManager.getPoliticalFallbackColor(countryCode, index);
      result[id] = chosen;
    });

    return result;
  }
}

export { ColorManager };
