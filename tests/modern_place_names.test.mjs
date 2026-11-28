import test from "node:test";
import assert from "node:assert/strict";
import { listRenamedPlacesInFeatures } from "../js/core/renderer/modern_place_name.js";

test("only real renames get a modern-name annotation", async () => {
  const { isRenamedPlace } = await import("../js/core/renderer/modern_place_name.js");
  assert.equal(isRenamedPlace("Breslau", "Wrocław"), true);
  assert.equal(isRenamedPlace("Gdańsk", "Gdansk"), false);
});

test("renamed places in selected features list era and present-day names by population", () => {
  const city = (host, era, modern, population, extra = {}) => ({ properties: {
    __city_host_feature_id: host, __city_population: population,
    __city_display_name_override: era, __city_base_display_name: modern, ...extra,
  } });
  const cities = [
    city("a", { en: "Tilsit", zh: "蒂尔西特" }, { en: "Sovetsk", zh: "苏维埃茨克" }, 40000),
    city("a", { en: "Königsberg", zh: "柯尼斯堡" }, { en: "Kaliningrad", zh: "加里宁格勒" }, 370000),
    city("a", { en: "Torino", zh: "都灵" }, { en: "Turin", zh: "都灵" }, 600000),
    city("a", { en: "Kiew", zh: "基辅" }, { en: "Kiev", zh: "基辅" }, 800000),
    city("b", { en: "Memel", zh: "梅梅尔" }, { en: "Klaipėda", zh: "克莱佩达" }, 50000),
    city("a", { en: "Hidden", zh: "隐藏" }, { en: "Shown", zh: "显示" }, 1, { __city_hidden: true }),
    city("a", null, { en: "Gdańsk", zh: "格但斯克" }, 450000),
  ];
  assert.deepEqual(listRenamedPlacesInFeatures(cities, ["a"], "zh"), {
    entries: [
      { eraName: "柯尼斯堡", modernName: "加里宁格勒" },
      { eraName: "蒂尔西特", modernName: "苏维埃茨克" },
    ],
    total: 2,
  });
});
