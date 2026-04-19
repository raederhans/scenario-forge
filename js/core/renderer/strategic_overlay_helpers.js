// Strategic overlay leaf draw helpers owner for Wave 3 split.
export function createStrategicOverlayHelpersOwner({
  state,
  constants = {},
  helpers = {},
  groupGetters = {},
} = {}) {
  const {
    defaultUnitCounterBaseFill = "#f4f0e6",
    strategicLineLabelFont = '"IBM Plex Sans", "Segoe UI", sans-serif',
  } = constants;
  const {
    renderStrategicDefs,
    ensureOperationalLineEditorState,
    getOperationalLinePreset,
    projectStrategicPoints,
    createOperationGraphicPath,
    getOperationGraphicLabelAnchor,
    selectOperationalLineById,
    getOperationGraphicPreset,
    selectOperationGraphicById,
    renderOperationGraphicsEditorOverlay,
    ensureUnitCounterEditorState,
    getProjectedPoint,
    getUnitCounterRenderEntries,
    getUnitCounterCardModel,
    getUnitCounterRenderScale,
    getUnitCounterSlotOffset,
    compareUnitCounterRenderOrder,
    getUnitCounterNodeTransform,
    getUnitCounterIconPath,
    updateSpecialZonesPaths,
    renderSpecialZoneEditorOverlay,
    getEffectiveSpecialZonesFeatureCollection,
  } = helpers;

function renderOperationalLinesOverlay() {
  const operationalLinesGroup = groupGetters.getOperationalLinesGroup?.() || null;
  if (!operationalLinesGroup) return;
  renderStrategicDefs();
  ensureOperationalLineEditorState();
  const lines = Array.isArray(state.operationalLines) ? state.operationalLines : [];
  const selectedId = String(state.operationalLineEditor?.selectedId || "");
  const rendered = lines
    .map((line) => {
      const stylePreset = getOperationalLinePreset(line.stylePreset || line.kind);
      const projectedPoints = projectStrategicPoints(line.points);
      const path = createOperationGraphicPath(line.points, {
        closed: false,
        curved: stylePreset.curved !== false,
      });
      if (!path) return null;
      return {
        line,
        stylePreset,
        path,
        projectedPoints,
        labelAnchor: getOperationGraphicLabelAnchor(projectedPoints, { closed: false }),
      };
    })
    .filter(Boolean);

  const groups = operationalLinesGroup
    .selectAll("g.operational-line")
    .data(rendered, (d) => d.line.id);

  const groupEnter = groups.enter().append("g").attr("class", "operational-line");
  groupEnter.append("path").attr("class", "operational-line-casing");
  groupEnter.append("path").attr("class", "operational-line-path");
  groupEnter.append("path").attr("class", "operational-line-hit");
  const labelEnter = groupEnter.append("g").attr("class", "operational-line-label");
  labelEnter.append("rect");
  labelEnter.append("text");

  const merged = groupEnter.merge(groups);
  merged.select("path.operational-line-casing")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", (d) => (d.line.id === selectedId ? "rgba(248, 244, 233, 0.96)" : "rgba(17, 24, 39, 0.5)"))
    .attr("stroke-width", (d) => {
      const baseWidth = d.line.width > 0 ? d.line.width : d.stylePreset.width;
      return baseWidth + (d.line.id === selectedId ? 2.2 : 1.4);
    })
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.stylePreset.dasharray || null)
    .attr("opacity", (d) => (d.line.id === selectedId ? 0.95 : 0.72));

  merged.select("path.operational-line-path")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", (d) => d.line.stroke || d.stylePreset.stroke)
    .attr("stroke-width", (d) => {
      const baseWidth = d.line.width > 0 ? d.line.width : d.stylePreset.width;
      return d.line.id === selectedId ? baseWidth + 0.6 : baseWidth;
    })
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.stylePreset.dasharray || null)
    .attr("opacity", (d) => Number.isFinite(Number(d.line.opacity)) ? Number(d.line.opacity) : d.stylePreset.opacity)
    .attr("marker-end", (d) => d.stylePreset.markerEnd || null);

  merged.select("path.operational-line-hit")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", "transparent")
    .attr("stroke-width", (d) => Math.max(14, (d.line.width > 0 ? d.line.width : d.stylePreset.width) + 8))
    .attr("pointer-events", "stroke");

  merged.select("g.operational-line-label")
    .attr("display", (d) => (d.line.label && Array.isArray(d.labelAnchor) ? null : "none"))
    .attr("transform", (d) => `translate(${d.labelAnchor?.[0] ?? -9999},${d.labelAnchor?.[1] ?? -9999})`);

  merged.select("g.operational-line-label text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", strategicLineLabelFont)
    .attr("font-size", 9)
    .attr("font-weight", 700)
    .attr("letter-spacing", "0.05em")
    .attr("fill", "#1f2937")
    .text((d) => d.line.label || "");

  merged.select("g.operational-line-label rect")
    .each(function eachLabelPlate() {
      const textNode = globalThis.d3.select(this.parentNode).select("text").node();
      const bbox = textNode?.getBBox?.();
      const width = bbox ? bbox.width + 12 : 56;
      const height = bbox ? bbox.height + 6 : 16;
      globalThis.d3.select(this)
        .attr("x", -width / 2)
        .attr("y", -height / 2)
        .attr("width", width)
        .attr("height", height)
        .attr("rx", 2)
        .attr("ry", 2)
        .attr("fill", "rgba(248, 244, 233, 0.94)")
        .attr("stroke", "rgba(55, 65, 81, 0.55)")
        .attr("stroke-width", 0.8);
    });

  merged.on("click", (event, datum) => {
    event.stopPropagation();
    selectOperationalLineById(datum.line.id);
  });

  groups.exit().remove();
  operationalLinesGroup.attr("aria-hidden", rendered.length ? "false" : "true");
}

