function isSurfaceVisible(element) {
  for (let node = element; node; node = node.parentElement) {
    if (node.hidden || node.inert || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
    const style = globalThis.getComputedStyle?.(node);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
    if (node.tagName === "DETAILS" && !node.open && node !== element) {
      const summary = Array.from(node.children).find((child) => child.tagName === "SUMMARY");
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

function getSurfaceLayer(element) {
  let layer = 0;
  for (let node = element; node; node = node.parentElement) {
    layer = Math.max(layer, Number.parseInt(globalThis.getComputedStyle?.(node)?.zIndex, 10) || 0);
  }
  return layer;
}

function getActiveModal(doc = document) {
  return Array.from(doc.querySelectorAll('[aria-modal="true"]'))
    .filter(isSurfaceVisible)
    .sort((a, b) => getSurfaceLayer(a) - getSurfaceLayer(b))
    .at(-1) || null;
}

function isUsableFocusTarget(element) {
  return element instanceof HTMLElement
    && element.ownerDocument.contains(element)
    && !element.disabled
    && isSurfaceVisible(element);
}

function restoreFocusOrigin(element, fallback = null) {
  const target = isUsableFocusTarget(element) ? element : (isUsableFocusTarget(fallback) ? fallback : null);
  target?.focus({ preventScroll: true });
  return target;
}

export { getActiveModal, isSurfaceVisible, restoreFocusOrigin };
