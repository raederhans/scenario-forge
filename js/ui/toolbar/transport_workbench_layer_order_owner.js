// Transport workbench layer-order owner.
// Owns layer-order row models, drag/drop DOM wiring, and status copy for the Layers family panel.

const LIVE_LAYER_COPY = {
  caption: "Preview available",
  status: "Available",
};
const MANIFEST_LAYER_COPY = {
  caption: "Not available yet",
  status: "Not available yet",
};
const RESERVED_LAYER_COPY = {
  caption: "Not available yet",
  status: "Not available yet",
};

export function buildTransportWorkbenchLayerOrderRows({
  layerOrder = [],
  getLayerFamilyMeta = (familyId) => ({ id: familyId, label: familyId }),
  isLivePreviewFamily = () => false,
  isManifestOnlyRuntimeFamily = () => false,
} = {}) {
  return (Array.isArray(layerOrder) ? layerOrder : []).map((familyId) => {
    const family = getLayerFamilyMeta(familyId) || { id: familyId, label: familyId };
    const id = family.id || familyId;
    const copy = isLivePreviewFamily(id)
      ? LIVE_LAYER_COPY
      : isManifestOnlyRuntimeFamily(id)
        ? MANIFEST_LAYER_COPY
        : RESERVED_LAYER_COPY;
    return {
      id,
      label: family.label || id,
      caption: copy.caption,
      status: copy.status,
      live: isLivePreviewFamily(id),
    };
  });
}

export function createTransportWorkbenchLayerOrderOwner({
  panel = null,
  list = null,
  translate = (value) => value,
  ensureUiState = () => {},
  getLayerOrder = () => [],
  getLayerFamilyMeta = (familyId) => ({ id: familyId, label: familyId }),
  isLivePreviewFamily = () => false,
  isManifestOnlyRuntimeFamily = () => false,
  moveLayerOrder = () => false,
  markDirty = () => {},
  getRenderContext = () => null,
  renderInspector = () => {},
} = {}) {
  let draggedLayerId = "";

  const buildRows = () => buildTransportWorkbenchLayerOrderRows({
    layerOrder: getLayerOrder(),
    getLayerFamilyMeta,
    isLivePreviewFamily,
    isManifestOnlyRuntimeFamily,
  });

  const render = () => {
    if (!panel || !list) return;
    ensureUiState();
    list.replaceChildren();
    buildRows().forEach((row) => {
      const item = document.createElement("div");
      item.className = "transport-workbench-layer-order-item";
      item.draggable = true;
      item.dataset.layerFamily = row.id;

      item.addEventListener("dragstart", () => {
        draggedLayerId = row.id;
        item.classList.add("is-dragging");
      });
      item.addEventListener("dragend", () => {
        draggedLayerId = "";
        item.classList.remove("is-dragging");
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!moveLayerOrder(draggedLayerId, row.id)) return;
        markDirty("transport-workbench-layer-order");
        const context = getRenderContext();
        render();
        renderInspector(context.family, context.config, context.compareHeld);
      });

      const handle = document.createElement("span");
      handle.className = "transport-workbench-layer-order-handle";
      handle.textContent = ":::";

      const meta = document.createElement("div");
      meta.className = "transport-workbench-layer-order-meta";
      const name = document.createElement("div");
      name.className = "transport-workbench-layer-order-name";
      name.textContent = translate(row.label);
      const caption = document.createElement("div");
      caption.className = "transport-workbench-layer-order-caption";
      caption.textContent = translate(row.caption);
      meta.append(name, caption);

      const status = document.createElement("span");
      status.className = "transport-workbench-layer-order-state";
      status.textContent = translate(row.status);
      if (row.live) {
        status.classList.add("is-live");
      }

      item.append(handle, meta, status);
      list.appendChild(item);
    });
  };

  return {
    buildRows,
    render,
  };
}
