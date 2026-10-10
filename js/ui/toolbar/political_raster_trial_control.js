import { POLITICAL_ID_RASTER_STATUS_EVENT } from "../../core/renderer/political_id_raster_trial.js";

export function bindPoliticalRasterTrialControl({ getDiagnostics, setEnabled, t, document = globalThis.document }) {
  const toggle = document.getElementById("politicalRasterTrial");
  const status = document.getElementById("politicalRasterTrialStatus");
  if (!toggle || !status || toggle.dataset.bound === "true") return;
  const sync = () => {
    const info = getDiagnostics();
    toggle.checked = !!info.requested;
    const labels = { off: "Raster trial is off", startup: "Preparing the map", "unsupported-scenario": "Available in 1936, 1939 and TNO",
      preparing: "Preparing accelerated display", accelerated: "Accelerated display", precise: "Precise display restored", fallback: "Using compatible display" };
    const key = info.reason === "unsupported-scenario" || info.reason === "startup" ? info.reason : info.displayState;
    status.dataset.i18n = labels[key] || labels.fallback;
    status.textContent = t(status.dataset.i18n, "ui");
    status.dataset.state = key || "fallback";
  };
  toggle.addEventListener("change", () => { setEnabled(toggle.checked); sync(); });
  globalThis.addEventListener(POLITICAL_ID_RASTER_STATUS_EVENT, sync);
  toggle.dataset.bound = "true";
  sync();
}
