const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  primeStateRef,
  waitForAppInteractive,
  waitForRenderIdle,
  applyScenarioAndWaitIdle,
} = require("./support/playwright-app");

const ATLANTROPA_ISLAND_PROBES = [
  { label: "Cyprus", featureId: "ATLISL_levant_cyprus", ownerCode: "TUR", joinMode: "none", focus: { lon: 33.3, lat: 35.1, zoomPercent: 260 } },
  { label: "Balearics", featureId: "ATLISL_west_med_balearics", ownerCode: "IBR", joinMode: "none", focus: { lon: 3.0, lat: 39.6, zoomPercent: 260 } },
  { label: "Crete", featureId: "ATLISL_aegean_crete", ownerCode: "GRE", joinMode: "boolean_weld", focus: { lon: 24.9, lat: 35.2, zoomPercent: 260 } },
  { label: "Sicily", featureId: "ATLISL_sicily_tunis_sicily", ownerCode: "ITA", joinMode: "boolean_weld", focus: { lon: 14.3, lat: 37.5, zoomPercent: 260 } },
];

const HELPER_PREFIXES = ["ATLSHL_", "ATLWLD_"];
const ATLANTROPA_MEDITERRANEAN_FOCUS = { lon: 16.5, lat: 37.5, zoomPercent: 180 };
const ADRIATIC_BASIN_TARGET_ID = "ATLSEA_adriatica_8597_5838_0";

async function applyScenario(page, scenarioId) {
  await applyScenarioAndWaitIdle(page, scenarioId, {
    timeout: 120000,
    renderMode: "request",
    markDirtyReason: "tno-open-ocean-rendering",
    showToastOnComplete: false,
    forceApply: true,
  });
  await waitForRenderIdle(page, { scenarioId, timeout: 120000 });
}

async function resetZoomToFit(page) {
  await page.evaluate(async () => {
    const { resetZoomToFit } = await import("/js/core/map_renderer.js");
    resetZoomToFit();
  });
}

async function setMapZoomPercent(page, percent) {
  await page.evaluate(async (nextPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(nextPercent);
  }, percent);
}

async function setOpenOceanVisibility(page, visible) {
  await page.evaluate(async (nextVisible) => {
    const { state } = await import("/js/core/state.js");
    const {
      invalidateOceanWaterInteractionVisualState,
      render,
    } = await import("/js/core/map_renderer.js");
    state.allowOpenOceanSelect = !!nextVisible;
    state.allowOpenOceanPaint = !!nextVisible;
    state.showOpenOceanRegions = !!nextVisible;
    invalidateOceanWaterInteractionVisualState("test-open-ocean-toggle");
    render();
  }, visible);
}

async function setWaterOverrideColor(page, featureId, color) {
  await page.evaluate(async ({ targetFeatureId, nextColor }) => {
    const { state } = await import("/js/core/state.js");
    const { refreshColorState } = await import("/js/core/map_renderer.js");
    state.waterRegionOverrides = {
      ...(state.waterRegionOverrides || {}),
    };
    if (nextColor) {
      state.waterRegionOverrides[targetFeatureId] = nextColor;
    } else {
      delete state.waterRegionOverrides[targetFeatureId];
    }
    refreshColorState({ renderNow: true });
  }, {
    targetFeatureId: featureId,
    nextColor: color,
  });
}

async function readOpenOceanRuntime(page, featureId) {
  return page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const { isOpenOceanOverlayActive } = await import("/js/core/map_renderer.js");
    const items = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems.filter((item) => String(item?.featureId || "") === targetFeatureId)
      : [];
    return {
      featureInteractive: isOpenOceanOverlayActive(),
      itemCount: items.length,
      itemBounds: items.map((item) => ({
        minX: item.minX,
        minY: item.minY,
        maxX: item.maxX,
        maxY: item.maxY,
        bboxArea: item.bboxArea,
      })),
    };
  }, featureId);
}

async function sampleFeaturePatchStats(page, featureId) {
  return page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const items = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems
        .filter((item) => String(item?.featureId || "") === targetFeatureId)
        .sort((left, right) => Number(right?.bboxArea || 0) - Number(left?.bboxArea || 0))
      : [];
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    if (!items.length || !canvas || !context) {
      return null;
    }
    const sampleBoxes = items
      .slice(0, 3)
      .map((item) => {
        const minX = Math.max(
          0,
          Math.min(
            canvas.width - 1,
            Math.floor(((item.minX * transform.k) + transform.x) * dpr)
          )
        );
        const minY = Math.max(
          0,
          Math.min(
            canvas.height - 1,
            Math.floor(((item.minY * transform.k) + transform.y) * dpr)
          )
        );
        const maxX = Math.max(
          minX + 1,
          Math.min(
            canvas.width,
            Math.ceil(((item.maxX * transform.k) + transform.x) * dpr)
          )
        );
        const maxY = Math.max(
          minY + 1,
          Math.min(
            canvas.height,
            Math.ceil(((item.maxY * transform.k) + transform.y) * dpr)
          )
        );
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        if (!(width > 0) || !(height > 0)) return null;
        return { minX, minY, width, height };
      })
      .filter(Boolean);
    if (!sampleBoxes.length) {
      return null;
    }
    let pixelCount = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    sampleBoxes.forEach((box) => {
      const data = context.getImageData(box.minX, box.minY, box.width, box.height).data;
      for (let index = 0; index < data.length; index += 4) {
        red += data[index];
        green += data[index + 1];
        blue += data[index + 2];
        pixelCount += 1;
      }
    });
    if (!pixelCount) {
      return null;
    }
    return {
      sampledBoxes: sampleBoxes.length,
      avgRed: red / pixelCount,
      avgGreen: green / pixelCount,
      avgBlue: blue / pixelCount,
    };
  }, featureId);
}

