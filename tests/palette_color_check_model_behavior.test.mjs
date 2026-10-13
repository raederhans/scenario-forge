import test from "node:test";
import assert from "node:assert/strict";
import {
  COLOR_CHECK_THRESHOLDS,
  DEFAULT_COLOR_CHECK_THRESHOLD,
  collectCountryColorCheckEntries,
  collectLegendColorCheckEntries,
  findSimilarPaletteColors,
} from "../js/ui/palette_color_check_model.js";

const country = (id, color, name = id) => ({ id, kind: "country", name, color });
const legend = (id, color, name = id) => ({ id, kind: "legend", name, color });
const pairIds = (result) => result.pairs.map(({ left, right }) => [left.id, right.id]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test("check presets expose a frozen exact, default and broader threshold", () => {
  assert.deepEqual(COLOR_CHECK_THRESHOLDS, [0, 18, 30]);
  assert.equal(Object.isFrozen(COLOR_CHECK_THRESHOLDS), true);
  assert.equal(DEFAULT_COLOR_CHECK_THRESHOLD, 18);
});

test("hex shorthand and case produce duplicate pairs before similar pairs in stable order", () => {
  const entries = [
    country("z", " #AbC ", "Zulu"),
    country("near", "#aabbcd", "Near"),
    country("a", "#AABBCC", "Alpha"),
  ];
  const result = findSimilarPaletteColors(entries);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.similarCount, 2);
  assert.deepEqual(result.pairs.map((pair) => pair.type), ["duplicate", "similar", "similar"]);
  assert.deepEqual(pairIds(result)[0], ["a", "z"]);
  assert.equal(result.pairs[0].distance, 0);
  assert.equal(result.pairs[0].left.color, "#aabbcc");
  assert.equal(result.pairs[0].right.color, "#aabbcc");
  assert.deepEqual(findSimilarPaletteColors([...entries].reverse()), result);
});

test("RGB comparison includes the distance-18 boundary and excludes a farther color", () => {
  const boundary = findSimilarPaletteColors([country("a", "#000000"), country("b", "#120000")]);
  assert.equal(boundary.similarCount, 1);
  assert.equal(boundary.pairs[0].distance, 18);
  assert.equal(findSimilarPaletteColors([country("a", "#000000"), country("b", "#130000")]).pairs.length, 0);
  const diagonal = [country("a", "#000000"), country("b", "#0c0c0c")];
  assert.equal(findSimilarPaletteColors(diagonal).pairs.length, 0, "all RGB channels contribute to distance");
  assert.ok(findSimilarPaletteColors(diagonal, { threshold: 30 }).pairs[0].distance > 18);
});

test("similarity compares every pair and does not merge a nontransitive chain", () => {
  const result = findSimilarPaletteColors([
    country("a", "#000000"), country("b", "#120000"), country("c", "#240000"),
  ]);
  assert.deepEqual(pairIds(result), [["a", "b"], ["b", "c"]]);
  assert.equal(result.similarCount, 2);
  assert.equal(result.duplicateCount, 0);
});

test("scope reports only its kind and never compares countries with legend entries", () => {
  const entries = [
    country("a", "#112233"), country("b", "#112233"),
    legend("a", "#112233"), legend("b", "#112233"),
    legend("invalid", "not-a-color"),
  ];
  const all = findSimilarPaletteColors(entries);
  assert.equal(all.duplicateCount, 2);
  assert.equal(all.countryCount, 2);
  assert.equal(all.legendCount, 2);
  assert.equal(all.skippedCount, 1);
  assert.ok(all.pairs.every(({ left, right }) => left.kind === right.kind));
  const countries = findSimilarPaletteColors(entries, { scope: "country" });
  assert.equal(countries.countryCount, 2);
  assert.equal(countries.legendCount, 0);
  assert.equal(countries.duplicateCount, 1);
  assert.equal(countries.skippedCount, 0);
  const legends = findSimilarPaletteColors(entries, { scope: "legend" });
  assert.equal(legends.countryCount, 0);
  assert.equal(legends.legendCount, 2);
  assert.equal(legends.skippedCount, 1);
  assert.deepEqual(findSimilarPaletteColors(entries, { scope: "unknown" }), all);
});

