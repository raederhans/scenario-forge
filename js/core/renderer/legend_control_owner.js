export function createLegendControlOwner({
  getMapContainer,
  getViewportSize = () => ({ width: 1, height: 1 }),
  getLanguage,
  getLegendModel,
  getControlState,
  getControlLimits,
  updateControlState,
  toggleControlCollapsed,
  hideControl,
  clamp,
}) {
  let legendControlElement = null;
  let legendControlHeaderElement = null;
  let legendControlBodyElement = null;
  let legendOpacityPanelElement = null;
  let legendOpacityInputElement = null;
  let legendDragSession = null;
  let legendResizeSession = null;
  let lastLegendKey = null;
  let lastHeaderKey = null;

  function getLegendControlText(key, count = 0) {
    const zh = String(getLanguage() || "").toLowerCase().startsWith("zh");
    const catalog = zh
      ? {
        title: "图例",
        drag: "拖动图例",
        collapse: "收起图例",
        expand: "展开图例",
        close: "关闭图例",
        resizeWidth: "调整图例宽度",
        resizeHeight: "调整图例高度",
        resizeBoth: "调整图例大小",
        opacity: "透明度",
        specialZones: "特殊区域图层",
        count: `${count} 项`,
      }
      : {
        title: "Legend",
        drag: "Drag legend",
        collapse: "Collapse legend",
        expand: "Expand legend",
        close: "Close legend",
        resizeWidth: "Resize legend width",
        resizeHeight: "Resize legend height",
        resizeBoth: "Resize legend",
        opacity: "Opacity",
        specialZones: "Special Zone Layers",
        count: `${count} items`,
      };
    return catalog[key] || catalog.title;
  }

  function setLegendControlButtonIcon(button, icon, label) {
    if (!button) return;
    let iconElement = button.querySelector("[data-legend-button-icon]");
    if (!iconElement) {
      iconElement = document.createElement("span");
      iconElement.dataset.legendButtonIcon = "true";
      iconElement.setAttribute("aria-hidden", "true");
      button.replaceChildren(iconElement);
    }
    iconElement.textContent = icon;
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function getLegendControlBounds(element = legendControlElement) {
    const width = Math.max(1, getMapContainer()?.clientWidth || getViewportSize().width || 1);
    const height = Math.max(1, getMapContainer()?.clientHeight || getViewportSize().height || 1);
    const elementWidth = Math.max(1, element?.offsetWidth || 180);
    const elementHeight = Math.max(1, element?.offsetHeight || 120);
    const padding = 8;
    return {
      maxLeft: Math.max(padding, width - elementWidth - padding),
      maxTop: Math.max(padding, height - elementHeight - padding),
      padding,
    };
  }

  function getLegendControlLimits() {
    return getControlLimits?.() || {
      minWidth: 180,
      maxWidth: 420,
      minHeight: 130,
      maxHeight: 560,
      minOpacity: 0.35,
      maxOpacity: 1,
    };
  }

  function setStyleIfChanged(property, value) {
    if (legendControlElement.style[property] !== value) {
      legendControlElement.style[property] = value;
    }
  }

  function applyLegendControlSize(controlState) {
    if (!legendControlElement) return;
    const limits = getLegendControlLimits();
    const width = clamp(Number(controlState.width || 240), limits.minWidth, limits.maxWidth);
    const height = clamp(Number(controlState.height || 340), limits.minHeight, limits.maxHeight);
    const opacity = clamp(Number(controlState.opacity || 0.9), limits.minOpacity, limits.maxOpacity);
    const collapsedWidth = Math.min(176, limits.minWidth);
    setStyleIfChanged("width", controlState.collapsed ? `${collapsedWidth}px` : `${Math.round(width)}px`);
    setStyleIfChanged("height", controlState.collapsed ? "" : `${Math.round(height)}px`);
    setStyleIfChanged("opacity", String(opacity));
    if (legendOpacityInputElement) {
      legendOpacityInputElement.min = String(Math.round(limits.minOpacity * 100));
      legendOpacityInputElement.max = String(Math.round(limits.maxOpacity * 100));
      legendOpacityInputElement.value = String(Math.round(opacity * 100));
      legendOpacityInputElement.setAttribute("aria-label", getLegendControlText("opacity"));
    }
  }

  function showLegendOpacityPanel() {
    if (!legendControlElement || !legendOpacityPanelElement) return;
    legendControlElement.classList.add("is-edge-selected");
    legendOpacityPanelElement.hidden = false;
  }

  function hideLegendOpacityPanel() {
    if (!legendControlElement || !legendOpacityPanelElement || legendResizeSession) return;
    legendControlElement.classList.remove("is-edge-selected");
    legendOpacityPanelElement.hidden = true;
  }

  function applyLegendControlPosition(controlState) {
    if (!legendControlElement) return;
    applyLegendControlSize(controlState);
    const bounds = getLegendControlBounds(legendControlElement);
    const left = clamp(Math.round(bounds.maxLeft * Number(controlState.xRatio || 0)), bounds.padding, bounds.maxLeft);
    const top = clamp(Math.round(bounds.maxTop * Number(controlState.yRatio || 0)), bounds.padding, bounds.maxTop);
    setStyleIfChanged("left", `${left}px`);
    setStyleIfChanged("top", `${top}px`);
  }

  function storeLegendControlPosition(left, top) {
    const bounds = getLegendControlBounds(legendControlElement);
    const clampedLeft = clamp(left, bounds.padding, bounds.maxLeft);
    const clampedTop = clamp(top, bounds.padding, bounds.maxTop);
    const xRatio = bounds.maxLeft > bounds.padding ? clampedLeft / bounds.maxLeft : 0;
    const yRatio = bounds.maxTop > bounds.padding ? clampedTop / bounds.maxTop : 0;
    updateControlState({ xRatio, yRatio });
    if (legendControlElement) {
      legendControlElement.style.left = `${Math.round(clampedLeft)}px`;
      legendControlElement.style.top = `${Math.round(clampedTop)}px`;
    }
  }

  function storeLegendControlSize(width, height) {
    if (!legendControlElement) return getControlState();
    const limits = getLegendControlLimits();
    const rect = legendControlElement.getBoundingClientRect();
    const containerRect = getMapContainer()?.getBoundingClientRect?.() || { right: window.innerWidth || rect.right, bottom: window.innerHeight || rect.bottom };
    const currentLeft = rect.left - (containerRect.left || 0);
    const currentTop = rect.top - (containerRect.top || 0);
    const viewportMaxWidth = Math.max(limits.minWidth, containerRect.right - rect.left - 8);
    const viewportMaxHeight = Math.max(limits.minHeight, containerRect.bottom - rect.top - 8);
    const nextWidth = clamp(width, limits.minWidth, Math.min(limits.maxWidth, viewportMaxWidth));
    const nextHeight = clamp(height, limits.minHeight, Math.min(limits.maxHeight, viewportMaxHeight));
    const sized = updateControlState({
      width: nextWidth,
      height: nextHeight,
    });
    applyLegendControlSize(sized);
    const bounds = getLegendControlBounds(legendControlElement);
    const clampedLeft = clamp(currentLeft, bounds.padding, bounds.maxLeft);
    const clampedTop = clamp(currentTop, bounds.padding, bounds.maxTop);
    const xRatio = bounds.maxLeft > bounds.padding ? clampedLeft / bounds.maxLeft : 0;
    const yRatio = bounds.maxTop > bounds.padding ? clampedTop / bounds.maxTop : 0;
    const next = updateControlState({ xRatio, yRatio });
    legendControlElement.style.left = `${Math.round(clampedLeft)}px`;
    legendControlElement.style.top = `${Math.round(clampedTop)}px`;
    return next;
  }

  function stopLegendResize() {
    if (!legendResizeSession) return;
    legendControlElement?.classList.remove("is-resizing");
    document.removeEventListener("pointermove", handleLegendResizeMove);
    document.removeEventListener("pointerup", stopLegendResize);
    document.removeEventListener("pointercancel", stopLegendResize);
    legendResizeSession = null;
  }

  function handleLegendResizeMove(event) {
    if (!legendResizeSession) return;
    event.preventDefault();
    const deltaX = event.clientX - legendResizeSession.clientX;
    const deltaY = event.clientY - legendResizeSession.clientY;
    const width = legendResizeSession.edge.includes("e")
      ? legendResizeSession.width + deltaX
      : legendResizeSession.width;
    const height = legendResizeSession.edge.includes("s")
      ? legendResizeSession.height + deltaY
      : legendResizeSession.height;
    storeLegendControlSize(width, height);
  }

  function startLegendResize(event) {
    if (!legendControlElement || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const edge = String(event.currentTarget?.dataset?.legendResize || "se");
    const controlState = getControlState();
    legendResizeSession = {
      edge,
      clientX: event.clientX,
      clientY: event.clientY,
      width: Number(controlState.width || legendControlElement.offsetWidth || 240),
      height: Number(controlState.height || legendControlElement.offsetHeight || 340),
    };
    legendControlElement.classList.add("is-resizing");
    showLegendOpacityPanel();
    document.addEventListener("pointermove", handleLegendResizeMove);
    document.addEventListener("pointerup", stopLegendResize);
    document.addEventListener("pointercancel", stopLegendResize);
  }

  function updateLegendControlOpacity(event) {
    const limits = getLegendControlLimits();
    const nextOpacity = clamp(Number(event?.currentTarget?.value || 90) / 100, limits.minOpacity, limits.maxOpacity);
    const next = updateControlState({ opacity: nextOpacity });
    applyLegendControlSize(next);
  }

  function stopLegendDrag() {
    if (!legendDragSession) return;
    legendControlElement?.classList.remove("is-dragging");
    document.removeEventListener("pointermove", handleLegendDragMove);
    document.removeEventListener("pointerup", stopLegendDrag);
    document.removeEventListener("pointercancel", stopLegendDrag);
    legendDragSession = null;
  }

  function handleLegendDragMove(event) {
    if (!legendDragSession) return;
    event.preventDefault();
    const nextLeft = legendDragSession.left + event.clientX - legendDragSession.clientX;
    const nextTop = legendDragSession.top + event.clientY - legendDragSession.clientY;
    storeLegendControlPosition(nextLeft, nextTop);
  }

  function startLegendDrag(event) {
    if (
      !legendControlElement
      || event.button !== 0
      || event.target?.closest?.(".map-legend-control-btn, .map-legend-resize-handle, .map-legend-opacity-panel")
    ) return;
    event.preventDefault();
    event.stopPropagation();
    const containerRect = getMapContainer()?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const rect = legendControlElement.getBoundingClientRect();
    legendDragSession = {
      clientX: event.clientX,
      clientY: event.clientY,
      left: rect.left - containerRect.left,
      top: rect.top - containerRect.top,
    };
    legendControlElement.classList.add("is-dragging");
    document.addEventListener("pointermove", handleLegendDragMove);
    document.addEventListener("pointerup", stopLegendDrag);
    document.addEventListener("pointercancel", stopLegendDrag);
  }

  function ensureLegendControlElement() {
    if (!getMapContainer() || typeof document === "undefined") {
      stopLegendDrag();
      stopLegendResize();
      return null;
    }
    if (legendControlElement && getMapContainer().contains(legendControlElement)) return legendControlElement;

    stopLegendDrag();
    stopLegendResize();
    lastLegendKey = null;
    lastHeaderKey = null;
    legendControlElement?.remove();

    const element = document.createElement("section");
    element.id = "mapLegendControl";
    element.className = "map-legend-control";
    element.setAttribute("aria-live", "polite");
    element.hidden = true;

    const header = document.createElement("div");
    header.className = "map-legend-control-header";
    header.title = getLegendControlText("drag");
    header.addEventListener("pointerdown", startLegendDrag);

    const title = document.createElement("div");
    title.className = "map-legend-control-title";

    const count = document.createElement("span");
    count.className = "map-legend-control-count";

    const actions = document.createElement("div");
    actions.className = "map-legend-control-actions";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "map-legend-control-btn";
    toggleButton.dataset.legendAction = "toggle";
    setLegendControlButtonIcon(toggleButton, "-", getLegendControlText("collapse"));
    toggleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = toggleControlCollapsed();
      element.classList.toggle("is-collapsed", next.collapsed);
      setLegendControlButtonIcon(
        toggleButton,
        next.collapsed ? "+" : "-",
        getLegendControlText(next.collapsed ? "expand" : "collapse"),
      );
      applyLegendControlPosition(next);
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "map-legend-control-btn";
    closeButton.dataset.legendAction = "close";
    setLegendControlButtonIcon(closeButton, "x", getLegendControlText("close"));
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideControl();
      stopLegendDrag();
      stopLegendResize();
      element.hidden = true;
    });

    actions.append(toggleButton, closeButton);
    header.append(title, count, actions);

    const body = document.createElement("div");
    body.className = "map-legend-control-body";

    const opacityPanel = document.createElement("label");
    opacityPanel.className = "map-legend-opacity-panel";
    opacityPanel.hidden = true;
    const opacityLabel = document.createElement("span");
    opacityLabel.className = "map-legend-opacity-label";
    opacityLabel.textContent = getLegendControlText("opacity");
    const opacityInput = document.createElement("input");
    opacityInput.type = "range";
    opacityInput.className = "map-legend-opacity-input";
    opacityInput.addEventListener("input", updateLegendControlOpacity);
    opacityPanel.append(opacityLabel, opacityInput);

    const resizeHandles = [
      ["e", "east", "resizeWidth"], ["s", "south", "resizeHeight"], ["se", "south-east", "resizeBoth"],
    ].map(([edge, direction, label]) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `map-legend-resize-handle is-${direction}`;
      handle.dataset.legendResize = edge;
      handle.title = getLegendControlText(label);
      handle.setAttribute("aria-label", handle.title);
      handle.addEventListener("pointerdown", startLegendResize);
      handle.addEventListener("pointerenter", showLegendOpacityPanel);
      handle.addEventListener("focus", showLegendOpacityPanel);
      return handle;
    });
    element.append(header, body, opacityPanel, ...resizeHandles);
    element.addEventListener("click", (event) => event.stopPropagation());
    element.addEventListener("pointerleave", hideLegendOpacityPanel);
    getMapContainer().appendChild(element);

    legendControlElement = element;
    legendControlHeaderElement = header;
    legendControlBodyElement = body;
    legendOpacityPanelElement = opacityPanel;
    legendOpacityInputElement = opacityInput;
    return legendControlElement;
  }

  function setLegendControlHeader(itemCount, collapsed) {
    if (!legendControlElement || !legendControlHeaderElement) return;
    const title = legendControlHeaderElement.querySelector(".map-legend-control-title");
    const count = legendControlHeaderElement.querySelector(".map-legend-control-count");
    const toggleButton = legendControlHeaderElement.querySelector('[data-legend-action="toggle"]');
    const closeButton = legendControlHeaderElement.querySelector('[data-legend-action="close"]');
    const opacityLabel = legendControlElement.querySelector(".map-legend-opacity-label");
    legendControlElement.setAttribute("aria-label", getLegendControlText("title"));
    legendControlHeaderElement.title = getLegendControlText("drag");
    if (title) title.textContent = getLegendControlText("title");
    if (count) count.textContent = getLegendControlText("count", itemCount);
    if (opacityLabel) opacityLabel.textContent = getLegendControlText("opacity");
    if (toggleButton) {
      setLegendControlButtonIcon(
        toggleButton,
        collapsed ? "+" : "-",
        getLegendControlText(collapsed ? "expand" : "collapse"),
      );
    }
    if (closeButton) {
      setLegendControlButtonIcon(closeButton, "x", getLegendControlText("close"));
    }
    legendControlElement.querySelectorAll("[data-legend-resize]").forEach((handle) => {
      const key = handle.dataset.legendResize === "e"
        ? "resizeWidth"
        : handle.dataset.legendResize === "s"
          ? "resizeHeight"
          : "resizeBoth";
      handle.title = getLegendControlText(key);
      handle.setAttribute("aria-label", handle.title);
    });
  }

  function appendLegendRow(parent, { color, label, stroke = "#1f2937", pattern = "solid" }) {
    const row = document.createElement("div");
    row.className = "map-legend-row";

    const swatch = document.createElement("span");
    swatch.className = "map-legend-swatch";
    swatch.style.backgroundColor = color || "#8b5cf6";
    swatch.style.borderColor = stroke || "#1f2937";
    if (String(pattern || "solid") !== "solid") swatch.classList.add("has-pattern");

    const text = document.createElement("span");
    text.className = "map-legend-label";
    text.textContent = label || "";

    row.append(swatch, text);
    parent.appendChild(row);
  }

  function renderLegend(uniqueColors = null, labels = null) {
    const controlElement = ensureLegendControlElement();
    if (!controlElement || !legendControlBodyElement) return;

    const controlState = getControlState();
    if (!controlState.visible) {
      controlElement.hidden = true;
      stopLegendDrag();
      stopLegendResize();
      return;
    }

    const { colors, specialZoneLegendLayers, labelMap, activeScenarioId, hasScenarioVisualEdits } =
      getLegendModel(uniqueColors, labels);
    const hasMeaningfulLabels = colors.some((color) => {
      const key = String(color || "").toLowerCase();
      return String(labelMap?.[key] || "").trim().length > 0;
    });
    const colorRows = colors.map((color, index) => ({
      color,
      label: labelMap?.[String(color || "").toLowerCase()] || `Category ${index + 1}`,
    }));
    const specialZoneRows = specialZoneLegendLayers.map((layer) => ({
      color: layer.style?.fill || "#8b5cf6",
      label: layer.name || layer.id,
      stroke: layer.style?.stroke || "#6d28d9",
      pattern: layer.style?.pattern || "solid",
    }));
    const legendKey = JSON.stringify([getLanguage(), colorRows, specialZoneRows]);
    const shouldRebuild = legendKey !== lastLegendKey;

    if (!colors.length && !specialZoneLegendLayers.length) {
      controlElement.hidden = true;
      stopLegendDrag();
      stopLegendResize();
      return;
    }

    if (activeScenarioId && !hasMeaningfulLabels && !hasScenarioVisualEdits && !specialZoneLegendLayers.length) {
      controlElement.hidden = true;
      stopLegendDrag();
      stopLegendResize();
      return;
    }

    controlElement.hidden = false;
    const headerKey = JSON.stringify([getLanguage(), colors.length + specialZoneLegendLayers.length, controlState.collapsed]);
    if (headerKey !== lastHeaderKey) {
      controlElement.classList.toggle("is-collapsed", controlState.collapsed);
      setLegendControlHeader(colors.length + specialZoneLegendLayers.length, controlState.collapsed);
      lastHeaderKey = headerKey;
    }

    if (shouldRebuild) {
      legendControlBodyElement.replaceChildren();

      colorRows.forEach((row) => appendLegendRow(legendControlBodyElement, row));

      if (specialZoneLegendLayers.length) {
        const section = document.createElement("div");
        section.className = "map-legend-section-title";
        section.textContent = getLegendControlText("specialZones");
        legendControlBodyElement.appendChild(section);
        specialZoneRows.forEach((row) => appendLegendRow(legendControlBodyElement, row));
      }
      // Hidden renders must not mark content that has never reached this body as cached.
      lastLegendKey = legendKey;
    }

    applyLegendControlPosition(controlState);
  }

  return { ensureLegendControlElement, renderLegend };
}
