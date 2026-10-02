// Guidance follows the existing tool owner; it never changes editing state.
export function createToolGuidance({ documentRef = document, state, t }) {
  const dock = documentRef.getElementById("bottomDock");
  if (!dock) return { sync() {} };
  const view = documentRef.defaultView;
  const entries = [
    ["toolFillBtn", "Fill tool", "F"],
    ["toolEraserBtn", "Eraser tool", "E"],
    ["toolEyedropperBtn", "Eyedropper tool", "I"],
    ["brushModeBtn", "Brush", "B"],
  ];
  const tooltip = documentRef.createElement("div");
  tooltip.id = "editorToolTooltip";
  tooltip.className = "editor-tool-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  const label = documentRef.createElement("span");
  const shortcut = documentRef.createElement("kbd");
  tooltip.append(label, shortcut);
  documentRef.body.append(tooltip);
  const brushHint = documentRef.createElement("p");
  brushHint.id = "editorBrushPanHint";
  brushHint.className = "editor-brush-pan-hint";
  brushHint.hidden = true;
  brushHint.setAttribute("role", "status");
  dock.querySelector(".bottom-dock-primary").append(brushHint);
  let active = null;
  let dismissed = null;
  const hide = () => {
    if (active) {
      const ids = (active.button.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== tooltip.id);
      if (ids.length) active.button.setAttribute("aria-describedby", ids.join(" "));
      else active.button.removeAttribute("aria-describedby");
    }
    active = null;
    tooltip.hidden = true;
  };
  const show = (entry) => {
    if (entry.button.disabled || dismissed === entry.button) return;
    hide();
    active = entry;
    label.textContent = t(entry.key, "ui");
    shortcut.textContent = entry.shortcut;
    const ids = (entry.button.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    entry.button.setAttribute("aria-describedby", [...new Set([...ids, tooltip.id])].join(" "));
    tooltip.hidden = false;
    const rect = entry.button.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - tooltip.offsetWidth / 2, view.innerWidth - tooltip.offsetWidth - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, rect.top - tooltip.offsetHeight - 8)}px`;
  };
  const controls = entries.flatMap(([id, key, keyShortcut]) => {
    const button = documentRef.getElementById(id);
    if (!button) return [];
    const entry = { button, key, shortcut: keyShortcut };
    button.dataset.editorTooltip = "true";
    button.setAttribute("aria-keyshortcuts", keyShortcut);
    button.addEventListener("pointerenter", () => show(entry));
    button.addEventListener("focus", () => show(entry));
    button.addEventListener("pointerleave", () => {
      dismissed = null;
      if (documentRef.activeElement !== button) hide();
    });
    button.addEventListener("blur", () => { dismissed = null; hide(); });
    button.addEventListener("click", () => { dismissed = button; hide(); });
    return [entry];
  });
  documentRef.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !active) return;
    dismissed = active.button;
    hide();
    event.preventDefault();
    event.stopPropagation();
  }, true);
  documentRef.addEventListener("pointerdown", hide, true);
  documentRef.addEventListener("scroll", hide, true);
  view.addEventListener("resize", hide);
  const sync = () => {
    controls.forEach(({ button }) => button.removeAttribute("title"));
    const text = t("Shift / Space + drag to pan", "ui");
    if (brushHint.textContent !== text) brushHint.textContent = text;
    const hidden = !state.brushModeEnabled;
    if (brushHint.hidden !== hidden) brushHint.hidden = hidden;
    if (active?.button.disabled) hide();
    else if (active) show(active);
  };
  sync();
  return { sync };
}
