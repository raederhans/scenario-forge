export async function runPrecisionFoundationNativeCase({ dpr = 1.5, separatedEdits = false } = {}) {
  await import('/vendor/d3.v7.min.js');
  const { createGeometryRasterRuntimeOwner } = await import('/js/core/renderer/geometry_raster_runtime_owner.js');
  const width = 960, height = 600;
  const features = Array.from({ length: 1000 }, (_, i) => {
    const x = (i % 40) * 3 - 60, y = Math.floor(i / 40) * 2.4 - 30;
    const rings = [[[x, y], [x, y + 2.2], [x + 2.8, y + 2.2], [x + 2.8, y], [x, y]]];
    if (i === 41) rings.push([[x + .5, y + .5], [x + 2, y + .5], [x + 2, y + 1.5], [x + .5, y + 1.5], [x + .5, y + .5]]);
    return { type: 'Feature', id: String(i), geometry: { type: 'Polygon', coordinates: rings } };
  });
  // An unchanged late-painted polygon overlaps the edited area.
  features.push({ type: 'Feature', id: 'overlap', geometry: { type: 'Polygon', coordinates: [
    [[-57, -27], [-57, -23], [-52, -23], [-52, -27], [-57, -27]],
  ] } });
  const edited = new Set(features.filter((_, i) => i < 480 && i % 40 < 8).slice(0, 93).map(f => f.id));
  let color = '#dd4422', revision = 0;
  const separatedColors = new Map();
  const projection = d3.geoEqualEarth().scale(300).translate([320, 200]);
  const path = d3.geoPath(projection);
  function create(patches) {
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
    const metrics = [];
    const state = { firstVisibleFramePainted: true, activeScenarioId: 'fixture', sceneGeneration: 1,
      scenarioDataGeneration: 1, topologyRevision: 1, dpr, landData: { features },
      zoomTransform: { x: 0, y: 0, k: 1 }, renderPhase: 'idle' };
    const owner = createGeometryRasterRuntimeOwner({ state,
      surface: { getProjection: () => projection, getContext: () => context },
      helpers: { isEnabled: () => true, hasPendingColorEdit: () => true, allowPendingColorEdit: () => true,
        needsPoliticalRender: () => true, getPoliticalLayout: () => ({ pixelWidth: width, pixelHeight: height, offsetX: 0, offsetY: 0 }),
        getPoliticalSignature: () => `${revision}::static`,
        ...(patches ? { getPoliticalPatchStaticSignature: () => 'static', getPoliticalEntryPixelBounds: ({ feature }) => {
          const b = path.bounds(feature), t = state.zoomTransform;
          return { minX: (b[0][0] * t.k + t.x - 4) * dpr, minY: (b[0][1] * t.k + t.y - 4) * dpr,
            maxX: (b[1][0] * t.k + t.x + 4) * dpr, maxY: (b[1][1] * t.k + t.y + 4) * dpr };
        } } : {}),
        collectPoliticalItems: () => features.map(feature => ({ id: feature.id, feature })),
        orderPoliticalItems: items => items, excludeVisual: () => false, skipVisual: () => false,
        resolveFillColor: (_, id) => id === 'overlap' ? '#11bb66' : separatedEdits ? (separatedColors.get(id) || '#cccccc') : edited.has(id) ? color : '#cccccc',
        resolveStrokeColor: (_, fill) => fill, pointRadius: 2 },
      effects: { recordMetric: (...args) => metrics.push(args), requestRender() {} },
    });
    return { owner, canvas, context, state, metrics };
  }
  const incremental = create(true), reference = create(false), samples = [];
  try {
    const nextColors = separatedEdits
      ? ['#dd4422', '#2244dd', '#998833', '#33aabb', '#22dd44', '#993377', '#ddee33']
      : ['#dd4422', '#2244dd', '#dd4422', '#2244dd'];
    for (const [step, nextColor] of nextColors.entries()) {
      if (separatedEdits) {
        // Paint separated areas without reverting the other area. Its accepted
        // pixels must survive every crop, including a hole and later overlap.
        const column = step % 2 ? 28 : 0;
        features.filter((_, i) => i < 480 && i % 40 >= column && i % 40 < column + 8)
          .slice(0, 93).forEach(feature => separatedColors.set(feature.id, nextColor));
      }
      color = nextColor; revision++;
      await Promise.all([incremental.owner.preparePolitical(), reference.owner.preparePolitical()]);
      for (const fixture of [incremental, reference]) {
        fixture.context.clearRect(0, 0, width, height);
        if (!fixture.owner.drawPolitical()) throw new Error('Missing accepted frame');
      }
      const a = incremental.context.getImageData(0, 0, width, height).data;
      const b = reference.context.getImageData(0, 0, width, height).data;
      let differences = 0, maxDifference = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { differences++; maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i])); }
      const firstDifferences = [];
      for (let i = 0; i < a.length && firstDifferences.length < 12; i++) if (a[i] !== b[i]) {
        firstDifferences.push({ x: Math.floor(i / 4) % width, y: Math.floor(i / 4 / width), channel: i % 4, actual: a[i], expected: b[i] });
      }
      samples.push({ color, differences, maxDifference, firstDifferences });
    }
    incremental.state.zoomTransform.x += 15; reference.state.zoomTransform.x += 15;
    const patchesBeforePan = incremental.metrics.filter(([name]) => name === 'geometryWorkerPoliticalPatch').length;
    await Promise.all([incremental.owner.preparePolitical(), reference.owner.preparePolitical()]);
    const patchesAfterPan = incremental.metrics.filter(([name]) => name === 'geometryWorkerPoliticalPatch').length;
    color = '#cc88aa'; revision++;
    const stale = incremental.owner.preparePolitical();
    incremental.state.activeScenarioId = 'new-scene';
    await stale;
    return { dpr, samples, clearedPixels: incremental.metrics.filter(([name]) => name === 'geometryWorkerRoundTrip').map(([, , data]) => data.clearedPixelCount), editedCount: edited.size, patchesBeforePan, patchesAfterPan,
      patchMetrics: incremental.metrics.filter(([name]) => name === 'geometryWorkerPoliticalPatch').map(([, , details]) => details),
      staleDraw: incremental.owner.drawPolitical(),
      staleResults: incremental.metrics.filter(([name]) => name === 'geometryWorkerStaleResult').length,
      fallbacks: incremental.metrics.filter(([name]) => name === 'geometryWorkerFallback').length,
      uploads: incremental.metrics.filter(([name]) => name === 'geometryWorkerRoundTrip').map(([, , data]) => data.geometryUploads) };
  } finally { incremental.owner.dispose(); reference.owner.dispose(); }
}