async function measureFeaturePatchDiff(page, featureId, color) {
  return page.evaluate(async ({ targetFeatureId, nextColor }) => {
    const { state } = await import("/js/core/state.js");
    const { refreshColorState } = await import("/js/core/map_renderer.js");
    const items = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems
        .filter((item) => String(item?.featureId || "") === targetFeatureId)
        .sort((left, right) => Number(right?.bboxArea || 0) - Number(left?.bboxArea || 0))
      : [];
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    if (!items.length || !canvas || !context) {
      return null;
    }
    const sampleBoxes = items
      .map((item) => {
        const minX = Math.max(
          0,
          Math.min(
            canvas.width - 1,
            Math.floor(((item.minX * transform.k) + transform.x) * dpr)
          )
        );
        const minY = Math.max(
          0,
          Math.min(
            canvas.height - 1,
            Math.floor(((item.minY * transform.k) + transform.y) * dpr)
          )
        );
        const maxX = Math.max(
          minX + 1,
          Math.min(
            canvas.width,
            Math.ceil(((item.maxX * transform.k) + transform.x) * dpr)
          )
        );
        const maxY = Math.max(
          minY + 1,
          Math.min(
            canvas.height,
            Math.ceil(((item.maxY * transform.k) + transform.y) * dpr)
          )
        );
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        if (!(width > 0) || !(height > 0)) return null;
        return { minX, minY, width, height };
      })
      .filter(Boolean);
    if (!sampleBoxes.length) {
      return null;
    }
    const before = sampleBoxes.map((box) => context.getImageData(box.minX, box.minY, box.width, box.height).data);
    state.waterRegionOverrides = {
      ...(state.waterRegionOverrides || {}),
      [targetFeatureId]: nextColor,
    };
    refreshColorState({ renderNow: true });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let changedPixelCount = 0;
    let changedChannelSum = 0;
    sampleBoxes.forEach((box, boxIndex) => {
      const after = context.getImageData(box.minX, box.minY, box.width, box.height).data;
      const beforeData = before[boxIndex];
      for (let index = 0; index < beforeData.length; index += 4) {
        const diff =
          Math.abs(beforeData[index] - after[index])
          + Math.abs(beforeData[index + 1] - after[index + 1])
          + Math.abs(beforeData[index + 2] - after[index + 2]);
        if (diff >= 24) {
          changedPixelCount += 1;
          changedChannelSum += diff / 3;
        }
      }
    });
    return {
      sampledBoxes: sampleBoxes.length,
      changedPixelCount,
      meanChangedChannelDiff: changedPixelCount ? changedChannelSum / changedPixelCount : 0,
    };
  }, {
    targetFeatureId: featureId,
    nextColor: color,
  });
}

async function readLandFeatureRuntime(page, featureId) {
  return page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const collections = [
      state.landIndex?.get?.(targetFeatureId) || null,
      ...(Array.isArray(state.landDataFull?.features) ? state.landDataFull.features : []),
      ...(Array.isArray(state.landData?.features) ? state.landData.features : []),
    ];
    let matchedProps = collections.find((feature) => {
      const candidateProps = feature?.properties || {};
      return String(candidateProps.id || feature?.id || "").trim() === targetFeatureId;
    })?.properties || null;
    if (!matchedProps) {
      const topologyPayload = state.runtimePoliticalTopology || null;
      const runtimeGeometries = Array.isArray(topologyPayload?.objects?.political?.geometries)
        ? topologyPayload.objects.political.geometries
        : [];
      matchedProps = runtimeGeometries.find((geometry) => {
        const candidateProps = geometry?.properties || {};
        return String(candidateProps.id || geometry?.id || "").trim() === targetFeatureId;
      })?.properties || null;
    }
    if (!matchedProps) {
      if (!globalThis.__pwFullRuntimeTopology) {
        const runtimeTopologyUrl = String(state.activeScenarioManifest?.runtime_topology_url || "").trim();
        if (runtimeTopologyUrl) {
          const response = await fetch(runtimeTopologyUrl, { cache: "no-store" });
          if (response.ok) {
            globalThis.__pwFullRuntimeTopology = await response.json();
          }
        }
      }
      const fullGeometries = Array.isArray(globalThis.__pwFullRuntimeTopology?.objects?.political?.geometries)
        ? globalThis.__pwFullRuntimeTopology.objects.political.geometries
        : [];
      matchedProps = fullGeometries.find((geometry) => {
        const candidateProps = geometry?.properties || {};
        return String(candidateProps.id || geometry?.id || "").trim() === targetFeatureId;
      })?.properties || null;
    }
    const props = matchedProps || {};
    return {
      featureId: matchedProps ? String(targetFeatureId || "").trim() : "",
      interactive: props.interactive === true,
      interactiveRaw: props.interactive ?? null,
      atlJoinMode: String(props.atl_join_mode || "").trim().toLowerCase(),
      atlGeometryRole: String(props.atl_geometry_role || "").trim().toLowerCase(),
      countryCode: String(props.cntr_code || "").trim().toUpperCase(),
      ownerCode: targetFeatureId ? String(state.sovereigntyByFeatureId?.[targetFeatureId] || "").trim().toUpperCase() : "",
    };
  }, featureId);
}

async function waitForOpenOceanFeature(page, featureId) {
  await primeStateRef(page);
  await page.waitForFunction((expectedFeatureId) => {
    const state = globalThis.__playwrightStateRef || null;
    return Array.isArray(state?.waterSpatialItems)
      && state.waterSpatialItems.some((item) => String(item?.featureId || "") === expectedFeatureId);
  }, featureId, { timeout: 30000 });
}

async function waitForLandFeature(page, featureId) {
  await primeStateRef(page);
  await page.waitForFunction((targetFeatureId) => {
    const state = globalThis.__playwrightStateRef || null;
    if (!state) return false;
    if (state.landIndex?.has?.(targetFeatureId)) {
      return true;
    }
    const featureCollections = [
      ...(Array.isArray(state.landDataFull?.features) ? state.landDataFull.features : []),
      ...(Array.isArray(state.landData?.features) ? state.landData.features : []),
    ];
    return featureCollections.some((feature) => {
      const props = feature?.properties || {};
      return String(props.id || feature?.id || "").trim() === targetFeatureId;
    });
  }, featureId, { timeout: 30000 });
}