test("malformed entries are counted and repeated identities retain the first valid color", () => {
  const result = findSimilarPaletteColors([
    null,
    {},
    country("", "#112233"),
    { id: "zone", kind: "zone", name: "Zone", color: "#112233" },
    country("a", "invalid"),
    country("a", "#abc", "First valid"),
    country("a", "#ff0000", "Later duplicate identity"),
    country("b", "#AABBCC"),
  ]);
  assert.equal(result.skippedCount, 5);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].name, "First valid");
  assert.equal(result.entries[0].color, "#aabbcc");
  assert.equal(result.duplicateCount, 1);
});

test("invalid thresholds use the default and finite thresholds clamp to the supported range", () => {
  const entries = [country("a", "#000000"), country("b", "#120000")];
  for (const threshold of [Number.NaN, Number.POSITIVE_INFINITY, "invalid", "", null, false]) {
    const result = findSimilarPaletteColors(entries, { threshold });
    assert.equal(result.threshold, 18);
    assert.equal(result.similarCount, 1);
  }
  assert.equal(findSimilarPaletteColors(entries, { threshold: -1 }).threshold, 0);
  assert.equal(findSimilarPaletteColors(entries, { threshold: -1 }).pairs.length, 0);
  assert.equal(findSimilarPaletteColors(entries, { threshold: 200 }).threshold, 100);
  assert.equal(findSimilarPaletteColors(entries, { threshold: "30" }).threshold, 30);
});

test("normalized result identities and names are detached from frozen source entries", () => {
  const entries = deepFreeze([
    { id: " country:AA ", kind: "country", name: " Alpha ", code: " AA ", color: "#abc" },
    { id: "country:BB", kind: "country", name: "", code: "BB", color: "#abcdef" },
    { id: "legend:#ffffff", kind: "legend", color: "#fff" },
  ]);
  const before = JSON.stringify(entries);
  const result = findSimilarPaletteColors(entries);
  assert.deepEqual(result.entries.map(({ id, name }) => [id, name]), [
    ["country:AA", "Alpha"], ["country:BB", "BB"], ["legend:#ffffff", "legend:#ffffff"],
  ]);
  result.entries[0].color = "#000000";
  assert.equal(JSON.stringify(entries), before);
  assert.equal(findSimilarPaletteColors(entries).entries[0].color, "#aabbcc");
});

test("country collection uses the current palette chain, normalized ids and read-only sources", () => {
  const state = deepFreeze({
    sovereignBaseColors: { AA: "#111111", BAD: "invalid" },
    countryPalette: { AA: "#aaaaaa", BB: "#222222" },
    scenarioCountriesByTag: { D01: { display_name_en: "Unloaded scenario member" } },
  });
  const countries = deepFreeze([
    { code: " aa ", displayName: "Alpha" },
    { code: "BB", name: "Beta" },
    { code: "CC" },
    { code: "DD", fallbackIndex: 7 },
    { code: "BAD" },
    { code: "D01", name: "Unloaded scenario member" },
    { code: "AA", displayName: "Duplicate" },
    { code: "HIDDEN", hiddenFromCountryList: true },
    { code: "HIDDEN2", hidden_from_country_list: true },
    { code: "RELEASE1", releasable: true },
    { code: "RELEASE2", entryKind: "releasable" },
    { code: "RELEASE3", entry_kind: "releasable" },
  ]);
  const defaultPalette = deepFreeze({ AA: "#aaaaaa", BB: "#bbbbbb", CC: "#333333" });
  const fallbackCalls = [];
  const options = { defaultPalette, fallbackColor: (code, index) => {
    fallbackCalls.push([code, index]);
    return "#444444";
  } };
  const before = JSON.stringify({ state, countries, defaultPalette });
  const entries = collectCountryColorCheckEntries(state, countries, options);
  assert.deepEqual(entries.map(({ id, name, color }) => [id, name, color]), [
    ["country:AA", "Alpha", "#111111"],
    ["country:BB", "Beta", "#222222"],
    ["country:CC", "CC", "#333333"],
    ["country:DD", "DD", "#444444"],
    ["country:BAD", "BAD", "invalid"],
    ["country:D01", "Unloaded scenario member", "#444444"],
  ]);
  assert.deepEqual(fallbackCalls, [["DD", 7], ["D01", 5]]);
  assert.equal(findSimilarPaletteColors(entries).skippedCount, 1);
  assert.deepEqual(collectCountryColorCheckEntries(state, new Map(countries.map((entry, index) => [index, entry])), options), entries);
  assert.equal(JSON.stringify({ state, countries, defaultPalette }), before);
});

