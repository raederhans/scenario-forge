import test from "node:test";
import assert from "node:assert/strict";

import { buildPaletteLibraryEntries } from "../js/core/palette_manager.js";
import { state as runtimeState } from "../js/core/state.js";
import { createDefaultColorState } from "../js/core/state/color_state.js";
import { createDefaultLocalesState } from "../js/core/state/content_state.js";
import { getTooltipCountryContext, t } from "../js/core/i18n.js";
import { getDirectGeoLabel } from "../js/ui/i18n.js";

function resetPaletteI18nState() {
  Object.assign(runtimeState, createDefaultColorState());
  runtimeState.locales = createDefaultLocalesState();
}

test("sidebar module loads through the UI i18n facade", async () => {
  const sidebar = await import("../js/ui/sidebar.js");
  assert.equal(typeof sidebar.initSidebar, "function");
  assert.equal(typeof getDirectGeoLabel, "function");
});

test("palette library entries localize titles and source labels in Chinese", () => {
  resetPaletteI18nState();
  runtimeState.currentLanguage = "zh";
  runtimeState.locales.geo = {
    Germany: { en: "Germany", zh: "德国" },
    "United States": { en: "United States", zh: "美国" },
  };
  runtimeState.activePalettePack = {
    quick_tags: ["GER", "USA"],
    entries: {
      GER: {
        color: [70, 87, 107],
        localized_name: "Germany",
        country_file_label: "Germany",
      },
      USA: {
        color: [95, 141, 198],
        localized_name: "United States",
        country_file_label: "USA",
      },
    },
  };
  runtimeState.activePaletteMap = {
    mapped: {
      GER: { iso2: "DE" },
      USA: { iso2: "US" },
    },
  };

  const entries = buildPaletteLibraryEntries();
  const germany = entries.find((entry) => entry.sourceTag === "GER");
  const usa = entries.find((entry) => entry.sourceTag === "USA");

  assert.equal(germany.localizedName, "德国");
  assert.equal(germany.sourceLabel, "德国");
  assert.equal(germany.countryFileLabel, "Germany");
  assert.equal(usa.localizedName, "美国");
  assert.equal(usa.sourceLabel, "美国");
  assert.equal(usa.sourceLabelZh, "美国");
});

test("palette library entries keep English labels in English", () => {
  resetPaletteI18nState();
  runtimeState.currentLanguage = "en";
  runtimeState.locales.geo = {
    Germany: { en: "Germany", zh: "德国" },
  };
  runtimeState.activePalettePack = {
    entries: {
      GER: {
        color: [70, 87, 107],
        localized_name: "Germany",
        country_file_label: "Germany",
      },
    },
  };
  runtimeState.activePaletteMap = {
    mapped: {
      GER: { iso2: "DE" },
    },
  };

  const [entry] = buildPaletteLibraryEntries();

  assert.equal(entry.localizedName, "Germany");
  assert.equal(entry.sourceLabel, "Germany");
  assert.equal(entry.sourceLabelZh, "德国");
});

test("country and grouping labels ignore city aliases while city labels keep them", () => {
  resetPaletteI18nState();
  runtimeState.currentLanguage = "zh";
  runtimeState.locales.geo = {
    Mahdia: { en: "Mahdia", zh: "马赫迪耶" },
    Rivas: { en: "Rivas", zh: "里瓦斯" },
    "San Juan": { en: "San Juan", zh: "圣胡安" },
  };
  runtimeState.geoAliasToStableKey = {
    Africa: "Mahdia",
    Nicaragua: "Rivas",
    Panama: "San Juan",
  };
  runtimeState.countryNames = { NIC: "Nicaragua" };

  assert.equal(getDirectGeoLabel("Africa"), "Africa");
  assert.equal(getDirectGeoLabel("Nicaragua"), "Nicaragua");
  assert.equal(getDirectGeoLabel("Panama"), "Panama");
  assert.equal(getTooltipCountryContext({ id: "feature-1", properties: { country_code: "NIC" } }).countryDisplayName, "Nicaragua");
  assert.equal(t("Panama", "geo"), "圣胡安");
  assert.equal(t("Africa", "geo"), "马赫迪耶");
});

test("country names retain exact full locales and explicit scenario bilingual names", () => {
  resetPaletteI18nState();
  runtimeState.currentLanguage = "zh";
  runtimeState.locales.geo = {
    "United States": { en: "United States", zh: "美国" },
  };
  runtimeState.geoAliasToStableKey = { "United States": "Mahdia" };
  runtimeState.countryNames = { USA: "United States" };
  runtimeState.scenarioCountriesByTag = {
    USA: { display_name_en: "United States of America", display_name_zh: "美利坚合众国" },
  };

  assert.equal(getDirectGeoLabel("United States"), "美国");
  assert.equal(getTooltipCountryContext({ id: "feature-2", properties: { country_code: "USA" } }).countryDisplayName, "美利坚合众国");
});
