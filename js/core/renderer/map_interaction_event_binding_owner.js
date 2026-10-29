export function createMapInteractionEventBindingOwner({
  getters = {},
  handlers = {},
  effects = {},
} = {}) {
  const activeTouchPointers = new Set();
  let touchNavigation = false;

  function isTouchPointer(event) {
    return event.pointerType === "touch" || event.pointerType === "pen";
  }

  function shouldAllowTouchNavigation() {
    return !getters.isTouchBrushEnabled() || touchNavigation || activeTouchPointers.size > 1;
  }

  function handlePointerDown(event) {
    if (!isTouchPointer(event)) return handlers.handlePhysicalIntensityPointerDown(event);
    activeTouchPointers.add(event.pointerId);
    if (activeTouchPointers.size > 1) {
      touchNavigation = true;
      handlers.cancelBrushSession();
      handlers.cancelPhysicalIntensitySession();
    }
    if (shouldAllowTouchNavigation() || !event.isPrimary) return;
    handlers.handleBrushPointerDown(event);
  }

  function handlePointerMove(event) {
    if (!isTouchPointer(event)) return handlers.handlePhysicalIntensityPointerMove(event);
  }

  function handleWindowPointerMove(event) {
    if (!isTouchPointer(event) || !activeTouchPointers.has(event.pointerId) || shouldAllowTouchNavigation()) return;
    handlers.handleBrushPointerMove(event);
  }

  function handlePointerEnd(event) {
    if (!isTouchPointer(event)) return handlers.handlePhysicalIntensityPointerEnd(event);
    if (!activeTouchPointers.has(event.pointerId)) return;
    handlers.handleBrushPointerEnd(event);
    handlers.handlePhysicalIntensityPointerEnd(event);
    activeTouchPointers.delete(event.pointerId);
    if (!activeTouchPointers.size) touchNavigation = false;
  }

  function getInteractionRect() {
    return typeof getters.getInteractionRect === "function" ? getters.getInteractionRect() : null;
  }

  function getWindow() {
    return typeof getters.getWindow === "function" ? getters.getWindow() : null;
  }

  function getInteractionRectNode(interactionRect) {
    if (typeof getters.getInteractionRectNode === "function") {
      return getters.getInteractionRectNode();
    }
    return typeof interactionRect?.node === "function" ? interactionRect.node() : null;
  }

  function requireFunction(source, name) {
    const fn = source[name];
    if (typeof fn !== "function") {
      throw new Error(`Map interaction event binding owner requires ${name}.`);
    }
    return fn;
  }

  function bindWindowMouseUp() {
    if (activeTouchPointers.size) return;
    requireFunction(handlers, "flushSpecialZoneMembershipDragSession")();
    requireFunction(handlers, "flushBrushSession")();
  }

  function bindSidebarLayoutRefresh() {
    requireFunction(handlers, "handleResize")("sidebar-layout-refresh");
  }

  function bindEvents() {
    const interactionRect = getInteractionRect();
    if (!interactionRect) return false;
    if (typeof interactionRect.on !== "function") {
      throw new Error("Map interaction event binding owner requires interactionRect.on.");
    }

    const targetWindow = getWindow();
    if (typeof targetWindow?.addEventListener !== "function") {
      throw new Error("Map interaction event binding owner requires window.addEventListener.");
    }

    interactionRect.on("mousemove", requireFunction(handlers, "handleMouseMove"));
    interactionRect.on("pointerdown.fieldTool", handlePointerDown);
    interactionRect.on("pointermove.fieldTool", handlePointerMove);
    interactionRect.on("mousedown.brush", requireFunction(handlers, "handleBrushPointerDown"));
    interactionRect.on("mousemove.brush", requireFunction(handlers, "handleBrushPointerMove"));
    interactionRect.on("mouseleave", requireFunction(handlers, "handleMouseLeave"));
    interactionRect.on("click", requireFunction(handlers, "mapClick"));
    interactionRect.on("dblclick", requireFunction(handlers, "mapDoubleClick"));

    targetWindow.addEventListener("mouseup", bindWindowMouseUp);
    targetWindow.addEventListener("pointermove", handleWindowPointerMove);
    targetWindow.addEventListener("pointerup", handlePointerEnd);
    targetWindow.addEventListener("pointercancel", handlePointerEnd);
    getInteractionRectNode(interactionRect)?.addEventListener?.(
      "lostpointercapture",
      requireFunction(handlers, "handlePhysicalIntensityPointerEnd"),
    );
    targetWindow.addEventListener("resize", requireFunction(handlers, "handleResize"));
    targetWindow.addEventListener("mapcreator:sidebar-layout-start", requireFunction(handlers, "handleSidebarLayoutStart"));
    targetWindow.addEventListener("mapcreator:sidebar-layout-refresh", bindSidebarLayoutRefresh);
    effects.bindMapContainerResizeObserver?.();
    effects.bindBrowserZoomObservers?.();
    const node = getInteractionRectNode(interactionRect);
    if (node?.style) node.style.touchAction = "none";
    return true;
  }

  return Object.freeze({
    bindEvents,
    shouldAllowTouchNavigation,
  });
}
