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

  static computePoliticalColors(topology, objectName) {
    const result = {};
    const object = topology?.objects?.[objectName];
    const geometries = object?.geometries || [];
    if (!geometries.length || !globalThis.topojson?.neighbors) {
      return result;
    }

    const neighbors = globalThis.topojson.neighbors(geometries);
    const palette = ColorManager.strictPoliticalPalette;

    geometries.forEach((geometry, index) => {
      const neighborIndexes = neighbors[index] || [];
      const used = new Set();
      neighborIndexes.forEach((neighborIndex) => {
        const neighborId = ColorManager.getFeatureId(geometries[neighborIndex], neighborIndex);
        if (result[neighborId]) {
          used.add(result[neighborId]);
        }
      });

      let chosen = palette.find((color) => !used.has(color));
      if (!chosen) {
        chosen = palette[Math.floor(Math.random() * palette.length)];
      }

      const id = ColorManager.getFeatureId(geometry, index);
      result[id] = chosen;
    });

    return result;
  }
}

export { ColorManager };
