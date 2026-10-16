import { t } from "./i18n.js";

const ENHANCED_SELECT_SELECTOR = [
  "select.select-input",
  "select.legend-generator-select",
  "select.transport-workbench-pack-select",
  "select.transport-workbench-select",
  "select.inspector-color-suggestion-select",
  "select.hgo-identity-variant-select",
  ".special-zone-workbench-field select",
  ".special-zone-workbench-card select",
].join(",");

const MIRRORED_LAYOUT_CLASSES = ["mt-2"];
const surfaces = new WeakMap();
let observer = null;
let activeSurface = null;
let selectUid = 0;
const MENU_VIEWPORT_GAP = 8;
const MENU_TRIGGER_GAP = 6;
const MENU_MIN_WIDTH = 160;
const MENU_MIN_HEIGHT = 96;
const MENU_MAX_HEIGHT = 240;
const SEARCH_OPTION_THRESHOLD = 10;

// 统一 select 外壳保留原生 select 作为数据入口；业务 owner 继续监听原 select 的 input/change 事件。
function isElement(value) {
  return value && typeof value === "object" && value.nodeType === 1;
}

function shouldEnhanceSelect(select) {
  if (!isElement(select) || String(select.tagName || "").toLowerCase() !== "select") return false;
  if (select.multiple) return false;
  if (select.dataset.appSelectEnhanced === "true") return false;
  if (select.dataset.appSelectSkip === "true") return false;
  if (select.classList.contains("scenario-select-native")) return false;
  if (select.getAttribute("aria-hidden") === "true") return false;
  return true;
}

function setPropertyIfChanged(node, name, value) {
  if (node[name] !== value) node[name] = value;
}

function setAttributeIfChanged(node, name, value) {
  if (node.getAttribute(name) === value) return;
  if (value === null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

function toggleClassIfChanged(node, name, enabled) {
  if (node.classList.contains(name) !== enabled) node.classList.toggle(name, enabled);
}

function getLabelText(label) {
  // 包裹 select 的 label 也包含增强外壳；菜单、选项和空结果提示不属于字段名称。
  if (label.nodeType === 1 && (String(label.tagName).toLowerCase() === "select"
    || label.classList.contains("app-select-shell"))) return "";
  if (label.childNodes?.length) return Array.from(label.childNodes).map(getLabelText).join("");
  return label.textContent || "";
}

function getSelectLabel(select) {
  const ariaLabel = String(select.getAttribute("aria-label") || "").trim();
  if (ariaLabel) return ariaLabel;
  const labelledBy = String(select.getAttribute("aria-labelledby") || "").trim();
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => {
        const label = select.ownerDocument.getElementById(id);
        return label ? getLabelText(label) : "";
      })
      .join(" ")
      .trim();
    if (text) return text;
  }
  if (select.labels?.length) {
    const text = Array.from(select.labels)
      .map(getLabelText)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return String(select.title || select.name || select.id || "Select").trim();
}

function getSelectLabelTranslationKey(select) {
  const explicitKey = select.getAttribute("data-i18n-aria-label");
  if (explicitKey) return explicitKey;
  // An explicit accessible name takes precedence over a separate visual label.
  if (select.getAttribute("aria-label")) return "";
  const labelledBy = String(select.getAttribute("aria-labelledby") || "").trim();
  const labels = labelledBy
    ? labelledBy.split(/\s+/).map((id) => select.ownerDocument.getElementById(id)).filter(Boolean)
    : Array.from(select.labels || []);
  if (labels.length !== 1) return "";
  const label = labels[0];
  return label.getAttribute("data-i18n")
    || Array.from(label.querySelectorAll("[data-i18n]"))
      .find((element) => !element.closest("select, .app-select-shell"))?.getAttribute("data-i18n") || "";
}

function closeSurface(surface, { restoreFocus = false } = {}) {
  if (!surface) return;
  surface.menu.classList.add("hidden");
  surface.button.setAttribute("aria-expanded", "false");
  if (activeSurface === surface) {
    activeSurface = null;
  }
  if (restoreFocus) {
    surface.button.focus();
  }
}

function positionSurfaceMenu(surface) {
  if (!surface?.button || !surface?.menu) return;
  const rect = surface.button.getBoundingClientRect();
  const viewportWidth = Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0);
  const menuWidth = Math.min(
    Math.max(rect.width, MENU_MIN_WIDTH),
    Math.max(MENU_MIN_WIDTH, viewportWidth - MENU_VIEWPORT_GAP * 2),
  );
  const spaceBelow = viewportHeight - rect.bottom - MENU_TRIGGER_GAP - MENU_VIEWPORT_GAP;
  const spaceAbove = rect.top - MENU_TRIGGER_GAP - MENU_VIEWPORT_GAP;
  // 菜单固定在 viewport 上，滚动容器裁切问题由这里统一处理。
  const openBelow = spaceBelow >= MENU_MAX_HEIGHT || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(
    MENU_MIN_HEIGHT,
    Math.min(MENU_MAX_HEIGHT, openBelow ? spaceBelow : spaceAbove),
  );
  const left = Math.min(
    Math.max(MENU_VIEWPORT_GAP, rect.left),
    Math.max(MENU_VIEWPORT_GAP, viewportWidth - menuWidth - MENU_VIEWPORT_GAP),
  );
  const top = openBelow
    ? Math.min(rect.bottom + MENU_TRIGGER_GAP, viewportHeight - maxHeight - MENU_VIEWPORT_GAP)
    : Math.max(MENU_VIEWPORT_GAP, rect.top - MENU_TRIGGER_GAP - maxHeight);

  surface.menu.style.setProperty("--app-select-menu-left", `${Math.round(left)}px`);
  surface.menu.style.setProperty("--app-select-menu-top", `${Math.round(top)}px`);
  surface.menu.style.setProperty("--app-select-menu-width", `${Math.round(menuWidth)}px`);
  surface.menu.style.setProperty("--app-select-menu-max-height", `${Math.round(maxHeight)}px`);
}

