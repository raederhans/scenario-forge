import { state } from "../core/state.js";
import { STATE_BUS_EVENTS, subscribeStateBusEvent } from "../core/state/index.js";
import { clearDevSelection, fillSelectedParcels, getDevSelectionCountryOptions } from "../core/map_renderer/public.js";
import { t } from "./i18n.js";
import { showToast } from "./components/toast.js";

export function initSelectionPanel() {
  const panel = document.getElementById("parcelSelectionPanel");
  const countLabel = document.getElementById("parcelSelectionCount");
  const countries = document.getElementById("parcelSelectionCountry");
  const countryButton = document.getElementById("fillSelectedCountry");
  const fill = (options) => {
    const { skipped } = fillSelectedParcels(options);
    if (skipped && !state.startupReadonly) {
      showToast(t("Skipped {count} already painted parcels.", "ui", { count: skipped }), { tone: "info" });
    }
  };
  document.getElementById("fillSelectedParcels").addEventListener("click", () => fill());
  countries.addEventListener("change", () => { countryButton.disabled = !countries.value; });
  countryButton.addEventListener("click", () => {
    const options = getDevSelectionCountryOptions();
    const target = options.find(option => option.tag === countries.value);
    if (!target) return;
    const others = options.filter(option => option.tag !== target.tag && option.color.toLowerCase() === target.color.toLowerCase());
    if (others.length) {
      showToast(t("{name} shares this color with {other}; ownership may not change.", "ui", {
        name: target.name, other: others.map(option => option.name).join(", "),
      }), { tone: "warning" });
    }
    fill({ color: target.color });
  });
  document.getElementById("clearSelectedParcels").addEventListener("click", clearDevSelection);
  const refreshCountries = () => {
    const selected = countries.value;
    const options = getDevSelectionCountryOptions();
    countries.replaceChildren();
    for (const { tag, name } of [{ tag: "", name: t("Choose country", "ui") }, ...options]) {
      const option = document.createElement("option");
      option.value = tag;
      option.text = name;
      countries.append(option);
    }
    countries.value = options.some(option => option.tag === selected) ? selected : "";
    countryButton.disabled = !countries.value;
  };
  countries.addEventListener("focus", refreshCountries);
  const refresh = () => {
    const count = state.devSelectionOrder.length;
    if (count && panel.classList.contains("hidden")) refreshCountries();
    panel.classList.toggle("hidden", !count);
    const label = count ? t("{count} parcels selected", "ui", { count }) : "";
    if (countLabel.textContent !== label) countLabel.textContent = label;
  };
  subscribeStateBusEvent(STATE_BUS_EVENTS.UPDATE_DEV_WORKSPACE_UI, refresh);
  refresh();
}
