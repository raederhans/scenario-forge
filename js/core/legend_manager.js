// Legend manager (Phase 13)

class LegendManager {
  static labels = {};
  static maxItems = 15;

  static getUniqueColors(appState) {
    const colors = [];
    if (!appState || !appState.colors) return colors;

    const seen = new Set();
    for (const value of Object.values(appState.colors)) {
      if (!value) continue;
      const color = String(value).toLowerCase();
      if (seen.has(color)) continue;
      seen.add(color);
      colors.push(color);
      if (colors.length >= LegendManager.maxItems) break;
    }

    return colors;
  }

  static setLabel(color, text) {
    if (!color) return;
    const key = String(color).toLowerCase();
    const value = String(text || "").trim();
    if (!value) {
      delete LegendManager.labels[key];
      return;
    }
    LegendManager.labels[key] = value;
  }

  static getLabel(color) {
    if (!color) return "";
    const key = String(color).toLowerCase();
    return LegendManager.labels[key] || "";
  }

  static getLabels() {
    return LegendManager.labels;
  }
}

export { LegendManager };
