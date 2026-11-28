import { state } from "../core/state.js";
import { callRuntimeHook } from "../core/state/index.js";
import { t } from "../core/i18n.js";
import { buildTerritoryChangesCsv, formatTerritorySummary, getTerritoryChanges } from "../core/territory_change_summary.js";

const typeLabels = { auto: "Autosave", deferred: "Deferred autosave", manual: "Manual snapshot" };

export function mountLocalHistoryPanel(manager) {
  const get = id => document.getElementById(id);
  const history = get("localHistory");
  const list = get("localHistoryList");
  const note = get("snapshotNote");
  const ui = key => t(key, "ui");
  const toast = key => callRuntimeHook(state, "showToastFn", ui(key));
  history.open = false;

  function action(label, run) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.dataset.i18n = label;
    button.textContent = ui(label);
    button.addEventListener("click", () => run().catch(() => toast("Local history unavailable.")));
    return button;
  }

  async function refreshHistory() {
    if (!history.open) {
      list.replaceChildren();
      return;
    }
    try {
      const records = await manager.listHistory();
      if (!history.open) return;
      const locale = state.currentLanguage === "zh" ? "zh-CN" : "en-US";
      const entries = records.map(record => {
        const entry = document.createElement("li");
        const description = document.createElement("p");
        description.textContent = [ui(typeLabels[record.type]), record.scenarioName,
          record.projectName || record.projectFileStem || ui("Untitled project"),
          new Date(record.savedAt).toLocaleString(locale),
          record.note].filter(Boolean).join(" · ");
        entry.append(description, action("Restore", () => manager.restoreSnapshot(record)),
          action("Delete", () => manager.deleteSnapshot(record)));
        return entry;
      });
      list.replaceChildren(...entries);
      if (!entries.length) list.textContent = ui("No local history yet.");
    } catch {
      list.textContent = ui("Local history unavailable.");
    }
  }
  history.addEventListener("toggle", refreshHistory);
  get("saveSnapshot").addEventListener("click", async () => {
    try {
      await manager.saveSnapshot(note.value.trim());
      note.value = "";
    } catch {
      toast("Local history unavailable.");
    }
  });

  const summaryPanel = get("territorySummaryPanel");
  const summaryButton = get("territorySummaryButton");
  const summaryText = get("territorySummaryText");
  const updateSummary = () => {
    summaryText.value = formatTerritorySummary(getTerritoryChanges(state), state);
  };
  summaryButton.addEventListener("click", () => {
    summaryPanel.hidden = !summaryPanel.hidden;
    summaryButton.setAttribute("aria-expanded", String(!summaryPanel.hidden));
    if (!summaryPanel.hidden) updateSummary();
  });
  get("copyTerritorySummary").addEventListener("click", async () => {
    updateSummary();
    try {
      await navigator.clipboard.writeText(summaryText.value);
      toast("Copied");
    } catch {
      toast("Clipboard unavailable");
    }
  });
  get("exportTerritoryChanges").addEventListener("click", () => {
    const csv = buildTerritoryChangesCsv(getTerritoryChanges(state));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "territory-changes.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return {
    refreshHistory,
    openHistory() {
      get("inspectorSidebarTabProject").click();
      history.open = true;
      history.querySelector("summary").focus();
    },
  };
}
