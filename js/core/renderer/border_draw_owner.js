import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import { getPackedPaintContourMesh } from "./paint_contour_mesh.js";
import { yieldToBackground } from "../background_yield.js";

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
    borderPreparationMaxBytes = 32 * 1024 * 1024,
    // coastline LOD 采用两级阈值：低缩放(<coastlineLodLowZoomMax)优先压噪，
    // 中缩放(<coastlineLodMidZoomMax)平衡细节与性能，高缩放保留原始几何细节。
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
  if (!Number.isSafeInteger(borderPreparationMaxBytes) || borderPreparationMaxBytes < 0) {
    throw new RangeError("Border preparation byte budget must be a nonnegative integer.");
  }

  const {
    getContext = () => null,
    getPathCanvas = () => null,
    getProjection = () => null,
    getBoundaryPathViewport = () => null,
    getVisibleInternalBorderMeshSignature = () => "",
  } = getters;

  const {
    clamp = (value, min, max) => Math.min(max, Math.max(min, value)),
    buildCountryParentBorderMeshes = () => [],
    buildDetailAdmMeshSignature = () => ({ detailCountries: [], signature: "" }),
    drawScenarioCoastalAccentLayer = () => {},
    drawRiverInternalContours = () => {},
    getCoastlineCollectionForZoom = () => [],
    getInternalBorderStrokeColor = (_countryCode, fallbackColor) => fallbackColor,
    getSafeCanvasColor = (value, fallbackColor) => value || fallbackColor,
    getVisibleCountryCodesForBorderMeshes = () => new Set(),
    isUsableMesh = () => false,
    getPaintContourMeshes = () => [],
    getPoliticalBorderMeshes = () => [],
    getClassifiedBorderMeshes = () => null,
    sanitizePolyline = (line) => (Array.isArray(line) ? line : []),
    scheduleDeferredHeavyBorderMeshes = () => {},
    reconcileDetailAdmBorders = () => {},
    setVisibleInternalBorderMeshSignature = () => {},
    createBoundaryPath = () => new Path2D(),
  } = helpers;

  function internalMeshes(classification, category, code) {
    if (classification) {
      const mesh = classification[category].get(code);
      return mesh ? [mesh] : [];
    }
    const cache = { local: state.cachedLocalBordersByCountry, province: state.cachedProvinceBordersByCountry,
      parent: state.cachedParentBordersByCountry };
    return cache[category]?.get(code);
  }
  function internalCountries(classification) {
    return classification
      ? new Set([...classification.local.keys(), ...classification.province.keys(), ...classification.parent.keys()])
      : getVisibleCountryCodesForBorderMeshes();
  }

  let meshGeometryCache = new WeakMap();
  let meshCoordinateSources = new WeakMap();
  let meshProjectionGeneration = -1;
  let projectedMeshPaths = new WeakMap();
  const pathWork = new WeakMap();
  let preparedBorders = null;
  let pendingBorders = null;
  let preparationRevision = 0;
  let observedPreparationKey = null;
  const sameKey = (left, right) => !!left && !!right && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
  // The root supplies projection-space bounds expanded beyond the full backing
  // surface by all stroke/halo/miter/cap and AA reach. Unknown proof means null.
  function capturePathViewport(k, interactive) {
    const viewport = getBoundaryPathViewport(k, { interactive });
    if (!viewport || !["string", "number"].includes(typeof viewport.key)
      || (typeof viewport.key === "number" && !Number.isFinite(viewport.key))
      || !Array.isArray(viewport.bounds) || viewport.bounds.length !== 4
      || !viewport.bounds.every(Number.isFinite)
      || !Number.isFinite(viewport.maxStrokeWidth) || viewport.maxStrokeWidth <= 0
      || !Number.isFinite(viewport.maxMiterLimit) || viewport.maxMiterLimit < 1) return null;
    const [left, top, right, bottom] = viewport.bounds;
    if (!(left < right && top < bottom)) return null;
    return { bounds: [...viewport.bounds], maxStrokeWidth: viewport.maxStrokeWidth,
      maxMiterLimit: viewport.maxMiterLimit,
      key: [viewport.key, ...viewport.bounds, viewport.maxStrokeWidth, viewport.maxMiterLimit,
        state.zoomTransform?.x, state.zoomTransform?.y, state.zoomTransform?.k] };
  }
  function preparedViewportIsCurrent(lineWidth, lineCap, lineJoin, miterLimit) {
    if (!preparedBorders) return false;
    const current = capturePathViewport(preparedBorders.k, preparedBorders.interactive);
    // An unpruned path covers every viewport. Keep the native Path2D route
    // while a viewport-specific replacement is prepared.
    if (!preparedBorders.viewport) return true;
    if (!sameKey(preparedBorders.viewport.key, current?.key)) return false;
    const context = getContext();
    return Number.isFinite(lineWidth) && lineWidth > 0 && lineWidth <= current.maxStrokeWidth
      && ["butt", "round", "square"].includes(lineCap)
      && ["round", "bevel", "miter"].includes(lineJoin)
      && Number.isFinite(miterLimit) && miterLimit > 0 && miterLimit <= current.maxMiterLimit
      && typeof context?.getLineDash === "function" && context.getLineDash().length === 0
      && (!context.filter || context.filter === "none")
      && !context.shadowBlur && !context.shadowOffsetX && !context.shadowOffsetY;
  }
  const coordinateSource = mesh => getPackedPaintContourMesh(mesh) || mesh?.coordinates;
  const usableMesh = mesh => {
    const packed = getPackedPaintContourMesh(mesh);
    return packed ? packed.arcs.length > 0 : isUsableMesh(mesh);
  };
  function finishSteps(iterator) {
    let step;
    do { step = iterator.next(); } while (!step.done);
    return step.value;
  }
  function cachedMeshGeometry(mesh, key, build) {
    const generation = getProjectionGeometryGeneration(getProjection());
    if (generation !== meshProjectionGeneration) {
      meshGeometryCache = new WeakMap();
      meshCoordinateSources = new WeakMap();
      meshProjectionGeneration = generation;
    }
    let entries = meshGeometryCache.get(mesh);
    if (!entries || meshCoordinateSources.get(mesh) !== coordinateSource(mesh)) {
      entries = new Map();
      meshGeometryCache.set(mesh, entries);
      meshCoordinateSources.set(mesh, coordinateSource(mesh));
    }
    if (entries.has(key)) return entries.get(key);
    const result = build();
    // Current callers use a few fixed LOD parameter tuples. Bound future custom
    // styles too; replaced source meshes are naturally released by the WeakMap.
    if (entries.size >= 12) entries.delete(entries.keys().next().value);
    entries.set(key, result);
    return result;
  }

  function getProjectionScale(k = 1) {
    const scale = Number(k);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

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
    return Math.acos(cosine) * (180 / Math.PI);
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
      if (!usableMesh(renderMesh)) return;
      const candidatePath = preparedBorders?.generation === getProjectionGeometryGeneration(getProjection())
        ? projectedMeshPaths.get(renderMesh) : null;
      const preparedPath = candidatePath && (!candidatePath.viewportKey
        || preparedViewportIsCurrent(context.lineWidth, context.lineCap, context.lineJoin, context.miterLimit))
        ? candidatePath : null;
      if (preparedPath?.coordinates === coordinateSource(renderMesh)) { context.stroke(preparedPath.path); return; }
      context.beginPath();
      if (getPackedPaintContourMesh(renderMesh) && typeof getProjection()?.stream === "function") {
        let first = true;
        const stream = getProjection().stream({
          lineStart() { first = true; }, lineEnd() {}, polygonStart() {}, polygonEnd() {}, sphere() {},
          point(x, y) { if (first) { context.moveTo(x, y); first = false; } else context.lineTo(x, y); },
        });
        finishSteps(streamBoundaryLines(renderMesh, stream));
      } else pathCanvas(renderMesh);
      context.stroke();
    });
  }

  function drawCoastlineCollection(meshCollection, strokeStyle, lineWidth, k, { transformMesh = null } = {}) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || typeof pathCanvas !== "function" || !meshCollection?.length) return;
    const meshes = meshCollection
      .map((mesh) => mesh && transformMesh ? transformMesh(mesh) : mesh)
      .filter((mesh) => isUsableMesh(mesh));
    if (!meshes.length) return;
    const cachedCoast = preparedBorders?.generation === getProjectionGeometryGeneration(getProjection())
      // Coast paths retain complete geometry; their bounds affect native AA.
      && meshes.length === preparedBorders.coastMeshes.length
      && meshes.every((mesh, index) => mesh === preparedBorders.coastMeshes[index]
        && coordinateSource(mesh) === preparedBorders.coastSources[index])
      ? preparedBorders.coastPath : null;
    const buildPath = () => {
      if (cachedCoast) return cachedCoast;
      context.beginPath();
      meshes.forEach((mesh) => pathCanvas(mesh));
    };
    buildPath();
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.lineJoin = boundaryDefaultLineJoin;
    context.lineCap = boundaryDefaultLineCap;
    context.miterLimit = boundaryDefaultMiterLimit;
    if (cachedCoast) context.stroke(cachedCoast);
    else context.stroke();
  }

  function declutterProjectedPolyline(line, minDistancePx, angleThresholdDeg, k = 1) {
    const sanitized = sanitizePolyline(line);
    const projection = getProjection();
    if (sanitized.length <= 2 || !projection) return sanitized;

    const minDistanceProjected = minDistancePx / getProjectionScale(k);
    const projected = sanitized.map((point) => projection(point));
    return declutterPolylineWithProjection(sanitized, projected, minDistanceProjected, angleThresholdDeg).line;
  }

  function declutterPolylineWithProjection(sanitized, projected, minDistanceProjected, angleThresholdDeg) {
    return finishSteps(declutterPolylineSteps(sanitized, projected, minDistanceProjected, angleThresholdDeg));
  }

  function* expandPackedBoundaryLineSteps(packed, arc) {
    const line = [];
    for (let index = packed.offsets[arc]; index < packed.offsets[arc + 1]; index++) {
      line.push([packed.coordinates[index * 2], packed.coordinates[index * 2 + 1]]);
      if ((index + 1) % 256 === 0) yield;
    }
    return line;
  }

  function* projectPolylineSteps(line, projection) {
    const projected = new Array(line.length);
    for (let index = 0; index < line.length; index++) {
      if (index in line) projected[index] = projection(line[index]);
      if ((index + 1) % 256 === 0) yield;
    }
    return projected;
  }

  function* declutterPolylineSteps(sanitized, projected, minDistanceProjected, angleThresholdDeg) {
    const keptIndices = [0];

    for (let index = 1; index < sanitized.length - 1; index += 1) {
      if (index % 256 === 0) yield;
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
      if (distancePx < minDistanceProjected && turnAngleDeg < angleThresholdDeg) {
        continue;
      }
      keptIndices.push(index);
    }

    keptIndices.push(sanitized.length - 1);
    const result = [];
    const resultProjected = [];
    for (let keptIndex = 0; keptIndex < keptIndices.length; keptIndex++) {
      if (keptIndex % 256 === 255) yield;
      const index = keptIndices[keptIndex];
      const point = sanitized[index];
      if (!point) continue;
      const previousPoint = result[result.length - 1];
      if (previousPoint && previousPoint[0] === point[0] && previousPoint[1] === point[1]) continue;
      result.push(point);
      resultProjected.push(projected[index]);
    }
    return result.length >= 2
      ? { line: result, projected: resultProjected }
      : { line: sanitized.slice(0, 2), projected: projected.slice(0, 2) };
  }

  function getProjectedPolylineMetrics(line) {
    const sanitized = sanitizePolyline(line);
    const projection = getProjection();
    return measureProjectedPolyline(sanitized.length >= 2 && projection
      ? sanitized.map((point) => projection(point))
      : []);
  }

  function measureProjectedPolyline(projectedPoints) {
    return finishSteps(measureProjectedPolylineSteps(projectedPoints));
  }

  function* measureProjectedPolylineSteps(projectedPoints) {
    if (projectedPoints.length < 2) {
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
    for (let index = 0; index < projectedPoints.length; index++) {
      if (index % 256 === 255) yield;
      const projected = projectedPoints[index];
      if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) continue;
      minX = Math.min(minX, projected[0]);
      minY = Math.min(minY, projected[1]);
      maxX = Math.max(maxX, projected[0]);
      maxY = Math.max(maxY, projected[1]);
      if (previousProjected) {
        lengthPx += Math.hypot(projected[0] - previousProjected[0], projected[1] - previousProjected[1]);
      }
      previousProjected = projected;
    }
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

  // buildRenderableBoundaryMesh 面向“屏幕可读性”做几何简化：
  // 通过 simplifyDistancePx + angleThresholdDeg 合并近共线点，再用 minLengthPx/minSpanPx/minAreaPx
  // 过滤视觉贡献低的短线段，目标是降低低缩放抖动与过绘，同时保持边界形状识别度。
  function boundaryParameters({
    simplifyDistancePx = 0,
    minLengthPx = 0,
    minSpanPx = 0,
    minAreaPx = 0,
    angleThresholdDeg = coastlineViewSimplifyCollinearAngleDeg,
    k = 1,
  } = {}) {
    const projectionScale = getProjectionScale(k);
    const simplifyDistanceProjected = simplifyDistancePx / projectionScale;
    const minLengthProjected = minLengthPx / projectionScale;
    const minSpanProjected = minSpanPx / projectionScale;
    const minAreaProjected = minAreaPx / (projectionScale * projectionScale);
    const cacheKey = [
      "boundary",
      simplifyDistanceProjected,
      minLengthProjected,
      minSpanProjected,
      minAreaProjected,
      angleThresholdDeg,
    ].join("|");
    return { cacheKey, simplifyDistancePx, minLengthPx, minSpanPx, minAreaPx, angleThresholdDeg,
      simplifyDistanceProjected, minLengthProjected, minSpanProjected, minAreaProjected };
  }

  function* buildRenderableBoundaryMeshSteps(mesh, options) {
    const { simplifyDistancePx, minLengthPx, minSpanPx, minAreaPx, angleThresholdDeg,
      simplifyDistanceProjected, minLengthProjected, minSpanProjected, minAreaProjected } = boundaryParameters(options);
    const nextCoordinates = [];
    const packed = getPackedPaintContourMesh(mesh);
    for (const entry of packed ? packed.arcs : mesh.coordinates) {
      yield;
      const line = packed ? yield* expandPackedBoundaryLineSteps(packed, entry) : entry;
      const sanitized = sanitizePolyline(line);
      if (sanitized.length < 2) continue;
      const projection = getProjection();
      const projected = projection ? yield* projectPolylineSteps(sanitized, projection) : [];
      // Simplification and filtering share this projection, including any
      // non-finite points, so the existing metric accumulation order stays intact.
      const result = simplifyDistancePx > 0 && sanitized.length > 2 && projection
        ? yield* declutterPolylineSteps(sanitized, projected, simplifyDistanceProjected, angleThresholdDeg)
        : { line: sanitized, projected };
      const metrics = yield* measureProjectedPolylineSteps(result.projected);
      if (minLengthPx > 0 && metrics.lengthPx < minLengthProjected) continue;
      if (minSpanPx > 0 && metrics.maxSpanPx < minSpanProjected) continue;
      if (minAreaPx > 0 && metrics.bboxAreaPx < minAreaProjected) continue;
      if (Array.isArray(result.line) && result.line.length >= 2) nextCoordinates.push(result.line);
    }
    return nextCoordinates.length ? { type: "MultiLineString", coordinates: nextCoordinates } : null;
  }

  function buildRenderableBoundaryMesh(mesh, options = {}) {
    if (!usableMesh(mesh)) return null;
    return cachedMeshGeometry(mesh, boundaryParameters(options).cacheKey,
      () => finishSteps(buildRenderableBoundaryMeshSteps(mesh, options)));
  }

  function* buildViewportCoastMeshSteps(mesh, minDistancePx, k) {
    const nextCoordinates = [];
    const projection = getProjection();
    const packed = getPackedPaintContourMesh(mesh);
    for (const entry of packed ? packed.arcs : mesh.coordinates) {
      yield;
      const line = packed ? yield* expandPackedBoundaryLineSteps(packed, entry) : entry;
      const sanitized = sanitizePolyline(line);
      const result = sanitized.length <= 2 || !projection ? sanitized
        : (yield* declutterPolylineSteps(sanitized, yield* projectPolylineSteps(sanitized, projection),
          minDistancePx / getProjectionScale(k), coastlineViewSimplifyCollinearAngleDeg)).line;
      if (Array.isArray(result) && result.length >= 2) nextCoordinates.push(result);
    }
    return nextCoordinates.length ? { type: "MultiLineString", coordinates: nextCoordinates } : mesh;
  }

  function getViewportAwareCoastlineCollection(collection, k) {
    const minDistancePx = k < coastlineLodLowZoomMax
      ? coastlineViewSimplifyLowMinDistancePx
      : k < coastlineLodMidZoomMax
        ? coastlineViewSimplifyMidMinDistancePx
        : 0;
    const minDistanceProjected = minDistancePx / getProjectionScale(k);
    const projection = getProjection();
    if (!(minDistancePx > 0) || !Array.isArray(collection) || !collection.length || !projection) {
      return collection;
    }
    return collection.map((mesh) => {
      if (!usableMesh(mesh)) return mesh;
      return cachedMeshGeometry(mesh, ["coast", minDistanceProjected, coastlineViewSimplifyCollinearAngleDeg].join("|"),
        () => finishSteps(buildViewportCoastMeshSteps(mesh, minDistancePx, k)));
    });
  }

  function getBoundaryMeshTransform(kind, k, buildMesh = buildRenderableBoundaryMesh) {
    const zoom = Math.max(0, Number(k) || 0);
    if (kind === "internal-local") {
      if (zoom < 1.5) {
        return (mesh) => buildMesh(mesh, {
          simplifyDistancePx: 3.6,
          minLengthPx: 22,
          minSpanPx: 5,
          minAreaPx: 20,
          k: zoom,
        });
      }
      if (zoom < 2.4) {
        return (mesh) => buildMesh(mesh, {
          simplifyDistancePx: 2.2,
          minLengthPx: 14,
          minSpanPx: 3,
          minAreaPx: 10,
          k: zoom,
        });
      }
      return (mesh) => buildMesh(mesh, {
        simplifyDistancePx: 0.75,
        minLengthPx: 4,
        k: zoom,
      });
    }
    if (kind === "internal-province") {
      if (zoom < 1.25) {
        return (mesh) => buildMesh(mesh, {
          simplifyDistancePx: 2.4,
          minLengthPx: 16,
          minSpanPx: 4,
          minAreaPx: 12,
          k: zoom,
        });
      }
      if (zoom < 1.9) {
        return (mesh) => buildMesh(mesh, {
          simplifyDistancePx: 1.6,
          minLengthPx: 10,
          minSpanPx: 2,
          k: zoom,
        });
      }
      return (mesh) => buildMesh(mesh, {
        simplifyDistancePx: 0.6,
        minLengthPx: 4,
        k: zoom,
      });
    }
    if (kind === "empire") {
      if (zoom < 1.4) {
        return (mesh) => buildMesh(mesh, {
          simplifyDistancePx: 1.8,
          minLengthPx: 6,
          k: zoom,
        });
      }
      if (zoom < 2.2) {
        return (mesh) => buildMesh(mesh, {
          simplifyDistancePx: 1.1,
          minLengthPx: 4,
          k: zoom,
        });
      }
      return null;
    }
    if (kind === "coastline") {
      // 海岸线 transform 与 LOD 阈值一致：低缩放使用更强简化阈值，
      // 中缩放降低简化力度，高缩放交给原 mesh，保证缩放连续性与轮廓稳定性。
      if (zoom < coastlineLodLowZoomMax) {
        return (mesh) => buildMesh(mesh, {
          simplifyDistancePx: 2.4,
          minLengthPx: 14,
          minSpanPx: 3,
          k: zoom,
        });
      }
      if (zoom < coastlineLodMidZoomMax) {
        return (mesh) => buildMesh(mesh, {
          simplifyDistancePx: 1.2,
          minLengthPx: 8,
          minSpanPx: 2,
          k: zoom,
        });
      }
    }
    return null;
  }

  function captureBorderPreparation(k, interactive) {
    const classification = getClassifiedBorderMeshes();
    const projection = getProjection();
    const generation = getProjectionGeometryGeneration(projection);
    const viewport = capturePathViewport(k, interactive);
    const visible = interactive ? [] : [...internalCountries(classification)];
    const parents = interactive || state.parentBordersVisible === false ? []
      : (classification ? [...classification.parent.keys()] : state.parentBorderSupportedCountries || [])
        .filter(code => !!state.parentBorderEnabledByCountry?.[code]);
    const requests = [];
    const key = [k, interactive, projection, generation, ...(viewport?.key || [null]), state.zoomTransform?.k, state.activeScenarioId, state.sceneGeneration,
      state.scenarioDataGeneration, state.currentScenarioApplyRequestId,
      state.renderTransactionDiagnostics?.scenarioApplyEpoch, state.sovereigntyRevision, state.colorRevision,
      JSON.stringify([state.styleConfig?.internalBorders, state.styleConfig?.empireBorders,
        state.styleConfig?.coastlines, state.styleConfig?.parentBorders]), ...visible, "parents", ...parents];
    const add = (meshes, kind = null, coast = false) => {
      key.push(kind, coast);
      for (const mesh of meshes || []) {
        key.push(mesh, coordinateSource(mesh));
        if (mesh && usableMesh(mesh)) requests.push({ mesh, kind, coast });
      }
    };
    if (!interactive) {
      if (k >= localBordersMinZoom) for (const code of visible) add(internalMeshes(classification, 'local', code), "internal-local");
      for (const code of visible) add(internalMeshes(classification, 'province', code), "internal-province");
      if (!classification && k >= detailAdmBordersMinZoom) add(state.cachedDetailAdmBorders);
      for (const code of parents) add(internalMeshes(classification, 'parent', code));
    }
    add(getPaintContourMeshes());
    add(getPoliticalBorderMeshes());
    const coastOpacity = Number(state.styleConfig?.coastlines?.opacity);
    if ((Number.isFinite(coastOpacity) ? coastOpacity : 0.8) > 0) {
      const coasts = interactive
        ? state.cachedCoastlinesLow?.length ? state.cachedCoastlinesLow
          : state.cachedCoastlines?.length ? state.cachedCoastlines : state.cachedCoastlinesHigh
        : getCoastlineCollectionForZoom(k);
      add(coasts, "coastline", true);
    }
    return { key, requests, parents, classification, projection, generation, k, interactive, viewport,
      supported: typeof globalThis.Path2D === "function" && typeof globalThis.Path2D.prototype.addPath === "function"
        && typeof projection?.stream === "function"
        && (!!classification || !parents.length || state.cachedParentBordersByCountry instanceof Map)
        && requests.every(({ mesh }) => mesh.type === "MultiLineString"
          && (getPackedPaintContourMesh(mesh) || Array.isArray(mesh.coordinates))) };
  }

  function observePreparation(snapshot) {
    if (!sameKey(observedPreparationKey, snapshot.key)) {
      observedPreparationKey = snapshot.key;
      preparationRevision++;
    }
  }

  function getHierarchicalBordersPreparationState(k, { interactive = false } = {}) {
    const snapshot = captureBorderPreparation(k, interactive);
    observePreparation(snapshot);
    return { supported: snapshot.supported, revision: preparationRevision,
      projectedInputPoints: preparedBorders?.projectedInputPoints || 0,
      submittedPathPoints: preparedBorders?.submittedPathPoints || 0,
      estimatedPathBytes: preparedBorders?.estimatedPathBytes || 0, maxPreparedBytes: borderPreparationMaxBytes,
      ready: snapshot.supported && sameKey(preparedBorders?.key, snapshot.key),
      pending: snapshot.supported && !pendingBorders?.cancelled && sameKey(pendingBorders?.snapshot.key, snapshot.key) };
  }

  function cancelHierarchicalBordersPreparation() {
    if (pendingBorders) {
      pendingBorders.cancelled = true;
      pendingBorders.activeIterator?.return?.();
      pendingBorders.clearCandidate?.();
    }
    pendingBorders = null;
  }

  // Scene/mode/export exits release the accepted working set too. Ordinary
  // candidate cancellation intentionally keeps that set available to repaint.
  function clearHierarchicalBordersPreparation() {
    if (!pendingBorders && !preparedBorders && !observedPreparationKey) return;
    const pending = pendingBorders;
    cancelHierarchicalBordersPreparation();
    preparedBorders = null;
    observedPreparationKey = null;
    projectedMeshPaths = new WeakMap();
    meshGeometryCache = new WeakMap();
    meshCoordinateSources = new WeakMap();
    meshProjectionGeneration = -1;
    preparationRevision++;
    if (pending?.snapshot) {
      // Also detach the private input lists while an external yield is pending.
      pending.snapshot.key.length = 0;
      pending.snapshot.requests.length = 0;
      pending.snapshot.parents.length = 0;
      pending.snapshot = null;
    }
  }

  // Stream the exact MultiLineString into a real Path2D. The sink matches
  // d3-geo's canvas line stream, preserving spherical clipping/resampling while
  // keeping one line's stream state alive across preparation slices.
  function* streamBoundaryLines(mesh, stream) {
    const packed = getPackedPaintContourMesh(mesh);
    if (packed) {
      for (const arc of packed.arcs) {
        yield;
        stream.lineStart();
        const start = packed.offsets[arc], end = packed.offsets[arc + 1];
        for (let index = start; index < end; index++) {
          stream.point(packed.coordinates[index * 2], packed.coordinates[index * 2 + 1]);
          if ((index - start + 1) % 256 === 0) yield;
        }
        stream.lineEnd();
      }
    } else for (const line of mesh.coordinates) {
      yield;
      stream.lineStart();
      for (let index = 0; index < line.length; index++) {
        const point = line[index];
        stream.point(point[0], point[1], point[2]);
        if ((index + 1) % 256 === 0) yield;
      }
      stream.lineEnd();
    }
  }

  function* projectBoundaryPathSteps(mesh, projection, reserveBytes, viewport) {
    reserveBytes(256);
    let path = createBoundaryPath();
    let estimatedBytes = 256;
    let first = true, previousX, previousY, connected = false, linePoints = 0;
    let projectedInputPoints = 0, submittedPathPoints = 0;
    const emit = (method, x, y) => {
      reserveBytes(32); estimatedBytes += 32; submittedPathPoints++;
      path[method](x, y);
    };
    const outside = viewport ? (ax, ay, bx, by) => {
      const [left, top, right, bottom] = viewport.bounds;
      // Strict half-plane rejection retains touches and crossing segments with
      // original endpoints. A break can only occur entirely outside the guard.
      return (ax < left && bx < left) || (ax > right && bx > right)
        || (ay < top && by < top) || (ay > bottom && by > bottom);
    } : null;
    const stream = projection.stream({
      lineStart() { first = true; connected = false; linePoints = 0; },
      lineEnd() {
        if (outside && linePoints === 1 && !outside(previousX, previousY, previousX, previousY)) {
          emit("moveTo", previousX, previousY);
        }
      },
      polygonStart() {}, polygonEnd() {}, sphere() {},
      point(x, y) {
        projectedInputPoints++; linePoints++;
        if (!outside) emit(first ? "moveTo" : "lineTo", x, y);
        else if (!first) {
          if (outside(previousX, previousY, x, y)) connected = false;
          else {
            if (!connected) emit("moveTo", previousX, previousY);
            emit("lineTo", x, y);
            connected = true;
          }
        }
        first = false; previousX = x; previousY = y;
      },
    });
    try {
      yield* streamBoundaryLines(mesh, stream);
      pathWork.set(path, submittedPathPoints);
      return { path, coordinates: coordinateSource(mesh), estimatedBytes, projectedInputPoints, submittedPathPoints,
        viewportKey: viewport?.key || null };
    } finally {
      // D3 may retain its last stream sink. Do not let that sink retain a
      // cancelled candidate's native path after the generator is closed.
      path = null;
    }
  }

  function prepareHierarchicalBorders(k, {
    interactive = false, signal, isCurrent = () => true,
    yieldControl = yieldToBackground,
    nowMs = () => globalThis.performance?.now?.() ?? Date.now(), sliceBudgetMs = 4,
  } = {}) {
    const snapshot = captureBorderPreparation(k, interactive);
    observePreparation(snapshot);
    if (!snapshot.supported || signal?.aborted || !isCurrent()) return Promise.resolve(false);
    if (sameKey(preparedBorders?.key, snapshot.key)) return Promise.resolve(true);
    if (pendingBorders && !pendingBorders.cancelled && sameKey(pendingBorders.snapshot.key, snapshot.key)) return pendingBorders.promise;
    cancelHierarchicalBordersPreparation();
    const job = { snapshot, cancelled: false, promise: null };
    pendingBorders = job;
    const current = () => !job.cancelled && !signal?.aborted && isCurrent()
      && sameKey(job.snapshot.key, captureBorderPreparation(k, interactive).key);
    job.promise = Promise.resolve().then(async () => {
      await yieldControl();
      if (!current()) return false;
      // Parent mesh construction belongs to the existing source owner. Warm a
      // missing source once before taking the final geometry snapshot.
      for (const code of job.snapshot.classification ? [] : job.snapshot.parents) {
        if (!state.cachedParentBordersByCountry?.has(code)) {
          if (!(state.cachedParentBordersByCountry instanceof Map)) return false;
          state.cachedParentBordersByCountry.set(code, buildCountryParentBorderMeshes(code));
          job.snapshot = captureBorderPreparation(k, interactive);
          observePreparation(job.snapshot);
          await yieldControl();
          if (!current()) return false;
        }
      }
      let candidateGeometry = new WeakMap();
      let candidateSources = new WeakMap();
      let paths = new WeakMap();
      const coastMeshes = [];
      let coastPath = null, estimatedPathBytes = 0, adopted = false;
      let projectedInputPoints = 0, submittedPathPoints = 0;
      job.clearCandidate = () => {
        candidateGeometry = new WeakMap(); candidateSources = new WeakMap(); paths = new WeakMap();
        if (!adopted) coastMeshes.length = 0;
        coastPath = null;
      };
      function reserveBytes(bytes) {
        if (estimatedPathBytes + bytes > borderPreparationMaxBytes) {
          throw new RangeError("Prepared border paths exceed the byte budget.");
        }
        estimatedPathBytes += bytes;
      }
      let startedAt = nowMs();
      async function runSteps(iterator) {
        job.activeIterator = iterator;
        try {
          for (;;) {
            const step = iterator.next();
            if (step.done) return step.value;
            if (nowMs() - startedAt >= sliceBudgetMs) {
              await yieldControl();
              if (!current()) throw Object.assign(new Error("Stale border preparation."), { name: "AbortError" });
              startedAt = nowMs();
            }
          }
        } finally {
          iterator.return?.();
          if (job.activeIterator === iterator) job.activeIterator = null;
        }
      }
      async function geometry(mesh, cacheKey, iterator) {
        let entries = candidateGeometry.get(mesh);
        if (!entries) {
          entries = meshProjectionGeneration === job.snapshot.generation && meshCoordinateSources.get(mesh) === coordinateSource(mesh)
            ? new Map(meshGeometryCache.get(mesh)) : new Map();
          candidateGeometry.set(mesh, entries); candidateSources.set(mesh, coordinateSource(mesh));
        }
        if (entries.has(cacheKey)) return entries.get(cacheKey);
        const result = await runSteps(iterator);
        if (entries.size >= 12) entries.delete(entries.keys().next().value);
        entries.set(cacheKey, result);
        return result;
      }
      try {
        // Prepare complete coast paths first. A mesh shared with another role
        // must never acquire a pruned path before its coast request is visited.
        // This only changes preparation order; drawing order remains unchanged.
        const orderedRequests = [...job.snapshot.requests.filter(request => request.coast),
          ...job.snapshot.requests.filter(request => !request.coast)];
        for (const request of orderedRequests) {
          let mesh = request.mesh;
          if (request.coast && !interactive) {
            const distance = k < coastlineLodLowZoomMax ? coastlineViewSimplifyLowMinDistancePx
              : k < coastlineLodMidZoomMax ? coastlineViewSimplifyMidMinDistancePx : 0;
            if (distance > 0) mesh = await geometry(mesh,
              ["coast", distance / getProjectionScale(k), coastlineViewSimplifyCollinearAngleDeg].join("|"),
              buildViewportCoastMeshSteps(mesh, distance, k));
            if (!current()) return false;
          }
          const descriptor = request.kind && getBoundaryMeshTransform(request.kind, k, (_mesh, options) => options);
          if (descriptor) {
            const options = descriptor(mesh);
            mesh = await geometry(mesh, boundaryParameters(options).cacheKey, buildRenderableBoundaryMeshSteps(mesh, options));
            if (!current()) return false;
          }
          if (!usableMesh(mesh)) continue;
          if (!paths.has(mesh)) {
            const pathViewport = request.coast ? null : job.snapshot.viewport;
            const old = preparedBorders?.generation === job.snapshot.generation ? projectedMeshPaths.get(mesh) : null;
            if (old?.coordinates === coordinateSource(mesh)
              && (pathViewport ? sameKey(old.viewportKey, pathViewport.key) : !old.viewportKey)) {
              reserveBytes(old.estimatedBytes); paths.set(mesh, old);
            } else paths.set(mesh, await runSteps(projectBoundaryPathSteps(mesh, job.snapshot.projection, reserveBytes, pathViewport)));
          }
          projectedInputPoints += paths.get(mesh).projectedInputPoints;
          submittedPathPoints += paths.get(mesh).submittedPathPoints;
          if (request.coast) coastMeshes.push(mesh);
          if (nowMs() - startedAt >= sliceBudgetMs) {
            await yieldControl(); if (!current()) return false; startedAt = nowMs();
          }
        }
        if (coastMeshes.length) { reserveBytes(256); coastPath = createBoundaryPath(); }
        let coastPathPoints = 0;
        for (const mesh of coastMeshes) {
          reserveBytes(paths.get(mesh).estimatedBytes - 256);
          coastPath.addPath(paths.get(mesh).path);
          coastPathPoints += paths.get(mesh).submittedPathPoints;
          if (nowMs() - startedAt >= sliceBudgetMs) {
            await yieldControl(); if (!current()) return false; startedAt = nowMs();
          }
        }
        if (coastPath) pathWork.set(coastPath, coastPathPoints);
        if (!current()) return false;
        meshGeometryCache = candidateGeometry; meshCoordinateSources = candidateSources;
        meshProjectionGeneration = job.snapshot.generation; projectedMeshPaths = paths;
        preparedBorders = { key: job.snapshot.key, viewport: job.snapshot.viewport, k, interactive,
          generation: job.snapshot.generation, coastMeshes, coastSources: coastMeshes.map(coordinateSource),
          coastPath, estimatedPathBytes, projectedInputPoints, submittedPathPoints };
        adopted = true;
        return true;
      } catch (error) {
        if (error?.name === "AbortError" && !current()) return false;
        throw error;
      }
    }).finally(() => {
      job.activeIterator?.return?.(); job.activeIterator = null;
      job.clearCandidate?.(); job.clearCandidate = null; job.snapshot = null;
      if (pendingBorders === job) pendingBorders = null;
    });
    return job.promise;
  }

  function drawHierarchicalBorders(k, { interactive = false } = {}) {
    const context = getContext();
    if (!context) return;
    const classification = getClassifiedBorderMeshes();
    const kEff = clamp(k, 1, 8);
    const t = (kEff - 1) / 7;
    const kDenom = Math.max(0.0001, k);
    const lowZoomDeclutter = k < coastlineLodLowZoomMax ? 0.82 : 1;
    const lowZoomWidthScale = k < coastlineLodLowZoomMax ? 0.92 : 1;
    const internal = state.styleConfig?.internalBorders || {};
    const empire = state.styleConfig?.empireBorders || {};
    const coast = state.styleConfig?.coastlines || {};
    const parent = state.styleConfig?.parentBorders || {};

    const empireColor = getSafeCanvasColor(empire.color, "#4b5563");
    const internalColor = getSafeCanvasColor(internal.color, "#cccccc");
    const coastColor = getSafeCanvasColor(coast.color, "#333333");
    const parentColor = getSafeCanvasColor(parent.color, "#4b5563");
    const provinceMeshTransform = getBoundaryMeshTransform("internal-province", k);
    const localMeshTransform = getBoundaryMeshTransform("internal-local", k);
    const empireMeshTransform = null; // preserve the exact outline of small painted regions
    const coastlineMeshTransform = getBoundaryMeshTransform("coastline", k);

    const empireWidthBase = Number(empire.width) || 1.2;
    const internalWidthBase = Number(internal.width) || 0.5;
    const coastWidthBase = Number.isFinite(Number(coast.width)) ? Number(coast.width) : 1.2;
    const parentWidthBase = Number(parent.width) || 1.1;
    const internalOpacity = clamp(
      Number.isFinite(Number(internal.opacity)) ? Number(internal.opacity) : 1,
      0,
      1
    );
    const countryOpacity = clamp(
      Number.isFinite(Number(empire.opacity)) ? Number(empire.opacity) : 0.9,
      0,
      1
    );
    const coastOpacity = clamp(
      Number.isFinite(Number(coast.opacity)) ? Number(coast.opacity) : 0.8,
      0,
      1
    );
    const coastWidth = (coastWidthBase * 0.8) / kDenom;
    const coastAlpha = coastOpacity * 0.875;
    const parentOpacity = clamp(
      Number.isFinite(Number(parent.opacity)) ? Number(parent.opacity) : 0.85,
      0,
      1
    );
    // An empty contour mesh is a valid result (same-color land or pending
    // geometry). Never substitute old owner/canonical borders for that result.
    const empireMeshes = getPaintContourMeshes();
    const politicalMeshes = getPoliticalBorderMeshes();
    const activeScenarioId = String(state.activeScenarioId || "").trim();
    const hasActiveScenario = !!activeScenarioId
      && activeScenarioId !== "blank_base"
      && state.mapSemanticMode !== "blank";

    // Political ownership boundaries enter at a quiet scale and settle into
    // the established country-border style by medium zoom. Keep this identical
    // in interactive and settled passes so a completed frame does not pop.
    const politicalTransition = clamp((k - 1) / (3.2 - 1), 0, 1);
    const politicalBlend = politicalTransition * politicalTransition * (3 - 2 * politicalTransition);
    const fullCountryWidth = empireWidthBase * (0.95 + 0.40 * t);
    const politicalWidth = (
      (empireWidthBase * 0.6) + ((fullCountryWidth - (empireWidthBase * 0.6)) * politicalBlend)
    ) / kDenom;
    const politicalAlpha = countryOpacity * (0.68 + (0.32 * politicalBlend));
    const paintWidth = hasActiveScenario
      ? (empireWidthBase * 0.65) / kDenom
      : ((interactive ? empireWidthBase * 0.95 : fullCountryWidth) / kDenom);
    const paintAlpha = hasActiveScenario
      ? countryOpacity * 0.5
      : countryOpacity * (interactive ? 0.88 : 1);

    drawRiverInternalContours({ k, interactive, color: empireColor, alpha: paintAlpha,
      width: paintWidth, lineJoin: boundaryDefaultLineJoin, lineCap: boundaryDefaultLineCap,
      miterLimit: boundaryDefaultMiterLimit });

    if (interactive) {
      const drawCanonicalCoastlines = coastOpacity > 0 && coastWidth > 0;
      const coastlineLow = drawCanonicalCoastlines
        ? (
          state.cachedCoastlinesLow?.length
            ? state.cachedCoastlinesLow
            : (state.cachedCoastlines?.length ? state.cachedCoastlines : state.cachedCoastlinesHigh)
        )
        : null;

      context.globalAlpha = paintAlpha;
      drawMeshCollection(empireMeshes, empireColor, paintWidth, { transformMesh: empireMeshTransform });
      context.globalAlpha = politicalAlpha;
      drawMeshCollection(politicalMeshes, empireColor, politicalWidth, { transformMesh: empireMeshTransform });

      if (drawCanonicalCoastlines) {
        context.globalAlpha = coastAlpha;
        drawCoastlineCollection(coastlineLow, coastColor, coastWidth, k, { transformMesh: coastlineMeshTransform });
        drawScenarioCoastalAccentLayer(k, { interactive });
      }

      context.globalAlpha = 1.0;
      return;
    }

    const regularProvinceAlpha = clamp(
      internalOpacity * (0.22 + 0.50 * t) * lowZoomDeclutter,
      0,
      0.74
    );
    let provinceAlpha = regularProvinceAlpha;
    if (k <= provinceBordersFadeStartZoom) {
      provinceAlpha = provinceBordersFarAlpha * internalOpacity;
    } else if (k < provinceBordersTransitionEndZoom) {
      const fadeT = clamp(
        (k - provinceBordersFadeStartZoom)
        / (provinceBordersTransitionEndZoom - provinceBordersFadeStartZoom),
        0,
        1
      );
      provinceAlpha = internalOpacity * (
        provinceBordersFarAlpha
        + ((provinceBordersTransitionAlpha - provinceBordersFarAlpha) * fadeT)
      );
    } else {
      provinceAlpha = Math.max(regularProvinceAlpha, provinceBordersTransitionAlpha * internalOpacity);
    }
    const localAlpha = clamp(
      internalOpacity * (0.08 + 0.34 * t) * lowZoomDeclutter * internalBorderLocalAlphaScale,
      0,
      0.48 * internalBorderLocalAlphaScale
    );
    const parentAlpha = clamp(parentOpacity * (0.55 + 0.25 * t), 0.30, 0.90);
    const detailAdmAlpha = clamp(
      internalOpacity * (0.20 + 0.12 * t) * detailAdmBorderAlphaScale,
      0,
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
    const detailAdmWidth = Math.max(
      detailAdmBorderMinWidth,
      internalWidthBase * 0.42 * (0.72 + 0.40 * t) * lowZoomWidthScale
    ) * detailAdmBorderWidthScale / kDenom;
    const drawCanonicalCoastlines = coastOpacity > 0 && coastWidth > 0;
    const coastlineCollection = drawCanonicalCoastlines
      ? getViewportAwareCoastlineCollection(getCoastlineCollectionForZoom(k), k)
      : null;
    const visibleCountryCodes = internalCountries(classification);
    if (!classification && visibleCountryCodes.size > 0) {
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
        const meshes = internalMeshes(classification, 'local', countryCode) || [];
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
      const meshes = internalMeshes(classification, 'province', countryCode) || [];
      drawMeshCollection(
        meshes,
        getInternalBorderStrokeColor(countryCode, internalColor),
        provinceWidth,
        { transformMesh: provinceMeshTransform }
      );
    });

    if (!classification && k >= detailAdmBordersMinZoom) {
      const detailAdmMeta = buildDetailAdmMeshSignature(visibleCountryCodes, k);
      reconcileDetailAdmBorders(detailAdmMeta);
    }

    if (!classification && k >= detailAdmBordersMinZoom) {
      context.globalAlpha = detailAdmAlpha;
      drawMeshCollection(state.cachedDetailAdmBorders, detailAdmBorderColor, detailAdmWidth);
    }

    const enabledParentCountries = state.parentBordersVisible === false
      ? []
      : (classification ? [...classification.parent.keys()] : state.parentBorderSupportedCountries || []).filter(
        (countryCode) => !!state.parentBorderEnabledByCountry?.[countryCode]
      );
    if (enabledParentCountries.length > 0) {
      context.globalAlpha = parentAlpha;
      enabledParentCountries.forEach((countryCode) => {
        let meshes = internalMeshes(classification, 'parent', countryCode);
        if (!meshes) {
          meshes = buildCountryParentBorderMeshes(countryCode);
          if (state.cachedParentBordersByCountry instanceof Map) {
            state.cachedParentBordersByCountry.set(countryCode, meshes);
          }
        }
        drawMeshCollection(meshes, parentColor, parentWidth);
      });
    }

    context.globalAlpha = paintAlpha;
    drawMeshCollection(empireMeshes, empireColor, paintWidth, { transformMesh: empireMeshTransform });
    context.globalAlpha = politicalAlpha;
    drawMeshCollection(politicalMeshes, empireColor, politicalWidth, { transformMesh: empireMeshTransform });

    if (drawCanonicalCoastlines) {
      context.globalAlpha = coastAlpha;
      drawCoastlineCollection(coastlineCollection, coastColor, coastWidth, k, { transformMesh: coastlineMeshTransform });
      drawScenarioCoastalAccentLayer(k, { interactive });
    }

    context.globalAlpha = 1.0;
  }

  return {
    drawMeshCollection,
    declutterProjectedPolyline,
    getProjectedPolylineMetrics,
    buildRenderableBoundaryMesh,
    getViewportAwareCoastlineCollection,
    getBoundaryMeshTransform,
    prepareHierarchicalBorders,
    getHierarchicalBordersPreparationState,
    cancelHierarchicalBordersPreparation,
    clearHierarchicalBordersPreparation,
    getPathWork: path => pathWork.get(path) ?? null,
    drawHierarchicalBorders,
  };
}
