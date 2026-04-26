import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assetSource = await readFile(
  new URL("../js/core/city_lights_historical_1930_asset.js", import.meta.url),
  "utf8"
);
const assetModule = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(assetSource)}`);
const {
  HISTORICAL_1930_CITY_LIGHTS_ENTRIES,
  HISTORICAL_1930_CITY_LIGHTS_STATS,
} = assetModule;

function findCity(nameAscii, countryCode) {
  return HISTORICAL_1930_CITY_LIGHTS_ENTRIES.find((entry) => (
    entry.nameAscii === nameAscii && entry.countryCode === countryCode
  ));
}

test("historical 1930 city lights asset exposes calibrated exports", () => {
  assert.equal(typeof HISTORICAL_1930_CITY_LIGHTS_STATS, "object");
  assert.equal(HISTORICAL_1930_CITY_LIGHTS_STATS.calibrationVersion, "balanced-2026-04");
  assert.ok(Array.isArray(HISTORICAL_1930_CITY_LIGHTS_ENTRIES));
  assert.ok(HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length >= 1450);
  assert.ok(HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length <= 1800);
  assert.equal(HISTORICAL_1930_CITY_LIGHTS_STATS.entryCount, HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length);
});

test("historical 1930 city light entries keep legal render fields", () => {
  for (const entry of HISTORICAL_1930_CITY_LIGHTS_ENTRIES) {
    assert.equal(typeof entry.nameAscii, "string");
    assert.equal(typeof entry.countryCode, "string");
    assert.ok(Number.isFinite(entry.lon));
    assert.ok(entry.lon >= -180 && entry.lon <= 180);
    assert.ok(Number.isFinite(entry.lat));
    assert.ok(entry.lat >= -89.999 && entry.lat <= 89.999);
    assert.ok(Number.isFinite(entry.weight));
    assert.ok(entry.weight >= 0.18 && entry.weight <= 1.0);
    assert.equal(typeof entry.capitalKind, "string");
    assert.ok(Number.isFinite(entry.population));
  }
});

test("historical 1930 region calibration keeps target anchor cities visible", () => {
  const anchors = [
    ["London", "GB", 0.95],
    ["Paris", "FR", 0.95],
    ["Berlin", "DE", 0.9],
    ["Milan", "IT", 0.8],
    ["Rome", "IT", 0.95],
    ["Tokyo", "JP", 0.95],
    ["Osaka", "JP", 0.9],
    ["New York", "US", 0.76],
    ["Washington", "US", 0.86],
    ["Beijing", "CN", 0.95],
    ["Delhi", "IN", 0.84],
    ["Shanghai", "CN", 0.84],
  ];
  for (const [nameAscii, countryCode, minimumWeight] of anchors) {
    const entry = findCity(nameAscii, countryCode);
    assert.ok(entry, `${nameAscii} ${countryCode} should be present`);
    assert.ok(
      entry.weight >= minimumWeight,
      `${nameAscii} ${countryCode} weight ${entry.weight} should be >= ${minimumWeight}`
    );
  }
});

test("historical 1930 calibration caps oversized non-capital Asian hubs", () => {
  for (const [nameAscii, countryCode] of [["Shanghai", "CN"], ["Mumbai", "IN"]]) {
    const entry = findCity(nameAscii, countryCode);
    assert.ok(entry, `${nameAscii} ${countryCode} should be present`);
    assert.ok(entry.population >= 18_000_000);
    assert.notEqual(entry.capitalKind, "country_capital");
    assert.ok(entry.weight <= 0.96);
  }
});
