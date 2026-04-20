export function createBorderDrawOwner({
  state,
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const {
    boundaryDefaultLineCap = "round",
    boundaryDefaultLineJoin = "round",
    boundaryDefaultMiterLimit = 4,
    coastlineLodLowZoomMax = 1.8,
    coastlineLodMidZoomMax = 3.2,
    coastlineViewSimplifyCollinearAngleDeg = 4,
    coastlineViewSimplifyLowMinDistancePx = 3.6,
    coastlineViewSimplifyMidMinDistancePx = 1.8,
    detailAdmBorderAlphaScale = 1,
    detailAdmBorderColor = "#999999",
    detailAdmBorderMinWidth = 0.4,
    detailAdmBorderTargetMaxAlpha = 0.5,
    detailAdmBorderTargetMinAlpha = 0.1,
    detailAdmBorderWidthScale = 1,
    detailAdmBordersMinZoom = 4.4,
    internalBorderLocalAlphaScale = 1,
    internalBorderLocalMinAlpha = 0.15,
    internalBorderLocalMinWidth = 0.2,
    internalBorderLocalWidthScale = 1,
    internalBorderProvinceMinAlpha = 0.18,
    internalBorderProvinceMinWidth = 0.2,
    localBordersMinZoom = 2.6,
    provinceBordersFadeStartZoom = 1.05,
    provinceBordersFarAlpha = 0.08,
    provinceBordersFarWidthMaxZoom = 1.4,
    provinceBordersFarWidthScale = 0.75,
    provinceBordersNearAlphaScale = 1.08,
    provinceBordersNearWidthScale = 1.08,
    provinceBordersNearZoomStart = 3.2,
    provinceBordersTransitionAlpha = 0.24,
    provinceBordersTransitionEndZoom = 1.55,
  } = constants;

  const {
    getContext = () => null,
    getPathCanvas = () => null,
    getProjection = () => null,
    getDetailAdmMeshBuildState = () => ({ signature: "", status: "idle" }),
    getScenarioOwnerOnlyCanonicalFallbackWarnings = () => new Set(),
    getVisibleInternalBorderMeshSignature = () => "",
  } = getters;

  const {
    clamp = (value, min, max) => Math.min(max, Math.max(min, value)),
    buildCountryParentBorderMeshes = () => [],
    buildDetailAdmMeshSignature = () => ({ detailCountries: [], signature: "" }),
    drawTnoCoastalAccentLayer = () => {},
    getCoastlineCollectionForZoom = () => [],
    getInternalBorderStrokeColor = (_countryCode, fallbackColor) => fallbackColor,
    getSafeCanvasColor = (value, fallbackColor) => value || fallbackColor,
    getVisibleCountryCodesForBorderMeshes = () => new Set(),
    isUsableMesh = () => false,
    isDynamicBordersEnabled = () => false,
    sanitizePolyline = (line) => (Array.isArray(line) ? line : []),
    scheduleDeferredHeavyBorderMeshes = () => {},
    setDetailAdmMeshBuildState = () => {},
    setVisibleInternalBorderMeshSignature = () => {},
    syncStaticMeshSnapshot = () => {},
  } = helpers;

  function getScreenSpaceTurnAngleDeg(previousPoint, currentPoint, nextPoint) {
    if (!previousPoint || !currentPoint || !nextPoint) return 180;
    const ax = currentPoint[0] - previousPoint[0];
    const ay = currentPoint[1] - previousPoint[1];
    const bx = nextPoint[0] - currentPoint[0];
    const by = nextPoint[1] - currentPoint[1];
    const aLength = Math.hypot(ax, ay);
    const bLength = Math.hypot(bx, by);
    if (!(aLength > 0) || !(bLength > 0)) return 180;
    const cosine = clamp((ax * bx + ay * by) / (aLength * bLength), -1, 1);
    const interiorAngleDeg = Math.acos(cosine) * (180 / Math.PI);
    return Math.abs(180 - interiorAngleDeg);
  }

  function drawMeshCollection(meshCollection, strokeStyle, lineWidth, options = {}) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || typeof pathCanvas !== "function") return;
    if (!meshCollection || !meshCollection.length) return;
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.lineJoin = options.lineJoin || boundaryDefaultLineJoin;
    context.lineCap = options.lineCap || boundaryDefaultLineCap;
    context.miterLimit = Number.isFinite(Number(options.miterLimit))
      ? Number(options.miterLimit)
      : boundaryDefaultMiterLimit;
    const meshTransform = typeof options.transformMesh === "function" ? options.transformMesh : null;
    meshCollection.forEach((mesh) => {
      if (!mesh) return;
      const renderMesh = meshTransform ? meshTransform(mesh) : mesh;
      if (!isUsableMesh(renderMesh)) return;
      context.beginPath();
      pathCanvas(renderMesh);
      context.stroke();
    });
  }

  function declutterProjectedPolyline(line, minDistancePx, angleThresholdDeg) {
    const sanitized = sanitizePolyline(line);
    const projection = getProjection();
    if (sanitized.length <= 2 || !projection) return sanitized;

    const projected = sanitized.map((point) => projection(point));
    const keptIndices = [0];

    for (let index = 1; index < sanitized.length - 1; index += 1) {
      const projectedPoint = projected[index];
      const previousKeptProjected = projected[keptIndices[keptIndices.length - 1]];
      const nextProjected = projected[index + 1];
      if (!projectedPoint || !previousKeptProjected || !nextProjected) {
        keptIndices.push(index);
        continue;
      }
      const distancePx = Math.hypot(
        projectedPoint[0] - previousKeptProjected[0],
        projectedPoint[1] - previousKeptProjected[1],
      );
      const turnAngleDeg = getScreenSpaceTurnAngleDeg(previousKeptProjected, projectedPoint, nextProjected);
      if (distancePx < minDistancePx && turnAngleDeg < angleThresholdDeg) {
        continue;
      }
      keptIndices.push(index);
    }

    keptIndices.push(sanitized.length - 1);
    const result = [];
    keptIndices.forEach((index) => {
      const point = sanitized[index];
      if (!point) return;
      const previousPoint = result[result.length - 1];
      if (previousPoint && previousPoint[0] === point[0] && previousPoint[1] === point[1]) return;
      result.push(point);
    });
    return result.length >= 2 ? result : sanitized.slice(0, 2);
  }

  function getProjectedPolylineMetrics(line) {
    const sanitized = sanitizePolyline(line);
    const projection = getProjection();
    if (sanitized.length < 2 || !projection) {
      return {
        lengthPx: 0,
        bboxAreaPx: 0,
        maxSpanPx: 0,
      };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let lengthPx = 0;
    let previousProjected = null;
    sanitized.forEach((point) => {
      const projected = projection(point);
      if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return;
      minX = Math.min(minX, projected[0]);
      minY = Math.min(minY, projected[1]);
      maxX = Math.max(maxX, projected[0]);
      maxY = Math.max(maxY, projected[1]);
      if (previousProjected) {
        lengthPx += Math.hypot(projected[0] - previousProjected[0], projected[1] - previousProjected[1]);
      }
      previousProjected = projected;
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return {
        lengthPx,
        bboxAreaPx: 0,
        maxSpanPx: 0,
      };
    }
    const widthPx = Math.max(0, maxX - minX);
    const heightPx = Math.max(0, maxY - minY);
    return {
      lengthPx,
      bboxAreaPx: widthPx * heightPx,
      maxSpanPx: Math.max(widthPx, heightPx),
    };
  }

  function buildRenderableBoundaryMesh(mesh, {
    simplifyDistancePx = 0,
    minLengthPx = 0,
    minSpanPx = 0,
    minAreaPx = 0,
    angleThresholdDeg = coastlineViewSimplifyCollinearAngleDeg,
  } = {}) {
    if (!isUsableMesh(mesh)) return null;
    const nextCoordinates = mesh.coordinates
      .map((line) => {
        const simplified = simplifyDistancePx > 0
          ? declutterProjectedPolyline(line, simplifyDistancePx, angleThresholdDeg)
          : sanitizePolyline(line);
        if (!Array.isArray(simplified) || simplified.length < 2) return null;
        const metrics = getProjectedPolylineMetrics(simplified);
        if (minLengthPx > 0 && metrics.lengthPx < minLengthPx) return null;
        if (minSpanPx > 0 && metrics.maxSpanPx < minSpanPx) return null;
        if (minAreaPx > 0 && metrics.bboxAreaPx < minAreaPx) return null;
        return simplified;
      })
      .filter((line) => Array.isArray(line) && line.length >= 2);
    if (!nextCoordinates.length) return null;
    return {
      type: "MultiLineString",
      coordinates: nextCoordinates,
    };
  }

  function getViewportAwareCoastlineCollection(collection, k) {
    const minDistancePx = k < coastlineLodLowZoomMax
      ? coastlineViewSimplifyLowMinDistancePx
      : k < coastlineLodMidZoomMax
        ? coastlineViewSimplifyMidMinDistancePx
        : 0;
    const projection = getProjection();
    if (!(minDistancePx > 0) || !Array.isArray(collection) || !collection.length || !projection) {
      return collection;
    }
    return collection.map((mesh) => {
      if (!isUsableMesh(mesh)) return mesh;
      const nextCoordinates = mesh.coordinates
        .map((line) => declutterProjectedPolyline(line, minDistancePx, coastlineViewSimplifyCollinearAngleDeg))
        .filter((line) => Array.isArray(line) && line.length >= 2);
      if (!nextCoordinates.length) return mesh;
      return {
        type: "MultiLineString",
        coordinates: nextCoordinates,
      };
    });
  }

  function getBoundaryMeshTransform(kind, k) {
    const zoom = Math.max(0, Number(k) || 0);
    if (kind === "internal-local") {
      if (zoom < 1.5) {
        return (mesh) => buildRenderableBoundaryMesh(mesh, {
          simplifyDistancePx: 3.6,
          minLengthPx: 22,
          minSpanPx: 5,
          minAreaPx: 20,
        });
      }
      if (zoom < 2.4) {
        return (mesh) => buildRenderableBoundaryMesh(mesh, {
          simplifyDistancePx: 2.2,
          minLengthPx: 14,
          minSpanPx: 3,
          minAreaPx: 10,
        });
      }
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 0.75,
        minLengthPx: 4,
      });
    }
    if (kind === "internal-province") {
      if (zoom < 1.25) {
        return (mesh) => buildRenderableBoundaryMesh(mesh, {
          simplifyDistancePx: 2.4,
          minLengthPx: 16,
          minSpanPx: 4,
          minAreaPx: 12,
        });
      }
      if (zoom < 1.9) {
        return (mesh) => buildRenderableBoundaryMesh(mesh, {
          simplifyDistancePx: 1.6,
          minLengthPx: 10,
          minSpanPx: 2,
        });
      }
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 0.6,
        minLengthPx: 4,
      });
    }
    if (kind === "empire") {
      if (zoom < 1.4) {
        return (mesh) => buildRenderableBoundaryMesh(mesh, {
          simplifyDistancePx: 1.8,
          minLengthPx: 6,
        });
      }
      if (zoom < 2.2) {
        return (mesh) => buildRenderableBoundaryMesh(mesh, {
          simplifyDistancePx: 1.1,
          minLengthPx: 4,
        });
      }
      return null;
    }
    if (kind === "coastline") {
      if (zoom < coastlineLodLowZoomMax) {
        return (mesh) => buildRenderableBoundaryMesh(mesh, {
          simplifyDistancePx: 2.4,
          minLengthPx: 14,
          minSpanPx: 3,
        });
      }
      if (zoom < coastlineLodMidZoomMax) {
        return (mesh) => buildRenderableBoundaryMesh(mesh, {
          simplifyDistancePx: 1.2,
          minLengthPx: 8,
          minSpanPx: 2,
        });
      }
    }
    return null;
  }

  function drawHierarchicalBorders(k, { interactive = false } = {}) {
    const context = getContext();
    if (!context) return;
    const kEff = clamp(k, 1, 8);
    const t = (kEff - 1) / 7;
    const kDenom = Math.max(0.0001, k);
    const lowZoomDeclutter = k < coastlineLodLowZoomMax ? 0.82 : 1;
    const lowZoomWidthScale = k < coastlineLodLowZoomMax ? 0.92 : 1;
    const internal = state.styleConfig?.internalBorders || {};
    const empire = state.styleConfig?.empireBorders || {};
    const coast = state.styleConfig?.coastlines || {};
    const parent = state.styleConfig?.parentBorders || {};

    const empireColor = getSafeCanvasColor(empire.color, "#666666");
    const internalColor = getSafeCanvasColor(internal.color, "#cccccc");
    const coastColor = getSafeCanvasColor(coast.color, "#333333");
    const parentColor = getSafeCanvasColor(parent.color, "#4b5563");
    const provinceMeshTransform = getBoundaryMeshTransform("internal-province", k);
    const localMeshTransform = getBoundaryMeshTransform("internal-local", k);
    const empireMeshTransform = getBoundaryMeshTransform("empire", k);
    const coastlineMeshTransform = getBoundaryMeshTransform("coastline", k);

    const empireWidthBase = Number(empire.width) || 1;
    const internalWidthBase = Number(internal.width) || 0.5;
    const coastWidthBase = Number(coast.width) || 1.2;
    const parentWidthBase = Number(parent.width) || 1.1;
    const internalOpacity = Number.isFinite(Number(internal.opacity)) ? Number(internal.opacity) : 1;
    const parentOpacity = clamp(
      Number.isFinite(Number(parent.opacity)) ? Number(parent.opacity) : 0.85,
      0,
      1
    );
    const scenarioOwnerOnlyBorders =
      !!state.activeScenarioId && state.scenarioBorderMode === "scenario_owner_only";
    const dynamicOwnerMeshes =
      isDynamicBordersEnabled() && isUsableMesh(state.cachedDynamicOwnerBorders)
        ? [state.cachedDynamicOwnerBorders]
        : null;
    const openingOwnerMeshes =
      scenarioOwnerOnlyBorders
      && String(state.scenarioViewMode || "ownership") === "ownership"
      && !isDynamicBordersEnabled()
      && isUsableMesh(state.cachedScenarioOpeningOwnerBorders)
        ? [state.cachedScenarioOpeningOwnerBorders]
        : null;
    let empireMeshes = dynamicOwnerMeshes || state.cachedCountryBorders;
    if (scenarioOwnerOnlyBorders) {
      empireMeshes = dynamicOwnerMeshes || openingOwnerMeshes || null;
      if (!dynamicOwnerMeshes && !openingOwnerMeshes && state.cachedCountryBorders?.length) {
        const scenarioId = String(state.activeScenarioId || "").trim() || "(unknown)";
        const warnings = getScenarioOwnerOnlyCanonicalFallbackWarnings();
        if (!warnings.has(scenarioId)) {
          warnings.add(scenarioId);
          console.warn(
            `[map_renderer] scenario_owner_only borders unavailable for scenario=${scenarioId}; canonical country-border fallback suppressed to preserve scenario integrity.`
          );
        }
      }
    }

    if (interactive) {
      const countryWidth = (empireWidthBase * 0.95) / kDenom;
      const coastWidth = (coastWidthBase * 0.88) / kDenom;
      const coastlineLow = state.cachedCoastlinesLow?.length
        ? state.cachedCoastlinesLow
        : (state.cachedCoastlines?.length ? state.cachedCoastlines : state.cachedCoastlinesHigh);

      context.globalAlpha = 0.88;
      drawMeshCollection(empireMeshes, empireColor, countryWidth, { transformMesh: empireMeshTransform });

      context.globalAlpha = 0.78;
      drawMeshCollection(coastlineLow, coastColor, coastWidth, { transformMesh: coastlineMeshTransform });

      context.globalAlpha = 1.0;
      return;
    }

    const countryAlpha = 0.90;
    const regularProvinceAlpha = clamp(
      internalOpacity * (0.22 + 0.50 * t) * lowZoomDeclutter,
      internalBorderProvinceMinAlpha,
      0.74
    );
    let provinceAlpha = regularProvinceAlpha;
    if (k <= provinceBordersFadeStartZoom) {
      provinceAlpha = provinceBordersFarAlpha;
    } else if (k < provinceBordersTransitionEndZoom) {
      const fadeT = clamp(
        (k - provinceBordersFadeStartZoom)
        / (provinceBordersTransitionEndZoom - provinceBordersFadeStartZoom),
        0,
        1
      );
      provinceAlpha = provinceBordersFarAlpha
        + ((provinceBordersTransitionAlpha - provinceBordersFarAlpha) * fadeT);
    } else {
      provinceAlpha = Math.max(regularProvinceAlpha, provinceBordersTransitionAlpha);
    }
    const localAlpha = clamp(
      internalOpacity * (0.08 + 0.34 * t) * lowZoomDeclutter * internalBorderLocalAlphaScale,
      internalBorderLocalMinAlpha * internalBorderLocalAlphaScale,
      0.48 * internalBorderLocalAlphaScale
    );
    const parentAlpha = clamp(parentOpacity * (0.55 + 0.25 * t), 0.30, 0.90);
    const coastAlpha = clamp(0.74 + 0.12 * t, 0.74, 0.86);
    const detailAdmAlpha = clamp(
      (0.20 + 0.12 * t) * detailAdmBorderAlphaScale,
      detailAdmBorderTargetMinAlpha,
      detailAdmBorderTargetMaxAlpha
    );

    const countryWidth = (empireWidthBase * (0.95 + 0.40 * t)) / kDenom;
    let provinceWidth = Math.max(
      internalBorderProvinceMinWidth,
      internalWidthBase * (0.72 + 0.65 * t) * lowZoomWidthScale
    ) / kDenom;
    if (k < provinceBordersFarWidthMaxZoom) {
      provinceWidth *= provinceBordersFarWidthScale;
    }
    if (k >= provinceBordersNearZoomStart) {
      provinceAlpha *= provinceBordersNearAlphaScale;
      provinceWidth *= provinceBordersNearWidthScale;
    }
    const localWidth = Math.max(
      internalBorderLocalMinWidth,
      internalWidthBase * 0.40 * (0.70 + 0.55 * t) * lowZoomWidthScale
    ) * internalBorderLocalWidthScale / kDenom;
    const parentWidth = (parentWidthBase * (0.90 + 0.35 * t)) / kDenom;
    const coastWidth = (coastWidthBase * (0.90 + 0.30 * t)) / kDenom;
    const detailAdmWidth = Math.max(
      detailAdmBorderMinWidth,
      internalWidthBase * 0.42 * (0.72 + 0.40 * t) * lowZoomWidthScale
    ) * detailAdmBorderWidthScale / kDenom;
    const coastlineCollection = getViewportAwareCoastlineCollection(getCoastlineCollectionForZoom(k), k);
    const visibleCountryCodes = getVisibleCountryCodesForBorderMeshes();
    if (visibleCountryCodes.size > 0) {
      const includeProvinceMeshes = k >= provinceBordersTransitionEndZoom;
      const includeLocalMeshes = k >= localBordersMinZoom;
      const nextVisibleMeshSignature = [
        includeProvinceMeshes ? "province" : "country",
        includeLocalMeshes ? "local" : "nolocal",
        ...Array.from(visibleCountryCodes).sort((left, right) => left.localeCompare(right)),
      ].join("|");
      if (
        nextVisibleMeshSignature !== getVisibleInternalBorderMeshSignature()
        && (includeProvinceMeshes || includeLocalMeshes)
      ) {
        setVisibleInternalBorderMeshSignature(nextVisibleMeshSignature);
        scheduleDeferredHeavyBorderMeshes();
      }
    }

    if (k >= localBordersMinZoom) {
      context.globalAlpha = localAlpha;
      visibleCountryCodes.forEach((countryCode) => {
        const meshes = state.cachedLocalBordersByCountry?.get(countryCode) || [];
        drawMeshCollection(
          meshes,
          getInternalBorderStrokeColor(countryCode, internalColor),
          localWidth,
          { transformMesh: localMeshTransform }
        );
      });
    }

    context.globalAlpha = provinceAlpha;
    visibleCountryCodes.forEach((countryCode) => {
      const meshes = state.cachedProvinceBordersByCountry?.get(countryCode) || [];
      drawMeshCollection(
        meshes,
        getInternalBorderStrokeColor(countryCode, internalColor),
        provinceWidth,
        { transformMesh: provinceMeshTransform }
      );
    });

    if (k >= detailAdmBordersMinZoom) {
      const detailAdmMeta = buildDetailAdmMeshSignature(visibleCountryCodes, k);
      const detailAdmMeshBuildState = getDetailAdmMeshBuildState();
      const signatureChanged = detailAdmMeta.signature !== detailAdmMeshBuildState.signature;
      if (signatureChanged) {
        const hadDetailAdmBorders = state.cachedDetailAdmBorders.length > 0;
        state.cachedDetailAdmBorders = [];
        if (detailAdmMeta.detailCountries.length > 0) {
          setDetailAdmMeshBuildState({
            signature: detailAdmMeta.signature,
            status: "building",
          });
          if (hadDetailAdmBorders) {
            syncStaticMeshSnapshot();
          }
          scheduleDeferredHeavyBorderMeshes();
        } else {
          setDetailAdmMeshBuildState({
            signature: detailAdmMeta.signature,
            status: "empty",
          });
          if (hadDetailAdmBorders) {
            syncStaticMeshSnapshot();
          }
        }
      } else if (
        !state.cachedDetailAdmBorders.length
        && detailAdmMeshBuildState.status === "idle"
        && detailAdmMeta.detailCountries.length > 0
      ) {
        setDetailAdmMeshBuildState({
          signature: detailAdmMeta.signature,
          status: "building",
        });
        scheduleDeferredHeavyBorderMeshes();
      }
    }

    if (k >= detailAdmBordersMinZoom) {
      context.globalAlpha = detailAdmAlpha;
      drawMeshCollection(state.cachedDetailAdmBorders, detailAdmBorderColor, detailAdmWidth);
    }

    const enabledParentCountries = state.parentBordersVisible === false
      ? []
      : (state.parentBorderSupportedCountries || []).filter(
        (countryCode) => !!state.parentBorderEnabledByCountry?.[countryCode]
      );
    if (enabledParentCountries.length > 0) {
      context.globalAlpha = parentAlpha;
      enabledParentCountries.forEach((countryCode) => {
        let meshes = state.cachedParentBordersByCountry?.get(countryCode);
        if (!meshes) {
          meshes = buildCountryParentBorderMeshes(countryCode);
          if (state.cachedParentBordersByCountry instanceof Map) {
            state.cachedParentBordersByCountry.set(countryCode, meshes);
          }
        }
        drawMeshCollection(meshes, parentColor, parentWidth);
      });
    }

    context.globalAlpha = countryAlpha;
    drawMeshCollection(empireMeshes, empireColor, countryWidth, { transformMesh: empireMeshTransform });

    context.globalAlpha = coastAlpha;
    drawMeshCollection(coastlineCollection, coastColor, coastWidth, { transformMesh: coastlineMeshTransform });
    drawTnoCoastalAccentLayer(k, { interactive });

    context.globalAlpha = 1.0;
  }

  return {
    drawMeshCollection,
    declutterProjectedPolyline,
    getProjectedPolylineMetrics,
    buildRenderableBoundaryMesh,
    getViewportAwareCoastlineCollection,
    getBoundaryMeshTransform,
    drawHierarchicalBorders,
  };
}
