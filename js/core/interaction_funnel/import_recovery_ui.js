const resourceLabels = {
  "history-ui": "Edit history",
  "save-status-ui": "Save status",
  "document-refresh": "Map display",
  "scenario-runtime": "Scenario data",
  "ownership-index": "Country ownership",
  "project-ui": "Project controls",
  "map-view": "Map view",
  cities: "City points",
  strategicvalues: "Strategic resources",
  rivers: "Rivers",
  urban: "Urban areas",
  physical: "Terrain",
  "transport-overview": "Transport overview",
  "transport-country-overlays": "Country transport overlays",
};

export function importResourceLabel(resource, t) {
  return t(resource.startsWith("palette:") ? "Color palette" : resourceLabels[resource] || "Project data", "ui");
}

export function notifyUnmatchedRegions(summary, { t, showToast }, showDetails) {
  if (!summary.unmatchedRegions?.length) return;
  const message = t("Migrated {updated} entries. Could not match {count} regions.", "ui")
    .replace("{updated}", summary.migratedEntries).replace("{count}", summary.unmatchedRegions.length);
  showToast(message, {
    tone: "warning", duration: 12000, actionLabel: t("View details", "ui"),
    onAction: () => showDetails(summary.unmatchedRegions),
  });
}

// Native modality also blocks sidebar and keyboard edits while map/index recovery
// is incomplete. The document stays committed; only the failed work is retried.
export function createImportRecoveryUi({ t, retry }) {
  let dialog = null;
  return recovery => {
    if (recovery.editable || recovery.phase === "cancelled") {
      dialog?.close();
      dialog?.remove();
      dialog = null;
      return;
    }
    if (!globalThis.document?.createElement || !document.body) return;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", t("Restoring project", "ui"));
      dialog.addEventListener("cancel", event => event.preventDefault());
      document.body.append(dialog);
      dialog.showModal();
    }
    dialog.replaceChildren();
    const message = document.createElement("p");
    message.textContent = recovery.phase === "blocked"
      ? t("The project was imported, but editing is paused until map recovery succeeds.", "ui")
      : t("Restoring the map before editing can continue…", "ui");
    dialog.append(message);
    for (const warning of recovery.warnings) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${t("Retry", "ui")}: ${importResourceLabel(warning.resource, t)}`;
      button.addEventListener("click", () => { button.disabled = true; void retry(warning.resource); });
      dialog.append(button);
    }
  };
}
