import {
  INTENSITY_FIELD_CHANNEL_IDS,
  INTENSITY_FIELD_GRID,
  normalizeIntensityFieldsState,
  updateIntensityFieldChannel,
} from "../../core/state.js";
import { createDefaultIntensityFieldToolState } from "../../core/state/renderer_runtime_state.js";
import {
  normalizeIntensityFieldsIntoState,
  setIntensityFieldToolState,
  updateIntensityFieldChannelState,
} from "../../core/state/actions/intensity_field_actions.js";

const FIELD_SUBMODES = Object.freeze(["paint", "erase", "points"]);

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createIntensityFieldEditorNodes(documentRef, {
  prefix,
  channelInputIds = {},
} = {}) {
  const getNode = (suffix) => documentRef?.getElementById?.(`${prefix}${suffix}`) || null;
  return {
    channelInputs: Object.fromEntries(
      Object.entries(channelInputIds).map(([channelId, id]) => [channelId, documentRef?.getElementById?.(id) || null]),
    ),
    enabled: getNode("Enabled"),
    toolToggleBtn: getNode("ToolToggleBtn"),
    paintBtn: getNode("PaintBtn"),
    eraseBtn: getNode("EraseBtn"),
    pointsBtn: getNode("PointsBtn"),
    weight: getNode("Weight"),
    radius: getNode("Radius"),
    clearBtn: getNode("ClearBtn"),
    pointCount: getNode("PointCount"),
    pointList: getNode("PointList"),
    weightValue: getNode("WeightValue"),
    radiusValue: getNode("RadiusValue"),
  };
}

