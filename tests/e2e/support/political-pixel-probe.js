const LAND_FILL_RGB = [240, 240, 240];

function channelDistance(left = [], right = []) {
  return (
    Math.abs(Number(left[0] || 0) - Number(right[0] || 0))
    + Math.abs(Number(left[1] || 0) - Number(right[1] || 0))
    + Math.abs(Number(left[2] || 0) - Number(right[2] || 0))
  ) / 3;
}

async function samplePoliticalFeaturePixels(page, probes, { radius = 5 } = {}) {
  return page.evaluate(async ({ sampleProbes, sampleRadius, landFillRgb }) => {
    const { state } = await import("/js/core/state.js");
    const {
      getCountryCode: getSharedFeatureCountryCode,
      getFeatureId: getSharedFeatureId,
      normalizeFeatureCountryCode,
    } = await import("/js/core/feature_identity.js");
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    let projectGeoToScreen = null;
    try {
      ({ projectGeoToScreen } = await import("/js/core/map_renderer.js"));
    } catch (_error) {
      projectGeoToScreen = null;
    }
    const d3 = globalThis.d3;
    if (!canvas || !context || !d3 || !state.landData) {
      return sampleProbes.map((probe) => ({
        ...probe,
        error: "runtime-unavailable",
      }));
    }

    function parseRgb(value) {
      const text = String(value || "").trim();
      const hex = /^#?([0-9a-f]{6})$/i.exec(text);
      if (hex) {
        const number = Number.parseInt(hex[1], 16);
        return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
      }
      const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
      if (rgb) {
        return rgb[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part.trim()));
      }
      return null;
    }

    function distance(left, right) {
      if (!Array.isArray(left) || !Array.isArray(right)) return Number.POSITIVE_INFINITY;
      return (
        Math.abs(Number(left[0] || 0) - Number(right[0] || 0))
        + Math.abs(Number(left[1] || 0) - Number(right[1] || 0))
        + Math.abs(Number(left[2] || 0) - Number(right[2] || 0))
      ) / 3;
    }

    function getFeatureId(feature) {
      return getSharedFeatureId(feature);
    }

    function getFeatureCountryCode(feature, fallback = "") {
      return getSharedFeatureCountryCode(feature, {
        fallbackCountryCode: fallback,
        fallbackId: fallback,
      });
    }

    // 像素断言看的是当前显示 owner；shell fallback、blank mode 和 sovereignty override 都可能和几何国家不同。
    function getDisplayOwnerCode(feature, featureId, fallbackCountryCode = "") {
      const props = feature?.properties || {};
      const directOwnerCode = normalizeFeatureCountryCode(state.sovereigntyByFeatureId?.[featureId] || "", {
        allowReserved: true,
      });
      const shellOwnerCode = normalizeFeatureCountryCode(
        state.scenarioAutoShellOwnerByFeatureId?.[featureId]
        || props.scenario_shell_owner_hint
        || props.scenario_shell_controller_hint
        || "",
        { allowReserved: true }
      );
      const featureCountryCode = getFeatureCountryCode(feature, fallbackCountryCode);
      const shellCandidate = String(props.id ?? featureId ?? feature?.id ?? "").trim().toUpperCase();
      const isScenarioShell = String(props.scenario_helper_kind || "").trim().toLowerCase() === "shell_fallback"
        || shellCandidate.startsWith("RU_ARCTIC_FB_")
        || String(props.name || "").toLowerCase().includes("shell fallback");
      if (String(state.mapSemanticMode || "").trim().toLowerCase() === "blank") {
        return isScenarioShell ? (directOwnerCode || shellOwnerCode || "") : directOwnerCode;
      }
      return isScenarioShell
        ? (directOwnerCode || shellOwnerCode || "")
        : (directOwnerCode || featureCountryCode || "");
    }

    const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * 0.04));
    const x1 = Math.max(padding + 1, state.width - padding);
    const y1 = Math.max(padding + 1, state.height - padding);
    const projection = d3.geoEqualEarth().precision(0.1);
    projection.clipExtent(null);
    projection.fitExtent([[padding, padding], [x1, y1]], state.landData);
    const transform = state.zoomTransform || d3.zoomIdentity || { x: 0, y: 0, k: 1 };
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    const colorFeatures = Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length
      ? state.landDataFull.features
      : (Array.isArray(state.landData?.features) ? state.landData.features : []);

    return sampleProbes.map((probe) => {
      let matchedFeature = null;
      for (const feature of colorFeatures) {
        try {
          if (feature?.geometry && d3.geoContains(feature, [probe.lon, probe.lat])) {
            matchedFeature = feature;
            break;
          }
        } catch (_error) {
          // Keep the probe focused on stable sample points; malformed unrelated geometry is ignored.
        }
      }

      const props = matchedFeature?.properties || {};
      const featureId = getFeatureId(matchedFeature);
      const countryCode = getFeatureCountryCode(matchedFeature);
      const displayOwnerCode = getDisplayOwnerCode(matchedFeature, featureId, countryCode);
      const resolvedColor = featureId ? String(state.colors?.[featureId] || "") : "";
      const ownerColor = String(
        state.sovereignBaseColors?.[displayOwnerCode]
        || ""
      );
      const rendererScreenPoint = typeof projectGeoToScreen === "function"
        ? projectGeoToScreen(Number(probe.lon), Number(probe.lat))
        : null;
      const projected = rendererScreenPoint || projection([Number(probe.lon), Number(probe.lat)]);
      if (!featureId || !Array.isArray(projected) || !projected.every(Number.isFinite)) {
        return {
          ...probe,
          featureId,
          countryCode,
          displayOwnerCode,
          resolvedColor,
          ownerColor,
          error: featureId ? "projection-miss" : "feature-miss",
        };
      }

      const cx = rendererScreenPoint
        ? projected[0] * dpr
        : ((projected[0] * transform.k) + transform.x) * dpr;
      const cy = rendererScreenPoint
        ? projected[1] * dpr
        : ((projected[1] * transform.k) + transform.y) * dpr;
      const radiusPx = Math.max(2, Number(sampleRadius || 5) * dpr);
      const minX = Math.max(0, Math.floor(cx - radiusPx));
      const minY = Math.max(0, Math.floor(cy - radiusPx));
      const maxX = Math.min(canvas.width, Math.ceil(cx + radiusPx));
      const maxY = Math.min(canvas.height, Math.ceil(cy + radiusPx));
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const data = context.getImageData(minX, minY, width, height).data;
      const resolvedRgb = parseRgb(resolvedColor);
      const ownerRgb = parseRgb(ownerColor);

      let bestResolvedDistance = Number.POSITIVE_INFINITY;
      let bestLandDistance = 0;
      let bestOwnerDistance = 0;
      let nonLandPixelCount = 0;
      let pixelCount = 0;
      let bestRgb = null;
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3];
        if (!alpha) continue;
        const rgb = [data[index], data[index + 1], data[index + 2]];
        pixelCount += 1;
        const landDistance = distance(rgb, landFillRgb);
        if (landDistance > 16) nonLandPixelCount += 1;
        const resolvedDistance = distance(rgb, resolvedRgb);
        if (resolvedDistance < bestResolvedDistance) {
          bestResolvedDistance = resolvedDistance;
          bestLandDistance = landDistance;
          bestOwnerDistance = ownerRgb ? distance(rgb, ownerRgb) : Number.POSITIVE_INFINITY;
          bestRgb = rgb;
        }
      }

      return {
        ...probe,
        featureId,
        countryCode,
        displayOwnerCode,
        resolvedColor,
        ownerColor,
        resolvedRgb,
        ownerRgb,
        canvasPoint: { x: cx, y: cy },
        sampleBox: { minX, minY, width, height },
        pixelCount,
        nonLandPixelCount,
        bestRgb,
        bestResolvedDistance,
        bestLandDistance,
        bestOwnerDistance,
      };
    });
  }, {
    sampleProbes: probes,
    sampleRadius: radius,
    landFillRgb: LAND_FILL_RGB,
  });
}

module.exports = {
  LAND_FILL_RGB,
  channelDistance,
  samplePoliticalFeaturePixels,
};