async function projectGeoPointToPagePoint(page, point) {
  return page.evaluate(async ({ targetPoint }) => {
    const { projectGeoToScreen } = await import("/js/core/map_renderer.js");
    const canvas = document.querySelector("#map-canvas");
    if (!canvas || !targetPoint) {
      return null;
    }
    // Chunked political data is not the renderer's projection-fit authority.
    const projected = projectGeoToScreen(Number(targetPoint.lon), Number(targetPoint.lat));
    if (!Array.isArray(projected) || !projected.every(Number.isFinite)) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + projected[0],
      y: rect.top + projected[1],
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
  }, { targetPoint: point });
}

async function centerMapOnGeoPoint(page, point, {
  zoomPercent = null,
  tolerancePx = 28,
  maxAttempts = 6,
} = {}) {
  const centerOnce = async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const pagePoint = await projectGeoPointToPagePoint(page, point);
      if (!pagePoint?.rect) {
        return null;
      }
      const targetCenter = {
        x: pagePoint.rect.left + (pagePoint.rect.width / 2),
        y: pagePoint.rect.top + (pagePoint.rect.height / 2),
      };
      const deltaX = targetCenter.x - pagePoint.x;
      const deltaY = targetCenter.y - pagePoint.y;
      if (Math.abs(deltaX) <= tolerancePx && Math.abs(deltaY) <= tolerancePx) {
        return pagePoint;
      }
      const deltaSegmentX = Math.max(-220, Math.min(220, deltaX));
      const deltaSegmentY = Math.max(-220, Math.min(220, deltaY));
      await page.mouse.move(targetCenter.x, targetCenter.y);
      await page.mouse.down();
      await page.mouse.move(targetCenter.x + deltaSegmentX, targetCenter.y + deltaSegmentY, { steps: 12 });
      await page.mouse.up();
      await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
    }
    return projectGeoPointToPagePoint(page, point);
  };

  await centerOnce();
  if (Number.isFinite(Number(zoomPercent))) {
    await setMapZoomPercent(page, zoomPercent);
    await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
  }
  return centerOnce();
}

async function requestScenarioPoliticalChunk(page, {
  chunkId,
  focusCountry,
  viewportBbox,
  reason = "test-focus-detail",
  timeout = 120000,
}) {
  await page.evaluate(async ({ nextFocusCountry, nextViewportBbox, nextReason }) => {
    const { state } = await import("/js/core/state.js");
    const { readRegisteredRuntimeHookSource } = await import("/js/core/state/index.js");
    if (!Object.prototype.hasOwnProperty.call(state, "__testRestoreViewportGeoBoundsFn")) {
      const directViewportProvider = typeof state.getViewportGeoBoundsFn === "function"
        ? state.getViewportGeoBoundsFn
        : null;
      const registeredViewportProvider = readRegisteredRuntimeHookSource(state, "getViewportGeoBoundsFn");
      state.__testRestoreViewportGeoBoundsFn = registeredViewportProvider || directViewportProvider;
    }
    state.getViewportGeoBoundsFn = () => nextViewportBbox;
    if (state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object") {
      state.runtimeChunkLoadState.focusCountryOverride = nextFocusCountry;
      state.runtimeChunkLoadState.focusCountryOverrideSource = "test";
      state.runtimeChunkLoadState.focusCountryOverrideExpiresAt = Date.now() + 120000;
      state.runtimeChunkLoadState.pendingReason = nextReason;
      state.runtimeChunkLoadState.pendingDelayMs = 0;
    }
    if (typeof state.scheduleScenarioChunkRefreshFn === "function") {
      state.scheduleScenarioChunkRefreshFn({ reason: nextReason, delayMs: 0, flushPending: true });
    }
  }, {
    nextFocusCountry: focusCountry,
    nextViewportBbox: viewportBbox,
    nextReason: reason,
  });
  await page.waitForFunction((expectedChunkId) => {
    const state = globalThis.__playwrightStateRef || null;
    const loadedChunkIds = Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
      ? state.activeScenarioChunks.loadedChunkIds.map((id) => String(id || ""))
      : [];
    return loadedChunkIds.includes(expectedChunkId);
  }, chunkId, { timeout });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout });
}

function buildProbeViewportBbox(probe, marginDegrees = 6) {
  const focus = probe?.focus || {};
  const lon = Number(focus.lon);
  const lat = Number(focus.lat);
  return [
    Math.max(-180, lon - marginDegrees),
    Math.max(-90, lat - marginDegrees),
    Math.min(180, lon + marginDegrees),
    Math.min(90, lat + marginDegrees),
  ];
}

async function restoreScenarioViewportProvider(page) {
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    if (Object.prototype.hasOwnProperty.call(state, "__testRestoreViewportGeoBoundsFn")) {
      state.getViewportGeoBoundsFn = typeof state.__testRestoreViewportGeoBoundsFn === "function"
        ? state.__testRestoreViewportGeoBoundsFn
        : null;
    }
    if (state.runtimeChunkLoadState?.focusCountryOverrideSource === "test") {
      state.runtimeChunkLoadState.focusCountryOverride = "";
      state.runtimeChunkLoadState.focusCountryOverrideSource = "";
      state.runtimeChunkLoadState.focusCountryOverrideExpiresAt = 0;
    }
    delete state.__testRestoreViewportGeoBoundsFn;
  });
}

