import test from "node:test";
import assert from "node:assert/strict";
import { createCountryInspectorModel } from "../js/ui/sidebar/country_inspector_model.js";


const createModel = (state = {}) => createCountryInspectorModel(state, (label) => label);

test("scenario grouping honors explicit metadata before TNO regional inference", () => {
  const state = {
    activeScenarioId: "tno_1962",
    scenarioCountriesByTag: {
      RUS: { base_iso2: "RU" },
      RKX: { base_iso2: "RU" },
      CHI: { base_iso2: "CN" },
      MAN: { base_iso2: "CN" },
      CUSTOM: { base_iso2: "CN", inspector_group_id: "custom", inspector_group_label: "Custom" },
    },
  };
  const model = createModel(state);
  assert.equal(model.resolveScenarioInspectorGroupMeta("RUS").id, "scenario_group_russia_region");
  assert.equal(model.resolveScenarioInspectorGroupMeta("CHI").id, "scenario_group_china_region");
  assert.equal(model.resolveScenarioInspectorGroupMeta("RKX").id, "");
  assert.equal(model.resolveScenarioInspectorGroupMeta("MAN").id, "");
  assert.equal(model.resolveScenarioInspectorGroupMeta({ code: "CUSTOM", inspectorGroupId: "entry" }).id, "custom");
  state.activeScenarioId = "another_scenario";
  assert.equal(model.resolveScenarioInspectorGroupMeta("CHI").id, "");
});

test("preset and inspector lookups retain distinct precedence and country aliases", () => {
  const state = {
    activeScenarioId: "example",
    scenarioCountriesByTag: {
      CHI: { preset_lookup_code: "CN", release_lookup_iso2: "TW", lookup_iso2: "HK", base_iso2: "MO" },
    },
  };
  const model = createModel(state);
  assert.equal(model.resolveScenarioLookupCode("CHI"), "CN");
  assert.equal(model.resolveInspectorDataCode("CHI"), "TW");
  assert.equal(model.resolveScenarioLookupCode("uk"), "GB");
  state.activeScenarioId = "";
  assert.equal(model.resolveInspectorDataCode("CHI"), "CHI");
});

test("country ordering preserves featured, configured priority, size and scenario tie breaks", () => {
  const model = createModel({ countryGroupsData: { priority_by_continent: { europe: ["UK", "FR", "GB"] } } });
  const entries = [
    { code: "ZZ", displayName: "Zulu", featureCount: 1 },
    { code: "AA", displayName: "Alpha", featureCount: 1 },
    { code: "SC", displayName: "Scenario", featureCount: 1, scenarioOnly: true },
    { code: "FR", featureCount: 999 },
    { code: "GB", featureCount: 2 },
    { code: "FT", featured: true },
  ].map((entry) => ({ continentId: "europe", ...entry }));
  const priorities = model.getPriorityCountryOrderMap();
  assert.deepEqual(entries.sort((a, b) => model.compareInspectorCountries(a, b, priorities)).map((entry) => entry.code),
    ["FT", "GB", "FR", "AA", "ZZ", "SC"]);
});

test("group tree inserts localized scenario groups before anchors without mutating countries", () => {
  const state = { currentLanguage: "zh", countryGroupsData: { continents: [{ id: "asia", label: "Asia" }] } };
  const model = createModel(state);
  const entries = Object.freeze([
    Object.freeze({ code: "JP", continentId: "asia", continentLabel: "Asia", displayName: "Japan" }),
    Object.freeze({ code: "CHI", continentId: "asia", topLevelGroupId: "china", topLevelGroupLabel: "China Region", topLevelGroupAnchorId: "asia" }),
    Object.freeze({ code: "XIK", continentId: "asia", topLevelGroupId: "china", topLevelGroupLabel: "China Region", topLevelGroupAnchorId: "asia" }),
    Object.freeze({ code: "UNK" }),
  ]);
  const tree = model.buildCountryColorTree(entries);
  assert.deepEqual(tree.map((group) => group.id), ["china", "asia", "continent_other"]);
  assert.equal(tree[0].displayLabel, "中国区域");
  assert.equal(tree[0].countries.length, 2);
  state.currentLanguage = "en";
  assert.equal(model.buildCountryColorTree(entries)[0].displayLabel, "China Region");
});

test("inspector continent labels use the caller's exact geo translator", () => {
  const locales = { Mahdia: { zh: "马赫迪耶" } };
  const cityAliases = { Africa: "Mahdia" };
  const unsafeTranslator = (label, type) => (
    type === "geo" ? locales[cityAliases[label] || label]?.zh || label : label
  );
  const translateCountryGeoLabel = (label, type) => {
    if (type !== "geo") return label;
    return locales[label]?.zh || label;
  };
  const model = createCountryInspectorModel({ currentLanguage: "zh" }, translateCountryGeoLabel);

  assert.equal(unsafeTranslator("Africa", "geo"), "马赫迪耶");
  const [group] = model.buildCountryColorTree([
    { code: "NIC", continentId: "continent_africa", continentLabel: "Africa" },
  ]);
  assert.equal(group.displayLabel, "Africa");
});

test("top-level countries omit hidden and releasable entries but retain grouped subjects", () => {
  const model = createModel();
  assert.deepEqual(model.buildInspectorTopLevelCountryEntries([
    { code: "VISIBLE" }, { code: "HIDDEN", hiddenFromCountryList: true },
    { code: "RELEASE", releasable: true }, { code: "SUBJECT", scenarioSubject: true },
    { code: "GROUPED", scenarioSubject: true, inspectorGroupId: "region" },
  ]).map((entry) => entry.code), ["VISIBLE", "GROUPED"]);
});

test("country metadata reads preserve identity and follow live index replacement", () => {
  const scenarioMeta = Object.freeze({ companionVariants: Object.freeze([{ tag: "GB_ALT" }]) });
  const groupingMeta = Object.freeze({ continentId: "europe" });
  const state = { activeScenarioId: "example", scenarioCountriesByTag: { GB: scenarioMeta },
    countryGroupMetaByCode: new Map([["GB", groupingMeta]]) };
  const model = createModel(state);
  assert.equal(model.getScenarioCountryMeta("UK"), scenarioMeta);
  assert.equal(model.getCountryGroupingMeta("UK"), groupingMeta);
  state.scenarioCountriesByTag = { GB: { tag: "new" } };
  state.countryGroupMetaByCode = new Map([["GB", { continentId: "new" }]]);
  assert.equal(model.getScenarioCountryMeta("GB"), state.scenarioCountriesByTag.GB);
  assert.equal(model.getCountryGroupingMeta("GB"), state.countryGroupMetaByCode.get("GB"));
  state.activeScenarioId = "";
  assert.equal(model.getScenarioCountryMeta("GB"), null);
});