function renderOperationGraphicsOverlay() {
  const operationGraphicsGroup = groupGetters.getOperationGraphicsGroup?.() || null;
  if (!operationGraphicsGroup) return;
  renderStrategicDefs();
  const graphics = Array.isArray(state.operationGraphics) ? state.operationGraphics : [];
  const selectedId = String(state.operationGraphicsEditor?.selectedId || "");
  const rendered = graphics
    .map((graphic) => {
      const geometryPreset = getOperationGraphicPreset(graphic.kind);
      const stylePreset = getOperationGraphicPreset(graphic.stylePreset || graphic.kind);
      const projectedPoints = projectStrategicPoints(graphic.points);
      const path = createOperationGraphicPath(graphic.points, {
        closed: geometryPreset.closed,
        curved: geometryPreset.curved,
      });
      if (!path) return null;
      return {
        graphic,
        geometryPreset,
        stylePreset,
        path,
        projectedPoints,
        labelAnchor: getOperationGraphicLabelAnchor(projectedPoints, { closed: geometryPreset.closed }),
      };
    })
    .filter(Boolean);

  const groups = operationGraphicsGroup
    .selectAll("g.operation-graphic")
    .data(rendered, (d) => d.graphic.id);

  const groupEnter = groups.enter().append("g").attr("class", "operation-graphic");
  groupEnter.append("path").attr("class", "operation-graphic-casing");
  groupEnter.append("path").attr("class", "operation-graphic-path");
  groupEnter.append("path").attr("class", "operation-graphic-hit");
  const labelEnter = groupEnter.append("g").attr("class", "operation-graphic-label");
  labelEnter.append("rect");
  labelEnter.append("text");

  const merged = groupEnter.merge(groups);
  merged.select("path.operation-graphic-casing")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", (d) => (d.graphic.id === selectedId ? "rgba(248, 244, 233, 0.92)" : "rgba(17, 24, 39, 0.45)"))
    .attr("stroke-width", (d) => {
      const baseWidth = d.graphic.width > 0 ? d.graphic.width : d.stylePreset.width;
      return baseWidth + (d.graphic.id === selectedId ? 1.8 : 1.2);
    })
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.stylePreset.dasharray || null)
    .attr("opacity", (d) => (d.graphic.id === selectedId ? 0.95 : 0.68))
    .attr("marker-end", null);

  merged.select("path.operation-graphic-path")
    .attr("d", (d) => d.path)
    .attr("fill", (d) => (d.geometryPreset.closed ? "rgba(15, 23, 42, 0.04)" : "none"))
    .attr("stroke", (d) => d.graphic.stroke || d.stylePreset.stroke)
    .attr("stroke-width", (d) => {
      const baseWidth = d.graphic.width > 0 ? d.graphic.width : d.stylePreset.width;
      return d.graphic.id === selectedId ? baseWidth + 0.4 : baseWidth;
    })
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.stylePreset.dasharray || null)
    .attr("opacity", (d) => Number.isFinite(Number(d.graphic.opacity)) ? Number(d.graphic.opacity) : d.stylePreset.opacity)
    .attr("marker-end", (d) => d.stylePreset.markerEnd || null);

  merged.select("path.operation-graphic-hit")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", "transparent")
    .attr("stroke-width", (d) => Math.max(10, (d.graphic.width > 0 ? d.graphic.width : d.stylePreset.width) + 7))
    .attr("pointer-events", "stroke");

  merged.select("g.operation-graphic-label")
    .attr("display", (d) => (d.graphic.label && Array.isArray(d.labelAnchor) ? null : "none"))
    .attr("transform", (d) => `translate(${d.labelAnchor?.[0] ?? -9999},${d.labelAnchor?.[1] ?? -9999})`);

  merged.select("g.operation-graphic-label text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", strategicLineLabelFont)
    .attr("font-size", 9)
    .attr("font-weight", 600)
    .attr("letter-spacing", "0.04em")
    .attr("fill", "#1f2937")
    .text((d) => d.graphic.label || "");

  merged.select("g.operation-graphic-label rect")
    .each(function eachLabelPlate() {
      const textNode = globalThis.d3.select(this.parentNode).select("text").node();
      const bbox = textNode?.getBBox?.();
      const width = bbox ? bbox.width + 10 : 48;
      const height = bbox ? bbox.height + 6 : 16;
      globalThis.d3.select(this)
        .attr("x", -width / 2)
        .attr("y", -height / 2)
        .attr("width", width)
        .attr("height", height)
        .attr("rx", 2)
        .attr("ry", 2)
        .attr("fill", "rgba(248, 244, 233, 0.92)")
        .attr("stroke", "rgba(55, 65, 81, 0.55)")
        .attr("stroke-width", 0.8);
    });

  merged.on("click", (event, datum) => {
    event.stopPropagation();
    selectOperationGraphicById(datum.graphic.id);
  });

  groups.exit().remove();
  operationGraphicsGroup.attr("aria-hidden", rendered.length ? "false" : "true");
  renderOperationGraphicsEditorOverlay();
}

