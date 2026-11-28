import { getActiveModal } from "./ui_contract.js";
import { isDeveloperModeEntryVisible } from "./toolbar/developer_mode_visibility.js";

const bindings = (group, entries) => entries.map(([action, label, ...keys]) => ({ group, action, label, keys }));

export const shortcuts = [
  ...bindings("Tools", [
    ["toolSelectBtn", "Select tool", "V"],
    ["toolFillBtn", "Fill tool", "F", "Q"],
    ["toolEraserBtn", "Eraser tool", "E", "W"],
    ["toolEyedropperBtn", "Eyedropper tool", "I"],
    ["brushModeBtn", "Brush", "B"],
    ["text", "Place map text", "T"],
    ["cycleQuickFillLevelFn", "Cycle quick fill level", "G"],
    ["escape", "Cancel stroke or exit current mode", "Escape"],
  ]),
  ...bindings("Colors", [
    ["swatch", "Choose a quick color", "1", "2", "3", "4", "5", "6"],
  ]),
  ...bindings("View", [
    ["up", "Pan up on focused map (Shift for larger steps)", "ArrowUp"],
    ["down", "Pan down on focused map (Shift for larger steps)", "ArrowDown"],
    ["left", "Pan left on focused map (Shift for larger steps)", "ArrowLeft"],
    ["right", "Pan right on focused map (Shift for larger steps)", "ArrowRight"],
    ["zoomIn", "Zoom in", "+", "="],
    ["zoomOut", "Zoom out", "-", "_"],
    ["zoomReset", "Reset zoom", "0"],
  ]),
  ...bindings("Panels", [
    ["toggleLeftPanelFn", "Toggle left panel", "\\"],
    ["toggleRightPanelFn", "Toggle right panel", "Mod+\\"],
    ["toggleDockFn", "Toggle bottom dock", "`"],
    ["palette", "Command palette", "Mod+K"],
    ["help", "Keyboard shortcuts", "?"],
    ["toggleDeveloperModeFn", "Toggle developer mode", "Mod+Shift+D"],
  ]),
  ...bindings("File", [
    ["save", "Save project", "Mod+S"],
    ["saveAs", "Save a copy…", "Mod+Shift+S"],
    ["runQuickReexportFn", "Export with last settings", "Mod+Shift+E"],
    ["open", "Open project", "Mod+O"],
  ]),
  ...bindings("History", [
    ["undo", "Undo", "Mod+Z"],
    ["redo", "Redo", "Mod+Shift+Z", "Mod+Y"],
  ]),
  ...bindings("Gestures", [
    ["brushPan", "Hold and drag to pan", "Shift", "Space"],
    ["pick", "Hold Alt and click to sample a color", "Alt+Click"],
    ["quickFill", "Quick fill", "Double-click"],
    ["fillCountry", "Quick fill whole country", "Shift+Double-click"],
    ["fillParent", "Quick fill parent region", "Space+Double-click"],
    ["toggleSelection", "Toggle parcel selection", "Mod+Click", "Shift+Click"],
    ["marqueeSelection", "Ctrl/⌘ + drag: box select · Ctrl/⌘ + Shift + drag: lasso", "Mod+Drag", "Mod+Shift+Drag"],
    ["placeMoreText", "Place another map label", "Shift+Click"],
    ["copyLabel", "Duplicate selected map label", "Ctrl+D"],
    ["nudgeLabel", "Nudge selected map label", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    ["deleteLabel", "Delete map label", "Delete", "Backspace"],
    ["commitLabel", "Apply label text", "Ctrl+Enter"],
  ]),
];

export function formatShortcut(keys, platform = globalThis.navigator?.platform || "") {
  const modifier = /Mac|iPad|iPhone/.test(platform) ? "⌘" : "Ctrl";
  return keys.map(key => key.replace("Mod", modifier)).join(" / ");
}

export function shortcutLabel(action) {
  return formatShortcut(shortcuts.find(row => row.action === action).keys);
}

export function keyboardChord(event) {
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (!event.ctrlKey && !event.metaKey) return key;
  return `Mod+${event.shiftKey ? "Shift+" : ""}${key}`;
}

export function initCommandPalette({ documentRef = document, t, getCommands }) {
  const make = (tag, className, id = "") => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (id) node.id = id;
    return node;
  };
  const overlay = make("div", "editor-command-overlay", "editorCommandPalette");
  overlay.hidden = true;
  const dialog = make("div", "editor-command-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const input = make("input", "editor-command-search", "editorCommandSearch");
  input.type = "text";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "editorCommandResults");
  input.setAttribute("aria-expanded", "false");
  const results = make("div", "editor-command-results", "editorCommandResults");
  results.setAttribute("role", "listbox");
  const empty = make("p", "editor-command-empty");
  empty.setAttribute("role", "status");
  dialog.append(input, results, empty);
  overlay.append(dialog);
  documentRef.body.append(overlay);
  let previousFocus;
  let commands = [];
  let options = [];
  let active = 0;
  const close = () => {
    overlay.hidden = true;
    input.setAttribute("aria-expanded", "false");
    previousFocus?.focus();
  };
  const execute = (command) => {
    close();
    command.button.click();
  };
  const select = (index) => {
    active = index;
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === active)));
    if (options[active]) {
      input.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const render = () => {
    const query = input.value.trim().toLowerCase();
    const help = query === "?";
    const title = t(help ? "Keyboard shortcuts" : "Command palette", "ui");
    dialog.setAttribute("aria-label", title);
    results.setAttribute("aria-label", title);
    results.setAttribute("role", help ? "region" : "listbox");
    results.tabIndex = help ? 0 : -1;
    input.hidden = help;
    const rows = help
      ? shortcuts.filter(row => row.action !== "toggleDeveloperModeFn" || isDeveloperModeEntryVisible())
      : getCommands().filter(({ button, label, key }) =>
        button && !button.disabled && `${t(label, "ui")} ${key} ${label}`.toLowerCase().includes(query)
      ).slice(0, 50);
    results.replaceChildren();
    options = [];
    commands = [];
    const groups = help ? new Set(rows.map(row => row.group)) : ["Layers", "Objects", "Tools", "Project"];
    for (const group of groups) {
      const entries = rows.filter((command) => command.group === group);
      if (!entries.length) continue;
      const section = make("div", "editor-command-group");
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", t(group, "ui"));
      const heading = make("div", "editor-command-heading");
      heading.setAttribute("role", "presentation");
      heading.textContent = t(group, "ui");
      section.append(heading);
      for (const command of entries) {
        const option = make("div", "editor-command-option", help ? "" : `editorCommandOption-${options.length}`);
        if (!help) option.setAttribute("role", "option");
        const label = make("span", "");
        label.textContent = t(command.label, "ui");
        option.append(label);
        if (command.keys || command.shortcut) {
          const shortcut = make("kbd", "");
          shortcut.textContent = command.keys ? formatShortcut(command.keys.map(key => ["Alt+Click", "Double-click", "Space"].includes(key) ? t(key, "ui") : key)) : command.shortcut;
          option.append(shortcut);
        }
        section.append(option);
        if (help) continue;
        option.addEventListener("click", (event) => {
          // 原始点击若继续冒泡，会被刚打开的弹层（如指南）当成"点外部"而立即关掉。
          event.stopPropagation();
          execute(command);
        });
        options.push(option);
        commands.push(command);
      }
      results.append(section);
    }
    if (help) {
      empty.hidden = true;
      input.removeAttribute("aria-activedescendant");
      results.focus();
      return;
    }
    empty.textContent = t("No matching commands", "ui");
    empty.hidden = commands.length !== 0;
    select(0);
  };
  const open = (query = "") => {
    // 导出、交通等工作台是更高层的模态，面板开在它们下面会在看不见的情况下吃掉按键。
    const activeModal = getActiveModal(documentRef);
    if (activeModal && activeModal !== dialog) return;
    if (overlay.hidden) previousFocus = documentRef.activeElement;
    overlay.hidden = false;
    input.placeholder = t("Search commands", "ui");
    input.setAttribute("aria-label", t("Search commands", "ui"));
    input.setAttribute("aria-expanded", "true");
    input.value = query;
    render();
    if (!input.hidden) input.focus();
  };
  input.addEventListener("input", render);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  const paletteKeys = shortcuts.find(row => row.action === "palette").keys;
  documentRef.addEventListener("keydown", (event) => {
    if (paletteKeys.includes(keyboardChord(event))) {
      event.preventDefault();
      event.stopPropagation();
      open();
      return;
    }
    if (overlay.hidden) return;
    // 输入法组字时的回车、方向键和 Esc 属于输入法，不能拿来执行或关闭命令。
    if (event.isComposing || event.keyCode === 229) return;
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") { event.preventDefault(); (input.hidden ? results : input).focus(); }
    else if (input.hidden) return;
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (commands.length) select((active + (event.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (commands[active]) execute(commands[active]);
    }
  }, true);
  return { open, close };
}
