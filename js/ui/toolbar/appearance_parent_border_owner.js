// Appearance parent-border owner.
// 父国界列表可能随场景反复刷新；这里把列表模型和 DOM 复用从总 controller 中收拢出来。
import { PARENT_BORDER_STYLE_DEFAULTS } from "../../core/state_defaults.js";
import { setAppearanceVisibilityState } from "../../core/state/actions/appearance_visibility_actions.js";
import {
  ensureAppearanceStyleConfigState,
  patchAppearanceParentBorderEnabledMapState,
  patchAppearanceStyleGroupState,
  setAppearanceParentBorderEnabledMapState,
  setAppearanceStyleGroupState,
} from "../../core/state/actions/appearance_actions.js";

export function normalizeParentBorderEnabledMap(runtimeState) {
  const supported = Array.isArray(runtimeState.parentBorderSupportedCountries)
    ? runtimeState.parentBorderSupportedCountries
    : [];
  const previous = runtimeState.parentBorderEnabledByCountry && typeof runtimeState.parentBorderEnabledByCountry === "object"
    ? runtimeState.parentBorderEnabledByCountry
    : {};
  const next = {};
  supported.forEach((countryCode) => {
    next[countryCode] = !!previous[countryCode];
  });
  // enabled map 每次都裁到“当前支持的国家集合”，
  // 这样场景、数据包或 locale 切换后不会把陈旧 country code 留在 runtimeState 里继续影响渲染。
  return setAppearanceParentBorderEnabledMapState(runtimeState, next);
}

