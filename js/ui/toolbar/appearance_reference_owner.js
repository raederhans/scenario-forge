import { normalizeReferenceImageState } from "../../core/state/ui_state.js";
import {
  patchReferenceImageState,
  setReferenceImageState,
  setReferenceImageUrlState,
} from "../../core/state/actions/appearance_reference_actions.js";

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function collectReferenceNodes(documentRef) {
  return {
    imageInput: documentRef.getElementById("referenceImageInput"),
    image: documentRef.getElementById("referenceImage"),
    opacity: documentRef.getElementById("referenceOpacity"),
    scale: documentRef.getElementById("referenceScale"),
    offsetX: documentRef.getElementById("referenceOffsetX"),
    offsetY: documentRef.getElementById("referenceOffsetY"),
    opacityValue: documentRef.getElementById("referenceOpacityValue"),
    scaleValue: documentRef.getElementById("referenceScaleValue"),
    offsetXValue: documentRef.getElementById("referenceOffsetXValue"),
    offsetYValue: documentRef.getElementById("referenceOffsetYValue"),
  };
}

export { normalizeReferenceImageState };

export function getReferenceStyleSignature(referenceState = {}) {
  const opacity = Number.isFinite(Number(referenceState.opacity)) ? Number(referenceState.opacity) : 0.6;
  const scale = Number.isFinite(Number(referenceState.scale)) ? Number(referenceState.scale) : 1;
  const offsetX = Number.isFinite(Number(referenceState.offsetX)) ? Number(referenceState.offsetX) : 0;
  const offsetY = Number.isFinite(Number(referenceState.offsetY)) ? Number(referenceState.offsetY) : 0;
  return `${opacity}|${scale}|${offsetX}|${offsetY}`;
}

export function createAppearanceReferenceOwner({
  runtimeState,
  clamp = clampNumber,
  markDirty = () => {},
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
} = {}) {
  const nodes = collectReferenceNodes(documentRef);

  const syncReferenceState = () => {
    return setReferenceImageState(runtimeState, runtimeState.referenceImageState, { clamp });
  };

  const applyReferenceStyles = ({ force = false } = {}) => {
    if (!nodes.image) return null;
    const referenceState = syncReferenceState();
    const signature = getReferenceStyleSignature(referenceState);
    if (!force && nodes.image.dataset.referenceStyleSignature === signature) {
      return signature;
    }
    nodes.image.style.opacity = String(referenceState.opacity);
    nodes.image.style.transform =
      `translate(${referenceState.offsetX}px, ${referenceState.offsetY}px) `
      + `scale(${referenceState.scale})`;
    nodes.image.dataset.referenceStyleSignature = signature;
    return signature;
  };

  const renderReferenceOverlayUi = () => {
    const referenceState = syncReferenceState();
    const opacityPercent = Math.round(referenceState.opacity * 100);
    if (nodes.opacity) nodes.opacity.value = String(opacityPercent);
    if (nodes.opacityValue) nodes.opacityValue.textContent = `${opacityPercent}%`;
    if (nodes.scale) nodes.scale.value = String(Number(referenceState.scale).toFixed(2));
    if (nodes.scaleValue) nodes.scaleValue.textContent = `${Number(referenceState.scale).toFixed(2)}x`;
    if (nodes.offsetX) nodes.offsetX.value = String(Math.round(referenceState.offsetX));
    if (nodes.offsetXValue) nodes.offsetXValue.textContent = `${Math.round(referenceState.offsetX)}px`;
    if (nodes.offsetY) nodes.offsetY.value = String(Math.round(referenceState.offsetY));
    if (nodes.offsetYValue) nodes.offsetYValue.textContent = `${Math.round(referenceState.offsetY)}px`;
    applyReferenceStyles();
  };

  const revokeReferenceUrl = () => {
    if (runtimeState.referenceImageUrl && typeof urlApi?.revokeObjectURL === "function") {
      urlApi.revokeObjectURL(runtimeState.referenceImageUrl);
    }
    setReferenceImageUrlState(runtimeState, null);
  };

  const clearReferenceImage = ({ markDirty: shouldMarkDirty = true } = {}) => {
    revokeReferenceUrl();
    if (nodes.imageInput) nodes.imageInput.value = "";
    if (nodes.image) {
      nodes.image.src = "";
      nodes.image.style.opacity = "0";
      nodes.image.dataset.referenceStyleSignature = "";
    }
    if (shouldMarkDirty) {
      markDirty("reference-image-clear");
    }
  };

  const readNumber = (element, fallback) => {
    const value = Number(element?.value);
    return Number.isFinite(value) ? value : fallback;
  };

  const bindReferenceInput = (element, mutate, updateLabel, reason) => {
    if (!element || element.dataset.bound === "true") return;
    mutate(element);
    updateLabel(element);
    element.addEventListener("input", (event) => {
      mutate(event.target);
      updateLabel(event.target);
      applyReferenceStyles();
      markDirty(reason);
    });
    element.dataset.bound = "true";
  };

  const bindEvents = () => {
    if (nodes.imageInput && nodes.imageInput.dataset.bound !== "true") {
      nodes.imageInput.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (!nodes.image) return;
        if (!file) {
          clearReferenceImage();
          return;
        }
        revokeReferenceUrl();
        setReferenceImageUrlState(runtimeState, typeof urlApi?.createObjectURL === "function"
          ? urlApi.createObjectURL(file)
          : "");
        nodes.image.src = runtimeState.referenceImageUrl;
        applyReferenceStyles({ force: true });
        markDirty("reference-image-file");
      });
      nodes.imageInput.dataset.bound = "true";
    }

    bindReferenceInput(
      nodes.opacity,
      (element) => {
        patchReferenceImageState(runtimeState, {
          opacity: clamp(readNumber(element, 60) / 100, 0, 1),
        }, { clamp });
      },
      (element) => {
        if (nodes.opacityValue) nodes.opacityValue.textContent = `${element.value}%`;
      },
      "reference-opacity",
    );
    bindReferenceInput(
      nodes.scale,
      (element) => {
        patchReferenceImageState(runtimeState, {
          scale: clamp(readNumber(element, 1), 0.2, 3),
        }, { clamp });
      },
      () => {
        if (nodes.scaleValue) nodes.scaleValue.textContent = `${syncReferenceState().scale.toFixed(2)}x`;
      },
      "reference-scale",
    );
    bindReferenceInput(
      nodes.offsetX,
      (element) => {
        patchReferenceImageState(runtimeState, {
          offsetX: clamp(readNumber(element, 0), -1000, 1000),
        }, { clamp });
      },
      () => {
        if (nodes.offsetXValue) nodes.offsetXValue.textContent = `${syncReferenceState().offsetX}px`;
      },
      "reference-offset-x",
    );
    bindReferenceInput(
      nodes.offsetY,
      (element) => {
        patchReferenceImageState(runtimeState, {
          offsetY: clamp(readNumber(element, 0), -1000, 1000),
        }, { clamp });
      },
      () => {
        if (nodes.offsetYValue) nodes.offsetYValue.textContent = `${syncReferenceState().offsetY}px`;
      },
      "reference-offset-y",
    );
  };

  return {
    applyReferenceStyles,
    bindEvents,
    clearReferenceImage,
    renderReferenceOverlayUi,
    syncReferenceState,
  };
}
