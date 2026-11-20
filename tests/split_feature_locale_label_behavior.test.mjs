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
    state.currentLanguage = "zh";
    assert.equal(getGeoFeatureDisplayLabel(feature), "迪亚拉 · 巴格达库尔德");
    state.currentLanguage = "en";
    assert.equal(getGeoFeatureDisplayLabel(feature), "Diyala · Baghdad Kurdistan");
  });
});

test("裸 ID 键优先于 id:: 键，补丁没有条目时退回名称键", () => {
  const patchGeo = {
    "PAK-1108__SPLIT_KLT": { en: "Kalat", zh: "卡拉特" },
    "id::PAK-1108__SPLIT_KLT": { en: "Stale", zh: "旧名" },
  };
  withScenarioPatch(patchGeo, () => {
    state.currentLanguage = "zh";
    const split = { id: "PAK-1108__SPLIT_KLT", properties: { id: "PAK-1108__SPLIT_KLT", name: "Baluchistan" } };
    assert.equal(getGeoFeatureDisplayLabel(split), "卡拉特");
    const plain = { id: "IRQ-3243", properties: { id: "IRQ-3243", name: "Diyala" } };
    assert.equal(getGeoFeatureDisplayLabel(plain), "迪亚拉省");
  });
});