async function computeFeatureProbePoints(page, featureId) {
  return page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const mapContainer = document.querySelector("#mapContainer");
    if (!mapContainer) return [];
    const rect = mapContainer.getBoundingClientRect();
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    const normalizedFeatureId = String(targetFeatureId || "").trim();
    const seen = new Set();
    const candidates = [];
    const addCandidate = (projectedX, projectedY, source = "bbox") => {
      if (!Number.isFinite(projectedX) || !Number.isFinite(projectedY)) {
        return;
      }
      const x = rect.left + (projectedX * Number(transform.k || 1)) + Number(transform.x || 0);
      const y = rect.top + (projectedY * Number(transform.k || 1)) + Number(transform.y || 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      const roundedKey = `${x.toFixed(3)}:${y.toFixed(3)}`;
      if (seen.has(roundedKey)) {
        return;
      }
      seen.add(roundedKey);
      candidates.push({ x, y, source });
    };
    const matchingItems = Array.isArray(state.spatialItems)
      ? state.spatialItems
        .filter((item) => String(item?.id || item?.featureId || "").trim() === normalizedFeatureId)
        .sort((left, right) => Number(right?.bboxArea || 0) - Number(left?.bboxArea || 0))
      : [];
    matchingItems.forEach((item) => {
      const minX = Number(item?.minX);
      const minY = Number(item?.minY);
      const maxX = Number(item?.maxX);
      const maxY = Number(item?.maxY);
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
        return;
      }
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const offsetX = Math.max(0.8, Math.min(10, (maxX - minX) * 0.18));
      const offsetY = Math.max(0.8, Math.min(10, (maxY - minY) * 0.18));
      const spanX = Math.max(0.8, Math.min(12, (maxX - minX) * 0.45));
      const spanY = Math.max(0.8, Math.min(12, (maxY - minY) * 0.45));
      [
        [centerX, centerY],
        [centerX - offsetX, centerY],
        [centerX + offsetX, centerY],
        [centerX, centerY - offsetY],
        [centerX, centerY + offsetY],
        [centerX - offsetX * 0.55, centerY - offsetY * 0.55],
        [centerX + offsetX * 0.55, centerY - offsetY * 0.55],
        [centerX - offsetX * 0.55, centerY + offsetY * 0.55],
        [centerX + offsetX * 0.55, centerY + offsetY * 0.55],
      ].forEach(([projectedX, projectedY]) => addCandidate(projectedX, projectedY, "spatial-item"));
      [-1, -0.5, 0, 0.5, 1].forEach((scaleY) => {
        [-1, -0.5, 0, 0.5, 1].forEach((scaleX) => {
          addCandidate(
            centerX + (spanX * scaleX),
            centerY + (spanY * scaleY),
            "spatial-grid"
          );
        });
      });
    });
    if (!candidates.length && globalThis.d3) {
      const featureCollections = [
        ...(Array.isArray(state.landDataFull?.features) ? state.landDataFull.features : []),
        ...(Array.isArray(state.landData?.features) ? state.landData.features : []),
      ];
      const matchedFeature = featureCollections.find((feature) => {
        const props = feature?.properties || {};
        return String(props.id || feature?.id || "").trim() === normalizedFeatureId;
      }) || null;
      if (matchedFeature) {
        const projection = globalThis.d3.geoEqualEarth().precision(0.1);
        const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * 0.04));
        const x1 = Math.max(padding + 1, state.width - padding);
        const y1 = Math.max(padding + 1, state.height - padding);
        projection.fitExtent([[padding, padding], [x1, y1]], state.landData);
        const addGeoCandidate = (geoPoint, source = "geo-point") => {
          if (!Array.isArray(geoPoint) || geoPoint.length < 2 || !geoPoint.every(Number.isFinite)) {
            return;
          }
          const projected = projection([Number(geoPoint[0]), Number(geoPoint[1])]);
          if (!Array.isArray(projected) || !projected.every(Number.isFinite)) {
            return;
          }
          addCandidate(projected[0], projected[1], source);
        };
        addGeoCandidate(globalThis.d3.geoCentroid(matchedFeature), "geo-centroid");
        const bounds = globalThis.d3.geoBounds(matchedFeature);
        if (Array.isArray(bounds) && bounds.length === 2) {
          const west = Number(bounds[0]?.[0]);
          const south = Number(bounds[0]?.[1]);
          const east = Number(bounds[1]?.[0]);
          const north = Number(bounds[1]?.[1]);
          if ([west, south, east, north].every(Number.isFinite)) {
            addGeoCandidate([(west + east) / 2, (south + north) / 2], "geo-bounds-center");
          }
        }
        const geometry = matchedFeature?.geometry || null;
        const appendRingPoint = (coords, source) => {
          if (Array.isArray(coords) && coords.length >= 2 && coords.every(Number.isFinite)) {
            addGeoCandidate([Number(coords[0]), Number(coords[1])], source);
          }
        };
        if (geometry?.type === "Polygon") {
          appendRingPoint(geometry.coordinates?.[0]?.[0], "geo-ring");
        } else if (geometry?.type === "MultiPolygon") {
          appendRingPoint(geometry.coordinates?.[0]?.[0]?.[0], "geo-ring");
        }
      }
    }
    return candidates.filter((candidate) => (
      candidate.x >= rect.left - 12
      && candidate.x <= rect.right + 12
      && candidate.y >= rect.top - 12
      && candidate.y <= rect.bottom + 12
    ));
  }, featureId);
}

