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
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
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

function showToast(message, { title = "", tone = "info", duration = 3000 } = {}) {
  if (!toastViewport) {
    initToast();
  }

  const text = String(message || "").trim();
  if (!text || !toastViewport) return null;

  const toast = document.createElement("div");
  const normalizedTone = normalizeTone(tone);
  toast.className = `toast toast-${normalizedTone}`;
  toast.dataset.toastId = `toast-${Date.now()}-${toastCounter += 1}`;

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

  toast.appendChild(content);
  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "toast-dismiss";
  dismissButton.setAttribute("aria-label", "Dismiss notification");
  dismissButton.textContent = "×";
  dismissButton.addEventListener("click", () => {
    dismissToast(toast);
  });
  toast.appendChild(dismissButton);
  toastViewport.appendChild(toast);

  const normalizedDuration = resolveToastDuration(duration, normalizedTone);
  globalThis.setTimeout(() => {
    dismissToast(toast);
  }, normalizedDuration);

  return toast;
}

function dismissAllToasts() {
  if (!toastViewport) return;
  toastViewport.replaceChildren();
}

export { initToast, showToast, dismissAllToasts };
