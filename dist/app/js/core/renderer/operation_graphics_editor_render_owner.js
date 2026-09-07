// Owns the operation-graphic editor preview and keyed SVG handles.
// Persistent state changes stay with the host and strategic runtime effects.
export function createOperationGraphicsEditorRenderOwner({
  runtimeState,
  rendererSurfaceHost,
  ensureOperationGraphicsEditorState,
  getOperationGraphicById,
  DEFAULT_OPERATION_GRAPHIC_KIND,
  normalizeOperationGraphicStylePreset,
  normalizeOperationGraphicStroke,
  normalizeOperationGraphicWidth,
  normalizeOperationGraphicOpacity,
  getOperationGraphicPreset,
  createOperationGraphicPath,
  getProjectedPoint,
  getStrategicOverlayRuntimeOwner,
  getMapLonLatFromEvent,
  getOperationGraphicEditorMidpoints,
}) {
  function getOperationGraphicEditorModel() {
    ensureOperationGraphicsEditorState();
    const isDrawing = !!runtimeState.operationGraphicsEditor.active;
    if (isDrawing) {
      const kind = String(runtimeState.operationGraphicsEditor.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
      return {
        mode: "draw",
        graphic: null,
        points: Array.isArray(runtimeState.operationGraphicsEditor.points) ? runtimeState.operationGraphicsEditor.points : [],
        kind,
        stylePreset: normalizeOperationGraphicStylePreset(runtimeState.operationGraphicsEditor.stylePreset, kind),
        stroke: normalizeOperationGraphicStroke(runtimeState.operationGraphicsEditor.stroke),
        width: normalizeOperationGraphicWidth(runtimeState.operationGraphicsEditor.width),
        opacity: normalizeOperationGraphicOpacity(runtimeState.operationGraphicsEditor.opacity),
        selectedVertexIndex: -1,
      };
    }
    const graphic = getOperationGraphicById(runtimeState.operationGraphicsEditor.selectedId);
    if (!graphic) {
      return null;
    }
    const kind = String(graphic.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
    return {
      mode: "edit",
      graphic,
      points: Array.isArray(graphic.points) ? graphic.points : [],
      kind,
      stylePreset: normalizeOperationGraphicStylePreset(graphic.stylePreset, kind),
      stroke: normalizeOperationGraphicStroke(graphic.stroke),
      width: normalizeOperationGraphicWidth(graphic.width),
      opacity: normalizeOperationGraphicOpacity(graphic.opacity),
      selectedVertexIndex: Math.max(-1, Number(runtimeState.operationGraphicsEditor.selectedVertexIndex) || -1),
    };
  }

  function syncInteractionLayerPointerEvents() {
    if (!rendererSurfaceHost.getInteractionRect()) return;
    const operationGraphicEditor = runtimeState.operationGraphicsEditor || {};
    const hasEditableOperationGraphic = !operationGraphicEditor.active
      && String(operationGraphicEditor.mode || "") === "edit"
      && !!String(operationGraphicEditor.selectedId || "").trim()
      && Array.isArray(operationGraphicEditor.points)
      && operationGraphicEditor.points.length > 0;
    rendererSurfaceHost.getInteractionRect()
      .style("pointer-events", hasEditableOperationGraphic ? "none" : "all")
      .lower();
  }

  function renderOperationGraphicsEditorOverlay(onVertexClick) {
    if (!rendererSurfaceHost.getOperationGraphicsEditorGroup()) return;
    ensureOperationGraphicsEditorState();
    const editorModel = getOperationGraphicEditorModel();
    const points = Array.isArray(editorModel?.points) ? editorModel.points : [];
    const isDrawing = editorModel?.mode === "draw";
    if (!editorModel || points.length === 0) {
      rendererSurfaceHost.getOperationGraphicsEditorGroup().selectAll("*").remove();
      rendererSurfaceHost.getOperationGraphicsEditorGroup().attr("aria-hidden", "true");
      syncInteractionLayerPointerEvents();
      return;
    }
    const geometryPreset = getOperationGraphicPreset(editorModel.kind);
    const stylePreset = getOperationGraphicPreset(editorModel.stylePreset);
    const previewPath = createOperationGraphicPath(points, {
      closed: !!geometryPreset.closed && points.length >= 3,
      curved: true,
    });
    const previewData = previewPath ? [{ id: "preview", d: previewPath, closed: !!geometryPreset.closed && points.length >= 3 }] : [];
    const pathSelection = rendererSurfaceHost.getOperationGraphicsEditorGroup()
      .selectAll("path.operation-graphics-editor-path")
      .data(previewData, (d) => d.id);

    pathSelection
      .enter()
      .append("path")
      .attr("class", "operation-graphics-editor-path")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .attr("pointer-events", "none")
      .attr("vector-effect", "non-scaling-stroke")
      .merge(pathSelection)
      .attr("d", (d) => d.d)
      .attr("fill", (d) => (d.closed ? "rgba(59, 130, 246, 0.08)" : "none"))
      .attr("stroke", editorModel.stroke || stylePreset.stroke)
      .attr("stroke-width", Math.max(1.5, editorModel.width || stylePreset.width))
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round")
      .attr("stroke-dasharray", stylePreset.dasharray || "8 4")
      .attr("opacity", Number.isFinite(Number(editorModel.opacity)) ? editorModel.opacity : stylePreset.opacity);

    pathSelection.exit().remove();

    const pointSelection = rendererSurfaceHost.getOperationGraphicsEditorGroup()
      .selectAll("circle.operation-graphics-editor-point")
      .data(points.map((coord, index) => ({ coord, index, id: `opg-point-${index}` })), (d) => d.id);

    const pointEnter = pointSelection
      .enter()
      .append("circle")
      .attr("class", "operation-graphics-editor-point")
      .attr("role", "presentation")
      .attr("aria-hidden", "true");

    pointEnter.merge(pointSelection)
      .attr("r", 4.2)
      .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
      .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
      .attr("fill", (_d, index) => (index === editorModel.selectedVertexIndex ? "#0f172a" : "#ffffff"))
      .attr("stroke", editorModel.stroke || stylePreset.stroke)
      .attr("stroke-width", (_d, index) => (index === editorModel.selectedVertexIndex ? 2 : 1.3))
      .attr("pointer-events", "all")
      .style("cursor", isDrawing ? "default" : "grab");

    pointSelection.exit().remove();

    if (!isDrawing && globalThis.d3?.drag) {
      if (!renderOperationGraphicsEditorOverlay.pointDragBehavior) {
        renderOperationGraphicsEditorOverlay.pointDragBehavior = globalThis.d3.drag()
          .on("start", function onStart(event, datum) {
            event?.sourceEvent?.stopPropagation?.();
            getStrategicOverlayRuntimeOwner().beginOperationGraphicVertexDrag(datum.index);
            globalThis.d3.select(this).style("cursor", "grabbing");
          })
          .on("drag", function onDrag(event, datum) {
            const coord = getMapLonLatFromEvent(event?.sourceEvent || event);
            getStrategicOverlayRuntimeOwner().moveOperationGraphicVertexDrag(datum.index, coord);
          })
          .on("end", function onEnd(_event, datum) {
            globalThis.d3.select(this).style("cursor", "grab");
            getStrategicOverlayRuntimeOwner().finishOperationGraphicVertexDrag(datum.index);
          });
      }
      pointEnter.merge(pointSelection)
        .on("click", (event, datum) => onVertexClick(event, datum, points))
        .call(renderOperationGraphicsEditorOverlay.pointDragBehavior);
    }

    const midpointData = !isDrawing
      ? getOperationGraphicEditorMidpoints(points, { closed: !!geometryPreset.closed && points.length >= 3 })
      : [];
    const midpointSelection = rendererSurfaceHost.getOperationGraphicsEditorGroup()
      .selectAll("circle.operation-graphics-editor-midpoint")
      .data(midpointData, (d) => d.id);

    midpointSelection
      .enter()
      .append("circle")
      .attr("class", "operation-graphics-editor-midpoint")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .merge(midpointSelection)
      .attr("r", 10)
      .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
      .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
      .attr("fill", editorModel.stroke || stylePreset.stroke)
      .attr("opacity", 0.001)
      .attr("stroke", "none")
      .attr("stroke-width", 0)
      .attr("pointer-events", "all")
      .style("cursor", "copy")
      .on("pointerdown", function onPointerDown(event, datum) {
        this.dataset.skipMidpointClick = "true";
        event.stopPropagation();
        event.preventDefault?.();
        getStrategicOverlayRuntimeOwner().insertOperationGraphicVertex(datum.insertIndex, datum.coord);
      })
      .on("click", function onClick(event, datum) {
        if (this.dataset.skipMidpointClick === "true") {
          this.dataset.skipMidpointClick = "false";
          return;
        }
        event.stopPropagation();
        getStrategicOverlayRuntimeOwner().insertOperationGraphicVertex(datum.insertIndex, datum.coord);
      });

    const midpointVisualSelection = rendererSurfaceHost.getOperationGraphicsEditorGroup()
      .selectAll("circle.operation-graphics-editor-midpoint-visual")
      .data(midpointData, (d) => d.id);

    midpointVisualSelection
      .enter()
      .append("circle")
      .attr("class", "operation-graphics-editor-midpoint-visual")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .merge(midpointVisualSelection)
      .attr("r", 4.6)
      .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
      .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
      .attr("fill", editorModel.stroke || stylePreset.stroke)
      .attr("opacity", 0.72)
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1)
      .attr("pointer-events", "none");

    rendererSurfaceHost.getOperationGraphicsEditorGroup().selectAll("circle.operation-graphics-editor-point").raise();

    midpointSelection.exit().remove();
    midpointVisualSelection.exit().remove();
    rendererSurfaceHost.getOperationGraphicsEditorGroup().attr("aria-hidden", "false");
    syncInteractionLayerPointerEvents();
  }

  return { renderOperationGraphicsEditorOverlay };
}