export function createIntensityFieldEditorSection({
  runtimeState,
  nodes = {},
  channelIds = ["physicalAtlas"],
  defaultChannelId = "physicalAtlas",
  historyLabel = "Intensity field",
  reasonPrefix = "intensity-field",
  t = (value) => value,
  clamp = clampNumber,
  renderDirty = () => {},
  captureHistoryState = () => ({}),
  pushHistoryEntry = () => true,
  documentRef = globalThis.document,
} = {}) {
  const sectionChannelIds = channelIds.filter((channelId) => INTENSITY_FIELD_CHANNEL_IDS.includes(channelId));
  const fallbackChannelId = sectionChannelIds.includes(defaultChannelId) ? defaultChannelId : (sectionChannelIds[0] || "physicalAtlas");
  const channelInputs = nodes.channelInputs && typeof nodes.channelInputs === "object" ? nodes.channelInputs : {};

  const syncIntensityFields = () => {
    return normalizeIntensityFieldsIntoState(runtimeState);
  };

  const normalizeTool = (next = {}) => {
    const defaults = createDefaultIntensityFieldToolState();
    const current = runtimeState.intensityFieldTool && typeof runtimeState.intensityFieldTool === "object"
      ? runtimeState.intensityFieldTool
      : defaults;
    const draft = next && typeof next === "object" ? next : {};
    const requestedChannelId = String(draft.channelId === undefined ? (current.channelId || "") : (draft.channelId || ""));
    const channelId = INTENSITY_FIELD_CHANNEL_IDS.includes(requestedChannelId)
      ? requestedChannelId
      : defaults.channelId;
    const requestedSubMode = String(draft.subMode === undefined ? (current.subMode || "") : (draft.subMode || ""));
    const subMode = FIELD_SUBMODES.includes(requestedSubMode) ? requestedSubMode : defaults.subMode;
    return {
      active: draft.active === undefined ? !!current.active : !!draft.active,
      channelId,
      subMode,
      brushRadiusDeg: clamp(Number.isFinite(Number(draft.brushRadiusDeg)) ? Number(draft.brushRadiusDeg) : Number(current.brushRadiusDeg || defaults.brushRadiusDeg), 0.25, 30),
      brushStrength: clamp(Number.isFinite(Number(draft.brushStrength)) ? Number(draft.brushStrength) : Number(current.brushStrength ?? defaults.brushStrength), INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max),
      selectedPointId: String(draft.selectedPointId === undefined ? (current.selectedPointId || "") : (draft.selectedPointId || "")),
    };
  };

  const setToolState = (next = {}) => {
    const normalized = normalizeTool(next);
    if (typeof runtimeState.setIntensityFieldToolFn === "function") {
      runtimeState.setIntensityFieldToolFn(normalized);
    } else {
      setIntensityFieldToolState(runtimeState, normalized);
    }
    return runtimeState.intensityFieldTool || normalized;
  };

  const getToolState = () => {
    setIntensityFieldToolState(runtimeState, normalizeTool());
    return runtimeState.intensityFieldTool;
  };

  const getSelectedChannelId = () => {
    const tool = getToolState();
    return sectionChannelIds.includes(tool.channelId) ? tool.channelId : fallbackChannelId;
  };

  const isSectionToolActive = () => {
    const tool = getToolState();
    return !!tool.active && sectionChannelIds.includes(tool.channelId);
  };

  const getSelectedChannel = () => {
    const fields = syncIntensityFields();
    return fields.channels[getSelectedChannelId()];
  };

  const formatRadiusLabel = (radiusDeg) => t("≈ {km} km", "ui").replace("{km}", String(Math.round(clamp(radiusDeg, 0.25, 30) * 111)));

  const getSelectedPoint = (channel, tool) => (
    Array.isArray(channel?.points)
      ? channel.points.find((point) => point.id === tool.selectedPointId) || null
      : null
  );

  const renderPointList = (channel, tool) => {
    const list = nodes.pointList;
    if (!list) return;
    list.textContent = "";
    if (typeof documentRef?.createElement !== "function") return;
    channel.points.forEach((point, index) => {
      const row = documentRef.createElement("div");
      row.className = "flex items-center justify-between gap-2";
      const selectButton = documentRef.createElement("button");
      selectButton.type = "button";
      selectButton.className = "sidebar-action-secondary";
      selectButton.textContent = `${tool.selectedPointId === point.id ? `${t("Selected", "ui")} ` : ""}${t("Point", "ui")} ${index + 1}`;
      selectButton.addEventListener("click", () => {
        setToolState({
          active: true,
          channelId: getSelectedChannelId(),
          selectedPointId: point.id,
          subMode: "points",
        });
        render();
      });
      const deleteButton = documentRef.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "sidebar-action-secondary";
      deleteButton.textContent = t("Delete", "ui");
      deleteButton.addEventListener("click", () => deleteSelectedPoint(point.id));
      row.appendChild(selectButton);
      row.appendChild(deleteButton);
      list.appendChild(row);
    });
  };

  const render = () => {
    const fields = syncIntensityFields();
    const tool = getToolState();
    const channelId = getSelectedChannelId();
    const channel = fields.channels[channelId] || fields.channels[fallbackChannelId];
    const selectedPoint = getSelectedPoint(channel, tool);
    const radiusDeg = selectedPoint ? selectedPoint.radiusDeg : tool.brushRadiusDeg;
    const strength = selectedPoint ? selectedPoint.strength : tool.brushStrength;
    const active = isSectionToolActive();
    Object.entries(channelInputs).forEach(([inputChannelId, input]) => {
      if (input) input.checked = inputChannelId === channelId;
    });
    if (nodes.enabled) nodes.enabled.checked = !!channel.enabled;
    if (nodes.toolToggleBtn) nodes.toolToggleBtn.textContent = active ? t("Exit Tool", "ui") : t("Enter Tool", "ui");
    if (nodes.paintBtn) nodes.paintBtn.disabled = active && tool.subMode === "paint";
    if (nodes.eraseBtn) nodes.eraseBtn.disabled = active && tool.subMode === "erase";
    if (nodes.pointsBtn) nodes.pointsBtn.disabled = active && tool.subMode === "points";
    if (nodes.weight) nodes.weight.value = String(Math.round(clamp(strength, 0, 2) * 100));
    if (nodes.weightValue) nodes.weightValue.textContent = `${Math.round(clamp(strength, 0, 2) * 100)}%`;
    if (nodes.radius) nodes.radius.value = String(Math.round(clamp(radiusDeg, 0.25, 30) * 100));
    if (nodes.radiusValue) nodes.radiusValue.textContent = formatRadiusLabel(radiusDeg);
    if (nodes.pointCount) nodes.pointCount.textContent = String(channel.points.length);
    renderPointList(channel, tool);
    return channel;
  };

  const commitChannel = (channelId, mutate, reason) => {
    const before = captureHistoryState({ intensityFieldChannels: [channelId] });
    updateIntensityFieldChannelState(runtimeState, channelId, mutate);
    const after = captureHistoryState({ intensityFieldChannels: [channelId] });
    pushHistoryEntry({
      label: historyLabel,
      before,
      after,
      meta: {
        reason,
        affectsIntensityField: true,
      },
    });
    render();
    renderDirty(reason);
  };

  const updateSelectedPointFromControls = (reason) => {
    const tool = getToolState();
    const channelId = getSelectedChannelId();
    const pointId = tool.selectedPointId;
    if (!pointId) return false;
    const strength = clamp(Number(nodes.weight?.value || 100) / 100, 0, 2);
    const radiusDeg = clamp(Number(nodes.radius?.value || 300) / 100, 0.25, 30);
    commitChannel(channelId, (channel) => {
      const point = channel.points.find((entry) => entry.id === pointId);
      if (!point) return;
      point.strength = strength;
      point.radiusDeg = radiusDeg;
      channel.enabled = true;
    }, reason);
    return true;
  };

  function deleteSelectedPoint(pointId = "") {
    const tool = getToolState();
    const channelId = getSelectedChannelId();
    const targetPointId = String(pointId || tool.selectedPointId || "");
    if (!targetPointId) return;
    commitChannel(channelId, (channel) => {
      channel.points = channel.points.filter((point) => point.id !== targetPointId);
    }, `${reasonPrefix}-delete-point`);
    setToolState({ selectedPointId: "" });
    render();
  }

  const bindEvents = () => {
    Object.entries(channelInputs).forEach(([channelId, element]) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("change", (event) => {
        if (!event.target.checked) return;
        setToolState({ channelId, selectedPointId: "" });
        render();
      });
      element.dataset.bound = "true";
    });

    if (nodes.enabled && nodes.enabled.dataset.bound !== "true") {
      nodes.enabled.addEventListener("change", (event) => {
        const channelId = getSelectedChannelId();
        commitChannel(channelId, (channel) => { channel.enabled = !!event.target.checked; }, `${reasonPrefix}-enabled`);
      });
      nodes.enabled.dataset.bound = "true";
    }

    if (nodes.toolToggleBtn && nodes.toolToggleBtn.dataset.bound !== "true") {
      nodes.toolToggleBtn.addEventListener("click", () => {
        const active = isSectionToolActive();
        setToolState({
          active: !active,
          channelId: getSelectedChannelId(),
        });
        render();
      });
      nodes.toolToggleBtn.dataset.bound = "true";
    }

    [
      [nodes.paintBtn, "paint"],
      [nodes.eraseBtn, "erase"],
      [nodes.pointsBtn, "points"],
    ].forEach(([element, subMode]) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("click", () => {
        setToolState({
          active: true,
          channelId: getSelectedChannelId(),
          subMode,
        });
        render();
      });
      element.dataset.bound = "true";
    });

    if (nodes.weight && nodes.weight.dataset.bound !== "true") {
      nodes.weight.addEventListener("input", () => {
        const strength = clamp(Number(nodes.weight.value || 100) / 100, 0, 2);
        setToolState({
          channelId: getSelectedChannelId(),
          brushStrength: strength,
        });
        if (nodes.weightValue) nodes.weightValue.textContent = `${Math.round(strength * 100)}%`;
      });
      nodes.weight.addEventListener("change", () => updateSelectedPointFromControls(`${reasonPrefix}-point-strength`));
      nodes.weight.dataset.bound = "true";
    }

    if (nodes.radius && nodes.radius.dataset.bound !== "true") {
      nodes.radius.addEventListener("input", () => {
        const radiusDeg = clamp(Number(nodes.radius.value || 300) / 100, 0.25, 30);
        setToolState({
          channelId: getSelectedChannelId(),
          brushRadiusDeg: radiusDeg,
        });
        if (nodes.radiusValue) nodes.radiusValue.textContent = formatRadiusLabel(radiusDeg);
      });
      nodes.radius.addEventListener("change", () => updateSelectedPointFromControls(`${reasonPrefix}-point-radius`));
      nodes.radius.dataset.bound = "true";
    }

    if (nodes.clearBtn && nodes.clearBtn.dataset.bound !== "true") {
      nodes.clearBtn.addEventListener("click", () => {
        const channelId = getSelectedChannelId();
        commitChannel(channelId, (channel) => {
          channel.grid.base.fill(INTENSITY_FIELD_GRID.neutral);
          channel.points = [];
        }, `${reasonPrefix}-clear`);
        setToolState({ selectedPointId: "" });
      });
      nodes.clearBtn.dataset.bound = "true";
    }

    const deleteBindingKey = `__${reasonPrefix.replace(/[^a-zA-Z0-9_]/g, "_")}DeleteBound`;
    if (documentRef?.addEventListener && !documentRef[deleteBindingKey]) {
      documentRef.addEventListener("keydown", (event) => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        const tool = getToolState();
        if (!isSectionToolActive() || tool.subMode !== "points" || !tool.selectedPointId) return;
        event.preventDefault?.();
        deleteSelectedPoint(tool.selectedPointId);
      });
      documentRef[deleteBindingKey] = true;
    }
  };

  return {
    bindEvents,
    getSelectedChannel,
    render,
  };
}