function closeActiveSurface(nextSurface = null) {
  if (activeSurface && activeSurface !== nextSurface) {
    closeSurface(activeSurface);
  }
}

function focusSelectedOption(surface) {
  const options = getVisibleOptions(surface);
  const selected = options.find((option) => option.classList.contains("is-selected"));
  const first = options[0];
  (selected || first)?.focus();
}

function getVisibleOptions(surface) {
  return Array.from(surface.list.querySelectorAll(".app-select-option"))
    .filter((option) => !option.hidden && !option.disabled);
}

function filterSurfaceOptions(surface) {
  const query = String(surface.search.value || "").trim().toLocaleLowerCase();
  let visibleCount = 0;
  Array.from(surface.list.children).forEach((child) => {
    if (child.classList.contains("app-select-group")) {
      const groupMatches = child.dataset.searchLabel?.includes(query);
      let groupVisible = 0;
      child.querySelectorAll(".app-select-option").forEach((option) => {
        setPropertyIfChanged(option, "hidden", !!query && !groupMatches && !option.dataset.searchLabel.includes(query));
        if (!option.hidden) groupVisible++;
      });
      setPropertyIfChanged(child, "hidden", groupVisible === 0);
      visibleCount += groupVisible;
    } else if (child.classList.contains("app-select-option")) {
      setPropertyIfChanged(child, "hidden", !!query && !child.dataset.searchLabel.includes(query));
      if (!child.hidden) visibleCount++;
    }
  });
  setPropertyIfChanged(surface.noMatches, "hidden", visibleCount > 0);
  setPropertyIfChanged(surface.noMatches, "textContent", t("No matching options", "ui"));
}

function openSurface(surface) {
  surface.search.value = "";
  syncSurface(surface.select);
  closeActiveSurface(surface);
  positionSurfaceMenu(surface);
  surface.menu.classList.remove("hidden");
  surface.button.setAttribute("aria-expanded", "true");
  activeSurface = surface;
  if (!surface.search.hidden) surface.search.focus();
  else focusSelectedOption(surface);
}

function toggleSurface(surface) {
  if (surface.select.disabled) return;
  const isOpen = !surface.menu.classList.contains("hidden");
  if (isOpen) {
    closeSurface(surface);
    return;
  }
  openSurface(surface);
}

function moveOptionFocus(surface, direction) {
  const options = getVisibleOptions(surface);
  if (!options.length) return;
  const currentIndex = options.indexOf(document.activeElement);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : options.length - 1)
    : (currentIndex + direction + options.length) % options.length;
  options[nextIndex]?.focus();
}

function selectOption(surface, value) {
  if (surface.select.disabled) return;
  surface.select.value = value;
  surface.select.dispatchEvent(new Event("input", { bubbles: true }));
  surface.select.dispatchEvent(new Event("change", { bubbles: true }));
  syncSurface(surface.select);
  closeSurface(surface, { restoreFocus: true });
}

function syncMirroredClasses(select, surface) {
  MIRRORED_LAYOUT_CLASSES.forEach((className) => {
    toggleClassIfChanged(surface.shell, className, select.classList.contains(className));
  });
  toggleClassIfChanged(surface.shell, "hidden", !!select.hidden || select.classList.contains("hidden"));
}

export function syncStyledSelect(select) {
  syncSurface(select);
}