test("country collector refreshes live colors without changing country identity", () => {
  const countries = deepFreeze([{ code: "AA", displayName: "Alpha" }]);
  const state = { sovereignBaseColors: { AA: "#112233" }, countryPalette: { AA: "#445566" } };
  const first = collectCountryColorCheckEntries(state, countries);
  state.sovereignBaseColors = { AA: "#778899" };
  const changed = collectCountryColorCheckEntries(state, countries);
  assert.equal(changed[0].id, first[0].id);
  assert.equal(changed[0].color, "#778899");
  state.sovereignBaseColors = {};
  assert.equal(collectCountryColorCheckEntries(state, countries)[0].color, "#445566");
  assert.equal(first[0].color, "#112233");
});

test("legend collector reads live labels and colors, uses stable color ids and omits patterned zones", () => {
  const frozenState = deepFreeze({
    currentLanguage: "en",
    colors: { a: "#abc", b: "#112233", duplicate: "#AABBCC" },
    legendLabels: { "#ABC": " Alpha ", "#112233": "" },
    legendColorOrder: ["#112233", "#abc"],
    legendConfig: { maxItems: 2 },
    specialZoneLayers: [{ id: "zone", label: "Zone", style: { fill: "#ff0000" } }],
  });
  const before = JSON.stringify(frozenState);
  const first = collectLegendColorCheckEntries(frozenState);
  assert.deepEqual(first, [
    { id: "legend:#112233", kind: "legend", name: "Category 1", color: "#112233" },
    { id: "legend:#aabbcc", kind: "legend", name: "Alpha", color: "#aabbcc" },
  ]);
  assert.equal(JSON.stringify(frozenState), before);
  const state = { ...frozenState, legendLabels: { "#112233": "Updated" }, currentLanguage: "zh" };
  const changed = collectLegendColorCheckEntries(state);
  assert.equal(changed[0].id, first[0].id);
  assert.equal(changed[0].name, "Updated");
  assert.equal(changed[1].name, "类别 2");
  state.colors = { a: "#445566" };
  assert.deepEqual(collectLegendColorCheckEntries(state), [
    { id: "legend:#445566", kind: "legend", name: "类别 1", color: "#445566" },
  ]);
  state.legendConfig = { maxItems: 1 };
  state.colors = { a: "#445566", b: "#778899" };
  assert.equal(collectLegendColorCheckEntries(state).length, 1);
});

test("empty and unloaded scenario metadata remain safe without loaded map geometry", () => {
  const state = deepFreeze({ activeScenarioId: "pending", scenarioCountriesByTag: {} });
  assert.deepEqual(collectCountryColorCheckEntries(state, []), []);
  assert.deepEqual(collectCountryColorCheckEntries(state, undefined), []);
  assert.deepEqual(collectLegendColorCheckEntries(state), []);
  const result = findSimilarPaletteColors([]);
  assert.deepEqual(result, {
    entries: [], pairs: [], duplicateCount: 0, similarCount: 0, skippedCount: 0,
    countryCount: 0, legendCount: 0, threshold: 18,
  });
  assert.deepEqual(findSimilarPaletteColors(undefined), result);
  const unloaded = collectCountryColorCheckEntries(state, deepFreeze([{ code: "D01", name: "Unloaded" }]));
  assert.equal(unloaded[0].id, "country:D01");
  assert.equal(findSimilarPaletteColors(unloaded).skippedCount, 1);
});
