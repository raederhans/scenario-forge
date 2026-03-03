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
    "#8c564b", "#e377c2", "#bcbd22", "#7f7f7f", "#4e79a7", "#e15759",
    "#76b7b2", "#f28e2b", "#59a14f", "#edc948",
  ];

  static strictPoliticalMinDeltaE = 24;
  static sovereignPoliticalMinDeltaE = 18;

  static strictPoliticalVariantTweaks = [
    { hueShift: 0, saturationScale: 1, lightnessShift: 0 },
    { hueShift: 0, saturationScale: 1, lightnessShift: 8 },
    { hueShift: 0, saturationScale: 1, lightnessShift: -8 },
    { hueShift: 12, saturationScale: 0.95, lightnessShift: 4 },
    { hueShift: -12, saturationScale: 0.95, lightnessShift: -4 },
    { hueShift: 20, saturationScale: 1.05, lightnessShift: 2 },
    { hueShift: -20, saturationScale: 1.05, lightnessShift: -2 },
  ];

  static regionColorMap = new Map();
  static labCache = new Map();

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
      const candidate = ColorManager.normalizeHexColor(
        palette[(start + offset) % palette.length]
      );
      if (candidate && !used.has(candidate)) return candidate;
    }
    return ColorManager.normalizeHexColor(palette[start]);
  }

  static getPoliticalFallbackColor(token, fallbackIndex = 0) {
    const palette = ColorManager.strictPoliticalPalette;
    const stableToken = token || `fallback-${fallbackIndex}`;
    return ColorManager.getHashedPaletteColor(stableToken, palette);
  }

  static getHashedPaletteColor(token, palette) {
    if (!Array.isArray(palette) || palette.length === 0) return null;
    const seed = ColorManager.stableHash(token);
    return ColorManager.normalizeHexColor(palette[Math.abs(seed) % palette.length]);
  }

  static clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  static normalizeHexColor(value) {
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

  static hexToRgb(hex) {
    const normalized = ColorManager.normalizeHexColor(hex);
    if (!normalized) return null;
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16),
    };
  }

  static rgbToHex(r, g, b) {
    const toHex = (value) =>
      Math.round(ColorManager.clamp(value, 0, 255))
        .toString(16)
        .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  static rgbToHsl(r, g, b) {
    const rn = ColorManager.clamp(r / 255, 0, 1);
    const gn = ColorManager.clamp(g / 255, 0, 1);
    const bn = ColorManager.clamp(b / 255, 0, 1);
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;

    let hue = 0;
    if (delta !== 0) {
      if (max === rn) {
        hue = ((gn - bn) / delta) % 6;
      } else if (max === gn) {
        hue = (bn - rn) / delta + 2;
      } else {
        hue = (rn - gn) / delta + 4;
      }
      hue *= 60;
      if (hue < 0) hue += 360;
    }

    const lightness = (max + min) / 2;
    const saturation =
      delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

    return { h: hue, s: saturation, l: lightness };
  }

  static hslToRgb(h, s, l) {
    const hue = ((h % 360) + 360) % 360;
    const sat = ColorManager.clamp(s, 0, 1);
    const light = ColorManager.clamp(l, 0, 1);
    const chroma = (1 - Math.abs(2 * light - 1)) * sat;
    const hp = hue / 60;
    const x = chroma * (1 - Math.abs((hp % 2) - 1));

    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (hp >= 0 && hp < 1) {
      r1 = chroma;
      g1 = x;
    } else if (hp >= 1 && hp < 2) {
      r1 = x;
      g1 = chroma;
    } else if (hp >= 2 && hp < 3) {
      g1 = chroma;
      b1 = x;
    } else if (hp >= 3 && hp < 4) {
      g1 = x;
      b1 = chroma;
    } else if (hp >= 4 && hp < 5) {
      r1 = x;
      b1 = chroma;
    } else if (hp >= 5 && hp < 6) {
      r1 = chroma;
      b1 = x;
    }

    const m = light - chroma / 2;
    return {
      r: (r1 + m) * 255,
      g: (g1 + m) * 255,
      b: (b1 + m) * 255,
    };
  }

  static transformHexColor(hex, tweak = {}) {
    const rgb = ColorManager.hexToRgb(hex);
    if (!rgb) return null;

    const hsl = ColorManager.rgbToHsl(rgb.r, rgb.g, rgb.b);
    const hueShift = Number(tweak.hueShift || 0);
    const saturationScale =
      Number.isFinite(tweak.saturationScale) ? Number(tweak.saturationScale) : 1;
    const lightnessShift = Number(tweak.lightnessShift || 0) / 100;

    const h = ((hsl.h + hueShift) % 360 + 360) % 360;
    const s = ColorManager.clamp(hsl.s * saturationScale, 0.22, 0.95);
    const l = ColorManager.clamp(hsl.l + lightnessShift, 0.24, 0.78);
    const nextRgb = ColorManager.hslToRgb(h, s, l);

    return ColorManager.rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b);
  }

  static srgbToLinear(value) {
    if (value <= 0.04045) return value / 12.92;
    return ((value + 0.055) / 1.055) ** 2.4;
  }

  static colorToLab(hex) {
    const normalized = ColorManager.normalizeHexColor(hex);
    if (!normalized) return null;

    const cached = ColorManager.labCache.get(normalized);
    if (cached) return cached;

    const rgb = ColorManager.hexToRgb(normalized);
    if (!rgb) return null;

    const r = ColorManager.srgbToLinear(rgb.r / 255);
    const g = ColorManager.srgbToLinear(rgb.g / 255);
    const b = ColorManager.srgbToLinear(rgb.b / 255);

    const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;

    const xr = x / 0.95047;
    const yr = y / 1.0;
    const zr = z / 1.08883;
    const f = (t) => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116);

    const fx = f(xr);
    const fy = f(yr);
    const fz = f(zr);

    const lab = {
      l: 116 * fy - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz),
    };

    ColorManager.labCache.set(normalized, lab);
    return lab;
  }

  static deltaE(colorA, colorB) {
    const labA = ColorManager.colorToLab(colorA);
    const labB = ColorManager.colorToLab(colorB);
    if (!labA || !labB) return 0;

    const dl = labA.l - labB.l;
    const da = labA.a - labB.a;
    const db = labA.b - labB.b;
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  static getPoliticalPaletteCandidates(token) {
    const palette = Array.isArray(ColorManager.strictPoliticalPalette)
      ? ColorManager.strictPoliticalPalette
      : [];
    if (palette.length === 0) return [];

    const seed = ColorManager.stableHash(token || "country");
    const paletteStart = Math.abs(seed) % palette.length;
    const tweakList = ColorManager.strictPoliticalVariantTweaks;
    const tweakStart = tweakList.length ? Math.abs(seed >>> 1) % tweakList.length : 0;

    const candidates = [];
    const seen = new Set();

    for (let paletteOffset = 0; paletteOffset < palette.length; paletteOffset += 1) {
      const base =
        ColorManager.normalizeHexColor(
          palette[(paletteStart + paletteOffset) % palette.length]
        ) || null;
      if (!base) continue;

      for (let tweakOffset = 0; tweakOffset < tweakList.length; tweakOffset += 1) {
        const tweak =
          tweakList[(tweakStart + tweakOffset) % tweakList.length] ||
          tweakList[0] ||
          { hueShift: 0, saturationScale: 1, lightnessShift: 0 };
        const candidate = ColorManager.transformHexColor(base, tweak);
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        candidates.push(candidate);
      }
    }

    if (candidates.length === 0) {
      palette.forEach((value) => {
        const normalized = ColorManager.normalizeHexColor(value);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          candidates.push(normalized);
        }
      });
    }

    return candidates;
  }

  static chooseNeighborDistinctColor(countryCode, neighborColors = []) {
    const normalizedNeighborColors = neighborColors
      .map((value) => ColorManager.normalizeHexColor(value))
      .filter(Boolean);
    const neighborSet = new Set(normalizedNeighborColors);

    const candidates = ColorManager.getPoliticalPaletteCandidates(countryCode);
    let bestColor = null;
    let bestMinDeltaE = -1;

    candidates.forEach((candidate) => {
      if (!candidate || neighborSet.has(candidate)) return;

      let minDeltaE = Number.POSITIVE_INFINITY;
      normalizedNeighborColors.forEach((neighborColor) => {
        minDeltaE = Math.min(minDeltaE, ColorManager.deltaE(candidate, neighborColor));
      });

      if (minDeltaE > bestMinDeltaE) {
        bestMinDeltaE = minDeltaE;
        bestColor = candidate;
      }
    });

    if (bestColor) return bestColor;

    const fallback = ColorManager.getPoliticalFallbackColor(countryCode);
    if (fallback && !neighborSet.has(fallback)) return fallback;

    const fallbackCandidates = ColorManager.getPoliticalPaletteCandidates(
      `${countryCode || "country"}-fallback`
    );
    for (const candidate of fallbackCandidates) {
      if (!neighborSet.has(candidate)) return candidate;
    }

    return fallback || "#808080";
  }

  static computeAdjacencyContrast(countryAdjacency, colorByCountry, threshold = ColorManager.strictPoliticalMinDeltaE) {
    let edgeCount = 0;
    let sameColorEdges = 0;
    let lowContrastEdges = 0;
    const seen = new Set();

    countryAdjacency.forEach((neighbors, countryCode) => {
      neighbors.forEach((neighborCode) => {
        const key = [countryCode, neighborCode].sort().join("|");
        if (seen.has(key)) return;
        seen.add(key);
        edgeCount += 1;

        const colorA = ColorManager.normalizeHexColor(colorByCountry.get(countryCode));
        const colorB = ColorManager.normalizeHexColor(colorByCountry.get(neighborCode));
        if (!colorA || !colorB) return;

        if (colorA === colorB) {
          sameColorEdges += 1;
          lowContrastEdges += 1;
          return;
        }

        const delta = ColorManager.deltaE(colorA, colorB);
        if (delta < threshold) lowContrastEdges += 1;
      });
    });

    return { edgeCount, sameColorEdges, lowContrastEdges, threshold };
  }

  static computePoliticalColors(topology, objectName) {
    const result = {};
    const countryColors = {};
    const object = topology?.objects?.[objectName];
    const geometries = object?.geometries || [];
    if (!geometries.length) {
      return { featureColors: result, countryColors };
    }

    const palette = ColorManager.strictPoliticalPalette;
    const countryByIndex = geometries.map((geometry, index) =>
      ColorManager.getCountryCode(geometry, index)
    );
    const countryAdjacency = new Map();

    geometries.forEach((_, index) => {
      const countryCode = countryByIndex[index];
      if (!countryAdjacency.has(countryCode)) {
        countryAdjacency.set(countryCode, new Set());
      }
    });

    let neighbors = [];
    let neighborGraphPopulated = false;
    let neighborSource = "none";

    // 1. Prefer embedded spatial neighbor graph (computed by Python pipeline)
    const embeddedNeighbors = object?.computed_neighbors;
    if (
      Array.isArray(embeddedNeighbors) &&
      embeddedNeighbors.length === geometries.length
    ) {
      neighbors = embeddedNeighbors;
      neighborSource = "embedded";
      console.log(
        `[ColorManager] Using embedded computed_neighbors (${neighbors.length} entries)`
      );
    } else {
      // 2. Fall back to topojson.neighbors() (arc-based)
      try {
        if (globalThis.topojson?.neighbors) {
          neighbors = globalThis.topojson.neighbors(geometries) || [];
          neighborSource = "topojson";
        }
      } catch (error) {
        neighbors = [];
        console.warn("[ColorManager] topojson.neighbors() failed:", error);
      }
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
        neighborGraphPopulated = true;
      }
    });

    const countryOrder = Array.from(countryAdjacency.keys()).sort((a, b) => {
      const degreeA = countryAdjacency.get(a)?.size || 0;
      const degreeB = countryAdjacency.get(b)?.size || 0;
      if (degreeA !== degreeB) return degreeB - degreeA;
      return String(a).localeCompare(String(b));
    });
    const colorByCountry = new Map();

    if (neighborGraphPopulated) {
      console.log(
        `[ColorManager] Neighbor graph populated (source: ${neighborSource}), ` +
          `${countryAdjacency.size} countries, graph-coloring with ${palette.length}-color palette`
      );
      countryOrder.forEach((countryCode) => {
        const degree = countryAdjacency.get(countryCode)?.size || 0;
        if (degree === 0) {
          colorByCountry.set(
            countryCode,
            ColorManager.getHashedPaletteColor(countryCode, palette)
          );
          return;
        }

        const assignedNeighborColors = [];
        const neighborsForCountry = countryAdjacency.get(countryCode) || new Set();
        neighborsForCountry.forEach((neighborCode) => {
          const color = colorByCountry.get(neighborCode);
          if (color) assignedNeighborColors.push(color);
        });

        const chosen = ColorManager.chooseNeighborDistinctColor(
          countryCode,
          assignedNeighborColors
        );
        colorByCountry.set(countryCode, chosen);
      });

      const contrastStats = ColorManager.computeAdjacencyContrast(
        countryAdjacency,
        colorByCountry,
        ColorManager.strictPoliticalMinDeltaE
      );
      console.log(
        `[ColorManager] Adjacency contrast: ${contrastStats.edgeCount} edges, ` +
          `${contrastStats.sameColorEdges} same-color, ` +
          `${contrastStats.lowContrastEdges} below DeltaE ${contrastStats.threshold}`
      );
    } else {
      console.warn("[ColorManager] Neighbor graph empty, using hash-distributed coloring");
      countryOrder.forEach((countryCode) => {
        colorByCountry.set(
          countryCode,
          ColorManager.getHashedPaletteColor(countryCode, palette)
        );
      });
    }

    geometries.forEach((geometry, index) => {
      const id = ColorManager.getFeatureId(geometry, index);
      const countryCode = countryByIndex[index];
      const chosen =
        colorByCountry.get(countryCode) ||
        ColorManager.getPoliticalFallbackColor(countryCode, index);
      result[id] = chosen;
    });

    colorByCountry.forEach((color, code) => {
      countryColors[code] = color;
    });

    return { featureColors: result, countryColors };
  }

  static computeOwnerColors(runtimeTopologyOrMeta, sovereigntyByFeatureId = {}) {
    const result = {};
    const ownerColors = {};
    const runtimeMeta =
      runtimeTopologyOrMeta?.featureIds && runtimeTopologyOrMeta?.neighborGraph
        ? runtimeTopologyOrMeta
        : null;
    const object = runtimeMeta ? null : runtimeTopologyOrMeta?.objects?.political;
    const geometries = runtimeMeta ? [] : object?.geometries || [];
    const featureIds = runtimeMeta?.featureIds || geometries.map((geometry, index) => ColorManager.getFeatureId(geometry, index));
    const canonicalByFeatureId = runtimeMeta?.canonicalCountryByFeatureId || null;
    const neighborGraph = runtimeMeta?.neighborGraph || null;
    if (!featureIds.length) {
      return { featureColors: result, ownerColors, contrastStats: null };
    }

    const ownerByIndex = featureIds.map((featureId, index) => {
      const rawOwner =
        sovereigntyByFeatureId?.[featureId] ||
        canonicalByFeatureId?.[featureId] ||
        (!runtimeMeta ? ColorManager.getCountryCode(geometries[index], index) : "");
      return String(rawOwner || "").trim().toUpperCase();
    });
    const ownerAdjacency = new Map();
    ownerByIndex.forEach((ownerCode) => {
      if (!ownerAdjacency.has(ownerCode)) {
        ownerAdjacency.set(ownerCode, new Set());
      }
    });

    let neighbors = [];
    if (Array.isArray(neighborGraph) && neighborGraph.length === featureIds.length) {
      neighbors = neighborGraph;
    } else {
      const embeddedNeighbors = object?.computed_neighbors;
      if (Array.isArray(embeddedNeighbors) && embeddedNeighbors.length === geometries.length) {
        neighbors = embeddedNeighbors;
      } else {
        try {
          neighbors = globalThis.topojson?.neighbors?.(geometries) || [];
        } catch (_error) {
          neighbors = [];
        }
      }
    }
    if (!Array.isArray(neighbors) || neighbors.length !== featureIds.length) {
      neighbors = new Array(featureIds.length).fill(null).map(() => []);
    }

    featureIds.forEach((_, index) => {
      const ownerCode = ownerByIndex[index];
      const neighborIndexes = neighbors[index] || [];
      neighborIndexes.forEach((neighborIndex) => {
        if (!Number.isInteger(neighborIndex) || neighborIndex < 0 || neighborIndex >= ownerByIndex.length) {
          return;
        }
        const neighborOwner = ownerByIndex[neighborIndex];
        if (!ownerCode || !neighborOwner || ownerCode === neighborOwner) return;
        ownerAdjacency.get(ownerCode)?.add(neighborOwner);
        ownerAdjacency.get(neighborOwner)?.add(ownerCode);
      });
    });

    const ownerOrder = Array.from(ownerAdjacency.keys()).sort((a, b) => {
      const degreeA = ownerAdjacency.get(a)?.size || 0;
      const degreeB = ownerAdjacency.get(b)?.size || 0;
      if (degreeA !== degreeB) return degreeB - degreeA;
      return String(a).localeCompare(String(b));
    });
    const colorByOwner = new Map();
    ownerOrder.forEach((ownerCode) => {
      const assignedNeighborColors = [];
      (ownerAdjacency.get(ownerCode) || new Set()).forEach((neighborCode) => {
        const color = colorByOwner.get(neighborCode);
        if (color) assignedNeighborColors.push(color);
      });
      const chosen = ColorManager.chooseNeighborDistinctColor(ownerCode, assignedNeighborColors);
      colorByOwner.set(ownerCode, chosen);
    });

    featureIds.forEach((featureId, index) => {
      const ownerCode = ownerByIndex[index];
      const color =
        colorByOwner.get(ownerCode) ||
        ColorManager.getPoliticalFallbackColor(ownerCode || featureId, index);
      result[featureId] = color;
    });

    colorByOwner.forEach((color, ownerCode) => {
      ownerColors[ownerCode] = color;
    });

    const contrastStats = ColorManager.computeAdjacencyContrast(
      ownerAdjacency,
      colorByOwner,
      ColorManager.sovereignPoliticalMinDeltaE
    );
    return { featureColors: result, ownerColors, contrastStats };
  }
}

export { ColorManager };
