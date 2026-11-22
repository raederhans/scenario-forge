import { getHistoryActionLabel } from "../core/history_action_labels.js";
import { redoHistory, undoHistory } from "../core/history_manager.js";
import { t } from "../core/i18n.js";
import { state } from "../core/state.js";

export function bindHistoryPanel(dropdown) {
  if (!dropdown) return () => {};
  const panel = dropdown.querySelector("#historyPanel");
  const summary = dropdown.querySelector("summary");
  const doc = dropdown.ownerDocument;

  function refresh() {
    panel.replaceChildren();
    if (!dropdown.open) return;
    const past = state.historyPast;
    const future = state.historyFuture;
    const newest = [...future, ...past.slice(-50).reverse()].slice(0, 50);
    if (!newest.length) panel.textContent = t("No history yet", "ui");
    newest.forEach((entry, index) => {
      const row = doc.createElement("button");
      row.type = "button";
      row.className = "btn-secondary";
      const current = index === future.length;
      const pending = index < future.length;
      row.disabled = current;
      row.textContent = pending ? getHistoryActionLabel("Redo", entry)
        : t(current ? "Current: {action}" : "Return to: {action}", "ui", {
          action: getHistoryActionLabel(null, entry),
        });
      row.addEventListener("click", () => {
        const stack = pending ? state.historyFuture : state.historyPast;
        const position = stack.indexOf(entry);
        dropdown.open = false;
        summary.focus();
        if (position < 0) return;
        if (pending) redoHistory(stack.length - position);
        else undoHistory(stack.length - position - 1);
      });
      panel.appendChild(row);
    });
  }

  dropdown.addEventListener("toggle", refresh);
  doc.addEventListener("pointerdown", (event) => {
    if (dropdown.open && !dropdown.contains(event.target)) dropdown.open = false;
  });
  doc.addEventListener("keydown", (event) => {
    if (dropdown.open && event.key === "Escape") {
      event.preventDefault();
      dropdown.open = false;
      summary.focus();
    }
  });
  return refresh;
}
