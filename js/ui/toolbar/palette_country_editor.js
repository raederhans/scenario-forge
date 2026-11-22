import { getOwnershipDisplayName, t } from "../../core/i18n.js";
import { showToast } from "../components/toast.js";
import { isProjectCountry } from "../../core/project_countries.js";
import { recolorProjectCountry, registerColorAsProjectCountry } from "../../core/project_country_commands.js";
import { checkColorHealth } from "../../core/color_health_check.js";
import { applyCountryColor } from "../../core/country_color_commands.js";
import { replaceFeatureColor } from "../../core/replace_color_command.js";
import { markDirty } from "../../core/dirty_state.js";
import { focusGeoBounds } from "../../core/map_renderer/public.js";
import { getFeatureId } from "../../core/feature_identity.js";
import { focusLandFeatures } from "../sidebar/region_search_controller.js";
import { getPaletteCountryTargets } from "../../core/palette_country_targets.js";
import { normalizeHexColor } from "../../core/palette_manager.js";
import { findNearCountryColor, getCountryColorHintText } from "../../core/near_country_color_hint.js";
import { getScenarioCountryDisplayName } from "../../core/scenario/scenario_country_display.js";

export function openLegendColorEditor(doc, state, { color, owner }, refresh) {
  const dialog = doc.createElement("dialog");
  const title = t("Edit legend color {color}", "ui", { color });
  dialog.setAttribute("aria-label", title);
  const label = doc.createElement("label");
  label.textContent = t("Global recolor", "ui");
  const picker = doc.createElement("input");
  picker.type = "color";
  picker.value = color;
  label.append(picker);
  const hint = doc.createElement("p");
  const merge = doc.createElement("select");
  if (!owner) {
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = t("Merge into country…", "ui");
    merge.setAttribute("aria-label", placeholder.textContent);
    merge.append(placeholder);
    const codes = state.activeScenarioId ? Object.keys(state.scenarioCountriesByTag || {}) : [...getPaletteCountryTargets(state).keys()];
    for (const code of codes.sort()) {
      const base = normalizeHexColor(state.sovereignBaseColors?.[code]);
      if (!base) continue;
      const option = doc.createElement("option");
      option.value = base;
      const name = getOwnershipDisplayName(code);
      option.textContent = name === code ? code : t("{name} ({code})", "ui", { name, code });
      merge.append(option);
    }
    merge.addEventListener("change", () => {
      if (merge.value) picker.value = merge.value;
      hint.textContent = "";
    });
  }
  picker.addEventListener("input", () => {
    merge.value = "";
    const match = findNearCountryColor(state, picker.value, owner);
    hint.textContent = match ? getCountryColorHintText(state, match).message : "";
  });
  const apply = doc.createElement("button");
  apply.textContent = t("Apply", "ui");
  apply.addEventListener("click", async () => {
    const next = picker.value;
    dialog.close();
    if (color === next) return;
    if (isProjectCountry(state, owner)) {
      if (!recolorProjectCountry(owner, next)) {
        showToast(t("This color already belongs to another country. Use “Merge into country”.", "ui"), { tone: "warning" });
      }
    } else if (owner) {
      await applyCountryColor(owner, next);
      markDirty("inspector-country-color");
    } else {
      replaceFeatureColor(color, next);
    }
    refresh();
  });
  const cancel = doc.createElement("button");
  cancel.textContent = t("Cancel", "ui");
  cancel.addEventListener("click", () => dialog.close());
  dialog.append(label);
  if (!owner) dialog.append(merge);
  if (!owner && state.activeScenarioId) {
    const name = doc.createElement("input");
    name.type = "text";
    name.maxLength = 120;
    name.className = "input";
    name.placeholder = t("Country name", "ui");
    name.setAttribute("aria-label", name.placeholder);
    name.value = state.legendLabels?.[color] || "";
    const register = doc.createElement("button");
    register.type = "button";
    register.textContent = t("Register as new country", "ui");
    register.addEventListener("click", () => {
      if (registerColorAsProjectCountry(color, { name: name.value })) {
        dialog.close();
        refresh();
      }
    });
    dialog.append(name, register);
  }
  dialog.append(hint, apply, cancel);
  dialog.addEventListener("close", () => dialog.remove());
  doc.body.append(dialog);
  dialog.showModal();
}

function locateRegions(state, ids) {
  const topology = state.runtimePoliticalTopology || state.topology;
  const features = ids.map(id => {
    const feature = state.landIndex?.get(id);
    if (feature?.geometry) return feature;
    const geometry = topology?.objects?.political?.geometries.find(item => getFeatureId(item) === id);
    return geometry && globalThis.topojson.feature(topology, geometry);
  }).filter(Boolean);
  if (features.length) focusLandFeatures(features, focusGeoBounds);
  return features.length;
}