async function sampleCanvasPatchAtPagePoint(page, point, radiusPx = 6) {
  return page.evaluate(({ targetPoint, targetRadiusPx }) => {
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    if (!canvas || !context || !targetPoint) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const radius = Math.max(2, Math.round(Number(targetRadiusPx) || 6));
    const centerX = (Number(targetPoint.x || 0) - rect.left) * scaleX;
    const centerY = (Number(targetPoint.y || 0) - rect.top) * scaleY;
    const left = Math.max(0, Math.floor(centerX - radius));
    const top = Math.max(0, Math.floor(centerY - radius));
    const right = Math.min(canvas.width, Math.ceil(centerX + radius));
    const bottom = Math.min(canvas.height, Math.ceil(centerY + radius));
    const width = right - left;
    const height = bottom - top;
    if (width < 1 || height < 1) {
      return null;
    }
    const data = context.getImageData(left, top, width, height).data;
    let pixelCount = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let index = 0; index < data.length; index += 4) {
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      alpha += data[index + 3];
      pixelCount += 1;
    }
    if (!pixelCount) {
      return null;
    }
    return {
      avgRed: red / pixelCount,
      avgGreen: green / pixelCount,
      avgBlue: blue / pixelCount,
      avgAlpha: alpha / pixelCount,
      width,
      height,
    };
  }, {
    targetPoint: point,
    targetRadiusPx: radiusPx,
  });
}

async function sampleCanvasPatchAtGeoPoint(page, point, radiusPx = 6) {
  const pagePoint = await projectGeoPointToPagePoint(page, point);
  if (!pagePoint) {
    return null;
  }
  return sampleCanvasPatchAtPagePoint(page, pagePoint, radiusPx);
}

async function sampleLandFeaturePatchStats(page, featureId, radiusPx = 6) {
  const point = await computeFeatureProbePoint(page, featureId);
  if (!point) {
    return null;
  }
  const patch = await sampleCanvasPatchAtPagePoint(page, point, radiusPx);
  return patch ? { ...patch, point } : null;
}

async function readAtlantropaSeaRuntime(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const waterItems = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems.filter((item) => String(item?.featureId || item?.id || "").startsWith("ATLSEA_"))
      : [];
    const waterFeatureIds = Array.from(state.waterRegionsById?.keys?.() || [])
      .filter((featureId) => String(featureId || "").startsWith("ATLSEA_"));
    return {
      itemCount: waterItems.length,
      featureCount: waterFeatureIds.length,
      sampleFeatureIds: waterFeatureIds.slice(0, 8),
    };
  });
}

async function waitForAtlantropaSeaRuntime(page, { timeout = 120000 } = {}) {
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    const featureIds = Array.from(state?.waterRegionsById?.keys?.() || [])
      .filter((featureId) => String(featureId || "").startsWith("ATLSEA_"));
    const itemCount = Array.isArray(state?.waterSpatialItems)
      ? state.waterSpatialItems.filter((item) => String(item?.featureId || item?.id || "").startsWith("ATLSEA_")).length
      : 0;
    return featureIds.length > 20 && itemCount > 20;
  }, undefined, { timeout });
}

async function readAtlantropaWaterFeatureDiagnostics(page, featureId) {
  return page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const feature = state.waterRegionsById?.get?.(targetFeatureId) || null;
    const items = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems.filter((item) => String(item?.featureId || item?.id || "").trim() === targetFeatureId)
      : [];
    const d3 = globalThis.d3;
    const bounds = feature && d3?.geoBounds ? d3.geoBounds(feature) : null;
    const area = feature && d3?.geoArea ? d3.geoArea(feature) : null;
    const containsAdriaticProbe = feature && d3?.geoContains ? d3.geoContains(feature, [18, 41.6]) : false;
    const containsGlobalProbe = feature && d3?.geoContains ? d3.geoContains(feature, [-150, 0]) : false;
    const isWorldBounds = Array.isArray(bounds)
      && bounds.length === 2
      && bounds[0]?.[0] <= -179.999
      && bounds[0]?.[1] <= -89.999
      && bounds[1]?.[0] >= 179.999
      && bounds[1]?.[1] >= 89.999;
    return {
      featureId: targetFeatureId,
      exists: !!feature,
      itemCount: items.length,
      bounds,
      area,
      isWorldBounds,
      containsAdriaticProbe,
      containsGlobalProbe,
    };
  }, featureId);
}

async function computeWaterFeatureProbePoints(page, featureId) {
  return page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const mapContainer = document.querySelector("#mapContainer");
    if (!mapContainer) return [];
    const rect = mapContainer.getBoundingClientRect();
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    return (Array.isArray(state.waterSpatialItems) ? state.waterSpatialItems : [])
      .filter((item) => String(item?.featureId || item?.id || "").trim() === targetFeatureId)
      .sort((left, right) => Number(right?.bboxArea || 0) - Number(left?.bboxArea || 0))
      .slice(0, 6)
      .flatMap((item) => {
        const minX = Number(item?.minX);
        const minY = Number(item?.minY);
        const maxX = Number(item?.maxX);
        const maxY = Number(item?.maxY);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [];
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        return [
          [centerX, centerY],
          [centerX - ((maxX - minX) * 0.18), centerY],
          [centerX + ((maxX - minX) * 0.18), centerY],
          [centerX, centerY - ((maxY - minY) * 0.18)],
          [centerX, centerY + ((maxY - minY) * 0.18)],
        ].map(([projectedX, projectedY]) => ({
          x: rect.left + (projectedX * Number(transform.k || 1)) + Number(transform.x || 0),
          y: rect.top + (projectedY * Number(transform.k || 1)) + Number(transform.y || 0),
        }));
      })
      .filter((point) => (
        Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && point.x >= rect.left - 12
        && point.x <= rect.right + 12
        && point.y >= rect.top - 12
        && point.y <= rect.bottom + 12
      ));
  }, featureId);
}

async function tryClickWaterFeature(page, featureId, { maxPoints = 12, attempts = 4, waitMs = 100 } = {}) {
  const points = (await computeWaterFeatureProbePoints(page, featureId)).slice(0, maxPoints);
  for (const point of points) {
    await clearDevSelectedHit(page);
    await page.mouse.click(point.x, point.y);
    const hit = await waitForDevSelectedHit(page, {
      timeout: attempts * waitMs,
      polling: waitMs,
      expectedId: featureId,
      expectedTargetType: "water",
    });
    if (hit) {
      return { point, hit };
    }
  }
  return null;
}

