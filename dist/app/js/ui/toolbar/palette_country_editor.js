import { getPaletteCountryTargets } from "../../core/palette_country_targets.js";
import { normalizeHexColor } from "../../core/palette_manager.js";
import { getScenarioCountryDisplayName } from "../../core/scenario_country_display.js";

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
  box.append(label, select, row, hint);
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
      ? (zh() ? `${ids.size} 个地区 · 改色会覆盖局部涂色，可撤销` : `${ids.size} regions · Replaces local paint; undo available`)
      : (zh() ? "选择已有国家 tag" : "Select an existing country tag");
  }
  function commit(raw) {
    const color = normalizeHexColor(raw);
    if (!color) {
      hex.setCustomValidity(zh() ? "请输入有效的十六进制颜色" : "Enter a valid hexadecimal color");
      hex.reportValidity();
      return;
    }
    const result = applyColor(color, select.value);
    if (result?.status !== "applied") { render(); return; }
    picker.value = hex.value = color;
    hex.setCustomValidity("");
    hint.textContent = zh() ? `已更新 ${result.featureCount} 个地区，可撤销` : `Updated ${result.featureCount} regions; undo available`;
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
    label.textContent = zh() ? "全国改色" : "Country color";
    picker.setAttribute("aria-label", zh() ? "国家颜色" : "Country color");
    hex.setAttribute("aria-label", zh() ? "国家颜色十六进制值" : "Country color hex value");
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = zh() ? "选择国家 tag…" : "Select country tag…";
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
