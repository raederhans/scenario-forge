const DISMISSED_KEY = "sf.mobileEditingHint.dismissed";
const MESSAGE = "Editing works best on a desktop screen.";

export function createMobileEditingHintController({ documentRef, storage, matchMedia, t, createUiIcon }) {
  let hint = null;
  let media = null;

  const remove = () => {
    hint.remove();
    hint = null;
    media.removeEventListener("change", onMediaChange);
  };

  const onMediaChange = (event) => {
    if (!event.matches) remove();
  };

  const dismiss = () => {
    if (!hint) return;
    const restoreFocus = hint.contains(documentRef.activeElement);
    remove();
    try { storage.setItem(DISMISSED_KEY, "1"); } catch {}
    if (restoreFocus) documentRef.getElementById("mapContainer")?.focus();
  };

  const mount = () => {
    if (hint) return;
    media = matchMedia("(max-width: 767px)");
    if (!media.matches) return;
    try {
      if (storage.getItem(DISMISSED_KEY) !== null) return;
    } catch {}

    hint = documentRef.createElement("div");
    hint.id = "mobileEditingHint";
    hint.className = "mobile-editing-hint";
    hint.setAttribute("role", "status");
    const message = documentRef.createElement("span");
    message.setAttribute("data-i18n", MESSAGE);
    message.textContent = t(MESSAGE, "ui");
    const close = documentRef.createElement("button");
    close.type = "button";
    close.className = "mobile-editing-hint-close";
    close.setAttribute("aria-label", t("Dismiss", "ui"));
    close.setAttribute("data-i18n-aria-label", "Dismiss");
    close.appendChild(createUiIcon("close", { size: 16, doc: documentRef }));
    close.addEventListener("click", dismiss);
    hint.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    });
    hint.append(message, close);
    const projectBar = documentRef.getElementById("editorProjectBar");
    if (projectBar) projectBar.after(hint);
    else documentRef.body.prepend(hint);
    media.addEventListener("change", onMediaChange);
  };

  return { mount, dismiss, isVisible: () => hint !== null };
}