export function buildParentBorderCountryRows({
  supportedCountries = [],
  countryNames = {},
  translateGeo = (value) => value,
} = {}) {
  const supported = Array.isArray(supportedCountries) ? supportedCountries : [];
  return supported
    .map((code) => ({
      code,
      displayName: translateGeo(countryNames?.[code] || code),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function getParentBorderRowsSignature(rows = []) {
  return JSON.stringify(rows.map((row) => [row.code, row.displayName]));
}

export function createAppearanceParentBorderOwner({
  runtimeState,
  nodes = {},
  translateGeo = (value) => value,
  renderDirty = () => {},
  clamp = (value, min, max) => Math.min(max, Math.max(min, value)),
  documentRef = globalThis.document,
} = {}) {
  const {
    visibleToggle = null,
    colorInput = null,
    opacityInput = null,
    opacityValue = null,
    widthInput = null,
    widthValue = null,
    enableAllButton = null,
    disableAllButton = null,
    countryList = null,
    emptyNode = null,
  } = nodes;
  const checkboxByCountryCode = new Map();

  const getParentBorderStyle = () => {
    if (!runtimeState.styleConfig || typeof runtimeState.styleConfig !== "object") {
      ensureAppearanceStyleConfigState(runtimeState);
    }
    if (!runtimeState.styleConfig.parentBorders || typeof runtimeState.styleConfig.parentBorders !== "object") {
      setAppearanceStyleGroupState(runtimeState, "parentBorders", {});
    }
    return runtimeState.styleConfig.parentBorders;
  };

  const syncStyleControls = () => {
    const style = getParentBorderStyle();
    const color = String(style.color || PARENT_BORDER_STYLE_DEFAULTS.color);
    const opacity = clamp(
      Math.round((Number.isFinite(Number(style.opacity)) ? Number(style.opacity) : PARENT_BORDER_STYLE_DEFAULTS.opacity) * 100),
      0,
      100
    );
    const width = clamp(
      Number.isFinite(Number(style.width)) ? Number(style.width) : PARENT_BORDER_STYLE_DEFAULTS.width,
      0.2,
      4
    );

    if (colorInput) colorInput.value = color;
    if (opacityInput) opacityInput.value = String(opacity);
    if (opacityValue) opacityValue.textContent = `${opacity}%`;
    if (widthInput) widthInput.value = String(width);
    if (widthValue) widthValue.textContent = Number(width).toFixed(2);
  };

  const syncVisibilityUi = () => {
    const enabled = runtimeState.parentBordersVisible !== false;
    if (visibleToggle) visibleToggle.checked = enabled;
    if (colorInput) colorInput.disabled = !enabled;
    if (opacityInput) opacityInput.disabled = !enabled;
    if (widthInput) widthInput.disabled = !enabled;
    if (enableAllButton) enableAllButton.disabled = !enabled;
    if (disableAllButton) disableAllButton.disabled = !enabled;
    if (countryList) {
      countryList.classList.toggle("opacity-60", !enabled);
      countryList.classList.toggle("pointer-events-none", !enabled);
    }
    return enabled;
  };

  const syncCountryCheckboxes = (rows, enabled) => {
    rows.forEach(({ code }) => {
      const checkbox = checkboxByCountryCode.get(code);
      if (!checkbox) return;
      checkbox.checked = !!runtimeState.parentBorderEnabledByCountry?.[code];
      checkbox.disabled = !enabled;
    });
  };

  const createCountryRow = ({ code, displayName }, enabled) => {
    const label = documentRef.createElement("label");
    label.className = "toggle-label parent-border-country-item";

    const checkbox = documentRef.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "checkbox-input";
    checkbox.checked = !!runtimeState.parentBorderEnabledByCountry?.[code];
    checkbox.disabled = !enabled;
    checkbox.addEventListener("change", (event) => {
      patchAppearanceParentBorderEnabledMapState(runtimeState, {
        [code]: event.target.checked,
      });
      renderDirty("parent-border-country");
    });
    checkboxByCountryCode.set(code, checkbox);

    const text = documentRef.createElement("span");
    text.textContent = `${displayName} (${code})`;

    label.appendChild(checkbox);
    label.appendChild(text);
    return label;
  };

  const renderCountryList = () => {
    if (!countryList) return { rebuilt: false, rows: 0 };
    normalizeParentBorderEnabledMap(runtimeState);
    const enabled = syncVisibilityUi();
    const rows = buildParentBorderCountryRows({
      supportedCountries: runtimeState.parentBorderSupportedCountries,
      countryNames: runtimeState.countryNames,
      translateGeo,
    });
    const nextSignature = getParentBorderRowsSignature(rows);

    if (!rows.length) {
      emptyNode?.classList.remove("hidden");
      checkboxByCountryCode.clear();
      if (countryList.dataset.parentBorderRowsSignature !== nextSignature) {
        countryList.replaceChildren();
        countryList.dataset.parentBorderRowsSignature = nextSignature;
        return { rebuilt: true, rows: 0 };
      }
      return { rebuilt: false, rows: 0 };
    }
    emptyNode?.classList.add("hidden");

    // 行签名不变时只同步 checkbox 状态，不重建 DOM。
    // parent border 面板会被高频 render，保住节点复用能减少滚动位置和焦点抖动。
    if (countryList.dataset.parentBorderRowsSignature === nextSignature) {
      syncCountryCheckboxes(rows, enabled);
      return { rebuilt: false, rows: rows.length };
    }

    checkboxByCountryCode.clear();
    const rowNodes = rows.map((row) => createCountryRow(row, enabled));
    countryList.replaceChildren(...rowNodes);
    countryList.dataset.parentBorderRowsSignature = nextSignature;
    return { rebuilt: true, rows: rows.length };
  };

  const bindEvents = () => {
    syncStyleControls();
    syncVisibilityUi();

    if (colorInput && colorInput.dataset.parentBorderBound !== "true") {
      colorInput.addEventListener("input", (event) => {
        getParentBorderStyle();
        patchAppearanceStyleGroupState(runtimeState, "parentBorders", { color: event.target.value });
        renderDirty("parent-border-color");
      });
      colorInput.dataset.parentBorderBound = "true";
    }

    if (opacityInput && opacityInput.dataset.parentBorderBound !== "true") {
      opacityInput.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        const opacity = clamp(Number.isFinite(value) ? value / 100 : PARENT_BORDER_STYLE_DEFAULTS.opacity, 0, 1);
        getParentBorderStyle();
        patchAppearanceStyleGroupState(runtimeState, "parentBorders", { opacity });
        if (opacityValue) opacityValue.textContent = `${Math.round(opacity * 100)}%`;
        renderDirty("parent-border-opacity");
      });
      opacityInput.dataset.parentBorderBound = "true";
    }

    if (widthInput && widthInput.dataset.parentBorderBound !== "true") {
      widthInput.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        const width = clamp(Number.isFinite(value) ? value : PARENT_BORDER_STYLE_DEFAULTS.width, 0.2, 4);
        getParentBorderStyle();
        patchAppearanceStyleGroupState(runtimeState, "parentBorders", { width });
        if (widthValue) widthValue.textContent = width.toFixed(2);
        renderDirty("parent-border-width");
      });
      widthInput.dataset.parentBorderBound = "true";
    }

    if (visibleToggle && visibleToggle.dataset.parentBorderBound !== "true") {
      visibleToggle.addEventListener("change", (event) => {
        setAppearanceVisibilityState(runtimeState, "parentBordersVisible", event.target.checked);
        syncVisibilityUi();
        renderCountryList();
        renderDirty("parent-border-visibility");
      });
      visibleToggle.dataset.parentBorderBound = "true";
    }

    if (enableAllButton && enableAllButton.dataset.parentBorderBound !== "true") {
      enableAllButton.addEventListener("click", () => {
        const enabledMap = normalizeParentBorderEnabledMap(runtimeState);
        setAppearanceParentBorderEnabledMapState(
          runtimeState,
          Object.fromEntries(Object.keys(enabledMap).map((countryCode) => [countryCode, true])),
        );
        renderCountryList();
        renderDirty("parent-border-enable-all");
      });
      enableAllButton.dataset.parentBorderBound = "true";
    }

    if (disableAllButton && disableAllButton.dataset.parentBorderBound !== "true") {
      disableAllButton.addEventListener("click", () => {
        const enabledMap = normalizeParentBorderEnabledMap(runtimeState);
        setAppearanceParentBorderEnabledMapState(
          runtimeState,
          Object.fromEntries(Object.keys(enabledMap).map((countryCode) => [countryCode, false])),
        );
        renderCountryList();
        renderDirty("parent-border-disable-all");
      });
      disableAllButton.dataset.parentBorderBound = "true";
    }
  };

  return {
    bindEvents,
    normalizeEnabledMap: () => normalizeParentBorderEnabledMap(runtimeState),
    renderCountryList,
    syncVisibilityUi,
    syncStyleControls,
  };
}