function syncSurface(select) {
  const surface = surfaces.get(select);
  if (!surface) return;
  syncMirroredClasses(select, surface);
  const selectedOption = select.selectedOptions?.[0] || select.options?.[select.selectedIndex] || null;
  setPropertyIfChanged(surface.text, "textContent", selectedOption?.textContent?.trim() || "");
  setPropertyIfChanged(surface.button, "disabled", !!select.disabled);
  setPropertyIfChanged(surface.button, "title", select.title || "");
  const labelKey = getSelectLabelTranslationKey(select);
  setAttributeIfChanged(surface.button, "data-i18n-aria-label", labelKey || null);
  setAttributeIfChanged(surface.button, "aria-label", labelKey ? t(labelKey, "ui") : getSelectLabel(select));
  const options = Array.from(select.options || []);
  setPropertyIfChanged(surface.search, "hidden", options.filter((option) => !option.disabled && !option.parentElement?.disabled).length < SEARCH_OPTION_THRESHOLD);
  const searchLabel = t("Search options", "ui");
  setPropertyIfChanged(surface.search, "placeholder", searchLabel);
  setAttributeIfChanged(surface.search, "aria-label", searchLabel);
  if (surface.search.hidden) setPropertyIfChanged(surface.search, "value", "");
  // 每次读取原生选项，只有结构、文本、值或禁用态改变时才重建，避免刷新移走正在聚焦的选项。
  const optionState = (option) => [option.value, option.textContent || option.label || option.value, !!option.disabled];
  const signature = JSON.stringify(Array.from(select.children || []).map((child) => {
    const tag = String(child.tagName || "").toLowerCase();
    if (tag === "option") return [tag, ...optionState(child)];
    if (tag === "optgroup") return [tag, child.label, !!child.disabled,
      Array.from(child.children || []).filter((option) => String(option.tagName).toLowerCase() === "option").map(optionState)];
    return [tag];
  }));
  if (signature !== surface.optionSignature) {
    rebuildSurfaceOptions(surface);
    surface.optionSignature = signature;
  }
  surface.optionButtons.forEach((button, index) => {
    const selected = !!options[index]?.selected;
    setAttributeIfChanged(button, "aria-selected", selected ? "true" : "false");
    toggleClassIfChanged(button, "is-selected", selected);
  });
  filterSurfaceOptions(surface);
}

function rebuildSurfaceOptions(surface) {
  const { select } = surface;
  surface.list.replaceChildren();
  surface.optionButtons = [];
  let optionIndex = 0;
  const appendOption = (option, parent, groupDisabled = false) => {
    const index = optionIndex++;
    const value = option.value;
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "app-select-option";
    optionButton.id = `${surface.idBase}Option${index}`;
    optionButton.setAttribute("role", "option");
    optionButton.setAttribute("aria-selected", option.selected ? "true" : "false");
    optionButton.classList.toggle("is-selected", option.selected);
    optionButton.disabled = !!option.disabled || groupDisabled;
    optionButton.dataset.value = value;
    optionButton.textContent = option.textContent || option.label || value;
    optionButton.dataset.searchLabel = optionButton.textContent.toLocaleLowerCase();
    optionButton.addEventListener("click", () => selectOption(surface, value));
    parent.appendChild(optionButton);
    surface.optionButtons.push(optionButton);
  };
  Array.from(select.children || []).forEach((child) => {
    const tag = String(child.tagName || "").toLowerCase();
    if (tag === "option") {
      appendOption(child, surface.list);
    } else if (tag === "optgroup") {
      const group = document.createElement("div");
      group.className = "app-select-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", child.label);
      group.dataset.searchLabel = String(child.label || "").toLocaleLowerCase();
      const heading = document.createElement("div");
      heading.className = "app-select-group-heading";
      heading.textContent = child.label;
      heading.setAttribute("aria-hidden", "true");
      group.appendChild(heading);
      Array.from(child.children || []).forEach((option) => {
        if (String(option.tagName || "").toLowerCase() === "option") {
          appendOption(option, group, !!child.disabled);
        }
      });
      surface.list.appendChild(group);
    }
  });
}

