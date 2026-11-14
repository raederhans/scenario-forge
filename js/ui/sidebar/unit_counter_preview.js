import { normalizeCountryCodeAlias as normalizeCountryCode } from "../../core/country_code_aliases.js";
import { getLocalizedScenarioCountryName } from "../../core/scenario/scenario_country_display.js";
import {
  DEFAULT_UNIT_COUNTER_PRESET_ID,
  getUnitCounterCatalogCategories,
  getUnitCounterPresetById,
  UNIT_COUNTER_ECHELONS,
  UNIT_COUNTER_PRESETS,
} from "../../core/unit_counter_presets.js";

export function createUnitCounterPreview({
  runtimeState, countryNames, t, getDirectGeoLabel, getScenarioCountryMeta,
  ensureCountryPaletteColor, getDynamicCountryEntries, resolveUnitCounterCombatState,
}) {
  const unitCounterPresets = Object.freeze(UNIT_COUNTER_PRESETS.map((preset) => ({
    ...preset,
    id: String(preset.id || "").trim().toUpperCase(),
    defaultEchelon: String(preset.defaultEchelon || "").trim().toUpperCase(),
    category: String(preset.category || "ground").trim().toLowerCase() || "ground",
    keywords: Array.isArray(preset.keywords) ? preset.keywords.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean) : [],
    featured: preset.featured !== false,
  })));
  const featuredUnitCounterPresets = Object.freeze(unitCounterPresets.filter((preset) => preset.featured));
  const unitCounterCatalogCategories = Object.freeze(getUnitCounterCatalogCategories());
  const unitCounterEchelons = Object.freeze(UNIT_COUNTER_ECHELONS.map(([value, label]) => [
    String(value || "").trim().toUpperCase(),
    label,
  ]));
  const getUnitCounterPresetMeta = (presetId = "") => {
    const normalizedPresetId = String(presetId || "").trim().toUpperCase();
    return unitCounterPresets.find((preset) => preset.id === normalizedPresetId)
      || {
        ...getUnitCounterPresetById(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID),
        id: String(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toUpperCase(),
        defaultEchelon: String(getUnitCounterPresetById(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID).defaultEchelon || "").trim().toUpperCase(),
      };
  };
  const getSidebarUnitCounterPresetOptions = (selectedPresetId = "") => {
    const normalizedSelectedId = String(selectedPresetId || "").trim().toUpperCase();
    const options = featuredUnitCounterPresets.slice();
    if (normalizedSelectedId && !options.some((preset) => preset.id === normalizedSelectedId)) {
      options.unshift(getUnitCounterPresetMeta(normalizedSelectedId));
    }
    return options;
  };
  const getFilteredUnitCounterCatalog = ({
    category = "all",
    query = "",
  } = {}) => {
    const normalizedCategory = String(category || "all").trim().toLowerCase() || "all";
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return unitCounterPresets.filter((preset) => {
      if (normalizedCategory !== "all" && preset.category !== normalizedCategory) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystacks = [
        preset.id,
        preset.label,
        preset.shortCode,
        preset.unitType,
        preset.category,
        ...(preset.keywords || []),
      ]
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean);
      return haystacks.some((entry) => entry.includes(normalizedQuery));
    });
  };
  const inferUnitCounterPresetId = (candidate = {}) => {
    const rawPreset = String(candidate?.presetId || candidate?.unitType || "").trim().toUpperCase();
    if (rawPreset && unitCounterPresets.some((preset) => preset.id === rawPreset)) {
      return rawPreset;
    }
    const rawToken = String(candidate?.symbolCode || candidate?.sidc || candidate?.label || "").trim().toUpperCase();
    const matchedPreset = unitCounterPresets.find((preset) => {
      if (!rawToken) return false;
      return rawToken === preset.id
        || rawToken === preset.shortCode
        || rawToken.includes(preset.shortCode);
    });
    return matchedPreset?.id || unitCounterPresets[0].id;
  };
  const getUnitCounterNationMeta = (nationTag = "") => {
    const normalizedTag = normalizeCountryCode(nationTag);
    if (!normalizedTag) {
      return {
        tag: "",
        displayName: t("Auto from placement", "ui"),
        color: "rgba(71, 85, 105, 0.78)",
      };
    }
    const scenarioMeta = getScenarioCountryMeta(normalizedTag);
    const fallbackName = runtimeState.countryNames?.[normalizedTag] || countryNames[normalizedTag] || normalizedTag;
    return {
      tag: normalizedTag,
      displayName: getLocalizedScenarioCountryName(scenarioMeta || {}, fallbackName, getDirectGeoLabel) || normalizedTag,
      color: String(
        scenarioMeta?.color_hex
          || scenarioMeta?.colorHex
          || ensureCountryPaletteColor(normalizedTag)
          || "#64748b"
      ),
    };
  };
  const getUnitCounterNationOptions = () => getDynamicCountryEntries().map((entry) => {
    const meta = getUnitCounterNationMeta(entry.code);
    return {
      value: entry.code,
      label: `${entry.code} · ${meta.displayName}`,
    };
  });
  const getUnitCounterEchelonLabel = (value = "") => {
    const normalizedValue = String(value || "").trim().toUpperCase();
    return unitCounterEchelons.find(([code]) => code === normalizedValue)?.[1] || normalizedValue || t("Auto", "ui");
  };
  const formatUnitCounterListLabel = (counter = {}) => {
    const presetMeta = getUnitCounterPresetMeta(inferUnitCounterPresetId(counter));
    const nationMeta = getUnitCounterNationMeta(counter.nationTag);
    const primaryLabel = String(counter.label || "").trim() || presetMeta.label;
    const rendererLabel = String(counter.renderer || "game").trim().toUpperCase();
    const detailTokens = [
      presetMeta.shortCode,
      String(counter.echelon || "").trim() ? getUnitCounterEchelonLabel(counter.echelon) : "",
      rendererLabel,
    ].filter(Boolean);
    return [`${nationMeta.tag || "AUTO"} · ${primaryLabel}`, detailTokens.join(" · ")].filter(Boolean).join(" · ");
  };
  const UNIT_COUNTER_PREVIEW_SVG_CACHE_LIMIT = 48;
  const UNIT_COUNTER_MILSTD_SIDC_PATTERN = /^[A-Z0-9*-]{10,40}$/;
  const unitCounterPreviewSvgCache = new Map();
  const normalizeUnitCounterMilstdSidc = (sidc = "") => {
    const token = String(sidc || "").trim().toUpperCase();
    return UNIT_COUNTER_MILSTD_SIDC_PATTERN.test(token) ? token : "";
  };
  const getUnitCounterPreviewSvg = (sidc = "") => {
    const normalizedSidc = normalizeUnitCounterMilstdSidc(sidc);
    if (!normalizedSidc || !globalThis.ms?.Symbol) {
      return null;
    }
    if (unitCounterPreviewSvgCache.has(normalizedSidc)) {
      const cachedNode = unitCounterPreviewSvgCache.get(normalizedSidc);
      unitCounterPreviewSvgCache.delete(normalizedSidc);
      unitCounterPreviewSvgCache.set(normalizedSidc, cachedNode);
      return cachedNode.cloneNode(true);
    }
    try {
      const markup = new globalThis.ms.Symbol(normalizedSidc, {
        size: 18,
        fill: true,
        monoColor: "#0f172a",
        outlineColor: "#f8f5eb",
        outlineWidth: 3,
      }).asSVG();
      const parsed = new globalThis.DOMParser().parseFromString(markup, "image/svg+xml");
      const svg = parsed?.documentElement;
      if (!(svg instanceof SVGElement)) {
        return null;
      }
      unitCounterPreviewSvgCache.set(normalizedSidc, svg);
      if (unitCounterPreviewSvgCache.size > UNIT_COUNTER_PREVIEW_SVG_CACHE_LIMIT) {
        const oldestKey = unitCounterPreviewSvgCache.keys().next().value;
        unitCounterPreviewSvgCache.delete(oldestKey);
      }
      return svg.cloneNode(true);
    } catch (_error) {
      return null;
    }
  };
  const buildUnitCounterPreviewStat = (kind, label) => {
    const stat = document.createElement("div");
    stat.className = `unit-counter-preview-stat is-${kind}`;
    const statLabel = document.createElement("span");
    statLabel.className = "unit-counter-preview-stat-label";
    statLabel.textContent = label;
    const track = document.createElement("span");
    track.className = "unit-counter-preview-stat-track";
    const fill = document.createElement("span");
    fill.className = "unit-counter-preview-stat-fill";
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "unit-counter-preview-stat-value";
    stat.append(statLabel, track, value);
    return { stat, fill, value };
  };
  const ensureUnitCounterPreviewNodes = (container) => {
    if (container?._previewNodes) {
      return container._previewNodes;
    }
    container.replaceChildren();
    const card = document.createElement("div");
    card.className = "unit-counter-preview-card is-medium";

    const strip = document.createElement("div");
    strip.className = "unit-counter-preview-strip";
    card.appendChild(strip);

    const topLine = document.createElement("div");
    topLine.className = "unit-counter-preview-topline";
    const nationPill = document.createElement("span");
    nationPill.className = "unit-counter-preview-nation";
    const typePill = document.createElement("span");
    typePill.className = "unit-counter-preview-renderer";
    topLine.append(nationPill, typePill);
    card.appendChild(topLine);

    const body = document.createElement("div");
    body.className = "unit-counter-preview-body";
    const symbolShell = document.createElement("div");
    symbolShell.className = "unit-counter-preview-symbol";

    const content = document.createElement("div");
    content.className = "unit-counter-preview-copy";
    const title = document.createElement("div");
    title.className = "unit-counter-preview-title";
    const status = document.createElement("div");
    status.className = "unit-counter-preview-status";
    status.hidden = true;
    const meta = document.createElement("div");
    meta.className = "unit-counter-preview-meta";

    const statStack = document.createElement("div");
    statStack.className = "unit-counter-preview-stats";
    const orgStat = buildUnitCounterPreviewStat("org", t("ORG", "ui"));
    const equipmentStat = buildUnitCounterPreviewStat("equipment", t("EQP", "ui"));
    statStack.append(orgStat.stat, equipmentStat.stat);

    const footer = document.createElement("div");
    footer.className = "unit-counter-preview-footer";
    const echelonBadge = document.createElement("span");
    echelonBadge.className = "unit-counter-preview-chip";
    const strengthBadge = document.createElement("span");
    strengthBadge.className = "unit-counter-preview-chip is-alert";
    strengthBadge.hidden = true;
    footer.append(echelonBadge, strengthBadge);

    content.append(title, status, meta, statStack, footer);
    body.append(symbolShell, content);
    card.appendChild(body);
    container.appendChild(card);

    container._previewNodes = {
      card,
      nationPill,
      typePill,
      symbolShell,
      title,
      status,
      meta,
      statStack,
      orgStat,
      equipmentStat,
      footer,
      echelonBadge,
      strengthBadge,
      symbolKey: "",
    };
    return container._previewNodes;
  };
  const renderUnitCounterPreview = (container, {
    renderer = "game",
    size = "medium",
    nationTag = "",
    nationSource = "display",
    label = "",
    subLabel = "",
    strengthText = "",
    sidc = "",
    symbolCode = "",
    presetId = "",
    echelon = "",
    organizationPct = 78,
    equipmentPct = 74,
    baseFillColor = "",
    statusText = "",
    detailMode = false,
    compactMode = false,
  } = {}) => {
    if (!container) return;
    const presetMeta = getUnitCounterPresetMeta(presetId || inferUnitCounterPresetId({ presetId, symbolCode, sidc, label }));
    const nationMeta = getUnitCounterNationMeta(nationTag);
    const combatState = resolveUnitCounterCombatState({
      organizationPct,
      equipmentPct,
      baseFillColor,
    });
    const previewLabel = String(label || "").trim() || presetMeta.label;
    const previewSubLabel = String(subLabel || "").trim() || `${nationMeta.displayName} · ${getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon)}`;
    const previewStrength = String(strengthText || "").trim();
    const previewRenderer = String(renderer || presetMeta.defaultRenderer || "game").trim().toLowerCase();
    const previewSidc = normalizeUnitCounterMilstdSidc(sidc);
    const previewSymbolToken = String(symbolCode || sidc || presetMeta.shortCode || "").trim().toUpperCase() || presetMeta.shortCode;
    const previewSymbolKey = previewRenderer === "milstd"
      ? `milstd:${previewSidc}`
      : `game:${previewSymbolToken || presetMeta.shortCode}`;
    const nodes = ensureUnitCounterPreviewNodes(container);

    container.classList.toggle("is-detail", !!detailMode);
    container.classList.toggle("is-compact", !!compactMode);
    container.classList.toggle("is-milstd", previewRenderer === "milstd");
    container.classList.toggle("is-game", previewRenderer !== "milstd");
    container.style.setProperty("--unit-counter-accent", nationMeta.color || "#64748b");
    container.style.setProperty("--unit-counter-fill", combatState.baseFillColor || "#f4f0e6");
    container.style.setProperty("--unit-counter-org-ratio", `${combatState.organizationPct}%`);
    container.style.setProperty("--unit-counter-equip-ratio", `${combatState.equipmentPct}%`);

    nodes.card.className = `unit-counter-preview-card is-${String(size || "medium").trim().toLowerCase()}${detailMode ? " is-detail" : ""}${compactMode ? " is-compact" : ""}`;
    nodes.nationPill.textContent = nationMeta.tag || t("AUTO", "ui");
    nodes.typePill.textContent = presetMeta.shortCode;
    nodes.title.textContent = previewLabel;
    nodes.meta.textContent = compactMode
      ? `${nationMeta.tag || t("AUTO", "ui")} · ${getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon)}`
      : previewSubLabel;
    nodes.status.hidden = !statusText;
    nodes.status.textContent = statusText || "";
    nodes.statStack.hidden = !!compactMode;
    nodes.footer.hidden = !!compactMode;
    nodes.echelonBadge.textContent = getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon).slice(0, detailMode ? 24 : 3).toUpperCase();
    nodes.strengthBadge.hidden = !previewStrength;
    nodes.strengthBadge.textContent = previewStrength || "";
    nodes.orgStat.stat.style.setProperty("--unit-counter-stat-ratio", `${combatState.organizationPct}%`);
    nodes.orgStat.value.textContent = String(combatState.organizationPct);
    nodes.equipmentStat.stat.style.setProperty("--unit-counter-stat-ratio", `${combatState.equipmentPct}%`);
    nodes.equipmentStat.value.textContent = String(combatState.equipmentPct);

    if (nodes.symbolKey !== previewSymbolKey) {
      nodes.symbolShell.replaceChildren();
      if (previewRenderer === "milstd" && previewSidc) {
        const svg = getUnitCounterPreviewSvg(previewSidc);
        if (svg) {
          nodes.symbolShell.appendChild(svg);
        } else {
          nodes.symbolShell.textContent = presetMeta.shortCode;
        }
      } else {
        nodes.symbolShell.textContent = previewSymbolToken || presetMeta.shortCode;
      }
      nodes.symbolKey = previewSymbolKey;
    }
  };

  return {
    unitCounterPresets,
    featuredUnitCounterPresets,
    unitCounterCatalogCategories,
    unitCounterEchelons,
    getUnitCounterPresetMeta,
    getSidebarUnitCounterPresetOptions,
    getFilteredUnitCounterCatalog,
    inferUnitCounterPresetId,
    getUnitCounterNationMeta,
    getUnitCounterNationOptions,
    getUnitCounterEchelonLabel,
    formatUnitCounterListLabel,
    renderUnitCounterPreview,
  };
}
