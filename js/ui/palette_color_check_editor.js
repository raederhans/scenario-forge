import { createPaletteColorCheck } from "./palette_color_check.js";
import { collectCountryColorCheckEntries, collectLegendColorCheckEntries } from "./palette_color_check_model.js";

/** Binds the review surface to existing owners; it never applies a palette color. */
export function initPaletteColorCheckEditor({
  state, documentRef = document, getCountries, defaultPalette, fallbackColor,
  selectCountry, focusLegendColor, workspace,
}) {
  const host = documentRef.querySelector(".color-library-card");
  if (!host) return;
  const getCountryEntries = () => collectCountryColorCheckEntries(state, getCountries(), { defaultPalette, fallbackColor });
  const controller = createPaletteColorCheck({
    state,
    host,
    getEntries: () => [...getCountryEntries(), ...collectLegendColorCheckEntries(state)],
    locateEntry: (entry) => {
      if (entry.kind === "country") {
        if (!getCountryEntries().some((current) => current.id === entry.id)) return false;
        selectCountry(entry.code || entry.id);
        workspace?.selectObject("countries", { reveal: true });
        documentRef.getElementById("editorPropertiesTitle")?.focus({ preventScroll: true });
        return true;
      }
      if (!collectLegendColorCheckEntries(state).some((current) => current.id === entry.id)) return false;
      documentRef.getElementById("editorLayer-legend")?.click();
      workspace?.showProperty("legend", { reveal: true });
      return focusLegendColor(entry.color);
    },
  });
  // Refresh only after owner UI updates, and do no pair comparisons while closed.
  let scheduled = false;
  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      controller.refreshIfOpen();
    });
  };
  const Observer = documentRef.defaultView?.MutationObserver;
  if (Observer) {
    const observer = new Observer(scheduleRefresh);
    for (const id of ["countryList", "legendEditorList"]) {
      const target = documentRef.getElementById(id);
      if (target) observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    }
  }
  documentRef.getElementById("legendEditorList")?.addEventListener("input", scheduleRefresh);
  return controller;
}
