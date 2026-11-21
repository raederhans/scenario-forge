import { state } from "../core/state.js";
import { STATE_BUS_EVENTS, subscribeStateBusEvent } from "../core/state/index.js";
import { clearDevSelection, fillSelectedParcels } from "../core/map_renderer/public.js";
import { t } from "./i18n.js";

export function initSelectionPanel() {
  const panel = document.getElementById("parcelSelectionPanel");
  const countLabel = document.getElementById("parcelSelectionCount");
  document.getElementById("fillSelectedParcels").addEventListener("click", fillSelectedParcels);
  document.getElementById("clearSelectedParcels").addEventListener("click", clearDevSelection);
  const refresh = () => {
    const count = state.devSelectionOrder.length;
    panel.classList.toggle("hidden", !count);
    const label = count ? t("{count} parcels selected", "ui", { count }) : "";
    if (countLabel.textContent !== label) countLabel.textContent = label;
  };
  subscribeStateBusEvent(STATE_BUS_EVENTS.UPDATE_DEV_WORKSPACE_UI, refresh);
  refresh();
}
