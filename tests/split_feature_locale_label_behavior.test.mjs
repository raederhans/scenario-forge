import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { getGeoFeatureDisplayLabel } from "../js/core/i18n.js";

function withScenarioPatch(patchGeo, run) {
  const saved = {
    locales: state.locales,
    patch: state.scenarioGeoLocalePatchData,
    language: state.currentLanguage,
    aliases: state.geoAliasToStableKey,
  };
  try {
    state.locales = { ui: {}, geo: { ...patchGeo, Diyala: { en: "Diyala", zh: "迪亚拉省" } } };
    state.scenarioGeoLocalePatchData = { geo: patchGeo };
    state.geoAliasToStableKey = {};
    state.currentLanguage = "zh";
    run();
  } finally {
    state.locales = saved.locales;
    state.scenarioGeoLocalePatchData = saved.patch;
    state.currentLanguage = saved.language;
    state.geoAliasToStableKey = saved.aliases;
  }
}

test("拆分地块按 id:: 稳定键取剧本补丁里的名称", () => {
  const patchGeo = {
    "id::IRQ-3243__SPLIT_BKU": { en: "Diyala · Baghdad Kurdistan", zh: "迪亚拉 · 巴格达库尔德" },
  };
  const feature = { id: "IRQ-3243__SPLIT_BKU", properties: { id: "IRQ-3243__SPLIT_BKU", name: "Diyala" } };
  withScenarioPatch(patchGeo, () => {
    assert.equal(getGeoFeatureDisplayLabel(feature), "迪亚拉 · 巴格达库尔德");
  });
});

test("缺少补丁时回退到名称键", () => {
  withScenarioPatch({}, () => {
    const plain = { id: "IRQ-3243", properties: { id: "IRQ-3243", name: "Diyala" } };
    assert.equal(getGeoFeatureDisplayLabel(plain), "迪亚拉省");
  });
});
