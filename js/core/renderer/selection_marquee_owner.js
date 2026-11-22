function spacedLassoPoints(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) >= 3;
}

export function createSelectionMarqueeOwner({
  state, surfaceHost, getScreenPoint, isPointPickActive, query, add, warnIndexUnavailable, suppressNextClick,
}) {
  let session = null;
  let frame = null;
  let preview = null;

  function down(event) {
    if (session || event.pointerType !== "mouse" || event.button !== 0 || !(event.ctrlKey || event.metaKey)
      || state.currentTool !== "select" || isPointPickActive(state) || state.intensityFieldTool?.active
      || state.specialZoneEditor?.active || state.operationalLineEditor?.active || state.operationGraphicsEditor?.active
      || state.unitCounterEditor?.active || state.mapLabelEditor?.active) return false;
    event.preventDefault();
    const node = surfaceHost.getInteractionRect().node();
    node.setPointerCapture(event.pointerId);
    surfaceHost.getMapContainer().focus({ preventScroll: true });
    const start = getScreenPoint(event);
    session = { id: event.pointerId, node, type: event.shiftKey ? "lasso" : "rect", points: [start], dragging: false };
    return true;
  }

  function update(event) {
    const point = getScreenPoint(event);
    const { points, type } = session;
    const [x, y] = points[0];
    if (!session.dragging && Math.hypot(point[0] - x, point[1] - y) <= 4) return;
    session.dragging = true;
    if (type === "rect") {
      points[1] = point;
    } else {
      if (points.length === 2000) {
        const reduced = [points[0]];
        for (let i = 2; i < points.length; i += 2) {
          if (spacedLassoPoints(points[i], reduced.at(-1))) reduced.push(points[i]);
        }
        session.points = reduced;
      }
      if (spacedLassoPoints(point, session.points.at(-1))) session.points.push(point);
    }
  }

  function draw() {
    frame = null;
    const { points, type } = session;
    preview ??= surfaceHost.getSelectionMarqueeGroup().append("path")
      .attr("fill", "#2563eb").attr("fill-opacity", 0.14).attr("fill-rule", "evenodd")
      .attr("stroke", "#2563eb").attr("stroke-dasharray", "5 3");
    const [a, b] = points;
    preview.attr("d", type === "rect" ? `M${a}H${b[0]}V${b[1]}H${a[0]}Z` : `M${points.join("L")}Z`);
  }

  function move(event) {
    if (!session || session.id !== event.pointerId) return false;
    update(event);
    if (session.dragging && frame === null) frame = requestAnimationFrame(draw);
    return true;
  }

  function cancel(event) {
    if (!session || (event?.pointerId != null && event.pointerId !== session.id)) return false;
    const { id, node, dragging } = session;
    session = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    preview?.remove();
    preview = null;
    if (node.hasPointerCapture(id)) node.releasePointerCapture(id);
    if (dragging) suppressNextClick();
    return true;
  }

  function end(event) {
    if (!session || session.id !== event.pointerId) return false;
    if (event.type !== "pointerup") return cancel(event);
    update(event);
    const { points, type, dragging } = session;
    cancel(event);
    if (dragging) {
      const { x, y, k } = state.zoomTransform;
      const ids = query({ type, points: points.map(([sx, sy]) => [(sx - x) / k, (sy - y) / k]) });
      if (ids === null) warnIndexUnavailable();
      else add(ids);
    }
    return true;
  }

  function blocksZoom(event) {
    if (!session) return false;
    if (event.type === "wheel") event.preventDefault();
    return true;
  }

  return { down, move, end, cancel, blocksZoom };
}