async function clickWaterFeature(page, featureId) {
  const clicked = await tryClickWaterFeature(page, featureId, { maxPoints: 30, attempts: 6, waitMs: 120 });
  if (clicked) {
    return clicked;
  }
  throw new Error(`Failed to click water feature ${featureId}`);
}

async function clearDevSelectedHit(page) {
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.devSelectedHit = null;
  });
}

async function readDevSelectedHit(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return state.devSelectedHit
      ? {
        id: String(state.devSelectedHit.id || "").trim(),
        targetType: String(state.devSelectedHit.targetType || "").trim(),
        countryCode: String(state.devSelectedHit.countryCode || "").trim().toUpperCase(),
      }
      : null;
  });
}

async function waitForDevSelectedHit(
  page,
  {
    timeout = 3000,
    polling = 100,
    expectedId = "",
    expectedTargetType = "",
    rejectPrefixes = [],
  } = {},
) {
  const handle = await page.waitForFunction(
    async ({ id, targetType, prefixes }) => {
      const { state } = await import("/js/core/state.js");
      const hit = state.devSelectedHit
        ? {
          id: String(state.devSelectedHit.id || "").trim(),
          targetType: String(state.devSelectedHit.targetType || "").trim(),
          countryCode: String(state.devSelectedHit.countryCode || "").trim().toUpperCase(),
        }
        : null;
      if (!hit) return false;
      if (id && hit.id !== id) return false;
      if (targetType && hit.targetType !== targetType) return false;
      if (prefixes.some((prefix) => hit.id.startsWith(prefix))) return false;
      return hit;
    },
    {
      id: String(expectedId || "").trim(),
      targetType: String(expectedTargetType || "").trim(),
      prefixes: rejectPrefixes.map((prefix) => String(prefix || "").trim()).filter(Boolean),
    },
    { timeout, polling },
  ).catch(() => null);
  return handle ? handle.jsonValue() : null;
}

