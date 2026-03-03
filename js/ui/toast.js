let toastViewport = null;
let toastCounter = 0;

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
  toastViewport.appendChild(toast);

  const ttl = Math.max(1200, Number(duration) || 3000);
  globalThis.setTimeout(() => {
    toast.remove();
  }, ttl);

  return toast;
}

function dismissAllToasts() {
  if (!toastViewport) return;
  toastViewport.replaceChildren();
}

export { initToast, showToast, dismissAllToasts };