export function createPaletteCountryEditor({ state, host, applyColor }) {
  if (!host) return { render() {} };
  const doc = host.ownerDocument;
  const box = doc.createElement("div");
  box.className = "palette-country-editor";
  const label = doc.createElement("label");
  label.className = "section-header-block";
  label.htmlFor = "paletteCountryTag";
  const select = doc.createElement("select");
  select.id = "paletteCountryTag";
  select.className = "input";
  const row = doc.createElement("div");
  row.className = "palette-country-color-row";
  const picker = doc.createElement("input");
  picker.type = "color";
  picker.id = "paletteCountryColor";
  const hex = doc.createElement("input");
  hex.type = "text";
  hex.id = "paletteCountryHex";
  hex.className = "input";
  hex.placeholder = "#RRGGBB";
  hex.maxLength = 7;
  hex.spellcheck = false;
  const hint = doc.createElement("div");
  hint.className = "body-text";
  hint.setAttribute("role", "status");
  row.append(picker, hex);
  const check = doc.createElement("button");
  check.type = "button";
  const results = doc.createElement("div");
  check.addEventListener("click", () => {
    results.replaceChildren();
    const issues = checkColorHealth(state);
    if (!issues.length) results.textContent = t("No color conflicts or fragments found.", "ui");
    for (const issue of issues) {
      const item = doc.createElement("div");
      item.textContent = issue.type === "pair"
        ? t("{a} and {b} · ΔE {distance}", "ui", { ...issue, distance: issue.distance.toFixed(2) })
        : t("{color} · disconnected fragment ({count} regions)", "ui", { color: issue.color, count: issue.featureIds.length });
      const locate = doc.createElement("button");
      locate.type = "button";
      locate.textContent = t("Locate", "ui");
      locate.addEventListener("click", () => {
        if (!locateRegions(state, issue.featureIds)) hint.textContent = t("Region is not loaded yet.", "ui");
      });
      item.append(" ", locate);
      results.append(item);
    }
  });
  box.append(check, results, label, select, row, hint);
  host.prepend(box);
  let scene = null;
  let groups = new Map();
  const zh = () => state.currentLanguage === "zh";
  function syncColor() {
    const ids = groups.get(select.value);
    picker.disabled = hex.disabled = !ids?.size;
    const color = normalizeHexColor(state.sovereignBaseColors?.[select.value])
      || normalizeHexColor(state.colors?.[ids?.values().next().value]) || "#808080";
    picker.value = hex.value = color;
    hex.setCustomValidity("");
    hint.textContent = ids?.size
      ? t("{count} regions · Only regions still belonging to this country will change.", "ui", { count: ids.size })
      : (zh() ? "选择国家" : "Choose a country");
  }
  async function commit(raw) {
    const color = normalizeHexColor(raw);
    if (!color) {
      hex.setCustomValidity(zh() ? "请输入有效的十六进制颜色" : "Enter a valid hexadecimal color");
      hex.reportValidity();
      return;
    }
    const match = findNearCountryColor(state, color, select.value);
    const result = await applyColor(color, select.value);
    if (result?.status !== "applied") { render(); return; }
    picker.value = hex.value = color;
    hex.setCustomValidity("");
    hint.textContent = t("Updated {updated} regions. Preserved {preserved} belonging to other countries or custom colors.", "ui", { updated: result.featureCount, preserved: result.preservedCount });
    if (match) {
      const { message, actionLabel } = getCountryColorHintText(state, match);
      hint.append(` · ${message}`);
      if (!match.exact) {
        const useColor = doc.createElement("button");
        useColor.type = "button";
        useColor.textContent = actionLabel;
        useColor.addEventListener("click", () => commit(match.color));
        hint.append(" ", useColor);
      }
    }
  }
  select.addEventListener("change", syncColor);
  picker.addEventListener("change", () => commit(picker.value));
  hex.addEventListener("input", () => hex.setCustomValidity(""));
  hex.addEventListener("change", () => commit(hex.value));
  hex.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(hex.value);
    }
  });
  function render() {
    const nextScene = `${state.activeScenarioId || ""}:${state.sceneGeneration || 0}`;
    const selected = nextScene === scene ? select.value : "";
    scene = nextScene;
    groups = getPaletteCountryTargets(state);
    check.textContent = t("Color health check", "ui");
    results.replaceChildren();
    label.textContent = zh() ? "全国改色" : "Country color";
    picker.setAttribute("aria-label", zh() ? "国家颜色" : "Country color");
    hex.setAttribute("aria-label", zh() ? "国家颜色十六进制值" : "Country color hex value");
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = zh() ? "选择国家…" : "Choose a country…";
    select.replaceChildren(placeholder);
    for (const code of [...groups.keys()].sort()) {
      const option = doc.createElement("option");
      option.value = code;
      const country = state.scenarioCountriesByTag?.[code];
      const name = getScenarioCountryDisplayName(country, state.countryNames?.[code] || code);
      option.textContent = name === code ? code : `${code} · ${name}`;
      select.append(option);
    }
    select.value = groups.has(selected) ? selected : "";
    select.disabled = !groups.size;
    syncColor();
  }
  return { render };
}
