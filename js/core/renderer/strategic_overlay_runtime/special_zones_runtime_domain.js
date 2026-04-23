// Special zone editor runtime mutations.
export function createSpecialZonesRuntimeDomain({
  state,
  defaultSpecialZoneType,
  ensureManualSpecialZoneCounter,
  ensureSpecialZoneEditorState,
  getMapLonLatFromEvent,
  getManualSpecialZoneFeatures,
  renderNow,
  renderSpecialZoneEditorOverlay,
  updateSpecialZoneEditorUI,
}) {
  function appendSpecialZoneVertexFromEvent(event) {
    ensureSpecialZoneEditorState();
    const coord = getMapLonLatFromEvent(event);
    if (!coord) return false;
    state.specialZoneEditor.vertices.push(coord);
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderSpecialZoneEditorOverlay();
    return true;
  }

  function startSpecialZoneDraw({ zoneType = defaultSpecialZoneType, label = "" } = {}) {
    ensureSpecialZoneEditorState();
    state.specialZoneEditor.active = true;
    state.specialZoneEditor.vertices = [];
    state.specialZoneEditor.zoneType = String(zoneType || defaultSpecialZoneType);
    state.specialZoneEditor.label = String(label || "");
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
  }

  function undoSpecialZoneVertex() {
    ensureSpecialZoneEditorState();
    if (!state.specialZoneEditor.active || !state.specialZoneEditor.vertices.length) return;
    state.specialZoneEditor.vertices.pop();
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
  }

  function cancelSpecialZoneDraw() {
    ensureSpecialZoneEditorState();
    state.specialZoneEditor.active = false;
    state.specialZoneEditor.vertices = [];
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
  }

  function finishSpecialZoneDraw() {
    ensureSpecialZoneEditorState();
    const vertices = state.specialZoneEditor.vertices || [];
    if (!state.specialZoneEditor.active || vertices.length < 3) {
      cancelSpecialZoneDraw();
      return false;
    }

    ensureManualSpecialZoneCounter();
    const id = `manual_sz_${state.specialZoneEditor.counter}`;
    const zoneType = String(state.specialZoneEditor.zoneType || defaultSpecialZoneType);
    const labelText = String(state.specialZoneEditor.label || `${zoneType} zone`).trim() || `${zoneType} zone`;
    state.manualSpecialZones.features.push({
      type: "Feature",
      properties: {
        __source: "manual",
        claimants: [],
        cntr_code: "",
        id,
        label: labelText,
        name: labelText,
        type: zoneType,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[...vertices, vertices[0]]],
      },
    });
    state.specialZoneEditor.counter += 1;
    state.specialZoneEditor.selectedId = id;
    state.specialZoneEditor.active = false;
    state.specialZoneEditor.vertices = [];
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
    return true;
  }

  function selectSpecialZoneById(id) {
    ensureSpecialZoneEditorState();
    state.specialZoneEditor.selectedId = String(id || "").trim() || null;
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
  }

  function deleteSelectedManualSpecialZone() {
    ensureSpecialZoneEditorState();
    const selectedId = String(state.specialZoneEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const before = getManualSpecialZoneFeatures().length;
    state.manualSpecialZones.features = getManualSpecialZoneFeatures().filter(
      (feature) => String(feature?.properties?.id || "").trim() !== selectedId
    );
    if (before === state.manualSpecialZones.features.length) return false;
    state.specialZoneEditor.selectedId = null;
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
    return true;
  }

  return {
    appendSpecialZoneVertexFromEvent,
    cancelSpecialZoneDraw,
    deleteSelectedManualSpecialZone,
    finishSpecialZoneDraw,
    selectSpecialZoneById,
    startSpecialZoneDraw,
    undoSpecialZoneVertex,
  };
}