function syncUnitCounterScalesDuringZoom() {
  const unitCountersGroup = groupGetters.getUnitCountersGroup?.() || null;
  if (!unitCountersGroup) return;
  const rootNode = typeof unitCountersGroup.node === "function" ? unitCountersGroup.node() : null;
  if (!rootNode?.children?.length) return;
  const zoomK = Math.max(0.1, Number(state.zoomTransform?.k || 1));
  unitCountersGroup.selectAll("g.unit-counter").each(function (d) {
    if (!d || !d.model) return;
    const previousScaleModel = d.scaleModel && typeof d.scaleModel === "object" ? d.scaleModel : null;
    const sc = getUnitCounterRenderScale(d.model.metrics, zoomK);
    d.scaleModel = sc;
    const node = this;
    const wasHidden = !!previousScaleModel?.hidden;
    if (sc.hidden) {
      if (!wasHidden || node.getAttribute("display") !== "none") {
        node.setAttribute("display", "none");
      }
      return;
    }
    if (wasHidden || node.getAttribute("display") === "none") {
      node.setAttribute("display", "");
    }
    const localScaleChanged =
      !previousScaleModel
      || Number(previousScaleModel.localScale || 1) !== Number(sc.localScale || 1);
    if (localScaleChanged || wasHidden) {
      node.setAttribute("transform", getUnitCounterNodeTransform(d));
    }
    const nextOpacity = String(sc.opacity);
    if (
      !previousScaleModel
      || wasHidden
      || String(previousScaleModel.opacity) !== nextOpacity
      || node.getAttribute("opacity") !== nextOpacity
    ) {
      node.setAttribute("opacity", nextOpacity);
    }
  });
}

