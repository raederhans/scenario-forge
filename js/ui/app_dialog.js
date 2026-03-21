import { t } from "./i18n.js";

let activeDialogController = null;
let dialogCounter = 0;

function getFocusableElements(container) {
  if (!(container instanceof HTMLElement)) return [];
  return Array.from(container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => (
    element instanceof HTMLElement
    && !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && element.tabIndex >= 0
  ));
}

function showAppDialog({
  title = "",
  message = "",
  details = "",
  confirmLabel = "",
  cancelLabel = "",
  tone = "info",
} = {}) {
  const normalizedTitle = String(title || "").trim();
  const normalizedMessage = String(message || "").trim();
  const normalizedDetails = String(details || "").trim();
  const normalizedTone = String(tone || "info").trim().toLowerCase();

  if (!normalizedTitle && !normalizedMessage) {
    return Promise.resolve(false);
  }

  if (activeDialogController?.close) {
    activeDialogController.close(false);
  }

  dialogCounter += 1;
  const dialogId = `app-dialog-${dialogCounter}`;
  const titleId = `${dialogId}-title`;
  const messageId = normalizedMessage ? `${dialogId}-message` : "";
  const detailsId = normalizedDetails ? `${dialogId}-details` : "";
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = document.createElement("div");
  overlay.className = "app-dialog-overlay";
  overlay.dataset.appDialogOverlay = "true";

  const dialog = document.createElement("div");
  dialog.className = `app-dialog${normalizedTone === "warning" || normalizedTone === "error" ? ` app-dialog--${normalizedTone}` : ""}`;
  dialog.setAttribute("role", normalizedTone === "warning" || normalizedTone === "error" ? "alertdialog" : "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);
  if (messageId || detailsId) {
    dialog.setAttribute("aria-describedby", [messageId, detailsId].filter(Boolean).join(" "));
  }

  const header = document.createElement("div");
  header.className = "app-dialog-header";

  const copy = document.createElement("div");
  copy.className = "app-dialog-copy";

  const titleEl = document.createElement("h2");
  titleEl.id = titleId;
  titleEl.className = "app-dialog-title";
  titleEl.textContent = normalizedTitle || t("Confirm action", "ui");
  copy.appendChild(titleEl);

  if (normalizedMessage) {
    const messageEl = document.createElement("p");
    messageEl.id = messageId;
    messageEl.className = "app-dialog-message";
    messageEl.textContent = normalizedMessage;
    copy.appendChild(messageEl);
  }

  header.appendChild(copy);
  dialog.appendChild(header);

  if (normalizedDetails) {
    const detailsEl = document.createElement("div");
    detailsEl.id = detailsId;
    detailsEl.className = "app-dialog-details";
    detailsEl.textContent = normalizedDetails;
    dialog.appendChild(detailsEl);
  }

  const footer = document.createElement("div");
  footer.className = "app-dialog-footer";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "app-dialog-btn app-dialog-btn-secondary";
  cancelButton.dataset.dialogCancel = "true";
  cancelButton.textContent = String(cancelLabel || "").trim() || t("Cancel", "ui");

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "app-dialog-btn app-dialog-btn-primary";
  confirmButton.dataset.dialogConfirm = "true";
  confirmButton.textContent = String(confirmLabel || "").trim() || t("Continue", "ui");

  footer.append(cancelButton, confirmButton);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", handleKeydown, true);
      overlay.removeEventListener("click", handleOverlayClick);
      overlay.remove();
      activeDialogController = null;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
      resolve(!!result);
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = getFocusableElements(dialog);
      if (!focusables.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const currentIndex = focusables.indexOf(document.activeElement);
      if (currentIndex === -1) {
        event.preventDefault();
        focusables[0].focus({ preventScroll: true });
        return;
      }
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      const nextIndex = (currentIndex + delta + focusables.length) % focusables.length;
      focusables[nextIndex].focus({ preventScroll: true });
    };

    const handleOverlayClick = (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    };

    activeDialogController = { close: cleanup };
    overlay.addEventListener("click", handleOverlayClick);
    document.addEventListener("keydown", handleKeydown, true);
    cancelButton.addEventListener("click", () => cleanup(false));
    confirmButton.addEventListener("click", () => cleanup(true));
    globalThis.requestAnimationFrame(() => {
      cancelButton.focus({ preventScroll: true });
    });
  });
}

export { showAppDialog };
