import { getEffectiveScenarioHierarchy } from "../../core/scenario_hierarchy.js";
import { getQuickFillLevels, normalizeQuickFillScope } from "../../core/quick_fill_hierarchy.js";
import { getCountryCode } from "../../core/feature_identity.js";

const ZH = {
  Province: "省级", Region: "大区", Department: "省（département）", State: "州",
  "Province / territory": "省／地区", "State / union territory": "邦／联邦属地",
  "Federal subject": "联邦主体", Voivodeship: "省", Oblast: "州", Prefecture: "都道府县",
  "Prefecture / city": "地级／直辖市", "State / territory": "州／领地",
  "Region / constituent country": "大区／构成国",
};

export function getQuickFillUiCountry(state) {
  const selected = String(state.selectedInspectorCountryCode || state.inspectorHighlightCountryCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  const hit = state.devSelectedHit?.targetType === "land" ? state.devSelectedHit : null;
  const feature = hit?.id ? state.landIndex?.get(hit.id) : null;
  const geographical = feature ? getCountryCode(feature) : "";
  if (state.activeScenarioId && geographical) return geographical;
  return selected || geographical;
}

export function getQuickFillLevelModel(state) {
  const zh = String(state.currentLanguage || "en").startsWith("zh");
  const countryCode = getQuickFillUiCountry(state);
  const levels = getQuickFillLevels(getEffectiveScenarioHierarchy(state), countryCode);
  const options = [{ value: "parent", label: zh ? "默认上级" : "Default parent" }];
  for (const level of levels) {
    let label = zh ? ZH[level.label] || level.label : level.label;
    if (level.status === "partial") label += zh ? "（部分区域待核验）" : " (partly awaiting verification)";
    options.push({ value: `level:${level.id}`, label, status: level.status });
  }
  options.push({ value: "country", label: state.activeScenarioId ? (zh ? "当前剧本国家" : "Current scenario owner") : (zh ? "全国" : "Country") });
  const selected = normalizeQuickFillScope(state.batchFillScope);
  if (!options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: zh ? "此层级在当前区域不可用" : "Selected level is unavailable here", disabled: true });
  }
  return { countryCode, selected, options, explicitLevel: selected.startsWith("level:"),
    hint: zh
      ? "单击填一块；双击按所选层级填色。地理分组不代表剧本年代行政区，缺失或待核验时不扩大填色范围。"
      : "Single-click paints one leaf; double-click uses the selected level. Geographic groups are not historical administration. Missing or unverified groups never expand the fill scope." };
}

export function createQuickFillLevelControls({ state, container, onChange }) {
  let select = null;
  let signature = "";
  function refresh() {
    const model = getQuickFillLevelModel(state);
    const document = container?.ownerDocument;
    if (!container || typeof document?.createElement !== "function") return model;
    if (!select) {
      select = document.createElement("select");
      select.id = "quickFillLevelSelect";
      select.className = "quick-fill-level-select";
      select.addEventListener("change", () => onChange(normalizeQuickFillScope(select.value)));
      container.appendChild(select);
    }
    select.setAttribute("aria-label", String(state.currentLanguage || "en").startsWith("zh") ? "快速填色层级" : "Quick fill level");
    const nextSignature = JSON.stringify(model.options);
    if (signature !== nextSignature) {
      select.replaceChildren();
      for (const option of model.options) {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        node.disabled = !!option.disabled;
        select.appendChild(node);
      }
      signature = nextSignature;
    }
    select.value = model.selected;
    return model;
  }
  return Object.freeze({ refresh });
}
