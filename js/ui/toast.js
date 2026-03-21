import { t } from "./i18n.js";

let toastViewport = null;
let toastCounter = 0;
const TOAST_EXIT_DELAY_MS = 180;

function initToast({ viewportId = "toastViewport" } = {}) {
  toastViewport = document.getElementById(viewportId);
}

function normalizeTone(tone) {
  const value = String(tone || "info").trim().toLowerCase();
  if (value === "success" || value === "warning" || value === "error") {
    return value;
  }
  return "info";
}

function resolveToastDuration(duration, tone) {
  const explicitDuration = Number(duration);
  if (Number.isFinite(explicitDuration)) {
    if (explicitDuration <= 0) {
      return null;
    }
    return Math.max(1200, explicitDuration);
  }
  if (tone === "error") return 5600;
  if (tone === "warning") return 4600;
  if (tone === "success") return 3200;
  return 2800;
}

function dismissToast(toast) {
  if (!toast || toast.dataset.removing === "true") return;
  toast.dataset.removing = "true";
  toast.classList.add("is-removing");
  globalThis.setTimeout(() => {
    toast.remove();
  }, TOAST_EXIT_DELAY_MS);
}

function showToast(
  message,
  {
    title = "",
    tone = "info",
    duration = undefined,
    actionLabel = "",
    onAction = null,
    dismissOnAction = true,
  } = {}
) {
  if (!toastViewport) {
    initToast();
  }

  const text = String(message || "").trim();
  if (!text || !toastViewport) return null;

  const toast = document.createElement("div");
  const normalizedTone = normalizeTone(tone);
  toast.className = `toast toast-${normalizedTone}`;
  toast.dataset.toastId = `toast-${Date.now()}-${toastCounter += 1}`;
  toast.setAttribute("role", normalizedTone === "error" || normalizedTone === "warning" ? "alert" : "status");

  const content = document.createElement("div");
  content.className = "toast-content";

  if (title) {
    const titleEl = document.createElement("div");
    titleEl.className = "toast-title";
    titleEl.textContent = String(title);
    content.appendChild(titleEl);
  }

  const messageEl = document.createElement("div");
  messageEl.className = "toast-message";
  messageEl.textContent = text;
  content.appendChild(messageEl);

  const normalizedActionLabel = String(actionLabel || "").trim();
  if (normalizedActionLabel && typeof onAction === "function") {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "toast-action";
    actionButton.textContent = normalizedActionLabel;
    actionButton.addEventListener("click", async () => {
      actionButton.disabled = true;
      try {
        await onAction();
      } catch (error) {
        console.error("Toast action failed:", error);
      } finally {
        actionButton.disabled = false;
      }
      if (dismissOnAction) {
        dismissToast(toast);
      }
    });
    content.appendChild(actionButton);
  }

  toast.appendChild(content);
  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "toast-dismiss";
  dismissButton.setAttribute("aria-label", t("Dismiss notification", "ui"));
  dismissButton.textContent = "×";
  dismissButton.addEventListener("click", () => {
    dismissToast(toast);
  });
  toast.appendChild(dismissButton);
  toastViewport.appendChild(toast);

  const normalizedDuration = resolveToastDuration(duration, normalizedTone);
  if (normalizedDuration !== null) {
    globalThis.setTimeout(() => {
      dismissToast(toast);
    }, normalizedDuration);
  }

  toast.dismiss = () => dismissToast(toast);

  return toast;
}

function dismissAllToasts() {
  if (!toastViewport) return;
  toastViewport.replaceChildren();
}

export { initToast, showToast, dismissAllToasts };