function renderUnitCountersOverlay() {
  const unitCountersGroup = groupGetters.getUnitCountersGroup?.() || null;
  if (!unitCountersGroup) return;
  ensureUnitCounterEditorState();
  const selectedId = String(state.unitCounterEditor?.selectedId || "");
  const zoomK = Math.max(0.1, Number(state.zoomTransform?.k || 1));
  const entries = getUnitCounterRenderEntries()
    .map(({ counter, stackCount, slotIndex, anchor }) => {
      const projected = getProjectedPoint(anchor?.coord);
      if (!projected) return null;
      const model = getUnitCounterCardModel(counter, { stackCount });
      const scaleModel = getUnitCounterRenderScale(model.metrics, zoomK);
      if (scaleModel.hidden) return null;
      const slotOffset = getUnitCounterSlotOffset(slotIndex, stackCount, model.metrics);
      return {
        counter,
        projected,
        stackCount,
        slotIndex,
        slotOffset,
        model,
        scaleModel,
      };
    })
    .filter(Boolean)
    .sort((a, b) => compareUnitCounterRenderOrder(a.counter, b.counter));

  const groups = unitCountersGroup
    .selectAll("g.unit-counter")
    .data(entries, (d) => d.counter.id);

  const groupEnter = groups.enter().append("g").attr("class", "unit-counter").style("cursor", "grab");
  groupEnter.append("rect").attr("class", "unit-counter-stack-shadow is-back-2");
  groupEnter.append("rect").attr("class", "unit-counter-stack-shell is-back-2");
  groupEnter.append("rect").attr("class", "unit-counter-stack-strip is-back-2");
  groupEnter.append("rect").attr("class", "unit-counter-stack-shadow is-back-1");
  groupEnter.append("rect").attr("class", "unit-counter-stack-shell is-back-1");
  groupEnter.append("rect").attr("class", "unit-counter-stack-strip is-back-1");
  groupEnter.append("rect").attr("class", "unit-counter-shadow");
  groupEnter.append("rect").attr("class", "unit-counter-shell");
  groupEnter.append("rect").attr("class", "unit-counter-strip");
  groupEnter.append("rect").attr("class", "unit-counter-tag-pill");
  groupEnter.append("text").attr("class", "unit-counter-tag-text");
  groupEnter.append("rect").attr("class", "unit-counter-type-chip");
  groupEnter.append("text").attr("class", "unit-counter-type-text");
  groupEnter.append("image").attr("class", "unit-counter-milsymbol");
  groupEnter.append("path").attr("class", "unit-counter-icon");
  groupEnter.append("text").attr("class", "unit-counter-symbol");
  groupEnter.append("rect").attr("class", "unit-counter-org-track");
  groupEnter.append("rect").attr("class", "unit-counter-org-fill");
  groupEnter.append("rect").attr("class", "unit-counter-equip-track");
  groupEnter.append("rect").attr("class", "unit-counter-equip-fill");
  groupEnter.append("text").attr("class", "unit-counter-echelons");
  groupEnter.append("text").attr("class", "unit-counter-label");
  groupEnter.append("text").attr("class", "unit-counter-sublabel");
  groupEnter.append("circle").attr("class", "unit-counter-stack-badge");
  groupEnter.append("text").attr("class", "unit-counter-stack-text");

  const merged = groupEnter.merge(groups)
    .attr("transform", (d) => getUnitCounterNodeTransform(d))
    .attr("data-counter-id", (d) => d.counter.id)
    .attr("display", "")
    .attr("opacity", (d) => d.scaleModel.opacity)
    .attr("pointer-events", "all");

  const applyStackPlate = (selection, {
    plateIndex = 0,
    shadowClass = "rect.unit-counter-stack-shadow",
    shellClass = "rect.unit-counter-stack-shell",
    stripClass = "rect.unit-counter-stack-strip",
  } = {}) => {
    const offsetX = plateIndex === 1 ? -1.8 : -3.4;
    const offsetY = plateIndex === 1 ? -1.6 : -3.1;
    selection.select(shadowClass)
      .attr("display", "none")
      .attr("x", (d) => -d.model.metrics.width / 2 + offsetX)
      .attr("y", (d) => -d.model.metrics.height / 2 + offsetY)
      .attr("width", (d) => d.model.metrics.width)
      .attr("height", (d) => d.model.metrics.height)
      .attr("rx", 2)
      .attr("ry", 2)
      .attr("fill", "rgba(15, 23, 42, 0.18)")
      .attr("opacity", 0.38);

    selection.select(shellClass)
      .attr("display", "none")
      .attr("x", (d) => -d.model.metrics.width / 2 + offsetX)
      .attr("y", (d) => -d.model.metrics.height / 2 + offsetY)
      .attr("width", (d) => d.model.metrics.width)
      .attr("height", (d) => d.model.metrics.height)
      .attr("rx", 2)
      .attr("ry", 2)
      .attr("fill", defaultUnitCounterBaseFill)
      .attr("stroke", "rgba(31, 41, 55, 0.46)")
      .attr("stroke-width", 0.75);

    selection.select(stripClass)
      .attr("display", "none")
      .attr("x", (d) => -d.model.metrics.width / 2 + offsetX)
      .attr("y", (d) => -d.model.metrics.height / 2 + offsetY)
      .attr("width", (d) => Math.max(1.6, d.model.metrics.width * 0.12))
      .attr("height", (d) => d.model.metrics.height)
      .attr("fill", (d) => d.model.nation.color);
  };

  applyStackPlate(merged, {
    plateIndex: 1,
    shadowClass: "rect.unit-counter-stack-shadow.is-back-2",
    shellClass: "rect.unit-counter-stack-shell.is-back-2",
    stripClass: "rect.unit-counter-stack-strip.is-back-2",
  });
  applyStackPlate(merged, {
    plateIndex: 0,
    shadowClass: "rect.unit-counter-stack-shadow.is-back-1",
    shellClass: "rect.unit-counter-stack-shell.is-back-1",
    stripClass: "rect.unit-counter-stack-strip.is-back-1",
  });

  merged.select("rect.unit-counter-shadow")
    .attr("x", (d) => -d.model.metrics.width / 2)
    .attr("y", (d) => -d.model.metrics.height / 2)
    .attr("width", (d) => d.model.metrics.width)
    .attr("height", (d) => d.model.metrics.height)
    .attr("rx", 2)
    .attr("ry", 2)
    .attr("fill", "rgba(15, 23, 42, 0.22)")
    .attr("opacity", 0.44)
    .attr("transform", "translate(0.9, 0.9)");

  merged.select("rect.unit-counter-shell")
    .attr("x", (d) => -d.model.metrics.width / 2)
    .attr("y", (d) => -d.model.metrics.height / 2)
    .attr("width", (d) => d.model.metrics.width)
    .attr("height", (d) => d.model.metrics.height)
    .attr("rx", 2)
    .attr("ry", 2)
    .attr("fill", (d) => d.model.baseFillColor || defaultUnitCounterBaseFill)
    .attr("stroke", (d) => (d.counter.id === selectedId ? "#f5ecd7" : "rgba(31, 41, 55, 0.82)"))
    .attr("stroke-width", (d) => (d.counter.id === selectedId ? 1.3 : 0.9));

  merged.select("rect.unit-counter-strip")
    .attr("x", (d) => -d.model.metrics.width / 2)
    .attr("y", (d) => -d.model.metrics.height / 2)
    .attr("width", (d) => Math.max(1.6, d.model.metrics.width * 0.12))
    .attr("height", (d) => d.model.metrics.height)
    .attr("rx", 0)
    .attr("ry", 0)
    .attr("fill", (d) => d.model.nation.color);

  merged.select("rect.unit-counter-tag-pill")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.2, d.model.metrics.width * 0.14))
    .attr("y", (d) => -d.model.metrics.height / 2 + 2)
    .attr("width", (d) => Math.max(9, d.model.metrics.width * 0.32))
    .attr("height", 4.6)
    .attr("rx", 0.8)
    .attr("ry", 0.8)
    .attr("fill", (d) => d.model.nation.color);

  merged.select("text.unit-counter-tag-text")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.2, d.model.metrics.width * 0.14) + Math.max(9, d.model.metrics.width * 0.32) / 2)
    .attr("y", (d) => -d.model.metrics.height / 2 + 4.3)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", strategicLineLabelFont)
    .attr("font-size", 3.2)
    .attr("font-weight", 700)
    .attr("letter-spacing", "0.03em")
    .attr("fill", "#f8fafc")
    .text((d) => d.model.nation.tag || "AUTO");

  merged.select("rect.unit-counter-type-chip")
    .attr("x", (d) => d.model.metrics.width / 2 - Math.max(10, d.model.metrics.width * 0.36) - 2)
    .attr("y", (d) => -d.model.metrics.height / 2 + 2)
    .attr("width", (d) => Math.max(10, d.model.metrics.width * 0.36))
    .attr("height", 4.6)
    .attr("rx", 0.8)
    .attr("ry", 0.8)
    .attr("fill", "rgba(226, 221, 208, 0.96)");

  merged.select("text.unit-counter-type-text")
    .attr("x", (d) => d.model.metrics.width / 2 - 2 - Math.max(10, d.model.metrics.width * 0.36) / 2)
    .attr("y", (d) => -d.model.metrics.height / 2 + 4.3)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", strategicLineLabelFont)
    .attr("font-size", 3.2)
    .attr("font-weight", 700)
    .attr("letter-spacing", "0.03em")
    .attr("fill", "#111827")
    .text((d) => d.model.shortCode.slice(0, 3));

  merged.select("image.unit-counter-milsymbol")
    .attr("display", (d) => (d.model.renderer === "milstd" ? null : "none"))
    .attr("x", (d) => -(d.model.metrics.symbolBox / 2))
    .attr("y", (d) => -d.model.metrics.symbolBox / 2 + 1)
    .attr("width", (d) => d.model.metrics.symbolBox)
    .attr("height", (d) => d.model.metrics.symbolBox)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("href", (d) => d.model.symbolUri);

  merged.select("path.unit-counter-icon")
    .attr("display", (d) => (d.model.renderer === "game" ? null : "none"))
    .attr("d", (d) => getUnitCounterIconPath(d.model.iconId))
    .attr("transform", "translate(0, 1) scale(1)")
    .attr("fill", "none")
    .attr("stroke", "#0f172a")
    .attr("stroke-width", 0.95)
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round");

  merged.select("text.unit-counter-symbol")
    .attr("display", (d) => {
      if (d.model.renderer === "milstd") {
        return d.model.symbolUri ? "none" : null;
      }
      return "none";
    })
    .attr("x", 0)
    .attr("y", 1)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", "\"Roboto Condensed\", \"Segoe UI\", sans-serif")
    .attr("font-size", (d) => (d.model.renderer === "milstd" ? 5.6 : 6.6))
    .attr("font-weight", 700)
    .attr("fill", "#0f172a")
    .text((d) => d.model.shortCode.slice(0, 3));

  merged.select("rect.unit-counter-org-track")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.8, d.model.metrics.width * 0.15))
    .attr("y", (d) => d.model.metrics.height / 2 - 7.2)
    .attr("width", (d) => d.model.metrics.width * 0.64)
    .attr("height", 1.5)
    .attr("rx", 0.75)
    .attr("ry", 0.75)
    .attr("fill", "rgba(255, 255, 255, 0.64)")
    .attr("stroke", "rgba(15, 23, 42, 0.08)")
    .attr("stroke-width", 0.22);

  merged.select("rect.unit-counter-org-fill")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.8, d.model.metrics.width * 0.15))
    .attr("y", (d) => d.model.metrics.height / 2 - 7.2)
    .attr("width", (d) => (d.model.metrics.width * 0.64) * (d.model.organizationPct / 100))
    .attr("height", 1.5)
    .attr("rx", 0.75)
    .attr("ry", 0.75)
    .attr("fill", "rgba(34, 197, 94, 0.94)");

  merged.select("rect.unit-counter-equip-track")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.8, d.model.metrics.width * 0.15))
    .attr("y", (d) => d.model.metrics.height / 2 - 4.8)
    .attr("width", (d) => d.model.metrics.width * 0.64)
    .attr("height", 1.5)
    .attr("rx", 0.75)
    .attr("ry", 0.75)
    .attr("fill", "rgba(255, 255, 255, 0.64)")
    .attr("stroke", "rgba(15, 23, 42, 0.08)")
    .attr("stroke-width", 0.22);

  merged.select("rect.unit-counter-equip-fill")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.8, d.model.metrics.width * 0.15))
    .attr("y", (d) => d.model.metrics.height / 2 - 4.8)
    .attr("width", (d) => (d.model.metrics.width * 0.64) * (d.model.equipmentPct / 100))
    .attr("height", 1.5)
    .attr("rx", 0.75)
    .attr("ry", 0.75)
    .attr("fill", "rgba(234, 179, 8, 0.96)");

  merged.select("text.unit-counter-echelons")
    .attr("display", (d) => (d.model.echelonLabel ? null : "none"))
    .attr("x", 0)
    .attr("y", (d) => d.model.metrics.height / 2 - 1.8)
    .attr("text-anchor", "middle")
    .attr("font-family", strategicLineLabelFont)
    .attr("font-size", 3.3)
    .attr("font-weight", 700)
    .attr("letter-spacing", "0.04em")
    .attr("fill", "rgba(17, 24, 39, 0.78)")
    .text((d) => d.model.echelonLabel.slice(0, 3).toUpperCase());

  merged.select("text.unit-counter-label")
    .attr("display", (d) => (
      state.annotationView?.showUnitLabels !== false
      && d.counter.label
      && (d.counter.id === selectedId || zoomK >= 7)
        ? null
        : "none"
    ))
    .attr("x", 0)
    .attr("y", (d) => d.model.metrics.height / 2 + 4.5)
    .attr("text-anchor", "middle")
    .attr("font-family", strategicLineLabelFont)
    .attr("dominant-baseline", "hanging")
    .attr("font-size", 4.2)
    .attr("font-weight", 600)
    .attr("letter-spacing", "0.03em")
    .attr("fill", "#f6f1e6")
    .attr("stroke", "rgba(17, 24, 39, 0.88)")
    .attr("stroke-width", 0.45)
    .attr("paint-order", "stroke")
    .text((d) => d.counter.label || "");

  merged.select("text.unit-counter-sublabel")
    .attr("display", (d) => (
      state.annotationView?.showUnitLabels !== false
      && d.counter.subLabel
      && (d.counter.id === selectedId || zoomK >= 10)
        ? null
        : "none"
    ))
    .attr("x", 0)
    .attr("y", (d) => d.model.metrics.height / 2 + 9.5)
    .attr("text-anchor", "middle")
    .attr("font-family", strategicLineLabelFont)
    .attr("dominant-baseline", "hanging")
    .attr("font-size", 3.5)
    .attr("font-weight", 500)
    .attr("fill", "rgba(243, 239, 231, 0.92)")
    .attr("stroke", "rgba(17, 24, 39, 0.78)")
    .attr("stroke-width", 0.35)
    .attr("paint-order", "stroke")
    .text((d) => d.counter.subLabel || "");

  merged.select("circle.unit-counter-stack-badge")
    .attr("display", "none")
    .attr("cx", (d) => d.model.metrics.width / 2 - 1.5)
    .attr("cy", (d) => -d.model.metrics.height / 2 + 1.5)
    .attr("r", 3.5)
    .attr("fill", "#0f172a")
    .attr("stroke", "#f8fafc")
    .attr("stroke-width", 0.6);

  merged.select("text.unit-counter-stack-text")
    .attr("display", "none")
    .attr("x", (d) => d.model.metrics.width / 2 - 1.5)
    .attr("y", (d) => -d.model.metrics.height / 2 + 1.5)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", strategicLineLabelFont)
    .attr("font-size", 3.1)
    .attr("font-weight", 700)
    .attr("fill", "#f8fafc")
    .text("");

  groups.exit().remove();
  unitCountersGroup.attr("aria-hidden", entries.length ? "false" : "true");
}