async function clickLandFeature(page, featureId, { acceptAnyHit = false } = {}) {
  const points = await computeFeatureProbePoints(page, featureId);
  if (!points.length) {
    throw new Error(`Missing probe point for feature ${featureId}`);
  }
  let lastHit = null;
  for (const point of points) {
    await clearDevSelectedHit(page);
    const actionStartedAt = await page.evaluate(async () => {
      const { state } = await import("/js/core/state.js");
      const previousActionAt = Number(state.renderPassCache?.lastActionAt || 0);
      const actionAdvanceDeadline = performance.now() + 1000;
      while (Date.now() <= previousActionAt) {
        if (performance.now() >= actionAdvanceDeadline) {
          throw new Error(`Timed out waiting for the action clock to advance beyond ${previousActionAt}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      return Date.now();
    });
    // Ctrl-selection prevents candidate retries from writing sovereignty paint changes.
    await page.keyboard.down("Control");
    try {
      await page.mouse.click(point.x, point.y);
    } finally {
      await page.keyboard.up("Control");
    }
    lastHit = await waitForDevSelectedHit(page, {
      timeout: 720,
      polling: 120,
      expectedId: acceptAnyHit ? "" : featureId,
      expectedTargetType: acceptAnyHit ? "land" : "",
      rejectPrefixes: acceptAnyHit ? HELPER_PREFIXES : [],
    });
    if (lastHit) {
      const selectionAction = await page.evaluate(async (notBefore) => {
        const { state } = await import("/js/core/state.js");
        const cache = state.renderPassCache || {};
        const action = String(cache.lastAction || "").trim();
        const actionAt = Number(cache.lastActionAt || 0);
        return {
          action,
          actionAt,
          observed: actionAt >= Number(notBefore || 0)
            && (action === "dev-selection-toggle" || action === "dev-selection-sync"),
        };
      }, actionStartedAt);
      expect(
        selectionAction.observed,
        `Expected readonly dev-selection action for ${featureId}; got ${JSON.stringify(selectionAction)}`,
      ).toBe(true);
      return { point, hit: lastHit, selectionAction };
    }
  }
  throw new Error(`Failed to click feature ${featureId}; lastHit=${JSON.stringify(lastHit || null)}`);
}

async function findAtlantropaHelperFeatureId(page) {
  return page.evaluate(async ({ helperPrefixes }) => {
    const { state } = await import("/js/core/state.js");
    const visibleHelperId = Array.isArray(state.spatialItems)
      ? state.spatialItems.find((item) => {
        const featureId = String(item?.id || item?.featureId || "").trim().toUpperCase();
        return helperPrefixes.some((prefix) => featureId.startsWith(prefix));
      })?.id || ""
      : "";
    if (visibleHelperId) {
      return String(visibleHelperId || "").trim();
    }
    const features = [
      ...(Array.isArray(state.landDataFull?.features) ? state.landDataFull.features : []),
      ...(Array.isArray(state.landData?.features) ? state.landData.features : []),
    ];
    const match = features.find((feature) => {
      const props = feature?.properties || {};
      const featureId = String(props.id || feature?.id || "").trim().toUpperCase();
      return helperPrefixes.some((prefix) => featureId.startsWith(prefix));
    });
    const props = match?.properties || {};
    return String(props.id || match?.id || "").trim();
  }, { helperPrefixes: HELPER_PREFIXES });
}

test("tno open ocean override is visibly rendered and indexed by polygon part", async ({ page }) => {
  test.setTimeout(120000);

  const targetFeatureId = "tno_northwest_pacific_ocean";

  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await applyScenario(page, "tno_1962");

  await waitForOpenOceanFeature(page, targetFeatureId);

  const runtimeBefore = await readOpenOceanRuntime(page, targetFeatureId);
  expect(runtimeBefore.featureInteractive).toBe(false);
  expect(runtimeBefore.itemCount).toBeGreaterThan(1);
  const patchBefore = await sampleFeaturePatchStats(page, targetFeatureId);
  expect(patchBefore).not.toBeNull();
  expect(patchBefore.avgBlue).toBeGreaterThan(patchBefore.avgRed + 10);
  expect(patchBefore.avgBlue).toBeGreaterThan(patchBefore.avgGreen + 5);

  const clickWhileInteractionOff = await tryClickWaterFeature(page, targetFeatureId);
  expect(clickWhileInteractionOff).toBeNull();

  const diffWhileInteractionOff = await measureFeaturePatchDiff(page, targetFeatureId, "#ff00ff");
  expect(diffWhileInteractionOff).not.toBeNull();

  await setOpenOceanVisibility(page, true);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.showOpenOceanRegions;
  });
  const runtimeInteractiveOn = await readOpenOceanRuntime(page, targetFeatureId);
  expect(runtimeInteractiveOn.featureInteractive).toBe(true);
  const clickWhileInteractionOn = await clickWaterFeature(page, targetFeatureId);
  expect(clickWhileInteractionOn.hit.targetType).toBe("water");
  const diffWhileInteractionOn = await measureFeaturePatchDiff(page, targetFeatureId, "#00d4ff");
  expect(diffWhileInteractionOn).not.toBeNull();
  expect(diffWhileInteractionOn.changedPixelCount).toBeGreaterThan(80);
  expect(diffWhileInteractionOn.meanChangedChannelDiff).toBeGreaterThan(20);
  expect(diffWhileInteractionOff.changedPixelCount).toBeLessThan(diffWhileInteractionOn.changedPixelCount * 0.25);
  expect(diffWhileInteractionOff.meanChangedChannelDiff).toBeLessThan(diffWhileInteractionOn.meanChangedChannelDiff * 0.75);

  await setOpenOceanVisibility(page, false);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.showOpenOceanRegions;
  });
  const runtimeAfterToggleOff = await readOpenOceanRuntime(page, targetFeatureId);
  expect(runtimeAfterToggleOff.featureInteractive).toBe(false);
  const clickAfterToggleOff = await tryClickWaterFeature(page, targetFeatureId);
  expect(clickAfterToggleOff).toBeNull();
  const patchAfterToggleOff = await sampleFeaturePatchStats(page, targetFeatureId);
  expect(patchAfterToggleOff).not.toBeNull();
  expect(patchAfterToggleOff.avgBlue).toBeGreaterThan(patchAfterToggleOff.avgRed + 10);
  expect(patchAfterToggleOff.avgBlue).toBeGreaterThan(patchAfterToggleOff.avgGreen + 5);
  expect(Math.abs(patchAfterToggleOff.avgBlue - patchBefore.avgBlue)).toBeLessThan(30);
  const diffAfterToggleOff = await measureFeaturePatchDiff(page, targetFeatureId, "#ff8800");
  expect(diffAfterToggleOff).not.toBeNull();
  expect(diffAfterToggleOff.changedPixelCount).toBeLessThan(diffWhileInteractionOn.changedPixelCount * 0.25);
  expect(diffAfterToggleOff.meanChangedChannelDiff).toBeLessThan(diffWhileInteractionOn.meanChangedChannelDiff * 0.75);

  await setWaterOverrideColor(page, targetFeatureId, "");
});

test("tno atlantropa donor islands stay clickable and mediterranean sea follows ocean fill", async ({ page }) => {
  test.setTimeout(300000);

  const screenshotDir = path.join(".runtime", "tests", "playwright", "tno_open_ocean_rendering");
  fs.mkdirSync(screenshotDir, { recursive: true });

  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await applyScenario(page, "tno_1962");
  await waitForOpenOceanFeature(page, "tno_northwest_pacific_ocean");

  const outerOceanSamplePoint = { label: "North Atlantic", lon: -20, lat: 35 };
  const atlantropaSeaSample = { label: "Tyrrhenian Basin", lon: 13.2, lat: 39.0 };
  // Keep both interiors visible, with enough scale to exclude coastline pixels
  // from the patch even in the narrower CI viewport.
  await centerMapOnGeoPoint(page, { lon: -3.4, lat: 37 }, { zoomPercent: 400 });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
  const outerOceanPatch = await sampleCanvasPatchAtGeoPoint(page, outerOceanSamplePoint, 2);
  expect(outerOceanPatch).not.toBeNull();
  atlantropaSeaSample.before = await sampleCanvasPatchAtGeoPoint(page, atlantropaSeaSample, 2);
  expect(atlantropaSeaSample.before).not.toBeNull();
  const channelDistance = (left, right) => (
    Math.abs(left.avgRed - right.avgRed)
    + Math.abs(left.avgGreen - right.avgGreen)
    + Math.abs(left.avgBlue - right.avgBlue)
  );
  expect(channelDistance(atlantropaSeaSample.before, outerOceanPatch)).toBeLessThan(12);

  const oceanFillInput = page.locator("#oceanFillColor");
  const originalOceanFillColor = await oceanFillInput.inputValue();
  const linkedOceanFillColor = "#397f96";
  await oceanFillInput.evaluate((input, color) => {
    input.value = color;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, linkedOceanFillColor);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });

  const outerOceanAfter = await sampleCanvasPatchAtGeoPoint(page, outerOceanSamplePoint, 2);
  atlantropaSeaSample.after = await sampleCanvasPatchAtGeoPoint(page, atlantropaSeaSample, 2);
  expect(outerOceanAfter).not.toBeNull();
  expect(atlantropaSeaSample.after).not.toBeNull();
  const expectedOceanChannels = { avgRed: 57, avgGreen: 127, avgBlue: 150 };
  expect(channelDistance(atlantropaSeaSample.before, atlantropaSeaSample.after)).toBeGreaterThan(80);
  expect(channelDistance(outerOceanAfter, expectedOceanChannels)).toBeLessThan(12);
  expect(channelDistance(atlantropaSeaSample.after, expectedOceanChannels)).toBeLessThan(12);
  expect(channelDistance(atlantropaSeaSample.after, outerOceanAfter)).toBeLessThan(12);

  await oceanFillInput.evaluate((input, color) => {
    input.value = color;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, originalOceanFillColor);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
  const atlantropaSeaSamples = [atlantropaSeaSample];

  await resetZoomToFit(page);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
  await centerMapOnGeoPoint(page, ATLANTROPA_MEDITERRANEAN_FOCUS, {
    zoomPercent: ATLANTROPA_MEDITERRANEAN_FOCUS.zoomPercent,
  });
  await requestScenarioPoliticalChunk(page, {
    chunkId: "scenario_atlantropa.detail.r1c2",
    focusCountry: "ATL",
    viewportBbox: [8, 30, 28, 46],
    reason: "test-atlantropa-sea-runtime",
  });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
  await waitForAtlantropaSeaRuntime(page);

  const mediterraneanShot = path.join(screenshotDir, "tno_atlantropa_mediterranean_overview.png");
  await page.locator("#mapContainer").screenshot({ path: mediterraneanShot });
  const atlantropaSeaRuntime = await readAtlantropaSeaRuntime(page);
  expect(atlantropaSeaRuntime.featureCount).toBeGreaterThan(20);
  expect(atlantropaSeaRuntime.itemCount).toBeGreaterThan(20);
  const adriaticBasinDiagnostics = await readAtlantropaWaterFeatureDiagnostics(page, ADRIATIC_BASIN_TARGET_ID);
  expect(adriaticBasinDiagnostics.exists).toBe(true);
  expect(adriaticBasinDiagnostics.itemCount).toBeGreaterThan(0);
  expect(adriaticBasinDiagnostics.isWorldBounds).toBe(false);
  expect(adriaticBasinDiagnostics.area).toBeLessThan(0.05);
  expect(adriaticBasinDiagnostics.containsAdriaticProbe).toBe(true);
  expect(adriaticBasinDiagnostics.containsGlobalProbe).toBe(false);
  const clickedAdriaticBasin = await clickWaterFeature(page, ADRIATIC_BASIN_TARGET_ID);
  expect(clickedAdriaticBasin.hit?.targetType).toBe("water");
  const clickedAtlantropaSea = await clickWaterFeature(page, atlantropaSeaRuntime.sampleFeatureIds[0]);
  expect(clickedAtlantropaSea.hit?.targetType).toBe("water");
  await restoreScenarioViewportProvider(page);
  await resetZoomToFit(page);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });

  const probeResults = [];
  for (const probe of ATLANTROPA_ISLAND_PROBES) {
    await resetZoomToFit(page);
    await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
    await centerMapOnGeoPoint(page, probe.focus, {
      zoomPercent: probe.focus.zoomPercent,
    });
    await requestScenarioPoliticalChunk(page, {
      chunkId: `political.detail.country.${String(probe.ownerCode || "").toLowerCase()}`,
      focusCountry: probe.ownerCode,
      viewportBbox: buildProbeViewportBbox(probe),
      reason: `test-atlantropa-island-${String(probe.label || "").toLowerCase()}`,
    });
    await waitForLandFeature(page, probe.featureId);
    const runtime = await readLandFeatureRuntime(page, probe.featureId);
    expect(runtime.featureId).toBe(probe.featureId);
    expect(runtime.countryCode).toBe("ATL");
    expect(runtime.ownerCode).toBe(probe.ownerCode);
    expect(runtime.atlGeometryRole).toBe("donor_island");
    expect(runtime.atlJoinMode).toBe(probe.joinMode);
    expect(runtime.interactive).toBe(true);

    const { point: clickPoint } = await clickLandFeature(page, probe.featureId);
    await expect.poll(async () => (await readDevSelectedHit(page))?.id || "", { timeout: 30000 }).toBe(probe.featureId);
    const hit = await readDevSelectedHit(page);
    expect(hit?.countryCode || "").toBe(probe.ownerCode);
    const runtimeAfterClick = await readLandFeatureRuntime(page, probe.featureId);
    expect(runtimeAfterClick.ownerCode).toBe(probe.ownerCode);
    const patch = await sampleCanvasPatchAtPagePoint(page, clickPoint, 6);
    expect(patch).not.toBeNull();
    probeResults.push({
      label: probe.label,
      featureId: probe.featureId,
      ownerCode: probe.ownerCode,
      clickPoint,
      runtime,
      runtimeAfterClick,
      hit,
      patch,
    });
  }
  await restoreScenarioViewportProvider(page);

  await resetZoomToFit(page);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
  const helperFeatureId = await findAtlantropaHelperFeatureId(page);
  expect(helperFeatureId).toBeTruthy();
  await clearDevSelectedHit(page);
  const helperClick = await clickLandFeature(page, helperFeatureId, { acceptAnyHit: true });
  const helperPoint = helperClick.point;
  const helperHit = await waitForDevSelectedHit(page, {
    timeout: 300,
    polling: 100,
    expectedTargetType: "land",
    rejectPrefixes: HELPER_PREFIXES,
  }) || helperClick.hit || null;
  expect(HELPER_PREFIXES.some((prefix) => String(helperHit?.id || "").startsWith(prefix))).toBe(false);

  const runtimeSummary = {
    atlantropaSeaSample,
    atlantropaSeaSamples,
    atlantropaSeaRuntime,
    adriaticBasinDiagnostics,
    clickedAdriaticBasin,
    outerOceanPatch,
    probeResults,
    helperProbe: {
      featureId: helperFeatureId,
      clickPoint: helperPoint,
      hit: helperHit,
    },
    screenshots: [mediterraneanShot],
  };
  const runtimeSummaryPath = path.join(screenshotDir, "tno_atlantropa_runtime_summary.json");
  fs.writeFileSync(runtimeSummaryPath, JSON.stringify(runtimeSummary, null, 2));
  console.log(JSON.stringify({
    runtimeSummaryPath,
    screenshots: [mediterraneanShot],
  }));
});
