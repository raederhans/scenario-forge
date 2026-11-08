import { getPoliticalDisplayLegend, isPoliticalDisplayModeSupported } from "../../core/political_display_mode.js";
import { setPoliticalDisplayModeState } from "../../core/state/actions/political_display_mode_actions.js";
import { LegendManager } from "../../core/legend_manager.js";
import { syncStyledSelect } from "../styled_selects.js";

export function createPoliticalDisplayModeOwner({ runtimeState, t = (key) => key, documentRef = globalThis.document }) {
  const select = documentRef.getElementById("politicalDisplayMode");
  const status = documentRef.getElementById("politicalDisplayModeStatus");
  const legendNode = documentRef.getElementById("politicalDisplayModeLegend");
  let legendSignature;
  setPoliticalDisplayModeState(runtimeState, runtimeState.politicalDisplayMode);

  function render() {
    const supported = isPoliticalDisplayModeSupported(runtimeState);
    if (!supported && !runtimeState.scenarioApplyInFlight) setPoliticalDisplayModeState(runtimeState, "country");
    if (select) {
      select.value = runtimeState.politicalDisplayMode;
      select.disabled = !supported || !!runtimeState.scenarioApplyInFlight;
      syncStyledSelect(select);
    }
    if (status) status.textContent = supported ? "" : t("This scenario has no alliance or government data.", "ui");
    const legend = getPoliticalDisplayLegend(runtimeState);
    const signature = JSON.stringify(legend);
    if (!legendNode || signature === legendSignature) return;
    legendSignature = signature;
    legendNode.hidden = !legend;
    legendNode.replaceChildren();
    if (!legend) return;
    for (const entry of legend.entries) {
      const row = documentRef.createElement("div");
      row.className = "map-legend-row";
      const swatch = documentRef.createElement("span");
      swatch.className = "map-legend-swatch";
      swatch.style.backgroundColor = entry.color;
      swatch.setAttribute("aria-hidden", "true");
      const label = documentRef.createElement("span");
      label.textContent = entry.label;
      row.append(swatch, label);
      legendNode.appendChild(row);
    }
    const note = documentRef.createElement("p");
    note.className = "hint";
    note.textContent = legend.note;
    legendNode.appendChild(note);
  }

  select?.addEventListener("change", () => {
    setPoliticalDisplayModeState(runtimeState, select.value);
    runtimeState.refreshColorStateFn?.({ renderNow: true });
    LegendManager.showControl(runtimeState);
    render();
  });
  return { render };
}
