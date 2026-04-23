const facadeState = {
  getStrategicOverlayRuntimeOwner: null,
};

function readStrategicOverlayOwner() {
  const getter = facadeState.getStrategicOverlayRuntimeOwner;
  if (typeof getter !== 'function') {
    throw new Error('[facade_overlay_runtime] Missing getStrategicOverlayRuntimeOwner runtime getter.');
  }
  return getter();
}

export function configureOverlayRuntimeFacade(nextState = {}) {
  Object.assign(facadeState, nextState);
}

export function resolveUnitCounterNationForPlacement(featureId = '', manualTag = '', preferredSource = 'display') {
  return readStrategicOverlayOwner().resolveUnitCounterNationForPlacement(featureId, manualTag, preferredSource);
}

export function getUnitCounterPreviewData(partialCounter = {}) {
  return readStrategicOverlayOwner().getUnitCounterPreviewData(partialCounter);
}

export function appendSpecialZoneVertexFromEvent(event) {
  return readStrategicOverlayOwner().appendSpecialZoneVertexFromEvent(event);
}

export function startSpecialZoneDraw({ zoneType, label } = {}) {
  return readStrategicOverlayOwner().startSpecialZoneDraw({ zoneType, label });
}

export function undoSpecialZoneVertex() {
  return readStrategicOverlayOwner().undoSpecialZoneVertex();
}

export function cancelSpecialZoneDraw() {
  return readStrategicOverlayOwner().cancelSpecialZoneDraw();
}

export function finishSpecialZoneDraw() {
  return readStrategicOverlayOwner().finishSpecialZoneDraw();
}

export function selectSpecialZoneById(id) {
  return readStrategicOverlayOwner().selectSpecialZoneById(id);
}

export function deleteSelectedManualSpecialZone() {
  return readStrategicOverlayOwner().deleteSelectedManualSpecialZone();
}

export function appendOperationGraphicVertexFromEvent(event) {
  return readStrategicOverlayOwner().appendOperationGraphicVertexFromEvent(event);
}

export function startOperationGraphicDraw(params = {}) {
  return readStrategicOverlayOwner().startOperationGraphicDraw(params);
}

export function undoOperationGraphicVertex() {
  return readStrategicOverlayOwner().undoOperationGraphicVertex();
}

export function cancelOperationGraphicDraw() {
  return readStrategicOverlayOwner().cancelOperationGraphicDraw();
}

export function finishOperationGraphicDraw() {
  return readStrategicOverlayOwner().finishOperationGraphicDraw();
}

export function selectOperationGraphicById(id) {
  return readStrategicOverlayOwner().selectOperationGraphicById(id);
}

export function deleteSelectedOperationGraphic() {
  return readStrategicOverlayOwner().deleteSelectedOperationGraphic();
}

export function updateSelectedOperationGraphic(partial = {}) {
  return readStrategicOverlayOwner().updateSelectedOperationGraphic(partial);
}

export function deleteSelectedOperationGraphicVertex() {
  return readStrategicOverlayOwner().deleteSelectedOperationGraphicVertex();
}

export function appendOperationalLineVertexFromEvent(event) {
  return readStrategicOverlayOwner().appendOperationalLineVertexFromEvent(event);
}

export function startOperationalLineDraw(params = {}) {
  return readStrategicOverlayOwner().startOperationalLineDraw(params);
}

export function undoOperationalLineVertex() {
  return readStrategicOverlayOwner().undoOperationalLineVertex();
}

export function cancelOperationalLineDraw() {
  return readStrategicOverlayOwner().cancelOperationalLineDraw();
}

export function finishOperationalLineDraw() {
  return readStrategicOverlayOwner().finishOperationalLineDraw();
}

export function selectOperationalLineById(id) {
  return readStrategicOverlayOwner().selectOperationalLineById(id);
}

export function updateSelectedOperationalLine(partial = {}) {
  return readStrategicOverlayOwner().updateSelectedOperationalLine(partial);
}

export function deleteSelectedOperationalLine() {
  return readStrategicOverlayOwner().deleteSelectedOperationalLine();
}

export function syncOperationalLineAttachedCounterIds() {
  return readStrategicOverlayOwner().syncOperationalLineAttachedCounterIds();
}

export function placeUnitCounterFromEvent(event) {
  return readStrategicOverlayOwner().placeUnitCounterFromEvent(event);
}

export function startUnitCounterPlacement(params = {}) {
  return readStrategicOverlayOwner().startUnitCounterPlacement(params);
}

export function cancelUnitCounterPlacement() {
  return readStrategicOverlayOwner().cancelUnitCounterPlacement();
}

export function selectUnitCounterById(id) {
  return readStrategicOverlayOwner().selectUnitCounterById(id);
}

export function updateSelectedUnitCounter(partial = {}) {
  return readStrategicOverlayOwner().updateSelectedUnitCounter(partial);
}

export function deleteSelectedUnitCounter() {
  return readStrategicOverlayOwner().deleteSelectedUnitCounter();
}

export function cancelActiveStrategicInteractionModes() {
  return readStrategicOverlayOwner().cancelActiveStrategicInteractionModes();
}