function enhanceSelect(select) {
  if (!shouldEnhanceSelect(select) || !select.parentNode) return null;

  const idBase = select.id ? `${select.id}AppSelect` : `appSelect${++selectUid}`;
  const shell = document.createElement("div");
  shell.className = "app-select-shell";
  const button = document.createElement("button");
  button.type = "button";
  button.id = `${idBase}Button`;
  button.className = "app-select-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const text = document.createElement("span");
  text.className = "app-select-text u-truncate";
  const chevron = document.createElement("span");
  chevron.className = "app-select-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▾";
  button.append(text, chevron);

  const menu = document.createElement("div");
  menu.id = `${idBase}Menu`;
  menu.className = "app-select-menu hidden";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "app-select-search";
  search.autocomplete = "off";
  search.setAttribute("data-i18n-placeholder", "Search options");
  search.setAttribute("data-i18n-aria-label", "Search options");
  const list = document.createElement("div");
  list.id = `${idBase}List`;
  list.className = "app-select-list";
  list.setAttribute("role", "listbox");
  const noMatches = document.createElement("div");
  noMatches.className = "app-select-no-matches";
  noMatches.setAttribute("role", "status");
  noMatches.setAttribute("data-i18n", "No matching options");
  menu.append(search, list, noMatches);
  button.setAttribute("aria-controls", list.id);

  select.parentNode.insertBefore(shell, select);
  shell.append(select, button, menu);
  select.dataset.appSelectEnhanced = "true";
  select.classList.add("app-select-native");
  // 原生 select 留在 DOM 内负责表单值和事件合同，视觉和键盘入口交给 app-select-button。
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  const surface = { idBase, select, shell, button, text, menu, search, list, noMatches };
  surfaces.set(select, surface);

  button.addEventListener("click", () => toggleSurface(surface));
  search.addEventListener("input", () => filterSurfaceOptions(surface));
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      openSurface(surface);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openSurface(surface);
      moveOptionFocus(surface, -1);
    } else if (event.key === "Escape") {
      closeSurface(surface);
    }
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSurface(surface, { restoreFocus: true });
    } else if (event.key === "Enter" && event.target === surface.search) {
      event.preventDefault();
      const first = getVisibleOptions(surface)[0];
      if (first) selectOption(surface, first.dataset.value);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveOptionFocus(surface, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveOptionFocus(surface, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      getVisibleOptions(surface)[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      const options = getVisibleOptions(surface);
      options[options.length - 1]?.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
      && !surface.search.hidden && event.target !== surface.search) {
      event.preventDefault();
      surface.search.value += event.key;
      filterSurfaceOptions(surface);
      surface.search.focus();
    } else if (event.key === "Tab") {
      closeSurface(surface);
    }
  });
  select.addEventListener("change", () => syncSurface(select));

  syncSurface(select);
  return surface;
}

function enhanceAll(root = document) {
  if (!root?.querySelectorAll) return;
  if (root.matches?.(ENHANCED_SELECT_SELECTOR)) enhanceSelect(root);
  root.querySelectorAll(ENHANCED_SELECT_SELECTOR).forEach((select) => {
    enhanceSelect(select);
  });
}

function scanAddedRoots(roots) {
  const connectedRoots = new Set([...roots].filter((root) => root.isConnected));
  const outermostRoots = [];
  connectedRoots.forEach((root) => {
    let ancestor = root.parentElement;
    while (ancestor && !connectedRoots.has(ancestor)) ancestor = ancestor.parentElement;
    if (!ancestor) outermostRoots.push(root);
  });
  outermostRoots.forEach((root) => enhanceAll(root));
}

function getMutationSelect(mutation) {
  const target = isElement(mutation.target) ? mutation.target : mutation.target?.parentElement;
  const select = target?.closest?.("select");
  return select && surfaces.has(select) ? select : null;
}

export function initStyledSelects(root = document) {
  enhanceAll(root);
  if (observer || !document.body) return;
  const pendingRoots = new Set();
  let scanScheduled = false;
  observer = new MutationObserver((mutations) => {
    const changedSelects = new Set();
    mutations.forEach((mutation) => {
      const select = getMutationSelect(mutation);
      if (select) changedSelects.add(select);
      if (mutation.type === "childList" && !select) {
        Array.from(mutation.addedNodes || []).forEach((node) => {
          if (isElement(node) && !node.closest?.(".app-select-shell")) pendingRoots.add(node);
        });
      }
    });
    changedSelects.forEach(syncSurface);
    if (pendingRoots.size && !scanScheduled) {
      // 动态面板经常先插入容器再填 select，微任务扫描可以等同一批 DOM 写入结束后统一增强。
      scanScheduled = true;
      queueMicrotask(() => {
        const roots = [...pendingRoots];
        pendingRoots.clear();
        scanScheduled = false;
        scanAddedRoots(roots);
      });
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "disabled", "hidden", "title", "aria-label", "aria-labelledby", "data-i18n-aria-label", "label", "value", "selected"],
  });
  document.addEventListener("click", (event) => {
    if (!activeSurface) return;
    if (activeSurface.shell.contains(event.target)) return;
    closeSurface(activeSurface);
  });
  window.addEventListener("resize", () => closeActiveSurface());
  document.addEventListener("scroll", () => {
    if (activeSurface) {
      positionSurfaceMenu(activeSurface);
    }
  }, true);
}
