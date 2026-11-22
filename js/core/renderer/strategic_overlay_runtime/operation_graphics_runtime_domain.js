import { normalizeOperationLabelSize } from "../operation_graphic_geometry.js";
// Operation graphic runtime mutations.
import {
  commitStrategicOverlayCollectionsState,
  patchStrategicOverlayEntityState,
  patchStrategicOverlayEditorState,
  setStrategicOverlayDirtyState,
} from "../../state/actions/strategic_overlay_actions.js";

export function createOperationGraphicsRuntimeDomain({
  state,
  defaultOperationGraphicKind,
  captureHistoryState,
  commitHistoryEntry,
  ensureOperationGraphicCounter,
  ensureOperationGraphicsEditorState,
  getMapLonLatFromEvent,
  getOperationGraphicById,
  getOperationGraphicMinPoints,
  markDirty,
  normalizeOperationGraphicOpacity,
  normalizeOperationGraphicStroke,
  normalizeOperationGraphicStylePreset,
  normalizeOperationGraphicWidth,
  renderNow,
  renderOperationGraphicsIfNeeded,
  showToast,
  t,
  updateStrategicOverlayUi,
}) {
  const vertexDragSession = {
    before: null,
    selectedId: "",
    vertexIndex: -1,
    moved: false,
  };

  function resetVertexDragSession() {
    vertexDragSession.before = null;
    vertexDragSession.selectedId = "";
    vertexDragSession.vertexIndex = -1;
    vertexDragSession.moved = false;
  }

  function getSelectedOperationGraphicForVertex(vertexIndex = -1) {
    ensureOperationGraphicsEditorState();
    const selectedId = String(state.operationGraphicsEditor.selectedId || "").trim();
    const graphic = getOperationGraphicById(selectedId);
    const normalizedIndex = Number(vertexIndex);
    if (!graphic || !Number.isInteger(normalizedIndex) || normalizedIndex < 0) return null;
    if (!Array.isArray(graphic.points) || !Array.isArray(graphic.points[normalizedIndex])) return null;
    return { graphic, normalizedIndex, selectedId };
  }

  function appendOperationGraphicVertexFromEvent(event) {
    ensureOperationGraphicsEditorState();
    const coord = getMapLonLatFromEvent(event);
    if (!coord) return false;
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { points: [...state.operationGraphicsEditor.points, coord] });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    updateStrategicOverlayUi();
    renderOperationGraphicsIfNeeded({ force: true });
    return true;
  }

  function startOperationGraphicDraw({
    kind = defaultOperationGraphicKind,
    label = "",
    labelSize = 9,
    labelOnPath = false,
    opacity = 1,
    stroke = "",
    stylePreset = defaultOperationGraphicKind,
    width = 0,
  } = {}) {
    ensureOperationGraphicsEditorState();
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", {
      active: true,
      mode: "draw",
      points: [],
      kind: String(kind || defaultOperationGraphicKind),
      label: String(label || ""),
      labelSize: normalizeOperationLabelSize(labelSize),
      labelOnPath: labelOnPath === true,
      stylePreset: normalizeOperationGraphicStylePreset(stylePreset, kind),
      stroke: normalizeOperationGraphicStroke(stroke),
      width: normalizeOperationGraphicWidth(width),
      opacity: normalizeOperationGraphicOpacity(opacity),
      selectedId: null,
      selectedVertexIndex: -1,
    });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    updateStrategicOverlayUi();
    renderNow();
  }

  function undoOperationGraphicVertex() {
    ensureOperationGraphicsEditorState();
    if (!state.operationGraphicsEditor.active || !state.operationGraphicsEditor.points.length) return;
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { points: Array.from(state.operationGraphicsEditor.points).slice(0, -1) });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    updateStrategicOverlayUi();
    renderNow();
  }

  function cancelOperationGraphicDraw() {
    ensureOperationGraphicsEditorState();
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", {
      active: false,
      mode: state.operationGraphicsEditor.selectedId ? "edit" : "idle",
      points: [],
      selectedVertexIndex: -1,
    });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    updateStrategicOverlayUi();
    renderNow();
  }

  function finishOperationGraphicDraw() {
    ensureOperationGraphicsEditorState();
    const kind = String(state.operationGraphicsEditor.kind || defaultOperationGraphicKind);
    const minPoints = getOperationGraphicMinPoints(kind);
    const points = Array.isArray(state.operationGraphicsEditor.points) ? Array.from(state.operationGraphicsEditor.points) : [];
    if (!state.operationGraphicsEditor.active || points.length < minPoints) {
      cancelOperationGraphicDraw();
      return false;
    }
    ensureOperationGraphicCounter();
    const before = captureHistoryState({ strategicOverlay: true });
    const id = `opg_${state.operationGraphicsEditor.counter}`;
    commitStrategicOverlayCollectionsState(state, {
      operationGraphics: [...Array.from(state.operationGraphics), {
        id,
        kind,
        label: String(state.operationGraphicsEditor.label || "").trim(),
        labelSize: normalizeOperationLabelSize(state.operationGraphicsEditor.labelSize),
        labelOnPath: state.operationGraphicsEditor.labelOnPath === true,
        points: [...points],
        stylePreset: normalizeOperationGraphicStylePreset(state.operationGraphicsEditor.stylePreset, kind),
        stroke: normalizeOperationGraphicStroke(state.operationGraphicsEditor.stroke) || null,
        width: normalizeOperationGraphicWidth(state.operationGraphicsEditor.width),
        opacity: normalizeOperationGraphicOpacity(state.operationGraphicsEditor.opacity),
      }],
    });
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", {
      counter: state.operationGraphicsEditor.counter + 1,
      selectedId: id,
      active: false,
      mode: "edit",
      points: [...points],
      selectedVertexIndex: -1,
    });
    commitHistoryEntry({
      kind: "finish-operation-graphic",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("finish-operation-graphic");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function selectOperationGraphicById(id) {
    ensureOperationGraphicsEditorState();
    const selectedId = String(id || "").trim();
    const graphic = getOperationGraphicById(selectedId);
    const editorPatch = { selectedId: selectedId || null, selectedVertexIndex: -1 };
    if (graphic) {
      Object.assign(editorPatch, {
        kind: String(graphic.kind || defaultOperationGraphicKind),
        label: String(graphic.label || ""),
        labelSize: normalizeOperationLabelSize(graphic.labelSize),
        labelOnPath: graphic.labelOnPath === true,
        stylePreset: normalizeOperationGraphicStylePreset(graphic.stylePreset, graphic.kind),
        stroke: normalizeOperationGraphicStroke(graphic.stroke),
        width: normalizeOperationGraphicWidth(graphic.width),
        opacity: normalizeOperationGraphicOpacity(graphic.opacity),
        points: Array.isArray(graphic.points) ? [...graphic.points] : [],
        mode: "edit",
      });
    } else {
      Object.assign(editorPatch, { points: [], mode: "idle" });
    }
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", editorPatch);
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    updateStrategicOverlayUi();
    renderNow();
  }

  function deleteSelectedOperationGraphic() {
    ensureOperationGraphicsEditorState();
    const selectedId = String(state.operationGraphicsEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    const nextGraphics = (state.operationGraphics || []).filter((entry) => String(entry?.id || "") !== selectedId);
    if (nextGraphics.length === (state.operationGraphics || []).length) return false;
    commitStrategicOverlayCollectionsState(state, { operationGraphics: nextGraphics });
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { selectedId: null, points: [], selectedVertexIndex: -1, mode: "idle" });
    commitHistoryEntry({
      kind: "delete-operation-graphic",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("delete-operation-graphic");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function updateSelectedOperationGraphic(partial = {}) {
    ensureOperationGraphicsEditorState();
    const selectedId = String(state.operationGraphicsEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const target = (state.operationGraphics || []).find((entry) => String(entry?.id || "") === selectedId);
    if (!target) return false;
    const nextKind = partial.kind ? String(partial.kind || defaultOperationGraphicKind) : String(target.kind || defaultOperationGraphicKind);
    if (partial.kind && Array.isArray(target.points) && target.points.length < getOperationGraphicMinPoints(nextKind)) {
      showToast(t("Add more vertices before switching this graphic to a closed style.", "ui"), {
        title: t("More points required", "ui"),
        tone: "warning",
      });
      return false;
    }
    const before = captureHistoryState({ strategicOverlay: true });
    const entityPatch = {};
    if (partial.kind) entityPatch.kind = nextKind;
    if (partial.label !== undefined) entityPatch.label = String(partial.label || "");
    if (partial.labelSize !== undefined) entityPatch.labelSize = normalizeOperationLabelSize(partial.labelSize);
    if (partial.labelOnPath !== undefined) entityPatch.labelOnPath = partial.labelOnPath === true;
    if (partial.stylePreset !== undefined) {
      entityPatch.stylePreset = normalizeOperationGraphicStylePreset(partial.stylePreset, nextKind);
    }
    if (partial.stroke !== undefined) entityPatch.stroke = normalizeOperationGraphicStroke(partial.stroke) || null;
    if (partial.width !== undefined) entityPatch.width = normalizeOperationGraphicWidth(partial.width);
    if (partial.opacity !== undefined) entityPatch.opacity = normalizeOperationGraphicOpacity(partial.opacity);
    patchStrategicOverlayEntityState(state, "operationGraphics", selectedId, entityPatch);
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", {
      points: Array.isArray(target.points) ? [...target.points] : [],
      labelSize: entityPatch.labelSize ?? normalizeOperationLabelSize(target.labelSize),
      labelOnPath: entityPatch.labelOnPath ?? (target.labelOnPath === true),
    });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    commitHistoryEntry({
      kind: "update-operation-graphic",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("update-operation-graphic");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function deleteSelectedOperationGraphicVertex() {
    ensureOperationGraphicsEditorState();
    const graphic = getOperationGraphicById(state.operationGraphicsEditor.selectedId);
    const vertexIndex = Number(state.operationGraphicsEditor.selectedVertexIndex);
    if (!graphic || !Number.isInteger(vertexIndex) || vertexIndex < 0) return false;
    const minPoints = getOperationGraphicMinPoints(graphic.kind);
    if (!Array.isArray(graphic.points) || graphic.points.length <= minPoints) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    const nextPoints = graphic.points.slice();
    nextPoints.splice(vertexIndex, 1);
    patchStrategicOverlayEntityState(state, "operationGraphics", String(graphic.id || ""), {
      points: nextPoints,
    });
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", {
      points: nextPoints,
      selectedVertexIndex: Math.min(vertexIndex, nextPoints.length - 1),
    });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    commitHistoryEntry({
      kind: "delete-operation-graphic-vertex",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("delete-operation-graphic-vertex");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function insertOperationGraphicVertex(insertIndex = -1, coord = null) {
    ensureOperationGraphicsEditorState();
    const selectedId = String(state.operationGraphicsEditor.selectedId || "").trim();
    const graphic = getOperationGraphicById(selectedId);
    const normalizedIndex = Number(insertIndex);
    if (!graphic || !Number.isInteger(normalizedIndex) || normalizedIndex < 0) return false;
    if (!Array.isArray(graphic.points) || normalizedIndex > graphic.points.length) return false;
    if (!Array.isArray(coord) || coord.length < 2) return false;
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    const nextPoints = graphic.points.slice();
    nextPoints.splice(normalizedIndex, 0, [lon, lat]);
    patchStrategicOverlayEntityState(state, "operationGraphics", selectedId, {
      points: nextPoints,
    });
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", {
      points: nextPoints,
      selectedVertexIndex: normalizedIndex,
    });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    commitHistoryEntry({
      kind: "insert-operation-graphic-vertex",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("insert-operation-graphic-vertex");
    updateStrategicOverlayUi();
    renderOperationGraphicsIfNeeded({ force: true });
    return true;
  }

  function beginOperationGraphicVertexDrag(vertexIndex = -1) {
    const target = getSelectedOperationGraphicForVertex(vertexIndex);
    if (!target) {
      resetVertexDragSession();
      return false;
    }
    vertexDragSession.before = captureHistoryState({ strategicOverlay: true });
    vertexDragSession.selectedId = target.selectedId;
    vertexDragSession.vertexIndex = target.normalizedIndex;
    vertexDragSession.moved = false;
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { selectedVertexIndex: target.normalizedIndex });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    updateStrategicOverlayUi();
    renderOperationGraphicsIfNeeded({ force: true });
    return true;
  }

  function moveOperationGraphicVertexDrag(vertexIndex = -1, coord = null) {
    const target = getSelectedOperationGraphicForVertex(vertexIndex);
    if (!target || !Array.isArray(coord) || coord.length < 2) return false;
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    if (
      vertexDragSession.selectedId !== target.selectedId
      || vertexDragSession.vertexIndex !== target.normalizedIndex
    ) {
      return false;
    }
    target.graphic.points[target.normalizedIndex] = [lon, lat];
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", {
      points: Array.isArray(target.graphic.points) ? target.graphic.points : [],
      selectedVertexIndex: target.normalizedIndex,
    });
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    vertexDragSession.moved = true;
    renderOperationGraphicsIfNeeded({ force: true });
    return true;
  }

  function finishOperationGraphicVertexDrag(vertexIndex = -1) {
    const target = getSelectedOperationGraphicForVertex(vertexIndex);
    const isActiveSession = !!target
      && vertexDragSession.selectedId === target.selectedId
      && vertexDragSession.vertexIndex === target.normalizedIndex;
    const moved = isActiveSession && vertexDragSession.moved;
    if (moved) {
      commitHistoryEntry({
        kind: "move-operation-graphic-vertex",
        before: vertexDragSession.before,
        after: captureHistoryState({ strategicOverlay: true }),
      });
      markDirty("move-operation-graphic-vertex");
      setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    }
    resetVertexDragSession();
    updateStrategicOverlayUi();
    renderOperationGraphicsIfNeeded({ force: true });
    return moved;
  }

  return {
    appendOperationGraphicVertexFromEvent,
    beginOperationGraphicVertexDrag,
    cancelOperationGraphicDraw,
    deleteSelectedOperationGraphic,
    deleteSelectedOperationGraphicVertex,
    finishOperationGraphicDraw,
    finishOperationGraphicVertexDrag,
    insertOperationGraphicVertex,
    moveOperationGraphicVertexDrag,
    selectOperationGraphicById,
    startOperationGraphicDraw,
    undoOperationGraphicVertex,
    updateSelectedOperationGraphic,
  };
}