function renderSpecialZones() {
  const specialZonesGroup = groupGetters.getSpecialZonesGroup?.() || null;
  const specialZoneEditorGroup = groupGetters.getSpecialZoneEditorGroup?.() || null;
  if (!specialZonesGroup || !specialZoneEditorGroup) return;
  const isDrawing = !!state.specialZoneEditor?.active;
  if (!state.showSpecialZones && !isDrawing) {
    specialZonesGroup.attr("display", "none");
    specialZoneEditorGroup.attr("display", "none");
    specialZonesGroup.attr("aria-hidden", "true");
    specialZoneEditorGroup.attr("aria-hidden", "true");
    return;
  }
  updateSpecialZonesPaths();
  renderSpecialZoneEditorOverlay();
  const visibleSpecialZones = state.showSpecialZones && getEffectiveSpecialZonesFeatureCollection().features.length > 0;
  specialZonesGroup
    .attr("display", state.showSpecialZones ? null : "none")
    .attr("aria-hidden", visibleSpecialZones ? "false" : "true");
  specialZoneEditorGroup
    .attr("display", null)
    .attr("aria-hidden", isDrawing ? "false" : "true");
}

  return {
    renderOperationalLinesOverlay,
    renderOperationGraphicsOverlay,
    syncUnitCounterScalesDuringZoom,
    renderUnitCountersOverlay,
    renderSpecialZones,
  };
}
