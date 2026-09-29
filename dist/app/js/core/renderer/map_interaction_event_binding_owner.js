export function createMapInteractionEventBindingOwner({
  getters = {},
  handlers = {},
  effects = {},
} = {}) {
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
    interactionRect.on("pointerdown.fieldTool", requireFunction(handlers, "handlePhysicalIntensityPointerDown"));
    interactionRect.on("pointermove.fieldTool", requireFunction(handlers, "handlePhysicalIntensityPointerMove"));
    interactionRect.on("mousedown.brush", requireFunction(handlers, "handleBrushPointerDown"));
    interactionRect.on("mousemove.brush", requireFunction(handlers, "handleBrushPointerMove"));
    interactionRect.on("mouseleave", requireFunction(handlers, "handleMouseLeave"));
    interactionRect.on("click", requireFunction(handlers, "mapClick"));
    interactionRect.on("dblclick", requireFunction(handlers, "mapDoubleClick"));

    targetWindow.addEventListener("mouseup", bindWindowMouseUp);
    targetWindow.addEventListener("pointerup", requireFunction(handlers, "handlePhysicalIntensityPointerEnd"));
    targetWindow.addEventListener("pointercancel", requireFunction(handlers, "handlePhysicalIntensityPointerEnd"));
    getInteractionRectNode(interactionRect)?.addEventListener?.(
      "lostpointercapture",
      requireFunction(handlers, "handlePhysicalIntensityPointerEnd"),
    );
    targetWindow.addEventListener("resize", requireFunction(handlers, "handleResize"));
    targetWindow.addEventListener("mapcreator:sidebar-layout-start", requireFunction(handlers, "handleSidebarLayoutStart"));
    targetWindow.addEventListener("mapcreator:sidebar-layout-refresh", bindSidebarLayoutRefresh);
    effects.bindMapContainerResizeObserver?.();
    effects.bindBrowserZoomObservers?.();
    return true;
  }

  return Object.freeze({
    bindEvents,
  });
}
