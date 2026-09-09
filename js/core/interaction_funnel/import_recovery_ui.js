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
      button.textContent = `${t("Retry", "ui")}: ${warning.resource}`;
      button.addEventListener("click", () => { button.disabled = true; void retry(warning.resource); });
      dialog.append(button);
    }
  };
}
